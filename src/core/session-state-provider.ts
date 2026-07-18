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
  private readonly activeTaskWindows = new Map<string, { readonly sessionId?: string; readonly taskId: string }>();

  /**
   * Records an `AgentMapped` payload, resolving `agentName` → `AgentId` internally.
   * Unmappable names are stored as `"unknown"`.
   */
  setAgentMapping(sessionId: string, agentName: string): void {
    this.sessionAgentIds.set(sessionId, SessionStateProvider.resolveAgentId(agentName));
  }

  /**
   * Returns the mapped `AgentId` for the session, or `"unknown"` if the session
   * has no mapping OR the mapped name was unmappable.
   */
  getAgentId(sessionId: string): ObservationAgentId {
    return this.sessionAgentIds.get(sessionId) ?? "unknown";
  }

  /**
   * Removes the session mapping for `sessionId`. Call this when a session ends
   * to prevent unbounded growth of the internal map.
   */
  removeSession(sessionId: string): void {
    this.sessionAgentIds.delete(sessionId);
    for (const [callId, window] of this.activeTaskWindows) {
      if (window.sessionId === sessionId) this.activeTaskWindows.delete(callId);
    }
  }

  /**
   * Reads the `taskId` bound to the `callId` task window, or `undefined` if no
   * window is open for that `callId`.
   */
  getActiveTaskId(callId: string): string | undefined {
    return this.activeTaskWindows.get(callId)?.taskId;
  }

  /**
   * Opens (or overwrites) the task window for `callId` (PreToolUse).
   */
  setActiveTaskWindow(callId: string, taskId: string, sessionId?: string): void {
    this.activeTaskWindows.set(callId, { taskId, ...(sessionId === undefined ? {} : { sessionId }) });
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
