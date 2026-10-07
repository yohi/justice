import { describe, expect, it } from "vitest";
import {
  type CompletedApprovalBindingV1,
  type ArtifactDigest,
  type EpochId,
  type FindingDiscoveredV1,
  type FindingId,
  type FindingRemediatedV1,
  type FindingReopenedV1,
  type FindingSelfReviewedV1,
  type GateCreatedV1,
  type GateId,
  type LineageId,
  type ReviewApprovalBindingV1,
  type ReviewGateEvent,
  type ReviewScopeId,
  type WriterId,
  MAX_DESIGN_REMEDIATION_ROUNDS,
  MAX_PLAN_REMEDIATION_ROUNDS,
} from "../../src/core/review-gate-types.js";
import { getInitialReviewGateState, projectReviewGateState } from "../../src/core/review-gate-projection.js";

const gateId = "gate-1" as GateId;
const scopeId = "scope-1" as ReviewScopeId;
const writerId = "writer-1" as WriterId;
const epochId = "epoch-1" as EpochId;
const lineageId = "lineage-1" as LineageId;
const findingId = "finding-1" as FindingId;
const digest = "digest-1" as ArtifactDigest;
const round = { phase: "design", ordinal: 1 } as const;

const binding = {
  reviewScopeId: scopeId,
  gateId,
  designArtifact: { canonicalPath: "design.md", digest, gitMode: "100644" },
  planArtifact: { canonicalPath: "plan.md", digest, gitMode: "100644" },
  requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest },
  reviewProtocolFingerprint: "review",
  designProtocolFingerprint: "design",
  planProtocolFingerprint: "plan",
  approvedAt: "2026-10-07T00:00:03.000Z",
} satisfies ReviewApprovalBindingV1;

const created = {
  eventType: "GATE_CREATED",
  gateId,
  writerId,
  epochId,
  emittedAt: "2026-10-07T00:00:00.000Z",
  payload: {
    reviewScopeId: scopeId,
    designArtifact: binding.designArtifact,
    planArtifact: binding.planArtifact,
    requirementsResolution: binding.requirementsResolution,
    reviewProtocolFingerprint: "review",
  },
} satisfies GateCreatedV1;

function event<Event extends ReviewGateEvent>(
  eventType: Event["eventType"],
  payload: Event["payload"],
  emittedAt = "2026-10-07T00:00:01.000Z",
): Event {
  return { eventType, gateId, writerId, epochId, emittedAt, payload } as Event;
}

const discovered = event<FindingDiscoveredV1>("FINDING_DISCOVERED", {
  lineageId,
  findingId,
  observedPhase: "design",
  ownerScope: "design",
  descriptionDigest: digest,
});
const remediated = event<FindingRemediatedV1>("FINDING_REMEDIATED", { lineageId, findingId, remediationRound: round });
const selfReviewed = event<FindingSelfReviewedV1>("FINDING_SELF_REVIEWED", { lineageId, findingId, remediationRound: round });
const reopened = event<FindingReopenedV1>("FINDING_REOPENED", { lineageId, findingId, reopenedBy: "epoch-2" as EpochId });

describe("getInitialReviewGateState", () => {
  it("constructs the initial active design state from GATE_CREATED", () => {
    expect(getInitialReviewGateState(created)).toEqual({
      reviewScopeId: scopeId,
      gateId,
      status: "active",
      phase: "design",
      epoch: { epochId, startedAt: created.emittedAt, reason: "gate_created" },
      designRemediationRounds: [],
      planRemediationRounds: [],
      findings: new Map(),
      suspensionReason: null,
      approvalBinding: null,
      supersedesGateId: null,
    });
  });
});

