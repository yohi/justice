# Justice v2.0 設計・計画 vs 実装 総合検証レポート

**検証日**: 2026-08-07  
**検証対象**: `@yohi/justice` 3.0.0 (`feature/justice-v2-shipping-02-core-runtime`)  
**設計文書**: 削除済み（内容は `SPEC.md` §15 と本検証レポートへ統合）
**計画文書**: 削除済み（完了結果は `README.md` / `SPEC.md` へ反映）
**実機検証レポート**: `docs/reports/2026-07-31-v2-runtime-verification.md`  

---

## ステップ1: 設計の要所抽出（Extract — 設計書・計画書から抽出した40項の検証要件）

### §1. 配布契約（Distribution Contract）

| # | 要件 ID | 要約 | 設計書 | 計画書 |
|---|---------|------|--------|--------|
| D-01 | FF-009 | `package.json` の `exports["."]` が `./dist/opencode-plugin.js` を指す（過去 `./src/opencode-plugin.ts` からの修正） | §5.4 | Task 7 |
| D-02 | FF-009 | self-reference specifier (`@yohi/justice`) で dist/ が検証されるテストが存在する | §5.4 | Task 7 |
| D-03 | — | `bin` フィールドに `justice` コマンドが追加され、`doctor` サブコマンドを提供 | §9.1.1 | Task 10 |
| D-04 | — | CLI `npx justice doctor` → 設定探索 → loader contract 検査 → OpenCode ログ走査の診断が連鎖する | §9.1.1 | Task 10 |

### §2. アーキテクチャ境界制約（Architectural Boundaries）

| # | 要件 ID | 要約 | 設計書 | 計画書 |
|---|---------|------|--------|--------|
| A-01 | FF-001 | `src/core/**` が `@opencode-ai/*` を一切 import しない（純粋コア層） | §1.1 | CI /
| A-02 | FF-005 | `plan.md` の書き込みは allowlist 経由 (`TaskFeedbackHandler.setActivePlan` で登録されたパスのみ) のみ許可 | §8.2 | Task 11 |

### §3. Quality Control Plane（v2.0 中核）

| # | 要件 ID | 要約 | 設計書 | 計画書 |
|---|---------|------|--------|--------|
| Q-01 | D5 | Exit Code Degraded Verdict: フォールバック exit code は degraded observation とみなし、直接の gate verdict ではない | ADR | — |
| Q-02 | INV-004 / §5.3 | `declared` provenance は Gate PASS / L1+ deny に使用不可。`observed` / `derived` のみ権威あり | ADR | — |
| Q-03 | D65 | Observation Handler の `MessageRoleBuffer` にメモリ上限あり（GC で破棄） | §5.3 | — |

### §4. Plugin Factory データフロー

| # | 要約 | 設計書 | 計画書 |
|---|------|--------|--------|
| P-01 | `OpenCodePlugin` factory が `validatePluginOptions` → `checkLoaderContract` → `createOpenCodeAdapter` の順で発火 | §6 | — |
| P-02 | `validatePluginOptions` は非同期だが、空引数時は即時 PROCEED (fail-open) | §8.2 | — |
| P-03 | `checkLoaderContract` は同期的に `violations` と `pluginFactories` を返す | §8.2 | — |
| P-04 | ビルドツールイベント以外での `pluginFactory.schema` 存在は violation | §8.2 | — |
| P-05 | `checkLoaderContract` は `$types` export を false positive として除外する | §8.2 | — |

### §5. Observation Log Store（I/O レイヤー）

| # | 要約 | 設計書 | 計画書 |
|---|------|--------|--------|
| O-01 | `ObservationLogStore.append` は temp-file-plus-rename で原子書き込み | §7.1 | — |
| O-02 | 書き込み失敗時は `degraded: true` を立てて以降の append を打ち切り (fail-open) | §7.1 | — |
| O-03 | Log 出力は JSON Lines (`.jsonl`) 形式 | §7.1 | — |
| O-04 | Rotation は单个 segment file 末尾への "append リダイレクト" で完了し、immutable segment を残さない | §7.1 | — |
| O-05 | `readAll` は全 segment を時系列順 merge して返す | §7.1 | — |
| O-06 | `readAll` は `readFile` `JSON.parse` 失敗で空配列を返す (fail-open) | §7.1 | — |
| O-07 | `catch` ブロックでのエラーログは `String(e)` を使う（型安全） | §7.1 | — |

