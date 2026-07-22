// src/runtime/state-projection-cache.ts
import type { FileReader, FileWriter } from "../core/types";
import { randomUUID } from "node:crypto";
import {
  computeMaxSequenceByShard,
  computeSourceHash,
  orderEventsForProjection,
} from "../core/v2/integrity";
import type { PersistedLogRecord } from "../core/v2/observation-model";
import {
  fromSerializableProjectedState,
  project,
  toSerializableProjectedState,
  type ProjectedState,
} from "../core/v2/state-projection";

type CacheLogger = { warn(message: string, err?: unknown): void };

/**
 * Persists the projected `state.json` cache. All writes are atomic (temp file +
 * rename) and every operation is fail-open: read/parse/validate failures return
 * `undefined` so callers rebuild from the event log.
 */
export class StateProjectionCache {
  constructor(
    private readonly fileWriter: FileWriter,
    private readonly fileReader: FileReader,
    private readonly path = ".justice/state.json",
    private readonly logger: CacheLogger = console,
  ) {}

  async write(state: ProjectedState): Promise<void> {
    const tempPath = `${this.path}.tmp.${Date.now()}.${randomUUID()}`;
    try {
      const content = JSON.stringify(toSerializableProjectedState(state));
      await this.fileWriter.writeFile(tempPath, content);
      await this.fileWriter.rename(tempPath, this.path);
    } catch (err) {
      // fail-open: log, best-effort cleanup of any orphaned temp file (mirrors
      // write-queue.ts's atomicAppend), and continue; the cache is an
      // optimization, not a source of truth.
      await this.fileWriter.deleteFile(tempPath).catch(() => {
        /* best-effort cleanup: ignore secondary failure (e.g. temp was never created) */
      });
      this.logger.warn("state.json cache write failed", err);
    }
  }

  async read(): Promise<ProjectedState | undefined> {
    try {
      if (!(await this.fileReader.fileExists(this.path))) return undefined;
      const content = await this.fileReader.readFile(this.path);
      const parsed: unknown = JSON.parse(content);
      if (!isValidCacheStructure(parsed)) {
        this.logger.warn("state.json structure invalid, triggering rebuild");
        return undefined;
      }
      return fromSerializableProjectedState(parsed);
    } catch (err) {
      this.logger.warn("state.json read/parse failed, triggering rebuild", err);
      return undefined;
    }
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidReviewSummary(reviewSummary: unknown): boolean {
  if (!isPlainRecord(reviewSummary)) return false;
  if (!isPlainRecord(reviewSummary.byScope)) return false;
  if (reviewSummary.authority !== "observed_review_output") return false;
  for (const scopeSummary of Object.values(reviewSummary.byScope)) {
    if (
      !isPlainRecord(scopeSummary) ||
      !Array.isArray(scopeSummary.critical) ||
      !Array.isArray(scopeSummary.major) ||
      !Array.isArray(scopeSummary.minor) ||
      !Array.isArray(scopeSummary.resolved) ||
      !Array.isArray(scopeSummary.open)
    ) {
      return false;
    }
  }
  return (
    Array.isArray(reviewSummary.critical) &&
    Array.isArray(reviewSummary.major) &&
    Array.isArray(reviewSummary.minor) &&
    Array.isArray(reviewSummary.resolved) &&
    Array.isArray(reviewSummary.open)
  );
}

function isValidCacheStructure(parsed: unknown): boolean {
  if (!isPlainRecord(parsed)) return false;
  if (parsed.schemaVersion !== 2) return false;
  const integrity = parsed.integrity;
  if (!isPlainRecord(integrity)) return false;
  if (typeof integrity.sourceHash !== "string") return false;
  const maxSequenceByShard = integrity.maxSequenceByShard;
  if (!isPlainRecord(maxSequenceByShard)) return false;
  for (const sequence of Object.values(maxSequenceByShard)) {
    if (typeof sequence !== "number" || !Number.isFinite(sequence) || sequence < 0) return false;
  }
  // `fromSerializableProjectedState` rebuilds `tasks` and `reviewSummary.byScope`
  // with `new Map(Object.entries(...))`: an array (schema drift / hand-edited
  // cache) silently becomes an index-keyed Map, and `undefined` throws. Require
  // both to be plain objects. The `reviewSummary` array fields are copied by
  // reference, so a partial `reviewSummary` would leave them `undefined` and
  // crash callers doing `.map()`/`.length`. Reject such caches so `read()`
  // rebuilds instead.
  if (!isPlainRecord(parsed.tasks)) return false;
  return isValidReviewSummary(parsed.reviewSummary);
}

export type CacheValidationReason =
  | "valid"
  | "stale_append"
  | "mismatch_seq"
  | "mismatch_payload"
  | "structural";

export type CacheValidationResult = {
  readonly valid: boolean;
  readonly reason: CacheValidationReason;
};

/**
 * Compares a cached `ProjectedState` against the actual event log using the same
 * normalized ordering as `project()`. Distinguishes a benign stale cache (normal
 * append -> `stale_append`, silent rebuild) from an integrity mismatch
 * (`mismatch_seq` / `structural`, warn then rebuild).
 */
export function validateProjectionCacheAgainstEvents(
  cacheState: ProjectedState,
  events: readonly PersistedLogRecord[],
): CacheValidationResult {
  if (
    !cacheState.integrity ||
    typeof cacheState.integrity !== "object" ||
    !cacheState.integrity.maxSequenceByShard
  ) {
    return { valid: false, reason: "structural" };
  }

  const currentMaxSeq = computeMaxSequenceByShard(events);

  const cachedMap = cacheState.integrity.maxSequenceByShard;
  if (currentMaxSeq.size > cachedMap.size) {
    // A new writer (shard) appeared in the event log. Like new records appended
    // to a known shard, this is a normal append -> silent rebuild, not a warning.
    return { valid: false, reason: "stale_append" };
  }
  if (currentMaxSeq.size < cachedMap.size) {
    // The cache references more shards than the event log holds: a genuine
    // mismatch (events do not disappear under normal append-only operation).
    return { valid: false, reason: "mismatch_seq" };
  }
  for (const [shardKey, cachedSeq] of cachedMap.entries()) {
    const currentSeq = currentMaxSeq.get(shardKey);
    if (currentSeq === undefined || cachedSeq > currentSeq) {
      return { valid: false, reason: "mismatch_seq" };
    }
    if (cachedSeq < currentSeq) {
      return { valid: false, reason: "stale_append" };
    }
  }

  // A source hash discrepancy with matching shard sequences can result from a
  // normal append completed between the max-sequence and hash observations.
  // Treat it as stale so the handler rebuilds silently from the append-only log.
  const currentSourceHash = computeSourceHash(orderEventsForProjection(events));
  if (cacheState.integrity.sourceHash !== currentSourceHash) {
    return { valid: false, reason: "stale_append" };
  }

  const rebuilt = project(events, cacheState.rebuiltAt);
  if (
    JSON.stringify(toSerializableProjectedState(cacheState)) !==
    JSON.stringify(toSerializableProjectedState(rebuilt))
  ) {
    return { valid: false, reason: "mismatch_payload" };
  }

  return { valid: true, reason: "valid" };
}
