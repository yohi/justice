import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { AuthorizationStore } from "../../src/core/plan-authorization";
import { buildCanonicalSnapshot, computePlanFingerprint } from "../../src/core/plan-fingerprint";
import type {
  MessageEvent,
  DelegatedExecutionRelationObservedEvent,
  PostToolUseEvent,
  PreToolUseEvent,
  ReviewCorrelation,
  ReviewRequiredDirective,
} from "../../src/core/types";
import type { ObservationMessagePayload } from "../../src/core/v2/message-payload";
import {
  createMockFileReader,
  createMockFileSystem,
  createMockFileWriter,
  type MockFileSystem,
} from "../helpers/mock-file-system";

function createPlugin(): JusticePlugin {
  return new JusticePlugin(createMockFileReader({}), createMockFileWriter());
}

describe("JusticePlugin routing guard", () => {
  it("routes a non-task PreToolUse to the observation handler only", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();

    const obsSpy = vi.spyOn(observation, "handlePreToolUse");
    const planSpy = vi.spyOn(planBridge, "handlePreToolUse");

    const response = await plugin.handleEvent({
      type: "PreToolUse",
      payload: { toolName: "bash", toolInput: {} },
      sessionId: "s-1",
    } as PreToolUseEvent);

    expect(obsSpy).toHaveBeenCalledTimes(1);
    expect(planSpy).not.toHaveBeenCalled();
    expect(response).toEqual({ action: "proceed" });
  });

  it("routes a non-task PostToolUse to the observation handler only", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();
    const taskFeedback = plugin.getTaskFeedback();

    const obsSpy = vi.spyOn(observation, "handlePostToolUse");
    const planSpy = vi.spyOn(planBridge, "handlePostToolUse");
    const feedbackSpy = vi.spyOn(taskFeedback, "handlePostToolUse");

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "bash", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    expect(obsSpy).toHaveBeenCalledTimes(1);
    expect(planSpy).not.toHaveBeenCalled();
    expect(feedbackSpy).not.toHaveBeenCalled();
    expect(response).toEqual({ action: "proceed" });
  });

  it("invokes both observation handler and plan-bridge for a task PreToolUse", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();

    const obsSpy = vi.spyOn(observation, "handlePreToolUse");
    const planSpy = vi
      .spyOn(planBridge, "handlePreToolUse")
      .mockResolvedValue({ action: "inject", injectedContext: "plan pre" });

    const response = await plugin.handleEvent({
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: {} },
      sessionId: "s-1",
    } as PreToolUseEvent);

    expect(obsSpy).toHaveBeenCalledTimes(1);
    expect(planSpy).toHaveBeenCalledTimes(1);
    // observation stub PROCEEDs, so the merged result equals the plan-bridge inject.
    expect(response).toEqual({ action: "inject", injectedContext: "plan pre" });
  });

  it("keeps a mandatory review task out of the implementation PlanBridge route", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();
    const observationSpy = vi.spyOn(observation, "handlePreToolUse");
    const planSpy = vi.spyOn(planBridge, "handlePreToolUse");

    await plugin.handleEvent({
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: { category: "sp-review" } },
      sessionId: "s-1",
      callId: "review-call",
    } as PreToolUseEvent);

    expect(observationSpy).not.toHaveBeenCalled();
    expect(planSpy).not.toHaveBeenCalled();
  });

  it("invokes observation handler, plan-bridge and task-feedback for a task PostToolUse", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();
    const taskFeedback = plugin.getTaskFeedback();

    const obsSpy = vi.spyOn(observation, "handlePostToolUse");
    const planSpy = vi
      .spyOn(planBridge, "handlePostToolUse")
      .mockResolvedValue({ action: "inject", injectedContext: "plan post" });
    const feedbackSpy = vi
      .spyOn(taskFeedback, "handlePostToolUse")
      .mockResolvedValue({ action: "inject", injectedContext: "feedback post" });

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    expect(obsSpy).toHaveBeenCalledTimes(1);
    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(feedbackSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "plan post\n\n---\n\nfeedback post",
      }),
    );
  });

  it("runs task PostToolUse handlers in transactional order", async () => {
    const plugin = createPlugin();
    const order: string[] = [];
    let releaseObservation: (() => void) | undefined;
    let releasePlanBridge: (() => void) | undefined;
    let markObservationStarted: (() => void) | undefined;
    let markPlanBridgeStarted: (() => void) | undefined;
    let markTaskFeedbackStarted: (() => void) | undefined;
    const observationDone = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    const planBridgeDone = new Promise<void>((resolve) => {
      releasePlanBridge = resolve;
    });
    const observationStarted = new Promise<void>((resolve) => {
      markObservationStarted = resolve;
    });
    const planBridgeStarted = new Promise<void>((resolve) => {
      markPlanBridgeStarted = resolve;
    });
    const taskFeedbackStarted = new Promise<void>((resolve) => {
      markTaskFeedbackStarted = resolve;
    });
    vi.spyOn(plugin.getObservationHandler(), "handlePostToolUse").mockImplementation(async () => {
      order.push("observation");
      markObservationStarted?.();
      await observationDone;
      return { action: "proceed" };
    });
    vi.spyOn(plugin.getPlanBridge(), "handlePostToolUse").mockImplementation(async () => {
      order.push("planBridge");
      markPlanBridgeStarted?.();
      await planBridgeDone;
      return { action: "proceed" };
    });
    vi.spyOn(plugin.getTaskFeedback(), "handlePostToolUse").mockImplementation(async () => {
      order.push("taskFeedback");
      markTaskFeedbackStarted?.();
      return { action: "proceed" };
    });

    const handling = plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    await observationStarted;
    expect(order).toEqual(["observation"]);
    releaseObservation?.();
    await planBridgeStarted;
    expect(order).toEqual(["observation", "planBridge"]);
    releasePlanBridge?.();
    await taskFeedbackStarted;
    await handling;
    expect(order).toEqual(["observation", "planBridge", "taskFeedback"]);
  });

  it("keeps the task window open until every PostToolUse handler settles", async () => {
    const plugin = createPlugin();
    await plugin.handleEvent({
      type: "AgentMapped",
      sessionId: "s-1",
      payload: { sessionId: "s-1", agentName: "hephaestus" },
    });
    let releaseObservation: (() => void) | undefined;
    const observationDone = new Promise<void>((resolve) => {
      releaseObservation = resolve;
    });
    let observedTaskId: string | undefined;

    vi.spyOn(plugin.getObservationHandler(), "handlePostToolUse").mockImplementation(async () => {
      await observationDone;
      observedTaskId = plugin.getSessionStateProvider().getActiveTaskId("call-1");
      return { action: "proceed" };
    });
    vi.spyOn(plugin.getPlanBridge(), "handlePostToolUse").mockRejectedValue(
      new Error("plan failure"),
    );

    await plugin.handleEvent({
      type: "PreToolUse",
      sessionId: "s-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { taskId: "task-1" } },
    });
    const result = plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "s-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-1" },
        toolResult: "ok",
        error: false,
      },
    });

    releaseObservation?.();

    await expect(result).resolves.toEqual({ action: "proceed" });
    expect(observedTaskId).toBe("task-1");
    expect(plugin.getSessionStateProvider().getActiveTaskId("call-1")).toBeUndefined();
  });

  it("continues task PostToolUse routing when task feedback rejects", async () => {
    const warn = vi.fn();
    const routedEvent: PostToolUseEvent = {
      type: "PostToolUse",
      sessionId: "s-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: {}, toolResult: "ok", error: false },
    };
    const configured = new JusticePlugin(createMockFileReader({}), createMockFileWriter(), {
      logger: { warn, error: vi.fn() },
    });
    const observationSpy = vi.spyOn(configured.getObservationHandler(), "handlePostToolUse");
    const planBridgeSpy = vi.spyOn(configured.getPlanBridge(), "handlePostToolUse");
    vi.spyOn(configured.getTaskFeedback(), "handlePostToolUse").mockRejectedValue(new Error("feedback failed"));

    const response = await configured.handleEvent(routedEvent);

    expect(observationSpy).toHaveBeenCalledOnce();
    expect(planBridgeSpy).toHaveBeenCalledOnce();
    expect(configured.getTaskFeedback().handlePostToolUse).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("task-feedback post-tool-use failed", expect.any(Error));
    expect(response).toEqual({ action: "proceed" });
  });

  it("routes a user Message to plan-bridge.handleMessage", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();

    const planSpy = vi.spyOn(planBridge, "handleMessage").mockResolvedValue({ action: "proceed" });
    const obsSpy = vi.spyOn(observation, "handleMessage");

    const response = await plugin.handleEvent({
      type: "Message",
      payload: { role: "user", content: "delegate next task from plan.md" },
      sessionId: "s-1",
    } as MessageEvent);

    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(obsSpy).not.toHaveBeenCalled();
    expect(response).toEqual({ action: "proceed" });
  });

  it("routes an observation Message payload to observation-handler.handleMessage", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();

    const obsSpy = vi.spyOn(observation, "handleMessage");
    const planSpy = vi.spyOn(planBridge, "handleMessage");

    const payload: ObservationMessagePayload = {
      kind: "text_complete",
      sessionId: "s-1",
      messageID: "m-1",
      partID: "p-1",
      text: "some assistant text",
    };

    const response = await plugin.handleEvent({
      type: "Message",
      payload,
      sessionId: "s-1",
    } as MessageEvent);

    expect(obsSpy).toHaveBeenCalledTimes(1);
    expect(obsSpy).toHaveBeenCalledWith("s-1", payload);
    expect(planSpy).not.toHaveBeenCalled();
    expect(response).toEqual({ action: "proceed" });
  });

  it("fails open to PROCEED when observation handleMessage rejects", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();

    vi.spyOn(observation, "handleMessage").mockRejectedValue(new Error("boom"));

    const payload: ObservationMessagePayload = {
      kind: "text_complete",
      sessionId: "s-1",
      messageID: "m-1",
      partID: "p-1",
      text: "text",
    };

    const response = await plugin.handleEvent({
      type: "Message",
      payload,
      sessionId: "s-1",
    } as MessageEvent);

    expect(response).toEqual({ action: "proceed" });
  });

  it("fails open to PROCEED when observation handlePreToolUse rejects", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();

    vi.spyOn(observation, "handlePreToolUse").mockRejectedValue(new Error("boom"));

    const response = await plugin.handleEvent({
      type: "PreToolUse",
      payload: { toolName: "bash", toolInput: {} },
      sessionId: "s-1",
    } as PreToolUseEvent);

    expect(response).toEqual({ action: "proceed" });
  });

  it("fails open to PROCEED when observation handlePostToolUse rejects", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();

    vi.spyOn(observation, "handlePostToolUse").mockRejectedValue(new Error("boom"));

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "bash", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    expect(response).toEqual({ action: "proceed" });
  });

  it("preserves task PreToolUse result when observation fails", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();

    vi.spyOn(observation, "handlePreToolUse").mockRejectedValue(new Error("boom"));
    const planSpy = vi
      .spyOn(planBridge, "handlePreToolUse")
      .mockResolvedValue({ action: "inject", injectedContext: "plan pre" });

    const response = await plugin.handleEvent({
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: {} },
      sessionId: "s-1",
    } as PreToolUseEvent);

    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ action: "inject", injectedContext: "plan pre" });
  });

  it("preserves task PostToolUse merged result when observation fails", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();
    const taskFeedback = plugin.getTaskFeedback();

    vi.spyOn(observation, "handlePostToolUse").mockRejectedValue(new Error("boom"));
    const planSpy = vi
      .spyOn(planBridge, "handlePostToolUse")
      .mockResolvedValue({ action: "inject", injectedContext: "plan post" });
    const feedbackSpy = vi
      .spyOn(taskFeedback, "handlePostToolUse")
      .mockResolvedValue({ action: "inject", injectedContext: "feedback post" });

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    expect(planSpy).toHaveBeenCalledTimes(1);
    expect(feedbackSpy).toHaveBeenCalledTimes(1);
    expect(response).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "plan post\n\n---\n\nfeedback post",
      }),
    );
  });
});


