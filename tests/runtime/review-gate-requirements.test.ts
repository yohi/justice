import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeRepositoryIdentity,
  computeWorkspaceIdentity,
} from "../../src/core/review-gate/identity.js";
import type {
  ArtifactDigest,
  VerifiedTrackedArtifactIdentity,
} from "../../src/core/review-gate-types.js";
import {
  REQUIREMENTS_RESOLUTION_REQUIRED,
  RequirementsResolutionError,
  resolveRequirementsForAdmission,
} from "../../src/runtime/review-gate-requirements.js";

/**
 * Independent Git-tracked Requirements resolution at Review Gate admission
 * (Design §10.2.3): one locked workspace/Git snapshot must prove the selected
 * Requirements artifact is a real, tracked, clean, committed file that does
 * not alias the pinned Design or Plan artifact, and pin immutable V2
 * provenance. Every rejection fails closed with
 * `REQUIREMENTS_RESOLUTION_REQUIRED` and creates no gate state.
 */

const DESIGN_BODY = "# Design\n\n## Overview\ndesign content v1\n";
const MARKER_LINE =
  '<!-- justice-review-gate:requirements="docs/requirements/feature.md" -->';
const DESIGN_WITH_MARKER = `# Design\n\n${MARKER_LINE}\n\n## Overview\ndesign content v1\n`;
const PLAN_BODY = "# Plan\n\n## Steps\nplan content v1\n";
const REQUIREMENTS_BODY = "# Requirements\n\n- req safety\n- req correctness\n";

let rootDir = "";

