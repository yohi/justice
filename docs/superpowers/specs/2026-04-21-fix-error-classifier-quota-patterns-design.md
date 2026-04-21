# Fix Error Classifier Provider Quota Patterns Design

- **Status**: Approved (design)
- **Date**: 2026-04-21
- **Owner**: justice maintainers
- **Related**: `2026-04-19-topic1-error-classifier-integration-design.md`

## 1. Goal & Scope

`src/core/provider-error-patterns.ts` において、`oh-my-openagent` の仕様に基づき本来 `PROVIDER_TRANSIENT_PATTERNS` (リトライを伴わない、時間経過等で解消しうる一時エラー) に分類されるべきクォータ関連のパターンが、誤って `PROVIDER_CONFIG_PATTERNS` に配置されている不具合を修正する。

### 修正対象のパターン
- `/payment.?required/i`
- `/usage\s+limit/i`
- `/out\s+of\s+credits?/i`

## 2. Design Decisions Summary

| 決定事項 | 結論 |
|---|---|
| パターンの移動 | 上記3つの正規表現を `PROVIDER_CONFIG_PATTERNS` から削除し、`PROVIDER_TRANSIENT_PATTERNS` に移動する。 |
| テストケースの移動 | `tests/core/provider-error-patterns.test.ts` と `tests/core/error-classifier.test.ts` 内にある、これら3パターンに依存する文字列（例："Out of credits" など）の分類先テストを `provider_transient` 側に移管する。 |
| その他の堅牢化ロジック | 今回発見された「`isProviderContext` の導入」「`TieredWisdomStore` でのハードブロック化」「ファイルロック機構」などの堅牢化実装については、正常な進化と見なし、本修正（差し戻し）の対象外とする。本件は純粋なバグ修正のみにスコープを絞る。 |

## 3. File Changes

### `src/core/provider-error-patterns.ts`
- `PROVIDER_CONFIG_PATTERNS` 配列から以下の3要素を削除:
  - `/payment.?required/i`
  - `/usage\s+limit/i`
  - `/out\s+of\s+credits?/i`
- `PROVIDER_TRANSIENT_PATTERNS` 配列の末尾に上記3要素を追加。

### `tests/core/provider-error-patterns.test.ts`
- `describe("PROVIDER_CONFIG_PATTERNS")` 内の `positiveExamples` から "Out of credits", "Payment Required" 等のテスト文字列を削除し、`describe("PROVIDER_TRANSIENT_PATTERNS")` の `positiveExamples` に追加。

### `tests/core/error-classifier.test.ts`
- `describe("per-pattern coverage — provider_config")` 内の `configSamples` から該当する3つの正規表現のタプルを削除し、`describe("per-pattern coverage — provider_transient")` の `transientSamples` へ移動。

## 4. Rollout
1. 本修正を含む計画書 (Plan) を `writing-plans` スキルを通じて作成する。
2. 実装、テスト、コミットを行う。
3. すべてのテストがPASSすることを確認する。
