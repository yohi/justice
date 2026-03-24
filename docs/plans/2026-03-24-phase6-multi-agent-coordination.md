# Phase 6: Multi-Agent Coordination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** plan.md内のタスク間依存関係を解析し、独立タスクの並列委譲・タスク内容に応じた自動カテゴリ選択・進捗の構造化レポートを実現する。

**Architecture:** Core Logic LayerにDependencyAnalyzer・CategoryClassifier・ProgressReporterの3つの純粋クラスを追加し、PlanBridgeのhook層から利用する。依存関係はplan.mdの`depends: task-N`マーカーとステップの進捗状態から推論する。カテゴリ選択はタスクタイトル・ステップ記述のキーワードマッチングで決定する。

**Tech Stack:** TypeScript, Vitest, bun

---

## Task 1: DependencyAnalyzer — タスク依存関係の解析

**Files:**
- Create: `src/core/dependency-analyzer.ts`
- Test: `tests/core/dependency-analyzer.test.ts`

**Step 1: Write the failing test**

Create `tests/core/dependency-analyzer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DependencyAnalyzer } from "../../src/core/dependency-analyzer";
import type { PlanTask } from "../../src/core/types";

const makeTasks = (): PlanTask[] => [
  {
    id: "task-1",
    title: "Setup project structure",
    steps: [
      { id: "task-1-step-1", description: "Create directory", checked: true, lineNumber: 5 },
      { id: "task-1-step-2", description: "Init config", checked: true, lineNumber: 6 },
    ],
    status: "completed",
  },
  {
    id: "task-2",
    title: "Implement core logic",
    steps: [
      { id: "task-2-step-1", description: "Write parser (depends: task-1)", checked: false, lineNumber: 10 },
      { id: "task-2-step-2", description: "Write tests", checked: false, lineNumber: 11 },
    ],
    status: "pending",
  },
  {
    id: "task-3",
    title: "Add documentation",
    steps: [
      { id: "task-3-step-1", description: "Write README", checked: false, lineNumber: 15 },
    ],
    status: "pending",
  },
  {
    id: "task-4",
    title: "Integration testing",
    steps: [
      { id: "task-4-step-1", description: "E2E tests (depends: task-2, task-3)", checked: false, lineNumber: 20 },
    ],
    status: "pending",
  },
];

describe("DependencyAnalyzer", () => {
  const analyzer = new DependencyAnalyzer();

  describe("extractDependencies", () => {
    it("should extract explicit depends: markers from step descriptions", () => {
      const tasks = makeTasks();
      const deps = analyzer.extractDependencies(tasks);

      expect(deps.get("task-2")).toEqual(["task-1"]);
      expect(deps.get("task-4")).toEqual(["task-2", "task-3"]);
    });

    it("should return empty array for tasks with no dependencies", () => {
      const tasks = makeTasks();
      const deps = analyzer.extractDependencies(tasks);

      expect(deps.get("task-1")).toEqual([]);
      expect(deps.get("task-3")).toEqual([]);
    });
  });

  describe("getParallelizable", () => {
    it("should identify independent tasks that can run in parallel", () => {
      const tasks = makeTasks();
      const parallel = analyzer.getParallelizable(tasks);

      // task-1 completed, task-2 depends on task-1 (completed) → ready
      // task-3 has no deps → ready
      // task-4 depends on task-2 and task-3 (both pending) → NOT ready
      expect(parallel.map((t) => t.id)).toContain("task-2");
      expect(parallel.map((t) => t.id)).toContain("task-3");
      expect(parallel.map((t) => t.id)).not.toContain("task-4");
    });

    it("should return empty array when all tasks are completed", () => {
      const tasks: PlanTask[] = [
        { id: "task-1", title: "Done", steps: [], status: "completed" },
      ];
      const parallel = analyzer.getParallelizable(tasks);
      expect(parallel).toHaveLength(0);
    });

    it("should detect circular dependencies and exclude those tasks", () => {
      const tasks: PlanTask[] = [
        {
          id: "task-1",
          title: "A",
          steps: [{ id: "s1", description: "do A (depends: task-2)", checked: false, lineNumber: 1 }],
          status: "pending",
        },
        {
          id: "task-2",
          title: "B",
          steps: [{ id: "s2", description: "do B (depends: task-1)", checked: false, lineNumber: 2 }],
          status: "pending",
        },
      ];
      const parallel = analyzer.getParallelizable(tasks);
      expect(parallel).toHaveLength(0);
    });
  });

  describe("buildExecutionOrder", () => {
    it("should return topological execution order", () => {
      const tasks = makeTasks();
      const order = analyzer.buildExecutionOrder(tasks);

      const indexOf = (id: string): number => order.findIndex((t) => t.id === id);
      expect(indexOf("task-1")).toBeLessThan(indexOf("task-2"));
      expect(indexOf("task-2")).toBeLessThan(indexOf("task-4"));
      expect(indexOf("task-3")).toBeLessThan(indexOf("task-4"));
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/dependency-analyzer.test.ts`
Expected: FAIL — Cannot find module `../../src/core/dependency-analyzer`

