import { join, basename, dirname, isAbsolute, resolve, parse, sep } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import type {
  FileReader,
  FileWriter,
  HookEvent,
  PreToolUseEvent,
  HookResponse,
  EventEvent,
  CompactionPayload,
} from "./types";
import { isLegacyMessagePayload } from "./types";
import { mergePostToolUseResponses, mergePreToolUseResponses } from "./hook-response-merger";
import { PlanBridge } from "../hooks/plan-bridge";
import { TaskFeedbackHandler } from "../hooks/task-feedback";
import { CompactionProtector } from "../hooks/compaction-protector";
import { LoopDetectionHandler } from "../hooks/loop-handler";
import { ObservationHandler } from "../hooks/observation-handler";
import { TaskSplitter } from "../core/task-splitter";
import { WisdomStore } from "./wisdom-store";
import { SessionStateProvider } from "./session-state-provider";
import { WisdomPersistence } from "./wisdom-persistence";
import { TieredWisdomStore } from "./tiered-wisdom-store";
import { SecretPatternDetector } from "./secret-pattern-detector";
import type { JusticeNotifier } from "./justice-notifier";
import { NodeFileSystem } from "../runtime/node-file-system";
import { ObservationLogStore } from "../runtime/observation-log-store";
import { FileGateLoader } from "../runtime/gate-loader";
import { StateProjectionCache } from "../runtime/state-projection-cache";
import { resolveTaskIdFromModifiedPayload, resolveTaskIdFromToolInput } from "./task-packager";
import type { ObservationMessagePayload } from "./v2/message-payload";

const PROCEED: HookResponse = { action: "proceed" };

function openSessionTaskWindow(
  provider: SessionStateProvider,
  event: PreToolUseEvent,
): void {
  const callId = event.callId;
  if (!callId) return;
  // Reuse the same strict "task-" prefixed extraction PlanBridge/TaskPackager
  // rely on (D74) so this earliest window-set can never admit a value the
  // stricter downstream checks would reject.
  const taskId = resolveTaskIdFromToolInput(event.payload.toolInput);
  if (!taskId) return;
  try {
    provider.setActiveTaskWindow(callId, taskId, event.sessionId);
  } catch {
    // Fail-open: a task-window tracking failure must not break the hook flow.
  }
}

