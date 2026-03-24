import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { FileReader, PreToolUseEvent } from "../../src/core/types";

describe("Phase 6: Multi-Agent Coordination Flow", () => {
  let fileReader: FileReader;
  let planBridge: PlanBridge;

  beforeEach(() => {
    // A comprehensive plan with dependencies, diverse categories, and varied progress
    const planContent = [
      "# Project Alpha",
      "",
      "## Task 1: Project Setup",
      "- [x] Initialize repository",
      "- [x] Configure linter (depends: task-1)", // Self dependency? Just a note.
      "",
      "## Task 2: Core Architecture Design",
      "- [x] Write architectural spec",
      "",
      "## Task 3: Implement Database Layer",
      "- [ ] Define DB interface (depends: task-2)",
      "- [ ] Write SQL queries",
      "",
      "## Task 4: UI Design System",
      "- [ ] Create CSS variables",
      "- [ ] Build base components",
      "",
      "## Task 5: Integration Tests",
      "- [ ] Write E2E setup (depends: task-3, task-4)",
    ].join("\n");

    fileReader = {
      readFile: vi.fn().mockResolvedValue(planContent),
      fileExists: vi.fn().mockResolvedValue(true),
    };

    planBridge = new PlanBridge(fileReader);
  });

  it("should inject all multi-agent features into context correctly", async () => {
    // 1. Trigger the bridge to process the plan and set the active plan
    const msgRes = await planBridge.handleMessage({
      type: "Message",
      payload: { role: "assistant", content: "Delegate the next task from plan.md" },
      sessionId: "integration-session",
    });

    // 2. Simulate task delegation (PreToolUse)
    const event: PreToolUseEvent = {
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: { prompt: "do Task 3" } },
      sessionId: "integration-session",
    };

    const response = await planBridge.handlePreToolUse(event);

    // 3. Verify the outcome
    expect(response.action).toBe("inject");
    
    if (response.action === "inject") {
      const ctx = response.injectedContext;

      // Assert Category Classification
      // Task 3 is "Implement Database Layer" with "interface", "SQL queries" - likely "deep" by default
      expect(ctx).toContain("**Category**: deep");

      // Assert Dependency-Aware Parallel Execution suggestion
      // Task 1 and 2 are completed.
      // Task 3 depends on 2 (completed) -> Parallelizable
      // Task 4 has no inter-task deps (its step 2 says depends: task-4, so just self) -> Parallelizable
      // The currently delegated task is Task 3. So Task 4 should be suggested as parallel.
      expect(ctx).toContain("**Parallel:** The following tasks can also be run in parallel: task-4");
      expect(ctx).not.toContain("task-5"); // task-5 depends on 3 and 4

      // Assert Progress Reporting
      // Total steps: 8. Completed lines: 3.
      // Setup (2/2), Design (1/1), DB (0/2), UI (0/2), Integration (0/1)
      // 3/8 = 37.5% -> 38%
      expect(ctx).toContain("## 📊 Progress Report");
      expect(ctx).toContain("38% (2/5 tasks)");
      expect(ctx).toContain("✅ Project Setup (2/2 steps)");
      expect(ctx).toContain("✅ Core Architecture Design (1/1 steps)");
      expect(ctx).toContain("⬜ Implement Database Layer");
      expect(ctx).toContain("⬜ UI Design System");
      expect(ctx).toContain("⬜ Integration Tests");
    }
  });
});
