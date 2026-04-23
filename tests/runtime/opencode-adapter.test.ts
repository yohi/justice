import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit, createMockedAdapter } from "../helpers/fake-opencode-init";

describe("OpenCodeAdapter skeleton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constructs successfully when worktree is provided", () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
  });

  it("enters no-op mode when all possible workspace roots are undefined", () => {
    const init = fakeInit({ worktree: undefined, directory: undefined, project: { root: undefined } });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.isNoOp()).toBe(true);
  });

  it("falls back to directory when worktree is undefined", () => {
    const init = fakeInit({ worktree: undefined, directory: "/tmp/fallback", project: { root: undefined } });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.isNoOp()).toBe(false);
    expect(adapter.getWorkspaceRoot()).toBe("/tmp/fallback");
  });

  it("falls back to project.root when worktree and directory are undefined", () => {
    const init = fakeInit({ worktree: undefined, directory: undefined, project: { root: "/tmp/project-root" } });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.isNoOp()).toBe(false);
    expect(adapter.getWorkspaceRoot()).toBe("/tmp/project-root");
  });

  it("prefers worktree over directory and project.root", () => {
    const init = fakeInit({
      worktree: "/tmp/wt",
      directory: "/tmp/dir",
      project: { root: "/tmp/proj" },
    });
    const adapter = new OpenCodeAdapter(init);
    expect(adapter.getWorkspaceRoot()).toBe("/tmp/wt");
  });

  it("lazy-initializes justice only once across multiple concurrent entries", async () => {
    // We mock JusticePlugin globally to detect calls to its initialize method
    const { JusticePlugin } = await import("../../src/core/justice-plugin");
    const initSpy = vi.spyOn(JusticePlugin.prototype, "initialize").mockResolvedValue(undefined);

    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    
    // Fire off multiple initializations concurrently
    await Promise.all([
      adapter.ensureInitialized(),
      adapter.ensureInitialized(),
      adapter.ensureInitialized(),
    ]);

    expect(initSpy).toHaveBeenCalledTimes(1);
    initSpy.mockRestore();
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
    const init = fakeInit({ worktree: undefined, directory: undefined, project: { root: undefined } });
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

  it("routes message.updated user events with content to JusticePlugin.handleEvent", async () => {
    const { adapter, justice } = createMockedAdapter();
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: {
          sessionID: "sess-1",
          info: { role: "user", content: "plan.md の次のタスクを委譲して" },
        },
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "Message",
      sessionId: "sess-1",
      payload: { role: "user", content: "plan.md の次のタスクを委譲して" },
    });
  });

  it("skips non-user message.updated events", async () => {
    const { adapter, justice } = createMockedAdapter();
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onEvent({
      event: {
        type: "message.updated",
        properties: { sessionID: "s", info: { role: "assistant", content: "hello" } },
      },
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("routes loop-like session.error events to loop-detector Event", async () => {
    const { adapter, justice } = createMockedAdapter();
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onEvent({
      event: {
        type: "session.error",
        properties: { sessionID: "s", error: { message: "loop detected in planning" } },
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [event] = spy.mock.calls[0];
    expect(event).toMatchObject({
      type: "Event",
      sessionId: "s",
      payload: {
        eventType: "loop-detector",
        sessionId: "s",
        message: "loop detected in planning",
      },
    });
  });

  it("ignores non-loop session.error events without calling justice or logging", async () => {
    const { adapter, justice } = createMockedAdapter();
    const handleSpy = vi.spyOn(justice, "handleEvent");

    await adapter.onEvent({
      event: {
        type: "session.error",
        properties: { sessionID: "s", error: { message: "timeout while calling provider" } },
      },
    });

    expect(handleSpy).not.toHaveBeenCalled();
  });

  it("fails open when event handling throws", async () => {
    const { adapter, justice } = createMockedAdapter();
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
    const { adapter, justice } = createMockedAdapter();
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

  it("skips non-task tools", async () => {
    const { adapter, justice } = createMockedAdapter();
    const spy = vi.spyOn(justice, "handleEvent");

    await adapter.onToolExecuteBefore(
      { tool: "bash", sessionID: "s", callID: "c1" },
      { args: { command: "ls" } },
    );

    expect(spy).not.toHaveBeenCalled();
  });

  it("prepends injected context to output.args.prompt and merges other args", async () => {
    const { adapter, justice } = createMockedAdapter();
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
});

describe("OpenCodeAdapter.onToolExecuteAfter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts task tool results into PostToolUseEvent with error=false on success", async () => {
    const { adapter, justice } = createMockedAdapter();
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteAfter(
      { tool: "task", sessionID: "s", callID: "c1", args: { prompt: "p" } },
      { title: "done", output: "result body", metadata: undefined },
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
    const { adapter, justice } = createMockedAdapter();
    const spy = vi.spyOn(justice, "handleEvent").mockResolvedValue({ action: "proceed" });

    await adapter.onToolExecuteAfter(
      { tool: "task", sessionID: "s", callID: "c1", args: { prompt: "p" } },
      { title: "failed", output: "stack trace...", metadata: { error: true } },
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
    const { adapter, justice } = createMockedAdapter();
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
    const { adapter, justice } = createMockedAdapter();
    vi.spyOn(justice, "handleEvent").mockResolvedValue({
      action: "inject",
      injectedContext: "snapshot-body",
    });

    const output = { context: [] as string[], prompt: undefined as string | undefined };
    await adapter.onSessionCompacting({ sessionID: "s" }, output);
    expect(output.context).toEqual(["snapshot-body"]);
  });
});

describe("OpenCodeAdapter advanced initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retries initialization if a previous attempt failed", async () => {
    const { JusticePlugin } = await import("../../src/core/justice-plugin");
    const initSpy = vi.spyOn(JusticePlugin.prototype, "initialize");
    
    // First attempt fails
    initSpy.mockRejectedValueOnce(new Error("init failed"));
    
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    
    await expect(adapter.ensureInitialized()).rejects.toThrow("init failed");
    expect(initSpy).toHaveBeenCalledTimes(1);

    // Second attempt succeeds
    initSpy.mockResolvedValueOnce(undefined);
    await expect(adapter.ensureInitialized()).resolves.toBeUndefined();
    expect(initSpy).toHaveBeenCalledTimes(2);

    initSpy.mockRestore();
  });

  it("does not initialize for non-task tools in onToolExecuteBefore", async () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    const initSpy = vi.spyOn(adapter, "ensureInitialized");

    await adapter.onToolExecuteBefore(
      { tool: "other", sessionID: "s", callID: "c" },
      { args: {} }
    );

    expect(initSpy).not.toHaveBeenCalled();
  });

  it("does not initialize for non-task tools in onToolExecuteAfter", async () => {
    const init = fakeInit({ worktree: "/tmp/ws", directory: "/tmp/ws" });
    const adapter = new OpenCodeAdapter(init);
    const initSpy = vi.spyOn(adapter, "ensureInitialized");

    await adapter.onToolExecuteAfter(
      { tool: "other", sessionID: "s", callID: "c", args: {} },
      { output: "ok" }
    );

    expect(initSpy).not.toHaveBeenCalled();
  });
});
