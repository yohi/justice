# Justice Plugin Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the project foundation and core logic layer for the Justice plugin — the nervous system connecting Superpowers and oh-my-openagent.

**Architecture:** Hook-first OpenCode plugin with pure core logic layer (no OmO dependency) and hook layer for OmO integration. Vitest + bun for testing. Devcontainer for reproducible environment.

**Tech Stack:** TypeScript, Node.js, bun, Vitest, ESLint, Prettier

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.eslintrc.json`
- Create: `.prettierrc`
- Create: `.gitignore`

**Step 1: Initialize package.json**

```bash
cd "$(git rev-parse --show-toplevel)" && bun init -y
```

**Step 2: Install dependencies**

```bash
cd "$(git rev-parse --show-toplevel)" && bun add -d typescript vitest @types/node eslint prettier eslint-config-prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
```

**Step 5: Create .eslintrc.json**

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2022,
    "sourceType": "module"
  },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/explicit-function-return-type": "warn"
  }
}
```

**Step 6: Create .prettierrc**

```json
{
  "semi": true,
  "singleQuote": false,
  "tabWidth": 2,
  "trailingComma": "all",
  "printWidth": 100
}
```

**Step 7: Create .gitignore**

```text
node_modules/
dist/
coverage/
.DS_Store
*.tsbuildinfo
```

**Step 8: Update package.json scripts**

Add these scripts to package.json:

```json
{
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/ tests/",
    "format": "prettier --write 'src/**/*.ts' 'tests/**/*.ts'",
    "typecheck": "tsc --noEmit"
  }
}
```

**Step 9: Verify setup**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run typecheck`
Expected: No errors (no source files yet, should pass cleanly)

**Step 10: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: プロジェクト足場の構築 (package.json, tsconfig, vitest, eslint)"
```

---

## Task 2: Devcontainer Setup

**Files:**
- Create: `.devcontainer/Dockerfile`
- Create: `.devcontainer/devcontainer.json`

**Step 1: Create Dockerfile**

Create `.devcontainer/Dockerfile`:

```dockerfile
FROM oven/bun:1

# Install development tools
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
```

**Step 2: Create devcontainer.json**

Create `.devcontainer/devcontainer.json`:

```jsonc
{
  "name": "Justice Plugin Dev",
  "build": {
    "dockerfile": "Dockerfile"
  },
  "features": {
    "ghcr.io/devcontainers/features/common-utils:2": {}
  },
  "postCreateCommand": "bun install",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "vitest.explorer"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode"
      }
    }
  },
  "remoteUser": "root"
}
```

**Step 3: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: Devcontainer環境の構築"
```

---

## Task 3: Core Types Definition

**Files:**
- Create: `src/core/types.ts`
- Test: `tests/core/types.test.ts`

**Step 1: Write the failing test**

Create `tests/core/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type {
  PlanTask,
  PlanStep,
  DelegationRequest,
  DelegationContext,
  TaskFeedback,
  TestSummary,
  ErrorClass,
  TaskCategory,
  ProtectedContext,
} from "../../src/core/types";

