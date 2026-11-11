# Justice v6 S3-a — Authority / Review Boundary Implementation Plan R0.1.1 (F-001–F-004 Limited Remediation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` only after separate Human Owner implementation approval. Steps use checkbox (`- [ ]`) syntax for tracking. No automatic review dispatch.

**Goal:** 現在のReview Correlationに帰属するReview・EvidenceだけをGate判定へ採用し、旧Attempt・旧Round・矛盾したDecisionから不正なAcceptanceを確定させない。

**Architecture:** 既存のReview Dispatch State、Authorization Review Boundary、Review Aggregator、Gate Evaluation、Acceptance Decisionを再利用する。新しい共通FrameworkやAuthorization Managerを作らず、既存の判定経路に限定的なAdmission処理を追加する。

**Tech Stack:** TypeScript、Bun、Vitest、既存Observation Log / State Projection。

**Spec:** Justice v6 S3-a Design R0.1（Issue #356、Human Ownerの限定採択判断）。**Design全文との逐条照合は `NOT_VERIFIED`**：現在のGit参照からDesign全文を特定できていないため、Designとの完全一致・未確認要件の採択は主張しない。F-001〜F-004を本Planで明文化し、Designとの乖離が判明した場合は実装を止めてOwner判断とする。

**Reference HEAD:** `adf97c2d3dfd9b254c39206558f3fe9f0133eebe`。実装開始時には実際のHEADと差分を確認する。

**Plan status:** `PLAN_R0.1.1_LIMITED_REMEDIATION / OWNER_ADOPTION_PENDING / IMPLEMENTATION_HOLD`。今回の文書訂正・Commit・PushのみHuman Owner承認済み。ソース編集、Build/Test、Gate変更、実装着手は未承認。

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
- 既存Schemaの拡張は新規Task Decisionの`reviewRound`に限定する。永続レコードは`schemaVersion: 1`のまま互換を保ち、Round未記録の履歴は読み取り可・正式再利用不可とする。
- S2-cの`PENDING_INPUT`を変更しない。

## File / Interface Map

| File | Responsibility | Scope |
|---|---|---|
| `src/core/acceptance-decision.ts` | 現在Correlation Admission、成功Terminal照合、Gate / Acceptance再利用時の整合性・Fail-Closed | Modify Tasks 1, 3 |
| `src/core/review-dispatch-state.ts` | 既存`ReviewDispatchSlot`、再試行Round算出の規則を参照。`review_pending`前提の関数を`gate_pending`で無条件に流用しない | Read; modify only if Task 1 needs a narrow reusable helper |
| `src/core/v2/review-aggregator.ts` | `review_observed.correlation`で限定した集約経路。従来の全体表示用集約は維持 | Modify Task 2 |
| `src/core/v2/gate-context.ts` | Task Gateへ確証済み`reviewRound`を入力、Final既存フィールドを維持 | Modify Task 3 |
| `src/core/v2/rule-evaluation-engine.ts` | **Task GateDecision生成責務**：`GateContext.reviewRound`を`TaskGateDecisionPayload.reviewRound`へ転送 | Modify Task 3 |
| `src/core/v2/decision-model.ts` | 新規Task Gate / Acceptance DecisionのRound付き型、旧型の読み取り互換 | Modify Task 3 |
| `src/runtime/validation.ts` | 新規Roundは正整数で検証、旧Round欠落Recordは読取可能に維持 | Modify Task 3 |
| `src/hooks/observation-handler.ts` | Gate Ruleへ渡すEvidenceを、正式Admissionを通った入力に限定する | Modify Task 2 |
| `tests/core/acceptance-decision.test.ts` | Round 1/2、旧Attempt、Terminal / Observation照合、Decision再利用・矛盾 | Test Tasks 1, 3 |
| `tests/core/v2/review-aggregator.test.ts` | Round混在・空Snapshot・未帰属Observationを隔離 | Test Task 2 |
| `tests/core/v2/rule-evaluation-engine.test.ts` | GateContext → Task GateDecisionのRound伝播 | Test Task 3 |
| `tests/hooks/observation-handler-gate.test.ts` | Tool実行EvidenceのAdmissionとGate Rule入力境界 | Test Task 2 |
| `tests/runtime/validation.test.ts` | 現行`schemaVersion: 1`の旧/新Decision読み取り | Test Task 3 |
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

### F-002: Evidence Admission — execution vs review

`EvidenceRef`は`FullEvidenceRef{agentId,sessionId,writerId,sequence,evidenceId}`として元のDurable Recordを一意参照できることを検証し、`SelfEvidenceRef`や単なる一致文字列を正式Gate根拠に昇格しない。

