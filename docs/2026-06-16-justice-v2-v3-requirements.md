# Justice Architecture Charter — Quality Control Plane（v2/v3 要件定義）

> **バージョン**: 3.0
> **ステータス**: Architecture Charter（Accepted / Frozen）
> **対象実装**: v2 / v2.5 / v3（v4+ は非拘束ビジョン）
> **最終更新**: 2026-06-16
> **前提**: 本書は `@yohi/justice` v2.3.0（Phase 9 完了）を起点とする
> **位置づけ**: 本書は実装計画書であると同時に、変更してはならない設計原則を定める **Architecture Charter（アーキテクチャ憲章）** である

---

## 0. AI Native Development Architecture（大局）

Justice は「OpenCode プラグイン」である前に、**AI Native Development Architecture を構成する3つのプレーンの1つ**として定義される。OpenCode 固有の実装を持つが、**設計思想は特定 harness に依存しない**。

```text
┌────────────────────────┐
│ Thinking Plane         │
│   superpowers          │   ← 思考・設計・計画・TDD
└─────────────┬──────────┘
              │ produces: plan.md / design.md / adr/*
              ▼
┌────────────────────────┐
│ Execution Plane        │
│   oh-my-openagent      │   ← 実装・レビュー・マルチエージェント実行
└─────────────┬──────────┘
              │ produces: code / commits / reviews / test runs
              ▼
┌────────────────────────┐
│ Quality Control Plane  │
│   justice              │   ← 観測・判定（実行しない）
└────────────────────────┘
```

**Control Plane / Data Plane の対比（Kubernetes 類比）**:

| | 役割 | 本アーキテクチャでの対応 |
|---|---|---|
| **Data Plane** | 実際のワークロードを**実行**する | Execution Plane（OmO がコードを書く・実行する） |
| **Control Plane** | 状態を**観測・判定・調整**する（実行しない） | **Quality Control Plane（Justice が判定する）** |

> **重要 — Quality Control Plane は横断的である**: 上図は成果物フローを示すが、Quality Control Plane は Execution Plane の「下流」に直列接続されるのではない。Kubernetes の control plane が data plane を「管理」するのと同様、**Justice は Thinking / Execution 双方の産物を横断的に観測・判定する**。

> **Desired State Controller としての Justice**: Kubernetes の reconciliation に倣えば — **Thinking Plane が Desired State（あるべき姿: plan.md/design.md）**、**Execution Plane が Actual State（実際の成果: code/commit/test）** を生み、**Quality Control Plane は両者を継続的に突き合わせる（Desired vs Actual）**。Justice は **Desired State Controller** であり、判定とは「Desired と Actual の乖離検出」に他ならない。

> **Justice の正体**: Justice は **Quality Control Plane の Reference Implementation（リファレンス実装）** である（§4 Quality Protocol）。OpenCode を最初の binding とするが、思想は harness 非依存であり、将来 Codex / Cursor / Claude Code / Aider / OpenHands 等にも載せうる。

---

## 1. Executive Summary

Justice の役割を一語で表すと **Quality Arbiter（品質審判者）** — すなわち **「品質を判定する。ただし、どこで止めるかは差し替え可能（pluggable）にする」**。

Justice 自身は以下を**行わない**（既存エコシステムへ委譲する）:

| 領域 | 担当プレーン |
|---|---|
| 思考・設計・実装計画・TDD | **superpowers**（Thinking Plane） |
| 実装・レビュー・マルチエージェント実行 | **oh-my-openagent**（Execution Plane） |
| 品質判定・状態追跡・証跡・検証 | **justice**（Quality Control Plane） |

Justice の最終責務は、AI 開発で最も頻発する次の問題を**検出・判定**することである:

```text
Task Success ≠ Feature Success
（個々のタスクは成功したが、機能全体は壊れている）
```

**本改訂の核心**: 「Justice が止めるか否か」という二者択一を廃し、**Verdict authority（判定権限）は Justice が恒久保持し、Enforcement mechanism（強制機構）はレベルに応じて差し替える** という設計へ転換した。これにより短期の実装可能性（OpenCode Plugin 制約下）と長期のアーキテクチャビジョンを両立する。

---

## 2. 背景

現状の Justice は PlanParser / TaskDelegation / TaskFeedback / Wisdom を中心に構成される。一方、品質保証は Unit Test / PR Review / CodeRabbit / Greptile などに依存している。

その結果、次の乖離が発生する:

```text
Task 単位   → 正しい
Phase 単位  → 正しい
Feature 全体 → 壊れている
```

これらの既存手段は **Task/Phase 単位の局所検証**に強いが、**Feature 全体の一貫性（設計整合・E2E・回帰・要求網羅）を判定する主体が存在しない**。Justice はこの空白を埋める Quality Control Plane となる。

---

## 3. Design Invariants（不変契約）

本章は **変更してはならない設計原則**である。バージョンが進んでも、以下の不変条件を破る変更は許されない。これらは旧 P1〜P6 の設計原則を吸収・正本化したものである。

