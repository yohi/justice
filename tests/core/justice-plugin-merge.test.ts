import { describe, expect, it, vi } from "vitest";
import { JusticePlugin, mergePostToolUseResponses } from "../../src/core/justice-plugin";
import type { HookResponse, PostToolUseEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("mergePostToolUseResponses", () => {
  it("combines inject responses into a single payload", () => {
    const merged = mergePostToolUseResponses(
      {
        action: "inject",
        injectedContext: "PlanBridge context",
      },
      {
        action: "inject",
        injectedContext: "TaskFeedback context",
      },
    );

    expect(merged).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "PlanBridge context\n\nTaskFeedback context",
      }),
    );
  });

  it("prefers inject over proceed", () => {
    const injected: HookResponse = {
      action: "inject",
      injectedContext: "TaskFeedback context",
    };

    expect(mergePostToolUseResponses({ action: "proceed" }, injected)).toBe(injected);
    expect(mergePostToolUseResponses(injected, { action: "proceed" })).toBe(injected);
  });

  it("prioritizes skip over inject", () => {
    const skip: HookResponse = { action: "skip" };
    const inject: HookResponse = { action: "inject", injectedContext: "Some context" };

    expect(mergePostToolUseResponses(skip, inject)).toEqual({ action: "skip" });
    expect(mergePostToolUseResponses(inject, skip)).toEqual({ action: "skip" });
  });
});

describe("JusticePlugin PostToolUse merge", () => {
  it("merges PlanBridge and TaskFeedback responses", async () => {
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter());
    const planBridge = plugin.getPlanBridge();
    const taskFeedback = plugin.getTaskFeedback();

    vi.spyOn(planBridge, "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "PlanBridge context",
    });
    vi.spyOn(taskFeedback, "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "TaskFeedback context",
    });

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    expect(response).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "PlanBridge context\n\nTaskFeedback context",
      }),
    );
  });
});
