# Justice v2.0 Foundation 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Git workflow:** 本計画は Graphite Stacked PR Workflow に厳密に準拠します。1 タスク 200 LOC 制限、ブランチ命名 `feature/phaseN-v2-...__base` / `feature/phaseN-taskM-...`、各 Task 完了時は `gt submit` で Phase Base 向け Draft PR を作成・更新します。
> **Devcontainer 強制:** すべてのテスト・型検査・静的解析は **Devcontainer 内**で実行すること。ローカルホストでの実行は認めない。

**Goal:** Justice v2.0 Foundation 設計書（`docs/superpowers/specs/2026-06-16-justice-v2-foundation-design.md`）を実装し、既存 563 テストを壊さずに Quality Control Plane の基盤層を追加する。

**Architecture:** 加算シャドウ（dual）アプローチ。新 Observation Log + projection spine を既存 plan-bridge/task-feedback/wisdom と並走追加。Core は純粋関数・I/O 非依存。Hook は観測を捕捉し Core へ委譲。Runtime は per-writer segment JSONL への atomic append + readAll merge を担う。v2.0 は L0 advisory のみ（非ブロッキング）。

**Tech Stack:** TypeScript, Bun, Vitest, `@opencode-ai/plugin`, ESLint, Prettier, Devcontainer（`oven/bun:1`）, GitHub Actions (`ubuntu-slim`).

---

## Global Constraints

- 既存 563 テストは不変（回帰なし）。
- Core（`src/core/`）は `@opencode-ai/*` を import しない（FF-001）。
- すべての file I/O は `FileReader` / `FileWriter` 経由。テストでは mock を注入（`tests/helpers/mock-file-system.ts`）。`FileReader` は `readFile` / `fileExists` / `listFiles(prefix)` を提供する。（例外として、テストコードにおけるリポジトリの静的ファイル（ADR等）の存在確認やアーキテクチャ検証目的の読取に限り、Node.js の `fs` モジュールの直接使用を許可します）。
- 状態は immutable（`readonly` / `ReadonlyArray` / `ReadonlyMap`）。
- すべての fail-open 境界は `try/catch` で保護し、`PROCEED` に縮退する。
- 永続化前に SecretPatternDetector で redaction + 絶対パス redaction + truncation を実施（D25/D61）。
- `declared` provenance は gate 充足（PASS）に算入しない。PASS に算入するのは `observed` / `derived`（`derived` は observed 起源限定）のみ（FF-008）。
- `devcontainer` 内でのみ `bun run lint` / `typecheck` / `test` / `build` を実行する。
- ブランチ運用は [Graphite Stacked PR Workflow](https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnS4oioAtOOsRFxbhj7DasZszJsUzA6R74JH66RtuaZljfMTOMp01vNhWjcaM0hMPMpWGtEG2CqCiJRKUnxfpUq5IKUvCuw8ckJxEzV_S-lANVqatSiXDyPIwACDWLiYMx_FxpOVwVe-lN3OEfYJMKFB1HyzYW__8mfULCRcQthYXlSoLzc6GHSwYYLtJOMVUh3x34AuPc1rdosiFf2YYStsXJoCj9-iTs7BjmJ0E_-omFWTGPH0uOK-AXq_XLLxAltwuQt-Ct5q_9u-w_QBPhX7UxyHYfZJSstDIFryh_4uUFWBdWMCh0TSrYJxTw&lib=M0tqVErYg9kMB9ia8bpbmo4TD2knUOGjU) を使用。1 タスク 200 LOC 制限、命名 `feature/phaseN-taskM-...`、Base ブランチ `feature/phaseN-...__base`。各 Task 最後は **Phase Base に向けた Draft PR 作成**。

> **Graphite 運用詳細:**
>
> - Base ブランチは、最初の Phase 0 は `master` から `gt checkout master && gt trunk && gt branch create feature/phase0-v2-baseline__base` で作成しますが、後続の Phase N+1 の Base ブランチは、前 Phase N の最終 Task ブランチ（前 Phase の全実装を含む状態）を起点として分岐させて作成します。これにより、次 Phase が前 Phase の実装成果を確実に含むようにします。
> - 各 Task ブランチは Phase Base から `gt checkout feature/phaseN-v2-...__base && gt branch create feature/phaseN-taskM-...` で分岐（Phase 内で連続する Task は直前 Task から分岐）。
> - タスク完了時は `gt add . && gt commit` 後、`gt submit` で Phase Base 向け Draft PR を一括作成・更新する。
> - 下位 Task を修正した場合は `gt restack` で上位スタックを再整列する。
> - 本計画内の「Phase Base に向けた Draft PR を作成する」は `gt submit` による Draft PR 作成を指す。

