# Justice v6 — S2-b Offline OpenCode V2 READ_ONLY Adapter

> **Design:** R0.1.2 — F-001/F-003限定整合訂正版（F-002維持）・Human Owner判断待ち（未採択）  
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
  "session": { "collectedAt": "2026-11-09T07:59:59Z", "response": { "data": { "id": "ses_example" } } },
  "sessionAfter": null,
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

`session.response`の例は*識別子部分の抜粋*であり、そのまま固定版`Session.Info`検証を通る完全Fixtureではない。実際の入力は`session.get`の保存された**未加工応答全体**を格納する。`diff`は`null`または`{request:{sessionId,from,to,context?},response:{data:[...]},collectedAt}`。`from`と`to`は必須のユーザーMessage IDで、暗黙の最新ターン選択を禁止する。`collectionId`は収集単位識別子で、真正性を保証しない。

- `pageIndex`: 0始まり連続、同一Collection内で一意。`collectedAt`: RFC 3339日時（信頼性は申告）。リクエスト`limit`は明示値1〜200に固定し、全ページ同一。取得済みJSON以外の新規取得処理は実装しない。
- 初回Requestには`cursor`・`type`を**キーごと存在させず**、`order:"asc"`を必須とする。後続には`cursor`を必須、`order`・`type`をキーごと禁止する。`null`と「未指定」は同一視しない。
- `response.data`の全種別を保持する。未知Message種別や予期しないAPI envelopeを「柔軟変換」で通さない。Raw API payloadは診断/Reportへのそのままのコピーを禁止。
- Schemaには許容するトップレベルキー、型、サイズ/件数上限、厳格なJSON構文、重複キー/重複ID拒否を規定する。下流S1側のEvidence最大128件、ChangeSet最大128変更を超える場合、無断切捨てで「完全」としない。

**F-002追加：保存された終端・差分境界の入力。** `session.collectedAt`は必須、`sessionAfter`は任意の二度目の`session.get`の未加工応答と`collectedAt`を保持する（`null`も許容）。Diff入力がある場合は`sessionAfter`も必須であり、Diffの`collectedAt`は両Session GETの取得時刻の間にある必要がある。保存日時はCollectorの申告であり改ざん防止・同時点Snapshotの証明ではない。`session`/`sessionAfter`の応答から`time.updated`、`time.busy`、`time.idle`、`outcome`を参照し、Message応答からUser/Assistant/Idle/Location切替とAssistant `snapshot.start/end`/`time.completed`を参照する。API応答に存在しない値を補完してはならない。未取得の`sessionAfter`やSnapshot情報は差分投影を`UNAVAILABLE`に制限し、Evidence取得自体は妨げない。

**F-003追加：初期MVPの入力上限（UTF-8実バイト／解析前に検査）。** Session GET応答は各1 MiB、Message page応答は各4 MiB・最大64ページ・総計64 MiB、各ページの`data`は最大200件、Collection全体のMessageは最大4,096件。Correlation JSONは256 KiB、`messageBindings`最大512件、1 Messageの`tools`最大64件、全明示Tool最大2,048件。Diff保存応答は最大2 MiB・`data`最大128件。Evidenceの投影はS1-bの128件以内かつS1-dの入力JSON上限1,048,576 bytes以内、仮想ChangeSet JSONは262,144 bytes以内とする。各上限は入力全体・各配列を切り捨てずに検査する。Session/Message/CorrelationまたはEvidence出力上限超過は`REJECTED`、**S1-d呼出しなし**。任意Diff単独の上限超過・形式不正はDiffだけ`UNAVAILABLE`とし、Evidenceに影響させない。`S1A_LIMITS`（Manifest/TaskIntent/Artifactの既存上限）は変更せず委譲する。上限を超えたページからprefixの一部を黙って投影することは禁止する。

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

