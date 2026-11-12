# Justice v6 S3-a — Authority / Review Boundary Implementation Plan R0.1.2 (F-002 Owner Option A Limited Remediation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` only after separate Human Owner implementation approval. Steps use checkbox (`- [ ]`) syntax for tracking. No automatic review dispatch.

**Goal:** 現在のReview Correlationに帰属するReview・EvidenceだけをGate判定へ採用し、旧Attempt・旧Round・矛盾したDecisionから不正なAcceptanceを確定させない。

**Architecture:** 既存のReview Dispatch State、Authorization Review Boundary、Review Aggregator、Gate Evaluation、Acceptance Decisionを再利用する。新しい共通FrameworkやAuthorization Managerを作らず、既存の判定経路に限定的なAdmission処理を追加する。

**Tech Stack:** TypeScript、Bun、Vitest、既存Observation Log / State Projection。

**Spec:** Justice v6 S3-a Design R0.1（Issue #356、Human Ownerの限定採択判断）。**Design全文との逐条照合は `NOT_VERIFIED`**：現在のGit参照からDesign全文を特定できていないため、Designとの完全一致・未確認要件の採択は主張しない。F-001〜F-004を本Planで明文化し、Designとの乖離が判明した場合は実装を止めてOwner判断とする。

**Reference HEAD:** `adf97c2d3dfd9b254c39206558f3fe9f0133eebe`。実装開始時には実際のHEADと差分を確認する。

**Plan status:** `PLAN_R0.1.2_OPTION_A_DOCUMENT_ONLY / OWNER_ADOPTION_PENDING / IMPLEMENTATION_HOLD`。Human OwnerはF-002に**方式A（最小限の永続帰属情報）**を採択し、本Plan限定訂正・1 Commit/Pushのみを承認。ソース変更、Build/Test、Gate変更、実装着手は未承認。

## Global Constraints

- Evidence AdmissionとGateDecision / AcceptanceDecisionの正式受理に限定する。
- Review Correlationは`task-review`と`final-review`の既存型を使用する。
- Task ReviewではAuthorization ID、Task ID、Attempt ID、Review Roundを照合する。
- Final ReviewではAuthorization ID、Plan Path、Plan Fingerprint、Finalization Attempt ID、Final Review Roundを照合する。
- 不明なReview Roundを`1`と推測しない。`gate_pending`時点の現在Correlationは、その時点のLifecycleと完了Terminal Slotから再検証する。
- 旧Attempt・別Round・別Task・別PlanのEvidenceを現在のReviewへ流用しない。
- Owner承認の真正性は`NOT_PROVEN`のまま維持する。
- 観測されたReview出力を独立した信頼できるHost証明として扱わない。
- 既存のAuthorization境界と直列化機構を維持する。
- S3-b Recovery、S3-c Host Enforcementは実装しない。
- Review Dispatcher、Agent実行、モデル選択、再レビュー、Gate/HOLD解除を自動開始しない。
- 既存Schema拡張はF-003の新規Task Decisionの`reviewRound`と、F-002に限定した`implementation_call_binding` Observation Recordに限る。`schemaVersion: 1`を維持し、旧履歴を推測で補完しない。
- S2-cの`PENDING_INPUT`を変更しない。

## File / Interface Map

