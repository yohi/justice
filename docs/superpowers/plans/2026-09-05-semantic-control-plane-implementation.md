# Semantic Control Plane Implementation Plan

> **For agentic workers:** Execute this plan **inline in the current session**. Do NOT dispatch subagents (subagent-driven-development は本プランでは利用禁止)。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Justice v4.0.0 Semantic Control Plane (JUS-P0-01..04): plan-scoped authorization with semantic fingerprints, complete `sp-*` category routing, evidence-based transactional task acceptance with durable review dispatch, and controller routing observation.

**Architecture:** 4 phases (per spec §9) implemented as a **stacked PR chain** on `master`. Pure core modules first (no hook wiring), then hook/adapter wiring, then docs. Each phase lands as one stacked PR with an appropriate diff size; intrusive phases (Phase 3) are split into reviewable sub-tasks committed on the same branch.

**Tech Stack:** TypeScript, Bun, Vitest, existing `AtomicPersistence` / `ObservationLogStore` / `PlanParser` / `SessionStateProvider` building blocks.

**Spec:** `docs/superpowers/specs/2026-09-03-semantic-control-plane-design.md` (SSOT for data models §4, protocols §4.8, invariants §8).

## Stacked PR Strategy

PR は stacked (直列) かつレビュー可能な差分量で作成する。**`gh stack` は使用せず**、通常の stacked branch 運用とする (次の PR の base branch に前の PR の head branch を指定):

| # | Branch (base branch) | Phase | 差分スコープ |
|---|----------------------|-------|--------------|
| PR-A | `feature/v4-category-routing` (base: `master`) | Phase 1 | types/routing-decision/omo-category-mapper + doctor カテゴリ検査 + テスト。Doctor README 追記は最小限 |
| PR-B | `feature/v4-plan-authorization` (base: PR-A branch) | Phase 2 | plan-fingerprint / plan-authorization core + PlanBridge 配線 + 破壊的 one-shot arm 廃止 |
| PR-C | `feature/v4-task-lifecycle-core` (base: PR-B branch) | Phase 3a | task-lifecycle / review-artifact / acceptance-decision の純粋コア (hook 非接続) |
| PR-D | `feature/v4-review-dispatch` (base: PR-C branch) | Phase 3b | review-dispatch-state / reservation / 帯域プロトコル + state-projection 拡張 |
| PR-E | `feature/v4-transactional-wiring` (base: PR-D branch) | Phase 3c | SessionStateProvider TaskCallBinding、observation-handler / task-feedback / justice-plugin の transactional order、PlanParser 直接更新撤廃 |
| PR-F | `feature/v4-controller-routing` (base: PR-E branch) | Phase 4 | controller-routing core + observation 接続 + doctor pinned-command + README/SPEC.md 更新 |

各 PR は「レビュアが独立に読める」粒度とし、`bun run test / typecheck / lint / build` 全绿を各 PR (各 branch の head) で通す。前の PR がマージされたら次の PR を `git rebase` で追従させる (rebase は人間が実行)。

## Global Constraints

- **Pure core**: `src/core/**` は `@opencode-ai/*` を import しない。Hook が調整役で core がビジネスロジック (AGENTS.md invariant 1)。
- **Fail-open execution / fail-closed acceptance**: I/O 障害は `PROCEED` 等の縮退で継続、`Authorized` / `Accepted` / `Complete` は根拠なき生成禁止。
- **Immutable public state**: `readonly` / `ReadonlyArray` / `ReadonlyMap`。private のみ可変。
- **No new persistence files**: plan authorization も既存 `.justice/authorizations.json` は Phase 2 で新設するが、既存の `AtomicPersistence` プリミティブを再利用する。
- **No subagents**: 本プラン実行時はサブエージェントを dispatch しない (ユーザー指定)。
- **テスト**: 通常の単体テストは mock FS (`tests/helpers/mock-file-system.ts`) 経由。実ディスクアクセスは指定統合スイートのみ。
- 新規コードのユニットテストは `tests/core/*.test.ts` / `tests/hooks/*.test.ts` に vitest で配置。既存 1469 テストは broken にしない (必ず 100% pass を維持)。
- コミット単位: タスク末尾の git add/commit は **ユーザーに確認してから** 実行する (エージェントの自律 commit は行わない)。
- Quality gate (各 Phase / PR 完了時): `bun run test && bun run typecheck && bun run lint && bun run build`。

---

## Phase 1 (PR-A): Semantic Category Routing — JUS-P0-03

既存状態: `src/core/types.ts:159-164` の `SpCategory` は `sp-deep` / `sp-architecture` を含まない。`omo-category-mapper.ts` の `ROLE_TO_CATEGORY` は `deep: undefined, architecture: undefined`。`category-classifier.ts` は `undefined` を受けたら `"unspecified-low"` に silent downgrade している。`routing-decision.ts` は `deep → { deep }`、`architecture → { unspecified-high, deep }`。これらを spec §5.3 の全射に置き換える。

### Task 1.1: 7 role → 7 category の全射化 (core)

**Files:**
- Modify: `src/core/types.ts` (`SpCategory`)
- Modify: `src/core/omo-category-mapper.ts`
- Modify: `src/core/routing-decision.ts`
- Modify: `src/core/category-classifier.ts`
- Modify: `src/core/retry-policy-calculator.ts` (category→閾値 map の追加)
- Test: `tests/core/routing-decision.test.ts`
- Test: `tests/core/category-classifier.test.ts`
- Test: `tests/core/omo-category-mapper.test.ts` (既存 `tests/unit/core/omo-category-mapper.test.ts` を移動・統合するか新規)

**Interfaces:**
- Consumes: 既存 `ExecutionRole` (7 role 定義済み), `CategoryClassifier.classify(task: PlanTask)`
- Produces: `OmoCategoryMapper.map(role: ExecutionRole): SpCategory` (全射。`undefined` 非返却)、`isSpCategory(value): value is SpCategory` が 7 値を受理、`CategoryClassifier.classify()` の返り値が 7 category のいずれか

- [ ] **Step 1: 失敗テストを書く — 7→7 全射**

`tests/core/routing-decision.test.ts` に追記:

```ts
it("routes deep to sp-deep and architecture to sp-architecture", () => {
  expect(createWorkerRoutingDecision("deep", "sp-deep", "task_classification").category).toBe("sp-deep");
  expect(
    createWorkerRoutingDecision("architecture", "sp-architecture", "task_classification").category,
  ).toBe("sp-architecture");
});

it("rejects architecture -> unspecified-high (legacy downgrade)", () => {
  expect(() =>
    createWorkerRoutingDecision("architecture", "unspecified-high", "task_classification"),
  ).toThrow();
  expect(() => createWorkerRoutingDecision("deep", "deep", "task_classification")).toThrow();
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts`
Expected: FAIL (断言を含む行で throw しない / category 不一致)

