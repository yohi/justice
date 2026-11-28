# Justice v5 — RG-310-A-001 Independent Architecture Decision Proposal

- 提案番号: `ADP-RG310-A-001-R11`
- 作成日: 2026-10-14 JST
- 性質: **読み取り専用／未承認の独立提案**。本書は Requirements、Design、Plan、コード、テスト、Gate を変更しない。
- 評価結論: **`OPTION_B_REVISION11_FRESH_REVIEW_PENDING`**（R5 Fresh Independent Review および R6 予備技術指摘に対する限定規範修正候補。正式独立 Gate 未成立）。`HUMAN_DECISION_REQUIRED`。
- 未変更判定: `RG-310-A-001 = NO_EQUIVALENT_EVIDENCE_CONTRACT`、`Case A = BLOCKED`、`Case B = PROVEN`、`Task 1 = BLOCKED`、`Tasks 2–14 = NOT_AUTHORIZED`、`Implementation = NOT_AUTHORIZED`。

> **読み方:** D・E・H は「将来、Requirements owner と人間の Architecture Decision 担当者が適正な順序で採用した場合の候補」であり、現時点の指示・認可・例外・waiver ではない。`MUST`／「しなければならない」は提案規範の条件法である。

> **R1 review response:** 2026-10-13 `REVISION_REQUIRED` の AR-001/002 Major、AR-003/004/005 Moderate に対する改訂候補。R1 のレビュー自体を無効化したり、その findings を独断で RESOLVED と扱ったりしない。

## A. Executive Decision Proposal — R11

### A.1 結論

**Option B — Explicit Staged Authorization は未承認の条件付き第一候補である。2026-10-13 JST の R5 Fresh Independent Review は `REVISION_REQUIRED`（`RG-310-R5-001` Major：合法な B0/B2-DEP 編集による fingerprint 自己失効と B1 証拠流用、`RG-310-R5-002` Minor：mandatory-safety aggregate の誤記）と報告された。R6 は Immutable Authorization Baseline と許可済み Mutable Output、EAF 証拠失効と grant 失効を別にした新規 `B1-REATTEST-FINAL` を提案するが、承認/実証はない。R4 技術レビューは `REVISION_REQUIRED`（`RG-310-R4-001` Major：F `INV-A07` の `R+I` が Task1 の必須 AND と読める）。R4 は R3-002 と R2-003 の提案上の解消を認められた一方、R3-001 は `PARTIAL`。R5/R6 は既存 Task1 `R` と product/production assurance `I` を Gate 別に分離する。R4 同一会話の技術再審査は formal fresh independence を満たさなかった。続く R5 Fresh Independent Review は `REVISION_REQUIRED` と報告された。R6 作成後の予備技術レビューは formal Fresh Independent Gate ではなく、**当時の R7 提案で別主体による新規独立審査が求められた**（R7時点の履歴であり、今回の R11 審査依頼ではない）。compiled/runtime 実証、人間の採択・実装認可はいずれも存在しない。**

- **A（現行 Gate 維持）**は、最も少ない承認コストで安全性と証拠契約を保持する。未実測 race が固定 Senpi の公開 API で再現不能なら、Task 1/製品開発が長期停止するリスクが高い。fixture の同一 durable session 継続・late echo 等を検証する余地は残る。
- **B（段階的・限定的認可）**は `Task 1 complete → Task 6 production` の認可エッジを限定的に迂回し、**production の実装コードそのもの**を compiled parity の検証対象にできる。これにより循環依存を除去できる。ただし `ACTUAL_STALE_READ_RUNTIME = NOT_RUNTIME_PROVEN` は残り、Task 1/Case A/最終受入は BLOCKED のままとする。製品としての安全性が証明されたことにはならない。
- **C（上流の公開 API／host の変更）**は実 runtime での race 検証を満たすための根本策となり得るが、修正した upstream は現在の pin の証拠ではない。新 pin に対する独立 source/runtime 再検証と全 Gate の再ベースライン化が要る。

**R11 current authoring disposition (document-only):** R10 独立技術レビュー（SHA-256 `738db9254d9e58de398e197d06ca586e28b26062a0e8b8e9a2ab34386dbd59ea`）の `REVISION_REQUIRED` に対する `R10-FI-007` Minor（版識別の残留）だけを限定修正する。`R9-FI-006` は R10 技術審査で `TEXTUALLY_RESOLVED` と評価されたが、formal Gate 成立ではない。`R10-FI-008` Informational に対応して ZIP 全構成の完全差分と rename provenance を提供する（本体規範には影響させない）。**本R11での Option B Revision 11 は proposal document revision を表し、独立の採用済み architecture-version namespace や human phase grant を意味しない。** R8-FI-004/005、R7-FI-001..003、H0→H3、38状態、14 INV、R/P/I、transaction/STOP 条件は継続。実 `TRUSTED_OP_BOUNDARY_PROVEN`、Senpi H0/H2 および HSA は未証明・未発行であり、正式独立 R11 Gate／実行権限は存在しない。

**人間への判断要求:** (1) B の「隔離された guard 実装」に限る有限期限の例外的実装権限を、Requirements 改訂の後に設けるか、(2) その限定範囲と残留リスクを受容するか、(3) race の実 runtime 立証を最終受入の非免除条件とするか、(4) 期限内に立証経路が見つからなければ A へ停止復帰／C へ移行するか。提案者はこれらを決定しない。

### A.2 安全性に関する非交渉条件

1. INV-A01〜A14 はすべてそのまま維持。特に A07 の **実 runtime race 拒否**と A10 の **実 persistence 前 sanitation**を fixture モデル／コンパイルテストで代替しない。
2. B は「限定された開発許可」であり、`Case A PROVEN`、`Task 1 PROVEN`、`TaskAccepted`、`PlanComplete`、通常の Tasks 2–14 認可、配布・導入・有効化ではない。
3. 最終製品受入前に同一固定または正式に再承認された pinned host の**実 runtime での stale read 成功到着後の authority 拒否を観測することを必須**とする。観測不能なら製品受入は BLOCKED、Option C 又は A へ戻す。ここに本書からの最終 waiver は用意しない。
4. `RG-310-B-001` と `RG-310-B-002` を本案で変更・合流させない。canonical 32契約の分母、unknown-tool message identity、positive removal 要件を厳守する。

### A.3 R1 Findings の R2 レビュー結果と R5 非退行（提案上のみ）

| R1 Finding | R2 原文位置（R3 保持） | 提案上の判断 | 現時点の証明 status |
|---|---|---|---|
| `RG-310-AR-001` Major | D.6 / E.1–2/5/9 | result public field と observerScope の origin trust を分割。host-bound proof がないとき result DENY／B2 STOP → C | **NOT_RUNTIME_PROVEN / RESOLVED_IN_PROPOSAL (R2)** |
| `RG-310-AR-002` Major | D.3 / E.2/9 | `package.json` exact Senpi devDependency + `bun.lock` の限定 hunk を B2 の別認可候補に追加。root export 不変更 | **RESOLVED_IN_PROPOSAL (R2) / NOT_AUTHORIZED** |
| `RG-310-AR-003` Moderate | D.6 / E.2/5 | 4状態と AWAIT_FRESH_READ の fresh-only registration、同期 invalidation、FAILED_DISABLED | **PARTIAL (R2) / NOT_COMPILED_PROVEN** |
| `RG-310-AR-004` Moderate | D.4 / E.8 | tsc temp emission、Bun fresh child exact `.js` import、hash graph・mutation、B1 subset | **RESOLVED_IN_PROPOSAL (R2) / NOT_EXECUTED** |
| `RG-310-AR-005` Moderate | D.5 / E.8 | B0 expected RED と formal B1 fail と actual security STOP を区別 | **RESOLVED_IN_PROPOSAL (R2) / NOT_AUTHORIZED** |

人間が判断すべき対象は (i) B0 の隔離開発リスクを受容するか、(ii) B2 の origin-proof/依存実現可能性が未確定のまま B2 authorization をしないこと、(iii) 最終 stale read actual-runtime proof を免除しないこと、(iv) Option C へ移る厳密な STOP 条件である。A は常に利用可能な現行維持案、C は実 host の新公開 API が必要な場合の候補である。

### A.4 R2 `REVISION_REQUIRED` の修正範囲と審査境界（R3 内容維持）

| R2 Finding | Severity | R3 の主要な契約変更候補 | Review/Proof status |
|---|---|---|---|
| `RG-310-R2-001` | Major | D.6.1, E.2(g), E.5.2, E.8.1：`setActivation()` の同期 commit fence、await なし線形化、遅い Promise completion の無権限化、B1 compiled negative/positive | `RESOLVED_IN_PROPOSAL` (R3 technical) / `NOT_COMPILED_PROVEN` |
| `RG-310-R2-002` | Moderate | D.6.2, E.1, E.2(h), E.5.3, E.9.1：authority と persistence の直積状態、retired inventory、exact same-role fallback、実 append 検証 | `RESOLVED_IN_PROPOSAL` (R3 technical) / `NOT_RUNTIME_PROVEN` |
| `RG-310-R2-003` | Minor | B.3.1, E.4, E.6, F.2, G.4：canonical 32 identity と独立 `RG-310-B-002` positive removal の別述語 | `PARTIAL` (R3 technical) / R4 technical RESOLVED_IN_PROPOSAL; canonical 31/32 unchanged |

R3 技術レビューでは R2-001/002 が `RESOLVED_IN_PROPOSAL`、R2-003 は E.4 の誤結合により `PARTIAL` だった。R4 E.4/F.3 はこれを再分離し、R4 技術レビューは R2-003 を `RESOLVED_IN_PROPOSAL` と評価した。**当時の R5 提案は、その R4 technical closure を前提に F の R/I 証拠条件の逆流を除去しようとした（R5原本レビューは本 handoff にない）。R8 は既存のこの R/I 区分を変更しない**。R3/R4 技術レビューは同一会話につき formal fresh independence は未成立。B0/B1/B2 は未認可・未実行であり、R5 自身も `RUNTIME_PROVEN` を発行しない。

### A.5 R3 `REVISION_REQUIRED` に対応した R4 修正と未解消証拠

| R3 Finding | Severity | R4 改訂箇所 | 提案上の修正 | 現時点 |
|---|---|---|---|---|
| `RG-310-R3-001` | Major | D.1/D.2, **E.4**, E.9.2, F.3, H/J | Task1 既存 evaluator → 通常 Task2–6 grant → full Task6 acceptance の一方向依存にする。B2-HOST は test-only evidence、B3 は通常 Task1 Gate への再審査請求のみ | `PARTIAL`（R4 technical; F-A07 が残った）。Task1/Task6 未完 |
| `RG-310-R3-002` | Moderate | **E.4**, E.6, E.10, F.2/F.3, G.4, H/J | B-001/B-002 を既存 Task1 acceptance から明示除外。横断 product-readiness Gate は新たな未採択候補として owner/evaluator を別指定 | `RESOLVED_IN_PROPOSAL`（R4 technical）。B001 BLOCKED, B002 NOT_PROVEN |

**受入契約の区別:** `TASK1_EXISTING_ACCEPTANCE`、`B1_COMPILED_TRANSITION`、`B2_HOST_LIMITED_EVIDENCE`、`FULL_TASK6_ACCEPTANCE`、`PRODUCT_READINESS_REVIEW` は異なる述語であり、互いの success flag を代理してはならない。`JUS5-HARNESS-03` の実 stale in-flight read success arriving→reject および late assistant/toolResult sanitation は最終的な保証から免除しないが、full Task6 完了を Task1 の前提に戻してはならない。


### A.6 R4 技術レビュー `REVISION_REQUIRED` の受理と R5 最小修正（判定ではない）

- 提供された R4 技術レビュー（2026-10-13 JST）は `ADP-RG310-A-001-R4`、ZIP SHA-256 `003f08c6bcd5487b9e350cd9208deb21f1b6e064253d9505b2ffb6867b06ffc5`、CRC PASS、内部 SHA256SUMS 3/3 MATCH、fixed HEAD/blob no drift と報告した。これは **ユーザー提供の過去レビュー結果**であって R5 Author が再実験・再検査したという意味ではない。
- `RG-310-R4-001` Major: R4 F-A07（旧 L590）、その説明（旧 L599–601）、F.0.1（旧 L605）を含め `R+I` が Task1 の必要条件と読める。E.4/E.6/F.3 の既存 Task1 evaluator と矛盾。R5 は F matrix に Gate 列を設け、`TASK1_A07_R` と `PRODUCTION_A07_I` を独立述語へ分離する。`A06/A08/A10/A12` と他行も `R/I` を AND と解釈しない共通規則を付与。
- R4 レビュアーの結論: R3-001 `PARTIAL`、R3-002 `RESOLVED_IN_PROPOSAL`、R2-001/002/003 `RESOLVED_IN_PROPOSAL`。**R5 Author は R3-001/R4-001 の closure を自己宣言しない。**
- 独立性の留保: R4 レビューは同一会話 R3 technical reviewer の技術再審査であり、R4 の formal Fresh Independent Gate に相当しない。R5 に対して R3/R4 reviewer と R5 Author の双方から独立した fresh reviewer を指定する。
- R5 は Option B の B0→B1→B2-DEP→B2-HOST→B3-T1→既存 Task1 Gate→通常 Tasks2–6→full Task6→product という**一方向**構造、E.4 の既存 Task1 evaluator、D.2・R2-001/002 の fence/persistence safety を変更しない。`RG310-PRODUCT-READINESS` は未採択の候補にとどめる。

### A.7 R5 Fresh Independent `REVISION_REQUIRED` を受けた過去 R6 最小差分

- `RG-310-R5-001` (**Major / Blocking**): R5 D.3, D.5, E.3, E.9 の grant-source fingerprint と authorized output の混同、B2-DEP の lock change による B1 attestation の current evidence 流用を是正する。D.2/D.3.1/D.5、E.3.1/E.8.0/E.9.0、F.0.2/F.3.1、G.0.4、H/I/J、別冊 04 を横断して `IAB/AMIO/UD/EAF/EI/IRA/HSA` を規範型定義。**合法 B0 編集では B0 grant を自己失効させず**、無許可差分/安全性違反は直ちに fail-closed。新 RA gate は `B2-HOST-PREP` 後 / HOST-RUN 前の compiled/static-only 検証で非循環。
- `RG-310-R5-002` (**Minor**): 固定 Evidence Report 最終節（2026-10-12）は required-runtime-evidence aggregate `true` / mandatory-safety aggregate `true` と記す。R5 E.6 L533 の「mandatory safety 不成立」を E.6 本文で是正。Task1 が BLOCKED の根拠は canonical31/32 と CaseA BLOCKED であり、CaseB PROVEN、unknown-tool BLOCKED は不変。
- R5 review report **原本ファイル**は今回提供された R5 ZIP/添付3 Markdown に含まれず、ユーザー提示の判定/引継ぎ説明を R5 finding input とする。将来の R11 independent reviewer は原本がない点を evidence gap として明示し、必要なら原本を別途確保する。R6 Author の旧記述は正式 closure/approval/grant を構成しない。

### A.8 R6→R7（履歴）と R7 技術再審査を受けた R8 限定改訂

R5 の `REVISION_REQUIRED` は R5 原本の完全版がこの handoff にないため、その summary に基づく歴史的背景として記述する。R6 proposal は R6 preliminary technical review（正式 Fresh Independent Gate ではない）に基づき R7 提案へ改訂された。R7 本体・R7 §04・R6 原本を基に R7 Fresh Independent **技術**レビューが `REVISION_REQUIRED` を報告した（SHA-256 `cf0b9173975c9f96720ee9f5b69ff5b8834c9a574c57ddac25139afee6de75a1`）。ただし当該レビュアーの署名付き identity／組織的独立性は証明されず、**Formal Fresh Independent R7 Gate = NOT_ESTABLISHED** である。R7 Author の closure、R7 technical reviewer verdict を正式採択の代替とはしない。

R7-FI-001（Major）は R7 の `ALLOWED_DELTA_AT_OP_TIME` を edit admissibility に AND した未来時点自己依存と、未seal共有変更の危険を指す。R8 は §04 §§1–5、D.3.1–3.3、E.3.2/F.0.2/0.3/F.3.1 に **事前の `START_ADMISSIBLE`、隔離 `OP_PREPARED`、事後 atomic `OP_COMMIT_ACCEPTED`、`OP_ABORTED`、historical `ACCEPTED_DELTA`** の型を導入する。FI-002（Moderate）の規範上 R6 §04 参照を **R8作成当時の現行 R8 §04** のみに統一。FI-003（Minor）の `本 R5` 等は当時の過去版として記載し直す。R8当時の変更前後と反例は、R11同梱の歴史資料 `07-r7-finding-closure-R8-historical.md` に、38行の証明義務は `04-authorization-fingerprint-transition-matrix-R11.md` に記録する。

**本会話では直前の R7 technical review を担当した同じ ChatGPT 応答系列が今回 R8 Author として文書改訂を行うため、**R7 reviewer と R8 Author の主体独立性は成立しない**。R8 の FI 論点は原文と反例から再検討したが、その作業を独立の reviewer Gate と称しない。**R8 author の closure 主張は審査対象であり認定ではない****。R8 は文書限定提案であり、原子的 commit+公開/独立署名/全経路仲介、失効/時計/recorder、固定 Senpi actual host-origin はすべて **UNPROVEN**。HSA があっても独立 monitor がないなら PREPARE を含め STOP。次は別主体の R8 Fresh Independent technical review、必要に応じた別の独立 feasibility 調査、その後 *別手続* の R'/D'/P' 採択と人間 Architecture Decision と各 human phase HSA に限る。

## B. Verified Normative Baseline

### B.1 独立読み取り照合

R2 原文は、R2 作成時の GitHub 取得で branch ref が Evidence HEAD を指したと報告している。R3 作成者自身の読み取り再照合は固定 commit/blob と指定 upstream pin の同一性（B.6）であり、mutable branch の現時点 HEAD の独立証明は行えていない。添付 R2 原本と digest/manifest は検証済み。**runtime 実験・fixture 実行は行っていない。**

