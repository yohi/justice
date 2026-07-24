// tests/runtime/observation-log-queue.test.ts
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

describe("createShardWriteQueue()", () => {
  it("appends new lines without overwriting existing records (regression: read-modify-write)", async () => {
    const { files, writer, readExisting } = createMemFs();
    const { enqueue } = createShardWriteQueue(
      writer,
      readExisting,
      async () => 0,
      () => {},
    );
    const path = ".justice/events/sisyphus/ses-1/w-1.jsonl";

    const seqs = await Promise.all([
      enqueue(path, rec()),
      enqueue(path, rec()),
      enqueue(path, rec()),
    ]);

    expect(seqs).toEqual([1, 2, 3]);
    const lines = (files.get(path) ?? "").split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(3);
    const parsed = lines.map((l) => JSON.parse(l) as { sequence: number });
    expect(parsed.map((p) => p.sequence)).toEqual([1, 2, 3]);
    // No temp files should leak after a successful rename.
    expect([...files.keys()].filter((k) => k.includes(".tmp."))).toHaveLength(0);
  });

  it("continues numbering from getInitialSequence", async () => {
    const { writer, readExisting } = createMemFs();
    const getInitialSequence = async (path: string): Promise<number> => {
      const existing = await readExisting(path);
      if (!existing) return 10; // Base value simulating archive/prior-session history
      const lines = existing.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return 10;
      const lastLine = JSON.parse(lines[lines.length - 1]) as { sequence: number };
      return lastLine.sequence;
    };
    const { enqueue } = createShardWriteQueue(writer, readExisting, getInitialSequence, () => {});
    const path = ".justice/events/sisyphus/ses-1/w-2.jsonl";

    expect(await enqueue(path, rec())).toBe(11);
    expect(await enqueue(path, rec())).toBe(12);
  });

  it("reads the existing shard content only once while the queue remains active", async () => {
    const { writer, readExisting } = createMemFs();
    let readCount = 0;
    const { enqueue } = createShardWriteQueue(
      writer,
      async (path: string): Promise<string> => {
        readCount += 1;
        return readExisting(path);
      },
      async () => 0,
      () => {},
    );
    const path = ".justice/events/sisyphus/ses-1/w-cached.jsonl";

    await enqueue(path, rec());
    await enqueue(path, rec());

    expect(readCount).toBe(1);
  });

  it("serializes concurrent enqueues to the same path (monotonic, no interleaving)", async () => {
    const { files, writer, readExisting } = createMemFs();
    const { enqueue } = createShardWriteQueue(
      writer,
      readExisting,
      async () => 0,
      () => {},
    );
    const path = ".justice/events/sisyphus/ses-1/w-3.jsonl";

    const seqs = await Promise.all(Array.from({ length: 20 }, () => enqueue(path, rec())));

    expect(seqs).toEqual(Array.from({ length: 20 }, (_v, i) => i + 1));
    const lines = (files.get(path) ?? "").split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(20);
  });

  it("processes different shard paths independently", async () => {
    const { writer, readExisting } = createMemFs();
    const { enqueue } = createShardWriteQueue(
      writer,
      readExisting,
      async () => 0,
      () => {},
    );

    const [a, b] = await Promise.all([
      enqueue(".justice/events/sisyphus/s/w-a.jsonl", rec()),
      enqueue(".justice/events/sisyphus/s/w-b.jsonl", rec()),
    ]);

    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it("rejects the failing item and drains the queue on writer error", async () => {
    const failing = {
      writeFile: async (): Promise<void> => {
        throw new Error("disk full");
      },
      rename: async (): Promise<void> => {},
      deleteFile: async (): Promise<void> => {},
    };
    const errors: unknown[] = [];
    const { enqueue } = createShardWriteQueue(
      failing,
      async () => "",
      async () => 0,
      (_path, err) => {
        errors.push(err);
      },
    );
    const path = ".justice/events/sisyphus/s/w-x.jsonl";

    const p1 = enqueue(path, rec());
    const p2 = enqueue(path, rec());

    await expect(p1).rejects.toThrow("disk full");
    await expect(p2).rejects.toThrow("disk full");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("invokes onAppendComplete after each successful append", async () => {
    const { writer, readExisting } = createMemFs();
    const completed: string[] = [];
    const { enqueue } = createShardWriteQueue(
      writer,
      readExisting,
      async () => 0,
      () => {},
      async (p) => {
        completed.push(p);
      },
    );
    const path = ".justice/events/sisyphus/s/w-c.jsonl";

    await enqueue(path, rec());
    await enqueue(path, rec());

    expect(completed).toEqual([path, path]);
  });

  it("reports onAppendComplete rejections via onError without failing the append itself", async () => {
    const { writer, readExisting } = createMemFs();
    const errors: unknown[] = [];
    const onAppendCompleteError = new Error("rotation check failed");
    const { enqueue } = createShardWriteQueue(
      writer,
      readExisting,
      async () => 0,
      (_path, err) => {
        errors.push(err);
      },
      async () => {
        throw onAppendCompleteError;
      },
    );
    const path = ".justice/events/sisyphus/s/w-oncomplete-fail.jsonl";

    // onAppendComplete failing is reported via onError but must not fail the
    // append itself: the record was already durably persisted by atomicAppend.
    const seq = await enqueue(path, rec());

    expect(seq).toBe(1);
    expect(errors).toEqual([onAppendCompleteError]);
  });

  it("cleans up temp file on rename failure", async () => {
    const files = new Map<string, string>();
    const writer = {
      writeFile: async (path: string, content: string): Promise<void> => {
        files.set(path, content);
      },
      rename: async (): Promise<void> => {
        throw new Error("EXDEV: cross-device link");
      },
      deleteFile: async (path: string): Promise<void> => {
        files.delete(path);
      },
    };
    const errors: unknown[] = [];
    const { enqueue } = createShardWriteQueue(
      writer,
      async () => "",
      async () => 0,
      (_path, err) => {
        errors.push(err);
      },
    );
    const path = ".justice/events/sisyphus/s/w-rename-fail.jsonl";

    const p = enqueue(path, rec());

    await expect(p).rejects.toThrow("EXDEV");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    // Verify temp file was cleaned up
    expect([...files.keys()].filter((k) => k.includes(".tmp."))).toHaveLength(0);
    // Verify target path was never written with final content
    expect(files.has(path)).toBe(false);
  });

  it("removes the temp file when writeFile fails (no orphaned temp)", async () => {
    const removed: string[] = [];
    const failing = {
      writeFile: async (): Promise<void> => {
        throw new Error("disk full");
      },
      rename: async (): Promise<void> => {},
      deleteFile: async (p: string): Promise<void> => {
        removed.push(p);
      },
    };
    const { enqueue } = createShardWriteQueue(
      failing,
      async () => "",
      async () => 0,
      () => {},
    );
    const path = ".justice/events/sisyphus/s/w-y.jsonl";

    await expect(enqueue(path, rec())).rejects.toThrow("disk full");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.startsWith(`${path}.tmp.`)).toBe(true);
  });
});
