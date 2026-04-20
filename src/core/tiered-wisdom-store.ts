import type { WisdomEntry, WisdomCategory } from "./types";
import { WisdomStore } from "./wisdom-store";
import { WisdomPersistence } from "./wisdom-persistence";
import { SecretPatternDetector } from "./secret-pattern-detector";

export type WisdomScope = "local" | "global";

export interface TieredWisdomStoreLogger {
  warn(message: string, ...args: unknown[]): void;
}

export interface TieredWisdomStoreOptions {
  localStore: WisdomStore;
  globalStore: WisdomStore;
  localPersistence: WisdomPersistence;
  globalPersistence: WisdomPersistence;
  secretDetector?: SecretPatternDetector;
  globalDisplayPath?: string;
  logger?: TieredWisdomStoreLogger;
}

export interface AddOptions {
  scope?: WisdomScope;
}

const HEURISTIC_SCOPES: Record<WisdomCategory, WisdomScope> = {
  environment_quirk: "global",
  success_pattern: "global",
  failure_gotcha: "local",
  design_decision: "local",
};

/**
 * Composes two independent WisdomStore instances — a project-local store and a
 * user-global store — into a single API. Writes are routed by category
 * heuristics (overridable via {scope}). Reads prefer the local store, filling
 * the remainder from global.
 */
export class TieredWisdomStore {
  private readonly localStore: WisdomStore;
  private readonly globalStore: WisdomStore;
  private readonly localPersistence: WisdomPersistence;
  private readonly globalPersistence: WisdomPersistence;
  private readonly secretDetector: SecretPatternDetector;
  private readonly globalDisplayPath: string;
  private readonly logger?: TieredWisdomStoreLogger;

  constructor(opts: TieredWisdomStoreOptions) {
    this.localStore = opts.localStore;
    this.globalStore = opts.globalStore;
    this.localPersistence = opts.localPersistence;
    this.globalPersistence = opts.globalPersistence;
    this.secretDetector = opts.secretDetector ?? new SecretPatternDetector();
    this.globalDisplayPath = opts.globalDisplayPath ?? "~/.justice/wisdom.json";
    this.logger = opts.logger;
  }

  getLocalStore(): WisdomStore {
    return this.localStore;
  }

  getGlobalStore(): WisdomStore {
    return this.globalStore;
  }

  getLocalPersistence(): WisdomPersistence {
    return this.localPersistence;
  }

  getGlobalPersistence(): WisdomPersistence {
    return this.globalPersistence;
  }

  /**
   * Adds a wisdom entry, routing to local or global by category heuristic
   * (or explicit options.scope). Global writes trigger a secret-pattern scan
   * and a warn log (non-blocking) if patterns match.
   */
  add(
    entry: Omit<WisdomEntry, "id" | "timestamp">,
    options?: AddOptions,
  ): WisdomEntry {
    const explicitScope = options?.scope;
    const heuristicScope: WisdomScope = HEURISTIC_SCOPES[entry.category];
    const targetScope = explicitScope ?? heuristicScope;

    if (targetScope === "global") {
      const detected = this.secretDetector.scan(entry.content);
      if (detected.length > 0 && this.logger) {
        this.logger.warn(
          `Wisdom entry promoted to global may contain secrets ` +
            `(patterns matched: ${detected.map((m) => m.name).join(", ")}). ` +
            `Review ${this.globalDisplayPath} and edit/redact if needed.`,
        );
      }
      return this.globalStore.add(entry);
    }
    return this.localStore.add(entry);
  }
}
