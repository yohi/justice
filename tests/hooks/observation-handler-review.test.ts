import { describe, expect, it, vi } from "vitest";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import type { PendingLogRecord } from "../../src/core/v2/observation-model";
import { project } from "../../src/core/v2/state-projection";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import type { GateLoader } from "../../src/runtime/gate-loader";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs } from "../helpers/mock-file-system";

function createHandler(
  options: {
    readonly logger?: { warn(message: string, error: unknown): void };
    readonly gateLoader?: GateLoader;
  } = {},
): {
  readonly handler: ObservationHandler;
  readonly logStore: ObservationLogStore;
  readonly sessionState: SessionStateProvider;
} {
  const { reader, writer } = createMemFs();
  const logStore = new ObservationLogStore(writer, reader, "w-review");
  const sessionState = new SessionStateProvider();
  return {
    handler: new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-review",
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.gateLoader === undefined ? {} : { gateLoader: options.gateLoader }),
    }),
    logStore,
    sessionState,
  };
}

describe("ObservationHandler review observations", () => {
  it("appends every detected review item before projection and redacts persisted text", async () => {
    // Given
    const { handler, logStore, sessionState } = createHandler();
    sessionState.setActiveTaskWindow("call-review", "task-6.3", "session-review");

    // When
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-review",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-6.3" },
        toolResult: [
          "BLOCKER: security vulnerability at /home/alice/project/src/auth.ts:42 GITHUB_TOKEN=ghp_exampleSecret1234567890",
          "MUST FIX: parser regression at src/parser.ts:10",
        ].join("\n"),
        error: false,
        metadata: { isCompleteSnapshot: true },
      },
    });

    // Then
    const events = await logStore.readAll();
    expect(
      events.map((event) => (event.recordType === "observation" ? event.kind : "decision")),
    ).toEqual(["tool_executed", "review_observed"]);
    expect(events[1]).toMatchObject({
      kind: "review_observed",
      taskId: "task-6.3",
      reviewScope: "task-6.3",
      isCompleteSnapshot: false,
      items: [
        {
          severity: "critical",
          location: "[REDACTED_PATH]",
          status: "open",
        },
        {
          severity: "major",
          location: "src/parser.ts:10",
          status: "open",
        },
      ],
    });
    const serializedReview = JSON.stringify(events[1]);
    expect(serializedReview).not.toContain("/home/alice");
    expect(serializedReview).not.toContain("ghp_exampleSecret1234567890");
  });

  it("appends an empty review observation from trusted complete snapshot metadata", async () => {
    // Given
    const { handler, logStore } = createHandler();

    // When
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-complete",
      payload: {
        toolName: "code_review",
        toolInput: {},
        toolResult: "Review complete with no findings",
        error: false,
        metadata: { isCompleteSnapshot: true },
      },
    });

    // Then
    const events = await logStore.readAll();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      kind: "review_observed",
      isCompleteSnapshot: true,
      items: [],
    });
  });

  it.each(["bash", "task", "arbitrary_custom_tool"])(
    "keeps observed review items open when generic %s metadata claims a complete snapshot",
    async (toolName) => {
      // Given
      const { handler, logStore, sessionState } = createHandler();
      const callId = "call-generic-review";
      const toolInput = toolName === "task" ? { taskId: "task-6.3" } : { command: "review" };
      if (toolName === "task") {
        sessionState.setActiveTaskWindow(callId, "task-6.3", "session-review");
      }
      await handler.handlePostToolUse({
        type: "PostToolUse",
        sessionId: "session-review",
        callId,
        payload: {
          toolName,
          toolInput,
          toolResult: "MUST FIX: parser regression at src/parser.ts:10",
          error: false,
        },
      });
      const initialState = project(await logStore.readAll(), "2026-07-18T00:00:00.000Z");
      const initialOpenItemKeys = initialState.reviewSummary.open.map((item) => item.itemKey);

      // When
      if (toolName === "task") {
        sessionState.setActiveTaskWindow(callId, "task-6.3", "session-review");
      }
      await handler.handlePostToolUse({
        type: "PostToolUse",
        sessionId: "session-review",
        callId,
        payload: {
          toolName,
          toolInput,
          toolResult: "Review complete with no findings",
          error: false,
          metadata: { isCompleteSnapshot: true },
        },
      });

      // Then
      const state = project(await logStore.readAll(), "2026-07-18T00:00:00.000Z");
      expect(state.reviewSummary.open.map((item) => item.itemKey)).toEqual(initialOpenItemKeys);
      expect(state.reviewSummary.resolved).toEqual([]);
    },
  );

  it("does not append a review observation without a finding or complete snapshot", async () => {
    // Given
    const { handler, logStore } = createHandler();

    // When
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-clean",
      payload: {
        toolName: "code_review",
        toolInput: {},
        toolResult: "Approved with no changes requested",
        error: false,
      },
    });

    // Then
    const events = await logStore.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "tool_executed" });
  });

  it("does not interpret ordinary command output as a review", async () => {
    const { handler, logStore } = createHandler();

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-command",
      callId: "call-command",
      payload: {
        toolName: "bash",
        toolInput: { command: "bun run test" },
        toolResult: "MUST FIX: fixture text emitted by a test command",
        error: false,
      },
    });

    const events = await logStore.readAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "tool_executed" });
  });

  it("resolves absent items from a trusted complete code review snapshot", async () => {
    const { handler, logStore } = createHandler();
    const initial = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-review",
      payload: {
        toolName: "code_review",
        toolInput: {},
        toolResult: "MUST FIX: parser regression at src/parser.ts:10",
        error: false,
      },
    });
    expect(initial).toEqual({ action: "proceed" });

    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-review",
      payload: {
        toolName: "code_review",
        toolInput: {},
        toolResult: "Review complete with no findings",
        error: false,
        metadata: { isCompleteSnapshot: true },
      },
    });

    const state = project(await logStore.readAll(), "2026-07-18T00:00:00.000Z");
    expect(state.reviewSummary.open).toEqual([]);
    expect(state.reviewSummary.resolved).toHaveLength(1);
  });

  it("does not observe a justice_review call without a typed resolution artifact", async () => {
    // Given
    const { handler, logStore } = createHandler();

    // When
    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-resolution",
      payload: {
        toolName: "justice_review",
        toolInput: {},
        toolResult: "resolved",
        error: false,
      },
    });

    // Then
    expect(response).toEqual({ action: "proceed" });
    expect(await logStore.readAll()).toEqual([]);
  });

  it("records only a resolution marker for a typed justice_review artifact", async () => {
    // Given
    const gateLoader = { load: vi.fn(async () => []) };
    const { handler, logStore } = createHandler({ gateLoader });

    // When
    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-resolution",
      payload: {
        toolName: "justice_review",
        toolInput: {},
        toolResult: "MUST FIX: should not become an inferred observation",
        error: false,
        reviewResolutionArtifact: {
          authority: "human_approved",
          reviewScope: "task-6.3",
          itemKeys: ["major:parser"],
          artifactRef: "docs/reviews/task-6.3.md",
        },
      },
    });

    // Then
    expect(response).toEqual({ action: "proceed" });
    expect(await logStore.readAll()).toMatchObject([
      {
        kind: "review_observed",
        reviewScope: "task-6.3",
        items: [],
        resolutionMarkers: [
          {
            itemKey: "major:parser",
            resolution: "human_artifact",
            artifactRef: "docs/reviews/task-6.3.md",
          },
        ],
      },
    ]);
    expect(gateLoader.load).not.toHaveBeenCalled();
  });

  it("resolves only artifact-identified items after observing the review", async () => {
    // Given
    const { handler, logStore, sessionState } = createHandler();
    sessionState.setActiveTaskWindow("call-review", "task-6.3", "session-review");
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-review",
      payload: {
        toolName: "task",
        toolInput: { taskId: "task-6.3" },
        toolResult: [
          "BLOCKER: authentication bypass at src/auth.ts:10",
          "MUST FIX: parser regression at src/parser.ts:20",
        ].join("\n"),
        error: false,
      },
    });
    const initialEvents = await logStore.readAll();
    const initialReview = initialEvents.find(
      (event) => event.recordType === "observation" && event.kind === "review_observed",
    );
    if (initialReview === undefined) {
      throw new Error("expected an initial review observation");
    }
    const [resolvedItem, openItem] = initialReview.items;
    if (resolvedItem === undefined || openItem === undefined) {
      throw new Error("expected two initial review items");
    }

    // When
    await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-resolution",
      payload: {
        toolName: "bash",
        toolInput: { command: "apply-review-fix" },
        toolResult: "resolved",
        error: false,
        metadata: {
          reviewResolutionArtifact: {
            authority: "human_approved",
            reviewScope: "task-6.3",
            itemKeys: [resolvedItem.itemKey],
            artifactRef: "docs/reviews/task-6.3.md",
          },
        },
        reviewResolutionArtifact: {
          authority: "human_approved",
          reviewScope: "task-6.3",
          itemKeys: [resolvedItem.itemKey],
          artifactRef: "docs/reviews/task-6.3.md",
        },
      },
    });

    // Then
    const state = project(await logStore.readAll(), "2026-07-18T00:00:00.000Z");
    expect(state.reviewSummary.resolved.map((item) => item.itemKey)).toEqual([resolvedItem.itemKey]);
    expect(state.reviewSummary.open.map((item) => item.itemKey)).toEqual([openItem.itemKey]);
  });

  it("fails open when appending a review observation fails", async () => {
    // Given
    const logger = { warn: vi.fn() };
    const sessionState = new SessionStateProvider();
    const appended: PendingLogRecord[] = [];
    const logStore = {
      append: vi.fn(async (_shardId, record: PendingLogRecord) => {
        if (record.recordType === "observation" && record.kind === "review_observed") {
          throw new Error("review append failed");
        }
        appended.push(record);
        return 0;
      }),
      readAll: vi.fn(async () => []),
    } as unknown as ObservationLogStore;
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: sessionState,
      writerId: "w-review",
      logger,
    });

    // When
    const response = await handler.handlePostToolUse({
      type: "PostToolUse",
      sessionId: "session-review",
      callId: "call-fail-open",
      payload: {
        toolName: "code_review",
        toolInput: {},
        toolResult: "MUST FIX: parser regression at src/parser.ts:10",
        error: false,
      },
    });

    // Then
    expect(response).toEqual({ action: "proceed" });
    expect(appended).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: review_observed generation failed",
      expect.any(Error),
    );
  });

  it("trims safe human-approved resolution identifiers before persistence", async () => {
    // Given
    const { handler, logStore } = createHandler();

    // When
    const response = await handler.handleReviewResolutionArtifact({
      agentId: "atlas",
      sessionId: "session-review",
      reviewScope: " task-6.3 ",
      itemKeys: [" major:parser "],
      artifactRef: " docs/reviews/task-6.3.md ",
    });

    // Then
    expect(response).toEqual({ action: "proceed" });
    const events = await logStore.readAll();
    expect(events[0]).toMatchObject({
      kind: "review_observed",
      reviewScope: "task-6.3",
      items: [],
      resolutionMarkers: [
        {
          itemKey: "major:parser",
          resolution: "human_artifact",
          artifactRef: "docs/reviews/task-6.3.md",
        },
      ],
    });
  });

  it.each([
    { reviewScope: "task=secret", itemKeys: ["major:parser"], artifactRef: "docs/reviews/task.md" },
    { reviewScope: "task-6.3", itemKeys: ["major=secret"], artifactRef: "docs/reviews/task.md" },
    { reviewScope: "task-6.3", itemKeys: ["major:parser"], artifactRef: "secret=value" },
    {
      reviewScope: "task-6.3",
      itemKeys: ["major:parser"],
      artifactRef: "a".repeat(257),
    },
  ])("rejects unsafe or oversized resolution identifiers before persistence", async (payload) => {
    // Given
    const { handler, logStore } = createHandler();

    // When
    const response = await handler.handleReviewResolutionArtifact({
      agentId: "atlas",
      sessionId: "session-review",
      ...payload,
    });

    // Then
    expect(response).toEqual({ action: "proceed" });
    expect(await logStore.readAll()).toEqual([]);
  });
});
