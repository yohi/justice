# Justice Expansion 設計書 (v2026.04.26)

## 0. メタ情報

| 項目 | 値 |
|------|----|
| 作成日 | 2026-04-26 |
| 対象バージョン | Justice v2026.03.25 拡張 |
| 想定ロール | Justice Core Maintainer (Senior Engineer) |
| 対象ブランチ | `master` を起点とする feature/justice-expansion-* |
| 関連スキル | `superpowers/brainstorming`（本書作成）→ `superpowers/writing-plans`（次工程） |

## 1. 目的とスコープ

Justice システムにおける **グローバル知見（Wisdom）の信頼性向上** と、**エージェントの自己診断・自己適応能力の強化** を目的とした拡張設計を定義する。

本設計のスコープは下記 4 Phase に限定する。

| Phase | 主題 |
|-------|------|
| Phase 1 | `WisdomPersistence` の楽観ロック（データ内 `version` ベース）と Fail-Open 退避 |
| Phase 2 | Wisdom メトリクス（hitCount）と LRU eviction 連動アーカイブ |
| Phase 3 | `TelemetryStore` 新設と `justice status --analytics --json` |
| Phase 4 | `LoopDetectionHandler` における動的 maxRetries 算出 |

## 2. 設計原則と制約

`AGENTS.md` の制約を厳守する。

1. **NO Business Logic in Hooks**: 純粋ロジックは `src/core/` に配置し、Hook 層は委譲のみ。
2. **NO Unsafe File System Operations**: ロックは Optimistic（**データ内 `version` フィールドベース**）に限定し、Blocking lock を導入しない。書き込みは `temp + rename` の atomic write を堅持。`mtime` 等のファイルシステム属性は granularity がプラットフォーム依存（NFS / tmpfs / 一部の Linux FS は ms 未満を保持しない）であり、競合検出の根拠としては環境依存の脆弱性となるため使用しない。
3. **NO State Mutation**: 全 type は `readonly` 修飾子を維持し、in-place mutation を行わない。一方で `hitCount` / `lastHitAt` / `firstSeenAt` 等のメタデータは **Single Source of Truth (SSoT)** を保つため `WisdomEntry` 自身に内包する（別レコード／別ファイルへの分離は行わない — データの不整合源となるため）。更新は **copy-on-write**（既存エントリを差し替えず、新しい immutable な `WisdomEntry` インスタンスを生成して `WisdomStore` 内で置換）で行う。
4. **Fail-Open Policy**: 全ての新ハンドラは `try/catch` で例外を握り、メイン処理を継続する。`process.exit(0)` は呼ばない。
5. **Devcontainer Mandatory**: テスト・型検査・リンタの実行は `.devcontainer` 内で行う前提とし、絶対パスをコードに含めない。

## 3. アーキテクチャ概観

### 3.1 新規追加モジュール

```text
src/core/
├── atomic-persistence.ts       ← Phase 1: 楽観ロック（version ベース）+ atomic write + fail-open 退避の汎用プリミティブ（Phase 2 でも再利用）
├── wisdom-metrics.ts          ← Phase 2: hitCount/lastHitAt の更新サービス（WisdomStore に対する copy-on-write の純粋ロジック。永続化先は wisdom.json に統合され、独自ファイルを持たない）
├── wisdom-archive.ts          ← Phase 2: 重要度判定 + 永続化
├── telemetry-store.ts         ← Phase 3: failure_rate / wisdom_hit_rate / error_distribution
└── retry-policy-calculator.ts ← Phase 4: Base + Category + Volume の動的閾値算出
```

### 3.2 既存モジュールへの追加（破壊的変更なし）

| ファイル | 変更内容 |
|---------|---------|
| `src/core/types.ts` | `LockMetadata` / `VersionedEnvelope<T>` / `TelemetrySnapshot` / `RetryThresholdContext` 等を追加。`WisdomEntry` には `hitCount?` / `lastHitAt?` / `firstSeenAt?` を **optional** で追加（既存データ後方互換）。それ以外の既存 type は据え置き。 |
| `src/core/wisdom-persistence.ts` | `saveAtomicWithLock(store, lockMeta?)` を追加（内部で `AtomicPersistence<WisdomStore>` に委譲する thin wrapper）。既存 `saveAtomic` は `@deprecated` で残置。 |
| `src/core/wisdom-store.ts` | `attachMetrics(metrics)` / `onEvict(listener)` / `updateMetrics(entryId, mutator)` を追加。`updateMetrics` は copy-on-write で当該 id のエントリを新インスタンスに差し替える唯一の経路。`recordHit` は `getRelevant()` 内では呼ばず、呼び出し元（`PlanBridge.handlePreToolUse()` での wisdom 注入確定時）で明示的に呼ぶ（オーバーカウント防止、6.2 参照）。 |
| `src/core/tiered-wisdom-store.ts` | LRU eviction フックで `WisdomArchive` に重要度判定を委譲。 |
| `src/core/status-command.ts` | `getStatusWithAnalytics()` と `formatAsJson()` を追加。`TelemetryStore` を依存注入。 |
| `src/hooks/loop-handler.ts` | `CategoryClassifier` と `RetryPolicyCalculator` を注入し `evaluateEscalation()` で動的閾値を参照。 |
| `src/core/justice-plugin.ts` | 新モジュールを wiring。`TelemetryStore` を全ハンドラに注入。 |

### 3.3 データ永続化レイアウト

```text
~/.justice/                            # global tier
├── wisdom.json                        # 既存（メタデータ統合 — version/hitCount/lastHitAt/firstSeenAt を内包）
├── wisdom-archive.json                # 新規 (Phase 2 — global eviction 用)
├── wisdom-archive.conflict.json       # 新規 (Phase 2 fail-open — global tier の archive 退避ログ)
└── wisdom.conflict.json               # 新規 (Phase 1 fail-open。tier に依存しない退避ログ)

.justice/                              # project-local tier
├── wisdom.json                        # 既存（メタデータ統合 — version/hitCount/lastHitAt/firstSeenAt を内包）
├── wisdom-archive.json                # 新規 (Phase 2 — local eviction 用)
├── wisdom-archive.conflict.json       # 新規 (Phase 2 fail-open — local tier の archive 退避ログ)
└── telemetry.json                     # 新規 (Phase 3 — プラン単位の集計のため project-local のみ)
```

`HOME` は `NodeFileSystem` レイヤーで解決し、ハードコードしない。

**配置設計の方針**:

- `wisdom.json`: 既存ファイルにメタデータ（`hitCount` / `lastHitAt` / `firstSeenAt`）を **統合** する。`wisdom-metrics.json` を別ファイルとして分離する設計は採用しない — 知見本体とメタデータが別ファイルだと last-write-wins や部分的な永続化失敗で容易に不整合が発生する（例: hit が記録された直後に entry 本体が消える）ため、**Single Source of Truth** を最優先する。
- `wisdom-archive.json`: 既存 `wisdom.json` と同じく **両 tier に併設**。`TieredWisdomStore` が tier ごとに別インスタンスを wiring する。アーカイブは LRU eviction によって `wisdom.json` から取り除かれた entry を保持するため、`wisdom.json` とは異なるライフサイクルを持つ。両者を分離するのは SSoT 違反ではなく、関心の分離（active vs. archived）として自然である。
- `wisdom-archive.conflict.json`: 対応する本体ファイルと **同じ tier に併設**。global tier では複数プロジェクトをまたぐ並行書き込み、local tier では複数セッションの並行書き込みを想定する（詳細は 6.5）。
- `wisdom.conflict.json`: **global tier 1 箇所のみ**。複数プロジェクトをまたぐ catastrophic event をすべて単一ログに集約する目的。
- `telemetry.json`: **project-local のみ**。集計の対象が plan 単位（task の成功/失敗、wisdom 注入）であり、プロジェクトをまたぐ意味付けがないため。

