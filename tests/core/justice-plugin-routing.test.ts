import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { AuthorizationStore } from "../../src/core/plan-authorization";
import type { MessageEvent, PostToolUseEvent, PreToolUseEvent, ReviewCorrelation } from "../../src/core/types";
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
  };
  reviewCompletionDomain: {
    consumeReviewCompletion: (input: unknown) => Promise<{ kind: string }>;
  };
};

function internalsOf(plugin: JusticePlugin): PluginInternals {
  return plugin as unknown as PluginInternals;
}

async function approvePlanAuthorization(plugin: JusticePlugin): Promise<string> {
  const binding = await internalsOf(plugin).authorizationStore.approve({
    sessionId: "s-1",
    planPath: "plan.md",
    planFingerprint: { algorithm: "sha256", value: "fingerprint" },
    canonicalSnapshot: {
      schema: "justice-plan-v1",
      documentDigest: "doc-digest",
      globalBodyDigest: "body-digest",
      tasks: [
        {
          taskId: "task-1",
          title: "Implement",
          canonicalBody: "- [ ] first\n- [ ] second",
          digest: "task-digest",
        },
      ],
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

function mockTerminalReviewCompletion(plugin: JusticePlugin): void {
  vi.spyOn(
    internalsOf(plugin).reviewCompletionDomain,
    "consumeReviewCompletion",
  ).mockResolvedValue({ kind: "terminalized" });
}

describe("JusticePlugin accepted-decision progress updates", () => {
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