**F-001追加：診断の単位は`1 invocation = 1 LoaderInput = 1 TaskIntent`。** 呼出し側が`LoaderInput`（Manifest path、独立指定のManifest SHA-256、Intent path、Artifact root）を一つ指定する。このTaskIntentの`task`（Artifact ID/Revision）、`scopeKey`、必須`ac[]`を選択Identityとし、S2-bが新しいTaskを合成してはならない。1回の診断で複数TaskIntentを自動結合しない。複数Taskを診断するなら、各TaskIntentを明示した別の呼出しが必要（初期MVPでの一括実行は非対象）。Correlationに複数TaskのBindingが存在しても入力としては許容するが、**今回選択していないTaskのBindingは`FOREIGN_TASK_EXCLUDED`として投影対象外**とし、S1-dのEvidence集合には混入させない。同一MessageにTask競合があるときは元の候補全体を`CONFLICT`で除外し、都合のよいTaskを選ばない。
**F-001検証境界:** 全Bindingの構造・安全ID・重複・一意性とMessage単位のTask競合を**選択前に**検証する。選択TaskのAC集合による意味的照合は、Task ID/Revision/Scopeで選別した**選択TaskのBindingだけ**に適用する。正常なForeign Bindingは`FOREIGN_TASK_EXCLUDED`として集計し、そのACが選択IntentのAC集合に含まれないことを`CORRELATION_MISMATCH`にしない。不正BindingをForeign選別で救済・黙殺せず、局所競合は候補拒否、全体一意性不能は`REJECTED`とする。

- `sessionId`はCollection/Session GETと一致する必要がある。`(sessionId,messageId)`は1 Taskにのみ帰属し、同じMessage IDの複数Bindingを拒否する（値が同一でも重複を受け入れない）。`(sessionId,messageId,toolId)`は全体で一意。
- `taskRef`, `scopeKey`, `acRef`は既存S1-a TaskIntent/Manifest/LoaderResultとの比較対象。Correlation側でTask・Scope・承認を新設しない。AC未指定のToolはEvidence対象外とする初期方針（明示Tool→AC要件を強制）。
- Child Sessionは`parentID`により自動結合しない。Childを扱うにはそのSessionの別Collectionと別Correlationを明示する。Message内に異なるTaskのToolが混在する場合はMessage単位では安全に分割できないので、そのMessageのEvidence候補を生成しない。
- S1参照識別子は`isSafeIdentifier`等の既存制約に適合させる。OpenCodeの生IDをS1の安全なIDとして暗黙に流用しない。

## 6. Validation policy

### 6.1 Source Validation

1. `hostVersion`が固定値`2.2.5`であること、未設定/未知版/Export形式でないことを検査。これは実行Hostの検証ではない。`session`と任意`sessionAfter`はOpenCode v2.2.5 `Session.Info` envelopeに適合させる。
2. `session.response.data.id`、各`request.sessionId`、Correlationの`sessionId`が一致。`session.get`が固定版の必要形状に一致しなければCollection全体を拒否。`sessionAfter`がある場合はその`data.id`も同一であること。Session IDの一致をTask IDの一致に昇格しない。
3. 各ページ応答を固定版`data[]`/`cursor`として検証。Message ID、Message種別、Assistant Toolの`id`と`state`を検証し、同一Collection内のMessage ID衝突を検出。`pageIndex`/取得条件/サイズ上限は§5.1、cursor連続性は§6.2で独立検査する。
4. **保存済みSessionの終端状態（Diff用）:** `session.response.data.time.idle`が存在し、`outcome∈{succeeded,failed,interrupted}`であり、`time.busy`が未設定または`busy <= idle`であることを必要条件とする。`busy > idle`、`idle`欠測、`outcome`欠測/不正は「終端不明」。`outcome=succeeded`でもTask実行成功ではなく、`failed/interrupted`も終端状態と実行結果を区別する。`sessionAfter`にも同条件を課す。
5. **Message側の整合:** `PAGINATION_COMPLETE`で、同Sessionの保存Message中に`idle` markerがあり、最後の`idle.outcome`がSessionの`outcome`と一致すること、終端に対応するターンにその後続の新規User/Assistant活動がないことを調べる。Last Idle markerが欠測・矛盾なら終端不明。Messageの並び（asc）とMessage IDの存在は別に検証する。Idleはターン境界であり、Owner承認やHost完全性の証拠ではない。
6. **Diffの固定境界:** `diff.request.from`/`to`はともに必須、異なる場合も同じSession内の一意な`type=user` Message IDで、検証済みの昇順Message列において`from <= to`。`from`のUserを含むターンの**開始**（直前idleの後の最初のUser）から、`to`のUserを含むターンの**終了**（後続idle）までを対象とする。ターン内に複数Userがある場合も、個々のUserを独立ターンとはしない。最初のAssistantの`snapshot.start`と最後の完了Assistantの`snapshot.end`が存在し、全対象Assistant `time.completed`と対象末尾`idle`が確認でき、範囲内の`location-switched`がないことを必要条件とする。Idleなしのlegacy境界、暗黙default、欠測Snapshot、実行中ターンはDiff保証不可。固定Sourceの実装は対象ターンの先頭/末尾の記録済みSnapshotを選択するが、オフラインAdapterはSnapshotオブジェクト自体の真正性を検証できない。
7. **取得中の状態不変:** `session.collectedAt <= diff.collectedAt <= sessionAfter.collectedAt`、前後Sessionの`id`/`time.updated`/`busy`/`idle`/`outcome`の一致、Message側の終端一致を確認しても、間のHost更新・巻戻し・Snapshot差替えがなかったことの証明にはならない。いずれか不一致なら即`DIFF_UNAVAILABLE`。全部一致しても、Native API JSONだけでは収集中の状態不変を立証できないため§8の初期MVPでは必ず`ChangeSet=UNAVAILABLE`とする。追加のHost ProbeやDiff取得を本Adapterが行わない。

