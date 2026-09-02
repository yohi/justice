# Justice — OMO × Superpowers Integration Requirements

## 1. 文書情報

**Project:** `yohi/justice`

**目的:**
Superpowersの開発ワークフローとOh My OpenAgent（OMO）のAgent / Category実行基盤を接続するsemantic routing layerを構築する。

### 基準リビジョン

| Component       | Baseline                                            |
| --------------- | --------------------------------------------------- |
| Justice         | `b23631760c3b70e543a8a5e89da47db5cd0cf3d6`          |
| Oh My OpenAgent | `09fe012d6fe223ba71ae352fabca38c8895f5ba8`          |
| Superpowers     | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` / v6.3.0 |

---

# 2. 背景

JusticeはすでにSuperpowersとOMOを接続する以下の機能を持っている。

```text
Superpowers
    ↓
PlanBridge
    ↓
CategoryClassifier
    ↓
AgentRouter
    ↓
TaskPackager
    ↓
OMO task()
```

既存実装には、

* Superpowers skillとOMO AgentのAffinity Matrix
* plan taskのcategory分類
* task package生成
* `task()` interception
* implementation approval
* Wisdom / Observation / Telemetry

などが存在する。

しかし現在の設計には、以下の問題がある。

1. planning workflowとexecution workflowの責務が曖昧。
2. Worker AgentをJusticeが直接選択する設計になっている。
3. `implementer-prompt → Hephaestus` のような過剰なAgent固定が存在する。
4. 未分類taskのdefaultが`deep`であり、高性能モデルへ過剰routingされる。
5. Justiceが分類したcategoryが実際のOMO task payloadへ十分強制されていない。
6. implementation authorizationがtask単位のone-shotであり、SDDの複数task executionと整合しない。
7. OMO側のmodel/provider変更とJusticeのrouting logicが結合する危険がある。

---

# 3. 目的

Justiceの責務を、

> **Superpowers上のworkflow / taskの意味を、OMOが理解できるController AgentまたはCategoryへ変換すること**

と明確化する。

最終的な責務分離は以下とする。

```text
┌─────────────────────────────┐
│ Superpowers                 │
│                             │
│ 開発方法論・Workflow・TDD    │
│ Plan・Review・Verification  │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ Justice                     │
│                             │
│ Workflow routing            │
│ Controller routing          │
│ Task semantic classification│
│ Category mapping             │
│ Approval / integrity         │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│ OMO                         │
│                             │
│ Agent runtime               │
│ Category dispatch            │
│ Model routing                │
│ Provider routing             │
│ Fallback                     │
└─────────────────────────────┘
```

---

# 4. 最重要設計原則

## R-001 ControllerとWorkerを完全に分離する

JusticeがAgentを選択してよいのは、**Workflow Controllerとして明示的なAgentが必要な場合のみ**とする。

一方、実装・review等のWorkerについてはJusticeがAgentを直接指定してはならない。

### Controller

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

### Worker

```text
mechanical
    → category = sp-mechanical

implementation
    → category = sp-implementation

integration
    → category = sp-integration

review
    → category = sp-review

final-review
    → category = sp-final-review
```

Workerについては、

```text
Agent
subagent_type
model
provider
variant
reasoning
```

をJusticeが指定してはならない。

---

# 5. R-002 Category-first Routing

Worker taskでは、**categoryを唯一のrouting authorityとする。**

Justiceは、

```json
{
  "category": "sp-implementation"
}
```

までを決定する。

Justiceは、

```json
{
  "category": "sp-implementation",
  "subagent_type": "sisyphus-junior"
}
```

のような指定をしてはならない。

OMOがcategoryに応じて適切なWorker Agent / modelを解決する。

したがって、

```text
Justice
  ↓
sp-implementation
  ↓
OMO
  ↓
category-defined execution path
  ↓
category-defined model
```

という責務分担とする。

---

# 6. R-003 Model / Provider Independence

Justiceのrouting logicは具体的なLLM model/providerから独立しなければならない。

Justice source code内に以下をrouting条件としてハードコードしてはならない。

```text
GPT-*
Kimi-*
Claude-*
Gemini-*
OpenAI
Ollama
OpenCode
Bedrock
Cloudflare
```

また、

```text
high
max
xhigh
medium
low
```

などのmodel-specific reasoning設定もJusticeの責務ではない。

---

# 7. R-004 OMO ConfigをModel RoutingのSSOTとする

以下の関係は`omo.jsonc`側で定義する。

```text
OMO Category
    ↓
