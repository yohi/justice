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

> **Split plan:** This file is part 07 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Review severity classification, scope-aware review aggregation, and review_observed generation.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

## Phase 6: Review Aggregator

**Base Branch:** `feature/phase6-v2-review-aggregator__base`

**目的:** 既存 `ReviewRejectionDetector` を拡張し、severity 決定論的分類器・itemKey・scope-aware 集約を実装。本 Phase だけで review 集約が完成する。

**判断:** Phase 6 は Phase 5 の `review_open_items` gate と Phase 1/2 の型を使用。Task 6.1 は severity 分類器（独立）で Base から、Task 6.2 は 6.1 + ProjectedState 型で Task 6.1 から、Task 6.3 は 6.2 + observation-handler 経路で Task 6.2 から。

---

### Task 6.1: Review Severity Classifier + ItemKey

**Files:**

- Modify: `src/core/review-rejection-detector.ts`（severity フィールド追加）
- Create: `src/core/v2/review-severity.ts`
- Test: `tests/core/review-severity.test.ts`

**Interfaces:**

- Consumes: existing `ReviewRejectionSignal`.
- Produces: `ReviewRejectionSignal` with `severity: "critical" | "major" | "minor"` and `itemKey`.

- [ ] **Step 1: 凍結語彙に基づく severity 分類器を実装（D57）**

```typescript
// src/core/v2/review-severity.ts
const CRITICAL = /security|vulnerability|data ?loss|破壊的|重大/i;
const MAJOR = /must fix|required|bug|regression|要修正|不具合/i;
const MINOR = /nit|suggestion|optional|style|軽微|提案/i;

export function classifySeverity(summary: string): "critical" | "major" | "minor" {
  if (CRITICAL.test(summary)) return "critical";
  if (MAJOR.test(summary)) return "major";
  if (MINOR.test(summary)) return "minor";
  return "minor";
}

export function deriveItemKey(severity: ReviewRejectionSignal["severity"], ruleId: string, location: string, evidenceHash: string): string {
  const cwd = typeof process !== "undefined" ? process.cwd().replace(/\\/g, "/") : "";
  let canonicalLocation = location.replace(/\\/g, "/").trim();
  if (cwd && canonicalLocation.startsWith(cwd)) {
    canonicalLocation = canonicalLocation.slice(cwd.length);
  }
  canonicalLocation = canonicalLocation.replace(/^\/+/, "");
  if (canonicalLocation.startsWith("./")) {
    canonicalLocation = canonicalLocation.slice(2);
  }
  const locationHash = hashString(canonicalLocation).slice(0, 12);
  return `${severity}:${ruleId}:${locationHash}:${evidenceHash}`;
}
```

- [ ] **Step 2: 既存 detector の出力に severity/itemKey を追加**

```typescript
// src/core/review-rejection-detector.ts
export type ReviewRejectionSignal = {
  readonly matched: boolean;
  readonly excerpts: readonly string[];
  readonly summary: string;
  readonly severity: "critical" | "major" | "minor";
  readonly itemKey: string;
};
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/review-severity.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/review-severity.ts src/core/review-rejection-detector.ts tests/core/review-severity.test.ts
git commit -m "feat(v2): deterministic review severity classifier and itemKey"
```

- [ ] **Step 5: Phase 6 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `feature/phase6-v2-review-aggregator__base`（Base から派生）。

---

### Task 6.2: Review Aggregator with Scope-Aware byScope

**Files:**

- Create: `src/core/v2/review-aggregator.ts`
- Modify: `src/core/v2/state-projection.ts`（byScope 集約を追加）
- Test: `tests/core/v2/review-aggregator.test.ts`
- Test: `tests/core/v2/state-projection-review.test.ts`

**Interfaces:**

- Consumes: `ReviewRejectionSignal`, `ObservationRecord{kind:"review_observed"}`.
- Produces: `aggregateReviews(records): ReviewSummary` with `byScope` and deterministic resolution rules (D32).

