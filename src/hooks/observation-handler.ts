import type { HookResponse, PostToolUseEvent, PreToolUseEvent } from "../core/types";
import type { ObservationMessagePayload } from "../core/v2/message-payload";

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
  async handlePreToolUse(_event: PreToolUseEvent): Promise<HookResponse> {
    return PROCEED;
  }

  async handlePostToolUse(_event: PostToolUseEvent): Promise<HookResponse> {
    return PROCEED;
  }

  async handleMessage(
    _sessionId: string,
    _payload: ObservationMessagePayload,
  ): Promise<HookResponse> {
    return PROCEED;
  }
}
