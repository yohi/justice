# Justice 次期優先要件定義書

**Document:** Justice Next Priority Requirements  
**Date:** 2026-09-03  
**Status:** Draft  
**Scope:** Superpowers × Justice × Oh My OpenAgent 統合アーキテクチャ  
**Priority:** P0

---

## 1. 目的

Justice は、Superpowers が定義する開発方法論・ワークフロー上の意味を、Oh My OpenAgent（以下 OmO）が実行可能な Agent Runtime 上の操作へ変換し、その実行結果が Superpowers の要求する品質・プロセスを満たしていることを観測・判定する **Semantic Control Plane** とする。

3システムの責務は以下のように分離する。

- **Superpowers**
  - 開発方法論の Source of Truth
  - Brainstorming
  - Planning
  - SDD
  - TDD
  - Review
  - Verification
  - Completion semantics

- **Justice**
  - Workflow semantic interpretation
  - Controller routing
  - Worker task semantic classification
  - Plan authorization
  - Category mapping
  - Execution observation
  - Evidence evaluation
  - Gate evaluation
  - Task acceptance
  - Workflow integrity

- **OmO**
  - Agent runtime
  - Controller / Worker execution
  - Category dispatch
  - Model selection
  - Provider selection
  - Model fallback
  - Tool execution

Justice は Superpowers の方法論を再実装してはならず、OmO の Agent / Model routing を奪ってもならない。

Justice の責務は、

> **Superpowers の Desired State と OmO の Actual Execution の意味的一致を維持し、その成立を Evidence に基づいて証明すること**

である。

---

# 2. 今回の最優先4要件

本リリース系列では、以下の4項目を最優先要件とする。

| ID | 要件 | 優先度 |
|---|---|---|
| JUS-P0-01 | Controller Routing の Runtime Wiring | P0 |
| JUS-P0-02 | Plan-Scoped Authorization | P0 |
| JUS-P0-03 | Semantic Category Routing の完全化 | P0 |
| JUS-P0-04 | Evidence-Based Transactional Task Acceptance | P0 |

これら4要件は独立した機能追加ではなく、Justice を Semantic Control Plane として成立させるための中核要件である。

---

# 3. 共通アーキテクチャ原則

## 3.1 Desired State / Actual State

Justice は常に以下の双方向変換を扱う。

```text
Top-down

Superpowers workflow semantics
        ↓
      Justice
        ↓
OmO executable semantics


Bottom-up

OmO actual execution
        ↓
      Justice
        ↓
Evidence / Review / Gate
        ↓
Superpowers requirements satisfied?
```

Justice は単なる bridge ではなく、

```text
Desired State → Executable State
Actual State  → Observable State
Evidence      → Acceptance Decision
```

を担う。

---

## 3.2 Controller と Worker の分離

Controller routing と Worker routing は異なる概念として扱わなければならない。

### Controller

Workflow 全体を進行・統括する Agent。

例:

| Superpowers workflow | Controller |
|---|---|
| brainstorming | Sisyphus |
| writing-plans | Sisyphus |
| subagent-driven-development | Atlas |
| executing-plans | Sisyphus |

### Worker

Controller から渡された個別 Task を実行する Agent。

Justice は Worker の Agent 名を選択してはならない。

Worker に対して Justice が決定してよいのは、

```text
semantic role
        ↓
category
```

までとする。

実際の、

```text
category
  ↓
agent
  ↓
model
  ↓
provider
  ↓
fallback
```

は OmO の責務とする。

---

## 3.3 Worker Payload Boundary

Justice が生成または enrichment する Worker payload は原則として以下とする。

```text
task_id
description
category
load_skills
run_in_background
context
```

以下を Worker payload に指定してはならない。

```text
agent
subagent_type
model
provider
variant
reasoning
fallback_models
```

これらが入力に存在した場合、Justice の Worker boundary で除去する。

---

## 3.4 Fail-Open と Fail-Closed の境界

Justice の既存 fail-open 原則は維持するが、意味を明確化する。

### Execution は Fail-Open 可能

Justice 内部の telemetry、observation、optional enrichment 等の障害によって OpenCode / OmO Runtime 全体を不必要に停止させない。

### Acceptance は Fail-Closed

Justice が十分な根拠を取得できなかった場合、

```text
Authorized
Accepted
Verified
Complete
```

という状態を生成してはならない。

すなわち、

