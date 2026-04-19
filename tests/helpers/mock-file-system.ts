import { vi } from "vitest";
import type { FileReader, FileWriter } from "../../src/core/types";

export function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (_path: string) => {
      const content = files[_path];
      if (content === undefined) throw new Error(`File not found: ${_path}`);
      return content;
    }),
    fileExists: vi.fn(async (_path: string) => _path in files),
  };
}

export function createMockFileWriter(): FileWriter & { writtenFiles: Record<string, string> } {
  const writtenFiles: Record<string, string> = {};
  return {
    writtenFiles,
    writeFile: vi.fn(async (path: string, content: string) => {
      writtenFiles[path] = content;
    }),
    rename: vi.fn(async (from: string, to: string) => {
      if (!(from in writtenFiles)) {
        throw new Error(`rename: source not found: ${from}`);
      }
      writtenFiles[to] = writtenFiles[from];
      delete writtenFiles[from];
    }),
    deleteFile: vi.fn(async (path: string) => {
      if (!(path in writtenFiles)) {
        throw new Error(`deleteFile: file not found: ${path}`);
      }
      delete writtenFiles[path];
    }),
  };
}