- [ ] **Step 1: review aggregator を実装（D32/D66）**

```typescript
// src/core/v2/review-aggregator.ts
import type { ReviewItem } from "./observation-model.ts";

export type ReviewSummary = {
  readonly authority: "observed_review_output";
  readonly authorship?: null;
  readonly critical: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly major: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly minor: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly resolved: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly open: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  readonly byScope: Readonly<Record<string, {
    readonly critical: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly major: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly minor: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly resolved: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly open: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  }>>;
};

export function aggregateReviews(records: readonly ObservationRecord[]): ReviewSummary {
  const byScopeMap = new Map<string, {
    readonly critical: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly major: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly minor: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly resolved: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly open: readonly { readonly reviewScope: string; readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
  }>();

  // レコードを順方向に走査して最新 of 指摘・解決マーク状態を決定論的にマージする
  for (const record of records) {
    if (record.kind !== "review_observed") continue;
    const scope = record.reviewScope;
    if (!byScopeMap.has(scope)) {
      byScopeMap.set(scope, { critical: [], major: [], minor: [], resolved: [], open: [] });
    }
    let state = byScopeMap.get(scope)!;
    const ref: FullEvidenceRef = {
      agentId: record.agentId,
      sessionId: record.sessionId,
      writerId: record.writerId,
      sequence: record.sequence, // FIX: assign sequence from record (finding 4)
      evidenceId: "" // assigned dynamically per item
    };

    // 1. 新規の指摘アイテム (items) をマージ
    if (record.items) {
      for (const item of record.items) {
        const itemRef = { ...ref, evidenceId: item.itemKey };
        const entry = { reviewScope: scope, itemKey: item.itemKey, ref: itemRef, severity: item.severity };

        // 一旦、既存の open, resolved, critical, major, minor リストから同一 itemKey のエントリを除外する (latest-review-wins)
        state = {
          ...state,
          open: state.open.filter(x => x.itemKey !== item.itemKey),
          resolved: state.resolved.filter(x => x.itemKey !== item.itemKey),
          critical: state.critical.filter(x => x.itemKey !== item.itemKey),
          major: state.major.filter(x => x.itemKey !== item.itemKey),
          minor: state.minor.filter(x => x.itemKey !== item.itemKey),
        };

        // D32: Do NOT resolve review items based on status: "resolved" within the items array.
        // All review items are added to 'open' by default, and resolution is strictly processed via
        // isCompleteSnapshot removal or explicit resolutionMarker presence to avoid "disappearance without evidence".
        state = {
          ...state,
          open: [...state.open, entry],
          critical: item.severity === "critical" ? [...state.critical, entry] : state.critical,
          major: item.severity === "major" ? [...state.major, entry] : state.major,
          minor: item.severity === "minor" ? [...state.minor, entry] : state.minor
        };
      }

      // complete snapshot (isCompleteSnapshot: true) の場合、本レコードの items に含まれない open 指摘は resolved へ遷移 (D32)
      if (record.isCompleteSnapshot) {
        const currentKeys = new Set(record.items.map(i => i.itemKey));
        const toResolve = state.open.filter(o => !currentKeys.has(o.itemKey));
        state = {
          ...state,
          open: state.open.filter(o => currentKeys.has(o.itemKey)),
          resolved: [...state.resolved, ...toResolve],
          critical: state.critical.filter(o => currentKeys.has(o.itemKey)),
          major: state.major.filter(o => currentKeys.has(o.itemKey)),
          minor: state.minor.filter(o => currentKeys.has(o.itemKey))
        };
      }
    }

    // 2. 明示的な解決マーカー (resolutionMarker) を処理
    if (record.resolutionMarker) {
      const markerKeys = new Set(record.resolutionMarker.map(m => m.itemKey));
      const toResolve = state.open.filter(o => markerKeys.has(o.itemKey));
      if (toResolve.length > 0) {
        state = {
          ...state,
          open: state.open.filter(o => !markerKeys.has(o.itemKey)),
          resolved: [...state.resolved, ...toResolve],
          critical: state.critical.filter(o => !markerKeys.has(o.itemKey)),
          major: state.major.filter(o => !markerKeys.has(o.itemKey)),
          minor: state.minor.filter(o => !markerKeys.has(o.itemKey))
        };
      }
    }
    byScopeMap.set(scope, state);
  }

  // グローバルサマリーの集計
  const critical: { reviewScope: string; itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const major: { reviewScope: string; itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const minor: { reviewScope: string; itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const resolved: { reviewScope: string; itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];
  const open: { reviewScope: string; itemKey: string; ref: FullEvidenceRef; severity: "critical" | "major" | "minor" }[] = [];

  for (const [_, scopeData] of byScopeMap) {
    critical.push(...scopeData.critical);
    major.push(...scopeData.major);
    minor.push(...scopeData.minor);
    resolved.push(...scopeData.resolved);
    open.push(...scopeData.open);
  }

  return {
    authority: "observed_review_output",
    critical,
    major,
    minor,
    resolved,
    open,
    byScope: Object.fromEntries(byScopeMap)
  };
}
```

