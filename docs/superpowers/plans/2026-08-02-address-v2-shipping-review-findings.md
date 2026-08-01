# v2 Shipping 設計書レビュー指摘対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `docs/superpowers/specs/2026-07-31-justice-v2-shipping-design.md` に対し、4 件のレビュー指摘（fsync 方針、writerId 再利用の crash 復旧、root specifier 検証の隔離、設定ソース探索の拡張）を設計書レベルで反映する。

**Architecture:** 既存の Phase 2/4/5 セクションを拡張し、運用・復旧・診断に関する暗黙知を明示的な仕様に変換する。本対応は設計書のみで、実装コード・テストコードは変更しない。

**Tech Stack:** Markdown（`markdownlint-cli2` / Prettier 準拠）

## Global Constraints

- 設計書は `docs/superpowers/specs/2026-07-31-justice-v2-shipping-design.md` のみを変更する
- 新しい事実を追加する場合は、既存の不変条件（特に pure core、fail-open、JSON-only persistence）と矛盾しないことを確認する
- コード実装は行わない（ユーザー指示）
- 絶対パスや secrets は設計書に書かない

---

### Task 1: fsync / 耐久性方針の追記（Line 417 周辺）

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-justice-v2-shipping-design.md:§8.4.1-3`

**Interfaces:**
- Consumes: 既存の §8.4.1-3（L417）の「fsync 無しを許容するが理由を明示せよ」という記述
- Produces: 「advisory レコードと DecisionRecord 生成に必要な証拠レコードの区別」「永続化境界」「損失許容範囲」「復旧後の Gate 評価動作」を含む新パラグラフ

- [ ] **Step 1: パラグラフの追加**
  §8.4.1-3 の末尾に以下を追記する。
  - 観測ログは原則 L0 advisory であるが、`task_complete` などの DecisionRecord はその直前の `observed` evidence（test/build/review outcome）に基づく。evidence append から DecisionRecord append までの間に crash すると、evidence が失われて DecisionRecord の根拠が監査不能になる。
  - したがって fsync 無しの場合、**許容損失範囲は「単一の append キュー処理単位（1 レコード）」まで**とする。1 レコード単位の temp+rename は atomic だが、rename 後の dir metadata は fsync しないため、OS crash 時に直近 1 レコードが失われうる。
  - 復旧後の Gate 評価は `readAll()` が fail-open で不完全 shard を除外するため、失われた evidence に基づく DecisionRecord は再評価されず、当該 shard の後続レコードだけが評価対象となることを明記する。
  - 監査不可を防ぐため、**Gate PASS/FAIL を伴う DecisionRecord の直前では、対応する observation evidence が少なくとも同一プロセス内で永続化された後に DecisionRecord を生成する**ことを実装上の方針とする。

- [ ] **Step 2: 実 FS crash 復旧テスト要件の追加**
  §8.4.1-5 の末尾（L422 直後）に以下を追加する。
  - 「**append 直前の crash と復旧**: 実 FS 上で `atomicAppend` 書込途中（temp ファイル作成後・rename 前）にプロセスを kill した状態から再起動し、`readAll()` が有効レコード群を返し、破損した temp ファイルや不完全な行を含まないことを検証する。」

- [ ] **Step 3: lint/format 確認**
  Run: `bun run lint && bun run format`
  Expected: 0 errors

---

### Task 2: writerId 再利用のクラッシュ復旧方針（Line 416-424 周辺）

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-justice-v2-shipping-design.md:§8.4.1-2 および §8.4.1-6`

**Interfaces:**
- Consumes: 既存の writerId 採番方針（`allocateWriterId` は存在しない物理パスのみ採番）
- Produces: 明示的な「writerId 再利用禁止」ポリシーと、同 writerId 再起動テスト要件

- [ ] **Step 1: writerId 再利用ポリシーの明文化**
  §8.4.1-2 の末尾（L416 末尾あたり）に以下を追記する。
  - writerId は **セッション（プロセス）単位で新規採番**する。`allocateWriterId()` は既存物理パスを見ない候補を採番するが、これは「再利用を禁止するための前提」ではなく「新規 shard 作成時の重複回避」である。
  - `JusticePluginOptions` への `writerId` 上書き指定は、テスト・デバッグ以外では使用しない。使用する場合は、**当該 writerId の物理パスが既存の場合、前回の shard を開いて継続するのではなく、明示的に新規 writerId を再採番するか、手動でアーカイブを完了させてから指定する**ことを運用手順とする。
  - 現行の `computeInitialSequence()` は同一プロセス内での rotation 継続を想定したものであり、**クラッシュ後の同 writerId 再利用による復旧はサポートしない**。

- [ ] **Step 2: 同 writerId 再起動テスト要件の追加**
  §8.4.1-6 の末尾（L424 直後）に以下を追加する。
  - 「**同一 writerId での再起動**: テスト目的で `writerId` を固定し、shard にレコードを append した直後にプロセスを再起動する。再起動後、同じ `writerId` を使おうとした場合、既存 shard を開かずに新規 writerId を採番するか、または `ObservationLogStore.append()` が writerId 不一致で拒否する動作を確認する。sequence gap・重複・JSONL 破損が発生しないことを検証する。」

- [ ] **Step 3: lint/format 確認**
  Run: `bun run lint && bun run format`
  Expected: 0 errors

---

