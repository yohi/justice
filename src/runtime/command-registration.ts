export interface JusticeCommandDefinition {
  readonly template: string;
  readonly description: string;
}

export interface CommandRegistrationEntry {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

export interface CommandRegistrationTarget {
  command?: Record<string, CommandRegistrationEntry>;
}

const justiceCommandDefinitions = {
  "justice-start": Object.freeze({
    template: "$ARGUMENTS",
    description: "Start a Justice-managed development workflow",
  }),
  "justice-review-gate": Object.freeze({
    template: "$ARGUMENTS",
    description: "Run the Justice planning Review Gate for the current Design and Plan",
  }),
  "justice-implement": Object.freeze({
    template: "$ARGUMENTS",
    description: "Arm the next Justice-managed implementation delegation",
  }),
} satisfies Record<string, JusticeCommandDefinition>;

export const JUSTICE_COMMAND_DEFINITIONS: Readonly<typeof justiceCommandDefinitions> =
  Object.freeze(justiceCommandDefinitions);

const JUSTICE_COMMAND_NAME_PATTERN = /^justice-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function listJusticeCommandNames(
  config: CommandRegistrationTarget,
): readonly string[] {
  return Object.keys(config.command ?? {})
    .filter((name) => JUSTICE_COMMAND_NAME_PATTERN.test(name))
    .sort((left, right) => left.localeCompare(right));
}

export function buildJusticeCommandSystemContext(
  config: CommandRegistrationTarget,
): string | undefined {
  const names = listJusticeCommandNames(config);
  if (names.length === 0) return undefined;

  return [
    "[JUSTICE: AVAILABLE USER SLASH COMMANDS]",
    "The OpenCode host has registered the following Justice slash commands:",
    ...names.map((name) => `- /${name}`),
    "These are user-invoked slash commands, not model-callable tools. Their absence from your tool list does not mean they are unavailable.",
    "Do not claim to have executed them. If execution is required, the user must invoke the slash command.",
    "`/justice-implement --approved` is an explicit user authorization boundary; never infer or supply approval on the user's behalf.",
  ].join("\n");
}

export type CommandRegistrationLogger = (
  level: "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
) => Promise<void>;

export async function registerJusticeCommands(
  config: CommandRegistrationTarget,
  log: CommandRegistrationLogger,
): Promise<void> {
  const commands = config.command ?? {};
  config.command = commands;

  for (const [name, definition] of Object.entries(JUSTICE_COMMAND_DEFINITIONS)) {
    if (Object.prototype.hasOwnProperty.call(commands, name)) {
      await log(
        "warn",
        `[Justice] Command "${name}" is already defined; skipping automatic registration.`,
      );
      continue;
    }
    commands[name] = { ...definition };
  }
}
