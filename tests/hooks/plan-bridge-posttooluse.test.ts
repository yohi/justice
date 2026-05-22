/* eslint-disable security/detect-object-injection -- Fixture maps are intentionally indexed by plan path. */
import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { FileReader, HookEvent } from "../../src/core/types";
import { createMockFileWriter } from "../helpers/mock-file-system";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    async readFile(path: string): Promise<string> {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    async fileExists(path: string): Promise<boolean> {
      return path in files;
    },
  };
}

function createLoopHandler(reader: FileReader): LoopDetectionHandler {
  return new LoopDetectionHandler(reader, createMockFileWriter(), new TaskSplitter());
}

describe("PlanBridge.handlePostToolUse", () => {
  it("injects Atlas guidance after a completed writing task", async () => {
    const reader = createMockFileReader({
      "plan.md": [
        "## Task 1: Write docs",
        "- [ ] Document the new workflow",
      ].join("\n"),
    });
    const bridge = new PlanBridge(reader, createLoopHandler(reader));

    await bridge.handleMessage({
      type: "Message",
      payload: {
        role: "assistant",
        content: "Delegate the next task from plan.md",
      },
      sessionId: "s-1",
    });

    const response = await bridge.handlePostToolUse({
      type: "PostToolUse",
      payload: {
        toolName: "task",
        toolResult: "Completed the docs update",
        error: false,
      },
      sessionId: "s-1",
    } as HookEvent);

    expect(response.action).toBe("inject");
    if (response.action !== "inject") {
      throw new Error("expected inject response");
    }

    expect(response.injectedContext).toContain("Atlas guidance");
  });
});

/* eslint-enable security/detect-object-injection */
