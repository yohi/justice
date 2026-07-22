import { AGENT_IDS } from "./agent-router";
import type { AgentId, ObservationAgentId } from "./types";

/**
 * SessionStateProvider:
 *   `sessionId` から Justice `AgentId` へのマッピングと、`callId` キーの task 窓を管理する。
 *
 *   - 純粋ロジック層: `@opencode-ai/*` を import しない (FF-001)。core モジュール
 *     (`agent-router` の `AGENT_IDS`) の再利用は許容。
 *   - 内部の可変状態 (Map) は `WisdomStore` の先例に倣い許容。公開 API では
 *     解決済みの不変値のみを返す。
 *
 *   name → AgentId 写像: `agentName` を小文字化し、`AGENT_IDS` に含まれれば
 *   その `AgentId`、そうでなければ `"unknown"`。マッピング未登録のセッションも
 *   `"unknown"` を返す。
 *
 *   task 窓 (spec §5.8 / D74): `callId` をキーとする session-owned map
 *   (値 = `taskId`)。PreToolUse 時に開き、対応する PostToolUse または session
 *   removal 時に閉じる。セッション単位の単一 active taskId 方式は採用しない。
 */
export class SessionStateProvider {
  private readonly sessionAgentIds = new Map<string, ObservationAgentId>();
  private readonly activeTaskWindows = new Map<
    string,
    { readonly sessionId: string; readonly taskId: string; readonly generation: number }
  >();
  private readonly sessionGenerations = new Map<string, number>();
  private nextSessionGeneration = 0;

  /**
   * Records an `AgentMapped` payload, resolving `agentName` → `AgentId` internally.
   * Unmappable names are stored as `"unknown"`.
   */
  setAgentMapping(sessionId: string, agentName: string): void {
    this.sessionAgentIds.set(sessionId, SessionStateProvider.resolveAgentId(agentName));
    this.ensureSession(sessionId);
  }

  /**
   * Returns the mapped `AgentId` for the session, or `"unknown"` if the session
   * has no mapping OR the mapped name was unmappable.
   */
  getAgentId(sessionId: string): ObservationAgentId {
    return this.sessionAgentIds.get(sessionId) ?? "unknown";
  }

  /**
   * Removes the session mapping and generation for `sessionId`. Call this when a
   * session ends. Subsequent `setActiveTaskWindow` calls with this `sessionId` will
   * recreate the session with a new generation via `ensureSession`, even before
   * `setAgentMapping` runs again. Existing task windows for the session are closed.
   */
  removeSession(sessionId: string): void {
    this.sessionAgentIds.delete(sessionId);
    this.sessionGenerations.delete(sessionId);
    for (const [callId, window] of this.activeTaskWindows) {
      if (window.sessionId === sessionId) this.activeTaskWindows.delete(callId);
    }
  }

  /**
   * Reads the `taskId` bound to the `callId` task window, or `undefined` if no
   * window is open for that `callId`.
   *
   * If the window was tagged with a generation (because `setActiveTaskWindow`
   * was called with a `sessionId` that had an active generation at the time),
   * the current generation for that session is checked.  If the session has
   * been removed (generation deleted), the window is considered stale and is
   * cleaned up.
   */
  getActiveTaskId(callId: string): string | undefined {
    const window = this.activeTaskWindows.get(callId);
    if (!window) return undefined;
    if (window.generation !== undefined) {
      const currentGen = this.sessionGenerations.get(window.sessionId ?? "");
      if (currentGen === undefined || currentGen !== window.generation) {
        this.activeTaskWindows.delete(callId);
        return undefined;
      }
    }
    return window.taskId;
  }

  /**
   * Opens (or overwrites) the task window for `callId` (PreToolUse).
   *
   * Every window is explicitly owned by its session, including windows opened
   * before an agent mapping arrives. This makes session cleanup complete rather
   * than relying on a later mapping pass to tag the window.
   */
  setActiveTaskWindow(callId: string, taskId: string, sessionId: string): void {
    this.activeTaskWindows.set(callId, {
      taskId,
      sessionId,
      generation: this.ensureSession(sessionId),
    });
  }

  /**
   * Returns the current generation for `sessionId`, or `undefined` if the
   * session has been removed (or was never mapped).
   */
  getSessionGeneration(sessionId: string): number | undefined {
    return this.sessionGenerations.get(sessionId);
  }

  /**
   * Closes the task window for `callId` (PostToolUse). Closing a window that was
   * never opened is a no-op.
   */
  closeActiveTaskWindow(callId: string): void {
    this.activeTaskWindows.delete(callId);
  }

  /**
   * name → AgentId mapping: lowercase `agentName`; if it is one of `AGENT_IDS`
   * return that `AgentId`, otherwise `"unknown"`.
   */
  static resolveAgentId(agentName: string): ObservationAgentId {
    const lower = agentName.toLowerCase();
    if ((AGENT_IDS as readonly string[]).includes(lower)) {
      return lower as AgentId;
    }
    return "unknown";
  }

  private ensureSession(sessionId: string): number {
    const existing = this.sessionGenerations.get(sessionId);
    if (existing !== undefined) return existing;
    const generation = ++this.nextSessionGeneration;
    this.sessionGenerations.set(sessionId, generation);
    return generation;
  }
}
