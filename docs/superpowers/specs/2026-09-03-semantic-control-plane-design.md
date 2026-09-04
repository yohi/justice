# Justice Semantic Control Plane 統合設計書

**Document:** Justice Semantic Control Plane Design  
**Date:** 2026-09-04  
**Status:** Design Approved（anti-replay 契約を復元、implementation plan 作成可）
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
| `src/core/task-lifecycle.ts` | Task Progress State (9状態) と Plan Finalization State (6状態) の純粋 state machine |
| `src/core/acceptance-decision.ts` | Evidence / Review / Gate 結果から `accepted` / `rework_required` / blocked を判定 |
| `src/core/review-artifact.ts` | `ReviewArtifactV1` の検証・解析、clean review 権威付け |

### 3.2 既存モジュール拡張

- `src/core/routing-decision.ts`
  - `ControllerRoutingDecision` / `WorkerRoutingDecision` / `UnroutedRoutingDecision` 型と factory を集約。
  - canonical execution role 7種 → `sp-*` category 7種への全射を定義。
- `src/core/omo-category-mapper.ts`
  - `sp-deep` / `sp-architecture` を追加し、未マッピング role は `compatibility_fallback` 以外では例外を投げる。
- `src/core/v2/state-projection.ts`
  - durable observation/decision log から task lifecycle と plan finalization を再構築する projector を拡張。
- `src/core/v2/gate-definition.ts` / `src/core/v2/rule-evaluation-engine.ts`
  - `GateScope` / `GateTrigger` を導入し、task gate に加えて plan gate（Final Gate）を評価できるように拡張。
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
  - `task()` 呼び出しに `TaskCallPurpose` を付与し、PostToolUse で implementation / task_review / final_review を区別する。
  - **plan.md の直接書き換えは行わない。**
- `src/hooks/task-feedback.ts`
  - Worker tool success をそのまま成功判定にせず、`WorkerReported` イベントを発行する。
  - `TaskAccepted` 後の progress update 経路でのみ `PlanParser.updateCheckbox()` を呼び出す。
- `src/runtime/opencode-adapter.ts`
  - task() payload の正規化 (禁止 field 除去 / `taskId`/`loadSkills`/`runInBackground` の canonicalize) を維持。
  - `sp-deep` / `sp-architecture` も category として通すだけで model/agent は補正しない。
  - `ReviewRequiredDirective` を Controller へ inject するための出力経路を追加。
- `src/core/justice-plugin.ts`
  - `PostToolUse` イベントを **transactional order** で処理する。`observationHandler` / `planBridge` / `taskFeedback` 等の side-effecting handlers を `Promise.all` して並列実行してはならない。
  - 順序は `classify TaskCallPurpose` → `record WorkerReported / Evidence` → `project lifecycle` → `emit ReviewRequiredDirective` → `AcceptanceDecision` → `ProgressUpdater` とし、Acceptance 後のみ progress update へ進める。

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
  | "actual_not_observed";

export type ControllerRoutingUnsupportedReason =
  | "runtime_capability_unsupported";

export type ControllerRoutingObservation =
  | {
      readonly routingStatus: "applied";
      readonly desiredController: ControllerAgent;
      readonly actualController: ControllerAgent;
      readonly applicationMethod: Exclude<
        ControllerApplicationMethod,
        "none"
      >;
      readonly observationSource: "message.updated" | "both";
    }
  | {
      readonly routingStatus: "mismatch";
      readonly desiredController: ControllerAgent;
      readonly actualController: ObservationAgentId;
      readonly applicationMethod: Exclude<
        ControllerApplicationMethod,
        "none"
      >;
      readonly observationSource: "message.updated" | "both";
    }
  | {
      readonly routingStatus: "unapplied";
      readonly desiredController: ControllerAgent;
      readonly actualController?: ObservationAgentId;
      readonly applicationMethod: ControllerApplicationMethod;
      readonly observationSource: ControllerObservationSource;
      readonly reason: ControllerRoutingUnappliedReason;
    }
  | {
      readonly routingStatus: "unsupported";
      readonly desiredController: ControllerAgent;
      readonly applicationMethod: "runtime-api" | "none";
      readonly observationSource: ControllerObservationSource;
      readonly reason: ControllerRoutingUnsupportedReason;
    };
