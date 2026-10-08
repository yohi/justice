import { spawn } from "node:child_process";
import { isReviewQueryPathAllowed } from "../core/review-gate/capabilities";
import {
  MAX_REVIEW_DIFF_BYTES,
  MAX_REVIEW_LOG_LIMIT,
  MAX_REVIEW_QUERY_LINE_CHARS,
  MAX_REVIEW_QUERY_MATCHES,
  type ReviewGitDiff,
  type ReviewGitLogEntry,
  type ReviewGitStatus,
  type ReviewGitStatusEntry,
  type ReviewQueryMatch,
  type ReviewQueryScope,
  type ReviewRevisionRef,
} from "../core/review-gate/capabilities";
import { canonicalizeArtifactPath } from "../core/review-gate/identity";

/**
 * CAP1 typed, phase-scoped read/search/git-metadata query service.
 *
 * Every artifact-path Git invocation goes through the single `runGitLiteral`
 * seam: `spawn("git", ["--literal-pathspecs", ...args], { shell: false })` in
 * the workspace root. Raw query output is transient/bounded and never durable
 * Review Gate authority.
 */

export type ReviewWorkspaceReader = Readonly<{
  /** Returns file bytes or null when the validated relative path is unreadable. */
  readonly readWorkspaceFile: (path: string) => Promise<Buffer | null>;
}>;

/** Spawn observation record (exported for test seam assertions only). */
export type StoredGitSpawnCall = Readonly<{
  readonly command: string;
  readonly args: string[];
  readonly options?: Readonly<{ shell?: boolean; cwd?: string }> | undefined;
}>;

export type GitLiteralResult = Readonly<{
  readonly code: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}>;

/** Hard bound for any single git invocation's collected output. */
export const GIT_OUTPUT_BYTE_LIMIT = 16 * 1024 * 1024;
export const DEFAULT_GIT_TIMEOUT_MS = 60_000;

/**
 * The single seam for ALL Review Gate git invocations. Pathspec safety comes
 * from the global `--literal-pathspecs` flag plus `shell: false`; arguments are
 * passed verbatim without quoting or `:(literal)` encoding.
 */
export async function runGitLiteral(
  rootDir: string,
  args: readonly string[],
  input?: Readonly<{ readonly stdin: Buffer }>,
): Promise<GitLiteralResult> {
  return await new Promise<GitLiteralResult>((resolve, reject) => {
    const child = spawn("git", ["--literal-pathspecs", ...args], {
      shell: false,
      cwd: rootDir,
      timeout: DEFAULT_GIT_TIMEOUT_MS,
      stdio: "pipe",
    });
    let killedOverLimit = false;
    const stdoutChunks: Buffer[] = [];
    let collected = 0;
    let stderrText = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      collected += chunk.length;
      if (!killedOverLimit && collected > GIT_OUTPUT_BYTE_LIMIT) {
        killedOverLimit = true;
        child.kill();
      }
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const merged = Buffer.concat([Buffer.from(stderrText, "utf8"), chunk]);
      stderrText = merged.subarray(0, 64 * 1024).toString("utf8");
    });
    child.on("error", (cause: Error) => {
      if (!killedOverLimit) reject(new Error("review_query_failed", { cause }));
    });
    child.on("close", (code: number | null) => {
      if (killedOverLimit) {
        reject(new Error("review_query_failed"));
        return;
      }
      resolve({ code: code ?? 128, stdout: Buffer.concat(stdoutChunks), stderr: stderrText });
    });
    if (input !== undefined) {
      // EPIPE when git consumes the record and exits early; the exit code rules.
      child.stdin?.on("error", () => {});
      child.stdin?.end(input.stdin);
    }
  });
}

interface ReviewGateQueryOptions {
  readonly rootDir: string;
  readonly workspaceReader: ReviewWorkspaceReader;
}

export interface ReviewGateQueryService {
  readonly readArtifact: (scope: ReviewQueryScope, path: string) => Promise<Buffer>;
  readonly searchArtifact: (
    scope: ReviewQueryScope,
    path: string,
    literal: string,
  ) => Promise<readonly ReviewQueryMatch[]>;
  readonly getScopedStatus: (scope: ReviewQueryScope) => Promise<ReviewGitStatus>;
  readonly getScopedDiff: (
    scope: ReviewQueryScope,
    request: { readonly base: ReviewRevisionRef | null; readonly staged: boolean },
  ) => Promise<ReviewGitDiff>;
  readonly resolveRevision: (ref: ReviewRevisionRef) => Promise<string>;
  readonly getScopedLog: (
    scope: ReviewQueryScope,
    request: { readonly base: ReviewRevisionRef | null; readonly limit: number },
  ) => Promise<readonly ReviewGitLogEntry[]>;
  readonly showPathAtRevision: (
    scope: ReviewQueryScope,
    ref: ReviewRevisionRef,
    path: string,
  ) => Promise<Buffer>;
}

