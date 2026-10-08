import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { wirePlanBridgeAuthorization } from "../helpers/mock-file-system";
import type { FileReader, HookResponse, PreToolUseEvent } from "../../src/core/types";
import {
  parsePacketPayload,
  createTestReviewGateCoordinator,
} from "../helpers/review-gate-coordinator";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const DESIGN_CONTENT = "# Design\nReviewed behavior\n";
const PLAN_CONTENT = [
  "## Task 1: Setup",
  "- [x] Create the project",
  "- [ ] Add the implementation lock",
].join("\n");

type GateHarness = {
  readonly bridge: PlanBridge;
  readonly files: Map<string, string>;
};

function createLockHarness(mutation: boolean): GateHarness {
  const files = new Map<string, string>([
    [DESIGN_PATH, DESIGN_CONTENT],
    [PLAN_PATH, PLAN_CONTENT],
  ]);
  const bridge = new PlanBridge({
    readFile: async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    fileExists: async (path: string) => files.has(path),
    listFiles: async () => [...files.keys()],
    readFileStats: async () => null,
  } as unknown as FileReader);
  wirePlanBridgeAuthorization(bridge);

  const coordinator = createTestReviewGateCoordinator({
    files,
    ...(mutation
      ? {
          mutationSubstrate: {
            commitArtifact: async () => ({ commitSha: "aaaabbbbccccdddd000011112222333344445555" }),
            restoreArtifact: async () => {},
          },
        }
      : {}),
  });
  bridge.setReviewGateCoordinator(coordinator);
  return { bridge, files };
}

async function claimWorker(
  bridge: PlanBridge,
  callId: string,
  workerPrompt: string,
): Promise<{ readonly input: PreToolUseEvent; readonly args: Record<string, unknown> }> {
  const input: PreToolUseEvent = {
    type: "PreToolUse",
    sessionId: `${callId}-worker`,
    callId,
    payload: { toolName: "task", callId, toolInput: { prompt: workerPrompt } },
  };
  const response = await bridge.handlePlanReviewGatePreToolUse(input);
  if (response === null || response.action !== "inject") {
    throw new Error("worker call was not claimed");
  }
  const args = (response.modifiedPayload as { args?: Record<string, unknown> })?.args;
  if (args === undefined) throw new Error("claim carried no modified task args");
  return { input, args };
}

async function submitResult(
  bridge: PlanBridge,
  input: PreToolUseEvent,
  toolResult: string,
): Promise<HookResponse> {
  const response = await bridge.handlePlanReviewGatePostToolUse({
    type: "PostToolUse",
    sessionId: input.sessionId,
    callId: input.callId,
    payload: {
      toolName: "task",
      callId: input.callId,
      toolResult,
      error: false,
    },
  });
  if (response === null) throw new Error("result was not handled");
  return response;
}

function envelopeOf(args: Record<string, unknown>): Record<string, unknown> {
  return parsePacketPayload(args.prompt as string);
}

function nextPromptArgsOf(response: HookResponse): Record<string, unknown> {
  if (response.action !== "inject") throw new Error("expected next dispatch");
  const args = (response.modifiedPayload as { args?: Record<string, unknown> } | undefined)?.args;
  if (args === undefined) throw new Error("expected next dispatch");
  return args;
}

function nextPromptOf(response: HookResponse): string {
  return nextPromptArgsOf(response).prompt as string;
}

async function runReviewerStep(
  bridge: PlanBridge,
  workerPrompt: string,
  candidates: readonly Record<string, unknown>[],
  callId: string,
): Promise<{ readonly response: HookResponse; readonly args: Record<string, unknown> }> {
  const step = await claimWorker(bridge, callId, workerPrompt);
  const payload = envelopeOf(step.args);
  const result = JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidates,
  });
  const response = await submitResult(bridge, step.input, result);
  return { response, args: step.args };
}

async function runValidatorStep(
  bridge: PlanBridge,
  workerPrompt: string,
  candidateId: string,
  callId: string,
): Promise<Record<string, unknown>> {
  const step = await claimWorker(bridge, callId, workerPrompt);
  const payload = envelopeOf(step.args);
  const result = JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidateId,
    decision: "VALID",
    severity: "blocking",
    observedPhase: payload.phase,
    semanticBasis: {
      violationType: "UNVERIFIED_CLAIM",
      governingReference: "design.md#reviewed-behavior",
      semanticLocation: "Task 1",
      violatedContract: "reviewed-behavior",
      ownerScope: "plan",
    },
    relation: "NEW",
  });
  const response = await submitResult(bridge, step.input, result);
  return (response as { modifiedPayload?: { args?: Record<string, unknown> } }).modifiedPayload?.args ?? {};
}

