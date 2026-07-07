// tests/runtime/rotation-sequence-continuity.test.ts
import { describe, expect, it } from "vitest";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { toPhysicalPath } from "../../src/core/v2/shard-layout";
import { encodeSafeSegment } from "../../src/core/v2/safe-segment";
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

// ---------------------------------------------------------------------------
// Review fixes (PR #128).
// ---------------------------------------------------------------------------

function makeWriter(files: Map<string, string>, opts: { failArchiveRename?: boolean } = {}): FileWriter {
  const writer: FileWriter = {
    writeFile: async (p, content) => {
      files.set(p, content);
    },
    rename: async (from, to) => {
      if (opts.failArchiveRename && to.startsWith(".justice/archive/events/")) {
        throw new Error(`EACCES: archive rename denied for ${to}`);
      }
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
  return writer;
}

describe("age-based rotation uses the oldest record timestamp, not filesystem mtime/birthtime", () => {
  it("rotates an actively-written shard whose oldest record predates the age threshold", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");

    // The oldest on-disk record is far in the past → age >> MAX_SHARD_AGE_DAYS,
    // even though the shard is written "now". `atomicAppend` resets both mtime and
    // birthtime on every append, so only record content can reveal the true age.
    await store.append(shard, { ...rec(), timestamp: "2020-01-01T00:00:00.000Z" });

    const archiveKeys = [...files.keys()].filter((k) => k.startsWith(".justice/archive/events/"));
    expect(archiveKeys).toHaveLength(1);
  });

  it("does not rotate a shard whose oldest record is recent", async () => {
    const { files, reader, writer } = createMemFs();
    const store = new ObservationLogStore(writer, reader, "w-1");

    await store.append(shard, { ...rec(), timestamp: new Date().toISOString() });

    const archiveKeys = [...files.keys()].filter((k) => k.startsWith(".justice/archive/events/"));
    expect(archiveKeys).toHaveLength(0);
  });
});

describe("rotation failure observability", () => {
  function oversizedReader(files: Map<string, string>): FileReader {
    const reader: FileReader = {
      readFile: async (p) => {
        const c = files.get(p);
        if (c === undefined) throw new Error(`ENOENT: ${p}`);
        return c;
      },
      fileExists: async (p) => files.has(p),
      listFiles: async (prefix) =>
        [...files.keys()].filter((k) => k.startsWith(prefix) && k.endsWith(".jsonl")),
      // Always oversized so a rotation is attempted after every append.
      readFileStats: async (p) => {
        const c = files.get(p);
        if (c === undefined) return null;
        return { size: 6 * 1024 * 1024, mtimeMs: Date.now() };
      },
    };
    return reader;
  }

  it("keeps append fail-open but surfaces a persistent rotation failure", async () => {
    const files = new Map<string, string>();
    const store = new ObservationLogStore(
      makeWriter(files, { failArchiveRename: true }),
      oversizedReader(files),
      "w-1",
    );
    const activePath = toPhysicalPath(shard);

    // The append itself still succeeds even though the rotation cannot complete.
    expect(await store.append(shard, rec())).toBe(1);
    // The oversized active segment is retained (failed rotation must not lose data).
    expect(files.has(activePath)).toBe(true);
    expect([...files.keys()].some((k) => k.startsWith(".justice/archive/events/"))).toBe(false);

    const afterOne = store.getRotationHealth();
    expect(afterOne.consecutiveFailures).toBe(1);
    expect(afterOne.lastError).toBeInstanceOf(Error);

    // Repeated failures flip the store into a queryable degraded state.
    await store.append(shard, rec());
    await store.append(shard, rec());
    expect(store.getRotationHealth().degraded).toBe(true);
  });

  it("clears the failure signal once a rotation later succeeds", async () => {
    const files = new Map<string, string>();
    let denyArchive = true;
    const writer: FileWriter = {
      writeFile: async (p, content) => {
        files.set(p, content);
      },
      rename: async (from, to) => {
        if (denyArchive && to.startsWith(".justice/archive/events/")) {
          throw new Error(`EACCES: archive rename denied for ${to}`);
        }
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
    const store = new ObservationLogStore(writer, oversizedReader(files), "w-1");

    await store.append(shard, rec());
    expect(store.getRotationHealth().consecutiveFailures).toBe(1);

    denyArchive = false;
    await store.append(shard, rec());
    const health = store.getRotationHealth();
    expect(health.consecutiveFailures).toBe(0);
    expect(health.degraded).toBe(false);
  });
});

describe("readAll recovers from a rotation racing the active/archive snapshots", () => {
  it("re-scans the archive when an active shard is rotated away mid-read", async () => {
    const enc = encodeSafeSegment("ses-1");
    const activePath = toPhysicalPath(shard);
    const archivePath = `.justice/archive/events/atlas/${enc}/w-1.20260101T000000Z.jsonl`;
    const line = `${JSON.stringify({ ...rec(), sequence: 1 })}\n`;
    let archiveListCalls = 0;
    const reader: FileReader = {
      readFile: async (p) => {
        // The active segment was rotated into the archive just before this read.
        if (p === archivePath) return line;
        const e = new Error(`ENOENT: ${p}`) as NodeJS.ErrnoException;
        e.code = "ENOENT";
        throw e;
      },
      fileExists: async () => true,
      listFiles: async (prefix) => {
        if (prefix === ".justice/events") return [activePath];
        if (prefix.startsWith(".justice/archive/events")) {
          archiveListCalls += 1;
          // First snapshot (before the rotation lands) is empty; the post-miss
          // rescan sees the rotated segment.
          return archiveListCalls === 1 ? [] : [archivePath];
        }
        return [];
      },
      readFileStats: async () => null,
    };
    const store = new ObservationLogStore(makeWriter(new Map<string, string>()), reader, "w-1");

    const all = await store.readAll();
    expect(all.map((r) => r.sequence)).toEqual([1]);
  });
});
