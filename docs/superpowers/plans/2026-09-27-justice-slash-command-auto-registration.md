# Justice スラッシュコマンド自動登録 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode v1 Plugin API の `config` フックを使い、`/justice-start` と `/justice-implement` を Justice プラグイン有効化時に自動登録する。

**Architecture:** コマンド定義と OpenCode `Config.command` へのマージロジックを `src/runtime/command-registration.ts` に集約し、`src/opencode-plugin.ts` の `config` フックから await して呼び出す。衝突時は利用者定義を尊重し、config hook の fail-open boundary で登録・logger の例外を抑制する。canonical definitions は entry も freeze し、登録時に shallow clone して Config と mutable object reference を共有しない。

**Tech Stack:** TypeScript, Bun, Vitest, `@opencode-ai/plugin`, `@opencode-ai/sdk`

**OpenCode host contract:** OpenCode v1.18.29 を現在の runtime support baseline とする。OpenCode v1.18.29 および v1.18.32 の upstream source inspection では、Config load → Plugin initialization → Command service の順に処理され、Plugin `config` hook の mutation 後に Command service が `cfg.command` を読む。`@opencode-ai/plugin@1.14.21` は lockfile で解決される compile-time 型 baseline であり、runtime support version とは区別する。v1.18.x 全体を検証済みとは扱わない。実装者は hook の採否・タイミングを再判断しない。

## Global Constraints

- `src/core/**` は `@opencode-ai/*` を import しない（FF-001）。本実装は `src/runtime/` と `src/opencode-plugin.ts` で行う。
- すべてのフック境界は fail-open とし、OpenCode セッションをクラッシュさせない。
- 公開 API は `OpenCodeAdapter.getTools()` の `justice_review` のみ。本変更はコマンド登録の自動化であり、新しいツールは追加しない。
- テストでは `as any` / `@ts-ignore` を使用しない。private フィールドへのアクセスは `(obj as unknown as { field: T }).field` を使用する。
- 開発コマンドは `.devcontainer/` 内で Bun で実行する：`bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`。
- OpenCode の確定済み host contract を前提として実装し、方式選定や runtime spike に戻らない。将来の upstream drift は既存 compatibility audit の対象とする。
- `JUSTICE_COMMAND_DEFINITIONS` と `Config.command` の登録 object は mutable reference を共有しない。既存利用者 command は上書きせず、参照をそのまま保つ。

---

## File Map

| ファイル | 責務 |
|---|---|
| `src/runtime/command-registration.ts`（新規） | Justice コマンド定義と `Config.command` へのマージ処理を提供する純粋関数群 |
| `src/opencode-plugin.ts` | 返す hooks に `config` を追加し、初期化済み `adapter` 経由で登録関数を呼び出す |
| `tests/runtime/command-registration.test.ts`（新規） | `registerJusticeCommands` の純粋関数に対するユニットテスト |
| `tests/integration/opencode-plugin.test.ts` | `OpenCodePlugin` 返却 hooks に `config` が含まれ、正しく動作することを検証する統合テスト |
| `README.md` | 手動登録手順を削除し、自動登録が行われる旨を記載 |
| `SPEC.md` | §4 hook routing / §4.1a / §8 OpenCode mapping と component map に登録責務を追記 |

---

## Task 1: コマンド登録ロジックの実装

**Files:**
- Create: `src/runtime/command-registration.ts`
- Test: `tests/runtime/command-registration.test.ts`

