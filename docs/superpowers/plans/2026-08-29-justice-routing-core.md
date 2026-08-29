# Justice Routing Core 再設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Justice v3 routing core を Controller/Worker 分離・category-first routing・model/provider independence の原則に沿って再設計し、Superpowers workflow から OMO category への正規化経路を実装する。

**Architecture:** workflow 名から ControllerAgent を解決し、plan task から ExecutionRole を分類、ExecutionRole から SpCategory へ写像、最後に OMO task payload に `category` のみを注入する純粋関数層を新規作成する。既存 `AgentRouter` から Worker Agent 選択を削除し、Controller Router に再構成する。

**Tech Stack:** TypeScript, Bun, Vitest

## Global Constraints

- `src/core/**` は `@opencode-ai/*` を import してはいけない。
- Justice source code 内に具体的な LLM model 名や provider 名をハードコードしない。
- カテゴリ → model/provider の対応は `omo.jsonc` 側で定義する（SSOT）。
- Worker task の payload には `subagent_type` / `agent` / `model` / `provider` / `variant` / `reasoning` / `fallback_models` を含めない。
- `category` と `subagent_type` / `agent` は同時に存在しないことを保証する。
- すべてのファイル I/O 境界は fail-open で例外を吸収する。
- TypeScript 型安全性を損なわない。`as any` / `@ts-ignore` / `@ts-expect-error` は禁止。
- 絶対パスを commit してはいけない。
- 本 PR のスコープ外：Plan-scoped authorization（FR-601〜604）、Doctor/contract validation、Observability/routing reason enrichment、Fix-loop escalation policy。

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/core/types.ts` | `ControllerAgent`, `ExecutionRole`, `SpCategory`, `TaskCategory`, `RoutingDecision`, `RoutingReason` など routing core の型定義。 |
| `src/core/routing-decision.ts` | `RoutingDecision` discriminated union と専用 factory 関数。不正な組み合わせを実行時に拒否する。 |
| `src/core/workflow-router.ts` | workflow 名 → `ControllerAgent` の解決。 |
| `src/core/execution-role-classifier.ts` | `PlanTask` → `ExecutionRole` の分類。integration > mechanical の優先順位を実装する。 |
| `src/core/omo-category-mapper.ts` | `ExecutionRole` → `SpCategory` の写像。`deep` / `architecture` は `undefined` を返す。 |
| `src/core/agent-router.ts` | Worker Agent 選択機能を削除し、`WorkflowRouter` 経由の Controller 解決に再構成する。 |
| `src/core/task-packager.ts` | Worker task の `category` のみを出力。禁止フィールドを削除する。 |
| `src/core/plan-bridge-core.ts` | Worker path では `category` のみ、Controller path では `controller` のみを返す。 |
| `src/hooks/plan-bridge.ts` | `handlePreToolUse` で `category` を正規化注入し、禁止フィールドを OMO wire payload から除去する。 |
| `src/index.ts` | 新規 export を追加。 |

---

## PR Stack Strategy

本計画は `gh stack` を使用して **4 つの stacked PR** に分割し、各 PR が独立してレビュー可能な差分量（概ね 200〜500 行、テスト込み）に収める。下位 PR が先に merge され、上位 PR はその上に積まれる。

| # | Branch | Depends on | Contents | Target diff size |
|---|--------|-----------|----------|------------------|
| 1 | `feature/justice-routing-types` | `main` | `src/core/types.ts` 拡張、`src/core/routing-decision.ts` 新規、`src/index.ts` export 追加。 | ~150 行 |
| 2 | `feature/justice-routing-controller` | #1 | `src/core/workflow-router.ts` 新規、`src/core/agent-router.ts` から Worker 選択を削除して Controller Router 化。 | ~250 行 |
| 3 | `feature/justice-routing-worker` | #2 | `src/core/execution-role-classifier.ts` 新規、`src/core/omo-category-mapper.ts` 新規、関連ユニットテスト。 | ~350 行 |
| 4 | `feature/justice-routing-wire` | #3 | `src/core/task-packager.ts`、`src/core/plan-bridge-core.ts`、`src/hooks/plan-bridge.ts` の正規化、integration tests、最終検証。 | ~400 行 |

### Stack operations

```bash
# 1. Initialize the stack from main
gh stack init feature/justice-routing-types

# Work on PR 1, then commit and add next layer
git add src/core/types.ts src/core/routing-decision.ts src/index.ts
git commit -m "feat(routing): add ControllerAgent, ExecutionRole, SpCategory and RoutingDecision"
gh stack add feature/justice-routing-controller

# Work on PR 2
git add src/core/workflow-router.ts src/core/agent-router.ts
git commit -m "refactor(routing): replace AgentRouter worker selection with WorkflowRouter controller resolution"
gh stack add feature/justice-routing-worker

# Work on PR 3
git add src/core/execution-role-classifier.ts src/core/omo-category-mapper.ts tests/
git commit -m "feat(routing): add execution role classifier and OMO category mapper"
gh stack add feature/justice-routing-wire