LLM Model
    ↓
Variant / Reasoning
    ↓
Provider
    ↓
Fallback
```

Justiceはcategoryを指定するだけであり、そのcategoryがどのmodelを使用するかを知らなくても動作しなければならない。

これにより、

```text
sp-implementation → Luna
```

から、

```text
sp-implementation → Kimi
```

へ変更してもJusticeを変更する必要がない。

---

# 8. Semantic Execution Role

Justice内部ではOMO category名を直接business logicに埋め込みすぎず、semantic roleを定義する。

```ts
type ExecutionRole =
  | "mechanical"
  | "implementation"
  | "integration"
  | "review"
  | "final-review"
  | "deep"
  | "architecture";
```

その後、

```text
ExecutionRole
      ↓
OmoCategoryMapper
      ↓
OMO category
```

という変換を行う。

例:

```text
implementation
    ↓
sp-implementation
```

---

# 9. Superpowers専用Category

Justiceが利用する標準custom categoryは以下とする。

| Execution Role | OMO Category        |
| -------------- | ------------------- |
| mechanical     | `sp-mechanical`     |
| implementation | `sp-implementation` |
| integration    | `sp-integration`    |
| review         | `sp-review`         |
| final-review   | `sp-final-review`   |

これらの具体的modelはJusticeでは定義しない。

---

# 10. Task Classification Requirements

## FR-101 Mechanical

以下のtaskは`mechanical`へ分類する。

* exact code/valueがplanに明記されている
* rename
* typo
* constant変更
* boilerplate
* 単純なfield追加
* 単純な設定変更
* 判断をほぼ必要としないtest追加
* 1〜2 file程度の局所的変更

結果:

```text
mechanical
    ↓
sp-mechanical
```

---

## FR-102 Normal Implementation

通常のTDD implementation taskは、

```text
implementation
    ↓
sp-implementation
```

とする。

**通常taskのdefaultを`deep`にしてはならない。**

分類不能な通常taskについても原則として`implementation`へfallbackする。

---

## FR-103 Integration

以下を`integration`へ分類する。

* 複数module間の連携
* API / interface変更
* migration
* integration test
* state coordination
* concurrency
* async coordination
* moderately difficult debugging
* 複数component間の整合性判断

結果:

```text
integration
    ↓
sp-integration
```

単純にfile数だけで判定してはならない。

---

## FR-104 Deep

以下の場合のみ`deep`を使用する。

* 通常workerでは解決困難
* 根本原因が不明な難解debug
* broad codebase understandingが必要
* architecture-level judgmentが必要
* repeated fix failureによるescalation
* explicit deep request

`deep`は通常taskのdefaultではない。

---

## FR-105 Architecture

architecture/designそのものは通常のimplementation taskと区別する。

必要に応じてOMOのhigh-level categoryへmappingするが、Justiceが具体的modelを決定してはならない。

---

# 11. Workflow Routing

## FR-201 Brainstorming

Superpowers `brainstorming`はSisyphusをControllerとする。

```text
brainstorming
    ↓
Sisyphus
```

Atlasをdefault controllerとして使用しない。

---

## FR-202 Writing Plans

Superpowers `writing-plans`はSisyphusをControllerとする。

```text
writing-plans
    ↓
Sisyphus
```

既存のAtlas routingは廃止する。

---

## FR-203 Subagent-Driven Development

Superpowers `subagent-driven-development`はAtlasをControllerとする。

```text
approved plan
    ↓
Atlas
    ↓
worker tasks
```

Atlasはexecution conductorであり、Worker model selectorではない。

---

## FR-204 Executing Plans

`executing-plans`はSisyphusをControllerとする。

```text
executing-plans
    ↓
