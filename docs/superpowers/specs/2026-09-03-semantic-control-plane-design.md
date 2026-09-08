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

| 層          | 責務                               | 例                                                                                               |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Superpowers | 方法論・プロセスの Source of Truth | Brainstorming / Planning / TDD / Review / Verification                                           |
| Justice     | 意味の解釈・検証・承認             | Workflow routing / Authorization / Category mapping / Observation / Evidence / Gate / Acceptance |
| OmO         | 実際のエージェント実行             | Category dispatch / Agent / Model / Provider / Fallback                                          |

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

| モジュール                          | 責務                                                                                                |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/core/controller-routing.ts`    | `WorkflowRouter` による controller 判定と、actual controller 観測からの routingStatus 評価          |
| `src/core/plan-authorization.ts`    | `ApprovedPlanBinding` のライフサイクル管理 (approve / invalidate / release)                         |
| `src/core/plan-fingerprint.ts`      | 正規化 semantic hash、canonical plan snapshot の生成                                                |
| `src/core/task-lifecycle.ts`        | Task Progress State (9状態) と Plan Finalization State (6状態) の純粋 state machine                 |
| `src/core/acceptance-decision.ts`   | Evidence / Review / Gate 結果から `accepted` / `rework_required` / blocked を判定                   |
| `src/core/review-artifact.ts`       | `ReviewArtifactV1` の検証・解析、clean review 権威付け                                              |
| `src/core/review-dispatch-state.ts` | review dispatch slot の state machine、durable claim precondition、restart / replay recovery の判定 |

### 3.2 既存モジュール拡張

- `src/core/routing-decision.ts`
  - `ControllerRoutingDecision` / `WorkerRoutingDecision` / `UnroutedRoutingDecision` 型と factory を集約。
  - canonical execution role 7種 → `sp-*` category 7種への全射を定義。
- `src/core/omo-category-mapper.ts`
  - `sp-deep` / `sp-architecture` を追加し、未マッピング role は `compatibility_fallback` 以外では例外を投げる。
- `src/core/v2/state-projection.ts`
  - durable observation/decision log から task lifecycle、plan finalization、review dispatch slot（binding / artifact reservation を含む）を再構築する projector を拡張。
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
  - review dispatch の `pending` / `claimed` / `terminal` transition を durable observation として記録する。`pending` は `ReviewRequiredDirective` の inject より先に記録する。
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
- implementation task の PreToolUse で current task に fresh `TaskExecutionRef` / `attemptId` を発行し、`authorized → in_progress` を durable に記録してから implementation `TaskCallBinding` を作る。identity allocation と transition は deterministic な transition key で結び、append 結果が不明な場合は同じ key を read-before-retry して既存 identity を再利用する。記録不能な場合も task() は fail-open で継続するが、その call は authoritative worker completion にしない。
  - implementation の matching PostToolUse では、current binding を持つ call だけを `worker_reported` として durable に記録する。続けて同じ `TaskExecutionRef` の observed / derived Evidence だけを収集し、`worker_reported → evidence_pending → review_pending` を順に投影する。old attempt の Evidence、Review、Gate は current attempt の入力にしない。
  - review terminal physical record の durable commit と projection が成功した後にだけ `review_pending → gate_pending` を記録する。次に current `TaskExecutionRef` に対して Gate を評価し、GateDecision を durable に記録する。PASS は accepted、WARN / FAIL は rework_required、評価不能・内部エラー・証拠不足は gate_pending のまま blocked とする。
  - `rework_required` の後に Controller が次の implementation task() を発行したときだけ、新しい `attemptId` を発行して `in_progress` を開始する。新 attempt の reviewRound は 1 とし、旧 attempt の binding、Evidence、Review、Gate は consume しない。
- 全 current task が accepted になったときは、fresh `FinalizationAttemptId` と初回 `finalReviewRound = 1` を発行して、まず `tasks_pending → all_tasks_accepted` を durable に記録する。identity allocation とこの transition は deterministic な transition key で結び、append 結果が不明な場合は同じ key を read-before-retry して同じ finalization identity を再利用する。最初の append が成功した後、同じ finalization identity で `all_tasks_accepted → final_review_pending` を durable に記録する。2本目の append が失敗した場合は `all_tasks_accepted` を保持し、restart / replay で同じ identity の後続 transition だけを再試行する。final review terminal commit 後にのみ `final_gate_pending` を記録して Final Gate を評価し、PASS のみ complete、WARN / FAIL は final_rework_required、評価不能は final_gate_pending のまま blocked とする。final rework の次回 dispatch は fresh finalizationAttemptId と増分した finalReviewRound を使う。
  - 順序は `classify TaskCallPurpose` → `record WorkerReported / Evidence` → `project lifecycle` → `commit ReviewRequiredDirective の pending slot` → `inject ReviewRequiredDirective` → `terminal record` → `gate_pending を投影` → `GateDecision` → `AcceptanceDecision` → `ProgressUpdater` とし、Acceptance 後のみ progress update へ進める。
  - Review dispatch では `pending` transition の durable commit → `ReviewRequiredDirective` の inject → PreToolUse の atomic claim → matching PostToolUse の terminalization の順序を保証する。

### 3.4 Doctor Effective Configuration View

`justice doctor` は source ごとの plugin specifier scan を、category / command 診断の入力に再利用してはならない。診断に必要な最小 view は次だけとする。

```ts
export type DoctorEffectiveCommandDefinition = {
  readonly agent?: string;
};

export type DoctorCommandDefinitionDiagnostic = {
  readonly kind: "invalid_command_definition";
  readonly source: string;
  readonly commandName: string;
  readonly reason: "null" | "scalar" | "array" | "agent_not_string" | "missing_agent";
};

export type DoctorSourceDiagnostic = {
  readonly kind: "source_error";
  readonly source: string;
  readonly errorCode: "unreadable" | "unsupported" | "parse_failure";
};

export type DoctorEffectiveConfigView = {
  readonly effectiveCategoryNames: readonly string[];
  readonly effectiveCommandDefinitions: ReadonlyMap<string, DoctorEffectiveCommandDefinition>;
  readonly diagnostics: readonly (DoctorCommandDefinitionDiagnostic | DoctorSourceDiagnostic)[];
};

export function isRecognizedControllerAgent(value: unknown): value is ControllerAgent {
  return (
    typeof value === "string" &&
    ["sisyphus", "atlas", "oracle", "momus", "hephaestus"].some((agent) => agent === value)
  );
}

export function isPinnedControllerCommand(
  definition: DoctorEffectiveCommandDefinition | undefined,
): definition is DoctorEffectiveCommandDefinition & { readonly agent: ControllerAgent } {
  return definition !== undefined && isRecognizedControllerAgent(definition.agent);
}
```

- source は既存 `SOURCE_PRIORITY` の低優先度から高優先度の順で処理する。readable かつ JSONC として parse できる source だけが effective view に寄与する。
- allowlisted top-level `category` と `command` の object key を読み取る。各 key の effective value は、より高優先度 source に同名 key があればその値で完全に置換する。object の deep merge、全 source の union、未定義 key の値の転写は行わない。
- unreadable source、unsupported source、parse failure は effective value を提供しない。診断には source と error code だけを残し、任意設定値や秘密値を含めない。
- category presence と pinned-command presence はこの effective view だけを consume する。doctor result に raw configuration、command body、認証情報、または無関係な設定を複写しない。command から公開してよい値は pinned-controller 検査に必要な `agent` だけとする。
- pinned-command は command key の存在だけでは成立しない。`agent` が存在し、空でなく、`ControllerAgent` として認識できる場合だけ pinned command として扱い、それ以外は `missing_agent` とする。
- JSONC の `command` 各値は effective map へ格納する前に runtime validation する。`null`、scalar、array は `{}` として扱い、`invalid_command_definition` の redacted diagnostic（`source`、command name、shape reason のみ）を記録する。object の `agent` が string 以外の場合も `{}` と `agent_not_string` diagnostic に正規化する。高優先度 source の不正値も同名の低優先度値を完全に置換するため、低優先度の `agent` を誤って復活させない。raw value は effective view、診断、CLI 出力のいずれにも複写しない。

### 3.5 Command 雛形 (Guaranteed Application Path)

OpenCode plugin API は plugin hook から同一ターンの controller agent / model を書き換えられない。調査により、`chat.params` output に `agent` / `model` フィールドが存在せず、`session.update` も title と archive state（`time.archived`）の更新に限定されることが判明した。

したがって JUS-P0-01 の "applied" 経路は、**agent ピン留め済みの command 定義を利用者が OpenCode 設定に登録すること**で成立する。

Justice は以下を提供する。

- `justice doctor` による pinned-command 不足の検査と雛形出力。
- README/ドキュメントにおける推奨 command 定義例。
- 利用者が手動で配置した場合、`chat.params` / `message.updated` の actual agent と desired controller を突き合わせて `applied` / `mismatch` / `unapplied` を判定する。

---

## 4. データモデル

### 4.1 Controller Routing

```ts
// src/core/types.ts
// Factory functions are in src/core/routing-decision.ts.
export type ControllerAgent = "sisyphus" | "atlas" | "oracle" | "momus" | "hephaestus";

export type ControllerRoutingDecision = {
  readonly kind: "controller";
  readonly workflow: string;
  readonly controller: ControllerAgent;
  readonly reason: RoutingReason;
};

// src/core/controller-routing.ts
export type ControllerApplicationMethod = "pinned-command" | "runtime-api" | "none";

export type ControllerObservationSource = "chat.params" | "message.updated" | "both" | "none";

// Runtime observations may include custom or unknown agent identifiers.
export type ObservationAgentId = string;

export type ControllerRoutingStatus = "applied" | "unapplied" | "unsupported" | "mismatch";

export type ControllerRoutingUnappliedReason = "application_not_configured" | "actual_not_observed";

export type ControllerRoutingUnsupportedReason = "runtime_capability_unsupported";

export type ControllerRoutingObservation =
  | {
      readonly routingStatus: "applied";
      readonly desiredController: ControllerAgent;
      readonly actualController: ControllerAgent;
      readonly applicationMethod: Exclude<ControllerApplicationMethod, "none">;
      readonly observationSource: "message.updated" | "both";
    }
  | {
      readonly routingStatus: "mismatch";
      readonly desiredController: ControllerAgent;
      readonly actualController: ObservationAgentId;
      readonly applicationMethod: Exclude<ControllerApplicationMethod, "none">;
      readonly observationSource: "message.updated" | "both";
    }
  | {
      readonly routingStatus: "unapplied";
      readonly desiredController: ControllerAgent;
      readonly applicationMethod: "none";
      readonly observationSource: "none";
      readonly actualController?: never;
      readonly reason: "application_not_configured";
    }
  | {
      readonly routingStatus: "unapplied";
      readonly desiredController: ControllerAgent;
      readonly applicationMethod: "none";
      readonly observationSource: "message.updated" | "both";
      readonly actualController: ObservationAgentId;
      readonly reason: "application_not_configured";
    }
  | {
      readonly routingStatus: "unapplied";
      readonly desiredController: ControllerAgent;
      readonly applicationMethod: Exclude<ControllerApplicationMethod, "none">;
      readonly observationSource: "none";
      readonly actualController?: never;
      readonly reason: "actual_not_observed";
    }
  | {
      readonly routingStatus: "unsupported";
      readonly desiredController: ControllerAgent;
      readonly applicationMethod: "runtime-api";
      readonly observationSource: "none";
      readonly actualController?: never;
      readonly reason: "runtime_capability_unsupported";
    };
```

- `applied` とするには `message.updated` で actual controller が desired と一致している必要がある。
- `chat.params` 一致だけでは `applied` にしない。`message.updated` がない場合は、`applicationMethod: "none"` なら `application_not_configured`、設定済みの application method なら `actual_not_observed` として、いずれも `observationSource: "none"` に正規化する。
- `actualController` は `ObservationAgentId`（`"unknown"` を含む）で表現し、unknown agent 観測時も `mismatch` として記録する。
- `unsupported` は将来 OpenCode に runtime 適用 API が追加された場合の予約値。現行 API では発生しない。
- 各 status は必須フィールドを区別する discriminated union とし、`applied` 状態で `reason` を持たせたり、`unapplied` で `actualController` を必須にしたりするような illegal state は表現できない。
- `mismatch` は runtime execution の観測結果なので、`observationSource` は `message.updated` または `both` に限定する。`chat.params` だけの場合は、`applicationMethod: "none"` なら `application_not_configured`、設定済み方式なら `actual_not_observed` へ誘導する。
- `application_not_configured` は `applicationMethod: "none"` に限定する。`message.updated` / `both` で実際のagentが観測された場合だけ `actualController` を持ち、`chat.params` だけ、または観測なしの場合は `observationSource: "none"` かつ `actualController` なしで正規化する。
- `actual_not_observed` は `applicationMethod: "none"` 以外の設定済み適用方式と `observationSource: "none"` の組み合わせに限定する。`chat.params` だけの入力はこの形へ正規化し、`applicationMethod: "none"` の入力はこの形にしない。

### 4.2 Plan Authorization

```ts
type ApprovedPlanBindingBase = {
  readonly authorizationId: string;
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly canonicalSnapshot: CanonicalPlanSnapshot;
  readonly fingerprintSchema: "justice-plan-v1";
  readonly approvedAt: string;
};

export type ApprovedPlanBinding =
  | (ApprovedPlanBindingBase & {
      readonly status: "active";
    })
  | (ApprovedPlanBindingBase & {
      readonly status: "invalidated";
      readonly invalidatedAt: string;
      // Only supersession needs a durable reason in P0; other invalidations need no reason taxonomy.
      readonly invalidationReason?: "plan_superseded";
    })
  | (ApprovedPlanBindingBase & {
      readonly status: "released";
      readonly releasedAt: string;
    });

export type AuthorizationMergeRule = {
  readonly terminalStates: ReadonlyArray<"invalidated" | "released">;
  readonly resolve: (mine: ApprovedPlanBinding, theirs: ApprovedPlanBinding) => ApprovedPlanBinding;
};

export type AuthorizationBindingsMerge = (
  mine: ReadonlyArray<ApprovedPlanBinding>,
  theirs: ReadonlyArray<ApprovedPlanBinding>,
) => ReadonlyArray<ApprovedPlanBinding>;

