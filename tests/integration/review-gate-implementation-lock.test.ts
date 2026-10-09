import { describe, expect, it } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type { FileReader, HookEvent } from "../../src/core/types";
import { createMockFileSystem } from "../helpers/mock-file-system";
import {
  createTestReviewGateServices,
  parsePacketPayload,
} from "../helpers/review-gate-coordinator";
import { createReviewGateApprovalLookup } from "../../src/runtime/review-gate-approval";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import type { PlanBridge } from "../../src/hooks/plan-bridge";
import type { PreToolUseEvent } from "../../src/core/types";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const FILES = new Map<string, string>([
  [DESIGN_PATH, "# Design\nReviewed behavior\n"],
  [PLAN_PATH, "## Task 1: Setup\n- [ ] Do the work\n"],
]);

function fileReader(): FileReader {
  return {
    readFile: async (path) => {
      const content = FILES.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    fileExists: async (path) => FILES.has(path),
    listFiles: async () => [...FILES.keys()],
    readFileStats: async () => null,
  } as unknown as FileReader;
}

/**
 * JusticePlugin-driven Review Gate lock integration: the plugin creates the
 * PlanBridge in initialize(); the test replaces the graph coordinator with an
 * in-memory instance and drives the event-sourced protocol end to end.
 */
async function createLockedJustice(): Promise<{
  readonly justice: JusticePlugin;
  readonly fs: ReturnType<typeof createMockFileSystem>;
  readonly services: ReturnType<typeof createTestReviewGateServices>;
}> {
  const { services } = await createSharedServices();
  const fs = createMockFileSystem(Object.fromEntries(FILES));
  const justice = new JusticePlugin(fileReader(), fs, {
    writerId: "writer-it-lock",
  });
  await justice.initialize();
  justice
    .getPlanBridge()
    .setReviewGateCoordinator(services.coordinator);
  return { justice, fs, services };
}

/**
 * Task 14 harness: coordinator and durable approval lookup over the SAME
 * in-memory event store (one shared service graph, like the adapter).
 */
async function createSharedServices() {
  const services = createTestReviewGateServices({
    files: FILES,
    mutationSubstrate: {
      commitArtifact: async () => ({ commitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }),
      restoreArtifact: async () => {},
    },
  });
  return { services };
}

async function startGate(justice: JusticePlugin, sessionId: string): Promise<string> {
  const started = await justice
    .getPlanBridge()
    .handleReviewGateStart(sessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
  if (started.reviewerPrompt === undefined) throw new Error(started.guidance);
  return started.reviewerPrompt;
}

function claimEvent(sessionId: string, callId: string, prompt: string): HookEvent {
  return {
    type: "PreToolUse",
    sessionId,
    callId,
    payload: { toolName: "task", callId, toolInput: { prompt } },
  };
}

async function claimAndSubmit(
  justice: JusticePlugin,
  callId: string,
  workerPrompt: string,
  buildResult: (payload: Record<string, unknown>) => unknown,
): Promise<unknown> {
  const parent = "main";
  await justice.handleEvent(claimEvent(parent, callId, workerPrompt));
  const payload = parsePacketPayload(workerPrompt);
  return justice.handleEvent({
    type: "PostToolUse",
    sessionId: `${callId}-worker`,
    callId,
    payload: {
      toolName: "task",
      callId,
      toolResult: JSON.stringify(buildResult(payload)),
      error: false,
    },
  } as HookEvent);
}

describe("Review Gate implementation lock integration", () => {
  it("cancels implementation tasks after a clear result while allowing skill loading and reads", async () => {
    const { justice } = await createLockedJustice();
    const reviewerPrompt = await startGate(justice, "main");
    const framing = await claimAndSubmit(justice, "review-1", reviewerPrompt, () => ({
      schemaVersion: 1,
      candidates: [],
    }));
    expect(framing).toMatchObject({ action: "inject" });

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
      payload: { toolName: "skill", toolInput: { name: "executing-plans" } },
    });
    const readResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "read-call",
      payload: { toolName: "read", toolInput: { filePath: PLAN_PATH } },
    });

    expect(taskResponse).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
    });
    expect(skillResponse).toEqual({ action: "proceed" });
    expect(readResponse).toEqual({ action: "proceed" });
  });

  it("keeps ordinary implementation locked in descendant of the gated session before any worker returns", async () => {
    const { justice } = await createLockedJustice();
    await startGate(justice, "main");
    const descendantResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "descendant-agent",
      lockOwnerSessionId: "main",
      callId: "descendant-task-call",
      payload: {
        toolName: "task",
        callId: "descendant-task-call",
        toolInput: { prompt: "implement the plan" },
      },
    });
    expect(descendantResponse).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
    });
  });

  it("rejects a forged completion whose worker call was never claimed", async () => {
    const { justice } = await createLockedJustice();
    await startGate(justice, "main");
    const bogus = await justice.handleEvent({
      type: "PostToolUse",
      sessionId: "unrelated-worker",
      callId: "call-never-claimed",
      payload: {
        toolName: "task",
        callId: "call-never-claimed",
        toolResult: JSON.stringify({ schemaVersion: 1, complete: true, findings: [] }),
        error: false,
      },
    });
    expect(bogus).toMatchObject({ action: "proceed" });
    expect(justice.getPlanBridge().hasPendingPlanReviewGate("main")).toBe(true);
  });
});

