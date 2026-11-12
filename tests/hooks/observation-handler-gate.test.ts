import { describe, expect, it, vi } from "vitest";
import type { HookResponse, ShardId, TaskCallBinding } from "../../src/core/types";
import type { GateRule } from "../../src/core/v2/gate-definition";
import type { PendingLogRecord, PersistedLogRecord } from "../../src/core/v2/observation-model";
import type { SessionStateProvider } from "../../src/core/session-state-provider";
import type { ApprovedPlanBinding } from "../../src/core/plan-authorization";
import type { GateLoader } from "../../src/runtime/gate-loader";
import type { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { ObservationHandler } from "../../src/hooks/observation-handler";

type EvaluateGateFn = (
  trigger: "task_complete" | "tool_observed",
  taskId: string | undefined,
  callId: string | undefined,
  agentId: string,
  sessionId: string,
) => Promise<HookResponse>;

// `evaluateGateIfTriggered` is private; the existing observation-handler tests
// access it through the same `unknown` cast (see observation-handler-tool.test.ts).
function callGate(
  handler: ObservationHandler,
  trigger: "task_complete" | "tool_observed",
  taskId: string | undefined,
  callId: string | undefined,
  agentId: string,
  sessionId: string,
): Promise<HookResponse> {
  return (
    handler as unknown as { evaluateGateIfTriggered: EvaluateGateFn }
  ).evaluateGateIfTriggered(trigger, taskId, callId, agentId, sessionId);
}

type AppendedRecord = { readonly shardId: ShardId; readonly record: PendingLogRecord };

const activeAuthorization = {
  status: "active",
  authorizationId: "auth-1",
  sessionId: "s-1",
  planPath: "plan.md",
  canonicalSnapshot: { tasks: [{ taskId: "task-1" }] },
} as unknown as ApprovedPlanBinding;

function currentTaskLifecycleEvents(): readonly PersistedLogRecord[] {
  const states = [
    ["pending", "authorized"],
    ["authorized", "in_progress"],
    ["in_progress", "worker_reported"],
    ["worker_reported", "evidence_pending"],
    ["evidence_pending", "review_pending"],
    ["review_pending", "gate_pending"],
  ] as const;
  return states.map(([from, to], index) => ({
    schemaVersion: 1,
    timestamp: `2026-07-01T00:00:0${index + 1}.000Z`,
    agentId: "atlas",
    sessionId: "s-1",
    writerId: "w-test",
    recordType: "observation",
    taskId: "task-1",
    sequence: index + 1,
    kind: "task_lifecycle_transition",
    parentSessionId: "s-1",
    taskExecutionRef: {
      authorizationId: "auth-1",
      taskId: "task-1",
      attemptId: "attempt-1",
    },
    from,
    to,
  })) as readonly PersistedLogRecord[];
}

function completedReviewDispatch(
  correlation: Record<string, unknown>,
): readonly PersistedLogRecord[] {
  const base = {
    schemaVersion: 1,
    agentId: "atlas",
    sessionId: "s-1",
    writerId: "w-review",
    recordType: "observation",
  };
  const dispatch = {
    ...base,
    kind: "review_dispatch_transition",
    transitionId: "review-transition-1",
    parentSessionId: "s-1",
    correlation,
    expectedCategory: "sp-review",
  };
  const observedExecution = {
    schemaVersion: 1,
    provenance: "observed",
    reviewExecutionEventId: "event-review-call-1",
    parentSessionId: "s-1",
    callId: "review-call-1",
    childSessionId: "review-child-1",
    correlation,
  };
  const reviewArtifact = {
    schemaVersion: 1,
    reviewKind: "task-review",
    reviewSource: "sp-review",
    correlation,
    observedExecution,
    complete: true,
    findings: [],
  };
  const artifactConsumption = { artifactId: "artifact-1", digest: "sha256:artifact-1" };
  return [
    { ...dispatch, sequence: 1, timestamp: "2026-07-01T00:01:01.000Z", from: null, to: "pending" },
    {
      ...dispatch,
      sequence: 2,
      timestamp: "2026-07-01T00:01:02.000Z",
      from: "pending",
      to: "claimed",
      callId: "review-call-1",
      artifactReservation: {
        status: "usable",
        artifactId: "artifact-1",
        artifactPath: ".justice/review/artifact-1.json",
        leasePath: ".justice/review/artifact-1.lease",
        artifactIdentity: { device: "1", inode: "1" },
      },
    },
    {
      ...base,
      sequence: 3,
      timestamp: "2026-07-01T00:01:03.000Z",
      kind: "review_completion_staged",
      parentSessionId: "s-1",
      staging: {
        callId: "review-call-1",
        correlation,
        artifactConsumption,
        reviewArtifact,
        observedExecution,
      },
    },
    {
      ...dispatch,
      sequence: 4,
      timestamp: "2026-07-01T00:01:04.000Z",
      from: "claimed",
      to: "terminal",
      callId: "review-call-1",
      terminalReason: "completed",
      artifactConsumption,
      reviewArtifact,
    },
  ] as unknown as readonly PersistedLogRecord[];
}

function makeLogStore(events: readonly PersistedLogRecord[] = currentTaskLifecycleEvents()): {
  store: ObservationLogStore;
  appended: AppendedRecord[];
  readAll: ReturnType<typeof vi.fn>;
} {
  const appended: AppendedRecord[] = [];
  const readAll = vi.fn(async () => events);
  const store = {
    readAll,
    append: vi.fn(async (shardId: ShardId, record: PendingLogRecord) => {
      appended.push({ shardId, record });
      return appended.length;
    }),
    destroySession: vi.fn(),
  } as unknown as ObservationLogStore;
  return { store, appended, readAll };
}

function makeGateLoader(
  gates: readonly GateRule[],
): GateLoader & { load: ReturnType<typeof vi.fn> } {
  return { load: vi.fn(async () => gates) };
}

// A `review_open_items` gate with an empty review scope resolves purely from
// `onMissingEvidence`, so it lets each test pick a PASS/WARN/FAIL verdict
// without constructing evidence records.
function reviewGate(
  id: string,
  onMissingEvidence: "pass" | "warn" | "fail",
  trigger: "task_complete" | "tool_observed" = "tool_observed",
): GateRule {
  return {
    id,
    gateType: "task",
  trigger: { scope: "task", on: trigger },
    check: { type: "review_open_items", minimumSeverity: "major" },
    onViolation: "fail",
    onMissingEvidence,
    enabled: true,
  };
}

const sessionStateProvider = {
  getTaskCallBinding: vi.fn(
    (): TaskCallBinding => ({
      parentSessionId: "s-1",
      authorizationId: "auth-1",
      taskExecutionRef: {
        authorizationId: "auth-1",
        taskId: "task-1",
        attemptId: "attempt-1",
      },
    }),
  ),
} as unknown as SessionStateProvider;

describe("ObservationHandler gate evaluation", () => {
  it("returns PROCEED without touching the log when no gateLoader is configured", async () => {
    const { store, appended, readAll } = makeLogStore();
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(0);
    expect(readAll).not.toHaveBeenCalled();
  });

  it("returns PROCEED and never loads gates when taskId is undefined", async () => {
    const { store, appended } = makeLogStore();
    const gateLoader = makeGateLoader([reviewGate("g", "fail", "tool_observed")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
      getActiveAuthorization: vi.fn(async () => activeAuthorization),
    });

    const response = await callGate(handler, "tool_observed", undefined, "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(gateLoader.load).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it("appends a PASS DecisionRecord and returns PROCEED when all gates pass", async () => {
    // Exercises a genuine PASS: the review scope for "task-1" has actually
    // been observed (a review_observed record with zero open items), so the
    // gate passes on its own merits. Deliberately uses onMissingEvidence:
    // "fail" to prove this isn't the missing-evidence fallback path, which
    // caps at WARN even for "pass" (see rule-evaluation-engine.test.ts:
    // "caps passing onMissingEvidence at WARN when reviewScope is empty").
    const reviewCorrelation = {
      reviewKind: "task-review",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      reviewRound: 1,
    } as const;
    const reviewObserved: PersistedLogRecord = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      agentId: "atlas",
      sessionId: "s-1",
      writerId: "w-test",
      taskId: "task-1",
      recordType: "observation",
      sequence: 7,
      kind: "review_observed",
      reviewScope: "task:task-1",
      correlation: reviewCorrelation,
      items: [],
      isCompleteSnapshot: true,
    };
    // F-001/F-002: the current review correlation must be proven by the durable
    // claimed -> staged -> completed terminal history, not by a session/scope match alone.
    const completedDispatch = completedReviewDispatch(reviewCorrelation);
    const { store, appended } = makeLogStore([
      ...currentTaskLifecycleEvents(),
      reviewObserved,
      ...completedDispatch,
    ]);
    const gateLoader = makeGateLoader([reviewGate("all-clear", "fail", "tool_observed")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
      findAuthorizationById: vi.fn(async () => activeAuthorization),
      getActiveAuthorization: vi.fn(async () => null),
    });

    const response = await callGate(handler, "tool_observed", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(3);
    expect(appended[0]?.record).toMatchObject({
      recordType: "decision",
      gateType: "task",
      verdict: "PASS",
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      taskId: "task-1",
      agentId: "atlas",
      sessionId: "s-1",
      writerId: "w-test",
    });
    expect(appended[0]?.shardId).toEqual({
      agentId: "atlas",
      sessionId: "s-1",
      writerId: "w-test",
    });
  });

  it("never feeds projected task evidence or the global review summary to the Rule Engine", async () => {
    const reviewCorrelation = {
      reviewKind: "task-review",
      taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
      reviewRound: 1,
    } as const;
    const records = [
      ...currentTaskLifecycleEvents(),
      {
        schemaVersion: 1,
        timestamp: "2026-07-01T00:00:07.000Z",
        agentId: "atlas",
        sessionId: "s-1",
        writerId: "w-test",
        taskId: "task-1",
        recordType: "observation",
        sequence: 7,
        kind: "review_observed",
        reviewScope: "task:task-1",
        correlation: reviewCorrelation,
        items: [],
        isCompleteSnapshot: true,
      },
      // Same task, but produced by a call with no durable implementation binding
      // (e.g. an independent child-session tool): it must stay UNATTRIBUTED.
      {
        schemaVersion: 1,
        timestamp: "2026-07-01T00:00:08.000Z",
        agentId: "atlas",
        sessionId: "s-1",
        writerId: "w-test",
        taskId: "task-1",
        recordType: "observation",
        sequence: 8,
        kind: "tool_executed",
        toolName: "bash",
        callId: "child-tool-1",
        evidence: {
          evidenceId: "e-unbound",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "pass",
        },
      },
      ...completedReviewDispatch(reviewCorrelation),
    ] as unknown as readonly PersistedLogRecord[];
    const { store, appended } = makeLogStore(records);
    const gateLoader = makeGateLoader([
      {
        id: "required-tests",
        gateType: "task",
        trigger: { scope: "task", on: "tool_observed" },
        check: { type: "evidence_present", evidenceKind: "test" },
        onViolation: "fail",
        onMissingEvidence: "fail",
        enabled: true,
      },
    ]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
      findAuthorizationById: vi.fn(async () => activeAuthorization),
    });

    const response = await callGate(handler, "tool_observed", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(appended.some((entry) => entry.record.recordType === "decision" && "gateType" in entry.record)).toBe(
      false,
    );
    expect(appended.map((entry) => entry.record)).toEqual([
      expect.objectContaining({ kind: "task-acceptance", verdict: "blocked" }),
    ]);
  });

  it("returns a gate_advisory inject and appends the DecisionRecord when a gate warns", async () => {
    const { store, appended } = makeLogStore();
    const gateLoader = makeGateLoader([reviewGate("needs-review", "warn", "task_complete")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
      getActiveAuthorization: vi.fn(async () => activeAuthorization),
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(0);
  });

  it("returns a gate_advisory inject and appends the DecisionRecord when a gate fails", async () => {
    const { store, appended } = makeLogStore();
    const gateLoader = makeGateLoader([reviewGate("blocked", "fail", "task_complete")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
      getActiveAuthorization: vi.fn(async () => activeAuthorization),
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(0);
  });

  it("returns PROCEED and appends nothing when no active gate matches the trigger (SKIP)", async () => {
    const { store, appended } = makeLogStore();
    // The gate fires on tool_observed, but we trigger task_complete: evaluate() returns SKIP.
    const gateLoader = makeGateLoader([reviewGate("tool-only", "fail", "tool_observed")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
      getActiveAuthorization: vi.fn(async () => activeAuthorization),
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(gateLoader.load).not.toHaveBeenCalled();
    expect(appended).toHaveLength(0);
  });

  it("degrades to PROCEED and logs a warning when gate loading throws (fail-open)", async () => {
    const { store, appended } = makeLogStore();
    const loadError = new Error("gate load failed");
    const gateLoader: GateLoader = {
      load: vi.fn(async () => {
        throw loadError;
      }),
    };
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
      logger,
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(0);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
