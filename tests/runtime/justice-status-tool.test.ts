import type { ToolContext, ToolResult } from "@opencode-ai/plugin";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

const serializedStateSchema = z.object({
  schemaVersion: z.literal(2),
  rebuiltAt: z.string(),
  integrity: z.object({
    sourceHash: z.string(),
    maxSequenceByShard: z.record(z.string(), z.number()),
  }),
  tasks: z.record(z.string(), z.unknown()),
  reviewSummary: z.object({
    authority: z.literal("observed_review_output"),
    critical: z.array(z.unknown()),
    major: z.array(z.unknown()),
    minor: z.array(z.unknown()),
    resolved: z.array(z.unknown()),
    open: z.array(z.unknown()),
    byScope: z.record(z.string(), z.unknown()),
  }),
});

const errorResultSchema = z.object({
  status: z.literal("ERROR"),
  reason: z.string(),
});

function createToolContext(): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "sisyphus",
    directory: ".",
    worktree: ".",
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: (): never => {
      throw new Error("justice_status must not request permission");
    },
  };
}

function requireStringResult(result: ToolResult): string {
  if (typeof result !== "string") {
    throw new Error("Expected justice_status to return a string result");
  }
  return result;
}

describe("justice_status tool", () => {
  it("registers justice_status on the plugin tool hook", async () => {
    // Given
    const init = fakeInit();

    // When
    const hooks = await OpenCodePlugin(init as never);

    // Then
    expect(hooks.tool).toHaveProperty("justice_status");
  });

  it("resolves Justice lazily when the registered tool executes", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");
    expect(adapter.getJustice()).toBeNull();

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(adapter.getJustice()).not.toBeNull();
    expect(serializedStateSchema.parse(JSON.parse(output)).schemaVersion).toBe(2);
  });

  it("projects the observation log and refreshes the projection cache", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    const logStore = observationHandler.getLogStore();
    const projectionCache = observationHandler.getProjectionCache();
    if (projectionCache === undefined) throw new Error("Projection cache fixture is missing");
    vi.spyOn(logStore, "readAll").mockResolvedValue([]);
    const cacheWrite = vi.spyOn(projectionCache, "write").mockResolvedValue(undefined);
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    const parsed = serializedStateSchema.parse(JSON.parse(output));
    expect(parsed.tasks).toEqual({});
    expect(parsed.reviewSummary.open).toEqual([]);
    expect(cacheWrite).toHaveBeenCalledTimes(1);
  });

  it("returns the projected state when the projection cache write fails", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    vi.spyOn(observationHandler.getLogStore(), "readAll").mockResolvedValue([]);
    const projectionCache = observationHandler.getProjectionCache();
    if (projectionCache === undefined) throw new Error("Projection cache fixture is missing");
    vi.spyOn(projectionCache, "write").mockRejectedValue(new Error("cache unavailable"));
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    const parsed = serializedStateSchema.parse(JSON.parse(output));
    expect(parsed.tasks).toEqual({});
    expect(parsed.reviewSummary.open).toEqual([]);
  });

  it("returns the projected state when no projection cache is configured", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    vi.spyOn(observationHandler.getLogStore(), "readAll").mockResolvedValue([]);
    vi.spyOn(observationHandler, "getProjectionCache").mockReturnValue(undefined);
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(serializedStateSchema.parse(JSON.parse(output)).tasks).toEqual({});
  });

  it("logs a warning when the projection cache write fails", async () => {
    // Given
    const log = vi.fn().mockResolvedValue(undefined);
    const adapter = new OpenCodeAdapter(fakeInit({ client: { app: { log } } }));
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    vi.spyOn(observationHandler.getLogStore(), "readAll").mockResolvedValue([]);
    const projectionCache = observationHandler.getProjectionCache();
    if (projectionCache === undefined) throw new Error("Projection cache fixture is missing");
    const cacheError = new Error("cache unavailable");
    vi.spyOn(projectionCache, "write").mockRejectedValue(cacheError);
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");

    // When
    await definition.execute({}, createToolContext());

    // Then
    expect(log).toHaveBeenCalledWith({
      level: "warn",
      service: "justice",
      message: "[Justice] justice_status projection cache write failed",
      extra: { args: [cacheError] },
    });
  });

  it("fails open with JSON ERROR when the observation log cannot be read", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    vi.spyOn(justice.getObservationHandler().getLogStore(), "readAll").mockRejectedValue(
      new Error("corrupted observation log"),
    );
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "corrupted observation log",
    });
  });

  it("stringifies non-Error observation log failures", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    vi.spyOn(justice.getObservationHandler().getLogStore(), "readAll").mockRejectedValue(
      "corrupted observation log",
    );
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "corrupted observation log",
    });
  });

  it("fails open with JSON ERROR when Justice cannot initialize", async () => {
    // Given
    const adapter = new OpenCodeAdapter(
      fakeInit({
        project: { root: undefined },
        directory: undefined,
        worktree: undefined,
      }),
    );
    const definition = adapter.getTools().justice_status;
    if (definition === undefined) throw new Error("justice_status definition is missing");

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "Justice not initialized",
    });
  });
});
