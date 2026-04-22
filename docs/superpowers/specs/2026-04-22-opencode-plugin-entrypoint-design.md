---
title: Justice を公式 OpenCode プラグインとして提供するための設計
status: draft
author: Justice maintainers
date: 2026-04-22
supersedes: N/A
---

# Justice を公式 OpenCode プラグインとして提供するための設計

## 1. 目的

`@yohi/justice` リポジトリを、OpenCode が公式に読み込める単一パッケージ形式のプラグインとして配布できるようにする。
既存の OmO (oh-my-openagent) カスタムフック経由の統合を壊すことなく、OpenCode の `Plugin` 契約型を満たす新エントリポイントを追加する。

## 2. スコープ

### 本仕様に含むもの

- OpenCode `Plugin` 型を満たす新エントリ `src/opencode-plugin.ts` の追加
- Justice 内部の `HookEvent` ↔ OpenCode フックの双方向変換を担う `src/runtime/opencode-adapter.ts` の追加
- ループ検出用のエラー文字列パターンを宣言化した `src/core/loop-error-patterns.ts` の追加
- `package.json` の `exports` / `peerDependencies` / `devDependencies` / `version` の更新
- 新規 Adapter ユニットテスト・統合テストの追加
- README.md および SPEC.md への新エントリに関する追記

### 本仕様に含まないもの

- Core / Hook 層のビジネスロジック変更
- 既存 327 テストの書き換え（原理的に回帰は発生しない設計）
- OmO カスタムフック経路 (`dist/hooks/*.js`) の削除。シム化して維持
- バージョン 2.0.0 に向けた破壊的リファクタ（将来の deprecation サイクルに温存）
- Devcontainer 外での検証の実施（本作業完了後、別セッションでユーザーが Devcontainer 内で検証する）

## 3. 前提 / 参照

- OpenCode Plugin ドキュメント: `https://raw.githubusercontent.com/anomalyco/opencode/refs/heads/dev/packages/web/src/content/docs/ja/plugins.mdx`
- Justice 現行アーキテクチャ: `SPEC.md` / `README.md` / `src/core/justice-plugin.ts`
- OpenCode Plugin 初期化コンテキスト:

  ```ts
  import type { Plugin } from "@opencode-ai/plugin";
  // @yohi/justice/opencode のエントリ。既存の JusticePlugin クラス (@yohi/justice) と名前衝突しないよう
  // OpenCodePlugin という名前で export する。
  export const OpenCodePlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
    return {
      "experimental.session.compacting": async (input, output) => { /* ... */ },
      "tool.execute.before": async (input, output) => { /* ... */ },
      "tool.execute.after": async (input, output) => { /* ... */ },
      "message.updated": async (input, output) => { /* ... */ },
      "session.error": async (input, output) => { /* ... */ },
    };
  };
  ```

## 4. アーキテクチャ全体像