- **Execution Evidence（test/build/lint/command）:** `tool_executed`の`callId`、`sessionId`と`taskId`、`EvidenceRef`で参照するRecordのShard/Sequence/Evidence IDを照合。`ImplementationTaskCallBinding`（`parentSessionId`、`authorizationId`、`taskExecutionRef`）に`callId`を結合し、現在Task Attemptと完全一致する場合のみ採用する。Child Session由来なら、保存済みObserved Relation / Typed Bindingで親子・call IDを確証できる場合だけ認める。Task IDのみ一致、Active Windowだけの推測、宣言だけの成功Claimは不可。Execution Evidence自体にReview Roundを捏造せず、**現在Reviewが対象とする同じTask Attemptに帰属すること**で結ぶ。
- **Review Evidence（`review_observed`のItems / Complete Snapshot）:** `review_observed.correlation`を現在Review Correlationと完全照合し、`ReviewTaskCallBinding`（`parentSessionId`、`callId`、`correlation`）と`ReviewDispatchSlot`、`review_completion_staged`／`ReviewArtifact`のIdentityの連鎖を確認する。`reviewScope`、`sessionId`、`EvidenceRef`だけの一致を正式帰属としない。`review_observed`自体に`callId`が無い場合、SlotとArtifact/Stagingの保存済み連鎖で結び付けられることが必要。
- **Binding不足:** 現行`projected.tasks.get(taskId)?.evidence`にはAttemptの独立証明がなく、`ToolExecutedRecord`もTaskExecutionRefを直接持たない。評価境界で取得できるTyped Bindingが永続Recordと整合しない、または消失している場合は`UNATTRIBUTED`（当該EvidenceのAdmission拒否）。この制約を埋めるための新規共通Binding Schemaは本Scopeで作らない。
- **Missing / Negative:** 未帰属Evidenceを「検証済みFAIL」と捏造せず`onMissingEvidence`契約で扱う。ただし`PASS`を発行するための必須証拠が欠測・未確証なら正式Acceptanceへ昇格させず`blocked`でFail-Closedとする。別ReviewのClean Snapshotを欠測代用にしない。
- **Positive:** 正しい`parentSessionId + callId + TaskExecutionRef`と、同じAttemptの現在Review Correlation / 成功Terminal / 一致するReview Observationが揃うFixtureでは、既存ルールに従い正式Admissionできる。

Gateへの入力は`admittedExecutionEvidence`と`admittedReviewSummary`に限定する。Diagnostic用途の全体表示集約は変更しない。Reviewの「観測された出力」はHost真正性やOwner承認の証明にはならない。

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

### Task 2: Review Summary / Gate Evidence Isolation (F-002)

**Files:**
- Modify: `src/core/v2/review-aggregator.ts`
- Modify: `src/core/acceptance-decision.ts`
- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/core/v2/review-aggregator.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Interfaces:**
- Consumes: Task 1の確証済み`ReviewCorrelation`、`parentSessionId`、原本`PersistedLogRecord[]`と検証済みTyped Binding、`ProjectedEvidence[]`
- Produces: `admittedReviewSummary`（同一CorrelationのObservationだけを集約）と`admittedExecutionEvidence`（同一AttemptのCall Bindingで帰属確認できた集合）。既存`aggregateReviews(records)`は診断・全体表示用として維持する。

- [ ] **Step 1 — RED test:** `it("separates a round-1 critical finding from round-2 clean snapshot", ...)`、`it("does not let older clean snapshot erase current findings", ...)`。期待: 現在Correlation側だけが判定される。
- [ ] **Step 2 — RED test:** `it("admits same-attempt execution evidence with matching call binding", ...)`。期待: matching`FullEvidenceRef`だけをRuleへ渡せる。
- [ ] **Step 3 — RED test:** `it("rejects wrong session, callId, TaskExecutionRef, old round, unbound and taskId-only evidence", ...)`。期待: 未帰属はPASS不可。`review_observed`でCorrelation欠落も拒否。
- [ ] **Step 4 — RED run:** `bun run vitest run tests/core/v2/review-aggregator.test.ts tests/hooks/observation-handler-gate.test.ts`。期待: 新しい境界テストが`FAIL`（Scopeのみの集約・Task IDのみのEvidence供給を検出）。
- [ ] **Step 5 — GREEN:** `FullEvidenceRef`でDurable原本を照合し、`sessionId + callId + Typed Binding + TaskExecutionRef`を連結する。Review側は`ReviewTaskCallBinding`／Terminal／Review Artifact／`review_observed.correlation`を照合。`projected.tasks.get(taskId)?.evidence`とグローバル`reviewSummary`を無条件にGate Ruleへ渡さない。
- [ ] **Step 6 — GREEN run:** `bun run vitest run tests/core/v2/review-aggregator.test.ts tests/hooks/observation-handler-gate.test.ts`。期待: 正常Attemptと拒否ケースが`PASS`。
- [ ] **Step 7 — Commit boundary (implementation approval required):** `git add src/core/v2/review-aggregator.ts src/core/acceptance-decision.ts src/hooks/observation-handler.ts tests/core/v2/review-aggregator.test.ts tests/hooks/observation-handler-gate.test.ts` → `git commit -m "fix(justice): isolate gate evidence by review correlation"`。

**Stop:** Task ID以外のTyped Bindingの証拠が永続的に成立しない場合、そのEvidenceを除外し正常Taskの不必要な停止範囲を報告する。新しい共通Binding層は追加しない。

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

Implementation Plan R0.1.1の文書限定訂正条件：

- [x] F-001〜F-003の実装判断（Current Correlation / Evidence Binding / Decision Round）をPlan内に固定
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

**本R0.1.1限定訂正は文書のみのCommit/Push承認に基づく。Implementation HOLDを維持し、実装・Build/Test・追加レビュー・Gate変更・他ファイルへのGitHub書込みは承認されていない。Design全文未確認範囲は `NOT_VERIFIED` とする。**