- [ ] **Step 1b: review 解決規則テストを追加（D32）**

```typescript
// tests/core/v2/review-aggregator.test.ts
it("keeps item open on mere disappearance", () => {
  const records = [
    reviewObserved({ scope: "task-1", items: [{ itemKey: "major:foo", severity: "major", evidenceId: "major:foo", summary: "foo", location: "file.ts", status: "open" }] }),
    reviewObserved({ scope: "task-1", items: [{ itemKey: "minor:bar", severity: "minor", evidenceId: "minor:bar", summary: "bar", location: "file.ts", status: "open" }] }),
  ];
  const summary = aggregateReviews(records);
  const openItems = summary.byScope["task-1"]?.open ?? [];
  expect(openItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(openItems.find(i => i.itemKey === "major:foo")?.ref.evidenceId).toBe("major:foo");
});

it("marks item resolved on explicit marker", () => {
  const records = [
    reviewObserved({ scope: "task-1", items: [{ itemKey: "major:foo", severity: "major", evidenceId: "major:foo", summary: "foo", location: "file.ts", status: "open" }] }),
    reviewObserved({ scope: "task-1", resolutionMarker: [{ itemKey: "major:foo", resolution: "explicit_marker" }] }),
  ];
  const summary = aggregateReviews(records);
  const resolvedItems = summary.byScope["task-1"]?.resolved ?? [];
  const openItems = summary.byScope["task-1"]?.open ?? [];
  expect(resolvedItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(resolvedItems.find(i => i.itemKey === "major:foo")?.ref.evidenceId).toBe("major:foo");
  expect(openItems.find(i => i.itemKey === "major:foo")).toBeUndefined();
});

it("marks item resolved on complete snapshot absence", () => {
  const records = [
    reviewObserved({ scope: "task-1", items: [{ itemKey: "major:foo", severity: "major", evidenceId: "major:foo", summary: "foo", location: "file.ts", status: "open" }] }),
    reviewObserved({ scope: "task-1", isCompleteSnapshot: true, items: [{ itemKey: "minor:bar", severity: "minor", evidenceId: "minor:bar", summary: "bar", location: "file.ts", status: "open" }] }),
  ];
  const summary = aggregateReviews(records);
  const resolvedItems = summary.byScope["task-1"]?.resolved ?? [];
  const openItems = summary.byScope["task-1"]?.open ?? [];
  expect(resolvedItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(openItems).toContainEqual(expect.objectContaining({ itemKey: "minor:bar" }));
  expect(openItems.find(i => i.itemKey === "minor:bar")?.ref.evidenceId).toBe("minor:bar");
});

it("keeps item open when snapshot is not marked complete", () => {
  const records = [
    reviewObserved({ scope: "task-1", items: [{ itemKey: "major:foo", severity: "major", evidenceId: "major:foo", summary: "foo", location: "file.ts", status: "open" }] }),
    reviewObserved({ scope: "task-1", isCompleteSnapshot: false, items: [{ itemKey: "minor:bar", severity: "minor", evidenceId: "minor:bar", summary: "bar", location: "file.ts", status: "open" }] }),
  ];
  const summary = aggregateReviews(records);
  const openItems = summary.byScope["task-1"]?.open ?? [];
  expect(openItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
});

it("marks item resolved on human artifact", () => {
  const records = [
    reviewObserved({ scope: "task-1", items: [{ itemKey: "major:foo", severity: "major", evidenceId: "major:foo", summary: "foo", location: "file.ts", status: "open" }] }),
    reviewObserved({ scope: "task-1", resolutionMarker: [{ itemKey: "major:foo", resolution: "human_artifact", artifactRef: "docs/reviews/2026-06-26.md" }] }),
  ];
  const summary = aggregateReviews(records);
  const resolvedItems = summary.byScope["task-1"]?.resolved ?? [];
  expect(resolvedItems).toContainEqual(expect.objectContaining({ itemKey: "major:foo" }));
  expect(resolvedItems.find(i => i.itemKey === "major:foo")?.ref.evidenceId).toBe("major:foo");
});
```