function runGitCli(root: string, args: readonly string[]): Buffer {
  const result = spawnSync("git", [...args], {
    cwd: root,
    shell: false,
    encoding: "buffer",
  });
  if (result.status !== 0 || result.error != null) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString("utf8")}`);
  }
  return result.stdout;
}

function gitText(args: readonly string[]): string {
  return runGitCli(rootDir, args).toString("utf8").trim();
}

async function commitAll(message: string): Promise<string> {
  runGitCli(rootDir, ["add", "-A"]);
  runGitCli(rootDir, ["commit", "-q", "--no-gpg-sign", "-m", message]);
  return gitText(["rev-parse", "HEAD"]);
}

async function freshRepo(designBody: string): Promise<void> {
  rootDir = await mkdtemp(path.join(tmpdir(), "justice-req-resolver-"));
  await mkdir(path.join(rootDir, "docs", "requirements"), { recursive: true });
  await mkdir(path.join(rootDir, "docs", "plans"), { recursive: true });
  await writeFile(path.join(rootDir, "docs", "design.md"), designBody, "utf8");
  await writeFile(path.join(rootDir, "docs", "plans", "plan.md"), PLAN_BODY, "utf8");
  await writeFile(path.join(rootDir, "requirements.md"), REQUIREMENTS_BODY, "utf8");
  await writeFile(
    path.join(rootDir, "docs", "requirements", "feature.md"),
    REQUIREMENTS_BODY,
    "utf8",
  );
  runGitCli(rootDir, ["init", "-q"]);
  runGitCli(rootDir, ["config", "user.name", "Justice Test"]);
  runGitCli(rootDir, ["config", "user.email", "justice@example.invalid"]);
  await commitAll("init artifacts");
}

/**
 * Stand-in for the admission coordinator: builds the verified tracked
 * identity of one artifact from the current locked Git/workspace snapshot.
 */
async function trackedIdentity(canonicalPath: string): Promise<VerifiedTrackedArtifactIdentity> {
  const head = gitText(["rev-parse", "--verify", "HEAD"]);
  const tree = runGitCli(rootDir, ["ls-tree", "-z", head, "--", canonicalPath])
    .toString("utf8")
    .split("\0")
    .filter((record) => record.length > 0);
  const record = tree.find((entry) => entry.endsWith(`\t${canonicalPath}`));
  if (record === undefined) throw new Error(`no tree entry for ${canonicalPath}`);
  const [meta = "", entryPath = ""] = record.split("\t", 2);
  const [gitMode = "", type = "", blobSha = ""] = meta.split(" ");
  if (type !== "blob") throw new Error(`non-blob entry for ${canonicalPath}`);
  const blob = runGitCli(rootDir, ["cat-file", "blob", blobSha]);
  const stats = await lstat(path.join(rootDir, canonicalPath));
  const workspaceRootReal = await realpath(rootDir);
  const gitDirReal = await realpath(gitText(["rev-parse", "--absolute-git-dir"]));
  return {
    canonicalPath: entryPath,
    workspaceIdentity: computeWorkspaceIdentity(workspaceRootReal),
    repositoryIdentity: computeRepositoryIdentity(gitDirReal),
    gitBlobOid: blobSha,
    digest: createHash("sha256").update(blob).digest("hex") as ArtifactDigest,
    gitMode: gitMode === "100755" ? "100755" : "100644",
    fsIdentity: { device: stats.dev.toString(), inode: stats.ino.toString() },
  };
}

async function resolveRequirements(
  overrides: {
    explicitPath?: string;
    designOverride?: VerifiedTrackedArtifactIdentity;
    designBytes?: Uint8Array;
  } = {},
): Promise<Awaited<ReturnType<typeof resolveRequirementsForAdmission>>> {
  const design = overrides.designOverride ?? (await trackedIdentity("docs/design.md"));
  const plan = await trackedIdentity("docs/plans/plan.md");
  const designBytes =
    overrides.designBytes ?? (await readFile(path.join(rootDir, "docs", "design.md")));
  return resolveRequirementsForAdmission({
    workspaceRoot: rootDir,
    design,
    plan,
    designBytes,
    explicitPath: overrides.explicitPath,
  });
}

const blockedShape = {
  code: REQUIREMENTS_RESOLUTION_REQUIRED,
  name: "RequirementsResolutionError",
};

afterEach(async () => {
  if (rootDir !== "") {
    await rm(rootDir, { recursive: true, force: true });
    rootDir = "";
  }
});

describe("resolveRequirementsForAdmission", () => {
  it("accepts an independent committed Requirements file and pins V2 provenance", async () => {
    await freshRepo(DESIGN_BODY);
    const head = gitText(["rev-parse", "HEAD"]);
    const blobOid = gitText(["rev-parse", "HEAD:requirements.md"]);
    const requirementsBytes = await readFile(path.join(rootDir, "requirements.md"));
    const result = await resolveRequirements({ explicitPath: "requirements.md" });
    expect(result.schemaVersion).toBe(2);
    expect(result.source).toBe("explicit");
    expect(result.canonicalPath).toBe("requirements.md");
    expect(result.gitMode).toBe("100644");
    expect(result.requirementsGitBlobOid).toBe(blobOid);
    expect(result.requirementsGitBlobOid).toMatch(/^[0-9a-f]{40}$/);
    expect(result.committedBaselineOid).toBe(head);
    expect(result.digest).toBe(
      createHash("sha256").update(requirementsBytes).digest("hex"),
    );
    expect(result.workspaceIdentity).toBe(computeWorkspaceIdentity(await realpath(rootDir)));
    expect(result.selectionEvidence).toEqual({ commandPath: "requirements.md" });
  });

  it("resolves a unique valid Design declaration without a CLI path", async () => {
    await freshRepo(DESIGN_WITH_MARKER);
    const design = await trackedIdentity("docs/design.md");
    const featureBytes = await readFile(
      path.join(rootDir, "docs", "requirements", "feature.md"),
    );
    const result = await resolveRequirements();
    expect(result.schemaVersion).toBe(2);
    expect(result.source).toBe("design_declared_reference");
    expect(result.canonicalPath).toBe("docs/requirements/feature.md");
    expect(result.digest).toBe(createHash("sha256").update(featureBytes).digest("hex"));
    expect(result.selectionEvidence).toEqual({
      declaration: {
        designCanonicalPath: "docs/design.md",
        designDigest: design.digest,
        declarationLine: 3,
        declarationDigest: createHash("sha256").update(MARKER_LINE).digest("hex"),
        declaredCanonicalPath: "docs/requirements/feature.md",
      },
    });
  });

  it("records both evidence sources when the explicit CLI agrees with the declaration", async () => {
    await freshRepo(DESIGN_WITH_MARKER);
    const result = await resolveRequirements({
      explicitPath: "docs/requirements/feature.md",
    });
    expect(result.source).toBe("explicit");
    expect(result.selectionEvidence.commandPath).toBe("docs/requirements/feature.md");
    expect(result.selectionEvidence.declaration).toBeDefined();
    expect(result.selectionEvidence.declaration?.declaredCanonicalPath).toBe(
      "docs/requirements/feature.md",
    );
  });

  it("blocks explicit Requirements that alias the Design canonical path", async () => {
    await freshRepo(DESIGN_BODY);
    await expect(resolveRequirements({ explicitPath: "docs/design.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("blocks explicit Requirements that alias the Plan canonical path", async () => {
    await freshRepo(DESIGN_BODY);
    await expect(
      resolveRequirements({ explicitPath: "docs/plans/plan.md" }),
    ).rejects.toMatchObject(blockedShape);
  });

  it("blocks a distinct tracked path hardlinked to the Design artifact", async () => {
    await freshRepo(DESIGN_BODY);
    await rm(path.join(rootDir, "requirements.md"));
    await link(
      path.join(rootDir, "docs", "design.md"),
      path.join(rootDir, "requirements.md"),
    );
    await commitAll("requirements hardlinked to design");
    const design = await trackedIdentity("docs/design.md");
    const requirementsStats = await lstat(path.join(rootDir, "requirements.md"));
    // Preconditions: same inode, distinct tracked path, identical bytes.
    expect(requirementsStats.ino.toString()).toBe(design.fsIdentity.inode);
    expect(requirementsStats.dev.toString()).toBe(design.fsIdentity.device);
    await expect(resolveRequirements({ explicitPath: "requirements.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("blocks a distinct tracked path hardlinked to the Plan artifact", async () => {
    await freshRepo(DESIGN_BODY);
    await rm(path.join(rootDir, "requirements.md"));
    await link(
      path.join(rootDir, "docs", "plans", "plan.md"),
      path.join(rootDir, "requirements.md"),
    );
    await commitAll("requirements hardlinked to plan");
    await expect(resolveRequirements({ explicitPath: "requirements.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("accepts distinct files with identical bytes (equal digests are not aliasing)", async () => {
    await freshRepo(DESIGN_BODY);
    const designBytes = await readFile(path.join(rootDir, "docs", "design.md"));
    await writeFile(path.join(rootDir, "requirements.md"), designBytes);
    await commitAll("requirements with identical bytes");
    const design = await trackedIdentity("docs/design.md");
    const requirementsStats = await lstat(path.join(rootDir, "requirements.md"));
    const designStats = await lstat(path.join(rootDir, "docs", "design.md"));
    expect(requirementsStats.ino).not.toBe(designStats.ino);
    const result = await resolveRequirements({ explicitPath: "requirements.md" });
    expect(result.source).toBe("explicit");
    expect(result.canonicalPath).toBe("requirements.md");
    expect(result.digest).toBe(design.digest);
  });

  it("blocks a Requirements path that resolves through a symlinked directory onto the Design artifact", async () => {
    await freshRepo(DESIGN_BODY);
    await symlink("docs", path.join(rootDir, "docs-link"));
    // Git refuses to add pathspecs beyond an untracked symlink, so build the
    // literal index entry directly; the worktree file resolves through the
    // untracked symlink onto the pinned Design artifact.
    const designBlob = gitText(["rev-parse", "HEAD:docs/design.md"]);
    runGitCli(rootDir, [
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${designBlob},docs-link/design.md`,
    ]);
    runGitCli(rootDir, ["commit", "-q", "--no-gpg-sign", "-m", "requirements path through a directory symlink"]);
    await expect(
      resolveRequirements({ explicitPath: "docs-link/design.md" }),
    ).rejects.toMatchObject(blockedShape);
  });

  it("blocks a symlinked Requirements artifact whose target is outside the workspace", async () => {
    await freshRepo(DESIGN_BODY);
    await rm(path.join(rootDir, "requirements.md"));
    await symlink(
      path.join(tmpdir(), "justice-nonexistent-escape-target"),
      path.join(rootDir, "requirements.md"),
    );
    await commitAll("requirements as an escaping symlink");
    await expect(resolveRequirements({ explicitPath: "requirements.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("blocks a never-committed Requirements path", async () => {
    await freshRepo(DESIGN_BODY);
    await writeFile(path.join(rootDir, "docs", "new-requirements.md"), "untracked\n", "utf8");
    await expect(
      resolveRequirements({ explicitPath: "docs/new-requirements.md" }),
    ).rejects.toMatchObject(blockedShape);
  });

  it("blocks a dirty Requirements worktree", async () => {
    await freshRepo(DESIGN_BODY);
    await writeFile(path.join(rootDir, "requirements.md"), "# tampered\n", "utf8");
    await expect(resolveRequirements({ explicitPath: "requirements.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("blocks a staged Requirements change", async () => {
    await freshRepo(DESIGN_BODY);
    await writeFile(path.join(rootDir, "requirements.md"), "staged change\n", "utf8");
    runGitCli(rootDir, ["add", "requirements.md"]);
    await expect(resolveRequirements({ explicitPath: "requirements.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("blocks with the typed admission error when no Requirements source can be selected", async () => {
    await freshRepo(DESIGN_BODY);
    await expect(resolveRequirements()).rejects.toBeInstanceOf(RequirementsResolutionError);
    await expect(resolveRequirements()).rejects.toMatchObject(blockedShape);
  });

  it("blocks a malformed declaration even when an explicit path is supplied", async () => {
    await freshRepo(
      '# Design\n\n<!-- justice-review-gate:requirements="not a path" -->\n\n## Overview\nx\n',
    );
    await expect(resolveRequirements({ explicitPath: "requirements.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("blocks when the explicit path disagrees with the unique declaration", async () => {
    await freshRepo(DESIGN_WITH_MARKER);
    await expect(resolveRequirements({ explicitPath: "requirements.md" })).rejects.toMatchObject(
      blockedShape,
    );
  });

  it("pins the admission snapshot HEAD as H0, not the Requirements last-change commit", async () => {
    await freshRepo(DESIGN_BODY);
    await writeFile(path.join(rootDir, "docs", "notes.md"), "unrelated\n", "utf8");
    const admissionHead = await commitAll("unrelated second commit");
    const introducedBy = gitText([
      "log",
      "--diff-filter=A",
      "--format=%H",
      "--",
      "requirements.md",
    ]);
    expect(introducedBy).not.toBe(admissionHead);
    const blobOid = gitText(["rev-parse", "HEAD:requirements.md"]);
    const result = await resolveRequirements({ explicitPath: "requirements.md" });
    expect(result.committedBaselineOid).toBe(admissionHead);
    expect(result.requirementsGitBlobOid).toBe(blobOid);
  });

  it("blocks pinned identities that are not from the same locked workspace snapshot", async () => {
    await freshRepo(DESIGN_BODY);
    const design = await trackedIdentity("docs/design.md");
    const foreign: VerifiedTrackedArtifactIdentity = {
      ...design,
      workspaceIdentity: computeWorkspaceIdentity(path.join(rootDir, "not-the-workspace")),
    };
    await expect(
      resolveRequirements({ designOverride: foreign, explicitPath: "requirements.md" }),
    ).rejects.toMatchObject(blockedShape);
  });

  it("blocks when a pinned Design artifact is missing from the filesystem snapshot", async () => {
    await freshRepo(DESIGN_BODY);
    const design = await trackedIdentity("docs/design.md");
    const plan = await trackedIdentity("docs/plans/plan.md");
    const designBytes = await readFile(path.join(rootDir, "docs", "design.md"));
    await rm(path.join(rootDir, "docs", "design.md"));
    await expect(
      resolveRequirementsForAdmission({
        workspaceRoot: rootDir,
        design,
        plan,
        designBytes,
        explicitPath: "requirements.md",
      }),
    ).rejects.toMatchObject(blockedShape);
  });

  it("derives versioned deterministic workspace and repository identities", () => {
    expect(computeWorkspaceIdentity("/alpha")).toBe(computeWorkspaceIdentity("/alpha"));
    expect(computeWorkspaceIdentity("/alpha")).not.toBe(computeWorkspaceIdentity("/beta"));
    expect(computeWorkspaceIdentity("/alpha")).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRepositoryIdentity("/alpha/.git")).toMatch(/^[0-9a-f]{64}$/);
    expect(computeRepositoryIdentity("/alpha/.git")).not.toBe(
      computeWorkspaceIdentity("/alpha/.git"),
    );
  });
});
