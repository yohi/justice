# Justice — Superpowers / oh-my-openagent 最新 upstream 追従 要件ブリーフ

## 1. 背景

`yohi/justice` は、設計・実装当時に前提としていた以下 upstream の仕様から時間経過により乖離している可能性がある。

* `obra/superpowers`
* `code-yeongyu/oh-my-openagent`
* OpenCode

Superpowers および oh-my-openagent はその後、workflow、skill、設定、agent delegation、background execution、成果物管理等に変更が入っている。

Justice が古い upstream の契約を前提としたままになっていないかを網羅的に確認し、必要な箇所を最新 upstream に追従させたい。

## 2. 目的

`justice/master` を、調査・対応時点における以下 upstream HEAD と整合した状態にする。

* `obra/superpowers`: `main` HEAD
* `code-yeongyu/oh-my-openagent`: `dev` HEAD

単なる version number の更新ではなく、Justice が依存している upstream の実際の契約・挙動を確認し、最新環境で Justice の責務が成立することを目的とする。

また、upstream に Justice と同等以上の機能が取り込まれた場合は、Justice 独自実装を無条件に維持せず、現在も Justice がその責務を持つ必要があるか再評価する。

## 3. 対象リポジトリ・ブランチ

### Justice

* Repository: `yohi/justice`
* Branch: `master`
* 基準: 調査開始時の HEAD

### Superpowers

* Repository: `obra/superpowers`
* Branch: `main`
* 基準: 調査・対応時の HEAD

### oh-my-openagent

* Repository: `code-yeongyu/oh-my-openagent`
* Branch: `dev`
* 基準: 調査・対応時の HEAD

release/tag の最新版ではなく、上記 branch の HEAD を互換性確認基準とする。

## 4. 正式対応 harness

今回の正式対応対象は **OpenCode のみ**とする。

oh-my-openagent が対応を拡大している以下のような他 harness への Justice 対応追加は今回の対象外とする。

* Codex
* Senpi
* その他新規 harness

ただし、oh-my-openagent の multi-harness 化によって OpenCode 側の契約が変更されている場合、その変更は調査・追従対象とする。

## 5. 基本方針

### 5.1 最新 upstream を正とする

古い Superpowers / oh-my-openagent との後方互換性は要求しない。

最新 upstream との整合のために必要であれば breaking change を許容する。

### 5.2 Justice のユーザー向け契約は原則維持する

Justice 自身が提供している以下のような公開 UX は、最新 upstream と矛盾しない限り維持する。

* 公開 command
* 設定
* workflow
* ユーザーが認識する成果物
* completion / continuation 等の意味的な挙動

upstream の変更により維持できない、または upstream に責務が完全に吸収された場合は変更・削除を許容する。

### 5.3 upstream と重複した責務は再評価する

Justice の既存機能と類似する機能が upstream に追加されている場合、API や機能名が似ていることだけを理由に Justice 側を削除してはならない。

Justice がその機能によって保証していた意味的な挙動・ユーザー価値まで upstream が同等以上に満たしていることを確認できた場合のみ、Justice 側の責務を削除・縮小・upstream へ委譲可能とする。

## 6. 必須調査範囲

Justice リポジトリ全体を調査し、Superpowers / oh-my-openagent / OpenCode との契約点を網羅的に洗い出す。

既知の箇所だけを確認して完了としてはならない。

少なくとも以下の種類の契約を確認する。

* skill 名・skill invocation
* command 名
* agent / subagent delegation
* tool 名
* lifecycle event / hook 名
* hook payload / return contract
* `task()` 等の task execution
* background execution
* background result retrieval
* parent wake / continuation
* compaction 前後の状態・継続
* loop continuation
* completion 判定・completion gate
* spec / design / plan 等の成果物
* 成果物の path / naming convention
* 設定ファイル
* 設定 key
* prompt 内で前提としている upstream behavior
* OpenCode plugin API との接点
* README / docs / examples に記載された upstream 前提
* test / fixture / mock に固定された upstream 前提

コードだけでなく prompt、Markdown、設定例、test 等も検索対象とする。

## 7. Superpowers 追従要件

`obra/superpowers/main` HEAD の実際の仕様を確認し、Justice が依存する Superpowers の契約をすべて照合する。

特に、過去から変更されている以下の領域を重点確認する。

* `brainstorming`
* `writing-plans`
* subagent-driven development
* skill invocation
* legacy command の削除・変更
* reviewer / agent の扱い
* spec / design / plan の保存場所
* workflow gate
* user approval
* worktree を含む workflow 上の前提
* OpenCode 向け tool mapping / integration

Justice が旧 Superpowers の成果物 path、command、agent、skill、workflow semantics 等を前提としている場合は最新仕様へ追従させる。

## 8. oh-my-openagent 追従要件

