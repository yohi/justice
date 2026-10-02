import { describe, expect, it } from "vitest";
import {
  extractReviewGateIdFromTaskPrompt,
  extractReviewGateWorkerPrompt,
} from "../../src/core/review-gate-execution";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { HookResponse } from "../../src/core/types";
import {
  createMockFileReader,
  wirePlanBridgeAuthorization,
} from "../helpers/mock-file-system";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const DESIGN_CONTENT = "# Design\nReviewed behavior\n";
const PLAN_CONTENT = [
  "## Task 1: Setup",
  "- [x] Create the project",
  "- [ ] Add the implementation lock",
].join("\n");

function createLockFixture(): {
  readonly files: Record<string, string>;
  readonly bridge: PlanBridge;
} {
  const files: Record<string, string> = {
    [DESIGN_PATH]: DESIGN_CONTENT,
    [PLAN_PATH]: PLAN_CONTENT,
  };
  const bridge = new PlanBridge(createMockFileReader(files));
  wirePlanBridgeAuthorization(bridge);
  return { files, bridge };
}

type RunReviewInput = {
  readonly bridge: PlanBridge;
  readonly parentSessionId: string;
  readonly findings: readonly {
    readonly itemKey: string;
    readonly severity: "critical" | "major" | "minor";
    readonly summary: string;
    readonly location: string;
  }[];
  readonly complete?: boolean;
  readonly retryBudget?: number;
};

async function runReview(
  input: RunReviewInput,
): Promise<{ readonly gateId: string; readonly response: HookResponse }> {
  const { bridge, parentSessionId, findings, complete = true, retryBudget = 0 } = input;
  const started = await bridge.handleReviewGateStart(parentSessionId, {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
    retryBudget,
  });
  if (started.reviewerPrompt === undefined) throw new Error("Review Gate did not dispatch");
  const gateId = extractReviewGateIdFromTaskPrompt(started.reviewerPrompt);
  if (gateId === undefined) throw new Error("Review Gate prompt has no Gate ID");

  const workerSessionId = `${parentSessionId}-worker`;
  const callId = `${parentSessionId}-review-call`;
  const claim = await bridge.handlePlanReviewGatePreToolUse({
    type: "PreToolUse",
    sessionId: workerSessionId,
    callId,
    payload: {
      toolName: "task",
      callId,
      toolInput: { prompt: started.reviewerPrompt },
    },
  });
  if (claim === null || claim.action !== "inject") {
    throw new Error("Review worker did not claim the Gate");
  }

  const response = await bridge.handlePlanReviewGatePostToolUse({
    type: "PostToolUse",
    sessionId: workerSessionId,
    callId,
    payload: {
      toolName: "task",
      callId,
      toolResult: JSON.stringify({ schemaVersion: 1, gateId, complete, findings }),
      error: false,
    },
  });
  if (response === null) throw new Error("Review Gate result was not handled");
  return { gateId, response };
}

