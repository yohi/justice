# Justice v6 S5 — H1〜H5 Read-only Host Identity / Plugin Boundary Design

**Version:** R0.1  
**Date:** 2026-11-23 (JST)  
**Status:** DESIGN_ACCEPTED_BY_OWNER / EXECUTION_NOT_AUTHORIZED  
**Repository:** `yohi/justice`  
**Reference Commit:** `master@3c2b5a3f38f4440a622b8ee53705f5a6193518f1`  
**Target Host:** `coreultra7-270k`  
**Target Runtime:** OpenCode V2.3.2

## 1. Purpose

### 1.1 Project Goalとの関係

Justice v6 S5の本来の目的は、採択済みS1/S2/S3の限定範囲について実Host受入を行い、Human Ownerが限定完成とOpt-in運用開始を独立判断できる状態にすることである。

今回の設計は、その前段階にある不確実性を解消する。

**解消対象：OpenCode V2.3.2が、固定されたJusticeのPluginを実Host上で読み込む準備が整っており、専用の検証を既存運用へ干渉させずに行えるか。**

### 1.2 今回の成果物

`H1〜H5 Read-only Identity / Boundary Evidence Record`

確認した事実、未確認事項、取得根拠、E1の実行可否に関する判断材料を記録する。S5の正式Acceptance Evidence RecordやOwner Completion Decisionを置き換えない。

### 1.3 完了条件

- H1〜H5について確認できた事実と未確認事項を区別できる。
- Host実体、Plugin Build、登録準備、State境界、停止・撤収条件の不確実性を整理できる。
- E1の次段階をOwnerが判断できる。
- Read-only制約を破らない。
- 判定後はHuman Owner Checkpointで停止する。

すべてをVERIFIEDにすることは、今回のTask完了の絶対条件ではない。

## 2. Current Baseline

### 2.1 固定Checkpoint

```text
HOST_ACCESS_BLOCKED
H1_H5_NOT_VERIFIED
E1_E2_E3_HOLD
BOUNDED_COMPLETE=PENDING
RELEASE_APPROVED=PENDING
AWAITING_OWNER_AUTHORIZATION
```

H1〜H5はHost接続不能によって未検証であり、実装失敗が観測されたわけではない。

### 2.2 確認済みSource構造

既存のGitHub Source Readbackに基づく。

- Pluginエントリ：`dist/opencode-plugin.js`
- OpenCode Hook実装：`src/opencode-plugin.ts`
- Host Runtimeとの接続：`src/runtime/opencode-adapter.ts`
- Justice初期化とState管理：`src/core/justice-plugin.ts`
- Global Wisdom Store：`JUSTICE_GLOBAL_WISDOM_PATH`未指定時、通常`~/.justice/wisdom.json`
- Local State：Workspaceを基準とする`.justice`配下

**Workspaceを分離してもGlobal Storeの分離は自動保証されない。** Plugin登録設定の存在とRuntimeでのPluginロード成功も別の事実として扱う。

### 2.3 既存Evidence

T09〜T15の既存Evidenceは保持・再利用する。新しいHEADへの適合性や実HostでのPluginロード成功を、過去Evidenceだけから推定しない。

## 3. Goals / Non-goals

### 3.1 Goals

1. 固定対象のHost Identityを確認する。
2. Plugin Build IdentityをSource Commitと区別して確認する。
3. OpenCode 2.3.2からのPlugin参照経路を確認する。
4. 専用Workspace、Local/Global State、Session、Evidenceの分離可能性を確認する。
5. 将来の専用検証を既存OpenCodeへ干渉せず停止・撤収できるか評価する。
6. E1に対するOwner判断を可能にする。

### 3.2 Non-goals

- Pluginの起動・初期化、OpenCodeの起動・停止、Session作成
- Build、Install、依存関係変更
- Credential本文・Session本文の閲覧、Provider通信
- E1/E2/E3の実行、Fault Injection、Recovery、Rollbackの実行
- Source・設定・Host State変更、GitHub書込み（設計書の承認済みGit commit/pushを除く）
- 新規Issue、追加レビュー、別Taskの自動開始

### 3.3 Anti-goals

確認のために共有環境を変更すること、証拠を得るために危険な操作を行うこと、NOT_VERIFIEDをPASSまたはFAILへ推測で変更することを禁止する。

## 4. Approach Selection

### Approach A — Existing Connection, Read-only Inspection

接続経路が利用可能になった後、Human Ownerの新たな限定承認に基づいてHostの既存情報を読む。

**利点：**
- 現行Checkpointを維持できる。
- 新しい実行環境やHarnessが不要。
- 接続復旧と検証実施を別の判断として扱える。