```

- `applied` とするには `message.updated` で actual controller が desired と一致している必要がある。
- `chat.params` 一致だけでは `applied` にしない。
- `actualController` は `ObservationAgentId`（`"unknown"` を含む）で表現し、unknown agent 観測時も `mismatch` として記録する。
- `unsupported` は将来 OpenCode に runtime 適用 API が追加された場合の予約値。現行 API では発生しない。
- 各 status は必須フィールドを区別する discriminated union とし、`applied` 状態で `reason` を持たせたり、`unapplied` で `actualController` を必須にしたりするような illegal state は表現できない。
- `mismatch` は runtime execution の観測結果なので、`observationSource` は `message.updated` または `both` に限定する。`chat.params` だけの場合は `unapplied` / `actual_not_observed` へ誘導する。

### 4.2 Plan Authorization

```ts
export type ApprovedPlanBinding = {
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly fingerprintSchema: "justice-plan-v1";
  readonly approvedAt: string;
  readonly status: "active" | "invalidated" | "released";
  readonly invalidatedAt?: string;
  readonly releasedAt?: string;
};

export type AuthorizationMergeRule = {
  readonly terminalStates: ReadonlyArray<"invalidated" | "released">;
  readonly resolve: (
    mine: ApprovedPlanBinding,
    theirs: ApprovedPlanBinding,
  ) => ApprovedPlanBinding;
};
```

- `authorizationId` は承認単位の不変 identity。同一 `authorizationId` では `active → invalidated|released` は不可逆とする。
- 再承認（re-approval）は新しい `authorizationId` を発行する。古い terminal binding を `active` に戻す merge は禁止する。
- `fingerprintSchema` は canonicalization ロジックが将来変わったときの安全装置である。
- 承認時に `CanonicalPlanSnapshot` を必ず生成する。
- `invalidatedAt` / `releasedAt` は監査・競合解決用タイムスタンプ。
- `invalidated` / `released` 状態の永続化に失敗しても、その binding store を uncertain として扱い、再利用禁止とする。
- `AtomicPersistence.merge` において、`terminalStates` に含まれる status を持つ binding を `active` で上書きしてはならない。

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
  readonly documentDigest: string;
  readonly globalBodyDigest: string;
  readonly tasks: ReadonlyArray<CanonicalTaskSnapshot>;
};

export type PlanFingerprint = {
  readonly algorithm: "sha256";
  readonly value: string; // lowercase hex
};
```

- `PlanFingerprint` が canonical plan document から直接生成する。`PlanParser` の解析結果をそのまま使わない。
- `PlanFingerprint` は `{ algorithm: "sha256"; value: string }` 型とし、`ApprovedPlanBinding.planFingerprint` でも同一の structured 型を使用する。外部化表現は `sha256:<lowercase hex>` とする。
- 正規化対象は以下に限定する。
  - task execution progress checkbox state（Approved Canonical Snapshot 上で task 実行進捗として認識された `- [ ]` / `- [x]` のみ）。task 外の global/unscoped セクションに含まれる checkbox は semantic change として扱い、正規化しない。
  - EOL (`\r\n` → `\n`)
- fenced code block 内部は一切 normalize しない。コード例の意味変更を見逃さない。
- 一般空白・Task 本文は正規化しない。fail-closed に倒す。
- legacy Error annotation (`> ⚠️ **Error**: ...`) は **fingerprint normalization には含めない**。承認作成前の one-time migration において、削除対象は Justice-generated record（例：`.justice/events/*.jsonl` 内の `error_annotation` observation、または v1/v2 で Justice が plan.md へ書き込んだ provenance）で裏付けられる行に限定する。ユーザーが手動で記述した同じ記法、または provenance が確認できない行は semantic content として残し、migration warning を記録する。
- `documentDigest` は正規化後の全文 digest、`globalBodyDigest` は task 外の plan 本文 digest。semantic mutation の診断性を高める。

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

export type TaskAttemptId = string;

export type FinalizationAttemptId = string;

export type PlanFinalizationState =
  | "tasks_pending"
  | "all_tasks_accepted"
  | "final_review_pending"
  | "final_gate_pending"
  | "final_rework_required"
  | "complete";

export type TaskExecutionRef = {
  readonly authorizationId: string;
  readonly taskId: string;
  readonly attemptId: TaskAttemptId;
};

export type TaskLifecycleTransitionRecord = {
  readonly recordType: "observation";
  readonly kind: "task_lifecycle_transition";
  readonly taskId: string;
  readonly attemptId: TaskAttemptId;
  readonly authorizationId: string;
  readonly from: TaskProgressState;
  readonly to: TaskProgressState;
  readonly reason: string;
};

