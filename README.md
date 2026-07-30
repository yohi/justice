# Justice Plugin

> Superpowers と oh-my-openagent を繋ぐ神経系プラグイン。

![Tests](https://img.shields.io/badge/tests-1469%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue)
![Bun](https://img.shields.io/badge/runtime-Bun-black)

## これは何？

Justice は、以下の2つの間のギャップを埋める **OpenCode プラグイン** です。

- **[Superpowers](https://github.com/oh-my-openagent/superpowers)** — Markdownのプランファイルを通じた宣言的なAIプロジェクト管理
- **[oh-my-openagent](https://github.com/oh-my-openagent)** — `task()` ツールを備えたイベント駆動型のAI実行エンジン

Justice がない環境では、`plan.md` のチェックボックスリストと `task()` への委譲呼び出しの間に自動的な連携はありません。Justice は「神経系」として機能することでこのギャップを埋めます。具体的には、委譲の意図を検出し、プランを解析し、コンテキストをパッケージ化し、結果を処理し、さらに得られた学習内容を今後のタスクにフィードバックします。

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

## 使い方

インストール後、AI エージェントがメッセージ内でプランファイルを参照し、かつ委譲を表すキーワード（例: "plan.md から次のタスクを委譲して"）を含めた場合に、Justice は自動的にアクティブになります。

**委譲のキーワード (英語/日本語):** `delegate`, `next task`, `execute task`, `次のタスク`, `タスクを委譲`, `タスクを実行`, `タスクを開始`

## `/justice-start` コマンド

ワークフロー・ブートストラップを明示的に開始するコマンドです。設計・計画ファイルの状態を検査し、設計・計画の準備、設計・計画 PR の自動レビュー、人間による承認・マージ、実装タスクの委譲という段階別の synthetic 指示を自動注入します。利用者が入力するのは目標と成果物パスだけで、PR 作成やレビュー依頼の定型プロンプトをコピーしたり入力したりする必要はありません。

### 有効化（OpenCode側の設定）

> [!IMPORTANT]
> `/justice-start` は **OpenCode の組み込みコマンドではありません**。Justice の `command.execute.before` フックは、`justice-start` という名前の OpenCode コマンドが実際に存在し実行されたときにのみ発火します。したがって、**利用者自身がコマンドを登録しない限りコマンド自体が存在せず、`/justice-start` は使えません**。Justice プラグインはこの設定をランタイムで書き込みません（「プラグイン/フックの登録」と同様、設定ファイルへの記述は利用者側の作業です）。

登録方法は次の 2 通りです。どちらか一方を選べば有効化されます。

**方法 A: Markdown ファイル**

`.opencode/commands/justice-start.md`（プロジェクト単位）または `~/.config/opencode/commands/justice-start.md`（グローバル）を作成します。**ファイル名がコマンド名になります。** frontmatter がメタデータ、本文が template（LLM に送られるプロンプト）です。

```markdown
---
description: Start a Justice-managed development workflow
---
$ARGUMENTS
```

**方法 B: `opencode.jsonc` の `command` オブジェクト**

設定ファイルの `command` オブジェクトに、コマンド名をキーとして登録します。`template` は **必須** プロパティです。

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "command": {
    "justice-start": {
      "template": "$ARGUMENTS",
      "description": "Start a Justice-managed development workflow"
    }
  }
}
```

**`$ARGUMENTS` と template について:**

- `$ARGUMENTS` は、コマンド名の後に入力した文字列全体がそのまま渡されるプレースホルダーです（`/justice-start ship the feature --plan plan.md` なら `ship the feature --plan plan.md`）。
- Justice のフックは同じ引数文字列を独自にパースするため、**template の内容自体は Justice の動作に影響しません**。template が決めるのは「LLM に送られるプロンプト」だけで、Justice のガイダンス注入は `output.parts` への追記という別経路で行われます。そのため、最も単純で安全な template は `"$ARGUMENTS"`（入力をそのままプロンプトにする）です。
- どちらの方式でも `agent` / `model` の指定は **省略可能** です。省略した場合は、現在の会話のエージェント・モデルがそのまま使われます。

### 基本的な使い方

```bash
/justice-start <goal words...> [--design <path>] [--plan <path>]
```

**例:**

```
/justice-start ship the feature --plan docs/plans/feature.md
/justice-start --design docs/design.md --plan docs/plans/feature.md implement the API
justice-start add retry logic --plan plan.md
```

### 引数文法

- **`<goal words...>`** (必須): 非フラグトークンの空白区切り結合。最低1語以上必要。
- **`--design <path>`** (任意): 設計ファイルの相対パス。スペース区切り形式のみ対応（`--design=path` 形式は非対応）。
- **`--plan <path>`** (任意): 計画ファイルの相対パス。スペース区切り形式のみ対応。
- **フラグの位置**: `--design` / `--plan` は goal の前後どちらに置いても可。

**パス制約:**

- 絶対パス（`/` で始まる）は拒否される。
- バックスラッシュ（`\`）を含むパスは拒否される。
- パストラバーサル（`..`）を含むパスは拒否される。
- 安全でないパスが指定された場合、コマンドは `null` を返し、エラーメッセージなしで処理を続行する（fail-open）。

### Artifact 状態表

コマンド実行後、以下のいずれかの状態に遷移します。

| 状態 | 条件 | 次のアクション | 備考 |
|------|------|----------------|------|
| `design_required` | `--design` で指定されたファイルが読めない | `brainstorming` スキルで設計を作成 | 計画ファイルが読める場合でも、設計が優先される |
| `plan_required` | 設計は OK だが、計画ファイルが読めない | `writing-plans` スキルで計画を作成 | 計画ファイルが指定されていない場合も含む |
| `plan_ready` | 計画ファイルが読める | 設計・計画だけの PR を準備して自動レビューを依頼し、人間による明示的な承認・マージを待つ | `activePlanPath` は後続の `task()` 用コンテキストを準備するだけで、実装の認可を意味しない |

### Directive と委譲の接続

Justice は stage ごとに純粋な `WorkflowDirective` を解決します。directive は
`stage`、固定 allowlist の `requiredSkills`、`nextAction`、`authority` を持ち、
自然言語の表示文だけに依存しません。`plan_ready` は
`[JUSTICE: PLAN REVIEW REQUIRED]` を注入し、外部の承認・マージを確認できない
ことを明示します。

`plan_ready` は active plan を設定するだけで、実装 enrichment をアームしません。
後続の `task()` に plan context を渡すには、人間による承認・マージを確認した後、
`/justice-implement --plan <planPath> --approved` を実行する必要があります。

明示的にアームされた次の1回の `task()` に限り、Justice は既存の `skills`、
`loadSkills`、互換入力の `load_skills` を、呼び出し元の順序を保って重複なく
`loadSkills` へ正規化します。そのうえで `test-driven-development` と
`verification-before-completion` を追加し、`[JUSTICE: IMPLEMENTATION]` と plan
context を渡します。Justice 自身はスキルや `task()` を起動しません。

未アーム、または active plan と異なる plan 用の stale arm で `task()` が呼ばれた
場合、Justice は `[JUSTICE: IMPLEMENTATION UNAUTHORIZED]` advisory だけを返します。
plan context、delegation metadata、`taskId`、追加スキルは注入せず、呼び出し元の
prompt 以外の引数を変更しません。advisory は実行を物理的に停止するものではありません。

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

- **`design_required`**: `brainstorming` を使って要件、境界、テスト方針、未確定事項を設計するよう自動指示する。
- **`plan_required`**: `writing-plans` を使って設計を検証可能なタスク、依存関係、完了条件へ分解するよう自動指示する。
- **`plan_ready`**: 設計・計画だけの PR を利用可能な連携で準備して AI レビューを依頼し、指摘の修正と同じレビューの再実行を経て、人間による明示的な承認・マージを待つよう自動指示する。確認されるまで `task()` は呼び出さない。

これらの指示はレビュー製品やベンダーを指定しません。エージェントは既存の権限の範囲で利用可能な PR・レビュー機能を実行します。Justice 自身は PR を作成せず、レビューを承認せず、PR をマージせず、PR の作成・承認・マージ状態を推測しません。承認とマージの判断は人間が保持します。

レビュー出力で指摘を観測すると `[JUSTICE: REVIEW REMEDIATION]` を、信頼済みの
完全スナップショットで指摘がない場合は `[JUSTICE: REVIEW CLEAR]` を注入します。
同じレビュー結果の再配送は session・call・結果 hash・完全性フラグで抑止し、
結果が変わった再レビューは新しい観測として扱います。いずれの directive も
人間承認やマージの証拠にはなりません。

### 実行後の `justice_review` 使用法

ワークフロー開始後、作業が進むにつれて `justice_review` ツールでレビュー要約を確認できます。詳細は「Quality Control Plane (v2.0)」セクションの「`justice_review` ツール」を参照してください。

**典型的なフロー:**

1. 利用者が `/justice-start` に目標と必要な成果物パスだけを渡す。
2. Justice が `design_required` / `plan_required` に応じて設計・計画準備の指示を自動注入する。
3. `plan_ready` になると、Justice が設計・計画だけの PR と自動レビューを進める指示を自動注入する。利用者が PR・レビュー用の定型プロンプトをコピーしたり入力したりする必要はない。
4. エージェントが既存の権限で利用可能な PR・レビュー機能を実行し、指摘を修正してレビューを再実行する。
5. 人間が設計・計画を明示的に承認してマージする。Justice はこの状態を推測しないため、外部での確認が必要になる。
6. 承認・マージの確認後、エージェントが `/justice-implement --plan <planPath> --approved` を実行し、次の1回の実装委譲を明示的にアームする。
7. エージェントが `task()` で次のタスクを委譲する。Justice はアームされた呼び出しだけにプランコンテキスト、TDD・検証スキル、実装 PR のレビュー指示を追加する。
8. 実装 PR でも利用可能な AI レビューを行い、最終的な承認・マージ判断は人間が行う。
9. 任意のタイミングで `justice_review` を呼び出し、テスト・ビルド・レビュー指摘の状態を確認する。人間が承認した指摘だけを、必要に応じて `resolve` パラメータで解決済みにする。

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
- 未アーム状態で active plan に対して `task()` が呼ばれた場合、または plan.md 言及による委譲が発生した場合、`[JUSTICE: IMPLEMENTATION UNAUTHORIZED]` advisory だけが注入されます。plan context、delegation metadata、`taskId`、追加スキルは渡されません。`task()` 呼び出しの場合、advisory は prompt に注入されますが、それ以外の引数は変更されません。
- 許可は 1 回の `task()` 呼び出しで消費されます。追加のタスクを委譲する場合は、再度 `/justice-implement --plan <planPath> --approved` を実行してください。
- active plan が別のパスへ変更またはクリアされると、未消費の許可も失効します。`/justice-start` を再実行した場合は、同じ plan パスでも再アームが必要です。

> [!IMPORTANT]
> これは、過去の文書にあった `plan_ready` 到達時の暗黙的な実装 enrichment からの動作変更です。現在は active plan の存在だけでは `task()` を強化しません。

### 有効化（OpenCode側の設定）

`/justice-start` と同様に、`/justice-implement` は OpenCode の組み込みコマンドではありません。利用者がコマンドを登録する必要があります。

**`.opencode/commands/justice-implement.md`**:

```markdown
---
description: Arm the next Justice-managed implementation delegation
---
$ARGUMENTS
```

## Quality Control Plane (v2.0)

Justice は v1 のタスク委譲支援に加えて、**Observation Log + Gate Engine** による品質管理基盤（Quality Control Plane）を並走稼働させています。これは v1 の挙動を変更しない「加算シャドウ」レイヤーであり、**L0 Advisory（非ブロッキング）** としてのみ動作します — Gate が FAIL を返してもツール実行やタスク完了は妨げません。
> [!NOTE]
> 本機能はL0 Advisoryとして実装・動作していますが、`output.output`へのadvisory反映の実機検証と、設計乖離ADRの人間CODEOWNERS承認が未完了のため、出荷完了宣言の前提は未充足です（[SPEC.md §15.12](./SPEC.md#1512-既知の未解決事項ガバナンス状況重要)）。

- **全ツール・メッセージ観測**: `tool.execute.*` / `message.*` イベントを `.justice/events/<agentId>/<sessionId>/<writerId>.jsonl` へ追記専用（append-only）で記録します。テスト実行結果・lint/build 出力・レビュー指摘などが対象です（コード本文やチャット全文は保持しません）。
- **品質ゲート (`.justice/gate.yaml`)**: タスク完了時（`task_complete`）およびツール実行観測時（`tool_observed`）に、テスト・ビルド・未解決レビュー指摘を判定します。既定は3種の gate（`required-tests` / `build-green` / `review-clean`）で、それぞれテスト合格・ビルド合格・未解決レビュー指摘の不存在を判定し、すべて `warn`（advisory）始まりです。lint は既定 gate には含まれず、プロジェクトの `.justice/gate.yaml` でカスタム gate を追加した場合のみ対象となります。既定 gate を上書き・無効化（`enabled: false`）することもできます。
- **`justice_review` ツール**: エージェントが呼び出せる唯一の公開カスタムツールです。`scope` 未指定で全体のレビュー要約（critical/major/minor、open/resolved）を表示し、`resolve: { itemKeys, artifactRef }` を渡すと人間承認（`context.ask`）を経て該当指摘を解決済みにできます。
- **Provenance（証拠の出自）**: 「テストが通った」というエージェントの自己申告（`declared`）だけでは Gate は PASS しません。Justice が実際にツール実行を観測した（`observed`/`derived`）場合のみ PASS 算入されます。
- **Fail-Open**: Observation Log の書込・読込・投影（projection）のいずれかが失敗しても、セッションを停止せず必要に応じてログを記録したうえで `PROCEED` に縮退します。

## コアコンポーネント

| コンポーネント | 層 | 目的 |
|-----------|-------|---------|
| `PlanParser` | Core | `plan.md` を解析して `PlanTask[]` を生成、チェックボックスの更新 |
| `AgentRouter` | Core | タスクのカテゴリやスキルに基づいて最適なエージェントへ委譲をルーティングする |
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
| 10 | v2.0 Quality Control Plane 基盤 (Observation Log / Gate Engine / Review Aggregator) | 🟡 実装完了・ガバナンス未完了（※1） |

※1: L0 Advisoryとしてコードは実装・動作していますが、(a) `output.output` への advisory 反映の実機検証（C1）が未完了、(b) 憲章乖離 ADR（`docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md`）の人間 CODEOWNERS 承認が未取得（現在 `PENDING HUMAN CODEOWNERS RATIFICATION`）のため、設計上の前提条件は未充足です。詳細は [SPEC.md §15.12](./SPEC.md#1512-既知の未解決事項ガバナンス状況重要) を参照してください。

## ドキュメント

- **[SPEC.md](./SPEC.md)** — 完全な仕様書 (アーキテクチャ、データモデル、コンポーネント仕様、API)
- **[AGENTS.md](./AGENTS.md)** — このプロジェクト向けの AI エージェントのコーディングガイドライン
