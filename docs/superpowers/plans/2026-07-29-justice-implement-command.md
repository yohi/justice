# `/justice-implement` コマンド追加 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/justice-start` による `plan_ready` 状態から実装委譲を開始する際の境界を明示化し、ユーザーが「次の 1 回の `task()` で実装委譲を許可する」ための `/justice-implement` コマンドを追加する。

**Architecture:** OpenCode の `command.execute.before` フックを拡張し、`justice-implement` コマンドを検出して `PlanBridge` に新しいセッション状態 `implementation_armed` を設定する。`handlePreToolUse` はこの状態を消費して実装 directive を注入し、未アーム時は `implementation_unauthorized` advisory を返す。コマンドは advisory only (`task()` や skill を呼ばない) かつ既存の invariant を保つ。

**Tech Stack:** TypeScript, Bun, Oh My OpenAgent plugin API, 既存の `PlanBridge` / `OpenCodeAdapter` / `TriggerDetector` / `workflow-directives.ts`

## Global Constraints

- `src/core/**` は `@opencode-ai/*` を import しない (pure core).
- すべての hook/adapter I/O 境界は error を catch して `PROCEED` に degrade する (fail-open).
- immutable public state: `readonly`, `ReadonlyArray`, `ReadonlyMap` を使用する.
- JSON-only persistence: atomic temp-file-plus-rename writes; external DB は使わない.
- `OpenCodeAdapter.getTools()` が公開するカスタムツールは `justice_review` のみ.
- `declared` provenance は Gate PASS の根拠にならない; `observed`/`derived` のみ.
- `/justice-start` guidance never invokes a skill or `task()`; `/justice-implement` も同様.
- 秘密情報や絶対パスをログ/ファイルに出力・コミットしない.
- テストでは real disk にアクセスせず、mock file system/notifier を inject する.
- コミットは明示的な指示がない限り行わない; git 操作は host で行う.
- 静的解析・型検査・テスト・ビルドは `.devcontainer/` 内で実行する.

---

### Task 1: コマンドパーサーと型の追加

**Files:**
- Create: `src/core/implement-command.ts`
- Modify: `src/core/types.ts`
- Modify: `src/core/workflow-directives.ts`
- Test: `tests/core/implement-command.test.ts`

**Interfaces:**
- Consumes: `WorkflowStartRequest` 型, `normalizeSafeRelativePath`, `isArtifactReadable` 相当の判定パターン
- Produces: `ImplementationArmRequest`, `ImplementationArmResult`, `isJusticeImplementCommand`, `parseJusticeImplementCommandArguments`

- [ ] **Step 1: 型を追加する**

`src/core/types.ts` に以下を追加する:

```typescript
/** `/justice-implement` コマンドで生成される実装許可リクエスト */
export interface ImplementationArmRequest {
  readonly source: WorkflowStartSource;
  readonly planPath: string;
  readonly approved: boolean;
}

/** `/justice-implement` 実行結果 */
export interface ImplementationArmResult {
  readonly armed: boolean;
  readonly planPath: string | null;
  readonly directiveStage: WorkflowDirectiveStage;
  readonly guidance: string;
}
```

- [ ] **Step 2: directive stage を追加する**

`src/core/workflow-directives.ts` の `WorkflowDirectiveStage` union に `"implementation_arm" | "implementation_arm_required"` を追加する:

```typescript
export type WorkflowDirectiveStage =
  | "design_required"
  | "plan_required"
  | "plan_review_required"
  | "review_remediation"
  | "review_clear"
  | "implementation"
  | "implementation_unauthorized"
  | "implementation_arm"
  | "implementation_arm_required";
```

同ファイルの `GUIDANCE` 定数と `resolveWorkflowDirective` スイッチにも 2 ケースを追加する:

```typescript
const GUIDANCE = {
  // ... existing entries ...
  implementation_arm:
    "次の task() 呼び出しで、計画に基づく実装委譲を 1 回だけ許可します。\n承認済みと宣言していますが、Justice は外部の承認・マージ状態を検証できません。実行は人間による明示的な承認・マージ確認後にのみ継続してください。",
  implementation_arm_required:
    "実装委譲を開始するには `/justice-implement <planPath> --approved` を実行してください。\nJustice は外部の承認・マージを観測できないため、実装タスクの task() を強化する前に明示的な開始合図を必要としています。",
} as const satisfies Readonly<Record<WorkflowDirectiveStage, string>>;
```

