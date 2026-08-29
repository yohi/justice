# Justice Routing Core 再設計書

## 0. メタ情報

| 項目 | 値 |
|------|-----|
| 作成日 | 2026-08-29 |
| 対象 | Justice v3 routing core（Controller routing + Worker category mapping） |
| 起点コミット | `b23631760c3b70e543a8a5e89da47db5cd0cf3d6` |
| 関連要件 | `REQUIREMENTS_2026-08-29.md` |
| 次工程 | `superpowers/writing-plans` |

## 1. 目的とスコープ

本設計書は、Justice が Superpowers の開発ワークフローと Oh My OpenAgent（OMO）の実行基盤を接続する semantic routing layer を、以下の原則に沿って再設計することを目的とする。

- **Controller と Worker を完全に分離する**: Justice は Controller Agent の選択だけを行い、Worker Agent は指定しない。
- **Category-first Routing**: Worker task では `category` を唯一の routing authority とする。
- **Model / Provider Independence**: Justice source code 内に具体的な LLM model 名や provider 名をハードコードしない。
- **OMO Config を SSOT とする**: カテゴリ → model/provider の対応は `omo.jsonc` 側で定義する。

### 1.1 本 PR のスコープ

本 PR では以下のみを対象とする。

- Controller routing: `brainstorming` / `writing-plans` / `subagent-driven-development` / `executing-plans`
- Worker semantic role classification: `mechanical` / `implementation` / `integration` / `review` / `final-review`
- OMO category mapping: `sp-mechanical` / `sp-implementation` / `sp-integration` / `sp-review` / `sp-final-review`
- Task payload normalization: category のみを注入し、subagent_type / agent / model / provider / variant / reasoning は注入しない
- Category / subagent_type mutual exclusivity の保証

### 1.2 本 PR のスコープ外（後続 PR）

- Plan-scoped authorization（§20 / FR-601〜604）
- Doctor / contract validation（§24）
- Observability / routing reason enrichment（§26〜27）
- Fix-loop escalation policy（§16）

## 2. 用語定義

| 用語 | 意味 |
|------|------|
| Controller Agent | Superpowers workflow を司る高次 Agent。Justice が選択可能。 |
| Worker | 実装・review・integration 等の具体的作業を行う実行単位。Justice は Agent を指定せず category のみを指定する。 |
| ExecutionRole | Justice 内部の semantic な役割。`mechanical` / `implementation` / `integration` / `review` / `final-review` / `deep` / `architecture` 等。 |
| SpCategory | Superpowers 専用の OMO custom category。`sp-mechanical` / `sp-implementation` / `sp-integration` / `sp-review` / `sp-final-review`。 |
| TaskCategory | OMO 標準 category。`deep` / `quick` / `unspecified-low` / `unspecified-high` / `visual-engineering` / `ultrabrain` / `writing` 等。 |
| RoutingDecision | 1 つの task/workflow に対する routing 結果。`controller?: ControllerAgent`、`executionRole?: ExecutionRole`、`category?: string`。 |

## 3. 最終アーキテクチャ

```text
                     Superpowers
                          │
           ┌──────────────┴───────────────┐
           │                              │
        Planning                        Execution
           │                              │
           ▼                              ▼
       Sisyphus                         Atlas
           │                              │
           │                   ┌──────────┼──────────┐
           │                   │          │          │
           │                   ▼          ▼          ▼
           │               mechanical implementation integration
           │                   │          │          │
           │                   ▼          ▼          ▼
           │               sp-mechanical sp-implementation sp-integration
           │                              │
           │                              │
           └──────────────────────────────┤
                                            ▼
                                       OMO Category
                                            │
                                            ▼
                                   OMO-defined Worker
                                            │
                                            ▼
                                   OMO-defined LLM
```

## 4. 責務分担

| 層 | 責務 |
|----|------|
| Superpowers | 「どう開発するか」。workflow・TDD・plan・review・verification。 |
| Justice | 「これは何の仕事か」「どの Controller で workflow を動かすか」「どの semantic category へ送るか」。 |
| OMO | 「その category をどう実行するか」。Agent dispatch・model routing・fallback。 |
| `omo.jsonc` | 「その category でどの LLM / provider を使うか」。 |

