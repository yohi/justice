import { describe, expect, it, vi } from "vitest";
import type { HookResponse, ShardId, WorkflowStartRequest } from "../../src/core/types";
import { DEFAULT_GATES } from "../../src/core/v2/default-gates";
import { hashString } from "../../src/core/v2/hash";
import type { PendingLogRecord, PersistedLogRecord } from "../../src/core/v2/observation-model";
import type { SessionStateProvider } from "../../src/core/session-state-provider";
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
// access it through the same `unknown` cast (see observation-handler-gate.test.ts).
function callGate(handler: ObservationHandler, taskId: string): Promise<HookResponse> {
  return (
    handler as unknown as { evaluateGateIfTriggered: EvaluateGateFn }
  ).evaluateGateIfTriggered("task_complete", taskId, "call-1", "atlas", "session-1");
}

type AppendedRecord = { readonly shardId: ShardId; readonly record: PendingLogRecord };

function makeLogStore(events: readonly PersistedLogRecord[] = []): {
  store: ObservationLogStore;
  appended: AppendedRecord[];
} {
  const appended: AppendedRecord[] = [];
  const store = {
    readAll: vi.fn(async () => events),
    getLastReadIntegrity: vi.fn(() => ({ hasIntegrityViolation: false })),
    append: vi.fn(async (shardId: ShardId, record: PendingLogRecord) => {
      appended.push({ shardId, record });
      return appended.length;
    }),
    destroySession: vi.fn(),
  } as unknown as ObservationLogStore;
  return { store, appended };
}

function makeSessionState(): SessionStateProvider & { getAgentId: ReturnType<typeof vi.fn> } {
  return {
    getAgentId: vi.fn(() => "atlas"),
  } as unknown as SessionStateProvider & { getAgentId: ReturnType<typeof vi.fn> };
}

function makeRequest(overrides: Partial<WorkflowStartRequest> = {}): WorkflowStartRequest {
  return {
    source: "command",
    goal: "activate the justice workflow",
    designPath: null,
    planPath: null,
    ...overrides,
  };
}

function makeHandler(options: {
  readonly store: ObservationLogStore;
  readonly logger?: { warn: ReturnType<typeof vi.fn> };
  readonly gateLoader?: GateLoader;
}): ObservationHandler {
  return new ObservationHandler({
    logStore: options.store,
    sessionStateProvider: makeSessionState(),
    writerId: "w-test",
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.gateLoader === undefined ? {} : { gateLoader: options.gateLoader }),
  });
}

function bootstrapEvent(
  kind: "workflow_started" | "design_requested" | "plan_requested" | "plan_activated",
  sequence: number,
): PersistedLogRecord {
  return {
    schemaVersion: 1,
    timestamp: `2026-07-27T00:00:0${sequence}.000Z`,
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-test",
    taskId: "task-1",
    recordType: "observation",
    sequence,
    kind,
    workflow: {
      phase: "plan_ready",
      source: "command",
      goalHash: "sha256:goal",
      goalSnippet: "activate the justice workflow",
    },
  };
}