| ID | 不変条件 | 対応する旧原則 |
|---|---|---|
| **INV-001** | Justice は**設計を生成しない** | — |
| **INV-002** | Justice は**コードを書かない・実行しない**（Control Plane であり Data Plane ではない） | — |
| **INV-003** | Justice は**判定する**（Verdict authority を恒久保持する） | P3, P4 |
| **INV-004** | Justice は**観測できた事実（observed / derived）しか Evidence にしない** | P6 |
| **INV-005** | Justice は **plan.md を著作（書き換え）しない**（→ ADR-0007） | P1 |
| **INV-006** | Justice は **Fail-Open(A)（infrastructure failure）を破らない** | P5 |
| **INV-007** | **Enforcement は差し替え可能（pluggable）**である | P4 |
| **INV-008** | **Source of Truth は Justice の外部にある**（plan.md / design.md / adr/*） | P1 |
| **INV-009** | Justice は**決定論的**であり続ける（同一 Mission/Events/Evidence/Rules → 同一 Verdict） | —（新規） |

> **INV-005 の補足**: 現行実装は plan.md を書き換えている（checkbox 更新・error-note 追記）。これは INV-005 への**未準拠（Architecture Debt）**であり、付録 D に逸脱として記録し、移行対象とする。判断根拠と移行方針は **ADR-0007**（付録 C）を参照。

> **INV-009 の射程**: 決定論は **Verdict の算出**（Rule Evaluation Engine = 純粋関数）に及ぶ。Enforcement の*結果*は外部可変状態（permission 文脈・CI 状態）に依存しうるが、**Verdict 自体は入力が同じなら常に同一**である。これは Pure-Core 原則と整合し、ユニットテスト可能性を担保する。

**責務分離（旧 P2）**:

| 領域 | 担当 |
|---|---|
| 設計・実装計画・TDD | superpowers |
| 実装・レビュー | oh-my-openagent |
| 品質判定 | justice |

Justice は既存 Plugin を**置き換えない**。

---

## 4. Quality Protocol（harness 非依存の抽象モデル）

Justice の本質は OpenCode 実装ではなく、**Quality Protocol** という抽象モデルにある。Justice は **その Reference Implementation** である。

```text
Quality Protocol（抽象仕様・harness 非依存）
        │
        ▼ Reference Implementation
   Justice（OpenCode binding）
        │
        ▼ 将来の binding（vision・本書の実装対象外）
   Codex / Cursor / Claude Code / Aider / OpenHands ...
```

**Protocol を構成する抽象エンティティ**:

| エンティティ | 定義 |
|---|---|
| **Mission** | Thinking Plane が定める達成目標・仕様（plan.md/design.md 由来） |
| **Policy** | 品質意図の宣言（例: "No Secret Leakage"）。v4 で実装、Protocol には先行定義 |
| **Rule** | Policy の実装（例: `secret-pattern.yaml`）。人間が承認した静的定義 |
| **Event** | 観測事実と Justice の判定を時系列に記録する追記専用レコード |
| **Evidence** | 観測された生の信号（stdout/stderr/exit_code）＋ provenance |
| **Evaluation** | Rule を Evidence 上に適用し Verdict を導く決定論的プロセス（INV-009）。Verdict Pipeline の中核（§7） |
| **Verdict** | 品質判定（PASS/WARN/FAIL）＋ 到達可能 enforcement level |
| **Artifact** | 構造化された成果物・契約（Handoff / Gate Definition / Review Summary / Release Report） |
| **Traceability** | Requirement→Design→Plan→Task→PR→Commit→Test の連結 |
| **Review** | 集約されたレビュー所見 |

**エンティティの連鎖**: `Mission → Policy → Rule → Evidence → Evaluation → Verdict → Artifact`。Rule は Policy の実装、Evaluation は Rule を Evidence 上に適用する決定論的プロセス、Event（Observation & Decision Log）はこの連鎖を時系列に記録する基盤である。

**スコープガード（YAGNI）**: 本書は **OpenCode を reference binding** とし、`@opencode-ai/plugin` 上の実装のみを対象とする。他 harness 実装は **vision であり、今は作らない**。これは既存の **Pure-Core 原則（コアは harness 非依存）** を明文化したものにすぎず、新規実装の約束ではない。

---

## 5. Concept vs Implementation

**思想と実装形態を明確に区別する。**

```text
Concept（プロダクト思想・不変）:
  Justice は Quality Control Plane（Quality Protocol の Reference Implementation）である。
  Enforcement-capable（強制可能性を持つ）設計とする。

Implementation（実装形態・制約依存）:
  v2 では OpenCode Plugin API の制約により、主に Advisory として振る舞う。
  これは「現時点の実装形態」であって「プロダクト思想」ではない。

原則:
  - Verdict authority（判定権限）は常に Justice が保持する。（INV-003）
  - Enforcement mechanism（強制機構）は pluggable とし、段階的に強化する。（INV-007）
```

> **明文化の意図**: 「Justice は Advisor にすぎない」という誤解を防ぐ。Advisor は v2 の実装形態であり、判定権限の所在とは独立である。

---

## 6. アーキテクチャ（実装層モデル）

OpenCode binding における層モデル（既存の Hook-First / Pure-Core / Immutable を継承）:

| 層 | 責務 | Protocol との対応 | I/O |
|---|---|---|---|
| **Core** | 純粋ロジック（Verdict 評価・projection 再構築・provenance 判定） | Protocol エンティティの純粋実装 | なし（ユニットテスト100%目標） |
| **Hook** | OmO イベント捕捉・調整・enforcement 発火（permission deny 等） | Event の取り込み口・Verdict の射出口 | あり |
| **Runtime** | 実 I/O（Observation Log 追記、CI 連携アダプタ） | binding 固有のアダプタ | あり |

```text
Quality Control Plane（justice）
  ├─ Canonical Observation & Decision Log … Event の追記専用ログ（§8）
  ├─ Evidence Layer                       … observed 信号 ＋ provenance（§8）
  ├─ Artifacts Layer                      … Handoff/Gate Def/Review/Release（§8）
  ├─ Rule Evaluation Engine               … Gate（概念）の実装（§9 FR-005）
  └─ Verification                         … Feature 品質の最終判定
```

---

## 7. Enforcement Model

品質判定から強制までの一連の流れを **Verdict Pipeline** と呼ぶ:

```text
Policy → Rule → Evaluation(Evidence 上で) → Verdict → Enforcement Mapping(L0–L3)
```

- **Policy / Rule**: 品質意図とその静的実装（§4）
- **Evaluation**: Rule を Evidence 上で決定論的に評価（INV-009）
- **Verdict**: PASS / WARN / FAIL
- **Enforcement Mapping**: Gate 種別（§7.2）に応じて L0–L3 を選択

> Verdict までは決定論的（INV-009）。Enforcement Mapping の結果は外部状態（permission 文脈・CI 状態）に依存しうる。判定と強制を分離する設計（INV-003 / INV-007）はこの境界に対応する。

### 7.1 Enforcement の梯子（4段階）

| Lv | 強制手段 | 利用時期 | 失敗モード(INV-006) | 粒度 |
|---|---|---|---|---|
| **L0** | Advisory inject（警告・バナー・チェックリスト提示） | v2 | fail-open | 任意 |
| **L1** | `permission.ask` で `deny`（opt-in / critical gate 限定） | v2.5 | 検証済み verdict は fail-closed | ツール呼び出し単位 |
| **L2** | External enforcement（CI required check / git pre-push / PR merge protection）が Justice verdict を参照 | v3 | fail-closed（境界側） | commit / PR 単位 |
| **L3** | Native enforcement（OpenCode API 拡張 or OmO task-dispatch 層統合） | v4+（vision） | fail-closed | feature / release 単位 |

### 7.2 Gate 種別 × 到達可能 Enforcement Level

**各 Gate 種別が到達できる最大 level は異なる。これを固定する。**

| Gate 種別 | 観測対象 | 到達可能 max level | 理由 |
|---|---|---|---|
| **Task Gate** | 単一 tool 呼び出し | **L1** | deny できる単一呼び出しが存在する |
| **Phase Gate** | 複数 task の集約 | **L2** | deny すべき単一呼び出しが無い → 境界で止める |
| **Feature Gate** | design/plan 全体＋E2E | **L2 / L3** | feature 出荷点はプラグイン外 → CI/PR/OmO 層 |

> **原理的制約**: 「Feature Gate を L1（permission deny）で止める」ことは不可能。feature 出荷の瞬間を捕捉するイベントが Plugin API に存在しないため。Feature 強制は必ず L2 以上（プロセス外の境界）で行う。

### 7.3 Fail-Open の2分類（INV-006）

```text
(A) Infrastructure Failure:
    Justice 自身の例外・I/O 失敗・ロジッククラッシュ
    → 常に fail-open（自分のバグでセッションを止めない）。不変条件(INV-006)。

(B) Quality Verdict Failure:
    Gate が正常に計算され FAIL 判定を返した
    → enforcement level に応じて fail-closed 可能。
```

> 従来「fail-open だから強制不能」とされたのは (A) の制約を (B) に誤適用したもの。両者は別軸であり、両立する。

### 7.4 独立検証の所在

Justice は**自らテスト/E2E を実行しない**（INV-002）。

- **L0/L1**: エージェントが実行したコマンドの結果を `tool.execute.after` で**直接観測**（provenance=`observed`）。自己申告（`declared`）より強いが、起動主体はエージェント。
- **L2**: **独立実行の権威は CI が持つ**。Justice は CI の required check 結果を verdict のソースとして参照する。
- これにより「誰が独立して検証するか」が層ごとに明確化される。

---

## 8. Observation / Evidence / Artifacts モデル

Justice が `.justice/` 配下に保持するものを3層に区別する。

```text
Canonical Observation & Decision Log（基盤・追記専用）
  ├─ Evidence   … 生の観測信号（stdout/stderr/exit_code）＋ provenance
  └─ Artifacts  … 構造化成果物・契約（Handoff/Gate Definition/Review Summary/Release Report）
```

### 8.1 Canonical Observation & Decision Log

イベントソーシングの基盤。**Justice が観測した事実と、Justice 自身が下した判定（verdict）の双方を時系列追記する**。

> **SoT の位置づけ（INV-008）**: 本ログは **Justice の view を replay するための正本**であり、verdict の正本でもある。しかし **business / plan の Source of Truth ではない**（それは外部の plan.md / design.md）。「Justice SoT」という曖昧な表現は用いない。

**保存先（シャード化・並行安全）**:

```text
.justice/events/
  <agentId>.jsonl   … エージェント別イベントログ（agent-a.jsonl, ...）
  system.jsonl      … システムイベント
```

読み取り時に `timestamp` / `sequence` でマージして state を再構築する（projection）。単一ファイルへの並行 append は禁止（§13 NFR）。

**記録の3種別（Observation → Decision → Learning）**: 本ログは3種のレコードを収容する — **Observation Record**（観測した事実）、**Decision Record**（Justice が下した verdict）、**Learning Record**（失敗分析から得た学習）。Learning Record は **v3 の Failure Intelligence（V3-05）で実装**するが、ログモデルとして今から枠を確保しておく。

### 8.2 Evidence（生の観測信号 ＋ provenance）

**Evidence は観測された生の信号に限定する。** すべてに**出所（provenance）**を付与する。

```text
observed  … Justice が tool.execute.after で stdout/exit を直接観測した
declared  … エージェントの自己申告
derived   … observed から計算した
unknown   … 出所不明
```

```json
{ "kind": "test", "command": "bun run test", "exit_code": 0, "provenance": "observed" }
```

**判定への利用規則**: L1 以上の deny 判断に使えるのは原則 `observed` / `derived` のみ。`declared` は L0 advisory に限定する（嘘の自己申告で deny を撃たない）。

### 8.3 Artifacts（構造化成果物・契約）

Handoff・Gate Definition・Review Summary・Release Report は **Evidence ではなく Artifact** である。

> **属性の違い**: Evidence は **provenance（出所）** を持つ。Artifact は provenance ではなく **authorship / authority（誰が作成した契約・定義か）** を持つ。両者を混同しない。

```text
Artifacts
  ├─ Handoff         … Agent 間引継ぎ契約（from→to）
  ├─ Gate Definition … gate.yaml（人間が承認した静的ルール）
  ├─ Review Summary  … 集約レビュー所見
  └─ Release Report  … Final Verifier の判定結果
```

---

## 9. Requirements — Justice v2（Quality Coordinator）

実装形態: **L0 Advisory のみ**。観測拡張 + Observation Log + provenance + state projection を確立する。

### FR-001 Canonical Observation Log & State Projection

**目的**: 状態を「管理」せず、**事実と判定をイベントとして記録**し、状態はそこから**投影（projection）**する（§8.1）。

- **保存先**: `.justice/events/<agentId>.jsonl`（シャード化）
- **state.json**: Source of Truth ではなく projection（read-model / キャッシュ）。いつでもログから再構築可能。`current_branch` / `active_prs` 等の外部状態はキャッシュせず git / 外部から live クエリ。
- **イベント例**: `TaskStarted → TaskFinished → ReviewRequested → ReviewFinished → GatePASS`
- **非目的**: 設計内容・実装計画・タスク定義は保持しない（INV-001/INV-008）。

### FR-002 Skill Awareness

**目的**: 利用可能資産（superpowers skills / OmO agents）の把握。**監視のみ・実行しない**（INV-002）。skill 起動は `SkillInvoked` イベントとして Observation Log に吸収可能。

### FR-003 Handoff Tracking（Artifact）

**目的**: Agent 間引継ぎ契約の追跡。**Artifact として記録**する（§8.3）。`AgentStart/Complete` フックは存在しないため、`task()` の `tool.execute.before/after` から導出。

```json
{ "type": "Handoff", "from": "", "to": "", "task": "", "timestamp": "", "authority": "observed" }
```

### FR-004 Evidence Engine（生信号 ＋ provenance）

**目的**: 生の観測信号の収集（§8.2）。Evidence は stdout/stderr/exit_code に限定し、全件に provenance を付与する。観測境界外（直接 git 操作・外部 CI・外部レビュー）は `declared` または外部信号として扱い、completeness を主張しない（INV-004）。

### FR-005 Gate（概念）／ Rule Evaluation Engine（実装）

**概念と実装の分離**:

```text
Gate                     … 概念（品質チェックポイント）
  ↓ 実装
Rule Evaluation Engine   … rule → evaluation → verdict を決定論的に評価する実装
```

**Gate 種別と確認項目**:

```text
Task Gate    : Acceptance Criteria / Required Tests / Evidence / Review
Phase Gate   : Integration / Cross-Task Consistency / Review Resolution
Feature Gate : Design Consistency / Plan Consistency / E2E / Regression / Negative Criteria
```

- **判定結果**: `PASS / WARN / FAIL`（＋ 到達可能 enforcement level、§7.2）
- **Fail-Open 適用**: 評価ロジック例外 → (A) fail-open（PROCEED）。正常な FAIL → (B) level に応じて処理（INV-006）。
- **v2 実装方針**: **L0 Advisory のみ**。FAIL は inject で強警告＋バナー＋チェックリスト提示。`tool.execute.after` の観測対象を `task` 以外（bash/test）へ拡張。
- **ルールの出所**: Rule は静的な Gate Definition（gate.yaml）として人間が承認・コミットする。Engine は決定論的に評価するのみ（AI 動的生成は禁止、§11 V3-06）。
- **回帰テスト要件**: 不変条件 (A)「infra error は必ず fail-open」をテストで固定。

### FR-006 Review Aggregator

**目的**: レビューの**集約のみ**（レビュー自体は行わない）。既存 `ReviewRejectionDetector` を拡張。出力 Artifact: `{ critical[], major[], minor[], resolved[], open[] }`。

### FR-007 Final Verifier

**目的**: Feature 品質の最終判定（Checklist Injector として実装）。Release Report Artifact を生成。

- **確認**: design.md / plan.md / コードベース / E2E・dataflow / regression / open issues
- **出力**: `Release Ready | Not Ready`（provenance 付き根拠）
- **制約**: Justice は独立実行しない（INV-002）。判定は observed 証跡 ＋ L2(CI) 結果の集約に基づく。

### OpenCode Commands

```text
/justice-status   /justice-gate   /justice-review   /justice-verify
```

実装は利用可能機構（カスタム `tool` 定義 / `command.execute.before` 傍受）による。**正確な登録方式は Phase 0 で確認**（§14）。

### OpenCode Hooks（実在フックのみ）

**使用する実在フック**（`@opencode-ai/plugin` で検証済み）:

```text
event                            … message.updated / session.error(loop)
chat.message                     … メッセージ観測
tool.execute.before/after        … 全ツール観測（task 限定を撤廃）
permission.ask                   … L1 enforcement（deny）
command.execute.before           … スラッシュコマンド
experimental.session.compacting  … コンパクション保護
```

**削除（API に存在しない）**: `SessionStart / SessionEnd / AgentStart / AgentComplete / GitCommit / PRCreate`

### v2 成功指標（KPI を event-log 由来に再定義）

| KPI | 旧定義 | 改訂（event-log 由来・測定可能化） |
|---|---|---|
| KPI-1 設計乖離 | −50% | Feature Gate の `design.md 不整合検出` イベント数の推移 |
| KPI-2 不具合 | −30% | **一部観測境界外**（本番障害/CI）。`declared`/外部信号に依存と明記 |
| KPI-3 コンテキスト欠落 | −80% | Handoff Artifact の連続性破れ率（`from→to` 欠落） |

---

## 10. Justice v2.5 — Evidence / Observation Log 確立 ＋ L1 opt-in

```text
- Observation Log / Evidence Engine の本格運用（provenance 運用込み）
- Review Aggregator の拡張
- 既存 WisdomStore / TieredWisdomStore / ReviewRejectionDetector / LearningExtractor の標準化
- L1（permission deny）を opt-in 導入。対象は最小の critical gate に限定
  （例: secret leak / destructive operation）。trust を積んでから対象を拡大。
成果物: .justice/events/, .justice/evidence/, .justice/wisdom/
```

---

## 11. Justice v3 — Quality Kernel

品質保証を学習可能システムへ進化させる。**L2（CI/PR）enforcement を導入。**

| ID | 内容 | 改訂後の扱い |
|---|---|---|
| V3-02 Traceability Engine | Requirement→Design→Plan→Task→PR→Commit→Test | **linker のみ**（リンク保持。要件本体は著作しない） |
| V3-03 Coverage Analyzer | 要求カバレッジ測定 | 要求/計画 coverage は可。test coverage は外部依存 |
| V3-04 Review Memory | Recurring Bug / Architecture Smell / Security Findings | WisdomStore の自然拡張 |
| V3-05 Failure Intelligence | 「なぜ漏れたか / どの Gate で防げたか」分析 | 既存抽出器の拡張 |
| V3-07 Release Readiness Score | Gate/Coverage/Review/Evidence/Regression → 0–100 | **provenance 付き**。観測境界により不完全な旨を明示 |
| V3-08 Multi-Project KB | 成功/失敗/レビュー知識の共有 | TieredWisdomStore（local/global）の拡張で吸収 |

**Drop / 変更**:

```text
V3-01 Requirement Graph
  → 要件本体は superpowers ドメイン（INV-001/INV-008）。
     Justice は REQ-ID と Task/PR/Review の「リンク」だけ管理（V3-02 に統合）。

V3-06 Adaptive Gate
  → AI 動的生成は Pure-Core/Immutable に反する。
     「AI が提案 → 人間が承認 → gate.yaml に静的コミット → Rule Evaluation Engine が決定論的に評価」へ変更。
```

---

## 12. Justice v4+ — Vision（非拘束）

**要件定義の実装対象は v3 まで。** v4 以降は North Star（拘束しない）として記載する。「Quality OS」「Policy Engine」等のラベルは用いない — Justice は**実行しない Control Plane** であり、OS でも実行エンジンでもないため。

```text
v4+（vision）:
  - L3 native enforcement（OpenCode API 拡張 / OmO task-dispatch 層統合）
  - Quality Protocol の他 harness 実装（Codex / Cursor / Claude Code / Aider / OpenHands）
  - 成熟した Quality Control Plane として、AI Native Development Architecture を横断
  ※ 具体 FR には落とさない（YAGNI）。
```

---

## 13. 非機能要件（NFR）

| 領域 | 要件 |
|---|---|
| **並行性** | Observation Log は `agentId` 別 JSONL シャードで並行追記の競合を回避。読取時マージ。単一ファイルへの並行 append は禁止 |
| **スキーマ versioning** | 全 `.justice/` アーティファクトにスキーマ版を持たせ、`WisdomPersistence` の v1→v2 同様の移行戦略を適用 |
| **保持期間** | events / evidence の retention とローテーション方針を定義（無限増大を防ぐ） |
| **セキュリティ** | evidence 内のシークレットを `SecretPatternDetector` で走査。gate.yaml/外部入力の injection 面を検証。projection の改ざん検知 |
| **性能** | `tool.execute.after` 全観測のレイテンシ予算を定義（全ツール呼び出しへのオーバーヘッド計測） |
| **信頼性** | 不変条件 (A) infra-error→fail-open を回帰テストで固定（INV-006）。L1+ 拡大は trust 蓄積後 |

---

## 14. 実装優先順位

### Phase 0 — 前提解消（FATAL ブロッカー）

```text
- 利用可能 OpenCode フック確定（済: §9 のリスト）
- /justice-* コマンド登録方式の確認（tool / command.execute.before）
- 観測スコープ拡張（tool.execute.after の task 限定撤廃）のレイテンシ計測
- INV-005 移行方針の確定（plan.md 書き込み廃止 → イベント化、付録 C/D）
```

### Phase 1 — v2.0（Quality Coordinator）

```text
Observation Log(JSONL shard) + state projection + Evidence(provenance)
+ Task-level L0 Advisory Gate(Rule Evaluation Engine) + Review Aggregator + 観測拡張
```

### Phase 2 — v2.5（Evidence/Observation Log 確立）

```text
Handoff Artifact(task Pre/Post 由来) + Evidence 本格運用 + Final Verifier(Checklist)
+ Wisdom/Learning 標準化 + L1 deny opt-in(critical gate 限定)
```

### Phase 3 — v3（Quality Kernel）

```text
Traceability(linker) + Failure Intelligence + Review Memory
+ Release Readiness(provenance) + L2 CI/PR enforcement + Multi-Project KB
```

### Phase 4 — v4+（Vision・非拘束）

```text
L3 native enforcement / Quality Protocol 他 harness 実装（API 拡張前提）
```

---

## 15. 最終ゴール

```text
変更前:  superpowers=頭脳        /  OmO=手足          /  justice=神経系
変更後:  Thinking Plane          /  Execution Plane   /  Quality Control Plane
        (superpowers)              (oh-my-openagent)    (justice)
```

Justice は **Quality Control Plane の Reference Implementation** として **Feature Success を判定**する品質カーネルへ進化する。最重要の設計転換は次の一点である:

> **「Justice が止めるか否か」ではなく、「Justice が判定し、どこで止めるかは差し替え可能にする」。**
> Verdict authority は Justice が恒久保持し（INV-003）、Enforcement は L0→L3 へ段階的に強化する（INV-007）。

Justice は OpenCode 固有の実装を持つが、その設計思想（Quality Protocol）は harness 非依存であり、**AI エージェント品質保証基盤のリファレンスアーキテクチャ**として長期的に維持される。

---

## 16. Architecture Governance（憲章の維持）

設計の抽象化はここで完成である。ここから先に必要なのは**アーキテクチャを継続的に守るためのガバナンス**である。Invariant は文章のままでは CI で壊れる。実行可能な検証とプロセスで裏打ちする。

### 16.1 Architecture Fitness Functions

Design Invariant（§3）を **CI で検証可能な関数**として定義する。下表の検証方法は **v2 実装時に作成する target**（現時点で未実装）。

| FF | 検証内容 | 対応 INV | CI 検証方法（target） |
|---|---|---|---|
| **FF-001** | Core は `@opencode-ai/*` / OpenCode 型を import しない | INV-002 | import-lint / dependency-cruiser |
| **FF-002** | Core は決定論的（同一入力 → 同一出力） | INV-009 | 反復実行の等価性テスト |
| **FF-003** | Rule Evaluation Engine は副作用を持たない | INV-009 | 純粋関数テスト（I/O 不在アサート） |
| **FF-004** | Observation Log は同一 projection に replay される | INV-008 | replay 決定性テスト |
| **FF-005** | Justice は plan.md に書き込まない | INV-005 | plan.md パスへの write 不在アサート |
| **FF-006** | 全 hook は注入障害下でも有効な HookResponse を返す | INV-006 | fault-injection テスト |
| **FF-007** | L1+ deny に使う Evidence の provenance ∈ {observed, derived} | INV-004 | gate 入力の provenance アサート |

### 16.2 Invariant ↔ Fitness ↔ Test Matrix

Invariant・Fitness Function・テストをトレーサブルに結ぶ（テストパスは target、v2 で作成）。

| Invariant | Fitness Function | Test（target path） |
|---|---|---|
| INV-002 | FF-001 | `tests/arch/core-no-opencode-imports.test.ts` |
| INV-009 | FF-002, FF-003 | `tests/core/rule-engine-determinism.test.ts` |
| INV-008 | FF-004 | `tests/core/observation-log-replay.test.ts` |
| INV-005 | FF-005 | `tests/arch/no-planmd-write.test.ts` |
| INV-006 | FF-006 | `tests/hooks/fail-open.test.ts` |
| INV-004 | FF-007 | `tests/core/evidence-provenance.test.ts` |

### 16.3 Governance Rules

- **INV / ADR / Quality Protocol を変更する PR は 2 approvals を要する**（通常コードより厳格）。コードより Architecture を重くする。
- 本憲章ファイルに **CODEOWNERS** を設定し、Architecture maintainer のレビューを必須化する。
- **Fitness Functions は CI required check** とする（FF 失敗は merge ブロック）。
- 新規 **ADR は Acceptance Criteria（付録 C 形式）を必須**とする。
- 本憲章は v3.0 で**凍結（frozen）**。以降の変更は上記ガバナンス手続きを経る。

---

## 付録 A. 用語集

| 用語 | 定義 |
|---|---|
| AI Native Development Architecture | Thinking / Execution / Quality Control の3プレーンからなる開発アーキテクチャ |
| Thinking Plane | 思考・設計・計画を担うプレーン（superpowers） |
| Execution Plane | 実装・実行を担う Data Plane（oh-my-openagent） |
| Quality Control Plane | 観測・判定を担う Control Plane（justice）。実行しない |
| Quality Protocol | harness 非依存の品質抽象モデル。Justice はその Reference Implementation |
| Quality Arbiter | 品質を判定する主体。判定権限を持つが、強制機構は分離される |
| Verdict authority | 品質判定（PASS/WARN/FAIL）を下す権限。Justice が恒久保持 |
| Enforcement mechanism | 判定結果を強制する機構。L0–L3 で差し替え可能 |
| Canonical Observation & Decision Log | 観測事実と判定を追記する正本ログ。replay 正本だが business-SoT ではない |
| Evidence | 観測された生信号（stdout/stderr/exit_code）。provenance を持つ |
| Artifact | 構造化成果物・契約（Handoff/Gate Def/Review/Release）。authorship/authority を持つ |
| provenance | Evidence の出所（observed / declared / derived / unknown） |
| projection | イベントログから再構築される read-model（state.json 等） |
| Design Invariant | 変更してはならない設計原則（INV-xxx） |
| ADR | Architecture Decision Record（アーキテクチャ決定記録） |
| Architecture Debt | 現実装が Invariant/ADR に未準拠な箇所。移行対象 |

## 付録 B. 変更履歴

### B.1 旧要件 → 本憲章（主要変更）

| # | 変更 | 旧 → 新 |
|---|---|---|
| 1 | Concept/Implementation 分離 | 暗黙 → §5 で明文化 |
| 2 | Gate モデル | 単一判定 → L0–L3 梯子 ＋ Gate種別×level 行列 |
| 3 | Fail-Open | 一枚岩 → (A)Infra always-open / (B)Verdict level 依存 |
| 4 | Evidence | exit_code 収集 → provenance 必須化、生信号に限定 |
| 5 | State 管理 | state.json=SoT → Observation Log(shard)=replay正本、state=projection |
| 6 | OpenCode Hooks | 架空フック含む → 実在フックのみ |
| 7 | KPI | 測定方法なし → event-log 由来の測定可能指標 |
| 8 | V3-01 Requirement Graph | Justice が著作 → superpowers ドメイン、Justice は linker |
| 9 | V3-06 Adaptive Gate | AI 動的生成 → AI 提案 + 人間承認 + 静的 gate.yaml |
| 10 | v4/v5 | 実装対象 → 非拘束 Vision |

### B.2 v3.0-draft → v3.0-rc（本改訂で追加）

| # | 変更 |
|---|---|
| 11 | **三層プレーン**（Thinking/Execution/Quality Control）を §0 に大局定義 |
| 12 | **Quality Protocol** を §4 に新設。Justice = Reference Implementation |
| 13 | **Design Invariants（INV-001〜008）** を §3 に新設、旧 P1〜P6 を吸収 |
| 14 | **Event Store → Canonical Observation & Decision Log** に正名（SoT 表現を撤廃） |
| 15 | **Gate Engine → Gate（概念）/ Rule Evaluation Engine（実装）** に分離 |
| 16 | **Handoff を Evidence → Artifact** に再分類。Observation/Evidence/Artifacts を §8 で3層化 |
| 17 | **用語: Quality OS / Policy Engine を撤廃 → Quality Control Plane** に統一 |
| 18 | **INV-005（plan.md 非著作）** を採用し ADR-0007 + Architecture Debt 化 |
| 19 | **INV-009（Determinism）** を §3 に追加（同一 Mission/Evidence/Rules → 同一 Verdict） |
| 20 | **Verdict Pipeline**（Policy→Rule→Evaluation→Verdict→Enforcement Mapping）を §7 に明文化 |
| 21 | **Policy** を Quality Protocol（§4）に追加（Rule = Policy の実装） |
| 22 | **Desired State Controller**（Desired vs Actual reconciliation）framing を §0 に追加 |
| 23 | **Architecture Debt に優先度**（Critical/High/Medium/Low）を導入 |
| 24 | **Justice Axioms（AX-001〜006）** を締めくくりに追加 |

### B.3 v3.0-rc → v3.0（凍結前の最終追加）

| # | 変更 |
|---|---|
| 25 | **Architecture Fitness Functions（FF-001〜007）** を §16.1 に追加（INV を CI 検証可能化） |
| 26 | **Invariant ↔ Fitness ↔ Test Matrix** を §16.2 に追加 |
| 27 | **Architecture Governance Rules** を §16.3 に追加（INV/ADR/Protocol 変更は 2 approvals） |
| 28 | **ADR Acceptance Criteria** を付録 C に追加 |
| 29 | **Evaluation** を Quality Protocol（§4）に追加、連鎖を `…→Evidence→Evaluation→Verdict→…` へ修正 |
| 30 | **Observation Log に Learning 段**（Observation→Decision→Learning）を §8.1 で予約 |
| 31 | **v3.0-rc → v3.0 確定**（Accepted / Frozen） |

## 付録 C. ADR-0007 — Justice SHALL NOT author plan.md

| 項目 | 内容 |
|---|---|
| **ID** | ADR-0007 |
| **Title** | Justice SHALL NOT author plan.md |
| **Status** | Accepted |
| **Context** | 現行実装は plan.md を書き換えている（`PlanParser.updateCheckbox` / `appendErrorNote`、task-feedback の成功時✅付与、loop-handler の error-note 追記）。一方 INV-008 では plan.md は superpowers が所有する Source of Truth であり、Quality Control Plane（Justice）が SoT を mutate するのは責務境界の侵食である。 |
| **Decision** | **Justice SHALL NOT author plan.md.** 目標アーキテクチャは `Justice → event 発行 → 所有者(agent/superpowers) → plan.md 更新`。Justice 自身は plan.md に書き込まない。 |
| **Consequences** | 現実装の checkbox/error-note 書き込みは **Architecture Debt（付録 D）** として移行対象とする。移行完了まで既知の逸脱として明示する。Contributor はこの境界を前提に設計する。 |
| **Acceptance Criteria** | 次をすべて満たしたとき Done:<br>□ checkbox 更新コードの除去<br>□ `ReflectionEvent` の導入<br>□ 所有者（agent/superpowers）による plan.md 更新<br>□ DEBT-001 の解消 |

> ※ ADR 番号 `0007` は本憲章での識別子。既存 `adr/` 連番が別途存在する場合は採番を調整する（Phase 0 で確認）。

## 付録 D. Architecture Debt（現実装の逸脱）

| ID | 逸脱 | 違反する原則 | 優先度 | 現状 | 目標 / 移行 |
|---|---|---|---|---|---|
| **DEBT-001** | Justice が plan.md を直接書き換えている | INV-005 / ADR-0007 | **High** | `task-feedback`（成功時✅）・`loop-handler`（error-note）・`PlanParser.updateCheckbox`/`appendErrorNote` | plan.md 書き込みを廃し、`ReflectionEvent` 発行＋所有者による更新へ。Phase 1〜2 で移行 |

> 優先度凡例: **Critical**（安全/データ破壊）> **High**（Invariant 違反）> **Medium** > **Low**。DEBT-001 は Invariant 違反だが即時の安全性問題はないため **High**。

> Architecture Debt は「今は便利だが責務境界を崩している」既知の負債である。憲章は理想（Invariant）を掲げ、逸脱を可視化することで、将来の Contributor が迷わないようにする。

---

## Justice Axioms（公理 — 設計哲学）

付録ではなく、本憲章の**締めくくり**として置く。10 年後も設計思想をぶらさないための公理である。

```text
AX-001  Quality is judged, not assumed.
        品質は判定されるものであり、前提されるものではない。
AX-002  Evidence outranks declaration.
        観測された証拠は自己申告に優越する。
AX-003  Verdict is independent from enforcement.
        判定は強制から独立している。
AX-004  Observation precedes decision.
        観測は判定に先立つ。
AX-005  The source of truth belongs outside Justice.
        真実の源泉は Justice の外部にある。
AX-006  Justice coordinates, but never executes.
        Justice は調整するが、決して実行しない。
```

各公理は Design Invariants（§3）の哲学的根拠である — AX-002→INV-004 / AX-003→INV-003,007 / AX-005→INV-008 / AX-006→INV-002 / AX-001,004→Quality Arbiter の存在理由。
