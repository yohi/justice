import { describe, expect, it } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type { FileReader, HookEvent } from "../../src/core/types";
import { createMockFileSystem } from "../helpers/mock-file-system";
import {
  createTestReviewGateCoordinator,
  parsePacketPayload,
} from "../helpers/review-gate-coordinator";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const FILES = new Map<string, string>([
  [DESIGN_PATH, "# Design\nReviewed behavior\n"],
  [PLAN_PATH, "## Task 1: Setup\n- [ ] Do the work\n"],
]);

function fileReader(): FileReader {
  return {
    readFile: async (path) => {
      const content = FILES.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    fileExists: async (path) => FILES.has(path),
    listFiles: async () => [...FILES.keys()],
    readFileStats: async () => null,
  } as unknown as FileReader;
}

/**
 * JusticePlugin-driven Review Gate lock integration: the plugin creates the
 * PlanBridge in initialize(); the test replaces the graph coordinator with an
 * in-memory instance and drives the event-sourced protocol end to end.
 */
async function createLockedJustice(): Promise<{ readonly justice: JusticePlugin; readonly fs: ReturnType<typeof createMockFileSystem> }> {
  const fs = createMockFileSystem(Object.fromEntries(FILES));
  const justice = new JusticePlugin(fileReader(), fs, {
    writerId: "writer-it-lock",
  });
  await justice.initialize();
  justice
    .getPlanBridge()
    .setReviewGateCoordinator(
      createTestReviewGateCoordinator({
        files: FILES,
        mutationSubstrate: {
          commitArtifact: async () => ({ commitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }),
          restoreArtifact: async () => {},
        },
      }),
    );
  return { justice, fs };
}

async function startGate(justice: JusticePlugin, sessionId: string): Promise<string> {
  const started = await justice
    .getPlanBridge()
    .handleReviewGateStart(sessionId, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      retryBudget: 0,
    });
  if (started.reviewerPrompt === undefined) throw new Error(started.guidance);
  return started.reviewerPrompt;
}

function claimEvent(sessionId: string, callId: string, prompt: string): HookEvent {
  return {
    type: "PreToolUse",
    sessionId,
    callId,
    payload: { toolName: "task", callId, toolInput: { prompt } },
  };
}

async function claimAndSubmit(
  justice: JusticePlugin,
  callId: string,
  workerPrompt: string,
  buildResult: (payload: Record<string, unknown>) => unknown,
): Promise<unknown> {
  const parent = "main";
  await justice.handleEvent(claimEvent(parent, callId, workerPrompt));
  const payload = parsePacketPayload(workerPrompt);
  return justice.handleEvent({
    type: "PostToolUse",
    sessionId: `${callId}-worker`,
    callId,
    payload: {
      toolName: "task",
      callId,
      toolResult: JSON.stringify(buildResult(payload)),
      error: false,
    },
  } as HookEvent);
}

describe("Review Gate implementation lock integration", () => {
  it("cancels implementation tasks after a clear result while allowing skill loading and reads", async () => {
    const { justice } = await createLockedJustice();
    const reviewerPrompt = await startGate(justice, "main");
    const framing = await claimAndSubmit(justice, "review-1", reviewerPrompt, () => ({
      schemaVersion: 1,
      candidates: [],
    }));
    expect(framing).toMatchObject({ action: "inject" });

    const taskResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "implementation-task-call",
      payload: {
        toolName: "task",
        callId: "implementation-task-call",
        toolInput: { task_id: "task-impl", prompt: "implement the plan" },
      },
    });
    const skillResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "implementation-skill-call",
      payload: { toolName: "skill", toolInput: { name: "executing-plans" } },
    });
    const readResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "main",
      callId: "read-call",
      payload: { toolName: "read", toolInput: { filePath: PLAN_PATH } },
    });

    expect(taskResponse).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
    });
    expect(skillResponse).toEqual({ action: "proceed" });
    expect(readResponse).toEqual({ action: "proceed" });
  });

  it("keeps ordinary implementation locked in descendant of the gated session before any worker returns", async () => {
    const { justice } = await createLockedJustice();
    await startGate(justice, "main");
    const descendantResponse = await justice.handleEvent({
      type: "PreToolUse",
      sessionId: "descendant-agent",
      lockOwnerSessionId: "main",
      callId: "descendant-task-call",
      payload: {
        toolName: "task",
        callId: "descendant-task-call",
        toolInput: { prompt: "implement the plan" },
      },
    });
    expect(descendantResponse).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
    });
  });

  it("rejects a forged completion whose worker call was never claimed", async () => {
    const { justice } = await createLockedJustice();
    await startGate(justice, "main");
    const bogus = await justice.handleEvent({
      type: "PostToolUse",
      sessionId: "unrelated-worker",
      callId: "call-never-claimed",
      payload: {
        toolName: "task",
        callId: "call-never-claimed",
        toolResult: JSON.stringify({ schemaVersion: 1, complete: true, findings: [] }),
        error: false,
      },
    });
    expect(bogus).toMatchObject({ action: "proceed" });
    expect(justice.getPlanBridge().hasPendingPlanReviewGate("main")).toBe(true);
  });
});
