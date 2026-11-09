# Justice v6 S2-b Offline READ_ONLY Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (Native) or `superpowers:subagent-driven-development` **only after separate Human Owner implementation authorization**. Steps use `- [ ]` checkboxes. No task, review, GitHub write, or Host Probe is authorized by this document alone.

**Goal:** 保存済みOpenCode v2.2.5 Session/Message API JSONと明示的Task/Message/Tool/AC対応を、誤帰属・欠測・真正性の保証昇格なしに、既存Justice S1-a〜dのREAD_ONLY診断へ接続する。

**Architecture:** 一つのTaskIntentを選択し、固定版API応答・ページ収集情報・Correlationを独立検証した後、一意で安全なAssistant Toolのみ`EvidenceRefV1[]`へ投影する。初期MVPのChangeSetは常に`UNAVAILABLE`。同一TaskIntent原本Bytesを固定して`runS1dDiagnostic()`へメモリ上の`S1aReadOnlySource`から供給し、S1-d Reportを無改変でS2-bの診断ラッパーに収める。

**Tech Stack:** TypeScript/ESM、Node.js `crypto`/`TextEncoder`、既存の`bun`・Vitest・`tsc`・ESLint。既存S1-a〜d Core、既存`parseStrictJson()`、`parseTaskIntent()`、`S1aReadOnlySource`を再利用。新規依存なし。

**Spec:** `docs/superpowers/specs/2026-11-09-justice-v6-s2b-offline-read-only-adapter-design.md` — **Design R0.1.2**、Reviewed HEAD `3a061f3853a0d16213e01d1744b43d6f876a4aff`、Blob SHA `f9af9a699191f8b115c0807bfb9694737e395643`、Issue `yohi/justice#372`。S2-a固定Source commit `5b47d6792f3296c7c9eef7267aa20d98ee842e26`、OpenCode `v2.2.5`、Superpowers `v7.0.1`。Review Gate: `DOCUMENT_READY`、Blocking 0、**Implementation Authorization: HOLD**。

**Plan status:** `PLAN_DRAFT_FOR_OWNER_DECISION`。Human OwnerはDesign R0.1.2採択と**本Plan文書の作成のみ**を承認した。以降のコード編集、テスト実行、Commit/Push/PR、Host Probe、Gate変更は別途明示承認が必要。

## Global Constraints

- 1診断＝1`LoaderInput`＝1`TaskIntent`。Foreign Taskの正常ACを選択TaskのACで検証せず、`FOREIGN_TASK_EXCLUDED`に集計。選択前に全Bindingの構造・重複・Message Task競合を検査し、無効BindingをForeign除外で救済しない。
- 固定入力: `session.get`保存応答、`session.message.list`の各応答と取得Request、任意の`session.diff`保存応答、明示Correlation JSON、既存S1 Artifact、独立指定Manifest SHA-256。**Live API、Session Export、DB直読、Child自動統合は禁止。**
- `messagePages`: 初回`order=asc`かつ`type`/`cursor`キーなし、後続は`cursor.next`のみ（`order`/`type`キーなし）。`type`キー存在は`UNSUPPORTED_FILTERED_COLLECTION`で**Collection全体をREJECTED**。
- `PAGINATION_COMPLETE`は保存ページ列の連続性のみ。`PAGINATION_INCOMPLETE`で要求Message不在を`MISSING_MESSAGE`と断定しない。検証済みprefix以外を投影しない。
- Correlation: `(sessionId,messageId)`はTask最大1件、Evidence識別は`(sessionId,messageId,toolId)`。Tool→ACは個別に明示され、未対応/衝突はEvidenceにならない。Child Sessionは独立Collection/Correlationが必要。
- `REJECTED`→S1-d呼出し0回/`s1d`キーなし。`LIMITED`→選択Taskの有効Evidence≥1件、部分欠測または一部候補拒否、呼出し1回/`s1d`あり。`PROJECTED`→ページ列完全かつ全明示選択候補の検証済み、呼出し1回/`s1d`あり（明示候補0件を含む）。正常Foreign除外のみで`LIMITED`にしない。
- **P-001:** 選択用のTaskIntent原本BytesとS1-d入力のTaskIntent原本Bytesを**同一固定スナップショット**とし、食い違い/仮想パス衝突は`REJECTED`でS1-d呼出し0回。新規Owner承認の証拠とはしない。
- `ChangeSet`は初期MVPで常に`{ "availability":"UNAVAILABLE" }`。Diffの内容・空配列・Snapshot文字列・`sessionAfter`の一致から`PRESENT`を推定しない。既存S1-cの`formalVerdict: UNKNOWN`を保持。
- `EvidenceRefV1`: `type:"other"`、`provenanceClass:"UNVERIFIED_EXTERNAL"`、`reportedOutcome:"UNKNOWN"`、`reportedExecutionState`は`completed && executed === true`のときのみ申告`EXECUTED`、その他`UNKNOWN`。Owner/Host実行・AC PASSの証明をしない。
- 入力上限（UTF-8実バイト）: Session GET各1,048,576、Message page応答各4,194,304・最大64ページ・応答合計67,108,864、各ページ最大200 Message・Collection計4,096、Correlation 262,144、Binding 512・MessageあたりTool 64・Tool合計2,048。Diff応答最大2,097,152・最大128件。Evidence上限128件・出力JSON 1,048,576、ChangeSet JSON 262,144。必須入力/投影の上限超過は全件`REJECTED`（切捨て禁止）、任意Diff単体の不正は`UNAVAILABLE`に限定。S1-a既存上限を変更しない。
- Raw Message/Tool/Diff patch・任意例外文・Secret・Host絶対パスをText/JSONへ出さない。IDは安全な匿名トークンに変換。決定論的なソート、固定診断コードと件数のみを公開する。
- 既存S1 Core・S1-d Report/Reason Code/Exit Code・Gateを変更しない。新CLI、Package exports変更、永続Store、Framework、実Hostへの接続、S2-cは初期MVPの範囲外。
- Superpowers First/OpenCode Native First。初回実装時の小さなTDDサイクルは使うが、レビュー連鎖・新しいFindingによる自動Task生成はしない。Human OwnerのCheckpoint以外で工程を増やさない。

