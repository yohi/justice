import { describe, it, expect, vi } from "vitest";
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

      handler.setActivePlan("s-2", "plan.md", "task-1", "hephaestus");

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

  describe("review rejection pivots", () => {
    it("#1: single NG results in pivoted=false with 1 excerpt", () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );

      const decision = handler.recordReviewOutput("s-1", "task-1", "BLOCKER: missing tests");

      expect(decision.pivoted).toBe(false);
      expect(decision.rejections).toBe(1);
      expect(decision.recentExcerpts.length).toBe(1);
      expect(decision.maxRejections).toBe(3);
    });

    it("#2: three consecutive NGs triggers pivot to hephaestus", () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );

      handler.recordReviewOutput("s-1", "task-1", "BLOCKER: missing tests");
      handler.recordReviewOutput("s-1", "task-1", "MUST FIX: improve error handling");
      const decision = handler.recordReviewOutput(
        "s-1",
        "task-1",
        "requested changes before merge",
      );

      expect(decision.pivoted).toBe(true);
      expect(decision.targetAgent).toBe("hephaestus");
      expect(decision.rejections).toBe(3);
      expect(decision.reason).toBe("review_rejection_threshold");
      expect(decision.recentExcerpts.length).toBeGreaterThanOrEqual(1);
    });

    it("#3: two NGs stays below threshold", () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );

      handler.recordReviewOutput("s-2", "task-2", "BLOCKER: missing tests");
      const decision = handler.recordReviewOutput("s-2", "task-2", "MUST FIX: add coverage");

      expect(decision.pivoted).toBe(false);
      expect(decision.rejections).toBe(2);
    });

    it("#4: non-rejection output resets rejections and clears excerpts", () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );

      handler.recordReviewOutput("s-3", "task-3", "BLOCKER: missing tests");
      const decision = handler.recordReviewOutput("s-3", "task-3", "Looks good to me");

      expect(decision.pivoted).toBe(false);
      expect(decision.rejections).toBe(0);
      expect(decision.recentExcerpts).toEqual([]);
    });

    it("#5: env var MAX_REVIEW_REJECTIONS_BEFORE_PIVOT=5 triggers on 5th", () => {
      const prev = process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT;
      process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT = "5";
      try {
        const handler = new LoopDetectionHandler(
          createMockFileReader({}),
          createMockFileWriter(),
          new TaskSplitter(),
        );

        for (let i = 0; i < 4; i++) {
          const d = handler.recordReviewOutput("s-5", "task-5", "BLOCKER: issue");
          expect(d.pivoted).toBe(false);
        }
        const decision = handler.recordReviewOutput("s-5", "task-5", "MUST FIX: another");
        expect(decision.pivoted).toBe(true);
        expect(decision.rejections).toBe(5);
        expect(decision.maxRejections).toBe(5);
      } finally {
        if (prev === undefined) {
          delete process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT;
        } else {
          process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT = prev;
        }
      }
    });

    it("#6: env var 'abc' (NaN) falls back to default 3", () => {
      const prev = process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT;
      process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT = "abc";
      try {
        const handler = new LoopDetectionHandler(
          createMockFileReader({}),
          createMockFileWriter(),
          new TaskSplitter(),
        );

        handler.recordReviewOutput("s-6", "task-6", "BLOCKER: issue");
        handler.recordReviewOutput("s-6", "task-6", "BLOCKER: issue2");
        const decision = handler.recordReviewOutput("s-6", "task-6", "MUST FIX: something");
        expect(decision.pivoted).toBe(true);
        expect(decision.maxRejections).toBe(3);
      } finally {
        if (prev === undefined) {
          delete process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT;
        } else {
          process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT = prev;
        }
      }
    });

    it("#7: env var '0' or '-1' falls back to default 3", () => {
      for (const value of ["0", "-1"]) {
        const prev = process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT;
        process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT = value;
        try {
          const handler = new LoopDetectionHandler(
            createMockFileReader({}),
            createMockFileWriter(),
            new TaskSplitter(),
          );

          handler.recordReviewOutput("s-7", "task-7", "BLOCKER: issue");
          handler.recordReviewOutput("s-7", "task-7", "BLOCKER: issue2");
          const decision = handler.recordReviewOutput("s-7", "task-7", "MUST FIX: something");
          expect(decision.pivoted).toBe(true);
          expect(decision.maxRejections).toBe(3);
        } finally {
          if (prev === undefined) {
            delete process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT;
          } else {
            process.env.MAX_REVIEW_REJECTIONS_BEFORE_PIVOT = prev;
          }
        }
      }
    });

    it("#8: recordReviewOutput records trial with agent=prometheus, result=failure", () => {
      const handler = new LoopDetectionHandler(
        createMockFileReader({}),
        createMockFileWriter(),
        new TaskSplitter(),
      );

      handler.recordReviewOutput("s-8", "task-8", "BLOCKER: missing tests");

      const history = handler.getTrialHistory("s-8", "task-8");
      expect(history.length).toBe(1);
      expect(history[0].agent).toBe("prometheus");
      expect(history[0].result).toBe("failure");
      expect(history[0].wisdom).toContain("review_rejected");
    });

    it("#9: removeSession clears rejections and excerpts", () => {
      const reader = createMockFileReader({});
      const writer = createMockFileWriter();
      const handler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
      const nowSpy = vi.spyOn(Date, "now");

      try {
        nowSpy.mockReturnValue(0);
        handler.setActivePlan("old-session", "plan.md", "task-1", "hephaestus");
        handler.recordReviewOutput("old-session", "task-1", "BLOCKER: missing tests");
        handler.recordReviewOutput("old-session", "task-1", "BLOCKER: bad design");
        handler.recordReviewOutput("old-session", "task-1", "MUST FIX: everything");

        nowSpy.mockReturnValue(30 * 60 * 1000 + 1);
        handler.setActivePlan("new-session", "plan.md", "task-2", "hephaestus");

        const pivot = handler.evaluatePivot("old-session", "task-1");
        expect(pivot.rejections).toBe(0);
        expect(pivot.pivoted).toBe(false);
        expect(pivot.recentExcerpts).toEqual([]);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});