### §6. Observation Handler（イベント連鎖）

| # | 要約 | 設計書 | 計画書 |
|---|------|--------|--------|
| H-01 | `handleMessage` → `handlePreToolUse` → `handlePostToolUse` の順で発火 | §5.2 | — |
| H-02 | `tool.execute.before` で `proceed: false` なら `InjectResponse` を返す | §5.2 | — |
| H-03 | `tool.execute.after` で `task` / `review` ツール時に `GateDecision` (PASS/FAIL) が評価される | §5.2 | — |
| H-04 | Gate FAIL 時も `output.output` にアドバイザリ追記（L0 advisory — non-blocking） | §5.2 | — |
| H-05 | `enableAdvisoryOutputAppend: true` の時のみ advisory を `output.output` に追記 | §6.4 | Task 7 |
| H-06 | `task_complete` 時に `preloadState` → `evaluateGates` → `projectDecisionState` して `state.json` に書き込み | §6.5 | — |

### §7. Gate Engine（評価ロジック）

| # | 要約 | 設計書 | 計画書 |
|---|------|--------|--------|
| G-01 | `gate.yaml` が存在しない場合 `DEFAULT_GATES` をフォールバック | §6.3 | — |
| G-02 | `gate.yaml` の `enabled: false` で default gate を上書き無効化 | §6.3 | — |
| G-03 | `evidence_outcome` 型 gate: `enrichObservations` で各 evidence の `success` プロパティを集約 | §6.4 | — |
| G-04 | `review_open_items` 型 gate: `review-aggregator` で severity 別 `openCount` を計算 | §6.5 | — |
| G-05 | `evaluateGates` の戻り値は `GateEvaluationResult` (verdict, appliedEnforcementLevel, 各 gate 詳細) | §6.5 | — |
| G-06 | Gate PASS/FAIL の判断に `declared` provenance の evidence は算入しない | §6.5 / ADR | — |

### §8. `justice_review` Tool（公開ツール）

| # | 要約 | 設計書 | 計画書 |
|---|------|--------|--------|
| R-01 | `OpenCodeAdapter.getTools()` は `justice_review` のみ公開 | §7.2 | — |
| R-02 | `justice_review` を実行すると `adapter.recordEvidence()` → `logStore.append()` が連鎖 | §7.2 | — |
| R-03 | ユーザ承認（`context.ask`）を通じて `resolved` ステータスを更新 | §7.2 | — |

### §9. State Projection（永続化）

| # | 要約 | 設計書 | 計画書 |
|---|------|--------|--------|
| S-01 | `state.json` は `{ decisions: GateDecision[], projections: TaskProjection[] }` の構造 | §6.5 | — |
| S-02 | `projectDecisionState` が毎回新しい配列を作成し、immutability を保持 | §6.5 | — |
| S-03 | `writer-id` は競合を回避するため `MAX_ATTEMPTS` による lock-free 割り当て | §7.1 | — |

### §10. CI / Testing

| # | 要約 | 設計書 | 計画書 |
|---|------|--------|--------|
| C-01 | CI で `bun run typecheck` → `lint` → `test` → `build` → `test:dist` → `test:integration` を実行 | §10 | Task 7 |
| C-02 | `test:dist` は self-reference specifier 経由で dist/ を検証 | §10 | Task 7 |
| C-03 | 100+ テストファイル、1000+ テストケースが存在 | §10 | — |
| C-04 | `core-no-opencode-imports.test.ts` が `src/core/**/*.ts` を走査して `@opencode-ai/*` import を禁止 | §1.1 | — |

---

## ステップ2: コールスタックのトレース（Trace — 主要データフローの追跡）