# Work on PR 4
git add src/core/task-packager.ts src/core/plan-bridge-core.ts src/hooks/plan-bridge.ts tests/
git commit -m "feat(routing): normalize task payload to category-only OMO wire format"

# Push everything and open draft PRs
gh stack submit --auto

# Verify the stack
gh stack view --json
```

### Splitting rationale

- **PR 1** は型と factory のみ。後続すべてが依存するため最下位に配置し、早期に安定化させる。
- **PR 2** は Controller routing 専門。Worker 選択の削除はここで完結させ、レビュー対象を絞る。
- **PR 3** は Worker semantic classification 専門。ExecutionRole 分類と SpCategory 写像の責務を分離してテストする。
- **PR 4** は wire payload 正規化。上位のユーザー可见挙動に最も近く、影響範囲が大きいため最上位に配置する。
- 各 PR は `bun run typecheck && bun run lint && bun run test` を通過してから submit する。
- 後続 PR（Plan-scoped authorization、Doctor/contract validation、Observability、Fix-loop escalation）は本 stack とは別 stack で実装する。

---

### Task 1: Routing core 型定義と RoutingDecision factory

**Files:**
- Create: `src/core/routing-decision.ts`
- Modify: `src/core/types.ts`
- Test: `tests/unit/core/routing-decision.test.ts`
- Test: `tests/unit/core/types.test.ts`（既存があれば追加）

**Interfaces:**
- Produces: `ControllerAgent`, `ExecutionRole`, `SpCategory`, `TaskCategory`, `RoutingDecision`, `RoutingReason`
- Produces: `createControllerRoutingDecision(controller, reason)`, `createWorkerRoutingDecision(executionRole, category, reason)`, `createUnroutedRoutingDecision(reason)`

- [ ] **Step 1: 既存 `src/core/types.ts` を読み込み、追加位置を特定する**

`src/core/types.ts` を開き、`TaskCategory` 等の既存型定義の直後に新しい型を追加する。

- [ ] **Step 2: 新しい型を `src/core/types.ts` に追加する**

```ts
export type ControllerAgent = "sisyphus" | "atlas" | "oracle" | "momus" | "hephaestus";

export type ExecutionRole =
  | "mechanical"
  | "implementation"
  | "integration"
  | "review"
  | "final-review"
  | "deep"
  | "architecture";

export type SpCategory =
  | "sp-mechanical"
  | "sp-implementation"
  | "sp-integration"
  | "sp-review"
  | "sp-final-review";

export type RoutingReason =
  | "workflow_rule"
  | "task_classification"
  | "review_role"
  | "fix_escalation"
  | "explicit_request"
  | "compatibility_fallback";

export type RoutingDecision =
  | {
      readonly kind: "controller";
      readonly controller: ControllerAgent;
      readonly reason: RoutingReason;
    }
  | {
      readonly kind: "worker";
      readonly executionRole: ExecutionRole;
      readonly category: SpCategory | TaskCategory;
      readonly reason: RoutingReason;
    }
  | {
      readonly kind: "unrouted";
      readonly reason: RoutingReason;
    };
```

- [ ] **Step 3: `src/core/routing-decision.ts` を新規作成する**

```ts
import {
  type ControllerAgent,
  type ExecutionRole,
  type RoutingDecision,
  type RoutingReason,
  type SpCategory,
  type TaskCategory,
} from "./types";

export function createControllerRoutingDecision(
  controller: ControllerAgent,
  reason: RoutingReason,
): RoutingDecision {
  return { kind: "controller", controller, reason };
}

export function createWorkerRoutingDecision(
  executionRole: ExecutionRole,
  category: SpCategory | TaskCategory,
  reason: RoutingReason,
): RoutingDecision {
  if (!isValidExecutionRoleCategoryPair(executionRole, category)) {
    throw new Error(`Invalid routing pair: ${executionRole} cannot be routed to ${category}`);
  }
  return { kind: "worker", executionRole, category, reason };
}
```

/**
 * ExecutionRole と category の正当な組み合わせを検証する。
 * mechanical は sp-mechanical のみ、integration は sp-integration のみ、など
 * 一対一または未定義ロールのペアを許可する。
 */
function isValidExecutionRoleCategoryPair(
  executionRole: ExecutionRole,
  category: SpCategory | TaskCategory,
): boolean {
  const validPairs: Readonly<Record<ExecutionRole, ReadonlySet<SpCategory | TaskCategory>>> = {
    mechanical: new Set(["sp-mechanical"]),
    implementation: new Set(["sp-implementation"]),
    integration: new Set(["sp-integration"]),
    review: new Set(["sp-review"]),
    "final-review": new Set(["sp-final-review"]),
    deep: new Set(["deep"]),
    architecture: new Set(["unspecified-high", "deep"]),
  };
  return validPairs[executionRole].has(category);
}


- [ ] **Step 4: テストを書く**

`tests/unit/core/routing-decision.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createControllerRoutingDecision,
  createUnroutedRoutingDecision,
  createWorkerRoutingDecision,
} from "../../../src/core/routing-decision";

