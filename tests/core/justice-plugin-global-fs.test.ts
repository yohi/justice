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

  interface TestCase {
    name: string;
    envValue: string | undefined;
    expectedPathSuffix: string;
    shouldFail?: boolean;
    failMessage?: string;
  }

  const successCases: TestCase[] = [
    {
      name: "should honor JUSTICE_GLOBAL_WISDOM_PATH env var and split into root + relative",
      envValue: "__TARGET_PATH__", // Placeholder for dynamic path
      expectedPathSuffix: "wisdom.json",
    },
    {
      name: "should default to ~/.justice/wisdom.json when env var is unset",
      envValue: undefined,
      expectedPathSuffix: "wisdom.json",
    },
  ];

  it.each(successCases)("$name", async ({ envValue, expectedPathSuffix }) => {
    const target = join(tempDir, "inner", "wisdom.json");
    if (envValue === "__TARGET_PATH__") {
      process.env.JUSTICE_GLOBAL_WISDOM_PATH = target;
    } else if (envValue === undefined) {
      delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    }

    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await createGlobalFs(logger);

    expect(result).not.toBeNull();
    expect(result!.relativePath).toBe(expectedPathSuffix);

    if (envValue === "__TARGET_PATH__") {
      await result!.fs.writeFile(result!.relativePath, "hello-globalfs");
      const onDisk = await readFile(target, "utf-8");
      expect(onDisk).toBe("hello-globalfs");
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  const failureCases: TestCase[] = [
    {
      name: "should return null and log warn when mkdir throws (e.g., permission denied)",
      envValue: "__FORBIDDEN_PATH__",
      expectedPathSuffix: "",
      failMessage: "Failed to initialize global wisdom store",
    },
    {
      name: "should reject relative JUSTICE_GLOBAL_WISDOM_PATH and log a warn",
      envValue: "relative/wisdom.json",
      expectedPathSuffix: "",
      failMessage: "must be an absolute path",
    },
  ];

  it.each(failureCases)("$name", async ({ envValue, failMessage }) => {
    if (envValue === "__FORBIDDEN_PATH__") {
      process.env.JUSTICE_GLOBAL_WISDOM_PATH = join(tempDir, "..", "..", "forbidden", "wisdom.json");
    } else {
      process.env.JUSTICE_GLOBAL_WISDOM_PATH = envValue;
    }

    const logger = { warn: vi.fn(), error: vi.fn() };
    const result = await createGlobalFs(logger);

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[0]).toContain(failMessage);
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
