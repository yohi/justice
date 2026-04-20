import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createGlobalFs, NoOpPersistence } from "../../src/core/justice-plugin";
import { WisdomStore } from "../../src/core/wisdom-store";

describe("createGlobalFs", () => {
  let tempDir: string;
  const originalEnv = process.env.JUSTICE_GLOBAL_WISDOM_PATH;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "justice-globalfs-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    } else {
      process.env.JUSTICE_GLOBAL_WISDOM_PATH = originalEnv;
    }
  });

  it("should honor JUSTICE_GLOBAL_WISDOM_PATH env var and split into root + relative", async () => {
    const target = join(tempDir, "inner", "wisdom.json");
    process.env.JUSTICE_GLOBAL_WISDOM_PATH = target;

    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await createGlobalFs(logger);

    expect(result).not.toBeNull();
    expect(result!.relativePath).toBe("wisdom.json");

    await result!.fs.writeFile(result!.relativePath, "hello-globalfs");
    const onDisk = await readFile(target, "utf-8");
    expect(onDisk).toBe("hello-globalfs");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("should default to ~/.justice/wisdom.json when env var is unset", async () => {
    delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await createGlobalFs(logger);

    expect(result).not.toBeNull();
    expect(result!.relativePath).toBe("wisdom.json");
    const home = homedir();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(home).toBeTruthy();
  });

  it("should return null and log warn when mkdir throws (e.g., permission denied)", async () => {
    process.env.JUSTICE_GLOBAL_WISDOM_PATH = join(tempDir, "..", "..", "forbidden", "wisdom.json");
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await createGlobalFs(logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("Failed to initialize global wisdom store");
  });

  it("should reject relative JUSTICE_GLOBAL_WISDOM_PATH and log a warn", async () => {
    process.env.JUSTICE_GLOBAL_WISDOM_PATH = "relative/wisdom.json";
    const logger = { warn: vi.fn(), error: vi.fn() };

    const result = await createGlobalFs(logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain("must be an absolute path");
    expect(logger.warn.mock.calls[0]?.[0]).toContain("relative/wisdom.json");
  });
});

describe("NoOpPersistence", () => {
  it("should return an empty WisdomStore from load()", async () => {
    const p = new NoOpPersistence();
    const store = await p.load();
    expect(store.getAllEntries()).toHaveLength(0);
  });

  it("should silently accept save() and saveAtomic() without any I/O", async () => {
    const p = new NoOpPersistence();
    const store = new WisdomStore(100);
    store.add({ taskId: "t", category: "success_pattern", content: "x" });

    await expect(p.save(store)).resolves.toBeUndefined();
    await expect(p.saveAtomic(store)).resolves.toBeUndefined();
  });
});