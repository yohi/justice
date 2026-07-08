import { describe, it, expect, beforeEach } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import type { AgentId, AgentMappedEvent, FileReader, FileWriter } from "../../src/core/types";

const PERSONAS: readonly AgentId[] = ["hephaestus", "sisyphus", "prometheus", "atlas"];

function agentMapped(sessionId: string, agentName: string): AgentMappedEvent {
  return { type: "AgentMapped", payload: { sessionId, agentName } };
}

describe("Task 3.4: agentId resolution & session state mapping", () => {
  describe("name -> AgentId resolution (direct SessionStateProvider)", () => {
    it("maps each of the 4 personas case-insensitively", async () => {
      const provider = new SessionStateProvider();
      const cases: ReadonlyArray<readonly [string, AgentId]> = [
        ["hephaestus", "hephaestus"],
        ["Sisyphus", "sisyphus"],
        ["PROMETHEUS", "prometheus"],
        ["AtLaS", "atlas"],
      ];

      for (const [name, expected] of cases) {
        const sessionId = `session-${name}`;
        provider.setAgentMapping(sessionId, name);
        await expect(provider.getAgentId(sessionId)).resolves.toBe(expected);
      }
    });

    it("resolves an unrecognized agent name to 'unknown'", async () => {
      const provider = new SessionStateProvider();
      provider.setAgentMapping("s1", "gemini-cli");
      await expect(provider.getAgentId("s1")).resolves.toBe("unknown");
    });

    it("resolves an unmapped session to 'unknown'", async () => {
      const provider = new SessionStateProvider();
      await expect(provider.getAgentId("never-seen")).resolves.toBe("unknown");
    });
  });

  describe("AgentMapped event wiring via JusticePlugin.handleEvent", () => {
    let reader: FileReader;
    let writer: FileWriter;
    let plugin: JusticePlugin;

    beforeEach(() => {
      reader = createMockFileReader({ "plan.md": "## Task 1\n- [ ] step\n" });
      writer = createMockFileWriter();
      plugin = new JusticePlugin(reader, writer);
    });

    it("exposes a SessionStateProvider via getSessionStateProvider()", () => {
      expect(plugin.getSessionStateProvider()).toBeInstanceOf(SessionStateProvider);
    });

    it("updates the provider mapping for each persona and returns PROCEED", async () => {
      for (const persona of PERSONAS) {
        const sessionId = `s-${persona}`;
        // Upper-cased name also exercises case-insensitivity through the event path.
        const response = await plugin.handleEvent(agentMapped(sessionId, persona.toUpperCase()));
        expect(response).toEqual({ action: "proceed" });
        await expect(plugin.getSessionStateProvider().getAgentId(sessionId)).resolves.toBe(persona);
      }
    });

    it("maps an unknown agent name from the event to 'unknown' (still PROCEED)", async () => {
      const response = await plugin.handleEvent(agentMapped("s-unknown", "cursor"));
      expect(response).toEqual({ action: "proceed" });
      await expect(plugin.getSessionStateProvider().getAgentId("s-unknown")).resolves.toBe(
        "unknown",
      );
    });
  });

  describe("task windows keyed by callId (spec §5.8 / D74)", () => {
    it("opens, reads, and closes a window by callId", () => {
      const provider = new SessionStateProvider();
      expect(provider.getActiveTaskId("call-1")).toBeUndefined();

      provider.setActiveTaskWindow("call-1", "task-1");
      expect(provider.getActiveTaskId("call-1")).toBe("task-1");

      provider.closeActiveTaskWindow("call-1");
      expect(provider.getActiveTaskId("call-1")).toBeUndefined();
    });

    it("keeps distinct callIds independent", () => {
      const provider = new SessionStateProvider();
      provider.setActiveTaskWindow("call-a", "task-a");
      provider.setActiveTaskWindow("call-b", "task-b");

      expect(provider.getActiveTaskId("call-a")).toBe("task-a");
      expect(provider.getActiveTaskId("call-b")).toBe("task-b");

      provider.closeActiveTaskWindow("call-a");
      expect(provider.getActiveTaskId("call-a")).toBeUndefined();
      // Closing call-a must not disturb call-b.
      expect(provider.getActiveTaskId("call-b")).toBe("task-b");
    });

    it("overwrites the taskId when the same callId window is re-opened", () => {
      const provider = new SessionStateProvider();
      provider.setActiveTaskWindow("call-x", "task-old");
      provider.setActiveTaskWindow("call-x", "task-new");
      expect(provider.getActiveTaskId("call-x")).toBe("task-new");
    });

    it("closing a never-opened callId is a no-op", () => {
      const provider = new SessionStateProvider();
      expect(() => provider.closeActiveTaskWindow("ghost")).not.toThrow();
      expect(provider.getActiveTaskId("ghost")).toBeUndefined();
    });
  });

  describe("pollution guard: unknown/system agentIds never leak into wisdom persona namespaces", () => {
    it("leaves the 4 persona namespaces unaffected by unknown/system mappings", async () => {
      const reader = createMockFileReader({});
      const writer = createMockFileWriter();
      const plugin = new JusticePlugin(reader, writer);
      const wisdom = plugin.getWisdomStore();

      // Seed one legit entry per persona so the store is genuinely populated.
      for (const persona of PERSONAS) {
        wisdom.add({
          taskId: `seed-${persona}`,
          category: "design_decision",
          content: `legit ${persona} learning`,
          persona,
        });
      }

      // Route several unknown/system-ish agent mappings through the observation side.
      for (const name of ["system", "unknown", "gemini", "cursor-agent"]) {
        await plugin.handleEvent(agentMapped(`obs-${name}`, name));
        await expect(plugin.getSessionStateProvider().getAgentId(`obs-${name}`)).resolves.toBe(
          "unknown",
        );
      }

      // Wisdom store must be untouched: exactly the 4 seeded entries, every persona a real AgentId.
      const all = wisdom.getAllEntries();
      expect(all).toHaveLength(PERSONAS.length);

      const personasSeen = [...new Set(all.map((e) => e.persona))].sort();
      expect(personasSeen).toEqual([...PERSONAS].sort());

      for (const persona of PERSONAS) {
        const forPersona = wisdom.getRelevant({ persona });
        expect(forPersona).toHaveLength(1);
        expect(forPersona[0]?.taskId).toBe(`seed-${persona}`);
      }

      // No entry may carry a non-AgentId (unknown/system) persona.
      const validPersonas = new Set<string>(PERSONAS);
      for (const entry of all) {
        expect(validPersonas.has(entry.persona)).toBe(true);
      }
    });
  });
});
