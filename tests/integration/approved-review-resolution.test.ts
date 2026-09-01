import { afterEach, describe, expect, it } from "vitest";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type {
  Hooks,
  PluginInput,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "@opencode-ai/plugin";
import { Effect } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import { project } from "../../src/core/v2/state-projection";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";

type PluginHarness = {
  readonly afterToolExecution: NonNullable<Hooks["tool.execute.after"]>;
  readonly beforeToolExecution: NonNullable<Hooks["tool.execute.before"]>;
  readonly logStore: ObservationLogStore;
  readonly reviewTool: ToolDefinition;
  readonly workspace: string;
};

let tempDirectory: string | undefined;

afterEach(async () => {
  if (tempDirectory === undefined) return;
  await rm(tempDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  tempDirectory = undefined;
});

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

function createPluginInput(workspace: string): PluginInput {
  return {
    client: createOpencodeClient(),
    project: {
      id: "approved-review-resolution",
      worktree: workspace,
      time: { created: 0 },
    },
    directory: workspace,
    worktree: workspace,
    experimental_workspace: {
      register: (): void => {},
    },
    serverUrl: new URL("http://localhost"),
    $: createShell(),
  };
}

function createToolContext(workspace: string, ask: ToolContext["ask"]): ToolContext {
  return {
    sessionID: "session-review",
    messageID: "message-review",
    agent: "atlas",
    directory: workspace,
    worktree: workspace,
    abort: new AbortController().signal,
    metadata: (): void => {},
    ask,
  };
}

function structuredResult(result: ToolResult): Exclude<ToolResult, string> {
  if (typeof result === "string") {
    throw new Error(`expected a structured review resolution result, received: ${result}`);
  }
  return result;
}

function errorOutput(result: ToolResult): string {
  if (typeof result === "string") return result;
  throw new Error("expected a denied review resolution result");
}

async function createHarness(): Promise<PluginHarness> {
  const workspace = await mkdtemp(join(tmpdir(), "justice-approved-review-"));
  tempDirectory = workspace;
  const hooks = await OpenCodePlugin(createPluginInput(workspace));
  const reviewTool = hooks.tool?.justice_review;
  const beforeToolExecution = hooks["tool.execute.before"];
  const afterToolExecution = hooks["tool.execute.after"];

  if (
    reviewTool === undefined ||
    beforeToolExecution === undefined ||
    afterToolExecution === undefined
  ) {
    throw new Error("Justice plugin must expose the review tool and tool execution hooks");
  }

  const fileSystem = new NodeFileSystem(workspace);
  return {
    reviewTool,
    beforeToolExecution,
    afterToolExecution,
    logStore: new ObservationLogStore(fileSystem, fileSystem, "w-review-inspector"),
    workspace,
  };
}

async function seedOpenReviewItems(harness: PluginHarness): Promise<readonly string[]> {
  // Given
  await harness.beforeToolExecution(
    { tool: "task", sessionID: "session-review", callID: "call-review" },
    { args: { taskId: "task-6.3" } },
  );

  // When
  await harness.afterToolExecution(
    {
      tool: "task",
      sessionID: "session-review",
      callID: "call-review",
      args: { taskId: "task-6.3" },
    },
    {
      title: "review findings",
      output: [
        "BLOCKER: authentication bypass at src/auth.ts:10",
        "MUST FIX: parser regression at src/parser.ts:20",
      ].join("\n"),
      metadata: {},
    },
  );

  // Then
  const state = project(await harness.logStore.readAll(), "2026-07-18T00:00:00.000Z");
  expect(state.reviewSummary.open).toHaveLength(2);
  return state.reviewSummary.open.map((item) => item.itemKey);
}

describe("approved review resolution through OpenCodePlugin", () => {
  it("resolves only the approved selected review item through tool.execute.after", async () => {
    // Given
    const harness = await createHarness();
    const [selectedItemKey, remainingItemKey] = await seedOpenReviewItems(harness);
    if (selectedItemKey === undefined || remainingItemKey === undefined) {
      throw new Error("expected two open review items");
    }
    const approvalRequests: unknown[] = [];
    const approvedContext = createToolContext(harness.workspace, (request) => {
      approvalRequests.push(request);
      return Effect.succeed(undefined);
    });

    // When
    const resolution = structuredResult(
      await harness.reviewTool.execute(
        {
          scope: "task-6.3",
          resolve: {
            itemKeys: [selectedItemKey],
            artifactRef: "docs/reviews/task-6.3.md",
          },
        },
        approvedContext,
      ),
    );
    await harness.afterToolExecution(
      {
        tool: "justice_review",
        sessionID: "session-review",
        callID: "call-resolution",
        args: {
          scope: "task-6.3",
          resolve: {
            itemKeys: [selectedItemKey],
            artifactRef: "docs/reviews/task-6.3.md",
          },
        },
      },
      { title: "review resolution", output: resolution.output, metadata: resolution.metadata },
    );

    // Then
    expect(approvalRequests).toEqual([
      {
        permission: "justice_review.resolve",
        patterns: ["task-6.3", selectedItemKey],
        always: [],
        metadata: {
          reviewScope: "task-6.3",
          itemKeys: [selectedItemKey],
          artifactRef: "docs/reviews/task-6.3.md",
        },
      },
    ]);
    const events = await harness.logStore.readAll();
    expect(
      events.some(
        (event) =>
          event.recordType === "observation" &&
          event.kind === "tool_executed" &&
          event.toolName === "justice_review",
      ),
    ).toBe(false);
    const state = project(events, "2026-07-18T00:00:00.000Z");
    expect(state.reviewSummary.resolved.map((item) => item.itemKey)).toEqual([selectedItemKey]);
    expect(state.reviewSummary.open.map((item) => item.itemKey)).toEqual([remainingItemKey]);
  }, 15_000);

  it("leaves metadata and projected review state unchanged when approval is denied", async () => {
    // Given
    const harness = await createHarness();
    const [selectedItemKey] = await seedOpenReviewItems(harness);
    if (selectedItemKey === undefined) {
      throw new Error("expected an open review item");
    }
    const eventsBeforeDenial = await harness.logStore.readAll();
    const stateBeforeDenial = project(eventsBeforeDenial, "2026-07-18T00:00:00.000Z");
    const deniedContext = createToolContext(harness.workspace, () =>
      Effect.die(new Error("denied")),
    );

    // When
    const denial = await harness.reviewTool.execute(
      {
        scope: "task-6.3",
        resolve: {
          itemKeys: [selectedItemKey],
          artifactRef: "docs/reviews/task-6.3.md",
        },
      },
      deniedContext,
    );
    const output = errorOutput(denial);
    await harness.afterToolExecution(
      {
        tool: "justice_review",
        sessionID: "session-review",
        callID: "call-denied-resolution",
        args: {
          scope: "task-6.3",
          resolve: {
            itemKeys: [selectedItemKey],
            artifactRef: "docs/reviews/task-6.3.md",
          },
        },
      },
      { title: "review resolution denied", output, metadata: undefined },
    );

    // Then
    expect(JSON.parse(output)).toMatchObject({ status: "ERROR" });
    const eventsAfterDenial = await harness.logStore.readAll();
    expect(eventsAfterDenial).toEqual(eventsBeforeDenial);
    const stateAfterDenial = project(eventsAfterDenial, "2026-07-18T00:00:00.000Z");
    expect(stateAfterDenial.reviewSummary).toEqual(stateBeforeDenial.reviewSummary);
    expect(
      eventsAfterDenial.some(
        (event) =>
          event.recordType === "observation" &&
          event.kind === "tool_executed" &&
          event.toolName === "justice_review",
      ),
    ).toBe(false);
  });
});
