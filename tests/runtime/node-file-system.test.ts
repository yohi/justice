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

    it("should reject intermediate directory traversal", async () => {
      await expect(fs.readFile("foo/../../../etc/passwd")).rejects.toThrow("path traversal");
    });

    it("should reject empty paths as traversal or invalid", async () => {
      // resolveSafely on empty path might throw or just resolve to root. If it resolves to root,
      // it might not be considered traversal, but reading root as a file will throw EISDIR later.
      // Actually, if we want to reject empty paths, we can check how resolveSafely behaves.
      // wait, let's just make sure it doesn't allow escaping.
      // But actually, the prompt asks for: "a test that calls fs.readFile("") and expects a rejection"
      // Node's relative(root, resolve(root, "")) is "" which doesn't start with ".." nor is it absolute.
      // Let's just expect it to be rejected by the actual file system, or if we want to enforce it,
      // the test will just check it throws (either path traversal or something else).
      // Let's test the path traversal first, but actually the prompt said "adjust expected error as appropriate"
      await expect(fs.readFile("")).rejects.toThrow();
    });

    it("should reject windows style separators for traversal", async () => {
      await expect(fs.readFile("..\\..\\etc\\passwd")).rejects.toThrow("path traversal");
    });
  });
});