> **Fail-open execution, fail-closed acceptance**

を基本原則とする。

---

# 4. JUS-P0-01: Controller Routing の Runtime Wiring

## 4.1 背景

Justice Core が、

```text
workflow
    ↓
controller
```

を判定できるだけでは十分ではない。

Controller routing decision が Domain Object として存在していても、実際の OpenCode / OmO Runtime に反映されなければ、routing は成立していない。

Justice は、

```text
Desired Controller
```

を決定するだけでなく、

```text
Actual Controller
```

との対応を Runtime 上で成立させる必要がある。

---

## 4.2 要件

### JUS-P0-01-01

Justice は Superpowers workflow から Controller を決定できなければならない。

最低限、以下を標準 mapping とする。

```text
brainstorming
    → Sisyphus

writing-plans
    → Sisyphus

subagent-driven-development
    → Atlas

executing-plans
    → Sisyphus
```

### JUS-P0-01-02

ControllerRoutingDecision は WorkerRoutingDecision と別の型・別の処理経路として表現しなければならない。

例:

```text
ControllerRoutingDecision {
    workflow
    controller
    reason
}
```

と、

```text
WorkerRoutingDecision {
    executionRole
    category
    taskId
    loadSkills
}
```

を混同してはならない。

### JUS-P0-01-03

ControllerRoutingDecision は OpenCode Adapter / OmO Runtime に実際に適用されなければならない。

単なる、

- prompt guidance
- synthetic message
- advisory text
- log
- domain-level decision

のみをもって「Controller routed」と扱ってはならない。

### JUS-P0-01-04

Justice は Controller routing の適用結果を観測可能でなければならない。

最低限、

```text
desiredController
actualController
routingStatus
```

を区別できること。

routingStatus は少なくとも、

```text
applied
unapplied
unsupported
mismatch
```

相当の状態を表現できなければならない。

### JUS-P0-01-05

Runtime の制約により Controller を適用できない場合、Justice は routing が成功したと報告してはならない。

---

## 4.3 Acceptance Criteria

以下を自動テストで証明する。

```text
brainstorming
→ desiredController = Sisyphus
→ runtime routing が実際に適用される

writing-plans
→ desiredController = Sisyphus

subagent-driven-development
→ desiredController = Atlas

executing-plans
→ desiredController = Sisyphus
```

さらに、

```text
Core が Atlas を返した
BUT
Runtime は Sisyphus のまま
```

の場合、

```text
routingStatus = applied
```

となってはならない。

---

# 5. JUS-P0-02: Plan-Scoped Authorization

## 5.1 背景

Superpowers SDD は、

```text
Approved Plan
    ↓
Task 1
    ↓
Task 2
    ↓
Task 3
    ↓
...
    ↓
Final Review
```

を一つの継続した実行単位として扱う。

人間が承認した Plan に基づいている限り、Task ごとの再承認を要求しない。

したがって Authorization を、

```text
/justice-implement --approved

→ 次の task 1回だけ許可
```

という one-shot authorization として実装してはならない。

Authorization の対象は Task ではなく **Approved Plan** である。

---

## 5.2 Authorization Model

Justice は少なくとも以下の情報を保持する。

```text
ApprovedPlanBinding {
    sessionId
    planPath
    planFingerprint
    approvedAt
    status
}
```

status は最低限、

```text
active
invalidated
released
```

を表現する。

---

## 5.3 要件

### JUS-P0-02-01

`/justice-implement --approved` は Approved Plan に対する authorization を生成する。

### JUS-P0-02-02

Authorization は最初の Worker Task 実行後に consume / delete してはならない。

以下を同一 authorization で実行可能でなければならない。

```text
Task 1
Task 2
Task 3
...
Final Review
```

### JUS-P0-02-03

Authorization は最低限、

```text
sessionId
planPath
planFingerprint
```

に bind する。

### JUS-P0-02-04

別 Session から Authorization を再利用してはならない。

### JUS-P0-02-05

承認対象 Plan の意味的内容が変更された場合、Authorization を invalidated とする。

```text
Approved
   ↓
Plan semantic mutation
   ↓
Authorization invalidated
   ↓
Re-approval required
```

### JUS-P0-02-06

Execution progress の更新だけを Plan semantic mutation と判定してはならない。

特に、

```text
task completed
review completed
gate passed
```

等の runtime progress と、

```text
task definition changed
requirement changed
implementation strategy changed
acceptance criteria changed
```

