import { describe, expect, it, vi } from "vitest";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { createMemFs } from "../helpers/mock-file-system";

function createHandler(options: { workspaceRoot?: string; writerId?: string } = {}): { handler: ObservationHandler; logStore: ObservationLogStore; files: Map<string, string>; reader: FileReader; logger: { warn: ReturnType<typeof vi.fn> }; } {
  const { reader, writer } = createMemFs();
  const logStore = new ObservationLogStore(writer, reader, options.writerId ?? "w-test");
  const sessionStateProvider = new SessionStateProvider();
  const logger = { warn: vi.fn() };
  const handler = new ObservationHandler({
    logStore,
    sessionStateProvider,
    writerId: options.writerId ?? "w-test",
    workspaceRoot: options.workspaceRoot,
    logger,
  });
  return { handler, logStore, files: new Map<string, string>(), reader, logger };
}

describe("ObservationHandler.handleSessionError", () => {
  it("appends a session_error observation record to the log store", async () => {
    const { handler, logStore } = createHandler();
    const response = await handler.handleSessionError({
      message: "Connection reset",
      kind: "network",
      agentId: "hephaestus",
      sessionId: "session-1",
    });

    expect(response).toEqual({ action: "proceed" });
    const events = await logStore.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "session_error",
      errorKind: "network",
      message: "Connection reset",
      agentId: "hephaestus",
      sessionId: "session-1",
    });
  });

  it("removes the session message buffer after recording the error", async () => {
    const { handler, logStore } = createHandler();
    const destroyLogStore = vi.spyOn(logStore, "destroySession");
    await handler.handleMessage("session-1", {
      kind: "message_part_updated",
      sessionId: "session-1",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    const internal = handler as unknown as {
      readonly messageRoleBuffer: { readonly buffer: ReadonlyMap<string, unknown> };
    };
    const bufferKey = JSON.stringify(["session-1", "message-1"]);
    expect(internal.messageRoleBuffer.buffer.has(bufferKey)).toBe(true);

    await handler.handleSessionError({
      message: "Connection reset",
      kind: "network",
      agentId: "hephaestus",
      sessionId: "session-1",
    });

    expect(internal.messageRoleBuffer.buffer.has(bufferKey)).toBe(false);
    expect(destroyLogStore).not.toHaveBeenCalled();
    const events = await logStore.readAll();
    expect(events.some((event) => event.kind === "session_error")).toBe(true);
  });

  it("does not persist pending assistant text before discarding the buffer", async () => {
    const { handler, logStore } = createHandler();
    await handler.handleMessage("session-pending", {
      kind: "message_updated",
      sessionId: "session-pending",
      messageID: "message-pending",
      role: "assistant",
      finalized: false,
    });
    await handler.handleMessage("session-pending", {
      kind: "message_part_updated",
      sessionId: "session-pending",
      messageID: "message-pending",
      partID: "part-pending",
      text: "unfinished assistant response",
    });

    await handler.handleSessionError({
      message: "Connection reset",
      kind: "network",
      agentId: "hephaestus",
      sessionId: "session-pending",
    });

    const events = await logStore.readAll();
    const sessionError = events.find((event) => event.kind === "session_error");
    expect(sessionError).toMatchObject({ kind: "session_error" });
    expect(JSON.stringify(sessionError)).not.toContain("unfinished assistant response");
  });

  it("defaults errorKind to unknown when kind is omitted", async () => {
    const { handler, logStore } = createHandler();
    await handler.handleSessionError({
      message: "Unknown error",
      agentId: "unknown",
      sessionId: "session-2",
    });

    const events = await logStore.readAll();
    expect(events[0]).toMatchObject({
      kind: "session_error",
      errorKind: "unknown",
    });
  });

  it("redacts absolute paths in the error message", async () => {
    const { handler, logStore } = createHandler({ workspaceRoot: "/workspace" });
    await handler.handleSessionError({
      message: "Failed at /home/user/project with sk-secret123",
      kind: "runtime",
      agentId: "sisyphus",
      sessionId: "session-3",
    });

    const events = await logStore.readAll();
    const message = (events[0] as { message: string }).message;
    expect(message).toContain("REDACTED");
    expect(message).not.toContain("/home/user/project");
  });

  it("degrades gracefully when log store append fails", async () => {
    const { handler, logger } = createHandler();
    handler["options"].logStore = {
      append: vi.fn().mockRejectedValue(new Error("disk full")),
    } as unknown as ObservationLogStore;

    const response = await handler.handleSessionError({
      message: "boom",
      agentId: "hephaestus",
      sessionId: "session-4",
    });

    expect(response).toEqual({ action: "proceed" });
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: session error observation failed, degrading to PROCEED",
      expect.anything(),
    );
  });

  it("keeps the session message buffer when the log store append fails, so a later finalize can still recover it", async () => {
    const { handler } = createHandler();
    await handler.handleMessage("session-5", {
      kind: "message_part_updated",
      sessionId: "session-5",
      messageID: "message-1",
      partID: "part-1",
      text: "tests pass",
    });
    const internal = handler as unknown as {
      readonly messageRoleBuffer: { readonly buffer: ReadonlyMap<string, unknown> };
    };
    const bufferKey = JSON.stringify(["session-5", "message-1"]);
    expect(internal.messageRoleBuffer.buffer.has(bufferKey)).toBe(true);

    handler["options"].logStore = {
      append: vi.fn().mockRejectedValue(new Error("disk full")),
    } as unknown as ObservationLogStore;

    const response = await handler.handleSessionError({
      message: "boom",
      agentId: "hephaestus",
      sessionId: "session-5",
    });

    expect(response).toEqual({ action: "proceed" });
    // Only discard the buffer once the session_error record is durably
    // persisted; on append failure the buffered (unfinalized) parts must
    // survive so a subsequent message_updated(finalized:true) can still
    // reconstruct them.
    expect(internal.messageRoleBuffer.buffer.has(bufferKey)).toBe(true);
  });
});

describe("ObservationHandler.emitReflectionEvent", () => {
  it("appends a reflection event for task success", async () => {
    const { handler, logStore } = createHandler({ workspaceRoot: "/workspace" });
    await handler.emitReflectionEvent({
      trigger: "task_succeeded",
      planRef: { path: "plan.md", taskId: "task-1" },
      intent: "check_complete",
      sessionId: "session-1",
    });

    const events = await logStore.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "reflection",
      reflection: {
        trigger: "task_succeeded",
        planRef: { path: "plan.md", taskId: "task-1" },
        intent: "check_complete",
      },
    });
  });

  it("appends a reflection event for task error with note", async () => {
    const { handler, logStore } = createHandler({ workspaceRoot: "/workspace" });
    await handler.emitReflectionEvent({
      trigger: "task_error",
      planRef: { path: "plan.md", taskId: "task-2" },
      intent: "append_error_note",
      note: "Loop detected",
      sessionId: "session-2",
    });

    const events = await logStore.readAll();
    expect(events[0]).toMatchObject({
      kind: "reflection",
      reflection: {
        trigger: "task_error",
        planRef: { path: "plan.md", taskId: "task-2" },
        intent: "append_error_note",
        note: "Loop detected",
      },
    });
  });

  it("degrades gracefully when workspace root is not configured", async () => {
    const { handler, logger } = createHandler();
    await handler.emitReflectionEvent({
      trigger: "task_succeeded",
      planRef: { path: "plan.md", taskId: "task-1" },
      intent: "check_complete",
      sessionId: "session-1",
    });

    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: emitReflectionEvent failed, degrading gracefully",
      expect.anything(),
    );
  });
});
