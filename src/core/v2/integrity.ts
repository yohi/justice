// src/core/v2/integrity.ts
import { hashString } from "./hash";
import type { PersistedLogRecord } from "./observation-model";
import { shardKeyOf as shardLayoutKeyOf } from "./shard-layout";

/**
 * Stable shard identity key used to group and order records.
 */
export function shardKeyOf(
  event: Pick<PersistedLogRecord, "agentId" | "sessionId" | "writerId">,
): string {
  return shardLayoutKeyOf(event);
}

/**
 * Maximum `sequence` per shard key. The maximum is order-independent, so callers
 * may pass raw or ordered events. Shared by `project()` and the cache validator
 * so the "max sequence per shard" rule lives in exactly one place.
 */
export function computeMaxSequenceByShard(
  events: readonly PersistedLogRecord[],
): Map<string, number> {
  const maxByShard = new Map<string, number>();
  for (const event of events) {
    const shardKey = shardKeyOf(event);
    const current = maxByShard.get(shardKey) ?? -1;
    if (event.sequence > current) maxByShard.set(shardKey, event.sequence);
  }
  return maxByShard;
}

function compareForMerge(a: PersistedLogRecord, b: PersistedLogRecord): number {
  // Unparseable timestamps yield NaN; NaN comparisons are all false, which would
  // make the k-way merge fall back to stream iteration (input) order and break
  // determinism. Map NaN deterministically to the end (tie-broken by shard/seq).
  const rawA = new Date(a.timestamp).getTime();
  const rawB = new Date(b.timestamp).getTime();
  const timeA = Number.isNaN(rawA) ? Number.POSITIVE_INFINITY : rawA;
  const timeB = Number.isNaN(rawB) ? Number.POSITIVE_INFINITY : rawB;
  if (timeA !== timeB) return timeA - timeB;
  const shardA = shardKeyOf(a);
  const shardB = shardKeyOf(b);
  if (shardA !== shardB) return shardA < shardB ? -1 : 1;
  return a.sequence - b.sequence;
}

type MergeCursor = {
  readonly record: PersistedLogRecord;
  readonly stream: readonly PersistedLogRecord[];
  readonly next: number;
};

/**
 * Binary min-heap of shard-stream heads keyed by `compareForMerge`. Distinct
 * streams carry distinct shardKeys, so `compareForMerge` never ties between two
 * heap entries: pop order is a total order — deterministic and identical to the
 * previous linear-scan merge — at O(total × log k) with no Array.shift cost.
 */
/* eslint-disable security/detect-object-injection --
 * indices below are loop-bounded heap positions from integer arithmetic
 * (parent/child navigation), never external input; the rule is a false positive. */
class MergeHeap {
  private readonly items: MergeCursor[] = [];

  push(item: MergeCursor): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareForMerge(items[i]!.record, items[parent]!.record) >= 0) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }

  pop(): MergeCursor | undefined {
    const items = this.items;
    const top = items[0];
    if (top === undefined) return undefined;
    const last = items.pop()!;
    if (items.length === 0) return top;
    items[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (
        left < items.length &&
        compareForMerge(items[left]!.record, items[smallest]!.record) < 0
      ) {
        smallest = left;
      }
      if (
        right < items.length &&
        compareForMerge(items[right]!.record, items[smallest]!.record) < 0
      ) {
        smallest = right;
      }
      if (smallest === i) break;
      [items[i], items[smallest]] = [items[smallest]!, items[i]!];
      i = smallest;
    }
    return top;
  }
}
/* eslint-enable security/detect-object-injection */

/**
 * Deterministic 2-stage ordering (§6.3 / D27 / D18 / D39):
 *  1. Group by shard and order each shard's stream by sequence (append order).
 *  2. K-way merge streams by timestamp -> shardId -> sequence.
 *
 * The k-way merge preserves within-shard sequence order even if timestamps
 * invert within a shard (it only compares stream heads), which a flat
 * comparator sort would not guarantee. Both `project()` and the cache validator
 * order through this single function so their `sourceHash` values always agree.
 */
export function orderEventsForProjection(
  events: readonly PersistedLogRecord[],
): readonly PersistedLogRecord[] {
  const groups = new Map<string, PersistedLogRecord[]>();
  for (const event of events) {
    const key = shardKeyOf(event);
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }

  const streams = [...groups.values()].map((stream) =>
    [...stream].sort((a, b) => a.sequence - b.sequence),
  );

  const heap = new MergeHeap();
  for (const stream of streams) {
    const head = stream.at(0);
    if (head !== undefined) heap.push({ record: head, stream, next: 1 });
  }

  const sorted: PersistedLogRecord[] = [];
  for (let popped = heap.pop(); popped !== undefined; popped = heap.pop()) {
    sorted.push(popped.record);
    const nextHead = popped.stream.at(popped.next);
    if (nextHead !== undefined) {
      heap.push({ record: nextHead, stream: popped.stream, next: popped.next + 1 });
    }
  }

  return sorted;
}

/**
 * Deterministic content hash over an already-ordered event stream.
 * Callers MUST pass the output of `orderEventsForProjection` so the hash is
 * stable across replays.
 */
export function computeSourceHash(orderedEvents: readonly PersistedLogRecord[]): string {
  return hashString(orderedEvents.map((e) => JSON.stringify(e)).join("\n"));
}
