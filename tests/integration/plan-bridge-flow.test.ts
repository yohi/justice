import { describe, it, expect, vi } from "vitest";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import type {
  FileReader,
  HookEvent,
  MessagePayload,
  PreToolUsePayload,
} from "../../src/core/types";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

// ESM dirname resolution
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure the fixtures directory exists
const fixturesDir = resolve(__dirname, "../fixtures");
if (!existsSync(fixturesDir)) {
  mkdirSync(fixturesDir, { recursive: true });
}

const samplePlanPath = resolve(fixturesDir, "sample-plan.md");
const samplePlanContent = [
  "## Setup",
  "- [x] Create project",
  "- [ ] Setup project structure",
].join("\n");

if (!existsSync(samplePlanPath)) {
  writeFileSync(samplePlanPath, samplePlanContent, "utf-8");
}

const samplePlan = readFileSync(samplePlanPath, "utf-8");

function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    }),
    fileExists: vi.fn(async (path: string) => path in files),
  };
}

describe("Plan Bridge Integration Flow", () => {
  it("should complete full Message → Delegation flow", async () => {
    const planPath = "docs/plans/sample-plan.md";
    const reader = createMockFileReader({ [planPath]: samplePlan });
    const bridge = new PlanBridge(reader);

    // Step 1: Agent sends message referencing the plan
    const messageEvent: HookEvent<MessagePayload> = {
      type: "Message",
      payload: {
        role: "assistant",
        content: `I'll delegate the next task from ${planPath}`,
      },
      sessionId: "integration-1",
    };

    const messageResponse = await bridge.handleMessage(messageEvent);
    expect(messageResponse.action).toBe("inject");
    expect(messageResponse.injectedContext).toContain(
      "Task Delegation Context",
    );
    expect(messageResponse.injectedContext).toContain("Setup project structure");

    // Step 2: Verify active plan was set
    expect(bridge.getActivePlan()).toBe(planPath);

    // Step 3: task() is about to be called, inject context
    const toolEvent: HookEvent<PreToolUsePayload> = {
      type: "PreToolUse",
      payload: {
        toolName: "task",
        toolInput: { prompt: "implement feature" },
      },
      sessionId: "integration-1",
    };

    const toolResponse = await bridge.handlePreToolUse(toolEvent);
    expect(toolResponse.action).toBe("inject");
    expect(toolResponse.injectedContext).toContain("Setup project structure");
  });

  it("should handle partial progress plan correctly", async () => {
    const planPath = "plan.md";
    const partialPlan = [
      "## Task 1: Done",
      "- [x] All complete",
      "## Task 2: Next",
      "- [ ] First step",
      "- [ ] Second step",
      "## Task 3: Later",
      "- [ ] Future step",
    ].join("\n");

    const reader = createMockFileReader({ [planPath]: partialPlan });
    const bridge = new PlanBridge(reader);

    const event: HookEvent<MessagePayload> = {
      type: "Message",
      payload: {
        role: "assistant",
        content: `Execute the next task from ${planPath}`,
      },
      sessionId: "integration-2",
    };

    const response = await bridge.handleMessage(event);
    expect(response.action).toBe("inject");
    expect(response.injectedContext).toContain("First step");
    // Task 1 is completed, so should delegate Task 2
    expect(response.injectedContext).not.toContain(
      "All complete",
    );
  });

  it("should gracefully handle read errors", async () => {
    const reader: FileReader = {
      readFile: vi.fn(async () => {
        throw new Error("Permission denied");
      }),
      fileExists: vi.fn(async () => true),
    };
    const bridge = new PlanBridge(reader);

    const event: HookEvent<MessagePayload> = {
      type: "Message",
      payload: {
        role: "assistant",
        content: "Delegate task from plan.md",
      },
      sessionId: "integration-3",
    };

    // Should throw since readFile fails
    await expect(bridge.handleMessage(event)).rejects.toThrow(
      "Permission denied",
    );
  });
});
