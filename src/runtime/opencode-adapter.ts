import { randomUUID } from "node:crypto";
import type { Hooks, ToolDefinition } from "@opencode-ai/plugin";
import {
  isJusticeImplementCommand,
  parseJusticeImplementCommandArguments,
} from "../core/implement-command";
import { JusticePlugin, createGlobalFs, type JusticePluginOptions } from "../core/justice-plugin";
import type { HookResponse, ReservedReviewArtifactIo } from "../core/types";
import { matchesLoopError } from "../core/loop-error-patterns";
import {
  isJusticeStartCommand,
  parseWorkflowStartCommandArguments,
} from "../core/trigger-detector";
import { parseReviewResolutionArtifact } from "../core/review-resolution-artifact";
import {
  isJusticeReviewGateCommand,
  parseJusticeReviewGateCommandArguments,
} from "../core/review-gate-command";
import { parseReviewSnapshotArtifact } from "../core/review-snapshot-artifact";
import {
  REVIEW_GATE_EXECUTION_MARKER,
  REVIEW_GATE_REMEDIATION_MARKER,
  REVIEW_GATE_WORKER_AGENT,
  extractReviewGateWorkerPrompt,
} from "../core/review-gate-execution";
import {
  normalizeTaskToolInputForJusticeInPlace,
  normalizeTaskToolInputForOmoWireInPlace,
  resolveTaskIdFromToolInput,
} from "../core/task-packager";
import { defineJusticeReviewTool } from "./justice-tools";
import { JUSTICE_REVIEW_CONTROLLER_AGENT } from "./command-registration";
import { createLinuxOpenat2ReviewArtifactProvider } from "./linux-review-artifact-provider";
import type { LinuxOpenat2ReviewArtifactProvider } from "./linux-review-artifact-provider";
import { NodeFileSystem } from "./node-file-system";
import { OpenCodeNotifier } from "./opencode-notifier";
import { allocateWriterId, generateWriterId } from "./writer-id";
import { extractReviewGateToolPaths } from "./review-gate-tool-paths";
import type { DelegatedExecutionRelationObserved } from "../core/types";

const PROCEED: HookResponse = { action: "proceed" };

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
   * Static default for Justice enforcement. Defaults to true. A session-level
   * /justice-enable or /justice-disable command overrides this value.
   */
  readonly enabled?: boolean;
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
    readonly id?: string;
    readonly type: string;
    readonly properties?: object;
  };
}

export type ReplayRuntimeEvent =
  | {
      readonly kind: "tool.execute.before";
      readonly input: { readonly tool: string; readonly sessionID: string; readonly callID: string };
      readonly output: { readonly args: Record<string, unknown> };
    }
  | {
      readonly kind: "tool.execute.after";
      readonly input: {
        readonly tool: string;
        readonly sessionID: string;
        readonly callID: string;
        readonly args: Record<string, unknown>;
      };
      readonly output: { readonly output: string; readonly metadata?: Record<string, unknown> };
    }
  | { readonly kind: "event"; readonly event: GenericEventInput["event"] };

function toRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getSessionRemovalId(event: GenericEventInput["event"]): string | undefined {
  const properties = toRecord(event.properties);
  const info = toRecord(properties.info);
  if (event.type !== "session.deleted" && event.type !== "session.removed") return undefined;
  return typeof info.id === "string" ? info.id : undefined;
}

function relationKey(parentSessionId: string, callId: string): string {
  return `${parentSessionId}\u0000${callId}`;
}