## Decision traceability（既採用の5判断を継承）

| Adopted Design decision | Planでの固定先 |
|---|---|
| `S2B_INITIAL_INPUT_SAVED_API_RESPONSE_JSON_V225` | Global Constraints、Task 1 / 5。保存済みAPI応答のみ |
| `S2B_EXPLICIT_MESSAGE_ID_TASK_CORRELATION` | Task 3 / 4。TaskはSession+Message、EvidenceはSession+Message+Tool |
| `S2B_MESSAGE_CENTRIC_EXPLICIT_CORRELATION_V1` | Task 3。Message→Task、その配下のTool→AC |
| `S2B_PAGED_MESSAGE_API_RESPONSE_WITH_COLLECTION_METADATA_V1` | Task 1 / 2。ページ単位・Request/Response連続性 |
| `S2B_UNFILTERED_MESSAGE_COLLECTION_V1` | Task 1 / 2。全種別保存、`type`付き拒否 |

## File map / responsibility

| Path | 作業 | 単一の責務 |
|---|---|---|
| `src/runtime/s2b-contract.ts` | Create | S2-b独自入出力型・制限値・固定診断コード。S1既存型はimportして再定義しない |
| `src/runtime/s2b-input.ts` | Create | 保存済みJSONのbounded/strict parse、OpenCode v2.2.5形状、ページ連続性とprefixのSource Validation |
| `src/runtime/s2b-projector.ts` | Create | 全Correlation構造検証→Task選別→選択AC照合→Evidence投影・status判定 |
| `src/runtime/s2b-offline-adapter.ts` | Create | TaskIntent固定スナップショット、S1-d仮想入力ブリッジ、Wrapper Text/JSON形成・サニタイズ |
| `tests/s2b/fixtures.ts` | Create | 既存`tests/helpers/s1a-fixtures.ts`再利用＋v2.2.5保存応答の最小有効Fixture builder |
| `tests/s2b/input.test.ts` | Create | Source/ページ/上限/Filterの単体検証 |
| `tests/s2b/projector.test.ts` | Create | Correlation・誤帰属・状態遷移・投影の単体検証 |
| `tests/s2b/adapter.test.ts` | Create | P-001、S1-d呼出し契約、出力・秘匿・統合検証 |

**変更しない既存ファイル:** `src/core/s1a/**`、`src/core/s1b/**`、`src/core/s1c/**`、`src/core/s1d/**`、`src/runtime/s1d-*.ts`、既存CLI、`package.json`、各種Gate。実装で公開CLIが必要になった場合も、今回のPlanを無断拡張しない。

## Interface ledger（Task間の厳密な引継ぎ）

本節の型・関数名を後続Taskでも変更せず使用する。実装で形状を厳密化しても、S1型の意味や値を拡張しない。

