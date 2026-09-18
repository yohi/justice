import { mergePostToolUseResponses } from "../core/hook-response-merger";
import { ReviewRejectionDetector, type ReviewItem } from "../core/review-rejection-detector";
import { normalizeReviewResolutionArtifact } from "../core/review-resolution-artifact";
import { resolveTaskIdFromToolInput } from "../core/task-packager";
import type {
  HookResponse,
  ObservationAgentId,
  PostToolUseEvent,
  PreToolUseEvent,
  ShardId,
  WorkflowBootstrapPhase,
  WorkflowStartRequest,
  ReviewPendingCommittedHandler,
  TaskExecutionRef,
} from "../core/types";
import type { ApprovedPlanBinding } from "../core/plan-authorization";
import { createAuthorizationReviewBoundary } from "../core/plan-authorization";
import {
  advanceFinalizationAfterAllTasksAccepted as advanceFinalizationLifecycle,
  appendTaskLifecycleTransition,
  recordWorkerReportedAndEvidence,
  requestCurrentTaskReview,
  startImplementationAttempt,
  type LifecycleRecordAppender,
  type LifecycleNotificationDependencies,
  type FinalizationAdvanceInput,
  type FinalizationAdvanceResult,
} from "../core/task-lifecycle";
import type { PendingObservationRecord, TaskProgressState } from "../core/v2/observation-model";
import type { ObservationMessagePayload } from "../core/v2/message-payload";
import {
  buildMessageRecord,
  buildReviewObservedRecord,
  buildReviewResolutionRecord,
  buildSessionErrorRecord,
  buildSkillInvokedRecord,
  buildToolExecutedRecord,
  buildWorkflowPhaseRecord,
  buildWorkflowStartedRecord,
  type ToolExecutedRecordInput,
  type WorkflowBootstrapRecordInput,
} from "../core/v2/record-builder";
import { detectSkillInvoked } from "../core/v2/skill-invoked-detector";
import { buildReflectionEvent } from "../core/v2/reflection-event";
import { project, type ProjectedState } from "../core/v2/state-projection";
import { hashString } from "../core/v2/hash";
import { extractTaskSummaryClaims } from "../core/v2/task-summary-claim-extractor";
import type { DeclaredClaim } from "../core/v2/declared-claim-extractor";
import type { SessionStateProvider } from "../core/session-state-provider";
import { MessageRoleBuffer } from "../runtime/message-role-buffer";
import type { ObservationLogStore, ReadOnlyObservationLog } from "../runtime/observation-log-store";
import { validateProjectionCacheAgainstEvents } from "../runtime/state-projection-cache";
import { evaluate, formatGateAdvisoryMessage } from "../core/v2/rule-evaluation-engine";
import { createGatePendingAttemptEvaluator } from "../core/acceptance-decision";
import { deriveReviewScope } from "../core/v2/review-scope";
import type { GateLoader } from "../runtime/gate-loader";
import {
  assertNever,
  formatWorkflowDirective,
  type WorkflowDirectiveStage,
} from "../core/workflow-directives";

const PROCEED: HookResponse = { action: "proceed" };

type ReviewObservationOutcome =
  | { readonly kind: "not_review" }
  | { readonly kind: "findings" }
  | { readonly kind: "clear_snapshot" }
  | { readonly kind: "failed" };

// D65: messageRoleBuffer memory bounds. A finalized message is short-lived;
// parts that never finalize (e.g. streaming truncation) must not grow forever.
const MESSAGE_ROLE_BUFFER_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes idle
const MESSAGE_ROLE_BUFFER_MAX_ENTRIES = 1000;

type ProjectionCacheAccess = {
  readonly read?: () => Promise<ProjectedState | undefined>;
  readonly write: (state: ProjectedState) => Promise<void>;
};

/**
 * Input for the workflow bootstrap lifecycle observations. Deliberately carries no
 * `taskId`: these records are audit-only and must never open a task window.
 */
