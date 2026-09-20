import { describe, expect, it } from "vitest";
import {
  projectReviewDispatchSlots,
  projectTaskCallBindings,
} from "../../src/core/review-dispatch-state";
import type { ReviewCorrelation } from "../../src/core/types";
import type { ReviewDispatchTransitionRecord } from "../../src/core/v2/observation-model";
import {
  fromSerializableProjectedState,
  project,
  toSerializableProjectedState,
} from "../../src/core/v2/state-projection";

const correlation: ReviewCorrelation = {
  reviewKind: "task-review",
  taskExecutionRef: {
    authorizationId: "auth-1",
    taskId: "task-1",
    attemptId: "attempt-1",
  },
  reviewRound: 1,
};

const base = {
  schemaVersion: 1 as const,
  timestamp: "2026-09-20T00:00:00.000Z",
  agentId: "atlas" as const,
  sessionId: "parent-1",
  writerId: "writer-1",
  recordType: "observation" as const,
  kind: "review_dispatch_transition" as const,
  parentSessionId: "parent-1",
  correlation,
  expectedCategory: "sp-review" as const,
};

function pending(sequence = 1): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `transition-${sequence}`,
    from: null,
    to: "pending",
  };
}

function claimed(sequence = 2): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `transition-${sequence}`,
    from: "pending",
    to: "claimed",
    callId: "call-1",
    artifactReservation: {
      status: "usable",
      artifactId: "artifact-1",
      artifactPath: ".justice/reviews/artifact-1.json",
      leasePath: ".justice/reviews/.leases/artifact-1.lease",
      artifactIdentity: { device: "1", inode: "2" },
    },
  };
}

function terminal(callId: string, sequence = 3): ReviewDispatchTransitionRecord {
  return {
    ...base,
    sequence,
    transitionId: `transition-${sequence}`,
    from: "claimed",
    to: "terminal",
    callId,
    terminalReason: "review_execution_failed",
  };
}

describe("durable review dispatch projection", () => {
  it("uses shard sequence order and restores a claimed task binding", () => {
    const records = [claimed(), pending()];

    expect(projectReviewDispatchSlots(records)).toMatchObject([
      { state: "claimed", callId: "call-1", key: { correlation } },
    ]);
    expect(projectTaskCallBindings(records)).toMatchObject([
      {
        purpose: "task_review",
        callId: "call-1",
        expectedCategory: "sp-review",
        correlation,
      },
    ]);
  });

  it("ignores a terminal transition whose claimed call identity does not match", () => {
    expect(projectReviewDispatchSlots([pending(), claimed(), terminal("other-call")])).toMatchObject([
      { state: "claimed", callId: "call-1" },
    ]);
  });

  it("round-trips slots and task bindings through the projected cache", () => {
    const state = project([pending(), claimed()], "2026-09-20T00:00:01.000Z");
    const restored = fromSerializableProjectedState(toSerializableProjectedState(state));

    expect(restored.reviewDispatchSlots).toEqual(state.reviewDispatchSlots);
    expect(restored.taskCallBindings).toEqual(state.taskCallBindings);
  });
});