```ts
// src/runtime/s2b-contract.ts（S1既存型はimport）
import type { LoaderInput, S1aReadOnlySource, TaskIntent } from "../core/s1a/contract.js";
import type { EvidenceRefV1 } from "../core/s1b/contract.js";
import type { S1dReportV1 } from "../core/s1d/contract.js";

export type S2bStatus = "REJECTED" | "LIMITED" | "PROJECTED";
export type CollectionStatus = "PAGINATION_COMPLETE" | "PAGINATION_INCOMPLETE";
export type DiagnosticCode =
  | "SOURCE_VERSION_UNSUPPORTED" | "SOURCE_SCHEMA_INVALID" | "SOURCE_IDENTITY_MISMATCH"
  | "UNSUPPORTED_FILTERED_COLLECTION" | "PAGINATION_INCOMPLETE" | "CONFLICT"
  | "FOREIGN_TASK_EXCLUDED" | "UNMAPPED" | "MISSING_MESSAGE" | "MISSING_TOOL"
  | "NOT_ASSISTANT_MESSAGE" | "CORRELATION_MISMATCH" | "DIFF_UNAVAILABLE"
  | "EVIDENCE_LIMIT_EXCEEDED" | "INPUT_LIMIT_EXCEEDED";
export type S2bDiagnostic = Readonly<{ code: DiagnosticCode; count: number }>;
export type S2bRequest = Readonly<{
  loaderInput: LoaderInput;
  sourcePath: string;       // justice-s2b-source-v1 wrapper JSON
  correlationPath: string;  // justice-s2b-correlation-v1 JSON
}>;
export type ValidatedSource = Readonly<{
  sessionId: string; collectionId: string;
  collectionStatus: CollectionStatus;
  lastValidatedPageIndex: number | null;
  validatedPageCount: number;
  // 生の取得ページ列のうち、先頭から連続・検証済みのMessageのみ
  messages: ReadonlyArray<Readonly<Record<string, unknown>>>;
  diagnostics: readonly S2bDiagnostic[];
}>;
export type SourceResult = Readonly<{ state: "REJECTED"; diagnostics: readonly S2bDiagnostic[] }>
  | Readonly<{ state: "ACCEPTED"; value: ValidatedSource }>;
export type CorrelationBinding = Readonly<{
  messageId: string;
  taskRef: Readonly<{ artifactId: string; revision: string }>;
  scopeKey: string;
  tools: readonly Readonly<{ toolId: string; acRef: Readonly<{ artifactId: string; revision: string }> }>[];
}>;
export type CorrelationResult = Readonly<{ state: "REJECTED"; diagnostics: readonly S2bDiagnostic[] }>
  | Readonly<{ state: "ACCEPTED"; sessionId: string; bindings: readonly CorrelationBinding[]; diagnostics: readonly S2bDiagnostic[] }>;
export type Projection = Readonly<{
  status: S2bStatus;
  evidenceRefs: readonly EvidenceRefV1[];
  diagnostics: readonly S2bDiagnostic[];
  // 付加的なS2-b出力に含めるIdentityは匿名の安全トークン。
  projectionScope: Readonly<{
    sessionId: string; collectionId: string;
    taskRef: Readonly<{ artifactId: string; revision: string }>;
    scopeKey: string;
    firstPageIndex: 0 | null;
    lastValidatedPageIndex: number | null;
    validatedPageCount: number;
    selectedMessageCount: number;
    projectedEvidenceCount: number;
  }>;
  counts: Readonly<Record<string, number>>;
}>;
export type S2bReportV1 = Readonly<{
  schemaVersion: "justice-s2b-report-v1";
  adapter: Readonly<{
    status: S2bStatus;
    collectionStatus: CollectionStatus | "NOT_EVALUATED";
    selectedTaskRef?: Readonly<{ artifactId: string; revision: string }>;
    projectionScope: Projection["projectionScope"];
    coverageCompleteness: "NOT_ESTABLISHED";
    counts: Projection["counts"];
    diagnostics: readonly S2bDiagnostic[];
    diffProjection: "UNAVAILABLE";
  }>;
  s1d?: S1dReportV1;
}>;
```

**公開実装関数（S2-b専用ファイルからexport）:** 

```ts
// s2b-input.ts
export function validateS2bSource(raw: Uint8Array): SourceResult;
export function validateS2bCorrelation(raw: Uint8Array): CorrelationResult;
// s2b-projector.ts
export function projectS2bEvidence(
  source: ValidatedSource,
  correlation: Extract<CorrelationResult, { state: "ACCEPTED" }>,
  selected: TaskIntent,
): Projection;
// s2b-offline-adapter.ts
export async function runS2bOfflineAdapter(
  request: S2bRequest,
  source: S1aReadOnlySource,
  runS1d?: typeof import("./s1d-diagnostic.js").runS1dDiagnostic,
): Promise<S2bReportV1>;
export function formatS2bJson(report: S2bReportV1): string;
export function formatS2bText(report: S2bReportV1): string;
```

