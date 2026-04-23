import type { Plugin } from "@opencode-ai/plugin";
import {
  OpenCodeAdapter,
  type OpenCodePluginInit,
  type OpenCodeEvent,
} from "./runtime/opencode-adapter";

/**
 * OpenCode Plugin Entrypoint for Justice
 *
 * This file provides the official entrypoint for the OpenCode plugin environment.
 * It uses OpenCodeAdapter to bridge OpenCode hooks to JusticePlugin logic.
 */
export const OpenCodePlugin: Plugin = async (init) => {
  const adapter = new OpenCodeAdapter(init as OpenCodePluginInit);

  return {
    event: async (input: OpenCodeEvent): Promise<void> => {
      await adapter.onEvent(input);
    },
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      await adapter.onToolExecuteBefore(input, output);
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { title: string; output: string; metadata: Record<string, unknown> },
    ): Promise<void> => {
      await adapter.onToolExecuteAfter(input, output);
    },
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ): Promise<void> => {
      await adapter.onSessionCompacting(input, output);
    },
  };
};

export {
  OpenCodeAdapter,
  type OpenCodePluginInit,
  type OpenCodeLogEntry,
} from "./runtime/opencode-adapter";

/**
 * Type guard to check if the provided init object satisfies OpenCodePluginInit requirements.
 */
function isOpenCodePluginInit(init?: Partial<OpenCodePluginInit>): init is OpenCodePluginInit {
  return (
    !!init?.client &&
    !!init?.serverUrl &&
    !!init?.$ &&
    !!init?.project &&
    typeof init.project === "object" &&
    !!(init.directory || init.worktree || init.project.root)
  );
}

/**
 * Legacy/Alternative hook handler for backward compatibility or simple event routing.
 * (Used by some early integrations)
 */
export async function handleHook(
  event: Parameters<NonNullable<Awaited<ReturnType<typeof OpenCodePlugin>>["event"]>>[0],
  init?: Partial<OpenCodePluginInit>,
): Promise<void> {
  if (!isOpenCodePluginInit(init)) {
    throw new Error(
      "[JUSTICE] handleHook initialization failed: Missing required fields in init parameter (client, directory/worktree, serverUrl, $, and a proper project shape). Please use OpenCodePlugin instead or provide a valid init.",
    );
  }

  const pluginInstance = await OpenCodePlugin(init);

  if (pluginInstance && typeof pluginInstance.event === "function") {
    await pluginInstance.event(event);
  } else {
    throw new Error(
      "[JUSTICE] handleHook is unsupported: plugin instance cannot be created or does not expose an event handler. Please use OpenCodePlugin instead.",
    );
  }
}

export default OpenCodePlugin;
