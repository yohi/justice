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
