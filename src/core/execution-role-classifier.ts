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
const MECHANICAL_KEYWORDS = ["rename", "typo", "constant", "boilerplate", "field", "config", "setting"] as const;
const TEST_ONLY_KEYWORDS = ["test only", "tests only", "test-only", "tests-only", "run tests only"] as const;
const DEEP_KEYWORDS = ["deep", "reasoning", "research", "investigate"] as const;
const ARCHITECTURE_KEYWORDS = ["architecture", "architect", "design system"] as const;

export class ExecutionRoleClassifier {
  classify(task: PlanTask): ExecutionRole {
    const text = `${task.title} ${task.steps.map((step) => step.description).join(" ")}`.toLowerCase();

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

  private matches(text: string, keywords: readonly string[]): boolean {
    const isWordCharacter = (character: string | undefined): boolean =>
      character !== undefined && /[a-z0-9_]/.test(character);

    return keywords.some((keyword) => {
      let index = text.indexOf(keyword);
      while (index !== -1) {
        const before = text[index - 1];
        const after = text[index + keyword.length];
        if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
        index = text.indexOf(keyword, index + 1);
      }
      return false;
    });
  }
}
