/**
 * Independent Git-tracked Requirements resolution for Review Gate admission
 * (Design §10.2.3, DEP-04). Runs under admission ownership strictly before
 * `GATE_CREATED`: one locked workspace/Git snapshot proves the selected
 * Requirements artifact is a real, tracked, clean, committed regular file and
 * rejects any alias to the pinned Design or Plan artifact by exact canonical
 * path, symlink-safe resolved identity, or hardlink `(device,inode)` identity.
 * Equal content digests alone never prove aliasing, so distinct files with
 * identical bytes are accepted.
 *
 * Every failure fails closed with `REQUIREMENTS_RESOLUTION_REQUIRED` and no
 * gate event, reviewer dispatch or durable state is produced on rejection.
 */

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { gitModeFromOwnerExecBits } from "../core/review-gate/capabilities.js";
import {
  canonicalizeArtifactPath,
  computeArtifactDigest,
  computeRepositoryIdentity,
  computeWorkspaceIdentity,
} from "../core/review-gate/identity.js";
import {
  parseDesignRequirementsDeclaration,
  selectRequirementsSource,
} from "../core/review-gate/requirements-resolution.js";
import type {
  ArtifactDigest,
  RequirementsResolutionV2,
  VerifiedTrackedArtifactIdentity,
} from "../core/review-gate-types.js";
import { runGitLiteral } from "./review-gate-query.js";

/** Fail-closed admission denial code (Design §10.2.3 rule 5). */
export const REQUIREMENTS_RESOLUTION_REQUIRED = "REQUIREMENTS_RESOLUTION_REQUIRED";

/** Typed admission failure; never carries artifact bytes or absolute paths. */
export class RequirementsResolutionError extends Error {
  readonly code = REQUIREMENTS_RESOLUTION_REQUIRED;
  readonly detail: string;

  constructor(detail: string, cause?: unknown) {
    super(
      `${REQUIREMENTS_RESOLUTION_REQUIRED}: ${detail}`,
      cause === undefined ? undefined : { cause },
    );
    this.name = "RequirementsResolutionError";
    this.detail = detail;
  }
}

export type ResolveRequirementsForAdmissionInput = Readonly<{
  readonly workspaceRoot: string;
  readonly design: VerifiedTrackedArtifactIdentity;
  readonly plan: VerifiedTrackedArtifactIdentity;
  readonly designBytes: Uint8Array;
  readonly explicitPath?: string;
}>;

const OID_PATTERN = /^[0-9a-f]{40,64}$/u;
const textDecoder = new TextDecoder();

const isRegularGitMode = (mode: string): mode is "100644" | "100755" =>
  mode === "100644" || mode === "100755";

interface HeadTreeEntry {
  readonly gitMode: string;
  readonly blobSha: string;
}

function parseHeadTreeEntry(
  stdout: Buffer,
  canonicalPath: string,
): HeadTreeEntry | null {
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    const [meta = "", entryPath = ""] = record.split("\t", 2);
    if (entryPath !== canonicalPath) continue;
    const [gitMode = "", type = "", blobSha = ""] = meta.split(" ");
    if (type !== "blob") return null;
    return { gitMode, blobSha };
  }
  return null;
}

interface IndexStageEntry {
  readonly gitMode: string;
  readonly blobSha: string;
  readonly stage: number;
}

function parseIndexStageEntries(
  stdout: Buffer,
  canonicalPath: string,
): readonly IndexStageEntry[] {
  const entries: IndexStageEntry[] = [];
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    const [meta = "", entryPath = ""] = record.split("\t", 2);
    if (entryPath !== canonicalPath) continue;
    const [gitMode = "", blobSha = "", stage = "0"] = meta.split(" ");
    entries.push({ gitMode, blobSha, stage: Number(stage) });
  }
  return entries;
}

/** Runs `operation` and converts every unexpected failure into the typed admission denial. */
async function failClosed<T>(
  detail: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof RequirementsResolutionError) throw cause;
    throw new RequirementsResolutionError(detail, cause);
  }
}

async function gitSnapshotOutput(
  workspaceRootReal: string,
  args: readonly string[],
  failureDetail: string,
): Promise<Buffer> {
  const result = await failClosed(failureDetail, () =>
    runGitLiteral(workspaceRootReal, args),
  );
  if (result.code !== 0) {
    throw new RequirementsResolutionError(failureDetail);
  }
  return result.stdout;
}

/**
 * Resolve the authoritative Requirements artifact for Review Gate admission.
 *
 * The Requirements file and the pinned Design/Plan identities are inspected
 * against the same filesystem/Git snapshot: HEAD is pinned once (admission
 * baseline H0) and every tree/index/blob query is answered from that snapshot,
 * while the derived workspace/repository identities must match the pinned
 * Design/Plan identities. Rejection happens before any gate creation.
 */