**実装の内部読み取り契約:** S2-bは`sourcePath`で最大**75,497,472 bytes（72 MiB）のCollection wrapper**をread-onlyで取得し、原文上の埋込`session.response`/`messagePages[i].response`/`diff.response`の**生UTF-8 byte span**と件数を検査する。必要上限を超えた場合、対象の`parseStrictJson`前に拒否する。まず文書全体のbounded readで巨大入力を拒否し、最小のJSON文字列/エスケープ対応字句走査で該当Responseの原文境界を識別して厳密に算定し、`parseStrictJson()`で重複キー・UTF-8・深さを検査する。`JSON.stringify()`後の縮小サイズを「原文サイズ」として代用しない。これは新規Frameworkではなく既存入力Readerの限定補助。`correlationPath`は最大262,144 bytesで同じ厳格JSON解析。各`readInputFile`は要求上限を超える返値も呼出し側で再検査する。

**仮想パス:** `s2b://evidence`, `s2b://changeset`（他の実パス・`loaderInput`の実パスと完全一致してはいけない）。`sourcePath`/`correlationPath`/`loaderInput`のパスが同一の入力役割を曖昧化する場合もS1-d実行前に拒否する。`S1aReadOnlySource.readInputFile()`は選択済みTaskIntentの固定コピーに対して、`loaderInput.intentPath`だけを優先返却し、上限を満たす`Uint8Array.from(...)`を毎回渡す。ManifestとArtifactは既存read-only sourceへ委譲する。同一パスの競合や固定Bytesとの不一致が検出されればS1-dを呼ぶ前に`REJECTED`。**TaskIntentの後続実ファイル再読込はしない**（P-001）。

## Review Focus（仕様から導出した5つの優先入力リスク）

1. **正常Foreign TaskのACが選択Taskに存在しない:** `CORRELATION_MISMATCH`でなく`FOREIGN_TASK_EXCLUDED`、選択Taskの投影と診断は続く（Task 3 / T17）。
2. **同一Messageの競合をForeign選別で隠そうとする:** 選択前に衝突を検出して対象候補を拒否。全体一意性不明ならREJECTED（Task 3 / T04）。
3. **ページは完全だが一部選択Toolが欠落:** 有効Evidence≥1なら`LIMITED`、0なら`REJECTED`。`PROJECTED`にしない（Task 4 / T18,T19）。
4. **TaskIntentが選択後に書き換わる／Sourceが異なるBytesを返す:** P-001のスナップショットをS1-dへ使い回し、差分/衝突はS1-d未呼出しで拒否（Task 5 / P-001）。
5. **安全な部分投影だがRaw Toolに秘密が入る:** Text/JSONには固定診断・件数と匿名トークンだけを公開し、S1-dの結果は本体無改変（Task 5 / T14）。

---

### Task 1: Bounded strict input / fixed v2.2.5 response validation

**Files:** Create `src/runtime/s2b-contract.ts`, `src/runtime/s2b-input.ts`, `tests/s2b/fixtures.ts`, `tests/s2b/input.test.ts`.

**Interfaces:** Produces `validateS2bSource(raw):SourceResult` and `validateS2bCorrelation(raw):CorrelationResult` from the interface ledger. `SourceResult` returns a **contiguous validated prefix** and diagnostics; identity/version/filter/oversize violations are global rejection. `CorrelationResult` preserves full normalized bindings for Task 3 (do not apply selected AC semantics here).

- [ ] **Step 1: Write failing test** `sourceRejectsVersionFilterAndBadEnvelope`: assert unknown `hostVersion`, any page Request containing own `type` (including `null`), initial cursor present, subsequent `order` present, wrong Session ID, exported format, duplicate JSON object key all return `REJECTED`, and filtered source diagnoses `UNSUPPORTED_FILTERED_COLLECTION`.
- [ ] **Step 2: Run** `bun run vitest run tests/s2b/input.test.ts` — expected **FAIL** before implementation; this is future executable instruction, not an executed result.
- [ ] **Step 3: Implement** constants/types and `validateS2bSource`/`validateS2bCorrelation`. Validate exact source/correlation schema versions and v2.2.5 structurally necessary Session/Message/Assistant Tool/Tool state fields. Maintain raw API Response as supplied, never synthesize missing fields. Validate optional `sessionAfter`, `diff` independently; optional Diff invalidity is diagnostic-only `UNAVAILABLE`. Reuse `parseStrictJson` for duplicate keys/depth/UTF-8; cap raw wrapper and byte spans **before parse**. No external API or file write.
- [ ] **Step 4: Extend tests** `sourceLimitsAreFailClosed`: session 1MiB+1, page 4MiB+1, 65 pages, total response >64MiB, page 201 messages, Collection 4097, Correlation 256KiB+1, Binding 513, Tool per Message 65, Tool total 2049. Expect `REJECTED` without truncation; Diff 2MiB+1 yields Diff-only `UNAVAILABLE` if mandatory input valid. Include escaped UTF-8 and extra whitespace to show raw byte span counting rather than `JSON.stringify()` undercount.
- [ ] **Step 5: Run** `bun run vitest run tests/s2b/input.test.ts` — expected **PASS** after implementing this task; `bun run typecheck` — expected no new TypeScript diagnostics.
- [ ] **Step 6: Commit checkpoint (only if separately authorized for implementation/Git writes):** `git add src/runtime/s2b-contract.ts src/runtime/s2b-input.ts tests/s2b/fixtures.ts tests/s2b/input.test.ts && git commit -m "feat(s2b): validate saved v2.2.5 API inputs"`.