- [ ] **Step 2: state-projection に byScope マージを追加し、ProjectedState の schema version 更新と migration を定義したうえで aggregateReviews(reviewObservedEvents) 連携へ差し替える**

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/review-aggregator.ts src/core/v2/state-projection.ts tests/core/v2/review-aggregator.test.ts tests/core/v2/state-projection-review.test.ts
git commit -m "feat(v2): scope-aware review aggregator"
```

- [ ] **Step 5: Phase 6 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 6.1`（直前 Task から派生）。severity/itemKey を使用するため。

---

### Task 6.3: Review Observed Generation in Handler

**Files:**

- Modify: `src/hooks/observation-handler.ts`
- Modify: `src/core/v2/review-scope.ts`
- Modify: `src/core/review-rejection-detector.ts` (add detectMultiple method)
- Test: `tests/hooks/observation-handler-review.test.ts`
- Test: `tests/core/review-rejection-detector.test.ts`

**Interfaces:**

- Consumes: `ReviewRejectionDetector.detectMultiple(output, metadata)`, `aggregateReviews`, `deriveReviewScope`.
- Produces:
  - `ObservationRecord{kind:"review_observed", reviewScope, items[], isCompleteSnapshot?}` append on task/PostToolUse outputs (now supporting multiple review items parsed from output).
  - `ObservationRecord{kind:"review_observed", reviewScope, resolutionMarker[]}` append when a human-approved resolution artifact is received.

- [ ] **Step 1: review scope 導出関数を確認・修正（§7.6）**
  - （※`deriveReviewScope` は Task 5.2 にて作成済みであるため、必要に応じて実装内容を確認し、追加要件があれば修正する）

- [ ] **Step 1b: `ReviewRejectionDetector.detectMultiple(output, metadata)` および `isCompleteSnapshot(output, metadata)` を実装する**
  - 単一のシグナル抽出から、レビュー出力内に含まれる複数の指摘事項（severity, summary, location 含む）を正規表現や構造解析により分解し、`ReviewItem[]` にパースするメソッドを `ReviewRejectionDetector`（`src/core/review-rejection-detector.ts`）に追加し、そのテストを `tests/core/review-rejection-detector.test.ts` に追加する。
  - 同時に、上流から渡される `metadata.isCompleteSnapshot` を優先し、未指定時のみテキストヒューリスティクスで補完する `boolean` を返す `isCompleteSnapshot(output, metadata): boolean` メソッドも `ReviewRejectionDetector` に追加する。

- [ ] **Step 2: Core 純粋ビルダーに review_observed / resolution 構築関数を追加（src/core/v2/record-builder.ts）**

