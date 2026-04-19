import { randomBytes } from "node:crypto";
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
   * Atomically persists the WisdomStore: loads current on-disk state, merges
   * in-memory entries (newer timestamp wins for duplicate IDs),
   * writes to a temp file, then renames over the target file.
   *
   * Uses an advisory file-based lock (.lock directory) to ensure serial RMW
   * across concurrent processes/calls. Retries if the lock is held.
   */
  async saveAtomic(store: WisdomStore): Promise<void> {
    const lockPath = `${this.wisdomFilePath}.lock`;
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await this.fileWriter.mkdir(lockPath, false);
        break; // Lock acquired
      } catch (err: unknown) {
        attempt++;
        if (attempt >= maxRetries) {
          throw new Error(
            `Failed to acquire lock for ${this.wisdomFilePath} after ${maxRetries} attempts`,
            { cause: err },
          );
        }
        // Exponential backoff: 50ms, 100ms, 200ms, 400ms...
        await new Promise((resolve) => setTimeout(resolve, 25 * Math.pow(2, attempt)));
      }
    }

    try {
      const currentOnDisk = await this.load();
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
        throw err;
      }
    } finally {
      await this.fileWriter.rmdir(lockPath);
    }
  }

  private mergeById(
    diskEntries: readonly WisdomEntry[],
    memoryEntries: readonly WisdomEntry[],
  ): WisdomEntry[] {
    const byId = new Map<string, WisdomEntry>();
    for (const e of diskEntries) byId.set(e.id, e);
    for (const e of memoryEntries) {
      const existing = byId.get(e.id);
      if (!existing || e.timestamp > existing.timestamp) {
        byId.set(e.id, e);
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
    );
  }
}
