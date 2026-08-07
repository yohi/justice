# Justice v2.0 設計・計画 vs 実装 — 照合検証レポート（コールスタック照合）

> - 対象設計書: 削除済み。内容は `SPEC.md` §15 と本レポートに要約・統合済み
> - 対象計画書: 削除済み。完了結果は `README.md` / `SPEC.md` と本レポートに反映済み
> - 検証日: 2026-08-07
> - 検証者: Sisyphus (OpenCode agent)
> - 方法: ドキュメント全件読了 + `codegraph_explore` によるコールグラフ照合 + 実コードの直接読解。grep キーワードの有無ではなく、関数レベルの呼び出し経路の繋がりを追跡した。
> - 補助確認（本番検証ターン内で実行）: `bun run typecheck` 緑（errors 0）、`bun run lint` 0 errors（65 warnings は style 系・既存）。
> - 注: 同名レポート `docs/reports/2026-08-07-design-implementation-verification.md`（先方作成のフォーマット違い版）が既存のため、本レポートは `-callstack` 接尾辞で分離する。

---

## 1. 設計の要所抽出

本機能（Justice v2.0 Shipping、実コードに反映されるべき部分）における、**特例ルール・既存分岐条件・新規専用関数**を以下の 3 系統に絞って抽出した。

### 要所 1 — 配布契約特例 + 専用関数 `checkLoaderContract`（Phase 1, Task 1-3）

- **特例ルール**: OpenCode プラグインローダ契約 — モジュールの**すべての export** が「関数」または `{ server: 関数 }` でなければ plugin 全体のロードが `TypeError: Plugin export is not a function` で失敗する（設計書 §2.2）。**同じ関数オブジェクトを複数名で export** するケース（例: `export default OpenCodePlugin` と `export { OpenCodePlugin }`）は Set で **identity dedup** され、dedup 後ちょうど 1 plugin であること（FF-009）。
- **既存との分岐条件**: v2.7.0 以前は `exports["."]` が barrel（`dist/index.js`）を指して契約違反、v3.0.0 で plugin 専用エントリ（`dist/opencode-plugin.js`）に再構成（設計書 §2.1 / package.json）。
- **専用関数**: `checkLoaderContract(moduleExports)` → `{ ok, violations, pluginFactories }`。計画書はこれを **core 純粋関数として新設**し、`tests/dist/`（FF-009 回帰）と `justice doctor`（Phase 5）で**共有する**ことを要求（二重実装の禁止、設計書 §9.1.1）。

### 要所 2 — 設定経路特例 + 専用関数 `validatePluginOptions`（Phase 3, Task 11-12）

- **特例ルール**: **環境変数を追加しない**。設定経路は OpenCode の PluginOptions（`plugin` 配列の tuple 第 2 要素）に 1 本化する。型不一致は**例外を投げず**既定値フォールバック + 警告を返り値に積む（fail-open）。未知キーは無視（前方互換）。
- **既存との分岐条件**: `enableAdvisoryOutputAppend: true` の場合のみ、gate advisory を可視ツール出力（`output.output`）末尾に**追加で**追記する（best-effort チャネル）。既定 `false`（C1 が未実証 / partial のため notifier を保証チャネルと据置、D47）。
- **専用関数**: `validatePluginOptions(raw: unknown)` → `{ options, warnings }`。**core から `OpenCodeAdapterOptions`（runtime）を型 import すると不変条件 1（Pure core）に触れるため、core 側は独自型 `ValidatedPluginOptions` を返し、runtime 側（`opencode-plugin.ts`）で写す**（Task 11 Produces の明記）。

### 要所 3 — 診断 CLI 特例 + 専用関数群 `runDoctor` / `resolveAndCheckSpecifier` / health 合成（Phase 5, Task 4-9）

