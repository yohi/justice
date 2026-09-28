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
    const output = { args: { prompt: "caller" } };

    await adapter.onToolExecuteBefore({ tool: "task", sessionID: "s", callID: "category" }, output);

    expect(output.args.category).toBe("sp-implementation");
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

    const output: CommandExecuteBeforeOutput = { parts: [] };
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
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: Workflow Bootstrap]");
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
      action: "approve",
      planPath: "plan.md",
      approved: true,
    });
    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).toMatchObject({ text: "[JUSTICE: IMPLEMENTATION ARMED]" });
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