### 6.2 Collection Completeness

- `pageIndex=0`を起点に昇順連続。全ページのSession ID、`limit`、無フィルタ方針、初回orderを照合する。
- 各前ページの`response.cursor.next`と次ページの`request.cursor`が完全一致。cursorは不透明文字列として扱い、解析・生成しない。
- 同じcursorの再使用、循環、重複Message ID、破損JSON、欠落した保存ページ、途中で`next`が消えた後の余剰ページは不完全または競合として診断する。
- 最終有効ページの`cursor.next`が存在せず、先頭からそこまで連続・検証済みなら`PAGINATION_COMPLETE`。それ以外は`PAGINATION_INCOMPLETE`（非対応フィルター等の拒否は別）。これは**保存ページ列の連続性**であってHostの全履歴・収集時の無変化の証明ではない。
- 不完全時は**先頭から連続して検証できたprefix**の一意なMessage/Tool候補だけを限定投影可。孤立ページ・競合Message・曖昧な候補からは生成しない。要求Message未発見は`MISSING_MESSAGE`と断定せず、取得不足として扱う。
- **F-003状態境界:** 先頭ページ自体が不正、グローバルID/Version/Filter不整合、上限超過、全体一意性不能、有効prefixなし等は`REJECTED`（S1-d未実行）。`LIMITED`は **A:** `PAGINATION_INCOMPLETE`だが先頭から連続する検証済みprefixに選択Taskの有効Evidenceが1件以上残る場合、または **B:** `PAGINATION_COMPLETE`だが選択Taskの一部明示候補を競合・欠測で拒否し有効Evidenceが1件以上残る場合に成立する。どちらも有効Evidence0件なら`REJECTED`。`PROJECTED`は`PAGINATION_COMPLETE`で選択Taskの**全明示候補**を未解決の欠落・競合なしに検証・投影した場合のみ（明示候補0件を含む）。正常なForeign Binding除外だけでは`LIMITED`にしない。ページング完了もHost履歴全体の完全性ではない。

### 6.3 Correlation Validation

