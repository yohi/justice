# Changelog

## Unreleased

### ⚠ BREAKING CHANGES

* **core:** The `createGlobalFs()` API in `src/index.ts` has been changed from synchronous to asynchronous. Its return type is now `Promise<CreateGlobalFsResult | null>` instead of `{ justiceDir: string; wisdomPath: string } | null`.

### Features

- **core:** role-based wisdom store with v1→v2 migration.
- **hooks:** plan-to-execution bridge with Atlas guidance.
- **hooks:** SDD review-rejection pivot to Hephaestus.
- **runtime:** toast-equivalent notifier (log + banner).
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

## [2.4.0](https://github.com/yohi/justice/compare/v2.3.0...v2.4.0) (2026-07-08)


### Features

* CodeRabbitとDependabotを追加 ([28880ee](https://github.com/yohi/justice/commit/28880ee5606243f2c1e8c4d94e56242adb03ea6b))
* coverageとSonarCloudを統合 ([1f47490](https://github.com/yohi/justice/commit/1f47490e799a1245bed639e151eb5709b6326726))
* **v2:** Core event model and observation/decision types ([76e546d](https://github.com/yohi/justice/commit/76e546dae4d56382cdda923fb1d61af97af47980))
* **v2:** Core event model and observation/decision types ([6086d50](https://github.com/yohi/justice/commit/6086d50ce733e497119c1a14658c060ae0a91b4d))
* **v2:** deterministic state projection, replay, and cache validation tests ([ffe24b8](https://github.com/yohi/justice/commit/ffe24b883eaae52cb6f68f85757827f9dfe5482c))
* **v2:** Evidence engine with source classification and declared claim extraction ([9469e74](https://github.com/yohi/justice/commit/9469e74ef450cf972618f5f337082d24befa4c92))
* **v2:** Evidence engine with source classification and declared claim extraction ([eb088bd](https://github.com/yohi/justice/commit/eb088bd0255b3e1f0ed17e92ed9c15ca734d5212))
* **v2:** implement observation log store with strict record schema and shard sequence validation ([d240a89](https://github.com/yohi/justice/commit/d240a898b64b80ef9df47e3becb51366718e8e1c))
* **v2:** implement observation log store with strict record schema and shard sequence validation ([60eb366](https://github.com/yohi/justice/commit/60eb36638bd0eacf55758145a655e3970f1afe8b))
* **v2:** implement per-shard write queue with atomic temporary appends ([f71547b](https://github.com/yohi/justice/commit/f71547bb3bf849583cfdb9f47a7895768d7a5626))
* **v2:** Phase2 observation log store一式をmasterへ統合 (task2b-4 / PR [#125](https://github.com/yohi/justice/issues/125)-128) ([c03ff83](https://github.com/yohi/justice/commit/c03ff833e808f70824ade5d02ec57dd1db96a9c9))
* **v2:** redaction, secret redaction, and safe-segment encoding for persistence ([7800261](https://github.com/yohi/justice/commit/7800261d4855ae096050ad36437b645b0004058b))
* **v2:** redaction, secret redaction, and safe-segment encoding for persistence ([048ff05](https://github.com/yohi/justice/commit/048ff05cf29e0704ce3f6dfc11530ad60e45a502))
* **v2:** shard file layout, writer ID generation, and collision allocation ([1e2a99d](https://github.com/yohi/justice/commit/1e2a99d1ceecd6929d120999f816075d67d60859))
* **v2:** shard file layout, writer ID generation, and collision allocation ([2a3ee9b](https://github.com/yohi/justice/commit/2a3ee9bc9b2a87f5c8c7ae7d9794d6938839fe04))
* **v2:** shard rotation and archive sequence continuity ([3e3a48d](https://github.com/yohi/justice/commit/3e3a48d4cef701750a8c8615c86fcf35ac03ad9a))
* **v2:** shard rotation and archive sequence continuity ([153a8b0](https://github.com/yohi/justice/commit/153a8b0d0d5e7094a00477cb1857b3b88046ff9e))
* カバレッジと脆弱性スキャンを追加 ([629e33f](https://github.com/yohi/justice/commit/629e33fededca54cad2b34d11b44afeaa28d192e))
* 品質分析ワークフローを追加 ([b493a30](https://github.com/yohi/justice/commit/b493a30fd750906242473b7817291d0bc4efc8f2))


### Bug Fixes

* CI権限とSonarCloud実行を調整 ([eb197aa](https://github.com/yohi/justice/commit/eb197aac3bd315e81b2614515c1d469ad7ef19a3))
* Codecov patchカバレッジチェックをinformationalに変更 ([e3d8c07](https://github.com/yohi/justice/commit/e3d8c07b8cb4b158b0062e05a7a44fcb6636ed11))
* Codecovの除外設定を調整 ([6f9356c](https://github.com/yohi/justice/commit/6f9356c766eec2652a7f958102bd956babad7ed4))
* CodeQLワークフローを削除しDefault setupとの競合を解消 ([63c6435](https://github.com/yohi/justice/commit/63c6435baae65bc1e0e1d507bb4b3ee2ed013680))
* CodeRabbitレビュー指摘への対応(NaN検証/シャードキー衝突/一時ファイル残留/writerId不一致) ([529e832](https://github.com/yohi/justice/commit/529e83215f3f83a09a5f82c317331227377c4f95))
* **core:** isSafeWriterIdの予約語チェックを大文字小文字非依存に修正 ([af71101](https://github.com/yohi/justice/commit/af711013aaeb209cbcd7f9cf97e54a50101d13d9))
* **core:** ObservationAgentIdのallowlistをコンパイル時網羅性チェック化 ([1f31fd7](https://github.com/yohi/justice/commit/1f31fd762f9dddf43124b25ea4a2b917ab9a8ea6))
* **core:** shard-layoutのtimestamp/agentId未検証によるパストラバーサル対策 ([10e9262](https://github.com/yohi/justice/commit/10e9262e3801f107d53ce2105a913b21f424a9c4))
* **devcontainer:** rootless Docker 環境で baseline を確立 ([3e78c51](https://github.com/yohi/justice/commit/3e78c5100d4cfe60f81e2bcff5d8c838159dc5f1))
* **devcontainer:** rootless Docker 環境で baseline を確立 ([0ccda4e](https://github.com/yohi/justice/commit/0ccda4e10ae3a81c8d81d9e79d450909305723cc))
* messageレコードのmessageID/finalized未検証を修正 ([b95437a](https://github.com/yohi/justice/commit/b95437ac4746c205fd63b7eab85ba60061ddd8b7))
* readAll()の行単位パースエラーで同一ファイル内の以降の行が消失する問題を修正 ([6cde49b](https://github.com/yohi/justice/commit/6cde49be7de04ae1e0edf8e16cb95dcd2730c5ee))
* **redaction:** truncate マーカー長を事前に確保し、永続化文字列が 4096 文字を超えないようにする ([a25209b](https://github.com/yohi/justice/commit/a25209ba822dfd8e864fee964ff8a6e625acd632))
* review_observed itemのsummary/location未検証を修正 ([258dce2](https://github.com/yohi/justice/commit/258dce270435a1ab72c6c1b9e70a6e2a810bf7f4))
* **runtime:** allocateWriterIdの無制限再帰をイテレーティブループに変更 ([5a603bb](https://github.com/yohi/justice/commit/5a603bb948b4203832646ffc66db3aa1dc511063))
* **runtime:** state.jsonキャッシュのwrite失敗時tmpファイルリークと検証漏れを修正 ([21cdcdd](https://github.com/yohi/justice/commit/21cdcdd222607a86b85d33dd5faf3e74db53a2f4))
* **runtime:** write-queueのrename失敗時の一時ファイルリークとsequencesマップの蓄積を解消 ([370d9d3](https://github.com/yohi/justice/commit/370d9d304d5bcceed0e225bd2803474242ce56f2))
* **runtime:** 配列sortに比較関数を指定して並び順を決定的にする ([b7a776e](https://github.com/yohi/justice/commit/b7a776ebcb860f5f4ac8dec3501045e2f7e33d1c))
* **secret-detector:** redact() で同種の秘密情報を全件マスク ([f5e776c](https://github.com/yohi/justice/commit/f5e776c39dfcf139c3c16ae7b8edcc8a2788e87a))
* **security:** 一時ファイル名の乱数生成をcrypto.randomUUIDに変更 ([75c95d4](https://github.com/yohi/justice/commit/75c95d48c183452261b360de2625a9434b996933))
* Semgrepをクラウド非依存化 ([db088ea](https://github.com/yohi/justice/commit/db088ea39c38d08cf360275062961da82af7af74))
* Snykアクションを固定 ([cfab184](https://github.com/yohi/justice/commit/cfab184b8a59bdc16d15d2447bdb06664f2b41a2))
* SonarCloud artifact パス解決 - LCOV ファイル検出失敗の修正 ([30aa486](https://github.com/yohi/justice/commit/30aa4864a2b77ad5445e21858520301cc598a232))
* SonarCloud CI permission と artifact 転送の修正 ([a015324](https://github.com/yohi/justice/commit/a015324fdd3ad7076fa94955147621c0ede9b54c))
* SonarCloud coverage artifact の持続的な保存（git checkout リセット対策） ([a69c593](https://github.com/yohi/justice/commit/a69c59364f4f1098a788bc9b7d4fbe3d641c333e))
* SonarCloud new code definition を previous_version に設定 ([38c91b9](https://github.com/yohi/justice/commit/38c91b9bbbddab73f78f0e7a53ac00a7b199eb9e))
* SonarCloud除外設定とパスフォールバックを修正 ([8abd77e](https://github.com/yohi/justice/commit/8abd77ee84cf05eba20bd7fb8934645220adfca5))
* state projection のコードレビュー指摘4件に対応 ([521b80e](https://github.com/yohi/justice/commit/521b80ec98a23988a458946bbc55cd3ec02c251a))
* state.jsonキャッシュのコードレビュー指摘4件に対応 ([e4a343f](https://github.com/yohi/justice/commit/e4a343f08bf78415754059d7b972256147dcae9b))
* **v2:** classifier のラッパー前置対応と inline-read のインタプリタ限定 ([b8acbc1](https://github.com/yohi/justice/commit/b8acbc14c1951e05512fa0fad463a37a70d78955))
* **v2:** Codecov対応 ([f1bcd38](https://github.com/yohi/justice/commit/f1bcd38b3991871fa3924584e2488d86aaa43604))
* **v2:** declared-claim の outcome 判定を fail 優先に統一 ([2367822](https://github.com/yohi/justice/commit/2367822a917aaf79bdfc23a992179e548c8df1c5))
* **v2:** declared-claim の pass/fail 語形を拡張し粗い信号スコープを明記 ([db9edb7](https://github.com/yohi/justice/commit/db9edb740f40bdae53fcef896c22bb38f88bd500))
* **v2:** declared-claim-extractor でテスト失敗検出と過去形 pass 判定を対称化 ([de6a7e1](https://github.com/yohi/justice/commit/de6a7e14b1c6c2e1138a49dcc1a6a54375b489fe))
* **v2:** evidence-engine で metadata.error を task 分岐より優先 ([628cc68](https://github.com/yohi/justice/commit/628cc686358befe08d16145bc66a6aa4a724adad))
* **v2:** OUTPUT_FAIL_PATTERN から error 語を除外し合格出力の誤分類を修正 ([b21fa21](https://github.com/yohi/justice/commit/b21fa217801be95b9012f1ae6a82916c5fa4c2f6))
* **v2:** task 出力の basis を unparsed 化し SelfEvidenceRef の kind 欠落を修正 ([01a3926](https://github.com/yohi/justice/commit/01a39264703423e53a11cdf5941b74b6bf747aad))
* **v2:** truncate() でサロゲートペア分割による不正 UTF-16 を防止 ([928bf88](https://github.com/yohi/justice/commit/928bf8876eefa516a12b981149c3062ed18c6144))
* **v2:** 未知の実行系コマンドを command_exec に分類しファイル読取と両立 ([df67ffa](https://github.com/yohi/justice/commit/df67ffa65f83fd2e393a882144450593b430344d))
* **v2:** 証拠エンジンの語彙同期・スニペットのサロゲート安全化・redaction 一元化 ([03b1ec9](https://github.com/yohi/justice/commit/03b1ec9f6417c9120f0070faff039cb396699c1a))
* コードレビュー指摘への対応(evidence型検証/NaNガード/shardパス解析の共通化) ([e427245](https://github.com/yohi/justice/commit/e4272458627c8eda2f7cc5492da689bb46b6930e))
* シャードローテーションのコードレビュー指摘3件に対応 ([046df39](https://github.com/yohi/justice/commit/046df39c04f7706e2d30d70136b75b31b598685e))

## [2.3.0](https://github.com/yohi/justice/compare/v2.2.1...v2.3.0) (2026-05-26)


### Features

* **bridge:** add PlanBridge.handlePostToolUse and merge responses in JusticePlugin ([3514761](https://github.com/yohi/justice/commit/3514761b62dc35f65925c47871ac187d635186de))
* **core:** add PlanCompletionDetector for Atlas/Sisyphus/Prometheus guidance ([eaeca38](https://github.com/yohi/justice/commit/eaeca38a23d75d1eed0df308d69e972ab56f92be))
* **core:** justice-invisible-advisor機能に向けたイベント型とプラグインロジックの拡張 ([49bb260](https://github.com/yohi/justice/commit/49bb260fd711f47a288693a8eb77fa22258ec702))
* **core:** JusticeNotifier 基盤を追加 ([79d29e3](https://github.com/yohi/justice/commit/79d29e374e2ab0003e4ad460161a2714d9d99b34))
* **core:** JusticeNotifier 基盤を追加 ([d730ed6](https://github.com/yohi/justice/commit/d730ed6f0f40727191e303bef85237e49c0bc462))
* **core:** LearningExtractor Japanese marker + TaskFeedbackHandler agent tracking ([49cdbbd](https://github.com/yohi/justice/commit/49cdbbdc1f2b68f27f9da701d303d35e2ed5a083))
* **core:** mergePostToolUseResponses for combining HookResponses ([220677c](https://github.com/yohi/justice/commit/220677c7d82f8602bedc564e388da44df3e66932))
* **core:** mergePostToolUseResponses for combining HookResponses ([f58ad3c](https://github.com/yohi/justice/commit/f58ad3c1210ec491ebe0e77f28b0269c767d5f10))
* **core:** persona-classifierにおけるsuccess_patternおよびfailure_gotchaのルーティング修正 ([354e45f](https://github.com/yohi/justice/commit/354e45f931dab21c06b89d9693f4589cc8f7a7ff))
* **core:** PersonaClassifier を追加 ([3608db4](https://github.com/yohi/justice/commit/3608db47cb2e1fba2a72f28b8360bb951d22b0e3))
* **core:** PersonaClassifier を追加 ([f2451b1](https://github.com/yohi/justice/commit/f2451b18b52a91d54058383d6cd30c19ef234df8))
* **core:** Phase 2 Task 1 - WisdomEntry persona extension and AddOptions ([d57e00d](https://github.com/yohi/justice/commit/d57e00da3a7cf42505aa2856d75716f0dc4799ec))
* **core:** PlanCompletionDetectorにA+Bハイブリッド検出機能を追加 ([d8cd879](https://github.com/yohi/justice/commit/d8cd879a62254d87000d63576f1bbb301edea3ba))
* **core:** refactor WisdomStore to Map&lt;AgentId, WisdomEntry[]&gt; ([038a998](https://github.com/yohi/justice/commit/038a99822ec8e650fe6240a470ff66adba0a3125))
* **core:** ReviewRejectionDetector を追加 ([2d35b7f](https://github.com/yohi/justice/commit/2d35b7fdf7cae4ccc8bd774160af13901eaaa236))
* **core:** ReviewRejectionDetector を追加 ([564ee76](https://github.com/yohi/justice/commit/564ee76dc91a02ee45cd3b0cffd4ea1ca9bc3685))
* **core:** TieredWisdomStore persona-aware formatForInjection ([447b6ab](https://github.com/yohi/justice/commit/447b6abfa9937e0a3f679942f9e9a15d5c9184fd))
* **core:** レビュー拒否パターンの大文字小文字区別解除とサマリー切り詰め処理の改善 ([7f95039](https://github.com/yohi/justice/commit/7f95039b505b0a87b4dd21831b48827f7b56876f))
* **learning:** add persona context and root-cause marker detection ([93dd221](https://github.com/yohi/justice/commit/93dd221781cc8e166a3b335371d7f9185dd52933))
* **loop:** add recordReviewOutput and PivotDecision for architecture pivots ([cf3408a](https://github.com/yohi/justice/commit/cf3408a876dfbd369084f614d49203942c7426d1))
* **phase4:** implement SDD native error handling gap fixes ([0b81cba](https://github.com/yohi/justice/commit/0b81cba2c2a41f6b9df43b99c9a189cd7242205f))
* **plan-bridge:** implement Atlas dynamic guidance and Sisyphus Wisdom persistence ([c422dac](https://github.com/yohi/justice/commit/c422dac3bce0e4b2a098892e9f76bcf1740f6117))
* **runtime:** add OpenCodeNotifier implementing JusticeNotifier interface ([0ffda05](https://github.com/yohi/justice/commit/0ffda05a5743fc63560e54cc7fbd970179c65b5a))
* **runtime:** wire OpenCodeNotifier into adapter and plugin options ([08fcbf1](https://github.com/yohi/justice/commit/08fcbf16cf41cc832fd067ddf2d775d91690f136))
* **wisdom:** add v1→v2 persistence migration tests ([13a14b3](https://github.com/yohi/justice/commit/13a14b3482843668ac14957d07a49fcef215018f))
* **wisdom:** add v1→v2 persistence migration tests ([be08ede](https://github.com/yohi/justice/commit/be08ede7b550a817b51f0c1217de51e72bd4fe7e))
* **wisdom:** propagate persona through TieredWisdomStore and auto-classify on add ([7442769](https://github.com/yohi/justice/commit/744276910b861544a0a44d8fd820b62d7301c605))
* **wisdom:** restructure store by AgentId and add persona field to WisdomEntry ([cf371e1](https://github.com/yohi/justice/commit/cf371e1e3f77c9f8d6f881fe0e4f8526d4c16e86))


### Bug Fixes

* address 4 code review issues including memory leak and priority logic ([c677a51](https://github.com/yohi/justice/commit/c677a511fb2851fb255790f8128e1e571e48b522))
* **bridge:** デバッグ抽出ゲートの厳密化、タスクID優先解決によるレースコンディション解消、およびエラー時の Prometheus 却下ストリーク保護 ([4e79f43](https://github.com/yohi/justice/commit/4e79f43ddb2ae0684f55cf10c92d05d3a12b021f))
* **core,hooks:** コードレビュー指摘への対応およびフォーマットの適用 ([32d754a](https://github.com/yohi/justice/commit/32d754a7ac89e58b0a1351ed88db348bfb19c4d7))
* **core:** design_error時のみルートコーズを抽出するように修正 ([c876e38](https://github.com/yohi/justice/commit/c876e3827dde90b0c3a086c88be2bea510292bdf))
* **core:** LearningExtractorでのルート原因抽出時のnullチェックを改善 ([57282d3](https://github.com/yohi/justice/commit/57282d34d9642d7b9fb78dfd5d06479a8e24ee42))
* **core:** PostToolUseイベントにおけるcallIdの伝搬とハンドリングを修正 ([80bb93f](https://github.com/yohi/justice/commit/80bb93fbaf646d8974d4221572633a428d2e0e7e))
* **core:** spec-reviewerのペルソナ推論追加およびDockerfileのuseradd修正 ([b8275f3](https://github.com/yohi/justice/commit/b8275f33d066c474b5e41d2b2a187745a5b27b92))
* **core:** v1からv2へのWisdomマイグレーション時におけるペルソナ自動判定の乖離を修正 ([eb82282](https://github.com/yohi/justice/commit/eb82282407f5c4051d99dfcdc953c4681ab26681))
* **core:** 賢知フォーマットにおけるペルソナ別ヘッダーの制御を修正 ([9711388](https://github.com/yohi/justice/commit/97113888e81882032a439c69aa198ca99d45d824))
* devcontainerユーザー作成を堅牢化 ([428b832](https://github.com/yohi/justice/commit/428b832b51f3add2325f75ab724a74a7e037d64a))
* **hooks:** PlanBridgeでセッション完了入力を正しく削除するように修正 ([83b35db](https://github.com/yohi/justice/commit/83b35dbfb0599d60f45239da1a3f78db82b37c66))
* **hooks:** セッション終了時の例外処理と完了後のキャッシュクリアを改善 ([a85b878](https://github.com/yohi/justice/commit/a85b87818940397958b501acc7c415a6b6182eda))
* **justice-plugin:** mergePostToolUseResponsesでmodifiedPayloadを保持するように修正 ([9f20fe2](https://github.com/yohi/justice/commit/9f20fe2b48651aa41abf42b985ce922fb710b9dc))
* **justice:** callIdのハンドリング修正およびhandleEventへの引数追加 ([516104d](https://github.com/yohi/justice/commit/516104de7610dc157adca7c6cb2d7594604484f2))
* **learning-extractor:** 根本原因検出の正規表現を修正 ([95c22b1](https://github.com/yohi/justice/commit/95c22b1c6c310475a114ddab7ecd3663b275694a))
* Phase5ペルソナ解決を一貫化 ([5abe63b](https://github.com/yohi/justice/commit/5abe63bbc03184894eeb2c4d7232b08fd46b0409))
* Phase5レビュー指摘を反映 ([7572a27](https://github.com/yohi/justice/commit/7572a273359aae7a4b04c4166fe5b02abe8b48a5))
* **plan-bridge:** getActiveTaskIdForSessionにおいてpendingタスクもアクティブ候補とするよう修正 ([ac4624b](https://github.com/yohi/justice/commit/ac4624b9bc46102d327187174b8eeda7fe643b4f))
* 可視性の明示と dominant_override 衝突時のペルソナ乖離の解消 ([a5bfe4e](https://github.com/yohi/justice/commit/a5bfe4e840276b58f2faedc970a058c04967ca63))
* 空配列時の loadSkills フォールバック対応 ([884cfa6](https://github.com/yohi/justice/commit/884cfa67531c9e8ce9267b4dc235e90ca2f4ea0a))

## [2.2.1](https://github.com/yohi/justice/compare/v2.2.0...v2.2.1) (2026-05-13)


### Bug Fixes

* **core:** OpenCodeプラグインのエクスポート漏れを修正 ([6994ae6](https://github.com/yohi/justice/commit/6994ae6b7b4d0cf0f444cbb66bd0974ed2a56115))
* **core:** OpenCodeプラグインのエクスポート漏れを修正 ([bf149a3](https://github.com/yohi/justice/commit/bf149a31b4c43fc1f5d5070fcb589f82a575bb0b))

## [2.2.0](https://github.com/yohi/justice/compare/v2.1.0...v2.2.0) (2026-04-28)


### Features

* **core:** 汎用アトミック永続化プリミティブの導入 ([7033914](https://github.com/yohi/justice/commit/7033914151c53fcd9ba197cdc35caf55628c89ff))
* **justice:** Justice 拡張計画 (フェーズ1-5) を追加 ([76357c1](https://github.com/yohi/justice/commit/76357c1bef9614ed779b6b06f468387388755cbf))
* **justice:** 知見信頼性向上とエージェント自己適応強化のための拡張設計 ([c87c44a](https://github.com/yohi/justice/commit/c87c44a338b5270e14b11403f8317e84c9cfd76d))
* **wisdom:** メトリクス追跡と永続化ロジックを改善 ([7f11a74](https://github.com/yohi/justice/commit/7f11a74872cc715537185348322f4cd7c0ca1092))


### Bug Fixes

* **opencode-adapter:** assistant ロールからのメッセージを正しくルーティング ([5dd1b62](https://github.com/yohi/justice/commit/5dd1b62b4a2399946cb14ae9a72ef83487e6b51c))
* **opencode:** コードレビューの指摘に基づき空コンテンツの扱いを改善 ([36ce9d6](https://github.com/yohi/justice/commit/36ce9d6e1d33effee37d402ee571487e9ff1a6fa))
* **opencode:** プラグインのロード互換性と初期化トリガーの修正 ([8616a5a](https://github.com/yohi/justice/commit/8616a5a96250774786c4f34a67c7b30f8598a4e8))

## [2.1.0](https://github.com/yohi/justice/compare/v2.0.0...v2.1.0) (2026-04-26)


### Features

* **agent:** エージェントルーティングとループ検出・エスカレーションを実装 ([aac0d6d](https://github.com/yohi/justice/commit/aac0d6dcca1cfb384ba8ce11f51cdf7b4a6e2915))
* **docs:** Codacy における AGENTS.md の除外設定 ([43b806b](https://github.com/yohi/justice/commit/43b806b318250294678da742245ce9823c027095))
* **routing:** 動的ルーティング層（AgentRouter）の実装 ([005f26f](https://github.com/yohi/justice/commit/005f26f02c6f95c4189a0d8a138b1a00dfae3784))


### Bug Fixes

* **hooks:** LoopDetectionHandlerのキー衝突リスク排除とエージェント特定の正確化 ([c1af0e4](https://github.com/yohi/justice/commit/c1af0e4535e06fdcc911cfdc639c1c78cfec319b))
* **hooks:** LoopDetectionHandlerの型安全性を向上 ([31134ef](https://github.com/yohi/justice/commit/31134ef23fac665e753dc23a681e27c0f8619935))
* lintエラーと警告を解消 ([e34bbd7](https://github.com/yohi/justice/commit/e34bbd7cf0b51e82fdcbcece8c53302d55071d3d))

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
