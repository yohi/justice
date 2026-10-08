import { mkdtemp, rm, stat as statFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildReviewCommitMessage,
  classifyReviewTargetClean,
  gitModeFromOwnerExecBits,
  reviewDomainError,
  type GitIndexEntryBindingV1,
  type GitTreeEntryBindingV1,
  type ReviewCommitPrepareInput,
  type ReviewCommitPreparedPayload,
  type ReviewCommitRecoveryResult,
  type ReviewRestorePrepareInput,
  type ReviewRestoreRecoveryResult,
  type ReviewRestoreResult,
  type ReviewTargetGitBinding,
  type ReviewGitRegularMode,
  type ReviewTargetRestorePreparedPayload,
  type VerifiedReviewCommit,
  type WorktreeArtifactBindingV1,
} from "../core/review-gate/capabilities";
import { canonicalizeArtifactPath, computeArtifactDigest } from "../core/review-gate/identity";
import {
  DIFF_RAW_STATUS_RECORD,
  runGitLiteral,
  type GitLiteralResult,
} from "./review-gate-query";

/**
 * GIT1 exact-artifact commit + WSP1 exact workspace restore.
 *
 * Every git invocation shares the CAP1/GIT1 literal-path seam (`runGitLiteral`
 * with `--literal-pathspecs` and `shell: false`). The only workspace mutations
 * are the Task 1 native `replaceWorkspaceFileExact` call and the scoped commit
 * itself; everything else is observation.
 */

export type ReviewGateWorkspaceProvider = Readonly<{
  readonly readWorkspaceFile: (path: string) => Promise<Buffer | null>;
  readonly replaceWorkspaceFileExact: (
    path: string,
    expectedCurrent: Readonly<{ readonly digest: string; readonly gitMode: ReviewGitRegularMode }>,
    replacement: Readonly<{ readonly bytes: Buffer; readonly gitMode: ReviewGitRegularMode }>,
  ) => Promise<void>;
}>;

interface ReviewGateGitOptions {
  readonly rootDir: string;
  readonly provider: ReviewGateWorkspaceProvider;
}

const OID_PATTERN = /^[0-9a-f]{40,64}$/u;

const isRegularGitMode = (mode: string): mode is ReviewGitRegularMode =>
  mode === "100644" || mode === "100755";

interface LsTreeEntry {
  readonly gitMode: string;
  readonly type: string;
  readonly blobSha: string;
  readonly path: string;
}

interface StageRecord {
  readonly gitMode: string;
  readonly blobSha: string;
  readonly stage: number;
  readonly path: string;
}

function parseLsTreeRecords(stdout: Buffer): readonly LsTreeEntry[] {
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [meta = "", rest = ""] = record.split("\t", 2);
      const [gitMode = "", type = "", blobSha = ""] = meta.split(" ");
      return { gitMode, type, blobSha, path: rest };
    });
}

function parseStageRecords(stdout: Buffer): readonly StageRecord[] {
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [meta = "", rest = ""] = record.split("\t", 2);
      const [gitMode = "", blobSha = "", stage = "0"] = meta.split(" ");
      return { gitMode, blobSha, stage: Number(stage), path: rest };
    });
}

/** Throws the transient review_query_failed code for unexpected git failures. */
function requireGitOk(result: GitLiteralResult, context: string): Buffer {
  if (result.code !== 0) {
    throw new Error(`review_query_failed: git ${context} exited ${result.code}`);
  }
  return result.stdout;
}

/**
 * Deterministic fingerprint of every index entry except the excluded target
 * path; proves unrelated staged entries are untouched by restore/commit.
 */
export async function computeUnrelatedIndexFingerprint(
  rootDir: string,
  excludePath: string,
): Promise<string> {
  const stdout = requireGitOk(await runGitLiteral(rootDir, ["ls-files", "--stage", "-z"]), "ls-files");
  const fingerprint = parseStageRecords(stdout)
    .filter((record) => record.path !== excludePath)
    .map((record) => `${record.gitMode}\0${record.blobSha}\0${record.stage}\0${record.path}`)
    .sort()
    .join("\0");
  return computeArtifactDigest(Buffer.from(fingerprint, "utf8"));
}