等の Plan mutation を区別する。

### JUS-P0-02-07

Plan fingerprint は approval-relevant semantics を表現しなければならない。

単純な raw file hash のみを採用し、checkbox 等の execution progress 更新によって毎回 authorization が失効する設計は不可とする。

推奨構造は、

```text
Approved Plan Definition
        +
Execution Progress Ledger
```

の分離である。

### JUS-P0-02-08

以下の場合 Authorization は release される。

```text
Plan completed
AND
Final Review accepted
AND
Final Gates passed
```

または User による明示的な cancel。

---

## 5.4 Authorization Failure

以下の場合、Justice は Task を Authorized として扱ってはならない。

```text
authorization missing
session mismatch
plan path mismatch
plan fingerprint mismatch
authorization invalidated
authorization released
```

内部エラーによって Agent Runtime を完全停止するか否かとは独立して、

```text
authorized = true
```

を誤って生成してはならない。

---

## 5.5 Acceptance Criteria

以下を自動テストする。

```text
Approve Plan
→ Task 1 authorized
→ Task 2 authorized
→ Task 3 authorized
```

Task 1 実行後にも authorization が残ること。

さらに、

```text
Approve Plan
→ Plan task definition変更
→ fingerprint mismatch
→ authorization invalidated
→ Task execution is not authorized
```

となること。

Execution progress のみの更新では authorization が維持されること。

---

# 6. JUS-P0-03: Semantic Category Routing の完全化

## 6.1 背景

Justice が Worker の complexity / semantic role を認識しても、その role が category に正しく変換されなければ意味がない。

特に、

```text
deep
architecture
```

のような高難度 Task が category 未定義を理由に、

```text
unspecified-low
```

相当へ silent downgrade されることは、Semantic Control Plane として許容できない。

---

## 6.2 Canonical Execution Roles

Justice は最低限以下を標準 role として扱う。

```text
mechanical
implementation
integration
deep
architecture
review
final-review
```

---

## 6.3 Canonical Category Mapping

標準 mapping を以下とする。

| Execution Role | OmO Category |
|---|---|
| mechanical | `sp-mechanical` |
| implementation | `sp-implementation` |
| integration | `sp-integration` |
| deep | `sp-deep` |
| architecture | `sp-architecture` |
| review | `sp-review` |
| final-review | `sp-final-review` |

Justice は category の意味だけを決定する。

各 category が、

```text
どの Agent を使うか
どの Model を使うか
どの Provider を使うか
どの fallback を使うか
```

は OmO configuration の責務とする。

---

## 6.4 要件

### JUS-P0-03-01

すべての canonical execution role は明示的な category mapping を持たなければならない。

### JUS-P0-03-02

未知または未定義 role を silent に低 complexity category へ downgrade してはならない。

特に、

```text
deep
architecture
integration
review
final-review
```

から、

```text
unspecified-low
quick
```

相当への暗黙 downgrade を禁止する。

### JUS-P0-03-03

Category が OmO 側に存在しない場合は configuration problem として検出可能でなければならない。

`justice doctor` は少なくとも以下を検証する。

```text
sp-mechanical
sp-implementation
sp-integration
sp-deep
sp-architecture
sp-review
sp-final-review
```

### JUS-P0-03-04

Justice は category 不在を理由として直接 model を選択してはならない。

禁止例:

```text
architecture
→ category missing
→ Justice chooses Claude X
```

正しい責務分離は、

```text
architecture
→ sp-architecture
→ OmO
→ configured model/provider/fallback
```

とする。

### JUS-P0-03-05

Fix loop における escalation も Model escalation ではなく Semantic escalation とする。

例:

```text
implementation
    ↓ repeated failure
integration
    ↓ repeated failure
deep
```

Justice は、

```text
use stronger model X
```

ではなく、

```text
this task now requires deeper semantic execution
```

を表現する。

実際の model escalation は OmO に委譲する。

---

## 6.5 Acceptance Criteria

最低限以下をテストする。

```text
mechanical → sp-mechanical
implementation → sp-implementation
integration → sp-integration
deep → sp-deep
architecture → sp-architecture
review → sp-review
final-review → sp-final-review
```

さらに、

```text
deep → unspecified-low
architecture → unspecified-low
```

となるコードパスが存在しないこと。

Worker payload に、

```text
model
provider
agent
subagent_type
```

