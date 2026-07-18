import { describe, expect, it, vi } from "vitest";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import type { HookResponse, ObservationAgentId } from "../../src/core/types";
import type { PendingLogRecord } from "../../src/core/v2/observation-model";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { createMemFs } from "../helpers/mock-file-system";

function createHandler(logger?: { warn(message: string, error: unknown): void }): {
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
      ...(logger === undefined ? {} : { logger }),
    }),
    logStore,
    sessionState,
  };
}

describe("ObservationHandler review observations", () => {
  it("appends every detected review item before projection and redacts persisted text", async () => {
    // Given
    const { handler, logStore, sessionState } = createHandler();
    sessionState.setActiveTaskWindow("call-review", "task-6.3");

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
      isCompleteSnapshot: true,
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

  it("appends an empty review observation for an explicit complete snapshot", async () => {
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
    expect(events[1]).toMatchObject({
      kind: "review_observed",
      reviewScope: "session-review:call-complete",
      isCompleteSnapshot: true,
      items: [],
    });
  });

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

  it("appends human-approved resolution markers through the artifact seam", async () => {
    // Given
    const { handler, logStore } = createHandler();
    const resolutionHandler = handler as unknown as {
      handleReviewResolutionArtifact(payload: {
        readonly agentId: ObservationAgentId;
        readonly sessionId: string;
        readonly reviewScope: string;
        readonly itemKeys: readonly string[];
        readonly artifactRef: string;
      }): Promise<HookResponse>;
    };

    // When
    const response = await resolutionHandler.handleReviewResolutionArtifact({
      agentId: "atlas",
      sessionId: "session-review",
      reviewScope: "task-6.3",
      itemKeys: ["major:parser"],
      artifactRef: "docs/reviews/task-6.3.md",
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

  it("redacts absolute paths and secret-like values in human artifact references", async () => {
    // Given
    const { handler, logStore } = createHandler();
    const resolutionHandler = handler as unknown as {
      handleReviewResolutionArtifact(payload: {
        readonly agentId: ObservationAgentId;
        readonly sessionId: string;
        readonly reviewScope: string;
        readonly itemKeys: readonly string[];
        readonly artifactRef: string;
      }): Promise<HookResponse>;
    };

    // When
    await resolutionHandler.handleReviewResolutionArtifact({
      agentId: "atlas",
      sessionId: "session-review",
      reviewScope: "task-6.3",
      itemKeys: ["major:parser"],
      artifactRef: "/home/alice/project/docs/review.md GITHUB_TOKEN=ghp_exampleSecret1234567890",
    });

    // Then
    const events = await logStore.readAll();
    const serialized = JSON.stringify(events[0]);
    expect(serialized).toContain("[REDACTED_PATH]");
    expect(serialized).toContain("[REDACTED_ENV]");
    expect(serialized).not.toContain("/home/alice");
    expect(serialized).not.toContain("ghp_exampleSecret1234567890");
  });
});