## 4. 型定義の拡張（`src/core/types.ts`）

### 4.1 Phase 1: Optimistic Lock

```typescript
/**
 * 永続化ファイルの内容を包むエンベロープ。version はファイル書き込み毎に +1 され、
 * 楽観ロックの競合検出に用いる。新規ファイルは version=0、初回書き込みで version=1 になる。
 * legacy ファイル（envelope を持たないレガシー JSON）は読み込み時に version=0 として解釈される（5.2 末尾参照）。
 */
export interface VersionedEnvelope<T> {
  readonly version: number;
  readonly data: T;
}

/**
 * 楽観ロックのスナップショット。loadWithLock() がデータ内 version を取り込み、
 * saveAtomicWithLock() のリトライ判定で「読み出し時点の version と現在の version が一致するか」を確認する。
 * ファイルシステムの mtime には依存しない（NFS / tmpfs / プラットフォーム差で granularity が不安定なため）。
 */
export interface LockMetadata {
  readonly version: number;
  readonly path: string;
  readonly snapshotAt: number;
}

export interface ConflictRecord {
  readonly entries: readonly WisdomEntry[];
  readonly attemptedAt: string;
  readonly reason:
    | "version_mismatch"          // claim 取得後の recheck で stale 判定（5.2 Step 2.4）
    | "claim_acquisition_failed"  // commit slot の atomic claim が EEXIST 連続で取得できなかった（5.2 Step 2.3）
    | "rename_conflict";          // claim → wisdom.json の rename 自体が失敗（5.2 Step 2.5）
  readonly retryCount: number;
}
```

### 4.2 Phase 2: Wisdom Metrics & Archive

メトリクスは `WisdomEntry` 自身に **optional フィールド** として統合する。別レコード型 (`WisdomMetricsEntry`) は設けない（SSoT 維持のため、2.3 参照）。

```typescript
// 既存 WisdomEntry に以下の optional フィールドを追加。既存の必須フィールドは無変更。
// 値が無い場合（レガシーデータ）は読み込み側で hitCount=0 / lastHitAt=null / firstSeenAt=未設定 として解釈する。
export interface WisdomEntry {
  // 既存フィールド ...
  readonly hitCount?: number;
  readonly lastHitAt?: string | null;
  readonly firstSeenAt?: string;
}

export interface ArchiveThresholds {
  readonly environmentQuirkMinHits: number;   // default: 3
}

export interface ArchivedWisdom {
  readonly entry: WisdomEntry;     // entry 自身が hitCount/lastHitAt/firstSeenAt を内包する
  readonly archivedAt: string;
  readonly archiveReason: "high_priority_category" | "hit_count_threshold";
}
```

### 4.3 Phase 3: Telemetry

```typescript
export interface TelemetrySnapshot {
  readonly windowSize: number;
  readonly failureRate: number;
  readonly wisdomHitRate: number;
  readonly errorDistribution: Readonly<Record<ErrorClass, number>>;
  readonly generatedAt: string;
}

export type TelemetryEvent =
  | { readonly type: "task_completed"; readonly taskId: string; readonly status: TaskFeedbackStatus; readonly errorClass?: ErrorClass; readonly timestamp: string; }
  | { readonly type: "wisdom_injected"; readonly entryIds: readonly string[]; readonly taskId: string; readonly timestamp: string; }
  | { readonly type: "wisdom_hit"; readonly entryId: string; readonly taskId?: string; readonly timestamp: string; };
```

### 4.4 Phase 4: Adaptive Retry

```typescript
export interface RetryThresholdContext {
  readonly category: TaskCategory;
  readonly stepCount: number;
}

export interface RetryThresholdResult {
  readonly base: number;
  readonly categoryModifier: number;
  readonly volumeModifier: number;
  readonly maxRetries: number;
}
```

### 4.5 `FileReader` インターフェース

楽観ロックを **データ内 `version` フィールド** に統一したため、`FileReader` への新メソッド追加は不要（`stat()` 等のファイルシステム属性へのアクセスは導入しない）。version は `readFile()` で取得した JSON envelope から直接取り出すため、既存の `readFile` / `fileExists` のみで完結する。これにより mtime granularity（NFS / tmpfs / プラットフォーム差）への依存を完全に排除する。

## 5. Phase 1: Optimistic Locking 詳細

### 5.1 API

```typescript
class WisdomPersistence {
  async loadWithLock(): Promise<{ store: WisdomStore; lockMeta: LockMetadata }>;

  async saveAtomicWithLock(
    store: WisdomStore,
    initialLockMeta?: LockMetadata,
  ): Promise<SaveResult>;
}

interface SaveResult {
  readonly status: "saved" | "conflict_diverted";
  readonly retries: number;
  readonly conflictPath?: string;
}
```

### 5.2 処理フロー（アトミック claim プロトコル）

**TOCTOU race を回避する設計の中核**: 「ディスクから version を再 stat → rename」のような **check-then-act** パターンは、check と act の間に別プロセスが rename を割り込ませると stale な後発 writer が先発 writer を上書きしてデータロストを起こす（POSIX `rename(2)` 自身は atomic だが、複数プロセスの rename を直列化する保証はないため）。本設計では POSIX `link(2)` の **アトミック排他作成セマンティクス**（既存ファイル名への新規 hardlink 作成は atomically `EEXIST` で失敗する。これはユーザ空間から介入不能な OS カーネル保証）を利用し、「commit slot の獲得 → version の再確認 → publish」までの区間全体をカーネル空間で逐次化する。Blocking lock（kernel mutex / advisory file lock）は導入せず、`link()` の即時成功/失敗のみを用いる純粋な non-blocking 楽観方式である。

**主要パス**:

```text
<path>                          # 例: ~/.justice/wisdom.json — 公開ファイル
<path>.tmp.<uuid>               # writer ローカルの一時ファイル（uuid v4、プロセス間衝突なし）
<path>.commit-pending           # 固定の単一スロット名 — atomic claim slot（cross-writer の直列化点）
<path>.conflict.json            # fail-open 退避先（5.4）
```

**フロー**:

