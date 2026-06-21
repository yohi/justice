import { describe, expect, it } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { LoopDetectionHandler } from "../../src/hooks/loop-handler";
import { TaskSplitter } from "../../src/core/task-splitter";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";
import { createMockNotifier } from "../helpers/mock-notifier";

const plan = ["## Task 1: Review implementation", "- [ ] Address architecture feedback"].join("\n");

describe("Review rejection pivot integration flow", () => {
  it("pivots to Hephaestus after three Prometheus review rejections", async () => {
    const reader = createMockFileReader({ "plan.md": plan });
    const writer = createMockFileWriter();
    const loopHandler = new LoopDetectionHandler(reader, writer, new TaskSplitter());
    const notifier = createMockNotifier();
    const bridge = new PlanBridge(reader, loopHandler, undefined, notifier);
    bridge.setActivePlan("s-pivot", "plan.md");

    const results = [];
    for (const callId of ["c-1", "c-2", "c-3"]) {
      await bridge.handlePreToolUse({
        type: "PreToolUse",
        sessionId: "s-pivot",
        callId,
        payload: {
          toolName: "task",
          toolInput: { agent: "prometheus", skills: ["code-quality-reviewer"] },
        },
      });
      results.push(
        await bridge.handlePostToolUse({
          type: "PostToolUse",
          sessionId: "s-pivot",
          callId,
          payload: {
            toolName: "task",
            toolResult: `BLOCKER: rejected architecture pass ${callId}`,
            error: false,
          },
        }),
      );
    }

    expect(notifier.calls.filter((call) => call.variant === "architecture_pivot")).toHaveLength(1);
    expect(results[0]?.action).toBe("proceed");
    expect(results[1]?.action).toBe("proceed");
    expect(results[2]?.action).toBe("inject");
    const third = results[2];
    if (third?.action !== "inject") throw new Error("expected pivot injection");
    expect(third.injectedContext).toContain("🚧");
    expect(third.injectedContext).toContain("Hephaestus");
    expect(third.injectedContext.startsWith(notifier.banners.at(-1)!)).toBe(
      true,
    );

    const history = loopHandler.getTrialHistory("s-pivot", "task-1");
    expect(history).toHaveLength(3);
    expect(history.every((record) => record.agent === "prometheus")).toBe(true);
    expect(history.every((record) => record.result === "failure")).toBe(true);
  });
});
