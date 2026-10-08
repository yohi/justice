import { describe, expect, it } from "vitest";
import { projectReviewGate } from "../../../src/core/review-gate/projection.js";
import { createDefaultDeterministicValidatorRegistry } from "../../../src/core/review-gate/deterministic-validation.js";
import {
  emptyDeterministicValidationState,
  executeValidationDispatch,
  type MandatoryValidationDispatch,
} from "../../../src/core/review-gate/deterministic-validation.js";
import {
  planReviewGateNextOperation,
  type ReviewGatePlanningContext,
} from "../../../src/core/review-gate/orchestrator.js";
import {
  buildLineageResolution,
  commitLineageRevalidation,
} from "../../../src/core/review-gate/lineage.js";
import type {
  ArtifactDigest,
  CompletedApprovalBindingV1,
  DesignClearV1,
  EpochId,
  FindingDiscoveredV1,
  FindingId,
  FindingRemediatedV1,
  FindingReopenedV1,
  FindingSelfReviewedV1,
  GateCreatedV1,
  GateId,
  LineageId,
  RemediationRound,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
  ReviewScopeId,
  WriterId,
} from "../../../src/core/review-gate/types.js";

const gateId = "gate-1" as GateId;
const scopeId = "scope-1" as ReviewScopeId;
const writerId = "writer-1" as WriterId;
const epochId = "epoch-1" as EpochId;
const digest = "a".repeat(64) as ArtifactDigest;

const designArtifact = {
  canonicalPath: "docs/design.md",
  digest,
  gitMode: "100644" as const,
};
const planArtifact = {
  canonicalPath: "docs/plan.md",
  digest,
  gitMode: "100644" as const,
};
const artifacts = { design: designArtifact, plan: planArtifact };

const binding: ReviewApprovalBindingV1 = {
  reviewScopeId: scopeId,
  gateId,
  designArtifact,
  planArtifact,
  requirementsResolution: { source: "explicit", canonicalPath: "docs/requirements.md", digest },
  reviewProtocolFingerprint: "review-v1",
  designProtocolFingerprint: "design-v1",
  planProtocolFingerprint: "plan-v1",
  approvedAt: "2026-10-08T00:00:03.000Z",
};

const created: GateCreatedV1 = {
  eventType: "GATE_CREATED",
  gateId,
  writerId,
  epochId,
  emittedAt: "2026-10-08T00:00:00.000Z",
  payload: {
    reviewScopeId: scopeId,
    designArtifact,
    planArtifact,
    requirementsResolution: binding.requirementsResolution,
    reviewProtocolFingerprint: "review-v1",
  },
};

function event<Event extends ReviewGateEvent>(
  eventType: Event["eventType"],
  payload: Event["payload"],
  emittedAt = "2026-10-08T00:00:01.000Z",
): Event {
  return { eventType, gateId, writerId, epochId, emittedAt, payload } as Event;
}

const designClear = event<DesignClearV1>("DESIGN_CLEAR", {
  designProtocolFingerprint: "design-v1",
});

function discover(
  lineageId: LineageId,
  findingId: string,
  ownerScope: "requirements" | "design" | "plan",
): FindingDiscoveredV1 {
  return event<FindingDiscoveredV1>("FINDING_DISCOVERED", {
    lineageId,
    findingId: findingId as FindingId,
    observedPhase: "design",
    ownerScope,
    descriptionDigest: digest,
  });
}

function remediated(lineageId: LineageId, round: RemediationRound): FindingRemediatedV1 {
  return event<FindingRemediatedV1>("FINDING_REMEDIATED", {
    lineageId,
    findingId: `${lineageId}-finding` as FindingId,
    remediationRound: round,
  });
}

function selfReviewed(lineageId: LineageId, round: RemediationRound): FindingSelfReviewedV1 {
  return event<FindingSelfReviewedV1>("FINDING_SELF_REVIEWED", {
    lineageId,
    findingId: `${lineageId}-finding` as FindingId,
    remediationRound: round,
  });
}

function reopened(lineageId: LineageId): FindingReopenedV1 {
  return event<FindingReopenedV1>("FINDING_REOPENED", {
    lineageId,
    findingId: `${lineageId}-finding` as FindingId,
    reopenedBy: epochId,
  });
}

const lineageA = "lineage-a" as LineageId;
const lineageB = "lineage-b" as LineageId;