| File | Responsibility | Scope |
|---|---|---|
| `src/core/acceptance-decision.ts` | 現在Correlation Admission、成功Terminal照合、Gate / Acceptance再利用時の整合性・Fail-Closed | Modify Tasks 1, 3 |
| `src/core/review-dispatch-state.ts` | 既存`ReviewDispatchSlot`、再試行Round算出の規則を参照。`review_pending`前提の関数を`gate_pending`で無条件に流用しない | Read; modify only if Task 1 needs a narrow reusable helper |
| `src/core/v2/review-aggregator.ts` | `review_observed.correlation`で限定した集約経路。従来の全体表示用集約は維持 | Modify Task 2 |
| `src/core/types.ts` | 既存の`ImplementationTaskCallBinding`と`TaskExecutionRef`を再利用 | Read Task 2 |
| `src/core/v2/observation-model.ts` | F-002専用の最小`implementation_call_binding` Observation Record | Modify Task 2 |
| `src/core/v2/state-projection.ts` | Durable Implementation Bindingの復元・競合検出（Review Bindingとは区別） | Modify Task 2 |
| `src/core/v2/gate-context.ts` | Task Gateへ確証済み`reviewRound`を入力、Final既存フィールドを維持 | Modify Task 3 |
| `src/core/v2/rule-evaluation-engine.ts` | **Task GateDecision生成責務**：`GateContext.reviewRound`を`TaskGateDecisionPayload.reviewRound`へ転送 | Modify Task 3 |
| `src/core/v2/decision-model.ts` | 新規Task Gate / Acceptance DecisionのRound付き型、旧型の読み取り互換 | Modify Task 3 |
| `src/runtime/validation.ts` | 新規Roundと専用Implementation Bindingの構造を検証。旧形式の読み取り互換を維持 | Modify Tasks 2, 3 |
| `src/hooks/observation-handler.ts` | Gate Ruleへ渡すEvidenceを、正式Admissionを通った入力に限定する | Modify Task 2 |
| `tests/core/acceptance-decision.test.ts` | Round 1/2、旧Attempt、Terminal / Observation照合、Decision再利用・矛盾 | Test Tasks 1, 3 |
| `tests/core/v2/review-aggregator.test.ts` | Round混在・空Snapshot・未帰属Observationを隔離 | Test Task 2 |
| `tests/core/v2/state-projection.test.ts` | 永続Bindingの復元・重複競合の非受理 | Test Task 2 |
| `tests/hooks/observation-handler-lifecycle.test.ts` | PreToolUse時のLifecycle→Binding保存順序と失敗 | Test Task 2 |
| `tests/hooks/observation-handler-tool.test.ts` | Call ID/Session/Attempt違いによるEvidence非受理 | Test Task 2 |
| `tests/core/v2/rule-evaluation-engine.test.ts` | GateContext → Task GateDecisionのRound伝播 | Test Task 3 |
| `tests/hooks/observation-handler-gate.test.ts` | Tool実行EvidenceのAdmissionとGate Rule入力境界 | Test Task 2 |
| `tests/runtime/validation.test.ts` | 既存の旧/新Decisionに加え専用Binding Recordを検証 | Test Tasks 2, 3 |
| `tests/core/review-artifact.test.ts` | 既存Clean Review completion → Gate → Acceptance fixtureを再利用 | Regression Task 4 |
| `tests/integration/s3a-review-artifact-to-acceptance.test.ts` | **新規**のReview Artifact → Terminal → Review Observation → Gate → Acceptance統合テスト | Create Task 4 |
| `tests/integration/approved-review-resolution.test.ts` | 既存`justice_review.resolve`の挙動の回帰のみ。上記統合テストの代用にしない | Regression-only Task 4 |

## Fixed Implementation Contracts — F-001 / F-002 / F-003

### F-001: Current Correlation at `gate_pending`

`src/core/acceptance-decision.ts`の狭い関数として以下を設ける（公開Frameworkは作らない）。

```ts
type CurrentReviewAdmission =
  | { readonly kind: "admitted"; readonly correlation: ReviewCorrelation }
  | { readonly kind: "not_proven"; readonly reason: string }
  | { readonly kind: "conflict"; readonly reason: string };

function admitCurrentReview(
  context: GatePendingAttemptContext,
  state: ProjectedState,
  records: readonly PersistedLogRecord[],
  binding: Extract<ApprovedPlanBinding, { readonly status: "active" }>,
): CurrentReviewAdmission;
```

1. `context.parentSessionId`、Active Authorizationの`binding.sessionId`と対象Task／Planの所属を照合。`isGatePending(context, state)`を満たさない場合は`not_applicable`（本関数の前で判定）。
2. Taskは`TaskExecutionRef = {authorizationId,taskId,attemptId}`の完全一致を現在Lifecycleに要求。Finalは`authorizationId`、`planPath`、`planFingerprint`、`finalizationAttemptId`、`finalReviewRound`を完全一致させる。
3. `state.reviewDispatchSlots`から`parentSessionId`と現在の実行Identityに一致する**成功Terminal**（`state === "terminal"`、`terminalReason === "completed"`）だけを候補にする。`completed_with_findings`は現行Review Artifact経路ではRework、`review_incomplete`・cancel/failure terminalは不採用。
4. Task Roundは成功Terminal Slotの`correlation.reviewRound`から確証し、`1`の固定値や`Math.max`だけで復元しない。Retry Round 2では旧Round 1の失敗Terminalを不採用とし、現在Round 2の成功Terminalを選ぶ。FinalはGate contextの`finalReviewRound`とTerminalのRoundを突合する。
5. 同一実行Identityに競合する成功Terminal候補が複数ある場合は、最大値や最新時刻で選ばず`conflict`とする（同一Correlationの再送重複もDurable TransitionのIdempotencyを別途確証できない限り競合）。
6. Terminalから確証したCorrelationと`review_observed.correlation`が`sameReviewCorrelation`で一致し、`record.sessionId === context.parentSessionId`、Taskは`record.taskId`一致と`reviewScope === "task:" + taskId`、Finalは`reviewScope === "final"`、`isCompleteSnapshot === true`かつ`items.length === 0`を満たすことを確認する。Session/Scopeだけの一致を認めない。
7. 合致するObservationなし、Correlation欠落、旧Attempt/旧Round、候補競合は`not_proven`／`conflict`。`gate_pending`中は正式Gate / Acceptanceを書き込まず`blocked`を返す。通常Task進行や無関係なIdentityは停止しない。

