import { JusticePlugin, createGlobalFs, type JusticePluginOptions } from "../core/justice-plugin";
import { matchesLoopError } from "../core/loop-error-patterns";
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

interface GenericEventInput {
  readonly event: {
    readonly type: string;
    readonly properties?: Record<string, unknown>;
  };
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
      const properties = input.event.properties ?? {};

      switch (input.event.type) {
        case "message.updated":
          await this.#handleMessageUpdated(properties);
          return;
        case "message.part.updated":
          await this.#handleMessagePartUpdated(properties);
          return;
        case "session.error":
          await this.#handleSessionError(properties);
          return;
      }
    } catch (err) {
      await this.log("error", "[Justice] event hook failure", err);
    }
  }

  /**
   * Forward a `message.updated` event. Preserves the legacy user/assistant
   * content path (plan-bridge delegation) and additionally emits an
   * `AgentMapped` event (when an agent name is present) and an observation
   * `message_updated` payload for assistant messages.
   */
  async #handleMessageUpdated(properties: Record<string, unknown>): Promise<void> {
    const sessionId = this.#readString(properties, "sessionID");
    if (!sessionId) return;

    const info = this.#readRecord(properties, "info");
    const role = this.#readString(info, "role");
    const content = this.#readString(info, "content");
    const messageID = this.#readString(info, "id");

    // Use the message event as a trigger to ensure the plugin is initialized,
    // even if the content is temporarily empty (OpenCode event structure changes).
    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    // (1) Agent mapping: propagate the detected agent name so persona state can be
    // reconstructed later (D48/FIND-001). Full mapping lands in Task 3.4.
    const agentName = this.#resolveAgentName(properties, info);
    if (agentName) {
      await justice.handleEvent({
        type: "AgentMapped",
        payload: { sessionId, agentName },
      });
    }

    // (2) Legacy user/assistant content path (plan-bridge delegation). Preserved
    // exactly: only forwarded when content is present so empty streaming updates
    // do not spuriously trigger delegation.
    if ((role === "assistant" || role === "user") && content.length > 0) {
      await justice.handleEvent({
        type: "Message",
        sessionId,
        payload: { role, content },
      });
    }

    // (3) Observation message_updated for assistant messages, carrying the
    // finalization signal. Requires a messageID to be routable in the Observation
    // Log; unroutable (id-less) updates are dropped.
    if (role === "assistant" && messageID.length > 0) {
      await justice.handleEvent({
        type: "Message",
        sessionId,
        payload: {
          kind: "message_updated",
          sessionId,
          messageID,
          role: "assistant",
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
   * Forward a loop-like `session.error` event to the loop-detector. Unchanged
   * from the original behavior.
   */
  async #handleSessionError(properties: Record<string, unknown>): Promise<void> {
    const sessionId = this.#readString(properties, "sessionID");
    if (!sessionId) return;

    const message = this.#extractErrorMessage(this.#readUnknown(properties, "error"));
    if (!matchesLoopError(message)) return;

    await this.ensureInitialized();
    const justice = this.#justice;
    if (!justice) return;

    await justice.handleEvent({
      type: "Event",
      sessionId,
      payload: {
        eventType: "loop-detector",
        sessionId,
        message,
      },
    });
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
      if (input.tool.startsWith("justice_")) return;
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

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
          error: output.metadata?.error === true,
        },
      });

      // Nothing sets variant "gate_advisory" until Phase 5, so this branch is
      // dormant scaffolding; it must still be wired correctly and type-safely.
      if (response.action !== "inject" || response.variant !== "gate_advisory") return;

      const notifier = this.#notifier;

      // (1) Guaranteed channel: surface the gate advisory via the notifier. Wrapped
      // in its own try/catch so a notifier failure never breaks the tool flow.
      if (notifier) {
        try {
          await notifier.notify({
            level: "warning",
            variant: "justice_gate",
            title: "Task Gate",
            message: response.injectedContext,
            sessionId: input.sessionID,
            taskId: "unknown",
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
          message: response.injectedContext,
        });
        output.output = output.output + "\n\n" + banner;
      }
    } catch (err) {
      await this.log("error", "[Justice] onToolExecuteAfter failure", err);
    }
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
    const value = record[key];
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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
}
