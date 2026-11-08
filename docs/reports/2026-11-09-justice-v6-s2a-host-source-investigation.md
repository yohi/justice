# Justice v6 — S2-a Host Capability / Source Investigation R0.1

**基準日:** 2026-11-09 JST  
**Project:** Justice v6  
**Scope:** S2-a — READ_ONLY静的調査・技術設計  
**Primary Issue:** [#371](https://github.com/yohi/justice/issues/371)  
**Parent Issue:** [#355](https://github.com/yohi/justice/issues/355)  
**Decision Hub:** [#349](https://github.com/yohi/justice/issues/349)  
**S2-b:** [#372](https://github.com/yohi/justice/issues/372)  
**調査基準Justice HEAD:** `8723b2e36716730b45295323c5631f048ae4ed08`  
**記録状態:** `INVESTIGATION_REPORTED_COMPLETE / ADOPTION_RECOMMENDED_WITH_LIMITATIONS / OWNER_DECISION_PENDING`

> 本文は、別セッションによるS2-a調査・技術設計R0.1と、オーケストレーターによる限定評価を統合した**記録**である。調査対象の固定タグ・公開ソースの存在について一部を再照合したが、実Host Probe、実行時の再現試験、Build/Test/CIは実施していない。AIの採択推奨をHuman Ownerの正式採択として記載しない。S2-b実装を許可する文書でもない。

## 1. 目的・調査範囲・権限

S1-a〜dのHost非依存Assurance Coreに、OpenCode V2 / Superpowersの保存済みTask・Session・Message・Tool Result・ChangeSet・Review等のNative情報を取り込むため、利用可能なSource、識別子、Version依存性、Trust / Provenanceの境界を明らかにする。

- **Superpowers First:** Task進行、検証、Review/Fixの実行基盤は再構築しない。
- **OpenCode V2 Native First:** 既存のAPI、Session、Message、Diff等を優先する。
- **Justice = READ_ONLY Assurance Layer:** 実行・承認・Gateの制御権限は得ない。
- **Evidence-based:** `DOCUMENTED`、`IMPLEMENTATION_CONFIRMED`、`PREVIOUSLY_OBSERVED`、`UNKNOWN`を区別する。
- **完了境界:** S2-bの最小方式を選定できればS2-aを終了できる。UNKNOWN全解消やLive Host Probeは要求しない。

#349のPurpose/Vision採択は個別Architecture・実装を一括承認したことにはならない。S2-aの調査・設計着手はHuman Ownerによって別途承認されたが、Host Probe、S2-b実装、外部書込み、Gate変更は承認されていない。

## 2. 調査対象のIdentity

| 対象 | Version / Commit | 証拠と限界 |
| --- | --- | --- |
| Justice S1 | `master@8723b2e36716730b45295323c5631f048ae4ed08` | [固定Commit](https://github.com/yohi/justice/tree/8723b2e36716730b45295323c5631f048ae4ed08) のS1-a〜e実装。調査対象の固定基準。 |
| OpenCode V2 | `v2.2.5@9bbb8ce18c80f099e0e448775f59d965ead40a21` | [固定ソース](https://github.com/anomalyco/opencode/tree/v2.2.5) / GitタグのCommit照合済み。**実稼働HostはUNKNOWN**。 |
| Superpowers | `v7.0.1@2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` | [固定ソース](https://github.com/obra/superpowers/tree/v7.0.1) / 注釈付きタグの参照先Commit確認。**実稼働版はUNKNOWN**。 |
| 既存Justice Plugin依存 | `@opencode-ai/plugin: ^1.14.21`（調査時のpackage.json） | [Justice package.json](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/package.json)・[既存Plugin](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/opencode-plugin.ts)。V2の`@opencode/plugin`と互換とは**未確認**。 |

**対象Operation:** 保存済みSession、Message、Tool Result、限定Diff、既存Superpowers Artifactの事後READ_ONLY取得・照合。Session作成、Prompt送信、Agent実行、実行中Session操作、Hook介入は対象外。

## 3. S1契約の境界（調査で確認した対象）

| Core | 入力・出力の責務 | 昇格を禁止する判断 |
| --- | --- | --- |
| S1-a `loadS1aArtifacts()` | Manifest/TaskIntent/Design・Plan・Task・ACのIdentity、Revision、Digestと参照関係 | Identity一致 ≠ Owner正式承認。 `ownerAuthorityStatus: NOT_PROVEN` を保持 |
| S1-b `bindEvidence()` | EvidenceRefのTask、Scope、AC参照結合・欠測 | `MATCH` ≠ 実行成功・証拠真正性・AC達成。 `NOT_VERIFIED` を保持 |
| S1-c `evaluateS1c()` | Planに結合したScope Policyと候補ChangeSet、Evidenceの診断 | `candidateScopeComparison` ≠ 承認済みScope。 `formalVerdict: UNKNOWN` を保持 |
| S1-d `runS1dDiagnostic()` | 既存S1-a〜cの単一READ_ONLY診断とText/JSONレポート | CLI exit 0 ≠ Assurance PASS／Gate・Owner判断 |

固定基準のソース：[S1-a Loader](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/core/s1a/loader.ts) / [S1-b Binder](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/core/s1b/binder.ts) / [S1-c Evaluator](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/core/s1c/evaluator.ts) / [S1-d Diagnostic](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/runtime/s1d-diagnostic.ts)。

S1-eの[15件受入れ記録](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/docs/superpowers/acceptance/justice-v6-s1e-mvp-acceptance.md)は、S1 Fixtureテストとしての`PREVIOUSLY_OBSERVED`に限る。OpenCode V2実Hostの動作証明へ流用しない。

## 4. OpenCode V2 Native Capability — 静的調査結果

下表の`IMPLEMENTATION_CONFIRMED`は**v2.2.5の公開実装・型・Endpoint定義に関する調査報告上の分類**であり、利用者のHostでの実動作確認ではない。

| 能力 | Source / 取得方法 | 静的分類 | 保証限界・注意 |
| --- | --- | --- | --- |
| Session一覧・取得 | `GET /api/session`, `GET /api/session/:sessionID`; `Session.Info` | `IMPLEMENTATION_CONFIRMED` | Session ID ≠ Justice Task ID |
| Session lifecycle | `Session.Info.outcome`、busy/idle時刻、Execution Event | 同上 | Session完了 ≠ Task・Test成功 |
| Message / Result | `GET /api/session/:sessionID/message` | 同上 | ページング、保存範囲、未取得ページを考慮 |
| Tool Call / Result | Assistant MessageのTool Content・Tool State | 同上 | completed ≠ コマンド成功、テストPASS |
| Agent / Model | MessageのAgent / Model属性 | 同上 | Worker／Reviewerの意味的役割は別途対応付けが必要 |
| Child Session | Sessionの`parentID`、Subagent情報 | 同上 | Child Session ≠ Superpowers Task |
| Session Diff | `GET /api/session/:sessionID/diff`、`SessionDiff.turn()` | 同上 | Turn Snapshot差分 ≠ リポジトリ全体の完全Git差分 |
| Error / Interrupt | failed/interrupted Event、Idle outcome | 同上 | 中断後の部分結果・欠測を正しく表現 |
| Plugin Hook | v2 Plugin Context・tool hook / Event | 同上 | V1 Plugin互換性と実配信は未確認 |
| Superpowers Task完了の専用Native結合 | 明示的なTask ID / Revision紐付け | `UNKNOWN` | Session idleからTask完了を推測しない |
| Reviewの仕様適合性 | 汎用Message/Tool Resultからの機械的判定 | `UNKNOWN` | Reviewer文と独立した検証結果は別 |
| Host記録の真正性・完全性 | 独立した署名／Trust Rootなど | `UNKNOWN` | Host保存済み記録の存在だけでは真正性を保証しない |

固定版の主な参照：
- [Session HTTP API](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/session.ts)
- [Message HTTP API](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/protocol/src/groups/message.ts)
- [Session.Info型](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/session.ts)
- [Session.Message型](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/session-message.ts)
- [Session Event型](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/schema/src/session-event.ts)
- [Plugin Context](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/plugin/src/effect/plugin.ts)
- [Host Plugin利用例](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/plugin/plan.ts)
- [SessionDiff.turn](https://github.com/anomalyco/opencode/blob/v2.2.5/packages/core/src/session/diff.ts)

### 4.1 Session Diffの重要な制限

- Turnの開始・終了Snapshotが欠け得る。空Diffは「変更なし」の証明にはならない。
- Location切替をまたぐ差分は拒否される経路がある。
- 実行中SessionのDiff取得にはSnapshot Captureに関わる経路があり得るため、初期READ_ONLY Adapterは**実行中Session取得を対象外**とする。
- `added`/`deleted`/`modified`を、S1の`RENAME`と一対一に結びつけない。
- Turn単位の差分を、Gitの完全なChangeSetと誤表示しない。

### 4.2 Source信頼性の評価

| 証拠分類 | この調査での扱い |
| --- | --- |
| `IMPLEMENTATION_CONFIRMED` | 対象Versionの型・API・ソース実装の存在。実動作保証ではない |
| `DOCUMENTED` | 公式Docs記載。対象Hostでの観測ではない |
| `PREVIOUSLY_OBSERVED` | 条件・対象が明確な過去の実行証拠のみ（S1-e FixtureとHost実行を混同しない） |
| `UNKNOWN` | 実稼働Host Version、Native真正性、Task/Session確定結合等が未確認 |
| `NOT_APPLICABLE` | Review/Fix自動起動など、今回の対象外操作 |

文書に記載がないことは、機能が存在しない証拠ではない。

## 5. Superpowers Native Boundary

調査対象は[Superpowers v7.0.1](https://github.com/obra/superpowers/tree/v7.0.1)。

| 領域 | Nativeで担うこと | Justiceで担うこと |
| --- | --- | --- |
| Implementation Plan | `writing-plans`のMarkdown Plan・Task・検証手順 | 採択されたArtifactのIdentity照合 |
| Task進行 | `subagent-driven-development` / `executing-plans` | Task・Scope・Evidenceの誤帰属診断 |
| Task完了と検証 | 進行記録、`verification-before-completion` | 自己申告／参照存在／真正性の境界を表示 |
| Review / Fix | Superpowersの既存Workflow | Review実行エンジンを再実装しない |
| Rulingや実装判断 | Planの曖昧さに対するWorkflow上の判断 | Owner承認やRevision採択に昇格しない |

根拠：[writing-plans](https://github.com/obra/superpowers/blob/v7.0.1/skills/writing-plans/SKILL.md) / [subagent-driven-development](https://github.com/obra/superpowers/blob/v7.0.1/skills/subagent-driven-development/SKILL.md) / [executing-plans](https://github.com/obra/superpowers/blob/v7.0.1/skills/executing-plans/SKILL.md) / [verification-before-completion](https://github.com/obra/superpowers/blob/v7.0.1/skills/verification-before-completion/SKILL.md)。

通常のSuperpowers Markdown Planのファイル一覧だけでは、S1-cの機械可読Task Scope Policyが成立するとは限らない。またSuperpowers TaskとOpenCode Sessionの同一性も自動的には証明できない。

## 6. Native Source → S1 Integration Mapping

| Native Source | 取得元 | S1への対応 | Trust / 欠測時の境界 |
| --- | --- | --- | --- |
| Session | `session.get`、固定形式の保存済みExport | Adapter内部Source Context | Session IDはTask IDと別。確定できなければ結合しない |
| Task | 既存TaskIntent + 外部からの明示的Session対応 | S1-aのLoaderInput / S1-bのtaskRef | SourceからOwner承認済みTaskを捏造しない |
| Tool Call / Result | `session.message.list`等 | EvidenceRef候補 | Host記録であっても独立した真正性は未検証 |
| Evidence | Tool Result、既存検証出力、Review Artifact | `BinderInput.evidenceRefs` | Host観測／Agent自己申告を区別、不完全な結果からPASSを生成しない |
| ChangeSet | `session.diff`または取得済み固定差分 | `S1cInput.changeSet` | 完全な差分未確認なら`UNAVAILABLE`、空配列にしない |
| Design / Plan / AC | 既存のManifest / TaskIntent / 原本Bytes | S1-a LoaderInput、PlanBytes等 | Manifest SHA-256は**独立して事前指定**。読み込んだManifestからその期待値を無断生成しない |
| Review | Superpowers Review文書、対応Session Message | 条件付きEvidenceRef (`type: review`) | 記録の存在 ≠ Reviewの独立性・妥当性・承認 |

### 6.1 EvidenceRefのフィールド対応

| Field | S2-bでの安全な変換方針 |
| --- | --- |
| `evidenceId` | Native Message/Tool Callを区別する安全なID。衝突・重複を拒否 |
| `taskRef` | 明示対応がある既存TaskのArtifact ID / Revision。推測しない |
| `acRef` | 明示的に対応した場合だけ付与。自由文から推測しない |
| `scopeKey` | 既存TaskIntentのScope。Sessionから生成しない |
| `issuerId` | 確認できる発行主体を安全な識別子に対応。Owner承認ではない |
| `originId` | Host由来IDが制約に合わなければ衝突検査付きで対応 |
| `provenanceClass` | 未検証Host記録は原則`UNVERIFIED_EXTERNAL`、自己申告は`SELF_DECLARED` |
| `reportedExecutionState` | 確認可能なTool状態のみ変換。不明なら`UNKNOWN` |
| `reportedOutcome` | Tool完了を成功とみなさず、意味的判定が不明なら`UNKNOWN`相当（実際のS1-b型契約に沿って符号化） |
| `contentDigest` | 実際に取得した内容のByte Digestがあるときだけ任意付与。真正性の証明ではない |

受入れデータの型・列挙値・制約は固定Justiceの[Evidence契約](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/core/s1b/contract.ts)と[ChangeSet検証](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/core/s1c/path-rules.ts)を正本とする。

### 6.2 S1-c Scope Policy / ChangeSet

- 既存Plan原本Bytesを使用し、AdapterがScope Policyを無断で追記しない。
- S1-cが読み取るのは`## Justice S1-c Task Scope Policies`見出し、`<!-- justice:s1c-task-scope:begin -->`と`<!-- justice:s1c-task-scope:end -->`で囲んだ`justice-s1c-task-scope-v1` JSON。[Policy抽出実装](https://github.com/yohi/justice/blob/8723b2e36716730b45295323c5631f048ae4ed08/src/core/s1c/policy.ts)
- Policyが無い場合は`SCOPE_POLICY_UNDEFINED`を許容する。

| 状態 | S1-cに渡すChangeSet |
| --- | --- |
| 取得不能／必要な境界までの完全性を確認できない | `{"availability":"UNAVAILABLE"}` |
| 対象範囲を確認した変更の集合 | `{"availability":"PRESENT","changes":[...]}`（対象範囲を限定して解釈） |
| 必要な対象範囲について変更がないと確認済み | `{"availability":"PRESENT","changes":[]}` |
| Diff欠測を変更なしに変換 | **禁止** |

### 6.3 S1-dへの橋渡し

最小構成では、既存`runS1dDiagnostic()`を再利用し、`S1aReadOnlySource`の入力抽象を用いて、既存Artifact読み取りと、メモリ上で用意したEvidence JSON / ChangeSet JSONを渡す。S1-a/b/cの判定ロジック、Text/JSON Formatterを新設・再実装しない。

## 7. 方式比較と技術判断

| 軸 | A: Plugin Hook / Event | B: 保存Sessionの事後取得 | C: Superpowers Artifact |
| --- | --- | --- | --- |
| Source | 実行中Hook、Event | Session / Message / Tool / Diff | Plan / Task / Review文書 |
| 実装負荷 | 中〜高 | 低〜中 | 低 |
| Version依存性 | 高 | 中（ExportはExperimental） | 文書形式・Versionに依存 |
| READ_ONLY | Hook設計・Runtime干渉への配慮が要る | **固定済みOffline入力なら容易** | 既存文書読み取りなら容易 |
| 欠測 | 購読前・停止時 | 保存範囲・ページング・Snapshot | 作成されない文書・曖昧な記録 |
| Trust | Hostイベントも承認証拠ではない | 保存内容も独立した実行証明ではない | Task/承認の真正性は別 |
| 初期採用 | 見送る | **採用** | **Bに併用** |

**S2-b推奨方式:** `S2B_OFFLINE_SESSION_AND_SUPERPOWERS_ARTIFACT_ADAPTER`

初期対象はOpenCode **v2.2.5形式**の事前保存Sessionデータと、既存Superpowers / S1 Artifactだけ。新規Host実行・Plugin導入・Event常時監視は不要。

設計上の最小4責務（独立サービス4個の意味ではない）：

1. **Session Reader:** 固定入力形式の解析、Version・Session終端状態・欠測検査。
2. **Task Correlator:** 事前に明示されたTask ↔ Session / Message範囲の対応を確認。推測による結合は禁止。
3. **Evidence / ChangeSet Projector:** 確認できた事実だけを既存S1型に投影。未観測Diffは`UNAVAILABLE`。
4. **S1 Diagnostic Bridge:** 既存`runS1dDiagnostic()`へ入力を供給し、既存Reportを返す。

**S2-bに残す具体化（新たなS2-aレビュー要求ではない）:**
- 初期Session入力形式を、API取得応答・Experimental Export・DB形式から**1種類**に固定。Version不一致や不明な入力形式は拒否。
- Task / Session / Message対応を明示指定し、識別できない場合は結合しない。
- Session Diffの欠測・空・対象範囲の不完全性を区別。機密を含むRaw Message/Tool Outputをレポートへ無条件に転記しない。

不要な機構：新規診断Core、Host実行エンジン、独自Task/Review Dispatcher、Evidence Store、Owner承認システム、実行前拒否Hook、大規模Framework。

## 8. 残余リスク・実Host Probeの要否

| 未確認／制約 | 影響 | 取扱い |
| --- | --- | --- |
| 実稼働OpenCode / Superpowers Version | 固定v2.2.5/v7.0.1との互換を保証できない | 実稼働版は`UNKNOWN`、初期Adapter対応版を明記 |
| Session保存範囲・完全性 | 実行済みCallの欠落 | 欠測として表現し、完全性を保証しない |
| Task / Sessionの確定対応 | Evidence誤帰属 | 明示対応がなければ結合禁止 |
| Scope Policyの存在 | Scope比較不能 | `SCOPE_POLICY_UNDEFINED`を許容 |
| Session Diff / Snapshotの完全性 | 範囲外変更の見逃し | `UNAVAILABLE` / 限定評価 |
| Review結果の独立性・真正性 | 自己申告PASS誤受理 | `NOT_VERIFIED`のまま |
| Live GET・API動作 | 利用者Hostでの接続成立は未確認 | S2-b Offline初期スコープの完了要件から除外 |
| Session内容に含まれるSecret | 不意の情報漏洩 | Raw出力の制限、Secret/Network境界を別途承認 |

**初期Offline Adapterのための実Host Probeは不要**と判断。将来Live互換性を調べるなら、Host、Build/Version、GET対象、Secrets、Network、Snapshot副作用、停止条件を明示し、Human Ownerの個別承認を得る。

## 9. S2-a評価結果（オーケストレーターによる限定評価）

別セッション提出のInvestigation R0.1に対する評価。GitHubのOpenCode v2.2.5のタグCommit、Session/Message API、Plugin Context、Session Diff、Superpowers v7.0.1タグの存在を読み取り照合した。**実Host動作・入力形式の実機互換性までは検証していない**。

| S2-a完了条件 | 評価 |
| --- | --- |
| Host / Version / Operationと未知範囲の識別 | **達成**（調査対象固定、実稼働はUNKNOWN） |
| S1-a〜d契約 | **達成** |
| 主要Native Sourceの静的証拠整理 | **達成** |
| Trust / Provenanceの制限整理 | **達成** |
| S1への対応表 | **達成** |
| S2-b最小方式の比較・選定 | **達成** |
| Human Owner向け残余リスク・判断材料 | **達成** |
| 実Host Probe / Runtime Test | **未実施・本Task対象外** |

**評価結論:** `S2A_INVESTIGATION_R0_1_READY_FOR_ADOPTION_WITH_LIMITATIONS` — S2-aは追加Revisionや独立レビューを必須とせず、ここで終了可能と推奨。

**推奨するOwner判断を分離する:**
1. `ADOPT_S2A_INVESTIGATION_R0_1_WITH_LIMITATIONS` — S2-aの調査・技術設計を制限付き採択し終了。
2. `S2B_OFFLINE_ADAPTER_DIRECTION_APPROVED` — S2-b設計方針としてB+C方式を採用。ただし実装開始権限を含まない。

**本記録時点の権限状態:** `OWNER_DECISION_PENDING / S2B_IMPLEMENTATION_NOT_AUTHORIZED / HOST_PROBE_NOT_AUTHORIZED`。この文書のCommit・PushやIssue #372への参照追加だけで、正式採択または実装許可が発生することはない。

## 10. 完了・停止・未着手操作

- **達成:** S2-a調査結果、技術判断、S1とのMapping、S2-b最小Adapter推奨、残余リスクと限定評価の記録。
- **未実証:** 実稼働Hostでの挙動、Session保存データの実互換性、Task/Sessionの確定紐付け、差分完全性、実開発での効果改善。
- **未承認:** S2-b設計・実装・Build/Test/CI、実Host Probe、Host設定・Runtime変更、Gate/HOLD変更、S2-c、後続Review/Fix。
- **停止方針:** 未承認Host操作・Secret露出・権限昇格・捏造したTask Identityにつながる操作だけFail-Closed。無関係の静的調査・安全な実装範囲まで機械的に停止しない。
- **レビュー循環防止:** 新しいFinding・バージョン・ドキュメントを理由に独立レビューや訂正Taskを自動生成しない。次の工程はHuman Ownerが限定承認した場合のみ開始。

**本Taskで実施する書込みの範囲:** このレポートを新規featureブランチに1ファイルとしてCommit・Pushし、S2-b Issue #372に参照パスを記録する。S1製品コード変更やS2-bへの着手は行わない。
