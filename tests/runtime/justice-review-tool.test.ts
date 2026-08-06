import { createOpencodeClient } from "@opencode-ai/sdk";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput, ToolContext, ToolResult } from "@opencode-ai/plugin";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import type { ShardId } from "../../src/core/types";
import type { ReviewItem } from "../../src/core/v2/observation-model";
import {
  executeJusticeReviewTool,
  type JusticeReviewToolArgs,
} from "../../src/runtime/justice-tools";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMemFs } from "../helpers/mock-file-system";

function createShell(): PluginInput["$"] {
  const unimplemented = (..._args: unknown[]): never => {
    throw new Error("test shell must not execute");
  };
  const shell: PluginInput["$"] = Object.assign(unimplemented, {
    braces: (_pattern: string): string[] => [],
    escape: (input: string): string => input,
    env: (): PluginInput["$"] => shell,
    cwd: (): PluginInput["$"] => shell,
    nothrow: (): PluginInput["$"] => shell,
    throws: (_shouldThrow: boolean): PluginInput["$"] => shell,
  });
  return shell;
}

function createPluginInput(): PluginInput {
  return {
    client: createOpencodeClient(),
    project: {
      id: "justice-review-test",
      worktree: "/tmp/justice-review-test",
      time: { created: 0 },
    },
    directory: "/tmp/justice-review-test",
    worktree: "/tmp/justice-review-test",
    experimental_workspace: {
      register: (): void => {},
    },
    serverUrl: new URL("http://localhost"),
    $: createShell(),
  };
}

function reviewItem(itemKey: string): ReviewItem {
  return {
    itemKey,
    evidenceId: itemKey,
    severity: "major",
    summary: itemKey,
    location: "src/example.ts",
    status: "open",
  };
}

async function createReviewStore(): Promise<ObservationLogStore> {
  const { reader, writer } = createMemFs();
  const store = new ObservationLogStore(writer, reader, "w-review");
  const shard: ShardId = {
    agentId: "atlas",
    sessionId: "session-review",
    writerId: "w-review",
  };
  await store.append(shard, {
    schemaVersion: 1,
    timestamp: "2026-07-18T00:00:00.000Z",
    agentId: shard.agentId,
    sessionId: shard.sessionId,
    writerId: shard.writerId,
    recordType: "observation",
    kind: "review_observed",
    reviewScope: "task-6.3",
    items: [reviewItem("major:parser")],
  });
  return store;
}

function executeReviewTool(input: {
  readonly store: ObservationLogStore;
  readonly args: JusticeReviewToolArgs;
  readonly ask: ToolContext["ask"];
}): Promise<ToolResult> {
  return executeJusticeReviewTool({
    logReader: input.store,
    args: input.args,
    requestApproval: async (approval): Promise<void> => {
      await Effect.runPromise(input.ask(approval) as unknown as Effect.Effect<void>);
    },
  });
}

function outputOf(result: ToolResult): string {
  return typeof result === "string" ? result : result.output;
}

function metadataOf(result: ToolResult): Record<string, unknown> | undefined {
  return typeof result === "string" ? undefined : result.metadata;
}

describe("OpenCodePlugin justice_review tool", () => {
  it("registers justice_review as the sole public Justice custom tool", async () => {
    // Given
    const pluginInput = createPluginInput();

    // When
    const hooks = await OpenCodePlugin(pluginInput);

    // Then
    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual(["justice_review"]);
  });
});