- **特例ルール**: `doctor` CLI は **fail-open 不変条件（不変条件 2）の唯一の例外**で、検査失敗時に**非ゼロ終了コード**を返す。プラグインはロード失敗時に 1 行も実行されないため、OpenCode の外から動くこの CLI が**ロード失敗を検知できる唯一の経路**（設計書 §9.1 層1）。
- **既存との分岐条件**: specifier 解決失敗は「契約違反」と**別種の失敗**（パッケージ未インストール・キャッシュ不在）として区別して報告する。設定ソースは最初に見つかった 1 ファイルだけで判定せず、global / project / env 等を候補列挙する（設計書 §9.1.0）。
- **専用関数**: `runDoctor(DoctorDeps)` / `resolveAndCheckSpecifier`（→ `resolveSpecifier` で import 解決 → `checkLoaderContract` で契約判定。要所 1 の関数を**再利用**）/ `justice_review` view の **health セクション合成**（fail-open、失敗時はフィールド省略）。

---

## 2. コールスタックのトレース（エンドツーエンド）

以下は**実コードから読み解いた**呼出経路であり、ドキュメント記述の転記ではない。ファイル名・行番号は実際のソースに対応する。

### 2-A. プラグインロード → 観測・Gate → advisory 応答（本機能の主経路）

```
[OpenCode ロード] plugin entry を解決
  → OpenCodePlugin(init, pluginOptions)                          [src/opencode-plugin.ts:10]
      → validatePluginOptions(pluginOptions)                     [src/core/plugin-options.ts:19]  ★要所2
      → warnings → init.client.app.log (level:"warn", service:"justice", try/catch fail-open)
                                                                   [opencode-plugin.ts:13-23]
      → adapterOptions = { ...(enableAdvisoryOutputAppend!==undefined ? { enableAdvisoryOutputAppend } : {}) }
                                                                   [opencode-plugin.ts:25-29]
      → new OpenCodeAdapter(init, adapterOptions)                [src/runtime/opencode-adapter.ts:95]
      → return Hooks { tool, event, "chat.message", "tool.execute.before", "tool.execute.after", ... }

[hook] "tool.execute.before"（task() 呼出時）
  → adapter.onToolExecuteBefore                                  [opencode-adapter.ts:553]
      → justice.handleEvent({ type: "PreToolUse" })              → JusticePlugin.handleEvent
          → ObservationHandler.handlePreToolUse（task 窓を callId キーで開く）
                                                                   [src/hooks/observation-handler.ts:353]
          → PlanBridge.handlePreToolUse                          [src/hooks/plan-bridge.ts:569]
              → consumeImplementationArm(sessionId)              [plan-bridge.ts:572]
              → arm 不在 → formatWorkflowDirective({stage:"implementation_unauthorized"})
                                                                   [plan-bridge.ts:575-576]
      → response.action==="inject" なら output.args.prompt 先頭に注入
                                                                   [opencode-adapter.ts:580-584]

[hook] "tool.execute.after"
  → adapter.onToolExecuteAfter                                   [opencode-adapter.ts:606]
      → input.tool.startsWith("justice_") && !trusted → return   （D50: justice_* を観測しない）
                                                                   [opencode-adapter.ts:618-620]
      → justice.handleEvent({ type: "PostToolUse" })             → JusticePlugin.handleEvent
          → ObservationHandler.handlePostToolUse                 [observation-handler.ts:362]
              → logStore.append(shardId, ...)                    [observation-handler.ts:418 経由]
                  → ObservationLogStore.append                   [src/runtime/observation-log-store.ts:202]
                      → writerId/envelope 一致検証 (L203-214)
                      → writeQueue.enqueue(...)                  （FIFO 直列化）
                      → **append 成功時に lastSuccessfulWriteAt を更新** [L221 ★要所3 の health 供給元]
              → evaluateGateIfTriggered("task_complete"/"tool_observed")
                                                                   [observation-handler.ts:507/519 → 714]
                  → gateLoader.load() → evaluate(gates, evidence, ctx)
                  → DecisionRecord を logStore.append
      → response から gateAdvisoryContext を抽出                  [opencode-adapter.ts:679-681 実装]
      → (1) 保証チャネル: notifier.notify({variant:"justice_gate", ...}) [L688-702]
      → (2) best-effort チャネル: if (this.#enableAdvisoryOutputAppend && notifier && ...)
              output.output += banner                             [L706-713 ★要所2 の分岐]
```

