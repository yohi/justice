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

  describe("rename", () => {
    it("should rename a file within the root directory", async () => {
      await fs.writeFile("src.txt", "hello");
      await fs.rename("src.txt", "dst.txt");

      expect(await fs.fileExists("src.txt")).toBe(false);
      expect(await fs.fileExists("dst.txt")).toBe(true);
      expect(await fs.readFile("dst.txt")).toBe("hello");
    });

    it("should rename into a nested directory that does not exist yet and succeed", async () => {
      await fs.writeFile("src.txt", "hello");
      await fs.rename("src.txt", "nested/sub/dst.txt");
      expect(await fs.fileExists("nested/sub/dst.txt")).toBe(true);
      expect(await fs.readFile("nested/sub/dst.txt")).toBe("hello");
    });

    it("should reject absolute source paths", async () => {
      await expect(fs.rename("/etc/passwd", "out.txt")).rejects.toThrow("path traversal");
    });

    it("should reject absolute target paths", async () => {
      await fs.writeFile("src.txt", "hello");
      await expect(fs.rename("src.txt", "/tmp/out.txt")).rejects.toThrow("path traversal");
    });

    it("should reject path traversal in source or target", async () => {
      await fs.writeFile("src.txt", "hello");
      await expect(fs.rename("../escape.txt", "dst.txt")).rejects.toThrow("path traversal");
      await expect(fs.rename("src.txt", "../escape.txt")).rejects.toThrow("path traversal");
    });

    it("should reject windows style separators for traversal (rename)", async () => {
      await fs.writeFile("src.txt", "hello");
      await expect(fs.rename("..\\..\\etc\\passwd", "dst.txt")).rejects.toThrow("path traversal");
      await expect(fs.rename("src.txt", "..\\..\\etc\\passwd")).rejects.toThrow("path traversal");
    });
  });

  describe("deleteFile", () => {
    it("should delete an existing file within the root directory", async () => {
      await fs.writeFile("tmp.txt", "x");
      await fs.deleteFile("tmp.txt");
      expect(await fs.fileExists("tmp.txt")).toBe(false);
    });

    it("should NOT throw when deleting a non-existent file (best-effort)", async () => {
      await expect(fs.deleteFile("missing.txt")).resolves.not.toThrow();
    });

    it("should reject absolute paths", async () => {
      await expect(fs.deleteFile("/etc/passwd")).rejects.toThrow("path traversal");
    });

    it("should reject path traversal attempts", async () => {
      await expect(fs.deleteFile("../escape.txt")).rejects.toThrow("path traversal");
    });

    it("should reject windows style separators for traversal (deleteFile)", async () => {
      await expect(fs.deleteFile("..\\..\\etc\\passwd")).rejects.toThrow("path traversal");
    });
  });
});
