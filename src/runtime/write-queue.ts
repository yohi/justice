// src/runtime/write-queue.ts
import type { PendingLogRecord } from "../core/v2/observation-model";

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
 * Creates a per-shard, serialized write function. All appends to the same
 * physical path are processed one at a time (FIFO), guaranteeing monotonic
 * sequence numbers and preventing interleaved/corrupted writes (D23/D30).
 *
 * Persistence is atomic: the full file content (existing + new line) is written
 * to a temporary file and then renamed over the target path.
 */
export function createShardWriteQueue(
  writer: QueueWriter,
  readExisting: (path: string) => Promise<string>,
  getInitialSequence: (path: string) => Promise<number>,
  onError: (path: string, err: unknown) => void,
  onAppendComplete?: (path: string) => Promise<void>,
): (path: string, record: PendingLogRecord) => Promise<number> {
  const queues = new Map<string, QueueItem[]>();
  const sequences = new Map<string, number>();
  const runningPaths = new Set<string>();

  async function atomicAppend(path: string, line: string): Promise<void> {
    // Read-modify-write: preserve prior records, append the new line, then swap
    // atomically via a temp file + rename. Serialization guarantees no concurrent
    // writer touches `path`, so the read cannot race a write on the same shard.
    const existing = await readExisting(path);
    const content = existing + line;
    const tempPath = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await writer.writeFile(tempPath, content);
    try {
      await writer.rename(tempPath, path);
    } catch (err) {
      await writer.deleteFile(tempPath).catch(() => {});
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
            await onAppendComplete(path).catch((err) => onError(path, err));
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
        sequences.delete(path);
      }
    }
  }

  return (path, record) =>
    new Promise<number>((resolve, reject) => {
      const existing = queues.get(path);
      if (existing) {
        existing.push({ record, resolve, reject });
      } else {
        queues.set(path, [{ record, resolve, reject }]);
      }
      void process(path);
    });
}
