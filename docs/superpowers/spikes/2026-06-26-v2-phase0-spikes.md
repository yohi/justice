# v2.0 Foundation Phase 0 De-risk Spikes — 実施結果（ベストエフォート）

| 項目 | 値 |
|---|---|
| 実施日 | 2026-07-08 |
| 対応計画 | [`SPEC.md §15.12`](../../../SPEC.md#1512-既知の未解決事項・ガバナンス状況重要) Task 0.2 |
| 実施環境 | サンドボックス環境（実機 OpenCode 上での動作確認は不可）。可能な範囲でベストエフォート実施。 |

## 背景

Task 0.2（3つの De-risk スパイク）は、Phase 1〜2（`feature/phase1-*`, `feature/phase2-*`, PR #117〜#129）の実装着手より前に完了している前提だったが、`feature/phase0-task2-v2-spikes` ブランチは実際には一度も作成されず、未実施のまま Phase 1 に進んでいたことが判明した（doc-sync レビューで検出）。本ドキュメントは、実機 OpenCode を用いた完全な実証はサンドボックス環境から実行できないため、**可能な範囲での代替実証（ベストエフォート）**として事後的に作成する。

---

## Step 1: 全ツール `tool.execute.after` 観測レイテンシ実測

### 実施内容と制約

計測時点では Phase 4（observation-handler）が未実装で、実際の `tool.execute.after` フックから v2 Evidence engine / Observation Log が呼ばれる経路は存在しなかった。その後、全ツール観測経路は実装済みである（`src/opencode-plugin.ts` / `src/runtime/opencode-adapter.ts`）。したがって、ここで記録する数値は旧 write queue 実装に対する履歴値であり、現行実装のエンドツーエンド性能を示すものではない。

計測スクリプト: [`spikes/observation-latency/measure.ts`](../../../spikes/observation-latency/measure.ts)

```bash
bun run spikes/observation-latency/measure.ts
```

### 実測結果（同一 shard への 100 回連続 append）

| 指標 | 値 |
|---|---|
| mean | 43.6 ms |
| p50 | 19.3 ms |
| p95 | 142.1 ms |
| p99 | 339.6 ms |

### 分析

計画の目標「p95 < 数 ms / tool 呼び出し」は**未達**。原因は `src/runtime/write-queue.ts` の `atomicAppend()` が **append 毎に既存ファイル全文を読込 → 追記 → temp+rename** する read-modify-write 方式（コード内コメントで「atomicity を throughput より優先する意図的な設計」と明記）であるため、同一 shard 内での累積 append 件数に応じてレイテンシが線形に増大し、100 件時点で既に p95=142ms・p99=340ms に達している。5MB / 14日のローテーション閾値（`MAX_SHARD_SIZE_BYTES` / `MAX_SHARD_AGE_DAYS`, `src/runtime/observation-log-store.ts`）に達する遥か前に、高頻度なツール呼び出しがあるセッションでは無視できない遅延になり得る。

### 結論と設計書への反映

- **目標未達を記録**。ただしこの計測は後続の write queue 改修前の履歴値であり、現行経路の再計測が必要である。v2.0 は L0 advisory（非ブロッキング）であり、`ObservationLogStore.append()` はいずれも `onError` で fail-open するため機能停止には至らない。
- 対応方針（Phase 4 実装時に検討すべき事項として記録、本スパイクでは実装しない）:
  1. 同一 shard 内での append をバッチ化する、または
  2. `readExisting` を毎回ではなく初回のみ行い、以降はインメモリでバッファして定期 flush する非同期キュー方式に変更する。
- 設計書 §3 への追記提案: 「Evidence write 経路の p95 レイテンシは現行実装（read-modify-write 方式）では目標未達であり、Phase 4 着手前に write-queue のバッチ化/非同期 flush 化を検討する」。

---

## Step 1b: C1 / L0 advisory 表示面実証（D47）

### 実施内容と制約

`tool.execute.after` の `output.output` 末尾への banner 追記が実際にモデル推論文脈／ユーザー表示へ反映されるかは、**実機 OpenCode セッション上での目視確認が必須**であり、本サンドボックス環境（ヘッドレスの CLI エージェント実行環境で、対象の OpenCode ホストアプリケーションのUI/モデル文脈を観測する手段がない）からは実証できない。

### 採用する暫定方針

D47 自身が用意した保守的フォールバック（「反映不可なら notifier のみに固定する」）をこの時点では**未実証として明示的に採用**する:

- **保証チャネル**: `JusticeNotifier`（`client.app.log`）によるバナー送出のみを正式な advisory 経路として扱う。
- **未実証扱い**: `output.output` 末尾追記（best-effort）は、Phase 4 実装時に `enableAdvisoryOutputAppend` オプションの既定値を **`false`** とし、実機検証が完了するまで無効化する。
- Phase 4 着手前に、人間のレビュアーが実機 OpenCode で `output.output` 追記が反映されるかを目視確認し、その結果に応じて既定値を確定させる必要がある（本スパイクでは代替不可、要人手検証として明示的に残す）。

### 結論

**未実証（Not Verified）**。設計書 D47 の「保証度で2段に分けて定義」という記述は本スパイクの結果によっても変更せず、「(2) notifier=保証」「(1) output.output=best-effort・要実証」のまま維持する。

---

## Step 2: Message 観測 fallback matrix 実測（D41/D53）

### 実施内容と制約

実機での動的イベント捕捉（順序逆転・重複・遅延の実測）はサンドボックス環境では不可のため、代替として**設計書 §3 自身が採用した手法（`@opencode-ai/plugin` / `@opencode-ai/sdk` の型定義の静的解析）**により、D41/D53/D67 の前提を検証した。

- 対象: `node_modules/@opencode-ai/plugin` v1.14.21（設計書と同一バージョン）、`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`

### 検証結果

| 検証項目 | 結果 | 出所 |
|---|---|---|
| `message.part.updated` の payload 形状 | `properties: { part: Part; delta?: string }`。`Part` の一種 `TextPart` は `{ id, sessionID, messageID, type: "text", text, time?: {start, end?} }` を持つ。`sessionID`/`messageID` は `part` 内に埋め込まれており、イベント側で個別取得できる | `@opencode-ai/sdk/dist/gen/types.gen.d.ts` L142-155, L355-360 |
| `TextPart` の finalize 相当シグナル | `part.type==="text"` の場合、`time.end` の有無が「ストリーミング終了」の候補シグナルになりうる（`time.end?: number` は optional）。ただし `finalized: boolean` という明示フィールドは存在せず、D53/D67 が言う `finalized` は Justice 側で `message.updated`/`experimental.text.complete` と組み合わせて導出する必要がある（型定義から自明ではなく、設計の合成ロジックに依存） | 同上 L142-150 |
| `message.updated` の payload 形状 | `properties: { info: Message }`、`Message = UserMessage \| AssistantMessage`。`AssistantMessage` は `role: "assistant"`、`time: { created, completed? }`、`finish?: string` を持つ | 同上 L98-134 |
| assistant 本文確定の候補シグナル | `AssistantMessage.finish !== undefined` または `AssistantMessage.time.completed !== undefined` が「lifecycle 確定」の候補シグナルとして型上存在する。D53/D67 の「message.updated の finish 確定で finalized 化」という設計は型定義と整合する | 同上 L98-127 |
| `experimental.text.complete` の payload 形状 | 名前付きフック（`input: {sessionID, messageID, partID}`, `output: {text: string}`）。generic `event` ハンドラ経由ではなく、`Hooks` オブジェクトのプロパティとして個別登録が必要 | `@opencode-ai/plugin/dist/index.d.ts` L297-303 |
| `chat.message` の payload | `message: UserMessage` — assistant 自己申告の本文源には使えない（D41 の除外規定と整合） | `@opencode-ai/plugin/dist/index.d.ts` L183-217 |

### 結論

- D41/D53/D67 の**型レベルでの整合性は確認できた**（`message.part.updated` から `TextPart.text` を取得できること、`message.updated` の `finish`/`completed` を lifecycle 確定シグナルとして使えること、`chat.message` が assistant 本文源として使用不可であることは、いずれも型定義と矛盾しない）。
- ただし、**実行時の順序保証（part 先行 vs role 確定の到着順逆転）・重複発火・遅延の実測は本スパイクでは代替不可**（型定義には現れない実行時挙動のため）。D53/D65 の `messageRoleBuffer`（TTL・LRU・pending 保留ロジック）が本当に必要かどうかは、Phase 3 着手前に実機での短時間の観測ログ収集を推奨する。
- **フック登録状況の訂正**: `src/opencode-plugin.ts` は `"experimental.text.complete"` を個別フックとして直接登録しており、`"message.part.updated"` は汎用 `event` フックを介して `src/runtime/opencode-adapter.ts` の `onEvent()` が受け取り、`#handleMessagePartUpdated()` から Justice 内部の `message_part_updated` ペイロードへ転送している。ただし、実行時の順序保証・重複発火・遅延は依然として実測されていない。

---

## 総括

| スパイク | ステータス | 主な発見 |
|---|---|---|
| Step 1: 観測レイテンシ実測 | 実施済み（代替計測） | p95=142ms で目標未達。write-queue の read-modify-write 方式がボトルネック。Phase 4 着手前に検討要 |
| Step 1b: C1/L0 advisory 表示面実証 | **未実証**（実機検証が必須、サンドボックスでは不可） | D47 の保守的フォールバック（notifier=保証、output.output=best-effort）を暫定採用。`enableAdvisoryOutputAppend` は既定 `false` とすることを推奨 |
| Step 2: Message fallback matrix 実測 | 実施済み（型定義による静的検証で代替） | D41/D53/D67 は型レベルで整合。実行時の順序逆転/重複/遅延は未実証のまま |

**次のアクション（本スパイクの範囲外・要人手対応）**:
1. Phase 3（message-adapter）着手前に、実機 OpenCode 上で `message.part.updated`/`message.updated`/`experimental.text.complete` の発火順序を短時間収集し、Step 2 の残課題を解消する。
2. Phase 4（observation-handler）着手前に、`output.output` 追記の反映有無を実機で確認し、`enableAdvisoryOutputAppend` の既定値を確定する。
3. write-queue のレイテンシ課題（Step 1）を、Phase 4 実装計画に反映するか、許容可能と判断するかを設計レビューで決定する。
