# Task 2 実装レポート

## 実装内容

- `src/core/workflow-router.ts` を追加しました。
- `brainstorming`、`writing-plans`、`executing-plans` を `sisyphus` に、`subagent-driven-development` を `atlas` に解決します。
- 未知の workflow は `undefined` を返し、`isKnownWorkflow` で既知性を判定します。
- `ControllerAgent` を型専用 import し、core の純粋性を維持しました。
- brief の Note に従い、`AgentRouter` の Worker 選択削除は呼び出し側移行（Task 8）前に行わないため、このタスクでは変更していません。既存の `plan-bridge` / `task-packager` が現行 `AgentRouter` API を利用しているためです。

## テスト結果

- focused test: PASS（1 file、6 tests）
- full test suite: PASS（140 files、1682 tests）
- typecheck: PASS（`bun run typecheck`）
- lint: PASS（0 errors、既存を含む97 warnings）
- build: PASS（TypeScript compile と Bun bundle）
- LSP diagnostics: 変更した TypeScript 2 ファイルとも diagnostics なし

## TDD evidence

### RED

Command:

```bash
bun run test tests/unit/core/workflow-router.test.ts
```

Result: FAIL。`src/core/workflow-router.ts` がまだ存在しないため、`Cannot find module .../src/core/workflow-router` でテストスイートが失敗しました。

### GREEN

Command:

```bash
bun run test tests/unit/core/workflow-router.test.ts
```

Result: PASS。1 test file、6 tests passed。

## 変更ファイル

- `src/core/workflow-router.ts`
- `tests/unit/core/workflow-router.test.ts`
- `.superpowers/sdd/2026-08-29-justice-routing-core/task-2-report.md`

## 自己レビュー

- 単一責務: Workflow から Controller への固定解決のみを担当しています。
- core 純粋性: `@opencode-ai/*` の import はありません。
- 公開状態: map は `Readonly<Record<...>>` です。
- 禁止事項: `any`、`as any`、`@ts-ignore`、`@ts-expect-error` は使用していません。
- テスト: 4つの既知 workflow、未知 workflow、既知性判定をカバーしています。
- 変更範囲: Task 2 の新規 router と unit test に限定しています。

## Issues / Concerns

- `bun run lint` は成功しましたが、既存警告に加えて新規 router の computed property lookup に関する `security/detect-object-injection` 警告が1件あります。brief 指定実装の lookup であり、typecheck・tests・build は通過しています。
- no-excuse audit の指定スクリプトはリポジトリ内に存在せず、実行できませんでした（`Module not found "scripts/typescript/check-no-excuse-rules.ts"`）。
- 作業開始時から未追跡の `REQUIREMENTS_2026-08-19.md` と `REQUIREMENTS_2026-08-29.md` があり、コミット対象から除外しました。

# Task 2 修正レポート

## 変更内容

- `AgentRouter` に `WorkflowRouter` を注入し、`routeController(workflow)` を追加しました。
- 既存の `route` / `determineOptimalAgent` 呼び出しは Task 8/9 の移行まで維持しました。
- `WorkflowRouter` の内部 map を `ReadonlyMap` に変更し、`__proto__` などの prototype key が unknown workflow として `undefined` になるよう修正しました。
- `tests/core/agent-router.test.ts` と `tests/unit/core/agent-router.test.ts` に Controller routing と prototype key の回帰テストを追加しました。
- `src/core/agent-router.ts` に、`routeController` が新しい Controller routing API であり、legacy `determineOptimalAgent` / `route` は Task 3（justice-routing-controller PR stack）で削除予定であることを明記しました。
- lint の新規 `security/detect-object-injection` warning は解消しました。

## 検証コマンドと結果

```bash
bun run test tests/unit/core/workflow-router.test.ts tests/unit/core/agent-router.test.ts
```

PASS: 2 files、8 tests passed。

```bash
bun run test tests/core/agent-router.test.ts tests/unit/core/workflow-router.test.ts tests/unit/core/agent-router.test.ts
```

PASS: 3 files、39 tests passed。

```bash
bun run typecheck
```

PASS: `tsc --noEmit` completed successfully。

```bash
bun run lint
```

PASS: exit code 0、0 errors。warning は96件で、今回の `workflow-router.ts` warning は解消済みです。

## TDD evidence

RED は production code 変更前に focused tests を実行し、`router.routeController is not a function` の2件失敗を確認しました。GREEN は実装後に同じ focused tests を実行し、8件すべて成功しました。

## 自己レビュー

- `AgentRouter` は既存の Worker routing API を壊さず、新しい Controller routing を `WorkflowRouter` 経由で提供しています。
- `WorkflowRouter` は core 内で完結し、`@opencode-ai/*` を import していません。
- `ReadonlyMap` により prototype chain lookup は発生しません。
- 禁止された `any`、`as any`、`@ts-ignore`、`@ts-expect-error` はありません。

## Concern

brief の「Worker 選択メソッドを削除」と「既存の `AgentRouter.route` 呼び出しを壊さない」は現時点では同時に満たせません。実際に `plan-bridge` と `task-packager` が `route` を使用しているため、Task 8/9 の呼び出し側移行まで互換 API を保持しました。レビュー指示に従い、Controller 解決 API は先行追加しています。

# Task 2 追補: legacy Worker API の削除予定

`routeController` が新しい Controller routing API であり、legacy の `determineOptimalAgent` / `route` は Task 3（justice-routing-controller PR stack）で削除予定であることを `src/core/agent-router.ts` にコメントとして明記しました。Task 2 では、Task 8/9 の呼び出し側移行が完了するまで既存 Worker API を保持します。
