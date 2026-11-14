# Justice v6 S3-b — Decision / Lifecycle Consistency Recovery Design R0.1.1

**Repository:** `yohi/justice`  
**Issue:** [#356](https://github.com/yohi/justice/issues/356)  
**Requirements:** R0.1.1 / Review PASS  
**Reviewed Design HEAD:** `f5b35057c6342a2c01d68c219d696dc3a3ec3b83`  
**Architecture Option:** A — Existing Evaluator Limited Recovery  
**Revision Scope:** D-001 / D-002のみ（Design R0.1限定訂正）  
**Status:** `DESIGN_DRAFT / OWNER_ADOPTION_PENDING / IMPLEMENTATION_HOLD`

> 本文はHuman Ownerが承認したD-001・D-002の文書限定訂正版であり、Design Adoption / Implementation GOを意味しない。Requirements R0.1.1、Source Code、Tests、CI、Gate/HOLDは変更しない。Commit・Push・PR・Merge・再レビュー・実装を自動実施しない。

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

### 5.1 Existing Entry Points and Staged Coverage

`JusticePlugin.initialize()` には既に `restoreActivePlans()`、`recoverPendingFinalizations()`、`recoverStagedReviewCompletionsAfterRestart()`、`recoverAcceptedTaskProgress()`、`recoverReviewDispatchesAfterRestart()` が存在する。

**Staged経路でRecoveryできる範囲を固定する。** 有効な `review_completion_staged` がDurableに残り、現在Identity・成功Terminal・Active Authorization・Active Planの検査に合格する場合、既存 `recoverStagedReviewCompletion()` → `ensureTerminalReviewOutcomeApplied()` → 既存Evaluatorという経路を再利用する。

- matching Terminalが既にある場合: stagingと現在のDelegated/Review Call Binding・Artifact Reservationを検証し、`review_observed`を補完して同じTerminalのOutcomeを適用する。
- matching Terminalがない場合: 既存のClaimed Slot/Bindingとstagingを照合し、Terminalの正当な追加・Review観測を経て同じOutcome適用へ進む。
- Gate/Acceptanceが既にDurableだがLifecycleのみ未完了なら、方式AのEvaluatorが**既存Decisionを再生成せずLifecycleのみ**復旧する。
- stagingのIdentity不一致、失効、Plan不一致、観測欠落、Terminal競合はFail-Closed。Staged経路失敗を汎用Fallbackで迂回しない。

Staged Recoveryの前処理がすべてのDurable部分失敗を再入可能にする保証はないため、§5.2の限定Fallbackを**非Stagedの正当に証明できる対象だけ**に設ける。

### 5.2 D-002 — Narrow Non-Staged Fallback (Decision Fixed)

**採用案:** `justice-plugin.ts` の既存 `initialize()` 内に、Staged Recoveryの直後、Plan Progress復元の直前に、**一度だけ**非Staged候補を調べて既存Evaluatorへ渡す処理を置く。汎用Replay・Scheduler・別Recovery Managerは作らない。

対象候補は以下の条件を**すべて**満たすものだけとする。

1. `restoreActivePlans() === "authoritative"` であり、現在Active Authorizationと親Session、Plan Path/Fingerprint、Canonical Taskが一致する。
2. `readDurableRecords()`/既存Observation Logを再読込んだ現在Projectionで、Task `gate_pending` またはPlan `final_gate_pending` に留まり、現在のIdentity/Attempt/Review Roundに矛盾がない。
3. 現在のReview Correlationと一致する `terminalReason === "completed"` のTerminalが**一意**にあり、Review Dispatch Slot・claimed→staged→terminalの呼出し履歴・clean完全 `review_observed` により正当に帰属できる。Terminalがない／不明／競合なら除外する。
4. 当該Correlationを参照する `review_completion_staged` が**一件も存在しない**。存在すればその成否に関係なく既存Staged経路が唯一のRecovery入口であり、Fallbackからは触れない（Staged失敗の安全検査を迂回しない）。
5. 同一CorrelationのGateDecisionが一意に存在する。AcceptanceはGateと一致する一意の確定値、Gateのみ、または既存契約で許される暫定 `blocked` とする。Gate未作成の単なるPending、確定Acceptanceのみ、Decision競合／旧Round／Historical Round欠落を対象外とする。
6. 別Attempt/別Roundの現在状態、認可失効、Plan変更、Lifecycle遷移元不一致、読取不能を非受理とする。複数候補やHistoryの曖昧さを順序・最大Round推定で解決しない。

**Evaluator入力の構築:** 正当なTerminalのPersisted RecordとそのCorrelationの既存フィールドだけを使う。

- Task: `scope: "task"`, `trigger: "task_complete"`, `parentSessionId: terminal.parentSessionId`, `taskExecutionRef: terminal.correlation.taskExecutionRef`, `agentId/sessionId/writerId: terminal` の各Persisted値。
- Plan: `scope: "plan"`, `trigger: "final_review_complete"`, `parentSessionId`, `authorizationId`, `planPath`, `finalizationAttemptId`, `finalReviewRound` はTerminal Correlationの値、`agentId/sessionId/writerId` はTerminalのPersisted値。
- Task Review Roundは `GatePendingAttemptContext` には追加せず、Evaluator内で既存 `admitCurrentReview()` によってTerminal・Review履歴から証明する。推定値で補完しない。

候補は同一Correlation単位で一度だけ扱い、**Plugin側では外側のParent Session Lockを握らず**、`evaluateGatePendingAttempt()`（通常版）を呼ぶ。この入口で既存Authorization Review BoundaryとIdentity別直列化を取得させる。`evaluateGatePendingAttemptWithinAuthorizationReviewBoundary()` を外側ロック付きで呼ぶ経路と混用せず、自己再入デッドロックを防ぐ。Evaluator内部で最新Readback・Authority・Correlationを再判定してからappendする。

候補が存在しない場合はNo-op。非Stagedでも十分なTerminal/Decisionの証拠がない状態は **非受理のまま保持してOwner判断事項**とし、Gate評価のやり直し、新規Review Round/Attempt/Dispatchや全履歴Replayを行わない。現行フローで非Staged候補が発生する頻度・実到達性は `NOT_VERIFIED` とし、このFallbackを全欠損状態の保証とは主張しない。

### 5.3 D-002 — Actual `initialize()` Execution Order

**既存の前段Finalization Recoveryを維持し、変更しない順序を以下のとおり固定する。** 新規処理はStep 5の1か所だけ。後段処理の置換・削除はしない。

| Step | Entry | Behavior |
|---|---|---|
| 1 | `restoreActivePlans()` | 権威あるAuthorization/Active Plan復元を判定。非authoritativeならStep 3〜8のRecovery書込みを実施しない |
| 2 | `tieredWisdomStore.loadAll()` → `telemetry.load()` → `initializeProjectionCache()` | 既存初期化を維持 |
| 3 | `recoverPendingFinalizations()` | **既存の前段**Finalization Recoveryを維持 |
| 4 | `recoverStagedReviewCompletionsAfterRestart()` | 既存Staged経路を優先して実行 |
| 5 | **限定非Staged GatePending Recovery（新規）** | §5.2の現在Durable状態から候補を抽出し、通常Evaluatorへ再入。Staged対象はスキップ |
| 6 | `authorizationStore.hydrate()` → Active Bindingごとの `recoverAcceptedTaskProgress(binding.sessionId)` | Lifecycle `accepted` のDurable確認後のみPlan Progress更新 |
| 7 | `recoverPendingFinalizations()` | **既存の後段**Finalization Recoveryを維持 |
| 8 | `recoverReviewDispatchesAfterRestart()` | 既存Dispatch Recoveryを維持 |
| 9 | 既存Notifier | 従来どおり初期化継続 |

各Recoveryは既存の失敗通知・Fail-Openな初期化継続特性を維持するが、**Recovery書込み・正式完了・Plan Progressは個別にFail-Closed**とする。ある候補が拒否／未検証でも無関係の正常Taskを停止しない。候補ごとの失敗を保存成功とみなさない。

既存のStaged Recoveryが既に復旧した対象はStep 5の現在Readbackで `gate_pending` / `final_gate_pending` ではないため再書込みしない。Step 5が復旧したTaskのみStep 6のDurable確認を通じてPlan Progress更新の候補となる。既存前段Finalization Recoveryは維持し、Step 7で再度現在の全Task LifecycleによりFinalizationが判定される。

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
- Restart後のStaged Completion再入
- Staged Completionのない限定候補の検出または非受理
- Lifecycle未完了時のPlan Progress更新禁止
- Lifecycle復旧後のPlan Progress更新と再実行No-op
- Plan Progress書込み失敗・再試行・Authorization失効
- 全Task Lifecycle未完了時のFinalization禁止

Build/Test/CI/Runtime Recoveryは、この設計作成時点では **NOT_VERIFIED**。

## 9. Residual Risks and Owner Decisions

1. 複数プロセス間の排他保証は `NOT_PROVEN`。単一プロセスの既存境界を超えるImplementation GOはHuman Owner判断待ち。
2. Staged Recoveryで証明できない履歴・非StagedでTerminal/Decisionが不足する履歴は自動補完しない。限定Fallbackの実到達性とRestart動作は `NOT_VERIFIED`。
3. ファイルI/Oの耐久性、外部Writer競合の保証は未確認。
4. Plan Progressの論理的一度限りの更新は設計目標であり、実装で保証済みではない。
5. S3-a M-2、Host Enforcement、全面Semantic Recoveryは対象外。
6. **D-001の正式完了境界:** `terminalized`、Plan Progress、Plan complete後のreleaseは§2.5/§3.2のDurable整合確認に依存する。Task LifecycleにReview RoundがないためTerminal・Decision・TaskExecutionRefの結合証明が必要。現行Source Codeは未変更であり、この保証が実装済みとは主張しない。
7. **D-002のRestart境界:** 既存前段Finalizationを維持したStep 3〜8を設計上固定し、追加処理は非Staged限定。非受理候補をOwner判断なしに再Review・再評価・自動補完しない。

## 10. Completion and Stop Conditions

- Design R0.1に対するD-001/D-002の文書限定訂正版として作成し、Owner Design Adoptionを先取りしない。
- Requirements R0.1.1を変更しない。
- 新規Frameworkを作らない。
- Source Code、Test、CI、Gate/HOLDを変更しない。
- Commit・Push・PR・Merge・追加レビュー・後続実装を自動開始しない。
- 新規Findingだけで訂正・独立レビュー循環を始めない。

**Design Status:** `DESIGN_DRAFT / OWNER_ADOPTION_PENDING`  
**Implementation GO:** `HOLD`