1. `lockMeta` を `initialLockMeta ?? (loadWithLock() で取得した version)` で確定。`initialLockMeta` 未指定時は `loadWithLock()` を内部で呼んで envelope から `version` を読み出す。`lockMeta.version = V` と表記する。
2. `for retry in 0..3`:
    1. **Payload 構築**: メモリ上の更新を反映した envelope `{ version: V + 1, data: store }` をシリアライズ。
    2. **Tmp 書き込み**: `<path>.tmp.<uuid>` に envelope を書き込み（書き込み完了まで他プロセスから不可視）。
    3. **Atomic claim**: `fs.link(tmpPath, claimPath)` を実行（`claimPath = <path>.commit-pending`）。
        - `link()` は POSIX で「ファイル名空間における存在判定と新 inode エントリ作成」を **不可分に**実行する。同名ファイルが既存なら atomically `EEXIST` で失敗する。これは OS カーネル空間の単一原子操作であり、ユーザ空間のいかなるコードもこの判定と作成の間に割り込めない（TOCTOU 不在の根拠）。
        - **EEXIST**: 別プロセスが commit 進行中。`tmpPath` を unlink し、stale-claim 検査（後述）を経て指数バックオフで sleep、retry へ戻る。
        - **その他 I/O エラー**: fail-open（`console.warn`）して retry。
        - **成功**: 排他的に commit slot を保持。Step 2.4 へ。
    4. **Stale-version 検知（claim 取得後の recheck）**: `<path>` を再読込して `currentVersion` を取得。
        - `currentVersion !== V`: claim を取りに行く間に別 writer が既に publish 完了していた。自分の payload は stale。
            - `unlink(claimPath)` で claim 解放。
            - `unlink(tmpPath)` で tmp 破棄。
            - 読み出した最新データを `mergeById`（メタデータ統合対応版、6.5）でメモリ store に merge。
            - `lockMeta.version = currentVersion` に更新。
            - 指数バックオフで sleep し continue。
        - `currentVersion === V`: 自分が次の有効な publisher。Step 2.5 へ。
    5. **Atomic publish**: `fs.rename(claimPath, <path>)` を実行。POSIX `rename(2)` の atomic guarantee により、`<path>` は atomically v(V+1) の内容に置換される（同一 FS・同一ディレクトリ前提。tmp / claim / 公開ファイルはすべて同一ディレクトリに配置するため satisfies）。rename によって `claimPath` は消滅し、次の writer が claim 可能になる。
    6. **クリーンアップ**: `unlink(tmpPath)`。`{ status: "saved", retries }` を返す。
3. リトライ上限到達時:
    - 退避理由を判定（recheck 連続失敗なら `"version_mismatch"`、claim 取得が一度も成功せず終わったなら `"claim_acquisition_failed"`、rename 自身が EXDEV 等で失敗したなら `"rename_conflict"`）。
    - `divertToConflictFile(store.getAllEntries(), reason)` で `<path>.conflict.json` に退避。
    - 残存する `tmpPath` / `claimPath`（自分の所有分）を `unlink`。
    - `console.warn` で警告。
    - `{ status: "conflict_diverted", retries: 3, conflictPath }` を返す。

**TOCTOU 解消の根拠（旧設計との差分）**:

- 旧設計は「rename 直前に再 stat」した後に rename を呼ぶ check-then-act だった。stat と rename の間に別プロセスの rename が割り込み、両者が同じ `currentVersion + 1` を最終バージョンとして書き込み、後者が前者を上書きする TOCTOU window が存在した。
- 新設計では Step 2.3 の `link()` が commit slot を排他保持する。`claimPath` を保持している間、他のプロセスは Step 2.3 で `EEXIST` を受けて先へ進めず、Step 2.5 の rename ウィンドウに割り込めない。Step 2.4 の version recheck と Step 2.5 の rename は claim 保持中にのみ実行されるため、両者の間にも他プロセスの publish は介入できない。
- Step 2.4 (recheck) は、claim 取得待ちの間に別 writer が既に publish を完了していたケース（stale read）を捕捉するための補完防御。Step 2.3 (link) と Step 2.4 (recheck) の組み合わせで「同時 publish の serialize」と「stale payload の rejection」が両立する。

**Stale-claim 回復**: プロセスが Step 2.3 と Step 2.5 の間でクラッシュした場合、`claimPath` が残存し後続 writer が永続的に `EEXIST` でブロックされる。回復策:

- Step 2.3 で `EEXIST` を受けた writer は、`fs.stat(claimPath).mtimeMs` を確認。
- `Date.now() - mtimeMs > STALE_CLAIM_TIMEOUT_MS`（既定 10 秒）であれば claim をオーナレスとみなし、`unlink(claimPath)` で reclaim してから retry。
- ここでの `mtime` 利用は **死活監視のヒューリスティクスのみ**で、楽観ロックの正当性根拠ではない（version は依然として envelope 内のフィールドが SoT）。誤判定（生きているプロセスの claim を unlink）した場合でも、(a) 当該プロセスの Step 2.5 の rename は ENOENT で失敗、(b) 当該プロセスは retry サイクルへ戻り Step 2.3 から再 claim、により最終的に整合する。**データロストや version 単調性の破綻は発生しない**（safety property は維持）。
- **実装注記**: `fs.stat` は `node:fs/promises` から直接呼び出す（`FileReader` インターフェースは `readFile` / `fileExists` のみで完結し、`stat()` は追加しない — 4.5 参照）。テスト時は claim ファイルの作成タイミングを制御することで `mtime` を代替する。
- 残存 tmp file (`<path>.tmp.*`) は AtomicPersistence の起動時 GC（10 分超のものを `unlink`）でクリーンアップ。

**移植性**:

| プラットフォーム | `link()` の atomic 排他保証 | 根拠 |
|------------------|----------------------------|------|
| Linux (ext4 / XFS / btrfs / tmpfs) | あり | POSIX.1-2017 §link, Linux man-pages link(2) |
| macOS (APFS / HFS+) | あり | Darwin link(2) |
| BSD (UFS / ZFS) | あり | POSIX.1-2017 |
| Windows (NTFS) | あり | `CreateHardLinkW` が同等の排他作成を提供（Node.js `fs.link` がこれにマップ） |
| NFSv3+ | あり | RFC 1813 §3.3.5（server-side で atomic） |

`renameat2(RENAME_NOREPLACE)` のような Linux 固有機能には依存しないため、本設計は cross-platform で動作する。

**レガシーフォーマット後方互換**: 既存の `wisdom.json` は envelope を持たず、直接 `WisdomStore` JSON が書かれている。`loadWithLock()` は最初に `JSON.parse` を行い、結果が `{ version: number, data: ... }` の形であれば envelope として解釈し、そうでなければ envelope 不在とみなして `{ version: 0, data: parsed }` に変換する。これにより `tests/core/wisdom-persistence.test.ts` が `saveAtomic`（@deprecated、envelope を書かない）で生成したファイルも問題なく読み込める。最初の `saveAtomicWithLock` 呼び出しで envelope 形式に昇格する。

### 5.3 指数バックオフ

| retry | base delay | jitter | min – max |
|-------|-----------|--------|-----------|
| 0     | 100ms     | 0–50ms | 100–150ms |
| 1     | 200ms     | 0–50ms | 200–250ms |
| 2     | 400ms     | 0–50ms | 400–450ms |

`Math.random()` で jitter を生成。テスト容易性のため `Math.random` をモック差し替え可能にする。

### 5.4 退避ファイル `wisdom.conflict.json`

```typescript
interface ConflictFileSchema {
  readonly version: 1;
  readonly conflicts: readonly ConflictRecord[];
}
```

- 既存ファイルを読み込み、`conflicts` に append、atomic rename。
- `divertToConflictFile()` 自体が例外を投げた場合も `try/catch` で握りつぶし `console.warn` のみ。
- メイン処理は継続する。
- `reason` は呼び出し元（5.2 Step 3）で `"version_mismatch"` / `"claim_acquisition_failed"` / `"rename_conflict"` のいずれかを判定して渡す。デバッグ時に「3 回ループした原因がどの段階の競合だったか」を切り分けるために用いる。

### 5.5 既存 `saveAtomic` の扱い

```typescript
/**
 * @deprecated Use saveAtomicWithLock() for new call sites.
 */
async saveAtomic(store: WisdomStore): Promise<void> { /* 既存 */ }
```

