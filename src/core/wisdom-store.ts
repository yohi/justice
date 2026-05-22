import type { AgentId, ErrorClass, WisdomEntry, WisdomEntryInput, WisdomStoreInterface, WisdomScope } from "./types";

type StoredWisdomEntry = Omit<WisdomEntry, "persona"> & { readonly persona?: AgentId };

interface WisdomStoreDataV1 {
  readonly entries: readonly StoredWisdomEntry[];
  readonly maxEntries: number;
}

interface WisdomStoreDataV2 {
  readonly version: 2;
  readonly entriesByAgent: Partial<Record<AgentId, readonly WisdomEntry[]>>;
  readonly maxEntries: number;
}

const DEFAULT_PERSONA: AgentId = "hephaestus";
const AGENT_ORDER: readonly AgentId[] = ["hephaestus", "sisyphus", "prometheus", "atlas"];

export class WisdomStore implements WisdomStoreInterface {
  private readonly entriesByAgent = new Map<AgentId, WisdomEntry[]>();
  private _maxEntries = 0;

  constructor(maxEntries = 100) {
    this.resetBuckets();
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
  add(entry: WisdomEntryInput, _options?: { scope?: WisdomScope }): WisdomEntry {
    const persona = entry.persona ?? DEFAULT_PERSONA;
    const newEntry: WisdomEntry = {
      id: "w-" + Math.random().toString(36).substring(2, 9) + Date.now().toString(36),
      timestamp: new Date().toISOString(),
      ...entry,
      persona,
    };

    this.appendEntry(newEntry);
    this.trimToCapacity();

    return newEntry;
  }

  /**
   * Retrieves all entries associated with a specific task ID.
   */
  getByTaskId(taskId: string): WisdomEntry[] {
    return this.getAllEntries().filter((entry) => entry.taskId === taskId);
  }

  /**
   * Retrieves relevant entries based on optional filtering criteria.
   * Limits results to `maxEntries` (default: 10), returning the most recent first.
   */
  getRelevant(options?: { errorClass?: ErrorClass; maxEntries?: number; persona?: AgentId }): WisdomEntry[] {
    const limit = options?.maxEntries ?? 10;
    let results = options?.persona ? this.getEntriesForPersona(options.persona) : this.getAllEntries();

    if (options?.persona && results.length === 0) {
      results = this.getAllEntries();
    }

    if (options?.errorClass) {
      results = results.filter((entry) => entry.errorClass === options.errorClass);
    }

    return results.slice(Math.max(0, results.length - limit));
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
    const data: WisdomStoreDataV2 = {
      version: 2,
      entriesByAgent: Object.fromEntries(
        AGENT_ORDER.map((persona) => [persona, [...this.getEntriesForPersona(persona)]]),
      ) as Partial<Record<AgentId, readonly WisdomEntry[]>>,
      maxEntries: this._maxEntries,
    };
    return JSON.stringify(data, null, 2);
  }

  /**
   * Deserializes a JSON string or already parsed data back into a WisdomStore instance.
   * Handles empty or invalid inputs gracefully.
   */
  static deserialize(input: string | unknown): WisdomStore {
    let data: Partial<WisdomStoreDataV1 & Partial<WisdomStoreDataV2>> = {};

    if (typeof input === "string") {
      try {
        if (input.trim() !== "") {
          data = JSON.parse(input) as Partial<WisdomStoreDataV1 & Partial<WisdomStoreDataV2>>;
        }
      } catch {
        // Return empty store on parse failure
      }
    } else if (typeof input === "object" && input !== null) {
      data = input as Partial<WisdomStoreDataV1 & Partial<WisdomStoreDataV2>>;
    }

    const maxEntries = data.maxEntries ?? 100;
    const store = new WisdomStore(maxEntries);

    if (Array.isArray(data.entries)) {
      const filtered = data.entries.filter((e): e is StoredWisdomEntry => WisdomStore.isValidStoredEntry(e));
      store.replaceEntries(filtered.map((entry) => WisdomStore.withDefaultPersona(entry)));
    } else if (data.version === 2 && data.entriesByAgent && typeof data.entriesByAgent === "object") {
      const flattened: WisdomEntry[] = [];
      for (const persona of AGENT_ORDER) {
        const entries = WisdomStore.readEntriesByPersona(data.entriesByAgent, persona);
        if (!Array.isArray(entries)) {
          continue;
        }

        for (const entry of entries) {
          if (WisdomStore.isValidStoredEntry(entry)) {
            flattened.push(WisdomStore.withDefaultPersona(entry));
          }
        }
      }
      store.replaceEntries(flattened);
    }

    return store;
  }

  /**
   * Returns a readonly snapshot of all entries in insertion order.
   */
  getAllEntries(): readonly WisdomEntry[] {
    return AGENT_ORDER.flatMap((persona) => [...this.getEntriesForPersona(persona)]);
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
    this.trimToCapacity();
  }

  /**
   * Replaces all entries in the store with the provided list.
   * This allows updating the store's state without replacing the instance itself,
   * ensuring that other components holding references to this store see the updates.
   */
  replaceEntries(entries: readonly WisdomEntry[]): void {
    this.resetBuckets();
    if (this._maxEntries <= 0) {
      return;
    }

    for (const entry of entries) {
      this.appendEntry(entry);
    }
    this.trimToCapacity();
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
      typeof (e as WisdomEntry).persona === "string" &&
      typeof (e as WisdomEntry).category === "string" &&
      typeof (e as WisdomEntry).content === "string" &&
      typeof (e as WisdomEntry).timestamp === "string"
    );
  }