### Task 2: Contiguous page collection / completeness

**Files:** Modify `src/runtime/s2b-input.ts`, `tests/s2b/input.test.ts`.

**Interfaces:** Refines `SourceResult.value.collectionStatus`, `lastValidatedPageIndex`, `validatedPageCount`, and `messages`. Later tasks must never observe non-prefix or duplicate raw Message candidates as validated ones.

- [ ] **Step 1: Write failing test** `paginationRequiresOpaqueNextCursor`: first page `order:"asc"`, `limit`1〜200 constant, later pages Request cursor equals preceding Response `cursor.next` and contain neither `order` nor `type`; final page has no `next` →`PAGINATION_COMPLETE`.
- [ ] **Step 2: Run** `bun run vitest run tests/s2b/input.test.ts -t paginationRequiresOpaqueNextCursor` — expected **FAIL**.
- [ ] **Step 3: Implement** contiguous `pageIndex=0..n`, stable `sessionId`/`limit`, immutable opaque cursor linkage, repeat/cycle detection, Message ID uniqueness, `data` validity, `response.cursor` shape. Global identity/unsupported type detected across all captured metadata **before** prefix selection. On later missing/bad page accept only the first verified prefix with `PAGINATION_INCOMPLETE`; on corrupt first page, ambiguous global identity, overflow or impossible uniqueness return `REJECTED`. Do not use `cursor.previous` for traversal or infer missing messages.
- [ ] **Step 4: Add tests** `missingPageKeepsOnlyVerifiedPrefix`, `cursorMismatchOrCycleNeverConjuresLaterMessage`, `completeCollectionMissingIdIsDefinitiveOnlyForSavedCollection`, `incompleteCollectionDoesNotClaimMissingMessage` (T06–T08), `childSessionCannotJoinParent` (T05). Verify `PAGINATION_COMPLETE` is **not** rendered as Host full-history guarantee.
- [ ] **Step 5: Run** `bun run vitest run tests/s2b/input.test.ts` — expected **PASS**.
- [ ] **Step 6: Commit checkpoint, separate Owner authorization required:** `git add src/runtime/s2b-input.ts tests/s2b/input.test.ts && git commit -m "feat(s2b): validate message pagination prefix"`.

### Task 3: Correlation, safe Task selection, foreign binding exclusion

**Files:** Create `src/runtime/s2b-projector.ts`, `tests/s2b/projector.test.ts`; modify `src/runtime/s2b-input.ts` only if needed for strict normalization (no new Source types).

**Interfaces:** `projectS2bEvidence(source, correlation, selected:TaskIntent):Projection`. Correlation validity cannot depend on selected Task AC membership during structural validation. Selected intent comes from `parseTaskIntent(frozenIntentBytes)` in Task 5; unit tests can pass `TaskIntent` fixtures directly.

- [ ] **Step 1: Write failing test** `foreignTaskAcIsExcludedWithoutMismatch` (T17): one selected Task binding, one valid foreign Task binding whose `acRef` is **not** in selected `ac[]`. Assert only selected Evidence emitted; foreign count `FOREIGN_TASK_EXCLUDED=1`, no `CORRELATION_MISMATCH`, and no S1-b `TASK_NOT_SELECTED` reliance.
- [ ] **Step 2: Run** `bun run vitest run tests/s2b/projector.test.ts -t foreignTaskAcIsExcludedWithoutMismatch` — expected **FAIL**.
- [ ] **Step 3: Implement `projectS2bEvidence` in fixed order:** (1) validate all Binding keys/types/safe S1 identifiers, Tool IDs, `(sessionId,messageId)` duplicates, `(sessionId,messageId,toolId)` uniqueness; (2) detect Message Task ownership conflicts before selection; (3) filter by selected Task ID **and Revision and Scope**; (4) count valid foreign as `FOREIGN_TASK_EXCLUDED`; (5) validate `acRef` against selected intent `ac[]` **only for selected**; (6) require existing unique assistant Message/Tool and emit only valid candidates. A malformed foreign binding cannot be normalized by classification; locally conflicted Message/Tool candidates are excluded with `CONFLICT`, global unresolvable identity rejects the Collection. An unbound Message/Tool yields `UNMAPPED`, not implicit Task/AC evidence. Do not merge child Sessions.
- [ ] **Step 4: Add tests** `duplicateMessageBindingsRejectedBeforeForeignFiltering`, `toolIdCollisionRejectedWithoutPoisoningOtherTasks`, `invalidForeignBindingStillDiagnosed`, `selectedAcRevisionMismatchOnlyForSelected`, `notAssistantAndMissingToolProduceNoEvidence`, `unmappedToolNotEvidence` (T03–T04,T10,T17). Verify all count values are nonnegative and deterministic.
- [ ] **Step 5: Run** `bun run vitest run tests/s2b/projector.test.ts` — expected **PASS**.
- [ ] **Step 6: Commit checkpoint, separate Owner authorization required:** `git add src/runtime/s2b-projector.ts tests/s2b/projector.test.ts src/runtime/s2b-input.ts && git commit -m "feat(s2b): correlate selected Task with Tool and AC"` (omit unchanged paths from `git add`).