export type AuthorizationReviewBoundary = {
  readonly withParentSession<T>(
    parentSessionId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
};

export type ApprovePlanInput = {
  readonly sessionId: string;
  readonly planPath: string;
  readonly planFingerprint: PlanFingerprint;
  readonly canonicalSnapshot: CanonicalPlanSnapshot;
  readonly approvedAt: string;
};

export type AuthorizationActivePlanReconciler = (
  parentSessionId: string,
  activeBinding: Extract<ApprovedPlanBinding, { readonly status: "active" }> | null,
) => void;

export type AuthorizationMutationResult =
  | {
      readonly kind: "saved";
      readonly binding: Exclude<ApprovedPlanBinding, { readonly status: "active" }>;
    }
  | {
      readonly kind:
        | "not_found"
        | "wrong_parent"
        | "already_terminal"
        | "fingerprint_current"
        | "failed"
        | "uncertain";
    };
```

- `authorizationId` は承認単位の不変 identity。同一 `authorizationId` では `active → invalidated|released` は不可逆とする。
- 再承認（re-approval）は新しい `authorizationId` を発行する。古い terminal binding を `active` に戻す merge は禁止する。
- `fingerprintSchema` は canonicalization ロジックが将来変わったときの安全装置である。
- 承認時に `CanonicalPlanSnapshot` を必ず生成し、同一の `ApprovedPlanBinding` record に格納する。snapshot の別 store、別 cache、または別 persistence file を SSOT としてはならない。
- `invalidatedAt` / `releasedAt` は監査・競合解決用タイムスタンプ。
- `invalidationReason: "plan_superseded"` は、新しい approval によって無効化された binding
  にだけ永続化する P0 の監査値である。一般化した invalidation-reason framework は導入しない。
- `invalidated` / `released` 状態の永続化に失敗しても、その binding store を uncertain として扱い、再利用禁止とする。
- `AtomicPersistence.merge` において、`terminalStates` に含まれる status を持つ binding を `active` で上書きしてはならない。
- `AuthorizationBindingsMerge` は authorization domain 専用の `AtomicPersistence.merge` hook である。generic conflict-resolution abstraction は導入しない。
- `ApprovedPlanBinding.sessionId` は review dispatch の `parentSessionId` と同じ serialization key として扱う。Authorization の approval / release / invalidation と、対応する review dispatch・artifact・Gate・Acceptance の state-changing append および directive injection は、同じ注入済み `AuthorizationReviewBoundary.withParentSession` の内側で実行する。この boundary は durable commit を直列化する domain boundary であり、generic transaction / mutex framework ではない。
- boundary は Authorization の durable commit だけでなく、その結果に依存する cancellation、claim、artifact terminalization、Gate / Acceptance append、directive injection が完了するまで保持する。各処理内の active check は defense-in-depth とし、check 後に boundary 外で正の状態変更を行ってはならない。restart 後は durable Authorization と observation log の再読が authority であり、in-memory queue を復元しない。
- `AuthorizationReviewBoundary` は parent session ごとの非再入 promise-tail queue である。factory は process-local の空 map から開始し、predecessor rejection を吸収し、operation 開始前に current tail を install し、operation の成功・失敗の双方で completion を release する。tail cleanup は map の current tail が自己の tail と一致するときだけ行い、古い operation が後続 tail を削除してはならない。これは durable authority でも generic lock framework でもない。
- shared boundary を取得する public operation と、すでに同じ parent-session boundary を保持する caller 専用の `WithinAuthorizationReviewBoundary` operation を分離する。後者は boundary を再取得しない。parent boundary 内から public wrapper を呼ぶこと、暗黙の reentrancy、generic reentrant mutex、domain ごとの独立 queue は禁止する。
- `AuthorizationStore.approve(input)` は `input.sessionId` をキーに shared boundary を一度だけ取得し、`approveWithinAuthorizationReviewBoundary(input, reconcileActivePlan)` へ委譲する。すでに同じ parent-session boundary を保持する PlanBridge は public `approve` を呼ばず、within-boundary operation を直接呼ぶ。`reconcileActivePlan` は PlanBridge が所有する再構築可能な active-plan cache だけを更新する callback であり、durable authority ではない。optional boundary、test-only boundary、暗黙の fallback は追加しない。
- approval の initial read、candidate 作成、same-session active の `plan_superseded` 化、fresh binding 追加、`saveAtomicWithLock(candidate, loadedLockMeta)` は同じ boundary 内で行う。`AtomicPersistence.saveAtomicWithLock()` の `status: "saved"` は、candidate の配列が merge 後に保存されたことだけを意味し、呼び出し元の fresh `authorizationId` が current active であることを意味しない。
- `status: "saved"` 後は、同じ boundary を保持したまま authoritative `.justice/authorizations.json` を再読する。再読した配列から同一 session の active bindings を exact に確認し、active が一件で、かつ fresh `authorizationId` と一致した場合だけ `approve()` はその authoritative binding を返す。fresh ID が `invalidated` / `released` になった場合、別の binding が winner であっても、要求した plan の approval は成功扱いにせず `null` を返す。別 plan の winner を requested approval の positive result または armed result として返してはならない。
- own fresh ID が winner ではないが post-save reread が成功した場合、`reconcileActivePlan` には latest durable active binding（なければ `null`）を渡して cache を reconciliation する。ただし `approve()` の戻り値は `null` のままとし、PlanBridge は request を arm しない。own fresh ID が winner の場合だけ callback に own binding を渡して cache を publish し、PlanBridge は同じ binding を armed result にする。
- post-save authoritative reread が失敗した場合、fresh candidate を positive authority にせず、`reconcileActivePlan(sessionId, null)` で stale positive cache を clear し、`approve()` は `null` を返す。再読前の cache を fresh candidate として残したり、requested plan を armed にしたりしてはならない。initial read failure、例外、`conflict_diverted` では save が authoritative success ではないため callback を呼ばず、既存 cache を勝手に置換しない。

  approval と active-plan cache の callback 契約は、以下の行列を normative contract とする。callback の結果は approval の戻り値や arm 可否を変更しない。

  | outcome | save | `reconcileActivePlan` | `approve()` | cache / arm behavior |
  | --- | --- | --- | --- | --- |
  | initial authoritative read failure | save しない | 呼ばない | `null` | existing cache を変更せず、arm しない |
  | save exception / `conflict_diverted` | authoritative success ではない | 呼ばない | `null` | requested candidate を publish せず、existing cache を変更しない |
  | save 成功 + post-save reread 成功 + own fresh ID が winner | saved | active own binding を渡す | 同じ active binding | requested approval は arm してよい |
  | save 成功 + post-save reread 成功 + own fresh ID が loser | saved | latest durable active winner、なければ `null` を渡す | `null` | requested loser plan を publish / arm しない |
  | save 成功 + post-save reread 失敗 | saved | `null` を渡す | `null` | stale positive cache を clear し、requested plan を arm しない |
- `AuthorizationStore.hydrate()` は authoritative `.justice/authorizations.json` だけを読み、durable binding を返す。`.justice/authorizations.conflict.json` は conflict journal であり authority として読まない。read / parse / validation failure は空の binding 集合へ変換して authority を偽装せず、`PlanBridge.restoreActivePlans()` に failure を伝播して `AuthorizationRestorationOutcome = "uncertain"` にする。`hydrate()` が返した `status: "active"` binding は、それだけでは active-plan cache restore の authority ではない。`invalidated` / `released` binding は cache restore しない。startup validation、terminalization、cache publication は §5.2 の `PlanBridge.restoreActivePlans()` contract が唯一所有する。
- `AuthorizationStore.release(authorizationId, at)` と fingerprint invalidation の public wrapper は、まず authoritative binding を `authorizationId` の exact match で読み、そこから得た不変 `sessionId` で boundary を一度だけ取得する。binding がない、読込に失敗した、または persistence が uncertain な場合は defined non-success を返し、親 session を推測してはならない。
- `releaseWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, at)` と `invalidateForFingerprintWithinAuthorizationReviewBoundary(parentSessionId, authorizationId, currentFingerprint, at)` は、すでに同じ parent-session boundary を保持する caller 専用である。どちらも authoritative array を再読し、exact authorization ID と `binding.sessionId === parentSessionId` を確認する。release は active binding だけを `released` にし、invalidation は active binding の stored fingerprint が `currentFingerprint` と異なる場合だけを `invalidated` にする。terminal binding を active に戻してはならない。
- inner mutation は一回の `AtomicPersistence.saveAtomicWithLock` だけで durable state を更新し、`status: "saved"` のときだけ `AuthorizationMutationResult` の saved result を返す。missing、wrong parent、already terminal、unchanged fingerprint は deterministic non-success とする。例外は `failed`、claim/version conflict が conflict journal へ divert された場合は `uncertain` とし、いずれも terminal cache や review cancellation の authority にしない。inner mutation 自体は cache を更新しない。
- Authorization release / fingerprint invalidation と dependent review cancellation は一つの outer boundary operation とする。PlanBridge は public `release` / invalidation wrapper を boundary 内から呼ばず、対応する within-boundary mutation、review cancellation の within-boundary helper、cache update をこの順で実行してから boundary を release する。terminal Authorization の durable commit は cancellation 失敗時にも rollback しないが、その cancellation attempt が終わるまで gap を作らない。
- PlanBridge は inner mutation が `saved` でない限り cancellation tombstone を試行せず、terminal active-plan cache を publish しない。saved の場合だけ review cancellation を試行し、その attempt と cache update が完了するまで outer boundary を保持する。
- Gate evaluator の public entry は parent boundary を取得してから decision-identity serialization を取得する。review completion、staged recovery、post-terminal outcome recovery のように parent boundary をすでに保持する path は、parent boundary を再取得せず、同じ decision-identity serialization を保持する within-boundary Gate capability だけを使用する。

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

export type ErrorAnnotationObservation = {
  readonly recordType: "observation";
  readonly kind: "error_annotation";
  readonly provenance: "observed" | "unknown";
  readonly planPath: string;
  readonly planSnapshotDigest: string;
  readonly target: {
    readonly lineNumber: number;
    readonly occurrence: number;
    readonly normalizedLineDigest: string;
  };
};
```

- `PlanFingerprint` が canonical plan document から直接生成する。`PlanParser` の解析結果をそのまま使わない。
- 承認作成時は `PlanParser.parse(raw).map((task) => task.id)` を canonicalization
  の task ID 入力として使用する。承認後の再計算では
  `ApprovedPlanBinding.canonicalSnapshot.tasks.map((task) => task.taskId)` を唯一の
  task ID 入力として使用する。現在の文書に現れる heading だけから task scope を
  再推定してはならない。
- `PlanFingerprint` は `{ algorithm: "sha256"; value: string }` 型とし、`ApprovedPlanBinding.planFingerprint` でも同一の structured 型を使用する。外部化表現は `sha256:<lowercase hex>` とする。
- 正規化対象は以下に限定する。
  - task execution progress checkbox state（Approved Canonical Snapshot の task ID 集合に
    含まれる task section で認識された `- [ ]` / `- [x]` のみ）。snapshot にない task
    heading、task 外の global/unscoped セクション、および fenced code block 内の checkbox
    は semantic change として扱い、正規化しない。task heading を snapshot task ID へ一意に
    対応付けられない場合は fail-closed で fingerprint を変更する。
  - EOL (`\r\n` → `\n`)
- fenced code block 内部は一切 normalize しない。コード例の意味変更を見逃さない。
- 一般空白・Task 本文は正規化しない。fail-closed に倒す。
- legacy Error annotation (`> ⚠️ **Error**: ...`) は **fingerprint normalization には含めない**。承認作成前の one-time migration において、削除対象は Justice-generated record（例：`.justice/events/*.jsonl` 内の `error_annotation` observation、または v1/v2 で Justice が plan.md へ書き込んだ provenance）で裏付けられる行に限定する。ユーザーが手動で記述した同じ記法、または provenance が確認できない行は semantic content として残し、migration warning を記録する。
- `ErrorAnnotationObservation` は `PersistedLogRecord` の typed observation variant として、safe な `planPath`、EOL 正規化前の plan snapshot digest、および 1-based の `lineNumber`、同一 normalized line 内の 1-based `occurrence`、normalized line digest を保持する。`provenance: "observed"` だけが migration の削除根拠になり、`unknown` は保存する。
- `src/core/v2/observation-model.ts` の `PendingObservationRecord` は `PendingEnvelope & ErrorAnnotationObservation` を含み、`PersistedLogRecord` はその sequence 付き variant を含む。producer は annotation を plan に追記する代わりにこの observation を durable append し、replay は同じ typed record を migration の入力へ渡す。
- `migrateJusticeGeneratedErrorAnnotations` は現在の `planPath` と EOL 正規化した raw snapshot digest が一致する observation だけを対象にする。対象 line の digest、line number、occurrence がすべて一致しない限り削除せず、同一内容の複数行を occurrence なしで一括削除してはならない。
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
  readonly parentSessionId: string;
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
  readonly parentSessionId: string;
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
- `FinalizationAttemptId` / `finalReviewRound` は plan finalization の各 iteration を区別する。初回は `tasks_pending → all_tasks_accepted` 遷移の前に **新しい `finalizationAttemptId`（新 UUID）と `finalReviewRound = 1` を発行**し、続く `all_tasks_accepted → final_review_pending` でも同じ identity を使う。`final_rework_required → final_review_pending` 遷移時には、**新しい `finalizationAttemptId`（新 UUID）および増分した `finalReviewRound` を両方発行・更新する**。
- Final Review の reviewer execution failure、transport failure、conclusive lost は review-only retry であり、`final_review_pending` を維持する。retry は同じ `finalizationAttemptId` と `finalReviewRound + 1` を持つ新しい final-review `ReviewCorrelation` の `null → pending` record で durable に表す。これは lifecycle transition でも finalization identity rotation でもない。
- Final Review の actual rework は `completed_with_findings` または current Final Gate の WARN / FAIL による `final_rework_required` を経由する。この場合だけ `final_rework_required → final_review_pending` transition record が fresh `finalizationAttemptId` と `finalReviewRound + 1` を保持する。
- lifecycle transition は `TaskLifecycleTransitionRecord` / `PlanFinalizationTransitionRecord` として durable observation/decision log に記録される。各 record は current `attemptId` / `finalizationAttemptId` と、review dispatch を所有する parent Controller session の `parentSessionId` を保持する。restart 後の Review candidate はこの durable な `parentSessionId` を使って `AuthorizationReviewBoundary` の同じ parent-session key を再構築し、child session や envelope の別の session ID から推測してはならない。
- durable log に書き込まれる `PersistedEnvelope`（persisted observation/decision record envelope）は、スコープに応じた実行コンテキストを必ず含む。task-scoped レコードでは `taskExecutionRef`（`authorizationId` / `taskId` / `attemptId`）を、plan-scoped レコードでは `{ authorizationId, finalizationAttemptId, finalReviewRound }` を含める。これにより restart / replay 時に当該 record がどの attempt と review round に属するかを再構築できる。
- 合法遷移表を定義し、重複イベント・無効遷移は idempotent に扱う。Plan finalization の初回経路は `tasks_pending → all_tasks_accepted → final_review_pending` とし、両方の record に同じ初回 finalization identity を保持する。同一 `TaskExecutionRef` + 同一 transition identity の重複のみ idempotent に無視する。transition identity には必要に応じて `eventId` を含め、replay 時の冪等性を保つ。許可されていない `accepted → pending` 遷移は無効として記録。
- restart / replay 時は event log を時系列で再投影する。projector は current attempt / current finalization attempt の証拠・レビューのみを Gate 評価に使用する。`all_tasks_accepted` の task 集合は、current checkbox ではなく **Approved Canonical Snapshot に含まれる task IDs** を SSOT とする。
- compaction / restart 後は `state-projection.ts` の拡張によりこれらを再構築する。
- Lifecycle、review dispatch、completion staging、artifact consumption、review observation、Gate、Acceptance は既存の append-only observation/decision log を durable store とする。`state-projection.ts` と `SessionStateProvider` はこの log から再構築する projection/cache であり SSOT ではない。
- Plan authorization だけは明示的な domain-state の例外として `.justice/authorizations.json` を durable store とする。このファイルには `ApprovedPlanBinding` のみを保存し、binding 内の `canonicalSnapshot` を authorization snapshot の唯一の durable copy とする。`AtomicPersistence` の失敗退避には `.justice/authorizations.conflict.json` を使用してよいが、これは書込み失敗時の候補だけを保持する非権威的な conflict journal である。hydrate、authorization 判定、canonical snapshot 復元は conflict journal を読んではならない。これ以外の専用 persistence file は作らない。

### 4.5 Review Artifact

```ts
export type ReviewWorkerResultV1 = {
  readonly schemaVersion: 1;
  readonly complete: boolean;
  readonly findings: ReadonlyArray<ReviewItem>;
};

export type ObservedReviewExecutionV1 = {
  readonly schemaVersion: 1;
  readonly provenance: "observed";
  readonly reviewExecutionEventId: string;
  readonly parentSessionId: string;
  readonly callId: string;
  readonly childSessionId: string;
  readonly correlation: ReviewCorrelation;
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

export type ReviewCorrelation = TaskReviewCorrelation | FinalReviewCorrelation;

export type ReviewSeverity = "critical" | "major" | "minor";

export type ReviewItem = {
  readonly itemKey: string;
  readonly evidenceId: string;
  readonly severity: ReviewSeverity;
  readonly summary: string;
  readonly location: string;
  readonly status: "open" | "resolved";
};

export type TaskReviewArtifactV1 = {
  readonly schemaVersion: 1;
  readonly reviewKind: "task-review";
  readonly reviewSource: "sp-review";
  readonly correlation: TaskReviewCorrelation;
  readonly observedExecution: ObservedReviewExecutionV1;
  readonly complete: boolean;
  readonly findings: ReadonlyArray<ReviewItem>;
};

export type FinalReviewArtifactV1 = {
  readonly schemaVersion: 1;
  readonly reviewKind: "final-review";
  readonly reviewSource: "sp-final-review";
  readonly correlation: FinalReviewCorrelation;
  readonly observedExecution: ObservedReviewExecutionV1;
  readonly complete: boolean;
  readonly findings: ReadonlyArray<ReviewItem>;
};

export type ReviewArtifactV1 = TaskReviewArtifactV1 | FinalReviewArtifactV1;

export type CleanReviewArtifactV1 = ReviewArtifactV1 & {
  readonly complete: true;
  readonly findings: readonly [];
};

export type ReviewArtifactWithFindingsV1 = ReviewArtifactV1 & {
  readonly complete: true;
  readonly findings: readonly [ReviewItem, ...ReviewItem[]];
};

export type IncompleteReviewArtifactV1 = ReviewArtifactV1 & {
  readonly complete: false;
};
```

- `sp-review` / `sp-final-review` worker の起動は Justice ではなく Controller (Atlas) が `task(category="sp-review" | "sp-final-review")` として行う。
- Justice は `ReviewPending` / `FinalReviewPending` 状態の提示と、review worker 実行結果の観測を行う。
- review worker と元 task / plan との correlation は内部的に `ReviewCorrelation` で保持する。`TaskReviewCorrelation` は `taskExecutionRef` を用いて review と実装 attempt を一対一に紐付ける。
- `ReviewWorkerResultV1` は review worker が生成する **untrusted reviewer output** である。Justice は `TaskCallBinding` 由来の trusted metadata、worker output、および独立して観測した `ObservedReviewExecutionV1` から `ReviewArtifactV1` を組み立てる。
- `ObservedReviewExecutionV1` は matching `PostToolUse` と child-session 上の review worker 実行観測の両方から Justice が生成する。`TaskCallBinding` や artifact path の一致だけでは代用できない。Task 3.3 の bounded runtime probe は `sp-review` と `sp-final-review` を各1回だけ実行し、runtime-provided な parent call ID と child session ID の相関がどちらか一方でも確立できなければ Phase 3 を BLOCKED とし、Task 3.4 へ進んではならない。その場合も Runtime は fail-open で継続するが、artifact path、prompt、category、worker self-report を fallback identity として使用せず、artifact / review を authoritative にせず、mandatory review completion と `AcceptanceDecision` を発行しない。この pre-Gate blocked state は runtime limitation の記録で解除してはならない。
- `ReviewArtifactV1` を mandatory review 完了の authoritative record とする。`CleanReviewArtifactV1`（`complete: true` かつ `findings: []`）だけを clean review の完了証拠とする。`ReviewArtifactWithFindingsV1` は review が完了して finding がある証拠であり rework へ、`IncompleteReviewArtifactV1` は review 未完了として blocked へ進める。
- CodeRabbit / Greptile 等の external review は `external_review_observed` 系（例：`.justice/reviews/external-*.jsonl` または `external_review_observed` event）として取り扱う。これは mandatory review の terminal record から導出する `review_observed` semantic とは別名であり、external review は `sp-review` / `sp-final-review` の完了証拠や mandatory completion 判定には使用しない。
- `ReviewArtifactV1` の Justice 到達経路（transport）は、Phase 3 では **B（JSON artifact file）に固定する**。reviewer が所定の JSON artifact file を書き、Justice が `TaskCallBinding` の trusted metadata と合わせて読み取る。typed PostToolUse payload は将来候補であり、P0 の transport abstraction、plugin mechanism、adapter、spike task は追加しない。
- Trust boundary: `reviewSource` / `reviewKind` / `correlation` などの envelope metadata は `TaskCallBinding` 由来の trusted 情報を使用し、reviewer 自己申告を権威付けしない。worker が供給してよいのは `ReviewWorkerResultV1.complete` と `ReviewWorkerResultV1.findings` のみである。`ObservedReviewExecutionV1` は review worker が実行されたことだけを証明し、finding の意味内容を検証するものではない。`ReviewArtifactV1` の組み立てと variant の runtime validation は Justice が行う。

