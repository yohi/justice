import { describe, expect, it, vi } from "vitest";
import type { HookResponse, ShardId } from "../../src/core/types";
import type { GateRule } from "../../src/core/v2/gate-definition";
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

function makeLogStore(events: readonly PersistedLogRecord[] = []): {
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

function makeGateLoader(gates: readonly GateRule[]): GateLoader & { load: ReturnType<typeof vi.fn> } {
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
    trigger: { on: trigger },
    check: { type: "review_open_items", minimumSeverity: "major" },
    onViolation: "fail",
    onMissingEvidence,
    enabled: true,
  };
}

const sessionStateProvider = {} as unknown as SessionStateProvider;

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
    const reviewObserved: PersistedLogRecord = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      agentId: "atlas",
      sessionId: "s-1",
      writerId: "w-test",
      taskId: "task-1",
      recordType: "observation",
      sequence: 1,
      kind: "review_observed",
      reviewScope: "task-1",
      items: [],
    };
    const { store, appended } = makeLogStore([reviewObserved]);
    const gateLoader = makeGateLoader([reviewGate("all-clear", "fail", "tool_observed")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
    });

    const response = await callGate(handler, "tool_observed", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(1);
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
    expect(appended[0]?.shardId).toEqual({ agentId: "atlas", sessionId: "s-1", writerId: "w-test" });
  });

  it("returns a gate_advisory inject and appends the DecisionRecord when a gate warns", async () => {
    const { store, appended } = makeLogStore();
    const gateLoader = makeGateLoader([reviewGate("needs-review", "warn", "task_complete")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject");
    expect(response.variant).toBe("gate_advisory");
    expect(response.injectedContext).toContain("WARN");
    expect(response.injectedContext).toContain("needs-review");
    expect(appended).toHaveLength(1);
    expect(appended[0]?.record).toMatchObject({ recordType: "decision", verdict: "WARN" });
  });

  it("returns a gate_advisory inject and appends the DecisionRecord when a gate fails", async () => {
    const { store, appended } = makeLogStore();
    const gateLoader = makeGateLoader([reviewGate("blocked", "fail", "task_complete")]);
    const handler = new ObservationHandler({
      logStore: store,
      sessionStateProvider,
      writerId: "w-test",
      gateLoader,
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected inject");
    expect(response.variant).toBe("gate_advisory");
    expect(response.injectedContext).toContain("FAIL");
    expect(appended).toHaveLength(1);
    expect(appended[0]?.record).toMatchObject({ recordType: "decision", verdict: "FAIL" });
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
    });

    const response = await callGate(handler, "task_complete", "task-1", "call-1", "atlas", "s-1");

    expect(response).toEqual({ action: "proceed" });
    expect(gateLoader.load).toHaveBeenCalledTimes(1);
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
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: gate evaluation failed, degrading to PROCEED",
      loadError,
    );
  });
});
