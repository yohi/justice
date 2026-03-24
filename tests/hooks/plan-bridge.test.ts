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

describe("PlanBridge", () => {
  describe("handleMessage", () => {
    it("should detect plan reference and return delegation request", async () => {
      const reader = createMockFileReader({
        "docs/plans/sample-plan.md": samplePlan,
      });
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Delegate the next task from docs/plans/sample-plan.md",
        },
        sessionId: "s-1",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("inject");
      expect(response.injectedContext).toContain("Setup project structure");
    });

    it("should return proceed when no plan reference found", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Hello, just chatting",
        },
        sessionId: "s-2",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
    });

    it("should return proceed when plan file does not exist", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Delegate task from docs/plans/nonexistent-plan.md",
        },
        sessionId: "s-3",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
    });

    it("should return proceed when all tasks are completed", async () => {
      const reader = createMockFileReader({
        "plan.md": "## Task 1: Done\n- [x] Step 1\n- [x] Step 2\n",
      });
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "assistant",
          content: "Run next task from plan.md",
        },
        sessionId: "s-4",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
      expect(response.injectedContext).toContain("completed");
    });

    it("should ignore user messages", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<MessagePayload> = {
        type: "Message",
        payload: {
          role: "user",
          content: "Delegate next task from plan.md",
        },
        sessionId: "s-5",
      };

      const response = await bridge.handleMessage(event);
      expect(response.action).toBe("proceed");
    });
  });

  describe("handlePreToolUse", () => {
    it("should inject plan context when task() is about to be called", async () => {
      const reader = createMockFileReader({
        "docs/plans/sample-plan.md": samplePlan,
      });
      const bridge = new PlanBridge(reader);

      // Set the active plan via setter
      bridge.setActivePlan("docs/plans/sample-plan.md");

      const event: HookEvent<PreToolUsePayload> = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { prompt: "do something" },
        },
        sessionId: "s-6",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("inject");
      expect(response.injectedContext).toBeDefined();
    });

    it("should proceed when non-task tool is used", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<PreToolUsePayload> = {
        type: "PreToolUse",
        payload: {
          toolName: "bash",
          toolInput: { command: "ls" },
        },
        sessionId: "s-7",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("proceed");
    });

    it("should proceed when no active plan is set", async () => {
      const reader = createMockFileReader({});
      const bridge = new PlanBridge(reader);

      const event: HookEvent<PreToolUsePayload> = {
        type: "PreToolUse",
        payload: {
          toolName: "task",
          toolInput: { prompt: "do something" },
        },
        sessionId: "s-8",
      };

      const response = await bridge.handlePreToolUse(event);
      expect(response.action).toBe("proceed");
    });
  });
});
