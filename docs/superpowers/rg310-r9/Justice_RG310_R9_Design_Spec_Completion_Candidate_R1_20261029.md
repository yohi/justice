# Justice RG-310-A-001 — WT1 Contract B R9
# Security Design Specification — Documentation Completion Candidate R1

**基準日:** 2026-10-29（JST）  
**状態:** `DOCUMENT_CANDIDATE / NOT_RATIFIED / NOT_IMPLEMENTATION_READY`  
**既存設計原本:** `Justice_RG310_WT1_Contract_B_R9_Security_Contract_R0_8.md` (`R9-SEC-CONTRACT-DRAFT-v1.8`)  
**本資料の方式:** R0.8を置き換えず、原本の「有効・留保・未証明」を整理する**独立した設計補遺候補**。原本の採択・書換え・R0.9正式発行を意味しない。  
**Authority:** `DOCUMENT_ONLY / READ_ONLY_SOURCE / NO_NEW_FEASIBILITY_EXPLORATION / NO_IMPLEMENTATION / NO_TEST / NO_BUILD / NO_RUNTIME / NO_GIT_OR_GITHUB_WRITE / NO_GATE_AUTHORITY`

## D-01. 原本と証拠のスコープ

### 参照固定原本

| 原本 | SHA-256 / Git blob | 利用範囲 |
|---|---|---|
| R0.8 Security Contract Draft（1404行） | `46da88041b21aebcdfd0e26f31aea700ad8e63e47bfd7b207a25ef3748af3a5c` | 章立て、既存要件、CT/CF/EF、Owner Decision、STOP |
| R0.7 Security Contract | `8dce32ee29eeb42eeabc34ad056667eade7d876594e118dc7640b7d9ed1553f6` | 旧版整合・用語差分 |
| Phase A Blocking Report | `947192ac61a4f1495550daee255124cc50bfe7bb7b77b14b86e7870ee0f74a09` | 過去の阻害主張（全称不可能性は採択しない） |
| Fresh Independent Phase A | `c29b9afedef32c982d6df277a6905300ce700168d51cb84863fcda25e788723c` | `FEASIBILITY_NOT_ESTABLISHED`、第4ファイル単独不足 |
| A (`artifact-verifier.ts`) | `e84186b727382e08926cbd0728aef903037ea4b850e2dbfc63cb8bb70a6d4e8b` | 固定R8未コミット実装事実 |
| M (`mock-publisher.ts`) | `eb3df7b2d79ed9c4e283ca81708881925d6542d7cff5ff879a574c63ea4cfee8` | 固定R8未コミット実装事実 |
| T (`wt1-mock-publisher.test.ts`) | `2d1d71c13bbe1a7f4dee57b280a41b7a78d48fbc1c5a559f25c2a2c457cab936` | 84個の静的it定義 |
| Caller Attribution R1 Codex | `82ce55156103471564c3380d97a152c6ac78f7a4062360f071cdf3a203130831` | 条件付き探索結果（証明主張は未採択） |
| C2/C3/C4 Codex比較 | `40fe6d2d08dfab7e5d686ce606f823c31a7fe4fa68a3b7a6dddc1f3d90d09bfc` | 方式比較の参考。`PROVEN_STATIC`は未採択 |
| Justice v4親設計 / `v4` branch | Git blob `482bd8fc6c344aa5f462be3cd77677dff838f584` | 親Review Gate設計との関係。**R9設計の代替ではない** |
| Justice v4親実装計画 / `v4` branch | Git blob `56474cc1441b45e265ed4a31ca5bb93e1e9321d1` | 20タスクの進行管理との関係。**R9専用実装計画ではない** |

親文書：`docs/superpowers/specs/2026-10-09-review-gate-v4-contract-conformance-design.md`、`docs/superpowers/plans/2026-10-09-review-gate-v4-contract-conformance.md`。2026-10-29にGitHub読取取得した `v4` ブランチ上のblobを識別した。今回ファイルを変更していない。R8とRunnerの歴史的同時実行対応は `R8_RUNNER_ASSOCIATION_NOT_VERIFIED`。過去Design Handoffの不一致 `b7be509...` vs `6fc37b6...` は未解消。