## 5. 型設計

### 5.1 Controller Agent

```ts
export type ControllerAgent = "sisyphus" | "atlas" | "oracle" | "momus" | "hephaestus";
```

ただし `oracle` / `momus` / `hephaestus` は通常の Worker routing には使用禁止とする。必要な場合は explicit high-level workflow または escalation policy から利用する。

### 5.2 Execution Role

```ts
export type ExecutionRole =
  | "mechanical"
  | "implementation"
  | "integration"
  | "review"
  | "final-review"
  | "deep"
  | "architecture";
```

本 PR の Worker routing スコープ内で `sp-*` category へ直接マップされるのは `mechanical` / `implementation` / `integration` / `review` / `final-review` の 5 つとする。`deep` / `architecture` は Worker 汎用カテゴリまたは Controller / high-level workflow 経由で扱うため、`OmoCategoryMapper.map` からは `undefined` を返し、呼び出し元で fallback または escalation / Controller routing を選択する契約とする（§9 参照）。

```ts
export type ExecutionRole =
  | "mechanical"
  | "implementation"
  | "integration"
  | "review"
  | "final-review"
  | "deep"
  | "architecture";
```

### 5.3 Superpowers Category

```ts
export type SpCategory =
  | "sp-mechanical"
  | "sp-implementation"
  | "sp-integration"
  | "sp-review"
  | "sp-final-review";
```

`SpCategory` は OMO 側で定義される Superpowers 専用 custom category とし、本 PR では上記 5 つのみを定義する。将来の拡張は `SpCategory` union を拡張する形で行う。

```ts
export type SpCategory =
  | "sp-mechanical"
  | "sp-implementation"
  | "sp-integration"
  | "sp-review"
  | "sp-final-review";
```

### 5.4 Routing Decision

```ts
export type RoutingDecision =
  | {
      readonly kind: "controller";
      readonly controller: ControllerAgent;
      readonly reason: RoutingReason;
    }
  | {
      readonly kind: "worker";
      readonly executionRole: ExecutionRole;
      readonly category: SpCategory | TaskCategory;
      readonly reason: RoutingReason;
    }
  | {
      readonly kind: "unrouted";
      readonly reason: RoutingReason;
    };

export type RoutingReason =
  | "workflow_rule"
  | "task_classification"
  | "review_role"
  | "fix_escalation"
  | "explicit_request"
  | "compatibility_fallback";
```

Controller task と Worker task は `kind` によって排他的に表現する。`controller` では `controller` のみ、`worker` では `executionRole` と `category` のみを持ち、`unrouted` では routing 情報を一切持たない。`RoutingDecision` を生成する factory は、各 `kind` に対応する専用関数を提供し、受け取った引数の組み合わせが上記契約に違反しないことを実行時にも検証する。違反時はエラーを投げ、不正な組み合わせの RoutingDecision を生成しない。

factory 例:

```ts
export function createControllerRoutingDecision(
  controller: ControllerAgent,
  reason: RoutingReason,
): RoutingDecision;

export function createWorkerRoutingDecision(
  executionRole: ExecutionRole,
  category: SpCategory | TaskCategory,
  reason: RoutingReason,
): RoutingDecision;

export function createUnroutedRoutingDecision(
  reason: RoutingReason,
): RoutingDecision;
```

Worker factory における `executionRole` → `category` のマッピング責務は `OmoCategoryMapper` が担う。factory は正しい組み合わせを受け取るだけで、マッピングの正しさまで検証しない。

```ts
export interface RoutingDecision {
  readonly controller?: ControllerAgent;
  readonly executionRole?: ExecutionRole;
  readonly category?: SpCategory | TaskCategory;
  readonly reason: RoutingReason;
}

export type RoutingReason =
  | "workflow_rule"
  | "task_classification"
  | "review_role"
  | "fix_escalation"
  | "explicit_request"
  | "compatibility_fallback";
```

Controller task と Worker task は同時に指定しない。