describe("Core Types", () => {
  it("should allow creating a valid PlanTask", () => {
    const task: PlanTask = {
      id: "task-1",
      title: "Setup project",
      steps: [],
      status: "pending",
    };
    expect(task.id).toBe("task-1");
    expect(task.status).toBe("pending");
  });

  it("should allow creating a valid PlanStep", () => {
    const step: PlanStep = {
      id: "task-1-step-1",
      description: "Create directory",
      checked: false,
      lineNumber: 5,
    };
    expect(step.checked).toBe(false);
  });

  it("should allow creating a valid DelegationRequest", () => {
    const req: DelegationRequest = {
      category: "deep",
      prompt: "Implement feature X",
      loadSkills: ["git-master"],
      runInBackground: false,
      context: {
        planFilePath: "docs/plans/plan.md",
        taskId: "task-1",
        referenceFiles: ["src/main.ts"],
      },
    };
    expect(req.category).toBe("deep");
    expect(req.context.referenceFiles).toHaveLength(1);
  });

  it("should allow creating a valid TaskFeedback", () => {
    const feedback: TaskFeedback = {
      taskId: "task-1",
      status: "success",
      retryCount: 0,
      testResults: {
        passed: 5,
        failed: 0,
        skipped: 1,
      },
    };
    expect(feedback.status).toBe("success");
  });

  it("should allow all ErrorClass values", () => {
    const errors: ErrorClass[] = [
      "syntax_error",
      "type_error",
      "test_failure",
      "design_error",
      "timeout",
      "loop_detected",
      "unknown",
    ];
    expect(errors).toHaveLength(7);
  });

  it("should allow all TaskCategory values", () => {
    const categories: TaskCategory[] = [
      "visual-engineering",
      "ultrabrain",
      "deep",
      "quick",
      "unspecified-low",
      "unspecified-high",
      "writing",
    ];
    expect(categories).toHaveLength(7);
  });

  it("should allow creating a valid ProtectedContext", () => {
    const ctx: ProtectedContext = {
      planSnapshot: "# Plan\n- [ ] Task 1",
      currentTaskId: "task-1",
      currentStepId: "task-1-step-2",
      accumulatedLearnings: "Use ESM imports",
      timestamp: "2026-03-24T01:00:00Z",
    };
    expect(ctx.currentTaskId).toBe("task-1");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: FAIL — Cannot find module `../../src/core/types`

**Step 3: Write minimal implementation**

Create `src/core/types.ts`:

```typescript
/** plan.mdから抽出されたタスク */
export interface PlanTask {
  readonly id: string;
  readonly title: string;
  readonly steps: PlanStep[];
  readonly status: PlanTaskStatus;
}

export type PlanTaskStatus = "pending" | "in_progress" | "completed" | "failed";

/** plan.md内の個別ステップ */
export interface PlanStep {
  readonly id: string;
  readonly description: string;
  readonly checked: boolean;
  readonly lineNumber: number;
}

/** task()ツールに渡すパッケージ化されたリクエスト */
export interface DelegationRequest {
  readonly category: TaskCategory;
  readonly prompt: string;
  readonly loadSkills: string[];
  readonly runInBackground: boolean;
  readonly context: DelegationContext;
}

/** タスク委譲のコンテキスト情報 */
export interface DelegationContext {
  readonly planFilePath: string;
  readonly taskId: string;
  readonly referenceFiles: string[];
  readonly rolePrompt?: string;
  readonly previousLearnings?: string;
}

/** task()完了後のフィードバック */
export interface TaskFeedback {
  readonly taskId: string;
  readonly status: TaskFeedbackStatus;
  readonly diff?: string;
  readonly testResults?: TestSummary;
  readonly unresolvedIssues?: string[];
  readonly retryCount: number;
  readonly errorClassification?: ErrorClass;
}

export type TaskFeedbackStatus = "success" | "failure" | "timeout" | "compaction_risk";

/** テスト結果サマリー */
export interface TestSummary {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly failureDetails?: string[];
}

/** エラー分類 */
export type ErrorClass =
  | "syntax_error"
  | "type_error"
  | "test_failure"
  | "design_error"
  | "timeout"
  | "loop_detected"
  | "unknown";

/** task()に渡すカテゴリ（OmO準拠） */
export type TaskCategory =
  | "visual-engineering"
  | "ultrabrain"
  | "deep"
  | "quick"
  | "unspecified-low"
  | "unspecified-high"
  | "writing";

/** コンパクション時に保護すべき状態 */
export interface ProtectedContext {
  readonly planSnapshot: string;
  readonly currentTaskId: string;
  readonly currentStepId: string;
  readonly accumulatedLearnings: string;
  readonly timestamp: string;
}

/** リトライポリシー */
export interface RetryPolicy {
  readonly maxRetries: number;
  readonly retryableErrors: ErrorClass[];
}

/** デフォルトのリトライポリシー */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  retryableErrors: ["syntax_error", "type_error"],
};
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: PASS — All 7 tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: コアデータモデルの型定義"
```

---

## Task 4: Test Fixtures

**Files:**
- Create: `tests/fixtures/sample-plan.md`
- Create: `tests/fixtures/sample-plan-partial.md`
- Create: `tests/fixtures/sample-design.md`

**Step 1: Create sample-plan.md**

```markdown
# Feature X Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans

**Goal:** Implement feature X with full test coverage.

**Architecture:** Modular design with clear separation of concerns.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Setup project structure

**Files:**
- Create: `src/feature-x.ts`
- Test: `tests/feature-x.test.ts`

**Step 1: Write the failing test**

- [ ] Create test file with basic assertions

**Step 2: Implement minimal code**

- [ ] Create source file with stub implementation

**Step 3: Run tests**

- [x] Verify tests pass

### Task 2: Implement core logic

**Step 1: Write failing test for parser**

- [ ] Test parser with sample input

**Step 2: Implement parser**

- [ ] Write parser logic

**Step 3: Run tests**

- [ ] Verify all tests pass

### Task 3: Add error handling

**Step 1: Write failing test for error cases**

- [ ] Test invalid input handling

**Step 2: Implement error handling**

- [ ] Add try-catch and validation
```

**Step 2: Create sample-plan-partial.md**

```markdown
# Partial Plan

### Task 1: Completed task

- [x] Step 1: Done
- [x] Step 2: Done

### Task 2: In progress task

- [x] Step 1: Done
- [ ] Step 2: Not done yet

### Task 3: Not started

- [ ] Step 1: First thing
- [ ] Step 2: Second thing
```

**Step 3: Create sample-design.md**

```markdown
# Feature X Design

## Overview

Feature X provides a bridge between component A and component B.

## Architecture

Component A sends requests via an event bus.
Component B processes requests and returns results.

## Reference Files

- `src/component-a.ts`
- `src/component-b.ts`
- `src/event-bus.ts`
```

**Step 4: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "test: テストフィクスチャの追加"
```

---

## Task 5: PlanParser Implementation

**Files:**
- Create: `src/core/plan-parser.ts`
- Test: `tests/core/plan-parser.test.ts`

**Step 1: Write the failing test**

Create `tests/core/plan-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { PlanParser } from "../../src/core/plan-parser";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FIXTURES_DIR = resolve(__dirname, "../fixtures");

describe("PlanParser", () => {
  const parser = new PlanParser();

  describe("parse", () => {
    it("should parse a full plan.md into PlanTasks", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      expect(tasks).toHaveLength(3);
      expect(tasks[0].id).toBe("task-1");
      expect(tasks[0].title).toBe("Setup project structure");
      expect(tasks[0].steps).toHaveLength(3);
    });

    it("should correctly detect checked/unchecked steps", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      // Task 1: 2 unchecked, 1 checked
      expect(tasks[0].steps[0].checked).toBe(false);
      expect(tasks[0].steps[1].checked).toBe(false);
      expect(tasks[0].steps[2].checked).toBe(true);
    });

    it("should derive task status from step completion", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan-partial.md"), "utf-8");
      const tasks = parser.parse(content);

      expect(tasks[0].status).toBe("completed"); // all checked
      expect(tasks[1].status).toBe("in_progress"); // some checked
      expect(tasks[2].status).toBe("pending"); // none checked
    });

    it("should record line numbers for each step", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      // Each step should have a positive line number
      for (const task of tasks) {
        for (const step of task.steps) {
          expect(step.lineNumber).toBeGreaterThan(0);
        }
      }
    });

    it("should generate sequential step IDs", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan.md"), "utf-8");
      const tasks = parser.parse(content);

      expect(tasks[0].steps[0].id).toBe("task-1-step-1");
      expect(tasks[0].steps[1].id).toBe("task-1-step-2");
      expect(tasks[0].steps[2].id).toBe("task-1-step-3");
    });

    it("should handle empty content", () => {
      const tasks = parser.parse("");
      expect(tasks).toHaveLength(0);
    });

    it("should handle content with no tasks", () => {
      const tasks = parser.parse("# Just a title\n\nSome text without tasks.");
      expect(tasks).toHaveLength(0);
    });
  });

  describe("updateCheckbox", () => {
    it("should check an unchecked step", () => {
      const content = "- [ ] Step 1\n- [ ] Step 2\n";
      const updated = parser.updateCheckbox(content, 1, true);
      expect(updated).toBe("- [x] Step 1\n- [ ] Step 2\n");
    });

    it("should uncheck a checked step", () => {
      const content = "- [x] Step 1\n- [ ] Step 2\n";
      const updated = parser.updateCheckbox(content, 1, false);
      expect(updated).toBe("- [ ] Step 1\n- [ ] Step 2\n");
    });

    it("should not modify other lines", () => {
      const content = "# Title\n- [ ] Step 1\n- [x] Step 2\nSome text\n";
      const updated = parser.updateCheckbox(content, 2, true);
      expect(updated).toBe("# Title\n- [x] Step 1\n- [x] Step 2\nSome text\n");
    });

    it("should throw for invalid line number", () => {
      const content = "- [ ] Step 1\n";
      expect(() => parser.updateCheckbox(content, 0, true)).toThrow();
      expect(() => parser.updateCheckbox(content, 99, true)).toThrow();
    });

    it("should throw if line is not a checkbox", () => {
      const content = "# Title\n- [ ] Step 1\n";
      expect(() => parser.updateCheckbox(content, 1, true)).toThrow();
    });
  });

  describe("appendErrorNote", () => {
    it("should append an error note after a specific task heading", () => {
      const content = "### Task 1: Do something\n\n- [ ] Step 1\n\n### Task 2: Other\n";
      const updated = parser.appendErrorNote(content, "task-1", "Test failed: assertion error");
      expect(updated).toContain("> ⚠️ **Error**: Test failed: assertion error");
    });
  });

  describe("getNextIncompleteTask", () => {
    it("should return the first incomplete task", () => {
      const content = readFileSync(resolve(FIXTURES_DIR, "sample-plan-partial.md"), "utf-8");
      const tasks = parser.parse(content);
      const next = parser.getNextIncompleteTask(tasks);
      expect(next).toBeDefined();
      expect(next!.id).toBe("task-2");
    });

    it("should return undefined when all tasks are complete", () => {
      const tasks = parser.parse("### Task 1: Done\n\n- [x] Step 1\n");
      const next = parser.getNextIncompleteTask(tasks);
      expect(next).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: FAIL — Cannot find module `../../src/core/plan-parser`

**Step 3: Write minimal implementation**

Create `src/core/plan-parser.ts`:

```typescript
import type { PlanTask, PlanStep, PlanTaskStatus } from "./types";

const TASK_HEADING_REGEX = /^###\s+Task\s+(\d+):\s*(.+)$/;
const CHECKBOX_UNCHECKED_REGEX = /^-\s+\[ \]\s+(.+)$/;
const CHECKBOX_CHECKED_REGEX = /^-\s+\[x\]\s+(.+)$/;
const CHECKBOX_ANY_REGEX = /^-\s+\[([ x])\]\s+(.+)$/;

export class PlanParser {
  /**
   * Parse plan.md content into structured PlanTask array.
   */
  parse(content: string): PlanTask[] {
    if (!content.trim()) return [];

    const lines = content.split("\n");
    const tasks: PlanTask[] = [];
    let currentTask: { title: string; taskNum: number; steps: PlanStep[] } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1; // 1-indexed

      const taskMatch = line.match(TASK_HEADING_REGEX);
      if (taskMatch) {
        if (currentTask) {
          tasks.push(this.buildTask(currentTask));
        }
        currentTask = {
          taskNum: parseInt(taskMatch[1], 10),
          title: taskMatch[2].trim(),
          steps: [],
        };
        continue;
      }

      if (currentTask) {
        const checkboxMatch = line.match(CHECKBOX_ANY_REGEX);
        if (checkboxMatch) {
          const stepNum = currentTask.steps.length + 1;
          currentTask.steps.push({
            id: `task-${currentTask.taskNum}-step-${stepNum}`,
            description: checkboxMatch[2].trim(),
            checked: checkboxMatch[1] === "x",
            lineNumber,
          });
        }
      }
    }

    if (currentTask) {
      tasks.push(this.buildTask(currentTask));
    }

    return tasks;
  }

  /**
   * Update a checkbox at a specific line number.
   */
  updateCheckbox(content: string, lineNumber: number, checked: boolean): string {
    const lines = content.split("\n");
    const index = lineNumber - 1;

    if (index < 0 || index >= lines.length) {
      throw new Error(`Line number ${lineNumber} is out of range (1-${lines.length})`);
    }

    const line = lines[index];
    if (!CHECKBOX_ANY_REGEX.test(line)) {
      throw new Error(`Line ${lineNumber} is not a checkbox: "${line}"`);
    }

    if (checked) {
      lines[index] = line.replace("- [ ]", "- [x]");
    } else {
      lines[index] = line.replace("- [x]", "- [ ]");
    }

    return lines.join("\n");
  }

  /**
   * Append an error note after a specific task heading.
   */
  appendErrorNote(content: string, taskId: string, errorMessage: string): string {
    const taskNum = parseInt(taskId.replace("task-", ""), 10);
    const lines = content.split("\n");
    const result: string[] = [];
    let inserted = false;

    for (let i = 0; i < lines.length; i++) {
      result.push(lines[i]);

      if (!inserted) {
        const taskMatch = lines[i].match(TASK_HEADING_REGEX);
        if (taskMatch && parseInt(taskMatch[1], 10) === taskNum) {
          result.push("");
          result.push(`> ⚠️ **Error**: ${errorMessage}`);
          result.push("");
          inserted = true;
        }
      }
    }

    return result.join("\n");
  }

  /**
   * Get the next incomplete task (first non-completed task).
   */
  getNextIncompleteTask(tasks: PlanTask[]): PlanTask | undefined {
    return tasks.find((t) => t.status !== "completed");
  }

  private buildTask(raw: { title: string; taskNum: number; steps: PlanStep[] }): PlanTask {
    return {
      id: `task-${raw.taskNum}`,
      title: raw.title,
      steps: raw.steps,
      status: this.deriveStatus(raw.steps),
    };
  }

  private deriveStatus(steps: PlanStep[]): PlanTaskStatus {
    if (steps.length === 0) return "pending";

    const checkedCount = steps.filter((s) => s.checked).length;

    if (checkedCount === steps.length) return "completed";
    if (checkedCount > 0) return "in_progress";
    return "pending";
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: PASS — All PlanParser tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: PlanParserの実装 (plan.mdパース・チェックボックス操作)"
```

---

## Task 6: TaskPackager Implementation

**Files:**
- Create: `src/core/task-packager.ts`
- Test: `tests/core/task-packager.test.ts`

**Step 1: Write the failing test**

Create `tests/core/task-packager.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { TaskPackager } from "../../src/core/task-packager";
import type { PlanTask, PlanStep } from "../../src/core/types";

describe("TaskPackager", () => {
  const packager = new TaskPackager();

  const makeTask = (overrides?: Partial<PlanTask>): PlanTask => ({
    id: "task-1",
    title: "Implement feature",
    steps: [
      { id: "task-1-step-1", description: "Write test", checked: false, lineNumber: 5 },
      { id: "task-1-step-2", description: "Implement code", checked: false, lineNumber: 6 },
    ],
    status: "pending",
    ...overrides,
  });

  describe("package", () => {
    it("should create a DelegationRequest from a PlanTask", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "docs/plans/plan.md",
        referenceFiles: ["src/main.ts"],
      });

      expect(request.category).toBe("deep");
      expect(request.context.taskId).toBe("task-1");
      expect(request.context.planFilePath).toBe("docs/plans/plan.md");
      expect(request.context.referenceFiles).toEqual(["src/main.ts"]);
      expect(request.runInBackground).toBe(false);
      expect(request.prompt).toContain("Implement feature");
    });

    it("should include role prompt when provided", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        rolePrompt: "You are an expert TypeScript engineer.",
      });

      expect(request.context.rolePrompt).toBe("You are an expert TypeScript engineer.");
      expect(request.prompt).toContain("You are an expert TypeScript engineer.");
    });

    it("should include previous learnings when provided", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        previousLearnings: "Use ESM imports consistently",
      });

      expect(request.context.previousLearnings).toBe("Use ESM imports consistently");
      expect(request.prompt).toContain("Use ESM imports consistently");
    });

    it("should include step descriptions in prompt", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
      });

      expect(request.prompt).toContain("Write test");
      expect(request.prompt).toContain("Implement code");
    });

    it("should allow background execution override", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        runInBackground: true,
      });

      expect(request.runInBackground).toBe(true);
    });

    it("should allow category override", () => {
      const task = makeTask();
      const request = packager.package(task, {
        planFilePath: "plan.md",
        referenceFiles: [],
        category: "quick",
      });

      expect(request.category).toBe("quick");
    });
  });

  describe("buildPrompt", () => {
    it("should generate a structured prompt with 7 elements", () => {
      const task = makeTask();
      const prompt = packager.buildPrompt(task, {
        referenceFiles: ["src/main.ts"],
      });

      // Should contain the key sections from OmO's task prompt guide
      expect(prompt).toContain("TASK");
      expect(prompt).toContain("EXPECTED OUTCOME");
      expect(prompt).toContain("CONTEXT");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: FAIL — Cannot find module `../../src/core/task-packager`

**Step 3: Write minimal implementation**

Create `src/core/task-packager.ts`:

```typescript
import type {
  PlanTask,
  DelegationRequest,
  DelegationContext,
  TaskCategory,
} from "./types";

export interface PackageOptions {
  planFilePath: string;
  referenceFiles: string[];
  rolePrompt?: string;
  previousLearnings?: string;
  runInBackground?: boolean;
  category?: TaskCategory;
  loadSkills?: string[];
}

export class TaskPackager {
  private readonly defaultCategory: TaskCategory = "deep";
  private readonly defaultSkills: string[] = [];

  /**
   * Package a PlanTask into a DelegationRequest for OmO's task() tool.
   */
  package(task: PlanTask, options: PackageOptions): DelegationRequest {
    const context: DelegationContext = {
      planFilePath: options.planFilePath,
      taskId: task.id,
      referenceFiles: options.referenceFiles,
      rolePrompt: options.rolePrompt,
      previousLearnings: options.previousLearnings,
    };

    return {
      category: options.category ?? this.defaultCategory,
      prompt: this.buildPrompt(task, options),
      loadSkills: options.loadSkills ?? this.defaultSkills,
      runInBackground: options.runInBackground ?? false,
      context,
    };
  }

  /**
   * Build a structured prompt following OmO's 7-element task prompt guide.
   */
  buildPrompt(
    task: PlanTask,
    options: Pick<PackageOptions, "referenceFiles" | "rolePrompt" | "previousLearnings">,
  ): string {
    const sections: string[] = [];

    // Role prompt (if provided)
    if (options.rolePrompt) {
      sections.push(`**ROLE**: ${options.rolePrompt}`);
      sections.push("");
    }

    // TASK
    sections.push(`**TASK**: ${task.title}`);
    sections.push("");

    // Steps
    sections.push("**STEPS**:");
    const incompleteSteps = task.steps.filter((s) => !s.checked);
    for (const step of incompleteSteps) {
      sections.push(`- ${step.description}`);
    }
    sections.push("");

    // EXPECTED OUTCOME
    sections.push(
      `**EXPECTED OUTCOME**: All steps for "${task.title}" are completed and verified with passing tests.`,
    );
    sections.push("");

    // CONTEXT
    if (options.referenceFiles.length > 0) {
      sections.push("**CONTEXT**:");
      for (const file of options.referenceFiles) {
        sections.push(`- ${file}`);
      }
      sections.push("");
    }

    // MUST DO
    sections.push("**MUST DO**:");
    sections.push("- Follow TDD: write failing test first, then implement");
    sections.push("- Commit after each step");
    sections.push("");

    // MUST NOT DO
    sections.push("**MUST NOT DO**:");
    sections.push("- Do not modify files outside the task scope");
    sections.push("- Do not skip tests");
    sections.push("");

    // Previous learnings
    if (options.previousLearnings) {
      sections.push("**PREVIOUS LEARNINGS**:");
      sections.push(options.previousLearnings);
      sections.push("");
    }

    return sections.join("\n");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: PASS — All TaskPackager tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: TaskPackagerの実装 (タスク→DelegationRequest変換)"
```

---

## Task 7: ErrorClassifier Implementation

**Files:**
- Create: `src/core/error-classifier.ts`
- Test: `tests/core/error-classifier.test.ts`

**Step 1: Write the failing test**

Create `tests/core/error-classifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ErrorClassifier } from "../../src/core/error-classifier";
import type { ErrorClass } from "../../src/core/types";

describe("ErrorClassifier", () => {
  const classifier = new ErrorClassifier();

  describe("classify", () => {
    it("should classify syntax errors", () => {
      const result = classifier.classify("SyntaxError: Unexpected token '}'");
      expect(result).toBe("syntax_error");
    });

    it("should classify type errors", () => {
      const result = classifier.classify(
        "TypeError: Property 'foo' does not exist on type 'Bar'",
      );
      expect(result).toBe("type_error");
    });

    it("should classify TS compiler errors as type errors", () => {
      const result = classifier.classify("error TS2339: Property 'x' does not exist");
      expect(result).toBe("type_error");
    });

    it("should classify test failures", () => {
      const result = classifier.classify("FAIL tests/foo.test.ts\nExpected: 1\nReceived: 2");
      expect(result).toBe("test_failure");
    });

    it("should classify timeout errors", () => {
      const result = classifier.classify("Task timed out after 180000ms");
      expect(result).toBe("timeout");
    });

    it("should classify loop detection", () => {
      const result = classifier.classify("Loop detected: same edit applied 5 times");
      expect(result).toBe("loop_detected");
    });

    it("should classify design errors from architectural keywords", () => {
      const result = classifier.classify(
        "Cannot implement: the interface is fundamentally incompatible with the requirement",
      );
      expect(result).toBe("design_error");
    });

    it("should return unknown for unrecognized errors", () => {
      const result = classifier.classify("Something unexpected happened");
      expect(result).toBe("unknown");
    });
  });

  describe("shouldRetry", () => {
    it("should retry syntax errors within limit", () => {
      expect(classifier.shouldRetry("syntax_error", 0)).toBe(true);
      expect(classifier.shouldRetry("syntax_error", 2)).toBe(true);
      expect(classifier.shouldRetry("syntax_error", 3)).toBe(false);
    });

    it("should retry type errors within limit", () => {
      expect(classifier.shouldRetry("type_error", 0)).toBe(true);
      expect(classifier.shouldRetry("type_error", 3)).toBe(false);
    });

    it("should never retry test failures", () => {
      expect(classifier.shouldRetry("test_failure", 0)).toBe(false);
    });

    it("should never retry design errors", () => {
      expect(classifier.shouldRetry("design_error", 0)).toBe(false);
    });

    it("should never retry timeouts", () => {
      expect(classifier.shouldRetry("timeout", 0)).toBe(false);
    });

    it("should never retry loop detected", () => {
      expect(classifier.shouldRetry("loop_detected", 0)).toBe(false);
    });
  });

  describe("getEscalationMessage", () => {
    it("should return re-planning message for test failures", () => {
      const msg = classifier.getEscalationMessage("test_failure");
      expect(msg).toContain("systematic-debugging");
    });

    it("should return split instruction for timeouts", () => {
      const msg = classifier.getEscalationMessage("timeout");
      expect(msg).toContain("split");
    });

    it("should return split instruction for loop detection", () => {
      const msg = classifier.getEscalationMessage("loop_detected");
      expect(msg).toContain("split");
    });

    it("should return re-design message for design errors", () => {
      const msg = classifier.getEscalationMessage("design_error");
      expect(msg).toContain("brainstorming");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: FAIL — Cannot find module `../../src/core/error-classifier`

**Step 3: Write minimal implementation**

Create `src/core/error-classifier.ts`:

```typescript
import type { ErrorClass } from "./types";
import { DEFAULT_RETRY_POLICY } from "./types";

interface ClassificationRule {
  pattern: RegExp;
  errorClass: ErrorClass;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  { pattern: /SyntaxError/i, errorClass: "syntax_error" },
  { pattern: /parse error/i, errorClass: "syntax_error" },
  { pattern: /unexpected token/i, errorClass: "syntax_error" },
  { pattern: /TypeError/i, errorClass: "type_error" },
  { pattern: /error TS\d+/i, errorClass: "type_error" },
  { pattern: /type '.*?' is not assignable/i, errorClass: "type_error" },
  { pattern: /does not exist on type/i, errorClass: "type_error" },
  { pattern: /FAIL\s+tests?\//i, errorClass: "test_failure" },
  { pattern: /test failed/i, errorClass: "test_failure" },
  { pattern: /assertion error/i, errorClass: "test_failure" },
  { pattern: /Expected:.*?Received:/s, errorClass: "test_failure" },
  { pattern: /timed?\s*out/i, errorClass: "timeout" },
  { pattern: /timeout/i, errorClass: "timeout" },
  { pattern: /loop detected/i, errorClass: "loop_detected" },
  { pattern: /infinite loop/i, errorClass: "loop_detected" },
  { pattern: /same edit applied/i, errorClass: "loop_detected" },
  { pattern: /fundamentally incompatible/i, errorClass: "design_error" },
  { pattern: /cannot implement.*?interface/i, errorClass: "design_error" },
  { pattern: /architectural.*?mismatch/i, errorClass: "design_error" },
];

export class ErrorClassifier {
  private readonly maxRetries: number;
  private readonly retryableErrors: Set<ErrorClass>;

  constructor(maxRetries = DEFAULT_RETRY_POLICY.maxRetries) {
    this.maxRetries = maxRetries;
    this.retryableErrors = new Set(DEFAULT_RETRY_POLICY.retryableErrors);
  }

  /**
   * Classify an error message into an ErrorClass.
   */
  classify(errorOutput: string): ErrorClass {
    for (const rule of CLASSIFICATION_RULES) {
      if (rule.pattern.test(errorOutput)) {
        return rule.errorClass;
      }
    }
    return "unknown";
  }

  /**
   * Determine if a task should be retried based on error class and current retry count.
   */
  shouldRetry(errorClass: ErrorClass, currentRetryCount: number): boolean {
    if (!this.retryableErrors.has(errorClass)) return false;
    return currentRetryCount < this.maxRetries;
  }

  /**
   * Get the escalation message for a given error class.
   */
  getEscalationMessage(errorClass: ErrorClass): string {
    switch (errorClass) {
      case "test_failure":
        return (
          "Tests are failing. Please use the systematic-debugging skill to " +
          "analyze the test output and identify the root cause before attempting fixes."
        );
      case "design_error":
        return (
          "A fundamental design issue was detected. Please use the brainstorming skill " +
          "to revisit the design and propose an alternative approach."
        );
      case "timeout":
        return (
          "The task timed out. It may be too complex for a single delegation. " +
          "Please split the task into smaller, more focused steps and update plan.md."
        );
      case "loop_detected":
        return (
          "A loop was detected — the agent is repeating the same actions. " +
          "Please split the task into smaller steps or clarify the requirements in plan.md."
        );
      case "syntax_error":
      case "type_error":
        return (
          "Auto-fix retries exhausted. Please review the error output and " +
          "consider whether the approach needs to be revised."
        );
      case "unknown":
      default:
        return (
          "An unexpected error occurred. Please review the error output " +
          "and determine the appropriate next step."
        );
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: PASS — All ErrorClassifier tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: ErrorClassifierの実装 (エラー分類・リトライ判定)"
```

---

## Task 8: CompactionProtector Hook Implementation

**Files:**
- Create: `src/hooks/compaction-protector.ts`
- Test: `tests/hooks/compaction-protector.test.ts`

**Step 1: Write the failing test**

Create `tests/hooks/compaction-protector.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { CompactionProtector } from "../../src/hooks/compaction-protector";
import type { ProtectedContext } from "../../src/core/types";

describe("CompactionProtector", () => {
  describe("createSnapshot", () => {
    it("should create a snapshot of current plan state", () => {
      const protector = new CompactionProtector();
      const planContent = "# Plan\n- [ ] Task 1\n- [x] Task 2\n";

      const snapshot = protector.createSnapshot({
        planContent,
        currentTaskId: "task-1",
        currentStepId: "task-1-step-1",
        learnings: "Use strict mode",
      });

      expect(snapshot.planSnapshot).toBe(planContent);
      expect(snapshot.currentTaskId).toBe("task-1");
      expect(snapshot.currentStepId).toBe("task-1-step-1");
      expect(snapshot.accumulatedLearnings).toBe("Use strict mode");
      expect(snapshot.timestamp).toBeDefined();
    });
  });

  describe("formatForInjection", () => {
    it("should format a snapshot for post-compaction injection", () => {
      const protector = new CompactionProtector();
      const snapshot: ProtectedContext = {
        planSnapshot: "# Plan\n- [ ] Step 1\n- [x] Step 2\n- [x] Step 3\n",
        currentTaskId: "task-2",
        currentStepId: "task-2-step-1",
        accumulatedLearnings: "Use ESM imports",
        timestamp: "2026-03-24T01:00:00Z",
      };

      const formatted = protector.formatForInjection(snapshot);

      expect(formatted).toContain("[JUSTICE: Protected Context Restored]");
      expect(formatted).toContain("task-2");
      expect(formatted).toContain("task-2-step-1");
      expect(formatted).toContain("Use ESM imports");
    });

    it("should include progress summary", () => {
      const protector = new CompactionProtector();
      const snapshot: ProtectedContext = {
        planSnapshot:
          "### Task 1: Done\n- [x] Step 1\n### Task 2: WIP\n- [ ] Step 1\n### Task 3: TODO\n- [ ] Step 1\n",
        currentTaskId: "task-2",
        currentStepId: "task-2-step-1",
        accumulatedLearnings: "",
        timestamp: "2026-03-24T01:00:00Z",
      };

      const formatted = protector.formatForInjection(snapshot);
      expect(formatted).toContain("Progress");
    });
  });

  describe("shouldProtect", () => {
    it("should return true when there is an active plan", () => {
      const protector = new CompactionProtector();
      protector.setActivePlan("docs/plans/plan.md");
      expect(protector.shouldProtect()).toBe(true);
    });

    it("should return false when there is no active plan", () => {
      const protector = new CompactionProtector();
      expect(protector.shouldProtect()).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: FAIL — Cannot find module `../../src/hooks/compaction-protector`

**Step 3: Write minimal implementation**

Create `src/hooks/compaction-protector.ts`:

```typescript
import type { ProtectedContext } from "../core/types";
import { PlanParser } from "../core/plan-parser";

interface SnapshotInput {
  planContent: string;
  currentTaskId: string;
  currentStepId: string;
  learnings: string;
}

export class CompactionProtector {
  private activePlanPath: string | null = null;
  private readonly parser: PlanParser;

  constructor() {
    this.parser = new PlanParser();
  }

  /**
   * Set the currently active plan file path.
   */
  setActivePlan(planPath: string): void {
    this.activePlanPath = planPath;
  }

  /**
   * Clear the active plan.
   */
  clearActivePlan(): void {
    this.activePlanPath = null;
  }

  /**
   * Check if there is an active plan that needs protection.
   */
  shouldProtect(): boolean {
    return this.activePlanPath !== null;
  }

  /**
   * Get the active plan path.
   */
  getActivePlanPath(): string | null {
    return this.activePlanPath;
  }

  /**
   * Create a snapshot of the current plan state for compaction protection.
   */
  createSnapshot(input: SnapshotInput): ProtectedContext {
    return {
      planSnapshot: input.planContent,
      currentTaskId: input.currentTaskId,
      currentStepId: input.currentStepId,
      accumulatedLearnings: input.learnings,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format a snapshot for injection into the post-compaction context.
   */
  formatForInjection(snapshot: ProtectedContext): string {
    const tasks = this.parser.parse(snapshot.planSnapshot);
    const completedCount = tasks.filter((t) => t.status === "completed").length;
    const totalCount = tasks.length;

    const sections: string[] = [
      "---",
      "[JUSTICE: Protected Context Restored]",
      "",
      `**Active Plan**: ${this.activePlanPath ?? "unknown"}`,
      `**Current Task**: ${snapshot.currentTaskId}`,
      `**Current Step**: ${snapshot.currentStepId}`,
      `**Progress**: ${completedCount}/${totalCount} tasks completed`,
      `**Timestamp**: ${snapshot.timestamp}`,
    ];

    if (snapshot.accumulatedLearnings) {
      sections.push("");
      sections.push("**Key Learnings**:");
      sections.push(snapshot.accumulatedLearnings);
    }

    sections.push("");
    sections.push("**Plan Snapshot**:");
    sections.push("```markdown");
    sections.push(snapshot.planSnapshot);
    sections.push("```");
    sections.push("---");

    return sections.join("\n");
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test`
Expected: PASS — All CompactionProtector tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: CompactionProtectorの実装 (Compaction保護フック)"
```

---

## Task 9: Entry Point and AGENTS.md

**Files:**
- Create: `src/index.ts`
- Create: `AGENTS.md`
- Create: `README.md`

**Step 1: Create entry point**

Create `src/index.ts`:

```typescript
// Justice Plugin — Entry Point
// The nervous system connecting Superpowers (brain) and oh-my-openagent (limbs)

export { PlanParser } from "./core/plan-parser";
export { TaskPackager } from "./core/task-packager";
export type { PackageOptions } from "./core/task-packager";
export { ErrorClassifier } from "./core/error-classifier";
export { CompactionProtector } from "./hooks/compaction-protector";

export type {
  PlanTask,
  PlanStep,
  PlanTaskStatus,
  DelegationRequest,
  DelegationContext,
  TaskFeedback,
  TaskFeedbackStatus,
  TestSummary,
  ErrorClass,
  TaskCategory,
  ProtectedContext,
  RetryPolicy,
} from "./core/types";

export { DEFAULT_RETRY_POLICY } from "./core/types";
```

**Step 2: Create AGENTS.md**

Create `AGENTS.md`:

```markdown
# Justice Plugin

## What This Is
Justice is an OpenCode plugin (hook-first architecture) that bridges
Superpowers (declarative planning via Markdown) with oh-my-openagent
(event-driven execution).

## Architecture
- `src/core/` — Pure business logic, no OmO dependency
- `src/hooks/` — OmO lifecycle hook implementations
- `tests/` — Vitest tests (mirrors src structure)

## Key Patterns
- All core classes are stateless where possible
- Hooks delegate to core logic immediately
- Types are readonly to enforce immutability
- Error classification uses pattern matching rules

## Commands
- `bun run test` — Run all tests
- `bun run test:watch` — Watch mode
- `bun run typecheck` — Type checking
- `bun run lint` — Linting
- `bun run build` — Build to dist/
```

**Step 3: Create README.md**

Create `README.md`:

```markdown
# Justice Plugin

> The nervous system connecting Superpowers and oh-my-openagent.

## Overview

Justice translates Superpowers' declarative intent (plan.md, design.md)
into oh-my-openagent's event-driven API (task(), hooks, compaction).

## Quick Start

```bash
bun install
bun run test
```

## Development (Devcontainer)

Open in VS Code with Remote Containers extension for a fully isolated
development environment.

## Architecture

See `docs/plans/2026-03-24-justice-plugin-design.md` for the full design.
```

**Step 4: Verify full build**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run typecheck && bun run test`
Expected: No type errors, all tests pass

**Step 5: Commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "feat: エントリポイント・AGENTS.md・READMEの追加"
```

---

## Task 10: Final Verification

**Step 1: Run full test suite with coverage**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run test:coverage`
Expected: All tests pass, coverage report generated

**Step 2: Run linting**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run lint`
Expected: No lint errors

**Step 3: Run type checking**

Run: `cd "$(git rev-parse --show-toplevel)" && bun run typecheck`
Expected: No type errors

**Step 4: Final commit**

```bash
cd "$(git rev-parse --show-toplevel)" && git add -A && git commit -m "chore: Phase 1完了 — 全テスト・Lint・型チェック通過"
```