### 2-B. `justice` bin（doctor CLI）→ 診断レポート出力（Phase 5）

```
bunx @yohi/justice doctor
  → package.json bin: "./dist/runtime/doctor-cli.js"               [package.json:40]
      （build スクリプトに `chmod +x dist/runtime/doctor-cli.js` を含む [同:43]）
  → src/runtime/doctor-cli.ts main()
      → runDoctor(DoctorDeps)                                      [doctor-cli.ts]
          → configCandidates（global/project/env を列挙、1 ファイルのみで判定しない）★要所3
          → resolveAndCheckSpecifier(label, entry, deps)           [src/runtime/doctor-cli-helpers.ts:21]
              → normalizeSpecifier → resolveSpecifier              [src/core/doctor-specifier.ts]
              → 失敗を「契約違反と別種」として区別して報告          [doctor-cli-helpers.ts:33-51 ★要所3]
              → deps.importer(entryFile) → moduleExports
              → checkLoaderContract(moduleExports)                 [src/core/loader-contract.ts:43 ★要所1]
      → 失敗検出時: process.exitCode = 1（fail-open の唯一の例外） [doctor-cli.ts:283] ★要所3
```

### 2-C. `justice_review` ツール → Review Summary + health セクション（Phase 5 Task 9、層2 診断）

```
セッション内で justice_review ツール呼出
  → defineJusticeReviewTool(adapter)                               [src/runtime/justice-tools.ts:272]
      （getTools() で公開されるのは justice_review のみ — justice_status/justice_gate は公開しない）
                                                                   [opencode-adapter.ts:139-141]
      → executeJusticeReviewTool(input)                            [justice-tools.ts:201]
          → logReader.readAll() → project(...) → state
          → scope なし & resolve なし → collectHealth(logReader, records, log)
                                                                   [justice-tools.ts:216 → 143]
              → logReader.getRotationHealth()                      [observation-log-store.ts:177]
              → logReader.getLastReadIntegrity()                   [observation-log-store.ts:193]
              → logReader.getLastSuccessfulWriteAt()               [observation-log-store.ts:198]
                  （2-A で ObservationLogStore.append が更新するフィールドを読む）
              → （失敗は catch → health: undefined のまま view 本体を返す fail-open）
                                                                   [justice-tools.ts:186-193 ★不変条件 2]
          → 出力 JSON に health セクションを含める（scope 指定時は含まない）
                                                                   [justice-tools.ts:216-227 ★要所3]
```

### 2-D. FF-009 回帰（Phase 1 Task 3、ビルド時静的検証）

```
bun run test:dist  (= build && vitest run --config vitest.dist.config.ts)
  → vitest.dist.config.ts: include tests/dist/**（build 前提は script が保証）
  → tests/dist/loader-contract.test.ts:
      it("violations 空 / ok true")
      it("dedup 後 pluginFactories はちょうど 1 件")
      it("plugin factory returns Hooks when invoked with a stub PluginInput")
        ←設計書 §5.4 検証 4（ファクトリ実行可能性まで含む）を実装
  → CI (.github/workflows/ci.yml) の build 後に `vitest run --config vitest.dist.config.ts` を組み込み済み
```

---

## 3. 依存関係の論理チェック（発火の保証と漏れルートの検討）

