import { expect, expectTypeOf, it } from "vitest";
import type {
  CompletedApprovalBindingV1,
  DesignClearV1,
  EpochId,
  ExecutionSuspendedV1,
  FindingDiscoveredV1,
  FindingId,
  FindingRemediatedV1,
  FindingReopenedV1,
  FindingSelfReviewedV1,
  FindingState,
  GateCreatedV1,
  GateId,
  LineageId,
  OrchestrationResumedV1,
  PlanClearV1,
  RemediationRound,
  ReopenRequiredV1,
  ReviewArtifactBinding,
  ReviewGateEvent,
  ReviewGateState,
  ReviewGateStatus,
  ReviewApprovalBindingV1,
  ReviewNonConvergentV1,
  ReviewScopeId,
  RoundLimitExhaustedV1,
  WriterId,
} from "../../src/core/review-gate-types.js";

declare const reviewScopeId: ReviewScopeId;
declare const gateId: GateId;
declare const writerId: WriterId;
declare const epochId: EpochId;
declare const lineageId: LineageId;
declare const findingId: FindingId;
declare const digest: ReviewArtifactBinding["digest"];

export function buildTypeFixtures(): ReadonlyArray<ReviewGateEvent> {
  const common = { gateId, writerId, epochId, emittedAt: "2026-10-07T00:00:00.000Z" };
  const approvalBinding = {
    reviewScopeId,
    gateId,
    designArtifact: { canonicalPath: "design.md", digest, gitMode: "100644" },
    planArtifact: { canonicalPath: "plan.md", digest, gitMode: "100644" },
    requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest },
    reviewProtocolFingerprint: "review",
    designProtocolFingerprint: "design",
    planProtocolFingerprint: "plan",
    approvedAt: "2026-10-07T00:00:00.000Z",
  } satisfies ReviewApprovalBindingV1;
  const events = [
    { ...common, eventType: "GATE_CREATED", payload: { reviewScopeId, designArtifact: approvalBinding.designArtifact, planArtifact: approvalBinding.planArtifact, requirementsResolution: approvalBinding.requirementsResolution, reviewProtocolFingerprint: "review" } } satisfies GateCreatedV1,
    { ...common, eventType: "ORCHESTRATION_RESUMED", payload: { resumedAt: common.emittedAt } } satisfies OrchestrationResumedV1,
    { ...common, eventType: "DESIGN_CLEAR", payload: { designProtocolFingerprint: "design" } } satisfies DesignClearV1,
    { ...common, eventType: "PLAN_CLEAR", payload: { completedApprovalBinding: approvalBinding } } satisfies PlanClearV1,
    { ...common, eventType: "REOPEN_REQUIRED", payload: { phase: "design", lineageIds: [lineageId] } } satisfies ReopenRequiredV1,
    { ...common, eventType: "ROUND_LIMIT_EXHAUSTED", payload: { phase: "plan", roundLimit: 3 } } satisfies RoundLimitExhaustedV1,
    { ...common, eventType: "REVIEW_NON_CONVERGENT", payload: { phase: "design", lineageIds: [lineageId] } } satisfies ReviewNonConvergentV1,
    { ...common, eventType: "EXECUTION_SUSPENDED", payload: { reason: "execution suspended" } } satisfies ExecutionSuspendedV1,
    { ...common, eventType: "FINDING_DISCOVERED", payload: { lineageId, findingId, observedPhase: "design", ownerScope: "design", descriptionDigest: digest } } satisfies FindingDiscoveredV1,
    { ...common, eventType: "FINDING_REMEDIATED", payload: { lineageId, findingId, remediationRound: { phase: "design", ordinal: 1 } } } satisfies FindingRemediatedV1,
    { ...common, eventType: "FINDING_SELF_REVIEWED", payload: { lineageId, findingId, remediationRound: { phase: "design", ordinal: 1 } } } satisfies FindingSelfReviewedV1,
    { ...common, eventType: "FINDING_REOPENED", payload: { lineageId, findingId, reopenedBy: epochId } } satisfies FindingReopenedV1,
    { ...common, eventType: "COMPLETED_APPROVAL_BINDING", payload: { approvalBinding } } satisfies CompletedApprovalBindingV1,
  ] as const satisfies ReadonlyArray<ReviewGateEvent>;
  const sampleFinding: FindingState = {
    lineageId,
    findingId,
    observedPhase: "design",
    ownerScope: "design",
    descriptionDigest: digest,
    status: "open",
    remediationRound: null,
    reopenedBy: null,
  };
  const sampleRound: RemediationRound = { phase: "design", ordinal: 1 };
  const sampleState: ReviewGateState = {
    reviewScopeId,
    gateId,
    status: "active",
    phase: "design",
    epoch: { epochId, startedAt: common.emittedAt, reason: "gate_created" },
    designRemediationRounds: [sampleRound],
    planRemediationRounds: [],
    findings: new Map([[lineageId, sampleFinding]]),
    suspensionReason: null,
    approvalBinding: null,
    supersedesGateId: null,
  };
  void sampleState;
  return events;
}

it("Review Gate event types are discriminated and unique", () => {
  const eventTypes = ["GATE_CREATED", "ORCHESTRATION_RESUMED", "DESIGN_CLEAR", "PLAN_CLEAR", "REOPEN_REQUIRED", "ROUND_LIMIT_EXHAUSTED", "REVIEW_NON_CONVERGENT", "EXECUTION_SUSPENDED", "FINDING_DISCOVERED", "FINDING_REMEDIATED", "FINDING_SELF_REVIEWED", "FINDING_REOPENED", "COMPLETED_APPROVAL_BINDING"] as const;
  expect(new Set(eventTypes).size).toBe(eventTypes.length);
  expectTypeOf<(typeof eventTypes)[number]>().toEqualTypeOf<ReviewGateEvent["eventType"]>();
  expectTypeOf<Extract<ReviewGateEvent, { readonly eventType: "GATE_CREATED" }>>().not.toBeNever();
});

it("Review Gate status and snapshot types have the expected shape", () => {
  expectTypeOf<ReviewGateStatus>().toEqualTypeOf<"active" | "suspended" | "completed">();
  expectTypeOf<ReviewGateState["findings"]>().toEqualTypeOf<ReadonlyMap<LineageId, FindingState>>();
});
