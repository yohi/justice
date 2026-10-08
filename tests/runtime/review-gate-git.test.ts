import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  computeUnrelatedIndexFingerprint,
  createReviewGateGit,
} from "../../src/runtime/review-gate-git";
import type { ReviewGateWorkspaceProvider } from "../../src/runtime/review-gate-git";
import { buildReviewCommitMessage } from "../../src/core/review-gate/capabilities";
import { computeArtifactDigest } from "../../src/core/review-gate/identity.js";
import type {
  GitIndexEntryBindingV1,
  GitTreeEntryBindingV1,
  ReviewCommitPrepareInput,
  ReviewRestorePrepareInput,
  ReviewTargetGitBinding,
  WorktreeArtifactBindingV1,
} from "../../src/core/review-gate/capabilities";

const TARGET = ":(glob)*.md";
const TARGET_V1 = "design target v1\nbe clean\n";
const TARGET_V2 = "design target v2\nbe clean\n";
const TARGET_V3 = "design target v3\nbe clean\n";

let currentRoot = "";
const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

async function runGitCli(root: string, args: readonly string[], input?: string): Promise<string> {
  // importActual bypasses any test-module mocks; the fixture helper stays real.
  const cp = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const result = cp.spawnSync("git", [...args], {
    cwd: root,
    shell: false,
    encoding: "buffer",
    input: input === undefined ? undefined : Buffer.from(input, "utf8"),
  });
  if (result.status !== 0 || result.error != null) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString("utf8");
}

/**
 * Fresh test repository. A failing pre-commit hook is installed and wired
 * through `core.hooksPath` so any production commit that does not force
 * `-c core.hooksPath=/dev/null` fails the test visibly via `marker-hook-ran`
 * or a hook exit code.
 */
