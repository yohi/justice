import { describe, it, expect, vi, beforeEach } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type { FileReader, FileWriter, HookEvent, MessageEvent, PreToolUseEvent, PostToolUseEvent, EventEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("JusticePlugin", () => {
  let reader: FileReader;
  let writer: FileWriter;
  let plugin: JusticePlugin;

  beforeEach(() => {
    reader = createMockFileReader({
      "plan.md": "## Task 1: Setup\n- [ ] Init\n",
    });
    writer = createMockFileWriter();
    plugin = new JusticePlugin(reader, writer);
  });

  describe("handleEvent", () => {
    it("should route Message events to PlanBridge", async () => {
      const event: MessageEvent = {
        type: "Message",
        payload: { role: "assistant", content: "Delegate the next task from plan.md" },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("inject");
    });

    it("should route PreToolUse events to PlanBridge", async () => {
      // First set active plan via message
      const msgEvent: MessageEvent = {
        type: "Message",
        payload: { role: "assistant", content: "Delegate the next task from plan.md" },
        sessionId: "s-1",
      };
      await plugin.handleEvent(msgEvent);

      const event: PreToolUseEvent = {
        type: "PreToolUse",
        payload: { toolName: "task", toolInput: {} },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("inject");
    });

    it("should route PostToolUse events to TaskFeedbackHandler", async () => {
      const event: PostToolUseEvent = {
        type: "PostToolUse",
        payload: { toolName: "task", toolResult: "All tests passed", error: false },
        sessionId: "s-1",
      };
      // No active session → proceed silently
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("proceed");
    });

    it("should route Event (loop-detector) to LoopDetectionHandler", async () => {
      const event: EventEvent = {
        type: "Event",
        payload: { eventType: "loop-detector", sessionId: "s-1", message: "Loop detected" },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      expect(response.action).toBe("proceed");
    });

    it("should route Event (compaction) to CompactionProtector", async () => {
      const event: EventEvent = {
        type: "Event",
        payload: { eventType: "compaction", sessionId: "s-1", reason: "Context too long" },
        sessionId: "s-1",
      };
      const response = await plugin.handleEvent(event);
      // CompactionProtector needs an active plan to protect
      expect(response.action).toBe("proceed");
    });

    it("should share WisdomStore across PlanBridge and TaskFeedback", () => {
      // The plugin should use a single WisdomStore instance
      const store = plugin.getWisdomStore();
      expect(store).toBeDefined();
    });
  });
});