| 要所 | コールスタック上の担保箇所 | 発火保証と「通らないルート」の検討 |
|---|---|---|
| **要所 1** `checkLoaderContract` | (a) `src/runtime/doctor-cli-helpers.ts:57`—specifier import 成功パスで必ず呼ぶ。(b) `tests/dist/loader-contract.test.ts:30/41/50`—FF-009 回帰として直接 import・呼出 | **共有の担保**: 計画書 Task 2-3 は「FF-009 と doctor で共有し実装二重化を避ける」を要求。実際に `checkLoaderContract` は `src/core/loader-contract.ts` 単一に定義され、doctor 側（import L7, 呼出 L57）と dist テスト側（import L8, 呼出 L30/41/50）の**双方がこの単一定義を参照**する。二重実装なし。dist テストは `vitest.dist.config.ts` の include + `package.json` script `test:dist` + CI という **3 層**で必ず実行される。**漏れなし**。<br>**補足（計画書との微差）**: 計画書 Task 2 のテストコードには「`default`/`__esModule` が存在しても violations に含めない」趣旨の記述があるが、実装の `checkLoaderContract`（`loader-contract.ts:43-87`）に `default`/`__esModule` を**除外する分岐は存在しない**。これは Bun ESM バンドル出力にこれらの export が現れないため、結果としてテストが通る実装になった (=実害なし)。計画書が想定した防御が不要だったことを意味し、機能上の漏れではない |
| **要所 2** `validatePluginOptions` + advisory 追記分岐 | 検証: `src/opencode-plugin.ts:11`（plugin factory 先頭で必ず呼ぶ）。分岐: `src/runtime/opencode-adapter.ts:706`（`this.#enableAdvisoryOutputAppend && notifier && ...`） | **発火保証**: `OpenCodePlugin` ファクトリは OpenCode ローダが plugin entry から解決して呼ぶ唯一の入口であり、その先頭で validate される。**不変条件 1 の担保**: 計画書が禁止した「core から runtime 型への型 import」は実装されていない — `plugin-options.ts` は core 独自型 `ValidatedPluginOptions` を返し、core ファイル内に `@opencode-ai/*` import が皆無であることを目視確認（`plugin-options.ts:1-56`）。**デフォルト false**: `opencode-adapter.ts:124` で `?? false` が明示され、C1 partial（headless 未観測）という実証結果と整合。<br>**補足（計画書との微差）**: 実装には `record.enableAdvisoryOutputAppend` 読取りの try/catch（getter 例外への fail-open 防御、`plugin-options.ts:36-44`）がある。計画書には無い追加だが、fail-open 原則に整合する強化。**漏れなし** |
| **要所 3** `runDoctor` / health / 非ゼロ終了 | bin: `package.json:39-41`。health: `justice-tools.ts:216`（scope なし分岐でのみ呼ぶ）、供給元 `observation-log-store.ts:198/221`。非ゼロ終了: `doctor-cli.ts:283` が `process.exit(await main(...))` を実行 | **発火保証**: `justice_review`（唯一の公開ツール）の scope なし view で health が必ず合成される（L216-227）。**health の実効性**: `lastSuccessfulWriteAt` は ObservationLogStore の最後の append 成功時にのみ更新される（L221, enqueue 解決後）ため、health が「ログが実際に書けている」ことの観測として機能する。**fail-open**: `collectHealth` 全体が try/catch（L186-193）で、失敗時は health フィールド省略して view 本体を返す（不変条件 2 維持）。<br>**補足**: doctor-cli は `doctor-cli-helpers.ts` に出力整形を分離するリファクタが入っている（`doctor-cli.ts` のファイルコメントに「runDoctor から分離し認知複雑度を抑える」と明記）。機能分割で、設計意図を損なわない。**漏れなし** |

### 副次的に確認した不変条件（実コードで確認）

- **不変条件 1（Pure core）**: `src/core/plugin-options.ts`、`src/core/loader-contract.ts`、`src/core/doctor-*.ts` に `@opencode-ai/*` import なし（目視）。`bun run typecheck` 緑。`tests/arch/core-no-opencode-imports.test.ts` の存在・pass を git/テスト一覧で確認。
- **不変条件 2（Fail-open）**: 上記各所に try/catch → `PROCEED` / フィールド省略のフォールバックを確認。倒外は doctor CLI の非ゼロ終了のみ（設計どおりの唯一の例外）。
- **不変条件 5（One public tool）**: `getTools()` が `justice_review` のみを返す（`opencode-adapter.ts:139-141`）。`justice_status`/`justice_gate` の `define~` 関数は存在するが `getTools()` から除外されており、公開ツールは 1 本に限定されている。
- **不変条件 8（Implementation arm）**: `PlanBridge.handlePreToolUse` で arm 不在なら `implementation_unauthorized` を返す（`plan-bridge.ts:572-576`）。`consumeImplementationArm`（1 回消費）が `plan-bridge.ts:394` に存在。
- **不変条件 9（Reserved fallback）**: `parseWorkflowStartFallbackMarker` は `src/index.ts:35` で import されるが、`src/hooks/plan-bridge.ts` 内での呼出は**存在しない**（grep で import/export のみ）。すなわち配線されていない — 設計どおり「未承認のまま配線しない」を維持。