- Controller task: `controller` のみ設定
- Worker task: `executionRole` + `category` のみ設定

## 6. 新規・変更モジュール

### 6.1 新規モジュール

| ファイル | 責務 |
|----------|------|
| `src/core/workflow-router.ts` | workflow 名 → ControllerAgent の解決。 |
| `src/core/execution-role-classifier.ts` | `PlanTask` → `ExecutionRole` の分類。 |
| `src/core/omo-category-mapper.ts` | `ExecutionRole` → `SpCategory` の写像。 |
| `src/core/routing-decision.ts` | `RoutingDecision` 型と factory。 |

### 6.2 変更モジュール

| ファイル | 変更内容 |
|----------|----------|
| `src/core/types.ts` | `ControllerAgent`, `ExecutionRole`, `SpCategory`, `RoutingDecision`, `RoutingReason` を追加。`RoutingDecision` は排他的な判別共用体とする。`TaskCategory` の標準値は据え置き、`RoutingDecision.category` / `DelegationRequest.category` には `SpCategory | TaskCategory` の union を使用し、OMO custom category 受け入れを型で許容する。 |
| `src/core/agent-router.ts` | Worker Agent 選択機能を削除し、workflow 名から ControllerAgent を返す Controller Router に再構成する。 |
| `src/core/category-classifier.ts` | 既存の keyword ベース分類を `ExecutionRoleClassifier` へ委譲しつつ、互換性を保つ薄いラッパーにする。 |
| `src/core/task-packager.ts` | Worker task の `category` のみを出力。`agentId`, `rolePrompt`, `routingCategory` 等を削除。 |
| `src/core/plan-bridge-core.ts` | Worker path では `category` のみ、Controller path では `controller` のみを返す。 |
| `src/hooks/plan-bridge.ts` | `handlePreToolUse` で `category` を正規化注入し、`subagent_type` / `agent` / `model` / `provider` / `variant` / `reasoning` を OMO wire payload から除去。内部 metadata としての `agentId` / `context.taskId` は保持する。 |
| `src/index.ts` | 新規 export を追加。 |

| ファイル | 変更内容 |
|----------|----------|
| `src/core/types.ts` | `ControllerAgent`, `ExecutionRole`, `SpCategory`, `RoutingDecision`, `RoutingReason` を追加。`TaskCategory` は据え置き。 |
| `src/core/agent-router.ts` | Worker Agent 選択機能を削除し、workflow 名から ControllerAgent を返す Controller Router に再構成する。 |
| `src/core/category-classifier.ts` | 既存の keyword ベース分類を `ExecutionRoleClassifier` へ委譲しつつ、互換性を保つ薄いラッパーにする。 |
| `src/core/task-packager.ts` | Worker task の `category` のみを出力。`agentId`, `rolePrompt`, `routingCategory` 等を削除。 |
| `src/core/plan-bridge-core.ts` | Worker path では `category` のみ、Controller path では `controller` のみを返す。 |
| `src/hooks/plan-bridge.ts` | `handlePreToolUse` で `category` を正規化注入し、`subagent_type` / `agent` / `model` / `provider` / `variant` / `reasoning` を除去。 |
| `src/index.ts` | 新規 export を追加。 |

## 7. Controller Routing

| Workflow | Controller |
|----------|------------|
| `brainstorming` | `sisyphus` |
| `writing-plans` | `sisyphus` |
| `subagent-driven-development` | `atlas` |
| `executing-plans` | `sisyphus` |

`WorkflowRouter` は以下のインターフェースを持つ。

```ts
export class WorkflowRouter {
  resolveController(workflow: string): ControllerAgent | undefined;
  isKnownWorkflow(workflow: string): boolean;
}
```

未知の workflow は `undefined` を返し、呼び出し元が fallback 方針（現状維持または `sisyphus`）を決定する。

## 8. Worker Classification

分類は以下の優先順位で行う。

