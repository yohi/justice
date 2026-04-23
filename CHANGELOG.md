# Changelog

## Unreleased

### ⚠ BREAKING CHANGES

* **core:** The `createGlobalFs()` API in `src/index.ts` has been changed from synchronous to asynchronous. Its return type is now `Promise<CreateGlobalFsResult | null>` instead of `{ justiceDir: string; wisdomPath: string } | null`.

### Features

- **opencode-plugin:** add `@yohi/justice/opencode` subpath export with `OpenCodePlugin` entrypoint and `OpenCodeAdapter` runtime bridge for the current OpenCode plugin API.
- **runtime:** add `OpenCodeAdapter` lazy initialization, fail-open hook boundaries, compaction injection, and loop-error mapping via generic `event` handling.
- **core:** add `LOOP_ERROR_PATTERNS` and `matchesLoopError` for session loop detection.
- **Cross-Project Wisdom Store**: introduce `TieredWisdomStore` and `SecretPatternDetector`. Wisdom entries categorized as `environment_quirk` or `success_pattern` are auto-promoted to a user-global store at `~/.justice/wisdom.json` (configurable via `JUSTICE_GLOBAL_WISDOM_PATH`), while `failure_gotcha` and `design_decision` remain project-local. Any entry flagged by `SecretPatternDetector` as potentially containing secrets will **trigger a warning and have its global promotion cancelled** (falling back to project-local store) to prevent cross-project leakage. Callers can override routing via `{scope: "local" | "global"}`. Reads prefer the local store and fill the remainder from the global store.
- `FileWriter.rename(from, to)` and `FileWriter.deleteFile(path)` interfaces plus `NodeFileSystem.rename()` / `NodeFileSystem.deleteFile()` implementations (path-traversal safe).
- `WisdomStore.getAllEntries()`, `WisdomStore.getMaxEntries()`, and `WisdomStore.fromEntries()` (pure additions).
- `WisdomPersistence.saveAtomic()`: load-merge-write using a temp file and atomic rename (existing `save()` preserved for backwards compatibility).
- `JusticePlugin.getTieredWisdomStore()`: exposes the tiered store. `getWisdomStore()` remains unchanged and returns the local store.

### Notes

- Existing local entries are **not** migrated automatically. New writes follow the category heuristic.
- Global store initialization is fail-open: when `HOME` is unavailable or `mkdir` fails, the plugin starts with an in-memory NoOp global persistence and logs a warning. Local wisdom behavior is unaffected.

## [2.0.0](https://github.com/yohi/justice/compare/v1.1.0...v2.0.0) (2026-04-23)


### ⚠ BREAKING CHANGES

* **core:** createGlobalFs API の非同期化とエラーハンドリング強化

### Features

