import { describe, expect, it } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import {
  extractReviewGateIdFromTaskPrompt,
  extractReviewGateWorkerPrompt,
} from "../../src/core/review-gate-execution";
import type { HookResponse } from "../../src/core/types";
import { createMockFileSystem } from "../helpers/mock-file-system";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const DESIGN_CONTENT = "# Design\nLock implementation after review.\n";
const PLAN_CONTENT = [
  "## Task 1: Enforce the lock",
  "- [x] Add session lock state",
  "- [ ] Add tool cancellation",
].join("\n");

async function createReviewedJustice(retryBudget = 0): Promise<{
  readonly files: Record<string, string>;
  readonly justice: JusticePlugin;
  readonly gateId: string;
  readonly reviewerPrompt: string;
  readonly workerSessionId: string;
  readonly workerCallId: string;
}> {
  const files: Record<string, string> = {
    [DESIGN_PATH]: DESIGN_CONTENT,
    [PLAN_PATH]: PLAN_CONTENT,
  };
  const fs = createMockFileSystem(files);
  const justice = new JusticePlugin(fs, fs);
  await justice.initialize();
  const started = await justice.getPlanBridge().handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
    retryBudget,
  });
  if (started.reviewerPrompt === undefined) throw new Error("Review Gate did not dispatch");
  const gateId = extractReviewGateIdFromTaskPrompt(started.reviewerPrompt);
  if (gateId === undefined) throw new Error("Review Gate prompt has no Gate ID");

  return {
    files: fs.writtenFiles,
    justice,
    gateId,
    reviewerPrompt: started.reviewerPrompt,
    workerSessionId: "review-controller",
    workerCallId: "review-worker-call",
  };
}

type CompleteReviewInput = {
  readonly justice: JusticePlugin;
  readonly gateId: string;
  readonly reviewerPrompt: string;
  readonly workerSessionId: string;
  readonly workerCallId: string;
  readonly complete?: boolean;
  readonly findings?: readonly {
    readonly itemKey: string;
    readonly severity: "minor";
    readonly summary: string;
    readonly location: string;
  }[];
};

async function completeReview(input: CompleteReviewInput): Promise<HookResponse> {
  const {
    justice,
    gateId,
    reviewerPrompt,
    workerSessionId,
    workerCallId,
    findings = [],
    complete = true,
  } = input;
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

  const response = await justice.handleEvent({
    type: "PostToolUse",
    sessionId: workerSessionId,
    callId: workerCallId,
    payload: {
      toolName: "task",
      callId: workerCallId,
      toolResult: JSON.stringify({
        schemaVersion: 1,
        gateId: activeGateId,
        complete,
        findings,
      }),
      error: false,
    },
  });
  expect(activeGateId).toBe(gateId);
  return response;
}

type CompleteRemediationInput = {
  readonly justice: JusticePlugin;
  readonly gateId: string;
  readonly prompt: string;
  readonly round: number;
  readonly workerSessionId: string;
  readonly workerCallId: string;
  readonly summary: string;
  readonly rawResult?: string;
};

async function completeRemediation(input: CompleteRemediationInput): Promise<HookResponse> {
  const worker = extractReviewGateWorkerPrompt(input.prompt);
  if (
    worker === undefined ||
    worker.role !== "remediation" ||
    worker.gateId !== input.gateId ||
    worker.round !== input.round
  ) {
    throw new Error("Remediation prompt correlation mismatch");
  }
  const claim = await input.justice.handleEvent({
    type: "PreToolUse",
    sessionId: input.workerSessionId,
    callId: input.workerCallId,
    payload: {
      toolName: "task",
      callId: input.workerCallId,
      toolInput: { prompt: input.prompt },
    },
  });
  expect(claim).toMatchObject({
    action: "inject",
    modifiedPayload: { args: { category: "writing", run_in_background: false } },
  });

  return input.justice.handleEvent({
    type: "PostToolUse",
    sessionId: input.workerSessionId,
    callId: input.workerCallId,
    payload: {
      toolName: "task",
      callId: input.workerCallId,
      toolResult:
        input.rawResult ??
        JSON.stringify({
          schemaVersion: 1,
          gateId: input.gateId,
          round: input.round,
          complete: true,
          summary: input.summary,
        }),
      error: false,
    },
  });
}

