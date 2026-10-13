import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { tmpdir } from "node:os";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  buildReviewQueryScope,
  MAX_REVIEW_QUERY_MATCHES,
} from "../../src/core/review-gate/capabilities";
import type {
  ReviewQueryScope,
  VerifiedApprovedDesignReadBindingV1,
} from "../../src/core/review-gate/capabilities";
import { computeArtifactDigest } from "../../src/core/review-gate/identity";
import type {
  ReviewGateQueryService,
  ReviewWorkspaceReader,
  StoredGitSpawnCall,
} from "../../src/runtime/review-gate-query";
import { createReviewGateQueryService } from "../../src/runtime/review-gate-query";

const spawnRecorder = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[]; options?: { shell?: boolean; cwd?: string } }>,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const realSpawn: typeof actual.spawn = actual.spawn;
  const recording = ((command: string, args: readonly string[], options?: Record<string, unknown>) => {
    spawnRecorder.calls.push({
      command,
      args: [...args],
      options: options === undefined ? undefined : { shell: options.shell, cwd: options.cwd },
    });
    const spawn = realSpawn as unknown as (
      command: string,
      args: readonly string[],
      options?: Record<string, unknown>,
    ) => ReturnType<typeof realSpawn>;
    return spawn(command, args, options);
  }) as unknown as typeof actual.spawn;
  return { ...actual, spawn: recording };
});

let rootDir = "";
let repoReady = false;

async function runGitCli(root: string, ...args: readonly string[]): Promise<string> {
  // importActual bypasses the node:child_process mock used to record the
  // production runGitLiteral seam; the fixture helper must stay real.
  const cp = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const result = cp.spawnSync("git", [...args], { cwd: root, shell: false, encoding: "buffer" });
  if (result.status !== 0 || result.error != null) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString("utf8");
}

async function buildTestRepo(): Promise<string> {
  const root = await mkdtemp(`${tmpdir()}/justice-task9-query-`);
  await mkdir(`${root}/docs/plans`, { recursive: true });
  await writeFile(`${root}/requirements.md`, "requirements v1\n- req safety\n");
  await writeFile(`${root}/:(glob)*.md`, "design target v1\nreview target line\n");
  await writeFile(`${root}/docs/design.md`, "design v1\nreferenced by scopes\n");
  await writeFile(`${root}/docs/plans/plan.md`, "plan v1\nplan internal\n");
  await writeFile(path.join(root, "docs", "a.md"), "a v1\nunrelated a\n");
  await writeFile(path.join(root, "docs", "b.md"), "b v1\nunrelated b\n");
  await runGitCli(root, "init", "-q");
  await runGitCli(root, "config", "user.name", "Justice Test");
  await runGitCli(root, "config", "user.email", "justice@example.invalid");
  await runGitCli(root, "add", "-A");
  await runGitCli(root, "commit", "-q", "--no-gpg-sign", "-m", "init");
  // second commit touches the literal magic-path target plus an out-of-scope dirty path
  await writeFile(`${root}/:(glob)*.md`, "design target v2\nreview target line\n");
  await writeFile(path.join(root, "docs", "a.md"), "a v2\nunrelated a\n");
  await runGitCli(root, "add", "-A");
  await runGitCli(root, "commit", "-q", "--no-gpg-sign", "-m", "second");
  // third commit touches only docs/design.md
  await writeFile(path.join(root, "docs", "design.md"), "design v3\nreferenced by scopes\n");
  await runGitCli(root, "add", "-A");
  await runGitCli(root, "commit", "-q", "--no-gpg-sign", "-m", "third");
  return root;
}

const narrowWorkspaceReader = (root: string): ReviewWorkspaceReader => ({
  readWorkspaceFile: async (relativePath: string) => {
    if (relativePath.length === 0 || relativePath.startsWith("/") || relativePath.includes("..")) {
      return null;
    }
    try {
      return await readFile(path.join(root, relativePath));
    } catch {
      return null;
    }
  },
});

const designScope: ReviewQueryScope = buildReviewQueryScope("design", {
  requirementsCanonicalPath: "requirements.md",
  approvedDesignCanonicalPath: null,
  currentPhaseArtifactCanonicalPath: ":(glob)*.md",
});

const planScope: ReviewQueryScope = buildReviewQueryScope("plan", {
  requirementsCanonicalPath: "requirements.md",
  approvedDesignCanonicalPath: "docs/design.md",
  currentPhaseArtifactCanonicalPath: "docs/plans/plan.md",
});