export type PlanFinalizationTransitionRecord = {
  readonly recordType: "observation";
  readonly kind: "plan_finalization_transition";
  readonly planPath: string;
  readonly authorizationId: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
  readonly from: PlanFinalizationState;
  readonly to: PlanFinalizationState;
  readonly reason: string;
};
```

- `TaskLifecycle Core` は永続化に依存しない。
- `TaskAttemptId` は `authorizationId` + `taskId` 単位で発行する不透明な文字列である。同一 task における異なる attempt は異なる `attemptId` を持つ。
- `FinalizationAttemptId` / `finalReviewRound` は plan finalization の各 iteration を区別する。`final_rework_required → final_review_pending` 遷移時には、**新しい `finalizationAttemptId`（新 UUID）および増分した `finalReviewRound` を両方発行・更新する**。
- lifecycle transition は `TaskLifecycleTransitionRecord` / `PlanFinalizationTransitionRecord` として durable observation/decision log に記録される。各 record は current `attemptId` / `finalizationAttemptId` を保持する。
- durable log に書き込まれる `PersistedEnvelope`（persisted observation/decision record envelope）は、スコープに応じた実行コンテキストを必ず含む。task-scoped レコードでは `taskExecutionRef`（`authorizationId` / `taskId` / `attemptId`）を、plan-scoped レコードでは `{ authorizationId, finalizationAttemptId }` を含める。これにより restart / replay 時に当該レコードがどの attempt に属するかを再構築できる。
- 合法遷移表を定義し、重複イベント・無効遷移は idempotent に扱う。同一 `TaskExecutionRef` + 同一 transition identity の重複のみ idempotent に無視する。transition identity には必要に応じて `eventId` を含め、replay 時の冪等性を保つ。許可されていない `accepted → pending` 遷移は無効として記録。
- restart / replay 時は event log を時系列で再投影する。projector は current attempt / current finalization attempt の証拠・レビューのみを Gate 評価に使用する。`all_tasks_accepted` の task 集合は、current checkbox ではなく **Approved Canonical Snapshot に含まれる task IDs** を SSOT とする。
- compaction / restart 後は `state-projection.ts` の拡張によりこれらを再構築する。
- 新規 persistence file は作らない。

### 4.5 Review Artifact

```ts
export type ReviewWorkerResultV1 = {
  readonly schemaVersion: 1;
  readonly complete: boolean;
  readonly findings: ReadonlyArray<ReviewItem>;
};

export type ReviewKind = "task-review" | "final-review";

export type ReviewSource = "sp-review" | "sp-final-review";

export type TaskReviewCorrelation = {
  readonly reviewKind: "task-review";
  readonly taskExecutionRef: TaskExecutionRef;
  readonly reviewRound: number;
};

export type FinalReviewCorrelation = {
  readonly reviewKind: "final-review";
  readonly planPath: string;
  readonly authorizationId: string;
  readonly planFingerprint: PlanFingerprint;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
};

export type ReviewCorrelation =
  | TaskReviewCorrelation
  | FinalReviewCorrelation;

export type ReviewSeverity = "critical" | "major" | "minor";

export type ReviewItem = {
  readonly itemKey: string;
  readonly evidenceId: string;
  readonly severity: ReviewSeverity;
  readonly summary: string;
  readonly location: string;
  readonly status: "open" | "resolved";
};

export type ReviewArtifactV1 = {
  readonly schemaVersion: 1;
  readonly reviewKind: ReviewKind;
  readonly reviewSource: ReviewSource;
  readonly correlation: ReviewCorrelation;
  readonly complete: boolean;
  readonly findings: ReadonlyArray<ReviewItem>;
};
```

- `sp-review` / `sp-final-review` worker の起動は Justice ではなく Controller (Atlas) が `task(category="sp-review" | "sp-final-review")` として行う。
- Justice は `ReviewPending` / `FinalReviewPending` 状態の提示と、review worker 実行結果の観測を行う。
- review worker と元 task / plan との correlation は内部的に `ReviewCorrelation` で保持する。`TaskReviewCorrelation` は `taskExecutionRef` を用いて review と実装 attempt を一対一に紐付ける。
- `ReviewWorkerResultV1` は review worker が生成する **untrusted reviewer output** である。Justice は `TaskCallBinding` 由来の trusted metadata と `ReviewWorkerResultV1` から権威付けされた `ReviewArtifactV1` を組み立てる。
- `ReviewArtifactV1` を mandatory review 完了の authoritative record とする。`ReviewArtifactV1` は Justice が `ReviewWorkerResultV1` + `TaskCallBinding` 由来の trusted metadata から組み立てる。`complete: true + findings: []` を clean review の完了証拠とする。
- CodeRabbit / Greptile 等の external review は observed-review 系（例：`.justice/reviews/external-*.jsonl` または `review_observed` event）として取り扱い、mandatory `sp-review` / `sp-final-review` の完了証拠にはならない。
- `ReviewArtifactV1` の Justice 到達経路（transport）は、Phase 3 では **B（JSON artifact file）に固定する**。reviewer が所定の JSON artifact file を書き、Justice が `TaskCallBinding` の trusted metadata と合わせて読み取る。typed PostToolUse payload 等の alternative は Phase 3a transport spike で検証し、達成できれば段階的に導入する。
- Trust boundary: `reviewSource` / `reviewKind` / `correlation` などの envelope metadata は `TaskCallBinding` 由来の trusted 情報を使用し、reviewer 自己申告を権威付けしない。worker が供給してよいのは `ReviewWorkerResultV1.complete` と `ReviewWorkerResultV1.findings` のみである。`ReviewArtifactV1` の組み立ては Justice が行う。

### 4.6 Gate Verdict

```ts
export type GateScope = "task" | "plan";

