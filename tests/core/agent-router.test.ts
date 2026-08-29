import { describe, it, expect } from "vitest";
import { AgentRouter } from "../../src/core/agent-router";

describe("AgentRouter", () => {
  const router = new AgentRouter();

  describe("routeController", () => {
    it("should resolve workflow controllers through WorkflowRouter", () => {
      expect(router.routeController("brainstorming")).toBe("sisyphus");
      expect(router.routeController("subagent-driven-development")).toBe("atlas");
    });

    it("should return undefined for unknown workflows", () => {
      expect(router.routeController("__proto__")).toBeUndefined();
    });
  });
});
