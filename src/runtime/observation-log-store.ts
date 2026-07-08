// src/runtime/observation-log-store.ts
import type { FileReader, FileWriter, ShardId } from "../core/types";
import type { PendingLogRecord, PersistedLogRecord } from "../core/v2/observation-model";
import { fromPhysicalPath, toArchivePath, toPhysicalPath } from "../core/v2/shard-layout";
import { createShardWriteQueue } from "./write-queue";
import { validateRecordSchema, validateShardSequences } from "./validation";

const EVENTS_ROOT = ".justice/events";
const ARCHIVE_ROOT = ".justice/archive/events";

const MAX_SHARD_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_SHARD_AGE_DAYS = 14;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
// After this many consecutive rotation failures, the store reports `degraded`
// via getRotationHealth() so callers/monitoring can react to persistent
// archival failures (disk full, permission errors) that would otherwise only
// surface as repeated log lines.
const ROTATION_FAILURE_DEGRADE_THRESHOLD = 3;

function ageInDays(creationMs: number, now: Date): number {
  return (now.getTime() - creationMs) / MS_PER_DAY;
}

async function shouldRotate(
  fileReader: FileReader,
  path: string,
  createdMs: number,
  now: Date,
): Promise<boolean> {
  const stats = await fileReader.readFileStats(path);
  if (!stats) return false;
  // Age is measured from `createdMs` (the shard's oldest on-disk record
  // timestamp), NOT filesystem mtime/birthtime: `atomicAppend` renames a temp
  // file over the shard on every append, which resets both mtime and birthtime
  // to "now", so neither can measure a shard's age.
  return stats.size >= MAX_SHARD_SIZE_BYTES || ageInDays(createdMs, now) >= MAX_SHARD_AGE_DAYS;
}

function rotationTimestamp(now: Date): string {
  // Alphanumeric-only stamp. toArchivePath() rejects any non-alphanumeric
  // character to guard the archive path (blocks "/", "..", etc.), so strip all
  // ISO separators (":", ".", "-") entirely rather than substituting them.
  return now.toISOString().replace(/[^A-Za-z0-9]/g, "");
}

/**
 * Append-only observation log store. Writes are serialized per physical shard
 * path via a write queue; each append is persisted atomically (temp file +
 * rename). `readAll` merges active + archive segments and validates schema and
 * per-shard sequence integrity, degrading fail-open on individual bad files.
 */
export class ObservationLogStore {
  private readonly enqueue: (path: string, record: PendingLogRecord) => Promise<number>;
  private readonly shardsByPath = new Map<string, ShardId>();
  private rotationCounter = 0;
  // Per-shard creation time (oldest on-disk record timestamp), cached so the age
  // check does not re-read the shard on every append. Cleared on rotation.
  private readonly shardCreatedAtMs = new Map<string, number>();
  // Per-shard consecutive rotation-failure counts. Per-shard (not store-wide) so
  // one shard's successful rotation cannot mask another shard's persistent failure.
  private readonly rotationFailuresByPath = new Map<string, number>();
  private lastRotationError: unknown = undefined;

  constructor(
    private readonly fileWriter: FileWriter,
    private readonly fileReader: FileReader,
    private readonly writerId: string,
  ) {
    this.enqueue = createShardWriteQueue(
      {
        writeFile: (path, content) => this.fileWriter.writeFile(path, content),
        rename: (from, to) => this.fileWriter.rename(from, to),
        deleteFile: (path) => this.fileWriter.deleteFile(path),
      },
      (path) => this.readExisting(path),
      (path) => this.computeInitialSequence(path),
      (path, err) => console.warn(`ObservationLogStore: append failed for ${path}`, err),
      (path) => this.rotateIfNeeded(path),
    );
  }

  /** The writer identity this store instance is bound to. */
  getWriterId(): string {
    return this.writerId;
  }

  /**
   * Observability into shard rotation health. `rotateIfNeeded` runs as a
   * post-append maintenance step and stays fail-open, so callers/monitoring use
   * this to detect persistent archival failures (disk full, permission errors)
   * that would otherwise only appear as repeated log lines.
   */
  getRotationHealth(): {
    readonly consecutiveFailures: number;
    readonly degraded: boolean;
    readonly lastError: unknown;
  } {
    let maxFailures = 0;
    for (const count of this.rotationFailuresByPath.values()) {
      if (count > maxFailures) maxFailures = count;
    }
    return {
      consecutiveFailures: maxFailures,
      degraded: maxFailures >= ROTATION_FAILURE_DEGRADE_THRESHOLD,
      lastError: this.lastRotationError,
    };
  }

