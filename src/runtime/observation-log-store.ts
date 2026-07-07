// src/runtime/observation-log-store.ts
import type { FileReader, FileWriter, ShardId } from "../core/types";
import type { PendingLogRecord, PersistedLogRecord } from "../core/v2/observation-model";
import { fromPhysicalPath, toPhysicalPath } from "../core/v2/shard-layout";
import { createShardWriteQueue } from "./write-queue";
import { validateRecordSchema, validateShardSequences } from "./validation";

const EVENTS_ROOT = ".justice/events";
const ARCHIVE_ROOT = ".justice/archive/events";

/**
 * Append-only observation log store. Writes are serialized per physical shard
 * path via a write queue; each append is persisted atomically (temp file +
 * rename). `readAll` merges active + archive segments and validates schema and
 * per-shard sequence integrity, degrading fail-open on individual bad files.
 */
export class ObservationLogStore {
  private readonly enqueue: (path: string, record: PendingLogRecord) => Promise<number>;

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
    return this.enqueue(toPhysicalPath(shardId), record);
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
}