---

> **Split plan:** This file is part 06 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Gate schema, rule evaluation, default gates, gate loading, and DecisionRecord append.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

## Phase 5: Rule Engine + Gate Definition

**Base Branch:** `feature/phase5-v2-rule-engine__base`

**目的:** 純粋な rule evaluation engine、gate.yaml スキーマ、gate-loader、既定 gate を実装。本 Phase だけで gate 評価の単体テストが成立する。

**判断:** Phase 5 は Phase 1/2 の型と投影を使用。Task 5.1 は gate スキーマ（独立）で Base から、Task 5.2 は 5.1 の型を使用、Task 5.3 は 5.2 の engine + 5.1 の型、Task 5.4 は 5.3 + 5.2 の評価経路。Phase 5 内は順次積み上げ。

---

### Task 5.1: Gate Definition Schema + Validation

**Files:**

- Create: `src/core/v2/gate-definition.ts`
- Create: `src/core/v2/gate-yaml-parser.ts`
- Test: `tests/core/v2/gate-definition.test.ts`
- Test: `tests/core/v2/gate-yaml-parser.test.ts`

**Interfaces:**

- Consumes: `zod`（Task 5.1 にてプロジェクトへ追加し、スキーマ定義とバリデーションを一貫して zod で実装する）。
- Produces:
  - `GateRule` type with `id`, `gateType`, `trigger`, `check`, `onViolation`, `onMissingEvidence`, `enabled`.
  - `check.type ∈ { "evidence_outcome", "evidence_present", "review_open_items" }`.
  - `parseGateYaml(yaml: string): GateRule[]`.

- [ ] **Step 0: 依存パッケージ `yaml` および `zod` を追加**

```bash
bun add yaml zod
```

- [ ] **Step 1: `GateRule` 型と zod スキーマを定義**

```typescript
// src/core/v2/gate-definition.ts
import { z } from "zod";

export const GateCheckSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evidence_outcome"),
    evidenceKind: z.enum(["test", "build", "lint"]),
    requireOutcome: z.enum(["pass", "fail"]),
  }),
  z.object({
    type: z.literal("evidence_present"),
    evidenceKind: z.enum(["test", "build", "lint"]),
  }),
  z.object({
    type: z.literal("review_open_items"),
    minimumSeverity: z.enum(["critical", "major", "minor"]).default("major"),
  }),
]);

export const GateRuleSchema = z.object({
  id: z.string().trim().min(1),
  description: z.string().optional(),
  gateType: z.literal("task"),
  trigger: z.object({
    on: z.enum(["task_complete", "tool_observed"]),
  }),
  check: GateCheckSchema,
  onViolation: z.enum(["pass", "warn", "fail"]),
  onMissingEvidence: z.enum(["pass", "warn", "fail"]),
  enabled: z.boolean().default(true),
});

export type GateCheck = z.infer<typeof GateCheckSchema>;
export type GateRule = z.infer<typeof GateRuleSchema>;
```

- [ ] **Step 2: YAML parser / validator を実装**

```typescript
// src/core/v2/gate-yaml-parser.ts
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { GateRuleSchema, type GateRule } from "./gate-definition.ts";

const GateConfigSchema = z.object({
  schemaVersion: z.literal(1),
  authority: z.literal("human_approved"),
  authorship: z.null().optional(),
  gates: z.array(GateRuleSchema),
});

export function parseGateYaml(content: string): readonly GateRule[] {
  const parsed = parseYaml(content);
  const validated = GateConfigSchema.parse(parsed);
  return validated.gates;
}
```
// (注: 設計通り Zod スキーマ `GateConfigSchema.parse(parsed)` によって一貫してバリデーションと型キャストを行うため、上記のような手動の normalize / validate 関数群は実装不要です。Zod に検証と型解決を委ねるように実装してください。)

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/gate-definition.test.ts tests/core/v2/gate-yaml-parser.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock src/core/v2/gate-definition.ts src/core/v2/gate-yaml-parser.ts tests/core/v2/gate-definition.test.ts tests/core/v2/gate-yaml-parser.test.ts
git commit -m "feat(v2): gate definition schema and yaml parser"
```

- [ ] **Step 5: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase5-v2-rule-engine__base`（Base から派生）。