  async append(shardId: ShardId, record: PendingLogRecord): Promise<number> {
    if (shardId.writerId !== this.writerId) {
      throw new Error(
        `ObservationLogStore.append: shardId.writerId (${shardId.writerId}) does not match store writerId (${this.writerId})`,
      );
    }
    const path = toPhysicalPath(shardId);
    this.shardsByPath.set(path, shardId);
    return this.enqueue(path, record);
  }

  async readAll(): Promise<readonly PersistedLogRecord[]> {
    const activePaths = await this.fileReader.listFiles(EVENTS_ROOT);
    const archivePaths = await this.fileReader.listFiles(ARCHIVE_ROOT);
    const activePathSet = new Set(activePaths);
    const seenArchivePaths = new Set<string>(archivePaths);
    // Archive segments (older) precede active segments; sort within each group
    // for deterministic traversal. Spread first since listFiles returns readonly.
    const allPaths = [...[...archivePaths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), ...[...activePaths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))];
    const records: PersistedLogRecord[] = [];

    const ingest = (content: string, sourcePath: string): void => {
      for (const line of content.split("\n").filter((l) => l.trim())) {
        try {
          const parsed: unknown = JSON.parse(line);
          validateRecordSchema(parsed);
          records.push(parsed as PersistedLogRecord);
        } catch (err) {
          console.error(`Failed to parse or validate line in ${sourcePath}`, err);
        }
      }
    };

    for (const path of allPaths) {
      let content: string;
      try {
        content = await this.fileReader.readFile(path);
      } catch (err) {
        // `readAll` is not serialized with the write queue, so an active shard can
        // be rotated into the archive between our listFiles snapshots and this
        // read. When the active read misses, recover that specific shard's freshly
        // archived segment(s) by identity so a concurrent rotation cannot silently
        // drop records. Recovery is scoped to the missed shard, so a shard already
        // read from its active path is never re-ingested (no duplicate records).
        if (activePathSet.has(path)) {
          await this.recoverRotatedShard(path, seenArchivePaths, ingest);
        }
        console.error(`Failed to read event file ${path}`, err);
        continue;
      }
      ingest(content, path);
    }