export type WorkflowBootstrapEventInput = {
  readonly request: WorkflowStartRequest;
  readonly phase: WorkflowBootstrapPhase;
  readonly directiveStage?: WorkflowDirectiveStage;
  readonly sessionId: string;
};

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
  private readonly reviewDeliveriesBySession = new Map<string, Set<string>>();
  private projectionRefresh: Promise<void> = Promise.resolve();
  private reviewPendingCommittedHandler?: ReviewPendingCommittedHandler;
  private readonly gateEvaluator;

  constructor(
    private readonly options: {
      readonly logStore: ObservationLogStore;
      readonly sessionStateProvider: SessionStateProvider;
      readonly projectionCache?: ProjectionCacheAccess;
      readonly writerId: string;
      readonly workspaceRoot?: string;
      readonly logger?: { warn(message: string, error: unknown): void };
      readonly gateLoader?: GateLoader;
      readonly getActiveAuthorization?: (
        parentSessionId: string,
        taskId: string,
      ) => Promise<ApprovedPlanBinding | null>;
      readonly getTaskLifecycleState?: (
        parentSessionId: string,
        authorizationId: string,
        taskId: string,
      ) => Promise<TaskProgressState | undefined>;
    },
  ) {
    this.gateEvaluator = createGatePendingAttemptEvaluator({
      readDurableRecords: () => this.options.logStore.readAll(),
      appendDecision: async (record) => {
        try {
          await this.options.logStore.append(
            { agentId: record.agentId, sessionId: record.sessionId, writerId: record.writerId },
            record,
          );
          this.scheduleProjectionRefresh();
          return { kind: "committed" };
        } catch {
          return { kind: "failed" };
        }
      },
      findAuthorizationById: async (authorizationId) => {
        if (this.options.getActiveAuthorization === undefined) return null;
        const records = await this.options.logStore.readAll();
        const task = records.find(
          (record) => record.recordType === "observation" && record.taskId !== undefined,
        );
        return task === undefined
          ? null
          : this.options.getActiveAuthorization(task.sessionId, task.taskId ?? authorizationId);
      },
      withAuthorizationReviewBoundary: createAuthorizationReviewBoundary().withParentSession,
      appendTaskLifecycleTransition: async (input) => {
        const shardId: ShardId = {
          agentId: input.agentId ?? "system",
          sessionId: input.sessionId ?? input.parentSessionId,
          writerId: input.writerId ?? this.options.writerId,
        };
        return appendTaskLifecycleTransition(input, async (record) => {
          await this.options.logStore.append(shardId, record);
          return 0;
        });
      },
      appendPlanFinalizationTransition: async () => ({ kind: "failed" }),
      evaluateRules: async ({ context, projected }) => {
        const loader = this.options.gateLoader;
        if (loader === undefined) return { verdict: "SKIP", reason: "gate loader unavailable" };
        return evaluate(
          await loader.load(),
          context.scope === "task"
            ? (projected.tasks.get(context.taskExecutionRef.taskId)?.evidence ?? [])
            : [],
          context,
        );
      },
      recordAdvisory: (advisory) => this.appendLifecycleAdvisory(advisory),
    });
  }

  getLogStore(): ReadOnlyObservationLog {
    return this.options.logStore;
  }

  getProjectionCache(): ProjectionCacheAccess | undefined {
    return this.options.projectionCache;
  }

  getGateLoader(): GateLoader | undefined {
    return this.options.gateLoader;
  }

  setReviewPendingCommittedHandler(handler: ReviewPendingCommittedHandler): void {
    this.reviewPendingCommittedHandler = handler;
  }

  async advanceFinalizationAfterAllTasksAccepted(
    input: FinalizationAdvanceInput,
  ): Promise<FinalizationAdvanceResult> {
    const agentId = this.options.sessionStateProvider.getAgentId(input.parentSessionId);
    const shardId: ShardId = {
      agentId,
      sessionId: input.parentSessionId,
      writerId: this.options.writerId,
    };
    const appendRecord: LifecycleRecordAppender = async (record) => {
      const sequence = await this.options.logStore.append(shardId, {
        ...record,
        agentId,
        sessionId: input.parentSessionId,
        writerId: this.options.writerId,
      });
      this.scheduleProjectionRefresh();
      return sequence;
    };
    const dependencies: LifecycleNotificationDependencies = {
      onReviewPendingCommitted: this.reviewPendingCommittedHandler,
      recordAdvisory: (advisory, cause) => this.appendLifecycleAdvisory(advisory, cause),
    };
    return advanceFinalizationLifecycle(input, appendRecord, dependencies);
  }

  async handleSessionError(error: {
    readonly message: string;
    readonly kind?: string;
    readonly agentId: ObservationAgentId;
    readonly sessionId: string;
  }): Promise<HookResponse> {
    try {
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
      });

      await this.options.logStore.append(
        { agentId: error.agentId, sessionId: error.sessionId, writerId: this.options.writerId },
        record,
      );
      this.scheduleProjectionRefresh();
      // D65: discard in-flight text after a durable error record. Message bodies
      // are deliberately not copied into session_error records (D34).
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

  /**
   * Records the `workflow_started` audit observation for a parsed workflow-start
   * request. Non-authoritative: no evidence, no `taskId`, no effect on Gate
   * verdicts. Always resolves to PROCEED (fail-open).
   */
  async emitWorkflowStartedEvent(input: WorkflowBootstrapEventInput): Promise<HookResponse> {
    return this.appendWorkflowBootstrapRecord(buildWorkflowStartedRecord, input);
  }

  /**
   * Records the lifecycle transition matching `input.phase`: `design_requested`,
   * `plan_requested`, or `plan_activated` — exactly one record per transition.
   * Always resolves to PROCEED (fail-open).
   */
  async emitWorkflowPhaseEvent(input: WorkflowBootstrapEventInput): Promise<HookResponse> {
    return this.appendWorkflowBootstrapRecord(buildWorkflowPhaseRecord, input);
  }

  /**
   * Shared append path for the bootstrap lifecycle records: reuses the store's
   * serialized atomic append (and its redaction boundary) and swallows every
   * failure so a rejected log write can never block command processing.
   */
  private async appendWorkflowBootstrapRecord(
    build: (input: WorkflowBootstrapRecordInput) => PendingObservationRecord,
    input: WorkflowBootstrapEventInput,
  ): Promise<HookResponse> {
    try {
      const agentId = this.options.sessionStateProvider.getAgentId(input.sessionId);
      const record = build({
        envelope: {
          schemaVersion: 1 as const,
          timestamp: new Date().toISOString(),
          agentId,
          sessionId: input.sessionId,
          writerId: this.options.writerId,
          recordType: "observation" as const,
        },
        request: input.request,
        phase: input.phase,
        ...(input.directiveStage === undefined ? {} : { directiveStage: input.directiveStage }),
      });

      await this.options.logStore.append(
        { agentId, sessionId: input.sessionId, writerId: this.options.writerId },
        record,
      );
      // Keeps state.json's integrity fields aligned with the log so the next read
      // is not a spurious `stale_append`; the record itself changes no projection.
      this.scheduleProjectionRefresh();
    } catch (error) {
      this.options.logger?.warn(
        "observation-handler: workflow bootstrap observation failed, degrading to PROCEED",
        error,
      );
    }
    return PROCEED;
  }

  async handleMessage(
    sessionId: string,
    payload: ObservationMessagePayload,
  ): Promise<HookResponse> {
    this.messageRoleBuffer.update(sessionId, payload);

    try {
      const agentId = this.options.sessionStateProvider.getAgentId(sessionId);
      let projectionRefreshNeeded = payload.kind === "message_updated" && payload.finalized;
      for (const partID of this.finalizedAssistantPartIDs(sessionId, payload)) {
        const text = this.messageRoleBuffer.getFinalizedAssistantText(
          sessionId,
          payload.messageID,
          partID,
        );
        if (text === undefined) continue;

        const textHash = hashString(text);
        const messagePartKey = JSON.stringify([payload.messageID, partID]);
        // A correction is a new immutable audit revision, but only for its own
        // (messageID, partID) identity. Other finalized parts remain untouched.
        if (this.persistedMessageHashes.get(sessionId)?.get(messagePartKey) === textHash) {
          continue;
        }

        const claims = this.messageRoleBuffer.extractAssistantClaims(
          sessionId,
          payload.messageID,
          partID,
        );
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
          partID,
          text,
          claims,
        });
        await this.options.logStore.append(
          { agentId, sessionId, writerId: this.options.writerId },
          record,
        );
        const sessionHashes =
          this.persistedMessageHashes.get(sessionId) ?? new Map<string, string>();
        sessionHashes.set(messagePartKey, textHash);
        this.persistedMessageHashes.set(sessionId, sessionHashes);
        projectionRefreshNeeded = true;
      }
      if (projectionRefreshNeeded) this.scheduleProjectionRefresh();
    } catch (error) {
      this.options.logger?.warn("observation-handler message failed", error);
    } finally {
      this.cleanupMessageBuffer();
    }
    return PROCEED;
  }

  private finalizedAssistantPartIDs(
    sessionId: string,
    payload: ObservationMessagePayload,
  ): readonly string[] {
    switch (payload.kind) {
      case "message_part_updated":
        return [];
      case "text_complete":
        return [payload.partID];
      case "message_updated":
        return this.messageRoleBuffer.getFinalizedAssistantPartIDs(sessionId, payload.messageID);
    }
  }

  destroySession(sessionId: string): void {
    this.persistedMessageHashes.delete(sessionId);
    this.reviewDeliveriesBySession.delete(sessionId);
    this.messageRoleBuffer.removeSession(sessionId);
    // Propagate cleanup to the log store so this session's per-shard write-queue
    // caches are released, bounding memory across sessions. Optional chaining keeps
    // this fail-open: incomplete test mocks (and any logStore lacking the method)
    // simply skip it rather than throwing.
    this.options.logStore.destroySession?.(sessionId);
  }

  async handlePreToolUse(event: PreToolUseEvent): Promise<HookResponse> {
    try {
      if (event.payload.toolName !== "task" || event.callId === undefined) return PROCEED;
      const taskId = resolveTaskIdFromToolInput(event.payload.toolInput);
      if (taskId === undefined) return PROCEED;
      this.options.sessionStateProvider.setActiveTaskWindow(event.callId, taskId, event.sessionId);
      if (this.options.getActiveAuthorization !== undefined) {
        const authorization = await this.options.getActiveAuthorization(event.sessionId, taskId);
        if (
          authorization === null ||
          !authorization.canonicalSnapshot.tasks.some((task) => task.taskId === taskId)
        ) {
          return {
            action: "inject",
            injectedContext: formatWorkflowDirective({ stage: "implementation_unauthorized" }),
          };
        }
        const lifecycleState =
          (await this.options.getTaskLifecycleState?.(
            event.sessionId,
            authorization.authorizationId,
            taskId,
          )) ?? "authorized";
        const attempt = startImplementationAttempt({
          authorizationId: authorization.authorizationId,
          taskId,
          state: lifecycleState,
        });
        this.options.sessionStateProvider.setTaskCallBinding(event.callId, {
          parentSessionId: event.sessionId,
          authorizationId: authorization.authorizationId,
          taskExecutionRef: attempt.taskExecutionRef,
        });
        await this.appendInitialImplementationLifecycle(
          event,
          attempt.taskExecutionRef,
          lifecycleState,
        );
        return PROCEED;
      }
      const taskExecutionRef = readTaskExecutionRef(event.payload.toolInput);
      if (taskExecutionRef !== undefined) {
        this.options.sessionStateProvider.setTaskCallBinding(event.callId, {
          parentSessionId: event.sessionId,
          authorizationId: taskExecutionRef.authorizationId,
          taskExecutionRef,
        });
        await this.appendInitialImplementationLifecycle(event, taskExecutionRef);
      }
      return PROCEED;
    } catch (error) {
      this.options.logger?.warn(
        "observation-handler: PreToolUse lifecycle failed, degrading to PROCEED",
        error,
      );
      return PROCEED;
    }
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
        if (!(await this.appendTaskSummaryDeclaredEvidence(shardId, toolRecordInput))) {
          return PROCEED;
        }
      } else {
        await this.options.logStore.append(shardId, buildToolExecutedRecord(toolRecordInput));
      }

      if (event.payload.toolName === "task") {
        await this.appendReviewPendingLifecycle(event, shardId, taskId);
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
          continue;
        }
      }
      let reviewOutcome: ReviewObservationOutcome = { kind: "not_review" };
      if (isReviewObservationTool(event.payload.toolName)) {
        reviewOutcome = await this.appendReviewObservationsIfDetected(
          shardId,
          taskId,
          event.sessionId,
          callId,
          event.payload.toolName,
          event.payload.toolResult,
          event.payload.metadata,
          event.payload.reviewSnapshotArtifact?.complete === true,
        );
      }
      let response: HookResponse;
      switch (reviewOutcome.kind) {
        case "not_review":
          response = PROCEED;
          break;
        case "findings": {
          response = {
            action: "inject",
            injectedContext: formatWorkflowDirective({ stage: "review_remediation" }),
          };
          break;
        }
        case "clear_snapshot": {
          response = {
            action: "inject",
            injectedContext: formatWorkflowDirective({ stage: "review_clear" }),
          };
          break;
        }
        case "failed":
          return PROCEED;
        default:
          return assertNever(reviewOutcome);
      }
      let cachedState: ProjectedState | undefined;
      try {
        cachedState = await this.refreshProjectionCache();
      } catch (error) {
        this.options.logger?.warn(
          "observation-handler: projection cache refresh failed during PostToolUse, continuing gate evaluation",
          error,
        );
      }
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

  private async appendReviewPendingLifecycle(
    event: PostToolUseEvent,
    shardId: ShardId,
    taskId: string | undefined,
  ): Promise<void> {
    const binding =
      event.callId === undefined
        ? undefined
        : this.options.sessionStateProvider.getTaskCallBinding(event.callId);
    const ref = binding?.taskExecutionRef;
    if (ref === undefined || ref.taskId !== taskId) return;
    const dependencies: LifecycleNotificationDependencies = {
      onReviewPendingCommitted: this.reviewPendingCommittedHandler,
      recordAdvisory: (advisory, cause) => this.appendLifecycleAdvisory(advisory, cause),
    };
    const appendRecord: LifecycleRecordAppender = async (record) => {
      const sequence = await this.options.logStore.append(shardId, {
        ...record,
        agentId: shardId.agentId,
        sessionId: shardId.sessionId,
        writerId: shardId.writerId,
        taskId,
      });
      this.scheduleProjectionRefresh();
      return sequence;
    };
    const workerResult = await recordWorkerReportedAndEvidence({
      parentSessionId: event.sessionId,
      taskExecutionRef: ref,
      appendRecord,
    });
    if (workerResult.kind !== "committed") return;
    await requestCurrentTaskReview({
      parentSessionId: event.sessionId,
      taskExecutionRef: ref,
      appendRecord,
      dependencies,
    });
  }

  private async appendInitialImplementationLifecycle(
    event: PreToolUseEvent,
    taskExecutionRef: TaskExecutionRef,
    state: TaskProgressState = "authorized",
  ): Promise<void> {
    const agentId = this.options.sessionStateProvider.getAgentId(event.sessionId);
    const shardId: ShardId = {
      agentId,
      sessionId: event.sessionId,
      writerId: this.options.writerId,
    };
    const appendRecord: LifecycleRecordAppender = async (record) =>
      this.options.logStore.append(shardId, {
        ...record,
        agentId,
        sessionId: event.sessionId,
        writerId: this.options.writerId,
        taskId: taskExecutionRef.taskId,
      });
    if (state === "rework_required") {
      await appendTaskLifecycleTransition(
        {
          agentId,
          sessionId: event.sessionId,
          writerId: this.options.writerId,
          parentSessionId: event.sessionId,
          taskExecutionRef,
          from: "rework_required",
          to: "in_progress",
          reason: "implementation_rework_started",
        },
        appendRecord,
      );
      return;
    }
    const authorized = await appendTaskLifecycleTransition(
      {
        agentId,
        sessionId: event.sessionId,
        writerId: this.options.writerId,
        parentSessionId: event.sessionId,
        taskExecutionRef,
        from: "pending",
        to: "authorized",
        reason: "implementation_started",
      },
      appendRecord,
    );
    if (authorized.kind === "failed") return;
    await appendTaskLifecycleTransition(
      {
        agentId,
        sessionId: event.sessionId,
        writerId: this.options.writerId,
        parentSessionId: event.sessionId,
        taskExecutionRef,
        from: "authorized",
        to: "in_progress",
        reason: "implementation_started",
      },
      appendRecord,
    );
  }

  private async appendLifecycleAdvisory(advisory: string, _cause?: unknown): Promise<void> {
    const agentId: ObservationAgentId = "system";
    const sessionId = "lifecycle";
    await this.options.logStore.append(
      { agentId, sessionId, writerId: this.options.writerId },
      buildSessionErrorRecord({
        envelope: {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          agentId,
          sessionId,
          writerId: this.options.writerId,
          recordType: "observation",
        },
        errorKind: "lifecycle_advisory",
        message: advisory,
      }),
    );
  }

  private async appendTaskSummaryDeclaredEvidence(
    shardId: ShardId,
    input: ToolExecutedRecordInput,
  ): Promise<boolean> {
    let summaryClaims: readonly DeclaredClaim[] = [];
    if (input.envelope.taskId !== undefined) {
      try {
        summaryClaims = extractTaskSummaryClaims(input.callId, input.toolOutput.output ?? "");
      } catch (error) {
        this.options.logger?.warn(
          "observation-handler: task summary claim extraction failed",
          error,
        );
      }
    }
    await this.options.logStore.append(
      shardId,
      buildToolExecutedRecord({ ...input, summaryClaims }),
    );
    return true;
  }

  private scheduleProjectionRefresh(): void {
    this.projectionRefresh = this.projectionRefresh
      .catch(() => {})
      .then(async () => {
        await this.refreshProjectionCache();
        this.messageRoleBuffer.releaseFinalizedAfterProjectionFlush();
      })
      .catch((error) => {
        this.options.logger?.warn("observation-handler projection cache refresh failed", error);
      });
  }

  private async refreshProjectionCache(): Promise<ProjectedState | undefined> {
    if (this.options.projectionCache === undefined) return undefined;
    const events = await this.options.logStore.readAll();
    if (this.options.logStore.getLastReadIntegrity().hasIntegrityViolation) {
      this.options.logger?.warn(
        "observation-handler projection cache log integrity violation, rebuilding",
        new Error("log integrity violation"),
      );
    }
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
    isCompleteSnapshot = false,
  ): Promise<ReviewObservationOutcome> {
    const deliveryKey = JSON.stringify([
      callId,
      hashString(toolResult),
      isCompleteSnapshot === true,
    ]);
    if (this.reviewDeliveriesBySession.get(sessionId)?.has(deliveryKey) === true) {
      return { kind: "not_review" };
    }

    try {
      const items: readonly ReviewItem[] = this.reviewRejectionDetector.detectMultiple(
        toolResult,
        metadata,
        this.options.workspaceRoot ?? process.cwd(),
      );
      if (items.length === 0 && !isCompleteSnapshot) return { kind: "not_review" };

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

      const sessionDeliveries = this.reviewDeliveriesBySession.get(sessionId) ?? new Set<string>();
      sessionDeliveries.add(deliveryKey);
      this.reviewDeliveriesBySession.set(sessionId, sessionDeliveries);
      return items.length > 0 ? { kind: "findings" } : { kind: "clear_snapshot" };
    } catch (error) {
      this.options.logger?.warn("observation-handler: review_observed generation failed", error);
      return { kind: "failed" };
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
      if (this.options.gateLoader === undefined || taskId === undefined) return PROCEED;
      const state = await getState();
      const ref = Array.from(state.lifecycle.currentTaskExecutionRefs.values()).find(
        (candidate) => candidate.taskId === taskId,
      );
      if (ref === undefined) return PROCEED;
      const result = await this.gateEvaluator.evaluateGatePendingAttempt({
        scope: "task",
        trigger,
        parentSessionId: sessionId,
        taskExecutionRef: ref,
        agentId,
        sessionId,
        writerId: this.options.writerId,
      });
      if (result.kind !== "decided" || result.decision.verdict === "PASS") return PROCEED;
      return {
        action: "inject",
        injectedContext: formatGateAdvisoryMessage(result.decision),
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

function isReviewObservationTool(toolName: string): boolean {
  return toolName === "task" || toolName === "code_review";
}

function readTaskExecutionRef(value: unknown): TaskExecutionRef | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("authorizationId" in value) || !("taskId" in value) || !("attemptId" in value))
    return undefined;
  const candidate = value as { authorizationId?: unknown; taskId?: unknown; attemptId?: unknown };
  if (
    typeof candidate.authorizationId !== "string" ||
    typeof candidate.taskId !== "string" ||
    typeof candidate.attemptId !== "string"
  )
    return undefined;
  return {
    authorizationId: candidate.authorizationId,
    taskId: candidate.taskId,
    attemptId: candidate.attemptId,
  };
}