export type GateTrigger =
  | { readonly scope: "task"; readonly on: "task_complete" | "tool_observed" }
  | { readonly scope: "plan"; readonly on: "final_review_complete" | "plan_state_reached" };

export type GateVerdict = "PASS" | "WARN" | "FAIL";

export type TaskGateDecision = {
  readonly gateType: "task";
  readonly taskExecutionRef: TaskExecutionRef;
  readonly verdict: GateVerdict;
};

export type PlanGateDecision = {
  readonly gateType: "plan";
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
  readonly verdict: GateVerdict;
};

export type GateDecision = TaskGateDecision | PlanGateDecision;
```

- `GateScope` は gate が task 単位か plan 単位かを区別する。
- task gate decision は current `TaskExecutionRef` を含み、plan gate decision は current finalization attempt（`authorizationId` / `planPath` / `finalizationAttemptId` / `finalReviewRound`）を含む。
- task gate trigger は `task_complete` / `tool_observed` を維持するが、**lifecycle state = `gate_pending` になった場合のみ**評価する。
- plan gate trigger は `final_review_complete` とする。Final Review の `ReviewArtifactV1.complete === true` を観測したタイミングで評価する。
- `PASS` のみ `TaskAccepted` / `PlanComplete` へ進める。
- task gate で `WARN` / `FAIL` の場合は `rework_required` へ進める。
- plan gate で `WARN` / `FAIL` の場合は `final_rework_required` へ進める。
- gate evaluation 不可・内部エラー・証拠不十分の場合は `gate_pending` / `final_gate_pending` のまま `accepted` / `complete` にしない。
- 内部障害を `rework_required` にしてはならない。"Justice が壊れたので実装コードを書き直せ" という誤った意味を与えるため。

### 4.7 Task Call Purpose

```ts
export type TaskCallPurpose =
  | "implementation"
  | "task_review"
  | "final_review";

export type TaskCallBinding =
  | {
      readonly callId: string;
      readonly purpose: "implementation";
      readonly taskExecutionRef: TaskExecutionRef;
    }
  | {
      readonly callId: string;
      readonly purpose: "task_review";
      readonly taskExecutionRef: TaskExecutionRef;
      readonly correlation: TaskReviewCorrelation;
      readonly artifactRequest: ReviewArtifactRequest;
    }
  | {
      readonly callId: string;
      readonly purpose: "final_review";
      readonly correlation: FinalReviewCorrelation;
      readonly artifactRequest: ReviewArtifactRequest;
    };
```

- `task()` の PreToolUse 時に `callId` へ `TaskCallPurpose` を bind する。
- PostToolUse では purpose に応じて分岐する。
  - `implementation` → `WorkerReported` イベントを発行。
  - `task_review` / `final_review` → `ReviewWorkerResultV1` を抽出し、`TaskCallBinding` 由来の trusted metadata と合わせて `ReviewArtifactV1` を組み立て、`review_observed` イベントを発行。
- `sp-review` / `sp-final-review` として呼ばれた `task()` を、通常の implementation 完了と混同してはならない。
- `SessionStateProvider` は `callId → TaskCallBinding` の対応を管理する。`callId → taskId` だけを記録する実装は v4 で置き換える。
- `implementation` / `task_review` binding には `TaskExecutionRef` を含め、current attempt を特定できるようにする。

### 4.8 Review Required Directive

```ts
export type ReviewRequiredDirective = {
  readonly kind: "review_required";
  readonly reviewKind: "task-review" | "final-review";
  readonly correlation: ReviewCorrelation;
  readonly revieweeTaskId?: string;
  readonly revieweePlanPath?: string;
  readonly attemptId?: TaskAttemptId;
  readonly finalizationAttemptId?: FinalizationAttemptId;
};
```

- Justice が `ReviewPending` / `FinalReviewPending` に到達した場合、Controller (Atlas) へ `ReviewRequiredDirective` を inject する。task-review 時は current `attemptId`、final-review 時は current `finalizationAttemptId` を含める。
- Controller はこの directive を受けて `task(category="sp-review" | "sp-final-review")` を発行する。
- PreToolUse で review task の `callId` を `TaskCallPurpose` / `ReviewCorrelation` と相関付け、PostToolUse で `ReviewWorkerResultV1` を観測し `ReviewArtifactV1` を組み立てる。
### 4.9 Persisted Execution Binding

```ts
export type ExecutionScope =
  | {
      readonly kind: "task";
      readonly taskExecutionRef: TaskExecutionRef;
    }
  | {
      readonly kind: "finalization";
      readonly authorizationId: string;
      readonly planPath: string;
      readonly finalizationAttemptId: FinalizationAttemptId;
      readonly finalReviewRound: number;
    };

