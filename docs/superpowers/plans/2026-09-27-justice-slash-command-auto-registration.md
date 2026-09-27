# Justice スラッシュコマンド自動登録 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode v1 Plugin API の `config` フックを使い、`/justice-start` と `/justice-implement` を Justice プラグイン有効化時に自動登録する。

**Architecture:** コマンド定義と OpenCode `Config.command` へのマージロジックを `src/runtime/command-registration.ts` に集約し、`src/opencode-plugin.ts` の `config` フックから呼び出す。衝突時は利用者定義を尊重し、fail-open で例外を抑制する。

**Tech Stack:** TypeScript, Bun, Vitest, `@opencode-ai/plugin`, `@opencode-ai/sdk`

## Global Constraints

- `src/core/**` は `@opencode-ai/*` を import しない（FF-001）。本実装は `src/runtime/` と `src/opencode-plugin.ts` で行う。
- すべてのフック境界は fail-open とし、OpenCode セッションをクラッシュさせない。
- 公開 API は `OpenCodeAdapter.getTools()` の `justice_review` のみ。本変更はコマンド登録の自動化であり、新しいツールは追加しない。
- テストでは `as any` / `@ts-ignore` を使用しない。private フィールドへのアクセスは `(obj as unknown as { field: T }).field` を使用する。
- 開発コマンドは `.devcontainer/` 内で Bun で実行する：`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`。

---

## File Map

| ファイル | 責務 |
|---|---|
| `src/runtime/command-registration.ts`（新規） | Justice コマンド定義と `Config.command` へのマージ処理を提供する純粋関数群 |
| `src/opencode-plugin.ts` | 返す hooks に `config` を追加し、初期化済み `adapter` 経由で登録関数を呼び出す |
| `tests/runtime/command-registration.test.ts`（新規） | `registerJusticeCommands` の純粋関数に対するユニットテスト |
| `tests/integration/opencode-plugin.test.ts` | `OpenCodePlugin` 返却 hooks に `config` が含まれ、正しく動作することを検証する統合テスト |
| `README.md` | 手動登録手順を削除し、自動登録が行われる旨を記載 |

---

## Task 1: コマンド登録ロジックの実装

**Files:**
- Create: `src/runtime/command-registration.ts`
- Test: `tests/runtime/command-registration.test.ts`

**Interfaces:**
- Consumes: `@opencode-ai/plugin` の `Config` 型
- Produces: `JUSTICE_COMMAND_DEFINITIONS`, `CommandRegistrationLogger`, `registerJusticeCommands(config, log)`

### Step 1: Write the failing test

`tests/runtime/command-registration.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Config } from "@opencode-ai/plugin";
import {
  JUSTICE_COMMAND_DEFINITIONS,
  registerJusticeCommands,
} from "../../src/runtime/command-registration";

describe("registerJusticeCommands", () => {
  it("registers justice-start and justice-implement on an empty config.command", () => {
    const config: Config = {};
    const log = vi.fn();

    registerJusticeCommands(config, log);

    expect(config.command).toBeDefined();
    expect(Object.keys(config.command ?? {})).toEqual(
      expect.arrayContaining(["justice-start", "justice-implement"]),
    );
    expect(config.command?.["justice-start"]).toEqual({
      template: "$ARGUMENTS",
      description: "Start a Justice-managed development workflow",
    });
    expect(config.command?.["justice-implement"]).toEqual({
      template: "$ARGUMENTS",
      description: "Arm the next Justice-managed implementation delegation",
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("does not overwrite existing user-defined commands and logs a warning", () => {
    const config: Config = {
      command: {
        "justice-start": {
          template: "custom template",
          description: "Custom start command",
        },
      },
    };
    const log = vi.fn();

    registerJusticeCommands(config, log);

    expect(config.command?.["justice-start"]).toEqual({
      template: "custom template",
      description: "Custom start command",
    });
    expect(config.command?.["justice-implement"]).toEqual({
      template: "$ARGUMENTS",
      description: "Arm the next Justice-managed implementation delegation",
    });
    expect(log).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining(
        'Command "justice-start" is already defined; skipping automatic registration.',
      ),
    );
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("initializes config.command when undefined", () => {
    const config: Config = { command: undefined };
    const log = vi.fn();

    registerJusticeCommands(config, log);

    expect(config.command).toBeDefined();
    expect(config.command?.["justice-start"]).toBeDefined();
    expect(config.command?.["justice-implement"]).toBeDefined();
  });

  it("exposes immutable command definitions", () => {
    expect(Object.keys(JUSTICE_COMMAND_DEFINITIONS)).toEqual([
      "justice-start",
      "justice-implement",
    ]);
    expect(JUSTICE_COMMAND_DEFINITIONS["justice-start"].template).toBe(
      "$ARGUMENTS",
    );
  });
});
```

### Step 2: Run test to verify it fails

Run:
```bash
bun run test tests/runtime/command-registration.test.ts
```

Expected: FAIL with module not found or function not defined.

### Step 3: Write minimal implementation

`src/runtime/command-registration.ts`:

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

### Step 4: Run test to verify it passes

Run:
```bash
bun run test tests/runtime/command-registration.test.ts
```

Expected: PASS

### Step 5: Commit

