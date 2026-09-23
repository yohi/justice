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
  ReservedReviewArtifactIo,
  ReviewCorrelation,
  ReviewTaskCallBinding,
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
import { generateWriterId } from "../runtime/writer-id";
import { FileGateLoader } from "../runtime/gate-loader";
import { StateProjectionCache } from "../runtime/state-projection-cache";
import { resolveTaskIdFromModifiedPayload, resolveTaskIdFromToolInput } from "./task-packager";
import { normalizeSafeRelativePath } from "./trigger-detector";
import type { ObservationMessagePayload } from "./v2/message-payload";
import { WisdomMetrics } from "./wisdom-metrics";
import { TelemetryStore } from "./telemetry-store";
import { AtomicPersistence, type SaveResult } from "./atomic-persistence";
import { WisdomArchive, type ArchivedWisdom } from "./wisdom-archive";
import {
  project,
  projectDelegatedExecutionBindings,
  projectObservedReviewExecution,
  taskLifecycleKey,
} from "./v2/state-projection";
import type { PersistedLogRecord, TaskProgressState } from "./v2/observation-model";
import type {
  PendingReviewDispatchTransitionRecord,
  ReviewDispatchTransitionRecord,
} from "./v2/observation-model";
import {
  AuthorizationStore,
  createAuthorizationReviewBoundary,
  type AuthorizationReviewBoundary,
  type ApprovedPlanBinding,
} from "./plan-authorization";
import {
  createReviewDirectiveSink,
  createReviewDispatchState,
  type ClaimReviewDispatchOutcome,
  type ReviewDirectiveSink,
  projectReviewDispatchSlots,
  projectTaskCallBindings,
} from "./review-dispatch-state";
import { createReviewArtifactReservationPort } from "./review-artifact-reservation";
import {
  assembleReviewCompletionStaging,
  createReviewCompletionDomain,
} from "./review-artifact";
import {
  findCurrentAcceptanceDecision,
  isCurrentActiveAuthorization,
} from "./acceptance-decision";
import { PlanParser } from "./plan-parser";
import { updatePlanProgress } from "./progress-updater";

const PROCEED: HookResponse = { action: "proceed" };

function createArchive(
  fileReader: FileReader,
  fileWriter: FileWriter,
  filePath: string,
): WisdomArchive {
  const archivePath = filePath.endsWith(".json")
    ? `${filePath.slice(0, -".json".length)}-archive.json`
    : `${filePath}-archive.json`;
  return new WisdomArchive(
    new AtomicPersistence<readonly ArchivedWisdom[]>(fileReader, fileWriter, {
      filePath: archivePath,
      conflictPath: archivePath.replace(/\.json$/u, ".conflict.json"),
      serialize: (data) => JSON.stringify(data),
      deserialize: (raw) => JSON.parse(raw) as readonly ArchivedWisdom[],
      merge: (mine, theirs) => {
        const byKey = new Map<string, ArchivedWisdom>();
        for (const entry of [...theirs, ...mine])
          byKey.set(`${entry.id}:${entry.archivedAt}`, entry);
        return [...byKey.values()].sort((a, b) => a.archivedAt.localeCompare(b.archivedAt));
      },
      emptyValue: () => [],
    }),
  );
}

