# Error Classifier Integration with OmO `runtime-fallback`

- **Status**: Approved (design)
- **Date**: 2026-04-19
- **Owner**: justice maintainers
- **Source**: `oh-my-openagent` v3.17.4 (`src/hooks/runtime-fallback/{constants,error-classifier}.ts`)

## 1. Goal & Scope

Justice の `ErrorClassifier` が、`task()` 出力テキストに含まれる **プロバイダ起因エラー** (rate limit / quota / HTTP 5xx / API key 不備 / model not found) を認識できるようにする。OmO の `runtime-fallback` フックが session レベルで既に再試行・モデル切替を実施済みである前提に立ち、Justice 側では **分類とエスカレーションのみを行い、独自の再リトライは発火させない**。

### Non-Goals

- OmO 本体への PR / 共有パッケージ抽出
- Justice 側でのモデル切替・再委譲ロジック実装
- `runtime-fallback` の挙動の置き換え

### Why now

現状、`task()` がプロバイダの一時障害で失敗した場合、Justice の `ErrorClassifier` は `unknown` を返し、`SmartRetryPolicy.shouldRetry` が `false` を返すため、エージェントには「未知のエラー、次の手は不明」のメッセージが届く。プロバイダ層で何が起きたのかを Justice が言語化できれば、エージェントは「待つ」「category を変える」など適切な次手を取れる。

## 2. Design Decisions Summary

| 決定事項 | 結論 |
|---|---|
| 分類軸 | 既存の「アクション軸」を維持。新規 2 値 `provider_transient` / `provider_config` を追加 |
| リトライ | 両クラスとも `retryableErrors` Set に **含めない**（OmO 側 fallback と二重リトライしない） |
| パターン管理 | `src/core/provider-error-patterns.ts` に独立切り出し。出典コメントで OmO バージョンを明記 |
| OmO への依存 | 追加しない（peerDependency 化はしない） |
| マッチ優先度 | 既存ビルド系ルールを優先。provider 系は `CLASSIFICATION_RULES` 配列の末尾に追加 |
| SemVer | minor bump（型に値を追加するのみ。既存値・挙動は不変） |

## 3. Type Changes

### `src/core/types.ts`

```ts
export type ErrorClass =
  | "syntax_error"
  | "type_error"
  | "test_failure"
  | "design_error"
  | "timeout"
  | "loop_detected"
  | "provider_transient"   // NEW
  | "provider_config"      // NEW
  | "unknown";
```

`DEFAULT_RETRY_POLICY.retryableErrors` は **不変**。両新規値は含めない。

### `ErrorClass` 拡張の影響範囲

検索結果より `ErrorClass` を switch しているのは `error-classifier.ts:74` の 1 箇所のみ。`default` 分岐があるため exhaustive 性は壊れない。他の参照 (`smart-retry-policy.ts`, `learning-extractor.ts`, `task-splitter.ts`, `wisdom-store.ts`) は値を比較・透過するのみで影響なし。

## 4. New File: `src/core/provider-error-patterns.ts`

```ts
// Source: oh-my-openagent@3.17.4
//   src/hooks/runtime-fallback/constants.ts (RETRYABLE_ERROR_PATTERNS)
//   src/hooks/runtime-fallback/error-classifier.ts (classifyErrorType)
// Tracked commit: <SHA at port time, recorded in CHANGELOG>

export const PROVIDER_TRANSIENT_PATTERNS: readonly RegExp[] = [
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
];

export const PROVIDER_CONFIG_PATTERNS: readonly RegExp[] = [
  /api.?key.?is.?missing/i,
  /api.?key.*?must be a string/i,
  /model.{0,20}?not.{0,10}?supported/i,
  /model_not_supported/i,
  /model\s+not\s+found/i,
  /providerModelNotFoundError/i,
  /AI_LoadAPIKeyError/i,
];
```

### Pattern Selection Notes

- `try.?again` (OmO の `RETRYABLE_ERROR_PATTERNS` に存在) は意図的に除外。汎用すぎて Justice の出力テキストで誤検知が増えるため。
- `payment.?required` / `usage\s+limit` / `out\s+of\s+credits?` は OmO の `classifyErrorType("quota_exceeded")` 由来。`PROVIDER_TRANSIENT_PATTERNS` 側に置く（quota は時間経過/プラン更新で解消し得る扱い）。
- `model.{0,20}?not.{0,10}?supported` と `model_not_supported` の両方を持つのは、表記ゆれ吸収のため OmO に倣ったもの。

*(Note: Implementation later added an `isProviderContext` option to `ErrorClassifier.classify` to avoid misclassifying generic errors like "timeout" as provider-specific errors when not evaluating tool output. Also, cross-process file locking was adopted instead of pure lock-free, and secrets are now hard-blocked from global promotion.)*

## 5. `ErrorClassifier` Changes

### `src/core/error-classifier.ts`

`CLASSIFICATION_RULES` 末尾に provider ルールを追加:

```ts
import { PROVIDER_TRANSIENT_PATTERNS, PROVIDER_CONFIG_PATTERNS } from "./provider-error-patterns";

const CLASSIFICATION_RULES: ClassificationRule[] = [
  // ... 既存の build/test/timeout/loop/design ルール ...

  // Provider config (more specific) — 先に評価
  ...PROVIDER_CONFIG_PATTERNS.map((pattern) => ({ pattern, errorClass: "provider_config" as ErrorClass })),

  // Provider transient
  ...PROVIDER_TRANSIENT_PATTERNS.map((pattern) => ({ pattern, errorClass: "provider_transient" as ErrorClass })),
];
```

### Match Priority Rationale

