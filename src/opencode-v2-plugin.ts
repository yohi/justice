import type { Plugin } from "@opencode/plugin";
import type { Info as ToolInfo, ToolEditor } from "@opencode/plugin/promise/tool";
import type { JsonSchema } from "effect";
import {
  executeJusticeReviewTool,
  type JusticeReviewToolArgs,
  type JusticeReviewToolResult,
} from "./runtime/justice-tools";
import { OpenCodeAdapter, type OpenCodePluginInit } from "./runtime/opencode-adapter";

/**
 * OpenCode V2 (Promise API, `@opencode/plugin@2.3.2`) entry.
 *
 * Scope (H3 limited TDD): exposes only the single public tool `justice_review`
 * through the V2 `tool` Domain. The existing V1 entry (`src/opencode-plugin.ts`)
 * and `OpenCodeAdapter` are reused unchanged.
 *
 * Intentionally NOT mapped (no certain V2 equivalent in the fixed SDK types):
 * - V1 `event` -> V2 `event.subscribe`: V2 events are `{ type, data, durable }`
 *   with different type names; V1 `message.updated` / `message.part.updated` /
 *   `session.error` have no 1:1 counterpart.
 * - V1 `tool.execute.before/after` -> V2 `tool.hook`: V2 callbacks return void
 *   (no V1 throw-to-cancel contract) and the result shape differs.
 * - V1 `command.execute.before` -> V2 `command.transform`: V2 only adds commands;
 *   there is no pre-execution hook for host commands.
 * - V1 `chat.*`, `experimental.*` -> V2 `session.hook`: different semantics.
 *
 * Importing this module has no side effects; `setup` is only invoked by a host.
 * This entry makes no Host-enforcement claim.
 */

/** The adapter surface used by the V2 entry, taken from the real adapter type. */
export type JusticeV2AdapterPort = Pick<OpenCodeAdapter, "ensureInitialized" | "getJustice" | "log">;

export interface JusticeV2PluginDeps {
  readonly createAdapter?: (init: OpenCodePluginInit) => JusticeV2AdapterPort;
}

const PLUGIN_ID = "justice";
const JUSTICE_REVIEW_TOOL_NAME = "justice_review";
// Must stay identical to the V1 `defineJusticeReviewTool` description.
const JUSTICE_REVIEW_DESCRIPTION = "Review Summary Artifact を表示・解決します";

const JUSTICE_REVIEW_INPUT: JsonSchema.JsonSchema = Object.freeze({
  type: "object",
  properties: {
    scope: { type: "string" },
    resolve: {
      type: "object",
      properties: {
        itemKeys: { type: "array", items: { type: "string" } },
        artifactRef: { type: "string" },
      },
      required: ["itemKeys", "artifactRef"],
    },
  },
});

type ReviewToolResult = Awaited<ReturnType<ToolInfo<JsonSchema.JsonSchema, undefined>["execute"]>>;

function formatError(reason: string): string {
  return JSON.stringify({ status: "ERROR", reason }, null, 2);
}

function errorMessage(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unprintable error";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates V2 tool input (typed `unknown` for a JSON Schema input) into V1 args. */
function parseReviewArgs(input: unknown): JusticeReviewToolArgs | undefined {
  const raw = input === undefined || input === null ? {} : input;
  if (!isRecord(raw)) return undefined;
  const { scope, resolve } = raw;
  if (scope !== undefined && typeof scope !== "string") return undefined;
  if (resolve === undefined) return scope === undefined ? {} : { scope };
  if (!isRecord(resolve)) return undefined;
  const { itemKeys, artifactRef } = resolve;
  if (!Array.isArray(itemKeys) || !itemKeys.every((key) => typeof key === "string")) {
    return undefined;
  }
  if (typeof artifactRef !== "string") return undefined;
  const parsedResolve = { itemKeys: [...(itemKeys as string[])], artifactRef };
  return scope === undefined ? { resolve: parsedResolve } : { scope, resolve: parsedResolve };
}

function toV2Result(result: JusticeReviewToolResult): ReviewToolResult {
  return typeof result === "string"
    ? { content: result }
    : { content: result.output, metadata: result.metadata };
}

/**
 * The V2 ToolContext exposes no approval (`ask`) channel, so review resolution is
 * denied fail-closed: an approval can never be assumed.
 */
async function denyApproval(): Promise<void> {
  throw new Error("approval channel unavailable in the V2 entry");
}

function defineV2JusticeReviewTool(
  adapter: JusticeV2AdapterPort,
): ToolInfo<JsonSchema.JsonSchema, undefined> {
  return {
    name: JUSTICE_REVIEW_TOOL_NAME,
    description: JUSTICE_REVIEW_DESCRIPTION,
    input: JUSTICE_REVIEW_INPUT,
    execute: async (input): Promise<ReviewToolResult> => {
      try {
        const args = parseReviewArgs(input);
        if (args === undefined) return { content: formatError("Invalid justice_review input") };

        await adapter.ensureInitialized();
        const justice = adapter.getJustice();
        if (justice === null) return { content: formatError("Justice not initialized") };

        const result = await executeJusticeReviewTool({
          logReader: justice.getObservationHandler().getLogStore(),
          args,
          requestApproval: denyApproval,
          log: adapter.log.bind(adapter),
        });
        return toV2Result(result);
      } catch (error: unknown) {
        return { content: formatError(errorMessage(error)) };
      }
    },
  };
}

function unavailableShell(): never {
  throw new Error("shell is not available to the Justice V2 entry");
}

function toAdapterInit(context: Plugin.Context): OpenCodePluginInit {
  const directory: unknown = context.location?.directory;
  return {
    project: {},
    // The fixed V2 Context exposes no logging domain; diagnostics are dropped.
    client: { app: { log: (): void => undefined } },
    $: unavailableShell,
    ...(typeof directory === "string" && directory.length > 0 ? { directory } : {}),
  };
}

function defaultCreateAdapter(init: OpenCodePluginInit): JusticeV2AdapterPort {
  return new OpenCodeAdapter(init);
}

export function createJusticeV2Plugin(deps: JusticeV2PluginDeps = {}): Plugin.Plugin {
  const createAdapter = deps.createAdapter ?? defaultCreateAdapter;
  return {
    id: PLUGIN_ID,
    setup: async (context): Promise<Plugin.Cleanup | void> => {
      try {
        const adapter = createAdapter(toAdapterInit(context));
        const tool = defineV2JusticeReviewTool(adapter);
        const registration = await context.tool.transform((editor: ToolEditor): void => {
          editor.add(tool);
        });
        return async (): Promise<void> => {
          try {
            await registration.dispose();
          } catch {
            /* fail-open: cleanup failure must not crash the host */
          }
        };
      } catch {
        // fail-open: a setup failure leaves Justice inactive instead of crashing the session.
        return undefined;
      }
    },
  };
}

const JusticeV2Plugin: Plugin.Plugin = createJusticeV2Plugin();

export default JusticeV2Plugin;
