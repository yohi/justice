# Justice v6 S3-b — Decision / Lifecycle Consistency Recovery Implementation Plan R0.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (recommended under the owner's anti-review-loop policy) or `superpowers:subagent-driven-development` **only after separate Human Owner approval for implementation**. Steps use checkbox (`- [ ]`) syntax for tracking. Do not automatically launch tasks, reviewers, or commits merely because the plan exists.

**Goal:** 同一Review CorrelationのGate/Acceptance Decision永続化後にLifecycle appendが部分失敗しても、既存Staged Review Completion経路から安全・冪等に収束し、証明できない完了・Plan Progress・Authorization releaseを禁止する。

**Architecture:** Design R0.1.2の方式A。既存GatePending EvaluatorがDecision/Lifecycleを限定復旧し、`review-artifact.ts`が最新Durable Readbackに基づく正式完了を確認する。Restartは既存Staged Recoveryだけを使用し、Plan ProgressはPlugin側でLifecycle `accepted`を確認してから更新する。新規Storage/汎用Recovery Framework/非Staged Fallbackは作らない。

**Tech Stack:** TypeScript、Bun、Vitest、既存Durable Observation Log / State Projection。`package.json`の `typecheck`、`test`、`lint`、`build` を使用する。

**Spec:** `docs/superpowers/specs/2026-11-14-justice-v6-s3b-decision-lifecycle-consistency-design.md`（R0.1.2、HEAD `55af51170434ef9d1797097d102a237699541bf1`）

**Requirements:** `docs/superpowers/specs/2026-11-13-justice-v6-s3b-decision-lifecycle-consistency-requirements.md`（R0.1.1）