**Interfaces:**
- Consumes: `@opencode-ai/plugin@1.14.21` の `Config` 型（lockfile compile-time baseline）
- Produces: entry-level frozen `JUSTICE_COMMAND_DEFINITIONS`, `CommandRegistrationLogger` (`Promise<void>`), `registerJusticeCommands(config, log): Promise<void>`

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
  it("registers justice-start and justice-implement on an empty config.command", async () => {
    const config: Config = {};
    const log = vi.fn(async () => {});

    await registerJusticeCommands(config, log);

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

  it("does not overwrite existing user-defined commands and logs a warning", async () => {
    const config: Config = {
      command: {
        "justice-start": {
          template: "custom template",
          description: "Custom start command",
        },
      },
    };
    const existing = config.command?.["justice-start"];
    const log = vi.fn(async () => {});

    await registerJusticeCommands(config, log);

    expect(config.command?.["justice-start"]).toEqual({
      template: "custom template",
      description: "Custom start command",
    });
    expect(config.command?.["justice-start"]).toBe(existing);
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

  it("initializes config.command when undefined", async () => {
    const config: Config = { command: undefined };
    const log = vi.fn(async () => {});

    await registerJusticeCommands(config, log);

    expect(config.command).toBeDefined();
    expect(config.command?.["justice-start"]).toBeDefined();
    expect(config.command?.["justice-implement"]).toBeDefined();
  });

  it("isolates registered commands from canonical definitions", async () => {
    expect(Object.keys(JUSTICE_COMMAND_DEFINITIONS)).toEqual([
      "justice-start",
      "justice-implement",
    ]);
    expect(JUSTICE_COMMAND_DEFINITIONS["justice-start"].template).toBe(
      "$ARGUMENTS",
    );

    const config: Config = {};
    await registerJusticeCommands(config, async () => {});
    const registered = config.command?.["justice-start"];
    expect(registered).not.toBe(JUSTICE_COMMAND_DEFINITIONS["justice-start"]);
    registered!.template = "changed";
    expect(JUSTICE_COMMAND_DEFINITIONS["justice-start"].template).toBe("$ARGUMENTS");
    expect(Object.isFrozen(JUSTICE_COMMAND_DEFINITIONS["justice-start"])).toBe(true);
  });

  it("preserves unrelated existing commands", async () => {
    const unrelated = { template: "unrelated" };
    const config: Config = { command: { other: unrelated } };
    await registerJusticeCommands(config, async () => {});
    expect(config.command?.other).toBe(unrelated);
  });

  it("awaits collision logging and propagates logger rejection", async () => {
    const config: Config = { command: { "justice-start": { template: "custom" } } };
    const log = vi.fn(async () => { throw new Error("logger failed"); });
    await expect(registerJusticeCommands(config, log)).rejects.toThrow("logger failed");
    expect(log).toHaveBeenCalledTimes(1);
  });
});
```

### Step 2: Run test to verify it fails

Run:
```bash
bun run test tests/runtime/command-registration.test.ts
```

Expected: FAIL with module not found or function not defined. The mutation-isolation assertion must also fail against a shallow outer-only freeze/shared-reference implementation.

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
  "justice-start": Object.freeze({
    template: "$ARGUMENTS",
    description: "Start a Justice-managed development workflow",
  }),
  "justice-implement": Object.freeze({
    template: "$ARGUMENTS",
    description: "Arm the next Justice-managed implementation delegation",
  }),
});

export type CommandRegistrationLogger = (
  level: "info" | "warn" | "error",
  message: string,
  ...args: unknown[]
) => Promise<void>;

export async function registerJusticeCommands(
  config: Config,
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

`config` hook は確定済み OpenCode v1 host contract に基づいて registration API を await する。登録だけを担当し、workflow parsing / PlanBridge / command execution は行わない。既存の execution hooks は変更しない。

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

    // Force the command assignment itself to throw; the hook must log and resolve.
    const config = new Proxy({ command: {} }, {
      set() { throw new Error("registration failed"); },
    });

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

## Task 3: README と SPEC の command registration 契約を更新

**Files:**
- Modify: `README.md`
- Modify: `SPEC.md`

**Interfaces:**
- Consumes: なし
- Produces: 更新された README ドキュメント

### Step 1: README の既存 heading を更新

対象は次の exact heading に限定する。

- `/justice-start` 配下の `### 有効化（OpenCode側の設定）`
- `/justice-implement` 配下の `### 有効化（OpenCode側の設定）`

### Step 2: README の契約文を置換

両 subsection の手動登録必須という説明と登録手順を、自動登録・collision時の既存定義優先へ置換する。`$ARGUMENTS` は利用者がコマンド後に入力した引数を受け渡し、template は LLM prompt を決める一方 Justice の引数 parsing とは別経路である説明を `/justice-start` subsection 内に残す。共通の自動登録説明は `/justice-start` subsection に置き、`/justice-implement` subsection は共通説明を参照する簡潔な文とする。既存 heading を削除せず、新しい `## スラッシュコマンド` heading は追加しない。

```markdown
`/justice-start` と `/justice-implement` は、Justice プラグインの OpenCode v1 `config` hook により自動登録されます。同名の利用者定義がある場合は内容を変更せず優先します。引数 template の説明はこの subsection に保持します。
```

### Step 3: SPEC §4 / §8 を更新

`SPEC.md` の以下を変更する。

- §4.0 routing overview に `config` 登録処理を加え、`command.execute.before` は実行処理であると英語で明記。
- §4.1a に `config` が `/justice-start` と `/justice-implement` を登録し、既存定義を保持することを追記。登録と workflow execution の責務を英語で分離。
- §8 OpenCode hook mapping に `config`（registration only）を追加し、`command.execute.before`（execution only）と対比。
- §8 runtime component/file map に `src/runtime/command-registration.ts` を追加。
- Host contract として OpenCode v1.18.29 runtime support baseline、v1.18.29/v1.18.32 source evidence、`@opencode-ai/plugin@1.14.21` compile-time baseline を設計書と同じ区別で英語記載。
- Collision policy、fail-open boundary、canonical definition と Config の mutable object reference 非共有を英語で記載する（`SPEC.md` は canonical technical specification として英語を維持）。

### Step 4: Run lint / typecheck

Run:
```bash
bun run lint
bun run typecheck
```

Expected: PASS

### Step 5: Commit

```bash
GIT_MASTER=1 git add README.md SPEC.md
GIT_MASTER=1 git commit -m "docs: コマンド自動登録の仕様を同期"
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

### Step 5: Verify the built distribution

```bash
bun run test:dist
```

Expected: `PASS — built dist package can be loaded through the package self-reference contract.`

### Step 6: Push the branch

```bash
GIT_MASTER=1 git push
```

---

## Self-Review Checklist

- [ ] `src/runtime/command-registration.ts` が作成され、テストでカバーされている
- [ ] `src/opencode-plugin.ts` が `config` フックを返し、fail-open になっている
- [ ] `tests/integration/opencode-plugin.test.ts` に `config` フックの統合テストが追加されている
- [ ] `README.md` の指定された2つの有効化 subsection が自動登録契約に更新され、必要な `$ARGUMENTS` / template 説明が維持されている
- [ ] `SPEC.md` に registration/execution の責務分離、host contract、collision/fail-open/alias isolation、file map が反映されている
- [ ] canonical definitions と登録 Config が mutable object reference を共有しないことを mutation isolation test で確認する
- [ ] logger contract と registration API が Promise based で同期し、config hook が await して fail-open boundary で rejection を扱う
- [ ] `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:dist` がすべて通過する
