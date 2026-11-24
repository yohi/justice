import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import type { ToolContext, ToolEditor } from "@opencode/plugin/promise/tool";
import { describe, expect, it, vi } from "vitest";
import type { ShardId } from "../../src/core/types";
import { createJusticeV2Plugin, type JusticeV2AdapterPort } from "../../src/opencode-v2-plugin";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { OpenCodeAdapter, type OpenCodePluginInit } from "../../src/runtime/opencode-adapter";
import { createMemFs } from "../helpers/mock-file-system";

// Temp dirs are confined to the isolated H3 scratch root; no real host is involved.
const SCRATCH_TMP = "/tmp/justice-h3-tdd-672f7c35/tmp";

type AddedTool = Parameters<ToolEditor["add"]>[0];

interface MockContextHandles {
  readonly context: Plugin.Context;
  readonly added: AddedTool[];
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly toolTransform: ReturnType<typeof vi.fn>;
  readonly toolHook: ReturnType<typeof vi.fn>;
  readonly sessionHook: ReturnType<typeof vi.fn>;
  readonly eventSubscribe: ReturnType<typeof vi.fn>;
  readonly commandTransform: ReturnType<typeof vi.fn>;
}

function createMockContext(options: {
  readonly directory?: string;
  readonly transformError?: Error;
  readonly disposeError?: Error;
} = {}): MockContextHandles {
  const added: AddedTool[] = [];
  const dispose = vi.fn(async (): Promise<void> => {
    if (options.disposeError) throw options.disposeError;
  });
  const editor = {
    add: (tool: AddedTool): void => {
      added.push(tool);
    },
  } as unknown as ToolEditor;
  const toolTransform = vi.fn(async (callback: (input: ToolEditor) => void) => {
    if (options.transformError) throw options.transformError;
    callback(editor);
    return { dispose };
  });
  const toolHook = vi.fn(async () => ({ dispose: vi.fn() }));
  const sessionHook = vi.fn(async () => ({ dispose: vi.fn() }));
  const eventSubscribe = vi.fn();
  const commandTransform = vi.fn(async () => ({ dispose: vi.fn() }));
  const context = {
    location: { directory: options.directory ?? "/nonexistent/justice-v2-test" },
    tool: { transform: toolTransform, hook: toolHook },
    session: { hook: sessionHook },
    event: { subscribe: eventSubscribe },
    command: { transform: commandTransform },
  } as unknown as Plugin.Context;
  return {
    context,
    added,
    dispose,
    toolTransform,
    toolHook,
    sessionHook,
    eventSubscribe,
    commandTransform,
  };
}

function toolContext(): ToolContext {
  return {
    sessionID: "ses_v2_test",
    agent: "build",
    messageID: "msg_v2_test",
    id: "call_v2_test",
    signal: new AbortController().signal,
    progress: async (): Promise<void> => undefined,
  } as unknown as ToolContext;
}

async function createReviewStore(): Promise<ObservationLogStore> {
  const { reader, writer } = createMemFs();
  const store = new ObservationLogStore(writer, reader, "w-v2");
  const shard: ShardId = { agentId: "atlas", sessionId: "session-v2", writerId: "w-v2" };
  await store.append(shard, {
    schemaVersion: 1,
    timestamp: "2026-11-24T00:00:00.000Z",
    agentId: shard.agentId,
    sessionId: shard.sessionId,
    writerId: shard.writerId,
    recordType: "observation",
    kind: "review_observed",
    reviewScope: "task-v2",
    items: [
      {
        itemKey: "major:v2",
        evidenceId: "major:v2",
        severity: "major",
        summary: "major:v2",
        location: "src/example.ts",
        status: "open",
      },
    ],
  });
  return store;
}

function fakeAdapter(store: ObservationLogStore | null): JusticeV2AdapterPort & {
  readonly ensureInitialized: ReturnType<typeof vi.fn>;
} {
  const justice =
    store === null
      ? null
      : {
          getObservationHandler: (): { getLogStore: () => ObservationLogStore } => ({
            getLogStore: (): ObservationLogStore => store,
          }),
        };
  return {
    ensureInitialized: vi.fn(async (): Promise<void> => undefined),
    getJustice: () => justice,
    log: vi.fn(async (): Promise<void> => undefined),
  } as unknown as JusticeV2AdapterPort & { readonly ensureInitialized: ReturnType<typeof vi.fn> };
}

async function setupWith(
  handles: MockContextHandles,
  adapter: JusticeV2AdapterPort,
): Promise<AddedTool> {
  const plugin = createJusticeV2Plugin({ createAdapter: () => adapter });
  await plugin.setup(handles.context);
  const tool = handles.added[0];
  if (tool === undefined) throw new Error("justice_review was not registered");
  return tool;
}

function contentOf(result: { readonly content?: unknown }): string {
  return typeof result.content === "string" ? result.content : JSON.stringify(result.content);
}

