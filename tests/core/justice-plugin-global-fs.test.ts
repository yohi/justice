import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import * as fsPromises from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import * as os from "node:os";
import { join } from "node:path";
import { createGlobalFs, NoOpPersistence } from "../../src/core/justice-plugin";
import { WisdomStore } from "../../src/core/wisdom-store";

let mockHomedir: string;
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHomedir || actual.homedir(),
  };
});

let mockMkdirError: Error | undefined;
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (...args: any[]) => {
      if (mockMkdirError) throw mockMkdirError;
      return actual.mkdir(...args);
    }
  };
});

describe("createGlobalFs", () => {
  let tempDir: string;
  const originalEnv = process.env.JUSTICE_GLOBAL_WISDOM_PATH;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "justice-globalfs-"));
    vi.spyOn(os, "homedir").mockReturnValue(tempDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    } else {
      process.env.JUSTICE_GLOBAL_WISDOM_PATH = originalEnv;
    }
  });

  it.each([
    {
      name: "honor JUSTICE_GLOBAL_WISDOM_PATH env var",
      getEnv: (dir: string) => join(dir, "inner", "wisdom.json"),
      expectedRelative: "wisdom.json",
      expectSuccess: true,
      async verify(result: any, envPath: string) {
        await result.fs.writeFile(result.relativePath, "hello-globalfs");
        const onDisk = await readFile(envPath, "utf-8");
        expect(onDisk).toBe("hello-globalfs");
      },
    },
    {
      name: "default to ~/.justice/wisdom.json when env var is unset",
      getEnv: () => undefined,
      expectedRelative: "wisdom.json",
      expectSuccess: true,
      async verify(result: any) {
        await result.fs.writeFile(result.relativePath, "hello-default");
        const onDisk = await readFile(join(homedir(), ".justice", "wisdom.json"), "utf-8");
        expect(onDisk).toBe("hello-default");
      },
    },
    {
      name: "return null and log warn when mkdir throws",
      getEnv: (dir: string) => join(dir, "forbidden", "wisdom.json"),
      expectSuccess: false,
      warnMatch: "Failed to initialize global wisdom store",
      setupMock: () => {
        mockMkdirError = new Error("EACCES");
      },
    },
    {
      name: "reject relative JUSTICE_GLOBAL_WISDOM_PATH and log a warn",
      getEnv: () => "relative/wisdom.json",
      expectSuccess: false,
      warnMatch: "must be an absolute path",
    },
  ])("should $name", async ({ getEnv, expectedRelative, expectSuccess, warnMatch, verify, setupMock }: any) => {
    const envValue = getEnv(tempDir);
    if (envValue === undefined) {
      delete process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    } else {
      process.env.JUSTICE_GLOBAL_WISDOM_PATH = envValue;
    }

    const logger = { warn: vi.fn(), error: vi.fn() };
    if (setupMock) setupMock();
    const result = await createGlobalFs(logger);

    if (expectSuccess) {
      expect(result).not.toBeNull();
      expect(result!.relativePath).toBe(expectedRelative);
      expect(logger.warn).not.toHaveBeenCalled();
      if (verify) {
        await verify(result, envValue);
      }
    } else {
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[0]).toContain(warnMatch);
    }
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

