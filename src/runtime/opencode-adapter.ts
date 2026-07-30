import { randomUUID } from "node:crypto";
import type { Hooks, ToolDefinition } from "@opencode-ai/plugin";
import type { EventSessionDeleted } from "@opencode-ai/sdk";
import {
  isJusticeImplementCommand,
  parseJusticeImplementCommandArguments,
} from "../core/implement-command";
import { JusticePlugin, createGlobalFs, type JusticePluginOptions } from "../core/justice-plugin";
import { matchesLoopError } from "../core/loop-error-patterns";
import {
  isJusticeStartCommand,
  parseWorkflowStartCommandArguments,
} from "../core/trigger-detector";
import { parseReviewResolutionArtifact } from "../core/review-resolution-artifact";
import { parseReviewSnapshotArtifact } from "../core/review-snapshot-artifact";
import { defineJusticeReviewTool } from "./justice-tools";
import { NodeFileSystem } from "./node-file-system";
import { OpenCodeNotifier } from "./opencode-notifier";
import { allocateWriterId, generateWriterId } from "./writer-id";

export interface OpenCodeLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly service: string;
  readonly message: string;
  readonly extra?: Record<string, unknown>;
}

export interface OpenCodePluginInit {
  readonly project: { readonly name?: string; readonly root?: string };
  readonly client: {
    readonly app: {
      log: (entry: OpenCodeLogEntry) => Promise<void> | void;
    };
  };
  readonly $: (...args: unknown[]) => unknown;
  readonly directory?: string;
  readonly worktree?: string;
}

export interface OpenCodeAdapterOptions {
  /**
   * When true, gate advisories are additionally appended to the visible tool
   * `output.output` (best-effort channel). Defaults to false: the C1 spike
   * (output.output visibility) was not empirically validated, so the notifier
   * remains the guaranteed channel and this append stays OFF (D47).
   */
  readonly enableAdvisoryOutputAppend?: boolean;
}

const TRUSTED_REVIEW_RESOLUTION_ARTIFACT_TOOLS: readonly string[] = Object.freeze([
  "justice_review",
] as const);
const TRUSTED_REVIEW_SNAPSHOT_ARTIFACT_TOOLS: readonly string[] = Object.freeze([
  "code_review",
] as const);

type CommandExecuteBeforeHook = NonNullable<Hooks["command.execute.before"]>;

/**
 * `command.execute.before` argument types, read straight back off the SDK `Hooks` map so an
 * upstream rename or reshape fails at compile time. The exact contract (`command`,
 * `sessionID`, raw `arguments` string; mutable `output.parts`; `Promise<void>` with no deny
 * channel) is pinned by `tests/types/command-execute-before.contract-fixture.ts`.
 */
export type CommandExecuteBeforeInput = Parameters<CommandExecuteBeforeHook>[0];
export type CommandExecuteBeforeOutput = Parameters<CommandExecuteBeforeHook>[1];
type CommandExecuteBeforePart = CommandExecuteBeforeOutput["parts"][number];