### 4.6 Gate Verdict

```ts
export type GateScope = "task" | "plan";

export type GateTrigger =
  | { readonly scope: "task"; readonly on: "task_complete" | "tool_observed" }
  | { readonly scope: "plan"; readonly on: "final_review_complete" };

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
- durable compatibility: 既存の `schemaVersion: 1`、`recordType: "decision"`、`gateType: "task"`、`taskId`、verdict / enforcement / `ruleResults` を持ち、`taskExecutionRef` を持たない task Gate record は legacy persisted record として読み続ける。これは既存 producer が出力した監査・replay 互換 record であり、破壊的 migration、log rewrite、second event store、汎用 versioning / compatibility framework を導入しない。
- legacy task Gate record は attempt identity を持たないため、Semantic Control Plane の current authoritative `TaskGateDecision` ではない。既存 `ProjectedState.tasks` の `lastVerdict` 等の compatibility projection には従来どおり利用できるが、current Gate lookup、current attempt の Gate 完了、AcceptanceDecision の導出、lifecycle promotion には利用しない。new authoritative task Gate record は必ず `taskExecutionRef` を持つ。
- validator は `taskExecutionRef` property の不在だけを legacy branch として扱う。property が存在して有効なら new authoritative task Gate branch、存在するが不正なら reject とし、壊れた half-new record を legacy に fallback してはならない。plan Gate と task / plan Acceptance の validation は strict のまま維持する。
- task gate trigger は `task_complete` / `tool_observed` を維持するが、**lifecycle state = `gate_pending` になった場合のみ**評価する。
- plan gate trigger は `final_review_complete` とする。ただし発火条件は observed review execution provenance を持つ `CleanReviewArtifactV1`（`complete: true` かつ `findings: []`）、または `terminalReason: "completed"` の terminal outcome に限定する。`ReviewArtifactWithFindingsV1` / `terminalReason: "completed_with_findings"` は `final_rework_required` へ進み、Final Gate を起動しない。
- `PASS` のみ `TaskAccepted` / `PlanComplete` へ進める。
- task gate で `WARN` / `FAIL` の場合は `rework_required` へ進める。
- plan gate で `WARN` / `FAIL` の場合は `final_rework_required` へ進める。
- gate evaluation 不可・内部エラー・証拠不十分の場合は `gate_pending` / `final_gate_pending` のまま `accepted` / `complete` にしない。
- 内部障害を `rework_required` にしてはならない。"Justice が壊れたので実装コードを書き直せ" という誤った意味を与えるため。

### 4.7 Task Call Purpose

```ts
export type TaskCallPurpose = "implementation" | "task_review" | "final_review";

export type TaskCallBinding =
  | {
      readonly callId: string;
      readonly purpose: "implementation";
      readonly taskExecutionRef: TaskExecutionRef;
    }
  | {
      readonly callId: string;
      readonly purpose: "task_review";
      readonly correlation: TaskReviewCorrelation;
      readonly artifactReservation: ReviewArtifactReservation;
    }
  | {
      readonly callId: string;
      readonly purpose: "final_review";
      readonly correlation: FinalReviewCorrelation;
      readonly artifactReservation: ReviewArtifactReservation;
    };
```

- `task()` の PreToolUse 時に `callId` へ `TaskCallPurpose` を bind する。
- PostToolUse では purpose に応じて分岐する。
  - `implementation` → `WorkerReported` イベントを発行。
  - `task_review` / `final_review` → `ReviewWorkerResultV1` を抽出し、`TaskCallBinding` 由来の trusted metadata と合わせて `ReviewArtifactV1` を組み立て、`review_observed` イベントを発行。
- `sp-review` / `sp-final-review` として呼ばれた `task()` を、通常の implementation 完了と混同してはならない。
- `SessionStateProvider` は `callId → TaskCallBinding` の対応を管理する。`callId → taskId` だけを記録する実装は v4 で置き換える。
- `implementation` binding には `TaskExecutionRef` を含める。`task_review` binding は `TaskReviewCorrelation.taskExecutionRef` から current attempt を特定する。

### 4.8 Review Required Directive

```ts
export type ReviewRequiredDirective = {
  readonly kind: "review_required";
  readonly correlation: ReviewCorrelation;
};
```

`ReviewRequiredDirective` の review identity は `correlation` を唯一の SSOT とする。`reviewKind` は
`correlation.reviewKind` から導出し、task review の `taskId` / `attemptId` や final review の
`planPath` / `finalizationAttemptId` も correlation から参照する。Directive にこれらの重複
フィールドを持たせないことで、相互に矛盾する review identity を型上表現できないようにする。

- Justice が `ReviewPending` / `FinalReviewPending` に到達した場合、Controller (Atlas) へ `ReviewRequiredDirective` を inject する。task-review 時は `correlation.taskExecutionRef`、final-review 時は `correlation` に含まれる current finalization identity を使用する。
- Controller はこの directive を受けて `task(category="sp-review" | "sp-final-review")` を発行する。
- PreToolUse で review task の `callId` を `TaskCallPurpose` / `ReviewCorrelation` と相関付け、PostToolUse で `ReviewWorkerResultV1` を観測し `ReviewArtifactV1` を組み立てる。

#### 4.8.1 P0 Review Dispatch Binding Protocol

P0 では `ReviewDispatchId` を追加せず、同一 parent session 内の review dispatch を直列化する。
Justice は既存の durable lifecycle / decision log から復元可能な session-scoped trusted
pending slot を保持し、slot には Controller が提示した値ではなく Justice が発行した
`ReviewCorrelation` と期待する category / review kind を保持する。

以下を P0 の binding protocol とする。

```ts
export type ReviewDispatchState = "pending" | "claimed" | "terminal";

export type ReviewArtifactFailureReason =
  | "artifact_missing"
  | "artifact_read_failed"
  | "artifact_json_invalid"
  | "artifact_schema_invalid";

export type ReviewDispatchTerminalReason =
  | "completed"
  | "completed_with_findings"
  | "review_incomplete"
  | "review_execution_failed"
  | "lost_conclusive"
  | "cancelled"
  | "artifact_reservation_unusable"
  | ReviewArtifactFailureReason;

export type ReviewDispatchSlotKey = {
  readonly parentSessionId: string;
  readonly correlation: ReviewCorrelation;
};

export type ReviewArtifactConsumption = {
  readonly artifactId: string;
  readonly digest: string;
};

export type ReviewCompletionStaging = {
  readonly callId: string;
  readonly correlation: ReviewCorrelation;
  readonly artifactConsumption: ReviewArtifactConsumption;
  readonly reviewArtifact: ReviewArtifactV1;
  readonly observedExecution: ObservedReviewExecutionV1;
};

export type ReviewCompletionStagingRecord = {
  readonly recordType: "observation";
  readonly kind: "review_completion_staged";
  readonly parentSessionId: string;
  readonly staging: ReviewCompletionStaging;
};

export type ReviewPostToolUsePendingRecord = {
  readonly recordType: "observation";
  readonly kind: "review_post_tooluse_pending";
  readonly parentSessionId: string;
  readonly callId: string;
  readonly childSessionId: string;
  readonly purpose: "task_review" | "final_review";
  readonly trustedCorrelation: ReviewCorrelation;
  readonly observedExecution: ObservedReviewExecutionV1;
};

export type ReviewArtifactReadAttemptRecord = {
  readonly recordType: "observation";
  readonly kind: "review_artifact_read_started";
  readonly parentSessionId: string;
  readonly callId: string;
  readonly correlation: ReviewCorrelation;
  readonly artifactId: string;
  readonly artifactPath: string;
};

export type ReviewArtifactFailureStagingRecord = {
  readonly recordType: "observation";
  readonly kind: "review_artifact_failure_staged";
  readonly parentSessionId: string;
  readonly callId: string;
  readonly correlation: ReviewCorrelation;
  readonly terminalReason: ReviewArtifactFailureReason;
};

type ReviewDispatchTransitionBase = {
  readonly recordType: "observation";
  readonly kind: "review_dispatch_transition";
  readonly transitionId: string;
  readonly parentSessionId: string;
  readonly correlation: ReviewCorrelation;
  readonly expectedCategory: "sp-review" | "sp-final-review";
};

export type ReviewDispatchTransitionRecord =
  | (ReviewDispatchTransitionBase & {
      readonly from: null;
      readonly to: "pending";
    })
  | (ReviewDispatchTransitionBase & {
      readonly from: "pending";
      readonly to: "claimed";
      readonly callId: string;
      readonly artifactReservation: ReviewArtifactReservation;
    })
  | (ReviewDispatchTransitionBase & {
      readonly from: "claimed";
      readonly to: "terminal";
      readonly callId: string;
      readonly terminalReason: "completed";
      readonly artifactConsumption: ReviewArtifactConsumption;
      readonly reviewArtifact: CleanReviewArtifactV1;
    })
  | (ReviewDispatchTransitionBase & {
      readonly from: "claimed";
      readonly to: "terminal";
      readonly callId: string;
      readonly terminalReason: "completed_with_findings";
      readonly artifactConsumption: ReviewArtifactConsumption;
      readonly reviewArtifact: ReviewArtifactWithFindingsV1;
    })
  | (ReviewDispatchTransitionBase & {
      readonly from: "claimed";
      readonly to: "terminal";
      readonly callId: string;
      readonly terminalReason: "review_incomplete";
      readonly artifactConsumption: ReviewArtifactConsumption;
      readonly reviewArtifact: IncompleteReviewArtifactV1;
    })
  | (ReviewDispatchTransitionBase & {
      readonly from: "claimed";
      readonly to: "terminal";
      readonly callId: string;
      readonly terminalReason: Exclude<
        ReviewDispatchTerminalReason,
        "completed" | "completed_with_findings" | "review_incomplete"
      >;
    })
  | (ReviewDispatchTransitionBase & {
      readonly from: "pending";
      readonly to: "terminal";
      readonly terminalReason: "cancelled";
    });