describe("V2 entry: tool domain exposes only justice_review", () => {
  it("registers exactly the existing adapter's public tool set through tool.transform", async () => {
    const directory = mkdtempSync(join(SCRATCH_TMP, "v2-hooks-"));
    const handles = createMockContext({ directory });
    const v1Tools = new OpenCodeAdapter({
      project: {},
      client: { app: { log: (): void => undefined } },
      $: (): never => {
        throw new Error("shell unavailable in test");
      },
      directory,
    }).getTools();

    await createJusticeV2Plugin().setup(handles.context);

    expect(handles.toolTransform).toHaveBeenCalledTimes(1);
    expect(handles.added.map((tool) => tool.name)).toEqual(Object.keys(v1Tools));
    expect(handles.added.map((tool) => tool.name)).toEqual(["justice_review"]);
    expect(handles.added[0]?.description).toBe(v1Tools.justice_review?.description);
  });

  it("declares a JSON Schema input mirroring the V1 justice_review args", async () => {
    const handles = createMockContext();
    const tool = await setupWith(handles, fakeAdapter(null));

    expect(tool.input).toEqual({
      type: "object",
      properties: {
        scope: { type: "string" },
        resolve: {
          type: "object",
          properties: {
            itemKeys: { type: "array", items: { type: "string" } },
            artifactRef: { type: "string" },
          },
          required: ["itemKeys", "artifactRef"],
        },
      },
    });
  });

  it("maps the V2 location directory to the adapter init without guessing a worktree", async () => {
    const handles = createMockContext({ directory: "/abs/location-dir" });
    const createAdapter = vi.fn((_init: OpenCodePluginInit) => fakeAdapter(null));

    await createJusticeV2Plugin({ createAdapter }).setup(handles.context);

    expect(createAdapter).toHaveBeenCalledTimes(1);
    const init = createAdapter.mock.calls[0]?.[0];
    expect(init?.directory).toBe("/abs/location-dir");
    expect(init?.worktree).toBeUndefined();
    expect(init?.project.root).toBeUndefined();
  });
});

describe("V2 entry: negative controls (no unverified Domain Hook mapping)", () => {
  it("registers no session/tool/event/command hooks beyond the justice_review tool", async () => {
    const handles = createMockContext();

    await createJusticeV2Plugin({ createAdapter: () => fakeAdapter(null) }).setup(handles.context);

    expect(handles.sessionHook).not.toHaveBeenCalled();
    expect(handles.toolHook).not.toHaveBeenCalled();
    expect(handles.eventSubscribe).not.toHaveBeenCalled();
    expect(handles.commandTransform).not.toHaveBeenCalled();
  });
});

describe("V2 entry: justice_review execution", () => {
  it("returns the read-only review summary from the adapter's observation log", async () => {
    const store = await createReviewStore();
    const adapter = fakeAdapter(store);
    const tool = await setupWith(createMockContext(), adapter);

    const result = await tool.execute({}, toolContext());

    expect(adapter.ensureInitialized).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(contentOf(result)) as { open: ReadonlyArray<{ itemKey: string }> };
    expect(parsed.open.map((item) => item.itemKey)).toEqual(["major:v2"]);
    expect(result.metadata).toBeUndefined();
  });

  it("denies resolve fail-closed because the V2 ToolContext has no approval channel", async () => {
    const store = await createReviewStore();
    const before = await store.readAll();
    const tool = await setupWith(createMockContext(), fakeAdapter(store));

    const result = await tool.execute(
      { scope: "task-v2", resolve: { itemKeys: ["major:v2"], artifactRef: "artifact://v2" } },
      toolContext(),
    );

    expect(contentOf(result)).toContain("Review resolution was not approved.");
    expect(result.metadata).toBeUndefined();
    expect(await store.readAll()).toEqual(before);
  });

  it("rejects malformed input without touching the adapter", async () => {
    const adapter = fakeAdapter(await createReviewStore());
    const tool = await setupWith(createMockContext(), adapter);

    const result = await tool.execute({ scope: 123 }, toolContext());

    expect(contentOf(result)).toContain("ERROR");
    expect(contentOf(result)).toContain("Invalid justice_review input");
    expect(adapter.ensureInitialized).not.toHaveBeenCalled();
  });

  it("reports an uninitialized Justice instead of a verdict", async () => {
    const tool = await setupWith(createMockContext(), fakeAdapter(null));

    const result = await tool.execute({}, toolContext());

    expect(contentOf(result)).toContain("Justice not initialized");
  });

  it("is fail-open when adapter initialization throws", async () => {
    const adapter = fakeAdapter(null);
    adapter.ensureInitialized.mockRejectedValueOnce(new Error("init boom"));
    const tool = await setupWith(createMockContext(), adapter);

    const result = await tool.execute({}, toolContext());

    expect(contentOf(result)).toContain("ERROR");
    expect(contentOf(result)).toContain("init boom");
  });
});

describe("V2 entry: setup/cleanup fail-open", () => {
  it("resolves setup when tool.transform rejects", async () => {
    const handles = createMockContext({ transformError: new Error("transform boom") });
    const plugin = createJusticeV2Plugin({ createAdapter: () => fakeAdapter(null) });

    await expect(plugin.setup(handles.context)).resolves.not.toThrow();
    expect(handles.added).toHaveLength(0);
  });

  it("resolves setup when adapter construction throws", async () => {
    const handles = createMockContext();
    const plugin = createJusticeV2Plugin({
      createAdapter: () => {
        throw new Error("adapter boom");
      },
    });

    await expect(plugin.setup(handles.context)).resolves.not.toThrow();
    expect(handles.toolTransform).not.toHaveBeenCalled();
  });

  it("returns a cleanup that disposes the tool registration and swallows dispose errors", async () => {
    const handles = createMockContext({ disposeError: new Error("dispose boom") });
    const plugin = createJusticeV2Plugin({ createAdapter: () => fakeAdapter(null) });

    const cleanup = await plugin.setup(handles.context);

    expect(typeof cleanup).toBe("function");
    if (typeof cleanup !== "function") return;
    await expect(cleanup()).resolves.toBeUndefined();
    expect(handles.dispose).toHaveBeenCalledTimes(1);
  });
});