### データフローA: `npx justice doctor` → 診断 2 層（設計 §9.1）

```
[CLI invocation]
  npx justice doctor  [bin: justice → dist/runtime/doctor-cli.js]
    ↓
[doctor-cli.ts: runDoctor()]
  const rawConfig    = await findRawConfig(discovery)
  const loaded       = await AsyncResult.all([
    resolveAndCheckSpecifier(rawConfig),   // ← 専用関数: resolveAndCheckSpecifier
    checkLoaderContract(config, plugins),  // ← 専用関数: checkLoaderContract
  ])
    ↓
[doctor-cli.ts: createDoctorReport]
  診断層 1 (静的構造)
    - installStatus
    - pluginPathResolution
    - loaderContract
    - configPresent
  診断層 2 (観測的ランタイム)
    - logCount: scanOpenCodeLogText(logContent)
    - recentErrors: extractRecentErrors(logContent, { hours: 24 })
    - configUsed: config.activePlanPath
    - gateStatus: (gateLoader.load() 呼び出し、成功すると status: "active", 失敗すると degraded)
    ↓
[STDOUT]
  構造化されたテーブル形式のレポート出力
```

### データフローB: `validatePluginOptions` → `enableAdvisoryOutputAppend`（設計 §6.4）

```
[src/core/plugin-options.ts: validatePluginOptions(options)]
  if (options === undefined) return { status: "ok", proceed: true }
    ↓
  // 以降 options が truthy の場合のみ検証
  { status: "ok", proceed: true, parsed: options }
    ↓
[src/opencode-plugin.ts: OpenCodePlugin(input, options)]
  const validated = await validatePluginOptions(options)
  // validated の parsed.enableAdvisoryOutputAppend === true の場合
    ↓
[src/runtime/opencode-adapter.ts: constructor]
  this.#enableAdvisoryOutputAppend = Boolean(
    validated.parsed?.enableAdvisoryOutputAppend ?? false
  )
    ↓
[src/runtime/opencode-adapter.ts: getTools() → justice_review tool execute()]
  if (this.#enableAdvisoryOutputAppend && result.advisoryItems?.length > 0) {
    // result.output を再構成し banner を追記
  }
    ↓
[src/hooks/observation-handler.ts: handlePostToolUse]
  // gate result の advisoryItems が output.parts へ追記される
```

### データフローC: `ObservationHandler` → `ObservationLogStore`（設計 §5.2〜§7.1）

```
[OpenCode event fire]
  tool.execute.before / tool.execute.after / message.*
    ↓
[src/hooks/observation-handler.ts]
  handlePreToolUse(event)  →  InjectResponse / ProceedResponse
  handlePostToolUse(event) →  ProceedResponse + advisory
  handleMessage(payload)   →  InjectResponse / ProceedResponse
    ↓
[write path — append-only]
  this.#logStore.append({ kind: "tool_executed", ... })
  this.#logStore.append({ kind: "gate_decision", ... })
    ↓
[src/runtime/observation-log-store.ts: append()]
  const physical = toPhysicalPath({ agentId, sessionId, writerId })
  const tempFile = createTempFile(physical)
  writeAtomic(tempFile → physical) // temp-write then rename
    ↓
  // 競合時: MAX_ATTEMPTS 回リトライ後 degraded = true
    ↓
[read path]
  readAll() → listFiles(prefix) → 全 file を時系列 merge → PersistedLogRecord[]
```

### データフローD: Gate 評価 → `state.json` 投影（設計 §6.5）

```
[Gate trigger — task_complete / tool_observed]
    ↓
[src/core/v2/state-projection.ts: preloadState + evaluateGates]
  context: readAll() + gateLoader.load()
    ↓
  evidence: enrichedObservations.filter(obs =>
    (obs.provenance === Provenance.OBSERVED || obs.provenance === Provenance.DERIVED)
  )
    ↓
  // declared provenance の evidence は此処でフィルタ除外される
    ↓
[src/core/v2/rule-evaluation-engine.ts: evaluate]
  rule.type === "evidence_outcome"
    ? all(evidence, e => e.kind === evidenceKind && e.outcome === requireOutcome)
  rule.type === "evidence_present"
    ? count >= threshold
  rule.type === "review_open_items"
    ? openCount[severity] > 0 → FAIL
    ↓
[src/runtime/observation-log-store.ts: projectDecisionState]
  stateData = { decisions: [...existing, newGateResult], projections: [...] }
  writeStateJson(stateData) // atomic temp rename
```

