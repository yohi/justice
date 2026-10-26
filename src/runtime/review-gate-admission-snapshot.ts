/**
 * Task 16 — read-only verified admission snapshot observation.
 *
 * `observeVerifiedAdmissionSnapshot` assembles the pure Core admission input
 * (`VerifiedAdmissionSnapshot`) from the Task 6 verified authority surface
 * (`readVerifiedScope`), the Task 7 pure tip projection, and one
 * independently observed current workspace context (artifact bytes, worktree
 * Git modes and the Runtime Requirements resolution of §10.2.3). The snapshot
 * is the sole decision input of Core `planReviewGateAdmission`: the runtime
 * approval lookup never performs an independent equality decision itself.
 *
 * The observation is strictly read-only: it never appends or publishes
 * events, never records dispatches and never takes a Gate, scope or workspace
 * lock. Every unresolvable evidence source (unreadable artifacts,
 * unprojectable histories, missing enrollment, Git snapshot failure) yields
 * `null` so callers fail closed instead of fabricating a `current` binding.
 */

import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  RequirementsResolutionV2,
ReviewArtifactBinding,
ReviewScopeId,
VerifiedTrackedArtifactIdentity,
} from "../core/review-gate-types";
import type {
  ScopeEnrollmentV1,
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedScopeFrontier,
} from "../core/review-gate/types";
import type { VerifiedReviewGateEvent } from "../core/review-gate/event-schema";
import { projectVerifiedGateTip } from "../core/review-gate/projection";
import type {
  VerifiedAdmissionPrecedenceV1,
  VerifiedAdmissionSnapshot,
  VerifiedGateTip,
  VerifiedObservedRequirementsCandidate,
  VerifiedWorkspaceContinuityV1,
} from "../core/review-gate/admission";
import {
  canonicalizeArtifactPath,
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  computeRepositoryIdentity,
  computeWorkspaceIdentity,
} from "../core/review-gate/identity";
import { gitModeFromOwnerExecBits } from "../core/review-gate/capabilities";
import type {
DurableReviewGateEventStore,
VerifiedScopeRead,
} from "./review-gate-event-store";
import type {
  AdmissionOwnedWitness,
  ReviewGateAdmissionObservationRequest,
} from "./review-gate-admission-context";
import type { ReviewGateProtocolDescriptor } from "./review-gate-protocol";
import type { ReviewGateWorkspaceReader } from "./review-gate-coordinator";
import { resolveRequirementsForAdmission } from "./review-gate-requirements";
import { runGitLiteral } from "./review-gate-query";

export type VerifiedAdmissionSnapshotOptions = Readonly<{
/** Absolute workspace root; only hashed identities and relative paths persist. */
readonly workspaceRoot: string;
/** The requested Review Gate scope id under admission. */
readonly scopeId: ReviewScopeId;
readonly protocol: ReviewGateProtocolDescriptor;
readonly eventStore: DurableReviewGateEventStore;
/** Workspace byte reader seam of the approval lookup. */
  readonly workspaceReader: ReviewGateWorkspaceReader;
  /** Non-serializable owned witness when the caller already holds the lock. */
  readonly owned?: AdmissionOwnedWitness;
  /**
   * Canonical request paths under admission. The explicit Requirements
   * selector is forwarded to the §10.2.3 resolution; omitted for the
   * history-derived read-only mode.
   */
  readonly request?: ReviewGateAdmissionObservationRequest;
}>;

/**
 * The verified admission snapshot for one scope, or `null` when the verified
 * snapshot cannot be observed (fail-closed; never a synthesized binding).
 */
