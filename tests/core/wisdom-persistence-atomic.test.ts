import { describe, it, expect, vi } from "vitest";
import { WisdomPersistence } from "../../src/core/wisdom-persistence";
import { WisdomStore } from "../../src/core/wisdom-store";
import type { WisdomEntry } from "../../src/core/types";
import { createMockFileReader, createMockFileWriter } from "../helpers/mock-file-system";

const defaultPath = ".justice/wisdom.json";

function makeEntry(overrides: Partial<WisdomEntry>): WisdomEntry {
  return {
    id: "w-base",
    taskId: "t",
    category: "success_pattern",
    content: "x",
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("WisdomPersistence.saveAtomic", () => {
  it("should write via temp file and rename to target", async () => {
    const writer = createMockFileWriter();
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = new WisdomStore(100);
    store.add({ taskId: "t1", category: "success_pattern", content: "Hello" });
    await persistence.saveAtomic(store);

    expect(writer.writtenFiles[defaultPath]).toBeDefined();
    const parsed = JSON.parse(writer.writtenFiles[defaultPath]!);
    expect(parsed.entries).toHaveLength(1);

    const keys = Object.keys(writer.writtenFiles);
    expect(keys.filter((k) => k.includes(".tmp."))).toHaveLength(0);

    expect(writer.writeFile).toHaveBeenCalledTimes(1);
    expect(writer.rename).toHaveBeenCalledTimes(1);
  });

  it("should merge disk and in-memory entries, preferring newer timestamps for duplicate IDs", async () => {
    const existing = {
      entries: [
        makeEntry({ id: "w-1", taskId: "t1", content: "old", timestamp: "2026-01-01T00:00:00Z" }),
        makeEntry({ id: "w-2", taskId: "t2", content: "keep-disk", timestamp: "2026-01-02T00:00:00Z" }),
      ],
      maxEntries: 100,
    };
    const reader = createMockFileReader({ [defaultPath]: JSON.stringify(existing) });
    const writer = createMockFileWriter();
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = WisdomStore.fromEntries(
      [
        makeEntry({ id: "w-1", taskId: "t1", content: "new", timestamp: "2026-01-05T00:00:00Z" }),
        makeEntry({ id: "w-3", taskId: "t3", content: "added", timestamp: "2026-01-03T00:00:00Z" }),
      ],
      100,
    );

    await persistence.saveAtomic(store);
    const parsed = JSON.parse(writer.writtenFiles[defaultPath]!);
    const byId = Object.fromEntries(
      (parsed.entries as WisdomEntry[]).map((e) => [e.id, e]),
    );

    expect(byId["w-1"]?.content).toBe("new");
    expect(byId["w-2"]?.content).toBe("keep-disk");
    expect(byId["w-3"]?.content).toBe("added");
    expect(parsed.entries).toHaveLength(3);
  });

  it("should trim merged entries to maxEntries using the most-recent timestamps", async () => {
    const diskEntries = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ id: `w-d${i}`, content: `d${i}`, timestamp: `2026-01-01T00:0${i}:00Z` }),
    );
    const memEntries = Array.from({ length: 6 }, (_, i) =>
      makeEntry({ id: `w-m${i}`, content: `m${i}`, timestamp: `2026-02-01T00:0${i}:00Z` }),
    );
    const reader = createMockFileReader({
      [defaultPath]: JSON.stringify({ entries: diskEntries, maxEntries: 10 }),
    });
    const writer = createMockFileWriter();
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = WisdomStore.fromEntries(memEntries, 10);
    await persistence.saveAtomic(store);

    const parsed = JSON.parse(writer.writtenFiles[defaultPath]!);
    expect(parsed.entries).toHaveLength(10);
    for (const e of memEntries) {
      expect((parsed.entries as WisdomEntry[]).map((x) => x.id)).toContain(e.id);
    }
  });

  it("should propagate rename errors and remove the temp file", async () => {
    const writer = createMockFileWriter();
    writer.rename = vi.fn(async () => {
      throw new Error("rename failed");
    });
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = new WisdomStore(100);
    store.add({ taskId: "t1", category: "success_pattern", content: "x" });

    await expect(persistence.saveAtomic(store)).rejects.toThrow("rename failed");
    expect(writer.writtenFiles[defaultPath]).toBeUndefined();
    expect(
      Object.keys(writer.writtenFiles).filter((k) => k.includes(".tmp.")),
    ).toHaveLength(0);
    expect(writer.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("should still propagate the rename error when tmp cleanup also fails", async () => {
    const writer = createMockFileWriter();
    writer.rename = vi.fn(async () => {
      throw new Error("rename failed");
    });
    writer.deleteFile = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = new WisdomStore(100);
    store.add({ taskId: "t1", category: "success_pattern", content: "x" });

    await expect(persistence.saveAtomic(store)).rejects.toThrow("rename failed");
    expect(writer.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("should use unique temp file names across concurrent calls and merge all entries", async () => {
    const writer = createMockFileWriter();
    const reader = createMockFileReader({});
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    // Patch reader to use the shared writtenFiles from writer for consistent testing
    reader.readFile = vi.fn(async (path: string) => {
      if (path in writer.writtenFiles) return writer.writtenFiles[path]!;
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    });
    reader.fileExists = vi.fn(async (path: string) => path in writer.writtenFiles);

    const writtenPaths: string[] = [];
    const originalWriteFile = writer.writeFile.bind(writer);
    writer.writeFile = vi.fn(async (path: string, content: string) => {
      writtenPaths.push(path);
      await originalWriteFile(path, content);
    });

    const s1 = new WisdomStore(100);
    s1.add({ taskId: "t1", category: "success_pattern", content: "a" });
    const s2 = new WisdomStore(100);
    s2.add({ taskId: "t2", category: "success_pattern", content: "b" });

    // Concurrent calls should now be serialized by the lock
    await Promise.all([persistence.saveAtomic(s1), persistence.saveAtomic(s2)]);

    const tmpPaths = writtenPaths.filter((p) => p.includes(".tmp."));
    expect(new Set(tmpPaths).size).toBe(tmpPaths.length);

    // Final file should contain BOTH entries because of lock-protected RMW
    const finalData = JSON.parse(writer.writtenFiles[defaultPath]!);
    expect(finalData.entries).toHaveLength(2);
    const taskIds = (finalData.entries as WisdomEntry[]).map((e) => e.taskId);
    expect(taskIds).toContain("t1");
    expect(taskIds).toContain("t2");
  });

  it("should return an empty store if maxEntries is 0 (slice(-0) fix)", async () => {
    const reader = createMockFileReader({});
    const writer = createMockFileWriter();
    const persistence = new WisdomPersistence(reader, writer, defaultPath);

    const store = new WisdomStore(0);
    store.add({ taskId: "t1", category: "success_pattern", content: "x" });

    await persistence.saveAtomic(store);

    const finalData = JSON.parse(writer.writtenFiles[defaultPath]!);
    expect(finalData.entries).toHaveLength(0);
    expect(finalData.maxEntries).toBe(0);
  });
});
