import { describe, expect, it } from "vitest";
import { AgentRouter } from "../../../src/core/agent-router";

describe("AgentRouter controller routing", () => {
  const router = new AgentRouter();

  it("resolves known workflows through WorkflowRouter", () => {
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
