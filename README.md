# Justice Plugin

> Superpowers と oh-my-openagent を繋ぐ神経系プラグイン。

![Tests](https://img.shields.io/badge/tests-2193%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue)
![Bun](https://img.shields.io/badge/runtime-Bun-black)

## これは何？

Justice は、以下の2つの間のギャップを埋める **OpenCode プラグイン** です。

- **[Superpowers](https://github.com/oh-my-openagent/superpowers)** — Markdownのプランファイルを通じた宣言的なAIプロジェクト管理
- **[oh-my-openagent](https://github.com/oh-my-openagent)** — `task()` ツールを備えたイベント駆動型のAI実行エンジン

Justice がない環境では、`plan.md` のチェックボックスリストと `task()` への委譲呼び出しの間に自動的な連携はありません。Justice は「神経系」として機能することでこのギャップを埋めます。具体的には、委譲の意図を検出し、プランを解析し、コンテキストをパッケージ化し、結果を処理し、さらに得られた学習内容を今後のタスクにフィードバックします。

## 対応 upstream バージョン

Justice v4.2.3 は、以下の upstream バージョンを想定しています。

| コンポーネント | 想定バージョン |
| --- | --- |
| oh-my-openagent (OmO) | v4.19.4 |
| Superpowers | v6.4.2 |

この組み合わせでの互換性検証の記録は [v4 upstream compatibility smoke](./docs/reports/2026-09-28-v4-superpowers-6.4.2-omo-4.19.4-smoke.md) を参照してください。

## アーキテクチャ

```text
Superpowers (頭脳)               Justice Plugin (神経系)                 oh-my-openagent (手足)
─────────────────────       ────────────────────────────────────    ────────────────────────
plan.md                 →   v1: フック層 (Hook Layer):            →   task()
design.md               →     plan-bridge (Message/PreToolUse)  →   background_output()
role-prompt.md          →     task-feedback (PostToolUse)        ←   compaction イベント
                        →     compaction-protector (Event)        ←   loop-detector イベント
                        →     loop-handler (Event)
                             ↕
                             v2: Quality Control Plane (Observation & Gate):
                               observation-handler (全 tool/message 観測)  ←   tool.execute.*
                               → ObservationLogStore (.justice/events/**.jsonl) ←   message.*
                               → State Projection (.justice/state.json)
                               → Gate Engine (.justice/gate.yaml) → advisory
                               → Review Aggregator → `justice_review` tool
                             ↕
                             コアロジック層 (純粋関数、I/Oなし):
                               PlanParser · TaskPackager · ErrorClassifier
                               DependencyAnalyzer · CategoryClassifier
                               WisdomStore · LearningExtractor · ...
                             ↕
                             ランタイム / ネイティブ境界:
                               NodeFileSystem · Linux Review Artifact Provider
                               (Rust N-API openat2/renameat2 記述子相対 I/O)
```

### 主な設計原則

- **フックファースト (Hook-First)**: 全ての機能は OmO のライフサイクルフックとして実装されます。
- **純粋なコア (Pure Core)**: ビジネスロジックは OmO に一切依存しておらず、完全にユニットテスト可能です。
- **フェイルオープン (Fail-Open)**: I/O エラーによって実行がクラッシュすることはありません。プラグインはグレースフルに縮退します。
- **不変型の利用 (Immutable Types)**: 予期せぬ状態変更を防ぐため、すべてのインターフェースで `readonly` を使用します。

## クイックスタート

### For Humans (推奨)

> [!TIP]
> **人間は設定を打ち間違えることがあります。** このプロジェクトのインストールと設定は、AIエージェント（Gemini CLI / Cursor 等）に丸投げすることを強く推奨します。

以下のプロンプトをコピーしてエージェントに渡してください：

```text
Install and configure @yohi/justice by following the instructions at:
https://raw.githubusercontent.com/yohi/justice/refs/heads/master/README.md
```

<details>
<summary><b>For Agents (AIエージェント向け手順)</b></summary>

あなたがターミナル操作可能なAIエージェントであるなら、以下の手順に従って自律的にセットアップを遂行してください：

**Requirements (GitHub Packages 版の場合):**
1. **Setup global .npmrc** (`~/.npmrc`) with `@yohi:registry=https://npm.pkg.github.com` and `_authToken`
2. **Run `opencode plugin @yohi/justice`** to install the package and register it in `opencode.jsonc`

**Requirements (ソースコードビルド版の場合):**
1. **Clone this repository** to a local directory.
2. **Run `bun run build`** to generate `dist/`.
3. **Register hooks** in `opencode.jsonc` pointing to the local `dist/` files.

**Action Plan:**
1.  **[ ] GitHub Packages の認証設定 (Packages版のみ):**
    *   ユーザーのホームディレクトリにある **`~/.npmrc`** を確認し、以下の2行が設定されていない場合は追記してください（401エラー防止のため）。
        ```ini
        @yohi:registry=https://npm.pkg.github.com
        //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
        ```
    *   環境変数 `GITHUB_TOKEN` が利用可能であることを確認してください。
2.  **[ ] 導入パターンの決定:** ユーザーに確認し（`ask_user` 等のインタラクション手段を使用）、GitHub Packages (安定版) か ソースコードビルド (最新版/開発者用) かを選択してもらってください。
    *   **Fallback:** インタラクションが不可能な場合は、最もクリーンな **GitHub Packages 版** をデフォルトとして選択してください。
3.  **[ ] 設定ファイルの特定:** 設定ファイルの場所が不明な場合は `opencode --help` を実行してパスを確認するか、以下の標準的な場所を探索してください：
    *   グローバル設定: `~/.config/opencode/opencode.jsonc`
    *   プロジェクト設定: `.opencode/opencode.json` または `opencode.jsonc`
4.  **[ ] プラグイン/フックの登録:** ユーザーの選択に応じてインストールを実行してください。
    *   Packages版: **`opencode plugin @yohi/justice`** コマンドを実行してインストールしてください。
    *   ソース版: 上記で特定した設定ファイルの **`plugin` 配列** に、ビルドされた JS ファイル（`dist/opencode-plugin.js`）への絶対パスを登録してください。**※手動での `hooks` 登録は不要です。**
5.  **[ ] 統合の確認:** 起動ログ（または `background_output`）を確認し、`Justice initialized via opencode-adapter` というメッセージが出力されていることをもってセットアップ完了と判定してください。

</details>

### 手動セットアップ (開発者向け)

このプロジェクト自体の開発を行う場合の手順です。

```bash
# 依存関係のインストール
bun install

# 全テストの実行
bun run test
```

## インストール (詳細)

### パターン 1: GitHub Packages 経由 (推奨)

最もクリーンで推奨される方法です。OpenCode の `plugin` コマンドを使用することで、インストールと設定が自動的に行われます。

1.  **認証設定 (`~/.npmrc`)**
    プロジェクトルートの `.npmrc` を汚染せず、誤コミットを防ぐため、ユーザーのホームディレクトリへの設定を推奨します。以下の2行を追記してください。
    ```ini
    @yohi:registry=https://npm.pkg.github.com
    //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
    ```
2.  **プラグインのインストール**
    ターミナルで以下のコマンドを実行してください。これにより、パッケージがダウンロードされ、設定ファイル（`.opencode/opencode.json` または `opencode.jsonc`）に自動的に追記されます。
    ```bash
    opencode plugin @yohi/justice
    ```
    > [!IMPORTANT]
    > `opencode.jsonc` へ手動で追記するだけでは、パッケージの実体がインストールされない場合があります。必ず上記のコマンドを使用してインストールをトリガーしてください。

### パターン 2: TypeScript 設定経由

`opencode.config.ts` を使用している場合は、プラグインオブジェクトを直接渡します。

```ts
import { OpenCodePlugin } from "@yohi/justice/opencode";

export default { plugins: [OpenCodePlugin] };
```

### パターン 3: ソースコードからビルド (最新版・開発用)

リポジトリをクローンし、ビルドしたファイルをプラグインとして直接参照します。
プラグインとして登録することで、必要なフック（Message, PreToolUse 等）は自動的に登録されます。**手動で `hooks` セクションに記述する必要はありません。**

1.  **ビルド**
    ```bash
    git clone https://github.com/yohi/justice.git
    cd justice && bun install && bun run build
    ```
2.  **プラグインの登録** (`opencode.jsonc`)
    `plugin` 配列にビルドされた JS ファイルへの絶対パスを記述してください。
    ```jsonc
    {
      "plugin": [
        "/path/to/justice/dist/opencode-plugin.js"
      ]
    }
    ```

### ライブラリとして利用する場合（v3.0.0 以降）

`@yohi/justice` の root specifier は v3.0.0 で **OpenCode プラグイン専用エントリ** に変更されました。ライブラリとして named export を利用する場合は `@yohi/justice/core` から import してください。

```ts
// Before (2.x)
import { PlanParser, TaskPackager } from "@yohi/justice";

// After (3.0)
import { PlanParser, TaskPackager } from "@yohi/justice/core";
```

| 用途                         | specifier                                                    | 破壊的変更                       |
| ---------------------------- | ------------------------------------------------------------ | -------------------------------- |
| OpenCode プラグイン          | `@yohi/justice`（3.0.0 以降）または `@yohi/justice/opencode` | なし（3.0.0 で修正済み）         |
| ライブラリ（core）           | `@yohi/justice/core`                                         | **あり**（2.x の root から移動） |
| ランタイム（NodeFileSystem） | `@yohi/justice/runtime`                                      | なし                             |

## 使い方

インストール後、AI エージェントがメッセージ内でプランファイルを参照し、かつ委譲を表すキーワード（例: "plan.md から次のタスクを委譲して"）を含めた場合に、Justice は自動的にアクティブになります。

**委譲のキーワード (英語/日本語):** `delegate`, `next task`, `execute task`, `次のタスク`, `タスクを委譲`, `タスクを実行`, `タスクを開始`

## 開発フロー

Justice を使った開発は、**設計・計画 → 人間承認 → 実装委譲 → 人間承認** という2段階承認モデルで進みます。各コマンド・機能の詳細は後続セクションを参照してください。

```text
   [ 人間 / 開発者 ]                  [ Justice ]                    [ AI エージェント ]
         │                                │                               │
         │                                │                               │
  (1) /justice-start 実行 ───────────────>│                               │
         │                          state チェック                        │
         │                          (design / plan)                       │
         │                                │                               │
         │                          不足あり ────────────────────────────>│
         │                                │                         設計・計画を作成
         │                                │<──────── (再実行) ─────────────┤
         │                                │                               │
         │                          準備完了 / plan_review_required     │
         │                                │                               │
 (1b) /justice-review-gate ─────────────>│                               │
         │                          Design + Plan 可読性確認               │
         │                                │─────────────────────────────>│
         │                                │─────────────────────────────>│
         │                                │          marked sp-final-review task()
         │                                │<──────── structured Gate result ┤
         │                          remediation / clear                    │
         │                                │                               │
  (2) PR を確認・承認・マージ <──────────────────────────────────────────────┤
         ⚠️ Justice はこの承認・マージを検証できない                          │
         │                                │                               │
         │                                │                               │
  (3) /justice-implement --approved ─────>│                               │
         │                          承認済み Plan に含まれる task() を      │
         │                          継続して許可                           │
         │                                │─────────────────────────────>│
         │                                │                         task() で実装
         │                                │<──────── 完了 / 失敗を観測 ────┤
         │                          学習・エスカレーション                  │
         │                          フィードバックを注入                    │
         │                                │─────────────────────────────>│
         │                                │                         PR作成 + AIレビュー依頼
         │                                │                               │
         │──── justice_review で確認 ─────>│                               │
         │                          Gate 評価                              │
         │                          (test / build / review)               │
         │                                │                               │
  (4) 実装 PR を確認・承認・マージ <────────────────────────────────────────────┤
         │                                │                               │
         └─ plan.md 完了 → 同じ承認で次タスクへ / 全完了なら終了 ────────────┘
```

| # | フェーズ | 主体 | 詳細 |
|---|---------|------|------|
| (1) | 設計・計画の準備 | 人間 + エージェント | 「`/justice-start` コマンド」セクション参照 |
| (1b) | Design / Implementation Plan Review Gate | 人間 + エージェント + Justice | `/justice-review-gate --design <path> --plan <path>` で明示開始。Justice が Gate ID / scope / digest と marked `sp-final-review` executor contract を固定し、structured result から remediation / clear を決める |
| (2) | 設計・計画の承認 | **人間のみ** | Gate clear 後も Justice は PR 作成・承認・マージを検証できない |
| (3) | 実装委譲とフィードバック | エージェント + Justice | 「`/justice-implement` コマンド」セクション参照 |
| (4) | 実装の承認 | **人間のみ** | 「Quality Control Plane (v2.0)」セクションの `justice_review` ツール参照 |

> [!NOTE]
> Justice は PR の作成・承認・マージのいずれも代行しません。(2)(4) は既存の権限内で利用可能な機能を使い、常に人間が最終判断します。

## `/justice-start` コマンド

ワークフロー・ブートストラップを明示的に開始するコマンドです。設計・計画ファイルの状態を検査し、設計・計画の準備、`/justice-review-gate` の実行、人間による承認・マージ、実装タスクの委譲という段階別の synthetic 指示を注入します。`plan_review_required` に到達してもレビュー Skill を自動起動せず、Review Gate の開始は必ず `/justice-review-gate` という一意の入口を通ります。

### 有効化（OpenCode側の設定）

`/justice-start`、`/justice-review-gate`、`/justice-implement` は、Justice プラグインの OpenCode v1 `config` hook により自動登録されます。同名の利用者定義は優先して保持します。ただし `/justice-start` の `agent` が現在の設定に存在しない場合は、その `agent` 指定だけを外し、現在の agent にフォールバックします。

この衝突優先の保証は、`config.command` に含まれる利用者定義を対象とします。`.opencode/commands/*.md` で定義したコマンドは OpenCode が別経路で読み込む可能性があり、`config` hook からその定義を確認できません。Markdown 定義との優先順位はサポート対象ホストでの opt-in E2E による確認が必要です。

OpenCode の command registry は LLM の tool list とは別系統です。Justice は `experimental.chat.system.transform` で、解決済み `config.command` に存在する安全な `justice-*` コマンド名だけを LLM の system context に公開します。これは存在認識のためだけであり、slash command を LLM-callable tool に変換しません。特に `/justice-implement --approved` の承認は引き続き利用者による明示操作が必要です。

OpenCode の custom command は「plugin handler で完結する RPC」ではなく **prompt template** です。ホストは command template の `$ARGUMENTS` を展開し、`@path` を解決した後で `command.execute.before` を呼び、その hook が戻ると通常の `prompt()` を続行します。`justice-start` / `justice-implement` と blocked/rejected Review Gate は host が生成した既存 `output.parts` を Justice の canonical synthetic text directive に置換します。成功した `justice-review-gate` は `subtask: true` で **専用 `justice-review-controller` 子 session** を起動します。controller は `permission: {"*":"deny","task":"allow"}` により model-visible tool を `task` だけに限定され、自身ではレビューせず exact reviewer prompt を OmO `task(category="sp-final-review", run_in_background=false)` へ1回だけ委譲します。OpenCode native TaskTool は controller wrapper に限定し、実レビューは OmO category-aware `task` が担当します。

> [!NOTE]
> 自動登録される template は `$ARGUMENTS` です。`$ARGUMENTS` は、コマンド名の後に入力した文字列全体がそのまま渡されるプレースホルダーです（`/justice-start ship the feature --plan plan.md` なら `ship the feature --plan plan.md`）。
> Justice のフックは同じ引数文字列を独自にパースするため、**template の内容自体は Justice の動作に影響しません**。template が決めるのは「LLM に送られるプロンプト」だけで、Justice のガイダンス注入は `output.parts` への追記という別経路で行われます。そのため、最も単純で安全な template は `"$ARGUMENTS"`（入力をそのままプロンプトにする）です。
> `agent` / `model` の指定は **省略可能** です。省略した場合は、現在の会話のエージェント・モデルがそのまま使われます。

### 基本的な使い方

```bash
/justice-start <goal words...> [--design <path>] [--plan <path>]
```

**例:**

```
/justice-start ship the feature --plan docs/plans/feature.md
/justice-start --design docs/design.md --plan docs/plans/feature.md implement the API
/justice-start --design @docs/design.md --plan @docs/plans/feature.md
justice-start add retry logic --plan plan.md
```

### 引数文法

- **`<goal words...>`** (条件付き任意): 通常は非フラグトークンの空白区切り結合。省略時でも `--design` または `--plan` があれば、Justice は固定の安全な workflow goal を使用してコマンドを継続する。artifact も goal もない入力は拒否される。
- **`--design <path>`** (任意): 設計ファイルの相対パス。スペース区切り形式のみ対応（`--design=path` 形式は非対応）。OpenCode の file-reference 記法 `@docs/...` も受理し、Justice 内部では先頭 `@` を除いた相対パスとして扱う。
- **`--plan <path>`** (任意): 計画ファイルの相対パス。OpenCode の `@path` 記法も同様に受理する。
- **フラグの位置**: `--design` / `--plan` は goal の前後どちらに置いても可。

**パス制約:**

- 絶対パス（`/` で始まる）は拒否される。
- バックスラッシュ（`\`）を含むパスは拒否される。
- パストラバーサル（`..`）を含むパスは拒否される。
- `@path` は先頭の `@` を1文字だけ除いてから同じ安全性検証を行う。`@/etc/...`、`@../...`、`@@...` は拒否される。
- 安全でないパスや不正文法が指定された場合、実行自体は fail-open だが、OpenCode が `$ARGUMENTS` から事前展開した command parts を `[JUSTICE: COMMAND REJECTED]` synthetic directive 1件へ置換し、raw arguments や file-reference parts が通常プロンプトとして残らないようにする。

### Artifact 状態表

コマンド実行後、以下のいずれかの状態に遷移します。

| 状態 | 条件 | 次のアクション | 備考 |
|------|------|----------------|------|
| `design_required` | `--design` が指定されていない、または指定ファイルが読めない | `brainstorming` スキルで設計を作成 | Plan が読める場合でも Design 未指定なら設計が優先される。Gate 前は `explore` / `librarian` による読み取り専用の `task()` 調査を許可し、実装 task と実装変更は禁止する。 |
| `plan_required` | Design が指定され読み取り可能だが、計画ファイルが読めない | `writing-plans` スキルで計画を作成 | 計画ファイルが指定されていない場合も含む |
| `plan_ready` | `--design` で指定された Design と Plan の両方が読める | Design / Plan Review Gate の開始を案内 | `activePlanPath` は後続の `task()` 用コンテキストを準備するだけで、実装の認可を意味しない |

### Directive と委譲の接続

Justice は stage ごとに純粋な `WorkflowDirective` を解決します。directive は
`stage`、固定 allowlist の `requiredSkills`、`nextAction`、`authority` を持ち、
自然言語の表示文だけに依存しません。`plan_ready` は
`[JUSTICE: PLAN REVIEW REQUIRED]` を注入し、外部の承認・マージを確認できない
ことを明示します。

`plan_ready` は active plan を設定するだけで、実装 enrichment をアームしません。
後続の `task()` に plan context を渡すには、人間による承認・マージを確認した後、
`/justice-implement --plan <planPath> --approved` を実行する必要があります。

承認済み Plan の実装委譲では、Justice は既存の `skills`、
`loadSkills`、互換入力の `load_skills` を、呼び出し元の順序を保って重複なく内部の
`loadSkills` へ正規化します。そのうえで `test-driven-development` と
`verification-before-completion` を追加し、OMO wire payload の `load_skills` と
`[JUSTICE: IMPLEMENTATION]`、plan context を渡します。Justice 自身はスキルや
`task()` を起動しません。

Adapter は全ての `task()` 呼び出しで、実装委譲がinjectされない場合やAdapterがno-opへ
早期returnする場合も、元の `output.args` objectを差し替えずにsanitize・canonicalize
します。`taskId`、`loadSkills`、`runInBackground` はそれぞれ `task_id`、
`load_skills`、`run_in_background` へ変換され、禁止された routing field は除去されます。

未アーム、または active plan と異なる plan 用の stale arm で `task()` が呼ばれた
場合、Justice は `[JUSTICE: IMPLEMENTATION UNAUTHORIZED]` advisory だけを返します。
plan context、delegation metadata、`task_id`、追加スキルは注入しません。Adapterの
共通wire正規化と禁止field除去は適用されます。advisory は実行を物理的に停止するものでは
ありません。

### フォールバックマーカー

OpenCode のチャットメッセージ内で以下のマーカーを行頭に記述することで、コマンド形式と同じ引数をパースできます。

```
Justice: start workflow ship the feature --plan docs/plans/feature.md
```

**重要な制限:**

- マーカーは **完全一致・大文字小文字を区別** します（`justice: start workflow` や `Justice: Start Workflow` は認識されません）。
- 現在、このマーカーは **OpenCode のチャットメッセージフック内では接続されていません**。つまり、チャットに入力しても起動しません。
- このマーカーは、将来のクロスハーネス統合（他ツールが `parseWorkflowStartFallbackMarker` を直接利用する場合）のための予約された形式です。

### 期待される通知・ログ信号

コマンド実行時、以下のイベントが v2 Observation Log (`.justice/events/**`) に記録されます。

1. **`workflow_started`** — ワークフロー開始イベント（常に記録）
2. **`design_requested`** / **`plan_requested`** / **`plan_activated`** — 状態に応じた遷移イベント（いずれか1件）

これらはすべて **L0 Advisory（監査専用、Gate 判定に影響しない）** です。

**ユーザーへの可視フィードバック:**

コマンド実行後、`output.parts` に synthetic なテキストパートが追記されます。内容は状態に応じて異なります。

- **`design_required`**: `brainstorming` を使って設計し、bounded 判定でも承認済み Design をファイルに保存して利用者の確認を得る。Gate 前は `explore` / `librarian` による読み取り専用の `task()` 調査を許可するが、実装 task と実装変更は禁止する。その後 `writing-plans` で Plan を作成し、Design / Plan の両パスで `/justice-review-gate` を実行するよう案内する。`--design` が指定されていない場合は、Goal や既存 Plan の有無にかかわらずこの状態になる。
- **`plan_required`**: `writing-plans` を使って計画を作成する。保存後は実行方式を選ばず、Design / Plan のパスを利用者に示して `/justice-review-gate --design <designPath> --plan <planPath>` の実行を案内する。Gate が明示的に実行されるまで実装を開始しない。
- **`plan_ready`**: 設計・計画だけの PR を利用可能な連携で準備して AI レビューを依頼し、指摘の修正と同じレビューの再実行を経て、人間による明示的な承認・マージを待つよう自動指示する。確認されるまで `task()` は呼び出さない。

これらの指示はレビュー製品やベンダーを指定しません。エージェントは既存の権限の範囲で利用可能な PR・レビュー機能を実行します。Justice 自身は PR を作成せず、レビューを承認せず、PR をマージせず、PR の作成・承認・マージ状態を推測しません。承認とマージの判断は人間が保持します。

レビュー出力で指摘を観測すると `[JUSTICE: REVIEW REMEDIATION]` を、信頼済みの
完全スナップショットで指摘がない場合は `[JUSTICE: REVIEW CLEAR]` を注入します。
同じレビュー結果の再配送は session・call・結果 hash・完全性フラグで抑止し、
結果が変わった再レビューは新しい観測として扱います。いずれの directive も
人間承認やマージの証拠にはなりません。

### 実行後の `justice_review` 使用法

ワークフロー開始後、作業が進むにつれて `justice_review` ツールでレビュー要約を確認できます。詳細は「Quality Control Plane (v2.0)」セクションの「`justice_review` ツール」を参照してください。

典型的なフローの全体像は「開発フロー」セクションの図を参照してください。`justice_review` 自体は実装委譲サイクルの間や実装 PR 作成後など、任意のタイミングで呼び出せます。人間が承認した指摘だけを、必要に応じて `resolve` パラメータで解決済みにしてください。

## `/justice-review-gate` コマンド

Design と Implementation Plan を **明示的に Review Gate へ投入する入口**です。`/justice-review-gate` 自体が user-invoked authority であり、`/justice-start` の事前実行は必須ではありません。指定された Design / Plan を直接検証し、その内容から Gate ID / scope / digest / exact reviewer prompt を固定します。

```bash
/justice-review-gate --design <designPath> --plan <planPath>
```

OpenCode の file-reference 記法も利用できます。

```bash
/justice-review-gate \
  --design @docs/superpowers/specs/feature-design.md \
  --plan @docs/superpowers/plans/feature-plan.md
```

- `--design` と `--plan` はともに必須。
- 両成果物が読み取り可能な場合だけ `[JUSTICE: REVIEW GATE REQUESTED]` を注入する。この時点で Justice はランダムな Gate ID、正規化済み review scope、Design/Plan の SHA-256 digest、reviewer prompt 全文を pending state として固定する。
- `/justice-review-gate` 自体を review-controller entrypoint とし、実行後に `requesting-code-review` や別の review Skill を起動しない。
- canonical command registration は `agent="justice-review-controller"` + `subtask: true`。controller は内側で exact reviewer prompt を `subagent_type="justice-review-worker"` として一度だけ委譲する。OmO task に `category` を渡すと Sisyphus-Junior に route されるため、Justice は Gate 内部で `sp-final-review` として記録しつつ、wire から category を除去する。worker は read-only、`task`/skill/shell は禁止。
- 実レビューは、pending Gate と完全一致する Justice marker / Gate ID / reviewer prompt を持つ **1回だけの foreground `task()`** として実行する。profile ごとに指定した Justice worker model を使用し、結果は `PostToolUse` の terminal task result として Gate が検証する。
- `code-review` Skill、CodeRabbit CLI、`justice_review` をこの Gate の executor として使用しない。`justice_review` は既存 review state の参照・人間承認済み resolve 用のまま。
- reviewer は prose ではなく、Gate ID / `complete` / findings を含む strict JSON を返す。OmO sync `task` はこの JSON を既知の completion wrapper と `<task_metadata>` で包むため、Justice は raw JSON またはその既知 wrapper の reviewer payload だけを抽出・検証する。reviewScope は Justice-owned pending state を正本とする。
- complete findings があれば exact Gate scope の `review_observed` を永続化して `review_remediation`、complete zero findings なら同じ scope で `review_clear` に遷移する。remediation 後の再レビューも同じ Design/Plan を指定して `/justice-review-gate` を再実行する。
- malformed / incomplete / scope不一致 / Gate ID不一致 / review中の成果物変更 / reviewer実行失敗は `[JUSTICE: REVIEW GATE BLOCKED]` とし、pending Gate を破棄して再実行を要求する。
- marker だけを偽装しても、対応する user-invoked pending Gate がなければ claim できず、通常の mandatory `sp-final-review` authorization boundary を迂回できない。
- `review_clear` はレビュー条件を満たしたことだけを示し、実装許可ではない。Review Gate 開始後は session lock を有効にし、実装可能な tool を拒否する。findings がある間は Design/Plan の修正と再レビューだけが可能。
- findings が空でも、Review Gate の結果後に実装へ自動移行しません。現在の応答を終了し、利用者が `/justice-implement --approved` を実行するまで、読み取りと再レビュー以外の操作を拒否します。lock は同一 OpenCode process 内に限り、再起動後の維持は対象外です。

成果物が読めない場合は `[JUSTICE: REVIEW GATE BLOCKED]` を返し、レビューを dispatch しません。不正文法は `[JUSTICE: COMMAND REJECTED]` として扱われます。

## `/justice-implement` コマンド

アクティブな計画に対して、次の 1 回の `task()` で実装委譲を開始することを明示的に許可するコマンドです。

```bash
/justice-implement --plan <planPath> --approved
```

**例:**

```bash
/justice-implement --plan docs/plans/feature.md --approved
```

### 引数文法

- **`--plan <path>`** (必須): 計画ファイルの相対パス。
- **`--approved`** (アーム成立には必須): 人間による承認・マージが確認済みであることを宣言します。省略時も引数は解析されますが、実装はアームされません。Justice 自身は外部状態を検証できません。

### 動作

- コマンドは `task()` やスキルを起動しません。次の `task()` 呼び出しに対して、Justice が計画コンテキストと実装 directive を注入する権利を 1 回だけ付与します。
- Review Gate lock がある場合、clear 済みの最新 Review Gate と未変更の Plan に限って lock を解除します。findings が残る場合、Gate が未完了の場合、または Design/Plan digest が変わっている場合は arm されません。
- active Review Gate lock の外では、未アーム状態で active plan に対して `task()` が呼ばれた場合に `[JUSTICE: IMPLEMENTATION UNAUTHORIZED]` advisory が注入されます。lock 中は advisory ではなく tool 実行をキャンセルし、task は worker execution へ到達しません。
- 許可は 1 回の `task()` 呼び出しで消費されます。追加のタスクを委譲する場合は、再度 `/justice-implement --plan <planPath> --approved` を実行してください。
- active plan が別のパスへ変更またはクリアされると、未消費の許可も失効します。`/justice-start` を再実行した場合は、同じ plan パスでも再アームが必要です。

> [!IMPORTANT]
> これは、過去の文書にあった `plan_ready` 到達時の暗黙的な実装 enrichment からの動作変更です。現在は active plan の存在だけでは `task()` を強化しません。

### 有効化（OpenCode側の設定）

`/justice-implement` も `/justice-start` と同様、Justice プラグインの OpenCode v1 `config` hook により自動登録されます。同名の利用者定義がある場合は内容を変更せず優先されます。
詳細な挙動（`$ARGUMENTS`、template、衝突時の優先）は `/justice-start` の有効化節を参照してください。

## 推奨 Worker モデルプロファイル

以下は `sp-*` custom category 向けの非規範的な推奨です。実際に利用可能な
モデルの解決と選択は、利用者の `omo.jsonc` に委ねられます。

| Category | Primary | Reasoning | 復旧候補 | 用途 |
| --- | --- | --- | --- | --- |
| `sp-mechanical` | DeepSeek V4 Flash | `low` | Qwen 3.8 Flash `low` → GPT-5.6 Luna `low` | 定型的な単一変更 |
| `sp-implementation` | GLM-5.3 Flash | `high` | DeepSeek V4 Pro `high` → GPT-5.6 Luna `max` | 通常のTDD実装 |
| `sp-review` | Qwen 3.8 Flash | `medium` | DeepSeek V4 Flash `max` → GPT-5.6 Luna `max` | task単位のreview |
| `sp-integration` | DeepSeek V4 Pro | `max` | GLM-5.3 `max` → Grok 4.6 `high` | 複数ファイル、統合、複雑なdebugging |
| `sp-final-review` | GPT-5.6 Sol | `max` | GLM-5.3 `max` → Grok 4.6 `xhigh` | planまたはbranch全体の最終review |

`Reasoning` 列は provider 非依存の論理レベルです。実際の provider 値への mapping は
次のとおりです。DeepSeek は `low` / `high` / `max` に対応し、論理 `medium` と
`xhigh` は `high` へ変換します。Grok 4.6 は `low` / `medium` / `high` / `xhigh`
をそのまま扱います。

| Provider / model | `low` | `medium` | `high` | `xhigh` | `max` | 対応能力の確認 |
| --- | --- | --- | --- | --- | --- | --- |
| DeepSeek | `low` | `high` | `high` | `high` | `max` | 選択モデルの `models` catalog の reasoning capability と provider 仕様を確認 |
| Grok 4.6 | `low` | `medium` | `high` | `xhigh` | 拒否 | 選択モデルの `models` catalog の reasoning capability と provider 仕様を確認 |

表にない値、または選択モデルの対応能力を確認できない値は、プロファイル上は拒否します。
上記の明示した変換以外の暗黙的な downgrade、別モデルへの自動切替、category escalation は行いません。
対応能力は調査時点の `models` catalog の capability metadata または reasoning enum と
provider 公式仕様を照合して確認し、確認日・catalog revision・対象モデルを記録します。

高頻度の機械的変更、通常実装、task単位のreviewには効率重視のモデルを使い、
低頻度の統合・最終reviewでより高い推論予算を使います。標準の `sp-*` chain には
Claude と Kimi K3 を含めません。確認日: 2026-09-02。

> [!NOTE]
> この表は強制設定ではありません。設定時には各モデルを利用可能なモデル名または
> `models` catalog のaliasへ対応付けてください。`models[]` は選択・実行時復旧の順序であり、
> 能力不足を検出して上位categoryへ自動昇格させる機構ではありません。
> `sp-implementation` を `sp-integration` として再実行する場合は、計画を更新して
> 明示的に再委譲してください。

## Quality Control Plane (v2.0)

Justice は v1 のタスク委譲支援に加えて、**Observation Log + Gate Engine** による品質管理基盤（Quality Control Plane）を並走稼働させています。これは v1 の挙動を変更しない「加算シャドウ」レイヤーであり、**L0 Advisory（非ブロッキング）** としてのみ動作します — Gate が FAIL を返してもツール実行やタスク完了は妨げません。
> [!NOTE]
> Quality Control Plane (v2.0) は v3.0.0 以降、L0 Advisory（非ブロッキング）として標準稼働しています。詳細な実証結果および既知の動作仕様は [SPEC.md §15.12](./SPEC.md#1512-既知の未解決事項ガバナンス状況重要) を参照してください。

### 診断（`justice doctor`）

プラグインのロードに失敗すると Justice 自身は実行されないため、ロード状態はプラグイン外部の診断 CLI で確認します。

```bash
bunx @yohi/justice doctor
# ローカルビルドの場合
./dist/runtime/doctor-cli.js doctor
```

診断対象は、global / project / `OPENCODE_CONFIG` / `OPENCODE_CONFIG_DIR` の設定ソースにある Justice エントリ、specifier の解決、OpenCode ローダ契約、OpenCode ログの `failed to load plugin` / Justice 初期化記録、`.justice/` の観測データ、`.justice/gate.yaml` です。検査失敗時は非ゼロ終了します。これはセッションを停止させない CLI に限った fail-open の例外です。

Justice エントリは部分文字列では判定しません。パッケージ specifier は version / subpath を除いた base name が `justice` または `justice-` で始まる場合だけ、絶対パス entry はパス segment が `justice` または `justice-` で始まる場合だけ検出します。したがって `injustice-report` や `no-justice-helper` は検出対象外です。

v3.0.0 未満では root specifier の配布エントリがプラグイン契約に適合せずロードに失敗する問題がありました。root specifier を利用する場合は v3.0.0 以降へ更新してください。

**controller configuration 診断（v4.0.0）**: サポート対象ホスト（OpenCode `1.18.29`）では `opencode debug config` で解決した実効設定（host-resolved snapshot）を authority として、必須 `sp-*` category の有無に加えて、4つの pinned command（`justice-implement-brainstorming` / `justice-implement-writing-plans` / `justice-implement-subagent-driven-development` / `justice-implement-executing-plans`）の `agent` が desired controller（`sisyphus` / `atlas`）と exact 一致するかを診断します。結果はコマンド単位で `configured` / `missing` / `misconfigured` / `unsupported` として表示され、未設定・不一致時には4件すべての修復テンプレート（`command.<name>.agent`）を出力します。

- **`configured != applied`**: doctor の `configured` は設定上の exact 一致を示すだけで、実行時にその controller への委譲が適用・観測されたことを意味しません。
- **`local source scan != configured authority`**: 設定ファイルのローカル走査（`SOURCE_PRIORITY` スキャン）は非 authority の修復ヒントとしてのみ表示されます。controller 設定の authority は常に host-resolved snapshot であり、ホスト検証や resolved config 取得が unavailable / failed / timeout / unparseable / context-unverified の場合は `unsupported` となり、ローカル設定に完全な4件があっても `configured` にはなりません。
- **advisory**: controller 設定の findings（missing / misconfigured）は L0 advisory であり終了コードに影響しません。host-resolved config の `unsupported` は従来どおり非ゼロ終了となります。
- **redaction**: 診断には pinned command 名・診断状態・（`agent_invalid` / `agent_mismatch` 時の）設定済み agent 名・desired controller 以外の設定値（コマンド本文、provider option、認証情報、無関係の設定値）は含まれず、secret は最終出力時に redact されます。`opencode debug config` の生の stdout/stderr は決して出力されません。

- **全ツール・メッセージ観測**: `tool.execute.*` / `message.*` イベントを `.justice/events/<agentId>/<sessionId>/<writerId>.jsonl` へ追記専用（append-only）で記録します。テスト実行結果・lint/build 出力・レビュー指摘などが対象です（コード本文やチャット全文は保持しません）。
- **品質ゲート (`.justice/gate.yaml`)**: タスク完了時（`task_complete`）およびツール実行観測時（`tool_observed`）に、テスト・ビルド・未解決レビュー指摘を判定します。既定は3種の gate（`required-tests` / `build-green` / `review-clean`）で、それぞれテスト合格・ビルド合格・未解決レビュー指摘の不存在を判定し、すべて `warn`（advisory）始まりです。lint は既定 gate には含まれず、プロジェクトの `.justice/gate.yaml` でカスタム gate を追加した場合のみ対象となります。カスタム gate の記述時、タスクゲートの `trigger.scope` は省略可能（自動で `task` が補完されます。計画ゲートは `plan` の明示が必須）です。また、ゲート評価はツール呼び出し識別子（`callId`）に厳格に拘束され、並行実行時のタスク混同や無関係なセッションの誤判定を構造的に遮断します。既定 gate を上書き・無効化（`enabled: false`）することもできます。
- **`justice_review` ツール**: エージェントが呼び出せる唯一の公開カスタムツールです。`scope` 未指定で全体のレビュー要約（critical/major/minor、open/resolved）を表示し、`resolve: { itemKeys, artifactRef }` を渡すと人間承認（`context.ask`）を経て該当指摘を解決済みにできます。
- **Provenance（証拠の出自）**: 「テストが通った」というエージェントの自己申告（`declared`）だけでは Gate は PASS しません。Justice が実際にツール実行を観測した（`observed`/`derived`）場合のみ PASS 算入されます。
- **Fail-Open**: Observation Log の書込・読込・投影（projection）のいずれかが失敗しても、セッションを停止せず必要に応じてログを記録したうえで `PROCEED` に縮退します。

## コアコンポーネント

| コンポーネント | 層 | 目的 |
|-----------|-------|---------|
| `PlanParser` | Core | `plan.md` を解析して `PlanTask[]` を生成、チェックボックスの更新 |
| `AgentRouter` | Core | ワークフロー名からControllerを解決する。Workerのrole/category判定は`ExecutionRoleClassifier`とrouting factoryが担う |
| `TaskPackager` | Core | `PlanTask` から構造化された `DelegationRequest` に変換し、`AGENT` ヘッダを埋め込む |
| `TriggerDetector` | Core | プランの参照と委譲の意図を検出、および `/justice-start` ワークフロー起動リクエストのパース |
| `ErrorClassifier` | Core | エラーを分類し、リトライの可否を判定 |
| `FeedbackFormatter` | Core | `task()` の生の出力を解析して `TaskFeedback` に変換 |
| `DependencyAnalyzer` | Core | `(depends: task-N)` マーカーの解析、トポロジカルソート |
| `CategoryClassifier` | Core | キーワードに基づいて OmO のタスクカテゴリを自動選択 |
| `ProgressReporter` | Core | タスクリストから進捗レポートを生成 |
| `SmartRetryPolicy` | Core | 指数バックオフとコンテキスト削減を実施 |
| `TaskSplitter` | Core | 失敗時にサブタスクへの分割提案を生成 |
| `WisdomStore` | Core | LRU キャッシュ削除機構付きのインメモリ学習ストア |
| `LearningExtractor` | Core | `TaskFeedback` から学習内容を抽出 |
| `WisdomPersistence` | Core | `WisdomStore` と `.justice/wisdom.json` 間の永続化・復元 |
| `AtomicPersistence` | Core | version ベース楽観ロック + owner-verified atomic claim による並行書込安全な JSON 永続化プリミティブ（SPEC §5.23） |
| `WisdomMetrics` / `WisdomArchive` | Core | hit 等メタデータの copy-on-write 更新（SSoT）と LRU eviction エントリのアーカイブ（SPEC §5.24） |
| `TelemetryStore` | Core | プラン単位のテレメトリ集計（`failureRate` / `wisdomHitRate` / `errorDistribution`、SPEC §5.25） |
| `RetryPolicyCalculator` | Core | category/stepCount からの動的リトライ閾値算出（SPEC §5.26） |
| `StatusCommand` | Core | プログラムから利用可能なプランステータス API |
| `JusticePlugin` | Core | オーケストレーター — イベントをルーティングし、`WisdomStore` を共有 |
| `PlanBridge` | Hook | `Message`/`PreToolUse` 時の委譲ブリッジおよびエージェント状態の同期、`/justice-start` ワークフロー・ブートストラップ状態の管理 |
| `TaskFeedbackHandler` | Hook | `PostToolUse` 時のフィードバックループ |
| `CompactionProtector` | Hook | コンパクション発生時にプランの状態をスナップショット化 |
| `LoopDetectionHandler` | Hook | ループ検出時に強制中断、試行履歴の追跡、および `sisyphus` 等へのエスカレーションを行う |
| `OpenCodeAdapter` | Runtime | OpenCode `Plugin` ↔ `HookEvent` の双方向変換と Fail-Open 境界 |
| `NodeFileSystem` | Runtime | `Bun.file` を基盤とした `FileReader`/`FileWriter` 実装 |
| `TieredWisdomStore` | Core | プロジェクトローカルとユーザーグローバルの2層 Wisdom ストア |
| `SecretPatternDetector` | Core | 秘密情報の自動検出（API キー、パスワード等） |
| `ObservationHandler` | Hook | 全 tool/message 観測を Observation Log へ記録し、Gate 評価を発火 |
| `ObservationLogStore` | Runtime | per-writer segment JSONL への直列化 atomic append + shard 横断 readAll |
| `rule-evaluation-engine` (`evaluate`) | Core | Gate ルール（evidence_present/evidence_outcome/review_open_items）の判定 |
| `GateLoader` | Runtime | `.justice/gate.yaml` の読込・検証・既定 gate へのマージ／フォールバック |
| `review-aggregator` | Core | レビュー指摘（`review_observed`）を scope 別に集約し open/resolved を判定 |
| `SessionStateProvider` | Core | `sessionId → AgentId` マッピングと `callId` 単位の task 窓管理 |
| `justice_review` | Tool | レビュー要約の表示・（承認を経た）指摘解決を行う唯一の公開カスタムツール |

## Cross-Project Wisdom Store

Justice stores learnings in two places:

| Scope | Default path | Default categories (auto-routed) |
|-------|-------------|----------------------------------|
| Project-local | `.justice/wisdom.json` | `failure_gotcha`, `design_decision` |
| User-global | `~/.justice/wisdom.json` (or `$JUSTICE_GLOBAL_WISDOM_PATH`) | `environment_quirk`, `success_pattern` |

Routing is overridable per call:

```ts
plugin.getTieredWisdomStore().add(
  { taskId, category: "environment_quirk", content: "…" },
  { scope: "local" }, // override — stay project-local
);
```

Reads combine both stores with **local-priority**: if the local store already
has `maxEntries` relevant matches, those are returned; otherwise the remainder
is filled from the global store (newest-first within each store).

### Invisible Advisor flows

Justice now also acts as an invisible advisor for SDD-oriented agent workflows:

- **Atlas guidance**: when `writing-plans` completes, PostToolUse injects an Atlas Guidance Directive that tells Atlas to delegate the next plan step instead of implementing it directly.
- **Persona-scoped wisdom**: stored learnings are namespaced by persona (`atlas`, `hephaestus`, `sisyphus`, `prometheus`) and task delegation injects only the matching namespace.
- **Prometheus pivot**: repeated review rejections from Prometheus trigger a Hephaestus architecture-pivot directive after the configured threshold.
- **Sisyphus debugging wisdom**: `systematic-debugging` root-cause output is saved into the Sisyphus namespace for future debugging sessions.
- **Toast-equivalent notifications**: injected guidance starts with a visible banner and is also sent through the OpenCode app log notifier.

### Secret detection

Entries promoted to the global store are scanned for common secret-like
patterns (API keys, home-directory paths, `sk-…` / `sk-ant-…` shapes, etc.).
Matches **trigger a warning log and the promotion is cancelled**; the entry 
is saved to the **project-local** store instead to prevent secret leakage. 
Review the content and redact any secrets if you intended to share it globally.

### Environment variable

- `JUSTICE_GLOBAL_WISDOM_PATH` — **absolute path** to the global wisdom file.
  Relative paths are rejected with a warning and disable the global store.
  When unset, defaults to `~/.justice/wisdom.json`. When `HOME` cannot be
  determined and this variable is unset, the global store is disabled
  (local-only) and a warning is logged.

### 多層エラーハンドリング

Justice は 3層構造のエラー戦略を実装しています：

| 層 | 対象エラー | アクション |
| :--- | :--- | :--- |
| **第1層** (自動修正) | `syntax_error`, `type_error` (最大 3 リトライ) | エージェントに通知せず進行（OmO が自動修正を実施） |
| **第2層** (エスカレーション) | `test_failure`, `design_error` | `plan.md` にエラーの注記を追記; systematic-debugging のガイダンスを注入 |
| **プロバイダ層 (一時的)** | `provider_transient` (Rate Limit等) | 一時的な失敗として OmO の基盤再試行に委ねる |
| **プロバイダ層 (設定)** | `provider_config` (API Key等) | 設定/認証エラーとしてユーザーに介入と修正を要求する |
| **中断 (Abort)** | `timeout`, `loop_detected` | タスク分割の指示をコンテキストに注入 |

## Future

以下は構想段階のロードマップです。個別の実装計画、API、完了条件にはまだ分解していません。Justice は `plan.md` を計画の唯一の真実源として尊重し、既存の Superpowers と oh-my-openagent の責務を置き換えずに品質保証を拡張します。

### Feature 品質の検証

現在の Gate は観測したツール実行とタスク完了を対象とする L0 Advisory です。将来は、設計・計画・実装・レビュー・E2E データフロー・回帰を横断して確認する Feature-level Final Verification を追加し、Task 成功と Feature 成功の差異を早期に可視化します。

### トレーサビリティと要求カバレッジ

要求そのものは Superpowers 側の成果物として管理し、Justice は要求 ID と設計、計画、Task、PR、コミット、テストの対応関係をリンクします。これにより、コードカバレッジだけでは分からない要求・設計・計画・テストの未対応箇所を検出できるようにします。

### 学習可能な品質保証

既存の Wisdom とレビュー却下・失敗の学習基盤を発展させ、繰り返される不具合、設計上の匂い、セキュリティ指摘、Gate の見逃しを次回のレビューと検証に活用します。プロジェクト横断の知見共有は、秘密情報の保護と利用者による統制を前提に検討します。

### Gate とリリース判断の拡張

認証、データベース、決済など変更の性質に応じた Gate は、AI が候補を提案し、人間が承認した静的ルールとして適用する方針です。Gate、証跡、レビュー、回帰結果を集約した Release Readiness Score も検討します。

### 将来の強制モデル

現行の OpenCode Plugin API と Fail-Open 原則の下で、Justice は判定と強い誘導を担う Quality Coordinator として動作します。Feature 単位の実行停止やポリシー強制は現時点のプラグイン境界では実現できないため、OpenCode API または oh-my-openagent の実行層に適切な制御点が提供された場合にのみ、将来の Policy Engine として検討します。

### 設計時に解決する前提

将来機能を実装する前に、観測可能な境界と手動証跡の扱い、並列エージェントによる書き込み安全性、データスキーマのバージョニング、ログの保持期間と容量上限、証跡に含まれる秘密情報の保護を定義します。

## 開発用コマンド

```bash
bun run test            # 全テストの実行
bun run test:watch      # 監視モード
bun run test:coverage   # カバレッジ・レポートの出力
bun run typecheck       # tsc --noEmit
bun run lint            # ESLint
bun run format          # Prettier によるフォーマット
bun run build           # dist/ ディレクトリへのコンパイル
bun run build:native:review-artifact # Linux native N-API アドオンのビルド
```

## 開発環境

完全に独立し、再現性のある開発環境として Devcontainer の設定が含まれています。
VS Code の **Remote Containers** 拡張機能を使用してリポジトリを開いてください。

## プロジェクト・ステータス

| フェーズ | 説明 | 状態 |
|-------|-------------|--------|
| 1 | 基盤の構築 (型、パーサー、足場作り) | ✅ 完了 |
| 2 | タスク委譲ブリッジ (Task Delegation Bridge) | ✅ 完了 |
| 3 | フィードバックループ (Feedback Loop) | ✅ 完了 |
| 4 | 高度なエラーハンドリング (Advanced Error Handling) | ✅ 完了 |
| 5 | 学習の統合 (Wisdom Integration) | ✅ 完了 |
| 6 | マルチエージェント協調 (Multi-Agent Coordination) | ✅ 完了 |
| 7 | プラグインオーケストレーターとランタイム | ✅ 完了 |
| 8 | OpenCode Plugin 統合 (`@yohi/justice/opencode` エントリ) | ✅ 完了 (v1.2.0) |
| 9 | 不可視の参謀 (Invisible Advisor) の実装 | ✅ 完了 |
| 10 | v2.0 Quality Control Plane 基盤 (Observation Log / Gate Engine / Review Aggregator) | ✅ 完了 (v3.0.0) |

※1: v2.0 Quality Control Plane は L0 Advisory として実装完了し、2026-08-04 の実機実証・レイテンシ再計測・ADR ratification により出荷完了条件が充足されました。ただし `enableAdvisoryOutputAppend`（`output.output` への banner 追記）はオプトインの best-effort 機能として既定 `false` のまま維持され、headless `opencode run` 経路では `.justice/events` への ObservationRecord 書き込みが観測されなかった限界があります。詳細は [SPEC.md §15.12](./SPEC.md#1512-既知の未解決事項ガバナンス状況重要) を参照してください。

## ドキュメント

- **[SPEC.md](./SPEC.md)** — 完全な仕様書 (アーキテクチャ、データモデル、コンポーネント仕様、API)
- **[AGENTS.md](./AGENTS.md)** — このプロジェクト向けの AI エージェントのコーディングガイドライン
- **[upstream-drift.md](./docs/agents/upstream-drift.md)** — upstream compatibility audit と再検証手順
- **[review-artifact-linux-provider.md](./docs/agents/review-artifact-linux-provider.md)** — Linux Review Artifact Provider の検証条件と監査証跡
