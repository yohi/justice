import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin";
import type { ToolContext, ToolEditor } from "@opencode/plugin/promise/tool";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JusticeV2Plugin, {
  createJusticeV2Plugin,
  type JusticeV2AdapterPort,
} from "../../src/opencode-v2-plugin";
import JusticeV2ServerEntry from "../../src/opencode-v2-server";
import type { OpenCodePluginInit } from "../../src/runtime/opencode-adapter";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/runtime/justice-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/runtime/justice-tools")>();
  executeMock.mockImplementation(actual.executeJusticeReviewTool);
  return { ...actual, executeJusticeReviewTool: executeMock };
});

type AddedTool = Parameters<ToolEditor["add"]>[0];

interface Handles {
  readonly context: Plugin.Context;
  readonly added: AddedTool[];
  readonly dispose: ReturnType<typeof vi.fn>;
}

function createContext(
  options: {
    readonly location?: unknown;
    readonly transformError?: Error;
    readonly disposeError?: Error;
  } = {},
): Handles {
  const added: AddedTool[] = [];
  const dispose = vi.fn(async (): Promise<void> => {
    if (options.disposeError) throw options.disposeError;
  });
  const editor = {
    add: (tool: AddedTool): void => {
      added.push(tool);
    },
  } as unknown as ToolEditor;
  const transform = vi.fn(async (callback: (input: ToolEditor) => void) => {
    if (options.transformError) throw options.transformError;
    callback(editor);
    return { dispose };
  });
  const context = {
    location: options.location,
    tool: { transform },
  } as unknown as Plugin.Context;
  return { context, added, dispose };
}

function toolContext(): ToolContext {
  return {
    sessionID: "ses_cov",
    agent: "build",
    messageID: "msg_cov",
    id: "call_cov",
    signal: new AbortController().signal,
    progress: async (): Promise<void> => undefined,
  } as unknown as ToolContext;
}

function adapterWith(overrides: {
  readonly ensureInitialized?: () => Promise<void>;
  readonly getJustice?: () => unknown;
}): JusticeV2AdapterPort & { readonly ensureInitialized: ReturnType<typeof vi.fn> } {
  return {
    ensureInitialized: vi.fn(overrides.ensureInitialized ?? (async (): Promise<void> => undefined)),
    getJustice: overrides.getJustice ?? ((): null => null),
    log: vi.fn(async (): Promise<void> => undefined),
  } as unknown as JusticeV2AdapterPort & { readonly ensureInitialized: ReturnType<typeof vi.fn> };
}

async function registerTool(adapter: JusticeV2AdapterPort): Promise<AddedTool> {
  const handles = createContext({ location: { directory: tmpdir() } });
  await createJusticeV2Plugin({ createAdapter: () => adapter }).setup(handles.context);
  const tool = handles.added[0];
  if (tool === undefined) throw new Error("justice_review was not registered");
  return tool;
}

function contentOf(result: { readonly content?: unknown }): string {
  return typeof result.content === "string" ? result.content : JSON.stringify(result.content);
}

function parsed(result: { readonly content?: unknown }): { status?: string; reason?: string } {
  return JSON.parse(contentOf(result)) as { status?: string; reason?: string };
}