type PreparedRestoreState = "source" | "destination" | "conflict";

type PreparedCommitState = "precommit" | "conflict";

export class ReviewGateGit {
  private readonly rootDir: string;
  private readonly provider: ReviewGateWorkspaceProvider;

  constructor(options: ReviewGateGitOptions) {
    this.rootDir = options.rootDir;
    this.provider = options.provider;
  }

  private async git(args: readonly string[], stdin?: Buffer): Promise<GitLiteralResult> {
    return runGitLiteral(this.rootDir, args, stdin === undefined ? undefined : { stdin });
  }

  private async resolveHeadSha(): Promise<string | null> {
    const result = await this.git(["rev-parse", "--verify", "HEAD"]);
    if (result.code !== 0) return null;
    const headSha = result.stdout.toString("utf8").trim();
    return OID_PATTERN.test(headSha) ? headSha : null;
  }

  private async readHeadTreeEntry(
    headSha: string,
    canonicalPath: string,
  ): Promise<GitTreeEntryBindingV1 | null> {
    const records = parseLsTreeRecords(
      requireGitOk(await this.git(["ls-tree", "-z", headSha, "--", canonicalPath]), "ls-tree"),
    );
    const exact = records.filter((record) => record.path === canonicalPath && record.type === "blob");
    if (exact.length !== 1) return null;
    const entry = exact[0];
    if (entry === undefined || !isRegularGitMode(entry.gitMode)) return null;
    return { canonicalPath, blobSha: entry.blobSha, gitMode: entry.gitMode };
  }

  private async readStageRecords(canonicalPath: string): Promise<readonly StageRecord[]> {
    return parseStageRecords(
      requireGitOk(await this.git(["ls-files", "--stage", "-z", "--", canonicalPath]), "ls-files"),
    ).filter((record) => record.path === canonicalPath);
  }

  private async readIndexEntry(canonicalPath: string): Promise<GitIndexEntryBindingV1 | null> {
    const records = await this.readStageRecords(canonicalPath);
    if (records.length !== 1) return null;
    const entry = records[0];
    if (entry === undefined || entry.stage !== 0 || !isRegularGitMode(entry.gitMode)) return null;
    return { canonicalPath, blobSha: entry.blobSha, gitMode: entry.gitMode, stage: 0 };
  }

  private async readWorktreeBinding(
    canonicalPath: string,
  ): Promise<WorktreeArtifactBindingV1 | null> {
    const bytes = await this.provider.readWorkspaceFile(canonicalPath);
    if (bytes === null) return null;
    try {
      const fileStat = await statFile(path.join(this.rootDir, canonicalPath));
      if (!fileStat.isFile()) return null;
      return {
        canonicalPath,
        digest: computeArtifactDigest(bytes),
        gitMode: gitModeFromOwnerExecBits(fileStat.mode),
      };
    } catch {
      return null;
    }
  }

  private async catFileBlob(blobSha: string): Promise<Buffer> {
    return requireGitOk(await this.git(["cat-file", "blob", blobSha]), "cat-file");
  }

  /** GIT1 inspection of one target: exact HEAD/index tree entries + worktree binding. */
  async inspectTarget(path: string): Promise<ReviewTargetGitBinding> {
    const canonical = canonicalizeArtifactPath(path);
    if (canonical === null) throw reviewDomainError("review_scope_violation");
    const headSha = await this.resolveHeadSha();
    const headEntry = headSha === null ? null : await this.readHeadTreeEntry(headSha, canonical);
    const headBlobDigest =
      headEntry === null ? null : computeArtifactDigest(await this.catFileBlob(headEntry.blobSha));
    const stageRecords = await this.readStageRecords(canonical);
    const stageZeroCount = stageRecords.filter((record) => record.stage === 0).length;
    return {
      canonicalPath: canonical,
      headSha,
      headEntry,
      indexEntry: await this.readIndexEntry(canonical),
      indexConflicted:
        stageRecords.some((record) => record.stage !== 0) || stageZeroCount > 1,
      worktree: await this.readWorktreeBinding(canonical),
      headBlobDigest,
    };
  }

  /** GIT1 clean admission verdict for an already-inspected binding. */
  classifyTargetClean(binding: ReviewTargetGitBinding): "clean" | "not_clean" {
    return classifyReviewTargetClean(binding);
  }