export type ReviewDispatchSlot = {
  readonly key: ReviewDispatchSlotKey;
  readonly expectedCategory: "sp-review" | "sp-final-review";
  readonly state: ReviewDispatchState;
  readonly callId?: string;
  readonly artifactReservation?: ReviewArtifactReservation;
};
```

- `ReviewDispatchTransitionRecord` は `terminalReason` を判別子とする union であり、
  `completed` / `completed_with_findings` / `review_incomplete` の成功 variant だけが
  `artifactConsumption` と `reviewArtifact` を必須とする。`reviewArtifact.observedExecution`
  はその成功 artifact の必須 provenance である。`artifact_missing`、
  `artifact_read_failed`、`artifact_json_invalid`、`artifact_schema_invalid`、
  `artifact_reservation_unusable`、`review_execution_failed`、`lost_conclusive`、
  `cancelled` の failure variant は artifact を保持せず、`artifactConsumption`、
  `reviewArtifact`、`observedExecution` を要求しない。

- P0 では `ReviewDispatchId` を導入しない。slot の identity は `parentSessionId` と canonical な `ReviewCorrelation` の組み合わせであり、`transitionId` は個々の durable record の event identity に限る。
- `ReviewDispatchTransitionRecord`、`ReviewCompletionStagingRecord`、`ReviewArtifactFailureStagingRecord`、`ReviewArtifactReadAttemptRecord`、および `ReviewPostToolUsePendingRecord` は review dispatch state の durable SSOT である。`ReviewDispatchSlot`、`TaskCallBinding`、`ReviewArtifactReservation` は replay でこれらの record から再構築する projection であり、`SessionStateProvider` の in-memory cache を authoritative state として扱わない。`ReviewPostToolUsePendingRecord` は matching event の parent session、call、child-session、purpose、trusted correlation、`ObservedReviewExecutionV1` を保持し、binding 前の到着だけでなく terminalization 前の recovery marker としても使用する。recovery はこれらすべてを current slot / binding と照合し、一つでも不一致なら artifact read や terminalization を再開せず advisory に収束させる。artifact path と worker output は保持しない。`ReviewArtifactReadAttemptRecord` は trusted artifact identity と一回限りの read lease だけを保持し、artifact content は保持しない。`ReviewArtifactFailureStagingRecord` は artifact read / validation failure の terminalReason と trusted identity だけを保持し、artifact content は保持しない。`terminalReason: "completed"` は `artifactConsumption` と組み立て済み `CleanReviewArtifactV1` を必須とする。findings を持つ完了 review は `completed_with_findings`、未完了 result は `review_incomplete` とし、いずれも artifact を durable に保持して restart 後の rework / blocked 判定を再構築できるようにする。
- **terminal physical record** は `ReviewDispatchTransitionRecord { from: "claimed"; to: "terminal" }` 一件とする。既存 `ObservationLogStore.append()` の一回の physical append が atomicity boundary であり、generic transaction / appendBatch は導入しない。terminal reason に応じて、worker outcome (`completed` / `completed_with_findings` / `review_incomplete`) の variant は `parentSessionId`、`transitionId`、trusted `correlation`、`expectedCategory`、`callId`、`terminalReason`、`artifactConsumption { artifactId, digest }`、assembled `ReviewArtifactV1` を一体として保持し、`reviewArtifact.observedExecution` が observed execution provenance を保持する。一方、claimed からの operational failure / unusable / cancellation / artifact read-validation failure (`review_execution_failed` / `lost_conclusive` / `artifact_reservation_unusable` / `cancelled` / `ReviewArtifactFailureReason`) は artifactなしを許可し、pending からの `cancelled` tombstone も `callId`、`artifactConsumption`、`reviewArtifact` を持たない。
- `review_observed` は別 physical record ではない。terminal physical record の `reviewArtifact` から state projection が導出する review-observed semantic である。したがって replay は terminal record 一件から dispatch terminal state、artifact consumption、authoritative review、review summary を同じ順序で再構築し、`consumed=true / artifact missing` の partial state を表現しない。
- `null → pending` は directive 発行前、`pending → claimed` は PreToolUse の atomic claim、`claimed → terminal` は matching PostToolUse、conclusive な失敗、unusable reservation、または artifact の read / JSON parse / schema validation failure を staging-first で durable に収束させた後にだけ許可する。Authorization cancellation では `claimed → terminal` と `pending → terminal` の両方を `cancelled` tombstone として許可する。`terminal` record は変更・削除・再利用しない。
- retry は terminal slot を更新せず、新しい `ReviewCorrelation`（同一 Task attempt の場合は増分した `reviewRound`）で新しい `null → pending` record を発行する。
- **Authorization terminality guard**: review correlation から解決した `authorizationId` は、review dispatch、artifact completion、Gate、Acceptance の都度、authoritative `.justice/authorizations.json` で再確認する。task-review は `TaskExecutionRef.authorizationId`、final-review は `FinalReviewCorrelation.authorizationId` を使用する。対応する binding が `active` でなければ、または missing / unreadable / conflict-diverted などで状態が不確実なら、その correlation から新しい authoritative progress を生成してはならない。したがって pending directive の新規発行・再発行、claim、artifact consumption、clean completion、Gate invocation、`accepted` / `complete` decision、plan progress update を行わず、fail-open Runtime execution と blocked / stale advisory だけを返す。
- **Terminal authorization cancellation**: explicit cancel または fingerprint mismatch を含む invalidation が durable に terminal となった後、同じ authorizationId の current `pending` または `claimed` review slot があれば、既存 `ReviewDispatchTransitionRecord` の `terminalReason: "cancelled"` を用いて `terminal` tombstone を best-effort で append する。これは新しい cancellation subsystem ではなく Review Dispatch domain の既存 transition である。terminalization は parent-session serialization の中で latest durable projection を再確認し、既に terminal の slot には append しない。
- **Unusable reservation terminality**: `pending → claimed` の durable commit 後に `ReviewArtifactReservation.status === "unusable"` となった場合、worker input に artifact path を渡さず、`claimed → terminal` の `terminalReason: "artifact_reservation_unusable"` を同じ parent-session serialization 内で append する。これは ReviewArtifact、Gate、Acceptance、retryable failure を生成しない terminal tombstone であり、lifecycle は `review_pending` / `final_review_pending` のまま blocked とする。terminal append が失敗した場合は `claimed` と reservation を保持し、restart recovery が同じ transition を idempotent に再試行する。Authorization が先に terminal となった場合は `cancelled` tombstone を優先する。
- **Artifact read / validation failure terminality**: matching `PostToolUse` の current claimed slot と child binding を確認した後、まず `ReviewPostToolUsePendingRecord` を durable に記録し、次に一回限りの `ReviewArtifactReadAttemptRecord` を artifact I/O 前に durable に記録する。read-attempt record がある状態では artifact を再読しない。live read の結果は、ファイルがない場合 `artifact_missing`、読取 I/O が失敗した場合 `artifact_read_failed`、JSON parse が失敗した場合 `artifact_json_invalid`、`ReviewWorkerResultV1` の strict schema が一致しない場合 `artifact_schema_invalid` として分類する。分類結果は `ReviewArtifactFailureStagingRecord` に trusted identity とともに durable に記録してから、`artifactConsumption`、`reviewArtifact`、digest を持たない一件の `claimed → terminal` record として durable に記録する。プロセス停止後に read-attempt はあるが completion / failure staging がない場合は、読み取り済みかどうかを推測せず `artifact_read_failed` を failure staging として記録し、artifact を再読しない。成功した読み取りは `ReviewCompletionStagingRecord` を durable に記録してから、classification-matched artifact と `claimed → terminal` を含む composite terminal を append する。いずれも lifecycle は `review_pending` / `final_review_pending` のまま blocked とし、Gate、Acceptance、Progress、retry、review round の変更、同じ correlation の新 directive を生成しない。failure staging または terminalization append が失敗した場合は claimed slot と既存の durable marker を保持し、recovery は同じ staging / terminalization を再試行する。failure terminal または composite terminal が durable になった後は artifact を再読せず、同じ terminal を再appendしない。terminal 成功後の cleanup は matching reservation に対して best-effort / idempotent に行い、`artifact_missing` では artifactPath の削除を skip するが、identity validation を通過した matching leasePath の削除は実行する。cleanup 失敗は terminal authority を rollback せず、restart recovery が cleanup だけを再試行する。別 candidate の offer は許可するが、同じ artifact / correlation の再利用はしない。
- Authorization store と review observation log は別 store であるため、generic cross-store transaction / two-phase commit は導入しない。ただし両 domain は同じ `AuthorizationReviewBoundary.withParentSession` を共有し、Authorization の release / invalidation と、それに依存する review state change を同じ critical section に置く。順序は (1) boundary を取得、(2) Authorization の release / invalidation を atomic persistence で durable commit、(3) 成功後に review `cancelled` tombstone を append、(4) cancellation まで完了して boundary を解放する、である。tombstone append 失敗時にも Authorization terminal state を rollback せず、(5) recovery / directive / claim / completion / Gate は同じ boundary 内で durable Authorization terminality を再確認して authority を拒否し、(6) later recovery が欠落した tombstone の append を idempotent に再試行する。よって tombstone が一時的に欠落しても、terminal authorization の review を再発行・claim・受理しない。boundary 外の単純な再確認だけでは正の状態変更を許可しない。

review outcome から terminal record、lifecycle、retry identity への対応は次で一意に定める。ここで
`task` は task-review、`final` は final-review の対応する lifecycle を表す。`review_pending`
または `final_review_pending` を blocked のまま保持する場合、Acceptance の precondition は未成立であり、
`AcceptanceDecision` は発行しない。pre-Gate の blocked state は lifecycle、`ReviewDispatchSlot`、
`ReviewArtifactReservation`、terminal / recovery record、および advisory から再構築し、新しい blocked-state
record は追加しない。

| Review outcome              | terminalReason             | artifact subtype               | next lifecycle                                                                            | Gate invocation                                | retry/rework identity                                                                                                                                   |
| --------------------------- | -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| clean                       | `completed`                | `CleanReviewArtifactV1`        | `task: review_pending → gate_pending`; `final: final_review_pending → final_gate_pending` | current identity に対して実行する              | なし                                                                                                                                                    |
| complete with findings      | `completed_with_findings`  | `ReviewArtifactWithFindingsV1` | `task: rework_required`; `final: final_rework_required`                                   | 実行しない。既知の findings は Gate に委ねず、AcceptanceDecision も発行しない | `task`: 次の implementation で fresh `TaskExecutionRef` / `reviewRound = 1`; `final`: fixes 後に fresh `finalizationAttemptId` / `finalReviewRound + 1` |
| incomplete                  | `review_incomplete`        | `IncompleteReviewArtifactV1`   | 対応する `review_pending` を blocked のまま保持する                                       | 実行しない                                     | 自動 retry/rework なし                                                                                                                                  |
| unusable artifact reservation | `artifact_reservation_unusable` | なし                         | `review_pending` / `final_review_pending` を blocked のまま保持する。claimed slot は terminalize する | 実行しない                         | 自動 retry/rework なし。別 candidate だけを再評価する                                                                                                   |
| artifact missing            | `artifact_missing`         | なし                         | 対応する `review_pending` / `final_review_pending` を blocked のまま保持する。claimed slot は terminalize する | 実行しない                         | 自動 review retry / rework / round変更なし。terminal後にcleanupはno-op                                                                                     |
| artifact read failure       | `artifact_read_failed`     | なし                         | 対応する `review_pending` / `final_review_pending` を blocked のまま保持する。claimed slot は terminalize する | 実行しない                         | 自動 review retry / rework / round変更なし。terminal成功後のみcleanupを再試行する                                                                           |
| artifact JSON invalid       | `artifact_json_invalid`    | なし                         | 対応する `review_pending` / `final_review_pending` を blocked のまま保持する。claimed slot は terminalize する | 実行しない                         | 自動 review retry / rework / round変更なし。terminal成功後のみcleanupを再試行する                                                                           |
| artifact schema invalid     | `artifact_schema_invalid`  | なし                         | 対応する `review_pending` / `final_review_pending` を blocked のまま保持する。claimed slot は terminalize する | 実行しない                         | 自動 review retry / rework / round変更なし。terminal成功後のみcleanupを再試行する                                                                           |
| reviewer execution failure  | `review_execution_failed`  | なし                           | 対応する `review_pending` のまま新しい dispatch を待つ                                    | 実行しない                                     | `task`: 同じ `TaskExecutionRef` / `reviewRound + 1`; `final`: 同じ `finalizationAttemptId` / `finalReviewRound + 1`                                     |
| transport failure           | `review_execution_failed`  | なし                           | 対応する `review_pending` のまま新しい dispatch を待つ                                    | 実行しない                                     | `task`: 同じ `TaskExecutionRef` / `reviewRound + 1`; `final`: 同じ `finalizationAttemptId` / `finalReviewRound + 1`                                     |
| conclusive lost             | `lost_conclusive`          | なし                           | 対応する `review_pending` のまま新しい dispatch を待つ                                    | 実行しない                                     | `task`: 同じ `TaskExecutionRef` / `reviewRound + 1`; `final`: 同じ `finalizationAttemptId` / `finalReviewRound + 1`                                     |
| uncertain recovered claimed | terminal record を作らない | なし                           | `claimed` を保持し Acceptance の precondition を未成立にする                              | 実行しない                                     | 自動 redispatch/retry なし。restart だけでは round を変更しない                                                                                         |

`completed` だけが Gate 評価に進む。`completed_with_findings` は Gate を経由せず直接
rework を要求し、`review_incomplete`、`artifact_reservation_unusable`、および
artifact read / validation failure は Gate を呼ばず blocked を維持する。unusable reservation
または artifact failure の terminal tombstone は同じ correlation の再offerを
抑止するが、同じ parent session の別 candidate の評価は妨げない。
`completed_with_findings` の直接 rework は GateDecision や AcceptanceDecision を伴わない。
`TaskAcceptanceDecision { verdict: "rework-required" }` / `PlanAcceptanceDecision {
verdict: "rework-required" }` は、clean terminal が Gate の WARN / FAIL を受けた場合にだけ
発行する。したがって既知の review findings と Gate verdict は同じ `rework_required` 系
lifecycle でも別の downstream 契約として扱う。
この表で定めた review failure retry は implementation を再実行しない。implementation
rework だけが fresh `TaskExecutionRef` と `reviewRound = 1` を発行する。

1. 同一 parent session における、current durable `active` Authorization に対応する outstanding
   mandatory review dispatch は高々 1 件とする。outstanding には、directive 発行後で未 claim の
   `pending` と、claim 済みで matching `PostToolUse` を待つ `claimed` の両方を含める。terminal /
   missing / unreadable / conflict-diverted / otherwise uncertain Authorization に対応する
   `pending | claimed` slot は stale と分類し、outstanding cardinality から除外する。ただし stale
   slot は claim 可能な候補ではなく、同じ parent-session serialization 内で `cancelled` tombstone
   の append / retry だけを許可する。tombstone append が失敗して stale slot が一時的に残っても、
   新しい Authorization の reapproval による active slot の offer をブロックしない。
   将来のキュー項目に対する `pending` transition や directive を先行して作成してはならない。
   pending transition を永続化できない場合、mandatory directive は発行せず、Runtime は fail-open
   で継続する。この pre-Gate condition では Acceptance の precondition を未成立のまま保持し、
   `AcceptanceDecision` は発行しない。

   **Durable candidate derivation and queue order** は新しい persistent queue ではなく、最新の
   durable lifecycle record、Approved Canonical Snapshot、review-dispatch record、および
   Authorization binding を同じ `orderEventsForProjection()` 順で再投影して求める。task candidate は
   current lifecycle が `review_pending`、current `TaskExecutionRef` とその current review round を
   持ち、対応 Authorization が durable `active`、同じ parent session / correlation の dispatch slot が
   未作成、かつその current correlation に authoritative terminal result がないものに限る。Final
   Review candidate も、current lifecycle が `final_review_pending`、current finalization identity と
   current final review round を持ち、同じ active Authorization、slot 未作成、authoritative terminal
   result 未存在という同じ条件を満たすものに限る。old attempt、old finalization identity、old round、
   terminal Authorization、missing / unreadable / conflict-diverted Authorization、および malformed で
   current identity を一意に導出できない record は candidate ではない。

   candidate の total order は次で固定する。(a) `review_execution_failed` または `lost_conclusive`
   terminal から導出される current retry candidate を先に置き、複数あればその retry source terminal
   の `orderEventsForProjection()` 順、(b) それ以外の task / final candidate は current
   `review_pending` / `final_review_pending` lifecycle transition の同順で置く。この order は timestamp、
   shard identity、shard 内 sequence による既存 projection order であり、in-memory arrival order を
   authority にしない。したがって restart 前後で同じ candidate が選ばれ、review-only retry と
   unrelated `ReviewPending` の競合は retry 優先で一意に解決される。task candidate の Canonical
   Snapshot membership は、candidate の `authorizationId` に一致する durable `active`
   `ApprovedPlanBinding.canonicalSnapshot` だけを authority として検証する。global / session-agnostic
   snapshot cache は authority にせず、その snapshot にない task は candidate にしない。

   offer は parent-session serialization の内側で最新 durable state と Authorization を再読・再投影して
   行う。先に stale `pending | claimed` slot を分類し、各 stale Authorization の `cancelled` tombstone
   収束を best-effort で試行する。tombstone append が失敗しても stale slot は outstanding count から
   除外したままにする。active-authorized outstanding が 1 件なら candidate を追加せず、0 件なら上記の
   先頭 candidate だけについて `null → pending` を append し、append 成功後だけ directive を inject
   する。same parent に active-authorized `pending | claimed` が 2 件以上ある corruption は任意の slot を
   選ばない。new pending、claim、reservation、directive を作成せず、integrity advisory を記録して
   Acceptance の precondition を fail-closed にする。`AcceptanceDecision` は発行しない。

   current outstanding slot の durable terminalization 直後、および restart / replay で Authorization
   hydration、lifecycle / dispatch projection、staged-completion recovery、post-terminal outcome recovery
   が完了した直後に、同じ offer を再実行する。`completed`、`completed_with_findings`、
   `review_incomplete`、`cancelled` は terminal record 自体を再利用せず残る別 candidate だけを再評価する。
   `review_execution_failed` と `lost_conclusive` は上記 retry candidate を含めて再評価する。terminal,
   missing, or uncertain Authorization の candidate は offer しない。stale slot の cancellation tombstone
   append が失敗した場合も、後続 recovery はその tombstone を idempotently 再試行しながら、別の active
   Authorization の reapproval candidate を offer できる。

2. `task(category="sp-review")` は `task-review`、`task(category="sp-final-review")` は
   `final-review` の候補としてだけ扱う。category は identity や認証情報ではない。
   Controller が prompt / args に再提示した `correlation`、task ID、attempt ID、round は
   trusted data として使用しない。とくに PreToolUse input の `correlation` は slot selector、
   Authorization lookup、cancellation、binding、artifact reservation のいずれにも使用しない。
3. PreToolUse では、runtime が観測した parent session と期待 category で durable slot を
   再投影し、trusted correlation の Authorization が current `active` である pending slot のうち、
   同一 parent session かつ期待する review kind / category に一致するものが **ちょうど 1 件**ある
   場合に限り、その slot を原子的に claim する。stale Authorization の pending slot は claim せず、
   `cancelled` tombstone の収束だけを行う。Authorization lookup と cancellation は、選択済み slot の
   trusted correlation からだけ行う。
   claim と同じ critical section で、slot の trusted correlation を `callId` に紐付けた
   `TaskCallBinding` と `ReviewArtifactReservation` を生成し、`pending → claimed`
   transition と同一の durable commit に含める。この commit が成功するまで binding / reservation
   を authoritative として使用せず、成功後にのみ review worker の実行を開始する。
4. pending slot が 0 件、複数件、kind / category 不一致、または atomic claim に失敗した
   場合は review の `TaskCallBinding` と artifact reservation を作成しない。Runtime の
   `task()` 実行は fail-open で継続するが、mandatory review の completion と Acceptance の
   precondition は成立させず、`AcceptanceDecision` を発行しない。protocol violation / binding failure を advisory として記録する。claim
   失敗時は pending slot を消費せず、同じ slot の retry は durable state を再確認してから行う。
5. matching `PostToolUse` は、parent session、`callId`、purpose、trusted correlation、必要な
   child-session binding、`ObservedReviewExecutionV1` がすべて一致する場合だけ受理する。parent session と
   `callId` が current claimed slot に一致する event は、artifact I/O の前に
   `ReviewPostToolUsePendingRecord` として既存 observation log に一度だけ記録する。child-session binding
   がまだ durable でない場合は artifact を読まずに `awaiting_child_binding` として返し、binding append
   成功後、または restart recovery 時にこの pending record を再投影して同じ completion path を実行する。
   slot / parent / call identity が一致しない event は stale advisory のみとし、pending marker を作らない。
   binding が durable になった後、Justice は terminalization 前に
   `ReviewCompletionStagingRecord` として `ReviewCompletionStaging` を durable に記録する。artifact の consume marker、
   assembled `ReviewArtifactV1`、`claimed → terminal` transition を含む terminal physical record は同一の
   durable commit とし、projection が `review_observed` semantic を導出する前に Acceptance の入力へ結果を渡さない。最終 commit が失敗した場合は
   slot を `claimed` のまま保持して Acceptance の precondition を未成立にするが、staging 済みの同じ
   `callId`、correlation、artifact ID / digest を使う recovery finalization だけを許可する。新しい
   dispatch、worker output の再読、または重複した artifact consumption は行わない。
6. matching `PostToolUse` が review task の終端を確定した後に slot を terminal にする。
   Task review-only retry は同一 `TaskExecutionRef` と `reviewRound + 1`、Task implementation
   rework は fresh `TaskExecutionRef` と `reviewRound = 1` を使う。Final Review-only retry は
   同じ `finalizationAttemptId` と `finalReviewRound + 1` を使い、actual final rework は fresh
   `finalizationAttemptId` と `finalReviewRound + 1` を使う。

この protocol では、category は server-side pending slot を選択するための必要条件に
過ぎず、trusted identity は slot から `TaskCallBinding` へコピーされる correlation で
ある。並列 review dispatch を許可する場合は、将来、Controller 境界を越えて安全に運搬し
かつ server-side で検証できる専用 selector（例: `dispatchId` または capability）を別途
定義する。prompt の自然言語や worker の自己申告を selector としてはならない。

#### 4.8.2 Durable Restart / Replay Recovery

Review dispatch の状態遷移は write-ahead で既存の durable observation / decision log に
記録し、projector はその record を時系列に再投影する。`SessionStateProvider` やその他の
in-memory cache は再構築可能な cache に限り、restart 後の dispatch identity、claim、binding、
artifact reservation の SSOT にはしない。

| restart / replay 後の状態            | 許可される復旧動作                                                                                                                                                                                                                                                                                                                                                                                         | 禁止される動作                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pending`                            | durable Authorization が current `active` の場合に限り、同じ `ReviewCorrelation` の `ReviewRequiredDirective` を再発行する。`reviewRound` は増分しない。terminal / uncertain Authorization なら cancellation tombstone を収束させ、directive は発行しない。                                                                                                                                                | 新しい slot、binding、`callId`、review round を作る                                              |
| `claimed`（staging なし）            | durable record から同じ `callId`、trusted correlation、binding、artifact reservation を復元し、matching `PostToolUse` を待つ。                                                                                                                                                                                                                                                                             | directive の再発行、同じ correlation の再 claim、artifact の先読み                               |
| `claimed`（unusable reservation）    | worker input に path を渡さず、`artifact_reservation_unusable` terminal tombstone を同じ correlation へ一度だけ append する。append 失敗時は `claimed` と reservation を保持し、次回 recovery で同じ append を再試行する。Authorization が terminal / uncertain の場合は `cancelled` tombstone を収束させる。 | artifact read、ReviewArtifact / Gate / Acceptance、retry、directive、別 reservation を作る |
| `claimed`（artifact read attempt のみ） | `ReviewArtifactReadAttemptRecord` があるが completion / failure staging がない場合、artifact を再読せず `artifact_read_failed` の failure staging と terminalization へ収束させる。 | artifact の再読、ReviewArtifact / Gate / Acceptance、review retry、round変更、同じ correlation の再dispatchを行う |
| `claimed`（completion staging あり） | durable Authorization が current `active` の場合に限り、staging の `callId`、correlation、artifact ID / digest、assembled artifact を再検証し、同じ terminalization commit を idempotent に再試行する。成功時だけ `review_observed`、terminal transition、Acceptance 入力を反映する。terminal / uncertain Authorization なら staged result を昇格せず cancelled tombstone を収束させる。                   | 新しい dispatch / claim / artifact reservation、別 artifact の消費、worker output の再読・再生成 |
| `claimed`（artifact read / validation failure staging） | `ReviewArtifactFailureStagingRecord` の trusted identity と failure reason を再検証し、対応する no-artifact failure terminal を一件だけ再試行する。terminal成功後は reservation cleanup だけを best-effort / idempotent に行う。read-attempt marker がある限り artifact は再読しない。 | artifact の再読、ReviewArtifact / Gate / Acceptance、retry、round変更、同じ correlation の再dispatch |
| `terminal`                           | terminal physical record は不変の authority として保持する。retryable failure (`review_execution_failed` / `lost_conclusive`) は durable Authorization が current `active` の場合だけ、新しい correlation の `pending` slot を作る。`completed` / `completed_with_findings` / `review_incomplete` は terminal record を再appendせず、下記の post-terminal outcome application を idempotent に収束させる。 | terminal slot の変更・削除・再利用、同じ `callId` の再発行、terminal record の再append           |