### Task 3: root specifier 検証の隔離（Line 250-258 周辺）

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-justice-v2-shipping-design.md:§6.0 手順 2`

**Interfaces:**
- Consumes: 既存の Phase 2 root specifier 検証手順
- Produces: 専用 HOME / config / cache ディレクトリを使う隔離手順と、レポート記録フィールド

- [ ] **Step 1: 手順 2 の冒頭に隔離要件を追加**
  「新規の一時ディレクトリ `tmp/phase2-root-<uuid>/` を作成し...」の直後に以下を追加する。
  - 一時ディレクトリ内に `home/`, `config/`, `cache/` サブディレクトリを作成する。
  - 検証を実行する際は、**`HOME=<tmp>/home`、 `XDG_CONFIG_HOME=<tmp>/config`、`XDG_CACHE_HOME=<tmp>/cache`、`OPENCODE_CONFIG_DIR=<tmp>/config/opencode`** を環境変数として設定する（OpenCode がこれらを参照する場合）。
  - これにより、既定の `~/.config/opencode` および `~/.cache/opencode` は一切変更・参照されないことを保証する。
  - 手順内の `~/.cache/opencode/packages/...` クリーンは、代わりに `<tmp>/cache/opencode/packages/...` を対象とする。

- [ ] **Step 2: 検証レポート記録フィールドの追加**
  §6.0 手順 2 の末尾（L260 直前）に、検証レポートに必ず含める項目を箇条書きで追加する。
  - 使用した各一時ディレクトリパス（`HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `OPENCODE_CONFIG_DIR`）の相対または `<tmp>/...` 形式
  - 解決済み package version（例: `@yohi/justice@3.0.0`）
  - 検証で生成された固有の `sessionId`（2 件以上の経路でそれぞれ異なることを確認）
  - 検証で生成された固有の `callId`（2 件以上の経路でそれぞれ異なることを確認）

- [ ] **Step 3: lint/format 確認**
  Run: `bun run lint && bun run format`
  Expected: 0 errors

---

### Task 4: 設定ソース探索・マージ仕様の拡張（Line 450-453 周辺）

**Files:**
- Modify: `docs/superpowers/specs/2026-07-31-justice-v2-shipping-design.md:§9.1.0`

**Interfaces:**
- Consumes: 既存の global/project/.opencode 優先順位
- Produces: OpenCode 全設定ソースの優先順位、plugin 統合ルール、`unsupported_config_source` 診断値、fixture/test 要件

- [ ] **Step 1: 対象ソースの拡張**
  §9.1.0 の「対象ファイルとマージ」箇条書きを、以下のように置き換える。
  - OpenCode の設定ソースを **優先順位の低い方から** 列挙する：
    1. remote config（組織・リモート管理設定）
    2. global config（`~/.config/opencode/config.json` / `opencode.json` / `opencode.jsonc`）
    3. `OPENCODE_CONFIG` 環境変数（単一ファイルパス）
    4. project config（カレントディレクトリから Git worktree まで親方向探索した `opencode.json` / `opencode.jsonc`）
    5. `.opencode` directory config（`.opencode/opencode.json` / `.opencode/opencode.jsonc`）
    6. `OPENCODE_CONFIG_DIR` 環境変数（ディレクトリ単位）
    7. `OPENCODE_CONFIG_CONTENT` 環境変数（インライン JSONC）
    8. managed config / managed preferences（OpenCode 管理設定）
  - 優先順位は上記の昇順（低→高）とし、後から読まれた高優先度側が `plugin` 配列の同一エントリで上書きする。

- [ ] **Step 2: plugin 統合ルールの追加**
  同箇条書き内に以下を追加する。
  - `plugin` 配列を統合する際、**同一 npm パッケージ名または同一ローカルファイルパスは高優先度側で重複除去**する。
  - **異なる plugin は優先順位に関わらず保持**する（低優先度側の plugin も消さない）。
  - 例：global に `@yohi/justice@2.7.0`、project に `@yohi/justice@3.0.0` がある場合、project 側の `@yohi/justice@3.0.0` を採用し、2.7.0 は破棄する。

- [ ] **Step 3: 未対応ソースの診断値追加**
  L459 の「対応戦略」直後に以下を追加する。
  - 未対応の設定ソース（`OPENCODE_CONFIG_CONTENT` や managed config/preferences 等、doctor がまだ読み込めないソース）に `plugin` エントリが存在する場合、**`justice_not_found_in_config` ではなく `unsupported_config_source` を報告**する。
  - 出力には「未対応ソース名」「そのソースで検出された `@yohi/justice` 系 specifier の有無（allowlisted オプションキーのみ）」「対応予定または手動確認を促すメッセージ」を含める。

- [ ] **Step 4: fixture/test 要件の追加**
  §9.1.0 の fixture 列挙（L460-466）に以下を追加する。
  - `OPENCODE_CONFIG` で指定されたファイルに Justice がある場合
  - `OPENCODE_CONFIG_DIR` 配下に Justice がある場合
  - `OPENCODE_CONFIG_CONTENT` に Justice がある場合
  - 複数ソースに同一パッケージ名の異なるバージョン（例: global `@yohi/justice@2.7.0` + `.opencode` `@yohi/justice@3.0.0`）がある場合、`.opencode` 側が優先される
  - 未対応ソースに plugin がある場合、`unsupported_config_source` が報告される

- [ ] **Step 5: lint/format 確認**
  Run: `bun run lint && bun run format`
  Expected: 0 errors

---

## Self-Review Checklist

- [ ] 4 件の指摘すべてが設計書に反映されている
- [ ] 新記述が既存の不変条件と矛盾していない
- [ ] 絶対パスや secrets を含んでいない
- [ ] `bun run lint` / `bun run format` が通る
