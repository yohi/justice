# Cross-Project Wisdom Store

- **Status**: Approved (design)
- **Date**: 2026-04-19
- **Owner**: justice maintainers
- **Related**: 2026-04-19-error-classifier-integration-design.md (independent)

## 1. Goal & Scope

`WisdomStore` をプロジェクト横断で共有可能にする。プロジェクトローカル `.justice/wisdom.json`（現状）に加え、ユーザーホーム配下にグローバル `~/.justice/wisdom.json` を導入。書き込みはカテゴリヒューリスティックで自動振り分け、読み込みはローカル優先でグローバル補填。

### Non-Goals

- MCP サーバー化（将来検討）
- 既存ローカルエントリの自動グローバル移行
- wisdom データの暗号化・署名
- グローバルストアの Git 同期 / マルチマシン同期

### Why now

現在 wisdom は `.justice/wisdom.json` に project-local で閉じており、「Bun X.Y.Z で `import.meta.url` が壊れる」「Vitest の `vi.mock` でモジュールパスは絶対にしない」のような **ツールチェーン横断で価値ある学習がプロジェクトを跨いで共有されない**。同じ罠に複数プロジェクトで嵌り直す状態を解消したい。

## 2. Design Decisions Summary

| 決定事項 | 結論 |
|---|---|
| ストア構成 | ローカル + グローバルの **2 つの独立 `WisdomStore` インスタンス**を新規 `TieredWisdomStore` で合成 |
| グローバルパス | 既定 `~/.justice/wisdom.json`、`JUSTICE_GLOBAL_WISDOM_PATH` 環境変数で上書き可 |
| 書き込み振り分け | カテゴリヒューリスティック (`environment_quirk` / `success_pattern` → global、他は local) + 明示オプションで上書き可 |
| 秘密検出 | パターン照合で検出時は **グローバルへの書き込みをハードブロックしローカルへ保存** （警告ログ出力） |
| 読み込みマージ | ローカル優先・不足分を新しい順でグローバルから補填 |
| 容量 | local 100 件 / global 500 件、超過時は LRU |
| 並行書き込み | atomic write (temp + rename) + read-modify-write と **`.lock` ディレクトリとTTL付きメタデータを用いたプロセス間ファイルロック** |
| 既存 API 互換 | `getWisdomStore()` シグネチャ維持、新規 `getTieredWisdomStore()` 追加 |
| 既存エントリ移行 | しない（新規書き込みのみヒューリスティック適用） |
| SemVer | minor bump（追加のみ・既存挙動不変） |

## 3. Architecture

```text
JusticePlugin
   └─ TieredWisdomStore                          ← 新規クラス
        ├─ localStore: WisdomStore               ← 既存・無変更
        ├─ globalStore: WisdomStore              ← 既存・無変更（インスタンス追加）
        ├─ localPersistence: WisdomPersistence   ← 既存（saveAtomic 追加）
        ├─ globalPersistence: WisdomPersistence  ← 既存（saveAtomic 追加）
        └─ secretDetector: SecretPatternDetector ← 新規（小さなヘルパー）
```

| クラス | 責務 | 変更内容 |
|---|---|---|
| `WisdomStore` | 1 store の in-memory CRUD | `getAllEntries`/`getMaxEntries`/`fromEntries` 追加（pure additions） |
| `WisdomPersistence` | 1 store ↔ 1 ファイルの I/O | `saveAtomic()` 追加 |
| `TieredWisdomStore` | 振り分け / マージ / 秘密検出 | 新規 |
| `SecretPatternDetector` | 秘密パターン照合 | 新規 |
| `JusticePlugin` | `TieredWisdomStore` を保持・提供 | 初期化拡張 + `getTieredWisdomStore()` 追加 |
| `NodeFileSystem` | rootDir 内ファイル I/O | `rename()` 追加 |

## 4. Type Changes

### `src/core/types.ts`

