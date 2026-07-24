import { describe, expect, it } from "vitest";
import { collectReviewScopes, deriveReviewScope } from "../../../src/core/v2/review-scope";
import type { ProjectedState } from "../../../src/core/v2/state-projection";

function projectedState(): ProjectedState {
  return {
    schemaVersion: 2,
    rebuiltAt: "2026-07-13T00:00:00.000Z",
    integrity: { sourceHash: "sha256:test", maxSequenceByShard: new Map() },
    tasks: new Map([
      [
        "task-1",
        {
          status: "open",
          lastVerdict: "NONE",
          evidence: [],
          observedReviewScopes: ["scope-a", "scope-b"],
        },
      ],
    ]),
    reviewSummary: {
      authority: "observed_review_output",
      critical: [],
      major: [],
      minor: [],
      resolved: [],
      open: [],
      byScope: new Map(),
    },
  };
}

describe("collectReviewScopes", () => {
  it("returns the review scopes observed in the requested task window", () => {
    expect(collectReviewScopes(projectedState(), "task-1")).toEqual(["scope-a", "scope-b"]);
  });

  it("returns an empty list when the task window was not observed", () => {
    expect(collectReviewScopes(projectedState(), "missing-task")).toEqual([]);
  });
});

describe("deriveReviewScope", () => {
  it("uses taskId when an active task is available", () => {
    expect(
      deriveReviewScope({
        taskId: "task-1",
        sessionId: "session-1",
        callId: "call-1",
        toolName: "bash",
      }),
    ).toBe("task-1");
  });

  it.each([
    [{ sessionId: "session-1", callId: "call-1", toolName: "bash" }, "session-1:call-1"],
    [{ sessionId: "session-1", toolName: "bash" }, "session-1:bash"],
    [{ sessionId: "session-1" }, "session-1:unknown"],
  ])("derives a session scope when taskId is unavailable", (context, expected) => {
    expect(deriveReviewScope(context)).toBe(expected);
  });
});