---

### Task 5.2: Rule Evaluation Engine

**Files:**

- Create: `src/core/v2/rule-evaluation-engine.ts`
- Create: `src/core/v2/gate-context.ts`
- Create: `src/core/v2/review-scope.ts`
- Test: `tests/core/v2/rule-evaluation-engine.test.ts`
- Test: `tests/core/v2/gate-provenance-gating.test.ts`

**Interfaces:**

- Consumes: `GateRule`, `Evidence`, `ProjectedState`, `GateContext`.
- Produces:
  - `evaluate(gates, evidence, ctx): Verdict` (pure, deterministic).
  - `Verdict` with per-rule results and worst-value aggregation (FAIL > WARN > PASS).
  - `collectReviewScopes(state, taskId): readonly string[]` and `deriveReviewScope(ctx): string`.

- [ ] **Step 1: `GateContext` 型を定義**

```typescript
// src/core/v2/gate-context.ts
export type GateContext = {
  readonly trigger: "task_complete" | "tool_observed";
  readonly taskId?: string;
  readonly agentId: ObservationAgentId;
  readonly sessionId: string;
  readonly reviewScope: readonly string[];
  readonly reviewSummary?: {
    readonly byScope: Readonly<Record<string, {
      readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef }[];
      readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    }>>;
  };
};
```

- [ ] **Step 1b: `review-scope.ts` を作成し `collectReviewScopes` / `deriveReviewScope` を実装（§7.6）**

```typescript
// src/core/v2/review-scope.ts
import { ProjectedState } from "./state-projection.ts";

export function collectReviewScopes(state: ProjectedState, taskId: string): readonly string[] {
  // Collect actual reviewScopes from task window in ProjectedState to avoid PASS when unobserved
  const scopes: string[] = [];
  const taskState = state.tasks.get(taskId);
  if (taskState) {
    for (const scope of taskState.observedReviewScopes) {
      scopes.push(scope);
    }
  }
  return scopes;
}

export function deriveReviewScope(ctx: { readonly taskId?: string; readonly sessionId: string; readonly callId?: string; readonly toolName?: string }): string {
  if (ctx.taskId) return ctx.taskId;
  return `${ctx.sessionId}:${ctx.callId ?? ctx.toolName ?? "unknown"}`;
}
```

- [ ] **Step 2: rule engine を実装（§7.3/D24/D68/D75/D76）**