const progressPlan = ["## Task 1: Implement", "- [ ] first", "- [ ] second"].join("\n");
const PROGRESS_WRITER_ID = "w-routing";

function taskAttemptId(taskId: string): string {
  return taskId === "task-1" ? "attempt-1" : `attempt-${taskId}`;
}

function taskReviewCorrelation(authorizationId: string, taskId = "task-1"): ReviewCorrelation {
  return {
    reviewKind: "task-review",
    taskExecutionRef: { authorizationId, taskId, attemptId: taskAttemptId(taskId) },
    reviewRound: 1,
  };
}

function reviewPostToolUseEvent(callId = "review-call"): PostToolUseEvent {
  return {
    type: "PostToolUse",
    sessionId: "s-1",
    callId,
    payload: { toolName: "task", toolResult: "review complete", error: false },
  } as PostToolUseEvent;
}

type PluginInternals = {
  authorizationStore: AuthorizationStore;
  observationLogStore: {
    append: (
      shardId: { agentId: string; sessionId: string; writerId: string },
      record: Record<string, unknown>,
    ) => Promise<number>;
    readAll: () => Promise<readonly Record<string, unknown>[]>;
  };
  reviewCompletionDomain: {
    consumeReviewCompletion: (input: unknown) => Promise<{ kind: string }>;
  };
  reviewDirectiveSink: {
    deliver: (delivery: {
      readonly parentSessionId: string;
      readonly directive: ReviewRequiredDirective;
    }) => Promise<void>;
    drainForParentSession: (parentSessionId: string) => Promise<readonly unknown[]>;
  };
  reviewDispatchState: {
    offerNextMandatoryReview: (parentSessionId: string) => Promise<unknown>;
    validateQueuedReviewDirectiveWithinParentSessionClaim: (
      delivery: unknown,
    ) => Promise<"inject" | "discard" | "retain">;
  };
};

function internalsOf(plugin: JusticePlugin): PluginInternals {
  return plugin as unknown as PluginInternals;
}