- `claimed` with `artifactReservation.status === "unusable"` は不確実状態ではない。worker execution を fail-open で継続した後、`artifact_reservation_unusable` tombstone を一度だけ収束させ、同じ correlation を retry candidate にしない。terminal append が失敗した場合だけ `claimed` のまま保持して次回 recovery で再試行する。
- `claimed` の artifact read / validation failure は `artifact_missing`、`artifact_read_failed`、`artifact_json_invalid`、`artifact_schema_invalid` のいずれかへ分類し、failure staging を先に durable に記録してから非権威的な failure terminal として収束させる。failure terminal は `review_pending` / `final_review_pending` を blocked のまま保持し、Gate、Acceptance、retry、round変更を許可しない。read-attempt marker がある限り artifact は再読せず、staging または terminal append 失敗中だけ同じ claimed slot の durable transition を再試行し、durable terminal 後は cleanup のみを再試行する。
- `claimed` は restart や経過時間だけでは失われたと判定しない。runtime が終端失敗を確定的に観測した場合だけ `lost_conclusive` として terminalize し、その後に同一 Task attempt では増分した `reviewRound` の新しい pending slot を発行する。終端が不明な場合は `claimed` のまま保持し、mandatory review completion と Acceptance の precondition を未成立にする。`AcceptanceDecision` は発行しない。
- child-session binding より先に到着した matching `PostToolUse` は `ReviewPostToolUsePendingRecord` として durable に保持する。binding append 後または restart 時に current slot / call identity を再検証し、同じ completion を一度だけ再開する。binding が最後まで確立しない場合は artifact を読まず、pre-Gate blocked のままにする。
- restart / replay は retryable terminal と既存 `pending` slot だけを走査して完了としてはならない。outstanding
  slot がない parent session ごとに §4.8.1 の durable candidate derivation を実行し、dispatch record を
  まだ持たない current `ReviewPending` / `FinalReviewPending` candidate も lifecycle projection から再発見する。
  既存 `pending` / `claimed` が一件なら新たな slot を作らず、二件以上なら integrity advisory と
  Acceptance の precondition 未成立のまま停止する。`AcceptanceDecision` は発行しない。
- final-review の review-only retry では、projector は同じ `finalizationAttemptId` を持つ terminal failure record の後に append された pending slot の `ReviewCorrelation.finalReviewRound` を current round として復元する。old round の terminal review、GateDecision、AcceptanceDecision は current finalization correlation と一致しない stale record として扱い、Final Gate の入力に使用しない。
- `claimed` の復元後に artifact が存在していても、matching `PostToolUse`、durable read-attempt marker、および consume protocol が成立するまで読み取らない。read-attempt marker があるが completion / failure staging がない場合は `artifact_read_failed` へ収束させ、path を再読しない。completion staging がある場合は、staging 済みの artifact ID / digest と一致することだけを確認して finalization を再試行し、worker output を再読しない。consume marker が既にある場合は path を再読せず、terminal projection を authoritative とする。
- matching terminal physical record がある staging は、terminal record の `artifactConsumption` と staging
  identity が一致する場合だけ cleanup 対象である。recovery は artifact content を再読せず terminal を
  再appendせず、post-terminal outcome application の後に cleanup を best-effort / idempotent に再試行する。
  `cancelled` tombstone の場合も、同じ staging / reservation identity を持つ場合だけ tombstone の durable
  success 後に cleanup する。tombstone append が失敗した場合は cleanup せず staging と artifact を保持する。
  cleanup failure は immutable terminal、Gate、Acceptance を rollback しない。
- `callId`、parent session、purpose、trusted correlation、child-session binding のいずれかが current claimed slot と一致しない `PostToolUse` は stale event として advisory のみを記録する。artifact を消費せず、`ReviewArtifactV1`、Gate、Acceptance、current review round に影響させない。
- log の読み込み・投影・復元に失敗した場合、Runtime は fail-open で継続するが、未復元の binding や review completion を authoritative とせず、Acceptance / Plan completion の precondition を未成立にする。この pre-Gate condition で `AcceptanceDecision` は発行しない。
- completion staging が durable でも Authorization terminality が優先する。terminal Authorization を検出した recovery / completion は staged artifact を `accepted` / `complete` に昇格せず、対応 slot を `cancelled` として閉じる。staging artifact の cleanup は terminal tombstone の durable success 後に限る best-effort / idempotent operation とし、reapproval の新しい authorizationId へ移植しない。
- **Post-terminal outcome application**: matching terminal physical record が既に durable であっても、対応する downstream lifecycle outcome が durable / projected でなければ、recovery は terminal record を再appendせず outcome mapping だけを同一 parent-session operation で再開する。`completed` は durable current `active` Authorization の場合だけ task を `review_pending → gate_pending`、final を `final_review_pending → final_gate_pending` へ一度だけ遷移させ、current identity の既存 Gate path を再開する。`completed_with_findings` は Gate を呼ばず、`rework_required` または `final_rework_required` が未成立の場合だけ一度だけ成立させる。`review_incomplete` と artifact read / validation failure は blocked が正規状態であり、lifecycle、Gate、rework、retry の追加 mutation を行わない。terminal / missing / uncertain Authorization はこの mapping より優先し、terminal review record を保持したまま Gate、Acceptance、Progress、positive lifecycle transition を生成しない。
- post-terminal outcome application は繰り返し実行可能でなければならない。既存の current lifecycle、current review identity、current GateDecision、current AcceptanceDecision を durable projection で確認し、duplicate lifecycle transition、GateDecision、AcceptanceDecision を authority として append してはならない。lifecycle transition 後かつ Gate 処理前の crash では、同じ recovery が current `gate_pending` / `final_gate_pending` に対する未完了の既存 Gate path だけを再開する。
- 同一 decision identity の Gate / Acceptance recovery は、task では `authorizationId` / `taskId` / `attemptId`、plan では `authorizationId` / `planPath` / `finalizationAttemptId` / `finalReviewRound` ごとの decision key を確認しつつ、Authorization と共有する parent-session `AuthorizationReviewBoundary` 内で実行する。この boundary は latest durable records read、lifecycle / Authorization revalidation、Gate / Acceptance lookup、Gate evaluation、GateDecision append、durable re-read、Acceptance derivation / append、downstream lifecycle application を一続きに直列化する。in-memory queue は restart authority ではなく、authority は常に durable records にある。
- review completion、staged-completion recovery、post-terminal outcome recovery はすでに parent-session boundary を保持している。その Gate 進行は parent boundary を取得しない within-boundary evaluator を使い、decision-identity serialization だけを追加で取得する。外部からの Gate request は public evaluator を通じて parent boundary を取得する。この二経路は同じ decision implementation と durable checks を使うが、互いを再入しない。
- serialization boundary は generic mutex / idempotency framework として抽象化しない。異なる decision identity を不要に global serialization せず、同一 identity の public Gate evaluation と Gate-phase blocked Acceptance append の全経路で共有する。restart 後は queue を復元せず durable records を再読して idempotency を再構築する。

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
- `DelegatedExecutionBinding` は、PreToolUse の claim commit には含めない。runtime が current claimed slot の `parentCallId -> childSessionId` relation を観測した後、trusted correlation から解決した `ExecutionScope` とともに append-only log へ durable に記録する。relation の未観測、unknown parent call、または stale child relation は binding を作成せず advisory とする。matching PostToolUse が binding より先に到着した場合は、current parent / call identity だけを `ReviewPostToolUsePendingRecord` として durable に保持し、artifact を読まず、binding append 後または restart 時に再処理する。current binding が durable になるまで authoritative completion として受理しない。
- `DelegatedExecutionBinding` により、子セッションの `message.updated` / `chat.params` / tool observation を親の task attempt (`ExecutionScope` の `kind: "task"`) または plan finalization attempt (`ExecutionScope` の `kind: "finalization"`) に還元できる。これは JUS-P0-04 の P0 設計要件である。

### 4.10 Review Artifact Reservation

```ts
export type ReviewArtifactReservationFailureReason =
  | "artifact_path_collision_exhausted"
  | "artifact_storage_unavailable"
  | "artifact_path_invalid"
  | "reservation_internal_error";

export type ReviewArtifactReservation =
  | {
      readonly status: "usable";
      readonly artifactId: string;
      readonly artifactPath: string;
      readonly leasePath: string;
      readonly artifactIdentity: ReviewArtifactInodeIdentity;
    }
  | {
      readonly status: "unusable";
      readonly reason: ReviewArtifactReservationFailureReason;
    };

export type ReviewArtifactInodeIdentity = {
  // String fields keep platform-specific device/inode values JSON-safe.
  readonly device: string;
  readonly inode: string;
};

// This is intentionally a review-artifact-only runtime boundary. It is not
// added to the general FileReader or FileWriter contracts.
export type ReservedReviewArtifactIo = {
  readonly writeExisting: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
    content: string,
  ) => Promise<void>;
  readonly readOnce: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ) => Promise<string>;
  readonly cleanup: (
    reservation: Extract<ReviewArtifactReservation, { readonly status: "usable" }>,
  ) => Promise<"cleaned" | "replacement_retained">;
};
```

- `ReviewArtifactReservation` は **review worker の `task()` PreToolUse 時に生成される**。`callId` は Controller が `task()` を呼び出して PreToolUse に入った後に確定するため、ReviewPending 段階では `callId` を知らない。したがって、ReviewPending 時点では correlation だけを持つ `ReviewRequiredDirective` を Controller へ発行し、PreToolUse で `callId` を確定させたうえで `TaskCallBinding` と `ReviewArtifactReservation` を生成・bind する。
- `artifact_path_collision_exhausted` は候補 path の衝突を上限回数まで回避できなかった場合に使用する。`artifact_storage_unavailable` は review directory 作成、exclusive marker 作成、その他の保存先 I/O が利用できない場合に使用し、`artifact_path_invalid` は安全な相対 path として検証できない場合に使用する。上記に分類できない reservation 生成障害は `reservation_internal_error` として記録する。
- P0 の最大 reservation 再生成回数は設定項目でも公開 API でもない有限の実装定数とする。
  具体値は Plan Task 3.4 の `MAX_ARTIFACT_RESERVATION_ATTEMPTS = 3` に固定し、変更時は
  設計書と同時に review する。
- `callId` / `correlation` の SSOT は `TaskCallBinding` とする。`ReviewArtifactReservation` 自身は artifact identity / path / private lease のみを表現し、重複する review metadata は持たない。
- mandatory `sp-review` / `sp-final-review` は **synchronous execution（`run_in_background = false`）に固定する**。background 実行時には PostToolUse 後の artifact 読み取り契約が成立しないため、これらの mandatory review worker は synchronous 実行を必須とする。これは execution semantics の制約であり、Justice が model / agent を選択することとは無関係である。
- **Anti-replay / integrity 契約**: review artifact の生成・消費は以下の strict プロトコルに従う。
- Justice が PreToolUse 時点で `artifactId` と `artifactPath` を生成し、`ReviewArtifactReservation` を組み立てる。
- `artifactPath` は Justice が `ReviewArtifactReservation` ごとに一意な安全な相対 path として生成する。binding identity は `TaskCallBinding` が保持し、path 自体に `callId` / `correlation` を埋め込むことは必須としない。例：`.justice/reviews/<artifactId>.json`。
- reservation port の `createExclusiveMarker(artifactPath)` は、同じ review directory 内の一意な temporary marker を作成し、既存の `FileWriter.link`（宛先が存在する場合は `EEXIST` で atomic failure）で `artifactPath` に排他的に install する。成功結果は `created`、既存ファイル・symlink を含む占有結果は `occupied` とし、`fileExists` → `writeFile` の check-then-use や非排他的な上書きへの fallback は実装しない。temporary marker は成功・衝突のいずれでも best-effort で削除する。
- `createExclusiveMarker` の成功時は、作成した artifact inode の `device` / `inode` を fstat で取得し、worker に提示しない private `leasePath`（例：`.justice/reviews/.leases/<artifactId>.lease`）を同じ inode への hard link として保持する。identity取得、lease作成、no-follow検証のいずれかができない場合は `usable` を返さない。lease は terminal cleanup まで保持し、restart 後も reservation の identity と lease path を SSOT とする。
- runtime は予約作成と同時に review-artifact 専用の `ReservedReviewArtifactIo` を提供する。これは一般の `FileReader` / `FileWriter` を拡張しない narrow capability であり、`writeExisting`、`readOnce`、`cleanup` はいずれも path 単体ではなく trusted reservation 全体（`artifactPath`、`leasePath`、`artifactIdentity`）を受け取る。予約作成だけを提供し、この三操作のいずれかを安全に提供できない runtime は reservation を `unusable` とする。
- worker の書込みを runtime が媒介する場合、`writeExisting` は既存の予約済み leaf を `O_NOFOLLOW` / descriptor-relative open 相当で開き、artifact descriptor と private lease descriptor の identity が durable reservation と一致する場合だけ truncate/write する。rename、unlink 後の再作成、symlink 経由の書込みは許可しない。worker が通常の filesystem tool で path を書き換えた内容は、それ自体では trusted authority ではない。Justice は必ず後述の `readOnce` 検証を通った bytes だけを artifact として受理する。
- Justice の読み取りは pathname の再解決後に通常の `readFile` を呼ばない。`readOnce` は review directory を no-follow で開き、artifactPath と private leasePath を開いた file descriptor の `device` / `inode` と durable reservation の identity が三者一致することを検証してから、検証済み artifact descriptor から一度だけ読む。missing、symlink、差し替え、identity不一致は `artifact_read_failed` として扱い、artifactを権威付けしない。
- `resolveSafely()` / `resolveSafelyForWrite()` で canonical な絶対パスを得てから `O_NOFOLLOW` 付きの pathname 操作を行う実装は、ancestor を検証後に差し替えられるため descriptor-relative open 相当とはみなさない。これらの汎用 path helper は review-artifact の read / write / cleanup の安全性を満たす根拠にしてはならない。
- runtime は review-artifact capability を、予約作成・identity取得・private lease・`writeExisting`・`readOnce`・`cleanup` の全てを descriptor-relative または同等の原子的な native primitive で提供できる場合にだけ公開する。現在の `NodeFileSystem` の path-only な公開 Node filesystem API がこの capability を提供できない場合、`createExclusiveMarker` と `ReservedReviewArtifactIo` は公開せず、reservation port は `artifact_storage_unavailable` の `unusable` reservation を返す。worker には artifact path を渡さず、通常の plugin 処理は fail-open で継続する。この runtime 制約は P0 completion criterion の免除ではない。
- `cleanup` は artifact path を削除する直前まで identity を確認する。runtime が確認済み directory entry と削除を原子的に結び付けられない場合は、artifact path と private lease のいずれも削除せず `replacement_retained` を返して advisory を記録する。この fail-closed retention は replacement を誤削除する check-then-unlink より優先する。runtime が原子的な identity-verified deletion を提供する場合に限り、private lease は元の inode を保持したまま best-effort で削除してよい。cleanup failure または retention は terminal、Gate、Acceptance authority を rollback しない。
- dispatch 前にこの exclusive marker 作成を行う。`occupied` の場合、その artifact は権威付けしてはならない。Justice は新しい `artifactId` / `artifactPath` を生成し、未使用の安全な path が得られるまで最大 3 回試行する。衝突を観測した時点で `review_unexpected_existing_artifact` advisory を記録する。marker 作成の path validation は create 操作と同じ safe-relative-path boundary で行い、symlink 経由の destination を許可しない。
- 安全な `artifactPath` を確立できない場合、`ReviewArtifactReservation` を `unusable` 扱いとして claimed durable record に保持する。Runtime 実行は fail-open とする（`task()` 呼び出しを継続させる）が、mandatory review completion は成立させず、`TaskAcceptanceDecision` / `PlanAcceptanceDecision` の precondition を未成立にする。ここでの「Acceptance blocked」は `AcceptanceDecision { verdict: "blocked" }` の発行を意味しない。`unusable` reservation は worker input に `artifactPath` を提示せず、PostToolUse でも filesystem read、ReviewArtifact 組み立て、terminal clean completion、Gate PASS、Acceptance、`AcceptanceDecision` の発行を行わない。
- `createExclusiveMarker` は全 `FileWriter` に要求する共通操作ではなく、runtime-boundary の optional capability とする。runtime が exclusive create、inode identity、private lease、および `ReservedReviewArtifactIo` の全操作を完全に提供できない場合、reservation port は `fileExists` → `writeFile` 等の fallback を試みず、`artifact_storage_unavailable` の `unusable` reservation を返す。
  - `ReviewArtifactReservation` を `TaskCallBinding`（`task_review` / `final_review`）の `artifactReservation` フィールドへ bind する。
- `usable` の場合、`claimReviewDispatch` の committed outcome に含まれる
  `TaskCallBinding.artifactReservation.artifactPath` を、その claim outcome から task-payload
  hook / adapter へ引き渡す。hook / adapter は別の path を再生成・再解決せず、同じ
  `artifactPath` を Controller の prompt / injected directive と wire payload に提示する。
  review worker はその path へ `ReviewWorkerResultV1` を JSON として書き出す。`unusable` の
  場合は `artifactPath` を提示せず、review worker の完了を mandatory review completion
  として扱わない。