  private static isValidStoredEntry(e: unknown): e is StoredWisdomEntry {
    return (
      typeof e === "object" &&
      e !== null &&
      typeof (e as StoredWisdomEntry).id === "string" &&
      typeof (e as StoredWisdomEntry).taskId === "string" &&
      typeof (e as StoredWisdomEntry).category === "string" &&
      typeof (e as StoredWisdomEntry).content === "string" &&
      (typeof (e as StoredWisdomEntry).persona === "undefined" || WisdomStore.isAgentId((e as StoredWisdomEntry).persona)) &&
      typeof (e as StoredWisdomEntry).timestamp === "string"
    );
  }

  private static isAgentId(value: unknown): value is AgentId {
    return value === "hephaestus" || value === "sisyphus" || value === "prometheus" || value === "atlas";
  }

  private static withDefaultPersona(entry: StoredWisdomEntry): WisdomEntry {
    return {
      ...entry,
      persona: entry.persona ?? DEFAULT_PERSONA,
    };
  }

  private static readEntriesByPersona(
    entriesByAgent: Partial<Record<AgentId, readonly WisdomEntry[]>>,
    persona: AgentId,
  ): readonly WisdomEntry[] | undefined {
    switch (persona) {
      case "hephaestus":
        return entriesByAgent.hephaestus;
      case "sisyphus":
        return entriesByAgent.sisyphus;
      case "prometheus":
        return entriesByAgent.prometheus;
      case "atlas":
        return entriesByAgent.atlas;
    }
  }

  private resetBuckets(): void {
    this.entriesByAgent.clear();
    for (const persona of AGENT_ORDER) {
      this.entriesByAgent.set(persona, []);
    }
  }

  private getEntriesForPersona(persona: AgentId): readonly WisdomEntry[] {
    return this.entriesByAgent.get(persona) ?? [];
  }

  private appendEntry(entry: WisdomEntry): void {
    const bucket = this.entriesByAgent.get(entry.persona) ?? [];
    bucket.push(entry);
    this.entriesByAgent.set(entry.persona, bucket);
  }

  private trimToCapacity(): void {
    if (this._maxEntries <= 0) {
      this.resetBuckets();
      return;
    }

    const all = this.getAllEntries();
    if (all.length <= this._maxEntries) {
      return;
    }

    this.resetBuckets();
    for (const entry of all.slice(-this._maxEntries)) {
      this.appendEntry(entry);
    }
  }
}
