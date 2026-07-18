import { createOpencodeClient } from "@opencode-ai/sdk";
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
    evidenceId: `evidence:${itemKey}`,
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
      await Effect.runPromise(input.ask(approval));
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
  it("registers justice_review as the only Justice custom tool", async () => {
    // Given
    const pluginInput = createPluginInput();

    // When
    const hooks = await OpenCodePlugin(pluginInput);

    // Then
    expect(Object.keys(hooks.tool ?? {})).toEqual(["justice_review"]);
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
