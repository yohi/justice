import { join, basename, dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import type {
  FileReader,
  FileWriter,
  HookEvent,
  HookResponse,
  EventEvent,
  CompactionPayload,
  WisdomStoreInterface,
} from "./types";
import { PlanBridge } from "../hooks/plan-bridge";
import { TaskFeedbackHandler } from "../hooks/task-feedback";
import { CompactionProtector } from "../hooks/compaction-protector";
import { LoopDetectionHandler } from "../hooks/loop-handler";
import { TaskSplitter } from "../core/task-splitter";
import { WisdomStore } from "./wisdom-store";
import { WisdomPersistence } from "./wisdom-persistence";
import { TieredWisdomStore } from "./tiered-wisdom-store";
import { SecretPatternDetector } from "./secret-pattern-detector";
import { NodeFileSystem } from "../runtime/node-file-system";

const PROCEED: HookResponse = { action: "proceed" };

export interface CreateGlobalFsResult {
  readonly fs: FileReader & FileWriter;
  readonly relativePath: string;
  readonly absolutePath: string;
}

/**
 * Validates if a path points to a sensitive system directory.
 */
function isSensitivePath(path: string): boolean {
  const normalized = resolve(path);
  // Root path is always sensitive
  if (normalized === "/" || normalized === resolve("/")) return true;

  const sensitivePrefixes = ["/etc", "/usr", "/bin", "/sbin", "/var", "/boot", "/dev", "/root"];
  return sensitivePrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export async function createGlobalFs(
  logger?: JusticePluginOptions["logger"],
): Promise<CreateGlobalFsResult | null> {
  try {
    const envPath = process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    let globalRoot: string;
    let relativePath: string;
    let absolutePath: string;

    if (envPath !== undefined) {
      if (!envPath || !isAbsolute(envPath)) {
        logger?.warn(
          `JUSTICE_GLOBAL_WISDOM_PATH must be an absolute path; got '${envPath}'. ` +
            "Global wisdom store disabled.",
        );
        return null;
      }

      // Sanitize: resolve to remove any '..' and check
      absolutePath = resolve(envPath);
      if (absolutePath !== envPath) {
        logger?.warn(
          `JUSTICE_GLOBAL_WISDOM_PATH contained relative components and was normalized to '${absolutePath}'.`,
        );
      }

      if (absolutePath === "/" || isSensitivePath(absolutePath)) {
        logger?.warn(
          `JUSTICE_GLOBAL_WISDOM_PATH points to a sensitive system directory ('${absolutePath}'). ` +
            "Global wisdom store disabled for security.",
        );
        return null;
      }

      globalRoot = dirname(absolutePath);
      relativePath = basename(absolutePath);
    } else {
      const home = homedir();
      if (!home) {
        logger?.warn(
          "Cannot determine home directory; global wisdom store disabled. " +
            "Set JUSTICE_GLOBAL_WISDOM_PATH to enable.",
        );
        return null;
      }
      globalRoot = join(home, ".justice");
      relativePath = "wisdom.json";
      absolutePath = join(globalRoot, relativePath);
    }

    await mkdir(globalRoot, { recursive: true });
    return { fs: new NodeFileSystem(globalRoot), relativePath, absolutePath };
  } catch (error) {
    logger?.warn(
      `Failed to initialize global wisdom store: ${String(error)}; falling back to local-only.`,
    );
    return null;
  }
}

export class NoOpPersistence extends WisdomPersistence {
  constructor() {
    super(
      {
        async readFile(): Promise<string> {
          return "{}";
        },
        async fileExists(): Promise<boolean> {
          return false;
        },
      },
      {
        async writeFile(): Promise<void> {
          /* no-op */
        },
        async rename(): Promise<void> {
          /* no-op */
        },
        async deleteFile(): Promise<void> {
          /* no-op */
        },
        async mkdir(): Promise<void> {
          /* no-op */
        },
        async rmdir(): Promise<void> {
          /* no-op */
        },
      },
      "wisdom.json",
    );
  }

  override async load(): Promise<WisdomStore> {
    return new WisdomStore();
  }

  override async save(_store: WisdomStore): Promise<void> {
    /* no-op */
  }

  override async saveAtomic(_store: WisdomStore): Promise<void> {
    /* no-op */
  }
}

export interface JusticePluginOptions {
  readonly logger?: {
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
  };
  readonly onError?: (error: unknown) => void;
  readonly globalFileSystem?: {
    readonly fs: FileReader & FileWriter;
    readonly relativePath: string;
    readonly absolutePath?: string;
  };
}

export class JusticePlugin {
  private readonly fileReader: FileReader;
  private readonly planBridge: PlanBridge;
  private readonly taskFeedback: TaskFeedbackHandler;
  private readonly compactionProtector: CompactionProtector;
  private readonly loopHandler: LoopDetectionHandler;
  private readonly wisdomStore: WisdomStore;
  private readonly tieredWisdomStore: TieredWisdomStore;
  private readonly options: JusticePluginOptions;

  constructor(fileReader: FileReader, fileWriter: FileWriter, options: JusticePluginOptions = {}) {
    this.fileReader = fileReader;
    this.options = options;

    this.wisdomStore = new WisdomStore(100);
    const localPersistence = new WisdomPersistence(fileReader, fileWriter, ".justice/wisdom.json");

    const globalStore = new WisdomStore(500);
    const globalPersistence = options.globalFileSystem
      ? new WisdomPersistence(
          options.globalFileSystem.fs,
          options.globalFileSystem.fs,
          options.globalFileSystem.relativePath,
        )
      : new NoOpPersistence();

    const globalDisplayPath =
      options.globalFileSystem && options.globalFileSystem.absolutePath
        ? options.globalFileSystem.absolutePath
        : "~/.justice/wisdom.json";

    this.tieredWisdomStore = new TieredWisdomStore({
      localStore: this.wisdomStore,
      globalStore,
      localPersistence,
      globalPersistence,
      secretDetector: new SecretPatternDetector(),
      globalDisplayPath,
      logger: options.logger,
    });

    // Use tieredWisdomStore for handlers that need cross-project context
    this.planBridge = new PlanBridge(fileReader, this.tieredWisdomStore);
    this.taskFeedback = new TaskFeedbackHandler(fileReader, fileWriter, this.tieredWisdomStore);
    this.compactionProtector = new CompactionProtector(this.tieredWisdomStore);
    this.loopHandler = new LoopDetectionHandler(fileReader, fileWriter, new TaskSplitter());
  }

  /**
   * Initializes the plugin by loading wisdom from persistence.
   * This should be called before handling events.
   */
  async initialize(): Promise<void> {
    try {
      await this.tieredWisdomStore.loadAll();
    } catch (error) {
      this.options.logger?.warn(`Failed to load wisdom during initialization: ${error}`);
    }
  }

  /**
   * Route a HookEvent to the appropriate handler(s).
   */
  async handleEvent(event: HookEvent): Promise<HookResponse> {
    switch (event.type) {
      case "Message":
        return this.planBridge.handleMessage(event);
      case "PreToolUse":
        return this.planBridge.handlePreToolUse(event);
      case "PostToolUse":
        return this.taskFeedback.handlePostToolUse(event);
      case "Event":
        return this.handleEventType(event);
      default: {
        const _exhaustiveCheck: never = event;
        void _exhaustiveCheck;
        return PROCEED;
      }
    }
  }

  /**
   * Get the shared WisdomStore for persistence or inspection.
   * Preserved for backwards compatibility with existing external callers.
   */
  getWisdomStore(): WisdomStoreInterface {
    return this.wisdomStore;
  }

  /**
   * Get the TieredWisdomStore composing local + global wisdom.
   */
  getTieredWisdomStore(): TieredWisdomStore {
    return this.tieredWisdomStore;
  }

  /**
   * Get the PlanBridge instance for direct configuration (e.g., setActivePlan).
   */
  getPlanBridge(): PlanBridge {
    return this.planBridge;
  }

  /**
   * Get the TaskFeedbackHandler for direct configuration.
   */
  getTaskFeedback(): TaskFeedbackHandler {
    return this.taskFeedback;
  }

  /**
   * Get the CompactionProtector instance.
   */
  getCompactionProtector(): CompactionProtector {
    return this.compactionProtector;
  }

  /**
   * Get the TaskFeedbackHandler instance (preserved for backwards compatibility).
   * Note: This is an alias for getTaskFeedback() but using TaskFeedbackHandler return type.
   */
  getTaskFeedbackHandler(): TaskFeedbackHandler {
    return this.taskFeedback;
  }

  /**
   * Get the LoopDetectionHandler instance.
   */
  getLoopHandler(): LoopDetectionHandler {
    return this.loopHandler;
  }

  /**
   * Route Event-type events based on eventType payload.
   */
  private async handleEventType(event: EventEvent): Promise<HookResponse> {
    switch (event.payload.eventType) {
      case "loop-detector":
        return this.loopHandler.handleEvent(event);
      case "compaction": {
        const activePlan = this.planBridge.getActivePlan(event.sessionId);
        if (activePlan) {
          try {
            const planContent = await this.fileReader.readFile(activePlan);

            // Note: Since JusticePlugin doesn't directly track currentTaskId/currentStepId
            // in a strict way outside of what's passed to tools, we use placeholders or
            // extract them if they were part of the event payload.
            // For now, we provide the plan content to ensure the protector can snapshot it.
            this.compactionProtector.setActivePlan(activePlan);
            const compactionPayload = event.payload as CompactionPayload;
            const snapshot = this.compactionProtector.createSnapshot({
              planContent,
              currentTaskId: "unknown", // Ideal integration would pass these from state
              currentStepId: "unknown",
              learnings: compactionPayload.reason || "", // Provide compaction reason as context
            });

            const injectedContext = this.compactionProtector.formatForInjection(snapshot);
            return { action: "inject", injectedContext };
          } catch (error) {
            // Use provided logger or error handler if available
            // Wrap in individual try/catch to ensure we still return PROCEED
            if (this.options.logger) {
              try {
                this.options.logger.error(
                  `Failed to create compaction snapshot for ${activePlan}:`,
                  error,
                );
              } catch {
                // Ignore logger errors to avoid breaking the flow
              }
            }
            if (this.options.onError) {
              try {
                this.options.onError(error);
              } catch {
                // Ignore handler errors to avoid breaking the flow
              }
            }
          }
        } else {
          // Clear any stale state if no active plan is found
          this.compactionProtector.clearActivePlan();
        }
        return PROCEED;
      }
      default:
        return PROCEED;
    }
  }
}