const seamCalls = (): StoredGitSpawnCall[] =>
  spawnRecorder.calls.filter((call) => call.args[0] === "--literal-pathspecs");

beforeEach(async () => {
  spawnRecorder.calls.length = 0;
  if (!repoReady) {
    rootDir = await buildTestRepo();
    repoReady = true;
  }
});

afterAll(async () => {
  if (repoReady) {
    await rm(rootDir, { recursive: true, force: true });
  }
});

describe("ReviewGateQueryService CAP1 scope", () => {
  it("reads exact in-scope artifact bytes and denies out-of-scope reads", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    await expect(service.readArtifact(designScope, ":(glob)*.md")).resolves.toEqual(
      Buffer.from("design target v2\nreview target line\n"),
    );
    await expect(service.readArtifact(planScope, "docs/plans/plan.md")).resolves.toEqual(
      Buffer.from("plan v1\nplan internal\n"),
    );
    await expect(service.readArtifact(designScope, "docs/a.md")).rejects.toThrow(
      "review_scope_violation",
    );
    await expect(service.readArtifact(designScope, "../escape.md")).rejects.toThrow(
      "review_scope_violation",
    );
    await expect(service.readArtifact(designScope, "docs/design.md")).rejects.toThrow(
      "review_scope_violation",
    );
  });

  it("fails a missing in-scope artifact read as a transient query failure", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: { readWorkspaceFile: async () => null },
    });
    await expect(service.readArtifact(designScope, ":(glob)*.md")).rejects.toThrow(
      "review_query_failed",
    );
  });

  it("searches in-scope authorized bytes literally (no regex interpretation)", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    await expect(service.searchArtifact(designScope, ":(glob)*.md", "target v2")).resolves.toEqual([
      { line: 1, text: "design target v2" },
    ]);
    // "[review]" as a regex would match the "review" text line; a literal search must not
    await expect(service.searchArtifact(designScope, ":(glob)*.md", "[review]")).resolves.toEqual(
      [],
    );
    await expect(
      service.searchArtifact(designScope, "docs/a.md", "unrelated"),
    ).rejects.toThrow("review_scope_violation");
    await expect(service.searchArtifact(designScope, ":(glob)*.md", "")).rejects.toThrow(
      "review_query_failed",
    );
  });
});

