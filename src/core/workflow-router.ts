import type { ControllerAgent, ControllerPinnedCommand, ControllerWorkflow } from "./types";

/** controller workflow → desired controller の完全な対応（4件のみ）。他の workflow は解決対象外。 */
export const WORKFLOW_DESIRED_CONTROLLERS: ReadonlyMap<ControllerWorkflow, ControllerAgent> =
  new Map([
    ["brainstorming", "sisyphus"],
    ["writing-plans", "sisyphus"],
    ["subagent-driven-development", "atlas"],
    ["executing-plans", "sisyphus"],
  ]);

/** pinned command → controller workflow の完全な対応（4件のみ）。エイリアス・前方一致・曖昧一致は不採用。 */
export const PINNED_COMMAND_WORKFLOW_MAP: ReadonlyMap<ControllerPinnedCommand, ControllerWorkflow> =
  new Map([
    ["justice-implement-brainstorming", "brainstorming"],
    ["justice-implement-writing-plans", "writing-plans"],
    ["justice-implement-subagent-driven-development", "subagent-driven-development"],
    ["justice-implement-executing-plans", "executing-plans"],
  ]);

const CONTROLLER_WORKFLOW_KEYS: ReadonlySet<string> = new Set<string>(
  WORKFLOW_DESIRED_CONTROLLERS.keys(),
);

const PINNED_COMMAND_KEYS: ReadonlySet<string> = new Set<string>(PINNED_COMMAND_WORKFLOW_MAP.keys());

/** 文字列が既知の controller workflow と exact 一致するかを判定する型ガード。 */
export function isControllerWorkflow(workflow: string): workflow is ControllerWorkflow {
  return CONTROLLER_WORKFLOW_KEYS.has(workflow);
}

/** 文字列が既知の pinned command と exact 一致するかを判定する型ガード。 */
export function isControllerPinnedCommand(command: string): command is ControllerPinnedCommand {
  return PINNED_COMMAND_KEYS.has(command);
}

/** pinned command を exact equality で controller workflow へ解決する。 */
export function resolvePinnedCommandWorkflow(command: string): ControllerWorkflow | undefined {
  return isControllerPinnedCommand(command) ? PINNED_COMMAND_WORKFLOW_MAP.get(command) : undefined;
}

export class WorkflowRouter {
  resolveController(workflow: string): ControllerAgent | undefined {
    return isControllerWorkflow(workflow) ? WORKFLOW_DESIRED_CONTROLLERS.get(workflow) : undefined;
  }

  isKnownWorkflow(workflow: string): boolean {
    return isControllerWorkflow(workflow);
  }
}