`code-yeongyu/oh-my-openagent/dev` HEAD の OpenCode 実装を正として、Justice が利用・前提としている契約を照合する。

特に以下を重点確認する。

* task execution
* background execution
* background output
* parent wake
* prompt / async gate
* agent delegation
* lifecycle hooks
* tool hooks
* message hooks
* compaction
* loop continuation
* completion coordination
* agent / category / skill naming
* OpenCode plugin integration
* config loading
* multi-harness 化に伴う OpenCode 側の変更

OmO 内部の構成変更そのものではなく、Justice と OpenCode 上の OmO の境界に影響する変更を追従対象とする。

## 9. OmO 設定契約

最新の unified configuration である以下を正式対象とする。

* `~/.omo/omo.jsonc`
* project-level `.omo/omo.jsonc` / `.omo/omo.json`

OpenCode 用設定については最新 OmO の OpenCode view / configuration semantics を正とする。

以下の旧設定形式について、Justice 独自の後方互換対応は要求しない。

* `oh-my-openagent.json`
* `oh-my-openagent.jsonc`
* `oh-my-opencode.json`
* `oh-my-opencode.jsonc`
* その他 upstream が migration-only とした旧形式

旧形式からの migration は upstream OmO の責務とし、Justice が独自 migration layer を持つことを要件としない。

## 10. OpenCode の扱い

OpenCode 自体の最新版への全面的な compatibility audit は今回の対象外とする。

ただし、

* 最新 Superpowers
* 最新 oh-my-openagent
* Justice

の組み合わせを OpenCode 上で成立させるために必要な OpenCode API / plugin contract / lifecycle contract は確認対象とする。

調査中に Justice が利用している OpenCode API 自体の変更が判明した場合、その契約点は追従対象に含める。

## 11. E2E 要件

静的なコード更新、build、typecheck、unit test の成功だけでは「追従完了」と判定しない。

調査時に固定した upstream HEAD を使用した実環境で、Justice の主要ユーザーフローが成立することを確認する。

最低限、Justice の通常フローについて、

`/justice-start` 相当の開始
→ brainstorming / spec
→ plan
→ implementation delegation
→ execution
→ completion

というユーザー視点の一連のフローが、最新 upstream 上で意味的に成立することを確認する。

upstream に責務を委譲した結果 workflow が変更された箇所については、その最新の代替フローが同等の目的を満たすことを確認する。

## 12. 継続・復旧系 E2E

Justice が明示的に制御している主要な継続・復旧系についても E2E の必須確認対象とする。

少なくとも、現行 Justice が責務を持っている場合は以下を確認する。

* background execution
* background task completion
* background result retrieval
* parent session への継続
* compaction 後の continuation
* loop continuation
* completion 判定
* completion gate
* delegation 完了後の workflow continuation

ただし今回と無関係な異常系の網羅や、新しい resilience 機能の追加は要求しない。

## 13. ドキュメント要件

実装だけでなく、最新 upstream と矛盾する Justice のユーザー向け情報も追従対象とする。

確認対象には少なくとも以下を含む。

* README
* installation instructions
* configuration examples
* command examples
* workflow documentation
* upstream integration documentation
* prompt / skill 内のユーザー向け説明
* upstream contract を説明するコードコメント

廃止された command、skill、agent、設定名、成果物 path 等をユーザーへ案内し続けないこと。

今回と無関係なドキュメント全面刷新は対象外とする。

## 14. Upstream revision の記録

対応・検証した upstream revision を Justice リポジトリ内に明示的に記録する。

最低限、各 upstream について以下を保持する。

### Superpowers

* repository
* branch
* full commit SHA
* 必要に応じて対応する release/tag

### oh-my-openagent

* repository
* branch
* full commit SHA
* 必要に応じて対応する release/tag / prerelease 情報

この情報は dependency pin を目的とするものではなく、

**「この Justice revision がどの upstream revision に対して互換性確認されたか」**

を再現可能にするための compatibility metadata として扱う。

専用 metadata を single source of truth とし、README 等から利用者が確認可能にする。

具体的なファイル名・データ形式は設計フェーズで決定する。

## 15. 再検証可能性

今回一度だけ upstream compatibility を確認して終了するのではなく、将来 upstream HEAD が更新された際にも同等の確認を再実行可能であることを要求する。

少なくとも、

1. 対象 upstream revision を特定できる
2. Justice と upstream の契約点を再確認できる
3. 必要な verification を実行できる
4. 主要 E2E を再実行できる
5. 検証済み revision を更新できる

状態にする。

CI、scheduled job、自動 dependency update 等を導入するかは今回の要件では固定しない。

具体的な自動化方式は設計フェーズで判断する。

## 16. 非機能要件

### 再現性

互換性を確認した upstream branch / commit SHA を第三者が特定できること。

### 検証可能性

