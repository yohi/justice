/**
 * Task 2 — shared admission observation types and owned observer entry.
 *
 * The public `observeVerifiedAdmissionSnapshot` needs a durable `GATE_CREATED`
 * event to anchor design/plan paths and Requirements provenance. The owned
 * observer here is used by the admission coordinator while it already holds the
 * workspace/scope lock, so it can observe real current inputs directly: for an
 * enrolled scope it behaves like the public observer, and for a first-use
 * (genesis) admission it builds a snapshot from the verified first enrollment
 * and the current workspace/Git state without requiring a Gate to exist first.
 */

import { realpath } from "node:fs/promises";
import type {
  RequirementsResolutionV2,
ReviewArtifactBinding,
ReviewScopeId,
} from "../core/review-gate-types.js";
import type {
  ScopeEnrollmentV1,
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedScopeFrontier,
  VerifiedTargetWriterHandoffContinuationV1,
} from "../core/review-gate/types.js";
import type { VerifiedUpstreamReopenContextV1 } from "../core/review-gate/orchestrator.js";
import type {
  VerifiedAdmissionSnapshot,
  VerifiedNC1EligibleChangeV1,
  VerifiedNC1StopV1,
  VerifiedObservedRequirementsCandidate,
  VerifiedGateTip,
  VerifiedWorkspaceContinuityV1,
} from "../core/review-gate/admission.js";
import type { VerifiedNonConvergenceReentryValidationV1 } from "../core/review-gate/reentry.js";
import {
  canonicalizeArtifactPath,
  computeCanonicalJsonFingerprint,
  computeRepositoryIdentity,
  computeWorkspaceIdentity,
} from "../core/review-gate/identity.js";
import type {
  ReviewGateCommandResult,
  ReviewGateWorkspaceReader,
} from "./review-gate-coordinator.js";
import type {
  DurableReviewGateEventStore,
  VerifiedFirstEnrollment,
} from "./review-gate-event-store.js";
import type { ReviewGateProtocolDescriptor } from "./review-gate-protocol.js";
import { runGitLiteral } from "./review-gate-query.js";
import type { TrustedWitnessInstallationV1 } from "./review-gate-witness-contracts.js";
import type {
  PreparedWitnessPublicationV1,
  PublicationCommitInput,
  PublicationCommitResult,
} from "./review-gate-witness-contracts.js";
import type { WitnessTransaction } from "./review-gate-witness-context.js";
import {
  observeVerifiedAdmissionSnapshotObservation,
  pinTrackedArtifact,
  relationClosureProofDigest,
} from "./review-gate-admission-snapshot.js";
import { resolveRequirementsForAdmission } from "./review-gate-requirements.js";

/**
 * Non-serializable owned capability held by the admission coordinator while
 * `withAdmissionWitnessTransaction` owns the installation/scope/Gate guards.
 * The live instance is produced only by that entry point; every method
 * rejects use after the callback exit, and the assert methods reject scope/
 * Gate ids outside the owned lock set.
 */
export type AdmittedMembershipAuthorizationPayload = Readonly<{
  readonly installationId: string;
  readonly workspaceIdentity: string;
  readonly operationId: string;
  readonly expectedWorkspaceFrontier: string;
  readonly scope: ScopeEnrollmentV1;
}>;

/**
 * Non-serializable owned capability held by the admission coordinator while
 * `withAdmissionWitnessTransaction` owns the installation/scope/Gate guards.
 * The live instance is produced only by that entry point; every method
 * rejects use after the callback exit, and the assert methods reject scope/
 * Gate ids outside the owned lock set.
 */
export type AdmissionOwnedWitness = Readonly<{
  readonly read: () => Promise<WitnessTransaction>;
  readonly readVerifiedFrontier: () => Promise<VerifiedScopeFrontier>;
  readonly readFirstEnrollmentAuthority: () => Promise<VerifiedFirstEnrollmentAuthorityV1 | null>;
  readonly consumeFirstEnrollmentAuthority: (authorizationEventId: string) => Promise<void>;
  readonly readInstallation: () => Promise<TrustedWitnessInstallationV1>;
  readonly readVerifiedDesignBinding: (input: {
    readonly gateId: string;
    readonly designPath: string;
  }) => Promise<Readonly<{
    readonly treeSha: string;
    readonly blobSha: string;
    readonly gitMode: "100644" | "100755";
    readonly objectSize: number;
  }> | null>;
  readonly assertOwnedScope: (scopeId: string) => void;
  readonly assertOwnedGate: (gateId: string) => void;
  readonly preparePublication: (
    input: PreparedWitnessPublicationV1,
    bytes: Uint8Array,
  ) => Promise<"prepared" | "already_prepared">;
  readonly publishPreparedJournal: (publicationId: string) => Promise<void>;
  readonly commitPreparedPublicationCAS: (
    input: PublicationCommitInput,
  ) => Promise<PublicationCommitResult>;
  readonly recoverPreparedPublication: (
    publicationId: string,
  ) => Promise<PublicationCommitResult>;
  readonly signAdmittedMembership: (
    payload: AdmittedMembershipAuthorizationPayload,
  ) => Promise<string>;
}>;

