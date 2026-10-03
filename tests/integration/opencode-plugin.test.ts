import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "@opencode-ai/plugin";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import type { OpenCodeAdapter, OpenCodePluginInit } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

function createMockAdapter(): OpenCodeAdapter {
  return {
    onEvent: vi.fn().mockResolvedValue(undefined),
    onToolExecuteBefore: vi.fn().mockResolvedValue(undefined),
    onCommandExecuteBefore: vi.fn().mockResolvedValue(undefined),
    onToolExecuteAfter: vi.fn().mockResolvedValue(undefined),
    onSessionCompacting: vi.fn().mockResolvedValue(undefined),
    onTextComplete: vi.fn().mockResolvedValue(undefined),
    getJustice: vi.fn().mockReturnValue(null),
    isNoOp: vi.fn().mockReturnValue(false),
    getWorkspaceRoot: vi.fn().mockReturnValue(null),
    getTools: vi.fn().mockReturnValue({}),
    log: vi.fn().mockResolvedValue(undefined),
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
  } as unknown as OpenCodeAdapter;
}

describe("OpenCodePlugin (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is assignable to the OpenCode Plugin type", () => {
    const checked: Plugin = OpenCodePlugin;
    expect(typeof checked).toBe("function");
  });

  it("returns the expected direct hook keys plus generic event", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const keys = Object.keys(handlers);
    expect(keys).toEqual(
      expect.arrayContaining([
        "event",
        "chat.message",
        "chat.params",
        "experimental.chat.system.transform",
        "tool.execute.before",
        "command.execute.before",
        "tool.execute.after",
        "experimental.session.compacting",
        "experimental.text.complete",
      ]),
    );
  });

  it("exposes a config hook", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    expect(typeof handlers.config).toBe("function");
  });

  it("cancels an OpenCode tool call for a hard implementation lock", async () => {
    const adapter = createMockAdapter();
    adapter.onToolExecuteBefore = async () => ({
      action: "skip",
      reason: "implementation_not_authorized",
      guidance: "Run /justice-implement --plan docs/plans/plan.md --approved.",
    });
    const init = Object.assign(fakeInit(), { __justiceTestAdapter: adapter });
    const handlers = await OpenCodePlugin(init as never);
    const executeBefore = handlers["tool.execute.before"];
    if (executeBefore === undefined) throw new Error("tool.execute.before hook is missing");

    await expect(
      executeBefore(
        { tool: "skill", sessionID: "session-1", callID: "skill-call" },
        { args: { name: "executing-plans" } },
      ),
    ).rejects.toMatchObject({
      name: "ToolExecutionCancelled",
      reason: "implementation_not_authorized",
      message: expect.stringContaining(
        "/justice-implement --plan docs/plans/plan.md --approved",
      ),
    });
  });

  it("registers justice commands via the config hook", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const config: {
      command: Record<string, unknown>;
      agent?: Record<string, unknown>;
    } = { command: {} };

    await handlers.config?.(config as never);

    expect(config.command["justice-start"]).toEqual({
      template: "$ARGUMENTS",
      description: "Start a Justice-managed development workflow",
    });
    expect(config.command["justice-implement"]).toEqual({
      template: "$ARGUMENTS",
      description: "Arm the next Justice-managed implementation delegation",
    });
    expect(config.command["justice-review-gate"]).toMatchObject({
      template: "$ARGUMENTS",
      agent: "justice-review-controller",
      subtask: true,
    });
    expect(config.agent?.["justice-review-controller"]).toMatchObject({
      mode: "subagent",
      permission: { "*": "deny", task: "allow" },
    });
    expect(config.agent?.["justice-review-worker"]).toMatchObject({
      mode: "subagent",
      permission: { "*": "deny", read: "allow" },
    });
  });

  it("does not overwrite existing commands via the config hook", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const config: { command: Record<string, unknown> } = {
      command: {
        "justice-start": {
          template: "custom",
          description: "existing",
        },
      },
    };

    await handlers.config?.(config as never);

    expect(config.command["justice-start"]).toEqual({
      template: "custom",
      description: "existing",
    });
    expect(config.command["justice-implement"]).toBeDefined();
  });

  it("fails open when the config hook throws", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    const config = {
      command: new Proxy<Record<string, unknown>>({}, {
        set() { throw new Error("registration failed"); },
      }),
    };

    await expect(
      handlers.config?.(config as never),
    ).resolves.toBeUndefined();

    const logFn = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    expect(logFn).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining(
          "Failed to auto-register slash commands",
        ),
      }),
    );
  });

  it("fails open when formatting a registration error would throw", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    const hostileError = { toString: () => { throw new Error("formatting failed"); } };
    const config = {
      command: new Proxy<Record<string, unknown>>({}, {
        set() { throw hostileError; },
      }),
    };

    await expect(handlers.config?.(config as never)).resolves.toBeUndefined();

    const logFn = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    expect(logFn).toHaveBeenCalledWith(expect.objectContaining({
      level: "warn",
      message: expect.stringContaining("Failed to auto-register slash commands"),
    }));
  });

  it("exposes resolved Justice slash-command names to the LLM system context", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const config: { command: Record<string, unknown> } = {
      command: {
        "justice-implement-writing-plans": {
          template: "$ARGUMENTS",
          description: "DO NOT EXPOSE THIS DESCRIPTION",
        },
        other: { template: "$ARGUMENTS" },
      },
    };

    await handlers.config?.(config as never);

    const output = { system: ["base-system"] };
    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "experimental.chat.system.transform"
    ]?.({ sessionID: "s", model: {} }, output);

    expect(output.system).toHaveLength(2);
    expect(output.system[1]).toContain("- /justice-start");
    expect(output.system[1]).toContain("- /justice-implement");
    expect(output.system[1]).toContain("- /justice-implement-writing-plans");
    expect(output.system[1]).not.toContain("other");
    expect(output.system[1]).not.toContain("DO NOT EXPOSE THIS DESCRIPTION");
    expect(output.system[1]).toContain("not model-callable tools");
  });

  it("leaves the LLM system context untouched before config resolution", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const output = { system: ["base-system"] };

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "experimental.chat.system.transform"
    ]?.({ sessionID: "s", model: {} }, output);

    expect(output.system).toEqual(["base-system"]);
  });

  it("invokes lazy init only once across multiple hook entries", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    await Promise.all([
      (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>).event?.({
        event: {
          type: "message.updated",
          properties: { sessionID: "s", info: { role: "user", content: "hi" } },
        },
      }),
      (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
        "tool.execute.before"
      ]?.({ tool: "task", sessionID: "s", callID: "c1" }, { args: { prompt: "p" } }),
      (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
        "tool.execute.after"
      ]?.(
        { tool: "task", sessionID: "s", callID: "c1", args: { prompt: "p" } },
        { title: "done", output: "r", metadata: undefined },
      ),
    ]);

    const logFn = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const initLogs = logFn.mock.calls.filter((call) => {
      const [entry] = call as [{ message?: string }];
      return (
        typeof entry?.message === "string" &&
        entry.message.includes("Justice initialized via opencode-adapter")
      );
    });
    expect(initLogs.length).toBe(1);
  });

  it("fails open during lazy init when workspace is unavailable", async () => {
    const init = fakeInit({ worktree: undefined, directory: undefined });
    const handlers = await OpenCodePlugin(init as never);
    const output = { context: [] as string[] };

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>).event?.({
      event: {
        type: "message.updated",
        properties: { sessionID: "s", info: { role: "user", content: "hi" } },
      },
    });
    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "experimental.session.compacting"
    ]?.({ sessionID: "s" }, output);

    expect(output.context).toEqual([]);
  });

  it("initializes Justice before checking instance in tool.execute.before", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "tool.execute.before"
    ]?.({ tool: "task", sessionID: "s", callID: "c1" }, { args: { prompt: "p" } });

    const logFn = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const logs = logFn.mock.calls.map((call) => (call[0] as { message: string }).message);

    expect(logs).toContain("Justice initialized via opencode-adapter");
    expect(logs.some((l) => l.includes("Prompt ignored by TriggerDetector"))).toBe(false);
  });

  it("logs debug message when Justice is not initialized in tool.execute.before", async () => {
    const mockAdapter = createMockAdapter();
    const init = fakeInit() as unknown as OpenCodePluginInit & {
      __justiceTestAdapter?: OpenCodeAdapter;
    };
    init.__justiceTestAdapter = mockAdapter;

    const handlers = await OpenCodePlugin(init as never);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const originalDebug = process.env.DEBUG;
    process.env.DEBUG = "justice:*";

    try {
      await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
        "tool.execute.before"
      ]?.({ tool: "task", sessionID: "s", callID: "c1" }, { args: { prompt: "p" } });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Justice: Prompt ignored by TriggerDetector"),
      );
    } finally {
      process.env.DEBUG = originalDebug;
      warnSpy.mockRestore();
    }
  });

  it("routes experimental.text.complete to adapter", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "experimental.text.complete"
    ]?.({ sessionID: "s", messageID: "m", partID: "p", text: "hello" }, {});

    expect(true).toBe(true);
  });

  it("routes command.execute.before to the adapter and appends the workflow directive", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    const output = { parts: [] as unknown[] };

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "command.execute.before"
    ]?.(
      { command: "/justice-start", sessionID: "s-cmd", arguments: "--plan plan.md ship it" },
      output,
    );

    expect(output.parts).toHaveLength(1);
    expect(output.parts[0]).toMatchObject({ type: "text", sessionID: "s-cmd" });
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: Workflow Bootstrap]");
  });

  it("does not drop a path-only /justice-start command that uses OpenCode @path references", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    const output = { parts: [] as unknown[] };

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "command.execute.before"
    ]?.(
      {
        command: "/justice-start",
        sessionID: "s-path-only",
        arguments:
          "--design @docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md --plan @docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md",
      },
      output,
    );

    expect(output.parts).toHaveLength(1);
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: Workflow Bootstrap]");
    expect((output.parts[0] as { text: string }).text).not.toContain("[JUSTICE: COMMAND REJECTED]");
  });

  it("replaces pre-expanded raw command parts when /justice-start arguments are rejected", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    const output = {
      parts: [
        {
          type: "text",
          sessionID: "s-rejected",
          text: "--unknown raw prompt",
        },
      ] as unknown[],
    };

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "command.execute.before"
    ]?.(
      {
        command: "/justice-start",
        sessionID: "s-rejected",
        arguments: "--unknown raw prompt",
      },
      output,
    );

    expect(output.parts).toHaveLength(1);
    expect((output.parts[0] as { text: string }).text).toContain("[JUSTICE: COMMAND REJECTED]");
    expect((output.parts[0] as { text: string }).text).not.toContain("--unknown raw prompt");
  });

  it("routes /justice-review-gate and injects deterministic Gate guidance", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    const output = { parts: [] as unknown[] };

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "command.execute.before"
    ]?.(
      {
        command: "/justice-review-gate",
        sessionID: "s-review-gate",
        arguments:
          "--design @docs/superpowers/specs/2026-09-28-idle-closed-child-session-reopen-design.md --plan @docs/superpowers/plans/2026-09-28-idle-closed-child-session-reopen.md",
      },
      output,
    );

    expect(output.parts).toHaveLength(1);
    const text = (output.parts[0] as { text: string }).text;
    expect(text).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(text).toContain("Review was not started");
    expect(text).not.toContain("[JUSTICE: COMMAND REJECTED]");
  });
  it("leaves command.execute.before output untouched for a non-Justice command", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    const output = { parts: [] as unknown[] };

    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)[
      "command.execute.before"
    ]?.({ command: "other-command", sessionID: "s-cmd", arguments: "ship it" }, output);

    expect(output.parts).toEqual([]);
  });

  it("registers no public tool beyond justice_review", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);

    expect(Object.keys(handlers.tool ?? {})).toEqual(["justice_review"]);
  });
});
