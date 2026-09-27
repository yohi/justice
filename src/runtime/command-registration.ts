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
  "justice-implement": Object.freeze({
    template: "$ARGUMENTS",
    description: "Arm the next Justice-managed implementation delegation",
  }),
} satisfies Record<string, JusticeCommandDefinition>;

export const JUSTICE_COMMAND_DEFINITIONS: Readonly<typeof justiceCommandDefinitions> =
  Object.freeze(justiceCommandDefinitions);

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
