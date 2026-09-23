/* eslint-disable security/detect-object-injection -- Test helper intentionally indexes fixture-backed maps by dynamic path. */
import { vi } from "vitest";
import { dirname } from "node:path";
import type {
  FileReader,
  FileWriter,
  ReservedReviewArtifactIo,
  ReviewArtifactCleanupStatus,
  ReviewArtifactInodeIdentity,
  ReviewArtifactReservation,
} from "../../src/core/types";
import { AuthorizationStore, createAuthorizationReviewBoundary } from "../../src/core/plan-authorization";
import type { PlanBridge } from "../../src/hooks/plan-bridge";

export function createMockFileReader(files: Record<string, string>): FileReader {
  return {
    readFile: vi.fn(async (_path: string) => {
      const content = files[_path];
      if (content === undefined) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${_path}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    fileExists: vi.fn(async (_path: string) => _path in files),
    listFiles: vi.fn(async (prefix: string) => {
      return Object.keys(files).filter((f) => f.startsWith(prefix));
    }),
    readFileStats: vi.fn(async (_path: string) => {
      const content = files[_path];
      if (content === undefined) return null;
      return { size: content.length, mtimeMs: Date.now() };
    }),
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
    link: vi.fn(async (from: string, to: string) => {
      if (to in writtenFiles) {
        const err = new Error(`EEXIST: file already exists: ${to}`) as NodeJS.ErrnoException;
        err.code = "EEXIST";
        throw err;
      }
      if (!(from in writtenFiles)) {
        const err = new Error(`ENOENT: source not found: ${from}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      writtenFiles[to] = writtenFiles[from]!;
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
        const err = new Error(
          `ENOENT: no such file or directory, mkdir '${path}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }

      if (directories.has(path)) {
        const err = new Error(
          `EEXIST: file already exists, mkdir '${path}'`,
        ) as NodeJS.ErrnoException;
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
        const err = new Error(
          `ENOENT: no such file or directory, open '${path}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    }),
    fileExists: vi.fn(async (path: string) => path in writer.writtenFiles),
    listFiles: vi.fn(async (prefix: string) => {
      return Object.keys(writer.writtenFiles).filter((f) => f.startsWith(prefix));
    }),
    readFileStats: vi.fn(async (path: string) => {
      const content = writer.writtenFiles[path];
      if (content === undefined) return null;
      return { size: content.length, mtimeMs: Date.now() };
    }),
  };

  return mockFs;
}
/* eslint-enable security/detect-object-injection */

/**
 * In-memory `FileReader`/`FileWriter` pair backed by a single shared `Map`.
 * Unlike `createMockFileSystem` (Record-based, combined object), this exposes
 * the raw `files` map plus separate reader/writer, matching the shape the
 * state-projection cache tests rely on.
 */
export function createMemFs(): {
  files: Map<string, string>;
  reader: FileReader;
  writer: FileWriter;
} {
  const files = new Map<string, string>();
  const reader: FileReader = {
    readFile: async (p) => {
      const c = files.get(p);
      if (c === undefined) throw new Error(`ENOENT: ${p}`);
      return c;
    },
    fileExists: async (p) => files.has(p),
    listFiles: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)),
    readFileStats: async (p) => {
      const c = files.get(p);
      return c === undefined ? null : { size: c.length, mtimeMs: 0 };
    },
  };
  const writer: FileWriter = {
    writeFile: async (p, content) => {
      files.set(p, content);
    },
    rename: async (from, to) => {
      const c = files.get(from);
      if (c === undefined) throw new Error(`rename: missing ${from}`);
      files.set(to, c);
      files.delete(from);
    },
    link: async (from, to) => {
      if (files.has(to)) {
        const error = new Error(`EEXIST: ${to}`) as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
      const content = files.get(from);
      if (content === undefined) {
        const error = new Error(`ENOENT: ${from}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      files.set(to, content);
    },
    mkdir: async () => {},
    rmdir: async () => {},
    deleteFile: async (p) => {
      files.delete(p);
    },
  };
  return { files, reader, writer };
}

export function wirePlanBridgeAuthorization(bridge: PlanBridge): void {
  const files = createMockFileSystem();
  const boundary = createAuthorizationReviewBoundary();
  bridge.setAuthorizationDependencies({
    authorizationStore: new AuthorizationStore(files, files, boundary),
    authorizationReviewBoundary: boundary,
  });
}

interface MockReservedReviewArtifactIo extends ReservedReviewArtifactIo {
  readonly reviewArtifactIdentities: Map<string, ReviewArtifactInodeIdentity>;
}

/**
 * Deterministic in-memory capability double for the reserved review artifact I/O
 * port. Identity checks mirror the native provider semantics: a write or read
 * is only permitted while the inode identity of the artifact path still matches
 * the reservation. Cleanup unlinks both paths only when the identities still
 * match, and reports the exact `ReviewArtifactCleanupStatus` (N4).
 */
export function createMockReservedReviewArtifactIo(
  files: MockFileSystem,
): MockReservedReviewArtifactIo {
  const reviewArtifactIdentities = new Map<string, ReviewArtifactInodeIdentity>();

  const identityMatches = async (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
    path: string,
  ): Promise<boolean> => {
    const current = reviewArtifactIdentities.get(path);
    return (
      current !== undefined &&
      current.device === reservation.artifactIdentity.device &&
      current.inode === reservation.artifactIdentity.inode
    );
  };

  return {
    reviewArtifactIdentities,
    writeExisting: vi.fn(
      async (
        reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
        content: string,
      ): Promise<void> => {
        if (!(await identityMatches(reservation, reservation.artifactPath))) {
          throw new Error("review artifact identity mismatch");
        }
        // eslint-disable-next-line no-param-reassign
        files.writtenFiles[reservation.artifactPath] = content;
      },
    ),
    readOnce: vi.fn(
      async (
        reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
      ): Promise<string> => {
        if (!(await identityMatches(reservation, reservation.artifactPath))) {
          throw new Error("review artifact identity mismatch");
        }
        const content = files.writtenFiles[reservation.artifactPath];
        if (content === undefined) {
          const error = new Error(
            `ENOENT: review artifact missing: ${reservation.artifactPath}`,
          ) as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        return content;
      },
    ),
    cleanup: vi.fn(
      async (
        reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
      ): Promise<ReviewArtifactCleanupStatus> => {
        if (!(await identityMatches(reservation, reservation.artifactPath))) {
          return "replacement_retained";
        }
        const leaseIdentity = reviewArtifactIdentities.get(reservation.leasePath);
        if (
          leaseIdentity === undefined ||
          leaseIdentity.device !== reservation.artifactIdentity.device ||
          leaseIdentity.inode !== reservation.artifactIdentity.inode
        ) {
          // The leaf artifact matched but its lease no longer does: the native
          // provider would quarantine the artifact instead of unlinking it.
          return "quarantine_retained";
        }
        // Route both unlinks through the (possibly failing) files.deleteFile so
        // a lease unlink failure maps to cleanup_incomplete.
        try {
          await files.deleteFile(reservation.artifactPath);
          await files.deleteFile(reservation.leasePath);
        } catch {
          return "cleanup_incomplete";
        }
        reviewArtifactIdentities.delete(reservation.artifactPath);
        reviewArtifactIdentities.delete(reservation.leasePath);
        return "cleaned";
      },
    ),
  };
}