```text
┌───────────────────────────────────────────────────────────────┐
│  OpenCode Host                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ @yohi/justice/opencode  — Plugin エントリ                │  │
│  │                                                         │  │
│  │  src/opencode-plugin.ts                                 │  │
│  │    └─ OpenCodeAdapter (新規)                             │  │
│  │        └─ JusticePlugin (既存 Core オーケストレータ)      │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘

純粋コア層 (変更なし):
  PlanParser / TaskPackager / TriggerDetector / PlanBridgeCore /
  FeedbackFormatter / ErrorClassifier / SmartRetryPolicy /
  TaskSplitter / WisdomStore / TieredWisdomStore /
  LearningExtractor / WisdomPersistence / SecretPatternDetector /
  CategoryClassifier / DependencyAnalyzer / ProgressReporter
  + 新規: LoopErrorPatterns (宣言的正規表現テーブル)

フック層 (既存のまま):
  PlanBridge / TaskFeedbackHandler / CompactionProtector /
  LoopDetectionHandler
  ⇒ OmO 向けレガシーシム `dist/hooks/*.js` は維持し、
     OpenCode 経由では Adapter が同一 Core を使用する (二重初期化禁止)
```

### 設計不変条件

| 制約 | 実現手段 |
|---|---|
| Pure Core 保全 | `src/core/*.ts` は `@opencode-ai/plugin` を import しない。import してよいのは `src/opencode-plugin.ts` と `src/runtime/opencode-adapter.ts` のみ。ESLint の `no-restricted-imports` ルールで自動検査し、上記 2 ファイル以外からのインポートをビルドエラーとして検出する |
| Fail-Open | `OpenCodeAdapter` の**全フック境界**で `try/catch`。例外は `client.app.log()` でログし、OpenCode 側は無影響で継続 |
| Immutability | 新規インターフェース (`OpenCodeAdapterOptions`, `OpenCodePluginInit` 等) は全プロパティ `readonly` |
| Secret Leakage 防止 | `SecretPatternDetector` は Core 側にあり、Adapter は介在しない。`TieredWisdomStore` の promotion 経路は現状維持 |
| 依存種別 | `@opencode-ai/plugin` は `peerDependencies` + `devDependencies` の両方 |

### OpenCodeAdapter 以外の重要な責務分割

- **`src/opencode-plugin.ts`**: OpenCode `Plugin` 型への配線のみ。行数は 50–80 行を目安に、ロジックを含めない
- **`src/runtime/opencode-adapter.ts`**: OpenCode ペイロード ↔ `HookEvent` 変換、`HookResponse` ↔ `output` 射影、`client.app.log` ラッパ、初期化縮退の制御
- **`src/core/loop-error-patterns.ts`**: ループ系エラー文字列の正規表現配列 (純粋関数)

## 5. フックマッピング確定表

返却ハンドラキーは以下の 5 つ。wisdom 等の初期化は別メカニズム (下記「初期化方針」) で扱う。

| OpenCode フック | Adapter メソッド | Justice 内部イベント | `HookResponse` → `output` 射影 |
|---|---|---|---|
| `message.updated` | `onMessageUpdated` | `MessageEvent` | 通常は副作用のみ (`activePlan` 設定)。`inject` は `output.context[]` に追記 |
| `tool.execute.before` | `onToolExecuteBefore` | `PreToolUseEvent` | `inject` → `output.args` へのマージ (`prompt` は**前置 prepend**、その他は上書き) |
| `tool.execute.after` | `onToolExecuteAfter` | `PostToolUseEvent` | 副作用のみ (wisdom 更新) |
| `experimental.session.compacting` | `onSessionCompacting` | `EventEvent` (payload: `CompactionPayload`) | `inject` → `output.context[]` にプランスナップショットを push |
| `session.error` | `onSessionError` | パターン一致時のみ `EventEvent` (payload: `LoopDetectorPayload`) を合成 / 非一致時は変換せず即 PROCEED (ログなし) | 一致時: 副作用のみ (plan.md 注記 + 次回 `tool.execute.before` で反映) |

### 初期化方針 (lazy initialization)

OpenCode の `session.created` をハンドラキーとして採用する代わりに、以下を採用する:

- `JusticePlugin` (Plugin 関数) が呼ばれた時点で `OpenCodeAdapter` を生成
- `justice.initialize()` (wisdom のロード) は**各フック初回アクセス時に 1 度だけ**実行する lazy init パターン
- `Promise<void>` を共有フィールドに保持し、初回アクセスは `await this.#initOnce`、2 回目以降はその解決済み Promise を再利用
- 初期化失敗時も fail-open: catch してログし、以降のフックは wisdom 未ロード状態で動作続行

この方針により、SDK 側の `session.created` ハンドラ有無に依存せずに実装できる。

### `message.updated` の扱いに関する注意

- OpenCode SDK の `message.updated` ペイロードの正確な構造 (`message.role` / `message.content` / 差分フィールド) は実 SDK 型を見て確定する
- 取得できない場合のフォールバック: Adapter 側で `role === "user"` と非空 `content` をチェックして、両方満たすときのみ `MessageEvent` を合成する

### `session.error` のループ検出パターン (Layer 1)

`src/core/loop-error-patterns.ts` にモジュール定数として配置:

```text
export const LOOP_ERROR_PATTERNS: readonly RegExp[] = Object.freeze([
  /loop\s*detect/i,
  /infinite\s+loop/i,
  /repetition\s*limit/i,
  /\brepeated\b.*\b(calls?|attempts?)\b/i,
  /stuck\s*in\s*(an?\s+)?loop/i,
  /too\s*many\s*iterations/i,
]);

export function matchesLoopError(errorMessage: string): boolean {
  return LOOP_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage));
}
```

### ワークスペース解決

```text
OpenCodeAdapter constructor:
  const workspaceRoot = init.worktree ?? init.directory;
  if (!workspaceRoot) {
    // 縮退: 全フックが即 PROCEED を返す no-op プラグイン
    return;
  }
  const localFs = new NodeFileSystem(workspaceRoot);
  const globalFs = await createGlobalFs(loggerAdapter); // 既存関数を再利用
  this.justice = new JusticePlugin(localFs, localFs, {
    logger: loggerAdapter,
    onError: (e) => this.log("error", "Justice internal error", e),
    globalFileSystem: globalFs ?? undefined,
  });
```

## 6. データフロー (主要 3 シナリオ)

### 6.1 タスク委譲フロー

```text
[user] "plan.md の次のタスクを委譲して"
  → OpenCode message.updated
  → OpenCodeAdapter.onMessageUpdated
  → JusticePlugin.handleEvent(MessageEvent)
  → PlanBridge.handleMessage (activePlan 設定 — 副作用)

[assistant] `task` ツール呼び出し
  → OpenCode tool.execute.before
  → OpenCodeAdapter.onToolExecuteBefore
  → JusticePlugin.handleEvent(PreToolUseEvent)
  → PlanBridge.handlePreToolUse (DelegationRequest 構築)
  → output.args をマージして inject
```

### 6.2 フィードバック抽出フロー

```text
`task` ツール完了
  → OpenCode tool.execute.after
  → OpenCodeAdapter.onToolExecuteAfter
  → JusticePlugin.handleEvent(PostToolUseEvent)
  → TaskFeedbackHandler.handlePostToolUse
  → LearningExtractor + CategoryClassifier + SecretPatternDetector
  → TieredWisdomStore.add (local/global 自動振り分け)
```

### 6.3 コンパクション保護フロー

```text
OpenCode コンテキスト圧縮開始
  → experimental.session.compacting
  → OpenCodeAdapter.onSessionCompacting
  → JusticePlugin.handleEvent(EventEvent<CompactionPayload>)
  → CompactionProtector.createSnapshot (plan + 学習)
  → output.context.push(injectedContext)
```

### 6.4 Fail-Open パターン

全フック境界で同一のテンプレート:

```text
try {
  const event = this.toHookEvent(input);
  const response = await this.justice.handleEvent(event);
  this.applyResponse(response, output);
} catch (err) {
  try { await this.log("error", "[Justice] hook failure", err); } catch { /* noop */ }
  // output は未変更のまま返る → OpenCode セッションは継続
}
```

## 7. エラーハンドリングとログ戦略

### 3 層のエラー境界

```text
Layer 1: OpenCodeAdapter フック境界 (最外層) — Fail-Open 保証
Layer 2: JusticePlugin.handleEvent (既存の logger/onError 継承)
Layer 3: Core / Hook クラス内 (既存の try/catch を尊重)
```

### ログラッパの仕様

```text
private async log(level: "info"|"warn"|"error", message: string, ...args: unknown[]): Promise<void> {
  try {
    await this.init.client.app.log({
      level,
      service: "justice",
      message,
      extra: args.length > 0 ? { args } : undefined,
    });
  } catch { /* 最終防衛線: 何もしない */ }
}
```

- `console.*` への直接出力は禁止
- `JusticePluginOptions.logger` には `warn`/`error` をこのラッパにバインドしたアダプタを渡す

### ログレベル指針

| レベル | 用途 |
|---|---|
| info | ライフサイクルマイルストン (初期化成功など) |
| warn | 設定上の問題、機能縮退 |
| error | フック内例外、Core 例外 |

### 機能縮退マトリクス

| 障害 | 縮退後の挙動 |
|---|---|
| `worktree`/`directory` 両方 undefined | Adapter は no-op プラグインを返す (全フック即 PROCEED) |
| `createGlobalFs()` が null | `NoOpPersistence` にフォールバック (既存動作) |
| プランファイル未発見 | `PlanBridge` は PROCEED (既存動作) |
| SecretPatternDetector 一致 | global 昇格中止 → local 保存フォールバック (既存動作、warn ログ) |
| `client.app.log` 自体が例外 | ラッパで握りつぶし、静かに失敗 |

## 8. テスト戦略

### 4 層構造

| 層 | ディレクトリ | 新規/既存 | 概要 |
|---|---|---|---|
| Layer 1 Core | `tests/core/` | 既存 | 変更なし |
| Layer 2 Hook | `tests/hooks/` | 既存 | 変更なし |
| Layer 3 Adapter | `tests/runtime/opencode-adapter.test.ts` | 新規 | 入出力変換の単体検証 |
| Layer 4 Integration | `tests/integration/opencode-plugin.test.ts` | 新規 | 型契約 + E2E シナリオ |

### Adapter 単体テストのケース

- `message.updated`: user ロール + 委譲キーワード → `PlanBridge.handleMessage` 呼び出し
- `message.updated`: assistant ロール / 空文字列 → PROCEED
- `tool.execute.before`: `tool="task"` → PreToolUseEvent 変換 + args マージ
- `tool.execute.before`: 非 `task` ツール → PROCEED
- `tool.execute.before`: `inject` レスポンス → `output.args.prompt` に前置
- `tool.execute.after`: 成功結果 → `wisdom.add` 呼び出し検証
- `tool.execute.after`: エラー結果 → `ErrorClassifier` 分岐検証
- `experimental.session.compacting`: activePlan あり → `output.context[]` push
- `experimental.session.compacting`: activePlan なし → `output.context` 無変更
- `session.error`: "loop detected" 文字列 → `LoopDetectionHandler` 起動
- `session.error`: パターン外エラー → PROCEED
- Fail-Open: `toHookEvent` throw → output 無変更 + ログ呼び出し
- Fail-Open: `justice.handleEvent` throw → 同上
- Fail-Open: `client.app.log` 自体が throw → 正常完了
- 縮退: `worktree`/`directory` 両方 undefined → no-op プラグイン
- 縮退: `createGlobalFs` null → Tiered がローカルのみで機能

### 統合テストのケース

- 型契約: エクスポートされた `JusticePlugin` が `Plugin` 型にアサイン可能
- 返却ハンドラオブジェクトに 5 つの必須キーが存在する: `message.updated`, `tool.execute.before`, `tool.execute.after`, `experimental.session.compacting`, `session.error` (追加キーは許容)
- lazy initialization: 各フック初回アクセス時に `justice.initialize()` が 1 度だけ呼ばれ、2 回目以降は再ロードされない (冪等性)
- lazy initialization 失敗時: fail-open でハンドラは PROCEED を返し、ログが記録される
- シナリオ A (E2E): `message.updated` → `tool.execute.before` → `tool.execute.after` の流れで `plan.md` チェックボックスが更新されることを確認
- シナリオ B (E2E): `tool.execute.after` で成功結果を流した際に `LearningExtractor` → `CategoryClassifier` → `TieredWisdomStore.add` が呼ばれ、wisdom エントリが local store に保存されることを確認 (シナリオ 6.2 対応)
- シナリオ C (E2E): `activePlan` 設定後に `experimental.session.compacting` 発火 → `output.context[]` にスナップショット文字列が含まれることを確認

### Fake / Mock 戦略

`tests/helpers/fake-opencode-init.ts` を新設:

```text
export function fakeInit(overrides?: Partial<OpenCodePluginInit>): OpenCodePluginInit {
  return {
    project:   { name: "test", root: "/tmp/test-workspace" },
    client:    { app: { log: vi.fn() } } as any,
    $:         vi.fn(),
    directory: "/tmp/test-workspace",
    worktree:  "/tmp/test-workspace",
    ...overrides,
  };
}
```

`SecretPatternDetector` はモックせず、本物の正規表現をテストで走らせる。

### 回帰防止の保証

| 対象 | 保証手段 |
|---|---|
| 既存 327 テスト | `vitest run` 全件グリーン |
| 型契約 | `tsc --noEmit` により `Plugin` 型不整合を検出 |
| 静的解析 | `eslint` + `eslint-plugin-security` |
| ビルド成果物 | `dist/opencode-plugin.js` + 既存 `dist/hooks/*.js` が共に生成されること |

### テスト数の目安

| 層 | 既存 | 追加 | 合計 |
|---|---|---|---|
| Core | ~270 | 0 | ~270 |
| Hook | ~50 | 0 | ~50 |
| Runtime | ~7 | 0 | ~7 |
| Adapter 新規 | 0 | ~15 | ~15 |
| Integration 新規 | – | ~4 | ~4 |
| **合計** | **327** | **~19** | **~346** |

## 9. パッケージング / 配布

### `package.json` 変更差分 (意図ベース)

- `devDependencies`: `@opencode-ai/plugin` を追加
- `peerDependencies`: `@opencode-ai/plugin` を追加
- `exports`: `"./opencode"` サブパスを追加
- `version`: `1.1.0` → `1.2.0` (MINOR: 後方互換な機能追加)
- `scripts` / `files`: 変更なし
- `JusticePlugin` クラスのリネームは**行わない**。新名 `JusticeCore` は**追加エクスポート**として共存させ、既存 `JusticePlugin` エクスポート名は存続
- `@yohi/justice/opencode` サブパスの Plugin 関数は **`OpenCodePlugin`** として named export。`@yohi/justice` の `JusticePlugin` クラスと名前衝突しないよう明確に区別する（クラスのリネームや factory 関数は 1.2.0 スコープ外に据え置き）

### 変更後の `exports` 形状

```text
"exports": {
  ".": {
    "import": "./dist/index.js",
    "types":  "./dist/index.d.ts"
  },
  "./runtime": {
    "import": "./dist/runtime/node-file-system.js",
    "types":  "./dist/runtime/node-file-system.d.ts"
  },
  "./opencode": {
    "import": "./dist/opencode-plugin.js",
    "types":  "./dist/opencode-plugin.d.ts"
  }
}
```

### `tsconfig.json`

既存の `tsconfig.json` / `include: [src]` で新規ファイルを自動的に取り込む想定。
実装時に型エラーが発生した場合のみ最小修正する (事前に既存設定の変更は計画しない)。

### 消費者側の利用パターン

**パターン 1: OpenCode Plugin (新方式・推奨)**

```text
// OpenCode 側の設定
import { OpenCodePlugin } from "@yohi/justice/opencode";
export default { plugins: [OpenCodePlugin] };
```

**パターン 2: OmO カスタムフック (既存方式・後方互換)**

```text
// oh-my-opencode.jsonc の dist/hooks/*.js 参照は変更不要
```

### README.md / SPEC.md 更新箇所

本スペックの実装と**同一 PR** で以下を更新する:

- README.md の「インストール」節に「パターン 1: OpenCode Plugin 経由」追記
- README.md のフック設定例を両パターン併記に更新
- README.md の「コアコンポーネント」表に `OpenCodeAdapter` を追加
- README.md の「プロジェクト・ステータス」表に Phase 8 (OpenCode Plugin 統合) を追加
- SPEC.md に OpenCode Plugin 節を追加 (フックマッピング表・Fail-Open テンプレート・ワークスペース解決)

### CI / リリース

既存の `bitbucket-pipelines.yml` / GitHub Actions は変更不要:

- `bun run typecheck`, `bun run test`, `bun run lint`, `bun run build` はコマンド同一
- `@opencode-ai/plugin` は devDep として CI でインストールされ、型チェックとテストのみに使用
- publish フロー変更なし (dist/ を配布)

### 依存関係の健全性チェック (実装時に確認)

| 項目 | 確認方法 |
|---|---|
| `@opencode-ai/plugin` が `peerDependencies` に含まれる | `npm pack --dry-run` |
| `dist/opencode-plugin.d.ts` が `Plugin` 型を正しくエクスポート | 消費側サンプルプロジェクトでコンパイル (Devcontainer 内) |
| `@yohi/justice/opencode` サブパスがバンドル解決可能 | `node -e "import('@yohi/justice/opencode')"` |
| 旧 `dist/hooks/*.js` が互換維持 | 既存 integration test を Devcontainer 内で実行 |

## 10. 実行環境

**本仕様の実装後の検証は、Devcontainer 内でのみ実施する。**
制約に従い、以下のコマンドを Devcontainer 内で順に実行する:

```text
bun install
bun run typecheck
bun run lint
bun run test
bun run build
```

本セッションではホスト環境で設計文書と実装計画まで作成し、検証はユーザーが
Devcontainer を起動した別セッションで実施する方針 (α 案) を採用する。

## 11. リスクと緩和

| リスク | 影響 | 緩和策 |
|---|---|---|
| `@opencode-ai/plugin` の実 SDK 型が想定と異なる | Adapter 型エラー | 実装初期に型定義を確認し、Adapter ヘッダに該当する `import type` を固定。型が大きく異なる場合は fake init ヘルパで吸収 |
| `message.updated` ペイロードに `content` が無い | トリガ検出不能 | Adapter 側で `role === "user"` + 非空 `content` の両方を要件化。満たさない場合 PROCEED |
| OpenCode Host 側の `client.app.log` が存在しない環境 | ログ消失 | ラッパで catch し、静かに失敗 |
| Adapter とレガシーシムが同時起動 | 二重初期化 / 二重 wisdom 書き込み (破損は起きないが重複エントリが発生) | Adapter / レガシーシム双方の初期化時に `client.app.log("info", "Justice initialized via {adapter\|legacy-shim}")` を出力し、両メッセージが同一セッションで出た場合にユーザーが設定ミスを検知できるようにする。`globalThis` 汚染やハードブロックは採用しない（テスト困難・hot-reload 非対応のため）。判断根拠: 同時起動のリスクは wisdom 重複に限定され致命的ではなく、硬い排他制御を導入するより警告ログで運用可能と評価 |
| 既存 327 テストに副次的な影響 | 回帰発生 | Core / Hook 層への変更禁止を設計不変条件に据える |

## 12. 未決事項 (実装時に確定)

- `@opencode-ai/plugin` の具体的なバージョン番号 (`package.json` 記載値)
- `Plugin` 型が提供する `message.updated` のペイロード具体構造
- `tool.execute.before` の `output` 型が `args` マージをどう表現するか (`output.args = {...}` or `return { args: {...} }` の形式)

これらは実装計画フェーズ (superpowers:writing-plans) 内の最初のステップで
解決し、本仕様書の関連節を参照付き更新する。

## 13. 承認フロー

1. 本仕様書の草稿を作成 (本ドキュメント)
2. セルフレビュー (プレースホルダ / 矛盾 / 曖昧さ / スコープ検査)
3. ユーザーレビューと承認
4. `superpowers:writing-plans` スキルで実装計画を起案
5. 実装は別セッションで Devcontainer 内にて実施