- `(sessionId,messageId)`重複Binding → 当該Message Bindingを全部拒否。単一MessageのTool ID重複 → 当該Tool候補を全部拒否。
- Messageが実在しない：Collectionが完全なときのみ`MISSING_MESSAGE`、不完全なら`PAGINATION_INCOMPLETE`に関連付けた未確認状態。別Messageで代替しない。
- Messageは存在するが`assistant`以外 → `NOT_ASSISTANT_MESSAGE`、Toolがない → `MISSING_TOOL`。`UNMAPPED`は取得済みだが明示対応がないMessage/Tool（原則集計のみ、全未対応を逐一列挙しない）。
- `taskRef`、`scopeKey`、`acRef`不一致 → `CORRELATION_MISMATCH`。複数Task混在/重複衝突 → `CONFLICT`。候補Evidenceを作成しない。
- 失敗は対象Message/Toolに限定して扱うが、Collection Identity/Version・全体一意性を判定不能なケースはCollection全体を拒否する。
**F-001固定検証順序:** (1) **全Binding**のキー/型/安全ID・重複・一意性を検証、(2) 同一Message内の複数Task帰属/Message単位競合をTask選択前に検出、(3) Task ID/Revision/Scopeによって選択TaskとForeign Taskを分類、(4) 正常なForeignを`FOREIGN_TASK_EXCLUDED`で集計・除外、(5) **選択TaskのBindingに限って**`acRef`を選択Intentの`ac[]`集合と意味的照合、(6) 合格したToolのみEvidence化する。Foreign Taskの正常なACが選択TaskのAC集合にないことは`CORRELATION_MISMATCH`ではない。Foreign側の構造違反・競合も選別で消去せず診断し、全体一意性を判定できなければ`REJECTED`、局所競合は該当候補を拒否する。

## 7. Evidence Projection / trust

**F-001 / F-003投影境界:** 一呼出しにつき選択するTaskIntent/LoaderInputは一つのみ。先に全Bindingの構造/重複/Message単位Task競合を検証した後、`(taskRef.artifactId, taskRef.revision, scopeKey) == (selectedIntent.task.artifactId, selectedIntent.task.revision, selectedIntent.scopeKey)`で選択Taskに属するBindingだけ抽出する。正常な別Task Bindingは`FOREIGN_TASK_EXCLUDED`として集計・除外し、その`acRef`が選択Intentの`ac[]`に含まれないことを`CORRELATION_MISMATCH`としない。**選択TaskのBindingだけ**`acRef`と選択IntentのAC集合を意味的照合する。不正Foreign Bindingも構造/競合として診断し、選択で救済しない。有効で一意な選択Task Assistant Toolのみ`EvidenceRefV1[]`化し、S1-bの`TASK_NOT_SELECTED`を除外機構として使用しない。選択Intentや参照の取得・解釈が不可能なら`REJECTED`でS1-d呼出しなし（Manifest digest不一致などは、構造的に読み取れる場合はS1-d本来の診断へ委譲し、Adapterが承認を付与しない）。

- `EvidenceRefV1`の`evidenceId`は`(collectionId,sessionId,messageId,toolId)`を曖昧さなくエンコードしたByte列のSHA-256を用いた、S1安全識別子長64以下の決定論的トークン。短縮する場合は衝突を明示検査し、衝突時に両候補を拒否。生ID・秘密文字列をレポートに出さない。
- `taskRef`,`scopeKey`,`acRef`は検証済みCorrelationと既存S1 Artifactからのみ取得。`issuerId`は固定の*Host記録出所ラベル*（例:`opencode-v225-record`）、`originId`は安全に生成したSource参照トークンとし、実際のAgent/Owner本人確認を意味させない。
- `type`: 初期は一律`other`。Tool名や自由文から`test`/`review`等を推測しない。
- `provenanceClass`: `UNVERIFIED_EXTERNAL`。`reportedExecutionState`: 実行申告の明示値がない場合`UNKNOWN`、保存されたTool stateが`completed`かつ`executed === true`と確認できる場合のみ**申告値**`EXECUTED`。`reportedOutcome`は初期は常に`UNKNOWN`。`completed`≠テストPASS、`error`≠AC FAILの自動判定。`contentDigest`は初期は省略（将来付けても真正性証明ではない）。
- S1-bの`MATCH`、`MATCHED_REF_PRESENT`は参照結合/存在のみ。`authenticityStatus`/`executionVerificationStatus`は`NOT_VERIFIED`、S1-a `ownerAuthorityStatus: NOT_PROVEN`、S1-c `formalVerdict: UNKNOWN`を維持。`eligibleBaseline: false`を上書きしない。
- **上限超過は全件拒否:** 選択Taskの投影候補が`S1B_MAX_EVIDENCE_REFS=128`件を超える、または生成したEvidence JSONが1,048,576 bytesを超える場合、先頭の一部を切り捨てず`REJECTED`としてS1-dを呼び出さない。ページ/Correlation自体の上限超過も§5.1に従う。入力欠損を空Evidence集合へ自動的に変換しない。
- `LIMITED`に渡すEvidence配列は **A:** `PAGINATION_INCOMPLETE`時の連続検証済みprefix内から投影した選択Task候補、または **B:** `PAGINATION_COMPLETE`時の全ページ中、一部候補の競合・欠測を除外した選択Task候補のうち、安全に検証した1件以上に限定する。`projectionScope`には検証済みページ範囲・候補除外数・未確認数を併記する。S1-dの`MISSING_EVIDENCE`/`MATCHED_REF_PRESENT`は投影済み限定集合の診断であり、Session全履歴の完全性や未取得領域のAC未実施を証明しない。`coverageCompleteness: NOT_ESTABLISHED`を維持する。

