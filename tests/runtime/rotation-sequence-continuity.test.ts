// tests/runtime/rotation-sequence-continuity.test.ts
import { describe, expect, it } from "vitest";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import type { FileReader, FileWriter, ShardId } from "../../src/core/types";
import type { PendingLogRecord } from "../../src/core/v2/observation-model";

function createMemFs(): {
  files: Map<string, string>;
  reader: FileReader;
  writer: FileWriter;
  setLargeStatCalls: (n: number) => void;
} {
  const files = new Map<string, string>();
  let largeStatCalls = 0;
  const reader: FileReader = {
    readFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error(`ENOENT: ${p}`);
      return c;
    },
    fileExists: async (p) => files.has(p),
    listFiles: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix) && k.endsWith(".jsonl")),
    readFileStats: async (p) => {
      const c = files.get(p);
      if (c === undefined) return null;
      // Simulate an oversized segment for the next `largeStatCalls` stat reads so
      // shouldRotate() fires deterministically without writing 5MB of content.
      if (largeStatCalls > 0) {
        largeStatCalls -= 1;
        return { size: 6 * 1024 * 1024, mtimeMs: Date.now() };
      }
      return { size: c.length, mtimeMs: Date.now() };
    },
  };
  const writer: FileWriter = {
    writeFile: async (p, content) => {
      files.set(p, content);
    },
    rename: async (from, to) => {
      const c = files.get(from);
      if (c === undefined) throw new Error(`rename: missing ${from}`);
      files.set(to, c);
      files.delete(from);
    },
    mkdir: async () => {},
    rmdir: async () => {},
    deleteFile: async (p) => {
      files.delete(p);
    },
  };
  return {
    files,
    reader,
    writer,
    setLargeStatCalls: (n: number): void => {
      largeStatCalls = n;
    },
  };
}

const shard: ShardId = { agentId: "atlas", sessionId: "ses-1", writerId: "w-1" };

function rec(): PendingLogRecord {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-06T00:00:00.000Z",
    agentId: "atlas",
    sessionId: "ses-1",
    writerId: "w-1",
    recordType: "observation",
    kind: "message",
    messageID: "m1",
    role: "assistant",
    textHash: "abc",
    finalized: true,
  };
}

describe("shard rotation + sequence continuity", () => {
  it("rotates the active segment inside the queue and continues sequence numbering across the boundary", async () => {
    const { files, reader, writer, setLargeStatCalls } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");
    const activePath = toPhysicalPath(shard);

    expect(await store.append(shard, rec())).toBe(1);
    expect(await store.append(shard, rec())).toBe(2);
    expect(await store.append(shard, rec())).toBe(3);

    // Force the post-append rotation check to see an oversized active segment.
    setLargeStatCalls(1);
    expect(await store.append(shard, rec())).toBe(4); // appended (1..4), then rotated to archive
    expect(await store.append(shard, rec())).toBe(5); // written to a fresh active segment

    // Exactly one archive segment was produced, and a fresh active segment exists.
    const archiveKeys = [...files.keys()].filter((k) => k.startsWith(".justice/archive/events/"));
    expect(archiveKeys).toHaveLength(1);
    expect(files.has(activePath)).toBe(true);

    // Sequence numbering is continuous and monotonic across the rotation boundary.
    const all = await store.readAll();
    expect(all.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it("serializes concurrent appends around a rotation without losing or duplicating sequences", async () => {
    const { reader, writer, setLargeStatCalls } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");

    // The first-processed append (queue is FIFO) triggers exactly one rotation.
    setLargeStatCalls(1);
    const seqs = await Promise.all(Array.from({ length: 10 }, () => store.append(shard, rec())));

    expect([...seqs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const all = await store.readAll();
    expect(all.map((r) => r.sequence).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("moves the segment into the archive tree even when that subtree did not exist yet", async () => {
    const { files, reader, writer, setLargeStatCalls } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");

    // No archive path exists initially.
    expect([...files.keys()].some((k) => k.startsWith(".justice/archive/events/"))).toBe(false);

    setLargeStatCalls(1);
    await store.append(shard, rec()); // triggers rotation into a previously-absent archive subtree

    const archiveKeys = [...files.keys()].filter((k) => k.startsWith(".justice/archive/events/"));
    expect(archiveKeys).toHaveLength(1);
    // Archive filename shape: .justice/archive/events/<agent>/<encSession>/w-1.<ts>.jsonl
    expect(archiveKeys[0]).toMatch(/^\.justice\/archive\/events\/atlas\/.+\/w-1\..+\.jsonl$/);
  });
});
