import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type { FileWriter } from "../../src/core/types";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { createMemFs } from "../helpers/mock-file-system";

function parseJsonl(content: string | undefined): unknown[] {
  if (!content) return [];
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function isReflectionRecord(value: unknown): value is { readonly kind: string } {
  return typeof value === "object" && value !== null && "kind" in value;
}

function rejectPlanWrites(writer: FileWriter): FileWriter {
  return {
    writeFile: async (path, content) => {
      if (path === "plan.md") throw new Error("disk full");
      await writer.writeFile(path, content);
    },
    rename: writer.rename,
    mkdir: writer.mkdir,
    rmdir: writer.rmdir,
    deleteFile: writer.deleteFile,
  };
}

describe("JusticePlugin reflection event integration", () => {
  it("emits a reflection event after the task PreToolUse flow registers feedback state", async () => {
    // Given
    const { files, reader, writer } = createMemFs();
    const plan = ["## Task 1: Setup", "- [ ] Init", ""].join("\n");
    files.set("plan.md", plan);

    const plugin = new JusticePlugin(reader, writer, {
      writerId: "w-reflection",
      workspaceRoot: "/workspace",
    });
    plugin.getPlanBridge().setActivePlan("session-1", "plan.md");

    // When
    await plugin.handleEvent({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { prompt: "run" } },
    });

    await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1", prompt: "run" },
        toolResult: "Task completed successfully",
        error: false,
      },
    });

    // Then
    const path = toPhysicalPath({
      agentId: "unknown",
      sessionId: "session-1",
      writerId: "w-reflection",
    });
    const persisted = files.get(path);
    expect(persisted).toBeDefined();
    const events = parseJsonl(persisted);
    const reflection = events.find(
      (event) => isReflectionRecord(event) && event.kind === "reflection",
    );
    expect(reflection).toMatchObject({
      kind: "reflection",
      reflection: {
        trigger: "task_succeeded",
        planRef: { path: "plan.md", taskId: "task-1" },
        intent: "check_complete",
      },
    });
  });

  it("emits an error reflection when appending the error note fails", async () => {
    // Given
    const { files, reader, writer } = createMemFs();
    files.set("plan.md", ["## Task 1: Setup", "- [ ] Init", ""].join("\n"));
    const failingWriter = rejectPlanWrites(writer);
    const plugin = new JusticePlugin(reader, failingWriter, {
      writerId: "w-error-write",
      workspaceRoot: "/workspace",
    });
    plugin.getTaskFeedback().setActivePlan("session-error", "plan.md", "task-1");
    const reflectionSpy = vi.spyOn(plugin.getObservationHandler(), "emitReflectionEvent");

    // When
    await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "session-error",
      callId: "call-error",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1", prompt: "run" },
        toolResult: "FAIL tests/setup.test.ts\nTests: 0 passed, 1 failed",
        error: true,
      },
    });

    // Then
    expect(reflectionSpy).toHaveBeenCalledWith({
      trigger: "task_error",
      planRef: { path: "plan.md", taskId: "task-1" },
      intent: "append_error_note",
      note: expect.stringContaining("test_failure"),
      sessionId: "session-error",
    });
  });

  it("emits a success reflection and reports an unchanged plan when completion writing fails", async () => {
    // Given
    const { files, reader, writer } = createMemFs();
    files.set("plan.md", ["## Task 1: Setup", "- [ ] Init", ""].join("\n"));
    const plugin = new JusticePlugin(reader, rejectPlanWrites(writer), {
      writerId: "w-success-write",
      workspaceRoot: "/workspace",
    });
    plugin.getTaskFeedback().setActivePlan("session-success", "plan.md", "task-1");
    const reflectionSpy = vi.spyOn(plugin.getObservationHandler(), "emitReflectionEvent");

    // When
    const response = await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "session-success",
      callId: "call-success",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1", prompt: "run" },
        toolResult: "Task completed successfully",
        error: false,
      },
    });

    // Then
    expect(reflectionSpy).toHaveBeenCalledWith({
      trigger: "task_succeeded",
      planRef: { path: "plan.md", taskId: "task-1" },
      intent: "check_complete",
      sessionId: "session-success",
    });
    expect(response).toMatchObject({
      action: "inject",
      injectedContext: expect.stringContaining("plan.md was not updated"),
    });
  });

  it("allocates a UUID-based writer ID when none is provided", async () => {
    // Given
    const { reader, writer } = createMemFs();

    // When
    const first = new JusticePlugin(reader, writer, { workspaceRoot: "/workspace" });
    const second = new JusticePlugin(reader, writer, { workspaceRoot: "/workspace" });
    await first.handleEvent({
      type: "Event",
      sessionId: "writer-first",
      payload: { eventType: "session_error", sessionId: "writer-first", message: "first" },
    });
    await second.handleEvent({
      type: "Event",
      sessionId: "writer-second",
      payload: { eventType: "session_error", sessionId: "writer-second", message: "second" },
    });
    const writerIds = (await first.getObservationHandler().getLogStore().readAll()).map(
      (event) => event.writerId,
    );

    // Then
    expect(writerIds).toHaveLength(2);
    expect(writerIds).toSatisfy((ids: readonly string[]) =>
      ids.every((writerId) => /^w-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(writerId)),
    );
    expect(new Set(writerIds)).toHaveLength(2);
  });

  it("emits a reflection event when the active task is absent from the plan", async () => {
    const { files, reader, writer } = createMemFs();
    files.set("plan.md", ["## Task 1: Setup", "- [ ] Init", ""].join("\n"));

    const plugin = new JusticePlugin(reader, writer, {
      writerId: "w-missing-task",
      workspaceRoot: "/workspace",
    });
    plugin.getPlanBridge().setActivePlan("session-missing", "plan.md");
    plugin.getTaskFeedback().setActivePlan("session-missing", "plan.md", "task-missing");

    await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "session-missing",
      callId: "call-missing",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-missing", prompt: "run" },
        toolResult: "Task completed successfully",
        error: false,
      },
    });

    const path = toPhysicalPath({
      agentId: "unknown",
      sessionId: "session-missing",
      writerId: "w-missing-task",
    });
    const events = parseJsonl(files.get(path));
    const reflection = events.find(
      (event) => isReflectionRecord(event) && event.kind === "reflection",
    );
    expect(reflection).toMatchObject({
      kind: "reflection",
      reflection: {
        trigger: "task_succeeded",
        intent: "check_complete",
        planRef: { taskId: "task-missing" },
      },
    });
  });

  it("emits a reflection event when LoopDetectionHandler detects a loop", async () => {
    const { files, reader, writer } = createMemFs();
    const plan = ["## Task 2: Loop", "- [ ] Fix loop", ""].join("\n");
    files.set("plan.md", plan);

    const plugin = new JusticePlugin(reader, writer, {
      writerId: "w-loop",
      workspaceRoot: "/workspace",
    });
    plugin.getPlanBridge().setActivePlan("session-2", "plan.md");
    plugin.getLoopHandler().setActivePlan("session-2", "plan.md", "task-2", "hephaestus");

    await plugin.handleEvent({
      type: "Event",
      sessionId: "session-2",
      payload: {
        eventType: "loop-detector",
        sessionId: "session-2",
        message: "Loop detected: repeated command pattern",
      },
    });

    const path = toPhysicalPath({
      agentId: "unknown",
      sessionId: "session-2",
      writerId: "w-loop",
    });
    const persisted = files.get(path);
    expect(persisted).toBeDefined();
    const events = parseJsonl(persisted);
    const reflection = events.find(
      (event) => isReflectionRecord(event) && event.kind === "reflection",
    );
    expect(reflection).toMatchObject({
      kind: "reflection",
      reflection: {
        trigger: "task_error",
        planRef: { path: "plan.md", taskId: "task-2" },
        intent: "append_error_note",
        note: "loop_detected: Loop detected: repeated command pattern",
      },
    });
  });

  it("emits a loop reflection when appending the plan error note fails", async () => {
    // Given
    const { files, reader, writer } = createMemFs();
    files.set("plan.md", ["## Task 2: Loop", "- [ ] Fix loop", ""].join("\n"));
    const plugin = new JusticePlugin(reader, rejectPlanWrites(writer), {
      writerId: "w-loop-write",
      workspaceRoot: "/workspace",
    });
    plugin.getLoopHandler().setActivePlan("session-loop", "plan.md", "task-2", "hephaestus");
    const reflectionSpy = vi.spyOn(plugin.getObservationHandler(), "emitReflectionEvent");

    // When
    await plugin.handleEvent({
      type: "Event",
      sessionId: "session-loop",
      payload: {
        eventType: "loop-detector",
        sessionId: "session-loop",
        message: "Loop detected: repeated command pattern",
      },
    });

    // Then
    expect(reflectionSpy).toHaveBeenCalledWith({
      trigger: "task_error",
      planRef: { path: "plan.md", taskId: "task-2" },
      intent: "append_error_note",
      note: "loop_detected: Loop detected: repeated command pattern",
      sessionId: "session-loop",
    });
  });

  it("routes session_error events through ObservationHandler", async () => {
    const { files, reader, writer } = createMemFs();
    const plugin = new JusticePlugin(reader, writer, {
      writerId: "w-session-error",
      workspaceRoot: "/workspace",
    });

    const response = await plugin.handleEvent({
      type: "Event",
      sessionId: "session-3",
      payload: {
        eventType: "session_error",
        sessionId: "session-3",
        message: "session crashed",
        kind: "crash",
      },
    });

    expect(response).toEqual({ action: "proceed" });
    const path = toPhysicalPath({
      agentId: "unknown",
      sessionId: "session-3",
      writerId: "w-session-error",
    });
    const persisted = files.get(path);
    expect(persisted).toBeDefined();
    const events = parseJsonl(persisted);
    const sessionError = events.find(
      (event) => isReflectionRecord(event) && event.kind === "session_error",
    );
    expect(sessionError).toMatchObject({
      kind: "session_error",
      errorKind: "crash",
      message: "session crashed",
    });
  });
});