`JusticePlugin` 経由の呼び出し点のみ `saveAtomicWithLock` に切り替える。既存テストは無変更で通る。

### 5.6 汎用プリミティブ `AtomicPersistence<T>`（Phase 2 永続化への適用前提）

5.1–5.4 の競合回避機構（**データ内 `version` フィールドによる楽観ロック** / **`fs.link()` のアトミック排他作成による commit slot の獲得** / 指数バックオフ付きリトライ / atomic rename / stale-claim 回復 / fail-open 退避）は `WisdomPersistence` 専用に閉じ込めず、`src/core/atomic-persistence.ts` の汎用クラスとして実装する。Phase 2 の `WisdomArchive` の永続化もこの同一機構を再利用し、各クラスで再実装しない（DRY 原則）。

**動機**: Global tier (`~/.justice/`) は複数プロジェクト・複数 Claude Code セッションから同時に書き込まれる前提のため、書き込み頻度の低さに関わらず last-write-wins による上書き（データロスト）の現実リスクが存在する。Phase 2 永続化を Phase 1 とは別経路にすると、責務の分散と機構の重複（DRY 違反）を生むため、最初から共通プリミティブに統合する。さらに、競合検出を `mtime` ではなく **データに埋め込まれた version** とすることで、ファイルシステム属性のプラットフォーム依存性（mtime granularity・NFS clock skew・touch コマンド等の意図しない更新）を排除し、環境非依存の決定論的並行性制御を実現する。

```typescript
export interface AtomicPersistenceConfig<T> {
  readonly filePath: string;
  readonly serialize: (data: T) => string;       // T を JSON 文字列化（envelope への wrap は AtomicPersistence 側で行う）
  readonly deserialize: (raw: string) => T;      // JSON 文字列から T を復元（envelope の unwrap も AtomicPersistence 側）
  readonly merge: (mine: T, theirs: T) => T;     // 競合時の合流ロジック（型 T ごとに差し替え）
  readonly conflictPath: string;                 // リトライ上限到達時の退避先
  readonly emptyValue: () => T;                  // ファイル未生成時の初期値
}

export class AtomicPersistence<T> {
  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly config: AtomicPersistenceConfig<T>,
  ) {}

  // 内部では VersionedEnvelope<T> 形式で読み書きする。レガシー JSON（envelope 不在）は version=0 とみなす（5.2）。
  // 書き込み時は currentVersion + 1 を新 version として埋め込む。
  async loadWithLock(): Promise<{ data: T; lockMeta: LockMetadata }>;
  async saveAtomicWithLock(
    data: T,
    initialLockMeta?: LockMetadata,
  ): Promise<SaveResult>;
}
```

`WisdomPersistence.saveAtomicWithLock(store, lockMeta?)` は内部で `AtomicPersistence<WisdomStore>` に委譲する thin wrapper となる。`merge` には既存の `mergeById` を**メタデータ統合対応に拡張したもの**を渡し（同一 id では `hitCount` を加算、`lastHitAt` を新しい方、`firstSeenAt` を古い方、それ以外は既存セマンティクス。詳細は 6.5）、`conflictPath` は `wisdom.conflict.json` を指定する。リトライ・指数バックオフ（5.3）・**`fs.link()` ベースの atomic claim slot 獲得（5.2 Step 2.3）**・claim 取得後の version recheck（5.2 Step 2.4）・atomic rename（5.2 Step 2.5）・version envelope の wrap/unwrap・stale-claim 回復・fail-open による退避ファイル append（5.4）は、すべて `AtomicPersistence` 内に一本化する。呼び出し側は TOCTOU 不在の atomic 永続化を単一 API として享受する。

Phase 2 では `wisdom-archive.json` 用に `AtomicPersistence` を別インスタンス化し、`merge` 関数だけを差し替えて再利用する（具体的な合流ロジックは 6.5）。`wisdom-metrics.json` 用の独自インスタンスは設けない（メタデータは `wisdom.json` に統合済みのため）。

## 6. Phase 2: Wisdom Metrics & Archive 詳細

### 6.1 `WisdomMetrics` クラス

メトリクスは `WisdomEntry` 自身に内包される（4.2 参照）ため、`WisdomMetrics` は **独立したストレージを持たないステートレスな更新サービス** として定義する。役割は (a) 受け取った `WisdomStore` 上の対象エントリに copy-on-write でメトリクスフィールドを更新する、(b) hit リスナーを通知する、の 2 点のみ。永続化・シリアライズメソッドは持たない（永続化は `WisdomStore` → `wisdom.json` 経由で一本化）。

```typescript
export class WisdomMetrics {
  // NOTE: 現在は単一スロット（コンシューマーは TelemetryStore 1 件のみ）。
  // 複数コンシューマーが必要になった場合は hitListeners: Array<...> + push に変更する。
  private hitListener?: (entryId: string) => void;

  /**
   * 対象 store 上の `entryId` のエントリを copy-on-write で差し替え、メトリクスを更新する。
   * エントリが存在しなければ undefined を返し、副作用は発生しない。
   */
  recordHit(store: WisdomStore, entryId: string, now: Date = new Date()): WisdomEntry | undefined {
    const updated = store.updateMetrics(entryId, (entry) => ({
      ...entry,
      hitCount: (entry.hitCount ?? 0) + 1,
      lastHitAt: now.toISOString(),
      firstSeenAt: entry.firstSeenAt ?? now.toISOString(),
    }));
    if (updated) this.hitListener?.(entryId);
    return updated;
  }

  onHit(listener: (entryId: string) => void): void { this.hitListener = listener; }
}
```

メトリクス値の **読み出し**（hitCount 等の参照）は `WisdomStore.findById(entryId)?.hitCount` のように **エントリから直接取得** する。専用の `get` / `getAll` / `forget` / `serialize` / `deserialize` は SSoT 違反（重複した内部状態）を招くため設けない。`forget` の代替として、エントリが LRU eviction で `WisdomStore` から取り除かれれば、メタデータも一緒に消える（同一エントリに内包されているため）。これにより eviction とメタデータライフサイクルが自動的に同期する。

### 6.2 `WisdomStore` の更新フック

```typescript
class WisdomStore implements WisdomStoreInterface {
  private metrics?: WisdomMetrics;
  private evictionListener?: (evicted: WisdomEntry) => void;

  attachMetrics(metrics: WisdomMetrics): void { this.metrics = metrics; }
  onEvict(listener: (evicted: WisdomEntry) => void): void { this.evictionListener = listener; }

  /**
   * copy-on-write でメトリクスフィールドを更新する唯一の経路。
   * mutator は元エントリを受け取り、更新済みの新インスタンスを返す純粋関数。
   * 配列スロットの差し替えは行うが、WisdomEntry 自体は readonly のまま新インスタンスに置換される。
   */
  updateMetrics(entryId: string, mutator: (entry: WisdomEntry) => WisdomEntry): WisdomEntry | undefined {
    const idx = this.entries.findIndex((e) => e.id === entryId);
    if (idx < 0) return undefined;
    this.entries[idx] = mutator(this.entries[idx]);
    return this.entries[idx];
  }

  getRelevant(options?): WisdomEntry[] {
    const results = /* 既存ロジック */;
    // NOTE: recordHit() は getRelevant() 内では呼ばない。
    // デバッグや status --analytics 表示で呼んだ場合の hitCount 過剰計上を防ぐため、
    // wisdom 注入が確定した呼び出し元（PlanBridge.handlePreToolUse()）で明示的に呼ぶ。
    return results;
  }

  add(entry, options?): WisdomEntry {
    const newEntry = /* 既存ロジック */;
    this.entries.push(newEntry);
    if (this.entries.length > this._maxEntries) {
      const evicted = this.entries.shift()!;
      this.evictionListener?.(evicted);
    }
    return newEntry;
  }
}
```

