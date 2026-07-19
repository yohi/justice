import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import type { HookResponse } from "../../src/core/types";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { project } from "../../src/core/v2/state-projection";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs, createMockFileReader } from "../helpers/mock-file-system";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

describe("ObservationHandler tool observation", () => {
  it("retains the injected taskId across the JusticePlugin PreToolUse and PostToolUse flow", async () => {
    const { files, reader, writer } = createMemFs();
    files.set("plan.md", ["### Task 1: Observe tools", "- [ ] Run tests"].join("\n"));
    const plugin = new JusticePlugin(reader, writer, { writerId: "w-handler" });
    plugin.getPlanBridge().setActivePlan("session-plugin", "plan.md");
    plugin.getSessionStateProvider().setAgentMapping("session-plugin", "hephaestus");

    const preResponse = await plugin.handleEvent({
      type: "PreToolUse",
      sessionId: "session-plugin",
      callId: "call-plugin",
      payload: { toolName: "task", toolInput: { prompt: "run task" } },
    });
    expect(preResponse.action).toBe("inject");

    await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "session-plugin",
      callId: "call-plugin",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    const path = toPhysicalPath({
      agentId: "hephaestus",
      sessionId: "session-plugin",
      writerId: "w-handler",
    });
    const persisted = files.get(path);
    expect(persisted).toBeDefined();
    // The live plugin now also appends a gate DecisionRecord after the task
    // completes (DEFAULT_GATES warn on missing evidence), so the shard file is
    // multi-line JSONL. The tool_executed observation is the first record.
    const firstRecord = (persisted ?? "").split("\n")[0] ?? "";
    expect(JSON.parse(firstRecord)).toMatchObject({
      kind: "tool_executed",
      taskId: "task-1",
      callId: "call-plugin",
    });
  });

  it("correlates the PlanBridge-injected taskId and evaluates task gates after projection", async () => {
    const plan = ["### Task 1: Observe tools", "- [ ] Run tests"].join("\n");
    const bridge = new PlanBridge(createMockFileReader({ "plan.md": plan }));
    bridge.setActivePlan("session-1", "plan.md");
    const bridgeResponse = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-task",
      payload: { toolName: "task", toolInput: { prompt: "run task" } },
    });
    expect(bridgeResponse.action).toBe("inject");
    if (bridgeResponse.action !== "inject") throw new Error("expected PlanBridge injection");
    const modified = bridgeResponse.modifiedPayload;
    if (!isRecord(modified) || !isRecord(modified.args)) {
      throw new Error("expected enriched task args");
    }
    expect(modified.args).toMatchObject({ prompt: "run task", taskId: "task-1" });

    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "hephaestus");
    const projectionCache = { write: vi.fn(async () => undefined) };
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      projectionCache,
      writerId: "w-handler",
    });
    const gateTarget = handler as unknown as {
      evaluateGateIfTriggered(
        trigger: "task_complete" | "tool_observed",
        taskId: string | undefined,
        callId: string | undefined,
        agentId: string,
        sessionId: string,
      ): Promise<HookResponse>;
    };
    const gateSpy = vi.spyOn(gateTarget, "evaluateGateIfTriggered");

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-task",
      payload: { toolName: "task", toolInput: modified.args },
    });
    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-task",
      payload: {
        toolName: "task",
        toolInput: modified.args,
        toolResult: "task complete",
        error: false,
      },
    });

    expect(response).toEqual({ action: "proceed" });
    const events = await logStore.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "tool_executed", taskId: "task-1" });
    expect(project(events, "2026-07-11T00:00:00.000Z").tasks.has("task-1")).toBe(true);
    expect(projectionCache.write).toHaveBeenCalledOnce();
    expect(gateSpy).toHaveBeenNthCalledWith(
      1,
      "task_complete",
      "task-1",
      "call-task",
      "hephaestus",
      "session-1",
      expect.any(Function),
    );
    expect(gateSpy).toHaveBeenNthCalledWith(
      2,
      "tool_observed",
      "task-1",
      "call-task",
      "hephaestus",
      "session-1",
      expect.any(Function),
    );
    expect(sessionState.getActiveTaskId("call-task")).toBeUndefined();
  });

  it("does not cross-correlate concurrent task windows", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "hephaestus");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-a",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });
    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-b",
      payload: { toolName: "task", toolInput: { taskId: "task-2" } },
    });
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-b",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    const events = await logStore.readAll();
    expect(events[0]?.taskId).toBe("task-2");
    expect(sessionState.getActiveTaskId("call-a")).toBe("task-1");
    expect(sessionState.getActiveTaskId("call-b")).toBeUndefined();
  });

  it("fails open and closes the task window when append fails", async () => {
    const sessionState = new SessionStateProvider();
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore: {
        append: async (): Promise<number> => {
          throw new Error("append failed");
        },
        readAll: async () => [],
      } as unknown as ObservationLogStore,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
      logger,
    });
    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    expect(response).toEqual({ action: "proceed" });
    expect(sessionState.getActiveTaskId("call-1")).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: task summary declared evidence failed",
      expect.any(Error),
    );
  });

  it("closes the task window when taskId lookup fails", async () => {
    const closeActiveTaskWindow = vi.fn();
    const sessionState = {
      getActiveTaskId: (): string | undefined => {
        throw new Error("lookup failed");
      },
      getAgentId: (): "unknown" => "unknown",
      setActiveTaskWindow: vi.fn(),
      closeActiveTaskWindow,
    } as unknown as SessionStateProvider;
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore: {} as unknown as ObservationLogStore,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
      logger,
    });

    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-lookup",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    expect(response).toEqual({ action: "proceed" });
    expect(closeActiveTaskWindow).toHaveBeenCalledWith("call-lookup");
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: tool observation failed, degrading to PROCEED",
      expect.any(Error),
    );
  });

  it("logs a warning when projection cache write fails (fail-open)", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
    const cacheError = new Error("cache write failed");
    const projectionCache = { write: vi.fn(async () => Promise.reject(cacheError)) };
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      projectionCache,
      writerId: "w-handler",
      logger,
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-cache",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });
    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-cache",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    expect(response).toEqual({ action: "proceed" });
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        "observation-handler projection cache write failed",
        cacheError,
      ),
    );
    expect(projectionCache.write).toHaveBeenCalledOnce();
  });

  it("validates the existing projection cache before rebuilding it after an observation", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
    const projectionCache = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    };
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      projectionCache,
      writerId: "w-handler",
    });

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-cache-read",
      payload: { toolName: "bash", toolResult: "ok", error: false },
    });

    await vi.waitFor(() => expect(projectionCache.read).toHaveBeenCalledOnce());
    expect(projectionCache.write).toHaveBeenCalledOnce();
  });

  it("warns before rebuilding a projection cache with mismatched shard sequences", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
    const emptyState = project([], "2026-01-01T00:00:00.000Z");
    const projectionCache = {
      read: vi.fn(async () => ({
        ...emptyState,
        integrity: {
          ...emptyState.integrity,
          maxSequenceByShard: new Map([["missing-shard", 1]]),
        },
      })),
      write: vi.fn(async () => undefined),
    };
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      projectionCache,
      writerId: "w-handler",
      logger,
    });

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-cache-mismatch",
      payload: { toolName: "bash", toolResult: "ok", error: false },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler projection cache mismatch_seq, rebuilding",
      expect.any(Error),
    );
    expect(projectionCache.write).toHaveBeenCalledOnce();
  });

  it("avoids readAll/project when projectionCache is not configured", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const readAllSpy = vi.spyOn(logStore, "readAll");
    const sessionState = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-handler",
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-nocache",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });
    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-nocache",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    expect(response).toEqual({ action: "proceed" });
    expect(readAllSpy).not.toHaveBeenCalled();
  });

  it("logs a warning when initializeProjectionCache's underlying refresh fails", async () => {
    const logger = { warn: vi.fn() };
    const refreshError = new Error("readAll failed");
    const handler = new ObservationHandler({
      logStore: {
        append: async () => 1,
        readAll: async () => {
          throw refreshError;
        },
      } as unknown as ObservationLogStore,
      sessionStateProvider: new SessionStateProvider(),
      projectionCache: { write: vi.fn(async () => undefined) },
      writerId: "w-handler",
      logger,
    });

    await handler.initializeProjectionCache();

    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler projection cache initialization failed",
      refreshError,
    );
  });

  it("logs a warning when a scheduled projection refresh fails outside the write path", async () => {
    const logger = { warn: vi.fn() };
    const refreshError = new Error("readAll failed");
    const handler = new ObservationHandler({
      logStore: {
        append: async () => 1,
        readAll: async () => {
          throw refreshError;
        },
      } as unknown as ObservationLogStore,
      sessionStateProvider: new SessionStateProvider(),
      projectionCache: { write: vi.fn(async () => undefined) },
      writerId: "w-handler",
      logger,
    });

    await handler.handleSessionError({
      message: "boom",
      agentId: "unknown",
      sessionId: "session-1",
    });

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        "observation-handler projection cache refresh failed",
        refreshError,
      ),
    );
  });

  it("silently rebuilds a stale projection cache without warning on a normal append", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
    const logger = { warn: vi.fn() };
    const shardId = { agentId: "unknown" as const, sessionId: "session-1", writerId: "w-handler" };

    // Seed one record so the cached state's maxSequence reflects the state
    // "before" the observation that handlePostToolUse is about to append. A
    // normal append that merely raises a known shard's sequence must be
    // classified `stale_append` (silent rebuild), never a warning.
    await logStore.append(shardId, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      agentId: "unknown",
      sessionId: "session-1",
      writerId: "w-handler",
      recordType: "observation",
      kind: "message",
      messageID: "seed",
      role: "assistant",
      textHash: "seed-hash",
      declaredClaims: [],
      evidence: [],
      finalized: true,
    });
    const staleState = project(await logStore.readAll(), "2026-01-01T00:00:00.000Z");
    const projectionCache = {
      read: vi.fn(async () => staleState),
      write: vi.fn(async () => undefined),
    };
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      projectionCache,
      writerId: "w-handler",
      logger,
    });

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-stale",
      payload: { toolName: "bash", toolResult: "ok", error: false },
    });

    await vi.waitFor(() => expect(projectionCache.write).toHaveBeenCalledOnce());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("continues gate evaluation even when projection cache refresh fails during PostToolUse", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "hephaestus");
    const cacheRefreshError = new Error("cache refresh failed");
    const projectionCache = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => Promise.reject(cacheRefreshError)),
    };
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      projectionCache,
      writerId: "w-handler",
      logger,
    });
    const gateTarget = handler as unknown as {
      evaluateGateIfTriggered(
        trigger: "task_complete" | "tool_observed",
        taskId: string | undefined,
        callId: string | undefined,
        agentId: string,
        sessionId: string,
      ): Promise<HookResponse>;
    };
    const gateSpy = vi.spyOn(gateTarget, "evaluateGateIfTriggered");

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-gate-test",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-gate-test",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    // Verify that gate evaluation was still called despite cache refresh failure
    expect(gateSpy).toHaveBeenCalledWith(
      "task_complete",
      "task-1",
      "call-gate-test",
      "hephaestus",
      "session-1",
      expect.any(Function),
    );
    expect(gateSpy).toHaveBeenCalledWith(
      "tool_observed",
      "task-1",
      "call-gate-test",
      "hephaestus",
      "session-1",
      expect.any(Function),
    );
    // Verify that the cache refresh failure was logged
    // Note: refreshProjectionCache() internally catches write failures and logs them.
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler projection cache write failed",
      cacheRefreshError,
    );
    // Response should be PROCEED (not degraded to outer catch)
    expect(response).toEqual({ action: "proceed" });
  });

  it("performs a single readAll() when refreshing the projection cache and evaluating both task_complete and tool_observed gates", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const readAllSpy = vi.spyOn(logStore, "readAll");
    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "hephaestus");
    const projectionCache = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    };
    const gateLoader = { load: vi.fn(async () => []) };
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      projectionCache,
      gateLoader,
      writerId: "w-handler",
    });

    await handler.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-single-readall",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });

    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-single-readall",
      payload: { toolName: "task", toolResult: "done", error: false },
    });

    expect(response).toEqual({ action: "proceed" });
    // A `task` completion triggers both task_complete and tool_observed gate
    // evaluations. refreshProjectionCache() folds the event log once and its
    // ProjectedState seeds gateStatePromise for both, so readAll() must be
    // called exactly once for the whole append-and-gate path (regression
    // guard for the refreshProjectionCache()/getGateState() double read).
    expect(readAllSpy).toHaveBeenCalledTimes(1);
  });
});