`WisdomEntry` 自体は変更なし（scope フィールドを追加せず、「どのファイルに保存されているか」が事実上の scope 表現）。`FileWriter` インタフェースに `rename()` を追加:

```ts
export interface FileWriter {
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;  // NEW
}
```

両 path とも `rootDir` 配下に閉じる必要があり、現行の path traversal 防御がそのまま適用される。

`WisdomStore` の serialize/deserialize 形式は不変なため、ローカル既存ファイルは破壊なく読み込み可能。

## 5. New File: `src/core/secret-pattern-detector.ts` (~30 行)

```ts
export interface SecretMatch {
  readonly name: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "api_key", pattern: /(?:\b|_)api[-_]?key(?=\b|_|$)/i },
  { name: "password", pattern: /\b(?:db|db_|admin_|root_)?password\b/i },
  { name: "secret", pattern: /\b(?:client_secret|secret[_-]?key)\b/i },
  { name: "token", pattern: /\b(?:bearer_token|access_token|refresh_token|github_token)\b/i },
  { name: "home_path_linux", pattern: /\/home\/[^/\s]+\/?/ },
  { name: "home_path_macos", pattern: /\/Users\/[^/\s]+\/?/ },
  { name: "home_path_windows", pattern: /[a-zA-Z]:\\Users\\[^\\\s]+\\?/ },
  { name: "openai_key", pattern: /\bsk-(?!ant-)(?:proj-)?[a-zA-Z0-9_-]{20,}\b/ },
  { name: "anthropic_key", pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/ },
];

export class SecretPatternDetector {
  scan(content: string): SecretMatch[] {
    return SECRET_PATTERNS
      .filter(({ pattern }) => pattern.test(content))
      .map(({ name }) => ({ name }));
  }
}
```

### Pattern Selection Notes

- `\bsecret\b` / `\btoken\b` のような広い単語境界でのマッチは誤検知（False positive）が多すぎるため、`client_secret` や `bearer_token` などのより限定的・厳密な正規表現へと改善されています。
- ホームパスは Linux / macOS に加えて Windows パターンも検出されます。
- API キーは Anthropic (`sk-ant-`) と OpenAI (`sk-`) の頭辞をリテラル長と組み合わせて検出されます。
- 検知された場合は **ハードブロック** となり、該当エントリはグローバルストアへの書き込みが拒否され、代わりにローカルストアへ書き込まれます。

## 6. New File: `src/core/tiered-wisdom-store.ts` (~120 行)

### 6.1 Routing — `add()`

```ts
add(
  entry: Omit<WisdomEntry, "id" | "timestamp">,
  options?: { scope?: "local" | "global" },
): WisdomEntry {
  const explicitScope = options?.scope;
  const heuristicScope: "local" | "global" =
    entry.category === "environment_quirk" ? "global" :
    entry.category === "success_pattern"   ? "global" :
    "local";

  const targetScope = explicitScope ?? heuristicScope;

  if (targetScope === "global") {
    const detected = this.secretDetector.scan(entry.content);
    if (detected.length > 0) {
      if (this.logger) {
        this.logger.warn(
          `Wisdom entry promotion to global BLOCKED: may contain secrets ` +
          `(patterns matched: ${detected.map(m => m.name).join(", ")}). ` +
          `The entry has been saved to the local store instead. ` +
          `Review entry content or redact secrets before trying to promote to ${this.globalDisplayPath}.`
        );
      }
      return this.localStore.add(entry);
    }
    return this.globalStore.add(entry);
  }
  return this.localStore.add(entry);
}
```

### 6.2 Routing Matrix

| Category | デフォルト保存先 | 理由 |
|---|---|---|
| `environment_quirk` | global | ツールチェーン/ランタイム固有のハマり所は横断価値高 |
| `success_pattern` | global | 汎用テクニックは横断価値高 |
| `failure_gotcha` | local | 多くがプロジェクト固有のコード起因 |
| `design_decision` | local | プロジェクト固有の設計判断 |

明示オプション `{ scope: "local" }` または `{ scope: "global" }` で上書き可能。エージェントが「これはこのコードベース固有のメモ」と判断した時の逃げ道。

