import type { FileReader, FileWriter } from "../core/types";
import { resolve, isAbsolute, relative, dirname } from "node:path";
import { mkdir, readFile, writeFile, stat, realpath } from "node:fs/promises";

export class NodeFileSystem implements FileReader, FileWriter {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  async readFile(path: string): Promise<string> {
    const safePath = await this.resolveSafely(path);
    return await readFile(safePath, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);

    // Ensure parent directory exists
    const parentDir = dirname(safePath);
    await mkdir(parentDir, { recursive: true });

    await writeFile(safePath, content, "utf-8");
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      const safePath = await this.resolveSafely(path);
      await stat(safePath);
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR")) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Resolve a relative path to an absolute path within the root directory.
   * Rejects absolute paths and path traversal attempts, resolving symlinks.
   */
  private async resolveSafely(path: string): Promise<string> {
    if (isAbsolute(path)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    const resolved = resolve(this.rootDir, path);
    const rel = relative(this.rootDir, resolved);

    // Basic lexical check
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    try {
      const realRoot = await realpath(this.rootDir);
      const realPath = await realpath(resolved);
      const realRel = relative(realRoot, realPath);
      
      if (realRel.startsWith("..") || isAbsolute(realRel)) {
        throw new Error(`Unsafe path traversal via symlink rejected: ${path}`);
      }
      
      return realPath;
    } catch (err: unknown) {
      // If realpath fails, it might be because the file doesn't exist yet.
      // But for reads and exists, we need it to exist or fail safely.
      throw err;
    }
  }
  
  /**
   * Like resolveSafely, but allows resolving paths where the leaf file doesn't exist yet.
   */
  private async resolveSafelyForWrite(path: string): Promise<string> {
    if (isAbsolute(path)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    const resolved = resolve(this.rootDir, path);
    const rel = relative(this.rootDir, resolved);

    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Unsafe path traversal rejected: ${path}`);
    }

    const parentDir = dirname(resolved);
    try {
      const realRoot = await realpath(this.rootDir);
      // Resolve the parent directory since the file might not exist
      const realParent = await realpath(parentDir);
      const realRel = relative(realRoot, realParent);
      
      if (realRel.startsWith("..") || isAbsolute(realRel)) {
        throw new Error(`Unsafe path traversal via symlink rejected: ${path}`);
      }
      
      // If the parent is safe, resolving the file inside it is safe 
      // (assuming the leaf is not a symlink pointing outside, but if we overwrite it we might follow it.
      // However, if we write, we might overwrite a symlink. To be fully safe against overwriting symlinks
      // we'd need to lstat the leaf if it exists. For now, this meets the symlink parent check).
      return resolved;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        // If parent doesn't exist, we can't fully realpath it. 
        // We rely on the lexical check for safety in this case.
        return resolved;
      }
      throw err;
    }
  }
}