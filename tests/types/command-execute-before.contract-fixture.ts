/**
 * Compile-time contract fixture for the OpenCode `command.execute.before` hook.
 *
 * PURPOSE
 * -------
 * Pin the *exact* type contract that `@opencode-ai/plugin` publishes for
 * `command.execute.before`, so that an SDK upgrade which renames a field,
 * reshapes `output.parts`, or drops the hook entirely fails at compile time
 * instead of silently degrading the Justice adapter boundary.
 *
 * VERIFIED AGAINST (read from the resolved declaration, not from docs):
 *   @opencode-ai/plugin@1.14.21  -> node_modules/@opencode-ai/plugin/dist/index.d.ts
 *   @opencode-ai/sdk@1.14.21     -> node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts
 *
 * The declaration reads, verbatim:
 *
 *   "command.execute.before"?: (input: {
 *       command: string;
 *       sessionID: string;
 *       arguments: string;
 *   }, output: {
 *       parts: Part[];
 *   }) => Promise<void>;
 *
 * FAIL-OPEN PREMISE (AGENTS.md, non-negotiable invariant)
 * ------------------------------------------------------
 * The handler resolves to `Promise<void>` and `output` exposes only `parts`.
 * There is no return channel, status field, or thrown-error contract by which a
 * plugin can deny, veto, or abort command execution. Therefore a failure inside
 * this hook MUST NOT stop OpenCode execution: any adapter implementation has to
 * wrap its whole body in `try/catch` and degrade to PROCEED (leaving
 * `output.parts` untouched). The negative assertion
 * `rejectsUnknownOutputChannel` below encodes that there is structurally no
 * blocking channel to reach for.
 *
 * HOW THIS FILE PROVES ITSELF
 * ---------------------------
 * Every `@ts-expect-error` below is load-bearing: `tsc` reports TS2578
 * ("Unused '@ts-expect-error' directive") if the following line ever stops
 * erroring. So a single clean compile of this file simultaneously proves that
 * (a) the positive assertions still type-check and (b) the invalid usages still
 * fail. This file is compiled by `tests/types/tsconfig.json`, driven from
 * `command-execute-before.contract.test.ts`.
 *
 * This is a type-only fixture. It contains no production behaviour and nothing
 * here is imported by `src/`.
 */

import type { Hooks } from "@opencode-ai/plugin";

/**
 * Strict type identity (invariant in both directions, including optionality and
 * `readonly` modifiers). Resolves to `false` — and therefore breaks the
 * `= true` assignments below — the moment the SDK shape drifts.
 */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/* -------------------------------------------------------------------------- */
/* Derived contract — everything is read back off `Hooks`, never restated.     */
/* -------------------------------------------------------------------------- */

export type CommandExecuteBeforeHook = NonNullable<Hooks["command.execute.before"]>;
export type CommandExecuteBeforeInput = Parameters<CommandExecuteBeforeHook>[0];
export type CommandExecuteBeforeOutput = Parameters<CommandExecuteBeforeHook>[1];
export type CommandExecuteBeforePart = CommandExecuteBeforeOutput["parts"][number];
export type CommandExecuteBeforeReturn = ReturnType<CommandExecuteBeforeHook>;

/* -------------------------------------------------------------------------- */
/* 1. Registration key                                                        */
/* -------------------------------------------------------------------------- */

/** The hook is registered under this exact string-literal key on `Hooks`. */
export const REGISTRATION_KEY = "command.execute.before" satisfies keyof Hooks;

/**
 * `onCommandExecuteBefore` is a Justice *adapter method* name (mirroring the
 * existing `onToolExecuteBefore` convention in `src/runtime/opencode-adapter.ts`).
 * It is NOT an SDK registration key — the SDK only knows the dotted literal.
 */
// @ts-expect-error `onCommandExecuteBefore` is not a key of `Hooks`; the SDK key is "command.execute.before".
export const NOT_A_REGISTRATION_KEY = "onCommandExecuteBefore" satisfies keyof Hooks;

/** The hook is optional on `Hooks`, exactly like every other lifecycle hook. */
export const hookIsOptional: Equals<
  Hooks["command.execute.before"],
  CommandExecuteBeforeHook | undefined
> = true;

/** The hook takes exactly two positional parameters: `(input, output)`. */
export const hookArity: Equals<Parameters<CommandExecuteBeforeHook>["length"], 2> = true;

/* -------------------------------------------------------------------------- */
/* 2. `input` shape                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Exact input shape. Note `sessionID` (capital "ID") and `arguments` being a
 * single raw string — the SDK does NOT pre-split argv for us.
 */
export const inputShape: Equals<
  CommandExecuteBeforeInput,
  { command: string; sessionID: string; arguments: string }
> = true;

/** `arguments` is delivered as one raw string. */
export function argumentsIsRawString(input: CommandExecuteBeforeInput): string {
  return input.arguments;
}

export function argumentsIsNotAnArgvArray(input: CommandExecuteBeforeInput): readonly string[] {
  // @ts-expect-error `arguments` is a raw `string`, not a pre-split argv array.
  return input.arguments;
}

