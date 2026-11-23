# Justice v6 S5 — Operation / Completion Implementation Plan R0.1 (D-S5-08-Aligned / Execution HOLD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` or `superpowers:subagent-driven-development` **only after separately authorized execution**. Steps use checkbox (`- [ ]`) syntax. No automatic implementation, Host probe, review dispatch, commit, or release.

**Goal:** S1〜S3の採択済み範囲について、D-S5-08の既存Ubuntu Host / OpenCode V2.3.2でAC-H01〜H03を確認し、安全なOpt-in・停止・切戻し手順と証拠を示して、Human Ownerが限定完成と運用開始を別々に判断できるようにする。

**Architecture:** 既存のS1診断、保存Source wrapper・明示Correlationを受け取るS2-b Offline Adapter、採択済みS3-b単一プロセスDecision / Lifecycle Consistency Recoveryを再利用する。Host取得、保存入力検証、Offline診断、限定Recovery観測を分離し、追加のRouter・Host Enforcement・Recovery Engineを作らない。成果物はAcceptance Evidence Record、Minimal Operation Runbook、Owner Completion Decisionの3件に限定する。

**Tech Stack:** OpenCode V2（対象Versionは受入前にOwner固定）、既存Justice TypeScript/Bun/Vitest、既存S1/S2/S3実装、Markdown、Git（証拠参照のみ）。

**Requirements:** `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md`（R0.1、feature HEAD `f19859bcd20bcc85e64acb24a82bee4ae3b9d630`）。

**Design:** Human Owner adopted the D-S5-08/Approach A [Design Addendum](../specs/2026-11-23-justice-v6-s5-d08-host-v232-design-addendum.md) as bounded **design policy**. This Plan is document-aligned but **does not authorize** Source/Test implementation or Host execution. Host binary SHA, dedicated paths/Scope, GET mechanism, Secrets/Network, S3-b restart/readback, stop/rollback and Opt-in operations still require separate fixing and approval.決めていない操作を推測で実行してはならない。

