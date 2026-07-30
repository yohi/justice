# Final Review Fix 3 Report

## Status

DONE_WITH_CONCERNS

## 変更内容

- `OpenCodeAdapter.onToolExecuteBefore` の prompt 注入を `modifiedPayload.args` の有無より前に実行するよう修正しました。`modifiedPayload` がない unauthorized advisory でも `[JUSTICE: IMPLEMENTATION UNAUTHORIZED]` が元の prompt に prepend され、その他の args は変更されません。
- `tests/runtime/opencode-adapter.test.ts` に unauthorized advisory の回帰テストを追加し、既存の modifiedPayload ありの authorized path も維持しました。
- `tests/integration/workflow-bootstrap-flow.test.ts` の旧仕様 assertion を、prompt の advisory 注入とその他 args の不変性を確認する内容へ更新しました。
- `SPEC.md` の `command.execute.before` 記述を、`justice-start` と `justice-implement` の双方を処理し、それ以外を no-op とする実装に一致させました。

## 検証結果（devcontainer 内）

- `bun run lint`: 成功。`0 errors, 5 warnings`（既知の既存 warning 数と同じ）。
- `bun run typecheck`: 成功。`tsc --noEmit`、エラーなし。
- `bun run test`: 成功。`127 passed` test files、`1502 passed` tests。
- `bun run build`: 成功。`tsc`、エラーなし。
- `bun run format`: 成功。対象 TypeScript ファイルはすべて `unchanged`。
- 対象ファイルの `bunx prettier --check`: TypeScript 3 ファイルは整形済み。`SPEC.md` は既存文書全体の未整形により警告終了（`[warn] SPEC.md`）。無関係な大規模再整形を避けるため、SPEC は必要箇所のみ変更しました。
- 回帰テストの TDD 確認: 修正前は `39 tests | 1 failed`、修正後は対象 adapter test `39 passed`。関連 integration test も `6 passed`。

## コミット

- `ff2db83bb41e9caf164b98abb60279f04caf10ed` — `fix(adapter): 未認可advisoryのprompt注入をmodifiedPayload有無に関わらず実行する`

## Concern

- SPEC.md は変更前から Prettier 全体規約に適合しておらず、全体を整形すると今回の修正範囲を大きく超える差分になります。そのため、文書の既存スタイルを保持した最小差分とし、Prettier check の警告を残しています。
- 作業開始時から存在した未追跡ファイル `.devcontainer/devcontainer-lock.json` と `docs/superpowers/plans/2026-07-29-justice-implement-command.md` は変更・追加せず、コミットにも含めていません。