`WisdomEntry` 自体は **readonly のまま**（in-place mutation は行わない）。`updateMetrics` は新しい immutable な `WisdomEntry` インスタンスを生成し、配列スロットを差し替えることで copy-on-write を実現する。これによりメタデータ更新後の `WisdomStore` をシリアライズすれば、最新の `hitCount` / `lastHitAt` / `firstSeenAt` がそのまま `wisdom.json` に永続化される（SSoT）。

### 6.3 `WisdomArchive` クラス

```typescript
export class WisdomArchive {
  constructor(
    private readonly persistence: AtomicPersistence<readonly ArchivedWisdom[]>,
    private readonly thresholds: ArchiveThresholds = { environmentQuirkMinHits: 3 },
  ) {}

  /**
   * メタデータ（hitCount 等）はエントリ自身に内包されているため、追加引数は不要。
   * 4.2 の WisdomEntry.hitCount を直接参照する。
   */
  shouldArchive(entry: WisdomEntry): {
    archive: boolean;
    reason?: ArchivedWisdom["archiveReason"];
  } {
    if (entry.category === "failure_gotcha" || entry.category === "design_decision") {
      return { archive: true, reason: "high_priority_category" };
    }
    if (entry.category === "environment_quirk") {
      const hits = entry.hitCount ?? 0;
      if (hits >= this.thresholds.environmentQuirkMinHits) {
        return { archive: true, reason: "hit_count_threshold" };
      }
    }
    return { archive: false };
  }

  // 5.6 の AtomicPersistence<readonly ArchivedWisdom[]> に永続化を委譲する。
  // 1. loadWithLock() で現存配列と lockMeta（version）を取得
  // 2. 新エントリを push したコピーを作成
  // 3. saveAtomicWithLock(next, lockMeta) — version 競合時は merge で append 結合し再試行（最大 3 回）
  // 4. リトライ上限到達時は wisdom-archive.conflict.json に fail-open 退避
  async append(entry: WisdomEntry, reason: ArchivedWisdom["archiveReason"]): Promise<SaveResult> { /* ... */ }
  async loadAll(): Promise<readonly ArchivedWisdom[]> { /* persistence.loadWithLock().data */ }
}
```

`AtomicPersistence` のインスタンス化（filePath / merge / conflictPath / emptyValue の指定）は `JusticePlugin` の wiring レイヤーで行う。`WisdomArchive` 自身はファイルパスを知らない。

### 6.4 `TieredWisdomStore` の eviction 連携

```typescript
class TieredWisdomStore {
  constructor(
    private readonly local: WisdomStore,
    private readonly global: WisdomStore,
    private readonly metrics: WisdomMetrics,
    private readonly archive: WisdomArchive,
  ) {
    local.attachMetrics(metrics);
    global.attachMetrics(metrics);
    local.onEvict((evicted) => this.handleEviction(evicted));
    global.onEvict((evicted) => this.handleEviction(evicted));
  }

  private async handleEviction(evicted: WisdomEntry): Promise<void> {
    // メタデータは evicted: WisdomEntry 自身に内包されているため、別ストレージ参照は不要（SSoT）。
    const decision = this.archive.shouldArchive(evicted);
    if (decision.archive && decision.reason) {
      try {
        await this.archive.append(evicted, decision.reason);
      } catch (err) {
        console.warn(`[JUSTICE] WisdomArchive.append failed: ${String(err)}`);
      }
    }
    // metrics.forget の呼び出しは不要 — エントリが WisdomStore から消えればメタデータも一緒に消える。
  }
}
```

eviction は同期的だが、archive への書き込みは非同期 fire-and-forget。失敗は fail-open で warn のみ。

### 6.5 アーカイブの永続化と `wisdom.json` のメタデータ統合（`AtomicPersistence<T>` への統合）

メタデータ（`hitCount` / `lastHitAt` / `firstSeenAt`）は `WisdomEntry` 自身に内包され、`wisdom.json` に統合的に永続化される（**Single Source of Truth**）。`wisdom-metrics.json` という別ファイルは設けない（4.2 / 3.3 参照）。

`wisdom.json` / `wisdom-archive.json` の永続化は **5.6 で定義した `AtomicPersistence<T>`** に統合する。Phase 1 と Phase 2 で別の永続化経路を持つことは DRY 違反であり、また global tier (`~/.justice/`) は複数プロジェクト・複数 Claude Code セッションから同時に書かれる前提のため、書き込み頻度の低さに関わらず last-write-wins による上書き（データロスト）を防ぐ必要がある。したがって version ベースの楽観ロック・リトライ・退避はすべての永続化に一律適用する。

| ファイル | `AtomicPersistence<T>` の T | `merge` 実装（競合時の合流ロジック） | 退避先 |
|---------|----------------------------|-------------------------------------|-------|
| `wisdom.json` | `WisdomStore` | 既存 `mergeById` を **メタデータ統合対応に拡張**: 同一 id のエントリ間で `hitCount` は **加算**（双方の hit を保存しロストさせない）、`lastHitAt` は新しい方、`firstSeenAt` は古い方を採用。それ以外のフィールド（content / category 等）は既存 `mergeById` のセマンティクスを維持。 | `wisdom.conflict.json`（global 1 箇所、5.4） |
| `wisdom-archive.json` | `readonly ArchivedWisdom[]` | `(entry.id, archivedAt)` を複合キーとして重複排除した上で **append 結合**（順序は `archivedAt` 昇順） | `wisdom-archive.conflict.json`（tier ごと） |

すべて以下の同一手続きで動作する（5.2 と同じフロー）。

1. `loadWithLock()` で現状値と `lockMeta`（envelope 内の `version`）を取得。
2. メモリ上で更新を適用（wisdom.json: 新エントリ追加 / メタデータ更新 / eviction、archive: 新エントリの append）。
3. `saveAtomicWithLock(updated, lockMeta)` を呼ぶ — version 競合時は表記載の `merge` で合流し、指数バックオフで再試行（最大 3 回）。書き込み成功時は envelope の `version` が +1 される。
4. リトライ上限到達時は対応する `*.conflict.json` に fail-open で退避し、メイン処理は継続する。

**配線**: `WisdomPersistence` / `WisdomArchive` は `AtomicPersistence<T>` のインスタンスを依存注入で受け取り、ファイルパスや tier の知識は持たない。`TieredWisdomStore` / `JusticePlugin` が tier ごとに `AtomicPersistence` を必要数（local / global × { wisdom, archive }）作成して注入する。`WisdomMetrics` は永続化を持たず、`WisdomStore.updateMetrics` を呼ぶだけなので `AtomicPersistence` を直接保持しない。

**書き込みタイミング**: `wisdom.json` の永続化は `recordHit` ごとではなく、`JusticePlugin` のセッション終了 hook（または一定期間ごとのフラッシュ）で `saveAtomicWithLock` を呼ぶ。これにより I/O 頻度を抑え、楽観ロックの再試行コストも実用範囲に収める。メタデータも同じタイミングで一緒に永続化されるため、entry 本体とメタデータが**部分的に永続化されて不整合になる窓**が原理的に存在しない（SSoT の効用）。`wisdom-archive.json` は eviction 発生時にイベント駆動で `append()` を呼ぶ（6.4 の fire-and-forget）。

