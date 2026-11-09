# Justice v6 — S2-b Offline OpenCode V2 READ_ONLY Adapter

> **Design:** R0.1 — Human Owner確認用草案（未採択）  
> **Date:** 2026-11-09 JST  
> **Issue:** [yohi/justice #372](https://github.com/yohi/justice/issues/372) / Parent [#355](https://github.com/yohi/justice/issues/355) / Decision Hub [#349](https://github.com/yohi/justice/issues/349)  
> **S2-a fixed source:** [`5b47d6792f3296c7c9eef7267aa20d98ee842e26`](https://github.com/yohi/justice/blob/5b47d6792f3296c7c9eef7267aa20d98ee842e26/docs/reports/2026-11-09-justice-v6-s2a-host-source-investigation.md)  
> **Justice code reference:** `master@8723b2e36716730b45295323c5631f048ae4ed08`（検証基準であり、現行HEADとは限らない）  
> **Native fixed version:** OpenCode `v2.2.5` / Superpowers `v7.0.1`（Host実稼働版は未検証）  
> **Authority:** この文書の作成のみを今回の作業範囲とする。実装、Build/Test/CI、Host Probe、GitHub書込み、Gate/HOLD変更、S2-c着手は未承認。

## 1. Intent / success / boundary

**目的:** 保存済みOpenCode v2.2.5 `session.get`、ページ単位の`session.message.list`、任意の`session.diff`応答および既存Superpowers / Justice S1 Artifactを、明示的なTask/Message/Tool/AC対応に従って既存S1-a〜dの入力へREAD_ONLYで接続する。実行・判定ロジックを再構築しない。

**成功条件:** 固定されたOffline入力の構造と対応関係を検証し、誤帰属・欠測・不完全性を区別しながら、投影可能な`EvidenceRefV1[]`と`ChangeSet`を既存`runS1dDiagnostic()`に供給し、S1-dのText/JSONレポートと分離されたAdapter診断を提示できる。固定Fixtureで限定確認できれば設計上のMVP到達。実Hostの真正性を証明することは完了条件ではない。

**非目標:** API取得ツール、Live Host接続、Session Export/DB直読、Event/Plugin Hook、全Host/Version対応、Tool実行、Task/Review/Fix dispatch、Owner承認の証明、独自Evidence Store、実行前拒否、独自診断エンジン、S1 Core変更、大規模Adapter Framework。

**停止条件:** 未承認のHost/ネットワーク/外部書込み操作、秘密情報の出力、推測帰属、保証昇格を行う設計に踏み込まない。入力の一部不備によって無関係な検証済み候補まで停止させない。ただしCollection全体のIdentity/Version不整合、非対応フィルター、偽装・一意性不能な候補はFail-Closed。

## 2. 採用済みBrainstorming decisions

| Decision | Design impact |
|---|---|
| `S2B_INITIAL_INPUT_SAVED_API_RESPONSE_JSON_V225` | 保存済みAPI JSONのみ、Session ExportとLive APIは除外 |
| `S2B_EXPLICIT_MESSAGE_ID_TASK_CORRELATION` | Task帰属はSession + Message、Evidence候補識別はSession + Message + Tool |
| `S2B_MESSAGE_CENTRIC_EXPLICIT_CORRELATION_V1` | Messageごと最大1 Task、ToolごとACを明示、Childは別Session |
| `S2B_PAGED_MESSAGE_API_RESPONSE_WITH_COLLECTION_METADATA_V1` | Request/Responseをページ単位保存しcursor連続性を検証 |
| `S2B_UNFILTERED_MESSAGE_COLLECTION_V1` | 初回`order=asc`、`type`なし。後続は`cursor.next`、`order`/`type`なし |

**方式比較:** A=保存済みAPI JSON＋明示対応＋既存Artifact（採用：Offlineで小さく観測範囲を制御）／B=Session Export（形式・互換性リスクのため初期対象外）／C=Live API/Hook（Host副作用・追加承認が必要なため対象外）。Message中心構造を採用し、Tool中心のTask情報重複を避ける。

## 3. Fixed source contracts / evidence grade

- OpenCode `v2.2.5` Session GET: `GET /api/session/:sessionID` → `{ "data": Session.Info }`。
- Message GET: `GET /api/session/:sessionID/message` → `{ "data": PublicSessionMessage[], "cursor": { "previous"?: string, "next"?: string } }`。`assistant.content[]`内の`type: "tool"`には`id`, `name`, `state`, optional `executed`がある。
- Message Query: 初回`order=asc`、任意の`limit`（1〜200）。`cursor`を付けた後続では`order`禁止。`type`が一度でも存在したCollectionは初期対象外。
- Diff GET: `GET /api/session/:sessionID/diff` → `{ "data": FileDiff.Info[] }`。`file`, `status: added|deleted|modified`, `patch`, `additions`, `deletions`, optional `more`を持つ。**ターン差分でありGit全履歴ではない**。
- これらは固定版ソースの`IMPLEMENTATION_CONFIRMED`であり、実HostでのAPI動作・記録真正性は`UNKNOWN`。`hostVersion: "2.2.5"`は**Collectorの申告**であり、API応答から独立検証した版番号ではない。

References: [Session API](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/session.ts), [Message API](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/message.ts), [Message Schema](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/session-message.ts), [Diff Schema](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/file-diff.ts).

## 4. Architecture and responsibility

```text
Saved session.get JSON + paged message.list JSON + optional session.diff JSON
       |                       Collection metadata (request + page identity)
       +--------------+--------+
                      v
            [Source validator]
                | valid bounded pages / validated contiguous prefix
                v
Correlation JSON --> [Correlation validator] <-- existing TaskIntent/S1 Artifact identity
                           |
                           v
                 [Evidence / ChangeSet projector]
                   |                    |
                   | virtual Evidence    | virtual ChangeSet
                   +----------+---------+
                              v
                     existing runS1dDiagnostic()
                              |
                    existing S1-d Report/Formatter
                              |
                     Text / JSON output
                    + separate S2-b diagnostics
```

*責務1 Source Validation:* Offline JSON、Versionメタデータ、Session同一性、Message型、Tool ID、上限、ページ連続性、Diff形式を検証。  
*責務2 Correlation Validation:* Message→Task、Tool→ACを固定S1 Artifact Identityと照合。  
*責務3 Projection:* 一意に照合されたAssistant ToolのみEvidence化。Diff条件が不十分なら`UNAVAILABLE`。  
*責務4 Diagnostic Bridge:* S1 Coreを変更せず、既存S1-d実行とformatterを再利用。アダプター独自診断は別レイヤー。

## 5. Input contracts (R0.1 candidate schema)

### 5.1 Saved collection wrapper

APIレスポンスを改変しない。Collection wrapperはAPIの外側に置き、入力の請求条件と収集状況の証拠を分離する。以下は*契約を具体化する構造例*であり、保存済み実データを示さない。

```json
{
  "schemaVersion": "justice-s2b-source-v1",
  "collectionId": "collection-001",
  "hostVersion": "2.2.5",
  "sessionId": "ses_example",
  "session": { "response": { "data": { "id": "ses_example" } } },
  "messagePages": [
    {
      "pageIndex": 0,
      "collectedAt": "2026-11-09T08:00:00Z",
      "request": { "sessionId": "ses_example", "order": "asc", "limit": 100 },
      "response": { "data": [], "cursor": {} }
    }
  ],
  "diff": null
}
```

`session.response`の例は*識別子部分の抜粋*であり、そのまま固定版`Session.Info`検証を通る完全Fixtureではない。実際の入力は`session.get`の保存された**未加工応答全体**を格納する。`diff`は`null`または`{request:{sessionId,from?,to?,context?}, response:{data:[...]}, collectedAt}`。`collectionId`は収集単位識別子で、真正性を保証しない。

- `pageIndex`: 0始まり連続、同一Collection内で一意。`collectedAt`: RFC 3339日時（信頼性は申告）。リクエスト`limit`は明示値1〜200に固定し、全ページ同一。取得済みJSON以外の新規取得処理は実装しない。
- 初回Requestには`cursor`・`type`を**キーごと存在させず**、`order:"asc"`を必須とする。後続には`cursor`を必須、`order`・`type`をキーごと禁止する。`null`と「未指定」は同一視しない。
- `response.data`の全種別を保持する。未知Message種別や予期しないAPI envelopeを「柔軟変換」で通さない。Raw API payloadは診断/Reportへのそのままのコピーを禁止。
- Schemaには許容するトップレベルキー、型、サイズ/件数上限、厳格なJSON構文、重複キー/重複ID拒否を規定する。下流S1側のEvidence最大128件、ChangeSet最大128変更を超える場合、無断切捨てで「完全」としない。

### 5.2 Explicit correlation JSON

```json
{
  "schemaVersion": "justice-s2b-correlation-v1",
  "sessionId": "ses_example",
  "messageBindings": [
    {
      "messageId": "msg_001",
      "taskRef": { "artifactId": "task-1", "revision": "R1" },
      "scopeKey": "scope-1",
      "tools": [
        { "toolId": "tool_001", "acRef": { "artifactId": "ac-1", "revision": "R1" } },
        { "toolId": "tool_002", "acRef": { "artifactId": "ac-2", "revision": "R1" } }
      ]
    }
  ]
}
```

- `sessionId`はCollection/Session GETと一致する必要がある。`(sessionId,messageId)`は1 Taskにのみ帰属し、同じMessage IDの複数Bindingを拒否する（値が同一でも重複を受け入れない）。`(sessionId,messageId,toolId)`は全体で一意。
- `taskRef`, `scopeKey`, `acRef`は既存S1-a TaskIntent/Manifest/LoaderResultとの比較対象。Correlation側でTask・Scope・承認を新設しない。AC未指定のToolはEvidence対象外とする初期方針（明示Tool→AC要件を強制）。
- Child Sessionは`parentID`により自動結合しない。Childを扱うにはそのSessionの別Collectionと別Correlationを明示する。Message内に異なるTaskのToolが混在する場合はMessage単位では安全に分割できないので、そのMessageのEvidence候補を生成しない。
- S1参照識別子は`isSafeIdentifier`等の既存制約に適合させる。OpenCodeの生IDをS1の安全なIDとして暗黙に流用しない。

## 6. Validation policy

### 6.1 Source Validation

1. `hostVersion`が固定値`2.2.5`であること、未設定/未知版/Export形式でないことを検査。これは実行Hostの検証ではない。
2. `session.response.data.id`、各`request.sessionId`、Correlationの`sessionId`が一致。`session.get`が固定版の必要形状に一致しなければCollection全体を拒否。
3. 各ページ応答を固定版`data[]`/`cursor`として検証。Message ID、Message種別、Assistant Toolの`id`と`state`を検証し、同一Collection内のMessage ID衝突を検出する。
4. 取得時点のSessionが終了していることを`Session.Info`の`time.idle`/`time.busy`/`outcome`等の**保存記録上**で検査する。活動中・中断状態や矛盾で終端を確認できない場合、Host副作用のあるDiff取得を行わず、実行確証を昇格させない。保存元の真正性は別問題。

### 6.2 Collection Completeness

- `pageIndex=0`を起点に昇順連続。全ページのSession ID、`limit`、無フィルタ方針、初回orderを照合する。
- 各前ページの`response.cursor.next`と次ページの`request.cursor`が完全一致。cursorは不透明文字列として扱い、解析・生成しない。
- 同じcursorの再使用、循環、重複Message ID、破損JSON、欠落した保存ページ、途中で`next`が消えた後の余剰ページは不完全または競合として診断する。
- 最終有効ページの`cursor.next`が存在せず、先頭からそこまで連続・検証済みなら`PAGINATION_COMPLETE`。それ以外は`PAGINATION_INCOMPLETE`（非対応フィルター等の拒否は別）。これは**保存ページ列の連続性**であってHostの全履歴・収集時の無変化の証明ではない。
- 不完全時は**先頭から連続して検証できたprefix**の一意なMessage/Tool候補だけを限定投影可。孤立ページ・競合Message・曖昧な候補からは生成しない。要求Message未発見は`MISSING_MESSAGE`と断定せず、取得不足として扱う。

### 6.3 Correlation Validation

- `(sessionId,messageId)`重複Binding → 当該Message Bindingを全部拒否。単一MessageのTool ID重複 → 当該Tool候補を全部拒否。
- Messageが実在しない：Collectionが完全なときのみ`MISSING_MESSAGE`、不完全なら`PAGINATION_INCOMPLETE`に関連付けた未確認状態。別Messageで代替しない。
- Messageは存在するが`assistant`以外 → `NOT_ASSISTANT_MESSAGE`、Toolがない → `MISSING_TOOL`。`UNMAPPED`は取得済みだが明示対応がないMessage/Tool（原則集計のみ、全未対応を逐一列挙しない）。
- `taskRef`、`scopeKey`、`acRef`不一致 → `CORRELATION_MISMATCH`。複数Task混在/重複衝突 → `CONFLICT`。候補Evidenceを作成しない。
- 失敗は対象Message/Toolに限定して扱うが、Collection Identity/Version・全体一意性を判定不能なケースはCollection全体を拒否する。

## 7. Evidence Projection / trust

- `EvidenceRefV1`の`evidenceId`は`(collectionId,sessionId,messageId,toolId)`を曖昧さなくエンコードしたByte列のSHA-256を用いた、S1安全識別子長64以下の決定論的トークン。短縮する場合は衝突を明示検査し、衝突時に両候補を拒否。生ID・秘密文字列をレポートに出さない。
- `taskRef`,`scopeKey`,`acRef`は検証済みCorrelationと既存S1 Artifactからのみ取得。`issuerId`は固定の*Host記録出所ラベル*（例:`opencode-v225-record`）、`originId`は安全に生成したSource参照トークンとし、実際のAgent/Owner本人確認を意味させない。
- `type`: 初期は一律`other`。Tool名や自由文から`test`/`review`等を推測しない。
- `provenanceClass`: `UNVERIFIED_EXTERNAL`。`reportedExecutionState`: 実行申告の明示値がない場合`UNKNOWN`、保存されたTool stateが`completed`かつ`executed === true`と確認できる場合のみ**申告値**`EXECUTED`。`reportedOutcome`は初期は常に`UNKNOWN`。`completed`≠テストPASS、`error`≠AC FAILの自動判定。`contentDigest`は初期は省略（将来付けても真正性証明ではない）。
- S1-bの`MATCH`、`MATCHED_REF_PRESENT`は参照結合/存在のみ。`authenticityStatus`/`executionVerificationStatus`は`NOT_VERIFIED`、S1-a `ownerAuthorityStatus: NOT_PROVEN`、S1-c `formalVerdict: UNKNOWN`を維持。`eligibleBaseline: false`を上書きしない。
- 生成数が`S1B_MAX_EVIDENCE_REFS=128`を超える場合、先頭128件だけを出して保証することを禁止。対象の上限超過を明示診断し、当該Evidence集合をS1に「全件」として渡さない。

## 8. Optional Diff / ChangeSet

- `diff`欠測、parse失敗、別Session、対象範囲不明、収集中のSession変更可能性、`more: true`、Location切替、未確定終端、範囲の欠落、不正pathがある場合、**`{ "availability": "UNAVAILABLE" }`**。`PRESENT`の空配列へ変換しない。
- 保存済み`session.diff`の`data`があるだけではSession全体やGitの完全Diffを証明できない。`PRESENT`へ投影するのは、固定された`from`/`to`対象ターンと収集境界が示され、必要なSnapshot終端・取得範囲の連続性が確認できる場合に限定する。これらを検証できないFixtureでは保守的に`UNAVAILABLE`を返す。
- 投影可能な場合でも、`added`→`ADD`、`deleted`→`DELETE`、`modified`→`MODIFY`のみ。`RENAME`を推測しない。パスは既存`inspectChangeSet()`制約（Repository相対、安全、最大128件）を満たす必要がある。適合しない場合は`UNAVAILABLE`に戻す。
- `PRESENT`の意味は**明示された取得範囲の候補変更**であり、全Repository/全Task変更の網羅を表明しない。S1-cの`candidateScopeComparison`も正式判定ではない。

## 9. S1-d bridge and output

- 固定S1 Artifact原本Bytesと**独立して事前指定された**`expectedManifestSha256`を`LoaderInput`で渡す。Manifestから期待Digestを算出・補填することは禁止。
- `src/runtime/s1d-diagnostic.ts`の既存`runS1dDiagnostic(request, source)`に、Evidence/ChangeSetの検証済みJSON Bytesを返す**メモリ上の仮想`S1aReadOnlySource.readInputFile()`**を接続。Artifact読み取りは既存READ_ONLY sourceへ委譲。中間ファイルの書込みやS1 Core変更は行わない。
- S1-dには既存型の`EvidenceRefV1[]`と`ChangeSet`のみ供給し、`formatText`/`formatJson`の既存出力を再利用。Adapter診断は`justice-s2b-diagnostics-v1`として別オブジェクト/別Text節に置く。S1-dの`reasonCode`、`S1dReportV1`、Exit Code意味を変更しない。
- S2-bラッパーJSONを出す場合は`{schemaVersion:"justice-s2b-report-v1", adapter:{...}, s1d:<既存S1dReportV1>}`とし、`s1d`は無改変。Textも既存S1-d TextとAdapter診断を見出しで分離。出力順は決定論的（例：ページ順、Message ID、Tool IDの安定順）。
- Adapterは収集欠落、拒否件数、投影件数、Version申告、取得範囲の制限を表示するが、**Agent出力本文、ToolのRaw content、Diff patch、Secrets、Host絶対path、任意の例外文は出力しない**。固定コードと件数、匿名安全IDだけを使用。

## 10. Candidate Adapter diagnostics

| Code | Meaning | Action |
|---|---|---|
| `SOURCE_VERSION_UNSUPPORTED` | 申告Versionが2.2.5以外/不明 | Collection拒否 |
| `SOURCE_SCHEMA_INVALID` | Session/ページ/Toolなどの固定版形式不適合 | Collectionまたは当該候補を拒否 |
| `SOURCE_IDENTITY_MISMATCH` | Session IDなどの不一致 | Collection拒否 |
| `UNSUPPORTED_FILTERED_COLLECTION` | Requestに`type`キーがある | Collection拒否 |
| `PAGINATION_INCOMPLETE` | cursor欠落、不一致、循環、途中ページの破損など | 検証済みprefixのみ限定継続 |
| `CONFLICT` | Message/Tool重複・複数Task等 | 対象候補を拒否 |
| `UNMAPPED` | 明示対応されないMessage/Tool | Evidence化せず集計 |
| `MISSING_MESSAGE` | 完結した保存ページ列に要求Messageが存在しない | 対応候補拒否 |
| `MISSING_TOOL` | 対応Messageには指定Toolが存在しない | 対応候補拒否 |
| `NOT_ASSISTANT_MESSAGE` | 指定MessageがAssistantでない | 対応候補拒否 |
| `CORRELATION_MISMATCH` | Task/Revision/Scope/AC不整合 | 対応候補拒否 |
| `DIFF_UNAVAILABLE` | Diff欠測/収集範囲を確証できない | ChangeSet `UNAVAILABLE` |
| `EVIDENCE_LIMIT_EXCEEDED` | S1 Evidence件数等の上限 | 入力集合を完全なものとしては渡さない |

上記は**Adapterの候補コード**であり既存S1-d `InputIssue`/S1 Coreに追加しない。状態は`REJECTED`、`LIMITED`、`PROJECTED`等のAdapter内部表現に留め、全体の成功/不成功をOwner承認やGateに写像しない。

## 11. Limited acceptance cases (design-time test matrix)

| ID | Fixture | Expected behavior |
|---|---|---|
| T01 | 正常Session/単一最終ページ/Message→Task→Tool→AC | 候補Evidence生成、既存S1-d呼出し |
| T02 | 1 Message内に異なる2 Tool + 異なるAC | Tool単位で2 Evidence ID、一意性保持 |
| T03 | 未対応Message、未対応Tool | Evidenceを生成せず`UNMAPPED` |
| T04 | 重複Message Binding、重複Tool ID | 当該候補を拒否し`CONFLICT` |
| T05 | Child Sessionが親Collectionに紛入 | Session不一致を拒否、自動統合禁止 |
| T06 | `cursor.next`欠落ページ/要求cursor不一致/循環 | `PAGINATION_INCOMPLETE`、有効prefix以外を拒否 |
| T07 | 完全ページ列に要求Messageなし | `MISSING_MESSAGE`（偽の代替なし） |
| T08 | 不完全ページ列に要求Messageなし | `MISSING_MESSAGE`断定なし、未収集として保持 |
| T09 | `type`指定、未知Version、Export形式 | Collection拒否、S1 Core未変更 |
| T10 | AssistantではないMessage、存在しないTool | 対応候補拒否と分類 |
| T11 | diff欠測、`more:true`、未証明範囲、空`data` | `ChangeSet=UNAVAILABLE`、空差分を捏造しない |
| T12 | 条件を満たす固定済み限定Diff | 対応変更のみ投影、RENAME推測なし |
| T13 | Tool state completedだが意味的結果不明 | `reportedOutcome=UNKNOWN`、正式PASSなし |
| T14 | Secretを含むRaw Tool/Message/Diff | Text/JSONにRaw秘密情報を出さない |
| T15 | Evidence>128、ChangeSet>128、不正path | 限界を診断、黙って切捨てない |
| T16 | Artifact不一致、Manifest独立SHA誤り、Scope Policy欠測 | 既存S1の不一致/未知状態を維持 |

実装時の検証は**固定Fixture中心**。既存S1-a〜d回帰が維持されれば十分で、実Host Probeは初期MVP完了要件にしない。未実行試験はPASSと記載しない。

## 12. Proposed file boundary (not yet created in repository)

- `src/runtime/s2b-offline-adapter.ts`: OfflineオーケストレーションとS1-dへのメモリブリッジ。
- `src/runtime/s2b-input.ts`: 保存済みSource/Correlationの読み取り・上限・形式/ページ検証。
- `src/runtime/s2b-projector.ts`: Evidence/ChangeSet変換とAdapter診断。
- `tests/s2b/`: 固定Fixtureと上記限定受入れケース。

**Implementation Planはこの文書のHuman Owner承認後に別途作成・承認する。** 必要なら実装ファイルの統合/分割はPlanで最小化できる。追加の設計レビューや修正版サイクルを機械的に要求しない。

## 13. Decision checkpoint / residual risk / stop

**今回達成:** 5つのBrainstorming判断を固定入力契約、Validation、Projection、S1-dブリッジ、診断分類、限定テストへ統合したDesign R0.1を作成。  
**未検証:** 実Hostのv2.2.5互換性、収集時の状態不変、Session Diff境界、Host由来データの真正性、Task実行/Owner承認、固定Fixtureでの実ランタイム動作。  
**未承認:** GitHub反映、Implementation Plan着手、ソース実装、Build/Test/CI、Host Probe、S2-c、Gate/HOLD変更。  
**Human Owner checkpoint:** 本R0.1の採否と、次に進める作業（GitHubへのDesign記録またはImplementation Plan作成など）を個別に指定する。追加レビューやRevisionは必要性が実証された場合に限る。

**Verdict:** `S2B_DESIGN_R0_1_DRAFT_READY_FOR_OWNER_DECISION` — このDesign作成Taskはここで終了可能。
