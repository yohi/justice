# Justice 指摘事項対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** コードレビューで指摘された CI 重複ビルド、doctor CLI の堅牢性・性能、設定ファイル構文エラー、誤検出パターンなどを修正する。

**Architecture:** 各指摘は独立した小さな修正で、対象ファイルを surgical に変更する。テストは既存の mock FS / integration test を活用し、新たな外部依存は追加しない。

**Tech Stack:** TypeScript, Bun, Vitest, Node.js fs/promises

## Global Constraints

- `src/core/**` は `@opencode-ai/*` を import してはいけない（本計画では core に変更なしだが、helpers/cli の変更時に留意）。
- すべてのファイル I/O 境界は fail-open で例外を吸収する。
- 単体テストでは mock file system / mock notifier を注入する。
- TypeScript 型安全性を損なわない。`as any` / `@ts-ignore` / `@ts-expect-error` は禁止。
- 絶対パスを commit してはいけない。

---

### Task 1: `vitest.integration.config.ts` の重複 `export default` を削除

**Files:**
- Modify: `vitest.integration.config.ts:19-27`
- Test: `bun run typecheck`, `bun run build`

**Interfaces:**
- 変更前後で Vitest config の型と出力が一致することを確認する。

- [x] **Step 1: 重複ブロックを削除**

`vitest.integration.config.ts` の19〜27行目（2つ目の `export default`）を削除する。1つ目の coverage 設定付きブロックを残す。

```ts
import { defineConfig } from "vitest/config";

// 実 FS / 実モジュールを対象とする統合テスト（設計書 §12）。
// ビルド前提は package.json の "test:integration" script 自体が保証する。
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/real-fs/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
  },
});
```

- [x] **Step 2: 型チェック・ビルドを実行**

Run: `bun run typecheck && bun run build`
Expected: 成功（重複 export default による構文エラーが解消される）。

- [x] **Step 3: テストを実行して回帰がないことを確認**

Run: `bun run test:integration`
Expected: 成功。

---

### Task 2: `doctor-cli.ts` `readFileStats` を try-catch 内に移動

**Files:**
- Modify: `src/runtime/doctor-cli.ts:110-125`
- Test: `tests/real-fs/doctor-resolver.test.ts`（既存）

**Interfaces:**
- `summarizeObservationData(deps: DoctorDeps): Promise<string>` の出力は変更しない。
- `readFileStats` が throw しても例外を吸収し、best-effort で継続する。

- [x] **Step 1: ループ内の try-catch を拡大**

現状:
```ts
for (const shard of shards) {
  try {
    recordCount += (await deps.fileReader.readFile(shard))
      .split("\n")
      .filter((l) => l.trim()).length;
  } catch {
    // 読めない shard は件数から除外（診断は best-effort）。
  }
  const stats = await deps.fileReader.readFileStats(shard);
  if (stats !== null && stats.mtimeMs > lastWriteMs) lastWriteMs = stats.mtimeMs;
}
```

変更後:
```ts
for (const shard of shards) {
  try {
    recordCount += (await deps.fileReader.readFile(shard))
      .split("\n")
      .filter((l) => l.trim()).length;
    const stats = await deps.fileReader.readFileStats(shard);
    if (stats !== null && stats.mtimeMs > lastWriteMs) lastWriteMs = stats.mtimeMs;
  } catch {
    // 読めない shard は件数・更新日時から除外（診断は best-effort）。
  }
}
```

- [x] **Step 2: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。既存テストは green のまま。

---

### Task 3: `doctor-cli.ts` shard 読み込みの並列化

**Files:**
- Modify: `src/runtime/doctor-cli.ts:108-129`
- Test: `tests/real-fs/doctor-resolver.test.ts`

**Interfaces:**
- `summarizeObservationData` の返り値の文字列は現状と同一に保つ。
- 各 shard の readFile/readFileStats は独立に並列実行する。

- [x] **Step 1: `Promise.all` で並列化**