### Task 4: Safe Evidence projection and deterministic Adapter status

**Files:** Modify `src/runtime/s2b-projector.ts`, `tests/s2b/projector.test.ts`, `tests/s2b/fixtures.ts`.

**Interfaces:** Return `Projection` with `status`, only valid `EvidenceRefV1[]`, `counts`, `projectionScope`, `diagnostics`. On `REJECTED`, return `evidenceRefs:[]` **for internal handling only**; Task 5 must omit S1-d entirely rather than treating it as complete empty Evidence.

- [ ] **Step 1: Write failing tests** `twoToolsYieldTwoIndependentACRefs` (T01/T02) and `completedIsNotPass`: generated Evidence IDs are unique deterministic safe 64-character lowercase SHA-256 tokens over length-delimited `(collectionId,sessionId,messageId,toolId)`. `type:"other"`, `UNVERIFIED_EXTERNAL`, `reportedOutcome:"UNKNOWN"`; `completed && executed===true` maps only to *reported* `EXECUTED`, otherwise `UNKNOWN` (T13).
- [ ] **Step 2: Run** `bun run vitest run tests/s2b/projector.test.ts -t twoToolsYieldTwoIndependentACRefs` — expected **FAIL**.
- [ ] **Step 3: Implement** `EvidenceRefV1` projection with `taskRef/scopeKey/acRef` exclusively from selected validated bindings. `issuerId:"opencode-v225-record"`, `originId` deterministic safe hashed source label. `contentDigest` omitted. Detect hashed identity collisions before output, reject collided candidates; never append raw IDs or free text to diagnostics.
- [ ] **Step 4: Implement status decision in this exact priority:** `REJECTED` for global invalidity, no verified prefix, unresolvable global uniqueness or any required Source/Correlation/Evidence-output limit; else if pagination incomplete **or** selected explicit candidates are partially missing/conflicted → Evidence≥1 =>`LIMITED`, Evidence=0 =>`REJECTED`; else `PAGINATION_COMPLETE` with **all explicit selected candidates resolved** =>`PROJECTED` (zero explicit candidates allowed). Purely excluded valid foreign bindings do not cause `LIMITED`. Map LIMITED to first page index 0, last validated page, validated count and rejection/unconfirmed counts; always set `coverageCompleteness:"NOT_ESTABLISHED"` later in wrapper.
- [ ] **Step 5: Add tests** `incompletePagesWithOneEvidenceLimited` (T06-A), `completePagesPartialSelectedConflictLimited` (T18-B), `partialWithNoValidEvidenceRejected` (T19), `completeWithoutSelectedBindingProjectedButNotHostComplete` (T20), `foreignOnlyDoesNotMakeLimited` (T17), `evidence129IsRejectedNotTruncated` / `evidenceJsonOver1048576Rejected` (T15). In LIMITED, assert no claim that S1-b `MISSING_EVIDENCE` means the entire Session lacks Evidence.
- [ ] **Step 6: Run** `bun run vitest run tests/s2b/projector.test.ts` — expected **PASS**; `bun run typecheck` — expected no new errors.
- [ ] **Step 7: Commit checkpoint, separate Owner authorization required:** `git add src/runtime/s2b-projector.ts tests/s2b/projector.test.ts tests/s2b/fixtures.ts && git commit -m "feat(s2b): project bounded Evidence with partial status"`.

### Task 5: P-001 frozen TaskIntent, existing S1-d bridge, safe output

**Files:** Create `src/runtime/s2b-offline-adapter.ts`, `tests/s2b/adapter.test.ts`; modify `tests/s2b/fixtures.ts` only for shared fixtures.

**Interfaces:** `runS2bOfflineAdapter(request, source, runS1d?)` and `formatS2bJson`/`formatS2bText` per ledger. Existing S1-d signature `runS1dDiagnostic(request:{loaderInput,evidencePath,changesetPath}, source:S1aReadOnlySource): Promise<S1dReportV1>` remains unmodified.

