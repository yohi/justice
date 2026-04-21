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
   * Strictly loads WisdomStore. Throws if the file exists but cannot be read or parsed.
   * Returns empty store only if file is not found (ENOENT).
   */
  private async loadStrict(): Promise<WisdomStore> {
    let json: string;
    try {
      json = await this.fileReader.readFile(this.wisdomFilePath);
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
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
   * Race window `load → merge → write` is intentionally unlocked; see design
   * spec §8 (lock-free design notes).
   *
   * If `rename` fails, the temp file is best-effort removed before the original
   * error is rethrown, so orphan `.tmp.*` files do not accumulate on repeated
   * failures.
   */
  async saveAtomic(store: WisdomStore): Promise<void> {
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