変更後:
```ts
async function summarizeObservationData(deps: DoctorDeps): Promise<string> {
  const eventsRoot = `${deps.cwd}/.justice/events`;
  const shards = (await deps.fileReader.listFiles(eventsRoot)).filter((p) => p.endsWith(".jsonl"));
  if (shards.length === 0) return "  .justice/events: なし（未観測）";
  const results = await Promise.all(
    shards.map(async (shard) => {
      try {
        const content = await deps.fileReader.readFile(shard);
        const recordCount = content.split("\n").filter((l) => l.trim()).length;
        const stats = await deps.fileReader.readFileStats(shard);
        return { recordCount, mtimeMs: stats?.mtimeMs ?? 0 };
      } catch {
        return { recordCount: 0, mtimeMs: 0 };
      }
    }),
  );
  const recordCount = results.reduce((sum, r) => sum + r.recordCount, 0);
  const lastWriteMs = results.reduce((max, r) => Math.max(max, r.mtimeMs), 0);
  const lastWrite = lastWriteMs > 0 ? new Date(lastWriteMs).toISOString() : "不明";
  return `  .justice/events: shard ${shards.length} 件 / レコード ${recordCount} 件 / 最終書込 ${lastWrite}`;
}
```

- [x] **Step 2: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。出力形式が変わらないことを確認。

---

### Task 4: `doctor-cli.ts` config 候補読み込みの並列化

**Files:**
- Modify: `src/runtime/doctor-cli.ts:91-106`
- Test: `tests/real-fs/doctor-resolver.test.ts`、`tests/unit/runtime/doctor-cli.test.ts` など

**Interfaces:**
- `scanAllSources` は `readonly SourceScanResult[]` を返す。順序は現状の `configCandidates` 順を保つ（`Promise.all` + map で順序は保たれる）。

- [x] **Step 1: `Promise.all` で並列化**

現状の for-loop を以下に置き換える:
```ts
async function scanAllSources(deps: DoctorDeps): Promise<readonly SourceScanResult[]> {
  const candidates = configCandidates(deps);
  const scans = await Promise.all(
    candidates.map(async (candidate) => {
      if (!candidate.readable) {
        return scanUnreadableSource(candidate.source, candidate.rawContent);
      }
      if (candidate.path === undefined) {
        // 到達しないはずだが型安全のため
        return scanUnreadableSource(candidate.source, candidate.rawContent);
      }
      try {
        return scanConfigContent(candidate.source, await deps.fileReader.readFile(candidate.path));
      } catch {
        // 読めない設定ファイルは存在しないものとして扱う（例外で落とさない）。
        return { source: candidate.source, readable: true, specifiers: [], diagnostics: [] };
      }
    }),
  );
  return scans;
}
```

- [x] **Step 2: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。`scanAllSources` の返り値の型は `readonly SourceScanResult[]` のまま。

---

### Task 5: `doctor-cli.ts` `XDG_CACHE_HOME=""` 空文字対応

**Files:**
- Modify: `src/runtime/doctor-cli.ts:321-324`
- Test: 既存の `tests/real-fs/doctor-resolver.test.ts` または新規ユニットテスト

**Interfaces:**
- `cacheRoot` の計算ロジックを変更。`XDG_CACHE_HOME` が空文字列でも `HOME/.cache` に fallback する。
- `DoctorDeps.cacheRoot` の型は `string` のまま。

- [x] **Step 1: 空文字列も fallback 対象にする**

現状:
```ts
const xdgCache = env.XDG_CACHE_HOME;
const cacheBase = xdgCache === undefined ? `${home}/.cache` : xdgCache;
```

変更後:
```ts
const xdgCache = env.XDG_CACHE_HOME;
const cacheBase = xdgCache === undefined || xdgCache === "" ? `${home}/.cache` : xdgCache;
```

- [x] **Step 2: テスト追加（既存テストにケース追加）**

`tests/real-fs/doctor-resolver.test.ts` または `tests/unit/runtime/doctor-cli.test.ts` に、`XDG_CACHE_HOME=""` の場合に `cacheRoot` が `~/.cache/opencode` になることを検証するケースを追加する。テストは mock `env` を使う。

- [x] **Step 3: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。

---

### Task 6: `doctor-logs.ts` 条件付き spread の簡潔化

**Files:**
- Modify: `src/core/doctor-logs.ts:33-40`
- Test: `tests/unit/core/doctor-logs.test.ts`

**Interfaces:**
- `scanOpenCodeLogText` の返り値の型は `OpenCodeLogScan` のまま。
- テストで `lastFailedToLoadPlugin` / `lastJusticeInitialized` が存在しない場合のオブジェクト構造を確認する。

