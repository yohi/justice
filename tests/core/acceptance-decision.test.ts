import { describe, expect, it } from "vitest";
import {
  createGatePendingAttemptEvaluator,
  findCurrentGateDecision,
  isCurrentActiveAuthorization,
  sameReviewCorrelation,
} from "../../src/core/acceptance-decision";
import type { ApprovedPlanBinding } from "../../src/core/plan-authorization";
import type { ReviewCorrelation, TaskExecutionRef } from "../../src/core/types";
import type { GatePendingAttemptContext } from "../../src/core/v2/gate-context";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";
import type { PendingDecisionRecord } from "../../src/core/v2/decision-model";
import type { GateEvaluationDependencies } from "../../src/core/acceptance-decision";

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

function lifecycleRecords(): readonly PersistedLogRecord[] {
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
      reviewScope: "task-1",
      items: [],
      isCompleteSnapshot: true,
    },
  ] as unknown as readonly PersistedLogRecord[];
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

function dependencies(
  evaluateRules: GateEvaluationDependencies["evaluateRules"],
  appendTaskLifecycleTransition: GateEvaluationDependencies["appendTaskLifecycleTransition"],
  findAuthorizationById: GateEvaluationDependencies["findAuthorizationById"] = async () => authorization,
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
      appendDecision: appendDecision ?? (async (record) => {
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
    records = [...records, { ...record, sequence: records.length + 1 } as unknown as PersistedLogRecord];
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
    expect(decisions.filter((record) => "kind" in record && record.kind === "task-acceptance")).toHaveLength(1);
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
    expect(results.some((result) => result.kind === "blocked" && result.advisory.includes("integrity"))).toBe(false);
  });

  it("recovers one acceptance from one durable GateDecision under overlap", async () => {
    const fixture = barrierDependencies([...
      lifecycleRecords(),
      authoritativeGateRecord(),
    ], async () => ({
      recordType: "decision",
      gateType: "task",
      verdict: "PASS",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      taskId: "task-1",
      taskExecutionRef: ref,
      ruleResults: [],
    }), 2);
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
      outcome: (async () => ({ kind: "insufficient_evidence", reason: "missing evidence" as const })) as GateEvaluationDependencies["evaluateRules"],
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

    const result = await createGatePendingAttemptEvaluator(fixture.dependencies).evaluateGatePendingAttempt(
      context(),
    );

    expect(result).toEqual({ kind: "blocked", advisory: "acceptance_append_failed" });
    expect(lifecycle).toEqual([]);
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
        return lookupCount < 3 ? authorization : { ...authorization, status: "released" } as ApprovedPlanBinding;
      },
    );

    const evaluator = createGatePendingAttemptEvaluator(fixture.dependencies);
    const result = await evaluator.evaluateGatePendingAttempt(context());

    expect(result.kind).toBe("blocked");
    expect(fixture.decisions).toHaveLength(1);
    expect(fixture.decisions[0] && "gateType" in fixture.decisions[0]).toBe(true);
  });
});

describe("authorization identity", () => {
  it("compares the Final Review fingerprint algorithm and value", async () => {
    const correlation = {
      reviewKind: "final-review",
      authorizationId: "auth-1",
      planPath: "plan.md",
      planFingerprint: { algorithm: "sha512", value: "fingerprint-1" },
      finalizationAttemptId: "final-1",
      finalReviewRound: 1,
    } as unknown as Parameters<typeof isCurrentActiveAuthorization>[0];

    await expect(isCurrentActiveAuthorization(correlation, async () => authorization)).resolves.toBe(false);
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
