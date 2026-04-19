# Error Classifier Provider Integration 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **用語:** 本ドキュメント中の `OmO` は上流ライブラリ `oh-my-openagent` を指す（コードベース全体で共通の略称）。`oh-my-opencode.jsonc` は利用者のローカル設定ファイル名であり、`oh-my-openagent` とは別物。

**Goal:** Justice の ErrorClassifier が OmO (`oh-my-openagent`) の `runtime-fallback` 由来のプロバイダエラー (rate limit / quota / 5xx / API key 不備 / model not found) を分類し、エージェントに適切なエスカレーションメッセージを返せるようにする。

**Architecture:** 既存の `ErrorClass` 型に 2 値 (`provider_transient` / `provider_config`) を追加し、`oh-my-openagent@3.17.4` のパターンをポートした独立ファイルから分類ルールを注入する。Justice 側リトライは発火させない (OmO fallback と二重リトライ回避)。

**Tech Stack:** TypeScript, Vitest, Bun

**Design Spec:** [2026-04-19-topic1-error-classifier-integration-design.md](../specs/2026-04-19-topic1-error-classifier-integration-design.md)

---

## Branch Strategy

```text
master
 └─ feature/phase-1__error-classifier-provider__base       ← Draft PR → master
     ├─ feature/phase1-task1__type-and-patterns             ← master → Draft PR → phase-1 base
     ├─ feature/phase1-task2__classifier-logic-and-tests    ← task1 → Draft PR → phase-1 base
     └─ feature/phase1-task3__docs-and-changelog            ← task2 → Draft PR → phase-1 base
```

| Branch | Base | PR Target |
|--------|------|-----------|
| `feature/phase-1__error-classifier-provider__base` | `master` | `master` (Draft) |
| `feature/phase1-task1__type-and-patterns` | `master` | `feature/phase-1__error-classifier-provider__base` (Draft) |
| `feature/phase1-task2__classifier-logic-and-tests` | `feature/phase1-task1__type-and-patterns` | `feature/phase-1__error-classifier-provider__base` (Draft) |
| `feature/phase1-task3__docs-and-changelog` | `feature/phase1-task2__classifier-logic-and-tests` | `feature/phase-1__error-classifier-provider__base` (Draft) |

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/core/types.ts` | Modify | `ErrorClass` 型定義に 2 値追加 |
| `src/core/provider-error-patterns.ts` | **Create** | プロバイダエラーパターンの正規表現定義 |
| `src/core/error-classifier.ts` | Modify | パターン import、CLASSIFICATION_RULES 拡張、getEscalationMessage 拡張 |
| `tests/core/provider-error-patterns.test.ts` | **Create** | パターン配列のエクスポート・長さ検証 |
| `tests/core/error-classifier.test.ts` | Modify | 分類テスト §A-F、リトライテスト §C、エスカレーションテスト §D、優先度テスト §E |
| `CHANGELOG.md` | Modify | Unreleased エントリ追加 |
| `AGENTS.md` | Modify | Upstream Drift Tracking セクション追加 |

---

## Phase 1: Error Classifier Provider Integration

> **Milestone:** プロバイダエラー分類が動作し、全テスト (既存 + 新規) が PASS。master マージ可能な自己完結単位。

### Task 1: ErrorClass 型拡張 + Provider Error Patterns ファイル作成

**Files:**

- Modify: `src/core/types.ts`（`ErrorClass` 型定義）
- Create: `src/core/provider-error-patterns.ts`
- Create: `tests/core/provider-error-patterns.test.ts`

**Branch:**

- Create: `feature/phase1-task1__type-and-patterns` from `master`
- PR: → `feature/phase-1__error-classifier-provider__base` (Draft)

---

- [ ] **Step 1: Phase ブランチと Task ブランチを作成**

```bash
cd "$(git rev-parse --show-toplevel)"
git checkout master
git pull origin master
git checkout -b feature/phase-1__error-classifier-provider__base
git push -u origin feature/phase-1__error-classifier-provider__base
git checkout -b feature/phase1-task1__type-and-patterns
```

- [ ] **Step 2: 既存テストが PASS することを確認（ベースライン）**

Run: `bun run test`
Expected: 全テスト PASS（失敗 0 件。テスト総数を記録してベースラインとする）

- [ ] **Step 3: パターンファイルの検証テストを作成 (RED)**

`tests/core/provider-error-patterns.test.ts` を新規作成:

```typescript
import { describe, it, expect } from "vitest";
import {
  PROVIDER_TRANSIENT_PATTERNS,
  PROVIDER_CONFIG_PATTERNS,
} from "../../src/core/provider-error-patterns";

