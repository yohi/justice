import type { PlanTask, TaskCategory } from "./types";

interface CategoryRule {
  readonly category: TaskCategory;
  readonly keywords: readonly RegExp[];
}

const RULES: readonly CategoryRule[] = [
  {
    category: "quick",
    keywords: [
      /\b(?:fix\s+(?:typo|spelling|indent)|rename|bump\s+version|update\s+(?:dep|dependency))\b/i,
      /\b(?:タイポ修正|名前変更)\b/,
    ],
  },
  {
    category: "ultrabrain",
    keywords: [
      /\b(?:architect|architecture|design\s+(?:pattern|system)|interface\s+design|dependency\s+graph|refactor|restructure)\b/i,
      /\b(?:設計|アーキテクチャ|構造|リファクタ)\b/,
    ],
  },
  {
    category: "writing",
    keywords: [
      /\b(?:document|documentation|README|API\s+doc|write\s+(?:guide|tutorial)|changelog|CONTRIBUTING)\b/i,
      /\b(?:ドキュメント|文書|説明)\b/,
    ],
  },
  {
    category: "visual-engineering",
    keywords: [
      /\b(?:CSS|UI|UX|layout|style|animation|responsive|design|frontend|visual|theme|color|font)\b/i,
      /\b(?:コンポーネント|レイアウト|デザイン|スタイル|画面)\b/,
    ],
  },
];

// Quick tasks should be <= 1 step
const QUICK_MAX_STEPS = 1;

export class CategoryClassifier {
  /**
   * Classifies a PlanTask into a TaskCategory based on title and step descriptions.
   */
  classify(task: PlanTask): TaskCategory {
    const text = [task.title, ...task.steps.map((s) => s.description)].join(" ");

    for (const rule of RULES) {
      if (rule.keywords.some((kw) => kw.test(text))) {
        // Enforce quick's step count constraint
        if (rule.category === "quick" && task.steps.length > QUICK_MAX_STEPS) {
          continue;
        }
        return rule.category;
      }
    }

    return "deep"; // default
  }
}
