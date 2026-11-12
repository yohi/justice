import { describe, expect, it } from "vitest";
import {
  admitCurrentReview,
  createGatePendingAttemptEvaluator,
  deriveAcceptanceDecision,
  findCurrentAcceptanceDecision,
  findCurrentGateDecision,
  isCurrentActiveAuthorization,
  sameReviewCorrelation,
} from "../../src/core/acceptance-decision";
import type { ApprovedPlanBinding } from "../../src/core/plan-authorization";
import type { ReviewCorrelation, TaskExecutionRef } from "../../src/core/types";
import type { GatePendingAttemptContext } from "../../src/core/v2/gate-context";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";
import { project } from "../../src/core/v2/state-projection";
import type { PendingDecisionRecord } from "../../src/core/v2/decision-model";
import type {
  CurrentReviewAdmission,
  GateEvaluationDependencies,
  GatePendingAttemptResult,
} from "../../src/core/acceptance-decision";

const ref: TaskExecutionRef = {
  authorizationId: "auth-1",
  taskId: "task-1",
  attemptId: "attempt-1",
};

const authorization = {
  authorizationId: "auth-1",
  sessionId: "session-1",
  planPath: "plan.md",
  planFingerprint: { algorithm: "sha256", value: "fingerprint-1" },
  canonicalSnapshot: { tasks: [{ taskId: "task-1" }] },
  status: "active",
} as unknown as ApprovedPlanBinding;

function taskCorrelation(
  reviewRound = 1,
  taskExecutionRef: TaskExecutionRef = ref,
): ReviewCorrelation {
  return { reviewKind: "task-review", taskExecutionRef, reviewRound };
}

function finalCorrelation(
  overrides: Partial<Extract<ReviewCorrelation, { readonly reviewKind: "final-review" }>> = {},
): ReviewCorrelation {
  return {
    reviewKind: "final-review",
    authorizationId: "auth-1",
    planPath: "plan.md",
    planFingerprint: { algorithm: "sha256", value: "fingerprint-1" },
    finalizationAttemptId: "final-1",
    finalReviewRound: 1,
    ...overrides,
  };
}

type ReviewRecordSpec =
  | {
      readonly type: "terminal";
      readonly correlation: ReviewCorrelation;
      readonly terminalReason?: string;
      readonly parentSessionId?: string;
      readonly callId?: string;
    }
  | {
      readonly type: "observed";
      readonly correlation?: ReviewCorrelation;
      readonly sessionId?: string;
      readonly reviewScope?: string;
      readonly taskId?: string;
      readonly items?: readonly unknown[];
      readonly isCompleteSnapshot?: boolean;
    };

/**
 * Review dispatch/observation records in a dedicated writer shard, mirroring the
 * Review Artifact path: pending -> claimed -> terminal dispatch transitions and a
 * correlation-bearing review_observed snapshot written under the parent session.
 */
function reviewRecords(specs: readonly ReviewRecordSpec[]): readonly PersistedLogRecord[] {
  let sequence = 0;
  const envelope = (sessionId = "session-1"): Record<string, unknown> => ({
    schemaVersion: 1,
    sequence: ++sequence,
    timestamp: `2026-09-18T00:01:${String(sequence).padStart(2, "0")}.000Z`,
    agentId: "atlas",
    sessionId,
    writerId: "review-writer",
    recordType: "observation",
  });
  const records: unknown[] = [];
  for (const spec of specs) {
    if (spec.type === "terminal") {
      const parentSessionId = spec.parentSessionId ?? "session-1";
      const callId = spec.callId ?? `call-${sequence + 1}`;
      const expectedCategory =
        spec.correlation.reviewKind === "task-review" ? "sp-review" : "sp-final-review";
      const base = {
        kind: "review_dispatch_transition",
        parentSessionId,
        correlation: spec.correlation,
        expectedCategory,
      };
      records.push(
        { ...envelope(), ...base, transitionId: `t-${sequence}`, from: null, to: "pending" },
        {
          ...envelope(),
          ...base,
          transitionId: `t-${sequence}`,
          from: "pending",
          to: "claimed",
          callId,
          artifactReservation: { status: "unusable", reason: "test" },
        },
        {
          ...envelope(),
          ...base,
          transitionId: `t-${sequence}`,
          from: "claimed",
          to: "terminal",
          callId,
          terminalReason: spec.terminalReason ?? "completed",
        },
      );
    } else {
      const taskId =
        spec.taskId ??
        (spec.correlation?.reviewKind === "task-review"
          ? spec.correlation.taskExecutionRef.taskId
          : undefined);
      records.push({
        ...envelope(spec.sessionId),
        ...(taskId === undefined ? {} : { taskId }),
        kind: "review_observed",
        reviewScope: spec.reviewScope ?? (taskId === undefined ? "final" : `task:${taskId}`),
        isCompleteSnapshot: spec.isCompleteSnapshot ?? true,
        ...(spec.correlation === undefined ? {} : { correlation: spec.correlation }),
        items: spec.items ?? [],
      });
    }
  }
  return records as readonly PersistedLogRecord[];
}

function taskTransitionRecords(): readonly PersistedLogRecord[] {
  const states = [
    ["pending", "authorized"],
    ["authorized", "in_progress"],
    ["in_progress", "worker_reported"],
    ["worker_reported", "evidence_pending"],
    ["evidence_pending", "review_pending"],
    ["review_pending", "gate_pending"],
  ] as const;
  return [
    ...states.map(([from, to], index) => ({
      schemaVersion: 1,
      sequence: index + 1,
      timestamp: `2026-09-18T00:00:0${index + 1}.000Z`,
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "writer-1",
      recordType: "observation",
      taskId: "task-1",
      kind: "task_lifecycle_transition",
      parentSessionId: "session-1",
      taskExecutionRef: ref,
      from,
      to,
    })),
  ] as unknown as readonly PersistedLogRecord[];
}

/** Task at gate_pending with a clean completed Round 1 terminal and matching observation. */
function lifecycleRecords(): readonly PersistedLogRecord[] {
  return [
    ...taskTransitionRecords(),
    {
      schemaVersion: 1,
      sequence: 7,
      timestamp: "2026-09-18T00:00:07.000Z",
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "writer-1",
      recordType: "observation",
      taskId: "task-1",
      kind: "review_observed",
      reviewScope: "task:task-1",
      correlation: taskCorrelation(1),
      items: [],
      isCompleteSnapshot: true,
    } as unknown as PersistedLogRecord,
    ...reviewRecords([{ type: "terminal", correlation: taskCorrelation(1) }]),
  ];
}