**Fail-open の保証**: `AtomicPersistence` 内部で発生する例外（ENOSPC、`*.conflict.json` 自身の書き込み失敗、JSON パース失敗、envelope 形式の検証失敗など）はすべて `try/catch` で握り、`console.warn` のみでメイン処理を継続する。これは Phase 1 と同一ポリシー（5.4）。

## 7. Phase 3: Telemetry 詳細

### 7.1 `TelemetryStore` クラス

```typescript
export class TelemetryStore {
  private events: TelemetryEvent[] = [];
  private readonly maxEvents: number;

  constructor(
    private readonly fileReader: FileReader,
    private readonly fileWriter: FileWriter,
    private readonly telemetryPath: string = ".justice/telemetry.json",
    options: { maxEvents?: number } = {},
  ) {
    this.maxEvents = options.maxEvents ?? 500;
  }

  recordTaskCompleted(taskId: string, status: TaskFeedbackStatus, errorClass?: ErrorClass): void;
  recordWisdomInjection(entryIds: readonly string[], taskId: string): void;
  recordWisdomHit(entryId: string, taskId?: string): void;
  computeSnapshot(windowSize?: number): TelemetrySnapshot;
  async load(): Promise<void>;
  async save(): Promise<void>;
  private trimEvents(): void;
}
```

`save()` は `temp + rename` の atomic write パターンを使用する（設計原則 2 に準拠）。ただし telemetry はイベントログの統計集計であり、個々のイベントの一意性が厳密に求められるデータではないため、`AtomicPersistence<T>` の完全な楽観ロック（version / claim / merge）は適用しない（best-effort の永続化）。

### 7.2 集計ロジックの定義

| メトリクス | 計算式 |
|----------|--------|
| `failureRate` | 直近 N 件の `task_completed` のうち `status !== "success"` の割合 |
| `wisdomHitRate` | 直近 N 件の `wisdom_injected` イベント（`taskId` ごと）のうち、当該 `taskId` に対する `task_completed` までに `wisdom_hit` が記録された割合 |
| `errorDistribution` | 直近 N 件の `task_completed` の `errorClass` を集計し、`ErrorClass` 全 9 種で正規化 |

`wisdomHitRate` の判定窓は **同一 `taskId` 内で完結** させ、タスクをまたぐ判定は行わない（オーバーカウント防止）。

### 7.3 `StatusCommand` 拡張

```typescript
class StatusCommand {
  constructor(
    fileReader: FileReader,
    private readonly telemetry?: TelemetryStore,
  ) { /* ... */ }

  async getStatusWithAnalytics(planPath: string): Promise<PlanStatusWithAnalytics> {
    const status = await this.getStatus(planPath);
    const analytics = this.telemetry?.computeSnapshot(100);
    return { ...status, analytics };
  }

  formatAsJson(status: PlanStatusWithAnalytics): string {
    return JSON.stringify({
      planPath: status.planPath,
      progress: status.progress,
      tasks: status.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      analytics: status.analytics ?? null,
    }, null, 2);
  }
}
```

CLI レイヤーで `--analytics` と `--json` フラグを解釈し、`getStatusWithAnalytics()` と `formatAsJson()` の組み合わせで出力する。

### 7.4 配線（`JusticePlugin`）

| 呼び出し点 | 記録イベント |
|----------|------------|
| `TaskFeedbackHandler.handlePostToolUse()` | `recordTaskCompleted(taskId, status, errorClass)` |
| `PlanBridge.handlePreToolUse()` (wisdom 注入確定時) | `recordWisdomInjection(entryIds, taskId)` + 注入対象エントリの `metrics.recordHit()` |
| `WisdomMetrics.onHit` 経由 | `recordWisdomHit(entryId)` |

`WisdomMetrics` から `TelemetryStore` への通知は **observer pattern** で疎結合に保つ。

```typescript
metrics.onHit((id) => telemetry.recordWisdomHit(id));
```

### 7.5 出力サンプル

```json
{
  "planPath": ".justice/plan.md",
  "progress": { "total": 10, "completed": 7, "percentage": 70 },
  "tasks": [{ "id": "task-1", "title": "...", "status": "completed" }],
  "analytics": {
    "windowSize": 100,
    "failureRate": 0.18,
    "wisdomHitRate": 0.62,
    "errorDistribution": {
      "syntax_error": 0.05, "type_error": 0.10, "test_failure": 0.40,
      "design_error": 0.15, "timeout": 0.05, "loop_detected": 0.10,
      "provider_transient": 0.05, "provider_config": 0.0, "unknown": 0.10
    },
    "generatedAt": "2026-04-26T..."
  }
}
```

## 8. Phase 4: Adaptive Retry 詳細

### 8.1 `RetryPolicyCalculator` クラス

```typescript
export class RetryPolicyCalculator {
  private static readonly BASE = 3;
  private static readonly MIN_RETRIES = 1;

  private static readonly CATEGORY_MODIFIERS: Readonly<Record<TaskCategory, number>> = Object.freeze({
    "quick": -1,
    "ultrabrain": +2,
    "deep": 0,
    "visual-engineering": 0,
    "writing": 0,
    "unspecified-low": 0,
    "unspecified-high": 0,
  });

  private static readonly VOLUME_THRESHOLD = 5;
  private static readonly VOLUME_MODIFIER = +1;

  compute(ctx: RetryThresholdContext): RetryThresholdResult {
    const base = RetryPolicyCalculator.BASE;
    const categoryModifier = RetryPolicyCalculator.CATEGORY_MODIFIERS[ctx.category] ?? 0;
    const volumeModifier =
      ctx.stepCount >= RetryPolicyCalculator.VOLUME_THRESHOLD
        ? RetryPolicyCalculator.VOLUME_MODIFIER
        : 0;

    const computed = base + categoryModifier + volumeModifier;
    const maxRetries = Math.max(RetryPolicyCalculator.MIN_RETRIES, computed);
    return { base, categoryModifier, volumeModifier, maxRetries };
  }
}
```

`maxRetries` の最小値は 1 にクランプ。0 にすると escalation 判定が即時発火し、リトライ機構が機能しなくなるため。

### 8.2 計算例

| Category   | stepCount | Base | Cat | Vol | maxRetries |
|------------|-----------|------|-----|-----|------------|
| quick      | 2         | 3    | -1  | 0   | 2          |
| quick      | 5         | 3    | -1  | +1  | 3          |
| deep       | 3         | 3    | 0   | 0   | 3          |
| ultrabrain | 7         | 3    | +2  | +1  | 6          |
| ultrabrain | 1         | 3    | +2  | 0   | 5          |

### 8.3 `LoopDetectionHandler` への統合