### 6.3 Read Merge — `getRelevant()`

```ts
getRelevant(options?: { errorClass?: ErrorClass; maxEntries?: number }): WisdomEntry[] {
  const limit = options?.maxEntries ?? 10;

  const localEntries = this.localStore.getRelevant({ ...options, maxEntries: limit });
  if (localEntries.length >= limit) return localEntries;

  const remaining = limit - localEntries.length;
  const globalEntries = this.globalStore.getRelevant({ ...options, maxEntries: remaining });

  return [...localEntries, ...globalEntries];
}
```

**ローカル優先の挙動上の注意**: ローカルが `limit` 件を満たす場合、グローバルの新エントリ（より新しい timestamp を持つもの）は返却されません。これは Q11 で承認されたローカル優先設計の結果で、現プロジェクト最近のコンテキストを最優先するためです。「全体 timestamp 順マージで上位 N 件」を期待する読者がいる可能性があるため、実装時はテストで本挙動を担保すること。

`getByTaskId()` / `formatForInjection()` は両 store のヒットを単純結合します。同一 taskId が両 store に存在するケースは正常で、例えば 1 つの task が `failure_gotcha` (local) と `environment_quirk` (global) の両カテゴリの wisdom を生成した場合に発生します。`WisdomStore.getByTaskId()` は既に `WisdomEntry[]` 返却、`formatForInjection()` は配列を受け取る既存 API のため、API 変更は不要。

### 6.4 Persistence Coordination

```ts
async loadAll(): Promise<void> {
  this.localStore = await this.localPersistence.load();
  this.globalStore = await this.globalPersistence.load();
}

async persistAll(): Promise<void> {
  await this.localPersistence.saveAtomic(this.localStore);
  await this.globalPersistence.saveAtomic(this.globalStore);
}
```

### 6.5 Capacity

- ローカル: `new WisdomStore(100)` (現状維持)
- グローバル: `new WisdomStore(500)` (プロジェクト 5 個 × 100 相当)
- 各 store の LRU 削除挙動は既存どおり（`add()` 内の `entries.shift()`）

## 7. `WisdomStore` Additions (Pure)

```ts
class WisdomStore {
  // ... existing methods unchanged ...

  // NEW
  getAllEntries(): readonly WisdomEntry[] {
    return this.entries;
  }

  // NEW
  getMaxEntries(): number {
    return this.maxEntries;
  }

  // NEW
  static fromEntries(entries: readonly WisdomEntry[], maxEntries = 100): WisdomStore {
    const store = new WisdomStore(maxEntries);
    for (const entry of entries) {
      store.entries.push(entry);
    }
    while (store.entries.length > maxEntries) {
      store.entries.shift();
    }
    return store;
  }
}
```

すべて pure な追加で既存挙動・既存テストに影響なし。

## 8. `WisdomPersistence.saveAtomic()`

```ts
async saveAtomic(store: WisdomStore): Promise<void> {
  const currentOnDisk = await this.load();
  const merged = this.mergeById(currentOnDisk.getAllEntries(), store.getAllEntries());
  const capped = merged.slice(-store.getMaxEntries());

  const finalStore = WisdomStore.fromEntries(capped, store.getMaxEntries());
  const json = finalStore.serialize();

  const tmpPath = `${this.wisdomFilePath}.tmp.${process.pid}.${randomBytes(4).toString("hex")}`;
  await this.fileWriter.writeFile(tmpPath, json);
  await this.fileWriter.rename(tmpPath, this.wisdomFilePath);
}

private mergeById(
  diskEntries: readonly WisdomEntry[],
  memoryEntries: readonly WisdomEntry[],
): WisdomEntry[] {
  const byId = new Map<string, WisdomEntry>();
  for (const e of diskEntries) byId.set(e.id, e);
  for (const e of memoryEntries) {
    const existing = byId.get(e.id);
    if (!existing || e.timestamp > existing.timestamp) {
      byId.set(e.id, e);
    }
  }
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
```

