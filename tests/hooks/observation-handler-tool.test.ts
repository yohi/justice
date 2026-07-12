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
      agentId: "unknown",
      sessionId: "session-plugin",
      writerId: "w-handler",
    });
    const persisted = files.get(path);
    expect(persisted).toBeDefined();
    expect(JSON.parse(persisted ?? "")).toMatchObject({
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
    );
    expect(gateSpy).toHaveBeenNthCalledWith(
      2,
      "tool_observed",
      "task-1",
      "call-task",
      "hephaestus",
      "session-1",
    );
    expect(sessionState.getActiveTaskId("call-task")).toBeUndefined();
  });

  it("does not cross-correlate concurrent task windows", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-handler");
    const sessionState = new SessionStateProvider();
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
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler projection cache write failed",
      cacheError,
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
});
