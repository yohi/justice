# Justice Plugin

> Superpowers と oh-my-openagent を繋ぐ神経系プラグイン。

![Tests](https://img.shields.io/badge/tests-327%20passing-brightgreen)
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
plan.md                 →   フック層 (Hook Layer):                →   task()
design.md               →     plan-bridge (Message/PreToolUse)  →   background_output()
role-prompt.md          →     task-feedback (PostToolUse)        ←   compaction イベント
                        →     compaction-protector (Event)        ←   loop-detector イベント
                        →     loop-handler (Event)
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

Justice Plugin の導入は、AIエージェント（Gemini CLI / Cursor / GitHub Copilot 等）に丸投げしてください。
以下のプロンプトをコピーして渡すだけで、**GitHub Packages の認証からプラグインの有効化まで**、すべてが完了します。

```text
Install and configure @yohi/justice by following the instructions at:
https://raw.githubusercontent.com/yohi/justice/refs/heads/master/README.md
```

<details>
<summary><b>For Agents (AIエージェント向け手順)</b></summary>

あなたがターミナル操作可能なAIエージェントであるなら、以下の手順に従って自律的にセットアップを遂行してください：

**Requirements (GitHub Packages 版の場合):**
1. **Setup .npmrc** with `@yohi:registry=https://npm.pkg.github.com`
2. **Add "@yohi/justice"** to the `plugins` array in `opencode.jsonc`

**Requirements (ソースコードビルド版の場合):**
1. **Clone this repository** to a local directory.
2. **Run `bun run build`** to generate `dist/`.
3. **Register hooks** in `opencode.jsonc` pointing to the local `dist/` files.

**Action Plan:**
1.  **[ ] 導入パターンの決定:** ユーザーに確認し（`ask_user` 等のインタラクション手段を使用）、GitHub Packages (安定版) か ソースコードビルド (最新版/開発者用) かを選択してもらってください。
    *   **Fallback:** インタラクションが不可能な場合は、最もクリーンな **GitHub Packages 版** をデフォルトとして選択してください。
2.  **[ ] GitHub Packages の認証設定 (Packages版のみ):** プロジェクトのルートに `.npmrc` を作成し、`@yohi:registry=https://npm.pkg.github.com` を設定してください。
3.  **[ ] プラグイン/フックの登録:** ユーザーの選択に応じて `opencode.jsonc` を更新してください。
    *   Packages版: `plugins` 配列に `"@yohi/justice"` を追加。
    *   ソース版: `hooks.custom` に **プラグインのエントリポイント**（依存関係注入を伴うラッパー）へのパスを登録してください。
4.  **[ ] 統合の確認:** 設定に不備がないかバリデーションし、プラグインが次回のセッションからロード可能であることを確認してください。
    *   *Note:* 学習データ（`.justice/wisdom.json`）は、最初のタスク完了時にプラグインによって自動的に作成されるため、手動での初期化は不要です。

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

最もクリーンで推奨される方法です。

1.  **認証設定 (`.npmrc`)**
    ```ini
    @yohi:registry=https://npm.pkg.github.com
    ```
2.  **プラグインの有効化 (`opencode.jsonc`)**
    `plugins` リストにパッケージ名を追加するだけで、すべてのフックが自動的に登録されます。**`hooks.custom` への記述は不要です。**
    ```jsonc
    {
      "plugins": ["@yohi/justice"]
    }
    ```

### パターン 2: TypeScript 設定経由

`opencode.config.ts` を使用している場合は、プラグインオブジェクトを直接渡します。

```ts
import { OpenCodePlugin } from "@yohi/justice/opencode";

export default { plugins: [OpenCodePlugin] };
```

### パターン 3: ソースコードからビルド (最新版・開発用)

リポジトリをクローンし、ビルドしたファイルをフックとして直接参照します。
**注意:** 各フックファイルは依存関係注入を必要とするため、直接指定するのではなく、すべてのコンポーネントを初期化する `dist/opencode-plugin.js` をエントリポイントとして使用してください。

1.  **ビルド**
    ```bash
    git clone https://github.com/yohi/justice.git
    cd justice && bun install && bun run build
    ```
2.  **フックの設定** (`opencode.jsonc`)
    ```jsonc
    {
      "hooks": {
        "custom": [
          {
            "name": "justice-plugin",
            "event": ["Message", "PreToolUse", "PostToolUse", "Event"],
            "source": "[LOCAL_PATH]/justice/dist/opencode-plugin.js"
          }
        ]
      }
    }
    ```

## 使い方

インストール後、AI エージェントがメッセージ内でプランファイルを参照し、かつ委譲を表すキーワード（例: "plan.md から次のタスクを委譲して"）を含めた場合に、Justice は自動的にアクティブになります。

**委譲のキーワード (英語/日本語):** `delegate`, `next task`, `execute task`, `次のタスク`, `タスクを委譲`, `タスクを実行`, `タスクを開始`

## コアコンポーネント

| コンポーネント | 層 | 目的 |
|-----------|-------|---------|
| `PlanParser` | Core | `plan.md` を解析して `PlanTask[]` を生成、チェックボックスの更新 |
| `TaskPackager` | Core | `PlanTask` から構造化された `DelegationRequest` に変換 |
| `TriggerDetector` | Core | プランの参照と委譲の意図を検出 |
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
| `PlanBridge` | Hook | `Message`/`PreToolUse` 時の委譲ブリッジ |
| `TaskFeedbackHandler` | Hook | `PostToolUse` 時のフィードバックループ |
| `CompactionProtector` | Hook | コンパクション発生時にプランの状態をスナップショット化 |
| `LoopDetectionHandler` | Hook | ループ検出時に強制中断し、分割を提案 |
| `OpenCodeAdapter` | Runtime | OpenCode `Plugin` ↔ `HookEvent` の双方向変換と Fail-Open 境界 |
| `NodeFileSystem` | Runtime | `Bun.file` を基盤とした `FileReader`/`FileWriter` 実装 |
| `TieredWisdomStore` | Core | プロジェクトローカルとユーザーグローバルの2層 Wisdom ストア |
| `SecretPatternDetector` | Core | 秘密情報の自動検出（API キー、パスワード等） |

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

## ドキュメント

- **[SPEC.md](./SPEC.md)** — 完全な仕様書 (アーキテクチャ、データモデル、コンポーネント仕様、API)
- **[AGENTS.md](./AGENTS.md)** — このプロジェクト向けの AI エージェントのコーディングガイドライン