## 8. Optional Diff / ChangeSet

**F-002（初期MVPの決定的な規則）:** OpenCode v2.2.5の保存済みAPI応答JSONだけでは、取得中のHost/Snapshotが不変だったこと、Snapshot実体が取得対象ターンの真正な始点/終点だったことを証明できない。**初期S2-bの投影結果はDiff有無・内容を問わず常に`{ "availability": "UNAVAILABLE" }`**とする。`PRESENT`分岐は初期MVPでは設けない。空`data:[]`も変更なしの証明とはせず`UNAVAILABLE`。これにより実装者が任意の「十分条件」を追加設計する余地を残さない。

保存済みDiffがある場合は、§5.1/§6.1の情報で次の**診断のみ**実施し、`DIFF_UNAVAILABLE`の理由を固定コードで記録する。これは`PRESENT`へ昇格するための証明手続ではない。

1. **Range:** `diff.request.sessionId`がCollectionと一致。`from`/`to`が明示指定された同SessionのUser Message IDで、一意・順序正・範囲内のMessage/Idle/Assistant列が`PAGINATION_COMPLETE`内に存在。`from`/`to`省略時のNative defaultは利用しない。`from`と`to`が等しい場合も「単一User単位」ではなく、そのUserを含む1ターンを対象とする。
2. **Terminal / Snapshot:** 保存Session前後に`idle`/`outcome`の整合を確認し、対象ターンのIdle終端とAssistantの`start/end` Snapshot識別子を確認。`busy>idle`、欠測・不一致・未完了Assistant・`location-switched`・`outcome=interrupted`は理由を区別するが、どの場合も`UNAVAILABLE`。
3. **Stability:** 前後の`session.get`の`time.updated/busy/idle/outcome`一致と取得時刻順があっても、同一状態を維持したことの独立証明にはならない。`sessionAfter`が無い、時間順が誤る、時刻/状態が変化した場合も`UNAVAILABLE`。Snapshot ID文字列の存在やSelf-reported digestだけで証明済み扱いしない。
4. **Shape / paths:** `FileDiff.Info`の`more:true`、不正JSON、不正path、128件超過、2 MiB超過は理由を保持。現在のMVPでは`added/deleted/modified`からの`ADD/DELETE/MODIFY`への**実際の投影は行わない**。`RENAME`の推測は不可。将来の`PRESENT`拡張は別Owner判断とし、本R0.1.1では設計・実装しない。

`UNAVAILABLE`でもS1-dを呼べる場合はそのまま既存S1-cへ渡す。S1-cの`CHANGESET_UNAVAILABLE`、`formalVerdict:UNKNOWN`、`CHANGESET_COMPLETENESS_NOT_VERIFIED`等を改変しない。Diffの未実証はEvidence投影可否と独立し、`PAGINATION_COMPLETE`をGit差分やSession全履歴の完全性と同一視しない。

## 9. S1-d bridge and output