export type DelegatedExecutionBinding = {
  readonly parentSessionId: string;
  readonly parentCallId: string;
  readonly childSessionId: string;
  readonly scope: ExecutionScope;
};
```

- OmO は `task()` 呼び出しを子セッション（child session）として実行する。Justice は `DelegatedExecutionBinding` を durable log に記録し、OmO 子セッションで発生した tool 観測を親セッションの task attempt または plan finalization attempt に相関付ける。
- `parentCallId` は `TaskCallBinding.callId` と一致する。`childSessionId` は OmO 子セッションを一意に識別する runtime 識別子である。
- `childSessionId` を取得するための正確な runtime イベントや API は Phase 3 の runtime spike 項目とする。spike 結果に応じて Adapter 実装を固めるが、上記 contract は変更しない。
- `DelegatedExecutionBinding` により、子セッションの `message.updated` / `chat.params` / tool observation を親の task attempt (`ExecutionScope` の `kind: "task"`) または plan finalization attempt (`ExecutionScope` の `kind: "finalization"`) に還元できる。これは JUS-P0-04 の P0 設計要件である。
### 4.10 Review Artifact Request

```ts
export type ReviewArtifactRequest = {
  readonly artifactId: string;
  readonly artifactPath: string;
  readonly callId: string;
  readonly correlation: ReviewCorrelation;
};
```

- `ReviewArtifactRequest` は **review worker の `task()` PreToolUse 時に生成される**。`callId` は Controller が `task()` を呼び出して PreToolUse に入った後に確定するため、ReviewPending 段階では `callId` を知らない。したがって、ReviewPending 時点では correlation だけを持つ `ReviewRequiredDirective` を Controller へ発行し、PreToolUse で初めて `callId` を含む `ReviewArtifactRequest` を生成する。
- mandatory `sp-review` / `sp-final-review` は **synchronous execution（`run_in_background = false`）に固定する**。background 実行時には PostToolUse 後の artifact 読み取り契約が成立しないため、これらの mandatory review worker は synchronous 実行を必須とする。これは execution semantics の制約であり、Justice が model / agent を選択することとは無関係である。
- **Anti-replay / integrity 契約**: review artifact の生成・消費は以下の strict プロトコルに従う。
  - Justice が PreToolUse 時点で `artifactId` と `artifactPath` を生成し、`ReviewArtifactRequest` を組み立てる。
  - `artifactPath` は `callId` と `correlation` から一意に導出される。例：`.justice/reviews/<correlation-kind>-<artifactId>.json`。
  - dispatch 前に同 `artifactPath` のファイル存在を確認する。既存ファイルが存在する場合、その artifact は権威付けしてはならない。Justice は新しい `artifactId` / `artifactPath` を生成し、未使用の安全な path が得られるまで再生成を試みる（最大再生成回数を設ける）。
  - 安全な `artifactPath` を確立できない場合、`ReviewArtifactRequest` を `unusable` 扱いとする。Runtime 実行は fail-open とする（`task()` 呼び出しを継続させる）が、mandatory review completion は成立させず、`TaskAcceptanceDecision` / `PlanAcceptanceDecision` は `blocked` 扱いとする。`review_unexpected_existing_artifact` advisory を記録する。
  - `ReviewArtifactRequest` を `TaskCallBinding`（`task_review` / `final_review`）の `artifactRequest` フィールドへ bind する。
  - Controller の prompt / injected directive には `artifactPath` のみを提示し、review worker はそのパスへ `ReviewWorkerResultV1` を JSON として書き出す。
  - Justice は matching PostToolUse 到達後、対応する `TaskCallBinding.artifactRequest` に基づいて `artifactPath` を **ちょうど 1 回だけ** 読み取る。読み取り結果は strict schema validation を通す。
  - 読み取った内容の digest と `artifactId` を observation log に記録する（`review_artifact_consumed` event）。
  - consume 後、元ファイルを archive / move または delete する。同一 `artifactPath` の再読取りを防止する。
  - 別の attempt（新 `TaskExecutionRef`）や別の finalization attempt（新 `FinalizationAttemptId`）で古い `artifactId` / `artifactPath` を再利用してはならない。`artifactId` は attempt 単位で新規 UUID を発行する。
### 4.11 Acceptance Decision

```ts
export type TaskAcceptanceDecision = {
  readonly kind: "task-acceptance";
  readonly taskExecutionRef: TaskExecutionRef;
  readonly verdict: "accepted" | "rework-required" | "blocked";
};

