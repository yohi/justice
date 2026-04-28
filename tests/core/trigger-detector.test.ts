import { describe, it, expect } from "vitest";
import { TriggerDetector } from "../../src/core/trigger-detector";

describe("TriggerDetector", () => {
  const detector = new TriggerDetector();

  describe("detectPlanReference", () => {
    it("should detect explicit plan file path docs/plans/feature.md", () => {
      const result = detector.detectPlanReference(
        "Please look at docs/plans/feature.md and delegate tasks",
      );
      expect(result).not.toBeNull();
      if (result) {
        expect(result.planPath).toBe("docs/plans/feature.md");
      }
    });

    it("should detect plan path with various extensions", () => {
      const result = detector.detectPlanReference("Refer to docs/plans/2026-03-24-phase2.md");
      expect(result).not.toBeNull();
      if (result) {
        expect(result.planPath).toContain("phase2.md");
      }
    });

    it("should reject absolute paths", () => {
      expect(detector.detectPlanReference("/etc/passwd/plan.md")).toBeNull();
    });

    it("should reject path traversal with ..", () => {
      expect(detector.detectPlanReference("../../plan.md")).toBeNull();
      expect(detector.detectPlanReference("docs/../plan.md")).toBeNull();
    });

    it("should reject backslashes", () => {
      expect(detector.detectPlanReference("docs\\plans\\plan.md")).toBeNull();
    });

    it("should return null when no plan reference exists", () => {
      const result = detector.detectPlanReference("Hello, how are you?");
      expect(result).toBeNull();
    });

    it("should detect plan.md as a generic reference", () => {
      const result = detector.detectPlanReference("Check the plan.md for the next task");
      expect(result).not.toBeNull();
      if (result) {
        expect(result.planPath).toBe("plan.md");
      }
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

    // Phase 1: 日本語キーワード拡張テスト
    describe("Phase 1: extended Japanese keywords", () => {
      it("should detect 実装して", () => {
        expect(detector.detectDelegationIntent("plan.mdに基づいて実装して")).toBe(true);
      });

      it("should detect 実装を開始", () => {
        expect(detector.detectDelegationIntent("実装を開始してください")).toBe(true);
      });

      it("should detect 実装をお願い", () => {
        expect(detector.detectDelegationIntent("実装をお願いします")).toBe(true);
      });

      it("should detect 実装を進めて", () => {
        expect(detector.detectDelegationIntent("実装を進めてください")).toBe(true);
      });

      it("should detect 作成して", () => {
        expect(detector.detectDelegationIntent("テストファイルを作成して")).toBe(true);
      });

      it("should detect 作って", () => {
        expect(detector.detectDelegationIntent("コンポーネントを作って")).toBe(true);
      });

      it("should detect 進めて", () => {
        expect(detector.detectDelegationIntent("次のタスクを進めて")).toBe(true);
      });

      it("should detect 始めて", () => {
        expect(detector.detectDelegationIntent("タスクを始めて")).toBe(true);
      });

      it("should detect やって", () => {
        expect(detector.detectDelegationIntent("このissueをやって")).toBe(true);
      });

      it("should detect お願い", () => {
        expect(detector.detectDelegationIntent("次の実装お願い")).toBe(true);
      });

      it("should detect English keywords: implement", () => {
        expect(detector.detectDelegationIntent("Please implement the feature")).toBe(true);
      });

      it("should detect English keywords: build", () => {
        expect(detector.detectDelegationIntent("build the component")).toBe(true);
      });

      it("should detect English keywords: create", () => {
        expect(detector.detectDelegationIntent("create the service")).toBe(true);
      });

      it("should not detect lone English verbs without context", () => {
        expect(detector.detectDelegationIntent("I will implement it")).toBe(false);
        expect(detector.detectDelegationIntent("Just build it")).toBe(false);
        expect(detector.detectDelegationIntent("Can you create it?")).toBe(false);
      });
    });
  });

  describe("shouldTrigger", () => {
    it("should return true when plan reference AND delegation intent exist", () => {
      expect(detector.shouldTrigger("Delegate the next task from plan.md")).toBe(true);
    });

    it("should return true when plan reference exists (guarded fallback)", () => {
      // ユーザーがプランに言及している場合のみフォールバック
      const context = { lastUserMessage: "Please check plan.md" };
      const analysis = detector.analyzeTrigger("I will check plan.md", context);
      expect(analysis.shouldTrigger).toBe(true);
    });

    it("should return false when neither exists", () => {
      expect(detector.shouldTrigger("Hello world")).toBe(false);
    });

    it("should return false for plan.md reference without user context (guarded)", () => {
      expect(detector.shouldTrigger("I mentioned plan.md here")).toBe(false);
    });
  });

  describe("analyzeTrigger", () => {
    it("should trigger with fallbackTriggered=false when both planRef and intent exist", () => {
      const result = detector.analyzeTrigger("plan.mdに基づいて実装して");
      expect(result.shouldTrigger).toBe(true);
      expect(result.planRef).not.toBeNull();
      if (result.planRef) {
        expect(result.planRef.planPath).toBe("plan.md");
      }
      expect(result.fallbackTriggered).toBe(false);
    });

    it("should trigger with fallbackTriggered=true when planRef exists and user also mentioned plan", () => {
      const context = { lastUserMessage: "Here is the plan.md" };
      const result = detector.analyzeTrigger("plan.mdを確認した", context);
      expect(result.shouldTrigger).toBe(true);
      expect(result.planRef).not.toBeNull();
      if (result.planRef) {
        expect(result.planRef.planPath).toBe("plan.md");
      }
      expect(result.fallbackTriggered).toBe(true);
    });

    it("should not trigger when neither planRef nor intent exists", () => {
      const result = detector.analyzeTrigger("今日の天気は？");
      expect(result.shouldTrigger).toBe(false);
      expect(result.planRef).toBeNull();
      expect(result.fallbackTriggered).toBe(false);
    });

    it("should not trigger when only intent exists without planRef", () => {
      const result = detector.analyzeTrigger("実装してください");
      expect(result.shouldTrigger).toBe(false);
      expect(result.planRef).toBeNull();
      expect(result.fallbackTriggered).toBe(false);
    });

    it("should not trigger via fallback if user mentioned a DIFFERENT plan file", () => {
      const context = { lastUserMessage: "Please check plan-A.md" };
      const result = detector.analyzeTrigger("plan-B.mdを確認した", context);
      expect(result.shouldTrigger).toBe(false);
      expect(result.fallbackTriggered).toBe(false);
    });

    it("should not trigger via fallback if user did NOT mention plan file", () => {
      const context = { lastUserMessage: "Hello" };
      const result = detector.analyzeTrigger("docs/plans/design-plan.mdを見て", context);
      expect(result.shouldTrigger).toBe(false);
      expect(result.fallbackTriggered).toBe(false);
    });

    it("should trigger via primary path for Japanese delegation with plan reference", () => {
      const result = detector.analyzeTrigger("plan.mdのタスクを委譲する");
      expect(result.shouldTrigger).toBe(true);
      expect(result.planRef).not.toBeNull();
      expect(result.fallbackTriggered).toBe(false);
    });

    describe("Context Guarding", () => {
      it("should trigger fallback if last user message contains a plan reference", () => {
        const context = { lastUserMessage: "Look at docs/plans/main.md" };
        const result = detector.analyzeTrigger("Checking docs/plans/main.md", context);
        expect(result.shouldTrigger).toBe(true);
        expect(result.fallbackTriggered).toBe(true);
      });

      it("should NOT trigger fallback if last user message does NOT contain a plan reference", () => {
        const context = { lastUserMessage: "How are you?" };
        const result = detector.analyzeTrigger("I am working on plan.md", context);
        expect(result.shouldTrigger).toBe(false);
        expect(result.fallbackTriggered).toBe(false);
      });

      it("should still trigger PRIMARY path regardless of context", () => {
        const context = { lastUserMessage: "No mention of plan here" };
        const result = detector.analyzeTrigger("Delegate next task from plan.md", context);
        expect(result.shouldTrigger).toBe(true);
        expect(result.fallbackTriggered).toBe(false);
      });
    });
  });
});
