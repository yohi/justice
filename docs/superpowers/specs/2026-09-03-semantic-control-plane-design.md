# Justice Semantic Control Plane 統合設計書

**Document:** Justice Semantic Control Plane Design  
**Date:** 2026-09-04  
**Status:** Design Approved  
**Scope:** JUS-P0-01 / JUS-P0-02 / JUS-P0-03 / JUS-P0-04  
**Target Release:** v4.0.0

---

## 1. 背景と目的

Justice は Superpowers が定義する開発プロセスの Desired State と、Oh My OpenAgent (OmO) が実際に行う Agent Execution の Actual State が対応していることを保証し、その成立を Evidence に基づいて証明する **Semantic Control Plane** である。

本設計書は `REQUIREMENTS_2026-09-03.md` の4要件を満たすための統合設計を定める。

- **JUS-P0-01** Controller Routing の Runtime Wiring
- **JUS-P0-02** Plan-Scoped Authorization
- **JUS-P0-03** Semantic Category Routing の完全化
- **JUS-P0-04** Evidence-Based Transactional Task Acceptance

---

## 2. 上位原則

### 2.1 責務分離

| 層 | 責務 | 例 |
|---|---|---|
| Superpowers | 方法論・プロセスの Source of Truth | Brainstorming / Planning / TDD / Review / Verification |
| Justice | 意味の解釈・検証・承認 | Workflow routing / Authorization / Category mapping / Observation / Evidence / Gate / Acceptance |
| OmO | 実際のエージェント実行 | Category dispatch / Agent / Model / Provider / Fallback |

### 2.2 Controller と Worker の分離

- Controller routing decision は **workflow → controller** の解決。
- Worker routing decision は **semantic role → category** の解決に留まる。
- Justice は `agent` / `subagent_type` / `model` / `provider` / `variant` / `reasoning` / `fallback_models` を Worker payload に含めない。混入時は Adapter boundary で除去する。

### 2.3 Fail-Open Execution / Fail-Closed Acceptance

- Justice 内部の観測・記録・enrichment の障害は Runtime 全体を停止させない。
- 一方、次のような状態は不十分な根拠で生成してはならない。
  - `Authorized` / `Accepted` / `Verified` / `Complete`
- すなわち **実行は fail-open、承認は fail-closed** である。

---

## 3. 全体アーキテクチャ

### 3.1 新規 Core モジュール

| モジュール | 責務 |
|---|---|
| `src/core/controller-routing.ts` | `WorkflowRouter` による controller 判定と、actual controller 観測からの routingStatus 評価 |
| `src/core/plan-authorization.ts` | `ApprovedPlanBinding` のライフサイクル管理 (approve / invalidate / release) |
| `src/core/plan-fingerprint.ts` | 正規化 semantic hash、canonical plan snapshot の生成 |
| `src/core/task-lifecycle.ts` | Task Progress State (9状態) と Plan Finalization State (5状態) の純粋 state machine |
| `src/core/acceptance-decision.ts` | Evidence / Review / Gate 結果から `accepted` / `rework_required` / blocked を判定 |

### 3.2 既存モジュール拡張

- `src/core/routing-decision.ts`
  - `ControllerRoutingDecision` / `WorkerRoutingDecision` / `UnroutedRoutingDecision` 型と factory を集約。
  - canonical execution role 7種 → `sp-*` category 7種への全射を定義。
- `src/core/omo-category-mapper.ts`
  - `sp-deep` / `sp-architecture` を追加し、未マッピング role は `compatibility_fallback` 以外では例外を投げる。
- `src/core/v2/state-projection.ts`
  - durable observation/decision log から task lifecycle と plan finalization を再構築する projector を拡張。
- `src/core/session-state-provider.ts`
  - `chat.params` / `message.updated` の actual agent/model を記録する用途を維持し、controller routing observation への入力として使う。

### 3.3 Hook / Adapter 接続

- `src/hooks/plan-bridge.ts`
  - `/justice-implement --approved` で one-shot arm の代わりに `ApprovedPlanBinding` を発行。
  - `task()` PreToolUse 介入条件を「active binding の session/path/fingerprint が一致」に置き換える。
  - fingerprint 不一致検出時に binding を `invalidated` 化する。
- `src/hooks/observation-handler.ts`
  - `chat.params` / `message.updated` の actual agent を `ControllerRoutingObservation` へ記録。
  - Worker 完了・Evidence・Review・Gate 結果を typed lifecycle events として durable log に書き出す。
  - **plan.md の直接書き換えは行わない。**
