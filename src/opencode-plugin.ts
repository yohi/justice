import { tool, type Plugin } from "@opencode-ai/plugin";
import { Effect } from "effect";
import { OpenCodeAdapter, type OpenCodePluginInit } from "./runtime/opencode-adapter";
import { debugLog } from "./runtime/debug";
import { executeJusticeReviewTool, type JusticeReviewToolResult } from "./runtime/justice-tools";
import { NodeFileSystem } from "./runtime/node-file-system";
import { ObservationLogStore } from "./runtime/observation-log-store";

function createReviewLogReader(worktree: string | undefined): {
  readonly readAll: () => Promise<
    readonly import("./core/v2/observation-model").PersistedLogRecord[]
  >;
} {
  if (worktree === undefined || worktree.length === 0) {
    return {
      readAll: async (): Promise<never> => {
        throw new Error("Justice review tool requires a workspace.");
      },
    };
  }

  const fileSystem = new NodeFileSystem(worktree);
  return new ObservationLogStore(fileSystem, fileSystem, "w-justice-review-reader");
}

export const OpenCodePlugin: Plugin = async (init) => {
  const adapter =
    (init as unknown as { __justiceTestAdapter?: OpenCodeAdapter }).__justiceTestAdapter ??
    new OpenCodeAdapter(init as unknown as OpenCodePluginInit);

  debugLog("Plugin factory invoked, adapter created.");
  const reviewStore = createReviewLogReader(
    typeof init.worktree === "string"
      ? init.worktree
      : typeof init.directory === "string"
        ? init.directory
        : undefined,
  );

  return {
    tool: {
      ...adapter.getTools(),
      justice_review: tool({
        description:
          "Displays the current Justice review summary, or resolves selected open items after explicit approval.",
        args: {
          scope: tool.schema.string().optional(),
          resolve: tool.schema
            .object({
              itemKeys: tool.schema.array(tool.schema.string()),
              artifactRef: tool.schema.string(),
            })
            .optional(),
        },
        async execute(args, context): Promise<JusticeReviewToolResult> {
          return await executeJusticeReviewTool({
            logReader: reviewStore,
            args,
            requestApproval: async (approval): Promise<void> => {
              await Effect.runPromise(context.ask(approval));
            },
          });
        },
      }),
    },
    event: async (input): Promise<void> => {
      await adapter.onEvent(
        input as {
          event: { type: string; properties?: Record<string, unknown> };
        },
      );
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
    "experimental.text.complete": async (input, output): Promise<void> => {
      await adapter.onTextComplete(input, output);
    },
  };
};

export default OpenCodePlugin;