describe("Review Gate implementation lock integration — durable approval (Task 14)", () => {
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
    const args = (response.modifiedPayload as { args?: Record<string, unknown> } | undefined)
      ?.args;
    if (args === undefined) throw new Error("claim carried no modified task args");
    return { input, args };
  }

  async function submitAndCapture(
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

  function nextPromptOf(response: HookResponse): string | null {
    if (response.action !== "inject") return null;
    const args = (response.modifiedPayload as { args?: Record<string, unknown> } | undefined)
      ?.args;
    const prompt = args?.prompt;
    return typeof prompt === "string" ? prompt : null;
  }

  async function runReviewerStep(
    bridge: PlanBridge,
    workerPrompt: string,
    callId: string,
  ): Promise<{ readonly nextPrompt: string | null; readonly response: HookResponse }> {
    const step = await claimWorker(bridge, callId, workerPrompt);
    const payload = parsePacketPayload(step.args.prompt as string);
    const result = JSON.stringify({
      schemaVersion: 1,
      operationId: payload.operationId,
      gateId: payload.gateId,
      phase: payload.phase,
      reviewAttemptId: payload.reviewAttemptId,
      remediationRound: null,
      candidates: [],
    });
    const response = await submitAndCapture(bridge, step.input, result);
    return { nextPrompt: nextPromptOf(response), response };
  }

  function createRestartedBridge(
    fs: ReturnType<typeof createMockFileSystem>,
    services: ReturnType<typeof createTestReviewGateServices>,
  ): PlanBridge {
    // The restarted process reads and writes through the SAME mock file system
    // so the durable AuthorizationStore lock/claim dance is observable.
    const restart = new JusticePlugin(fs, fs, {
      writerId: "writer-it-restart",
    });
    const bridge = restart.getPlanBridge();
    bridge.setReviewGateApprovalLookup(
      createReviewGateApprovalLookup({
        eventStore: services.eventStore,
        workspaceReader: {
          readWorkspaceFile: async (path: string) =>
            FILES.has(path) ? Buffer.from(FILES.get(path) as string, "utf8") : null,
        },
        protocol: createReviewGateProtocolDescriptor(),
      }),
    );
    return bridge;
  }

  it("binds /justice-implement --approved to the durable completed approval across a restart", async () => {
    const { services, justice, fs } = await createLockedJustice();
    const bridge = justice.getPlanBridge();

    const started = await bridge.handleReviewGateStart("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const review1 = await runReviewerStep(bridge, started.reviewerPrompt as string, "review-1");
    expect(review1.nextPrompt).not.toBeNull();
    const review2 = await runReviewerStep(bridge, review1.nextPrompt as string, "review-2");
    if (review2.response.action !== "inject") throw new Error("expected inject response");
    expect(review2.response.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

    // Simulated restart: no in-memory lock/arms; ONLY the durable lookup.
    const restartedBridge = createRestartedBridge(fs, services);
    const arm = await restartedBridge.handleImplementationArm("main", {
      source: "command",
      planPath: PLAN_PATH,
      approved: true,
    });
    expect(arm.armed).toBe(true);
  });

  it("fails closed after a restart when the plan drifts from the durable completed approval", async () => {
    const { services, justice, fs } = await createLockedJustice();
    const bridge = justice.getPlanBridge();

    const started = await bridge.handleReviewGateStart("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const review1 = await runReviewerStep(bridge, started.reviewerPrompt as string, "review-1");
    const review2 = await runReviewerStep(bridge, review1.nextPrompt as string, "review-2");
    if (review2.response.action !== "inject") throw new Error("expected inject response");
    expect(review2.response.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

    const completedGateIds = [...services.eventStore.gates().keys()];
    const ledgerBytesBefore = JSON.stringify(
      await Promise.all(
        completedGateIds.map(async (gateId) => ({
          gateId,
          events: await services.eventStore.readEvents(gateId),
        })),
      ),
    );

    // The workspace plan changes after completion: the stale completed Gate is
    // never mutated; the restarted arm is refused.
    const originalPlan = FILES.get(PLAN_PATH);
    try {
      FILES.set(PLAN_PATH, "## Task 1: Setup\n- [ ] drifted work\n");

      const restartedBridge = createRestartedBridge(fs, services);
      const arm = await restartedBridge.handleImplementationArm("main", {
        source: "command",
        planPath: PLAN_PATH,
        approved: true,
      });
      expect(arm.armed).toBe(false);

      const ledgerBytesAfter = JSON.stringify(
        await Promise.all(
          completedGateIds.map(async (gateId) => ({
            gateId,
            events: await services.eventStore.readEvents(gateId),
          })),
        ),
      );
      expect(ledgerBytesAfter).toBe(ledgerBytesBefore);
    } finally {
      if (originalPlan !== undefined) FILES.set(PLAN_PATH, originalPlan);
    }
  });
});