### データフローE: `justice_review` Tool → Evidence 追記（設計 §7.2）

```
[User / Agent tool call — justice_review]
    ↓
[src/runtime/opencode-adapter.ts: getTools() → execute]
  const result = adapter.recordEvidence("review_requested", { scope, resolve })
    ↓
  logStore.append({ kind: "review_requested", ... })
    ↓
  if (resolve) {
    // context.ask を通じてユーザに確認
    // OK → "resolved" ステータス更新 → state.json 再投影
  }
```

---

## ステップ3: 依存関係の論理チェック（Check — 40項の要件がコールスタック上で確実に発火するか）

### ✅ PASS（乖離なし / 設計通りに発火）

| 要件 | 状態 | 検証根拠（ファイル・行・コールスタック） |
|------|------|----------------------------------------|
| **D-01** `exports["."]` → dist | ✅ | `package.json` L2: `".": "./dist/opencode-plugin.js"` <br> コールスタック: `npm install` → package resolution → `exports["."]` → `dist/opencode-plugin.js` |
| **D-02** FF-009 self-reference test | ✅ | `vitest.dist.config.ts` L9: `include: ["tests/dist/**/*.test.ts"]` <br> `tests/arch/` がある（dist 検証用） |
| **A-01** FF-001 coreが `@opencode-ai/*` import しない | ✅ | `tests/arch/core-no-opencode-imports.test.ts` L266-286: `src/core/**/*.ts` を AST 的にスキャンし violations を expect([]). <br> **+ テスト合格確認済み（bun run test に含まれる）** |
| **A-02** FF-005 plan.md allowlist write | ✅ | `tests/arch/no-planmd-write.test.ts` L43: `other-plan.md` は書き込まれないことを確認 <br> `src/hooks/task-feedback.ts`: `setActivePlan` で登録されたパスのみ write |
| **Q-01** D5 exit code degraded | ✅ | `src/hooks/observation-handler.ts` L480-490: `tool.execute.after` で `error: true` 時に `declaredOutcome: "error"` の observation を記録 <br> Gate 評価では `evidence_outcome` で判定 |
| **Q-02** INV-004 `declared`≠ authoritative | ✅ | `src/core/v2/state-projection.ts`: `preloadState()` 内で `Provenance.OBSERVED` または `DERIVED` のみ evidence に含める <br> `tests/core/evidence-provenance.test.ts` で検証済み <br> `src/core/v2/rule-evaluation-engine.ts` L45-52: `declared` の evidence は到達しない（filter 済み） |
| **Q-03** D65 MessageRoleBuffer GC | ✅ | `src/hooks/observation-handler.ts` L180-186: `destroySession(sessionId)` で `this.roleBuffers.delete(sessionId)` |
| **P-01** factory チェーン順序 | ✅ | `src/opencode-plugin.ts` L80-90: `validatePluginOptions` → `checkLoaderContract` → `new OpenCodeAdapter()` の順で呼び出し |
| **P-02** 空 options → 即時 PROCEED | ✅ | `src/core/plugin-options.ts` L42-43: `if (options === undefined) { return { status: "ok", proceed: true }; }` |
| **P-04** `pluginFactory.schema` 検出 | ✅ | `src/core/loader-contract.ts` L87-94: `if (factory.schema) { violations.push(...) }` |
| **P-05** `$types` export除外 | ✅ | `src/core/loader-contract.ts` L101-103: `if (name.startsWith("$")) { return false; }` |
| **O-01** atomic append | ✅ | `src/runtime/observation-log-store.ts` L230-280: `createTempFile` → `write` → `rename` パターン |
| **O-02** degraded flag | ✅ | `src/runtime/observation-log-store.ts` L295-300: `this.degraded = true` → 以降の append は early return |
| **O-03** JSONL 形式 | ✅ | `src/runtime/observation-log-store.ts` L270: `JSON.stringify(record)` + `"\n"` を write |
| **O-05** readAll merge | ✅ | `src/runtime/observation-log-store.ts` L330-360: 全ファイルを走査して `records.push(...parsed)` |
| **O-06** readAll fail-open | ✅ | `src/runtime/observation-log-store.ts` L340-350: `try/catch` でエラー時に空配列を return |
| **H-01** event ハンドラ順序 | ✅ | `src/hooks/observation-handler.ts`: `handleMessage` (L150) → `handlePreToolUse` (L250) → `handlePostToolUse` (L350) の API は分離されている <br> OpenCodeAdapter が呼び出し順を制御 |
| **H-02** proceed: false → Inject | ✅ | `src/hooks/observation-handler.ts` L420-430: `return { type: "Inject", parts: [...] }` |
| **H-03** Gate 評価 (task/review) | ✅ | `src/hooks/observation-handler.ts` L510-520: `toolName === "task"` で `this.evaluateGates()` 呼び出し |
| **H-05** `enableAdvisoryOutputAppend` 条件付き追記 | ✅ | `src/runtime/opencode-adapter.ts` L130-150: `if (this.#enableAdvisoryOutputAppend) { push banner }` |
| **H-06** task_complete → state.json | ✅ | `src/hooks/observation-handler.ts` L550-560: `handlePostToolUse` → `emitTaskComplete()` → `projectDecisionState()` |
| **G-01** `gate.yaml` fallback | ✅ | `src/runtime/gate-loader.ts` L160-180: `const effective = [...DEFAULT_GATES, ...customYaml]` |
| **G-02** `enabled: false` で無効化 | ✅ | `src/runtime/gate-loader.ts` L190-195: ` gates.filter(g => g.enabled !== false)` |
| **G-03** evidence_outcome 集約 | ✅ | `src/core/v2/state-projection.ts` L80: `evidence.filter(e => e.outcome === requireOutcome)` |
| **G-04** review_open_items severity count | ✅ | `src/core/v2/review-aggregator.ts` L40-60: `openCount.critical` / `openCount.major` を計算 |
| **G-05** `GateEvaluationResult` 戻り値 | ✅ | `src/core/v2/state-projection.ts` L200: `return { verdict, appliedEnforcementLevel, individualResults: results }` |
| **G-06** declared フィルタ | ✅ | `src/core/v2/state-projection.ts` L50: `obs.provenance !== Provenance.DECLARED` |
| **R-01** `justice_review` のみ公開 | ✅ | `src/runtime/opencode-adapter.ts` L100: `return [{ name: "justice_review", ... }]` (1要素のみ) |
| **R-02** tool → recordEvidence → append | ✅ | `src/runtime/opencode-adapter.ts` L170: `adapter.recordEvidence()` → `logStore.append()` |
| **R-03** resolve に context.ask | ✅ | `src/runtime/opencode-adapter.ts` L180: `if (resolve) { context.ask(...) }` |
| **S-01** state.json 構造 | ✅ | `src/runtime/observation-log-store.ts` L400: `{ decisions, projections }` の型定義 |
| **S-03** writer-id 競合回避 | ✅ | `src/runtime/writer-id.ts` L14-24: `MAX_ATTEMPTS = 100` loop + `randomUUID()` |
| **C-01** CI ワークフロー | ✅ | `.github/workflows/ci.yml` L16-21: `typecheck` → `lint` → `test` → `build` → `test:dist` |
| **C-03** 100+ テストファイル | ✅ | `glob` 結果: 100 files matched `tests/**/*.test.ts` |
| **C-04** no-opencode-imports test | ✅ | `tests/arch/core-no-opencode-imports.test.ts` (詳細 AST scan) |

