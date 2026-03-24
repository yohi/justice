# デザインドキュメント: GitHub Actions と Release Please による自動公開設定

> **承認日**: 2026-03-25
> **ステータス**: 承認済み
> **著者**: Gemini CLI

## 1. 概要
このプロジェクト（`justice`）を GitHub Packages に公開するための CI/CD パイプラインを構築します。`release-please-action@v4` を使用してリリース管理を自動化し、GitHub が提供する最新の軽量ランナー `ubuntu-slim` を活用してコスト効率の高い実行環境を実現します。

## 2. 背景と目的
- **GitHub Packages への公開**: パッケージ名を `@yohi/justice` に変更し、GitHub Packages レジストリへの公開を可能にします。
- **リリースの自動化**: `release-please` を導入することで、Conventional Commits に基づく CHANGELOG の自動生成、バージョンアップ、およびタグ打ちを自動化します。
- **軽量ランナーの活用**: `ubuntu-slim` (1-vCPU) を使用し、必要最小限のリソースでビルドとテストを実行します。

## 3. 詳細設計

### 3.1 `package.json` の変更
- `name`: `justice-plugin` -> `@yohi/justice`
- `publishConfig`:
  ```json
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
  ```
- `repository`: `github:yohi/justice`

### 3.2 CI ワークフロー (`.github/workflows/ci.yml`)
- **ランナー**: `ubuntu-slim`
- **トリガー**: `master` ブランチへの `push` および `pull_request`
- **ステップ**:
  1. `actions/checkout@v4`
  2. `oven-sh/setup-bun@v2`
  3. `bun install --frozen-lockfile`
  4. `bun run lint`
  5. `bun run typecheck`
  6. `bun run test`
  7. `bun run build`

### 3.3 リリースワークフロー (`.github/workflows/release.yml`)
- **ランナー**: `ubuntu-slim`
- **トリガー**: `master` ブランチへの `push`
- **ステップ**:
  1. `release-please-action@v4` (target-branch: `master`)
  2. リリースが作成された場合 (`if: ${{ steps.release.outputs.release_created }}`):
     - `actions/checkout@v4`
     - `oven-sh/setup-bun@v2`
     - `bun install --frozen-lockfile`
     - `bun run build`
     - `npm publish` (GitHub Packages 用の認証トークンを使用)

## 4. セキュリティと認証
- GitHub Packages への公開には `GITHUB_TOKEN` を使用します。
- ワークフローの権限 (`permissions`) を適切に設定し、`contents: write`, `packages: write`, および `pull-requests: write` を許可します。
- **権限設定例**:
  ```yaml
  permissions:
    contents: write
    pull-requests: write
    packages: write
  ```

## 5. 移行計画
1. `package.json` の更新とコミット。
2. `.github/workflows/` ディレクトリの作成と各 YAML ファイルの配置。
3. `master` ブランチへのプッシュによる動作確認。