function planTransitionRecords(): readonly PersistedLogRecord[] {
  const states = [
    ["tasks_pending", "all_tasks_accepted"],
    ["all_tasks_accepted", "final_review_pending"],
    ["final_review_pending", "final_gate_pending"],
  ] as const;
  return [
    ...states.map(([from, to], index) => ({
      schemaVersion: 1,
      sequence: index + 1,
      timestamp: `2026-09-18T00:00:0${index + 1}.000Z`,
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "writer-1",
      recordType: "observation",
      kind: "plan_finalization_transition",
      parentSessionId: "session-1",
      authorizationId: "auth-1",
      planPath: "plan.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      from,
      to,
    })),
  ] as unknown as readonly PersistedLogRecord[];
}

/** Plan at final_gate_pending with a clean completed Final Round 1 terminal and observation. */
function planLifecycleRecords(): readonly PersistedLogRecord[] {
  return [
    ...planTransitionRecords(),
    {
      schemaVersion: 1,
      sequence: 4,
      timestamp: "2026-09-18T00:00:04.000Z",
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "writer-1",
      recordType: "observation",
      kind: "review_observed",
      reviewScope: "final",
      correlation: finalCorrelation(),
      items: [],
      isCompleteSnapshot: true,
    } as unknown as PersistedLogRecord,
    ...reviewRecords([{ type: "terminal", correlation: finalCorrelation() }]),
  ];
}

function planGateRecord(verdict: "PASS" | "FAIL" = "PASS"): PersistedLogRecord {
  return {
    ...planLifecycleRecords()[0],
    sequence: 5,
    recordType: "decision",
    gateType: "plan",
    authorizationId: "auth-1",
    planPath: "plan.md",
    finalizationAttemptId: "final-1",
    finalReviewRound: 1,
    verdict,
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults: [],
  } as unknown as PersistedLogRecord;
}

function planAcceptanceRecord(
  verdict: "complete" | "rework-required" | "blocked" = "complete",
): PersistedLogRecord {
  return {
    ...planLifecycleRecords()[0],
    sequence: 6,
    recordType: "decision",
    kind: "plan-acceptance",
    authorizationId: "auth-1",
    planPath: "plan.md",
    finalizationAttemptId: "final-1",
    finalReviewRound: 1,
    verdict,
  } as unknown as PersistedLogRecord;
}

function planGateEvaluation(
  verdict: "PASS" | "FAIL" = "PASS",
): GateEvaluationDependencies["evaluateRules"] {
  return async () => ({
    recordType: "decision",
    gateType: "plan",
    verdict,
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    authorizationId: "auth-1",
    planPath: "plan.md",
    finalizationAttemptId: "final-1",
    finalReviewRound: 1,
    ruleResults: [],
  });
}

function context(): Extract<GatePendingAttemptContext, { readonly scope: "task" }> {
  return {
    scope: "task",
    trigger: "task_complete",
    parentSessionId: "session-1",
    taskExecutionRef: ref,
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
  };
}

function planContext(): Extract<GatePendingAttemptContext, { readonly scope: "plan" }> {
  return {
    scope: "plan",
    trigger: "final_review_complete",
    parentSessionId: "session-1",
    authorizationId: "auth-1",
    planPath: "plan.md",
    finalizationAttemptId: "final-1",
    finalReviewRound: 1,
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
  };
}

function dependencies(
  evaluateRules: GateEvaluationDependencies["evaluateRules"],
  appendTaskLifecycleTransition: GateEvaluationDependencies["appendTaskLifecycleTransition"],
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"] = async () =>
    authorization,
  appendDecision?: GateEvaluationDependencies["appendDecision"],
  withAuthorizationReviewBoundary: GateEvaluationDependencies["withAuthorizationReviewBoundary"] = async (
    _parentSessionId,
    operation,
  ) => operation(),
): {
  readonly dependencies: GateEvaluationDependencies;
  readonly decisions: PendingDecisionRecord[];
} {
  const decisions: PendingDecisionRecord[] = [];
  return {
    decisions,
    dependencies: {
      readDurableRecords: async () => lifecycleRecords(),
      appendDecision:
        appendDecision ??
        (async (record) => {
          decisions.push(record);
          return { kind: "committed" };
        }),
      findAuthorizationById,
      withAuthorizationReviewBoundary,
      appendTaskLifecycleTransition,
      appendPlanFinalizationTransition: async () => ({ kind: "committed" }),
      evaluateRules,
      recordAdvisory: async () => undefined,
    },
  };
}

function authoritativeGateRecord(): PersistedLogRecord {
  return {
    ...lifecycleRecords()[0],
    sequence: 8,
    recordType: "decision",
    gateType: "task",
    taskId: "task-1",
    taskExecutionRef: ref,
    verdict: "PASS",
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    ruleResults: [],
  } as unknown as PersistedLogRecord;
}

function taskAcceptanceRecord(
  verdict: "accepted" | "rework-required" | "blocked" = "accepted",
): PersistedLogRecord {
  return {
    ...lifecycleRecords()[0],
    sequence: 9,
    recordType: "decision",
    kind: "task-acceptance",
    taskId: "task-1",
    taskExecutionRef: ref,
    verdict,
  } as unknown as PersistedLogRecord;
}

