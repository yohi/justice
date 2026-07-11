import type {
  HookResponse,
  PostToolUseEvent,
  PreToolUseEvent,
} from "../core/types";
import type { ObservationMessagePayload } from "../core/v2/message-payload";
import { buildMessageRecord } from "../core/v2/record-builder";
import type { SessionStateProvider } from "../core/session-state-provider";
import { MessageRoleBuffer } from "../runtime/message-role-buffer";
import type { ObservationLogStore } from "../runtime/observation-log-store";

const PROCEED: HookResponse = { action: "proceed" };

/**
 * ObservationHandler observes EVERY tool call and message part for the v2
 * observation pipeline (declared-claim extraction, evidence recording).
 *
 * This is a minimal stub introduced in Task 3.3: it always PROCEEDs so that the
 * JusticePlugin routing guard can run it unconditionally without changing
 * behaviour. Real observation logic and its dependencies are wired in Task 4.x.
 *
 * Located in `src/hooks/` so it MAY depend on `src/core/` types; it is kept
 * dependency-free for now.
 */
export class ObservationHandler {
  private readonly messageRoleBuffer = new MessageRoleBuffer();

  constructor(
    private readonly options: {
      readonly logStore: ObservationLogStore;
      readonly sessionStateProvider: SessionStateProvider;
      readonly writerId: string;
      readonly logger?: { warn(message: string, error: unknown): void };
    },
  ) {}

  async handlePreToolUse(_event: PreToolUseEvent): Promise<HookResponse> {
    return PROCEED;
  }

  async handlePostToolUse(_event: PostToolUseEvent): Promise<HookResponse> {
    return PROCEED;
  }

  async handleMessage(
    sessionId: string,
    payload: ObservationMessagePayload,
  ): Promise<HookResponse> {
    try {
      this.messageRoleBuffer.update(sessionId, payload);

      const text = this.messageRoleBuffer.getFinalizedAssistantText(sessionId, payload.messageID);
      if (text === undefined || text.length === 0) return PROCEED;

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
      await this.options.logStore.append({ agentId, sessionId, writerId: this.options.writerId }, record);
    } catch (error) {
      this.options.logger?.warn("observation-handler message failed", error);
    }
    return PROCEED;
  }
}
