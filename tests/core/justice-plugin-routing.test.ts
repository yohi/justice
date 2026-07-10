import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type { MessageEvent, PostToolUseEvent, PreToolUseEvent } from "../../src/core/types";
import type { ObservationMessagePayload } from "../../src/core/v2/message-payload";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

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

  it("routes a user Message to plan-bridge.handleMessage", async () => {
    const plugin = createPlugin();
    const observation = plugin.getObservationHandler();
    const planBridge = plugin.getPlanBridge();

    const planSpy = vi
      .spyOn(planBridge, "handleMessage")
      .mockResolvedValue({ action: "proceed" });
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
