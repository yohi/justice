export interface JusticeCommandDefinition {
  readonly template: string;
  readonly description: string;
  readonly agent?: string;
  readonly subtask?: boolean;
}

export interface CommandRegistrationEntry {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

export interface JusticeAgentRegistrationEntry {
  readonly description: string;
  readonly mode: "subagent";
  readonly prompt: string;
  readonly permission: Readonly<Record<string, "allow" | "ask" | "deny">>;
}

export interface CommandRegistrationTarget {
  command?: Record<string, CommandRegistrationEntry>;
  agent?: Record<string, JusticeAgentRegistrationEntry | Record<string, unknown>>;
}

export const JUSTICE_REVIEW_CONTROLLER_AGENT = "justice-review-controller";

export const JUSTICE_REVIEW_CONTROLLER_DEFINITION: Readonly<JusticeAgentRegistrationEntry> =
  Object.freeze({
    description:
      "Justice-only controller that dispatches exactly one Design/Plan Review Gate task.",
    mode: "subagent",
    prompt: [
      "You are the Justice Review Gate controller.",
      "Do not review, inspect, summarize, or modify the artifacts yourself.",
      "For the single user message you receive, invoke the task tool exactly once.",
      'Use category="sp-final-review", run_in_background=false, load_skills=[], and description="Justice plan review gate".',
      "Pass the full user message byte-for-byte as the task prompt.",
      "Do not call call_omo_agent or any other tool.",
      "Do not alter, quote, wrap, or summarize the delegated prompt.",
      "After task returns, return its output verbatim with no additional prose.",
      'If task is unavailable or fails, return exactly "[JUSTICE: REVIEW GATE CONTROLLER FAILED]" and do not fall back.',
    ].join("\n"),
    permission: Object.freeze({
      "*": "deny",
      task: "allow",
    }),
  });

const justiceCommandDefinitions = {
  "justice-start": Object.freeze({
    template: "$ARGUMENTS",
    description: "Start a Justice-managed development workflow",
  }),
  "justice-implement": Object.freeze({
    template: "$ARGUMENTS",
    description: "Arm the next Justice-managed implementation delegation",
  }),
  "justice-review-gate": Object.freeze({
    template: "$ARGUMENTS",
    description: "Run the Justice Design / Implementation Plan review gate",
    agent: JUSTICE_REVIEW_CONTROLLER_AGENT,
    subtask: true,
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
  const agents = config.agent ?? {};
  config.command = commands;
  config.agent = agents;

  let reviewControllerAvailable = true;
  if (Object.prototype.hasOwnProperty.call(agents, JUSTICE_REVIEW_CONTROLLER_AGENT)) {
    reviewControllerAvailable = false;
    await log(
      "warn",
      `[Justice] Agent "${JUSTICE_REVIEW_CONTROLLER_AGENT}" is already defined; skipping automatic Review Gate controller registration.`,
    );
  } else {
    agents[JUSTICE_REVIEW_CONTROLLER_AGENT] = {
      ...JUSTICE_REVIEW_CONTROLLER_DEFINITION,
      permission: { ...JUSTICE_REVIEW_CONTROLLER_DEFINITION.permission },
    };
  }

  for (const [name, definition] of Object.entries(JUSTICE_COMMAND_DEFINITIONS)) {
    if (name === "justice-review-gate" && !reviewControllerAvailable) {
      if (!Object.prototype.hasOwnProperty.call(commands, name)) {
        await log(
          "warn",
          "[Justice] Review Gate command was not auto-registered because its dedicated controller agent is unavailable.",
        );
      }
      continue;
    }
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
