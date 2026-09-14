import type { ControllerAgent, ControllerWorkflow } from "./types";

const WORKFLOW_CONTROLLER_MAP: ReadonlyMap<ControllerWorkflow, ControllerAgent> = new Map([
  ["brainstorming", "sisyphus"],
  ["writing-plans", "sisyphus"],
  ["subagent-driven-development", "atlas"],
  ["executing-plans", "sisyphus"],
]);

export class WorkflowRouter {
  resolveController(workflow: string): ControllerAgent | undefined {
    return WORKFLOW_CONTROLLER_MAP.get(workflow as ControllerWorkflow);
  }

  isKnownWorkflow(workflow: string): workflow is ControllerWorkflow {
    return WORKFLOW_CONTROLLER_MAP.has(workflow as ControllerWorkflow);
  }
}