**Step 3: Write minimal implementation**

Create `src/core/dependency-analyzer.ts`:

```typescript
import type { PlanTask } from "./types";

const DEPENDS_REGEX = /\(depends:\s*(task-[\d]+(?:\s*,\s*task-[\d]+)*)\)/gi;

export class DependencyAnalyzer {
  /**
   * Extract explicit dependency declarations from step descriptions.
   * Format: (depends: task-1) or (depends: task-1, task-3)
   */
  extractDependencies(tasks: PlanTask[]): Map<string, string[]> {
    const deps = new Map<string, string[]>();

    for (const task of tasks) {
      const taskDeps = new Set<string>();
      for (const step of task.steps) {
        const matches = step.description.matchAll(DEPENDS_REGEX);
        for (const match of matches) {
          if (match[1]) {
            const ids = match[1].split(",").map((s) => s.trim());
            for (const id of ids) {
              taskDeps.add(id);
            }
          }
        }
      }
      deps.set(task.id, [...taskDeps]);
    }

    return deps;
  }

  /**
   * Identify tasks that can run in parallel:
   * - Not yet completed
   * - All dependencies are completed
   * - Not part of a circular dependency
   */
  getParallelizable(tasks: PlanTask[]): PlanTask[] {
    const deps = this.extractDependencies(tasks);
    const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // Detect circular dependencies
    const circularIds = this.detectCircular(deps, taskMap);

    return tasks.filter((task) => {
      if (task.status === "completed") return false;
      if (circularIds.has(task.id)) return false;

      const taskDeps = deps.get(task.id) ?? [];
      return taskDeps.every((depId) => completedIds.has(depId));
    });
  }

  /**
   * Returns tasks in topological execution order.
   * Completed tasks come first, then by dependency depth.
   */
  buildExecutionOrder(tasks: PlanTask[]): PlanTask[] {
    const deps = this.extractDependencies(tasks);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const result: PlanTask[] = [];

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      visited.add(id);

      const taskDeps = deps.get(id) ?? [];
      for (const depId of taskDeps) {
        if (taskMap.has(depId)) {
          visit(depId);
        }
      }

      const task = taskMap.get(id);
      if (task) result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private detectCircular(
    deps: Map<string, string[]>,
    taskMap: Map<string, PlanTask>,
  ): Set<string> {
    const circularIds = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const dfs = (id: string): boolean => {
      if (visiting.has(id)) return true; // cycle detected
      if (visited.has(id)) return false;

      visiting.add(id);
      const taskDeps = deps.get(id) ?? [];
      for (const depId of taskDeps) {
        if (taskMap.has(depId) && dfs(depId)) {
          circularIds.add(id);
          circularIds.add(depId);
          visiting.delete(id);
          return true;
        }
      }
      visiting.delete(id);
      visited.add(id);
      return false;
    };

    for (const id of deps.keys()) {
      dfs(id);
    }

    return circularIds;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/dependency-analyzer.test.ts`
