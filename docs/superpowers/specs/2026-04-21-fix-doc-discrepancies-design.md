# Fix Documentation Discrepancies in Wisdom Store and Error Classifier

- **Status**: Approved
- **Date**: 2026-04-21
- **Owner**: Gemini CLI

## 1. Goal & Scope

設計書および作業計画で定義されているにもかかわらず、現在の実装に反映されていない（または誤って実装されている）乖離を修正し、ドキュメントと実装の整合性を確保する。

### 対象の乖離点
1. **TieredWisdomStore**: 秘密検知時にグローバル保存をブロックせず、警告のみとする設計の適用。
2. **TieredWisdomStore**: 警告ログにおけるパターン名の表示バグ修正。
3. **ErrorClassifier**: プロバイダー一時エラーのエスカレーションメッセージの具体化。

## 2. Design Decisions

| 項目 | 修正内容 |
|---|---|
| TieredWisdomStore 秘密検知 | `add` メソッドにおいて秘密が検知された場合、`globalStore.add` をキャンセルし、`localStore.add` へフォールバックすることで機密情報の漏洩を防ぐ。 |
| 警告ログ表示 | `SecretPatternDetector.scan()` がオブジェクト配列を返すため、`detected.map((m) => m.name).join(", ")` を使用してパターン名を正しく表示する。 |
| エスカレーションメッセージ | `ErrorClassifier.getEscalationMessage` の `provider_transient` ケースを設計書（2026-04-19-error-classifier...）の文言に合わせる。 |

## 3. Implementation Details

### TieredWisdomStore.ts
```typescript
// 修正後
if (detected.length > 0) {
  const warnMessage = `... ${detected.map((m) => m.name).join(", ")} ...`;
  // ... logging ...
  return this.localStore.add(entry); // 秘密検知時はローカルへフォールバック
}
return this.globalStore.add(entry);
```

### ErrorClassifier.ts
```typescript
// 修正後
case "provider_transient":
  return (
    "The task failed due to a transient provider issue (rate limit, quota, or service " +
    "unavailability) that exhausted the harness's automatic retries. Wait a few minutes " +
    "before re-delegating, or try a different `category` to switch to an alternative model."
  );
```

## 4. Verification Plan
- `TieredWisdomStore` のテストを修正し、秘密検知時でも `globalStore.add` が呼ばれることを確認。
- `ErrorClassifier` のテストでエスカレーションメッセージのアサーションを更新。
