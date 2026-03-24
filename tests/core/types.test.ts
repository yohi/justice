import { describe, it, expect } from "vitest";
import type {
  PlanTask,
  PlanStep,
  DelegationRequest,
  TaskFeedback,
  ErrorClass,
  TaskCategory,
  ProtectedContext,
} from "../../src/core/types";

describe("Core Types", () => {
  it("should allow creating a valid PlanTask", () => {
    const task: PlanTask = {
      id: "task-1",
      title: "Setup project",
      steps: [],
      status: "pending",
    };
    expect(task.id).toBe("task-1");
    expect(task.status).toBe("pending");
  });

  it("should allow creating a valid PlanStep", () => {
    const step: PlanStep = {
      id: "task-1-step-1",
      description: "Create directory",
      checked: false,
      lineNumber: 5,
    };
    expect(step.checked).toBe(false);
  });

  it("should allow creating a valid DelegationRequest", () => {
    const req: DelegationRequest = {
      category: "deep",
      prompt: "Implement feature X",
      loadSkills: ["git-master"],
      runInBackground: false,
      context: {
        planFilePath: "docs/plans/plan.md",
        taskId: "task-1",
        referenceFiles: ["src/main.ts"],
      },
    };
    expect(req.category).toBe("deep");
    expect(req.context.referenceFiles).toHaveLength(1);
  });

  it("should allow creating a valid TaskFeedback", () => {
    const feedback: TaskFeedback = {
      taskId: "task-1",
      status: "success",
      retryCount: 0,
      testResults: {
        passed: 5,
        failed: 0,
        skipped: 1,
      },
    };
    expect(feedback.status).toBe("success");
  });

  it("should allow all ErrorClass values", () => {
    const errors: ErrorClass[] = [
      "syntax_error",
      "type_error",
      "test_failure",
      "design_error",
      "timeout",
      "loop_detected",
      "unknown",
    ];
    expect(errors).toHaveLength(7);
  });

  it("should allow all TaskCategory values", () => {
    const categories: TaskCategory[] = [
      "visual-engineering",
      "ultrabrain",
      "deep",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ];
    expect(categories).toHaveLength(7);
  });

  it("should allow creating a valid ProtectedContext", () => {
    const ctx: ProtectedContext = {
      planSnapshot: "# Plan\n- [ ] Task 1",
      currentTaskId: "task-1",
      currentStepId: "task-1-step-2",
      accumulatedLearnings: "Use ESM imports",
      timestamp: "2026-03-24T01:00:00Z",
      activePlanPath: "docs/plans/plan.md",
    };
    expect(ctx.currentTaskId).toBe("task-1");
  });
});
