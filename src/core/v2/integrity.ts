// src/core/v2/integrity.ts
import { hashString } from "./hash";
import type { PersistedLogRecord } from "./observation-model";

/**
 * Stable shard identity key used to group and order records.
 */
export function shardKeyOf(
  event: Pick<PersistedLogRecord, "agentId" | "sessionId" | "writerId">,
): string {
  return `${event.agentId}:${event.sessionId}:${event.writerId}`;
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

  const sorted: PersistedLogRecord[] = [];
  const total = streams.reduce((n, s) => n + s.length, 0);

  while (sorted.length < total) {
    let bestStream: PersistedLogRecord[] | null = null;
    let bestVal: PersistedLogRecord | null = null;

    for (const stream of streams) {
      const head = stream[0];
      if (head === undefined) continue;
      if (bestVal === null || compareForMerge(head, bestVal) < 0) {
        bestStream = stream;
        bestVal = head;
      }
    }

    if (bestStream === null || bestVal === null) break;
    bestStream.shift();
    sorted.push(bestVal);
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
