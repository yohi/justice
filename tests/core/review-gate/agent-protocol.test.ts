import { describe, expect, it } from "vitest";
import {
  REVIEW_GATE_AGENT_CONTROLLER,
  REVIEW_GATE_AGENT_FINDING_VALIDATOR,
  REVIEW_GATE_AGENT_REMEDIATOR,
  REVIEW_GATE_AGENT_REVIEWER,
  REVIEW_GATE_PROMPT_CONTRACT_DIGEST_KEYS,
  REVIEW_GATE_STATIC_PROMPT_CONTRACTS,
  buildCrossGenerationReconciliationOperationPacket,
  buildFindingValidatorOperationPacket,
  buildLineageRevalidationOperationPacket,
  buildNonConvergenceReentryOperationPacket,
  buildRemediationOperationPacket,
  buildReviewerOperationPacket,
  buildSelfReviewOperationPacket,
  computeReviewGatePromptContractDigests,
  parseReviewGateOperationResult,
  staticPromptContractKeyForOperation,
  type ReviewGateResultParseOutcome,
} from "../../../src/core/review-gate/agent-protocol";

// ---------------------------------------------------------------------------
// Raw result JSON helpers. The worker raw output contract accepts a bare JSON
// object or the known OmO synchronous-task wrapper; everything else fails.
// ---------------------------------------------------------------------------

const BASE_ENVELOPE = {
  schemaVersion: 1,
  operationId: "op-1",
  gateId: "gate-1",
  phase: "design",
  reviewAttemptId: "attempt-1",
  remediationRound: null,
};

function rawResult(fields: Record<string, unknown>): string {
  return JSON.stringify(fields);
}

function wrappedResult(fields: Record<string, unknown>): string {
  return [
    "Task completed in 9s.",
    "",
    "Agent: Sisyphus-Junior (category: sp-final-review)",
    "Model: provider/model",
    "",
    "---",
    "",
    JSON.stringify(fields),
    "",
    "<task_metadata>",
    "session_id: ses_worker",
    "task_id: ses_worker",
    "subagent: Sisyphus-Junior",
    "category: sp-final-review",
    "</task_metadata>",
  ].join("\n");
}

function reviewCandidatesFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ENVELOPE,
    candidates: [
      {
        candidateId: "RG-001",
        severity: "major",
        summary: "Plan misses failure handling",
        location: "design.md:42",
      },
    ],
    ...overrides,
  };
}

function findingValidationFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ENVELOPE,
    candidateId: "RG-001",
    decision: "VALID",
    severity: "blocking",
    observedPhase: "design",
    semanticBasis: {
      violationType: "missing_error_handling",
      governingReference: "requirements.md:7",
      semanticLocation: "design.md:42",
      violatedContract: "concurrent-task-failure-recovery",
      ownerScope: "design",
    },
    relation: "EXISTING",
    existingLineageRef: "lineage-1",
    ...overrides,
  };
}

function selfReviewFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ENVELOPE,
    reviewAttemptId: null,
    remediationRound: { phase: "design", ordinal: 1 },
    targetLineageChecks: [{ lineageId: "lineage-1", result: "RESOLVED" }],
    discoveredFindings: [],
    ...overrides,
  };
}

function lineageRevalidationFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ENVELOPE,
    reviewAttemptId: null,
    lineageId: "lineage-1",
    result: "RESOLVED",
    ...overrides,
  };
}

function crossGenerationFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ENVELOPE,
    remediationRound: null,
    lineageId: "lineage-new",
    verdict: "NO_PRIOR_MATCH",
    ...overrides,
  };
}

function reentryFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ENVELOPE,
    reviewAttemptId: null,
    lineageId: null,
    outcome: "MATERIAL_PROGRESS",
    ...overrides,
  };
}

function remediationFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE_ENVELOPE,
    reviewAttemptId: null,
    remediationRound: { phase: "design", ordinal: 1 },
    targetPath: "docs/plan/design.md",
    outcome: "COMPLETED",
    summary: "Added failure handling section.",
    ...overrides,
  };
}

const CORRELATION_BASE = {
  operationId: "op-1",
  gateId: "gate-1",
  phase: "design" as const,
  reviewAttemptId: "attempt-1",
  remediationRound: null,
  dispatchSerial: 1,
};

// ---------------------------------------------------------------------------
// Static prompt contracts and digests
// ---------------------------------------------------------------------------