- [x] **Step 1: 直接 undefined 代入に変更**

現状:
```ts
return {
  failedToLoadPluginCount,
  ...(lastFailedToLoadPlugin === undefined ? {} : { lastFailedToLoadPlugin }),
  justiceInitializedCount,
  ...(lastJusticeInitialized === undefined ? {} : { lastJusticeInitialized }),
};
```

変更後:
```ts
return {
  failedToLoadPluginCount,
  lastFailedToLoadPlugin,
  justiceInitializedCount,
  lastJusticeInitialized,
};
```

- [x] **Step 2: 既存テストの確認**

`lastFailedToLoadPlugin` や `lastJusticeInitialized` が `undefined` のまま返るケースで、テストが `toEqual` 等で `undefined` を許容しているか確認する。もしテストがキー存在を厳密に比較している場合はテストを更新する。

- [x] **Step 3: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。

---

### Task 7: `isJusticeSpecifier` の誤検出修正と共通化

**Files:**
- Modify: `src/runtime/doctor-cli-helpers.ts:119-127`
- Modify: `src/core/doctor-config.ts:157-163`
- Create: `src/core/justice-specifier.ts`（新規 shared utility、または `doctor-config.ts` から export）
- Test: `tests/unit/core/doctor-config.test.ts`、`tests/unit/runtime/doctor-cli-helpers.test.ts`

**Interfaces:**
- `isJusticeSpecifier(value: string): boolean` を単一の実装にする。
- core から export し、helpers 側は core の関数を再エクスポートまたは使用する。
- ローカルパス指定の場合、basename またはパスセグメントが "justice" または "justice-" で始まる場合のみ true とする。

- [x] **Step 1: core に共有関数を実装・export**

`src/core/doctor-config.ts` の `isJusticeSpecifier` を export する:
```ts
export function isJusticeSpecifier(value: string): boolean {
  return (
    value === "@yohi/justice" ||
    value.startsWith("@yohi/justice@") ||
    value.startsWith("@yohi/justice/") ||
    (value.startsWith("/") &&
      value.split("/").some(
        (segment) => segment === "justice" || segment.startsWith("justice-"),
      ))
  );
}
```

- [x] **Step 2: helpers 側を core の関数に置き換え**

`src/runtime/doctor-cli-helpers.ts`:
- import に `isJusticeSpecifier` を `../core/doctor-config` から追加。
- ローカル `isJusticeSpecifier` 関数を削除。

```ts
import type { ConfigDiagnostic, JusticePluginSpecifier, isJusticeSpecifier } from "../core/doctor-config";
// ...
export { isJusticeSpecifier };
```

または `doctor-cli.ts` / `doctor-cli-helpers.ts` 内で `import { isJusticeSpecifier } from "../core/doctor-config"` し直接使う。

- [x] **Step 3: テスト追加**

以下のケースを追加:
- `/home/user/injustice-report/index.ts` → false
- `/usr/local/lib/no-justice-helper/lib.js` → false
- `/path/to/justice/index.js` → true
- `/path/to/justice-plugin/index.js` → true

- [x] **Step 4: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。

---

### Task 8: `doctor-cli-helpers.ts` ローダ契約結果の直接使用

**Files:**
- Modify: `src/runtime/doctor-cli-helpers.ts:42-46`
- Test: `tests/unit/runtime/doctor-cli-helpers.test.ts`（存在しない場合は既存テストでカバー）

**Interfaces:**
- `resolveAndCheckSpecifier` の `failed` フラグを `contract.ok` から直接計算する。
- `formatContractResult` の出力には手を加えない。

- [x] **Step 1: `contract.ok` を直接使用**

現状:
```ts
const contractLines = formatContractResult(contract);
const failed = contractLines.some((l) => l.startsWith("  ✗"));
lines.push(...contractLines);
return { failed, lines };
```

変更後:
```ts
const contractLines = formatContractResult(contract);
const failed = !contract.ok;
lines.push(...contractLines);
return { failed, lines };
```

- [x] **Step 2: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。

---

### Task 9: `doctor-cli-helpers.ts` ログファイル読み込みの並列化

