import type { Plugin } from "@opencode-ai/plugin";
import { OpenCodeAdapter, type OpenCodePluginInit } from "./runtime/opencode-adapter";

/**
 * OpenCode Plugin Entrypoint for Justice
 *
 * This file provides the official entrypoint for the OpenCode plugin environment.
 * It uses OpenCodeAdapter to bridge OpenCode hooks to JusticePlugin logic.
 */
export const OpenCodePlugin: Plugin = async (init) => {
  const adapter = new OpenCodeAdapter(init as unknown as OpenCodePluginInit);

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

/**
 * Legacy/Alternative hook handler for backward compatibility or simple event routing.
 * (Used by some early integrations)
 */
export default async function handleHook(_event: any): Promise<any> {
  // Note: This is a simplified wrapper. The primary integration should use OpenCodePlugin.
  // We'll keep this as a fail-safe that uses a one-off adapter if needed,
  // but recommended path is through the Plugin-type OpenCodePlugin.
  console.warn("[JUSTICE] handleHook called directly. Use OpenCodePlugin for full adapter features.");
  return { action: "proceed" };
}
