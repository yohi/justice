import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenCodeAdapter,
  type CommandExecuteBeforeOutput,
} from "../../src/runtime/opencode-adapter";
import { OpenCodeNotifier } from "../../src/runtime/opencode-notifier";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { fakeInit } from "../helpers/fake-opencode-init";

describe("OpenCodeAdapter skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs successfully when worktree is provided", () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
  });

  it("enters no-op mode when both worktree and directory are undefined", () => {
    const init = fakeInit({
      worktree: undefined,
      directory: undefined,
      project: { root: undefined },
    });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.isNoOp()).toBe(true);
  });

  it("falls back to directory when worktree is undefined", () => {
    const init = fakeInit({ worktree: undefined, directory: "/tmp/fallback" });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.isNoOp()).toBe(false);
    expect(adapter.getWorkspaceRoot()).toBe("/tmp/fallback");
  });

  it("prefers worktree over directory when both are set", () => {
    const init = fakeInit({ worktree: "/tmp/wt", directory: "/tmp/dir" });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.getWorkspaceRoot()).toBe("/tmp/wt");
  });

  it("lazy-initializes justice only once across multiple entries", async () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    const initSpy = vi.spyOn(JusticePlugin.prototype, "initialize");

    await adapter.ensureInitialized();
    await adapter.ensureInitialized();
    await adapter.ensureInitialized();

    expect(initSpy).toHaveBeenCalledTimes(1);
    initSpy.mockRestore();
  });

  it("wires OpenCodeNotifier into JusticePlugin during initialization", async () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const notifySpy = vi.spyOn(OpenCodeNotifier.prototype, "notify");
    const logSpy = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const adapter = new OpenCodeAdapter(init);

    await adapter.ensureInitialized();

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalled();
    notifySpy.mockRestore();
  });

  it("log wrapper invokes client.app.log and swallows thrown errors", async () => {
    const throwingLog = vi.fn().mockRejectedValue(new Error("log backend down"));
    const init = fakeInit({
      client: { app: { log: throwingLog } },
      worktree: "/tmp/ws",
      directory: "/tmp/ws",
    });
    const adapter = new OpenCodeAdapter(init);

    await expect(adapter.log("error", "boom")).resolves.toBeUndefined();
    expect(throwingLog).toHaveBeenCalledTimes(1);
  });

  it("no-op adapter never initializes justice", async () => {
    const init = fakeInit({
      worktree: undefined,
      directory: undefined,
      project: { root: undefined },
    });
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    expect(adapter.isNoOp()).toBe(true);
    expect(adapter.getJustice()).toBeNull();
  });
});