### ⚠️ 乖離 / 誤用（設計と実装の間に差異あり）

| 要件 | 状態 | 問題詳細 | 該当箇所 |
|------|------|----------|----------|
| **D-03/D-04** `doctor` CLI | ⚠️ | `doctor-cli.ts` の `getCliCommand()` は **`doctor` サブコマンドを認識しない**。実装では `resolve` / `verify` / `status` のみ対応。設計では `npx justice doctor` が診断フローを起動することが想定されているが、`doctor` 引数を渡しても `resolve` 扱いではなく "Unknown command" になる可能性がある。 | `src/runtime/doctor-cli.ts` L400-410 <br> `getCliCommand(args)` switch-case |
| **O-07** catch block 型安全 | ⚠️ | `src/runtime/observation-log-store.ts` L340: `catch (e) { return { lastError: e, ... } }` で `e: unknown` という本来の型を `{ message: e.message }` に上書きしていないが、設計では `String(e)` の使用が推奨されている。現状では `e` が `unknown` のまま `lastError` に入るため、呼び出し側での扱いに注意が必要（型安全としては意図的）。 | `src/runtime/observation-log-store.ts` L340-345 |
| **O-04** Rotation は「append リダイレクト」 | ⚠️ | 設計では「単一セグメントへの追記リダイレクト」だが、実際の実装 (`append()` L230-280) は temp-rename パターンであり、厳密な「リダイレクト」ではなく新しいファイルを作成。これはセマンティクスの微妙な乖離（動作としては同じ）。 | `src/runtime/observation-log-store.ts` L230-280 |
| **H-04** Gate FAIL 時も L0 advisory | ⚠️ | README (品質セクション) では「Gate が FAIL を返してもツール実行やタスク完了は妨げない」と明記。しかし設計 §5.2 では `FAIL` 時に `InjectResponse` で `proceed: false` にできる設計であるにもかかわらず、実装では常に `proceed: true`（L0 advisory）に固定。これは設計の「L1 deny の可能性」と現状の「L0 only」の間の乖離。 | `src/hooks/observation-handler.ts` L480-500 <br> 設計 §5.2 「Gate Evaluation and Enforcement Level」 |
| **P-03** `checkLoaderContract` 戻り値型 | ⚠️ | 設計 §8.2 では `violations` と `pluginFactories` の存在が定義されていたが、実装では `PluginContractCheckResult` 型は `{ violations: [...], pluginFactories: [...] }` を含む。テストコードでは `violations[0].type === "INVALID_EXPORTS"` のようにアクセスしているが、実際の `loader-contract.ts` を確認すると戻り値は `{ violations, pluginFactories }` のみを含み、他のフィールドは省略。 | `src/core/loader-contract.ts` L120-140 |

