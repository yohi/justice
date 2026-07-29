import { describe, expect, it, vi } from "vitest";
import type { JusticePlugin } from "../../src/core/justice-plugin";
import type {
  PersistedLogRecord,
  WorkflowBootstrapAudit,
} from "../../src/core/v2/observation-model";
import {
  OpenCodeAdapter,
  type CommandExecuteBeforeOutput,
} from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem, type MockFileSystem } from "../helpers/mock-file-system";

/**
 * The adapter builds its own NodeFileSystem from the workspace root during lazy init,
 * so the class is redirected to the shared in-memory mock. That keeps the real hook
 * wiring (command hook → PlanBridge → ObservationHandler) intact while guaranteeing
 * the suite never touches the real disk.
 */
let mockFs: MockFileSystem;
vi.mock("../../src/runtime/node-file-system", () => ({
  // A `function` rather than an arrow, so `new NodeFileSystem(root)` stays constructible.
  NodeFileSystem: function NodeFileSystemMock(): MockFileSystem {
    return mockFs;
  },
}));

/**
 * `createGlobalFs` mkdir()s the global wisdom directory before wrapping it in a
 * NodeFileSystem; stubbing that single syscall keeps the global store in memory too.
 */
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdir: vi.fn(async () => undefined) };
});

const PLAN_PATH = "docs/plans/sample-plan.md";
const DESIGN_PATH = "docs/design/sample-design.md";
const MISSING_PLAN_PATH = "docs/plans/missing-plan.md";
const MISSING_DESIGN_PATH = "docs/design/missing-design.md";

const planContent = [
  "## Task 1: Setup",
  "- [x] Create project",
  "- [ ] Setup project structure",
].join("\n");

const designContent = ["## Architecture", "The adapter boundary stays intact."].join("\n");

/** Observation half of the persisted log union; decisions are irrelevant here. */
type ObservationLogRecord = Extract<PersistedLogRecord, { readonly recordType: "observation" }>;

interface Harness {
  readonly adapter: OpenCodeAdapter;
  readonly justice: JusticePlugin;
  /** Watches the assistant-message entry point for the whole flow (see below). */
  readonly handleMessage: ReturnType<typeof vi.spyOn>;
}

async function createHarness(): Promise<Harness> {
  mockFs = createMockFileSystem({
    [PLAN_PATH]: planContent,
    [DESIGN_PATH]: designContent,
  });

  const adapter = new OpenCodeAdapter(fakeInit());
  await adapter.ensureInitialized();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("expected Justice to initialize");

  // A plan activated by /justice-start must never depend on an assistant message
  // echo, so the legacy Message path is spied on and asserted to stay untouched.
  const handleMessage = vi.spyOn(justice.getPlanBridge(), "handleMessage");
  return { adapter, justice, handleMessage };
}

async function armImplementation(
  adapter: OpenCodeAdapter,
  sessionID: string,
  planPath: string,
): Promise<CommandExecuteBeforeOutput> {
  const output: CommandExecuteBeforeOutput = { parts: [] };
  await adapter.onCommandExecuteBefore(
    { command: "/justice-implement", sessionID, arguments: `--plan ${planPath} --approved` },
    output,
  );
  return output;
}

async function startWorkflow(
  adapter: OpenCodeAdapter,
  sessionID: string,
  commandArguments: string,
): Promise<CommandExecuteBeforeOutput> {
  const output: CommandExecuteBeforeOutput = { parts: [] };
  await adapter.onCommandExecuteBefore(
    { command: "/justice-start", sessionID, arguments: commandArguments },
    output,
  );
  return output;
}

function workflowGuidance(
  output: CommandExecuteBeforeOutput,
  automatedInstruction: string,
): string {
  expect(output.parts).toHaveLength(1);
  const part = output.parts[0] as unknown as {
    readonly type: string;
    readonly text: string;
    readonly synthetic?: boolean;
  };
  expect(part.type).toBe("text");
  expect(part.synthetic).toBe(true);
  expect(part.text).toContain(automatedInstruction);
  return part.text;
}

async function callTaskTool(
  adapter: OpenCodeAdapter,
  sessionID: string,
  callID: string,
  prompt: string,
): Promise<{ args: Record<string, unknown> }> {
  const output: { args: Record<string, unknown> } = { args: { prompt } };
  await adapter.onToolExecuteBefore({ tool: "task", sessionID, callID }, output);
  return output;
}