ビルド/テスト系のルールが先頭に並ぶ現状を維持。provider 系は末尾。これにより `"TypeError: rate limit exceeded"` のような複合文字列で `type_error` が優先される。境界ケースはテストで担保 (§7)。

`provider_config` は `provider_transient` よりも具体的（"api key", "model not found" 等のキーワード）なため、provider 系内では config を先に評価する。

### `getEscalationMessage()` 拡張

```ts
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

### `shouldRetry()` 変更

**変更なし**。両クラスは `retryableErrors` Set に登録しないため、自動的に `false` が返る。

## 6. Out-of-File Changes

### `CHANGELOG.md`

- Section: "Unreleased" / minor
- Entry: "feat(error-classifier): recognize provider-side transient and config errors (rate limit, quota, 5xx, missing API key, model not found). Patterns ported from oh-my-openagent@3.17.4 runtime-fallback. Both classes are non-retryable; rely on OmO's `runtime-fallback` for actual retries."

### `AGENTS.md` (運用追記)

新セクション "Upstream Drift Tracking" を追加:

> When `oh-my-openagent` releases a new version, review `src/hooks/runtime-fallback/{constants,error-classifier}.ts` for changes to `RETRYABLE_ERROR_PATTERNS` and `classifyErrorType`. If new patterns are added or semantics shift, update `src/core/provider-error-patterns.ts` accordingly and bump the source version comment.

## 7. Test Plan

### File: `tests/error-classifier.test.ts` (extension)

#### A. Classification — `provider_transient`

入力 8 件、すべて `"provider_transient"` が返ること:

1. `"Error: rate limit exceeded for model claude-sonnet"`
2. `"Request failed with status 429: Too Many Requests"`
3. `"Service is currently overloaded, please try again later"`
4. `"Anthropic API quota exceeded for this billing period"`
5. `"Provider returned: retrying in 30 seconds"`
6. `"503 Service Unavailable"`
7. `"You have exhausted your capacity for this model"`
8. `"Cooling down before next request"`

#### B. Classification — `provider_config`

入力 4 件、すべて `"provider_config"` が返ること:

1. `"AI_LoadAPIKeyError: API key is missing. Set ANTHROPIC_API_KEY"`
2. `"Error: model not found: claude-opus-99"`
3. `"model_not_supported by current provider"`
4. `"providerModelNotFoundError: gpt-99 unavailable"`

#### C. Retry Policy

- `shouldRetry("provider_transient", 0)` → `false`
- `shouldRetry("provider_transient", 5)` → `false`
- `shouldRetry("provider_config", 0)` → `false`

#### D. Escalation Messages

- `getEscalationMessage("provider_transient")` が "transient provider issue" と "different `category`" を含む
- `getEscalationMessage("provider_config")` が "user intervention" と "oh-my-opencode.jsonc" を含む

#### E. Priority / Boundary Cases

- `"TypeError: caused by rate limit"` → `type_error` （ビルド系優先）
- `"FAIL tests/quota.test.ts"` → `test_failure` （test_failure 優先）
- `"missing api key"` (config 系のみ該当) → `provider_config`
- `"rate limit"` (transient のみ該当) → `provider_transient`

#### F. Per-Pattern Coverage (data-driven)

`provider-error-patterns.ts` の各パターンに対し、1 行ずつ「マッチを意図したサンプル文字列」を含む table-driven テストを追加。`PROVIDER_TRANSIENT_PATTERNS.length` および `PROVIDER_CONFIG_PATTERNS.length` 件の `it.each` ケースで、対応する `ErrorClass` が返ることを確認する。これにより §A/§B の代表入力では拾いきれない pattern (例: `payment.?required`, `usage\s+limit`, `out\s+of\s+credits?`, `quota\s+will\s+reset\s+after`, `all\s+credentials\s+for\s+model`, `too.?many.?requests`, `temporarily.?unavailable`, `(?:^|\s)529(?:\s|$)`, `api.?key.*?must be a string`, `model.{0,20}?not.{0,10}?supported`) も網羅される。

#### G. Coverage Target

新規追加分のラインカバレッジ 100%。

## 8. Impact Summary

| ファイル | 変更種別 | 行数目安 |
|---|---|---:|
| `src/core/types.ts` | `ErrorClass` 拡張 | +2 |
| `src/core/provider-error-patterns.ts` | 新規 | ~45 |
| `src/core/error-classifier.ts` | パターン import / switch 拡張 | +25 |
| `tests/error-classifier.test.ts` | テスト追加 | ~70 |
| `CHANGELOG.md` | エントリ追加 | +5 |
| `AGENTS.md` | 運用セクション追加 | +6 |

合計 ~150 行。既存テスト 206 件は既存 `ErrorClass` 値・既存 regex に変更がないため全件 pass の想定。

## 9. Rollout

1. 上記変更を 1 PR にまとめる（小さく自己完結）
2. CI の test/typecheck/lint をパスさせる
3. minor リリース (`1.x.0`) として release-please 経由で配信
4. `oh-my-opencode.jsonc` 側の利用者には特別な対応不要（取り込み時の挙動が `unknown` から具体クラスに変わるのみ）

## 10. Open Questions / Future Work

- (Future) `provider_transient` を `WisdomStore` に記録し、特定 category × エラー頻度の傾向を集約 → エージェントが「この時間帯はこの category が rate limit になりやすい」を学習する基盤に発展可能。本 spec のスコープ外。
- (Future) OmO 側に「どの provider error で fallback したか」のメタ情報を `task()` 出力に含める拡張を提案できれば、テキストマッチではなく構造データで分類でき精度が上がる。要 OmO 本体 PR。
