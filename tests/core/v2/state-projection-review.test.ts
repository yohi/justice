import { describe, expect, it } from "vitest";
import { project } from "../../../src/core/v2/state-projection";
import type { ObservationRecord, ReviewItem } from "../../../src/core/v2/observation-model";

function reviewItem(itemKey: string, severity: ReviewItem["severity"]): ReviewItem {
  return {
    itemKey,
    evidenceId: `evidence:${itemKey}`,
    severity,
    summary: itemKey,
    location: "src/example.ts",
    status: "open",
  };
}

function reviewObserved(
  sequence: number,
  items: readonly ReviewItem[],
  isCompleteSnapshot = false,
): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence,
    timestamp: `2026-07-15T00:00:0${sequence}Z`,
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
    recordType: "observation",
    taskId: "task-1",
    kind: "review_observed",
    reviewScope: "task-1",
    items,
    isCompleteSnapshot,
  };
}

describe("project() D32 review aggregation", () => {
  it("orders review events before resolving an item absent from a complete snapshot", () => {
    const open = reviewObserved(1, [reviewItem("major:foo", "major")]);
    const complete = reviewObserved(2, [reviewItem("minor:bar", "minor")], true);

    const state = project([complete, open], "2026-07-15T00:00:00Z");

    expect(state.reviewSummary.open.map((item) => item.itemKey)).toEqual(["minor:bar"]);
    expect(state.reviewSummary.resolved.map((item) => item.itemKey)).toEqual(["major:foo"]);
    expect(state.reviewSummary.byScope.get("task-1")?.resolved[0]?.ref.evidenceId).toBe(
      "evidence:major:foo",
    );
  });
});
