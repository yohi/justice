import type { ControllerAgent } from "./types";

const WORKFLOW_CONTROLLER_MAP: Readonly<Record<string, ControllerAgent>> = {
  brainstorming: "sisyphus",
  "writing-plans": "sisyphus",
  "subagent-driven-development": "atlas",
  "executing-plans": "sisyphus",
};

export class WorkflowRouter {
  resolveController(workflow: string): ControllerAgent | undefined {
    return WORKFLOW_CONTROLLER_MAP[workflow];
  }

  isKnownWorkflow(workflow: string): boolean {
    return Object.prototype.hasOwnProperty.call(WORKFLOW_CONTROLLER_MAP, workflow);
  }
}
