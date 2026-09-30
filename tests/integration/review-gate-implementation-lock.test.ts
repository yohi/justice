import { describe, expect, it } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { extractReviewGateIdFromTaskPrompt } from "../../src/core/review-gate-execution";
import { createMockFileSystem } from "../helpers/mock-file-system";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const DESIGN_CONTENT = "# Design\nLock implementation after review.\n";
const PLAN_CONTENT = [
  "## Task 1: Enforce the lock",
  "- [x] Add session lock state",
  "- [ ] Add tool cancellation",
].join("\n");

async function createReviewedJustice(): Promise<{
  readonly justice: JusticePlugin;
  readonly gateId: string;
  readonly reviewerPrompt: string;
  readonly workerSessionId: string;
  readonly workerCallId: string;
}> {
  const fs = createMockFileSystem({
    [DESIGN_PATH]: DESIGN_CONTENT,
    [PLAN_PATH]: PLAN_CONTENT,
  });
  const justice = new JusticePlugin(fs, fs);
  await justice.initialize();
  const started = await justice.getPlanBridge().handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  if (started.reviewerPrompt === undefined) throw new Error("Review Gate did not dispatch");
  const gateId = extractReviewGateIdFromTaskPrompt(started.reviewerPrompt);
  if (gateId === undefined) throw new Error("Review Gate prompt has no Gate ID");

  return {
    justice,
    gateId,
    reviewerPrompt: started.reviewerPrompt,
    workerSessionId: "review-controller",
    workerCallId: "review-worker-call",
  };
}

async function completeReview(
  justice: JusticePlugin,
  gateId: string,
  reviewerPrompt: string,
  workerSessionId: string,
  workerCallId: string,
): Promise<void> {
  const claim = await justice.handleEvent({
    type: "PreToolUse",
    sessionId: workerSessionId,
    callId: workerCallId,
    payload: {
      toolName: "task",
      callId: workerCallId,
      toolInput: { prompt: reviewerPrompt },
    },
  });
  if (claim.action !== "inject") throw new Error("Review worker did not claim the Gate");
  const activeGateId = extractReviewGateIdFromTaskPrompt(reviewerPrompt);
  if (activeGateId === undefined) throw new Error("Review Gate prompt has no Gate ID");

  await justice.handleEvent({
    type: "PostToolUse",
    sessionId: workerSessionId,
    callId: workerCallId,
    payload: {
      toolName: "task",
      callId: workerCallId,
      toolResult: JSON.stringify({
        schemaVersion: 1,
        gateId: activeGateId,
        complete: true,
        findings: [],
      }),
      error: false,
    },
  });
  expect(activeGateId).toBe(gateId);
}

describe("Review Gate implementation lock integration", () => {
  it("cancels task and skill tools after a clear result while allowing reads", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } = await createReviewedJustice();
    await completeReview(justice, gateId, reviewerPrompt, workerSessionId, workerCallId);

    const taskResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "implementation-task-call",
      payload: {
        toolName: "task",
        callId: "implementation-task-call",
        toolInput: { task_id: "task-impl", prompt: "implement the plan" },
      },
    });
    const skillResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "implementation-skill-call",
      payload: {
        toolName: "skill",
        toolInput: { name: "executing-plans" },
      },
    });
    const readResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "read-call",
      payload: {
        toolName: "read",
        toolInput: { filePath: PLAN_PATH },
      },
    });

    expect(taskResponse).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
    });
    expect(skillResponse).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
    });
    expect(readResponse).toEqual({ action: "proceed" });
    expect(justice.getSessionStateProvider().getActiveTaskId("implementation-task-call")).toBeUndefined();
  });

  it("keeps ordinary implementation locked in descendants of the gated session", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } = await createReviewedJustice();
    await completeReview(justice, gateId, reviewerPrompt, workerSessionId, workerCallId);

    const response = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "review-worker-child",
      lockOwnerSessionId: "main",
      callId: "child-shell-call",
      payload: {
        toolName: "bash",
        callId: "child-shell-call",
        toolInput: { command: "create-workspace" },
      },
    });

    expect(response).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
    });
  });

  it("permits only the plan artifacts to be edited during remediation", async () => {
    const fs = createMockFileSystem({
      [DESIGN_PATH]: DESIGN_CONTENT,
      [PLAN_PATH]: PLAN_CONTENT,
    });
    const justice = new JusticePlugin(fs, fs);
    await justice.initialize();
    const started = await justice.getPlanBridge().handleReviewGateStart("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    if (started.reviewerPrompt === undefined) throw new Error("Review Gate did not dispatch");
    const gateId = extractReviewGateIdFromTaskPrompt(started.reviewerPrompt);
    if (gateId === undefined) throw new Error("Review Gate prompt has no Gate ID");
    const workerSessionId = "review-controller";
    const workerCallId = "review-worker-call";
    await justice.handleEvent({
      type: "PreToolUse",
      sessionId: workerSessionId,
      callId: workerCallId,
      payload: {
        toolName: "task",
        callId: workerCallId,
        toolInput: { prompt: started.reviewerPrompt },
      },
    });
    await justice.handleEvent({
      type: "PostToolUse",
      sessionId: workerSessionId,
      callId: workerCallId,
      payload: {
        toolName: "task",
        callId: workerCallId,
        toolResult: JSON.stringify({
          schemaVersion: 1,
          gateId,
          complete: true,
          findings: [
            {
              itemKey: "RG-001",
              severity: "major",
              summary: "Plan remediation is required",
              location: "Task 1",
            },
          ],
        }),
        error: false,
      },
    });

    const planEdit = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "plan-edit",
      payload: {
        toolName: "edit",
        toolInput: {},
      },
      reviewGateToolPaths: [PLAN_PATH],
    });
    const codeEdit = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "code-edit",
      payload: {
        toolName: "edit",
        toolInput: {},
      },
      reviewGateToolPaths: ["src/runtime/plan.ts"],
    });

    expect(planEdit).toEqual({ action: "proceed" });
    expect(codeEdit).toMatchObject({
      action: "skip",
      reason: "review_scope_violation",
    });
  });
});
