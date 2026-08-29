import { describe, expect, it, vi } from "vitest";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem, type MockFileSystem } from "../helpers/mock-file-system";

let mockFs: MockFileSystem;

vi.mock("../../src/runtime/node-file-system", () => ({
  NodeFileSystem: function NodeFileSystemMock(): MockFileSystem {
    return mockFs;
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdir: vi.fn(async () => undefined) };
});

describe("OpenCodeAdapter reflection flow", () => {
  it("records a success reflection after adapter-origin task execution without manual feedback setup", async () => {
    // Given
    mockFs = createMockFileSystem({
      "plan.md": ["## Task 1: Setup", "- [ ] Init", ""].join("\n"),
    });
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "session-adapter",
          info: {
            id: "message-user",
            role: "user",
            content: "plan.md の次のタスクを実行してください",
          },
        },
      },
    });
    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "session-adapter",
          info: {
            id: "message-assistant",
            role: "assistant",
            content: "plan.md",
            time: { completed: 1 },
          },
        },
      },
    });
    await adapter.onCommandExecuteBefore(
      {
        command: "/justice-implement",
        sessionID: "session-adapter",
        arguments: "--plan plan.md --approved",
      },
      { parts: [] },
    );
    const before: { args: Record<string, unknown> } = { args: { prompt: "run" } };

    // When
    await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "session-adapter", callID: "call-adapter" },
      before,
    );
    await adapter.onToolExecuteAfter(
      { tool: "task", sessionID: "session-adapter", callID: "call-adapter", args: before.args },
      { output: "Task completed successfully" },
    );

    // Then
    expect(before.args.task_id).toBe("task-1");
    expect(mockFs.writtenFiles["plan.md"]).toContain("- [x] Init");
    const events = await adapter.getJustice()?.getObservationHandler().getLogStore().readAll();
    const reflection = events?.find(
      (event) => event.recordType === "observation" && event.kind === "reflection",
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
});
