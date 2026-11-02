# D4 — Justice v6 Open Questions & Proof Obligations R1

> **Authority:** `READ_ONLY / DOCUMENT_ONLY / ANALYST_CANDIDATE / NOT_OWNER_ADOPTED`. 2026-11-02 JST。v4 STOP、Gate/HOLD、v6要件・方式選定・実装許可を一切変更しない。資料の歴史的Owner採択と、本R1の未採択分析は別。

## A. 判定前に必要な問い
1. Justiceの「観測・意味伝達・受理」と、Superpowersの「実装SDD進行」を誰が発動・停止・再開するか。
2. Gate時のPre-implementation reviewerのライフサイクルだけをJusticeが保持する場合、SDD実装reviewerとどの識別子で区別するか。
3. D0・Requirements/Plan digest、Owner approval event、Gate CLEAR、execution authorizationの有効時点はどれか。
4. `rawBody`/caller intentionの忠実性は「原文保存」と「意味保存」をどう測るか（正規化可能範囲を別途定義）。
5. Evidence未到達・Host未対応でも通常の無関係なTask実行をどこまで許容し、何を保護操作として拒否するか。
6. v4 DEP-01 fresh Design re-reviewとv5 #298のprotocol-sensitive inheritance候補をどう扱うか。後者をv4規範に遡及適用しないこと。
7. 証跡を最小化しても再現性と秘匿を満たす保存モデルは何か。
8. Wisdom/Telemetry/Adaptive routing/Retryに追加価値があるか、無効化時との比較ができるか。

## B. 32 Proof Obligations — すべてNOT_EXECUTED

| PO | 検証対象 | 必要な反例/失敗ケース | 新たに必要な証拠 | 状態 |
|---|---|---|---|---|
| `PO-01` | 方法論と実行の非侵襲的分離 | v4 Loop/Pivotが進行へ介入し得る | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-02` | 原文rawBodyとCaller Intentの損失防止 | checkbox化・prompt再生成で意味変質 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-03` | モデル・Provider選択の所有権 | OmOカテゴリ・V1 general例外がHost依存 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-04` | Executorの実観測とTool API区別 | native subtask≠OmO task; Case A/B | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-05` | 承認済Artifact ChainとHuman境界 | Gate CLEAR≠Human承認; D1 drift | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-06` | Evidence-based AcceptanceとWorker自己申告 | self-reportと実行/受理混同 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-07` | 通常実行継続と保護操作の拒否を分離 | command初期化失敗でexpanded parts残存候補 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-08` | Pre-implementation GateとImplementation SDD分離 | Justice側のreview dispatchとSuperpowersが衝突し得る | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-09` | Review worker dispatchの所有者衝突 | 二重review、fix、再reviewスケジューリング | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-10` | Loop/Pivot/RetryのAdvisoryとExecutive差 | v4 R1-F-05未解消 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-11` | V2 Event Storeと完全Semantic Replay | RemediationRound[]/FindingState欠落、IDのみ復元 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-12` | Deterministic ProjectionとCAS/Witnessの手段分離 | PR-341テスト≠G3、V2 replay欠落 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-13` | Approved D0とdirty D1のArtifact authority | Read/Search/Show/attachmentsへの漏れ | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-14` | Finding Field Propagationの未知キー | {...finding}の未知キー残存; 未修正 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-15` | TaskFeedbackの親子ToolCall相関 | tool=taskの暗黙前提と未知result | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-16` | AgentRouterは実行エンジンではない | wrapperの存在はOmO機能充足を示さない | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-17` | WisdomとTiered Storesの費用対価値 | context污染・retention・secret leakage | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-18` | Telemetryの価値と保持ポリシー | latency / privacy / storage overhead | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-19` | Compaction context continuityとHost機構 | 旧Hook保証なし・復元時承認昇格危険 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-20` | Native-firstはv6既定ではない | 31/32とCase AからHost一般証明不可 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-21` | Case A provider stream error後の安全性 | 5つのpost-error観測欠落 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-22` | Unknown-tool synthetic result厳密ID結合 | callback message.id/post append messageIdともnull | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-23` | Positive sanitizer removal証明 | token未出現/changed=falseは除去証明でない | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-24` | 全56シナリオのE2E Closure | unit30/integration15/E2E10/spike1は計画分類 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-25` | Stale Authorizationとreopen | v4 successor fresh review vs #298の限定継承案 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-26` | Recoveryとidempotent external side effects | event存在≠semantic state復元 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-27` | 認証済Protocol Affiliationの信頼境界 | token-holder mislabelを防ぐ強い証明なし | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-28` | Requirements/Design/Planの静的ID連鎖 | 118 Req/38 Design/14 Tasksは実装済みではない | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-29` | Evidence・Gate・Owner・Implementationの権限分離 | R3 PASSは訂正範囲のみ | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-30` | Adaptive routingとFallback/Retryの過剰所有 | Host/providerが既に同等機能を持つ可能性 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-31` | Option CでOmO相当Runtimeを内包 | 安全負担とSSOTの重複、実利未測定 | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |
| `PO-32` | Review Worker/semantic role identityの厳密性 | native controller≠inner worker | Real Host/evidence + negative control; not performed in R1 | `NOT_EXECUTED` |

