# Justice スラッシュコマンド自動登録設計

## 背景

Justice は OpenCode v1 プラグインとして動作するが、`/justice-start` および `/justice-implement` スラッシュコマンドは利用者が手動で `.opencode/commands/*.md` または `opencode.jsonc` の `command` オブジェクトに登録する必要があった。

[yohi/justice#267](https://github.com/yohi/justice/issues/267) では、OpenCode v1 Plugin API の `config` フックを使って `config.command` に Justice のコマンド定義を追加する方式が提案された。本設計はその方式を実装し、手動登録を廃止する。

## 目標

- Justice プラグインを有効化するだけで `/justice-start` と `/justice-implement` が利用可能になる。
- 既存の利用者定義コマンドを尊重し、名前衝突時には上書きしない。
- プラグインの fail-open 原則を維持し、`config` フックの失敗で OpenCode の起動を妨害しない。

## 非目標

- `justice-implement-brainstorming` 等の 4 つの pinned controller コマンドの自動登録は今回の対象外とする。これらは `command.<name>.agent` という別の設定責務を持つ。
- OpenCode v2 Plugin API への対応は別途検討する。

## 設計

### コンポーネント

#### `src/runtime/command-registration.ts`（新規）

OpenCode `Config.command` 形式への変換と登録ロジックを集約する。

```ts
import type { Config } from "@opencode-ai/plugin";

export interface JusticeCommandDefinition {
  readonly template: string;
  readonly description: string;
}

export const JUSTICE_COMMAND_DEFINITIONS: Readonly<
  Record<string, JusticeCommandDefinition>
> = Object.freeze({
  "justice-start": {
    template: "$ARGUMENTS",
    description: "Start a Justice-managed development workflow",
  },
  "justice-implement": {
    template: "$ARGUMENTS",
    description: "Arm the next Justice-managed implementation delegation",
  },
});

export type CommandRegistrationLogger = (
  level: "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
) => void | Promise<void>;

export function registerJusticeCommands(
  config: Config,
  log: CommandRegistrationLogger,
): void {
  const commands = config.command ?? {};
  config.command = commands;

  for (const [name, definition] of Object.entries(JUSTICE_COMMAND_DEFINITIONS)) {
    if (Object.prototype.hasOwnProperty.call(commands, name)) {
      log(
        "warn",
        `[Justice] Command "${name}" is already defined; skipping automatic registration.`,
      );
      continue;
    }
    commands[name] = definition;
  }
}
```

#### `src/opencode-plugin.ts`

返す hooks オブジェクトに `config` を追加する。

```ts
import { registerJusticeCommands } from "./runtime/command-registration";

export const OpenCodePlugin: Plugin = async (init, pluginOptions) => {
  // ... 既存の初期化処理 ...

  return {
    tool: adapter.getTools(),
    config: async (config): Promise<void> => {
      try {
        registerJusticeCommands(config, (level, message, ...args) =>
          adapter.log(level, message, ...args),
        );
      } catch (error) {
        await adapter.log(
          "warn",
          `[Justice] Failed to auto-register slash commands: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },
    // ... 既存のフック ...
  };
};
```

### 型安全

- OpenCode SDK の `Config` 型を参照する。
- `JUSTICE_COMMAND_DEFINITIONS` は `Object.freeze` で不変にし、`Readonly<Record<string, JusticeCommandDefinition>>` とする。

### 名前衝突の扱い

- 利用者が既に `command.<name>` を定義している場合、**上書きせず**、警告ログを出力してスキップする。
- これにより、利用者がカスタム template や agent を指定したい場合にその設定を尊重できる。

### Fail-Open

- `config` フック内での例外は catch し、警告ログを出力後に無視する。
- OpenCode のプラグインロードや起動を妨害しない。

## テスト

### `tests/runtime/command-registration.test.ts`（新規）

- 空の `config.command` に対して 2 コマンドが追加される。
- 既存エントリがある場合に上書きされず、警告ログが呼ばれる。
- `config.command` が `undefined` の場合に初期化される。

### `tests/integration/opencode-plugin.test.ts`

- 返却される hooks に `config` が含まれることを検証。
- `config` フックを呼び出すと `justice-start` / `justice-implement` が追加されることを検証。
- 既存コマンドがある場合に上書きされないことを検証。

## ドキュメント更新

### `README.md`

- `/justice-start` および `/justice-implement` の「有効化（OpenCode側の設定）」セクションを削除する。
- 代わりに、これらのコマンドがプラグインの `config` フックにより自動登録される旨を簡潔に記載する。

## 影響範囲

- `src/opencode-plugin.ts`: `config` フックを追加。
- `src/runtime/command-registration.ts`: 新規作成。
- `tests/integration/opencode-plugin.test.ts`: テスト追加。
- `tests/runtime/command-registration.test.ts`: 新規作成。
- `README.md`: 手動登録手順を削除。

## リスクと緩和

| リスク | 緩和策 |
|---|---|
| OpenCode の `config` フックと Command 一覧構築の順序によっては自動登録が反映されない | issue #267 でも未検証事項として明記。今回の実装では順序を制御できないため、テストで `config` フック呼び出し時の `config.command` 書き換えを検証する。 |
| 利用者のカスタムコマンドが上書きされる | 衝突時は上書きせず、警告ログを出力する。 |
| `config` フックの失敗でプラグインがロードできなくなる | fail-open: 例外を catch して警告ログを出力し、無視する。 |

## 未検証事項

- Plugin `config` フックと OpenCode の Command 一覧構築の実行順序は、OpenCode 内部の実装依存であり、本変更では検証しない。 issue #267 と同様に、これは実装上の前提・注意点として明記する。
