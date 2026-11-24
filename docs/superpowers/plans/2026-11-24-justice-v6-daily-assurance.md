# Justice v6 — Daily Development Assurance Integration Implementation Plan R0.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development after explicit execution approval. Steps use checkboxes.

**Parent:** #388  
**Status:** `DESIGN_OWNER_ADOPTED / PLAN_CANDIDATE / IMPLEMENTATION_NOT_AUTHORIZED / LIVE_NOT_AUTHORIZED`  
**Goal:** 承認済みSuperpowers Taskの実行証拠と実変更を既存Justiceへ接続し、通常開発のTask境界で自動診断・Advisoryを返す。  
**Architecture:** Superpowersの明示的Task開始/終了と、OpenCode V2 Native Hookによる限定Identity観測、Native Source・Git ChangeSetの読取専用取得を接続する。既存S1-a/b/c/d・S2-bを再利用し、S3の限定保証を維持する。  
**Tech Stack:** TypeScript / Bun / Vitest / @opencode/plugin 2.3.2 / Git。  
**Spec:** [2026-11-24-justice-v6-daily-assurance-design.md](../specs/2026-11-24-justice-v6-daily-assurance-design.md) — 採択済み基本設計・受入条件。Human Ownerは2026-11-24 JSTに日常開発品質保証、自動診断Advisory、Native Hook＋Superpowers連携、基本設計とIssue/Plan作成を明示承認した。実装Plan採択・開始は別判断。**Tracker:** [Issue #401](https://github.com/yohi/justice/issues/401)（原計画R0.1）。本ファイルはOwner指示によるGit保存版であり、技術スコープとTask 1–6は原計画から変更しない。

**Baseline:** [master@0195966130fb06b93c5ad79601d563307fd8df11](https://github.com/yohi/justice/tree/0195966130fb06b93c5ad79601d563307fd8df11)（実装baseline 896acee25323c0e5b6dc97e0dd936efff1b9e434）。[Owner Completion Decision](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/docs/superpowers/decisions/justice-v6-s5-owner-completion-decision.md)。#355/#356/#358 Closed維持、#357延期維持、BOUNDED_COMPLETE=APPROVED、RELEASE_APPROVED=PENDING、E1/E2/E3 HOLD。

## 採択済み基本設計・受入条件

- Intent Bridge: 承認済みManifest / TaskIntent / Scope Policy / AC、実行対象と基準点を実行前に固定。
- Evidence Bridge: Native Source / Tool Identityを事前規則で帰属、実Git ChangeSetを既存診断へ供給。
- Advisory Bridge: Superpowersの明示的Task境界から診断し、既存Review/完了判断へ還元。正式承認とは区別。

| ID | 受入条件 |
|---|---|
| AC-D01 | 承認済みDesign/Plan/Task/AC、実行対象・基準点を事前固定 |
| AC-D02 | Native Evidence取得・対象Task帰属 |
| AC-D03 | 実ChangeSetを既存S1-c/S1-dに接続 |
| AC-D04 | Evidence不足、Scope逸脱、不正帰属の診断 |
| AC-D05 | Task境界で自動診断・Advisory返却 |
| AC-D06 | Authority未証明・欠測を成功へ昇格しない |
| AC-D07 | 通常開発を不要に停止せずレビュー循環なし |
| AC-D08 | Opt-in / Stop / Rollback、既存環境・Credential保護 |

## Global Constraints

- Superpowers First / OpenCode V2 Native First。初回は固定2.3.2、単一Task・単一Session・専用Git worktree・単一プロセス、executing-plansのinline実行。子Session、複数Writer、並行Task、他Versionは未対応。S4、V1全面移植、強制Gate、新規Review/Workflow Engine、Model Routerなし。
- Owner承認・Manifest/Intent digest・Task/AC対応規則・許可Tool/試験識別・Scope Policy・基準Commitを実行前に固定。LLMの自己申告approvalRefは承認にならない。既存S1-a契約のNOT_PROVEN維持。
- Scope Policyは既存Plan構造化ブロック（見出し `## Justice S1-c Task Scope Policies`、begin/end marker、justice-s1c-task-scope-v1、planRef/taskRef/scopeKey/allowedPaths）。自由文推測、事後修正による合格禁止。
- Hook記録はsessionID/messageID/callID/tool name/statusのみ。input/result/error、Provider payload、HTTP header、Credentialは記録しない。Native Sourceはraw検証契約上本文を含むため、専用の非機密Task Sessionだけを対象とし承認済みloopback Native APIからbounded memory取得。raw本文の永続化/ログ/Advisory/GitHub転送禁止。秘密混入の完全排除は未証明。境界不明時は収集停止。
- Task完了候補は明示begin/finishで判定。idle/tool終了だけで完了を推定しない。重複finishは同一処理を共有、失敗/中断/再起動後はUNKNOWN、無断再実行なし。
- 既存V1/V2 justice_review、S2-b v1 report/CLI、S1/S2 schemaと制限を保全。S1-c formalVerdict UNKNOWN、S1-a NOT_PROVEN、coverageCompleteness NOT_ESTABLISHED維持。AdvisoryはcandidateScopeComparisonと正式判定を分離。未証明事項は非昇格。
- Default OFF、専用Config/State/Workspaceのみ。共有設定・共有State・実Credential・外部Networkへのアクセス/変更なし。新規依存/Lockfile/SDK更新なし。実Provider/Network利用は別承認。
- 今回承認済みはIssue/Plan作成だけ。T1–5の実装、Build/Test、Commit/Push/PRは実行承認後に許可範囲内で行う。T6のHost実行は別GO。Release/Opt-in本番導入は未承認。追加レビュー/訂正/後続Task自動開始禁止。

## File map / review focus

新規 `src/runtime/daily-intent.ts`, `daily-native-evidence.ts`, `daily-changeset.ts`, `daily-advisory.ts`, `daily-superpowers.ts`（各責務は下記）。既存 `src/runtime/s2b-offline-adapter.ts`, `src/opencode-v2-plugin.ts` は限定変更のみ。テストは各Taskの明示path。必要な場合だけREADMEの実使用説明を更新する。

テスト重点: (1) 偽承認/実行後digest差替え、(2) 外国Session/曖昧Tool/不完全pagination、(3) dirty base/rename/untracked/unsafe path/partial diff、(4) Scope/Evidence不足時UNKNOWN、(5) 重複finish/未対応Skill/解除時の登録・State保全。これらは既存TDDに含め、独立レビュー循環にしない。

## Task 1 — Fixed Intent / explicit binding (AC-D01/D06)

Files: create `src/runtime/daily-intent.ts`, `tests/runtime/daily-intent.test.ts`。  
Interfaces: existing LoaderInput, TaskIntent, S1aReadOnlySource, LoaderResult, IntentRef。新規 DailyStartRequest（loaderInput.expectedManifestSha256必須、expectedIntentSha256、sessionId、worktreeRoot、baseCommit、事前固定acquisitionRules、ownerDecisionRef）。DailyBindingは上記のfreeze済みsnapshot/selected refs、ownerAuthorityStatus NOT_PROVEN。  
`prepareDailyBinding(request: DailyStartRequest, source: S1aReadOnlySource, ports: DailyPreflightPorts): Promise<DailyStartResult>`。結果READY(binding)またはUNAVAILABLE(reason)。Portsは信頼済み実行環境からのみ設定されるOwner承認照合、固定Host/worktree preflight。Modelの任意パス/port/自己申告は入力として許可しない。外部Owner承認は既存承認済みパッケージとの照合、S1-aによる本人認証と混同しない。

- [ ] RED: 固定digest/Artifact/Scope/外部承認一致でREADY; missing/mutated digest、self-declared approval、revision/scope/AC mismatch、scope policy absent/ambiguous、dirty/非専用worktreeはUNAVAILABLE。入力無変更、READYでもformal PASSなし。
- [ ] Run `bun run vitest run tests/runtime/daily-intent.test.ts` → RED。
- [ ] Implement: 既存loadS1aArtifacts、strict parser、extractTaskScopePolicy再利用。bytesをコピー、Task/AC規則とbaseを承認に結合、実行前に固定。単一active binding。
- [ ] 同コマンドGREEN、`bun run typecheck`。実行承認後のscoped commit: `feat: bind daily assurance task intent before execution`。

## Task 2 — Native Evidence Bridge (AC-D02/D04/D06)

Files: create `src/runtime/daily-native-evidence.ts`, `tests/runtime/daily-native-evidence.test.ts`。  
`NativeObservation`: sessionID/messageID/callID/toolName/statusのみ。  
`collectDailyNativeEvidence(binding: DailyBinding, observations: readonly NativeObservation[], port: NativeReadPort): Promise<DailyEvidenceResult>`。portは固定SessionのgetSession/getMessagesのみ、bounded read、READY(raw wrapper/Correlation bytes in memory)またはUNAVAILABLE(reason)。既存S2B_LIMITS/Source v1/Correlation v1使用。

- [ ] RED: 2.3.2複数page、固定規則に一致する実Identityは帰属可。異なるSession/Message/Tool、0件/複数候補、duplicate ID、cursor loop、incomplete page、unfinished tool、unsupported version/oversizeは既存reject/limited/unknown。不明なhook CallID→part ID対応はbindしない。raw hook payloadが出力されない。
- [ ] Run `bun run vitest run tests/runtime/daily-native-evidence.test.ts` → RED。
- [ ] Implement: `tool.hook('execute.after', callback)` のmetadataのみ、正しいactive bindingに限定しfull identityでdedup。既存T09/T16の実Native取得契約（session.get / session.messages）を再利用し、固定2.3.2 upstreamで正確なroute/型を確認する。first asc limit100、次cursor+同limit、type filterなし、raw spansを保つ。事前固定のTool→AC規則のみでjoinし、既存Source/Correlation validatorとprojectorで検証。子Sessionの自動帰属やtext類似度fallbackなし。portは承認済みloopback固定、redirect/任意宛先/credential転送なし、timeout/size cap。Host契約未確立なら対象経路停止。
- [ ] GREEN + `bun run vitest run tests/s2b`。Scoped commit: `feat: acquire bounded native task evidence`。

## Task 3 — Read-only Git ChangeSet (AC-D03/D04)

Files: create `src/runtime/daily-changeset.ts`, `tests/runtime/daily-changeset.test.ts`。  
`collectDailyChangeSet(binding: DailyBinding, git: DailyGitReadPort): Promise<DailyChangeSetResult>`。既存core/s1c/contract.tsのChangeSet、固定base/head、status/limitation codes。UNAVAILABLEを保持。Git portは固定信頼済みgit argvのみ（shellなし、GIT_OPTIONAL_LOCKS=0、external diff/textconvなし）。

- [ ] RED: 専用temp repoでADD/MODIFY/DELETE、commit/staged/unstaged/untracked、renameの旧/新path、unsafe path/invalid UTF-8/未知種別/128 entries超過、non-ancestor base/dirty initial state、unmerged/submodule/changing snapshot。失敗時PRESENT空配列にしない。HEAD/index/worktreeの非変更を確認。
- [ ] Run `bun run vitest run tests/runtime/daily-changeset.test.ts` → RED。
- [ ] Implement: clean baseを事前固定、endでbase ancestor・root一致確認、HEAD/index/status before-after照合。NUL-delimited name-statusでbase→HEAD、HEAD→index、index→worktreeとnonignored untrackedをunion。--no-renames（old DELETE/new ADD）、--no-ext-diff --no-textconv、-- delimiter。strict UTF-8、既存inspectChangeSet/limits。path/kind重複のみ除外。入力上限/timeout/不安定snapshot/unsupported stateはUNAVAILABLE。file bodyを読まない。ignored path、途中でrevertされた変更、外部副作用、FS race freedomは保証しない。git add/stash/reset/cleanなし。
- [ ] GREEN。Scoped commit: `feat: collect bounded read-only task changeset`。

## Task 4 — S2-b/S1-d reuse / Advisory (AC-D03/D04/D06/D07)

Files: create `src/runtime/daily-advisory.ts`, `tests/runtime/daily-advisory.test.ts`; modify `src/runtime/s2b-offline-adapter.ts`, `tests/s2b/adapter.test.ts`。  
`runDailyAdvisory(binding: DailyBinding, evidence: DailyEvidenceResult, changes: DailyChangeSetResult, source: S1aReadOnlySource): Promise<DailyAdvisoryReport>`。新規justice-daily-advisory-v1 schema、DIAGNOSED/LIMITED/UNAVAILABLE、Task/revision/scope、reason codes、nativeDiffProjection UNAVAILABLE、別のchangeSetOrigin GIT_READ_ONLY/UNAVAILABLE、candidateScopeComparison・限定diagnostics。正式合否欄なし。

- [ ] RED: 実scope block + 適合Git path → WITHIN_CANDIDATE_SCOPE、範囲外→OUTSIDE_CANDIDATE_SCOPE、AC不足→AC_EVIDENCE_REF_MISSING、不正Binding→既存reject/limited。欠測/invalid ChangeSetはUNKNOWN。formalVerdict UNKNOWN、NOT_PROVEN、NOT_ESTABLISHEDを維持。REJECTED SourceでS1-d未実行。旧adapter v1 JSON/text/call count/diffProjection UNAVAILABLE不変。
- [ ] Run `bun run vitest run tests/runtime/daily-advisory.test.ts tests/s2b/adapter.test.ts` → RED。
- [ ] Implement: runS2bOfflineAdapterの既存validated projection/virtual-source pipelineをprivate共通処理に限定抽出。旧entryは従来のUNAVAILABLE ChangeSet、旧reportのまま。新entryは独立に固定/検証済みGit ChangeSetを既存runS1dDiagnosticへ1回だけ渡す。Native diffを利用可能と偽らない。recheck binding/bytes、safe ID/code/countのみ（path表示は承認範囲内だけ）。取得失敗はUNAVAILABLE/LIMITED。既存evaluatorを再実装しない。
- [ ] GREEN + `bun run vitest run tests/s2b tests/runtime/s1d-diagnostic.test.ts`。Scoped commit: `feat: connect native evidence and git scope to daily advisory`。

## Task 5 — Native × Superpowers explicit boundaries (AC-D05/D07/D08)

Files: create `src/runtime/daily-superpowers.ts`, `tests/integration/opencode-v2-daily-advisory.test.ts`; modify `src/opencode-v2-plugin.ts`。READMEは必要時だけ。  
`createDailyCoordinator(ports: DailyCoordinatorPorts): DailyCoordinator` (begin/observe/finish/dispose)。beginは事前Owner固定bindingに限る、finishは固定key+実ToolContext Session照合。同じfinishは同一結果、失敗はUNKNOWN、再起動replayなし。新規V2 tool候補 `justice_task_begin`/`justice_task_finish`、既存justice_review不変。固定identity/content digestのexecuting-plansだけを対象とするskill.transform、既存Task開始/終了点への最小限の連携指示。モデルの呼出漏れはNOT_OBSERVED、決してcoverageとしない。

- [ ] RED: Default OFFで既存登録のみ。opt-inで限定2 tool/metadata hook/対象Skillのみ追加。開始前beginと既存完了候補時finish、Advisoryを同じflowへ返す。duplicate finish、foreign/child session、missing begin、unknown Skill/version、partial setup failure/disposeを検証。既存tool維持、追加登録のみ解除。自動Review/resolve/approvalなし。raw payload/共有writeなし。
- [ ] Run `bun run vitest run tests/integration/opencode-v2-daily-advisory.test.ts` → RED。
- [ ] Implement: Native tool.transform, tool.hook, skill.transformを利用。実SDK Context/ToolContext契約とdigestを固定確認。Owner提供の読取専用設定以外でopt-inしない。不明な承認/Skill/Sessionは非対応と明示。HookでHost実行を強制しない。idle heuristic/pollingなし。SDKで安全な接続が不能なら対象停止・報告し独自frameworkを作らない。
- [ ] GREEN + `bun run vitest run tests/integration/opencode-v2-plugin-contract.test.ts tests/integration/opencode-v2-plugin-hooks.test.ts tests/integration/opencode-v2-plugin-coverage.test.ts tests/s2b`、`bun run typecheck`、`bun run lint`、`git diff --check`。承認済み環境でfull suiteは1回、既存failuresとの区別。Scoped commit: `feat: integrate daily advisory with native superpowers task boundaries`。Push/PRは別承認。

## Task 6 — One bounded practical pilot (AC-D01–08; separate Host GO)

S5 Runbook再利用。開始前に固定binary/artifact/Skill digest、専用worktree/session/state/config、Provider/Credential/egress境界、費用/時間上限、証拠保存先、停止/切戻しを明示。秘密をチャットに提示しない。条件不成立時はlive HOLD、offline成果までを報告。

- [ ] 別Owner GO後のみ、正常Taskと意図的な不足Evidence/Scope逸脱Taskを専用使い捨てrepoで各1回実行。既存Superpowers flowと実Native hook/catalog/ToolContext/Sourceを使用。事前に期待diagnosticsを固定し、再実行なし。
- [ ] 実測でTask begin/finish・Source帰属・ChangeSet・既存S1-d・Advisory・欠測非昇格・通常flow非干渉を確認。漏れと実行失敗を区別、費用/時間/付加価値は観測として記録。Native-only統計的優位性は主張しない。
- [ ] 専用runtimeのStop/Rollback、共有State非干渉、証拠保全。AC-D01–08別のPASS/FAIL/NOT_VERIFIEDと限界を報告。Owner checkpointへ戻る。S5 AC再実証/E1–E3/Release/追加Taskなし。

## Completion / Stop / Handoff

T1–5 offline成果とT6 live実用確認を分ける。AC-D01–08に対応する実証が揃えばDaily Assuranceの限定利用判断が可能。Plugin loadやテストmockだけで日常運用PASSにしない。包括的意味乖離・完全な証拠網羅・強制予防は対象外。境界/承認不明、未対応契約、危険な副作用、完了時は停止し、Findingだけで範囲を拡張しない。S5の限定完成とClosed Issueは維持。S4とS2-c比較は延期維持。

**Next:** Human OwnerによるPlan採択・限定実装着手の承認。推奨担当は現在のAI coding agent、superpowers:executing-plans（依存するinterfaceを順にTDD、不要な独立レビューなし）。本Issue作成およびGitへの文書保存は実装やHost操作のGOではない。