/**
 * Runtime registry of live owned capabilities. The store refuses any value
 * that was never issued by `withAdmissionWitnessTransaction`; a structural
 * DTO alone is never ownership proof.
 */
const liveAdmissionOwnedWitnesses = new WeakSet<object>();
export function markAdmissionOwnedWitnessLive(owned: AdmissionOwnedWitness): void {
  liveAdmissionOwnedWitnesses.add(owned);
}
export function assertAdmissionOwnedWitnessLive(owned: AdmissionOwnedWitness): void {
  if (!liveAdmissionOwnedWitnesses.has(owned)) {
    throw new Error("review_gate_admission_owned_witness_invalid");
  }
}

/**
 * Internal result of one admission decision application. The admission
 * callback returns this union; only the outer coordinator converts RESULT/
 * BLOCK to the public command result. `MUTABLE_APPLICATION_YIELDED` marks the
 * Task 3 bridge where the callback released the admission lease before the
 * wider session guard chain; Task 5's executor replaces it with the
 * HANDOFF/TERMINAL continuations.
 */
export type ReviewGateAdmissionExecutionResult =
  | Readonly<{ kind: "RESULT"; result: ReviewGateCommandResult }>
  | Readonly<{
      kind: "BLOCK";
      reason: string;
      result: ReviewGateCommandResult;
    }>
  | Readonly<{
      kind: "HANDOFF_PENDING";
      continuation: VerifiedTargetWriterHandoffContinuationV1;
    }>
  | Readonly<{
      kind: "TERMINAL_INTENT_PREPARED_UNPUBLISHED";
      gateId: string;
      publicationId: string;
      terminalTransitionOperationId: string;
    }>
  | Readonly<{
      kind: "RESUME_ADMITTED";
      gateId: string;
      verifiedUpstreamReopen?: VerifiedUpstreamReopenContextV1;
    }>
  | Readonly<{ kind: "MUTABLE_APPLICATION_YIELDED" }>;

/**
 * Immutable product returned by the owned admission observer. The snapshot is
 * the same shape produced by the public observer; the Requirements resolution
 * carries the binding used to build it so the coordinator can keep authority
 * through the admission decision.
 */
export type ReviewGateAdmissionObservation = Readonly<{
  readonly snapshot: RuntimeVerifiedAdmissionSnapshot;
  readonly requirementsResolution: RequirementsResolutionV2;
  readonly lastVerifiedBinding: Extract<VerifiedGateTip, { readonly status: "active" | "suspended" }>["lastVerifiedBinding"] | null;
  readonly nc1Evidence: VerifiedNC1EvidenceBundleV1 | null;
}>;

export type RuntimeVerifiedAdmissionSnapshot = VerifiedEnrollmentAdmissionSnapshot &
  Readonly<{ readonly nc1Evidence: VerifiedNC1EvidenceBundleV1 | null }>;

export type VerifiedNC1EvidenceBundleV1 = Readonly<{
  readonly stop: VerifiedNC1StopV1;
  readonly change: VerifiedNC1EligibleChangeV1 | null;
  readonly validationOutcome: VerifiedNonConvergenceReentryValidationV1 | null;
  readonly frontierHash: string;
}>;

/**
 * Authority evidence supplied by the coordinator for a first-use admission.
 * `firstEnrollment` is non-null exactly when the requested scope has no Gate
 * history yet and must be admitted from the verified enrollment record.
 */
export type ReviewGateAdmissionAuthorityInput = Readonly<{
  readonly installation: TrustedWitnessInstallationV1;
  readonly frontier: VerifiedScopeFrontier;
  readonly firstEnrollment: VerifiedFirstEnrollment | null;
}>;

/**
 * The canonical design/plan paths (and optional explicit Requirements path)
 * under admission. These come from the coordinator request, not from a prior
 * Gate event.
 */
export type ReviewGateAdmissionObservationRequest = Readonly<{
  readonly designPath: string;
  readonly planPath: string;
  readonly explicitRequirementsPath?: string;
}>;

export type VerifiedAdmissionSnapshotOwnedOptions = Readonly<{
  readonly workspaceRoot: string;
  readonly scopeId: ReviewScopeId;
  readonly protocol: ReviewGateProtocolDescriptor;
  readonly eventStore: DurableReviewGateEventStore;
  readonly workspaceReader: ReviewGateWorkspaceReader;
  readonly owned: AdmissionOwnedWitness;
  readonly authority: ReviewGateAdmissionAuthorityInput;
  readonly request: ReviewGateAdmissionObservationRequest;
}>;

/**
 * A first-use admission snapshot carries the same shape as a regular admission
 * snapshot, but its `currentTips` are empty because no Gate has been created
 * yet and its `workspaceContinuity` carries the authorized first enrollment.
 */