```typescript
case "implementation_arm":
  return {
    stage: input.stage,
    marker: "[JUSTICE: IMPLEMENTATION ARMED]",
    requiredSkills: ["test-driven-development", "verification-before-completion"],
    nextAction: "delegate_task",
    authority: "external_unverified",
    guidance: GUIDANCE.implementation_arm,
  };
case "implementation_arm_required":
  return {
    stage: input.stage,
    marker: "[JUSTICE: IMPLEMENTATION ARM REQUIRED]",
    requiredSkills: [],
    nextAction: "await_human_approval",
    authority: "external_unverified",
    guidance: GUIDANCE.implementation_arm_required,
  };
```

- [ ] **Step 3: パーサーを実装する**

`src/core/implement-command.ts` を新規作成:

```typescript
import * as path from "node:path";
import type { ImplementationArmRequest, WorkflowStartSource } from "./types";
import { normalizeSafeRelativePath } from "./path-utils";

export const JUSTICE_IMPLEMENT_COMMAND = "justice-implement";

export function isJusticeImplementCommand(commandName: string | undefined): boolean {
  if (commandName === undefined) return false;
  const trimmed = commandName.trim();
  const withoutSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  return withoutSlash === JUSTICE_IMPLEMENT_COMMAND;
}

export function parseJusticeImplementCommandArguments(
  argumentsString: string,
): ImplementationArmRequest | null {
  const args = argumentsString.trim().split(/\s+/).filter(Boolean);

  let planFlagIndex = args.indexOf("--plan");
  if (planFlagIndex === -1) {
    // 互換: 先頭トークンを plan パスとして扱う（未指定の場合は失敗）
    return null;
  }

  const planPathRaw = args[planFlagIndex + 1];
  if (planPathRaw === undefined) return null;

  const planPath = normalizeSafeRelativePath(planPathRaw);
  if (planPath === null) return null;

  const approved = args.includes("--approved");

  return {
    source: "command",
    planPath,
    approved,
  };
}
```

注: `WorkflowStartSource` は既存の `"command" | "fallback_marker"` のまま流用する。

- [ ] **Step 4: 失敗テストを書く**

`tests/core/implement-command.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import {
  isJusticeImplementCommand,
  parseJusticeImplementCommandArguments,
} from "../../src/core/implement-command";

describe("isJusticeImplementCommand", () => {
  it("returns true for justice-implement with leading slash", () => {
    expect(isJusticeImplementCommand("/justice-implement")).toBe(true);
  });

  it("returns true for justice-implement without leading slash", () => {
    expect(isJusticeImplementCommand("justice-implement")).toBe(true);
  });

  it("returns false for unrelated command", () => {
    expect(isJusticeImplementCommand("justice-start")).toBe(false);
  });
});

describe("parseJusticeImplementCommandArguments", () => {
  it("parses --plan and --approved", () => {
    const result = parseJusticeImplementCommandArguments(
      "--plan docs/plans/feature.md --approved",
    );
    expect(result).toEqual({
      source: "command",
      planPath: "docs/plans/feature.md",
      approved: true,
    });
  });

  it("rejects missing --plan", () => {
    expect(parseJusticeImplementCommandArguments("--approved")).toBeNull();
  });

  it("rejects missing value for --plan", () => {
    expect(parseJusticeImplementCommandArguments("--plan")).toBeNull();
  });

  it("rejects absolute paths", () => {
    expect(parseJusticeImplementCommandArguments("--plan /etc/passwd")).toBeNull();
  });

  it("rejects path traversal", () => {
    expect(parseJusticeImplementCommandArguments("--plan ../other.md")).toBeNull();
  });
});
```

- [ ] **Step 5: テストを実行して失敗を確認する**

Run: `bun test tests/core/implement-command.test.ts`
Expected: `parseJusticeImplementCommandArguments` / `isJusticeImplementCommand` が未定義で FAIL

- [ ] **Step 6: 実装を追加してテストが通ることを確認する**

`src/core/implement-command.ts` を作成し、テストを再実行する。

Run: `bun test tests/core/implement-command.test.ts`
Expected: PASS

- [ ] **Step 7: `workflow-directives.ts` のテストを更新する**

`tests/core/workflow-directives.test.ts` に `implementation_arm` / `implementation_arm_required` のケースを追加する。