describe("provider-error-patterns", () => {
  describe("PROVIDER_TRANSIENT_PATTERNS", () => {
    it("should be a frozen array of RegExp", () => {
      expect(Array.isArray(PROVIDER_TRANSIENT_PATTERNS)).toBe(true);
      expect(Object.isFrozen(PROVIDER_TRANSIENT_PATTERNS)).toBe(true);
      for (const pattern of PROVIDER_TRANSIENT_PATTERNS) {
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });

    it("should contain 17 patterns", () => {
      expect(PROVIDER_TRANSIENT_PATTERNS).toHaveLength(17);
    });
  });

  describe("PROVIDER_CONFIG_PATTERNS", () => {
    it("should be a frozen array of RegExp", () => {
      expect(Array.isArray(PROVIDER_CONFIG_PATTERNS)).toBe(true);
      expect(Object.isFrozen(PROVIDER_CONFIG_PATTERNS)).toBe(true);
      for (const pattern of PROVIDER_CONFIG_PATTERNS) {
        expect(pattern).toBeInstanceOf(RegExp);
      }
    });

    it("should contain 7 patterns", () => {
      expect(PROVIDER_CONFIG_PATTERNS).toHaveLength(7);
    });
  });
});
```

- [ ] **Step 4: テストが FAIL することを確認**

Run: `bun run test tests/core/provider-error-patterns.test.ts`
Expected: FAIL (モジュールが存在しない)

- [ ] **Step 5: ErrorClass 型を拡張**

`src/core/types.ts` の `ErrorClass` 型定義を以下に変更:

```typescript
/** エラー分類 */
export type ErrorClass =
  | "syntax_error"
  | "type_error"
  | "test_failure"
  | "design_error"
  | "timeout"
  | "loop_detected"
  | "provider_transient"
  | "provider_config"
  | "unknown";
```

- [ ] **Step 6: provider-error-patterns.ts を作成**

`src/core/provider-error-patterns.ts` を新規作成:

```typescript
// Source: oh-my-openagent@3.17.4
//   src/hooks/runtime-fallback/constants.ts (RETRYABLE_ERROR_PATTERNS)
//   src/hooks/runtime-fallback/error-classifier.ts (classifyErrorType)

export const PROVIDER_TRANSIENT_PATTERNS: readonly RegExp[] = Object.freeze([
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota\s+will\s+reset\s+after/i,
  /quota.?exceeded/i,
  /exhausted\s+your\s+capacity/i,
  /all\s+credentials\s+for\s+model/i,
  /cool(?:ing)?\s+down/i,
  /service.?unavailable/i,
  /overloaded/i,
  /temporarily.?unavailable/i,
  /(?:^|\s)429(?:\s|$)/,
  /(?:^|\s)503(?:\s|$)/,
  /(?:^|\s)529(?:\s|$)/,
  /retrying\s+in/i,
  /payment.?required/i,
  /usage\s+limit/i,
  /out\s+of\s+credits?/i,
]);

export const PROVIDER_CONFIG_PATTERNS: readonly RegExp[] = Object.freeze([
  /api.?key.?is.?missing/i,
  /api.?key.*?must be a string/i,
  /model.{0,20}?not.{0,10}?supported/i,
  /model_not_supported/i,
  /model\s+not\s+found/i,
  /providerModelNotFoundError/i,
  /AI_LoadAPIKeyError/i,
]);
```

> **Note:** 設計書では PROVIDER_TRANSIENT_PATTERNS は 17 個、PROVIDER_CONFIG_PATTERNS は 7 個。`Object.freeze()` で `readonly` 制約をランタイムでも担保する。

- [ ] **Step 7: パターンファイルのテストが PASS することを確認**

Run: `bun run test tests/core/provider-error-patterns.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: 既存テストが全て PASS することを確認**

Run: `bun run test`
Expected: 全テスト PASS（失敗 0 件。ベースラインから +4 件増加）

Run: `bun run typecheck`
Expected: エラーなし

- [ ] **Step 9: コミット**

```bash
git add src/core/types.ts src/core/provider-error-patterns.ts tests/core/provider-error-patterns.test.ts
git commit -m "feat(core): ErrorClassを拡張しprovider_transient/provider_configを追加、パターンファイル新規作成"
```

- [ ] **Step 10: Push して Draft PR を作成**

```bash
git push -u origin feature/phase1-task1__type-and-patterns
```

Draft PR: `feature/phase1-task1__type-and-patterns` → `feature/phase-1__error-classifier-provider__base`

---

### Task 2: ErrorClassifier 分類ロジック・エスカレーション拡張 + テスト (depends: task-1)

**Files:**

- Modify: `src/core/error-classifier.ts`
- Modify: `tests/core/error-classifier.test.ts`

**Branch:**

- Create: `feature/phase1-task2__classifier-logic-and-tests` from `feature/phase1-task1__type-and-patterns`
- PR: → `feature/phase-1__error-classifier-provider__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase1-task1__type-and-patterns
git checkout -b feature/phase1-task2__classifier-logic-and-tests
```

- [ ] **Step 2: 分類テスト §A (provider_transient) を追加 (RED)**

`tests/core/error-classifier.test.ts` の `describe("classify", ...)` ブロック末尾に追加:

```typescript
    describe("provider_transient classification", () => {
      it.each([
        ["Error: rate limit exceeded for model claude-sonnet"],
        ["Request failed with status 429: Too Many Requests"],
        ["Service is currently overloaded, please try again later"],
        ["Anthropic API quota exceeded for this billing period"],
        ["Provider returned: retrying in 30 seconds"],
        ["503 Service Unavailable"],
        ["You have exhausted your capacity for this model"],
        ["Cooling down before next request"],
      ])("should classify %j as provider_transient", (input) => {
        expect(classifier.classify(input)).toBe("provider_transient");
      });
    });
```

- [ ] **Step 3: テストが FAIL することを確認**

Run: `bun run test tests/core/error-classifier.test.ts`
Expected: FAIL — `provider_transient` ではなく `unknown` (または他のクラス) が返る

- [ ] **Step 4: 分類テスト §B (provider_config) を追加 (RED)**

`describe("classify", ...)` ブロック末尾に追加:

```typescript
    describe("provider_config classification", () => {
      it.each([
        ["AI_LoadAPIKeyError: API key is missing. Set ANTHROPIC_API_KEY"],
        ["Error: model not found: claude-opus-99"],
        ["model_not_supported by current provider"],
        ["providerModelNotFoundError: gpt-99 unavailable"],
      ])("should classify %j as provider_config", (input) => {
        expect(classifier.classify(input)).toBe("provider_config");
      });
    });
```

- [ ] **Step 5: リトライテスト §C を追加 (RED)**

`describe("shouldRetry", ...)` ブロック末尾に追加:

```typescript
    it("should never retry provider_transient errors", () => {
      expect(classifier.shouldRetry("provider_transient", 0)).toBe(false);
      expect(classifier.shouldRetry("provider_transient", 5)).toBe(false);
    });

    it("should never retry provider_config errors", () => {
      expect(classifier.shouldRetry("provider_config", 0)).toBe(false);
    });
```

- [ ] **Step 6: エスカレーションテスト §D を追加 (RED)**

`describe("getEscalationMessage", ...)` ブロック末尾に追加:

```typescript
    it("should return transient provider issue message for provider_transient", () => {
      const msg = classifier.getEscalationMessage("provider_transient");
      expect(msg).toContain("transient provider issue");
      expect(msg).toContain("different `category`");
    });

    it("should return user intervention message for provider_config", () => {
      const msg = classifier.getEscalationMessage("provider_config");
      expect(msg).toContain("user intervention");
      expect(msg).toContain("oh-my-opencode.jsonc");
    });
```

- [ ] **Step 7: 優先度テスト §E を追加 (RED)**

`describe("classify", ...)` ブロック末尾に追加:

```typescript
    describe("priority / boundary cases", () => {
      it("should prioritize type_error over provider_transient", () => {
        expect(classifier.classify("TypeError: caused by rate limit")).toBe("type_error");
      });

      it("should prioritize test_failure over provider patterns", () => {
        expect(classifier.classify("FAIL tests/quota.test.ts")).toBe("test_failure");
      });

      it("should classify config-only text as provider_config", () => {
        expect(classifier.classify("missing api key")).toBe("provider_config");
      });

      it("should classify transient-only text as provider_transient", () => {
        expect(classifier.classify("rate limit")).toBe("provider_transient");
      });
    });
```

- [ ] **Step 8: Per-Pattern Coverage テスト §F を追加 (RED)**

`describe("classify", ...)` ブロック末尾に追加:

```typescript
    describe("per-pattern coverage — provider_transient", () => {
      const transientSamples: [RegExp, string][] = [
        [/rate.?limit/i, "rate limit exceeded"],
        [/too.?many.?requests/i, "too many requests"],
        [/quota\s+will\s+reset\s+after/i, "quota will reset after 1 hour"],
        [/quota.?exceeded/i, "quota exceeded"],
        [/exhausted\s+your\s+capacity/i, "exhausted your capacity"],
        [/all\s+credentials\s+for\s+model/i, "all credentials for model exhausted"],
        [/cool(?:ing)?\s+down/i, "cooling down"],
        [/service.?unavailable/i, "service unavailable"],
        [/overloaded/i, "server overloaded"],
        [/temporarily.?unavailable/i, "temporarily unavailable"],
        [/(?:^|\s)429(?:\s|$)/, "429 Too Many Requests"],
        [/(?:^|\s)503(?:\s|$)/, "503 Service Unavailable"],
        [/(?:^|\s)529(?:\s|$)/, "529 Site is overloaded"],
        [/retrying\s+in/i, "retrying in 30s"],
        [/payment.?required/i, "payment required"],
        [/usage\s+limit/i, "usage limit reached"],
        [/out\s+of\s+credits?/i, "out of credits"],
      ];

      it.each(transientSamples)(
        "pattern %s should match %j as provider_transient",
        (_pattern, sample) => {
          expect(classifier.classify(sample)).toBe("provider_transient");
        },
      );
    });

    describe("per-pattern coverage — provider_config", () => {
      const configSamples: [RegExp, string][] = [
        [/api.?key.?is.?missing/i, "api key is missing"],
        [/api.?key.*?must be a string/i, "api key must be a string"],
        [/model.{0,20}?not.{0,10}?supported/i, "model xyz not supported"],
        [/model_not_supported/i, "model_not_supported"],
        [/model\s+not\s+found/i, "model not found"],
        [/providerModelNotFoundError/i, "providerModelNotFoundError: gpt-5"],
        [/AI_LoadAPIKeyError/i, "AI_LoadAPIKeyError thrown"],
      ];

      it.each(configSamples)(
        "pattern %s should match %j as provider_config",
        (_pattern, sample) => {
          expect(classifier.classify(sample)).toBe("provider_config");
        },
      );
    });
```

- [ ] **Step 9: テストの FAIL 数を確認**

Run: `bun run test tests/core/error-classifier.test.ts`
Expected: 新規追加テスト全て FAIL、既存テスト全て PASS

- [ ] **Step 10: ErrorClassifier に分類ルールを追加 (GREEN)**

`src/core/error-classifier.ts` を以下のように変更:

1\. ファイル先頭の既存 import 直後に以下を追加:

```typescript
import {
  PROVIDER_TRANSIENT_PATTERNS,
  PROVIDER_CONFIG_PATTERNS,
} from "./provider-error-patterns";
```

2\. `CLASSIFICATION_RULES` 配列の末尾（閉じ `];` の直前）に追加:

```typescript
  // Provider config (more specific) — evaluated first within provider rules
  ...PROVIDER_CONFIG_PATTERNS.map((pattern) => ({
    pattern,
    errorClass: "provider_config" as ErrorClass,
  })),

  // Provider transient
  ...PROVIDER_TRANSIENT_PATTERNS.map((pattern) => ({
    pattern,
    errorClass: "provider_transient" as ErrorClass,
  })),
```

3\. `getEscalationMessage()` の switch 文で `case "unknown":` の前に追加:

```typescript
      case "provider_transient":
        return (
          "The task failed due to a transient provider issue (rate limit, quota, or service " +
          "unavailability) that exhausted the harness's automatic retries. Wait a few minutes " +
          "before re-delegating, or try a different `category` to switch to an alternative model."
        );
      case "provider_config":
        return (
          "The task failed due to a provider configuration error (missing/invalid API key or " +
          "unavailable model). This requires user intervention — check your environment " +
          "variables and model configuration in `oh-my-opencode.jsonc`. Auto-retry is disabled " +
          "for this class."
        );
```

- [ ] **Step 11: 全テストが PASS することを確認**

Run: `bun run test`
Expected: 全テスト PASS（失敗 0 件。Task 1 末尾から新規追加分だけ増加）

Run: `bun run typecheck`
Expected: エラーなし

Run: `bun run lint`
Expected: エラーなし

- [ ] **Step 12: コミット**

```bash
git add src/core/error-classifier.ts tests/core/error-classifier.test.ts
git commit -m "feat(error-classifier): プロバイダエラーの分類ルールとエスカレーションメッセージを追加"
```

- [ ] **Step 13: Push して Draft PR を作成**

```bash
git push -u origin feature/phase1-task2__classifier-logic-and-tests
```

Draft PR: `feature/phase1-task2__classifier-logic-and-tests` → `feature/phase-1__error-classifier-provider__base`

---

### Task 3: ドキュメント更新 (CHANGELOG / AGENTS.md) (depends: task-2)

**Files:**

- Modify: `CHANGELOG.md`（先頭 `# Changelog` 見出しの直後に Unreleased セクション挿入）
- Modify: `AGENTS.md`（末尾 `---` 区切り直前に Upstream Drift Tracking セクション追加）

**Branch:**

- Create: `feature/phase1-task3__docs-and-changelog` from `feature/phase1-task2__classifier-logic-and-tests`
- PR: → `feature/phase-1__error-classifier-provider__base` (Draft)

---

- [ ] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase1-task2__classifier-logic-and-tests
git checkout -b feature/phase1-task3__docs-and-changelog
```

- [ ] **Step 2: CHANGELOG.md に Unreleased セクションを追加**

`CHANGELOG.md` の `# Changelog` 見出しの直後に追加:

```markdown

## Unreleased

### Features

* **error-classifier:** recognize provider-side transient and config errors (rate limit, quota, 5xx, missing API key, model not found). Patterns ported from oh-my-openagent@3.17.4 runtime-fallback. Both classes are non-retryable; rely on OmO's `runtime-fallback` for actual retries.
```

- [ ] **Step 3: AGENTS.md に Upstream Drift Tracking セクションを追加**

`AGENTS.md` の末尾付近にある最終 `---` 区切りの直前に新セクションを追加:

```markdown

### Upstream Drift Tracking

When `oh-my-openagent` releases a new version, review
`src/hooks/runtime-fallback/{constants,error-classifier}.ts` for changes to
`RETRYABLE_ERROR_PATTERNS` and `classifyErrorType`. If new patterns are added
or semantics shift, update `src/core/provider-error-patterns.ts` accordingly
and bump the source version comment.
```

- [ ] **Step 4: テスト・型チェック・Lint が PASS することを確認**

Run: `bun run test`
Expected: 全テスト PASS

Run: `bun run typecheck`
Expected: エラーなし

Run: `bun run lint`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add CHANGELOG.md AGENTS.md
git commit -m "docs: CHANGELOGにプロバイダエラー分類のエントリを追加、AGENTS.mdにUpstream Drift Trackingセクションを追加"
```

- [ ] **Step 6: Push して Draft PR を作成**

```bash
git push -u origin feature/phase1-task3__docs-and-changelog
```

Draft PR: `feature/phase1-task3__docs-and-changelog` → `feature/phase-1__error-classifier-provider__base`

---

## Completion Checklist

Phase 1 の全 Task が完了した後:

- [ ] Task 1 PR レビュー・マージ → Phase base に反映
- [ ] Task 2 PR レビュー・マージ → Phase base に反映
- [ ] Task 3 PR レビュー・マージ → Phase base に反映
- [ ] Phase 1 PR (`feature/phase-1__error-classifier-provider__base` → `master`) を Ready に変更
- [ ] CI (test / typecheck / lint) 全 PASS
- [ ] Phase 1 PR レビュー・マージ → master に反映
- [ ] minor リリース (`1.x.0`) を release-please 経由で配信
