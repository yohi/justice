import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "@opencode-ai/plugin";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import { fakeInit } from "../helpers/fake-opencode-init";

describe("OpenCodePlugin (integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is assignable to the OpenCode Plugin type", () => {
    const checked: Plugin = OpenCodePlugin;
    expect(typeof checked).toBe("function");
  });

  it("returns the expected direct hook keys plus generic event", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as Parameters<typeof OpenCodePlugin>[0]);
    const keys = Object.keys(handlers);
    expect(keys).toEqual(
      expect.arrayContaining([
        "event",
        "tool.execute.before",
        "tool.execute.after",
        "experimental.session.compacting",
      ]),
    );
  });

  it("invokes lazy init only once across multiple hook entries", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as Parameters<typeof OpenCodePlugin>[0]);
    await Promise.all([
      (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>).event?.({
        event: {
          type: "message.updated",
          properties: { sessionID: "s", info: { role: "user", content: "hi" } },
        },
      }),
      (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)["tool.execute.before"]?.(
        { tool: "task", sessionID: "s", callID: "c1" },
        { args: { prompt: "p" } },
      ),
      (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)["tool.execute.after"]?.(
       { tool: "task", sessionID: "s", callID: "c1", args: { prompt: "p" } },
       { title: "done", output: "r", metadata: {} },
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
    const init = fakeInit({
      project: { name: "test", root: undefined as unknown as string },
      worktree: undefined,
      directory: undefined,
    });
    const handlers = await OpenCodePlugin(init as Parameters<typeof OpenCodePlugin>[0]);
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
});
