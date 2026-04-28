import type { Plugin } from "@opencode-ai/plugin";
import { OpenCodeAdapter, type OpenCodePluginInit } from "./runtime/opencode-adapter";

/**
 * DEBUG=justice:* または DEBUG=justice:trigger 等が設定されている場合に
 * デバッグログを有効化するためのユーティリティ。
 */
function isDebugEnabled(): boolean {
  try {
    const debug = process.env.DEBUG ?? "";
    return /\bjustice(?::\*|:[a-z]+)?\b/.test(debug);
  } catch {
    return false;
  }
}

function debugLog(message: string, ...args: unknown[]): void {
  if (isDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.warn(`[Justice:debug] ${message}`, ...args);
  }
}

export const OpenCodePlugin: Plugin = async (init) => {
  const adapter = new OpenCodeAdapter(init as unknown as OpenCodePluginInit);

  debugLog("Plugin factory invoked, adapter created.");

  return {
    event: async (input): Promise<void> => {
      await adapter.onEvent(input as {
        event: { type: string; properties?: Record<string, unknown> };
      });
    },
    "tool.execute.before": async (input, output): Promise<void> => {
      const justiceInstance = adapter.getJustice();
      if (!justiceInstance && !adapter.isNoOp()) {
        debugLog(
          "Justice: Prompt ignored by TriggerDetector (Justice not initialized or no delegation intent found).",
        );
      }
      await adapter.onToolExecuteBefore(
        input as { tool: string; sessionID: string; callID: string },
        output as { args: Record<string, unknown> },
      );
    },
    "tool.execute.after": async (input, output): Promise<void> => {
      await adapter.onToolExecuteAfter(
        input as {
          tool: string;
          sessionID: string;
          callID: string;
          args: Record<string, unknown>;
        },
        output as { output: string; metadata?: Record<string, unknown> },
      );
    },
    "experimental.session.compacting": async (input, output): Promise<void> => {
      await adapter.onSessionCompacting(
        input as { sessionID: string },
        output as { context?: string[]; prompt?: string },
      );
    },
  };
};

/** テスト用にエクスポート */
export { isDebugEnabled, debugLog };

export default OpenCodePlugin;