export async function resolveRequirementsForAdmission(
  input: ResolveRequirementsForAdmissionInput,
): Promise<RequirementsResolutionV2> {
  const { design, plan } = input;

  // 1. Authoritative selector (Task 2): explicit CLI and/or unique declaration.
  const declaration = parseDesignRequirementsDeclaration(
    textDecoder.decode(input.designBytes),
  );
  const selection = selectRequirementsSource({
    explicitPath: input.explicitPath,
    declaration,
  });
  if (selection.kind === "blocked") {
    throw new RequirementsResolutionError(
      "no authoritative Requirements source could be selected",
    );
  }
  const canonicalPath = selection.canonicalPath;
  if (canonicalizeArtifactPath(canonicalPath) === null) {
    throw new RequirementsResolutionError(
      "the selected Requirements path is not a safe canonical workspace-relative path",
    );
  }

  // 2. Exact canonical-path aliasing against either pinned target.
  if (canonicalPath === design.canonicalPath) {
    throw new RequirementsResolutionError(
      "the Requirements canonical path aliases the pinned Design artifact",
    );
  }
  if (canonicalPath === plan.canonicalPath) {
    throw new RequirementsResolutionError(
      "the Requirements canonical path aliases the pinned Plan artifact",
    );
  }

  // 3. One locked snapshot: resolve the workspace, pin HEAD (H0) once, and
  //    require the pinned identities to belong to this same workspace/repository.
  const workspaceRootReal = await failClosed(
    "the workspace root cannot be resolved",
    () => realpath(input.workspaceRoot),
  );
  const committedBaselineOid = (
    await gitSnapshotOutput(
      workspaceRootReal,
      ["rev-parse", "--verify", "HEAD"],
      "the workspace has no committed HEAD snapshot",
    )
  )
    .toString("utf8")
    .trim();
  if (!OID_PATTERN.test(committedBaselineOid)) {
    throw new RequirementsResolutionError(
      "the admission HEAD is not a valid Git commit OID",
    );
  }
  const gitDir = (
    await gitSnapshotOutput(
      workspaceRootReal,
      ["rev-parse", "--absolute-git-dir"],
      "the repository identity cannot be resolved",
    )
  )
    .toString("utf8")
    .trim();
  const workspaceIdentity = await failClosed(
    "the workspace identity derivation failed",
    async () => computeWorkspaceIdentity(workspaceRootReal),
  );
  const repositoryIdentity = await failClosed(
    "the repository identity derivation failed",
    async () => computeRepositoryIdentity(await realpath(gitDir)),
  );
  if (
    workspaceIdentity !== design.workspaceIdentity ||
    workspaceIdentity !== plan.workspaceIdentity ||
    repositoryIdentity !== design.repositoryIdentity ||
    repositoryIdentity !== plan.repositoryIdentity
  ) {
    throw new RequirementsResolutionError(
      "the pinned Design/Plan identities are not from the same locked workspace snapshot",
    );
  }

  // 4. The pinned Design/Plan artifacts must exist in this same filesystem
  //    snapshot so resolved-identity aliasing can be checked safely.
  const designRealPath = await failClosed(
    "the pinned Design artifact is missing from the filesystem snapshot",
    () => realpath(path.join(workspaceRootReal, design.canonicalPath)),
  );
  const planRealPath = await failClosed(
    "the pinned Plan artifact is missing from the filesystem snapshot",
    () => realpath(path.join(workspaceRootReal, plan.canonicalPath)),
  );

  // 5. Requirements must be one real regular artifact inside the workspace.
  const absoluteRequirementsPath = path.join(workspaceRootReal, canonicalPath);
  const requirementsStats = await failClosed(
    "the Requirements artifact is missing from the workspace",
    () => lstat(absoluteRequirementsPath),
  );
  if (requirementsStats.isSymbolicLink() || !requirementsStats.isFile()) {
    throw new RequirementsResolutionError(
      "the Requirements artifact is not a real regular file",
    );
  }
  const fsIdentity = {
    device: requirementsStats.dev.toString(),
    inode: requirementsStats.ino.toString(),
  } as const;
  const requirementsRealPath = await failClosed(
    "the Requirements artifact cannot be resolved safely",
    () => realpath(absoluteRequirementsPath),
  );
  const workspacePrefix = `${workspaceRootReal}${path.sep}`;
  if (
    requirementsRealPath !== workspaceRootReal &&
    !requirementsRealPath.startsWith(workspacePrefix)
  ) {
    throw new RequirementsResolutionError(
      "the Requirements artifact resolves outside the workspace",
    );
  }
  // Symlink-safe resolved identity: even a distinct tracked path must not
  // resolve onto the pinned Design or Plan artifact through any symlink.
  if (requirementsRealPath === designRealPath) {
    throw new RequirementsResolutionError(
      "the Requirements artifact resolves onto the pinned Design artifact through a symlink",
    );
  }
  if (requirementsRealPath === planRealPath) {
    throw new RequirementsResolutionError(
      "the Requirements artifact resolves onto the pinned Plan artifact through a symlink",
    );
  }

  // 6. Hardlink (device,inode) aliasing against either pinned target. Equal
  //    content digests are deliberately not an aliasing test.
  if (
    fsIdentity.device === design.fsIdentity.device &&
    fsIdentity.inode === design.fsIdentity.inode
  ) {
    throw new RequirementsResolutionError(
      "the Requirements artifact is a hardlink alias of the pinned Design artifact",
    );
  }
  if (
    fsIdentity.device === plan.fsIdentity.device &&
    fsIdentity.inode === plan.fsIdentity.inode
  ) {
    throw new RequirementsResolutionError(
      "the Requirements artifact is a hardlink alias of the pinned Plan artifact",
    );
  }

  // 7. Same-snapshot Git proof: tracked, committed and clean at H0.
  const headEntry = parseHeadTreeEntry(
    await gitSnapshotOutput(
      workspaceRootReal,
      ["ls-tree", "-z", committedBaselineOid, "--", canonicalPath],
      "the committed Requirements tree entry cannot be read",
    ),
    canonicalPath,
  );
  if (headEntry === null) {
    throw new RequirementsResolutionError(
      "the Requirements path is not tracked in the committed snapshot",
    );
  }
  if (!isRegularGitMode(headEntry.gitMode)) {
    throw new RequirementsResolutionError(
      "the Requirements artifact has an unsupported Git mode",
    );
  }
  const indexEntries = parseIndexStageEntries(
    await gitSnapshotOutput(
      workspaceRootReal,
      ["ls-files", "--stage", "-z", "--", canonicalPath],
      "the Requirements index entry cannot be read",
    ),
    canonicalPath,
  );
  if (indexEntries.length !== 1) {
    throw new RequirementsResolutionError(
      "the Requirements path is untracked in the index or has a conflicted index state",
    );
  }
  const indexEntry = indexEntries[0];
  if (indexEntry === undefined || indexEntry.stage !== 0) {
    throw new RequirementsResolutionError(
      "the Requirements path has a conflicted index state",
    );
  }
  if (
    indexEntry.blobSha !== headEntry.blobSha ||
    indexEntry.gitMode !== headEntry.gitMode
  ) {
    throw new RequirementsResolutionError(
      "the staged Requirements identity differs from the committed snapshot",
    );
  }
  const requirementsBytes = await failClosed(
    "the Requirements artifact bytes cannot be read",
    () => readFile(absoluteRequirementsPath),
  );
  const digest = computeArtifactDigest(requirementsBytes);
  if (gitModeFromOwnerExecBits(requirementsStats.mode) !== headEntry.gitMode) {
    throw new RequirementsResolutionError(
      "the Requirements worktree Git mode differs from the committed snapshot",
    );
  }
  const committedBlob = await gitSnapshotOutput(
    workspaceRootReal,
    ["cat-file", "blob", headEntry.blobSha],
    "the committed Requirements blob cannot be read",
  );
  if (computeArtifactDigest(committedBlob) !== digest) {
    throw new RequirementsResolutionError(
      "the Requirements worktree bytes differ from the committed snapshot",
    );
  }

  // 8. Immutable V2 provenance (Design §10.2.4). Both evidence sources are
  //    recorded when the explicit CLI agrees with the unique declaration.
  const selectionEvidence: RequirementsResolutionV2["selectionEvidence"] = {
    ...(selection.source === "explicit" ? { commandPath: canonicalPath } : {}),
    ...(declaration.kind === "selected"
      ? {
          declaration: {
            designCanonicalPath: design.canonicalPath,
            designDigest: design.digest,
            declarationLine: declaration.line,
            declarationDigest: declaration.markerDigest as ArtifactDigest,
            declaredCanonicalPath: declaration.canonicalPath,
          },
        }
      : {}),
  };

  return {
    schemaVersion: 2,
    source: selection.source,
    canonicalPath,
    digest,
    gitMode: headEntry.gitMode,
    requirementsGitBlobOid: headEntry.blobSha,
    committedBaselineOid,
    workspaceIdentity,
    selectionEvidence,
  };
}