既存の `save()` も保持して後方互換（テスト互換のため）。新コードは `saveAtomic()` を使用。

### Atomicity Guarantees

- `writeFile` で temp ファイルに書く（途中クラッシュしても本体は無傷）
- `rename` は POSIX 上 atomic（同一ファイルシステム内の場合）
- temp ファイル名に `process.pid + random` を含めることで、複数プロセスが同時実行しても tmp が衝突しない
- Race window: `load → merge → write` 間に他プロセスが `saveAtomic` した場合、後勝ちで一部ロストの可能性は残る。wisdom 書き込みは低頻度のため許容範囲

### 設計意図: 意図的な file-lock 設計

初期設計ではクロスプロセスファイルロックを意図的に採用しない（オーバーキルなため）としていましたが、複数プロセスの並行動作時におけるデータの確実な保護（race window の排除）を重視し、**`.lock` ディレクトリの作成・メタデータ（PIDやhostname）記録・TTLおよび指数バックオフリトライによるプロセス間ファイルロック機構を採用** しました。これにより `load → merge → write` の間の競合が防がれています。

## 9. `NodeFileSystem.rename()` Implementation

```ts
async rename(from: string, to: string): Promise<void> {
  const safeFrom = await this.resolveSafelyForWrite(from);
  const safeTo = await this.resolveSafelyForWrite(to);
  await fsRename(safeFrom, safeTo);
}
```

両 path とも `resolveSafelyForWrite` を通すため、path traversal 防御が効く。`fsRename` は `node:fs/promises.rename`。

## 10. Global FS Construction (`JusticePlugin` 初期化)

```ts
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import { mkdir } from "node:fs/promises";

async function createGlobalFs(logger?: Logger): Promise<{
  fs: NodeFileSystem;
  relativePath: string;
} | null> {
  try {
    const envPath = process.env.JUSTICE_GLOBAL_WISDOM_PATH;
    let globalRoot: string;
    let relativePath: string;

    if (envPath) {
      globalRoot = dirname(envPath);
      relativePath = basename(envPath);
    } else {
      const home = homedir();
      if (!home) {
        logger?.warn("Cannot determine home directory; global wisdom store disabled. Set JUSTICE_GLOBAL_WISDOM_PATH to enable.");
        return null;
      }
      globalRoot = join(home, ".justice");
      relativePath = "wisdom.json";
    }

    await mkdir(globalRoot, { recursive: true });
    return { fs: new NodeFileSystem(globalRoot), relativePath };
  } catch (error) {
    logger?.warn(`Failed to initialize global wisdom store: ${error}; falling back to local-only.`);
    return null;
  }
}
```

`createGlobalFs()` が `null` を返した場合（HOME 不在・mkdir 失敗・権限不足など）、`JusticePlugin` は **fail-open**:
- `globalStore` に in-memory の空 `WisdomStore` を入れる
- `globalPersistence` は `NoOpPersistence`（読み書きを no-op に置換するスタブ）を入れる
- `TieredWisdomStore` は通常通り構築され、振り分けロジックは動作（global 行きは in-memory のみで揮発）

これにより既存ユーザーが想定外環境で起動しても、ローカル wisdom 機能は正常動作。

## 11. Public API (Backwards Compat)

```ts
export class JusticePlugin {
  // 既存 — シグネチャ変更なし
  getWisdomStore(): WisdomStore {
    return this.tieredWisdomStore.getLocalStore();
  }

  // 新規
  getTieredWisdomStore(): TieredWisdomStore {
    return this.tieredWisdomStore;
  }
}
```

`TieredWisdomStore` には公開 getter `getLocalStore() / getGlobalStore()` を用意。

新コード（`task-feedback.ts` 等の wisdom を書き込むフック）は段階的に `getTieredWisdomStore()` 経由へ移行。既存外部利用者は `getWisdomStore()` のままでローカル動作のみで継続。

## 12. Test Plan