function openSessionTaskWindow(provider: SessionStateProvider, event: PreToolUseEvent): void {
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

function resolveMandatoryReviewCategory(
  event: PreToolUseEvent,
): "sp-review" | "sp-final-review" | undefined {
  if (event.payload.toolName !== "task") return undefined;
  const category = event.payload.toolInput.category;
  return category === "sp-review" || category === "sp-final-review" ? category : undefined;
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
      async link(): Promise<void> {},
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

  override async saveAtomicWithLock(_store: WisdomStore): Promise<SaveResult> {
    return { status: "saved", retries: 0 };
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
   * Defaults to a newly generated UUID-based writer ID when not specified.
   */
  readonly writerId?: string;
  readonly reservedReviewArtifactIo?: ReservedReviewArtifactIo;
}

export class JusticePlugin {
  private readonly fileReader: FileReader;
  private readonly fileWriter: FileWriter;
  private readonly planBridge: PlanBridge;
  private readonly taskFeedback: TaskFeedbackHandler;
  private readonly compactionProtector: CompactionProtector;
  private readonly loopHandler: LoopDetectionHandler;
  private readonly observationHandler: ObservationHandler;
  private readonly sessionStateProvider: SessionStateProvider;
  private readonly wisdomStore: WisdomStore;
  private readonly tieredWisdomStore: TieredWisdomStore;
  private readonly telemetry: TelemetryStore;
  private readonly authorizationReviewBoundary: AuthorizationReviewBoundary;
  private readonly authorizationStore: AuthorizationStore;
  private readonly writerId: string;
  private readonly observationLogStore: ObservationLogStore;
  private readonly options: JusticePluginOptions;
  private readonly reviewDirectiveSink: ReviewDirectiveSink;
  private readonly reviewDispatchState: ReturnType<typeof createReviewDispatchState>;
  private readonly reviewCompletionDomain: ReturnType<typeof createReviewCompletionDomain>;

  constructor(fileReader: FileReader, fileWriter: FileWriter, options: JusticePluginOptions = {}) {
    this.fileReader = fileReader;
    this.fileWriter = fileWriter;
    this.options = options;
    this.telemetry = new TelemetryStore(fileReader, fileWriter);
    const metrics = new WisdomMetrics();
    metrics.onHit((entryId, taskId) => this.telemetry.recordWisdomHit(entryId, taskId));
    const localArchive = createArchive(fileReader, fileWriter, ".justice/wisdom.json");

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
    const globalArchive = options.globalFileSystem
      ? createArchive(
          options.globalFileSystem.fs,
          options.globalFileSystem.fs,
          options.globalFileSystem.relativePath,
        )
      : undefined;

    const globalDisplayPath = options.globalFileSystem?.absolutePath || "~/.justice/wisdom.json";

    this.tieredWisdomStore = new TieredWisdomStore({
      localStore: this.wisdomStore,
      globalStore,
      localPersistence,
      globalPersistence,
      secretDetector: new SecretPatternDetector(),
      globalDisplayPath,
      logger: options.logger,
      metrics,
      localArchive,
      globalArchive,
    });

    // Use tieredWisdomStore for handlers that need cross-project context
    this.loopHandler = new LoopDetectionHandler(fileReader, fileWriter, new TaskSplitter());
    this.authorizationReviewBoundary = createAuthorizationReviewBoundary();
    this.authorizationStore = new AuthorizationStore(
      fileReader,
      fileWriter,
      this.authorizationReviewBoundary,
    );
    this.planBridge = new PlanBridge(
      fileReader,
      this.loopHandler,
      this.tieredWisdomStore,
      options.notifier,
      this.telemetry,
    );
    this.planBridge.setAuthorizationDependencies({
      authorizationStore: this.authorizationStore,
      authorizationReviewBoundary: this.authorizationReviewBoundary,
    });

    this.sessionStateProvider = new SessionStateProvider();
    this.taskFeedback = new TaskFeedbackHandler(
      fileReader,
      fileWriter,
      this.tieredWisdomStore,
      this.telemetry,
    );
    this.compactionProtector = new CompactionProtector(this.tieredWisdomStore);
    this.writerId = options.writerId ?? generateWriterId();
    this.observationLogStore = new ObservationLogStore(fileWriter, fileReader, this.writerId);
    this.observationHandler = new ObservationHandler({
      logStore: this.observationLogStore,
      sessionStateProvider: this.sessionStateProvider,
      projectionCache: new StateProjectionCache(
        fileWriter,
        fileReader,
        ".justice/state.json",
        options.logger ?? console,
      ),
      writerId: this.writerId,
      authorizationReviewBoundary: this.authorizationReviewBoundary,
      findAuthorizationById: async (authorizationId: string): Promise<ApprovedPlanBinding | null> => {
        try {
          return await this.authorizationStore.findByAuthorizationId(authorizationId);
        } catch {
          return null;
        }
      },
      getActiveAuthorization: async (
        parentSessionId: string,
        taskId: string,
      ): Promise<ApprovedPlanBinding | null> => {
        try {
          const bindings = await this.authorizationStore.hydrate();
          return (
            bindings.find(
              (binding) =>
                binding.status === "active" &&
                binding.sessionId === parentSessionId &&
                binding.canonicalSnapshot.tasks.some((task) => task.taskId === taskId),
            ) ?? null
          );
        } catch {
          return null;
        }
      },
      getTaskLifecycleState: async (
        parentSessionId: string,
        authorizationId: string,
        taskId: string,
      ): Promise<TaskProgressState | undefined> => {
        try {
          const events = await this.observationLogStore.readAll();
          return project(events, new Date().toISOString()).lifecycle.taskStates.get(
            taskLifecycleKey(parentSessionId, { authorizationId, taskId }),
          );
        } catch {
          return undefined;
        }
      },
      workspaceRoot: options.workspaceRoot,
      logger: options.logger,
      gateLoader: new FileGateLoader(fileReader, undefined, options.logger ?? console),
    });
    this.reviewDirectiveSink = createReviewDirectiveSink();
    const reviewArtifactReservation = createReviewArtifactReservationPort(
      fileReader,
      fileWriter,
      options.reservedReviewArtifactIo,
      (advisory, cause) => this.recordReviewDispatchAdvisory(advisory, cause),
      generateWriterId,
    );
    this.reviewDispatchState = createReviewDispatchState({
      readDurableRecords: () => this.observationLogStore.readAll(),
      readDurableAuthorizations: () => this.authorizationStore.hydrate(),
      findAuthorizationById: (authorizationId) =>
        this.authorizationStore.findByAuthorizationId(authorizationId),
      appendReviewDispatchTransition: (input) => this.appendReviewDispatchTransition(input),
      reserveReviewArtifact: reviewArtifactReservation.reserve,
      cleanupReviewArtifactReservation: async (reservation) => {
        await reviewArtifactReservation.artifactIo?.cleanup(reservation);
      },
      injectReviewRequiredDirective: (delivery) => this.reviewDirectiveSink.deliver(delivery),
      withAuthorizationReviewBoundary: this.authorizationReviewBoundary.withParentSession,
      hydrateAuthorizationsBeforeReviewRecovery: () => this.authorizationStore.hydrate(),
      recordAdvisory: (advisory, cause) => this.recordReviewDispatchAdvisory(advisory, cause),
      generateId: generateWriterId,
    });
    const appendReviewObservation = async <T extends import("./v2/observation-model").PendingObservationRecord>(
      record: T,
    ): Promise<{ readonly kind: "committed"; readonly record: T & { readonly sequence: number } } | { readonly kind: "failed" }> => {
      try {
        const sequence = await this.observationLogStore.append(
          { agentId: record.agentId, sessionId: record.sessionId, writerId: record.writerId },
          record,
        );
        return { kind: "committed", record: { ...record, sequence } };
      } catch {
        return { kind: "failed" };
      }
    };
    this.reviewCompletionDomain = createReviewCompletionDomain({
      readDurableRecords: () => this.observationLogStore.readAll(),
      findAuthorizationById: (authorizationId) => this.authorizationStore.findByAuthorizationId(authorizationId),
      appendReviewCompletionStaging: appendReviewObservation,
      appendReviewArtifactReadAttempt: appendReviewObservation,
      appendReviewArtifactFailureStaging: appendReviewObservation,
      appendReviewPostToolUsePending: appendReviewObservation,
      appendReviewObserved: appendReviewObservation,
      appendReviewArtifactCleanupRecord: appendReviewObservation,
      appendReviewDispatchTransition: (record) => this.appendReviewDispatchTransition(record),
      readAndAssembleMatchingArtifact: async (
        postToolUse,
        binding,
        delegatedBinding,
        correlation,
        observedExecution,
      ) => {
        if (this.options.reservedReviewArtifactIo === undefined) {
          return { kind: "failure", reason: "artifact_read_failed" };
        }
        if (binding.artifactReservation.status !== "usable") {
          return { kind: "failure", reason: "artifact_read_failed" };
        }
        try {
          return assembleReviewCompletionStaging(
            postToolUse,
            binding,
            delegatedBinding,
            correlation,
            observedExecution,
            await this.options.reservedReviewArtifactIo.readOnce(binding.artifactReservation),
          );
        } catch {
          return { kind: "failure", reason: "artifact_read_failed" };
        }
      },
      cleanupArtifact: async (reservation) => {
        if (reviewArtifactReservation.artifactIo === undefined) return "cleanup_incomplete";
        return reviewArtifactReservation.artifactIo.cleanup(reservation);
      },
      evaluateGatePendingAttemptWithinAuthorizationReviewBoundary: (context) =>
        this.observationHandler.evaluateGatePendingAttemptWithinAuthorizationReviewBoundary(context),
      appendTaskLifecycleTransition: (input) =>
        this.observationHandler.appendTaskLifecycleTransition(input),
      appendPlanFinalizationTransition: (input) =>
        this.observationHandler.appendPlanFinalizationTransition(input),
      recordAdvisory: (advisory, cause) => this.recordReviewDispatchAdvisory(advisory, cause),
      dispatch: {
        withReviewDispatchParentSessionClaim:
          this.reviewDispatchState.withReviewDispatchParentSessionClaim,
        offerNextMandatoryReviewWithinParentSessionClaim:
          this.reviewDispatchState.offerNextMandatoryReviewWithinParentSessionClaim,
        cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim:
          this.reviewDispatchState.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
      },
    });
    this.planBridge.setReviewDispatchCancellation(
      this.reviewDispatchState.cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim,
    );
    this.observationHandler.setReviewPendingCommittedHandler((parentSessionId) =>
      this.reviewDispatchState.offerNextMandatoryReview(parentSessionId).then(() => undefined),
    );

    // Ensure session cleanup propagates from loopHandler to all stateful handlers
    this.loopHandler.setSessionRemovedCallback((sessionId) => {
      this.destroySessionState(sessionId);
    });

    this.taskFeedback.setObservationHandler(this.observationHandler);
    this.loopHandler.setObservationHandler(this.observationHandler);
    this.planBridge.setObservationHandler(this.observationHandler);
  }

  /**
   * Initializes the plugin by loading wisdom from persistence.
   * This should be called before handling events.
   */
  async initialize(): Promise<void> {
    let authorizationRecoveryReady = false;
    try {
      authorizationRecoveryReady = (await this.planBridge.restoreActivePlans()) === "authoritative";
    } catch (error) {
      try {
        this.options.logger?.warn(`Failed to restore authorization during initialization: ${error}`);
      } catch {
        /* Ignore logging errors to preserve fail-open behavior */
      }
    }

    try {
      await this.tieredWisdomStore.loadAll();
      await this.telemetry.load();
      await this.observationHandler.initializeProjectionCache();
      if (authorizationRecoveryReady) {
        await this.reviewCompletionDomain
          .recoverStagedReviewCompletionsAfterRestart()
          .catch((error: unknown) => this.warnInitializationRecoveryFailure("staged completion", error));
        await this.reviewDispatchState
          .recoverReviewDispatchesAfterRestart()
          .catch((error: unknown) => this.warnInitializationRecoveryFailure("review dispatches", error));
      }
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
        // Capture session generation before Promise.all so we can detect if the
        // session was removed while handlers were pending (race-condition guard).
        const capturedGeneration =
          event.sessionId !== undefined
            ? this.sessionStateProvider.getSessionGeneration(event.sessionId)
            : undefined;
        const reviewCategory = resolveMandatoryReviewCategory(event);
        const artifactWrite =
          reviewCategory === undefined
            ? await this.handleReviewArtifactWrite(event).catch((err: unknown) => {
                this.options.logger?.warn("review-artifact write routing failed", err);
                return PROCEED;
              })
            : undefined;
        const observation =
          reviewCategory === undefined
            ? await this.observationHandler.handlePreToolUse(event).catch((err: unknown) => {
                this.options.logger?.warn("observation-handler pre-tool-use failed", err);
                return PROCEED;
              })
            : PROCEED;
        const delegated =
          reviewCategory === undefined
            ? event.payload.toolName === "task"
              ? await this.planBridge.handlePreToolUse(event).catch((err: unknown) => {
                  this.options.logger?.warn("plan-bridge pre-tool-use failed", err);
                  return PROCEED;
                })
              : PROCEED
            : await this.claimReviewTask(event, reviewCategory);
        const response = mergePreToolUseResponses(
          mergePreToolUseResponses(observation, delegated, (message) =>
            this.warnMergeConflict(message),
          ),
          artifactWrite ?? PROCEED,
          (message) => this.warnMergeConflict(message),
        );
        const taskId = resolveTaskIdFromModifiedPayload(
          response.action === "inject" ? response.modifiedPayload : undefined,
        );
        const planPath = this.planBridge.getActivePlan(event.sessionId);
        if (event.payload.toolName === "task" && taskId !== undefined && planPath !== null) {
          this.taskFeedback.setActivePlan(event.sessionId, planPath, taskId);
        }
        if (event.callId !== undefined && taskId !== undefined) {
          try {
            // Only re-register the window if the session wasn't removed during
            // the Promise.all above (generation would be undefined if removed).
            const currentGeneration =
              event.sessionId !== undefined
                ? this.sessionStateProvider.getSessionGeneration(event.sessionId)
                : undefined;
            if (capturedGeneration !== undefined && currentGeneration === capturedGeneration) {
              this.sessionStateProvider.setActiveTaskWindow(event.callId, taskId, event.sessionId);
            }
          } catch (err) {
            this.options.logger?.warn("failed to set active task window", err);
          }
        }
        return this.mergePreToolUseWithReviewDeliveries(event.sessionId, response);
      }
      case "PostToolUse": {
        try {
          if (event.payload.toolName === "task") {
            const reviewResponse = await this.routeReviewTaskPostToolUse(event);
            if (reviewResponse !== undefined) {
              return this.mergePreToolUseWithReviewDeliveries(event.sessionId, reviewResponse);
            }
          }
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
          return mergePostToolUseResponses([observation, planBridge, taskFeedback], (message) =>
            this.warnMergeConflict(message),
          );
        } finally {
          closeSessionTaskWindow(this.sessionStateProvider, event.callId);
        }
      }

      case "DelegatedExecutionRelationObserved":
        return this.observationHandler
          .handleDelegatedExecutionRelation(event.payload)
          .then(async (response) => {
            await this.reviewCompletionDomain.recoverPendingReviewCompletionsForBinding(
              event.payload.parentSessionId,
              event.payload.parentCallId,
            );
            return response;
          })
          .catch((err: unknown) => {
            this.options.logger?.warn("observation-handler delegated relation failed", err);
            return PROCEED;
          });

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

  async destroySession(sessionId: string): Promise<void> {
    const wisdomPersistence = this.tieredWisdomStore.persistAll().catch((error: unknown) => {
      try {
        this.options.logger?.warn(
          "Justice wisdom persistence failed during session cleanup",
          error,
        );
      } catch {
        void 0;
      }
    });
    const telemetryPersistence = this.telemetry.save().catch((error: unknown) => {
      try {
        this.options.logger?.warn(
          "Justice telemetry persistence failed during session cleanup",
          error,
        );
      } catch {
        void 0;
      }
    });
    await Promise.all([wisdomPersistence, telemetryPersistence]);
    this.loopHandler.removeSession(sessionId);
  }

  /**
   * Route Event-type events based on eventType payload.
   */
  private async handleEventType(event: EventEvent): Promise<HookResponse> {
    switch (event.payload.eventType) {
      case "session_error": {
        await this.observationHandler
          .handleSessionError({
            message: typeof event.payload.message === "string" ? event.payload.message : "",
            kind: typeof event.payload.kind === "string" ? event.payload.kind : undefined,
            agentId: this.sessionStateProvider.getAgentId(event.sessionId),
            sessionId: event.sessionId,
          })
          .catch(() => {
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

  private destroySessionState(sessionId: string): void {
    const cleanupSteps: readonly (() => void)[] = [
      (): void => this.planBridge.destroySession(sessionId),
      (): void => this.taskFeedback.clearActivePlan(sessionId),
      (): void => this.sessionStateProvider.removeSession(sessionId),
      (): void => this.observationHandler.destroySession(sessionId),
    ];
    for (const cleanup of cleanupSteps) {
      try {
        cleanup();
      } catch (error) {
        try {
          this.options.logger?.warn("Justice session cleanup failed", error);
        } catch {
          // Fail-open: one cleanup failure must not retain other session state.
        }
      }
    }
  }

  private async appendReviewDispatchTransition(
    input: PendingReviewDispatchTransitionRecord,
  ): Promise<
    | { readonly kind: "committed"; readonly record: ReviewDispatchTransitionRecord }
    | { readonly kind: "failed" }
  > {
    try {
      const sequence = await this.observationLogStore.append(
        { agentId: input.agentId, sessionId: input.sessionId, writerId: input.writerId },
        input,
      );
      return { kind: "committed", record: { ...input, sequence } };
    } catch {
      return { kind: "failed" };
    }
  }

  private async recordReviewDispatchAdvisory(advisory: string, _cause?: unknown): Promise<void> {
    try {
      await this.observationLogStore.append(
        { agentId: "system", sessionId: "review-dispatch", writerId: this.writerId },
        {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId: "system",
          sessionId: "review-dispatch",
          writerId: this.writerId,
          recordType: "observation",
          kind: "session_error",
          errorKind: "review_dispatch_advisory",
          message: advisory,
        },
      );
    } catch {
      return;
    }
  }

  private async handleReviewArtifactWrite(
    event: PreToolUseEvent,
  ): Promise<HookResponse | undefined> {
    if (event.payload.toolName !== "write") return undefined;
    const input = event.payload.toolInput;
    const filePath =
      typeof input.filePath === "string" ? normalizeSafeRelativePath(input.filePath) : null;
    let records: readonly PersistedLogRecord[];
    try {
      records = await this.observationLogStore.readAll();
    } catch (error: unknown) {
      if (filePath === null || !filePath.startsWith(".justice/reviews/")) return undefined;
      await this.recordReviewDispatchAdvisory("review_artifact_write_rejected", error);
      return { action: "skip", reason: "review_artifact_write_rejected" };
    }
    const delegated = projectDelegatedExecutionBindings(records).find(
      (candidate) => candidate.childSessionId === event.sessionId,
    );
    if (delegated === undefined) return undefined;
    const slot = projectReviewDispatchSlots(records).find(
      (candidate) =>
        candidate.state === "claimed" &&
        candidate.key.parentSessionId === delegated.parentSessionId &&
        candidate.callId === delegated.parentCallId,
    );
    const binding = projectTaskCallBindings(records).find(
      (candidate): candidate is ReviewTaskCallBinding =>
        candidate.purpose !== "implementation" &&
        slot !== undefined &&
        candidate.parentSessionId === delegated.parentSessionId &&
        candidate.callId === delegated.parentCallId &&
        JSON.stringify(candidate.correlation) === JSON.stringify(slot.key.correlation),
    );
    const content = typeof input.content === "string" ? input.content : undefined;
    if (
      binding === undefined ||
      binding.artifactReservation.status !== "usable" ||
      filePath !== binding.artifactReservation.artifactPath ||
      content === undefined ||
      this.options.reservedReviewArtifactIo === undefined
    ) {
      await this.recordReviewDispatchAdvisory("review_artifact_write_rejected");
      return { action: "skip", reason: "review_artifact_write_rejected" };
    }
    try {
      await this.options.reservedReviewArtifactIo.writeExisting(
        binding.artifactReservation,
        content,
      );
      await this.recordReviewDispatchAdvisory("review_artifact_write_committed");
      return { action: "skip", reason: "review_artifact_write_committed" };
    } catch (error: unknown) {
      await this.recordReviewDispatchAdvisory("review_artifact_write_rejected", error);
      return { action: "skip", reason: "review_artifact_write_rejected" };
    }
  }

  private async routeReviewTaskPostToolUse(
    event: Extract<HookEvent, { readonly type: "PostToolUse" }>,
  ): Promise<HookResponse | undefined> {
    if (event.callId === undefined || event.callId.trim().length === 0) return undefined;
    let records: readonly PersistedLogRecord[];
    try {
      records = await this.observationLogStore.readAll();
    } catch (error: unknown) {
      // Fail-open (N2): a durable-log read failure must not escape the hook
      // boundary; degrade to PROCEED after recording an advisory.
      await this.recordReviewDispatchAdvisory("review_post_tooluse_read_failed", error);
      return undefined;
    }
    const binding = projectTaskCallBindings(records).find(
      (candidate): candidate is ReviewTaskCallBinding =>
        "callId" in candidate &&
        candidate.parentSessionId === event.sessionId &&
        candidate.callId === event.callId,
    );
    if (binding === undefined) return undefined;
    const delegated = projectDelegatedExecutionBindings(records).find(
      (candidate) =>
        candidate.parentSessionId === event.sessionId && candidate.parentCallId === event.callId,
    );
    const observedExecution =
      delegated === undefined ? undefined : projectObservedReviewExecution(records, delegated);
    const outcome = await this.reviewCompletionDomain.consumeReviewCompletion({
        parentSessionId: event.sessionId,
        callId: event.callId,
        postToolUse: { type: "PostToolUse", sessionId: event.sessionId, callId: event.callId },
        ...(observedExecution === undefined ? {} : { observedExecution }),
        agentId: this.sessionStateProvider.getAgentId(event.sessionId),
        writerId: this.writerId,
      })
      .catch(async (error: unknown) => {
        // Fail-open (N2): completion consumption errors degrade to PROCEED.
        await this.recordReviewDispatchAdvisory("review_post_tooluse_consume_failed", error);
        return { kind: "blocked" as const };
      });
    const correlation = binding.correlation;
    if (outcome.kind === "terminalized" && correlation.reviewKind === "task-review") {
      // Task 3.7: Task 3.2 has now durably recorded the acceptance decision for
      // this review task. Advance the matching plan task's checkboxes while the
      // decision is still current for its active authorizationId. Fail-open:
      // progress update failures record an advisory and never block the
      // PostToolUse response.
      await this.updatePlanProgressAfterAcceptance(event.sessionId, correlation);
    }
    return outcome.kind === "terminalized"
      ? { action: "inject", injectedContext: "[JUSTICE: REVIEW COMPLETION RECORDED]" }
      : { action: "proceed" };
  }

  private async updatePlanProgressAfterAcceptance(
    parentSessionId: string,
    correlation: Extract<ReviewCorrelation, { readonly reviewKind: "task-review" }>,
  ): Promise<void> {
    try {
      const records = await this.observationLogStore.readAll();
      const acceptance = findCurrentAcceptanceDecision(records, correlation);
      if (
        acceptance.kind !== "found" ||
        acceptance.decision.kind !== "task-acceptance" ||
        acceptance.decision.verdict !== "accepted"
      ) {
        return;
      }
      // INV-19: an accepted decision replayed from an old released or
      // invalidated authorization must not advance plan progress. The primary
      // defense is Task 3.2 (no accepted decision after terminality); this
      // guard keeps the updater honest even if such a record exists.
      if (
        !(await isCurrentActiveAuthorization(correlation, (authorizationId) =>
          this.authorizationStore.findByAuthorizationId(authorizationId),
        ))
      ) {
        return;
      }
      const planPath = this.planBridge.getActivePlan(parentSessionId);
      if (planPath === null) return;
      const content = await this.fileReader.readFile(planPath);
      const task = new PlanParser()
        .parse(content)
        .find((candidate) => candidate.id === correlation.taskExecutionRef.taskId);
      if (task === undefined) return;
      const result = updatePlanProgress(content, task, acceptance.decision);
      if (!result.updated) return;
      await this.fileWriter.writeFile(planPath, result.content);
    } catch (error: unknown) {
      // Fail-open: I/O or progress update failures degrade to an advisory and
      // leave the PostToolUse response unchanged.
      await this.recordReviewDispatchAdvisory("plan_progress_update_failed", error);
    }
  }

  private warnInitializationRecoveryFailure(phase: string, error: unknown): void {
    try {
      this.options.logger?.warn(`Failed to recover ${phase} during initialization`, error);
    } catch {
      void 0;
    }
  }

  private async claimReviewTask(
    event: PreToolUseEvent,
    expectedCategory: "sp-review" | "sp-final-review",
  ): Promise<HookResponse> {
    const callId = event.callId;
    if (callId === undefined || callId.trim().length === 0) {
      await this.recordReviewDispatchAdvisory("review_call_id_missing");
      return { action: "inject", injectedContext: "[JUSTICE: REVIEW CLAIM BLOCKED] review_call_id_missing" };
    }
    let outcome: ClaimReviewDispatchOutcome;
    try {
      outcome = await this.reviewDispatchState.claimReviewDispatch({
        parentSessionId: event.sessionId,
        callId,
        expectedCategory,
        agentId: this.sessionStateProvider.getAgentId(event.sessionId),
        sessionId: event.sessionId,
        writerId: this.writerId,
      });
    } catch (error) {
      await this.recordReviewDispatchAdvisory("review_claim_failed", error);
      return { action: "inject", injectedContext: "[JUSTICE: REVIEW CLAIM BLOCKED] review_claim_failed" };
    }
    if (outcome.kind === "blocked") {
      return {
        action: "inject",
        injectedContext: `[JUSTICE: REVIEW CLAIM BLOCKED] ${outcome.advisory}`,
      };
    }
    this.sessionStateProvider.setTaskCallBinding(callId, outcome.taskCallBinding);
    const artifactPath =
      outcome.taskCallBinding.artifactReservation.status === "usable"
        ? { review_artifact_path: outcome.taskCallBinding.artifactReservation.artifactPath }
        : {};
    return {
      action: "inject",
      injectedContext:
        outcome.kind === "claimed"
          ? "[JUSTICE: REVIEW CLAIMED]"
          : "[JUSTICE: REVIEW CLAIMED] artifact_reservation_unusable",
      modifiedPayload: {
        args: {
          category: expectedCategory,
          run_in_background: false,
          ...artifactPath,
        },
      },
    };
  }

  private async mergePreToolUseWithReviewDeliveries(
    parentSessionId: string,
    response: HookResponse,
  ): Promise<HookResponse> {
    let deliveries;
    try {
      deliveries = await this.authorizationReviewBoundary.withParentSession(parentSessionId, () =>
        this.reviewDirectiveSink.drainForParentSession(parentSessionId, (delivery) =>
          this.reviewDispatchState.validateQueuedReviewDirectiveWithinParentSessionClaim(delivery),
        ),
      );
    } catch (error) {
      await this.recordReviewDispatchAdvisory("review_directive_delivery_validation_failed", error);
      return response;
    }
    return deliveries.reduce(
      (merged, delivery) =>
        mergePreToolUseResponses(
          merged,
          {
            action: "inject",
            injectedContext: `[JUSTICE: REVIEW REQUIRED] ${delivery.directive.correlation.reviewKind}`,
          },
          (message) => this.warnMergeConflict(message),
        ),
      response,
    );
  }

  private warnMergeConflict(message: string): void {
    try {
      this.options.logger?.warn(message);
    } catch {
      return;
    }
  }
}