- [ ] **Step 1: Write failing P-001 test** `selectedIntentAndS1dUseExactlyTheSameBytes`: use a spy Source that returns one valid TaskIntent on first access and a *different* valid TaskIntent on second. Assert underlying `readInputFile(intentPath)` invoked exactly **once**; the bridge returns copied frozen original bytes whenever S1-d asks for the intent; selected Task and S1-d report use the first Intent; no silent second read. A simulated virtual/real path collision or mismatched snapshot identity produces `REJECTED` with `runS1d` called zero times.
- [ ] **Step 2: Run** `bun run vitest run tests/s2b/adapter.test.ts -t selectedIntentAndS1dUseExactlyTheSameBytes` — expected **FAIL**.
- [ ] **Step 3: Implement P-001:** bounded `source.readInputFile(loaderInput.intentPath,S1A_LIMITS.intentBytes)` **once**, copy using `Uint8Array.from`, validate with existing `parseTaskIntent(raw)` and retain private immutable-by-copy bytes. If read, parse, identity/path namespace or readback invariant is invalid, **REJECTED**. Create a `S1aReadOnlySource` that intercepts selected exact Intent path and returns fresh copies of the same fixed byte array, routes virtual Evidence and virtual ChangeSet to bounded immutable copies, and delegates Manifest/Artifact reads to original source. Check virtual paths cannot collide with any real source/loader path before use. No mutable buffer sharing. Before the call, explicitly compare selected identity with parsed fixed TaskIntent (same object derived from frozen bytes); on conflict fail closed, not a second real-file read.
- [ ] **Step 4: Implement orchestration:** bounded reads of Source and Correlation; source validation; selection and projector; `REJECTED`→no call and no `s1d` property; `LIMITED`/`PROJECTED`→`runS1dDiagnostic` exactly **once** via injectable runner and virtual source. Encode exact `EvidenceRefV1[]` and exact `{"availability":"UNAVAILABLE"}` as UTF-8 JSON; never emit `PRESENT`. Respect S1-d input caps; if post-encoding evidence exceeds bound, REJECTED before call. Manifest SHA-256 is only caller-supplied; never derive the expected value from the Manifest. A structurally valid Intent with Manifest digest mismatch is passed through to S1-a's ordinary diagnosis, not retagged as approval or adapter success.
- [ ] **Step 5: Implement wrapper:** JSON schema `justice-s2b-report-v1`, `adapter:{status,collectionStatus,selectedTaskRef?,projectionScope,coverageCompleteness:"NOT_ESTABLISHED",counts,diagnostics,diffProjection:"UNAVAILABLE"}`, optional `s1d` **only if invoked**; no `s1d:null`. `formatS2bText` prints sanitized Adapter summary before **unchanged** `formatText(s1d)`; JSON `s1d` matches original object, without adding S2-b Reason Codes/Exit Codes. Stable key/diagnostic order and trailing newline. S2-b独自のIdentity表示は匿名トークンにし、S1-d自身の既存の安全ID表示は変更しない（S1-d出力を書き換えないことが優先）。Secret-bearing raw Session Message, Tool, Diff patch, host path and arbitrary thrown error text never enter the S2-b-added output; fatal exceptions map to fixed Adapter code with safe fallback, no stack/exception echo.
- [ ] **Step 6: Write tests** `rejectedDoesNotInvokeS1dOrExposeS1d`, `limitedInvokesOnceAndShowsProjectionScope`, `projectedInvokesOnceWithEmptyEvidenceWhenNoBindings`, `diffAlwaysUnavailableEvenWhenExternallyCompleteLooking` (T11/T12/T21/T22), `ownerAndHostAuthorityAlwaysUnverified`, `foreignOnlySelectedEvidence`, `manifestMismatchRemainsS1Finding` (T16), `redactsSecretAndAbsolutePath` (T14). For `runS1d`'s output compare S1-d object and Text against direct baseline invocation where appropriate. Ensure `MISSING_EVIDENCE` is visibly qualified by Adapter scope on LIMITED.
- [ ] **Step 7: Run** `bun run vitest run tests/s2b/adapter.test.ts` — expected **PASS**; `bun run typecheck` — expected no new errors.
- [ ] **Step 8: Commit checkpoint, separate Owner authorization required:** `git add src/runtime/s2b-offline-adapter.ts tests/s2b/adapter.test.ts tests/s2b/fixtures.ts && git commit -m "feat(s2b): bridge frozen TaskIntent to S1-d offline"`.

### Task 6: Fixed-Fixture MVP acceptance and regression stop checkpoint

**Files:** Modify only `tests/s2b/input.test.ts`, `tests/s2b/projector.test.ts`, `tests/s2b/adapter.test.ts` as needed to complete **test coverage**, not to expand product scope.

**Interfaces:** Tests call `runS2bOfflineAdapter()` directly. No new CLI/package exports or external APIs; all saved OpenCode v2.2.5 responses are local synthetic fixture payloads matching the specified JSON shape.

