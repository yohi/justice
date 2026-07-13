// src/runtime/write-queue.ts
import type { PendingLogRecord } from "../core/v2/observation-model";
import { randomUUID } from "node:crypto";

type QueueItem = {
  readonly record: PendingLogRecord;
  readonly resolve: (seq: number) => void;
  readonly reject: (err: unknown) => void;
};

type QueueWriter = {
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
};

/**
 * The value returned by {@link createShardWriteQueue}: a serialized append plus
 * a synchronous cache-release hook. Read-only so callers cannot swap either fn.
 */
export type ShardWriteQueue = {
  /** Serialized append to `path`. Resolves with the assigned sequence number. */
  readonly enqueue: (path: string, record: PendingLogRecord) => Promise<number>;
  /**
   * Drops the per-shard in-memory caches (`contents`, `sequences`) for `path`
   * so they cannot grow unbounded across sessions. Only these two caches are
   * cleared: `queues`/`runningPaths` are left intact so an in-flight write is
   * never disrupted, and any later reuse of `path` re-derives correct state via
   * the `readExisting`/`getInitialSequence` fallbacks.
   */
  readonly release: (path: string) => void;
};

/**
 * Creates a per-shard, serialized write queue (`enqueue`/`release`). All appends to the same
 * physical path are processed one at a time (FIFO), guaranteeing monotonic
 * sequence numbers and preventing interleaved/corrupted writes (D23/D30).
 *
 * Persistence is atomic: the full file content (existing + new line) is written
 * to a temporary file and then renamed over the target path.
 *
 * This full read-modify-write per append deliberately favors atomicity over
 * write throughput; unbounded shard growth is mitigated separately by
 * rotation/archival (see feature/phase2-task4-rotation-archive).
 *
 * The returned queue also exposes `release(path)`, called when a session ends to
 * drop that shard's `contents`/`sequences` caches and bound memory across
 * sessions (see ObservationLogStore.destroySession).
 */
export function createShardWriteQueue(
  writer: QueueWriter,
  readExisting: (path: string) => Promise<string>,
  getInitialSequence: (path: string) => Promise<number>,
  onError: (path: string, err: unknown) => void,
  onAppendComplete?: (path: string) => Promise<boolean | void>,
): ShardWriteQueue {
  const queues = new Map<string, QueueItem[]>();
  const sequences = new Map<string, number>();
  const contents = new Map<string, string>();
  const runningPaths = new Set<string>();

  async function atomicAppend(path: string, line: string): Promise<void> {
    // Read-modify-write: preserve prior records, append the new line, then swap
    // atomically via a temp file + rename. Serialization guarantees no concurrent
    // writer touches `path`, so the read cannot race a write on the same shard.
    const existing = contents.get(path) ?? (await readExisting(path));
    const content = existing + line;
    const tempPath = `${path}.tmp.${Date.now()}.${randomUUID()}`;
    try {
      await writer.writeFile(tempPath, content);
      await writer.rename(tempPath, path);
      contents.set(path, content);
    } catch (err) {
      // Best-effort cleanup of the orphaned temp file; swallow any secondary
      // failure (e.g. the temp was never created) so the original error surfaces.
      await writer.deleteFile(tempPath).catch(() => {
        /* best-effort cleanup: ignore secondary failure */
      });
      throw err;
    }
  }

  async function process(path: string): Promise<void> {
    if (runningPaths.has(path)) return;
    runningPaths.add(path);

    try {
      if (!sequences.has(path)) {
        const initSeq = await getInitialSequence(path);
        sequences.set(path, initSeq);
      }
      let items = queues.get(path);
      while (items && items.length > 0) {
        const current = items.shift()!;
        try {
          const nextSeq = (sequences.get(path) ?? 0) + 1;
          const line = `${JSON.stringify({ ...current.record, sequence: nextSeq })}\n`;
          await atomicAppend(path, line);
          sequences.set(path, nextSeq);

          if (onAppendComplete) {
            const rotated = await onAppendComplete(path).catch((err) => {
              onError(path, err);
              return false;
            });
            if (rotated) contents.delete(path);
          }
          current.resolve(nextSeq);
        } catch (err) {
          current.reject(err);
          throw err;
        }
        items = queues.get(path);
      }
    } catch (err) {
      onError(path, err);
      const items = queues.get(path) ?? [];
      while (items.length > 0) items.shift()!.reject(err);
    } finally {
      runningPaths.delete(path);
      const items = queues.get(path);
      if (items && items.length > 0) {
        void process(path);
      } else {
        queues.delete(path);
      }
    }
  }

  return {
    enqueue: (path, record) =>
      new Promise<number>((resolve, reject) => {
        const existing = queues.get(path);
        if (existing) {
          existing.push({ record, resolve, reject });
        } else {
          queues.set(path, [{ record, resolve, reject }]);
        }
        void process(path);
      }),
    release: (path: string): void => {
      // Release only the per-shard caches that would otherwise grow unbounded
      // across sessions. `queues`/`runningPaths` are deliberately untouched: an
      // in-flight write must not be disrupted, and any later reuse re-derives
      // correct state via the readExisting/getInitialSequence fallbacks.
      contents.delete(path);
      sequences.delete(path);
    },
  };
}