```typescript
// src/core/v2/rule-evaluation-engine.ts
export function evaluate(
  gates: readonly GateRule[],
  evidence: readonly ProjectedEvidence[],
  ctx: GateContext
): (Verdict & { readonly gateType: "task" }) | { readonly verdict: "SKIP"; readonly reason: string } {
  if (ctx.taskId === undefined) {
    return { verdict: "SKIP", reason: "no taskId provided" };
  }
  const activeGates = gates.filter((g) => g.enabled && g.trigger.on === ctx.trigger);
  if (activeGates.length === 0) {
    // 指摘2: 一致する有効なゲートが0件の場合はSKIPとし、DecisionRecordを永続化しない
    return { verdict: "SKIP", reason: `no matching active gates found for trigger: ${ctx.trigger}` };
  }
  const ruleResults = activeGates.map((g) => evaluateRule(g, evidence, ctx));
  const verdict = worstOf(ruleResults.map((r) => r.verdict));
  return { verdict, gateType: "task", reachableEnforcementLevel: "L1", appliedEnforcementLevel: "L0", ruleResults };
}

function evaluateRule(gate: GateRule, evidence: readonly ProjectedEvidence[], ctx: GateContext): RuleResult {
  const mapVerdict = (v: "pass" | "warn" | "fail"): "PASS" | "WARN" | "FAIL" => {
    return v.toUpperCase() as "PASS" | "WARN" | "FAIL";
  };

  const worstResult = (v1: "PASS" | "WARN" | "FAIL", v2: "PASS" | "WARN" | "FAIL") => {
    if (v1 === "FAIL" || v2 === "FAIL") return "FAIL";
    if (v1 === "WARN" || v2 === "WARN") return "WARN";
    return "PASS";
  };

  const check = gate.check;

  if (check.type === "evidence_present") {
    // observed / derived 起源の証跡のみ PASS 対象とする。declared 単体は onMissingEvidence or WARN (FF-008/FF-007)
    const matching = evidence.filter(e => e.evidence.kind === check.evidenceKind && (e.evidence.provenance === "observed" || e.evidence.provenance === "derived"));
    if (matching.length > 0) {
      return { ruleId: gate.id, verdict: "PASS", reason: `Authoritative evidence of kind '${check.evidenceKind}' is present.`, evidenceRefs: matching.map(e => e.ref) };
    }
    return {
      ruleId: gate.id,
      verdict: mapVerdict(gate.onMissingEvidence),
      reason: `Required evidence of kind '${check.evidenceKind}' is missing or has declared provenance only.`,
      evidenceRefs: []
    };
  }

  if (check.type === "evidence_outcome") {
    const matching = evidence.filter(e => e.evidence.kind === check.evidenceKind);
    if (matching.length === 0) {
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `Evidence of kind '${check.evidenceKind}' is missing.`,
        evidenceRefs: []
      };
    }
    
    // observed / derived 起源のみ PASS 可能 (FF-008/FF-007)
    // declared-only は onMissingEvidence、outcome 違反 (fail) は onViolation
    let hasAuthoritativePass = false;
    let ruleVerdict: "PASS" | "WARN" | "FAIL" = "PASS";
    const invalidRefs: EvidenceRef[] = [];
    const matchedRefs: EvidenceRef[] = [];
    for (const ev of matching) {
      matchedRefs.push(ev.ref);
      const isAuthoritative = ev.evidence.provenance === "observed" || ev.evidence.provenance === "derived";
      const outcome = ev.evidence.sourceClass === "tool_output"
        ? ev.evidence.interpretation?.outcome
        : ev.evidence.claim.outcome;
        
      const expectedOutcome = check.type === "evidence_outcome" ? check.requireOutcome : "pass";
      if (isAuthoritative && outcome === expectedOutcome) {
        hasAuthoritativePass = true;
      }
      
      if (isAuthoritative && outcome !== expectedOutcome) {
        ruleVerdict = worstResult(ruleVerdict, mapVerdict(gate.onViolation));
        invalidRefs.push(ev.ref);
      }
    }
    
    if (!hasAuthoritativePass && ruleVerdict === "PASS") {
      // declared-only: onMissingEvidence (FF-008)
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `No authoritative (observed/derived) passing evidence found for kind '${check.evidenceKind}'.`,
        evidenceRefs: matchedRefs
      };
    }

    return {
      ruleId: gate.id,
      verdict: ruleVerdict,
      reason: ruleVerdict !== "PASS" ? `Some evidence did not meet required outcome '${check.requireOutcome}' or was declared only.` : undefined,
      evidenceRefs: ruleVerdict !== "PASS" ? invalidRefs : matchedRefs
    };
  }

  if (check.type === "review_open_items") {
    if (ctx.reviewScope.length === 0) {
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `Review scope is empty. No review observed yet.`,
        evidenceRefs: []
      };
    }

    let anyObserved = false;
    const openItems: { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[] = [];
    for (const scope of ctx.reviewScope) {
      const scopeData = ctx.reviewSummary?.byScope?.[scope];
      if (scopeData) {
        anyObserved = true;
        for (const item of scopeData.open) {
          // severity 閾値 (minimumSeverity) に基づくフィルタリング
          if (isSeverityAtLeast(item.severity, check.minimumSeverity)) {
            openItems.push(item);
          }
        }
      }
    }

    if (!anyObserved) {
      return {
        ruleId: gate.id,
        verdict: mapVerdict(gate.onMissingEvidence),
        reason: `No review observations found for scopes: ${ctx.reviewScope.join(", ")}.`,
        evidenceRefs: []
      };
    }

    if (openItems.length === 0) {
      return { ruleId: gate.id, verdict: "PASS", reason: "No open review items matching minimum severity found.", evidenceRefs: [] };
    }

    return {
      ruleId: gate.id,
      verdict: mapVerdict(gate.onViolation),
      reason: `Found ${openItems.length} open review items matching minimum severity '${check.minimumSeverity}'.`,
      evidenceRefs: openItems.map(i => i.ref)
    };
  }

  return { ruleId: gate.id, verdict: "FAIL", reason: `Unknown gate check type: ${(check as any).type}`, evidenceRefs: [] };
}

function isSeverityAtLeast(itemSeverity: "critical" | "major" | "minor", minSeverity: "critical" | "major" | "minor"): boolean {
  const levels = { "minor": 0, "major": 1, "critical": 2 };
  return levels[itemSeverity] >= levels[minSeverity];
}

function worstOf(verdicts: readonly ("PASS" | "WARN" | "FAIL")[]): "PASS" | "WARN" | "FAIL" {
  if (verdicts.includes("FAIL")) return "FAIL";
  if (verdicts.includes("WARN")) return "WARN";
  return "PASS";
}
```