- `src/hooks/task-feedback.ts`
  - Worker tool success をそのまま成功判定にせず、`WorkerReported` イベントを発行する。
  - `TaskAccepted` 後の progress update 経路でのみ `PlanParser.updateCheckbox()` を呼び出す。
- `src/runtime/opencode-adapter.ts`
  - task() payload の正規化 (禁止 field 除去 / `taskId`/`loadSkills`/`runInBackground` の canonicalize) を維持。
  - `sp-deep` / `sp-architecture` も category として通すだけで model/agent は補正しない。

### 3.4 Command 雛形 (Guaranteed Application Path)

OpenCode plugin API は plugin hook から同一ターンの controller agent を書き換えられない。調査により、`chat.params` output に `agent` / `model` フィールドが存在せず、`session.update` も title 変更のみであることが判明した。

したがって JUS-P0-01 の "applied" 経路は、**agent ピン留め済みの command 定義を利用者が OpenCode 設定に登録すること**で成立する。

Justice は以下を提供する。

- `justice doctor` による pinned-command 不足の検査と雛形出力。
- README/ドキュメントにおける推奨 command 定義例。
- 利用者が手動で配置した場合、`chat.params` / `message.updated` の actual agent と desired controller を突き合わせて `applied` / `mismatch` / `unapplied` を判定する。

---

## 4. データモデル

### 4.1 Controller Routing

```ts
// src/core/routing-decision.ts
export type ControllerAgent =
  | "sisyphus"
  | "atlas"
  | "oracle"
  | "momus"
  | "hephaestus";

export type ControllerRoutingDecision = {
  readonly kind: "controller";
  readonly workflow: string;
  readonly controller: ControllerAgent;
  readonly reason: RoutingReason;
};

// src/core/controller-routing.ts
export type ControllerApplicationMethod =
  | "pinned-command"
  | "runtime-api"
  | "none";

export type ControllerObservationSource =
  | "chat.params"
  | "message.updated"
  | "both"
  | "none";

export type ControllerRoutingStatus =
  | "applied"
  | "unapplied"
  | "unsupported"
  | "mismatch";

export type ControllerRoutingUnappliedReason =
  | "application_not_configured"
  | "actual_not_observed"
  | "controller_mismatch"
  | "controller_observed"
  | "runtime_capability_unsupported";

export type ControllerRoutingObservation = {
  readonly desiredController: ControllerAgent;
  readonly actualController?: ControllerAgent;
  readonly applicationMethod: ControllerApplicationMethod;
  readonly observationSource: ControllerObservationSource;
  readonly routingStatus: ControllerRoutingStatus;
  readonly reason?: ControllerRoutingUnappliedReason;
};
```

- `applied` とするには `message.updated` で actual controller が desired と一致している必要がある。
- `chat.params` 一致だけでは `applied` にしない。
- `unsupported` は将来 OpenCode に runtime 適用 API が追加された場合の予約値。現行 API では発生しない。

### 4.2 Plan Authorization

```ts
export type ApprovedPlanBinding = {
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: string;
  readonly fingerprintSchema: "justice-plan-v1";
  readonly approvedAt: string;
  readonly status: "active" | "invalidated" | "released";
};
```

- `fingerprintSchema` は canonicalization ロジックが将来変わったときの安全装置である。
- 承認時に `CanonicalPlanSnapshot` を必ず生成する。
- `invalidated` / `released` 状態の永続化に失敗しても、その binding store を uncertain として扱い、再利用禁止とする。

### 4.3 Plan Fingerprint

```ts
export type CanonicalTaskSnapshot = {
  readonly taskId: string;
  readonly title: string;
  readonly canonicalBody: string;
  readonly digest: string;
};

export type CanonicalPlanSnapshot = {
  readonly schema: "justice-plan-v1";
  readonly tasks: ReadonlyArray<CanonicalTaskSnapshot>;
};
```

- `PlanFingerprint` が canonical plan document から直接生成する。`PlanParser` の解析結果をそのまま使わない。
- 正規化対象は以下に限定する。
  - checkbox state (`- [ ]` / `- [x]` の差)
  - EOL (`\r\n` → `\n`)
  - 既存 migration 対象の Justice Error annotation (`> ⚠️ **Error**: ...`) 行
- 一般空白・Task 本文は正規化しない。fail-closed に倒す。

### 4.4 Task Lifecycle

