# Justice v6 — Daily Development Assurance Integration Design R0.1.2

> Status: `BASIC_DESIGN_OWNER_ADOPTED / LIMITED_DOCUMENT_CORRECTION / IMPLEMENTATION_NOT_AUTHORIZED / LIVE_NOT_AUTHORIZED`
> Date: 2026-11-24 (JST)
> Tracker: [#401](https://github.com/yohi/justice/issues/401); Parent: [#388](https://github.com/yohi/justice/issues/388)
> Reviewed HEAD: `ddcf80b0e22d9c45343772390a22c4a911a388df`; Base: `0195966130fb06b93c5ad79601d563307fd8df11`; implementation baseline: `896acee25323c0e5b6dc97e0dd936efff1b9e434`.
> R0.1.2はR0.1.1に対するRG-001の最終限定文書訂正候補（TERMINAL返却前のBinding再検証とProduction wiringの統一のみ）。RG-002〜004の訂正を保全し、再openしない。既存のGoal・Owner採択済み基本方式・AC-D01〜08を維持する。今回の訂正は実装・Live・ReleaseのGOではない。追加の方式選定・独立レビューを自動開始しない。

## 1. Purpose / Goal

承認済みSuperpowers Taskの実行証拠と実変更を既存Justiceへ接続し、日常開発におけるネガティブな乖離の検出・是正支援を実現する。承認済みDesign/Plan/Task/ACを実行成果と結合することが目的であり、今回の保証は観測・診断・Advisoryに限定する。Host側実行前強制、包括的な意味的乖離検出、完全な履歴網羅を主張しない。

SuperpowersがWorkflow・Review・Fix・Task完了を所有し、OpenCode V2が実行を担う。JusticeはIntent/Evidence/Scope/Authorityの接続と診断を補完する。Human OwnerがAuthorityを保持する。

## 2. Existing implementation / gap

- S1-a/b/c/d: Artifact Identity、Evidence Binding、candidate scope診断、Read-only診断を再利用。S1-a `NOT_PROVEN`、S1-c `formalVerdict=UNKNOWN` は変更しない。
- S2-b: Native Source/Correlationの厳密検証とEvidence Projectionを再利用。既存v1 report、REJECTED時S1-d非呼出し、Native `diffProjection=UNAVAILABLE` を保全。
- S3: 単一Writer等の採択済み限定保証を維持。新規RecoveryやGate状態を作らない。
- V2 Plugin: `justice_review`の閲覧、resolve拒否を維持。日常TaskのIntent/Evidence/Advisoryは未接続。
- Git ChangeSetをNative diffとは別入力として供給し、既存S1-c/S1-dを用いる。Git観測はファイルpath単位の限定候補Scope診断であり、変更内容の意味的正当性や網羅性の証明ではない。

固定参照:
- [S5 Owner Decision](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/docs/superpowers/decisions/justice-v6-s5-owner-completion-decision.md) / [S5 Runbook](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/docs/superpowers/operations/justice-v6-s5-minimal-operation-runbook.md)
- [V2 plugin](https://github.com/yohi/justice/blob/5d62f7cd1a096b292178c1ef19a0dbde4a7d1091/src/opencode-v2-plugin.ts) / [S2-b adapter](https://github.com/yohi/justice/blob/5d62f7cd1a096b292178c1ef19a0dbde4a7d1091/src/runtime/s2b-offline-adapter.ts) / [S2-b projector](https://github.com/yohi/justice/blob/5d62f7cd1a096b292178c1ef19a0dbde4a7d1091/src/runtime/s2b-projector.ts#L524-L544)
- [S1-d diagnostic](https://github.com/yohi/justice/blob/5d62f7cd1a096b292178c1ef19a0dbde4a7d1091/src/runtime/s1d-diagnostic.ts) / [Scope Fallback](https://github.com/yohi/justice/blob/5d62f7cd1a096b292178c1ef19a0dbde4a7d1091/src/core/s1d/scope-fallback.ts) / [captured S1-a source](https://github.com/yohi/justice/blob/5d62f7cd1a096b292178c1ef19a0dbde4a7d1091/src/runtime/s1d-read-only-input.ts)
- [V2.3.2 Tool SDK](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/tool.ts) / [Tool context・options](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/tool.ts) / [Tool execution](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/tool.ts) / [saved Tool part](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/session/message-updater.ts#L314-L380) / [providerExecutedの保存契約](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/session/runner/publish-llm-event.ts#L497-L596) / [local Tool実行分岐](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/session/runner/step.ts#L143-L148) / [Code Mode nested identity](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/codemode/tool.ts#L135-L158)
- [Native shell](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/tool/plugin/shell.ts) / [session.get](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/protocol/src/groups/session.ts#L237-L246) / [session.messages](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/protocol/src/groups/message.ts#L23-L42) / [shell.list](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/protocol/src/groups/shell.ts#L10-L21)
- [Skill SDK](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/skill.ts) / [Skill.Info](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/schema/src/skill.ts#L26-L34) / [Registration](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/registration.ts)

以上のSDKとソースは静的根拠。Hookの発火・保存順・実RuntimeでのAPI応答・Skill連携・隔離境界はTask 6の実証事項とする。

## 3. Considered approaches / adopted decisions

| Decision | Alternatives considered | Adopted |
|---|---|---|
| Goal | A 現行機能利用、B 日常開発の品質保証、C OC2 Daily Launcher統合、D 限定版Release先行 | B 日常開発の品質保証 |
| Automation | A 手動診断、B 自動診断・Advisory、C 強制Gate | B 自動診断・Advisory |
| Integration | A Native Hook中心、B Superpowers Skill中心、C Native Hook＋Superpowers連携 | C Native Hook＋Superpowers連携 |

HookのみでTask完了を推定しない。Skillのみで実行証拠を主張しない。案Cは明示的Task境界とNative観測を組み合わせる。今回の限定訂正で基本方式を再採択しない。新規認証/署名/Workflow/Review/Routerは作らない。

## 4. Architecture / responsibilities

```text
Owner-fixed approval package + digest (read-only dedicated launch)
  -> Intent Bridge (pre-execution binding)
Superpowers inline executing-plans -> direct begin
  -> OpenCode V2 normal execution / Native before+after observations
  -> direct finish (bounded boundary; not completion authority)
  -> Native Source / Correlation validation + independent Git ChangeSet
  -> Existing S1/S2 diagnostic pipeline / existing S1-d Scope Fallback
  -> Advisory to the same existing Superpowers flow
```

### 4.1 Intent Bridge — RG-001: one Owner supply contract

初回は一つの承認済みTaskにつき一つの専用Process/Session/worktreeを用いる。**供給方式はOwner起動時の固定read-only mount + 外部固定SHA-256のみ**。設定探索、project config、Tool引数、LLM指示、環境内で生成した承認へのfallbackは禁止。

- Ownerが専用環境に `/run/justice-daily/owner` をread-only mountし、固定 `approval.json`、`manifest.json`、`intent.json`、`artifacts/` を用意する。`JUSTICE_DAILY_APPROVAL_SHA256` はOwnerがpackageの外で計算・固定したapproval.json raw bytesの小文字SHA-256（64桁）を、専用起動時に供給する。変数がない場合はDaily機能OFF。任意のパス/承認元を指定する設定は設けない。既存PluginとV1は不変。
- approval.json `justice-daily-owner-approval-v1` は厳密JSON、最大65,536 bytes。`enabled:true`、`ownerDecisionRef`、`hostVersion:"2.3.2"`、`hostBinarySha256`、`manifestSha256`、`intentSha256`、`intent:TaskIntent`（Design/Plan/Task/Scope/全ACの正確な参照）、`rules:AcquisitionRule[]`、`sessionId`、`worktreeRoot`、`baseCommit`、`skill:{id,name,path,contentSha256}`、`nativePort` を全て必須とする。余分なキー/重複キー/不正型を拒否。Manifestは選択Artifactのdigestと既存approvalRefを固定し、Plan内のScope Policyを含む。Ownerは一組全体を承認し、receiptをapproval.json外でも保全する。digest照合は外部Owner判断への結合であり、暗号学的Owner認証ではない。
- 固定HostはS5のcoreultra7-270k・OpenCode 2.3.2、binary SHA-256 `e6543f6e5c39c40971ba38afd1819ac852c29ac735b5a89065d3d148d47f27ad`。Task 6でOwnerが実際の実行binary・staged plugin・起動境界を事前固定。PluginはLinux `/proc/self/exe` のSHA-256とOwner packageの期待値を照合する。実行形態によりこの照合が成立しなければOFF、別の信頼経路を自動採用しない。Skill名は `executing-plans`、実Info.id/path/content digestも固定する。
- Session IDは実行前に実在する専用SessionをOwnerが確保し、IDを固定してから承認する。必要な場合はDaily OFFの専用HostでSessionだけを作成し停止、承認packageをmountして同じ専用Stateで起動する（Task 6の別GO内。Taskを先に実行しない）。専用Sessionは親なし、他Task実行済みでないことをOwnerが確認し、begin時Native Sourceを確認。`context.location.directory` と `realpath`/Git rootは固定worktreeRootと一致、開始HEADはbaseCommit、tracked/index/nonignored untrackedはcleanであること。初回の専用worktreeは独立した専用repository/checkout（共有Git metadataへのリンクなし）に限定し、共有Git metadata・object storeを変更しない。artifactsはworktree外の固定mountからのみ読む。
- Host側の事前条件: Ownerが管理する専用起動、変更不能なread-only mount、専用loopback API、専用State、共有Credential不可視、agentにmount変更/Host管理権限を付与しない。Runtimeで `/proc/self/mountinfo` の該当mountのroとnested mountなしを確認し、pathを固定しsymlink/非regular file/相対逸脱を拒否。安全なbounded read、file stat前後比較、raw digestを使用。設定・digest・対象不一致、境界が確認できない場合はOFFまたはUNAVAILABLE。環境・同一UID敵対プロセス・OS権限に対する完全な耐改変証明ではない。Ownerがこの信頼境界を用意できない場合は実運用不可。
- Production wiring: `createJusticeV2Plugin.setup(context)` は既存`justice_review`を先に登録し、`createProductionDailyPorts(context)` を呼び出す。同関数がPlan T5の既存契約に従って固定環境変数をcaptureし、固定mountの `loadDailyOwnerConfig` による読込み・検証、Runtime検証、Production portの構築を担う。READYの場合だけDaily登録へ進み、OFFの場合は既存登録のみを維持する（既存read-only検証、固定loopback Native GET、固定 `/usr/bin/git` read-only port、同じ承認packageの再照合）。`prepareDailyBinding` はこのconfigとportだけを使用する。manifest/intent/artifactsの選択bytesはprivate snapshotへコピーし、既存 `loadS1aArtifacts` + `createCapturedS1aSource` + `extractTaskScopePolicy` で検証。`identityCandidateReady=true`・digest一致・構造化Scope Policy READYを要する。`eligibleBaseline=false` と `NOT_PROVEN` は維持。begin/finish直前・診断公開直前に同一package/digest/Identityを再照合する。TERMINALでcached Advisoryを返す直前にも、既存 `verifyDailyBinding(binding, ports.preflight, signal)` を使用し、Owner package / 外部固定digest、Runtime identity、Manifest / Intent、Selected Artifact bytes / digest、Scope Policyを同じ固定入力と現在のread-only供給元で再検証する。private snapshotの自己照合だけで済ませない。Binding不一致・検証不能時は `UNAVAILABLE / BINDING_INVALID` とし、両診断非評価の新しい安全な結果を返す。stale Advisoryを有効な結果として返さない。Native Evidence・Git ChangeSetの再収集、S1-d再診断、Task再実行、新規再検証機構、初回clean baseの再要求は行わない。
- AI向けToolは固定 `justice_task_begin` と `justice_task_finish`、直接公開 `options:{codemode:false}`。begin引数は空objectのみ、finishはbeginが返した `bindingKey` のみ。実Session/Message/Call IDとAbortSignalはSDK ToolContext由来。Task/Scope/AC/承認情報/port/パスをToolから供給・変更できない。`bindingKey` はapproval digestそのもの（秘密/認証tokenではなく、単なる相関キー）とする。固定Session/状態照合を省略しない。
- Test seamは内部factoryへの型付きport注入だけ。Production default exportは固定constructorを使用する。fixtureの `READY` / mock trust / mock Sourceを実Hostの承認や実証と混同しない。source code、test、artifactの改変やPlugin自体の敵対的置換は別の信頼境界。

### 4.2 Evidence Bridge — RG-002: deterministic attribution

**最初のAC Evidence対象はNative direct `shell` の明示的なforeground試験呼出しのみ。** 固定v2.3.2の `packages/core/src/tool/plugin/shell.ts` は `name="shell"`、full_codemode無効時の `codemode:false`、`command/workdir/timeout/background` を定義する。Code Mode自体は維持するが、Code Modeの内側のshellや外側のexecuteをAC Evidenceとして採用しない。外側のexecuteを単に試験成功と読み替えることも禁止する。最初のPilotではOwner固定profileでNative direct shellが利用可能であることが前提。無い場合はHOLDし、alias、nested metadata mapping、Tool transformによるshell改変等への切替えを実装者に委ねない。

AcquisitionRule（Plan Task 1の型が正本）:

```typescript
 type AcquisitionRule = Readonly<{
   ruleId: string;
   acRef: IntentRef;
   purpose: "TEST_INVOCATION";
   tool: "shell";
   input: Readonly<{ command: string; workdir: string; timeout: number; background: false }>;
 }>;
```

- `ruleId` はsafe identifier、ACは固定IntentのAC ID+Revisionに完全一致、inputは非機密のOwner承認済み試験コマンドの正確な文字列、固定worktreeRootと同じ絶対workdir、整数timeout 1..60,000ms、`background:false` 明示。commandは1..4,096 UTF-8 bytes、NUL/CR/LFを含まない。ルール1..128、ruleIdとinput tuple重複禁止（同じ入力を複数ACへ割り当てない）。複数の異なる規則が同じACを参照してもよい。Ruleは照合用であってPluginからshellを実行する指示ではない。ACの試験成功条件をTEST_INVOCATIONで充足したと扱わない。既存MATCHED_REF_PRESENTは参照存在のみである。OwnerはACの意味と当該試験の関連を事前承認し、シークレット・daemon起動・detach・外部通信を含むコマンドは対象外にする。
- Native `execute.before`/`execute.after` のhook Identityは `(sessionID,messageID,id)`。SDK `id` はCallIDであり `callID` というpropertyは読まない。afterでは`tool/status`、beforeでは`tool`を取得。`packages/core/src/tool.ts`は直接call.idからContext.idを作る。`message-updater.ts`はAssistant part.idを同一event.data.idで保持する。Code Mode内側は別idで保存Messageに独立行を持たない。実Hostで同一性が成立するかはTask 6で確認する。
- Hookはraw inputを保存せず、strict exact-key objectから上記4fieldをその場で比較し、完全一致のruleId又はnullのみを記録。before/afterの観測に同じruleIdとtoolが必要。after `status=completed` のみ候補。output/result/errorは読まない。対象Session以外のraw payloadは評価もしない。Hookのinput比較は許可された非機密コマンドとの等値比較であり、入力本文のログ、ハッシュの無差別収集、任意payload保全を行わない。
- Native Sourceは固定loopback `http://127.0.0.1:<nativePort>` の `GET /api/session/:sessionID` と `GET /api/session/:sessionID/message` のみ（shell静止確認用は§4.3）。first page `order=asc&limit=100`、後続 `cursor=<opaque>&limit=100`、type filterなし、raw UTF-8 response bytesを既存Source v1 wrapper内のresponseとして保持。`sessionAfter` は取得後session.getの実応答。既存S2B_LIMITS・厳密validator・cursor連続性を使用し、redirect・任意宛先・credential forwarding禁止。最大64 pages、1 collection 30秒、各GET 5秒、既存raw size caps、over-limit/timeoutは非昇格。未完paginationはLIMITED、完全を装わない。実行前baseline collection、finish時の最大2回の収集は別の固定観測点であり、失敗のretryではない。
- Correlation: begin/finishの間のactive epochのみ。固定session、Assistant message.idとpart.type=tool、part.id=hook.id、part.name=`shell`、part.state.status=`completed`、part.executed===false、part.state.inputの4field完全一致、before/after ruleId一致が全て必要。messageはbeginの後・finishの前の厳密な範囲にあり、開始時prefixのIDを含まない。begin/finish自身、`justice_review`、outer execute、nested idで保存partがないTool、別Session、開始前/終了後、未確定・エラーは非帰属。Source内のid/型/状態重複、同一ruleへの0件/複数件、異なるruleとの衝突は当該rule非帰属・LIMITED（偽の1件を選ばない）。厳密validatorが全体REJECTEDならDaily Evidence REJECTED。無関係Toolは候補を作らない。後付けMapping、類似度、commandの部分一致、Tool名のみの帰属禁止。
- `justice-s2b-correlation-v1`: `{schemaVersion,sessionId,messageBindings:[{messageId,taskRef:binding.intent.task,scopeKey:binding.intent.scopeKey,tools:[{toolId:part.id,acRef:rule.acRef}]}]}`。同じmessageIdの異なる一意partは一つのbindingに集約、複数message/ToolをIDのUTF-8順で決定的整列、同じpartを複数ACに使わない。既存validateS2bCorrelation/projectS2bEvidenceで再検証。Ruleの未充足は安全なreason/countを残す。
- 固定v2.3.2の`publish-llm-event.ts`は保存`executed`に`providerExecuted`を渡し、`step.ts`はproviderExecutedのToolをローカル実行しない。したがってdirect shellのlocal hookと保存partの照合は`executed===false`を要求し、true/欠測をlocal実行の裏付けとしない。既存projectorは`completed && executed===true`のときのみ`reportedExecutionState:"EXECUTED"`とするため、今回のlocal Evidenceでは既存結果`reportedExecutionState:"UNKNOWN"`、`reportedOutcome:"UNKNOWN"`、`type:"other"`、`provenanceClass:"UNVERIFIED_EXTERNAL"`をそのまま利用する。新規Daily reportは対応したlocal completed hookの件数のみを別に示す（実行/成功の正式保証ではない）。Tool completedは試験成功ではなく、AC関連試験呼出しの限定報告である。exit/outputを解析してPASSにしない。別の試験結果証拠の実証は今回の要件外。
- raw Source本文は既存validatorに必要なので専用非機密Sessionからだけbounded memoryで取得し、返却後解放。生input/result/error/Provider payload/headers/secretをログ・独自永続化・Advisory・GitHubへ転送しない。既存HostのSession保存自体をなくす保証ではない。secret混入の完全排除・JSメモリ消去保証は主張しない。境界不明なら取得しない。

### 4.3 Advisory Bridge — RG-003: lifecycle and bounded finish

Task境界は固定Skillの明示的な直接Tool呼出し（inline executing-plansのみ）。`skill.transform` はOwner固定のid/name/pathと `sha256(UTF-8 content)` が一致する唯一のSkillにだけ指示を追加し、元のWorkflow・Reviewを維持。Skillの取得/利用はモデル依存で、呼出漏れはNOT_OBSERVED。`justice_task_begin({})` と `justice_task_finish({bindingKey})` は `options.codemode=false` によりdirect公開し、Code Mode内側でfinishを待つ自己デッドロックを避ける。ToolContext.id/sessionID/messageID/agent/signalを使用し、モデル引数からは得ない。controlは各々単独Assistant messageで呼び出し、並列・他Tool同居は禁止。実Hostでdirect公開できなければ停止する。

状態遷移（新規Justice Gateではなく、単一Task分のプロセス内調整状態）:

| State | Operation | Next / rule |
|---|---|---|
| ARMED | begin | 同期的にSTARTING予約、固定承認/clean base/静止・Source検証開始。他のbeginはBUSY。 |
| STARTING | begin success | ACTIVE、境界epoch固定。検証失敗/abort/競合はTERMINAL（UNAVAILABLE）。 |
| ACTIVE | observe | 対象Sessionの非control before/afterを対にして追跡。重複同一eventは無視、矛盾/unknown after/over-limitはtaint。 |
| ACTIVE | finish | 同期的にFINISHINGへseal。unfinished/競合を検出した場合も再試行せずLIMITED/UNAVAILABLE。 |
| FINISHING | observe / finish | 後述epoch監視。正しい同一要求は既存Promise共有。新Call IDの並行finishは境界不確実、LIMITED。 |
| FINISHING | settle | TERMINALへ一度だけ。diagnosis結果は候補報告であり正式完了でない。 |
| TERMINAL | finish | 同一bindingKey/Sessionでも§4.1の既存verifyDailyBindingがOKの場合だけ有効なcached Advisoryを返す。後着の観測があれば既存規則でLIMITEDへdowngrade。不一致・検証不能はUNAVAILABLE/BINDING_INVALID（旧結果を返さない）。再収集・再診断なし。新begin不可。 |
| any | dispose | DISPOSED、abort、追加登録解除。新規処理なし、再起動時に旧bindingを再開しない。 |

- begin/observe/finish/disposeの型とreason codesはPlan Task 5を正本とする。すべてのstate/active map/epoch/cached promise更新は最初のawaitより前の同期区間で行う。foreign SessionのcontrolはUNAVAILABLE、対象Sessionの状態を変更しない。境界controlはbegin/finishのみ。justice_reviewはAC非対象だが通常Toolと同様にin-flight観測する。対象Session外の独立Toolは無関係として非帰属。子Sessionを起動するTaskは非対象で、観測されたchild/delegationは境界不確実。
- ARMEDからbefore/afterを追跡し、開始前ToolはAC候補にしない。begin時、他のactive Toolがなく、初回Sourceの全pageが連続、現在のbegin part以外にrunning/streamingなし、begin messageが一意で他Toolなし、親/他Task履歴なしを確認。Skill読込等の事前準備はprefixとして除外。beginのafterはcontrolとして識別。STARTING中の新規非control Toolはtaint。開始前完了partとbegin markerを記録し、古いToolの遅延afterを候補にしない。ACTIVEのbefore/afterは同一ID tupleを厳密照合。観測4096件上限（before+after合計、control含む）。cap超過、unknown/contradictory after、alias変更、欠落を境界不確実として記録。
- finish開始時にactive mapの非controlが空、begin controlがsettled、finish自身以外のcontrolなしが必要。before/after hookに加え、固定loopback `GET /api/shell?location%5Bdirectory%5D=<encoded fixed worktreeRoot>` のrunning shell listをbegin時とfinish前後で確認し空を要求。レスポンスは1MiB上限、5秒、正しいLocation wrapper/data配列のみ。追加のURL/出力取得・shell停止はしない。SDK/Native statusにより不明なら境界不確実。Tool完了がshell終了とは限らない（Native shell timeoutはbackgroundに移行し得る）。
- finishは観測epochをsealし、Source snapshot A、Git snapshot、Source snapshot Bを一度ずつ固定順に取得。2回のSource snapshotは同じSession、同じ連続Message ID順・raw message page bytes（wrapper時刻を除く）、begin/finish marker、一意のdirect finish part、他のnonterminal Toolなしを要する。finish自身はrunningを許容する唯一のpartでありEvidenceから除外。finish messageに他Toolがある、begin/end markerがない、prefix矛盾、Source未確定、観測中に非controlのbefore/afterが到着、active call残存、shell list不明/非空、child/background/compaction/location changeで境界不明なら `BOUNDARY_UNCERTAIN`。新規polling、sleep、retry、idle-as-finishを設けない。Sourceは各30秒、Gitは30秒、finish全体90秒以内（超過でAbort）。
- 境界不確実のためにEvidenceを信頼できない場合は、そのEvidenceをUNAVAILABLE扱いにして独立Git Scopeのみ§4.4に従う。Gitも静止/Identityが不明ならUNAVAILABLE。既に妥当に得たGit候補逸脱は欠測により消さない。観測結果が一度返却された後にlate hookを受けた場合、過去の結果は観測点時点の候補報告としてのみ扱い、TERMINALをtaintして後続照会はBinding再検証OKを前提にLIMITED（既存UNAVAILABLEは維持）。返却済み情報を撤回できないことを明記する。永続的なTask完了/承認状態を作らず、後から発生する全操作やOSレベルの子processまで保証しない。
- AbortSignalはToolContext.signalとcoordinator lifetimeを結合し、キャンセル対応I/Oへ伝播。既存S1-aの非キャンセル型bounded file readは前後チェックし、中断後の結果を破棄する（既に発行済みOS I/Oの即時停止は保証しない）。中断で診断公開を抑止し、キャッシュをUNAVAILABLE/ABORTEDへ固定。disposeは同期的にDISPOSEDへ移行・abort、new work拒否。setupの追加登録順は before hook → after hook → daily control tool transform → skill transform。解除順は逆（skill → daily tool → after → before）。部分setup失敗も成功済みhandleだけ逆順disposeし、既存justice_reviewを残す。追加登録のcleanup失敗は固定コードで内部状態を記録し、利用可能な既存経路に限って通知する。通知経路のない場合は実Host確認でcleanup未確認として扱い、対象runtimeをOwnerのStop手順で停止する判断材料にする。強制Host停止は実装しない。Plugin全体unload時のみ既存handleを最後に解除。

### 4.4 Daily partial diagnosis — RG-004: independent Git scope

既存 `runS2bOfflineAdapter` はREJECTEDならS1-d呼出しゼロ・`s1d` fieldなしのまま。Daily専用経路のみ、同じvalidated projection処理を再利用し、既存S1-dに独立したGit ChangeSetを供給する。Evidence Source rejectionとOwner/Intent binding invalidを混同しない。

Git ChangeSetは開始時clean固定baseから、終了時のbase→HEAD、HEAD→index、index→worktree、nonignored untrackedのpathをunion。NUL区切り、strict UTF-8、`--no-renames`（旧DELETE/新ADDを保つ）、no shell・no external diff/textconv、bounded Git、既存`inspectChangeSet`（128 entries、path 1,024 UTF-8 bytes、JSON 262,144 bytes）。root/HEAD/index/status等の前後照合、non-ancestor/unmerged/submodule/type change/partial/unsafe path/不安定snapshotはUNAVAILABLE。Git設定・環境・引数を固定し書込みなし。専用repositoryの初回対応設定はPlan T3の明示allowlistのみ。ignored paths、途中でrevert済みの変更、外部副作用、filesystem race freedomは対象外。

| Binding | Native Evidence | Git | Daily state / scope | S1-d call |
|---|---|---|---|---|
| valid | VALID (projected/limited) | VALID | DIAGNOSED（projection/rule limited、境界不確実、stage非評価ならLIMITED）、S1-c candidateScopeComparison、Evidence diagnostics両方 | 1 |
| valid | UNAVAILABLE | VALID | LIMITED、Scope Fallback、Evidence NOT_EVALUATED | 1 |
| valid | REJECTED | VALID | LIMITED、Scope Fallback、Evidence REJECTED理由保持 | 1 |
| valid | VALID | UNAVAILABLE | LIMITED、Evidence診断維持、scope UNKNOWN | 1 |
| invalid | any | any | UNAVAILABLE/BINDING_INVALID、双方NOT_EVALUATED | 0 |
| valid | UNAVAILABLE or REJECTED | UNAVAILABLE | UNAVAILABLE、scope UNKNOWN、欠測/拒否理由保持 | 0 |

- VALID Evidenceには既存S2-b PROJECTEDまたはLIMITEDの受理済みProjectionだけを含める。全体REJECTEDのrefsは再利用しない。個別rule欠測はDaily全体をLIMITEDとする。既存projectionStatusとDailyのruleLimitedは別の値として保持し、既存PROJECTEDをLIMITEDと書換えない。`[]` は実際の受理済み空projectionに限る。取得不能/拒否を空配列で偽装しない。
- Daily pathはT1の固定snapshotを再照合し、既存S1-d `runS1dDiagnostic(request, virtualSource)` を上表に従い最大1回呼ぶ。Native Evidence unavailable/rejectedでは仮想evidence pathのreadを固定 `Error("unreadable")` とし、S1-dの `EVIDENCE_SOURCE_UNAVAILABLE`、`INPUT_READ_FAILED`、`computeScopeFallback` をそのまま起動する。Git valid時は既存ChangeSet JSONを渡す。Git unavailable時は `{"availability":"UNAVAILABLE"}`。既存Scope FallbackがPlan/Binding要件を満たさなければUNKNOWN。新しいScope評価器を作らない。T1のBinding失敗時には診断を呼ばない。
- Daily reportは独立した `evidence` / `scope` / `boundary` / fixed reason codesを持つ。既知の `OUTSIDE_CANDIDATE_SCOPE` をEvidenceの欠測やREJECTEDで打ち消さない。Fallbackの `formalVerdictAvailable=false` / `NO_FORMAL_S1C_RESULT` を保持。`formalVerdict:"UNKNOWN"`、`ownerAuthorityStatus:"NOT_PROVEN"`、`coverageCompleteness:"NOT_ESTABLISHED"`、`nativeDiffProjection:"UNAVAILABLE"` は全結果で固定。DIAGNOSEDは両経路の限定診断が完了した意味のみ、合格ではない。safe task/revision/scope、固定理由code、件数を返し、raw payload、絶対path、scope外path本文、raw Session IDを返さない。既存の既知制限を保持する。

## 5. Initial implementation scope and constraints

- Superpowers First / OpenCode V2 Native First。固定2.3.2、single Task/Session/Process、dedicated Git worktree、inline executing-plans。最初はdirect shellのAC帰属のみ。Code Modeの他Toolは観測するがAC自動帰属しない。子Session、複数Writer、並行Task、他Version非対象。
- Default OFF / Advisory Only。S1/S2/S3契約保全、既存V1/V2 justice_review不変、resolve拒否維持。Owner/Intent異常時fail-closed、正常独立作業を機械的に止めない。
- Owner package・TaskIntent・Scope Policy・AC・rule・Session/worktree・baseを事前固定。既存Plan構造化block `## Justice S1-c Task Scope Policies` とbegin/end marker、justice-s1c-task-scope-v1、planRef/taskRef/scopeKey/allowedPaths。自由文推測/後付け承認禁止。
- Native Source/raw payloadは専用非機密Sessionのbounded memoryのみ。共有Config/State/Credential変更禁止、外部Networkは別承認、secret収集・永続化・転送禁止。新規依存/Lockfile変更禁止。
- 強制Gate、独自Workflow/Review/Router、S4、V1全面移植なし。新規認証/署名基盤なし。無制限Polling、無断再実行なし。
- 今回は文書訂正のみ。Source/Build/Test/Live/Release禁止。Commit/Push/PRは別明示承認。T1–5の実装着手、T6のHost実行、Production Opt-in、E1/E2/E3解除、Releaseは未承認。後続Task・独立Review・追加訂正の自動開始禁止。

## 採択済み基本設計・受入条件

- Intent Bridge: 承認済みManifest / TaskIntent / Scope Policy / AC、実行対象と基準点を実行前に固定。
- Evidence Bridge: Native Source / Tool Identityを事前規則で帰属、実Git ChangeSetを既存診断へ供給。
- Advisory Bridge: Superpowersの明示的Task境界から診断し、既存Review/完了判断へ還元。正式承認とは区別。

| ID | 受入条件 |
|---|---|
| AC-D01 | 承認済みDesign/Plan/Task/AC、実行対象・基準点を事前固定 |
| AC-D02 | Native Evidence取得・対象Task帰属 |
| AC-D03 | 実ChangeSetを既存S1-c/S1-dに接続 |
| AC-D04 | Evidence不足、Scope逸脱、不正帰属の診断 |
| AC-D05 | Task境界で自動診断・Advisory返却 |
| AC-D06 | Authority未証明・欠測を成功へ昇格しない |
| AC-D07 | 通常開発を不要に停止せずレビュー循環なし |
| AC-D08 | Opt-in / Stop / Rollback、既存環境・Credential保護 |

## 6. Completion / stop / owner checkpoint

S5 `BOUNDED_COMPLETE=APPROVED` を維持。#355/#356/#358 Closed維持、#357延期維持、#388 Open、#401は参照根拠（本文未変更）。E1/E2/E3 HOLD、RELEASE_APPROVED PENDING。今回のDaily Assuranceは独立した追加接続である。

T1〜5のOffline TDDとT6の実Host確認を分離し、AC-D01〜08を実証する。Native direct shellの公開、Hook idと保存part id一致・local `executed=false`、実SDK Skill transform、actual API形状、begin/finish境界、隔離・rollbackはTask 6で確認する。Owner供給境界の不成立、SDK非対応、危険な副作用、承認不明なら該当操作を停止。未実行をFAIL/PASSにしない。実Provider・Credential・外部Networkを伴う運用は別承認・固定費用/回数/境界が必要。実験結果だけでProduction Opt-inを付与しない。FindingのみでScopeを拡張しない。

## 7. Implementation plan

[Implementation Plan R0.1.2](../plans/2026-11-24-justice-v6-daily-assurance.md) に具体的な型・Port・Reason・RED/GREEN・commit境界を定義する。#401の原R0.1とReviewed HEADは履歴のまま保全する。

RG-001→§4.1 / T1,T5、RG-002→§4.2 / T2、RG-003→§4.3 / T5、RG-004→§4.4 / T4。設計・Planの訂正後はHuman Owner Checkpointで停止する。独立レビュー・実装・Host実行・Releaseの自動開始なし。