* add TUI toast notification when plan context is injected ([7d3e8ee](https://github.com/yohi/justice/commit/7d3e8ee915a5f128c43b4e1a032bc9240abb4d37))
* **core:** createGlobalFs API の非同期化とエラーハンドリング強化 ([a6a19fb](https://github.com/yohi/justice/commit/a6a19fb0239d792c8f6f9300dccb2397e3a52262))
* **core:** FileWriter に rename/deleteFile を追加 ([260d875](https://github.com/yohi/justice/commit/260d87527b0118b7c3cdc3215c3b442728afbade))
* **core:** FileWriterにrename()とdeleteFile()を追加しNodeFileSystemで実装 ([219ddfc](https://github.com/yohi/justice/commit/219ddfce6b745393c0f8cc96d0d908489ea7c5d6))
* **core:** JusticePluginにcreateGlobalFs()ヘルパーを追加 ([3fb9469](https://github.com/yohi/justice/commit/3fb9469fbf360b464c130c7c55834f2bfe968cb3))
* **core:** loop error pattern モジュールを追加 ([689231b](https://github.com/yohi/justice/commit/689231b8e1f77710eca13c28e59a7b6e977e9fdd))
* **core:** SecretPatternDetectorを新規追加（秘密パターン照合） ([cf07f76](https://github.com/yohi/justice/commit/cf07f769c12a038a6be727e1de2c4fbfba4cc1b8))
* **core:** TieredWisdomStoreにgetRelevant/getByTaskId/loadAll/persistAllを追加 ([8150a9d](https://github.com/yohi/justice/commit/8150a9d434621c178f108df486c3653e829d1bb9))
* **core:** TieredWisdomStoreを新規追加しカテゴリヒューリスティックで振り分け ([5f2ab6e](https://github.com/yohi/justice/commit/5f2ab6e5c8c4f45a2db38ced411d9968ef863410))
* **core:** WisdomPersistenceにsaveAtomic()を追加しtemp+renameで永続化 ([2e2ff76](https://github.com/yohi/justice/commit/2e2ff7635fc99f92046fd92d3bdc507ecb9e7de6))
* **core:** WisdomStoreにgetAllEntries/getMaxEntries/fromEntriesを追加 ([2c4115d](https://github.com/yohi/justice/commit/2c4115d5cfd60a12b404eacf4d9ec5cb904457a1))
* **core:** プロバイダエラー分類と賢明さストアの強化 ([c40d070](https://github.com/yohi/justice/commit/c40d07010688f79265e8dfa68a4fa172e657c9e9))
* **filewriter:** FileWriterの堅牢性を向上 (deleteFileのENOENT無視、renameでのディレクトリ自動作成) ([a7e3547](https://github.com/yohi/justice/commit/a7e35474f39d71d1833a09541f8cd9e78e0a6ba2))
* implement createGlobalFs and NoOpPersistence for global wisdom store ([4bb49dd](https://github.com/yohi/justice/commit/4bb49dd1f34b52db6ba7a1f721b93a3fa7a42bf0))
* **index:** TieredWisdomStoreとSecretPatternDetectorをexportに追加 ([143e023](https://github.com/yohi/justice/commit/143e023c2e685b6d1ff4b3c06295e6bd67ac7517))
* integrate TieredWisdomStore into JusticePlugin ([cd56627](https://github.com/yohi/justice/commit/cd56627a53391b0af7aaa961e24e20da31478613))
* make OpenCodePlugin the default export for automatic installation ([c51f480](https://github.com/yohi/justice/commit/c51f480f166d313aba55b3979b5c8de9ebdeeb1d))
* **plugin:** justice-plan-bridgeフックの追加と初期化処理の改善 ([6676b57](https://github.com/yohi/justice/commit/6676b5763e49e6f09916d118f2e298864df2639e))
* **runtime:** OpenCode plugin entrypoint を追加 ([d9791d1](https://github.com/yohi/justice/commit/d9791d1346387513cc7233724fce2c6aa21ff693))
* **runtime:** OpenCodeAdapter 와 runtime テスト基盤を追加 ([c875378](https://github.com/yohi/justice/commit/c8753788b9055bf4ba1ca099bf47513b7cbefcdb))
* **runtime:** OpenCodeAdapter のテスト容易性向上と初期化処理の改善 ([61e1f85](https://github.com/yohi/justice/commit/61e1f85d630a6a0fd1ed148a15839e1003ea9b2e))
* **runtime:** OpenCodeLogEntry型をエクスポート ([d850d9f](https://github.com/yohi/justice/commit/d850d9f33c788f51ea031f99315ee800fe5139a3))
* **runtime:** トースト通知をインジェクション後に表示 ([4e9d262](https://github.com/yohi/justice/commit/4e9d262471bab39307da87620df27e993d81298f))
* **runtime:** ワークスペースルートのフォールバックと初期化ロジックの改善 ([787080f](https://github.com/yohi/justice/commit/787080f2215913126a259055aef3080e1487edf8))
* **wisdom-persistence:** アトミック保存のための堅牢なファイルロックとパス検証を実装 ([3c58fda](https://github.com/yohi/justice/commit/3c58fda5f271e8378c5d99814036a147c7e8158d))
* **wisdom-store:** cross-project wisdom store の実装計画を追加 ([d84e3f0](https://github.com/yohi/justice/commit/d84e3f035400da68195a58128b63be8826c192cd))


### Bug Fixes

* **core:** fix type errors in feedback-formatter ([2e3e171](https://github.com/yohi/justice/commit/2e3e171bdb296229ea78b7f23d874bf511a2eb79))
* **core:** JUSTICE_GLOBAL_WISDOM_PATH におけるルートパスのバリデーション回避を修正 ([305e8aa](https://github.com/yohi/justice/commit/305e8aa2795835671384ab31aac64771b603a354))
* **core:** JUSTICE_GLOBAL_WISDOM_PATH の空パス入力を拒否 ([ce7263b](https://github.com/yohi/justice/commit/ce7263b6e5773671c906287020668884ba71c94f))
* **core:** move quota error patterns to transient classification ([7d3954a](https://github.com/yohi/justice/commit/7d3954ae8d23f5d52df3fdce325ee117a4722b93))
* **core:** preserve-caught-error ルールに従い、新しいエラー作成時に元のエラーを cause として渡すように修正 ([337621a](https://github.com/yohi/justice/commit/337621a608de2fb016a67e47983e1bfae907a171))
* **core:** throw inside finally を回避し、エラーオブジェクトの型安全性を向上 ([242797f](https://github.com/yohi/justice/commit/242797f5f814fc40d07bc094c9e0120940532c8e))
* **core:** TieredWisdomStore: 秘密検出時にグローバルストアへの保存をキャンセル ([b0e2bfa](https://github.com/yohi/justice/commit/b0e2bfaa2f782cfae6d26e37b298bc86ac80f058))
* **core:** TypeScript の型エラーを修正（WisdomScope インポート先、NoOpPersistence 型定義） ([974bd37](https://github.com/yohi/justice/commit/974bd3776532c59cdbf9a9a51b4dc8c7f600c572))
* **core:** Windows環境での無限ループと WisdomStoreInterface の型不備を修正 ([4d3d13f](https://github.com/yohi/justice/commit/4d3d13f5e48b59a27bba9d7e82bacbd6ab7646d4))
* **core:** Wisdom Store の秘密検出時グローバル昇格を警告ログへ変更、モデル未サポートパターン追加 ([884ab95](https://github.com/yohi/justice/commit/884ab9569ab26b901a81dbed23ed99845af8dd08))
* **core:** WisdomPersistence のアトミック保存とファイルシステム操作の堅牢性を向上 ([dd0f0cf](https://github.com/yohi/justice/commit/dd0f0cf3f811c351d4ed2085ead7e7031e3885c3))
* **core:** WisdomStore で不正エントリのフィルタリングとスナップショット返却を実装 ([4a7cc12](https://github.com/yohi/justice/commit/4a7cc122f84eaa029b0f0f557969035e40198e7e))
* **core:** wisdomストアのデシリアライズとロック処理の改善 ([de495a6](https://github.com/yohi/justice/commit/de495a629ff4653ddda599332df4b155dea7da97))
* **core:** Wisdom永続化処理の堅牢性とセキュリティを改善 ([1bbfe9e](https://github.com/yohi/justice/commit/1bbfe9ed7de95c1da76772cc4e4ca9911418ea9a))
* **core:** クォータ関連エラーの分類をプロバイダー設定に修正 ([88ef3f9](https://github.com/yohi/justice/commit/88ef3f9bc5d70079c4fd4ca5edd3905024866a12))
* **core:** グローバルWisdomストアのシークレット漏洩防止とGateway Timeoutパターンの追加 ([e1b05e7](https://github.com/yohi/justice/commit/e1b05e71944db2fccef01a33d3672cfdb53460ad))
* **core:** グローバルストアの安全性向上、耐障害性の改善、およびドキュメント・テストの整合性確保 ([17e5d57](https://github.com/yohi/justice/commit/17e5d57c2942a0e4ae77561f0ed88c2796f4a043))
* **core:** コードレビュー指摘に基づく永続化ロジックの堅牢化とセキュリティ改善 ([5422518](https://github.com/yohi/justice/commit/54225187892a103764b44dd323d30221b34ab984))
* **core:** ループエラー検出の正規表現を改善 ([23095af](https://github.com/yohi/justice/commit/23095af0d2d387f03d8a35a7c2906252a08bfaee))
* **core:** ロギングの例外保護強化、NoOpPersistence の修正、および SPEC の同期 ([444dbb7](https://github.com/yohi/justice/commit/444dbb72cf6c8b236ef9c5d0dfb5bf86bdc6f426))
* **core:** 修正したfinallyブロック内の未使用変数によるlintエラーを修正 ([61a07f2](https://github.com/yohi/justice/commit/61a07f262fa76b2aa75c37577cf04ac965dfffe8))
* **core:** 同一ホスト上のロックのStale判定ロジックを修正 ([efa96f5](https://github.com/yohi/justice/commit/efa96f5635b1dd46a7922a9dfa5ae2996b2e7277))
* **core:** 永続化ロック処理とファイルシステムパス操作の安全性を強化 ([05ac978](https://github.com/yohi/justice/commit/05ac978a70f58938f5b22883240a737097ee9831))
* **core:** 知恵の永続化ロック取得とエントリマージの修正 ([40f49f8](https://github.com/yohi/justice/commit/40f49f8e30bb517dfa66d21b3e47fb02cd42c23c))
* **core:** 秘密パターン検出の精度向上とインターフェースの活用 ([4807092](https://github.com/yohi/justice/commit/48070925ce731de877f0621a950f2e5e27603abc))
* **core:** 階層化知見ストアの統合と初期化漏れの修正 ([5a7c3ca](https://github.com/yohi/justice/commit/5a7c3ca1fa9dface8f2de4976ac2ae447c5fd123))
* ESLintエラーの解消とセキュリティ警告への対応、およびコードレビュー指摘の反映 ([0d42e73](https://github.com/yohi/justice/commit/0d42e737595634ab52cda1c103c28584435d2a6a))
* **eslint:** テストファイルにおけるセキュリティルールの調整 ([0a979b4](https://github.com/yohi/justice/commit/0a979b45fa2d06c981ee34a9545129c0e3ebc1b8))
* **lint:** ESLint のエラーと警告を修正（未定義ルール、未使用インポート、型定義の改善） ([863a62c](https://github.com/yohi/justice/commit/863a62c0e0268f39311fb30b91e0a81c6f555110))
* **lint:** eslint-plugin-security を導入し、Codacy の指摘（非リテラルパス）を抑制 ([243673a](https://github.com/yohi/justice/commit/243673ac372fc7343794445395e35cde47a3a845))
* **opencode-plugin:** handleHookの初期化エラーを隠蔽しないよう修正 ([0bce07a](https://github.com/yohi/justice/commit/0bce07aab9c3de3e411545ce1b026f362c9fe0b8))
* **opencode-plugin:** handleHookの統合とREADMEの更新 ([13fc1c9](https://github.com/yohi/justice/commit/13fc1c9d8a5a84421716b8584ddc2f1319982cf4))
* **opencode-plugin:** isOpenCodePluginInit型ガードを導入し、handleHookの安全性を向上 ([7918b1e](https://github.com/yohi/justice/commit/7918b1eb0f803a9f681fdba88191c6cf094502e2))
* **opencode-plugin:** lintエラー（anyの使用と未使用変数）を修正 ([11b16bb](https://github.com/yohi/justice/commit/11b16bbceb3922a00a98cdc472e2b074bbb5d465))
* **opencode-plugin:** pluginInstanceの暗黙のany型エラーを修正 ([495510d](https://github.com/yohi/justice/commit/495510d03ae5b7c810dee916ddf3ff336da30a55))
* **opencode-plugin:** オプショナルチェイニングを使用してバリデーションを簡略化 ([f351a6f](https://github.com/yohi/justice/commit/f351a6f11bd6549f955d3031715634cbc2e41bcf))
* **opencode-plugin:** プラグイン初期化のエラーハンドリングとリトライ機構を改善 ([ec9f8a8](https://github.com/yohi/justice/commit/ec9f8a8166d8396681c738d058971ea8124a267d))
* **provider-error-patterns:** 支払い・利用上限関連のエラーパターンをconfigに移動 ([bb4fe06](https://github.com/yohi/justice/commit/bb4fe060524f1027b5383735f09144c1dcb00845))
* remove unnecessary role check in plan-bridge (codacy warning) ([f0fe49a](https://github.com/yohi/justice/commit/f0fe49a6e93ee8684ef63b551e6bf08e390cd79c))
* resolve architecture and design discrepancies in wisdom store and error classifier ([a886d42](https://github.com/yohi/justice/commit/a886d4258a3abb5e2721d6458fb942d5e5e3f0cb))
* resolve code review comments and ESLint error in TieredWisdomStore ([a6de25f](https://github.com/yohi/justice/commit/a6de25fffcf106336efd5ebd7c8e63cff8c079e8))
* resolve documentation discrepancies in TieredWisdomStore and ErrorClassifier ([71e3954](https://github.com/yohi/justice/commit/71e3954846d79aba843087e35cc6fe8dd3c6f9a7))
* restore use of globalDisplayPath to fix typecheck error ([7798edc](https://github.com/yohi/justice/commit/7798edcc2f672ecbe80a1a3f570f3593c792143d))
* **runtime:** init.project.rootへのアクセスを修正 ([6f2b024](https://github.com/yohi/justice/commit/6f2b0249ace1e2ae547aa68a2f30cc17cf4dc010))
* **wisdom:** Codacyの指摘（不要なNull合体演算子）を修正 ([c2f6826](https://github.com/yohi/justice/commit/c2f682668ab448c3b665a75cb326e876e37059a4))
* **wisdom:** deserialize() において maxEntries の制限を遵守するように修正 ([81a4bad](https://github.com/yohi/justice/commit/81a4bad47da2fbad5c41f33fe247f25a5d2bb0c3))
* **wisdom:** staticメソッドのバインド解除に伴う不具合とデータ欠落の修正 ([325bf7c](https://github.com/yohi/justice/commit/325bf7cb1b79b2a7648a2ecbfa18679ab3384d2d))
* **wisdom:** WisdomStore の型安全性向上と配列操作の最適化 ([c72e061](https://github.com/yohi/justice/commit/c72e061140804f458c660f551bf12d901b98bec4))
* **wisdom:** 秘密情報検知の厳格化とグローバル昇格時の保護および注入優先順位の適正化 ([8143973](https://github.com/yohi/justice/commit/81439735016eede84cef6d4bc7cfd759582e3194))
* テスト結果パースの信頼性向上と型安全性の強化 ([0dced5f](https://github.com/yohi/justice/commit/0dced5fccb60dc5db32402861354b9a9f82eafd4))
* 依存関係解析、テスト結果解析、OpenCodeアダプターの修正と改善 ([3f798d1](https://github.com/yohi/justice/commit/3f798d129c6c98b6ef3fdcc8020ce0f29b6546e8))
* 型チェックエラーの解消とCI環境での型定義参照の問題を修正 ([434abc3](https://github.com/yohi/justice/commit/434abc3087c4c7cbdcf3b76c8aa867722df425b0))

## [1.1.0](https://github.com/yohi/justice/compare/v1.0.0...v1.1.0) (2026-04-19)


### Features

* **core:** ErrorClassifier にプロバイダエラー分類機能を追加 ([5ec033b](https://github.com/yohi/justice/commit/5ec033b001ab75fc7aa817f35307a0c797db74e0))
* **core:** ErrorClassを拡張しprovider_transient/provider_configを追加、パターンファイル新規作成 ([def43bc](https://github.com/yohi/justice/commit/def43bce76881709d1a637dea5d4818427751632))
* **core:** OmOランタイムエラーのプロバイダエラー分類を実装 ([ebb0880](https://github.com/yohi/justice/commit/ebb0880c160401a006efafba5640e53afaf92391))
* **core:** エラー分類器にプロバイダーコンテキストの処理を追加 ([06912a2](https://github.com/yohi/justice/commit/06912a21f8f81a28b98852fea2e3f87f4c51faf9))
* **core:** プロバイダーエラーの分類と処理を追加 ([f940898](https://github.com/yohi/justice/commit/f94089835a637e0fbbd223c513f3a9f6e1953811))
* **core:** プロバイダーコンテキスト対応エラー分類 ([13f1160](https://github.com/yohi/justice/commit/13f1160827bc236b5433922e52c1f7692772c547))
* **core:** プロバイダーのエラー分類機能強化とパターン更新 ([926bea0](https://github.com/yohi/justice/commit/926bea0d0b36a8c924fe9a8d40c786a8e0f11731))
* **error-classifier:** プロバイダエラーの分類ルールとエスカレーションメッセージを追加 ([8bd93b6](https://github.com/yohi/justice/commit/8bd93b67a34271f83de8f2962460c1f9f4372da6))


### Bug Fixes

* **core:** provider_transient エラーメッセージに自動リトライ無効化を追記 ([ab10069](https://github.com/yohi/justice/commit/ab1006907df42dc42601ee1dff239f79f540a4c6))

## 1.0.0 (2026-03-24)


### Features

* **core:** CategoryClassifierの実装 — タスクカテゴリの自動選択 ([d754565](https://github.com/yohi/justice/commit/d7545654ae3e75bc9cfe8b2e1c1ed73b25a697d6))
* **core:** DependencyAnalyzerの実装 — タスク依存関係の解析と並列実行可能判定 ([37e269f](https://github.com/yohi/justice/commit/37e269f17cdded467e0d79d8fac7b305bb8e46cc))
* **core:** FeedbackFormatterを追加 — task()出力をTaskFeedbackに構造化 ([8e72edf](https://github.com/yohi/justice/commit/8e72edf468beef8a757c03449cb562c9be51da24))
* **core:** JusticePluginオーケストレーターの実装 — イベントルーティングと共有状態管理 ([35e8eee](https://github.com/yohi/justice/commit/35e8eee8518c33d7e73bccc6ee2325f6ca40e300))
* **core:** LearningExtractorを追加 — TaskFeedbackからの学習抽出 ([408cfbe](https://github.com/yohi/justice/commit/408cfbed3768a8620302e1f7149a48689c4e9c2d))
* **core:** PlanBridgeCoreを追加 — plan解析からDelegationRequest生成 ([9290b0a](https://github.com/yohi/justice/commit/9290b0ab9fae28906ae64cac1ff3a05a19613203))
* **core:** ProgressReporterの実装 — 進捗レポート生成 ([b0d1914](https://github.com/yohi/justice/commit/b0d19141b4fd047d446207bc40f4cc9c0120ba5c))
* **core:** SmartRetryPolicyを追加 — 指数バックオフとコンテキスト縮小 ([ad4d5cf](https://github.com/yohi/justice/commit/ad4d5cf230c2f04250fee9a7d49d0df54696324a))
* **core:** StatusCommandの実装 — プラン進捗・依存・並列タスクの構造化レポート ([f3c8990](https://github.com/yohi/justice/commit/f3c89908b3510e4201ff1282f9df50de2f59690b))
* **core:** TaskSplitterを追加 — 失敗タスクの自動分割指示生成 ([6cad589](https://github.com/yohi/justice/commit/6cad5894fb73cdf71043491c9123fcdb7a8969bc))
* **core:** TriggerDetectorを追加 — plan.md参照と委譲意図の検出 ([3085881](https://github.com/yohi/justice/commit/3085881eb9d3f76358416d638e5715397511f07c))
* **core:** WisdomPersistenceを追加 — 学習データのファイル永続化 ([cdcb0cc](https://github.com/yohi/justice/commit/cdcb0cc8a30bcb5fa20292d6af8854cce22b5789))
* **core:** WisdomStore型定義とインメモリストアを追加 ([8cab3fd](https://github.com/yohi/justice/commit/8cab3fd60baa1a27dc76009c0ae24d066591b4fa))
* Devcontainer環境の構築 ([75c4ced](https://github.com/yohi/justice/commit/75c4ced09ae11864f87bcee2daeae671bcde713b))
* ErrorClassifierおよびCompactionProtectorの実装 ([93ce000](https://github.com/yohi/justice/commit/93ce0005c853f7201e29d10a4f1cc2736e0dd5a4))
* **hooks:** CompactionProtectorの学習保護を強化 ([a8b85b2](https://github.com/yohi/justice/commit/a8b85b2fe9fe6c16d42235e0a12c21d250110770))
* **hooks:** LoopDetectionHandlerを実装 — loop-detectorイベント統合 ([ebacc01](https://github.com/yohi/justice/commit/ebacc011768880328bca3bb9cf4d94203202dd3c))
* **hooks:** PlanBridgeに学習データの注入を統合 ([21a65fe](https://github.com/yohi/justice/commit/21a65fe3828a753fcd9016f3145cf2492795f88f))
* **hooks:** PlanBridgeの並列委譲・カテゴリ自動選択・進捗レポートの統合 ([82c6818](https://github.com/yohi/justice/commit/82c681888e19615170b26be288a2f2d5cad9b732))
* **hooks:** PlanBridgeフックを実装 — Message/PreToolUseイベントハンドリング ([7c5b7bb](https://github.com/yohi/justice/commit/7c5b7bbd134b4678771c2b3c8421faad61024a8c))
* **hooks:** TaskFeedbackHandlerに学習抽出・蓄積を統合 ([53af1c3](https://github.com/yohi/justice/commit/53af1c38607b103c754da9850f61e88fd424f32f))
* **hooks:** TaskFeedbackHandlerへSmartRetryとTaskSplitterを統合 ([1ac4719](https://github.com/yohi/justice/commit/1ac47190b92a316ab91ff517f37fbd2c350a70e8))
* **hooks:** TaskFeedbackHandlerを実装 — PostToolUseのフィードバックループ ([689d22d](https://github.com/yohi/justice/commit/689d22df49c0dc09210033c229da8ae7641f48a0))
* **index:** Phase 5のエクスポート追加 + Wisdomインテグレーションテスト ([5ec3a4f](https://github.com/yohi/justice/commit/5ec3a4f06b2b5e107224daa107612fc6f2ee0a11))
* **integration:** Phase 6 エクスポートとマルチエージェント連携フローのテスト完了 ([e6aa98b](https://github.com/yohi/justice/commit/e6aa98ba949eb9797656e9856bc334c2927c0b51))
* **integration:** Phase 7エクスポート追加 + プラグインオーケストレーターフローのテスト完了 ([fff015d](https://github.com/yohi/justice/commit/fff015d394b05ae8eed418ab6199117f15a8d2f8))
* Phase 7 Plugin Orchestrator & Runtime Integration ([0af60e0](https://github.com/yohi/justice/commit/0af60e02803a876febe8af6d369da399a030a8d6))
* PlanParserおよびTaskPackagerの実装 ([567e598](https://github.com/yohi/justice/commit/567e598ed257f9564d502a9ec55ac84bf8d473bc))
* **runtime:** NodeFileSystemの実装 — Node.js fsベースの実ファイルシステムアクセス ([ff12d90](https://github.com/yohi/justice/commit/ff12d90cb61d719ba4409c291a82c1b939368e62))
* **types:** OmO Hook API型定義とFileReaderインターフェースを追加 ([80659e5](https://github.com/yohi/justice/commit/80659e51b32ecb4ad0486dfbce10d7e068fdf75e))
* **types:** PostToolUsePayload・FileWriter・FeedbackAction型を追加 ([3aabd68](https://github.com/yohi/justice/commit/3aabd68eae6a2e1be2a3f9f756c9a9de0055eae3))
* エントリポイント・AGENTS.md・READMEの追加 ([68bd1dc](https://github.com/yohi/justice/commit/68bd1dc4fdaee6d7f647b530c89b8530c21c16cf))
* コアデータモデルの型定義とテストフィクスチャの追加 ([61061d3](https://github.com/yohi/justice/commit/61061d3c04726cf61a63112054de329384995bf4))
* プロジェクト足場の構築 (package.json, tsconfig, vitest, eslint) ([b0a306e](https://github.com/yohi/justice/commit/b0a306e05b1da042f70fd4c73967bf632bc319de))


### Bug Fixes

* **core/hooks:** スマートリトライとタスク分割の不整合を修正、型安全性の向上 ([70d2790](https://github.com/yohi/justice/commit/70d27908f1c6b04be77fd671d9dd458129674be4))
* **core:** 認証情報マスキングの token 形式対応と依存関係警告の整合性向上 ([fdc5e01](https://github.com/yohi/justice/commit/fdc5e01417ab876633cc6ded69eac8fa7dc1d11b))
* **core:** 認証情報マスキングの改善と依存関係解析の警告追加 ([5725677](https://github.com/yohi/justice/commit/5725677036db3e4639489dd02a79d7d4b621f459))
* **hooks:** TaskFeedbackHandlerの指摘事項修正とテストの改善 ([0c33cd5](https://github.com/yohi/justice/commit/0c33cd58c6b7fdff4eff2de6063be1c03d72af97))
* JusticePlugin のエラーハンドリング保護と CompactionProtector の状態クリア処理の追加 ([09e188a](https://github.com/yohi/justice/commit/09e188a383b0cfa144760593e246c5cc5f365198))
* JusticePlugin の競合状態防止とエラーハンドリングの改善 ([14eecc3](https://github.com/yohi/justice/commit/14eecc3310b9ed89ecd55f0d696d872fe3edebe9))
* **lint:** remove unused variables to pass strict linting ([405a1be](https://github.com/yohi/justice/commit/405a1be530d24a9f70bcebca89d520d8576fa4fe))
* **plan-bridge:** パス正規化の許容とエラーハンドリングの精度向上 ([8077e35](https://github.com/yohi/justice/commit/8077e358388840bdc7627cbd705c124e4d8ce963))
* **plan-bridge:** ファイルI/Oエラー時のフェイルオープンとパス検証強化 ([a51975d](https://github.com/yohi/justice/commit/a51975d27931bea4e0adfd4679d227c5b648836d))
* PlanParserとTaskPackagerの設計改善 (エラーノートのフォーマット、タスク抽出ロジック、言語の統一) ([e552e7b](https://github.com/yohi/justice/commit/e552e7b0c3d0fda9530531252f5326a040715b1d))
* **test:** remove unused variables to pass lint ([2f8653f](https://github.com/yohi/justice/commit/2f8653f064d33902bd8ca687494f10c18e69da91))
* **types:** typecheck警告修正 + EventPayload型を具象化 ([6321fda](https://github.com/yohi/justice/commit/6321fda60e759c035fce54c49ed3c11cfe2b1b37))
* **wisdom:** 学習データのサニタイズ処理（秘匿情報のマスクと最大長制限）を追加 ([0cf9419](https://github.com/yohi/justice/commit/0cf9419a9913fba977e95ec77d2326467569fb5d))
* **wisdom:** 学習抽出時のタイムアウト対応とインポート/エクスポートの整理 ([e9beefb](https://github.com/yohi/justice/commit/e9beefb40af4f781de2e7fa1edf8fb3e762c255c))
* **wisdom:** 指摘事項の修正（シグネチャ整理、バリデーション追加、重複排除、テスト修正） ([177f6a3](https://github.com/yohi/justice/commit/177f6a3f5a6a9f83ff9e9ffeb109c06cc9657f8f))
* チェックボックスパースの不整合およびsetActivePlanのバリデーション修正 ([23a8954](https://github.com/yohi/justice/commit/23a8954beb96c7132de8bf26044c1c00c7c9d9c6))
* レビュー指摘事項の反映 (Dockerfile, .gitignore, plan-parser, task-packager, 等) ([68c2621](https://github.com/yohi/justice/commit/68c262106eb349b07665224f49500b52d6c6117f))
* 依存関係・ファイルアクセス・オーケストレーター等の修正（追加指摘分） ([788b3f6](https://github.com/yohi/justice/commit/788b3f65cfeb2251c64a8735dbb16f5fc2e9bac3))
* 依存関係・ファイルアクセス・学習抽出等の修正 ([d86d15c](https://github.com/yohi/justice/commit/d86d15c62f238db8e0b1ae5227e6221d2c48dd7e))
* 依存関係の解決とエラーハンドリングの改善 ([6620ca4](https://github.com/yohi/justice/commit/6620ca457e53b55ab2604e2e5f6e6f3debe46821))
* 追加のレビュー指摘事項を反映 (エラー分類のガード、不変ポリシー、安全なフェンス、マークダウン見出し) ([416e807](https://github.com/yohi/justice/commit/416e80772d09eadcbd9936f31e65600989b72c5d))