describe("review gate static prompt contracts", () => {
  it("keys digest contracts exactly as the design requires", () => {
    expect(REVIEW_GATE_PROMPT_CONTRACT_DIGEST_KEYS).toEqual([
      "designReviewer",
      "planReviewer",
      "findingValidator",
      "remediator",
      "selfReview",
    ]);
    expect(Object.keys(REVIEW_GATE_STATIC_PROMPT_CONTRACTS).sort()).toEqual([
      "designReviewer",
      "findingValidator",
      "planReviewer",
      "remediator",
      "selfReview",
    ]);
  });

  it("computes stable sha256 digests over the static contract texts only", () => {
    const first = computeReviewGatePromptContractDigests();
    const second = computeReviewGatePromptContractDigests();

    expect(first).toEqual(second);
    for (const key of REVIEW_GATE_PROMPT_CONTRACT_DIGEST_KEYS) {
      expect(first[key]).toMatch(/^[0-9a-f]{64}$/u);
    }
    // Static digest must exclude dynamic gate/attempt/round/artifact values:
    // no dynamic value appears in any static text.
    for (const text of Object.values(REVIEW_GATE_STATIC_PROMPT_CONTRACTS)) {
      expect(text).not.toContain("gate-1");
      expect(text).not.toContain("attempt-1");
      expect(text).not.toContain("op-1");
      expect(text).not.toContain("design.md");
      expect(text).not.toContain("deadbeef");
    }
  });

  it("keeps the contract texts and digest set frozen", () => {
    expect(Object.isFrozen(REVIEW_GATE_STATIC_PROMPT_CONTRACTS)).toBe(true);
    for (const text of Object.values(REVIEW_GATE_STATIC_PROMPT_CONTRACTS)) {
      expect(Object.isFrozen(text)).toBe(true);
    }
  });

  it("maps each operation kind to its static prompt contract key", () => {
    expect(staticPromptContractKeyForOperation("review_candidates", "design")).toBe("designReviewer");
    expect(staticPromptContractKeyForOperation("review_candidates", "plan")).toBe("planReviewer");
    expect(staticPromptContractKeyForOperation("finding_validation", "plan")).toBe("findingValidator");
    expect(staticPromptContractKeyForOperation("lineage_revalidation", "design")).toBe("findingValidator");
    expect(staticPromptContractKeyForOperation("cross_generation_reconciliation", "plan")).toBe(
      "findingValidator",
    );
    expect(staticPromptContractKeyForOperation("non_convergence_reentry", "design")).toBe(
      "findingValidator",
    );
    expect(staticPromptContractKeyForOperation("self_review", "plan")).toBe("selfReview");
    expect(staticPromptContractKeyForOperation("remediation", "design")).toBe("remediator");
  });
});

// ---------------------------------------------------------------------------
// Operation packet builders
// ---------------------------------------------------------------------------

const REQUIREMENTS_REF = {
  role: "requirements" as const,
  canonicalPath: "docs/plan/requirements.md",
  digest: "req-digest",
};
const DESIGN_REF = {
  role: "design" as const,
  canonicalPath: "docs/plan/design.md",
  digest: "design-digest",
};
const PLAN_REF = {
  role: "plan" as const,
  canonicalPath: "docs/plan/plan.md",
  digest: "plan-digest",
};

describe("reviewer operation packet builder", () => {
  it("builds a fresh design-reviewer packet with phase-scoped artifact pins", () => {
    const packet = buildReviewerOperationPacket({
      correlation: CORRELATION_BASE,
      artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      evidenceNotes: ["git status: clean"],
    });

    expect(packet.packetVersion).toBe(1);
    expect(packet.operation).toBe("review_candidates");
    expect(packet.expectedResultKind).toBe("review_candidates");
    expect(packet.workerAgent).toBe(REVIEW_GATE_AGENT_REVIEWER);
    expect(packet.freshContext).toBe(true);
    expect(packet.dispatchSerial).toBe(1);
    expect(packet.staticPromptContractKey).toBe("designReviewer");
    expect(packet.operationId).toBe("op-1");
    expect(packet.reviewAttemptId).toBe("attempt-1");
    expect(packet.remediationRound).toBeNull();
    expect(packet.workerPrompt).toContain(REVIEW_GATE_STATIC_PROMPT_CONTRACTS.designReviewer);
    expect(packet.workerPrompt).toContain("docs/plan/requirements.md");
    expect(packet.workerPrompt).toContain("docs/plan/design.md");
    expect(packet.workerPrompt).toContain("git status: clean");
  });

  it("builds a plan-reviewer packet against approved Design and Plan only", () => {
    const packet = buildReviewerOperationPacket({
      correlation: {
        ...CORRELATION_BASE,
        phase: "plan",
      },
      artifactRefs: [DESIGN_REF, PLAN_REF],
    });

    expect(packet.staticPromptContractKey).toBe("planReviewer");
    expect(packet.workerPrompt).toContain("docs/plan/plan.md");
  });

  it("rejects reviewer packets outside the exact phase scope", () => {
    expect(() =>
      buildReviewerOperationPacket({
        correlation: CORRELATION_BASE,
        artifactRefs: [DESIGN_REF, PLAN_REF],
      }),
    ).toThrowError(/phase_scope/);
    expect(() =>
      buildReviewerOperationPacket({
        correlation: CORRELATION_BASE,
        artifactRefs: [REQUIREMENTS_REF],
      }),
    ).toThrowError(/phase_scope/);
  });

  it("rejects reviewer packets without the fresh-review attempt context", () => {
    expect(() =>
      buildReviewerOperationPacket({
        correlation: { ...CORRELATION_BASE, reviewAttemptId: null },
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      }),
    ).toThrowError(/review_attempt_required/);
    expect(() =>
      buildReviewerOperationPacket({
        correlation: {
          ...CORRELATION_BASE,
          remediationRound: { phase: "design", ordinal: 1 },
        },
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      }),
    ).toThrowError(/remediation_round_forbidden/);
  });

  it("rejects reviewer packets with empty correlation or non-positive dispatch serial", () => {
    expect(() =>
      buildReviewerOperationPacket({
        correlation: { ...CORRELATION_BASE, operationId: "" },
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      }),
    ).toThrowError(/correlation_required/);
    expect(() =>
      buildReviewerOperationPacket({
        correlation: { ...CORRELATION_BASE, dispatchSerial: 0 },
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      }),
    ).toThrowError(/dispatch_serial/);
  });

  it("keeps the same logical operationId and increments dispatchSerial on redispatch", () => {
    const first = buildReviewerOperationPacket({
      correlation: {
        ...CORRELATION_BASE,
        dispatchSerial: 1,
        reviewAttemptId: "attempt-2",
      },
      artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
    });
    const redispatched = buildReviewerOperationPacket({
      correlation: {
        ...CORRELATION_BASE,
        dispatchSerial: 2,
        reviewAttemptId: "attempt-2",
      },
      artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
    });

    expect(redispatched.operationId).toBe(first.operationId);
    expect(redispatched.dispatchSerial).toBe(2);
    expect(redispatched.workerPrompt.length).toBeGreaterThan(0);
  });
});

