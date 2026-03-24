import type { FileReader, FileWriter } from "../core/types";
import { join, resolve, isAbsolute, relative } from "node:path";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";

export class NodeFileSystem implements FileReader, FileWriter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async readFile(path: string): Promise<string> {
    const safePath = this.resolveSafely(path);
    return await readFile(safePath, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const safePath = this.resolveSafely(path);

    // Ensure parent directory exists
    const parentDir = join(safePath, "..");
    await mkdir(parentDir, { recursive: true });

    await writeFile(safePath, content, "utf-8");
  }

  async fileExists(path: string): Promise<boolean> {
    const safePath = this.resolveSafely(path);
    try {
      await stat(safePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a relative path to an absolute path within the root directory.
   * Rejects absolute paths and path traversal attempts.
   */
  private resolveSafely(path: string): string {
    if (isAbsolute(path)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    const resolved = resolve(this.rootDir, path);
    const rel = relative(this.rootDir, resolved);

    // Check for path traversal (relative path starts with ..)
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    return resolved;
  }
}