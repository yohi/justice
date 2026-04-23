/* eslint-disable security/detect-object-injection -- Test helper intentionally indexes fixture-backed maps by dynamic path. */
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

export interface MockFileWriter extends FileWriter {
  writtenFiles: Record<string, string>;
  directories: Set<string>;
}

export function createMockFileWriter(): MockFileWriter {
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
        const isAbsolute = path.startsWith("/");
        const parts = path.split("/").filter((p) => p !== "");
        let current = isAbsolute ? "/" : "";
        if (isAbsolute) directories.add("/");

        for (const part of parts) {
          if (current === "/") {
            current = `/${part}`;
          } else if (current === "") {
            current = part;
          } else {
            current = `${current}/${part}`;
          }
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

export interface MockFileSystem extends FileReader, FileWriter {
  writtenFiles: Record<string, string>;
  directories: Set<string>;
}

/**
 * Creates a mock that implements both FileReader and FileWriter.
 * This is useful for TieredWisdomStore tests where the same FS object is used for both.
 */
export function createMockFileSystem(initialFiles: Record<string, string> = {}): MockFileSystem {
  const writer = createMockFileWriter();

  // Restore directory structure from initialFiles
  for (const filePath of Object.keys(initialFiles)) {
    let dir = dirname(filePath);
    while (dir !== "." && dir !== "/") {
      writer.directories.add(dir);
      const parent = dirname(dir);
      if (parent === dir) break; // Avoid infinite loop on Windows (e.g., 'C:\')
      dir = parent;
    }
    if (dir === "/") {
      writer.directories.add("/");
    }
  }

  Object.assign(writer.writtenFiles, initialFiles);

  const mockFs: MockFileSystem = {
    ...writer,
    readFile: vi.fn(async (path: string) => {
      const content = writer.writtenFiles[path];
      if (content === undefined) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    fileExists: vi.fn(async (path: string) => path in writer.writtenFiles),
  };

  return mockFs;
}
/* eslint-enable security/detect-object-injection */