```typescript
export class LoopDetectionHandler {
  constructor(
    fileReader: FileReader,
    fileWriter: FileWriter,
    splitter: TaskSplitter,
    private readonly classifier: CategoryClassifier,
    private readonly retryCalculator: RetryPolicyCalculator,
  ) { /* ... */ }

  evaluateEscalation(
    sessionId: string,
    taskId: string,
    primaryAgent: AgentId,
    activeTask?: PlanTask,
  ): EscalationDecision {
    const records = this.trials.get(sessionId)?.get(taskId) ?? [];
    const failures = records.filter((r) => r.result === "failure").length;

    let dynamicMaxRetries = this.maxRetries;
    let thresholdResult: RetryThresholdResult | undefined;
    if (activeTask) {
      const category = this.classifier.classify(activeTask) as TaskCategory;
      thresholdResult = this.retryCalculator.compute({
        category,
        stepCount: activeTask.steps.length,
      });
      dynamicMaxRetries = thresholdResult.maxRetries;
    }

    const historySummary = this.formatTrialHistory(records);

    if (failures >= dynamicMaxRetries) {
      return { escalated: true, targetAgent: ESCALATION_TARGET, failures, maxRetries: dynamicMaxRetries, reason: "max_retries_exceeded", historySummary, thresholdResult };
    }
    return { escalated: false, targetAgent: primaryAgent, failures, maxRetries: dynamicMaxRetries, historySummary, thresholdResult };
  }
}
```

### 8.4 `EscalationDecision` 型の補足

```typescript
export interface EscalationDecision {
  readonly escalated: boolean;
  readonly targetAgent: AgentId;
  readonly failures: number;
  readonly maxRetries: number;
  readonly reason?: EscalationReason;
  readonly historySummary: string;
  readonly thresholdResult?: RetryThresholdResult;   // 追加
}
```

`thresholdResult` を `historySummary` の冒頭に inject すれば、動的閾値の根拠がデバッグ時に一目で読める。

### 8.5 環境変数フォールバック

既存の `MAX_RETRIES_BEFORE_ESCALATION` 環境変数は **`activeTask === undefined` の場合のフォールバック値** として残す。これにより既存の `loop-handler.test.ts` の挙動は無変更で通る。

## 9. テスト戦略

### 9.1 新規テストファイル

```text
tests/core/
├── atomic-persistence.test.ts                  ← 新規（5.6 汎用プリミティブの単体テスト、version ベースの競合検出含む）
├── wisdom-metrics.test.ts                      ← 新規（recordHit が WisdomStore.updateMetrics 経由で copy-on-write 更新することを検証）
├── wisdom-archive.test.ts                      ← 新規
├── wisdom-archive-concurrency.test.ts          ← 新規（6.5 の AtomicPersistence 適用検証）
├── telemetry-store.test.ts                     ← 新規
├── retry-policy-calculator.test.ts             ← 新規
└── wisdom-persistence-concurrency.test.ts      ← 新規（仕様書3-2 要請。wisdom.json に統合された hitCount のマージ加算も併せて検証）

tests/integration/
└── multi-process-wisdom.test.ts                ← 新規 (Phase 1 統合 — wisdom.json / wisdom-archive.json の並行書き込みを横断検証)
```

メトリクスは `wisdom.json` に統合済みのため、`wisdom-metrics-concurrency.test.ts` は設けない。代わりに `wisdom-persistence-concurrency.test.ts` がメタデータマージを併せて検証する。

### 9.2 既存テスト修正点

| テスト | 修正範囲 |
|--------|---------|
| `tests/core/wisdom-store.test.ts` | `attachMetrics` / `onEvict` の動作確認を追加 |
| `tests/core/tiered-wisdom-store.test.ts` | eviction → archive 連携を追加 |
| `tests/core/wisdom-persistence.test.ts` | `saveAtomic` の挙動は **無変更** で通ることを確認 |
| `tests/core/status-command.test.ts` | `formatAsJson()` の追加検証 |
| `tests/hooks/loop-handler.test.ts` | 動的 `maxRetries` のテストケース追加 |
| `tests/integration/wisdom-flow.test.ts` | **無変更** で通ることを確認（仕様書3-3 要請） |

### 9.3 競合テストの設計

`tests/core/atomic-persistence.test.ts`（5.6 の汎用プリミティブ単体）:

1. **シングルライター成功**: lockMeta.version と現在 version が一致、claim 獲得 → recheck 通過 → rename 成功 → `retries: 0`、書き込み後の envelope は version+1、`commit-pending` / `tmp.<uuid>` は両方とも残存しない（クリーンアップ確認）。
2. **シングル競合・1回リトライで成功**: 1 つ目が write 後 version を進めると 2 つ目は claim 獲得後の recheck で stale を検出 → `unlink(commit-pending)` し reload merge → 再 claim → 成功 → `retries: 1`。
3. **3 並行プロセス**: `Promise.all` で同時書き込み → `fs.link` で commit slot が atomic に直列化される → 注入された `merge` 関数で全件合流 → 最終 version は **書き込み回数と一致**（version の単調増加性、書き込み欠損ゼロを検証）。
4. **TOCTOU 排除の検証**: claim 保持中に別プロセスが Step 2.5 (rename) と同時刻に rename を試みても、claim を持たない側の Step 2.3 (link) が EEXIST で必ず弾かれることを検証。具体的には `fs.link` をスパイし、claim 保持期間中に他プロセスからの link 呼び出しが全て EEXIST を返すことを確認する。
5. **Claim 取得連続失敗**: 常に `commit-pending` が存在するモック（stale-claim でなく fresh mtime）→ 3 回 EEXIST が続いた後 conflict 退避 → `status: "conflict_diverted"`, `reason: "claim_acquisition_failed"`。
6. **Stale-claim 回復**: `commit-pending` が `STALE_CLAIM_TIMEOUT_MS` を超えた状態で残存しているモック → writer が `unlink(commit-pending)` で reclaim し正常 commit に到達 → `retries` は 0〜1 に収まる。
7. **誤判定 stale 回復の安全性**: 生きているプロセス A が claim 保持中、別プロセス B が誤って stale 判定して `unlink(commit-pending)` した場合 → A の Step 2.5 (rename) は ENOENT で失敗 → A は retry サイクルへ戻る → 最終的に両者が serialize されてデータロスト・version 重複なしで完了することを検証（safety property の維持）。
8. **Recheck 連続失敗で退避**: 常に version が進む（外部 writer が高頻度で publish する）モック → 3 回 recheck で stale 判定 → conflict 退避 → `reason: "version_mismatch"`。
9. **退避ファイル書き込み自身が失敗**: ENOSPC 等のモック → `console.warn` のみで例外伝播せず。
10. **レガシーフォーマット読み込み**: envelope を持たないレガシー JSON（旧 `saveAtomic` で書かれたファイル）を読み込み、`version=0` として解釈されること。続く `saveAtomicWithLock` で envelope 形式に昇格すること。
11. **Tmp file の uuid 衝突なし**: 並行 `saveAtomicWithLock` で各 writer の `tmp.<uuid>` が一意であり、互いに `unlink` で破壊し合わないことを検証。

上記のシナリオは型 T を差し替えて `wisdom-persistence-concurrency.test.ts` / `wisdom-archive-concurrency.test.ts` でも同様に検証する。各テストは固有の `merge` 実装（6.5 表）を検証する観点を追加する。

- `wisdom-persistence-concurrency.test.ts`: (a) 異なるエントリへの並行書き込みが両方残ること、(b) **同一 id のエントリに対する並行 `recordHit` 結果として `hitCount` が双方加算され、`lastHitAt` は新しい方、`firstSeenAt` は古い方を採用** すること（6.5 表のメタデータマージ検証）、(c) version の単調増加。
- `wisdom-archive-concurrency.test.ts`: 並行 `append` が `(entry.id, archivedAt)` で重複排除されつつ全件保存されること。

