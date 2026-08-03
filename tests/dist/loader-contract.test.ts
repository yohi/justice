// tests/dist/loader-contract.test.ts
// FF-009: 配布エントリのローダ契約回帰テスト（設計書 §5.4）。
// package.json の exports に宣言された全エントリを self-reference specifier 経由で
// import して検証する。dist へのファイルパス直 import は禁止 — パス直 import は
// exports マップを一切経由しないため、exports["."] の誤マッピング（今回の真因）を
// 構造的に検出できない。
import { describe, expect, it } from "vitest";
import { checkLoaderContract } from "../../src/core/loader-contract";

const PLUGIN_ENTRY_SPECIFIERS = ["@yohi/justice", "@yohi/justice/opencode"] as const;
const ALL_SPECIFIERS = [
  "@yohi/justice",
  "@yohi/justice/opencode",
  "@yohi/justice/core",
  "@yohi/justice/runtime",
] as const;

describe("FF-009: distribution entry loader contract", () => {
  // 検証 3: 全エントリの解決可能性（テストランタイム = Bun 上で import 可能）
  it.each(ALL_SPECIFIERS)('resolves and imports "%s" via self-reference', async (specifier) => {
    const mod = (await import(specifier)) as Record<string, unknown>;
    expect(Object.keys(mod).length).toBeGreaterThan(0);
  });

  // 検証 1: plugin エントリの全 export がローダ契約を満たす
  it.each(PLUGIN_ENTRY_SPECIFIERS)(
    'every export of plugin entry "%s" satisfies the OpenCode loader contract',
    async (specifier) => {
      const mod = (await import(specifier)) as Record<string, unknown>;
      const result = checkLoaderContract(mod);
      expect(result.violations).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );

  // 検証 2: plugin エントリの一意性（dedup 後に正確に 1 プラグイン）
  it.each(PLUGIN_ENTRY_SPECIFIERS)(
    'plugin entry "%s" resolves to exactly one plugin factory after identity dedup',
    async (specifier) => {
      const mod = (await import(specifier)) as Record<string, unknown>;
      const result = checkLoaderContract(mod);
      expect(result.pluginFactories).toHaveLength(1);
    },
  );

  // 検証 4: plugin export の実行可能性（factory 呼出しで Hooks が返る。
  // adapter 生成と getTools() のみで #runInit() は遅延実行のためディスク I/O は発生しない）
  it("plugin factory returns Hooks when invoked with a stub PluginInput", async () => {
    const mod = (await import("@yohi/justice")) as Record<string, unknown>;
    const { pluginFactories } = checkLoaderContract(mod);
    expect(pluginFactories).toHaveLength(1);
    const factory = pluginFactories[0] as (
      init: unknown,
      options?: unknown,
    ) => Promise<Record<string, unknown>>;
    const stubInit = {
      project: {},
      client: { app: { log: () => {} } },
      $: () => {},
      directory: "./justice-ff009-stub",
      worktree: "./justice-ff009-stub",
    };
    const hooks = await factory(stubInit);
    expect(typeof hooks).toBe("object");
    expect(hooks).toHaveProperty("tool");
    expect(hooks).toHaveProperty("event");
  });
});
