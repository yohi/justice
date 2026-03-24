import { describe, it, expect } from "vitest";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import type { EventEvent, LoopDetectorPayload } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { TaskSplitter } from "../../src/core/task-splitter";

const samplePlan = ["## Task 1: Refactor", "- [ ] Step A", "- [ ] Step B"].join("\n");

describe("LoopDetectionHandler", () => {
  describe("handleEvent", () => {
    it("should proceed for non-Event events", async () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );
      const response = await handler.handleEvent({
        type: "Message",
        payload: { role: "user", content: "hi" },
        sessionId: "s",
      });
      expect(response.action).toBe("proceed");
    });

    it("should proceed for non-loop-detector events", async () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );
      const event: EventEvent = {
        type: "Event",
        payload: { eventType: "compaction", sessionId: "s", reason: "full" },
        sessionId: "s",
      };
      const response = await handler.handleEvent(event);
      expect(response.action).toBe("proceed");
    });

    it("should proceed if no active plan for session", async () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );
      const payload: LoopDetectorPayload = {
        eventType: "loop-detector",
        sessionId: "s-1",
        message: "Loop detected",
      };
      const response = await handler.handleEvent({
        type: "Event",
        payload,
        sessionId: "s-1",
      });
      expect(response.action).toBe("proceed");
    });

    it("should inject split suggestion and update plan on loop-detector", async () => {
      const reader = createMockFileReader({ "plan.md": samplePlan });
      const writer = createMockFileWriter();
      const splitter = new TaskSplitter();
      const handler = new LoopDetectionHandler(reader, writer, splitter);

      handler.setActivePlan("s-2", "plan.md", "task-1");

      const payload: LoopDetectorPayload = {
        eventType: "loop-detector",
        sessionId: "s-2",
        message: "Applied identical fix 3 times",
      };
      const response = await handler.handleEvent({
        type: "Event",
        payload,
        sessionId: "s-2",
      });

      expect(response.action === "inject").toBe(true);
      if (response.action === "inject") {
        expect(response.injectedContext).toContain(
          "⚠️ **JUSTICE プロテクター**: 無限ループを検知しました（OmO loop-detector）",
        );
        expect(response.injectedContext).toContain("Task task-1.1: Step: Step A");
      }

      // Should append error note
      expect(writer.writtenFiles["plan.md"]).toContain(
        "⚠️ **Error**: loop_detected: Applied identical fix 3 times",
      );
    });
  });
});