- [ ] **Step 3: `SpCategory` に `sp-deep` / `sp-architecture` を追加**

`src/core/types.ts` の `SpCategory` union に両者を追加。`TaskCategory` から `"deep"` / `"unspecified-high"` は **残す** (spec では OMO 一般 category、Justice 生成の routing 決定は sp-* に限定。しかし TaskCategory を残すと古 route を残す余地があるため、後段の PlanBridge / CategoryClassifier から参照を削除することを Task 1.2 で行う)。

```ts
export type SpCategory =
  | "sp-mechanical"
  | "sp-implementation"
  | "sp-integration"
  | "sp-review"
  | "sp-final-review"
  | "sp-deep"
  | "sp-architecture";
```

- [ ] **Step 4: `omo-category-mapper.ts` を全射に変更**

```ts
const ROLE_TO_CATEGORY: Readonly<Record<ExecutionRole, SpCategory>> = {
  mechanical: "sp-mechanical",
  implementation: "sp-implementation",
  integration: "sp-integration",
  review: "sp-review",
  "final-review": "sp-final-review",
  deep: "sp-deep",
  architecture: "sp-architecture",
};

export class OmoCategoryMapper {
  map(role: ExecutionRole): SpCategory {
    return ROLE_TO_CATEGORY[role];
  }
  isSpCategory(value: string): value is SpCategory {
    return (SP_CATEGORIES as ReadonlySet<string>).has(value);
  }
}
```

同時に `SP_CATEGORIES` を 7 値に拡張。

- [ ] **Step 5: `routing-decision.ts` の VALID map を単射化**

`deep` → `["sp-deep"]`、`architecture` → `["sp-architecture"]` に変更。

- [ ] **Step 6: `category-classifier.ts` の silent fallback 削除**

`return category ?? "unspecified-low"` を削除し、`return this.categoryMapper.map(role)` とする (map は必ず値を返す)。`SpCategory | TaskCategory` 戻り型を `SpCategory` に狭める。

- [ ] **Step 7: `retry-policy-calculator.ts` に `sp-deep` / `sp-architecture` の閾値を追加**

既存の `sp-*` 同様に key を追加 (値は既存 `deep, unspecified-high` の値から合理的に選ぶ。`sp-deep = deep の値、sp-architecture = unspecified-high の値` を再利用)。

- [ ] **Step 8: 全テストを実行**

Run: `devcontainer exec --workspace-folder . bun run vitest run tests/core/routing-decision.test.ts tests/core/category-classifier.test.ts`
Expected: PASS (全テスト)

- [ ] **Step 9: 全体で壊れた影響を調査・修正**

`grep -rn "unspecified-low\|compatibility_fallback\|unspecified-high" src` で使い残しを洗い出し、現在 `category === "unspecified-low" ? "compatibility_fallback" : "classifier"` の分岐を廃止するか統一。`retry-policy-calculator.test.ts` 等も必要なら修正。

- [ ] **Step 10: Commit (確認後)**

```bash
git add src/core/types.ts src/core/omo-category-mapper.ts src/core/routing-decision.ts src/core/category-classifier.ts src/core/retry-policy-calculator.ts tests/core/routing-decision.test.ts tests/core/category-classifier.test.ts
git commit -m "feat: 7 execution role を 7 sp-* category に全射化"
```

### Task 1.2: justice doctor に category 存在検査を追加

**Files:**
- Modify: `src/core/doctor-config.ts` または新規 `src/core/doctor-categories.ts`
- Modify: `src/runtime/doctor-cli.ts` (新チェック呼び出し)
- Test: `tests/doctor/category-presence.test.ts` (コードベースの慣習に従い `tests/core/doctor-config.test.ts` 系、または既存診断テスト構造に従う)

**Interfaces:**
- Consumes: `SpCategory` (7 値), `doctor-config.ts` の `DoctorCheckResult` 型
- Produces: `checkSpCategoriesPresence(config): DoctorCheckItem[]` 相当の純粋関数。7 カテゴリのいずれかが設定に無い場合は detail と共に fail/partial

- [ ] **Step 1: 失敗テスト**

`tests/doctor/category-presence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkSpCategoryPresence, ALL_SP_CATEGORIES } from "../../src/core/doctor-categories";

describe("checkSpCategoryPresence", () => {
  it("passes when all 7 sp-* categories are present", () => {
    const config = { categories: ALL_SP_CATEGORIES.map((c) => ({ name: c })) };
    const result = checkSpCategoryPresence(config);
    expect(result.status).toBe("pass");
    expect(result.missing).toEqual([]);
  });

  it("reports missing categories by name", () => {
    const config = { categories: [{ name: "sp-mechanical" }] };
    const result = checkSpCategoryPresence(config);
    expect(result.status).toBe("fail");
    expect(result.missing).toEqual([
      "sp-implementation",
      "sp-integration",
      "sp-review",
      "sp-final-review",
      "sp-deep",
      "sp-architecture",
    ]);
  });
});
```

- [ ] **Step 2: テスト失敗を確認** `devcontainer exec --workspace-folder . bun run vitest run tests/doctor/category-presence.test.ts` → FAIL

- [ ] **Step 3: `src/core/doctor-categories.ts` を作成**

```ts
import type { SpCategory } from "./types";

export const ALL_SP_CATEGORIES: readonly SpCategory[] = [
  "sp-mechanical",
  "sp-implementation",
  "sp-integration",
  "sp-review",
  "sp-final-review",
  "sp-deep",
  "sp-architecture",
] as const;

export interface SpCategoryPresenceResult {
  readonly status: "pass" | "fail";
  readonly missing: readonly SpCategory[];
  readonly present: readonly SpCategory[];
}

export function checkSpCategoryPresence(config: {
  readonly categories?: readonly { readonly name?: string }[];
}): SpCategoryPresenceResult {
  const present = new Set(config.categories?.map((c) => c.name) ?? []);
  const missing = ALL_SP_CATEGORIES.filter((c) => !present.has(c));
  const presentList = ALL_SP_CATEGORIES.filter((c) => present.has(c));
  return {
    status: missing.length === 0 ? "pass" : "fail",
    missing,
    present: presentList,
  };
}
```

- [ ] **Step 4: `doctor-cli.ts` 配線** (既存の check 実行箇所に `checkSpCategoryPresence` を追加; fail なら非ゼロ終了へ含めるが既存 doctor 全 check 総合評価を必ず先行させる)

- [ ] **Step 5: 全テスト実行**

Run `bun run test` → PASS