describe("defineJusticeReviewTool", () => {
  it("returns a read-only summary without asking for approval", async () => {
    // Given
    const store = await createReviewStore();
    const before = await store.readAll();
    const ask = vi.fn(() => Effect.succeed(undefined));

    // When
    const result = await executeReviewTool({ store, args: {}, ask });

    // Then
    expect(JSON.parse(outputOf(result))).toMatchObject({
      authority: "observed_review_output",
      open: [{ itemKey: "major:parser" }],
    });
    expect(JSON.parse(outputOf(result))).not.toHaveProperty("authorship");
    expect(metadataOf(result)).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
    expect(await store.readAll()).toEqual(before);
  });

  it("returns the scoped summary for a padded read-only scope", async () => {
    // Given
    const store = await createReviewStore();
    const ask = vi.fn(() => Effect.succeed(undefined));

    // When
    const result = await executeReviewTool({ store, args: { scope: " task-6.3 " }, ask });

    // Then
    expect(JSON.parse(outputOf(result))).toMatchObject({
      critical: [],
      major: [{ itemKey: "major:parser" }],
      minor: [],
      resolved: [],
      open: [{ itemKey: "major:parser" }],
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("returns an error when requesting an unknown scope", async () => {
    // Given
    const store = await createReviewStore();
    const ask = vi.fn(() => Effect.succeed(undefined));

    // When
    const result = await executeReviewTool({ store, args: { scope: "non-existent" }, ask });

    // Then
    expect(JSON.parse(outputOf(result))).toEqual({
      status: "ERROR",
      reason: "Unknown review scope: non-existent",
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("returns the full summary for a whitespace-only read-only scope", async () => {
    // Given
    const store = await createReviewStore();
    const ask = vi.fn(() => Effect.succeed(undefined));

    // When
    const result = await executeReviewTool({ store, args: { scope: "   " }, ask });

    // Then
    expect(JSON.parse(outputOf(result))).toMatchObject({
      authority: "observed_review_output",
      open: [{ itemKey: "major:parser" }],
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("returns a normalized human-approved artifact only after approval for current open items", async () => {
    // Given
    const store = await createReviewStore();
    const ask = vi.fn(() => Effect.succeed(undefined));

    // When
    const result = await executeReviewTool({
      store,
      args: {
        scope: " task-6.3 ",
        resolve: {
          itemKeys: [" major:parser "],
          artifactRef: " refs/reviews/task-6.3 ",
        },
      },
      ask,
    });

    // Then
    expect(ask).toHaveBeenCalledWith({
      permission: "justice_review.resolve",
      patterns: ["task-6.3", "major:parser"],
      always: [],
      metadata: {
        reviewScope: "task-6.3",
        itemKeys: ["major:parser"],
        artifactRef: "refs/reviews/task-6.3",
      },
    });
    expect(metadataOf(result)).toEqual({
      reviewResolutionArtifact: {
        authority: "human_approved",
        reviewScope: "task-6.3",
        itemKeys: ["major:parser"],
        artifactRef: "refs/reviews/task-6.3",
      },
    });
  });

  it("rejects a resolve request without a non-empty scope before asking for approval", async () => {
    // Given
    const store = await createReviewStore();
    const ask = vi.fn(() => Effect.succeed(undefined));

    // When
    const result = await executeReviewTool({
      store,
      args: {
        resolve: { itemKeys: ["major:parser"], artifactRef: "refs/reviews/task-6.3" },
      },
      ask,
    });

    // Then
    expect(outputOf(result)).toBe(
      JSON.stringify(
        {
          status: "ERROR",
          reason: "Review resolution requires a non-empty scope. Provide scope when using resolve.",
        },
        null,
        2,
      ),
    );
    expect(metadataOf(result)).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it("rejects a resolution request for items that are not currently open without prompting", async () => {
    // Given
    const store = await createReviewStore();
    const ask = vi.fn(() => Effect.succeed(undefined));

    // When
    const result = await executeReviewTool({
      store,
      args: {
        scope: "task-6.3",
        resolve: { itemKeys: ["major:missing"], artifactRef: "refs/reviews/task-6.3" },
      },
      ask,
    });

    // Then
    expect(JSON.parse(outputOf(result))).toMatchObject({ status: "ERROR" });
    expect(metadataOf(result)).toBeUndefined();
    expect(ask).not.toHaveBeenCalled();
  });

  it("returns an informational error without metadata or state changes when approval is denied", async () => {
    // Given
    const store = await createReviewStore();
    const before = await store.readAll();
    const ask = vi.fn(() => Effect.promise(() => Promise.reject(new Error("denied"))));

    // When
    const result = await executeReviewTool({
      store,
      args: {
        scope: "task-6.3",
        resolve: { itemKeys: ["major:parser"], artifactRef: "refs/reviews/task-6.3" },
      },
      ask,
    });

    // Then
    expect(JSON.parse(outputOf(result))).toMatchObject({ status: "ERROR" });
    expect(metadataOf(result)).toBeUndefined();
    expect(await store.readAll()).toEqual(before);
  });
});

describe("defineJusticeReviewTool via OpenCodeAdapter", () => {
  function createToolContext(agent = "sisyphus", sessionID = "session-1"): ToolContext {
    return {
      sessionID,
      messageID: "message-1",
      agent,
      directory: ".",
      worktree: ".",
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: (): never => {
        throw new Error("justice_review must not request permission in this test case");
      },
    };
  }

  it("returns a review summary via the adapter tool definition", async () => {
    // Given
    const testDir = join(tmpdir(), `justice-review-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const adapter = new OpenCodeAdapter(
      fakeInit({ project: { root: testDir }, directory: testDir, worktree: testDir }),
    );
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");

    const observationHandler = justice.getObservationHandler();
    const logStore =
      observationHandler.getLogStore() as import("../../src/runtime/observation-log-store").ObservationLogStore;
    const shard: import("../../src/core/types").ShardId = {
      agentId: "atlas",
      sessionId: "session-review",
      writerId: logStore.getWriterId(),
    };
    await logStore.append(shard, {
      schemaVersion: 1,
      timestamp: "2026-07-18T00:00:00.000Z",
      agentId: shard.agentId,
      sessionId: shard.sessionId,
      writerId: shard.writerId,
      recordType: "observation",
      kind: "review_observed",
      reviewScope: "task-6.3",
      items: [reviewItem("major:adapter")],
    });

    const definition = adapter.getTools().justice_review;
    if (definition === undefined) throw new Error("justice_review definition is missing");

    // When
    const result = await definition.execute({}, createToolContext());

    // Then
    const output = typeof result === "string" ? result : result.output;
    const parsed = JSON.parse(output);
    expect(parsed.authority).toBe("observed_review_output");
    expect(parsed.open.length).toBeGreaterThanOrEqual(1);
    expect(parsed.open[0]).toMatchObject({ itemKey: "major:adapter" });
  });

  it("requests approval through context.ask when resolving", async () => {
    // Given
    const testDir = join(tmpdir(), `justice-review-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    const adapter = new OpenCodeAdapter(
      fakeInit({ project: { root: testDir }, directory: testDir, worktree: testDir }),
    );
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");

    const observationHandler = justice.getObservationHandler();
    const logStore =
      observationHandler.getLogStore() as import("../../src/runtime/observation-log-store").ObservationLogStore;
    const shard: import("../../src/core/types").ShardId = {
      agentId: "atlas",
      sessionId: "session-review",
      writerId: logStore.getWriterId(),
    };
    await logStore.append(shard, {
      schemaVersion: 1,
      timestamp: "2026-07-18T00:00:00.000Z",
      agentId: shard.agentId,
      sessionId: shard.sessionId,
      writerId: shard.writerId,
      recordType: "observation",
      kind: "review_observed",
      reviewScope: "task-6.3",
      items: [reviewItem("major:resolve")],
    });

    const ask = vi.fn(() => Effect.succeed(undefined));
    const definition = adapter.getTools().justice_review;
    if (definition === undefined) throw new Error("justice_review definition is missing");

    // When
    const result = await definition.execute(
      {
        scope: "task-6.3",
        resolve: { itemKeys: ["major:resolve"], artifactRef: "refs/reviews/task-6.3" },
      },
      { ...createToolContext(), ask },
    );

    // Then
    expect(ask).toHaveBeenCalledWith({
      permission: "justice_review.resolve",
      patterns: ["task-6.3", "major:resolve"],
      always: [],
      metadata: {
        reviewScope: "task-6.3",
        itemKeys: ["major:resolve"],
        artifactRef: "refs/reviews/task-6.3",
      },
    });

    const metadata = typeof result === "string" ? undefined : result.metadata;
    expect(metadata).toEqual({
      reviewResolutionArtifact: {
        authority: "human_approved",
        reviewScope: "task-6.3",
        itemKeys: ["major:resolve"],
        artifactRef: "refs/reviews/task-6.3",
      },
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
    const definition = adapter.getTools().justice_review;
    if (definition === undefined) throw new Error("justice_review definition is missing");

    // When
    const result = await definition.execute({}, createToolContext());

    // Then
    const output = typeof result === "string" ? result : result.output;
    expect(JSON.parse(output)).toEqual({
      status: "ERROR",
      reason: "Justice not initialized",
    });
  });

  it("falls through to the outer catch when readAll throws", async () => {
    // Given
    const ask = vi.fn(() => Effect.succeed(undefined));
    const failingReader = {
      readAll: vi.fn(() => Promise.reject(new Error("disk read failed"))),
    };

    // When
    const result = await executeJusticeReviewTool({
      logReader: failingReader,
      args: {},
      requestApproval: async (approval): Promise<void> => {
        await Effect.runPromise(ask(approval) as unknown as Effect.Effect<void>);
      },
    });

    // Then
    expect(JSON.parse(outputOf(result))).toEqual({
      status: "ERROR",
      reason: "Unable to read the current review state: disk read failed",
    });
  });

  it("falls through to the adapter outer catch when ensureInitialized throws", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    vi.spyOn(adapter, "ensureInitialized").mockRejectedValue(new Error("init boom"));
    const definition = adapter.getTools().justice_review;
    if (definition === undefined) throw new Error("justice_review definition is missing");

    // When
    const result = await definition.execute({}, createToolContext());

    // Then
    const output = typeof result === "string" ? result : result.output;
    expect(JSON.parse(output)).toEqual({
      status: "ERROR",
      reason: "init boom",
    });
  });
});

describe("health section", () => {
  const baseInput = {
    args: {},
    requestApproval: async () => {},
  };

  it("adds a health section to the scope-less view", async () => {
    const logReader = {
      readAll: async () => [],
      getRotationHealth: () => ({
        consecutiveFailures: 0,
        degraded: false,
        lastError: undefined,
      }),
      getLastReadIntegrity: () => ({ hasIntegrityViolation: false }),
      getLastSuccessfulWriteAt: () => "2026-08-02T00:00:00.000Z",
    };
    const result = await executeJusticeReviewTool({ ...baseInput, logReader });
    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result as string) as Record<string, unknown>;
    expect(parsed.health).toEqual({
      recordCount: 0,
      shardCount: 0,
      lastSuccessfulWriteAt: "2026-08-02T00:00:00.000Z",
      rotationHealth: { consecutiveFailures: 0, degraded: false },
      readIntegrity: { hasIntegrityViolation: false },
    });
  });

  it("returns the view body without health when health collection fails (fail-open)", async () => {
    const logReader = {
      readAll: async () => [],
      getRotationHealth: () => {
        throw new Error("boom");
      },
    };
    const result = await executeJusticeReviewTool({ ...baseInput, logReader });
    expect(typeof result).toBe("string");
    const parsed = JSON.parse(result as string) as Record<string, unknown>;
    expect(parsed.authority).toBe("observed_review_output");
    expect(parsed.health).toBeUndefined();
  });

  it("omits health gracefully for a legacy readAll-only logReader", async () => {
    const logReader = { readAll: async () => [] };
    const result = await executeJusticeReviewTool({ ...baseInput, logReader });
    const parsed = JSON.parse(result as string) as Record<string, unknown>;
    expect(parsed.authority).toBe("observed_review_output");
    expect((parsed.health as Record<string, unknown> | undefined)?.recordCount).toBe(0);
  });

  it("handles corrupted record fields gracefully in health collection", async () => {
    const logReader = {
      readAll: async () => [
        {
          agentId: 123,
          sessionId: true,
          writerId: null,
          schemaVersion: 1,
          timestamp: "2026-08-01T00:00:00.000Z",
          recordType: "observation",
          kind: "review_observed",
          reviewScope: "task-1",
          items: [],
        } as unknown as import("../../src/core/v2/observation-model").PersistedLogRecord,
      ],
      getRotationHealth: () => ({ consecutiveFailures: 0, degraded: false, lastError: undefined }),
      getLastReadIntegrity: () => ({ hasIntegrityViolation: false }),
      getLastSuccessfulWriteAt: () => undefined,
    };
    const result = await executeJusticeReviewTool({ args: {}, requestApproval: async () => {}, logReader });
    const parsed = JSON.parse(result as string) as Record<string, unknown>;
    expect(parsed.health).toEqual({
      recordCount: 1,
      shardCount: 1,
      rotationHealth: { consecutiveFailures: 0, degraded: false },
      readIntegrity: { hasIntegrityViolation: false },
    });
  });
});
