import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("NodeFileSystem", () => {
  let tempDir: string;
  let fs: NodeFileSystem;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "justice-test-"));
    fs = new NodeFileSystem(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("writeFile + readFile", () => {
    it("should write and read back file content", async () => {
      await fs.writeFile("test.md", "# Hello\n");
      const content = await fs.readFile("test.md");
      expect(content).toBe("# Hello\n");
    });

    it("should create parent directories if they don't exist", async () => {
      await fs.writeFile("docs/plans/plan.md", "# Plan\n");
      const content = await fs.readFile("docs/plans/plan.md");
      expect(content).toBe("# Plan\n");
    });
  });

  describe("fileExists", () => {
    it("should return true for existing files", async () => {
      await fs.writeFile("exists.md", "content");
      expect(await fs.fileExists("exists.md")).toBe(true);
    });

    it("should return false for non-existing files", async () => {
      expect(await fs.fileExists("missing.md")).toBe(false);
    });
  });

  describe("path safety", () => {
    it("should reject absolute paths", async () => {
      await expect(fs.readFile("/etc/passwd")).rejects.toThrow("path traversal");
    });

    it("should reject path traversal attempts", async () => {
      await expect(fs.readFile("../etc/passwd")).rejects.toThrow("path traversal");
    });
  });
});