### 9.4 Mock FileSystem 拡張

`tests/helpers/mock-file-system.ts` に下記を追加。version ベースの楽観ロックは **ファイル内容（envelope の JSON）にのみ依存** するため、`stat` / `mtime` 関連のヘルパーは不要。代わりにファイル内容を直接書き換えることで競合シナリオを構築する。

```typescript
interface MockFileSystem extends FileReader, FileWriter {
  // ファイル内容を直接書き換え、version を進ませて競合を再現するための補助
  setRawContent(path: string, raw: string): void;
}

function createSharedMockFileSystem(): MockFileSystem;
function createConflictingMockFileSystem(): MockFileSystem;
```

### 9.5 Devcontainer 内テスト実行

```bash
bun install
bun run test
bun run typecheck
bun run lint
```

全てがグリーンになることを各 PR の完了条件とする。

## 10. 段階的 PR 分割計画

| PR | 範囲 | 完了条件 |
|----|------|----------|
| PR1 | 型定義 (`LockMetadata` / `VersionedEnvelope<T>` / `ConflictRecord` / `WisdomEntry` の optional メタデータフィールド等) | 既存テスト全通過、`WisdomEntry` の optional 拡張により後方互換性が保たれること |
| PR2 | Phase 1 楽観ロック（version ベース） + 汎用プリミティブ `AtomicPersistence<T>`（5.6） + `WisdomPersistence` を thin wrapper 化 + レガシーフォーマット読み込み互換 + 競合テスト | concurrency tests（atomic-persistence + wisdom-persistence）+ 既存 wisdom テスト通過、レガシー JSON が version=0 として読み込めること |
| PR3 | Phase 2 メトリクス（`WisdomEntry` 内へ統合 / `WisdomStore.updateMetrics` / `WisdomMetrics` ステートレス化） + アーカイブ + Tiered 配線（永続化は PR2 の `AtomicPersistence<T>` を `wisdom.json` / `wisdom-archive.json` 双方で再利用、`wisdom-metrics.json` を新設しない） | 新規 + 既存 wisdom 系テスト + archive concurrency tests + wisdom-persistence でメタデータマージ検証通過 |
| PR4 | Phase 3 テレメトリ + `formatAsJson` | 新規 telemetry テスト + status-command テスト通過 |
| PR5 | Phase 4 動的閾値 + LoopHandler 統合 | retry-policy-calculator テスト + 既存 loop-handler テスト通過 |

各 PR は独立してマージ可能。`bun run test && bun run typecheck && bun run lint` のグリーンを完了条件とする。

## 11. 受入基準（Acceptance Criteria）

| ID | 基準 |
|----|------|
| AC-1 | `wisdom.json` / `wisdom-archive.json` のいずれにおいても並行書き込みでデータ欠損が発生しない（全 concurrency test 通過。すべて 5.6 の `AtomicPersistence<T>` 経由で **データ内 `version` フィールドベースの楽観ロック** + **`fs.link()` のアトミック排他作成による commit slot の直列化** で永続化されること。`mtime` 等のファイルシステム属性は競合検出の根拠としては使用されないこと。check-then-act 型の TOCTOU window が存在しないこと（5.2 Step 2.3〜2.5 の atomic claim プロトコルにより、commit 区間全体が OS カーネル空間で逐次化されること）） |
| AC-2 | リトライ上限到達時に各ファイルに対応する `wisdom.conflict.json` / `wisdom-archive.conflict.json` に退避され、`reason` が `"version_mismatch"` / `"claim_acquisition_failed"` / `"rename_conflict"` のいずれかとして記録され、メイン処理が `exit 0` ではなく **継続** する。退避時に自プロセス所有の `*.tmp.<uuid>` / `*.commit-pending` が残存しないこと |
| AC-3 | LRU eviction された `failure_gotcha` / `design_decision` が `wisdom-archive.json` に best-effort で移される（eviction → archive は非同期 fire-and-forget のため、プロセス終了タイミングによっては書き込みが完了しない可能性がある — 6.4 参照） |
| AC-4 | `environment_quirk` は `hitCount >= 3` を満たした場合のみアーカイブされる（`hitCount` は `WisdomEntry` 自身から参照する — SSoT） |
| AC-5 | `justice status --analytics --json` が JSON.parse 可能で `failureRate` / `wisdomHitRate` / `errorDistribution` を含む |
| AC-6 | `LoopDetectionHandler` の `maxRetries` が category と stepCount から動的算出され、`thresholdResult` がデバッグ可能 |
| AC-7 | 既存 `tests/integration/wisdom-flow.test.ts` および `tests/core/wisdom-persistence.test.ts` が無変更で通過する（`WisdomEntry` への新フィールドは optional 化、レガシー JSON は version=0 として読み込まれることで後方互換を担保） |
| AC-8 | `WisdomEntry` を含む全 type は `readonly` 修飾子を維持し、メタデータ更新は `WisdomStore.updateMetrics` を経由した copy-on-write（新インスタンスへの差し替え）でのみ行われる。in-place mutation は発生しない。 |
| AC-9 | メタデータ（`hitCount` / `lastHitAt` / `firstSeenAt`）は `WisdomEntry` 自身に内包され、`wisdom-metrics.json` 等の別ファイルとして分離されていない（**Single Source of Truth** の維持） |

## 12. 用語集

| 用語 | 定義 |
|------|------|
| Optimistic Lock | データ内に埋め込まれた単調増加の `version` を比較し、不一致時に再ロード→マージ→再試行する非ブロッキング同期手法（ファイルシステム属性 `mtime` には依存しない） |
| Versioned Envelope | `{ version: number, data: T }` の形でファイルに永続化される包み構造。`version` は書き込み毎に +1 され、楽観ロックの根拠となる |
| Atomic Claim Slot | `<path>.commit-pending` という固定名のスロット。`fs.link()` のアトミック排他作成（POSIX 保証）で writer 間を直列化する。Blocking lock ではなく即時 EEXIST/成功を返す non-blocking 機構 |
| TOCTOU (Time of Check to Time of Use) | check-then-act 型の race condition。チェック時の前提が act までの間に別アクターによって変更され、誤った操作が成立する脆弱性。本設計では Atomic Claim Slot により check（version recheck）と act（rename publish）の間に他 writer が介入できないようカーネル空間で逐次化することで解消 |
| Stale-claim Recovery | プロセスがクラッシュ等で `<path>.commit-pending` を残存させた場合に、後続 writer が `mtime` ベースのタイムアウト判定（既定 10 秒）で reclaim する回復機構。誤判定しても safety property は維持される |
| Single Source of Truth (SSoT) | 同一の事実を表すデータを 1 箇所のみに置き、複数箇所に重複させない設計原則。本設計ではメトリクスを `WisdomEntry` 自身に内包し `wisdom-metrics.json` を分離しないことで実現 |
| Copy-on-Write | 既存オブジェクトを mutate せず、変更を反映した新しい immutable インスタンスを生成して置換する更新手法。`readonly` 制約と更新ニーズを両立する |
| Fail-Open | 障害発生時にメイン処理を継続させる方針（cf. Fail-Close） |
| LRU eviction | Least Recently Used 方式で、容量超過時に最古エントリを除外する |
| Wisdom | Justice における学習エントリ（成功パターン / 失敗の落とし穴 / 設計判断 / 環境固有事項） |
| Tier | Wisdom の保存階層（local: project-local、global: `~/.justice`） |