```ts
export type TaskProgressState =
  | "pending"
  | "authorized"
  | "in_progress"
  | "worker_reported"
  | "evidence_pending"
  | "review_pending"
  | "gate_pending"
  | "rework_required"
  | "accepted";

export type PlanFinalizationState =
  | "tasks_pending"
  | "all_tasks_accepted"
  | "final_review_pending"
  | "final_gate_pending"
  | "complete";
```

- `TaskLifecycle Core` は永続化に依存しない。
- lifecycle transition は typed lifecycle event として durable observation/decision log に記録される。
- compaction / restart 後は `state-projection.ts` の拡張によりこれらを再構築する。
- 新規 persistence file は作らない。

### 4.5 Review Artifact

```ts
export type ReviewKind =
  | "task-review"
  | "final-review"
  | "external";

export type ReviewSource =
  | "sp-review"
  | "sp-final-review"
  | "external";

export type ReviewCorrelation = {
  readonly reviewOfTaskId: string;
  readonly reviewRound: number;
  readonly reviewKind: "task-review" | "final-review";
};
```

- `sp-review` worker の起動は Justice ではなく Controller (Atlas) が `task(category="sp-review")` として行う。
- Justice は `ReviewPending` 状態の提示と、review worker 実行結果の観測を行う。
- review worker と元 task との correlation は内部的に `ReviewCorrelation` で保持する。
- CodeRabbit / Greptile 等の external review は `review-clean` gate の追加情報になりうるが、mandatory `sp-review` の完了証拠にはならない。

### 4.6 Gate Verdict

```ts
export type GateVerdict = "PASS" | "WARN" | "FAIL";
```

- `PASS` のみ `TaskAccepted` へ進める。
- `WARN` / `FAIL` は `rework_required` へ進める。
- gate evaluation 不可・内部エラー・証拠不十分の場合は `gate_pending` のまま `accepted` にしない。
- 内部障害を `rework_required` にしてはならない。"Justice が壊れたので実装コードを書き直せ" という誤った意味を与えるため。

---

## 5. 要件別設計詳細

### 5.1 JUS-P0-01 Controller Routing

```text
workflow 起動 (command / skill 検出)
  → WorkflowRouter.resolveController(workflow)
  → routing-decision.ts: createControllerRoutingDecision(workflow_rule)
  → controller-routing.ts:
      applicationMethod === "pinned-command"?
        yes → chat.params / message.updated で actual を観測
        no  → unapplied (reason: application_not_configured)
      message.updated で actual === desired?
        yes → applied
        no  → mismatch
      観測不能 → unapplied (reason: actual_not_observed)
  → ControllerRoutingObservation を durable log へ記録
  → mismatch 時は L0 advisory + justice_review / status で可視化
```

Acceptance criteria:

- `brainstorming` / `writing-plans` / `executing-plans` → `desiredController = sisyphus`
- `subagent-driven-development` → `desiredController = atlas`
- Core が Atlas を返しても Runtime が Sisyphus のままなら `routingStatus !== applied`

### 5.2 JUS-P0-02 Plan-Scoped Authorization

```text
/justice-implement --plan <path> --approved
  → plan 読込
  → PlanFingerprint 計算
  → CanonicalPlanSnapshot 保存
  → ApprovedPlanBinding {
      sessionId, planPath, planFingerprint,
      fingerprintSchema: "justice-plan-v1",
      approvedAt, status: "active"
    }
  → AtomicPersistence 経由で .justice/authorizations.json へ保存
      → 保存成功 → active
      → conflict_diverted / exception → binding uncertain → 権限なし

task() PreToolUse 介入条件:
  binding.status === "active"
  ∧ binding.sessionId === 現 session
  ∧ binding.planPath === active plan
  ∧ PlanFingerprint(現 plan.md) === binding.planFingerprint
      → 不一致なら binding.status = "invalidated"
      → [JUSTICE: AUTHORIZATION INVALIDATED] advisory

release 条件:
  PlanFinalizationState === "complete"
  ∨ ユーザー明示 cancel (/justice-implement --cancel)
```

- Authorization は最初の Worker Task 実行後も consume しない。
- 別 session からの再利用は禁止。
- 承認後の Plan semantic mutation は invalidation 対象。Execution progress (checkbox) 更新は維持。

### 5.3 JUS-P0-03 Semantic Category Routing

```text
VALID_EXECUTION_ROLE_CATEGORIES (全射):
  mechanical     → { sp-mechanical }
  implementation → { sp-implementation }
  integration    → { sp-integration }
  review         → { sp-review }
  final-review   → { sp-final-review }
  deep           → { sp-deep }
  architecture   → { sp-architecture }
```