function planningContext(
  overrides: Omit<ReviewGatePlanningContext, "artifacts"> = {},
): ReviewGatePlanningContext {
  return { artifacts, ...overrides };
}

function referenceConsistencyDispatch(
  declaredReference: string,
  logicalOperationId: string,
): MandatoryValidationDispatch {
  return {
    validatorId: "design-requirements-reference-consistency-v1",
    stage: "PRE_CLEAR",
    phase: "design",
    logicalOperationId,
    binding: {
      validatorId: "design-requirements-reference-consistency-v1",
      validatorContractVersion: 1,
      resultSchemaVersion: 1,
      stage: "PRE_CLEAR",
      declaredInputs: {
        DESIGN_ARTIFACT: { digest, entries: { requirementsReference: declaredReference } },
        REQUIREMENTS_ARTIFACT: { digest, entries: { path: "docs/requirements.md" } },
      },
      executionEnvironment: {
        runtimeId: "bun-test",
        runtimeVersion: "1",
        executableDigest: "exec-digest",
      },
    },
  };
}

describe("planReviewGateNextOperation — state-machine scenarios", () => {
  it("plans a Design review for a brand-new gate", () => {
    const projection = projectReviewGate([created]);

    expect(planReviewGateNextOperation(projection, planningContext())).toEqual({
      kind: "dispatch_reviewer",
      phase: "design",
    });
  });

  it("plans a Plan review when the Design clear is inherited from history", () => {
    const projection = projectReviewGate([created, designClear]);

    expect(planReviewGateNextOperation(projection, planningContext())).toEqual({
      kind: "dispatch_reviewer",
      phase: "plan",
    });
  });

  it("plans remediation for a Design-owned blocker in the Design phase", () => {
    const projection = projectReviewGate([created, discover(lineageA, "f-a", "design")]);

    expect(planReviewGateNextOperation(projection, planningContext())).toEqual({
      kind: "start_remediation",
      phase: "design",
      round: { phase: "design", ordinal: 1 },
      lineageIds: [lineageA],
    });
  });

  it("restores a dirty Design target before reopening Design from a Plan-phase Design-owned blocker", () => {
    const projection = projectReviewGate([
      created,
      designClear,
      discover(lineageA, "f-a", "design"),
    ]);

    const dirty = planningContext({
      workspaceStates: new Map([["docs/design.md", "known_dirty" as const]]),
    });
    expect(planReviewGateNextOperation(projection, dirty)).toEqual({
      kind: "prepare_restore",
      targetPath: "docs/design.md",
      restoreTo: designArtifact,
    });

    const clean = planningContext({
      workspaceStates: new Map([["docs/design.md", "clean_committed" as const]]),
    });
    expect(planReviewGateNextOperation(projection, clean)).toEqual({
      kind: "append_reopen",
      phase: "design",
      lineageIds: [lineageA],
    });
  });

  it("reopens the Design phase for a Requirements-owned upstream blocker", () => {
    const projection = projectReviewGate([created, discover(lineageA, "f-a", "requirements")]);

    expect(planReviewGateNextOperation(projection, planningContext())).toEqual({
      kind: "append_reopen",
      phase: "design",
      lineageIds: [lineageA],
    });
  });

  it("walks remediation → self-review → commit → resolution → fresh review", () => {
    const baseEvents = [created, discover(lineageA, "f-a", "design")] as const;

    const discovered = projectReviewGate([...baseEvents]);
    expect(planReviewGateNextOperation(discovered, planningContext()).kind).toBe(
      "start_remediation",
    );

    const round: RemediationRound = { phase: "design", ordinal: 1 };
    const remediatedProjection = projectReviewGate([...baseEvents, remediated(lineageA, round)]);
    expect(
      planReviewGateNextOperation(
        remediatedProjection,
        planningContext({ remediationCompleted: { round, lineageIds: [lineageA] } }),
      ),
    ).toEqual({
      kind: "dispatch_self_review",
      phase: "design",
      round,
      lineageIds: [lineageA],
    });

    const selfReviewedProjection = projectReviewGate([
      ...baseEvents,
      remediated(lineageA, round),
      selfReviewed(lineageA, round),
    ]);
    expect(
      planReviewGateNextOperation(
        selfReviewedProjection,
        planningContext({ selfReviewPassed: { round, lineageIds: [lineageA] } }),
      ),
    ).toEqual({
      kind: "prepare_commit",
      phase: "design",
      artifactPath: "docs/design.md",
    });

    expect(
      planReviewGateNextOperation(
        selfReviewedProjection,
        planningContext({
          commitCompleted: { phase: "design", artifactPath: "docs/design.md" },
        }),
      ),
    ).toEqual({ kind: "commit_resolutions", lineageIds: [lineageA] });

    expect(
      planReviewGateNextOperation(
        selfReviewedProjection,
        planningContext({ resolutionsCommitted: { lineageIds: [lineageA] } }),
      ),
    ).toEqual({ kind: "dispatch_reviewer", phase: "design" });
  });

  it("applies the NC1/capacity/remediation truth table for a current blocker", () => {
    // NC1 non-convergence on a reopened blocker whose remediation round is
    // not the latest: lineage-b closed out its later round via self-review
    // while lineage-a reopened from the earlier one, so the disposition
    // seam suspends the gate for material-progress validation.
    const oscillating = projectReviewGate([
      created,
      discover(lineageA, "f-a", "design"),
      remediated(lineageA, { phase: "design", ordinal: 1 }),
      discover(lineageB, "f-b", "design"),
      remediated(lineageB, { phase: "design", ordinal: 2 }),
      selfReviewed(lineageB, { phase: "design", ordinal: 2 }),
      reopened(lineageA),
    ]);
    expect(planReviewGateNextOperation(oscillating, planningContext())).toEqual({
      kind: "suspended",
      reason: "review_non_convergent",
      nonConvergent: { phase: "design", lineageIds: [lineageA] },
      resumeCursor: { kind: "await_material_progress" },
    });

    // Absolute round exhaustion: all five Design rounds spent, blocker reopened.
    const exhaustedEvents: ReviewGateEvent[] = [created, discover(lineageA, "f-a", "design")];
    for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
      exhaustedEvents.push(remediated(lineageA, { phase: "design", ordinal }));
    }
    exhaustedEvents.push(reopened(lineageA));
    const exhausted = projectReviewGate(exhaustedEvents);
    expect(planReviewGateNextOperation(exhausted, planningContext())).toEqual({
      kind: "suspended",
      reason: "round_limit_exhausted",
      resumeCursor: { kind: "await_external_change" },
    });

    // A coordinator-provided non-convergent disposition is honored verbatim.
    const blocker = projectReviewGate([created, discover(lineageA, "f-a", "design")]);
    const payload = { phase: "design" as const, lineageIds: [lineageA] };
    expect(
      planReviewGateNextOperation(
        blocker,
        planningContext({ currentPhaseDisposition: { kind: "non_convergent", payload } }),
      ),
    ).toEqual({
      kind: "suspended",
      reason: "review_non_convergent",
      nonConvergent: payload,
      resumeCursor: { kind: "await_material_progress" },
    });
  });

  it("treats a deterministic PRE_CLEAR finding as a normal finding with normal disposition", () => {
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatch = referenceConsistencyDispatch("docs/other.md", "pre-clear-design-1");
    const projection = projectReviewGate([created]);

    const scheduled = planReviewGateNextOperation(
      projection,
      planningContext({
        reviewObserved: { phase: "design", candidates: [] },
        preClearValidation: {
          registry,
          state: emptyDeterministicValidationState,
          dispatches: [dispatch],
        },
      }),
    );
    expect(scheduled.kind).toBe("run_pre_clear_validation");
    if (scheduled.kind !== "run_pre_clear_validation") return;
    expect(scheduled.phase).toBe("design");
    expect(scheduled.schedule.requirements).toHaveLength(1);
    expect(scheduled.schedule.requirements[0]?.disposition).toBe("dispatch");

    const evidence = executeValidationDispatch(registry, dispatch, "2026-10-08T00:00:02.000Z");
    expect(evidence.kind).toBe("semantic");
    expect(evidence.result).toBe("FAIL");

    const reconciling = planReviewGateNextOperation(
      projection,
      planningContext({
        reviewObserved: { phase: "design", candidates: [] },
        preClearValidationObserved: {
          validationEventId: "pre-clear-design-1",
          registry,
          evidences: [evidence],
        },
      }),
    );
    expect(reconciling.kind).toBe("commit_finding_reconciliation");
    if (reconciling.kind !== "commit_finding_reconciliation") return;
    expect(reconciling.batch.findings).toHaveLength(1);
    const finding = reconciling.batch.findings[0];
    expect(finding?.status).toBe("new");
    expect(finding?.ownerScope).toBe("design");
    expect(finding?.severity).toBe("blocking");

    // After the reconciliation commit the DVF1 finding behaves like any other:
    // the blocker landscape drives the normal remediation disposition.
    const withDeterministicFinding = projectReviewGate([
      created,
      event<FindingDiscoveredV1>("FINDING_DISCOVERED", {
        lineageId: lineageA,
        findingId: "dvf1-finding" as FindingId,
        observedPhase: "design",
        ownerScope: "design",
        descriptionDigest: digest,
      }),
    ]);
    expect(planReviewGateNextOperation(withDeterministicFinding, planningContext())).toEqual({
      kind: "start_remediation",
      phase: "design",
      round: { phase: "design", ordinal: 1 },
      lineageIds: [lineageA],
    });
  });

  it("reaches the PLAN_CLEAR terminal through pre-clear validation and completion", () => {
    const projection = projectReviewGate([created, designClear]);
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatch = referenceConsistencyDispatch("docs/requirements.md", "pre-clear-plan-pass");
    const evidence = executeValidationDispatch(registry, dispatch, "2026-10-08T00:00:02.000Z");
    expect(evidence).toMatchObject({ stage: "PRE_CLEAR", kind: "semantic", result: "PASS" });

    const clearing = planReviewGateNextOperation(
      projection,
      planningContext({
        reviewObserved: { phase: "plan", candidates: [] },
        preClearValidationObserved: {
          validationEventId: "pre-clear-plan-1",
          registry,
          evidences: [evidence],
        },
        preparedApprovalBinding: binding,
      }),
    );
    expect(clearing).toEqual({ kind: "append_plan_clear", approvalBinding: binding });

    const planClear = event("PLAN_CLEAR", { completedApprovalBinding: binding });
    const completedBinding = event<CompletedApprovalBindingV1>("COMPLETED_APPROVAL_BINDING", {
      approvalBinding: binding,
    });
    const completed = projectReviewGate([created, designClear, planClear, completedBinding]);
    expect(planReviewGateNextOperation(completed, planningContext())).toEqual({
      kind: "completed",
      approvalBinding: binding,
    });
  });

  it.each([
    ["a non-PRE_CLEAR stage", { stage: "BASELINE_ADMISSION" as const }],
    ["indeterminate evidence", { result: "INDETERMINATE" as const }],
  ])("suspends before PLAN_CLEAR for %s", (_description, overrides) => {
    const projection = projectReviewGate([created, designClear]);
    const registry = createDefaultDeterministicValidatorRegistry();
    const dispatch = referenceConsistencyDispatch("docs/requirements.md", "pre-clear-plan-pass");
    const evidence = executeValidationDispatch(registry, dispatch, "2026-10-08T00:00:02.000Z");
    const observedEvidence = { ...evidence, ...overrides };

    expect(
      planReviewGateNextOperation(
        projection,
        planningContext({
          reviewObserved: { phase: "plan", candidates: [] },
          preClearValidationObserved: {
            validationEventId: "pre-clear-plan-1",
            registry,
            evidences: [observedEvidence],
          },
          preparedApprovalBinding: binding,
        }),
      ),
    ).toEqual({ kind: "suspended", reason: "execution_suspended" });
  });

  it("suspends before PLAN_CLEAR when pre-clear validation returns no evidence", () => {
    const projection = projectReviewGate([created, designClear]);
    const registry = createDefaultDeterministicValidatorRegistry();

    expect(
      planReviewGateNextOperation(
        projection,
        planningContext({
          reviewObserved: { phase: "plan", candidates: [] },
          preClearValidationObserved: {
            validationEventId: "pre-clear-plan-empty",
            registry,
            evidences: [],
          },
          preparedApprovalBinding: binding,
        }),
      ),
    ).toEqual({ kind: "suspended", reason: "execution_suspended" });
  });

  it("maps suspended gates to their suspension operation and reentry validation", () => {
    const nonConvergent = projectReviewGate([
      created,
      event("REVIEW_NON_CONVERGENT", { phase: "design", lineageIds: [lineageA] }),
    ]);
    expect(planReviewGateNextOperation(nonConvergent, planningContext())).toEqual({
      kind: "suspended",
      reason: "review_non_convergent",
      resumeCursor: { kind: "await_material_progress" },
    });
    expect(
      planReviewGateNextOperation(nonConvergent, planningContext({ materialProgressObserved: true })),
    ).toEqual({ kind: "validate_non_convergence_reentry", phase: "design" });

    const reopenedGate = projectReviewGate([
      created,
      event("REOPEN_REQUIRED", { phase: "design", lineageIds: [lineageA] }),
    ]);
    expect(planReviewGateNextOperation(reopenedGate, planningContext())).toEqual({
      kind: "suspended",
      reason: "reopen_required",
      resumeCursor: { kind: "await_upstream_commit" },
    });
  });

  it("never lets an unsupported or corrupt history reach the orchestrator", () => {
    // Projection rejects every corrupt/unsupported history before any planning
    // call could happen, so orchestrator mutation is structurally unreachable.
    expect(() => projectReviewGate([])).toThrow();
    expect(() =>
      projectReviewGate([discover(lineageA, "f-a", "design") as unknown as ReviewGateEvent]),
    ).toThrow();
    expect(() => projectReviewGate([created, { ...created }])).toThrow();
    expect(() => projectReviewGate([created, designClear, { ...designClear }])).toThrow();
  });
});

