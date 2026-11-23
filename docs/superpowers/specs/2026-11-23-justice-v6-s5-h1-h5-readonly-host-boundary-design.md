# Justice v6 S5 — H1〜H5 Read-only Host Identity / Plugin Boundary Design

**Version:** R0.1.1 (RG-S5-HOST-001 limited documentation remediation)  
**Date:** 2026-11-23 (JST)  
**Status:** R0.1 OWNER_ADOPTED / R0.1.1 ADOPTION_HOLD / HOST_READ_ONLY_EXECUTION_NOT_AUTHORIZED  
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
- Source・設定・Host State変更、GitHub書込み（過去のGit commit/push承認を本限定訂正へ流用しない。今回のCommit/Push/PRは別途Owner承認が必要）
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

**H4 静的 `VERIFIED` 条件（すべて必要）：**

1. **既存Stateの所有境界：** 対象Hostで使用中のWorkspace、既存`.justice`、Global Wisdom、OpenCode Config/Data/State、SessionおよびEvidenceについて、確認可能な実Path・所有者/利用主体・共有/専用の別・想定書込み可否を記録する。秘密情報やSession本文は読まない。未列挙の書込み先を「存在しない」と推定しない。
2. **将来の専用State固定：** E1用のWorkspace Root、Local `.justice`、Global Wisdom、OpenCode Config/Data/State、Session、Evidenceそれぞれに対し、Ownerが固定した具体的Pathまたは一意に展開できる固定命名規則と専用Rootを記録する。単なる候補Pathは`VERIFIED`条件を満たさない。専用化不要とする場所には、書込みを生じない根拠または安全な抑止条件を明記する。対象Pathを実際に作成しない。
3. **Local / Globalの非交差：** Workspace依存のLocal Storeと`JUSTICE_GLOBAL_WISDOM_PATH`の解決先を個別に示し、Global Storeの既定値`~/.justice/wisdom.json`へ誤って書き込まないための実行前固定条件を定める。既存と専用のPathは正規化し、既存のシンボリックリンク・解決可能な親Path・共有Mount等をRead-onlyで照合する。未作成Pathの将来の非交差は、親Directoryと命名規則の検査に基づく**静的な条件付き評価**であり、Runtime保証としない。
4. **OpenCode固有の境界：** LauncherのXDG Config/Data/State（必要な場合はCache）、Session保存、Justice PluginのLocal/Global Store、Evidenceの参照・書込み先を対応付ける。既存OpenCode V2 Sessionや共有設定と書込み先が重なる、あるいは参照先を特定できない領域を専用と見なさない。`--standalone`やWorkspace分離だけから非干渉を推定しない。
5. **初期化時の書込みリスク：** `createGlobalFs()`、`JusticePlugin.initialize()`のRestore/Recovery、OpenCode/Pluginの初期化に伴うStore作成・ログ・Cache・State更新等、確認済みの潜在書込みを分類し、各書込み先を専用Allowlistへ対応付ける。Read-onlyでは副作用の不存在を実測できないため、未解明の書込み先が残る場合は`NOT_VERIFIED`、既存共有Stateへ避けられない書込みが認められる場合は`OBSERVED_MISMATCH`とする。

**H4 `VERIFIED` の意味：** 上記の所有・Path・衝突・初期化リスクを**静的証拠で説明でき、将来の専用PathがOwner固定済み**という意味だけである。実行時の非干渉、秘密・Network隔離、OS隔離を証明しない。専用Path未固定・リンク未解決・未評価書込み先があれば`VERIFIED`にしない。

**期待するEvidence：** 既存Pathと専用Pathの対応表（Owner固定条件を含む）、所有/書込み区分、Path正規化・衝突/共有/シンボリックリンク判定、初期化時の書込み先Allowlist、未解決条件。

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

**H5 静的 `VERIFIED` 条件（すべて必要）：**

