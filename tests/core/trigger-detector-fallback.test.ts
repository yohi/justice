import { describe, it, expect } from "vitest";
import { TriggerDetector } from "../../src/core/trigger-detector";

describe("TriggerDetector Fallback Guard", () => {
  const detector = new TriggerDetector();

  it("should trigger fallback if plan.md is mentioned and lastUserMessage contains plan reference", () => {
    const assistantMessage = "I will look into plan.md.";
    const context = { lastUserMessage: "Please follow plan.md" };
    
    // This is the new behavior we want to implement
    const result = detector.analyzeTrigger(assistantMessage, context);
    expect(result.shouldTrigger).toBe(true);
    expect(result.fallbackTriggered).toBe(true);
  });

  it("should NOT trigger fallback if plan.md is mentioned but lastUserMessage does NOT contain plan reference", () => {
    const assistantMessage = "I found a plan.md file in the directory.";
    const context = { lastUserMessage: "What files are here?" };
    
    const result = detector.analyzeTrigger(assistantMessage, context);
    expect(result.shouldTrigger).toBe(false);
  });

  it("should still trigger primary path even without context if keyword is present", () => {
    const assistantMessage = "I will execute the next task in plan.md.";
    const context = { lastUserMessage: "Go ahead." };
    
    const result = detector.analyzeTrigger(assistantMessage, context);
    expect(result.shouldTrigger).toBe(true);
    expect(result.fallbackTriggered).toBe(false);
  });
  
  it("should NOT trigger fallback if context is missing (backward compatibility / default guard)", () => {
    const assistantMessage = "I will look into plan.md.";
    
    const result = detector.analyzeTrigger(assistantMessage);
    expect(result.shouldTrigger).toBe(false);
  });
});