**Reason codes（Evaluatorの非受理Advisoryのみ、永続Schema拡張なし）：**
`review_correlation_not_proven`／`review_correlation_conflict`。既存`review_authorization_not_active`は維持。

### F-002: Evidence Admission — Owner Option A: Minimal Durable Attribution

**Owner decision:** 方式Aを採択。現行の`ImplementationTaskCallBinding`は`SessionStateProvider`の`Map<callId, TaskCallBinding>`に保持され、`closeActiveTaskWindow(callId)`で削除される。現行のDurable Recordから`callId`と`TaskExecutionRef`を復元できないため、Task ID・Session ID・時系列だけでAttemptを推測してはならない。

**Exactly one minimal record variant**（汎用Binding Frameworkや新Storageを作らない）:

```ts
type ImplementationCallBindingObserved = {
  readonly kind: "implementation_call_binding";
  readonly parentSessionId: string;
  readonly callId: string;
  readonly authorizationId: string;
  readonly taskExecutionRef: TaskExecutionRef;
};
// Existing PendingEnvelope:
// recordType:"observation", schemaVersion:1;
// existing PersistedEnvelope.sequence after append
```

**Write:** `src/hooks/observation-handler.ts`の`handlePreToolUse`で正式Authorizationと`TaskExecutionRef`を確定し、**初期Task LifecycleのDurable append成功後**にこのRecordを同じLogへappendする。`authorizationId === taskExecutionRef.authorizationId`、`parentSessionId === event.sessionId`、非空`callId`を検証する。Memory Mapの登録やPreToolUse成功のみでは証拠にしない。Lifecycle成功・Binding append失敗は部分成功として扱い、既存Toolの`PROCEED`を不要に変えず**正式GateではBinding不在としてFail-Closed**にする。保存に失敗したRecordを時系列から合成しない。

**Readback:** `src/core/v2/observation-model.ts`のObservation Unionと`src/runtime/validation.ts`へ専用variantを追加。既存`schemaVersion:1`とValidation契約に従い、Record kind、parentSessionId、callId、authorizationId、TaskExecutionRef各値の型・非空・一致を確認する。`src/core/v2/state-projection.ts`でDurable Logのみから`(parentSessionId,callId)`→`TaskExecutionRef`を復元し、Review Dispatch由来の`taskCallBindings`と区別。異なるAttemptを指す重複Binding、破損・未読取・保存失敗は`CONFLICT`／`UNATTRIBUTED`として不採用。正常再起動時はDurable Readbackを再検証して利用する。

**Execution Evidence Admission (same parent execution call):** `FullEvidenceRef{agentId,sessionId,writerId,sequence,evidenceId}`を使って実在の`tool_executed` Recordを一意特定し、当該Recordの`callId`、`sessionId`、`taskId`、Evidence ID、呼び出し側の`parentSessionId`、Durable Bindingの`authorizationId/taskId/attemptId`を**すべて**照合する。対象は`record.sessionId === binding.parentSessionId`かつ`record.callId === binding.callId`が立証された呼び出し。`SelfEvidenceRef`、Task IDのみ、出力文字列、単なる時系列、Memory BindingのみでのAdmissionは禁止。`declared_claim`は既存のAuthoritative `command_exec`条件を満たさない。

**Child Session limit:** 親のImplementation `task` Call IDと子Session内Tool Call IDは異なる。今回の最小Bindingだけでは子の独立Tool実行を親Attemptへ帰属させられない。子Toolは**その親子関係とCallの対応を永続かつ観測済みのIdentityで証明できる場合のみ**採用。現行の`delegated_execution_binding`はReview用でありImplementationへ無条件転用しない。関係が実在Recordから証明できない場合、子のBuild/Test結果は`UNATTRIBUTED`として除外する。正常Gateが制限される可能性を隠さず、新しいChild-Attribution Frameworkを本Taskに加えない。

**Review Evidence Admission:** 従来のF-001/F-002条件を維持。`review_observed.correlation`、`ReviewTaskCallBinding`、成功Terminal Slot、`review_completion_staged`／Review ArtifactのIdentityが同一Review Correlationを指すことを照合。Review Observationの`callId`欠落を時系列で推測しない。Diagnostic用グローバルReview Summaryを正式Gateへ混入させない。