  // -- WSP1 exact restore ---------------------------------------------------

  async prepareRestore(
    input: ReviewRestorePrepareInput,
  ): Promise<ReviewTargetRestorePreparedPayload> {
    const canonical = canonicalizeArtifactPath(input.targetCanonicalPath);
    const allowed = canonicalizeArtifactPath(input.allowedRestoreTargetPath);
    const scopeViolation = (): Error => reviewDomainError("review_restore_scope_violation");
    if (
      canonical === null ||
      allowed === null ||
      canonical !== allowed ||
      canonical !== input.sourceKnownDirtyBinding.headEntry.canonicalPath ||
      canonical !== input.targetCleanCommittedBinding.headEntry.canonicalPath
    ) {
      throw scopeViolation();
    }
    const { sourceKnownDirtyBinding: source, targetCleanCommittedBinding: destination } = input;
    if (
      source.headSha !== destination.headSha ||
      source.headEntry.blobSha !== destination.headEntry.blobSha ||
      source.headEntry.gitMode !== destination.headEntry.gitMode ||
      source.indexEntry.blobSha !== destination.indexEntry.blobSha ||
      source.indexEntry.gitMode !== destination.indexEntry.gitMode ||
      // Source and destination Git modes must be equal for Review Gate restore;
      // destination bytes must be the exact committed blob of the guarded HEAD.
      source.worktree.gitMode !== destination.headEntry.gitMode ||
      destination.worktree.gitMode !== destination.headEntry.gitMode
    ) {
      throw scopeViolation();
    }
    let headBlobBytes: Buffer;
    try {
      headBlobBytes = await this.catFileBlob(destination.headEntry.blobSha);
    } catch (cause: unknown) {
      throw reviewDomainError("review_restore_failed", cause);
    }
    if (computeArtifactDigest(headBlobBytes) !== destination.worktree.digest) {
      throw scopeViolation();
    }
    const current = await this.inspectTarget(canonical);
    if (
      current.headSha !== source.headSha ||
      current.headEntry === null ||
      current.headEntry.blobSha !== source.headEntry.blobSha ||
      current.headEntry.gitMode !== source.headEntry.gitMode ||
      current.indexEntry === null ||
      current.indexConflicted ||
      current.indexEntry.blobSha !== source.indexEntry.blobSha ||
      current.indexEntry.gitMode !== source.indexEntry.gitMode ||
      current.worktree === null ||
      current.worktree.digest !== source.worktree.digest ||
      current.worktree.gitMode !== source.worktree.gitMode
    ) {
      throw scopeViolation();
    }
    return {
      preparedId: `${input.operationId}-${Date.now().toString(36)}`,
      preparedAt: new Date().toISOString(),
      gateId: input.gateId,
      operationId: input.operationId,
      phase: input.phase,
      targetCanonicalPath: canonical,
      sourceKnownDirtyBinding: source,
      targetCleanCommittedBinding: destination,
    };
  }

  private async classifyPreparedRestoreState(
    payload: ReviewTargetRestorePreparedPayload,
  ): Promise<PreparedRestoreState> {
    const current = await this.inspectTarget(payload.targetCanonicalPath);
    const source = payload.sourceKnownDirtyBinding;
    const destination = payload.targetCleanCommittedBinding;
    const guardsMatch = (
      binding: Readonly<{
        readonly headSha: string;
        readonly headEntry: GitTreeEntryBindingV1;
        readonly indexEntry: GitIndexEntryBindingV1;
      }>,
    ): boolean =>
      current.headSha === binding.headSha &&
      current.headEntry !== null &&
      current.headEntry.blobSha === binding.headEntry.blobSha &&
      current.headEntry.gitMode === binding.headEntry.gitMode &&
      !current.indexConflicted &&
      current.indexEntry !== null &&
      current.indexEntry.blobSha === binding.indexEntry.blobSha &&
      current.indexEntry.gitMode === binding.indexEntry.gitMode;
    const worktreeMatches = (binding: WorktreeArtifactBindingV1): boolean =>
      current.worktree !== null &&
      current.worktree.digest === binding.digest &&
      current.worktree.gitMode === binding.gitMode;
    if (guardsMatch(source) && worktreeMatches(source.worktree)) return "source";
    if (guardsMatch(destination) && worktreeMatches(destination.worktree)) return "destination";
    return "conflict";
  }

