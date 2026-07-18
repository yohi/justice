import { mergePostToolUseResponses } from "../core/hook-response-merger";
import { ReviewRejectionDetector } from "../core/review-rejection-detector";
import { normalizeReviewResolutionArtifact } from "../core/review-resolution-artifact";
import { resolveTaskIdFromToolInput } from "../core/task-packager";
import type {
  HookResponse,
  ObservationAgentId,
  PostToolUseEvent,
  PreToolUseEvent,
  ShardId,
} from "../core/types";
import type { ObservationMessagePayload } from "../core/v2/message-payload";
import {
  buildMessageRecord,
  buildReviewObservedRecord,
  buildReviewResolutionRecord,
  buildSessionErrorRecord,
  buildSkillInvokedRecord,
  buildToolExecutedRecord,
  type ToolExecutedRecordInput,
} from "../core/v2/record-builder";
import { detectSkillInvoked } from "../core/v2/skill-invoked-detector";
import { buildReflectionEvent } from "../core/v2/reflection-event";
import { project, type ProjectedState } from "../core/v2/state-projection";
import { hashString } from "../core/v2/hash";
import { extractTaskSummaryClaims } from "../core/v2/task-summary-claim-extractor";
import type { DeclaredClaim } from "../core/v2/declared-claim-extractor";
import type { SessionStateProvider } from "../core/session-state-provider";
import { MessageRoleBuffer } from "../runtime/message-role-buffer";
import type { ObservationLogStore } from "../runtime/observation-log-store";
import { validateProjectionCacheAgainstEvents } from "../runtime/state-projection-cache";
import { evaluate, formatGateAdvisoryMessage } from "../core/v2/rule-evaluation-engine";
import type { GateContext } from "../core/v2/gate-context";
import { collectReviewScopes, deriveReviewScope } from "../core/v2/review-scope";
import type { PendingDecisionRecord } from "../core/v2/decision-model";
import type { GateLoader } from "../runtime/gate-loader";

const PROCEED: HookResponse = { action: "proceed" };

// D65: messageRoleBuffer memory bounds. A finalized message is short-lived;
// parts that never finalize (e.g. streaming truncation) must not grow forever.
const MESSAGE_ROLE_BUFFER_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes idle
const MESSAGE_ROLE_BUFFER_MAX_ENTRIES = 1000;

/**
 * ObservationHandler observes EVERY tool call and message part for the v2
 * observation pipeline (declared-claim extraction, evidence recording).
 *
 * It finalizes assistant messages, extracts declared claims, builds
 * observation records, and appends them to the configured ObservationLogStore.
 * A bounded in-memory MessageRoleBuffer is used to collect streaming parts and
 * is garbage-collected on every message event to enforce the D65 memory bound.
 *
 * Dependencies (`logStore`, `sessionStateProvider`, `writerId`, and an optional
 * `logger`) are injected via the constructor for testability and fail-open
 * operation.
 */
export class ObservationHandler {
  private readonly messageRoleBuffer = new MessageRoleBuffer();
  private readonly reviewRejectionDetector = new ReviewRejectionDetector();
  private readonly persistedMessageHashes = new Map<string, Map<string, string>>();
  private projectionRefresh: Promise<void> = Promise.resolve();

  constructor(
    private readonly options: {
      readonly logStore: ObservationLogStore;
      readonly sessionStateProvider: SessionStateProvider;
      readonly projectionCache?: {
        readonly read?: () => Promise<ProjectedState | undefined>;
        readonly write: (state: ProjectedState) => Promise<void>;
      };
      readonly writerId: string;
      readonly workspaceRoot?: string;
      readonly logger?: { warn(message: string, error: unknown): void };
      readonly gateLoader?: GateLoader;
    },
  ) {}

