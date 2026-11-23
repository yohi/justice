# Justice v6 S5 — H1〜H5 Read-only Host Boundary Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` **only after separately authorized execution**. This plan is a **read-only verification plan**, not a source-code implementation plan. Steps use checkbox (`- [ ]`) syntax. No automatic review, Host access, code changes, commit, push, E1 or release.

**Version:** R0.1 (plan draft, 2026-11-23 JST)  
**Status:** PLAN_DRAFT / DESIGN_R0.1.1_ADOPTION_PENDING / HOST_EXECUTION_NOT_AUTHORIZED  
**Repository:** `yohi/justice` · **Issue:** [#358](https://github.com/yohi/justice/issues/358)  
**Design Reviewed HEAD:** `2a097bb2deccc7728254a50b770978b81e4ee297`  
**Source Baseline:** `master@3c2b5a3f38f4440a622b8ee53705f5a6193518f1`

**Goal:** 採択済みS1/S2/S3の限定実Host受入に向けて、H1〜H5の静的Read-only Evidenceを収集し、Human OwnerがE1の実行可否を独立判断できる状態にする。実行自体を承認しない。

**Architecture:** 既存Host `coreultra7-270k` / OpenCode V2.3.2に対し、**別途承認された**既存のRead-only接続だけを用いる。Identity・Plugin参照・State分離・停止境界を非機密メタデータで照合し、Evidenceごとに `VERIFIED / NOT_VERIFIED / BLOCKED / OBSERVED_MISMATCH` を付与する。実行時のPluginロードは今回観測しない。

**Tech Stack:** GitHub Source（固定Commit）・Ubuntu既存HostのRead-onlyファイル/メタデータ取得手段・Git Blob/SHA-256・Markdown Evidence。Shell / OpenCode / Test Runner / Provider / VM / Sandboxの起動は今回の確認方法に含めない。

**Spec:** `docs/superpowers/specs/2026-11-23-justice-v6-s5-h1-h5-readonly-host-boundary-design.md`（Design R0.1.1、Git Blob `fa7bbb56627a421e4e2a785bccb557fd9cce7a49`）。

**Existing controlling plan:** `docs/superpowers/plans/2026-11-17-justice-v6-s5-operation-completion.md`（AC-H01〜H03のHost GOは別途承認）。本PlanはHost確認の一部を具体化するだけであり、その実行権限・E1〜E3の範囲を拡大しない。

## Global Constraints

- **Authority:** Design R0.1.1はレビュー上 `DOCUMENT_READY_WITH_BLOCKERS` / `RG-S5-HOST-001=RESOLVED` だが、**R0.1.1のOwner AdoptionはPENDING**。Plan作成の依頼は採択・Host GO・GitHub書込み承認の代用ではない。採択判断後もHost Read-only実行には独立した明示承認が必要。
- **Fixed identity:** Repository `yohi/justice`、Design HEAD `2a097bb2deccc7728254a50b770978b81e4ee297`、GitHub Source Baseline `3c2b5a3f38f4440a622b8ee53705f5a6193518f1`、Host `coreultra7-270k`、OpenCode V2.3.2。Host HEADや実バイナリSHAは未測定のため推測しない。
- **Connection:** 既存Filesystem Tunnelは `Tunnel-client has not been seen for 300 seconds` で接続不能だった。接続復旧は自動再実行承認ではない。接続不可なら **1度の接続結果で停止**し、別経路・再試行・サービス起動へ進まない。
- **Allowed only after approval:** 既存非機密ファイルのRead-onlyメタデータ・限定ファイル内容取得、読取可能な対象バイト列からのDigest計算、証拠の整理。使用する取得方式自体が書込みしないと確認できない場合は実行しない。
- **Forbidden:** Source/Test/CI・Host・共有設定・既存Session/State変更、OpenCode/Plugin起動・初期化・Session作成、Build/Install、Shellへの無断切替、Credential/Session本文閲覧、Provider/Network呼出し、Fault Injection/Restart、Stop/Rollback/Cleanup実施、VM/Sandbox、GitHub書込み、追加レビュー、新Issue/PR。
- **State:** `JUSTICE_GLOBAL_WISDOM_PATH`が未指定なら通常 `~/.justice/wisdom.json`。`createGlobalFs()` と `JusticePlugin.initialize()` は将来の書込み可能性がある。Workspace分離、XDG分離、`--standalone`を強制隔離とみなさない。
- **Safety:** 未確認は未確認とし、衝突の実観測と混同しない。影響対象だけFail-Closedにし、独立作業を不用意に停止しない。シンボリックリンク・共有Mount・所有者/権限・不明な書込み先の静的証明可能性を吟味する。
- **Decisions:** H1〜H5の静的VERIFIEDは `RUNTIME_LOADED`、実行時非干渉、OS/Network/Secrets隔離、AC PASS、E1 GO、`BOUNDED_COMPLETE`、`RELEASE_APPROVED`を意味しない。`E1/E2/E3=HOLD`を維持。
- **No automatic progression:** 1回の限定確認・Evidence報告・Owner Checkpointで終了する。新Findingや不足が出ても独立レビューや追加実装へ自動展開しない。

## File Structure / Output Contract

**このPlanの作成段階:** ローカルに本Markdownを作成するだけ。GitHub上のファイルは変更しない。将来このPlanをRepositoryへ保存する場合は、別途OwnerのGitHub書込み承認が必要。

**将来の限定確認時:** 非機密の `H1〜H5 Read-only Identity / Boundary Evidence Record` を1件作成・提示する。保存先はOwnerが承認した受け渡し先を使用する。HostやGitHubへEvidenceを無断書込みしない。既存T09〜T15を変更しない。

**Read-only references:**
- `docs/superpowers/specs/2026-11-23-justice-v6-s5-h1-h5-readonly-host-boundary-design.md`
- `docs/superpowers/specs/2026-11-23-justice-v6-s5-d08-host-v232-design-addendum.md`
- `docs/superpowers/plans/2026-11-17-justice-v6-s5-operation-completion.md`
- `docs/superpowers/operations/justice-v6-s5-minimal-operation-runbook.md`
- `src/opencode-plugin.ts` / `src/runtime/opencode-adapter.ts` / `src/core/justice-plugin.ts` （GitHub Sourceの読取参照のみ）

**Evidence record fields (per H1〜H5):** `Check ID`, `Fixed target`, `Acquisition method`, `Evidence source`, `Observation time (JST)`, `Sanitized observed facts`, `Digest (if measured)`, `Static criteria matched/missing`, `Limitations`, `Verdict`, `Owner approval reference`。該当しない項目は `NOT_APPLICABLE`、証拠欠落は `NOT_VERIFIED` と明記。秘密本文や私的Session内容を転記しない。

## Review Focus — 実行前の5つの静的否定ケース

以下は**Source/Testの新規テストケースではなく、証拠上の判定アサーション**である。各ケースは担当Taskのチェック項目として検査する。

| ID | 条件・期待する結果 | 担当 |
|---|---|---|
| RF-01 | GitHubのHEADだけ一致しHost HEAD/実バイナリDigestがない → H1をVERIFIEDにしない | Task 2 |
| RF-02 | `dist/opencode-plugin.js`の存在だけでBuild元Commitが追跡できない → H2をVERIFIEDにしない | Task 2 |
| RF-03 | Plugin設定上の参照だけ確認でき、ロード済みとは不明 → `RUNTIME_LOADED`を主張せずH3の静的範囲のみ判定 | Task 2 |
| RF-04 | 専用WorkspaceはあるがGlobal WisdomやSession Pathが共有/未固定/リンク未解決 → H4をVERIFIEDにせずE1 READY不可 | Task 3 |
| RF-05 | 未来のPIDを固定したかのように扱う・共有OpenCodeと停止対象が区別不能・Cleanup Allowlist不明 → H5をVERIFIEDにせずE1 READY不可 | Task 3 |

---

### Task 1: Owner GateとRead-only取得経路の成立確認

**Files:** Read-only: 上記Design §2/§6/§10。Write: なし（回答は会話内で可能）。

**Interfaces:** Consumes: Owner adoptionと限定Host確認の明示承認。Produces: `GO_READ_ONLY` または `STOP_NOT_AUTHORIZED / STOP_CONNECTION_BLOCKED / STOP_UNSAFE_METHOD` とEvidenceの取得可否。後続Taskは `GO_READ_ONLY` の場合だけ許可される。

- [ ] **Step 1 — Authorityを照合:** R0.1.1採択判断とH1〜H5限定Host確認承認が別々に存在するか確認する。片方でもない場合は `STOP_NOT_AUTHORIZED` としてTask終了。
- [ ] **Step 2 — Methodを判定:** 承認された既存のFilesystem Read-only手段で、非機密Pathの情報を取得できるか・副作用なしが確認できるか評価する。不可なら `STOP_UNSAFE_METHOD`。Shell、別Tunnel、サービス起動へ移行しない。
- [ ] **Step 3 — Connectionを限定確認:** 承認範囲で一度だけ既存接続の可用性を確認する。前回同様のTunnelエラー、権限拒否、利用不能なら `STOP_CONNECTION_BLOCKED` とし自動再試行しない。
- [ ] **Step 4 — Evidenceを残す:** 非機密の停止理由、時点、取得方式・Owner承認参照を記録する。停止であってもPreflight文書作業の失敗とみなさない。

**Task test:** `GO_READ_ONLY`以外からTask 2/3のHostアクセスは起きず、接続不能でも別経路・副作用を発生させない。

### Task 2: H1〜H3 — Host・Build・Plugin参照の静的Identity

**Files:** Read-only: H1〜H3対象HostメタデータとGitHub固定Source、Design §5 H1〜H3。Write: Evidence Recordの非機密記載のみ（Owner許可済み受け渡し先）。

**Interfaces:** Consumes: Task 1 `GO_READ_ONLY`。Produces: H1, H2, H3の各静的Verdictおよび未検証項目一覧。実行ファイル・Build元Commit・参照設定を混同しない。

- [ ] **Step 1 — H1のIdentityを観測:** Host名、Repository実Path、Host HEADとWorktree状態、Launcher `~/.local/bin/opencode2` の実参照先、OpenCode実バイナリVersion/実測SHA-256をRead-onlyで確認できる範囲で取得。取得できなければ項目別にNOT_VERIFIED。Launcher名やOwner観測だけでDigestを埋めない。
- [ ] **Step 2 — H2のBuildを照合:** Pluginの実Artifact Path、`dist/opencode-plugin.js`、実測Digest、**既存の**生成元Commit証拠を照合。Build/再Buildはしない。CommitとArtifactの追跡が不能なら `H2=NOT_VERIFIED` を維持。
- [ ] **Step 3 — H3の登録経路を照合:** Launcher → 使用設定 → `plugin`参照 → H2 Artifactの対応を非機密の設定キー・実Pathだけで評価。Credentialを含む可能性がある設定全文は取得しない。安全な限定表示が不可能ならH3をNOT_VERIFIED。`CONFIGURED`、`RESOLVABLE`、`RUNTIME_LOADED=NOT_VERIFIED`を区別する。
- [ ] **Step 4 — RF-01〜03を確認:** Host HEAD欠測、Build来歴欠測、登録だけでロード済み未証明の場合に、それぞれ静的VERIFIED/Runtime成功へ誤昇格していないことをEvidence上で確認する。
- [ ] **Step 5 — 判定を記録:** 各Hの`VERIFIED/NOT_VERIFIED/BLOCKED/OBSERVED_MISMATCH`、取得根拠、実測値、未証明事項を記録する。

**Task test:** 3項目が同じ実体を指すという根拠がそろわない限り「Pluginロード準備完了」を主張しない。Pluginは起動しない。

### Task 3: H4〜H5 — 専用State/Stop境界の静的保証範囲

**Files:** Read-only: Design §5 H4/H5・§7.2、既存Hostの非機密Path/所有/Link/共有メタデータ。Write: Evidence Recordの非機密記載のみ。

**Interfaces:** Consumes: Task 1 `GO_READ_ONLY` とTask 2のIdentity。Produces: H4/H5静的Verdict、Owner固定が必要な項目・安全制約の一覧。未来のProcess PIDやSessionを生成しない。

- [ ] **Step 1 — H4既存境界を列挙:** Workspace、Local `.justice`、Global Wisdom、OpenCode Config/Data/State/Cache、Session、Evidenceの既存実Path・利用主体/所有者・共有/専用・想定書込み可否を、非機密メタデータから取得する。未知の書込み先は不存在扱いしない。
- [ ] **Step 2 — H4専用境界を照合:** E1用各領域の**Owner固定済み**の具体Pathまたは一意展開可能な専用Root/命名規則を照合。候補だけならVERIFIEDにしない。Global Wisdomは`JUSTICE_GLOBAL_WISDOM_PATH`の固定解決先を別判定とし、親Path・Symlink・Mount・所有の交差をRead-onlyで調べる。未生成Pathの将来の非交差は条件付き評価に留める。
- [ ] **Step 3 — H4書込み先を照合:** `createGlobalFs()`、`JusticePlugin.initialize()`のRestore/Recovery、OpenCode/Plugin初期化時の作成・ログ・Cache/State更新等の**既知または不明**の書込み先を専用Allowlistへマッピングする。未解明書込み先はNOT_VERIFIED、避けられない共有State書込みが観測されればOBSERVED_MISMATCHとする。実際に初期化はしない。
- [ ] **Step 4 — H5プロセスと撤収境界を照合:** 将来の専用Launcher/Executable、Workspace/Config/Session、実行単位ID、起動後のPID+開始時刻+実体Path照合契約、専用子プロセス判定、Stop拒否条件、専用生成物Exact Path Cleanup AllowlistとEvidence保持方針を静的に固定済みか確認する。既存OpenCode PIDを停止対象に含めない。未来PIDを創作しない。
- [ ] **Step 5 — RF-04〜05と判定:** Global/Session共有、Path未固定、Symlink不明、Stop単位不明、Cleanup所有不明のいずれかがあればH4/H5をVERIFIEDへ昇格させない。必須静的条件を**すべて証拠付きで満たす**場合だけそのHをVERIFIEDとする。実行時非干渉・OS隔離は未証明と明記する。

**Task test:** H4 `VERIFIED` はDesignの5条件、H5 `VERIFIED` はDesignの4条件に限られる。Stop/削除/Config変更を一切行わない。

### Task 4: 単一Evidence RecordとE1判断候補のOwner Checkpoint

**Files:** Produce: `H1〜H5 Read-only Identity / Boundary Evidence Record`（会話内又はOwner指定の保存先）。Read-only: Design §7.1〜7.3、既存S5 Plan/Runbook。No repository mutation.

**Interfaces:** Consumes: Task 1〜3の観測または停止理由。Produces: H1〜H5の5Verdict、保証限界、E1判断候補**1件**、未承認事項、Human Ownerの判断材料。

- [ ] **Step 1 — Recordを構成:** 各Hについて固定対象、取得方法、時点、非機密の事実、Digest、検証条件の成立/不足、制限、Verdict、Owner承認参照を記載。実行できない場合は該当部分をBLOCKED/NOT_VERIFIEDと区別して記録。
- [ ] **Step 2 — 1件のE1判断候補を選ぶ:** Design §7.3の**優先順**（重大・未解消安全問題→証拠不足→安全に限定可能な準備不足→全H静的条件成立）をそのまま適用する。`E1_SAFETY_HOLD / E1_NOT_VERIFIED / E1_LIMITED_PREPARATION_REQUIRED / E1_READY_FOR_OWNER_DECISION` のいずれかを提示する。H4/H5専用Path、Stop対象、Cleanup Allowlist未固定ならREADYは禁止。
- [ ] **Step 3 — 安全状態を照合:** `E1/E2/E3=HOLD`、`BOUNDED_COMPLETE=PENDING`、`RELEASE_APPROVED=PENDING`を維持し、Runtimeロード/非干渉やAC PASSを主張していないことを確認する。T09〜T15を再利用可能な既存Evidenceとして保全する。
- [ ] **Step 4 — Owner Checkpointで停止:** 達成事項・残余リスク・未承認事項・実質的な次の選択肢を簡潔に報告して終了する。接続不能でも次Task・再試行を自動開始しない。

**Task test:** 5件の静的VerdictとE1候補の条件が一貫し、不明値や未承認操作をPASS/GOに転換していない。証拠がなくても本Planの文書完成は可能。

## Plan Acceptance / Stop

**本Plan作成Taskの完了条件:** R0.1.1のH1〜H5と判定契約、S5 Plan/RunbookのHost GO境界に矛盾しない最小実行計画を、Ownerが採否判断できる形で提示すること。Host未接続・全H未検証のまま文書作成を終了できる。

**Read-only確認Taskの完了条件（別承認後）:** 限定確認を1回実施し、確認できた事実と阻害要因をEvidence RecordにまとめてOwner Checkpointで停止すること。全H VERIFIEDは無条件の完了要件ではない。

**即時停止:** 接続不能・未承認・資格情報/Session本文へのアクセスが必要・副作用排除不能・Host/Repo Identity不一致・共有State干渉・未知の停止対象など。対象だけHOLDし、無関係業務を機械的に止めない。

**残余リスク:** Runtime Pluginロード、実行時非干渉、Credential/Network有効隔離、E2/E3の安全なFault Injection/Restartは本Planでは証明しない。E1の実行方法はH1〜H5結果と独立Owner承認に依存する。

**STOP / NO AUTO HANDOFF:** R0.1.1 Owner Adoption PENDING / H1〜H5 NOT_VERIFIED / E1〜E3 HOLD / BOUNDED_COMPLETE PENDING / RELEASE_APPROVED PENDING。Planを採択してもHost操作・GitHub書込み・E1は承認されない。追加レビュー、実装、次Taskを自動開始しない。