describe("OpenCodeAdapter.onEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes message.updated assistant events with content to JusticePlugin.handleEvent", async () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (!justice) throw new Error("justice should be initialized");
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: { role: "assistant", content: "plan.md の次のタスクを委譲して" },
        },
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: { role: "assistant", content: "plan.md の次のタスクを委譲して" },
    });
  });

  it("routes user messages message.updated events", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: { sessionID: "s", info: { role: "user", content: "hello" } },
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Message",
        sessionId: "s",
        payload: expect.objectContaining({
          role: "user",
          content: "hello",
        }),
      }),
    );
  });

  it("routes loop-like session.error events to observation and loop-detector Events", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "session.error",
        properties: { sessionID: "s", error: { message: "loop detected in planning" } },
      },
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toMatchObject({
      type: "Event",
      sessionId: "s",
      payload: {
        eventType: "session_error",
        sessionId: "s",
        message: "loop detected in planning",
      },
    });
    expect(spy.mock.calls[1][0]).toMatchObject({
      type: "Event",
      sessionId: "s",
      payload: {
        eventType: "loop-detector",
        sessionId: "s",
        message: "loop detected in planning",
      },
    });
  });

  it("routes non-loop session.error events to observation without logging", async () => {
    const init = fakeInit();
    const logSpy = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const adapter = new OpenCodeAdapter(init);
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleSpy = vi.spyOn(justice, "handleEvent");
    logSpy.mockClear();

    await adapter.onEvent({
      event: {
        type: "session.error",
        properties: {
          sessionID: "s",
          error: { name: "ProviderTimeoutError", message: "timeout while calling provider" },
        },
      },
    });

    expect(handleSpy).toHaveBeenCalledWith({
      type: "Event",
      sessionId: "s",
      payload: {
        eventType: "session_error",
        sessionId: "s",
        message: "timeout while calling provider",
        kind: "ProviderTimeoutError",
      },
    });
    expect(logSpy).not.toHaveBeenCalledWith(expect.objectContaining({ level: "error" }));
  });

  it("still dispatches loop detection when session-error observation fails", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleSpy = vi
      .spyOn(justice, "handleEvent")
      .mockRejectedValueOnce(new Error("observation failure"))
      .mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "session.error",
        properties: { sessionID: "s", error: { message: "loop detected in planning" } },
      },
    });

    expect(handleSpy).toHaveBeenCalledTimes(2);
    expect(handleSpy.mock.calls[1][0]).toMatchObject({
      type: "Event",
      payload: { eventType: "loop-detector", sessionId: "s" },
    });
  });

  it("fails open when event handling throws", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockRejectedValue(new Error("boom"));

    await expect(
      adapter.onEvent({
        event: {
          type: "session.error",
          properties: { sessionID: "s", error: { message: "loop detected" } },
        },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("OpenCodeAdapter.onToolExecuteBefore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts task tool invocations into PreToolUseEvent", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteBefore(
      {
        tool: "task",
        sessionID: "s",
        callID: "c1",
      },
      { args: { prompt: "do a thing" } },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "PreToolUse",
      sessionId: "s",
      payload: { toolName: "task", toolInput: { prompt: "do a thing" } },
    });
  });

  it("skips justice_* query tools (D50: must not perturb the Observation Log)", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onToolExecuteBefore(
      { tool: "justice_status", sessionID: "s", callID: "c1" },
      { args: {} },
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it("prepends injected context to output.args.prompt and merges other args", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "[PLAN]",
      modifiedPayload: { args: { loadSkills: ["a", "b"] } },
    });

    const output = { args: { prompt: "original", loadSkills: [] as string[] } };
    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "c1" }, output);

    expect(output.args.prompt.startsWith("[PLAN]")).toBe(true);
    expect(output.args.prompt.endsWith("original")).toBe(true);
    expect(output.args.loadSkills).toEqual(["a", "b"]);
  });

  it("prepends unauthorized advisory without modifying other output args", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "[JUSTICE: IMPLEMENTATION UNAUTHORIZED] approval required",
    });

    const output = { args: { prompt: "original", existing: "unchanged" } };
    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "c1" }, output);

    expect(output.args.prompt).toBe(
      "[JUSTICE: IMPLEMENTATION UNAUTHORIZED] approval required\n\noriginal",
    );
    expect(output.args).toEqual({
      prompt: "[JUSTICE: IMPLEMENTATION UNAUTHORIZED] approval required\n\noriginal",
      existing: "unchanged",
    });
  });
});

describe("OpenCodeAdapter.onToolExecuteAfter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts task tool results into PostToolUseEvent with error=false on success", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteAfter(
      { tool: "task", sessionID: "s", callID: "c1", args: { prompt: "p" } },
      { output: "result body", metadata: undefined },
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "PostToolUse",
      sessionId: "s",
      payload: { toolName: "task", toolResult: "result body", error: false },
    });
  });

  it("sets error=true when output metadata includes error", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteAfter(
      { tool: "task", sessionID: "s", callID: "c1", args: { prompt: "p" } },
      { output: "stack trace...", metadata: { error: true } },
    );

    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "PostToolUse",
      payload: { toolName: "task", toolResult: "stack trace...", error: true },
    });
  });
});

describe("OpenCodeAdapter.onSessionCompacting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts compaction inputs into EventEvent with eventType=compaction", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onSessionCompacting({ sessionID: "s" }, { context: [], prompt: undefined });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "Event",
      sessionId: "s",
      payload: { eventType: "compaction", sessionId: "s", reason: "" },
    });
  });

  it("pushes snapshot to output.context on inject response", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "snapshot-body",
    });

    const output = { context: [] as string[], prompt: undefined as string | undefined };
    await adapter.onSessionCompacting({ sessionID: "s" }, output);
    expect(output.context).toEqual(["snapshot-body"]);
  });
});

describe("OpenCodeAdapter.getTools", () => {
  it("returns only the public justice_review tool", () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    const tools = adapter.getTools();

    expect(Object.keys(tools)).toEqual(["justice_review"]);
    expect(tools.justice_review?.description).toContain("Review Summary Artifact");
    expect(typeof tools.justice_review?.execute).toBe("function");
  });

  it("never registers an additional public tool for the workflow start command (D50)", () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    const toolNames = Object.keys(adapter.getTools());

    expect(toolNames).toHaveLength(1);
    expect(toolNames).not.toContain("justice_status");
    expect(toolNames).not.toContain("justice_gate");
    expect(toolNames.filter((name) => name !== "justice_review")).toEqual([]);
  });
});