が混入しないこと。

---

# 7. JUS-P0-04: Evidence-Based Transactional Task Acceptance

## 7.1 背景

以下は同じ意味ではない。

```text
Worker finished
Worker says tests passed
Task tool returned success
Task accepted
Plan step completed
```

Superpowers の verification semantics を維持するには、

> Worker が「完了した」と報告しただけでは Task は完了していない

という原則が必要である。

Justice は Worker execution と Task acceptance の間に、

```text
Evidence
Review
Gate
```

を置かなければならない。

---

# 8. WorkerReported と TaskAccepted の分離

Task lifecycle を最低限以下として扱う。

```text
Authorized
    ↓
TaskInProgress
    ↓
WorkerReported
    ↓
EvidencePending
    ↓
ReviewPending
    ↓
GatePending
    ↓
TaskAccepted
```

失敗時は、

```text
GatePending
    ↓
ReworkRequired
    ↓
TaskInProgress
```

へ戻る。

---

## 8.1 要件

### JUS-P0-04-01

Worker の正常終了を `TaskAccepted` と同一視してはならない。

### JUS-P0-04-02

Worker が、

```text
tests passed
build passed
review clean
done
completed
```

と出力したことだけを Gate PASS の Evidence に使用してはならない。

これは `declared evidence` としてのみ扱う。

### JUS-P0-04-03

Gate PASS を成立させられる Evidence は原則として、

```text
observed
derived
```

の provenance を持つものに限定する。

### JUS-P0-04-04

Code-producing Task は原則として以下の順序を経る。

```text
Worker execution
     ↓
Evidence collection
     ↓
Task review
     ↓
Gate evaluation
     ↓
Task acceptance
     ↓
Progress update
```

### JUS-P0-04-05

Gate evaluation と Plan progress update を race させてはならない。

以下は禁止する。

```text
             ┌→ Gate evaluation
Worker done ─┤
             └→ Plan checkbox [x]
```

正しくは、

```text
Worker done
    ↓
Evidence
    ↓
Review
    ↓
Gate PASS
    ↓
TaskAccepted
    ↓
Plan progress update
```

とする。

### JUS-P0-04-06

Gate が WARN / FAIL / UNKNOWN の場合、Task を Accepted としてはならない。

必要に応じて、

```text
ReworkRequired
```

へ遷移する。

### JUS-P0-04-07

Plan progress の更新は `TaskAccepted` の結果として実行する。

Worker の tool success を直接 Plan completion に接続してはならない。

---

# 9. Gate Profile

Task の種類によって必要な Gate が異なるため、Gate は semantic task type に応じて評価可能でなければならない。

Code-producing Task の標準的な Gate は最低限、

```text
required-tests
build-green
review-clean
```

を含む。

必要に応じて、

```text
typecheck
lint
security
integration-test
```

等を追加可能とする。

ただし Gate の具体的な command を Superpowers skill 内へ二重定義するのではなく、Justice は得られた Evidence と要求条件を照合する。

---

# 10. Review

Superpowers SDD が要求する Task Review と Final Review を区別する。

## Task Review

```text
Task implementation
    ↓
sp-review
    ↓
Gate evaluation
    ↓
TaskAccepted
```

## Final Review

全 Task Acceptance 後、

```text
All Tasks Accepted
    ↓
sp-final-review
    ↓
Final Gates
    ↓
Plan Complete
```

とする。

Final Review を通過するまで Plan 全体を Complete としてはならない。

---

# 11. Task Progress State

最低限以下の状態を区別可能とする。

```text
pending
authorized
in_progress
worker_reported
evidence_pending
review_pending
gate_pending
rework_required
accepted
```

`completed` のような曖昧な単一状態のみで Worker completion と acceptance を表現してはならない。

---

# 12. SDD 全体 State Machine

4要件を統合した目標 state machine を以下とする。

```text
DesignRequired
      ↓
DesignApproved
      ↓
PlanRequired
      ↓
PlanReady
      ↓
PlanApproved
      ↓
PlanAuthorized
      ↓
┌─────────────────────────────┐
│                             │
│ TaskAuthorized              │
│      ↓                      │
│ TaskInProgress              │
│      ↓                      │
│ WorkerReported              │
│      ↓                      │
│ EvidencePending             │
│      ↓                      │
│ ReviewPending               │
│      ↓                      │
│ GatePending                 │
│      ↓                      │
│ ┌───────────────┐           │
│ │ PASS          │ FAIL      │
│ ↓               ↓           │
│ TaskAccepted  ReworkRequired│
│ ↓               │           │
│ Next Task ←─────┘           │
│                             │
└─────────────────────────────┘
      ↓
AllTasksAccepted
      ↓
FinalReview
      ↓
FinalGate
      ↓
PlanComplete
      ↓
AuthorizationReleased
```