const OID_PATTERN = /^[0-9a-f]{40,64}$/u;

const rejectUnlessRegular = (
  entries: ReadonlyArray<{
    readonly gitMode: string;
    readonly type: string;
    readonly blobSha: string;
    readonly path: string;
  }>,
): boolean => entries.length === 1 && entries[0] !== undefined && entries[0].type === "blob";

interface LsTreeRecord {
  readonly gitMode: string;
  readonly type: string;
  readonly blobSha: string;
  readonly path: string;
}

function parseLsTree(stdout: Buffer): readonly LsTreeRecord[] {
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [meta = "", path = ""] = record.split("\t", 2);
      const parts = meta.split(" ");
      return {
        gitMode: parts[0] ?? "",
        type: parts[1] ?? "",
        blobSha: parts[2] ?? "",
        path,
      };
    });
}

// Porcelain v1 XY states plus untracked "?" and ignored "!" markers.
const intentionalPorcelainStates = /^[MARDUCT?! ]{2}$/u;

function parseStatusPorcelain(stdout: Buffer, allowed: ReadonlySet<string>): ReviewGitStatus {
  const entries: ReviewGitStatusEntry[] = [];
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record.length < 4) continue;
    const indexState = record.slice(0, 1);
    const workingTreeState = record.slice(1, 2);
    if (record[2] !== " ") continue; // submodule/v2-style extras are not project entries
    if (!intentionalPorcelainStates.test(indexState + workingTreeState)) continue;
    const canonicalPath = canonicalizeArtifactPath(record.slice(3));
    if (canonicalPath === null) continue;
    if (!allowed.has(canonicalPath)) continue; // scope is the boundary, never git output
    entries.push({ canonicalPath, indexState, workingTreeState });
  }
  entries.sort((left, right) => (left.canonicalPath < right.canonicalPath ? -1 : 1));
  return { entries };
}

// `--raw -z` emits one status record followed by one path record per entry.
// Literal artifact names may themselves start with ":", so records are decoded
// as status→path pairs instead of a naive starts-with check.
export const DIFF_RAW_STATUS_RECORD =
  /^:[0-7]{6} [0-7]{6} [0-9a-f]{4,64} [0-9a-f]{4,64} [A-Z?]{1,4}\d{0,3}$/u;

function parseDiffRawChangedPaths(stdout: Buffer): readonly string[] {
  const records: string[] = stdout.toString("utf8").split("\0");
  const paths: string[] = [];
  let expectingPath = false;
  for (const record of records) {
    if (expectingPath) {
      expectingPath = false;
      if (record.length === 0) continue;
      const canonical = canonicalizeArtifactPath(record);
      if (canonical !== null && !paths.includes(canonical)) paths.push(canonical);
      continue;
    }
    if (DIFF_RAW_STATUS_RECORD.test(record)) expectingPath = true;
  }
  return paths;
}

function parseLogChunks(stdout: Buffer): readonly ReviewGitLogEntry[] {
  return stdout
    .toString("utf8")
    .split("\0")
    .filter((record) => record.length > 0)
    .map((record) => {
      const [commitId = "", parents = "", summary = ""] = record.split("\x1f");
      return {
        commitId,
        parentCommitIds: parents.length === 0 ? [] : parents.split(" "),
        summary,
      };
    });
}