export async function observeVerifiedAdmissionSnapshot(
  options: VerifiedAdmissionSnapshotOptions,
): Promise<VerifiedAdmissionSnapshot | null> {
  try {
    const observation = await observeSnapshot(options);
    return observation === null ? null : Object.freeze(observation.snapshot);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

/**
 * The verified admission snapshot plus the Requirements resolution used to
 * build it. The caller (e.g. the admission coordinator) needs the resolution
 * object to keep authority through the admission decision.
 */
export async function observeVerifiedAdmissionSnapshotObservation(
  options: VerifiedAdmissionSnapshotOptions,
): Promise<Readonly<{ snapshot: VerifiedAdmissionSnapshot; requirementsResolution: RequirementsResolutionV2 }> | null> {
  try {
    const observation = await observeSnapshot(options);
    return observation === null ? null : Object.freeze(observation);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}


async function observeSnapshot(
  options: VerifiedAdmissionSnapshotOptions,
): Promise<Readonly<{ snapshot: VerifiedAdmissionSnapshot; requirementsResolution: RequirementsResolutionV2 }> | null> {
  const { workspaceRoot, scopeId, protocol, eventStore, workspaceReader, owned } = options;
  // With an owned capability every read — the requested scope AND every
  // related scope — goes through the store's owned reader, which bypasses
  // the public serialize queue and never re-enters a witness guard.
  const readScope = owned
    ? (id: string) => eventStore.readVerifiedScopeOwned(owned, id)
    : (id: string) => eventStore.readVerifiedScope(id);

  const frontier = await owned?.readVerifiedFrontier();
  const scope: VerifiedScopeRead = frontier !== undefined &&
    !frontier.scopes.some((entry) => entry.scopeId === scopeId)
    ? { frontier, gateIds: [], eventsByGate: new Map() }
    : await readScope(scopeId);
  const enrollment =
    scope.frontier.scopes.find((entry) => entry.scopeId === scopeId) ?? null;
  if (scope.frontier.workspaceEnrollmentId.length === 0) return null;

  const targetTips = enrollment === null ? [] : projectScopeTips(scope.frontier, scopeId, scope);
  // Workspace continuity coverage is COMPLETE only when every enrolled
  // scope's tips participate: an unfinished related scope must block.
  const relatedTips: VerifiedGateTip[] = [...targetTips];
  for (const relatedEnrollment of enrollment === null ? [] : scope.frontier.scopes) {
    if (relatedEnrollment.scopeId === scopeId) continue;
    const relatedRead = await readScope(relatedEnrollment.scopeId);
    relatedTips.push(
      ...projectScopeTips(scope.frontier, relatedEnrollment.scopeId, relatedRead),
    );
  }

  const gateCreated = findV2GateCreated(scope);
  if (gateCreated === null && options.request === undefined) return null;
  const designPath = canonicalizeArtifactPath(
    gateCreated?.payload.designArtifact.canonicalPath ?? options.request?.designPath ?? "",
  );
  const planPath = canonicalizeArtifactPath(
    gateCreated?.payload.planArtifact.canonicalPath ?? options.request?.planPath ?? "",
  );
  if (designPath === null || planPath === null) return null;
  const designBytes = await workspaceReader.readWorkspaceFile(designPath);
  const planBytes = await workspaceReader.readWorkspaceFile(planPath);
  if (designBytes === null || planBytes === null) return null;

  const rootReal = await realpath(workspaceRoot);
  const committedBaselineOid = (
    await gitOutput(
      rootReal,
      ["rev-parse", "--verify", "HEAD"],
      "review_gate_admission_snapshot_head_unavailable",
    )
  )
    .toString("utf8")
    .trim();
  if (!OID_PATTERN.test(committedBaselineOid)) {
    throw new Error("review_gate_admission_snapshot_head_invalid");
  }
  const gitDir = (
    await gitOutput(
      rootReal,
      ["rev-parse", "--absolute-git-dir"],
      "review_gate_admission_snapshot_repository_unavailable",
    )
  )
    .toString("utf8")
    .trim();
  const workspaceIdentity = computeWorkspaceIdentity(rootReal);
  const repositoryIdentity = computeRepositoryIdentity(await realpath(gitDir));

  const design = await pinTrackedArtifact({
    rootReal,
    committedBaselineOid,
    canonicalPath: designPath,
    bytes: designBytes,
    workspaceIdentity,
    repositoryIdentity,
  });
  const plan = await pinTrackedArtifact({
    rootReal,
    committedBaselineOid,
    canonicalPath: planPath,
    bytes: planBytes,
    workspaceIdentity,
    repositoryIdentity,
  });

  const requirementsResolution = await resolveRequirementsForAdmission({
    workspaceRoot,
    design: design.identity,
    plan: plan.identity,
    designBytes,
    explicitPath: options.request?.explicitRequirementsPath,
  });

  const current = Object.freeze({
    requirements: Object.freeze<VerifiedObservedRequirementsCandidate>({
      source: requirementsResolution.source,
      workspaceIdentity: requirementsResolution.workspaceIdentity,
      canonicalPath: requirementsResolution.canonicalPath,
      digest: requirementsResolution.digest,
      gitMode: requirementsResolution.gitMode,
      gitBlobOid: requirementsResolution.requirementsGitBlobOid,
      observedCommitOid: requirementsResolution.committedBaselineOid,
      observationEvidenceId: computeCanonicalJsonFingerprint({
        canonicalPath: requirementsResolution.canonicalPath,
        committedBaselineOid: requirementsResolution.committedBaselineOid,
        digest: requirementsResolution.digest,
        gitBlobOid: requirementsResolution.requirementsGitBlobOid,
        gitMode: requirementsResolution.gitMode,
      }),
    }),
    design: Object.freeze<ReviewArtifactBinding>({
      canonicalPath: design.identity.canonicalPath,
      digest: design.identity.digest,
      gitMode: design.worktreeGitMode,
    }),
    plan: Object.freeze<ReviewArtifactBinding>({
      canonicalPath: plan.identity.canonicalPath,
      digest: plan.identity.digest,
      gitMode: plan.worktreeGitMode,
    }),
    globalProtocolFingerprint: protocol.reviewProtocolFingerprint,
    designProtocolFingerprint: protocol.designProtocolFingerprint,
    planProtocolFingerprint: protocol.planProtocolFingerprint,
  });

  const workspaceContinuity = Object.freeze<VerifiedWorkspaceContinuityV1>({
    installationId: scope.frontier.workspaceEnrollmentId,
    workspaceIdentity: scope.frontier.workspaceIdentity,
    protectedInstallationFrontierHash: scope.frontier.globalFrontierHash,
    workspaceEnrollmentFrontierHash: scope.frontier.globalFrontierHash,
    registryVerificationEventId: scope.frontier.workspaceEnrollmentId,
    allEnrollments: scope.frontier.scopes,
    relatedScopeTips: relatedTips,
    relatedGateHistoryFrontierHash: scope.frontier.globalFrontierHash,
    authorizedFirstEnrollment: enrollment === null
      ? await owned?.readFirstEnrollmentAuthority() ?? null
      : buildAuthorizedFirstEnrollment(
      scope.frontier,
      enrollment,
    ),
    verifiedIndependentWorkflow: null,
    verifiedCrossScopePredecessor: null,
    relationClosureProofDigest: relationClosureProofDigest(relatedTips),
    coverage: "COMPLETE",
  });

  const snapshot = Object.freeze({
    workspaceIdentity: scope.frontier.workspaceIdentity,
    scopeId,
    verifiedFrontierHash: scope.frontier.globalFrontierHash,
    workspaceContinuity,
    currentTips: targetTips,
    nc1Observation: "NOT_INSPECTED",
    nc1Candidate: null,
    precedence: buildPrecedence(targetTips, scope.frontier.globalFrontierHash),
    current,
  });

  return Object.freeze({ snapshot, requirementsResolution });
}

function buildPrecedence(
  targetTips: readonly VerifiedGateTip[],
  witnessFrontierHash: string,
): VerifiedAdmissionPrecedenceV1 | null {
  const tip = targetTips.find((t): t is Extract<VerifiedGateTip, { status: "active" | "suspended" }> =>
    t.status === "active" || t.status === "suspended");
  if (tip === undefined) return null;
  return Object.freeze({
    gateId: tip.gateId,
    generationId: tip.generationId,
    phase: tip.lastVerifiedBinding.ownDesignClear === null ? "design" : "plan",
    verifiedLineageFrontierHash: witnessFrontierHash,
    witnessFrontierHash,
    completeLineageSetDigest: computeCanonicalJsonFingerprint([]),
    currentStateProjectionEventId: tip.lastVerifiedBinding.admission.gateCreatedEventId,
    currentUpstreamBlockers: Object.freeze([]),
    pendingStaleLineages: Object.freeze([]),
    relationCompleteness: "COMPLETE",
  });
}

function projectScopeTips(
  frontier: VerifiedScopeFrontier,
  scopeId: string,
  read: VerifiedScopeRead,
): readonly VerifiedGateTip[] {
  return read.gateIds.map((gateId) =>
    projectVerifiedGateTip({
      gateId,
      scopeId,
      events: read.eventsByGate.get(gateId) ?? [],
      frontier,
    }),
  );
}

type V2GateCreatedEvent = Extract<
  VerifiedReviewGateEvent,
  { readonly schemaVersion: 2; readonly eventType: "GATE_CREATED" }
>;

const isV2GateCreatedEvent = (
  event: VerifiedReviewGateEvent,
): event is V2GateCreatedEvent =>
  "schemaVersion" in event && event.eventType === "GATE_CREATED";

/**
 * The first (deterministically ordered) Gate of the scope anchors the current
 * canonical artifact paths, Requirements provenance and protocol fingerprints.
 */
function findV2GateCreated(read: VerifiedScopeRead): V2GateCreatedEvent | null {
  for (const gateId of read.gateIds) {
    const events = read.eventsByGate.get(gateId) ?? [];
    const first = events[0];
    if (first !== undefined && isV2GateCreatedEvent(first)) return first;
  }
  return null;
}

/**
 * Genesis-scope first enrollment proof rebuilt from the verified enrollment
 * fields. The registry frontier carries no installation frontier of its own,
 * so the best-available installation identity is the workspace enrollment id
 * and both frontier hashes fall back to the global frontier hash.
 */
function buildAuthorizedFirstEnrollment(
  frontier: VerifiedScopeFrontier,
  enrollment: ScopeEnrollmentV1,
): VerifiedFirstEnrollmentAuthorityV1 | null {
  if (enrollment.provenance.kind !== "verified_genesis") return null;
  const genesisMembership = enrollment.gateMembership[0];
  if (genesisMembership === undefined) return null;
  return {
    installationId: frontier.workspaceEnrollmentId,
    workspaceIdentity: frontier.workspaceIdentity,
    canonicalDesignPath: enrollment.canonicalDesignPath,
    canonicalPlanPath: enrollment.canonicalPlanPath,
    authorizationOperationId: genesisMembership.admissionEventId,
    authenticatedProvisionerDigest: enrollment.provenance.evidenceDigest,
    verifiedAbsentPriorEnrollmentFrontierHash: frontier.globalFrontierHash,
    authorizationEventId: genesisMembership.admissionEventId,
  };
}

/** Canonical fingerprint over the sorted related tip identities. */
function relationClosureProofDigest(tips: readonly VerifiedGateTip[]): string {
  const identities = tips
    .map((tip) =>
      computeCanonicalJsonFingerprint({
        gateId: tip.gateId,
        generationId: tip.generationId,
        scopeId: tip.scopeId,
        status: tip.status,
      }),
    )
    .sort((left, right) => {
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
  return computeCanonicalJsonFingerprint(identities);
}

type PinnedTrackedArtifact = Readonly<{
  readonly identity: VerifiedTrackedArtifactIdentity;
  readonly worktreeGitMode: "100644" | "100755";
}>;

/**
 * Pin one tracked artifact identity against the single committed workspace
 * snapshot: the HEAD tree entry plus the worktree regular-file identity. The
 * worktree Git mode is reported separately so the observed context can carry
 * actual worktree state for admission comparisons.
 */
async function pinTrackedArtifact(input: Readonly<{
  readonly rootReal: string;
  readonly committedBaselineOid: string;
  readonly canonicalPath: string;
  readonly bytes: Buffer;
  readonly workspaceIdentity: string;
  readonly repositoryIdentity: string;
}>): Promise<PinnedTrackedArtifact> {
  const headEntry = parseBlobTreeEntry(
    await gitOutput(
      input.rootReal,
      ["ls-tree", "-z", input.committedBaselineOid, "--", input.canonicalPath],
      "review_gate_admission_snapshot_tree_unavailable",
    ),
    input.canonicalPath,
  );
  if (headEntry === null) {
    throw new Error("review_gate_admission_snapshot_artifact_untracked");
  }
  const stats = await lstat(path.join(input.rootReal, input.canonicalPath));
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("review_gate_admission_snapshot_artifact_not_regular");
  }
  return {
    identity: {
      canonicalPath: input.canonicalPath,
      workspaceIdentity: input.workspaceIdentity,
      repositoryIdentity: input.repositoryIdentity,
      gitBlobOid: headEntry.blobSha,
      digest: computeArtifactDigest(input.bytes),
      gitMode: headEntry.gitMode,
      fsIdentity: { device: stats.dev.toString(), inode: stats.ino.toString() },
    },
    worktreeGitMode: gitModeFromOwnerExecBits(stats.mode),
  };
}

interface GitTreeEntry {
  readonly gitMode: "100644" | "100755";
  readonly blobSha: string;
}

const isRegularGitMode = (mode: string): mode is "100644" | "100755" =>
  mode === "100644" || mode === "100755";

function parseBlobTreeEntry(
  stdout: Buffer,
  canonicalPath: string,
): GitTreeEntry | null {
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    const [meta = "", entryPath = ""] = record.split("\t", 2);
    if (entryPath !== canonicalPath) continue;
    const [gitMode = "", type = "", blobSha = ""] = meta.split(" ");
    if (type !== "blob") return null;
    if (!isRegularGitMode(gitMode)) return null;
    return { gitMode, blobSha };
  }
  return null;
}

const OID_PATTERN = /^[0-9a-f]{40,64}$/u;

async function gitOutput(
  rootReal: string,
  args: readonly string[],
  failureCode: string,
): Promise<Buffer> {
  const result = await runGitLiteral(rootReal, args);
  if (result.code !== 0) throw new Error(failureCode);
  return result.stdout;
}

export {
  buildAuthorizedFirstEnrollment,
  findV2GateCreated,
  pinTrackedArtifact,
  projectScopeTips,
  relationClosureProofDigest,
};
