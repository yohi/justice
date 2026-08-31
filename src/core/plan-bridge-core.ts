import { ExecutionRoleClassifier } from "./execution-role-classifier";
import { OmoCategoryMapper } from "./omo-category-mapper";
import { TaskPackager, type PackageOptions } from "./task-packager";
import type {
  ControllerAgent,
  DelegationRequest,
  ExecutionRole,
  PlanTask,
  SpCategory,
  TaskCategory,
} from "./types";
import { WorkflowRouter } from "./workflow-router";

export interface ControllerOptions {
  readonly taskId: string;
  readonly prompt: string;
  readonly loadSkills?: readonly string[];
}

export interface WorkerOptions extends PackageOptions {
  readonly category?: SpCategory | TaskCategory;
  readonly role?: ExecutionRole;
}

export class PlanBridgeCore {
  private readonly workflowRouter = new WorkflowRouter();
  private readonly taskPackager = new TaskPackager();
  private readonly categoryMapper = new OmoCategoryMapper();
  private readonly roleClassifier = new ExecutionRoleClassifier();

  resolveController(workflow: string): ControllerAgent | undefined {
    return this.workflowRouter.resolveController(workflow);
  }

  buildControllerRequest(
    workflow: string,
    options: ControllerOptions,
  ): { readonly controller: ControllerAgent; readonly request: DelegationRequest } | undefined {
    const controller = this.resolveController(workflow);
    if (controller === undefined) return undefined;

    const request = this.taskPackager.package("quick", {
      taskId: options.taskId,
      prompt: options.prompt,
      loadSkills: options.loadSkills,
    });
    return { controller, request };
  }

  classifyAndBuildWorkerRequest(
    planTask: PlanTask,
    options: WorkerOptions,
  ): { readonly category: SpCategory | TaskCategory; readonly request: DelegationRequest } | undefined {
    const role = options.role ?? this.roleClassifier.classify(planTask);
    return this.buildWorkerRequest(role, options);
  }

  buildWorkerRequest(
    role: ExecutionRole,
    options: WorkerOptions,
  ): { readonly category: SpCategory | TaskCategory; readonly request: DelegationRequest } | undefined {
    const category = options.category ?? this.categoryMapper.map(role);
    if (category === undefined) return undefined;

    return {
      category,
      request: this.taskPackager.package(category, options),
    };
  }
}