describe("lineage revalidation rounds", () => {
  const remediationRound = { phase: "design", ordinal: 4 } as const;
  const resolvedFindingEvents = [
    created,
    discover(lineageA, "finding-a", "design"),
    remediated(lineageA, remediationRound),
  ];
  const resolvedFindingProjection = projectReviewGate(resolvedFindingEvents);
  const unremediatedFindingProjection = projectReviewGate([
    created,
    discover(lineageA, "finding-a", "design"),
  ]);

  it("reuses the tracked round for committed lineage revalidation", () => {
    const result = commitLineageRevalidation(resolvedFindingProjection, {
      lineageId: lineageA,
      result: "resolved",
      verifiedCommitBinding: designArtifact,
    });

    expect(result.events[0]?.payload).toMatchObject({ remediationRound });
    expect(
      projectReviewGate([...resolvedFindingEvents, ...result.events]).designRemediationRounds,
    ).toEqual([remediationRound]);
  });

  it("rejects committed lineage revalidation without a prior remediation round", () => {
    expect(() =>
      commitLineageRevalidation(unremediatedFindingProjection, {
        lineageId: lineageA,
        result: "resolved",
        verifiedCommitBinding: designArtifact,
      }),
    ).toThrow("lineage_revalidation_requires_remediation_round");
  });

  it("reuses the tracked round for external-change lineage resolution", () => {
    const result = buildLineageResolution(resolvedFindingProjection, {
      lineageId: lineageA,
      resolutionKind: "external_change_revalidation",
      verifiedCommitBinding: designArtifact,
    });

    expect(result.events[0]?.payload).toMatchObject({ remediationRound });
    expect(
      projectReviewGate([...resolvedFindingEvents, ...result.events]).designRemediationRounds,
    ).toEqual([remediationRound]);
  });

  it("rejects external-change lineage resolution without a prior remediation round", () => {
    expect(() =>
      buildLineageResolution(unremediatedFindingProjection, {
        lineageId: lineageA,
        resolutionKind: "external_change_revalidation",
        verifiedCommitBinding: designArtifact,
      }),
    ).toThrow("lineage_revalidation_requires_remediation_round");
  });
});