```typescript
// src/core/v2/record-builder.ts に追加
export function buildReviewObservedRecord(
  envelope: CommonEnvelope,
  reviewScope: string,
  items: readonly ReviewItem[],
  isCompleteSnapshot: boolean = false
): ObservationRecord {
  return {
    ...envelope,
    recordType: "observation",
    kind: "review_observed",
    reviewScope,
    isCompleteSnapshot,
    items,
  };
}

export function buildReviewResolutionRecord(
  envelope: CommonEnvelope,
  reviewScope: string,
  itemKeys: string[],
  artifactRef: string
): ObservationRecord {
  return {
    ...envelope,
    recordType: "observation",
    kind: "review_observed",
    reviewScope,
    resolutionMarker: itemKeys.map((itemKey) => ({
      itemKey,
      resolution: "human_artifact" as const,
      artifactRef,
    })),
    items: [],
  };
}
```

- [ ] **Step 2b: PostToolUse 時に review_observed を生成・append（通常観測）**
  - `ReviewRejectionDetector.detectMultiple` を用いて、見つかったすべての指摘アイテムを `items` に含めて記録します。レコード構築は `buildReviewObservedRecord`（純粋関数）に委譲します。

```typescript
// src/hooks/observation-handler.ts 内に `appendReviewObservationsIfDetected` メソッドを実装
private async appendReviewObservationsIfDetected(shardId: ShardId, taskId: string | undefined, sessionId: string, callId: string, toolName: string, toolResult: string | undefined, metadata?: { readonly isCompleteSnapshot?: boolean }): Promise<void> {
  try {
    const items = ReviewRejectionDetector.detectMultiple(toolResult ?? "", metadata);
    const isCompleteSnapshot = ReviewRejectionDetector.isCompleteSnapshot(toolResult ?? "", metadata);
    if (items.length > 0 || isCompleteSnapshot) {
      const reviewScope = deriveReviewScope({ taskId, sessionId, callId, toolName });
      const envelope = this.buildEnvelope({
        taskId,
        agentId: shardId.agentId,
        sessionId,
        recordType: "observation",
      });
      const record = buildReviewObservedRecord(envelope, reviewScope, items, isCompleteSnapshot);
      await this.logStore.append(shardId, record);
    }
  } catch (err) {
    this.logger.warn("observation-handler: review_observed generation failed", err);
  }
}
```

- [ ] **Step 2c: 人間承認 artifact 解決マーカー経路を追加（D32 seam）**
  - レコード構築は `buildReviewResolutionRecord` に委譲します。

```typescript
// src/hooks/observation-handler.ts 内（将来の拡張用 seam）
private async handleReviewResolutionArtifact(payload: { agentId: ObservationAgentId; sessionId: string; reviewScope: string; itemKeys: string[]; artifactRef: string }): Promise<HookResponse> {
  try {
    const envelope = this.buildEnvelope({
      agentId: payload.agentId,
      sessionId: payload.sessionId,
      recordType: "observation",
    });
    const record = buildReviewResolutionRecord(envelope, payload.reviewScope, payload.itemKeys, payload.artifactRef);
    const shardId = { agentId: payload.agentId, sessionId: payload.sessionId, writerId: this.writerId };
    await this.logStore.append(shardId, record);
  } catch (err) {
    this.logger.warn("observation-handler: review resolution marker failed", err);
  }
  return { action: "proceed" };
}
```

- [ ] **Step 3: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/hooks/observation-handler-review.test.ts tests/core/review-rejection-detector.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/core/v2/review-scope.ts src/core/v2/record-builder.ts src/hooks/observation-handler.ts src/core/review-rejection-detector.ts tests/hooks/observation-handler-review.test.ts tests/core/review-rejection-detector.test.ts
git commit -m "feat(v2): review_observed generation using record-builder and multi-item detection"
```

- [ ] **Step 5: Phase 6 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 6.2`（直前 Task から派生）。

---
