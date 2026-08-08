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
    const empty = new AtomicPersistence(createMockFileReader({ "state.json": "" }), createMockFileWriter(), config());
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
});