**Formal outcomes:**
- **正常系:** LifecycleとBindingのappend成功＋Durable Readback一致＋同一`parentSessionId/callId/TaskExecutionRef`のAuthoritative実行Evidence（`FullEvidenceRef`の元Recordも一致）＋現在Reviewの成功Terminal・Review Observation一致。既存Gate Rulesの必要証拠が揃った場合に限り`ADMIT`。親Bindingだけで子Tool結果の正常Admissionまで保証しない。
- **欠測系:** Bindingがない／失敗／競合／復元不可、別Session・別Call ID・旧Attempt、子Tool未結合、旧Round、破損Refの場合は`UNATTRIBUTED`または`CONFLICT`として**対象Evidenceを除外**。失敗を観測した`FAIL`と未証明を混同しない。必要EvidenceのないGateから正式`PASS` Acceptanceを確定させず、該当受理のみ`blocked`でFail-Closed（方式B相当）。Execution Evidenceを必要としない別の実証済みReview Gateまで機械的に停止しない。

**Security / nonfunctional:** BindingにはIdentityの最小メタデータだけを保存し、Tool生出力・Secrets・認証情報を含めない。旧ログにBindingを補記したことにせず、そのEvidenceは正式受理には使わない。既存Observation Log・Validation・Authorization Boundaryを再利用する。

| Test Case | Binding | Evidence | Expected |
|---|---|---|---|
| 正常・同一親Call / Attempt | 永続保存とReadback一致 | 同一CallのAuthoritative FullEvidenceRef | Admit（必要Gate条件が成立した場合のみ） |
| 正常ReviewのみでExecution証拠不要 | Review Correlationの永続経路が一致 | Executionを要求しない | Review Ruleの既存契約に従う |
| 旧Attempt／別Session／別Call | 保存ありだが不一致 | Tool Recordあり | UNATTRIBUTED、必要Gateはblock |
| 保存失敗／再起動後欠測 | 未確証 | Tool Recordあり | UNATTRIBUTED、必要Gateはblock |
| Binding競合・不正Record | CONFLICT | 任意 | 非受理 |
| 親Bindingのみで子Session Tool実行 | 親のみ確認 | 子Callは独立 | 子の永続帰属が別途確認できなければ非受理 |
| Declared Claimのみ | 完全一致 | Authoritative command_exec不在 | 実行証拠要件を満たさない |

Gateへ渡す入力は`admittedExecutionEvidence`と`admittedReviewSummary`だけとし、未確証の実行証拠は含めない。

### F-003: Round-Safe Decision Generation / Storage / Validation

1. **Generator:** `src/core/v2/gate-context.ts`のTask variantへ`readonly reviewRound: number`を追加。`src/core/v2/rule-evaluation-engine.ts`の`evaluate(gates,evidence,ctx)`がTask GateDecisionへ`reviewRound: ctx.reviewRound`をセットする。Finalは既存`finalReviewRound`を維持。
2. **Evaluator:** `createGatePendingAttemptEvaluator`がF-001で確証したCorrelationの`reviewRound`をGateContextへ渡し、`evaluateRules`の出力がTaskExecutionRef/Review Round（Finalでは全Final Identity）と一致することを永続化前に検証。外部Callbackが別RoundのGateを返したら`blocked`。`pending(context,result)`は検証済みPayloadだけを保存する。`deriveAcceptanceDecision(gate)`、`blockedAcceptance(context, correlation)`も確証済み`reviewRound`を引き継ぐ。**Round未確証ならBlocked Acceptanceすら推測書込みしない**。
3. **Types:** `src/core/v2/decision-model.ts`の新規`TaskGateDecisionPayload`／`TaskAcceptanceDecisionPayload`には`readonly reviewRound: number`を必須にする。Historical Task Gate/Acceptance（TaskExecutionRefあり・Roundなし）と、既存`LegacyTaskGateDecision`（TaskExecutionRefなし）を読み取り専用の互換型として明示し、現在の`GateDecision`／`AcceptanceDecision` Lookupから分離する。全レコードの`schemaVersion`は`1`を維持。
4. **Validation:** `src/runtime/validation.ts`の`validateDecisionRecord`にTask Gate/Acceptanceの`reviewRound`正整数（`Number.isSafeInteger`かつ`> 0`）を追加。旧形式で**フィールド自体が欠落**するRecordは読み取り互換を維持、`reviewRound: 0/-1/NaN/null/"1"`のような不正な「存在する値」は拒否する。Plan DecisionにTask用`reviewRound`を混入させない。
5. **Lookup:** `findCurrentGateDecision`／`findCurrentAcceptanceDecision`はTaskExecutionRefと`reviewRound`双方の一致を要求。Historical Round欠落Decisionが現在Attemptと一致する場合、`missing`扱いで新規PASSを重複作成せず`conflict`／`decision_integrity_violation`で正式受理を停止する。旧Roundが明確なDecisionは現在Roundに採用しない。
6. **Verdict invariant:** Gate `PASS` ⇔ Acceptance `accepted`、Gate `WARN`／`FAIL` ⇔ Acceptance `rework-required`。Gateに対応する`blocked` Acceptanceや逆向きVerdictを、両Decision存在時の正式完了と認めない。同一Correlationに複数Decisionがある場合、値が同じでも重複競合。GateだけDurableな場合のAcceptance再生成も現在RoundとActive Authorizationを再照合してから実行する。
7. **Ordering:** 既存`withAuthorizationReviewBoundary`、Identity別直列化、Gate→Acceptance→Lifecycle append順序と失効再確認は維持。Appended Gateだけが残ってもRoundを後から推測せず、現在一致したGateからのみ復旧できる。

