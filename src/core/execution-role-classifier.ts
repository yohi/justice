import type { ExecutionRole, PlanTask } from "./types";

const INTEGRATION_KEYWORDS = [
  "api",
  "interface",
  "module",
  "modules",
  "migration",
  "integration",
  "state",
  "concurrency",
  "async",
  "coordinate",
  "components",
] as const;
const MECHANICAL_KEYWORDS = [
  "rename",
  "typo",
  "constant",
  "boilerplate",
  "field",
  "config",
  "setting",
] as const;
const TEST_ONLY_KEYWORDS = [
  "test only",
  "tests only",
  "test-only",
  "tests-only",
  "run tests only",
] as const;
const DEEP_KEYWORDS = ["deep", "reasoning", "research", "investigate"] as const;
const ARCHITECTURE_KEYWORDS = ["architecture", "architect", "design system"] as const;
const FINAL_REVIEW_KEYWORDS = [/\bfinal review\b/u, /\bfinal-review\b/u] as const;
const REVIEW_KEYWORDS = [
  /\breview\b/u,
  /\breviewer\b/u,
  /(?<![A-Za-z0-9_])レビュー(?![A-Za-z0-9_])/u,
] as const;

export class ExecutionRoleClassifier {
  classify(task: PlanTask): ExecutionRole {
    const text =
      `${task.title} ${task.steps.map((step) => step.description).join(" ")}`.toLowerCase();

    if (this.matches(text, FINAL_REVIEW_KEYWORDS)) {
      return "final-review";
    }

    if (this.matches(text, REVIEW_KEYWORDS)) {
      return "review";
    }

    if (this.matches(text, INTEGRATION_KEYWORDS)) {
      return "integration";
    }

    if (this.matches(text, MECHANICAL_KEYWORDS)) {
      return "mechanical";
    }

    if (this.matches(text, TEST_ONLY_KEYWORDS)) {
      return "mechanical";
    }

    if (this.matches(text, DEEP_KEYWORDS)) {
      return "deep";
    }

    if (this.matches(text, ARCHITECTURE_KEYWORDS)) {
      return "architecture";
    }

    return "implementation";
  }

  private matches(
    text: string,
    keywords: readonly (string | RegExp)[],
  ): boolean {
    return keywords.some((keyword) =>
      typeof keyword === "string" ? text.includes(keyword) : keyword.test(text),
    );
  }
}
