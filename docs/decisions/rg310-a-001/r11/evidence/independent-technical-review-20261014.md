# Justice v5 — RG-310-A-001 R11 Fresh Independent Technical Architecture Review

審査日：2026-10-14（JST）  
対象：`ADP-RG310-A-001-R11` / `RG310-AUTH-FP-R11`  
審査方式：添付原本および GitHub 固定参照の**読み取り専用・静的技術審査**  
審査者の位置付け：この成果物は提出著者の自己検証を結論として流用しない新規技術評価。ただし、組織上・法的な別主体性、権限ある正式 Gate reviewer identity、署名権限はこの評価からは証明されず、**Formal Fresh Independent R11 Gate = `NOT_ESTABLISHED`**。

## 1. 結論（技術レビューと正式 Gate を区別）

**独立技術推奨：`ACCEPTABLE_AS_STATIC_CANDIDATE`（文書候補としてのみ）。** 追加の R11 文書改訂を必須とする新しい反例・版識別の欠陥は今回の範囲では検出しなかった。`R10-FI-007` は **`TEXTUALLY_RESOLVED`（独立技術評価）**。`R10-FI-008` の R10→R11 完全差分は **`COMPLETE`（9/9 ファイルを独立照合・パッチ再現済み）**。R9-FI-006 と R8/R7 の *文書モデル* に関する修正は維持された。

上記は **正式 Gate 承認／人間の設計決裁／採択／実行許可ではない**。実運用可能な actor 外の完全仲介・独立記録器・原子的 ACCEPT+PUBLISH、固定 Senpi の非偽造 H0/H1/H2/H3 は未実証。**`NO HOST RUN`、Task1 `BLOCKED`、B0/B1/B2/Tasks2–14 は `NOT_AUTHORIZED` を厳格に維持**する。R5 Fresh Independent Review 完全原本は依然 `NOT_VERIFIED`。

## 2. 入力完全性と固定 provenance

| 検証対象 | 独立 SHA-256 | CRC | ZIP 内 SHA256SUMS |
|---|---|---|---|
| R11 Proposal ZIP | `1df24d4250132a3df1bc2c4d39b53baebbe1b1d8ad8060862c0531743601d185` | PASS | 8/8 MATCH |
| R11 Independent Handoff ZIP | `6d4009a0272539b22707607f4e32e931829eda83e3e6ec52aa748c51dd2fc591` | PASS | 12/12 MATCH |
| R10→R11 Complete Diff ZIP | `797bb62ff36a0df9ff76e532738ff015bae525c7c87edde76a6752bfc93b9db6` | PASS | 3/3 MATCH |
| R10 Proposal ZIP | `66ac9ebab5400460b28d28180e212969aa09a9a8d643662b80c51bb48701d309` | PASS | 7/7 MATCH |
| R10 Handoff ZIP | `9306b7b66b1af7ee494c940ae2a8e61bf4bdff4adf6919a4388e764f7476e648` | PASS | 11/11 MATCH |
| R9 Proposal ZIP | `e65f8c9cc1cec1c44ef202d4b65f487453713617f172c7d4c0e4615a4769afd2` | PASS | 6/6 MATCH |
| R8 Proposal ZIP | `d8b6c45c5dadb75b85df627831fdd07e68b23ae9ec1fe91a3041de96cccf9fd1` | PASS | 5/5 MATCH |
| R7 Proposal ZIP | `05a1372a1ee30176cb2db560842148251077ce96257905f8fc763f72914282ca` | PASS | 5/5 MATCH |
| R6 Proposal ZIP | `284eda20ec576f4036c48f5e8b8b8efad235127f6025c6e4bc6d0767eab818c6` | PASS | 5/5 MATCH |
| 以前の R9→R10 完全差分（参考） | `2437f58d5078a01de1b444cddc05b09842d46e7312d7720ad4be69c52d941866` | PASS | 1/1 MATCH |

R10 technical review Markdown SHA-256 = `738db9254d9e58de398e197d06ca586e28b26062a0e8b8e9a2ab34386dbd59ea`（一致）。Handoff 内 R11 提案 ZIP は単独提出 ZIP と全バイト一致。R11 `01` の §I 本文は独立 `02` のレビュー契約本文と完全一致。R11 `05/06/07` はそれぞれ旧 R10 `03/05/06` と全バイト一致。R11 提案の外側 ZIP SHA-256 を同 ZIP 内の `SHA256SUMS` に循環参照させていない。

