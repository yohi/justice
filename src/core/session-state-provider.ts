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
 *   task 窓 (spec §5.8 / D74): `callId` をキーとする `Map<string, string>`
 *   (値 = `taskId`)。`setActiveTaskWindow` で PreToolUse 時に開き、
 *   `closeActiveTaskWindow` で対応する PostToolUse 時に閉じる。セッション単位の
 *   単一 active taskId 方式は採用しない。
 */
export class SessionStateProvider {
  private readonly sessionAgentIds = new Map<string, ObservationAgentId>();
  private readonly activeTaskWindows = new Map<string, { readonly sessionId?: string; readonly taskId: string; readonly generation?: number }>();
  private readonly sessionGenerations = new Map<string, number>();

  /**
   * Records an `AgentMapped` payload, resolving `agentName` → `AgentId` internally.
   * Unmappable names are stored as `"unknown"`.
   */
  setAgentMapping(sessionId: string, agentName: string): void {
    this.sessionAgentIds.set(sessionId, SessionStateProvider.resolveAgentId(agentName));
    if (!this.sessionGenerations.has(sessionId)) {
      this.sessionGenerations.set(sessionId, 0);
    }
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
   * session ends. Any subsequent `setActiveTaskWindow` with this `sessionId` will
   * be ignored until `setAgentMapping` re-establishes the session.
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
   * When `sessionId` is provided, the window is only created if the session has
   * an active generation (i.e. `setAgentMapping` was called and `removeSession`
   * has not yet been called).  This prevents stale windows from being created
   * for sessions that have already ended.
   *
   * When `sessionId` is omitted, a generation-less window is created for
   * backwards compatibility with callers that do not track session lifecycles.
   */
  setActiveTaskWindow(callId: string, taskId: string, sessionId?: string): void {
    if (sessionId !== undefined) {
      const generation = this.sessionGenerations.get(sessionId);
      if (generation === undefined) {
        return; // Session has been removed or never mapped
      }
      this.activeTaskWindows.set(callId, { taskId, sessionId, generation });
    } else {
      this.activeTaskWindows.set(callId, { taskId });
    }
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
  private static resolveAgentId(agentName: string): ObservationAgentId {
    const lower = agentName.toLowerCase();
    if ((AGENT_IDS as readonly string[]).includes(lower)) {
      return lower as AgentId;
    }
    return "unknown";
  }
}