function barrierDependencies(
  initialRecords: readonly PersistedLogRecord[],
  evaluateRules: GateEvaluationDependencies["evaluateRules"],
  callers: number,
): {
  readonly dependencies: GateEvaluationDependencies;
  readonly decisions: PendingDecisionRecord[];
  readonly lifecycleTransitions: string[];
  readonly ready: Promise<void>;
  readonly releaseBoundary: () => void;
  readonly evaluationEntered: Promise<void>;
  readonly releaseEvaluation: () => void;
  readonly evaluationCount: () => number;
} {
  let records = [...initialRecords];
  const decisions: PendingDecisionRecord[] = [];
  const lifecycleTransitions: string[] = [];
  let arrivals = 0;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let releaseBoundary: () => void = () => undefined;
  const boundaryReleased = new Promise<void>((resolve) => {
    releaseBoundary = resolve;
  });
  let resolveEvaluationEntered: () => void = () => undefined;
  const evaluationEntered = new Promise<void>((resolve) => {
    resolveEvaluationEntered = resolve;
  });
  let releaseEvaluation: () => void = () => undefined;
  const evaluationReleased = new Promise<void>((resolve) => {
    releaseEvaluation = resolve;
  });
  let evaluationCountValue = 0;
  const wrappedEvaluateRules: GateEvaluationDependencies["evaluateRules"] = async (input) => {
    evaluationCountValue += 1;
    if (evaluationCountValue === 1) {
      resolveEvaluationEntered();
      await evaluationReleased;
    }
    return evaluateRules(input);
  };
  const appendRecord = async (record: PendingDecisionRecord) => {
    decisions.push(record);
    records = [
      ...records,
      { ...record, sequence: records.length + 1 } as unknown as PersistedLogRecord,
    ];
    return { kind: "committed" as const };
  };
  return {
    decisions,
    lifecycleTransitions,
    ready,
    releaseBoundary,
    evaluationEntered,
    releaseEvaluation,
    evaluationCount: () => evaluationCountValue,
    dependencies: {
      readDurableRecords: async () => records,
      appendDecision: appendRecord,
      findAuthorizationById: async () => authorization,
      withAuthorizationReviewBoundary: async (_parentSessionId, operation) => {
        arrivals += 1;
        if (arrivals === callers) resolveReady();
        await boundaryReleased;
        return operation();
      },
      appendTaskLifecycleTransition: async (input) => {
        lifecycleTransitions.push(input.to);
        records = [
          ...records,
          {
            ...lifecycleRecords()[0],
            sequence: records.length + 1,
            from: input.from,
            to: input.to,
          } as unknown as PersistedLogRecord,
        ];
        return { kind: "committed" };
      },
      appendPlanFinalizationTransition: async () => ({ kind: "committed" }),
      evaluateRules: wrappedEvaluateRules,
      recordAdvisory: async () => undefined,
    },
  };
}

function planDependencies(
  records: readonly PersistedLogRecord[],
  evaluateRules: GateEvaluationDependencies["evaluateRules"],
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"] = async () =>
    authorization,
  appendDecision?: GateEvaluationDependencies["appendDecision"],
  appendPlanFinalizationTransition: GateEvaluationDependencies["appendPlanFinalizationTransition"] = async () => ({
    kind: "committed",
  }),
): {
  readonly dependencies: GateEvaluationDependencies;
  readonly decisions: PendingDecisionRecord[];
} {
  const decisions: PendingDecisionRecord[] = [];
  return {
    decisions,
    dependencies: {
      readDurableRecords: async () => records,
      appendDecision:
        appendDecision ??
        (async (record) => {
          decisions.push(record);
          return { kind: "committed" };
        }),
      findAuthorizationById,
      withAuthorizationReviewBoundary: async (_parentSessionId, operation) => operation(),
      appendTaskLifecycleTransition: async () => ({ kind: "committed" }),
      appendPlanFinalizationTransition,
      evaluateRules,
      recordAdvisory: async () => undefined,
    },
  };
}