- **診断対象の一意性（F-001）:** 1回のS2-b呼出しが受け取る`LoaderInput`は1件、その`intentPath`が選択する`TaskIntent`も1件のみ。S1-dへ渡すEvidence集合は、そのTaskIntentのTask ID/Revision/Scopeと、明示指定されたACのみで抽出した検証済み候補に限る。別TaskのBindingは投影しない。複数TaskのS1-d呼出しを内部で自動起動せず、`TASK_NOT_SELECTED`を別Task証拠の除外機構として依存しない。
- 固定S1 Artifact原本Bytesと**独立して事前指定された**`expectedManifestSha256`を`LoaderInput`で渡す。Manifestから期待Digestを算出・補填することは禁止。
- `src/runtime/s1d-diagnostic.ts`の既存`runS1dDiagnostic(request, source)`に、**選択Taskに限定した**Evidence JSON Bytesと`{"availability":"UNAVAILABLE"}`のChangeSet JSON Bytesを返すメモリ上の仮想`S1aReadOnlySource.readInputFile()`を接続。Artifact読み取りは既存READ_ONLY sourceへ委譲。中間ファイルの書込みやS1 Core変更は行わない。内部仮想パスの競合を禁止し、既存のEvidence 1,048,576 bytes・ChangeSet 262,144 bytes上限に従う。
- S1-dには既存型の`EvidenceRefV1[]`と`ChangeSet`のみ供給し、`formatText`/`formatJson`の既存出力を再利用。Adapter診断は`justice-s2b-diagnostics-v1`として別オブジェクト/別Text節に置く。S1-dの`reasonCode`、`S1dReportV1`、Exit Code意味を変更しない。
- **Wrapper出力契約（F-003）:** S2-bのJsonは`{schemaVersion:"justice-s2b-report-v1", adapter:{status,collectionStatus,selectedTaskRef,projectionScope,coverageCompleteness,counts,diagnostics,diffProjection}, s1d?: S1dReportV1}`とする。`adapter.status`は`REJECTED|LIMITED|PROJECTED`、`coverageCompleteness`は常に`NOT_ESTABLISHED`、`diffProjection`は初期MVPで常に`UNAVAILABLE`。`projectionScope`は`{sessionId,collectionId,taskRef,scopeKey,firstPageIndex:0,lastValidatedPageIndex:number|null,validatedPageCount:number,selectedMessageCount:number,projectedEvidenceCount:number}`で、ユーザー由来IDは外部に出さず安全な匿名トークンで表す。`counts`は候補・除外・拒否・未確認をそれぞれ非負整数で表す。`diagnostics`は固定コードと件数のみ。`s1d`は**呼出しがあった場合に限り存在**し、既存Reportを一切書き換えない。`s1d:null`や成功風の空オブジェクトは使わない。
- **状態別実行（F-003、優先順固定）:** グローバル不正・上限超過・選択対象不明・全体一意性不能・有効prefixなし等は最優先で`REJECTED`。次にページング不完全または選択Task候補の一部欠落/競合がある場合、**有効な選択Task Evidenceが1件以上**なら`LIMITED`（S1-d1回、`s1d`あり）、0件なら`REJECTED`（S1-d0回、`s1d`なし）。その他、ページング完了かつ選択Taskの全明示候補を未解決欠落・競合なしに検証・投影できた場合のみ`PROJECTED`（明示候補0件を含み、S1-d1回・`s1d`あり）。`LIMITED`は **A:** 有効prefixがある不完全ページング、**B:** 完全ページ列内での一部候補拒否、の両方を含む。`projectionScope`にページ範囲と候補の除外/未確認数を記録する。正常なForeign Task除外だけでは`LIMITED`にしない。Diffはstatusに関係なく`UNAVAILABLE`。
- `LIMITED`のS1-d結果に現れる`MISSING_EVIDENCE`や`AC_EVIDENCE_REF_MISSING`は**投影された限定集合に関する診断**であり、Session全履歴にEvidenceが無い証拠ではない。`PROJECTED`もHost履歴の完全取得やOwner承認を証明しない。S2-b wrapper TextはAdapter status/Projection範囲/制約を先に提示し、`LIMITED/PROJECTED`の場合にだけ既存S1-d Text全文を変更せず後段で表示する。Jsonも同じ条件で`s1d`を含める。
- Adapterは収集欠落、拒否件数、投影件数、Version申告、取得範囲の制限を表示するが、**Agent出力本文、ToolのRaw content、Diff patch、Secrets、Host絶対path、任意の例外文は出力しない**。固定コードと件数、匿名安全IDだけを使用。既存S1-d CLIのExit Code体系は変更しない。S2-bは独自Exit CodeによるGate/承認判定を新設しない。

