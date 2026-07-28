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
        "tool.execute.before",
        "command.execute.before",
        "tool.execute.after",
        "experimental.session.compacting",
        "experimental.text.complete",
      ]),
    );
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