export function createReviewGateQueryService({
  rootDir,
  workspaceReader,
}: ReviewGateQueryOptions): ReviewGateQueryService {
  const readArtifactOrQueryFailed = async (
    scope: ReviewQueryScope,
    rawPath: string,
  ): Promise<Buffer> => {
    const canonical = requireScopePath(scope, "artifact", rawPath);
    const bytes = await workspaceReader.readWorkspaceFile(canonical);
    if (bytes === null) throw new Error("review_query_failed: unreadable scoped artifact");
    return bytes;
  };

  const sortedGitPaths = (scope: ReviewQueryScope): readonly string[] =>
    [...scope.allowedGitPaths].sort();

  function requireScopePath(
    scope: ReviewQueryScope,
    kind: "artifact" | "git",
    rawPath: string,
  ): string {
    if (!isReviewQueryPathAllowed(scope, kind, rawPath)) {
      throw new Error("review_scope_violation");
    }
    const canonical = canonicalizeArtifactPath(rawPath);
    if (canonical === null) throw new Error("review_scope_violation");
    return canonical;
  }

  const assertGitOk = (result: GitLiteralResult, context: string): Buffer => {
    if (result.code !== 0) {
      throw new Error(`review_query_failed: git ${context} exited ${result.code}`);
    }
    return result.stdout;
  };

  const parseRefArgument = (ref: ReviewRevisionRef): string => {
    if (ref.kind === "object") {
      if (!OID_PATTERN.test(ref.objectId)) {
        // Only Justice-defined symbolic refs and validated Git object ids are
        // accepted revision authorities; anything else is not permitted.
        throw new Error("review_operation_not_permitted: invalid revision id");
      }
      return `${ref.objectId}^{object}`;
    }
    return ref.depth > 0 ? `HEAD~${ref.depth}^{object}` : "HEAD^{object}";
  };

  const resolveRevisionOrThrow = async (ref: ReviewRevisionRef): Promise<string> => {
    const refSpec = parseRefArgument(ref);
    const result = await runGitLiteral(rootDir, ["rev-parse", "--verify", refSpec]);
    if (result.code !== 0) {
      throw new Error(`review_operation_not_permitted: unresolvable revision`);
    }
    return result.stdout.toString("utf8").trim();
  };

  return {
    readArtifact: async (scope, path) => {
      return await readArtifactOrQueryFailed(scope, path);
    },

    searchArtifact: async (scope, path, literal) => {
      if (literal.length === 0) {
        throw new Error("review_query_failed: empty search literal");
      }
      const bytes = await readArtifactOrQueryFailed(scope, path);
      const lines = bytes.toString("utf8").split("\n");
      const matches: ReviewQueryMatch[] = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!line.includes(literal)) continue;
        matches.push({
          line: index + 1,
          text: line.slice(0, MAX_REVIEW_QUERY_LINE_CHARS),
        });
        if (matches.length >= MAX_REVIEW_QUERY_MATCHES) break;
      }
      return matches;
    },

    getScopedStatus: async (scope) => {
      const paths = sortedGitPaths(scope);
      if (paths.length === 0) return { entries: [] };
      const result = await runGitLiteral(rootDir, ["status", "--porcelain", "-z", "--", ...paths]);
      return parseStatusPorcelain(assertGitOk(result, "status"), scope.allowedGitPaths);
    },

    resolveRevision: resolveRevisionOrThrow,

    getScopedDiff: async (scope, request) => {
      const paths = sortedGitPaths(scope);
      if (paths.length === 0) return { text: "", changedPaths: [] };
      const baseArgs: string[] = [];
      if (request.base !== null) baseArgs.push(await resolveRevisionOrThrow(request.base));
      if (request.staged) baseArgs.push("--cached");
      const raw = assertGitOk(
        await runGitLiteral(rootDir, [
          "diff",
          "--raw",
          "-z",
          "--no-renames",
          "--no-color",
          "--no-ext-diff",
          ...baseArgs,
          "--",
          ...paths,
        ]),
        "diff-raw",
      );
      const text = assertGitOk(
        await runGitLiteral(rootDir, [
          "diff",
          "--no-color",
          "--no-ext-diff",
          ...baseArgs,
          "--",
          ...paths,
        ]),
        "diff",
      ).toString("utf8");
      const changedPaths = parseDiffRawChangedPaths(raw).filter((path) =>
        scope.allowedGitPaths.has(path),
      );
      return { text: text.slice(0, MAX_REVIEW_DIFF_BYTES), changedPaths };
    },

    getScopedLog: async (scope, request) => {
      if (!Number.isInteger(request.limit) || request.limit < 1) {
        throw new Error("review_query_failed: invalid log limit");
      }
      const limit = Math.min(request.limit, MAX_REVIEW_LOG_LIMIT);
      const paths = sortedGitPaths(scope);
      if (paths.length === 0) return [];
      const baseArgs: string[] = [];
      if (request.base !== null) baseArgs.push(await resolveRevisionOrThrow(request.base));
      const result = assertGitOk(
        await runGitLiteral(rootDir, [
          "log",
          "--no-color",
          "--no-notes",
          "--no-renames",
          "-z",
          "--format=%H%x1f%P%x1f%s",
          `--max-count=${limit}`,
          ...baseArgs,
          "--",
          ...paths,
        ]),
        "log",
      );
      return parseLogChunks(result);
    },

    showPathAtRevision: async (scope, ref, path) => {
      const canonical = requireScopePath(scope, "artifact", path);
      const oid = await resolveRevisionOrThrow(ref);
      const records = parseLsTree(
        assertGitOk(await runGitLiteral(rootDir, ["ls-tree", "-z", oid, "--", canonical]), "ls-tree"),
      );
      const exact = records.filter((record) => record.path === canonical);
      if (
        !rejectUnlessRegular(exact) ||
        exact[0] === undefined ||
        !isRegularGitMode(exact[0].gitMode)
      ) {
        throw new Error("review_query_failed: path is not a regular blob at the revision");
      }
      return assertGitOk(
        await runGitLiteral(rootDir, ["cat-file", "blob", exact[0].blobSha]),
        "cat-file",
      );
    },
  };
}

function isRegularGitMode(mode: string): boolean {
  return mode === "100644" || mode === "100755";
}