describe("createGatePendingAttemptEvaluator", () => {
  it("excludes a legacy task Gate from current authority and Acceptance", async () => {
    const legacy = {
      schemaVersion: 1,
      sequence: 8,
      timestamp: "2026-09-18T00:00:08.000Z",
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "writer-1",
      recordType: "decision",
      gateType: "task",
      taskId: "task-1",
      verdict: "PASS",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults: [],
    } as unknown as PersistedLogRecord;
    const correlation: ReviewCorrelation = {
      reviewKind: "task-review",
      reviewRound: 1,
      taskExecutionRef: ref,
    };
    expect(findCurrentGateDecision([legacy], correlation)).toEqual({
      kind: "missing",
    });
    const fixture = dependencies(
      async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      async () => ({ kind: "committed" }),
    );
    const originalRead = fixture.dependencies.readDurableRecords;
    const evaluator = createGatePendingAttemptEvaluator({
      ...fixture.dependencies,
      readDurableRecords: async () => [...(await originalRead()), legacy],
    });
    const result = await evaluator.evaluateGatePendingAttempt(context());

    expect(result).toEqual({ kind: "not_applicable" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("serializes overlapping attempts so only one reaches durable acceptance", async () => {
    let records = [...lifecycleRecords()];
    const decisions: PendingDecisionRecord[] = [];
    let enterGate: () => void = () => undefined;
    let releaseGate: () => void = () => undefined;
    const gateEntered = new Promise<void>((resolve) => {
      enterGate = resolve;
    });
    const gateRelease = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let blockedFirstGate = true;
    const deps: GateEvaluationDependencies = {
      readDurableRecords: async () => records,
      appendDecision: async (record) => {
        if (record.recordType === "decision" && "gateType" in record && blockedFirstGate) {
          blockedFirstGate = false;
          enterGate();
          await gateRelease;
        }
        decisions.push(record);
        records = [
          ...records,
          { ...record, sequence: records.length + 1 } as unknown as PersistedLogRecord,
        ];
        return { kind: "committed" };
      },
      findAuthorizationById: async () => authorization,
      withAuthorizationReviewBoundary: async (_parentSessionId, operation) => operation(),
      appendTaskLifecycleTransition: async (input) => {
        records = [
          ...records,
          {
            schemaVersion: 1,
            sequence: records.length + 1,
            timestamp: "2026-09-18T00:00:08.000Z",
            agentId: "atlas",
            sessionId: "session-1",
            writerId: "writer-1",
            recordType: "observation",
            taskId: "task-1",
            kind: "task_lifecycle_transition",
            parentSessionId: "session-1",
            taskExecutionRef: ref,
            from: input.from,
            to: input.to,
          } as unknown as PersistedLogRecord,
        ];
        return { kind: "committed" };
      },
      appendPlanFinalizationTransition: async () => ({ kind: "committed" }),
      evaluateRules: async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      recordAdvisory: async () => undefined,
    };
    const evaluator = createGatePendingAttemptEvaluator(deps);
    const first = evaluator.evaluateGatePendingAttempt(context());
    await gateEntered;
    const second = evaluator.evaluateGatePendingAttempt(context());
    releaseGate();

    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.kind === "decided")).toHaveLength(1);
    expect(
      decisions.filter((record) => "kind" in record && record.kind === "task-acceptance"),
    ).toHaveLength(1);
  });

  it("coordinates two callers at the public boundary without duplicate decisions", async () => {
    const fixture = barrierDependencies(
      lifecycleRecords(),
      async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      2,
    );
    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const first = evaluator.evaluateGatePendingAttempt(context());
    const second = evaluator.evaluateGatePendingAttempt(context());
    await fixture.ready;
    fixture.releaseBoundary();
    await fixture.evaluationEntered;
    fixture.releaseEvaluation();

    const results = await Promise.all([first, second]);
    expect(fixture.evaluationCount()).toBe(1);
    expect(fixture.decisions.filter((record) => "gateType" in record)).toHaveLength(1);
    expect(fixture.decisions.filter((record) => "kind" in record)).toHaveLength(1);
    expect(fixture.lifecycleTransitions).toEqual(["accepted"]);
    expect(
      results.some((result) => result.kind === "blocked" && result.advisory.includes("integrity")),
    ).toBe(false);
  });

  it("recovers one acceptance from one durable GateDecision under overlap", async () => {
    const fixture = barrierDependencies(
      [...lifecycleRecords(), authoritativeGateRecord()],
      async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      2,
    );
    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const first = evaluator.evaluateGatePendingAttempt(context());
    const second = evaluator.evaluateGatePendingAttempt(context());
    await fixture.ready;
    fixture.releaseBoundary();

    const results = await Promise.all([first, second]);
    expect(fixture.decisions.filter((record) => "kind" in record)).toHaveLength(1);
    expect(fixture.lifecycleTransitions).toEqual(["accepted"]);
    expect(results.some((result) => result.kind === "blocked")).toBe(false);
  });

  it("cleans the identity tail after three overlapping calls", async () => {
    const fixture = barrierDependencies(
      lifecycleRecords(),
      async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      3,
    );
    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const calls = [
      evaluator.evaluateGatePendingAttempt(context()),
      evaluator.evaluateGatePendingAttempt(context()),
      evaluator.evaluateGatePendingAttempt(context()),
    ];
    await fixture.ready;
    fixture.releaseBoundary();
    await fixture.evaluationEntered;
    fixture.releaseEvaluation();
    await Promise.all(calls);

    const followUp = await evaluator.evaluateGatePendingAttempt(context());
    expect(followUp.kind).toBe("not_applicable");
    expect(fixture.evaluationCount()).toBe(1);
  });

  it.each([
    {
      name: "evaluator failure",
      outcome: (async () => {
        throw new Error("gate failed");
      }) as GateEvaluationDependencies["evaluateRules"],
    },
    {
      name: "insufficient evidence",
      outcome: (async () => ({
        kind: "insufficient_evidence",
        reason: "missing evidence" as const,
      })) as GateEvaluationDependencies["evaluateRules"],
    },
  ])("deduplicates blocked AcceptanceDecision for concurrent $name", async ({ outcome }) => {
    const fixture = barrierDependencies(lifecycleRecords(), outcome, 2);
    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const first = evaluator.evaluateGatePendingAttempt(context());
    const second = evaluator.evaluateGatePendingAttempt(context());
    await fixture.ready;
    fixture.releaseBoundary();
    await fixture.evaluationEntered;
    fixture.releaseEvaluation();

    await Promise.all([first, second]);
    expect(fixture.decisions.filter((record) => "kind" in record)).toHaveLength(1);
    expect(fixture.lifecycleTransitions).toHaveLength(0);
  });

  it("allows an unrelated identity to enter while the first identity is paused", async () => {
    const otherContext = (): Extract<GatePendingAttemptContext, { readonly scope: "task" }> => ({
      ...context(),
      parentSessionId: "session-2",
      taskExecutionRef: { ...ref, authorizationId: "auth-2", taskId: "task-2" },
      sessionId: "session-2",
    });
    let firstEvaluation = true;
    let releaseFirst: () => void = () => undefined;
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let otherEntered = false;
    const boundary: GateEvaluationDependencies["withAuthorizationReviewBoundary"] = async (
      _parentSessionId,
      operation,
    ) => {
      otherEntered = true;
      return operation();
    };
    const fixture = dependencies(
      async () => {
        if (firstEvaluation) {
          firstEvaluation = false;
          await firstPaused;
        }
        return {
          recordType: "decision",
          gateType: "task",
          verdict: "PASS",
          reachableEnforcementLevel: "L1",
          appliedEnforcementLevel: "L0",
          taskId: "task-1",
          taskExecutionRef: ref,
          ruleResults: [],
        };
      },
      async () => ({ kind: "committed" }),
      undefined,
      undefined,
      boundary,
    );
    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const first = evaluator.evaluateGatePendingAttempt(context());
    await Promise.resolve();
    const other = evaluator.evaluateGatePendingAttempt(otherContext());
    await Promise.resolve();
    expect(otherEntered).toBe(true);
    releaseFirst();
    await Promise.all([first, other]);
  });

  it("blocks without an acceptance decision when lifecycle append fails", async () => {
    const fixture = dependencies(
      async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      async () => ({ kind: "failed" }),
    );

    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const result = await evaluator.evaluateGatePendingAttempt(context());

    expect(result).toEqual({ kind: "blocked", advisory: "lifecycle_append_failed" });
    expect(fixture.decisions).toHaveLength(2);
    expect(fixture.decisions[0] && "gateType" in fixture.decisions[0]).toBe(true);
    expect(fixture.decisions[1] && "kind" in fixture.decisions[1]).toBe(true);
  });

  it("keeps lifecycle pending when AcceptanceDecision append fails", async () => {
    const lifecycle: string[] = [];
    let appendCount = 0;
    const fixture = dependencies(
      async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      async (input) => {
        lifecycle.push(input.to);
        return { kind: "committed" };
      },
      undefined,
      async () => {
        appendCount += 1;
        return appendCount === 1 ? { kind: "committed" } : { kind: "failed" };
      },
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(context());

    expect(result).toEqual({ kind: "blocked", advisory: "acceptance_append_failed" });
    expect(lifecycle).toEqual([]);
  });

  it("evaluates a plan final gate and appends plan acceptance", async () => {
    const lifecycleTransitions: string[] = [];
    const fixture = planDependencies(
      planLifecycleRecords(),
      async () => ({
        recordType: "decision",
        gateType: "plan",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        authorizationId: "auth-1",
        planPath: "plan.md",
        finalizationAttemptId: "final-1",
        finalReviewRound: 1,
        ruleResults: [],
      }),
      undefined,
      undefined,
      async (input) => {
        lifecycleTransitions.push(input.to);
        return { kind: "committed" };
      },
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result.kind).toBe("decided");
    expect(fixture.decisions).toHaveLength(2);
    expect(fixture.decisions[0]).toMatchObject({ gateType: "plan", verdict: "PASS" });
    expect(fixture.decisions[1]).toMatchObject({
      kind: "plan-acceptance",
      verdict: "complete",
    });
    expect(lifecycleTransitions).toEqual(["complete"]);
  });

  it("recovers a plan acceptance from an existing plan GateDecision", async () => {
    const lifecycleTransitions: string[] = [];
    const fixture = planDependencies(
      [...planLifecycleRecords(), planGateRecord()],
      async () => {
        throw new Error("evaluateRules should not run when a GateDecision exists");
      },
      undefined,
      undefined,
      async (input) => {
        lifecycleTransitions.push(input.to);
        return { kind: "committed" };
      },
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result.kind).toBe("decided");
    expect(fixture.decisions).toHaveLength(1);
    expect(fixture.decisions[0]).toMatchObject({
      kind: "plan-acceptance",
      verdict: "complete",
    });
    expect(lifecycleTransitions).toEqual(["complete"]);
  });

  it("appends a blocked plan acceptance when Gate evaluation is blocked", async () => {
    const fixture = planDependencies(planLifecycleRecords(), async () => ({
      kind: "insufficient_evidence",
      reason: "missing final evidence",
    }));

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "gate_evaluation_blocked" });
    expect(fixture.decisions).toHaveLength(1);
    expect(fixture.decisions[0]).toMatchObject({
      kind: "plan-acceptance",
      verdict: "blocked",
    });
  });

  it("blocks before appending a plan GateDecision when the append fails", async () => {
    const fixture = planDependencies(
      planLifecycleRecords(),
      planGateEvaluation(),
      undefined,
      async () => ({ kind: "failed" }),
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "gate_decision_append_failed" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("blocks before appending a plan GateDecision when authorization becomes inactive", async () => {
    let lookupCount = 0;
    const fixture = planDependencies(planLifecycleRecords(), planGateEvaluation(), async () => {
      lookupCount += 1;
      return lookupCount < 3
        ? authorization
        : ({ ...authorization, status: "released" } as ApprovedPlanBinding);
    });

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "review_authorization_not_active" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("blocks when recovering plan acceptance cannot be appended", async () => {
    const fixture = planDependencies(
      [...planLifecycleRecords(), planGateRecord()],
      async () => {
        throw new Error("evaluateRules should not run when a GateDecision exists");
      },
      undefined,
      async () => ({ kind: "failed" }),
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "acceptance_append_failed" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("blocks when recovering plan lifecycle cannot be appended", async () => {
    const fixture = planDependencies(
      [...planLifecycleRecords(), planGateRecord()],
      async () => {
        throw new Error("evaluateRules should not run when a GateDecision exists");
      },
      undefined,
      undefined,
      async () => ({ kind: "failed" }),
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "lifecycle_append_failed" });
    expect(fixture.decisions).toHaveLength(1);
  });

  it("blocks an existing plan GateDecision when authorization becomes inactive before acceptance", async () => {
    let lookupCount = 0;
    const fixture = planDependencies(
      [...planLifecycleRecords(), planGateRecord()],
      async () => {
        throw new Error("evaluateRules should not run when a GateDecision exists");
      },
      async () => {
        lookupCount += 1;
        return lookupCount < 3
          ? authorization
          : ({ ...authorization, status: "released" } as ApprovedPlanBinding);
      },
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "review_authorization_not_active" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("does not append blocked acceptance when authorization becomes inactive after gate evaluation fails", async () => {
    let lookupCount = 0;
    const fixture = planDependencies(
      planLifecycleRecords(),
      async () => {
        throw new Error("gate failed");
      },
      async () => {
        lookupCount += 1;
        return lookupCount < 3
          ? authorization
          : ({ ...authorization, status: "released" } as ApprovedPlanBinding);
      },
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "review_authorization_not_active" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("does not append blocked acceptance when authorization becomes inactive after a blocked evaluation", async () => {
    let lookupCount = 0;
    const fixture = planDependencies(
      planLifecycleRecords(),
      async () => ({ kind: "insufficient_evidence", reason: "missing final evidence" }),
      async () => {
        lookupCount += 1;
        return lookupCount < 3
          ? authorization
          : ({ ...authorization, status: "released" } as ApprovedPlanBinding);
      },
    );

    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "review_authorization_not_active" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("reports acceptance append failure when blocked acceptance records conflict", async () => {
    let readCount = 0;
    const fixture = planDependencies(planLifecycleRecords(), async () => ({
      kind: "insufficient_evidence",
      reason: "missing final evidence",
    }));
    const evaluator = createGatePendingAttemptEvaluator({
      ...fixture.dependencies,
      readDurableRecords: async () => {
        readCount += 1;
        return readCount === 1
          ? planLifecycleRecords()
          : [
              ...planLifecycleRecords(),
              planAcceptanceRecord(),
              { ...planAcceptanceRecord(), sequence: 7 },
            ];
      },
    });

    const result = await evaluator.evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "acceptance_append_failed" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("reports acceptance append failure when a failed gate evaluation finds conflicting blocked acceptances", async () => {
    let readCount = 0;
    const fixture = planDependencies(planLifecycleRecords(), async () => {
      throw new Error("gate failed");
    });
    const evaluator = createGatePendingAttemptEvaluator({
      ...fixture.dependencies,
      readDurableRecords: async () => {
        readCount += 1;
        return readCount === 1
          ? planLifecycleRecords()
          : [
              ...planLifecycleRecords(),
              planAcceptanceRecord(),
              { ...planAcceptanceRecord(), sequence: 7 },
            ];
      },
    });

    const result = await evaluator.evaluateGatePendingAttempt(planContext());

    expect(result).toEqual({ kind: "blocked", advisory: "acceptance_append_failed" });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("degrades to a blocked result when durable records cannot be read", async () => {
    const fixture = planDependencies(planLifecycleRecords(), planGateEvaluation());
    const evaluator = createGatePendingAttemptEvaluator({
      ...fixture.dependencies,
      readDurableRecords: async () => {
        throw new Error("read failed");
      },
    });

    await expect(evaluator.evaluateGatePendingAttempt(planContext())).resolves.toEqual({
      kind: "blocked",
      advisory: "gate_evaluation_failed",
    });
  });

  it("appends exactly one blocked acceptance when Gate evaluation is blocked", async () => {
    const fixture = dependencies(
      async () => ({ kind: "insufficient_evidence", reason: "missing test evidence" }),
      async () => ({ kind: "committed" }),
    );

    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const result = await evaluator.evaluateGatePendingAttempt(context());

    expect(result).toEqual({ kind: "blocked", advisory: "gate_evaluation_blocked" });
    expect(fixture.decisions).toHaveLength(1);
    expect(fixture.decisions[0]).toMatchObject({ kind: "task-acceptance", verdict: "blocked" });
  });

  it("does not append a GateDecision after authorization becomes inactive", async () => {
    let lookupCount = 0;
    const fixture = dependencies(
      async () => ({
        recordType: "decision",
        gateType: "task",
        verdict: "PASS",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        taskExecutionRef: ref,
        ruleResults: [],
      }),
      async () => ({ kind: "committed" }),
      async () => {
        lookupCount += 1;
        // Lookups: 1 active binding (F-001 admission), 2 pre-evaluation, 3 pre-Gate append,
        // 4 pre-Acceptance append -> released after the Gate is durable.
        return lookupCount < 4
          ? authorization
          : ({ ...authorization, status: "released" } as ApprovedPlanBinding);
      },
    );

    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const result = await evaluator.evaluateGatePendingAttempt(context());

    expect(result.kind).toBe("blocked");
    expect(fixture.decisions).toHaveLength(1);
    expect(fixture.decisions[0] && "gateType" in fixture.decisions[0]).toBe(true);
  });

  it("returns the existing GateDecision when acceptance is already durable", async () => {
    const fixture = dependencies(
      async () => {
        throw new Error("evaluateRules should not run when both decisions exist");
      },
      async () => ({ kind: "committed" }),
    );
    const evaluator = createGatePendingAttemptEvaluator({
      ...fixture.dependencies,
      readDurableRecords: async () => [
        ...lifecycleRecords(),
        authoritativeGateRecord(),
        taskAcceptanceRecord(),
      ],
    });

    const result = await evaluator.evaluateGatePendingAttempt(context());

    expect(result).toMatchObject({ kind: "decided", decision: { gateType: "task", verdict: "PASS" } });
    expect(fixture.decisions).toHaveLength(0);
  });

  it("blocks when current GateDecision and AcceptanceDecision records conflict", async () => {
    const fixture = dependencies(
      async () => {
        throw new Error("evaluateRules should not run for conflicting decisions");
      },
      async () => ({ kind: "committed" }),
    );
    const evaluator = createGatePendingAttemptEvaluator({
      ...fixture.dependencies,
      readDurableRecords: async () => [
        ...lifecycleRecords(),
        authoritativeGateRecord(),
        taskAcceptanceRecord(),
        { ...taskAcceptanceRecord(), sequence: 10 },
      ],
    });

    await expect(evaluator.evaluateGatePendingAttempt(context())).resolves.toEqual({
      kind: "blocked",
      advisory: "decision_integrity_violation",
    });
  });

  it("blocks before gate evaluation when the task authorization is inactive", async () => {
    const fixture = dependencies(
      async () => {
        throw new Error("evaluateRules should not run for an inactive authorization");
      },
      async () => ({ kind: "committed" }),
      async () => null,
    );

    await expect(
      createGatePendingAttemptEvaluator(fixture.dependencies).evaluateGatePendingAttempt(context()),
    ).resolves.toEqual({ kind: "blocked", advisory: "review_authorization_not_active" });
    expect(fixture.decisions).toHaveLength(0);
  });
});

describe("authorization identity", () => {
  it("matches equal task review correlations", () => {
    const correlation: ReviewCorrelation = {
      reviewKind: "task-review",
      reviewRound: 1,
      taskExecutionRef: ref,
    };

    expect(sameReviewCorrelation(correlation, { ...correlation })).toBe(true);
  });

  it("does not match task and final review correlations", () => {
    const taskCorrelation: ReviewCorrelation = {
      reviewKind: "task-review",
      reviewRound: 1,
      taskExecutionRef: ref,
    };
    const finalCorrelation = {
      reviewKind: "final-review",
      authorizationId: "auth-1",
      planPath: "plan.md",
      planFingerprint: { algorithm: "sha256", value: "fingerprint-1" },
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
    } as unknown as ReviewCorrelation;

    expect(sameReviewCorrelation(taskCorrelation, finalCorrelation)).toBe(false);
  });

  it("fails closed for an unknown review correlation kind", () => {
    const unknown = { reviewKind: "unknown" } as unknown as ReviewCorrelation;

    expect(sameReviewCorrelation(unknown, unknown)).toBe(false);
  });

  it("fails closed when authorization lookup throws", async () => {
    const correlation: ReviewCorrelation = {
      reviewKind: "task-review",
      reviewRound: 1,
      taskExecutionRef: ref,
    };

    await expect(
      isCurrentActiveAuthorization(correlation, async () => {
        throw new Error("authorization lookup failed");
      }),
    ).resolves.toBe(false);
  });

  it("compares the Final Review fingerprint algorithm and value", async () => {
    const correlation = {
      reviewKind: "final-review",
      authorizationId: "auth-1",
      planPath: "plan.md",
      planFingerprint: { algorithm: "sha512", value: "fingerprint-1" },
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
    } as unknown as Parameters<typeof isCurrentActiveAuthorization>[0];

    await expect(
      isCurrentActiveAuthorization(correlation, async () => authorization),
    ).resolves.toBe(false);
  });

  it("derives plan rework acceptance from a failing GateDecision", () => {
    const gate = {
      recordType: "decision",
      gateType: "plan",
      verdict: "FAIL",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      authorizationId: "auth-1",
      planPath: "plan.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      ruleResults: [],
    } satisfies Extract<
      Parameters<typeof deriveAcceptanceDecision>[0],
      { readonly gateType: "plan" }
    >;

    expect(deriveAcceptanceDecision(gate)).toEqual({
      recordType: "decision",
      kind: "plan-acceptance",
      authorizationId: "auth-1",
      planPath: "plan.md",
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
      verdict: "rework-required",
    });
  });

  it("reports conflicts among current GateDecision and AcceptanceDecision records", () => {
    const correlation: ReviewCorrelation = {
      reviewKind: "task-review",
      reviewRound: 1,
      taskExecutionRef: ref,
    };
    const firstGate = authoritativeGateRecord();
    const secondGate = { ...firstGate, sequence: 9 };
    const firstAcceptance = {
      ...lifecycleRecords()[0],
      sequence: 8,
      recordType: "decision",
      kind: "task-acceptance",
      taskId: "task-1",
      taskExecutionRef: ref,
      verdict: "accepted",
    } as unknown as PersistedLogRecord;
    const secondAcceptance = { ...firstAcceptance, sequence: 10 };

    expect(findCurrentGateDecision([firstGate, secondGate], correlation)).toEqual({
      kind: "conflict",
      advisory: "multiple current GateDecision records",
    });
    expect(findCurrentAcceptanceDecision([firstAcceptance, secondAcceptance], correlation)).toEqual(
      {
        kind: "conflict",
        advisory: "multiple current AcceptanceDecision records",
      },
    );
  });

  it("does not treat Final Review correlations with different algorithms as equal", () => {
    const left = {
      reviewKind: "final-review",
      authorizationId: "auth-1",
      planPath: "plan.md",
      planFingerprint: { algorithm: "sha256", value: "same" },
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
    } as unknown as ReviewCorrelation;
    const right = {
      ...left,
      planFingerprint: { algorithm: "sha512", value: "same" },
    } as unknown as ReviewCorrelation;

    expect(sameReviewCorrelation(left, right)).toBe(false);
  });
});

describe("current review correlation admission (F-001)", () => {
  const activeBinding = authorization as Extract<ApprovedPlanBinding, { readonly status: "active" }>;
  const passingTaskGate = {
    recordType: "decision",
    gateType: "task",
    verdict: "PASS",
    reachableEnforcementLevel: "L1",
    appliedEnforcementLevel: "L0",
    taskId: "task-1",
    taskExecutionRef: ref,
    ruleResults: [],
  } as const;

  type EvaluationOutcome = {
    readonly result: GatePendingAttemptResult;
    readonly decisions: readonly PendingDecisionRecord[];
    readonly calls: number;
  };

  function countingEvaluator(
    evaluate: GateEvaluationDependencies["evaluateRules"],
  ): { readonly evaluateRules: GateEvaluationDependencies["evaluateRules"]; readonly calls: () => number } {
    let calls = 0;
    return {
      evaluateRules: async (input): ReturnType<GateEvaluationDependencies["evaluateRules"]> => {
        calls += 1;
        return evaluate(input);
      },
      calls: (): number => calls,
    };
  }

  async function runTask(
    records: readonly PersistedLogRecord[],
    taskContext: GatePendingAttemptContext = context(),
  ): Promise<EvaluationOutcome> {
    const counter = countingEvaluator(async () => passingTaskGate);
    const fixture = dependencies(counter.evaluateRules, async () => ({ kind: "committed" }));
    const result = await createGatePendingAttemptEvaluator({
      ...fixture.dependencies,
      readDurableRecords: async () => records,
    }).evaluateGatePendingAttempt(taskContext);
    return { result, decisions: fixture.decisions, calls: counter.calls() };
  }

  async function runPlan(records: readonly PersistedLogRecord[]): Promise<EvaluationOutcome> {
    const counter = countingEvaluator(planGateEvaluation());
    const fixture = planDependencies(records, counter.evaluateRules);
    const result = await createGatePendingAttemptEvaluator(
      fixture.dependencies,
    ).evaluateGatePendingAttempt(planContext());
    return { result, decisions: fixture.decisions, calls: counter.calls() };
  }

  function admit(
    records: readonly PersistedLogRecord[],
    admissionContext: GatePendingAttemptContext,
  ): CurrentReviewAdmission {
    return admitCurrentReview(
      admissionContext,
      project(records, "2026-09-18T01:00:00.000Z"),
      records,
      activeBinding,
    );
  }

  it("admits a clean completed terminal round 1 with matching observed correlation", async () => {
    const records = lifecycleRecords();

    expect(admit(records, context())).toEqual({
      kind: "admitted",
      correlation: taskCorrelation(1),
    });
    const { result, decisions, calls } = await runTask(records);
    expect(result).toMatchObject({ kind: "decided", decision: { gateType: "task", verdict: "PASS" } });
    expect(calls).toBe(1);
    expect(decisions.filter((record) => "gateType" in record)).toHaveLength(1);
    expect(
      decisions.filter((record) => "kind" in record && record.kind === "task-acceptance"),
    ).toHaveLength(1);

    const planRecords = planLifecycleRecords();
    expect(admit(planRecords, planContext())).toEqual({
      kind: "admitted",
      correlation: finalCorrelation(),
    });
    const plan = await runPlan(planRecords);
    expect(plan.result.kind).toBe("decided");
    expect(plan.decisions).toHaveLength(2);
  });

  it("admits retry round 2 after failed round 1, without reusing round 1", async () => {
    const retry = [
      ...taskTransitionRecords(),
      ...reviewRecords([
        { type: "terminal", correlation: taskCorrelation(1), terminalReason: "review_incomplete" },
        {
          type: "observed",
          correlation: taskCorrelation(1),
          isCompleteSnapshot: false,
          items: [{ itemKey: "r1", evidenceId: "r1", severity: "major", summary: "s", location: "l", status: "open" }],
        },
        { type: "terminal", correlation: taskCorrelation(2) },
        { type: "observed", correlation: taskCorrelation(2) },
      ]),
    ];

    expect(admit(retry, context())).toEqual({ kind: "admitted", correlation: taskCorrelation(2) });
    const admitted = await runTask(retry);
    expect(admitted.result).toMatchObject({ kind: "decided" });
    expect(admitted.calls).toBe(1);

    // A clean Round 1 snapshot must not stand in for the current Round 2 terminal.
    const staleSnapshot = [
      ...taskTransitionRecords(),
      ...reviewRecords([
        { type: "terminal", correlation: taskCorrelation(1), terminalReason: "review_incomplete" },
        { type: "observed", correlation: taskCorrelation(1) },
        { type: "terminal", correlation: taskCorrelation(2) },
      ]),
    ];
    expect(admit(staleSnapshot, context()).kind).toBe("not_proven");
    const stale = await runTask(staleSnapshot);
    expect(stale.result).toEqual({ kind: "blocked", advisory: "review_correlation_not_proven" });
    expect(stale.calls).toBe(0);
    expect(stale.decisions).toHaveLength(0);
  });

  it("rejects wrong parentSessionId, attempt, finalization, round, or missing terminal/observed correlation", async () => {
    const otherAttempt: TaskExecutionRef = { ...ref, attemptId: "attempt-0" };
    const taskCases: ReadonlyArray<{
      readonly name: string;
      readonly specs: readonly ReviewRecordSpec[];
      readonly context?: GatePendingAttemptContext;
    }> = [
      {
        name: "context parentSessionId differs from the active authorization session",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1) },
          { type: "observed", correlation: taskCorrelation(1) },
        ],
        context: { ...context(), parentSessionId: "session-other" },
      },
      {
        name: "terminal slot belongs to another parent session",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1), parentSessionId: "session-other" },
          { type: "observed", correlation: taskCorrelation(1) },
        ],
      },
      {
        name: "observation written under another session",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1) },
          { type: "observed", correlation: taskCorrelation(1), sessionId: "session-other" },
        ],
      },
      {
        name: "terminal and observation from an old attempt",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1, otherAttempt) },
          { type: "observed", correlation: taskCorrelation(1, otherAttempt) },
        ],
      },
      {
        name: "observation round differs from the terminal round",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1) },
          { type: "observed", correlation: taskCorrelation(2) },
        ],
      },
      { name: "missing terminal", specs: [{ type: "observed", correlation: taskCorrelation(1) }] },
      {
        name: "terminal completed with findings",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1), terminalReason: "completed_with_findings" },
          { type: "observed", correlation: taskCorrelation(1) },
        ],
      },
      {
        name: "observation missing correlation",
        specs: [{ type: "terminal", correlation: taskCorrelation(1) }, { type: "observed", taskId: "task-1" }],
      },
      {
        name: "observation with only a legacy session/scope match",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1) },
          { type: "observed", correlation: taskCorrelation(1), reviewScope: "task-1" },
        ],
      },
      {
        name: "incomplete observation snapshot",
        specs: [
          { type: "terminal", correlation: taskCorrelation(1) },
          { type: "observed", correlation: taskCorrelation(1), isCompleteSnapshot: false },
        ],
      },
    ];
    for (const testCase of taskCases) {
      const records = [...taskTransitionRecords(), ...reviewRecords(testCase.specs)];
      const outcome = await runTask(records, testCase.context ?? context());
      expect({ name: testCase.name, ...outcome }).toEqual({
        name: testCase.name,
        result: { kind: "blocked", advisory: "review_correlation_not_proven" },
        decisions: [],
        calls: 0,
      });
    }

    const planCases: ReadonlyArray<{ readonly name: string; readonly specs: readonly ReviewRecordSpec[] }> = [
      {
        name: "terminal from another finalization attempt",
        specs: [
          { type: "terminal", correlation: finalCorrelation({ finalizationAttemptId: "final-0" }) },
          { type: "observed", correlation: finalCorrelation({ finalizationAttemptId: "final-0" }) },
        ],
      },
      {
        name: "terminal final round differs from the gate context round",
        specs: [
          { type: "terminal", correlation: finalCorrelation({ finalReviewRound: 2 }) },
          { type: "observed", correlation: finalCorrelation({ finalReviewRound: 2 }) },
        ],
      },
      { name: "missing final terminal", specs: [{ type: "observed", correlation: finalCorrelation() }] },
      {
        name: "final observation missing correlation",
        specs: [{ type: "terminal", correlation: finalCorrelation() }, { type: "observed" }],
      },
    ];
    for (const testCase of planCases) {
      const outcome = await runPlan([...planTransitionRecords(), ...reviewRecords(testCase.specs)]);
      expect({ name: testCase.name, ...outcome }).toEqual({
        name: testCase.name,
        result: { kind: "blocked", advisory: "review_correlation_not_proven" },
        decisions: [],
        calls: 0,
      });
    }
  });

  it("rejects conflicting completed terminal rounds for the same attempt", async () => {
    const conflicting = [
      ...taskTransitionRecords(),
      ...reviewRecords([
        { type: "terminal", correlation: taskCorrelation(1) },
        { type: "observed", correlation: taskCorrelation(1) },
        { type: "terminal", correlation: taskCorrelation(2) },
        { type: "observed", correlation: taskCorrelation(2) },
      ]),
    ];
    expect(admit(conflicting, context()).kind).toBe("conflict");
    const outcome = await runTask(conflicting);
    expect(outcome).toEqual({
      result: { kind: "blocked", advisory: "review_correlation_conflict" },
      decisions: [],
      calls: 0,
    });

    // A duplicate durable terminal transition for the same round is not silently deduplicated.
    const duplicate = [...lifecycleRecords()];
    const terminal = duplicate.at(-1) as PersistedLogRecord;
    const duplicated = [...duplicate, { ...terminal, sequence: terminal.sequence + 1 }];
    expect(admit(duplicated, context()).kind).toBe("conflict");
  });

  it("does not stop an unrelated task identity that is not round-gated", async () => {
    const unrelated = await runTask(lifecycleRecords(), {
      ...context(),
      taskExecutionRef: { ...ref, taskId: "task-2" },
    });
    expect(unrelated.result).toEqual({ kind: "not_applicable" });
    expect(unrelated.calls).toBe(0);
  });
});