1. **Integration 条件（§8.3）**: 該当する場合は `integration` とする。mechanical 条件が同時に当てはまっても integration を優先する。
2. **Deep 条件（§8.4）**: Worker 汎用ルーティングでは解決困難な場合。通常の局所 task では使用しない。
3. **Architecture 条件（§8.5）**: design / architecture そのもの。通常 Worker routing には使用せず、Controller / high-level workflow 経由とする。
4. **Mechanical 条件（§8.1）**: integration 条件に該当しない、局所的・定型的な変更。
5. **Implementation fallback（§8.2）**: 上記いずれにも該当しない通常 task。

### 8.1 Mechanical

以下の task は `mechanical` とする。

- exact code/value が plan に明記されている
- rename / typo / constant 変更
- boilerplate / 単純な field 追加 / 単純な設定変更
- 判断をほぼ必要としない test 追加
- 1〜2 file 程度の局所的変更

ただし、上記に当てはまりつつも §8.3 の integration 条件（API/interface 変更、複数 module 間連携、state coordination、複数 component 間の整合性判断など）を満たす場合は `integration` とする。

→ `sp-mechanical`

### 8.2 Normal Implementation

通常の TDD implementation task は `implementation` とする。分類不能な通常 task も原則 `implementation` へ fallback する。

→ `sp-implementation`

### 8.3 Integration

以下を `integration` とする。

- API / interface 変更
- 複数 module 間の連携
- migration / integration test
- state coordination / concurrency / async coordination
- moderately difficult debugging
- 複数 component 間の整合性判断

→ `sp-integration`

### 8.4 Deep

以下の場合のみ `deep` を使用する。

- 通常 Worker では解決困難
- 根本原因が不明な難解 debug
- broad codebase understanding が必要
- architecture-level judgment が必要
- repeated fix failure による escalation
- explicit deep request

`deep` は通常 task の default ではない。`deep` ExecutionRole は本 PR の `sp-*` マッピング対象外とし、`OmoCategoryMapper.map` からは `undefined` を返す。呼び出し元は `TaskCategory` の `deep` への fallback、または Controller / escalation policy 経由の扱いを選択する。

### 8.5 Architecture

architecture / design そのものは通常の implementation task と区別する。`architecture` ExecutionRole も本 PR の `sp-*` マッピング対象外とし、`OmoCategoryMapper.map` からは `undefined` を返す。必要に応じて OMO の high-level category へ mapping するが、Justice は具体的 model を決定しない。通常の Worker routing では使用禁止とし、Controller routing または explicit high-level workflow / escalation policy から利用する。

### 8.1 Mechanical

以下の task は `mechanical` とする。

- exact code/value が plan に明記されている
- rename / typo / constant 変更
- boilerplate / 単純な field 追加 / 単純な設定変更
- 判断をほぼ必要としない test 追加
- 1〜2 file 程度の局所的変更

→ `sp-mechanical`

### 8.2 Normal Implementation

通常の TDD implementation task は `implementation` とする。分類不能な通常 task も原則 `implementation` へ fallback する。

→ `sp-implementation`

### 8.3 Integration

以下を `integration` とする。

- 複数 module 間の連携
- API / interface 変更
- migration / integration test
- state coordination / concurrency / async coordination
- moderately difficult debugging
- 複数 component 間の整合性判断

→ `sp-integration`

### 8.4 Deep

以下の場合のみ `deep` を使用する。

- 通常 Worker では解決困難
- 根本原因が不明な難解 debug
- broad codebase understanding が必要
- architecture-level judgment が必要
- repeated fix failure による escalation
- explicit deep request

`deep` は通常 task の default ではない。

### 8.5 Architecture

architecture / design そのものは通常の implementation task と区別する。必要に応じて OMO の high-level category へ mapping するが、Justice は具体的 model を決定しない。

## 9. OMO Category Mapping

| ExecutionRole | SpCategory |
|---------------|------------|
| `mechanical` | `sp-mechanical` |
| `implementation` | `sp-implementation` |
| `integration` | `sp-integration` |
| `review` | `sp-review` |
| `final-review` | `sp-final-review` |
| `deep` | undefined（Worker sp-* スコープ外） |
| `architecture` | undefined（Worker routing 禁止） |

