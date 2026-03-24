import { PlanParser } from "./plan-parser";
import { TaskPackager, type PackageOptions } from "./task-packager";
import { CategoryClassifier } from "./category-classifier";
import { DependencyAnalyzer } from "./dependency-analyzer";
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
  private readonly classifier: CategoryClassifier;
  private readonly dependencyAnalyzer: DependencyAnalyzer;

  constructor() {
    this.parser = new PlanParser();
    this.packager = new TaskPackager();
    this.classifier = new CategoryClassifier();
    this.dependencyAnalyzer = new DependencyAnalyzer();
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

    // Select the first executable task (no unresolved dependencies)
    const executableTasks = this.dependencyAnalyzer.getParallelizable(tasks);
    if (executableTasks.length === 0) {
      // If no tasks are executable, but some are incomplete, there might be a cycle
      // or simply nothing left but blocked tasks. Fallback to parser's default if needed
      // or return null to stop.
      // For now, we strictly pick the first executable task.
      const anyIncomplete = this.parser.getNextIncompleteTask(tasks);
      if (!anyIncomplete) return null;

      // If there are incomplete tasks but none are executable (e.g. all blocked),
      // we might want to return the first incomplete one anyway to let the agent fail
      // with a dependency error message, or just return null.
      // Based on the test, we expect the DAG-based selection to pick the first possible one.
      return null;
    }

    const nextTask = executableTasks[0]!;

    const category = options.category ?? this.classifier.classify(nextTask);

    const packageOptions: PackageOptions = {
      planFilePath: options.planFilePath,
      referenceFiles: options.referenceFiles,
      rolePrompt: options.rolePrompt,
      previousLearnings: options.previousLearnings,
      runInBackground: options.runInBackground ?? false,
      category: category,
      loadSkills: options.loadSkills,
    };

    return this.packager.package(nextTask, packageOptions);
  }
}
