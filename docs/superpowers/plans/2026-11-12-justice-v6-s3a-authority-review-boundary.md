# Justice v6 S3-a — Authority / Review Boundary Implementation Plan R0.1

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` only after separate Human Owner implementation approval. Steps use checkbox (`- [ ]`) syntax for tracking. No automatic review dispatch.

**Goal:** 現在のReview Correlationに帰属するReview・EvidenceだけをGate判定へ採用し、旧Attempt・旧Round・矛盾したDecisionから不正なAcceptanceを確定させない。

**Architecture:** 既存のReview Dispatch State、Authorization Review Boundary、Review Aggregator、Gate Evaluation、Acceptance Decisionを再利用する。新しい共通FrameworkやAuthorization Managerを作らず、既存の判定経路に限定的なAdmission処理を追加する。

**Tech Stack:** TypeScript、Bun、Vitest、既存Observation Log / State Projection。

**Spec:** Justice v6 S3-a Design R0.1（Human Owner採択済みの方向性を入力とする）。Issue #356。Design全文のリポジトリ内パスは未確認。

**Reference HEAD:** `adf97c2d3dfd9b254c39206558f3fe9f0133eebe`。実装開始時には実際のHEADと差分を確認する。

**Plan status:** `PLAN_DRAFT / OWNER_ADOPTION_PENDING / IMPLEMENTATION_NOT_AUTHORIZED`

## Global Constraints

- Evidence AdmissionとGateDecision / AcceptanceDecisionの正式受理に限定する。
- Review Correlationは`task-review`と`final-review`の既存型を使用する。
- Task ReviewではAuthorization ID、Task ID、Attempt ID、Review Roundを照合する。
- Final ReviewではAuthorization ID、Plan Path、Plan Fingerprint、Finalization Attempt ID、Final Review Roundを照合する。
- 不明なReview Roundを`1`と推測しない。
- 旧Attempt・別Round・別Task・別PlanのEvidenceを現在のReviewへ流用しない。
- Owner承認の真正性は`NOT_PROVEN`のまま維持する。
- 観測されたReview出力を独立した信頼できるHost証明として扱わない。
- 既存のAuthorization境界と直列化機構を維持する。
- S3-b Recovery、S3-c Host Enforcementは実装しない。
- Review Dispatcher、Agent実行、モデル選択、再レビュー、Gate/HOLD解除を自動開始しない。
- 既存Schemaの拡張は、Roundの持続的識別に必要な最小限に限定する。
- S2-cの`PENDING_INPUT`を変更しない。

## File / Interface Map

| ファイル | 責務 |
|---|---|
| `src/core/acceptance-decision.ts` | 現在Correlationの確証、Decisionの再利用・正式受理判定 |
| `src/core/review-dispatch-state.ts` | 既存Dispatch SlotからRoundを確証するための限定的な参照処理 |
| `src/core/v2/review-aggregator.ts` | 現在CorrelationのReview Summaryのみを集約 |
| `src/core/v2/decision-model.ts` | Task DecisionのRound識別に必要な最小限の互換拡張 |
| `src/core/v2/gate-context.ts` | Gate判定へ渡すContextの整合 |
| `src/hooks/observation-handler.ts` | Gate Ruleへ渡すEvidence / SummaryをAdmission済み集合へ限定 |
| `tests/core/acceptance-decision.test.ts` | Correlation / Decision / Fail-Closed |
| `tests/core/v2/review-aggregator.test.ts` | Review Summaryの帰属分離 |
| `tests/hooks/observation-handler-gate.test.ts` | Gate入力境界 |
| `tests/integration/approved-review-resolution.test.ts` | 既存の正式Review完了経路の回帰確認 |

既存の`ReviewObservedRecord.correlation`、`ReviewDispatchSlot`、`sameReviewCorrelation()`を優先して再利用する。

## Review Focus — Five High-Risk Conditions

1. **旧Attempt混入：** 同一TaskでもAttempt IDが異なるReviewを正式受理しない。
2. **旧Round混入：** Review Roundが異なるFindingsや空のComplete Snapshotを現在のReviewに混入させない。
3. **Evidence誤帰属：** Task IDだけが一致するTool Evidenceを現在Correlationの証拠として無条件に採用しない。
4. **Decision誤再利用：** Roundを証明できない旧GateDecision / AcceptanceDecisionを正式判定へ再利用しない。
5. **Decision矛盾・権限失効：** GateとAcceptanceの判定が矛盾する場合や、処理途中でAuthorizationが失効した場合は正式受理を停止する。

これらは以下のTaskのテストへ直接組み込む。

---

### Task 1: Current Review Correlation Admission

**目的：** Gate Pendingの現在Reviewを、既存のLifecycleとDispatch Slotから確証する。

**Files:**
- Modify: `src/core/acceptance-decision.ts`
- Modify: `src/core/review-dispatch-state.ts`（既存の参照処理を共有するために必要な範囲のみ）
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:**
- Consumes: `GatePendingAttemptContext`、`ProjectedState`、`ReviewDispatchSlot`、`ReviewCorrelation`、`ApprovedPlanBinding`
- Produces: 現在Correlationを確証できた場合の`ReviewCorrelation`、不足・競合・旧Identityを明示した非受理結果

新規の汎用Admission Frameworkは作成しない。

- [ ] **Step 1 — RED:** Task Review Round=2に対してRound=1のTerminal Reviewしか存在しないケースを追加する。Gate評価は実行されずAcceptanceも確定されないことを検証する。
- [ ] **Step 2 — RED:** 同一TaskでAttempt IDだけ異なる場合、別Plan Fingerprintの場合、Finalization Attemptが異なる場合の拒否テストを追加する。
- [ ] **Step 3 — RED:** Roundを確証できない場合と現在Correlationに一致したTerminal Reviewが存在する場合を区別するテストを追加する。
- [ ] **Step 4 — GREEN:** `currentCorrelation()`のTask Round=1固定を廃止する。既存Dispatch SlotのCorrelation、Lifecycle、Parent Sessionを照合し、確証できたRoundのみ返す。
- [ ] **Step 5 — GREEN:** `hasTerminalReview()`を現在Correlationとの完全一致に基づく判定へ変更する。単なるSession ID・Task ID・`reviewScope`一致では通さない。
- [ ] **Step 6 — Verify:** `bun run vitest run tests/core/acceptance-decision.test.ts`を実行する。追加した否定ケースと既存の権限確認テストがPASSすること。

**Deliverable:** 現在のReview Correlationを確証できる場合だけ次のAdmission処理へ進める。

---

### Task 2: Review Summary / Gate Evidence Isolation

**目的：** Gate Ruleが現在Correlationに帰属しないReview Summary・Evidenceを使用しないようにする。

**Files:**
- Modify: `src/core/v2/review-aggregator.ts`
- Modify: `src/core/acceptance-decision.ts`
- Modify: `src/core/v2/gate-context.ts`（必要な入力型の限定変更）
- Modify: `src/hooks/observation-handler.ts`
- Test: `tests/core/v2/review-aggregator.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`

**Interfaces:**
- Consumes: Task 1で確証した`ReviewCorrelation`、保存済み`review_observed`、`ProjectedEvidence`、既存のTyped Review / Delegated Execution Binding
- Produces: 現在CorrelationのReview Summary、帰属を確認できたGate Evidence、欠測と未帰属を区別したGate評価入力

- [ ] **Step 1 — RED:** 同じ`reviewScope`にRound=1のCritical FindingとRound=2のClean Snapshotが存在するケースを追加する。Round=2のGateがRound=1のFindingを継承しないことを検証する。
- [ ] **Step 2 — RED:** 逆に、旧RoundのClean Snapshotが現在Roundの未解決Findingを消去できないことを検証する。
- [ ] **Step 3 — RED:** Correlationが欠落した`review_observed`を、現在Reviewの正式なClean証拠として扱わないことを検証する。
- [ ] **Step 4 — GREEN:** 既存AggregatorにCorrelationを限定する入力経路を追加し、同じCorrelation内でのみ既存のOpen / Resolved / Complete Snapshot集約規則を適用する。全体表示用Aggregatorの従来動作は維持する。
- [ ] **Step 5 — RED:** 同一Task IDだが別AttemptのTool Evidence、別RoundのReview Evidence、帰属不明のEvidenceがGate PASSの根拠にならないことを検証する。
- [ ] **Step 6 — GREEN:** Observation HandlerのGate評価入力を限定する。`projected.tasks.get(taskId)?.evidence`や`projected.reviewSummary`を、そのまま現在のGate Ruleに渡さない。既存のTyped Bindingで帰属を確認できないEvidenceはAdmission対象外とする。
- [ ] **Step 7 — Verify:** 以下を実行し、Correlation間の隔離と未帰属EvidenceからのPASS不成立を確認する。

```bash
bun run vitest run   tests/core/v2/review-aggregator.test.ts   tests/hooks/observation-handler-gate.test.ts
```

**重要な制限：** 現行`ToolExecutedRecord`はReview Correlationを直接持たない。既存Typed Bindingを通じて帰属が証明できない実行証拠は、無理に現在Reviewへ割り当てない。欠測として扱い、必要なGateはFail-Closedにする。

**Deliverable:** Gate Ruleへの入力が現在Reviewに限定された状態。

---

### Task 3: Round-Safe GateDecision / AcceptanceDecision

**目的：** Roundの不明な既存Decisionや矛盾したDecisionを再利用して、正式Acceptanceを確定させない。

**Files:**
- Modify: `src/core/v2/decision-model.ts`
- Modify: `src/core/acceptance-decision.ts`
- Test: `tests/core/acceptance-decision.test.ts`

**Interfaces:**
- Consumes: 現在の`ReviewCorrelation`、保存済み`GateDecision`、保存済み`AcceptanceDecision`
- Produces: 現在Roundに帰属するDecisionの安全なLookup、新規Decisionの限定的なRound Identity、再利用不可・競合時のFail-Closed結果

- [ ] **Step 1 — RED:** TaskExecutionRefは一致するがReview Roundが不明な旧GateDecisionを、現在の正式Decisionとして再利用しないテストを追加する。
- [ ] **Step 2 — RED:** Round=1のDecisionをRound=2で再利用しないテストを追加する。既存Final Reviewについても`finalReviewRound`の一致を再確認する。
- [ ] **Step 3 — RED:** Gate PASSとAcceptance `rework-required`、Gate FAILとAcceptance `accepted`、同一Correlation内の重複Decisionを矛盾として拒否するテストを追加する。
- [ ] **Step 4 — GREEN:** 新しく保存するTask GateDecision / AcceptanceDecisionにはRound識別に必要な`reviewRound`を保持する。旧レコードを読み取れるよう最小限の互換性を維持し、Round欠落レコードを正式な再利用候補にはしない。
- [ ] **Step 5 — GREEN:** `findCurrentGateDecision()`と`findCurrentAcceptanceDecision()`のTask判定にRound一致を追加する。Roundが不明な既存Decisionと衝突する場合は新規Decisionを重複追加して解消したことにせず、当該正式受理を停止する。
- [ ] **Step 6 — GREEN:** 両Decisionが存在する場合、Correlation一致に加えてGate/AcceptanceのVerdict整合性を確認する。整合しなければLifecycleをAcceptanceへ進めない。
- [ ] **Step 7 — GREEN:** `deriveAcceptanceDecision()`で現在Roundを引き継ぎ、Gate確定からAcceptance確定まで既存Authorization Review Boundaryを維持する。
- [ ] **Step 8 — Verify:** `bun run vitest run tests/core/acceptance-decision.test.ts`を実行する。

**Schema boundary:** 今回許可する追加はTask DecisionのRound識別に限る。新しいAuthorization Schema、共通Decision Framework、Runtime Identity基盤は作らない。

**Deliverable:** Roundを確認したDecisionだけを再利用できる正式受理処理。

---

### Task 4: Integration / Regression Acceptance

**目的：** Task 1〜3を結合し、通常のReview完了経路を壊さず、安全性の限定強化が成立したことを確認する。

**Files:**
- Test: `tests/integration/approved-review-resolution.test.ts`
- Test: `tests/core/acceptance-decision.test.ts`
- Test: `tests/hooks/observation-handler-gate.test.ts`
- Modify: 既存テストFixture（Correlation付きReviewを扱うために必要な範囲のみ）

**Interfaces:**
- Consumes: Task 1のCurrent Review Correlation Admission、Task 2の限定Gate入力、Task 3のRound-Safe Decision処理
- Produces: 正常・異常ケースの検証結果、実装範囲と残余制限のOwner判断資料

- [ ] **Step 1 — RED:** 正常なTask ReviewのCorrelation・Terminal Review・Gate PASSが揃うと、正しいTask Acceptanceへ進むことを検証する。
- [ ] **Step 2 — RED:** 正常なFinal ReviewでAuthorization / Plan / Attempt / Roundが一致する場合、既存のPlan Acceptance経路が動作することを検証する。
- [ ] **Step 3 — RED:** Round更新後に旧Evidence・旧Decisionを持ち込んでも、現在のAcceptanceが確定しないことを検証する。
- [ ] **Step 4 — RED:** Gate評価前、GateDecision保存後、AcceptanceDecision保存前にAuthorizationが失効するケースをそれぞれ検証する。
- [ ] **Step 5 — GREEN:** Task 1〜3で変更した既存関数を用いて上記ケースが成立するよう接続を完成させる。新しい診断CoreやDispatcherは作らない。
- [ ] **Step 6 — Focused Tests:** 次を実行する。

```bash
bun run vitest run   tests/core/acceptance-decision.test.ts   tests/core/v2/review-aggregator.test.ts   tests/hooks/observation-handler-gate.test.ts   tests/integration/approved-review-resolution.test.ts
```

- [ ] **Step 7 — Static Verification:** `bun run typecheck`を実行する。
- [ ] **Step 8 — Regression:** 影響する既存Review Dispatch / Gate Ruleテストを実行する。

```bash
bun run vitest run   tests/core/review-dispatch-state.test.ts   tests/core/review-dispatch-state-behavior.test.ts   tests/core/v2/gate-provenance-gating.test.ts   tests/core/v2/review-aggregator.test.ts
```

- [ ] **Step 9 — Final Verification:** `bun run build`および`bun run lint`を実行する。Lintの既知Warningと今回導入したErrorを区別し、実際に確認した結果だけを報告する。

**Expected:** 対象の正常Reviewが継続して利用でき、旧Round・旧Attempt・帰属不明Evidenceによる誤受理が防止される。

---

## Completion Criteria

Implementation Planの完成条件：

- [x] Designの採択済み対象と非対象を明記
- [x] 変更ファイル・既存インターフェースを特定
- [x] 各TaskにRED / GREEN / Verifyを設定
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

**Plan完成時点では、実装・Build/Test・GitHubへの追加書込みは未承認のままとする。**
