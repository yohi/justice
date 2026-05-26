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
    expect(response.injectedContext).toContain("atlas-1");
    expect(response.injectedContext).toContain("atlas-2");
    expect(response.injectedContext).not.toContain("hephaestus-1");
    expect(response.injectedContext).not.toContain("hephaestus-2");
    expect(response.injectedContext).not.toContain("hephaestus-3");
  });
});