## D-02. Scope / Status / Precedence

### 固定目的

WT1 Contract Bが、stagingした一意なtarballのバイト整合性、正規のPackage/Asset dual emission、正規Harnessの認可、Receiverの宛先不変性、失敗時のfail-closedと監査可能性を担保するための**実装判断に使える安全な契約仕様**を定義する。これは仕様目標であって、実装または実行済み保証ではない。

### Owner採択済みの不変条件

- `OWNER_ADVERSARY_BOUNDARY = B0_PLUS_B1 / ACCEPTED`。B0はgenuine StageEligibilityを持つ非認可Callerの公開操作、B1は同一worker/realmで初期化より前の任意JS・先行import・公開bootstrap競争・prototype/global操作などを含む。通常B1操作を理由なくB2へ再分類しない。
- `THREE_FILE_CONSTRAINT = MAINTAINED`（A/M/T）。緩和は将来のOwner判断候補であり**未採択**。
- `FEASIBILITY_NOT_ESTABLISHED`。3ファイル方式の**実現可能性**も**普遍的不可能性**も未証明。
- `R9_IMPLEMENTATION_HOLD = ACTIVE`、`STOP-01..10 = ACTIVE`、`CT-R9 EXECUTED_PASS=0`。
- R0.8の自己評価 `FEASIBLE_WITHIN_3_FILES`（原本§04と§16）は**現在有効な安全性判定ではない**。そのまま正式契約・実装GOと読んではならない。
- 以前のT-root限定探索・C2/C3/C4比較・Caller Attribution R1はすべて `COMPLETED / CLOSED`。その技術的主張の証明不足は残る。

### Normative precedence（この案の読取上の優先順位）

Human Ownerの最新明示判断と、独立レビューによる確認済みの限界を最優先に扱い、R0.8の著者自己評価より優先する。ただし本補遺は公式文書の変更ではなく、独立レビューを受ける**改訂候補**である。原本R0.8の詳細CF/EF/CT定義は引き続きDraftとして参照する。

## D-03. Adversary / Trust Boundary

| 範囲 | 能力 | 守る対象 | 判定 |
|---|---|---|---|
| B0 | genuine E_T、任意公開import/Factory/constructor/coordinate/receive/emit/evaluate | 正規Harness H_Tへの越境、正規P_T/R_Tへの未認可操作 | 防御必須 |
| B1 | B0 + 同一worker/realmでの正規初期化前任意JS・公開関数差替え・フック | 根拠なきRoot交付、権限取扱い、PASS偽装、Receiver hijack | 防御必須 |
| B2 | 信頼済みRunner/Loader・ソース・Inspector・OS等の掌握 | 本件では設計外 | 除外。ただしB1の能力を不当拡大解釈しない |

`H_B`独立領域の正常なイベント発生と、正規領域`H_T`への侵害を区別する。非自明性：常時deny-allでは達成としない。正規Tによる成功経路の存在も証明が必要。

Trust Rootの発行主体、交付機構、正規Caller識別、保持範囲、秘密の再利用耐性は**未確立**。スタック、URL、PID、UID、MessagePort、先着bootstrap、単純nonceを単体で正規Caller認証根拠にできない。C2/C3/C4の方式は未採択。

## D-04. Contract Interfaces and Source-Baseline Distinction

**固定R8で確認された公開面（実装済みの『R9新API』ではない）：**

