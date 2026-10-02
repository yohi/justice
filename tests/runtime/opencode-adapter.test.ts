import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenCodeAdapter,
  type CommandExecuteBeforeOutput,
} from "../../src/runtime/opencode-adapter";
import { OpenCodeNotifier } from "../../src/runtime/opencode-notifier";
import { JusticePlugin } from "../../src/core/justice-plugin";
import {
  REVIEW_GATE_EXECUTION_MARKER,
  REVIEW_GATE_REMEDIATION_MARKER,
  REVIEW_GATE_WORKER_AGENT,
} from "../../src/core/review-gate-execution";
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
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

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
    const spy = vi.spyOn(justice, "handleEvent");

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

  it("keeps logical task id visible to Justice then removes it from final task args", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    let justiceInput: unknown;
    vi.spyOn(justice, "handleEvent").mockImplementation(async (event) => {
      justiceInput = structuredClone(event);
      return { action: "proceed" };
    });
    const output = { args: { prompt: "run", task_id: "task-1" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "logical" }, output);

    expect(justiceInput).toMatchObject({
      payload: { toolInput: { task_id: "task-1" } },
    });
    expect(output.args).not.toHaveProperty("task_id");
  });

  it("keeps ses continuation visible to Justice and final OmO args", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    let justiceInput: unknown;
    vi.spyOn(justice, "handleEvent").mockImplementation(async (event) => {
      justiceInput = structuredClone(event);
      return { action: "proceed" };
    });
    const output = { args: { prompt: "run", task_id: "ses_abc" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "continuation" }, output);

    expect(justiceInput).toMatchObject({
      payload: { toolInput: { task_id: "ses_abc" } },
    });
    expect(output.args.task_id).toBe("ses_abc");
  });

  it("preserves caller ses continuation when an inject payload contains a logical task id", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "approved plan",
      modifiedPayload: { args: { task_id: "task-1" } },
    });
    const output = { args: { prompt: "continue", task_id: "ses_abc" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "inject-ses" }, output);

    expect(output.args.task_id).toBe("ses_abc");
  });

  it("removes caller logical task id after an inject payload returns the same id", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "approved plan",
      modifiedPayload: { args: { task_id: "task-1" } },
    });
    const output = { args: { prompt: "continue", task_id: "task-1" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "inject-task" }, output);

    expect(output.args).not.toHaveProperty("task_id");
  });

  it("keeps unknown task id visible to Justice then removes it from final task args", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    let justiceInput: unknown;
    vi.spyOn(justice, "handleEvent").mockImplementation(async (event) => {
      justiceInput = structuredClone(event);
      return { action: "proceed" };
    });
    const output = { args: { prompt: "run", task_id: "opaque-id" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "unknown" }, output);

    expect(justiceInput).toMatchObject({
      payload: { toolInput: { task_id: "opaque-id" } },
    });
    expect(output.args).not.toHaveProperty("task_id");
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

    const output: { args: Record<string, unknown> } = {
      args: { prompt: "original", loadSkills: [] as string[] },
    };
    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "c1" }, output);

    expect(output.args.prompt).toEqual(expect.stringMatching(/^\[PLAN\]/));
    expect(output.args.prompt).toEqual(expect.stringMatching(/original$/));
    expect(output.args.load_skills).toEqual(["a", "b"]);
    expect(output.args).not.toHaveProperty("loadSkills");
  });

  it.each(["sp-implementation", "sp-review", "sp-final-review"] as const)(
    "keeps Justice %s category instead of compatibility general routing",
    async (justiceCategory) => {
      const adapter = new OpenCodeAdapter(fakeInit());
      await adapter.ensureInitialized();
      const justice = adapter.getJustice() as JusticePlugin;
      vi.spyOn(justice, "handleEvent").mockResolvedValue({
        action: "inject",
        injectedContext: "context",
        modifiedPayload: { args: { category: justiceCategory } },
      });
      const output: { args: Record<string, unknown> } = {
        args: {
          prompt: "caller",
          subagent_type: "general",
          category: "sp-implementation",
        },
      };

      await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "route" }, output);

      expect(output.args.category).toBe(justiceCategory);
      expect(output.args).not.toHaveProperty("subagent_type");
      if (justiceCategory === "sp-review" || justiceCategory === "sp-final-review") {
        expect(output.args.run_in_background).toBe(false);
      }
    },
  );

  it("keeps ordinary general routing when Justice does not provide a category", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const output: { args: Record<string, unknown> } = {
      args: { prompt: "caller", subagent_type: "general" },
    };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "general" }, output);

    expect(output.args.subagent_type).toBe("general");
    expect(output.args).not.toHaveProperty("category");
  });

  it("keeps Justice category when subagent routing is absent", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "context",
      modifiedPayload: { args: { category: "sp-implementation" } },
    });
    const output: { args: Record<string, unknown> } = { args: { prompt: "caller" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "category" }, output);

    expect(output.args.category).toBe("sp-implementation");
  });

  it("routes a marked Review Gate task to its dedicated worker agent", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const prompt = `${REVIEW_GATE_EXECUTION_MARKER}\nGate-ID: gate-123`;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "[JUSTICE: PLAN REVIEW GATE CLAIMED]",
      modifiedPayload: {
        args: {
          prompt,
          subagent_type: REVIEW_GATE_WORKER_AGENT,
          category: "sp-final-review",
          run_in_background: false,
        },
      },
    });
    const output: { args: Record<string, unknown> } = {
      args: {
        prompt,
        subagent_type: REVIEW_GATE_WORKER_AGENT,
        load_skills: [],
        run_in_background: false,
      },
    };

    await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "review-controller", callID: "review-worker" },
      output,
    );

    expect(output.args).toMatchObject({
      subagent_type: REVIEW_GATE_WORKER_AGENT,
      run_in_background: false,
    });
    expect(output.args).not.toHaveProperty("category");
  });

  it("removes caller category when explore subagent routing is present", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "context",
      modifiedPayload: { args: { category: "caller-category" } },
    });
    const output = { args: { prompt: "caller", subagent_type: "explore", category: "caller-category" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "explore-route" }, output);

    expect(output.args.subagent_type).toBe("explore");
    expect(output.args).not.toHaveProperty("category");
  });

  it("uses authoritative modified task prompt without duplicating caller prompt", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const approvedPrompt = [
      "**TASK CONTRACT FROM APPROVED PLAN**",
      "complete plan task body",
      "**CALLER CONTEXT**",
      "caller prompt",
      "**JUSTICE EXECUTION CONSTRAINTS**",
      "**PREVIOUS LEARNINGS**",
      "learning",
    ].join("\n");
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "must not prepend",
      modifiedPayload: { args: { prompt: approvedPrompt } },
    });
    const output = { args: { prompt: "caller prompt" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "prompt" }, output);

    expect(output.args.prompt).toBe(approvedPrompt);
    expect(output.args.prompt.match(/caller prompt/g)).toHaveLength(1);
    expect(output.args.prompt).not.toContain("must not prepend");
    expect(output.args.prompt.indexOf("**TASK CONTRACT FROM APPROVED PLAN**"))
      .toBeLessThan(output.args.prompt.indexOf("**CALLER CONTEXT**"));
    expect(output.args.prompt.indexOf("**CALLER CONTEXT**"))
      .toBeLessThan(output.args.prompt.indexOf("**JUSTICE EXECUTION CONSTRAINTS**"));
    expect(output.args.prompt.indexOf("**JUSTICE EXECUTION CONSTRAINTS**"))
      .toBeLessThan(output.args.prompt.indexOf("**PREVIOUS LEARNINGS**"));
  });

  it("removes forbidden routing fields from the final task output args", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "[PLAN]",
      modifiedPayload: {
        args: {
          category: "sp-implementation",
          taskId: "task-1",
          loadSkills: [],
        },
      },
    });

    const output: { args: Record<string, unknown> } = {
      args: {
        prompt: "original",
        subagent_type: "deep",
        agent: "atlas",
        model: "claude",
        provider: "anthropic",
        variant: "fast",
        reasoning: true,
        fallback_models: ["fallback"],
      },
    };
    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "c1" }, output);

    expect(output.args).not.toHaveProperty("category");
    expect(output.args).not.toHaveProperty("task_id");
    for (const field of [
      "agent",
      "model",
      "provider",
      "variant",
      "reasoning",
      "fallback_models",
    ]) {
      expect(output.args).not.toHaveProperty(field);
    }
    expect(output.args.subagent_type).toBe("deep");
  });

  it("normalizes task args in place before a non-inject early return", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    const output = {
      args: {
        prompt: "original",
        category: "sp-implementation",
        taskId: "task-1",
        loadSkills: ["programming"],
        runInBackground: true,
        subagent_type: "deep",
        agent: "atlas",
        model: "claude",
        provider: "anthropic",
        variant: "fast",
        reasoning: true,
        fallback_models: ["fallback"],
      },
    };
    const originalArgs = output.args;

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "c1" }, output);

    expect(output.args).toBe(originalArgs);
    expect(output.args).toEqual({
      prompt: "original",
      load_skills: ["programming"],
      run_in_background: true,
      subagent_type: "deep",
    });
  });

  it("normalizes task args in place before the no-op early return", async () => {
    const adapter = new OpenCodeAdapter(
      fakeInit({
        worktree: undefined,
        directory: undefined,
        project: { root: undefined },
      }),
    );
    const output = {
      args: {
        prompt: "original",
        task_id: "task-2",
        load_skills: ["programming"],
        run_in_background: false,
        subagent_type: "deep",
      },
    };
    const originalArgs = output.args;

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "c1" }, output);

    expect(output.args).toBe(originalArgs);
    expect(output.args).toEqual({
      prompt: "original",
      load_skills: ["programming"],
      run_in_background: false,
      subagent_type: "deep",
    });
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
  it.each([
    { marker: REVIEW_GATE_REMEDIATION_MARKER, routing: { category: "writing" } },
    { marker: REVIEW_GATE_EXECUTION_MARKER, routing: { subagent_type: REVIEW_GATE_WORKER_AGENT } },
  ])("delivers an executable next task when Justice supplies $marker", async ({ marker, routing }) => {
    // Given: the hook has advanced the Gate to another correlated worker.
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice was not initialized");
    const prompt = `${marker}\nGate-ID: gate-next\nReview-Round: 2\nRetry-Budget: 4\nFindings: [{"summary":"repair this"}]`;
    vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "inject", injectedContext: prompt });
    const output = { output: '{"complete":true}' };

    // When: the completed worker output is delivered to its controller.
    await adapter.onToolExecuteAfter(
      { tool: "task", sessionID: "controller", callID: "worker", args: { prompt: "previous" } },
      output,
    );

    // Then: the next action is task arguments, not a bare instruction to edit locally.
    const payload = output.output.match(/\[JUSTICE: REVIEW GATE NEXT TASK\]\n([^\n]+)$/u)?.[1];
    expect(payload).toBeDefined();
    if (payload === undefined) return;
    expect(JSON.parse(payload)).toEqual({
      ...routing,
      description: "Justice Gate round 2",
      prompt,
      load_skills: [],
      run_in_background: false,
    });
  });

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

  it("normalizes OpenCode @paths and allows a path-only /justice-start command", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleWorkflowStart = vi
      .spyOn(justice.getPlanBridge(), "handleWorkflowStart")
      .mockResolvedValue({
        phase: "plan_ready",
        directiveStage: "plan_review_required",
        recommendedSkills: [],
        goal: "Continue the referenced Justice workflow",
        nextSkill: null,
        activePlanPath: "docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md",
        guidance: "[JUSTICE: Workflow Bootstrap] plan_ready",
      });

    const hostTemplatePart = {
      type: "text",
      sessionID: "sess-at-path",
      text: "--design @docs/... --plan @docs/...",
      synthetic: false,
    } as unknown as CommandExecuteBeforeOutput["parts"][number];
    const output: CommandExecuteBeforeOutput = { parts: [hostTemplatePart] };
    await adapter.onCommandExecuteBefore(
      {
        command: "/justice-start",
        sessionID: "sess-at-path",
        arguments:
          "--design @docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md --plan @docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md",
      },
      output,
    );

    expect(handleWorkflowStart).toHaveBeenCalledWith("sess-at-path", {
      source: "command",
      goal: "Continue the referenced Justice workflow",
      designPath: "docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md",
      planPath: "docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md",
    });
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).not.toBe(hostTemplatePart);
    expect(output.parts[0]).toMatchObject({ synthetic: true });
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: Workflow Bootstrap]");
    expect((output.parts[0] as { text: string }).text).not.toContain("--design @docs/...");
  });

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

  it("rewrites successful /justice-review-gate into one direct OpenCode subtask", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const reviewerPrompt =
      "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-1\nReview-Round: 1\nRetry-Budget: 4\nReview the artifacts.";
    const handleReviewGateStart = vi
      .spyOn(justice.getPlanBridge(), "handleReviewGateStart")
      .mockResolvedValue({
        dispatched: true,
        designPath: "docs/specs/design.md",
        planPath: "docs/plans/implementation-plan.md",
        directiveStage: "plan_review_required",
        reviewerPrompt,
        guidance: "[JUSTICE: REVIEW GATE REQUESTED]",
      });
    const hostSubtaskPart = {
      type: "subtask",
      agent: "justice-review-controller",
      description: "Run the Justice Design / Implementation Plan review gate",
      model: { providerID: "test", modelID: "test" },
      prompt:
        "--design @docs/specs/design.md --plan @docs/plans/implementation-plan.md --retry 4",
    } as unknown as CommandExecuteBeforeOutput["parts"][number];
    const output: CommandExecuteBeforeOutput = { parts: [hostSubtaskPart] };

    await adapter.onCommandExecuteBefore(
      {
        command: "/justice-review-gate",
        arguments:
          "--design @docs/specs/design.md --plan @docs/plans/implementation-plan.md --retry 4",
        sessionID: "session-review-gate",
      },
      output,
    );

    expect(handleReviewGateStart).toHaveBeenCalledWith("session-review-gate", {
      source: "command",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      retryBudget: 4,
    });
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).not.toBe(hostSubtaskPart);
    expect(output.parts[0]).toMatchObject({
      type: "subtask",
      agent: "justice-review-controller",
      description: "Justice plan review gate",
      prompt: reviewerPrompt,
    });
  });

  it("blocks a successful Gate state when OpenCode does not provide the required subtask part", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const planBridge = justice.getPlanBridge();
    const handleReviewGateStart = vi.spyOn(planBridge, "handleReviewGateStart").mockResolvedValue({
      dispatched: true,
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      directiveStage: "plan_review_required",
      reviewerPrompt:
        "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-1\nReview the artifacts.",
      guidance: "[JUSTICE: REVIEW GATE REQUESTED]",
    });
    const cancel = vi.spyOn(planBridge, "cancelPendingPlanReviewGate");
    const output: CommandExecuteBeforeOutput = {
      parts: [
        {
          type: "text",
          sessionID: "session-review-gate-missing-subtask",
          text: "host prompt",
        } as unknown as CommandExecuteBeforeOutput["parts"][number],
      ],
    };

    await adapter.onCommandExecuteBefore(
      {
        command: "justice-review-gate",
        arguments: "--design docs/specs/design.md --plan docs/plans/implementation-plan.md",
        sessionID: "session-review-gate-missing-subtask",
      },
      output,
    );

    expect(handleReviewGateStart).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).toMatchObject({ type: "text", synthetic: true });
    expect((output.parts[0] as { text: string }).text).toContain(
      "[JUSTICE: REVIEW GATE BLOCKED]",
    );
    expect((output.parts[0] as { text: string }).text).toContain("subtask");
  });

  it("allows the outer controller task only for its exact pending Gate prompt", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const pendingPrompt = vi
      .spyOn(justice.getPlanBridge(), "isPendingReviewGatePrompt")
      .mockReturnValue(true);
    const handleEvent = vi.spyOn(justice, "handleEvent");
    const args = {
      prompt:
        "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-outer\nReview the artifacts.",
      description: "Justice plan review gate",
      subagent_type: "justice-review-controller",
      command: "/justice-review-gate",
    };

    const response = await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "parent-review", callID: "outer-call" },
      { args },
    );

    expect(response).toEqual({ action: "proceed" });
    expect(pendingPrompt).toHaveBeenCalledWith("parent-review", args.prompt);
    expect(handleEvent).not.toHaveBeenCalled();
    expect(args.subagent_type).toBe("justice-review-controller");
    expect(args).not.toHaveProperty("category");
  });

  it("allows the exact pending reviewer worker through the active Gate lock", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const planBridge = justice.getPlanBridge();
    const prompt = "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-worker\nReview the artifacts.";
    const pendingPrompt = vi
      .spyOn(planBridge, "isPendingReviewGatePrompt")
      .mockReturnValue(true);
    vi.spyOn(planBridge, "getReviewGateLock").mockReturnValue({
      parentSessionId: "parent-review",
      gateId: "gate-worker",
      phase: "reviewing",
      designPath: "docs/design.md",
      planPath: "docs/plan.md",
      designDigest: "design-digest",
      planDigest: "plan-digest",
    });
    const classify = vi
      .spyOn(planBridge, "classifyReviewGateToolUse")
      .mockReturnValue({ kind: "allow" });
    const handleEvent = vi
      .spyOn(justice, "handleEvent")
      .mockResolvedValue({ action: "proceed" });
    const args = { prompt, subagent_type: "justice-review-worker" };

    await adapter.onEvent({
      event: {
        id: "event-controller",
        type: "session.created",
        properties: { info: { id: "controller", parentID: "parent-review" } },
      },
    });
    await adapter.onEvent({
      event: {
        id: "event-worker",
        type: "session.created",
        properties: { info: { id: "worker", parentID: "controller" } },
      },
    });

    const response = await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "worker", callID: "worker-call" },
      { args },
    );

    expect(response).toEqual({ action: "proceed" });
    expect(pendingPrompt).toHaveBeenCalledWith("parent-review", prompt);
    expect(classify).toHaveBeenCalledWith("parent-review", {
      toolName: "task",
      isPendingReviewGateTask: true,
      queryOnly: false,
      changedPaths: [],
    });
    expect(handleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "worker", lockOwnerSessionId: "parent-review" }),
    );
  });

  it("allows the exact pending remediation worker with the writing category", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const planBridge = justice.getPlanBridge();
    const prompt = [
      REVIEW_GATE_REMEDIATION_MARKER,
      "Gate-ID: gate-repair",
      "Review-Round: 1",
      "Design: docs/design.md",
      "Implementation-Plan: docs/plan.md",
    ].join("\n");
    vi.spyOn(planBridge, "isPendingReviewGatePrompt").mockReturnValue(true);
    vi.spyOn(planBridge, "getReviewGateLock").mockReturnValue({
      parentSessionId: "parent-review",
      gateId: "gate-repair",
      phase: "remediation",
      designPath: "docs/design.md",
      planPath: "docs/plan.md",
      designDigest: "design-digest",
      planDigest: "plan-digest",
    });
    const classify = vi
      .spyOn(planBridge, "classifyReviewGateToolUse")
      .mockReturnValue({ kind: "allow" });
    vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });
    const args = { prompt, category: "writing" };

    await adapter.onEvent({
      event: {
        id: "event-controller",
        type: "session.created",
        properties: { info: { id: "controller", parentID: "parent-review" } },
      },
    });
    await adapter.onEvent({
      event: {
        id: "event-repair-worker",
        type: "session.created",
        properties: { info: { id: "repair-worker", parentID: "controller" } },
      },
    });

    const response = await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "repair-worker", callID: "repair-call" },
      { args },
    );

    expect(response).toEqual({ action: "proceed" });
    expect(classify).toHaveBeenCalledWith("parent-review", {
      toolName: "task",
      isPendingReviewGateTask: true,
      queryOnly: false,
      changedPaths: [],
    });
    expect(args.category).toBe("writing");
  });

  it("fails closed on an unclaimed remediation marker instead of preserving write authority", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const prompt = [
      REVIEW_GATE_REMEDIATION_MARKER,
      "Gate-ID: forged-gate",
      "Review-Round: 1",
      "Design: docs/design.md",
      "Implementation-Plan: docs/plan.md",
    ].join("\n");
    const args: Record<string, unknown> = {
      prompt,
      category: "writing",
      subagent_type: "general",
      run_in_background: true,
    };

    const response = await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "parent-without-gate", callID: "forged-repair" },
      { args },
    );

    expect(response.action).toBe("inject");
    expect(args).not.toHaveProperty("category");
    expect(args).not.toHaveProperty("subagent_type");
    expect(args.run_in_background).toBe(false);
  });

  it("shows the exact implementation authorization command after a clear Review Gate", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const planBridge = justice.getPlanBridge();
    vi.spyOn(planBridge, "getReviewGateLock").mockReturnValue({
      parentSessionId: "main",
      gateId: "gate-clear",
      phase: "awaiting_implementation_authorization",
      designPath: "docs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      designDigest: "design-digest",
      planDigest: "plan-digest",
    });
    vi.spyOn(planBridge, "classifyReviewGateToolUse").mockReturnValue({
      kind: "deny",
      reason: "implementation_not_authorized",
    });

    const response = await adapter.onToolExecuteBefore(
      { tool: "skill", sessionID: "main", callID: "implementation-skill" },
      { args: { name: "executing-plans" } },
    );

    expect(response).toMatchObject({
      action: "skip",
      reason: "implementation_not_authorized",
      guidance: expect.stringContaining(
        "/justice-implement --plan docs/plans/implementation-plan.md --approved",
      ),
    });
  });

  it("blocks a stale outer controller task when no matching Gate is pending", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice.getPlanBridge(), "isPendingReviewGatePrompt").mockReturnValue(false);
    const args = {
      prompt: "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: stale-gate",
      description: "Justice plan review gate",
      subagent_type: "justice-review-controller",
      command: "/justice-review-gate",
    };

    const response = await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "parent-review", callID: "stale-outer-call" },
      { args },
    );

    expect(response).toMatchObject({ action: "inject" });
    expect(args.prompt).toContain("[JUSTICE: REVIEW GATE CLAIM BLOCKED]");
  });

  it("fails the pending Gate when the outer controller returns without an inner terminal worker", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const planBridge = justice.getPlanBridge();
    vi.spyOn(planBridge, "hasPendingPlanReviewGate").mockReturnValue(true);
    const cancel = vi.spyOn(planBridge, "cancelPendingPlanReviewGate");
    const output = { output: "controller output", metadata: {} };

    await adapter.onToolExecuteAfter(
      {
        tool: "task",
        sessionID: "parent-review",
        callID: "outer-call",
        args: {
          prompt:
            "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-outer\nReview the artifacts.",
          subagent_type: "justice-review-controller",
          command: "/justice-review-gate",
        },
      },
      output,
    );

    expect(cancel).toHaveBeenCalledWith("parent-review");
    expect(output.output).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
  });

  it("surfaces the exact authorization command on the outer controller result", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice.getPlanBridge(), "getReviewGateLock").mockReturnValue({
      parentSessionId: "parent-review",
      gateId: "gate-clear",
      phase: "awaiting_implementation_authorization",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      designDigest: "design-digest",
      planDigest: "plan-digest",
    });
    const output = { output: "controller summary", metadata: {} };

    await adapter.onToolExecuteAfter(
      {
        tool: "task",
        sessionID: "parent-review",
        callID: "outer-call",
        args: {
          prompt: "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-clear",
          subagent_type: "justice-review-controller",
          command: "/justice-review-gate",
        },
      },
      output,
    );

    expect(output.output).toContain(
      "/justice-implement --plan docs/plans/implementation-plan.md --approved",
    );
  });

  it("explains the allowed paths when a remediation write target is not recognized", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const planBridge = justice.getPlanBridge();
    vi.spyOn(planBridge, "getReviewGateLock").mockReturnValue({
      parentSessionId: "main",
      gateId: "gate-remediation",
      phase: "remediation",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      designDigest: "design-digest",
      planDigest: "plan-digest",
    });
    vi.spyOn(planBridge, "classifyReviewGateToolUse").mockReturnValue({
      kind: "deny",
      reason: "review_scope_violation",
    });

    const response = await adapter.onToolExecuteBefore(
      { tool: "apply_patch", sessionID: "main", callID: "patch-call" },
      { args: { patchText: "patch without a file header" } },
    );

    expect(response).toMatchObject({
      action: "skip",
      reason: "review_scope_violation",
      guidance: expect.stringContaining("docs/plans/implementation-plan.md"),
    });
  });

  it("allows an Edit targeting the exact reviewed plan during remediation", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    await justice.getPlanBridge().handleReviewGateStart("main", {
      source: "command",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      retryBudget: 0,
    });

    const response = await adapter.onToolExecuteBefore(
      { tool: "edit", sessionID: "main", callID: "edit-plan" },
      {
        args: {
          filePath: "docs/plans/implementation-plan.md",
          oldString: "old plan text",
          newString: "corrected plan text",
        },
      },
    );

    expect(response).not.toMatchObject({
      action: "skip",
      reason: "review_scope_violation",
    });
  });

  it("surfaces remediation state when the outer controller result is not clear", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    vi.spyOn(justice.getPlanBridge(), "getReviewGateLock").mockReturnValue({
      parentSessionId: "parent-review",
      gateId: "gate-needs-remediation",
      phase: "remediation",
      designPath: "docs/specs/design.md",
      planPath: "docs/plans/implementation-plan.md",
      designDigest: "design-digest",
      planDigest: "plan-digest",
    });
    const output = { output: "controller summary says no findings", metadata: {} };

    await adapter.onToolExecuteAfter(
      {
        tool: "task",
        sessionID: "parent-review",
        callID: "outer-call",
        args: {
          prompt: "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-needs-remediation",
          subagent_type: "justice-review-controller",
          command: "/justice-review-gate",
        },
      },
      output,
    );

    expect(output.output).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(output.output).toContain("/justice-review-gate");
  });

  it("detects an outer Review Gate controller task when the host omits command metadata", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const planBridge = (adapter.getJustice() as JusticePlugin).getPlanBridge();
    vi.spyOn(planBridge, "hasPendingPlanReviewGate").mockReturnValue(true);
    const cancelPending = vi
      .spyOn(planBridge, "cancelPendingPlanReviewGate")
      .mockImplementation(() => undefined);
    const output = { output: "controller summary", metadata: {} };

    await adapter.onToolExecuteAfter(
      {
        tool: "task",
        sessionID: "parent-review",
        callID: "outer-call",
        args: {
          prompt: "[JUSTICE: PLAN REVIEW GATE EXECUTION]\nGate-ID: gate-current\nReview-Round: 1",
          subagent_type: "justice-review-controller",
        },
      },
      output,
    );

    expect(cancelPending).toHaveBeenCalledWith("parent-review");
    expect(output.output).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
  });

  it("reports malformed /justice-review-gate arguments explicitly", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    const output: CommandExecuteBeforeOutput = {
      parts: [
        {
          type: "text",
          sessionID: "session-review-gate-bad",
          text: "--design @docs/design.md",
        } as unknown as CommandExecuteBeforeOutput["parts"][number],
      ],
    };

    await adapter.onCommandExecuteBefore(
      {
        command: "justice-review-gate",
        arguments: "--design @docs/design.md",
        sessionID: "session-review-gate-bad",
      },
      output,
    );

    expect(output.parts).toHaveLength(1);
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: COMMAND REJECTED]");
    expect((output.parts[0] as { text: string }).text).not.toBe("--design @docs/design.md");
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
    const hostTemplatePart = {
      type: "text",
      sessionID: "session-1",
      text: "--plan plan.md --approved",
      synthetic: false,
    } as unknown as CommandExecuteBeforeOutput["parts"][number];
    const output: CommandExecuteBeforeOutput = { parts: [hostTemplatePart] };

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
      action: "approve",
      planPath: "plan.md",
      approved: true,
    });
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).not.toBe(hostTemplatePart);
    expect(output.parts[0]).toMatchObject({
      text: "[JUSTICE: IMPLEMENTATION ARMED]",
      synthetic: true,
    });
  });

  it("forwards explicit authorization cancellation", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleImplementationArm = vi.spyOn(justice.getPlanBridge(), "handleImplementationArm");

    await adapter.onCommandExecuteBefore(
      { command: "justice-implement", arguments: "--cancel", sessionID: "session-1" },
      { parts: [] },
    );

    expect(handleImplementationArm).toHaveBeenCalledWith("session-1", {
      source: "command",
      action: "cancel",
    });
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

  it("reports malformed /justice-implement arguments explicitly", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleImplementationArm = vi.spyOn(justice.getPlanBridge(), "handleImplementationArm");
    const output: CommandExecuteBeforeOutput = {
      parts: [
        {
          type: "text",
          sessionID: "session-1",
          text: "--approved",
        } as unknown as CommandExecuteBeforeOutput["parts"][number],
      ],
    };

    await adapter.onCommandExecuteBefore(
      {
        command: "justice-implement",
        arguments: "--approved",
        sessionID: "session-1",
      },
      output,
    );

    expect(handleImplementationArm).not.toHaveBeenCalled();
    expect(output.parts).toHaveLength(1);
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: COMMAND REJECTED]");
    expect((output.parts[0] as { text: string }).text).not.toBe("--approved");
  });

  it.each([
    ["justice-start", "--unknown-flag goal"],
    ["justice-implement", "--unknown-flag"],
    ["justice-review-gate", "--design docs/design.md"],
  ])("removes existing template parts when %s arguments are rejected", async (command, args) => {
    const adapter = new OpenCodeAdapter(fakeInit());
    const templateArgumentPart = {
      id: "prt-template-argument",
      sessionID: "session-rejected",
      messageID: "msg-template-argument",
      type: "text" as const,
      text: "untrusted template argument",
      synthetic: false,
    };
    const output: CommandExecuteBeforeOutput = { parts: [templateArgumentPart] };

    await adapter.onCommandExecuteBefore(
      { command, arguments: args, sessionID: "session-rejected" },
      output,
    );

    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).not.toBe(templateArgumentPart);
    expect(output.parts[0]).toMatchObject({
      type: "text",
      sessionID: "session-rejected",
      synthetic: true,
    });
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: COMMAND REJECTED]");
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
    "fails open with an explicit rejection directive for malformed arguments %j",
    async (rawArguments) => {
      const adapter = new OpenCodeAdapter(fakeInit());
      await adapter.ensureInitialized();
      const justice = adapter.getJustice() as JusticePlugin;
      const handleWorkflowStart = vi.spyOn(justice.getPlanBridge(), "handleWorkflowStart");
      const output: CommandExecuteBeforeOutput = {
        parts: [
          {
            type: "text",
            sessionID: "sess-bad",
            text: `RAW TEMPLATE: ${rawArguments}`,
          } as unknown as CommandExecuteBeforeOutput["parts"][number],
        ],
      };

      await expect(
        adapter.onCommandExecuteBefore(
          { command: "/justice-start", sessionID: "sess-bad", arguments: rawArguments },
          output,
        ),
      ).resolves.toBeUndefined();

      expect(handleWorkflowStart).not.toHaveBeenCalled();
      expect(output.parts).toHaveLength(1);
      expect(output.parts[0]).toMatchObject({ type: "text", sessionID: "sess-bad" });
      expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: COMMAND REJECTED]");
      expect((output.parts[0] as { text: string }).text).not.toContain("RAW TEMPLATE:");
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

