import { describe, expect, it } from "vitest";
import { aggregateReviews } from "../../../src/core/v2/review-aggregator";
import type {
  ObservationRecord,
  ResolutionMarker,
  ReviewItem,
} from "../../../src/core/v2/observation-model";

type ReviewObservedOptions = {
  readonly sequence: number;
  readonly scope: string;
  readonly items?: readonly ReviewItem[];
  readonly isCompleteSnapshot?: boolean;
  readonly resolutionMarkers?: readonly ResolutionMarker[];
};

function reviewItem(
  itemKey: string,
  severity: ReviewItem["severity"],
  status: ReviewItem["status"] = "open",
): ReviewItem {
  return {
    itemKey,
    evidenceId: `evidence:${itemKey}`,
    severity,
    summary: itemKey,
    location: "src/example.ts",
    status,
  };
}

function reviewObserved(options: ReviewObservedOptions): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence: options.sequence,
    timestamp: `2026-07-15T00:00:0${options.sequence}Z`,
    agentId: "atlas",
    sessionId: "session-1",
    writerId: "writer-1",
    recordType: "observation",
    taskId: "task-1",
    kind: "review_observed",
    reviewScope: options.scope,
    items: options.items ?? [],
    ...(options.isCompleteSnapshot === undefined
      ? {}
      : { isCompleteSnapshot: options.isCompleteSnapshot }),
    ...(options.resolutionMarkers === undefined
      ? {}
      : { resolutionMarkers: options.resolutionMarkers }),
  };
}

describe("aggregateReviews() D32 resolution", () => {
  it("keeps an open item when it merely disappears from a later review", () => {
    const records = [
      reviewObserved({ sequence: 1, scope: "task-1", items: [reviewItem("major:foo", "major")] }),
      reviewObserved({ sequence: 2, scope: "task-1", items: [reviewItem("minor:bar", "minor")] }),
    ];

    const summary = aggregateReviews(records);

    expect(summary.byScope.get("task-1")?.open.map((item) => item.itemKey)).toEqual([
      "major:foo",
      "minor:bar",
    ]);
    expect(summary.byScope.get("task-1")?.open[0]?.ref.evidenceId).toBe("evidence:major:foo");
  });

  it("resolves an open item when an explicit marker is observed", () => {
    const records = [
      reviewObserved({ sequence: 1, scope: "task-1", items: [reviewItem("major:foo", "major")] }),
      reviewObserved({
        sequence: 2,
        scope: "task-1",
        resolutionMarkers: [{ itemKey: "major:foo", resolution: "explicit_marker" }],
      }),
    ];

    const summary = aggregateReviews(records);
    const scope = summary.byScope.get("task-1");

    expect(scope?.open).toEqual([]);
    expect(scope?.resolved.map((item) => item.itemKey)).toEqual(["major:foo"]);
  });

  it("resolves an absent item when the later review is a complete snapshot", () => {
    const records = [
      reviewObserved({ sequence: 1, scope: "task-1", items: [reviewItem("major:foo", "major")] }),
      reviewObserved({
        sequence: 2,
        scope: "task-1",
        items: [reviewItem("minor:bar", "minor")],
        isCompleteSnapshot: true,
      }),
    ];

    const summary = aggregateReviews(records);
    const scope = summary.byScope.get("task-1");

    expect(scope?.open.map((item) => item.itemKey)).toEqual(["minor:bar"]);
    expect(scope?.resolved.map((item) => item.itemKey)).toEqual(["major:foo"]);
  });

  it("keeps an absent item open when the later snapshot is not complete", () => {
    const records = [
      reviewObserved({ sequence: 1, scope: "task-1", items: [reviewItem("major:foo", "major")] }),
      reviewObserved({
        sequence: 2,
        scope: "task-1",
        items: [reviewItem("minor:bar", "minor")],
        isCompleteSnapshot: false,
      }),
    ];

    const summary = aggregateReviews(records);

    expect(summary.byScope.get("task-1")?.open.map((item) => item.itemKey)).toEqual([
      "major:foo",
      "minor:bar",
    ]);
  });

  it("resolves an open item when a human artifact marker is observed", () => {
    const records = [
      reviewObserved({ sequence: 1, scope: "task-1", items: [reviewItem("major:foo", "major")] }),
      reviewObserved({
        sequence: 2,
        scope: "task-1",
        resolutionMarkers: [
          {
            itemKey: "major:foo",
            resolution: "human_artifact",
            artifactRef: "docs/reviews/2026-06-26.md",
          },
        ],
      }),
    ];

    const summary = aggregateReviews(records);

    expect(summary.byScope.get("task-1")?.resolved.map((item) => item.itemKey)).toEqual([
      "major:foo",
    ]);
  });

  it("uses the latest item observation for severity but ignores its resolved status", () => {
    const records = [
      reviewObserved({ sequence: 1, scope: "task-1", items: [reviewItem("finding", "major")] }),
      reviewObserved({
        sequence: 2,
        scope: "task-1",
        items: [reviewItem("finding", "minor", "resolved")],
      }),
    ];

    const summary = aggregateReviews(records);
    const scope = summary.byScope.get("task-1");

    expect(scope?.open).toEqual([
      expect.objectContaining({ itemKey: "finding", severity: "minor" }),
    ]);
    expect(scope?.major).toEqual([]);
    expect(scope?.minor).toEqual([
      expect.objectContaining({ itemKey: "finding", severity: "minor" }),
    ]);
    expect(scope?.resolved).toEqual([]);
  });

  it("applies complete snapshots only within the matching review scope", () => {
    const records = [
      reviewObserved({
        sequence: 1,
        scope: "scope-a",
        items: [reviewItem("finding-a", "critical")],
      }),
      reviewObserved({ sequence: 2, scope: "scope-b", items: [], isCompleteSnapshot: true }),
    ];

    const summary = aggregateReviews(records);

    expect(summary.byScope.get("scope-a")?.open.map((item) => item.itemKey)).toEqual(["finding-a"]);
    expect(summary.byScope.get("scope-b")?.open).toEqual([]);
  });
});