Sisyphus
```

以下の場合に利用する。

* task間のcouplingが強い
* subagent分割が不適切
* sequential executionが必要
* explicit execution request

---

# 12. Worker Dispatch

## FR-301 WorkerにはAgentを指定しない

JusticeがWorker taskをOMOへdelegateする場合、

```json
{
  "category": "sp-implementation"
}
```

を生成する。

以下は禁止する。

```json
{
  "category": "sp-implementation",
  "subagent_type": "sisyphus-junior"
}
```

または、

```json
{
  "subagent_type": "hephaestus"
}
```

などの直接Agent指定。

---

## FR-302 WorkerにはModelを指定しない

Justiceは以下をpayloadへ注入してはならない。

```text
model
variant
reasoning
provider
fallback_models
```

これらはOMO configの責務。

---

## FR-303 Controllerは明示可能

一方、Controllerとして実行する場合はAgentを明示してよい。

例:

```text
workflow = subagent-driven-development
controller = atlas
```

このAgent指定はworker routingとは別概念として扱う。

---

# 13. AgentRouter再設計

既存AgentRouterは**Worker Agent selectorからController Routerへ責務を縮小する。**

## 必須routing

| Workflow                    | Controller |
| --------------------------- | ---------- |
| brainstorming               | Sisyphus   |
| writing-plans               | Sisyphus   |
| subagent-driven-development | Atlas      |
| executing-plans             | Sisyphus   |

## Worker

WorkerについてAgentRouterはAgentを返さない。

```text
AgentRouter
    ↓
Controller Agent only
```

workerは、

```text
CategoryClassifier
    ↓
ExecutionRole
    ↓
OmoCategoryMapper
    ↓
OMO Category
```

という別経路にする。

---

# 14. Agent Type

Justice内部のAgent型はController用途と明示する。

```ts
type ControllerAgent =
  | "sisyphus"
  | "atlas"
  | "oracle"
  | "momus"
  | "hephaestus";
```

ただし、

```text
oracle
momus
hephaestus
```

を通常worker routingに使用することは禁止する。

必要な場合はexplicit high-level workflowまたはescalation policyから利用する。

---

# 15. Worker Routing Model

最終的なrouting decisionは以下のように分離する。

```ts
interface RoutingDecision {
  controller?: ControllerAgent;
  executionRole?: ExecutionRole;
  category?: string;
}
```

### Controller task

```text
controller = atlas
executionRole = undefined
category = undefined
```

### Worker task

```text
controller = undefined
executionRole = implementation
category = sp-implementation
```

**Worker taskにcontroller Agentを同時指定しない。**

---

# 16. Fix-loop Escalation

Superpowers SDDのfix loopに合わせてsemantic tierを上げる。

標準:

```text
Round 1
same role

Round 2
same role

Round 3
same role

Round 4
one tier up

Round 5
one tier up / deep
```

例:

```text
sp-mechanical
    ↓
sp-implementation
    ↓
sp-integration
    ↓
deep
```

Justiceは、

```text
Round 4 → GPT-5.6 Terra
```

のようなmodel-specific escalationを行わない。

**semantic categoryだけを変更する。**

---

# 17. Review Routing

## FR-501 Task Review

実装後のtask review:

```text
review
    ↓
sp-review
```

reviewerにspecific Agentを指定しない。

---

## FR-502 Final Review

branch全体のfinal review:

```text
final-review
    ↓
sp-final-review
```

とする。

task reviewとfinal reviewを同一categoryにしない。

---

# 18. TDD Responsibility

TDDそのものはSuperpowersの責務とする。

Justiceは、

```text
RED
↓
GREEN
↓
REFACTOR
↓
VERIFY
```

を独自実装しない。

JusticeはTDD workflowを尊重し、その中で生成されるimplementation taskをsemantic categoryへroutingする。

---

# 19. SDD Responsibility

SDDの、

* plan
* task decomposition
* ledger
* progress
* batching
* review
* fix loop

はSuperpowersをSSOTとする。

Justiceはこれらを独自に再実装しない。

Justiceは、

```text
Superpowers task
    ↓
semantic classification
    ↓
OMO category
```

を担当する。

---

# 20. Plan Authorization

## FR-601 Plan-scoped Authorization

現在のone-shot authorizationを廃止する。

変更後:

```text
/justice-implement --approved
        ↓
approved plan
        ↓
plan-scoped authorization
        ↓
Task 1
Task 2
Task 3
...
Final review
        ↓