  async handleSessionError(error: {
    readonly message: string;
    readonly kind?: string;
    readonly agentId: ObservationAgentId;
    readonly sessionId: string;
  }): Promise<HookResponse> {
    try {
      const pendingAssistantText = this.messageRoleBuffer.getPendingAssistantText(error.sessionId);
      const record = buildSessionErrorRecord({
        envelope: {
          schemaVersion: 1 as const,
          timestamp: new Date().toISOString(),
          agentId: error.agentId,
          sessionId: error.sessionId,
          writerId: this.options.writerId,
          recordType: "observation" as const,
        },
        errorKind: error.kind,
        message: error.message,
        pendingAssistantText,
      });

      await this.options.logStore.append(
        { agentId: error.agentId, sessionId: error.sessionId, writerId: this.options.writerId },
        record,
      );
      this.scheduleProjectionRefresh();
      // D65: session.error GC's the messageRoleBuffer immediately -- this is
      // intentional (not deferred to confirmed session teardown). Any pending,
      // possibly-unfinalized assistant text was already captured above into
      // pendingAssistantSnippet before this discard, so a recoverable session
      // that later resumes no longer silently loses that text from the audit
      // trail. The buffer is discarded only once the session_error append
      // above has durably succeeded: if append() failed, the buffered parts
      // are kept so a later message_updated(finalized:true)/text_complete can
      // still reconstruct them via the normal message path.
      this.messageRoleBuffer.removeSession(error.sessionId);
    } catch (err) {
      this.options.logger?.warn(
        "observation-handler: session error observation failed, degrading to PROCEED",
        err,
      );
    }
    return PROCEED;
  }

  async initializeProjectionCache(): Promise<void> {
    try {
      await this.refreshProjectionCache();
    } catch (error) {
      this.options.logger?.warn(
        "observation-handler projection cache initialization failed",
        error,
      );
    }
  }

  async emitReflectionEvent(input: {
    readonly trigger: "task_succeeded" | "task_error";
    readonly planRef: { readonly path: string; readonly taskId: string };
    readonly intent: "check_complete" | "append_error_note";
    readonly note?: string;
    readonly sessionId: string;
  }): Promise<void> {
    try {
      const agentId = this.options.sessionStateProvider.getAgentId(input.sessionId);
      const record = buildReflectionEvent(
        {
          schemaVersion: 1 as const,
          timestamp: new Date().toISOString(),
          agentId,
          sessionId: input.sessionId,
          writerId: this.options.writerId,
          taskId: input.planRef.taskId,
          recordType: "observation" as const,
        },
        input,
        this.options.workspaceRoot,
      );

      await this.options.logStore.append(
        { agentId, sessionId: input.sessionId, writerId: this.options.writerId },
        record,
      );
      this.scheduleProjectionRefresh();
    } catch (err) {
      this.options.logger?.warn(
        "observation-handler: emitReflectionEvent failed, degrading gracefully",
        err,
      );
    }
  }

  async handleMessage(
    sessionId: string,
    payload: ObservationMessagePayload,
  ): Promise<HookResponse> {
    this.messageRoleBuffer.update(sessionId, payload);

    try {
      const text = this.messageRoleBuffer.getFinalizedAssistantText(sessionId, payload.messageID);
      if (text === undefined || text.length === 0) {
        return PROCEED;
      }
      const textHash = hashString(text);
      // Only an exact repeat is suppressed. A hash change from a legitimate
      // correction (e.g. a delayed text_complete overwriting a part that was
      // soft-finalized by message_updated -- see message-role-buffer.ts) is
      // intentionally appended as a NEW immutable audit revision rather than
      // replacing the prior record; declared claims here are non-authoritative
      // (audit visibility only, never gate evidence).
      if (this.persistedMessageHashes.get(sessionId)?.get(payload.messageID) === textHash) {
        return PROCEED;
      }

      const claims = this.messageRoleBuffer.extractAssistantClaims(sessionId, payload.messageID);
      const agentId = this.options.sessionStateProvider.getAgentId(sessionId);
      const record = buildMessageRecord({
        envelope: {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId,
          sessionId,
          writerId: this.options.writerId,
          recordType: "observation",
        },
        messageID: payload.messageID,
        text,
        claims,
      });
      await this.options.logStore.append(
        { agentId, sessionId, writerId: this.options.writerId },
        record,
      );
      const sessionHashes = this.persistedMessageHashes.get(sessionId) ?? new Map<string, string>();
      sessionHashes.set(payload.messageID, textHash);
      this.persistedMessageHashes.set(sessionId, sessionHashes);
      this.scheduleProjectionRefresh();
    } catch (error) {
      this.options.logger?.warn("observation-handler message failed", error);
    } finally {
      this.cleanupMessageBuffer();
    }
    return PROCEED;
  }

