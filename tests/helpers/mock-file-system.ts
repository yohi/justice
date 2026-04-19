import { vi } from "vitest";
import { dirname } from "node:path";
import type { FileReader, FileWriter } from "../../src/core/types";

export function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (_path: string) => {
      const content = files[_path];
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${_path}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    fileExists: vi.fn(async (_path: string) => _path in files),
  };
}

export function createMockFileWriter(): FileWriter & {
  writtenFiles: Record<string, string>;
  directories: Set<string>;
} {
  const writtenFiles: Record<string, string> = {};
  const directories = new Set<string>();
  return {
    writtenFiles,
    directories,
    writeFile: vi.fn(async (path: string, content: string) => {
      writtenFiles[path] = content;
    }),
    rename: vi.fn(async (from: string, to: string) => {
      if (!(from in writtenFiles)) {
        throw new Error(`rename: source not found: ${from}`);
      }
      if (from === to) return;
      writtenFiles[to] = writtenFiles[from];
      delete writtenFiles[from];
    }),
    mkdir: vi.fn(async (path: string, recursive: boolean) => {
      if (recursive) {
        const parts = path.split("/");
        let current = "";
        for (const part of parts) {
          current = current ? `${current}/${part}` : part;
          directories.add(current);
        }
        return;
      }

      const parent = dirname(path);
      if (parent !== "." && parent !== "/" && !directories.has(parent)) {
        const err = new Error(`ENOENT: no such file or directory, mkdir '${path}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }

      if (directories.has(path)) {
        const err = new Error(`EEXIST: file already exists, mkdir '${path}'`) as NodeJS.ErrnoException;
        err.code = "EEXIST";
        throw err;
      }
      directories.add(path);
    }),
    rmdir: vi.fn(async (path: string) => {
      directories.delete(path);
    }),
    deleteFile: vi.fn(async (path: string) => {
      if (path in writtenFiles) {
        delete writtenFiles[path];
      }
    }),
  };
}