export type PlanAcceptanceDecision = {
  readonly kind: "plan-acceptance";
  readonly authorizationId: string;
  readonly planPath: string;
  readonly finalizationAttemptId: FinalizationAttemptId;
  readonly finalReviewRound: number;
  readonly verdict: "complete" | "rework-required" | "blocked";
};

export type AcceptanceDecision =
  | TaskAcceptanceDecision
  | PlanAcceptanceDecision;
```

- `AcceptanceDecision` は Gate 評価結果に基づき Justice が発行する decision record である。
- task acceptance decision は current `TaskExecutionRef` に bind される。plan acceptance decision は current finalization attempt（`authorizationId` / `planPath` / `finalizationAttemptId` / `finalReviewRound`）に bind される。
- `accepted` / `complete` は Gate `PASS` 時のみ発行する。`rework-required` は Gate `WARN` / `FAIL` 時に発行する。`blocked` は gate evaluation 不可・内部エラー・証拠不十分時に発行する。
- `AcceptanceDecision` は durable decision log に書き込まれ、`TaskLifecycleTransitionRecord` / `PlanFinalizationTransitionRecord` と共に restart / replay 時の状態再構築に使用される。

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
      authorizationId: <new UUID>,
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
      → invalidatedAt を記録
      → [JUSTICE: AUTHORIZATION INVALIDATED] advisory

release 条件:
  PlanFinalizationState === "complete"
  ∨ ユーザー明示 cancel (/justice-implement --cancel)
      → releasedAt を記録

authorization merge rule:
  - terminal state ("invalidated" / "released") を "active" で上書きしてはならない。
  - 同一 authorizationId で競合した場合、timestamp が新しい terminal state を採用する。
  - 再承認は新しい authorizationId を発行する。

authorization cardinality:
  - 同一 session に active な `ApprovedPlanBinding` は高々 1 つまでとする（at most one active binding per session）。
  - 新しい plan を approve する際、同一 session に既存 active binding が存在する場合は **atomically に既存 binding を `invalidated`（reason = `plan_superseded`）とし、新しい `authorizationId` を発行する**。
  - 明示的な cancel を要求して新規承認をブロックする挙動は P0 では採用しない。

restart / hydration:
  - plugin startup / session hydration 時に、`.justice/authorizations.json` 内の active binding から `PlanBridge` の active plan を復元する。
  - active binding が存在するが plan ファイルがない場合は binding を invalidated とする。
  - 復元後も fingerprint 不一致チェックは継続して実行する。
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
  → `TaskCallPurpose` を確認（implementation の場合のみ以下を実行）
  → WorkerReported イベントを発行
  → EvidenceEngine: evidence 収集 (observed / derived provenance のみ)
       evidence は current `TaskExecutionRef` に bind する
  → EvidencePending → ReviewPending

Justice
  → ReviewPending 到達時に `ReviewRequiredDirective` を Controller (Atlas) へ inject
       directive は current `TaskExecutionRef` を含む

Controller (Atlas)
  → task(category="sp-review") with `TaskReviewCorrelation`
       `TaskReviewCorrelation` は current `TaskExecutionRef` を含む
  → この task() は OmO 子セッションとして実行される
  → `DelegatedExecutionBinding` で親セッションの `TaskExecutionRef` と子セッションを相関付ける
  → review worker は `ReviewArtifactRequest` に従い Justice が生成したパスへ JSON artifact を書き出す
  → review worker 観測

Justice
  → `ReviewWorkerResultV1` を抽出し、`TaskCallBinding` 由来の trusted metadata と合わせて `ReviewArtifactV1` を組み立てる
  → `ReviewArtifactV1` は current `TaskExecutionRef` に bind する
  → ReviewPending → GatePending
  → lifecycle state = `gate_pending` になったタイミングで GateEngine 評価
       評価対象は current attempt の Evidence / Review のみ
       PASS  → `TaskAcceptanceDecision { accepted }`
             → TaskProgressState = accepted
             → ProgressUpdater → PlanParser.updateCheckbox()
       WARN/FAIL → rework_required → 新しい `TaskExecutionRef`（新 attemptId）を発行して in_progress へ
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
  Worker implementation (TaskExecutionRef = R)
    → Justice injects `ReviewRequiredDirective` to Controller
       directive includes current `TaskExecutionRef`
    → Controller dispatches sp-review worker
    → `DelegatedExecutionBinding` correlates child session to parent `TaskExecutionRef`
    → sp-review worker writes `ReviewWorkerResultV1` to the path in `ReviewArtifactRequest`
    → Justice reads the artifact exactly once after matching PostToolUse
    → Justice assembles `ReviewArtifactV1` from trusted metadata + worker result
    → `ReviewArtifactV1` is bound to TaskExecutionRef R
    → Gate evaluation (when lifecycle state = gate_pending)
       Evidence / Review for current TaskExecutionRef R only
       PASS  → TaskAccepted
       WARN/FAIL → rework_required → new TaskExecutionRef R' → in_progress

Final Review:
  All Tasks Accepted
    → PlanFinalizationState = final_review_pending
    → finalizationAttemptId / finalReviewRound = N
    → Justice injects `ReviewRequiredDirective` to Controller
       directive includes current `finalizationAttemptId`
    → Controller dispatches sp-final-review worker
    → `DelegatedExecutionBinding` correlates child session to parent finalization attempt
    → sp-final-review worker writes `ReviewWorkerResultV1` to the path in `ReviewArtifactRequest`
    → Justice reads the artifact exactly once after matching PostToolUse
    → Justice assembles `ReviewArtifactV1` from trusted metadata + worker result
    → `ReviewArtifactV1` is bound to finalizationAttemptId N
    → Final Gate evaluation (trigger: final_review_complete)
      PASS
        → PlanFinalizationState = complete
        → Authorization released
      WARN/FAIL
        → PlanFinalizationState = final_rework_required
        → fixes
        → PlanFinalizationState = final_review_pending
        → new finalizationAttemptId N' (new UUID) / finalReviewRound N+1
        → Final Gate re-evaluation using only current finalization attempt evidence
      internal error / insufficient evidence
        → PlanFinalizationState = final_gate_pending (blocked)
```