  async executePreparedRestore(
    payload: ReviewTargetRestorePreparedPayload,
  ): Promise<ReviewRestoreResult> {
    const state = await this.classifyPreparedRestoreState(payload);
    if (state === "conflict") throw reviewDomainError("review_restore_recovery_conflict");
    if (state === "destination") return { status: "recovered" };
    const destination = payload.targetCleanCommittedBinding;
    const source = payload.sourceKnownDirtyBinding;
    const replacementBytes = await this.catFileBlob(destination.headEntry.blobSha);
    try {
      await this.provider.replaceWorkspaceFileExact(
        payload.targetCanonicalPath,
        { digest: source.worktree.digest, gitMode: source.worktree.gitMode },
        { bytes: replacementBytes, gitMode: destination.headEntry.gitMode },
      );
    } catch (cause: unknown) {
      throw reviewDomainError("review_restore_failed", cause);
    }
    const verified = await this.inspectTarget(payload.targetCanonicalPath);
    if (
      verified.worktree === null ||
      verified.worktree.digest !== destination.worktree.digest ||
      verified.worktree.gitMode !== destination.worktree.gitMode ||
      verified.headSha !== destination.headSha ||
      verified.headEntry === null ||
      verified.headEntry.blobSha !== destination.headEntry.blobSha ||
      verified.headEntry.gitMode !== destination.headEntry.gitMode ||
      verified.indexEntry === null ||
      verified.indexEntry.blobSha !== destination.indexEntry.blobSha ||
      verified.indexEntry.gitMode !== destination.indexEntry.gitMode
    ) {
      throw reviewDomainError("review_restore_failed");
    }
    return {
      status: "restored",
      verified: { digest: destination.worktree.digest, gitMode: destination.worktree.gitMode },
    };
  }

  /** CP1 recovery classification; never mutates the workspace. */
  async recoverPreparedRestore(
    payload: ReviewTargetRestorePreparedPayload,
  ): Promise<ReviewRestoreRecoveryResult> {
    const state = await this.classifyPreparedRestoreState(payload);
    if (state === "source") return { status: "safe_to_reexecute" };
    if (state === "destination") return { status: "recovered" };
    throw reviewDomainError("review_restore_recovery_conflict");
  }

  // -- GIT1 exact-artifact commit -------------------------------------------

  async prepareCommit(input: ReviewCommitPrepareInput): Promise<ReviewCommitPreparedPayload> {
    const canonical = canonicalizeArtifactPath(input.targetCanonicalPath);
    const allowed = canonicalizeArtifactPath(input.allowedCommitTargetPath);
    if (canonical === null || allowed === null || canonical !== allowed) {
      throw reviewDomainError("review_commit_scope_violation");
    }
    const binding = await this.inspectTarget(canonical);
    if (
      binding.headSha === null ||
      binding.headEntry === null ||
      binding.indexConflicted ||
      binding.indexEntry === null ||
      // Exact prepared intent: no staged target drift, and the full Git mode chain
      // parent == index == worktree == expected must hold before the commit runs.
      binding.headEntry.blobSha !== binding.indexEntry.blobSha ||
      binding.headEntry.gitMode !== binding.indexEntry.gitMode ||
      binding.headEntry.gitMode !== input.expectedGitMode ||
      binding.worktree === null ||
      binding.worktree.digest !== input.expectedArtifactDigest ||
      binding.worktree.gitMode !== input.expectedGitMode
    ) {
      throw reviewDomainError("review_commit_scope_violation");
    }
    // hash-object --stdin hangs without input; the exact worktree bytes come
    // from the Task 1 safe workspace reader.
    const worktreeBytes = await this.provider.readWorkspaceFile(canonical);
    if (worktreeBytes === null) {
      throw reviewDomainError("review_commit_scope_violation");
    }
    const expectedBlobSha = (
      requireGitOk(
        await this.git(["hash-object", "-w", "--stdin"], worktreeBytes),
        "hash-object",
      ).toString("utf8")
    ).trim();
    const commitMessage = buildReviewCommitMessage(
      input.phase,
      input.remediationRound,
      [...input.lineageIds].sort(),
    );
    return {
      preparedId: `${input.operationId}-${Date.now().toString(36)}`,
      preparedAt: new Date().toISOString(),
      gateId: input.gateId,
      operationId: input.operationId,
      phase: input.phase,
      targetCanonicalPath: canonical,
      parentHeadSha: binding.headSha,
      parentTargetEntry: binding.headEntry,
      preCommitIndexEntry: binding.indexEntry,
      expectedTargetEntry: {
        canonicalPath: canonical,
        blobSha: expectedBlobSha,
        gitMode: input.expectedGitMode,
      },
      expectedArtifactDigest: input.expectedArtifactDigest,
      remediationRound: input.remediationRound,
      lineageIds: [...input.lineageIds].sort(),
      commitMessage,
      messageDigest: computeArtifactDigest(Buffer.from(commitMessage, "utf8")),
      unrelatedIndexFingerprint: await computeUnrelatedIndexFingerprint(this.rootDir, canonical),
    };
  }