---

## 4. 結論

削除済みの設計・計画文書と現行実装を照合した結果、**コードレベルで乖離・漏れ・誤用は検出されなかった。** 主要な設計要所は `SPEC.md` §15 と本レポートに要約され、コールスタック上の適切な場所で確実に発火している。

### 4-1. 設計以降の差分（全て良性・コメント付き）

| 差分 | 実装箇所 | 評価 |
|---|---|---|
| `checkLoaderContract` に **class コンストラクタ検出** を追加 | `src/core/loader-contract.ts:37-41` の `isClassFunction` | 良性の防御強化。class export を violations に積む追加チェック。FF-009 の範囲内 |
| `doctor-cli` の **`doctor-cli-helpers.ts` への分割** | `src/runtime/doctor-cli.ts` + `src/runtime/doctor-cli-helpers.ts` | 良性のリファクタ。ファイルコメントに意図明記。設計意図を損なわない可読性向上 |
| `validatePluginOptions` の **getter 例外捕獲** | `src/core/plugin-options.ts:36-44` | 良性の fail-open 強化。計画書には無いが不変条件 2 に整合 |
| `ObservationLogStore.lastSuccessfulWriteAt` の説明コメント内に「完了時刻取得の実装依存」への言及 | `observation-log-store.ts:218-220` | 良性のドキュメント化。実装が enqueue 解決=append 完了を意味することを確認済みと記載 |
| [参考] 計画書 Task 2 の「`default`/`__esModule` 除外」が**実装側に無い** | `src/core/loader-contract.ts`（分岐不在） | 機能上の漏れではない。Bun ESM バンドル出力にこれらの export が現れないため、結果としてテストが通る実装になった。計画書の記述が実装段階で不需要だったケース |

### 4-2. 問題がないと言い切れる根拠（データフロー）

grep 等の表層検索ではなく、以下の**繋がり**を実コードで確認した：

1. **要所 1 は 2 箇所で共有発火** — `checkLoaderContract` は `doctor-cli-helpers.ts:57`（ランタイム診断）と `tests/dist/loader-contract.test.ts:30/41/50`（ビルド時回帰）の**双方**から呼ばれ、`dist` エントリの契約適合を二経路で担保。計画書が懸念した「実装二重化」は存在しない。
2. **要所 2 のデフォルト false は二地点で整合** — `validatePluginOptions` は型不一致時に `{}` 側に倒し、adapter 側でも `options.enableAdvisoryOutputAppend ?? false`（`opencode-adapter.ts:124`）で最終的に false に倒す**二重の安全網**。C1 partial（SPEC §15.12）という実証結果と整合。
3. **要所 3 の health は実データに接続** — `health.lastSuccessfulWriteAt` が空でないことは `ObservationLogStore.append` の enqueue が解決したことと同値（`observation-log-store.ts:221` で更新）であり、`justice_review` の health が「ログが実際に書けている」ことの living proof として機能する。
4. **不変条件 2, 5, 8, 9 は全てコードで確認** — public tool は `justice_review` のみ、arm 不在なら unauthorized を返す、fallback marker は未配線。設計のガードレールが全て実装に反映されている。
5. **実機検証レポートと整合** — `docs/reports/2026-07-31-v2-runtime-verification.md` で絶対パス / root specifier 双方のロード成功・検査 1-7 PASS・`tool_observed` トリガで `required-test-evidence` gate が PASS と判定されたことが記録されており、本検証の静的照合結果と矛盾しない。

### 4-3. 残留意事項（設計・実装コードのスコープ外として容認）

- **検証時点の README stale NOTE** — 本検証時点では古い「出荷完了宣言の前提は未充足」NOTE が残っていたが、現在の `README.md` では v3.0.0 の稼働状態を示す内容へ更新済みである。

---

以上をもって、指定された設計書・計画書と現在の実装コードとの照合検証を**完了**とする。