- `sp-review` / `sp-final-review` の起動主体は Controller。
- Justice は `ReviewRequiredDirective` の生成と、review correlation / `TaskCallBinding` / `DelegatedExecutionBinding` / `ReviewArtifactRequest` を通じた review worker 結果の観測、および `ReviewArtifactV1` の組み立てを行う。
- `ReviewArtifactV1`（`complete: true + findings: []`）のみを mandatory review 完了の authoritative evidence とする。
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
| `tests/core/task-lifecycle.test.ts` | WorkerReported≠accepted、declared-only で Gate 不成立、Gate FAIL→rework、Final Review 未了で PlanComplete=false、attempt scoping で古い evidence の再利用を防ぐ |
| `tests/core/acceptance-decision.test.ts` | PASS/WARN/FAIL/unavailable それぞれの遷移、evidence provenance 判定 |
| `tests/doctor/category-presence.test.ts` | `justice doctor` が 7 `sp-*` category の欠落を検出 |
| `tests/hooks/plan-bridge-authorization.test.ts` | `/justice-implement --approved` が binding を発行、不一致で invalidate |

### 6.2 特に追加すべきシナリオ

- `AtomicPersistence` が `conflict_diverted` を返した場合、authorization が成立しないこと。
- authorizationId を持たない / terminal state を上書きする merge rule が許可されていないこと。
- restart / replay 後に durable log から lifecycle を復元すること。
- active binding から `PlanBridge` の active plan が復元されること。
- external review だけでは `sp-review` / `sp-final-review` 要件を満たさないこと。
- review task と implementation task の correlation / `TaskCallPurpose` / `TaskExecutionRef` が正しく機能すること。
- `ReviewArtifactV1.complete: true + findings: []` を clean review 完了証拠として扱うこと。
- persisted evidence が attempt-scoped（`TaskExecutionRef` / `FinalizationAttemptId`）であること。
- OmO child session correlation（`DelegatedExecutionBinding`）が正しく機能すること。
- review artifact anti-replay（`ReviewArtifactRequest`）が機能すること。
- attempt-aware duplicate suppression が機能すること。
- acceptance decision binding が `TaskExecutionRef` / `FinalizationAttemptId` に束縛されること。
- Final Review 未完了では全 checkbox `[x]` でも `PlanComplete` にならないこと。
- Controller Routing で Core が Atlas を返し Runtime が Sisyphus のままなら `routingStatus = mismatch` であること。
- fingerprint が fenced code block 内部を正規化せず、legacy Error annotation 追加で変化すること。
- Gate 評価が lifecycle state = `gate_pending` に一本化され、Review 前に Gate Decision が発生しないこと。

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
- Gate model の task 固定から `GateScope = task | plan` への拡張
- `task()` 完了直後の即時 Gate 評価の廃止（lifecycle state = `gate_pending` 駆動へ移行）
- Evidence / Review / Gate 判定が task attempt 単位に scope される（`TaskAttemptId` 導入）
- Plan finalization における Final Review / Final Gate が finalization attempt 単位に scope される（`FinalizationAttemptId` / `finalReviewRound` 導入）
- `ReviewArtifactV1` が review worker output (`ReviewWorkerResultV1`) から Justice が組み立てる権威付けレコードへ変更
- Review transport を Phase 3 では JSON artifact file (B) に固定

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
| INV-09 | Final Review / Final Gate precedes Plan Complete |
| INV-10 | Fail-open execution ≠ fail-open acceptance |
| INV-11 | `TaskCallPurpose` separates implementation, task_review, final_review |
| INV-12 | Terminal authorization states (invalidated / released) are not resurrected |
| INV-13 | JUS-P0-04 side-effecting handlers in `PostToolUse` are not dispatched via `Promise.all` |
| INV-14 | Evidence / Review / Gate / Acceptance are scoped to exactly one `TaskExecutionRef` or `FinalizationAttemptId`. |
| INV-15 | Mandatory `sp-review` / `sp-final-review` completion must be observed before its `ReviewArtifact` is consumed. |

