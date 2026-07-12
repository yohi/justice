import { describe, expect, it } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { createMemFs } from "../helpers/mock-file-system";

function parseJsonl(content: string | undefined): unknown[] {
  if (!content) return [];
  return content
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}


describe("JusticePlugin reflection event integration", () => {
  it("emits a reflection event when TaskFeedbackHandler handles a successful task", async () => {
    const { files, reader, writer } = createMemFs();
    const plan = ["## Task 1: Setup", "- [ ] Init", ""].join("\n");
    files.set("plan.md", plan);

    const plugin = new JusticePlugin(reader, writer, {
      writerId: "w-reflection",
      workspaceRoot: "/workspace",
    });
    plugin.getPlanBridge().setActivePlan("session-1", "plan.md");
    plugin.getTaskFeedback().setActivePlan("session-1", "plan.md", "task-1");

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

    const path = toPhysicalPath({
      agentId: "unknown",
      sessionId: "session-1",
      writerId: "w-reflection",
    });
    const persisted = files.get(path);
    expect(persisted).toBeDefined();
    const events = parseJsonl(persisted);
    const reflection = events.find((e: { kind: string }) => e.kind === "reflection");
    expect(reflection).toMatchObject({
      kind: "reflection",
      reflection: {
        trigger: "task_succeeded",
        planRef: { path: "plan.md", taskId: "task-1" },
        intent: "check_complete",
      },
    });
  });

  it("does not emit a reflection event when the active task is absent from the plan", async () => {
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
      (event): event is { readonly kind: string } =>
        typeof event === "object" && event !== null && "kind" in event && event.kind === "reflection",
    );
    expect(reflection).toBeUndefined();
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
    const reflection = events.find((e: { kind: string }) => e.kind === "reflection");
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
    const sessionError = events.find((e: { kind: string }) => e.kind === "session_error");
    expect(sessionError).toMatchObject({
      kind: "session_error",
      errorKind: "crash",
      message: "session crashed",
    });
  });
});
