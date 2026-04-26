import { describe, it, expect } from "vitest";
import { AgentRouter, AGENT_IDS } from "../../src/core/agent-router";

describe("AgentRouter", () => {
  const router = new AgentRouter();

  describe("determineOptimalAgent", () => {
    it("should pick hephaestus for implementer-prompt skill", () => {
      const agent = router.determineOptimalAgent("deep", ["implementer-prompt"]);
      expect(agent).toBe("hephaestus");
    });

    it("should pick sisyphus for systematic-debugging skill", () => {
      const agent = router.determineOptimalAgent("deep", ["systematic-debugging"]);
      expect(agent).toBe("sisyphus");
    });

    it("should pick atlas for writing-plans skill", () => {
      const agent = router.determineOptimalAgent("deep", ["writing-plans"]);
      expect(agent).toBe("atlas");
    });

    it("should fall back to hephaestus when skills set is empty", () => {
      const agent = router.determineOptimalAgent("deep", []);
      expect(agent).toBe("hephaestus");
    });

    it("should fall back to hephaestus when skills are unknown", () => {
      const agent = router.determineOptimalAgent("deep", ["completely-unknown-skill"]);
      expect(agent).toBe("hephaestus");
    });
  });

  describe("Dominant Override (no self-review)", () => {
    it("should force prometheus when code-quality-reviewer is requested", () => {
      // 実装系スキルが多数あっても、レビュー系の Dominant Override が勝つ
      const agent = router.determineOptimalAgent("deep", [
        "implementer-prompt",
        "test-driven-development",
        "code-quality-reviewer",
      ]);
      expect(agent).toBe("prometheus");
    });

    it("should force prometheus when spec-reviewer is requested", () => {
      const agent = router.determineOptimalAgent("deep", [
        "implementer-prompt",
        "spec-reviewer",
      ]);
      expect(agent).toBe("prometheus");
    });

    it("should expose dominant_override reason via route()", () => {
      const result = router.route("deep", ["implementer-prompt", "code-quality-reviewer"]);
      expect(result.reason).toBe("dominant_override");
      expect(result.agentId).toBe("prometheus");
      expect(result.overrideSkill).toBe("code-quality-reviewer");
    });

    it("should NEVER allow hephaestus to review its own code (regression guard)", () => {
      // 実装担当 + レビュー要求 → 実装担当が自分のコードをレビューしてはならない
      const result = router.route("feature", [
        "implementer-prompt",
        "test-driven-development",
        "code-quality-reviewer",
      ]);
      expect(result.agentId).not.toBe("hephaestus");
      expect(result.agentId).toBe("prometheus");
    });
  });

  describe("Context Multipliers", () => {
    it("should boost sisyphus on bugfix + systematic-debugging (x1.5)", () => {
      const baseline = router.route("deep", ["systematic-debugging"]);
      const boosted = router.route("bugfix", ["systematic-debugging"]);
      expect(boosted.agentId).toBe("sisyphus");
      // baseline: 10 (sisyphus base) → boosted: 15
      expect(boosted.score).toBeCloseTo(baseline.score * 1.5);
    });

    it("should boost hephaestus on feature + implementer-prompt (x1.5)", () => {
      const baseline = router.route("deep", ["implementer-prompt"]);
      const boosted = router.route("feature", ["implementer-prompt"]);
      expect(boosted.agentId).toBe("hephaestus");
      expect(boosted.score).toBeCloseTo(baseline.score * 1.5);
    });

    it("should not apply multiplier when category/skill combination is not registered", () => {
      const baseline = router.route("deep", ["implementer-prompt"]);
      const sameAsBaseline = router.route("writing", ["implementer-prompt"]);
      expect(sameAsBaseline.score).toBe(baseline.score);
    });
  });

  describe("Score aggregation", () => {
    it("should sum scores across multiple skills", () => {
      // implementer-prompt: hephaestus=10, sisyphus=3
      // test-driven-development: hephaestus=6, sisyphus=8
      // → hephaestus=16, sisyphus=11 → hephaestus wins
      const result = router.route("deep", ["implementer-prompt", "test-driven-development"]);
      expect(result.agentId).toBe("hephaestus");
      expect(result.scoreboard.hephaestus).toBe(16);
      expect(result.scoreboard.sisyphus).toBe(11);
    });

    it("should pick the agent with the highest cumulative score", () => {
      // systematic-debugging: hephaestus=2, sisyphus=10
      // test-driven-development: hephaestus=6, sisyphus=8
      // → sisyphus=18, hephaestus=8 → sisyphus wins
      const result = router.route("deep", ["systematic-debugging", "test-driven-development"]);
      expect(result.agentId).toBe("sisyphus");
    });

    it("should expose all four agents in the scoreboard", () => {
      const result = router.route("deep", ["implementer-prompt"]);
      for (const agent of AGENT_IDS) {
        expect(result.scoreboard).toHaveProperty(agent);
        expect(typeof result.scoreboard[agent]).toBe("number");
      }
    });

    it("should return reason=score_winner for normal scoring path", () => {
      const result = router.route("deep", ["implementer-prompt"]);
      expect(result.reason).toBe("score_winner");
    });

    it("should return reason=fallback for empty/unknown skills", () => {
      const result = router.route("deep", []);
      expect(result.reason).toBe("fallback");
      expect(result.agentId).toBe("hephaestus");
    });
  });
});
