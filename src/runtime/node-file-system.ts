import type { FileReader, FileWriter } from "../core/types";
import { resolve, isAbsolute, relative, dirname } from "node:path";
import {
  mkdir as fsMkdir,
  readFile,
  writeFile,
  stat,
  realpath,
  rename as fsRename,
  unlink,
  rmdir as fsRmdir,
} from "node:fs/promises";

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
    await fsMkdir(parentDir, { recursive: true });

    await writeFile(safePath, content, "utf-8");
  }

  async fileExists(path: string): Promise<boolean> {
    try {
      const safePath = await this.resolveSafely(path);
      await stat(safePath);
      return true;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        ((err as NodeJS.ErrnoException).code === "ENOENT" ||
          (err as NodeJS.ErrnoException).code === "ENOTDIR")
      ) {
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

    const realRoot = await realpath(this.rootDir);
    const realPath = await realpath(resolved);
    const realRel = relative(realRoot, realPath);

    if (realRel.startsWith("..") || isAbsolute(realRel)) {
      throw new Error(`Unsafe path traversal via symlink rejected: ${path}`);
    }

    return realPath;
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

    const realRoot = await realpath(this.rootDir);

    // Walk up the directory tree to find the deepest existing ancestor
    let current = resolved;
    while (current.length >= this.rootDir.length && current.startsWith(this.rootDir)) {
      try {
        const currentReal = await realpath(current);
        const realRel = relative(realRoot, currentReal);

        if (realRel.startsWith("..") || isAbsolute(realRel)) {
          throw new Error(`Unsafe path traversal via symlink rejected: ${path}`);
        }

        // If we successfully realpath'd without escaping, this part of the path is safe.
        // We can break here because the ancestors of a safe realpath are also safe within the root.
        break;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          // Go up one level
          const parent = dirname(current);
          if (parent === current) break;
          current = parent;
        } else {
          throw err;
        }
      }
    }

    return resolved;
  }

  async rename(from: string, to: string): Promise<void> {
    const safeFrom = await this.resolveSafelyForWrite(from);
    const safeTo = await this.resolveSafelyForWrite(to);

    // Ensure parent directory exists
    await fsMkdir(dirname(safeTo), { recursive: true });

    // Paths are validated by resolveSafelyForWrite — path traversal is mitigated.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fsRename(safeFrom, safeTo);
  }

  async mkdir(path: string, recursive: boolean): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);
    await fsMkdir(safePath, { recursive });
  }

  async rmdir(path: string): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);
    try {
        await fsRmdir(safePath);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw err;
    }
  }

  async deleteFile(path: string): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);
    try {
      // Paths are validated by resolveSafelyForWrite — path traversal is mitigated.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await unlink(safePath);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        return;
      }
      throw err;
    }
  }
}
