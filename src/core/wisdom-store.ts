import type { WisdomEntry, ErrorClass, WisdomStoreInterface } from "./types";

interface WisdomStoreData {
  entries: WisdomEntry[];
  maxEntries: number;
}

export class WisdomStore implements WisdomStoreInterface {
  private entries: WisdomEntry[] = [];
  private _maxEntries = 0;

  constructor(maxEntries = 100) {
    this.setMaxEntries(maxEntries);
  }


  /**
   * Returns the configured maximum entry capacity.
   */
  public get maxEntries(): number {
    return this._maxEntries;
  }

  /**
   * Adds a new learning entry to the store.
   * Auto-generates ID and timestamp. Evicts oldest entries if exceeding maxEntries.
   */
  add(entry: Omit<WisdomEntry, "id" | "timestamp">): WisdomEntry {
    const newEntry: WisdomEntry = {
      id: "w-" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.entries.push(newEntry);

    // Evict oldest if exceeding capacity
    if (this.entries.length > this._maxEntries) {
      this.entries.shift(); // Remove the first (oldest) entry
    }

    return newEntry;
  }

  /**
   * Retrieves all entries associated with a specific task ID.
   */
  getByTaskId(taskId: string): WisdomEntry[] {
    return this.entries.filter((entry) => entry.taskId === taskId);
  }

  /**
   * Retrieves relevant entries based on optional filtering criteria.
   * Limits results to `maxEntries` (default: 10), returning the most recent first.
   */
  getRelevant(options?: { errorClass?: ErrorClass; maxEntries?: number }): WisdomEntry[] {
    let results = this.entries;

    if (options?.errorClass) {
      results = results.filter((entry) => entry.errorClass === options.errorClass);
    }

    // Return the most recent entries up to maxEntries
    const limit = options?.maxEntries ?? 10;
    return results.slice(Math.max(0, results.length - limit)); // slice from the end to get the most recent
  }

  /**
   * Formats a list of wisdom entries into a Markdown string for injection
   * into a prompt's PREVIOUS LEARNINGS section.
   */
  formatForInjection(entries: WisdomEntry[]): string {
    if (entries.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("**[JUSTICE AI: Past Learnings & Gotchas]**");

    for (const entry of entries) {
      const typeLabel =
        entry.category === "success_pattern"
          ? "🟢 Success Pattern"
          : entry.category === "design_decision"
            ? "🔵 Design Decision"
            : entry.category === "environment_quirk"
              ? "🟡 Environment Quirk"
              : "🔴 Failure/Gotcha";

      const errClassStr = entry.errorClass ? ` (${entry.errorClass})` : "";

      lines.push(`- **${typeLabel}** \`[${entry.taskId}]\`${errClassStr}:`);

      // Indent the content
      const contentLines = entry.content.split("\n");
      for (const line of contentLines) {
        lines.push(`  ${line}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Serializes the current store state to a JSON string.
   */
  serialize(): string {
    const data: WisdomStoreData = {
      entries: this.entries,
      maxEntries: this._maxEntries,
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Deserializes a JSON string or already parsed data back into a WisdomStore instance.
   * Handles empty or invalid inputs gracefully.
   */
  static deserialize(input: string | unknown): WisdomStore {
    let data: Partial<WisdomStoreData> = {};

    if (typeof input === "string") {
      try {
        if (input.trim() !== "") {
          data = JSON.parse(input) as Partial<WisdomStoreData>;
        }
      } catch {
        // Return empty store on parse failure
      }
    } else if (typeof input === "object" && input !== null) {
      data = input as Partial<WisdomStoreData>;
    }

    const maxEntries = data.maxEntries ?? 100;
    const store = new WisdomStore(maxEntries);

    if (data.entries && Array.isArray(data.entries)) {
      const filtered = data.entries.filter((e) => WisdomStore.isValidEntry(e));
      store.replaceEntries(filtered);
    }

    return store;
  }

  /**
   * Returns a readonly snapshot of all entries in insertion order.
   */
  getAllEntries(): readonly WisdomEntry[] {
    return [...this.entries];
  }

  /**
   * Returns the configured maximum entry capacity.
   */
  getMaxEntries(): number {
    return this._maxEntries;
  }

  /**
   * Updates the maximum entry capacity. If the current number of entries
   * exceeds the new limit, the oldest entries are evicted.
   */
  setMaxEntries(maxEntries: number): void {
    if (typeof maxEntries !== "number" || !Number.isFinite(maxEntries) || maxEntries < 0) {
      this._maxEntries = 0;
    } else {
      this._maxEntries = Math.floor(maxEntries);
    }
    this.entries = this.entries.slice(Math.max(0, this.entries.length - this._maxEntries));
  }

  /**
   * Replaces all entries in the store with the provided list.
   * This allows updating the store's state without replacing the instance itself,
   * ensuring that other components holding references to this store see the updates.
   */
  replaceEntries(entries: readonly WisdomEntry[]): void {
    if (this._maxEntries <= 0) {
      this.entries = [];
      return;
    }
    this.entries = entries.slice(-this._maxEntries);
  }

  /**
   * Constructs a store from a list of entries, keeping the latest `maxEntries`.
   * Order is preserved; overflow is trimmed from the front (oldest) in a single
   * pass via `slice(-maxEntries)` (O(N)).
   */
  static fromEntries(entries: readonly WisdomEntry[], maxEntries = 100): WisdomStore {
    const store = new WisdomStore(maxEntries);
    const limit = store.maxEntries;

    if (limit === 0) {
      return store;
    }

    const validEntries = entries.filter((e) => WisdomStore.isValidEntry(e));
    store.replaceEntries(validEntries);
    return store;
  }

  private static isValidEntry(e: unknown): e is WisdomEntry {
    return (
      typeof e === "object" &&
      e !== null &&
      typeof (e as WisdomEntry).id === "string" &&
      typeof (e as WisdomEntry).taskId === "string" &&
      typeof (e as WisdomEntry).category === "string" &&
      typeof (e as WisdomEntry).content === "string" &&
      typeof (e as WisdomEntry).timestamp === "string"
    );
  }
}