- Justice は matching PostToolUse 到達後、`usable` な `TaskCallBinding.artifactReservation` に基づき、まず `ReviewArtifactReadAttemptRecord` を artifact I/O 前に一件だけ durable に記録し、その read lease に対して `artifactPath` を **一度だけ** 読み取る。既存の read-attempt record がある場合は path を再読しない。プロセス停止後に read-attempt はあるが completion / failure staging がない場合は、読み取り済みかどうかを推測せず `artifact_read_failed` として failure staging を作成し、artifact を再読しない。これにより crash 後の file mutation による別 digest の生成を許可しない。読み取り結果は strict schema validation を通し、reservation 単位の atomic consume operation として扱う。`unusable` の場合は artifact を読み取らず、mandatory review completion を成立させない。
  - 成功した読み取りは、まず `ReviewCompletionStagingRecord` に digest、`artifactId`、組み立て済み `ReviewArtifactV1`、および observed execution を durable に記録し、その後 `claimed → terminal` transition、consume marker、同じ artifact payload を一件の terminal physical record に記録する。read-attempt から completion staging または failure staging までの間に crash しても、recovery は再読せず、未確定 read を `artifact_read_failed` として failure staging-first protocol へ収束させる。commit 前に `ReviewArtifactV1` を Acceptance の入力へ渡さず、commit 失敗時は slot と staging を保持する。
  - 読み取り失敗は `ReviewArtifactFailureStagingRecord` を先に durable に記録してから、artifact payload を持たない `claimed → terminal` transition を一件だけ append する。failure staging または terminal append が失敗した場合は同じ durable marker を recovery で再試行し、read-attempt がある限り artifact を再読しない。terminal 成功後、元ファイルを archive / move または delete する。cleanup は matching durable terminal
    (`completed`、`completed_with_findings`、`review_incomplete`、artifact failure、または staged reservation と一致する
    `cancelled`) の成功後だけ実行する。cleanup 前の crash または cleanup failure は restart recovery が
    terminal / staging / reservation から再発見して best-effort / idempotent に再試行し、terminal、Gate、Acceptance authority を rollback しない。
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

export type AcceptanceDecision = TaskAcceptanceDecision | PlanAcceptanceDecision;
```

- `AcceptanceDecision` は Gate 評価結果に基づき Justice が発行する decision record である。terminal review record が durable かつ projected で、`review_pending → gate_pending` または `final_review_pending → final_gate_pending` が durable / projected になった後だけ Gate を評価する。`completed_with_findings` の直接 rework、unusable reservation、DelegatedExecutionBinding 未確立、uncertain claimed state、review_incomplete、artifact completion 未成立、terminal Authorization、review failure retry 待ちなどの pre-Gate blocked condition では `AcceptanceDecision` を発行しない。
- task acceptance decision は current `TaskExecutionRef` に bind される。plan acceptance decision は current finalization attempt（`authorizationId` / `planPath` / `finalizationAttemptId` / `finalReviewRound`）に bind される。
- `accepted` / `complete` は current GateDecision の `PASS` 時のみ発行する。`rework-required` は clean terminal review に対する current GateDecision の `WARN` / `FAIL` 時にだけ発行する。`completed_with_findings` は Gate を呼ばず lifecycle を直接 `rework_required` / `final_rework_required` へ進め、AcceptanceDecision を発行しない。`blocked` は clean terminal review と `gate_pending` / `final_gate_pending` が durable / projected で、Gate evaluation を開始した後に GateDecision を安全に生成できない evaluation failure、内部エラー、証拠不十分時だけ発行する。この Gate-phase blocked case でも lifecycle は `gate_pending` / `final_gate_pending` のままにする。
- `AcceptanceDecision` は durable decision log に書き込まれ、`TaskLifecycleTransitionRecord` / `PlanFinalizationTransitionRecord` と共に restart / replay 時の状態再構築に使用される。
- Gate evaluation の直前と GateDecision から AcceptanceDecision を append する直前に、decision correlation の authorizationId が current durable `active` binding であることを確認する。terminal / missing / uncertain Authorization では Gate を authoritative に実行せず、`accepted` / `complete` を append しない。既存 lifecycle は `gate_pending` / `final_gate_pending` のまま blocked / stale advisory とする。replay で発見した旧 terminal Authorization の GateDecision / AcceptanceDecision は current authority に使用しない。
- public Gate entry は concurrent release / invalidation と同一 parent key で直列化する。すでに parent boundary を保持する completion/recovery entry は public Gate entry を再呼出しせず、within-boundary evaluator を使用する。どちらの経路も同じ decision identity queue に入り、clean Task Review と Final Review の Gate / Acceptance は各 current identity につき最大一件である。

---

## 5. 要件別設計詳細

### 5.1 JUS-P0-01 Controller Routing

```text
workflow 起動 (command / skill 検出)
  → WorkflowRouter.resolveController(workflow)
  → routing-decision.ts: createControllerRoutingDecision(workflow_rule)
  → controller-routing.ts:
      applicationMethod === "none" かつ message.updated が観測済み
        → unapplied (reason: application_not_configured, observationSource: message.updated | both)
      applicationMethod === "none" かつ message.updated が未観測
        → unapplied (reason: application_not_configured, observationSource: none)
      applicationMethod === "runtime-api" かつ runtime capability unavailable
        → unsupported (reason: runtime_capability_unsupported)
      applicationMethod === "pinned-command"
        → configured method として actual を観測
      applicationMethod === "runtime-api" かつ runtime capability available
        → runtime-api で適用後、actual を観測
      上記の configured method で message.updated が観測された場合:
        actual === desired → applied
        actual !== desired → mismatch
      configured method で message.updated が観測されない場合
        → unapplied (reason: actual_not_observed, observationSource: none)
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
      canonicalSnapshot,
      fingerprintSchema: "justice-plan-v1",
      approvedAt, status: "active"
    }
  → AtomicPersistence 経由で .justice/authorizations.json へ保存
      → 保存成功 → active
      → conflict_diverted / exception → binding uncertain → 権限なし

approval result / cache semantics:
  - `saveAtomicWithLock(...)` の `status: "saved"` は merge 後の配列が durable に保存されたことだけを表す。
    version-mismatch retry 後に fresh `authorizationId` が active であることとは同義ではない。
  - 保存成功後、同じ `AuthorizationReviewBoundary` を保持したまま authoritative array を再読する。
    own fresh ID が current active である場合だけ `approve()` はその binding を返し、PlanBridge は
    requested plan を `armed: true` として active-plan cache へ publish できる。
  - own fresh ID が `invalidated` / `released` の場合は merge loser である。latest durable active binding
    が別 plan に存在しても、requested plan の `approve()` は `null`、PlanBridge は `armed: false` とする。
    cache は latest durable active binding（なければ clear）へ reconcile するが、requested loser plan は publish しない。
  - post-save authoritative reread が失敗した場合は `null` / `armed: false` とし、fresh candidate を
    positive authority にしない。stale positive cache は clear し、cache を fresh candidate で置換しない。
  - `conflict_diverted` / exception は `null` / `armed: false` とし、candidate を cache authority にしない。
    save が成立していないため、既存 cache は勝手に置換しない。

PlanBridge approval path:
  - cache owner は PlanBridge であり、AuthorizationStore は PlanBridge を直接所有・生成しない。
  - PlanBridge は shared boundary 内で `approveWithinAuthorizationReviewBoundary` を呼ぶ。callback は
    §4.2 の行列に従い、save 成功後の authoritative outcome を cache へ反映する。post-save reread
    failure では `null` を受け取り、stale positive cache を clear する。initial read failure、save
    exception、`conflict_diverted` では callback を受け取らず、existing cache を変更しない。
  - own fresh ID が winner の場合、callback が渡す binding と `approve()` の positive result は同じ
    durable record でなければならない。loser の callback は winner / `null` の cache reconciliation
    に限られ、`approve()` の戻り値を positive に変更しない。
  - callback が winner binding を受け取っても、`approve()` の return が `null` なら requested call は
    arm しない。これは winner の cache reconciliation と requested approval の成功を分離するためである。

  callback matrix:

  | outcome | save | `reconcileActivePlan` | `approve()` | cache / arm behavior |
  | --- | --- | --- | --- | --- |
  | initial authoritative read failure | save しない | 呼ばない | `null` | existing cache を変更せず、arm しない |
  | save exception / `conflict_diverted` | authoritative success ではない | 呼ばない | `null` | requested candidate を publish せず、existing cache を変更しない |
  | save 成功 + post-save reread 成功 + own fresh ID が winner | saved | active own binding を渡す | 同じ active binding | requested approval は arm してよい |
  | save 成功 + post-save reread 成功 + own fresh ID が loser | saved | latest durable active winner、なければ `null` を渡す | `null` | requested loser plan を publish / arm しない |
  | save 成功 + post-save reread 失敗 | saved | `null` を渡す | `null` | stale positive cache を clear し、requested plan を arm しない |

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
  - `AtomicPersistence.merge(mine, theirs)` の `mine` は現在保存を再試行する candidate、
    `theirs` は最新 durable array とする。domain merge はまず authorizationId ごとに terminal
    dominance を適用し、terminal binding を active に戻さない。
- same-ID の terminal dominance 適用後に残る同一 session の active binding は、`mine` と
  `theirs` のどちらに由来するかに関係なく、すべて superseding approval candidate として
  比較する。`mine` にだけ存在する fresh active candidate を暗黙に優先してはならない。
- 同一 session の active candidate が複数ある場合は、`approvedAt` の降順、同値では
  `authorizationId` の昇順で一件を winner とし、残りを `invalidated` /
  `invalidationReason = "plan_superseded"` へ変換する。通常の approve path は fresh candidate
  を一件だけ生成するが、version mismatch retry では両 merge 側の active candidate を同じ規則で
  比較する。
- 異なる session の binding は変更せず保持する。merge result は session ごとに active
  binding を高々一件にする。version mismatch 後に save へ成功した呼び出し元の candidate が
  active になるとは限らず、winner は常に上記の deterministic rule から得られる。caller は
  authoritative reread で own fresh ID の状態を確認してから return / armed / cache を決める。

authorization cardinality:
  - 同一 session に active な `ApprovedPlanBinding` は高々 1 つまでとする（at most one active binding per session）。
  - 新しい plan を approve する際、同一 session に既存 active binding が存在する場合は、同じ authoritative `AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>` save で既存 binding を `invalidated`（`invalidationReason = "plan_superseded"`）とし、新しい `authorizationId` を発行する。save が失敗または `conflict_diverted` の場合、new binding と active-plan cache を authority に昇格してはならない。
- version mismatch で retry するときも authorization domain merge は同じ cardinality rule を適用する。したがって concurrent fresh-ID approval の最終 durable state では同一 session の active binding は高々一件であり、cache は `saved` になった merged durable state からだけ更新する。
- cache の値は `saved` status や caller の candidate から直接導出せず、post-save authoritative reread で
  確認した merged durable state の active binding からだけ導出する。own fresh ID が loser の場合は
  requested plan を armed / active として返さず、winner または `null` に reconcile する。
  - 明示的な cancel を要求して新規承認をブロックする挙動は P0 では採用しない。

restart / hydration:
  - plugin startup / session hydration は authoritative `.justice/authorizations.json` の active binding ごとに既存の `PlanBridge.readPlanFile(planPath)` を使って plan を probe する。`readPlanFile(...) === null` は `fileExists(planPath) === false` による confirmed missing だけを表し、probe throw は missing と断定しない I/O uncertainty である。
  - `AuthorizationStore.hydrate()` の read / parse / validation failure は startup restoration を `uncertain` とする。空の hydrated result を「active binding がない authoritative state」と解釈して positive recovery を開始してはならない。
  - plan が存在する active binding は、cache restore 前に Task 2.1 の canonical `computePlanFingerprint(planContent, binding.canonicalSnapshot.tasks.map((task) => task.taskId))` を使用して current semantic fingerprint を計算する。approval 時の task set を `PlanParser.parse(planContent)` から取り直してはならない。approved task section 内の execution-progress checkbox state と EOL だけは同じ canonicalization により fingerprint 不変であり、task definition、requirement、strategy、acceptance criteria、global semantic content の変更は mismatch とする。content digest 単独、別 algorithm、missing-plan sentinel は導入しない。
  - current fingerprint の計算が read 後の canonicalization、parser、approved-task mapping、または fingerprint calculation で失敗した場合は mismatch と断定して irreversible mutation を行わない。その binding の restoration outcome を `uncertain` とし、active-plan cache、Review directive reissue / offer / claim、staged completion の Gate / Acceptance promotion に使用しない。plugin、Wisdom、Telemetry、projection initialization は fail-open で継続する。
  - fingerprint を計算できた場合は shared `AuthorizationReviewBoundary.withParentSession(sessionId)` の内側で `invalidateForFingerprintWithinAuthorizationReviewBoundary(sessionId, authorizationId, currentFingerprint, at)` を使用する。`fingerprint_current` の場合だけ exact `authorizationId` を authoritative に再読し、same parent かつ still active であることを確認して active-plan cache を復元する。fingerprint 不一致を復元後に確認する contract は採用しない。
  - fingerprint mismatch の mutation が `saved` の場合、同じ boundary を保持して Review cancellation attempt を行い、active-plan cache を clear してから boundary を release する。最終 runtime の順序は `boundary-enter → current-fingerprint-computed → authorization-invalidated-durable → review-cancelled-tombstone-attempt → active-plan-cache-clear → boundary-release` とする。missing-plan 専用 mutation や public invalidation wrapper を parent boundary 内から流用してはならない。
  - fingerprint invalidation の `not_found` / `wrong_parent` / `already_terminal` は、exact authoritative reread で latest durable state を尊重する。stale hydrated copy を active cache に戻さず、terminal binding を positive recovery に使用しない。`failed` / `uncertain` / conflict-diverted / unexpected persistence failure は cache restore も positive recovery も行わず、restoration outcome を `uncertain` とする。`saved` terminal binding は authoritative だが stale Authorization を positive recovery に渡さない。
  - confirmed missing の active binding は同じ parent boundary の内側で `invalidateMissingPlanWithinAuthorizationReviewBoundary(sessionId, authorizationId, at)` を呼ぶ。この mutation は current active binding を durable `invalidated` にし、`invalidatedAt` を記録する。`invalidationReason` は付けない。`"plan_superseded"` は superseding approval 専用であり、missing-plan invalidation や一般化した reason taxonomy に流用しない。
  - missing-plan mutation が `saved` の場合だけ、同じ boundary を保持したまま current pending / claimed Review Dispatch への既存 cancelled tombstone attempt を完了し、その後 stale active-plan cache を clear して boundary を release する。最終 runtime の順序は `boundary-enter → authorization-invalidated-durable → review-cancelled-tombstone-attempt → active-plan-cache-clear → boundary-release` とする。cancellation append failure は durable invalidation を rollback しない。
  - confirmed missing を検出したが missing-plan mutation が `failed` / `uncertain`、または other deterministic non-success で terminal authority を確認できない場合、cache を active authority として復元せず、cancellation append を試行せず、当該 binding を Review directive reissue、candidate offer、claim、staged completion の Gate / Acceptance promotion、AcceptanceDecision の authority に使用しない。
  - plan probe が throw した場合は不可逆 invalidation を行わず、その startup authorization restoration を uncertain とする。active-plan cache を復元せず、authorization-dependent positive Review / Gate / Acceptance recovery に進まない。一方で Justice plugin 自体の initialize、Wisdom、Telemetry、durable projection cache の初期化は fail-open で継続してよい。この recovery 可否は `JusticePlugin.initialize()` の小さな local readiness state で保持し、generic startup / lifecycle framework を導入しない。
```

- Authorization は最初の Worker Task 実行後も consume しない。
- cancel syntax は `/justice-implement --cancel` に固定する。`--plan` と `--cancel` の併用、approve と cancel の併用、cancel の重複は parser が拒否する。cancel request は planPath を持たず、current session の唯一の active binding だけを release する。
- active binding がない cancel は idempotent no-op とする。error subsystem を追加せず、PlanBridge は non-armed result を返し、active plan cache を変更しない。active binding がある場合は durable release 成功後にだけ cache を clear する。
- explicit cancel は Authorization release durable success 後に、Review Dispatch domain へ同 authorizationId の cancellation orchestration を依頼する。fingerprint mismatch による invalidation も同じ順序で扱う。orchestration の review-log append 失敗は release / invalidation を rollback せず、以後の durable Authorization guard と restart recovery が review authority を fail-closed に保つ。
- cancel / invalidation 後の reapproval は fresh authorizationId を発行する。旧 authorizationId の pending / claimed / staging / terminal review、GateDecision、AcceptanceDecision は新 binding の current authority として再利用、再 claim、再投影しない。
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
  → review worker は `ReviewArtifactReservation` に従い Justice が生成したパスへ JSON artifact を書き出す
  → review worker 観測

Justice
  → `ReviewWorkerResultV1` を抽出し、`TaskCallBinding` 由来の trusted metadata と合わせて `ReviewArtifactV1` を組み立てる
  → terminal outcome mapping に従う
       clean のみ: `ReviewArtifactV1` を current `TaskExecutionRef` に bind
         → ReviewPending → GatePending
         → lifecycle state = `gate_pending` になったタイミングで GateEngine 評価
       findings: Gate を経由せず ReworkRequired、AcceptanceDecision なし
       incomplete / unusable / uncertain: ReviewPending を blocked のまま保持
       評価対象は current attempt の Evidence / Review のみ
       PASS  → `TaskAcceptanceDecision { accepted }`
             → TaskProgressState = accepted
             → ProgressUpdater → PlanParser.updateCheckbox()
       clean artifact に対する Gate WARN/FAIL → rework_required → 新しい `TaskExecutionRef`（新 attemptId）を発行して in_progress へ。Gate由来の rework-required AcceptanceDecision はこの場合だけ発行する
       unavailable/error/insufficient → gate_pending のまま保持し、Gate-phase の評価失敗時だけ blocked AcceptanceDecision を発行
```

terminal physical record の durable commit 後に process が停止した場合、restart recovery は terminal
record を authority として再利用し、record を再appendせず post-terminal outcome application を実行する。
clean review は `gate_pending` の durable transition と current identity の未完了 Gate path を一度だけ
収束させる。findings は `rework_required` を一度だけ収束させ、incomplete は blocked のまま no-op とする。
Authorization が terminal / missing / uncertain なら、terminal review record は保持するが Gate、Acceptance、
Progress、positive lifecycle transition を行わない。