describe("PlanBridge Review Gate implementation lock (coordinator)", () => {
  it("locks implementation as soon as a valid Gate is dispatched and pins the pending prompt", async () => {
    const { bridge } = createLockHarness(false);
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    expect(started.dispatched).toBe(true);
    expect(started.reviewerPrompt).toContain("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
    expect(bridge.getReviewGateLock("parent")?.phase).toBe("reviewing");
    expect(bridge.isPendingReviewGatePrompt("parent", started.reviewerPrompt as string)).toBe(true);
    expect(bridge.isPendingReviewGatePrompt("parent", `${started.reviewerPrompt} extra`)).toBe(false);
    expect(bridge.isPendingReviewGatePrompt("other-parent", started.reviewerPrompt as string)).toBe(false);
  });

  it("allows only the claimed pending worker task while every other task stays denied", async () => {
    const { bridge } = createLockHarness(false);
    await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });

    expect(
      bridge.classifyReviewGateToolUse("parent", {
        toolName: "task",
        isPendingReviewGateTask: true,
        queryOnly: false,
        changedPaths: null,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      bridge.classifyReviewGateToolUse("parent", {
        toolName: "task",
        isPendingReviewGateTask: false,
        queryOnly: false,
        changedPaths: null,
      }),
    ).toEqual({ kind: "deny", reason: "implementation_not_authorized" });
    expect(
      bridge.classifyReviewGateToolUse("other-parent", {
        toolName: "edit",
        isPendingReviewGateTask: false,
        queryOnly: false,
        changedPaths: null,
      }),
    ).toBeUndefined();
    expect(
      bridge.classifyReviewGateToolUse("other-parent", {
        toolName: "read",
        isPendingReviewGateTask: false,
        queryOnly: false,
        changedPaths: null,
      }),
    ).toBeUndefined();
  });

  it("schedules the finding validator in a fresh validator context after one candidate is observed", async () => {
    const { bridge } = createLockHarness(true);
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 1,
    });
    const { response } = await runReviewerStep(bridge, started.reviewerPrompt as string, [
      { candidateId: "cand-1", severity: "major", summary: "Missing lifecycle test", location: "Task 1" },
    ], "review-1");

    const nextArgs = nextPromptArgsOf(response);
    expect(nextArgs.subagent_type).toBe("justice-review-finding-validator");
    expect(bridge.hasPendingPlanReviewGate("parent")).toBe(true);
  });

  it("runs remediation to the commit boundary and blocks safely without a mutation substrate", async () => {
    const { bridge, files } = createLockHarness(false);
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 2,
    });
    await runReviewerStep(bridge, started.reviewerPrompt as string, [
      { candidateId: "cand-1", severity: "major", summary: "Missing lifecycle test", location: "Task 1" },
    ], "review-1");
    const validatorPrompt = [...((bridge as unknown as { pendingPlanReviewGates: Map<string, { workerPrompt: string }> }).pendingPlanReviewGates.values())][0];
    const validatorArgs = await runValidatorStep(bridge, validatorPrompt.workerPrompt, "cand-1", "validate-1");
    expect(validatorArgs.subagent_type).toBe("justice-review-remediator");

    const remStep = await claimWorker(bridge, "rem-1", validatorArgs.prompt as string);
    const remPayload = envelopeOf(remStep.args);
    files.set(PLAN_PATH, `${PLAN_CONTENT}\n- [x] Add the lifecycle test\n`);
    const remResult = JSON.stringify({
      schemaVersion: 1,
      operationId: remPayload.operationId,
      gateId: remPayload.gateId,
      phase: remPayload.phase,
      reviewAttemptId: null,
      remediationRound: remPayload.remediationRound,
      targetPath: (remPayload.targetArtifact as Record<string, unknown>).canonicalPath,
      outcome: "COMPLETED",
      summary: "Added the lifecycle test",
    });
    const selfReviewResponse = await submitResult(bridge, remStep.input, remResult);
    const selfReviewArgs = nextPromptArgsOf(selfReviewResponse);
    expect(selfReviewArgs.subagent_type).toBe("justice-review-finding-validator");

    const srStep = await claimWorker(bridge, "sr-1", selfReviewArgs.prompt as string);
    const srPayload = envelopeOf(srStep.args);
    const srResult = JSON.stringify({
      schemaVersion: 1,
      operationId: srPayload.operationId,
      gateId: srPayload.gateId,
      phase: srPayload.phase,
      reviewAttemptId: null,
      remediationRound: srPayload.remediationRound,
      targetLineageChecks: (srPayload.targetLineageRefs as string[]).map((lineageId) => ({
        lineageId,
        result: "RESOLVED",
      })),
      discoveredFindings: [],
    });
    const blocked = await submitResult(bridge, srStep.input, srResult);
    expect(blocked.action).toBe("inject");
    if (blocked.action !== "inject") return;
    expect(blocked.injectedContext).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(blocked.injectedContext).toContain("mutation substrate is unavailable");
    expect(bridge.hasPendingPlanReviewGate("parent")).toBe(false);
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

  it("locks plain reviewer output when the result fails strict parsing", async () => {
    const { bridge } = createLockHarness(false);
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    const step = await claimWorker(bridge, "call-1", started.reviewerPrompt as string);
    const response = await submitResult(bridge, step.input, "not a strict packet result");
    expect(response.action).toBe("inject");
    if (response.action !== "inject") return;
    expect(response.injectedContext).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(
      await bridge.handleImplementationArm("parent", {
        source: "command",
        action: "approve",
        planPath: PLAN_PATH,
        approved: true,
      }),
    ).toMatchObject({ armed: false });
  });

  it("completes a zero-finding gate to the clear boundary and reuses the completed binding read-only", async () => {
    const { bridge } = createLockHarness(true);
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    const review1 = await runReviewerStep(bridge, started.reviewerPrompt as string, [], "review-1");
    const planReviewPrompt = nextPromptOf(review1.response);
    const review2 = await runReviewerStep(bridge, planReviewPrompt, [], "review-2");
    expect(review2.response.action).toBe("inject");
    if (review2.response.action !== "inject") return;
    expect(review2.response.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");
    expect(review2.response.injectedContext).toContain(
      `/justice-implement --plan ${PLAN_PATH} --approved`,
    );
    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );

    await bridge.handleMessage({
      type: "Message",
      sessionId: "parent",
      payload: { role: "user", content: "Continue implementation" },
    });
    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );

    const reuse = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    expect(reuse.dispatched).toBe(false);
    expect(bridge.getReviewGateLock("parent")?.phase).toBe(
      "awaiting_implementation_authorization",
    );
    expect(bridge.isImplementationArmed("parent")).toBe(false);
    expect(bridge.getActivePlan("parent")).toBe(PLAN_PATH);
    await expect(bridge.handleImplementationArm("parent", {
      source: "command",
      action: "approve",
      planPath: PLAN_PATH,
      approved: true,
    })).resolves.toMatchObject({ armed: true });
  });

  it("arms implementation after an explicit approval once the gate is clear", async () => {
    const { bridge } = createLockHarness(true);
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    const review1 = await runReviewerStep(bridge, started.reviewerPrompt as string, [], "review-1");
    const review2 = await runReviewerStep(bridge, nextPromptOf(review1.response), [], "review-2");
    void review2;

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

  it("does not arm a cleared gate after the reviewed plan digest changes", async () => {
    const { bridge, files } = createLockHarness(true);
    const started = await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    const review1 = await runReviewerStep(bridge, started.reviewerPrompt as string, [], "review-1");
    const review2 = await runReviewerStep(bridge, nextPromptOf(review1.response), [], "review-2");
    void review2;

    files.set(PLAN_PATH, `${PLAN_CONTENT}\nChanged after review\n`);
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
    const { bridge } = createLockHarness(false);
    await bridge.handleReviewGateStart("parent", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
    expect(bridge.hasAnyReviewGateLock()).toBe(true);
    expect(bridge.getReviewGateLock("other-parent")).toBeUndefined();
    await bridge.destroySession("parent");
    expect(bridge.getReviewGateLock("parent")).toBeUndefined();
    expect(bridge.hasAnyReviewGateLock()).toBe(false);
  });
});