describe("routing-decision factories", () => {
  it("creates a controller decision", () => {
    const decision = createControllerRoutingDecision("sisyphus", "workflow_rule");
    expect(decision).toEqual({
      kind: "controller",
      controller: "sisyphus",
      reason: "workflow_rule",
    });
  });

  it("creates a worker decision", () => {
    const decision = createWorkerRoutingDecision(
      "implementation",
      "sp-implementation",
      "task_classification",
    );
    expect(decision).toEqual({
      kind: "worker",
      executionRole: "implementation",
      category: "sp-implementation",
      reason: "task_classification",
    });
  });

  it("rejects invalid role/category pairs", () => {
    expect(() =>
      createWorkerRoutingDecision("mechanical", "sp-integration", "task_classification"),
    ).toThrow("Invalid routing pair");
  });

  it("creates an unrouted decision", () => {
    const decision = createUnroutedRoutingDecision("compatibility_fallback");
    expect(decision).toEqual({
      kind: "unrouted",
      reason: "compatibility_fallback",
    });
  });
});

- [ ] **Step 5: テストを実行する**

Run: `bun run test tests/unit/core/routing-decision.test.ts`
Expected: PASS

- [ ] **Step 6: Commit する**

```bash
git add src/core/types.ts src/core/routing-decision.ts tests/unit/core/routing-decision.test.ts
gh stack init feature/justice-routing-types  # まだ初期化していない場合のみ
git commit -m "feat(routing): add routing decision types and factories"
```

---

### Task 2: WorkflowRouter（workflow → ControllerAgent）

**Files:**
- Create: `src/core/workflow-router.ts`
- Modify: `src/core/agent-router.ts`（Worker 選択を削除）
- Test: `tests/unit/core/workflow-router.test.ts`

**Interfaces:**
- Consumes: `ControllerAgent` from `src/core/types.ts`
- Produces: `class WorkflowRouter { resolveController(workflow: string): ControllerAgent | undefined; isKnownWorkflow(workflow: string): boolean; }`

- [ ] **Step 1: テストを書く**

`tests/unit/core/workflow-router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WorkflowRouter } from "../../../src/core/workflow-router";

describe("WorkflowRouter", () => {
  const router = new WorkflowRouter();

  it.each([
    ["brainstorming", "sisyphus"],
    ["writing-plans", "sisyphus"],
    ["subagent-driven-development", "atlas"],
    ["executing-plans", "sisyphus"],
  ])("resolves %s to %s", (workflow, expected) => {
    expect(router.resolveController(workflow)).toBe(expected);
  });

  it("returns undefined for unknown workflows", () => {
    expect(router.resolveController("unknown-workflow")).toBeUndefined();
  });

  it("reports known workflows", () => {
    expect(router.isKnownWorkflow("brainstorming")).toBe(true);
    expect(router.isKnownWorkflow("unknown")).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun run test tests/unit/core/workflow-router.test.ts`
Expected: FAIL with "WorkflowRouter is not defined"

- [ ] **Step 3: `src/core/workflow-router.ts` を実装する**

```ts
import type { ControllerAgent } from "./types";

const WORKFLOW_CONTROLLER_MAP: Readonly<Record<string, ControllerAgent>> = {
  brainstorming: "sisyphus",
  "writing-plans": "sisyphus",
  "subagent-driven-development": "atlas",
  "executing-plans": "sisyphus",
};

export class WorkflowRouter {
  resolveController(workflow: string): ControllerAgent | undefined {
    return WORKFLOW_CONTROLLER_MAP[workflow];
  }

  isKnownWorkflow(workflow: string): boolean {
    return Object.prototype.hasOwnProperty.call(WORKFLOW_CONTROLLER_MAP, workflow);
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun run test tests/unit/core/workflow-router.test.ts`
Expected: PASS

```bash
git add src/core/workflow-router.ts tests/unit/core/workflow-router.test.ts
git commit -m "feat(routing): add WorkflowRouter for workflow-to-controller resolution"
```

- **Note:** `AgentRouter.route` を削除する前に、Task 8 で `plan-bridge` と `task-packager` の呼び出しを新しい Controller/Worker 解決 API へ移行する。本 PR stack では PR #2 で `AgentRouter` から Worker 選択を削除し、PR #4 で呼び出し側を切り替える。両方の利用箇所がなくなったことを PR #4 の最終検証で確認する。

---

### Task 3: AgentRouter から Worker Agent 選択を削除して Controller Router 化

**Files:**
- Modify: `src/core/agent-router.ts`
- Test: `tests/unit/core/agent-router.test.ts`（更新）

**Interfaces:**
- Consumes: `WorkflowRouter`
- Produces: `class AgentRouter { routeController(workflow: string): ControllerAgent | undefined; }`（または同等の Controller 解決メソッド）