**Boundaries:** Schema Versionの増分、一般化Decision Framework、Host実行前拒否、Review Dispatcher変更は対象外。正式なAcceptanceの`FAIL-CLOSED`と通常Workflowの継続可能性を区別する。


## Review Focus — Five High-Risk Conditions

1. **旧Attempt混入：** 同一TaskでもAttempt IDが異なるReviewを正式受理しない。
2. **旧Round混入：** Review Roundが異なるFindingsや空のComplete Snapshotを現在のReviewに混入させない。
3. **Evidence誤帰属：** Task IDだけが一致するTool Evidenceを現在Correlationの証拠として無条件に採用しない。
4. **Decision誤再利用：** Roundを証明できない旧GateDecision / AcceptanceDecisionを正式判定へ再利用しない。
5. **Decision矛盾・権限失効：** GateとAcceptanceの判定が矛盾する場合や、処理途中でAuthorizationが失効した場合は正式受理を停止する。

これらは以下のTaskのテストへ直接組み込む。

---

### Task 1: Current Review Correlation Admission (F-001)

**Files:**
- Modify: `src/core/acceptance-decision.ts`（`admitCurrentReview`と`hasTerminalReview`置換）
- Read/optional narrow helper: `src/core/review-dispatch-state.ts`（`review_pending`専用関数を無条件流用しない）
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:** `admitCurrentReview(context,state,records,activeBinding): CurrentReviewAdmission` → Task 2 / Task 3が消費する`correlation`。戻り値`not_proven`・`conflict`は正式受理禁止、無関係Taskは停止しない。

- [ ] **Step 1 — RED test:** `it("admits a clean completed terminal round 1 with matching observed correlation", ...)`を作成。期待: `decided`、Gate 1件、Acceptance 1件。
- [ ] **Step 2 — RED test:** `it("admits retry round 2 after failed round 1, without reusing round 1", ...)`を作成。期待: Round 2だけGate評価、旧Round 1のSnapshot不使用。
- [ ] **Step 3 — RED test:** `it("rejects wrong parentSessionId, attempt, finalization, round, or missing terminal/observed correlation", ...)`を作成。期待: `blocked`、Decision append 0件（未確証）、新規評価呼出し0件。
- [ ] **Step 4 — RED run:** `bun run vitest run tests/core/acceptance-decision.test.ts -t "round"`。期待: 新しいRound 1/2・不正Correlationテストが`FAIL`（既存実装の`reviewRound: 1`固定、Terminal照合不足を実証）。テスト名とコマンドのフィルタを一致させる。
- [ ] **Step 5 — GREEN:** `gate_pending`時点のLifecycle、`parentSessionId`、Active Binding、成功Terminal Slot、Correlation付き空Complete SnapshotをF-001固定契約で照合。候補競合・未確証は`blocked`。既存正常Round 1 / Retry Round 2を成立させる。
- [ ] **Step 6 — GREEN run:** `bun run vitest run tests/core/acceptance-decision.test.ts`。期待: 追加テストと既存テストが`PASS`。
- [ ] **Step 7 — Commit boundary (implementation approval required):** `git add src/core/acceptance-decision.ts tests/core/acceptance-decision.test.ts`（`review-dispatch-state.ts`を変更した場合のみ追加）→ `git commit -m "fix(justice): admit current completed review correlation"`。REDのままCommitしない。

**Stop:** 必要なCorrelationが永続記録から確証不能なら当該GateはFail-Closed、追加Frameworkへ拡張せずOwner判断材料にする。

---

### Task 2: Durable Implementation Binding / Review and Execution Evidence Isolation (F-002, Owner Option A)

