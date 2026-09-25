import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { AuthorizationStore } from "../../src/core/plan-authorization";
import type {
  MessageEvent,
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

function taskReviewCorrelation(authorizationId: string): ReviewCorrelation {
  return {
    reviewKind: "task-review",
    taskExecutionRef: { authorizationId, taskId: "task-1", attemptId: "attempt-1" },
    reviewRound: 1,
  };
}

function reviewPostToolUseEvent(): PostToolUseEvent {
  return {
    type: "PostToolUse",
    sessionId: "s-1",
    callId: "review-call",
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
  };
  reviewDispatchState: {
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
): Promise<string> {
  const binding = await internalsOf(plugin).authorizationStore.approve({
    sessionId: "s-1",
    planPath: "plan.md",
    planFingerprint: { algorithm: "sha256", value: "fingerprint" },
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
): Promise<void> {
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
  await appendObservation(plugin, {
    recordType: "observation",
    kind: "review_dispatch_transition",
    transitionId: "t-claimed",
    parentSessionId: "s-1",
    correlation,
    expectedCategory: "sp-review",
    from: "pending",
    to: "claimed",
    callId: "review-call",
    artifactReservation: {
      status: "usable",
      artifactId: "a-1",
      artifactPath: ".justice/reviews/a-1.md",
      leasePath: ".justice/reviews/a-1.md.lease",
      artifactIdentity: { device: "d", inode: "i" },
    },
  });
}

async function seedAcceptedDecision(
  plugin: JusticePlugin,
  authorizationId: string,
): Promise<void> {
  await appendObservation(plugin, {
    recordType: "decision",
    kind: "task-acceptance",
    taskId: "task-1",
    taskExecutionRef: { authorizationId, taskId: "task-1", attemptId: "attempt-1" },
    verdict: "accepted",
  });
}

async function seedAcceptedTaskLifecycle(
  plugin: JusticePlugin,
  authorizationId: string,
  taskId: string,
): Promise<void> {
  const taskExecutionRef = { authorizationId, taskId, attemptId: `attempt-${taskId}` };
  const transitions = [
    ["pending", "authorized"],
    ["authorized", "in_progress"],
    ["in_progress", "worker_reported"],
    ["worker_reported", "evidence_pending"],
    ["evidence_pending", "review_pending"],
    ["review_pending", "gate_pending"],
    ["gate_pending", "accepted"],
  ] as const;
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

function mockTerminalReviewCompletion(plugin: JusticePlugin): void {
  vi.spyOn(
    internalsOf(plugin).reviewCompletionDomain,
    "consumeReviewCompletion",
  ).mockResolvedValue({ kind: "terminalized" });
}

describe("JusticePlugin PostToolUse review directive delivery", () => {
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
        "**Task ID**: task-1",
        "**Attempt ID**: attempt-1",
        "**Review round**: 1",
      ].join("\n"),
      normalInjectedContext: [
        "[JUSTICE: REVIEW REQUIRED]",
        "**Review kind**: task-review",
        "**Category**: sp-review",
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
    expect(response.injectedContext).toContain("**Finalization attempt ID**:");
    expect(response.injectedContext).toContain("**Final review round**: 1");
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
    mockTerminalReviewCompletion(plugin);

    const response = await plugin.handleEvent(reviewPostToolUseEvent());

    expect(response).toEqual({
      action: "inject",
      injectedContext: "[JUSTICE: REVIEW COMPLETION RECORDED]",
    });
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
