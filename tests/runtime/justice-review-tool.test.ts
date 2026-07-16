import type { ToolContext, ToolDefinition, ToolResult } from "@opencode-ai/plugin";
import { describe, expect, it, vi } from "vitest";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import type { ObservationRecord, ReviewItem } from "../../src/core/v2/observation-model";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import type { ReviewSummaryItem, ScopeReviewSummary } from "../../src/core/v2/state-projection";
import { fakeInit } from "../helpers/fake-opencode-init";

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
      throw new Error("justice_review must not request permission");
    },
  };
}

function requireStringResult(result: ToolResult): string {
  if (typeof result !== "string") {
    throw new Error("Expected justice_review to return a string result");
  }
  return result;
}

function requireReviewTool(adapter: OpenCodeAdapter): ToolDefinition {
  const definition = adapter.getTools().justice_review;
  if (definition === undefined) throw new Error("justice_review definition is missing");
  return definition;
}

function reviewEvent(sequence: number, scope = "task-7.3"): ObservationRecord {
  const item: ReviewItem = {
    itemKey: "review-major-1",
    evidenceId: "review-evidence-1",
    severity: "major",
    summary: "Blocking review item",
    location: "src/example.ts",
    status: "open",
  };
  return {
    schemaVersion: 1,
    sequence,
    timestamp: `2026-07-16T00:00:0${sequence}Z`,
    agentId: "atlas",
    sessionId: "source-session",
    writerId: "writer-1",
    recordType: "observation",
    taskId: "task-7.3",
    kind: "review_observed",
    reviewScope: scope,
    items: [item],
  };
}

function projectedReviewItem(sequence: number): ReviewSummaryItem {
  return {
    itemKey: "review-major-1",
    ref: {
      agentId: "atlas",
      sessionId: "source-session",
      writerId: "writer-1",
      sequence,
      kind: "full",
      evidenceId: "review-evidence-1",
    },
    severity: "major",
  };
}

function expectedScopeSummary(sequence: number): ScopeReviewSummary {
  const item = projectedReviewItem(sequence);
  return { critical: [], major: [item], minor: [], resolved: [], open: [item] };
}

describe("justice_review tool", () => {
  it("registers justice_review on the plugin tool hook", async () => {
    // Given
    const init = fakeInit();

    // When
    const hooks = await OpenCodePlugin(init as never);

    // Then
    expect(hooks.tool).toHaveProperty("justice_review");
  });

  it("resolves Justice lazily when the review tool executes", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    const definition = requireReviewTool(adapter);
    expect(adapter.getJustice()).toBeNull();

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(adapter.getJustice()).not.toBeNull();
    expect(JSON.parse(output)).toEqual({
      authority: "observed_review_output",
      critical: [],
      major: [],
      minor: [],
      resolved: [],
      open: [],
      byScope: {},
    });
  });

  it("projects and serializes the unscoped review summary", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const logStore = justice.getObservationHandler().getLogStore();
    vi.spyOn(logStore, "readAll").mockResolvedValue([reviewEvent(1)]);
    const definition = requireReviewTool(adapter);

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    const result = JSON.parse(output);
    const summary = expectedScopeSummary(1);
    expect(result).toEqual({
      authority: "observed_review_output",
      ...summary,
      byScope: { "task-7.3": summary },
    });
  });

  it("returns only the requested scope summary", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    vi.spyOn(justice.getObservationHandler().getLogStore(), "readAll").mockResolvedValue([
      reviewEvent(1, "task-7.3"),
      reviewEvent(2, "task-other"),
    ]);
    const definition = requireReviewTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ scope: "task-7.3" }, createToolContext()),
    );

    // Then
    const result = JSON.parse(output);
    expect(result).toEqual(expectedScopeSummary(1));
  });

  it("returns a JSON ERROR for an unknown scope", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    vi.spyOn(justice.getObservationHandler().getLogStore(), "readAll").mockResolvedValue([
      reviewEvent(1),
    ]);
    const definition = requireReviewTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ scope: "missing-scope" }, createToolContext()),
    );

    // Then
    expect(JSON.parse(output)).toEqual({
      status: "ERROR",
      reason: "Unknown scope: missing-scope",
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
    const definition = requireReviewTool(adapter);

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(JSON.parse(output)).toEqual({
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
    const definition = requireReviewTool(adapter);

    // When
    const output = requireStringResult(await definition.execute({}, createToolContext()));

    // Then
    expect(JSON.parse(output)).toEqual({
      status: "ERROR",
      reason: "Justice not initialized",
    });
  });
});
