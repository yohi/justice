import { REVIEW_GATE_WORKER_AGENT } from "../core/review-gate-execution";

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
  readonly model?: string;
}

export interface CommandRegistrationTarget {
  command?: Record<string, CommandRegistrationEntry>;
  agent?: Record<
    string,
    JusticeAgentRegistrationEntry | Record<string, unknown> | undefined
  >;
}

export const JUSTICE_REVIEW_CONTROLLER_AGENT = "justice-review-controller";
export const JUSTICE_REVIEW_WORKER_AGENT = REVIEW_GATE_WORKER_AGENT;
const BUILT_IN_PRIMARY_AGENTS = new Set(["build", "plan"]);

export const JUSTICE_REVIEW_CONTROLLER_DEFINITION: Readonly<JusticeAgentRegistrationEntry> =
  Object.freeze({
    description:
      "Justice-only controller that executes a bounded Design/Plan Review Gate loop.",
    mode: "subagent",
    prompt: [
      "You are the Justice Review Gate controller.",
      "Do not read, inspect, summarize, or modify the Design/Plan yourself; use only the task tool.",
      "Take the role-marked worker prompt from the user message and invoke exactly that one foreground task without changing, wrapping, or summarizing the prompt.",
      "The `Retry-Budget` header is the maximum number of additional remediation-and-review cycles; after a finding, keep following Justice-supplied role-marked prompts until the Gate is clear or the budget is exhausted.",
      "After each worker returns, inspect the end of its tool output for `[JUSTICE: REVIEW GATE NEXT TASK]`. The following JSON line contains the complete arguments for your next task call. Invoke task with those exact arguments immediately, then inspect that task's output the same way. Do not treat its prompt field as instructions to perform the repair or review yourself.",
      "Never synthesize a worker prompt, launch workers in parallel, rerun the command through task(), call justice_review to resolve a Gate, or continue after Justice returns a terminal clear, blocked, or exhausted result.",
      "When there is no next `[JUSTICE: REVIEW GATE NEXT TASK]` packet, return the last worker output verbatim without additional prose.",
      'If task is unavailable or fails, return exactly "[JUSTICE: REVIEW GATE CONTROLLER FAILED]" and do not fall back.',
    ].join("\n"),
    permission: Object.freeze({
      "*": "deny",
      task: "allow",
    }),
  });

export const JUSTICE_REVIEW_WORKER_DEFINITION: Readonly<JusticeAgentRegistrationEntry> =
  Object.freeze({
    description: "Read-only Justice worker for Design/Plan Review Gate tasks.",
    mode: "subagent",
    prompt: [
      "You are the isolated Justice Review Gate worker. Review only the Design and Implementation Plan named in the user message together.",
      "Read only those two named artifacts. Do not read README, AGENTS, SPEC, code, or other files.",
      "Do not invoke skills, memory search, code search, shell, task, or any other agent/tool. Do not modify files.",
      "Return exactly the JSON object and gateId requested in the user message, with no prose or markdown fences.",
    ].join("\n"),
    permission: Object.freeze({
      "*": "deny",
      read: "allow",
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
    description:
      "Run the Justice Design / Implementation Plan review gate with optional bounded retries",
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
  let reviewControllerModel: string | undefined;
  const configuredController = agents[JUSTICE_REVIEW_CONTROLLER_AGENT];
  if (configuredController !== undefined) {
    const configuredModel =
      typeof configuredController === "object" && configuredController !== null
        ? configuredController.model
        : undefined;
    if (typeof configuredModel === "string" && configuredModel.trim().length > 0) {
      reviewControllerModel = configuredModel;
      agents[JUSTICE_REVIEW_CONTROLLER_AGENT] = {
        ...JUSTICE_REVIEW_CONTROLLER_DEFINITION,
        ...configuredController,
        description: JUSTICE_REVIEW_CONTROLLER_DEFINITION.description,
        mode: JUSTICE_REVIEW_CONTROLLER_DEFINITION.mode,
        prompt: JUSTICE_REVIEW_CONTROLLER_DEFINITION.prompt,
        permission: { ...JUSTICE_REVIEW_CONTROLLER_DEFINITION.permission },
      };
    } else {
      reviewControllerAvailable = false;
      await log(
        "warn",
        `[Justice] Agent "${JUSTICE_REVIEW_CONTROLLER_AGENT}" is already defined without a model; skipping automatic Review Gate controller registration.`,
      );
    }
  } else {
    agents[JUSTICE_REVIEW_CONTROLLER_AGENT] = {
      ...JUSTICE_REVIEW_CONTROLLER_DEFINITION,
      permission: { ...JUSTICE_REVIEW_CONTROLLER_DEFINITION.permission },
    };
  }

  const configuredWorker = agents[JUSTICE_REVIEW_WORKER_AGENT];
  agents[JUSTICE_REVIEW_WORKER_AGENT] = {
    ...JUSTICE_REVIEW_WORKER_DEFINITION,
    ...(typeof configuredWorker === "object" && configuredWorker !== null
      ? configuredWorker
      : {}),
    description: JUSTICE_REVIEW_WORKER_DEFINITION.description,
    mode: JUSTICE_REVIEW_WORKER_DEFINITION.mode,
    prompt: JUSTICE_REVIEW_WORKER_DEFINITION.prompt,
    permission: { ...JUSTICE_REVIEW_WORKER_DEFINITION.permission },
  };

  const justiceStart = commands["justice-start"];
  const configuredStartAgent = justiceStart?.agent;
  const configuredStartAgentAvailable =
    BUILT_IN_PRIMARY_AGENTS.has(configuredStartAgent ?? "") ||
    (configuredStartAgent !== undefined && agents[configuredStartAgent] !== undefined);
  if (
    justiceStart &&
    configuredStartAgent !== undefined &&
    !configuredStartAgentAvailable
  ) {
    delete justiceStart.agent;
    await log(
      "warn",
      `[Justice] /justice-start targets unavailable agent "${configuredStartAgent}"; falling back to the current agent.`,
    );
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
    commands[name] = {
      ...definition,
      ...(name === "justice-review-gate" && reviewControllerModel !== undefined
        ? { model: reviewControllerModel }
        : {}),
    };
  }
}