### 12.1 New: `tests/secret-pattern-detector.test.ts` (~40 行)

- 各 SECRET_PATTERNS 8 件が代表的な秘密文字列にマッチ
- 通常コメント "this is a normal comment" が空配列を返す
- 複数パターンマッチ時に複数の name が返る
- 大文字小文字の混在 ("API_KEY", "Api-Key") を正しく検出

### 12.2 New: `tests/tiered-wisdom-store.test.ts` (~150 行)

| テストケース | 期待 |
|---|---|
| `add({category: "environment_quirk", ...})` | globalStore.add が呼ばれる |
| `add({category: "success_pattern", ...})` | globalStore.add が呼ばれる |
| `add({category: "failure_gotcha", ...})` | localStore.add が呼ばれる |
| `add({category: "design_decision", ...})` | localStore.add が呼ばれる |
| `add({category: "environment_quirk", ...}, {scope: "local"})` | localStore.add が呼ばれる |
| `add({category: "failure_gotcha", ...}, {scope: "global"})` | globalStore.add が呼ばれる |
| 秘密含むエントリを global へ追加 | logger.warn 呼び出し + globalStore.add 実行 |
| 秘密含むエントリを local へ追加 | logger.warn 呼び出されない |
| `getRelevant({maxEntries: 10})`、ローカル 10 件以上 | local のみ 10 件返却 |
| `getRelevant({maxEntries: 10})`、ローカル 3 件 | local 3 件 + global 7 件 |
| `getRelevant({maxEntries: 10, errorClass: "test_failure"})` | 両 store でフィルタ後にマージ |
| `getByTaskId("task-1")` | 両 store のヒットを集約 |

### 12.3 New: `tests/wisdom-persistence-atomic.test.ts` (~80 行)

| テストケース | 期待 |
|---|---|
| `saveAtomic` 単体実行 | tmp ファイル → rename で本ファイル更新 |
| 並行 `saveAtomic` 2 件 | 両エントリが merged 状態でディスクに残る |
| ディスクに既存 5 件、新規 3 件 saveAtomic | 8 件マージ済み（id 重複時は新 timestamp 勝ち） |
| 既存 maxEntries=100、120 件マージ結果 | LRU で 100 件にトリム |
| `rename` 失敗（mock で reject） | エラー伝播・本ファイル無傷 |

### 12.4 New: `tests/justice-plugin-global-fs.test.ts` (~60 行)

| テストケース | 期待 |
|---|---|
| `JUSTICE_GLOBAL_WISDOM_PATH=/tmp/foo/bar.json` 設定時 | rootDir=`/tmp/foo`、relativePath=`bar.json` で構築 |
| 環境変数未設定時 | rootDir=`~/.justice`、relativePath=`wisdom.json` |
| HOME 不在 + 環境変数なし | warn ログ出力 + `getTieredWisdomStore()` は動作（global は in-memory only） |
| `mkdir` 失敗（権限なし mock） | warn ログ + fail-open で起動継続 |

### 12.5 Existing Tests

`WisdomStore` (既存 17 件) / `WisdomPersistence` (既存 8 件) / `JusticePlugin` (既存 12 件) のテストは pure additions のため全件 pass の想定。

### 12.6 Coverage Target

新規追加分のラインカバレッジ 90% 以上（fail-open の異常系分岐を除く）。`TieredWisdomStore` の routing マトリクス (4 カテゴリ × 2 scope オプション) は table-driven で網羅。

## 13. Documentation Updates

### `README.md`

- "コアコンポーネント" 表に `TieredWisdomStore` / `SecretPatternDetector` を追加
- 新セクション "Cross-Project Wisdom Store":
  - グローバルストアの概念説明
  - `~/.justice/wisdom.json` の場所
  - `JUSTICE_GLOBAL_WISDOM_PATH` 環境変数の説明
  - 振り分けマトリクス表

### `SPEC.md`

- データフロー図に local/global 2 階層を反映
- `TieredWisdomStore` の API 仕様

