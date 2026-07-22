import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { mergePostToolUseResponses } from "../../src/core/hook-response-merger";
import type { HookResponse, PostToolUseEvent } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

describe("mergePostToolUseResponses", () => {
  it("combines inject responses into a single payload", () => {
    const merged = mergePostToolUseResponses([
      {
        action: "inject",
        injectedContext: "PlanBridge context",
      },
      {
        action: "inject",
        injectedContext: "TaskFeedback context",
      },
    ]);

    expect(merged).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "PlanBridge context\n\n---\n\nTaskFeedback context",
      }),
    );
  });

  it("prefers inject over proceed", () => {
    const injected: HookResponse = {
      action: "inject",
      injectedContext: "TaskFeedback context",
    };
    const normalized = {
      ...injected,
      normalInjectedContext: "TaskFeedback context",
    };

    expect(mergePostToolUseResponses([{ action: "proceed" }, injected])).toEqual(normalized);
    expect(mergePostToolUseResponses([injected, { action: "proceed" }])).toEqual(normalized);
  });

  it("prioritizes skip over inject", () => {
    const skip: HookResponse = { action: "skip" };
    const inject: HookResponse = { action: "inject", injectedContext: "Some context" };

    expect(mergePostToolUseResponses([skip, inject])).toEqual({ action: "skip" });
    expect(mergePostToolUseResponses([inject, skip])).toEqual({ action: "skip" });
  });

  it("warns and keeps the first modifiedPayload during PreToolUse merge", async () => {
    const warn = vi.fn();
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter(), {
      logger: { warn, error: vi.fn() },
    });
    vi.spyOn(plugin.getObservationHandler(), "handlePreToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "Observation context",
      modifiedPayload: { source: "observation" },
    });
    vi.spyOn(plugin.getPlanBridge(), "handlePreToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "PlanBridge context",
      modifiedPayload: { source: "plan-bridge" },
    });

    const response = await plugin.handleEvent({
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: {} },
      sessionId: "s-1",
    });

    expect(response).toEqual(expect.objectContaining({
      action: "inject",
      modifiedPayload: { source: "observation" },
    }));
    expect(warn).toHaveBeenCalledWith(
      "Conflict detected in pre-tool-use modifiedPayload; using the first response",
    );
  });

  it("merges gate-only context into gateAdvisoryContext", () => {
    const merged = mergePostToolUseResponses([
      {
        action: "inject",
        injectedContext: "Gate advisory context",
        variant: "gate_advisory",
      },
    ]);

    expect(merged).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "Gate advisory context",
        gateAdvisoryContext: "Gate advisory context",
        variant: "gate_advisory",
      }),
    );
  });

  it("preserves both normalInjectedContext and gateAdvisoryContext in mixed merge", () => {
    const merged = mergePostToolUseResponses([
      {
        action: "inject",
        injectedContext: "Normal context",
        normalInjectedContext: "Normal context",
      },
      {
        action: "inject",
        injectedContext: "Gate context",
        gateAdvisoryContext: "Gate context",
        variant: "gate_advisory",
      },
    ]);

    expect(merged).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "Normal context\n\n---\n\nGate context",
        normalInjectedContext: "Normal context",
        gateAdvisoryContext: "Gate context",
        variant: "gate_advisory",
      }),
    );
  });

  it("falls back from injectedContext to gateAdvisoryContext for legacy gate_advisory variant", () => {
    const merged = mergePostToolUseResponses([
      {
        action: "inject",
        injectedContext: "Legacy gate context",
        variant: "gate_advisory",
      },
    ]);

    expect(merged).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "Legacy gate context",
        gateAdvisoryContext: "Legacy gate context",
        variant: "gate_advisory",
      }),
    );
  });

  it("handles multiple gate-only contexts by concatenating them", () => {
    const merged = mergePostToolUseResponses([
      {
        action: "inject",
        injectedContext: "Gate context 1",
        variant: "gate_advisory",
      },
      {
        action: "inject",
        injectedContext: "Gate context 2",
        variant: "gate_advisory",
      },
    ]);

    expect(merged).toEqual(
      expect.objectContaining({
        action: "inject",
        injectedContext: "Gate context 1\n\n---\n\nGate context 2",
        gateAdvisoryContext: "Gate context 1\n\n---\n\nGate context 2",
        variant: "gate_advisory",
      }),
    );
  });
});

describe("JusticePlugin PostToolUse merge", () => {
  it("warns and keeps the first modifiedPayload on conflict", async () => {
    const warn = vi.fn();
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter(), {
      logger: { warn, error: vi.fn() },
    });
    vi.spyOn(plugin.getObservationHandler(), "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "Observation context",
      modifiedPayload: { source: "observation" },
    });
    vi.spyOn(plugin.getPlanBridge(), "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "PlanBridge context",
      modifiedPayload: { source: "plan-bridge" },
    });
    vi.spyOn(plugin.getTaskFeedback(), "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "TaskFeedback context",
    });

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    expect(response).toEqual(expect.objectContaining({
      action: "inject",
      modifiedPayload: { source: "observation" },
    }));
    expect(warn).toHaveBeenCalledWith(
      "Conflict detected in post-tool-use modifiedPayload; using the first response",
    );
  });

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
        injectedContext: "PlanBridge context\n\n---\n\nTaskFeedback context",
      }),
    );
  });

  it("swallows logger errors raised while warning about a post-tool-use merge conflict", async () => {
    const plugin = new JusticePlugin(createMockFileReader({}), createMockFileWriter(), {
      logger: {
        warn: (): never => {
          throw new Error("logger boom");
        },
        error: vi.fn(),
      },
    });
    vi.spyOn(plugin.getObservationHandler(), "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "Observation context",
      modifiedPayload: { source: "observation" },
    });
    vi.spyOn(plugin.getPlanBridge(), "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "PlanBridge context",
      modifiedPayload: { source: "plan-bridge" },
    });
    vi.spyOn(plugin.getTaskFeedback(), "handlePostToolUse").mockResolvedValue({
      action: "inject",
      injectedContext: "TaskFeedback context",
    });

    const response = await plugin.handleEvent({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "ok", error: false },
      sessionId: "s-1",
    } as PostToolUseEvent);

    // The logger.warn throw must be swallowed (fail-open); the merge result
    // itself is unaffected.
    expect(response).toEqual(expect.objectContaining({
      action: "inject",
      modifiedPayload: { source: "observation" },
    }));
  });
});
