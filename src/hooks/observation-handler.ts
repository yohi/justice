import { mergePostToolUseResponses } from "../core/hook-response-merger";
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
  buildSkillInvokedRecord,
  buildToolExecutedRecord,
  type ToolExecutedRecordInput,
} from "../core/v2/record-builder";
import { detectSkillInvoked } from "../core/v2/skill-invoked-detector";
import { buildReflectionEvent } from "../core/v2/reflection-event";
import { redactAbsolutePaths, redactForPersistence } from "../core/v2/redaction";
import { project, type ProjectedState } from "../core/v2/state-projection";
import { extractTaskSummaryClaims } from "../core/v2/task-summary-claim-extractor";
import type { DeclaredClaim } from "../core/v2/declared-claim-extractor";
import type { SessionStateProvider } from "../core/session-state-provider";
import { MessageRoleBuffer } from "../runtime/message-role-buffer";
import type { ObservationLogStore } from "../runtime/observation-log-store";

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
  private readonly persistedMessageIDs = new Map<string, Set<string>>();

  constructor(
    private readonly options: {
      readonly logStore: ObservationLogStore;
      readonly sessionStateProvider: SessionStateProvider;
      readonly projectionCache?: { readonly write: (state: ProjectedState) => Promise<void> };
      readonly writerId: string;
      readonly workspaceRoot?: string;
      readonly logger?: { warn(message: string, error: unknown): void };
    },
  ) {}

  async handleSessionError(error: {
    readonly message: string;
    readonly kind?: string;
    readonly agentId: ObservationAgentId;
    readonly sessionId: string;
  }): Promise<HookResponse> {
    try {
      const record = {
        schemaVersion: 1 as const,
        timestamp: new Date().toISOString(),
        agentId: error.agentId,
        sessionId: error.sessionId,
        writerId: this.options.writerId,
        recordType: "observation" as const,
        kind: "session_error" as const,
        errorKind: error.kind ?? "unknown",
        message: redactForPersistence(redactAbsolutePaths(error.message)),
      };

      await this.options.logStore.append(
        { agentId: error.agentId, sessionId: error.sessionId, writerId: this.options.writerId },
        record,
      );
    } catch (err) {
      this.options.logger?.warn("observation-handler: session error observation failed, degrading to PROCEED", err);
    }

    return PROCEED;
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
    } catch (err) {
      this.options.logger?.warn("observation-handler: emitReflectionEvent failed, degrading gracefully", err);
    }
  }

  async handleMessage(
    sessionId: string,
    payload: ObservationMessagePayload,
  ): Promise<HookResponse> {
    this.messageRoleBuffer.update(sessionId, payload);

    const persistedIDs = this.persistedMessageIDs.get(sessionId);
    if (persistedIDs?.has(payload.messageID)) {
      try {
        this.messageRoleBuffer.gc(MESSAGE_ROLE_BUFFER_MAX_AGE_MS, MESSAGE_ROLE_BUFFER_MAX_ENTRIES);
      } catch (error) {
        this.options.logger?.warn("observation-handler gc failed", error);
      }
      return PROCEED;
    }

    try {
      const text = this.messageRoleBuffer.getFinalizedAssistantText(sessionId, payload.messageID);
      if (text === undefined || text.length === 0) {
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
      const sessionPersistedIDs = this.persistedMessageIDs.get(sessionId) ?? new Set<string>();
      sessionPersistedIDs.add(payload.messageID);
      this.persistedMessageIDs.set(sessionId, sessionPersistedIDs);
    } catch (error) {
      this.options.logger?.warn("observation-handler message failed", error);
    } finally {
      this.messageRoleBuffer.gc(MESSAGE_ROLE_BUFFER_MAX_AGE_MS, MESSAGE_ROLE_BUFFER_MAX_ENTRIES);
    }
    return PROCEED;
  }

  destroySession(sessionId: string): void {
    this.persistedMessageIDs.delete(sessionId);
    this.messageRoleBuffer.removeSession(sessionId);
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

      if (this.options.projectionCache !== undefined) {
        const events = await this.options.logStore.readAll();
        const projectedState = project(events, new Date().toISOString());
        try {
          await this.options.projectionCache.write(projectedState);
        } catch (error) {
          this.options.logger?.warn("observation-handler projection cache write failed", error);
        }
      }

      let response = PROCEED;
      if (event.payload.toolName === "task" && taskId !== undefined) {
        response = mergePostToolUseResponses([
          response,
          await this.evaluateGateIfTriggered(
            "task_complete",
            taskId,
            callId,
            agentId,
            event.sessionId,
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

  private async appendReviewObservationsIfDetected(
    _shardId: ShardId,
    _taskId: string | undefined,
    _sessionId: string,
    _callId: string,
    _toolName: string,
    _toolResult: string,
    _metadata?: Readonly<Record<string, unknown>>,
  ): Promise<void> {}

  private async evaluateGateIfTriggered(
    _trigger: "task_complete" | "tool_observed",
    _taskId: string | undefined,
    _callId: string | undefined,
    _agentId: ObservationAgentId,
    _sessionId: string,
  ): Promise<HookResponse> {
    return PROCEED;
  }
}
