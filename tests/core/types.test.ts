import { describe, it, expect } from "vitest";
import type {
  HookEvent,
  HookResponse,
} from "../../src/core/types";

describe("Hook Types Validation", () => {
  describe("HookEvent", () => {
    it("should accept valid MessageEvent", () => {
      const event: HookEvent = {
        type: "Message",
        payload: {
          role: "user",
          content: "Hello",
        },
        sessionId: "session-123",
      };
      expect(event.type).toBe("Message");
      expect(event.payload.content).toBe("Hello");
    });

    it("should accept valid PreToolUseEvent", () => {
      const event: HookEvent = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { taskId: "1" },
        },
        sessionId: "session-123",
      };
      expect(event.type).toBe("PreToolUse");
      expect(event.payload.toolName).toBe("task");
    });
  });

  describe("HookResponse", () => {
    it("should accept valid ProceedResponse", () => {
      const response: HookResponse = {
        action: "proceed",
      };
      expect(response.action).toBe("proceed");
    });

    it("should accept valid InjectResponse", () => {
      const response: HookResponse = {
        action: "inject",
        injectedContext: "Some context",
      };
      expect(response.action).toBe("inject");
      expect(response.injectedContext).toBe("Some context");
    });
  });
});