```typescript
it("resolves implementation_arm directive", () => {
  const directive = resolveWorkflowDirective({ stage: "implementation_arm" });
  expect(directive.stage).toBe("implementation_arm");
  expect(directive.nextAction).toBe("delegate_task");
  expect(directive.requiredSkills).toEqual([
    "test-driven-development",
    "verification-before-completion",
  ]);
});

it("resolves implementation_arm_required directive", () => {
  const directive = resolveWorkflowDirective({ stage: "implementation_arm_required" });
  expect(directive.stage).toBe("implementation_arm_required");
  expect(directive.nextAction).toBe("await_human_approval");
  expect(directive.requiredSkills).toEqual([]);
});
```

Run: `bun test tests/core/workflow-directives.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/workflow-directives.ts src/core/implement-command.ts tests/core/implement-command.test.ts tests/core/workflow-directives.test.ts
git commit -m "feat(core): add /justice-implement command parser and directive stages"
```

---

### Task 2: PlanBridge に implementation arm 状態を追加

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Create: `tests/hooks/plan-bridge-implement.test.ts`

**Interfaces:**
- Consumes: `ImplementationArmRequest`, `ImplementationArmResult`, `formatWorkflowDirective`, `resolveWorkflowDirective`, `WorkflowDirectiveStage`
- Produces: `PlanBridge.handleImplementationArm`, `PlanBridge.isImplementationArmed`, `PlanBridge.consumeImplementationArm`, `WorkflowBootstrapState` optional `armedTaskId`

- [ ] **Step 1: 状態管理を追加する**

`src/hooks/plan-bridge.ts` の `PlanBridge` クラスに新しい private field を追加する:

```typescript
/** セッション → 実装許可 (implementation_arm) 状態 */
private implementationArmedSessions = new Map<string, { planPath: string }>();
```

セッション単位でクリアする既存メソッド (`clearSessionCompletionInputs` など) にも消去処理を追加する。

- [ ] **Step 2: `handleImplementationArm` メソッドを追加する**

```typescript
async handleImplementationArm(
  sessionId: string,
  request: ImplementationArmRequest,
): Promise<ImplementationArmResult> {
  const planPath = await this.resolveActivatablePlanPath(request.planPath);
  if (planPath === null) {
    return {
      armed: false,
      planPath: null,
      directiveStage: "implementation_arm_required",
      guidance: formatWorkflowDirective({ stage: "implementation_arm_required" }),
    };
  }

  const activePlanPath = this.getActivePlan(sessionId);
  if (activePlanPath !== null && activePlanPath !== planPath) {
    // 既に別の plan が active なら警告だが fail-open
    this.safeNotify(
      sessionId,
      undefined,
      "warning",
      "implementation_arm",
      "Plan mismatch",
      `Active plan ${activePlanPath} differs from requested ${planPath}.`,
    );
  }

  if (!request.approved) {
    return {
      armed: false,
      planPath,
      directiveStage: "implementation_arm_required",
      guidance: formatWorkflowDirective({ stage: "implementation_arm_required" }),
    };
  }

  this.setActivePlan(sessionId, planPath);
  this.implementationArmedSessions.set(sessionId, { planPath });

  return {
    armed: true,
    planPath,
    directiveStage: "implementation_arm",
    guidance: this.formatImplementationArmGuidance(planPath),
  };
}

private formatImplementationArmGuidance(planPath: string): string {
  return formatWorkflowDirective({
    stage: "implementation_arm",
    planPath,
  });
}
```

- [ ] **Step 3: 許可消費メソッドを追加する**

```typescript
consumeImplementationArm(sessionId: string): { planPath: string } | null {
  const armed = this.implementationArmedSessions.get(sessionId) ?? null;
  if (armed === null) return null;
  this.implementationArmedSessions.delete(sessionId);
  return armed;
}

isImplementationArmed(sessionId: string): boolean {
  return this.implementationArmedSessions.has(sessionId);
}
```

- [ ] **Step 4: `handlePreToolUse` の注入ロジックを修正する**

`handlePreToolUse` で `task()` ツールを傍受したとき、active plan がある場合の注入条件を変更する:

```typescript
const armed = this.consumeImplementationArm(event.sessionId);
const implementationStage: WorkflowDirectiveStage =
  armed !== null ? "implementation" : "implementation_unauthorized";

const implementationDirective = resolveWorkflowDirective({ stage: implementationStage });
```

`withImplementationDirective` の代わりに、resolved stage を使って directive を生成する。

既存の `withImplementationDirective` メソッドは `bootstrap.phase` に依存していたが、新しい arm 状態を優先するよう変更する:

