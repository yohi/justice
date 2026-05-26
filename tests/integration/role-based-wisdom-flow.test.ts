import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";
import { WisdomStore } from "../../src/core/wisdom-store";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { makeWisdomDraft } from "../helpers/wisdom-draft-factory";

const plan = ["## Task 1: Design architecture", "- [ ] Choose boundaries"].join("\n");

describe("Role-based wisdom integration flow", () => {
  it("injects only wisdom matching the delegated persona", async () => {
    const reader = createMockFileReader({ "plan.md": plan });
    const writer = createMockFileWriter();
    const wisdomStore = new WisdomStore();
    const loopHandler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
    const bridge = new PlanBridge(reader, loopHandler, wisdomStore);

    for (const content of ["hephaestus-1", "hephaestus-2", "hephaestus-3"]) {
      wisdomStore.add(makeWisdomDraft({ content, persona: "hephaestus" }), {
        persona: "hephaestus",
      });
    }
    for (const content of ["atlas-1", "atlas-2"]) {
      wisdomStore.add(makeWisdomDraft({ category: "design_decision", content, persona: "atlas" }), {
        persona: "atlas",
      });
    }

    const atlasEntries = wisdomStore.getRelevant({ persona: "atlas" });
    expect(atlasEntries).toHaveLength(2);
    expect(atlasEntries.every((entry) => entry.persona === "atlas")).toBe(true);

    bridge.setActivePlan("s-role", "plan.md");
    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-role",
      payload: { toolName: "task", toolInput: { agent: "atlas", prompt: "design it" } },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected persona-scoped injection");
    expect(response.injectedContext).toContain("**AGENT**: atlas");
    expect(response.injectedContext).toContain("atlas-1");
    expect(response.injectedContext).toContain("atlas-2");
    expect(response.injectedContext).not.toContain("hephaestus-1");
    expect(response.injectedContext).not.toContain("hephaestus-2");
    expect(response.injectedContext).not.toContain("hephaestus-3");
  });

  it("does not reuse a previous persona when the next task input has no persona signal", async () => {
    const reader = createMockFileReader({ "plan.md": plan });
    const writer = createMockFileWriter();
    const wisdomStore = new WisdomStore();
    const loopHandler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
    const bridge = new PlanBridge(reader, loopHandler, wisdomStore);

    wisdomStore.add(makeWisdomDraft({ content: "atlas-only", persona: "atlas" }), {
      persona: "atlas",
    });
    wisdomStore.add(makeWisdomDraft({ content: "hephaestus-only", persona: "hephaestus" }), {
      persona: "hephaestus",
    });

    bridge.setActivePlan("s-stale", "plan.md");
    await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-stale",
      payload: { toolName: "task", toolInput: { agent: "atlas", prompt: "design it" } },
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-stale",
      payload: { toolName: "task", toolInput: { prompt: "continue implementation" } },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected default persona injection");
    expect(response.injectedContext).toContain("**AGENT**: hephaestus");
    expect(response.injectedContext).toContain("hephaestus-only");
    expect(response.injectedContext).not.toContain("atlas-only");
  });
});
