# Justice RG-310-A-001 — WT1 Contract B R9
## 31 OPEN Finding Traceability / Documentation Register R1

- **作成日**: 2026-10-29 (JST)
- **権限**: DOCUMENT_ONLY / OUTSIDE_REPOSITORY / NO_IMPLEMENTATION / NO_TEST / NO_GATE_AUTHORITY
- **Source of truth**: Human Owner採択の3群すべてOPEN。以下の「改訂案内参照」はclosureではない。
- **重要**: 一部Findingのseverityは元のレビュー要約の分類を踏襲。技術的な再判定・全closureは実施していない。

| ID | Severity | 原レビューでの論点（要約） | 設計案の扱い | 計画案の扱い | 状態 |
|---|---|---|---|---|---|
| `R1-REV-001` | High | 従来AT-01の`args[0]`をK_Tと誤認（実際はpkgPublisher） | D-04/D-06 | P-02/P-04 | **OPEN** |
| `R1-REV-002` | High | K_T取得から正規H_T侵害・真正PASSまでの連鎖未証明 | D-05/D-06 | P-02/P-04 | **OPEN** |
| `R1-REV-003` | High | 限定候補の破綻を3ファイル全称不可能へ一般化 | D-02/D-09 | P-01/P-02 | **OPEN** |
| `R1-REV-004` | Moderate | call/applyフックと公開static差替えを混同 | D-03/D-06 | P-02/P-04 | **OPEN** |
| `R1-REV-005` | Moderate | 非export Map/WeakSet直接汚染の証拠がない | D-03/D-06 | P-02/P-04 | **OPEN** |
| `R1-REV-006` | Moderate | 固定R8とRunnerの実効構成・関連付けが未確認 | D-01/D-08 | P-01/P-04 | **OPEN** |
| `R1-REV-007` | Moderate | 行番号・Proof Obligation番号の整合性不備 | D-08 | P-01/P-03 | **OPEN** |
| `R1-REV-008` | Moderate | R1原本の変数記号・Outcome表記など文書欠陥 | D-08 | P-01/P-03 | **OPEN** |
| `R1-REV-009` | Moderate | 旧Design Handoffの申告SHAと収録物の来歴不一致 | D-01 | P-01/P-04 | **OPEN** |
| `R1-REV-010` | Low | 公開API経由の迂回可能性・完全仲介未証明 | D-04/D-05 | P-02/P-04 | **OPEN** |
| `CCOMP-R1-001` | High | C3/C4のPROVEN_STATIC表記が安全性全体の証明と混同 | D-02/D-09 | P-02/P-04 | **OPEN** |
| `CCOMP-R1-002` | High | C2-AT-01でPublisher参照取得からRoot取得へ飛躍 | D-04/D-06 | P-02/P-04 | **OPEN** |
| `CCOMP-R1-003` | High | setReceiver/receive/reset/emit/coordinate/evaluateの完全仲介欠落 | D-04/D-05 | P-02/P-04 | **OPEN** |
| `CCOMP-R1-004` | High | M:917/962を認可検証点と誤認（Registry書込） | D-04/D-05 | P-02/P-04 | **OPEN** |
| `CCOMP-R1-005` | High | Loader/Port/PID/UID単独のCaller Attribution未成立 | D-03/D-04 | P-02/P-04 | **OPEN** |
| `CCOMP-R1-006` | Moderate | 84件すべての非同期書換え不可避の証明なし | D-07 | P-03/P-06 | **OPEN** |
| `CCOMP-R1-007` | Moderate | SharedArrayBuffer TOCTOUは採用・共有前提が未立証 | D-03/D-06 | P-02/P-04 | **OPEN** |
| `CCOMP-R1-008` | Moderate | テスト表示PASSと外部監査結果PASSの混同 | D-05/D-06 | P-02/P-05 | **OPEN** |
| `CCOMP-R1-009` | Moderate | Outcome欠落・破損変数・PO版不一致 | D-08 | P-01/P-03 | **OPEN** |
| `CCOMP-R1-010` | Moderate | Node/Bun実効版・固定R8のRunner来歴未証明 | D-01/D-08 | P-01/P-04 | **OPEN** |
| `CCOMP-R1-011` | Moderate | 旧R1-REV-001..010のclosureを示す独立証拠不足 | D-08 | P-01/P-05 | **OPEN** |
| `CA-R1-REV-001` | High | 3ファイルの普遍的不可能性を限定反例から過大主張 | D-02/D-09 | P-01/P-02 | **OPEN** |
| `CA-R1-REV-002` | High | K_T交付API署名と捕捉ラッパーの位置が不一致 | D-04/D-06 | P-02/P-04 | **OPEN** |
| `CA-R1-REV-003` | High | 正規H_Tへの侵害・PASS成立までの証拠連鎖欠落 | D-05/D-06 | P-02/P-04 | **OPEN** |
| `CA-R1-REV-004` | High | 直接イベント防護をB0+B1全体のPASS防護と混同 | D-05/D-06 | P-02/P-05 | **OPEN** |
| `CA-R1-REV-005` | Moderate | R8 ArtifactRecordを未実装のStageEligibilityと誤認 | D-04/D-08 | P-01/P-03 | **OPEN** |
| `CA-R1-REV-006` | Moderate | emit Token検証行M:736誤記（実際M:688） | D-04/D-08 | P-01/P-03 | **OPEN** |
| `CA-R1-REV-007` | Moderate | 84テスト全件修正の必然性に証拠不足 | D-07 | P-03/P-06 | **OPEN** |
| `CA-R1-REV-008` | Moderate | Runner-固定R8歴史的結合と実効Worker配置未確認 | D-01/D-08 | P-01/P-04 | **OPEN** |
| `CA-R1-REV-009` | Moderate | PO-CAと旧PO番号の版差が未整理 | D-08 | P-01/P-03 | **OPEN** |
| `CA-R1-REV-010` | Low | Runner台帳の行数・一部来歴説明の細部不一致 | D-01/D-08 | P-01/P-03 | **OPEN** |

## グループ別集計

| グループ | High | Moderate | Low | 合計 |
|---|---:|---:|---:|---:|
| R1-REV | 3 | 6 | 1 | 10 |
| CCOMP-R1 | 5 | 6 | 0 | 11 |
| CA-R1-REV | 4 | 5 | 1 | 10 |
| **合計** | **12** | **17** | **2** | **31** |

このSeverity集計は本資料中の分類の集計であり、レビュー原本全文を全件改めてSeverity判定したものではない。元レビューでSeverityが示されなかった旧R1-REVの各行については作業用分類に過ぎない。したがって**正式なSeverityの正本には使用しない**。

## Closureの条件

FindingをCLOSEDにするには、(1)改訂対象文書の固定バイト、(2)行番号または機械的参照、(3)反例・証明責務の充足、(4)役割分離した独立レビュー、(5)Human Ownerの明示判断が必要。単なる文章修正、修正案の提出、類似IDの過去Closure、Code/CIのGREEN、他方式での条件付き可能性は代替にならない。

**OPEN残数: 31（今回変更0）。**