function closeSessionTaskWindow(provider: SessionStateProvider, callId: string | undefined): void {
  if (!callId) return;
  try {
    provider.closeActiveTaskWindow(callId);
  } catch {
    // Fail-open: a task-window tracking failure must not break the hook flow.
  }
}

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
  const { root } = parse(normalized);

  // Root path is always sensitive
  if (normalized === root) return true;

  if (process.platform === "win32") {
    const lower = normalized.toLowerCase();
    const sensitivePrefixes = [
      "c:\\windows",
      "c:\\program files",
      "c:\\program files (x86)",
      "c:\\users\\administrator",
      "c:\\programdata",
    ];
    return sensitivePrefixes.some(
      (prefix) => lower === prefix || lower.startsWith(`${prefix}${sep}`),
    );
  }

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

      if (isSensitivePath(absolutePath)) {
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

    // eslint-disable-next-line security/detect-non-literal-fs-filename
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
  private readonly maxEntries: number;

  constructor(maxEntries = 100) {
    const noopReader: FileReader = {
      async readFile(): Promise<string> {
        return "{}";
      },
      async fileExists(): Promise<boolean> {
        return false;
      },
      async listFiles(): Promise<readonly string[]> {
        return [];
      },
      async readFileStats(): Promise<null> {
        return null;
      },
    };
    const noopWriter: FileWriter = {
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
    };
    super(noopReader, noopWriter, "wisdom.json");
    this.maxEntries = maxEntries;
  }

  override async load(): Promise<WisdomStore> {
    return new WisdomStore(this.maxEntries);
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
  readonly notifier?: JusticeNotifier;
  readonly workspaceRoot?: string;
  readonly globalFileSystem?: {
    readonly fs: FileReader & FileWriter;
    readonly relativePath: string;
    readonly absolutePath?: string;
  };
  /**
   * Bootstrapped writer ID for Observation Log shards (D55/D39).
   * Used by ObservationHandler to identify the writer of observation log shards.
   * Defaults to "w-local" when not specified.
   */
  readonly writerId?: string;
}

export class JusticePlugin {
  private readonly fileReader: FileReader;
  private readonly planBridge: PlanBridge;
  private readonly taskFeedback: TaskFeedbackHandler;
  private readonly compactionProtector: CompactionProtector;
  private readonly loopHandler: LoopDetectionHandler;
  private readonly observationHandler: ObservationHandler;
  private readonly sessionStateProvider: SessionStateProvider;
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
      : new NoOpPersistence(500);

    const globalDisplayPath = options.globalFileSystem?.absolutePath || "~/.justice/wisdom.json";

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
    this.loopHandler = new LoopDetectionHandler(fileReader, fileWriter, new TaskSplitter());
    this.planBridge = new PlanBridge(
      fileReader,
      this.loopHandler,
      this.tieredWisdomStore,
      options.notifier,
    );

    this.sessionStateProvider = new SessionStateProvider();
    this.taskFeedback = new TaskFeedbackHandler(fileReader, fileWriter, this.tieredWisdomStore);
    this.compactionProtector = new CompactionProtector(this.tieredWisdomStore);
    const writerId = options.writerId ?? "w-local";
    this.observationHandler = new ObservationHandler({
      logStore: new ObservationLogStore(fileWriter, fileReader, writerId),
      sessionStateProvider: this.sessionStateProvider,
      projectionCache: new StateProjectionCache(fileWriter, fileReader, ".justice/state.json", options.logger ?? console),
      writerId,
      workspaceRoot: options.workspaceRoot,
      logger: options.logger,
      gateLoader: new FileGateLoader(fileReader, undefined, options.logger ?? console),
    });

    // Ensure session cleanup propagates from loopHandler to all stateful handlers
    this.loopHandler.setSessionRemovedCallback((sessionId) => {
      this.planBridge.destroySession(sessionId);
      this.sessionStateProvider.removeSession(sessionId);
      this.observationHandler.destroySession(sessionId);
    });

    this.taskFeedback.setObservationHandler(this.observationHandler);
    this.loopHandler.setObservationHandler(this.observationHandler);
  }

  /**
   * Initializes the plugin by loading wisdom from persistence.
   * This should be called before handling events.
   */
  async initialize(): Promise<void> {
    try {
      await this.tieredWisdomStore.loadAll();
      await this.observationHandler.initializeProjectionCache();
      try {
        await this.options.notifier?.notify({
          level: "info",
          variant: "atlas_orchestration",
          title: "Justice initialized",
          message: "OpenCode adapter initialization complete.",
        });
      } catch {
        /* Ignore notification errors to preserve fail-open behavior */
      }
    } catch (error) {
      try {
        this.options.logger?.warn(`Failed to load wisdom during initialization: ${error}`);
      } catch {
        /* Ignore logging errors to preserve fail-open behavior */
      }
    }
  }

  /**
   * Route a HookEvent to the appropriate handler(s).
   */
  async handleEvent(event: HookEvent): Promise<HookResponse> {
    switch (event.type) {
      case "Message": {
        // User/assistant payloads drive plan-bridge delegation; observation-kind
        // payloads (Task 3.2 widening) feed the observation pipeline. The
        // observation branch is fail-open: any error degrades to PROCEED.
        const { payload } = event;
        if (isLegacyMessagePayload(payload)) {
          return this.planBridge.handleMessage(event);
        }
        return await this.observationHandler
          .handleMessage(event.sessionId, payload as ObservationMessagePayload)
          .catch((err) => {
            this.options.logger?.warn("observation-handler message failed", err);
            return PROCEED;
          });
      }
      case "PreToolUse": {
        // Open the callId-keyed task window before delegation logic runs. The
        // window is closed in the matching PostToolUse case regardless of success.
        openSessionTaskWindow(this.sessionStateProvider, event);
        // The observation handler runs for EVERY tool; only the task tool also
        // drives plan-bridge delegation. Run independent handlers in parallel.
        const [observation, planBridge] = await Promise.all([
          this.observationHandler.handlePreToolUse(event).catch((err: unknown) => {
            this.options.logger?.warn("observation-handler pre-tool-use failed", err);
            return PROCEED;
          }),
          event.payload.toolName === "task"
            ? this.planBridge.handlePreToolUse(event)
            : Promise.resolve(PROCEED),
        ]);
        const response = mergePreToolUseResponses(
          observation,
          planBridge,
          (message) => this.warnMergeConflict(message),
        );
        const taskId = resolveTaskIdFromModifiedPayload(
          response.action === "inject" ? response.modifiedPayload : undefined,
        );
        if (event.callId !== undefined && taskId !== undefined) {
          try {
            this.sessionStateProvider.setActiveTaskWindow(event.callId, taskId, event.sessionId);
          } catch (err) {
            this.options.logger?.warn("failed to set active task window", err);
          }
        }
        return response;
      }
      case "PostToolUse": {
        try {
          // Keep the window open while observation associates the tool result with its task.
          const [observation, planBridge, taskFeedback] = await Promise.all([
            this.observationHandler.handlePostToolUse(event).catch((err: unknown) => {
              this.options.logger?.warn("observation-handler post-tool-use failed", err);
              return PROCEED;
            }),
            event.payload.toolName === "task"
              ? this.planBridge.handlePostToolUse(event).catch((err) => {
                  this.options.logger?.warn("plan-bridge post-tool-use failed", err);
                  return PROCEED;
                })
              : Promise.resolve(PROCEED),
            event.payload.toolName === "task"
              ? this.taskFeedback.handlePostToolUse(event).catch((err) => {
                  this.options.logger?.warn("task-feedback post-tool-use failed", err);
                  return PROCEED;
                })
              : Promise.resolve(PROCEED),
          ]);
          return mergePostToolUseResponses(
            [observation, planBridge, taskFeedback],
            (message) => this.warnMergeConflict(message),
          );
        } finally {
          closeSessionTaskWindow(this.sessionStateProvider, event.callId);
        }
      }

      case "Event":
        return this.handleEventType(event);
      case "AgentMapped": {
        // Full agent-name → persona mapping is implemented in Task 3.4.
        const { sessionId, agentName } = event.payload;
        this.sessionStateProvider.setAgentMapping(sessionId, agentName);
        return PROCEED;
      }
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
  getWisdomStore(): WisdomStore {
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
   * Get the ObservationHandler instance (routes observation tool/message events).
   */
  getObservationHandler(): ObservationHandler {
    return this.observationHandler;
  }

  /**
   * Get the SessionStateProvider instance (sessionId → AgentId + callId task windows).
   */
  getSessionStateProvider(): SessionStateProvider {
    return this.sessionStateProvider;
  }

  /**
   * Route Event-type events based on eventType payload.
   */
  private async handleEventType(event: EventEvent): Promise<HookResponse> {
    switch (event.payload.eventType) {
      case "session_error": {
        await this.observationHandler.handleSessionError({
          message: typeof event.payload.message === "string" ? event.payload.message : "",
          kind: typeof event.payload.kind === "string" ? event.payload.kind : undefined,
          agentId: this.sessionStateProvider.getAgentId(event.sessionId),
          sessionId: event.sessionId,
        }).catch(() => {
          // Fail-open: the adapter already logs dispatch failures; swallow here
          // so a degraded observation store never floods the log channel.
        });
        return PROCEED;
      }

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

  private warnMergeConflict(message: string): void {
    try {
      this.options.logger?.warn(message);
    } catch {
      return;
    }
  }
}
