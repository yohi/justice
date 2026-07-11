import { join, basename, dirname, isAbsolute, resolve, parse, sep } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import type {
  FileReader,
  FileWriter,
  HookEvent,
  PostToolUseEvent,
  PreToolUseEvent,
  HookResponse,
  InjectResponse,
  EventEvent,
  CompactionPayload,
} from "./types";
import { isLegacyMessagePayload } from "./types";
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
import type { ObservationMessagePayload } from "./v2/message-payload";

const PROCEED: HookResponse = { action: "proceed" };

export function mergePreToolUseResponses(a: HookResponse, b: HookResponse): HookResponse {
  if (a.action === "skip" || b.action === "skip") {
    return { action: "skip" };
  }

  if (a.action === "inject" && b.action === "inject") {
    const contexts = [a.injectedContext, b.injectedContext].filter((ctx) => ctx !== "");
    const base: InjectResponse = {
      action: "inject",
      injectedContext: contexts.join("\n\n---\n\n"),
    };
    const result: InjectResponse =
      a.variant === "gate_advisory" || b.variant === "gate_advisory"
        ? { ...base, variant: "gate_advisory" }
        : base;
    if (a.modifiedPayload !== undefined && b.modifiedPayload !== undefined) {
      throw new Error("Conflict detected in pre-tool-use modifiedPayload");
    }
    if (a.modifiedPayload !== undefined) {
      return { ...result, modifiedPayload: a.modifiedPayload };
    }
    if (b.modifiedPayload !== undefined) {
      return { ...result, modifiedPayload: b.modifiedPayload };
    }
    return result;
  }

  if (a.action === "inject") {
    return { ...a };
  }

  if (b.action === "inject") {
    return { ...b };
  }

  return { action: "proceed" };
}

export function mergePostToolUseResponses(responses: readonly HookResponse[]): HookResponse {
  if (responses.some((r) => r.action === "skip")) {
    return { action: "skip" };
  }

  const injects = responses.filter((r): r is InjectResponse => r.action === "inject");
  if (injects.length === 0) {
    return { action: "proceed" };
  }

  const contexts = injects.map((i) => i.injectedContext).filter((ctx) => ctx !== "");
  const base: InjectResponse = {
    action: "inject",
    injectedContext: contexts.join("\n\n---\n\n"),
  };
  const result: InjectResponse = injects.some((i) => i.variant === "gate_advisory")
    ? { ...base, variant: "gate_advisory" }
    : base;

  const modifieds = injects.filter((i) => i.modifiedPayload !== undefined);
  if (modifieds.length > 1) {
    throw new Error("Conflict detected in post-tool-use modifiedPayload");
  }
  const single = modifieds[0];
  if (single !== undefined) {
    return { ...result, modifiedPayload: single.modifiedPayload };
  }
  return result;
}

function extractTaskId(toolInput: Record<string, unknown>): string | undefined {
  const raw = toolInput.taskId;
  return typeof raw === "string" ? raw : undefined;
}

function openSessionTaskWindow(
  provider: SessionStateProvider,
  event: PreToolUseEvent | PostToolUseEvent,
): void {
  const callId = event.callId;
  if (!callId) return;
  const taskId =
    event.type === "PreToolUse"
      ? extractTaskId(event.payload.toolInput)
      : extractTaskId(event.payload.toolInput ?? {});
  if (!taskId) return;
  try {
    provider.setActiveTaskWindow(callId, taskId);
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

    // Ensure session cleanup propagates from loopHandler to all stateful handlers
    this.loopHandler.setSessionRemovedCallback((sessionId) => {
      this.planBridge.destroySession(sessionId);
      this.sessionStateProvider.removeSession(sessionId);
    });

    this.sessionStateProvider = new SessionStateProvider();
    this.taskFeedback = new TaskFeedbackHandler(fileReader, fileWriter, this.tieredWisdomStore);
    this.compactionProtector = new CompactionProtector(this.tieredWisdomStore);
    const writerId = options.writerId ?? "w-local";
    this.observationHandler = new ObservationHandler({
      logStore: new ObservationLogStore(fileWriter, fileReader, writerId),
      sessionStateProvider: this.sessionStateProvider,
      writerId,
      logger: options.logger,
    });
  }

  /**
   * Initializes the plugin by loading wisdom from persistence.
   * This should be called before handling events.
   */
  async initialize(): Promise<void> {
    try {
      await this.tieredWisdomStore.loadAll();
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
        return mergePreToolUseResponses(observation, planBridge);
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
          return mergePostToolUseResponses([observation, planBridge, taskFeedback]);
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