**Files:**
- Modify: `src/runtime/doctor-cli-helpers.ts:107-121`
- Test: `tests/unit/runtime/doctor-cli-helpers.test.ts`

**Interfaces:**
- `formatLogScanLines` の返り値の文字列配列の順序は現状と同一に保つ。
- 各ログファイルの読み込みは `Promise.all` で並列化する。

- [x] **Step 1: `Promise.all` で並列化**

現状の for-loop を以下に置き換える:
```ts
export async function formatLogScanLines(deps: DoctorDeps): Promise<readonly string[]> {
  const lines: string[] = [];
  const summaries = await Promise.all(
    deps.logPaths.map(async (logPath) => {
      try {
        const scan = scanOpenCodeLogText(await deps.fileReader.readFile(logPath));
        const summary = `  ${logPath}: failed_to_load=${scan.failedToLoadPluginCount} 件 / initialized=${scan.justiceInitializedCount} 件`;
        const details: string[] = [];
        if (scan.lastFailedToLoadPlugin !== undefined) {
          details.push(`    直近の失敗: ${scan.lastFailedToLoadPlugin}`);
        }
        if (scan.lastJusticeInitialized !== undefined) {
          details.push(`    直近の初期化: ${scan.lastJusticeInitialized}`);
        }
        return [summary, ...details];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [`  ${logPath}: 読み込めません (${message})`];
      }
    }),
  );
  for (const entry of summaries) {
    lines.push(...entry);
  }
  return lines;
}
```

- [x] **Step 2: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。

---

### Task 10: `doctor-cli-helpers.ts` ログ読み込みエラーメッセージの追加

**Files:**
- Modify: `src/runtime/doctor-cli-helpers.ts:116-119`
- Test: 既存テストにエラーメッセージを検証するケースを追加

**Interfaces:**
- ログファイル読み込み失敗時、エラーメッセージを含む出力を返す。
- 赤文字化などの UI 変更は行わない。

- [x] **Step 1: catch ブロックを修正**

Task 9 の変更に含めて実装済みになるが、個別に修正する場合:
```ts
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  lines.push(`  ${logPath}: 読み込めません (${message})`);
}
```

- [x] **Step 2: テスト追加**

mock `fileReader.readFile` を `throw new Error("ENOENT: mock")` するケースを用意し、出力に `読み込めません (ENOENT: mock)` が含まれることを `expect(...).toContain(...)` で検証する。

- [x] **Step 3: 型チェック・テスト実行**

Run: `bun run typecheck && bun run test`
Expected: 成功。

---

### Task 11: CI workflow の重複ビルド解消

**Files:**
- Modify: `.github/workflows/ci.yml:14-20`
- Modify: `package.json` からは変更しない（スクリプトはローカルで自己完結させたまま）

**Interfaces:**
- CI では `bun run build` を1回だけ実行し、その後 `vitest` を各 config で直接実行する。
- `Upload Build Artifact` は明示的な `build` ステップに依存するよう `needs` または単純に後続配置で保証する。

- [x] **Step 1: workflow を修正**

現状:
```yaml
      - run: bun run test
      - run: bun run test:dist
      - run: bun run test:integration
      - name: Upload Build Artifact
```

変更後:
```yaml
      - run: bun run test
      - run: bun run build
      - run: bun run vitest run --config vitest.dist.config.ts
      - run: bun run vitest run --config vitest.integration.config.ts
      - name: Upload Build Artifact
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: justice-dist
          path: dist/
```

- [x] **Step 2: ローカルで CI 再現**

Run:
```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run build
bun run vitest run --config vitest.dist.config.ts
bun run vitest run --config vitest.integration.config.ts
```
Expected: すべて成功。build が1回のみ実行される。

---

## Self-Review

- **Spec coverage:** レビュー指摘 11 件すべてに対応タスクがある。
- **Placeholder scan:** コードステップには具体的な diff を含む。TBD/TODO なし。
- **Type consistency:** `isJusticeSpecifier` は core から export し helpers 側で使用。`scanAllSources` / `formatLogScanLines` / `summarizeObservationData` は返り値の型を維持。
- **No external deps:** 新しい npm パッケージは不要。
- **Test strategy:** 各変更は既存テスト + 必要に応じた新規ケースで検証。

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-05-justice-review-fixes.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** - execute tasks in this session using executing-plans.

Please choose.