describe("projectReviewGateState", () => {
  it("exports the Design and Plan remediation round budgets", () => {
    expect([MAX_DESIGN_REMEDIATION_ROUNDS, MAX_PLAN_REMEDIATION_ROUNDS]).toEqual([5, 3]);
  });

  it("rejects empty history", () => {
    expect(() => projectReviewGateState([])).toThrow("review_gate_empty_history");
  });

  it("requires GATE_CREATED as the first event", () => {
    expect(() => projectReviewGateState([event<ReviewGateEvent>("DESIGN_CLEAR", { designProtocolFingerprint: "design" })])).toThrow("review_gate_history_must_start_with_gate_created");
  });

  it("projects DESIGN_CLEAR into plan phase", () => {
    expect(projectReviewGateState([created, event("DESIGN_CLEAR", { designProtocolFingerprint: "design" })])).toMatchObject({ phase: "plan", status: "active" });
  });

  it("keeps PLAN_CLEAR in plan phase without completing", () => {
    expect(projectReviewGateState([created, event("DESIGN_CLEAR", { designProtocolFingerprint: "design" }), event("PLAN_CLEAR", { completedApprovalBinding: binding })])).toMatchObject({ phase: "plan", status: "active", approvalBinding: null });
  });

  it("completes on COMPLETED_APPROVAL_BINDING and replays an identical completion", () => {
    const complete = event<CompletedApprovalBindingV1>("COMPLETED_APPROVAL_BINDING", { approvalBinding: binding });
    expect(projectReviewGateState([created, complete, complete])).toMatchObject({ status: "completed", approvalBinding: binding });
  });

  it.each([
    ["REOPEN_REQUIRED", { phase: "design", lineageIds: [] }, "reopen_required"],
    ["ROUND_LIMIT_EXHAUSTED", { phase: "design", roundLimit: 5 }, "round_limit_exhausted"],
    ["REVIEW_NON_CONVERGENT", { phase: "design", lineageIds: [] }, "review_non_convergent"],
    ["EXECUTION_SUSPENDED", { reason: "suspended" }, "execution_suspended"],
  ] as const)("projects %s suspension", (type, payload, reason) => {
    const result = projectReviewGateState([created, event(type, payload)]);
    expect(result).toMatchObject({ status: "suspended", suspensionReason: reason });
  });

  it("resumes execution suspension and updates the epoch", () => {
    const resumed = event("ORCHESTRATION_RESUMED", { resumedAt: "ignored" }, "2026-10-07T00:00:02.000Z");
    expect(projectReviewGateState([created, event("EXECUTION_SUSPENDED", { reason: "x" }), resumed])).toMatchObject({
      status: "active",
      suspensionReason: null,
      epoch: { epochId, startedAt: resumed.emittedAt, reason: "orchestration_resumed" },
    });
  });

  it.each(["reopen_required", "round_limit_exhausted", "review_non_convergent"] as const)("does not resume %s suspension on ORCHESTRATION_RESUMED", (reason) => {
    const suspend = reason === "reopen_required"
      ? event("REOPEN_REQUIRED", { phase: "design", lineageIds: [] })
      : reason === "round_limit_exhausted"
        ? event("ROUND_LIMIT_EXHAUSTED", { phase: "design", roundLimit: 5 })
        : event("REVIEW_NON_CONVERGENT", { phase: "design", lineageIds: [] });
    expect(projectReviewGateState([created, suspend, event("ORCHESTRATION_RESUMED", { resumedAt: "ignored" })])).toMatchObject({ status: "suspended", suspensionReason: reason });
  });

  it("projects finding discovery, remediation, self-review, and reopening", () => {
    const state = projectReviewGateState([created, discovered, remediated, selfReviewed, reopened]);
    expect(state.findings.get(lineageId)).toMatchObject({ status: "reopened", remediationRound: round, reopenedBy: "epoch-2" });
    expect(state.designRemediationRounds).toEqual([round]);
  });

  it("resets reopen-required suspension when a finding is reopened", () => {
    expect(projectReviewGateState([created, discovered, event("REOPEN_REQUIRED", { phase: "design", lineageIds: [lineageId] }), reopened])).toMatchObject({ status: "active", suspensionReason: null });
  });

  it("rejects duplicate finding lineage", () => {
    expect(() => projectReviewGateState([created, discovered, discovered])).toThrow("review_gate_duplicate_lineage");
  });

  it.each([remediated, selfReviewed, reopened])("rejects unknown lineage for $eventType", (unknownFindingEvent) => {
    expect(() => projectReviewGateState([created, unknownFindingEvent])).toThrow("review_gate_unknown_lineage");
  });

  it("rejects conflicting completion bindings", () => {
    const otherBinding = { ...binding, approvedAt: "2026-10-08T00:00:00.000Z" };
    expect(() => projectReviewGateState([
      created,
      event<CompletedApprovalBindingV1>("COMPLETED_APPROVAL_BINDING", { approvalBinding: binding }),
      event<CompletedApprovalBindingV1>("COMPLETED_APPROVAL_BINDING", { approvalBinding: otherBinding }),
    ])).toThrow("review_gate_completed_binding_conflict");
  });

  it("rejects DESIGN_CLEAR outside design phase", () => {
    expect(() => projectReviewGateState([created, event("DESIGN_CLEAR", { designProtocolFingerprint: "design" }), event("DESIGN_CLEAR", { designProtocolFingerprint: "design" })])).toThrow("review_gate_design_clear_not_in_design_phase");
  });

  it("rejects PLAN_CLEAR outside plan phase", () => {
    expect(() => projectReviewGateState([created, event("PLAN_CLEAR", { completedApprovalBinding: binding })])).toThrow("review_gate_plan_clear_not_in_plan_phase");
  });

  it("records remediation rounds by phase and ordinal only once", () => {
    const anotherFinding = { ...discovered, payload: { ...discovered.payload, lineageId: "lineage-2" as LineageId, findingId: "finding-2" as FindingId } };
    const anotherRemediation = { ...remediated, payload: { ...remediated.payload, lineageId: "lineage-2" as LineageId, findingId: "finding-2" as FindingId } };
    const state = projectReviewGateState([created, discovered, remediated, selfReviewed, anotherFinding, anotherRemediation]);
    expect(state.designRemediationRounds).toEqual([round]);
  });

  it("tracks design and plan remediation rounds independently", () => {
    const planLineageId = "lineage-plan" as LineageId;
    const planFindingId = "finding-plan" as FindingId;
    const planRound = { phase: "plan", ordinal: 2 } as const;
    const planFinding = event<FindingDiscoveredV1>("FINDING_DISCOVERED", {
      lineageId: planLineageId,
      findingId: planFindingId,
      observedPhase: "plan",
      ownerScope: "plan",
      descriptionDigest: digest,
    });
    const planRemediation = event<FindingRemediatedV1>("FINDING_REMEDIATED", {
      lineageId: planLineageId,
      findingId: planFindingId,
      remediationRound: planRound,
    });
    const state = projectReviewGateState([created, discovered, remediated, planFinding, planRemediation]);
    expect(state.designRemediationRounds).toEqual([round]);
    expect(state.planRemediationRounds).toEqual([planRound]);
  });
});