describe("finding-validator operation packet builder", () => {
  const candidate = {
    candidateId: "RG-001",
    severity: "major" as const,
    summary: "Plan misses failure handling",
    location: "design.md:42",
  };

  it("builds a fresh validator packet with candidate, scoped pins, and opaque lineage refs", () => {
    const packet = buildFindingValidatorOperationPacket({
      correlation: CORRELATION_BASE,
      candidate,
      artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      opaqueExistingLineageRefs: ["lineage-1", "lineage-2"],
      evidenceNotes: [],
    });

    expect(packet.workerAgent).toBe(REVIEW_GATE_AGENT_FINDING_VALIDATOR);
    expect(packet.freshContext).toBe(true);
    expect(packet.expectedResultKind).toBe("finding_validation");
    expect(packet.staticPromptContractKey).toBe("findingValidator");
    // The validator receives the candidate observation plus opaque lineage
    // candidates, and never reviewer hidden reasoning: the packet payload
    // carries exactly the candidate fields, nothing else from the reviewer.
    expect(packet.workerPrompt).toContain('"candidateId":"RG-001"');
    expect(packet.workerPrompt).toContain('"severity":"major"');
    expect(packet.workerPrompt).toContain('"opaqueExistingLineageRefs":["lineage-1","lineage-2"]');
  });

  it("rejects validator packets missing the attempt or exceeding lineage ref bounds", () => {
    expect(() =>
      buildFindingValidatorOperationPacket({
        correlation: { ...CORRELATION_BASE, reviewAttemptId: null },
        candidate,
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
        opaqueExistingLineageRefs: [],
      }),
    ).toThrowError(/review_attempt_required/);
    expect(() =>
      buildFindingValidatorOperationPacket({
        correlation: CORRELATION_BASE,
        candidate: { ...candidate, candidateId: "" },
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
        opaqueExistingLineageRefs: [],
      }),
    ).toThrowError(/candidate_required/);
    expect(() =>
      buildFindingValidatorOperationPacket({
        correlation: CORRELATION_BASE,
        candidate,
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
        opaqueExistingLineageRefs: ["lineage-1", "lineage-1"],
      }),
    ).toThrowError(/opaque_lineage_ref/);
  });
});

describe("self-review operation packet builder", () => {
  it("builds a fresh self-review packet bound to the remediation round", () => {
    const packet = buildSelfReviewOperationPacket({
      correlation: {
        operationId: "op-sr-1",
        gateId: "gate-1",
        phase: "design",
        reviewAttemptId: null,
        remediationRound: { phase: "design", ordinal: 1 },
        dispatchSerial: 1,
      },
      targetLineageRefs: ["lineage-1"],
      existingLineageCandidateRefs: ["lineage-1", "lineage-2"],
      artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
    });

    expect(packet.workerAgent).toBe(REVIEW_GATE_AGENT_FINDING_VALIDATOR);
    expect(packet.freshContext).toBe(true);
    expect(packet.expectedResultKind).toBe("self_review");
    expect(packet.staticPromptContractKey).toBe("selfReview");
    expect(packet.remediationRound).toEqual({ phase: "design", ordinal: 1 });
  });

  it("rejects self-review packets without the remediation round context", () => {
    expect(() =>
      buildSelfReviewOperationPacket({
        correlation: { ...CORRELATION_BASE, remediationRound: null },
        targetLineageRefs: ["lineage-1"],
        existingLineageCandidateRefs: [],
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      }),
    ).toThrowError(/remediation_round_required/);
    expect(() =>
      buildSelfReviewOperationPacket({
        correlation: CORRELATION_BASE,
        targetLineageRefs: ["lineage-1"],
        existingLineageCandidateRefs: [],
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      }),
    ).toThrowError(/remediation_round_required/);
    expect(() =>
      buildSelfReviewOperationPacket({
        correlation: {
          operationId: "op-sr-1",
          gateId: "gate-1",
          phase: "design",
          reviewAttemptId: null,
          remediationRound: { phase: "design", ordinal: 1 },
          dispatchSerial: 1,
        },
        targetLineageRefs: ["lineage-1"],
        existingLineageCandidateRefs: [],
        artifactRefs: [DESIGN_REF, PLAN_REF],
      }),
    ).toThrowError(/phase_scope/);
  });
});

describe("lineage revalidation operation packet builder", () => {
  it("builds a fresh revalidation packet for exactly one opaque lineage", () => {
    const packet = buildLineageRevalidationOperationPacket({
      correlation: {
        operationId: "op-rv-1",
        gateId: "gate-1",
        phase: "design",
        reviewAttemptId: null,
        remediationRound: null,
        dispatchSerial: 1,
      },
      lineageId: "lineage-1",
      artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
    });

    expect(packet.workerAgent).toBe(REVIEW_GATE_AGENT_FINDING_VALIDATOR);
    expect(packet.freshContext).toBe(true);
    expect(packet.expectedResultKind).toBe("lineage_revalidation");
    expect(packet.workerPrompt).toContain('"lineageId":"lineage-1"');
  });
});

