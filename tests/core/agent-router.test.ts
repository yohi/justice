import { describe, expect, it } from "vitest";
import { AgentRouter } from "../../src/core/agent-router";
import { inferPersonaFromToolInput } from "../../src/core/plan-completion-detector";

describe("AgentRouter", () => {
  const router = new AgentRouter();

  it("resolves workflow controllers through WorkflowRouter", () => {
    expect(router.routeController("brainstorming")).toBe("sisyphus");
    expect(router.routeController("subagent-driven-development")).toBe("atlas");
  });

  it("returns undefined for unknown workflows", () => {
    expect(router.routeController("__proto__")).toBeUndefined();
  });

  it("does not expose legacy worker routing APIs", () => {
    expect("route" in router).toBe(false);
    expect("determineOptimalAgent" in router).toBe(false);
  });
});

describe("inferPersonaFromToolInput", () => {
  it("infers review and debugging personas from skills", () => {
    expect(inferPersonaFromToolInput({ skills: ["code-quality-reviewer"] })).toBe("prometheus");
    expect(inferPersonaFromToolInput({ loadSkills: ["systematic-debugging"] })).toBe("sisyphus");
    expect(inferPersonaFromToolInput({ skills: ["writing-plans"] })).toBe("atlas");
  });

  it("infers personas from role or prompt text", () => {
    expect(inferPersonaFromToolInput({ role: "spec-reviewer" })).toBe("prometheus");
    expect(inferPersonaFromToolInput({ prompt: "please run systematic-debugging" })).toBe("sisyphus");
  });

  it("returns undefined for unrelated input", () => {
    expect(inferPersonaFromToolInput({ skills: ["implementer-prompt"] })).toBeUndefined();
  });
});