    try {
      validateShardSequences(records);
    } catch (err) {
      console.warn("Failed to validate shard sequences, continuing", err);
    }
    return records;
  }

  /**
   * Recovers records for a shard whose active segment disappeared mid-`readAll`
   * (a rotation renamed it into the archive after our archive snapshot). Lists the
   * shard's archive directory and ingests only segments not already covered by the
   * initial snapshot, matched by shard identity so unrelated shards are never
   * re-read — keeping `readAll` free of duplicate records.
   */
  private async recoverRotatedShard(
    activePath: string,
    seenArchivePaths: ReadonlySet<string>,
    ingest: (content: string, sourcePath: string) => void,
  ): Promise<void> {
    const shardIdentity = fromPhysicalPath(activePath);
    if (!shardIdentity) return;
    const { agentId, safeSessionId, writerId } = shardIdentity;
    const archiveDir = `${ARCHIVE_ROOT}/${agentId}/${safeSessionId}`;
    let archives: readonly string[];
    try {
      archives = await this.fileReader.listFiles(archiveDir);
    } catch (err) {
      console.error(`Failed to re-scan archive for rotated shard ${activePath}`, err);
      return;
    }
    for (const arch of [...archives].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (seenArchivePaths.has(arch)) continue;
      if (!arch.split("/").pop()?.startsWith(`${writerId}.`)) continue;
      try {
        const content = await this.fileReader.readFile(arch);
        ingest(content, arch);
      } catch (err) {
        console.error(`Failed to read recovered archive segment ${arch}`, err);
      }
    }
  }

  private async readExisting(path: string): Promise<string> {
    return (await this.fileReader.fileExists(path)) ? this.fileReader.readFile(path) : "";
  }

  private async computeInitialSequence(path: string): Promise<number> {
    let maxSeq = 0;
    const readMaxSeq = async (p: string): Promise<void> => {
      if (!(await this.fileReader.fileExists(p))) return;
      const content = await this.fileReader.readFile(p);
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const rec = JSON.parse(line) as { readonly sequence?: unknown };
          if (typeof rec.sequence === "number" && rec.sequence > maxSeq) {
            maxSeq = rec.sequence;
          }
        } catch {
          /* skip malformed line during max-sequence scan (fail-open) */
        }
      }
    };

    await readMaxSeq(path);

    // Also account for archived segments of the same shard so sequence numbers
    // remain monotonic across rotation boundaries.
    const shardIdentity = fromPhysicalPath(path);
    if (shardIdentity) {
      const { agentId, safeSessionId, writerId } = shardIdentity;
      const archiveDir = `${ARCHIVE_ROOT}/${agentId}/${safeSessionId}`;
      const archives = await this.fileReader.listFiles(archiveDir);
      for (const arch of archives) {
        if (arch.split("/").pop()?.startsWith(`${writerId}.`)) {
          await readMaxSeq(arch);
        }
      }
    }
    return maxSeq;
  }

  /**
   * Runs inside the per-shard serialization queue (as `onAppendComplete`) so
   * rotation can never interleave with a concurrent append to the same shard.
   * When the active segment is oversized or aged out, it is moved to the archive
   * (the archive parent is created recursively by `rename`). The in-memory counter is
   * preserved and `computeInitialSequence` re-reads archives on a cold start, so
   * sequence numbering stays continuous across rotation boundaries (D23/D33).
   */
  private async rotateIfNeeded(path: string): Promise<void> {
    const shardId = this.shardsByPath.get(path);
    if (!shardId) return;
    const now = new Date();
    const createdMs = await this.ensureShardCreatedAtMs(path);
    if (!(await shouldRotate(this.fileReader, path, createdMs, now))) return;

    // FileWriter.rename creates the archive parent directory recursively (its
    // contract, also relied on by the write queue), so no explicit mkdir is needed.
    // A per-store monotonic counter makes the archive filename unique even if two
    // rotations of the same shard land in the same millisecond (avoids overwrite/loss).
    const stamp = `${rotationTimestamp(now)}${this.rotationCounter++}`;
    try {
      await this.fileWriter.rename(path, toArchivePath(shardId, stamp));
      // The active segment is gone; forget its cached creation time and failure
      // count so the next append to this path starts a fresh segment.
      this.shardCreatedAtMs.delete(path);
      this.rotationFailuresByPath.delete(path);
      if (this.rotationFailuresByPath.size === 0) this.lastRotationError = undefined;
    } catch (err) {
      // The append already durably persisted the record, so stay fail-open (never
      // rethrow into the write queue). But do not swallow the failure: the
      // oversized/aged segment is still live and repeated rename failures (disk
      // full, permissions) must be observable. Escalate to console.error and track
      // a per-shard counter that flips the store into a queryable degraded state.
      const failures = (this.rotationFailuresByPath.get(path) ?? 0) + 1;
      this.rotationFailuresByPath.set(path, failures);
      this.lastRotationError = err;
      console.error(
        `ObservationLogStore: shard rotation failed for ${path} (consecutive failures=${failures})`,
        err,
      );
    }
  }

  /**
   * Resolves and caches a shard's creation time as the timestamp of its oldest
   * on-disk record. `atomicAppend` rewrites the shard via a temp-file rename on
   * every append, which resets BOTH mtime and birthtime to "now", so filesystem
   * timestamps cannot measure a shard's age. The log is append-only with monotonic
   * timestamps, so the first record is the oldest; reading it once per shard (on a
   * cache miss) is restart-safe and survives the rename inode swap.
   */
  private async ensureShardCreatedAtMs(path: string): Promise<number> {
    const cached = this.shardCreatedAtMs.get(path);
    if (cached !== undefined) return cached;
    const createdMs = (await this.readOldestRecordMs(path)) ?? Date.now();
    this.shardCreatedAtMs.set(path, createdMs);
    return createdMs;
  }

  /**
   * Reads the timestamp (epoch ms) of a shard's oldest record — its first
   * non-empty line. Returns null when the file is missing/empty or the first
   * record lacks a parseable ISO `timestamp`, so callers fall back to "now".
   */
  private async readOldestRecordMs(path: string): Promise<number | null> {
    let content: string;
    try {
      content = await this.fileReader.readFile(path);
    } catch {
      return null;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as { readonly timestamp?: unknown };
        if (typeof rec.timestamp === "string") {
          const ms = Date.parse(rec.timestamp);
          if (!Number.isNaN(ms)) return ms;
        }
      } catch {
        /* first record unparseable — fall back to "now" */
      }
      return null;
    }
    return null;
  }
}