  private async assertPreparedCommitState(
    payload: ReviewCommitPreparedPayload,
  ): Promise<PreparedCommitState> {
    const headSha = await this.resolveHeadSha();
    if (headSha !== payload.parentHeadSha) return "conflict";
    const current = await this.inspectTarget(payload.targetCanonicalPath);
    if (
      current.headEntry === null ||
      current.headEntry.blobSha !== payload.parentTargetEntry.blobSha ||
      current.headEntry.gitMode !== payload.parentTargetEntry.gitMode ||
      current.worktree === null ||
      current.worktree.digest !== payload.expectedArtifactDigest ||
      current.worktree.gitMode !== payload.expectedTargetEntry.gitMode
    ) {
      return "conflict";
    }
    return "precommit";
  }

  async executePreparedCommit(payload: ReviewCommitPreparedPayload): Promise<VerifiedReviewCommit> {
    const state = await this.assertPreparedCommitState(payload);
    if (state === "conflict") {
      // Workspace/HEAD drift after prepare is an unprovable intent state: the
      // coordinator must recover (classify) rather than silently overwrite.
      throw reviewDomainError("review_commit_recovery_conflict");
    }
    const messageDir = await mkdtemp(path.join(os.tmpdir(), "justice-commit-"));
    const messageFile = path.join(messageDir, "message.txt");
    try {
      await writeFile(messageFile, payload.commitMessage, { mode: 0o600 });
      const commitResult = await this.git(
        [
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "--only",
          "--no-gpg-sign",
          "--no-status",
          "--cleanup=verbatim",
          "--pathspec-from-file=-",
          "--pathspec-file-nul",
          "-F",
          messageFile,
        ],
        Buffer.from(`${payload.targetCanonicalPath}\0`, "utf8"),
      );
      if (commitResult.code !== 0) {
        throw reviewDomainError(
          "review_commit_failed",
          new Error(`git commit exited ${commitResult.code}: ${commitResult.stderr.slice(0, 400)}`),
        );
      }
    } finally {
      await rm(messageDir, { recursive: true, force: true });
    }
    const commitId = await this.resolveHeadSha();
    if (commitId === null) throw reviewDomainError("review_commit_recovery_conflict");
    return await this.verifyPreparedCommit(payload, commitId);
  }