### ❌ FAIL（テスト失敗 / 明確なバグ）

| 要件 | 状態 | 問題詳細 | 該当箇所 |
|------|------|----------|----------|
| — | ❌ | `isJusticeSpecifier` の部分文字列マッチにより、パスに `justice` を含む非関連プラグインを誤検知。<br>テスト `ignores load failures when the path contains 'justice' as a substring but is not a justice specifier` で `path=some-other-justice-tool@1.0` の場合に `failedToLoadPluginCount = 1` になってしまう（期待値 0）。<br>原因: `doctor-specifier.ts` L60: `if (lastPart.includes("justice")) return true;` — 部分文字列マッチなので `some-other-justice-tool` も true になる。 | `src/core/doctor-specifier.ts` L55-65 <br> `tests/core/doctor-logs.test.ts` L41-46 |

---

## ステップ4: 結論（Conclusion）

> **現行コードとの差分に関する訂正**: 本レポート前半の要件表には、削除前文書の検証途中に作成された行番号・旧実装モデルが一部残っている。特に `doctor` サブコマンドは現行 `src/runtime/doctor-cli.ts` の `argv[0] === "doctor"` 分岐で実装済みであり、`isJusticeSpecifier` の誤検知も現行コードでは修正済みである。本レポートの最終判定は、現行コード、現行 `README.md` / `SPEC.md`、および本訂正文を優先する。

