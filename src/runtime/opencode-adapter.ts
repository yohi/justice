import type { PluginInput } from "@opencode-ai/plugin";
import { JusticePlugin, createGlobalFs, type JusticePluginOptions } from "../core/justice-plugin";
import { matchesLoopError } from "../core/loop-error-patterns";
import { NodeFileSystem } from "./node-file-system";

export interface OpenCodeLogEntry {
  readonly level: "info" | "warn" | "error";
  readonly service: string;
  readonly message: string;
  readonly extra?: Record<string, unknown>;
}

/**
 * Structural bridge for OpenCode plugin initialization.
 * We extend PluginInput to explicitly capture properties we depend on.
 */
export type OpenCodePluginInit = PluginInput & {
  // Add specific requirements if they are missing or slightly different in PluginInput
  readonly project: PluginInput["project"] & { readonly root?: string };
};

export interface ToolInput {
  readonly tool: string;
  readonly sessionID: string;
  readonly callID: string;
  readonly args?: Record<string, unknown>;
}

/**
 * Interface representing the output of 'tool.execute.before' hook.
 */
export interface ToolBeforeOutput {
  args: Record<string, unknown>;
}

/**
 * Interface representing the output of 'tool.execute.after' hook.
 */
export interface ToolAfterOutput {
  title: string;
  readonly output: string;
  metadata: Record<string, unknown>;
}

export interface GenericEventInput {
  readonly event: {
    readonly type: string;
    readonly properties?: Record<string, unknown>;
  };
}

export type OpenCodeEvent = GenericEventInput;

export class OpenCodeAdapter {
  readonly #init: OpenCodePluginInit;
  readonly #noOp: boolean;
  readonly #workspaceRoot: string | null;
  #justice: JusticePlugin | null = null;
  #initPromise: Promise<void> | null = null;

  /**
   * For testing purposes, allows injecting a pre-initialized JusticePlugin.
   */
  public __injectJusticeForTest(justice: JusticePlugin): void {
    this.#justice = justice;
    this.#initPromise = Promise.resolve();
  }

  constructor(init: OpenCodePluginInit) {
    this.#init = init;
    this.#workspaceRoot = init.worktree ?? init.directory ?? init.project.root ?? null;
    this.#noOp = this.#workspaceRoot === null;
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
        body: {
          level,
          service: "justice",
          message,
          extra: args.length > 0 ? { args } : undefined,
        },
      });
    } catch {
      /* final defense line: never throw from the logging wrapper */
    }
  }

  async ensureInitialized(): Promise<void> {
    if (this.#noOp) return;
    if (this.#initPromise) {
      return this.#initPromise;
    }

    this.#initPromise = this.#runInit();
    return this.#initPromise;
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
      const justice = new JusticePlugin(localFs, localFs, {
        logger: loggerAdapter,
        onError: (err): void => {
          void this.log("error", "[Justice] internal error", err);
        },
        globalFileSystem: globalFs ?? undefined,
      });

      await justice.initialize();
      this.#justice = justice;
      await this.log("info", "Justice initialized via opencode-adapter");
    } catch (err) {
      this.#initPromise = null;
      this.#justice = null;
      await this.log("error", "[Justice] lazy init failed", err);
      throw err;
    }
  }

  async onEvent(input: OpenCodeEvent): Promise<void> {
    if (this.#noOp) return;

    try {
      const properties = input.event.properties ?? {};
      const sessionId = this.#readString(properties, "sessionID");
      if (!sessionId) return;

      if (input.event.type === "message.updated") {
        const info = this.#readRecord(properties, "info");
        const role = this.#readString(info, "role");
        const content = this.#readString(info, "content");
        if (role !== "user" || content.length === 0) return;

        await this.ensureInitialized();
        const justice = this.#justice;
        if (!justice) return;

        await justice.handleEvent({
          type: "Message",
          sessionId,
          payload: { role: "user", content },
        });
        return;
      }

      if (input.event.type === "session.error") {
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
    } catch (err) {
      await this.log("error", "[Justice] event hook failure", err);
    }
  }

  async onToolExecuteBefore(
    { callID: _callID, ...input }: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      if (input.tool !== "task") return;
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      const response = await justice.handleEvent({
        type: "PreToolUse",
        sessionId: input.sessionID,
        payload: {
          toolName: input.tool,
          toolInput: output.args,
        },
      });

      if (response.action !== "inject") return;

      const args = output.args;

      const originalPrompt = typeof args.prompt === "string" ? args.prompt : "";
      args.prompt = `${response.injectedContext}\n\n${originalPrompt}`;

      const modified = response.modifiedPayload as { args?: Record<string, unknown> } | undefined;
      if (!modified?.args) return;

      for (const [key, value] of Object.entries(modified.args)) {
        if (key === "prompt") continue;
        // eslint-disable-next-line security/detect-object-injection
        args[key] = value;
      }
    } catch (err) {
      await this.log("error", "[Justice] onToolExecuteBefore failure", err);
    }
  }

  async onToolExecuteAfter(
    { callID: _callID, args: _args, ...input }: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
    output: { title: string; readonly output: string; metadata: Record<string, unknown> },
  ): Promise<void> {
    if (this.#noOp) return;

    try {
      if (input.tool !== "task") return;
      await this.ensureInitialized();
      const justice = this.#justice;
      if (!justice) return;

      await justice.handleEvent({
        type: "PostToolUse",
        sessionId: input.sessionID,
        payload: {
          toolName: input.tool,
          toolResult: output.output,
          error: output.metadata.error === true,
        },
      });
      if (!output.title) {
        output.title =
          typeof output.metadata.title === "string" ? output.metadata.title : "task completed";
      }
    } catch (err) {
      await this.log("error", "[Justice] onToolExecuteAfter failure", err);
    }
  }

  async onSessionCompacting(
    input: { readonly sessionID: string },
    output: { context: string[]; prompt?: string },
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