- [ ] **Step 1: Complete T01–T22 fixture matrix:** each expected behavior asserted by a named test in Tasks 1–5. Specifically enforce T17 (foreign AC isolation), T18 (complete pages + partial selected conflict → LIMITED), T19 (global/zero-safe-evidence → REJECTED). For T11/T12 explicitly assert Diff never produces `PRESENT`. No test may claim Host integrity/Owner authority because JSON is self-declared.
- [ ] **Step 2: Prove S1 contract non-regression:** assert `S1dReportV1` is unchanged, `formalVerdict === "UNKNOWN"` where S1-c is evaluated, `ownerAuthorityStatus === "NOT_PROVEN"` where S1-a is evaluated, reported execution/AC truth not inferred. Check `REJECTED` wrappers omit `s1d`; `LIMITED`/`PROJECTED` include unmodified S1-d; every call uses selected Task only.
- [ ] **Step 3: Run focused tests** `bun run vitest run tests/s2b/input.test.ts tests/s2b/projector.test.ts tests/s2b/adapter.test.ts` — expected **PASS** (not yet executed).
- [ ] **Step 4: Run repository checks** `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build` — each expected exit 0 **only when subsequently executed**. Record actual command, exit code, and failure category; never write PASS for unexecuted commands.
- [ ] **Step 5: Inspect worktree scope** `git diff --name-only` and `git diff --check`; verify only the new S2-b runtime files and tests from File map. Explicitly reject changes to `src/core/s1*/`, existing `src/runtime/s1d*`, `package.json`, Gate/Owner policy, PR or merge configuration. No Live Host/API/Network/Plugin Hook or `session.diff` fetching performed.
- [ ] **Step 6: Human Owner checkpoint:** show outcome, S1-d-only vs Adapter limitations, exact tests actually run, unresolved risks, and request authorization before any Commit/Push/PR or a later task. **No automatic independent re-review, follow-up fix loop, or S2-c start.**

## Acceptance mapping and boundary table

| Design R0.1.2 / Review requirement | Implementing Task | Future evidence |
|---|---|---|
| §5.1 fixed Source, v2.2.5 version, input caps, strict JSON | 1 | `input.test.ts` version/filter/limits |
| §6.2 page continuity, prefix, Missing vs Unknown | 2 | T05–T09 |
| §5.2, §6.3, §7 global correlation order, selected AC only | 3 | T03/T04/T10/T17 |
| §7 Evidence ID/provenance, §9 deterministic state transitions | 4 | T01/T02/T13/T15/T18–T20 |
| §8 Diff always `UNAVAILABLE` | 5 | T11/T12/T21/T22 |
| §9 `runS1dDiagnostic` no Core/Report change | 5–6 | T01/T16/T20/T21 and S1 regression |
| Review Gate P-001: same immutable TaskIntent bytes | 5 | `selectedIntentAndS1dUseExactlyTheSameBytes` |
| §10 diagnostic privacy and wrapper | 5 | T14, REJECTED/ LIMITED/ PROJECTED cases |
| S2-b initial MVP complete, no Host claims | 6 | bounded fixture acceptance and recorded checks |

## Completion / stop / residual risk

**Implementation acceptance (future, requires separate Owner authority):** all T01–T22 and P-001 fixture assertions actually executed and passing; S1-a〜d existing behavior unchanged; explicit `REJECTED`/`LIMITED`/`PROJECTED` contracts demonstrated; TypeScript/checks/build outcomes recorded; only listed S2-b files changed. A failure with safety/identity/data-integrity consequences is Fail-Closed for affected input, not a reason to start unlimited review cycles. Other nonblocking issues may be documented for Human Owner disposition; no new gates are inferred.

**Current task completion:** 本文書の作成・一度の自己点検・Human Ownerへの提示まで。**実装、テスト、ビルド、Commit/Push/PRは未承認・未実施**。

**Residual risk:** Host v2.2.5稼働真正性、保存API応答の改ざん・収集中のHost状態変化、Session全履歴・Snapshot完全性、Diff完全性、Task実行の真正性、Owner承認は初期Offline Adapterでは証明しない。`PAGINATION_COMPLETE`、`PROJECTED`、S1-bの`MATCH`はこれらの証明ではない。新CLI/外部公開・多Session自動統合も対象外。

**Owner checkpoint:** Design R0.1.2はHuman Owner採択済み（本会話の承認）。本Planの採否は別判断。Plan採択だけでImplementation HOLDは解除されない。実装方式・Git書込み範囲の個別承認前には、どのTaskも自動開始しない。実装開始時には必要なら`superpowers:using-git-worktrees`で既存環境と分離し、**まず最小のTaskを実装して結果を確認する**。レビュー/訂正ループを標準工程にしない。