**Repository / Issue:** `yohi/justice` / [#356](https://github.com/yohi/justice/issues/356)

**Plan status:** `PLAN_DRAFT / DESIGN_ADOPTION_PENDING / IMPLEMENTATION_GO_HOLD`。これは実装承認ではない。実装計画書は本チャットのローカル成果物であり、GitHubには未反映。

## Global Constraints

- 固定設計はDesign R0.1.2。要件R0.1.1を変更しない。Design採択とImplementation GOは別途Human Owner判断。
- **対象は単一プロセス**。既存の `AuthorizationReviewBoundary.withParentSession()` とEvaluator Identity直列化を再利用。複数プロセス排他は `NOT_PROVEN` で、保証しない。
- 既存の `GatePendingAttemptResult`（`not_applicable` / `decided` / `blocked`）、`ReviewCompletionOutcome`（`terminalized` / `stale` / `blocked` 等）を維持。新規公開Result型・永続Schemaは作らない。
- Task期待遷移: Gate `PASS` → Acceptance `accepted` → Lifecycle `accepted`、Gate `WARN/FAIL` → Acceptance `rework-required` → Lifecycle `rework_required`。
- Plan期待遷移: Gate `PASS` → Acceptance `complete` → Lifecycle `complete`、Gate `WARN/FAIL` → Acceptance `rework-required` → Lifecycle `final_rework_required`。
- Task Lifecycle RecordにはReview Roundがない。Terminal / Staging / Gate / AcceptanceのCorrelationとTaskExecutionRefの結合で証明し、Roundを推測・補完しない。
- 一意の `review_completion_staged`、Durable `pending → claimed → terminal`、正当なDelegated Binding / Artifact Reservation、cleanな `review_observed` と既存 `admitCurrentReview()` 相当の条件を維持。
- **非Staged GatePending Fallbackは禁止。** Staging欠落・Identity競合・Authorization失効ならFail-Closed。Review/Attempt/Roundの新規開始、Tool副作用Replay、Host Enforcement、S3-a M-2、全面Semantic Recoveryは対象外。
- Durable append応答と正式完了を混同しない。`decided`、`terminalized`、Plan Progress、Plan complete後のreleaseはそれぞれ必要なReadback/Authority照合を通る。
- 現在の `JusticePlugin.initialize()` の順序（前段Finalization → Staged Completion → Progress → 後段Finalization → Dispatch）を保つ。新規Scheduler/入口なし。
- 実装時は既存変更・未Commit作業を保全。1 Taskが失敗しても新しいレビュー・訂正Taskを自動生成しない。安全に必要な停止のみ行う。

## File Map / Responsibility

| Existing file | Planned change | Owning task |
|---|---|---|
| `src/core/acceptance-decision.ts` | 小さな純粋な正式完了証拠照合、既存Evaluatorの限定Lifecycle RecoveryとDurable Readback | 1–2 |
| `src/core/review-artifact.ts` | `terminalized`条件の統一、matching TerminalありのDurable履歴証明、Review Completion後の副作用境界 | 3–4 |
| `src/core/justice-plugin.ts` | 通常・RestartのPlan Progress前提条件を統一 | 5 |
| `src/core/v2/state-projection.ts` | **原則変更しない**。既存 `projectCompletedReviewCallHistory()` を使用 | — |
| `src/core/task-lifecycle.ts` | **変更しない**。既存遷移規則を使用 | — |
| `src/core/progress-updater.ts` | **変更しない**。`updated: false` によるNo-opを使用 | — |
| `tests/core/acceptance-decision.test.ts` | Decision/Lifecycle部分失敗、Readback、同時実行・旧Round | 1–2 |
| `tests/core/review-artifact.test.ts`、`tests/integration/s3a-review-artifact-to-acceptance.test.ts` | Review Completionの正式判定と非正常履歴 | 3 |
| `tests/core/v2/state-projection.test.ts`、`tests/integration/s3a-review-artifact-to-acceptance.test.ts` | Staged Restartの履歴証明と非Staged拒否 | 4 |
| `tests/core/justice-plugin-routing.test.ts` | Plan Progressの抑止・復元・No-op | 5 |

`src/core/acceptance-decision.ts`は既存約1,000行のファイルだが、今回は設計責務を増殖させず小さな内部関数に留め、構造改革を行わない。

## Review Focus — 境界入力の重要な5ケース

1. **Decision完了済み・Lifecycle未更新:** `decided` / `terminalized` /Plan Progressを禁止（Task 2・3・5）。
2. **StagingはあるがTerminal後にClaimed-only Bindingがない:** 正当なClaimed/Staged/Terminal/Delegated履歴なら再入できる（Task 4）。
3. **Terminal/DecisionはあるがStagingがない:** Admissionを迂回せず`blocked` / `stale`、追加書込み0（Task 1・4）。
4. **append成功後にReadback失敗:** 成功扱いせず、次回再読込で重複appendしない（Task 2）。
5. **旧Round・別Attempt・失効、またはPlanファイルが既にチェック済み:** 不正副作用0／重複実効更新0（Task 1・5）。

---

### Task 1: 正式完了証拠の共通読取判定

**Files:**
- Modify: `src/core/acceptance-decision.ts`（`findCurrentGateDecision`、`findCurrentAcceptanceDecision`、`admitCurrentReview`の近傍に限定）
- Test: `tests/core/acceptance-decision.test.ts`
- Reference only: `src/core/v2/state-projection.ts`（`projectCompletedReviewCallHistory`、`project()`）

**Interfaces:**
- Consumes: `PersistedLogRecord[]`、`ReviewCorrelation`、`GateDecision`、`projectCompletedReviewCallHistory(records, parentSessionId, correlation)`、既存Decision Lookup / `project()`。
- Produces: `inspectFormalReviewCompletion(records: readonly PersistedLogRecord[], parentSessionId: string, correlation: ReviewCorrelation): { readonly kind: "consistent"; readonly gate: GateDecision } | { readonly kind: "not_consistent"; readonly reason: string }`。
- この関数は**永続Readback済みの引数に対する純粋な検証**であり、Authorizationの最新`active`状態・Plan一致は呼出元が既存Boundary内で別途保証する。既存のAdmissionを緩和するのではなく、gate_pendingに依存する入口制約と、Terminal/clean Review/履歴帰属という証拠条件を分離して再利用する。関数は該当モジュールからのみエクスポートし、`src/index.ts`等の公開APIには追加しない。

- [ ] **Step 1: failing tests** — `inspectFormalReviewCompletion`に対し、(a) Gate/Acceptanceが揃うがLifecycleが`gate_pending`なら`not_consistent`、(b) 正しい同一CorrelationのTerminal、Claimed/Staged、clean `review_observed`、終端Lifecycle Recordが全てあれば`consistent`、(c)Staging欠落、競合Terminal、別Round、異なるAttempt、無効Lifecycle Recordをそれぞれ`not_consistent`とするテストを追加。Task LifecycleにRoundがないことをFixtureで明示する。
- [ ] **Step 2: confirm RED** — `bun run vitest run tests/core/acceptance-decision.test.ts -t "formal completion"` → 新設テストがFAIL（既存機能は未改変）。
- [ ] **Step 3: minimal implementation** — 上記署名の純粋関数を追加。既存LookupによるDecision整合、成功Terminal一意性、`projectCompletedReviewCallHistory`の`proven`、clean Review帰属、Task/Finalizationの正当なDurable遷移とProjection現在値、矛盾履歴排除を満たす場合のみ`consistent`。TaskのRoundはTerminal/Decisionから検証する。記録単独の見た目や最後のRecordの値で成功判定しない。
- [ ] **Step 4: confirm GREEN** — 上記単体テスト PASS。既存 `admitCurrentReview` / Gate Lookup回帰も含めた `bun run vitest run tests/core/acceptance-decision.test.ts` PASS。
- [ ] **Step 5: commit under authorized Implementation GO** — `git add src/core/acceptance-decision.ts tests/core/acceptance-decision.test.ts && git commit -m "test(justice): prove formal completion from durable correlation"`。この計画作成時には実行しない。

**Task exit:** 正式完了の共通読取契約が確立され、非Staged・旧Round・Decisionのみはすべて非受理となる。

### Task 2: GatePending Evaluatorの限定RecoveryとReadback

**Files:**
- Modify: `src/core/acceptance-decision.ts`（`createGatePendingAttemptEvaluator`内）
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:**
- Consumes: Task 1の `inspectFormalReviewCompletion(records, parentSessionId, correlation)`、既存 `GateEvaluationDependencies`、`applyGateOutcomeLifecycle`、`admitCurrentReview`、`isCurrentActiveAuthorization`。
- Produces: **既存** `GatePendingAttemptResult` の意味を厳格化する。`decided`はActive Authority + current Correlation +一致Decision + 正当LifecycleのDurable Readback証明がある場合に限る。`blocked`は失効、append失敗、不整合、Readback不可。`not_applicable`は完了証明にならない。

- [ ] **Step 1: failing tests** — (a)Task/PlanそれぞれPASS・WARN・FAILの「Gate+Acceptance永続済み、Lifecycle未完了」→旧Decision件数維持で正しいLifecycleへ一度だけappend、(b)Gateのみ永続済み→Acceptanceを1件補完、(c)2回目→No-op、(d)同時再実行→重複0、(e)append応答だけ成功してReadbackで見えない→`blocked`、(f)再読込でAuthorization失効・別Round→`blocked`、(g)暫定 `blocked`→確定Acceptance 1件は正常、をFixtureのDurable Record変化としてテストする。
- [ ] **Step 2: confirm RED** — `bun run vitest run tests/core/acceptance-decision.test.ts -t "lifecycle recovery"` → 新設ケースがFAIL。
- [ ] **Step 3: minimal implementation** — 既存 `gate.kind === "found" && acceptance.kind === "found"` の即`decided`経路を廃止。共通の「既存Decision確認 → 必要ならLifecycle append → 最新Durable再読込 → Task 1の正式検証 → `decided`」にまとめる。Gateのみのケースでは正式Acceptanceを補完した後に同じ経路を使う。既存Lock順序（通常 `evaluateGatePendingAttempt()` は外側Parent Boundary獲得、Within版は既獲得前提）とAdmissionを維持する。`not_applicable`を成功へ昇格させない。
- [ ] **Step 4: confirm GREEN** — `bun run vitest run tests/core/acceptance-decision.test.ts` PASS。既存FixtureのLifecycle appenderが単に`committed`を返している箇所では、必要なDurable Readback契約を満たすよう**テスト用ストアだけ**更新する。実Sourceの検証省略で旧テストを通さない。
- [ ] **Step 5: commit under authorized Implementation GO** — `git add src/core/acceptance-decision.ts tests/core/acceptance-decision.test.ts && git commit -m "fix(justice): verify lifecycle before decided result"`。

**Task exit:** Decisionだけで`decided`とならず、失敗直後・再実行・再起動経路で同じ条件を適用可能。

### Task 3: Review Completion呼出元の正式完了境界

**Files:**
- Modify: `src/core/review-artifact.ts`（`ensureTerminalReviewOutcomeApplied`、`releaseCompletedPlanAuthorization`の既存副作用境界）
- Test: `tests/core/review-artifact.test.ts`
- Test: `tests/integration/s3a-review-artifact-to-acceptance.test.ts`

**Interfaces:**
- Consumes: Task 1の `inspectFormalReviewCompletion`、既存 `ReviewCompletionDependencies.readDurableRecords()`、`findAuthorizationById` / `isAuthorizationPlanCurrent`。
- Produces: **既存** `ReviewCompletionOutcome`。`terminalReason === "completed"` では最新ReadbackとTask 1検証が整合した場合のみ `terminalized`。`decided` は再確認が必要、`not_applicable` は単独で成功扱いしない、`blocked` は必ず非受理。

- [ ] **Step 1: failing tests** — (a)`decided`でもLifecycle不一致なら`terminalized`禁止、(b)`not_applicable`かつ正しい既済Terminal+Lifecycleなら追加書込みなしで`terminalized`、(c)`not_applicable`で証拠欠測なら`stale`/`blocked`、(d)`blocked`をGate/Acceptance存在だけで`terminalized`へ昇格しない、(e)`completed_with_findings`のDurable Rework遷移確認・Task accepted/Plan complete扱い禁止、(f)Plan `complete`のrelease前に同じ正式整合を確認するケースを追加。
- [ ] **Step 2: confirm RED** — `bun run vitest run tests/core/review-artifact.test.ts tests/integration/s3a-review-artifact-to-acceptance.test.ts -t "formal completion"` → 新設ケースFAIL。
- [ ] **Step 3: minimal implementation** — `ensureTerminalReviewOutcomeApplied`の最終Gate/Acceptance存在チェックをTask 1の共通判定へ置換し、当該Terminalの一意な帰属も確認する。`completed_with_findings`は別のRework遷移とReadback証明を要求。`releaseCompletedPlanAuthorization`はPlan `complete`正式一致のときのみ許可。既存非受理理由、Artifact Cleanupの安全ルールを緩和しない。
- [ ] **Step 4: confirm GREEN** — `bun run vitest run tests/core/review-artifact.test.ts tests/integration/s3a-review-artifact-to-acceptance.test.ts` PASS。
- [ ] **Step 5: commit under authorized Implementation GO** — `git add src/core/review-artifact.ts tests/core/review-artifact.test.ts tests/integration/s3a-review-artifact-to-acceptance.test.ts && git commit -m "fix(justice): gate terminalized on durable lifecycle evidence"`。

**Task exit:** Review Completionの正式結果がEvaluator・Durable状態と矛盾しない。

### Task 4: Staged Restartの正当なIdentity再証明

**Files:**
- Modify: `src/core/review-artifact.ts`（`recoverStagedReviewCompletion` matching Terminal分岐、既存Identity補助関数）
- Test: `tests/integration/s3a-review-artifact-to-acceptance.test.ts`
- Test: `tests/core/v2/state-projection.test.ts`（既存履歴関数の契約確認のみ。Source Projectorを変更しない）
- No modify: `src/core/justice-plugin.ts`の`initialize()`順序。

**Interfaces:**
- Consumes: `projectCompletedReviewCallHistory(records, parentSessionId, correlation)` が返す既存 `proven/missing/conflict` とその `callId/artifactId`、`projectDelegatedExecutionBindings`、`projectObservedReviewExecution`、`stagingMatchesSlot`、Task 3の正式Outcome契約。
- Produces: 既存の `recoverStagedReviewCompletion()` の安全な二分岐。Matching TerminalありはDurable Claim/Stage/Terminal履歴で証明し、**Claimed-only `projectTaskCallBindings` を使用しない**。Matching Terminalなしは現在Claimed Slot/Bindingを検証しTerminalを一度だけappendする。

- [ ] **Step 1: failing tests** — (a)matching Terminalあり、Claimed-only Bindingなし、Durable Claim/Stage/TerminalとDelegated/Observed全一致→Lifecycle復旧、(b)matching Terminalなし・Claimed有効→Terminalを1件append後にEvaluator再入、(c)Staging欠落→非受理・新規GatePending起動0、(d)Artifact ID/Digest不一致、Delegated Child/Call/Correlation競合、重複Terminal→Fail-Closed、(e)Authorization失効→Append/Progress/Release 0、(f)Restart2回目→Duplicate 0。単一プロセスMock永続Logを再生成して復元する。
- [ ] **Step 2: confirm RED** — `bun run vitest run tests/integration/s3a-review-artifact-to-acceptance.test.ts -t "staged restart"` → 新設テストFAIL。
- [ ] **Step 3: minimal implementation** — Matching Terminalがある場合は一意のDurable Claim/Stage/Terminal、`projectCompletedReviewCallHistory(...).kind === "proven"`、Delegated Bindingのobserved provenance/identity、Active Authority/Planを検証する。Terminalがない場合のみ `claimedSlot` と `stagingMatchesSlot` を使用し、Terminal append後の最新Durable再読込で同じHistory証明を行う。`appendReviewObserved`は既存冪等実装を使用する。いずれも`ensureTerminalReviewOutcomeApplied`へ渡し、Admissionを迂回しない。**非Staged Fallbackを追加しない、`initialize()`を再配置しない。**
- [ ] **Step 4: confirm GREEN** — `bun run vitest run tests/integration/s3a-review-artifact-to-acceptance.test.ts tests/core/v2/state-projection.test.ts` PASS。既存Restart/Artifact Failureケースも回帰。
- [ ] **Step 5: commit under authorized Implementation GO** — `git add src/core/review-artifact.ts tests/integration/s3a-review-artifact-to-acceptance.test.ts tests/core/v2/state-projection.test.ts && git commit -m "fix(justice): recover staged terminal from durable identity"`。

**Task exit:** Stagedありの2経路が一意で、Stagingなし・競合・失効は安全に停止する。

### Task 5: Plan ProgressのLifecycle前提と冪等性

**Files:**
- Modify: `src/core/justice-plugin.ts`（`updatePlanProgressAfterAcceptance`、`recoverAcceptedTaskProgress`）
- Test: `tests/core/justice-plugin-routing.test.ts`
- Reference only: `src/core/progress-updater.ts`、`src/core/plan-authorization.ts`。

**Interfaces:**
- Consumes: Task 1の `inspectFormalReviewCompletion`、既存 `findAgreedAcceptedTaskDecision`、`project(records, ...)`、`taskLifecycleKey`、Active Plan / Canonical Task照合、`updatePlanProgress()`。
- Produces: **既存**`Promise<void>`の両Plugin関数。Task `PASS` +確定Acceptance `accepted` +現在のTask Lifecycle `accepted`（Durable証拠付き）+ Authorization/Plan一致を必須とし、未完了・欠測・失効時のファイル書込み0。

- [ ] **Step 1: failing tests** — (a)Decision acceptedだがLifecycle `gate_pending` →チェック未更新・writeFile 0、(b)Lifecycle `accepted` と同一CorrelationのDurable根拠あり→対象Taskのみ更新、(c)2回目・再起動後→実効更新/不要writeFile 0、(d)Plan Progress書込み例外→Lifecycle保持・Advisory記録・復旧後に未反映のみ更新、(e)失効・Plan Fingerprint不一致・別Round/Attempt→ファイル書込み0、(f)全Task Decision acceptedでもLifecycleが1件未完了→既存`advanceFinalizationWithinBoundary`は進行禁止。
- [ ] **Step 2: confirm RED** — `bun run vitest run tests/core/justice-plugin-routing.test.ts -t "accepted task progress"` → 新設テストFAIL。
- [ ] **Step 3: minimal implementation** — 両経路の各ファイル書込み直前に、Authorization Review Boundary内でDurableを再読込し、Task 1の正式整合条件とTask Identity/Plan一致を確認。Restartループの事前抽出は候補列挙に限り、書込み可否はループ内の最新状態で判定。Planファイル内容を最新再読込して `updatePlanProgress(...).updated === true` の場合だけ書込み。`advanceFinalizationWithinBoundary`の全Task Lifecycle条件を維持。
- [ ] **Step 4: confirm GREEN** — `bun run vitest run tests/core/justice-plugin-routing.test.ts tests/core/progress-updater.test.ts` PASS。
- [ ] **Step 5: commit under authorized Implementation GO** — `git add src/core/justice-plugin.ts tests/core/justice-plugin-routing.test.ts && git commit -m "fix(justice): require durable accepted lifecycle for plan progress"`。

**Task exit:** 既存Plan Progressの通常更新・Restart復元の双方でDecision-only副作用が発生しない。

### Task 6: S3-bの統合受入と停止判断

**Files:**
- Test-only adjustment if necessary: `tests/integration/s3a-review-artifact-to-acceptance.test.ts`（Task 1–5の横断Fixtureを再利用）
- No change: Requirements、Design、State Schema、CI設定、実運用Runtime。

**Interfaces:**
- Consumes: Tasks 1–5の完了実装と既存公開Entry/Result型。新規Production Interfaceは作らない。
- Produces: AC-01〜AC-19の実装証拠、単一プロセス範囲のImplementation GO後の完了判断用レポート。

- [ ] **Step 1: failing integration tests** — `Gate/Acceptance durable → Lifecycle append failed → restart → Staged Recovery → Durable accepted/complete → Task Progress` の連結ケースをTaskとPlanで追加。`WARN/FAIL`のRework、Readback失敗、同一Correlation二度実行、Staging欠落、競合、失効、`completed_with_findings`の副作用抑止もASSERTする。
- [ ] **Step 2: confirm RED** — 新設テストを実装前（または横断Fixture調整前）に実行して期待する欠落がFAILとなることを確認。`bun run vitest run tests/integration/s3a-review-artifact-to-acceptance.test.ts -t "S3-b"`。
- [ ] **Step 3: minimal integration wiring** — 既存FixtureのDurable再構築、必要な連結のみ調整。Task 1–5に未カバーの境界が判明した場合は**それを所有するTaskの範囲内**で限定修正し、新しい独立レビューループ・汎用Frameworkを作らない。
- [ ] **Step 4: targeted GREEN** — `bun run vitest run tests/core/acceptance-decision.test.ts tests/core/review-artifact.test.ts tests/core/v2/state-projection.test.ts tests/core/justice-plugin-routing.test.ts tests/core/progress-updater.test.ts tests/integration/s3a-review-artifact-to-acceptance.test.ts` →全件PASS。
- [ ] **Step 5: full verification** — `bun run typecheck`、`bun run lint`、`bun run test`、`bun run build` を順に実行。失敗・未実行・未確認を区別して記録する。実運用RuntimeでのRecoveryは明示承認がなければ行わず `NOT_VERIFIED`。
- [ ] **Step 6: commit and owner checkpoint (only under Implementation GO)** — 変更があれば関連TestのみCommit。実装範囲、テスト結果、未解決リスク、未承認事項を報告して停止。PR/Push/Mergeは別途明示承認が必要。

**Task exit:** Requirements AC-01〜AC-19に対して単一プロセスの具体的検証証拠を提示し、未証明部分を隠さずOwnerへ完了判断を返す。

## Requirements-to-Task Coverage

| Requirements | Tasks |
|---|---|
| FR-01 / AC-01〜AC-04 | 1–3 |
| FR-02 / AC-01〜AC-03、AC-06 | 2・4・6 |
| FR-03 / AC-04〜AC-05、AC-13、AC-16〜AC-17、AC-19 | 1・2・4・5・6 |
| FR-04 / AC-07〜AC-09 | 1・2・4・5 |
| FR-05 / AC-10 | 1・2・6 |
| FR-06 / AC-06 | 4・6 |
| FR-07 / AC-11〜AC-12 | 1・2・3・6 |
| 無関係Task / AC-14 | 1・5・6 |
| Plan Progress / AC-15〜AC-18 | 3・5・6 |
| 暫定`blocked` / AC-19 | 1・2・6 |

## Residual Risks and Non-Authorization

- **複数プロセス排他:** `NOT_PROVEN`。本Planで保証しない。単一プロセス以外のGOは禁止（別Owner判断）。
- **Runtime:** `NOT_VERIFIED`。計画作成により実証済みにはならない。
- **Staging欠落:** 設計上Fail-Closed。非Staged全面Recoveryの対象拡張なし。
- **外部Writer/Planファイル耐久性:** 既存契約の範囲。独立トランザクション化・新規Lock導入なし。
- **Owner Design Adoption:** `PENDING`。
- **Implementation GO:** `HOLD`。本計画を採択しても実装は自動開始しない。
- **Review policy:** 自動独立レビュー・新規Finding起点の再訂正循環を開始しない。Task内のテストと必要な限定修正の後にHuman Owner判断を置く。

## Completion / Stop Condition for This Writing-Plans Task

この成果物は実装計画の草案である。作成・自己照合をもってwriting-plans作業を終了し、Source/Test/CI変更、Build/Test、Commit/Push、PR/Merge、実装・実行環境変更は一切開始しない。次の実行はHuman OwnerがDesign Adoptionと具体的な実装範囲・方式を別途承認した場合のみ。
