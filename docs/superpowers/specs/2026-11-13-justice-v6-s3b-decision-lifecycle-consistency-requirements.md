# Justice v6 S3-b — Decision / Lifecycle Consistency Recovery Requirements R0.1.1 (F-001 / F-002限定訂正)

**Repository:** `yohi/justice`  
**Issue:** [#356](https://github.com/yohi/justice/issues/356)  
**Reference HEAD:** `f0c1d9fc7c1cc5e4b778318fb7f56361bbc14b43`  
**Reviewed document HEAD:** `1dcde5140ae1a08612c9c210020baf260226f5c8`（この訂正は未Commit）  
**Scope:** S3-b / Decision-Lifecycle Consistency Only  
**Status:** `REQUIREMENTS_PROPOSED / DESIGN_NOT_AUTHORIZED / IMPLEMENTATION_HOLD`  
**Human Owner scope decision:** Option A — Decision / Lifecycle整合性に限定

> 本文は `superpowers:brainstorming` への入力要件であり、設計採択・実装承認を意味しない。新規Framework、Host Enforcement、全面Semantic Recoveryは先取りしない。

## 1. Project Goal Contract

### PROJECT_GOAL

GateDecisionとAcceptanceDecisionが永続化された後、Lifecycle Transitionの記録に失敗しても、同一Review Correlationの再評価によって安全に整合状態へ収束できること。

### USER_VALUE

部分失敗によって正常なTaskやPlan Finalizationが永続的に進行不能になることを防ぎつつ、不正なAcceptance、権限失効後の状態更新、重複Decisionを許さない。

### DELIVERABLE

S3-b Decision / Lifecycle Consistency Recoveryの設計判断に必要な限定要件。

実装計画書・コード・新規Frameworkは今回の成果物に含めない。

## 2. Background / Existing System

S3-a実装によりReview Correlation、Evidence Admission、Gate/Acceptance Decisionの整合性検証が追加された。

しかし現行 `src/core/acceptance-decision.ts` には以下の部分成功状態が残る。

1. GateDecisionがDurable保存される。
2. AcceptanceDecisionがDurable保存される。
3. Lifecycle appendが失敗する。
4. 再実行時に既存Gate/Acceptanceの整合のみで `decided` を返し、Lifecycleが未更新のまま残り得る。

参照: `src/core/acceptance-decision.ts` の既存Decision再利用分岐と `applyGateOutcomeLifecycle`。Lifecycle遷移元/先は `src/core/task-lifecycle.ts`、Projectionは `src/core/v2/state-projection.ts` の既存規則に従う。

既存 `tests/core/acceptance-decision.test.ts` はLifecycle append失敗直後の `blocked` を確認しているが、その後の再実行による収束保証まで確立したものではない。

これはコードから確認できる潜在的Recovery Gapであり、実機上で不正Acceptanceが発生したという観測結果ではない。

また、`src/core/justice-plugin.ts` の `updatePlanProgressAfterAcceptance` と `recoverAcceptedTaskProgress` は現在、Gate/Acceptanceの一致によってPlanのチェックボックスを更新でき、Task Lifecycle `accepted` を必須条件としていない。一方、既存の `advanceFinalizationWithinBoundary` は、全TaskのProjected Lifecycle `accepted` を必須としている。この差をPlan Progressの限定副作用境界として扱い、全面Semantic Recoveryには拡張しない。

既存 `findCurrentAcceptanceDecision` は同一Correlationでの暫定 `blocked` Acceptanceと、再評価後の確定Acceptanceの共存を許す。これは不正な重複Decisionと区別すべき現行契約である。

## 3. Functional Requirements

### FR-01: Decision / Lifecycle整合性

同一Review Correlationに属するGateDecision・AcceptanceDecisionと、対応するLifecycle状態が整合していることを正式完了条件とする。

Taskでは次を要求する。

- Gate `PASS` → Acceptance `accepted` → Lifecycle `accepted`
- Gate `WARN` / `FAIL` → Acceptance `rework-required` → Lifecycle `rework_required`

Plan Finalizationでは次を要求する。

- Gate `PASS` → Acceptance `complete` → Lifecycle `complete`
- Gate `WARN` / `FAIL` → Acceptance `rework-required` → Lifecycle `final_rework_required`

Decisionのみの存在をLifecycle完了の証拠としない。

TaskのPlan Progress（チェックボックス等）の確定にも、現在CorrelationのGate `PASS`・確定Acceptance `accepted` に加えて、対応するTask Lifecycle `accepted` のDurable Readbackと現在Identityの一致を必須とする。Decisionだけが確定してLifecycleが `gate_pending` の場合はPlan Progressを書き換えない。既存の `advanceFinalizationWithinBoundary` が全TaskのLifecycle `accepted` を要求する条件は維持する。

### FR-02: 部分失敗からのRecovery

Gate/Acceptance保存成功、Lifecycle保存失敗の場合、同一Correlationの再実行で未完了Lifecycleを復旧可能にする。

- 既存Decisionの再評価・再作成を必要としない。
- 正しいDecisionから期待するLifecycle遷移を確定する。
- 復旧前のLifecycle状態と遷移可能性を検証する。
- Lifecycle更新成功を永続状態から確認できること。
- 永続化が確認できなければ正式完了にしない。
- Task Lifecycle `accepted` のRecoveryをDurable Readbackで確認してから、同一Task・Attempt・RoundのPlan Progressを更新可能にする。Lifecycle復旧前のAcceptanceDecisionやチェックボックス表示を復旧完了の根拠にしない。
- Progress更新自体が失敗してもLifecycleの成功を取り消さず、既存の失敗通知・安全な後続再実行により、認可を再検証したうえで未反映の進捗だけを反映可能にする。LifecycleとPlanファイル更新を原子的な単一トランザクションとみなさない。

### FR-03: 冪等性

同一Correlationへの再実行は以下を満たす。

- 同一GateDecisionを重複保存しない。
- 同一Correlationの確定AcceptanceDecision（`accepted` / `rework-required` / `complete`）を重複保存しない。既存の暫定 `blocked` Acceptanceが1件存在した後、再評価により確定Acceptanceが1件追加される正常遷移を禁止しない。
- 暫定 `blocked` と確定Acceptanceが共存する場合、既存 `findCurrentAcceptanceDecision` と同様に確定Acceptanceを現在値として扱う。確定Acceptance複数件、確定値の矛盾、確定がない暫定 `blocked` 複数件は競合として扱い、無条件に正常化しない。
- 完了済みLifecycleを重複遷移させない。
- 既に整合している場合は余計な書込みを発生させない。
- 再実行によって新しいReview RoundやTask Attemptを開始しない。
- Plan ProgressはLifecycle `accepted` の確認後に限り、同一Taskについて論理的に一度だけ確定する。再実行時は既存の確定済みチェック状態を検証し、同一結果に対して重複した実効更新・不要なファイル書込みを生じさせない。

### FR-04: Authority / Correlation維持

RecoveryにもS3-aの既存Authority境界を適用する。

Taskの場合：

- Parent Session
- Authorization ID
- Task ID
- Attempt ID
- Review Round

Plan Finalizationの場合：

- Parent Session
- Authorization ID
- Plan Path / Fingerprint
- Finalization Attempt ID
- Final Review Round

これらの一致が確認できない場合は、Lifecycleを変更しない。

失効したAuthorization、競合Decision、旧RoundのDecisionはRecoveryの根拠にしない。

### FR-05: Lifecycle状態競合

現在Lifecycleが期待する遷移元状態と一致しない場合、古いDecisionを使って上書きしない。

現行Projectionに対して適用可能な遷移だけを許容する。

既に期待する完了状態であることが正当に確認できる場合と、別Attempt・別Roundによって状態が進んだ場合を区別する。

### FR-06: Restart後の再実行

プロセス再起動後でもDurable Recordから同一CorrelationとDecision/Lifecycle状態を確認でき、通常の再実行経路で整合性を回復可能にする。

新規の自動Recovery Schedulerや全面Replay Engineは要求しない。

### FR-07: 失敗・未確認状態

以下を区別する。

- `CONSISTENT`: Decision/Lifecycleの整合を確認済み
- `RECOVERABLE`: 正当なDecisionが存在し、限定的なLifecycle更新が可能
- `BLOCKED`: 権限失効・競合・不正状態などによる非受理（Recovery側の意味分類）
- `NOT_VERIFIED`: Readback不可など、整合性を証明できない状態

これは要件上の意味分類であり、新たな永続Schemaや公開Result型の導入を要求しない。

`AcceptanceDecision.verdict === "blocked"` は、現行の暫定的な「まだ確定できない」Decision記録であり、上記のRecovery分類 `BLOCKED` と同一概念ではない。暫定 `blocked` だけで正式AcceptanceやPlan Progressを確定しない。後続の有効なGate評価による確定Acceptanceへの遷移は許容し、複数の現在確定Decisionや整合しないGate/Acceptanceは引き続き拒否する。

不明状態を成功に昇格させない。

## 4. Nonfunctional Requirements

- 既存Durable LogとState Projectionを優先して再利用する。
- 新規Storage、汎用Recovery Framework、全面Replay基盤を導入しない。
- 既存Decision Schemaの互換性を維持する。
- 正常系の既存Gate/Acceptance契約を維持する。
- 同時実行・再試行でも重複した副作用を生じさせない。ここにはLifecycle復旧後のPlan Progress更新を含む。
- 無関係の正常なTaskを停止しない。
- 旧履歴の不足したIdentityやRoundを推測で補完しない。
- SecretsやTool生出力をRecovery用に追加保存しない。

## 5. Scope

### In Scope

- Task Gate / AcceptanceとTask Lifecycleの整合
- Plan Gate / AcceptanceとFinalization Lifecycleの整合
- Decision永続化後のLifecycle部分失敗
- 同一Correlationの再実行
- Restart後の同一経路による限定Recovery
- `updatePlanProgressAfterAcceptance` / `recoverAcceptedTaskProgress` に相当する既存のPlan Progress副作用境界：Task Lifecycle `accepted` のDurable確認後に限定した進捗更新と、重複更新防止
- 暫定 `blocked` Acceptanceから確定Acceptanceへの既存の正常遷移と、真のDecision競合の区別
- 既存Authority/Correlation境界の維持
- 冪等性、競合、失効、欠測に関する限定テスト

### Out of Scope

- S3-a M-2 Terminal metadata強化
- S3-c Host Enforcement
- 任意のTask/Revision/Findingの全面Semantic Recovery
- 実Tool副作用の再実行・巻戻し
- 新しいReview Dispatch、Review Round、Task Attemptの自動開始
- 全面Event Replay / Projection再構築
- 新規汎用Recovery Framework
- Gate/HOLDの解除
- 過去の不完全なDecisionを自動正当化する移行処理
- Plan Progress全般の新規管理基盤、歴史的チェックボックスの一括修復、関係のないファイル副作用のRecovery

## 6. Acceptance Criteria

| ID | Scenario | Expected |
|---|---|---|
| AC-01 | Task Decision保存成功・Lifecycle失敗後に再実行 | 正しいLifecycleへ収束 |
| AC-02 | Plan Decision保存成功・Lifecycle失敗後に再実行 | Finalizationが正しい状態へ収束 |
| AC-03 | Gateのみ存在 | 既存条件に従いAcceptanceとLifecycleを補完 |
| AC-04 | Gate/Acceptance/Lifecycleが整合済み | 重複書込みなし |
| AC-05 | 同一Correlationの繰り返し再実行 | 状態不変、重複Decisionなし |
| AC-06 | Restart後の再実行 | Durable Readbackに基づき収束 |
| AC-07 | Authorization失効 | 書込み禁止・正式完了禁止 |
| AC-08 | 異なるAttempt/Round | 旧Decisionを流用しない |
| AC-09 | 同一Correlationで確定Acceptance複数件、確定Verdict矛盾、Gate/Acceptance不一致、確定値なしの暫定 `blocked` 複数件 | 競合としてFail-Closed。暫定 `blocked` 1件＋後続の確定Acceptance 1件は正常とする |
| AC-10 | Lifecycle状態競合 | 上書き禁止 |
| AC-11 | Lifecycle append再失敗 | 未完了のままBlocked |
| AC-12 | Lifecycle Readback不可 | 成功と断定しない |
| AC-13 | 複数回の同時要求 | 整合状態へ収束し重複副作用なし |
| AC-14 | 無関係Task | 正常な進行を妨げない |
| AC-15 | Task Gate/Acceptance `accepted` はDurableだがLifecycleが `gate_pending` | Plan Progressは未更新。Decisionだけで進捗確定しない |
| AC-16 | 同一CorrelationのTask Lifecycle `accepted` をRecoveryしDurable Readbackで確認 | Active Authorization・Task Identity・Plan一致を再確認し、Plan Progressが論理的に1回だけ確定。再実行で重複ファイル更新しない |
| AC-17 | Lifecycle `accepted` 後のPlan Progress更新失敗と再実行 | 既存Lifecycleを維持し、未反映の進捗を権限再検証後に限り安全に反映。失効時は書込み禁止 |
| AC-18 | 全TaskのGate/Acceptanceが `accepted` だが1件のTask Lifecycleが未完了 | `advanceFinalizationWithinBoundary` の既存条件どおりFinalizationを進めない |
| AC-19 | 既存の暫定 `blocked` Acceptance 1件後に有効なGate評価で確定Acceptanceが1件成立 | 既存 `findCurrentAcceptanceDecision` 契約に従い確定Acceptanceが現在値となる。暫定記録を競合・不正重複と誤判定しない |

AC-01〜AC-03はPASSだけでなくWARN/FAILに対応するRework遷移も検証する。AC-15〜AC-18はPlan Progressに関するTask `PASS` / `accepted` の限定副作用を検証し、全Task Lifecycle `accepted` を要求する既存Finalization条件を維持する。AC-09 / AC-19は暫定 `blocked` と確定Decisionの現行遷移を回帰対象とする。

既存のテストFixtureを可能な限り再利用し、上記を満たす必要十分な追加テストに限定する。

## 7. Known Open Questions for Brainstorming

設計段階で比較する論点は以下に限定する。

1. Decision / Lifecycleの一致を、どの既存の読取経路で判定するか。
2. 既存の直列化・Authorization Review Boundaryで同時再実行を十分に制御できるか。
3. Lifecycle append成功とProjection反映成功の保証を、どの既存契約で確認するか。
4. Restart後、既存の再実行入口だけでRecoveryを呼び出せるか。
5. Task Lifecycle `accepted` のReadbackとPlan Progress更新の順序・再試行を、既存境界だけでどう担保するか（新規汎用副作用Recoveryは対象外）。

最終アーキテクチャはBrainstormingで比較し、Human Ownerの判断に委ねる。

## 8. Completion / Stop Conditions

### Requirements完了条件

- 目的・対象範囲・非対象範囲が明確
- 正常・部分失敗・再実行・失効・競合の期待結果が定義済み
- F-001のPlan Progress副作用境界と、F-002の暫定 `blocked` → 確定Acceptanceの既存正常遷移を区別済み
- 実装方式の選択余地を残している

### 停止条件

- 要件整理が完了したら終了する。
- 設計・実装・Build/Test・追加Commit・PR作成は自動開始しない。
- 新規Findingだけを理由に作業範囲を拡張しない。
- 設計採択と実装着手には別途Human Ownerの明示承認を必要とする。
- 追加レビューを自動的に開始しない。

## 9. References

- Issue: https://github.com/yohi/justice/issues/356
- S3-a Plan: `docs/superpowers/plans/2026-11-12-justice-v6-s3a-authority-review-boundary.md`
- `src/core/acceptance-decision.ts`（`findCurrentAcceptanceDecision` / Decision再利用分岐）
- `src/core/justice-plugin.ts`（`updatePlanProgressAfterAcceptance` / `recoverAcceptedTaskProgress` / `advanceFinalizationWithinBoundary`）
- `src/core/task-lifecycle.ts`
- `src/core/v2/state-projection.ts`
- `tests/core/acceptance-decision.test.ts`
- S3-a merged PRs: #383〜#386

**Brainstorming directive:** S3-aの既存境界を再利用した必要最小限のRecovery設計を比較する。新規Frameworkの導入を既定路線にしない。

**Review disposition:** F-001（Plan Progress副作用境界）とF-002（暫定 `blocked` Acceptance契約）について、要件上の限定訂正を反映。Design / Implementation Planは今回未作成のため両文書間の照合は `NOT_APPLICABLE`。Design Adoption / Implementation GO / Gate / HOLDに変更なし。Source Code、Test、CIは変更しない。
