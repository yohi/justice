import { describe, it, expect } from "vitest";
import { CompactionProtector } from "../../src/hooks/compaction-protector";
import type { ProtectedContext } from "../../src/core/types";

describe("CompactionProtector", () => {
  describe("createSnapshot", () => {
    it("should create a snapshot of current plan state", () => {
      const protector = new CompactionProtector();
      protector.setActivePlan("docs/plans/plan.md");
      const planContent = "# Plan\n- [ ] Task 1\n- [x] Task 2\n";

      const snapshot = protector.createSnapshot({
        planContent,
        currentTaskId: "task-1",
        currentStepId: "task-1-step-1",
        learnings: "Use strict mode",
      });

      expect(snapshot.planSnapshot).toBe(planContent);
      expect(snapshot.currentTaskId).toBe("task-1");
      expect(snapshot.currentStepId).toBe("task-1-step-1");
      expect(snapshot.accumulatedLearnings).toBe("Use strict mode");
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.activePlanPath).toBe("docs/plans/plan.md");
    });
  });
  describe("formatForInjection", () => {
    it("should format a snapshot for post-compaction injection", () => {
      const protector = new CompactionProtector();
      const snapshot: ProtectedContext = {
        planSnapshot: "# Plan\n- [ ] Step 1\n- [x] Step 2\n- [x] Step 3\n",
        currentTaskId: "task-2",
        currentStepId: "task-2-step-1",
        accumulatedLearnings: "Use ESM imports",
        timestamp: "2026-03-24T01:00:00.000Z",
        activePlanPath: "docs/plans/plan.md",
      };

      const formatted = protector.formatForInjection(snapshot);

      expect(formatted).toContain("[JUSTICE: Protected Context Restored]");
      expect(formatted).toContain("task-2");
      expect(formatted).toContain("task-2-step-1");
      expect(formatted).toContain("Use ESM imports");
      expect(formatted).toContain("**Timestamp**: 2026-03-24T01:00:00.000Z");
      expect(formatted).toContain(
        "**Plan Snapshot**:\n```markdown\n# Plan\n- [ ] Step 1\n- [x] Step 2\n- [x] Step 3\n\n```",
      );
    });

    it("should include progress summary", () => {
      const protector = new CompactionProtector();
      const snapshot: ProtectedContext = {
        planSnapshot:
          "### Task 1: Done\n- [x] Step 1\n### Task 2: WIP\n- [ ] Step 1\n### Task 3: TODO\n- [ ] Step 1\n",
        currentTaskId: "task-2",
        currentStepId: "task-2-step-1",
        accumulatedLearnings: "",
        timestamp: "2026-03-24T01:00:00.000Z",
        activePlanPath: "docs/plans/plan.md",
      };

      const formatted = protector.formatForInjection(snapshot);
      expect(formatted).toContain("**Progress**: 1/3 tasks completed");
    });
  });
  describe("shouldProtect", () => {
    it("should return true when there is an active plan", () => {
      const protector = new CompactionProtector();
      protector.setActivePlan("docs/plans/plan.md");
      expect(protector.shouldProtect()).toBe(true);
    });

    it("should return false when there is no active plan", () => {
      const protector = new CompactionProtector();
      expect(protector.shouldProtect()).toBe(false);
    });
  });
});