| 対象 | 固定 ref | 照合結果 | 根拠 URL |
|---|---|---|---|
| Branch `spike/justice-v5-native-evidence-294` | `c428041dfb5779b6b6dc8db7bf14928225a00373` | Git ref の指す commit が一致 | [branch ref](https://api.github.com/repos/yohi/justice/git/ref/heads/spike/justice-v5-native-evidence-294) |
| Approved Design/Plan HEAD | `8a2e4f1536e9cad499ee7e9d996ff163df132fd4` | commit 存在一致 | [commit](https://github.com/yohi/justice/commit/8a2e4f1536e9cad499ee7e9d996ff163df132fd4) |
| Requirements | blob `d335c34b747cafd6ac3b2e81d710fdcc61fb777e` | MATCH | [file](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md) |
| Design | blob `64acdf177d2fd207861eb477af7c8a265eed71e8` | MATCH | [file](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md) |
| Plan | blob `10dfba4c199feff19ee387b244daf6c0fd30d5e3` | MATCH | [file](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md) |
| Evidence Report | blob `7df0887402d1d4eaf34a09e44213cf75b630b813` | MATCH | [file](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/docs/reports/omo-native-v5.1.17-senpi-2026.10.8-contract-evidence.md) |
| OmO Native v5.1.17 | `091728d274f20d62504b0b5e1edbc3970671dd8b` | commit 存在一致 | [commit](https://github.com/code-yeongyu/oh-my-openagent/commit/091728d274f20d62504b0b5e1edbc3970671dd8b) |
| Senpi v2026.10.8 | `d56e6a260d9468418a39bc9120945cf98e06b840` | commit 存在・関連 source 取得 | [commit](https://github.com/code-yeongyu/senpi/commit/d56e6a260d9468418a39bc9120945cf98e06b840) |
| Superpowers v6.4.2 | `8ca22dba9a94f28898bbce59f2537ff4d87c747d` | commit 存在一致 | [commit](https://github.com/obra/superpowers/commit/8ca22dba9a94f28898bbce59f2537ff4d87c747d) |

### B.2 規範と source から言えること・言えないこと

- **Requirements §4 `JUS5-HARNESS-03`**: Native host 相互運用の実 runtime 証拠が production adapter の実装前提。A–K と RG-005 の実 storage／非実行／unknown-tool 条件に不足があれば BLOCKED。[L131–139](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md#L131-L139)
- **Requirements `JUS5-AUTH-01/02/04/06/07/08`**: 人間の明示許可、exact Requirements→Design→Plan chain、実質改訂時の再承認。AI のレビュー／PR／マージは認可の代用不可。[L576–645](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md#L576-L645)
- **Requirements `JUS5-ACC-02` / `JUS5-COMPLETE-01`**: 受入には必要な検証、正規の権限、欠落証拠ゼロ。[L1326–1360](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md#L1326-L1360)
- **Design §7.5**: `provider_stream_error` と `justice_sanitizer_failure` は独立。失効は同期的かつ全 candidate receipt、capability、WorkflowActivationEvidence を対象。durable method selection は保持。新規 post-invalidation read の完全一致成功だけ再許可。failure-retired token は shutdown/restart まで sanitation-only。[L711–748](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md#L711-L748)
- **Plan**: Task 1 は fixture/evidence のみで、全証拠失敗時 STOP。Task 2 は domain vocabulary／codec の担当、Task 6 は実 runtime guard と event 接続の担当。[Task 1](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md#L1212-L1303)、[Task 2](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md#L1307-L1411)、[Task 6](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md#L1777-L1975)
- **Pinned Senpi source**: `shouldTerminateAssistantTurn(error)` が true。`agent-loop.ts` は同一 error assistant turn の未実行 **local ToolCall** dispatch 分岐より前に hard exit する。ただしその前に `providerToolResults` を流し、`finishTurn` callback を await する。[terminal](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/agent/src/assistant-terminal-state.ts#L59-L61)、[loop](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/agent/src/agent-loop.ts#L302-L335)。**他 turn、既開始の非同期結果、provider-supplied results を無条件に排除する証拠ではない。**
- **Pinned Senpi source**: stream error→実 `message_end` の source 経路がある。extension 通知後に append を行う host seam はある。ただし特定 race／継続／正確な JSONL 同一性は source から導けない。[loop](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/agent/src/agent-loop.ts#L716-L732)、[session](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/core/agent-session.ts#L3077-L3129)。RPC routing `sessionId` と durable JSONL `state.sessionId` は異なる。[RPC](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L30-L50)

### B.3 Evidence Report の最終記録

**必ず末尾 `Final Task 1 evidence gate repair — 2026-10-12` を優先する。** ファイル冒頭の「32/32 PROVEN」は更新以前の記録。修復後は `31/32 PROVEN`、Case A BLOCKED、Case B PROVEN、unknown-tool BLOCKED、Task 1 BLOCKED。これはソース確認の結果であり今回再実行した結果ではない。[Evidence L421–583](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/docs/reports/omo-native-v5.1.17-senpi-2026.10.8-contract-evidence.md#L421-L583)

Case A で **観測済み**: pinned provider stream error、real assistant `message_end`、token-free canonical append と同一 SessionManager/JSONL identity、candidate receipt 2件の捕捉・失効・正確な replay 拒否、live capability/current activation 失効、durable selection/read 記録の保持、shutdown までの retired sanitation set、失敗 call の trusted task ID／provenance／tool result 不在。

**未観測の5述語**: `cachedActivationReissueRejected`、`preFailureReadResultRejected`、`freshReadReauthorized`、`lateAssistantSanitized`、`lateToolResultSanitized`。real second-turn で観測できたのは別 child foreign task のみ。`preFailureReadResultRejected` は stale in-flight `R_old` 成功後の拒否が **`NOT_RUNTIME_PROVEN`** である。retry や mock parent/child/cursor の fixture 疑義は原因確定ではない。

Unknown-tool は pre/post `messageId=null` で exact identity join 欠落、入ってきた result が既に token-free で positive removal は観測されていない。**別件**として以下を不変とする。

```text
Canonical runtime contracts: 31/32 PROVEN, 1/32 BLOCKED
Case A: BLOCKED (independent; not the 33rd contract)
Case B: PROVEN
Unknown-tool: BLOCKED
RG-310-B-001: BLOCKED — separate fixture-only track
RG-310-B-002: NOT_PROVEN — separate evidence track
Task 1: BLOCKED
Tasks 2–14: NOT_AUTHORIZED
```

### B.3.1 Canonical 32 と別 Finding の独立台帳（RG-310-R2-003）

固定 Evidence Report 2026-10-12 最終節により、canonical 32 の唯一の BLOCKED は `task1_unknown_tool_capability_echo_is_sanitized_before_persistence` の **pre-append `message.id` と post-append `messageId` の exact correlation 欠落**である。双方 `null`。現行 evaluator `evaluateSyntheticToolResultEvidence()` の非空かつ完全一致、actual `message_end`、append、即時 JSONL readback、token absence、no receipt/provenance/side effect の全要件を保つ。分母32は増減しない。Case A は32の33件目ではなく独立、Case B は独立 PROVEN。

`RG-310-B-002` は **token-bearing synthetic result が入ったこと**と **actual sanitizer によって token-free に変わったこと**の positive removal 観測がないという別の Finding。pre-token=false / post-token=false / changed=false はその肯定証拠ではない。`RG-310-B-001` はさらに別の fixture-only track。unknown-tool identity の改善が自動的に B-002 を解消したり、B-002 の positive removal が `messageId=null` の canonical BLOCKED を回避することはない。担当、必要実証、Gate consequence は G.4/F.2 に分離している。

### B.4 添付の独立レビュー

`01-prior-normative-reconciliation-proposal.md` は model/source/runtime 分離を適切に提案したが Design/Plan 単独の代替契約としては未承認。`02-independent-design-review-decision.md` は**元の独立レビュー全文ではなく handoff digest**であり、その範囲内の要約を参照した。RG-310-DR-001/002（Major）、003/004（Moderate）はいずれも未解消として扱う。

### B.5 R2 で追加した pinned source/binary 契約の独立照合（読み取り専用）

GitHub fixed Senpi source `packages/coding-agent/src/core/extensions/types.ts` の [L1711–1820](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/core/extensions/types.ts#L1711-L1820) は `ToolCallEventBase.toolCallId`、`ToolResultEventBase.toolCallId/input/content/isError` 等を定義している。**この result type は `processGeneration`, `epoch`, `attemptId`, `authorizationId`, immutable session origin を直接証明しない**。これらを現在の observer context から読んでも、古い callback の actual origin と同一視してはいけない。fixed Senpi [`agent-session.ts` L3077–3127](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/core/agent-session.ts#L3077-L3127) は extension callbacks の後に listener/append を実行するが、その ordering だけで G1→G2 stale source alias は排除できない。source existence/order と runtime stale race proof の非同値を保持する。

Justice Evidence HEAD の GitHub [package.json](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/package.json) は direct `@code-yeongyu/senpi` devDependency が存在せず、`build` は `tsc && bun build src/opencode-plugin.ts ...`。`tsconfig.json` は `src/**/*`→`dist` の ESNext compile。root lock は `bun.lock` である。今回 read-only 取得した Git blob は `package.json=8e154e09d0c6253d104b60e72208c5ff2a3478b4`, `bun.lock=6a7f961d68eaef8d42a1e22609528dadf3a5d438`, `tsconfig.json=c9894f496abc59587f0dd39cffe57a7cc6c34a3a`。**これらは B2 の解決が完了した証拠ではなく、scope 設計のベースライン**。実 npm/bun install、compile、runtime test は実施していない。

**検証上の制約:** これらの追加 source では host-side immutable origin guarantee を立証できていない。`B2_FEASIBLE` と断定しない。選択肢 B の認可非循環性と B2 host technical feasibility は別の判断軸である。

### B.6 R3 での再照合結果・限界（2026-10-13 JST）

R3 作成者は GitHub の指定コミットを読み取り専用で取得し、Requirements/Design/Plan/Evidence Report の Git blob SHA-1 がそれぞれ `d335c34b…`/`64acdf17…`/`10dfba4c…`/`7df08874…` と一致すること、および `package.json`/`bun.lock`/`tsconfig.json` が `8e154e09…`/`6a7f961d…`/`c9894f49…` と一致することを再照合した。OmO `091728d2…`、Senpi `d56e6a26…`、Superpowers `8ca22dba…` と二つの Justice 固定コミットの存在も GitHub 上で確認。Senpi `types.ts`/`runner.ts`/`agent-session.ts`/`agent-loop.ts` の固定ソースを取得した。`ToolResultEvent` の immutable host origin 未提供と、`message_end` extension-before-append、error-turn の providerToolResults/finishTurn 境界が残るため、host origin は **未証明**である。

[Requirements](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md) / [Design](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md) / [Plan](https://github.com/yohi/justice/blob/8a2e4f1536e9cad499ee7e9d996ff163df132fd4/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md) / [Evidence Report](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/docs/reports/omo-native-v5.1.17-senpi-2026.10.8-contract-evidence.md)。Evidence branch の**現時点の tip SHA** はこの再照合では別途確証を得ておらず、「現行 tip 不変」は主張しない。固定 commit/blob の一致と mutable branch tip の一致は別の検査である。ビルド/テスト/fixture/runtime 実験は一切実施していない。

### B.7 R3 技術レビューの取扱い・証拠階層

R3 review（2026-10-13 JST）は ZIP SHA-256 `003edd13875feffd761c6e965924f488ca2487c71f69e7968fac6144de15d8e8`、CRC、3/3 SHA256SUMS、指定 GitHub refs/blobs、Evidence branch HEAD identical を報告した。この結果は本書での修正起点とする。ただし同じ会話による再審査のため **正式な Fresh Independent Review Gate と同値ではない**。R3 verdict `REVISION_REQUIRED`、R3-001 Major/R3-002 Moderate は未解消の Finding として再審査対象に残す。

固定 Evidence Report の `evaluateTask1Acceptance()` は canonical 32、Case A、Case B、required-runtime-evidence、mandatory-safety の既存述語により判定する。R3 review が指摘した「B-001/002 を Task1 に追加する」解釈は evaluator と非整合である。Evidence final record の現在値 `31/32`、Case A BLOCKED、Case B PROVEN は変わらない。R5 は過去の review の言及を新たな実測証拠へ昇格しない。

## C. Architecture Options Comparison

| 評価軸 | A — Maintain Existing Gate | B — Explicit Staged Authorization | C — Upstream Public API / Host Change |
|---|---|---|---|
| 保証非退行 | **強**。未証明なら停止 | **条件付き**。実行・製品受入を禁止する隔離スコープなら維持 | **条件付き**。新 host API で race 立証可能な場合に強化 |
| 証拠の強度 | 実 runtime が揃うまで受入不可 | source + runtime 実測 + MODEL + 実 compiled parity を**非同値**のまま並記 | 新 pin に対する source と実 runtime を再収集 |
| 循環依存 | 残る。完了不能の可能性 | **限定実装権限のエッジを別 Gate に移すことで解消** | upstream 変更・pin 移行により race 証拠を先に作れれば解消 |
| 開発継続性 | 低〜中（fixture/観測可能性に依存） | guard 部分だけ中。その他 Task は停止 | 上流 API 完成後に中〜高、着手は外部依存 |
| 上流依存 | 固定版維持 | 固定版維持（最終 runtime proof に依存） | **高**。fork/PR/リリース・新 pin 再承認が必要 |
| 運用・安全性残留リスク | 開発停止長期化 | 未実測 race、誤統合、parity drift、限定認可の逸脱 | 新 API の意味変更、observe/control TOCTOU、再検証漏れ |
| 承認コスト | 最小（既存 Gate） | **高**。Requirements→Design→Plan→独立レビュー→人間署名 | 高。上流受入と全証拠再生成＋承認 |
| 現時点の成立判定 | 既存ルールとして成立。ただし課題未解決 | **提案構造として成立、未承認・実証なし** | 技術的候補。最小 API の実装・提供は未確認 |

### C.1 Option A の継続条件

固定 Senpi は、error turn で未実行 local calls を dispatch しないが、`providerToolResults` と `finishTurn` は terminal より前後の独立境界を含むため、**stale async completion が存在しない**との結論は導けない。追加観測として session 生成／close／continue、real read `tool_call` identity、provider/error event order、既開始 result の配送可否、late assistant/toolResult callback と実 append を要する。mock の parent/child 判定や process-global step cursor を直すことで continuation が観測できる可能性はあるが**未確認**。A の STOP は当然であり、「時間がかかる」ことは安全性を緩める理由にならない。

### C.2 Option C の最小 host 公開 API の候補（未提供・未実証）

公開イベントとして `(durableSessionId, processGeneration, agentTurnId, toolCallId, dispatchOrder, selectedMethod, readStart, readCompletion)` が read 呼出しに対して正確に結合され、invalidation との観測順序（単調 seq/commit point）を確定できること。支持できる設計候補は、(i) `read_started` を実 dispatch 前に送る、(ii) pending read の completion を error 後も同一 durable session に配送・購読できる、(iii) `read_succeeded|failed` は同じ attempt key と host-issued terminal order を保つ、(iv) host の停止／取消／session close で配送保証がない場合は未着を success 扱いせず `NOT_PROVEN` にする、(v) pre-persistence sanitation と append identity を露出する、というもの。

**必要な観測用 API と Justice の保証は異なる。** Host が late delivery を保証しても、Justice は epoch を自身で同期 invalidation／判定しなければならない。上流が変更された場合、固定 Senpi `d56e…` の証拠を新 pin に流用できない。互換性、A–K、RG-005、Case A/B、storage、32契約を新しい pinned chain で fresh 再評価し、Requirements owner と人間の新承認を得る。

### C.3 R2 での Option B と Option C の境界

B は B0/B1 の **限定的コンパイル証拠**を非循環に取得する方法であり、B2 actual runtime origin-binding を自動的に提供する方法ではない。G1 result が G2 context を誤参照する反例について host-issued immutable attempt identity または audited runner non-crossing ordering が得られないなら B2 は `BLOCKED`、C へエスカレートする。C は最低限 immutable `(instanceGeneration, sessionIncarnation, readAttemptId)` が read-start/result 双方に host 自身から渡り、invalidation/read-result ordering が観測可能になる公開 API を求める。C の変更が新 pin を要求すれば固定 Senpi `d56e6a26…` に対する旧 evidence は新 pin の証明ではない。

## D. Non-circular Gate Architecture — Option B Revision 11 (R11 proposal document revision only; UNAPPROVED)

### D.1 Gate の権限と証拠の区別

| 段階 | 状態／発行主体 | その段階でのみ可能なこと | 決して意味しないこと |
|---|---|---|---|
| `RG310-B0` | `NOT_AUTHORIZED → HUMAN_SCOPED_AUTHORIZED → EXPIRED/REVOKED/CLOSED`; 新 R'/D'/P' を署名する人間 | 隔離ブランチで Task 2 pure interface と Task 6 未配線 registry/store の限定実装、expected RED/GREEN | Task 1/Case A PROVEN、通常 Task 2/6 authorization、実 host integration、製品機能 |
| `RG310-B1` | `NOT_SUBMITTED → SUBMITTED → INDEPENDENT_VERIFIED` または `FAILED/BLOCKED`; 別の独立 reviewer | 特定 source revision から生成した **production compiled JavaScript** の明記した遷移部分集合について conformance 判定 | actual Senpi event origin、全 receipt/persistence/issuance 統合の実証、B2 の実行許可 |
| `RG310-B2-DEP` | B1 独立 PASS 後、別の明示的 human B2-DEP authorization に含めた sub-scope | 厳密に審査された Senpi exact devDependency の `package.json` / `bun.lock` 差分だけ | package `./senpi` export、新ランタイム起動、release |
| `RG310-B2-HOST-PREP` | B1 exact EAF0 PASS、B2-DEP type/lock verification、origin preflight、**別 human PREP grant** | scope 内 Case A 用の test-only source 配線のみ。compile output は隔離 temp だけ。実 host callは禁止 | B2-HOST-RUN、通常 production Task6、grant scope 増加 |
| `RG310-B1-REATTEST-FINAL` | PREP output を freeze、実装者等と別 independent reviewer の READ_ONLY_VERIFY | exact final artifactId に対して compiled `.js` N/P mutation/lock/type/import graph の再検証、signed report のみ | runtime R/I、実装 source 修正、人間 phase 授権 |
| `RG310-B2-HOST-ACTIVATE/RUN` | **RA_PASS(EAF_final)**＋**別 human exact-artifact ACTIVATE**＋独立 pre-run `INDEPENDENT_HOST_SOURCE_CAPABILITY_PROVEN` / 完全 ingress monitor／隔離を事前立証した場合のみ | `HOST_RUN_START_ADMISSIBLE` の test-only 実行開始、実 ingress 後の `HOST_RESULT_ORIGIN_VERIFIED` に限る actual read/error/late append の後向き観測 | 未観測 origin を run 前の前提事実とすること、read-origin 不明の PASS、一般 task/child dispatch/export/配布 |
| `RG310-B3` | B2 evidence の後に通常 Gate へ提出する **審査 handoff**。Task1 の既存判定を先に審査できる。製品側の Gate は full Task6 後に別審査 | `B3-T1` = Task1 既存 Gate の再評価申請。後続 `B3-PRODUCT` は通常の製品側審査申請であり別権限 | full Task6、B-001/002 closure または製品完成を Task1 再審査の前提とすること。B3 自体で TaskAccepted/PlanComplete を発行すること |

`B0` は **implementation scope authorization**、`B1` は **compiled transition evidence verdict**、`B2` は **separately authorized integration evidence collection**。別物であり同一「PROVEN」ラベルへ昇格できない。

### D.2 非循環グラフ、B2 不成立時の分岐

```text
Evidence HEAD c428041d / Task1 existing Gate = BLOCKED
   |
Requirements R' → Design D' → Plan P' → fresh independent normative review
   |
Human Architecture Decision (NOT phase authorization)
   |
Human B0 exact-chain scoped grant → isolated Task2 types + unconnected Task6 store
   |
B1 compiler-emitted production .js subset → fresh independent B1 verdict
   | FAIL/drift/unsafe → REVOKE B0 / STOP
   | PASS (NOT Task1 proof)
B2 host/dependency/origin read-only preflight
   | no credible origin → STOP B2 / Option C new-human-decision
   | feasible
Fresh scoped Design/Plan review → separate human B2-DEP grant
   |
Exact dependency/lock/type review → separate human B2-HOST-PREP grant
   |
Allowed test-only source wiring, NO runtime/host execution
   |
Freeze exact final source/lock/compiled artifact EAF_final
   |
B1-REATTEST-FINAL: independent static/compiled JS reattestation
   | FAIL/UNVERIFIED/EAF changed → B2-HOST-RUN BLOCKED; unsafe → REVOKED/STOP
   | RA PASS bound only to EAF_final
Separate human B2-HOST-ACTIVATE confirmation for exact EAF_final
   |
Independent H0 capability/complete-ingress/no-effects/isolation proof
   | UNKNOWN/FAIL → NO HOST RUN / STOP / independently approved no-effect inquiry or Option C
   | PASS (does NOT claim any actual result origin / R / I)
HOST_RUN_START_ADMISSIBLE → bounded test-only actual pinned host callbacks
   | H1: each result captured/bound by trusted ingress before authority/effect
   | H1 origin ambiguous → reject event / NO_ISSUANCE / NO_EVIDENCE / STOP
   | H2: actual per-result HOST_RESULT_ORIGIN_VERIFIED (G1/G2 counterexample)
   | H2 not observed/proven → R remains BLOCKED / NO_EVIDENCE
   | H3: independent sealed HOST_RUN_EVIDENCE_ACCEPTED if positive R controls truly observed
   | actual evidence obtained (NOT full Task6 completion)
   v
B3-T1: submit admissible evidence to **existing Task1 Evidence Gate**
   |
   +-- evaluator predicates incomplete → Task1 BLOCKED; no usual Tasks2–14
   |
   +-- existing canonical32 + CaseA + CaseB + required runtime/safety PASS
   |        → Task1 PROVEN **only by existing authorized Gate**
   v
Ordinary exact-chain human Tasks2–6 authorization, including Task5 dependencies
   |
Full Task6 production integration and separate ordinary independent acceptance
   |
B3-PRODUCT: ordinary final Gate review request; not a Gate verdict itself
   |
Later product/PlanComplete Gate (subject to all existing requirements)
   + if separately adopted, PRODUCT_READINESS_REVIEW for B-001/B-002
```

**R11 非循環性の検証用順序（HOST-RUN 内 H0→H3 を明示）:** `B0 → B1(EAF_0) → B2-DEP → B2-HOST-PREP（source preparation, no host run） → B1-REATTEST-FINAL(EAF_final) → human B2-HOST-ACTIVATE → B2-HOST-RUN → B3-T1/Task1 existing Gate → usual Tasks2–6 authorization → full Task6 acceptance → product/PlanComplete gate`。従来の主系列 `B0→B1→B2-DEP→B2-HOST` の B2-HOST 内に **準備→証拠再検証→人間実行確認**を追加する。`B2-HOST-PREP` は別の scoped human source-edit grant によって準備 source にのみ触れる。 **FI-004:** `HOST_RUN_START_ADMISSIBLE` は開始前の固定公開 API source/host-lifecycle capability・actor外 ingress monitor・無作用隔離の立証と human ACTIVATE を要求し、per-result `HOST_RESULT_ORIGIN_VERIFIED` は実験後の観測でしか得ない。H2/H3 を H0 に AND しない。H0 不成立なら RUN 不可、別ルートの独立・事前承認された no-effect 証拠調査か Option C。RA は独立 reviewer の一時ビルド・照合だけで tracked file や lock の mutation を許さない。RA `PASS_FOR(EAF_final)` と該当 artifactId に対する人間 ACTIVATE confirmation がない限り実 host callback/tool は実行禁止。Graph rank と attempt cycle の形式的証明は `04` §6（R'=0、D'=1、P'=2、後続は厳密に増加）。同 attempt の B2-DEP 開始 predicate は初回のみに適用し、合法 lock 差分後に旧 B1 current-applicability を再要求しない。Task1 は full Task6 integrated production acceptance を prerequisite にしない。B2 は限定 host runtime 証拠を提供し得るだけで、製品 Task6 全体の完了や Task1 自動 PASS は発行しない。`B3-T1` の審査で実証不足なら Task1 BLOCKED が続き、先行 B0/B2 の許可は通常開発許可へ変化しない。正規 Task1 evaluator の証拠 predicate 充足後だけ、Task1 owner が独立判定する。

`RG-310-B-001/002` は canonical32 **外**の別トラックであり、`B3-T1` の新しい acceptance input ではない。これらを製品安全性 Gate の必須条件にするなら新 `PRODUCT_READINESS_REVIEW` を Requirements owner と Plan/Gate owner が別の正式な R'→D'→P' review/human approval を経て採択し、その Gate の独立判定器と owner を設けなければならない。提案段階で既存 Task1 evaluator、JUS5-ACC-02/COMPLETE-01 の意味を黙示改訂しない。

B2 の開始前に fixed Senpi の全 ingress 非偽造 source binding capability と actor外 monitor/無作用隔離が立証できなければ `HOST_RUN_START_ADMISSIBLE=UNKNOWN/BLOCKED`、**NO HOST RUN / STOP**。別の安全な証拠取得経路も事前の独立技術審査・別人間許可・無作用隔離の証明が必要であり、存在しなければ Option C に移行する。実 callback 後に限る `HOST_RESULT_ORIGIN_VERIFIED` がなければ `R/I/receipt/evidence` は採用しない。actual stale success arrival+rejection と late positive sanitation を無観測のまま Task1/製品 acceptance に進めないことと、full Task6 完成を Task1 の前提にすることは全く別である。

### D.3 Scoped authorization／ファイル・操作・期間（将来の決裁候補）

**B0 の必要入力:** human decision、Requirements owner の承認を反映した新 R'/D'/P'、各 raw-source fingerprint + Git revision + schema + canonical Plan snapshot、independent review PASS、actor、base commit/tree、隔離 branch、期限（最大14暦日）、allowlist、禁止操作、許可コマンド、evidence source SHA と token-free logging profile。1項目でも欠損なら `NOT_AUTHORIZED`。過去の `8a2e4f…` chain を新認可と扱わない。

| B0 所有 | 許可候補の exact path | 限定 change class |
|---|---|---|
| Task 2 | `src/core/native-task-capability.ts`, `src/core/workflow-activation.ts` | pure codec/型、共有 reason、activation interface。runtime/API import や起動は禁止 |
| Task 2 tests | `tests/core/native-task-capability.test.ts`, `tests/core/workflow-activation-v5.test.ts` | pure negative/positive RED→GREEN。production 判定 PASS と表現しない |
| Task 6 | `src/runtime/native-task-capability-registry.ts`, `src/runtime/workflow-activation-state.ts` | detached live epoch/attempt registry、fail-closed activation/receipt invalidation、narrow injectable host boundary。実 host callback には配線しない |
| Task 6 tests | `tests/runtime/senpi-adapter-activation-capability.test.ts`, **new** `tests/runtime/native-read-epoch-parity.test.ts` | source＋compiled module を識別した synthetic transition tests、host metadata spoof negative controls。各段階の test classification を出す |

B0で **禁止**: `src/senpi-extension.ts`, `src/runtime/senpi-adapter.ts`, `src/runtime/native-capability-transcript.ts`, `src/runtime/native-capability-secret-guard.ts`, `src/core/justice-plugin.ts`, `src/core/types.ts`, `src/core/task-packager.ts`, `package.json`, `bun.lock`, `tsconfig.json`, build config、CI、manifest、通常 Task3–5/7–14、live Senpi hook 登録、production `./senpi` export、通常 tool/child execution、deploy/release、外部 provider/network、Case A/B/unknown-tool evaluator/fixture、canonical 32分母。`src/**` の他パスも禁止。成果物として隔離された temp compile output を生成できることを human 承認書へ明記し、その生成先だけ例外とする。既存 `dist/**` の上書きは禁止。

**B2 の事前審査（R11）:** B1 の exact `EAF_0` 独立 PASS 後、書換え前の manifest と `bun.lock`、固定 Senpi の公開 type/import specifier、host origin binding に必要な source/lifecycle、entrypoint discovery/registration を **read-only static preflight** する。ここでは TypeScript の実依存解決が成功したとは主張しない。依存差分の正確な lock hunk が未生成の場合、まず `B2-DEP` だけを独立の human scope grant で許し、最小変更後の lockfile diff、正規 SDK import/TypeScript compile を検証・独立 review する。次に **別 human B2-HOST-PREP** を source hunks 準備限定で許すが **実 host 実行は禁止**。final EAF を freeze して **独立 RA の PASS** と **さらに別 human B2-HOST-ACTIVATE exact EAF confirmation** を得た後でだけ B2-HOST-RUN が有効になる。起動や書換えを伴う確認は該当 phase grant 後のみ。既存 `node_modules` の偶然の解決は直接 devDependency 宣言の代用にならない。host origin/source feasibility が不明なら PREP/RUN を発行しない。さらに実 host RUN 前に `HOST_RUN_START_ADMISSIBLE` の独立 structural capability を証明できなければ STOP。結果の origin positive proof は host 結果観測後の `HOST_RESULT_ORIGIN_VERIFIED` としてのみ扱い、開始条件にはしない。

**B2-DEP 専用 scope:** B1 独立 PASS 後、B0 とは独立した人間がこの依存変更 phase を正式に承認した場合だけ `package.json` の **`devDependencies["@code-yeongyu/senpi"]="2026.10.8"`** とそれに機械的に必要な `bun.lock` の最小差分を候補とする。`dependencies`, `peerDependencies`, `exports`, `scripts`, `main`, `module`, `types`, `files`, version、他依存値の変更は禁止。lock 解決に予期しない広範囲な変更／pin 逸脱が発生したら差分を隔離し B2-DEP を STOP、fresh Design/Plan review と再 human authorization が要る。`bun add` のような便利コマンドが別フィールドを書き換えても許可とはならない。approved patch hash／dependency graph hash／package integrity を新たな chain に添付する。別の新規 upstream pin の黙示採用は禁止。

**B2-HOST-PREP source preparation と B2-HOST-RUN の候補 whitelist（B0/B2-DEP から継承されない。B2-DEP の exact lock/type resolution の独立確認と追加 human PREP grant、final RA＋human ACTIVATE 署名が必要）:** `src/senpi-extension.ts`, `src/runtime/senpi-adapter.ts`, `src/runtime/native-capability-transcript.ts`, `src/runtime/native-capability-secret-guard.ts`, `tests/integration/omo-native-senpi-contract-spike.test.ts` の *Case A への test-only wiring に必要な特定 hunk*、B0 の実 registry/store と focus tests、承認を受けた `package.json`/`bun.lock` の依存 hunk のみ。新たな `tests/runtime/*` が必要なら exact filename を別 review/human 署名へ追加する。通常 Task 5 の durable correlation、Task 7/10 routing、全 Task 6 GREEN、Case B/evaluator の修正を便乗させない。

PREP段階の各 path/hunk edit は allowed mutable output だが、PREP 中の actual callback、mock session execution、test-only live runtime は明示的に禁止する。それらは final RA PASS + human exact EAF ACTIVATE 後の RUN だけで認可候補となる。

Test-only の意味を build evidence で実証すること: (i) root `exports` に `./senpi` を追加しない、(ii) 既存 OpenCode entrypoint/export と package scripts は immutable、(iii) 既存 production roots が new Senpi extension を import しない dependency graph を採取、(iv) native extension を installed active extension discovery path に配備しない、(v) emitted `dist/senpi-extension.js` は隔離 temp tree にのみ存在し release/publish の入力に入れない、(vi) mock-only isolated agent/session と exact whitelisted invocation だけを実行。`tsc` が追加 JS を作ることと、product export を有効にすることは異なる。**Task 6 の Approved Plan にある `./senpi` export は、後の通常 Task6 human authorization でのみ実装する**。B2 がそれを必要とするなら B2 STOP・scope 再設計。

**有効期間と二重失効（R11 が継承する R8 改訂）:** B0/B2-DEP/B2-HOST-PREP/B2-HOST-ACTIVATE は別 authorization ID、signed Immutable Authorization Baseline（正規 R'/D'/P'・pin/actor/branch/base tree・scope・期限<=14暦日）、正確な phase と許可 operation に拘束する。**B0 allowlist 内の source/test/temp output の変更は、回数を問わず grant の自己失効ではなく `Authorized Mutable Implementation Output` として mutation ledger に連続記録する。**許可外差分、baseline/actor/branch/署名/pin/期限逸脱、実 safety 不正は `REVOKED/EXPIRED` と STOP。B1 署名が束縛された `Evidence Artifact Fingerprint` の変更は、新 artifact に対して旧 evidence を `SUPERSEDED_FOR_CURRENT` とする**証拠失効**であり、正規 B2-DEP 更新を自動 `REVOKED` としてはならない。B1 formal FAIL は R5 の例外的 B0 revoke 規則を維持する。検証不能な scope は fail-closed STOP/BLOCKED、権限を自動拡張しない。branch を switch しても権限が carry over しない。証拠 repo の固定 commit は変更しない。詳細な型・各操作の**事前 admission と事後 accepted delta を非同値**として、隔離 staging と原子的 commit+公開/独立 proof を要求する。詳細は `04-authorization-fingerprint-transition-matrix-R11.md` §§1–5。actor の自己記録だけでは grant 有効時間内の編集であったと立証できない。trusted recorder・全 mutation 経路の強制仲介が未証明なら `UNKNOWN/BLOCKED + STOP`（違反立証時のみ `REVOKED/STOP`）、過去の正当な phase completion は期限切れによって消さない。

#### D.3.1 R11: Immutable baseline、mutable output、evidence-identity と freeze の規範候補

`Immutable Authorization Baseline` は決裁済 R'/D'/P' chain/source schema/pins/phase/person/branch/commands/expiry/allowed delta の署名対象であり、実装ファイルを一度編集する度に再算出する「現在の source tree hash」ではない。B0 では合法的 source mutation を `Authorized Mutable Implementation Output` として append-only differential ledger に記録し、human `IAB` は不変とする。**ただし actor-local ledger と hash chain は監査/時刻認証ではない**。実変更を確実に仲介した独立 monitor が操作前・commit 時の human grant/actor/phase/branch/command/scope/expiry/revocation を確認し、before/after full roots と単調 sequence を独立署名・外部 seal により確定した `OP_PREPARE_ALLOWED` で隔離 staging を認め、後に原子的に `OP_COMMIT_ACCEPTED`／`ACCEPTED_DELTA` を確認できた場合に限り、B0 grant はそのまま有効（最大14暦日）。許可外 edits や隠れた drift は scope/safety violation として STOP/REVOKED。`R6` は正規 approvals、pin、allowlist を source fingerprint 変化を口実に拡張しない。

`B1` は独立 reviewer が `EAF_0=SHA256(canonical full material source+generated JS+lock+config+test/mutant profile)` に対してのみ署名する。B2-DEP で `package.json/bun.lock` が正規更新されれば **old B1 signed PASS は historical のまま current artifact への証拠適用を失う**。B2-HOST test-only source を編集する場合は、別 human `B2-HOST-PREP` scope 内で配線 source を準備し、runtime 起動前に final tree/import JS/dependency/lock を完全 freeze。異なる独立 reviewer の `B1-REATTEST-FINAL` が actual JS build/mandatory subset N1–N4/P1–P2 / mutation / type/lock / graph identity を最終 artifactId に対して再検証し、人間が正確な final artifactId を再確認して `B2-HOST-ACTIVATE` を発行した場合のみ test-only host execution が可能。追加合法 edits は grant を必ずしも REVOKED にしないが old reattestation の current 適用を INVALIDATED として host run を STOP。RA 自体は read-only source、isolated ephemeral emission のみ許可し、source/lock/node_modules/install mutation は禁止する。

**裁定モデルは `04-authorization-fingerprint-transition-matrix-R11.md` を normative cross-reference とする。** 特に §§1–2 の前向き `START_ADMISSIBLE` と後ろ向き `ACCEPTED_DELTA`、§3 の `DEP_STARTED` と `DEP_PREPARE_ALLOWED`/`DEP_EDIT_ACCEPTED`、§4 の grant×evidence×attempt×operation 状態、§5 の全38行7検証観点表、§6 の全辺 strict rank と辞書式 attempt 証明 を将来の R'/D'/P' 採択候補へ同一内容で反映する。既存 R5 D.3 の `source fingerprint` は署名 baseline と currently tested artifact に意味分離した。本節に実 human authorization の発行力はない。

#### D.3.2 R11: reference-monitor / B2-DEP start-continuation 運用前証明（未採択）

**許可の発行と許可の強制を別にする。** 将来人間が署名する `IAB` は本当に信頼できる execution reference monitor の証明の代用ではない。全 tracked path、temp、package/lock、コマンド、child process、symlink、背景 writer の仲介が漏れる／monitor 自体を actor が変更できる／timestamp と mutation history を actor が差し替えられるなら、scope と期限内に全変更が行われたという operational proof は `UNKNOWN/BLOCKED`。独立 signer/recorder/monotonic clock/sequence/revocation-source と preflight+commit trusted snapshot の記録を要する。検証不可能な場合は **実編集は禁止（STOP）**、誰もこの仕様だけで monitoring capability が存在すると宣言しない。故意または実際の許可外変更が**証明された**場合は即 `REVOKED + STOP` とし、未証明と混同しない。

**`DEP_START` は B2-DEP 初回操作前の一回限り条件。** 旧 B1 `PASS_FOR(EAF_0)` の完全な正確性を read-only preflight 時点で確認し、独立 monitor が `authorizationId/EAF_0/B1_attestationId/preflight/root/trustedTime/sequence` を署名・外部封印した `DEP_STARTED` を先に固定する。その後の正規 `package.json/bun.lock` 編集では `EAF_0→EAF_1` により旧 B1 の current applicability が失効しても、DEP grant を自己失効させず、継続は **毎回** `DEP_PREPARE_ALLOWED`（前向き、live grant/正確な preRoot/scope/隔離）で staged operation 開始を判断し、独立 `OP_COMMIT_ACCEPTED`/`DEP_EDIT_ACCEPTED`（事後 seal+原子的公開）で確定/拒否する。旧 B1 を新 artifact の PASS や HOST 許可として再利用することは厳禁。正規 DEP phase completion と PREP completion/freeze、独立 final RA、別人間 exact-artifact ACTIVATE の順序は変更しない。`04` §§1–6 が完全規範。

#### D.3.3 R11: START_ADMISSIBLE / ACCEPTED_DELTA の厳密な非代替性（FI-001・未採択）

1. `OP_PREPARE_ALLOWED(g,opIntent,beforeState): START_ADMISSIBLE` は**未来 after-state、commit 時刻、事後 receipt を参照しない**。人間署名済 IAB/HSA、actor/phase/branch/command/negative scope、真正 trust roots、独立時計・fresh revocation、現行 exact trusted preRoot、競合 writer 排除、private stage、monotonic unique operation+sequence 予約を *書込み前に* 独立検証し、`OP_PREPARED` を独立永続化してから隔離 stage を開く。準備は共有 source/effect の公開認可ではない。
2. private stage 内の実差分を独立再測定し、commit 時に HSA が未失効・未取消、preRoot 連続、actual hunks/path/mode/symlinks/dependency pins、禁止 host/network effect なし、afterRoot が正しいと再検証する。**証拠受理と authoritative bytes 公開の不可分 atomic transaction** が将来独立に証明できる場合に限り `OP_COMMIT_ACCEPTED`; 完了済み差分だけを `ACCEPTED_DELTA` と呼ぶ。事前 seal だけを受理済みとみなす、事後 async receipt を待つ間に public bytes を出す、rollback による事後修復を正常 PASS とする、の各解釈は禁止。
3. `OP_ABORTED` は外部無影響の独立立証と予約 seq の durable tombstone を要する。partial/crash/recorder gap/公開結果不明は `IN_DOUBT` で隔離/独立 forensic/STOP。原子的な actual-bytes-plus-accepted-record の実装、全 direct/child/background/symlink/mount/worktree/install/network/host 経路の complete mediation が未実証なら **PREPARE の前に `UNKNOWN/BLOCKED+STOP`**。現に公開された無許可変更が独立証明されたときのみ `REVOKED+STOP`（特則 B1 formal FAIL 除く）。
4. phase `PHASE_COMPLETE` は reservation 全件が gap-free `ACCEPTED` 又は実際無影響の `ABORTED` で解決し exact current authoritative root と independent PhaseSeal が一致したときに限る。freeze 後の正規再編集も旧 frozen attempt では不可。旧 RA/ACTIVATE の現行適用を先に失効させ、**new attemptIndex と必要な新 human HSA** で再始動する（R8 §04 row 15/30）。Grant expiry 後の歴史的 closed proof と新規操作権限は分離する。

**時系列:** `SIGNED_SCOPE → PREPARE_CHECK → durable OP_PREPARED → ISOLATED_STAGE → COMMIT_CHECK → ATOMIC ACCEPT+PUBLISH`、または `ABORT/IN_DOUBT→STOP`。この仕様上の先行関係は依存 DAG の閉路なしを意味しても、固定 Senpi または現在の環境に reference monitor、transaction coordinator、独立 recorder が実装可能だという保証ではない。具体的な型、クラッシュ反例、38行および実現性 STOP は唯一の正規候補 `04-authorization-fingerprint-transition-matrix-R11.md` §§1–6 に従う。

### D.4 B1: 実 compiled artifact を検査する、機械判定可能な実行仕様

**Source／build constraints（提案。未実行）:** 固定 repo は `tsconfig.json` (`target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `rootDir: ./src`, `outDir: ./dist`, include `src/**/*`) と `package.json` (`build = tsc && bun build ...`) を使用する。B1 は通常 `bun run build` を用いず、承認された **既存 tsc を同一 tsconfig/installed lock graph** で呼び、**独立 temp path** `$STAGE/dist` にのみ出力する。提案コマンドの `STAGE` は隔離作業ディレクトリの絶対パス、実行前に空であることをチェックする。既存 `dist/**`、git tracked file、lockfile に変更が生じれば STOP。

```bash
# 参考となる *将来承認後* の build specification。ここでは実行しない。
export STAGE="$(mktemp -d)"
./node_modules/.bin/tsc --project tsconfig.json \
  --outDir "$STAGE/dist" --incremental false
# ステージの正規パス、実行ツールのバージョン・バイナリ hash、
# tsconfig.json／bun.lock／package.json／全 resolved source/import hash を記録する。
# compiled import target:
# "$STAGE/dist/runtime/native-task-capability-registry.js"
# "$STAGE/dist/runtime/workflow-activation-state.js"
# 出力を作った後の source tree/hash 変化は即 STOP。
```

`tsc` の解決元と compiler flags を記録し、`bun.lock`/`package.json` は固定 evidence HEAD と許可済み B0 source revision を照合する。必要な `node_modules` がないなど、許可範囲内で固定依存が利用できなければ **`B1=BLOCKED`**、許可外 install や宣言変更は不可。`B1` では **source-only import の Vitest PASS は判定根拠にできない**。実 JS import の実装例は次の契約に従う。

```text
B1 test runner (not fixture copy):
  1. independently spawn Bun as a fresh child process,
     using an absolute file:// import of $STAGE/dist/runtime/native-task-capability-registry.js
     and $STAGE/dist/runtime/workflow-activation-state.js;
  2. require actual module paths to be within the stage realpath and have .js extension;
  3. inspect imported exports and resolution/import graph; exclude /src and .ts
     from evaluated code paths (test harness itself may be .ts);
  4. supply adapter-realistic tool_call/tool_result *public fields only*;
     separate trusted context binding from host event fields;
  5. exercise adversarial transitions against these imported module instances;
  6. require independently recomputed emitted-js SHA-256 and
     exact source/tree/compiler/config/dependency/test-vector SHA-256 to match ledger;
  7. fail on unresolved imports, transformation fallback, compiler warning/error,
     skipped test, wrong module, fixture-copied registry, source drift.
```

相対 import を Node が解決できない場合にソース TS へフォールバックしてはならない。Bun が emitted ESNext modules を解決できるかは事前に独立検査し、不可なら `B1 BLOCKED` として適合性を別のレビュー済み実行方式で再定義する。Test runner を編集して PASS に合わせる行為は新 review 対象。

**B1 が証明できる subset:** 信頼済みの synthetic ingress input があるという条件の下で、Task 6 compiled guard の `register→invalidate→reject/rearm` 状態遷移、receipt/current activation/issuance *registry methods* の拒否、選択保持、retired token の validity 非復活、duplicate/out-of-order/wrong-auth/wrong-method/wrong-path/session 等の分岐。B1 は Senpi の callback が正しい origin を持つこと、既存 Task6 transcript/secret guard との真の呼出順、実 tool execution、JSONL append、同一 session continuation、Case A/B 実 runtime、unknown-tool を証明 **しない**。receipt invalidation を mock receipt list だけで証明しても real Task 6 compiled integration とは区別する。

**Mutation negative control:** 修正のため production code を改変してはいけない。隔離 temp copy の *compile input* から、例えば `startedEpoch===currentEpoch` チェックを一箇所だけ削除した「意図的に欠陥のある artifact」を別 output tree に生成し、同じ harness が該当 test を FAIL と検出することを要件とする。正規 emitted artifact、tracked source、証拠は不変。mutation が検出されなかった場合 `B1=FAILED`。control が production source と同じ code-path に届いたと示す emitted diff / hash が必須。compiled JS import とその child import graph に一箇所でも未知の source TS fallback があれば FAIL。

**B1 証拠 ledger 必須項目:** `sourceCommit/tree`, tracked diff allowlist、R'/D'/P' exact hashes、pin、`package.json` Git blob `8e154e09…` と approved-source SHA、`bun.lock` Git blob `6a7f961d…` と approved-source SHA、`tsconfig.json` blob `c9894f49…`、`tsc binary/version/flags`, `bun binary/version`, stage realpath and output manifest SHA、production JS sha256、transitive imports sha256、test runner/vector/negative control sha256、PASS/FAIL per check、independent reviewer approval ref、time。テスト名だけ／ソース SHA だけ／直近 PASS だけでは B1 不成立。

**R3 mandatory B1 extension (RG-310-R2-001):** D.6.1 で定義する *同じ compiled production state-store + registry* の pending Promise / late-precommit / post-invalidation commit fencing を negative と positive の両系で実行する。test harness の fake store が PASS しても不可。非同期制御は `setActivation` の返した Promise の settlement を harness 側で遅延するか、`observeMethodReadResult` の *commit 前* に待機するテスト制御に限り、正規 production commit が await してよいという意味ではない。`setActivation` 内へ await を挿入した欠陥 mutation / epoch-check 欠落 mutation の両方を検出対象とする。B1 判定と外部 host integration を区別する。

### D.5 Expected RED、B1 FAIL、即時セキュリティ STOP の区分

| 種類 | 条件 | 監査 status と対処 |
|---|---|---|
| **Expected RED (B0 開発時のみ)** | 新しい pure/compiled focused test が未実装関数や欠落した拒否判定を検出、まだ B1 に提出しておらず、実 host/tool/capability/token persistence の危険経路なし | `B0_DEV_RED`。限定実装内の GREEN 修正可。これは B1 判定に流用不可 |
| **B1 formal FAIL** | `B1 SUBMITTED` 後の必須 check fail、compiled-source mismatch、mutant PASS、negative control 未実施／欠落／skip | `B1_FAILED` と `B0_REVOKED`、即 STOP。再開には新レビューと必要な新 human authorization |
| **実際の safety/scope violation** | token leak/actual tool side effect、stale live authority/receipt が不正受理された実稼働境界、許可外ファイル/ネットワーク/パッケージ変更、raw log persistence、外部 provider 実行 | RED 中でも `REVOKED`・STOP。単なる expected unit assertion failure と混同しない |
| **実行環境／証拠未整備** | `tsc` 不可、hash 不明、host origin proof がない、観測欠落 | `BLOCKED`・STOP／必要なら再設計。PASS としてはならない |

`B1 INDEPENDENT_VERIFIED` の署名は exact tested `EAF_0` (source/tree/JS/config/compiler/lock/tests) にのみ適用。次 commit / allowed source or lock change によって旧 signed PASS 自体を消すのでなく **新 candidate への適用が失効** `SUPERSEDED_FOR_CURRENT` となる。許可済み変更が B0/B2-DEP human grant を自己失効させることはない。`B1 SUBMITTED` 後の formal FAIL は従来どおり `B1_FAILED + B0_REVOKED + STOP`、unsafe 実測は scope 中も REVOKED。B1 修復に B0 を黙示復権させない。**唯一の現行規範候補** `04-authorization-fingerprint-transition-matrix-R11.md` §§2–5 の直積状態と2相イベントに従う。旧 R6/R7 matrix は履歴資料のみで規範的効力を持たない。

#### D.5.1 R11: trust failure と正規差分の二重 STOP 境界

人間 grant に署名があっても `TRUSTED_OP_BOUNDARY_PROVEN` が未立証なら `OP_PREPARE_ALLOWED=UNKNOWN/BLOCKED` として**書込み開始前**に STOP する。`OP_COMMIT_ACCEPTED` は actor 自己申告の時刻/ledger からは立証できず、隔離 stage/真の afterRoot/原子的受理公開を独立検証する。**実 breach 判明 → REVOKED+STOP**、**監査欠落/不確実 → UNKNOWN/BLOCKED+STOP**、**合法 EAF 変更 → grant 維持し current evidence のみ INVALIDATED**。期限切れ grant が新しい操作を許さないことと、既に封印済みの正規操作が歴史的に有効であり得ることを分離する。固定 B1 formal submitted FAIL→B0 revoke の既存特則は変更しない。

### D.6 ReadAttemptEpochGuard：正規ホスト入力と4状態契約（AR-001 / AR-003）

**Pinned Senpi で確認できたもの:** [ToolCallEventBase/ReadToolCallEvent L1711–1784](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/core/extensions/types.ts#L1711-L1784) は `toolCallId`, `toolName`, `input` など、[ToolResultEventBase L1786–1816](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/core/extensions/types.ts#L1786-L1816) は `toolCallId`, `parentToolCallId?`, `input`, `content`, `isError`, `toolName`, `details` 等である。**`processGeneration`, `attemptId`, `epoch`, `authorizationId`, `selectedMethod`, `durableSessionId` は result event 自身の証明済み field ではない**。他の session context から取得する属性は **観測時の現在値**であり、到着した result の発生元証明ではない。`ToolResultEvent` にモデルが生成した JSON や任意 metadata を混入して origin とみなすことを禁止。

**Trust tier / 2段階契約**:

```ts
// proposed adapter-normalized vocabulary, NOT a claimed Senpi exported type
interface ObservedReadToolCall {
  readonly toolCallId: string;            // PUBLIC_EVENT_EXACT
  readonly toolName: "read";              // PUBLIC_EVENT_EXACT
  readonly input: Readonly<Record<string, unknown>>; // PUBLIC_EVENT_EXACT
  readonly observerScope: LocalScopeSnapshot;        // CURRENT_CONTEXT_ONLY by default
}
interface ObservedReadToolResult {
  readonly toolCallId: string;            // PUBLIC_EVENT_EXACT
  readonly toolName: "read";              // PUBLIC_EVENT_EXACT
  readonly input: Readonly<Record<string, unknown>>; // PUBLIC_EVENT_EXACT
  readonly isError: boolean;              // PUBLIC_EVENT_EXACT
  readonly content: readonly unknown[];    // PUBLIC_EVENT_EXACT
  readonly observerScope: LocalScopeSnapshot;        // CURRENT_CONTEXT_ONLY by default
  readonly originProof:
    | {readonly kind:"HOST_ORIGIN_BOUND"; readonly verifiedBindingRef:string} // private registry lookup key, NOT proof itself
    | {readonly kind:"UNAVAILABLE"};
}
interface LocalScopeSnapshot {
  readonly processLocalGeneration: string; // self-generated nonce (LOCAL only)
  readonly sessionContextAtCallback: string | null; // CURRENT_CONTEXT_ONLY
  readonly authorizationIdAtCallback: string | null; // registry context
  readonly selectedMethodAtCallback: string | null; // registry context
  readonly epochAtCallback: number; // registry context
}
```

`HOST_ORIGIN_BOUND` は adapter の入力パラメータとして外部から受け取って信頼してはならない。発行可能なのは **固定 source の host lifecycle/runner ownership を独立レビューで証明し、public callback の実 ingress と発生元 runner／session incarnation の非混同を直接保証できる場合のみ**。検証者は `tool_call` ingress と `tool_result` ingress が同一の live host source instance に属し、旧 instance からの late event が新 instance に転送されないこと、または十分に強い公開 stable execution/attempt ID により区別されることを立証しなければならない。B0 compiled test が `originProof.kind="HOST_ORIGIN_BOUND"` と手渡した入力は **合成前提条件**でしかなく、B2 で発行できる証拠ではない。

**Witness の機械的 enforcement（B1 negative control 必須）:** `verifiedBindingRef` という文字列単体は証拠ではない。compiled production registry はその値を **Task6 内部に閉じた private origin-witness table** の参照子として照合し、対応する witness が trusted runtime ingress owner により当該 source incarnation/attempt に対し発行されたことを検証して初めて `HOST_ORIGIN_BOUND` を受理する。外部 API、モデル出力、host event の `input/content/metadata`、現在 context、test fixture が同じ string を渡しても witness は生成されない。private table に該当せず、session/generation/attempt 付き source binding が異なる場合は `UNAVAILABLE` 相当。B1 の positive test が制御された modeled witness を生成する場合は隔離テスト harness 固有の `MODEL_ASSUMPTION` と表示し、その生成機構を本番 export/adapter に残してはならない。B1 negative controls は arbitrary `HOST_ORIGIN_BOUND` object、guessable/replayed ref、wrong-generation ref を **compiled JS import の runtime decision** が拒否することを確認する。もし現 Senpi の実 ingress から private witness を正当に発行できないと判明したら **本番では常に deny**、B2 の成功扱い禁止・Option C へ。private table の存在は host-origin proof そのものではない。

**AR-001 の禁止反例:** G1 `read(X)` → restart → G2 `read(X)` 登録 → G1 `tool_result(X)` 遅着。G2 の現在 context と `X` が等しいだけでは **必ず reject/NO_ISSUANCE**。origin binding unavailable / uncertain のときは `originProof=UNAVAILABLE`、`NO_ACTIVATION`, `NO_ISSUANCE`, `NO_PROVENANCE`。`toolCallId`、canonical path、同内容、同 durable ID はこの欠落を補わない。`processLocalGeneration` をイベントに後付けしても trusted origin に昇格させない。Host origin proof を source/real observation で組めない場合 **B2 STOP → Option C**。旧と新で callId の一意性をホストが公開契約として保証できないなら reuse を許さない。単純な `seenCallId` in-memory set は process restart を跨げないため、cross-generation の証拠にならない。

**4状態・線形化:** per live source instance の単一 authority owner。`ACTIVE` は *現在の method-read と issuance 可否を別々に照合した後の状態*、startup は `AWAIT_FRESH_READ`。`INVALIDATING` と `FAILED_DISABLED` では登録・result・issue・resolve を全拒否、`AWAIT_FRESH_READ` では selected method の新しい正規 `tool_call` attempt のみ登録可能で issuance/resolve は拒否、matching trusted-origin success の一回消費でだけ `ACTIVE` にする。`ACTIVE` でも cached activation は current tuple 再検証を要し、有効性を自動維持しない。`FAILED_DISABLED` は当該 instance での自動復帰不可。復旧は別の安全に初期化された instance と新しい fresh selected-method read、必要な人間の運用承認を条件とし、旧 state を復元しない。

```text
Startup / accepted compaction / new incarnation → AWAIT_FRESH_READ
AWAIT_FRESH_READ -- registered current fresh method read + origin-bound success --> ACTIVE
ACTIVE -- provider_stream_error / justice_sanitizer_failure --> INVALIDATING
AWAIT_FRESH_READ -- error --> INVALIDATING
INVALIDATING -- synchronous epoch+1 / revoke all receipt,capability,activation,attempt --> AWAIT_FRESH_READ
INVALIDATING -- any inconsistent partial transition / reentrancy / overflow --> FAILED_DISABLED
ACTIVE -- new selected fresh method read --> ACTIVE only after old candidates superseded and new success is checked
ANY -- shutdown/restart/switch/authorization/method replacement --> old instance CLOSED, no old authority
```

**Registration:** actual pre-execution `read tool_call` callback の *同じ trusted runner ingress* で、selected installed SKILL.md の canonical path、trusted current authorization/session/method、noncompacting state を検査し、`{localGeneration, observerSession, authorizationId, method, canonicalPath, toolCallId, epoch, order, status:PENDING}` を同期追加。`read` が後続 hook で停止される場合 attempt が不成立のまま残るが、success がなければ activation しない。後続 hook が入力/path を変更したら結果の exact path/input digest が一致しない限り reject。同一 source instance の重複 `toolCallId` は既知分も含め永続期間中 *never reuse* として reject（同時重複登録で旧を上書きしない）。保守的 `latest-start-wins` により同一 authorization/session/method の前 attempt は superseded、out-of-order old success は拒否。history/result からの後付け attempt 登録は禁止。

**Invalidation transaction:** `ACTIVE` または `AWAIT_FRESH_READ` から同期で先に `INVALIDATING` にし、`epoch += 1`、all candidate captured/rejected receipts/capabilities と current WorkflowActivationEvidence 無効化、pending attempts invalid/consumed、failure-retired token sanitation inventory 維持、durable method selection 保持。**await、ログ、async callback、external action なし**で終了し、全 postconditions 再照合後のみ `AWAIT_FRESH_READ`。途中失敗・reentrancy・overflow は `FAILED_DISABLED` とし issue/resolve は必ず deny。失効関数の呼出し順序が部分失敗を起こしても authority state は transaction 前に fail-closed に落ちること。provider/host error と Justice sanitizer exception の相違は維持（前者 normal sanitation、後者 exact minimal same-role fallback）。read が失効処理中に戻っても登録/消費は reject。

**Result consume:** public fields の `toolCallId`, `toolName`, `isError`, `input`、pre-registered canonical path/digest、`originProof`、現在の live source incarnation、authorization、method、epoch、order、PENDING/unconsumed をすべて評価し、いずれか不明/不一致なら fail-closed。`originProof=HOST_ORIGIN_BOUND` が実ホストから証明できないとき `AWAIT_FRESH_READ` から `ACTIVE` に上げない。await や予約以後の非同期 work があるなら、*issuance/activation を行う同期最終 commit 内*で authorityState、epoch、attempt status、origin、session/authorization/method、guard readiness を **再照合**。result は一回しか消費できず、miss/duplicate/other session/wrong generation/wrong auth/wrong method/wrong path/stale/superseded/out-of-order/unknown は現行 authority を上書きできず、candidate を re-arm しない。別 callback でエラーが発生し同 epoch で await 中なら後段で reject。

**Shutdown/restart/session switch:** セッション switch 時に old source scope を閉じ outstanding callback を隔離するか、閉じたという trusted host proof がなければ当該新 scope の origin trust を `UNAVAILABLE` とする。restart は同一 durable ID でも新 local nonce にし、registry/capability/receipt/activation/token validity は復元不可。失効 token は shutdown/restart まで sanitation-only（漏洩防止を host lifecycle で引継げるか未証明なら新 authority を deny）。古い callback が新 context を観測しただけで authority を発生させない。生成元隔離と遅着の保証が host API では構築不能なら Option C の公開 origin/attempt ID が必要となる。

### D.6.1 RG-310-R2-001 — memory-only store の同期 commit fence と非同期 return の保証境界

**既存 API・問題点:** Approved Plan の `WorkflowActivationStateStore` は `setActivation(evidence): Promise<WorkflowActivationStateMutationResult>`、`getCurrentActivation(authorizationId, sessionId): WorkflowActivationEvidence | null`、`invalidateSession(sessionId, reason): void`。`setSelection` は durable/async だが activation は memory-only。既存署名を変えずに、**Task 6 内で作る唯一の store 実装**に次の規範候補を追加する。`Promise` という戻り型はコミットを非同期にしてよいという許可ではない。

**選択する具体方式:** `SYNC_VALIDATE_AND_COMMIT_BEFORE_PROMISE`。`setActivation` が呼び出されたとき、最初の await／then callback／timer／外部 I/O／reentrant user callback **より前**に、Task 6 の単一 live authority owner で検証と memory-only update を1つの同期・非再入 critical section として完結させる。これが唯一の authority linearization point (`L_ACT`)。`setActivation` 自身は `Promise.resolve({kind:"saved"})` / `Promise.resolve({kind:"idempotent"})` または `Promise.resolve({kind:"persistence_failed",reason:safeCode})` のように既存 result union を返せるが、Promise の fulfillment/rejection handler は **絶対に authority state を更新しない**。非同期 state write、stale retry/backfill、`findCurrentActivation` の遅延完了による state restore も禁止。`setSelection` の独立 durable I/O はこの active-session commit の代用ではない。既存 interface 内で成立させる提案であり**実装可能性は未検証**。memory-only でも await が不可避な store 実装しかない場合はこの方式に適合しないため B1 `BLOCKED`、再設計/Option C の判断を要する。versioned CAS の代替を無審査で選んではならない。

**Trust/input fencing:** Task 6 の private read-attempt ledger と store を同一 authority owner が所有する（別 owner/async proxy 経由の更新は禁止）。`WorkflowActivationEvidence` の **公開フィールドだけ**、toolCallId 文字列、任意の `epoch` を commit capability とみなさない。`L_ACT` では host-origin-bound private witness を照合した `PENDING/unconsumed` read attempt を同期選択し、immutable incarnation identity、trusted authorization/session、selected installed method と canonical path/input digest、read `toolCallId`、registration epoch、strict newest-start order、current epoch/state、success、未消費、current guard readiness、store live generation が全一致することを要求する。`setActivation(evidence)` に trusted internal attempt token を新たな public argument として追加するのでなく、Task 6 の scoped private ownership と事前登録・一意識別（cross-generation re-use 禁止）で検証する。照合不能/ambiguous origin/同一キー衝突は commit しない。`HOST_ORIGIN_BOUND` の実生成保証は D.6 の別未証明条件のまま。外部/モデルが作った evidence のみで `setActivation` を認めない。実装が private binding をこの interface と共存させられないなら `BLOCKED` として新たな R'/D'/P' 協議へ戻す。

**線形化・順序:** `invalidateSession` は同 owner で同期的に `L_INV` に入り、最初に admission latch を `INVALIDATING` に倒し epoch を単調に増加させ、activation/receipts/capabilities/pending attempt の有効性を失効させる。`L_INV` が戻った後は旧 epoch のどの pending task、Promise completion、`find*` result、reentrant callback、旧 current activation snapshot も authority commit できない。`L_ACT < L_INV` の成功 commit は `L_INV` が消す。`L_INV < L_ACT` の旧 work は private epoch fence で拒否する。`L_ACT` と `L_INV` をまたぐ await はない。新旧 generation や session incarnation をまたぐ古い work を新 epoch に rebinding しない。`FAILED_DISABLED`、shutdown、method/authorization replacement、newest-start supersession を古い fulfilled Promise が巻き戻すことを禁止。同期 `invalidateSession()` が内部例外/部分失敗となる場合も、*例外発生前に* fail-closed latch が成立し続けることを証明できなければその runtime profile を unsupported とする。

**Caller completion:** `observeMethodReadResult()` が awaited `setActivation` から `{kind:"saved"|"idempotent"}` を受け取っても、発行直前に *current epoch/incarnation/attempt/activation/guard readiness* と positive return の時点にまだ authority が存在することを同期再検証しなければならない。`saved` は durable evidence でも token issuance でもない。commit 前の非同期 pending read は `L_INV` 後に commit 拒否。`persistence_failed`、Promise reject、missing/contradictory result、partial mutation は fail-closed `FAILED_DISABLED`（又は現 epoch を invalidated とし全 issue/resolve DENY が独立証明されるまで BLOCKED）とし、**`getCurrentActivation()==null`、`issue()==null/DENY`、`resolve()==DENY/NOT_PROVEN`、private receipt unusable の四重 postcondition** を要求する。`idempotent` は同じ current epoch・attempt・live value でだけ可。古い evidence と同型の再利用で `idempotent` を返さない。

**B1 compiled negative/positive controls — 同一実コード経路**（将来実行仕様、現時点未実行）:

```text
N1: register exact origin-bound selected read N (epoch e)
    → call production setActivation(N); hold its returned Promise continuation
    → synchronous invalidateSession() => e+1 / activation=null
    → settle old N Promise and invoke old caller continuation
    → assert store.current==null AND issue==DENY AND resolve==DENY
    → assert old receipt/attempt unusable; no implicit ACTIVE
N2: register N (e); defer real observeMethodReadResult pre-commit work
    → invalidateSession() => e+1
    → resume actual N caller so setActivation may be attempted
    → assert no stale authority commit, including idempotent path
N3: under e+1 inject another read result with reused toolCallId/current G2
    context or forged binding; assert UNAVAILABLE/DENY (no false host origin)
N4: mutate isolated compiled source to move activation write after await,
    or delete epoch/state check; both defects MUST fail test against emitted JS
P1: at e+1 register a new, distinct MODELED origin-bound selected read N+1
    → successful compiled-production result consume and setActivation commit
    → current==N+1; issue permitted when readiness true and receipt/call exact
P2: same fresh event with guard readiness=false / wrong authorization denies;
    restore readiness only via allowed state, P1 verifies not deny-forever
```

Test executor は N1 で `setActivation` Promise が未 settle でも権限状態コミット済みなら成立することを明記し、N2 で **commit 未実施の古い work** を独立に検査する。mutation が既存 JS code-path に到達したことを diff/hashes で検証。N/P の ledger は `COMPILED` のみであり Senpi 発生元・遅着 runtime delivery、JSONL、Case A `RUNTIME_PROVEN` に転用不可。

### D.6.2 RG-310-R2-002 — authority denial と canonical persistence sanitation の非同値性

**二つの独立した安全性述語:** `AUTHORITY_FAIL_CLOSED := no live activation/capability/candidate receipt issue, resolve, trusted provenance, unsafe tool_call execution`。`PERSISTENCE_SAFE := every authoritative actual assistant/toolResult message_end path, including late/synthetic/error paths, is replaced/sanitized in place *before* every canonical `SessionManager.appendMessage` and matching JSONL write, with no live/retired token in actual persisted bytes`。前者のみ成立し後者未検証なら製品は **UNSUPPORTED/BLOCKED**。`FAILED_DISABLED` は *authority-state* であり sanitation readiness の PASS を示す名前ではない。必要なら内部で `SANITATION_READY | SANITATION_DEGRADED | SANITATION_UNAVAILABLE` を独立管理し、権限 denial を保ったまま安全な redaction/fallback が動けることを要求する。

**在庫の保護:** live/ordinary-retired/failure-retired/leak-veto token、rejected candidate/unknown-result backstop の private inventory は権限側の epoch/receipts とは別の memory-only sanitation owner が保護する。失効直前に live token の保護用 snapshot / union を保全してから authority state を破棄し、fail-retired token を shutdown/restart まで保持（settlement 後も）。`FAILED_DISABLED` でも inventory は失わず、決して「空集合だから token-free」と結論しない。新 issuance は unavailable、retired validity は復活しない。invalidation 処理中に snapshot 不能・token 値未知・取得漏れ・scanner/fallback 準備不確実が起きたときは `PERSISTENCE_SAFE=NOT_PROVEN` とする。生の token、raw exception、パラメータは logging/ZIP に残さず、digest/boolean/count のみで判定する。

**全書込パスの定義:** 先に `message_end` で role=assistant と role=toolResult の全 content/ToolCall args/metadata（toolResult `structuredContent`/details/keys/values も）を、既知 live/retired token 完全一致 literal と予約 capability marker を含め掃引する。identity-preserving *in-place canonical replacement* を host callback へ返し、その正規 message だけが `entry_appended`/SessionManager/JSONL へ行くことを確かめる。対象は late echo、unknown/incomplete tool、non-task attempted copy、validation error、duplicate/key-collision を含む。未知/分類不能の token があるかもしれず safe sanitation が検証できない場合、original message を通すよりも **Design §7.5 で規定した exact same-role minimal fallback** に正規オブジェクトを同期置換する。assistant と toolResult のそれぞれの既定 fields と id-preservation rules を尊重し、role の偽装、適当な空 object、例外を投げるだけの fail-open を禁止。fallback は no receipt/no provenance/no fresh authority。host の後続 handler が raw original を復活させるケース、onMessageEnd の例外 catch、append 抑止不能は *source order だけでは安全ではない*。

**停止条件:** Sanitation inventory の保全が不能でも same-role fallback が **確実に authoritative append 前に適用され実 readback が token-free** と立証できる場合に限りその profile の `PERSISTENCE_SAFE` を検討できる。fallback 自体の適用失敗、accepted replacement の host 実証欠落、別 Writer による raw original append、未観測 late response、incompatible Senpi chain、raw token present in SessionManager/JSONL/log のいずれかで `PERSISTENCE_SAFE=NOT_PROVEN/VIOLATED` とし **B2-HOST STOP、full product enable 禁止／Option C**。Senpi の fail-open exception や `ctx.abort` は persistence veto ではない。`AUTHORITY_FAIL_CLOSED` の PASS による waiver を禁止。

**相互独立 test obligation:** Case A (`provider_stream_error`) は normal sanitation→invalidation と late assistant/toolResult の *それぞれ初期状態で実 token-bearing* positive message を actual callback→in-place changed replacement→matching entry identity→`entry_appended`→SessionManager/JSONL immediate readback まで検査する。Case B (`justice_sanitizer_failure`) は sanitizer 内の bounded fault から **同じ role の exact minimal fallback** を確認する。assistant success で toolResult を代用、Case B で Case A を代用、token-free before/after を positive removal と数えることを禁止。B1 は inventory-transition/authority predicate を compiled に条件付き立証できても、actual append の `PERSISTENCE_SAFE` を証明できない。

### D.7 Option C API 境界と B2 技術上の不成立判定

**最小 public host contract 候補**（現 Senpi にあると主張しない）: `tool_call/read_started` に `(immutableInstanceGeneration, immutableSessionIncarnationId, attemptId, toolCallId, canonicalResolvedReadTarget, startSequence)`、`tool_result/read_completed` に **同一 host-minted** `(generation, sessionIncarnationId, attemptId, startSequence, completionSequence, error/result)`、`invalidation/stream_error` に同一 serializable host timeline の `invalidationSequence`、`after_error` の read delivery の観測 hook、`message_end` / append の exact stable identity。result の attempt identity は result を受けた Justice が生成するものではなく、host が開始時に発行し completion まで運ぶ。read が失効より前に開始なら completion が後でも reject、read が後開始でも lifecycle 成功だけでは issuance せず final commit recheck を通す。

B2 preflight でこの意味論を fixed Senpi の public APIs/host ordering に対して証明できず、G1→G2 同 callId alias を排除できないとき、**B2 の positive final verdict を禁止**し、Options A/C の新 human 判断へ戻す。上流 API 実装／pin 変更は別依頼・新 sha・全 runtime evidence 再検証を要し、既存 `31/32` を新バージョンへ無検証で移植しない。

## E. Normative Amendment Candidates — Revision 11 (R11 latest complete unadopted candidate; historical R7/R8 not operative)（**未採択の完全規範候補**）

ここからの `MUST`／「しなければならない」は **Requirements owner と人間の採択後に初めて効力を持つ候補文面**である。現行の承認済み R/D/P を改訂していない。文言を採用する行為と実装認可も別である。元の A–K、RG-005、32件、Case A/B、B-001/B-002、JUS5-AUTH-01..09、ACC、COMPLETE の非退行を前提とする。

### E.1 Requirements `JUS5-HARNESS-03` 末尾追加（候補）

> **RG-310-A-001 evidence classification and final proof obligation.** 本要件で required とされた pinned real runtime evidence は、fixture transition model、source API possibility、コンパイル済み Justice guard の unit conformance に置換してはならない。証拠には `PINNED_SOURCE`, `FIXTURE_MODEL`, `PRODUCTION_COMPILED_TRANSITION`, `PINNED_ACTUAL_RUNTIME`, `PINNED_GUARD_INTEGRATION` のいずれかと exact source/binary/test hash を記録する。未取得の runtime stale read、same-session fresh read、late assistant/toolResult sanitation は `NOT_RUNTIME_PROVEN` と記録する。
>
> `provider_stream_error`（Case A）の実 runtime protocol 証拠には、同一 host session source incarnation で失効前に登録された選択 method `read` が失効後に**実 runtime から成功結果として届けられ**、Task1 の同等の正規 protocol rejection が実際に成立することを要する。B2 の production-bound guard が同じケースを観測しても、その証拠は別の RUNTIME_INTEGRATION predicate とし、**full Task6 production acceptance は Task1 の前提ではない**。モデル結果の synthetic old-result、source ordering の類推、他 session の event、単に result が届かなかった記録は不可とする。Case A の cached activation rejection、fresh selected-method read reauthorization、late assistant と late toolResult の実 token-positive sanitation→exact append/JSONL readback、旧 receipt replay refusal、failure-retired token の sanitation-only と no trusted execution/provenance も個別に必要とする。
>
> Authority denial と before-append sanitation は別々の acceptance predicate である。Case A/B の各 role-positive actual append/JSONL readback まで立証されない場合、`FAILED_DISABLED` の authority denial のみで `PERSISTENCE_SAFE` を推定してはならず、製品は `UNSUPPORTED/BLOCKED` とする。canonical 32 の unknown-tool exact message identity と独立 `RG-310-B-002` の token-positive synthetic result removal は別途充足し、分母/evaluator を維持する。
>
> Fixed Senpi の `ToolResultEvent` が公開しない generation/epoch/attempt/session-origin metadata を現在の `ExtensionContext` から単に補足し、host result 自体の source identity と見なしてはならない。host origin binding が public callback により証明できない場合、当該結果に基づく authority は fail-closed、Case A は BLOCKED とする。必要なら独立した upstream public API/host 改訂と新 pin の全 evidence revalidation を先に求める。Case B は独立、canonical denominator は32に固定する。
>
> **例外的な scoped development authorization** は新 `JUS5-HARNESS-05` / `JUS5-AUTH-10` に明記された条件でのみ認める。これは `JUS5-HARNESS-03` の runtime evidence requirement の免除ではなく、同 requirement を保持したまま実 runtime 証拠収集用の小さい未配線実装にだけ先行権限を作る。実際の Task 1 完了、Task 2–14 通常認可、製品 acceptance を意味しない。

### E.2 新設 `JUS5-HARNESS-05 — RG310 Staged Evidence and Host Identity`（候補）

> (a) `RG310-B0` は人間が事前署名した exact R'→D'→P' / branch / path / command / actor / duration によってのみ発生する、隔離された Task 2 pure domain + Task 6 未配線 state/registry 実装の権限である。`RG310-B1` はその revision の実 compiler-emitted production JavaScript に対する scoped transition evidence verdict であり、新しい実装権限ではない。`RG310-B2` は独立の人間承認を要する、package dependency slice と test-only Senpi/compiled-guard host integration の別権限である。`RG310-B3` は通常 Gate への再評価要求であり、Task1 の既存 evaluator による先行再審査と、full Task6 後の製品 Gate を区別する。B3 自体は TaskAccepted/PlanComplete の権限を発行しない。
>
> (b) Task 6 の `ReadAttemptEpochGuard` は単一 owner、`ACTIVE | INVALIDATING | AWAIT_FRESH_READ | FAILED_DISABLED` の fail-closed state と session-incarnation-local epoch/attempt registry を保持する。startup/invalidation completion では fresh selected-method read 以外を禁止する `AWAIT_FRESH_READ` とし、`INVALIDATING`/`FAILED_DISABLED` は read registration、activation、issuance、provenance を一切禁止する。失効は同期に epoch を進め candidate receipts/live capability/current `WorkflowActivationEvidence` と pending read authority をまとめて失効させる。部分失敗・再入・overflow は `FAILED_DISABLED` とし当該 instance 内の自動復帰は禁止。durable method selection は保持し、old receipt、cached activation、failure-retired token は再授権に使用できない。
>
> (c) `read tool_call` で事前登録された attempt のみ result を一度消費できる。unknown/duplicate/stale/superseded/wrong-session/wrong-generation/wrong-authorization/wrong-method/wrong-target/out-of-order/error result は no activation/no issuance/no trusted provenance。同期 final commit の直前に current epoch/state/attempt/result origin を再検査し、非同期処理の前後で値が変われば deny とする。`processLocalGeneration` や callback 時点の current context は result origin の独立証拠ではない。host 側で generation/session incarnation/attempt の同一性を binding できない場合は `ORIGIN_UNPROVEN` とし authority を拒否する。
>
> (d) B1 のために独立 temp compile output の emitted JS を import した negative/positive/mutation controls と artifact fingerprint ledger が必要である。B1 はその **compiled transition subset だけ**を検証する。fixture guard copy、Vitest source-only、手渡しの偽 origin metadata、単独の source SHA は PASS を発行しない。実 Senpi の origin delivery、extension ordering、JSONL/persistence、global tool guards、late-response、no side effects は B2 runtime で別途観測しなければならない。
>
> (e) B2-HOST は先行 B2-DEP の結果として exact Senpi public SDK import/typecheck が実際に解決済みであることと、approved Plan Task 6 の `@code-yeongyu/senpi@2026.10.8` exact **devDependency** を満たす `package.json`＋`bun.lock` の限定差分、及び native entrypoint/export が **非接続**である証拠を要する。変更予定の hunk・compiler/source/import graph・lock graph を独立に審査し、先行する別の human B2-DEP scoped authorization がその2ファイルを名指ししなければ依存変更を始められない。最小 `bun.lock` diff と `tsc` import/typecheck 成立を証拠として独立確認したのち、**さらに別の human B2-HOST authorization** を要する。lock 追加で予定外の drift/範囲外差分が生じた場合 STOP・再審査/再承認。B2 は `./senpi` production export、新規一般依存、full Task6 integration、有効化/配布を認可しない。公開 API から実 read-result origin が結合できない／旧 read の completion を実測できない場合 B2 を PROVEN とせず、Option C を人間へエスカレートする。
>
> (f) Expected RED は B0 の未提出 focused test にだけ許される。正式 B1 submission の FAIL、mutation negative control 欠落、hash 不一致は B0 revoke/STOP。実 token leak、権限外差分、実 side effect、外部 provider 実行は RED 段階でも即 revoke/STOP。B1/B2 PASS から Case A/Task 1/製品 acceptance を自動的に昇格させてはならない。

### E.2(g) `JUS5-HARNESS-05` への同期 authority commit 追補（RG-310-R2-001／候補）

> (g) Task 2 の `WorkflowActivationStateStore` 公開署名を変えず、Task 6 の store は `setActivation(evidence)` の唯一の authority update を同一 owner 上の non-reentrant **synchronous validation+commit** で Promise return に先行させる。`invalidateSession(sessionId,reason):void` と activation commit は全順序の `L_INV`/`L_ACT` を持ち、`L_INV` より前の commit は必ず revocation され、後の stale work は private epoch/incarnation/attempt/host-origin fence で commit を拒否する。Promise settlement、I/O/lookup completion は authority を後から更新してはならない。`ACTIVE` とされた後でも issuance は completion 時点の全 live guards を同期照合する。partial failure は fail-closed、`getCurrentActivation=null` だけでなく issue/resolve DENY を必要とする。B1 は実 compiled production store/registry の old-deferred setActivation Promise、old-precommit work、reused identity、fresh non-stale positive、intentional mutation detection の試験に PASS しなければならない。実 Senpi stale success 到着後の拒否は final acceptance の免除不能条件である。

### E.2(h) `JUS5-HARNESS-05` への sanitation separation 追補（RG-310-R2-002／候補）

> (h) `AUTHORITY_FAIL_CLOSED` と `PERSISTENCE_SAFE` は独立の受入論理で、`FAILED_DISABLED` は前者の状態だけを示す。後者は failure-retired/ordinary-retired/leak-veto/live token inventory、unknown-result backstop、late role=assistant/toolResult の accepted canonical in-place replacement、同一 role の exact §7.5 fallback、`SessionManager`/JSONL readback によって別途立証する。invalidation/partial failure で inventory を失った状態を token-free と見なしてはならない。sanitizer exception throw、`ctx.abort`、host source ordering だけは append veto の証拠ではない。fallback 不能、raw append、unknown token safety 不明なら profile を `UNSUPPORTED/BLOCKED` とし B2 STOP／Option C、production enable を禁止。Case A normal provider error と Case B Justice fault は独立維持、B1 compiled proof で実 runtime append を代替しない。

### E.3 新設 `JUS5-AUTH-10 — RG310 Exact Scoped Authorization`（候補、既存 AUTH-01..09 に優先しない）

> `RG310-B0`, `RG310-B2-DEP`, `RG310-B2-HOST` は通常の Task authorization と異なる *positive allowlist* により、各々独立の `decisionId`, `authorizationId`, `authorizationKind`, `humanSigner`, `actor`, `approvedAt`, `expiresAt`, `branch`, `baseCommit/tree`, `approvedRequirements/Design/Plan source revisions + raw fingerprints`, `artifactChainId`, `fingerprint/projection schema`, `Plan canonicalSnapshot`, `upstream pins`, `allowedTaskSubparts`, `allowedPaths`, `allowedOperations/Commands`, `expectedSourceDiff`, `generatedArtifactOutputRoots`, `forbiddenOperations`, `evidencePredicates`, `revocationPredicates`, `independentReviewRef`, `explicitResidualRisk` を持たなければならない。絶対期限は発効から最大14暦日であり、自動延長を禁止する。項目が欠損/古い/曖昧なら `NOT_AUTHORIZED`。
>
> 必須承認順序は **Requirements owner → Design owner → Plan owner → fresh independent normative review → human Architecture Decision → human exact-chain scoped authorization** とする。**承認された R'/D'/P' baseline 自体の substantive amendment**、pin/actor/branch/allowed hunk/permission の無承認変更は元の authority を失効させる。一方、**その baseline が明示許可する B0 / B2-DEP / B2-HOST-PREP の implementation source/output revision 変更**は signed `IAB` を変更せず、allowlist 内の反復編集のみで `REVOKED` としない。常に per-operation の scope, expiry, safety と append-only delta ledger を検証する。B1 の `artifactId` とこれら mutable output revision は別識別子であり、B1 PASS を新 artifact に流用できない。Reviewer の PASS、AI の計画文、commit、PR、merge、単独の Ruling は権限を生成しない。
>
> B0 は D.3 の列挙された pure Task2/domain と unconnected Task6 guard/tests を超えてはならず、`package.json`、lock、production export/adapter/CI/外部 provider を許可しない。B2 は B1 の独立 conformance PASS、read-only host/dependency preflight、追加 R/D/P scope の fresh review と **human B2-DEP 依存変更許可**の後に限り `package.json` exact devDependency、`bun.lock` 必要 hunk を範囲指定できる。lock diff と import/typecheck 実証を別途確認し、別 human `B2-HOST-PREP` grant で test-only wiring **source edits だけ**を範囲指定できる。compiled/static final `EAF_final` を独立再検証し、人間が `B2-HOST-ACTIVATE` を final artifactId に対して署名した後でのみ test-only native runtime wiring を実行できる。B0→B2 に権限の自動継承はない。
>
> **B1 formal FAIL** は `B1_FAILED/B0_REVOKED/STOP`。**無許可 drift/scope 逸脱/危険な副作用**は該当 grant を `REVOKED/STOP`。これらと異なり **合法的 artifact 変更・証拠欠落**は過去 attestation を `SUPERSEDED_FOR_CURRENT` / Gate `BLOCKED` とし、直ちに grant を失効させない（ただし証拠が要求される操作は実行不可）。Expected RED は B0 submit 前の no-safety-side-effect TDD のみ修正可。新たな source scope、baseline amendment、期限満了/取消からの復帰には新 human authorization、新 final artifact activation には human exact artifact confirmation が必要。04 §§2–5 の predicate に従う。

#### E.3.1 `JUS5-AUTH-10` R11 authorization baseline / output / attestation 再規範化（候補）

> Grant は不変 human-signed IAB に署名し、実装 output の current hash を含む証拠 fingerprint と**分離**しなければならない。B0 で毎回の `START_ADMISSIBLE→OP_PREPARED→OP_COMMIT_ACCEPTED` を満たす任意回数の純粋実装編集、B2-DEP の別 grant 下の exact dependency update、B2-HOST-PREP 別 grant 下の test-only source は、許可済み差分台帳を更新しても grant の自己失効にはしない。IAB / actor / branch / scope / deadline / pin / 禁止操作違反・安全性違反は fail-closed STOP/REVOKED。source/lock/compiled fingerprint 変更は独立 B1 / reattestation の current evidence applicability を失効するが、合法 grant 自体を REVOKED としない。具体的 predicate は 04 §2 を採択候補に編入する。
>
> 各 HSA は `baselineId`、`outputRevisionLedgerRoot`、別 `artifactId`、`attestationId` を独立記録する。新 source SHA をもって `allowedPaths` / `allowedCommands` / human review / upstream pin を増やさない。B1 PASS は exact `EAF_0` のみ。B2-DEP または B2-HOST-PREP による最終 artifact 変更後の B2-HOST-RUN 開始は、独立 `B1-REATTEST-FINAL(EAF_final)` PASS と final artifactId に署名する別人間 `B2-HOST-ACTIVATE` confirmation の両方を必要とする。RA は source mutation grant ではなく、別 `READ_ONLY_VERIFY` owner/署名で temp emission のみ。`RA_FAIL`/未実施/追加 diff は host BLOCKED、実 unsafe/無許可 drift は grant REVOKED。

#### E.3.2 `JUS5-AUTH-10` — R11 retained two-phase operation admission and atomic acceptance (FI-001 candidate)

> **Typed prospective start:** `OP_PREPARE_ALLOWED` が `START_ADMISSIBLE` を返すのは、actor 外の monitor と independent signer/revocation/clock/recorder/key/seq が真正であり、exact HSA/IAB scope、preRoot、writer fence、私有 stage、禁止 side effects を **将来 afterRoot に頼らず事前に**検証し、独立 durable `OP_PREPARED` を書込前に固定したときだけ。`START_ADMISSIBLE` は private staging の許可にすぎず、authoritative source/外部 provider/network/host mutation を認めない。
>
> **Typed retrospective acceptance:** staged actual paths/hunks/modes/symlinks/full afterRoot と commit 瞬間の grant freshness/phase/root continuity、禁止 side-effect なしを独立再確認し、**authoritative bytes の可視化と independent durable accepted proof を同じ linearizable transaction** に束縛できるときだけ `OP_COMMIT_ACCEPTED`/`ACCEPTED_DELTA`。事前署名だけの committed 判定、後刻の append receipt を待つ無seal公開、best-effort rollback をもって安全性の証明とする解釈は禁止。
>
> **Abort/recovery:** 拒絶 stage は無外部影響を証明して `OP_ABORTED`+independent seq tombstone。crash、split commit、recorder gap、未決 seq、unmediated writers は `IN_DOUBT`/`UNKNOWN/BLOCKED+STOP` で隔離し、`PHASE_COMPLETE`、再 PREPARE、HOST を禁止する。現実の bypass/許可外副作用が確認された場合のみ `REVOKED+STOP` とし、`CLOSED/EXPIRED` と証拠 EAF 失効は直交。trusted atomicity/complete mediation が未証明なら最初の PREPARE から禁止。R11 `04-authorization-fingerprint-transition-matrix-R11.md` §§1–5 が型・時系列・38ケースの唯一の normative candidate である。

### E.4 `JUS5-AUTH-02/04/06/07/08`、`JUS5-ACC-02`、`JUS5-COMPLETE-01` 共通追補（候補）

> **[RG-310-R3-001 / R3-002 — 正式採択前の受入境界追補]** Scoped authorization も元の Requirements→Design→Plan の正確な source revision/Plan canonical snapshot に束縛され、substantive 変更で失効する。既存の通常 Tasks 2–14 authorization と混同しない。B0/B1/B2 の成果・レビューは `NOT_ACCEPTANCE_AUTHORITY` であり、B3 は各既存 Gate への再審査申請でしかない。AI reviewer や人間の architecture choice 自体は TaskAccepted/PlanComplete を発行しない。
>
> **(T1: Task 1 existing completion; acceptance contract unchanged)** `TASK1_EXISTING_ACCEPTANCE = (canonical 32/32 PROVEN) ∧ (Case A PROVEN) ∧ (Case B PROVEN) ∧ (required runtime evidence PASS) ∧ (mandatory safety predicates PASS)` とする。各 predicate は **現行の** `evaluateTask1Acceptance()` の定義・identity join・evaluator に従う。Case A は canonical32 の第33件ではない。CaseA の real stale in-flight read success delivery/actual rejection、same-session continuation、cached activation deny、fresh read reauthorization、late role-positive pre-persistence sanitation は既存 Task1 証拠契約を弱めず実測を要求する。**Task 1 の判定前提に full Task6 integrated production implementation/acceptance、B0/B1/B2 の PASS、RG-310-B-001/002 の closure を追加しない。** B2-HOST の証拠を Task1 の実証材料として提出できても、Task1 owner が元の evaluator/証拠規則で別途判定しなければ `Task1 PROVEN` にならない。
>
> **(R/I non-backflow; RG-310-R4-001 — 追加の候補規範)** `ACTUAL_RUNTIME` 証拠 `R` は現行 Task1 Gate が既存 evaluator と既存 fixture/protocol/identity 条件に従って審査する。`RUNTIME_INTEGRATION` 証拠 `I` は B2-HOST／後続 production assurance が審査する**独立の Gate 属性**であり、`TASK1_EXISTING_ACCEPTANCE` への新規必須 AND 入力ではない。F matrix の `R/I` 表記は共通条件でも代替可能な `R OR I` でもない。後続製品受入では production-bound guard による actual old read success rejection の `I` を引き続き必須とし、B2-HOST test-only 証拠だけで full Task6/最終製品 PASS を発行しない。actual old read の Task1 `R` のみから製品安全性を PROVEN と推定しない。
>
> **(T6: full Task 6 ordinary acceptance; downstream of T1)** `FULL_TASK6_ACCEPTANCE` は、**T1 が既存 Gate で PROVEN になった後**に、通常の人間の exact-chain Tasks2–6 authorization（Task5 correlation interfaces 等の必要依存を含む）、Task6 production implementation、full source/runtime/conformance と独立の通常受入 Gate が揃って初めて審査可能になる。B0/B1 の未配線 compiled subset や B2-HOST の test-only native callback integration を Task6 全体の完成と扱わない。B2-HOST は production export `./senpi`、normal installation、delivery、本番 enable を許可しない。`FULL_TASK6_ACCEPTANCE` を T1 の条件に戻してはならない。
>
> **(PR: distinct final product readiness; proposed, NOT ADOPTED)** `RG-310-B-001` fixture-only と `RG-310-B-002` token-positive synthetic toolResult actual removal は canonical32 分母外の独立 Finding である。これらの closure を **Task1 completion の追加引数、仮想第33/34契約、CaseA/B の条件、または既存 `evaluateTask1Acceptance()` の内部条件として扱わない**。製品出荷前の横断安全性として二件を審査する新しい `RG310-PRODUCT-READINESS` は提案段階の**別 Gate**とし、Requirements owner が要件を明文採択し、Plan/Gate owner が別の評価器・predicate/証拠台帳・責任分界を規範化し、fresh independent review と human approval を経た場合に限り効力を持つ。採択前は `PROPOSED_NOT_ADOPTED` であって、既存 Task1/PlanComplete evaluator を黙示変更しない。未解決 Findings の状況は個別に報告し、既存製品 Gate の必須安全性は別途保持する。
>
> **(No runtime waiver)** Task1 と Task6 と製品側の各 Gate は `SOURCE/MODEL/COMPILED/ACTUAL_RUNTIME/RUNTIME_INTEGRATION` を独立評価し、最終製品受入では実 stale in-flight read success arriving after error + authority rejection、late assistant/toolResult positive actual removal / canonical append safety を他の証拠で免除しない。所定の zero missing evidence、final quality/conformance、正式 human authorization を満たさなければ製品有効化や PlanComplete を発行しない。ただしこの最終保証を理由に、未認可の full Task6 acceptance を Task1 の前提へ逆流させない。

### E.4.1 既存 Task1 evaluator と B findings の権限分離（規範候補）

> `evaluateTask1Acceptance()` は既存の32契約・CaseA/B・requiredRuntimeEvidence・mandatorySafety 以外の項目を暗黙に追加しない。unknown-tool real `message_end` の非null exact pre/post `messageId` identity は canonical32 のまま残る。B-002 は initial token-present→actual sanitizer changed→token-absent append/readback の **別の positive-removal 証拠判定**、B-001 は別の fixture-only 証拠判定として各 track の owner が独立 closure を行う。製品横断 Gate 用の新しい evaluator を導入する場合は、別 Requirements/Plan 修正・独立審査・人間認可が必要である。過去 R5 判定に照らした本 R7 において code/fixture/evaluator/分母の変更を提案・認可しない。

### E.4.2 段階別 Gate 手渡しと権限主体（規範候補）

> B1 の compiler-emitted actual `.js` conformance は Task1 既存 Gate の入力判定と別である。B2-HOST の fixed Senpi callback/compiled guard test-only evidence については、実観測され正規の Task1 predicates に一致するものだけを Task1 evidence owner が独立受理可否判断する。`B3-T1` は Task1 の既存 Gate に提出して PASS/BLOCKED を求めるだけであり、B3/B2 自身が Task1 acceptance を発行しない。Task1 通常 PASS 後にのみ、追加 exact-chain human authorization に従って Task2/5/6 production work を進め、full Task6 ordinary acceptance を後段で求める。製品側 `RG310-PRODUCT-READINESS` 新設は、Requirements owner / Plan owner / product Gate owner / 別 evaluator owner / fresh reviewer / human approver に責任を割り当てる *future separate* change であり、本提案で既存判定器を改訂しない。

### E.5 Design §7.5 追補 `§7.5.1 — ReadAttemptEpochGuard`（候補）

> **Type ownership:** Task2 は `WorkflowSessionInvalidationReason`, `WorkflowActivationEvidence`, read attempt/observed-event の純粋語彙と interface を持ち、Task6 は runtime registry/store/invalidation/issuer の *single owner* を持つ。source event には `toolCallId`, `toolName`, `input`, `content`, `isError`, optional parentToolCallId 以外の origin field が現 pin で証明されていないことを明記する。`processLocalGeneration`, current `sessionContext`, `authorizationId`, `method`, `epoch` は adapter/registry が derived/captured した LOCAL/CURRENT_CONTEXT fields とし、`tool_result` の host-issued immutable origin field と同列に扱わない。`HOST_ORIGIN_BOUND` の発行には同一 live runner/session incarnation 由来であることを publicly audited host lifecycle が保証する必要がある。host origin が証明できない read result を activation へ利用してはならない。 `verifiedBindingRef` が存在するだけでは proof とみなさず、当該 runner/attempt の immutable source binding に対して Task6 内部 private origin-witness table で照合しなければならない。外部から渡された `HOST_ORIGIN_BOUND` JSON、replayed/ref mismatch、wrong generation は compiled guard が runtime で拒否する。B1 synthetic witness は MODEL_ASSUMPTION と区別し、host が private witness を正当に mint できない場合は常に deny / B2 STOP。
>
>**Four states:** 初期は `AWAIT_FRESH_READ`、successful currently-origin-bound selected read のみ `ACTIVE`、failure は `INVALIDATING` を経て同期 epoch 増分・全 receipt/capability/activation/pending attempt revoke 完了後 `AWAIT_FRESH_READ`、partial failure/reentrancy/overflow は terminal `FAILED_DISABLED` とする。`AWAIT_FRESH_READ` 中に許すのは *new real selected read tool_call attempt registration* のみ。`ACTIVE` 以外では `issue`/`resolve` は常に deny。全 decision point は private current state/epoch に同期紐付けし、await 後、issuance commit の直前で再照合する。
>
>**Attempt lifecycle:** read-start callback から同一 origin scope の exact callId/target/input digest と local monotonic order を持つ PENDING を一度登録。後の result から過去に遡って登録しない。duplicate/previously seen callId、unknown result、cross auth/session/method/path/generation、stale/superseded/out-of-order result は reject。新 read 登録で old pending を supersede し latest-start-wins とする。結果の success、path、origin-bound verifiedBinding、current epoch、PENDING を全部満たし、atomic consume で初めて current activation を作る。誤 result が現在の有効な activation/selection を上書きしてはならない。
>
>**Host-boundary counterexample:** G1 `read(X)` pending → G2 restart 同 durable ID `read(X)` → G1 `result(X)` arrives。G2 current context だけで origin を補完する実装は禁止。public callback source lifecycle による ingress origin 証明がないとき `ORIGIN_UNPROVEN` として deny し、B2 final result を `BLOCKED` とする。新 Senpi API を使用する場合、host minted `(immutable generation, session incarnation, attemptId)` を read start/result の両方に持たせ、invalidating order と completion order を inspectable とする。**現在の pin にこの API があるとは宣言しない**。
>
>**Other safety:** provider error は real host assistant error の normal synchronous sanitation、Justice sanitizer failure は exact same-role minimal fallback。両者とも失効・retired sanitation・no trusted task/child・no receipt replay は同一保証とし、Case A/B を混ぜない。failure-retired tokens は shutdown/restart まで sanitation-only、late assistant/toolResult は actual `message_end` で persistence 前に redaction、synthetic immediate error と unknown-tool は別証拠で管理する。stop/restart/switch/accepted compaction に authority の歴史復元はない。compiled tests と pinned actual runtime/prod integration proof は異なる verdict である。

### E.5.2 Design §7.5.2 — `WorkflowActivationStateStore` 同期 commit／epoch fencing 追補（RG-310-R2-001／候補）

> Task 2 の既存3 API `setActivation(evidence): Promise<WorkflowActivationStateMutationResult>` / `getCurrentActivation(...): WorkflowActivationEvidence|null` / `invalidateSession(...):void` は不変とする。Task 6 内部では `setActivation` entry から Promise return までの non-reentrant synchronous section において private host-origin-bound read attempt、同一 incarnation/authorization/session/selected method/target/epoch/latest-order、一回消費、read success、guard readiness を照合し、memory-only activation state を同期で1度だけ linearized commit する。await/then/external callback 後に activation を書き戻してはならない。`invalidateSession` は同期 admission-latch+epoch increment+all activation/attempt/receipt/capability revocation を完了し、その後の旧 Promise settle・old read event はいかなる権限も復活させない。部分/例外失敗は `FAILED_DISABLED` に保守的にラッチし、getCurrentActivation null、issue/resolve DENY、raw token sanitation は別の義務として存続する。`saved|idempotent` result は current live recheck 後にのみ issuance 考慮可。同期 commit を現 interface の下で立証できない実装は B1 BLOCKED、新規規範再設計を要する。D.6.1 の N1–N4/P1–P2 を compiled production module に適用する。

### E.5.3 Design §7.5.3 — `FAILED_DISABLED` / sanitation readiness 分離（RG-310-R2-002／候補）

> `AUTHORITY_FAIL_CLOSED` は issuance/receipt/resolve/tool_call/provenance と state を拒否する性質、`PERSISTENCE_SAFE` は pre-append authoritative in-place canonical sanitation/fallback と同一 actual JSONL/SessionManager bytes に token が残らない性質とし、両方の証拠なしに安全とは判定しない。失効前に known live/retired token を failure-retired sanitation-only inventory に保全し、partial failure/`FAILED_DISABLED` 中も origin/authority と混合せず shutdown/restart まで保持する。unavailable inventory が false-negative を生むなら original message を通さず approved §7.5 same-role exact minimal fallback を採用し、役割・ID・canonical in-place replacement と append-before/after を証明する。fallback 適用に失敗、host exception を飲み込んで raw append、late role の token-positive replacement が未実証なら profile UNSUPPORTED/BLOCKED、B2 STOP。case A/B は別 predicate であり B1 compiled は actual persisted safety を代行しない。

### E.6 Implementation Plan Task 1 追補（候補）

> **Task 1 still BLOCKED:** 32 denominator、Case A/B independent controls、unknown-tool exact `sessionId/toolCallId/messageId` を一切変えない。`RG-310-B-002` positive-token-removal は分母外の別 safety evidence track に属し、Task1 evaluator の追加条件ではない。Evidence report は `Final Task 1 evidence gate repair` を最新 authority とし、過去の 32/32 を昇格しない。Case A 内の read/error/read-result/continuation を actual event and JSONL join し、`PINNED_ACTUAL_RUNTIME` を既存 Task1 evidence の要求に沿って実証する。`PINNED_GUARD_INTEGRATION` は B2-HOST の別の補強証拠であり Task1 の新たな必須依存にはしない。`read` old result が host から到達せず、又は result origin binding が source/context の推定でしかないとき `NOT_RUNTIME_PROVEN` として BLOCKED。模型/synthetic read-result injection に runtime label を与えない。
>
>Same durable session の post-error read、failure-retired token を持つ late assistant と late toolResult の **それぞれ token-positive before → sanitizer changed → token-absent appended exact entry/JSONL**、candidate receipts positive count と全件拒否、old activation no reissue、failed task no execution/provenance を独立に記録。実測不能時に case 判定を変えず、Option C の上流 public API 検討へ handoff する。これは B2 test-only scope の開始認可ではない。

**[R5 E.6 boundary addendum — proposal]** Task 1 の既存 evidence predicate が `R` で成立した場合、`PINNED_GUARD_INTEGRATION` の未実行・`I=NOT_PROVEN`・B2-HOST/Task6 未認可だけを理由に Task1 existing evaluator を BLOCKED としてはならない。**固定 Evidence Report の最終 `task1Acceptance` 記録では `required-runtime-evidence` aggregate と `mandatory-safety` aggregate はともに true** である。現在の BLOCKED の具体的原因は **canonical 31/32（unknown-tool exact `messageId` join 不成立）と独立 Case A BLOCKED** であり、Case B PROVEN を維持する。未検証の mandatory-safety failure を推測・加算してはならない。既存 evaluator の AND 条件と将来の安全性検査要件は全く変更しない。`I` は後続 B2/production assurance において fail-closed に要求する。

**[R11 E.6 exact evidence status cross-check]** 固定 Evidence Report の `Final Task 1 evidence gate repair — 2026-10-12` は `required-runtime-evidence and mandatory-safety aggregates are true`（final task1Acceptance entry）と記録する。`Case A=BLOCKED` と `canonical 31/32` は正規独立入力で、これだけで既存 AND Gate が BLOCKED。どの mandatory safety 個別項目が未充足かを追加推測しない。32分母/CaseB/unknown-tool/evaluator は変更しない。

#### E.6.1 操作認可 provenance / Evidence Report は別々に凍結（R11 候補）

> Evidence Report 最終 `canonical 31/32`, Case A `BLOCKED`, Case B `PROVEN`, unknown-tool `BLOCKED`, required-runtime-evidence aggregate **true**, mandatory-safety aggregate **true**, Task1 `BLOCKED` を採用し、古い 32/32 snapshot を現況としない。実装編集の `START_ADMISSIBLE`/`ACCEPTED_DELTA` 成立は Task1 runtime `R`、compiled `P`、production `I` の立証とは**別問題**。監査証跡が欠けた phase の成功を independent evidence を使って復活させない。現行既存 evaluator は変更しない。

### E.7 Implementation Plan Task 2 `RG310-SCOPE-T2` 追補（候補）

> Preconditions: `RG310-B0=HUMAN_SCOPED_AUTHORIZED`、source revision/allowed branch/paths/commands/absolute expiry が exact match。`src/core/native-task-capability.ts`, `src/core/workflow-activation.ts`, focused 2 tests の pure types/codec/activation interfaces を RED→GREEN。`ToolResultEvent` に存在しない origin field を正規 API として型宣言しない。`ObservedReadResult` の PUBLIC_EVENT_FIELDS と `observerScope` の CURRENT_CONTEXT fields と `HOST_ORIGIN_BOUND | UNAVAILABLE` の trust tier を明示する。`HOST_ORIGIN_BOUND` を任意テスト入力で作れた事実は B1 synthetic precondition に留める。既存 Task2 全体、routing/category mutation、production activation、Task10 dependency は未許可。
>
>State `B0_DEV_RED` の失敗は許可範囲の TDD のみで修復し、実際の危険経路が観測されれば RED 中でも STOP。B0 GREEN を Task2 complete／Task1 PROVEN と表示しない。

### E.8 Implementation Plan Task 6 `RG310-SCOPE-T6` / `RG310-B1` 追補（候補）

> Preconditions: B0 exact grant + Task2 pure contracts。`src/runtime/native-task-capability-registry.ts`, `src/runtime/workflow-activation-state.ts`, `tests/runtime/senpi-adapter-activation-capability.test.ts`, `tests/runtime/native-read-epoch-parity.test.ts` の detached registry/store only を実装。invalidation linearization、4 states、latest-start-wins、duplicate/reuse、wrong generation/session/auth/method/path、unknown/stale、pre/post await recheck、failed-disabled、fresh rearm、receipt invalidation、selection preservation、retired sanitation-only と hard STOP を tests に含める。
>
>B1 用には approved `tsconfig.json` と installed exact dependency graph で `tsc -p tsconfig.json --outDir <isolated-absolute-temp>/dist --incremental false` を行い、元の `dist` と tracked files を変更してはならない。生成対象の実 `.js` registry/store を別 Bun child process の `file://` absolute URL から import、.ts/source/fixture-copy への fallback を拒否する。全 source/import/compiled JS/config/compiler/bun/lock/test vector/negative mutant hashes と cwd/stage realpath を ledger に固定する。mutation は一時 temp copy に限り、同 runner で欠陥が検出されることを必須とする。純粋な transition が PASS したという部分集合のみ `PRODUCTION_COMPILED_TRANSITION_CONFORMANT` と記録し、host callback・persistence・no-trusted-execution を同時 PROVEN と記載しない。
>
>B1 提出前の expected RED は `B0_DEV_RED` であり最終 Gate failure ではない。`RG310-B1 SUBMITTED` 後の FAIL/skip/unknown compiled path/mutant not detected は `B1_FAILED`, `B0_REVOKED`, `STOP`。実 token leak/side effect/allowlist violation は B0 TDD の RED 中でも即 revoke。B1 PASS は別の independent reviewer が revision and actual JS を確認して初めて `INDEPENDENT_VERIFIED`、しかも次の B2 authorization を発生させない。

#### E.8.0 B1 artifact fingerprint の判定規則（R11 候補）

> B1 の compiled PASS を `EAF_0` に署名し、source closure/compiled JS/compiler/env/tsconfig/package/lock/dependency graph/test vectors/mutation/isolation の全 hash を唯一の `artifactId` に束縛する。post-PASS の source/lock 変更は正規 grant 下でも過去 B1 attestation を final variant の proof に使えず、`EVIDENCE_INVALIDATED_FOR_CURRENT` と B2-HOST-RUN BLOCKED に遷移する。旧 signed PASS は履歴として保持し falsification しない。B1 formal submitted FAIL の STOP/B0 REVOKED 規則を保持する。

#### E.8.0.1 B1 PASS と DEP_START を束縛する不可変 attestation（R11 候補）

> B1 independent `PASS_FOR(EAF_0)` は独立 reviewer/署名/全 input profile と正確な `B1_attestationId` を持つ。DEP 初回変更前の read-only preflight にだけ `B1_APPLICABLE_NOW=true` を要求する。独立 monitor が `DEP_STARTED(authorizationId,EAF_0,B1_attestationId,preflightId,trustedStartTime,preFirstWriteSequence,root)` を署名・外部 seal してから各 DEP mutation を許す。後続 operation は `DEP_PREPARE_ALLOWED` で毎回私有 stage を審査し `DEP_EDIT_ACCEPTED` で別途 commit 証明し、変更後 `B1_APPLICABLE_NOW` を継続条件にしない。B1 の旧 PASS を changed `EAF_1` に適用せず、completed DEP の root と最終 frozen EAF は改めて照合する。Trusted op monitor 不在なら DEP 操作は一件も認可不可。

### E.8.1 Plan Task 6 / B1 `RG310-SET-ACTIVATION-FENCE`（RG-310-R2-001／候補）

> B0 allowed unconnected production registry/store を対象に、①実 `setActivation` Promise を hold→同期 invalidate→古い caller resume、②read-result handler を precommit で defer→同期 invalidate→resume、③host origin spoof/epoch replay、④別 registered/verified new read positive、⑤sync authority section に await を注入する mutation と epoch check 削除 mutation の全件を temp compiled `.js` import 上で判定する。結果 `getCurrentActivation=null` / issue DENY / resolve DENY / old receipt unusable を必須にする。B1 ledger に `L_ACT`/`L_INV` 観測・exact JS graph hash・test vectors・mutant detection を残し、mock store だけの PASS、deny-all positive、source TS fallback は FAIL。B1 は Task6 source code とその compiled subset のみを証明し、actual stale read 実到着は証明しない。

### E.9 Implementation Plan Task 6 `RG310-B2-DEP` / `RG310-B2-HOST` 追補（候補）

> B1 independent PASS 後、**read-only B2 static preflight** として `package.json`/`bun.lock` の pinned baseline、固定 Senpi `ExtensionAPI` import path の source availability、B2 host event generation/source identity、entrypoint/exports registration closure を評価する。read-only preflight だけでは direct devDependency を追加した後の実 TypeScript 解決 PASS とは主張しない。host-origin の source feasibility が不明なら B2-HOST を申請せず Option C へ。依存計画が妥当なら Design/Plan へ B2-DEP exact path/change classes を追記して fresh review の後に**B0とは別の期限付き human B2-DEP authorization** を取得する。
>
>`B2-DEP`: 人間の grant が具体的に列挙した場合に限り `package.json` へ exact devDependency `@code-yeongyu/senpi: "2026.10.8"`、`bun.lock` へ必要な signed-off resolution changes を行ってよい。root exports・scripts・他 dependencies/metadata は変えない。`bun.lock` に意図しない範囲の diff があるなら STOP/re-approve。installed transitive package の存在だけでは明示契約を充足しない。
>
>`B2-HOST-PREP`: 別 human source preparation grant を用いて承認された test-only Senpi adapter/extension/transcript/secret-guard files の **Case A に必要な hunk** だけを編集できるが host 実行は禁止する。final source/lock/compiled graph を freeze し、新 independent `B1-REATTEST-FINAL` が PASS かつ human `B2-HOST-ACTIVATE` が final artifactId を署名した場合に限り、`B2-HOST-RUN` で compiled production registry を実 read tool_call/tool_result と provider error `message_end` に接続する。normal package export の `./senpi` を有効化せず、temp build/isolated mock session だけで observed callback order、read origin binding、old in-flight success after error→rejection、新 fresh matching success/issuance、late assistant/toolResult positive sanitation→append/JSONL readback、all captured receipt denial、global non-task veto/no side effects を測定する。Task1 の evaluatorや fixture の変更が要るなら別許可を取得する。
>
>**R8-FI-004 / E.9 prospective–retrospective contract (retained in R11):** 前段の B2-HOST-PREP / RA / human ACTIVATE を終えた後でも、初回 callback 実行前に actor 外の fixed Senpi public ingress structural binding capability（reused `callId` / G1/G2 / restart を混同しない完全監視）、副作用を起こさない隔離、pre-effect denial を独立に証明しなければ `HOST_RUN_START_ADMISSIBLE=UNKNOWN/BLOCKED` とする。これが H0 の必要条件であり、将来の actual result の origin positive proof ではない。H0 を満たした場合のみ限定的試行を開始し、H1 ingress ごとに不明な event を消費前拒否、H2 actual result 観測後に初めて `HOST_RESULT_ORIGIN_VERIFIED`、H3 HOST-RUN 範囲の実 positive/negative conditions・provenance・独立 seal を満たした場合だけ `HOST_RUN_EVIDENCE_ACCEPTED`。他の Task1 契約の後段 Gate PASS は H3 の事前条件ではない。H2/H3 を H0 の AND 条件へ逆流させない。H0 の実現可能性が固定 public API 上で未証明なら RUN を行わず、別人間権限と no-effect isolation を証明した別経路の独立調査か Option C とする。いずれも現時点では未承認・未実証。

> `ToolResultEventBase` にない generation を現在の session context で補っただけの証拠は受理しない。同一 G1/G2 callId 反例を publicly audited runner association または新 host-issued attempt/generation API で排除できなければ `B2=BLOCKED` とし **Option C** へエスカレーションする。mock で古い completion が観測できない場合も同様に NOT_RUNTIME_PROVEN。B2 は Task6 Step4/5 通常完了、product enable/export/deploy、Tasks3–5/7–14 の authorization を発生させない。

#### E.9.0 `RG310-B1-REATTEST-FINAL` と B2-HOST の source PREP / ACTIVATE 分離（R11 候補）

> **順序必須:** `B1 PASS(EAF_0) → B2-DEP signed HSA → exact dependency edit + lock/type/integrity review → B2-HOST-PREP signed HSA → approved limited test-only host source preparation (NO runtime) → final frozen `EAF_final` → independent B1-REATTEST-FINAL → separate human exact-artifact B2-HOST-ACTIVATE → first B2-HOST test-only execution`。PREP grant は「B2-HOST を実行する権限」ではない。B2-HOST-ACTIVATE は `EAF_final` と scope/expiryを再署名する。RA 不成立のまま ACTIVATE 発行禁止。RA source mutation/installationは禁止（使用可能な approved exact dependencies と隔離 temp build だけ）。依存取得が要れば独立 provisioning の別人間許可に戻す。
>
> **RA verification owner:** B0/B2 author/implementer、phase signer、旧 evidence creator と異なる independent B1 reattestation verifier。入力は fixed IAB/R'/D'/P', immutable `B1_PASS(EAF_0)` report, B2-DEP exact manifest/lock/type, B2-HOST-PREP approved source diff, frozen source/build closure/compiled JS dependency graph/compiler flags/test vector/mutation suite, pinned host-origin static preflight, temp output root。出力は `RA_report`: `{reattestId, previousArtifactId, finalArtifactId, inputDigests, checks, reviewer, independence, PASS|FAIL|BLOCKED, invalidationTriggers, time, excludedClaims}` の署名だけ。変更後再検証を同一 signed `EAF_final` にのみ適用。fail/欠落/不明は B2-HOST-RUN BLOCKED；安全性/スコープ違反なら即 STOP/REVOKED。許可済み追加 source/lock mutation でも RA current evidence を失効、再 freeze/re-run・人間 final confirmation を要する。人間が ACTIVATE scope を変更する場合、相応の R'/D'/P' fresh review + grant が必須。
>
> **排除条件:** source-only `ts` tests、old locked JS、old B1 report の提示、CI PASSのみ、model `M`、fake tool result、既存 `dist` や mock host の evidence を `RA_PASS_FOR(EAF_final)` と同等にしてはならない。`HOST_ORIGIN_BOUND` 無証明、compiled JS proof だけで actual `R` / production `I` を代替することも禁止。

#### E.9.0.0 HOST-RUN H0/H1/H2/H3 の証拠取得分離（R8-FI-004 継承候補）

> `HOST_RUN_START_ADMISSIBLE`（H0）は **future actual result 不要**の独立 proof of capability：固定 public API/source で全 callback の実 origin を actor 外 ingress で非偽造・完全に結合できる能力、かつ実行前の作用隔離／watchdog／fresh grant/RA/freeze を事前証明した場合だけ RUN の開始許可。静的レビューの願望・仮定・compiled `P`・人間 ACTIVATE のみは不足。
>
> `HOST_EVENT_INGRESS_ADMISSIBLE`（H1）は各実 event ごとの pre-consumption barrier。不明な G1/G2/callId は権威更新/出力/receipt/証拠前に拒否。`HOST_RESULT_ORIGIN_VERIFIED`（H2）は real result 到着後の生成元の immutable binding + invalidation/order 実観測。`HOST_RUN_EVIDENCE_ACCEPTED`（H3）は独立 sealed trace + HOST-RUN 範囲の既存 INV positive/negative controls への合致（Task1 evaluator 全体 PASS は不要）。H2/H3 を H0 の前提にすると循環するため禁止。`R` は actual old success arrival/rejection、`P` は compiled、`I` は別の後段 production として非代替。
>
> H0 の actor 外監視・固定 API capability が実証できない場合は `NO HOST RUN / BLOCKED+STOP`。別の read-only feasibility 調査のみ無許可 host effects なしで可能。live diagnostic は別の独立 review / human scoped HSA / 完全な no-effect isolation / ingress enforcement が先に必要で、既存の blocked HOST RUN に偽装不可。該当 route が不存在なら人間 Option C、上流 pin が変われば再承認と fresh証拠。unknown origin から authority/receipt/evidence を発行しない。

#### E.9.0.1 DEP continuation と final phase/freeze seal（R11 継承 R8 FI-001 候補）

> `DEP_START_REQUEST` は最初の B2-DEP **private stage より前**だけに B1 current EAF0 と独立 `DEP_STARTED` 封印を要求する。以後の合法 DEP edits は旧 B1 current を再要求せず、**各操作**で `DEP_PREPARE_ALLOWED`（新しい signed grant/trusted preRoot/actor/phase/branch/scope/期限/失効・隔離）→ stage → `DEP_EDIT_ACCEPTED`（実際の changed hunks/EAF1,EAF2/commit 時再検証・原子的証拠受理公開）を証明する。`START_ADMISSIBLE` は将来 delta の検証を要求しない。stage failure/期限跨ぎは無影響 `OP_ABORTED`、crash/recorder gap/不確定 publish は `IN_DOUBT` で STOP、実 bypass proven は REVOKED。`PHASE_COMPLETE` は ACCEPTED/ABORTED 全予約が連続し trusted authoritative final root に一致して初めて成立する。
>
> DEP package/lock/type/integrity、PREP exact test-only source hunks と HOST count0 の独立確認後だけ full source+lock+compiler JS+profile を freeze。凍結時に phase fence を閉じる。追加合法差分が必要なら freeze 済み同 attempt を edit せず、新 attemptIndex/必要な新 human HSA で書込前に旧 freeze/RA/exact ACTIVATE を失効。`RA_PASS_FOR(EAF_final)` と別人間 `HUMAN_HOST_ACTIVATE_VALID` があっても `HOST_ORIGIN_BOUND` の固定 Senpi actual proof なければ HOST STOP。Task1 実 `R` と後続 production `I`、B1 compiled `P` は代替不可。

### E.9.1 Plan Task 1 / B2-HOST `RG310-PERSISTENCE-SAFETY`（RG-310-R2-002／候補）

> Case A で少なくとも実 token-positive late assistant と token-positive late toolResult を、それぞれ actual Senpi `message_end` に入れ、original→sanitized replacement（same-role, exact identity）→`entry_appended`→canonical SessionManager/JSONL immediate readback の整合を独立検証する。Case B は Justice sanitizer bounded fault と exact same-role minimal fallback を別ケースで検証する。failure-retired inventory 欠損、scanner failure、key collision、raw writer resurrection、fallback failure は発行拒否だけで PASS とせず BLOCKED/STOP。新しい fixture/evaluator 変更、messageId 契約変更をこの scoped proposal から認可しない。actual append 停止保証が host にないなら Option C。B1 に `PERSISTENCE_SAFE` を付与しない。

### E.9.2 Plan Task1/B2-HOST/Task6 の後続 dependency と証拠採否境界（RG-310-R3-001／候補）

> B2-HOST は実 Senpi host callback と **既存 production implementation から生成した compiled guard の限定テスト配線**について、観測した callback origin/order・旧 read actual success→post-invalidation reject・fresh read・assistant/toolResult sanitize→canonical append/readback の個別証拠だけを主張できる。Task5 全実装、Task6 正式 production export/integration、通常 Tasks2–14 acceptance は一切証明しない。B2-HOST 結果が Task1 既存 acceptance の CaseA 等の正規 predicate に対応する場合は Task1 Gate owner が独立して入力として審査する。対応しない B2 独自の compiled/runtime-integration assertion は Task1 evaluator の別項目として追加しない。
>
> `B3-T1` の通常審査は full Task6 より前に存在しなければならず、Task1 が元の evaluator で PROVEN となったのちのみ full Task6 production work の通常人間 authorization を求められる。Task6 完成と Task1 completion を互いの必要条件にしてはならない。Task1 が実 host で必要な race を証明できない限り BLOCKED、B2 source-origin が固定 public API で証明不能なら Option C を人間に提示する。最終製品の追加横断 `RG310-PRODUCT-READINESS` は未採択別案であり、B-001/B-002 を Task1 に黙示挿入しない。

### E.10 改訂順序・変更 ID・他 tracks の非干渉

| 順番 | 候補改訂 | 現行契約との差分 | 必須 owner・approval |
|---|---|---|---|
| 1 | `JUS5-HARNESS-03` 追補・新 `HARNESS-05` | old race の runtime 最終証明を維持しつつ B0/B1/B2 を **別種の中間権限**として追加 | Requirements owner |
| 1 | `JUS5-AUTH-02/04/06/07/08` 追補・新 `AUTH-10` | exact chain/time/scope/hunk/stop/revocation | Requirements owner |
| 1 | `JUS5-ACC-02`, `JUS5-COMPLETE-01` 追補 | **既存 Task1 evaluator を不変に保ち**中間 B1/B2、Task1 Gate、full Task6、最終製品 Gate を分離。新 product-readiness Gate は未採択の別案 | Requirements owner / Plan・product Gate owner（別途採択時） |
| 2 | Design §7.5.1 | origin trust tiers、4 states、host binding、partial failure、B1 subset | Design owner |
| 2 | Design §7.5.2/7.5.3 | synchronous setActivation linearization と independent persistence sanitation | Design owner |
| 3 | Plan Task1/2/6 | B0 build, B1 compiled import, B2 deps, expected RED、host STOP、scope | Plan owner |
| 3 | Plan E.8.1/E.9.1/E.9.2 | B1 async race controls + B2 actual late role-positive append controls と **B3-T1→full Task6 の一方向依存** | Plan owner |
| 4 | exact R'→D'→P' independent review | conflicts and drift detection | 新規独立レビュアー |
| 5 | Human ADR | Option A/B/C 意思決定、B の有限リスク採否 | 人間の Architecture Decision 担当 |
| 6 | Human B0 scoped authorization | 実際の権限発行、source/tree/path/actor/date binding | 人間の plan authorization 担当 |
| 7 | B1 と別 Human B2 | 次段階は B1 independent PASS + **別** approved B2 chain | B1 reviewer → R/D/P owner → human B2 signer |

`RG-310-B-001=BLOCKED`, `RG-310-B-002=NOT_PROVEN` は本案では一切修正しない。unknown-tool identity、positive removal、canonical 32 の分母／既存 Task1 evaluator は保持する。別 `RG310-PRODUCT-READINESS` を正式に導入するかは将来の独立した Requirements/Plan・Gate owner/human decision に委ねる。

## F. Evidence / Acceptance Matrix — INV-A01〜A14 全件（R11 Gate別述語＋fingerprint条件）

**Gate 別判定規則（RG-310-R4-001 の最小修正）:** `R`=pinned actual Task1 runtime/fixture/protocol evidence、`I`=pinned runtime に実配線された production-bound integration evidence、`P`=実 compiled production guard evidence、`M`=isolated model、`S`=pinned source。`R`、`I`、`P`、`M`、`S` は相互非代替である。旧表の `R/I`・`R+I`・`R/I/P` は**Task1 Gate の AND も OR も意味しない**。各列は別の審査主体による独立した証拠義務を示す。個々の INV は安全性の同じ意味を保存するが、Gate が要求する立証レベルは異なる。

- **Task1 Gate (R):** `evaluateTask1Acceptance()` の現行 canonical32/CaseA/CaseB/requiredRuntimeEvidence/mandatorySafety を厳密に維持する。以下の `R` 欄は既存 predicate を具体化するだけで、**追加の Task1 条件や新しい分母・判定器を作らない**。必要な `R` が欠ければ、既存 Gate の規則に従い BLOCKED。
- **B1 (P):** compiled transition N1–N4/P1–P2 等の subset conformance は**補助独立判定**。Task1 の `R` や production の `I` の代理にはならない。
- **B2-HOST / 後続 production assurance (I):** test-only B2-HOST は許可された場合だけ実 integration を実測できる。最終 product/production safety では production-bound guard での実 old success rejection と実 persistence safety の `I` を必須とする。ただし最終保証を **Task1 の入力へ逆流させない**。B2 部分テストの PASS は full Task6 や product acceptance の十分条件ではない。
- **Owner:** 下記は将来の責任候補であり未任命。各結果は `{gate, invariant, evidenceType, sourceRef, identityJoin, verifier, verdict}` を別に記録し、一つの PASS を他 Gate の PASS として転記しない。

| INV | 保存する保証 | Task1 existing Gate: `R` predicate | B2/production assurance: `I` predicate（Task1 の**新しい**必須条件ではない） | 必須 negative control | Owner（提案）/ Gate consequence |
|---|---|---|---|---|---|
| A01 | Provider error revokes live capability | actual error→message_end→同一 session live capability invalid、旧権限拒否 `R` | pinned host と production-bound guard の同期失効・発行拒否 `I`；compiled subset `P` 別判定 | post-error `issue(old)` | Task1 evidence / Task6 registry。欠落 Gate 別 BLOCKED、unsafe issuance STOP |
| A02 | All candidate receipts invalidated | 正に捕捉した receipt > 0、全 exact receipt 失効と replay 拒否 `R` | guard に登録された全 exact receipt を同期失効・拒否 `I`、`P` は補助 | 1件残存、空集合 PASS | Task1 / Task6。1件でも残れば該当 Gate BLOCKED/STOP |
| A03 | WorkflowActivationEvidence invalidated | 同一 auth/session の current activation→null `R` | production store と registry の同期 invalidate、旧 snapshot deny `I`、`P` 補助 | stale activation still current | Task1 / Task6 store。R 欠落は既存判定、I 欠落は integration 側 BLOCKED |
| A04 | Durable method selection preserved | 同一 durable session で selected method が failure 後も保持 `R` | production integration 観測対象なら method preserve を別立証 `I`（Task1 条件を拡張しない） | 新 session と同一視、selection 消去 | Task1 session / Task6。R 欠落なら CaseA BLOCKED |
| A05 | Old receipt replay rejected | 捕捉済み exact receipt と stripped args の replay denial `R` | production-bound guard exact replay denial `I`、`P` は補助 | digest/session mismatch bypass | Task1 / Task6。replay accepted なら STOP |
| A06 | Cached activation cannot restore | actual post-error cached `issue(old)` 拒否を既存 Task1 protocol で実証 `R` | production guard が stale cached snapshot/reissue を拒否 `I`。compiled `P` は独立補助 | stale snapshot issuance | Task1 / Task6。R 欠損→CaseA/Task1 既存判定、I 欠損→B2/product assurance BLOCKED |
| A07 | Pre-invalidation read cannot issue after error | **旧 read N を error N+1 前に実開始し、失効後に actual old success が届き、既存 Task1 fixture/protocol が old authority を拒否した事実を host-origin identity と共に立証 `R`**。`I` を Task1 の必須 AND にしない | **同じ意味の actual stale success delivery を production-bound guard に実配線して観測し、その old result からの再認可/issuance を拒否 `I`**。最終製品の必須 proof。`P`/`M` 代用不可 | G1/G2 reused ID、old success never delivered、stale result accepted、mixed generation | Task1 Gate owner / Task6 product owner / independent reviewer。R 不在→CaseA/Task1 BLOCKED。I 不在→product/production assurance BLOCKED（R 成立だけで product PASS 禁止） |
| A08 | Fresh selected-method read only | 新 actual call N+1 の exact successful selected-method read と current identity を実証 `R` | production guard が new read 登録/consume/activation の current origin, method, epoch を立証 `I` | stale cached/history、wrong method | Task1 / Task6。R は既存 CaseA 判定、I は B2/product 側判定 |
| A09 | Failure-retired tokens sanitation-only | shutdown/restart まで failure-retired inventory により sanitation-only を実観測 `R` | production session/append seam と registry の retired inventory 維持 `I` | token revives/premature clear | Task1 / Task6。authority再付与・漏洩 STOP |
| A10 | Late assistant/toolResult token-free before append | **各** late assistant と toolResult で raw token-positive→actual sanitizer changed→matching entry_appended→immediate canonical JSONL token-free readback `R` | 同じ positive removal/identity join を production-bound persistence path で立証 `I`。`P` guard denial のみは代替不可 | pre-token absent、no actual append、wrong ID | Task1 transcript / Task6 append。R 欠落→既存 CaseA/safety 判定、I 欠落→production assurance BLOCKED |
| A11 | Failed call no trusted provenance/execution | exact failed call の trusted task/child/side effect 不在を実立証 `R` | production integration でも side effect/provenance なし `I`。`S` は限定補助 | `finishTurn`/providerResults を local dispatch と混同 | Task1 / Task6 provenance。side effect STOP |
| A12 | Session/history/logs/evidence token-free | actual SessionManager/JSONL/log/evidence の同一 identity・append 時点・各分岐 token-free を実検査 `R` | production-bound storage/log/append の同一分岐と raw bytes を別確認 `I` | leak sentinel scanner が異常を検出しない、identity mismatch | Task1 storage / Task6 persistence。R 欠落→既存 safety BLOCKED、I 欠落→production assurance BLOCKED、漏洩 STOP |
| A13 | Case A and B independently proven | provider stream error A / sanitizer-failure B の各実 event・normal vs same-role fallback を別々に証明 `R` | integration claims も A/B をそれぞれ評価 `I`、Task1 `R` を置換不可 | B proof reused to pass A | Task1 evaluator / independent reviewer。混同 BLOCKED |
| A14 | Missing/unproven blocks acceptance | 現行 Task1 required predicates/evidence ledger に欠落があれば既存 evaluator で BLOCKED `R` | production-required `I`・full Task6・独立採択済 product Gate に欠落があればその Gate を BLOCKED | missing proof を消して PASS | Requirements / Gate reviewer。各 Gate の未証明は該当 Gate のみ BLOCKED；実害 STOP |

### F.0.1 INV-A07 の反例と独立述語（R4 Finding の決着対象）

```text
TASK1_A07_R := ACTUAL_OLD_READ_STARTED_BEFORE_INVALIDATION
              AND ACTUAL_OLD_SUCCESS_DELIVERED_AFTER_INVALIDATION
              AND TASK1_PROTOCOL_REJECTED_OLD_AUTHORITY
              AND VERIFIED_ACTUAL_ORIGIN_AND_IDENTITY
PRODUCTION_A07_I := ACTUAL_OLD_SUCCESS_DELIVERED_IN_PINNED_INTEGRATION
                    AND PRODUCTION_BOUND_GUARD_REJECTED_OLD_RESULT
                    AND VERIFIED_GUARD_ORIGIN_AND_IDENTITY

TASK1_EXISTING_ACCEPTANCE := existing evaluateTask1Acceptance() only
# Does NOT add PRODUCTION_A07_I, B1_PASS, B2_PASS or FULL_TASK6_ACCEPTANCE.
FINAL_PRODUCTION_ASSURANCE := required production predicates including
                              PRODUCTION_A07_I and actual persistence safety
# Is downstream; does not rewrite Task1 Gate or equal full Task6 acceptance.
```

**仮想反例（現在の実測状態ではない）:** canonical32/32、CaseA `R` を含め PROVEN、CaseB PROVEN、required runtime+safety PASS、B2-HOST NOT_AUTHORIZED、`PRODUCTION_A07_I=NOT_PROVEN`。この場合 **Task1=PASS**（既存 evaluator）、**production assurance/product=BLOCKED**。逆に `I=PASS` でも Task1 の欠損 `R`・canonical identity を補えない。**R4 F-A07 の `R+I` 必須 AND 解釈は禁止**。`R OR I` という証拠代替も禁止する。

**B1/INV の補助境界:** A01/02/03/05/06/07/08/09 の compiled subset `P` は D.6.1 の N/P tests で独立立証。A07 `L_INV` より古い Promise/old pending read を compiled で拒否できても actual old success arriving に対する `R`/`I` の代理にはならない。A10/A12/A13 は actual raw token-positive→changed→identity-correlated append/JSONL が必要であり、pure guard 拒否では代替できない。INV-A01〜A14 の番号・安全性保証・negative controls は削除しない。`RG-310-B-001/002` は Task1 の新条件ではない。

### F.0.2 `IAB/AMIO/EAF/operation-stage/IRA` Gate consequences — R11 正規候補（未採択）

新しい候補 predicate は **prospective** `OP_PREPARE_ALLOWED: START_ADMISSIBLE`, durable `OP_PREPARED`, private staging、**retrospective** `OP_COMMIT_ACCEPTED`, `OP_ABORTED`, `ACCEPTED_DELTA`, `PHASE_COMPLETE` の異なる型を持つ。`B0_PREPARE_ALLOWED/B0_EDIT_ACCEPTED`, `DEP_START_REQUEST/DEP_STARTED/DEP_PREPARE_ALLOWED/DEP_EDIT_ACCEPTED`, `HOST_PREPARE_ALLOWED/HOST_PREP_EDIT_ACCEPTED` を他の B1/DEP/PREP/RA/HOST/HSA/EAF predicates と別に維持する。**現行 R11 候補の唯一の source of truth** は `04-authorization-fingerprint-transition-matrix-R11.md` §§1–7であり、R6/R7旧版の operative matrix を復活させない。実 `TRUSTED_OP_BOUNDARY_PROVEN` が UNPROVEN の現在はいかなる PREPARE/COMMIT/HOST も **NOT_AUTHORIZED**。

`B1_PASS_FOR(EAF_0)`, `RA_PASS_FOR(EAF_final)` は compiled/static subset `P` の独立 exact-evidence claim であり、Task1 read `R` および product/production `I` の代替ではない。B1→DEP 初回 latch、DEP continuation に B1 current 逆辺無し、final EAF current/RA/ACTIVATE/origin を保持。既存 Task1 evaluator に P/I/PRODUCT/B3 を必須追加しない。旧 signed PASS は `PASS_FOR(EAF_old)` の歴史であり、現行 EAF と一致しなければ `EVIDENCE_INVALIDATED_FOR_CURRENT` のみ。

### F.0.3 Trust failures, grants and evidence applicability（R11 継承 R8 限定追補）

独立 monitor の証拠・clock/revocation/seq/transactional accept+publish proof がない場合 `OP_PREPARE_ALLOWED=UNKNOWN/BLOCKED+STOP`、commit 後 root の不明・crash・recorder gap は `IN_DOUBT` で QUARANTINE/STOP、実際に独立証明された scope/safety bypass は `REVOKED+STOP`（B1 submitted formal FAIL の別特則を除く）。`START_ADMISSIBLE` は BEFORE STATE のみ、`ACCEPTED_DELTA` は historical independently durable after-state のみ参照し、相互に変換不能。合法 AMIO mutation は signed IAB を変えず、EAF current 証拠のみ invalidate、`PHASE_COMPLETE` は gap-free accepted/aborted finality と actual authoritative root の一致のみ。過去 `CLOSED/EXPIRED` は historical validity と両立するが新 operation に使えない。freeze後の合法 re-edit は **higher attempt+new authorized phase** にしか到達しない。§04 §5 の旧38 ID対応 **7評価観点**と §6 の temporal/rank DAG を normative source にする。

### F.1 Gate ごとの部分証拠の境界

| Gate | 立証可能な positive claim | 未証明として残すもの | 偽陽性を抑止する negative control |
|---|---|---|---|
| B0 | なし（限定開発権限だけ） | runtime、production compiled conformance、受入全件 | タスク／ファイル/branch/expiry/禁止操作 mismatch→STOP |
| B1 | compiled production registry/store の state transition subset（A01/02/03/05/06/07/08/09 の **モデル化された分岐の一部**） | actual origin, host callback ordering, executable-copy sanitation, runtime persistence、actual race | exact `.js` import、source fallback/lock drift fail、stale-result mutant detected、partial receipt survivor |
| B2 | 実 Senpi callback + compiled guard で肯定的に観測した個別命題だけ | observed でない CaseA continuation、unknown-tool separate track、通常製品 Task6 全体 | G1/G2 reused callId、raw token-positive late result、wrong JSONL join、unregistered attempt、real non-task side-effect |
| B3 | **Task1 既存 Gate へ証拠提出する B3-T1** と、full Task6 後の **製品側 B3-PRODUCT** の各再審査請求 | Task1 完了は既存 evaluator、full Task6 は後段、TaskAccepted/PlanComplete は各正規 Gate に限る | Task1 canonical/CaseA/B/runtime/safety 欠損→Task1 BLOCKED。B-001/B-002 は Task1 と独立 |

**INV-A07 の読み方:** B1 で synthetic old result を拒否しても `P` のみ。G1/G2 result-origin を fixed Senpi で実証できず `ORIGIN_UNPROVEN` と拒否できたことは安全側の実装方針を示すが、「実際に古い success が到着して拒否された」という Task1 の Positive Proof の代替にならない。

### F.2 Canonical identity と別 positive token removal（RG-310-R2-003）

| Evidence predicate | Contract set | 必要観測 | 未取得の意味 | Owner / Gate consequence |
|---|---|---|---|---|
| `CANONICAL_UNKNOWN_TOOL_EXACT_IDENTITY` | 既存 canonical 32 の **唯一の BLOCKED 1件**（分母不変） | actual unknown-tool `message_end` `sessionId + toolCallId + non-null messageId` と `entry_appended`/JSONL 同一 identity join、token-free/readback/no execution | messageId が pre/post `null` のため `31/32 PROVEN` | Task1 Evidence/evaluator owner。`32/32` にならず Task1 BLOCKED |
| `B002_POSITIVE_SYNTHETIC_TOKEN_REMOVAL` | **分母外** `RG-310-B-002` | token-present synthetic toolResult before→actual sanitizer modifies it→token-absent after→matching actual append/JSONL | 初期 token-free input は positive removal なし。`NOT_PROVEN` | 独立 B-002 evidence owner + fresh reviewer。Task1 evaluator に影響なし。未採択の製品横断 Gate は separate review; 現状の製品 enable は禁止 |
| `B001_FIXTURE_ONLY` | **分母外** `RG-310-B-001` | 固有 fixture-only acceptance（別 track） | `BLOCKED` | B-001 owner。Task1 evaluator に影響なし。独立の製品 readiness track で要審査 |

この分離は R5 の規範提案上の会計説明であり、既存 evaluator、exact `messageId` 述語、canonical denominator に一文字も変更を求めない。R5 E.4 の boolean 受入表を優先し、B001/002 を Task1 PROVEN 条件へ逆流させない。

### F.3 Acceptance boundary truth table（RG-310-R3-001 / R3-002）

この表は新しい `evaluateTask1Acceptance()` の実装指示ではなく、**既存 evaluator の意味を固定して他の Gate と区別するための候補規範**である。

| Gate / predicate | 必須 input（AND） | 明示的に input **でない**もの | 権限ある判定者 / 現在 |
|---|---|---|---|
| `TASK1_EXISTING_ACCEPTANCE` | 現行 canonical 32/32、CaseA、CaseB、required runtime evidence、mandatory safety（現行 evaluator 一致） | B0/B1/B2 PASS、**full Task6 acceptance**、**B001/B002 closure** | Task1 Evidence/Gate owner。`BLOCKED`（31/32 & CaseA BLOCKED） |
| `B1_COMPILED_TRANSITION` | isolation, actual compiled `.js` subset N1–N4/P1–P2, hash/mutation, independent review | actual Senpi origin/CaseA、Task1 PROVEN、B002 | 独立 B1 reviewer。`NOT_PROVEN` |
| `B2_HOST_LIMITED_EVIDENCE` | 別 B2-DEP/B2-HOST grants、pinned host callbacks、origin identity、test-only guards、observed per-contract evidence | full Task6 integration/export、Task1 automatic PROVEN | B2 actual-evidence reviewer。`NOT_AUTHORIZED / NOT_PROVEN` |
| `FULL_TASK6_ACCEPTANCE` | Task1 既存 Gate PROVEN → normal exact-chain human task grants/Task5 dependency → whole production Task6 implementation + conformance | B2 limited PASS だけ、B0/compiled B1 だけ | 通常 Task6 Gate/human approval。`NOT_AUTHORIZED` |
| `RG310-PRODUCT-READINESS`（候補） | 新規採択後に別規範として列挙する B001/B002 positive proof + 横断 safety findings | Task1 evaluator の自動拡張、既存 Gate の黙示変更 | Requirements+Plan/product Gate owner、専用 evaluator owner、人間。`PROPOSED_NOT_ADOPTED` |
| Existing PlanComplete/product enable | 現行の全必須 task/conformance/quality/authorization/safety と zero missing evidence | 上の未採択新 Gate だけを既存要件とみなすこと、runtime waiver | 既存 PlanComplete/product Gate。現状 `BLOCKED / NOT_AUTHORIZED` |

**仮想正例（R3-002 negative-control against overrestriction）:** canonical32/32、CaseA/B PROVEN、required runtime/safety PASS、B002 NOT_PROVEN、full Task6 未完成であれば **Task1 existing evaluator は PASS**。この仮想条件は現時点の `Task1 BLOCKED` を変えない。B002 は別 safety track で依然 `NOT_PROVEN`、最終製品/横断 Gate は独立審査を要する。

**追加の仮想正例（R4-001 matrix control）:** canonical32/32・CaseA/A07 `R` PROVEN・CaseB PROVEN・runtime/safety PASS、B2-HOST 未認可、production `I` 未実証であっても **Task1 existing evaluator は PASS**。final production assurance は I 不足により BLOCKED。逆に I のみ PASS では Task1 欠損を補えない。

**仮想負例（R3-001 dependency control）:** `B1 PASS & B2-HOST evidence present & Task1 CaseA BLOCKED` なら Task1 は BLOCKED、full Task6 は開始できない。`Task1 existing evaluator PASS & B2-HOST test-only PASS & full Task6 NOT_AUTHORIZED` なら Task1 の正規 PASS は妨げられないが full Task6/product 完了は発行されない。**R2-001/002 compiled/security の独立 positive controls はこの gate 分離でも全て要求したまま**である。

#### F.3.1 Authorization / reattestation gate consequences — R11 retained FI-001 typed correction

| Gate/step | Required verifiable AND inputs | Fail-closed | Human/independent owner |
|---|---|---|---|
| `OP_PREPARE_ALLOWED / OP_PREPARED` | exact signed IAB/HSA & authorized intent/current trusted preRoot + independent actor/clock/monitor/revocation freshness + exclusive writer fence/private stage + independent reserved sequence and preflight seal (no future afterRoot) | UNKNOWN/BLOCKED before all writes if boundary unproven; legal DENIED stage not automatic revoke | Human phase signer and independent reference monitor |
| `OP_COMMIT_ACCEPTED / ACCEPTED_DELTA` | real measured staged changed hunks/afterRoot + commit-instant valid grant/scope/safety/seq/continuity + single atomic durable accepted evidence AND authoritative publish | ABORT if provable no effect; `IN_DOUBT`/quarantine/STOP if unknown; actual bypass proven REVOKED | independent monitor/recorder, not actor |
| `OP_ABORTED / PHASE_COMPLETE` | independent abort tombstone for each rejected reservation; no pending/IN_DOUBT, gap-free accepted+aborted history and independent authoritative finalRoot/phase seal | Missing/gapped proof BLOCKED, no silent drop or reauthorization | independent recorder/phase verifier |
| `B0_PREPARE_ALLOWED / B0_EDIT_ACCEPTED` | scoped current B0 HSA + correct prospective preparation AND retrospective atomic acceptance for each operation | B0 never gets automatic extra scope; actual violation proven REVOKED | Human B0 signer / monitor |
| `B1_PASS_FOR(EAF_0)` | actual emitted JS/lock/graph/test/mutation negative/positive exact EAF and independent PASS | submitted formal FAIL B0_REVOKED; legitimate later edit EAF evidence historical only | independent B1 reviewer |
| `DEP_STARTED / DEP_PREPARE_ALLOWED / DEP_EDIT_ACCEPTED` | exact initial B1 EAF0 independent PASS + start-only preflight/latch sealed **before first stage**; each later DEP op new prepare + atomic accepted delta; never B1_APPLICABLE_NOW after lock edit | no latch/monitor STOP; legit lock edit EI, not grant revoke; actual bypass revoke | Separate human DEP signer and independent DEP verifier |
| `HOST_PREPARE_ALLOWED / HOST_PREP_EDIT_ACCEPTED` | exact sealed DEP completion + separate PREP HSA + staged test-only source diff + atomic evidence publication; zero host runtime | missing scope STOP; proven early execution REVOKED | human PREP signer and monitor |
| `FINAL_FROZEN / RA_PASS_FOR(EAF_final)` | resolved/closed complete operations + separate final freeze no-writes + independent read-only fresh compiled/mutants/type/graph and final EAF signature | RA FAIL/UNKNOWN HOST BLOCKED, not auto revoke | independent RA reviewer |
| `HUMAN_HOST_ACTIVATE_VALID / HOST_RUN_START_ADMISSIBLE / HOST_RESULT_ORIGIN_VERIFIED / HOST_RUN_EVIDENCE_ACCEPTED` | H0 requires exact human EAF_final/RA HSA, fresh freeze, independently proven fixed ingress binding capability + pre-effect/no-effects isolation; H1/H2 actual event and immutable source proof; H3 independently sealed real positive-controls | H0 unproven NO RUN/STOP; unknown H1/H2 NO_ISSUANCE/NO_EVIDENCE; no future result as H0 input; no production grant | Separate human HOST signer + monitor |
| `TASK1_EXISTING_ACCEPTANCE` | existing exact 32 contracts/CaseA/CaseB/runtime/safety evaluator only | current 31/32, CaseA BLOCKED; never P/I/B3 mandatory | existing Task1 Gate owner |
| `FULL_TASK6_ACCEPTANCE / PRODUCT` | Task1 existing PASS→normal Tasks2–6 including Task5→full Task6; independently required production I and safety | no reverse task dependency, no product enable from B2 | normal human owners / separate product Gate |

#### F.3.2 R11 cross-gate safety result (not evaluator input)

`DEP_STARTED` は gate event の歴史的前提証拠。`DEP_PREPARE_ALLOWED` は未来 afterRoot 不要の準備許可、`DEP_EDIT_ACCEPTED` は正確な事後 atomic delta、`PHASE_COMPLETE` は独立 seal された履歴の閉鎖、`B1/RA PASS_FOR(EAF)` は **exact version** の評価、`HUMAN_HOST_ACTIVATE_VALID` は別 human run authorization。HOST 開始は prospective `HOST_RUN_START_ADMISSIBLE` のみ、後から届く実 result の `HOST_RESULT_ORIGIN_VERIFIED` と `HOST_RUN_EVIDENCE_ACCEPTED` は retrospective であり開始の先行入力にしない。H0 能力不在なら RUN STOP、H2 不明なら NO_ISSUANCE/NO_EVIDENCE。これらを同一 boolean にまとめない。根拠未知・不整合ならその操作/host Gate `BLOCKED/STOP`。B1 formal FAIL の特例 revoke、B0 TDD expected RED、B2 RA_FAIL の相違は維持。`R` と `I` を Task1 evaluator に AND/OR 追加せず、full Task6→Task1 逆依存も禁止。

## G. Finding Closure / Residual Risk Register

| Finding | 解消の必要十分条件（候補） | 必要証拠と責任候補 | Gate への影響 / 現況 |
|---|---|---|---|
| `RG-310-DR-001` Major | same durable session に旧 epoch で開始した実 read が error/epoch increment 後に成功し、その結果が authority/issuance/provenance を発生させないことを actual production-bound guard で観測 | pinned host event join・read attempt ID・epoch・deny・JSONL、Task1 evidence owner／Task6 owner／fresh independent review | `NOT_RUNTIME_PROVEN`。B1 PASS **だけでは未解消**。最終受入 BLOCKED |
| `RG-310-DR-002` Major | prior R'→D'→P' 改訂と fresh review、人間の exact B0 scoped authorization、B1 compiled real guard/parity、FAIL revoke が確立 | Requirements owner→Design/Plan owner→Human→B1 independent reviewer | B0 **承認前未解消**、Task2/6 NOT_AUTHORIZED。B0 後も full Task は未認可 |
| `RG-310-DR-003` Moderate | D.5 の登録/epoch/linearization/duplicate/unknown/order/restart 保証を規範採択し actual compiled guard test 全 PASS | Design owner／Task2+6 scope executor／B1 reviewer | B1 の必要条件。未完は B1 FAIL/BLOCKED |
| `RG-310-DR-004` Moderate | same durable JSONL identity の multi-turn continuation、cached reissue deny、fresh read、late assistant/toolResult raw-positive removal→canonical append immediate readback | Task1 evidence recovery owner と独立検証 | 実測まで Case A BLOCKED、B2未完。fixture cursor 修正だけでは解消しない |

### G.0.1 R2 新3 Findings の未承認 closure register

| Finding / severity | Counterexample と最小修正条件 | Evidence / owner | Current / Gate consequence |
|---|---|---|---|
| `RG-310-R2-001` Major | `setActivation(N)` pending→invalidate e+1→旧 state write back。D.6.1/E.5.2 の単一 owner `L_ACT`/`L_INV`、no await authority commit、private fence、issue/resolve deny と N/P tests | Task2 interface owner / Task6 guard author / B1 independent reviewer。`COMPILED` N1–N4 P1–P2、actual host separately | `RESOLVED_IN_PROPOSAL` (R3 technical)、B1未実行。成立しなければ B1 FAILED/BLOCKED、B2 不可、Option C/再設計 |
| `RG-310-R2-002` Moderate | authority disabled でも token inventory lost→late raw append。独立 `PERSISTENCE_SAFE`、retired stock、exact same-role fallback、actual assistant/toolResult append/JSONL | Design/Task6 sanitation owner、B2 actual-runtime evidence owner、Task1 storage evidence owner、fresh reviewer | `RESOLVED_IN_PROPOSAL` (R3 technical)、Case A/B2 未証明。fallback 未実証なら UNSUPPORTED/BLOCKED・product STOP |
| `RG-310-R2-003` Minor | identity が null の canonical 1件と B-002 の initial-token-free false positive を合算。両 ledger を分離し32 denominator/evaluator不変 | Task1 evaluator/unknown-tool owner、別 B-002 evidence owner、fresh reviewer | `R3_PARTIAL → R4_RESOLVED_IN_PROPOSAL (technical review)`。canonical 31/32、B002 NOT_PROVEN。Task1 evaluator は別 track を加えない |

未実証の `RG-310-DR-001..004` は独立証拠成立まで全件 `OPEN`。R2 の AR-003 `PARTIAL` は async synchronization 問題が解決されていない限り提案上も確定閉鎖ではない。

### G.0.2 R3 Technical Findings（R4 技術レビュー後の status）

| Finding | Severity / source anchor | 反例 / R4 最小修正 | 必要証拠・未実証・owner | Gate consequence |
|---|---|---|---|---|
| `RG-310-R3-001` | Major; R3 E.4 L465–469 / D.1–3 / E.9 / Approved Plan Task1/6 | Task1 requires full Task6→full Task6 requires Task1 の循環。R4 D.2, E.4/E.9.2 と R5 F.3 は Task1 existing evaluator → usual Tasks2–6 human authorization → full Task6 → product の一方向辺だけを許す。B2-HOST は limited test-only | Requirements/Architecture/Plan owner と Task1/Task6 Gate owner。現行 evaluator は既存のまま。将来 B2 evidence と Task1 actual proof は未実証 | `PARTIAL` (R4 technical review)。R5 fresh review が R4-001 と共に再評価。B0 未認可、full Task6 NOT_AUTHORIZED |
| `RG-310-R3-002` | Moderate; R3 E.4 L465–469 / F.2 / G.4 / Evidence final evaluator | canonical 32/CaseA/B/runtime/safety PASS, B002 NOT_PROVEN なのに R3 Task1 BLOCKED とする矛盾。R4 E.4.1/F.3 で B001/B002 を Task1 gate から除外し、R5 でも維持し別 proposed product-readiness review に分離 | Requirements owner、Task1 evaluator owner は分母/判定器不変を保証。B001/B002 separate evidence owner。新 product Gate 採択には Plan/Gate/evaluator owner & fresh human approval。positive removal 未実証 | `RESOLVED_IN_PROPOSAL` (R4 technical review)。B-001 BLOCKED/B-002 NOT_PROVEN は維持。新 Gate `PROPOSED_NOT_ADOPTED` |

**文面の closure** と **actual compiled/runtime PASS** は別である。R3-001/R4-001 の終了を R5 Author が自己宣言しない。DR-001..004 OPEN と AR-001..005 非退行を維持する。


### G.0.3 R4 技術レビュー新 Finding — R5 closure candidate（**未承認**）

| Finding | Severity / R4 source anchor | 反例・最小修正と R5 source anchors | 後続証拠 / owner / Gate consequence |
|---|---|---|---|
| `RG-310-R4-001` | **Major**、R4 E.4 L476–486、E.6 L516–520、F L590・L599–601、F.3 L630–645 | R4 F-A07 `R+I` が Task1 必須 AND と読め、既存 evaluator は R のみで PASS し得るという矛盾。R5 E.4(R/I non-backflow)、E.6 addendum、F matrix 全14行、F.0.1・F.3 の非逆流反例と、I/J の独立レビュー指示で修正。**R は Task1、I は後続 production assurance。Task1 の新規入力を増やさず、最終 I は免除しない** | Task1 Gate owner、Task6 owner、Requirements owner、Acceptance Matrix owner、fresh independent R5 Architecture Reviewer。提案上 closure は独立判定待ち。R 不足→Case A/Task1 BLOCKED、I 不足→product/production BLOCKED。B0 は未認可 |

R4 technical review は R3-001 を `PARTIAL`、R3-002 および R2-001/002/003 を `RESOLVED_IN_PROPOSAL` と評価した。当時の R5 作成者はその既評価を実証済みに昇格していなかった。R3/R4 が同一会話の技術再審査であったため、**当時の R5 review request は別セッションによる fresh review を要求していた**。R5 review原本は未提供であり、その要求が署名・正式権限つきで完了したとの主張はしない。**R8文書作成当時の審査対象は R8 だった**という履歴上の位置づけに限る。**現行の独立技術審査対象は R11 提案**であり、R8 は現行候補でも正式 Gate 結果でもない。

### G.0.4 R5 Fresh Independent Findings — R6 proposed closure / Gate dependency

| Finding | Severity / counterexample | Corrective candidate anchors | Actual required evidence / owner / disposition |
|---|---|---|---|
| `RG-310-R5-001` | **Major / Blocking**; R5 D.3 L242–261, D.5 L318, E.3 L477–483, E.9 L553–561: legitimate B0 edit changes source fingerprint→self revoke; B2-DEP lock changes→old B1 PASS applied to different artifact | Historic R6 D.2/D.3.1/D.5, E.3.1/E.8.0/E.9.0, F.0.2/F.3.1, H/J and historic 04 §§1–6: IAB/AMIO/UD/EAF/EI/IRA/HSA; DEP→PREP→RA→human ACTIVATE→RUN | Requirements/Auth owners, B1/RA independent reviewer, human phase signers. **`PROPOSED_FIX_PENDING_FRESH_INDEPENDENT_REVIEW`**; no grant/proof. RA missing blocks HOST; scope/unsafe revokes |
| `RG-310-R5-002` | **Minor**; R5 E.6 L533 calls mandatory safety failed but fixed latest Evidence Report `task1Acceptance` says required-runtime and mandatory-safety aggregates **true** | R6 E.6 exact final status correction; B.3/F.3 unchanged | Task1 Evidence/Gate owner, historic R6 review request (not established by preliminary check); **`PROPOSED_FIX_PENDING_FRESH_INDEPENDENT_REVIEW`**. 31/32 & CaseA BLOCKED cause Task1 BLOCKED |

Formal Gate dependency edges are only the strict monotonic chain in `04` §6, and R5 original B0→B1→DEP→HOST remains the same high-level phase layout. RA depends **only** on final frozen compiled/static artifact and independent owner, NOT actual host-run/Task1/full Task6. Failed run attempts require a new attemptIndex; prior PASS is never silently projected to future source. No acceptance waiver. Past R1..R4 findings are not re-opened or self-closed; an independent reviewer must decide nonregression.

### G.0.5 R6 予備指摘4件と**当時の R7** 修正境界（非規範の履歴のみ）

| Candidate from preliminary only | Historic R7 Author triage (non-normative) | Historic R7 proposed change (non-normative) | Residual risk / authorized finding owner |
|---|---|---|---|
| `R6-PRE-001` (Major candidate) | `CONFIRMED` design-spec gap | D.3.1–3.2, D.5.1, E.3.2/E.9.0.1, F.0.3/3.2, `04` §§1–5: trusted per-operation preflight+commit, independent external seal, phase root, adversary test | **Operational reference monitor, revocation, clock, single-writer, recorder proof UNPROVEN → operations BLOCKED.** Independent architecture/implementation-feasibility owner must prove; formal R7 Gate alone does not establish it. |
| `R6-PRE-002` (Moderate candidate) | `CONFIRMED` ambiguity despite R6 §4 intent | D.3.2, E.8.0.1, E.9.0.1, F.0.2/F.3.1, `04` §3: start-only latch; continuation fresh op check; old B1 historic-only | Monitor/latch infrastructure unproven; no DEP HSA issued. |
| `R6-PRE-003` (Minor candidate) | `CONFIRMED` strictly mathematical proof inconsistency, not observed runtime cycle | `04` §6 assigns `r(R')=0,r(D')=1,r(P')=2` and increasing ranks/attempt | DAG is a proposed logic proof only, not evidence for actual host origin or compiled runtime feasibility. |
| `R6-PRE-004` (Minor candidate) | `CONFIRMED` stale provenance misstatement | A.1/A.8, E.4.1, H/I/J and new standalone R7 request: distinguish R5 verdict, R6 proposal/preliminary, R7 author, separate future review | R5 original report absent; do not claim original textual audit or formal closure. |

This register is not an independent reviewer verdict or `RESOLVED` status. R1–R5 findings remain subject to formal independent verification, owner decisions and runtime proof.

### G.0.6 R7 Fresh Independent *technical* Findings → R8 author closure hypotheses (not a formal Gate)

**HISTORICAL R8 PROVENANCE ONLY:** This subsection reproduces R8 author historical claims; its original R8 pointer is not a current R11 operative predicate. The R8 author historically identified R8 §04 as its then-current matrix. For the **current R11 unadopted candidate only**, refer to R11 §04; §G.0.7 and frozen 06 document R8→R9, while §G.0.8 and frozen 05 document R9→R10; §G.0.9 and current 03 document R10→R11. R8 findings were independently evaluated in the attached R8 report, not accepted by this author.


| R7 technical Finding | Independent R8 author recheck against R7 original | R8 limited proposed closure (NOT ACCEPTED) | Remaining proof/owner |
|---|---|---|---|
| `R7-FI-001` **Major** | R7 §04 `B0_EDIT_ALLOWED` AND postRoot/diff/commitSeal requires future fact to start; after-write signing permits forbidden visible result. **CONFIRMED**. | D.3.3/E.3.2/F.0.2/0.3/3.1 and current §04 §§2–5 `OP_PREPARE_ALLOWED` vs `OP_COMMIT_ACCEPTED`, private stage, single ACCEPT+PUBLISH, abort/IN_DOUBT; row01/02/06/16/18/19/23 plus 15/30. | Formal static reviewer independent; actual complete monitor/transaction/recorder/clock/revoke feasibility **UNPROVEN**. |
| `R7-FI-002` **Moderate** | R7 D.5 referred operatively to R6 matrix while R7 §04 said missing proof UNKNOWN not REVOKED. **CONFIRMED**. | At R8 authoring, D.5 and operative R8 cross-references pointed to then-current `04-authorization-fingerprint-transition-matrix-R8.md`; R6/R7 non-normative history. | Reviewer search for any hidden old pointer and state mismatch. |
| `R7-FI-003` **Minor** | `本 R5` A.4 and G.0.3 survive as near-current viewpoint. **CONFIRMED as provenance ambiguity**, not safety bypass by itself. | Explicit `当時のR5`, past review-request framing, missing R5 original disclosure. | Formal R5 original review not in inputs; no retrospective signed independence claim. |

This is a **candidate finding-closure map**, not independent `RESOLVED`. `03-r7-finding-closure-and-diff-map.md` (R8当時のファイル名、R11同梱 `07-r7-finding-closure-R8-historical.md`) provides old/new anchors and falsifiable traces. No one may infer reviewer identity, monitor existence or human authority from this table.

### G.1 明示する残留リスクと受容主体

| Risk | B0段階で人間が認める**限定的**なリスク | 許されない帰結／緩和策 |
|---|---|---|
| `R-OLDREAD` | 旧 read が実ホストで遅延成功する interleaving の再現性・到達性が不明 | 安全と主張しない。製品有効化禁止、最終 product は Task1 `R` に加えて production assurance `I` を独立必須とする（Task1 は I を要求しない）。不能なら C |
| `R-MODEL-DRIFT` | `M` と実 source compiled `P` がずれ得る | B1 compiled-code test の独立検証。ずれたら STOP |
| `R-HOST-ORDER` | real extension callback と isolated guard の wiring/order が異なる可能性 | adapter 連携を B0で禁止。後の別 Gate で実 host integration を観測 |
| `R-LATE-APPEND` | late assistant/toolResult の token-free before append 未実測 | A10 の独立 raw-positive removal と JSONL join がない限り final BLOCKED |
| `R-SESSION-ID` | routing handle と durable ID を混同する可能性 | durable identity + generation + turn/call join を必須とする |
| `R-COMPAT` | 上流 fork/API change に伴う pin drift | C は改めて全 runtime proof、旧結果流用禁止 |
| `R-AUTH-SCOPE` | stage が一般的 Task 6 実装に拡大される可能性 | whitelist/branch/expiry/STOP、非配線・非公開、独立監査 |

**残留リスク受容の意味:** 人間が受容し得るのは「製品を実行しない隔離スコープで guard コードと証拠を作る間の未実証性」だけであり、漏洩・授権・Task acceptance の残留リスクの waiver ではない。`R-OLDREAD` を最終製品受入で持ち越す案は**本提案では不採用**。

### G.2 R1 Architecture Review Findings（**R2 審査済み・実証未完**）

| Finding | R2 design-level minimum correction / evidence | Closure authority | Gate status |
|---|---|---|---|
| `RG-310-AR-001` Major | Public event field vs current context tiers、G1 old result with reused callId reject、host source-origin immutable proof or fail-closed C exit。実 old completion 必要 | independent R2 Architecture Reviewer; future B2 runtime reviewer | `RESOLVED_IN_PROPOSAL` (R2), runtime `NOT_PROVEN`; B2 origin absent→STOP |
| `RG-310-AR-002` Major | Senpi exact devDependency + `bun.lock` hunk と scope、dependency preflight、no `./senpi` export、temp build import graph | independent R2 reviewer + future Plan/B2 reviewer | `RESOLVED_IN_PROPOSAL` (R2), B2 `NOT_AUTHORIZED` |
| `RG-310-AR-003` Moderate | 4 state, sync revoke→AWAIT_FRESH_READ、attempt registration、failed-disabled、async recheck | independent R2 reviewer; future B1 compiled reviewer | `PARTIAL` (R2), B1 `NOT_SUBMITTED` |
| `RG-310-AR-004` Moderate | actual emitted JS import via independent Bun process、tsc temp output、hash/negative mutation/source fallback STOP、subset ledger | independent R2 reviewer; future B1 compiled reviewer | `RESOLVED_IN_PROPOSAL` (R2), B1 `NOT_SUBMITTED` |
| `RG-310-AR-005` Moderate | B0 expected RED vs B1 SUBMITTED FAIL vs actual safety STOP/revoke | independent R2 reviewer + human auth owner | `RESOLVED_IN_PROPOSAL` (R2), not authorized |

R3 提出時点でも `RG-310-DR-001..004` は全件 OPEN。特に AR-001 の full closure には元 host callback の immutable origin 証拠が別途必要であり、設計文面の整理だけで閉鎖しない。

### G.2.1 R1 保持テストの独立再確認

AR-001: host-issued immutable origin が出ないなら `HOST_ORIGIN_BOUND` を mint せず B2 STOP/C。AR-002: B2-DEP package exact declaration/lock hunk と B2-HOST 別 grant。AR-003: fresh-only registration/FAILED_DISABLED + R3 以来保持した `setActivation` fence が compiled に成立しない限り PARTIAL。AR-004: exact emitter JS+mutation/import graph。AR-005: B0 expected RED と submitted B1 failure・actual leak STOP の分離。いずれも R2 の proposal-level 審査結果は実証の代用ではない。

### G.3 未受容の residual risks と責任者

| Risk | R2 状態 | 対象 | 強制 STOP／responsibility |
|---|---|---|---|
| `R-CURRENT-CONTEXT-ALIAS` | OPEN | G1 result が G2 current context と一致して再認可される | host-origin binding proof 未得なら B2 `BLOCKED`。Architecture/host owner が Option C へ |
| `R-COMPILE-FALLBACK` | CONTROL_PROPOSED | .ts を import して compiled PASS と誤る | independent B1 reviewer; emitted JS graph hash/negative mutant が不一致なら FAIL |
| `R-B2-DEPENDENCY` | OPEN | 直接 devDependency と lock graph 欠損 | Requirements/Plan owner; 非許可差分で STOP |
| `R-RED-STATUS-AMBIGUITY` | CONTROL_PROPOSED | TDD expected RED を正式 B1 FAIL と誤判定または逆 | human authorization owner; submitted verdict/safety STOP を別管理 |
| `R-UNOBSERVED-RACE` | OPEN | actual stale result/new fresh read/late append 未観測 | Task1/B2 evidence owner; final acceptance BLOCKED、必要なら C |

### G.4 Canonical / B-001 / B-002 independent acceptance register（R2-003）

- **Canonical unknown-tool (`1/32 BLOCKED`)**: existing evaluator の exact `messageId` non-null pre/post join、session/toolCall join、actual `message_end`→entry appended→JSONL readback、no receipt/provenance/side effect。Owner: Task 1 Evidence/evaluator。Gate: 31/32 のまま Task 1 BLOCKED。
- **`RG-310-B-002` (`NOT_PROVEN`, outside 32)**: literal token が **初期 toolResult に実在**、actual sanitizer が content を変更、actual append / readback で不在、別 reviewer。Owner: B-002 evidence track。Gate: Task1 evaluator には無関係。別の未採択 `RG310-PRODUCT-READINESS` での今後の判断候補であり、現在の製品 enable は不許可。token-free input は認めない。
- **`RG-310-B-001` (`BLOCKED`, outside 32)**: fixture-only track を別 owner/証拠で閉じる。Gate: Task1 evaluator には無関係。製品向けの別安全性 track で `BLOCKED`。R5 は fixture/evaluator を変更しない。

### G.0.7 HISTORICAL R9 ONLY — R8 Fresh Independent technical Findings → R9 limited author closure hypotheses (NOT Gate)

| R8 finding | Independent technical finding and proposed R9 action | Status / operational consequence |
|---|---|---|
| `R8-FI-004` Major | R8 §04 `HOST_RUN_ALLOWED` requires runtime origin proof before same RUN used to observe it. R9 §04 §3/3.1, rows 34/35, §6, main D.1/D.2/E.9/E.9.0.0/F.3.1 split prospective H0 `HOST_RUN_START_ADMISSIBLE` from retrospective H1/H2/H3 results and forbid unauthorized diagnostics. | `AUTHOR_REVISION_CANDIDATE_ONLY` / H0 real feasibility `NOT_PROVEN`, actual result R `BLOCKED`; independent R9 recheck required. |
| `R8-FI-005` Minor | The R8 §E title incorrectly says `Revision 7`; R9 §E explicitly identifies the R9 current complete candidate and keeps R7/R8 as history. | `EDITORIAL_CORRECTION_CANDIDATE_ONLY`; R9 independent review required. |

**R9 historical context only:** The following was the R9 author assertion, not a statement identifying the current R11 candidate.

**No promotion:** R7-FI-001..003 remain *textually corrected* only; operational actor-external trust boundary, real fixed Senpi H0/H2, Case A and Task1 stay unproven. All legacy matrices are historical/non-operative. R8 technical report and R8 proposal may be consulted for provenance but at R9 authoring, the then-current **unadopted** candidate matrix was R9 `04` only.

### G.0.8 HISTORICAL — R9 review → R10 author closure hypothesis (NOT the current R11 Gate)

**R10-era candidate identification (HISTORICAL):** Only `04-authorization-fingerprint-transition-matrix-R10.md` was the sole candidate within the former UNAPPROVED R10 proposal. **It is not the current R11 candidate.** R8/R9 matrices and archived closure records are historical, NON-OPERATIVE, and do not outrank currently approved Requirements/Design/Plan, existing Task1 evaluator or STOP rules. The claim is a document-author proposal, **not a human adopted norm or authorization**.

| Finding | Independent R9 input | R10 exact limited edit (author hypothesis) | Residual/closure disposition |
|---|---|---|---|
| `R9-FI-006` Moderate | R9 `01` E.3.2 L560 incorrectly says R8 with R9 matrix pathname; F.0.2 L756 calls current R9 source R8; R9 `04` §5 L311 calls itself R8; R9 `01` G.0.6 L889 falsely attaches a R9 path to historical R8. R9 `04` §2 L176 also says `in R8` without an explicit provenance qualifier. | R10 `01` E.3.2 and F.0.2 identify **R10** matrix; R10 `04` §5 says **R10 sole current candidate**; G.0.6 uses historical R8 pathname; `04` §2 L176 marks R8 legacy-name reference as **historical**, preserving prohibition. | `AUTHOR_REVISED_NOT_CLOSED`. No proof of actual runtime, formal reviewer independence, H0 feasibility or human adoption. New R10 independent technical review required. |

**Additional inherited technical verdicts (not new R10 Gate findings):** R9 reviewer rated R8-FI-004 (H0/H1/H2/H3 type separation) and R8-FI-005 (E title) `TEXTUALLY_RESOLVED`; real H0 source binding, actor-external monitor, transactional atomic accept+publish, actual H1/H2/H3 and Task1 `R` remain `NOT_PROVEN/BLOCKED`. R9-FI-006 is the only intended substantive R10 correction; numbering, historical evidence, and prospective/retrospective predicates are not amended.

### G.0.9 R10 Independent technical review → R11 limited version-time correction (AUTHOR HYPOTHESIS; NOT Gate)

**Sole current candidate within this UNAPPROVED R11 proposal:** `04-authorization-fingerprint-transition-matrix-R11.md`, subordinate to existing approved Requirements/Design/Plan, Task1 evaluator, and STOP. R8/R9/R10 matrices, G.0.3/0.6/0.7/0.8 and archived files `05/06/07` are **HISTORICAL, NON-OPERATIVE**. No formally adopted R11 norms, review Gate, human ADR/HSA or execution permission is implied.

| Finding | R10 technical review source | R11 document-only author action | Status / mandatory protection |
|---|---|---|---|
| `R10-FI-007` Minor | R10 `01` L6 status `REVISION9`; L194 D header `Revision 9`; L859 G.0.3 `現在...R8`; L17 A.1 `今回の R7` | The first two are normalized to **R11 proposal revision**, with explicit namespace explanation; G.0.3 is expressly historical R8 and names current R11 review; A.1 makes R7 reviewer request **then-time historical** | `AUTHOR_REVISED_NOT_CLOSED`, independent R11 technical review required. No change to H0/H1/H2/H3, transaction safety, grants, runtime `R/P/I` or Task1 |
| `R10-FI-008` Informational | Earlier R9→R10 partial patch omitted README/new closure/renamed history/manifest | Provide **complete package-tree R10→R11 diff**, including all files, additions/renames/deletions, README and SHA256SUMS, with SHA-256 digests and reproducible verification | `DOCUMENTATION_PROVIDED_NOT_INDEPENDENTLY_VERIFIED`; this is not a normative change or Gate approval |

R10 reviewer found `R9-FI-006 TEXTUALLY_RESOLVED`; R8-FI-004/005 and R7-FI-001..003 retain their *textual* dispositions only. Actual actor-external reference monitor and atomic accept+publish remain `NOT_PROVEN`, fixed Senpi H0 capability/actual H1/H2/H3 remain `NOT_PROVEN`, Case A / Task1 remain `BLOCKED`. Reviewer must verify this entire map independently rather than assume closure.

## H. Proposed Human Architecture Decision Record — **未署名／権限を発行しない**

**R11 status guard:** Human architecture decision `null`、B0/B2-DEP/B2-HOST-PREP/B2-HOST-ACTIVATE signer `null`、`B1-REATTEST-FINAL=null` を維持する。以下 YAML は将来の署名 schema 候補であり実 token/authorization ではない。`authorizationFingerprintR11Proposed` は `04` の定義と一致するが人間署名や compiled/host 証拠を捏造しない。

以下は **提出用未承認 ADR フォーマット**であり、値 `null` は不成立を意味する。Git SHA（blob）と raw byte `sha256`、artifact fingerprint schema を混同しない。現行 blob SHA は参照用であり、新しい amended R'/D'/P' の authorization に使う欄は別々に空欄とする。

```yaml
recordId: RG310-ADR-001
revision: ADP-RG310-A-001-R11
status: HUMAN_DECISION_REQUIRED
independentArchitectureReviewR1: REVISION_REQUIRED
independentArchitectureReviewR2: REVISION_REQUIRED
independentArchitectureReviewR3Technical: REVISION_REQUIRED  # same-session review; NOT fresh independent
independentArchitectureReviewR3Formal: NOT_ESTABLISHED
independentArchitectureReviewR4Technical: REVISION_REQUIRED
independentArchitectureReviewR4Formal: NOT_ESTABLISHED_IN_THIS_SESSION
independentArchitectureReviewR5: REVISION_REQUIRED  # user-provided R5 finding inputs; full report not in current ZIP
independentArchitectureReviewR7Technical: REVISION_REQUIRED  # technical report verified; formal reviewer identity not established
independentArchitectureReviewR7Formal: NOT_ESTABLISHED
independentArchitectureReviewR11: null
humanDecision: null             # APPROVE_B | MAINTAIN_A | ESCALATE_C | DEFER
humanDecisionReasons: null
requirementsOwnerSigned: null
architectureDecisionSigner: null
approvedAt: null
repository: yohi/justice
baseline:
  evidenceBranch: spike/justice-v5-native-evidence-294
  evidenceHEAD: c428041dfb5779b6b6dc8db7bf14928225a00373
  approvedDocumentsHEAD: 8a2e4f1536e9cad499ee7e9d996ff163df132fd4
  requirementsGitBlob: d335c34b747cafd6ac3b2e81d710fdcc61fb777e
  designGitBlob: 64acdf177d2fd207861eb477af7c8a265eed71e8
  planGitBlob: 10dfba4c199feff19ee387b244daf6c0fd30d5e3
  evidenceReportGitBlob: 7df0887402d1d4eaf34a09e44213cf75b630b813
  packageJsonGitBlob: 8e154e09d0c6253d104b60e72208c5ff2a3478b4
  bunLockGitBlob: 6a7f961d68eaef8d42a1e22609528dadf3a5d438
  tsconfigGitBlob: c9894f496abc59587f0dd39cffe57a7cc6c34a3a
  pinnedUpstreamCommits:
    omoNative: 091728d274f20d62504b0b5e1edbc3970671dd8b
    senpi: d56e6a260d9468418a39bc9120945cf98e06b840
    superpowers: 8ca22dba9a94f28898bbce59f2537ff4d87c747d
amendedArtifactChain:
  chainId: null
  requirements: {path: docs/superpowers/requirements/2026-09-27-justice-v5-requirements.md, commit: null, gitBlob: null, rawSHA256: null}
  design: {path: docs/superpowers/specs/2026-09-27-justice-v5-semantic-control-plane-design.md, commit: null, gitBlob: null, rawSHA256: null}
  plan: {path: docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md, commit: null, gitBlob: null, rawSHA256: null, canonicalSnapshot: null}
  fingerprintSchema: null
  projectionSchema: null
  freshIndependentNormativeReviewRef: null
scopeB0:
  authorizationId: null
  authorizationKind: RG310_B0_UNCONNECTED_GUARD_ONLY
  signer: null
  actor: null
  branch: null
  baseCommit: null
  baseTree: null
  approvedAt: null
  expiresAt: null                   # at most 14 calendar days
  status: NOT_AUTHORIZED
  allowedSubtasks: [RG310-SCOPE-T2, RG310-SCOPE-T6]
  allowedPaths:
    - src/core/native-task-capability.ts
    - src/core/workflow-activation.ts
    - tests/core/native-task-capability.test.ts
    - tests/core/workflow-activation-v5.test.ts
    - src/runtime/native-task-capability-registry.ts
    - src/runtime/workflow-activation-state.ts
    - tests/runtime/senpi-adapter-activation-capability.test.ts
    - tests/runtime/native-read-epoch-parity.test.ts
  generatedOutputRoot: null        # empty temporary isolate, not existing dist
  exactAllowedCommands: null
  sourceDiffAllowlistHunks: null
  compiledArtifactSHA256: null
  compilerAndFlagsSHA256: null
  dependencyGraphSHA256: null
  testVectorsAndMutationSHA256: null
  B1Submission: NOT_SUBMITTED
  activationCommitFencingProof: null
  deferredSetActivationNegativeControls: null
  freshReadPositiveControls: null
  compiledMutationForAwaitAndEpoch: null
  excludedOperations: [package_change, lock_change, tsconfig_change,
                       host_wiring, live_host_execution, export_senpi,
                       plugin_registration, deploy, publish, external_provider,
                       other_tasks, evaluator_or_canonical_denominator_change]
scopeB2:
  status: NOT_AUTHORIZED
  dependencyPhaseAuthorizationId: null  # human B2-DEP grant, NEVER inherits B0
  dependencyPhaseApprovalId: null       # human B2-DEP signer
  hostPhaseAuthorizationId: null        # legacy candidate placeholder; NOT runtime authority
  hostPhaseApprovalId: null             # legacy candidate placeholder; NOT runtime authority
  hostPrepHumanGrantId: null            # separately human-signed source-only scope, no host execution
  finalReattestationReviewerId: null    # independent of author/implementer/human signer
  finalReattestationArtifactId: null
  finalReattestationVerdict: NOT_PROVEN
  hostActivateHumanExactArtifactId: null
  hostRunPermission: NOT_AUTHORIZED
  prerequisiteB1IndependentVerdict: null
  preflightDependencyManifestResult: null
  preflightHostOriginAssurance: null    # must not be current ctx alone
  revisedDesignPlanReviewRef: null
  signer: null
  actor: null
  branch: null
  baseCommit: null
  approvedAt: null
  expiresAt: null
  allowedPathsAndExactHunks: null       # may include only reviewed package.json, bun.lock,
                                        # src/senpi-extension.ts, runtime adapter/transcript/secret guard,
                                        # and named focused tests; no wildcard
  approvedDependencyChanges:
    packageJsonDevDependencyExact: '@code-yeongyu/senpi@2026.10.8'
    bunLockMinimalDiffSHA256: null
    allowRootExportsChange: false
    allowBuildScriptChange: false
  compilerGraphAndOutputHashes: null
  sourceIncarnationBindingProof: null
  independentAuthorityFailClosedEvidence: null
  independentPersistenceSafeEvidence: null
  lateAssistantPositiveCanonicalAppend: null
  lateToolResultPositiveCanonicalAppend: null
  sameRoleFallbackWithActualReadback: null
  mockOnlyIsolatedHost: true
  packageExportOrInstallActivationAllowed: false
riskAcceptance:
  isolatedDevelopmentWithUnobservedRace: null      # human must explicitly choose
  humanOwner: null
  maximumRiskExpiry: null
  acceptRuntimeRaceAtFinalProductGate: false
  originBindingUnproven: true
stopAndRevocation:
  - normative_source_or_approved_branch_or_actor_drift
  - package_lock_or_compiler_graph_outside_approved_scope
  - B1_submitted_compiled_parity_failure_or_missing_mutant_control
  - stale_async_activation_commit_or_unfenced_promise_write
  - sanitation_inventory_lost_or_unverifiable_canonical_append
  - wrong_or_unproven_host_result_origin
  - permission_allowlist_violation
  - token_leak_or_actual_side_effect_or_wrong_authority_rearm
  - expired_authorization_or_missing_artifact_hash
  - unreadable_actual_persistence_or_incomplete_negative_control
gateBoundariesProposed:
  task1ExistingEvaluator: evaluateTask1Acceptance  # UNCHANGED; 32 + CaseA/B + runtime/safety
  task1RequiresFullTask6: false
  task1RequiresB1OrB2Pass: false
  task1RequiresB001OrB002Closure: false
  b3Task1: SUBMIT_TO_EXISTING_GATE_ONLY
  b2Host: TEST_ONLY_EVIDENCE_NOT_FULL_TASK6
  fullTask6Prerequisite: TASK1_PROVEN_BY_EXISTING_GATE_AND_SEPARATE_HUMAN_NORMAL_TASK_AUTH
  productReadinessNewGateStatus: PROPOSED_NOT_ADOPTED
  productReadinessWouldCheck: [B001_FIXTURE_ONLY, B002_POSITIVE_TOKEN_REMOVAL]
  productReadinessAdoptionOwners: [requirementsOwner, planOwner, productGateOwner, evaluatorOwner, freshIndependentReviewer, humanApprover]
requiredClosureBeforeTask1GateEvaluation:
  - existing_canonical_32_of_32_with_exact_unknown_tool_message_identity
  - existing_CaseA_PROVEN_and_CaseB_PROVEN_separate
  - existing_required_runtime_evidence_and_mandatory_safety_predicates
  # Full Task6, B001/B002, B1/B2 are NOT NEW Task1 prerequisites
requiredClosureBeforeFullTask6Acceptance:
  - Task1_PROVEN_by_unchanged_evaluator
  - human_usual_exact_chain_Task2_Task5_Task6_implementation_authorizations
  - authorized_full_Task6_production_conformance_and_independent_review
requiredProofBeforeProductSafetyApproval:
  - AR_001_to_005_independently_reviewed_non_regressed
  - DR_001_to_004_closed_by_future_evidence
  - R2_001_002_003_and_R3_001_002_independent_proposal_review
  - actual_old_inflight_read_success_after_error_rejected_by_production_guard
  - exact_fresh_read_and_late_assistant_and_toolResult_append_readback
  - no_missing_mandatory_quality_conformance_runtime_evidence
  - full_Task6_formal_acceptance_and_usual_human_authority
  # B001/B002 must be resolved in their own tracks. To make them additional
  # formal product-acceptance checks, adopt RG310-PRODUCT-READINESS separately.
separateOpenFindingTracks:
  B001: BLOCKED
  B002: NOT_PROVEN
  productReadinessFormalGateAdopted: false
authorizationFingerprintR11Proposed:
  trustedOperationBoundaryProven: false
  trustedRecorderIndependentlyEstablished: false
  operationTimeClockAndRevocationFreshnessProven: false
  independentAppendSealAvailable: false
  completeMediationAllWritersProven: false
  lastSealedOperationProofId: null
  operationProofLogRoot: null
  sealedDepStartedId: null
  depStartedB1AttestationId: null
  depStartedEAF0: null
  opPrepareAllowed: false
  opPreparedId: null
  opCommitAcceptedId: null
  opAbortedId: null
  opInDoubtId: null
  trustedAtomicAcceptPublishProven: false
  isolatedPrivateStageProven: false
  crashAndRecorderRecoveryProven: false
  depPrepareAllowed: false
  depEditAcceptedId: null
  independentDepPhaseCompletionId: null
  independentHostPrepCompletionId: null
  freezeSealId: null
  status: NOT_ADOPTED
  immutableAuthorizationBaselineId: null
  mutableAuthorizedOutputLedgerRoot: null
  B1OriginalArtifactId: null
  B1OriginalAttestationId: null
  B1CurrentArtifactApplicability: NOT_PROVEN
  B2DepFinalLockGraphId: null
  B2HostPrepGrantId: null
  finalFrozenArtifactId: null
  B1ReattestationId: null
  B1ReattestationResult: NOT_PROVEN
  reattestationExecutionScope: READ_ONLY_INPUT_AND_EPHEMERAL_EMISSION_ONLY
  reattestationAllowsTrackedOrLockSourceMutation: false
  humanB2HostActivateExactArtifactId: null
  independentHostSourceCapabilityProofId: null
  hostIngressCompleteMediationProofId: null
  hostNoEffectsIsolationProofId: null
  hostRunStartAdmissible: false
  hostEventIngressAdmittedCount: 0
  hostResultOriginVerifiedCount: 0
  hostRunEvidenceAcceptedId: null
  B2HostRunAuthorized: false
  ruleReference: 04-authorization-fingerprint-transition-matrix-R11.md
notAuthorizedByThisRecord:
  - any_implementation_before_separate_human_scoped_grant
  - CaseA_PROVEN
  - Task1_PROVEN
  - Tasks2_through_14_normal_authorization
  - TaskAccepted
  - PlanComplete
  - package_export_deployment_release
signatures:
  requirementsOwner: null
  designOwner: null
  planOwner: null
  freshIndependentReview: null
  humanArchitectureDecision: null
  B0HumanAuthorization: null
  B2DependencyHumanAuthorization: null
  B2HostHumanAuthorization: null
  B2HostPrepHumanAuthorization: null
  B1FinalReattestationIndependentReviewer: null
  B2HostActivateFinalArtifactHumanConfirmation: null
```

**判断時の必須記録:** `[ ] B を追加審査の上で選択`／`[ ] A の既存 Gate を維持`／`[ ] C の上流 API 調査へ切替`／`[ ] 保留`、リスク理由、期限、別 B0 授権文書 ID。`APPROVE_B` が仮に記入されても、B0 の `authorizationId/signer/chain/expiry/commands` が未署名なら `NOT_AUTHORIZED` を維持する。

## I. Fresh Independent Architecture Review Request — R11 full self-contained edition

# Justice v5 — RG-310-A-001 R11 Fresh Independent Architecture Review Request

- Subject: `ADP-RG310-A-001-R11` / `RG310-AUTH-FP-R11` — document-only limited revision, 2026-10-14 JST, **UNAPPROVED / NON-EXECUTABLE**.
- Independence: reviewer MUST be distinct from R11 author, R10 technical reviewer, R10 author and prior proposal/review authors, evidence creators, implementation actors, Requirements/Design/Plan owners and human phase signers. This document cannot establish identity, organizational independence or formal Gate authority: record `NOT_ESTABLISHED` unless externally proved.
- Read-only contract: NO GitHub mutation, code/fixtures/evaluator change, test/build/runtime or live no-effect probe, commit/push, Gate state change, ADR or HSA. Static source/hashes only.
- Fixed immutable refs: `yohi/justice` Evidence `c428041dfb5779b6b6dc8db7bf14928225a00373`, approved R/D/P `8a2e4f1536e9cad499ee7e9d996ff163df132fd4`; Requirements blob `d335c34b747cafd6ac3b2e81d710fdcc61fb777e`, Design `64acdf177d2fd207861eb477af7c8a265eed71e8`, Plan `10dfba4c199feff19ee387b244daf6c0fd30d5e3`, Evidence `7df0887402d1d4eaf34a09e44213cf75b630b813`, package `8e154e09d0c6253d104b60e72208c5ff2a3478b4`, bun.lock `6a7f961d68eaef8d42a1e22609528dadf3a5d438`, tsconfig `c9894f496abc59587f0dd39cffe57a7cc6c34a3a`.
- Upstream OmO `091728d274f20d62504b0b5e1edbc3970671dd8b`; Senpi `d56e6a260d9468418a39bc9120945cf98e06b840`; Superpowers `8ca22dba9a94f28898bbce59f2537ff4d87c747d`.
- Immediate R10 Proposal ZIP SHA-256: `66ac9ebab5400460b28d28180e212969aa09a9a8d643662b80c51bb48701d309`; R10 Handoff SHA-256 `9306b7b66b1af7ee494c940ae2a8e61bf4bdff4adf6919a4388e764f7476e648`; R10 independent technical report SHA-256 `738db9254d9e58de398e197d06ca586e28b26062a0e8b8e9a2ab34386dbd59ea`. Previous R9 proposal `e65f8c9cc1cec1c44ef202d4b65f487453713617f172c7d4c0e4615a4769afd2`, R8 `d8b6c45c5dadb75b85df627831fdd07e68b23ae9ec1fe91a3041de96cccf9fd1`, R7 `05a1372a1ee30176cb2db560842148251077ce96257905f8fc763f72914282ca`, R6 `284eda20ec576f4036c48f5e8b8b8efad235127f6025c6e4bc6d0767eab818c6`. These are INPUT evidence, not approved R11 outcomes. R5 full reviewer primary remains `NOT_VERIFIED`.
- The R11 Proposal ZIP's own hash MUST be recorded externally only. SHA/CRC/manifest equality is not actual feasibility evidence. The existing Requirements/evaluator supersede all unadopted candidates.

## 1. Complete input integrity, provenance and current authority

Independently compute SHA256/ZIP CRC/internal manifest for **R11 Proposal**, all handoff ZIPs and historical originals R10→R6, and SHA256 of original R10 reviewer report. Inspect entire R11 `01` A–J, `02` full contract, new `03` closure, sole proposed R11 matrix `04` §§1–7, README, frozen history `05/06/07`; original R10 main + matrix + README, R10 review, and earlier historical inputs. Independently retrieve fixed GitHub immutable objects; any inaccessible object => `NOT_VERIFIED`, not claimed verified by copying an author note. §I content from its embedded `# Justice...` heading through the start of J must equal standalone `02` exactly. Verify `05` byte-identical to R10 `03`, `06` to R10 `05`, `07` to R10 `06`.

Read the **complete R10→R11 package diff** and verify every original and new file accounted for, including README, added `03`, archival renames, and manifest; distinguish old archive names from current normative status. Review the combined changes in **all** R11 `01` sections A–J, `02/03/04/README` for present-tense `R7/R8/R9/R10` pretending to be current; historical quotations must carry an explicit then-time qualifier. The R11 04 is the **sole current candidate matrix within this proposal**, subordinate to approved Requirements/Design/Plan/evaluator. No prior matrix becomes operative by pointer or history.

## 1A. R10-FI-007 Minor — independent, four-anchor closure test

Independently inspect original R10 `01` L6, L17, L194, L859 and corresponding R11 text. Test whether (a) `OPTION_B_REVISION11_FRESH_REVIEW_PENDING` and D's `Option B Revision 11` are **proposal-document numbering only**, not a new adopted architecture identity, (b) R7 reviewer request is expressly *past-tense*, not the current R11 reviewer, and (c) G.0.3 `R8` is *then-time historical* while sole current target is unequivocally R11. Check every other present-tense version label, including §A/G/H/I/J, README, matrix and status. Do not accept substitution of one misleading present-tense old revision for another. Record R10-FI-007 `TEXTUALLY_RESOLVED` or a line-anchored `REVISION_REQUIRED` independent of author self-validation.

## 1B. R10-FI-008 Informational — full diff coverage

Check the R10→R11 diff patch against complete original/source ZIP trees: added `03`, former `03` renamed to archival `05`, former `05` to `06`, former `06` to `07`, changed 01/02/04/README, and SHA256SUMS. Account for all rename-only exact-byte originals and any additions/deletions; compare every file's SHA256 in a machine-readable coverage table and explicitly distinguish `COMPLETE` vs `PARTIAL`. The previous R9→R10 complete diff is contextual evidence only, not a substitute for the R10→R11 independent file-tree diff.

## 1C. Earlier R9-FI-006 and R8/R7 non-regression

Verify R10 independent reviewer `R9-FI-006=TEXTUALLY_RESOLVED` as input, not a formal Gate closure. Verify R11 E.3.2, F.0.2 and matrix §5 identify only the R11 candidate, while G.0.6 historical R8 filename remains R8 and archived R10 G.0.8 does not become current normative source. Confirm §04 §2 historical in-R8 qualification, old R6/R7/R8/R9/R10 matrix non-operative and existing Requirements/evaluator superior. Compare R10→R11 row01..38 **all eight cells byte-for-byte**, INV-A01..A14 **all six cells byte-for-byte**. Check H0–H3 source binding, atomically accepted transaction, per-op grant/expiry/seq and PhaseSeal, full DAG, R/P/I and all STOP conditions for exact unchanged meaning. No future result proof required before H0 but H0 complete actor-external capability still mandatory, currently `NOT_PROVEN`, so NO HOST RUN.

## 2. FI-004 Major: independently falsify temporal reachability and fail-closed safety

Treat R8-FI-004 as a historical confirmed input and R9 independent `TEXTUALLY_RESOLVED` as technical evidence only, not automatically resolved by R11 author prose. Construct the trace `G1 read(X) -> restart -> G2 read(X) -> G1 tool_result(X)` with an identical `callId`. Check all of the following *separately*:

1. **H0 / prospective:** `HOST_RUN_START_ADMISSIBLE` demands separately authenticated exact human ACTIVATE, final RA/freeze, fixed-public-API lifecycle/registration binding capability proof independent of actor/modeled `P`, trusted complete ingress monitor and pre-effect no-side-effect isolation. No unknown *future result*, origin verification, stale success delivered, runtime `R` or `I` is required at H0. H0 is a permission to *start a confined run only*. Absence/unverifiable proof => NO HOST RUN / UNKNOWN/BLOCKED+STOP before first effect; human ACTIVATE alone is insufficient.
2. **H1 / admission:** each actual ingress is nonforgeably associated with the **real** immutable source and generation/attempt, rather than current callback context/duplicated `callId`, before any authority, transcript, storage, external effects, signed receipt or evidence credit. Origin unknown/ambiguous => reject, `NO_ISSUANCE`, no successful result or evidence. Fixed `ToolResultEventBase` has no invented `generation` field.
3. **H2 / retrospective:** `HOST_RESULT_ORIGIN_VERIFIED` can only follow observed actual source-verified result. G1 stale old success cannot be attributed to G2 by same callId; no mocked result, denied/no-delivery branch, local `originProof` object or compiled `P` counts as actual `R`.
4. **H3 / independent evidence:** `HOST_RUN_EVIDENCE_ACCEPTED` needs independently sealed actual provenance/order/canonical session+message join and existing positive/negative INV controls. It grants **neither** Task1 Gate PASS, production `I`, Phase authorization nor product release.
5. **Alternative/Option C:** If fixed public API cannot *prove* H0 nonforgeable complete host ingress, trial remains BLOCKED. Any different no-effect live probe requires prior independent route analysis, actor-external monitor/zero-effects proof, separate exact human authority and independent review; read-only feasibility alone is not runtime evidence. No safe lawful route => human Option C, re-pin/rebaseline/new review, no run. Do not invent a bridge/SDK field or permit unmonitored 'observability-only' side effects.

Verify predicates §04 §3/3.1, matrix rows34/35, strict DAG §6 and main D.1/D.2/D.3/E.9/E.9.0.0/F.3.1/F.3.2/G/H/J agree. Explicitly look for `HOST_RESULT_ORIGIN_VERIFIED → HOST_START` or `RUN→H0` backward dependency, G1/G2 conflation, receipt/evidence accepted before validation, pre-effect monitor bypass, unsafe fallback, or an omitted rank edge. A mere rename of runtime proof to 'capability' without an independently falsifiable BEFORE-run complete binding proof MUST fail. Verify the intended dependency DAG including intra-host H0→start→H1→H2→H3 rather than phase-only rank assertions. Document whether this R11 proposal is **conditionally text-consistent**, separately whether its actual feasibility is proven (normally NOT_PROVEN). No runtime feasibility is inferred from authoring.

## 3. FI-005 Minor and R7-FI-001..003 nonregression

Verify R11 chapter E correctly names R11 current unadopted normative candidate, and older `Revision 7`/R8/R9 identity cannot become current; R7/R8 historical references explicitly remain non-operative. Independently retest R7-FI-001 prospective `OP_PREPARE_ALLOWED` (no future afterRoot) vs durable private PREPARED and retrospective atomic `OP_COMMIT_ACCEPTED`, ABORT tombstones, crash before/at/after linearization, signed accepted-record/actual authoritative bytes atomic equivalence, complete mediation, independent recorder and no actor-origin witness. Real feasibility remains UNKNOWN until proven. Check R7-FI-002: missing independent proof => UNKNOWN/BLOCKED+STOP, not REVOKED except proven breach/formal B1 FAIL; no obsolete R6/R7 operative matrix. Check R7-FI-003: R5 history not misrepresented as verified original review. Recheck no B1 current EAF_1 reattestation on later legal DEP edit, no same attempt FROZEN→WRITE and no Task1→RA or fullTask6→Task1 reverse edge.

## 4. Complete 38-row matrix, invariants and actual fixed evidence

Audit stable rows **01..38 individually** over seven independent axes: operation stage, grant, evidence applicability, next permitted action, human approval, fail-closed disposition and independent proof obligation. Deep-check 34/35 plus 01/02/06/15/16/18/19/23/30 and cross-table transition consistency, prospective/retrospective proof timing, grant vs evidence orthogonality and falsifiable negative traces. Enumerate **INV-A01..A14** and compare all six columns **exactly** against R8 original to detect weakening, deletion, or addition. Check `L_ACT/L_INV` synchronous invalidation, same-role/session/message JSONL identity, A10 actual token-positive removal, A07 actual old success arrives and is rejected, A13 CaseA≠CaseB, A14 evaluator unchanged. `P` compiled ≠ Task1 `R` ≠ future product `I`; no mandatory new B3 input or production I in Task1. Existing final Evidence Report: **canonical 31/32 PROVEN + 1 BLOCKED, Case A BLOCKED, Case B PROVEN, unknown-tool BLOCKED, required-runtime-evidence aggregate true, mandatory-safety aggregate true, Task1 BLOCKED**. Separate B-001 BLOCKED/B-002 NOT_PROVEN remain outside canonical 32; Product Readiness PROPOSED_NOT_ADOPTED. Audit R5 full-original gap openly.

## 5. Required fresh independent output and STOP

Issue a new Japanese **R11 independent technical architecture review report** covering R10-FI-007 Minor explicitly, R10-FI-008 Informational, and R9-FI-006 non-regression (distinct from inherited R8-FI-004/005), line-anchored and adversarial: exact bytes/integrity/pins, separate independent findings R10-FI-007 Minor verdict, R10-FI-008 diff coverage, R9-FI-006 inherited technical status plus inherited FI-004 Major/FI-005 Minor nonregression, R7 regression check, 38/38 7-axis audit, INV-A01..14 six-column immutable check, H0/H1/H2/H3 attack traces and all DAG preconditions, old-version pointer audit, actor-external monitor/host capability feasibility obligations, uncertainties and formal independent identity/authority. State explicit `ACCEPTABLE_AS_STATIC_CANDIDATE` or `REVISION_REQUIRED` with residual findings, and distinguish it from **Formal Fresh Independent Gate** which requires independently established organizational identity and authority. This instruction grants neither implementation nor Gate/ADR/HSA/Task1 authority.

```text
R11 Architecture Proposal: UNAPPROVED
Formal Fresh Independent R11 Gate: NOT_ESTABLISHED
R'/D'/P': NOT_ADOPTED
Architecture Decision: HUMAN_DECISION_REQUIRED
RG-310-A-001: NO_EQUIVALENT_EVIDENCE_CONTRACT
RG-310-DR-001..004: OPEN
Task1: BLOCKED (31/32; Case A BLOCKED; Case B PROVEN; unknown-tool BLOCKED)
Required-runtime-evidence aggregate: true; mandatory-safety aggregate: true
RG-310-B-001: BLOCKED; RG-310-B-002: NOT_PROVEN
RG310-PRODUCT-READINESS: PROPOSED_NOT_ADOPTED
Tasks2–14: NOT_AUTHORIZED
B0/B1/B2-DEP/B2-HOST-PREP/IRA/HOST-ACTIVATE/HOST-RUN: NOT_AUTHORIZED
Implementation / TaskAccepted / PlanComplete: NOT_AUTHORIZED
```

**Next holder:** a demonstrably distinct fresh R11 technical reviewer. No human owners have adopted the R11 candidate; no environment/host/runtime/monitor proof is implied by document revision.

## J. Next Handoff / STOP

**次担当:** R11 Author・R10 Reviewer・過去著者とは役割分離された Fresh Independent R11 Architecture Reviewer（組織的独立性と正式 Gate 権限は別途証明する）。この文書 §I とバイト同一の `02-fresh-independent-architecture-review-request-R11.md`、`01` A–J、`03-r10-finding-closure-and-diff-map-R11.md`、唯一の候補 `04-authorization-fingerprint-transition-matrix-R11.md`、frozen archives `05/06/07`、README/SHA256SUMS と全ファイル差分、R10/R9/R8/R7/R6原本・R10/R9 review 報告を引き継ぐ。

**最優先監査:** R10-FI-007 の four anchors（現行ステータス/D版/今回R7/現在R8）と全文の残留現在形、R10-FI-008 complete tree diff、R9-FI-006 非退行。R8-FI-004 H0→start→H1→H2→H3 の依存順序、G1/G2同一callIdの非偽造origin binding、fixed SenpiでH0を事前証明できない場合のNO HOST RUN、R7-FI-001/002/003の事前PREPAREと事後atomic accepted+publish、trusted key/time/ledger/writer fencingとcrash/recovery未証明、38状態の七軸とINV-A01–A14 六列、Case A/Task1 `R` と compiled `P`/production `I` 非代替、R5一次資料gapを全て独立に点検する。

**すべて未認可の将来手順:** Fresh R11 technical review → 正式R'/D'/P'各Ownerと独立normative review → Human Architecture Decision → actor外monitor及びtransaction原子性の独立証明 → 各phaseの別人の署名HSA → B0/B1/DEP/HOST-PREP → final freeze/RA → human ACTIVATE → H0事前capability proof（不在ならSTOP/Option C）→ 1回の隔離test-only HOST START → H1/H2実結果検証 → H3独立seal → 任意B3-T1提出 → existing Task1 evaluator → 通常 Tasks2–6 → full Task6 → 別production I/product gate。R11文書作成はこの順序のいかなる開始・承認も意味しない。

```text
R11 Architecture Proposal: UNAPPROVED
Formal Fresh Independent R11 Gate: NOT_ESTABLISHED
R10-FI-007: AUTHOR_REVISED_NOT_CLOSED / Minor
R10-FI-008: COMPLETE_DIFF_PROVIDED_FOR_REVIEW / Informational
R9-FI-006: TEXTUALLY_RESOLVED (R10 independent technical assessment only)
R'/D'/P': NOT_ADOPTED
Architecture Decision: HUMAN_DECISION_REQUIRED
RG-310-A-001: NO_EQUIVALENT_EVIDENCE_CONTRACT
RG-310-DR-001..004: OPEN
Canonical Task1: 31/32 PROVEN, 1/32 BLOCKED
Case A: BLOCKED; Case B: PROVEN; unknown-tool: BLOCKED
Required-runtime-evidence aggregate: true; mandatory-safety aggregate: true
RG-310-B-001: BLOCKED; RG-310-B-002: NOT_PROVEN
RG310-PRODUCT-READINESS: PROPOSED_NOT_ADOPTED
Task1: BLOCKED; Tasks2–14: NOT_AUTHORIZED
Actor-external monitor / atomic accept+publish: NOT_PROVEN
Fixed Senpi H0/H2 proof: NOT_PROVEN; NO HOST RUN
B0/B1/B2-DEP/B2-HOST-PREP/IRA/HOST-ACTIVATE/HOST-RUN: NOT_AUTHORIZED
Implementation / TaskAccepted / PlanComplete: NOT_AUTHORIZED
```

**STOP:** R11 Author は文書作成と静的整合性検証のみ。GitHub、コード、fixture、evaluator、build、runtime/host、human decision、Task/Gate state は変更しない。
