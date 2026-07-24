import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(async (workspace) => rm(workspace, { recursive: true })));
});

describe("OpenCodeAdapter reflection flow", () => {
  it("records a success reflection after adapter-origin task execution without manual feedback setup", async () => {
    // Given
    const workspace = await mkdtemp(join(tmpdir(), "justice-reflection-adapter-"));
    workspaces.push(workspace);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspace is created by mkdtemp.
    await writeFile(join(workspace, "plan.md"), ["## Task 1: Setup", "- [ ] Init", ""].join("\n"));
    const adapter = new OpenCodeAdapter(
      fakeInit({
        project: { root: workspace },
        directory: workspace,
        worktree: workspace,
      }),
    );
    await adapter.ensureInitialized();
    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "session-adapter",
          info: { id: "message-user", role: "user", content: "plan.md の次のタスクを実行してください" },
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
    expect(before.args.taskId).toBe("task-1");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- workspace is created by mkdtemp.
    expect(await readFile(join(workspace, "plan.md"), "utf8")).toContain("- [x] Init");
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
