# Changelog

## Unreleased

### Features

* **error-classifier:** recognize provider-side transient and config errors (rate limit, quota, 5xx, missing API key, model not found). Patterns ported from oh-my-openagent@3.17.4 runtime-fallback. Both classes are non-retryable; rely on OmO's `runtime-fallback` for actual retries.

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
