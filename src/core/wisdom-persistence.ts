import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { dirname } from "node:path";
import type { FileReader, FileWriter, WisdomEntry } from "./types";
import { WisdomStore } from "./wisdom-store";

/**
 * WisdomPersistence handles reading and writing WisdomStore data
 * to the filesystem. Keeps I/O concerns separate from the pure WisdomStore logic.
 */
export class WisdomPersistence {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly wisdomFilePath: string = ".justice/wisdom.json",
  ) {}

  /**
   * Loads WisdomStore from file. Returns an empty store if the file doesn't
   * exist or contains invalid data.
   */
  async load(): Promise<WisdomStore> {
    const exists = await this.fileReader.fileExists(this.wisdomFilePath);
    if (!exists) {
      return new WisdomStore();
    }

    try {
      const json = await this.fileReader.readFile(this.wisdomFilePath);
      return WisdomStore.deserialize(json);
    } catch {
      // Fail-open: return empty store on I/O or parse errors
      return new WisdomStore();
    }
  }

  /**
   * Persists the current WisdomStore to the wisdom JSON file.
   */
  async save(store: WisdomStore): Promise<void> {
    const json = store.serialize();
    await this.fileWriter.writeFile(this.wisdomFilePath, json);
  }

  /**
   * Strictly loads WisdomStore. Throws if the file exists but cannot be read or parsed.
   * Returns empty store only if file is not found (ENOENT).
   */
  private async loadStrict(): Promise<WisdomStore> {
    let json: string;
    try {
      json = await this.fileReader.readFile(this.wisdomFilePath);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.AbortedError).code === "ENOENT") {
        return new WisdomStore();
      }
      throw err instanceof Error ? err : new Error(String(err), { cause: err });
    }

    if (!json || json.trim() === "") {
      return new WisdomStore();
    }

    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch (err) {
      throw new Error(`Failed to parse wisdom file: ${this.wisdomFilePath}`, { cause: err });
    }

    const store = WisdomStore.deserialize(data);
    // Strict validation: if the file exists and is parsed but contains no valid entries
    // where we expected a store structure, it might be corrupted.
    // deserialize() returns an empty store on invalid entries, so we check if the
    // input data was at least an object with an entries array if it wasn't empty.
    if (data && typeof data === "object" && !("entries" in data)) {
      throw new Error(`Invalid wisdom file format (missing entries): ${this.wisdomFilePath}`);
    }

    return store;
  }

  /**
   * Atomically persists the WisdomStore: loads current on-disk state, merges
   * in-memory entries (newer timestamp wins for duplicate IDs),
   * writes to a temp file, then renames over the target file.
   *
   * Uses an advisory file-based lock (.lock directory) to ensure serial RMW
   * across concurrent processes/calls. Retries if the lock is held.
   */
  async saveAtomic(store: WisdomStore): Promise<void> {
    const lockPath = `${this.wisdomFilePath}.lock`;
    const lockMetaPath = `${lockPath}/owner.json`;
    const lockTtlMs = 10000; // 10 seconds TTL
    const maxRetries = 5;
    const currentHost = hostname();
    let attempt = 0;
    let firstObservedAt: number | null = null;
    let lockAcquired = false;

    while (attempt < maxRetries) {
      try {
        await this.fileWriter.mkdir(lockPath, false);
        try {
          // Lock acquired, write metadata
          await this.fileWriter.writeFile(
            lockMetaPath,
            JSON.stringify({ pid: process.pid, hostname: currentHost, timestamp: Date.now() })
          );
          lockAcquired = true;
        } catch (err) {
          // Metadata writing failed — release the lock and propagate.
          // Note: deleteFile/rmdir already handle ENOENT.
          await this.fileWriter.deleteFile(lockMetaPath);
          await this.fileWriter.rmdir(lockPath);
          throw err instanceof Error ? err : new Error(String(err), { cause: err });
        }
        break; // Lock successfully acquired and metadata written
      } catch (err: unknown) {
        if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          attempt++;
          if (attempt >= maxRetries) {
            throw new Error(
              `Failed to create parent directory for lock ${lockPath} after ${maxRetries} attempts`,
              { cause: err }
            );
          }
          await this.fileWriter.mkdir(dirname(lockPath), true);
          continue; // Retry immediately
        } else if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EEXIST") {
          if (firstObservedAt === null) firstObservedAt = Date.now();
          // Check for stale lock
          let shouldClear = false;
          try {
            const metaJson = await this.fileReader.readFile(lockMetaPath);
            const meta = JSON.parse(metaJson);
            const isStale = Date.now() - meta.timestamp > lockTtlMs;
            
            if (meta.hostname === currentHost && meta.pid) {
              // On the same host: only treat as stale if the process is actually dead.
              // This protects long-running writers from being preempted by TTL.
              try {
                process.kill(meta.pid, 0);
                // Process is still alive, lock is NOT stale regardless of TTL.
                shouldClear = false;
              } catch {
                // Process is dead, lock is stale.
                shouldClear = true;
              }
            } else {
              // On a different host: rely solely on TTL.
              if (isStale) {
                shouldClear = true;
              }
            }
          } catch {
            // Meta file might not exist yet (race condition) or invalid.
            // Treat as stale only if the lock has been observed for longer than TTL.
            if (Date.now() - firstObservedAt > lockTtlMs) {
              shouldClear = true;
            }
          }

          if (shouldClear) {
            // Clear the lock. Note: deleteFile/rmdir already handle ENOENT.
            await this.fileWriter.deleteFile(lockMetaPath);
            await this.fileWriter.rmdir(lockPath);
            firstObservedAt = null; // Reset observation for the next lock
            attempt++;
            if (attempt >= maxRetries) {
              throw new Error(
                `Failed to acquire lock for ${this.wisdomFilePath} after clearing stale locks ${maxRetries} times`,
                { cause: err }
              );
            }
            continue; // Retry immediately
          }

          attempt++;
          if (attempt >= maxRetries) {
            throw new Error(
              `Failed to acquire lock for ${this.wisdomFilePath} after ${maxRetries} attempts`,
              { cause: err },
            );
          }
          // Exponential backoff: 50ms, 100ms, 200ms, 400ms...
          await new Promise((resolve) => setTimeout(resolve, 25 * Math.pow(2, attempt)));
        } else {
          throw err instanceof Error ? err : new Error(String(err), { cause: err });
        }
      }
    }

    if (!lockAcquired) {
      throw new Error(`Failed to acquire lock for ${this.wisdomFilePath} after ${maxRetries} attempts`);
    }

    let primaryError: unknown = null;
    try {
      const currentOnDisk = await this.loadStrict();
      const merged = this.mergeById(currentOnDisk.getAllEntries(), store.getAllEntries());

      const finalStore = WisdomStore.fromEntries(merged, store.getMaxEntries());
      const json = finalStore.serialize();

      const tmpPath = `${this.wisdomFilePath}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
      try {
        await this.fileWriter.writeFile(tmpPath, json);
        await this.fileWriter.rename(tmpPath, this.wisdomFilePath);
      } catch (err) {
        try {
          await this.fileWriter.deleteFile(tmpPath);
        } catch {
          // Swallow cleanup errors — the original error is the real cause.
        }
        throw err instanceof Error ? err : new Error(String(err), { cause: err });
      }
    } catch (err) {
      primaryError = err;
    } finally {
      // Cleanup. Note: NodeFileSystem methods already ignore ENOENT.
      try {
        await this.fileWriter.deleteFile(lockMetaPath);
      } catch (err) {
        if (primaryError === null) primaryError = err;
      }
      try {
        await this.fileWriter.rmdir(lockPath);
      } catch (err) {
        if (primaryError === null) primaryError = err;
      }
    }

    if (primaryError) {
      throw primaryError instanceof Error ? primaryError : new Error(String(primaryError), { cause: primaryError });
    }
  }

  private mergeById(
    diskEntries: readonly WisdomEntry[],
    memoryEntries: readonly WisdomEntry[],
  ): WisdomEntry[] {
    const byId = new Map<string, WisdomEntry>();
    
    const getTs = (e: WisdomEntry): number => {
      const ts = Date.parse(e.timestamp);
      return isNaN(ts) ? 0 : ts;
    };

    // Fold disk and memory entries by the same rules
    for (const e of diskEntries) {
      const existing = byId.get(e.id);
      if (!existing || getTs(e) > getTs(existing)) {
        byId.set(e.id, e);
      }
    }

    for (const e of memoryEntries) {
      const existing = byId.get(e.id);
      if (!existing || getTs(e) > getTs(existing)) {
        byId.set(e.id, e);
      }
    }
    return [...byId.values()].sort((a, b) => {
      const tsA = getTs(a);
      const tsB = getTs(b);
      return tsA < tsB ? -1 : tsA > tsB ? 1 : 0;
    });
  }
}
