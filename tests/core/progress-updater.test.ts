import { describe, expect, it } from "vitest";
import { PlanParser } from "../../src/core/plan-parser";
import { updatePlanProgress } from "../../src/core/progress-updater";
import type { PlanTask } from "../../src/core/types";
import type { TaskAcceptanceDecision } from "../../src/core/v2/decision-model";

function buildAcceptanceDecision(
  verdict: TaskAcceptanceDecision["verdict"],
): TaskAcceptanceDecision {
  return {
    schemaVersion: 1,
    timestamp: "2026-09-05T00:00:00.000Z",
    agentId: "system",
    sessionId: "s-1",
    writerId: "w-test",
    sequence: 1,
    recordType: "decision",
    kind: "task-acceptance",
    taskId: "task-1",
    taskExecutionRef: { authorizationId: "auth-1", taskId: "task-1", attemptId: "attempt-1" },
    verdict,
  };
}

const acceptedDecision = buildAcceptanceDecision("accepted");
const reworkDecision = buildAcceptanceDecision("rework-required");
const blockedDecision = buildAcceptanceDecision("blocked");

const planWithThreeUncheckedSteps = [
  "## Task 1: Implement",
  "- [ ] first",
  "- [ ] second",
  "- [ ] third",
].join("\n");

const task: PlanTask = {
  id: "task-1",
  title: "Implement",
  steps: [
    { id: "task-1-step-1", description: "first", checked: false, lineNumber: 2 },
    { id: "task-1-step-2", description: "second", checked: false, lineNumber: 3 },
    { id: "task-1-step-3", description: "third", checked: false, lineNumber: 4 },
  ],
  status: "pending",
};

const planWithOneCheckedStepAndAnotherTask = [
  "## Task 1: Implement",
  "- [x] first",
  "- [ ] second",
  "## Task 2: Other",
  "- [ ] other step",
].join("\n");

const partiallyDoneTask: PlanTask = {
  id: "task-1",
  title: "Implement",
  steps: [
    { id: "task-1-step-1", description: "first", checked: true, lineNumber: 2 },
    { id: "task-1-step-2", description: "second", checked: false, lineNumber: 3 },
  ],
  status: "in_progress",
};

const expectedOnlyTargetChanged = [
  "## Task 1: Implement",
  "- [x] first",
  "- [x] second",
  "## Task 2: Other",
  "- [ ] other step",
].join("\n");

const planWithZeroStepTask = "## Task 1: Empty\n\nSome notes without checkboxes\n";

const zeroStepTask: PlanTask = { id: "task-1", title: "Empty", steps: [], status: "pending" };

describe("updatePlanProgress", () => {
  it("does not update a checkbox for rework-required or blocked", () => {
    expect(updatePlanProgress(planWithThreeUncheckedSteps, task, reworkDecision)).toEqual({
      content: planWithThreeUncheckedSteps,
      updated: false,
    });
    expect(updatePlanProgress(planWithThreeUncheckedSteps, task, blockedDecision)).toEqual({
      content: planWithThreeUncheckedSteps,
      updated: false,
    });
  });

  it("updates only an accepted task", () => {
    const result = updatePlanProgress(planWithThreeUncheckedSteps, task, acceptedDecision);
    expect(result.content).toContain("- [x] first");
    expect(result.content).toContain("- [x] second");
    expect(result.content).toContain("- [x] third");
    expect(new PlanParser().parse(result.content).find((item) => item.id === task.id)?.status).toBe(
      "completed",
    );
  });

  it("preserves checked steps and leaves every other task unchanged", () => {
    expect(
      updatePlanProgress(planWithOneCheckedStepAndAnotherTask, partiallyDoneTask, acceptedDecision)
        .content,
    ).toEqual(expectedOnlyTargetChanged);
  });

  it("does not throw or change a zero-step accepted task", () => {
    expect(updatePlanProgress(planWithZeroStepTask, zeroStepTask, acceptedDecision)).toEqual({
      content: planWithZeroStepTask,
      updated: false,
    });
  });
});