---

## 9. 推奨実装順序

| Phase | 対象 | ゴール |
|---|---|---|
| Phase 1 | JUS-P0-03 Category Routing | 7 role → 7 `sp-*` category の全射化、silent downgrade 除去、`justice doctor` 検査追加 |
| Phase 2 | JUS-P0-02 Plan Authorization | one-shot arm を Plan-Scoped Authorization に置換、fingerprint + canonical snapshot 実装 |
| Phase 3 | JUS-P0-04 Transactional Acceptance | WorkerReported / TaskAccepted 分離、Evidence→Review→Gate→Acceptance→Progress の直列化。`childSessionId` correlation runtime spike が失敗した場合、authoritative child evidence が確立せず、`TaskAccepted` / `PlanComplete` が blocked となるため、Phase 3 DoD は通らない。 |
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
16. `TaskCallPurpose` によって implementation / task_review / final_review が区別されている。
17. `ReviewArtifactV1` により clean review を authoritative に観測できる。
18. Authorization の terminal state が再承認なしに復活しない。

---

## 11. 決定事項メモ

- **Controller Runtime Wiring**: 現行 OpenCode plugin API で in-band agent 切替は不可。config 経由の `agent:` ピン留めを guaranteed application path とし、mismatch detection を主たる観測機能とする。完全な runtime 切替は upstream API 拡張要求として分離。
- **Plan Fingerprint**: 正規化対象を Approved Canonical Snapshot 上で task 実行進捗として認識された checkbox state / EOL のみに限定。global/unscoped セクションの checkbox は正規化しない。legacy Error annotation は one-time migration で除去。一般空白・Task 本文は正規化しない (fail-closed)。fingerprint は `sha256:<lowercase hex>` と仕様化。
- **Task Lifecycle**: 純粋 Core とし、永続化に依存しない。`TaskLifecycleTransitionRecord` / `PlanFinalizationTransitionRecord` を durable log へ書き、v2 state projection 拡張で復元。`all_tasks_accepted` の task 集合は Approved Canonical Snapshot を SSOT とする。
- **Progress Update**: Worker success からの直接 plan.md 更新を廃止。`TaskAccepted` 後の専用 ProgressUpdater 経由でのみ checkbox を更新。
- **Task Attempt**: `TaskAttemptId` は `authorizationId` + `taskId` 単位で発行し、`in_progress` 遷移時に新規 attempt を作成する。Gate は current attempt の Evidence / Review のみを評価する。rework 時は新しい attemptId を発行する。
- **Finalization Attempt**: `FinalizationAttemptId` / `finalReviewRound` を導入し、`final_rework_required → final_review_pending` 遷移時には新しい `finalizationAttemptId`（新 UUID）と増分した `finalReviewRound` を両方更新する。Final Gate は current finalization attempt の evidence / review のみを評価する。
- **Review**: `sp-review` / `sp-final-review` worker は Controller が `task()` として起動。Justice は `ReviewRequiredDirective` 生成、`ReviewCorrelation` / `TaskCallBinding` / `DelegatedExecutionBinding` / `ReviewArtifactRequest` を通じた review worker 結果の観測、`ReviewArtifactV1` 組み立てを担当。`ReviewArtifactV1.complete: true + findings: []` のみを clean review 完了の authoritative evidence とする。external review を mandatory review 完了の証拠とはしない。Review transport は Phase 3 では JSON artifact file (B) に固定し、Phase 3a transport spike で typed transport の導入を検証する。
- **Gate Verdict**: `UNKNOWN` は採用しない。評価不能・内部エラー時は `gate_pending` / `final_gate_pending` のまま acceptance / completion blocked。task gate に加え plan gate（Final Gate）を追加。Gate 評価は lifecycle state = `gate_pending` / `final_gate_pending` 時に実行。task gate の `WARN` / `FAIL` は `rework_required`、plan gate の `WARN` / `FAIL` は `final_rework_required` へ進める。
- **Traceability**: 本設計書の修正に伴い、`REQUIREMENTS_2026-09-03.md` 側への反映（JUS-P0-04-06 の UNKNOWN 扱いの整理、JUS-P0-01 の pinned-command 適用の具体化など）は別途実施する。
