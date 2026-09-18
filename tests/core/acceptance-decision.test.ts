import { describe, expect, it } from "vitest";
import {
  createGatePendingAttemptEvaluator,
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

function context(): GatePendingAttemptContext {
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
): {
  readonly dependencies: GateEvaluationDependencies;
  readonly decisions: PendingDecisionRecord[];
} {
  const decisions: PendingDecisionRecord[] = [];
  return {
    decisions,
    dependencies: {
      readDurableRecords: async () => lifecycleRecords(),
      appendDecision: async (record) => {
        decisions.push(record);
        return { kind: "committed" };
      },
      findAuthorizationById,
      withAuthorizationReviewBoundary: async (_parentSessionId, operation) => operation(),
      appendTaskLifecycleTransition,
      appendPlanFinalizationTransition: async () => ({ kind: "committed" }),
      evaluateRules,
      recordAdvisory: async () => undefined,
    },
  };
}

describe("createGatePendingAttemptEvaluator", () => {
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
    expect(fixture.decisions).toHaveLength(1);
    expect(fixture.decisions[0] && "kind" in fixture.decisions[0]).toBe(false);
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
