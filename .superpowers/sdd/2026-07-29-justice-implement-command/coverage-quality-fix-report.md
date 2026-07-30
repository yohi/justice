# Coverage Quality Fix Report

## Status

DONE_WITH_CONCERNS

## Refactor

- `src/core/implement-command.ts:6-26` に module-private な
  `parsePlanFlag` を追加しました。`--plan` の重複、値欠落、次トークンが
  フラグである場合、安全でない相対パスを一つの線形な helper へ
  分離しています。
- `parseJusticeImplementCommandArguments` は、型安全のための
  `arg === undefined` guard を維持しつつ、ループ内を `--plan`、
  `--approved`、default reject の浅い `switch` にしました。
  `--plan=value`、未知フラグ、位置引数は従来どおり default で拒否します。
- Sonar の認知的複雑度の観点では、主関数から `--plan` 内の多段分岐を
  除去しました。主関数は一つの loop、一つの switch、各 case の単純 guard
  だけです。元の指摘値 25 に対し、構造上は閾値 15 を十分下回る形です。
  ローカル環境では SonarCloud の再解析自体は実行していません。
- `tsconfig.json` の `noUncheckedIndexedAccess: true` により必要な
  `arg === undefined` guard は、`i < args.length` のループ条件上は
  到達不能です。この防御分岐を強制するテストは追加していません。

## Coverage Gaps Closed

- `src/hooks/plan-bridge.ts:363-371`:
  `tests/hooks/plan-bridge-implement.test.ts:36-62` を追加しました。
  既存 active plan と異なる readable plan を `approved: true` で arm し、
  `warning` / `escalation` / `Plan mismatch` 通知と、新 plan への arm 継続を
  確認します。
- `src/hooks/plan-bridge.ts:401-406`:
  `tests/hooks/plan-bridge-implement.test.ts:214-235` を追加しました。
  `setActivePlan` は plan 変更時に arm を先に削除するため、public API のみでは
  stale 比較分岐に到達しません。リポジトリの private-field test 規約に従って
  `unknown` 経由で stale entry を注入し、`isImplementationArmed` が false を
  返して entry を削除し、後続 `consumeImplementationArm` も null になることを
  確認します。
- `src/runtime/opencode-adapter.ts:792`:
  `tests/runtime/opencode-adapter.test.ts:552-582` を追加しました。
  既存の `JusticePlugin.prototype.initialize` spy を reject させ、
  `ensureInitialized()` が fail-open で完了した後も `#justice` が null の場合に、
  例外や guidance part を出さず return することを確認します。

追加テストは対象 production 行を一時的に無効化するミューテーションでも
検証しました。mismatch 通知条件の反転、stale entry 削除の除去、adapter の
`!justice` return 除去は、それぞれ対応する新規テストを 1 件失敗させました。
production コードは各確認後に復元しています。

## Deliberately Uncovered Defensive Paths

- `src/runtime/opencode-adapter.ts:768` の `#handleWorkflowStart` 側
  `if (!justice) return` は、同じ初期化失敗パターンを共有します。今回追加した
  1 ケースは PR 新規コマンドである `#handleImplementationArm` の line 792 を
  対象とし、同型テストの重複は追加していません。
- `src/runtime/opencode-adapter.ts:796` の empty-guidance guard は
  到達不能です。`PlanBridge.handleImplementationArm` の全 3 return は
  `formatWorkflowDirective` を呼び、同関数は必ず非空の marker と非空 guidance
  を連結します。そのため、空文字を返す実経路はありません。
- `src/core/implement-command.ts` の defensive indexed-access guard も
  前述のとおり到達不能であり、テストは追加していません。

## Verification in Devcontainer

- `bun run lint`: exit 0。`0 errors, 5 warnings`。既存 warning は
  `tests/core/justice-plugin-reflection.test.ts` 1 件、
  `tests/hooks/fail-open.test.ts` 2 件、
  `tests/runtime/justice-review-tool.test.ts` 2 件です。
- `bun run typecheck`: exit 0。`tsc --noEmit`、診断なし。
- `bun run test`: exit 0。`127 passed` test files、`1505 passed` tests。
  既知 flaky の `tests/integration/justice-reflection-adapter-flow.test.ts` も
  pass しました。
- `bun run test -- --no-file-parallelism`: exit 0。`127 passed` test files、
  `1505 passed` tests。
- `bun run build`: exit 0。`tsc`、診断なし。
- 対象 3 ファイルの `bunx prettier --check`: exit 0。
  `All matched files use Prettier code style!`
- 対象テスト: parser `14/14`、PlanBridge `13/13`、
  OpenCodeAdapter `40/40` が pass しました。

全テスト実行時の stderr には、破損 shard、権限エラー、欠落ファイルなどを
意図的に入力する既存 fail-open テストの期待ログが出ますが、failure は 0 件です。

## Commit

- `6823495754afd48af7be7d33fdd4ba6f84b60b24`
  - `refactor(core): 実装コマンド解析と実装アーム品質を改善する`

## Concern

- 作業開始時点から未追跡だった `.devcontainer/devcontainer-lock.json` は
  変更・ステージ・コミットしていません。このため、今回の対象差分はすべて
  コミット済みでも `git status` は完全な clean にはなりません。
