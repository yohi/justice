# Justice v6 S3-b — Decision / Lifecycle Consistency Recovery Design R0.1.2

**Repository:** `yohi/justice`  
**Issue:** [#356](https://github.com/yohi/justice/issues/356)  
**Requirements:** R0.1.1 / Review PASS  
**Reviewed Design HEAD:** `0e28adf912a4a58b17f0c00f315acfef623a46f1`  
**Architecture Option:** A — Existing Evaluator Limited Recovery  
**Revision Scope:** D-002限定訂正（D-001既解消契約は維持）  
**Status:** `DESIGN_DRAFT / OWNER_ADOPTION_PENDING / IMPLEMENTATION_HOLD`

> 本文はHuman Ownerが承認したD-002の文書限定訂正版（D-001の正式完了契約を維持）であり、Design Adoption / Implementation GOを意味しない。Requirements R0.1.1、Source Code、Tests、CI、Gate/HOLDは変更しない。Commit・Push・PR・Merge・再レビュー・実装を自動実施しない。

## 1. Architecture Contract

### Goal

同一Review CorrelationのGateDecision・AcceptanceDecisionが永続化された後にLifecycle appendが失敗しても、既存Evaluatorを再利用して整合状態へ収束する。

### Responsibility Boundaries

| Component | Responsibility |
|---|---|
| `src/core/acceptance-decision.ts` | Decision照合、Lifecycle整合判定、限定Recovery、最終Readback |
| `src/core/task-lifecycle.ts` | 既存の状態遷移規則・append契約 |
| `src/core/v2/state-projection.ts` | Durable Recordから現在Lifecycleを再構築 |
| `src/core/review-artifact.ts` | Review完了後の既存Evaluator呼出しと正式完了の最終確認 |
| `src/core/justice-plugin.ts` | Restart入口・Plan Progress更新・Finalization |
| `src/core/progress-updater.ts` | チェックボックスの冪等な内容更新 |

新規の独立Recovery Manager、Storage、Scheduler、全面Replay基盤は作成しない。既存S3-aのAuthority・Review Correlation・Decision正式受理境界を維持する。

## 2. Decision / Lifecycle Recovery

既存の `createGatePendingAttemptEvaluator()` に、同一Correlationの確定DecisionとLifecycleの整合確認を追加する設計とする。

### 2.1 State Classification

Durable Recordの読込み後、既存AuthorizationとReview Correlationを検証し、Gate/Acceptanceの正式照合と現在Lifecycleを判定する。

**CONSISTENT**

- Gateと確定Acceptanceが一致している。
- 現在Identityに属するLifecycleが期待状態にある。
- Durable Readbackで確認できる。
- 追加書込みを行わない。

**RECOVERABLE**

- Gateと確定Acceptanceが一致している。
- Task Lifecycleが `gate_pending`、またはPlan Lifecycleが `final_gate_pending`。
- 同一Identityと有効Authorizationを証明できる。
- 期待するLifecycle遷移が既存規則で許容される。

**BLOCKED**

- Decisionが競合する、Gate/AcceptanceのVerdictが一致しない。
- Authorizationが失効している。
- Lifecycleが別Attemptや別Roundの状態に進んでいる。
- Review Correlationが一致しない。
- 許可されない状態遷移が必要になる。

**NOT_VERIFIED**

- Durable Recordが取得できない。
- append後の状態が確認できない。
- ReadbackのProjectionから現在Identityを証明できない。

状態名は設計上の分類であり、新規永続Schemaや公開Result型を必須としない。

### 2.2 Recovery Transition

同一Correlationの既存確定Decisionから期待Lifecycleを導出する。

| Gate | Task Lifecycle | Plan Finalization Lifecycle |
|---|---|---|
| `PASS` | `accepted` | `complete` |
| `WARN` | `rework_required` | `final_rework_required` |
| `FAIL` | `rework_required` | `final_rework_required` |

RECOVERABLEの場合、既存Decisionの再評価・再作成をせず、必要なLifecycle遷移だけを実行する。

- Task: `gate_pending` から正しい終端状態へ移す。
- Plan: `final_gate_pending` から正しい終端状態へ移す。
- append前に、現在AuthorizationとLifecycle遷移元・Identityを再確認する。
- append後のDurable Readbackで期待状態を検証する。
- appendの成功応答だけで `decided` を返さない。
- 不一致・失効・未確認なら正式完了にしない。

既存 `GatePendingAttemptResult` の判定と呼出元の扱いは§2.5に固定する。既存 `not_applicable` 自体を正式完了の証拠にはしない。

### 2.3 Existing Gate-only Recovery

GateのみDurableな場合は、従来のAuthorization・Correlation・Decision照合に従い、必要な確定Acceptanceを一度だけ補完する。その後Lifecycleを復旧してReadbackを確認する。確定Acceptanceが既にある場合は再生成しない。

### 2.4 Provisional Blocked

既存 `findCurrentAcceptanceDecision()` の契約を維持する。

- 暫定 `blocked` AcceptanceのみではLifecycleを確定させない。
- 同一Correlationで暫定 `blocked` 1件と後続の確定Acceptance 1件は正常遷移。
- 確定Acceptance複数件、矛盾Verdict、確定値なしの暫定 `blocked` 複数件は競合。
- Historical Round欠落・旧Attempt・別RoundのDecisionを正式受理しない。

### 2.5 D-001 — Formal Completion / Caller Contract

**責務の分離と単一の正式完了条件**を次のとおり固定する。

1. `acceptance-decision.ts` のEvaluatorは、既存のAuthorization Review Boundary内で同一CorrelationのGate/確定Acceptanceを照合し、必要なLifecycleのみをRecoveryする。`decided` は **Recovery後のDurable再読込と正式整合確認を通過した場合に限る**。
2. `review-artifact.ts` の `ensureTerminalReviewOutcomeApplied()` は、Evaluatorの応答だけでは `terminalized` にしない。**新たにDurable Recordを読込み、現在Terminal・Gate/Acceptance・Lifecycleの整合確認を通過した場合に限り**、`terminalReason === "completed"` のReview Completionを `terminalized` にする。
3. 判定規則は§3.2の共通の検証契約を利用する。既存 `findCurrentGateDecision`、`findCurrentAcceptanceDecision`、Review Correlation照合、Lifecycle Projection、Durable Terminal/Review履歴を組み合わせる。EvaluatorとCallerで異なる「正式完了」の意味を作らない。検証の純粋な読取部分を既存 `acceptance-decision.ts` に小さな内部関数として共通化することは許容するが、新規Framework・永続Schema・公開Result型は作らない。
4. Task `PASS` での Plan Progressは、さらに§6のActive Plan・Canonical Taskの条件を通過した場合にだけ `justice-plugin.ts` で更新する。Evaluatorや `terminalized` の文字列のみでファイル書込みを許可しない。
5. Plan `PASS` のAuthorization releaseにも、Gate/Acceptance `complete` とFinalization Lifecycle `complete` の正式整合確認を必須とし、Decisionのみでreleaseしない。これはS3-bの既存完了副作用境界の維持であって全面副作用Recoveryではない。

Evaluatorの返却と呼出元判定は以下とする。

| Evaluator返却 | `ensureTerminalReviewOutcomeApplied()`の扱い | Plan Progress |
|---|---|---|
| `decided` | 呼出元でも最新Durable正式整合を再検証。合格した時のみ `terminalized` | Task PASSかつ§6を満たす時のみ許可 |
| `not_applicable` | **成功扱いしない**。既に完了した正当な同一CorrelationとLifecycleが最新Readbackで証明できる場合のみ `terminalized`。それ以外は `stale` または `blocked` | 未証明なら禁止 |
| `blocked` | `blocked` のまま。Decisionの存在をもって `terminalized` に変換しない | 禁止 |
| 読取不能・整合未証明 | 成功として扱わず `blocked`／`stale`（既存公開Outcomeの範囲） | 禁止 |

`terminalReason === "completed_with_findings"` は**Gate/Acceptanceに基づく正式受理ではない**既存のReview-Rework分岐として区別する。この分岐では、同一Terminal・現在Identityに属する `review_pending → rework_required`（Planでは `final_review_pending → final_rework_required`）のDurable遷移とProjected Stateを確認したときだけReview処理を `terminalized` としてよい。該当するGate/Acceptanceがないことを理由に架空のDecisionを生成してはならず、Task accepted・Plan complete・Plan Progress・Authorization releaseには使用しない。その他のTerminal Reasonの既存非受理契約は維持する。

## 3. Durable Readback Design

### 3.1 Source of Truth

既存Observation LogのDurable Recordを権威ある状態入力とする。Memory Binding、Projection Cache、append戻り値、PlanチェックボックスだけをRecovery成功の証拠としない。

### 3.2 D-001 — Unified Formal-Completion Evidence

`terminalReason === "completed"` の正式完了には、**同じ最新のDurable Readbackを入力とした一組の検証**として以下をすべて要求する。

1. **Current Authority:** `parentSessionId` とActive Authorizationが一致し、Plan Path/Fingerprint・Canonical Taskの現在性を証明できる。失効・不一致・読取不能はFail-Closed。
2. **Current Terminal and Correlation:** Review Dispatchの正当な成功Terminalを一意に特定し、現在のReview Correlationと一致させる。既存の `admitCurrentReview` 相当のcompleted Terminal、claimed→staged→terminal履歴、完全かつcleanな `review_observed` の帰属・競合検査を維持する。存在しないRoundを推測・最新値で代用しない。
3. **Current Decisions:** `findCurrentGateDecision` と `findCurrentAcceptanceDecision` の結果が、ともに現在Correlationの一意な確定Decisionであり、Gate PASS↔Task `accepted` / Plan `complete`、Gate WARN/FAIL↔ `rework-required` と整合する。暫定 `blocked` 単体やDecision競合は不可。
4. **Current Lifecycle:** Taskは`parentSessionId`と`TaskExecutionRef`（authorizationId・taskId・attemptId）が現在Projectionと一致し、終端状態がGateから期待される `accepted` / `rework_required`。Planは`parentSessionId`・authorizationId・planPath・finalizationAttemptId・finalReviewRoundが一致し、`complete` / `final_rework_required`。
5. **Durable Transition Provenance:** Taskは当該TaskExecutionRefの `gate_pending → accepted / rework_required`、Planは当該Finalization Identity/Review Roundの `final_gate_pending → complete / final_rework_required` のDurable Lifecycle Recordを確認し、Projectionに正当に適用された遷移であることを確認する。単に終端値が見えることや無効Recordの存在だけでは不足。
6. **No Conflicting History:** 競合するTerminal、Gate/Acceptance、現在Attempt/Round、Lifecycle Transitionがあれば正式完了とはしない。Readback不能・欠測は `NOT_VERIFIED` とする。

**Task Lifecycle RecordにはReview Roundが存在しない。** したがって、Task Lifecycle Record単独でRound帰属を証明しない。現在のTaskExecutionRefが一致するLifecycle履歴に加え、同じTaskExecutionRefを持つ一意の成功Terminal（Review Round付き）、現在のGate/Acceptance（Review Round付き）、clean Review観測の履歴を同じCorrelationで結合して証明する。異なるRoundの競合、曖昧なTerminal、別Attemptがあれば拒否し、Lifecycle Recordに存在しないRoundを補完しない。

この検証契約をEvaluatorの `decided` 判定、Review Completionの `terminalized` 判定、Plan Progressの事前条件、Plan complete後のrelease判定に同じ意味で適用する。

### 3.3 Verification Sequence

1. Durable Recordを読込む。
2. 現在CorrelationとAuthorizationを確認する。
3. Gate/Acceptanceの整合・Terminal履歴を照合する。
4. 現在LifecycleをProjectionとDurable Transition Recordで確認する。
5. RECOVERABLEな場合だけ、境界内でAuthorityと遷移元を再検証してLifecycleをappendする。
6. appendの有無にかかわらず、正式完了を主張する直前にDurable Recordを**再読込む**。
7. §3.2の6条件を新しいReadbackで再判定する。
8. 正式整合が確認できた場合だけEvaluatorを `decided` とし、Callerも別途最新Durable Readbackで確認して `terminalized` を返す。
9. Task PASSのPlan Progress書込みはCaller側の成功だけで判断せず、§6の条件で別途検証する。

Projectionは不正遷移を無視し得るため、期待Projected Stateと正当に適用されたDurable Lifecycle Recordの双方を検証する。Callerは単純なGate/Acceptance存在確認だけを行うのではなく、共通の正式整合条件を利用する。

### 3.4 Readback Failure

Readback不可、対象Identity欠測、Projection/Transition矛盾は `NOT_VERIFIED` であり、正式完了として扱わない。append成功応答直後でもReadback失敗なら保存結果を断定しない。次回はDurable現況を再評価し、重複遷移・重複Plan書込みを防ぐ。

## 4. Concurrency Design

### 4.1 Existing Boundaries

以下の既存機構を再利用する。

- `AuthorizationReviewBoundary.withParentSession()`
- Evaluator内のIdentity別直列化
- Lifecycle Transition規則
- Durable RecordのReadback・Decision競合検出

同一Parent Sessionの競合処理を直列化し、Identity別の重複Recoveryを抑止する。ロックの取得順序・既存の「WithinAuthorizationReviewBoundary」呼出し経路を維持し、自己再入によるデッドロックを回避する。

### 4.2 Concurrent Retry

先行要求がLifecycleを復旧した場合、後続要求は最新Readbackで既存終端状態を確認し、余計な遷移を行わない。同一Gate/Acceptanceを重複生成しない。Plan Progressについても既存のファイル内容を再読込んで冪等に更新する。

### 4.3 Unproven Boundary

現在の `withParentSession()` とEvaluator Identity別直列化は、いずれもプロセス内Mapによる実装である。複数プロセス間の原子的排他・Compare-and-Swapは確認できていない。

したがって、**複数独立プロセス間の一度限りのLifecycle書込み保証は `NOT_PROVEN`**。設計案の成立範囲を単一プロセス・既存永続書込み契約の範囲とし、マルチプロセス運用時の許容範囲はImplementation GO前のOwner判断事項とする。未証明の保証を成立済みと扱わない。

## 5. Restart Recovery Design

### 5.1 D-002 — Staged Recoveryの対象・証拠・分岐契約（確定案）

**唯一のS3-b Restart Recovery入口は、既存 \`JusticePlugin.initialize()\` → \`reviewCompletionDomain.recoverStagedReviewCompletionsAfterRestart()\` → \`recoverStagedReviewCompletion()\` → \`ensureTerminalReviewOutcomeApplied()\` とする。** Terminal Reasonが \`completed\` の場合にのみ既存GatePending Evaluatorへ進み、\`completed_with_findings\` の場合は§2.5のReview-Rework Lifecycle分岐へ進む。後者でGate/Acceptanceを生成・補完しない。\`review_completion_staged\` を欠く履歴から、新たなGatePending Recoveryを起動しない。既存の \`review_artifact_failure_staged\`、\`review_post_tooluse_pending\`、\`review_artifact_read_started\` に対する元来の処理は維持するが、これらをS3-bの非Staged正式受理の代替経路とみなさない。

**共通の事前条件（matching Terminalの有無にかかわらず必要）:**

1. Durable Logから取得した \`review_completion_staged\` が当該 \`parentSessionId\`・\`staging.callId\`・\`staging.correlation\` について**一意**であり、重複・異なるReview Correlation・欠測を拒否する。現在Review Correlationは現行AuthorizationのTaskExecutionRef / Review Round、またはFinalization Attempt / Final Review Roundと一致する。
2. 現行Active Authorization、Active Plan Path/Fingerprint、Canonical Task（Taskの場合）を検証する。別Parent Session、失効・Released、Plan変更、旧Attempt / RoundではRecovery書込みを行わない。
3. Durableの \`pending → claimed\` 履歴から一意のClaimed Transitionを確認する。\`parentSessionId\`、\`callId\`、Review Correlation、\`expectedCategory\`（Task=\`sp-review\`／Plan=\`sp-final-review\`）と \`artifactReservation.status === "usable"\`、\`artifactReservation.artifactId\` を検証する。現在のProjected Claim Slotが残っていることを**Terminal成立後の条件にはしない**。
4. Stagingの \`artifactConsumption.artifactId\` とClaimed Reservationを一致させる。Stagingの \`reviewArtifact.correlation\`、\`observedExecution.parentSessionId/callId/correlation/childSessionId/reviewExecutionEventId\`、\`reviewArtifact.observedExecution\` の対応フィールドをすべて照合する。
5. Durable \`delegated_execution_binding\` から \`parentSessionId\`・\`parentCallId\`・Correlation・\`childSessionId\` がStagingの観測実行に一致する一意の関係を証明する。\`projectDelegatedExecutionBindings()\` の一致候補だけで確定せず、必要な場合は当該Persisted Binding Recordと \`projectObservedReviewExecution()\` の一意性・observed provenance・Event IDまで確認する。重複、衝突、欠落は非受理。Terminal後の \`projectTaskCallBindings()\` （Claimed-only）をこの証明に使用しない。
6. StagingのArtifactからTerminal Reasonを検証する。\`completed\` では \`complete === true\` かつFindingsなし、\`completed_with_findings\` では \`complete === true\` かつFindingsありを必須とする。双方とも同一Correlationの \`review_observed\` の完全性・帰属・競合を確認するが、Reworkをclean Reviewと偽って受理しない。\`review_incomplete\` 等は既存の非受理契約のままとする。

**Terminal Reason別の履歴証明・遷移契約（A/B共通）:**

| Reason | Durable履歴証明 | 遷移・結果 |
|---|---|---|
| \`completed\` | 一意なClaim→Staging→成功Terminalに対し、既存 \`projectCompletedReviewCallHistory(records, parentSessionId, correlation).kind === "proven"\`、clean Review、Delegated/Observed、現在のAuthorizationを要求 | 既存Admissionを維持してGatePending Evaluatorへ進み、§3.2のGate/Acceptance・Lifecycle正式整合をDurable再読込で確認した場合のみ \`terminalized\` |
| \`completed_with_findings\` | **成功Review専用の\`proven\`は要求しない**。同一Parent/Call/Correlationの一意なClaim・Staging・Reason一致Terminal、usable ReservationとConsumptionのArtifact ID/Digest、Delegated/Observedの一致、Findingsありの完全Artifact、同一CorrelationのReview観測、Active AuthorityをDurable履歴から証明 | **Decisionを生成・補完せず**、Task \`review_pending → rework_required\`／Plan \`final_review_pending → final_rework_required\` を既存§2.5のReview-Reworkとして処理。正当に適用されたDurable Transition Recordと最新Projection・Identityが一致した場合だけReview処理を \`terminalized\`。Task \`accepted\`、Plan \`complete\`、Plan Progress、Authorization releaseへ昇格させない |
| \`review_incomplete\` 等 | 既存Failure / 非受理のReason別契約を維持 | 成功ReviewやReworkの正式完了に変換せず、Gate/Acceptanceの補完をしない |

**A. Matching Terminalあり（Durable \`claimed → terminal\` が既存）**

- 同一Parent Session・Call ID・現在Review Correlationに対して、Durable \`from === "claimed"\`、\`to === "terminal"\` のTerminalが**一意**であり、\`expectedCategory\`、Artifact、Terminal ReasonがStagingのArtifactから導出したReasonと一致することを確認する。別のTerminal候補、同一Identityの競合・不明なReasonは非受理。
- \`completed\` に限り、現在のClaimed Slotではなく既存 \`projectCompletedReviewCallHistory(...).kind === "proven"\` を必須とする。返却された \`callId\`・\`artifactId\` もStaging/Terminalに一致させる。**同一Execution Identityの別Roundの成功Terminalを無条件に除外しない**。現行 \`admitCurrentReview()\` の成功Round競合拒否を維持し、最新Round推定で解消しない。
- \`completed_with_findings\` は、上記共通条件とReason別Rework履歴証明を直接用いる。成功Review専用 \`projectCompletedReviewCallHistory()\` の \`proven\` を条件にしない。Claimed-only \`projectTaskCallBindings()\` も使用せず、Terminal・Claim・Staging・Delegated Binding・Observed Execution・Artifactの一意なDurable Identityを要求する。
- 両Reasonとも有効なIdentity/Authorizationを確認後、既存 \`appendReviewObserved()\` を冪等に実行する。\`completed\` なら既存Terminalを \`ensureTerminalReviewOutcomeApplied()\` に渡してEvaluatorによる既存Decisionの限定Lifecycle Recoveryへ進む。\`completed_with_findings\` なら同じOutcome入口の**Rework専用分岐**を使用し、Gate Evaluatorを呼ばない。
- \`completed\` の正式完了には§3.2のAdmission・Gate/Acceptance・Lifecycleと最新Durable Readbackを要求。\`completed_with_findings\` は§2.5のRework遷移のDurable Recordと最新Projection一致を別途要求する。既にRework終端の場合も、同一Identityの正当なDurable Transitionを証明できた場合だけNo-op成功とする。\`not_applicable\` やDecisionの存在だけで成功扱いしない。清掃等の既存副作用はOutcome境界を維持し、ReworkからPlan ProgressやAuthorization releaseを行わない。

**B. Matching Terminalなし（まだClaimed）**

- 同一CorrelationのTerminalが**存在しない**ことをDurable読取で確認する。他のTerminal、競合するStaging、曖昧なClaimed履歴があれば止める。
- この分岐に限り、現在のProjected Claimed Slot（\`state === "claimed"\`）と \`stagingMatchesSlot()\` 相当のReview Call Binding・Artifact Reservation一致を要求する。共通条件のDelegated Binding/Observed Execution一致、Authorization現在性とStaging ArtifactのReason分類も必須。
- 既存 \`terminalFor(staging, slot)\` によって、StagingのArtifactから確定した \`completed\` または \`completed_with_findings\` のTerminalを**一度だけ**appendする。直後にDurable Recordを再読込み、同一Claim/Stage/Terminal/Reason/Artifact Identityを再照合する。**\`projectCompletedReviewCallHistory()\` の \`proven\` は\`completed\` の場合だけ要求し、\`completed_with_findings\` では共通のRework専用履歴証明を使用する。** appendが失敗・結果不明なら成功扱いせず、次回Durable再読込から再判定する。
- \`appendReviewObserved()\` を冪等に適用後、\`completed\` は既存 \`ensureTerminalReviewOutcomeApplied()\` → Evaluatorと§3.2の正式照合に進む。\`completed_with_findings\` はGate/Acceptanceを新規生成せず、同じOutcome入口のReview-Rework分岐でTask \`rework_required\`／Plan \`final_rework_required\` のDurable Transitionと最新Projection一致を確認する。Terminal追加後はClaimed-only Bindingで再証明しない。

**共通Fail-Closed:** Staging欠落・重複、Claim/Terminal履歴欠落・競合、Delegated Binding不一致、Artifact ID/Digest不一致、Review観測欠落、Authorization失効、Readback失敗は、個別Recoveryを \`blocked\` / \`stale\` / \`NOT_VERIFIED\` とし、正式完了・Lifecycle/Plan Progress更新に昇格させない。曖昧な履歴を最新RoundやRecord順から推測しない。成功Reviewに対する既存Admission \`admitCurrentReview()\` と \`projectCompletedReviewCallHistory()\` の検査は緩和・迂回せず、Review-Reworkは§2.5の別契約として扱う。

### 5.2 D-002 — 非Staged Fallbackの除外（確定案）

**非Staged GatePending Fallbackは採用しない。** `review_completion_staged` が存在しない場合、現在の `projectCompletedReviewCallHistory()` は `completion_staging_missing` を返し、当該履歴を使用する `admitCurrentReview()` は正式なReview Correlationを証明できない。成功TerminalやGate/Acceptanceが見つかっても、この不足を代替証拠で補えるとは扱わない。

- `review_completion_staged` が存在しない同一CorrelationのLifecycle Pendingは、Restart時のS3-b自動Recovery対象から除外して**Fail-Closed**。`review_observed` やGate/AcceptanceのみからStagingを合成しない。
- Stagingが存在するがIdentity・Authorization・Terminalに競合があってStaged Recoveryに失敗した場合も、非Staged探索で回避しない。
- 非Staged用の候補走査、Terminalからの独立 `GatePendingAttemptContext` 生成、`evaluateGatePendingAttempt()` の新しい起動経路、追加Lock、Scheduler、全面Replayを設けない。
- 非Staged欠測の自動解消は本Designの範囲外。状態を未完了／非受理として維持し、必要な運用判断はHuman Ownerに委ねる。未検証のRecovery成功を主張しない。

**Evaluator入力はStaged Recoveryの既存経路のみから生成する。** Matching Terminalあり・なしの両分岐で、正当なStagingとTerminalのCorrelationに基づき、Taskは `scope: "task"`・`trigger: "task_complete"`・`parentSessionId`・`taskExecutionRef`、Planは `scope: "plan"`・`trigger: "final_review_complete"`・`parentSessionId`・`authorizationId`・`planPath`・`finalizationAttemptId`・`finalReviewRound` を設定する。`agentId/sessionId/writerId` は既存TerminalのPersisted値を用いる。Task Review Roundを推定で入力に加えず、現行Admissionが成功Terminal、Staging履歴、clean Reviewから証明する。既存の `evaluateGatePendingAttemptWithinAuthorizationReviewBoundary()` を、既に親SessionのClaimを保持するReview Completion経路から呼ぶ順序を維持し、新しい独立Evaluator呼出しは追加しない。

### 5.3 D-002 — Actual `initialize()` Execution Order（Fallbackなし）

**現行 `JusticePlugin.initialize()` の実行順序を変更しない。** §5.2で非Staged Fallbackを除外したため、Design R0.1.1の新規Step 5は**削除**し、既存処理だけを以下の順序で維持する。

| Step | Existing Entry | Behavior |
|---|---|---|
| 1 | `restoreActivePlans()` | `"authoritative"` かを判定。成立しなければStep 3〜7のRecovery書込みを行わない |
| 2 | `tieredWisdomStore.loadAll()` → `telemetry.load()` → `observationHandler.initializeProjectionCache()` | 既存初期化のまま |
| 3 | **前段** `recoverPendingFinalizations()` | 既存の全Task Lifecycle `accepted` 条件を維持。Staged Recoveryより前に実施する |
| 4 | `reviewCompletionDomain.recoverStagedReviewCompletionsAfterRestart()` | 既存Stage、Failure Staging、Pending PostToolUse、Artifact Read Attemptを各既存契約で処理。§5.1の正当なStageのみS3-b Recoveryを実行する |
| 5 | Active Bindingごとの `recoverAcceptedTaskProgress(binding.sessionId)` | §6のLifecycle `accepted` のDurable確認後にだけPlan Progressを更新する |
| 6 | **後段** `recoverPendingFinalizations()` | Staged RecoveryによるTask Lifecycle変化を含め現在の全Taskを再判定する |
| 7 | `reviewDispatchState.recoverReviewDispatchesAfterRestart()` | 既存Review Dispatch Recoveryを維持 |
| 8 | 既存Notifier | 既存の初期化継続 |

Step 3〜7は `restoreActivePlans() === "authoritative"` の場合だけ実施する。各既存RecoveryのAdvisoryと初期化継続特性は維持し、**個別のLifecycle書込み、Review Completion、Plan Progress更新はFail-Closed**とする。Step 4で復旧したTaskに加え、既にDurableなLifecycle `accepted` を持つ正当なTaskも、Step 5で最新Durable確認を経て進捗更新候補となる。Step 4で復旧できない非Staged/競合候補はStep 5で進捗確定せず、Step 6のFinalizationも全Task Lifecycleがacceptedでなければ進めない。新規Fallback Step・独立Review・新規Attemptは追加しない。

## 6. Plan Progress Safety

### 6.1 Update Preconditions

`updatePlanProgressAfterAcceptance()` と `recoverAcceptedTaskProgress()` の双方で、Planファイルの更新前に以下を確認する。

1. 同一CorrelationのGate `PASS`。
2. 確定Acceptance `accepted`。
3. Task Lifecycle `accepted` のDurable Readback。
4. 現在TaskExecutionRef（Authorization/Task/Attempt）とReview Round。
5. Active Authorization・Plan Path/Fingerprint・Canonical Taskの一致。
6. 対象Planの現在内容と対象Taskを再読込みして検証する。

Lifecycleが `gate_pending` の場合は、Decisionが `accepted` でもPlan Progressを更新しない。

### 6.2 Update and Retry

Lifecycle RecoveryがDurable確認できた後、既存Plugin側でPlan Progressを更新する。EvaluatorへPlanファイル編集責務を移さない。

更新失敗時：

- Lifecycle成功を取り消さない。
- Plan Progressを成功扱いしない。
- 既存Advisoryによる通知を維持する。
- 次の許可されたRecovery機会で最新Planを読込む。
- Authorization・Plan・Task Identityを再検証する。
- 未チェックの対象項目だけを反映する。

既存 `updatePlanProgress()` の `updated: false` を利用し、反映済みチェックボックスへの不要な書込みを避ける。書込み結果が不明な場合は最新内容を再読込みして確認する。

### 6.3 Side-Effect Boundary

Lifecycleの永続更新とPlanファイルの更新は原子的な単一トランザクションではない。

既存 `advanceFinalizationWithinBoundary()` の **全Task Lifecycle `accepted` 必須条件**を維持する。Plan ProgressをFinalization開始の代替証拠にしない。

## 7. Failure Contract

| Condition | Required Behavior |
|---|---|
| Decision整合・Lifecycle未完了 | 限定Recoveryを試行 |
| Decision整合・Lifecycle完了済み | No-op |
| Lifecycle append失敗 | `blocked`、正式完了なし |
| Durable Readback失敗 | `NOT_VERIFIED`、正式完了なし |
| Authorization失効 | Recovery書込み禁止 |
| 旧Attempt / Round | 非受理 |
| Decision競合 | Fail-Closed |
| 暫定 `blocked` → 確定Acceptance | 既存正常遷移を許容 |
| Plan Progress書込み失敗 | Advisory、Lifecycle維持、後続の安全な再試行 |
| 無関係Task | 影響なし |

## 8. Verification Plan (Not Executed)

実装が別途承認された場合にのみ、既存Fixtureを優先して以下を限定検証する。

- Task PASS/WARN/FAILそれぞれのDecision保存後Lifecycle失敗→再実行
- Plan PASS/WARN/FAILそれぞれの同等ケース
- Gateのみ存在する状態からのAcceptance・Lifecycle補完
- append成功・Readback失敗
- Projectionが不正Lifecycle Recordを無視した場合の拒否
- 同一Correlationの繰返し実行・同時要求
- Authorization失効・別Attempt・別Round・Decision競合
- 暫定 `blocked` から確定Acceptanceへの正常遷移
- Restart: matching TerminalありのStaged Recovery（Claimed-only Binding不在でもDurable Claim→Staging→Terminal履歴、Delegated Binding、Artifact Reservationを検証し、Lifecycle限定Recovery）
- Restart: matching TerminalなしのStaged Recovery（Projected Claimed SlotとStaging/Delegated/Reservationの一致、Terminal append後のDurable履歴再検証）
- Staging欠落（成功TerminalとGate/Acceptanceだけ存在する場合を含む）は非受理。独立Fallback・Evaluator再入なし
- Staged履歴のIdentity競合、重複Claim/Terminal/Staging、Artifact ID/Digest不一致、Authorization失効、Active Plan不一致でFail-Closed
- 既存initialize()順序の維持（前段/後段Finalizationを含む）、非Staged Fallbackなし
- Lifecycle未完了時のPlan Progress更新禁止
- Lifecycle復旧後のPlan Progress更新と再実行No-op
- Plan Progress書込み失敗・再試行・Authorization失効
- 全Task Lifecycle未完了時のFinalization禁止

Build/Test/CI/Runtime Recoveryは、この設計作成時点では **NOT_VERIFIED**。

## 9. Residual Risks and Owner Decisions

1. 複数プロセス間の排他保証は `NOT_PROVEN`。単一プロセスの既存境界を超えるImplementation GOはHuman Owner判断待ち。
2. Staging欠落（Terminal/Decisionが存在していても）は現行Admission上正式受理できず、非Staged Fallbackを採用しない。Staged RecoveryのRestart実動作は `NOT_VERIFIED`。
3. ファイルI/Oの耐久性、外部Writer競合の保証は未確認。
4. Plan Progressの論理的一度限りの更新は設計目標であり、実装で保証済みではない。
5. S3-a M-2、Host Enforcement、全面Semantic Recoveryは対象外。
6. **D-001の正式完了境界:** `terminalized`、Plan Progress、Plan complete後のreleaseは§2.5/§3.2のDurable整合確認に依存する。Task LifecycleにReview RoundがないためTerminal・Decision・TaskExecutionRefの結合証明が必要。現行Source Codeは未変更であり、この保証が実装済みとは主張しない。
7. **D-002のRestart境界:** §5.1のClaimed→Staging→TerminalとDelegated BindingのDurable証明を必須とし、matching Terminalあり／なしの2分岐だけを扱う。現行initialize()のStep 3〜7を維持し、新規Fallback Stepは存在しない。非受理候補をOwner判断なしに再Review・再評価・自動補完しない。

## 10. Completion and Stop Conditions

- Design R0.1.1に対するD-002限定文書訂正版（R0.1.2）として作成し、D-001の正式完了契約を維持する。Owner Design Adoptionを先取りしない。
- Requirements R0.1.1を変更しない。
- 新規Frameworkを作らない。
- Source Code、Test、CI、Gate/HOLDを変更しない。
- Commit・Push・PR・Merge・追加レビュー・後続実装を自動開始しない。
- 新規Findingだけで訂正・独立レビュー循環を始めない。

**Design Status:** `DESIGN_DRAFT / OWNER_ADOPTION_PENDING`  
**Implementation GO:** `HOLD`