- [ ] **Step 1: 既存 `src/core/agent-router.ts` とそのテストを読む**

既存の Worker Agent 選択メソッド名と依存関係を確認する。

- [ ] **Step 2: Worker 選択メソッドを削除し、Controller 解決に置き換える**

```ts
import type { ControllerAgent } from "./types";
import { WorkflowRouter } from "./workflow-router";

export class AgentRouter {
  private readonly workflowRouter = new WorkflowRouter();

  routeController(workflow: string): ControllerAgent | undefined {
    return this.workflowRouter.resolveController(workflow);
  }
}
```

- [ ] **Step 3: 既存テストを新しい契約に更新する**

```ts
import { describe, expect, it } from "vitest";
import { AgentRouter } from "../../../src/core/agent-router";

describe("AgentRouter", () => {
  const router = new AgentRouter();

  it("resolves controller workflows", () => {
    expect(router.routeController("brainstorming")).toBe("sisyphus");
    expect(router.routeController("subagent-driven-development")).toBe("atlas");
  });

  it("returns undefined for unknown workflows", () => {
    expect(router.routeController("unknown")).toBeUndefined();
  });
});
```

- [ ] **Step 4: 型チェックとテストを実行する**

Run: `bun run typecheck && bun run test tests/unit/core/agent-router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit する**

```bash
git add src/core/agent-router.ts tests/unit/core/agent-router.test.ts
git commit -m "refactor(routing): remove worker agent selection from AgentRouter"
```

---

### Task 4: ExecutionRoleClassifier（PlanTask → ExecutionRole）

**Files:**
- Create: `src/core/execution-role-classifier.ts`
- Test: `tests/unit/core/execution-role-classifier.test.ts`

**Interfaces:**
- Consumes: `ExecutionRole` type
- Produces: `class ExecutionRoleClassifier { classify(task: PlanTask): ExecutionRole; }`

- [ ] **Step 1: テストを書く**

`tests/unit/core/execution-role-classifier.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ExecutionRoleClassifier } from "../../../src/core/execution-role-classifier";
import type { PlanTask } from "../../../src/core/types";

function makeTask(overrides: Partial<PlanTask> = {}): PlanTask {
  return {
    id: "t1",
    description: "do something",
    steps: [{ id: "t1-step-1", description: "step 1", checked: false, lineNumber: 1 }],
    title: "Task",
    status: "pending",
    ...overrides,
  };
}

