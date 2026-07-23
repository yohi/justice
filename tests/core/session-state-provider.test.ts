import { describe, expect, it } from "vitest";
import { SessionStateProvider } from "../../src/core/session-state-provider";

describe("SessionStateProvider", () => {
  it("maps known agent names to AgentId", () => {
    const provider = new SessionStateProvider();
    provider.setAgentMapping("s1", "hephaestus");
    expect(provider.getAgentId("s1")).toBe("hephaestus");
  });

  it("maps unknown agent names to 'unknown'", () => {
    const provider = new SessionStateProvider();
    provider.setAgentMapping("s1", "nonexistent");
    expect(provider.getAgentId("s1")).toBe("unknown");
  });

  it("returns 'unknown' for unmapped sessions", () => {
    const provider = new SessionStateProvider();
    expect(provider.getAgentId("unmapped")).toBe("unknown");
  });

  it("opens and reads active task windows", () => {
    const provider = new SessionStateProvider();
    provider.setAgentMapping("s1", "sisyphus");
    provider.setActiveTaskWindow("c1", "t1", "s1");
    expect(provider.getActiveTaskId("c1")).toBe("t1");
  });

  it("closes active task windows", () => {
    const provider = new SessionStateProvider();
    provider.setActiveTaskWindow("c1", "t1", "s1");
    provider.closeActiveTaskWindow("c1");
    expect(provider.getActiveTaskId("c1")).toBeUndefined();
  });

  it("returns undefined for unknown callId", () => {
    const provider = new SessionStateProvider();
    expect(provider.getActiveTaskId("unknown")).toBeUndefined();
  });

  it("cleans up stale windows after session removal", () => {
    const provider = new SessionStateProvider();
    provider.setAgentMapping("s1", "sisyphus");
    provider.setActiveTaskWindow("c1", "t1", "s1");
    provider.removeSession("s1");
    expect(provider.getActiveTaskId("c1")).toBeUndefined();
    expect(provider.getAgentId("s1")).toBe("unknown");
  });

  it("recreates session with new generation after removal", () => {
    const provider = new SessionStateProvider();
    provider.setAgentMapping("s1", "sisyphus");
    const gen1 = provider.getSessionGeneration("s1");
    provider.removeSession("s1");
    provider.setActiveTaskWindow("c1", "t1", "s1");
    const gen2 = provider.getSessionGeneration("s1");
    expect(gen2).toBeDefined();
    expect(gen2).toBeGreaterThan(gen1 ?? 0);
  });

  it("resolves all known AGENT_IDS case-insensitively", () => {
    expect(SessionStateProvider.resolveAgentId("hephaestus")).toBe("hephaestus");
    expect(SessionStateProvider.resolveAgentId("Sisyphus")).toBe("sisyphus");
    expect(SessionStateProvider.resolveAgentId("PROMETHEUS")).toBe("prometheus");
    expect(SessionStateProvider.resolveAgentId("Atlas")).toBe("atlas");
  });

  it("returns undefined for removed session generation", () => {
    const provider = new SessionStateProvider();
    provider.setAgentMapping("s1", "sisyphus");
    provider.removeSession("s1");
    expect(provider.getSessionGeneration("s1")).toBeUndefined();
  });
});
