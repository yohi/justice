import { describe, expect, it, vi } from "vitest";
import { AtomicPersistence } from "../../src/core/atomic-persistence";
import {
  createMockFileReader,
  createMockFileSystem,
  createMockFileWriter,
} from "../helpers/mock-file-system";

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
    const fs = createMockFileSystem({
      "state.json": JSON.stringify({ version: 1, data: ["disk"] }),
    });
    const persistence = new AtomicPersistence(fs, fs, config());

    const result = await persistence.saveAtomicWithLock(["memory"], { version: 0 });

    expect(result).toEqual({ status: "saved", retries: 1 });
    expect(JSON.parse(fs.writtenFiles["state.json"]!).data).toEqual(["disk", "memory"]);
  });

  it("does not mutate a replacement claim after losing ownership", async () => {
    const claimPath = "state.json.commit-pending";
    const fs = createMockFileSystem({
      "state.json": JSON.stringify({ version: 1, data: ["base"] }),
    });
    if (fs.link === undefined) throw new Error("mock filesystem must support hard links");
    const originalLink = fs.link.bind(fs);
    const originalDeleteFile = fs.deleteFile.bind(fs);
    const originalRename = fs.rename.bind(fs);
    let successfulClaims = 0;
    let aTmpPath: string | undefined;
    let resolveAClaimed: (() => void) | undefined;
    let resolveBClaimed: (() => void) | undefined;
    let resolveAAttemptFinished: (() => void) | undefined;
    let releaseBRecheck: (() => void) | undefined;
    let releaseABackoff: (() => void) | undefined;
    const aClaimed = new Promise<void>((resolve) => {
      resolveAClaimed = resolve;
    });
    const bClaimed = new Promise<void>((resolve) => {
      resolveBClaimed = resolve;
    });
    const aAttemptFinished = new Promise<void>((resolve) => {
      resolveAAttemptFinished = resolve;
    });
    const bRecheckReleased = new Promise<void>((resolve) => {
      releaseBRecheck = resolve;
    });
    const aBackoffReleased = new Promise<void>((resolve) => {
      releaseABackoff = resolve;
    });
    const link = vi.fn(async (from: string, to: string) => {
      await originalLink(from, to);
      if (to !== claimPath) return;
      successfulClaims += 1;
      if (successfulClaims === 1) {
        aTmpPath = from;
        resolveAClaimed?.();
      } else if (successfulClaims === 2) {
        resolveBClaimed?.();
      }
    });
    const deleteFile = vi.fn(async (path: string) => {
      await originalDeleteFile(path);
      if (path === aTmpPath) resolveAAttemptFinished?.();
    });
    const rename = vi.fn(async (from: string, to: string) => {
      await originalRename(from, to);
    });
    fs.link = link;
    fs.deleteFile = deleteFile;
    fs.rename = rename;

    const aReader = {
      ...fs,
      readFile: vi.fn(async (path: string) => {
        if (path === "state.json") await bClaimed;
        return fs.readFile(path);
      }),
    };
    const bReader = {
      ...fs,
      readFile: vi.fn(async (path: string) => {
        if (path === "state.json") await bRecheckReleased;
        return fs.readFile(path);
      }),
      readFileStats: vi.fn(async (path: string) => {
        if (path === claimPath) return { size: 1, mtimeMs: 0 };
        return fs.readFileStats(path);
      }),
    };
    const aConfig = {
      ...config(),
      sleep: async (): Promise<void> => {
        await aBackoffReleased;
      },
    };
    const persistenceA = new AtomicPersistence(aReader, fs, aConfig);
    const persistenceB = new AtomicPersistence(bReader, fs, config());

    const saveA = persistenceA.saveAtomicWithLock(["a"], { version: 0 });
    await aClaimed;
    const saveB = persistenceB.saveAtomicWithLock(["b"], { version: 1 });
    await bClaimed;
    await aAttemptFinished;

    const claimDeletesBeforeBPublishes = deleteFile.mock.calls.filter(
      ([path]) => path === claimPath,
    );
    const claimRenamesBeforeBPublishes = rename.mock.calls.filter(
      ([from]) => from === claimPath,
    );
    expect(claimDeletesBeforeBPublishes).toHaveLength(1);
    expect(claimRenamesBeforeBPublishes).toHaveLength(0);

    releaseBRecheck?.();
    releaseABackoff?.();
    const [resultA, resultB] = await Promise.all([saveA, saveB]);
    expect(resultA.status).toBe("saved");
    expect(resultB.status).toBe("saved");
  });

  it("retries immediately after reclaiming a stale claim", async () => {
    const fs = createMockFileSystem();
    fs.readFileStats = vi
      .fn()
      .mockResolvedValueOnce({ size: 1, mtimeMs: 0 })
      .mockResolvedValue({ size: 1, mtimeMs: Date.now() });
    if (fs.link === undefined) throw new Error("mock filesystem must support hard links");
    const originalLink = fs.link.bind(fs);
    let attempts = 0;
    fs.link = vi.fn(async (from: string, to: string) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("claim exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
      await originalLink(from, to);
    });
    const persistence = new AtomicPersistence(fs, fs, config());

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