**Files:** Modify `src/core/v2/observation-model.ts`、`src/runtime/validation.ts`、`src/hooks/observation-handler.ts`、`src/core/v2/state-projection.ts`、`src/core/v2/review-aggregator.ts`、`src/core/acceptance-decision.ts`。Read `src/core/types.ts`。Test `tests/runtime/validation.test.ts`、`tests/hooks/observation-handler-lifecycle.test.ts`、`tests/hooks/observation-handler-tool.test.ts`、`tests/core/v2/state-projection.test.ts`、`tests/core/v2/review-aggregator.test.ts`、`tests/hooks/observation-handler-gate.test.ts`。

**Interfaces:** F-002で固定した専用`ImplementationCallBindingObserved`を既存Logへappend。Durable Readbackだけから`(parentSessionId,callId)`と`TaskExecutionRef`を結合し、Current Review Correlationに一致したGateへ`admittedExecutionEvidence`／`admittedReviewSummary`を供給する。未確認は`UNATTRIBUTED`、競合は`CONFLICT`としてGateに入力しない（独立Frameworkは作らない）。

- [ ] **Step 1 — RED test:** `it("validates a durable implementation call binding", ...)`。正常Recordを受理し、空Call ID／Authorization不一致／破損TaskExecutionRefを拒否し、旧Logの読み取りを維持する。
- [ ] **Step 2 — RED test:** `it("persists implementation call binding after initial lifecycle", ...)`／`it("does not admit evidence when binding append fails", ...)`。正常時にLifecycle→Binding順でappendし、失敗時にメモリ値を正式根拠にしない。
- [ ] **Step 3 — RED test:** `it("restores durable implementation binding after restart", ...)`／`it("rejects conflicting bindings for one parent call", ...)`。正常復元と重複Identity競合を確認。
- [ ] **Step 4 — RED test:** `it("admits same-attempt evidence with exact FullEvidenceRef and call identity", ...)`、`it("rejects missing binding, taskId-only, wrong session, wrong call, old attempt and unlinked child tools", ...)`。欠測時は必要Gateから正式Acceptanceを確定しない。
- [ ] **Step 5 — RED test:** `it("isolates previous-round findings and complete snapshots from current review", ...)`。現在Correlation内のReview Summaryだけを採用。
- [ ] **Step 6 — RED run:** `bun run vitest run tests/runtime/validation.test.ts tests/hooks/observation-handler-lifecycle.test.ts tests/hooks/observation-handler-tool.test.ts tests/core/v2/state-projection.test.ts tests/core/v2/review-aggregator.test.ts tests/hooks/observation-handler-gate.test.ts`。期待: 追加テストがBaselineではFAIL（専用永続Record、復元、Admission境界がないため）。無関係な既存Failureと混同しない。
- [ ] **Step 7 — GREEN:** F-002のRecord保存・Validation・復元・EvidenceRef/Call/Attempt照合とReview隔離だけを実装。Child Sessionの帰属を推測せず、欠測Evidenceを除外。通常Tool実行は維持し、正式AcceptanceだけFail-Closed。
- [ ] **Step 8 — GREEN run:** Step 6と同じコマンドを再実行。正常・欠測・競合・再起動・Review隔離がPASSすること。親Bindingのみで子ToolのBuild/TestがPASSすると主張しない。
- [ ] **Step 9 — Commit boundary (future implementation approval only):** 実際に変更したTask 2対象のSource/Testだけを`git add`し、`git commit -m "fix(justice): persist minimal execution call attribution"`。**本ドキュメント承認には実装Commitの権限を含めない。**

**Stop:** 既存永続Recordから子Session実行のIdentityが証明できなければ、そのEvidenceを非受理として正常Gateへの制限を記録し、このTaskの範囲を自動拡張しない。

---

### Task 3: Round-Safe GateDecision / AcceptanceDecision (F-003)

**Files:**
- Modify: `src/core/v2/gate-context.ts`（Task`reviewRound`）
- Modify: `src/core/v2/rule-evaluation-engine.ts`（Task Gate生成・Round転送）
- Modify: `src/core/v2/decision-model.ts`（新規必須Round、旧記録の読取型）
- Modify: `src/core/acceptance-decision.ts`（確証／保存／Lookup／Verdict・二重書込み防止）
- Modify: `src/runtime/validation.ts`（旧形式互換、新形式検証）
- Test: `tests/core/v2/rule-evaluation-engine.test.ts`
- Test: `tests/core/acceptance-decision.test.ts`
- Test: `tests/runtime/validation.test.ts`

**Interfaces:**
- Consumes: Task 1の確証済み`ReviewCorrelation.reviewRound`とTask 2のAdmission済みGate入力
- Produces: 新規`TaskGateDecisionPayload.reviewRound`、`TaskAcceptanceDecisionPayload.reviewRound`。旧Round欠落Recordsは読取専用、Formal Lookupは`conflict`で非受理。

