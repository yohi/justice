import { describe, expect, it, vi } from "vitest";
import { ReviewRejectionDetector } from "../../src/core/review-rejection-detector";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import type { ObservationLogStore } from "../../src/runtime/observation-log-store";
import type { PostToolUseEvent } from "../../src/core/types";

function buildPostToolUseEvent(sessionId: string, callId: string): PostToolUseEvent {
  return {
    type: "PostToolUse",
    sessionId,
    callId,
    payload: {
      toolName: "bash",
      toolResult: "",
      error: false,
      toolInput: {},
    },
  };
}

describe("FF-006 fail-open", () => {
  it("log append exception returns PROCEED", async () => {
    const logStore: ObservationLogStore = {
      append: async () => {
        throw new Error("disk full");
      },
      readAll: async () => [],
      destroySession: () => {},
      getWriterId: () => "w-1",
      getRotationHealth: () => ({ consecutiveFailures: 0, degraded: false, lastError: null }),
    } as unknown as ObservationLogStore;

    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "hephaestus");

    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-1",
    });

    const result = await handler.handlePostToolUse(buildPostToolUseEvent("session-1", "c1"));

    expect(result.action).toBe("proceed");
  });

  it("projection cache readAll exception returns PROCEED", async () => {
    const logStore: ObservationLogStore = {
      append: async () => 1,
      readAll: async () => {
        throw new Error("corrupted log");
      },
      destroySession: () => {},
      getWriterId: () => "w-1",
      getRotationHealth: () => ({ consecutiveFailures: 0, degraded: false, lastError: null }),
    } as unknown as ObservationLogStore;

    const sessionState = new SessionStateProvider();
    sessionState.setAgentMapping("session-1", "hephaestus");

    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-1",
      projectionCache: { read: async () => undefined, write: async () => {} },
    });

    const result = await handler.handlePostToolUse(buildPostToolUseEvent("session-1", "c1"));

    expect(result.action).toBe("proceed");
  });

  it("review observation exception returns PROCEED without formatting a directive", async () => {
    // Given
    const detectorError = new Error("review detector unavailable");
    vi.spyOn(ReviewRejectionDetector.prototype, "detectMultiple").mockImplementationOnce(() => {
      throw detectorError;
    });
    const logStore: ObservationLogStore = {
      append: async () => 1,
      readAll: async () => [],
      destroySession: () => {},
      getWriterId: () => "w-1",
      getRotationHealth: () => ({ consecutiveFailures: 0, degraded: false, lastError: null }),
    } as unknown as ObservationLogStore;
    const sessionState = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-1",
    });

    // When
    const result = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review-error",
      callId: "call-review-error",
      payload: {
        toolName: "code_review",
        toolInput: {},
        toolResult: "MUST FIX: parser regression at src/parser.ts:10",
        error: false,
      },
    });

    // Then
    expect(result).toEqual({ action: "proceed" });
  });
});