**Issue:** [#358](https://github.com/yohi/justice/issues/358) / 全体進捗 [#388](https://github.com/yohi/justice/issues/388)。

**Status:** `DESIGN_ADDENDUM_ADOPTED / PLAN_DOCUMENT_ALIGNED / SOURCE_IMPLEMENTATION_NOT_AUTHORIZED / HOST_GO_HOLD / AC_H01_H03_NOT_RUN / RELEASE_NOT_AUTHORIZED`。

## Global Constraints

- D-S5-01〜04/06〜07を維持し、**D-S5-05独立HostをD-S5-08既存Host・論理分離へ限定置換**する。S1・S2・S3の限定完成のみ対象。S3-c、S4、全Finding解消、複数プロセス保証は対象外。
- 実HostのAC-H01〜H03をすべてPASSするまで `BOUNDED_COMPLETE` を認定しない。CI・mock-I/O・静的Fixtureのみでは代替不可。
- AC-H01の境界は (1) 別承認の既存Host専用Sessionからの実2.3.2 Source取得、(2) 保存Source wrapperと明示Correlationの検証、(3) **既存** `runS2bOfflineAdapter` によるオフライン変換、(4) `UNKNOWN` / `NOT_VERIFIED` / `NOT_PROVEN` の非昇格。
- S2-cは `COMPARISON_NOT_ESTABLISHED`。Native-onlyとJusticeの改善・優位・因果効果を新たな受入証拠がないまま主張しない。
- AC-H03は採択済み**単一プロセスDecision / Lifecycle Consistency Recovery**。全面Semantic Recovery、任意Task/Revision/Finding復元、外部Tool副作用の巻戻し、複数プロセスは保証しない。
- 権限・Evidence・Lifecycleの不整合は影響対象をFail-Closedとし、独立した正常作業まで自動停止しない。Justice内部の拒否をHost実行前強制として主張しない。
- Gate/HOLD・v4/v5歴史状態は不変。既存環境にデフォルト導入しない。Hostでの作成・削除・実行、Secrets、Network、GitHub書込みは個別のOwner承認範囲だけで許可。
- 生Session/Message/Tool、秘密、Host固有の私的パス、Ground TruthをGitHubの公開文書に転記しない。保存したローカル証拠と公開可能な要約・Digestを区別。
- `S1aReadOnlySource` / `runS2bOfflineAdapter` の `READ_ONLY` は**入力処理の契約**でありSourceコード変更許可ではない。現行S2-bは `S2B_SUPPORTED_HOST_VERSION="2.2.5"` で、実2.3.2 wrapperを `SOURCE_VERSION_UNSUPPORTED` で拒否する。2.2.5/2.3.2限定AllowlistとValidator/Test変更は別Owner承認まで実装しない。
- 各Taskの終了時にOwnerの判断Checkpointを設ける。Taskの列挙は一括実行承認を意味しない。追加レビュー・新Finding修正・Handoff作成を自動連鎖させない。

## File Map / Responsibilities

| File | 目的 | 新規/変更 |
| --- | --- | --- |
| `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md` | Host/Version/Scope固定、AC-H01〜H03結果、証拠Digest、保証限界 | 既存骨格・AC未実行 |
| `docs/superpowers/operations/justice-v6-s5-minimal-operation-runbook.md` | Opt-in、正常フロー、停止、保護境界を迂回しない切戻し | 既存骨格・Enable未承認 |
| `docs/superpowers/decisions/justice-v6-s5-owner-completion-decision.md` | 限定完成とReleaseの独立Owner Decision | 既存骨格・両判断PENDING |
| `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` | 要件の固定参照、変更しない | READ_ONLY |
| `src/runtime/s2b-input.ts`、`src/runtime/s2b-offline-adapter.ts`、`src/runtime/s2b-contract.ts` | Source/Correlation validation、Offline Adapter | READ_ONLY |
| `src/runtime/s1d-diagnostic.ts`、`src/runtime/s1d-cli.ts` | S1診断の既存経路 | READ_ONLY |
| `src/core/acceptance-decision.ts`、`src/core/review-artifact.ts`、`src/core/justice-plugin.ts` | S3-bの既存Decision/Lifecycle整合 | READ_ONLY |
| `docs/reports/2026-11-14-justice-v6-s2c-limited-comparison.md` | S2-c比較未成立の証拠正本 | READ_ONLY |

**既存の関連テスト（実行済み証拠とは扱わない）:** `tests/s2b/adapter.test.ts`、`tests/s2b/input.test.ts`、`tests/core/acceptance-decision.test.ts`、`tests/core/review-artifact.test.ts`、`tests/integration/s3a-review-artifact-to-acceptance.test.ts`。`package.json` の `bun run test` はVitest全体実行。いずれも新しい実Host証明の代替ではない。

## Global GO / STOP Gate

実Host作業は次の**すべて**が個別に満たされた後に限る。

1. D-S5-08 Design AddendumはOwner採択済みだが、**Host GO/Source実装GOとは別**。実行用Manifestの旧条件と本Planの照合・独立Owner承認が必要。
2. 既存Ubuntu `coreultra7-270k` / OpenCode V2.3.2はOwner実測（**バイナリSHA未測定**）。Source wrapperは実Versionに忠実な `hostVersion="2.3.2"` を使用し偽装しない。現行S2-b 2.2.5-only gateでは拒否されるため、別承認の互換実装/正負テストが終わるまでAC-H01はHOLD。Host ID/Justice Commit/Scope/Operation/Session/Network/Secrets/Writable/停止/切戻しもGO前に個別固定。未知VersionはFail-Closed。
3. AC-H01〜H03の具体的な入力と観測方法を定め、正式なHost実行承認を得る。
4. 専用Workdir/Session/Task/Fixture/Private Evidence/Single Writerの非干渉を確認する。既存HostはOSユーザー権限/Network/継承Secretsを共有し得る。XDG分離/`--standalone`は強制隔離ではない。安全性を証明できない操作だけHOLD。
5. 信頼できるOwner固定Artifact参照がない場合、承認の真正性を `NOT_PROVEN` として、実証不可能なACはPASSにしない。

**実Host GO不成立時の停止範囲:** 上記Gateは実Hostを利用するTask 3〜5の操作（Source取得、実Host診断、異常系検証、プロセス再起動、Host上のCleanup等）に適用し、未承認なら実行せず停止する。Secrets / Network / 外部書込みを含むHost操作は、文書作業の承認によって許可されない。Task 1・2およびTask 6の**文書準備のみ**は、別途Human Ownerが承認した文書作業の範囲で実施可能とする。Host / Version / Scope / Operation等が未固定の場合は未固定と明記し、実Host受入結果を創作しない。未実行は `NOT_RUN`、証拠欠落は `NOT_VERIFIED`、観測した不一致は `FAIL` と分ける。AC-H01〜H03の実Host PASSとOwnerの明示判断が揃うまで `BOUNDED_COMPLETE` を認定しない。`RELEASE_APPROVED` を推定・自動設定しない。

---

### Task 1: Acceptance Evidence Recordの基準・証拠台帳を作成

**Files:**
- Existing; update only after authorized AC execution: `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`
- Reference only: Requirements R0.1、Issue #355/#356/#358/#388、S2-c限定レポート

**Inputs:** D-S5-01〜07、AC-H01〜H03、既知制限、実Hostの承認済み対象情報。

**Produces:** ACごとに結果・証拠・由来・不足・制限を持つ1つの台帳。現段階の3件は `NOT_RUN`。

- [ ] **Step 1 — 文書骨格:** `Host / Version / Justice Commit / Scope / Operation / Source provenance / Authority / Secrets & Network limits / Cleanup` と `AC-H01`、`AC-H02`、`AC-H03` の欄を作る。実測していない値は「未固定」「NOT_RUN」等と記述し、値を創作しない。
- [ ] **Step 2 — 結果型:** 各ACに `Outcome`（PASS/FAIL/NOT_RUN/NOT_VERIFIED）、`Observation`、`Evidence ref`、`Digest`、`Source confidence`、`Limitations`、`Owner approval ref` を設ける。FAIL/NOT_VERIFIEDを自動的にPASSへ変換しない。
- [ ] **Step 3 — 過去情報の継承:** S2-c=`COMPARISON_NOT_ESTABLISHED`、S3-a M-2、Legacy Staging制限、外部Writer durability未証明、S3-b Runtime未検証等を既知制限欄へ出典付きで記録する。
- [ ] **Step 4 — 文書検査:** `rg -n 'AC-H0[123]|NOT_RUN|COMPARISON_NOT_ESTABLISHED|M-2|BOUNDED_COMPLETE|RELEASE_APPROVED' docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md` を実行し、各項目が存在することを確認する。これは**文書整合**であって実Host受入ではない。

**Task exit:** 3件のACが未実行のままでも、証拠・帰属・制限を記録可能。Host未固定の場合も、別途Ownerが承認したTask 2・Task 6の文書準備は妨げない。実Host利用操作はGlobal GO / STOP Gate成立と個別承認まで開始しない。

### Task 2: Minimal Operation Runbookの安全境界を作成

**Files:**
- Existing; update only with Owner-authorized operations: `docs/superpowers/operations/justice-v6-s5-minimal-operation-runbook.md`
- Read only: 既存OpenCode V2 Nativeフロー、S3-a/bの採択済み仕様と要件R0.1

**Inputs:** 固定するHost/Version/Scope、保護対象、停止・切戻し境界。

**Produces:** 実行条件を満たさない場合に操作を禁止し、OwnerがOpt-in / Stop / Rollbackを区別できる最小手順。

- [ ] **Step 1 — 前提条件:** D-S5-08の既存Host/論理分離限定、デフォルトOFF、必要なOwner許可、許容するSecrets/Network/副作用、対象Operationを明示する。
- [ ] **Step 2 — 状態別手順:** `PREPARED → ACCEPTANCE_VERIFIED → OPT_IN_APPROVED → ENABLED → STOPPED/ROLLED_BACK` を**運用上の説明用状態**として記述し、Justiceの新しいRuntime状態・永続スキーマとして実装しない。
- [ ] **Step 3 — 停止表:** Source欠落、Authority不一致、Lifecycle不整合、診断表示失敗、予期しない副作用、切戻し不能について「影響する対象」「停止・保留する操作」「独立正常作業を継続できる条件」を記す。Host実行前強制が未証明なら明確に書く。
- [ ] **Step 4 — 切戻し検証:** 未承認のGate/HOLD書換え、既存Hostへのインストール、Secrets移送、Live Tool副作用Replayを要求する手順がないことを文書上で確認する。具体的な有効化コマンドや破壊的CleanupはDesignとOwner承認が確定するまで記載・実行しない。

**Task exit:** Ownerが安全な停止・切戻しの可否を判断できる。実際のOpt-in開始は別承認。

### Task 3: AC-H01 — 実Source → 保存入力検証 → 既存S2-b Offline診断

**Files:**
- Update evidence only: `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`
- Read only: `src/runtime/s2b-input.ts`、`src/runtime/s2b-offline-adapter.ts`、`src/runtime/s2b-contract.ts`、S1入力契約

**Interfaces (existing, not new API):**
- `runS2bOfflineAdapter(request: S2bRequest, source: S1aReadOnlySource, runS1d?: typeof runS1dDiagnostic): Promise<S2bReportV1>`。
- `S2bRequest = { loaderInput, sourcePath, correlationPath }`。`S2bReportV1.adapter.status` は `REJECTED | LIMITED | PROJECTED`。`coverageCompleteness` は `NOT_ESTABLISHED`。

- [ ] **Step 1 — Owner Host GO確認:** 対象Version・Operation・取得境界・秘密を固定。許可がなければ `NOT_RUN` と記録して終了。
- [ ] **Step 2 — Source取得（Design指定のみ）:** 別途Ownerが承認した既存Hostの専用Sessionから実2.3.2の指定範囲のみを取得し、ローカル保存Source wrapper・明示Correlationを固定。コピーDigestと取得条件を記録。GitHubに生Message/Toolを送らない。Host APIの実操作は採択Designに指定された手順以外では実施しない。
- [ ] **Step 3 — Offline検証:** 保存したSource wrapperとCorrelationを既存S2-bのValidation/Adapterに渡す。必要なOwner固定TaskIntent・Artifact Identityは独立の信頼源と照合。Source欠測、未確立Correlation、不正な入力を隠さない。
- [ ] **Step 4 — 結果分類:** `REJECTED` なら誤受入れなしを確認し、AC-H01自体はPASSにしない。`LIMITED` / `PROJECTED` でもS1-d診断への到達、Task/Revision/Scope/AC帰属、欠測、`NOT_ESTABLISHED` を別々に記録する。単なるReport生成だけでHost完全性を認定しない。
- [ ] **Step 5 — 証拠確定:** Evidence RecordにHost/Version/Operation、匿名化した入力参照・Digest、結果、Limitationsを記録。予定された必須保証が全部成立した場合のみAC-H01をPASS。

**Task exit:** 実Host Source取得・入力検証・Offline診断の責務を混同せず、受入可否が判定できる。既存Adapterに新しいオンライン収集機能を追加しない。

### Task 4: AC-H02 — Authority / Evidence異常の限定Fail-Closed

**Files:**
- Update evidence only: `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`
- Read only: `src/runtime/s2b-input.ts`、`src/core/acceptance-decision.ts`、S1-b/c/d契約

- [ ] **Step 1 — 安全な異常データ選定:** 承認した既存Host専用Sessionの**保存入力のコピー**のみを用い、(a) Task/Revision/Scope不一致、(b) Evidence欠測、(c) Authority不一致または未証明の3ケースを作る。Host既存Dataや原本Evidenceを上書きしない。
- [ ] **Step 2 — 予想境界の記録:** 各ケースの事前期待を「受入拒否/保留」「UNKNOWN・NOT_VERIFIED・NOT_PROVEN維持」「無関係Taskへ波及なし」と記述する。実際にHost実行前拒否を保証していない場合は対象外と明記。
- [ ] **Step 3 — Owner実行GO後の検証:** 採択Designで許可した診断経路のみで評価し、対象外Sourceを流用してPASSにしない。想定外のAuthority書込みやGate/HOLD変更が生じる兆候があれば当該ケースを即時停止。
- [ ] **Step 4 — 判定:** 不一致の誤受入れが観測されたらFAIL。証拠不足ならNOT_VERIFIED。安全に対象操作だけ保留できた実観測と、Host強制未証明の境界を両方記録する。

**Task exit:** AC-H02の必須異常ケースに対し限定境界の観測証拠が揃う。Host Enforcementの成功とは主張しない。

### Task 5: AC-H03 — 単一プロセスDecision / Lifecycle Consistency Recovery

**Files:**
- Update evidence only: `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`
- Read only: `src/core/acceptance-decision.ts`、`src/core/review-artifact.ts`、`src/core/justice-plugin.ts`、既存S3-b Design R0.1.2

- [ ] **Step 1 — 境界固定:** Ownerが承認した既存Host上の**単一プロセス/単一Writer/専用Durable State**だけを対象。再起動と失敗注入の可否・原状復帰策をDesignで固定。複数プロセス・外部Writerは対象外。
- [ ] **Step 2 — 安全な局所状態作成:** 既存正当CorrelationとStaged履歴のあるケース、Decision永続化後に対応Lifecycleが欠けるケース、不正な重複Lifecycleのケースを採択Designに沿って準備。外部Tool呼出しや実副作用はReplayしない。
- [ ] **Step 3 — 既存経路でのRestart観測:** `JusticePlugin.initialize()` のauthoritative restore条件と専用FileReader/FileWriter境界をOwner固定し、安全な失敗注入/Restart手順が別途承認された場合だけ専用プロセスを再起動し、Decisionと対応LifecycleのDurable Readback、Task/Plan Progressの非早期進行、重複遷移Fail-Closedを観測する。mock-I/Oの既存PASSを実Host観測に代入しない。
- [ ] **Step 4 — 判定:** 整合状態の限定回復と、不整合時の非進行が双方確認できた場合だけAC-H03 PASS。観測できなければNOT_VERIFIED、実際に不正進行ならFAIL。任意状態の全面復元、外部Tool副作用の巻戻しは主張しない。
- [ ] **Step 5 — 後片付け:** 承認済み既存Hostの**専用生成物Allowlistだけ**をCleanup対象とし、既存Gate/HOLDや他のTaskを変更しない。証拠とCleanup範囲を台帳に記録する。

**Task exit:** 採択済み単一プロセスRecoveryの限定Host受入可否が記録される。S3-cや複数プロセス保証を追加しない。

### Task 6: Owner Completion Decision — 限定完成とOpt-in利用開始を分離

**Files:**
- Existing Human Owner-only decision skeleton: `docs/superpowers/decisions/justice-v6-s5-owner-completion-decision.md`
- Read only: Acceptance Evidence Record、Minimal Operation Runbook、Issue #355/#356/#358/#388

**Produces:** `BOUNDED_COMPLETE` と `RELEASE_APPROVED` の独立判断、対象Host/Version/Scope、既知制限、署名/参照可能なOwner判断記録。

- [ ] **Step 1 — 受入総括:** AC-H01〜H03の3結果と個別証拠を表に記載。いずれかがFAIL / NOT_RUN / NOT_VERIFIEDなら `BOUNDED_COMPLETE` を採択済みとして書かない。さらに、対象Scope / Versionの特定、証拠と診断結果の帰属確認、既知制限・未実証事項の明示、必要な保護を迂回しないOpt-in・停止・切戻し手順の成立を確認し、Human Ownerの限定完成に対する明示判断を記録する。これらが揃わない場合も限定完成を採択しない。`RELEASE_APPROVED`は別のOpt-in許可として独立に判断する。
- [ ] **Step 2 — 残余リスク区分:** S2-c比較未成立、S3-a M-2、Legacy Staging、外部Writer durability、複数プロセス・S3-c・S4非対象、Source完全性/真正性限界を記載。安全上重要で制限不能な操作のみ停止対象として提示。
- [ ] **Step 3 — 二つの独立Decision欄:** `Bounded completion: APPROVED / NOT_APPROVED / PENDING` と `Opt-in release: APPROVED / NOT_APPROVED / PENDING` を分ける。AIがOwnerの承認値を埋めない。
- [ ] **Step 4 — 終了:** Human Owner判断を受けて該当レコードだけ更新する。完成済みでもRelease未承認なら導入しない。自動のPR・Merge・Deploy・Review・次Taskを開始しない。

**Task exit:** Task 6のOwner Decision文書の準備は、文書作業のOwner承認範囲内なら実Host GO前でも可能。`BOUNDED_COMPLETE`は、AC-H01〜H03の実Host PASS、対象Scope / Versionの特定、証拠と診断結果の帰属確認、既知制限・未実証事項の明示、必要な保護を迂回しないOpt-in・停止・切戻し手順の成立、およびHuman Ownerの明示採択がすべて揃った場合に限る。`RELEASE_APPROVED`は独立したOpt-in許可として別に判断し、推定・自動設定しない。判断が得られなくても `PENDING` で本計画の作成作業は停止可能。

## D-S5-08 implementation/acceptance contract — documentation-only, NOT_RUN

- **Version:** 2.2.5 existing regression preserved; bounded 2.3.2 target **NOT_IMPLEMENTED**; unknown/missing/misdeclared Version rejected. `oc225-msg-` origin and `issuerId="opencode-v225-record"` are historical Evidence labels, not Host attestation.
- **API/input:** native `session.get` and `session.messages` GET, initial `order=asc`, fixed `limit=1..200`, subsequent `cursor.next`, no `type` filter; raw response bytes in `justice-s2b-source-v1`, independent `justice-s2b-correlation-v1`. The actual `--standalone` read mechanism is NOT_VERIFIED/NOT_AUTHORIZED. S2-b `S2bRequest={loaderInput,sourcePath,correlationPath}` + `S1aReadOnlySource` stays offline READ_ONLY.
- **Test design:** adopt Addendum §3.3 P-01..P-04, N-01..N-05B, with explicit 2.2.5 regression and unknown Version fail closed. Existing `isMessage()` does **not validate** optional `time.firstToken`; malformed firstToken alone is **not automatically REJECTED**. Complete well-formed foreign-only Correlation may give `FOREIGN_TASK_EXCLUDED`, `PROJECTED`, **zero selected Evidence**; that is not AC-H01 PASS. Malformed/competing/missing bindings retain conditional `REJECTED/LIMITED`; no cross-task Evidence admission. `coverageCompleteness=NOT_ESTABLISHED`. These are unexecuted expectations.
- **AC-H03:** only existing `JusticePlugin.initialize()` authoritative recovery path, dedicated durable FileReader/FileWriter and single Writer, reversible injection/restart and independent Readback. No Host-safe method verified; if unsafe, HOLD.
- **Nonfunctional:** preserve existing credentials/Session/Workspace/Gate/HOLD, no shared config edits, uncontrolled Network or external Tool effects, and no destructive cleanup. The untracked local Host Manifest remains unreconciled. **Source implementation NOT_AUTHORIZED / Host GO HOLD / ACs NOT_RUN**.

## 受入トレーサビリティ

| Requirements | Plan task | 完了の証拠 |
|---|---|---|
| D-S5-01、D-S5-02、D-S5-05→D-S5-08、D-S5-06 | 1, 3, 4, 5, 6 | 既存Host/論理分離の固定、AC-H01〜H03の実Host PASS |
| D-S5-03、D-S5-04 | 2, 4, 6 | 安全なOpt-in・停止・切戻し、影響限定Fail-Closed |
| D-S5-07 | 1, 2, 6 | 3成果物のみ |
| S2-b Offline/Source分離、S2-c未成立 | 1, 3, 6 | Source provenance、入力検証、限定診断、制限の明記 |
| S3-b採択済みRecovery範囲 | 1, 5, 6 | Decision/Lifecycleの単一プロセス限定証拠 |
| 完成/Releaseの分離 | 2, 6 | 二つの独立Owner Decision |

## Self-check / Stop

- 本Planは採択D-S5-08 Design Addendumを代替しない。旧ローカル未追跡Design/Host Manifest R0.1は改変しておらず、Host GO前に整合または明示的に旧稿を無効化する必要がある。
- この計画では新規Runtime API、State Schema、Code/Tests/CI改変を要求しない。既存機能で足りない場合は未実証のままOwnerへ報告し、勝手に補完しない。
- `BOUNDED_COMPLETE`の条件は、実Host AC-H01/H02/H03のPASS、対象Scope / Versionの特定、証拠と診断結果の帰属確認、既知制限・未実証事項の明示、必要な保護を迂回しないOpt-in・停止・切戻し手順の成立、およびHuman Ownerの明示採択。`RELEASE_APPROVED`は独立したOpt-in許可。
- 次工程を自動実行しない。新規Findingや新Versionだけを理由に独立レビュー/訂正/再レビューを繰り返さない。
- Plan自体の作成でGitHub反映、Host実行、利用開始は承認されたとみなさない。
