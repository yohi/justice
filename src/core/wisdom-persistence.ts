import { randomBytes } from "node:crypto";
import type { FileReader, FileWriter, WisdomEntry } from "./types";
import { WisdomStore } from "./wisdom-store";
import { AtomicPersistence, type LockMetadata, type SaveResult } from "./atomic-persistence";

/**
 * WisdomPersistence handles reading and writing WisdomStore data
 * to the filesystem. Keeps I/O concerns separate from the pure WisdomStore logic.
 */
export class WisdomPersistence {
  private readonly atomic: AtomicPersistence<WisdomStore>;

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly wisdomFilePath: string = ".justice/wisdom.json",
  ) {
    this.atomic = new AtomicPersistence(fileReader, fileWriter, {
      filePath: wisdomFilePath,
      conflictPath: `${wisdomFilePath.replace(/\.json$/u, "")}.conflict.json`,
      serialize: (store) => store.serialize(),
      deserialize: (raw) => WisdomStore.deserialize(raw),
      merge: (mine, theirs) =>
        WisdomStore.fromEntries(
          this.mergeById(theirs.getAllEntries(), mine.getAllEntries()),
          mine.getMaxEntries(),
        ),
      emptyValue: () => new WisdomStore(),
    });
  }

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
      return this.deserializePersisted(json);
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

  async loadWithLock(): Promise<{ readonly store: WisdomStore; readonly lockMeta: LockMetadata }> {
    const result = await this.atomic.loadWithLock();
    return { store: result.data, lockMeta: result.lockMeta };
  }

  async saveAtomicWithLock(
    store: WisdomStore,
    initialLockMeta?: LockMetadata,
  ): Promise<SaveResult> {
    return this.atomic.saveAtomicWithLock(store, initialLockMeta);
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
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
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

    const payload: unknown = isVersionedStoreEnvelope(data) ? data.data : data;
    const store = WisdomStore.deserialize(payload);
    // Strict validation: accept either v1 ({ entries: [] }) or v2 ({ version: 2, entriesByAgent: {} }).
    if (payload && typeof payload === "object") {
      const hasValidV1 =
        "entries" in payload && Array.isArray((payload as { entries: unknown }).entries);
      const hasValidV2 =
        "version" in payload &&
        (payload as { version?: unknown }).version === 2 &&
        "entriesByAgent" in payload &&
        typeof (payload as { entriesByAgent?: unknown }).entriesByAgent === "object" &&
        (payload as { entriesByAgent: unknown }).entriesByAgent !== null;

      if (!hasValidV1 && !hasValidV2) {
        throw new Error(
          `Invalid wisdom file format (missing valid entries or entriesByAgent): ${this.wisdomFilePath}`,
        );
      }
    } else {
      throw new Error(`Invalid wisdom file format (not an object): ${this.wisdomFilePath}`);
    }

    return store;
  }

  private deserializePersisted(json: string): WisdomStore {
    const parsed: unknown = JSON.parse(json);
    return WisdomStore.deserialize(isVersionedStoreEnvelope(parsed) ? parsed.data : parsed);
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

    const mergeEntry = (existing: WisdomEntry | undefined, incoming: WisdomEntry): WisdomEntry => {
      if (existing === undefined) return incoming;
      const base = getTs(incoming) >= getTs(existing) ? incoming : existing;
      // Cumulative semantics: the stored hitCount already reflects every hit observed so far.
      // Prefer the entry with the newest lastHitAt (ties break toward incoming's hitCount).
      const incomingLastHitAt = incoming.lastHitAt ?? "";
      const existingLastHitAt = existing.lastHitAt ?? "";
      const hitCountValue =
        incomingLastHitAt >= existingLastHitAt
          ? (incoming.hitCount ?? existing.hitCount)
          : (existing.hitCount ?? incoming.hitCount);
      const firstSeenAt = [existing.firstSeenAt, incoming.firstSeenAt]
        .filter((value): value is string => value !== undefined)
        .sort((a, b) => a.localeCompare(b))[0];
      const lastHitAt = [existing.lastHitAt, incoming.lastHitAt]
        .filter((value): value is string => value !== undefined)
        .sort((a, b) => a.localeCompare(b))
        .at(-1);
      return {
        ...base,
        ...(hitCountValue === undefined || hitCountValue === 0 ? {} : { hitCount: hitCountValue }),
        ...(firstSeenAt === undefined ? {} : { firstSeenAt }),
        ...(lastHitAt === undefined ? {} : { lastHitAt }),
      };
    };

    // Fold disk and memory entries by the same rules
    for (const e of diskEntries) {
      byId.set(e.id, mergeEntry(byId.get(e.id), e));
    }

    for (const e of memoryEntries) {
      byId.set(e.id, mergeEntry(byId.get(e.id), e));
    }
    return [...byId.values()].sort((a, b) => {
      const tsA = getTs(a);
      const tsB = getTs(b);
      if (tsA < tsB) return -1;
      if (tsA > tsB) return 1;
      return 0;
    });
  }
}

function isVersionedStoreEnvelope(
  value: unknown,
): value is { readonly version: number; readonly data: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { version?: unknown }).version === "number" &&
    "data" in value
  );
}