interface GenericEventInput {
  readonly event: {
    readonly type: string;
    readonly properties?: object;
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isSessionDeletedEvent(event: GenericEventInput["event"]): event is EventSessionDeleted {
  const properties = toRecord(event.properties);
  const info = toRecord(properties.info);
  return event.type === "session.deleted" && typeof info.id === "string";
}

export class OpenCodeAdapter {
  readonly #init: OpenCodePluginInit;
  readonly #noOp: boolean;
  readonly #workspaceRoot: string | null;
  readonly #enableAdvisoryOutputAppend: boolean;
  #justice: JusticePlugin | null = null;
  #notifier: OpenCodeNotifier | null = null;
  #initPromise: Promise<void> | null = null;

  constructor(init: OpenCodePluginInit, options: OpenCodeAdapterOptions = {}) {
    const project =
      typeof init.project === "object"
        ? {
            name: init.project.name,
            root: init.project.root,
          }
        : { name: undefined, root: undefined };

    const log =
      typeof init.client.app.log === "function"
        ? init.client.app.log
        : (): void => {
            /* no-op */
          };

    this.#init = {
      ...init,
      project,
      client: {
        ...init.client,
        app: {
          ...init.client.app,
          log,
        },
      },
    };
    this.#workspaceRoot = init.worktree ?? init.directory ?? this.#init.project.root ?? null;
    this.#noOp = this.#workspaceRoot === null;
    this.#enableAdvisoryOutputAppend = options.enableAdvisoryOutputAppend ?? false;
  }

  isNoOp(): boolean {
    return this.#noOp;
  }

  getWorkspaceRoot(): string | null {
    return this.#workspaceRoot;
  }

  getJustice(): JusticePlugin | null {
    return this.#justice;
  }

  getTools(): Record<string, ToolDefinition> {
    return {
      justice_review: defineJusticeReviewTool(this),
    };
  }

  async log(level: "info" | "warn" | "error", message: string, ...args: unknown[]): Promise<void> {
    try {
      await this.#init.client.app.log({
        level,
        service: "justice",
        message,
        extra: args.length > 0 ? { args } : undefined,
      });
    } catch {
      /* final defense line: never throw from the logging wrapper */
    }
  }

  async ensureInitialized(): Promise<void> {
    if (this.#noOp) return;
    if (this.#initPromise) {
      await this.#initPromise;
      return;
    }

    this.#initPromise = this.#runInit();
    await this.#initPromise;
  }

  async #runInit(): Promise<void> {
    try {
      const root = this.#workspaceRoot;
      if (root === null) return;

      const localFs = new NodeFileSystem(root);
      const loggerAdapter: NonNullable<JusticePluginOptions["logger"]> = {
        warn: (msg, ...extra) => {
          void this.log("warn", msg, ...extra);
        },
        error: (msg, ...extra) => {
          void this.log("error", msg, ...extra);
        },
      };

      const globalFs = await createGlobalFs(loggerAdapter);
      const notifier = new OpenCodeNotifier(this.#init.client.app.log);
      this.#notifier = notifier;

      // Bootstrap a globally-unique writerId for the Observation Log shards (D55/D39).
      // Fail-open: if the uniqueness probe cannot run (e.g. the workspace root is not
      // yet on disk), fall back to a fresh id so a missing directory never disables
      // the whole plugin.
      let writerId: string;
      try {
        writerId = await allocateWriterId(localFs, { agentId: "system", sessionId: "system" });
      } catch (err) {
        writerId = generateWriterId();
        await this.log(
          "warn",
          "[Justice] writerId allocation probe failed; using ephemeral id",
          err,
        );
      }

      const justice = new JusticePlugin(localFs, localFs, {
        logger: loggerAdapter,
        onError: (err): void => {
          void this.log("error", "[Justice] internal error", err);
        },
        globalFileSystem: globalFs ?? undefined,
        notifier,
        writerId,
        workspaceRoot: root,
      });

      await justice.initialize();
      this.#justice = justice;
      await this.log("info", "Justice initialized via opencode-adapter");
    } catch (err) {
      this.#justice = null;
      this.#initPromise = null; // Allow retry on next attempt
      await this.log("error", "[Justice] lazy init failed", err);
    }
  }

  async onEvent(input: GenericEventInput): Promise<void> {
    if (this.#noOp) return;

    try {
      if (isSessionDeletedEvent(input.event)) {
        await this.#handleSessionDeleted(input.event.properties.info.id);
        return;
      }

      const properties = toRecord(input.event.properties);

      switch (input.event.type) {
        case "message.updated":
          await this.#handleMessageUpdated(properties);
          return;
        case "message.part.updated":
          await this.#handleMessagePartUpdated(properties);
          return;
        case "chat.message":
          await this.#handleChatMessage(properties);
          return;
        case "chat.params":
          await this.#handleChatParams(properties);
          return;
        case "session.error":
          await this.#handleSessionError(properties);
          return;
      }
    } catch (err) {
      await this.log("error", "[Justice] event hook failure", err);
    }
  }

  async onChatMessage(input: unknown, output?: unknown): Promise<void> {
    if (this.#noOp) return;

    try {
      const inputRecord = toRecord(input);
      if (output === undefined) {
        await this.#handleChatMessage(inputRecord);
        return;
      }
      const outputRecord = toRecord(output);
      const message = this.#readRecord(outputRecord, "message");
      const parts = Array.isArray(outputRecord.parts) ? outputRecord.parts : [];
      const text = parts
        .map((part) => toRecord(part))
        .filter((part) => this.#readString(part, "type") === "text")
        .map((part) => this.#readString(part, "text"))
        .filter((partText) => partText.length > 0)
        .join("\n");
      await this.#handleChatMessage({
        ...inputRecord,
        message: {
          ...message,
          content: this.#readString(message, "role") === "user" ? text : "",
          role: this.#readString(message, "role"),
        },
      });
    } catch (err) {
      await this.log("error", "[Justice] chat.message hook failure", err);
    }
  }

  async onChatParams(input: unknown): Promise<void> {
    if (this.#noOp) return;

    try {
      await this.#handleChatParams(toRecord(input));
    } catch (err) {
      await this.log("error", "[Justice] chat.params hook failure", err);
    }
  }

  /**
   * Forward a `message.updated` event. Its content is preserved only for the
   * explicitly separate legacy PlanBridge path; the observation payload below
   * is lifecycle-only and intentionally never carries content.
   */
  async #handleMessageUpdated(properties: Record<string, unknown>): Promise<void> {
    const info = this.#readRecord(properties, "info");
    const sessionId =
      this.#readString(properties, "sessionID") || this.#readString(info, "sessionID");
    if (!sessionId) return;

    const role = this.#readString(info, "role");
    const content = this.#readString(info, "content");
    const messageID = this.#readString(info, "id");

    // Use the message event as a trigger to ensure the plugin is initialized,
    // even if the content is temporarily empty (OpenCode event structure changes).
    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    // (1) Agent mapping: propagate the detected agent name so persona state can be
    // reconstructed later (D48/FIND-001). Full mapping lands in Task 3.4. Wrapped in
    // its own try/catch so an AgentMapped dispatch failure can never block the
    // plan-bridge delegation path (2) or the observation log (3) below.
    const agentName = this.#resolveAgentName(properties, info);
    if (agentName) {
      try {
        await justice.handleEvent({
          type: "AgentMapped",
          sessionId,
          payload: { sessionId, agentName },
        });
      } catch (err) {
        await this.log("error", "[Justice] AgentMapped dispatch failed", err);
      }
    }

    // (2) Legacy PlanBridge-only user/assistant content path. PlanBridge still
    // analyzes assistant messages for plan references, so retain this path while
    // keeping it structurally separate from declared Evidence observation (3).
    // Empty streaming updates never trigger delegation.
    if ((role === "assistant" || role === "user") && content.length > 0) {
      try {
        await justice.handleEvent({
          type: "Message",
          sessionId,
          payload: { role, content },
        });
      } catch (err) {
        await this.log("error", "[Justice] plan-bridge delegation dispatch failed", err);
      }
    }

    // (3) Lifecycle-only observation payload. It carries role/finalization but
    // never info.content: declared Evidence can only obtain text from part events.
    if ((role === "assistant" || role === "user") && messageID.length > 0) {
      await justice.handleEvent({
        type: "Message",
        sessionId,
        payload: {
          kind: "message_updated",
          sessionId,
          messageID,
          role,
          finalized: this.#detectFinalized(info),
        },
      });
    }
  }

  /**
   * Forward a `message.part.updated` event as an observation
   * `message_part_updated` payload.
   *
   * Phase 0 spike gap: the exact OpenCode `message.part.updated` event shape is
   * UNVERIFIED. We read defensively from `properties.part` (the OpenCode Part
   * object) with fallbacks; a missing messageID makes the observation unroutable
   * in the Observation Log, so it is dropped (dormant/harmless until the shape is
   * confirmed).
   */
  async #handleMessagePartUpdated(properties: Record<string, unknown>): Promise<void> {
    const part = this.#readRecord(properties, "part");
    const sessionId =
      this.#readString(properties, "sessionID") || this.#readString(part, "sessionID");
    if (!sessionId) return;

    const messageID =
      this.#readString(part, "messageID") || this.#readString(properties, "messageID");
    if (!messageID) return;

    const partID = this.#readString(part, "id") || this.#readString(properties, "partID");
    const text = this.#readString(part, "text") || this.#readString(properties, "text");
    if (partID.length === 0) return;

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    await justice.handleEvent({
      type: "Message",
      sessionId,
      payload: { kind: "message_part_updated", sessionId, messageID, partID, text },
    });
  }

  /**
   * Handles a `chat.message` event. Its optional agent field is always used to
   * establish session identity; only user content is forwarded into the legacy
   * message path to avoid duplicating assistant text observations.
   */
  async #handleChatMessage(properties: Record<string, unknown>): Promise<void> {
    const message = this.#readRecord(properties, "message");
    const sessionId =
      this.#readString(properties, "sessionID") || this.#readString(message, "sessionID");
    const content = this.#readString(message, "content");
    const isUserMessage = content.length > 0 && this.#readString(message, "role") === "user";
    const agentName = this.#resolveAgentName(properties, message);
    if (sessionId.length === 0 || (!isUserMessage && agentName.length === 0)) return;

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;
    if (agentName.length > 0) {
      try {
        await justice.handleEvent({
          type: "AgentMapped",
          sessionId,
          payload: { sessionId, agentName },
        });
      } catch (err) {
        await this.log("error", "[Justice] chat.message AgentMapped dispatch failed", err);
      }
    }
    if (!isUserMessage) return;
    await justice.handleEvent({ type: "Message", sessionId, payload: { role: "user", content } });
  }

  async #handleChatParams(properties: Record<string, unknown>): Promise<void> {
    const sessionId = this.#readString(properties, "sessionID");
    const agentName = this.#readString(properties, "agent");
    if (sessionId.length === 0 || agentName.length === 0) return;

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;
    await justice.handleEvent({
      type: "AgentMapped",
      sessionId,
      payload: { sessionId, agentName },
    });
  }

  async onTextComplete(
    input: { readonly sessionID: string; readonly messageID: string; readonly partID: string },
    output: { readonly text: string },
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;
      await justice.handleEvent({
        type: "Message",
        sessionId: input.sessionID,
        payload: {
          kind: "text_complete",
          sessionId: input.sessionID,
          messageID: input.messageID,
          partID: input.partID,
          text: output.text,
        },
      });
    } catch (err) {
      await this.log("error", "[Justice] experimental.text.complete failure", err);
    }
  }

  /**
   * Forward a loop-like `session.error` event to the loop-detector. Unchanged
   * from the original behavior.
   */
  async #handleSessionError(properties: Record<string, unknown>): Promise<void> {
    const sessionId = this.#readString(properties, "sessionID");
    if (!sessionId) return;

    const error = this.#readUnknown(properties, "error");
    const message = this.#extractErrorMessage(error);
    const kind = this.#extractErrorName(error);

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    try {
      await justice.handleEvent({
        type: "Event",
        sessionId,
        payload: {
          eventType: "session_error",
          sessionId,
          message,
          ...(kind.length === 0 ? {} : { kind }),
        },
      });
    } catch (err) {
      await this.log("error", "[Justice] session-error observation dispatch failed", err);
    }

    if (!matchesLoopError(message)) return;

    try {
      await justice.handleEvent({
        type: "Event",
        sessionId,
        payload: {
          eventType: "loop-detector",
          sessionId,
          message,
        },
      });
    } catch (err) {
      await this.log("error", "[Justice] loop-detector dispatch failed", err);
    }
  }

  async #handleSessionDeleted(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;
    justice.destroySession(sessionId);
  }

  /**
   * Resolve an agent name from message properties defensively:
   * `info.agent` → `params.agent` → `properties.agent` (D48/FIND-001).
   */
  #resolveAgentName(properties: Record<string, unknown>, info: Record<string, unknown>): string {
    const fromInfo = this.#readString(info, "agent");
    if (fromInfo) return fromInfo;
    const fromParams = this.#readString(this.#readRecord(properties, "params"), "agent");
    if (fromParams) return fromParams;
    return this.#readString(properties, "agent");
  }

  /**
   * Derive a finalization signal from an assistant message defensively:
   * `info.finish` or `info.time.completed`. Phase 0 spike gap: the exact finish
   * indicator is UNVERIFIED, so both are treated as truthy completion signals.
   */
  #detectFinalized(info: Record<string, unknown>): boolean {
    if (this.#readUnknown(info, "finish")) return true;
    const time = this.#readRecord(info, "time");
    return Boolean(this.#readUnknown(time, "completed"));
  }

  async onToolExecuteBefore(
    input: { readonly tool: string; readonly sessionID: string; readonly callID: string },
    output: { args: Record<string, unknown> },
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      // Forward every tool except justice_* query tools, which must not perturb
      // the canonical Observation Log (D50).
      if (input.tool.startsWith("justice_")) return;
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      const response = await justice.handleEvent({
        type: "PreToolUse",
        sessionId: input.sessionID,
        callId: input.callID,
        payload: {
          toolName: input.tool,
          callId: input.callID,
          toolInput: output.args,
        },
      });

      if (response.action !== "inject") return;

      const originalPrompt = typeof output.args.prompt === "string" ? output.args.prompt : "";
      output.args.prompt = `${response.injectedContext}\n\n${originalPrompt}`;

      const modified = response.modifiedPayload as { args?: Record<string, unknown> } | undefined;
      if (!modified?.args) return;

      for (const [key, value] of Object.entries(modified.args)) {
        if (key === "prompt") continue;
        // eslint-disable-next-line security/detect-object-injection
        output.args[key] = value;
      }
    } catch (err) {
      await this.log("error", "[Justice] onToolExecuteBefore failure", err);
    }
  }

  /**
   * NOTE: `output.output` is intentionally non-readonly to support in-place
   * mutation when `enableAdvisoryOutputAppend` is true (see
   * OpenCodeAdapterOptions). TypeScript does not flag callers passing a
   * `readonly`-typed object here as a compile error; such callers may observe
   * their object mutated at runtime when the option is enabled.
   */
  async onToolExecuteAfter(
    input: {
      readonly tool: string;
      readonly sessionID: string;
      readonly callID: string;
      readonly args: Record<string, unknown>;
    },
    output: { output: string; readonly metadata?: Record<string, unknown> },
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      const isTrustedReviewResolutionArtifactSource =
        TRUSTED_REVIEW_RESOLUTION_ARTIFACT_TOOLS.includes(input.tool);
      if (input.tool.startsWith("justice_") && !isTrustedReviewResolutionArtifactSource) return;
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      const rawReviewResolutionArtifact = output.metadata?.reviewResolutionArtifact;
      const canPromoteReviewResolutionArtifact =
        isTrustedReviewResolutionArtifactSource && output.metadata?.error !== true;
      const reviewResolutionArtifact = canPromoteReviewResolutionArtifact
        ? parseReviewResolutionArtifact(rawReviewResolutionArtifact)
        : undefined;
      if (
        canPromoteReviewResolutionArtifact &&
        rawReviewResolutionArtifact !== undefined &&
        reviewResolutionArtifact === undefined
      ) {
        await this.log("warn", "[Justice] malformed review resolution artifact ignored");
      }

      const isTrustedReviewSnapshotArtifactSource = TRUSTED_REVIEW_SNAPSHOT_ARTIFACT_TOOLS.includes(
        input.tool,
      );
      const canPromoteReviewSnapshotArtifact =
        isTrustedReviewSnapshotArtifactSource && output.metadata?.error !== true;
      const reviewSnapshotArtifact = canPromoteReviewSnapshotArtifact
        ? parseReviewSnapshotArtifact(output.metadata?.reviewSnapshotArtifact)
        : undefined;
      if (
        canPromoteReviewSnapshotArtifact &&
        output.metadata?.reviewSnapshotArtifact !== undefined &&
        reviewSnapshotArtifact === undefined
      ) {
        await this.log("warn", "[Justice] malformed review snapshot artifact ignored");
      }

      const response = await justice.handleEvent({
        type: "PostToolUse",
        sessionId: input.sessionID,
        callId: input.callID,
        payload: {
          toolName: input.tool,
          callId: input.callID,
          toolInput: input.args,
          toolResult: output.output,
          metadata: output.metadata,
          ...(reviewResolutionArtifact === undefined ? {} : { reviewResolutionArtifact }),
          ...(reviewSnapshotArtifact === undefined ? {} : { reviewSnapshotArtifact }),
          error: output.metadata?.error === true,
        },
      });

      if (response.action !== "inject") return;
      const normalInjectedContext =
        response.normalInjectedContext ??
        (response.variant === "gate_advisory" ? "" : response.injectedContext);
      if (normalInjectedContext.length > 0) {
        output.output = output.output + "\n\n" + normalInjectedContext;
      }

      const gateAdvisoryContext =
        response.gateAdvisoryContext ??
        (response.variant === "gate_advisory" ? response.injectedContext : "");
      if (gateAdvisoryContext.length === 0) return;

      const notifier = this.#notifier;

      // (1) Guaranteed channel: surface the gate advisory via the notifier. Wrapped
      // in its own try/catch so a notifier failure never breaks the tool flow.
      if (notifier) {
        try {
          await notifier.notify({
            level: "warning",
            variant: "justice_gate",
            title: "Task Gate",
            message: gateAdvisoryContext,
            sessionId: input.sessionID,
            taskId:
              (typeof input.args.taskId === "string" ? input.args.taskId : undefined) ?? "unknown",
          });
        } catch (err) {
          await this.log("warn", "[Justice] gate advisory notify failed", err);
        }
      }

      // (2) Best-effort channel: append the banner to the visible tool output. Gated
      // off by default (see OpenCodeAdapterOptions.enableAdvisoryOutputAppend / D47).
      if (this.#enableAdvisoryOutputAppend && notifier && typeof output.output === "string") {
        const banner = notifier.formatBanner({
          level: "warning",
          variant: "justice_gate",
          title: "Task Gate",
          message: gateAdvisoryContext,
        });
        output.output = output.output + "\n\n" + banner;
      }
    } catch (err) {
      await this.log("error", "[Justice] onToolExecuteAfter failure", err);
    }
  }

  /**
   * Handle Justice slash commands and hand the caller's synthetic guidance as an
   * appended directive part.
   *
   * Fail-open is structural here, not a style choice: the SDK handler resolves to
   * `Promise<void>` and `output` exposes only `parts`, so there is no channel by which a
   * plugin could deny or abort a command. Every failure therefore degrades to PROCEED with
   * `output.parts` left untouched.
   *
   * `input.command` is accepted with or without its leading slash — the SDK does not
   * document which spelling it delivers, and `isJusticeStartCommand` tolerates both.
   */
  async onCommandExecuteBefore(
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput,
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      if (isJusticeStartCommand(input.command)) {
        await this.#handleWorkflowStart(input, output);
        return;
      }

      if (isJusticeImplementCommand(input.command)) {
        await this.#handleImplementationArm(input, output);
        return;
      }
    } catch (err) {
      await this.log("error", "[Justice] onCommandExecuteBefore failure", err);
    }
  }

  async #handleWorkflowStart(
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput,
  ): Promise<void> {
    // The parser already rejects unknown flags, valueless/duplicated flags, unsafe paths
    // and a missing goal. Justice stays silent rather than guessing an intent, and the raw
    // arguments are never echoed into the log.
    const request = parseWorkflowStartCommandArguments(input.arguments);
    if (request === null) {
      await this.log("warn", "[Justice] /justice-start arguments rejected by parser; ignoring");
      return;
    }

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    const result = await justice.getPlanBridge().handleWorkflowStart(input.sessionID, request);

    // Observation audit records are emitted by PlanBridge.handleWorkflowStart, not here,
    // to avoid double-writing the same workflow lifecycle events (workflow_started +
    // plan_activated/design_requested/plan_requested) into the observation log.

    if (result.guidance.length === 0) return;
    output.parts.push(this.#buildWorkflowDirectivePart(input.sessionID, result.guidance));
  }

  async #handleImplementationArm(
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput,
  ): Promise<void> {
    const request = parseJusticeImplementCommandArguments(input.arguments);
    if (request === null) {
      await this.log("warn", "[Justice] /justice-implement arguments rejected by parser; ignoring");
      return;
    }

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    const result = await justice.getPlanBridge().handleImplementationArm(input.sessionID, request);

    if (result.guidance.length === 0) return;
    output.parts.push(this.#buildWorkflowDirectivePart(input.sessionID, result.guidance));
  }

  /**
   * Build the synthetic text part carrying the bootstrap guidance. `command.execute.before`
   * supplies neither `id` nor `messageID`, so both are generated here following the
   * `writer-id` precedent (`randomUUID`). `synthetic: true` marks the part as plugin-authored
   * rather than user-typed.
   */
  #buildWorkflowDirectivePart(sessionId: string, guidance: string): CommandExecuteBeforePart {
    return {
      id: `prt_justice_workflow_${randomUUID()}`,
      sessionID: sessionId,
      messageID: `msg_justice_workflow_${randomUUID()}`,
      type: "text",
      text: guidance,
      synthetic: true,
    };
  }

  async onSessionCompacting(
    input: { readonly sessionID: string },
    output: { context?: string[]; prompt?: string },
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      const response = await justice.handleEvent({
        type: "Event",
        sessionId: input.sessionID,
        payload: {
          eventType: "compaction",
          sessionId: input.sessionID,
          reason: output.prompt ?? "",
        },
      });

      if (response.action !== "inject") return;
      if (!output.context) output.context = [];
      output.context.push(response.injectedContext);
    } catch (err) {
      await this.log("error", "[Justice] onSessionCompacting failure", err);
    }
  }

  #readUnknown(record: Record<string, unknown>, key: string): unknown {
    // eslint-disable-next-line security/detect-object-injection
    return record[key];
  }

  #readRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
    // eslint-disable-next-line security/detect-object-injection
    return toRecord(record[key]);
  }

  #readString(record: Record<string, unknown>, key: string): string {
    // eslint-disable-next-line security/detect-object-injection
    const value = record[key];
    return typeof value === "string" ? value : "";
  }

  #extractErrorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error) {
      const message = (error as { message?: unknown }).message;
      return typeof message === "string" ? message : "";
    }
    return "";
  }

  #extractErrorName(error: unknown): string {
    if (error && typeof error === "object" && "name" in error) {
      const name = (error as { name?: unknown }).name;
      return typeof name === "string" ? name : "";
    }
    return "";
  }
}