**制約：**
- 接続が成立しなければ実行できない。
- 接続ツールが必要な読取り・メタデータ取得を提供しなければ、一部Identityは検証できない。
- PluginのRuntimeロード成功は、この段階では証明できない。

**選択：** Human Ownerが既に確定した「接続回復後に限定再承認」の境界に沿う採用方式。

### Approach B — Owner-local Read-only Inspection

Human Ownerが実Host上で限定的なRead-only情報を取得し、その結果を確認する。

**利点：** 外部接続経路の可用性に依存しない。

**制約：**
- Host操作そのものに別途承認が必要。
- コマンドの副作用やCredential露出防止を個別確認する必要がある。

**選択：** 未承認の代替候補。自動切替しない。

VM・Sandboxの追加やOpenCode起動による確認は今回のRead-only目的と一致しないため、採用しない。

## 5. Read-only Verification Design

### H1 — Host Identity

**目的：** 実Host上のRepositoryとOpenCode実体を特定する。

**確認対象：**
- Host識別子
- Repositoryの実Path
- Host HEADと固定Commitとの一致・不一致
- Worktreeの変更状態
- `~/.local/bin/opencode2`の参照先
- OpenCode実バイナリのVersion、SHA-256

**方法：** 既存ファイルのメタデータ、Git参照情報、読み取り可能なバイナリ内容を使用する。バイナリDigestは可能な場合に実体のバイト列から計算する。Launcherのファイル名やGitHubのHEADは実Host Identityの代用にしない。

利用可能なRead-onlyインターフェースでWorktree状態やDigestを確定できない場合、その項目はNOT_VERIFIEDとする。未承認のShell実行へ切り替えない。

**期待するEvidence：** 対象Path、参照先、実測Digest、取得方法、取得時点。

### H2 — Justice Build Identity

**目的：** OpenCodeが参照する予定のPluginファイルを特定し、Sourceとの対応を判断する。

**確認対象：**
- Plugin Artifactの実Path
- `dist/opencode-plugin.js`の存在
- ファイルのSHA-256
- Build元Commitを示す既存の証拠
- Source変更後のBuild更新状況

**判定原則：** `Git HEAD一致`と`Plugin Build一致`は別の確認事項とする。Pluginファイルが存在しても生成元Commitとの対応が示せなければBuild Identityは未確定である。Buildや再Buildは禁止する。

**期待するEvidence：** Plugin実体Digestと確認できたBuild来歴。来歴がなければその不足を明示する。

### H3 — Plugin Registration

**目的：** OpenCode V2.3.2がJustice Pluginを参照する設定経路を確認する。

**確認対象：**
- Launcherの実体と参照関係
- OpenCodeの対象設定ファイル
- Plugin登録エントリ
- Plugin PathまたはPackage参照
- 設定の優先関係
- 登録対象とH2 Artifactの整合

**重要な区別：**
- `CONFIGURED`：設定上、Justice Pluginへの参照がある。
- `RESOLVABLE`：参照先Artifactを特定できる。
- `RUNTIME_LOADED`：OpenCode実行時に正常ロードされた。

今回確認可能なのは主として前二者であり、`RUNTIME_LOADED`はE1以降の確認対象とする。

Credentialを含むおそれのある設定ファイルについては本文全体の閲覧を前提としない。必要項目だけを安全に確認できなければNOT_VERIFIEDに留める。

**期待するEvidence：** 非機密の登録情報と参照先の対応。

### H4 — State Separation

**目的：** 検証用Stateが既存運用のStateと交差しない設計を確認する。

**確認対象：**
- Workspace Root
- Local `.justice` Root
- Global Wisdom Store
- OpenCode Config / Data / State領域
- Session保存領域
- Evidence保存領域
- シンボリックリンクや共有Path
- 初期化時の書込み対象

**必須条件：** 専用Workspaceのみでは分離完了と判断しない。`JUSTICE_GLOBAL_WISDOM_PATH`等によるGlobal Storeの明示的な分離可能性を確認する。

Justice Pluginの初期化やRecovery処理にはState書込みが発生し得るため、Pluginロードを「確認のためだけのRead-only操作」と扱わない。今回、専用Directoryの作成・設定変更・既存Stateへの書込みは行わない。

**期待するEvidence：** 既存Pathと将来の専用Pathの衝突有無、初期化時の書込みリスク、分離の未解決条件。

### H5 — Stop / Rollback

**目的：** 将来の専用E1検証だけを停止・撤収できる条件を整理する。