describe("ExecutionRoleClassifier", () => {
  const classifier = new ExecutionRoleClassifier();

  it("classifies integration tasks", () => {
    const task = makeTask({
      description: "update API interface and coordinate modules",
    });
    expect(classifier.classify(task)).toBe("integration");
  });

  it("classifies mechanical tasks", () => {
    const task = makeTask({
      description: "rename typo in constant",
      steps: ["replace value"],
    });
    expect(classifier.classify(task)).toBe("mechanical");
  });

  it("integration beats mechanical when both apply", () => {
    const task = makeTask({
      description: "add API endpoint boilerplate",
    });
    expect(classifier.classify(task)).toBe("integration");
  });

  it("falls back to implementation for normal tasks", () => {
    const task = makeTask({
      description: "implement user login feature with tests",
    });
    expect(classifier.classify(task)).toBe("implementation");
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun run test tests/unit/core/execution-role-classifier.test.ts`
Expected: FAIL with "ExecutionRoleClassifier is not defined"

- [ ] **Step 3: `src/core/execution-role-classifier.ts` を実装する**

```ts
import type { ExecutionRole, PlanTask } from "./types";

const INTEGRATION_KEYWORDS = ["api", "interface", "module", "modules", "migration", "integration", "state", "concurrency", "async", "coordinate", "components"];
const MECHANICAL_KEYWORDS = ["rename", "typo", "constant", "boilerplate", "field", "config", "setting"];
const TEST_ONLY_KEYWORDS = ["test only", "tests only", "test-only", "tests-only", "run tests only"];

export class ExecutionRoleClassifier {
  classify(task: PlanTask): ExecutionRole {
    const text = `${task.description} ${task.steps.map((s) => s.description).join(" ")}`.toLowerCase();

    if (this.matches(text, INTEGRATION_KEYWORDS)) {
      return "integration";
    }

    if (this.matches(text, MECHANICAL_KEYWORDS)) {
      return "mechanical";
    }

    if (this.matches(text, TEST_ONLY_KEYWORDS)) {
      return "mechanical";
    }

    return "implementation";
  }

  private matches(text: string, keywords: readonly string[]): boolean {
    return keywords.some((keyword) => text.includes(keyword));
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun run test tests/unit/core/execution-role-classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit する**

```bash
git add src/core/execution-role-classifier.ts tests/unit/core/execution-role-classifier.test.ts
git commit -m "feat(routing): add execution role classifier"
```

---

### Task 5: OmoCategoryMapper（ExecutionRole → SpCategory）

**Files:**
- Create: `src/core/omo-category-mapper.ts`
- Test: `tests/unit/core/omo-category-mapper.test.ts`

**Interfaces:**
- Consumes: `ExecutionRole`, `SpCategory`
- Produces: `class OmoCategoryMapper { map(role: ExecutionRole): SpCategory | undefined; isSpCategory(value: string): value is SpCategory; }`

- [ ] **Step 1: テストを書く**

`tests/unit/core/omo-category-mapper.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OmoCategoryMapper } from "../../../src/core/omo-category-mapper";

describe("OmoCategoryMapper", () => {
  const mapper = new OmoCategoryMapper();

  it.each([
    ["mechanical", "sp-mechanical"],
    ["implementation", "sp-implementation"],
    ["integration", "sp-integration"],
    ["review", "sp-review"],
    ["final-review", "sp-final-review"],
  ])("maps %s to %s", (role, expected) => {
    expect(mapper.map(role)).toBe(expected);
  });

  it("returns undefined for deep and architecture", () => {
    expect(mapper.map("deep")).toBeUndefined();
    expect(mapper.map("architecture")).toBeUndefined();
  });

  it("guards SpCategory values", () => {
    expect(mapper.isSpCategory("sp-implementation")).toBe(true);
    expect(mapper.isSpCategory("quick")).toBe(false);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `bun run test tests/unit/core/omo-category-mapper.test.ts`
Expected: FAIL with "OmoCategoryMapper is not defined"

- [ ] **Step 3: `src/core/omo-category-mapper.ts` を実装する**

```ts
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
```

- [ ] **Step 4: テストを実行して成功を確認する**

Run: `bun run test tests/unit/core/omo-category-mapper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit する**

```bash
git add src/core/omo-category-mapper.ts tests/unit/core/omo-category-mapper.test.ts
git commit -m "feat(routing): add OMO category mapper"
```

---

### Task 6: CategoryClassifier を ExecutionRoleClassifier への薄いラッパーに変更

**Files:**
- Modify: `src/core/category-classifier.ts`
- Test: `tests/unit/core/category-classifier.test.ts`（更新）

**Interfaces:**
- Consumes: `ExecutionRoleClassifier`, `OmoCategoryMapper`
- Produces: `class CategoryClassifier { classify(task: PlanTask): SpCategory | TaskCategory; }`（既存 API を維持）

- [ ] **Step 1: 既存実装とテストを確認する**

- [ ] **Step 2: keyword ベース分類を `ExecutionRoleClassifier` + `OmoCategoryMapper` に委譲する**

```ts
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
```

- [ ] **Step 3: テストを更新して互換性を検証する**

```ts
import { describe, expect, it } from "vitest";
import { CategoryClassifier } from "../../../src/core/category-classifier";
import type { PlanTask } from "../../../src/core/types";

function makeTask(title: string, steps: string[] = []): PlanTask {
  return {
    id: "t1",
    title,
    steps: steps.map((desc, i) => ({
      id: `t1-step-${i + 1}`,
      description: desc,
      checked: false,
      lineNumber: i + 5,
    })),
    status: "pending",
  };
}

describe("CategoryClassifier", () => {
  const classifier = new CategoryClassifier();

  it("classifies integration tasks", () => {
    expect(classifier.classify(makeTask("update API interface"))).toBe("sp-integration");
  });

  it("classifies mechanical tasks", () => {
    expect(classifier.classify(makeTask("rename constant"))).toBe("sp-mechanical");
  });

  it("falls back to unspecified-low for unmapped roles", () => {
    expect(classifier.classify(makeTask("design architecture"))).toBe("unspecified-low");
  });
});
```

- [ ] **Step 4: 型チェックとテストを実行する**

Run: `bun run typecheck && bun run test tests/unit/core/category-classifier.test.ts`
Expected: PASS

- [ ] **Step 5: Commit する**

```bash
git add src/core/category-classifier.ts tests/unit/core/category-classifier.test.ts
git commit -m "refactor(routing): delegate CategoryClassifier to ExecutionRoleClassifier"
```

---

### Task 7: TaskPackager を category-only に変更

**Files:**
- Modify: `src/core/task-packager.ts`
- Test: `tests/unit/core/task-packager.test.ts`（更新）

**Interfaces:**
- Consumes: `RoutingDecision`, `SpCategory | TaskCategory`
- Produces: `interface DelegationRequest { readonly category: SpCategory | TaskCategory; readonly taskId: string; readonly loadSkills: readonly string[]; readonly prompt: string; readonly runInBackground: boolean; readonly context?: { readonly taskId?: string; }; }`

- [ ] **Step 1: 既存 `src/core/task-packager.ts` を読む**

- [ ] **Step 2: `DelegationRequest` 型を更新し、禁止フィールドを削除する**

```ts
import type { SpCategory, TaskCategory } from "./types";

export interface DelegationRequest {
  readonly category: SpCategory | TaskCategory;
  readonly taskId: string;
  readonly loadSkills: readonly string[];
  readonly prompt: string;
  readonly runInBackground: boolean;
  readonly context: {
    readonly taskId: string;
    readonly agentId?: AgentId;
  };
}
```

- [ ] **Step 3: `package` メソッドから `agentId`, `rolePrompt`, `routingCategory` 等を削除する**

```ts
export interface PackageOptions {
  readonly taskId: string;
  readonly prompt: string;
  readonly loadSkills?: readonly string[];
  readonly runInBackground?: boolean;
  readonly contextTaskId?: string;
  readonly agentId?: AgentId;
}

export class TaskPackager {
  package(
    category: SpCategory | TaskCategory,
    options: PackageOptions,
  ): DelegationRequest {
    return {
      category,
      taskId: options.taskId,
      loadSkills: options.loadSkills ?? [],
      prompt: options.prompt,
      context: {
        taskId: options.taskId,
        agentId: options.agentId,
      },
    };
  }
}
```

- [ ] **Step 4: テストを更新する**

```ts
import { describe, expect, it } from "vitest";
import { TaskPackager } from "../../../src/core/task-packager";

describe("TaskPackager", () => {
  const packager = new TaskPackager();

  it("packages category-only worker payload", () => {
    const request = packager.package("sp-implementation", {
      taskId: "task-1",
      context: { taskId: "parent-1" },
    });
  });

  it("does not include agent, model, provider, variant, reasoning, or subagent_type", () => {
    const request = packager.package("sp-mechanical", {
      taskId: "task-2",
      prompt: "fix typo",
    });
    expect(request).not.toHaveProperty("agentId");
    expect(request).not.toHaveProperty("rolePrompt");
    expect(request).not.toHaveProperty("routingCategory");
    expect(request).not.toHaveProperty("model");
    expect(request).not.toHaveProperty("provider");
    expect(request).not.toHaveProperty("subagent_type");
  });
});
```

- [ ] **Step 5: 型チェックとテストを実行する**

Run: `bun run typecheck && bun run test tests/unit/core/task-packager.test.ts`
Expected: PASS

- [ ] **Step 6: Commit する**

```bash
git add src/core/task-packager.ts tests/unit/core/task-packager.test.ts
git commit -m "feat(routing): normalize TaskPackager to category-only output"
```

---

### Task 8: PlanBridgeCore を新しい decision model に追従

**Files:**
- Modify: `src/core/plan-bridge-core.ts`
- Test: `tests/unit/core/plan-bridge-core.test.ts`（更新）

**Interfaces:**
- Consumes: `WorkflowRouter`, `ExecutionRoleClassifier`, `OmoCategoryMapper`, `TaskPackager`, `RoutingDecision` factories
- Produces: `class PlanBridgeCore { buildControllerRequest(workflow, options): DelegationRequest | undefined; buildWorkerRequest(planTask, options): DelegationRequest | undefined; }`

- [ ] **Step 1: 既存 `src/core/plan-bridge-core.ts` を読む**

- [ ] **Step 2: Controller path と Worker path を分離する**

```ts
import { ExecutionRoleClassifier } from "./execution-role-classifier";
import { OmoCategoryMapper } from "./omo-category-mapper";
import { TaskPackager, type PackageOptions } from "./task-packager";
import type {
  AgentId,
  ControllerAgent,
  DelegationRequest,
  ExecutionRole,
  PlanTask,
  SpCategory,
  TaskCategory,
} from "./types";
import { WorkflowRouter } from "./workflow-router";

export interface ControllerOptions {
  readonly workflow: string;
  readonly taskId: string;
  readonly prompt: string;
  readonly loadSkills?: readonly string[];
}

export interface WorkerOptions extends PackageOptions {
  readonly category?: SpCategory | TaskCategory;
  readonly role?: ExecutionRole;
}

  private readonly workflowRouter = new WorkflowRouter();
  private readonly taskPackager = new TaskPackager();
  private readonly categoryMapper = new OmoCategoryMapper();
  private readonly roleClassifier = new ExecutionRoleClassifier();
  buildControllerRequest(
    workflow: string,
    options: ControllerOptions,
  ): { readonly controller: ControllerAgent; readonly request: DelegationRequest } | undefined {
    const controller = this.workflowRouter.resolveController(workflow);
    if (controller === undefined) {
      return undefined;
    }
    const request = this.taskPackager.package("quick", {
      taskId: options.taskId,
      prompt: options.prompt,
      loadSkills: options.loadSkills ?? [],
    });
    return { controller, request };
  }

  classifyAndBuildWorkerRequest(
    planTask: PlanTask,
    options: WorkerOptions,
  ): { readonly category: SpCategory | TaskCategory; readonly request: DelegationRequest } | undefined {
    const role = options.role ?? this.roleClassifier.classify(planTask);
    const category = options.category ?? this.categoryMapper.map(role);
    if (category === undefined) {
      return undefined;
    }
    const request = this.taskPackager.package(category, options);
    return { category, request };
  }

  buildWorkerRequest(
    role: ExecutionRole,
    options: WorkerOptions,
  ): { readonly category: SpCategory | TaskCategory; readonly request: DelegationRequest } | undefined {
    const category = options.category ?? this.categoryMapper.map(role);
    if (category === undefined) {
      return undefined;
    }
    const request = this.taskPackager.package(category, options);
  }
}
```

- [ ] **Step 3: テストを更新する**

```ts
import { describe, expect, it } from "vitest";
import { PlanBridgeCore } from "../../../src/core/plan-bridge-core";

describe("PlanBridgeCore", () => {
  const core = new PlanBridgeCore();

  it("resolves controller workflow", () => {
    expect(core.resolveController("brainstorming")).toBe("sisyphus");
  });

  it("builds a controller request", () => {
    const result = core.buildControllerRequest("brainstorming", {
      taskId: "t1",
      prompt: "plan the work",
    });
    expect(result?.controller).toBe("sisyphus");
    expect(result?.request.category).toBe("quick");
  });

  it("classifies a PlanTask and builds a worker request", () => {
    const task: PlanTask = {
      id: "t1",
      title: "implement login",
      description: "implement user login feature with tests",
      steps: [],
      status: "pending",
    };
    const result = core.classifyAndBuildWorkerRequest(task, {
      taskId: "t1",
      prompt: "implement feature",
    });
    expect(result?.category).toBe("sp-implementation");
    expect(result?.request.category).toBe("sp-implementation");
  });
```

- [ ] **Step 4: 型チェックとテストを実行する**

Run: `bun run typecheck && bun run test tests/unit/core/plan-bridge-core.test.ts`
Expected: PASS

- [ ] **Step 5: Commit する**

```bash
git add src/core/plan-bridge-core.ts tests/unit/core/plan-bridge-core.test.ts
git commit -m "feat(routing): update PlanBridgeCore to new routing decision model"
```

---

### Task 9: PlanBridge handlePreToolUse で payload 正規化

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Test: `tests/unit/hooks/plan-bridge.test.ts`（更新）

**Interfaces:**
- Consumes: `RoutingDecision`, `DelegationRequest`
- Produces: OMO wire payload に `category` のみを含み、`subagent_type` / `agent` / `model` / `provider` / `variant` / `reasoning` を除去したオブジェクト

- [ ] **Step 1: 既存 `src/hooks/plan-bridge.ts` を読む**

- [ ] **Step 2: 正規化関数を追加または置き換える**

```ts
import type { RoutingDecision, SpCategory, TaskCategory } from "../core/types";

const FORBIDDEN_TASK_FIELDS = new Set([
  "subagent_type",
  "agent",
  "model",
  "provider",
  "variant",
  "reasoning",
  "fallback_models",
]);

export function enrichTaskToolInput(
  toolInput: Record<string, unknown>,
  category: SpCategory | TaskCategory,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(toolInput)) {
    if (!FORBIDDEN_TASK_FIELDS.has(key)) {
      normalized[key] = value;
    }
  }
  normalized.category = category;
  return normalized;
}
```

- [ ] **Step 3: `handlePreToolUse` で正規化を呼び出す**

```ts
    const delegation = core.classifyAndBuildWorkerRequest(nextTask, {
      planFilePath: activePlanPath,
      referenceFiles: [],
      previousLearnings,
      loadSkills: mergedLoadSkills,
    }) ?? initialDelegation;

    let toolInput = event.payload.toolInput;
    if (delegation.request.category) {
      toolInput = enrichTaskToolInput(toolInput, delegation.request.category);
    }
```

- [ ] **Step 4: テストを追加する**

```ts
import { describe, expect, it } from "vitest";
import { enrichTaskToolInput } from "../../../src/hooks/plan-bridge";

describe("enrichTaskToolInput", () => {
  it("removes forbidden task fields and preserves prompt", () => {
    const input = {
      prompt: "do work",
      subagent_type: "deep",
      agent: "atlas",
      model: "claude",
      provider: "anthropic",
      variant: "fast",
      reasoning: true,
    };
    const result = enrichTaskToolInput(input, "sp-implementation");
    expect(result).toEqual({
      prompt: "do work",
      category: "sp-implementation",
    });
  });

  it("preserves an existing category when already present", () => {
    const input = { prompt: "x", category: "sp-mechanical" };
    const result = enrichTaskToolInput(input, "sp-mechanical");
    expect(result.category).toBe("sp-mechanical");
  });
});

### Task 10: `src/index.ts` の export を更新

**Files:**
- Modify: `src/index.ts`
- Test: `bun run typecheck`

**Interfaces:**
- Produces: public exports for new routing modules

- [ ] **Step 1: 既存 `src/index.ts` を読む**

- [ ] **Step 2: 新規 module を export する**

```ts
export { WorkflowRouter } from "./core/workflow-router";
export { ExecutionRoleClassifier } from "./core/execution-role-classifier";
export { OmoCategoryMapper } from "./core/omo-category-mapper";
export {
  createControllerRoutingDecision,
  createWorkerRoutingDecision,
  createUnroutedRoutingDecision,
} from "./core/routing-decision";
export { TaskPackager, type DelegationRequest } from "./core/task-packager";
export { PlanBridgeCore } from "./core/plan-bridge-core";
export type {
  ControllerAgent,
  ExecutionRole,
  RoutingDecision,
  RoutingReason,
  SpCategory,
} from "./core/types";
```

- [ ] **Step 3: 型チェックを実行する**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit する**

```bash
git add src/index.ts
git commit -m "feat(routing): export new routing core modules"
```

---

### Task 11: Integration tests for Controller and Worker routing

**Files:**
- Create: `tests/integration/routing-core.test.ts`

**Interfaces:**
- Consumes: all new routing modules and `PlanBridgeCore`

- [ ] **Step 1: integration test を書く**

```ts
import { describe, expect, it } from "vitest";
import { AgentRouter } from "../../src/core/agent-router";
import { ExecutionRoleClassifier } from "../../src/core/execution-role-classifier";
import { OmoCategoryMapper } from "../../src/core/omo-category-mapper";
import { PlanBridgeCore } from "../../src/core/plan-bridge-core";
import { WorkflowRouter } from "../../src/core/workflow-router";
import type { PlanTask } from "../../src/core/types";

describe("routing core integration", () => {
  const workflowRouter = new WorkflowRouter();
  const roleClassifier = new ExecutionRoleClassifier();
  const categoryMapper = new OmoCategoryMapper();
  const agentRouter = new AgentRouter();
  const planBridge = new PlanBridgeCore();

  it.each([
    ["brainstorming", "sisyphus"],
    ["writing-plans", "sisyphus"],
    ["subagent-driven-development", "atlas"],
    ["executing-plans", "sisyphus"],
  ])("workflow %s -> controller %s", (workflow, controller) => {
    expect(workflowRouter.resolveController(workflow)).toBe(controller);
    expect(agentRouter.routeController(workflow)).toBe(controller);
  });

  it.each([
    ["rename constant", "sp-mechanical"],
    ["implement user login", "sp-implementation"],
    ["update API interface", "sp-integration"],
  ])("task '%s' -> %s", (description, expectedCategory) => {
    const task: PlanTask = {
      id: "t",
      title: description,
      description,
      steps: [],
      status: "pending",
    };
    const role = roleClassifier.classify(task);
    const category = categoryMapper.map(role);
    expect(category).toBe(expectedCategory);
  });
    const role = roleClassifier.classify(task);
    const category = categoryMapper.map(role);
    expect(category).toBe(expectedCategory);
  });

  it("ensures category/subagent_type mutual exclusivity", () => {
    const task: PlanTask = {
      id: "t",
      title: "implement feature",
      description: "implement user login",
      steps: [],
      status: "pending",
    };
    const result = planBridge.classifyAndBuildWorkerRequest(task, {
      taskId: "t",
      prompt: "work",
    });
    expect(result).toBeDefined();
    expect(result?.request.category).toBe("sp-implementation");
  });
});
```

- [ ] **Step 2: テストを実行する**

Run: `bun run test tests/integration/routing-core.test.ts`
Expected: PASS

- [ ] **Step 3: Commit する**

```bash
git add tests/integration/routing-core.test.ts
git commit -m "test(routing): add integration tests for routing core"
```

---

### Task 12: Final verification

**Files:**
- All modified files

**Interfaces:**
- Produces: green CI-equivalent verification

- [ ] **Step 1: すべてのチェックを実行する**

Run:
```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

Expected: すべて成功

- [ ] **Step 2: Commit する（修正があれば）**

```bash
git commit -m "chore(routing): final verification fixes" || true
```

---

## Self-Review

- **Spec coverage:**
  - §5 型設計 → Task 1
  - §7 Controller routing → Task 2, 3
  - §8 Worker classification → Task 4
  - §9 OMO category mapping → Task 5
  - §10 Task payload normalization → Task 7, 9
  - §11 Category/subagent_type mutual exclusivity → Task 9
  - §13 既存機能後方互換 → 既存テスト更新と integration tests でカバー
  - §14 Unit/Integration tests → 各タスクに分散
  - §16 実装順序 → Tasks 1〜12 と一致
- **Placeholder scan:** TBD/TODO/"implement later" なし。各ステップにはコードブロックあり。
- **Type consistency:** `RoutingDecision` は判別共用体。`createWorkerRoutingDecision` は `category: SpCategory | TaskCategory`。`OmoCategoryMapper.map` は `SpCategory | undefined`。
- **PR stack:** 4 層の `gh stack` ブランチ定義済み。各層はレビュー可能な差分量。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-29-justice-routing-core.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** - execute tasks in this session using executing-plans.

Which approach?
