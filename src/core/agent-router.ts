import type { ControllerAgent } from "./types";
import { WorkflowRouter } from "./workflow-router";

export class AgentRouter {
  private readonly workflowRouter = new WorkflowRouter();

  routeController(workflow: string): ControllerAgent | undefined {
    return this.workflowRouter.resolveController(workflow);
  }
}
