import type { ExecutionRole, SpCategory } from "./types";

const ROLE_TO_CATEGORY: Readonly<Record<ExecutionRole, SpCategory | undefined>> = {
  mechanical: "sp-mechanical",
  implementation: "sp-implementation",
  integration: "sp-integration",
  review: "sp-review",
  "final-review": "sp-final-review",
  deep: undefined,
  architecture: undefined,
};

const SP_CATEGORIES: ReadonlySet<SpCategory> = new Set([
  "sp-mechanical",
  "sp-implementation",
  "sp-integration",
  "sp-review",
  "sp-final-review",
]);

export class OmoCategoryMapper {
  map(role: ExecutionRole): SpCategory | undefined {
    return ROLE_TO_CATEGORY[role];
  }

  isSpCategory(value: string): value is SpCategory {
    return (SP_CATEGORIES as ReadonlySet<string>).has(value);
  }
}