- 未知・未定義 role の silent downgrade を禁止。
- `architecture` → `unspecified-high` / `deep` への旧経路を削除。
- `justice doctor` は 7 つの `sp-*` category が OmO 設定に存在することを検査。
- Fix loop の escalation は semantic role escalation とし、model escalation ではない。
- Justice は Worker payload に `agent` / `subagent_type` / `model` / `provider` を含めない。

### 5.4 JUS-P0-04 Transactional Acceptance

```text
task() 完了観測 (TaskFeedbackHandler)
  → WorkerReported
  → EvidenceEngine: evidence 収集 (observed / derived provenance のみ)
  → EvidencePending → ReviewPending

Controller (Atlas)
  → task(category="sp-review") with ReviewCorrelation
  → review worker 観測

Justice
  → ReviewPending → GatePending
  → GateEngine 評価
      PASS  → AcceptanceDecision { accepted: true }
            → TaskProgressState = accepted
            → ProgressUpdater → PlanParser.updateCheckbox()
      WARN/FAIL → rework_required → TaskFeedbackHandler が rework 文脈を注入
      unavailable/error/insufficient → gate_pending のまま acceptance blocked
```

- Worker の正常終了を `TaskAccepted` と同一視しない。
- "tests passed" 等の自己申告 (declared evidence) だけでは Gate PASS 不可。
- Gate PASS より先に plan.md を完了状態にしない。
- 全 task accepted 後:
  - `PlanFinalizationState = all_tasks_accepted`
  - `task(category="sp-final-review")`
  - Final Gate PASS → `PlanFinalizationState = complete`
  - binding released

### 5.5 Review と Final Review

```text
Task Review:
  Worker implementation
    → sp-review worker (via Controller task dispatch)
    → structured review artifact / observed review record
    → Gate evaluation
    → TaskAccepted

Final Review:
  All Tasks Accepted
    → PlanFinalizationState = final_review_pending
    → sp-final-review worker (via Controller task dispatch)
    → Final Gate
    → PlanFinalizationState = complete
    → Authorization released
```

- `sp-review` / `sp-final-review` の起動主体は Controller。
- Justice は review correlation と結果観測を行う。
- external review (CodeRabbit / Greptile) は補助情報であり、mandatory review 完了の証拠にはならない。

---

## 6. テスト戦略

### 6.1 新規テストファイル

| テストファイル | 対象 |
|---|---|
| `tests/core/controller-routing.test.ts` | desired/actual evaluation、applied/mismatch/unapplied、observation source 優先 |
| `tests/core/plan-authorization.test.ts` | multi-task 継続、semantic 変更で invalidated、progress-only 更新で維持、別 session 拒否、release 後拒否 |
| `tests/core/plan-fingerprint.test.ts` | checkbox 変更は hash 不変、task 本文変更で hash 変化、EOL 差は無視、Error annotation migration |
| `tests/core/routing-decision.test.ts` | 7→7 全射、deep→sp-deep、architecture→sp-architecture、低 category へのパス不存在 |
| `tests/core/task-lifecycle.test.ts` | WorkerReported≠accepted、declared-only で Gate 不成立、Gate FAIL→rework、Final Review 未了で PlanComplete=false |
| `tests/core/acceptance-decision.test.ts` | PASS/WARN/FAIL/unavailable それぞれの遷移、evidence provenance 判定 |
| `tests/doctor/category-presence.test.ts` | `justice doctor` が 7 `sp-*` category の欠落を検出 |
| `tests/hooks/plan-bridge-authorization.test.ts` | `/justice-implement --approved` が binding を発行、不一致で invalidate |

### 6.2 特に追加すべきシナリオ

- `AtomicPersistence` が `conflict_diverted` を返した場合、authorization が成立しないこと。
- restart / replay 後に durable log から lifecycle を復元すること。
- external review だけでは `sp-review` 要件を満たさないこと。
- review task と implementation task の correlation が正しく機能すること。
- Final Review 未完了では全 checkbox `[x]` でも `PlanComplete` にならないこと。
- Controller Routing で Core が Atlas を返し Runtime が Sisyphus のままなら `routingStatus = mismatch` であること。

### 6.3 品質ゲート

各 Phase 完了時に以下を実行し、全绿を確認する。

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

---

## 7. 移行とリリース

### 7.1 破壊的変更

以下は既存動作を変更するため、リリースを **v4.0.0 (major)** とする。