- [ ] **Step 1 — RED test:** `it("propagates a proven task review round into the generated GateDecision", ...)`。期待: Gate Round 2と確証済みContext Round 2一致。
- [ ] **Step 2 — RED test:** `it("validates round-bearing decisions while reading historic roundless records", ...)`。期待: 新形式Round=1/2受理、存在する不正Round=0/negative/float/null/string拒否、Round欠落歴史形式は読取可。
- [ ] **Step 3 — RED test:** `it("rejects replay of a historic roundless task decision", ...)`、`it("rejects conflicting Gate and Acceptance verdicts", ...)`、`it("rejects duplicate current decisions", ...)`。期待: Gate/Acceptanceは正式受理されず`decision_integrity_violation`。
- [ ] **Step 4 — RED run:** `bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/core/acceptance-decision.test.ts tests/runtime/validation.test.ts`。期待: 新しいRound伝播・旧形式拒否・矛盾テストが`FAIL`。既存テストの型Fixture更新だけでGREEN扱いにしない。
- [ ] **Step 5 — GREEN:** `GateContext.reviewRound`→`rule-evaluation-engine.evaluate`→EvaluatorのIdentity検証→`pending(context, result)`→`deriveAcceptanceDecision`→`appendDecision`をF-003の責務で連結。`blockedAcceptance`は確証済みRoundがある場合のみ生成。
- [ ] **Step 6 — GREEN:** `validateDecisionRecord`で新形式を検証、旧形式は読めるがCurrent Lookupから除外。既存Finalの`finalReviewRound`は維持。二重Decision・Verdict不一致は`blocked`。
- [ ] **Step 7 — GREEN run:** `bun run vitest run tests/core/v2/rule-evaluation-engine.test.ts tests/core/acceptance-decision.test.ts tests/runtime/validation.test.ts`。期待: Round、失効、再実行、重複、歴史型互換テストが`PASS`。
- [ ] **Step 8 — Commit boundary (implementation approval required):** `git add src/core/v2/gate-context.ts src/core/v2/rule-evaluation-engine.ts src/core/v2/decision-model.ts src/core/acceptance-decision.ts src/runtime/validation.ts tests/core/v2/rule-evaluation-engine.test.ts tests/core/acceptance-decision.test.ts tests/runtime/validation.test.ts` → `git commit -m "fix(justice): persist and validate round-safe decisions"`。

**Stop:** 旧Recordが現在Roundの正式Decisionとして扱われる、または保存前に別RoundのDecisionへすり替わり得る状態なら、Acceptanceを停止。

---

### Task 4: Review Artifact → Terminal → Gate → Acceptance Integration (F-004)

**Files:**
- Create: `tests/integration/s3a-review-artifact-to-acceptance.test.ts`
- Test/Reuse: `tests/helpers/review-artifact-e2e-fixture.ts`、`tests/core/review-artifact.test.ts`
- Regression-only: `tests/integration/approved-review-resolution.test.ts`（`justice_review.resolve`の承認付きFinding解決経路であり、Review completion→Acceptanceの代替テストにはしない）
- Test: `tests/core/review-dispatch-state.test.ts`、`tests/core/review-dispatch-state-behavior.test.ts`、`tests/core/v2/gate-provenance-gating.test.ts`

**Interfaces:** Task 1〜3のAdmission・Round伝播・正式受理経路を、既存`createReviewCompletionDomain`とDurable Review Dispatch Fixtureから通す。新規Hostや別Reviewを起動しない。

- [ ] **Step 1 — RED test:** `it("accepts a matching round-1 review artifact through terminal, observation, gate and acceptance", ...)`を作成。期待: `review_completion_staged`→`review_dispatch_transition(to=terminal,terminalReason=completed)`→`review_observed(correlation一致)`→Task Gate Round 1→Task Acceptance Round 1→Lifecycle accepted（各1件）。
- [ ] **Step 2 — RED test:** `it("accepts completed retry round 2 but never old round 1 evidence", ...)`。期待: Round 2のみ採用、Round 1は失敗Terminalとして残るが混入なし。
- [ ] **Step 3 — RED test:** `it("does not accept mismatched parent session, roundless decision, conflicting verdict or revoked authority", ...)`。期待: 不正な正式Acceptance / Lifecycle accepted 0件。
- [ ] **Step 4 — RED run:** `bun run vitest run tests/integration/s3a-review-artifact-to-acceptance.test.ts`。期待: 新規テストが既存経路の未補強箇所で`FAIL`。
- [ ] **Step 5 — GREEN:** Task 1〜3で指定済みの変更に限って結線し、上記統合テストを満たす。新しいReview Dispatcher、Semantic Recovery、Host Enforcementを追加しない。
- [ ] **Step 6 — GREEN run:** `bun run vitest run tests/integration/s3a-review-artifact-to-acceptance.test.ts tests/core/review-artifact.test.ts tests/integration/approved-review-resolution.test.ts`。期待: 正常Round 1/2、否定ケースと既存レビュー解決の回帰が`PASS`。
- [ ] **Step 7 — Regression:** `bun run vitest run tests/core/acceptance-decision.test.ts tests/core/v2/review-aggregator.test.ts tests/core/v2/rule-evaluation-engine.test.ts tests/hooks/observation-handler-gate.test.ts tests/runtime/validation.test.ts tests/core/review-dispatch-state.test.ts tests/core/review-dispatch-state-behavior.test.ts tests/core/v2/gate-provenance-gating.test.ts`。期待: 新規・既存が`PASS`。
- [ ] **Step 8 — Static/build:** `bun run typecheck`、`bun run build`、`bun run lint`を実行。既知Warningと新しいErrorを区別し、実測値のみ報告する。
- [ ] **Step 9 — Commit boundary (implementation approval required):** `git add tests/integration/s3a-review-artifact-to-acceptance.test.ts`（Task 4で実際に変更した追加Fixtureのみ含める）→ `git commit -m "test(justice): cover S3-a review admission end to end"`。変更がなければ空Commitを作らない。

