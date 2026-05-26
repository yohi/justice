import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";
import { WisdomStore } from "../../src/core/wisdom-store";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { createMockNotifier } from "../helpers/mock-notifier";

const plan = ["## Task 1: Implement API", "- [ ] Build the implementation"].join("\n");

describe("Atlas orchestration integration flow", () => {
  it("injects Atlas guidance after writing-plans and then injects atlas-scoped wisdom", async () => {
    const reader = createMockFileReader({ "plan.md": plan });
    const writer = createMockFileWriter();
    const wisdomStore = new WisdomStore();
    const notifier = createMockNotifier();
    const loopHandler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
    const bridge = new PlanBridge(reader, loopHandler, wisdomStore, notifier);

    bridge.setActivePlan("s-atlas", "plan.md");
    await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-atlas",
      callId: "c-writing",
      payload: {
        toolName: "task",
        toolInput: { skills: ["writing-plans"], prompt: "write the implementation plan" },
      },
    });

    const post = await bridge.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "s-atlas",
      callId: "c-writing",
      payload: {
        toolName: "task",
        toolResult:
          "docs/superpowers/specs/2026-05-21-feature-design.md\n## Architecture\n## Implementation",
        error: false,
      },
    });

    expect(post.action).toBe("inject");
    if (post.action !== "inject") throw new Error("expected Atlas injection");
    expect(post.injectedContext).toContain("🎯");
    expect(post.injectedContext).toContain("Atlas Orchestration");
    expect(post.injectedContext).toContain("hephaestus");
    expect(notifier.calls.filter((call) => call.variant === "atlas_orchestration")).toHaveLength(1);
    expect(post.injectedContext.startsWith(notifier.banners[notifier.banners.length - 1])).toBe(
      true,
    );

    wisdomStore.add(
      {
        taskId: "task-atlas",
        category: "design_decision",
        content: "Atlas says preserve the adapter boundary.",
        persona: "atlas",
      },
      { persona: "atlas" },
    );

    const next = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "s-atlas",
      callId: "c-next",
      payload: {
        toolName: "task",
        toolInput: { agent: "atlas", prompt: "delegate next task" },
      },
    });

    expect(next.action).toBe("inject");
    if (next.action !== "inject") throw new Error("expected next task injection");
    expect(next.injectedContext).toContain("PREVIOUS LEARNINGS");
    expect(next.injectedContext).toContain("Atlas says preserve the adapter boundary.");
  });
});