describe("PlanBridge Review Gate implementation lock", () => {
  it("locks implementation as soon as a valid Gate is dispatched", async () => {
    const { bridge } = createLockFixture();

    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });

    expect(started.dispatched).toBe(true);
    expect(bridge.getReviewGateLock("parent")?.phase).toBe("reviewing");
  });

  it("recognizes only the exact pending controller prompt for the parent session", async () => {
    const { bridge } = createLockFixture();
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    if (started.reviewerPrompt === undefined) throw new Error("Review Gate did not dispatch");

    expect(bridge.isPendingReviewGatePrompt("parent", started.reviewerPrompt)).toBe(true);
    expect(bridge.isPendingReviewGatePrompt("parent", `${started.reviewerPrompt} extra`)).toBe(false);
    expect(bridge.isPendingReviewGatePrompt("other-parent", started.reviewerPrompt)).toBe(false);
  });

  it("requires an explicit arm after a complete zero-finding Gate result", async () => {
    const { bridge } = createLockFixture();
    await runReview({ bridge, parentSessionId: "parent", findings: [] });

    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
    expect(
      await bridge.handleImplementationArm("parent", {
        source: "command",
        action: "approve",
        planPath: PLAN_PATH,
        approved: true,
      }),
    ).toMatchObject({ armed: true, planPath: PLAN_PATH });
    expect(bridge.getReviewGateLock("parent")).toBeUndefined();
    expect(bridge.isImplementationArmed("parent")).toBe(true);
  });

  it("keeps the lock in remediation while actionable findings remain", async () => {
    const { bridge } = createLockFixture();
    await runReview({
      bridge,
      parentSessionId: "parent",
      findings: [
        {
          itemKey: "RG-001",
          severity: "major",
          summary: "Missing lifecycle test",
          location: "Task 2",
        },
      ],
    });

    expect(bridge.getReviewGateLock("parent")?.phase).toBe("remediation");
    expect(
      await bridge.handleImplementationArm("parent", {
        source: "command",
        action: "approve",
        planPath: PLAN_PATH,
        approved: true,
      }),
    ).toMatchObject({ armed: false });
    expect(bridge.getReviewGateLock("parent")?.phase).toBe("remediation");
  });

  it("schedules a marked remediation worker when findings remain and retries are available", async () => {
    const { bridge } = createLockFixture();
    const { gateId, response } = await runReview({
      bridge,
      parentSessionId: "parent",
      retryBudget: 1,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Clarify the verification sequence",
          location: "Task 1",
        },
      ],
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") return;
    expect(extractReviewGateWorkerPrompt(response.injectedContext)).toEqual({
      role: "remediation",
      gateId,
      round: 1,
      retryBudget: 1,
    });
    expect(bridge.isPendingReviewGatePrompt("parent", response.injectedContext)).toBe(true);
  });

  it("runs a scoped repair and independent re-review before awaiting implementation authorization", async () => {
    const { bridge, files } = createLockFixture();
    const { gateId, response: initialResponse } = await runReview({
      bridge,
      parentSessionId: "parent",
      retryBudget: 1,
      findings: [
        {
          itemKey: "RG-001",
          severity: "minor",
          summary: "Clarify the verification sequence",
          location: "Task 1",
        },
      ],
    });
    if (initialResponse.action !== "inject") throw new Error("Expected remediation prompt");
    const remediationPrompt = extractReviewGateWorkerPrompt(initialResponse.injectedContext);
    if (remediationPrompt === undefined) throw new Error("Remediation prompt is not marked");

    const remediationCallId = "parent-remediation-call";
    const remediationSessionId = "parent-remediation-worker";
    const remediationClaim = await bridge.handlePlanReviewGatePreToolUse({
      type: "PreToolUse",
      sessionId: remediationSessionId,
      callId: remediationCallId,
      payload: {
        toolName: "task",
        callId: remediationCallId,
        toolInput: { prompt: initialResponse.injectedContext },
      },
    });
    expect(remediationClaim).toMatchObject({
      action: "inject",
      modifiedPayload: { args: { category: "writing", run_in_background: false } },
    });

    files[PLAN_PATH] = `${PLAN_CONTENT}\n- [ ] Clarify verification order`;
    const reReviewResponse = await bridge.handlePlanReviewGatePostToolUse({
      type: "PostToolUse",
      sessionId: remediationSessionId,
      callId: remediationCallId,
      payload: {
        toolName: "task",
        callId: remediationCallId,
        toolResult: JSON.stringify({
          schemaVersion: 1,
          gateId,
          round: 1,
          complete: true,
          summary: "Clarified verification order in the plan.",
        }),
        error: false,
      },
    });
    if (reReviewResponse?.action !== "inject") throw new Error("Re-review was not scheduled");
    const reReviewPrompt = extractReviewGateWorkerPrompt(reReviewResponse.injectedContext);
    expect(reReviewPrompt).toEqual({ role: "review", gateId, round: 2, retryBudget: 1 });

    const reReviewCallId = "parent-re-review-call";
    const reReviewSessionId = "parent-re-review-worker";
    await bridge.handlePlanReviewGatePreToolUse({
      type: "PreToolUse",
      sessionId: reReviewSessionId,
      callId: reReviewCallId,
      payload: {
        toolName: "task",
        callId: reReviewCallId,
        toolInput: { prompt: reReviewResponse.injectedContext },
      },
    });
    const clearResponse = await bridge.handlePlanReviewGatePostToolUse({
      type: "PostToolUse",
      sessionId: reReviewSessionId,
      callId: reReviewCallId,
      payload: {
        toolName: "task",
        callId: reReviewCallId,
        toolResult: JSON.stringify({ schemaVersion: 1, gateId, complete: true, findings: [] }),
        error: false,
      },
    });

    expect(clearResponse).toMatchObject({
      action: "inject",
      injectedContext: expect.stringContaining(
        `/justice-implement --plan ${PLAN_PATH} --approved`,
      ),
    });
    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
  });

  it("keeps incomplete reviewer output locked in remediation", async () => {
    const { bridge } = createLockFixture();
    await runReview({ bridge, parentSessionId: "parent", findings: [], complete: false });

    expect(bridge.getReviewGateLock("parent")?.phase).toBe("remediation");
    expect(
      await bridge.handleImplementationArm("parent", {
        source: "command",
        action: "approve",
        planPath: PLAN_PATH,
        approved: true,
      }),
    ).toMatchObject({ armed: false });
  });

  it("retains implementation lock across user messages and repeated clear reviews", async () => {
    const { bridge } = createLockFixture();
    await runReview({ bridge, parentSessionId: "parent", findings: [] });
    await bridge.handleMessage({
      type: "Message",
      sessionId: "parent",
      payload: { role: "user", content: "Continue implementation" },
    });

    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
    await runReview({ bridge, parentSessionId: "parent", findings: [] });
    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
    expect(bridge.isImplementationArmed("parent")).toBe(false);
  });

  it("does not arm a clear Gate after a reviewed artifact digest changes", async () => {
    const { files, bridge } = createLockFixture();
    await runReview({ bridge, parentSessionId: "parent", findings: [] });
    files[PLAN_PATH] = `${PLAN_CONTENT}\nChanged after review\n`;

    expect(
      await bridge.handleImplementationArm("parent", {
        source: "command",
        action: "approve",
        planPath: PLAN_PATH,
        approved: true,
      }),
    ).toMatchObject({ armed: false });
    expect(bridge.getReviewGateLock("parent")?.phase).toBe("remediation");
    expect(bridge.isImplementationArmed("parent")).toBe(false);
  });

  it("keeps lock state isolated per parent session and removes it with the session", async () => {
    const { bridge } = createLockFixture();
    await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });

    expect(bridge.getReviewGateLock("other-parent")).toBeUndefined();
    await bridge.destroySession("parent");
    expect(bridge.getReviewGateLock("parent")).toBeUndefined();
  });
});