authorization released
```

---

## FR-602 Authorization Binding

authorizationは最低限、

```text
sessionId
planPath
planFingerprint
```

へbindする。

---

## FR-603 Plan Mutation

承認後にplanが変更された場合、

```text
fingerprint mismatch
    ↓
authorization invalid
```

とする。

再承認を要求する。

---

## FR-604 Continuous Execution

同一approved planのtaskごとに再承認を要求してはならない。

Superpowers SDDが継続的にtaskを処理できるようにする。

---

# 21. Task Payload Normalization

JusticeはOMOのcanonical task payloadへ正規化する。

最低限、

```json
{
  "category": "sp-implementation",
  "task_id": "...",
  "load_skills": ["..."]
}
```

を生成できること。

旧形式:

```text
taskId
loadSkills
```

を受け取った場合も内部でcanonical formへnormalizeしてよい。

---

# 22. Category / subagent_type Mutual Exclusivity

Worker category dispatch時、

```text
category != undefined
subagent_type == undefined
```

を保証する。

以下はinvalid:

```json
{
  "category": "sp-implementation",
  "subagent_type": "..."
}
```

理由は、categoryがmodel-routing authorityであり、Worker Agentを別途指定するとOMOのcategory routingを意図せずoverrideする可能性があるため。

---

# 23. Custom Category Fallback

Justiceはcustom categoryの存在をdoctorで検証する。

推奨fallback:

| Custom Category     | Fallback           |
| ------------------- | ------------------ |
| `sp-mechanical`     | `quick`            |
| `sp-implementation` | `unspecified-low`  |
| `sp-integration`    | `unspecified-high` |
| `sp-review`         | `unspecified-high` |
| `sp-final-review`   | `ultrabrain`       |

fallbackでもJusticeはmodel/providerを指定しない。

```text
sp-implementation unavailable
        ↓
unspecified-low
```

までをmappingとして扱う。

---

# 24. Doctor / Contract Validation

Justice doctorは以下を検証する。

## OMO

* required custom categories
* canonical task fields
* category dispatch support
* category/subagent mutual exclusivity

## Superpowers

* brainstorming
* writing-plans
* subagent-driven-development
* executing-plans
* test-driven-development
* verification-before-completion

## Version

以下を記録する。

```text
Justice commit
OMO commit
Superpowers version/commit
```

---

# 25. Upstream Drift

JusticeはSuperpowers / OMOのinternal implementation detailへ過度に依存してはならない。

依存してよいもの:

```text
workflow semantics
skill names
category dispatch contract
task payload contract
```

避けるもの:

```text
private function
prompt本文の特定行
internal variable name
unofficial implementation detail
```

upstream更新時はdoctor / regression testでdriftを検出する。

---

# 26. Observability

各routing decisionについて最低限以下を記録する。

```text
workflow
plan
task
executionRole
category
controller
routingReason
fixRound
fallback
```

`model` / `provider`を取得できる場合はobservability目的で記録してよい。

ただしrouting decisionには使用しない。

---

# 27. Routing Reason

routing decisionには機械可読な理由を持たせる。

```ts
type RoutingReason =
  | "workflow_rule"
  | "task_classification"
  | "review_role"
  | "fix_escalation"
  | "explicit_request"
  | "compatibility_fallback";
```

---

# 28. Safety Boundary

Justiceは以下をhard stop対象とする。

* destructive operation
* irreversible operation
* security-sensitive operation
* shared branchへの危険なpublish/merge
* authorization mismatch
* plan fingerprint mismatch

一方、通常のtask ambiguityについてはSuperpowers側のruling / controllerに委譲する。

---

# 29. Acceptance Criteria

## AC-01 Brainstorming

```text
brainstorming
→ Sisyphus
```

---

## AC-02 Writing Plans

```text
writing-plans
→ Sisyphus
```

---

## AC-03 SDD

```text
subagent-driven-development
→ Atlas
```

---

## AC-04 Executing Plans

```text
executing-plans
→ Sisyphus
```

---

## AC-05 Normal TDD

```text
normal implementation
→ sp-implementation
```

`deep`へroutingされない。

---

## AC-06 Mechanical

```text
mechanical task
→ sp-mechanical
```

---

## AC-07 Integration

```text
integration task
→ sp-integration
```

---

## AC-08 Review

```text
task review
→ sp-review
```

---

## AC-09 Final Review

```text
branch review
→ sp-final-review
```

---

## AC-10 No Worker Agent

Worker taskに、

```text
subagent_type
agent
```

が設定されていない。

---

## AC-11 No Model Coupling

Justice source codeに具体的model/providerを使ったrouting logicが存在しない。

---

## AC-12 Category Payload

OMO task payloadに、

```json
{
  "category": "sp-implementation"
}
```

が実際に渡される。

---

## AC-13 Category Controls Model

Justiceがmodelを知らなくても、OMO configのcategory変更だけでWorker modelを変更できる。

---

## AC-14 Fix Escalation

```text
Round 1–3
same category

