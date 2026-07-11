import type { HookResponse, PostToolUseEvent, PreToolUseEvent } from "../core/types";
import type { ObservationMessagePayload } from "../core/v2/message-payload";
import { buildMessageRecord } from "../core/v2/record-builder";
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
  private readonly persistedMessageIDs = new Set<string>();

  constructor(
    private readonly options: {
      readonly logStore: ObservationLogStore;
      readonly sessionStateProvider: SessionStateProvider;
      readonly writerId: string;
      readonly logger?: { warn(message: string, error: unknown): void };
    },
  ) {}

  async handleMessage(
    sessionId: string,
    payload: ObservationMessagePayload,
  ): Promise<HookResponse> {
    this.messageRoleBuffer.update(sessionId, payload);

    const messageKey = `${sessionId}:${payload.messageID}`;
    if (this.persistedMessageIDs.has(messageKey)) {
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
      this.persistedMessageIDs.add(messageKey);
    } catch (error) {
      this.options.logger?.warn("observation-handler message failed", error);
    } finally {
      this.messageRoleBuffer.gc(MESSAGE_ROLE_BUFFER_MAX_AGE_MS, MESSAGE_ROLE_BUFFER_MAX_ENTRIES);
    }
    return PROCEED;
  }

  async handlePreToolUse(_event: PreToolUseEvent): Promise<HookResponse> {
    return PROCEED;
  }

  async handlePostToolUse(_event: PostToolUseEvent): Promise<HookResponse> {
    return PROCEED;
  }
}
