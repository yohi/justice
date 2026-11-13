# Justice v6 S3-b — Decision / Lifecycle Consistency Recovery Design R0.1

**Repository:** `yohi/justice`  
**Issue:** [#356](https://github.com/yohi/justice/issues/356)  
**Requirements:** R0.1.1 / Review PASS  
**Baseline:** `14042198bba02e9c9717b12e9cce9ad3294924aa`  
**Architecture Option:** A — Existing Evaluator Limited Recovery  
**Status:** `DESIGN_DRAFT / OWNER_ADOPTION_PENDING / IMPLEMENTATION_HOLD`

> This document records the owner-selected brainstorming architecture option, not design adoption or implementation approval. Only this Markdown design draft is authorized for the current commit. Do not change source code, tests, CI, Gate/HOLD, or initiate implementation, PR, merge, or further review.

## 1. Architecture Contract

### Goal

同一Review CorrelationのGateDecision・AcceptanceDecisionが永続化された後にLifecycle appendが失敗しても、既存Evaluatorを再利用して整合状態へ収束する。

### Responsibility Boundaries

| Component | Responsibility |
|---|---|
| `src/core/acceptance-decision.ts` | Decision照合、Lifecycle整合判定、限定Recovery、最終Readback |
| `src/core/task-lifecycle.ts` | 既存の状態遷移規則・append契約 |
| `src/core/v2/state-projection.ts` | Durable Recordから現在Lifecycleを再構築 |
| `src/core/review-artifact.ts` | Review完了後の既存Evaluator呼出し |
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

既存の `GatePendingAttemptResult` の互換性を原則維持し、未確認状態は `blocked` とする。既に終端状態へ遷移した別経路からの呼出しは、既存 `not_applicable` 契約との整合を維持する。`not_applicable` は正式完了の証拠にはしない。

### 2.3 Existing Gate-only Recovery

GateのみDurableな場合は、従来のAuthorization・Correlation・Decision照合に従い、必要な確定Acceptanceを一度だけ補完する。その後、Lifecycleを復旧してReadbackを確認する。確定Acceptanceが既にある場合は再生成しない。

### 2.4 Provisional Blocked

既存 `findCurrentAcceptanceDecision()` の契約を維持する。

- 暫定 `blocked` AcceptanceのみではLifecycleを確定させない。
- 同一Correlationで暫定 `blocked` 1件と後続の確定Acceptance 1件は正常遷移。
- 確定Acceptance複数件、矛盾Verdict、確定値なしの暫定 `blocked` 複数件は競合。
- Historical Round欠落・旧Attempt・別RoundのDecisionを正式受理しない。

## 3. Durable Readback Design

### 3.1 Source of Truth

既存Observation LogのDurable Recordを権威ある状態入力とする。Memory Binding、Projection Cache、append戻り値、PlanチェックボックスだけをRecovery成功の証拠としない。

### 3.2 Verification Sequence

1. Durable Recordを読込む。
2. 現在CorrelationとAuthorizationを確認する。
3. Gate / Acceptanceを照合する。
4. 現在LifecycleをProjectionで確認する。
5. 必要な場合だけLifecycleをappendする。
6. append後にDurable Recordを再読込む。
7. 同一Identityと期待Lifecycle状態を確認する。
8. 正当に適用されたLifecycle遷移の根拠も確認する。
9. 検証成功の場合のみ正式完了とする。

Projectionは不正なTransitionを無視する場合があるため、期待するProjected Stateだけではなく、根拠となるDurable Lifecycle RecordのIdentity・遷移内容も確認する。

### 3.3 Readback Failure

Readback不可、対象Identityが欠測、Projectionに矛盾がある場合は `NOT_VERIFIED` とし成功に昇格させない。

append成功応答直後にReadbackが失敗した場合も、物理的な保存状態を断定しない。次回の再実行ではDurable Recordの現況から再判定し、既存遷移を重複適用しない。

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

### 5.1 Existing Entry Points

既存 `JusticePlugin.initialize()` の経路を再利用する。

- `restoreActivePlans()`
- `recoverStagedReviewCompletionsAfterRestart()`
- `recoverAcceptedTaskProgress()`
- `recoverPendingFinalizations()`

Staged Review CompletionがDurableに残り、既存RecoveryからEvaluatorへ再入できる場合は、その経路を優先する。

### 5.2 Narrow Recovery Fallback

現行のStaged Completion Recoveryは、Gate/Acceptance永続化後のすべての部分失敗を再処理できるとは確認されていない。

既存の再入経路だけで取りこぼすケースに限り、Durable状態から次の条件を満たすGatePending候補を検出し、**既存Evaluatorへ入力する限定Fallback**を設計候補とする。

- Active Authorizationに属する。
- Task `gate_pending` またはPlan `final_gate_pending`。
- 同一CorrelationのGate/Acceptanceを確認できる。
- 成功Terminal・Review帰属を既存Durable記録から証明できる。
- 別Attempt、別Round、競合状態ではない。

新しいReview Dispatch・Review Round・Task Attemptは起動しない。Identityが復元できない候補は推測補完せずに非受理とする。候補探索・呼出しの厳密な配置は設計採択前に決める。

### 5.3 Initialization Order

推奨する論理的順序は以下。

1. Authorization / Active Planを権威ある状態として復元する。
2. Projectionを初期化する。
3. Staged Completionの既存Recoveryを実行する。
4. 必要な場合のみ限定GatePending Recoveryを実行する。
5. Task Lifecycle `accepted` をDurable確認してPlan Progressを復元する。
6. 既存Finalization Recoveryを実行する。

既存の前段Finalization RecoveryやReview Dispatch Recoveryを無条件に削除・置換しない。上記は新規処理を既存シーケンスへ位置付けるための論理順序であり、具体的な再配置・削除を承認するものではない。

Authorizationの権威ある復元が成立しなければ、Recoveryによる書込みは行わない。

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

1. 複数プロセス間の排他保証は `NOT_PROVEN`。
2. Restart後の全対象に対する再入可能性は未実証。
3. ファイルI/Oの耐久性、外部Writer競合の保証は未確認。
4. Plan Progressの論理的一度限りの更新は設計目標であり、実装で保証済みではない。
5. S3-a M-2、Host Enforcement、全面Semantic Recoveryは対象外。
6. 既存Review Artifact側がDecision存在のみでterminalizedを判定する経路はあるため、Evaluatorによる整合成立と呼出元判定の契約を実装設計で明確にする必要がある。

## 10. Completion and Stop Conditions

- Design Draftの記録を今回の成果とし、Owner Design Adoptionを先取りしない。
- Requirements R0.1.1を変更しない。
- 新規Frameworkを作らない。
- Source Code、Test、CI、Gate/HOLDを変更しない。
- Commit/Push以外のPR作成・Merge・追加レビュー・後続実装を自動開始しない。
- 新規Findingだけで訂正・独立レビュー循環を始めない。

**Design Status:** `DESIGN_DRAFT / OWNER_ADOPTION_PENDING`  
**Implementation GO:** `HOLD`
