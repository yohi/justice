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

    await bridge.handleImplementationArm("s-role", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-role",
      payload: { toolName: "task", toolInput: { agent: "atlas", prompt: "design it" } },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected persona-scoped injection");
    expect(response.injectedContext).not.toContain("**AGENT**");
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
    wisdomStore.add(makeWisdomDraft({ content: "sisyphus-only", persona: "sisyphus" }), {
      persona: "sisyphus",
    });

    bridge.setActivePlan("s-stale", "plan.md");
    await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-stale",
      payload: { toolName: "task", toolInput: { agent: "atlas", prompt: "design it" } },
    });

    await bridge.handleImplementationArm("s-stale", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-stale",
      payload: { toolName: "task", toolInput: { prompt: "continue implementation" } },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected default persona injection");
    expect(response.injectedContext).not.toContain("**AGENT**");
    expect(response.injectedContext).toContain("sisyphus-only");
    expect(response.injectedContext).not.toContain("atlas-only");
  });

  it("uses the dominant_override persona over an explicit toolInput agent when a review skill is present", async () => {
    const reader = createMockFileReader({ "plan.md": plan });
    const writer = createMockFileWriter();
    const wisdomStore = new WisdomStore();
    const loopHandler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
    const bridge = new PlanBridge(reader, loopHandler, wisdomStore);

    wisdomStore.add(makeWisdomDraft({ content: "prometheus-wisdom", persona: "prometheus" }), {
      persona: "prometheus",
    });
    wisdomStore.add(makeWisdomDraft({ content: "hephaestus-wisdom", persona: "hephaestus" }), {
      persona: "hephaestus",
    });

    await bridge.handleImplementationArm("s-override", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-override",
      payload: {
        toolName: "task",
        toolInput: {
          agent: "hephaestus",
          skills: ["code-quality-reviewer"],
          prompt: "review the changes",
        },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected injection");
    expect(response.injectedContext).not.toContain("**AGENT**");
    expect(response.injectedContext).toContain("prometheus-wisdom");
    expect(response.injectedContext).not.toContain("hephaestus-wisdom");
  });

  it("falls back to loadSkills when skills array is empty and checks dominant_override", async () => {
    const reader = createMockFileReader({ "plan.md": plan });
    const writer = createMockFileWriter();
    const wisdomStore = new WisdomStore();
    const loopHandler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
    const bridge = new PlanBridge(reader, loopHandler, wisdomStore);

    wisdomStore.add(makeWisdomDraft({ content: "prometheus-wisdom", persona: "prometheus" }), {
      persona: "prometheus",
    });
    wisdomStore.add(makeWisdomDraft({ content: "hephaestus-wisdom", persona: "hephaestus" }), {
      persona: "hephaestus",
    });

    await bridge.handleImplementationArm("s-fallback", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-fallback",
      payload: {
        toolName: "task",
        toolInput: {
          agent: "hephaestus",
          skills: [],
          loadSkills: ["code-quality-reviewer"],
          prompt: "review the changes",
        },
      },
    });

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected injection");
    expect(response.injectedContext).not.toContain("**AGENT**");
    expect(response.injectedContext).toContain("prometheus-wisdom");
    expect(response.injectedContext).not.toContain("hephaestus-wisdom");
  });
});
