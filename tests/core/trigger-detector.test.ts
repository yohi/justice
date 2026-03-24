import { describe, it, expect } from "vitest";
import { TriggerDetector } from "../../src/core/trigger-detector";
import type { PlanReference } from "../../src/core/trigger-detector";

describe("TriggerDetector", () => {
  const detector = new TriggerDetector();

  describe("detectPlanReference", () => {
    it("should detect explicit plan.md file path", () => {
      const result = detector.detectPlanReference(
        "Please look at docs/plans/feature.md and delegate tasks",
      );
      expect(result).not.toBeNull();
      expect(result!.planPath).toBe("docs/plans/feature.md");
    });

    it("should detect plan path with various extensions", () => {
      const result = detector.detectPlanReference(
        "Refer to docs/plans/2026-03-24-phase2.md",
      );
      expect(result).not.toBeNull();
      expect(result!.planPath).toContain("phase2.md");
    });

    it("should return null when no plan reference exists", () => {
      const result = detector.detectPlanReference("Hello, how are you?");
      expect(result).toBeNull();
    });

    it("should detect plan.md as a generic reference", () => {
      const result = detector.detectPlanReference(
        "Check the plan.md for the next task",
      );
      expect(result).not.toBeNull();
      expect(result!.planPath).toBe("plan.md");
    });
  });

  describe("detectDelegationIntent", () => {
    it("should detect 'delegate' keyword", () => {
      expect(detector.detectDelegationIntent("delegate the next task")).toBe(true);
    });

    it("should detect 'next task' keyword", () => {
      expect(detector.detectDelegationIntent("execute the next task")).toBe(true);
    });

    it("should detect Japanese delegation keywords", () => {
      expect(detector.detectDelegationIntent("次のタスクを実行して")).toBe(true);
      expect(detector.detectDelegationIntent("タスクを委譲する")).toBe(true);
    });

    it("should return false for unrelated messages", () => {
      expect(detector.detectDelegationIntent("What is the weather?")).toBe(false);
    });
  });

  describe("shouldTrigger", () => {
    it("should return true when plan reference AND delegation intent exist", () => {
      expect(
        detector.shouldTrigger("Delegate the next task from plan.md"),
      ).toBe(true);
    });

    it("should return true when plan reference exists (implicit delegation)", () => {
      expect(
        detector.shouldTrigger("Check plan.md and run the next incomplete task"),
      ).toBe(true);
    });

    it("should return false when neither exists", () => {
      expect(detector.shouldTrigger("Hello world")).toBe(false);
    });
  });
});