describe("cross-generation reconciliation operation packet builder", () => {
  it("builds a fresh reconciliation packet within the attempt context", () => {
    const packet = buildCrossGenerationReconciliationOperationPacket({
      correlation: CORRELATION_BASE,
      lineageId: "lineage-new",
      predecessorGateId: "gate-predecessor",
      eligiblePredecessorLineageRefs: ["prev-lineage-1"],
    });

    expect(packet.workerAgent).toBe(REVIEW_GATE_AGENT_FINDING_VALIDATOR);
    expect(packet.freshContext).toBe(true);
    expect(packet.expectedResultKind).toBe("cross_generation_reconciliation");
    expect(packet.reviewAttemptId).toBe("attempt-1");
    expect(packet.workerPrompt).toContain('"predecessorGateId":"gate-predecessor"');
  });

  it("rejects reconciliation packets without the attempt context or with duplicate refs", () => {
    expect(() =>
      buildCrossGenerationReconciliationOperationPacket({
        correlation: { ...CORRELATION_BASE, reviewAttemptId: null },
        lineageId: "lineage-new",
        predecessorGateId: "gate-predecessor",
        eligiblePredecessorLineageRefs: [],
      }),
    ).toThrowError(/review_attempt_required/);
    expect(() =>
      buildCrossGenerationReconciliationOperationPacket({
        correlation: CORRELATION_BASE,
        lineageId: "lineage-new",
        predecessorGateId: "gate-predecessor",
        eligiblePredecessorLineageRefs: ["prev-1", "prev-1"],
      }),
    ).toThrowError(/opaque_lineage_ref/);
  });
});

describe("non-convergence reentry operation packet builder", () => {
  it("builds a fresh reentry packet with changed artifacts and blocking refs", () => {
    const packet = buildNonConvergenceReentryOperationPacket({
      correlation: {
        operationId: "op-re-1",
        gateId: "gate-1",
        phase: "design",
        reviewAttemptId: null,
        remediationRound: null,
        dispatchSerial: 1,
      },
      changedArtifacts: [REQUIREMENTS_REF, DESIGN_REF],
      blockingLineageRefs: ["lineage-1"],
    });

    expect(packet.workerAgent).toBe(REVIEW_GATE_AGENT_FINDING_VALIDATOR);
    expect(packet.freshContext).toBe(true);
    expect(packet.expectedResultKind).toBe("non_convergence_reentry");
    expect(packet.workerPrompt).toContain('"blockingLineageRefs":["lineage-1"]');
  });

  it("rejects reentry packets outside the phase scope", () => {
    expect(() =>
      buildNonConvergenceReentryOperationPacket({
        correlation: {
          operationId: "op-re-1",
          gateId: "gate-1",
          phase: "design",
          reviewAttemptId: null,
          remediationRound: null,
          dispatchSerial: 1,
        },
        changedArtifacts: [DESIGN_REF, PLAN_REF],
        blockingLineageRefs: [],
      }),
    ).toThrowError(/phase_scope/);
  });
});

describe("remediation operation packet builder", () => {
  it("builds a remediator packet bound to the round writing only the target", () => {
    const packet = buildRemediationOperationPacket({
      correlation: {
        operationId: "op-rm-1",
        gateId: "gate-1",
        phase: "design",
        reviewAttemptId: "attempt-1",
        remediationRound: { phase: "design", ordinal: 2 },
        dispatchSerial: 1,
      },
      authorityArtifacts: [REQUIREMENTS_REF],
      targetArtifact: DESIGN_REF,
      evidenceNotes: ["git status: working tree dirty"],
    });

    expect(packet.workerAgent).toBe(REVIEW_GATE_AGENT_REMEDIATOR);
    expect(packet.freshContext).toBe(false);
    expect(packet.expectedResultKind).toBe("remediation");
    expect(packet.workerPrompt).toContain("docs/plan/design.md");
    expect(packet.workerPrompt).toContain("docs/plan/requirements.md");
    expect(packet.workerPrompt).toContain("git status: working tree dirty");
  });

  it("rejects remediation packets with wrong authority or target scope", () => {
    expect(() =>
      buildRemediationOperationPacket({
        correlation: {
          operationId: "op-rm-1",
          gateId: "gate-1",
          phase: "design",
          reviewAttemptId: null,
          remediationRound: { phase: "design", ordinal: 2 },
          dispatchSerial: 1,
        },
        authorityArtifacts: [DESIGN_REF],
        targetArtifact: DESIGN_REF,
      }),
    ).toThrowError(/phase_scope/);
    expect(() =>
      buildRemediationOperationPacket({
        correlation: {
          operationId: "op-rm-1",
          gateId: "gate-1",
          phase: "plan",
          reviewAttemptId: null,
          remediationRound: { phase: "plan", ordinal: 1 },
          dispatchSerial: 1,
        },
        authorityArtifacts: [DESIGN_REF],
        targetArtifact: REQUIREMENTS_REF,
      }),
    ).toThrowError(/target_phase/);
    expect(() =>
      buildRemediationOperationPacket({
        correlation: {
          operationId: "op-rm-1",
          gateId: "gate-1",
          phase: "design",
          reviewAttemptId: null,
          remediationRound: null,
          dispatchSerial: 1,
        },
        authorityArtifacts: [REQUIREMENTS_REF],
        targetArtifact: DESIGN_REF,
      }),
    ).toThrowError(/remediation_round_required/);
  });
});

// ---------------------------------------------------------------------------
// Strict result parsers
// ---------------------------------------------------------------------------