### `CHANGELOG.md`

- "Unreleased" / minor
- "feat(wisdom): cross-project wisdom store with category-heuristic routing. environment_quirk and success_pattern entries auto-promote to `~/.justice/wisdom.json` (configurable via `JUSTICE_GLOBAL_WISDOM_PATH`). Local store behavior preserved; existing entries are not migrated."

## 14. Impact Summary

| ファイル | 変更種別 | 行数目安 |
|---|---|---:|
| `src/core/types.ts` | `FileWriter` に `rename` 追加 | +5 |
| `src/core/wisdom-store.ts` | `getAllEntries`/`getMaxEntries`/`fromEntries` 追加 | +25 |
| `src/core/wisdom-persistence.ts` | `saveAtomic()` 追加 | +30 |
| `src/core/tiered-wisdom-store.ts` | 新規 | ~120 |
| `src/core/secret-pattern-detector.ts` | 新規 | ~30 |
| `src/core/justice-plugin.ts` | 初期化拡張、新メソッド追加 | +30 |
| `src/runtime/node-file-system.ts` | `rename()` 実装 | +10 |
| `src/index.ts` | 新クラス export | +3 |
| `tests/secret-pattern-detector.test.ts` | 新規 | ~40 |
| `tests/tiered-wisdom-store.test.ts` | 新規 | ~150 |
| `tests/wisdom-persistence-atomic.test.ts` | 新規 | ~80 |
| `tests/justice-plugin-global-fs.test.ts` | 新規 | ~60 |
| `README.md` | セクション追加 | +20 |
| `SPEC.md` | セクション追加 | +10 |
| `CHANGELOG.md` | エントリ追加 | +5 |

合計 ~620 行（うち実装 ~250、テスト ~330、ドキュメント ~35）。

## 15. Rollout

1. 上記変更を 1 PR にまとめる（単一機能の追加）
2. CI の test/typecheck/lint をパスさせる
3. minor リリース (`1.x.0`) として release-please 経由で配信
4. `oh-my-opencode.jsonc` 側の利用者には特別な対応不要（初回起動時に `~/.justice/` が自動作成される）

## 16. Open Questions / Future Work

- (Future) **`SECRET_PATTERNS` の偽陽性チューニング**: 実装フェーズ後の運用ログを基に、誤検知率の高いパターンを refine する。具体的検討項目:
  - **`home_path_linux` / `home_path_macos`**: wisdom content に「`/home/runner/work/` で権限エラー」のような正当な記述が含まれるとマッチして noise になる。本物のホームパス漏洩（例: `/home/yohi/.aws/credentials`）は他の `api_key` 系パターンで捕捉できることが多いため、**パターン削除** または **`info` ログへ降格** を検討。
  - **`/\btoken\b/i`**: "JWT token の使い方" のような正当な技術文脈で誤検知。**より具体的なパターン**（例: `/\btoken\s*[:=]\s*["'`]?[\w-]{8,}/i` で値らしきもの込みでマッチ）への差し替えを検討。
  - **判断基準**: 実運用で「警告ノイズで本物の API キー警告が埋もれる」事象が発生したらチューニング。事前最適化はせず、`SECRET_PATTERNS` のメトリクス（warn 発火回数、ユーザーフィードバック）を 1〜2 リリース観察してから判断。
- (Future) **明示移行コマンド** `justice migrate-local-to-global`: 既存 local エントリを規則に従って昇格
- (Future) **グローバルストアの Git 同期サポート**: `~/.justice/` を git リポジトリ化し、複数マシン間で wisdom を sync
- (Future) **MCP リソース化**: グローバルストアを MCP server として公開し、他 MCP 対応ツールから wisdom を参照可能にする
- (Future) **エントリ暗号化**: グローバルストアに secret パターンを含むエントリが入った場合、AES でフィールド単位暗号化する仕組み
- (Future) **使用統計**: どのグローバル wisdom が頻繁に注入されているかをメトリクス化し、価値の低いエントリを自動削除
