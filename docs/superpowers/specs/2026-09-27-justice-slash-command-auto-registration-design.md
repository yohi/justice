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

OpenCode `Config.command` 形式への変換と登録ロジックを集約する。この component は OpenCode SDK に依存せず、必要な command shape のみをローカルの structural interface として定義する。

```ts
export interface JusticeCommandDefinition {
  readonly template: string;
  readonly description: string;
}

export interface CommandRegistrationEntry {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

export interface CommandRegistrationTarget {
  command?: Record<string, CommandRegistrationEntry>;
}

const justiceCommandDefinitions = {
  "justice-start": Object.freeze({
    template: "$ARGUMENTS",
    description: "Start a Justice-managed development workflow",
  }),
  "justice-implement": Object.freeze({
    template: "$ARGUMENTS",
    description: "Arm the next Justice-managed implementation delegation",
  }),
} satisfies Record<string, JusticeCommandDefinition>;

export const JUSTICE_COMMAND_DEFINITIONS: Readonly<typeof justiceCommandDefinitions> =
  Object.freeze(justiceCommandDefinitions);

export type CommandRegistrationLogger = (
  level: "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
) => Promise<void>;

export async function registerJusticeCommands(
  config: CommandRegistrationTarget,
  log: CommandRegistrationLogger,
): Promise<void> {
  const commands = config.command ?? {};
  config.command = commands;

  for (const [name, definition] of Object.entries(JUSTICE_COMMAND_DEFINITIONS)) {
    if (Object.prototype.hasOwnProperty.call(commands, name)) {
      await log(
        "warn",
        `[Justice] Command "${name}" is already defined; skipping automatic registration.`,
      );
      continue;
    }
    commands[name] = { ...definition };
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
        await registerJusticeCommands(config, async (level, message, ...args) =>
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

- `src/opencode-plugin.ts` は OpenCode Plugin API boundary、`src/runtime/opencode-adapter.ts` は既存の OpenCode runtime adapter boundary とする。
- `src/runtime/command-registration.ts` は SDK-independent な登録ロジックとし、`@opencode-ai/*` を import しない。必要な型は `CommandRegistrationEntry` / `CommandRegistrationTarget` として狭くローカル定義する。
- OpenCode SDK の `Config` 型との適合性は `src/opencode-plugin.ts` の typed `config` hook boundary で、通常の TypeScript structural assignability により保証する。不要な cast は加えない。
- `JUSTICE_COMMAND_DEFINITIONS` の Record と各 command definition entry を `Object.freeze` し、型と runtime の両方で不変にする。
- `Config.command` に登録する command object は `{ ...definition }` で複製する。canonical definition と登録先は mutable object reference を共有しない。
- 定義の現在のフィールドは primitive 値のみとする。将来 nested mutable fields を追加する場合はコピー・freeze 方針も拡張する。

### OpenCode v1 host contract / authoritative evidence

自動登録は OpenCode v1 Plugin API の正式な `config` hook を使用する。成立条件は次のとおり。

1. Config のロード後に Plugin が初期化され、Plugin は Config を変更できる。
2. `config` hook で変更された Config を OpenCode Command service が受け取り、`cfg.command` から command list を構築する。
3. したがって、hook から `config.command` へ登録した command は OpenCode の command 構築に反映される。

**検証済み host evidence:** OpenCode v1.18.29 (`packages/plugin/src/index.ts` の `Hooks.config`、`packages/opencode/src/project/bootstrap.ts` の Config load → `plugin.init()` 順序、`packages/opencode/src/command/index.ts` の `cfg.command` 読み出し)、v1.18.32 の同等実装、および現在の runtime support baseline である v1.18.29。

`@opencode-ai/plugin@1.14.21` は lockfile で解決される compile-time 型 baseline であり、OpenCode host の runtime support version とは別の値である。runtime support は現行方針に基づき OpenCode v1.18.29 とする。これは v1.18.x 全ての検証を意味しない。

この hook は command 定義の登録だけを担当する。`command.execute.before` は登録済み command の実行時 workflow handling を担当し、workflow parsing / PlanBridge の責務は従来どおり adapter 側に置く。

### 名前衝突の扱い

- 利用者が既に `command.<name>` を定義している場合、**上書きせず**、警告ログを出力してスキップする。
- これにより、利用者がカスタム template や agent を指定したい場合にその設定を尊重できる。

### Fail-Open

- `registerJusticeCommands` と collision logger は非同期契約とし、登録処理は logger を await する。config hook は登録処理全体を try/catch し、例外や logger rejection を catch して警告ログを出力後に抑制する。
- OpenCode のプラグインロードや起動を妨害しない。

## テスト

### `tests/runtime/command-registration.test.ts`（新規）

- 空の `config.command` に対して 2 コマンドが追加される。
- 既存 entry を同一参照のまま保持し、警告 logger が await される。無関係な既存 command も維持する。
- `config.command` が `undefined` の場合に初期化される。
- 登録された command object が canonical definition と参照を共有しない。
- 登録先 object を mutation しても canonical definition が変化しない。
- canonical definition の各 entry が runtime でも freeze されている。
- async logger が reject した場合、registration API は reject し config hook の境界へ伝播する。

### `tests/integration/opencode-plugin.test.ts`

- 返却される hooks に `config` が含まれることを検証。
- `config` フックを呼び出すと `justice-start` / `justice-implement` が追加されることを検証。
- 既存コマンドがある場合に上書きされないことを検証。
- registration mutation が throw しても hook が resolve し、fail-open warning を記録することを検証。

## ドキュメント更新

### `README.md`

- `/justice-start` と `/justice-implement` の各 `### 有効化（OpenCode側の設定）` から手動登録が必須とする記述・手順のみを自動登録契約に置き換える。
- `/justice-start` の `$ARGUMENTS` / template の説明は、自動登録後も利用者に必要な契約（template は LLM prompt 用、Justice parsing は別経路）を残す。置換後は両コマンドの自動登録と名前衝突時の既存定義優先を説明する。

### `SPEC.md`

- §4.0 / §4.1a の近傍に、`config` hook は command 登録、`command.execute.before` は登録済み command の実行処理という責務分離を記載する。
- 衝突時の利用者定義優先、登録処理の fail-open boundary、canonical definition と Config の mutable object reference 非共有を明記する。
- OpenCode v1 host contract と v1.18.29 runtime support baseline / `@opencode-ai/plugin@1.14.21` compile-time baseline を本設計と同期する。
- runtime component/file map に `src/runtime/command-registration.ts` を追加する。

## 影響範囲

- `src/opencode-plugin.ts`: `config` フックを追加。
- `src/runtime/command-registration.ts`: 新規作成。
- `tests/integration/opencode-plugin.test.ts`: テスト追加。
- `tests/runtime/command-registration.test.ts`: 新規作成。
- `README.md`: 手動登録手順を削除。
- `SPEC.md`: 登録 hook と実行 hook の責務、host contract、runtime component map を更新。

## リスクと緩和

| リスク | 緩和策 |
|---|---|
| OpenCode upstream drift により将来 `config` hook と Command 構築の契約が変化する | 検証済み v1.18.29 host contract を基準とし、compatibility audit で upstream source と runtime behavior を再確認する。契約変更時は自動登録の実装前提を再評価する。 |
| 利用者のカスタムコマンドが上書きされる | 衝突時は上書きせず、警告ログを出力する。 |
| `config` フックの失敗でプラグインがロードできなくなる | fail-open: 例外を catch して警告ログを出力し、無視する。 |

## 検証済み事項と残る不確実性

- `config` hook の存在・初期化順・Command service が変更後の `cfg.command` を参照する契約は、上記 OpenCode v1.18.29 / v1.18.32 source evidence で確認済み。
- 将来の OpenCode upstream version における契約維持は未保証であり、upstream drift が残るリスクである。これは現在の登録方式の未検証を意味しない。