**確認対象：**
- 専用プロセスを既存OpenCodeと区別する方法
- 専用Sessionと共有Sessionの区別
- 専用Config / State / Evidenceの所有境界
- 停止対象の限定方法
- 撤収対象Pathの限定方法
- 共有設定・既存プロセス・Credentialへの非干渉

**必須条件：** 停止対象が一意に特定できない場合、共有OpenCodeを停止しない。Rollbackは検証専用の変更範囲だけに限定し、共有Stateの復元・削除を含めない。

H5で確認するのは停止・撤収方式の安全性と準備状況であり、実際の停止・削除ではない。

**期待するEvidence：** 専用範囲の識別条件、停止条件、撤収条件、未解決のリスク。

## 6. Execution Boundary

### 6.1 前提条件

- Human OwnerによるH1〜H5限定再確認の明示承認
- 接続経路の利用可能性
- Read-only手段の確認
- Credential本文を閲覧しない確認方法
- 固定Repository / Commit / Hostの維持

接続の復旧自体を実行承認とみなさない。

### 6.2 許可範囲

既存情報のRead-only取得、非機密Metadataの確認、取得済みバイト列のローカルなDigest計算、Evidence整理のみ。

許可範囲外の手段が必要になった場合は、実行せず未確認事項として記録する。

### 6.3 Immediate Stop Conditions

- 対象HostやRepository Identityが固定条件と食い違う
- CredentialやSession本文の閲覧が必要になる
- 読取り操作の副作用を排除できない
- 共有Stateへの干渉が疑われる
- 接続が失われる
- 未承認の操作が必要になる

接続失敗時に自動再試行・経路変更・サービス起動は行わない。

## 7. Evidence and Decision Contract

### 7.1 Evidence Record

各H項目について、以下を最小単位で記録する。

```text
Check ID
Target Identity
Evidence Source
Observation Time
Observed Facts
Evidence Digest (when available)
Verification Limitations
Verdict
```

秘密情報、Session本文、不要なログ全文は記録しない。

### 7.2 Verdict

| Verdict | 意味 |
|---|---|
| VERIFIED | 指定された静的確認条件が証拠付きで成立 |
| NOT_VERIFIED | 証拠が不足しており判断不能 |
| BLOCKED | 接続・権限・安全制約により確認できない |
| OBSERVED_MISMATCH | 対象と固定条件の具体的な不一致を観測 |

`NOT_VERIFIED`と`OBSERVED_MISMATCH`を混同しない。

### 7.3 E1 Decision

H1〜H5の結果から次のいずれかをHuman Ownerへ提示する。

**E1_READY_FOR_OWNER_DECISION**：静的な実行前提が成立し、重大な分離・停止リスクが残っていない。これはE1実行の承認でもPluginロード成功の証明でもない。

**E1_LIMITED_PREPARATION_REQUIRED**：Plugin登録、Build来歴、専用State設定などに限定的な準備が必要。必要な変更と理由のみを提示し、自動実施しない。

**E1_SAFETY_HOLD**：安全上の未解決問題により実行すべきでない。

**E1_NOT_VERIFIED**：接続・証拠不足により判断できない。

## 8. Relationship to E1 / E2 / E3

### E1 — Normal Integration

H1〜H5の前提が成立した後、別途Owner判断により限定実行を検討する。この設計でE1自体は実行しない。

### E2 — Invalid Input

E1で実際のPlugin接続・受入経路が成立してから、正規の不正入力経路と非干渉境界を個別判断する。

### E3 — Plan Recovery

E1後に安全なLifecycle失敗注入と専用Restartの可否を個別判断する。新しいHarness、Recovery再設計、Source修正は現段階では必要と判断しない。

## 9. Completion and Stop

### Design Completion

本設計書がH1〜H5の対象、方法、制約、Evidence、判断条件を具体化し、Human Ownerが採否を判断できれば設計Taskを終了できる。

### Verification Completion

承認されたRead-only確認が完了するか、安全上の停止条件に到達した場合、その実行Taskを終了する。

### Explicitly Excluded Automatic Progression

- H1〜H5終了後のE1自動実行
- E1終了後のE2/E3自動実行
- 追加レビューの自動開始
- 新規Issue・PR作成
- 設計・Sourceの自動修正
- Opt-in運用開始
- Release承認

## 10. Human Owner Checkpoint

本設計の採択は、Read-only Host確認の実行承認とは別である。設計を採択した後も、新たな明示承認がない限りHost操作は行わない。

S5の正式状態は変更しない。

```text
H1_H5_NOT_VERIFIED
E1_E2_E3_HOLD
BOUNDED_COMPLETE=PENDING
RELEASE_APPROVED=PENDING
AWAITING_OWNER_AUTHORIZATION
```

**Design R0.1 End**
