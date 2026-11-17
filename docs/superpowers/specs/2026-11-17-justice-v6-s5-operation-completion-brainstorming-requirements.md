# Justice v6 — S5 Operation / Completion
## Brainstorming Requirements R0.1

**Status:** `BRAINSTORMING_REQUIREMENTS_CONFIRMED / DESIGN_NOT_ADOPTED / IMPLEMENTATION_NOT_AUTHORIZED`

**Date:** 2026-11-17 JST  
**Repository:** `yohi/justice`  
**Primary Issue:** [#358](https://github.com/yohi/justice/issues/358)  
**Overall Tracking:** [#388](https://github.com/yohi/justice/issues/388)  
**Base:** `master@b27853d919be5a113a690faf92e5f6bbc82d3b22`

> この文書はHuman Ownerとのbrainstormingで選択された**要件入力**である。正式Design、Implementation Plan、実装、Host検証、Opt-in有効化、releaseを自動的に承認しない。

---

## 1. 目的

Justice v6の採択済みS1・S2・S3について、実際に利用可能な範囲を限定的に実証し、Human Ownerがv6.0.0の完成と運用開始を判断できる状態にする。

設計・レビュー・証拠整理そのものではなく、**承認済み意図と実装成果の乖離を検出・制限できるJusticeを、安全に利用可能にすること**を目的とする。

Superpowers First / OpenCode V2 Native Firstを維持する。

## 2. 採択されたbrainstorming方針

| Decision | 採択内容 |
|---|---|
| D-S5-01 | S1・S2・S3の限定完成を対象とする |
| D-S5-02 | 最小限の実Host受入確認を必須とする |
| D-S5-03 | Human Ownerによる明示的Opt-inで運用開始 |
| D-S5-04 | 異常時は影響範囲限定のFail-Closed |
| D-S5-05 | 独立した隔離Hostで受入確認 |
| D-S5-06 | 必須受入PASSと既知制限の明示で完成判定 |
| D-S5-07 | 最小3成果物方式 |

これらはS5のbrainstormingにおける要件選択であり、設計採択・Host操作・実装・リリースを包括承認するものではない。

## 3. 対象範囲

### S1 — Assurance Core

- Artifact / Task / ACのIdentity整合確認
- Evidenceの型付き帰属確認
- Deviation診断
- 診断結果と根拠の表示
- 既存Native能力との重複を避けた限定利用

### S2 — OpenCode V2 Adapter

- **S5実Host受入のSource取得:** 別途承認された隔離HostでOpenCode V2の限定Sourceを取得する。Source取得は既存S2-b Offline Adapterの責務・オンライン機能ではない。
- **保存入力の検証:** 取得済みSource wrapperと明示Correlationを入力として検証し、取得範囲・Task / Revision / Scope等の帰属と欠測を区別する。Host全履歴の完全性・Sourceの真正性を自己申告だけで証明しない。
- **既存Adapterでの変換:** 検証した保存入力を既存S2-b Offline READ_ONLY Adapterに渡してS1契約へ変換・診断する。オンライン収集機能を新規追加する前提にしない。
- **保証水準の維持:** 不足・不可信・収集範囲外の情報は `UNKNOWN` / `NOT_VERIFIED` / `NOT_PROVEN` を適切に保持し、承認や実行の真正性を昇格させない。
- Native-onlyに対する追加価値の未実証状態を保持

S2-cの `COMPARISON_NOT_ESTABLISHED` を保持する。S2親Issueの限定受入判断はS5の最終Owner判断に含める。Source取得手順・安全条件・入力固定方式は、別途承認されるS5 Designで決定し、この文書ではHost操作や新たなAdapter機能を承認しない。

### S3 — Safety / Authority / Recovery

- S3-a Authority / Review Boundary
- S3-b — 採択済み単一プロセス限定Decision / Lifecycle Consistency Recovery
- 採択済み範囲でのDecisionと対応するDurable Lifecycleの整合性
- 不整合時の影響範囲限定Fail-Closed
- 既存Gate/HOLDの保護境界維持

**S3-b保証境界:** 全面的なSemantic Recovery、任意Task / Revision / Findingの復元、外部Tool副作用の巻戻し、複数プロセスRecoveryは保証対象としない。実HostにおけるDecision / Lifecycle Consistency Recoveryの安全性は未検証（`RUNTIME_NOT_VERIFIED`）。

### 非対象

- S3-c Host Enforcement
- S4 Capability-Aware AI Orchestration
- 複数プロセスRecovery保証
- 全OpenCode Versionへの互換性保証
- 独自Router構築
- 全Finding解消
- 全候補Requirementsの実装

## 4. 必須の実Host受入

対象は独立した隔離Hostとし、OpenCode V2の具体的なVersion・Source・操作を実施前に固定する。

| ID | シナリオ | 必須成立条件 |
|---|---|---|
| AC-H01 | S1/S2正常連携 | 別途承認された隔離Hostで取得した実Sessionの限定Sourceを、保存Source wrapperと明示Correlationにより入力検証し、既存S2-b Offline READ_ONLY AdapterでS1契約へ変換して診断を生成できる。取得・検証・変換を区別し、帰属と未証明の保証範囲を維持する |
| AC-H02 | Authority / Evidence異常 | 不整合・欠測・権限不一致を誤受入れせず、保証対象の操作を適切に制限する |
| AC-H03 | S3-b Decision / Lifecycle Consistency Recovery | 採択済みの単一プロセス限定範囲で再起動前後のDecisionと対応するLifecycleの整合性を実Hostで確認し、不整合なTask / Plan進行を認めない。任意状態の全面復元・外部Tool副作用の巻戻し・複数プロセス保証は要求しない |

### 証拠要件

各ACについて、最低限次を記録する。

- Host / Version / Commit / Operation
- 入力と実行条件
- 実際に観測した結果
- PASS / FAIL / NOT_RUN / NOT_VERIFIED等の区別
- 証拠参照と確認可能な範囲
- 未証明の保証および既知制限

自己申告・静的Fixture・mock-I/O・CI成功だけで実Host PASSに昇格しない。

AC-H02でのJustice内部の受入拒否はHost実行前拒否を証明しない。AC-H01のPASSは収集したSourceの全履歴完全性・真正性を証明しない。AC-H03のPASSは採択済みDecision / Lifecycle Consistency Recoveryの限定実Host証拠であり、全面Semantic Recovery、外部Tool副作用の巻戻し、複数プロセスの安全性を証明しない。

## 5. 運用要件

### Opt-in

- デフォルトは既存開発環境へ自動導入しない。
- 受入済みのHost/Version/Scopeのみを対象とする。
- Human Ownerが利用範囲を明示的に承認する。
- 既存Superpowers / OpenCode V2の通常フローを不必要に変更しない。

### 異常時動作

| 異常 | 要求動作 |
|---|---|
| Evidence欠測 | UNKNOWNを保持し、成功認定しない |
| Authority不一致 | 該当する承認・状態変更を拒否または保留 |
| Recovery不整合 | 対象Task/Planの進行を保留 |
| 診断表示エラー | 安全上独立した作業は継続可能 |
| Justice停止 | 保護境界を迂回せず安全に停止 |
| 切戻し不能 | 影響対象を保留し、Owner判断を要求 |

JusticeにHost実行を強制停止する能力が確認されていない場合、その能力を前提とした安全保証は主張しない。

## 6. 最小成果物

### A. Acceptance Evidence Record

AC-H01〜H03の結果、証拠、実行条件、残余リスクを記録する。

既存の検証資料を参照し、証拠の重複作成を避ける。

### B. Minimal Operation Runbook

必要十分な内容に限定する。

- 対応Host / Version / Scope
- Opt-in手順
- 通常の診断フロー
- 異常発生時の対応
- 停止・切戻し手順
- 互換性と既知制限

### C. Owner Completion Decision

少なくとも次の2判断を分離する。

1. **BOUNDED_COMPLETE:** S1〜S3の採択済み範囲について、AC-H01〜H03の必須PASS、対象Scope / Versionの特定、証拠と診断結果の帰属確認、既知制限・未実証事項の明示、必要な保護を迂回しないOpt-in・停止・切戻し手順の成立をすべて確認し、Human Ownerが限定完成を明示的に採択する。
2. **RELEASE_APPROVED:** 指定環境でのOpt-in利用開始を別途承認する。

`BOUNDED_COMPLETE` は自動的に `RELEASE_APPROVED` を意味しない。`RELEASE_APPROVED`は指定環境で運用を開始するための独立したOpt-in許可として、別途Human Ownerが判断する。

## 7. 完成条件

以下をすべて満たしたとき、Human Ownerによる限定完成判断が可能となる。

1. AC-H01〜H03が固定対象HostでPASS。
2. 対象ScopeとVersionを特定できる。
3. 証拠と診断結果の帰属が確認できる。
4. 既知制限・未実証事項が明示されている。
5. 必要な保護を迂回しないOpt-in・停止・切戻し手順が成立している。
6. Human Ownerが完成を明示的に採択する。

AC-H03の完成対象は採択済み単一プロセス限定Decision / Lifecycle Consistency Recoveryのみとし、任意Task / Revision / Findingの復元や外部Tool副作用の巻戻しを必須PASSまたは達成保証へ拡張しない。AC-H01では隔離HostによるSource取得、保存Source wrapper・明示Correlationの入力検証、既存S2-b Offline Adapterによる変換を区別し、未証明を成功に昇格させない。

未実行・未証明・観測失敗をPASSへ読み替えない。

対象範囲で重大な安全性・権限・データ保全リスクが未解決なら、影響する操作の完成認定を保留する。

## 8. 完成を妨げない既知制限

次は、影響範囲を明示して利用を制限できる限り、無条件の完成阻止条件としない。

- 複数プロセスRecovery未証明
- S3-bの全面Semantic Recovery、任意Task / Revision / Finding復元および外部Tool副作用巻戻しは採択済み保証範囲外（AC-H03の必須PASSを免除するものではない）
- S3-c Host Enforcement未実装
- S4未採択
- S2-c比較効果未確立
- 対象外Versionの互換性未検証
- S3-a Review Terminal metadataの既知制限
- 外部Writer / File durability未証明
- Legacy Staging欠測時のRecovery制限

ただし、受入対象の必須ACそのものが成立しない場合は限定完成PASSとしない。

## 9. 非機能要件・既存システムとの関係

- **安全性:** 権限・保証不足による誤受入れを防ぐ。
- **非破壊性:** 既存開発環境や履歴状態へ無断の副作用を与えない。
- **追跡可能性:** 受入証拠と対象Version、Scope、Taskを対応付けられる。
- **運用容易性:** Ownerが少ない手順で有効化・停止を判断できる。
- **互換性:** 固定したOpenCode V2環境のみについて確認済み能力を主張する。
- **非重複性:** Superpowers / OpenCode V2の既存機能を重複実装しない。

## 10. 重要なエッジケース

- Sessionが途中までしか取得できない。
- EvidenceのTask / Revision / Scopeが不一致。
- Authorityの出所を確認できない。
- 再起動後にDecisionとLifecycleが一致しない。
- 重複したLifecycle transitionが検出される。
- 既存LegacyデータにStaging履歴が存在しない。
- Justice停止時に既存Gate/HOLDを迂回する危険がある。
- HostのVersion差分によりAdapterが保証できない情報を受け取る。

これらは、誤って成功と判定しないことを要求する。すべてに新規の自動復旧機能を実装することは要求しない。

## 11. 実施前の未決事項

後続Designで必要最小限に具体化する。

- 隔離Hostの具体的な構成と固定Version
- AC-H01〜H03の具体的な入力・観測点・期待結果
- 証拠の採用基準と機密情報の扱い
- Opt-inおよび切戻しの具体的操作
- 実Host試験の副作用・Network・Secrets・停止条件

実Host確認は、これらを明示したうえで別途Human Ownerの承認を得る。

## 12. Stop / Checkpoint

本brainstormingは要件整理で終了する。

- Design・Implementation Planの作成は別途判断する。
- Host Probe、テスト、実装、外部書込みを自動開始しない。
- 新たなFindingだけを理由に追加のレビュー循環を開始しない。
- 既存Gate/HOLDやv4/v5の歴史状態を変更しない。
- 未採択Scopeをv6.0.0の必須条件に追加しない。
- S5の完成認定とリリース承認を分離する。

**Final brainstorming disposition: `REQUIREMENTS_READY_FOR_DESIGN / OWNER_DESIGN_AUTHORIZATION_PENDING`**

## 13. 参照

- [Justice v6 Overall #388](https://github.com/yohi/justice/issues/388)
- [S1-a #350](https://github.com/yohi/justice/issues/350) ～ [S1-e #354](https://github.com/yohi/justice/issues/354)
- [S2 Parent #355](https://github.com/yohi/justice/issues/355)
- [S2-c #373](https://github.com/yohi/justice/issues/373)
- [S3 #356](https://github.com/yohi/justice/issues/356)
- [S3-b PR #392](https://github.com/yohi/justice/pull/392)
- [S4 #357](https://github.com/yohi/justice/issues/357)
- [S5 #358](https://github.com/yohi/justice/issues/358)