| 操作 | 固定R8位置 | 現状 | 設計上の証明責務 |
|---|---|---|---|
| `stageArtifact()` | A:417–421 | `ArtifactRecord`を返す | R9の概念的`StageEligibility`との違いを明示し、発行権限を証明 |
| `coordinatePublish()` | A:653–669 | 公開static・Mへ委譲 | 正規Caller認証・他入口との整合 |
| `MockPublisher.coordinate()` | M:879–1022 | 第1引数`pkgPublisher` | 認可なしのSession/Lease/Attempt混用を拒絶 |
| `setReceiver()` | M:355–357 | Receiver参照を変更可能 | Publisher/Receiverを不変に拘束 |
| `MockReceiver.receive()/reset()` | M:52–90 / 134–137 | 公開呼出し可能 | 直接イベント注入・消去を結果認可から分離 |
| `emit()` | M:684–826 | M:688で`isValid`を呼ぶ、M:786で消費、M:797で配送 | 低層呼出し・Token replayを副作用前に拒絶 |
| `evaluateContractB()` | A:678–1018 | 公開結果集計・PASS条件 | Coordinator証拠との結合、B1による表示/結果偽装を防止 |

**設計用概念（R8に実装済みと扱わない）:** `StageEligibility`, `HarnessAuthSession`, `HarnessMasterCapability`, `HarnessAuthority`, `CoordinatorLease`, `S_T/L_T/K_T`、Auth/Lease/Attempt状態遷移。R0.8§05,§08,§09の仕様案をそのまま採択しない。

### 必須先行条件（いまだ未証明）

- **CA-01 Non-circular Authorized Root**: 正規Harnessだけが権限を取得・使用する理由を、B0+B1からの模倣と切り分けて証明する。
- **CA-02 Complete Mediation**: 公開static、constructor、Factory、`setReceiver`、direct `receive/reset`、`emit`、`evaluate`の全入口と結果評価を覆う。
- **CA-03 Immutable Role/Receiver Binding**: `P_T`, `R_T`, `S_T`, `L_T`, `Attempt_T` の所属と宛先が不正な共有参照から変更されない。
- **CA-04 Legitimate PASS**: 不正拒絶だけでなく、正規Tの成功が保全される。

## D-05. State Machine, Linearization, Failure and Result Integrity

- R0.8§09のStageEligibility `ISSUED → BOUND → CONSUMED/REVOKED` とResource lifecycle `OWNED/STAGED/PREPARED/EMITTED` などは**規範候補**。具体的な認可Rootに結び付いた適用は未証明。
- `LP-AUTH`（CallerとPublisher/Receiver束縛）を副作用前に置く必要がある。R8のA:810–823の結果評価はM:797の配送後段であり、遡及的に未認可副作用を防げない。
- R8 M:917/962はAttempt Registry書込であり、Caller認可ではない。M:688は現行Token妥当性の通常検証点。M:786は消費、M:797は実イベント配送点。Receiverが例外を送出しても失敗イベントが記録され得るため、`REJECTED`や`0 bytes emitted`と**副作用ゼロ**を同一視しない。
- Direct `receive()`だけで正規`MOCK_CONTRACT_PASS`が必ず偽装できるとは言えない（R8のRegistry・EventID照合が存在）。反面B1全体に対するPASS完全性も**NOT_PROVEN**。
- 既存契約の Canonical 19 failures `CF-R9-001..019`（R0.8§10.1）、Extended 7 `EF-R9-020..026`（§10.2）、Counter Evidence `CT-R9-001..028`（§11–12）は**参照として保存**。ここで再番号付け・削除・実行認定しない。
- Resource cleanupはR0.8§06に従い、所有者・同一性を証明できないファイルのunlinkを禁止し、隔離・記録・手動処理とする。ただし実装・runtime挙動の確証ではない。

## D-06. Required Security Proof Evidence (not supplied)

| 証明対象 | 最低限必要な証拠 | 現在の判定 |
|---|---|---|
| 正規Caller識別 | B0のgenuine E_T、B1の先行hookに耐える非循環的発行/交付/使用権限 | `NOT_PROVEN` |
| Capability機密/完全性 | K_Tの正確なAPI署名、到達参照、hook、再利用防止、正規対象との結合 | `NOT_PROVEN` |
| 全公開面仲介 | 入口ごと・副作用ごとの遮断点と迂回可能性の証拠 | `NOT_PROVEN` |
| 正規Receiver保護 | `setReceiver`, `receive/reset`, instance identityの不変性 | `NOT_PROVEN` |
| 正規PASS完全性 | 正規Attempt・Registry・Receiver Event ID・評価関数までの真正性 | `NOT_PROVEN` |
| 同一バイト・TOCTOU | CLI consumed bytes / remote verified bytes の同一性証拠とFS境界 | `NOT_PROVEN` |
| 正規機能の非自明性 | B0+B1拒絶と正規T PASSが両立する静的/将来実行証拠 | `NOT_ESTABLISHED` |

