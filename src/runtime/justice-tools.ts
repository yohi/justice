// eslint-disable-next-line no-restricted-imports -- Runtime tool definitions are an approved OpenCode API boundary.
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { Effect } from "effect";
import { SessionStateProvider } from "../core/session-state-provider";
import { normalizeReviewResolutionArtifact } from "../core/review-resolution-artifact";
import type { ReviewResolutionArtifact } from "../core/types";
import type { GateContext } from "../core/v2/gate-context";
import type { PersistedLogRecord } from "../core/v2/observation-model";
import { collectReviewScopes } from "../core/v2/review-scope";
import { evaluate } from "../core/v2/rule-evaluation-engine";
import { project, toSerializableProjectedState } from "../core/v2/state-projection";
import type { ReviewSummary, ScopeReviewSummary } from "../core/v2/review-types";
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
          .catch((error: unknown) =>
            adapter.log("warn", "[Justice] justice_status projection cache write failed", error),
          );
        return JSON.stringify(toSerializableProjectedState(state), null, 2);
      } catch (error: unknown) {
        return formatError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}

export function defineJusticeGateTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "現 event log から task_complete トリガーの gate を dry-run 評価します",
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

export type JusticeReviewToolArgs = {
  readonly scope?: string;
  readonly resolve?: {
    readonly itemKeys: readonly string[];
    readonly artifactRef: string;
  };
};

export type ReviewApprovalRequest = {
  readonly permission: "justice_review.resolve";
  readonly patterns: string[];
  readonly always: string[];
  readonly metadata: {
    readonly reviewScope: string;
    readonly itemKeys: readonly string[];
    readonly artifactRef: string;
  };
};

export type JusticeReviewToolResult =
  | string
  | {
      readonly output: string;
      readonly metadata: { readonly reviewResolutionArtifact: ReviewResolutionArtifact };
    };

export type JusticeReviewToolInput = {
  readonly logReader: { readonly readAll: () => Promise<readonly PersistedLogRecord[]> };
  readonly args: JusticeReviewToolArgs;
  readonly requestApproval: (approval: ReviewApprovalRequest) => Promise<void>;
};

function serializeReviewSummary(summary: ReviewSummary, scope: string | undefined): string {
  if (scope !== undefined) {
    const scopedSummary = summary.byScope.get(scope);
    return scopedSummary === undefined
      ? formatError(`Unknown review scope: ${scope}`)
      : JSON.stringify(scopedSummary, null, 2);
  }

  return JSON.stringify(
    {
      authority: summary.authority,
      critical: summary.critical,
      major: summary.major,
      minor: summary.minor,
      resolved: summary.resolved,
      open: summary.open,
      byScope: Object.fromEntries(summary.byScope),
    },
    null,
    2,
  );
}

function containsOpenItems(summary: ScopeReviewSummary, itemKeys: readonly string[]): boolean {
  const openItemKeys = new Set(summary.open.map((item) => item.itemKey));
  return itemKeys.every((itemKey) => openItemKeys.has(itemKey));
}

export async function executeJusticeReviewTool(
  input: JusticeReviewToolInput,
): Promise<JusticeReviewToolResult> {
  try {
    const state = project(await input.logReader.readAll(), new Date().toISOString());
    const normalizedScope = input.args.scope?.trim() || undefined;
    if (input.args.resolve === undefined) {
      return serializeReviewSummary(state.reviewSummary, normalizedScope);
    }
    if (normalizedScope === undefined) {
      return formatError(
        "Review resolution requires a non-empty scope. Provide scope when using resolve.",
      );
    }

    const artifact = normalizeReviewResolutionArtifact({
      reviewScope: normalizedScope,
      itemKeys: input.args.resolve.itemKeys,
      artifactRef: input.args.resolve.artifactRef,
    });
    if (artifact === undefined) return formatError("Invalid review resolution request.");

    const scopeSummary = state.reviewSummary.byScope.get(artifact.reviewScope);
    if (scopeSummary === undefined || !containsOpenItems(scopeSummary, artifact.itemKeys)) {
      return formatError("Requested review items are not currently open in the specified scope.");
    }

    try {
      await input.requestApproval({
        permission: "justice_review.resolve",
        patterns: [artifact.reviewScope, ...artifact.itemKeys],
        always: [],
        metadata: {
          reviewScope: artifact.reviewScope,
          itemKeys: artifact.itemKeys,
          artifactRef: artifact.artifactRef,
        },
      });
    } catch {
      return formatError("Review resolution was not approved.");
    }

    return {
      output: JSON.stringify({ status: "OK", reviewResolutionArtifact: artifact }, null, 2),
      metadata: { reviewResolutionArtifact: artifact },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return formatError(`Unable to read the current review state: ${message}`);
  }
}

export function defineJusticeReviewTool(adapter: OpenCodeAdapter): ToolDefinition {
  return tool({
    description: "Review Summary Artifact を表示・解決します",
    args: {
      scope: tool.schema.string().optional(),
      resolve: tool.schema
        .object({
          itemKeys: tool.schema.array(tool.schema.string()),
          artifactRef: tool.schema.string(),
        })
        .optional(),
    },
    execute: async (args, context) => {
      try {
        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return formatError("Justice not initialized");

        const observationHandler = justice.getObservationHandler();
        return await executeJusticeReviewTool({
          logReader: observationHandler.getLogStore(),
          args,
          requestApproval: async (approval): Promise<void> => {
            await Effect.runPromise(
              context.ask(approval) as unknown as Effect.Effect<void>,
            );
          },
        });
      } catch (error: unknown) {
        return formatError(error instanceof Error ? error.message : String(error));
      }
    },
  });
}