1. **専用プロセスの識別契約：** 将来のE1専用起動に用いるOwner固定のLauncher/実バイナリ、専用Workspace、専用Config/Session、実行単位の識別子を明記する。起動後にPIDだけでなく開始時刻・実体Path・専用実行単位との対応を確認してから停止対象を一意に選ぶ方式を固定する。Read-only時点では未来のPIDや稼働実績を創作しない。
2. **Stop対象の一意性：** 専用プロセス（必要なら当該実行単位だけの子プロセス）の所有関係を起動後に照合する条件と、照合不成立時は停止操作そのものを`HOLD`にする手順を定める。共有OpenCodeの既存PID、汎用プロセス名、無限定のプロセスグループ、一括終了コマンドを停止対象にしない。予期しない副作用時も、特定できない共有プロセスを停止しない。
3. **撤収対象の所有境界：** H4で固定した専用Config/State/Session/Fixture/Evidence等から、Ownerが後に承認する**実際に専用実行で生成されたものだけ**をExact Path Allowlistで管理する方式を固定する。Symlinkや既存/共有Pathへ到達するCleanup、既存Gate/HOLDの変更、共有Stateの復元・削除は除外する。証拠の保持・削除は別のOwner判断に従う。
4. **非干渉・失敗時動作：** StopとRollbackの前提として実行単位・Process Identity・Path所有がすべて一致することを要求し、不一致・欠測・共有範囲への波及がある場合は対象操作を`HOLD`しOwner判断へ戻す。既存OpenCode V2の起動・停止、共有設定変更、Credential参照、無関係Sessionの変更を含めない。

**H5 `VERIFIED` の意味：** 将来の専用プロセスを特定し、**そのプロセス・専用生成物だけ**を停止/撤収するための固定条件が静的に成立すること。実際のStop、Rollback、起動後の子プロセス追跡、Runtime非干渉を実証したという意味ではない。Owner固定の識別条件や撤収Allowlistがない場合、`VERIFIED`にしない。

H5で確認するのは停止・撤収方式の安全性と準備状況であり、実際の停止・削除ではない。

**期待するEvidence：** 専用プロセスの起動後同定条件、Stopの照合/拒否条件、専用生成物のExact Path Allowlist定義、共有OpenCode非干渉条件、未解決のリスク。

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

`NOT_VERIFIED`（必要な証拠がない）と`OBSERVED_MISMATCH`（具体的な不一致を証拠付きで観測）は異なる。`OBSERVED_MISMATCH`を証拠欠落に含めず、重大な安全問題か、限定準備で安全に解消可能かを別途評価する。不一致の影響範囲に未確認事項があれば、その欠落も独立して記録する。

**判定の適用範囲：** H1〜H5の`VERIFIED`は各節で指定された**静的条件**に限る。特にH4は既存/専用State・書込み先Allowlistの対応が全て示された場合、H5はOwner固定の専用プロセス識別・Stop・撤収契約が全て示された場合のみ`VERIFIED`とする。計画上の候補、Source上の分離可能性、未作成Pathの名前だけでは証拠にならない。個別の未確認条件は理由・Evidenceの欠落とともに記録する。`BLOCKED`は検証不能を示し実装のFAILではない。

静的`VERIFIED`は`RUNTIME_LOADED`、Runtimeでの非干渉保証、AC-H01/H02/H03のPASS、E1実行GO、`BOUNDED_COMPLETE`または`RELEASE_APPROVED`の根拠にはならない。H1〜H5全件の`VERIFIED`は**設計書の完成・今回の文書Task終了条件ではない**。

### 7.3 E1 Decision

H1〜H5の静的Evidenceを根拠とし、Human Ownerへ**次の判断候補**を1件提示する。E1実行はどの候補でも自動承認されない。