  destroySession(sessionId: string): void {
    this.persistedMessageHashes.delete(sessionId);
    this.messageRoleBuffer.removeSession(sessionId);
    // Propagate cleanup to the log store so this session's per-shard write-queue
    // caches are released, bounding memory across sessions. Optional chaining keeps
    // this fail-open: incomplete test mocks (and any logStore lacking the method)
    // simply skip it rather than throwing.
    this.options.logStore.destroySession?.(sessionId);
  }

  async handlePreToolUse(event: PreToolUseEvent): Promise<HookResponse> {
    if (event.payload.toolName !== "task" || event.callId === undefined) return PROCEED;
    const taskId = resolveTaskIdFromToolInput(event.payload.toolInput);
    if (taskId !== undefined) {
      this.options.sessionStateProvider.setActiveTaskWindow(event.callId, taskId);
    }
    return PROCEED;
  }

  async handlePostToolUse(event: PostToolUseEvent): Promise<HookResponse> {
    const callId = event.callId;
    const reviewResolutionArtifact = event.payload.reviewResolutionArtifact;
    if (reviewResolutionArtifact !== undefined) {
      try {
        const agentId = this.options.sessionStateProvider.getAgentId(event.sessionId);
        await this.handleReviewResolutionArtifact({
          agentId,
          sessionId: event.sessionId,
          reviewScope: reviewResolutionArtifact.reviewScope,
          itemKeys: reviewResolutionArtifact.itemKeys,
          artifactRef: reviewResolutionArtifact.artifactRef,
        });
      } catch (error) {
        this.options.logger?.warn(
          "observation-handler: typed review resolution handling failed, degrading to PROCEED",
          error,
        );
      }
      return PROCEED;
    }
    if (callId === undefined || event.payload.toolName.startsWith("justice_")) return PROCEED;

    let taskId: string | undefined;
    try {
      taskId = this.options.sessionStateProvider.getActiveTaskId(callId);
      const agentId = this.options.sessionStateProvider.getAgentId(event.sessionId);
      const shardId: ShardId = {
        agentId,
        sessionId: event.sessionId,
        writerId: this.options.writerId,
      };
      const toolRecordInput: ToolExecutedRecordInput = {
        envelope: {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId,
          sessionId: event.sessionId,
          writerId: this.options.writerId,
          ...(taskId === undefined ? {} : { taskId }),
          recordType: "observation",
        },
        toolName: event.payload.toolName,
        toolInput: event.payload.toolInput,
        toolOutput: {
          output: event.payload.toolResult,
          metadata: { error: event.payload.error || event.payload.metadata?.error === true },
        },
        callId,
      };

      if (event.payload.toolName === "task") {
        await this.appendTaskSummaryDeclaredEvidence(shardId, toolRecordInput);
      } else {
        await this.options.logStore.append(shardId, buildToolExecutedRecord(toolRecordInput));
      }

      const invokedSkills = detectSkillInvoked(
        event.payload.toolName,
        event.payload.toolInput,
        callId,
      );
      for (const invocation of invokedSkills) {
        const skillName = invocation.skillName.trim();
        if (skillName.length === 0) continue;
        try {
          await this.options.logStore.append(
            shardId,
            buildSkillInvokedRecord({
              envelope: toolRecordInput.envelope,
              invocation: { ...invocation, skillName },
            }),
          );
        } catch (error) {
          this.options.logger?.warn("observation-handler: skill_invoked observation failed", error);
        }
      }
      await this.appendReviewObservationsIfDetected(
        shardId,
        taskId,
        event.sessionId,
        callId,
        event.payload.toolName,
        event.payload.toolResult,
        event.payload.metadata,
      );
      let cachedState: ProjectedState | undefined;
      try {
        cachedState = await this.refreshProjectionCache();
      } catch (error) {
        this.options.logger?.warn(
          "observation-handler: projection cache refresh failed during PostToolUse, continuing gate evaluation",
          error,
        );
      }

      let response = PROCEED;
      // Both gate evaluations below fold the same not-yet-decision-appended
      // event log into a ProjectedState. When a projectionCache is configured,
      // refreshProjectionCache() above already performed the readAll()+project()
      // pass (or validated the existing cache), so its result seeds
      // gateStatePromise directly. getGateState() only falls back to a fresh
      // readProjectedState() (a second readAll()+project() pass) when no cache
      // is configured or the refresh above failed. Sharing the pre-decision
      // snapshot across both calls is safe because a DecisionRecord never
      // feeds back into gate evidence/reviewScope (see the DecisionRecord note
      // inside evaluateGateIfTriggered).
      let gateStatePromise: Promise<ProjectedState> | undefined =
        cachedState === undefined ? undefined : Promise.resolve(cachedState);
      const getGateState = (): Promise<ProjectedState> => {
        gateStatePromise ??= this.readProjectedState();
        return gateStatePromise;
      };
      if (event.payload.toolName === "task" && taskId !== undefined) {
        response = mergePostToolUseResponses([
          response,
          await this.evaluateGateIfTriggered(
            "task_complete",
            taskId,
            callId,
            agentId,
            event.sessionId,
            getGateState,
          ),
        ]);
      }
      response = mergePostToolUseResponses([
        response,
        await this.evaluateGateIfTriggered(
          "tool_observed",
          taskId,
          callId,
          agentId,
          event.sessionId,
          getGateState,
        ),
      ]);
      return response;
    } catch (error) {
      this.options.logger?.warn(
        "observation-handler: tool observation failed, degrading to PROCEED",
        error,
      );
      return PROCEED;
    } finally {
      if (event.payload.toolName === "task") {
        this.options.sessionStateProvider.closeActiveTaskWindow(callId);
      }
    }
  }