describe("ReviewGateQueryService scoped git metadata", () => {
  it("returns only the literal magic-path target from scoped status", async () => {
    await writeFile(`${rootDir}/:(glob)*.md`, "design target dirty\nreview target line\n");
    await writeFile(`${rootDir}/docs/b.md`, "b dirty\n"); // unrelated dirty stays invisible
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    await expect(service.getScopedStatus(designScope)).resolves.toEqual({
      entries: [{ canonicalPath: ":(glob)*.md", indexState: " ", workingTreeState: "M" }],
    });
    expect(seamCalls().some((call) => call.args.includes("status"))).toBe(true);
    await runGitCli(rootDir, "--literal-pathspecs", "checkout", "-q", "--", ":(glob)*.md");
    await runGitCli(rootDir, "checkout", "-q", "--", "docs/b.md");
  });

  it("keeps scoped diff literal: magic target only, no unrelated dirty paths", async () => {
    await writeFile(`${rootDir}/:(glob)*.md`, "design target dirty-diff\nreview target line\n");
    await writeFile(`${rootDir}/docs/b.md`, "b dirty\n");
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    const diff = await service.getScopedDiff(designScope, { base: null, staged: false });
    expect(diff.changedPaths).toEqual([":(glob)*.md"]);
    expect(diff.text).toContain("+design target dirty-diff");
    expect(diff.text).not.toContain("a v2");
    expect(diff.text).not.toContain("b dirty");
    await runGitCli(rootDir, "--literal-pathspecs", "checkout", "-q", "--", ":(glob)*.md");
    await runGitCli(rootDir, "checkout", "-q", "--", "docs/b.md");
  });

  it("scopes diff against a resolved base revision without expansion", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    const diff = await service.getScopedDiff(designScope, {
      base: { kind: "head", depth: 2 },
      staged: false,
    });
    expect(diff.changedPaths).toEqual([":(glob)*.md"]);
    expect(diff.text).toContain("-design target v1");
    expect(diff.text).toContain("+design target v2");
    expect(diff.text).not.toContain("unrelated");
  });

  it("returns scoped diff over index-vs-HEAD staged state", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    await writeFile(`${rootDir}/:(glob)*.md`, "design target staged\n");
    await runGitCli(rootDir, "--literal-pathspecs", "add", ":(glob)*.md");
    const diff = await service.getScopedDiff(designScope, { base: null, staged: true });
    expect(diff.changedPaths).toEqual([":(glob)*.md"]);
    expect(diff.text).toContain("+design target staged");
    await runGitCli(rootDir, "--literal-pathspecs", "reset", "-q", "HEAD", "--", ":(glob)*.md");
    await runGitCli(rootDir, "--literal-pathspecs", "checkout", "-q", "--", ":(glob)*.md");
  });

  it("returns only scoped log entries for authorized paths", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    const entries = await service.getScopedLog(designScope, { base: null, limit: 10 });
    const summaries = entries.map((entry) => entry.summary);
    expect(summaries).toContain("init");
    expect(summaries).toContain("second");
    expect(summaries).not.toContain("third");

    const planEntries = await service.getScopedLog(planScope, { base: null, limit: 10 });
    const planSummaries = planEntries.map((entry) => entry.summary);
    expect(planSummaries).toContain("init");
    expect(planSummaries).toContain("third");
    expect(planSummaries).not.toContain("second");

    const limited = await service.getScopedLog(designScope, { base: null, limit: 1 });
    expect(limited.map((entry) => entry.summary)).toEqual(["second"]);

    const fromHead = await service.getScopedLog(designScope, {
      base: { kind: "head", depth: 2 },
      limit: 10,
    });
    expect(fromHead.map((entry) => entry.summary)).toEqual(["init"]);
    await expect(service.getScopedLog(designScope, { base: null, limit: 0 })).rejects.toThrow(
      "review_query_failed",
    );
  });

  it("resolves only Justice-defined revision refs (validated refs/oids)", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    const head = await service.resolveRevision({ kind: "head", depth: 0 });
    expect(head).toMatch(/^[0-9a-f]{40,64}$/);
    const head1 = await service.resolveRevision({ kind: "head", depth: 1 });
    const head2 = await service.resolveRevision({ kind: "head", depth: 2 });
    expect(head1).not.toBe(head);
    expect(head1).not.toBe(head2);
    await expect(service.resolveRevision({ kind: "object", objectId: head2 })).resolves.toBe(head2);
    await expect(
      service.resolveRevision({ kind: "object", objectId: "not-hex" }),
    ).rejects.toThrow("review_operation_not_permitted");
    await expect(
      service.resolveRevision({ kind: "object", objectId: "0".repeat(40) }),
    ).rejects.toThrow("review_operation_not_permitted");
  });

  it("reads a path at a revision via ls-tree -z then cat-file blob, never <ref>:<path>", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    const head = await service.resolveRevision({ kind: "head", depth: 0 });
    const head2 = await service.resolveRevision({ kind: "head", depth: 2 });
    await expect(
      service.showPathAtRevision(designScope, { kind: "head", depth: 2 }, ":(glob)*.md"),
    ).resolves.toEqual(Buffer.from("design target v1\nreview target line\n"));
    await expect(
      service.showPathAtRevision(designScope, { kind: "head", depth: 0 }, ":(glob)*.md"),
    ).resolves.toEqual(Buffer.from("design target v2\nreview target line\n"));

    const seam = seamCalls();
    const lsTreeCalls = seam.filter((call) => call.args.includes("ls-tree"));
    expect(lsTreeCalls).toHaveLength(2);
    expect(lsTreeCalls.map((call) => call.args)).toEqual([
      ["--literal-pathspecs", "ls-tree", "-z", head2, "--", ":(glob)*.md"],
      ["--literal-pathspecs", "ls-tree", "-z", head, "--", ":(glob)*.md"],
    ]);
    const catFileCalls = seam.filter((call) => call.args[1] === "cat-file");
    expect(catFileCalls.length).toBe(2);
    for (const call of catFileCalls) {
      expect(call.args.slice(0, 3)).toEqual(["--literal-pathspecs", "cat-file", "blob"]);
    }
    // no argv carries a <ref>:<path> revision string; the literal "(glob)*.md" argument is not one
    for (const call of seam) {
      for (const arg of call.args) {
        expect(/(?:HEAD[~^0-9]*|[0-9a-f]{40,64}):/u.test(arg)).toBe(false);
      }
    }
  });

  it("denies out-of-scope show reads with review_scope_violation", async () => {
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    await expect(
      service.showPathAtRevision(designScope, { kind: "head", depth: 0 }, "docs/a.md"),
    ).rejects.toThrow("review_scope_violation");
  });

  it("routes every git spawn through the single literal no-shell seam", async () => {
    await runGitCli(rootDir, "checkout", "-q", "--", "docs/b.md"); // remove prior dirty state
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    await service.getScopedStatus(designScope);
    await service.getScopedDiff(designScope, { base: null, staged: false });
    await service.getScopedLog(designScope, { base: null, limit: 10 });
    await service.showPathAtRevision(designScope, { kind: "head", depth: 0 }, ":(glob)*.md");

    const seam = seamCalls();
    expect(seam.length).toBeGreaterThan(0);
    for (const call of seam) {
      expect(call.command).toBe("git");
      expect(call.args[0]).toBe("--literal-pathspecs");
      expect(call.options?.shell).toBe(false);
      expect(call.options?.cwd).toBe(rootDir);
    }
    expect(spawnRecorder.calls.every((call) => call.command === "git")).toBe(true);
  });
});

