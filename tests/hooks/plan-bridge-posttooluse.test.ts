import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type {
  FileReader,
  PostToolUseEvent,
  WisdomEntryInput,
  WisdomEntry,
  WisdomStoreInterface,
} from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";

function createLoopHandler(reader: FileReader): LoopDetectionHandler {
  return new LoopDetectionHandler(reader, createMockFileWriter(), new TaskSplitter());
}

describe("PlanBridge.handlePostToolUse", () => {
  it("injects Atlas guidance after a completed writing task", async () => {
    const reader = createMockFileReader({
      "plan.md": ["## Task 1: Write docs", "- [ ] Document the new workflow"].join("\n"),
    });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    await bridge.handleMessage({
      type: "Message",
      payload: {
        role: "assistant",
        content: "Delegate the next task from plan.md",
      },
      sessionId: "s-1",
      callId: "c-1",
    });

    const response = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Completed the docs update",
        error: false,
      },
      sessionId: "s-1",
      callId: "c-1",
    } as PostToolUseEvent);

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }

    expect(response.injectedContext).toContain("Atlas guidance");

    // Verify cache is cleared: second call should return PROCEED
    const secondResponse = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Completed the docs update",
        error: false,
      },
      sessionId: "s-1",
      callId: "c-1",
    } as PostToolUseEvent);
    expect(secondResponse.action).toBe("proceed");
  });

  it("clears lastCompletionInputs even if completion is not detected (Issue 3)", async () => {
    const reader = createMockFileReader({
      "plan.md": "## Task 1: Write docs\n- [ ] Document it\n",
    });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    await bridge.handleMessage({
      type: "Message",
      payload: { role: "assistant", content: "Delegate from plan.md" },
      sessionId: "s-issue3",
      callId: "c-issue3",
    });

    // Error event: detectCompletion returns null
    const response1 = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Failed",
        error: true,
      },
      sessionId: "s-issue3",
      callId: "c-issue3",
    } as PostToolUseEvent);

    expect(response1.action).toBe("proceed");

    // Success event later for the same session should NOT find the old input
    const response2 = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Success",
        error: false,
      },
      sessionId: "s-issue3",
      callId: "c-issue3",
    } as PostToolUseEvent);

    expect(response2.action).toBe("proceed");
  });

  it("injects completed-plan notification when no next task is available", async () => {
    const files = {
      "plan.md": ["## Task 1: Write docs", "- [ ] Document the new workflow"].join("\n"),
    };
    const reader = createMockFileReader(files);
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    await bridge.handleImplementationArm("s-completed", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    await bridge.handlePreToolUse({
      type: "PreToolUse",
      payload: {
        toolName: "task",
        toolInput: {
          skills: ["writing-plans"],
        },
      },
      sessionId: "s-completed",
      callId: "c-completed",
    });
    files["plan.md"] = ["## Task 1: Write docs", "- [x] Document the new workflow"].join("\n");

    const response = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Successfully completed",
        error: false,
      },
      sessionId: "s-completed",
      callId: "c-completed",
    } as PostToolUseEvent);

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }
    expect(response.injectedContext).toContain("すべてのタスクが完了しました");
  });

  it("extracts relevant skills and routes correctly", async () => {
    const reader = createMockFileReader({
      "plan.md": ["## Task 1: Fix bug", "- [ ] Debug the crash and fix connection error"].join(
        "\n",
      ),
    });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    await bridge.handleImplementationArm("s-skills", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    await bridge.handlePreToolUse({
      type: "PreToolUse",
      payload: {
        toolName: "task",
        toolInput: {
          skills: ["writing-plans"],
        },
      },
      sessionId: "s-skills",
      callId: "c-skills",
    });

    const response = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Successfully finished writing plan",
        error: false,
      },
      sessionId: "s-skills",
      callId: "c-skills",
    } as PostToolUseEvent);

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }
    // Recommended agent should be sisyphus due to "Debug" / "fix" / "error" matching systematic-debugging skill
    expect(response.injectedContext).toContain("sisyphus");
  });

  it("saves wisdom entries when systematic-debugging completes", async () => {
    const reader = createMockFileReader({
      "plan.md": "## Task 1: Fix bug\n- [ ] Debug the crash\n",
    });

    const addedEntries: WisdomEntryInput[] = [];
    const mockWisdomStore = {
      add: (entry: WisdomEntryInput, _options?: unknown): WisdomEntry => {
        addedEntries.push(entry);
        return { ...entry, id: "w-1", timestamp: "2026-05-25" } as WisdomEntry;
      },
      getRelevant: (): WisdomEntry[] => [],
      getByTaskId: (): WisdomEntry[] => [],
      formatForInjection: (): string => "",
    };

    const bridge = new PlanBridge(
      reader,
      undefined,
      mockWisdomStore satisfies WisdomStoreInterface,
    );

    await bridge.handleImplementationArm("s-debug-wisdom", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    await bridge.handlePreToolUse({
      type: "PreToolUse",
      payload: {
        toolName: "task",
        toolInput: {
          skills: ["systematic-debugging"],
        },
      },
      sessionId: "s-debug-wisdom",
      callId: "c-debug-wisdom",
    });

    const response = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Root cause: missing test configuration. Fixed it.",
        error: false,
      },
      sessionId: "s-debug-wisdom",
      callId: "c-debug-wisdom",
    } as PostToolUseEvent);

    expect(response.action).toBe("inject");
    expect(addedEntries).toHaveLength(1);
    expect(addedEntries.some((e) => e.category === "design_decision")).toBe(true);
    expect(addedEntries.some((e) => e.category === "success_pattern")).toBe(false);
    expect(response.injectedContext).toContain("1 件のWisdomを保存しました");
  });
});