単一候補の条件付き不成立を、3ファイル方式全体の普遍的不可能性に拡張しない。`PROVEN_STATIC`（仮説下）を本件の安全性証明として流用しない。

## D-07. Existing 84 Tests / Migration Constraints

- 固定Tでは `it(...)` 静的定義が84件。`CT-R9 EXECUTED_PASS=0` のまま。
- R0.8§13の84行移行分類は**Draft参照**。これをそのまま完成・実行済みと称しない。
- 固定Tでの`coordinatePublish`直接呼出は23箇所。`evaluateContractB`の直接呼出しは固定T原本の静的正規表現検索で38箇所と確認。過去レビューの36箇所との申告差は残るため、数え方・除外基準の来歴を独立文書レビューで照合する（テスト実行は行っていない）。
- C3/C4採択で全84テストを必ず非同期化する、あるいは全84件を個別に書換えると断定しない。同期互換も未検証。
- 互換性の最終基準は、原本84定義が参照する機能・観測点の保存、CT-R9-001..028の実行証拠、Gate別の受入記録。現在は未達。

## D-08. Decisions, Findings and Provenance

**Owner未決**: `OD-R9-01..06=OWNER_DECISION_PENDING`。R0.8§14の提案初期値（staging root、quarantine保持期間/容量/削除主体/権限、3ファイル範囲）はOwner採択ではない。3ファイル制約は別の既採択作業境界として維持。

**OPEN 31件**: `R1-REV-001..010=OPEN`、`CCOMP-R1-001..011=OPEN`、`CA-R1-REV-001..010=OPEN`。各Findingの作業用追跡先は別紙 `Justice_RG310_R9_31_Findings_Traceability_R1_20261029.md` を参照。旧Findingの文書による修正候補はClosureの証明にならない。

**PO名称の版境界:** R0.8の証明項目、C2/C3/C4の`PO-01..13`、Caller Attributionの`PO-CA-01..10`は番号が似ていても同一義務とは認定しない。照合は `版 + 正式名称 + 根拠` を単位とする。

## D-09. Explicit STOP / Completion Definition

**現在の完成度の表示:**

- 文書の整理案としてのレビュー候補：`PREPARED_FOR_FRESH_INDEPENDENT_DOCUMENT_REVIEW`。
- 安全なR9設計書としての採択：`BLOCKED`。
- R9実装計画の実行可能化：`BLOCKED`。
- R9の成立可能性：`FEASIBILITY_NOT_ESTABLISHED`。
- 3ファイル普遍的不可能性：`NOT_PROVEN`。

**受入を妨げる必須事項:** CA-01..04の独立した証明、CF/EF/CTの正確な版対応、31件のFinding処分、Owner Decisions、R8実効Runner証拠、同一バイト/TOCTOU証拠。ただしこの文書限定作業で未証明の内容を新規探索・検証してはならない。

**固定STOP（原本R0.8§15）**: `STOP-01..10=ACTIVE`、とくに`COMPLETE_MEDIATION_NOT_PROVEN`、`TASKS2..14 NOT_AUTHORIZED`、`NO_EXECUTION_GO`、`CLI_CONSUMED_SAME_BYTES NOT_PROVEN`、`REMOTE_BYTES_VERIFIED NOT_PROVEN`、`TOCTOU_COMPLETE_DEFENSE NOT_PROVEN`を維持。

新たな設計プロトコル、実装解、Proofの承認、テスト実行、Git/GitHub書込は本成果物で行わない。