describe("ObservationHandler workflow bootstrap observation", () => {
  it("appends exactly one workflow_started record per bootstrap and returns PROCEED", async () => {
    const { store, appended } = makeLogStore();
    const handler = makeHandler({ store });

    const response = await handler.emitWorkflowStartedEvent({
      request: makeRequest({ planPath: "docs/plan.md" }),
      phase: "plan_ready",
      sessionId: "session-1",
    });

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(1);
    expect(appended[0]?.record).toMatchObject({
      recordType: "observation",
      kind: "workflow_started",
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "w-test",
      workflow: {
        phase: "plan_ready",
        source: "command",
        goalHash: hashString("activate the justice workflow"),
        planPath: "docs/plan.md",
      },
    });
    expect(appended[0]?.shardId).toEqual({
      agentId: "atlas",
      sessionId: "session-1",
      writerId: "w-test",
    });
  });

  it("appends exactly one record per phase transition", async () => {
    const cases = [
      ["design_required", "design_requested"],
      ["plan_required", "plan_requested"],
      ["plan_ready", "plan_activated"],
    ] as const;

    for (const [phase, expectedKind] of cases) {
      const { store, appended } = makeLogStore();
      const handler = makeHandler({ store });

      const response = await handler.emitWorkflowPhaseEvent({
        request: makeRequest(),
        phase,
        sessionId: "session-1",
      });

      expect(response).toEqual({ action: "proceed" });
      expect(appended).toHaveLength(1);
      expect(appended[0]?.record).toMatchObject({ kind: expectedKind });
    }
  });

  it("never attaches a taskId, so the record cannot open a task window", async () => {
    const { store, appended } = makeLogStore();
    const handler = makeHandler({ store });

    await handler.emitWorkflowStartedEvent({
      request: makeRequest(),
      phase: "plan_ready",
      sessionId: "session-1",
    });

    expect(appended[0]?.record).not.toHaveProperty("taskId");
  });

  it("degrades to PROCEED and logs a warning when the log writer rejects (fail-open)", async () => {
    const appendError = new Error("disk full");
    const store = {
      readAll: vi.fn(async () => []),
      getLastReadIntegrity: vi.fn(() => ({ hasIntegrityViolation: false })),
      append: vi.fn(async () => {
        throw appendError;
      }),
      destroySession: vi.fn(),
    } as unknown as ObservationLogStore;
    const logger = { warn: vi.fn() };
    const handler = makeHandler({ store, logger });

    const started = await handler.emitWorkflowStartedEvent({
      request: makeRequest(),
      phase: "design_required",
      sessionId: "session-1",
    });
    const phase = await handler.emitWorkflowPhaseEvent({
      request: makeRequest(),
      phase: "design_required",
      sessionId: "session-1",
    });

    expect(started).toEqual({ action: "proceed" });
    expect(phase).toEqual({ action: "proceed" });
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: workflow bootstrap observation failed, degrading to PROCEED",
      appendError,
    );
  });

  it("degrades to PROCEED when the request cannot be turned into a record", async () => {
    const { store, appended } = makeLogStore();
    const logger = { warn: vi.fn() };
    const handler = makeHandler({ store, logger });

    const response = await handler.emitWorkflowPhaseEvent({
      request: makeRequest(),
      // An out-of-contract phase must not crash the session.
      phase: "not_a_phase" as never,
      sessionId: "session-1",
    });

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("workflow bootstrap records do not change default gate verdicts", () => {
  const gateLoader: GateLoader = { load: vi.fn(async () => [...DEFAULT_GATES]) };

  const reviewObserved: PersistedLogRecord = {
    schemaVersion: 1,
    timestamp: "2026-07-27T00:00:00.000Z",
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "w-test",
    taskId: "task-1",
    recordType: "observation",
    sequence: 0,
    kind: "review_observed",
    reviewScope: "task-1",
    items: [],
  };

  /**
   * The observable gate outcome: the hook response plus the DecisionRecord's
   * verdict fields. `timestamp` is deliberately excluded — it is wall-clock and
   * unrelated to the verdict.
   */
  async function verdictFor(events: readonly PersistedLogRecord[]): Promise<unknown> {
    const { store, appended } = makeLogStore(events);
    const handler = makeHandler({ store, gateLoader });
    const response = await callGate(handler, "task-1");
    const decision = appended.find((entry) => entry.record.recordType === "decision")?.record;
    if (decision === undefined || decision.recordType !== "decision") {
      return { response, decision };
    }
    return {
      response,
      verdict: decision.verdict,
      ruleResults: decision.ruleResults,
      reachableEnforcementLevel: decision.reachableEnforcementLevel,
      appliedEnforcementLevel: decision.appliedEnforcementLevel,
      taskId: decision.taskId,
    };
  }

  const bootstrapRecords: readonly PersistedLogRecord[] = [
    bootstrapEvent("workflow_started", 1),
    bootstrapEvent("design_requested", 2),
    bootstrapEvent("plan_requested", 3),
    bootstrapEvent("plan_activated", 4),
  ];

  it("yields an identical verdict for an empty task window", async () => {
    expect(await verdictFor(bootstrapRecords)).toEqual(await verdictFor([]));
  });

  it("yields an identical verdict when review evidence is already observed", async () => {
    expect(await verdictFor([reviewObserved, ...bootstrapRecords])).toEqual(
      await verdictFor([reviewObserved]),
    );
  });
});