## 10. Candidate Adapter diagnostics

| Code | Meaning | Action |
|---|---|---|
| `SOURCE_VERSION_UNSUPPORTED` | 申告Versionが2.2.5以外/不明 | `REJECTED` |
| `SOURCE_SCHEMA_INVALID` | Session/ページ/Tool等の固定版形式不適合 | 先頭/全体なら`REJECTED`、後続ページなら有効prefixに限定 |
| `SOURCE_IDENTITY_MISMATCH` | Session IDなどの不一致 | `REJECTED` |
| `UNSUPPORTED_FILTERED_COLLECTION` | Requestに`type`キーがある | `REJECTED` |
| `PAGINATION_INCOMPLETE` | cursor欠落、不一致、循環、途中ページ破損など | `LIMITED`候補。prefixなし・安全候補なしなら`REJECTED` |
| `CONFLICT` | Message/Tool重複・複数Taskなど | 当該候補を拒否。Collection全体の一意性が評価不能なら`REJECTED` |
| `FOREIGN_TASK_EXCLUDED` | 今回の単一TaskIntent以外のBinding | 集計しEvidenceに混入させない |
| `UNMAPPED` | 明示対応されないMessage/Tool | Evidence化せず集計 |
| `MISSING_MESSAGE` | 完結した保存ページ列に要求Messageが存在しない | 対応候補拒否。不完全時は断定不可 |
| `MISSING_TOOL` | 対応Messageには指定Toolが存在しない | 対応候補拒否 |
| `NOT_ASSISTANT_MESSAGE` | 指定MessageがAssistantでない | 対応候補拒否 |
| `CORRELATION_MISMATCH` | Task/Revision/Scope/AC不整合 | 対応候補拒否、全候補が安全に確定不能なら`REJECTED` |
| `DIFF_UNAVAILABLE` | 初期MVPではSnapshot/収集状態不変の証明不可（欠測・範囲/終端不明も含む） | 常に`ChangeSet=UNAVAILABLE`、Evidence処理は独立 |
| `EVIDENCE_LIMIT_EXCEEDED` | Evidence>128件、またはJSON>1,048,576 bytes | **全件`REJECTED`、S1-d未実行** |
| `INPUT_LIMIT_EXCEEDED` | §5.1の必須Source/Correlationサイズ・件数上限超過 | **全件`REJECTED`、S1-d未実行**。任意Diffの超過だけは`DIFF_UNAVAILABLE` |

**状態・S1-d呼出しの一意規則（F-003）**：`REJECTED` → **呼出し0回、`s1d`なし**。`LIMITED` → 検証済みprefix/一部有効候補を明記し**呼出し1回、`s1d`あり**。`PROJECTED` → 選択Taskの全明示候補投影、**呼出し1回、`s1d`あり**。`PAGINATION_COMPLETE`はHost全履歴の完全性と無関係。診断順序は入力ページ順・Message/Toolの安定順、出力にRaw秘密情報を混入させない。

上記は**Adapterの候補コード**であり既存S1-d `InputIssue`/S1 Coreに追加しない。状態は`REJECTED`、`LIMITED`、`PROJECTED`等のAdapter内部表現に留め、全体の成功/不成功をOwner承認やGateに写像しない。

## 11. Limited acceptance cases (design-time test matrix)