- [ ] **Step 2b: rule evaluation engine skip test（D68）を実装**

```typescript
// tests/core/v2/rule-evaluation-engine.test.ts
it("skips task gate evaluation when taskId is undefined (no active task window)", () => {
  // 1. Setup a GateContext with trigger: "task_complete" and taskId: undefined
  // 2. Call evaluate() and verify that it returns { verdict: "SKIP", reason: "no taskId provided" }
  // 3. Add a second case where trigger: "tool_observed" resolves the active task before evaluate()
});
```

- [ ] **Step 3: provenance gating test（FF-008）を実装**


```typescript
// tests/core/v2/gate-provenance-gating.test.ts
it("declared evidence does not satisfy evidence_outcome", () => {
  // ...
});
```

- [ ] **Step 3b: review_open_items gate semantics test（D76）を実装**

```typescript
// tests/core/v2/rule-evaluation-engine.test.ts
it("evaluates review_open_items correctly with scopes and severity thresholds", () => {
  // Test cases:
  // 1. reviewScope=[] (empty scope): expect onMissingEvidence verdict.
  // 2. reviewScope with matching scope but no open items: expect PASS.
  // 3. reviewScope with open items of other scopes: expect no leakage (PASS if matching scope is clear).
  // 4. reviewScope with matching scope open items but severity below minimumSeverity threshold: expect PASS/WARN based on threshold config.
});
```

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-provenance-gating.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/v2/rule-evaluation-engine.ts src/core/v2/gate-context.ts tests/core/v2/rule-evaluation-engine.test.ts tests/core/v2/gate-provenance-gating.test.ts
git commit -m "feat(v2): rule evaluation engine with provenance gating"
```

- [ ] **Step 6: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 5.1`（直前 Task から派生）。`GateRule` 型を使用する。

---

### Task 5.3: Default Gates + Gate Loader

**Files:**

- Create: `src/runtime/gate-loader.ts`
- Create: `src/core/v2/default-gates.ts`
- Create: `templates/gate.yaml`（リポジトリテンプレート。runtime 読込時は `.justice/gate.yaml` へコピー/配備する。`.justice/*` は無視するが、人間承認済みの正本 `.justice/gate.yaml` を置けるよう `.gitignore` で例外設定する）
- Test: `tests/runtime/gate-loader.test.ts`
- Test: `tests/core/v2/default-gates.test.ts`

**Interfaces:**

- Consumes: `parseGateYaml`, `GateRule`, `FileReader`.
- Produces:
  - `loadGates(fileReader, path): GateRule[]` with default fallback.
  - Default gates: `required-tests`, `build-green`, `review-clean` (all `onViolation: warn`, `onMissingEvidence: warn`).

- [ ] **Step 1: 既定 gate を定義**

```typescript
// src/core/v2/default-gates.ts
export const DEFAULT_GATES: readonly GateRule[] = [
  {
    id: "required-tests",
    description: "タスク完了前にテストが pass していること",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
  {
    id: "build-green",
    description: "タスク完了前にビルドが pass していること",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "evidence_outcome", evidenceKind: "build", requireOutcome: "pass" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
  {
    id: "review-clean",
    description: "未解決レビュー指摘（minimumSeverity 以上）が無いこと",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "review_open_items", minimumSeverity: "major" },
    onViolation: "warn",
    onMissingEvidence: "warn",
    enabled: true,
  },
];
```

- [ ] **Step 2: gate loader を実装**