`OmoCategoryMapper` は上記の写像を提供する。future に追加の ExecutionRole やカスタムマッピングが必要になった場合は、ここを拡張する。

```ts
export class OmoCategoryMapper {
  /**
   * Worker-scoped ExecutionRole を SpCategory へ写像する。
   * `deep` / `architecture` は SpCategory への対応が定義されていないため `undefined` を返す。
   * 呼び出し元は `undefined` に対して `TaskCategory` への fallback、
   * Controller routing、または escalation policy を適用する契約とする。
   */
  map(role: ExecutionRole): SpCategory | undefined;
  isSpCategory(value: string): value is SpCategory;
}
```

| ExecutionRole | SpCategory |
|---------------|------------|
| `mechanical` | `sp-mechanical` |
| `implementation` | `sp-implementation` |
| `integration` | `sp-integration` |
| `review` | `sp-review` |
| `final-review` | `sp-final-review` |

`OmoCategoryMapper` は上記の写像を提供する。future に追加の ExecutionRole やカスタムマッピングが必要になった場合は、ここを拡張する。

```ts
export class OmoCategoryMapper {
  map(role: ExecutionRole): SpCategory;
  isSpCategory(value: string): value is SpCategory;
}
```

## 10. Task Payload Normalization

Justice は OMO の canonical task payload へ正規化する。Worker task では最低限以下を生成する。

```json
{
  "category": "sp-implementation",
  "taskId": "...",
  "loadSkills": ["..."]
}
```

旧形式 `taskId` / `loadSkills` を受け取った場合も内部で canonical form へ normalize する。ただし、OMO top-level の `taskId` は OMO 実行基盤が管理する識別子であり、Justice は `DelegationRequest` 内部で使用する `taskId` や `context.taskId` をそれに置き換えない。`TaskPackager` が生成する `DelegationRequest` に含まれる `taskId` / `loadSkills` と、OMO wire payload の `taskId` / `loadSkills` は区別し、変換時に DelegationRequest context が失われないよう adapter で管理する。

Worker task の payload には以下を**含めない**。

- `subagent_type`
- `agent`
- `model`
- `variant`
- `reasoning`
- `provider`
- `fallback_models`

### 10.1 DelegationRequest と OMO Payload の境界

`TaskPackager.package()` は Justice 内部で使用する `DelegationRequest` を生成する。`DelegationRequest` は以下のフィールドを持つ。

```ts
interface DelegationRequest {
  readonly category: SpCategory | TaskCategory;
  readonly taskId: string;
  readonly loadSkills: readonly string[];
  readonly prompt: string;
  readonly runInBackground: boolean;
  readonly context?: {
    readonly taskId?: string;
  };
}
```

`PlanBridge.handlePreToolUse` は `DelegationRequest` を OMO wire payload `OmoTaskPayload` へ変換する。変換ルールは以下の通り。

| DelegationRequest | OmoTaskPayload | 保存条件 |
|-------------------|----------------|----------|
| `category` | `category` | 常に保持 |
| `taskId` | `taskId` | OMO 実行基盤用 ID として保持 |
| `loadSkills` | `loadSkills` | 常に保持 |
| `prompt` | `prompt` | 常に保持 |
| `runInBackground` | `runInBackground` | 常に保持 |
| `context.taskId` | （内部 metadata として保持、wire payload には含めない） | Justice 内部追跡用 |

OMO top-level の `taskId` / `loadSkills` 変換は DelegationRequest の `taskId` / `loadSkills` を置き換えるのではなく、OMO 実行基盤が要求する形式へ adapter が通過させるだけとする。Justice 内部の `context.taskId` は別途保持し、loop detection / wisdom namespace / 観測ログで使用する。

Justice は OMO の canonical task payload へ正規化する。Worker task では最低限以下を生成する。

```json
{
  "category": "sp-implementation",
  "taskId": "...",
  "loadSkills": ["..."]
}
```

旧形式 `taskId` / `loadSkills` を受け取った場合も内部で canonical form へ normalize する。

Worker task の payload には以下を**含めない**。

- `subagent_type`
- `agent`
- `model`
- `variant`
- `reasoning`
- `provider`
- `fallback_models`