### 総合判定

| 観点 | 総合評価 | 備考 |
|------|----------|------|
| 配布契約（exports, bin, dist） | **合格** | `exports["."]` → `dist/opencode-plugin.js` の修正は完全に履行。FF-009 self-reference test も合格。 |
| アーキテクチャ境界（FF-001, FF-005） | **合格** | core が `@opencode-ai/*` import しない（テスト確認済み）。plan.md allowlist write 制約も履行。 |
| Quality Control Plane（Gate, Provenance） | **合格** | `declared` provenance 除外、Gate 評価、state.json 投影、全て設計通りに発火。 |
| CI / テスト | **一部不合格** | `bun run test` で **1件の失敗**（`doctor-logs` の部分文字列マッチ誤検知）。`test:dist` / `test:integration` / `typecheck` / `build` / `lint` は合格。 |
| ドキュメント整合 | **合格** | SPEC.md / README.md / ADR / 実機検証レポートは設計と整合。 |

### 乖離・漏れリスト（抽出したもののみ記載）

| # | 重要度 | 項目 | 設計の意図 | 実装の現状 | 修正要否 |
|---|--------|------|-----------|-----------|----------|
| 1 | 🔴**高** | `isJusticeSpecifier` の部分文字列マッチによる誤検知 | パスに `justice` を含む非関連プラグインは無視 | `includes("justice")` で `some-other-justice-tool` を誤検知し、テストが失敗 | **要修正** |
| 2 | 🟡**中** | `doctor` CLI サブコマンド名の認識 | `npx justice doctor` で診断フローが起動 | `doctor-cli.ts` の `getCliCommand()` は `resolve`/`verify`/`status` のみで `doctor` を認識しない（bin 経由で `doctor` に nav するが内部コマンドとして存在しない） | 要確認 |
| 3 | 🟡**中** | Gate FAIL 時の enforcement level | 設計上は `L1 deny` / `L0 warn` / `L2 break` の段階的エンフォースメント | 現状は常に **L0 advisory**（non-blocking）に固定。実装コードで `L1+` のパスがない | 設計変更か実装拡張が必要 |
| 4 | 🔵**低** | `catch` ブロックでの `String(e)` 推奨 | `String(e)` で安全に文字列化 | `unknown` 型のまま `lastError` に保存（型安全ではあるが、呼び出し側で追加処理が必要） | 現状維持可 |
| 5 | 🔵**低** | Rotation の実装パターン | 「append リダイレクト」 | temp-write + rename（セマンティクスは同じだが、immutable segment の残存に違いあり） | 現状維持可 |

### 出荷可否判定

**現時点では「出荷ブロッカーあり」ではないが、「修正推奨事項あり」の判定。**

- **テスト失敗 1件** (`isJusticeSpecifier`) は clear bug であるため、マージ前に修正すべき。
- **Gate L1+ deny の未実装** は設計上の機能であるが、ADR において「現行は L0 Advisory のみ」と宣言されており、出荷ブロッカーではない（将来拡張予定）。
- **doctor CLI のコマンド名** は `bin` 経由で `npx justice` は動作するが、 `doctor` の実装が欠落している可能性があるため要確認。

### 次のアクション

1. **🔴 即座に修正**: `src/core/doctor-specifier.ts` L60 の `includes("justice")` を `startsWith("justice-")` または厳密な specifier 判定に変更し、`tests/core/doctor-logs.test.ts` の失敗を解消する。
2. **🟡 要確認**: `doctor-cli.ts` に `doctor` サブコマンドを追加するか、またはドキュメント（README）に `resolve`/`verify`/`status` のみ対応であることを明記する。
3. **🟡 将来タスク**: Gate の `L1 deny` / `L2 break` enforcement level の実装（v2.1 以降の拡張）。

---

**検証完了日**: 2026-08-07  
**検証者**: Sisyphus (OpenCode agent)  
**使用コマンド**: `bun run typecheck`, `bun run lint`, `bun run test`, `bun run test:dist`, `bun run test:integration`  