```bash
GIT_MASTER=1 git add src/runtime/command-registration.ts tests/runtime/command-registration.test.ts
GIT_MASTER=1 git commit -m "feat: Justice コマンドの自動登録ロジックを追加"
```

---

## Task 2: OpenCode プラグインに config フックを追加

**Files:**
- Modify: `src/opencode-plugin.ts`

**Interfaces:**
- Consumes: `registerJusticeCommands` from `src/runtime/command-registration.ts`, `OpenCodeAdapter.log`
- Produces: `config` hook on the returned `Hooks` object

### Step 1: Write the failing test

`tests/integration/opencode-plugin.test.ts` に以下のテストを追加（既存 `describe` ブロック内、適切な位置）:

```ts
  it("exposes a config hook", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    expect(typeof handlers.config).toBe("function");
  });

  it("registers justice commands via the config hook", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const config = { command: {} };

    await handlers.config?.(config as never);

    expect(config.command["justice-start"]).toEqual({
      template: "$ARGUMENTS",
      description: "Start a Justice-managed development workflow",
    });
    expect(config.command["justice-implement"]).toEqual({
      template: "$ARGUMENTS",
      description: "Arm the next Justice-managed implementation delegation",
    });
  });

  it("does not overwrite existing commands via the config hook", async () => {
    const handlers = await OpenCodePlugin(fakeInit() as never);
    const config = {
      command: {
        "justice-start": {
          template: "custom",
          description: "existing",
        },
      },
    };

    await handlers.config?.(config as never);

    expect(config.command["justice-start"]).toEqual({
      template: "custom",
      description: "existing",
    });
    expect(config.command["justice-implement"]).toBeDefined();
  });

  it("fails open when the config hook throws", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);

    // Force an unexpected mutation path by passing a frozen object; the
    // adapter should still log a warning and return without throwing.
    const config = Object.freeze({ command: {} });

    await expect(
      handlers.config?.(config as never),
    ).resolves.toBeUndefined();

    const logFn = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    expect(logFn).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: expect.stringContaining(
          "Failed to auto-register slash commands",
        ),
      }),
    );
  });
```

### Step 2: Run test to verify it fails

Run:
```bash
bun run test tests/integration/opencode-plugin.test.ts
```

Expected: FAIL because `config` hook does not exist or does not register commands.

### Step 3: Write minimal implementation

`src/opencode-plugin.ts` の return オブジェクトに `config` フックを追加:

```ts
import { registerJusticeCommands } from "./runtime/command-registration";

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
    event: async (input) => {
      // ... existing ...
    },
    // ... 残りの既存フック ...
  };
```

注意:
- `registerJusticeCommands` の import はファイル先頭の既存 import 群に追加する。
- `config` フックは `tool` の直後など、読みやすい位置に配置する。
- `config` パラメータの型は `@opencode-ai/plugin` の `Config` 型とする。

### Step 4: Run test to verify it passes

Run:
```bash
bun run test tests/integration/opencode-plugin.test.ts
```

Expected: PASS

### Step 5: Commit

```bash
GIT_MASTER=1 git add src/opencode-plugin.ts tests/integration/opencode-plugin.test.ts
GIT_MASTER=1 git commit -m "feat: OpenCode プラグインに config フックを追加"
```

---

## Task 3: README の手動登録手順を削除

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: なし
- Produces: 更新された README ドキュメント

### Step 1: Identify manual registration sections

`README.md` 内で `/justice-start` および `/justice-implement` の有効化手順を探す。通常、以下のような内容が含まれる:

- `.opencode/commands/justice-start.md` および `.opencode/commands/justice-implement.md` の作成例
- `opencode.jsonc` の `command` オブジェクトへの手動追加例

### Step 2: Replace with auto-registration note

該当セクションを以下のような記述に置き換える:

```markdown
## スラッシュコマンド

`/justice-start` と `/justice-implement` は、Justice プラグインが OpenCode の `config` フックを通じて自動的に登録します。個別に `.opencode/commands/*.md` や `opencode.jsonc` の `command` オブジェクトを作成する必要はありません。

既に同一名のコマンドを定義している場合、Justice はその定義を尊重し、上書きしません。
```

### Step 3: Run lint / typecheck

Run:
```bash
bun run lint
bun run typecheck
```

Expected: PASS

### Step 4: Commit

```bash
GIT_MASTER=1 git add README.md
GIT_MASTER=1 git commit -m "docs: README から手動コマンド登録手順を削除"
```

---

## Task 4: 全品質ゲートの実行

**Files:**
- All changed files

### Step 1: Run full test suite

```bash
bun run test
```

Expected: All tests pass.

### Step 2: Run typecheck

```bash
bun run typecheck
```

Expected: No errors.

### Step 3: Run lint

```bash
bun run lint
```

Expected: No errors.

### Step 4: Run build

```bash
bun run build
```

Expected: Build succeeds.

### Step 5: Push the branch

```bash
GIT_MASTER=1 git push
```

---

## Self-Review Checklist

- [ ] `src/runtime/command-registration.ts` が作成され、テストでカバーされている
- [ ] `src/opencode-plugin.ts` が `config` フックを返し、fail-open になっている
- [ ] `tests/integration/opencode-plugin.test.ts` に `config` フックの統合テストが追加されている
- [ ] `README.md` から手動登録手順が削除されている
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` がすべて通過する
