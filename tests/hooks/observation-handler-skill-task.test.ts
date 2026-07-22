import { describe, expect, it, vi } from "vitest";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import type { HookResponse } from "../../src/core/types";
import type { PendingLogRecord } from "../../src/core/v2/observation-model";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs } from "../helpers/mock-file-system";

function createHandler(): {
  readonly handler: ObservationHandler;
  readonly logStore: ObservationLogStore;
  readonly sessionState: SessionStateProvider;
} {
  const { reader, writer } = createMemFs();
  const logStore = new ObservationLogStore(writer, reader, "w-task43");
  const sessionState = new SessionStateProvider();
  return {
    handler: new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-task43",
    }),
    logStore,
    sessionState,
  };
}

function observePassingTask(
  handler: ObservationHandler,
  callId: string,
  taskId: string,
): Promise<HookResponse> {
  return handler.handlePostToolUse({
    type: "PostToolUse",
    sessionId: "session-1",
    callId,
    payload: {
      toolName: "task",
      toolInput: { taskId },
      toolResult: "Tests passed and build passed",
      error: false,
    },
  });
}

describe("ObservationHandler skill and task summary observation", () => {
  it("cohabits observed and declared task-summary evidence in one tool record", async () => {
    const { handler, logStore, sessionState } = createHandler();
    sessionState.setActiveTaskWindow("call-task", "task-1", "session-1");

    await observePassingTask(handler, "call-task", "task-1");

    const events = await logStore.readAll();
    expect(events[0]).toMatchObject({
      kind: "tool_executed",
      toolName: "task",
      callId: "call-task",
      evidence: [
        { evidenceId: "call-task", provenance: "observed" },
        {
          evidenceId: "call-task-test",
          provenance: "declared",
          declaredFrom: "task_summary",
        },
        {
          evidenceId: "call-task-build",
          provenance: "declared",
          declaredFrom: "task_summary",
        },
      ],
    });
  });

  it("persists only observed task evidence when no correlated task window exists", async () => {
    const { handler, logStore } = createHandler();

    await observePassingTask(handler, "call-uncorrelated", "task-payload-only");

    const events = await logStore.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "tool_executed",
      toolName: "task",
      callId: "call-uncorrelated",
      evidence: [{ evidenceId: "call-uncorrelated", provenance: "observed" }],
    });
    expect(events[0]?.taskId).toBeUndefined();
  });

  it("appends a skill_invoked record after the direct skill tool record", async () => {
    const { handler, logStore } = createHandler();

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-skill",
      payload: {
        toolName: "skill",
        toolInput: { name: "test-driven-development" },
        toolResult: "loaded",
        error: false,
      },
    });

    const events = await logStore.readAll();
    expect(
      events.map((event) => (event.recordType === "observation" ? event.kind : "decision")),
    ).toEqual(["tool_executed", "skill_invoked"]);
    expect(events[1]).toMatchObject({
      kind: "skill_invoked",
      skillName: "test-driven-development",
      source: "skill_tool",
      callId: "call-skill",
    });
  });

  it("appends one skill_invoked record for each task load_skills entry", async () => {
    const { handler, logStore } = createHandler();

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-task",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1", load_skills: ["programming", "code-review"] },
        toolResult: "done",
        error: false,
      },
    });

    const events = await logStore.readAll();
    expect(
      events.map((event) => (event.recordType === "observation" ? event.kind : "decision")),
    ).toEqual(["tool_executed", "skill_invoked", "skill_invoked"]);
    expect(events.slice(1)).toMatchObject([
      { skillName: "programming", source: "task_load_skills", callId: "call-task" },
      { skillName: "code-review", source: "task_load_skills", callId: "call-task" },
    ]);
  });

  it("fails open when appending task-summary evidence fails", async () => {
    const logger = { warn: vi.fn() };
    const handler = new ObservationHandler({
      logStore: {
        append: vi.fn(async () => {
          throw new Error("disk write failure");
        }),
        readAll: vi.fn(async () => []),
      } as unknown as ObservationLogStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-task43",
      logger,
    });

    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-task",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1" },
        toolResult: "Tests passed",
        error: false,
      },
    });

    expect(response).toEqual({ action: "proceed" });
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: task summary declared evidence failed",
      expect.any(Error),
    );
  });

  it("orders task completion observation, review, projection, and gate evaluation", async () => {
    const order: string[] = [];
    const appendedRecords: PendingLogRecord[] = [];
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-task43");
    const append = logStore.append.bind(logStore);
    vi.spyOn(logStore, "append").mockImplementation(async (shardId, record: PendingLogRecord) => {
      order.push(`append:${record.recordType === "observation" ? record.kind : "decision"}`);
      appendedRecords.push(record);
      return append(shardId, record);
    });
    const readAll = logStore.readAll.bind(logStore);
    vi.spyOn(logStore, "readAll").mockImplementation(async () => {
      order.push("project:read");
      return readAll();
    });
    const projectionCache = {
      write: vi.fn(async () => {
        order.push("project:write");
      }),
    };
    const sessionStateProvider = new SessionStateProvider();
    sessionStateProvider.setActiveTaskWindow("call-1", "task-1", "session-1");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      projectionCache,
      writerId: "w-task43",
    });
    const internals = handler as unknown as {
      appendReviewObservationsIfDetected(): Promise<void>;
      evaluateGateIfTriggered(): Promise<HookResponse>;
    };
    vi.spyOn(internals, "appendReviewObservationsIfDetected").mockImplementation(async () => {
      order.push("review");
    });
    const evaluateGateIfTriggered = vi
      .spyOn(internals, "evaluateGateIfTriggered")
      .mockImplementation(async () => {
        order.push("gate");
        return { action: "proceed" };
      });

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1" },
        toolResult: "tests pass",
        error: false,
      },
    });

    expect(order).toEqual([
      "append:tool_executed",
      "review",
      "project:read",
      "project:write",
      "gate",
      "gate",
    ]);
    expect(appendedRecords).toContainEqual(
      expect.objectContaining({
        kind: "tool_executed",
        evidence: expect.arrayContaining([
          expect.objectContaining({ evidenceId: "call-1", provenance: "observed" }),
          expect.objectContaining({
            evidenceId: "call-1-test",
            provenance: "declared",
            declaredFrom: "task_summary",
          }),
        ]),
      }),
    );
    expect(evaluateGateIfTriggered).toHaveBeenNthCalledWith(
      1,
      "task_complete",
      "task-1",
      "call-1",
      "unknown",
      "session-1",
      expect.any(Function),
    );
    expect(evaluateGateIfTriggered).toHaveBeenNthCalledWith(
      2,
      "tool_observed",
      "task-1",
      "call-1",
      "unknown",
      "session-1",
      expect.any(Function),
    );
  });
});