  private async appendTaskSummaryDeclaredEvidence(
    shardId: ShardId,
    input: ToolExecutedRecordInput,
  ): Promise<void> {
    let summaryClaims: readonly DeclaredClaim[] = [];
    try {
      summaryClaims = extractTaskSummaryClaims(input.callId, input.toolOutput.output ?? "");
    } catch (error) {
      this.options.logger?.warn("observation-handler: task summary claim extraction failed", error);
    }
    try {
      await this.options.logStore.append(
        shardId,
        buildToolExecutedRecord({ ...input, summaryClaims }),
      );
    } catch (error) {
      this.options.logger?.warn(
        "observation-handler: task summary declared evidence failed",
        error,
      );
    }
  }

  private scheduleProjectionRefresh(): void {
    if (this.options.projectionCache === undefined) return;
    this.projectionRefresh = this.projectionRefresh
      .catch(() => {})
      .then(async () => {
        await this.refreshProjectionCache();
      })
      .catch((error) => {
        this.options.logger?.warn("observation-handler projection cache refresh failed", error);
      });
  }

  private async refreshProjectionCache(): Promise<ProjectedState | undefined> {
    if (this.options.projectionCache === undefined) return undefined;
    const events = await this.options.logStore.readAll();
    const cached = await this.options.projectionCache.read?.();
    if (cached !== undefined) {
      const validation = validateProjectionCacheAgainstEvents(cached, events);
      if (validation.valid) return cached;
      if (validation.reason !== "stale_append") {
        this.options.logger?.warn(
          `observation-handler projection cache ${validation.reason}, rebuilding`,
          new Error(validation.reason),
        );
      }
    }
    const freshState = project(events, new Date().toISOString());
    try {
      await this.options.projectionCache.write(freshState);
    } catch (error) {
      this.options.logger?.warn("observation-handler projection cache write failed", error);
    }
    return freshState;
  }

  /** Folds the full event log into a fresh `ProjectedState` (no caching). */
  private async readProjectedState(): Promise<ProjectedState> {
    const events = await this.options.logStore.readAll();
    return project(events, new Date().toISOString());
  }

  private cleanupMessageBuffer(): void {
    try {
      this.messageRoleBuffer.gc(MESSAGE_ROLE_BUFFER_MAX_AGE_MS, MESSAGE_ROLE_BUFFER_MAX_ENTRIES);
    } catch (error) {
      this.options.logger?.warn("observation-handler gc failed", error);
    }
  }