async function approvePlanAuthorization(
  plugin: JusticePlugin,
  taskIds: readonly string[] = ["task-1"],
  planContent = progressPlan,
): Promise<string> {
  const binding = await internalsOf(plugin).authorizationStore.approve({
    sessionId: "s-1",
    planPath: "plan.md",
    planFingerprint: computePlanFingerprint(planContent, taskIds),
    canonicalSnapshot: {
      schema: "justice-plan-v1",
      documentDigest: "doc-digest",
      globalBodyDigest: "body-digest",
      tasks: taskIds.map((taskId) => ({
        taskId,
        title: `Implement ${taskId}`,
        canonicalBody: "- [ ] first\n- [ ] second",
        digest: `task-digest-${taskId}`,
      })),
    },
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (binding === null) throw new Error("test setup: authorization approval failed");
  return binding.authorizationId;
}

async function appendObservation(
  plugin: JusticePlugin,
  record: Record<string, unknown>,
): Promise<void> {
  const store = internalsOf(plugin).observationLogStore;
  await store.append(
    { agentId: "system", sessionId: "s-1", writerId: PROGRESS_WRITER_ID },
    {
      schemaVersion: 1,
      timestamp: "2026-09-05T00:00:00.000Z",
      agentId: "system",
      sessionId: "s-1",
      writerId: PROGRESS_WRITER_ID,
      ...record,
    },
  );
}

async function seedClaimedReviewDispatch(
  plugin: JusticePlugin,
  authorizationId: string,
  taskId = "task-1",
  callId = "review-call",
): Promise<void> {
  const correlation = taskReviewCorrelation(authorizationId, taskId);
  await appendObservation(plugin, {
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: "t-pending",
    parentSessionId: "s-1",
    correlation,
    expectedCategory: "sp-review",
    from: null,
    to: "pending",
  });
  await appendObservation(plugin, {
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: "t-claimed",
    parentSessionId: "s-1",
    correlation,
    expectedCategory: "sp-review",
    from: "pending",
    to: "claimed",
    callId,
    artifactReservation: {
      status: "usable",
      artifactId: "a-1",
      artifactPath: ".justice/reviews/a-1.md",
      leasePath: ".justice/reviews/a-1.md.lease",
      artifactIdentity: { device: "d", inode: "i" },
    },
  });
}

type SeedDecisionOptions = {
  /** `null` omits the field (historic roundless decision). */
  readonly reviewRound?: number | null;
  /** `null` seeds no Gate. Defaults to an agreeing PASS Gate. */
  readonly gateVerdict?: "PASS" | "WARN" | "FAIL" | null;
  readonly attemptId?: string;
};

async function seedAcceptedDecision(
  plugin: JusticePlugin,
  authorizationId: string,
  taskId = "task-1",
  options: SeedDecisionOptions = {},
): Promise<void> {
  const taskExecutionRef = {
    authorizationId,
    taskId,
    attemptId: options.attemptId ?? taskAttemptId(taskId),
  };
  const reviewRound = options.reviewRound === undefined ? 1 : options.reviewRound;
  const round = reviewRound === null ? {} : { reviewRound };
  const gateVerdict = options.gateVerdict === undefined ? "PASS" : options.gateVerdict;
  if (gateVerdict !== null)
    await appendObservation(plugin, {
      recordType: "decision",
      gateType: "task",
      taskId,
      taskExecutionRef,
      ...round,
      verdict: gateVerdict,
      reachableEnforcementLevel: "L1",
      appliedEnforcementLevel: "L0",
      ruleResults: [],
    });
  await appendObservation(plugin, {
    recordType: "decision",
    kind: "task-acceptance",
    taskId,
    taskExecutionRef,
    ...round,
    verdict: "accepted",
  });
}

async function seedAcceptedTaskLifecycle(
  plugin: JusticePlugin,
  authorizationId: string,
  taskId: string,
  finalState: "accepted" | "gate_pending" = "accepted",
): Promise<void> {
  const taskExecutionRef = { authorizationId, taskId, attemptId: taskAttemptId(taskId) };
  const transitions = (
    [
      ["pending", "authorized"],
      ["authorized", "in_progress"],
      ["in_progress", "worker_reported"],
      ["worker_reported", "evidence_pending"],
      ["evidence_pending", "review_pending"],
      ["review_pending", "gate_pending"],
      ["gate_pending", "accepted"],
    ] as const
  ).slice(0, finalState === "accepted" ? 7 : 6);
  for (const [from, to] of transitions) {
    await appendObservation(plugin, {
      recordType: "observation",
      kind: "task_lifecycle_transition",
      parentSessionId: "s-1",
      taskExecutionRef,
      from,
      to,
    });
  }
}

/**
 * S3-b: the durable remainder of a clean completed review for a claim seeded by
 * `seedClaimedReviewDispatch` — staging, `completed` terminal and a clean
 * `review_observed`. Plan Progress requires this history, not just the Decisions.
 */
async function seedCompletedReviewAfterClaim(
  plugin: JusticePlugin,
  authorizationId: string,
  taskId = "task-1",
  callId = "review-call",
  reviewRound = 1,
): Promise<void> {
  const correlation = { ...taskReviewCorrelation(authorizationId, taskId), reviewRound };
  const observedExecution = {
    schemaVersion: 1,
    provenance: "observed",
    reviewExecutionEventId: `event-${callId}`,
    parentSessionId: "s-1",
    callId,
    childSessionId: `child-${callId}`,
    correlation,
  };
  const reviewArtifact = {
    schemaVersion: 1,
    reviewKind: "task-review",
    reviewSource: "sp-review",
    correlation,
    observedExecution,
    complete: true,
    findings: [],
  };
  const artifactConsumption = { artifactId: "a-1", digest: `sha256:${"0".repeat(64)}` };
  await appendObservation(plugin, {
    recordType: "observation",
    kind: "review_completion_staged",
    parentSessionId: "s-1",
    staging: { callId, correlation, artifactConsumption, reviewArtifact, observedExecution },
  });
  await appendObservation(plugin, {
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: `t-terminal-${taskId}`,
    parentSessionId: "s-1",
    correlation,
    expectedCategory: "sp-review",
    from: "claimed",
    to: "terminal",
    callId,
    terminalReason: "completed",
    artifactConsumption,
    reviewArtifact,
  });
  await appendObservation(plugin, {
    recordType: "observation",
    kind: "review_observed",
    taskId,
    reviewScope: `task:${taskId}`,
    correlation,
    items: [],
    isCompleteSnapshot: true,
  });
}

/** S3-b: a mocked completion that leaves the durable records a real one would. */
function mockReviewCompletionThatRecords(
  plugin: JusticePlugin,
  record: (callId: string) => Promise<void>,
): void {
  vi.spyOn(
    internalsOf(plugin).reviewCompletionDomain,
    "consumeReviewCompletion",
  ).mockImplementation(async (input) => {
    await record((input as { readonly callId: string }).callId);
    return { kind: "terminalized" };
  });
}

function mockTerminalReviewCompletion(plugin: JusticePlugin): void {
  vi.spyOn(
    internalsOf(plugin).reviewCompletionDomain,
    "consumeReviewCompletion",
  ).mockResolvedValue({ kind: "terminalized" });
}

describe("JusticePlugin PostToolUse review directive delivery", () => {
  it("keeps a PostToolUse result when queued review validation rejects", async () => {
    const plugin = createPlugin();
    const drain = vi.spyOn(internalsOf(plugin).reviewDirectiveSink, "drainForParentSession")
      .mockRejectedValue(new Error("review directive validation unavailable"));

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "s-1",
      callId: "ordinary-call",
      payload: { toolName: "bash", toolResult: "ok", error: false },
    });

    expect(response).toEqual({ action: "proceed" });
    expect(drain).toHaveBeenCalledOnce();
  });

  it("merges a current pending review directive into the task completion response", async () => {
    const fs = createMockFileSystem();
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await approvePlanAuthorization(plugin);
    const correlation = taskReviewCorrelation(authorizationId);
    await appendObservation(plugin, {
      recordType: "observation",
      kind: "review_dispatch_transition",
      transitionId: "t-pending",
      parentSessionId: "s-1",
      correlation,
      expectedCategory: "sp-review",
      from: null,
      to: "pending",
    });
    await internalsOf(plugin).reviewDirectiveSink.deliver({
      parentSessionId: "s-1",
      directive: { kind: "review_required", correlation },
    });
    vi.spyOn(
      internalsOf(plugin).reviewDispatchState,
      "validateQueuedReviewDirectiveWithinParentSessionClaim",
    ).mockResolvedValue("inject");

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "s-1",
      callId: "implementation-call",
      payload: { toolName: "task", toolResult: "implemented", error: false },
    } as PostToolUseEvent);

    expect(response).toEqual({
      action: "inject",
      injectedContext: [
        "[JUSTICE: REVIEW REQUIRED]",
        "**Review kind**: task-review",
        "**Category**: sp-review",
        `**Authorization ID**: ${authorizationId}`,
        "**Task ID**: task-1",
        "**Attempt ID**: attempt-1",
        "**Review round**: 1",
      ].join("\n"),
      normalInjectedContext: [
        "[JUSTICE: REVIEW REQUIRED]",
        "**Review kind**: task-review",
        "**Category**: sp-review",
        `**Authorization ID**: ${authorizationId}`,
        "**Task ID**: task-1",
        "**Attempt ID**: attempt-1",
        "**Review round**: 1",
      ].join("\n"),
    });
  });
});

