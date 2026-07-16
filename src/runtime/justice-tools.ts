// eslint-disable-next-line no-restricted-imports -- Runtime tool definitions are an approved OpenCode API boundary.
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { SessionStateProvider } from "../core/session-state-provider";
import type { GateContext } from "../core/v2/gate-context";
import { collectReviewScopes } from "../core/v2/review-scope";
import { evaluate } from "../core/v2/rule-evaluation-engine";
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
        await observationHandler
          .getProjectionCache()
          ?.write(state)
          .catch(() => {});
        return JSON.stringify(toSerializableProjectedState(state), null, 2);
      } catch (error: unknown) {
        return formatError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}

export function defineJusticeGateTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "現 event log から gate を dry-run 評価します",
    args: { taskId: tool.schema.string().optional() },
    execute: async ({ taskId }, context) => {
      try {
        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return formatError("Justice not initialized");

        const scopedTaskId = taskId?.length ? taskId : undefined;
        if (scopedTaskId === undefined) {
          return JSON.stringify(
            evaluate([], [], {
              trigger: "task_complete",
              taskId: scopedTaskId,
              agentId: SessionStateProvider.resolveAgentId(context.agent),
              sessionId: context.sessionID,
              reviewScope: [],
            }),
            null,
            2,
          );
        }

        const observationHandler = justice.getObservationHandler();
        const gateLoader = observationHandler.getGateLoader();
        if (gateLoader === undefined) return formatError("Gate loader not configured");

        const events = await observationHandler.getLogStore().readAll();
        const state = project(events, new Date().toISOString());
        const gates = await gateLoader.load();
        const gateContext: GateContext = {
          trigger: "task_complete",
          taskId: scopedTaskId,
          agentId: SessionStateProvider.resolveAgentId(context.agent),
          sessionId: context.sessionID,
          reviewScope: scopedTaskId === undefined ? [] : collectReviewScopes(state, scopedTaskId),
          reviewSummary: state.reviewSummary,
        };
        const evidence =
          scopedTaskId === undefined ? [] : (state.tasks.get(scopedTaskId)?.evidence ?? []);
        return JSON.stringify(evaluate(gates, evidence, gateContext), null, 2);
      } catch (error: unknown) {
        return formatError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}

export function defineJusticeReviewTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "Review Summary Artifact を表示します",
    args: { scope: tool.schema.string().optional() },
    execute: async ({ scope }, _context) => {
      try {
        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return formatError("Justice not initialized");

        const observationHandler = justice.getObservationHandler();
        const events = await observationHandler.getLogStore().readAll();
        const state = project(events, new Date().toISOString());

        if (scope !== undefined) {
          const scopedSummary = state.reviewSummary.byScope.get(scope);
          if (scopedSummary === undefined) {
            return formatError(`Unknown scope: ${scope}`);
          }
          return JSON.stringify(scopedSummary, null, 2);
        }

        return JSON.stringify(
          {
            authority: state.reviewSummary.authority,
            critical: state.reviewSummary.critical,
            major: state.reviewSummary.major,
            minor: state.reviewSummary.minor,
            resolved: state.reviewSummary.resolved,
            open: state.reviewSummary.open,
            byScope: Object.fromEntries(state.reviewSummary.byScope),
          },
          null,
          2,
        );
      } catch (error: unknown) {
        return formatError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