- [ ] **Step 6: Commit (確認後)**

```bash
git add src/core/doctor-categories.ts src/runtime/doctor-cli.ts tests/doctor/category-presence.test.ts
git commit -m "feat(doctor): 7 sp-* category の存在検査を追加"
```

---

## Phase 2 (PR-B): Plan-Scoped Authorization — JUS-P0-02

### Task 2.1: PlanFingerprint / CanonicalPlanSnapshot コア

**Files:**
- Create: `src/core/plan-fingerprint.ts`
- Test: `tests/core/plan-fingerprint.test.ts`

**Interfaces:**
- Consumes: `PlanParser` (既存)、`hashString` from `src/core/v2/hash.ts`
- Produces: 設計書 §4.3 の型のまま。`computePlanFingerprint(raw: string, taskIds: readonly string[]): PlanFingerprint`、`buildCanonicalSnapshot(raw: string, taskIds: readonly string[]): CanonicalPlanSnapshot`。**正規化は「task 配下の実行 checkbox 状態 (`- [ ]` ↔ `- [x]`)」と `EOL` のみ**に限定。

- [ ] **Step 1: 失敗テスト**

`tests/core/plan-fingerprint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computePlanFingerprint, buildCanonicalSnapshot } from "../../src/core/plan-fingerprint";

const PLAN = [
  "# Plan",
  "",
  "### Task 1: a",
  "- [ ] step A",
  "- [ ] step B",
  "",
  "### Task 2: b",
  "- [ ] step C",
].join("\n");

const PLAN_CHECKED = PLAN.replace("- [ ] step A", "- [x] step A");
const PLAN_RENAMED = PLAN.replace("step A", "step A2");

describe("computePlanFingerprint", () => {
  it("ignores EOL changes", () => {
    const crlf = PLAN.replace(/\n/g, "\r\n");
    expect(computePlanFingerprint(crlf, ["task-1", "task-2"])).toEqual(
      computePlanFingerprint(PLAN, ["task-1", "task-2"]),
    );
  });

  it("ignores checkbox state changes to in-progress tasks", () => {
    expect(computePlanFingerprint(PLAN_CHECKED, ["task-1", "task-2"])).toEqual(
      computePlanFingerprint(PLAN, ["task-1", "task-2"]),
    );
  });

  it("changes when task body is modified", () => {
    expect(computePlanFingerprint(PLAN_RENAMED, ["task-1", "task-2"])).not.toEqual(
      computePlanFingerprint(PLAN, ["task-1", "task-2"]),
    );
  });

  it("does not normalize fenced code blocks", () => {
    const withCode = PLAN + "\n```ts\nconst   x  =  1;\n```\n";
    expect(computePlanFingerprint(withCode, ["task-1", "task-2"])).not.toEqual(
      computePlanFingerprint(PLAN + "\n```ts\nconst x = 1;\n```\n", ["task-1", "task-2"]),
    );
  });
});

describe("buildCanonicalSnapshot", () => {
  it("captures task ids and document digest", () => {
    const snap = buildCanonicalSnapshot(PLAN, ["task-1", "task-2"]);
    expect(snap.schema).toBe("justice-plan-v1");
    expect(snap.tasks).toHaveLength(2);
    expect(snap.tasks.map((t) => t.taskId)).toEqual(["task-1", "task-2"]);
  });
});
```

- [ ] **Step 2: テスト失敗確認** `devcontainer exec --workspace-folder . bun run vitest run tests/core/plan-fingerprint.test.ts` → FAIL

- [ ] **Step 3: 最小実装**

`src/core/plan-fingerprint.ts`:

```ts
import { hashString } from "./v2/hash";

export type PlanFingerprint = {
  readonly algorithm: "sha256";
  readonly value: string;
};

export type CanonicalTaskSnapshot = {
  readonly taskId: string;
  readonly title: string;
  readonly canonicalBody: string;
  readonly digest: string;
};

export type CanonicalPlanSnapshot = {
  readonly schema: "justice-plan-v1";
  readonly documentDigest: string;
  readonly globalBodyDigest: string;
  readonly tasks: ReadonlyArray<CanonicalTaskSnapshot>;
};

export function computePlanFingerprint(
  raw: string,
  taskIds: readonly string[],
): PlanFingerprint {
  return {
    algorithm: "sha256",
    value: hashString(canonicalize(raw, taskIds)).replace(/^sha256:/, ""),
  };
}

export function buildCanonicalSnapshot(raw: string, taskIds: readonly string[]): CanonicalPlanSnapshot {
  // Task 区切りは PlanParser と同じ行規則に揃えるが、checkbox のみ normalize。
  // fenced code block 内部は一切 normalize しない(SPEC §4.3)。
  const normalizedLines = normalizeTaskCheckboxes(splitLinesAndProtectFenced(raw), taskIds);
  const documentDigest = hashString(normalizedLines.join("\n"));
  // ... tasks / global segment 抽出 & 個別 digest
  // (実装は consumption unit を task 単位に分離: ### Task n: ... セクションのみ taskに正規化)
}

function canonicalize(raw: string, taskIds: readonly string[]): string {
  return normalizeTaskCheckboxes(splitLinesAndProtectFenced(raw), taskIds).join("\n");
}

function splitLinesAndProtectFenced(raw: string): readonly { readonly line: string; readonly inFence: boolean }[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  return lines.map((line) => {
    const isFenceEdge = /^\s*```/.test(line);
    const result = { line, inFence: inFence && !isFenceEdge };
    if (isFenceEdge) inFence = !inFence;
    return result;
  });
}

function normalizeTaskCheckboxes(
  lines: readonly { readonly line: string; readonly inFence: boolean }[],
  _taskIds: readonly string[],
): readonly string[] {
  // checkbox は task 内の `- [ ]` / `- [x]` のみを `- [ ]` に正規化。
  // task 外 (global/unscoped) の checkbox は正規化しない (SPEC §11)。
  // fenced 内部は一切触らない.
  return lines.map((entry) =>
    entry.inFence ? entry.line : entry.line.replace(/^(\s*-\s+\[)[ xX](\]\s+.*)$/, "$1 $2"),
  );
}
```

- [ ] **Step 4: テスト通過確認** → PASS

- [ ] **Step 5: Commit (確認後)**

```bash
git add src/core/plan-fingerprint.ts tests/core/plan-fingerprint.test.ts
git commit -m "feat: plan fingerprint canonical hash を追加 (checkbox のみ normalize)"
```

### Task 2.2: PlanAuthorization コア

**Files:**
- Create: `src/core/plan-authorization.ts`
- Test: `tests/core/plan-authorization.test.ts`

**Interfaces:**
- Consumes: `PlanFingerprint` (Task 2.1), `AtomicPersistence` (既存)
- Produces: `ApprovedPlanBinding`, `AuthorizationMergeRule`, `createApprovedPlanBinding(...)`, `invalidateBinding(...)`, `isBindingEligibleForTask(b, sessionId, planPath, fp)`。全て純粋。

- [ ] **Step 1: 失敗テスト**

```ts
import { describe, it, expect } from "vitest";
import {
  createApprovedPlanBinding,
  invalidateBinding,
  isBindingActiveFor,
  mergeBindings,
} from "../../src/core/plan-authorization";

