import type { Plugin } from "@opencode-ai/plugin";
import { validatePluginOptions } from "./core/plugin-options";
import {
  OpenCodeAdapter,
  type OpenCodeAdapterOptions,
  type OpenCodePluginInit,
} from "./runtime/opencode-adapter";
import { debugLog } from "./runtime/debug";

export const OpenCodePlugin: Plugin = async (init, pluginOptions) => {
  const { options, warnings } = validatePluginOptions(pluginOptions);
  // 警告の出力は runtime 境界の責務（core は @opencode-ai/* を import できない）。
  for (const message of warnings) {
    try {
      await (init as unknown as OpenCodePluginInit).client.app.log({
        level: "warn",
        service: "justice",
        message,
      });
    } catch {
      /* fail-open: 警告出力の失敗でプラグインロードを壊さない */
    }
  }
  // core の返り値を runtime 側で OpenCodeAdapterOptions へ写す（不変条件 1 を維持）。
  const adapterOptions: OpenCodeAdapterOptions = {
    ...(options.enableAdvisoryOutputAppend === undefined
      ? {}
      : { enableAdvisoryOutputAppend: options.enableAdvisoryOutputAppend }),
  };
  const adapter =
    (init as unknown as { __justiceTestAdapter?: OpenCodeAdapter }).__justiceTestAdapter ??
    new OpenCodeAdapter(init as unknown as OpenCodePluginInit, adapterOptions);

  debugLog("Plugin factory invoked, adapter created.");
  return {
    tool: adapter.getTools(),
    event: async (input): Promise<void> => {
      await adapter.onEvent(
        input as {
          event: { type: string; properties?: Record<string, unknown> };
        },
      );
    },
    "chat.message": async (input, output): Promise<void> => {
      await adapter.onChatMessage(input, output);
    },
    "chat.params": async (input): Promise<void> => {
      await adapter.onChatParams(input);
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
    "command.execute.before": async (input, output): Promise<void> => {
      await adapter.onCommandExecuteBefore(input, output);
    },
    "experimental.session.compacting": async (input, output): Promise<void> => {
      await adapter.onSessionCompacting(
        input as { sessionID: string },
        output as { context?: string[]; prompt?: string },
      );
    },
    "experimental.text.complete": async (input, output): Promise<void> => {
      await adapter.onTextComplete(input, output);
    },
  };
};

export default OpenCodePlugin;
