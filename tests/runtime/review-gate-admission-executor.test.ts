import { describe, expect, it, vi } from "vitest";
import type { AdmissionDecision } from "../../src/core/review-gate/admission";
import type { ReviewScopeId } from "../../src/core/review-gate-types";
import type {
  AdmissionOwnedWitness,
  ReviewGateAdmissionExecutionResult,
  ReviewGateAdmissionObservation,
} from "../../src/runtime/review-gate-admission-context";
import { applyReviewGateAdmissionDecision } from "../../src/runtime/review-gate-admission-executor";

const result: ReviewGateAdmissionExecutionResult = {
  kind: "RESULT",
  result: {
    dispatched: true,
    gateId: "gate",
    guidance: "review started",
    designPath: "docs/design.md",
    planPath: "docs/plan.md",
    designDigest: "design-digest",
    planDigest: "plan-digest",
    lockPhase: "reviewing",
    completedReuse: false,
  },
};

const decisions = [
  { kind: "BLOCK", reason: "first_enrollment_unauthorized", detail: "blocked" },
  { kind: "REUSE_COMPLETED", gateId: "gate", generationId: "generation", approvalEventId: "approval", verifiedHistoryFrontier: "history" },
  { kind: "CREATE_GENESIS", workspaceIdentity: "workspace", scopeId: "scope" as ReviewScopeId, installationId: "installation", enrollmentAuthorizationEventId: "enrollment", verifiedWorkspaceFrontierHash: "frontier", completeRelationClosureDigest: "closure" },
  { kind: "CREATE_SUCCESSOR", scopeId: "scope" as ReviewScopeId, predecessorScopeId: "prior-scope", predecessorGateId: "prior-gate", predecessorApprovalEventId: "approval", predecessorRelationProofDigest: "relation", verifiedWorkspaceFrontierHash: "frontier" },
  { kind: "RESUME", gateId: "gate", generationId: "generation", witnessFrontierHash: "frontier" },
  { kind: "STAY_SUSPENDED", gateId: "gate", generationId: "generation", nc1StopEventId: null, witnessFrontierHash: "frontier" },
  { kind: "REVALIDATE_OR_BLOCK", gateId: "gate", generationId: "generation", dimension: "design", reason: "drift", predecessorProofRefs: ["proof"], witnessFrontierHash: "frontier" },
  { kind: "UPSTREAM_PRECEDENCE_REQUIRED", gateId: "gate", generationId: "generation", witnessFrontierHash: "frontier", blockers: [] },
  { kind: "STALE_LINEAGE_REVALIDATION_REQUIRED", gateId: "gate", generationId: "generation", witnessFrontierHash: "frontier", pending: [] },
  { kind: "INSPECT_NC1_ELIGIBLE_CHANGE", gateId: "gate", generationId: "generation", nc1StopEventId: "stop", phase: "design", witnessFrontierHash: "frontier" },
  { kind: "REENTRY_CANDIDATE", gateId: "gate", generationId: "generation", nc1StopEventId: "stop", changeObservedEventId: "change", witnessFrontierHash: "frontier" },
] satisfies readonly AdmissionDecision[];

const observation = Object.freeze({}) as ReviewGateAdmissionObservation;
const owned = Object.freeze({}) as AdmissionOwnedWitness;

describe("applyReviewGateAdmissionDecision", () => {
  it.each(decisions)("dispatches the exact $kind decision to its matching handler", async (decision) => {
    const handlers = {
      BLOCK: vi.fn(async (received: Extract<AdmissionDecision, { kind: "BLOCK" }>) => { expect(received).toBe(decision); return result; }),
      REUSE_COMPLETED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "REUSE_COMPLETED" }>) => { expect(received).toBe(decision); return result; }),
      CREATE_GENESIS: vi.fn(async (received: Extract<AdmissionDecision, { kind: "CREATE_GENESIS" }>) => { expect(received).toBe(decision); return result; }),
      CREATE_SUCCESSOR: vi.fn(async (received: Extract<AdmissionDecision, { kind: "CREATE_SUCCESSOR" }>) => { expect(received).toBe(decision); return result; }),
      RESUME: vi.fn(async (received: Extract<AdmissionDecision, { kind: "RESUME" }>) => { expect(received).toBe(decision); return result; }),
      STAY_SUSPENDED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "STAY_SUSPENDED" }>) => { expect(received).toBe(decision); return result; }),
      REVALIDATE_OR_BLOCK: vi.fn(async (received: Extract<AdmissionDecision, { kind: "REVALIDATE_OR_BLOCK" }>) => { expect(received).toBe(decision); return result; }),
      UPSTREAM_PRECEDENCE_REQUIRED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "UPSTREAM_PRECEDENCE_REQUIRED" }>) => { expect(received).toBe(decision); return result; }),
      STALE_LINEAGE_REVALIDATION_REQUIRED: vi.fn(async (received: Extract<AdmissionDecision, { kind: "STALE_LINEAGE_REVALIDATION_REQUIRED" }>) => { expect(received).toBe(decision); return result; }),
      INSPECT_NC1_ELIGIBLE_CHANGE: vi.fn(async (received: Extract<AdmissionDecision, { kind: "INSPECT_NC1_ELIGIBLE_CHANGE" }>) => { expect(received).toBe(decision); return result; }),
      REENTRY_CANDIDATE: vi.fn(async (received: Extract<AdmissionDecision, { kind: "REENTRY_CANDIDATE" }>) => { expect(received).toBe(decision); return result; }),
    };
    const actual = await applyReviewGateAdmissionDecision(
      { decision, observation, owned },
      handlers,
    );

    expect(actual).toBe(result);
    for (const [name, handler] of Object.entries(handlers)) {
      expect(handler).toHaveBeenCalledTimes(name === decision.kind ? 1 : 0);
      if (name === decision.kind) {
        expect(handler).toHaveBeenCalledWith(decision, observation, owned);
      }
    }
  });
});