export type VerifiedEnrollmentAdmissionSnapshot = VerifiedAdmissionSnapshot;

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

function buildTargetEnrollment(
  scopeId: ReviewScopeId,
  firstEnrollment: VerifiedFirstEnrollment,
): ScopeEnrollmentV1 {
  const authority = firstEnrollment.authorization.authority;
  return Object.freeze({
    scopeId,
    workflowContinuityId: firstEnrollment.workflowContinuityId,
    canonicalDesignPath: authority.canonicalDesignPath,
    canonicalPlanPath: authority.canonicalPlanPath,
    pathPairDigest: computeCanonicalJsonFingerprint({
      canonicalDesignPath: authority.canonicalDesignPath,
      canonicalPlanPath: authority.canonicalPlanPath,
    }),
    provenance: Object.freeze({
      kind: "verified_genesis" as const,
      evidenceDigest: authority.authorizationEventId,
      priorScopeId: null,
      priorGateId: null,
    }),
    gateMembership: Object.freeze([]),
  });
}

/**
 * Observe the verified admission snapshot for one scope using an owned witness
 * capability. Returns `null` when any evidence source is unresolvable.
 */
export async function observeVerifiedAdmissionSnapshotOwned(
  options: VerifiedAdmissionSnapshotOwnedOptions,
): Promise<ReviewGateAdmissionObservation | null> {
  try {
    const {
      workspaceRoot,
      scopeId,
      protocol,
      eventStore,
      workspaceReader,
      owned,
      authority,
      request,
    } = options;

    if (authority.firstEnrollment === null) {
      const observed = await observeVerifiedAdmissionSnapshotObservation({
        workspaceRoot,
        scopeId,
        protocol,
        eventStore,
        workspaceReader,
        owned,
        request,
      });
      return observed === null
        ? null
        : buildAdmissionObservation(observed.snapshot, observed.requirementsResolution);
    }

    const designPath = canonicalizeArtifactPath(request.designPath);
    const planPath = canonicalizeArtifactPath(request.planPath);
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
      explicitPath: request.explicitRequirementsPath,
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

    const enrollment = buildTargetEnrollment(scopeId, authority.firstEnrollment);
    const allEnrollments = Object.freeze([enrollment]);
    const workspaceContinuity = Object.freeze<VerifiedWorkspaceContinuityV1>({
      installationId: authority.frontier.workspaceEnrollmentId,
      workspaceIdentity: authority.frontier.workspaceIdentity,
      protectedInstallationFrontierHash: authority.frontier.globalFrontierHash,
      workspaceEnrollmentFrontierHash: authority.frontier.globalFrontierHash,
      registryVerificationEventId: authority.frontier.workspaceEnrollmentId,
      allEnrollments,
      relatedScopeTips: Object.freeze([]),
      relatedGateHistoryFrontierHash: authority.frontier.globalFrontierHash,
      authorizedFirstEnrollment: authority.firstEnrollment.authorization.authority,
      verifiedIndependentWorkflow: null,
      verifiedCrossScopePredecessor: null,
      relationClosureProofDigest: relationClosureProofDigest([]),
      coverage: "COMPLETE",
    });

    const snapshot = Object.freeze({
      workspaceIdentity: authority.frontier.workspaceIdentity,
      scopeId,
      verifiedFrontierHash: authority.frontier.globalFrontierHash,
      workspaceContinuity,
      currentTips: Object.freeze([]),
      nc1Observation: "NOT_INSPECTED",
      nc1Candidate: null,
      precedence: null,
      current,
    });

    return buildAdmissionObservation(snapshot, requirementsResolution);
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function buildAdmissionObservation(
  snapshot: VerifiedAdmissionSnapshot,
  requirementsResolution: RequirementsResolutionV2,
): ReviewGateAdmissionObservation {
  const unfinishedTip = snapshot.currentTips.find(
    (tip): tip is Extract<VerifiedGateTip, { readonly status: "active" | "suspended" }> =>
      tip.status === "active" || tip.status === "suspended",
  );
  const nc1Evidence =
    unfinishedTip?.status === "suspended" &&
    unfinishedTip.suspensionReason === "review_non_convergent" &&
    unfinishedTip.nc1Stop !== null
      ? Object.freeze({
          stop: unfinishedTip.nc1Stop,
          change: snapshot.nc1Candidate,
          validationOutcome: null,
          frontierHash: snapshot.verifiedFrontierHash,
        })
      : null;
  const runtimeSnapshot: RuntimeVerifiedAdmissionSnapshot = Object.freeze({
    ...snapshot,
    nc1Evidence,
  });
  return Object.freeze({
    snapshot: runtimeSnapshot,
    requirementsResolution,
    lastVerifiedBinding: unfinishedTip?.lastVerifiedBinding ?? null,
    nc1Evidence,
  });
}