---

# 13. Superpowers SDD との対応

Justice は Superpowers SDD lifecycle を置き換えない。

対応関係は以下とする。

```text
Superpowers
brainstorming
      ↓
Justice workflow semantics
      ↓
Controller = Sisyphus


Superpowers
writing-plans
      ↓
Justice plan tracking
      ↓
Controller = Sisyphus


Superpowers
subagent-driven-development
      ↓
Justice plan authorization
      ↓
Controller = Atlas


Superpowers
fresh task worker
      ↓
Justice semantic classification
      ↓
OmO category
      ↓
OmO worker/model selection


Superpowers
TDD
      ↓
load_skills
      ↓
OmO SkillResolver
      ↓
Worker execution


Superpowers
verification-before-completion
      ↓
Justice Evidence
      ↓
Gate
      ↓
TaskAccepted


Superpowers
task review / final review
      ↓
sp-review / sp-final-review
      ↓
OmO reviewer execution
      ↓
Justice observation
```

---

# 14. 非要件

今回の4要件を実現するにあたり、Justice は以下を行わない。

## Superpowers lifecycle の再実装

Justice 独自の TDD engine、SDD engine、Brainstorming methodology 等を作らない。

## Worker model selection

Justice は、

```text
Claude
GPT
Gemini
model version
provider
reasoning effort
```

を Worker routing decision に含めない。

## OmO fallback engine の再実装

Model availability / provider fallback は OmO の責務とする。

## Worker の自己申告を Verification とみなすこと

Agent output は Evidence の一部にはなり得るが、それだけで Gate PASS を成立させない。

---

# 15. 必須 Invariants

実装後、以下は常に成立しなければならない。

### INV-01

```text
Controller intent != Worker intent
```

Controller routing と Worker routing を混同しない。

### INV-02

```text
Justice worker decision ends at category
```

Justice は Worker model/provider を決定しない。

### INV-03

```text
Plan approval survives multiple tasks
```

Plan authorization は one-shot ではない。

### INV-04

```text
Semantic plan mutation invalidates approval
```

承認後の Plan 意味変更を検出する。

### INV-05

```text
high complexity never silently downgrades
```

deep / architecture 等が low category へ silent downgrade されない。

### INV-06

```text
WorkerReported != TaskAccepted
```

Worker の完了報告だけでは Task completion としない。

### INV-07

```text
Declared evidence never satisfies required gates alone
```

自己申告だけでは Gate PASS としない。

### INV-08

```text
Gate PASS precedes progress completion
```

TaskAccepted より先に Plan を完了状態へ変更しない。

### INV-09

```text
Final Review precedes Plan Complete
```

Final Review / Final Gate 前に Plan 全体を Complete としない。

### INV-10

```text
Fail-open execution != fail-open acceptance
```

内部障害時に Runtime を継続できても、未検証状態を Accepted / Verified と偽らない。

---

# 16. 必須テストシナリオ

## Controller Routing

```text
brainstorming → Sisyphus
writing-plans → Sisyphus
SDD → Atlas
executing-plans → Sisyphus
```

Domain decision だけでなく Runtime 適用までテストする。

---

## Multi-Task Authorization

```text
Approve
→ Task 1
→ Task 2
→ Task 3
```

すべて同一 authorization で実行可能であること。

---

## Plan Mutation

```text
Approve
→ Plan semantic edit
→ fingerprint mismatch
→ invalidated
```

となること。

---

## Progress Mutation

```text
Approve
→ Task Accepted
→ progress updated
```

だけでは approval が失効しないこと。

---

## Category Routing

```text
deep → sp-deep
architecture → sp-architecture
```

を保証し、low category への downgrade が存在しないこと。

---

## Declared Evidence

Worker が、

```text
"All tests passed."
```

と返しただけでは、

```text
required-tests = PASS
```

にならないこと。

---

## Observed Evidence

実際の test command の observed result が success であり、必要な Evidence が揃った場合のみ required-tests Gate を PASS 可能であること。