export class OpenCodeAdapter {
  readonly #init: OpenCodePluginInit;
  readonly #noOp: boolean;
  readonly #workspaceRoot: string | null;
  readonly #defaultEnabled: boolean;
  readonly #enableAdvisoryOutputAppend: boolean;
  readonly #sessionEnabledOverrides = new Map<string, boolean>();
  #justice: JusticePlugin | null = null;
  #notifier: OpenCodeNotifier | null = null;
  #initPromise: Promise<void> | null = null;
  readonly #reviewCategoriesByCallId = new Map<
    string,
    { readonly parentSessionId: string; readonly category: "sp-review" | "sp-final-review" }
  >();
  readonly #pendingChildRelations = new Map<
    string,
    {
      readonly parentSessionId: string;
      readonly parentCallId: string;
      readonly childSessionId: string;
      readonly category: "sp-review" | "sp-final-review";
    }
  >();
  readonly #childSessionEvents = new Map<
    string,
    { readonly runtimeEventId: string; readonly parentSessionId: string }
  >();

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
    this.#defaultEnabled = options.enabled ?? true;
    this.#enableAdvisoryOutputAppend = options.enableAdvisoryOutputAppend ?? false;
  }

  isSessionEnabled(sessionId: string): boolean {
    const directOverride = this.#sessionEnabledOverrides.get(sessionId);
    if (directOverride !== undefined) return directOverride;

    const rootSessionId = this.resolveLockOwnerSession(sessionId);
    if (rootSessionId !== undefined && rootSessionId !== sessionId) {
      const inheritedOverride = this.#sessionEnabledOverrides.get(rootSessionId);
      if (inheritedOverride !== undefined) return inheritedOverride;
    }

    return this.#defaultEnabled;
  }

  isNoOp(): boolean {
    return this.#noOp;
  }

  getWorkspaceRoot(): string | null {
    return this.#workspaceRoot;
  }

  resolveLockOwnerSession(sessionID: string): string | undefined {
    if (sessionID.length === 0) return undefined;
    const visited = new Set<string>();
    let currentSessionID = sessionID;
    for (let depth = 0; depth <= this.#childSessionEvents.size; depth += 1) {
      if (visited.has(currentSessionID)) return undefined;
      visited.add(currentSessionID);
      const relation = this.#childSessionEvents.get(currentSessionID);
      if (relation === undefined) return currentSessionID;
      if (relation.parentSessionId.length === 0) return undefined;
      currentSessionID = relation.parentSessionId;
    }
    return undefined;
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

  async replay(events: readonly ReplayRuntimeEvent[]): Promise<void> {
    for (const event of events) {
      if (event.kind === "tool.execute.before") {
        await this.onToolExecuteBefore(event.input, event.output);
      } else if (event.kind === "tool.execute.after") {
        await this.onToolExecuteAfter(event.input, event.output);
      } else {
        await this.onEvent({ event: event.event });
      }
    }
  }

  async #runInit(): Promise<void> {
    try {
      const root = this.#workspaceRoot;
      if (root === null) return;

      let reviewArtifactProvider: LinuxOpenat2ReviewArtifactProvider | undefined;
      try {
        reviewArtifactProvider = createLinuxOpenat2ReviewArtifactProvider(root);
      } catch (err) {
        reviewArtifactProvider = undefined;
        await this.log(
          "warn",
          "[Justice] review artifact provider initialization failed; reservation disabled",
          err,
        );
      }
      const localFs = new NodeFileSystem(root, reviewArtifactProvider);
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

      // Optional runtime capability (Task 3.4): reserved review artifact I/O
      // backed by the native provider. Absent on unsupported runtimes, where
      // review artifact reservation degrades fail-open to an unusable
      // reservation inside the plugin instead of disabling initialization.
      let reservedReviewArtifactIo: ReservedReviewArtifactIo | undefined;
      try {
        reservedReviewArtifactIo = localFs.createReservedReviewArtifactIo?.();
      } catch (err) {
        await this.log(
          "warn",
          "[Justice] review artifact reservation capability probe failed; reservation disabled",
          err,
        );
      }

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
        reservedReviewArtifactIo,
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
      const sessionRemovalId = getSessionRemovalId(input.event);
      if (sessionRemovalId !== undefined) {
        this.#clearChildRelationState(sessionRemovalId);
        await this.#handleSessionDeleted(sessionRemovalId);
        return;
      }

      const properties = toRecord(input.event.properties);
      await this.#captureChildSessionEvent(input.event.id, input.event.type, properties);

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
        sessionID:
          this.#readString(outputRecord, "sessionID") ||
          this.#readString(message, "sessionID") ||
          this.#readString(inputRecord, "sessionID"),
        message: {
          ...message,
          content:
            this.#readString(message, "role") === "user" && text.length > 0
              ? text
              : this.#readString(message, "content"),
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
    if (!sessionId || !this.isSessionEnabled(sessionId)) return;

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
    if (!sessionId || !this.isSessionEnabled(sessionId)) return;

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
    if (
      sessionId.length === 0 ||
      !this.isSessionEnabled(sessionId) ||
      (!isUserMessage && agentName.length === 0)
    ) return;

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

    const trimmedContent = content.trim();
    const isImplementationCommand =
      trimmedContent.startsWith("/justice-implement") ||
      trimmedContent.startsWith("justice-implement");
    if (
      isImplementationCommand &&
      this.resolveLockOwnerSession(sessionId) === sessionId
    ) {
      await this.#tryFallbackImplementCommand(sessionId, trimmedContent);
    }

    await justice.handleEvent({ type: "Message", sessionId, payload: { role: "user", content } });
  }

  async #tryFallbackImplementCommand(sessionId: string, content: string): Promise<void> {
    const argumentsString = content.replace(/^\/?justice-implement\s*/, "").trim();
    const request = parseJusticeImplementCommandArguments(argumentsString);
    if (request === null) {
      await this.log("warn", "[Justice] Fallback /justice-implement command was typed but arguments were rejected by parser");
      return;
    }

    const planBridge = this.#justice?.getPlanBridge();
    if (!planBridge) return;

    if ("action" in request && request.action === "cancel") {
      await planBridge.handleImplementationArm(sessionId, request);
      await this.log("warn", "[Justice] Fallback /justice-implement --cancel was used because the command was not registered.");
      return;
    }

    const result = await planBridge.handleImplementationArm(sessionId, {
      source: "fallback_marker",
      planPath: request.planPath,
      approved: request.approved,
    });
    await this.log("warn", "[Justice] Fallback /justice-implement was used because the command was not registered.", { armed: result.armed, planPath: result.planPath, directiveStage: result.directiveStage });
  }
  async #handleChatParams(properties: Record<string, unknown>): Promise<void> {
    const sessionId = this.#readString(properties, "sessionID");
    const agentName = this.#readString(properties, "agent");
    if (
      sessionId.length === 0 ||
      !this.isSessionEnabled(sessionId) ||
      agentName.length === 0
    ) return;

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
    if (this.#noOp || !this.isSessionEnabled(input.sessionID)) return;

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
    if (!sessionId || !this.isSessionEnabled(sessionId)) return;

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
    this.#sessionEnabledOverrides.delete(sessionId);
    const justice = this.#justice;
    if (!justice) return;
    await justice.destroySession(sessionId);
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
  ): Promise<HookResponse> {
    if (!this.isSessionEnabled(input.sessionID)) return PROCEED;
    const isTask = input.tool === "task";
    const originalPrompt = typeof output.args.prompt === "string" ? output.args.prompt : "";
    let reviewGateLockActive = false;
    try {
      if (isTask && this.#isReviewGateControllerTask(output.args)) {
        await this.ensureInitialized();
        if (
          this.#justice
            ?.getPlanBridge()
            .isPendingReviewGatePrompt(input.sessionID, originalPrompt) === true
        ) return PROCEED;
      }
      if (isTask) {
        this.#rememberReviewCategory(input, output.args);
        normalizeTaskToolInputForJusticeInPlace(output.args);
      }
      if (this.#noOp) {
        this.#finalizeTaskToolInput(isTask, input, output.args);
        return PROCEED;
      }

      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) {
        this.#finalizeTaskToolInput(isTask, input, output.args);
        return PROCEED;
      }

      const lockOwnerSessionId = this.resolveLockOwnerSession(input.sessionID) ?? null;
      reviewGateLockActive =
        lockOwnerSessionId === null
          ? justice.getPlanBridge().hasAnyReviewGateLock()
          : justice.getPlanBridge().getReviewGateLock(lockOwnerSessionId) !== undefined;
      const isPendingReviewGateTask =
        isTask &&
        lockOwnerSessionId !== null &&
        justice
          .getPlanBridge()
          .isPendingReviewGatePrompt(lockOwnerSessionId, originalPrompt);
      const reviewGateToolPaths = extractReviewGateToolPaths(input.tool, output.args);
      const lockDecision = justice.getPlanBridge().classifyReviewGateToolUse(lockOwnerSessionId, {
        toolName: input.tool,
        isPendingReviewGateTask,
        queryOnly: input.tool === "justice_review" && !("resolve" in output.args),
        changedPaths: reviewGateToolPaths,
      });
      if (lockDecision?.kind === "deny") {
        const lock =
          lockOwnerSessionId === null
            ? undefined
            : justice.getPlanBridge().getReviewGateLock(lockOwnerSessionId);
        let guidance: string | undefined;
        if (
          lockDecision.reason === "implementation_not_authorized" &&
          lock?.phase === "awaiting_implementation_authorization" &&
          lock.planPath !== null
        ) {
          guidance = `Implementation is awaiting authorization. Tell the user to run /justice-implement --plan ${lock.planPath} --approved; do not ask for a generic confirmation again.`;
        } else if (lockDecision.reason === "review_scope_violation" && lock?.phase === "remediation") {
          guidance = `Review remediation permits writes only to the reviewed Design (${lock.designPath ?? "unavailable"}) and Implementation Plan (${lock.planPath ?? "unavailable"}). Detected target: ${reviewGateToolPaths === null ? "unrecognized" : reviewGateToolPaths.join(", ") || "none"}. Retry with a supported edit tool and an exact relative path to one of those files. Do not use justice_review resolve to unlock file edits; rerun /justice-review-gate after addressing the findings.`;
        }
        return {
          action: "skip",
          reason: lockDecision.reason,
          ...(guidance === undefined ? {} : { guidance }),
        };
      }

      // Justice query tools must not perturb the canonical Observation Log (D50).
      if (input.tool.startsWith("justice_")) return PROCEED;

      const response = await justice.handleEvent({
        type: "PreToolUse",
        sessionId: input.sessionID,
        callId: input.callID,
        lockOwnerSessionId,
        reviewGateToolPaths,
        payload: {
          toolName: input.tool,
          callId: input.callID,
          toolInput: output.args,
        },
      });

      if (response.action !== "inject") {
        this.#finalizeTaskToolInput(isTask, input, output.args);
        return response;
      }

      const isMarkedReviewGateWorkerTask =
        isTask &&
        (originalPrompt.startsWith(REVIEW_GATE_EXECUTION_MARKER) ||
          originalPrompt.startsWith(REVIEW_GATE_REMEDIATION_MARKER));
      const modified = response.modifiedPayload as { args?: Record<string, unknown> } | undefined;
      if (isMarkedReviewGateWorkerTask && modified?.args === undefined) {
        this.#failClosedReviewGateTask(output.args, response.injectedContext);
        return response;
      }
      const modifiedPrompt = modified?.args?.prompt;
      if (isTask && typeof modifiedPrompt === "string") {
        output.args.prompt = modifiedPrompt;
      } else {
        output.args.prompt = `${response.injectedContext}\n\n${originalPrompt}`;
      }
      if (!modified?.args) {
        this.#finalizeTaskToolInput(isTask, input, output.args);
        return response;
      }

      for (const [key, value] of Object.entries(modified.args)) {
        if (
          key === "prompt" ||
          (isTask && (key === "task_id" || key === "taskId" || key === "justice_task_id"))
        ) continue;
        // eslint-disable-next-line security/detect-object-injection
        output.args[key] = value;
      }

      const justiceCategory = modified.args.category;
      if (
        isTask &&
        output.args.subagent_type === "general" &&
        typeof justiceCategory === "string" &&
        justiceCategory.startsWith("sp-")
      ) {
        delete output.args.subagent_type;
      }

      this.#finalizeTaskToolInput(isTask, input, output.args);
      return response;
    } catch (err) {
      if (reviewGateLockActive) {
        await this.log("error", "[Justice] Review Gate lock check failed closed", err);
        return { action: "skip", reason: "implementation_not_authorized" };
      }
      if (
        isTask &&
        (originalPrompt.startsWith(REVIEW_GATE_EXECUTION_MARKER) ||
          originalPrompt.startsWith(REVIEW_GATE_REMEDIATION_MARKER))
      ) {
        this.#failClosedReviewGateTask(
          output.args,
          "[JUSTICE: REVIEW GATE CLAIM BLOCKED] Justice failed while validating the marked Review Gate task.",
        );
      } else if (isTask) {
        normalizeTaskToolInputForOmoWireInPlace(output.args);
      }
      await this.log("error", "[Justice] onToolExecuteBefore failure", err);
      return PROCEED;
    }
  }

  #failClosedReviewGateTask(args: Record<string, unknown>, message: string): void {
    args.prompt = message;
    delete args.category;
    delete args.subagent_type;
    delete args.subagentType;
    args.run_in_background = false;
    delete args.runInBackground;
  }

  #isReviewGateControllerTask(args: Record<string, unknown>): boolean {
    const command = typeof args.command === "string" ? args.command : "";
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    const markedGatePrompt =
      prompt.startsWith(REVIEW_GATE_EXECUTION_MARKER) ||
      prompt.startsWith(REVIEW_GATE_REMEDIATION_MARKER);
    return (
      args.subagent_type === JUSTICE_REVIEW_CONTROLLER_AGENT &&
      (isJusticeReviewGateCommand(command) || (command.length === 0 && markedGatePrompt))
    );
  }

  #finalizeTaskToolInput(
    isTask: boolean,
    input: { readonly tool: string; readonly sessionID: string; readonly callID: string },
    args: Record<string, unknown>,
  ): void {
    if (!isTask) return;
    const subagentType = args.subagent_type;
    const category = args.category ?? subagentType;
    normalizeTaskToolInputForOmoWireInPlace(args);
    if (typeof subagentType === "string") {
      args.subagent_type = subagentType;
      delete args.category;
    }
    if (category === "sp-review" || category === "sp-final-review") {
      args.run_in_background = false;
    }
    this.#rememberReviewCategory(input, args);
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
    if (this.#noOp || !this.isSessionEnabled(input.sessionID)) return;

    try {
      if (input.tool === "task" && this.#isReviewGateControllerTask(input.args)) {
        await this.ensureInitialized();
        const planBridge = this.#justice?.getPlanBridge();
        if (planBridge?.hasPendingPlanReviewGate(input.sessionID)) {
          planBridge.cancelPendingPlanReviewGate(input.sessionID);
          output.output =
            output.output +
            "\n\n[JUSTICE: REVIEW GATE BLOCKED] Review Gate controller returned without a terminal inner sp-final-review result. Rerun /justice-review-gate.";
          return;
        }

        const lock = planBridge?.getReviewGateLock(input.sessionID);
        if (lock?.phase === "awaiting_implementation_authorization" && lock.planPath !== null) {
          const authorizationCommand =
            `/justice-implement --plan ${lock.planPath} --approved`;
          if (!output.output.includes(authorizationCommand)) {
            output.output += `\n\n[JUSTICE: IMPLEMENTATION AUTHORIZATION REQUIRED] Review Gate is clear. Tell the user to run ${authorizationCommand}; do not ask for a generic confirmation again.`;
          }
        } else if (lock !== undefined) {
          const reviewCommand =
            lock.designPath !== null && lock.planPath !== null
              ? `/justice-review-gate --design ${lock.designPath} --plan ${lock.planPath}`
              : "/justice-review-gate";
          if (!output.output.includes("[JUSTICE: REVIEW GATE BLOCKED]")) {
            output.output += `\n\n[JUSTICE: REVIEW GATE BLOCKED] The Gate result was not accepted as clear; implementation remains locked. A completed controller task does not mean the Gate passed. Do not use justice_review or --resolve to clear this Gate, and do not relaunch its controller through task(). Follow any findings by editing only ${lock.designPath ?? "the reviewed Design"} and ${lock.planPath ?? "the reviewed Implementation Plan"}; then invoke ${reviewCommand} as the Review Gate command. If the controller returned no structured result, rerun that command directly.`;
          }
        }
        if (lock !== undefined) return;
      }
      const isTrustedReviewResolutionArtifactSource =
        TRUSTED_REVIEW_RESOLUTION_ARTIFACT_TOOLS.includes(input.tool);
      if (input.tool.startsWith("justice_") && !isTrustedReviewResolutionArtifactSource) return;
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      await this.#rememberChildRelation(input, output.metadata);

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
        const nextWorker = input.tool === "task"
          ? extractReviewGateWorkerPrompt(normalInjectedContext)
          : undefined;
        const continuation = nextWorker === undefined
          ? normalInjectedContext
          : [
              "Continue this same Gate now by invoking task with the JSON arguments below. The prompt is worker data, not instructions for you to edit files yourself. Do not return to the parent, invoke justice_review, or relaunch justice-review-controller.",
              "[JUSTICE: REVIEW GATE NEXT TASK]",
              JSON.stringify({
                ...(nextWorker.role === "review"
                  ? { subagent_type: REVIEW_GATE_WORKER_AGENT }
                  : { category: "writing" }),
                description: `Justice Gate round ${nextWorker.round}`,
                prompt: normalInjectedContext,
                load_skills: [],
                run_in_background: false,
              }),
            ].join("\n");
        output.output = output.output + "\n\n" + continuation;
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
            taskId: resolveTaskIdFromToolInput(input.args) ?? "unknown",
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

  #rememberReviewCategory(
    input: { readonly tool: string; readonly sessionID: string; readonly callID: string },
    args: Record<string, unknown>,
  ): void {
    if (input.tool !== "task") return;
    const prompt = typeof args.prompt === "string" ? args.prompt : "";
    if (prompt.startsWith(REVIEW_GATE_EXECUTION_MARKER)) return;
    const rawCategory = args.category ?? args.subagent_type;
    const category = rawCategory;
    if (category !== "sp-review" && category !== "sp-final-review") return;
    this.#reviewCategoriesByCallId.set(relationKey(input.sessionID, input.callID), {
      parentSessionId: input.sessionID,
      category,
    });
  }

  async #rememberChildRelation(
    input: { readonly sessionID: string; readonly callID: string },
    metadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    const key = relationKey(input.sessionID, input.callID);
    const category = this.#reviewCategoriesByCallId.get(key);
    const childSessionId = typeof metadata?.sessionId === "string" ? metadata.sessionId : "";
    const parentSessionId = typeof metadata?.parentSessionId === "string" ? metadata.parentSessionId : "";
    if (category === undefined) return;
    if (
      childSessionId.length === 0 ||
      parentSessionId.length === 0 ||
      parentSessionId !== input.sessionID
    ) {
      this.#reviewCategoriesByCallId.delete(key);
      return;
    }
    this.#pendingChildRelations.set(key, {
      parentSessionId,
      parentCallId: input.callID,
      childSessionId,
      category: category.category,
    });
    await this.#tryForwardChildRelation(key);
  }

  async #captureChildSessionEvent(
    runtimeEventId: string | undefined,
    eventType: string,
    properties: Record<string, unknown>,
  ): Promise<void> {
    if (eventType !== "session.created" && eventType !== "session.updated") return;
    if (runtimeEventId === undefined || runtimeEventId.length === 0) return;
    const info = toRecord(properties.info);
    const childSessionId = typeof info.id === "string" ? info.id : "";
    const parentSessionId = typeof info.parentID === "string" ? info.parentID : "";
    if (childSessionId.length === 0 || parentSessionId.length === 0) return;
    this.#childSessionEvents.set(childSessionId, { runtimeEventId, parentSessionId });
    for (const [callId, pending] of this.#pendingChildRelations) {
      if (pending.childSessionId === childSessionId) {
        await this.#tryForwardChildRelation(callId);
      }
    }
  }

  #clearPendingChildRelationState(sessionId: string): void {
    if (sessionId.length === 0) return;
    for (const [key, category] of this.#reviewCategoriesByCallId) {
      if (category.parentSessionId === sessionId) this.#reviewCategoriesByCallId.delete(key);
    }
    for (const [key, pending] of this.#pendingChildRelations) {
      if (pending.parentSessionId === sessionId || pending.childSessionId === sessionId) {
        this.#pendingChildRelations.delete(key);
        this.#reviewCategoriesByCallId.delete(key);
      }
    }
  }

  #clearChildRelationState(sessionId: string): void {
    if (sessionId.length === 0) return;
    this.#clearPendingChildRelationState(sessionId);
    for (const [childSessionId, childEvent] of this.#childSessionEvents) {
      if (childSessionId === sessionId || childEvent.parentSessionId === sessionId) {
        this.#childSessionEvents.delete(childSessionId);
      }
    }
  }

  async #tryForwardChildRelation(key: string): Promise<void> {
    const pending = this.#pendingChildRelations.get(key);
    if (pending === undefined) return;
    const childEvent = this.#childSessionEvents.get(pending.childSessionId);
    if (childEvent === undefined || childEvent.parentSessionId !== pending.parentSessionId) return;
    await this.ensureInitialized();
    const justice = this.#justice;
    if (justice === null) return;
    const relation: DelegatedExecutionRelationObserved = {
      kind: "delegated_execution_relation_observed",
      provenance: "observed",
      runtimeEventId: childEvent.runtimeEventId,
      parentSessionId: pending.parentSessionId,
      parentCallId: pending.parentCallId,
      childSessionId: pending.childSessionId,
      category: pending.category,
    };
    this.#pendingChildRelations.delete(key);
    this.#reviewCategoriesByCallId.delete(key);
    await justice.handleEvent({
      type: "DelegatedExecutionRelationObserved",
      sessionId: pending.parentSessionId,
      callId: pending.parentCallId,
      payload: relation,
    });
  }

  /**
   * Handle Justice slash commands as OpenCode prompt-template rewrites.
   *
   * Recognized Justice commands replace the host-expanded template parts before
   * OpenCode continues into its normal prompt(). Start/implement and blocked/rejected
   * review commands become canonical synthetic text guidance. A successful Review Gate
   * preserves exactly one native OpenCode subtask part, retargeted to the dedicated
   * justice-review-controller. That wrapper child can see only the OmO plugin task tool
   * and delegates the exact Justice-owned reviewer prompt once through sp-final-review.
   *
   * Fail-open is structural here, not a style choice: the SDK handler resolves to
   * `Promise<void>` and `output` exposes only `parts`, so there is no channel by which a
   * plugin could deny or abort a command. Runtime failures therefore degrade to PROCEED.
   * Recognized commands with malformed arguments replace host-expanded template parts with
   * a synthetic `[JUSTICE: COMMAND REJECTED]` directive so raw arguments cannot masquerade
   * as an ordinary user prompt.
   *
   * `input.command` is accepted with or without its leading slash — the SDK does not
   * document which spelling it delivers, and all Justice command matchers tolerate both.
   */
  async onCommandExecuteBefore(
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput,
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      await this.log("info", `[Justice] onCommandExecuteBefore: command=${input.command}`);

      const normalizedCommand = input.command.trim().replace(/^\//u, "");
      if (normalizedCommand === "justice-enable") {
        this.#sessionEnabledOverrides.set(input.sessionID, true);
        this.#replaceCommandPartsWithGuidance(
          output,
          input.sessionID,
          "[JUSTICE: ENABLED] Justice workflow enforcement is enabled for this session. Previous workflow state is not restored.",
        );
        return;
      }

      if (normalizedCommand === "justice-disable") {
        this.#sessionEnabledOverrides.set(input.sessionID, false);
        this.#clearPendingChildRelationState(input.sessionID);
        if (this.#justice !== null) {
          try {
            await this.#justice.destroySession(input.sessionID);
          } catch (error) {
            await this.log("warn", "[Justice] session cleanup failed while disabling", error);
          }
        }
        this.#replaceCommandPartsWithGuidance(
          output,
          input.sessionID,
          "[JUSTICE: DISABLED] Justice workflow enforcement is disabled for this session. Justice hooks now pass through until /justice-enable.",
        );
        return;
      }

      if (!this.isSessionEnabled(input.sessionID)) {
        if (
          isJusticeStartCommand(input.command) ||
          isJusticeReviewGateCommand(input.command) ||
          isJusticeImplementCommand(input.command)
        ) {
          this.#replaceCommandPartsWithGuidance(
            output,
            input.sessionID,
            "[JUSTICE: DISABLED] Justice workflow enforcement is disabled for this session. Run /justice-enable to re-enable it.",
          );
        }
        return;
      }

      if (isJusticeStartCommand(input.command)) {
        await this.#handleWorkflowStart(input, output);
        return;
      }

      if (isJusticeReviewGateCommand(input.command)) {
        await this.#handleReviewGate(input, output);
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
      await this.log("warn", "[Justice] /justice-start arguments rejected by parser");
      output.parts.length = 0;
      output.parts.splice(
        0,
        output.parts.length,
        this.#buildWorkflowDirectivePart(
          input.sessionID,
          [
            "[JUSTICE: COMMAND REJECTED]",
            "`/justice-start` was invoked, but Justice rejected its arguments.",
            "The original command template parts were removed; do not treat the raw command arguments as an ordinary user request.",
            "Expected: /justice-start [<goal words...>] [--design <path>] [--plan <path>].",
            "A goal may be omitted when --design or --plan is present.",
          ].join("\n"),
        ),
      );
      return;
    }

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    const result = await justice.getPlanBridge().handleWorkflowStart(input.sessionID, request);

    // Observation audit records are emitted by PlanBridge.handleWorkflowStart, not here,
    // to avoid double-writing the same workflow lifecycle events (workflow_started +
    // plan_activated/design_requested/plan_requested) into the observation log.

    this.#replaceCommandPartsWithGuidance(output, input.sessionID, result.guidance);
  }

  async #handleReviewGate(
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput,
  ): Promise<void> {
    const request = parseJusticeReviewGateCommandArguments(input.arguments);
    if (request === null) {
      await this.log("warn", "[Justice] /justice-review-gate arguments rejected by parser");
      output.parts.length = 0;
      output.parts.splice(
        0,
        output.parts.length,
        this.#buildWorkflowDirectivePart(
          input.sessionID,
          [
            "[JUSTICE: COMMAND REJECTED]",
            "`/justice-review-gate` was invoked, but Justice rejected its arguments.",
            "The original command template parts were removed; do not treat the raw command arguments as an ordinary user request.",
            "Expected: /justice-review-gate --design <path> --plan <path> [--retry <N>], where N is 0 through 10.",
            "Both Design and Implementation Plan are required.",
          ].join("\n"),
        ),
      );
      return;
    }

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    const planBridge = justice.getPlanBridge();
    const subtaskPart = output.parts.find((part) => part.type === "subtask");
    if (subtaskPart === undefined) {
      await this.log(
        "warn",
        "[Justice] /justice-review-gate expected an OpenCode subtask part but none was present",
      );
      this.#replaceCommandPartsWithGuidance(
        output,
        input.sessionID,
        [
          "[JUSTICE: REVIEW GATE BLOCKED]",
          "OpenCode did not provide the controller subtask part required by this Review Gate.",
          "Review was not started. Verify that justice-review-gate is registered with the dedicated controller agent and subtask: true, then rerun /justice-review-gate.",
        ].join("\n"),
      );
      return;
    }

    const result = await planBridge.handleReviewGateStart(input.sessionID, request);
    if (!result.dispatched || result.reviewerPrompt === undefined) {
      this.#replaceCommandPartsWithGuidance(output, input.sessionID, result.guidance);
      return;
    }

    output.parts.splice(0, output.parts.length, {
      ...subtaskPart,
      prompt: result.reviewerPrompt,
      description: "Justice plan review gate",
    });
  }

  async #handleImplementationArm(
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput,
  ): Promise<void> {
    const request = parseJusticeImplementCommandArguments(input.arguments);
    if (request === null) {
      await this.log("warn", "[Justice] /justice-implement arguments rejected by parser");
      output.parts.length = 0;
      output.parts.splice(
        0,
        output.parts.length,
        this.#buildWorkflowDirectivePart(
          input.sessionID,
          [
            "[JUSTICE: COMMAND REJECTED]",
            "`/justice-implement` was invoked, but Justice rejected its arguments.",
            "The original command template parts were removed; do not treat the raw command arguments as an ordinary user request.",
            "Expected: /justice-implement --plan <path> --approved, or /justice-implement --cancel.",
          ].join("\n"),
        ),
      );
      return;
    }

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    const result = await justice.getPlanBridge().handleImplementationArm(input.sessionID, request);
    this.#replaceCommandPartsWithGuidance(output, input.sessionID, result.guidance);
  }

  /**
   * OpenCode custom commands are prompt templates. By the time command.execute.before
   * runs, the host has already expanded $ARGUMENTS and resolved @file references into
   * output.parts, and it will always call prompt() after this hook returns.
   *
   * For recognized Justice commands, never leave those host-expanded parts visible to
   * the model alongside Justice's canonical directive. Replace them atomically so the
   * LLM sees only the plugin-authored command result/guidance.
   */
  #replaceCommandPartsWithGuidance(
    output: CommandExecuteBeforeOutput,
    sessionId: string,
    guidance: string,
  ): void {
    output.parts.length = 0;
    if (guidance.length === 0) return;
    output.parts.push(this.#buildWorkflowDirectivePart(sessionId, guidance));
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
    if (this.#noOp || !this.isSessionEnabled(input.sessionID)) return;

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