async function initFixture(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/justice-task9-git-`);
  tempRoots.push(root);
  await runGitCli(root, ["init", "-q"]);
  await runGitCli(root, ["config", "user.name", "Justice Test"]);
  await runGitCli(root, ["config", "user.email", "justice@example.invalid"]);
  await runGitCli(root, ["config", "commit.gpgsign", "false"]);
  await runGitCli(root, ["config", "core.hooksPath", ".git/justice-hooks"]);
  await mkdir(`${root}/.git/justice-hooks`);
  await writeFile(
    `${root}/.git/justice-hooks/pre-commit`,
    "#!/bin/sh\ntouch marker-hook-ran\nexit 1\n",
    { mode: 0o755 },
  );
  await writeFile(`${root}/requirements.md`, "requirements v1\n");
  await writeFile(`${root}/:(glob)*.md`, TARGET_V1);
  await mkdir(`${root}/docs`, { recursive: true });
  await writeFile(`${root}/docs/a.md`, "a v1\n");
  await writeFile(`${root}/docs/b.md`, "b v1\n");
  await runGitCli(root, ["add", "-A"]);
  await runGitCli(root, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", "init"]);
  return root;
}

type RecordingProvider = ReviewGateWorkspaceProvider & {
  readonly replaceCalls: ReadonlyArray<{
    readonly path: string;
    readonly expectedDigest: string;
    readonly replacementGitMode: "100644" | "100755";
  }>;
};

/**
 * Mock of the Task 1 native provider with real-fs semantics: byte-exact
 * replacement that inherits the target's existing non-Git POSIX bits and pins
 * the owner execute bit to the replacement's Git mode. Per the task rules,
 * only the native substrate provider is mocked.
 */
function createFsProvider(
  root: string,
  options: Readonly<{ failReplaceWith?: string }> = {},
): RecordingProvider {
  const failReplaceWith = options.failReplaceWith ?? null;
  const replaceCalls: Array<{
    readonly path: string;
    readonly expectedDigest: string;
    readonly replacementGitMode: "100644" | "100755";
  }> = [];
  let counter = 0;
  return {
    replaceCalls,
    async readWorkspaceFile(relativePath: string): Promise<Buffer | null> {
      if (
        relativePath.length === 0 ||
        relativePath.startsWith("/") ||
        relativePath.includes("..") ||
        relativePath.includes("\0")
      ) {
        return null;
      }
      try {
        return await readFile(`${root}/${relativePath}`);
      } catch {
        return null;
      }
    },
    async replaceWorkspaceFileExact(
      relativePath: string,
      expectedCurrent: Readonly<{ readonly digest: string; readonly gitMode: "100644" | "100755" }>,
      replacement: Readonly<{ readonly bytes: Buffer; readonly gitMode: "100644" | "100755" }>,
    ): Promise<void> {
      replaceCalls.push({
        path: relativePath,
        expectedDigest: expectedCurrent.digest,
        replacementGitMode: replacement.gitMode,
      });
      if (failReplaceWith !== null) throw new Error(failReplaceWith);
      const absolute = path.join(root, relativePath);
      const currentStat = await stat(absolute);
      const preserved = currentStat.mode & 0o7777;
      const execClass = replacement.gitMode === "100755" ? 0o100 : 0;
      const nextMode = (preserved & ~0o100) | execClass;
      counter += 1;
      const tmp = `${absolute}.justice-restore-${counter}`;
      const fsPromises = await import("node:fs/promises");
      await fsPromises.writeFile(tmp, replacement.bytes);
      await fsPromises.chmod(tmp, nextMode);
      await fsPromises.rename(tmp, absolute);
    },
  };
}

async function headShaOf(root: string): Promise<string> {
  return (await runGitCli(root, ["rev-parse", "HEAD"])).trim();
}

async function headTargetTreeEntry(root: string): Promise<GitTreeEntryBindingV1> {
  const raw = (
    await runGitCli(root, ["--literal-pathspecs", "ls-tree", "HEAD", "--", TARGET])
  ).trim();
  const [meta, observedPath] = raw.split("\t", 2);
  const [mode, type, sha] = (meta ?? "").split(" ");
  expect(type).toBe("blob");
  expect(observedPath).toBe(TARGET);
  return { canonicalPath: TARGET, blobSha: sha!, gitMode: mode as "100644" | "100755" };
}

async function headTargetIndexEntry(root: string): Promise<GitIndexEntryBindingV1> {
  const line = (
    await runGitCli(root, ["--literal-pathspecs", "ls-files", "--stage", "--", TARGET])
  ).trim();
  const [meta, observedPath] = line.split("\t", 2);
  const [mode, sha, stage] = meta!.split(" ");
  expect(observedPath).toBe(TARGET);
  return {
    canonicalPath: TARGET,
    blobSha: sha!,
    gitMode: mode as "100644" | "100755",
    stage: Number(stage) as 0,
  };
}

async function cleanTargetBindingAndGate(): Promise<{
  binding: ReviewTargetGitBinding;
  gate: ReturnType<typeof createReviewGateGit>;
}> {
  currentRoot = await initFixture();
  const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
  const binding = await gate.inspectTarget(TARGET);
  if (gate.classifyTargetClean(binding) !== "clean") {
    throw new Error("fixture target unexpectedly not clean");
  }
  return { binding, gate };
}

function mutationCommitInput(
  overrides: Partial<ReviewCommitPrepareInput> = {},
): ReviewCommitPrepareInput {
  return {
    gateId: "gate-task9",
    operationId: "op-commit",
    phase: "design",
    targetCanonicalPath: TARGET,
    allowedCommitTargetPath: TARGET,
    remediationRound: 2,
    lineageIds: ["PG-L-0042", "PG-L-0007"],
    expectedArtifactDigest: computeArtifactDigest(Buffer.from(TARGET_V2, "utf8")),
    expectedGitMode: "100644",
    ...overrides,
  };
}

type PreparedCommitPayload = Awaited<
  ReturnType<ReturnType<typeof createReviewGateGit>["prepareCommit"]>
>;

/** Dirty-target fixture with unrelated dirty+staged state; runs prepareCommit. */
async function preparedForDirtyTarget(): Promise<{
  provider: RecordingProvider;
  payload: PreparedCommitPayload;
}> {
  currentRoot = await initFixture();
  await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V2); // remediated bytes, unstaged
  await writeFile(`${currentRoot}/docs/a.md`, "a dirty\n");
  await writeFile(`${currentRoot}/docs/b.md`, "b staged\n");
  await runGitCli(currentRoot, ["add", "docs/b.md"]);
  const provider = createFsProvider(currentRoot);
  const gate = createReviewGateGit({ rootDir: currentRoot, provider });
  const payload = await gate.prepareCommit(mutationCommitInput());
  return { provider, payload };
}

describe("GIT1 — inspectTarget/classifyTargetClean on a real repo", () => {
  it("classifies a freshly committed target as clean with exact bindings", async () => {
    const { binding, gate } = await cleanTargetBindingAndGate();
    const head = await headShaOf(currentRoot);
    const treeEntry = await headTargetTreeEntry(currentRoot);
    const indexEntry = await headTargetIndexEntry(currentRoot);
    expect(binding.headSha).toBe(head);
    expect(binding.headEntry).toEqual(treeEntry);
    expect(binding.indexEntry).toEqual(indexEntry);
    expect(binding.worktree).toEqual({
      canonicalPath: TARGET,
      digest: computeArtifactDigest(Buffer.from(TARGET_V1, "utf8")),
      gitMode: "100644",
    });
    expect(gate.classifyTargetClean(binding)).toBe("clean");
  });

  it("treats worktree-only mode drift (owner execute bit) as not clean", async () => {
    currentRoot = await initFixture();
    await chmod(`${currentRoot}/:(glob)*.md`, 0o744); // bytes unchanged, owner exec set
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    const binding = await gate.inspectTarget(TARGET);
    expect(binding.worktree?.gitMode).toBe("100755");
    expect(gate.classifyTargetClean(binding)).toBe("not_clean");
  });

  it("normalizes POSIX 0655 over a 100755 tracked target as not clean", async () => {
    currentRoot = await initFixture();
    await chmod(`${currentRoot}/:(glob)*.md`, 0o744);
    await runGitCli(currentRoot, ["add", TARGET]);
    await runGitCli(currentRoot, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", "exec-baseline"]);
    await chmod(`${currentRoot}/:(glob)*.md`, 0o655); // owner exec dropped; g/o carry rx only
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    const binding = await gate.inspectTarget(TARGET);
    expect(binding.headEntry?.gitMode).toBe("100755");
    expect(binding.worktree?.gitMode).toBe("100644");
    expect(gate.classifyTargetClean(binding)).toBe("not_clean");
  });

  it("treats an index-only mode change as not clean", async () => {
    currentRoot = await initFixture();
    const blobSha = (
      await runGitCli(currentRoot, ["--literal-pathspecs", "ls-tree", "HEAD", "--", TARGET])
    )
      .split("\t", 2)[0]!
      .split(" ")[2]!;
    await runGitCli(currentRoot, ["update-index", "--index-info"], `100755 ${blobSha} 0\t${TARGET}\n`);
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    const binding = await gate.inspectTarget(TARGET);
    expect(binding.indexEntry?.gitMode).toBe("100755");
    expect(gate.classifyTargetClean(binding)).toBe("not_clean");
  });

  it("treats unmerged/multi-stage target index entries as not clean", async () => {
    currentRoot = await initFixture();
    const blobShaA = (await runGitCli(currentRoot, ["hash-object", "-w", "--stdin"], TARGET_V1)).trim();
    const blobShaB = (await runGitCli(currentRoot, ["hash-object", "-w", "--stdin"], TARGET_V2)).trim();
    await runGitCli(
      currentRoot,
      ["update-index", "--index-info"],
      `100644 ${blobShaA} 1\t${TARGET}\n100644 ${blobShaB} 3\t${TARGET}\n`,
    );
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    const binding = await gate.inspectTarget(TARGET);
    expect(binding.indexConflicted).toBe(true);
    expect(binding.indexEntry).toBeNull();
    expect(gate.classifyTargetClean(binding)).toBe("not_clean");
  });

  it("keeps unrelated dirty and staged paths allowed while the target stays clean", async () => {
    currentRoot = await initFixture();
    await writeFile(`${currentRoot}/docs/a.md`, "a dirty\n");
    await writeFile(`${currentRoot}/docs/b.md`, "b staged\n");
    await runGitCli(currentRoot, ["add", "docs/b.md"]);
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    const binding = await gate.inspectTarget(TARGET);
    expect(gate.classifyTargetClean(binding)).toBe("clean");
  });

  it("rejects non-canonical inspect paths and reports an untracked target as absent", async () => {
    currentRoot = await initFixture();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    await expect(gate.inspectTarget("../escape.md")).rejects.toThrow("review_scope_violation");
    await expect(gate.inspectTarget("/abs.md")).rejects.toThrow("review_scope_violation");
    await expect(gate.inspectTarget("docs/not-there.md")).resolves.toMatchObject({
      canonicalPath: "docs/not-there.md",
      headEntry: null,
      indexEntry: null,
      indexConflicted: false,
      worktree: null,
    });
  });
});

describe("GIT1 — exact-artifact commit", () => {
  it(
    "commits exactly the literal magic-path target with the exact message format, " +
      "skipping hooks and signing, preserving unrelated index/worktree state",
    async () => {
      const { provider, payload } = await preparedForDirtyTarget();
      const gate = createReviewGateGit({ rootDir: currentRoot, provider });
      const expectedMessage = buildReviewCommitMessage("design", 2, ["PG-L-0007", "PG-L-0042"]);
      expect(payload.commitMessage).toBe(expectedMessage);
      expect(payload.messageDigest).toBe(computeArtifactDigest(Buffer.from(expectedMessage, "utf8")));
      expect(expectedMessage).toBe(
        [
          "docs: address design review round 2",
          "",
          "Review-Gate: design",
          "Review-Round: 2",
          "Findings: PG-L-0007, PG-L-0042",
          "",
        ].join("\n"),
      );
      expect(payload.parentTargetEntry.gitMode).toBe("100644");
      expect(payload.expectedTargetEntry.gitMode).toBe("100644");
      expect(payload.preCommitIndexEntry).toEqual(await headTargetIndexEntry(currentRoot));
      const fingerprintBefore = await computeUnrelatedIndexFingerprint(currentRoot, TARGET);
      expect(payload.unrelatedIndexFingerprint).toBe(fingerprintBefore);

      const verified = await gate.executePreparedCommit(payload);
      expect(verified.changedPaths).toEqual([TARGET]);
      expect(verified.parentCommitId).toBe(payload.parentHeadSha);
      expect(verified.targetEntry.blobSha).toBe(payload.expectedTargetEntry.blobSha);
      expect(verified.targetEntry.gitMode).toBe("100644");

      const commitObject = await runGitCli(currentRoot, ["cat-file", "commit", "HEAD"]);
      expect(commitObject.includes("gpgsig")).toBe(false);
      expect(commitObject.includes("gate-task9")).toBe(false);
      expect(commitObject.includes("op-commit")).toBe(false);
      const separatorIndex = commitObject.indexOf("\n\n");
      expect(commitObject.slice(separatorIndex + 2)).toBe(expectedMessage);
      // hooks (and signing) never ran: the bomb hook has not produced its marker
      await expect(stat(`${currentRoot}/marker-hook-ran`)).rejects.toThrow();
      // the parent is exactly the fixture root commit
      expect(verified.parentCommitId).toBe(
        (await runGitCli(currentRoot, ["rev-list", "--max-parents=0", "HEAD"])).trim(),
      );
      // remediated bytes stay in the worktree and now match HEAD content
      expect((await readFile(`${currentRoot}/:(glob)*.md`)).toString("utf8")).toBe(TARGET_V2);
      // the unrelated index fingerprint is byte-identical before/after
      expect(await computeUnrelatedIndexFingerprint(currentRoot, TARGET)).toBe(fingerprintBefore);
      // unrelated worktree dirt and staged entries survive untouched
      const status = await runGitCli(currentRoot, ["status", "--porcelain"]);
      expect(status).toContain(" M docs/a.md");
      expect((await runGitCli(currentRoot, ["diff", "--cached", "--name-only"])).trim()).toBe("docs/b.md");
      expect(status).not.toContain("(glob)*.md");
    },
    30000,
  );

  it("preserves parentTargetEntry.gitMode == newCommitTargetEntry.gitMode for content remediation", async () => {
    const { provider, payload } = await preparedForDirtyTarget();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    const verified = await gate.executePreparedCommit(payload);
    expect(payload.parentTargetEntry.gitMode).toBe("100644");
    expect(verified.targetEntry.gitMode).toBe(payload.parentTargetEntry.gitMode);
  });

  it("rejects a commit scoped to a non-phase target (Requirements)", async () => {
    currentRoot = await initFixture();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    await expect(
      gate.prepareCommit({ ...mutationCommitInput(), targetCanonicalPath: "requirements.md" }),
    ).rejects.toThrow("review_commit_scope_violation");
  });

  it("rejects a commit when the target carries staged mode drift", async () => {
    currentRoot = await initFixture();
    await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V2);
    const blobSha = (await runGitCli(currentRoot, ["hash-object", "-w", "--stdin"], TARGET_V2)).trim();
    await runGitCli(currentRoot, ["update-index", "--index-info"], `100755 ${blobSha} 0\t${TARGET}\n`);
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    await expect(gate.prepareCommit(mutationCommitInput())).rejects.toThrow(
      "review_commit_scope_violation",
    );
  });

  it("rejects a commit prepared with a mode-changing expected entry (no mode commits)", async () => {
    currentRoot = await initFixture();
    await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V2);
    const gate = createReviewGateGit({ rootDir: currentRoot, provider: createFsProvider(currentRoot) });
    await expect(
      gate.prepareCommit(mutationCommitInput({ expectedGitMode: "100755" })),
    ).rejects.toThrow("review_commit_scope_violation");
  });

  it("maps a real git commit subprocess failure to review_commit_failed and keeps HEAD", async () => {
    const { provider, payload } = await preparedForDirtyTarget();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    const before = await headShaOf(currentRoot);
    await writeFile(`${currentRoot}/.git/index.lock`, ""); // deterministic real git failure
    try {
      await expect(gate.executePreparedCommit(payload)).rejects.toThrow("review_commit_failed");
    } finally {
      await rm(`${currentRoot}/.git/index.lock`, { force: true });
    }
    expect(await headShaOf(currentRoot)).toBe(before);
    expect((await readFile(`${currentRoot}/:(glob)*.md`)).toString("utf8")).toBe(TARGET_V2);
  });

  it("conflicts when HEAD moved between prepare and execute", async () => {
    const { provider, payload } = await preparedForDirtyTarget();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    await runGitCli(currentRoot, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", "external"]);
    await expect(gate.executePreparedCommit(payload)).rejects.toThrow(
      "review_commit_recovery_conflict",
    );
  });

  it("conflicts when the worktree no longer matches the prepared post-image bytes", async () => {
    const { provider, payload } = await preparedForDirtyTarget();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V3);
    await expect(gate.executePreparedCommit(payload)).rejects.toThrow(
      "review_commit_recovery_conflict",
    );
  });
});

describe("GIT1 — prepared commit recovery", () => {
  it("recovers the exact intended commit once after a simulated crash", async () => {
    const { provider, payload } = await preparedForDirtyTarget();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    await expect(gate.recoverPreparedCommit(payload)).resolves.toEqual({ status: "safe_to_reexecute" });
    const verified = await gate.executePreparedCommit(payload);
    await expect(gate.recoverPreparedCommit(payload)).resolves.toEqual({
      status: "recovered",
      commit: verified,
    });
    expect((await runGitCli(currentRoot, ["rev-list", "--count", "HEAD"])).trim()).toBe("2");
  });

  it("conflicts on a third-state HEAD during recovery", async () => {
    const { provider, payload } = await preparedForDirtyTarget();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    await runGitCli(currentRoot, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "--allow-empty", "-m", "external"]);
    await expect(gate.recoverPreparedCommit(payload)).rejects.toThrow(
      "review_commit_recovery_conflict",
    );
  });

  it("conflicts when the landed commit message diverges from the prepared digest", async () => {
    const { provider, payload } = await preparedForDirtyTarget();
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    const tampered = {
      ...payload,
      commitMessage: buildReviewCommitMessage("design", 2, ["PG-L-0007"]),
    };
    await expect(gate.executePreparedCommit(tampered)).rejects.toThrow(
      "review_commit_recovery_conflict",
    );
  });
});

  describe("WSP1 — exact workspace restore through the native exact-replace seam", () => {
  async function prepareRestoreFixture(
    options: Readonly<{ failReplaceWith?: string }> = {},
  ): Promise<{
    provider: RecordingProvider;
    gate: ReturnType<typeof createReviewGateGit>;
    input: ReviewRestorePrepareInput;
  }> {
    currentRoot = await initFixture();
    await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V2); // known dirty post-image bytes
    const provider = createFsProvider(currentRoot, options);
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    const inspected = await gate.inspectTarget(TARGET);
    const sourceWorktree: WorktreeArtifactBindingV1 = {
      canonicalPath: TARGET,
      digest: computeArtifactDigest(Buffer.from(TARGET_V2, "utf8")),
      gitMode: "100644",
    };
    const input: ReviewRestorePrepareInput = {
      gateId: "gate-task9",
      operationId: "op-restore",
      phase: "design",
      targetCanonicalPath: TARGET,
      allowedRestoreTargetPath: TARGET,
      sourceKnownDirtyBinding: {
        headSha: inspected.headSha!,
        headEntry: inspected.headEntry!,
        indexEntry: inspected.indexEntry!,
        worktree: sourceWorktree,
        sourceEventId: "evt-remediation-completed",
      },
      targetCleanCommittedBinding: {
        headSha: inspected.headSha!,
        headEntry: inspected.headEntry!,
        indexEntry: inspected.indexEntry!,
        worktree: {
          canonicalPath: TARGET,
          digest: computeArtifactDigest(Buffer.from(TARGET_V1, "utf8")),
          gitMode: "100644",
        },
      },
    };
    return { provider, gate, input };
  }

  it("restores known dirty exact source bytes to the exact clean committed destination", async () => {
    const { provider, gate, input } = await prepareRestoreFixture();
    await writeFile(`${currentRoot}/docs/a.md`, "a dirty\n");
    await writeFile(`${currentRoot}/docs/b.md`, "b staged\n");
    await runGitCli(currentRoot, ["add", "docs/b.md"]); // unrelated, must survive

    const payload = await gate.prepareRestore(input);
    expect(payload.sourceKnownDirtyBinding.sourceEventId).toBe("evt-remediation-completed");
    const result = await gate.executePreparedRestore(payload);
    expect(result.verified).toEqual({
      digest: computeArtifactDigest(Buffer.from(TARGET_V1, "utf8")),
      gitMode: "100644",
    });
    expect((await readFile(`${currentRoot}/:(glob)*.md`)).toString("utf8")).toBe(TARGET_V1);
    // unrelated dirty/staged paths untouched
    expect((await readFile(`${currentRoot}/docs/a.md`)).toString("utf8")).toBe("a dirty\n");
    expect((await runGitCli(currentRoot, ["diff", "--cached", "--name-only"])).trim()).toBe("docs/b.md");
    // exactly one native replace with the prepared source digest and target mode
    expect(provider.replaceCalls).toHaveLength(1);
    expect(provider.replaceCalls[0]?.path).toBe(TARGET);
    expect(provider.replaceCalls[0]?.expectedDigest).toBe(
      computeArtifactDigest(Buffer.from(TARGET_V2, "utf8")),
    );
    expect(provider.replaceCalls[0]?.replacementGitMode).toBe("100644");
    // target stays classified via git identity: HEAD/index entries unchanged by restore
    const after = await gate.inspectTarget(TARGET);
    expect(after.headEntry).toEqual(input.targetCleanCommittedBinding.headEntry);
    expect(gate.classifyTargetClean(after)).toBe("clean");
  });

  it("preserves existing POSIX permission bits of a 100644 target (no temp-file default)", async () => {
    const { gate, input } = await prepareRestoreFixture();
    // chmod makes the existing non-Git bits deterministic under any umask;
    // restore must inherit them (not a fresh temp-file default like 0o666).
    await chmod(`${currentRoot}/:(glob)*.md`, 0o662);
    await expect((await stat(`${currentRoot}/:(glob)*.md`)).mode & 0o7777).toBe(0o662);
    const payload = await gate.prepareRestore(input);
    await gate.executePreparedRestore(payload);
    expect((await stat(`${currentRoot}/:(glob)*.md`)).mode & 0o7777).toBe(0o662);
  });

  it("preserves 100755 executable target identity and its POSIX bits across restore", async () => {
    currentRoot = await initFixture();
    await chmod(`${currentRoot}/:(glob)*.md`, 0o744);
    await runGitCli(currentRoot, ["add", TARGET]);
    await runGitCli(currentRoot, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", "exec-baseline"]);
    await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V2); // dirty bytes, office mode unchanged
    const provider = createFsProvider(currentRoot);
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    const inspected = await gate.inspectTarget(TARGET);
    expect(inspected.headEntry?.gitMode).toBe("100755");
    const result = await gate.executePreparedRestore(
      await gate.prepareRestore({
        gateId: "gate-task9",
        operationId: "op-restore-exec",
        phase: "design",
        targetCanonicalPath: TARGET,
        allowedRestoreTargetPath: TARGET,
        sourceKnownDirtyBinding: {
          headSha: inspected.headSha!,
          headEntry: inspected.headEntry!,
          indexEntry: inspected.indexEntry!,
          worktree: {
            canonicalPath: TARGET,
            digest: computeArtifactDigest(Buffer.from(TARGET_V2, "utf8")),
            gitMode: "100755",
          },
          sourceEventId: "evt-remediation-completed",
        },
        targetCleanCommittedBinding: {
          headSha: inspected.headSha!,
          headEntry: inspected.headEntry!,
          indexEntry: inspected.indexEntry!,
          worktree: {
            canonicalPath: TARGET,
            digest: computeArtifactDigest(Buffer.from(TARGET_V1, "utf8")),
            gitMode: "100755",
          },
        },
      }),
    );
    expect((await readFile(`${currentRoot}/:(glob)*.md`)).toString("utf8")).toBe(TARGET_V1);
    // existing POSIX bits (0744) preserved, owner exec class kept for the 100755 identity
    expect((await stat(`${currentRoot}/:(glob)*.md`)).mode & 0o7777).toBe(0o744);
    expect(result.verified.gitMode).toBe("100755");
  });

  it("rejects a source Git-mode mismatch at prepare even when the bytes match", async () => {
    const { gate, input } = await prepareRestoreFixture();
    const wrongModeInput: ReviewRestorePrepareInput = {
      ...input,
      sourceKnownDirtyBinding: {
        ...input.sourceKnownDirtyBinding,
        worktree: { ...input.sourceKnownDirtyBinding.worktree, gitMode: "100755" },
      },
    };
    await expect(gate.prepareRestore(wrongModeInput)).rejects.toThrow(
      "review_restore_scope_violation",
    );
  });

  it("conflicts on content-equal mode drift during recovery and never chmod-restores", async () => {
    const { provider, gate, input } = await prepareRestoreFixture();
    const payload = await gate.prepareRestore(input);
    await chmod(`${currentRoot}/:(glob)*.md`, 0o744); // external mode drift; bytes unchanged
    await expect(gate.recoverPreparedRestore(payload)).rejects.toThrow(
      "review_restore_recovery_conflict",
    );
    // never overwrite/restore/chmod the target
    expect(provider.replaceCalls).toHaveLength(0);
    expect((await stat(`${currentRoot}/:(glob)*.md`)).mode & 0o7777).toBe(0o744);
  });

  it("conflicts on the normative 100755→0655 POSIX normalization during recovery", async () => {
    currentRoot = await initFixture();
    await chmod(`${currentRoot}/:(glob)*.md`, 0o744);
    await runGitCli(currentRoot, ["add", TARGET]);
    await runGitCli(currentRoot, ["-c", "core.hooksPath=/dev/null", "commit", "-q", "--no-gpg-sign", "-m", "exec-baseline"]);
    await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V2);
    const provider = createFsProvider(currentRoot);
    const gate = createReviewGateGit({ rootDir: currentRoot, provider });
    const inspected = await gate.inspectTarget(TARGET);
    expect(inspected.worktree?.gitMode).toBe("100755");
    const payload = await gate.prepareRestore({
      gateId: "gate-task9",
      operationId: "op-restore-normative",
      phase: "design",
      targetCanonicalPath: TARGET,
      allowedRestoreTargetPath: TARGET,
      sourceKnownDirtyBinding: {
        headSha: inspected.headSha!,
        headEntry: inspected.headEntry!,
        indexEntry: inspected.indexEntry!,
        worktree: {
          canonicalPath: TARGET,
          digest: computeArtifactDigest(Buffer.from(TARGET_V2, "utf8")),
          gitMode: "100755",
        },
        sourceEventId: "evt-remediation-completed",
      },
      targetCleanCommittedBinding: {
        headSha: inspected.headSha!,
        headEntry: inspected.headEntry!,
        indexEntry: inspected.indexEntry!,
        worktree: {
          canonicalPath: TARGET,
          digest: computeArtifactDigest(Buffer.from(TARGET_V1, "utf8")),
          gitMode: "100755",
        },
      },
    });
    await chmod(`${currentRoot}/:(glob)*.md`, 0o655); // POSIX 0655 normalizes to 100644
    await expect(gate.recoverPreparedRestore(payload)).rejects.toThrow(
      "review_restore_recovery_conflict",
    );
    expect(provider.replaceCalls).toHaveLength(0);
    expect((await stat(`${currentRoot}/:(glob)*.md`)).mode & 0o7777).toBe(0o655);
  });

  it.each(["docs/plans/requirements.md", "src/app.ts", "tests/a.test.ts", "justice.config.json"])(
    "refuses to restore Requirements/prod/tests/config-adjacent path %s",
    async (forbiddenPath) => {
      const { gate, input } = await prepareRestoreFixture();
      await expect(
        gate.prepareRestore({ ...input, targetCanonicalPath: forbiddenPath }),
      ).rejects.toThrow("review_restore_scope_violation");
    },
  );

  it("maps a native replace failure before verified destination to review_restore_failed", async () => {
    const { provider, gate, input } = await prepareRestoreFixture({ failReplaceWith: "boom" });
    const payload = await gate.prepareRestore(input);
    await expect(gate.executePreparedRestore(payload)).rejects.toThrow("review_restore_failed");
    // the dirty bytes were not replaced by the failing provider call
    expect((await readFile(`${currentRoot}/:(glob)*.md`)).toString("utf8")).toBe(TARGET_V2);
    expect(provider.replaceCalls).toHaveLength(1);
  });

  it("classifies prepared-restore recovery states: source, destination, conflict", async () => {
    const { provider, gate, input } = await prepareRestoreFixture();
    const payload = await gate.prepareRestore(input);
    // prepared restore + source state = safe re-execute
    await expect(gate.recoverPreparedRestore(payload)).resolves.toEqual({
      status: "safe_to_reexecute",
    });
    await gate.executePreparedRestore(payload);
    // prepared restore + destination state = recovered
    await expect(gate.recoverPreparedRestore(payload)).resolves.toEqual({ status: "recovered" });
    // any third state (external mutation of the restored bytes) = conflict
    await writeFile(`${currentRoot}/:(glob)*.md`, TARGET_V3);
    await expect(gate.recoverPreparedRestore(payload)).rejects.toThrow(
      "review_restore_recovery_conflict",
    );
    expect(provider.replaceCalls).toHaveLength(1); // execute only; recovery never rewrites
  });
});