## C. Mandatory 12 Counterexamples — 個別判定（実行なし）

### CE-01 — CI PASS・Real Host未実行
- **Evidence:** V4-R01 K-012; PR-341の3,586 passed/2 expected fail/7 skipped
- **Judgement (analyst):** 実Host Acceptance不可。Reported testとHost Gate別
- **Not established:** 全Host経路、provider、見落とし・skip
- **Verification:** PO-24。証明実施には新たなHuman Owner承認が必要。

### CE-02 — Worker完了・親Taskへの相関なし
- **Evidence:** V4-R01 K-007/019; V5-ARCH K-004
- **Judgement (analyst):** Task Completion受理不可。報告は観測のみ
- **Not established:** Parent/Call/Child/Result exact join
- **Verification:** PO-15。証明実施には新たなHuman Owner承認が必要。

### CE-03 — Design CLEAR後のDesign変更
- **Evidence:** ISSUE-297; V4-R01 K-010; V5-ARCH K-003
- **Judgement (analyst):** 旧CLEARの再利用不可。変更種別ごと失効を判定
- **Not established:** Authoritative digest/revisionと失効範囲
- **Verification:** PO-05。証明実施には新たなHuman Owner承認が必要。

### CE-04 — Gate CLEAR・Human Approval欠落
- **Evidence:** V4-R01 K-005; V5-OWNER §3
- **Judgement (analyst):** Implementation不可。両イベント別
- **Not established:** Owner署名・scope・実行許可の確認
- **Verification:** PO-29。証明実施には新たなHuman Owner承認が必要。

### CE-05 — Runtime Task ID ≠ Semantic Task Identity
- **Evidence:** V4-R01 K-004; V5-ARCH K-004
- **Judgement (analyst):** IDの見た目一致では相関不可。型/意味分離
- **Not established:** 同一session、tool call、dispatch origin
- **Verification:** PO-04。証明実施には新たなHuman Owner承認が必要。

### CE-06 — Eventあり・Semantic Replay状態なし
- **Evidence:** V4-R01 K-008/009; ISSUE-298
- **Judgement (analyst):** Recovery成功とみなさない
- **Not established:** RemediationRound[]、FindingState、causal result
- **Verification:** PO-11。証明実施には新たなHuman Owner承認が必要。

### CE-07 — JusticeとSuperpowersが両方Review Worker再起動
- **Evidence:** V4-R02 R1-F-05; V5-ARCH §3
- **Judgement (analyst):** 二重Schedulerリスク。Owner未決箇所で自動進行しない
- **Not established:** 0 duplicate dispatchとexact reviewer binding
- **Verification:** PO-09。証明実施には新たなHuman Owner承認が必要。

### CE-08 — Host Capability未証明
- **Evidence:** V4-R01 K-015; V5-ARCH §4
- **Judgement (analyst):** Option未選定。総合点を付けない
- **Not established:** A/B/C同一契約下positive/negative probes
- **Verification:** PO-20。証明実施には新たなHuman Owner承認が必要。

### CE-09 — Task1 31/32 PROVEN
- **Evidence:** V5-LEDGER §7.1; V5-R3 §5
- **Judgement (analyst):** 全体はBLOCKED、Case Aも独立BLOCKED
- **Not established:** 残り1+Case Aの安全確立
- **Verification:** PO-21, PO-22。証明実施には新たなHuman Owner承認が必要。

### CE-10 — 歴史知見がOwner採択済み
- **Evidence:** V4-OWNER-ISSUE; V5-OWNER §3
- **Judgement (analyst):** v6 RequirementsはNOT_ADOPTED
- **Not established:** v6独立審査・別Owner決裁
- **Verification:** PO-29。証明実施には新たなHuman Owner承認が必要。