export function rejectsRenamedCommandField(input: CommandExecuteBeforeInput): unknown {
  // @ts-expect-error the field is `command`; `name` only exists on the SDK's `EventCommandExecuted` payload.
  return input.name;
}

export function rejectsLowerCaseSessionId(input: CommandExecuteBeforeInput): unknown {
  // @ts-expect-error the field is `sessionID` (capital ID); `sessionId` does not exist.
  return input.sessionId;
}

export function rejectsAbsentAgentField(input: CommandExecuteBeforeInput): unknown {
  // @ts-expect-error unlike "chat.message"/"chat.params", this input carries no `agent`.
  return input.agent;
}

export function rejectsAbsentMessageIdField(input: CommandExecuteBeforeInput): unknown {
  // @ts-expect-error this input carries no `messageID` (the SDK assigns it after the hook runs).
  return input.messageID;
}

/* -------------------------------------------------------------------------- */
/* 3. `output` shape and `output.parts` mutability                            */
/* -------------------------------------------------------------------------- */

/** `output` exposes exactly one member, a *mutable* `Part[]`. */
export const outputShape: Equals<
  CommandExecuteBeforeOutput,
  { parts: CommandExecuteBeforePart[] }
> = true;

/** Mutable, not `readonly Part[]` — mutation via `push` is the intended channel. */
export const partsIsMutable: Equals<
  CommandExecuteBeforeOutput["parts"],
  CommandExecuteBeforePart[]
> = true;

export function appendsDirectivePart(
  output: CommandExecuteBeforeOutput,
  part: CommandExecuteBeforePart,
): void {
  // Compiles only because `parts` is a mutable array.
  output.parts.push(part);
}

/**
 * A conforming text part. Every `Part` member requires the full identity triple
 * (`id`, `sessionID`, `messageID`) plus a discriminant `type` — an adapter cannot
 * append a bare `{ type: "text", text }` fragment.
 */
export const CONFORMING_TEXT_PART: CommandExecuteBeforePart = {
  id: "prt_justice_directive",
  sessionID: "ses_fixture",
  messageID: "msg_fixture",
  type: "text",
  text: "[JUSTICE] workflow directive",
};

/** Optional `TextPart` members accepted by the same union member. */
export const CONFORMING_SYNTHETIC_TEXT_PART: CommandExecuteBeforePart = {
  id: "prt_justice_directive_synthetic",
  sessionID: "ses_fixture",
  messageID: "msg_fixture",
  type: "text",
  text: "[JUSTICE] workflow directive",
  synthetic: true,
  ignored: false,
  time: { start: 0 },
  metadata: { justice: true },
};

export function rejectsPartMissingIdentityTriple(output: CommandExecuteBeforeOutput): void {
  output.parts.push(
    // @ts-expect-error a `Part` also requires `id`, `sessionID` and `messageID`.
    { type: "text", text: "[JUSTICE] workflow directive" },
  );
}

export function rejectsUnknownPartType(output: CommandExecuteBeforeOutput): void {
  output.parts.push({
    id: "prt_justice_directive",
    sessionID: "ses_fixture",
    messageID: "msg_fixture",
    // @ts-expect-error "workflow-directive" is not a discriminant of the SDK `Part` union.
    type: "workflow-directive",
    text: "[JUSTICE] workflow directive",
  });
}

export function rejectsBarePromptStringPart(output: CommandExecuteBeforeOutput): void {
  // @ts-expect-error `parts` elements are structured `Part` objects, never raw strings.
  output.parts.push("[JUSTICE] workflow directive");
}

/* -------------------------------------------------------------------------- */
/* 4. Return channel — fail-open is structural, not a style choice            */
/* -------------------------------------------------------------------------- */

/** The handler resolves to `void`: no verdict can be returned to OpenCode. */
export const resolvesToVoid: Equals<Awaited<CommandExecuteBeforeReturn>, void> = true;

export function rejectsUnknownOutputChannel(output: CommandExecuteBeforeOutput): void {
  // @ts-expect-error there is no `status`/deny channel — this hook cannot block command execution.
  output.status = "deny";
}

/* -------------------------------------------------------------------------- */
/* 5. A conforming handler, registered the way `src/opencode-plugin.ts` does  */
/* -------------------------------------------------------------------------- */

/**
 * Mirrors the existing registration style in `src/opencode-plugin.ts`
 * (`"tool.execute.before": async (input, output) => { ... }`) and the fail-open
 * boundary required by AGENTS.md: the body never rethrows, so a Justice failure
 * cannot stop the command.
 */
export const CONFORMING_HOOKS: Pick<Hooks, "command.execute.before"> = {
  "command.execute.before": async (input, output): Promise<void> => {
    try {
      if (input.command !== "justice-start") return;
      await Promise.resolve();
      output.parts.push({
        id: `prt_justice_${input.sessionID}`,
        sessionID: input.sessionID,
        messageID: `msg_justice_${input.sessionID}`,
        type: "text",
        text: `[JUSTICE] ${input.arguments}`,
        synthetic: true,
      });
    } catch {
      // Fail-open: degrade to PROCEED, leaving `output.parts` untouched.
    }
  },
};
