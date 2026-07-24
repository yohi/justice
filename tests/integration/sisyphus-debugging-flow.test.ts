import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";
import { WisdomStore } from "../../src/core/wisdom-store";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { createMockNotifier } from "../helpers/mock-notifier";

const plan = ["## Task 1: Debug queue", "- [ ] Find the root cause"].join("\n");

describe("Sisyphus debugging integration flow", () => {
  it("saves Root cause output into the Sisyphus namespace and injects insight banner", async () => {
    const { response, wisdomStore, notifier } = await runDebuggingFlow(
      "Root cause: race condition in queue handler",
    );

    expect(response.action).toBe("inject");
    if (response.action !== "inject") throw new Error("expected Sisyphus insight injection");
    expect(response.injectedContext).toContain("🔬");
    expect(response.injectedContext.startsWith(notifier.banners.at(-1)!)).toBe(true);

    const entries = wisdomStore.getRelevant({ persona: "sisyphus" });
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.some((entry) => entry.content.includes("race condition in queue handler"))).toBe(
      true,
    );
    expect(entries.some((entry) => entry.category === "design_decision")).toBe(true);
    expect(notifier.calls.filter((call) => call.variant === "sisyphus_insight")).toHaveLength(1);
  });

  it("also handles Japanese root-cause markers", async () => {
    const { wisdomStore, notifier } = await runDebuggingFlow("根本原因: キュー処理の競合状態");

    const entries = wisdomStore.getRelevant({ persona: "sisyphus" });
    expect(entries.some((entry) => entry.content.includes("キュー処理の競合状態"))).toBe(true);
    expect(entries.some((entry) => entry.category === "design_decision")).toBe(true);
    expect(notifier.calls.filter((call) => call.variant === "sisyphus_insight")).toHaveLength(1);
  });
});

async function runDebuggingFlow(toolResult: string): Promise<{
  readonly response: Awaited<ReturnType<PlanBridge["handlePostToolUse"]>>;
  readonly wisdomStore: WisdomStore;
  readonly notifier: ReturnType<typeof createMockNotifier>;
}> {
  const reader = createMockFileReader({ "plan.md": plan });
  const writer = createMockFileWriter();
  const wisdomStore = new WisdomStore();
  const notifier = createMockNotifier();
  const loopHandler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
  const bridge = new PlanBridge(reader, loopHandler, wisdomStore, notifier);

  bridge.setActivePlan("s-debug", "plan.md");
  await bridge.handlePreToolUse({
    type: "PreToolUse",
    sessionId: "s-debug",
    callId: "c-debug",
    payload: {
      toolName: "task",
      toolInput: { skills: ["systematic-debugging"], prompt: "debug the queue" },
    },
  });

  const response = await bridge.handlePostToolUse({
    type: "PostToolUse",
    sessionId: "s-debug",
    callId: "c-debug",
    payload: { toolName: "task", toolResult, error: false },
  });

  return { response, wisdomStore, notifier };
}