```typescript
// src/runtime/gate-loader.ts
export function mergeWithDefaults(customGates: readonly GateRule[]): readonly GateRule[] {
  const mergedMap = new Map<string, GateRule>();
  for (const gate of DEFAULT_GATES) {
    mergedMap.set(gate.id, gate);
  }
  for (const custom of customGates) {
    const existing = mergedMap.get(custom.id);
    if (existing) {
      // Override attributes or disable (D6/D57)
      mergedMap.set(custom.id, { ...existing, ...custom });
    } else {
      // Add new custom gates
      mergedMap.set(custom.id, custom);
    }
  }
  return Array.from(mergedMap.values()).filter(g => g.enabled !== false);
}

export async function loadGates(fileReader: FileReader, path = ".justice/gate.yaml"): Promise<readonly GateRule[]> {
  let content: string | null = null;
  try {
    content = await fileReader.readFile(path);
  } catch (err: any) {
    if (err && err.code !== "ENOENT") {
      console.warn(`Failed to read gates configuration from ${path}:`, err);
    }
  }
  if (!content) return DEFAULT_GATES.filter(g => g.enabled !== false);
  try {
    return mergeWithDefaults(parseGateYaml(content));
  } catch (err) {
    console.warn(`Failed to parse gates configuration from ${path}, falling back to defaults:`, err);
    return DEFAULT_GATES.filter(g => g.enabled !== false);
  }
}

export interface GateLoader {
  load(): Promise<readonly GateRule[]>;
}

export class FileGateLoader implements GateLoader {
  constructor(private readonly fileReader: FileReader, private readonly path = ".justice/gate.yaml") {}
  async load(): Promise<readonly GateRule[]> {
    return loadGates(this.fileReader, this.path);
  }
}
```

- [ ] **Step 3: `.gitignore` を更新し、テンプレート `templates/gate.yaml` を追加（ISS-007）**

`.gitignore` に `.justice/*` を追加して配下の自動生成ファイルやログを無視しつつ、正本としての `.justice/gate.yaml` が追跡対象に含まれるよう例外設定（`!.justice/gate.yaml` および `!.justice/`）を追加。テンプレート内容：

```yaml
schemaVersion: 1
authority: human_approved
gates:
  - id: required-tests
    description: "タスク完了前にテストが pass していること"
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: test, requireOutcome: pass }
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
  - id: build-green
    description: "タスク完了前にビルドが pass していること"
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: build, requireOutcome: pass }
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
  - id: review-clean
    description: "未解決レビュー指摘（minimumSeverity 以上）が無いこと"
    gateType: task
    trigger: { on: task_complete }
    check: { type: review_open_items, minimumSeverity: major }
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
```

- [ ] **Step 3b: `tests/runtime/gate-loader.test.ts` に同一 id override / 新規追加 / enabled:false 無効化のテストを追加（ISS-007）**
  - 次のケースをカバーする Vitest テストケースを作成する：
    1. デフォルト gate のプロパティ（例: `onViolation`）が custom gate で override されること。
    2. 新規の `id` を持つ gate が追加され、`DEFAULT_GATES` にないルールとして認識されること。
    3. `enabled: false` に設定された gate が `mergeWithDefaults` の結果から排除（無効化）されること。

- [ ] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/gate-loader.test.ts tests/core/v2/default-gates.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore templates/gate.yaml src/runtime/gate-loader.ts src/core/v2/default-gates.ts tests/runtime/gate-loader.test.ts tests/core/v2/default-gates.test.ts
git commit -m "feat(v2): default gates and gate loader"
```

- [ ] **Step 6: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 5.2`（直前 Task から派生）。

---

### Task 5.4: Gate Trigger + DecisionRecord Append

**Files:**

- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/v2/rule-evaluation-engine.ts`（trigger dispatch）
- Modify: `src/core/justice-notifier.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Interfaces:**

- Consumes: `ObservationLogStore`, `project`, `loadGates`, `evaluate`, `GateContext`.
- Produces: On `task_complete` / `tool_observed`, evaluate gates and append `DecisionRecord`.

- [ ] **Step 1: gate 評価トリガーを実装（§6.2）**