describe("JusticePlugin accepted-decision progress updates", () => {
  it("does not start Final Review until every canonical task is accepted", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin, ["task-1", "task-2"]);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    const records = await internalsOf(plugin).observationLogStore.readAll();
    expect(
      records.some(
        (record) =>
          record.recordType === "observation" && record.kind === "plan_finalization_transition",
      ),
    ).toBe(false);
  });

  it("starts Final Review and delivers its identity after every canonical task is accepted", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin, ["task-1", "task-2"]);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-2");
    mockTerminalReviewCompletion(plugin);

    const response = await plugin.handleEvent(reviewPostToolUseEvent());

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected Final Review directive");
    expect(response.injectedContext).toContain("**Review kind**: final-review");
    expect(response.injectedContext).toContain("**Category**: sp-final-review");
    expect(response.injectedContext).toContain(`**Authorization ID**: ${authorizationId}`);
    expect(response.injectedContext).toContain("**Plan fingerprint algorithm**: sha256");
    expect(response.injectedContext).toContain(
      `**Plan fingerprint**: ${computePlanFingerprint(progressPlan, ["task-1"]).value}`,
    );
    expect(response.injectedContext).toContain("**Finalization attempt ID**:");
    expect(response.injectedContext).toContain("**Final review round**: 1");
  });

  it("does not advance finalization from an accepted decision without an agreeing round-bearing Gate", async () => {
    const cases: readonly { readonly options: SeedDecisionOptions; readonly advances: boolean }[] = [
      { options: {}, advances: true },
      { options: { gateVerdict: "FAIL" }, advances: false },
      { options: { gateVerdict: null }, advances: false },
      { options: { reviewRound: null }, advances: false },
    ];
    for (const { options, advances } of cases) {
      const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
      const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
      plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
      const authorizationId = await approvePlanAuthorization(plugin);
      await seedClaimedReviewDispatch(plugin, authorizationId);
      await seedAcceptedDecision(plugin, authorizationId, "task-1", options);
      await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
      mockTerminalReviewCompletion(plugin);

      await plugin.handleEvent(reviewPostToolUseEvent());

      const records = await internalsOf(plugin).observationLogStore.readAll();
      expect({
        options,
        advanced: records.some(
          (record) =>
            record.recordType === "observation" && record.kind === "plan_finalization_transition",
        ),
      }).toEqual({ options, advanced: advances });
    }
  });

  it("does not start Final Review when the approved plan changes after task acceptance", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    mockTerminalReviewCompletion(plugin);
    await fs.writeFile("plan.md", progressPlan.replace("Implement", "Redesign"));

    const response = await plugin.handleEvent(reviewPostToolUseEvent());
    const records = await internalsOf(plugin).observationLogStore.readAll();
    const binding = await internalsOf(plugin).authorizationStore.findByAuthorizationId(authorizationId);

    expect(binding?.status).toBe("invalidated");
    expect(await fs.readFile("plan.md")).toBe(progressPlan.replace("Implement", "Redesign"));
    expect(
      records.some(
        (record) =>
          record.recordType === "observation" &&
          record.kind === "plan_finalization_transition" &&
          record.to === "final_review_pending",
      ),
    ).toBe(false);
    expect(response.action === "inject" && response.injectedContext).not.toContain("final-review");
  });

  it("does not start Final Review when the approved plan cannot be read", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    mockTerminalReviewCompletion(plugin);
    const readFile = fs.readFile;
    fs.readFile = async (path): Promise<string> => {
      if (path === "plan.md") throw new Error("plan read unavailable");
      return readFile(path);
    };

    await plugin.handleEvent(reviewPostToolUseEvent());
    const records = await internalsOf(plugin).observationLogStore.readAll();

    expect(
      records.some(
        (record) =>
          record.recordType === "observation" &&
          record.kind === "plan_finalization_transition" &&
          record.to === "final_review_pending",
      ),
    ).toBe(false);
  });

  it("does not append another finalization after a duplicate accepted-review PostToolUse", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());
    const firstRead = await internalsOf(plugin).observationLogStore.readAll();
    await plugin.handleEvent(reviewPostToolUseEvent());
    const secondRead = await internalsOf(plugin).observationLogStore.readAll();

    const countFinalizationTransitions = (records: readonly Record<string, unknown>[]): number =>
      records.filter(
        (record) =>
          record.recordType === "observation" && record.kind === "plan_finalization_transition",
      ).length;
    expect(countFinalizationTransitions(firstRead)).toBe(2);
    expect(countFinalizationTransitions(secondRead)).toBe(2);
  });

  it("serializes simultaneous final-task acceptances into one finalization", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    mockTerminalReviewCompletion(plugin);

    await Promise.all([
      plugin.handleEvent(reviewPostToolUseEvent()),
      plugin.handleEvent(reviewPostToolUseEvent()),
    ]);

    const records = await internalsOf(plugin).observationLogStore.readAll();
    const finalizationTransitions = records.filter(
      (record) =>
        record.recordType === "observation" && record.kind === "plan_finalization_transition",
    );
    expect(finalizationTransitions).toHaveLength(2);
  });

  it("keeps authorization release behind the finalization commit for the same parent", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    mockTerminalReviewCompletion(plugin);

    let entered: () => void = () => undefined;
    const atCommit = new Promise<void>((resolve) => { entered = resolve; });
    let proceed: () => void = () => undefined;
    const resume = new Promise<void>((resolve) => { proceed = resolve; });
    const handler = plugin.getObservationHandler();
    const originalAdvance = handler.advanceFinalizationAfterAllTasksAccepted.bind(handler);
    vi.spyOn(handler, "advanceFinalizationAfterAllTasksAccepted").mockImplementation(async (input, notify) => {
      entered();
      await resume;
      return originalAdvance(input, notify);
    });

    const completion = plugin.handleEvent(reviewPostToolUseEvent());
    await atCommit;
    let released = false;
    const release = internalsOf(plugin).authorizationStore
      .release(authorizationId, new Date().toISOString())
      .then(() => { released = true; });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    const releasedBeforeCommit = released;
    proceed();
    await Promise.all([completion, release]);

    expect(releasedBeforeCommit).toBe(false);
  });

  it("resumes an all-tasks-accepted finalization after restart with its original identity", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const binding = await internalsOf(first).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: new Date().toISOString(),
    });
    if (binding === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedTaskLifecycle(first, binding.authorizationId, "task-1");
    await first.getObservationHandler().appendPlanFinalizationTransition({
      parentSessionId: "s-1",
      authorizationId: binding.authorizationId,
      planPath: "plan.md",
      finalizationAttemptId: "finalization-before-restart",
      finalReviewRound: 1,
      from: "tasks_pending",
      to: "all_tasks_accepted",
    });

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await restarted.initialize();
    const records = await internalsOf(restarted).observationLogStore.readAll();
    const resumed = records.filter((record) =>
      record.kind === "plan_finalization_transition" && record.to === "final_review_pending"
    );
    const pending = records.filter((record) =>
      record.kind === "review_dispatch_transition" && record.to === "pending"
    );

    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.finalizationAttemptId).toBe("finalization-before-restart");
    expect(pending).toHaveLength(1);

    const again = new JusticePlugin(fs, fs, { writerId: "w-restarted-again" });
    await again.initialize();
    const afterReplay = await internalsOf(again).observationLogStore.readAll();
    expect(afterReplay.filter((record) =>
      record.kind === "plan_finalization_transition" && record.to === "final_review_pending"
    )).toHaveLength(1);
    expect(afterReplay.filter((record) =>
      record.kind === "review_dispatch_transition" && record.to === "pending"
    )).toHaveLength(1);
  });

  it("does not resume finalization when the authorization plan changed before recovery", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const binding = await internalsOf(plugin).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: new Date().toISOString(),
    });
    if (binding === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedTaskLifecycle(plugin, binding.authorizationId, "task-1");
    await plugin.getObservationHandler().appendPlanFinalizationTransition({
      parentSessionId: "s-1",
      authorizationId: binding.authorizationId,
      planPath: "plan.md",
      finalizationAttemptId: "stale-finalization",
      finalReviewRound: 1,
      from: "tasks_pending",
      to: "all_tasks_accepted",
    });
    await fs.writeFile("plan.md", `${progressPlan}\n- Additional requirement`);

    await (plugin as unknown as {
      recoverPendingFinalizations: (parentSessionId: string) => Promise<void>;
    }).recoverPendingFinalizations("s-1");

    const records = await internalsOf(plugin).observationLogStore.readAll();
    expect(records.some((record) =>
      record.kind === "plan_finalization_transition" && record.to === "final_review_pending"
    )).toBe(false);
    await expect(
      internalsOf(plugin).authorizationStore.findByAuthorizationId(binding.authorizationId),
    ).resolves.toMatchObject({ status: "invalidated" });
  });

  it("starts Final Review after restart when all canonical tasks were accepted before finalization began", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const binding = await internalsOf(first).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: new Date().toISOString(),
    });
    if (binding === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedTaskLifecycle(first, binding.authorizationId, "task-1");

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await restarted.initialize();

    const records = await internalsOf(restarted).observationLogStore.readAll();
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "plan_finalization_transition" &&
        record.to === "final_review_pending",
    )).toBe(true);
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "review_dispatch_transition" &&
        record.to === "pending" &&
        record.expectedCategory === "sp-final-review",
    )).toBe(true);
  });

  it("continues initialization when recovered finalization cannot offer its review", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const binding = await internalsOf(first).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: new Date().toISOString(),
    });
    if (binding === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedTaskLifecycle(first, binding.authorizationId, "task-1");

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    const offer = vi.spyOn(internalsOf(restarted).reviewDispatchState, "offerNextMandatoryReview")
      .mockRejectedValue(new Error("review offer unavailable"));
    await expect(restarted.initialize()).resolves.toBeUndefined();

    expect(offer).toHaveBeenCalledOnce();
    const records = await internalsOf(restarted).observationLogStore.readAll();
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "plan_finalization_transition" &&
        record.to === "final_review_pending",
    )).toBe(true);
  });

  it("updates accepted task progress when restoring an active authorization after restart", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorization = await internalsOf(first).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: "2026-09-05T00:00:00.000Z",
    });
    if (authorization === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedDecision(first, authorization.authorizationId);
    await seedAcceptedTaskLifecycle(first, authorization.authorizationId, "task-1");
    await seedClaimedReviewDispatch(first, authorization.authorizationId);
    await seedCompletedReviewAfterClaim(first, authorization.authorizationId);

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await restarted.initialize();

    expect(await fs.readFile("plan.md")).toContain("- [x] first");
  });

  it("restores progress only from a current round-bearing accepted decision that agrees with its Gate", async () => {
    const cases: readonly { readonly name: string; readonly options: SeedDecisionOptions; readonly ticked: boolean }[] = [
      { name: "current round 1 + PASS Gate", options: {}, ticked: true },
      { name: "historic roundless", options: { reviewRound: null }, ticked: false },
      { name: "Gate FAIL disagrees", options: { gateVerdict: "FAIL" }, ticked: false },
      { name: "no Gate", options: { gateVerdict: null }, ticked: false },
      { name: "other attempt", options: { attemptId: "attempt-old" }, ticked: false },
    ];
    for (const testCase of cases) {
      const fs = createMockFileSystem({ "plan.md": progressPlan });
      const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
      const authorization = await internalsOf(first).authorizationStore.approve({
        sessionId: "s-1",
        planPath: "plan.md",
        planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
        canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
        approvedAt: "2026-09-05T00:00:00.000Z",
      });
      if (authorization === null) throw new Error("test setup: authorization approval failed");
      await seedAcceptedDecision(first, authorization.authorizationId, "task-1", testCase.options);
      await seedAcceptedTaskLifecycle(first, authorization.authorizationId, "task-1");
      await seedClaimedReviewDispatch(first, authorization.authorizationId);
      await seedCompletedReviewAfterClaim(first, authorization.authorizationId);

      const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
      await restarted.initialize();

      expect({ name: testCase.name, plan: await fs.readFile("plan.md") }).toEqual({
        name: testCase.name,
        plan: expect.stringContaining(testCase.ticked ? "- [x] first" : "- [ ] first"),
      });
    }
  });

  it("does not invalidate another session's authorization while recovering accepted progress", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorization = await internalsOf(plugin).authorizationStore.approve({
      sessionId: "other-session",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: "2026-09-05T00:00:00.000Z",
    });
    if (authorization === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedDecision(plugin, authorization.authorizationId);
    await fs.writeFile("plan.md", `${progressPlan}\n- Additional requirement`);

    await (plugin as unknown as {
      recoverAcceptedTaskProgress: (parentSessionId: string) => Promise<void>;
    }).recoverAcceptedTaskProgress("s-1");

    await expect(
      internalsOf(plugin).authorizationStore.findByAuthorizationId(authorization.authorizationId),
    ).resolves.toMatchObject({ status: "active", sessionId: "other-session" });
    expect(await fs.readFile("plan.md")).toContain("- [ ] first");
  });

  it("keeps initialization fail-open when restoring accepted task progress cannot write", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorization = await internalsOf(first).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: "2026-09-05T00:00:00.000Z",
    });
    if (authorization === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedDecision(first, authorization.authorizationId);
    await seedAcceptedTaskLifecycle(first, authorization.authorizationId, "task-1");
    await seedClaimedReviewDispatch(first, authorization.authorizationId);
    await seedCompletedReviewAfterClaim(first, authorization.authorizationId);
    const writeFile = fs.writeFile;
    fs.writeFile = async (path, content): Promise<void> => {
      if (path === "plan.md") throw new Error("progress restore write unavailable");
      await writeFile(path, content);
    };

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await expect(restarted.initialize()).resolves.toBeUndefined();

    const records = await internalsOf(restarted).observationLogStore.readAll();
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "session_error" &&
        record.message === "plan_progress_update_failed",
    )).toBe(true);
    fs.writeFile = writeFile;
  });

  it("invalidates authorization before review when plan semantics changed", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await internalsOf(plugin).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: "2026-09-05T00:00:00.000Z",
    });
    if (authorizationId === null) throw new Error("test setup: authorization approval failed");
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    await fs.writeFile("plan.md", `${progressPlan}\n- Additional requirement`);

    const planIsCurrent = await (plugin as unknown as {
      isAuthorizationPlanCurrent: (correlation: ReviewCorrelation) => Promise<boolean>;
    }).isAuthorizationPlanCurrent(taskReviewCorrelation(authorizationId.authorizationId));

    expect(planIsCurrent).toBe(false);
    await expect(
      internalsOf(plugin).authorizationStore.findByAuthorizationId(authorizationId.authorizationId),
    ).resolves.toMatchObject({ status: "invalidated" });
  });

  it("checks canonical task acceptance after a delayed review child binding is recorded", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");

    await plugin.handleEvent({
      type: "DelegatedExecutionRelationObserved",
      sessionId: "s-1",
      payload: {
        kind: "delegated_execution_relation_observed",
        provenance: "observed",
        runtimeEventId: "delayed-review-child-binding",
        parentSessionId: "s-1",
        parentCallId: "review-call",
        childSessionId: "review-child",
        category: "sp-review",
      },
    } satisfies DelegatedExecutionRelationObservedEvent);

    const records = await internalsOf(plugin).observationLogStore.readAll();
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "plan_finalization_transition" &&
        record.to === "final_review_pending",
    )).toBe(true);
  });

  it("does not resume finalization from a released authorization after restart", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const binding = await internalsOf(first).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: new Date().toISOString(),
    });
    if (binding === null) throw new Error("test setup: authorization approval failed");
    await seedAcceptedTaskLifecycle(first, binding.authorizationId, "task-1");
    await first.getObservationHandler().appendPlanFinalizationTransition({
      parentSessionId: "s-1",
      authorizationId: binding.authorizationId,
      planPath: "plan.md",
      finalizationAttemptId: "released-finalization",
      finalReviewRound: 1,
      from: "tasks_pending",
      to: "all_tasks_accepted",
    });
    await internalsOf(first).authorizationStore.release(binding.authorizationId, new Date().toISOString());

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await restarted.initialize();
    const records = await internalsOf(restarted).observationLogStore.readAll();

    expect(records.some((record) =>
      record.kind === "plan_finalization_transition" && record.to === "final_review_pending"
    )).toBe(false);
  });

  it("does not update plan progress when there is no active plan", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    expect(fs.writtenFiles["plan.md"]).toBe(progressPlan);
  });

  it("does not update plan progress when the accepted task is absent from the active plan", async () => {
    const planWithoutAcceptedTask = "## Task 2: Other\n- [ ] untouched";
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": planWithoutAcceptedTask });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    expect(fs.writtenFiles["plan.md"]).toBe(planWithoutAcceptedTask);
  });

  it("does not rewrite plan progress when every step is already checked", async () => {
    const completedPlan = "## Task 1: Implement\n- [x] first\n- [x] second";
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": completedPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    expect(fs.writtenFiles["plan.md"]).toBe(completedPlan);
  });

  it("does not update plan progress until the acceptance decision is durably recorded", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    // No task-acceptance decision exists in the durable log yet.
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    expect(fs.writtenFiles["plan.md"]).toBe(progressPlan);
  });

  it("updates plan progress for a durable accepted decision on the active authorization", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    // S3-b: progress needs the durable review history and accepted Lifecycle too.
    mockReviewCompletionThatRecords(plugin, async () => {
      await seedCompletedReviewAfterClaim(plugin, authorizationId);
      await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    });

    const response = await plugin.handleEvent(reviewPostToolUseEvent());

    // The only task is now durably accepted, so the existing finalization path may
    // append its own final-review directive after the completion marker.
    expect(response).toMatchObject({
      action: "inject",
      injectedContext: expect.stringMatching(/^\[JUSTICE: REVIEW COMPLETION RECORDED\]/),
    });
    expect(fs.writtenFiles["plan.md"]).toContain("- [x] first");
    expect(fs.writtenFiles["plan.md"]).toContain("- [x] second");
  });

  it("does not update plan progress from an accepted decision that disagrees with its Gate", async () => {
    for (const options of [{ gateVerdict: "FAIL" }, { gateVerdict: null }] as const) {
      const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
      const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
      plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
      const authorizationId = await approvePlanAuthorization(plugin);
      await seedClaimedReviewDispatch(plugin, authorizationId);
      await seedAcceptedDecision(plugin, authorizationId, "task-1", options);
      mockTerminalReviewCompletion(plugin);

      await plugin.handleEvent(reviewPostToolUseEvent());

      expect(fs.writtenFiles["plan.md"]).toBe(progressPlan);
    }
  });

  it("continues finalization when an accepted task progress write fails", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    mockReviewCompletionThatRecords(plugin, () =>
      seedCompletedReviewAfterClaim(plugin, authorizationId),
    );
    const writeFile = fs.writeFile;
    let failProgressWrite = true;
    fs.writeFile = async (path, content): Promise<void> => {
      if (path === "plan.md" && failProgressWrite) {
        failProgressWrite = false;
        throw new Error("progress write unavailable");
      }
      await writeFile(path, content);
    };

    await plugin.handleEvent(reviewPostToolUseEvent());

    const records = await internalsOf(plugin).observationLogStore.readAll();
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "plan_finalization_transition" &&
        record.to === "final_review_pending",
    )).toBe(true);
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "session_error" &&
        record.message === "plan_progress_update_failed",
    )).toBe(true);
  });

  it("records an advisory when the all-tasks-accepted finalization cannot be committed", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    vi.spyOn(plugin.getObservationHandler(), "advanceFinalizationAfterAllTasksAccepted")
      .mockResolvedValue({ kind: "failed" });
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    const records = await internalsOf(plugin).observationLogStore.readAll();
    expect(records.some(
      (record) => record.recordType === "observation" &&
        record.kind === "session_error" &&
        record.message === "finalization_advance_failed",
    )).toBe(true);
  });

  it("preserves accepted-review completion when offering Final Review rejects", async () => {
    const fs = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    vi.spyOn(internalsOf(plugin).reviewDispatchState, "offerNextMandatoryReview")
      .mockRejectedValue(new Error("review offer unavailable"));
    mockTerminalReviewCompletion(plugin);

    const response = await plugin.handleEvent(reviewPostToolUseEvent());

    expect(response).toEqual({
      action: "inject",
      injectedContext: "[JUSTICE: REVIEW COMPLETION RECORDED]",
    });
    expect(internalsOf(plugin).reviewDispatchState.offerNextMandatoryReview).toHaveBeenCalledOnce();
  });

  it("preserves both plan progress updates when accepted task reviews complete concurrently", async () => {
    const plan = [
      "## Task 1: First",
      "- [ ] first",
      "",
      "## Task 2: Second",
      "- [ ] second",
    ].join("\n");
    const fs = createMockFileSystem({ "plan.md": plan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin, ["task-1", "task-2"], plan);
    for (const [taskId, callId] of [["task-1", "review-call-1"], ["task-2", "review-call-2"]]) {
      await seedClaimedReviewDispatch(plugin, authorizationId, taskId, callId);
      await seedAcceptedDecision(plugin, authorizationId, taskId);
      await seedAcceptedTaskLifecycle(plugin, authorizationId, taskId);
    }
    mockReviewCompletionThatRecords(plugin, (callId) =>
      seedCompletedReviewAfterClaim(
        plugin,
        authorizationId,
        callId === "review-call-1" ? "task-1" : "task-2",
        callId,
      ),
    );

    await Promise.all([
      plugin.handleEvent(reviewPostToolUseEvent("review-call-1")),
      plugin.handleEvent(reviewPostToolUseEvent("review-call-2")),
    ]);

    expect(fs.writtenFiles["plan.md"]).toContain("- [x] first");
    expect(fs.writtenFiles["plan.md"]).toContain("- [x] second");
  });

  it("does not update progress when the active plan differs from the authorization binding", async () => {
    const fs: MockFileSystem = createMockFileSystem({
      "plan.md": progressPlan,
      "other-plan.md": progressPlan,
    });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "other-plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    expect(fs.writtenFiles["other-plan.md"]).toBe(progressPlan);
  });

  it("does not update plan progress from an old terminal authorization decision", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const store = internalsOf(plugin).authorizationStore;
    const authorizationId = await approvePlanAuthorization(plugin);
    const released = await store.release(authorizationId, "2026-09-05T01:00:00.000Z");
    expect(released.kind).toBe("saved");
    await seedClaimedReviewDispatch(plugin, authorizationId);
    // Replayed accepted decision from the now-released authorization.
    await seedAcceptedDecision(plugin, authorizationId);
    mockTerminalReviewCompletion(plugin);

    await plugin.handleEvent(reviewPostToolUseEvent());

    expect(fs.writtenFiles["plan.md"]).toBe(progressPlan);
  });
});