| 優先順 | 証拠付き条件 | Ownerへの提示候補 |
|---|---|---|
| 1 | 既存共有Stateへの不可避な書込み、専用プロセスを限定停止できない等、**重大で解消策が未確定の安全上の問題**を具体的に確認 | `E1_SAFETY_HOLD` |
| 2 | **重大な安全問題ではない確定した`OBSERVED_MISMATCH`**があり、固定対象・対応方針にOwner判断が必要で、安全な限定準備策をまだ立証できない。別の証拠欠落があれば併記し、欠落扱いへ置き換えない | `E1_OBSERVED_MISMATCH_OWNER_DECISION` |
| 3 | 上記1・2に該当せず、接続不可・Path/Writer/実体・登録経路・衝突情報等の**証拠が不足**し、必要な限定準備の安全性も確定できない | `E1_NOT_VERIFIED` |
| 4 | 未成立の静的条件または重大でない確定不一致について、安全な**限定準備策をEvidenceから立証**でき、他に未分類の証拠欠落が残らない。例：H4専用PathやH5 Stop同定方式/撤収Allowlistの安全な固定が必要 | `E1_LIMITED_PREPARATION_REQUIRED` |
| 5 | **H1〜H5の各静的`VERIFIED`が成立**し、H4の専用Path・書込みAllowlist、H5の専用停止対象の同定契約・撤収AllowlistがOwner固定済み。H1実Host/バイナリ、H2実Build、H3設定からArtifactへの参照整合も証拠化。重大な衝突・未評価の書込み先が残らない | `E1_READY_FOR_OWNER_DECISION` |

**判定の具体例：**

- H4/H5の必要Path、専用Process識別または撤収対象が**候補だけ／未固定**なら、他項目が良好でも`READY`へ昇格しない。安全な限定準備の内容が立証できれば`LIMITED_PREPARATION_REQUIRED`、証拠欠落だけなら`NOT_VERIFIED`。
- H1〜H3で実バイナリ・Build・登録先等の**非重大な不一致を観測**したときは、`NOT_VERIFIED`に置き換えない。安全な限定準備が立証できなければ`E1_OBSERVED_MISMATCH_OWNER_DECISION`としてOwnerへ不一致と未確認事項を提示し、自動的な対象変更・修正・再試行を行わない。
- H4で共有Global Storeへの避けられない書込み、またはH5で共有OpenCodeしか停止できないことが確定した場合、当該操作は`SAFETY_HOLD`。安全な代替方式を新たに実装して解消するものとは扱わない。
- H1〜H3の未検証をGitHub Source、Launcher名、Plugin登録候補だけから補わない。H3の`CONFIGURED`/`RESOLVABLE`が静的に成立しても`RUNTIME_LOADED`は依然として未確認。
- `READY`は**E1についてOwnerが実行承認可否を審議できる静的準備状態**であり、E1実行GO、Runtimeロード成功、実行時の非干渉、OS/Network/Credential隔離、ACのPASSを意味しない。E1の具体的な操作、Secrets/Network範囲、Owner承認は別のGateに残す。

**競合時の優先：** 重大な安全問題の実観測は`SAFETY_HOLD`。それ以外の確定した非重大`OBSERVED_MISMATCH`で安全な限定準備策を立証できない場合は`OBSERVED_MISMATCH_OWNER_DECISION`とし、他の証拠欠落を併記する。不一致への限定準備が立証済みでも別の未解消な証拠欠落があれば`NOT_VERIFIED`。不一致を含む必要な準備がすべて安全に限定可能と立証できた場合だけ`LIMITED_PREPARATION_REQUIRED`とし、全Hの静的条件が成立した場合だけ`READY`とする。いずれもE1/E2/E3の既存`HOLD`を変更しない。
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

R0.1は過去にOwner採択済みだが、**本R0.1.1は`ADOPTION_HOLD`**。本設計の採択はRead-only Host確認の実行承認とは別であり、新たな明示承認がない限りHost操作は行わない。

S5の正式状態は変更しない。

```text
H1_H5_NOT_VERIFIED
E1_E2_E3_HOLD
BOUNDED_COMPLETE=PENDING
RELEASE_APPROVED=PENDING
AWAITING_OWNER_AUTHORIZATION
```

**Design R0.1.1 Limited Remediation Draft End**