## 11. Category / subagent_type Mutual Exclusivity

Worker category dispatch 時、以下を保証する。

```text
category != undefined
subagent_type == undefined
```

PlanBridge の `handlePreToolUse` で、toolInput に `subagent_type` または `agent` が含まれる場合は除去する。`category` が既に存在する場合はそれを尊重する（任意の `TaskCategory` / `SpCategory` を許容）。存在しない場合は PlanBridge が決定した `SpCategory` を注入する。いずれの場合も `category` と `subagent_type` / `agent` が同時に存在しないことを保証する。

正規化経路を以下のように仕様化する。

1. `buildDelegationFromPlan(planTask, options)` で `options.category` を受け取る。`options.category` は `toolInput.category` を `SpCategory | TaskCategory` へ正規化した値とする。
2. `options.category` が指定されている場合はそれを採用する。未指定の場合は `PlanBridgeCore` の `ExecutionRoleClassifier` 結果から `ExecutionRole` を決定し、`OmoCategoryMapper.map` で `SpCategory` を解決して `initialDelegation.category` として設定する。`deep` / `architecture` など `undefined` を返す role の場合は、別途定めた fallback / escalation / Controller routing 契約に従う。
3. `agentRouter.route(routingDecision)` は `RoutingDecision` を受け取り、Controller / Worker / unrouted を分岐する。Worker の場合は `RoutingDecision.category` を OMO payload の `category` として使用する。
4. `enrichTaskToolInput(toolInput, routingDecision)` は `toolInput.category` が存在すればそれを保持し、存在しなければ `routingDecision.category` を注入する。`subagent_type` / `agent` / `model` / `provider` / `variant` / `reasoning` はこの段階で除去する。最終的な OMO payload の `category` と `RoutingDecision.category` / `DelegationRequest.category` は一致させる。

Worker category dispatch 時、以下を保証する。

```text
category != undefined
subagent_type == undefined
```

PlanBridge の `handlePreToolUse` で、toolInput に `subagent_type` または `agent` が含まれる場合は除去する。`category` が既に存在する場合はそれを尊重する（任意の `TaskCategory` を許容）。存在しない場合は PlanBridge が決定した `SpCategory` を注入する。いずれの場合も `category` と `subagent_type` / `agent` が同時に存在しないことを保証する。

## 12. Custom Category Fallback

OMO 側で `sp-*` category が未定義の場合の推奨 fallback は以下とする。

| SpCategory | Fallback |
|------------|----------|
| `sp-mechanical` | `quick` |
| `sp-implementation` | `unspecified-low` |
| `sp-integration` | `unspecified-high` |
| `sp-review` | `unspecified-high` |
| `sp-final-review` | `ultrabrain` |

ただし fallback でも Justice は model / provider を指定しない。fallback 先はあくまで `TaskCategory` として扱われ、`RoutingDecision.category` / `DelegationRequest.category` の型は `SpCategory | TaskCategory` を維持する。

OMO 側で `sp-*` category が未定義の場合の推奨 fallback は以下とする。

| SpCategory | Fallback |
|------------|----------|
| `sp-mechanical` | `quick` |
| `sp-implementation` | `unspecified-low` |
| `sp-integration` | `unspecified-high` |
| `sp-review` | `unspecified-high` |
| `sp-final-review` | `ultrabrain` |

ただし fallback でも Justice は model / provider を指定しない。

## 13. 既存機能の後方互換

以下の既存機能を本 PR で破壊しない。

- Wisdom / Observation / Telemetry
- Compaction protection
- Loop detection
- PlanBridge の workflow bootstrap
- Implementation approval（one-shot のまま、plan-scoped authorization は後続 PR で置き換え）

### 14.1 Unit Tests