describe("Review Gate implementation lock integration", () => {
  it("cancels implementation tasks after a clear result while allowing skill loading and reads", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } = await createReviewedJustice();
    const completionResponse = await completeReview({
      justice,
      gateId,
      reviewerPrompt,
      workerSessionId,
      workerCallId,
    });

    expect(completionResponse).toMatchObject({
      action: "inject",
      injectedContext: expect.stringContaining(
        `/justice-implement --plan ${PLAN_PATH} --approved`,
      ),
    });

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
    expect(skillResponse).toEqual({ action: "proceed" });
    expect(readResponse).toEqual({ action: "proceed" });
    expect(justice.getSessionStateProvider().getActiveTaskId("implementation-task-call")).toBeUndefined();
  });

  it("returns reviewed artifact paths and the rerun command when findings need remediation", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } =
      await createReviewedJustice();

    const response = await completeReview({
      justice,
      gateId,
      reviewerPrompt,
      workerSessionId,
      workerCallId,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Move diff verification before commits.",
          location: "Task 3",
        },
      ],
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") return;
    expect(response.injectedContext).toContain("[JUSTICE: REVIEW RETRIES EXHAUSTED]");
    expect(response.injectedContext).toContain(DESIGN_PATH);
    expect(response.injectedContext).toContain(PLAN_PATH);
    expect(justice.getPlanBridge().getReviewGateLock("main")?.phase).toBe("remediation");
  });

  it("runs independent review and remediation workers through multiple rounds before clear", async () => {
    const { files, justice, gateId, reviewerPrompt, workerSessionId, workerCallId } =
      await createReviewedJustice(2);
    const firstRemediation = await completeReview({
      justice,
      gateId,
      reviewerPrompt,
      workerSessionId,
      workerCallId,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Clarify verification ordering.",
          location: "Task 1",
        },
      ],
    });
    if (firstRemediation.action !== "inject") throw new Error("First remediation was not dispatched");
    const firstRepairPrompt = extractReviewGateWorkerPrompt(firstRemediation.injectedContext);
    expect(firstRepairPrompt).toMatchObject({
      role: "remediation",
      gateId,
      round: 1,
      retryBudget: 2,
    });
    files[PLAN_PATH] = `${PLAN_CONTENT}\n- [ ] Clarify verification order`;

    const secondReview = await completeRemediation({
      justice,
      gateId,
      prompt: firstRemediation.injectedContext,
      round: 1,
      workerSessionId: "remediation-worker-1",
      workerCallId: "remediation-call-1",
      summary: "Clarified verification ordering in the plan.",
    });
    if (secondReview.action !== "inject") throw new Error("Second review was not dispatched");
    expect(secondReview.injectedContext).toContain("[JUSTICE: PLAN REVIEW GATE EXECUTION]");
    expect(extractReviewGateWorkerPrompt(secondReview.injectedContext)).toEqual({
      role: "review",
      gateId,
      round: 2,
      retryBudget: 2,
    });

    const secondRemediation = await completeReview({
      justice,
      gateId,
      reviewerPrompt: secondReview.injectedContext,
      workerSessionId: "review-worker-2",
      workerCallId: "review-call-2",
      findings: [
        {
          itemKey: "RG-002",
          severity: "minor",
          summary: "Clarify the Design acceptance boundary.",
          location: "Design §2",
        },
      ],
    });
    if (secondRemediation.action !== "inject") throw new Error("Second remediation was not dispatched");
    expect(extractReviewGateWorkerPrompt(secondRemediation.injectedContext)).toEqual({
      role: "remediation",
      gateId,
      round: 2,
      retryBudget: 2,
    });
    files[DESIGN_PATH] = `${DESIGN_CONTENT}\nAcceptance boundary clarified.\n`;

    const thirdReview = await completeRemediation({
      justice,
      gateId,
      prompt: secondRemediation.injectedContext,
      round: 2,
      workerSessionId: "remediation-worker-2",
      workerCallId: "remediation-call-2",
      summary: "Clarified the Design acceptance boundary.",
    });
    if (thirdReview.action !== "inject") throw new Error("Third review was not dispatched");
    expect(extractReviewGateWorkerPrompt(thirdReview.injectedContext)).toEqual({
      role: "review",
      gateId,
      round: 3,
      retryBudget: 2,
    });

    const clear = await completeReview({
      justice,
      gateId,
      reviewerPrompt: thirdReview.injectedContext,
      workerSessionId: "review-worker-3",
      workerCallId: "review-call-3",
    });

    expect(clear).toMatchObject({
      action: "inject",
      injectedContext: expect.stringContaining(
        `/justice-implement --plan ${PLAN_PATH} --approved`,
      ),
    });
    expect(justice.getPlanBridge().getReviewGateLock("main")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
    expect(
      await justice.getPlanBridge().handleImplementationArm("main", {
        source: "command",
        action: "approve",
        planPath: PLAN_PATH,
        approved: true,
      }),
    ).toMatchObject({ armed: true, planPath: PLAN_PATH });
  });

  it("blocks after the retry budget is consumed by another finding", async () => {
    const { files, justice, gateId, reviewerPrompt, workerSessionId, workerCallId } =
      await createReviewedJustice(1);
    const remediation = await completeReview({
      justice,
      gateId,
      reviewerPrompt,
      workerSessionId,
      workerCallId,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Clarify verification order.",
          location: "Task 1",
        },
      ],
    });
    if (remediation.action !== "inject") throw new Error("Remediation was not dispatched");
    files[PLAN_PATH] = `${PLAN_CONTENT}\n- [ ] Verification ordering clarified`;

    const review = await completeRemediation({
      justice,
      gateId,
      prompt: remediation.injectedContext,
      round: 1,
      workerSessionId: "remediation-worker",
      workerCallId: "remediation-call",
      summary: "Clarified verification order.",
    });
    if (review.action !== "inject") throw new Error("Re-review was not dispatched");

    const exhausted = await completeReview({
      justice,
      gateId,
      reviewerPrompt: review.injectedContext,
      workerSessionId: "review-worker-2",
      workerCallId: "review-call-2",
      findings: [
        {
          itemKey: "RG-002",
          severity: "minor",
          summary: "Clarify a remaining Design boundary.",
          location: "Design §2",
        },
      ],
    });

    expect(exhausted.action).toBe("inject");
    if (exhausted.action !== "inject") return;
    expect(exhausted.injectedContext).toContain("[JUSTICE: REVIEW RETRIES EXHAUSTED]");
    expect(extractReviewGateWorkerPrompt(exhausted.injectedContext)).toBeUndefined();
    expect(justice.getPlanBridge().getReviewGateLock("main")?.phase).toBe("remediation");
    expect(justice.getPlanBridge().hasPendingPlanReviewGate("main")).toBe(false);
  });

  it("keeps the Gate blocked when a remediation worker returns malformed output", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } =
      await createReviewedJustice(1);
    const remediation = await completeReview({
      justice,
      gateId,
      reviewerPrompt,
      workerSessionId,
      workerCallId,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Clarify verification order.",
          location: "Task 1",
        },
      ],
    });
    if (remediation.action !== "inject") throw new Error("Remediation was not dispatched");

    const blocked = await completeRemediation({
      justice,
      gateId,
      prompt: remediation.injectedContext,
      round: 1,
      workerSessionId: "remediation-worker",
      workerCallId: "remediation-call",
      summary: "unused",
      rawResult: "not structured worker output",
    });

    expect(blocked).toMatchObject({ action: "inject" });
    expect(justice.getPlanBridge().getReviewGateLock("main")?.phase).toBe("remediation");
    expect(justice.getPlanBridge().hasPendingPlanReviewGate("main")).toBe(false);
  });

  it("rejects a remediation result from an earlier review round", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } =
      await createReviewedJustice(2);
    const remediation = await completeReview({
      justice,
      gateId,
      reviewerPrompt,
      workerSessionId,
      workerCallId,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Clarify verification order.",
          location: "Task 1",
        },
      ],
    });
    if (remediation.action !== "inject") throw new Error("Remediation was not dispatched");

    const staleResult = await completeRemediation({
      justice,
      gateId,
      prompt: remediation.injectedContext,
      round: 1,
      workerSessionId: "remediation-worker-stale",
      workerCallId: "remediation-call-stale",
      summary: "Stale repair result.",
      rawResult: JSON.stringify({
        schemaVersion: 1,
        gateId,
        round: 2,
        complete: true,
        summary: "Result from a different round.",
      }),
    });

    expect(staleResult.action).toBe("inject");
    if (staleResult.action !== "inject") return;
    expect(extractReviewGateWorkerPrompt(staleResult.injectedContext)).toBeUndefined();
    expect(justice.getPlanBridge().getReviewGateLock("main")?.phase).toBe("remediation");
    expect(justice.getPlanBridge().hasPendingPlanReviewGate("main")).toBe(false);
  });

  it("stops automatic retries when a successful remediation makes no document changes", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } =
      await createReviewedJustice(2);
    const remediation = await completeReview({
      justice,
      gateId,
      reviewerPrompt,
      workerSessionId,
      workerCallId,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Clarify verification order.",
          location: "Task 1",
        },
      ],
    });
    if (remediation.action !== "inject") throw new Error("Remediation was not dispatched");

    const stopped = await completeRemediation({
      justice,
      gateId,
      prompt: remediation.injectedContext,
      round: 1,
      workerSessionId: "remediation-worker-no-progress",
      workerCallId: "remediation-call-no-progress",
      summary: "No changes were necessary.",
    });

    expect(stopped.action).toBe("inject");
    if (stopped.action !== "inject") return;
    expect(stopped.injectedContext).toContain("no observable content changes");
    expect(extractReviewGateWorkerPrompt(stopped.injectedContext)).toBeUndefined();
    expect(justice.getPlanBridge().getReviewGateLock("main")?.phase).toBe("remediation");
    expect(justice.getPlanBridge().hasPendingPlanReviewGate("main")).toBe(false);
  });

  it("keeps ordinary implementation locked in descendants of the gated session", async () => {
    const { justice, gateId, reviewerPrompt, workerSessionId, workerCallId } = await createReviewedJustice();
    await completeReview({ justice, gateId, reviewerPrompt, workerSessionId, workerCallId });

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
      retryBudget: 0,
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