「最新対応」という曖昧な宣言ではなく、どの revision に対して何を確認したか判定可能であること。

### 保守性

旧 upstream の互換コードを必要以上に残さないこと。

### スコープ抑制

upstream 追従と無関係な refactoring、機能追加、他 harness 対応を混在させないこと。

## 17. 対象外

今回、以下は要求しない。

* 旧 Superpowers との後方互換
* 旧 oh-my-openagent との後方互換
* 旧 OmO config format の Justice 独自 migration
* Codex 向け Justice 対応
* Senpi 向け Justice 対応
* その他 OpenCode 以外の harness 対応
* OpenCode 自体の全面的な最新版監査
* upstream 追従と無関係な新機能
* 無関係な refactoring
* 将来想定だけを目的とした abstraction
* CI / scheduled updater 等の具体的な自動化方式の事前固定

## 18. 受け入れ条件

以下をすべて満たした場合に upstream 追従完了と判断する。

1. `justice/master` 全体から upstream 契約点が洗い出されている。
2. 各契約点について `superpowers/main` HEAD または `oh-my-openagent/dev` HEAD の現在仕様と照合されている。
3. 古い upstream 前提が残っている箇所が特定されている。
4. 必要な箇所が最新 upstream の契約へ追従している。
5. upstream に吸収された Justice の責務について、意味的な同等性を確認したうえで維持・削除・縮小が判断されている。
6. Justice のユーザー向け契約は、upstream と矛盾しないものについて維持されている。
7. OmO 設定契約が最新 `omo.json[c]` に整合している。
8. 廃止済みの旧 OmO 設定形式を Justice が独自に維持していない。
9. README / docs / examples が最新仕様と矛盾していない。
10. 最新 upstream を使用した主要正常系 E2E が成功する。
11. Justice が責務を持つ主要な background / continuation / compaction / completion 系 E2E が成功する。
12. 検証した Superpowers の branch + full commit SHA が記録されている。
13. 検証した oh-my-openagent の branch + full commit SHA が記録されている。
14. compatibility metadata を利用者が確認できる。
15. 将来 upstream HEAD が変わった際に同等の compatibility verification を再実行できる。
16. OpenCode 以外の harness 対応など、今回対象外の変更が不必要に混入していない。

## 19. 既決事項

* Justice の対象 branch は `master`。
* Superpowers は `main` HEAD を基準とする。
* oh-my-openagent は `dev` HEAD を基準とする。
* prerelease / unreleased の変更も追従対象。
* 正式対応 harness は OpenCode のみ。
* upstream 旧版との後方互換性は不要。
* Justice の公開 UX は原則維持する。
* upstream と両立しない場合は Justice 側の breaking change を許容する。
* upstream に意味的に同等以上の機能が存在する場合、Justice の重複責務は削除・縮小可能。
* OmO の設定は最新 `omo.json[c]` を正式対象とする。
* 旧 OmO 設定形式への Justice 独自互換は不要。
* 実環境 E2E を追従完了条件とする。
* 主要な継続・復旧系も E2E 対象とする。
* ドキュメント・設定例も追従対象とする。
* upstream の branch + full commit SHA を compatibility metadata として記録する。
* 将来の upstream 更新時にも再検証可能にする。
* Justice 全体から upstream 契約点を網羅的に監査する。
* OpenCode 単独の全面アップグレード監査は行わない。

## 20. 未決事項 — brainstorming / 設計フェーズへ委譲

以下は本要件では確定せず、Superpowers の brainstorming および後続設計で判断する。

* compatibility metadata のファイル名・フォーマット
* upstream contract audit の具体的な実施方式
* E2E verification の具体的な実装方式
* CI へ組み込むか
* upstream 更新検知を自動化するか
* Justice 内部のどの既存責務を削除・置換するか
* 最新 upstream API に対する具体的な adapter / integration の実装方式
* test 構成
* component / module 構成
* error handling の具体方式
* migration の具体的な実装手順

これらを本要件から先回りして固定しないこと。

## 21. brainstorming への依頼

まず実装案を作るのではなく、以下の順序で現状との差分を確定すること。

1. `justice/master` HEAD を固定する。
2. `superpowers/main` HEAD と full commit SHA を固定する。
3. `oh-my-openagent/dev` HEAD と full commit SHA を固定する。
4. Justice 全体から upstream contract を抽出する。
5. 各 contract を upstream のコード・ドキュメント・test と照合する。
6. 各項目を少なくとも以下に分類する。

   * 現状のまま互換
   * Justice 側の更新が必要
   * upstream に責務が吸収済み
   * upstream との意味的な差分が残る
   * 判断に追加調査が必要
7. その結果を基に、必要な変更について brainstorming を行う。

推測だけで upstream compatibility を判定せず、可能な限り upstream の実コード・test・documentation を根拠とすること。