### CE-11 — 旧NOT_ADOPTED・後続Owner決裁
- **Evidence:** V4-R01 header（作成時の未採択表記）; V4-OWNER-ISSUE（2026-11-01 JSTのHuman Owner限定採択記録）; V5-PURPOSE header（作成時の`INDEPENDENT_R2_NOT_RUN`）; V5-OWNER §1（2026-11-01 JST決裁、R3 AFTERの7ファイルとSHA-256による採択対象固定）; V5-ARCHIVE-ISSUE（2026-11-02 JSTの固定Branch保存・11ファイル照合記録）
- **Established historical facts:** v4歴史的知見のHuman Owner限定採択の有効日は2026-11-01（JST）で、採択範囲は定義済み`JV4-K-001`〜`015`及び`019`〜`023`に限定。v5のHuman Owner限定採択決裁日は2026-11-01（JST）で、対象は独立R3が検証した訂正後R0.2の7ファイル（個別SHA-256はV5-OWNER §1に固定）。v5のGitHub保存は2026-11-02（JST）の別イベントで、採択7件と補助証拠4件の区別を維持する。両決裁の歴史的AuthorityはHuman Ownerの限定知見採択である。
- **Judgement (analyst):** 旧文書の`NOT_ADOPTED`／`INDEPENDENT_R2_NOT_RUN`は作成時点の状態として保存し、後続Owner決裁・R2/R3レビュー・保存イベントを時系列に併記する。後続決裁を旧文書の遡及的書換えとは扱わない。
- **Not independently established:** v4限定採択の分単位の正確な発効時刻（原記録も主張しない）、v5決裁の分単位の正確な発効時刻、今回未取得のv4 Owner Decision候補原本（13,546 bytes）の実バイトと記録SHA-256の独立一致。これらの未照合を既知の決裁日・採択対象Identity・決裁Authorityの不存在と混同しない。
- **Authority boundary:** v4/v5の歴史的知見採択からv6 Requirements／Design／Architecture、実装認可、Gate／HOLD変更、Runtime Option選定への権限移転は生じない。今回の統合候補もその権限を持たない。
- **Verification:** PO-28。固定Ownerコメントと決裁記録、R3 AFTER 7ファイルの同一性及び文書作成時状態／後続イベントの時系列を区別して照合する。新たなHost証明・実行には別途Human Owner承認が必要。

### CE-12 — 両世代未証明の能力を連結
- **Evidence:** V4-R02 R1-F-06; V5-LEDGER §7.1
- **Judgement (analyst):** UNPROVEN+UNPROVEN≠PROVEN
- **Not established:** 同一Hostでの新規正負テスト
- **Verification:** PO-15。証明実施には新たなHuman Owner承認が必要。

## D. Runtime選定前の共通Capability証明契約（A/B/Cとも未選定）

| 能力 | Positive evidence | Negative control | 不一致時の扱い |
|---|---|---|---|
| Task launch | 呼び出し元と実Executor名・CallId・ChildId | native wrapperとinner taskの取り違え | BLOCKED_FOR_ACCEPTANCE |
| Semantic payload | rawBody/explicit routeをexact diff | body短縮/role上書き | REJECT_WRONG_TRANSFORM |
| Review provenance | reviewer identityとtask/gate scope | forged marker/duplicate worker | NOT_ACCEPTED |
| Provider error | error後reissue拒否・clean fresh approval | late assistant/tool output・cached capability | BLOCKED_UNTIL_PROVEN |
| Stale change | artifact/protocol fingerprint一致 | Design edit、Plan-only drift、stale Human approval | INVALIDATE_AS_REQUIRED |
| Recovery | parent-task replay、idempotent effects | crash-before/after-dispatch, compaction, restart | UNKNOWN_NOT_PROMOTED |
| Security/privacy | allowlist persisted evidence、credentials redacted | unknown field injection、positive removal | FAIL_CLOSED_FOR_SENSITIVE |
| SDD scheduling | task progression delegated to method owner | Justice duplicate task/reviewer/final-review | BOUNDARY_CONFLICT |
| Cost/benefit | overhead, latency, token, operator work | features disabled A/B baseline | OPTIONAL_UNTIL_MEASURED |

## E. Authority sequencing proposal (not authorized execution)
1. R1成果物を別セッションでREAD_ONLY独立文書レビュー。
2. Ownerが採択対象Knowledgeだけを限定決裁する場合でも、正式v6 Requirementsとは別イベントにする。
3. 既存v4 STOP/Review Gate/HOLDは維持し、必要なHost検証について別個に承認契約・安全境界を設ける。
4. ホスト共通能力の証拠取得後にのみA/B/Cを比較、選定は別Owner決裁。