  private async appendReviewObservationsIfDetected(
    shardId: ShardId,
    taskId: string | undefined,
    sessionId: string,
    callId: string,
    toolName: string,
    toolResult: string,
    metadata?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    try {
      const items = this.reviewRejectionDetector.detectMultiple(
        toolResult,
        metadata,
        this.options.workspaceRoot ?? process.cwd(),
      );
      const isCompleteSnapshot = this.reviewRejectionDetector.isCompleteSnapshot(
        toolResult,
        metadata,
      );
      if (items.length === 0 && !isCompleteSnapshot) return;

      const reviewScope = deriveReviewScope({ taskId, sessionId, callId, toolName });
      await this.options.logStore.append(
        shardId,
        buildReviewObservedRecord(
          {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            agentId: shardId.agentId,
            sessionId,
            writerId: this.options.writerId,
            ...(taskId === undefined ? {} : { taskId }),
            recordType: "observation",
          },
          reviewScope,
          items,
          isCompleteSnapshot,
        ),
      );
    } catch (error) {
      this.options.logger?.warn("observation-handler: review_observed generation failed", error);
    }
  }

  async handleReviewResolutionArtifact(payload: {
    readonly agentId: ObservationAgentId;
    readonly sessionId: string;
    readonly reviewScope: string;
    readonly itemKeys: readonly string[];
    readonly artifactRef: string;
  }): Promise<HookResponse> {
    try {
      const artifact = normalizeReviewResolutionArtifact(payload);
      if (artifact === undefined) return PROCEED;

      const shardId: ShardId = {
        agentId: payload.agentId,
        sessionId: payload.sessionId,
        writerId: this.options.writerId,
      };
      await this.options.logStore.append(
        shardId,
        buildReviewResolutionRecord(
          {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            agentId: payload.agentId,
            sessionId: payload.sessionId,
            writerId: this.options.writerId,
            recordType: "observation",
          },
          artifact.reviewScope,
          artifact.itemKeys,
          artifact.artifactRef,
        ),
      );
      this.scheduleProjectionRefresh();
    } catch (error) {
      this.options.logger?.warn("observation-handler: review resolution marker failed", error);
    }
    return PROCEED;
  }

  private async evaluateGateIfTriggered(
    trigger: "task_complete" | "tool_observed",
    taskId: string | undefined,
    _callId: string | undefined,
    agentId: ObservationAgentId,
    sessionId: string,
    getState: () => Promise<ProjectedState> = () => this.readProjectedState(),
  ): Promise<HookResponse> {
    try {
      const gateLoader = this.options.gateLoader;
      // Fail-open: gate evaluation is an optional dependency.
      if (gateLoader === undefined) return PROCEED;
      // No active task to gate on. Return before any I/O so tool calls that are
      // not part of a task stay cheap (mirrors evaluate()'s own SKIP-on-no-taskId).
      if (taskId === undefined) return PROCEED;

      const state = await getState();
      const gates = await gateLoader.load();
      const ctx: GateContext = {
        trigger,
        taskId,
        agentId,
        sessionId,
        reviewScope: collectReviewScopes(state, taskId),
        reviewSummary: state.reviewSummary,
      };
      const evidence = state.tasks.get(taskId)?.evidence ?? [];
      const verdict = evaluate(gates, evidence, ctx);
      if (verdict.verdict === "SKIP") return PROCEED;

      const shardId: ShardId = { agentId, sessionId, writerId: this.options.writerId };
      const decision: PendingDecisionRecord = {
        schemaVersion: 1 as const,
        timestamp: new Date().toISOString(),
        agentId,
        sessionId,
        writerId: this.options.writerId,
        taskId,
        recordType: "decision" as const,
        ...verdict,
      };
      await this.options.logStore.append(shardId, decision);
      // A DecisionRecord never feeds back into gate evidence, so an async cache
      // refresh (same as handleSessionError/emitReflectionEvent) is sufficient;
      // no synchronous re-projection is required for correctness here.
      this.scheduleProjectionRefresh();

      if (verdict.verdict === "PASS") return PROCEED;

      return {
        action: "inject",
        injectedContext: formatGateAdvisoryMessage(verdict),
        variant: "gate_advisory",
      };
    } catch (error) {
      this.options.logger?.warn(
        "observation-handler: gate evaluation failed, degrading to PROCEED",
        error,
      );
      return PROCEED;
    }
  }
}