describe("JusticePlugin accepted task progress requires the durable accepted Lifecycle (S3-b Task 5)", () => {
  const twoTaskPlan = [
    "## Task 1: Implement",
    "- [ ] first",
    "- [ ] second",
    "## Task 2: Verify",
    "- [ ] third",
  ].join("\n");
  const planWrites = (fs: MockFileSystem): { readonly count: () => number } => {
    const writeFile = fs.writeFile.bind(fs);
    let count = 0;
    fs.writeFile = async (path, content): Promise<void> => {
      if (path === "plan.md") count += 1;
      await writeFile(path, content);
    };
    return { count: () => count };
  };
  const recoverProgress = (plugin: JusticePlugin): Promise<void> =>
    (plugin as unknown as {
      recoverAcceptedTaskProgress: (parentSessionId: string) => Promise<void>;
    }).recoverAcceptedTaskProgress("s-1");
  const approveDurable = async (
    plugin: JusticePlugin,
    plan: string,
    taskIds: readonly string[],
  ): Promise<string> => {
    const authorization = await internalsOf(plugin).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(plan, taskIds),
      canonicalSnapshot: buildCanonicalSnapshot(plan, taskIds),
      approvedAt: "2026-09-05T00:00:00.000Z",
    });
    if (authorization === null) throw new Error("test setup: authorization approval failed");
    return authorization.authorizationId;
  };
  /** Decisions + complete review history for one task; the Lifecycle is chosen per test. */
  const seedDecidedTask = async (
    plugin: JusticePlugin,
    authorizationId: string,
    taskId: string,
    lifecycle: "accepted" | "gate_pending",
  ): Promise<void> => {
    await seedAcceptedTaskLifecycle(plugin, authorizationId, taskId, lifecycle);
    await seedClaimedReviewDispatch(plugin, authorizationId, taskId, `review-call-${taskId}`);
    await seedCompletedReviewAfterClaim(plugin, authorizationId, taskId, `review-call-${taskId}`);
    await seedAcceptedDecision(plugin, authorizationId, taskId);
  };

  it("accepted task progress: an accepted Decision with a gate_pending Lifecycle writes nothing on the live path", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1", "gate_pending");
    await seedClaimedReviewDispatch(plugin, authorizationId);
    mockReviewCompletionThatRecords(plugin, async () => {
      await seedCompletedReviewAfterClaim(plugin, authorizationId);
      await seedAcceptedDecision(plugin, authorizationId);
    });
    const writes = planWrites(fs);

    await plugin.handleEvent(reviewPostToolUseEvent());

    expect(await fs.readFile("plan.md")).toBe(progressPlan);
    expect(writes.count()).toBe(0);
  });

  it("accepted task progress: an accepted Decision with a gate_pending Lifecycle writes nothing on restart", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await approveDurable(first, progressPlan, ["task-1"]);
    await seedDecidedTask(first, authorizationId, "task-1", "gate_pending");
    const writes = planWrites(fs);

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await restarted.initialize();

    expect(await fs.readFile("plan.md")).toBe(progressPlan);
    expect(writes.count()).toBe(0);
  });

  it("accepted task progress: the durable accepted Lifecycle updates only the accepted task, once", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": twoTaskPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    plugin.getPlanBridge().setActivePlan("s-1", "plan.md");
    const authorizationId = await approvePlanAuthorization(plugin, ["task-1", "task-2"], twoTaskPlan);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1", "gate_pending");
    await seedClaimedReviewDispatch(plugin, authorizationId);
    mockReviewCompletionThatRecords(plugin, async () => {
      await seedCompletedReviewAfterClaim(plugin, authorizationId);
      await seedAcceptedDecision(plugin, authorizationId);
      await appendObservation(plugin, {
        recordType: "observation",
        kind: "task_lifecycle_transition",
        parentSessionId: "s-1",
        taskExecutionRef: { authorizationId, taskId: "task-1", attemptId: "attempt-1" },
        from: "gate_pending",
        to: "accepted",
      });
    });
    const writes = planWrites(fs);

    await plugin.handleEvent(reviewPostToolUseEvent());
    await recoverProgress(plugin);
    await recoverProgress(plugin);

    const plan = await fs.readFile("plan.md");
    expect(plan).toContain("- [x] first");
    expect(plan).toContain("- [x] second");
    expect(plan).toContain("- [ ] third");
    expect(writes.count()).toBe(1);
  });

  it("accepted task progress: restart restores a proven task once and repeats as a no-op", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await approveDurable(first, progressPlan, ["task-1"]);
    await seedDecidedTask(first, authorizationId, "task-1", "accepted");
    const writes = planWrites(fs);

    await new JusticePlugin(fs, fs, { writerId: "w-restarted-1" }).initialize();
    await new JusticePlugin(fs, fs, { writerId: "w-restarted-2" }).initialize();

    expect(await fs.readFile("plan.md")).toContain("- [x] first");
    expect(writes.count()).toBe(1);
  });

  it("accepted task progress: a failed write keeps the Lifecycle, records an advisory and is reflected by the next recovery", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await approveDurable(first, progressPlan, ["task-1"]);
    await seedDecidedTask(first, authorizationId, "task-1", "accepted");
    const writeFile = fs.writeFile.bind(fs);
    let fail = true;
    fs.writeFile = async (path, content): Promise<void> => {
      if (path === "plan.md" && fail) {
        fail = false;
        throw new Error("progress write unavailable");
      }
      await writeFile(path, content);
    };

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await restarted.initialize();

    expect(await fs.readFile("plan.md")).toBe(progressPlan);
    const records = await internalsOf(restarted).observationLogStore.readAll();
    expect(JSON.stringify(records)).toContain("plan_progress_update_failed");
    expect(
      records.filter(
        (record) => record.kind === "task_lifecycle_transition" && record.to === "accepted",
      ),
    ).toHaveLength(1);

    await recoverProgress(restarted);

    expect(await fs.readFile("plan.md")).toContain("- [x] first");
  });

  it("accepted task progress: revoked authority, a changed plan, another round or a missing staging write nothing", async () => {
    const cases: readonly {
      readonly name: string;
      readonly arrange: (plugin: JusticePlugin, fs: MockFileSystem, authorizationId: string) => Promise<void>;
    }[] = [
      {
        name: "released authorization",
        arrange: async (plugin, _fs, authorizationId) => {
          await seedDecidedTask(plugin, authorizationId, "task-1", "accepted");
          const released = await internalsOf(plugin).authorizationStore.release(
            authorizationId,
            "2026-09-05T01:00:00.000Z",
          );
          expect(released.kind).toBe("saved");
        },
      },
      {
        name: "plan fingerprint changed",
        arrange: async (plugin, fs, authorizationId) => {
          await seedDecidedTask(plugin, authorizationId, "task-1", "accepted");
          await fs.writeFile("plan.md", `${progressPlan}\n- Additional requirement`);
        },
      },
      {
        name: "decisions for another round than the reviewed one",
        arrange: async (plugin, _fs, authorizationId) => {
          await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
          await seedClaimedReviewDispatch(plugin, authorizationId);
          await seedCompletedReviewAfterClaim(plugin, authorizationId);
          await seedAcceptedDecision(plugin, authorizationId, "task-1", { reviewRound: 2 });
        },
      },
      {
        name: "terminal and decisions without a staging",
        arrange: async (plugin, _fs, authorizationId) => {
          await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
          await seedClaimedReviewDispatch(plugin, authorizationId);
          const correlation = taskReviewCorrelation(authorizationId);
          await appendObservation(plugin, {
            recordType: "observation",
            kind: "review_dispatch_transition",
            transitionId: "t-terminal",
            parentSessionId: "s-1",
            correlation,
            expectedCategory: "sp-review",
            from: "claimed",
            to: "terminal",
            callId: "review-call",
            terminalReason: "completed",
          });
          await appendObservation(plugin, {
            recordType: "observation",
            kind: "review_observed",
            taskId: "task-1",
            reviewScope: "task:task-1",
            correlation,
            items: [],
            isCompleteSnapshot: true,
          });
          await seedAcceptedDecision(plugin, authorizationId);
        },
      },
    ];
    for (const testCase of cases) {
      const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
      const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
      const authorizationId = await approveDurable(first, progressPlan, ["task-1"]);
      await testCase.arrange(first, fs, authorizationId);
      const before = await fs.readFile("plan.md");
      const writes = planWrites(fs);

      const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
      await restarted.initialize();
      await recoverProgress(restarted);

      expect({ name: testCase.name, plan: await fs.readFile("plan.md") }).toEqual({
        name: testCase.name,
        plan: before,
      });
      expect({ name: testCase.name, writes: writes.count() }).toEqual({
        name: testCase.name,
        writes: 0,
      });
    }
  });

  it("accepted task progress: Finalization does not advance while one accepted Decision has no accepted Lifecycle", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": twoTaskPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await approveDurable(first, twoTaskPlan, ["task-1", "task-2"]);
    await seedDecidedTask(first, authorizationId, "task-1", "accepted");
    await seedDecidedTask(first, authorizationId, "task-2", "gate_pending");

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted" });
    await restarted.initialize();

    const plan = await fs.readFile("plan.md");
    expect(plan).toContain("- [x] first");
    expect(plan).toContain("- [ ] third");
    const records = await internalsOf(restarted).observationLogStore.readAll();
    expect(records.filter((record) => record.kind === "plan_finalization_transition")).toEqual([]);
  });
});