```typescript
// src/hooks/observation-handler.ts 内
private async evaluateGateIfTriggered(
  trigger: "task_complete" | "tool_observed",
  taskId: string | undefined,
  callId: string | undefined,
  agentId: ObservationAgentId,
  sessionId: string
): Promise<HookResponse> {
  try {
    if (trigger === "task_complete" && taskId === undefined) {
      return { action: "proceed" };
    }
    const shardId = { agentId, sessionId, writerId: this.writerId };
    const effectiveTaskId = taskId ?? (callId ? this.activeTaskWindows.get(callId) : undefined);
    if (effectiveTaskId === undefined) {
      return { action: "proceed" };
    }
    
    // To ensure strict D60-76 evaluation sequence, we must load all events including the newly appended record
    const events = await this.logStore.readAll();
    const state = project(events, new Date().toISOString());
    // Silent cache write in background to update status check cache
    await this.projectionCache.write(state).catch(() => {});

    const gates = await this.gateLoader.load();
    const ctx: GateContext = {
      trigger,
      taskId: effectiveTaskId,
      agentId,
      sessionId,
      reviewScope: collectReviewScopes(state, effectiveTaskId),
      reviewSummary: state.reviewSummary,
    };
    const evidence = state.tasks.get(effectiveTaskId)?.evidence ?? [];
    const verdict = evaluate(gates, evidence, ctx);
    if (verdict.verdict === "SKIP") {
      return { action: "proceed" };
    }
    const decision: DecisionRecord = { ...this.buildEnvelope({ taskId: effectiveTaskId, agentId, sessionId, recordType: "decision" }), ...verdict };
    await this.logStore.append(shardId, decision);

    // Refresh state projection with the new decision and update cache
    // Always readAll() after append to ensure we get the assigned sequence numbers
    const refreshedEvents = await this.logStore.readAll();
    const newState = project(refreshedEvents, new Date().toISOString());
    await this.projectionCache.write(newState).catch(() => {});

    if (verdict.verdict === "PASS") {
      return { action: "proceed" };
    }

    const advisoryMessage = formatGateAdvisoryMessage(verdict);
    try {
      this.justiceNotifier.notify(formatBanner("gate_advisory", advisoryMessage));
    } catch {
      // Fail open: notifier is best-effort, injectedContext remains the fallback surface.
    }

    return { action: "inject", injectedContext: advisoryMessage, variant: "gate_advisory" };
  } catch (err) {
    this.logger.warn("observation-handler: gate evaluation failed, degrading to PROCEED", err);
    return { action: "proceed" };
  }
}
```

- [ ] **Step 2: L0 advisory message と banner/notifier 送出を実装**

```typescript
function formatGateAdvisoryMessage(verdict: Verdict): string {
  const lines: string[] = [
    `${verdict.verdict}: ${verdict.ruleResults.map((r) => `${r.ruleId}=${r.verdict}`).join(", ")}`,
  ];
  for (const r of verdict.ruleResults) {
    if (r.verdict !== "PASS") {
      lines.push(`- [ ] ${r.ruleId}: ${r.verdict} — ${r.reason}`);
    }
  }
  return lines.join("\n");
}
  ```

  `formatGateAdvisoryMessage()` は injectedContext 用の本文を組み立てる責務に限定し、`formatBanner()` でバナー化した上で `JusticeNotifier` に送出する。`injectedContext` は PostToolUse 側の best-effort surface として残しつつ、保証チャネルは notifier に置く。

> **Banner contract:** AGENTS.md §2 requires `> <icon> **JUSTICE NOTIFICATION** [<title>]`, `> <message>`, and a trailing empty line. The optional checklist follows the message line and preserves the 3-line quote layout when no checklist items are present.
> **Emoji Avoidance Rule:** `AGENTS.md` の「チャット上の絵文字重複の禁止」ルールに基づき、`formatGateAdvisoryMessage` の出力および `DEFAULT_GATES` の定義・ルール評価など、通知メッセージのテキスト本体には装飾用絵文字（✅/❌/🎯など）を含めず、`PASS` / `FAIL` / `WARN` などのプレーンテキスト表記のみを使用するように徹底すること。

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-gate.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/observation-handler.ts src/core/justice-notifier.ts src/core/v2/rule-evaluation-engine.ts tests/hooks/observation-handler-gate.test.ts
git commit -m "feat(v2): gate trigger and decision record append"
```

- [ ] **Step 5: Phase 5 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 5.3`（直前 Task から派生）。

---