describe("V2 entry: input validation (parseReviewArgs)", () => {
  const invalidInputs: ReadonlyArray<readonly [string, unknown]> = [
    ["array input", []],
    ["string input", "scope"],
    ["number input", 42],
    ["non-string scope", { scope: 1 }],
    ["non-object resolve", { resolve: "x" }],
    ["array resolve", { resolve: [] }],
    ["non-array itemKeys", { resolve: { itemKeys: "a", artifactRef: "r" } }],
    ["non-string itemKeys element", { resolve: { itemKeys: ["a", 2], artifactRef: "r" } }],
    ["non-string artifactRef", { resolve: { itemKeys: ["a"], artifactRef: 5 } }],
    ["missing artifactRef", { resolve: { itemKeys: ["a"] } }],
  ];

  it.each(invalidInputs)("rejects %s without touching the adapter", async (_name, input) => {
    const adapter = adapterWith({});
    const tool = await registerTool(adapter);

    const result = await tool.execute(input, toolContext());

    expect(parsed(result)).toEqual({ status: "ERROR", reason: "Invalid justice_review input" });
    expect(adapter.ensureInitialized).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty object", {}],
    ["scope only", { scope: "task-x" }],
    ["scope and resolve", { scope: "task-x", resolve: { itemKeys: ["a"], artifactRef: "ref" } }],
    ["resolve only", { resolve: { itemKeys: [], artifactRef: "ref" } }],
  ])("accepts %s and proceeds to adapter initialization", async (_name, input) => {
    const adapter = adapterWith({});
    const tool = await registerTool(adapter);

    const result = await tool.execute(input, toolContext());

    expect(adapter.ensureInitialized).toHaveBeenCalledTimes(1);
    expect(parsed(result)).toEqual({ status: "ERROR", reason: "Justice not initialized" });
  });
});

describe("V2 entry: execute failure handling", () => {
  it("returns an ERROR payload carrying the message when initialization throws an Error", async () => {
    const tool = await registerTool(
      adapterWith({
        ensureInitialized: async (): Promise<void> => {
          throw new Error("init boom");
        },
      }),
    );

    expect(parsed(await tool.execute({}, toolContext()))).toEqual({
      status: "ERROR",
      reason: "init boom",
    });
  });

  it("stringifies a non-Error thrown value", async () => {
    const tool = await registerTool(
      adapterWith({
        ensureInitialized: async (): Promise<void> => {
          throw "plain string failure";
        },
      }),
    );

    expect(parsed(await tool.execute({}, toolContext())).reason).toBe("plain string failure");
  });

  it("falls back to a fixed message when the thrown value cannot be printed", async () => {
    const unprintable = {
      toString: (): string => {
        throw new Error("no string for you");
      },
    };
    const tool = await registerTool(
      adapterWith({
        ensureInitialized: async (): Promise<void> => {
          throw unprintable;
        },
      }),
    );

    expect(parsed(await tool.execute({}, toolContext())).reason).toBe("unprintable error");
  });

  it("reports an ERROR when the Justice resolution path throws after initialization", async () => {
    const tool = await registerTool(
      adapterWith({
        getJustice: (): never => {
          throw new Error("getJustice boom");
        },
      }),
    );

    expect(parsed(await tool.execute({}, toolContext()))).toEqual({
      status: "ERROR",
      reason: "getJustice boom",
    });
  });
});