describe("OpenCodeAdapter.onCommandExecuteBefore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The SDK does not document whether `input.command` carries a leading slash, so both
  // spellings must activate the workflow (matching isJusticeStartCommand in Todo1).
  it.each(["justice-start", "/justice-start"])(
    "appends the bootstrap guidance as a synthetic text part for %s",
    async (command) => {
      const adapter = new OpenCodeAdapter(fakeInit());
      await adapter.ensureInitialized();
      const justice = adapter.getJustice() as JusticePlugin;
      const handleWorkflowStart = vi
        .spyOn(justice.getPlanBridge(), "handleWorkflowStart")
        .mockResolvedValue({
          phase: "plan_ready",
          goal: "ship the feature",
          nextSkill: null,
          activePlanPath: "plan.md",
          guidance: "[JUSTICE: Workflow Bootstrap] plan_ready",
        });

      const output: CommandExecuteBeforeOutput = { parts: [] };
      await adapter.onCommandExecuteBefore(
        { command, sessionID: "sess-cmd", arguments: "--plan plan.md ship the feature" },
        output,
      );

      expect(handleWorkflowStart).toHaveBeenCalledWith("sess-cmd", {
        source: "command",
        goal: "ship the feature",
        designPath: null,
        planPath: "plan.md",
      });
      expect(output.parts).toHaveLength(1);
      expect(output.parts[0]).toMatchObject({
        sessionID: "sess-cmd",
        type: "text",
        text: "[JUSTICE: Workflow Bootstrap] plan_ready",
        synthetic: true,
      });
      const [part] = output.parts;
      expect(typeof part?.id).toBe("string");
      expect(part?.id.length).toBeGreaterThan(0);
      expect(typeof (part as { messageID?: unknown }).messageID).toBe("string");
    },
  );

  it("does not emit workflow observations from the adapter; PlanBridge owns them", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice.getPlanBridge(), "handleWorkflowStart").mockResolvedValue({
      phase: "plan_required",
      goal: "ship it",
      nextSkill: "writing-plans",
      activePlanPath: null,
      guidance: "plan_required guidance",
    });
    const observation = justice.getObservationHandler();
    const started = vi.spyOn(observation, "emitWorkflowStartedEvent");
    const phase = vi.spyOn(observation, "emitWorkflowPhaseEvent");

    const output: CommandExecuteBeforeOutput = { parts: [] };
    await adapter.onCommandExecuteBefore(
      { command: "justice-start", sessionID: "sess-obs", arguments: "ship it" },
      output,
    );

    expect(started).not.toHaveBeenCalled();
    expect(phase).not.toHaveBeenCalled();
    expect(output.parts).toHaveLength(1);
  });

  it("injects implementation arm guidance for /justice-implement", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleImplementationArm = vi
      .spyOn(justice.getPlanBridge(), "handleImplementationArm")
      .mockResolvedValue({
        armed: true,
        planPath: "plan.md",
        directiveStage: "implementation_arm",
        guidance: "[JUSTICE: IMPLEMENTATION ARMED]",
      });
    const output: CommandExecuteBeforeOutput = { parts: [] };

    await adapter.onCommandExecuteBefore(
      {
        command: "justice-implement",
        arguments: "--plan plan.md --approved",
        sessionID: "session-1",
      },
      output,
    );

    expect(handleImplementationArm).toHaveBeenCalledWith("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).toMatchObject({ text: "[JUSTICE: IMPLEMENTATION ARMED]" });
  });

  it("fails open for /justice-implement when lazy initialization leaves justice unavailable", async () => {
    const init = fakeInit();
    const logSpy = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const initialize = vi
      .spyOn(JusticePlugin.prototype, "initialize")
      .mockRejectedValueOnce(new Error("initialization failed"));
    const adapter = new OpenCodeAdapter(init);
    const output: CommandExecuteBeforeOutput = { parts: [] };

    await expect(
      adapter.onCommandExecuteBefore(
        {
          command: "justice-implement",
          arguments: "--plan plan.md --approved",
          sessionID: "session-init-failure",
        },
        output,
      ),
    ).resolves.toBeUndefined();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(adapter.getJustice()).toBeNull();
    expect(output.parts).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", message: "[Justice] lazy init failed" }),
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "[Justice] onCommandExecuteBefore failure" }),
    );
    initialize.mockRestore();
  });

  it("ignores malformed /justice-implement arguments", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleImplementationArm = vi.spyOn(justice.getPlanBridge(), "handleImplementationArm");
    const output: CommandExecuteBeforeOutput = { parts: [] };

    await adapter.onCommandExecuteBefore(
      {
        command: "justice-implement",
        arguments: "--approved",
        sessionID: "session-1",
      },
      output,
    );

    expect(handleImplementationArm).not.toHaveBeenCalled();
    expect(output.parts).toHaveLength(0);
  });

  it("still appends the guidance part when PlanBridge handles observation failures internally", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice.getPlanBridge(), "handleWorkflowStart").mockResolvedValue({
      phase: "design_required",
      goal: "ship it",
      nextSkill: "brainstorming",
      activePlanPath: null,
      guidance: "design_required guidance",
    });
    const observation = justice.getObservationHandler();
    const started = vi.spyOn(observation, "emitWorkflowStartedEvent");

    const output: CommandExecuteBeforeOutput = { parts: [] };
    await expect(
      adapter.onCommandExecuteBefore(
        { command: "justice-start", sessionID: "sess-obs-fail", arguments: "ship it" },
        output,
      ),
    ).resolves.toBeUndefined();

    expect(started).not.toHaveBeenCalled();
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).toMatchObject({ text: "design_required guidance" });
  });

  it("leaves output.parts untouched for a non-Justice command", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    const output: CommandExecuteBeforeOutput = { parts: [] };

    await adapter.onCommandExecuteBefore(
      { command: "other-command", sessionID: "sess-other", arguments: "--plan plan.md goal" },
      output,
    );

    expect(output.parts).toEqual([]);
    // A non-Justice command must not even trigger lazy initialization.
    expect(adapter.getJustice()).toBeNull();
  });

  it.each(["--plan", "--plan /etc/passwd goal", "--unknown-flag goal", ""])(
    "fails open without throwing or mutating state for malformed arguments %j",
    async (rawArguments) => {
      const adapter = new OpenCodeAdapter(fakeInit());
      await adapter.ensureInitialized();
      const justice = adapter.getJustice() as JusticePlugin;
      const handleWorkflowStart = vi.spyOn(justice.getPlanBridge(), "handleWorkflowStart");
      const output: CommandExecuteBeforeOutput = { parts: [] };

      await expect(
        adapter.onCommandExecuteBefore(
          { command: "/justice-start", sessionID: "sess-bad", arguments: rawArguments },
          output,
        ),
      ).resolves.toBeUndefined();

      expect(handleWorkflowStart).not.toHaveBeenCalled();
      expect(output.parts).toEqual([]);
      expect(justice.getPlanBridge().getActivePlan("sess-bad")).toBeNull();
    },
  );

  it("fails open when the plan bridge throws", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice.getPlanBridge(), "handleWorkflowStart").mockRejectedValue(
      new Error("bridge exploded"),
    );
    const output: CommandExecuteBeforeOutput = { parts: [] };

    await expect(
      adapter.onCommandExecuteBefore(
        { command: "justice-start", sessionID: "sess-throw", arguments: "ship it" },
        output,
      ),
    ).resolves.toBeUndefined();

    expect(output.parts).toEqual([]);
  });

  it("appends guidance through the real plan bridge without any stubbing", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    const output: CommandExecuteBeforeOutput = { parts: [] };

    await adapter.onCommandExecuteBefore(
      { command: "/justice-start", sessionID: "sess-real", arguments: "--plan plan.md ship it" },
      output,
    );

    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).toMatchObject({ type: "text", sessionID: "sess-real" });
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: Workflow Bootstrap]");
  });

  it("stays a no-op when the adapter has no workspace root", async () => {
    const adapter = new OpenCodeAdapter(
      fakeInit({ worktree: undefined, directory: undefined, project: { root: undefined } }),
    );
    const output: CommandExecuteBeforeOutput = { parts: [] };

    await adapter.onCommandExecuteBefore(
      { command: "justice-start", sessionID: "sess-noop", arguments: "ship it" },
      output,
    );

    expect(output.parts).toEqual([]);
  });

  it("leaves output.parts empty when PlanBridge returns no guidance", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice.getPlanBridge(), "handleWorkflowStart").mockResolvedValue({
      phase: "plan_required",
      goal: "ship it",
      nextSkill: "writing-plans",
      activePlanPath: null,
      guidance: "",
    });

    const output: CommandExecuteBeforeOutput = { parts: [] };
    await adapter.onCommandExecuteBefore(
      { command: "/justice-start", sessionID: "sess-empty", arguments: "ship it" },
      output,
    );

    expect(output.parts).toEqual([]);
  });
});