GitHub コネクタを使い固定 SHA を **添付資料から独立に再取得**：

- Justice Evidence HEAD [`c428041d...`](https://github.com/yohi/justice/commit/c428041dfb5779b6b6dc8db7bf14928225a00373) および approved R/D/P [`8a2e4f15...`](https://github.com/yohi/justice/commit/8a2e4f1536e9cad499ee7e9d996ff163df132fd4)：それぞれ指定された exact SHA で取得成功。
- 固定 Git blob 7件：Requirements `d335c34b747cafd6ac3b2e81d710fdcc61fb777e`、Design `64acdf177d2fd207861eb477af7c8a265eed71e8`、Plan `10dfba4c199feff19ee387b244daf6c0fd30d5e3`、Evidence `7df0887402d1d4eaf34a09e44213cf75b630b813`、`package.json` `8e154e09d0c6253d104b60e72208c5ff2a3478b4`、`bun.lock` `6a7f961d68eaef8d42a1e22609528dadf3a5d438`、`tsconfig.json` `c9894f496abc59587f0dd39cffe57a7cc6c34a3a` の SHA 指定取得成功。これは **指定 blob ID の存在と取得** の検証であり、現在の可変 branch tip／runtime の不変性の証明ではない。
- 固定上流 commit：OmO [`091728d...`](https://github.com/code-yeongyu/oh-my-openagent/commit/091728d274f20d62504b0b5e1edbc3970671dd8b)、Senpi [`d56e6a...`](https://github.com/code-yeongyu/senpi/commit/d56e6a260d9468418a39bc9120945cf98e06b840)、Superpowers [`8ca22db...`](https://github.com/obra/superpowers/commit/8ca22dba9a94f28898bbce59f2537ff4d87c747d) を指定 SHA で取得成功。
- R5 **完全な一次独立審査原本**は添付階層から取得できず、独立性・判定内容の原本再確認は `NOT_VERIFIED` のまま。R5 への言及は historical input に留める。

## 3. R10-FI-007 Minor — 四アンカーを独立に再審査

| 原本 R10 `01` 行 | 欠陥 | R11 対応行 | 判断 |
|---|---|---|---|
| L6 | `OPTION_B_REVISION9_FRESH_REVIEW_PENDING` が R10/R11 文書と不一致 | R11 L6、L23、README L5 | `OPTION_B_REVISION11_FRESH_REVIEW_PENDING` を **R11 提案文書の改訂番号のみ**と明記。独立の承認済み Option B architecture version ではない。 |
| L194 | D が現在 `Option B Revision 9` と宣言 | R11 L194 | `Option B Revision 11 (R11 proposal document revision only; UNAPPROVED)`。本文 L23 と矛盾しない。 |
| L17 | `今回の R7 の新規独立審査` が現在の審査主体を誤認させる | R11 L17 | `当時の R7 提案で別主体による新規独立審査が求められた` と歴史的な時点に限定。 |
| L859 | `現在の独立レビュー対象は R8` と断言 | R11 L859 | R8 文書作成**当時**と明示し、現在の技術審査対象を R11 と明記。 |

さらに R11 `01` A〜J、独立 `02/03/04`、README、旧版アーカイブの位置づけを走査。R11 E 見出し L500、E.3.2 L554、F.0.2 L754–756、G.0.6 L881–892、G.0.7 L940–950、G.0.8 L951–959、G.0.9 L961–970、H L974/L1148–1194、I L1219–1290、J L1291–1319、R11 `04` L309–312、README L1–19 は現行 R11 候補と旧 R6/R7/R8/R9/R10 資料を区別。R11 `04` だけが**当該未承認提案内の唯一の現行候補**であり、承認済み R/D/P/Task1 evaluator より上位ではない。G.0.6 の R8 ファイル名は履歴に忠実、G.0.8 の R10 指示も歴史的範囲に拘束される。

**R10-FI-007 disposition：`TEXTUALLY_RESOLVED`（technical only）。** 旧版を現行 normative source とする新たな残留現在形は確認できなかった。この判定は R11 の正式承認でも実現可能性証明でもない。

## 4. R10-FI-008 Informational — 全ファイル差分の独立再現

`INVENTORY.json` の旧8ファイル・新9ファイルの全 SHA-256 を ZIP 展開原本から再計算して一致。提供された `Justice_RG310_R10_to_R11_Complete_Unified_Diff.patch` に対し、一時ローカル作業領域の R10 原本で `git apply --check` → `git apply` を実施。生成された新9ファイルのすべてが R11 ZIP と **byte-for-byte MATCH**。GitHub の repository は一切変更していない。

- 変更：`01` 主提案、`02` 審査依頼、`04` マトリクス、`README.md`、`SHA256SUMS`。
- 追加：`03-r10-finding-closure-and-diff-map-R11.md`。
- rename-only / exact bytes：R10 `03`→R11 `05`、R10 `05`→R11 `06`、R10 `06`→R11 `07`（各 SHA-256 同一）。
- パッチが旧 `02` を削除／新 `02` を追加という形で表現していることも差分全体に含まれ、R11 tree と整合。旧／新の未対応ファイル・再適用時の不一致はゼロ。

同梱 CSV `R10_to_R11_independent_file_coverage.csv` に旧／新 SHA-256、操作区分をすべて記録。**Coverage = `COMPLETE`**。ただし完全差分は安全性を証明するものではなく、`R10-FI-008` は Informational のまま、formal Gate closure ではない。

## 5. 38状態×7軸、INV-A01..A14×6列の非退行

R7、R8、R10、R11 の `04` には安定 ID `01..38` を各38件確認。**R10 と R11 の全38行は、見出しと区別したデータ行全体が完全バイト一致（38/38、各8セル、304/304セル）**。38行全てで7つの独立監査軸（操作 stage、grant、evidence applicability、次の操作、人間承認、fail-closed、独立反証可能 proof）が存在し非空であることを検証。各行の7軸の全文、R11 行番号を `R11_38_row_seven_axis_audit_20261014.csv` に記録した。

| 主な行群 | 独立に点検した反例 / 状態遷移 | 判定 |
|---|---|---|
| 01–04 | B0 初回／連続編集は毎回 fresh preRoot/seq、許可外 hunk は private stage→ABORT。違反の実影響未立証で REVOKED に飛ばない | 条件付き整合 |
| 05–12 | prepare/commit 両時点の期限・revocation、backdated clock、actor ledger、gap、署名偽造、PhaseSeal、過去の正当性 | 条件付き整合 |
| 13–15 | B1 は証拠であって人間 grant ではない。B1 PASS 後に B0 を編集するなら `attemptIndex+1` / 新署名が必要 | 条件付き整合 |
| 16–22 | DEP_STARTED を **最初の stage 前**に封印。法的な後続 lock 編集で現在 EAF は変わっても B1(EAF0) を再び要求しない | 条件付き整合 |
| 23–30 | PREP では HOST 実行不可、seal/freeze/RA を分離、同一 attempt の FROZEN→WRITE 禁止 | 条件付き整合 |
| 31–35 | 署名不在/期限/対象不一致、H0 事前能力未証明時 NO RUN、H1/H2/H3 は実観測後にのみ証拠化 | 条件付き整合 |
| 36–38 | Task1 31/32 なら BLOCKED、production `I` は Task1 `R` の代替・前提にしない、歴史的 DEP 完了は期限後も過去事実 | 条件付き整合 |

R8 主提案 F 表の `INV-A01..A14` と R10/R11 F 表の14データ行を比較。**14/14 行、各6セル（84/84セル）をバイト同一**と確認：

`A01` provider-error revoke、`A02` 全 candidate receipts、`A03` activation、`A04` method preservation、`A05` replay denial、`A06` cached activation、`A07` old stale actual result、`A08` fresh selected-method、`A09` sanitation-only、`A10` actual positive token removal、`A11` failed-call provenance、`A12` durable session/JSONL/log identity、`A13` Case A と B の独立性、`A14` missing evidence BLOCKED。

`A07` は **実際の G1 old success 到達後の拒否 `R`** と後続 production 統合 `I` を別に立証する。`A10` は当初から token-free では不可、token-positive input → 実 sanitizer changed → 同一 append ID → 即時 JSONL readback が必要。`A12` は同じ role/session/message ID。`L_ACT/L_INV` 同期失効と method preservation を保持。compiled `P`、Task1 runtime `R`、production `I` は相互非代替であり、`B3-T1`、`B-001/002`、product readiness を Task1 既存 evaluator の追加入力にしない（R11 `01` F L706–822、`04` §7）。

## 6. Temporal reachability / H0–H3 の独立攻撃評価

**反例**：`G1 read(X) → restart → G2 read(X) → G1 tool_result(X)`、G1 と G2 は同じ `callId`。G2 の現在 callback context で G1 の late success を G2 正当結果と読み替えた場合、旧権限を再発行する危険が生じる。

- **H0（HOST_RUN_START_ADMISSIBLE）**：R11 `04` L241–249、L271–275、L279–284、L367–401。別人署名 ACTIVATE、exact final RA/freeze、公開 API における全 ingress source binding **能力の actor 外の事前・反証可能な証明**、起動前の完全仲介、external effect の予防、test-only isolation が揃う場合だけ confined start を許す。**未知の将来 result、H2 成立、実 R/I は H0 の入力ではない**。H0 は run を開始することのみを許し、結果を真としない。能力証明不在なら **NO HOST RUN**。
- **H1（ingress）**：`04` L250–255, L281–282, L286。各イベントの真の immutable source/generation/attempt を、same `callId`／現在文脈ではなく trusted ingress が before-effect 結合する。G1 result を G2 に帰属してはならない。判定不能なら **reject / NO_ISSUANCE / evidence 不採用**。
- **H2（per-result）**：`04` L256–261, L283, L286。G1 actual result が観測・認証された場合だけその出所と順序を確定。ローカル製 `originProof`、結果の未到達、mock/compiled `P` は R ではない。H2 を H0 の事前条件にしない。
- **H3（evidence）**：`04` L262–266, L284。真の observed provenance、positive/negative control、session/message identity join と独立 seal が全件整って初めて limited evidence。Task1 PASS、production I、実装承認、product enable には波及しない。
- **DAG**：`04` L367–401 の ranks 0〜18 は同一 attempt 内で順序増加。Host 内は `H0 → START → H1 → H2 → H3` の microsequence。`H2→HOST_START`、`H3→H0`、`Task1→RA`、`fullTask6→Task1` は禁止。新 attempt の遷移は `(attemptIndex,phaseRank,microstep)` の辞書式前進のみ（旧 freeze/旧 B1/HSA は現在権限に転用不可）。これらは**記述された依存グラフの非循環性**であり実運用の可到達性ではない。

**固定 upstream の追加直接照合**：Senpi `d56e6a...` [`types.ts` L1711–1820](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/core/extensions/types.ts#L1711-L1820) の `ToolResultEventBase` には `toolCallId/input/content/isError` 等はあるが、非偽造 `generation`/`attempt` は存在しない。[`agent-loop.ts` L302–335](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/agent/src/agent-loop.ts#L302-L335) は error-turn の providerToolResults/finishTurn 処理を含み、[`agent-session.ts` L3077–3129](https://github.com/code-yeongyu/senpi/blob/d56e6a260d9468418a39bc9120945cf98e06b840/packages/coding-agent/src/core/agent-session.ts#L3077-L3129) には extension-before-append ordering がある。ただしこれらだけでは G1/G2 immutable source binding は確定しない。**H0 actual complete host mediation、H2 actual source-bound result、Case A runtime R は `NOT_PROVEN/BLOCKED`。**

`H0` を検査する未認可 live no-effect probe は認められていない。実施するなら別の権限・actor 外の完全無作用証明・独立審査が先決で、証明できなければ Option C の新 pin / 再ベースライン／再審査へ人間判断する。`H0 capability` の単なるラベル付けのみで実行しない。

## 7. R7 FI-001..003 / 原子的履歴・失効の非退行

R11 `04` §2（L20–203）と §3/§6、`01` D.3.3/F.3.1 により：

- PREPARE は future afterRoot を条件とせず、`OP_PREPARED` は独立 durable reservation と隔離 private stage の権利のみ。事後の `OP_COMMIT_ACCEPTED` は **1点の原子的 durable accepted record + authoritative bytes publish** を要する。外部署名が先で bytes が後、または bytes が先で証明が後の窓は許容しない。`ABORT` には実無影響と独立 tombstone が必要。`IN_DOUBT` は STOP から自動回復しない。
- Crash before linearization は無効果を独立証明できる場合のみ ABORT、at/after linearization は独立 journal と実 authoritative root から accepted/aborted を確定し、未解決なら隔離 STOP。外部記録器が actor-controlled の場合、whole-path mediation 不在、別 writer、child process、mount/symlink、network/host side effect は全て境界証明失敗として扱う。
- 証拠欠損と独立証明不能は `UNKNOWN/BLOCKED+STOP`。`REVOKED` は実違反/偽造の独立立証または既定 formal B1 FAIL 時に限定。合法な DEP lock 差分は旧 EAF の current applicability を失効させても human DEP grant を自己失効させない。
- R7 の旧 matrix を現在の基準へ戻さない。R5 review 完全原本の欠損を他の summary や R6/R7 著者の記述で埋めない。

**このプロトコルを満たす実行基盤の証明は未取得**。設計上の原子的仕様が、現在のファイルシステム・recorder・monitor で実現できると主張していない。

## 8. 最新固定 Evidence / 権限状態

GitHub の固定 Evidence blob `7df0887402d1d4eaf34a09e44213cf75b630b813` の末尾 `Final Task 1 evidence gate repair — 2026-10-12` を優先して再照合：**canonical 31/32 PROVEN、1/32 BLOCKED、Case A BLOCKED、Case B PROVEN、unknown-tool BLOCKED、required-runtime-evidence aggregate = true、mandatory-safety aggregate = true、Task1 = BLOCKED**。ファイル冒頭の古い `32/32` を最終証拠として使わない。B-001 BLOCKED、B-002 NOT_PROVEN は canonical32 の分母外。Product readiness は未採択。

```text
R11 Architecture Proposal: UNAPPROVED
R11 independent TECHNICAL recommendation: ACCEPTABLE_AS_STATIC_CANDIDATE
R10-FI-007: TEXTUALLY_RESOLVED (technical/documentary only)
R10-FI-008: COMPLETE (diff coverage verified, Informational)
R9-FI-006: TEXTUALLY_RESOLVED (R10 technical finding; R11 non-regression verified)
R8-FI-004/005 and R7-FI-001..003: TEXTUAL_NON_REGRESSION_ONLY
New R11 documentary blocking findings: NONE IDENTIFIED
Formal Fresh Independent R11 Gate: NOT_ESTABLISHED
R'/D'/P': NOT_ADOPTED
Architecture Decision: HUMAN_DECISION_REQUIRED
RG-310-A-001: NO_EQUIVALENT_EVIDENCE_CONTRACT
RG-310-DR-001..004: OPEN
Task1: BLOCKED (31/32 PROVEN; Case A BLOCKED; Case B PROVEN; unknown-tool BLOCKED)
required-runtime-evidence aggregate: true; mandatory-safety aggregate: true
RG-310-B-001: BLOCKED; RG-310-B-002: NOT_PROVEN
RG310-PRODUCT-READINESS: PROPOSED_NOT_ADOPTED
Actor-external monitor / trusted atomic ACCEPT+PUBLISH: NOT_PROVEN
Fixed Senpi H0/H2 source binding and actual runtime R/I: NOT_PROVEN
NO HOST RUN
B0/B1/B2-DEP/B2-HOST-PREP/IRA/HOST-ACTIVATE/HOST-RUN: NOT_AUTHORIZED
Tasks2–14 / Implementation / TaskAccepted / PlanComplete: NOT_AUTHORIZED
```

## 9. 審査の限界と次段階

文書の追加限定修正を求める新規 technical finding はないが、`ACCEPTABLE_AS_STATIC_CANDIDATE` は採用・展開・実験開始の指示ではない。別途独立性・権限を証明した正式 reviewer の審査、R'/D'/P' の owner 決裁、別の human architecture decision、trusted monitor/原子的 publish と固定 Senpi H0 能力の独立証明、phase 別の human HSA が成立するまで **いかなる B0/B1/DEP/HOST と通常 Tasks2–14 にも進めない**。

本審査では GitHub／規範原本／fixture／evaluator／コードの変更、build、test、runtime / host probe、署名・承認・Gate state 更新を実施していない。ローカル作業領域に限定した ZIP/PATCH の再現検証は static integrity analysis であり、実システムの operation 許可ではない。

### 添付した独立検証補助資料

- `R10_to_R11_independent_file_coverage.csv`：旧8件／新9件の SHA-256 と rename/change/add カバレッジ。
- `R11_38_row_seven_axis_audit_20261014.csv`：stable ID 01..38 の各行、7監査軸のセル全文と根拠行番号。
- `SHA256SUMS`（配布 ZIP 内）：同梱各成果物の SHA-256。
