import { describe, it, expect, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type { FileReader } from "../../src/core/types";

describe("PlanBridge Fallback Guard Integration", () => {
  const mockFileReader: FileReader = {
    readFile: vi.fn().mockResolvedValue("## Task 1: Implementation\n- [ ] Task 1.1"),
    fileExists: vi.fn().mockResolvedValue(true),
  };

  it("should trigger delegation if assistant mentions plan.md after user mentioned it", async () => {
    const bridge = new PlanBridge(mockFileReader);
    const sessionId = "session-1";

    // 1. User message mentioning plan
    await bridge.handleMessage({
      type: "Message",
      sessionId,
      payload: { role: "user", content: "Please follow plan.md" }
    });

    // 2. Assistant message mentioning plan (fallback path)
    const response = await bridge.handleMessage({
      type: "Message",
      sessionId,
      payload: { role: "assistant", content: "I will look into plan.md." }
    });

    expect(response.action).toBe("inject");
    expect(response.injectedContext).toContain("[JUSTICE:FALLBACK]");
  });

  it("should NOT trigger delegation if assistant mentions plan.md but user did NOT", async () => {
    const bridge = new PlanBridge(mockFileReader);
    const sessionId = "session-2";

    // 1. User message NOT mentioning plan
    await bridge.handleMessage({
      type: "Message",
      sessionId,
      payload: { role: "user", content: "Hello" }
    });

    // 2. Assistant message mentioning plan
    const response = await bridge.handleMessage({
      type: "Message",
      sessionId,
      payload: { role: "assistant", content: "I found plan.md." }
    });

    expect(response.action).toBe("proceed");
  });

  it("should still trigger primary path if assistant uses delegation keywords", async () => {
    const bridge = new PlanBridge(mockFileReader);
    const sessionId = "session-3";

    // 1. User message NOT mentioning plan
    await bridge.handleMessage({
      type: "Message",
      sessionId,
      payload: { role: "user", content: "Go ahead" }
    });

    // 2. Assistant message with delegation keyword
    const response = await bridge.handleMessage({
      type: "Message",
      sessionId,
      payload: { role: "assistant", content: "I will execute the next task in plan.md." }
    });

    expect(response.action).toBe("inject");
    expect(response.injectedContext).not.toContain("[JUSTICE:FALLBACK]");
  });
});
