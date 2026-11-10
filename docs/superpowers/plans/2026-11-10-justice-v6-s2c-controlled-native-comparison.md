# Justice v6 S2-c Controlled Native-only Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` **only after a separate, scope-specific Human Owner execution approval**. Steps use checkbox (`- [ ]`) syntax. This plan's creation does not authorize starting any step, source modification, Host operation, Build/Test/CI, or GitHub write.

**Goal:** 固定実開発Sessionの複製から正常1・ネガティブ5ケースを作り、同一条件のNative-onlyとNative + Justiceの独立したレビューを比較し、問題の**種類と対象をともに正しく特定**した追加検出、見逃し、誤検知、比較不能を6ケース限定で報告する。

**Architecture:** 既存OpenCode v2.2.5保存API応答・Superpowers/S1 Artifactと明示Correlationを固定し、原本に触れず非公開ワークスペースの6ケースにそれぞれ1件の注入を行う。現行`runS2bOfflineAdapter()`のREAD_ONLY診断を使ってJustice追加レポートを固定し、同じ基礎入力を別コンテキストで2アームに提示する。回答が両方固定された後で独立Ground Truthと照合する。**新たな診断Core・大規模Harness・本番ソース変更を作らない。**

**Tech Stack:** TypeScript/ESM、Bun、Vitest（既存S2-b受入確認用）、Node.js/Bunの`sha256`、既存`src/runtime/s2b-offline-adapter.ts`、既存`src/runtime/s1a-read-only-fs.ts`、Markdown/JSON・安全なローカルファイル。追加外部サービスや新規依存なし。