- Worker の正常終了を `TaskAccepted` と同一視しない。
- "tests passed" 等の自己申告 (declared evidence) だけでは Gate PASS 不可。
- Gate PASS より先に plan.md を完了状態にしない。
- 全 task accepted 後:
  - `PlanFinalizationState = all_tasks_accepted`
  - `task(category="sp-final-review")`
  - Final Gate PASS → `PlanFinalizationState = complete`
  - binding released
- Final Review の reviewer execution failure、transport failure、conclusive lost は、対応する
  dispatch を terminalize してから、同じ `finalizationAttemptId` と増分した
  `finalReviewRound` の pending dispatch を durable に発行する。implementation/fix を再実行せず、
  lifecycle は `final_review_pending` のままとする。findings または Final Gate WARN / FAIL による
  actual rework だけが fresh `finalizationAttemptId` を発行する。
- Authorization が terminal / missing / uncertain となった時点で、ReviewPending、GatePending、Final Review、Final Gate のいずれからも authoritative Acceptance / Progress へ進めない。Runtime の既に開始済み worker を強制 abort する必要はないが、到着した結果は stale / blocked とし、review dispatch は best-effort に `cancelled` tombstone へ収束させる。

### 5.5 Review と Final Review

```text
Task Review:
  Worker implementation (TaskExecutionRef = R)
    → Justice durably commits one `pending` slot for `ReviewCorrelation(R)`
    → Justice injects `ReviewRequiredDirective` to Controller
       directive includes current `TaskExecutionRef`
    → Controller dispatches sp-review worker
    → PreToolUse atomically claims the pending slot
       durable claim includes `TaskCallBinding` + `ReviewArtifactReservation`
    → `DelegatedExecutionBinding` correlates child session to parent `TaskExecutionRef`
    → sp-review worker writes `ReviewWorkerResultV1` to the path in `ReviewArtifactReservation`
    → matching PostToolUse validates the binding and assembles `ReviewArtifactV1`
       from trusted metadata + worker result
    → one terminal physical record commits artifact consumption, ReviewArtifactV1,
      and terminalization; projection derives `review_observed`
    → terminal outcome mapping に従う。clean artifact のみが TaskExecutionRef R に bind され、
      durable `review_pending → gate_pending` と Gate evaluation へ進む
      (when lifecycle state = gate_pending)
       Evidence / Review for current TaskExecutionRef R only
       PASS  → TaskAccepted
       WARN/FAIL → rework_required → new TaskExecutionRef R' → in_progress

Final Review:
  All Tasks Accepted
    → fresh finalizationAttemptId / finalReviewRound = 1
    → durable tasks_pending → all_tasks_accepted
    → durable all_tasks_accepted → final_review_pending (same identity)
    → PlanFinalizationState = final_review_pending
    → Justice durably commits one `pending` slot for the final-review correlation
    → Justice injects `ReviewRequiredDirective` to Controller
       directive includes current `finalizationAttemptId`
    → Controller dispatches sp-final-review worker
    → PreToolUse atomically claims the pending slot
       durable claim includes `TaskCallBinding` + `ReviewArtifactReservation`
    → `DelegatedExecutionBinding` correlates child session to parent finalization attempt
    → sp-final-review worker writes `ReviewWorkerResultV1` to the path in `ReviewArtifactReservation`
    → matching PostToolUse validates the binding and assembles `ReviewArtifactV1`
       from trusted metadata + worker result
    → one terminal physical record commits artifact consumption, ReviewArtifactV1,
      and terminalization; projection derives `review_observed`
    → terminal outcome mapping に従う。clean artifact のみが finalizationAttemptId N に bind され、
      durable `final_review_pending → final_gate_pending` と Final Gate evaluation へ進む
      (trigger: final_review_complete)
      PASS
        → PlanFinalizationState = complete
        → Authorization released
      WARN/FAIL
        → PlanFinalizationState = final_rework_required
        → fixes
        → new finalizationAttemptId N' (new UUID) / finalReviewRound N+1
        → PlanFinalizationState = final_review_pending
        → Final Review
          → Justice injects `ReviewRequiredDirective` to Controller
          → Controller dispatches sp-final-review worker
          → clean review artifact (`CleanReviewArtifactV1`) observed as `final_review_complete`
          → Final Gate re-evaluation using only current finalization attempt evidence
            → internal error / insufficient evidence
              → PlanFinalizationState = final_gate_pending (blocked)
    → reviewer execution failure / transport failure / conclusive lost
      → terminal record を durable に記録
      → PlanFinalizationState = final_review_pending を維持
      → same finalizationAttemptId N / finalReviewRound N+1 の新しい pending slot
      → stale N round の Final Review / Final Gate を拒否
```

Task Review と同様、Final Review の terminal physical record がすでに存在して lifecycle/Gate outcome
だけが未適用の場合、restart recovery は terminal record を再appendしない。clean terminal は
`final_review_pending → final_gate_pending` と current identity の未完了 Final Gate path を一度だけ
収束させ、findings terminal は `final_rework_required` を一度だけ収束させる。incomplete terminal は
blocked のままにする。terminal / missing / uncertain Authorization はすべての positive downstream
progress に優先する。

Task Review と Final Review の各矢印は、対応する correlation の authorizationId が current durable
`active` binding である場合だけ authoritative に進める。cancel / invalidation 後は pending / claimed
slot を `cancelled` に収束させ、worker の遅延 PostToolUse、staging recovery、old GateDecision は
reapproval 後の新しい authorizationId と混在させない。

### Task Review の `reviewRound`

`reviewRound` は current `TaskExecutionRef` に属する review dispatch の試行番号とする。
初回 review dispatch は `reviewRound = 1` で開始し、同じ implementation attempt に対する
review transport failure または reviewer execution failure の retry では `reviewRound` を
1 増分する。Review finding を受けて implementation の rework を行う場合は、新しい
`TaskExecutionRef`（新しい `attemptId`）を発行し、その attempt の `reviewRound` は 1 に
リセットする。したがって、progress 更新や review の状態投影だけでは `reviewRound` を
変更しない。restart 後に `pending` または `claimed` を復元するだけの場合も
`reviewRound` を変更せず、`claimed` を自動 retry の理由にしてはならない。

```text
implementation attempt A
  review dispatch #1 → TaskExecutionRef A / reviewRound=1

review transport / reviewer execution failure
  code unchanged
  retry review       → TaskExecutionRef A / reviewRound=2

review finds issue
  implementation rework
  new TaskExecutionRef B → reviewRound=1
```

- `sp-review` / `sp-final-review` の起動主体は Controller。
- Justice は `ReviewRequiredDirective` の生成と、review correlation / `TaskCallBinding` / `DelegatedExecutionBinding` / `ReviewArtifactReservation` を通じた review worker 結果の観測、および `ReviewArtifactV1` の組み立てを行う。
- observed review execution provenance を持つ `CleanReviewArtifactV1`（`complete: true + findings: []`）のみを mandatory review clean completion の authoritative evidence とする。
- external review (CodeRabbit / Greptile) は補助情報であり、mandatory review 完了の証拠にはならない。

---

## 6. テスト戦略

### 6.1 新規テストファイル