describe("OpenCodeAdapter lock owner resolution", () => {
  it("returns the root session for nested Review Gate descendants", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.onEvent({
      event: {
        id: "event-child",
        type: "session.created",
        properties: { info: { id: "controller", parentID: "main" } },
      },
    });
    await adapter.onEvent({
      event: {
        id: "event-worker",
        type: "session.created",
        properties: { info: { id: "worker", parentID: "controller" } },
      },
    });

    expect(adapter.resolveLockOwnerSession("main")).toBe("main");
    expect(adapter.resolveLockOwnerSession("worker")).toBe("main");
    expect(adapter.resolveLockOwnerSession("unrelated")).toBe("unrelated");
  });

  it("returns undefined for cyclic or missing parent relations", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.onEvent({
      event: {
        id: "event-a",
        type: "session.created",
        properties: { info: { id: "a", parentID: "b" } },
      },
    });
    await adapter.onEvent({
      event: {
        id: "event-b",
        type: "session.created",
        properties: { info: { id: "b", parentID: "a" } },
      },
    });

    expect(adapter.resolveLockOwnerSession("a")).toBeUndefined();
  });

  it("stops inheriting a parent lock owner after the child session is deleted", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.onEvent({
      event: {
        id: "event-child",
        type: "session.created",
        properties: { info: { id: "child", parentID: "parent" } },
      },
    });
    await adapter.onEvent({
      event: {
        id: "event-delete",
        type: "session.deleted",
        properties: { info: { id: "child" } },
      },
    });

    expect(adapter.resolveLockOwnerSession("child")).toBe("child");
  });
});

