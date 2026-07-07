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

function ageInDays(mtimeMs: number, now: Date): number {
  return (now.getTime() - mtimeMs) / MS_PER_DAY;
}

async function shouldRotate(fileReader: FileReader, path: string, now: Date): Promise<boolean> {
  const stats = await fileReader.readFileStats(path);
  if (!stats) return false;
  return stats.size >= MAX_SHARD_SIZE_BYTES || ageInDays(stats.mtimeMs, now) >= MAX_SHARD_AGE_DAYS;
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
    // Archive segments (older) precede active segments; sort within each group
    // for deterministic traversal. Spread first since listFiles returns readonly.
    const allPaths = [...[...archivePaths].sort(), ...[...activePaths].sort()];
    const records: PersistedLogRecord[] = [];

    for (const path of allPaths) {
      let content: string;
      try {
        content = await this.fileReader.readFile(path);
      } catch (err) {
        console.error(`Failed to read event file ${path}`, err);
        continue;
      }
      for (const line of content.split("\n").filter((l) => l.trim())) {
        try {
          const parsed: unknown = JSON.parse(line);
          validateRecordSchema(parsed);
          records.push(parsed as PersistedLogRecord);
        } catch (err) {
          console.error(`Failed to parse or validate line in ${path}`, err);
        }
      }
    }

    try {
      validateShardSequences(records);
    } catch (err) {
      console.warn("Failed to validate shard sequences, continuing", err);
    }
    return records;
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
    if (!(await shouldRotate(this.fileReader, path, now))) return;

    // FileWriter.rename creates the archive parent directory recursively (its
    // contract, also relied on by the write queue), so no explicit mkdir is needed.
    // A per-store monotonic counter makes the archive filename unique even if two
    // rotations of the same shard land in the same millisecond (avoids overwrite/loss).
    const stamp = `${rotationTimestamp(now)}${this.rotationCounter++}`;
    await this.fileWriter.rename(path, toArchivePath(shardId, stamp));
  }
}