describe("JusticePlugin S3-b restart acceptance (initialize order)", () => {
  it("does not write plan progress when a decision conflicts after candidate enumeration", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const plugin = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorizationId = await approvePlanAuthorization(plugin);
    await seedAcceptedTaskLifecycle(plugin, authorizationId, "task-1");
    await seedClaimedReviewDispatch(plugin, authorizationId);
    await seedCompletedReviewAfterClaim(plugin, authorizationId);
    await seedAcceptedDecision(plugin, authorizationId);

    const store = internalsOf(plugin).observationLogStore;
    const readAll = store.readAll.bind(store);
    let injectConflictingGate = true;
    store.readAll = async (): Promise<readonly Record<string, unknown>[]> => {
      const snapshot = await readAll();
      if (injectConflictingGate) {
        injectConflictingGate = false;
        await appendObservation(plugin, {
          recordType: "decision",
          gateType: "task",
          taskId: "task-1",
          taskExecutionRef: {
            authorizationId,
            taskId: "task-1",
            attemptId: taskAttemptId("task-1"),
          },
          reviewRound: 1,
          verdict: "FAIL",
          reachableEnforcementLevel: "L1",
          appliedEnforcementLevel: "L0",
          ruleResults: [],
        });
      }
      return snapshot;
    };

    await (plugin as unknown as {
      recoverAcceptedTaskProgress: (parentSessionId: string) => Promise<void>;
    }).recoverAcceptedTaskProgress("s-1");

    expect(await fs.readFile("plan.md")).toBe(progressPlan);
  });

  it("S3-b: initialize() recovers the Lifecycle from the staged review, then ticks progress, then advances finalization — idempotently", async () => {
    const fs: MockFileSystem = createMockFileSystem({ "plan.md": progressPlan });
    const first = new JusticePlugin(fs, fs, { writerId: PROGRESS_WRITER_ID });
    const authorization = await internalsOf(first).authorizationStore.approve({
      sessionId: "s-1",
      planPath: "plan.md",
      planFingerprint: computePlanFingerprint(progressPlan, ["task-1"]),
      canonicalSnapshot: buildCanonicalSnapshot(progressPlan, ["task-1"]),
      approvedAt: "2026-09-05T00:00:00.000Z",
    });
    if (authorization === null) throw new Error("test setup: authorization approval failed");
    const authorizationId = authorization.authorizationId;
    const correlation = taskReviewCorrelation(authorizationId);
    // Durable state after "Gate + Acceptance persisted, Lifecycle append failed, process died".
    await seedAcceptedTaskLifecycle(first, authorizationId, "task-1", "gate_pending");
    await seedClaimedReviewDispatch(first, authorizationId);
    await appendObservation(first, {
      recordType: "observation",
      kind: "delegated_execution_binding",
      relation: {
        kind: "delegated_execution_relation_observed",
        provenance: "observed",
        runtimeEventId: "event-review-call",
        parentSessionId: "s-1",
        parentCallId: "review-call",
        childSessionId: "child-review-call",
        category: "sp-review",
      },
      binding: {
        relationId: "event-review-call",
        parentSessionId: "s-1",
        parentCallId: "review-call",
        childSessionId: "child-review-call",
        scope: {
          kind: "task",
          taskExecutionRef: { authorizationId, taskId: "task-1", attemptId: "attempt-1" },
          reviewRound: 1,
        },
        correlation,
      },
    });
    await seedCompletedReviewAfterClaim(first, authorizationId);
    await seedAcceptedDecision(first, authorizationId);
    let planWrites = 0;
    const writeFile = fs.writeFile.bind(fs);
    fs.writeFile = async (path, content): Promise<void> => {
      if (path === "plan.md") planWrites += 1;
      await writeFile(path, content);
    };
    const summarize = async (plugin: JusticePlugin): Promise<Record<string, number>> => {
      const records = await internalsOf(plugin).observationLogStore.readAll();
      const count = (predicate: (record: Record<string, unknown>) => boolean): number =>
        records.filter(predicate).length;
      return {
        accepted: count(
          (record) => record.kind === "task_lifecycle_transition" && record.to === "accepted",
        ),
        decisions: count((record) => record.recordType === "decision"),
        terminals: count(
          (record) => record.kind === "review_dispatch_transition" && record.to === "terminal",
        ),
        finalReviewPending: count(
          (record) =>
            record.kind === "plan_finalization_transition" && record.to === "final_review_pending",
        ),
      };
    };

    const restarted = new JusticePlugin(fs, fs, { writerId: "w-restarted-1" });
    await restarted.initialize();

    expect(await summarize(restarted)).toEqual({
      accepted: 1,
      decisions: 2,
      terminals: 1,
      finalReviewPending: 1,
    });
    const plan = await fs.readFile("plan.md");
    expect(plan).toContain("- [x] first");
    expect(plan).toContain("- [x] second");
    expect(planWrites).toBe(1);

    const again = new JusticePlugin(fs, fs, { writerId: "w-restarted-2" });
    await again.initialize();

    expect(await summarize(again)).toEqual({
      accepted: 1,
      decisions: 2,
      terminals: 1,
      finalReviewPending: 1,
    });
    expect(planWrites).toBe(1);
  });
});