describe("OpenCodeAdapter.onChatMessage fallback", () => {
  it("logs a warning when a user types /justice-implement but the command is not registered", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleImplementationArm = vi
      .spyOn(justice.getPlanBridge(), "handleImplementationArm")
      .mockResolvedValue({ armed: true, planPath: "plan.md", directiveStage: "implementation_arm", guidance: "" });
    const logSpy = vi.spyOn(adapter, "log").mockResolvedValue(undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await adapter.onChatMessage(
      { event: { type: "chat.message", properties: { sessionID: "fallback-session" } } },
      {
        message: { role: "user", content: "/justice-implement --plan plan.md --approved", sessionID: "fallback-session" },
        parts: [],
      },
    );

    expect(handleImplementationArm).toHaveBeenCalledWith("fallback-session", {
      source: "fallback_marker",
      planPath: "plan.md",
      approved: true,
    });
    expect(logSpy).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("Fallback /justice-implement was used because the command was not registered."),
      expect.any(Object),
    );
    consoleErrorSpy.mockRestore();
  });
  it("does not log fallback for ordinary user messages", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const logSpy = vi.spyOn(adapter, "log").mockResolvedValue(undefined);

    await adapter.onChatMessage(
      { event: { type: "chat.message", properties: {} } },
      {
        message: { role: "user", content: "hello", sessionID: "normal-session" },
        parts: [],
      },
    );

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Fallback /justice-implement"));
  });

  it("does not forward assistant chat messages as user messages", async () => {
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice() as JusticePlugin;
    const handleEvent = vi.spyOn(justice, "handleEvent");

    await adapter.onChatMessage(
      { event: { type: "chat.message", properties: { sessionID: "assistant-session" } } },
      {
        message: { role: "assistant", agent: "sisyphus", sessionID: "assistant-session" },
        parts: [{ type: "text", text: "assistant response" }],
      },
    );

    expect(handleEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "Message",
        payload: expect.objectContaining({ role: "user" }),
      }),
    );
  });
});