**Spec:** `docs/superpowers/specs/2026-11-10-justice-v6-s2c-controlled-native-comparison-design.md` (Design R0.1, `baa2f2024a53ec81af1b53572e4fb230bf0b72af`, Issue [#373](https://github.com/yohi/justice/issues/373), PR [#380](https://github.com/yohi/justice/pull/380))。

**Plan status:** `PLAN_DRAFT_FOR_OWNER_DECISION / EVALUATION_NOT_RUN / EXECUTION_BLOCKED`。既知のReview判定: `READY (Design only)` / `DOCUMENT_READY_WITH_BLOCKERS` / `Implementation Readiness: BLOCKED` / `Required Findings: 0`。Design訂正不要。**この計画文書は現在の作業コンテナにのみ作成し、GitHubへCommit/Pushしていない。**

## Global Constraints

- **最初のSTOP:** 実証・データ収集・機密除去処理・モデル呼出し・テスト実行・ファイルのGitHub反映は、Human OwnerがHost、権限、Secrets、Network、費用、出力先、停止条件、対象Version/Commitを個別承認するまで禁止。計画の承認と実行承認を区別する。
- **固定入力:** OpenCode `v2.2.5`の保存済み`session.get` + 無フィルタ`session.message.list`各ページのAPI応答（Session Export/DB直読/Live GETは禁止）、既存Manifest/TaskIntent/Design/Plan/AC、呼出し側が**独立に**固定したManifest SHA-256、明示Task/Message/Tool/AC Correlation。Superpowersの実稼働Version/Commitは確認できた値だけ記録する。
- **S2-b:** `S2bRequest = {loaderInput: LoaderInput, sourcePath: string, correlationPath: string}`。`runS2bOfflineAdapter(request, source): Promise<S2bReportV1>`、`createS1aReadOnlySource(): S1aReadOnlySource`、`formatS2bJson(report): string`を再利用。**1 invocation = 1 LoaderInput = 1 TaskIntent**、複数Taskの自動結合なし。生IDをReportで捏造せず、Locationは入力／安全な対応表のみで確認。
- **結果の境界:** `adapter.status = REJECTED | LIMITED | PROJECTED`、`coverageCompleteness = NOT_ESTABLISHED`、`diffProjection = UNAVAILABLE`。`REJECTED`では`s1d`なし、`LIMITED`/`PROJECTED`では`s1d`あり（既存契約通り）。S1-c `formalVerdict=UNKNOWN`、Owner承認`NOT_PROVEN`、真正性`NOT_VERIFIED`を成功へ昇格させない。`FOREIGN_TASK_EXCLUDED`は単なる正常除外でも生じるためTPにならない。
- **データ境界:** 原本Session/Artifact/Git履歴は変更しない。非公開コピー以外に注入しない。すべての入力・Ground Truth・レビュー回答・出力Reportは、承認されたアクセス制限下の**リポジトリ外**ワークスペースに保存し、PR・Issue・ログへSecretや生Tool/Message/Diffを転載しない。
- **比較:** 6固定ケース（P-01 / N-01〜N-05）。レビュアーには中立`caseKey`だけを渡す。両アームに同一の基礎入力・レビュー指示・モデルID/Version・effort・ツール許可・制約を与え、Justice側だけに**事前指定したTextまたはJSONの一形式**の固定S2-bレポートを追加。Ground Truthは回答固定まで隠す。
- **厳格採点:** 正しい種類・正しい対象・根拠がすべて揃った時のみTP。一般的な異常警告、単なる`REJECTED/LIMITED/UNKNOWN`、除外件数だけはTPではない。FN/FP/TN/比較不能/未実行/未計測を分け、Justiceが悪化させたケースも記載する。6件から統計的優位を主張しない。
- **停止:** Secret漏洩、非承認書込み・Agent起動、原本破壊、Ground Truth漏洩、版不一致、入力の同一性崩壊時は該当操作を停止し`ABORTED/NOT_RUN`を記録。再実行・ケース追加・レビュー連鎖を自動開始しない。

## Review Focus — five high-risk inputs/conditions

1. **Version/Identity矛盾:** `hostVersion != "2.2.5"`、Session ID/TaskIntent/Manifest digest不一致時は実証比較を行わず、原因と`NOT_COMPARABLE`を記録（Task 1・3の確認）。
2. **秘匿化で重要Identifier消失:** Message/Tool/AC対応が復元不能なら、推測対応ではなくケース不成立として停止（Task 1・2）。
3. **N-02旧Revisionの単純Foreign除外:** `FOREIGN_TASK_EXCLUDED`や`PROJECTED`だけでTPとしない（Task 2・5）。
4. **欠測・競合で`REJECTED` / 部分`LIMITED`:** S1-d不実行や限定集合を実行失敗・全履歴での欠測証明と混同しない（Task 3・5）。
5. **ブラインド漏洩または実行条件不一致:** Case ID/ファイル名/プロンプト/前の回答からGround Truthが漏れた、またはモデル設定が一致しないアームは直接比較不能（Task 4）。

## File and interface map (future execution artifacts, not created by this plan)

以下の`$S2C_WORKSPACE`は**Ownerが承認するリポジトリ外の非公開ディレクトリ**。任意の実運用パスをこの文書で決め打ちしない。`caseKey`には正解を示す`P-01`/`N-01`等の文字列を使わない。

| File / location | Responsibility | Producer |
| --- | --- | --- |
| `$S2C_WORKSPACE/authorization.md` | 承認されたHost、対象範囲、Secrets/Network、予算、STOP、許可コマンドの記録 | Task 1 |
| `$S2C_WORKSPACE/identity.json` | 固定Commit/Version、基準Source・Artifact各SHA-256、対象Task/Session、入力の完全性限界 | Task 1 |
| `$S2C_WORKSPACE/baseline/` | 機密除去済み保存API JSON、Correlation、S1 Artifact、独立Manifest digest | Task 1 |
| `$S2C_WORKSPACE/cases/<opaque-case-key>/`（6個） | 複製された`source.json`、`correlation.json`、固定S1入力、各SHA-256。1主注入/ケース | Task 2 |
| `$S2C_WORKSPACE/private/ground-truth.json` | 6ケースと正解種別・対象ロケータ・注入差分・ハッシュの対応。レビュアーから分離 | Task 2 |
| `$S2C_WORKSPACE/justice-reports/<caseKey>.json` | 既存S2-bの固定JSON出力（1形式に固定）、schema/状態/出力ハッシュ | Task 3 |
| `$S2C_WORKSPACE/responses/<caseKey>-native.json`, `...-justice.json` | 独立レビュー回答・設定・時間/費用・ハッシュ | Task 4 |
| `$S2C_WORKSPACE/scoring.md` | Ground Truth解除後の厳格TP/FP/FN/TN、比較不能、純増・悪化 | Task 5 |
| `docs/reports/YYYY-MM-DD-justice-v6-s2c-limited-comparison.md` | **実行後、別途承認された保存先にのみ**記録する公開可能な限定レポートの候補名。初期は非公開成果を基に作成 | Task 5 |

**既存API ledger（変更禁止）:**

```ts
// src/core/s1a/contract.ts
interface S1aReadOnlySource {
  readInputFile(path: string, maxBytes: number): Promise<Uint8Array>;
  readArtifact(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array>;
}
interface LoaderInput {
  readonly manifestPath: string;
  readonly expectedManifestSha256?: string;
  readonly intentPath: string;
  readonly artifactsRoot: string;
}
// src/runtime/s2b-contract.ts
interface S2bRequest {
  readonly loaderInput: LoaderInput;
  readonly sourcePath: string;
  readonly correlationPath: string;
}
// src/runtime/s2b-offline-adapter.ts
runS2bOfflineAdapter(request: S2bRequest, source: S1aReadOnlySource): Promise<S2bReportV1>
formatS2bJson(report: S2bReportV1): string
// src/runtime/s1a-read-only-fs.ts
createS1aReadOnlySource(): S1aReadOnlySource
```

**No product source edits.** `src/core/**`、`src/runtime/**`、既存S2-b/S1-dテスト、package設定、Gate等はこの計画で変更しない。`runS2bOfflineAdapter`を呼ぶために新しいRunnerが必要なら、**承認済みの一時的・非公開の評価用Runner**だけを使い、ビジネスロジックを再実装しない。新CLI/公開APIの実装が必要ならそこでSTOPしOwnerに別判断を求める（自動拡張しない）。

---

### Task 1: Authorization, source selection, and immutable baseline

**Files:** `$S2C_WORKSPACE/authorization.md`, `identity.json`, `baseline/`。リポジトリのソース変更なし。

**Interfaces:** Consumes Design R0.1、S2-b既存実装、Ownerの個別実行承認。Produces凍結済みSource / Artifact identityとS2-b実行条件をTask 2〜5へ渡す。

- [ ] **Step 1: 承認ゲートを確認。** OwnerがHost/Version/Operation、実データ読取り、コピーと秘匿化、モデル/費用、Secrets/Network、出力先、STOP、テスト実行許可を具体的に承認していなければ**ここで終了**（`EXECUTION_BLOCKED`）。推測承認なし。
- [ ] **Step 2: 版と入力を選定。** 実開発由来の保存API JSONとSuperpowers Artifactの実際のVersion、S2-b実行Commit、1 TaskIntentとそのTask/Revision/Scope/AC、Session/Message/Toolの明示対応を確認。`hostVersion="2.2.5"`の申告と実Host版の独立証拠を分ける。
- [ ] **Step 3: 原本読取り・機密除去と固定。** 承認済み場所だけにコピーし、Message/Tool/Task/AC同一性を維持したまま秘匿化。Manifestの期待SHA-256は原本Manifestの内容から実行時に黙って補填せず、別の正本・Owner指定値と照合する。
- [ ] **Step 4: Identityチェック。** `identity.json`に各入力のSHA-256、File Role、収集範囲・既知の欠測を記録。対象ファイルに対して`sha256sum`等で再計算一致を確認し、符号化・再シリアライズによるbyte driftがあればSTOP。
- [ ] **Step 5: 入力契約の限定検証。** 明示TaskIntentが読める、Session IDがSource/Correlationで一致、先頭ページからcursor連続、機密除去でTool識別子が消えていないことをチェック。NGなら`NOT_ASSESSABLE`で停止。既存S2-bユニットテストは**別途許可された場合のみ**`bun run vitest run tests/s2b`、`bun run typecheck`を実行し、実結果を記録。未実行はPASSとしない。

**Deliverable/stop:** 事前承認＋追跡可能なベースラインが存在する場合のみ次Taskへ。固定できなければ安全に終了してOwner判断。

### Task 2: Exactly six immutable cases and blinded Ground Truth

**Files:** `$S2C_WORKSPACE/cases/<caseKey>/`×6、`$S2C_WORKSPACE/private/ground-truth.json`。

**Interfaces:** Consumes Task 1の読み取り専用baseline。Produces6つの固定入力と`caseKey → {expectedType, expectedTargets[], injection, inputSha256}`の非公開照合。診断アームには真値のファイルを渡さない。

- [ ] **Step 1: 正常ケース** `P-01`をベースライン無変更の複製で作り、Task/Revision/Scope/AC/Tool明示対応が整合することを確認。
- [ ] **Step 2: N-01** 単一Messageへ相互に矛盾するTask帰属を与え、対象Messageと2つのTaskをGround Truthに記録。通常のForeign Task除外だけのケースにしない。
- [ ] **Step 3: N-02** 意図した選択Task Bindingの`taskRef.revision`だけを旧Revisionへ置き換え、現在Task/旧Revision/対象Message/Toolを固定。`FOREIGN_TASK_EXCLUDED`だけではTPとしないことを事前記録。
- [ ] **Step 4: N-03** 選択Task Bindingの1個のTool `acRef`を選択Intentにない安全なAC Refに置換。対象Tool/ACを固定。
- [ ] **Step 5: N-04** 保存Collection内の1個の選択Toolを、Message形状を壊さずに除去し、対応する明示Bindingは残す。保存ページ列の連続性を維持し、`MISSING_TOOL`の対象Message/Toolを固定。
- [ ] **Step 6: N-05** 同じ選択Message内のTool ID重複など局所競合を注入。競合したMessage/Toolと影響候補を固定。グローバルなschema崩壊を意図的に作らない。
- [ ] **Step 7: 6件を検査・封印。** 各ケースは**主注入1件**、基準からの注入以外のSource/Artifact差分なし。Source/Correlation構文、Session ID、保存Messageページ列、原本SHAを再照合し、6件すべてのCase単位hashと真値を結果閲覧前に固定。入力バイトの再生成・期待結果の後付け変更は禁止。
- [ ] **Step 8: ブラインド化検証。** 6つの中立`caseKey`に置換し、レビュー用のパス・ファイル名・本文・指示に`P-01`/`N-01`等の正解ラベル、注入手順、Ground Truthがないことを確認。

**Deliverable/stop:** 対応表・真値・ハッシュが固定された6件のみ。適切に注入できないケースは`NOT_ASSESSABLE`とし、代わりのケースを自動追加しない。

### Task 3: Existing S2-b report generation and bounded diagnostics

**Files:** `$S2C_WORKSPACE/justice-reports/<caseKey>.json`×6、Task 1のIdentity追記。

**Interfaces:** `runS2bOfflineAdapter(S2bRequest, createS1aReadOnlySource())` → `S2bReportV1` → `formatS2bJson(report)`。File PathsはTask 2で固定された絶対位置を渡す。出力報告のためだけに一時Runnerを利用する場合もアプリの`src/`を変更しない。

- [ ] **Step 1: 既存関数の最小呼出し**をOwner承認環境でのみ実行。`S2bRequest.loaderInput`はケースごとの既存Artifactと独立指定Manifest SHA-256、`sourcePath`は保存Source wrapper、`correlationPath`は明示対応のコピー。入力は一TaskIntentずつで、外部API呼出しを行わない。
- [ ] **Step 2: 1ケースずつ保存。** `formatS2bJson(report)`だけを比較用に固定し、ケースごとに出力bytes/SHA-256、`adapter.status`、診断コードと件数、`s1d`有無を記録。`REJECTED`は`s1d`なし、`LIMITED/PROJECTED`は`s1d`ありであることを検査。
- [ ] **Step 3: 保証境界を検証。** 全件で`coverageCompleteness=NOT_ESTABLISHED`、`diffProjection=UNAVAILABLE`を維持し、S1-cに正式PASSが生じないことを確認。`REJECTED/LIMITED/PROJECTED`をTP/TNに自動変換しない。
- [ ] **Step 4: 安全性・出力境界の確認。** Agent生Message、Tool生Content、Diff patch、Secret、Host絶対パス、例外本文がレポートに無い。IDが匿名化され、Ground Truth側の安全なマッピングでのみ対象照合できることを確認。NG時は当該配布・レビューをSTOP。
- [ ] **Step 5: 6入力・6レポートのIdentity固定。** 実行条件と出力ファイルSHAを照合し、既存S2-bが検出種別/対象ロケータを表現できない場合も事実として記録。後付けのレポート整形・再実行で都合のよい結果に差し替えない。

**Deliverable/stop:** 6件の固定レポートまたは明示された不成立記録。S2-bの入力拒否や匿名性限界は結果であり、自動修正Taskではない。

### Task 4: Independent Native-only / Native + Justice reviews

**Files:** `$S2C_WORKSPACE/responses/<caseKey>-native.json`×6と`<caseKey>-justice.json`×6、実行条件・順序ログ。

**Interfaces:** Task 2の同一基礎入力 + Task 3の固定Report、次の共通回答契約を両アームで使用（**評価専用**、Justice公開APIではない）。

```ts
type ReviewAnswer = Readonly<{
  caseKey: string;
  finding: readonly Readonly<{
    type: string;
    target: string;  // 安全なTask/Revision/Message/Tool/AC locator
    basis: string;   // 提供済み入力の位置・根拠（Secretを再掲しない）
    confidence: string;
  }>[];
  noFinding: boolean;
  uncertainty: readonly string[];
  sourceUse: readonly string[];
}>;
```

- [ ] **Step 1: 共通条件を事前固定。** Modelの正確なID/Version、effort・可調節seed/temperature、許可Tool、時間/費用上限、レビュープロンプト、回答schema、停止条件、ケース実行順序（交互順等）を記録。制御不能な要素は制御不能と書く。
- [ ] **Step 2: 同じ基礎入力を両アームへ渡す。** Native-onlyにはJustice関連資料や先行回答を渡さない。Native + Justiceには、同じ基礎入力に**Task 3で選定・固定したJSONレポート1件のみ**を追加。双方に明示的な不整合検出指示を同等に与える。追加トークンは負荷として記録。
- [ ] **Step 3: 別コンテキストで実行。** 6ケース×2アームの結果を新規独立コンテキストに収集し、会話履歴・先行診断が混じらないようにする。実際のモデル/許可Tool/順序と走行可否を記録。モデルからの実Host操作・未許可書込みは禁止。
- [ ] **Step 4: 回答を固定。** `ReviewAnswer`の必須項目、未確認事項の明示、回答bytes/hash、コスト/時間（測れなければ`NOT_MEASURED`）を記録。**回答固定前にGround Truthを見せない**。条件逸脱や漏洩があれば該当ペアを`NOT_COMPARABLE`としてSTOPし、後付け再試行しない。

**Deliverable/stop:** 12個の固定レビュー回答（実行できないものは`NOT_RUN/ABORTED`の記録）。公平性の不一致は隠さず比較不能にする。

### Task 5: Strict scoring and minimal Owner decision report

**Files:** `$S2C_WORKSPACE/scoring.md`、承認された保存先の限定レポート1件。

**Interfaces:** Task 2の封印真値＋Task 3固定Report＋Task 4固定回答。外部への書込みは保存先まで個別に許可された場合のみ。

- [ ] **Step 1: 二つの回答のhash固定を確認した後にGround Truthを解除。** 種類・対象・根拠の3条件を照合する。匿名IDが安全な照合表と対応せず対象を特定できなければTPとはしない。
- [ ] **Step 2: ケース別採点。** 比較可能なN-01〜N-05では`TP`または`FN`を決め、根拠のない別箇所断定を`FP`として併記。P-01は不正の誤検知なしを`TN`、誤検知ありを`FP`。`UNKNOWN`保持と過大保証主張は別欄で記録。比較不能はTP/FNの分母に混ぜない。
- [ ] **Step 3: Justiceの純増/悪化を抽出。** `Native FN -> Justice TP`と`Native TP -> Justice FN`、Justice側のみのFP、保証過大主張、追加時間・トークン・費用を**同じ優先度**で表にする。両者TPはJustice固有の検出実績にしない。
- [ ] **Step 4: 限定レポートをまとめる。** `Execution Conditions / Case-level Results / Owner Decision Brief`の三部だけ。S1-e Functional、Native Capability、S2-c Operational Effectivenessを別欄で示し、未計測は`NOT_MEASURED`。比較不能・非対象・未実行は各々の数を記録。Secretを含む入力・真値表・生ログは公開レポートへ転記しない。
- [ ] **Step 5: 完了・停止の判定。** 6ケースを事前固定ルールで評価した範囲の観測結果と限界が分かり、Ownerが「S2をここで終了／限定採用／価値不足で非採用／追加検証を個別承認」のいずれかを選べるなら終了。閾値やFindingゼロを要求せず、次のReview/Fix、再実行、S3を自動起動しない。

**Deliverable/stop:** Owner判断に足る単一の限定実証レポート。Host利用や比較が承認されなければ実証は行わず、Plan作成で終了する。

## Crosswalk: Design ↔ Plan (readiness check)

| Design R0.1 | Plan | Contract consistency |
| --- | --- | --- |
| §1 Purpose / 非目標 | Goal, Global Constraints, Task 5 | 6ケースのみ、実証された結果だけ、意味的コード乖離は非対象 |
| §2 決定済み7方針 | Global Constraints, Task 2〜5 | 件数・注入・独立比較・厳格TP一致 |
| §3 S2-b境界 | API ledger, Task 1 / 3 | `UNAVAILABLE`、`UNKNOWN`、1 TaskIntent、真正性非昇格 |
| §4 固定Session・Ground Truth | Task 1 / 2 | Byte固定、匿名キー、基準原本不変更、秘匿化 |
| §5 比較条件 / 回答schema | Task 4 | 同一Native Source、独立コンテキスト、差分はJustice Reportのみ |
| §6 TP/FP/FN/TN | Task 5 | 種類＋対象＋根拠、`NOT_COMPARABLE`別集計 |
| §7 単一レポート | Task 5 | 3部構成、Owner判断材料、未計測分離 |
| §8 実行承認・停止 | Task 1 / Global STOP | 事前承認がなければ一切実行しない |
| §9 残余リスク | Task 2 / 3 / 5 | N-02特有の識別限界・少数ケース・Host真正性未証明 |

## Completion / Human Owner checkpoint

**このwriting-plans Taskの完了条件:** Design R0.1に対応する、具体的な5つの実証Taskとファイル責務、既存API・検証・エラー分類・非機能・STOP・採点ルールを明記したPlan文書を提示すること。**この文書の存在はPlanの正式採択や実証着手承認ではない。**

**未承認:** PlanのGitHubへのCommit/Push、実Host/実Session読取り・機密除去、Dataset作成、実モデルレビュー、Build/Test/CI、ソース変更、PR、Issue更新、Gate/HOLD、S3開始。

**停止条件:** 別の実証範囲または新CLI／新診断機能を要することが分かった場合は、ここで止めてOwner判断とする。追加Findingが出てもレビュー→訂正→再レビューを自動連鎖させない。

**推奨:** このPlanをOwnerが確認し、実証を本当に行う場合にだけ、対象環境・費用・Secret境界を指定した実行承認を与える。そうでなければ**今回の文書作成で終了可能**。
