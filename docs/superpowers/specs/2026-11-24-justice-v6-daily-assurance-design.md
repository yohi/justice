# Justice v6 — Daily Development Assurance Integration Design R0.1

> Status: `BASIC_DESIGN_OWNER_ADOPTED / IMPLEMENTATION_PLAN_CANDIDATE / IMPLEMENTATION_NOT_AUTHORIZED / LIVE_NOT_AUTHORIZED`
> Date: 2026-11-24 (JST)
> Tracker: [#401](https://github.com/yohi/justice/issues/401); Parent: [#388](https://github.com/yohi/justice/issues/388)
> Baseline: `0195966130fb06b93c5ad79601d563307fd8df11` (implementation baseline `896acee25323c0e5b6dc97e0dd936efff1b9e434`)
> Owner adopted the goal, automation level, integration approach and basic design in the 2026-11-24 conversation; this document records that decision. The detailed R0.1 implementation plan remains subject to execution approval. Saving these documents does not grant implementation or live-operation authority.

## 1. Purpose / Goal

Superpowersで承認したDesign・Plan・Task・ACと、OpenCode V2が実行した操作および実際のコード変更を結び付け、既存JusticeのAssurance機能を日常開発の品質保証に利用する。最優先目的は未承認のネガティブな乖離の防止・検出・是正支援であり、今回の保証は観測・診断・Advisoryに限定する。Host側の実行前強制や包括的な意味的乖離検出を実装済みと主張しない。

既存SuperpowersがWorkflow、Review、Fix、Task完了の手順を所有し、OpenCode V2が実行を担う。JusticeはIntent/Evidence/Scope/Authorityの接続と診断を担当し、既存のWorkflowを置き換えない。

## 2. Existing implementation / gap

- S1-a/b/c/d: Artifact Identity、Evidence Binding、candidate scope診断、Read-only診断の既存実装を再利用する。S1-aはOwner Authorityを独立検証しない。S1-cの正式判定はUNKNOWNを維持する。
- S2-b: 保存済みNative Source / Correlationの厳密検証、Evidence Projection、S1-dへの接続を再利用する。現行v1のNative diffProjectionはUNAVAILABLE固定であり、既存契約を変更しない。
- S3: 単一Writer等の採択済み限定保証を維持。今回、新規Recovery機構やGate状態は追加しない。
- OpenCode V2 plugin: 現行はjustice_reviewの閲覧とresolve拒否のみ。H3限定Runtimeは実証済みだが、新規TaskのEvidence収集・Task境界・診断還元は未接続。
- Git ChangeSetはNative Sourceとは別の入力として収集し、既存S1-c/S1-dへ渡す。Native diffを利用可能と偽らない。完全な変更履歴や意味的乖離の検出は保証しない。

References:
- [S5 Owner Completion Decision](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/docs/superpowers/decisions/justice-v6-s5-owner-completion-decision.md)
- [S5 Minimal Operation Runbook](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/docs/superpowers/operations/justice-v6-s5-minimal-operation-runbook.md)
- [V2 plugin](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/src/opencode-v2-plugin.ts)
- [S2-b adapter](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/src/runtime/s2b-offline-adapter.ts)
- [S1-d diagnostic](https://github.com/yohi/justice/blob/0195966130fb06b93c5ad79601d563307fd8df11/src/runtime/s1d-diagnostic.ts)
- [OpenCode v2.3.2 Tool SDK](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/tool.ts), [Skill SDK](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/skill.ts) (static interface evidence; actual integration not yet verified).

## 3. Considered approaches / adopted decisions

| Decision | Alternatives considered | Adopted |
|---|---|---|
| Goal | A 現行機能利用、B 日常開発の品質保証、C OC2 Daily Launcher統合、D 限定版Release先行 | B 日常開発の品質保証 |
| Automation | A 手動診断、B 自動診断・Advisory、C 強制Gate | B 自動診断・Advisory |
| Integration | A Native Hook中心、B Superpowers Skill中心、C Native Hook＋Superpowers連携 | C Native Hook＋Superpowers連携 |

HookのみではSession idle等をTask完了と誤認するおそれがあり、Skillのみでは観測されたNative実行との対応が弱い。案Cは明示的Task境界とNative実行Identityを分離して接続し、既存Superpowersの進行とNative APIを尊重する。呼出漏れ・未観測・未知の帰属は成功として扱わない。強制Gateや専用Workflow Engineを新設しない。

## 4. Architecture / responsibilities

```text
Superpowers (Design / Plan / Task / Review)
  -> Intent Bridge (pre-execution binding)
  -> OpenCode V2 (normal execution, native hooks)
  -> Evidence Bridge (bounded native source + independent Git ChangeSet)
  -> Existing S1/S2 diagnostic pipeline (S3 guarantees unchanged)
  -> Advisory Bridge (one diagnosis at explicit task-end boundary)
  -> Existing Superpowers review / completion flow
```

### Intent Bridge

Ownerが承認したManifest / TaskIntent / Artifact / Scope Policy / AC、対象Session/WorkspaceとGit基準点、Tool→AC帰属規則を実行前に固定する。既存契約・検証を再利用し、実行後の修正で成功へ昇格させない。自己申告approvalRefをOwner承認と同一視しない。

### Evidence Bridge

Native Hookは必要最小限の実行Identityの観測に使い、固定SessionのNative Sourceから既存S2-b形式のEvidenceを得る。事前規則に合致する実Identityだけを対応付け、取得漏れ、曖昧性、未対応Sessionは非昇格。実Git ChangeSetは読み取り専用で独立取得し、既存S1-cの候補Scope比較に渡す。S2-b v1 reportは互換維持する。

### Advisory Bridge

Superpowersの明示的Task開始/完了候補を境界とし、診断結果を既存フローに返す。実行したToolの終了、Session idle、Task完了、Owner承認は別の事象である。結果には限定Scope・証拠不足・帰属・候補Scope逸脱・未証明事項を示す。新規Findingだけでレビュー、修正、再実行を開始しない。既存justice_reviewを維持し、resolveを承認なしで許可しない。

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

## 5. Initial implementation scope and constraints

次の制約はIssue #401のR0.1 Planで具体化された初回実装範囲であり、既存の採択済み基本設計を拡張しない。詳細なInterface、ファイル、TDD手順は対応Planに記載する。実装時に固定SDKで成立しない接続は未対応として停止し、無断で別方式を採択しない。

- Superpowers First / OpenCode V2 Native First。初回は固定2.3.2、単一Task・単一Session・専用Git worktree・単一プロセス、executing-plansのinline実行。子Session、複数Writer、並行Task、他Versionは未対応。S4、V1全面移植、強制Gate、新規Review/Workflow Engine、Model Routerなし。
- Owner承認・Manifest/Intent digest・Task/AC対応規則・許可Tool/試験識別・Scope Policy・基準Commitを実行前に固定。LLMの自己申告approvalRefは承認にならない。既存S1-a契約のNOT_PROVEN維持。
- Scope Policyは既存Plan構造化ブロック（見出し `## Justice S1-c Task Scope Policies`、begin/end marker、justice-s1c-task-scope-v1、planRef/taskRef/scopeKey/allowedPaths）。自由文推測、事後修正による合格禁止。
- Hook記録はsessionID/messageID/callID/tool name/statusのみ。input/result/error、Provider payload、HTTP header、Credentialは記録しない。Native Sourceはraw検証契約上本文を含むため、専用の非機密Task Sessionだけを対象とし承認済みloopback Native APIからbounded memory取得。raw本文の永続化/ログ/Advisory/GitHub転送禁止。秘密混入の完全排除は未証明。境界不明時は収集停止。
- Task完了候補は明示begin/finishで判定。idle/tool終了だけで完了を推定しない。重複finishは同一処理を共有、失敗/中断/再起動後はUNKNOWN、無断再実行なし。
- 既存V1/V2 justice_review、S2-b v1 report/CLI、S1/S2 schemaと制限を保全。S1-c formalVerdict UNKNOWN、S1-a NOT_PROVEN、coverageCompleteness NOT_ESTABLISHED維持。AdvisoryはcandidateScopeComparisonと正式判定を分離。未証明事項は非昇格。
- Default OFF、専用Config/State/Workspaceのみ。共有設定・共有State・実Credential・外部Networkへのアクセス/変更なし。新規依存/Lockfile/SDK更新なし。実Provider/Network利用は別承認。
- 今回承認済みはIssue/Plan作成だけ。T1–5の実装、Build/Test、Commit/Push/PRは実行承認後に許可範囲内で行う。T6のHost実行は別GO。Release/Opt-in本番導入は未承認。追加レビュー/訂正/後続Task自動開始禁止。

## 6. Completion / stop / owner checkpoint

既存S5のBOUNDED_COMPLETE=APPROVEDを維持し、#355/#356/#358を再オープンしない。S4は延期、E1/E2/E3はHOLD、RELEASE_APPROVEDはPENDING。今回のDaily Assuranceは独立した追加接続である。

実装後のオフラインTDDと実運用確認は分離する。実用化の完了はAC-D01–08の根拠によって判断し、Plugin loadだけで成功としない。実Host・Provider・Credential・外部Networkを使う確認は固定対象・境界・費用・回数・停止手順を提示し、別途Owner承認を得る。取得不能・承認不明・危険な副作用・未対応SDK契約では該当操作を停止する。実証で残る限界は記録し、追加Taskを自動開始しない。

## 7. Implementation plan

- [Daily Development Assurance Integration — Implementation Plan R0.1](../plans/2026-11-24-justice-v6-daily-assurance.md)
- [Issue #401](https://github.com/yohi/justice/issues/401) records the original plan and tracking context.

No code, test, build, deployment, release, or independent review is authorized by this document save.