| ID | Fixture | Expected behavior |
|---|---|---|
| T01 | 正常Session/単一最終ページ/1 TaskIntent選択/Message→Task→Tool→AC | `PROJECTED`、選択TaskのEvidenceのみ生成、S1-d呼出し1回・`s1d`あり |
| T02 | 1 Message内に異なる2 Tool + 異なるAC | Tool単位で2 Evidence ID、一意性保持 |
| T03 | 未対応Message、未対応Tool | Evidenceを生成せず`UNMAPPED` |
| T04 | 重複Message Binding、重複Tool ID | 当該候補を拒否し`CONFLICT` |
| T05 | Collectionの`sessionId`、Session GETの`data.id`、各`request.sessionId`、Correlationの`sessionId`のいずれかが不一致 | 明示Session識別子の不一致を`SOURCE_IDENTITY_MISMATCH`として`REJECTED`。Message応答自体の所属Sessionは未検証であり、Child Session由来Messageの混入はこの比較だけでは検出・証明できない。`parentID`による自動統合は禁止 |
| T06 | 後続ページ欠測/要求cursor不一致/循環により`PAGINATION_INCOMPLETE` | 有効な連続prefix＋選択Task Evidence≥1なら`LIMITED`・S1-d1回、それ以外は`REJECTED`・S1-d0回。`PAGINATION_COMPLETE`時の一部候補拒否はT18で検証 |
| T07 | 完全ページ列に要求Messageなし | `MISSING_MESSAGE`（偽の代替なし） |
| T08 | 不完全ページ列に要求Messageなし | `MISSING_MESSAGE`断定なし、未収集として保持 |
| T09 | `type`指定、未知Version、Export形式 | Collection拒否、S1 Core未変更 |
| T10 | AssistantではないMessage、存在しないTool | 対応候補拒否と分類 |
| T11 | diff欠測、`more:true`、`from`/`to`欠測/非User、Session `busy>idle`、Idle/Snapshot欠測、空`data` | 原因別に`DIFF_UNAVAILABLE`、常に`ChangeSet=UNAVAILABLE`。S1-dが走る場合もS1-cの正式判定は`UNKNOWN` |
| T12 | `from`/`to` User、ターン境界/Idle/Snapshot/Session前後が外見上整合し、`data`に差分がある固定済みDiff | **収集時不変・Snapshot実体を証明できないため`ChangeSet=UNAVAILABLE`**。MVPでは`PRESENT`を返さず、`RENAME`も推測しない |
| T13 | Tool state completedだが意味的結果不明 | `reportedOutcome=UNKNOWN`、正式PASSなし |
| T14 | Secretを含むRaw Tool/Message/Diff | Text/JSONにRaw秘密情報を出さない |
| T15 | Evidence>128、Evidence JSON>1,048,576 bytes、Source/Correlation超過、Diff>128件/不正path | 必須入力・Evidence超過は`REJECTED`・S1-d未実行。任意Diff超過/不正はDiffのみ`UNAVAILABLE`。切捨てなし |
| T16 | Artifact不一致、Manifest独立SHA誤り、Scope Policy欠測 | 既存S1の不一致/未知状態を維持 |

**F-001 / F-003限定追加ケース:** T17＝全Bindingの構造・一意性・Message単位のTask競合を先に検証。正常なForeign TaskのACが選択TaskのAC集合にない場合も、`FOREIGN_TASK_EXCLUDED`として集計し、`CORRELATION_MISMATCH`を出さず、選択TaskのEvidenceのみS1-dへ（`TASK_NOT_SELECTED`に依存しない）。Foreign Binding自体が不正なら選別で救済しない。T18＝**`PAGINATION_COMPLETE`だが選択Taskの一部明示候補に欠測/競合があり、有効Evidence≥1件が残る**場合 → `LIMITED`、全検証済みページ範囲・除外数を表示、S1-d1回・`s1d`あり。T19＝先頭ページ不正・上限超過・全体一意性不能・有効prefixなし、またはページ不完全/候補部分拒否で有効Evidence0件 → `REJECTED`、S1-d0回・`s1d`キーなし。T20＝完全Collectionかつ選択Taskの明示候補ゼロ → `PROJECTED`・`s1d`あり、ただし`MISSING_EVIDENCE`はSession全履歴の不存在証明としない。T21＝Diffなしでも完全なEvidence投影 → `PROJECTED`と`diffProjection:UNAVAILABLE`を同時に保持。T22＝`sessionAfter`有無・異時刻/状態変更・Snapshot IDだけ一致 → すべてDiffは`UNAVAILABLE`。これらはいずれも**設計上の期待ケースで未実施**。

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