  /**
   * GIT1 §30.3 post-verification of one candidate commit. Process exit 0 is
   * evidence only; every assertion failure is an unprovable state and maps to
   * `review_commit_recovery_conflict`.
   */
  private async verifyPreparedCommit(
    payload: ReviewCommitPreparedPayload,
    commitId: string,
  ): Promise<VerifiedReviewCommit> {
    const verificationFailed = (detail: string): Error =>
      reviewDomainError("review_commit_recovery_conflict", new Error(detail));
    try {
      const commitObject = (
        requireGitOk(await this.git(["cat-file", "commit", commitId]), "cat-file").toString("utf8")
      );
      const separatorIndex = commitObject.indexOf("\n\n");
      if (separatorIndex < 0) throw verificationFailed("commit object malformed");
      const headers = commitObject.slice(0, separatorIndex);
      const message = commitObject.slice(separatorIndex + 2);
      const parentCommitId = headers
        .split("\n")
        .filter((line) => line.startsWith("parent "))
        .map((line) => line.slice("parent ".length))[0];
      if (parentCommitId === undefined || parentCommitId !== payload.parentHeadSha) {
        throw verificationFailed("commit parent is not the prepared parent");
      }
      if (
        computeArtifactDigest(Buffer.from(message, "utf8")) !== payload.messageDigest ||
        message !== payload.commitMessage
      ) {
        throw verificationFailed("commit message does not match the prepared digest");
      }
      // Full parent→commit changed-entry set; deliberately NOT path-scoped so
      // any accidental extra committed path is detected.
      const changedPaths: string[] = [];
      const diffTreeText = requireGitOk(
        await this.git([
          "diff-tree",
          "-z",
          "-r",
          "--no-renames",
          "--no-color",
          parentCommitId,
          commitId,
        ]),
        "diff-tree",
      ).toString("utf8");
      const records = diffTreeText.split("\0");
      let expectingPath = false;
      for (const record of records) {
        if (expectingPath) {
          expectingPath = false;
          if (record.length === 0) continue;
          const canonical = canonicalizeArtifactPath(record);
          if (canonical === null) throw verificationFailed("commit contains an invalid changed path");
          if (!changedPaths.includes(canonical)) changedPaths.push(canonical);
          continue;
        }
        if (DIFF_RAW_STATUS_RECORD.test(record)) expectingPath = true;
      }
      if (changedPaths.length !== 1 || changedPaths[0] !== payload.targetCanonicalPath) {
        throw verificationFailed("commit changed an unexpected set of paths");
      }
      const treeEntry = await this.readHeadTreeEntry(commitId, payload.targetCanonicalPath);
      if (
        treeEntry === null ||
        treeEntry.blobSha !== payload.expectedTargetEntry.blobSha ||
        treeEntry.gitMode !== payload.expectedTargetEntry.gitMode ||
        treeEntry.gitMode !== payload.parentTargetEntry.gitMode
      ) {
        throw verificationFailed("commit target tree entry does not match the prepared entry");
      }
      const indexEntry = await this.readIndexEntry(payload.targetCanonicalPath);
      if (
        indexEntry === null ||
        indexEntry.blobSha !== payload.expectedTargetEntry.blobSha ||
        indexEntry.gitMode !== payload.expectedTargetEntry.gitMode
      ) {
        throw verificationFailed("index target entry does not match the prepared entry");
      }
      const current = await this.inspectTarget(payload.targetCanonicalPath);
      if (
        current.worktree === null ||
        current.worktree.digest !== payload.expectedArtifactDigest ||
        current.worktree.gitMode !== payload.expectedTargetEntry.gitMode
      ) {
        throw verificationFailed("worktree target state does not match the prepared entry");
      }
      const fingerprintAfter = await computeUnrelatedIndexFingerprint(
        this.rootDir,
        payload.targetCanonicalPath,
      );
      if (fingerprintAfter !== payload.unrelatedIndexFingerprint) {
        throw verificationFailed("unrelated index fingerprint changed across the commit");
      }
      return { commitId, parentCommitId, targetEntry: treeEntry, changedPaths };
    } catch (cause: unknown) {
      if (
        cause instanceof Error &&
        cause.message.startsWith("review_commit_recovery_conflict")
      ) {
        throw cause;
      }
      throw verificationFailed(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async recoverPreparedCommit(
    payload: ReviewCommitPreparedPayload,
  ): Promise<ReviewCommitRecoveryResult> {
    const headSha = await this.resolveHeadSha();
    if (headSha !== null) {
      try {
        // Crash after execution: the exact intended commit may already exist.
        const commit = await this.verifyPreparedCommit(payload, headSha);
        return { status: "recovered", commit };
      } catch {
        // fall through to the safe re-execution classification
      }
    }
    const state = await this.assertPreparedCommitState(payload);
    if (state === "precommit") return { status: "safe_to_reexecute" };
    throw reviewDomainError("review_commit_recovery_conflict");
  }
}

export function createReviewGateGit(options: ReviewGateGitOptions): ReviewGateGit {
  return new ReviewGateGit(options);
}
