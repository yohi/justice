import type { Plugin } from "@opencode-ai/plugin";
import { OpenCodeAdapter, type OpenCodePluginInit } from "./runtime/opencode-adapter";
import { debugLog } from "./runtime/debug";

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
      await adapter.onToolExecuteBefore(
        input as { tool: string; sessionID: string; callID: string },
        output as { args: Record<string, unknown> },
      );

      const justiceInstance = adapter.getJustice();
      if (!justiceInstance && !adapter.isNoOp()) {
        debugLog(
          "Justice: Prompt ignored by TriggerDetector (Justice not initialized or no delegation intent found).",
        );
      }
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

export default OpenCodePlugin;
