import { PlanParser } from "./plan-parser";
import { TaskPackager, type PackageOptions } from "./task-packager";
import type { DelegationRequest, TaskCategory } from "./types";

export interface BuildDelegationOptions {
  planFilePath: string;
  referenceFiles: string[];
  rolePrompt?: string;
  previousLearnings?: string;
  runInBackground?: boolean;
  category?: TaskCategory;
  loadSkills?: string[];
}

export class PlanBridgeCore {
  private readonly parser: PlanParser;
  private readonly packager: TaskPackager;

  constructor() {
    this.parser = new PlanParser();
    this.packager = new TaskPackager();
  }

  /**
   * Parse plan content and build a DelegationRequest for the next incomplete task.
   * Returns null if all tasks are completed.
   */
  buildDelegationFromPlan(
    planContent: string,
    options: BuildDelegationOptions,
  ): DelegationRequest | null {
    const tasks = this.parser.parse(planContent);
    const nextTask = this.parser.getNextIncompleteTask(tasks);

    if (!nextTask) return null;

    const packageOptions: PackageOptions = {
      planFilePath: options.planFilePath,
      referenceFiles: options.referenceFiles,
      rolePrompt: options.rolePrompt,
      previousLearnings: options.previousLearnings,
      runInBackground: options.runInBackground ?? false,
      category: options.category,
      loadSkills: options.loadSkills,
    };

    return this.packager.package(nextTask, packageOptions);
  }
}