describe("planReviewGateNextOperation — crash-window planning", () => {
  it("re-dispatches exactly one external operation after a dispatch without completion", () => {
    const active = projectReviewGate([created]);

    expect(
      planReviewGateNextOperation(
        active,
        planningContext({
          inFlight: {
            kind: "external_operation_dispatched",
            operation: "reviewer",
            phase: "design",
            operationId: "op-review-1",
          },
        }),
      ),
    ).toEqual({
      kind: "dispatch_reviewer",
      phase: "design",
      redispatchedOperationId: "op-review-1",
    });

    const candidate = {
      candidateId: "cand-1",
      severity: "major" as const,
      summary: "summary",
      location: "docs/design.md#1",
    };
    expect(
      planReviewGateNextOperation(
        active,
        planningContext({
          inFlight: {
            kind: "external_operation_dispatched",
            operation: "finding_validator",
            phase: "design",
            operationId: "op-validate-1",
            candidate,
          },
        }),
      ),
    ).toEqual({
      kind: "dispatch_finding_validator",
      phase: "design",
      candidate,
      redispatchedOperationId: "op-validate-1",
    });
  });

  it("re-dispatches self-review, lineage revalidation, and reentry operations after a crash", () => {
    const round: RemediationRound = { phase: "design", ordinal: 1 };
    const remediatedProjection = projectReviewGate([
      created,
      discover(lineageA, "f-a", "design"),
      remediated(lineageA, round),
    ]);

    expect(
      planReviewGateNextOperation(
        remediatedProjection,
        planningContext({
          inFlight: {
            kind: "external_operation_dispatched",
            operation: "self_review",
            phase: "design",
            operationId: "op-self-1",
            round,
            lineageIds: [lineageA],
          },
        }),
      ),
    ).toEqual({
      kind: "dispatch_self_review",
      phase: "design",
      round,
      lineageIds: [lineageA],
      redispatchedOperationId: "op-self-1",
    });

    expect(
      planReviewGateNextOperation(
        remediatedProjection,
        planningContext({
          inFlight: {
            kind: "external_operation_dispatched",
            operation: "lineage_revalidation",
            phase: "design",
            operationId: "op-reval-1",
            lineageId: lineageA,
          },
        }),
      ),
    ).toEqual({
      kind: "dispatch_lineage_revalidation",
      lineageId: lineageA,
      redispatchedOperationId: "op-reval-1",
    });

    const suspended = projectReviewGate([
      created,
      event("REVIEW_NON_CONVERGENT", { phase: "design", lineageIds: [lineageA] }),
    ]);
    expect(
      planReviewGateNextOperation(
        suspended,
        planningContext({
          inFlight: {
            kind: "external_operation_dispatched",
            operation: "non_convergence_reentry",
            phase: "design",
            operationId: "op-reentry-1",
          },
        }),
      ),
    ).toEqual({
      kind: "validate_non_convergence_reentry",
      phase: "design",
      redispatchedOperationId: "op-reentry-1",
    });
  });

  it("plans remediation recovery from the started-without-completed window", () => {
    const round: RemediationRound = { phase: "design", ordinal: 2 };
    const projection = projectReviewGate([created, discover(lineageA, "f-a", "design")]);

    expect(
      planReviewGateNextOperation(
        projection,
        planningContext({
          inFlight: {
            kind: "remediation_started",
            phase: "design",
            round,
            lineageIds: [lineageA],
            worktreeMatchesPreImage: true,
          },
        }),
      ),
    ).toEqual({
      kind: "recover_remediation",
      phase: "design",
      round,
      lineageIds: [lineageA],
    });

    const conflicted = planReviewGateNextOperation(
      projection,
      planningContext({
        inFlight: {
          kind: "remediation_started",
          phase: "design",
          round,
          lineageIds: [lineageA],
          worktreeMatchesPreImage: false,
        },
      }),
    );
    expect(conflicted).toEqual({
      kind: "suspended",
      reason: "execution_suspended",
      detail: "remediation_recovery_conflict",
    });
  });

  it("plans restore and commit recovery from their prepared-without-completed windows", () => {
    const projection = projectReviewGate([created]);

    expect(
      planReviewGateNextOperation(
        projection,
        planningContext({
          inFlight: { kind: "restore_prepared", targetPath: "docs/design.md" },
        }),
      ),
    ).toEqual({
      kind: "recover_restore",
      targetPath: "docs/design.md",
      restoreTo: designArtifact,
    });

    expect(
      planReviewGateNextOperation(
        projection,
        planningContext({
          inFlight: { kind: "commit_prepared", phase: "design", artifactPath: "docs/design.md" },
        }),
      ),
    ).toEqual({
      kind: "recover_commit",
      phase: "design",
      artifactPath: "docs/design.md",
    });
  });

  it("plans the pending resolution commit and the pending fresh review exactly once each", () => {
    const projection = projectReviewGate([created]);

    expect(
      planReviewGateNextOperation(
        projection,
        planningContext({
          inFlight: { kind: "resolutions_pending", lineageIds: [lineageA] },
        }),
      ),
    ).toEqual({ kind: "commit_resolutions", lineageIds: [lineageA] });

    expect(
      planReviewGateNextOperation(
        projection,
        planningContext({
          inFlight: { kind: "fresh_review_pending", phase: "design" },
        }),
      ),
    ).toEqual({ kind: "dispatch_reviewer", phase: "design" });
  });
});