describe("ReviewGateQueryService never mutates worktree or index", () => {
  it("leaves git status output identical around a full query round", async () => {
    const before = await runGitCli(rootDir, "status", "--porcelain");
    const service = createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });
    await service.readArtifact(designScope, ":(glob)*.md");
    await service.getScopedStatus(designScope);
    await service.getScopedDiff(designScope, { base: null, staged: false });
    await service.getScopedLog(designScope, { base: null, limit: 10 });
    await service.showPathAtRevision(designScope, { kind: "head", depth: 0 }, ":(glob)*.md");
    const after = await runGitCli(rootDir, "status", "--porcelain");
    expect(after).toBe(before);
  });
});


describe("ReviewGateQueryService approved Design binding (FDR-014)", () => {
  const APPROVED_CONTENT = [
    "approved design bytes",
    "anchor line",
    ...Array.from({ length: 250 }, (_, index) => `match line ${index}`),
    "",
  ].join("\n");

  let approvedBinding: VerifiedApprovedDesignReadBindingV1 | null = null;
  let headTreeOid = "";

  const asBinding = (): VerifiedApprovedDesignReadBindingV1 => {
    if (approvedBinding === null) throw new Error("approved fixture is not ready");
    return approvedBinding;
  };

  const approvedScope = (
    binding: VerifiedApprovedDesignReadBindingV1 | null,
  ): ReviewQueryScope =>
    buildReviewQueryScope(
      "plan",
      {
        // A Plan-phase scope admits only the approved Design and the current
        // Plan; the effective Requirements identity is validated in the proof.
        requirementsCanonicalPath: "",
        approvedDesignCanonicalPath: "docs/design.md",
        currentPhaseArtifactCanonicalPath: "docs/plans/plan.md",
      },
      { approvedDesign: binding },
    );

  const newService = (): ReviewGateQueryService =>
    createReviewGateQueryService({
      rootDir,
      workspaceReader: narrowWorkspaceReader(rootDir),
    });

  beforeAll(async () => {
    await writeFile(`${rootDir}/docs/design.md`, APPROVED_CONTENT);
    await runGitCli(rootDir, "add", "docs/design.md");
    await runGitCli(rootDir, "commit", "-q", "--no-gpg-sign", "-m", "approve design");
    const commitSha = (await runGitCli(rootDir, "rev-parse", "HEAD")).trim();
    const treeOid = (await runGitCli(rootDir, "rev-parse", `${commitSha}^{tree}`)).trim();
    const blobOid = (await runGitCli(rootDir, "rev-parse", `${commitSha}:docs/design.md`)).trim();
    const requirementsOid = (
      await runGitCli(rootDir, "rev-parse", `${commitSha}:requirements.md`)
    ).trim();
    const requirementsBytes = Buffer.from("requirements v1\n- req safety\n", "utf8");
    approvedBinding = {
      schemaVersion: 1,
      canonicalPath: "docs/design.md",
      designClearEventId: "evt-design-clear-1",
      currentAuthorityEventId: "evt-authority-1",
      committedTreeOid: treeOid,
      blobOid,
      gitMode: "100644",
      digest: computeArtifactDigest(Buffer.from(APPROVED_CONTENT, "utf8")),
      requirements: {
        canonicalPath: "requirements.md",
        gitBlobOid: requirementsOid,
        digest: computeArtifactDigest(requirementsBytes),
        gitMode: "100644",
      },
      phaseProtocolFingerprint: "plan-protocol-fingerprint-1",
      witnessFrontierHash: computeArtifactDigest(Buffer.from("witness-frontier-1", "utf8")),
    };
    // Diverge HEAD (a later commit) and then the dirty worktree from the
    // approved proof, so the assertions below hold against the frozen blob
    // only.
    await writeFile(`${rootDir}/docs/design.md`, "dirty design v1\nunapproved only\n");
    await runGitCli(rootDir, "add", "docs/design.md");
    await runGitCli(rootDir, "commit", "-q", "--no-gpg-sign", "-m", "tainted head");
    headTreeOid = (await runGitCli(rootDir, "rev-parse", "HEAD^{tree}")).trim();
    await writeFile(`${rootDir}/docs/design.md`, "dirty design v2\nunapproved only\n");
  });

  it("reads the exact proof-pinned blob bytes (never HEAD, index or dirty worktree)", async () => {
    const service = newService();
    await expect(
      service.readApprovedDesignArtifact({ approvedDesign: asBinding() }),
    ).resolves.toEqual(Buffer.from(APPROVED_CONTENT, "utf8"));
  });

  it("mediates the in-scope plan-scope read of the approved design path", async () => {
    const service = newService();
    await expect(
      service.readArtifact(approvedScope(asBinding()), "docs/design.md"),
    ).resolves.toEqual(Buffer.from(APPROVED_CONTENT, "utf8"));
  });

  it("serves bounded literal searches from approved bytes and never leaks dirty matches", async () => {
    const service = newService();
    await expect(
      service.searchApprovedDesignArtifact({ approvedDesign: asBinding(), pattern: "anchor" }),
    ).resolves.toEqual([{ line: 2, text: "anchor line" }]);
    // A dirty-worktree grep would match "unapproved only"; the approved
    // search must never leak it.
    await expect(
      service.searchApprovedDesignArtifact({
        approvedDesign: asBinding(),
        pattern: "unapproved only",
      }),
    ).resolves.toEqual([]);
    const bounded = await service.searchApprovedDesignArtifact({
      approvedDesign: asBinding(),
      pattern: "match line",
    });
    expect(bounded.length).toBe(MAX_REVIEW_QUERY_MATCHES);
    await expect(
      service.searchApprovedDesignArtifact({ approvedDesign: asBinding(), pattern: "" }),
    ).rejects.toThrow("review_query_failed");
  });

  it("rejects a digest mismatch and a malformed proof", async () => {
    const service = newService();
    await expect(
      service.readApprovedDesignArtifact({
        approvedDesign: { ...asBinding(), digest: "0".repeat(64) },
      }),
    ).rejects.toThrow("review_operation_not_permitted");
    await expect(
      service.readApprovedDesignArtifact({
        approvedDesign: { ...asBinding(), blobOid: "HEAD" },
      }),
    ).rejects.toThrow("review_operation_not_permitted");
  });

  it("rejects blob-OID and git-mode disagreements with the pinned tree", async () => {
    const service = newService();
    await expect(
      service.readApprovedDesignArtifact({
        approvedDesign: { ...asBinding(), blobOid: "1".repeat(64) },
      }),
    ).rejects.toThrow("review_operation_not_permitted: approved design binding mismatch");
    await expect(
      service.readApprovedDesignArtifact({
        approvedDesign: { ...asBinding(), gitMode: "100755" },
      }),
    ).rejects.toThrow("review_operation_not_permitted: approved design binding mismatch");
  });

  it("rejects a HEAD-derived snapshot and never resolves revision authority from HEAD", async () => {
    const service = newService();
    await expect(
      service.readApprovedDesignArtifact({
        approvedDesign: { ...asBinding(), committedTreeOid: headTreeOid },
      }),
    ).rejects.toThrow("review_operation_not_permitted: approved design binding mismatch");
    const seam = seamCalls();
    expect(seam.length).toBeGreaterThan(0);
    for (const call of seam) {
      for (const arg of call.args) {
        expect(arg.startsWith("HEAD")).toBe(false);
      }
    }
  });

  it("treats missing pinned Git objects as unavailable instead of head/worktree fallback", async () => {
    const service = newService();
    await expect(
      service.readApprovedDesignArtifact({
        approvedDesign: { ...asBinding(), committedTreeOid: "2".repeat(64) },
      }),
    ).resolves.toBeNull();
    await expect(
      service.readApprovedDesignArtifact({
        approvedDesign: { ...asBinding(), blobOid: "2".repeat(64) },
      }),
    ).rejects.toThrow("review_operation_not_permitted: approved design binding mismatch");
  });
});