| 対象 | 内容 |
|------|------|
| `WorkflowRouter` | 各 workflow → ControllerAgent の対応 |
| `ExecutionRoleClassifier` | keyword / step 数に基づく分類 |
| `OmoCategoryMapper` | role → `SpCategory` の写像、および `deep` / `architecture` の `undefined` 返却 |
| `TaskPackager`（正規化後） | `category` のみ注入、禁止フィールド除去 |
| `AgentRouter`（再構成後） | Controller 解決、Worker 解決不可 |
| `RoutingDecision` factory | 各 `kind` の生成、不正な組み合わせの拒否 |
| `ExecutionRoleClassifier` boundary | mechanical と integration の重複条件における優先順位 |

### 14.1 Unit Tests

| 対象 | 内容 |
|------|------|
| `WorkflowRouter` | 各 workflow → ControllerAgent の対応 |
| `ExecutionRoleClassifier` | keyword / step 数に基づく分類 |
| `OmoCategoryMapper` | role → `SpCategory` の写像 |
| `TaskPackager`（正規化後） | `category` のみ注入、禁止フィールド除去 |
| `AgentRouter`（再構成後） | Controller 解決、Worker 解決不可 |

### 14.2 Integration Tests

| 対象 | 内容 |
|------|------|
| `brainstorming` | → `sisyphus` |
| `writing-plans` | → `sisyphus` |
| `subagent-driven-development` | → `atlas` |
| `executing-plans` | → `sisyphus` |
| normal task | → `sp-implementation` |
| mechanical task | → `sp-mechanical` |
| integration task | → `sp-integration` |
| review | → `sp-review` |
| final review | → `sp-final-review` |
| `category` + `subagent_type` | `subagent_type` 除去 |

| リスク | 対策 |
|--------|------|
| 既存テストが `AgentRouter` の agent 選択に依存 | `AgentRouter` の Worker Agent 選択機能は削除するが、Controller 解決機能は `WorkflowRouter` として再構成する。既存テストは新しい routing model へ更新する。 |
| OMO 側に `sp-*` category が未定義 | fallback mapping を `omo.jsonc` 側で定義することを doctor（後続 PR）で検証する。本 PR では `RoutingDecision.category` / `DelegationRequest.category` の型を `SpCategory | TaskCategory` として `SpCategory` 受け入れを型で許容する。 |
| `PlanBridge` から直接 Agent 名を参照する既存コード | `handleMessage` / `handlePreToolUse` / `handlePostToolUse` の Atlas/Sisyphus/Prometheus 固有の injected context は段階的に整理する。本 PR では OMO wire payload から `agent` / `subagent_type` 等を除去しつつ、内部 metadata としての `agentId` / `context.taskId` は保持する。 |

| リスク | 対策 |
|--------|------|
| 既存テストが `AgentRouter` の agent 選択に依存 | `AgentRouter` の Worker Agent 選択機能は削除するが、Controller 解決機能は `WorkflowRouter` として再構成する。既存テストは新しい routing model へ更新する。 |
| OMO 側に `sp-*` category が未定義 | fallback mapping を `omo.jsonc` 側で定義することを doctor（後続 PR）で検証する。本 PR では `TaskCategory` union を拡張して型安全性を確保する。 |
| `PlanBridge` から直接 Agent 名を参照する既存コード | `handleMessage` / `handlePreToolUse` / `handlePostToolUse` の Atlas/Sisyphus/Prometheus 固有の injected context は段階的に整理する。本 PR では routing decision の生成部分を先に修正する。 |

## 16. 実装順序

1. `src/core/types.ts` に新しい型を追加
2. `src/core/routing-decision.ts` を新規作成
3. `src/core/workflow-router.ts` を新規作成
4. `src/core/execution-role-classifier.ts` を新規作成
5. `src/core/omo-category-mapper.ts` を新規作成
6. `src/core/agent-router.ts` を Controller Router に縮小
7. `src/core/task-packager.ts` を category-only に変更
8. `src/core/plan-bridge-core.ts` を新しい decision model に追従
9. `src/hooks/plan-bridge.ts` の `handlePreToolUse` を正規化
10. `src/index.ts` の export を更新
11. 既存テストを修正・追加
12. `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` を実行

## 17. 成果物

- 本設計書
- 実装コード（上記モジュール群）
- テストコード
- `bun run typecheck` / `bun run lint` / `bun run test` / `bun run build` の実行結果
