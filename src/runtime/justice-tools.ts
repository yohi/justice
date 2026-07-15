// eslint-disable-next-line no-restricted-imports -- Runtime tool definitions are an approved OpenCode API boundary.
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { project, toSerializableProjectedState } from "../core/v2/state-projection";
import type { OpenCodeAdapter } from "./opencode-adapter";

function formatError(reason: string): string {
  return JSON.stringify({ status: "ERROR", reason }, null, 2);
}

export function defineJusticeStatusTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "Justice の現在の投影状態を表示します",
    args: {},
    execute: async (_args, _context) => {
      try {
        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return formatError("Justice not initialized");

        const observationHandler = justice.getObservationHandler();
        const events = await observationHandler.getLogStore().readAll();
        const state = project(events, new Date().toISOString());
        await observationHandler.getProjectionCache()?.write(state).catch(() => {});
        return JSON.stringify(toSerializableProjectedState(state), null, 2);
      } catch (error: unknown) {
        return formatError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