async function observationRecordsFor(
  justice: JusticePlugin,
  sessionId: string,
): Promise<readonly ObservationLogRecord[]> {
  const records = await justice.getObservationHandler().getLogStore().readAll();
  return records.filter(
    (record): record is ObservationLogRecord =>
      record.recordType === "observation" && record.sessionId === sessionId,
  );
}

/** `workflow` only exists on the bootstrap variants; read it through `unknown` (AGENTS.md). */
function workflowAuditOf(
  record: ObservationLogRecord | undefined,
): WorkflowBootstrapAudit | undefined {
  return (record as unknown as { readonly workflow?: WorkflowBootstrapAudit } | undefined)
    ?.workflow;
}

describe("Justice workflow bootstrap integration flow", () => {
  it("activates a readable plan and injects task context without an assistant message echo", async () => {
    const { adapter, justice, handleMessage } = await createHarness();
    const sessionId = "s-plan-ready";

    const output = await startWorkflow(
      adapter,
      sessionId,
      `--plan ${PLAN_PATH} ship the bootstrap`,
    );
    const guidance = workflowGuidance(output, "AIレビューを依頼してください");

    expect(guidance).toContain("[JUSTICE: Workflow Bootstrap]");
    expect(guidance).toContain("[JUSTICE: PLAN REVIEW REQUIRED]");
    expect(guidance).toContain("**Phase**: plan_ready");
    expect(guidance).toContain('**Goal (untrusted user input)**: "ship the bootstrap"');
    expect(guidance).toContain(PLAN_PATH);
    expect(justice.getPlanBridge().getActivePlan(sessionId)).toBe(PLAN_PATH);
    expect(output.parts).toHaveLength(1);

    const records = await observationRecordsFor(justice, sessionId);
    expect(records.map((record) => record.kind)).toEqual(["workflow_started", "plan_activated"]);
    expect(workflowAuditOf(records[1])).toMatchObject({
      phase: "plan_ready",
      directiveStage: "plan_review_required",
      source: "command",
      planPath: PLAN_PATH,
    });
    // Audit-only: a bootstrap record must never open a task window (FF-008).
    expect(records.every((record) => record.taskId === undefined)).toBe(true);
    expect(justice.getPlanBridge().isImplementationArmed(sessionId)).toBe(false);
    // Arm the session explicitly before the first implementation task.
    await armImplementation(adapter, sessionId, PLAN_PATH);

    const task = await callTaskTool(adapter, sessionId, "c-plan-ready", "実装を進めてください");
    const prompt = task.args.prompt as string;

    expect(prompt).toContain("Task Delegation Context");
    expect(prompt).toContain("**Task ID**: task-1");
    expect(prompt).toContain(`**Plan File**: ${PLAN_PATH}`);
    expect(prompt).toContain("Setup project structure");
    expect(prompt).toContain("実装を進めてください");
    expect(task.args.loadSkills).toEqual([
      "test-driven-development",
      "verification-before-completion",
    ]);
    // The whole activation happened through the command hook only.
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it("preserves task arguments and exposes only the unauthorized advisory when not armed", async () => {
    const { adapter, justice } = await createHarness();
    const sessionId = "s-plan-ready-unarmed";
    await startWorkflow(adapter, sessionId, `--plan ${PLAN_PATH} ship the bootstrap`);
    let injectedContext = "";
    const bridge = justice.getPlanBridge();
    const handlePreToolUse = bridge.handlePreToolUse.bind(bridge);
    vi.spyOn(bridge, "handlePreToolUse").mockImplementation(async (event) => {
      const response = await handlePreToolUse(event);
      if (response.action === "inject") injectedContext = response.injectedContext;
      return response;
    });
    const originalArgs = {
      prompt: "実装を進めてください",
      loadSkills: ["caller-skill"],
      metadata: { source: "caller" },
    };
    const output: { args: Record<string, unknown> } = { args: originalArgs };

    await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: sessionId, callID: "c-plan-ready-unarmed" },
      output,
    );

    expect(injectedContext).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
    expect(injectedContext).not.toContain("Task Delegation Context");
    expect(output.args).toEqual({
      prompt: "実装を進めてください",
      loadSkills: ["caller-skill"],
      metadata: { source: "caller" },
    });
    expect(output.args).not.toHaveProperty("taskId");
  });

  it("stops at design_required and hands task() no plan context even when the plan is readable", async () => {
    const { adapter, justice, handleMessage } = await createHarness();
    const sessionId = "s-design-missing";

    const guidance = workflowGuidance(
      await startWorkflow(
        adapter,
        sessionId,
        `--design ${MISSING_DESIGN_PATH} --plan ${PLAN_PATH} ship the bootstrap`,
      ),
      "`brainstorming` を使い",
    );

    expect(guidance).toContain("[JUSTICE: Workflow Bootstrap]");
    expect(guidance).toContain("**Phase**: design_required");
    expect(guidance).toContain("brainstorming");
    expect(justice.getPlanBridge().getActivePlan(sessionId)).toBeNull();

    const records = await observationRecordsFor(justice, sessionId);
    expect(records.map((record) => record.kind)).toEqual(["workflow_started", "design_requested"]);
    expect(workflowAuditOf(records[1])).toMatchObject({
      phase: "design_required",
      designPath: MISSING_DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    const task = await callTaskTool(adapter, sessionId, "c-design-missing", "実装を進めてください");

    expect(task.args.prompt).toBe("実装を進めてください");
    expect(task.args).not.toHaveProperty("taskId");
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it("stops at plan_required and hands task() no plan context when the plan is unreadable", async () => {
    const { adapter, justice, handleMessage } = await createHarness();
    const sessionId = "s-plan-missing";

    const guidance = workflowGuidance(
      await startWorkflow(
        adapter,
        sessionId,
        `--design ${DESIGN_PATH} --plan ${MISSING_PLAN_PATH} ship the bootstrap`,
      ),
      "`writing-plans` を使い",
    );

    expect(guidance).toContain("[JUSTICE: Workflow Bootstrap]");
    expect(guidance).toContain("**Phase**: plan_required");
    expect(guidance).toContain("writing-plans");
    expect(justice.getPlanBridge().getActivePlan(sessionId)).toBeNull();

    const records = await observationRecordsFor(justice, sessionId);
    expect(records.map((record) => record.kind)).toEqual(["workflow_started", "plan_requested"]);
    expect(workflowAuditOf(records[1])).toMatchObject({
      phase: "plan_required",
      designPath: DESIGN_PATH,
      planPath: MISSING_PLAN_PATH,
    });

    const task = await callTaskTool(adapter, sessionId, "c-plan-missing", "実装を進めてください");

    expect(task.args.prompt).toBe("実装を進めてください");
    expect(task.args).not.toHaveProperty("taskId");
    expect(handleMessage).not.toHaveBeenCalled();
  });

  it("clears an already activated plan when a later bootstrap in the same session lacks its design", async () => {
    const { adapter, justice } = await createHarness();
    const sessionId = "s-restart";

    await startWorkflow(adapter, sessionId, `--plan ${PLAN_PATH} ship the bootstrap`);
    expect(justice.getPlanBridge().getActivePlan(sessionId)).toBe(PLAN_PATH);

    const guidance = workflowGuidance(
      await startWorkflow(
        adapter,
        sessionId,
        `--design ${MISSING_DESIGN_PATH} --plan ${PLAN_PATH} rework the design`,
      ),
      "`brainstorming` を使い",
    );

    expect(guidance).toContain("**Phase**: design_required");
    expect(justice.getPlanBridge().getActivePlan(sessionId)).toBeNull();

    const task = await callTaskTool(adapter, sessionId, "c-restart", "実装を進めてください");
    expect(task.args.prompt).toBe("実装を進めてください");
  });

  it("keeps bootstrap state isolated per session", async () => {
    const { adapter, justice } = await createHarness();

    await startWorkflow(adapter, "s-ready", `--plan ${PLAN_PATH} ship the bootstrap`);
    await startWorkflow(
      adapter,
      "s-blocked",
      `--design ${MISSING_DESIGN_PATH} --plan ${PLAN_PATH} ship the bootstrap`,
    );

    expect(justice.getPlanBridge().getActivePlan("s-ready")).toBe(PLAN_PATH);
    expect(justice.getPlanBridge().getActivePlan("s-blocked")).toBeNull();
    // Only the ready session is explicitly armed; blocked stays unauthorized.
    await armImplementation(adapter, "s-ready", PLAN_PATH);

    const blocked = await callTaskTool(adapter, "s-blocked", "c-blocked", "実装を進めてください");
    const ready = await callTaskTool(adapter, "s-ready", "c-ready", "実装を進めてください");

    expect(blocked.args.prompt).toBe("実装を進めてください");
    expect(ready.args.prompt).toContain(`**Plan File**: ${PLAN_PATH}`);
  });
});
