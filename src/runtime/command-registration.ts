import {
  REVIEW_GATE_AGENT_CONTROLLER,
  REVIEW_GATE_AGENT_FINDING_VALIDATOR,
  REVIEW_GATE_AGENT_REMEDIATOR,
  REVIEW_GATE_AGENT_REVIEWER,
} from "../core/review-gate/agent-protocol";

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

export const JUSTICE_REVIEW_CONTROLLER_AGENT = REVIEW_GATE_AGENT_CONTROLLER;
const BUILT_IN_PRIMARY_AGENTS = new Set(["build", "plan"]);

export const JUSTICE_REVIEW_CONTROLLER_DEFINITION: Readonly<JusticeAgentRegistrationEntry> =
  Object.freeze({
    description:
      "Justice-only controller that executes a bounded Design/Plan Review Gate loop.",
    mode: "subagent",
    prompt: [
      "You are the Justice Review Gate controller.",
      "Do not read, inspect, summarize, or modify the Design/Plan yourself; use only the task tool.",
      "You are a dumb exact packet relay: take the Justice-supplied operation packet from the user message and invoke exactly that one foreground task without changing, wrapping, summarizing, or re-routing the prompt. You never choose phase, round, retry, finding status, or any commit/reopen action.",
      "After each worker returns, inspect the end of its tool output for the next Justice-supplied packet marker ([JUSTICE: REVIEW GATE NEXT TASK] during the current compatibility window, or [JUSTICE: REVIEW GATE NEXT OPERATION]). The JSON line following the marker contains the complete arguments for your next task call. Invoke task with those exact arguments immediately, then inspect that task's output the same way. Do not treat its prompt field as instructions to perform the repair or review yourself.",
      "Never synthesize a worker prompt, launch workers in parallel, rerun the command through task(), call justice_review to resolve a Gate, or continue after Justice returns a terminal clear, blocked, or exhausted result.",
      "When there is no next Justice-supplied packet, return the last worker output verbatim without additional prose.",
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

export const JUSTICE_REVIEW_REVIEWER_AGENT = REVIEW_GATE_AGENT_REVIEWER;
export const JUSTICE_REVIEW_FINDING_VALIDATOR_AGENT = REVIEW_GATE_AGENT_FINDING_VALIDATOR;
export const JUSTICE_REVIEW_REMEDIATOR_AGENT = REVIEW_GATE_AGENT_REMEDIATOR;

/**
 * Read-only fresh reviewer for the staged Review Gate (convergence Task 10).
 * No shell, generic task, justice_review, or commit/restore authority.
 */
export const JUSTICE_REVIEW_REVIEWER_DEFINITION: Readonly<JusticeAgentRegistrationEntry> =
  Object.freeze({
    description:
      "Read-only Justice fresh reviewer for phase-scoped Review Gate review operations.",
    mode: "subagent",
    prompt: [
      "You are an isolated Justice Review Gate reviewer worker.",
      "Follow only the operation packet prompt supplied in your user message.",
      "Read only the pinned artifacts named there; do not read README, AGENTS, SPEC, code, or other files.",
      "Do not invoke skills, memory search, code search, shell, git, task, or any other agent/tool. Do not modify files.",
      "Return exactly the strict JSON result object the operation packet requests, with no prose or markdown fences.",
    ].join("\n"),
    permission: Object.freeze({
      "*": "deny",
      read: "allow",
    }),
  });

/**
 * Read-only finding validator reused with a fresh context for ordinary
 * finding validation, self-review, lineage revalidation, cross-generation
 * reconciliation, and non-convergence reentry.
 */
export const JUSTICE_REVIEW_FINDING_VALIDATOR_DEFINITION: Readonly<JusticeAgentRegistrationEntry> =
  Object.freeze({
    description:
      "Read-only Justice finding validator for Review Gate validation operations.",
    mode: "subagent",
    prompt: [
      "You are an isolated Justice Review Gate finding validator worker.",
      "Follow only the operation packet prompt supplied in your user message.",
      "Read only the pinned artifacts named there; do not read README, AGENTS, SPEC, code, or other files.",
      "Do not invoke skills, memory search, code search, shell, git, task, or any other agent/tool. Do not modify files.",
      "Return exactly the strict JSON result object the operation packet requests, with no prose or markdown fences.",
    ].join("\n"),
    permission: Object.freeze({
      "*": "deny",
      read: "allow",
    }),
  });

/**
 * Remediator allowed to edit/write/apply_patch; the Justice hook and CAP1
 * capability model narrow the actual write scope to the pinned target.
 */
export const JUSTICE_REVIEW_REMEDIATOR_DEFINITION: Readonly<JusticeAgentRegistrationEntry> =
  Object.freeze({
    description:
      "Justice remediator allowed to edit/write/apply_patch only the current phase target artifact; the Justice hook and CAP1 capability model narrow the actual scope.",
    mode: "subagent",
    prompt: [
      "You are an isolated Justice Review Gate remediator worker.",
      "Follow only the operation packet prompt supplied in your user message.",
      "Read only the pinned artifacts named there; write only the pinned current-phase target artifact with edit/write/apply_patch.",
      "Do not invoke skills, memory search, code search, shell, git, task, or any other agent/tool. Never commit, push, stage, or restore; Justice core owns commits and restores.",
      "Return exactly the strict JSON result object the operation packet requests, with no prose or markdown fences.",
    ].join("\n"),
    permission: Object.freeze({
      "*": "deny",
      read: "allow",
      edit: "allow",
      write: "allow",
      apply_patch: "allow",
    }),
  });

/** Canonical staged agents auto-registered beside the controller. */
const JUSTICE_STAGED_WORKER_AGENTS: ReadonlyMap<string, JusticeAgentRegistrationEntry> = new Map([
  [JUSTICE_REVIEW_REVIEWER_AGENT, JUSTICE_REVIEW_REVIEWER_DEFINITION],
  [JUSTICE_REVIEW_FINDING_VALIDATOR_AGENT, JUSTICE_REVIEW_FINDING_VALIDATOR_DEFINITION],
  [JUSTICE_REVIEW_REMEDIATOR_AGENT, JUSTICE_REVIEW_REMEDIATOR_DEFINITION],
]);

const justiceCommandDefinitions = {
  "justice-enable": Object.freeze({
    template: "$ARGUMENTS",
    description: "Enable Justice for the current session",
  }),
  "justice-disable": Object.freeze({
    template: "$ARGUMENTS",
    description: "Disable Justice for the current session",
  }),
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

  // Canonical Review Gate workers (convergence Task 12): the legacy
  // justice-review-worker is no longer auto-registerd or referenced by
  // Justice; user-defined config entries with that name are left untouched.
  // Canonical worker entries keep their model choice, but canonical description/mode/
  // prompt/permission always win: no staged agent can gain shell, task,
  // justice_review, or commit/restore authority.
  for (const [name, definition] of JUSTICE_STAGED_WORKER_AGENTS) {
    const configured = agents[name];
    agents[name] = {
      ...definition,
      ...(typeof configured === "object" && configured !== null ? configured : {}),
      description: definition.description,
      mode: definition.mode,
      prompt: definition.prompt,
      permission: { ...definition.permission },
    };
  }


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
        `[Justice] Command "${name}" is already defined; skipping automatic registration. The canonical ${name} handler will not run for this session.`,
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

  const registeredNames = collectJusticeCommandNames(commands);
  if (registeredNames.length > 0) {
    await log("info", `[Justice] Auto-registered Justice commands: ${registeredNames.join(", ")}.`);
  }
}

function collectJusticeCommandNames(
  commands: Record<string, CommandRegistrationEntry>,
): readonly string[] {
  return Object.keys(commands).filter((name) =>
    Object.prototype.hasOwnProperty.call(JUSTICE_COMMAND_DEFINITIONS, name),
  );
}