- one-shot arm の廃止
- `deep` / `architecture` の旧 category 経路 (`deep` / `unspecified-high`) の削除
- task 失敗時の plan.md Error 注記の廃止 (durable log へ移行)
- Worker success からの直接 checkbox 更新の廃止

### 7.2 既存 1469 テストの扱い

Phase 1 → Phase 2 → Phase 3 → Phase 4 の順に段階的にテストを移行する。各 Phase ごとに `bun run test/typecheck/lint/build` を通す。

### 7.3 ドキュメント更新

- `README.md` の `/justice-implement` セクションを Plan-Scoped Authorization に更新。
- `SPEC.md` の関連章を更新 (v4.0.0 の ADR として追記)。
- 推奨 pinned-command 定義を README に追加。

---

## 8. Invariants

実装後、以下は常に成立しなければならない。

| ID | Invariant |
|---|---|
| INV-01 | Controller intent ≠ Worker intent |
| INV-02 | Justice worker decision ends at category |
| INV-03 | Plan approval survives multiple tasks |
| INV-04 | Semantic plan mutation invalidates approval |
| INV-05 | High complexity never silently downgrades |
| INV-06 | WorkerReported ≠ TaskAccepted |
| INV-07 | Declared evidence never satisfies required gates alone |
| INV-08 | Gate PASS precedes progress completion |
| INV-09 | Final Review precedes Plan Complete |
| INV-10 | Fail-open execution ≠ fail-open acceptance |

---

## 9. 推奨実装順序

| Phase | 対象 | ゴール |
|---|---|---|
| Phase 1 | JUS-P0-03 Category Routing | 7 role → 7 `sp-*` category の全射化、silent downgrade 除去、`justice doctor` 検査追加 |
| Phase 2 | JUS-P0-02 Plan Authorization | one-shot arm を Plan-Scoped Authorization に置換、fingerprint + canonical snapshot 実装 |
| Phase 3 | JUS-P0-04 Transactional Acceptance | WorkerReported / TaskAccepted 分離、Evidence→Review→Gate→Acceptance→Progress の直列化 |
| Phase 4 | JUS-P0-01 Controller Runtime Wiring | ControllerRoutingObservation 評価、pinned-command 雛形・doctor 検査、upstream 拡張要求の分離 |

Phase 4 を最後にするのは、OpenCode / OmO Runtime boundary への影響が最も大きいためである。Phase 1-3 で Core model を固めてから接続する。

---

## 10. Definition of Done

1. Controller routing が Domain 上だけでなく Runtime 上でも成立している (pinned-command + observation)。
2. Approved Plan authorization が複数 Task に継続する。
3. Plan semantic mutation により authorization が失効する。
4. Execution progress 更新では authorization が誤失効しない。
5. 全 canonical execution role が明示的 category を持つ。
6. `deep` / `architecture` の silent downgrade が存在しない。
7. Justice が Worker model / provider / agent を指定しない。
8. Worker success と Task acceptance が別状態になっている。
9. Evidence → Review → Gate → Acceptance の順序が保証されている。
10. Gate PASS 前に Plan progress が完了状態にならない。
11. Declared evidence のみでは required Gate が PASS しない。
12. Final Review / Final Gate 前に Plan が Complete にならない。
13. 上記すべてについて automated test が存在する。
14. `justice doctor` が必要 category / pinned-command configuration の不足を検出できる。
15. Justice の内部障害時にも、未検証の Task を Accepted と誤認しない。

---

## 11. 決定事項メモ

- **Controller Runtime Wiring**: 現行 OpenCode plugin API で in-band agent 切替は不可。config 経由の `agent:` ピン留めを guaranteed application path とし、mismatch detection を主たる観測機能とする。完全な runtime 切替は upstream API 拡張要求として分離。
- **Plan Fingerprint**: 正規化対象を checkbox state / EOL / 旧 Error annotation のみに限定。一般空白・Task 本文は正規化しない (fail-closed)。
- **Task Lifecycle**: 純粋 Core とし、永続化に依存しない。typed lifecycle events を durable log へ書き、v2 state projection 拡張で復元。
- **Progress Update**: Worker success からの直接 plan.md 更新を廃止。`TaskAccepted` 後の専用 ProgressUpdater 経由でのみ checkbox を更新。
- **Review**: `sp-review` / `sp-final-review` worker は Controller が `task()` として起動。Justice は correlation と観測のみを担当。external review を mandatory review 完了の証拠とはしない。
- **Gate Verdict**: `UNKNOWN` は採用しない。評価不能・内部エラー時は `gate_pending` のまま acceptance blocked。
