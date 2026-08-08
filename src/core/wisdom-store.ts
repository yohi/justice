import type {
  AgentId,
  AddOptions,
  ErrorClass,
  WisdomEntry,
  WisdomEntryInput,
  WisdomStoreInterface,
} from "./types";

import { PersonaClassifier } from "./persona-classifier";
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

const AGENT_ORDER: readonly AgentId[] = ["hephaestus", "sisyphus", "prometheus", "atlas"];

export class WisdomStore implements WisdomStoreInterface {
  private entriesByAgent: Map<AgentId, WisdomEntry[]> = new Map();
  private entryOrder: WisdomEntry[] = [];
  private _maxEntries = 0;
  private evictionListener?: (evicted: WisdomEntry) => void;

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
  add(entry: WisdomEntryInput, options?: AddOptions): WisdomEntry {
    const persona = options?.persona ?? entry.persona ?? PersonaClassifier.classify(entry);
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
  getByTaskId(taskId: string): readonly WisdomEntry[] {
    return this.entryOrder.filter((entry) => entry.taskId === taskId);
  }

  /**
   * Retrieves relevant entries based on optional filtering criteria.
   * Limits results to `maxEntries` (default: 10), returning the most recent first.
   */
  getRelevant(options?: {
    errorClass?: ErrorClass;
    maxEntries?: number;
    persona?: AgentId;
  }): readonly WisdomEntry[] {
    const limit = options?.maxEntries ?? 10;
    let results = options?.persona
      ? this.getEntriesForPersona(options.persona)
      : this.getOrderedEntries();

    if (options?.persona && results.length === 0) {
      results = this.getOrderedEntries();
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
  formatForInjection(entries: readonly WisdomEntry[]): string {
    if (entries.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("**[JUSTICE AI: Past Learnings & Gotchas]**");
    lines.push(...WisdomStore.formatEntriesBody(entries));
    return lines.join("\n");
  }

  /**
   * Formats a list of wisdom entries into Markdown lines without any header.
   * This is a pure function that does not depend on store state.
   */
  static formatEntriesBody(entries: readonly WisdomEntry[]): string[] {
    const lines: string[] = [];

    for (const entry of entries) {
      let typeLabel: string;
      if (entry.category === "success_pattern") {
        typeLabel = "🟢 Success Pattern";
      } else if (entry.category === "design_decision") {
        typeLabel = "🔵 Design Decision";
      } else if (entry.category === "environment_quirk") {
        typeLabel = "🟡 Environment Quirk";
      } else {
        typeLabel = "🔴 Failure/Gotcha";
      }

      const errClassStr = entry.errorClass ? ` (${entry.errorClass})` : "";

      lines.push(`- **${typeLabel}** \`[${entry.taskId}]\`${errClassStr}:`);

      const contentLines = entry.content.split("\n");
      for (const line of contentLines) {
        lines.push(`  ${line}`);
      }
    }

    return lines;
  }

  /**
   * Serializes the current store state to a JSON string.
   */
  serialize(): string {
    const data: WisdomStoreDataV2 = {
      version: 2,
      entriesByAgent: Object.fromEntries(
        AGENT_ORDER.map((persona) => [persona, this.getEntriesForPersona(persona)]),
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
      const filtered = data.entries.filter((e): e is StoredWisdomEntry =>
        WisdomStore.isValidStoredEntry(e),
      );
      store.replaceEntries(filtered.map((entry) => WisdomStore.withDefaultPersona(entry)));
    } else if (
      data.version === 2 &&
      data.entriesByAgent &&
      typeof data.entriesByAgent === "object"
    ) {
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
      // Sort by timestamp to restore global insertion order from buckets
      flattened.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      store.replaceEntries(flattened);
    }

    return store;
  }

  /**
   * Returns a readonly snapshot of all entries in insertion order.
   */
  getAllEntries(): readonly WisdomEntry[] {
    return this.getOrderedEntries();
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

  onEvict(listener: (evicted: WisdomEntry) => void): void {
    this.evictionListener = listener;
  }

  updateMetrics(
    entryId: string,
    mutator: (entry: WisdomEntry) => WisdomEntry,
  ): WisdomEntry | undefined {
    const index = this.entryOrder.findIndex((entry) => entry.id === entryId);
    const current = this.entryOrder[index];
    if (index < 0 || current === undefined) return undefined;
    const updated = mutator(current);
    this.rebuildFromOrderedEntries(
      this.entryOrder.map((entry, entryIndex) => (entryIndex === index ? updated : entry)),
    );
    return updated;
  }

  /**
   * Replaces all entries in the store with the provided list.
   * This allows updating the store's state without replacing the instance itself,
   * ensuring that other components holding references to this store see the updates.
   */
  replaceEntries(entries: readonly WisdomEntry[]): void {
    this.entriesByAgent = new Map();
    this.entryOrder = [];

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

    const validEntries = entries.map((e) => WisdomStore.withDefaultPersona(e as StoredWisdomEntry));

    store.replaceEntries(validEntries);
    return store;
  }

  public static isValidEntry(e: unknown): e is WisdomEntry {
    return (
      typeof e === "object" &&
      e !== null &&
      typeof (e as WisdomEntry).id === "string" &&
      typeof (e as WisdomEntry).taskId === "string" &&
      WisdomStore.isAgentId((e as WisdomEntry).persona) &&
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
      ((e as StoredWisdomEntry).persona === undefined ||
        WisdomStore.isAgentId((e as StoredWisdomEntry).persona)) &&
      typeof (e as StoredWisdomEntry).timestamp === "string"
    );
  }

  private static isAgentId(value: unknown): value is AgentId {
    return (
      value === "hephaestus" || value === "sisyphus" || value === "prometheus" || value === "atlas"
    );
  }

  private static withDefaultPersona(entry: StoredWisdomEntry): WisdomEntry {
    return {
      ...entry,
      persona: entry.persona ?? PersonaClassifier.classify(entry),
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

  private appendEntry(entry: WisdomEntry): void {
    const existingEntries = this.entriesByAgent.get(entry.persona);
    if (existingEntries) {
      existingEntries.push(entry);
    } else {
      this.entriesByAgent.set(entry.persona, [entry]);
    }
    this.entryOrder.push(entry);
  }

  private trimToCapacity(): void {
    if (this._maxEntries <= 0) {
      for (const entry of this.entryOrder) this.evictionListener?.(entry);
      this.entriesByAgent = new Map();
      this.entryOrder = [];
      return;
    }

    if (this.entryOrder.length > this._maxEntries) {
      const evicted = this.entryOrder.slice(0, this.entryOrder.length - this._maxEntries);
      for (const entry of evicted) this.evictionListener?.(entry);
      this.rebuildFromOrderedEntries(this.entryOrder.slice(-this._maxEntries));
    }
  }

  private getEntriesForPersona(persona: AgentId): WisdomEntry[] {
    return [...(this.entriesByAgent.get(persona) ?? [])];
  }

  private getOrderedEntries(): WisdomEntry[] {
    return [...this.entryOrder];
  }

  private rebuildFromOrderedEntries(entries: readonly WisdomEntry[]): void {
    const nextEntriesByAgent = new Map<AgentId, WisdomEntry[]>();
    for (const persona of AGENT_ORDER) {
      nextEntriesByAgent.set(persona, []);
    }

    const orderedEntries: WisdomEntry[] = [];
    for (const entry of entries) {
      const existingEntries = nextEntriesByAgent.get(entry.persona);
      if (existingEntries) {
        existingEntries.push(entry);
      } else {
        nextEntriesByAgent.set(entry.persona, [entry]);
      }
      orderedEntries.push(entry);
    }

    this.entriesByAgent = nextEntriesByAgent;
    this.entryOrder = orderedEntries;
  }
}