describe("V2 entry: result mapping (toV2Result)", () => {
  beforeEach(() => {
    executeMock.mockClear();
  });

  const justice = {
    getObservationHandler: (): { getLogStore: () => { readAll: () => Promise<unknown[]> } } => ({
      getLogStore: (): { readAll: () => Promise<unknown[]> } => ({
        readAll: async (): Promise<unknown[]> => [],
      }),
    }),
  };

  it("maps a string executor result to { content } only", async () => {
    executeMock.mockResolvedValueOnce("plain summary");
    const tool = await registerTool(adapterWith({ getJustice: () => justice }));

    const result = await tool.execute({ scope: "s" }, toolContext());

    expect(result).toEqual({ content: "plain summary" });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("maps an { output, metadata } executor result to { content, metadata }", async () => {
    const metadata = { reviewResolutionArtifact: { marker: "artifact" } };
    executeMock.mockResolvedValueOnce({ output: "resolved", metadata });
    const tool = await registerTool(adapterWith({ getJustice: () => justice }));

    const result = await tool.execute({}, toolContext());

    expect(result).toEqual({ content: "resolved", metadata });
  });

  it("passes parsed args and a fail-closed approval callback to the executor", async () => {
    executeMock.mockResolvedValueOnce("ok");
    const tool = await registerTool(adapterWith({ getJustice: () => justice }));

    await tool.execute(
      { scope: "task-x", resolve: { itemKeys: ["a", "b"], artifactRef: "ref" } },
      toolContext(),
    );

    const input = executeMock.mock.calls[0]?.[0] as {
      args: unknown;
      requestApproval: () => Promise<void>;
    };
    expect(input.args).toEqual({
      scope: "task-x",
      resolve: { itemKeys: ["a", "b"], artifactRef: "ref" },
    });
    await expect(input.requestApproval()).rejects.toThrow(
      "approval channel unavailable in the V2 entry",
    );
  });
});

describe("V2 entry: adapter init (toAdapterInit)", () => {
  async function captureInit(location: unknown): Promise<OpenCodePluginInit> {
    let captured: OpenCodePluginInit | undefined;
    const handles = createContext({ location });
    await createJusticeV2Plugin({
      createAdapter: (init) => {
        captured = init;
        return adapterWith({});
      },
    }).setup(handles.context);
    if (captured === undefined) throw new Error("createAdapter was not called");
    return captured;
  }

  it("passes a present directory through", async () => {
    const directory = mkdtempSync(join(tmpdir(), "v2-cov-"));
    const init = await captureInit({ directory });
    expect(init.directory).toBe(directory);
  });

  it.each([
    ["missing location", undefined],
    ["missing directory", {}],
    ["empty directory", { directory: "" }],
    ["non-string directory", { directory: 7 }],
  ])("omits directory for %s", async (_name, location) => {
    const init = await captureInit(location);
    expect("directory" in init).toBe(false);
  });

  it("drops diagnostics from the client log and refuses shell access", async () => {
    const init = await captureInit({ directory: tmpdir() });
    const log = (init.client as { app: { log: (...args: unknown[]) => unknown } }).app.log;
    expect(log({ body: "x" })).toBeUndefined();
    expect(() => (init.$ as unknown as () => unknown)()).toThrow(
      "shell is not available to the Justice V2 entry",
    );
  });
});

describe("V2 entry: setup and cleanup", () => {
  it("uses the default adapter factory without starting a host when no deps are given", async () => {
    const directory = mkdtempSync(join(tmpdir(), "v2-cov-default-"));
    const handles = createContext({ location: { directory } });

    const cleanup = await createJusticeV2Plugin().setup(handles.context);

    expect(handles.added.map((tool) => tool.name)).toEqual(["justice_review"]);
    expect(typeof cleanup).toBe("function");
    if (typeof cleanup === "function") await cleanup();
    expect(handles.dispose).toHaveBeenCalledTimes(1);
  });

  it("returns undefined (fail-open) when tool.transform rejects", async () => {
    const handles = createContext({ transformError: new Error("transform failed") });

    const cleanup = await createJusticeV2Plugin({ createAdapter: () => adapterWith({}) }).setup(
      handles.context,
    );

    expect(cleanup).toBeUndefined();
    expect(handles.added).toHaveLength(0);
  });

  it("returns undefined (fail-open) when the adapter factory throws", async () => {
    const handles = createContext();
    const cleanup = await createJusticeV2Plugin({
      createAdapter: () => {
        throw new Error("factory failed");
      },
    }).setup(handles.context);

    expect(cleanup).toBeUndefined();
  });

  it("swallows a rejecting registration.dispose during cleanup", async () => {
    const handles = createContext({ disposeError: new Error("dispose failed") });
    const cleanup = await createJusticeV2Plugin({ createAdapter: () => adapterWith({}) }).setup(
      handles.context,
    );

    expect(typeof cleanup).toBe("function");
    if (typeof cleanup !== "function") throw new Error("expected cleanup function");
    await expect(cleanup()).resolves.toBeUndefined();
    expect(handles.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("V2 entries: module shape", () => {
  it("exposes the justice plugin id and a setup function from the default export", () => {
    expect(JusticeV2Plugin.id).toBe("justice");
    expect(typeof JusticeV2Plugin.setup).toBe("function");
  });

  it("re-exports the same plugin from the server type entry", () => {
    expect(JusticeV2ServerEntry).toBe(JusticeV2Plugin);
    expect(JusticeV2ServerEntry.id).toBe("justice");
    expect(typeof JusticeV2ServerEntry.setup).toBe("function");
  });
});
