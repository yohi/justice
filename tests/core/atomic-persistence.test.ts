import { describe, expect, it, vi } from "vitest";
import { AtomicPersistence } from "../../src/core/atomic-persistence";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

function config() {
  return {
    filePath: "state.json",
    conflictPath: "state.conflict.json",
    serialize: (value: readonly string[]) => JSON.stringify(value),
    deserialize: (raw: string): readonly string[] => JSON.parse(raw) as readonly string[],
    merge: (mine: readonly string[], theirs: readonly string[]) => [...theirs, ...mine],
    emptyValue: () => [],
    sleep: async (): Promise<void> => {},
  };
}

describe("AtomicPersistence", () => {
  it("loads empty, legacy, and versioned payloads", async () => {
    const empty = new AtomicPersistence(
      createMockFileReader({ "state.json": "" }),
      createMockFileWriter(),
      config(),
    );
    expect((await empty.loadWithLock()).lockMeta.version).toBe(0);

    const legacy = new AtomicPersistence(
      createMockFileReader({ "state.json": JSON.stringify(["legacy"]) }),
      createMockFileWriter(),
      config(),
    );
    expect((await legacy.loadWithLock()).data).toEqual(["legacy"]);

    const versioned = new AtomicPersistence(
      createMockFileReader({ "state.json": JSON.stringify({ version: 4, data: ["current"] }) }),
      createMockFileWriter(),
      config(),
    );
    const loaded = await versioned.loadWithLock();
    expect(loaded.data).toEqual(["current"]);
    expect(loaded.lockMeta.version).toBe(4);
  });

  it("rejects corrupted JSON and non-ENOENT read failures", async () => {
    const corrupted = new AtomicPersistence(
      createMockFileReader({ "state.json": "{" }),
      createMockFileWriter(),
      config(),
    );
    await expect(corrupted.loadWithLock()).resolves.toEqual({
      data: [],
      lockMeta: { version: 0 },
    });

    const reader = createMockFileReader({});
    reader.readFile = vi.fn(async () => {
      const error = new Error("permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      throw error;
    });
    const inaccessible = new AtomicPersistence(reader, createMockFileWriter(), config());
    await expect(inaccessible.loadWithLock()).rejects.toThrow("permission denied");
  });

  it("does not claim success when the writer cannot provide an exclusive claim primitive", async () => {
    const writer = createMockFileWriter();
    writer.link = undefined;
    const persistence = new AtomicPersistence(createMockFileReader({}), writer, config());

    const result = await persistence.saveAtomicWithLock(["unsafe-fallback"]);

    expect(result.status).toBe("conflict_diverted");
  });

  it("retries after a version mismatch and then saves", async () => {
    const reader = createMockFileReader({});
    reader.readFile = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ version: 1, data: ["disk"] }))
      .mockResolvedValue(JSON.stringify({ version: 1, data: ["disk"] }));
    const writer = createMockFileWriter();
    const persistence = new AtomicPersistence(reader, writer, config());

    const result = await persistence.saveAtomicWithLock(["memory"], { version: 0 });

    expect(result).toEqual({ status: "saved", retries: 1 });
    expect(JSON.parse(writer.writtenFiles["state.json"]!).data).toEqual(["disk", "memory"]);
  });

  it("retries immediately after reclaiming a stale claim", async () => {
    const reader = createMockFileReader({});
    reader.readFileStats = vi
      .fn()
      .mockResolvedValueOnce({ size: 1, mtimeMs: 0 })
      .mockResolvedValue({ size: 1, mtimeMs: Date.now() });
    const writer = createMockFileWriter();
    let attempts = 0;
    writer.link = vi.fn(async (from, to) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("claim exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
      await writer.rename(from, to);
    });
    const persistence = new AtomicPersistence(reader, writer, config());

    const result = await persistence.saveAtomicWithLock(["after-reclaim"]);

    expect(result).toEqual({ status: "saved", retries: 0 });
    expect(attempts).toBe(2);
  });

  it("diverts to a conflict file after repeated claim failures", async () => {
    const reader = createMockFileReader({});
    reader.readFileStats = vi.fn(async () => ({ size: 1, mtimeMs: 0 }));
    const writer = createMockFileWriter();
    writer.link = vi.fn(async () => {
      const error = new Error("claim exists") as NodeJS.ErrnoException;
      error.code = "EEXIST";
      throw error;
    });
    const persistence = new AtomicPersistence(reader, writer, config());

    const result = await persistence.saveAtomicWithLock(["conflict"]);

    expect(result.status).toBe("conflict_diverted");
    expect(writer.writtenFiles["state.conflict.json"]).toBeDefined();
  });

  it("fails open when the claim operation raises an unexpected error", async () => {
    const writer = createMockFileWriter();
    writer.link = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const persistence = new AtomicPersistence(createMockFileReader({}), writer, config());

    const result = await persistence.saveAtomicWithLock(["safe"]);

    expect(result.status).toBe("conflict_diverted");
  });

  it("cleans up the attempt temporary file when claim raises", async () => {
    const writer = createMockFileWriter();
    writer.link = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const persistence = new AtomicPersistence(createMockFileReader({}), writer, config());

    await persistence.saveAtomicWithLock(["safe"]);

    expect(
      Object.keys(writer.writtenFiles).some((path) => path.startsWith("state.json.tmp.")),
    ).toBe(false);
  });

  it("does not throw when diversion fails and still returns conflict_diverted", async () => {
    const reader = createMockFileReader({
      "state.conflict.json": JSON.stringify({
        version: 1,
        conflicts: [],
      }),
    });
    const writer = createMockFileWriter();
    writer.rename = vi.fn(async () => {
      throw new Error("rename failed");
    });
    const persistence = new AtomicPersistence(reader, writer, config());

    const result = await persistence.saveAtomicWithLock(["conflict"]);

    expect(result.status).toBe("conflict_diverted");
    expect(
      Object.keys(writer.writtenFiles).some((path) => path.startsWith("state.conflict.json.tmp.")),
    ).toBe(false);
  });
});
