// src/runtime/state-projection-cache.ts
import type { FileReader, FileWriter } from "../core/types";
import { computeSourceHash, orderEventsForProjection, shardKeyOf } from "../core/v2/integrity";
import type { PersistedLogRecord } from "../core/v2/observation-model";
import type { ProjectedState } from "../core/v2/state-projection";
import {
  fromSerializableProjectedState,
  toSerializableProjectedState,
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
    try {
      const content = JSON.stringify(toSerializableProjectedState(state));
      const tempPath = `${this.path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await this.fileWriter.writeFile(tempPath, content);
      await this.fileWriter.rename(tempPath, this.path);
    } catch (err) {
      // fail-open: log and continue; the cache is an optimization, not a source of truth.
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

function isValidCacheStructure(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const integrity = (parsed as Record<string, unknown>).integrity;
  if (!integrity || typeof integrity !== "object") return false;
  return "maxSequenceByShard" in integrity;
}

export type CacheValidationReason = "valid" | "stale_append" | "mismatch_seq" | "structural";

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

  const currentMaxSeq = new Map<string, number>();
  for (const e of events) {
    const shardKey = shardKeyOf(e);
    const cur = currentMaxSeq.get(shardKey) ?? -1;
    if (e.sequence > cur) currentMaxSeq.set(shardKey, e.sequence);
  }

  const cachedMap = cacheState.integrity.maxSequenceByShard;
  if (cachedMap.size !== currentMaxSeq.size) {
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

  // Reaching here means every per-shard maxSequence already matched, so a normal
  // append cannot be the cause (it raises a shard's maxSequence and is caught
  // above as stale_append). A hash mismatch here therefore implies ordering drift
  // or a mid-stream anomaly. Per plan design (§ silent-rebuild) this is still
  // classified stale_append to favor stability over noise; it is fail-safe (never
  // reports a corrupt cache as valid). Revisit if anomaly observability is needed.
  const currentSourceHash = computeSourceHash(orderEventsForProjection(events));
  if (cacheState.integrity.sourceHash !== currentSourceHash) {
    return { valid: false, reason: "stale_append" };
  }

  return { valid: true, reason: "valid" };
}