```typescript
private withImplementationDirective(context: string, sessionId: string): string {
  const armed = this.isImplementationArmed(sessionId);
  const stage: WorkflowDirectiveStage = armed ? "implementation" : "implementation_unauthorized";
  return `${context}\n\n${formatWorkflowDirective({ stage })}`;
}
```

注: `handleMessage` (plan.md 言及トリガー) も `withImplementationDirective` を経由するため、同じく arm 状態が必要になる。

- [ ] **Step 5: 失敗テストを書く**

`tests/hooks/plan-bridge-implement.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { PlanBridge } from "../../src/hooks/plan-bridge";
import { MockFileSystem } from "../helpers/mock-file-system";
import { MockNotifier } from "../helpers/mock-notifier";

describe("PlanBridge.handleImplementationArm", () => {
  it("arms session when plan is readable and approved", async () => {
    const fs = new MockFileSystem({ "plan.md": "## Task 1\n- [ ] step" });
    const notifier = new MockNotifier();
    const bridge = new PlanBridge({ fileReader: fs, notifier });

    const result = await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    expect(result.armed).toBe(true);
    expect(result.planPath).toBe("plan.md");
    expect(result.directiveStage).toBe("implementation_arm");
    expect(bridge.isImplementationArmed("session-1")).toBe(true);
  });

  it("refuses to arm when not approved", async () => {
    const fs = new MockFileSystem({ "plan.md": "## Task 1\n- [ ] step" });
    const notifier = new MockNotifier();
    const bridge = new PlanBridge({ fileReader: fs, notifier });

    const result = await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: false,
    });

    expect(result.armed).toBe(false);
    expect(bridge.isImplementationArmed("session-1")).toBe(false);
  });

  it("rejects unreadable plan path", async () => {
    const fs = new MockFileSystem({});
    const notifier = new MockNotifier();
    const bridge = new PlanBridge({ fileReader: fs, notifier });

    const result = await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "missing.md",
      approved: true,
    });

    expect(result.armed).toBe(false);
    expect(result.planPath).toBeNull();
  });

  it("consumes arm state on task pre-tool-use", async () => {
    const fs = new MockFileSystem({ "plan.md": "## Task 1\n- [ ] step" });
    const notifier = new MockNotifier();
    const bridge = new PlanBridge({ fileReader: fs, notifier });

    await bridge.handleImplementationArm("session-1", {
      source: "command",
      planPath: "plan.md",
      approved: true,
    });

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { prompt: "do it" },
      },
    });

    expect(response.action).toBe("inject");
    expect(response.injectedContext).toContain("[JUSTICE: IMPLEMENTATION]");
    expect(bridge.isImplementationArmed("session-1")).toBe(false);
  });

  it("returns unauthorized when not armed", async () => {
    const fs = new MockFileSystem({ "plan.md": "## Task 1\n- [ ] step" });
    const notifier = new MockNotifier();
    const bridge = new PlanBridge({ fileReader: fs, notifier });
    await bridge.setActivePlan("session-1", "plan.md");

    const response = await bridge.handlePreToolUse({
      type: "PreToolUse",
      sessionId: "session-1",
      callId: "call-1",
      payload: {
        toolName: "task",
        toolInput: { prompt: "do it" },
      },
    });

    expect(response.action).toBe("inject");
    expect(response.injectedContext).toContain("[JUSTICE: IMPLEMENTATION UNAUTHORIZED]");
  });
});
```

注: `MockFileSystem`, `MockNotifier`, `PlanBridge` constructor signature は実際のコードベースに合わせて調整すること。

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `bun test tests/hooks/plan-bridge-implement.test.ts`
Expected: FAIL (handleImplementationArm 等が未定義)

- [ ] **Step 7: 実装してテストを通す**

`src/hooks/plan-bridge.ts` を修正し、テストを再実行する。

Run: `bun test tests/hooks/plan-bridge-implement.test.ts`
Expected: PASS

- [ ] **Step 8: 既存テストの影響を確認する**

Run: `bun test tests/hooks/plan-bridge.test.ts tests/hooks/plan-bridge-posttooluse.test.ts`
Expected: PASS。失敗した場合は `setActivePlan` のみで arm していない既存ケースが unauthorized にならないよう、必要に応じて arm 呼び出しを追加するか、legacy 互換を維持する。

