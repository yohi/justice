import type { ControllerAgent } from "./types";

const WORKFLOW_CONTROLLER_MAP: ReadonlyMap<string, ControllerAgent> = new Map([
  ["brainstorming", "sisyphus"],
  ["writing-plans", "sisyphus"],
  ["subagent-driven-development", "atlas"],
  ["executing-plans", "sisyphus"],
]);

export class WorkflowRouter {
  resolveController(workflow: string): ControllerAgent | undefined {
    return WORKFLOW_CONTROLLER_MAP.get(workflow);
  }

  isKnownWorkflow(workflow: string): boolean {
    return WORKFLOW_CONTROLLER_MAP.has(workflow);
  }
}