describe("review candidates result parser", () => {
  it("accepts a strict result and freezes the parsed snapshot", () => {
    const outcome = parseReviewGateOperationResult(
      "review_candidates",
      rawResult(reviewCandidatesFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );

    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.result.candidates).toEqual([
        { candidateId: "RG-001", severity: "major", summary: "Plan misses failure handling", location: "design.md:42" },
      ]);
      expect(Object.isFrozen(outcome.result)).toBe(true);
      expect(Object.isFrozen(outcome.result.candidates)).toBe(true);
      expect(Object.isFrozen(outcome.result.candidates[0])).toBe(true);
    }
  });

  it("accepts the known OmO synchronous-task completion wrapper", () => {
    const outcome = parseReviewGateOperationResult(
      "review_candidates",
      wrappedResult(reviewCandidatesFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome.kind).toBe("accepted");
  });

  it("discards arbitrary prose wrappers even when they contain JSON", () => {
    const outcome = parseReviewGateOperationResult(
      "review_candidates",
      `review done\n${JSON.stringify(reviewCandidatesFields())}`,
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed" });
  });

  it("rejects unknown fields fail-closed", () => {
    const outcome = parseReviewGateOperationResult(
      "review_candidates",
      rawResult(reviewCandidatesFields({ reviewerHiddenReasoning: "internal chain of thought" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome.kind).toBe("malformed");
  });

  it("rejects duplicate candidate ids fail-closed", () => {
    const outcome = parseReviewGateOperationResult(
      "review_candidates",
      rawResult(
        reviewCandidatesFields({
          candidates: [
            { candidateId: "RG-001", severity: "major", summary: "a", location: "design.md:1" },
            { candidateId: "RG-001", severity: "minor", summary: "b", location: "design.md:2" },
          ],
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "duplicate_candidate" });
  });

  it.each([
    "not json",
    JSON.stringify({ ...reviewCandidatesFields(), schemaVersion: 2 }),
    JSON.stringify({ ...reviewCandidatesFields(), candidates: "all bad" }),
    JSON.stringify({ ...reviewCandidatesFields(), candidates: [{ candidateId: "", severity: "major", summary: "s", location: "l" }] }),
  ])("rejects malformed candidates results (%s)", (raw) => {
    const outcome = parseReviewGateOperationResult("review_candidates", raw, {
      operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1",
    });
    expect(outcome).toMatchObject({ kind: "malformed" });
  });

  it("binds the exact operation correlation and reports stale ids", () => {
    expect(
      parseReviewGateOperationResult("review_candidates", rawResult(reviewCandidatesFields()), {
        operationId: "op-2", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1",
      }),
    ).toEqual({
      kind: "stale",
      field: "operationId",
      expected: "op-2",
      received: "op-1",
    });

    expect(
      parseReviewGateOperationResult("review_candidates", rawResult(reviewCandidatesFields()), {
        operationId: "op-1", gateId: "gate-other", phase: "design", reviewAttemptId: "attempt-1",
      }),
    ).toEqual({
      kind: "stale",
      field: "gateId",
      expected: "gate-other",
      received: "gate-1",
    });

    expect(
      parseReviewGateOperationResult("review_candidates", rawResult(reviewCandidatesFields()), {
        operationId: "op-1", gateId: "gate-1", phase: "plan", reviewAttemptId: "attempt-1",
      }),
    ).toEqual({
      kind: "stale",
      field: "phase",
      expected: "plan",
      received: "design",
    });

    expect(
      parseReviewGateOperationResult("review_candidates", rawResult(reviewCandidatesFields()), {
        operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-2",
      }),
    ).toEqual({
      kind: "stale",
      field: "reviewAttemptId",
      expected: "attempt-2",
      received: "attempt-1",
    });
  });

  it("requires the fresh-review attempt context structurally", () => {
    const outcome = parseReviewGateOperationResult(
      "review_candidates",
      rawResult(reviewCandidatesFields({ reviewAttemptId: null })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "review_attempt_required" });

    const roundBound = parseReviewGateOperationResult(
      "review_candidates",
      rawResult(reviewCandidatesFields({ remediationRound: { phase: "design", ordinal: 1 } })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(roundBound).toMatchObject({ kind: "malformed", reason: "remediation_round_forbidden" });
  });
});

describe("finding validation result parser", () => {
  it("accepts a valid existing-lineage observation with full semantic basis", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(findingValidationFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.result.decision).toBe("VALID");
      expect(outcome.result.semanticBasis?.ownerScope).toBe("design");
      expect(Object.isFrozen(outcome.result)).toBe(true);
    }
  });

  it("accepts a valid new-lineage observation without an existing lineage ref", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(
        findingValidationFields({
          relation: "NEW",
          existingLineageRef: undefined,
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome.kind).toBe("accepted");
  });

  it("rejects a NEW relation carrying an existing lineage ref", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(findingValidationFields({ relation: "NEW" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "existing_lineage_ref_forbidden" });
  });

  it("rejects an EXISTING relation without an existing lineage ref", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(findingValidationFields({ existingLineageRef: undefined })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "existing_lineage_ref_required" });
  });

  it("rejects ALREADY_RESOLVED with a NEW relation (NEW + ALREADY_RESOLVED is impossible)", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(
        findingValidationFields({
          decision: "ALREADY_RESOLVED",
          relation: "NEW",
          existingLineageRef: undefined,
          severity: undefined,
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({
      kind: "malformed",
      reason: "decision_relation_conflict",
    });
  });

  it("requires ALREADY_RESOLVED to reference an existing lineage", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(
        findingValidationFields({
          decision: "ALREADY_RESOLVED",
          relation: "EXISTING",
          severity: undefined,
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome.kind).toBe("accepted");
  });

  it("rejects INVALID observations that claim a semantic relation", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(
        findingValidationFields({
          decision: "INVALID",
          relation: "EXISTING",
          severity: undefined,
          semanticBasis: undefined,
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({
      kind: "malformed",
      reason: "decision_relation_conflict",
    });
  });

  it("requires semantic basis of reopen decisions to agree with the asserted upstream scope", () => {
    const designReopen = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(
        findingValidationFields({
          phase: "plan",
          decision: "DESIGN_REOPEN_REQUIRED",
          relation: "NEW",
          existingLineageRef: undefined,
          severity: undefined,
          semanticBasis: {
            violationType: "missing_error_handling",
            governingReference: "requirements.md:7",
            semanticLocation: "design.md:42",
            violatedContract: "concurrent-task-failure-recovery",
            ownerScope: "design",
          },
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "plan", reviewAttemptId: "attempt-1" },
    );
    expect(designReopen.kind).toBe("accepted");

    const mismatched = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(
        findingValidationFields({
          phase: "plan",
          decision: "DESIGN_REOPEN_REQUIRED",
          relation: "NEW",
          existingLineageRef: undefined,
          severity: undefined,
          semanticBasis: {
            violationType: "missing_error_handling",
            governingReference: "requirements.md:7",
            semanticLocation: "design.md:42",
            violatedContract: "concurrent-task-failure-recovery",
            ownerScope: "plan",
          },
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "plan", reviewAttemptId: "attempt-1" },
    );
    expect(mismatched).toMatchObject({
      kind: "malformed",
      reason: "decision_owner_scope_conflict",
    });
  });

  it("rejects advisory decisions declared with blocking severity", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(findingValidationFields({ decision: "ADVISORY" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({
      kind: "malformed",
      reason: "decision_severity_conflict",
    });

    const minor = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(findingValidationFields({ decision: "ADVISORY", severity: "minor" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(minor.kind).toBe("accepted");
  });

  it("fails closed on malformed typed semantic basis", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(
        findingValidationFields({
          semanticBasis: {
            violationType: "missing_error_handling",
            governingReference: "requirements.md:7",
            semanticLocation: "   ",
            violatedContract: "concurrent-task-failure-recovery",
            ownerScope: "design",
          },
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome.kind).toBe("malformed");
  });

  it("requires severity on blocking-eligible decisions", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(findingValidationFields({ severity: undefined })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "decision_severity_required" });
  });

  it("forbids a validity decision without the semantic basis", () => {
    const outcome = parseReviewGateOperationResult(
      "finding_validation",
      rawResult(findingValidationFields({ semanticBasis: undefined })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "decision_basis_required" });
  });
});

describe("self review result parser", () => {
  it("accepts a result whose discovered findings already carry validity and same-generation relation", () => {
    const outcome = parseReviewGateOperationResult(
      "self_review",
      rawResult(
        selfReviewFields({
          discoveredFindings: [
            {
              candidateId: "RG-002",
              validity: "VALID",
              severity: "blocking",
              semanticRelation: "EXISTING",
              existingLineageRef: "lineage-1",
              semanticBasis: {
                violationType: "missing_error_handling",
                governingReference: "requirements.md:7",
                semanticLocation: "design.md:42",
                violatedContract: "concurrent-task-failure-recovery",
                ownerScope: "design",
              },
            },
          ],
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.result.discoveredFindings[0]?.validity).toBe("VALID");
      expect(outcome.result.discoveredFindings[0]?.semanticRelation).toBe("EXISTING");
    }
  });

  it("rejects discovered findings missing validity or the same-generation relation", () => {
    const missingValidity = parseReviewGateOperationResult(
      "self_review",
      rawResult(
        selfReviewFields({
          discoveredFindings: [
            {
              candidateId: "RG-002",
              validity: undefined,
              semanticRelation: "NEW",
              semanticBasis: {
                violationType: "x",
                governingReference: "y",
                semanticLocation: "z",
                violatedContract: "w",
                ownerScope: "plan",
              },
            },
          ],
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "plan", remediationRound: { phase: "plan", ordinal: 1 } },
    );
    expect(missingValidity).toMatchObject({
      kind: "malformed",
      reason: "discovered_validity_required",
    });

    const missingRelation = parseReviewGateOperationResult(
      "self_review",
      rawResult(
        selfReviewFields({
          discoveredFindings: [
            {
              candidateId: "RG-002",
              validity: "VALID",
              semanticRelation: undefined,
              semanticBasis: {
                violationType: "x",
                governingReference: "y",
                semanticLocation: "z",
                violatedContract: "w",
                ownerScope: "design",
              },
            },
          ],
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(missingRelation).toMatchObject({
      kind: "malformed",
      reason: "discovered_relation_required",
    });
  });

  it("flags SELF_REVIEW_RESULT_CONFLICT when a STILL_PRESENT target is rediscovered as EXISTING", () => {
    const fieldText = selfReviewFields({
      targetLineageChecks: [{ lineageId: "lineage-1", result: "STILL_PRESENT" }],
      discoveredFindings: [
        {
          candidateId: "RG-002",
          validity: "VALID",
          severity: "blocking",
          semanticRelation: "EXISTING",
          existingLineageRef: "lineage-1",
          semanticBasis: {
            violationType: "missing_error_handling",
            governingReference: "requirements.md:7",
            semanticLocation: "design.md:42",
            violatedContract: "concurrent-task-failure-recovery",
            ownerScope: "design",
          },
        },
      ],
    });
    const outcome = parseReviewGateOperationResult("self_review", rawResult(fieldText), {
      operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 },
    });
    expect(outcome).toEqual({
      kind: "conflict",
      code: "SELF_REVIEW_RESULT_CONFLICT",
    });
  });

  it("allows a RESOLVED target rediscovered as EXISTING (regression discovery authority)", () => {
    const outcome = parseReviewGateOperationResult(
      "self_review",
      rawResult(
        selfReviewFields({
          targetLineageChecks: [{ lineageId: "lineage-1", result: "RESOLVED" }],
          discoveredFindings: [
            {
              candidateId: "RG-002",
              validity: "VALID",
              severity: "blocking",
              semanticRelation: "EXISTING",
              existingLineageRef: "lineage-1",
              semanticBasis: {
                violationType: "missing_error_handling",
                governingReference: "requirements.md:7",
                semanticLocation: "design.md:42",
                violatedContract: "concurrent-task-failure-recovery",
                ownerScope: "design",
              },
            },
          ],
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(outcome.kind).toBe("accepted");
  });

  it("rejects duplicate target lineage checks and duplicate discovered candidates", () => {
    const duplicateTargets = parseReviewGateOperationResult(
      "self_review",
      rawResult(
        selfReviewFields({
          targetLineageChecks: [
            { lineageId: "lineage-1", result: "RESOLVED" },
            { lineageId: "lineage-1", result: "STILL_PRESENT" },
          ],
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(duplicateTargets).toMatchObject({
      kind: "malformed",
      reason: "duplicate_target_lineage",
    });

    const discoveredRaw = selfReviewFields({
      discoveredFindings: [
        {
          candidateId: "RG-002",
          validity: "INVALID",
          severity: undefined,
          semanticRelation: "NEW",
          semanticBasis: {
            violationType: "x",
            governingReference: "y",
            semanticLocation: "z",
            violatedContract: "w",
            ownerScope: "design",
          },
        },
        {
          candidateId: "RG-002",
          validity: "ADVISORY",
          severity: "minor",
          semanticRelation: "NEW",
          semanticBasis: {
            violationType: "x",
            governingReference: "y",
            semanticLocation: "z",
            violatedContract: "w",
            ownerScope: "design",
          },
        },
      ],
    });
    const duplicateDiscovered = parseReviewGateOperationResult("self_review", rawResult(discoveredRaw), {
      operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 },
    });
    expect(duplicateDiscovered).toMatchObject({
      kind: "malformed",
      reason: "duplicate_discovered_candidate",
    });
  });

  it("binds the self-review round context exactly", () => {
    const outcome = parseReviewGateOperationResult(
      "self_review",
      rawResult(selfReviewFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 2 } },
    );
    expect(outcome).toEqual({
      kind: "stale",
      field: "remediationRound",
      expected: "design:2",
      received: "design:1",
    });
  });

  it("rejects self-review results without the round context", () => {
    const outcome = parseReviewGateOperationResult(
      "self_review",
      rawResult(selfReviewFields({ remediationRound: null })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "remediation_round_required" });
  });
});

describe("lineage revalidation result parser", () => {
  it("accepts only STILL_PRESENT, RESOLVED, or INDETERMINATE", () => {
    for (const value of ["STILL_PRESENT", "RESOLVED", "INDETERMINATE"]) {
      const outcome = parseReviewGateOperationResult(
        "lineage_revalidation",
        rawResult(lineageRevalidationFields({ result: value })),
        { operationId: "op-1", gateId: "gate-1", phase: "design" },
      );
      expect(outcome.kind).toBe("accepted");
    }

    const invalid = parseReviewGateOperationResult(
      "lineage_revalidation",
      rawResult(lineageRevalidationFields({ result: "REGRESSED" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design" },
    );
    expect(invalid).toMatchObject({ kind: "malformed" });
  });

  it("cannot express a new finding", () => {
    const outcome = parseReviewGateOperationResult(
      "lineage_revalidation",
      rawResult(lineageRevalidationFields({ newFinding: { candidateId: "X-1" } })),
      { operationId: "op-1", gateId: "gate-1", phase: "design" },
    );
    expect(outcome.kind).toBe("malformed");
  });
});

describe("cross-generation reconciliation result parser", () => {
  it("accepts NO_PRIOR_MATCH without a predecessor ref", () => {
    const outcome = parseReviewGateOperationResult(
      "cross_generation_reconciliation",
      rawResult(crossGenerationFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome.kind).toBe("accepted");
  });

  it("requires the predecessor ref for RELATED_PRIOR_GENERATION and forbids it otherwise", () => {
    const missing = parseReviewGateOperationResult(
      "cross_generation_reconciliation",
      rawResult(crossGenerationFields({ verdict: "RELATED_PRIOR_GENERATION" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(missing).toMatchObject({ kind: "malformed", reason: "predecessor_ref_required" });

    const withRef = parseReviewGateOperationResult(
      "cross_generation_reconciliation",
      rawResult(
        crossGenerationFields({
          verdict: "RELATED_PRIOR_GENERATION",
          predecessorLineageRef: { gateId: "gate-predecessor", lineageId: "prev-lineage-1" },
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(withRef.kind).toBe("accepted");

    const forbidden = parseReviewGateOperationResult(
      "cross_generation_reconciliation",
      rawResult(
        crossGenerationFields({
          predecessorLineageRef: { gateId: "gate-predecessor", lineageId: "prev-lineage-1" },
        }),
      ),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(forbidden).toMatchObject({ kind: "malformed", reason: "predecessor_ref_forbidden" });
  });

  it("requires the attempt context", () => {
    const outcome = parseReviewGateOperationResult(
      "cross_generation_reconciliation",
      rawResult(crossGenerationFields({ reviewAttemptId: null })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", reviewAttemptId: "attempt-1" },
    );
    expect(outcome).toMatchObject({ kind: "malformed", reason: "review_attempt_required" });
  });
});

describe("non-convergence reentry result parser", () => {
  it("accepts MATERIAL_PROGRESS without lineage refs", () => {
    const outcome = parseReviewGateOperationResult(
      "non_convergence_reentry",
      rawResult(reentryFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design" },
    );
    expect(outcome.kind).toBe("accepted");
  });

  it("requires the upstream lineage for reopen outcomes and forbids it for material-progress outcomes", () => {
    const reopen = parseReviewGateOperationResult(
      "non_convergence_reentry",
      rawResult(reentryFields({ outcome: "DESIGN_REOPEN_REQUIRED", lineageId: "upstream-1" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design" },
    );
    expect(reopen.kind).toBe("accepted");

    const missing = parseReviewGateOperationResult(
      "non_convergence_reentry",
      rawResult(reentryFields({ outcome: "REQUIREMENTS_REOPEN_REQUIRED" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design" },
    );
    expect(missing).toMatchObject({ kind: "malformed", reason: "reopen_lineage_ref_required" });

    const forbidden = parseReviewGateOperationResult(
      "non_convergence_reentry",
      rawResult(reentryFields({ lineageId: "upstream-1" })),
      { operationId: "op-1", gateId: "gate-1", phase: "design" },
    );
    expect(forbidden).toMatchObject({ kind: "malformed", reason: "reopen_lineage_ref_forbidden" });
  });
});

describe("remediation result parser", () => {
  it("accepts a strict remediation result bound to the exact round", () => {
    const outcome = parseReviewGateOperationResult(
      "remediation",
      rawResult(remediationFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(outcome.kind).toBe("accepted");
    if (outcome.kind === "accepted") {
      expect(outcome.result.outcome).toBe("COMPLETED");
      expect(outcome.result.targetPath).toBe("docs/plan/design.md");
      expect(Object.isFrozen(outcome.result)).toBe(true);
    }
  });

  it("reports stale remediation round correlation", () => {
    const outcome = parseReviewGateOperationResult(
      "remediation",
      rawResult(remediationFields()),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 2 } },
    );
    expect(outcome).toEqual({
      kind: "stale",
      field: "remediationRound",
      expected: "design:2",
      received: "design:1",
    });
  });

  it("rejects remediation results without the round context or summary", () => {
    const noRound = parseReviewGateOperationResult(
      "remediation",
      rawResult(remediationFields({ remediationRound: null })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(noRound).toMatchObject({ kind: "malformed", reason: "remediation_round_required" });

    const emptySummary = parseReviewGateOperationResult(
      "remediation",
      rawResult(remediationFields({ summary: "   " })),
      { operationId: "op-1", gateId: "gate-1", phase: "design", remediationRound: { phase: "design", ordinal: 1 } },
    );
    expect(emptySummary).toMatchObject({ kind: "malformed" });
  });
});

// ---------------------------------------------------------------------------
// Builder/parser round trip
// ---------------------------------------------------------------------------

describe("operation builder and result parser round trip", () => {
  it("reaches accepted parse from the correlation the builder pinned", () => {
    const packet = buildSelfReviewOperationPacket({
      correlation: {
        operationId: "op-sr-9",
        gateId: "gate-9",
        phase: "plan",
        reviewAttemptId: null,
        remediationRound: { phase: "plan", ordinal: 3 },
        dispatchSerial: 1,
      },
      targetLineageRefs: ["lineage-1"],
      existingLineageCandidateRefs: [],
      artifactRefs: [DESIGN_REF, PLAN_REF],
    });

    const outcome = parseReviewGateOperationResult(
      "self_review",
      rawResult(
        selfReviewFields({
          operationId: "op-sr-9",
          gateId: "gate-9",
          phase: "plan",
          remediationRound: { phase: "plan", ordinal: 3 },
        }),
      ),
      {
        operationId: packet.operationId,
        gateId: packet.gateId,
        phase: packet.phase,
        remediationRound: { phase: "plan", ordinal: 3 },
      },
    );
    expect(outcome.kind).toBe("accepted");
  });

  it("keeps every worker prompt free of shell/git/task authority wording", () => {
    const packets = [
      buildReviewerOperationPacket({
        correlation: CORRELATION_BASE,
        artifactRefs: [REQUIREMENTS_REF, DESIGN_REF],
      }),
      buildRemediationOperationPacket({
        correlation: {
          ...CORRELATION_BASE,
          operationId: "op-rm-2",
          remediationRound: { phase: "design", ordinal: 1 },
        },
        authorityArtifacts: [REQUIREMENTS_REF],
        targetArtifact: DESIGN_REF,
      }),
    ];
    for (const packet of packets) {
      expect(packet.workerPrompt).not.toContain('"command":"git');
      expect(packet.workerPrompt).toContain("Do not use shell");
      expect(packet.workerPrompt).not.toContain('"shell":"allow"');
    }
  });
});

// Keep an exhaustive outcome-type relation referenced without any-value casts.
type OutcomeAssert = ReviewGateResultParseOutcome<{ tag: "never" }>;
const _outcomeTypeWitness: OutcomeAssert["kind"][] = ["accepted", "malformed", "conflict", "stale"];
void _outcomeTypeWitness;

// REVIEW_GATE_AGENT_CONTROLLER / REMEDIATOR participation in registration is
// asserted in tests/runtime/command-registration.test.ts; still keep a pure
// guard here so the constants never drift silently.
describe("agent name constants", () => {
  it("names the four canonical agents and the temporary legacy worker", () => {
    expect(REVIEW_GATE_AGENT_CONTROLLER).toBe("justice-review-controller");
    expect(REVIEW_GATE_AGENT_REVIEWER).toBe("justice-review-reviewer");
    expect(REVIEW_GATE_AGENT_FINDING_VALIDATOR).toBe("justice-review-finding-validator");
    expect(REVIEW_GATE_AGENT_REMEDIATOR).toBe("justice-review-remediator");
  });
});
