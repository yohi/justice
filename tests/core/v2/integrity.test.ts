// tests/core/v2/integrity.test.ts
import { describe, expect, it } from "vitest";
import {
  computeSourceHash,
  orderEventsForProjection,
  shardKeyOf,
} from "../../../src/core/v2/integrity";
import type { ObservationRecord } from "../../../src/core/v2/observation-model";
import type { ObservationAgentId } from "../../../src/core/types";

/**
 * Minimal `ObservationRecord` fixture. Uses the `skill_invoked` stub kind
 * (no fields beyond `kind`) so tests can focus purely on shard identity
 * (agentId/sessionId/writerId), `sequence`, and `timestamp` — the only
 * fields `orderEventsForProjection`/`compareForMerge`/`computeSourceHash`
 * inspect.
 */
function ev(
  agentId: ObservationAgentId,
  sessionId: string,
  writerId: string,
  sequence: number,
  timestamp: string,
): ObservationRecord {
  return {
    schemaVersion: 1,
    timestamp,
    agentId,
    sessionId,
    writerId,
    recordType: "observation",
    sequence,
    kind: "skill_invoked",
  };
}

describe("orderEventsForProjection() / MergeHeap", () => {
  it("performs a k-way merge across 3+ shards, ordering globally by timestamp", () => {
    const w1 = [
      ev("atlas", "s1", "w1", 1, "2026-07-08T00:00:01Z"),
      ev("atlas", "s1", "w1", 2, "2026-07-08T00:00:04Z"),
    ];
    const w2 = [
      ev("atlas", "s1", "w2", 1, "2026-07-08T00:00:02Z"),
      ev("atlas", "s1", "w2", 2, "2026-07-08T00:00:05Z"),
    ];
    const w3 = [
      ev("atlas", "s1", "w3", 1, "2026-07-08T00:00:03Z"),
      ev("atlas", "s1", "w3", 2, "2026-07-08T00:00:06Z"),
    ];
    // Feed all 6 records interleaved/out-of-order across 3 distinct shard streams.
    const events = [...w3, ...w1, ...w2];
    const sorted = orderEventsForProjection(events);

    expect(sorted.map((e) => `${shardKeyOf(e)}#${e.sequence}`)).toEqual([
      "atlas:s1:w1#1",
      "atlas:s1:w2#1",
      "atlas:s1:w3#1",
      "atlas:s1:w1#2",
      "atlas:s1:w2#2",
      "atlas:s1:w3#2",
    ]);
  });

  it("preserves within-shard sequence order even when input array order is scrambled", () => {
    // A single shard's records fed in a scrambled (non-sequence, non-timestamp)
    // order must still come out sorted ascending by `sequence`.
    const events = [
      ev("atlas", "s1", "w1", 3, "2026-07-08T00:00:03Z"),
      ev("atlas", "s1", "w1", 1, "2026-07-08T00:00:01Z"),
      ev("atlas", "s1", "w1", 2, "2026-07-08T00:00:02Z"),
    ];
    const sorted = orderEventsForProjection(events);
    expect(sorted.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it("tie-breaks on identical timestamps by shardKeyOf (lexicographic), not input order", () => {
    const sameTs = "2026-07-08T00:00:00Z";
    // w3's record is listed FIRST in the input, but "atlas:s1:w1" < "atlas:s1:w3"
    // lexicographically, so w1 must win the tie-break and come out first.
    const events = [
      ev("atlas", "s1", "w3", 1, sameTs),
      ev("atlas", "s1", "w1", 1, sameTs),
      ev("atlas", "s1", "w2", 1, sameTs),
    ];
    const sorted = orderEventsForProjection(events);
    expect(sorted.map((e) => shardKeyOf(e))).toEqual(["atlas:s1:w1", "atlas:s1:w2", "atlas:s1:w3"]);
  });

  it("keeps within-shard sequence order intact even if a shard's own timestamps invert", () => {
    // compareForMerge only compares stream heads; a shard whose recorded
    // timestamps go backwards must still yield its records in `sequence` order,
    // never re-sorted by timestamp within the shard.
    const w1 = [
      ev("atlas", "s1", "w1", 1, "2026-07-08T00:00:05Z"),
      ev("atlas", "s1", "w1", 2, "2026-07-08T00:00:01Z"), // earlier timestamp, later sequence
    ];
    const sorted = orderEventsForProjection(w1);
    expect(sorted.map((e) => e.sequence)).toEqual([1, 2]);
  });
});

describe("computeSourceHash() stability", () => {
  it("is stable across differently-ordered inputs once passed through orderEventsForProjection", () => {
    const events = [
      ev("atlas", "s1", "w1", 1, "2026-07-08T00:00:01Z"),
      ev("atlas", "s1", "w2", 1, "2026-07-08T00:00:02Z"),
      ev("atlas", "s1", "w3", 1, "2026-07-08T00:00:03Z"),
    ];
    const hashA = computeSourceHash(orderEventsForProjection(events));
    const hashB = computeSourceHash(orderEventsForProjection([...events].reverse()));
    expect(hashA).toBe(hashB);
  });

  it("changes when event content changes", () => {
    const events = [ev("atlas", "s1", "w1", 1, "2026-07-08T00:00:01Z")];
    const mutated = [{ ...events[0]!, sequence: 2 }];
    expect(computeSourceHash(orderEventsForProjection(events))).not.toBe(
      computeSourceHash(orderEventsForProjection(mutated)),
    );
  });
});