重要: 既存の `/justice-start plan_ready` 後の挙動を壊さないため、`handleWorkflowStart` が `plan_ready` の場合も `implementationArmedSessions` を set するか、あるいは既存テストに `--approved` 相当の arm ステップを追加する。推奨は後者（新しい UX に合わせてテストを更新）。

- [ ] **Step 9: Commit**

```bash
git add src/hooks/plan-bridge.ts tests/hooks/plan-bridge-implement.test.ts
git commit -m "feat(plan-bridge): add implementation arm state and consumption"
```

---

### Task 3: OpenCodeAdapter で `justice-implement` コマンドを処理

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/core/implement-command.ts` (command constant export)
- Test: `tests/runtime/opencode-adapter.test.ts` (既存を拡張)

**Interfaces:**
- Consumes: `isJusticeImplementCommand`, `parseJusticeImplementCommandArguments`
- Produces: `OpenCodeAdapter.onCommandExecuteBefore` handles both `justice-start` and `justice-implement`

- [ ] **Step 1: コマンド分岐を追加する**

`src/runtime/opencode-adapter.ts` の `onCommandExecuteBefore` を修正する:

```typescript
async onCommandExecuteBefore(
  input: CommandExecuteBeforeInput,
  output: CommandExecuteBeforeOutput,
): Promise<void> {
  if (this.#noOp) return;

  try {
    if (isJusticeStartCommand(input.command)) {
      await this.#handleWorkflowStart(input, output);
      return;
    }

    if (isJusticeImplementCommand(input.command)) {
      await this.#handleImplementationArm(input, output);
      return;
    }
  } catch (err) {
    await this.log("error", "[Justice] onCommandExecuteBefore failure", err);
  }
}
```

- [ ] **Step 2: private helper を追加する**

```typescript
async #handleImplementationArm(
  input: CommandExecuteBeforeInput,
  output: CommandExecuteBeforeOutput,
): Promise<void> {
  const request = parseJusticeImplementCommandArguments(input.arguments);
  if (request === null) {
    await this.log("warn", "[Justice] /justice-implement arguments rejected by parser; ignoring");
    return;
  }

  await this.ensureInitialized();
  const justice = this.#justice;
  if (!justice) return;

  const result = await justice.getPlanBridge().handleImplementationArm(
    input.sessionID,
    request,
  );

  if (result.guidance.length === 0) return;
  output.parts.push(this.#buildWorkflowDirectivePart(input.sessionID, result.guidance));
}
```

- [ ] **Step 3: 既存の workflow start handler を private メソッド化する**

`onCommandExecuteBefore` 内のローカル処理を `#handleWorkflowStart` private method に切り出して可読性を保つ。

- [ ] **Step 4: 失敗テストを追加する**

`tests/runtime/opencode-adapter.test.ts` に以下を追加する:

```typescript
it("injects implementation arm guidance for /justice-implement", async () => {
  // setup adapter with mocked justice / plan bridge
  const output: CommandExecuteBeforeOutput = { parts: [] };
  await adapter.onCommandExecuteBefore(
    {
      command: "justice-implement",
      arguments: "--plan plan.md --approved",
      sessionID: "session-1",
    },
    output,
  );

  expect(output.parts.length).toBe(1);
  expect(output.parts[0]?.text).toContain("[JUSTICE: IMPLEMENTATION ARMED]");
});

it("ignores malformed /justice-implement arguments", async () => {
  const output: CommandExecuteBeforeOutput = { parts: [] };
  await adapter.onCommandExecuteBefore(
    {
      command: "justice-implement",
      arguments: "--approved",
      sessionID: "session-1",
    },
    output,
  );

  expect(output.parts.length).toBe(0);
});
```

- [ ] **Step 5: テストを実行する**

Run: `bun test tests/runtime/opencode-adapter.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/runtime/opencode-adapter.ts tests/runtime/opencode-adapter.test.ts
git commit -m "feat(adapter): wire /justice-implement command into command.execute.before"
```

---

### Task 4: ドキュメント更新

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `SPEC.md` (§4.1a および workflow directive セクション)

**Interfaces:**
- Consumes: 新しい command/parser/stage 実装
- Produces: ユーザー向け・開発者向けドキュメント

- [ ] **Step 1: README.md に `/justice-implement` セクションを追加する**

既存の `/justice-start` セクションの直後に追加:

```markdown
## `/justice-implement` コマンド

アクティブな計画に対して、次の 1 回の `task()` で実装委譲を開始することを明示的に許可するコマンドです。

```bash
/justice-implement --plan <planPath> --approved
```

**例:**

```
/justice-implement --plan docs/plans/feature.md --approved
```

### 引数文法

- **`--plan <path>`** (必須): 計画ファイルの相対パス。
- **`--approved`** (任意): 人間による承認・マージが確認済みであることを宣言します。Justice はこの状態を検証できません; これは単に実装委譲を強化するための合図です。

### 動作

- コマンドは `task()` やスキルを起動しません。次の `task()` 呼び出しに対して、Justice が計画コンテキストと実装 directive を注入する権利を 1 回だけ付与します。
- 未アーム状態で active plan に対して `task()` や plan.md 言及による委譲が発生した場合、`[JUSTICE: IMPLEMENTATION UNAUTHORIZED]` advisory が注入されます。
- 許可は 1 回の `task()` 呼び出しで消費されます。追加のタスクを委譲する場合は、必要に応じて再度 `/justice-implement` を実行してください。

### 有効化（OpenCode側の設定）

`/justice-start` と同様に、`/justice-implement` は OpenCode の組み込みコマンドではありません。利用者がコマンドを登録する必要があります。

**`.opencode/commands/justice-implement.md`**:

```markdown
---
description: Arm the next Justice-managed implementation delegation
---
$ARGUMENTS
```
```

- [ ] **Step 2: AGENTS.md の invariant セクションを更新する**

以下の行を追加:

```markdown
- **Advisory bootstrap**: `/justice-start` and `/justice-implement` guidance never invokes a skill or `task()`.
- **Implementation arm**: `handlePreToolUse` enriches `task()` only when the session is explicitly armed via `/justice-implement` or equivalent trusted trigger; otherwise it emits `implementation_unauthorized`.
```

- [ ] **Step 3: SPEC.md の command セクションを更新する**

§4.1a 周辺に `/justice-implement` の説明を追加:

```markdown
### 4.1a `command.execute.before` — `/justice-start` と `/justice-implement`

`OpenCodeAdapter.onCommandExecuteBefore` は以下の 2 つのコマンドを処理する:

- `justice-start`: ワークフロー・ブートストラップを開始し、design/plan/レビュー段階の guidance を注入する。
- `justice-implement`: active plan に対して次の `task()` での実装委譲を 1 回だけ許可し、`[JUSTICE: IMPLEMENTATION ARMED]` guidance を注入する。

どちらのコマンドも skill や `task()` を起動せず、純粋に synthetic text part を注入するのみである。
```

また、directive stage の表に `implementation_arm` / `implementation_arm_required` を追加する。

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md SPEC.md
git commit -m "docs: document /justice-implement command and arm semantics"
```

---

### Task 5: 統合検証

**Files:**
- All modified files

**Interfaces:**
- Consumes: すべての変更
- Produces: lint/type/test/build すべて通過

- [ ] **Step 1: devcontainer 内で lint を実行する**

Run: `bun run lint`
Expected: 0 errors, 0 warnings relevant to changed files

- [ ] **Step 2: devcontainer 内で型検査を実行する**

Run: `bun run typecheck`
Expected: 0 errors

- [ ] **Step 3: 全テストを実行する**

Run: `bun run test`
Expected: 全テスト PASS (既存テストも含む)

- [ ] **Step 4: ビルドを実行する**

Run: `bun run build`
Expected: 成功、`dist/` に成果物生成

- [ ] **Step 5: 変更を振り返る**

```bash
git diff --stat
git status
```

- [ ] **Step 6: Commit (fixup あれば)**

修正があれば commit する:

```bash
git add -A
git commit -m "fixup: address lint/type/test feedback"
```

---

## Spec Coverage Self-Review

| SPEC 要件 | 担当 Task |
|---|---|
| `/justice-start` は advisory only | Task 3 で維持 (`#handleImplementationArm` も skill/task 呼ばない) |
| `OpenCodeAdapter.getTools()` は `justice_review` のみ | 変更なし (Task 3) |
| fail-open | Task 2/3 で catch して degrade |
| pure core | `src/core/implement-command.ts` は `@opencode-ai/*` import なし |
| evidence trust (`declared` では Gate PASS しない) | README/SPEC で `--approved` は確認にすぎないと記述 |

## Placeholder Scan

- パーサーは完全な実装コードを含む。
- テストは具体的な値と期待値を含む。
- ドキュメントは frontmatter/template 例を含む。
- "TBD"/"TODO" は含まない。
