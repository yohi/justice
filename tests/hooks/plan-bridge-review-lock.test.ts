import { describe, expect, it } from "vitest";
import { extractReviewGateIdFromTaskPrompt } from "../../src/core/review-gate-execution";
import { PlanBridge } from "../../src/hooks/plan-bridge";
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

async function runReview(
  bridge: PlanBridge,
  parentSessionId: string,
  findings: readonly {
    readonly itemKey: string;
    readonly severity: "critical" | "major" | "minor";
    readonly summary: string;
    readonly location: string;
  }[],
  complete = true,
): Promise<string> {
  const started = await bridge.handleReviewGateStart(parentSessionId, {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
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

  await bridge.handlePlanReviewGatePostToolUse({
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
  return gateId;
}

describe("PlanBridge Review Gate implementation lock", () => {
  it("locks implementation as soon as a valid Gate is dispatched", async () => {
    const { bridge } = createLockFixture();

    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
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
    });
    if (started.reviewerPrompt === undefined) throw new Error("Review Gate did not dispatch");

    expect(bridge.isPendingReviewGatePrompt("parent", started.reviewerPrompt)).toBe(true);
    expect(bridge.isPendingReviewGatePrompt("parent", `${started.reviewerPrompt} extra`)).toBe(false);
    expect(bridge.isPendingReviewGatePrompt("other-parent", started.reviewerPrompt)).toBe(false);
  });

  it("requires an explicit arm after a complete zero-finding Gate result", async () => {
    const { bridge } = createLockFixture();
    await runReview(bridge, "parent", []);

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
    await runReview(bridge, "parent", [
      {
        itemKey: "RG-001",
        severity: "major",
        summary: "Missing lifecycle test",
        location: "Task 2",
      },
    ]);

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

  it("keeps incomplete reviewer output locked in remediation", async () => {
    const { bridge } = createLockFixture();
    await runReview(bridge, "parent", [], false);

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
    await runReview(bridge, "parent", []);
    await bridge.handleMessage({
      type: "Message",
      sessionId: "parent",
      payload: { role: "user", content: "Continue implementation" },
    });

    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
    await runReview(bridge, "parent", []);
    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
    expect(bridge.isImplementationArmed("parent")).toBe(false);
  });

  it("does not arm a clear Gate after a reviewed artifact digest changes", async () => {
    const { files, bridge } = createLockFixture();
    await runReview(bridge, "parent", []);
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
    });

    expect(bridge.getReviewGateLock("other-parent")).toBeUndefined();
    await bridge.destroySession("parent");
    expect(bridge.getReviewGateLock("parent")).toBeUndefined();
  });
});