Round 4
tier up

Round 5
further tier up / deep
```

---

## AC-15 Plan Authorization

一度approvedになったplanは、同一fingerprintの範囲で複数taskを継続実行できる。

---

## AC-16 Plan Mutation

approved後にplanを変更するとauthorizationがinvalidになる。

---

# 30. テスト要件

## Unit

```text
ExecutionRoleClassifier
WorkflowRouter
ControllerAgentRouter
OmoCategoryMapper
TaskPayloadNormalizer
FixEscalationPolicy
PlanAuthorization
PlanFingerprint
```

## Integration

```text
brainstorming → Sisyphus

writing-plans → Sisyphus

subagent-driven-development → Atlas

normal task → sp-implementation

mechanical task → sp-mechanical

integration task → sp-integration

review → sp-review

final review → sp-final-review

category unavailable → fallback category

category + subagent_type → rejected/normalized

approved plan → multiple task()

plan mutation → authorization invalid
```

## Regression

既存の、

```text
Wisdom
Observation
Telemetry
Compaction protection
Loop detection
PlanBridge
Implementation approval
```

を破壊しない。

---

# 31. 主な実装対象

既存構造を活用し、新しいOMO↔Superpowers adapterを別途作らない。

主な変更対象:

```text
src/core/types.ts
src/core/agent-router.ts
src/core/category-classifier.ts
src/core/task-packager.ts
src/core/workflow-directives.ts
src/hooks/plan-bridge.ts
src/core/doctor-*
```

既存のPlanBridge / CategoryClassifier / AgentRouter / TaskPackagerをリファクタリングして実現する。

---

# 32. 最終アーキテクチャ

```text
                     Superpowers
                          │
          ┌───────────────┴────────────────┐
          │                                │
       Planning                         Execution
          │                                │
          ▼                                ▼
      Sisyphus                           Atlas
          │                                │
          │                     ┌──────────┼──────────┐
          │                     │          │          │
          │                     ▼          ▼          ▼
          │                 mechanical implementation integration
          │                     │          │          │
          │                     ▼          ▼          ▼
          │                 sp-mechanical sp-implementation sp-integration
          │                                │
          │                                │
          └────────────────────────────────┤
                                           ▼
                                      OMO Category
                                           │
                                           ▼
                                  OMO-defined Worker
                                           │
                                           ▼
                                  OMO-defined LLM
```

---

# 33. 責務分担の最終原則

Justiceの設計上、以下を厳守する。

### Superpowers

```text
「どう開発するか」
```

### Justice

```text
「これは何の仕事か」
「どのControllerでworkflowを動かすか」
「どのsemantic categoryへ送るか」
```

### OMO

```text
「そのcategoryをどう実行するか」
```

### omo.jsonc

```text
「そのcategoryでどのLLM/providerを使うか」
```

したがって、最も重要な不変条件は、

```text
                    Controller
                        ↓
                 Justiceが選択可能

Worker
  ↓
JusticeはAgentを選択しない
  ↓
Categoryだけ指定
  ↓
OMOがWorker execution pathを解決
  ↓
omo.jsoncがmodel/providerを解決
```

とすることである。

**Justiceは「Sisyphus-Juniorを使う」と知る必要すらない。**

Justiceに必要なのは、

```text
normal implementation
    → sp-implementation
```

というsemantic routingだけであり、

```text
sp-implementation
    → Sisyphus-Junior
    → Luna/max
    → Cloudflare/OpenAI/その他
```

は完全にOMO側の責務とする。

これをJusticeとOMOの**契約境界（Contract Boundary）**として固定する。
