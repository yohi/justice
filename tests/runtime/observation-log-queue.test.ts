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
  };
}

function createMemFs(): {
  files: Map<string, string>;
  writer: {
    writeFile(path: string, content: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
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
  };
  const readExisting = async (path: string): Promise<string> => files.get(path) ?? "";
  return { files, writer, readExisting };
}

describe("createShardWriteQueue()", () => {
  it("appends new lines without overwriting existing records (regression: read-modify-write)", async () => {
    const { files, writer, readExisting } = createMemFs();
    const enqueue = createShardWriteQueue(writer, readExisting, async () => 0, () => {});
    const path = ".justice/events/sisyphus/ses-1/w-1.jsonl";

    const seqs = await Promise.all([enqueue(path, rec()), enqueue(path, rec()), enqueue(path, rec())]);

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
    const enqueue = createShardWriteQueue(writer, readExisting, async () => 10, () => {});
    const path = ".justice/events/sisyphus/ses-1/w-2.jsonl";

    expect(await enqueue(path, rec())).toBe(11);
    expect(await enqueue(path, rec())).toBe(12);
  });

  it("serializes concurrent enqueues to the same path (monotonic, no interleaving)", async () => {
    const { files, writer, readExisting } = createMemFs();
    const enqueue = createShardWriteQueue(writer, readExisting, async () => 0, () => {});
    const path = ".justice/events/sisyphus/ses-1/w-3.jsonl";

    const seqs = await Promise.all(Array.from({ length: 20 }, () => enqueue(path, rec())));

    expect(seqs).toEqual(Array.from({ length: 20 }, (_v, i) => i + 1));
    const lines = (files.get(path) ?? "").split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(20);
  });

  it("processes different shard paths independently", async () => {
    const { writer, readExisting } = createMemFs();
    const enqueue = createShardWriteQueue(writer, readExisting, async () => 0, () => {});

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
    };
    const errors: unknown[] = [];
    const enqueue = createShardWriteQueue(
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
    const enqueue = createShardWriteQueue(
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
});
