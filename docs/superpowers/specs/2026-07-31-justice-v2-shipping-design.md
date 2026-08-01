# Justice v2.0 出荷完了 設計書 — 配布契約の修正と実機実証 (v2026.07.31)

## 0. メタ情報

| 項目           | 値                                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 作成日         | 2026-07-31                                                                                                                                                                              |
| 対象バージョン | `@yohi/justice` 2.7.0 → 3.0.0（破壊的変更）                                                                                                                                             |
| 起点           | [Issue #192](https://github.com/yohi/justice/issues/192)（Nexus プロジェクトからのレポート）                                                                                            |
| 想定ロール     | Justice Core Maintainer                                                                                                                                                                 |
| 対象ブランチ   | `master` を起点とする `feature/justice-v2-shipping-*`                                                                                                                                   |
| 関連スキル     | `brainstorming`（本書作成）→ `writing-plans`（次工程）                                                                                                                                  |
| 関連文書       | [SPEC.md §15](../../../SPEC.md)、[ADR-2026-06-26-v2-charter-drift.md](./ADR-2026-06-26-v2-charter-drift.md)、[2026-06-26-v2-phase0-spikes.md](../spikes/2026-06-26-v2-phase0-spikes.md) |

## 1. 目的とスコープ

Justice v2.0 Quality Control Plane を、**実機で動作することが観測によって証明された状態**にし、SPEC §15.12 に記録された出荷ブロッカーを解消する。

本設計の起点は Issue #192 だが、**調査の結果、同 Issue の原因診断は誤りであることが判明した**。真因は Nexus 側の統合不足ではなく、Justice の配布パッケージのエントリポイント定義の誤りであり、**Justice プラグインは一度もロードされたことがなかった**（§2 参照）。したがって本設計の中心は新機能実装ではなく、**配布契約の修正と実機実証**である。

### 1.1 スコープ内

| Phase   | 主題                                                           | 優先度 |
| ------- | -------------------------------------------------------------- | ------ |
| Phase 1 | 配布エントリポイントの再構成 + ローダ契約回帰テスト（FF-009）  | P0     |
| Phase 2 | 実機での観測実証（Observation Log / Gate / `justice_review`）  | P0     |
| Phase 3 | `PluginOptions` 配線と C1（advisory 表示面）の実証・既定値確定 | P1     |
| Phase 4 | 書込レイテンシの再計測と改善方針の確定                         | P1     |
| Phase 5 | 診断手段の2層構成（診断 CLI + `justice_review` health）        | P1     |
| Phase 6 | ADR 承認要件の改訂と SPEC / README の整合                      | P2     |

### 1.2 スコープ外

- **Node ESM 非互換**（§9.1）— 別 Issue に切り出す。
- **SPEC §15.11 の v2.5+ 延期機能** — Handoff（FR-003）、Final Verifier（FR-007）、Acceptance Criteria 判定（FR-005）、OmO agents awareness、L1 以上の Enforcement、event log の物理 prune、Artifact authorship。本設計では一切扱わない。
- **v1 機能の変更** — plan-bridge / task-feedback / wisdom の挙動は変更しない。

## 2. 真因分析（一次証拠）

### 2.1 観測された事実

| 確認項目                                             | 実測結果                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `~/.config/opencode/opencode.jsonc` の `plugin` 配列 | `"@yohi/justice@2.7.0"` が登録済み                                                  |
| パッケージ実体                                       | `~/.cache/opencode/packages/@yohi/justice@2.7.0/node_modules/@yohi/justice/` に存在 |
| publish 済み `dist` への v2 コード同梱               | 同梱済み（`dist/runtime/observation-log-store.js` 等）                              |
| `~/program` 配下の `.justice/` ディレクトリ          | **0 件**（nexus・justice 自身とも不存在）                                           |
| `.justice/events/`                                   | ファイルシステム上に **0 件**                                                       |
| `~/.justice/`（グローバル wisdom）                   | ディレクトリは存在するが**空**                                                      |
| OpenCode ログ（140,147 行）の `service=justice`      | **0 件**                                                                            |
| 同ログの `Justice initialized via opencode-adapter`  | **0 件**                                                                            |
| 同ログの `[Justice]` プレフィックス                  | **0 件**                                                                            |
| 同ログの `failed to load plugin`                     | **全起動で毎回発生**                                                                |

決定的なログ行:

```text
level=ERROR message="failed to load plugin" path=@yohi/justice@2.7.0
            error="Plugin export is not a function"
```

### 2.2 OpenCode プラグインローダの契約

OpenCode バイナリ（`~/.opencode/bin/opencode`）から抽出したローダ実装:

```js
function nV($) {
  return typeof $ === "function";
}

function Yy($) {
  if (nV($)) return $; // 関数ならそのままプラグイン
  if (!$ || typeof $ !== "object" || !("server" in $)) return; // PluginModule でもない
  if (!nV($.server)) return;
  return $.server; // { server: fn } を許容
}

function Xy($) {
  // $ = モジュール名前空間オブジェクト
  let Z = new Set(),
    Q = [];
  for (let Y of Object.values($)) {
    // 全 export を走査
    if (Z.has(Y)) continue; // 同一関数は dedup
    Z.add(Y);
    let J = Yy(Y);
    if (!J) throw TypeError("Plugin export is not a function"); // 1件でも不適合なら全体が throw
    Q.push(J);
  }
  return Q;
}
```

**契約は2点。**

1. モジュールの **すべての** export が「関数」または「`{ server: 関数 }`」でなければ、プラグイン全体のロードが `TypeError` で失敗する。
2. 適合した export は **すべてプラグインファクトリとして呼び出される**（同一関数オブジェクトは `Set` で dedup される）。

### 2.3 契約違反の内容

`"@yohi/justice@2.7.0"` は `exports["."]` → `dist/index.js`（barrel）に解決される。実測した barrel の形状:

| 項目                                | 実測値                                                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dist/index.js` の総 export 数      | 49                                                                                                                                                                                                           |
| うち非関数 export                   | **8 件** — `AGENT_IDS` / `DEFAULT_PERSONA` / `DEFAULT_RETRY_POLICY` / `JUSTICE_START_COMMAND` / `LOOP_ERROR_PATTERNS` / `PersonaClassifier` / `REVIEW_REJECTION_PATTERNS` / `WORKFLOW_START_FALLBACK_MARKER` |
| `dist/opencode-plugin.js` の export | `OpenCodePlugin: function` / `default: function`（同一関数オブジェクト → dedup 後 1 プラグイン）                                                                                                             |

契約1に違反するため `TypeError` が投げられ、**プラグインは 1 行も実行されない**。さらに契約2により、**仮に非関数 export を全廃しても root 登録は誤りである** — `PlanParser` 等のクラスがプラグインファクトリとして呼び出されてしまう。すなわち **barrel と plugin entry は `exports["."]` 上で共存できない**。

### 2.4 影響範囲

- **v2.0 Quality Control Plane は一度も実行されていない。** Observation Log・Gate 評価・`justice_review` はすべて未稼働。
- **v1 機能も一度も実行されていない。** plan-bridge / task-feedback / wisdom も同様に未稼働（`.justice/wisdom.json` が 1 件も存在しない事実と整合）。
- **Issue #192 の「v1 フローは完全準拠」という記述は、報告した AI エージェントの自己申告（`declared`）であり、観測された事実ではない。** Justice が検出対象としている `Task Success ≠ Feature Success` を Justice 自身が実演した形であり、`declared` provenance を Gate の PASS 判定に算入しない原則（FF-008）の正当性を裏付ける事例である。
- **README の「推奨」インストール手順が壊れている。** `opencode plugin @yohi/justice` は root specifier を設定に書き込むため必ず失敗する。パターン2（`@yohi/justice/opencode` を import）とパターン3（`dist/opencode-plugin.js` を直接指定）は正しい。壊れているのは推奨経路のみ。

### 2.5 検証済みの否定仮説

調査中に検討し、証拠によって否定した仮説を記録する。

| 仮説                                                                               | 判定     | 根拠                                                                                                            |
| ---------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| H2: `#noOp`（`worktree ?? directory ?? project.root` が全て null）で初期化されない | **否定** | `PluginInput.worktree` / `directory` は `@opencode-ai/plugin` 1.14.21・1.18.4 の双方で非オプショナルな `string` |
| H3: publish 物に v2 コードが同梱されていない                                       | **否定** | `dist/runtime/observation-log-store.js` 等が同梱済み                                                            |
| H4: `dist/index.js` がプラグインを export していない                               | **否定** | `export { OpenCodePlugin as default, OpenCodePlugin }` を含み、`typeof default === "function"`                  |
| H1: ロードは成功するが観測経路が黙って失敗する                                     | **保留** | ロード自体が失敗しているため未検証。Phase 2 で判定する                                                          |

## 3. 設計原則と制約

`AGENTS.md` の非交渉的不変条件を厳守する。

1. **Pure core** — `src/core/**`（`src/core/v2/` を含む）は `@opencode-ai/*` を import しない。新規追加する診断ロジックも純粋部分は `src/core/`、ファイル探索・ログ読取は `src/runtime/` に置く。
2. **Fail-open** — hook / adapter / notifier の境界はすべて例外を捕捉し `PROCEED` または安全なフォールバックへ縮退する。**診断 CLI のみ唯一の例外**として非ゼロ終了コードを返す（プラグイン本体ではなく、セッションを落とさないため）。
3. **Immutable public state** — `readonly` / `ReadonlyArray` / `ReadonlyMap` を維持する。
4. **JSON-only persistence** — atomic temp + rename を維持する（Phase 4 で方式変更を検討する場合も、外部 DB やバイナリストレージは導入しない）。
5. **One public tool** — `OpenCodeAdapter.getTools()` が公開するのは `justice_review` のみ。**本設計はこの不変条件を破らない**（診断は `justice_review` の出力拡張と外部 CLI で実現する）。
6. **Evidence trust** — `declared` provenance は Gate の PASS 判定に算入しない（FF-008）。変更しない。
7. **Advisory bootstrap** — `/justice-start` / `/justice-implement` のガイダンスはスキルや `task()` を起動しない。変更しない。
8. **Implementation arm** — `handlePreToolUse` の enrichment は明示的アーム時のみ。変更しない。
9. **Reserved fallback** — `parseWorkflowStartFallbackMarker()` は `PlanBridge.handleMessage()` に配線しない。変更しない。

## 4. 実行順序と依存関係

```text
Phase 1 配布契約修正（真因）
   │
   └─> Phase 2 実機実証 ← ここで初めて「v2.0 が実在する」ことが証明される
          ├─> Phase 3 C1（advisory 表示面）実証・既定値確定
          └─> Phase 4 レイテンシ再計測・方針確定
   Phase 5 診断2層（Phase 1 と並行可能）
   Phase 6 ADR 改訂・SPEC/README 整合（Phase 2-4 の結果を反映）
```

**Phase 2 を飛ばして Phase 3 / 4 に進んではならない。** v2.0 が動作する証拠がない状態で advisory 表示面やレイテンシを議論しても意味がない。Phase 2 が失敗した場合は H1（§2.5）が確定するため、そこで観測経路のデバッグに入る。

## 5. Phase 1 — 配布エントリポイントの再構成（P0・破壊的変更）

### 5.1 `package.json` の変更

変更後の `exports` マップを確定形で示す。各サブパスは `import` と `types` の両方を宣言する。

```jsonc
{
  "main": "dist/opencode-plugin.js", // was: dist/index.js
  "module": "dist/opencode-plugin.js", // was: dist/index.js
  "types": "dist/opencode-plugin.d.ts", // was: dist/index.d.ts
  "version": "3.0.0", // was: 2.7.0（破壊的変更）
  "exports": {
    ".": {
      // plugin 専用エントリへ変更（真因の修正）
      "import": "./dist/opencode-plugin.js",
      "types": "./dist/opencode-plugin.d.ts",
    },
    "./opencode": {
      // 変更なし（後方互換のため維持）
      "import": "./dist/opencode-plugin.js",
      "types": "./dist/opencode-plugin.d.ts",
    },
    "./core": {
      // 新設：ライブラリ named export の退避先
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts",
    },
    "./runtime": {
      // 変更なし
      "import": "./dist/runtime/node-file-system.js",
      "types": "./dist/runtime/node-file-system.d.ts",
    },
  },
}
```

`dist/index.js` 自体の中身は変更しない（`OpenCodePlugin` の re-export も残す）。`./core` は plugin エントリではないため、§2.2 のローダ契約の対象外である。

### 5.2 効果

- `"@yohi/justice"` / `"@yohi/justice@3.0.0"` / `"@yohi/justice/opencode"` の**いずれの specifier でも正しくロードされる**。
- 既存の壊れた設定（root specifier 登録）は、パッケージ更新のみで**利用者側の設定変更なしに復旧する**。
- `opencode plugin @yohi/justice` という README の推奨手順がそのまま機能するようになる。

### 5.3 破壊的変更と移行

`import { PlanParser } from "@yohi/justice"` 形式のライブラリ利用は `@yohi/justice/core` へ移行が必要。CHANGELOG と README に移行表を記載する。

移行前後の対応:

```ts
// Before (2.x)
import { PlanParser, TaskPackager } from "@yohi/justice";

// After (3.0)
import { PlanParser, TaskPackager } from "@yohi/justice/core";
```

プラグイン利用（`@yohi/justice/opencode`）とランタイム利用（`@yohi/justice/runtime`）は非破壊。

### 5.4 FF-009 — 配布エントリのローダ契約回帰テスト

`package.json` の `exports` に宣言された**全エントリ**について、ビルド後の `dist` を **specifier 経由で解決して** import し、OpenCode ローダの契約（§2.2）を模して検証する。

**`dist/opencode-plugin.js` のようなファイルパス直 import は禁止する。** パス直 import は `exports` マップを一切経由しないため、今回の真因（`exports["."]` の誤マッピング）を構造的に検出できない。解決は package self-reference（自パッケージ名を specifier として import する形式。`package.json` に `exports` があれば Node / Bun とも対応）で行う。一時パッケージの install は不要であり、self-reference で `exports` の解決経路を実際に通せることは実測で確認済みである（`import("@yohi/justice/opencode")` が `["OpenCodePlugin", "default"]` を返す）。

検証内容:

1. **plugin エントリ**（`.` と `./opencode`）— `Object.values(module)` の全要素が `typeof === "function"` または `{ server: function }` を満たす。
2. **plugin エントリの一意性** — `Object.values(module)` の各 export を関数 identity で dedup した上で、解決されるプラグインが**正確に 1 個**である（barrel 回帰および意図しない多重登録の再発防止）。`default` と named export が同一関数オブジェクトの場合、dedup 後 1 回のみ検証対象となる。
3. **全エントリの解決可能性** — `exports` に宣言された各サブパス specifier（`@yohi/justice` / `@yohi/justice/opencode` / `@yohi/justice/core` / `@yohi/justice/runtime`）が self-reference で解決でき、**テストランタイム（Bun）から** import 可能である。
4. **plugin export の実行可能性** — 不適合な export を拒否した後、残った export を関数 identity で dedup し、**dedup 後の各 factory を 1 回ずつ呼び出して** `Hooks`（`tool` / `event` 等のフックを持つオブジェクト）を返すことを検証する。§2.2 の契約2「適合した export はすべてプラグインファクトリとして呼び出される」は `typeof` 検査だけでは検証されないため、呼出しまで到達させる。呼出しには `PluginInput` のスタブ（`project` / `client.app.log` / `$` / `directory` / `worktree`）を渡す。plugin factory は adapter 生成と `getTools()` のみを行い `#runInit()` は `ensureInitialized()` 経由の遅延実行であるため、この呼出しはディスク I/O を発生させない。

検証 3 を Bun 上に限定するのは意図的である。`./core` は現状 Node ESM からは import できないが（拡張子なし相対 import。§11.1 参照）、その修正は本設計のスコープ外であり、FF-009 は「OpenCode が実際に使うランタイム（Bun）でロード可能か」を担保する目的に絞る。Node 互換の検証は §11.1 の別 Issue で扱う。

配置は `tests/dist/` 系（新設）とする。`tests/arch/` は静的 import 検証専用であり、ビルド成果物を対象とする本テストとは性質が異なるため混在させない。

**実行順序を設定で強制する。** 現行の `vitest.config.ts` の `include` は `tests/**/*.test.ts` であり、`tests/dist/` を新設すると既定の `bun run test` に取り込まれる。一方 CI（`.github/workflows/ci.yml`）は `bun run test` → `bun run build` の順であるため、そのままではクリーンチェックアウトで `dist` 不在のまま実行され失敗する。「CI ではビルド後に実行する」という運用前提だけに委ねず、以下を設計上の要件とする。

1. `vitest.config.ts` の `exclude` に `tests/dist/**` を追加し、既定の `bun run test` が `dist` 不在でも成立する状態を保つ。
2. `vitest.dist.config.ts`（`include: ["tests/dist/**/*.test.ts"]`）と script `"test:dist": "bun run build && bun run vitest run --config vitest.dist.config.ts"` を追加し、**ビルド前提を script 自体で保証する**。
3. CI の `test` ジョブに `bun run test:dist` ステップを追加する。
4. §13 の完了条件にも `bun run test:dist` を明示する。

**これは今回の事故を検出できる唯一のテストである。** 既存の 127 テストファイルはすべてソースを直接 import しており、`package.json` の `exports` 定義とビルド成果物の形状を検証していなかった。

## 6. Phase 2 — 実機での観測実証（P0）

ビルドした `dist/opencode-plugin.js` を絶対パスで OpenCode 設定に登録する実機 smoke test（README パターン3）に加え、**root specifier 経由で OpenCode パッケージキャッシュを経由する実機検証**を実施する。Phase 1 の真因が root specifier 経由のロード失敗であるため、Phase 2 の完了には root specifier 経由の検証が不可欠である。絶対パス検証は後方互換・開発用パターンの継続動作を担保するため維持する。

### 6.0 Phase 2 検証手順

1. **絶対パス smoke test（維持）**: 新規の一時ディレクトリ `tmp/phase2-absolute-<uuid>/` を作成し、そこをカレントディレクトリとして OpenCode を起動する。`opencode.jsonc` の `plugin` 配列に、ビルドした `dist/opencode-plugin.js` の**絶対パス**を登録する。この一時ディレクトリ内に `.justice/` と `events/` が新規作成され、`failed to load plugin` が発生せず、`Justice initialized via opencode-adapter` が出力されることを確認する。続けて当該一時プロジェクト内で任意ツールを 1 回実行し、`.justice/events/<agentId>/<sessionId>/<writerId>.jsonl` が**新規 sessionId / callId** のレコードを含んで生成されることを確認する。他の検証経路と `.justice/` を共有してはならない。

2. **root specifier 検証（追加）**: 新規の一時ディレクトリ `tmp/phase2-root-<uuid>/` を作成し、直下に `home/`、`config/`、`cache/` サブディレクトリを用意する。検証実行時は **`HOME=<tmp>/home`、`XDG_CONFIG_HOME=<tmp>/config`、`XDG_CACHE_HOME=<tmp>/cache`、`OPENCODE_CONFIG_DIR=<tmp>/config/opencode`** を環境変数として設定し、既定の `~/.config/opencode` および `~/.cache/opencode` は一切使用しない。`opencode plugin @yohi/justice@3.0.0` を実行して root specifier 経由でインストール・設定を行う（キャッシュは `<tmp>/cache/opencode/packages/@yohi/justice@3.0.0/` 以下に生成される）。設定に登録された specifier が `@yohi/justice@3.0.0` であることを確認したうえで、OpenCode を起動する。以下を確認する。

   - `failed to load plugin` が発生しないこと。
   - `Justice initialized via opencode-adapter` が出力されること。
   - `plugin` 配列の tuple 形式 `[["@yohi/justice@3.0.0", { "enableAdvisoryOutputAppend": true }]]` を設定した場合も、root specifier 経由で同様にロード・初期化されること。
   - 検証対象の specifier が正規化・解決された後のバージョンが `3.0.0` でない場合は、root specifier 経由の検証を `fail` とする。3.0.0 未満では root specifier が壊れている（§2.3 および §5.1 参照）ため、tuple 第 1 要素はバージョン付きの `@yohi/justice@3.0.0` とするか、解決後バージョンを記録して 3.0.0 であることを検証する。
   - 任意のツールを 1 回実行し、`.justice/events/` へ**当該一時プロジェクト固有の** JSONL が生成されること。この際の `sessionId` / `callId` は絶対パス経路および他の既存成果物のものと重複してはならない。
   - `justice_review` を `scope` 未指定で呼び出し、レビュー要約が返ること。

   - 検証レポートには、使用した各一時ディレクトリ（`<tmp>/home`、`<tmp>/config`、`<tmp>/cache`）のパス、解決済み package version、および本検証で生成された固有の `sessionId` / `callId` を記録する。
3. **検査 1-7（§6.1）** は、手順 1 の絶対パス経路と手順 2 の root specifier 経路の**両方**で満たされることを確認する。いずれかの経路で失敗した場合、その時点で Phase 2 は完了していない。検査 2〜4 は「.justice/ ディレクトリが存在する」「ファイルが生成されている」ことだけで合格とせず、**その経路固有の新規 sessionId / callId を持つレコードが実際に生成されたこと**を確認する。

### 6.1 確認する事実（すべて観測ベース）

| #   | 確認内容                                                                    | 確認方法                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `failed to load plugin` が発生しない                                        | OpenCode ログ                                                                                                                                                                         |
| 2   | `Justice initialized via opencode-adapter` が出力される                     | OpenCode ログ（`service=justice`）                                                                                                                                                    |
| 3   | `.justice/events/<agentId>/<sessionId>/<writerId>.jsonl` が実際に生成される | 任意のツール（例: `bash` で `bun run test`）を 1 回実行し、ファイルシステムを確認                                                                                                     |
| 4   | レコードが `ObservationRecord` schema を満たす                              | 生成された JSONL の内容確認（`kind`、`evidence`、redaction 適用、`sequence` 単調性）                                                                                                  |
| 5   | `justice_review` がツールとして呼び出せる                                   | セッション内から `scope` 未指定で実行し、レビュー要約が返ることを確認                                                                                                                 |
| 6   | `.justice/gate.yaml` 不在時に `DEFAULT_GATES` へ fail-open する             | `gate.yaml` を置かない状態で 7 を実施し、警告ログと DecisionRecord の `ruleResults` に既定 3 gate（`required-tests` / `build-green` / `review-clean`）が現れることを確認              |
| 7   | task 窓内で `task_complete` の DecisionRecord が生成される                  | `task()` を 1 回呼ぶ（`PreToolUse` が `callId` 単位の task 窓を開き、対応する `PostToolUse` で閉じる）。`.justice/events/` に `recordType: "decision"` レコードが生成されることを確認 |

### 6.2 完了条件

7 項目すべてを観測できた時点で Phase 2 完了とする。「ユニットテストが緑だから動作するはず」は**本 Phase では証拠として認めない** — それが今回の失敗の直接原因である。

### 6.3 失敗時の分岐

項目 1-2 が満たされるが 3 以降が満たされない場合、H1（ロードは成功するが観測経路が黙って失敗する）が確定する。この場合、fail-open で握り潰されている例外を特定するため、`ObservationLogStore.append()` / `ObservationHandler` / `SessionStateProvider` の各境界に一時的な診断ログを追加して原因を切り分ける。特定後に Phase 5 の診断 CLI の検査項目へ恒久的に反映する。

### 6.4 成果物

検証結果を `docs/reports/2026-07-31-v2-runtime-verification.md` に記録し、SPEC §15.12 から参照する。観測できた JSONL の抜粋（redaction 済み・秘密情報なし）を証跡として含める。

## 7. Phase 3 — `PluginOptions` 配線と C1 の実証

### 7.1 現状の問題

`enableAdvisoryOutputAppend` は `OpenCodeAdapterOptions` 経由でしか設定できないが、`src/opencode-plugin.ts` は `new OpenCodeAdapter(init)` をオプション無しで呼び出している。環境変数も設定経路も存在しないため、**本番で `true` にする手段が存在しない**。したがって SPEC §15.12 の C1（`output.output` への advisory 反映の実機検証）は、現状のコードでは物理的に実施不可能である。

### 7.2 設定経路の新設

OpenCode の型定義は既に対応している（`@opencode-ai/plugin` 1.14.21 / 1.18.4 で確認）。

```ts
export type PluginOptions = Record<string, unknown>;
export type Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;
export type Config = Omit<SDKConfig, "plugin"> & {
  plugin?: Array<string | [string, PluginOptions]>;
};
```

`src/opencode-plugin.ts` が第 2 引数 `options` を受け取り、既知キーのみを検証して `OpenCodeAdapterOptions` に渡す。

```jsonc
{
  "plugin": [["@yohi/justice", { "enableAdvisoryOutputAppend": true }]],
}
```

**検証方針:**

- 既知キーのみを読む。未知キーは無視する（前方互換）。
- 型不一致（例: `enableAdvisoryOutputAppend` に文字列）は既定値を採用し、**警告を戻り値に積む**。例外は投げない（fail-open）。
- 検証ロジックは純粋関数として `src/core/` に置き、`src/opencode-plugin.ts` は委譲のみを行う（不変条件1）。関数は正規化済み options と警告の**両方**を返す。

  ```ts
  export function validatePluginOptions(raw: unknown): {
    readonly options: ValidatedPluginOptions;
    readonly warnings: readonly string[];
  };
  ```

  `ValidatedPluginOptions` は `src/core/` 側で定義する。`OpenCodeAdapterOptions`（`src/runtime/`）を core から型 import すると不変条件1のアーキテクチャテスト（`tests/arch/core-no-opencode-imports.test.ts`）に触れるため、core の返り値を runtime 側で `OpenCodeAdapterOptions` へ写す。

- **警告の出力は runtime 境界の責務とする。** `src/core/` は `@opencode-ai/*` を import できない（不変条件1）ため、core から `init.client.app.log` を呼ぶことは構造的に不可能である。`src/opencode-plugin.ts` が返された `warnings` を受け取り、`init.client.app.log`（`service=justice`）へ出力する。**core 内で `console.warn` に逃げてはならない** — 不変条件1の骨抜きになり、かつ OpenCode のログ経路に乗らないため利用者から観測できない。
- **環境変数は追加しない。** 設定経路を OpenCode の `PluginOptions` 1 本に集約する。

### 7.3 C1 の実機検証

`enableAdvisoryOutputAppend: true` の状態で実機起動し、Gate が `WARN` を返す状況を意図的に作って、`output.output` 末尾に追記されたバナーが**モデルの推論文脈およびユーザー表示に実際に現れるか**を目視確認する。

**`WARN` を発生させる手順**（既定 gate はすべて `onMissingEvidence: warn` = trust-first であることを利用する）:

1. `.justice/gate.yaml` を置かない（既定 3 gate が適用される）。
2. テストもビルドも実行しないまま `task()` を 1 回呼んで完了させる。
3. `required-tests` （test outcome の Evidence 不在）と `build-green`（build outcome の Evidence 不在）が `onMissingEvidence` により `WARN` を返し、`task_complete` トリガで DecisionRecord が生成される。
4. このとき advisory が `JusticeNotifier`（保証チャネル）と `output.output` 末尾（best-effort チャネル）の両方に送出されるので、**後者の可視性を前者と対比して判定できる**。

判定には `FAIL` を待つ必要はない。C1 が問うのは advisory の**表示面が届くか**であり、verdict の重さではない。

判定と対応:

| 観測結果                                     | C1 判定                               | 対応                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| バナーがユーザー表示・推論文脈の双方に現れる | `C1 passed`                           | 既定値 `true` 化を検討する。判断根拠を SPEC §15.12 に記録する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 一方にのみ現れる                             | `C1 partial`                          | 現れる側を保証チャネルとして記録し、既定値は `false` 据置。条件付き有効化の指針を README に記載する。`C1 passed` は両表示面が確認できた場合のみ使用する。                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| いずれにも現れない                           | `C1 observed-negative`（修正完了までは `Fix Pending`） | 既定値は `false` 据置とするが、これを最終状態としては**扱わない**。`output.output` 追記経路が機能していないとみなし、以下を実施する。<br>1. 既存の `enableAdvisoryOutputAppend` オプションを非推奨化し、README / SPEC に「保証チャネルは `JusticeNotifier` のみ」と明記する。<br>2. 切替不可能な場合、`OpenCodeAdapter` から `output.output` 追記ロジックを削除し、コードとドキュメントで機能不在を一致させる。<br>3. 修正後は C1 検証を再度実施し、`C1 passed` または `C1 observed-negative` を再判定する。修正後の再検証が完了するまでは SPEC §15.12 の C1 状態を「**実装修正待ち（Fix Pending）**」として更新する。 |

いずれの分岐でも「活動が未実施（Not Verified）」ではなくなるが、`C1 partial` / `C1 observed-negative` / `Fix Pending` はいずれも合格ではない。これらの非合格状態では **Phase 3 を完了・出荷完了として記録できない**。`C1 passed` は両表示面（ユーザー表示・推論文脈）に advisory が届いた場合にのみ使用し、それ以外の状態で README / SPEC の「未完了」表記を削除してはならない。

## 8. Phase 4 — 書込レイテンシの再計測と方針確定

### 8.1 現状

- Phase 0 スパイクの実測値は p95=142.1ms / p99=339.6ms（同一 shard へ 100 回連続 append、2026-07-08 実施）。計画目標「p95 < 数 ms / tool 呼び出し」に対し大幅未達。
- その後 `write-queue.ts` に path 単位の `contents` インメモリキャッシュが追加され、2 回目以降の `readExisting()` はスキップされる。
- ただし `atomicAppend` は依然として**累積コンテンツ全文を temp ファイルへ書込 → rename** しており、**O(shard size) の書込コストが残存**している。
- **現行経路（キャッシュ導入後）は再計測されていない。**
- 既存スクリプト `spikes/observation-latency/measure.ts` は「Phase 4（observation-handler）が存在しないため永続化プリミティブ単体を測っている」と自ら明記しており、hook 経路 end-to-end を測っていない。

### 8.2 計測設計

`spikes/observation-latency/measure.ts` を拡張し、`ObservationHandler` 経由の hook 経路 end-to-end を測る。

- 実 FS（`NodeFileSystem`）を使用する。モックでは書込コストが測れない。
- shard サイズを 0 → 5MB まで段階的に変化させ、O(shard size) の効き方を確認する（rotation 閾値の直前まで）。
- 同一 shard への連続 append と、複数 shard への並行 append の両方を測る。
- p50 / p95 / p99 を記録する。

**固定計測プロトコル**: 再現性を持たせるため、以下を事前に確定する。

1. **測定対象経路**: `ObservationHandler.handlePostToolUse()` を呼び出す hook 経路 end-to-end とする。`spikes/observation-latency/measure.ts` のような `ObservationLogStore.append()` 直接呼出は primitive 参考値として位置づけ、本 Phase 4 の判定には使用しない。
2. **固定 workload**: `handlePostToolUse()` へ渡す入力を以下で固定する。
   - `toolName`: `"bash"`
   - `toolInput`: `{ "command": "bun run test" }`
   - `toolResult`: `"1 passed"`
   - これらから生成される `ObservationRecord` の JSON シリアライズ後サイズは約 400 B（±50 B）を目標とし、実測値はレポートに記載する。
3. **サンプル数・反復回数**: 各条件ごとに warm-up 5 回を廃棄し、計測対象 100 回の append を連続実行する。warm-up 前の shard は空または事前投入済みのいずれかを明記する。
4. **shard 事前投入**: 各サイズ条件で shard サイズを `0 B` / `1 KB` / `100 KB` / `1 MB` / `5 MB` に揃える。事前投入は複数回 `atomicAppend` を発行し、warm-up 前に完了させる。
5. **同一 shard 条件**: 単一 writerId、単一 JSONL ファイルへの連続 append。事前投入により `contents` キャッシュを温め、計測中は 1 回目の append でもキャッシュヒットする状態を作る。キャッシュ未ヒット状態を別条件として追加計測する。
6. **複数 shard 条件**: writerId 毎に別 JSONL ファイルを持つ 4 つの writer を並行（`Promise.all` 単位）で同一ディレクトリに append させる。**100 回の反復は writer ごとに適用し、合計サンプル数は 400（4 writer × 100 回）とする**。`Promise.all` 1 回あたりの 4 件の個別 append を 1 サイクルとし、100 サイクル計測する。各 writer の shard サイズは同一とする。
7. **実行環境の固定**: Bun ランタイム（OpenCode と同じ）、`NodeFileSystem`、ローカルファイルシステム（tmpfs ではなく実ディスク）。OS、Bun バージョン、ファイルシステム種別を計測レポートに記録する。
8. **percentile 集計**: Nearest-rank method（`ceil(p/100 * n)`）で p50 / p95 / p99 を算出する。生サンプルも昇順ソート済みで保存する。
9. **レポート保存**: 各条件の raw samples（ミリ秒、double 精度）、実行環境情報、測定日時を `docs/reports/2026-07-31-v2-latency-measurement.json` に保存する。可視化のためヒストグラム区間も 10ms 刻みで保存する。

### 8.3 判定基準（事前固定）

**後出しの判断を避けるため、実測前に閾値を確定する。**

| 実測 p95           | 判断         | 対応                                                                                                    |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------- |
| < 5ms              | 許容         | SPEC を「再計測済み・目標達成」に更新して完了                                                           |
| 5ms 以上 50ms 未満 | 条件付き許容 | SPEC に実測値、計測条件（§8.2 固定プロトコル）、shard サイズ依存性を明記し、改善は v2.5 の Issue に登録 |
| 50ms 以上          | 要改善       | 本設計のスコープで改善実装（§8.4）                                                                      |

### 8.4 改善方針（p95 ≥ 50ms の場合のみ）

第一候補は **追記専用 append（O(1)）への切替**である。現行の「全文 temp 書込 + rename」は、1 レコード追記に対して shard 全体を書き直すため、shard 成長に比例してコストが増える。

- 通常の append は、§8.4.1 の前提条件 1〜6 および直前の設計レビューゲートが**すべて満たされた後**に追記専用 I/O（O(1)）に切り替える。満たされるまでは temp + rename を維持する。
- atomicity の担保は「レコード単位の行境界保証 + 読取時の整合性検証」に委ねる。**ただし現行の `readAll()` の検証だけでは破損を防げないため、§8.4.1 の前提条件をすべて満たすまで切替を実施しない。**
- temp + rename は **rotation 時のみならず、前提未達時の通常 append のフォールバックとしても**維持する。
- JSON-only persistence（不変条件4）は維持する。外部 DB は導入しない。
- fail-open（不変条件2）は維持する。

この方針変更は不変条件4の解釈に影響するため、実装前に設計レビュー（Oracle 相談を想定）を経る。**p95 < 50ms の場合は本節を実施しない。**

#### 8.4.1 切替の前提条件（すべて必須）

追記専用 I/O は、以下を設計・実装・テストで満たすことを**切替の前提条件**とする。1 つでも欠ける場合は現行の temp + rename を維持する。

1. **末尾不完全レコードの扱いを定義する。** 現行の `readAll()` は 1 行でもパース／検証に失敗すると `fileCorrupted` として **その shard 全体を結果から除外する**（`src/runtime/observation-log-store.ts` の `ingest()` と `invalidPhysicalShardKeys`）。したがって append 中のクラッシュで最終行が途中まで書かれただけで、**その shard の全レコードが読めなくなる**。切替に先立ち、`readAll()` に以下の緩和を実装する：**最終行が EOF で JSON の途中までしか書かれていない場合に限り**、当該 1 行を破棄して残りを有効として扱い、`hasIntegrityViolation` は立てるが shard は除外しない。完全だが内容不正な最終レコードは現行どおり shard 除外として扱う。改行なしで終わる有効な最終レコードは正常に読み取る。判定できない parse failure は救済せず、temp + rename を維持する。中間行の破損は現行どおり shard 除外を維持する（切り捨て以外の破損を救済してはならない）。
2. **クラッシュ復旧手順を定義する。** 復旧は上記の読取側緩和のみで完結させ、起動時リカバリ処理や別ファイルのジャーナルは導入しない（不変条件4）。切り捨てが `validateShardSequences` の gap 検出に触れないことを設計に明記する — `allocateWriterId` は物理パスが存在しない候補のみを採番するため、切り捨てられたファイルが再 append されることはなく、破棄した最終 1 行の sequence が欠番として残る経路は存在しない。この前提はテストで固定する。

   writerId は **セッション（プロセス）単位で新規採番**する。`allocateWriterId()` が「物理パスが存在しない候補のみ採番」するのは、新規 shard 作成時の偶然の衝突を避けるためであり、クラッシュ後の同 writerId 再利用を認める根拠ではない。`JusticePluginOptions` への `writerId` 上書き指定はテスト・デバッグ以外では使用せず、使用する場合は当該物理パスが既存の場合、前回 shard を開いて継続するのではなく、明示的に新規 writerId を再採番するか、手動でアーカイブを完了させてから指定する。現行の `computeInitialSequence()` は同一プロセス内の rotation 継続を想定しており、**クラッシュ後の同 writerId 再利用による復旧はサポートしない**。
3. **耐久性（fsync）の方針を明記する。** 追記後に fsync するか否か、しない場合に失われ得る範囲（直近 N レコード）を設計に記載する。観測ログは advisory であるため fsync 無しを選ぶことは許容されるが、**選択と理由を明示せず暗黙にしてはならない。**

   ここで「失われ得る範囲」は、原子性の単位である 1 レコードを超えないことを目標とする。`atomicAppend` は temp ファイルへの書込と rename でレコード単位の整合性を担保するが、rename 後のディレクトリメタデータを fsync しないため、OS クラッシュ時に直近 1 レコードが失われる可能性がある。観測ログは L0 advisory なのでこの範囲の損失は許容するが、DecisionRecord（特に `task_complete` による Gate 評価結果）はその直前の `observed` evidence に基づく。evidence append から DecisionRecord append までにクラッシュすると、verdict の根拠が監査不能になるため、**DecisionRecord 生成前には対応する evidence が少なくとも同一プロセス内で永続化されたことを前提とする**。復旧後、`readAll()` は不完全 shard を fail-open で除外するため、失われた evidence に基づく DecisionRecord は再評価されず、当該 shard の後続レコードのみが Gate 評価の対象となる。
4. **`FileWriter` の拡張を伴うことを明記する。** 現行の `FileWriter`（`src/core/types.ts`）は `writeFile` / `rename` / `deleteFile` のみで append プリミティブを持たない。追記専用 I/O は公開インターフェースの拡張と `tests/helpers/mock-file-system.ts` の追随を必要とする。
5. **末尾切断からの復旧テストを追加する。** 実 FS 上で以下の 3 ケースを検証する。
   - **EOF 切断**: 有効レコード群の直後に JSON が途中まで書かれた最終行を持つ shard を作成し、`readAll()` が有効レコード群を返し shard を除外しないこと。
   - **不正な完全 JSON**: 最終行が構文的に完全だが schema 違反（例: `sequence` 欠如）である shard を作成し、`readAll()` が当該 shard 全体を除外すること。
   - **改行なしの有効レコード**: 最終レコードが改行無しで終わる有効 JSONL を作成し、`readAll()` が当該レコードを正常に読み取ること。
   - **append 直前の crash と復旧**: 実 FS 上で有効レコード群の直後に `atomicAppend` の temp ファイルが残存する状態を作り、プロセス再起動後に `readAll()` が有効レコード群を返し、破損した temp ファイルや不完全な行を結果に含めないことを検証する。`NodeFileSystem` 上で一時ディレクトリを用い、OS レベルの fsync 有無には依存しない（Justice の fsync 方針をテストで固定するため）。
6. **writerId のプロセス間衝突防止を確立する。** `allocateWriterId()` は現在「物理パスが存在しない候補を採番」するのみで、独立プロセス間での原子性を持たない。追記専用 I/O に切り替える前は、sequence allocation 全体（読取・更新・永続化）をプロセス間ロックの対象に含めるか、以下のいずれかを満たすこと。(a) `JusticePluginOptions` への明示的な `writerId` 指定を禁止する。(b) `allocateWriterId()` を原子的な予約・重複検出に変更する。(c) `append` と `rotation` の両方に加えて **sequence allocation 全体**にプロセス間ロックを適用する。`writerId` を予約方式で採用する場合は、予約済み `writerId` の明示的な重複を禁止する。同一 `agentId` / `sessionId` / `writerId` を使う独立プロセスの衝突テストを追加し、レコード欠落・JSONL 破損・**sequence 重複**が発生しないことを検証する。
**単一 writer の不変条件は、上記 1-6 の前提が満たされた場合にのみ成立する。** それまでは、`writerId = "w-" + crypto.randomUUID()` はプロセス内で一意に採番されるが、プロセス間での重複は `allocateWriterId()` の `fileExists` ベストエフォート・プローブだけでは防止できない。したがって本節では上記 6 の実装と検証を完了させ、それに基づいて単一 writer 不変条件を再確立する。`allocateWriterId` は物理パスが存在しない候補のみを採番するため、切り捨てられたファイルが再 append されることはなく、破棄した最終 1 行の sequence が欠番として残る経路は存在しない。この前提はテストで固定する。

**同一 writerId での再起動テスト**: テスト目的で `writerId` を固定し、shard にレコードを append した直後にプロセスを再起動する。再起動後に同じ `writerId` を使おうとした場合、既存 shard を開いて append せず、新規 writerId を採番する（または `ObservationLogStore.append()` が writerId 不一致で拒否する）動作を確認する。sequence gap、重複、JSONL 破損が発生しないことを検証する。

**通常の append でも temp + rename を維持する案は、§8.4.1 の前提条件 1〜6 および設計レビューゲートが満たされるまでは採用する。** 前提が満たされた後は O(1) の追記専用 I/O に切り替え、temp + rename は rotation 時のみに縮退させる。前提未達時に通常 append から temp + rename を外すと、shard 成長に伴うコスト増と破損リスクが残るため、フォールバックとして維持する。

## 9. Phase 5 — 診断手段の2層構成

今回の事故で最も深刻なのは「**Justice が動いていないことを誰も気づけなかった**」点である。ここには原理的な制約がある — プラグインのロード自体が失敗する場合、Justice のコードは 1 行も実行されないため、**Justice 自身からは警告を出せない**。したがって診断は 2 層に分ける。

### 9.1 層1 — 診断 CLI（`justice doctor`）

OpenCode の外から実行する。`package.json` に `bin` エントリを追加する。**これがロード失敗を検知できる唯一の経路である。**

検査項目:

| #   | 検査                                                                                                     | 出力                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | OpenCode 設定ファイル群（グローバル / プロジェクト）を探索し、`plugin` 配列から justice specifier を抽出 | 検出した設定ファイルパスと specifier                                                                                                                                      |
| 2   | specifier を §9.1.1 の規則で解決し、解決先モジュールを import してローダ契約（FF-009 と同一判定）を適用  | 解決結果（解決後バージョン、キャッシュ内の実体パス、パッケージ成果物）、現在のビルド成果物（`dist/`）との一致結果、および契約違反時は違反した export 名と修正手順（§9.2） |
| 3   | OpenCode ログを走査し `failed to load plugin` / `Justice initialized` の有無を報告                       | 直近の該当行と発生回数                                                                                                                                                    |
| 4   | 対象プロジェクトの `.justice/` の有無、`events` の shard 数・レコード数・最終書込時刻                    | サマリ表                                                                                                                                                                  |
| 5   | `.justice/gate.yaml` の妥当性（存在する場合）                                                            | `GateLoader` の検証結果                                                                                                                                                   |

#### 9.1.0 設定探索・解析仕様

検査 1 は OpenCode の実形式に合わせて以下の仕様を満たす。

- **対象ファイルとマージ**: OpenCode と同じ優先順位で以下の設定ソースを読み込み、`plugin` 配列をマージしたうえで `@yohi/justice` 系 specifier を抽出する。最初に見つかった 1 ファイルだけで判定してはならない。
  1. **remote config**: 組織・リモート管理設定（OpenCode 管理画面等）
  2. **global config**: `~/.config/opencode/config.json`（旧形式） / `~/.config/opencode/opencode.json` / `~/.config/opencode/opencode.jsonc`
  3. **`OPENCODE_CONFIG` 環境変数**: 単一の設定ファイルパスを指す
  4. **project config**: カレントディレクトリから Git worktree まで親方向に探索した `opencode.json` / `opencode.jsonc`
  5. **`.opencode` directory config**: `.opencode/opencode.json` / `.opencode/opencode.jsonc`
  6. **`OPENCODE_CONFIG_DIR` 環境変数**: 指定ディレクトリ内の設定ファイル群
  7. **`OPENCODE_CONFIG_CONTENT` 環境変数**: インライン JSONC コンテンツ
  8. **managed config / managed preferences**: OpenCode 管理設定
- **優先順位と重複除去**: 上記の昇順（低→高）とし、後から読まれた高優先度側が競合キーで上書きする。`plugin` 配列を統合する際は、同一 npm パッケージ名または同一ローカルファイルパスは高優先度側で重複除去し、異なる plugin は優先順位に関わらず保持する。
- **パース**: JSONC（コメント `//` / `/* */` および末尾カンマを許容）としてパースする。壊れた JSONC は `parse_error` として検査結果に記録し、CLI は例外で落ちない。
- **`plugin` フィールドの検出と抽出**: `plugin` フィールドが存在しない場合は `plugin_missing` を記録する。存在する場合、**値が配列であることを最初に検証**し、配列でない場合は `plugin_not_array`（または `invalid_plugin_field`）として記録して例外を投げずに処理を継続する。配列の各エントリを走査し、以下の形式から `@yohi/justice` 系の specifier を抽出する。
  - 文字列エントリ: `"@yohi/justice"`、`"@yohi/justice@3.0.0"`、`"@yohi/justice/opencode"` 等。
  - tuple エントリ: `[string, PluginOptions]` 形式。**第 1 要素が `@yohi/justice` 系の文字列であり、かつ第 2 要素が有効な `PluginOptions`（`Record<string, unknown>`）である場合のみ** specifier として採用する。採用時は第 2 要素の生データを出力せず、`optionsPresent: true` または allowlisted なオプションキー名の集合に置き換えてから診断出力に含める。値を残す必要がある場合は `SecretPatternDetector` による明示的 redaction を適用する。
  - 上記以外の形式（`null`、`number`、長さ 3 以上の配列等）、または tuple の第 1 要素が文字列でない場合、または tuple の第 2 要素が `PluginOptions` として妥当でない場合は、いずれも `invalid_plugin_entry` として検査結果に記録する。該当エントリからは specifier を抽出しない。
- **対応戦略**: 抽出した specifier は §9.1.1 の解決規則に従って解決する。抽出できなかった場合は `justice_not_found_in_config` として報告する。

- **未対応ソースの診断**: `OPENCODE_CONFIG_CONTENT` や managed config / managed preferences 等、doctor がまだ読み込めない設定ソースに `@yohi/justice` 系の `plugin` エントリが存在する場合、`justice_not_found_in_config` ではなく `unsupported_config_source` を報告する。出力には未対応ソース名、当該ソースで検出された specifier の有無（options は allowlisted キーのみ）、および手動確認を促すメッセージを含める。
- **fixture とテスト**: `tests/core/justice-doctor-config.test.ts`（新設）に以下の fixture を追加する。
  - コメント・末尾カンマを含む有効な JSONC から string / tuple 両方の specifier を検出する。
  - 壊れた JSONC を受け取り `parse_error` として扱う。
  - `plugin` 配列に無効エントリ（`null`、数値、配列長 3、非文字列第 1 要素の tuple、第 2 要素が非オブジェクトの tuple）、ならびに `plugin` フィールド自体が配列でない設定を受け取り、それぞれ `invalid_plugin_entry` / `plugin_not_array` として扱いつつ有効なエントリからは specifier を抽出する。
  - **グローバル設定のみ `~/.config/opencode/opencode.json`（plain JSON）に Justice がある場合**も検出できる fixture を追加する。
  - グローバル設定のみ・プロジェクト設定のみ・両方に Justice がある場合・両方に異なる Justice エントリがあって競合する場合の 4 パターンを網羅する。競合時は OpenCode のマージルールに従い、優先順位の高い側の値を採用して報告する。
  - 設定マージ後に `plugin` 配列が空・未指定の場合は `justice_not_found_in_config` として報告する。
  - `OPENCODE_CONFIG` で指定されたファイルに Justice がある場合
  - `OPENCODE_CONFIG_DIR` 配下に Justice がある場合
  - `OPENCODE_CONFIG_CONTENT` に Justice がある場合
  - global に `@yohi/justice@2.7.0`、`.opencode` に `@yohi/justice@3.0.0` があり、`.opencode` 側が優先される場合
  - 未対応ソース（`OPENCODE_CONFIG_CONTENT` 等）に plugin があり、`unsupported_config_source` が報告される場合

#### 9.1.1 specifier 解決の規則

**素朴な `import(specifier)` は使えない。** 実機の設定に登録されている specifier は `"@yohi/justice@2.7.0"`（バージョン付き）であり、これは有効な import specifier ではない。実測:

```text
$ bun -e 'import("@yohi/justice@2.7.0")'
Cannot find module '@yohi/justice@2.7.0'
```

診断 CLI がここで誤診すると、**ロード失敗を検知できる唯一の経路（§9.1）そのものが機能しなくなる** — 今回の事故と同型の false negative を生む。したがって解決手順を Justice 側の明示仕様として定義する。

| 種別                     | specifier 例                               | 解決先                                                                            |
| ------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------- |
| root                     | `@yohi/justice`                            | パッケージキャッシュ内の該当バージョン → `exports["."]`                           |
| サブパス                 | `@yohi/justice/opencode`                   | 同上 → `exports["./opencode"]`                                                    |
| バージョン付き（legacy） | `@yohi/justice@2.7.0`                      | 名前とバージョンに分解し、当該バージョンのキャッシュディレクトリ → `exports["."]` |
| 絶対パス                 | `/path/to/justice/dist/opencode-plugin.js` | パスをそのまま解決（`exports` を経由しない）                                      |

- **正規化**: specifier を `{ name, version?, subpath? }` に分解する。スコープ付きパッケージ名の先頭 `@` とバージョン区切りの `@` を区別する（`@yohi/justice@2.7.0` → name=`@yohi/justice` / version=`2.7.0`）。
- **キャッシュ配置**: OpenCode はバージョン付きパッケージを `<cacheRoot>/packages/<name>@<version>/node_modules/<name>/` に配置する（`cacheRoot` は `~/.cache/opencode`、環境により `$XDG_CACHE_HOME` 配下。実測確認済み）。診断 CLI はこのレイアウトを再現して実体を特定する。
- **複数バージョン並存**: 実測環境では `@yohi/justice@2.4.0` / `2.5.0` / `2.7.0` が同時に存在した。バージョン付き specifier は完全一致で選ぶ。バージョン無し specifier は複数候補が存在し得るため、**候補一覧を出力して曖昧性を利用者に提示する（黙って 1 つを選ばない）。**
- **解決不能時**: 「specifier が解決できない」ことを検査結果として出力する（例外で落とさない）。パッケージ未インストール・キャッシュ不在は、ローダ契約違反とは**別種の失敗**として区別して報告する。
- **契約適用**: 解決したモジュールに対して FF-009 と**同一の判定ロジック**（§5.4 の検証 1・2・4）を適用する。判定ロジックは純粋関数として `src/core/` に置き、FF-009 のテストと診断 CLI の双方から共有する（実装の二重化を避ける）。
- **OpenCode 内部実装への依存範囲**: 本規則は OpenCode ローダの**観測された振る舞い**（キャッシュレイアウトと specifier 形式）に基づく仕様であり、非公開実装の複製ではない。OpenCode 側の変更で乖離し得るため、検査 3（ログ走査）の結果と矛盾した場合は本規則を見直す旨を出力に含める。
- **fixtures とテスト**: 上記 4 種別それぞれについて、以下の 2 段階で検証する。
  1. **モック FS 単体テスト**: モック FS 上にキャッシュレイアウトと `package.json` を再現した fixture を用意し、解決結果と契約判定の両方を検証する。実ディスクへはアクセスしない（§12）。
  2. **実モジュール統合テスト**: 一時 package cache fixture（`~/.cache/opencode/packages/@yohi/justice@<version>/node_modules/@yohi/justice/` 相当のディレクトリツリーを実ディスク上に構築）および absolute path fixture（`dist/opencode-plugin.js` への絶対パス）を用意し、`justice doctor` の診断 CLI resolver を実際に実行する。root / サブパス / バージョン付き / 絶対パス の各経路で、OpenCode/Bun 版で実行可能な `import()` またはファイル読込を用いて versioned cache 選択と absolute path import を確認し、§5.4 の FF-009 と同一の契約判定を適用する。対象の OpenCode/Bun 版で実行可能な方法（`bun run` 経由の self-reference import または絶対パス `import()`）を仕様に明記する。

### 9.2 診断 CLI の出力例（検査 2 が違反を検出した場合）

今回の事故を検出した際に出すべき出力を、実装の受け入れ基準として確定させる。

```text
✗ plugin エントリが OpenCode のローダ契約を満たしていません

  設定ファイル : <検出した設定ファイルのパス>
  specifier    : @yohi/justice@2.7.0
  解決先         : <package>/dist/index.js

  原因: OpenCode はモジュールの全 export が関数または { server: 関数 } であることを
        要求しますが、以下 8 件の export が非関数です:
          AGENT_IDS, DEFAULT_PERSONA, DEFAULT_RETRY_POLICY, JUSTICE_START_COMMAND,
          LOOP_ERROR_PATTERNS, PersonaClassifier, REVIEW_REJECTION_PATTERNS,
          WORKFLOW_START_FALLBACK_MARKER
        このため Justice は一行も実行されていません（v1 / v2 とも未稼働）。

  修正: @yohi/justice を 3.0.0 以上に更新してください。
          opencode plugin @yohi/justice
        更新できない場合は specifier を plugin 専用サブパスに変更してください:
          "plugin": ["@yohi/justice/opencode"]
```

出力に含めるファイルパスは、既存の絶対パス redaction と `SecretPatternDetector` を適用した上で出力する。

設計上の配置:

- 設定パース・ローダ契約判定・ログ解析は**純粋関数**として `src/core/` に置く（不変条件1）。
- ファイル探索・ログ読取・プロセス終了コードは `src/runtime/` に置く。
- **不変条件2 の唯一の例外**として、検査失敗時に非ゼロ終了コードを返す。CLI はプラグイン本体ではなくセッションを落とさないため、この例外は安全である。この例外は AGENTS.md および SPEC に明記する。
- 秘密情報の出力禁止を厳守する。設定ファイルの内容やログ行を出力する際は既存の `SecretPatternDetector` と絶対パス redaction を適用する。

### 9.3 層2 — `justice_review` への health 統合

**公開ツールは `justice_review` のみを維持する（不変条件5）。** `justice_status` を公開ツールに昇格させることはしない。

`justice_review` の view 出力に `health` セクションを追加する。

| フィールド                     | 出所                                         |
| ------------------------------ | -------------------------------------------- |
| observation log のレコード件数 | `ObservationLogStore.readAll()` の件数       |
| shard 数                       | 同上の shard 集合サイズ                      |
| 最終書込時刻                   | `ObservationLogStore` が管理する `lastSuccessfulWriteAt` |
| rotation health                | `ObservationLogStore.getRotationHealth()`    |
| read integrity                 | `ObservationLogStore.getLastReadIntegrity()` |

`lastSuccessfulWriteAt` は `ObservationLogStore.append()` が成功した直後に更新する。`append()` の完了時刻を正確に取得できない実装の場合、本フィールド名を `latestRecordTimestamp` に変更し、最新レコードの `timestamp` を出所とする。

制約:

- `resolve` の挙動、および `TRUSTED_REVIEW_RESOLUTION_ARTIFACT_TOOLS` による信頼境界は**一切変更しない**。
- `health` の取得は fail-open とし、取得失敗時は当該フィールドを省略して view 本体を返す。
- `justice_review` 自身の実行は `onToolExecuteAfter` の `justice_` プレフィックス除外により canonical な Observation Log を汚染しない（D50 の維持）。

## 10. Phase 6 — ADR 承認要件の改訂とドキュメント整合

### 10.1 ADR の改訂

`docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md` は現在 `PENDING HUMAN CODEOWNERS RATIFICATION` であり、「本 ADR に対する明示的な human CODEOWNERS の `APPROVED` レビューを取得すること」を要求している。

しかし調査により、この要件は**構造的に達成不可能**であることが判明した。

- `.github/CODEOWNERS` は `* @yohi` であり、リポジトリのコラボレーターは `@yohi` 単独（admin）である。
- したがって ADR が要求する human CODEOWNERS は `@yohi` 本人である。
- GitHub は**自身が作成した PR に対する自己 `APPROVED` レビューを構造的に禁止**している。
- ADR 自身の記録によれば、PR #116 の `reviewDecision=APPROVED` は bot レビュー（`coderabbitai`）由来であり、`@yohi` のレビューはすべて `COMMENTED` であった。

改訂内容:

1. 上記の構造的制約を事実として本文に明記する。
2. ratification の証跡形式を「**CODEOWNER 本人による、日付・対象・根拠を明記した ADR への ratification コミット**」と再定義する。
3. `Status` を `APPROVED` に更新する。ratification コミット自体が証跡となる。
4. **これは要件の抹消ではなく、達成可能な形への再定義である**旨を本文に残す。ADR が何を承認対象としているか（ADR 本文 Context の Charter 逸脈 5 項目：hook bindings / storage paths / exit code degraded verdict / artifact authorship reduction / declared evidence limitation）は一切変更しない。

### 10.2 SPEC.md の改訂

§15.12「既知の未解決事項・ガバナンス状況」を全面改訂する。

- 「v2.0 はコード実装済み・ガバナンス未完了」という**誤った前提を訂正**し、**プラグインが一度もロードされていなかった事実と §2 の一次証拠を記録**する。
- C1 の項目を Phase 3 の実証結果で置換する。
- レイテンシの項目を Phase 4 の再計測結果と確定した方針で置換する。
- ADR の項目を Phase 6 の改訂結果で置換する。
- Fitness Functions 表（§15.10）に **FF-009**（配布エントリのローダ契約）を追加する。
- §15.9 に `justice_review` の `health` セクションを追記する。

### 10.3 README.md の改訂

- **パターン1（推奨）の手順を修正する。** Phase 1 完了後は `opencode plugin @yohi/justice` が正しく動作するため手順自体は維持できるが、3.0.0 未満では root specifier が壊れていた事実と、最低バージョン要件を明記する。
- ライブラリ利用者向けの `@yohi/justice/core` 移行表を追加する。
- 診断 CLI（`justice doctor`）の使い方を追加する。
- `PluginOptions` による設定方法（`enableAdvisoryOutputAppend`）を追加する。
- プロジェクト・ステータス表の Phase 10 を実証結果に基づいて更新する。
- **「未完了」注記（§15.12 参照の NOTE および ※1）は Phase 2〜6 がすべて完了した時点で削除する。前倒しで削除しない。**

## 11. スコープ外の既知課題

### 11.1 Node ESM 非互換（別 Issue に切り出し）

publish 済み `dist` の相対 import に拡張子が付いていない。

```js
// dist/opencode-plugin.js
import { OpenCodeAdapter } from "./runtime/opencode-adapter"; // 拡張子なし
```

`package.json` は `"type": "module"` を宣言しているため、これは**正当な Node ESM ではない**。実測結果:

| ランタイム | 結果                                                                                   |
| ---------- | -------------------------------------------------------------------------------------- |
| Node       | **失敗** — `ERR_MODULE_NOT_FOUND: Cannot find module '.../dist/core/error-classifier'` |
| Bun        | 成功（`typeof default === "function"`）                                                |

原因は `tsconfig.json` の `"moduleResolution": "bundler"` であり、`tsc` はソースの拡張子なし import をそのまま出力する。OpenCode は Bun 上で動作するため実害は発生していないが、`main` / `module` / `exports` が主張する契約に違反している。

修正には `moduleResolution` の変更とソース全体（80 ファイル超 + テスト）の import 書き換えが必要で規模が大きいため、本設計から分離して別 Issue とする。**リスクとして記録する** — 将来 OpenCode が Node ベースのローダを採用した場合、または Node 環境からライブラリとして利用された場合に顕在化する。

### 11.2 プラグイン API バージョンドリフト

開発時の `@opencode-ai/plugin` は 1.14.21、実機ランタイムは 1.18.4 である。1.18.4 には `dist/v2/promise/` 系（`registration.d.ts` 等）が存在し、開発時の依存には無い。本設計で使用する `PluginInput` / `Plugin` / `Config` / `PluginModule` / `Hooks` の各型は両バージョンで一致していることを確認済みだが、依存バージョンの追随は別途検討する。

## 12. テスト戦略

| 対象                         | 種別                 | 方針                                                                                                                                                        |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PluginOptions` 検証ロジック | ユニット             | 純粋関数として `src/core/` に置き、既知キー / 未知キー / 型不一致 / 未指定の各ケースを検証                                                                  |
| 診断 CLI の純粋ロジック      | ユニット             | 設定パース・ローダ契約判定・ログ解析を `tests/helpers/mock-file-system.ts` で検証。実ディスクにアクセスしない                                               |
| 診断 CLI の I/O 境界         | ユニット             | モック FS + モック notifier。終了コードの分岐を検証                                                                                                         |
| `justice_review` の health   | ユニット             | `ObservationLogStore` をモックし、health 取得失敗時に view 本体が返ることを検証                                                                             |
| 配布エントリのローダ契約     | 統合（FF-009）       | ビルド後 `dist` を **self-reference specifier 経由**で対象とする（パス直 import は禁止）。`tests/dist/` に配置し、`bun run test:dist`（ビルドを内包）で実行 |
| Phase 2 / Phase 3 の実機動作 | 手動検証             | 検証レポートを `docs/reports/` に記録し SPEC から参照                                                                                                       |
| Phase 4 のレイテンシ         | 計測スクリプト       | `spikes/observation-latency/measure.ts` を拡張。CI では実行しない                                                                                           |
| 診断 CLI の specifier 解決   | 統合 + ユニット（§9.1.1） | root / サブパス / バージョン付き / 絶対パスの 4 種別の解決ロジックはモック FS で単体テストする。実行時検証では、配布エントリの FF-009 と同様に Bun 上で self-reference specifier 経由で実モジュールを import し、loader 契約判定を診断 CLI の解決経路でも適用する。モック FS は解決ロジックの単体テストに限定する。 |
| 実モジュール経路のローダ契約 | 統合                 | §9.1.1 の 4 種別（root / サブパス / バージョン付き / 絶対パス）を、一時 package cache fixture および absolute path fixture 経由で実モジュール import し、`justice doctor` resolver と FF-009 が同一の契約判定を返すことを検証。`bun run test:integration` で実行する。                                                                                                                                                                               |
| 追記専用 I/O の末尾切断復旧  | 統合（§8.4.1-5）     | 実 FS 上で EOF 切断・不正な完全 JSON・改行なし有効レコードの 3 ケースを検証し、`readAll()` が EOF 切断のみ救済し、他は shard 除外として扱うことを確認。追記専用 I/O へ切替える場合のみ実施。`bun run test:integration`（仮称）で実行する。                                                                                                                                                                              |

既存テストスイートは全て緑を維持する。テストにおける private フィールド参照は `unknown` 経由のキャストを用い、`any` は使用しない。

## 13. 完了条件

以下のすべてを満たした時点で「v2.0 出荷完了」を宣言できる。

1. Phase 1 完了 — `exports` 再構成が済み、FF-009（`bun run test:dist`）が緑である。
2. Phase 2 完了 — §6.1 の 7 項目すべてが実機で観測され、検証レポートが記録されている。
3. Phase 3 完了 — `PluginOptions` が配線され、C1 の実機検証が **`C1 passed`** に到達し、`enableAdvisoryOutputAppend` の既定値が確定・記録されている。`C1 partial` / `C1 observed-negative` / `Fix Pending` のいずれかの場合は Phase 3 は未完了とする。
4. Phase 4 完了 — hook 経路 end-to-end のレイテンシが再計測され、§8.3 の判定基準に従って方針が確定・記録されている。追記専用 I/O へ切替える場合は §8.4.1 の前提条件をすべて満たしている。
5. Phase 5 完了 — 診断 CLI が動作し、`justice_review` に health が統合されている。
6. Phase 6 完了 — ADR が `APPROVED` であり、SPEC §15.12 と README が実証結果と整合している。
7. `bun run typecheck` / `bun run lint` / `bun run test` / `bun run build` / `bun run test:dist` / **`bun run test:integration`** がすべて成功する（`test:dist` / `test:integration` はビルド成果物・実 FS を対象とするため、ビルド後に実行する）。

**7 項目すべてが揃うまで、README / SPEC の「未完了」表記を削除しない。**