---

## Transactional Completion

```text
Worker success
Gate FAIL
```

の場合、

```text
TaskAccepted = false
Plan progress = incomplete
```

であること。

---

## Final Completion

```text
All tasks accepted
BUT
Final Review missing
```

の場合、

```text
PlanComplete = false
```

であること。

---

# 17. 推奨実装境界

Core と Adapter の責務を以下のように維持する。

```text
Core
├── WorkflowRouter
├── ControllerRoutingDecision
├── ExecutionRoleClassifier
├── CategoryMapper
├── PlanAuthorization
├── PlanFingerprint
├── TaskLifecycle
├── EvidenceEngine
├── GateEngine
└── AcceptanceDecision

Adapter
├── OpenCode event translation
├── Runtime controller application
├── task() payload enrichment
├── execution observation
└── persistence integration
```

Core は OpenCode / OmO API に依存してはならない。

---

# 18. 推奨実装順序

4項目すべて P0 とするが、変更リスクを抑えるため以下の順序を推奨する。

### Phase 1 — Category Correctness

`deep` / `architecture` を含む category mapping を完全化し、silent downgrade を除去する。

### Phase 2 — Plan Authorization

one-shot authorization を PlanScopedAuthorization に置換する。

### Phase 3 — Transactional Acceptance

WorkerReported と TaskAccepted を分離し、

```text
Evidence
→ Review
→ Gate
→ Acceptance
→ Progress
```

を直列化する。

### Phase 4 — Controller Runtime Wiring

ControllerRoutingDecision が実際の Runtime controller selection に反映されることを保証する。

Phase 4 は OpenCode / OmO Runtime boundary への影響が最も大きいため、Core 上の routing model とは分離して実装・検証する。

---

# 19. Definition of Done

本要件は、以下すべてを満たした場合に完了とする。

1. Controller routing が Domain 上だけでなく Runtime 上でも成立している。
2. Approved Plan authorization が複数 Task に継続する。
3. Plan semantic mutation により authorization が失効する。
4. Execution progress 更新では authorization が誤失効しない。
5. 全 canonical execution role が明示的 category を持つ。
6. deep / architecture の silent downgrade が存在しない。
7. Justice が Worker model / provider / agent を指定しない。
8. Worker success と Task acceptance が別状態になっている。
9. Evidence → Review → Gate → Acceptance の順序が保証されている。
10. Gate PASS 前に Plan progress が完了状態にならない。
11. Declared evidence のみでは required Gate が PASS しない。
12. Final Review / Final Gate 前に Plan が Complete にならない。
13. 上記すべてについて automated test が存在する。
14. `justice doctor` が必要 category / configuration の不足を検出できる。
15. Justice の内部障害時にも、未検証の Task を Accepted と誤認しない。

---

# 20. 最終アーキテクチャ定義

本要件実装後の3層を以下のように定義する。

```text
┌─────────────────────────────────────┐
│ Superpowers                         │
│ Normative Development State Machine │
│                                     │
│ "どう開発されるべきか"              │
└──────────────────┬──────────────────┘
                   │ Desired semantics
                   ▼
┌─────────────────────────────────────┐
│ Justice                             │
│ Semantic Control Plane              │
│                                     │
│ Workflow routing                    │
│ Plan authorization                  │
│ Semantic category routing           │
│ Observation                         │
│ Evidence                            │
│ Gate                                │
│ Acceptance                          │
│                                     │
│ "正しく実行されているか"            │
└──────────────────┬──────────────────┘
                   │ Executable semantics
                   ▼
┌─────────────────────────────────────┐
│ Oh My OpenAgent                     │
│ Agent Execution Plane               │
│                                     │
│ Category dispatch                   │
│ Agent selection                     │
│ Model/provider routing              │
│ Tool execution                      │
│                                     │
│ "実際に仕事をする"                  │
└─────────────────────────────────────┘
```

したがって Justice の最終的な責務を以下の一文で定義する。

> **Justice is the Semantic Control Plane that preserves the correspondence between Superpowers' normative development workflow and OmO's actual agent execution, and proves task acceptance through observed evidence rather than agent claims.**

日本語では、

> **Justice は、Superpowers が定義する「正しい開発プロセス」と OmO が実際に行った Agent Execution の対応関係を維持し、その成立を Evidence に基づいて検証・承認する Semantic Control Plane である。**