**Deliverable:** Review ArtifactからGate/Acceptanceまでの正常・異常ケースを実際の接続で証明。`justice_review.resolve`のテストを誤用しない。

---


## Completion Criteria

Implementation Plan R0.1.2の文書限定訂正条件：

- [x] F-001〜F-003の実装判断（Current Correlation / Evidence Binding / Decision Round）をPlan内に固定
- [x] Owner採択の方式AをF-002専用の最小永続Binding Recordとして固定し、帰属未確証では方式B相当のFail-Closedを適用
- [x] F-004のRED / GREEN / Verify / Commit境界と独立Integration対象を固定
- [ ] Design全文との逐条整合は `NOT_VERIFIED`（Designの本文が現行Git参照から確認できないため、ドキュメント差分なしと断定しない）
- [x] 変更ファイル・既存インターフェースを特定
- [x] 各TaskにRED / Expected Failure / GREEN / Verify / Commitを設定
- [x] 旧Attempt、旧Round、Evidence誤帰属、Decision矛盾、Authorization失効をテスト対象化
- [x] Human Owner Checkpointと停止条件を明記

実装完了条件（別途承認後）：

- [ ] 現在CorrelationのReviewだけがTerminal Reviewとして正式に認められる。
- [ ] Gateに異なるCorrelationのEvidence / Review Summaryが混入しない。
- [ ] Round不明のDecisionを再利用しない。
- [ ] Decisionが矛盾する場合に正式Acceptanceが確定されない。
- [ ] 正常なTask / Final Reviewが不要に停止しない。
- [ ] 指定した受入・回帰テストで観測結果を取得する。
- [ ] 既存Authorization・Superpowers・OpenCodeの責務を重複実装しない。

## Stop Conditions

以下を検知した場合、影響する正式受理操作を停止する。

- 現在Review Correlationを確証できない。
- Review Roundの帰属を確認できない。
- 旧Attempt・別RoundのEvidenceが混入している。
- GateDecisionとAcceptanceDecisionが矛盾する。
- Authorizationが失効または競合している。
- 既存Schemaを安全な互換性なしに変更する必要が生じた。
- 原本・永続RecordのIdentityやデータ保全を破壊するおそれがある。

停止は正式受理などの保護対象操作に限定する。無関係な通常Taskの実行まで自動停止させない。

## Scope Exclusions

- S3-b Semantic Recovery / S3-c Host Enforcement
- 新しいAuthorization Manager / 共通Evidence Admission Framework
- 新規Review Dispatcher / Review起動・再レビュー自動化
- 新しいモデルRouting / S2-c比較実験
- GitHubへの無承認書き込み / Gate・HOLDの自動変更

## Human Owner Checkpoint

Task 1〜4の実行結果が得られた時点で実装を終了する。結果が`PASS`でもOwner承認真正性やHost実行の完全な安全性が証明されたとは扱わない。

失敗・未検証・設計上の制約を区別し、Human Ownerへ、実証できた受理境界の強化、正常フローへの影響、残余リスクと適用制限、この範囲で採用・保留・終了する選択肢を提示する。

新規FindingやReview結果を理由に別Task・独立レビュー・再訂正を自動開始しない。

**本R0.1.2はF-002方式Aの文書限定訂正・1 Commit/Pushのみ承認済み。Implementation HOLDを維持し、ソース編集・Build/Test・追加レビュー・Gate変更・他ファイルへのGitHub書込みは未承認。Design全文の逐条確認は `NOT_VERIFIED`。**