| テストファイル                                  | 対象                                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/core/controller-routing.test.ts`         | desired/actual evaluation、applied/mismatch/unapplied、observation source 優先                                                                                                                      |
| `tests/core/plan-authorization.test.ts`         | multi-task 継続、semantic 変更で invalidated、progress-only 更新で維持、別 session 拒否、release 後拒否                                                                                             |
| `tests/core/plan-fingerprint.test.ts`           | checkbox 変更は hash 不変、task 本文変更で hash 変化、EOL 差は無視、Justice-generated Error annotation は hash 不変、manual / provenance 不明の Error annotation は hash 変化                       |
| `tests/core/v2/observation-model.test.ts`      | `error_annotation` の typed observation schema、plan identity、line number / occurrence、unknown provenance の replay                                              |
| `tests/runtime/validation.test.ts`             | `error_annotation` の safe path、digest、positive line identity、invalid shape の strict validation                                                                |
| `tests/core/routing-decision.test.ts`           | 7→7 全射、deep→sp-deep、architecture→sp-architecture、低 category へのパス不存在                                                                                                                    |
| `tests/core/task-lifecycle.test.ts`             | full lifecycle order、WorkerReported≠accepted、fresh rework attempt、restart current-attempt reconstruction、Final Review 未了で PlanComplete=false、attempt scoping で古い evidence の再利用を防ぐ |
| `tests/core/review-dispatch-state.test.ts`      | durable pending / claimed / terminal、CAS claim、restart recovery、conclusive loss、stale PostToolUse、terminal tombstone の再利用禁止                                                              |
| `tests/core/v2/state-projection.test.ts`        | one terminal physical record から consumption / authoritative review / review-observed semantic を同一に replay し、partial terminal state を投影しない                                             |
| `tests/core/acceptance-decision.test.ts`        | PASS/WARN/FAIL/unavailable それぞれの遷移、GateDecision の後だけ AcceptanceDecision を生成、evidence provenance 判定                                                                                |
| `tests/core/doctor-categories.test.ts`          | `justice doctor` が 7 `sp-*` category の欠落を effective category view から検出                                                                                                                     |
| `tests/core/justice-doctor-config.test.ts`      | JSONC、source precedence、unreadable / unsupported source、allowlisted effective view、redacted diagnostics                                                                                         |
| `tests/hooks/plan-bridge-authorization.test.ts` | `/justice-implement --approved` が binding を発行、不一致で invalidate                                                                                                                              |

### 6.2 特に追加すべきシナリオ

- `AtomicPersistence` が `conflict_diverted` を返した場合、authorization が成立しないこと。
- authorizationId を持たない / terminal state を上書きする merge rule が許可されていないこと。
- restart / replay 後に durable log から lifecycle を復元すること。
- active binding から `PlanBridge` の active plan が復元されること。
- external review だけでは `sp-review` / `sp-final-review` 要件を満たさないこと。
- review task と implementation task の correlation / `TaskCallPurpose` / `TaskExecutionRef` が正しく機能すること。
- observed review execution provenance を持つ `CleanReviewArtifactV1` だけを clean review 完了証拠として扱うこと。
- persisted evidence が attempt-scoped（`TaskExecutionRef` / `FinalizationAttemptId`）であること。
- OmO child session correlation（`DelegatedExecutionBinding`）が正しく機能すること。
- review artifact anti-replay（`ReviewArtifactReservation`）が機能すること。
- 同一 parent session の review dispatch が 1 件ずつ発行され、matching pending slot の atomic claim により `callId` と trusted correlation が一対一に bind されること。
- pending slot が 0 件・複数件、または review kind / category が不一致の場合に review binding を作らず、Runtime は継続し、pre-Gate の lifecycle / advisory を保持して AcceptanceDecision を発行しないこと。
- Controller が prompt / args に再提示した correlation や category だけでは trusted identity を成立させないこと。
- `pending` transition の durable commit が directive inject より先に行われ、commit 失敗時に mandatory directive / binding / reservation が作成されないこと。
- 同一 parent session の concurrent claim では exactly one claim だけが成功し、失敗側が binding / reservation を作成しないこと。
- restart / replay 後に `pending` は同じ directive を再発行でき、`claimed` は binding / reservation を復元するだけで directive を再発行しないこと。
- restart 後に `claimed` の終端が不明な場合は retry せず `claimed` を保持して AcceptanceDecision を発行せず、conclusive な lost の場合だけ terminalize 後に増分した `reviewRound` を発行すること。
- artifact consume marker と dispatch terminalization が一つの durable commit として復元され、consume 済み artifact が再読されないこと。
- terminalization commit の失敗後、durable completion staging が同じ `callId`、correlation、artifact ID / digest、observed provenance で一度だけ idempotent に再試行され、成功前に Acceptance 入力へ反映されないこと。
- old `callId` の stale `PostToolUse` が新しい review round の binding、artifact、Gate、Acceptance に影響しないこと。
- attempt-aware duplicate suppression が機能すること。
- acceptance decision binding が `TaskExecutionRef` / `FinalizationAttemptId` に束縛されること。
- 同一 `TaskExecutionRef` の review transport / reviewer execution retry では `reviewRound` が増分し、implementation rework で新しい `TaskExecutionRef` が発行された場合は `reviewRound=1` に戻ること。
- Final Review 未完了では全 checkbox `[x]` でも `PlanComplete` にならないこと。
- Controller Routing で Core が `atlas` を返し Runtime が `sisyphus` のままなら `routingStatus = mismatch` であること。
- fingerprint が fenced code block 内部を正規化しないこと。
- provenance が確認できる Justice-generated legacy Error annotation では fingerprint が変化しないこと。
- manual または provenance 不明の legacy Error annotation では fingerprint が変化すること。
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

| ID     | Invariant                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-01 | Controller intent ≠ Worker intent                                                                                                                     |
| INV-02 | Justice worker decision ends at category                                                                                                              |
| INV-03 | Plan approval survives multiple tasks                                                                                                                 |
| INV-04 | Semantic plan mutation invalidates approval                                                                                                           |
| INV-05 | High complexity never silently downgrades                                                                                                             |
| INV-06 | WorkerReported ≠ TaskAccepted                                                                                                                         |
| INV-07 | Declared evidence never satisfies required gates alone                                                                                                |
| INV-08 | Gate PASS precedes progress completion                                                                                                                |
| INV-09 | Final Review / Final Gate precedes Plan Complete                                                                                                      |
| INV-10 | Fail-open execution ≠ fail-open acceptance                                                                                                            |
| INV-11 | `TaskCallPurpose` separates implementation, task_review, final_review                                                                                 |
| INV-12 | Terminal authorization states (invalidated / released) are not resurrected                                                                            |
| INV-13 | JUS-P0-04 side-effecting handlers in `PostToolUse` are not dispatched via `Promise.all`                                                               |
| INV-14 | Evidence / Review / Gate / Acceptance are scoped to exactly one `TaskExecutionRef` or `FinalizationAttemptId`.                                        |
| INV-15 | Mandatory `sp-review` / `sp-final-review` completion must be observed before its `ReviewArtifact` is consumed.                                        |
| INV-16 | A parent session has at most one outstanding mandatory review dispatch, and binding claims are atomic.                                                |
| INV-17 | Review dispatch `pending` / `claimed` / `terminal` state is durable and restart/replay never reissues a recovered `claimed` call.                     |
| INV-18 | A stale review `PostToolUse` cannot consume an artifact or affect the current review round, Gate, or Acceptance.                                      |
| INV-19 | A terminal, missing, or uncertain Authorization cannot create authoritative Review, Gate, Acceptance, or Progress, including during restart recovery. |
| INV-20 | Mandatory `sp-review` / `sp-final-review` uses `run_in_background = false` at the canonical and final wire boundaries. |
| INV-21 | A review artifact is consumed only when its reserved path, private lease, and durable inode identity match. |

---

## 9. 推奨実装順序

| Phase   | 対象                                | ゴール                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | JUS-P0-03 Category Routing          | 7 role → 7 `sp-*` category の全射化、silent downgrade 除去、`justice doctor` 検査追加                                                                                                                                                                                                                                                                            |
| Phase 2 | JUS-P0-02 Plan Authorization        | one-shot arm を Plan-Scoped Authorization に置換、fingerprint + canonical snapshot 実装                                                                                                                                                                                                                                                                          |
| Phase 3 | JUS-P0-04 Transactional Acceptance  | WorkerReported / TaskAccepted 分離、Evidence→Review→Gate→Acceptance→Progress の直列化、durable review dispatch slot の CAS claim / restart recovery / stale-event rejection。`childSessionId` correlation runtime spike が失敗した場合、authoritative child evidence が確立せず、`TaskAccepted` / `PlanComplete` が blocked となるため、Phase 3 DoD は通らない。 |
| Phase 4 | JUS-P0-01 Controller Runtime Wiring | ControllerRoutingObservation 評価、pinned-command 雛形・doctor 検査、upstream 拡張要求の分離                                                                                                                                                                                                                                                                     |

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
19. Evidence / Review / Gate / Acceptance が current `TaskExecutionRef` / `FinalizationAttemptId` のみに束縛されている。
20. `ReviewArtifactReservation` が unusable の場合も Runtime execution は fail-open で継続し、mandatory review completion は未成立のまま保持して AcceptanceDecision を発行しない。Gate-phase に到達してからの評価失敗だけが blocked AcceptanceDecision になる。
21. OmO child-session observation が `DelegatedExecutionBinding` により親 `ExecutionScope` へ相関付けられる。
22. Review dispatch が parent session 単位で直列化され、matching pending slot の atomic claim なしに `TaskCallBinding` が作成されない。
23. 同一 TaskExecutionRef の review retry では `reviewRound` が増分し、implementation rework では新しい TaskExecutionRef と `reviewRound = 1` が発行される。
24. Review dispatch の `pending` / `claimed` / `terminal` transition、claim 時の binding / artifact reservation、consume marker が durable log から restart / replay 後に復元でき、復元した `claimed` call が再発行されない。
25. old `callId` の stale `PostToolUse` が artifact、Review、Gate、Acceptance、current review round に影響せず、終端不明の claim は自動 retry されない。
26. terminal review は一件の physical record で consumption、artifact、terminalization を保持し、projection が review-observed semantic を導出する。
27. doctor は source precedence に従う allowlisted effective category / command view だけを診断し、raw configuration や秘密値を出力しない。
28. `/justice-implement --cancel` は session-scoped かつ pathless であり、reapproval は fresh authorizationId を発行する。
29. accepted task の全 unchecked step が更新され、再 parse 後に completed となる。
30. terminal Authorization の review directive / claim / completion / Gate / Acceptance / Progress は authoritative にならず、restart recovery もこれを復活させない。
31. `claimed + completion staging` は artifact / worker output を再読せずに terminalization を idempotent に再試行し、terminal Authorization より優先しない。
32. mandatory review の `run_in_background = true` が caller payload に含まれても、canonical package と final wire payload の両方で false に正規化される。
33. artifact reservation は private inode lease と durable identity を保持し、worker write と Justice read が同じ no-follow inode でない場合は completion authority を作らない。

---

## 11. 決定事項メモ

- **Controller Runtime Wiring**: 現行 OpenCode plugin API で in-band agent 切替は不可。config 経由の `agent:` ピン留めを guaranteed application path とし、mismatch detection を主たる観測機能とする。完全な runtime 切替は upstream API 拡張要求として分離。
- **Plan Fingerprint**: 正規化対象を Approved Canonical Snapshot 上で task 実行進捗として認識された checkbox state / EOL のみに限定。global/unscoped セクションの checkbox は正規化しない。legacy Error annotation は one-time migration で除去。一般空白・Task 本文は正規化しない (fail-closed)。fingerprint は `sha256:<lowercase hex>` と仕様化。
- **Task Lifecycle**: 純粋 Core とし、永続化に依存しない。`TaskLifecycleTransitionRecord` / `PlanFinalizationTransitionRecord` を durable log へ書き、v2 state projection 拡張で復元。初回 plan finalization は `tasks_pending → all_tasks_accepted → final_review_pending` を同じ初回 identity で記録し、`all_tasks_accepted` の task 集合は Approved Canonical Snapshot を SSOT とする。
- **Progress Update**: Worker success からの直接 plan.md 更新を廃止。`TaskAccepted` 後の専用 ProgressUpdater 経由でのみ checkbox を更新。
- **Task Attempt**: `TaskAttemptId` は `authorizationId` + `taskId` 単位で発行し、`in_progress` 遷移時に新規 attempt を作成する。Gate は current attempt の Evidence / Review のみを評価する。rework 時は新しい attemptId を発行する。
- **Finalization Attempt**: `FinalizationAttemptId` / `finalReviewRound` を導入し、初回 `tasks_pending → all_tasks_accepted` 遷移時に新しい `finalizationAttemptId`（新 UUID）と `finalReviewRound = 1` を発行する。`all_tasks_accepted → final_review_pending` は同じ identity を使い、`final_rework_required → final_review_pending` 遷移時だけ新しい `finalizationAttemptId`（新 UUID）と増分した `finalReviewRound` を両方更新する。Final Gate は current finalization attempt の evidence / review のみを評価する。
- **Review**: `sp-review` / `sp-final-review` worker は Controller が `task()` として起動。Justice は `ReviewRequiredDirective` 生成、`ReviewCorrelation` / `TaskCallBinding` / `DelegatedExecutionBinding` / `ReviewArtifactReservation` を通じた review worker 結果と observed review execution の観測、`ReviewArtifactV1` 組み立てを担当。observed review execution provenance を持つ `CleanReviewArtifactV1`（`complete: true + findings: []`）だけを clean review 完了の authoritative evidence とする。external review を mandatory review 完了の証拠とはしない。Review transport は Phase 3 では JSON artifact file (B) に固定し、typed transport は将来候補・現スコープ外とする。
- **Review Dispatch**: P0 では `ReviewDispatchId` を追加せず、`parentSessionId + ReviewCorrelation` を slot identity とする。`pending` transition を directive 前に durable commit し、PreToolUse の `pending → claimed` CAS commit に `TaskCallBinding` と `ReviewArtifactReservation` を含める。restart 後の `pending` は同じ directive のみ再発行でき、`claimed` は call を再発行せず、terminal tombstone と stale event rejection を維持する。
- **Authorization and Review Dispatch**: ReviewCorrelation が参照する durable Authorization は Review、Gate、Acceptance、Progress の authority boundary である。release / invalidation を先に durable commit し、その後 existing `cancelled` dispatch tombstone を best-effort で収束させる。別 store を transaction 化せず、すべての recovery / claim / completion / Gate entry point が terminality を再確認することで、pre-Gate では AcceptanceDecision を発行せず、Gate-phase でも fail-closed acceptance を維持する。
- **Gate Verdict**: `UNKNOWN` は採用しない。Gate 評価の評価不能・内部エラー時は `gate_pending` / `final_gate_pending` のまま保持し、Gate-phase の評価失敗に限って blocked AcceptanceDecision を発行する。pre-Gate の評価不能・証拠不足・レビュー未完了では AcceptanceDecision を発行しない。task gate に加え plan gate（Final Gate）を追加。Gate 評価は lifecycle state = `gate_pending` / `final_gate_pending` 時に実行。task gate の `WARN` / `FAIL` は `rework_required`、plan gate の `WARN` / `FAIL` は `final_rework_required` へ進める。
- **Traceability**: 本設計書の修正内容（JUS-P0-04-06 の UNKNOWN 扱いの整理、JUS-P0-01 の pinned-command 適用の具体化、attempt-scoped acceptance、Review Artifact transport、child-session correlation など）は `REQUIREMENTS_2026-09-03.md` に反映済みである。

---

## 12. F-037 Production Composition and Hook Routing

本節は Review Dispatch の domain factory を既存 runtime に接続する production contract で
あり、4.7、4.8、4.8.1、4.8.2、4.10 の補足である。factory の unit-level correctness と
plugin の live event routing は別の完了条件とする。Review Dispatch が production
composition root から到達できない場合、Task 3.4 は未実装である。

### 12.1 Single composition root

- `JusticePlugin` は `reviewDispatchState` を private readonly field として所有し、
  `createReviewDispatchState(...)` を constructor 中に一度だけ呼び出す。
- Task 2.2 の `createAuthorizationReviewBoundary()`、`AuthorizationStore`、Task 3.2 の
  Gate evaluator、Task 3.4 の Review Dispatch、Task 3.6 の Review Completion は、同じ
  `AuthorizationReviewBoundary.withParentSession` を共有する。domain ごとの別 queue、
  implicit singleton、test-only boundary は禁止する。
- `ObservationLogStore` は plugin の一つの writer identity で一度だけ構成し、Observation、
  lifecycle、Review Dispatch、Gate、Acceptance、Completion が同じ durable read/append
  authorityを使用する。state projection cache は authority ではない。
- Review Dispatch の全 I/O は injected port とし、production binding は
  `ObservationLogStore`、authoritative `AuthorizationStore`、Task 3.4 の
  `ReviewArtifactReservationPort`、既存の advisory append、hook response sink に接続する。
  Core factory は runtime adapter、filesystem、notifier を直接参照しない。
- `cancelReviewDispatchesForTerminalAuthorizationWithinParentSessionClaim` は、生成済み
  `reviewDispatchState` から取り出した同じ function を `PlanBridge` に一度だけ注入する。
  cancellation callback だけを設定して Review Dispatch state 自体を構成しない実装は無効である。

`ReviewRequiredDirective` は `correlation` だけを identity SSOT とする。runtime delivery が
parent session を必要とするため、factory port は directive と routing metadata を分離して
受け取る。

```ts
export type ReviewDirectiveDelivery = {
  readonly parentSessionId: string;
  readonly directive: ReviewRequiredDirective;
};
```

`parentSessionId` は delivery routing にのみ使い、directive の correlation に複製しない。
delivery は同じ parent と `sameReviewCorrelation` の組み合わせで idempotent にする。
notifier、prompt、category、artifact path、worker report は trusted identity ではない。

### 12.2 Startup and lifecycle ordering

plugin startup の Authorization-dependent sequence は次の順序を守る。

1. authoritative Authorization を hydrate し、read / parse / validation failure を
   `uncertain` readiness として保持する。
2. durable observation log を読み、lifecycle、dispatch slot、binding、staging を projection
   する。
3. readiness が authoritative の場合だけ、staged Review Completion recovery を実行する。
4. 同じ readiness の内側で Review Dispatch recovery を実行し、active `pending` の directive
   だけを再発行する。`claimed` を再発行しない。
5. notifier と通常の event processing を継続する。

Authorization が unreadable / missing / terminal / conflict-diverted / otherwise uncertain
の場合、positive Review、Gate、Acceptance、Progress を作成しない。既存の pending / claimed
slot の cancellation tombstone は同じ parent boundary 内で best-effort に収束させる。

Task lifecycle が `review_pending` または `final_review_pending` に durable に到達した後、
Review Dispatch の public `offerNextMandatoryReview(parentSessionId)` を一度だけ通知する。
candidate correlation を caller から渡してはならず、candidate 選択、outstanding cardinality、
`null -> pending` append、directive injection は Review Dispatch boundary が所有する。
terminalization、completion、restart recovery は同じ boundary を使用し、within-boundary
caller が public wrapper を再取得してはならない。

Lifecycle owner と Review Dispatch の接続は、correlation を受け取らない narrow callback port とする。

```ts
export type ReviewPendingCommittedHandler = (
  parentSessionId: string,
) => Promise<void>;
```

- `parentSessionId` は durable lifecycle transition に記録された Controller session identity
  から渡し、event session、child session、prompt、category から再構成しない。
- lifecycle owner は `review_pending` / `final_review_pending` の append 結果が
  `committed` の場合だけ callback を一度呼ぶ。`failed`、duplicate、invalid transition では呼ばない。
- callback は directive の内容や correlation を返さず、Review Dispatch が既存の shared boundary
  内で候補選択、pending commit、directive delivery を行う。lifecycle owner は Review Dispatch
  の concrete state や filesystem を import しない。
- callback が失敗しても durable lifecycle commit は維持する。lifecycle owner は失敗を advisory
  として記録する best-effort の通知処理へ縮退し、例外を hook へ漏らさない。
- 実行時の callback は composition root が同一 `reviewDispatchState` の
  `offerNextMandatoryReview(parentSessionId)` に束縛する。startup recovery と terminalization は
  同じ instance の within-parent capability を使用し、別の queue や wrapper を作らない。
- `ObservationHandler` が callback の唯一の production owner である。setter が保存する private
  fieldを、各 lifecycle append 呼出時に生成する `LifecycleNotificationDependencies` へそのまま渡す。
  constructor dependency と setter field を並存させず、callback を取り出す別 registry や queue を作らない。
  したがって lifecycle commit から callback、同一 `reviewDispatchState` の offer、durable pending、
  sink delivery までの live path は一つだけである。

Directive injection は notifier-only の副作用ではない。Review Dispatch が pending commit
後に `ReviewDirectiveSink.deliver(ReviewDirectiveDelivery)` を完了させた場合、同じ
`JusticePlugin.handleEvent()` invocation の root route がその delivery を一度だけ drain し、
その invocation の `HookResponse` に merge する。PreToolUse と PostToolUse の両方が drain
point であり、PostToolUse では observation、completion、PlanBridge、TaskFeedback の全 handler
が settle した後に drain する。したがって lifecycle offer / completion が PostToolUse 内で
生成した directive は、その PostToolUse response に含まれ、次の無関係な PreToolUse を待たない。
startup recovery のように現在の hook response がない場合だけ、delivery は同じ parent session
の pending queue に保持し、次の Controller-facing PreToolUse または PostToolUse で一度だけ
再発行する。sink 内の delivery 自体は durable authority ではない。root drain は、同じ
parent session と `ReviewCorrelation` の current durable slot が `pending` であり、
その correlation の
Authorization が current active である場合だけ directive を inject できる。slot が `claimed`、
`terminal`、`cancelled`、missing、または current lifecycle / Authorization と一致しない場合は
stale delivery として inject せず sink から削除する。

drain-time validation、sink からの delivered / stale item の確定的除去、及び同じ parent の
claim / cancellation との順序付けは、既存の `AuthorizationReviewBoundary` 内で線形化する。
したがって restart 後に最初の matching hook 自身が Review PreToolUse で
`pending -> claimed` を commit した場合、その correlation の startup delivery は同じ response に
再injectされない。
Authorization または durable dispatch read が unreadable / uncertain の場合は positive directive
を inject しない。この場合は stale と断定せず delivery を sink に保持し、次の matching root
hook で再検証する。個別の domain handler が sink を drain してはならず、handler failure 時も
root route の fail-open drain-and-merge を経由して delivery を捨てない。durable
`pending -> claimed`
commit 後は旧 directive を queue に再投入せず、recovery も claimed slot を delivery しない。

### 12.3 Review-first PreToolUse

`JusticePlugin.handleEvent(PreToolUse)` は `task()` の review category を既存の
implementation `PlanBridge` より先に判定する。

1. exact category `sp-review` / `sp-final-review` のみを review route とする。category は
   expected category であり、correlation identity の証拠ではない。
2. runtime-observed `parentSessionId`、`callId`、`agentId`、`sessionId`、`writerId` を検証する。
   field path は Task 3.3 の observed runtime contract に固定し、prompt、category、path、
   self-report から補完しない。
   `ClaimInput.callId` は runtime event の `event.callId` だけから構成し、payload 内の
   optional な `callId` を fallback に使用しない。runtime `callId` が欠落または空の場合は
   review claim を実行せず、advisory を記録して既存の fail-open `HookResponse` に縮退する。
3. `claimReviewDispatch()` は durable pending slot を自ら選択し、入力の correlation を
   authority として使わない。
4. claim commit 後にのみ `TaskCallPurpose = task_review | final_review`、trusted
   `ReviewCorrelation`、`ReviewArtifactReservation` を binding として公開する。
5. review route は `PlanBridge.handlePreToolUse()` と `consumeImplementationArm()` を呼ばない。
   pending slot 不在、複数、category mismatch、authorization uncertainty、claim failure は
   implementation route へ fallback せず blocked / stale advisory とする。

`ClaimInput` は correlation field を持たない。production caller は untrusted tool input の
`correlation` を claim API へ転送せず、型境界で durable pending slot だけを correlation authority
にする。

usable claim の worker input は committed `TaskCallBinding.artifactReservation.artifactPath`
をそのまま使用する。hook や adapter は再生成・再正規化・別 path 選択をしてはならない。
unusable reservation は path を提示せず、runtime task は fail-open で継続するが、Review、
Gate、Acceptance、retry の authority は成立しない。`sp-review` と `sp-final-review` は
canonical package、hook、final wire の全境界で `run_in_background = false` とする。

### 12.4 Purpose-aware PostToolUse

PostToolUse は call ID から durable `TaskCallBinding` を解決し、purpose を最初に分岐する。

- `implementation` は WorkerReported、Evidence、implementation lifecycle の path に進む。
- `task_review` / `final_review` は matching parent、call、trusted correlation、category、
  child binding を検証し、Review Completion の artifact consume / terminalization path に進む。
- stale call、old round、purpose mismatch、unknown child relation は advisory-only であり、
  artifact read、ReviewArtifact、Gate、Acceptance、Progress を発生させない。
- review purpose を implementation feedback、implementation completion、generic task summary
  として処理してはならない。side-effecting completion は指定された直列化境界内で行う。

Task ownership is explicit: Task 3.4 owns the single Review Dispatch composition root,
directive delivery sink, and review-first PreToolUse claim route. Task 3.6 owns the
purpose-aware review PostToolUse route and the call to `consumeReviewCompletion`; Task 3.4
must not import or invoke that completion consumer. Task 3.1 owns the lifecycle notification
that invokes the public `offerNextMandatoryReview(parentSessionId)` boundary. Task 3.5 owns
the durable child binding that Task 3.6 consumes.

### 12.5 HookResponse and fail-open contract

既存の `HookResponse` union を維持する。usable claim の payload modification は
`InjectResponse` と既存 merger を使用し、`ProceedResponse.modifiedPayload` や新しい response
variant を追加しない。

- usable claim は committed artifact path と `run_in_background: false` を含む modified args
  を返す。
- `claimed_unusable` は artifact path を省略した advisory / inject とし、task execution を
  継続する。
- blocked / stale / unreadable Authorization は binding、reservation、path を返さず、
  `proceed` または既存の advisory `inject` に縮退する。`skip` は使用しない。
- observation、normal context、gate advisory の既存 merge semantics を保持する。
- claim、reservation、projection、delivery、completion の例外は hook boundary 内で捕捉し、
  advisory を best-effort に記録したうえで非ブロッキング response に縮退する。
- `JusticePlugin.handleEvent(PreToolUse)` は review claim / observation response と、
  current pending authority を確認済みの drained directive responses を
  `mergePreToolUseResponses` で
  一度だけ合成する。
- `JusticePlugin.handleEvent(PostToolUse)` は observation、PlanBridge、TaskFeedback、Gate の
  response を先に `mergePostToolUseResponses` で合成し、その後に同じ parent session の
  current-pending-authority を確認済み sink deliveries を `inject` response として
  追加合成する。sink drain が PreToolUse にしか存在しない実装は、lifecycle offer の
  directive delivery を失うため
  不適合である。

### 12.6 Acceptance criteria

Task 3.4 の acceptance は、unit factory testsに加えて、実際の `JusticePlugin.handleEvent()`
を通る live integration test を必須とする。少なくとも次を確認する。

- `sp-review` と `sp-final-review` の PreToolUse が一度だけ durable claim され、trusted
  binding、exact artifact path、synchronous wire が観測される。
- review task が implementation arm を消費せず、PlanBridge implementation response へ
  fallback しない。
- pending slot 不在、Authorization unreadable、claim failure が既存 HookResponse union の
  fail-open outcome となり、positive Review / Gate / Acceptance / Progress が作られない。
- matching review PostToolUse が completion / terminalization に進み、stale event は artifact
  を読まない。
- lifecycle transition 後の review offer または matching completion が生成した directive が、
  その PostToolUse の返却 `HookResponse` に実際に含まれ、notifier-only の副作用に留まらない。
- initialization が Authorization hydration、projection、staged completion recovery、
  Review Dispatch recovery の順序を守り、recovered claimed call を再発行しない。
- startup recovery が queue した pending directive に対し、最初の matching root hook が
  review PreToolUse で claim した場合、claim transition / binding は各一件で、同じ response と
  後続 hook に
  古い `REVIEW REQUIRED` directive が含まれない。terminal / cancelled slot は inject せず、
  unreadable / uncertain authority は delivery を保持したまま positive directive を inject しない。

`ec23694` のように設計・計画書だけを変更したコミットでは、テストコードが追加されたとは
みなさない。計画上の fixture と実際に実行可能な production integration test を区別し、
実テストの RED/GREEN と全体品質ゲートを別途確認する。