const fp = { algorithm: "sha256" as const, value: "abc" };
const base = {
  sessionId: "s1",
  planPath: "docs/plan.md",
  planFingerprint: fp,
  fingerprintSchema: "justice-plan-v1" as const,
  approvedAt: "2026-09-05T00:00:00Z",
};

describe("plan-authorization", () => {
  it("creates an active binding with new uuid", () => {
    const b = createApprovedPlanBinding(base);
    expect(b.status).toBe("active");
    expect(b.authorizationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("invalidated bindings are terminal (cannot resurrect)", () => {
    const active = createApprovedPlanBinding(base);
    const dead = invalidateBinding(active, "semantic_change");
    const resurrected = invalidateBinding(active, "x");
    const merged = mergeBindings(resurrected /*mine*/, dead /*theirs*/);
    expect(merged.status).toBe("invalidated");
  });

  it("isBindingActiveFor matches session/plan/fingerprint", () => {
    const b = createApprovedPlanBinding(base);
    expect(isBindingActiveFor(b, "s1", "docs/plan.md", fp)).toBe(true);
    expect(isBindingActiveFor(b, "other", "docs/plan.md", fp)).toBe(false);
    expect(isBindingActiveFor(b, "s1", "docs/plan.md", { algorithm: "sha256", value: "zzz" })).toBe(false);
  });
});
```

Run → FAIL

- [ ] **Step 2: 実装 (純粋関数 + private でさえ terminal 復活禁止 merge)**

`src/core/plan-authorization.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { PlanFingerprint } from "./plan-fingerprint";

export type ApprovedPlanBinding = {
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly fingerprintSchema: "justice-plan-v1";
  readonly approvedAt: string;
  readonly status: "active" | "invalidated" | "released";
  readonly invalidatedAt?: string;
  readonly releasedAt?: string;
};

export function createApprovedPlanBinding(input: {
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly approvedAt: string;
}): ApprovedPlanBinding {
  return {
    authorizationId: randomUUID(),
    fingerprintSchema: "justice-plan-v1",
    status: "active",
    ...input,
  };
}

export function invalidateBinding(
  b: ApprovedPlanBinding,
  reason: string,
  at = new Date().toISOString(),
): ApprovedPlanBinding {
  if (b.status === "invalidated") return b;
  return { ...b, status: "invalidated", invalidatedAt: at };
}

export function releaseBinding(b: ApprovedPlanBinding, at = new Date().toISOString()): ApprovedPlanBinding {
  return { ...b, status: "released", releasedAt: at };
}

export function isBindingActiveFor(
  b: ApprovedPlanBinding,
  sessionId: string,
  planPath: string,
  fp: PlanFingerprint,
): boolean {
  return (
    b.status === "active" &&
    b.sessionId === sessionId &&
    b.planPath === planPath &&
    b.planFingerprint.value === fp.value
  );
}

export function mergeBindings(
  mine: ApprovedPlanBinding,
  theirs: ApprovedPlanBinding,
): ApprovedPlanBinding {
  if (mine.authorizationId !== theirs.authorizationId) return mine;
  if (isTerminal(theirs) && !isTerminal(mine)) return theirs;
  if (isTerminal(mine) && isTerminal(theirs))
    return laterOf(mine, theirs);
  return mine;
}
function isTerminal(b: ApprovedPlanBinding): boolean {
  return b.status !== "active";
}
function laterOf(a: ApprovedPlanBinding, b: ApprovedPlanBinding): ApprovedPlanBinding {
  const ta = (a.invalidatedAt ?? a.releasedAt ?? a.approvedAt) || "";
  const tb = (b.invalidatedAt ?? b.releasedAt ?? b.approvedAt) || "";
  return ta >= tb ? a : b;
}
```

- [ ] **Step 3: テスト確認 → Commit (確認後)**

`bun run vitest run tests/core/plan-authorization.test.ts` → PASS。
`git add ... && git commit -m "feat: ApprovedPlanBinding lifecycle を追加 (terminal 不可逆)"`

### Task 2.3: PlanBridge の authorization 配線

**Files:**
- Modify: `src/hooks/plan-bridge.ts`
- Modify: `src/core/justice-plugin.ts` (アクター保持: `PlanBridge.setAuthorizationProvider(...)` 等の筋道)
- Modify: `src/core/implement-command.ts` (はあり伏せ + fingerprint 要求)
- Test: `tests/hooks/plan-bridge-authorization.test.ts`

**Interfaces:**
- Consumes: `ApprovedPlanBinding`, `computePlanFingerprint`
- Produces: PlanBridge が `implementationArmedSessions` の代わりに `authorizationStore` を参照。`task()` PreToolUse 介入条件を binding 条件に置換。

- [ ] **Step 1: 失敗テスト (binding が `active` の場合のみ enrich)**

```ts
it("enriches when an active authorization matches the current plan", async () => {
  const bridge = setupWithAuthorization(activeBinding);
  const res = await bridge.handlePreToolUse(taskCallEvent);
  expect(res.action).toBe("inject");
  expect(modifiedPayload(res)?.args?.load_skills).toContain("test-driven-development");
});

it("emits implementation_unauthorized when fingerprint mismatched", async () => {
  const bridge = setupWithAuthorization(mismatchedFingerprintBinding);
  const res = await bridge.handlePreToolUse(taskCallEvent);
  expect(res.injectedContext).toContain("AUTHORIZATION INVALIDATED");
});
```

→ FAIL

- [ ] **Step 2: PlanBridge の `consumeImplementationArm` を `ApprovedPlanBinding` ベースに置換**

- `/justice-implement --plan <p> --approved` で `computePlanFingerprint` + `createApprovedPlanBinding` + AtomicPersistence 保存 → PlanBridge へ binding キャッシュ
- `handlePreToolUse` で `isBindingActiveFor(binding, sessionId, planPath, currentFp)`
- 不一致 → `invalidateBinding` + 永続化 + advisory `[JUSTICE: AUTHORIZATION INVALIDATED]`
- `PlanCompletion / cancelled` → `releaseBinding`
- Hydration: plugin startup で `.justice/authorizations.json` を読み `active` を bridge に設定。file missing → invalidated。
- 同一 session の active binding ≤ 1: approve 時既存 active は atomically `invalidated (plan_superseded)`。

- [ ] **Step 3: 既存 `implementationArmedSessions` / one-shot arm を削除**

README の破壊的変更として文書化 (別タスク)。grep で使い残しを消す。

- [ ] **Step 4: テスト + Commit (確認後)**

`bun run test && bun run typecheck` → PASS
`git add src/hooks/plan-bridge.ts src/core/justice-plugin.ts src/core/implement-command.ts tests/hooks/plan-bridge-authorization.test.ts`
`git commit -m "feat: one-shot arm を plan-scoped authorization binding へ置換"`

---

## Phase 3a (PR-C): Task Lifecycle / Review Artifact / Acceptance コア — JUS-P0-04 (pure core)

### Task 3.1: Task Lifecycle state machine

**Files:**
- Create: `src/core/task-lifecycle.ts`
- Test: `tests/core/task-lifecycle.test.ts`

**Interfaces:**
- Consumes: 型のみ (spec §4.4 の `TaskProgressState` / `PlanFinalizationState`)
- Produces: `TaskAttemptId`, `FinalizationAttemptId`, `TaskLifecycleTransitionRecord`, `PlanFinalizationTransitionRecord`, `applyTaskTransition(state, event)` / `applyPlanTransition(...)`, `createTaskAttemptRef(...)`。永続化に依存しない純粋 state machine。

- [ ] **Step 1: 失敗テスト**

```ts
import { describe, it, expect } from "vitest";
import {
  applyTaskTransition,
  newTaskExecutionRef,
  newFinalizationRef,
  VALID_TASK_TRANSITIONS,
  VALID_PLAN_FINALIZATION_TRANSITIONS,
} from "../../src/core/task-lifecycle";

describe("TaskLifecycle", () => {
  it("worker_reported is NOT accepted", () => {
    const ref = newTaskExecutionRef("auth-1", "task-1");
    const state = applyTaskTransition("pending", { kind: "task_started", ref });
    expect(state).toBe("in_progress");
    const s2 = applyTaskTransition(state, { kind: "worker_reported", ref });
    expect(s2).toBe("worker_reported");
    expect(s2).not.toBe("accepted");
  });

  it("rejects accepted -> pending", () => {
    const ref = newTaskExecutionRef("auth-1", "task-1");
    expect(() =>
      applyTaskTransition("accepted", { kind: "task_started", ref }),
    ).toThrow(/Invalid transition/);
  });

  it("final_rework_required increments finalizationAttemptId and finalReviewRound", () => {
    const ref = newFinalizationRef({ authorizationId: "a1", planPath: "docs/p.md" });
    const { finalizationAttemptId: f1, finalReviewRound: r1 } = ref;
    const next = ref.nextRound();
    expect(next.finalizationAttemptId).not.toBe(f1);
    expect(next.finalReviewRound).toBe(r1 + 1);
  });
});
```

- [ ] **Step 2: FAIL 確認**

- [ ] **Step 3: 実装**

`src/core/task-lifecycle.ts`:

```ts
import { randomUUID } from "node:crypto";

export type TaskProgressState =
  | "pending" | "authorized" | "in_progress" | "worker_reported"
  | "evidence_pending" | "review_pending" | "gate_pending"
  | "rework_required" | "accepted";

export type PlanFinalizationState =
  | "tasks_pending" | "all_tasks_accepted" | "final_review_pending"
  | "final_gate_pending" | "final_rework_required" | "complete";

export type TaskAttemptId = string;
export type FinalizationAttemptId = string;

export type TaskExecutionRef = {
  readonly authorizationId: string;
  readonly taskId: string;
  readonly attemptId: TaskAttemptId;
};

export const VALID_TASK_TRANSITIONS: ReadonlyMap<TaskProgressState, ReadonlySet<TaskProgressState>> =
  new Map([
    ["pending", new Set(["authorized", "in_progress"])],
    ["authorized", new Set(["in_progress"])],
    ["in_progress", new Set(["worker_reported"])],
    ["worker_reported", new Set(["evidence_pending"])],
    ["evidence_pending", new Set(["review_pending"])],
    ["review_pending", new Set(["gate_pending"])],
    ["gate_pending", new Set(["accepted", "rework_required"])],
    ["rework_required", new Set(["in_progress"])],
    ["accepted", new Set<TaskProgressState>()],
  ]);

export function newTaskExecutionRef(authorizationId: string, taskId: string): TaskExecutionRef {
  return { authorizationId, taskId, attemptId: newAttemptId() };
}

export function newAttemptId(): string {
  return randomUUID();
}

// events と plan finalization state machine 同様にイベント駆動で実装
```

`applyTaskTransition(state, event)` は event から `next` 状態を算定し、無効なら throw。

- [ ] **Step 4: PASS / Commit (確認後)**

`git add src/core/task-lifecycle.ts tests/core/task-lifecycle.test.ts`
`git commit -m "feat: TaskProgress/PlanFinalization 純粋 state machine"`

### Task 3.2: Review Artifact コア

**Files:**
- Create: `src/core/review-artifact.ts`
- Test: `tests/core/review-artifact.test.ts`

**Interfaces:**
- Consumes: spec §4.5 の型のまま (`ReviewArtifactV1` / `CleanReviewArtifactV1` 等), `PlanFingerprint`
- Produces: `parseReviewWorkerResult(raw: unknown): ReviewWorkerResultV1 | null`, `assembleReviewArtifactV1(input): ReviewArtifactV1`, `isCleanReviewArtifact(a: ReviewArtifactV1): a is CleanReviewArtifactV1`

- [ ] **Step 1: 失敗テスト**

```ts
it("assembles ReviewArtifactV1 from trusted metadata + worker result", () => {
  const artifact = assembleReviewArtifactV1({
    correlation: taskCorrelation, observedExecution: obsExec,
    workerResult: { schemaVersion: 1, complete: true, findings: [] },
    source: { reviewSource: "sp-review", reviewKind: "task-review" },
  });
  expect(isCleanReviewArtifact(artifact)).toBe(true);
});

it("rejects worker output that lies about findings", () => {
  const artifact = assembleReviewArtifactV1({
    correlation: taskCorrelation, observedExecution: obsExec,
    workerResult: { schemaVersion: 1, complete: true, findings: [someFinding] },
    source: { reviewSource: "sp-review", reviewKind: "task-review" },
  });
  expect(isCleanReviewArtifact(artifact)).toBe(false);
});
```

- [ ] **Step 2: FAIL 確認 / 実装 / PASS / Commit (確認後)**

重要: `ReviewWorkerResultV1` は **untrusted**。`artifact` 組立時に `correlation` / `reviewSource` / `reviewKind` / `observedExecution` は worker 自己申告を受け付けず TaskCallBinding 由来 trusted metadata のみを使う (spec §4.5 Trust boundary)。

Commit: `git commit -m "feat: ReviewArtifactV1 組立と clean 判定コア"`

### Task 3.3: Acceptance Decision コア

**Files:**
- Create: `src/core/acceptance-decision.ts`
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:**
- Consumes: `TaskExecutionRef`, `ProjectedEvidence` (既存 evidence システム), `ReviewArtifactV1`, gate verdict
- Produces: `TaskAcceptanceDecision`, `PlanAcceptanceDecision`, `decideTaskAcceptance(input)`, `decidePlanComplete(input)`

- [ ] **Step 1: 失敗テスト**

```ts
it("Gate PASS + clean review + observed evidence => accepted", () => {
  const d = decideTaskAcceptance({
    ref, gateVerdict: { kind: "task", verdict: "PASS" },
    evidence: [observedTestPass], review: cleanReviewArtifact,
  });
  expect(d.verdict).toBe("accepted");
});

it("declared evidence only => blocked", () => {
  const d = decideTaskAcceptance({
    ref, gateVerdict: { kind: "task", verdict: "PASS" },
    evidence: [declaredTestsPassed], // provenance declared
    review: cleanReviewArtifact,
  });
  expect(d.verdict).toBe("blocked");
});

it("gate WARN => rework-required", () => {
  expect(decideTaskAcceptance({ ref, gateVerdict: warn, evidence: [obs], review: clean }).verdict).toBe("rework-required");
});

it("internal error / evidence missing => blocked (gate_pending stay)", () => {
  expect(decideTaskAcceptance({ ref, gateVerdict: { kind: "error" }, evidence: [], review: clean }).verdict).toBe("blocked");
});
```

- [ ] **Step 2: FAIL → 実装 → PASS (Spec §4.11 と §2.3 の「実行 fail-open / 承認 fail-closed」を合わせてコードで強制)**

- [ ] **Step 3: Commit (確認後)**

`git commit -m "feat: AcceptanceDecision (Task/Plan) 判定コア"`

---

## Phase 3b (PR-D): Review Dispatch Protocol — JUS-P0-04 (durable / atomic claim)

### Task 3.4: Review Dispatch State machine

**Files:**
- Create: `src/core/review-dispatch-state.ts`
- Test: `tests/core/review-dispatch-state.test.ts`

**Interfaces:**
- Consumes: spec §4.8.1 の `ReviewDispatchState` / `ReviewDispatchSlot` / `ReviewDispatchTransitionRecord` / `ReviewCompletionStaging` 型のまま / `ReviewArtifactV1` (Task 3.2)
- Produces: `newPendingSlot(...)`, `tryClaim(slot, incoming): ClaimResult`, `terminalize(slot, outcome)`, `isTerminal(slot)`, `ReviewDispatchRecovery` (durable record から slot/binding/artifact reservation を再構築する projector 関数)

- [ ] **Step 1: 失敗テスト (CAS / 再発行禁止 / 並列排他)**

```ts
it("claim succeeds only when exactly one matching pending slot exists", () => {
  const s = newPendingSlot({ parentSessionId: "ps", correlation: cor, expectedCategory: "sp-review" });
  const res = tryClaim([s], { callId: "c1", category: "sp-review", parentSessionId: "ps" });
  expect(res.status).toBe("claimed");
  expect(res.claim!.binding.callId).toBe("c1");
});

it("claim fails (no binding created) when multiple or zero pending slots", () => {
  const s1 = newPendingSlot({ ... });
  const s2 = newPendingSlot({ ... }); // same parentSessionId, two slots
  expect(tryClaim([s1, s2], { ... }).status).toBe("no_binding");
  expect(tryClaim([], { ... }).status).toBe("no_binding");
});

it("claimed slot can be recovered from durable record without reissuing directive", () => {
  const record = transitionRecord(nullToPending({ ... }));
  const slots = projectReviewDispatchSlots([record]);
  expect(slots[0].state).toBe("pending");
  expect(slots[0].canReissueDirective).toBe(true);
  // claimed 状態の record を追加すると再 directive 発行は false
});

it("terminal slot is never reused / deleted", () => {
  const terminal = terminalize(slot, "completed");
  expect(() => tryClaim([terminal], { callId: "c2", ... })).toThrow;
});
```

- [ ] **Step 2: FAIL 確認 / 実装 / PASS / Commit (確認後)**

`git commit -m "feat: Review dispatch slot の CAS + durable recovery"`

### Task 3.5: Review Artifact Reservation (anti-replay)

**Files:**
- Create: `src/core/review-artifact-reservation.ts`
- Test: `tests/core/review-artifact-reservation.test.ts`

**Interfaces:**
- Consumes: `FileReader`/`FileWriter`、`normalizeSafeRelativePath`、UUID 生成
- Produces: `ReviewArtifactReservation` (usable/unusable), `createReservation(input, fs): Promise<ReviewArtifactReservation>`。discriminated union で `unusable` の場合 `reason` に spec §4.10 の failure reason を保持。

- [ ] **Step 1: 失敗テスト**

```ts
it("reserves a unique artifactPath", async () => {
  const fs = mockFs({ existing: [".justice/reviews/abc.json"] });
  const r = await createReservation({ fs, artifactDir: ".justice/reviews" });
  expect(r.status).toBe("usable");
  if (r.status === "usable") expect(r.artifactPath).not.toBe(".justice/reviews/abc.json");
});

it("returns unusable when max collision retries exceeded", async () => {
  const fs = mockFs({ existing: "__MAX_COLLISION_MODE__" });
  const r = await createReservation({ fs, artifactDir: ".justice/reviews", maxRetries: 3 });
  expect(r.status).toBe("unusable");
  if (r.status === "unusable") expect(r.reason).toBe("artifact_path_collision_exhausted");
});
```

- [ ] **Step 2: FAIL 確認 / 実装 / PASS && Commit (確認後)**

`git commit -m "feat: Review artifact reservation (anti-replay, digest, unusable handling)"`

### Task 3.6: state-projection 拡張

**Files:**
- Modify: `src/core/v2/state-projection.ts` (review dispatch slot / review_observed / 持続化 evidence の再構成を追加)
- Modify: `src/core/v2/state-projection.test.ts` (新規または追加)
- Modify: `src/core/v2/observation-model.ts` (spec §4 の typed lifecycle record union 追加)

**Interfaces:**
- Produces: `projectReviewDispatchSlots(records)` / `projectTaskLifecycle(records)` / `projectPlanFinalization(records)` を `project()` の組み込み対象に追加

- [ ] **Step 1: 失敗テスト**

`.justice/events` に durable `review_dispatch_transition` record を並べた投影で slot を再構築する回帰テスト。restart 直後に同一 event list を 2 回投影して deterministic になることも独立ケース。

- [ ] **Step 2: 失敗確認 / 実装 / PASS / Commit (確認後)**

`git commit -m "feat(v2): projection に lifecycle/dispatch slot reviver を追加"`

---

## Phase 3c (PR-E): Hook / Adapter 接続 — JUS-P0-04 完成

### Task 3.7: TaskCallBinding (PreToolUse order)

**Files:**
- Modify: `src/core/session-state-provider.ts`
- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/core/session-state-provider.test.ts`

**Interfaces:**
- Produces: SessionStateProvider に `setTaskCallBinding(callId, TaskCallBinding)` / `getTaskCallBinding(callId)` を追加。`callId` は必ず TaskExecutionRef または ReviewCorrelation のいずれかに紐付く (spec §4.7)。`TaskCallPurpose` を observation log へ付画。
- `PreToolUse` では callId への binding は **`pending` slot の原子 claim と同一 commit** で確立するため、SessionStateProvider は in-memory cache のみを扱い authoritative にしない (spec §4.8.1)。

- [ ] **Step 1: 失敗テスト**

```ts
it("binding distinguishes implementation vs task_review vs final_review", () => {
  const p = new SessionStateProvider();
  p.setTaskCallBinding("c1", { callId: "c1", purpose: "implementation", taskExecutionRef: ref });
  p.setTaskCallBinding("c2", { callId: "c2", purpose: "task_review", correlation, artifactReservation });
  expect(p.getTaskCallBinding("c1")!.purpose).toBe("implementation");
  expect(p.getTaskCallBinding("c2")!.purpose).toBe("task_review");
});
```

- [ ] **Step 2: 失敗確認 / 実装 / PASS**

### Task 3.8: Observation Handler / task() purpose 分岐

**Files:**
- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/hooks/observation-handler-*.test.ts` の既存系 + 新規 `tests/hooks/observation-handler-transactional.test.ts`

**Interfaces:**
- Consumes: TaskCallBinding (Task 3.7), ObservationLogStore 既存 append API
- Produces: `handlePostToolUse` の task 呼出で以下を transactional order:
  1. `classify TaskCallPurpose`
  2. `implementation` → `WorkerReported` event を emit
  3. `task_review` / `final_review` → `ReviewWorkerResultV1` を収集し `ReviewArtifactV1` 組立 → `review_observed` イベント + atomic 永続化
  4. gate 評価は lifecycle state = `gate_pending` / `final_gate_pending` でのみ
  5. `AcceptanceDecision` 発行後のみ ProgressUpdater (別タスクで checkbox 更新)

- [ ] **Step 1: 失敗テスト (invocation 順序 & 相互 splice 禁止)**

```ts
it("runs side-effecting handlers sequentially, not via Promise.all", async () => {
  const calls: string[] = [];
  const handlerA = () => calls.push("A");
  const handlerB = () => calls.push("B");
  const handlerC = () => calls.push("C");
  await plugin.runPostToolUseForTask(
    fakeEvent,
    { classify: () => ({ purpose: "implementation" }), reportWorker: handlerA, projectLifecycle: handlerB, accept: handlerC },
  );
  expect(calls).toEqual(["A", "B", "C"]);
});
```

これは static test として `src/core/justice-plugin.ts` の Promise.all 同時実行構造をテスト可能な形にする (コード生成 test で `await Promise.all` 行数を 0 にする等も検討可).

- [ ] **Step 2: 既存の Promise.all 駆除と transactional dispatcher 実装**

```ts
// src/core/justice-plugin.ts PostToolUse case:
case "PostToolUse": {
  if (event.payload.toolName === "task") {
    return this.runTaskPostToolUseSequentially(event); // see below
  }
  // ... 既存非 task 維持
}

private async runTaskPostToolUseSequentially(event: HookEvent): Promise<HookResponse> {
  // 1) classify purpose (read-only)
  // 2) observation.emit WorkerReported (fail-open): evidence log
  // 3) project lifecycle (fail-open): in-memory snapshot + durable transition record
  // 4) if review_pending reached -> inject ReviewRequiredDirective (artifactReservation generated if needed)
  // 5) acceptance decision (durable) -> only on accepted, progress update (progress credit to Task 3.9)
  //    error path: blocked (no progress update)
}
```

INV-13 を コンパイル時のテストで保証するために `codeContains` introspection test を追加する (実際の `Promise.all` パターンが再導入されると fail する)。

- [ ] **Step 3: 全テスト / Commit (確認後)**

`git commit -m "feat: task() PostToolUse を classified → worker-reported → gate → acceptance の transactional order に"`

### Task 3.9: ProgressUpdater 分離

**Files:**
- Modify: `src/hooks/task-feedback.ts` (直接 updateCheckbox を撤去)
- Create: `src/core/progress-updater.ts` または既存適切な場所
- Test: `tests/hooks/task-feedback.test.ts` / `tests/core/progress-updater.test.ts`

**Interfaces:**
- Produces: `updatePlanProgress(planContent, ref, decision): { content: string; updated: boolean }`。`worker report から checkbox 更新しない`。`decision.verdict === "accepted"` のみ updateCheckbox 呼び出し。

- [ ] **Step 1: 失敗テスト**

```ts
it("worker success without acceptance does not update plan.md", () => {
  const before = plan;
  const after = updatePlanProgress(before, ref, { verdict: "rework-required", ... });
  expect(after.updated).toBe(false);
  expect(after.content).toBe(before);
});

it("accepted verdict updates checkbox via PlanParser", () => {
  const after = updatePlanProgress(plan, ref, acceptedDecision);
  expect(after.updated).toBe(true);
  expect(after.content).toContain("- [x]");
});
```

- [ ] **Step 2: `task-feedback.ts` の handleSuccess / handleFailure path から直接 writeFile を外し、`ProgressUpdater` への橋渡しに変更**

- [ ] **Step 3: 全テスト / Commit (確認後)**

`git commit -m "feat: ProgressUpdater を WorkerReported 経路から分離 (INV-06, INV-08)"`

### Task 3.10: ReviewRequiredDirective 経路

**Files:**
- Modify: `src/runtime/opencode-adapter.ts`
- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/justice-plugin.ts`
- Test: `tests/runtime/opencode-adapter*.test.ts` または既存 integration suite に追記

**Interfaces:**
- Produces: Justice が `ReviewPending` / `FinalReviewPending` に到達した時点で controller へ `ReviewRequiredDirective { kind: "review_required", correlation }` を injected context として emit。existing PreToolUse/PostToolUse で category="sp-review"/"sp-final-review" の場合に pending slot claim + artifact reservation + binding を作る入力として、この directive を参照。

- [ ] **失敗テスト: directive inject による相関付け (callId → TaskCallBinding が pending slot と一致)**

- [ ] **実装**: adapter に directive inject 用の output 経路を 新設 (若しくは既存 `inject` の variant を拡張)。省庁-durable commit 順序: (1) pending-transition durable commit (2) directive inject (3) atomic claim (4) terminalization。

- [ ] **ケース: atomic claim 失敗 (0/2 件 / category 不一致) → fail-open + advisory + Acceptance blocked** を regression テストに含める

- [ ] **全テスト / Commit (確認後)**

`git commit -m "feat(adapter): ReviewRequiredDirective と dispatch binding の結線"`

---

## Phase 4 (PR-F): Controller Routing — JUS-P0-01

### Task 4.1: Controller Routing コア

**Files:**
- Create: `src/core/controller-routing.ts`
- Test: `tests/core/controller-routing.test.ts`

**Interfaces:**
- Consumes: `ControllerAgent` (既存 types.ts), `WorkflowRouter.resolveController(workflow)` (既存)
- Produces: `evaluateControllerRoutingObservation(input)` 純粋関数で spec §4.1 の判定を実施

- [ ] **Step 1: 失敗テスト (spec の主要分岐を取り上げ)**

```ts
const params = (patch: Partial<Input>) => ({ ...defaultProbeInput, ...patch });

it("message.updated で actual === desired なら applied", () => {
  const r = evaluateControllerRoutingObservation(params({
    desired: "sisyphus", application: "pinned-command", actualObservedBy: "message.updated", actual: "sisyphus",
  }));
  expect(r.routingStatus).toBe("applied");
});

it("message.updated で actual !== desired => mismatch", () => {
  const r = evaluateControllerRoutingObservation(params({
    desired: "atlas", application: "pinned-command", actualObservedBy: "message.updated", actual: "sisyphus",
  }));
  expect(r.routingStatus).toBe("mismatch");
});

it("chat.params 一致だけでは applied にしない", () => {
  const r = evaluateControllerRoutingObservation(params({
    desired: "sisyphus", application: "pinned-command", actualObservedBy: "chat.params", actual: "sisyphus",
  }));
  expect(r.routingStatus).toBe("unapplied");
  if (r.routingStatus === "unapplied") expect(r.reason).toBe("actual_not_observed");
});

it("no application configured => unapplied(application_not_configured)", () => {
  const r = evaluateControllerRoutingObservation(params({
    desired: "atlas", application: "none", actualObservedBy: "none",
  }));
  expect(r.routingStatus).toBe("unapplied");
  if (r.routingStatus === "unapplied") expect(r.reason).toBe("application_not_configured");
});
```

- [ ] **Step 2: FAIL / 実装 (discriminated union 準拠) / PASS / Commit (確認後)**

`git commit -m "feat: ControllerRoutingObservation 評価 core (spec §4.1)"`

### Task 4.2: chat.params / message.updated を observation に接続

**Files:**
- Modify: `src/runtime/opencode-adapter.ts` の `chat.params` / `message.updated` 経路
- Modify: `src/hooks/observation-handler.ts`
- Test: integration で既存 events + ControllerRoutingObservation を書き込むテストを追加

**Interfaces:**
- PreToolUse/PostToolUse に加え、`chat.params` / `message.updated` の `agent` 値を actual として durable log に persist。spec §3.3。

- [ ] **Step 1: 既存 HandleMessage の agentName → sessionStateProvider 流を参考に実装方重fix。既存の SessionStateProvider.setAgentMapping() と併せて controller routing 用の Sideband observation 追加。**

- [ ] **Step 2: fail-open 確認 + durable 永続化と mismatch advisory追加**

advisory は `[JUSTICE] Controller routing mismatch: desired=atlas actual=sisyphus (application=pinned-command)` 相当。

- [ ] **Step 3: 全テスト / Commit (確認後)**

`git commit -m "feat: chat.params/message.updated を controller routing observation に接続"`

### Task 4.3: doctor pinned-command 雛形 + README/SPEC 更新

**Files:**
- Modify: `src/core/doctor-*` (pinned-command 不足検査)
- Modify: `README.md` (`/justice-implement`, `/justice-start`, 推奨 pinned-command example)
- Modify: `SPEC.md` (v4.0.0 ADR / 破壊的変更記録)
- Modify: `docs/agents/upstream-drift.md` (必要に応じて)

- [ ] **Step 1: doctor の check 追加**

`checkPinnedCommandsPresence(config)` を実装。workflow → controller 期待される pin を doctor が提示 (例: `brainstorming` => `sisyphus`)。missing なら doctor exit non-zero。

- [ ] **Step 2: README/SPEC の変更**

- SPEC.md 15.x / 15.12 に v4 の Semantic Control Plane 追記 (ADR)
- README の `/justice-implement` セクションを binding に合わせ書き換え、制定 plan mutation invalidates を明記
- 破壊的変更: one-shot arm, deep/architecture legacy route, worker supported direct plan update 等を CHANGELOG 様に記録

- [ ] **Step 3: プレフライト / 品質ゲート (§6.3)**

`bun run test && bun run typecheck && bun run lint && bun run build`

- [ ] **Commit (確認後)**

`git add src/core/doctor-*.ts README.md SPEC.md docs/agents/upstream-drift.md`
`git commit -m "docs: v4.0.0 semantic control plane の導入を文書化 + doctor pinned-command 檢査"`

---

## 実行時の注記

- **サブエージェント不使用: 本プラン実行中は subagent (task() ) を dispatch しない。**
- **Stacked PR**: PR-A 起点にブランチを積み上げ、前の PR を base にして、GitHub 上で順次 review→merge。差分変更量は `PR-A` が最も小さく、Phase 3(=3a/3b/3c) が大きいため能動的に分割した3 PR に分かれている。の手順:
  1. `git checkout -b feature/v4-category-routing master` → PR-A 作成
  2. マージ後 `feature/v4-plan-authorization` を base=PR-A で rebase → PR-B 作成
  3. 同様に 3a → 3b → 3c → 4 の順に stack を伸ばす
- **エージェントによる `git commit` / `git rebase` / `gh` 実行はユーザー確認前提。** 実行前に確認。

## DoD (§10 準拠)

- 全 Phase の `bun run test/typecheck/lint/build` が pass
- INV-01〜INV-18 のうち automated test に載せられたものは all green
- 未検証 (例: OpenCode runtime boundary) は SPEC §15.12 に既知限界として記録
