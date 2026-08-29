import { ExecutionRoleClassifier } from "./execution-role-classifier";
import { OmoCategoryMapper } from "./omo-category-mapper";
import type { PlanTask, SpCategory, TaskCategory } from "./types";

export class CategoryClassifier {
  private readonly roleClassifier = new ExecutionRoleClassifier();
  private readonly categoryMapper = new OmoCategoryMapper();

  classify(task: PlanTask): SpCategory | TaskCategory {
    const role = this.roleClassifier.classify(task);
    const category = this.categoryMapper.map(role);
    return category ?? "unspecified-low";
  }
}