Expected: PASS — All tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/core/dependency-analyzer.ts tests/core/dependency-analyzer.test.ts && git commit -m "feat(core): DependencyAnalyzerの実装 — タスク依存関係の解析と並列実行可能判定"
```

---

## Task 2: CategoryClassifier — タスクカテゴリの自動選択

**Files:**
- Create: `src/core/category-classifier.ts`
- Test: `tests/core/category-classifier.test.ts`

**Step 1: Write the failing test**

Create `tests/core/category-classifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { CategoryClassifier } from "../../src/core/category-classifier";
import type { PlanTask } from "../../src/core/types";

const makeTask = (title: string, steps: string[]): PlanTask => ({
  id: "task-1",
  title,
  steps: steps.map((desc, i) => ({
    id: `task-1-step-${i + 1}`,
    description: desc,
    checked: false,
    lineNumber: i + 5,
  })),
  status: "pending",
});

describe("CategoryClassifier", () => {
  const classifier = new CategoryClassifier();

  it("should classify UI/CSS/design tasks as visual-engineering", () => {
    const task = makeTask("Implement responsive navbar", ["Create CSS grid layout", "Add hover animations"]);
    expect(classifier.classify(task)).toBe("visual-engineering");
  });

  it("should classify architecture/design tasks as ultrabrain", () => {
    const task = makeTask("Design plugin architecture", ["Define interfaces", "Create dependency graph"]);
    expect(classifier.classify(task)).toBe("ultrabrain");
  });

  it("should classify test-only or small fix tasks as quick", () => {
    const task = makeTask("Fix typo in README", ["Correct spelling"]);
    expect(classifier.classify(task)).toBe("quick");
  });

  it("should classify writing/docs tasks as writing", () => {
    const task = makeTask("Write API documentation", ["Document endpoints", "Add examples"]);
    expect(classifier.classify(task)).toBe("writing");
  });

  it("should default to deep for implementation tasks", () => {
    const task = makeTask("Implement parser module", ["Write failing test", "Implement logic", "Run tests"]);
    expect(classifier.classify(task)).toBe("deep");
  });

  it("should handle empty steps gracefully", () => {
    const task = makeTask("Unknown task", []);
    expect(classifier.classify(task)).toBe("deep");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/category-classifier.test.ts`
Expected: FAIL — Cannot find module `../../src/core/category-classifier`

**Step 3: Write minimal implementation**

Create `src/core/category-classifier.ts`:

```typescript
import type { PlanTask, TaskCategory } from "./types";

interface CategoryRule {
  readonly category: TaskCategory;
  readonly keywords: readonly RegExp[];
}

const RULES: readonly CategoryRule[] = [
  {
    category: "visual-engineering",
    keywords: [
      /\b(?:CSS|UI|UX|layout|style|animation|responsive|design|frontend|visual|theme|color|font)\b/i,
      /\b(?:コンポーネント|レイアウト|デザイン|スタイル|画面)\b/,
    ],
  },
  {
    category: "ultrabrain",
    keywords: [
      /\b(?:architect|design\s+(?:pattern|system)|interface\s+design|dependency\s+graph|refactor|restructure)\b/i,
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
    category: "quick",
    keywords: [
      /\b(?:fix\s+(?:typo|spelling|indent)|rename|bump\s+version|update\s+(?:dep|dependency))\b/i,
      /\b(?:タイポ修正|名前変更)\b/,
    ],
  },
];

// Quick tasks should be ≤ 1 step
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
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/category-classifier.test.ts`
Expected: PASS — All tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/core/category-classifier.ts tests/core/category-classifier.test.ts && git commit -m "feat(core): CategoryClassifierの実装 — タスクカテゴリの自動選択"
```

---

## Task 3: ProgressReporter — 進捗レポート生成

**Files:**
- Create: `src/core/progress-reporter.ts`
- Test: `tests/core/progress-reporter.test.ts`

**Step 1: Write the failing test**

Create `tests/core/progress-reporter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ProgressReporter } from "../../src/core/progress-reporter";
import type { PlanTask } from "../../src/core/types";

const makeTasks = (): PlanTask[] => [
  {
    id: "task-1", title: "Setup", status: "completed",
    steps: [
      { id: "s1", description: "Init", checked: true, lineNumber: 1 },
      { id: "s2", description: "Config", checked: true, lineNumber: 2 },
    ],
  },
  {
    id: "task-2", title: "Implement", status: "in_progress",
    steps: [
      { id: "s3", description: "Write tests", checked: true, lineNumber: 3 },
      { id: "s4", description: "Write code", checked: false, lineNumber: 4 },
    ],
  },
  {
    id: "task-3", title: "Deploy", status: "pending",
    steps: [
      { id: "s5", description: "Build", checked: false, lineNumber: 5 },
      { id: "s6", description: "Push", checked: false, lineNumber: 6 },
    ],
  },
];

describe("ProgressReporter", () => {
  const reporter = new ProgressReporter();

  describe("generateReport", () => {
    it("should calculate overall progress percentage", () => {
      const report = reporter.generateReport(makeTasks());
      // 3/6 steps completed = 50%
      expect(report.overallProgress).toBe(50);
    });

    it("should include per-task status", () => {
      const report = reporter.generateReport(makeTasks());
      expect(report.taskStatuses).toHaveLength(3);
      expect(report.taskStatuses[0]).toEqual({
        taskId: "task-1", title: "Setup", status: "completed", completedSteps: 2, totalSteps: 2,
      });
      expect(report.taskStatuses[1]).toEqual({
        taskId: "task-2", title: "Implement", status: "in_progress", completedSteps: 1, totalSteps: 2,
      });
    });

    it("should handle empty task list", () => {
      const report = reporter.generateReport([]);
      expect(report.overallProgress).toBe(100);
      expect(report.taskStatuses).toHaveLength(0);
    });
  });

  describe("formatAsMarkdown", () => {
    it("should produce readable Markdown with progress bar", () => {
      const report = reporter.generateReport(makeTasks());
      const md = reporter.formatAsMarkdown(report);

      expect(md).toContain("50%");
      expect(md).toContain("✅ Setup");
      expect(md).toContain("🔄 Implement");
      expect(md).toContain("⬜ Deploy");
    });
  });

  describe("formatAsCompact", () => {
    it("should produce a single-line summary", () => {
      const report = reporter.generateReport(makeTasks());
      const compact = reporter.formatAsCompact(report);

      expect(compact).toContain("50%");
      expect(compact).toContain("1/3");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/progress-reporter.test.ts`
Expected: FAIL — Cannot find module `../../src/core/progress-reporter`

**Step 3: Write minimal implementation**

Create `src/core/progress-reporter.ts`:

```typescript
import type { PlanTask, PlanTaskStatus } from "./types";

export interface TaskStatus {
  readonly taskId: string;
  readonly title: string;
  readonly status: PlanTaskStatus;
  readonly completedSteps: number;
  readonly totalSteps: number;
}

export interface ProgressReport {
  readonly overallProgress: number; // 0-100
  readonly taskStatuses: TaskStatus[];
  readonly completedTasks: number;
  readonly totalTasks: number;
}

export class ProgressReporter {
  /**
   * Generate a structured progress report from parsed plan tasks.
   */
  generateReport(tasks: PlanTask[]): ProgressReport {
    if (tasks.length === 0) {
      return {
        overallProgress: 100,
        taskStatuses: [],
        completedTasks: 0,
        totalTasks: 0,
      };
    }

    const taskStatuses: TaskStatus[] = tasks.map((task) => {
      const completedSteps = task.steps.filter((s) => s.checked).length;
      return {
        taskId: task.id,
        title: task.title,
        status: task.status,
        completedSteps,
        totalSteps: task.steps.length,
      };
    });

    const totalSteps = taskStatuses.reduce((sum, t) => sum + t.totalSteps, 0);
    const completedSteps = taskStatuses.reduce((sum, t) => sum + t.completedSteps, 0);
    const completedTasks = tasks.filter((t) => t.status === "completed").length;

    return {
      overallProgress: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 100,
      taskStatuses,
      completedTasks,
      totalTasks: tasks.length,
    };
  }

  /**
   * Format a ProgressReport as readable Markdown.
   */
  formatAsMarkdown(report: ProgressReport): string {
    const lines: string[] = [];

    lines.push("## 📊 Progress Report");
    lines.push("");
    lines.push(`**Overall:** ${report.overallProgress}% (${report.completedTasks}/${report.totalTasks} tasks)`);
    lines.push("");

    for (const task of report.taskStatuses) {
      const icon = this.statusIcon(task.status);
      const progress = task.totalSteps > 0
        ? ` (${task.completedSteps}/${task.totalSteps} steps)`
        : "";
      lines.push(`- ${icon} ${task.title}${progress}`);
    }

    return lines.join("\n");
  }

  /**
   * Format a compact single-line summary.
   */
  formatAsCompact(report: ProgressReport): string {
    return `[JUSTICE Progress: ${report.overallProgress}% | ${report.completedTasks}/${report.totalTasks} tasks completed]`;
  }

  private statusIcon(status: PlanTaskStatus): string {
    switch (status) {
      case "completed":
        return "✅";
      case "in_progress":
        return "🔄";
      case "failed":
        return "❌";
      case "pending":
        return "⬜";
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/core/progress-reporter.test.ts`
Expected: PASS — All tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/core/progress-reporter.ts tests/core/progress-reporter.test.ts && git commit -m "feat(core): ProgressReporterの実装 — 進捗レポート生成"
```

---

## Task 4: PlanBridge並列委譲の統合

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `tests/hooks/plan-bridge.test.ts`

**Step 1: Write the failing test**

Add to `tests/hooks/plan-bridge.test.ts`:

```typescript
import { DependencyAnalyzer } from "../../src/core/dependency-analyzer";
import { CategoryClassifier } from "../../src/core/category-classifier";
import { ProgressReporter } from "../../src/core/progress-reporter";

describe("PlanBridge - Multi-Agent Coordination", () => {
  it("should include auto-classified category in delegation context", async () => {
    const planContent = [
      "### Task 1: Write API documentation",
      "- [ ] Document endpoints",
    ].join("\n");
    const reader = createMockFileReader({ "plan.md": planContent });
    const bridge = new PlanBridge(reader);
    bridge.setActivePlan("s-1", "plan.md");

    const event: PreToolUseEvent = {
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: {} },
      sessionId: "s-1",
    };
    const response = await bridge.handlePreToolUse(event);
    expect(response.action).toBe("inject");
    if (response.action === "inject") {
      expect(response.injectedContext).toContain("writing");
    }
  });

  it("should include progress summary in delegation context", async () => {
    const planContent = [
      "### Task 1: Setup",
      "- [x] Init project",
      "### Task 2: Implement",
      "- [ ] Write code",
    ].join("\n");
    const reader = createMockFileReader({ "plan.md": planContent });
    const bridge = new PlanBridge(reader);
    bridge.setActivePlan("s-1", "plan.md");

    const event: PreToolUseEvent = {
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: {} },
      sessionId: "s-1",
    };
    const response = await bridge.handlePreToolUse(event);
    expect(response.action).toBe("inject");
    if (response.action === "inject") {
      expect(response.injectedContext).toContain("Progress");
      expect(response.injectedContext).toContain("50%");
    }
  });

  it("should identify parallelizable tasks and mention them in context", async () => {
    const planContent = [
      "### Task 1: Setup",
      "- [x] Init project",
      "### Task 2: Implement feature A",
      "- [ ] Write code",
      "### Task 3: Write docs",
      "- [ ] Write README",
    ].join("\n");
    const reader = createMockFileReader({ "plan.md": planContent });
    const bridge = new PlanBridge(reader);
    bridge.setActivePlan("s-1", "plan.md");

    const event: PreToolUseEvent = {
      type: "PreToolUse",
      payload: { toolName: "task", toolInput: {} },
      sessionId: "s-1",
    };
    const response = await bridge.handlePreToolUse(event);
    expect(response.action).toBe("inject");
    if (response.action === "inject") {
      // Should mention that another task can run in parallel
      expect(response.injectedContext).toContain("Parallel");
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test tests/hooks/plan-bridge.test.ts`
Expected: FAIL — New tests fail

**Step 3: Integrate DependencyAnalyzer, CategoryClassifier, ProgressReporter into PlanBridge**

Modify `src/hooks/plan-bridge.ts` to:
1. Import `DependencyAnalyzer`, `CategoryClassifier`, `ProgressReporter`
2. Instantiate them in constructor
3. Use `CategoryClassifier` to auto-select category in `buildDelegationFromPlan`
4. Use `ProgressReporter` to add progress to delegation context
5. Use `DependencyAnalyzer` to identify parallel tasks and mention them in context

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: PASS — All tests pass (previous + new)

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/hooks/plan-bridge.ts tests/hooks/plan-bridge.test.ts && git commit -m "feat(hooks): PlanBridgeに並列委譲・カテゴリ自動選択・進捗レポートを統合"
```

---

## Task 5: エクスポート更新 + インテグレーションテスト

**Files:**
- Modify: `src/index.ts`
- Create: `tests/integration/multi-agent-flow.test.ts`

**Step 1: Update exports**

Add to `src/index.ts`:

```typescript
// Phase 6 Exports
export { DependencyAnalyzer } from "./core/dependency-analyzer";
export { CategoryClassifier } from "./core/category-classifier";
export { ProgressReporter } from "./core/progress-reporter";
```

**Step 2: Write integration test**

Create `tests/integration/multi-agent-flow.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DependencyAnalyzer } from "../../src/core/dependency-analyzer";
import { CategoryClassifier } from "../../src/core/category-classifier";
import { ProgressReporter } from "../../src/core/progress-reporter";
import { PlanParser } from "../../src/core/plan-parser";

describe("Multi-Agent Flow Integration", () => {
  it("should complete full flow: parse → classify → analyze deps → report progress", () => {
    const planContent = [
      "### Task 1: Setup project structure",
      "- [x] Create directory",
      "- [x] Init config",
      "### Task 2: Implement core parser",
      "- [ ] Write tests (depends: task-1)",
      "- [ ] Implement logic",
      "### Task 3: Write API documentation",
      "- [ ] Document endpoints",
      "### Task 4: Integration testing",
      "- [ ] Run E2E (depends: task-2, task-3)",
    ].join("\n");

    const parser = new PlanParser();
    const analyzer = new DependencyAnalyzer();
    const classifier = new CategoryClassifier();
    const reporter = new ProgressReporter();

    // Parse
    const tasks = parser.parse(planContent);
    expect(tasks).toHaveLength(4);

    // Classify
    expect(classifier.classify(tasks[0]!)).toBe("deep");
    expect(classifier.classify(tasks[2]!)).toBe("writing");

    // Analyze dependencies
    const parallel = analyzer.getParallelizable(tasks);
    expect(parallel.map((t) => t.id)).toContain("task-2");
    expect(parallel.map((t) => t.id)).toContain("task-3");
    expect(parallel.map((t) => t.id)).not.toContain("task-4");

    // Report
    const report = reporter.generateReport(tasks);
    expect(report.overallProgress).toBe(33); // 2/6 steps
    expect(report.completedTasks).toBe(1);
    const md = reporter.formatAsMarkdown(report);
    expect(md).toContain("✅ Setup");
  });
});
```

**Step 3: Run tests**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run typecheck && bun run test`
Expected: PASS — All tests pass

**Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add src/index.ts tests/integration/multi-agent-flow.test.ts && git commit -m "feat(index): Phase 6エクスポート追加 + マルチエージェントインテグレーションテスト"
```

---

## 完成状態

Phase 6完了時の新規ファイル:

| File | Role |
|------|------|
| `src/core/dependency-analyzer.ts` | plan.mdのタスク間依存DAG解析 |
| `src/core/category-classifier.ts` | タスク内容→OmOカテゴリ自動分類 |
| `src/core/progress-reporter.ts` | 構造化進捗レポート生成 |
| `tests/core/dependency-analyzer.test.ts` | 依存解析のユニットテスト |
| `tests/core/category-classifier.test.ts` | カテゴリ分類のユニットテスト |
| `tests/core/progress-reporter.test.ts` | 進捗レポートのユニットテスト |
| `tests/integration/multi-agent-flow.test.ts` | E2Eフローテスト |
