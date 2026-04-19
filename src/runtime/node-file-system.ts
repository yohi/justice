import type { FileReader, FileWriter } from "../core/types";
import { resolve, isAbsolute, relative, dirname, basename, join } from "node:path";
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

    const realRoot = await realpath(this.rootDir).catch((err) => {
      throw new Error(`Failed to resolve root directory: ${this.rootDir}`, { cause: err });
    });
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

    const realRoot = await realpath(this.rootDir).catch((err) => {
      throw new Error(`Failed to resolve root directory: ${this.rootDir}`, { cause: err });
    });

    // Walk up the directory tree to find the deepest existing ancestor.
    // We collect the path segments that don't exist yet to reconstruct the safe path.
    let current = resolved;
    const remaining: string[] = [];

    while (current.length >= this.rootDir.length && current.startsWith(this.rootDir)) {
      try {
        const currentReal = await realpath(current);
        const realRel = relative(realRoot, currentReal);

        if (realRel.startsWith("..") || isAbsolute(realRel)) {
          throw new Error(`Unsafe path traversal via symlink rejected: ${path}`);
        }

        // Return the canonical realpath of the existing part joined with non-existent segments.
        // This prevents TOCTOU where an ancestor is swapped for a symlink after validation.
        return remaining.length > 0
          ? join(currentReal, ...[...remaining].reverse())
          : currentReal;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          remaining.push(basename(current));
          const parent = dirname(current);
          if (parent === current) break;
          current = parent;
        } else {
          throw err;
        }
      }
    }

    // Fallback to resolved if somehow we exited the loop without a result (should not happen given rootDir exists)
    return resolved;
  }

  async rename(from: string, to: string): Promise<void> {
    const safeFrom = await this.resolveSafely(from);
    const safeTo = await this.resolveSafelyForWrite(to);

    // Ensure parent directory exists
    await fsMkdir(dirname(safeTo), { recursive: true });

    // Paths are validated — path traversal is mitigated.
    await fsRename(safeFrom, safeTo);
  }

  async mkdir(path: string, recursive: boolean): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);
    await fsMkdir(safePath, { recursive });
  }

  async rmdir(path: string): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);
    await this.bestEffortDelete(() => fsRmdir(safePath));
  }

  async deleteFile(path: string): Promise<void> {
    const safePath = await this.resolveSafelyForWrite(path);
    await this.bestEffortDelete(() => unlink(safePath));
  }

  /**
   * Execute a deletion operation and ignore ENOENT errors.
   */
  private async bestEffortDelete(op: () => Promise<void>): Promise<void> {
    try {
      await op();
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
