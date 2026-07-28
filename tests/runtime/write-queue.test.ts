// tests/runtime/write-queue.test.ts
import { describe, expect, it } from "vitest";
import { createShardWriteQueue } from "../../src/runtime/write-queue";
import type { PendingLogRecord } from "../../src/core/v2/observation-model";

function rec(): PendingLogRecord {
  return {
    schemaVersion: 1,
    timestamp: "2026-07-06T00:00:00.000Z",
    agentId: "sisyphus",
    sessionId: "ses-1",
    writerId: "w-1",
    recordType: "observation",
    kind: "skill_invoked",
    skillName: "fixture-skill",
    source: "skill_tool",
  };
}

function createMemFs(): {
  files: Map<string, string>;
  writer: {
    writeFile(path: string, content: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    deleteFile(path: string): Promise<void>;
  };
  readExisting: (path: string) => Promise<string>;
} {
  const files = new Map<string, string>();
  const writer = {
    writeFile: async (path: string, content: string): Promise<void> => {
      files.set(path, content);
    },
    rename: async (from: string, to: string): Promise<void> => {
      const c = files.get(from);
      if (c === undefined) throw new Error(`rename: missing source ${from}`);
      files.set(to, c);
      files.delete(from);
    },
    deleteFile: async (path: string): Promise<void> => {
      files.delete(path);
    },
  };
  const readExisting = async (path: string): Promise<string> => files.get(path) ?? "";
  return { files, writer, readExisting };
}

describe("createShardWriteQueue() release()", () => {
  // The `contents`/`sequences` caches are closure-private, so their release is
  // asserted black-box: a released path must re-consult `readExisting`
  // (contents) and `getInitialSequence` (sequences) on its next append.

  it("release() drops the contents cache so the next append re-reads existing content", async () => {
    const { writer, readExisting } = createMemFs();
    let readCount = 0;
    const { enqueue, release } = createShardWriteQueue(
      writer,
      async (path: string): Promise<string> => {
        readCount += 1;
        return readExisting(path);
      },
      async () => 0,
      () => {},
    );
    const path = ".justice/events/sisyphus/ses-1/w-release.jsonl";

    await enqueue(path, rec());
    await enqueue(path, rec());
    // Second append is a contents cache hit: readExisting was consulted once.
    expect(readCount).toBe(1);

    release(path);

    await enqueue(path, rec());
    // The contents cache was cleared, so the next append re-reads from disk.
    expect(readCount).toBe(2);
  });

  it("release() drops the sequences cache yet numbering stays monotonic via getInitialSequence", async () => {
    const { files, writer, readExisting } = createMemFs();
    let initSeqCount = 0;
    const getInitialSequence = async (path: string): Promise<number> => {
      initSeqCount += 1;
      const existing = await readExisting(path);
      const lines = existing.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return 0;
      const last = JSON.parse(lines[lines.length - 1]!) as { sequence: number };
      return last.sequence;
    };
    const { enqueue, release } = createShardWriteQueue(
      writer,
      readExisting,
      getInitialSequence,
      () => {},
    );
    const path = ".justice/events/sisyphus/ses-1/w-seq.jsonl";

    expect(await enqueue(path, rec())).toBe(1);
    expect(await enqueue(path, rec())).toBe(2);
    // Initial sequence resolved once; the second append hit the sequences cache.
    expect(initSeqCount).toBe(1);

    release(path);

    // Cache gone: getInitialSequence is consulted again and recovers max seq (2)
    // from persisted content, so numbering continues without a gap or reset.
    expect(await enqueue(path, rec())).toBe(3);
    expect(initSeqCount).toBe(2);
    const seqs = (files.get(path) ?? "")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => (JSON.parse(l) as { sequence: number }).sequence);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("release() on an unknown path is a safe no-op", () => {
    const { writer, readExisting } = createMemFs();
    const { release } = createShardWriteQueue(
      writer,
      readExisting,
      async () => 0,
      () => {},
    );
    expect(() => release(".justice/events/sisyphus/ses-x/never.jsonl")).not.toThrow();
  });

  it("release() only clears the target path, leaving other shards cached", async () => {
    const { writer, readExisting } = createMemFs();
    const reads = new Map<string, number>();
    const { enqueue, release } = createShardWriteQueue(
      writer,
      async (path: string): Promise<string> => {
        reads.set(path, (reads.get(path) ?? 0) + 1);
        return readExisting(path);
      },
      async () => 0,
      () => {},
    );
    const pathA = ".justice/events/sisyphus/ses-1/w-a.jsonl";
    const pathB = ".justice/events/sisyphus/ses-2/w-b.jsonl";

    await enqueue(pathA, rec());
    await enqueue(pathB, rec());
    await enqueue(pathA, rec());
    await enqueue(pathB, rec());
    expect(reads.get(pathA)).toBe(1);
    expect(reads.get(pathB)).toBe(1);

    release(pathA);

    await enqueue(pathA, rec());
    await enqueue(pathB, rec());
    // Only pathA re-reads; pathB keeps its cache untouched.
    expect(reads.get(pathA)).toBe(2);
    expect(reads.get(pathB)).toBe(1);
  });
});
