import type {
  ControllerAgent,
  ControllerConfigurationAssessment,
  ControllerPinnedCommand,
  ControllerRoutingDecision,
  ControllerWorkflow,
  DoctorEffectiveCommandDefinition,
} from "./types";

export const PINNED_COMMAND_WORKFLOW_MAP: ReadonlyMap<
  ControllerPinnedCommand,
  ControllerWorkflow
> = new Map([
  ["justice-implement-brainstorming", "brainstorming"],
  ["justice-implement-writing-plans", "writing-plans"],
  ["justice-implement-subagent-driven-development", "subagent-driven-development"],
  ["justice-implement-executing-plans", "executing-plans"],
]);

const WORKFLOW_PINNED_COMMAND_MAP: ReadonlyMap<
  ControllerWorkflow,
  ControllerPinnedCommand
> = new Map([
  ["brainstorming", "justice-implement-brainstorming"],
  ["writing-plans", "justice-implement-writing-plans"],
  ["subagent-driven-development", "justice-implement-subagent-driven-development"],
  ["executing-plans", "justice-implement-executing-plans"],
]);

const CONTROLLER_AGENTS = new Set<ControllerAgent>([
  "sisyphus",
  "atlas",
  "oracle",
  "momus",
  "hephaestus",
]);

export function resolvePinnedCommandWorkflow(command: string): ControllerWorkflow | undefined {
  return PINNED_COMMAND_WORKFLOW_MAP.get(command as ControllerPinnedCommand);
}

export function resolvePinnedCommandForWorkflow(
  workflow: ControllerWorkflow,
): ControllerPinnedCommand {
  const command = WORKFLOW_PINNED_COMMAND_MAP.get(workflow);
  if (command === undefined) {
    throw new Error(`No pinned command for controller workflow: ${workflow}`);
  }
  return command;
}

export function isRecognizedControllerAgent(value: unknown): value is ControllerAgent {
  return typeof value === "string" && CONTROLLER_AGENTS.has(value as ControllerAgent);
}

export function assessControllerConfiguration(input: {
  readonly decision: ControllerRoutingDecision;
  readonly pinnedCommand: ControllerPinnedCommand;
  readonly effectiveDefinition?: DoctorEffectiveCommandDefinition;
  readonly effectiveConfigAvailable: boolean;
}): ControllerConfigurationAssessment {
  const base = {
    workflow: input.decision.workflow,
    desiredController: input.decision.controller,
    pinnedCommand: input.pinnedCommand,
  } as const;

  if (!input.effectiveConfigAvailable) {
    return { ...base, status: "unsupported", reason: "effective_config_unsupported" };
  }

  const definition = input.effectiveDefinition;
  if (definition === undefined) {
    return { ...base, status: "missing", reason: "command_missing" };
  }

  if (definition.kind === "invalid") {
    return { ...base, status: "misconfigured", reason: "invalid_command_definition" };
  }

  const configuredController = definition.agent;
  if (configuredController === undefined) {
    return { ...base, status: "misconfigured", reason: "agent_missing" };
  }

  if (!isRecognizedControllerAgent(configuredController)) {
    return {
      ...base,
      configuredController,
      status: "misconfigured",
      reason: "agent_invalid",
    };
  }

  if (configuredController !== input.decision.controller) {
    return {
      ...base,
      configuredController,
      status: "misconfigured",
      reason: "agent_mismatch",
    };
  }

  return { ...base, configuredController, status: "configured" };
}
