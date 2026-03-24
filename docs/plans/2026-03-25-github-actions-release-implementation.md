# GitHub Actions & Release Please Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** GitHub Actions を使用して、`ubuntu-slim` ランナー上でテスト・ビルド・GitHub Packages への公開を自動化する。

**Architecture:** CI ワークフローで品質担保を行い、`release-please-action` を使用して `master` ブランチへのマージ時にリリースとパッケージ公開を自動実行する。

**Tech Stack:** GitHub Actions, Bun, release-please, npm (for publishing)

---

### Task 1: `package.json` の更新

**Files:**
- Modify: `package.json`

**Step 1: パッケージ名と公開設定の更新**
`name` を `@yohi/justice` に変更し、`publishConfig` と `repository` を追加します。

```json
{
  "name": "@yohi/justice",
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yohi/justice.git"
  },
  ...
}
```

**Step 2: 変更の確認**
`cat package.json` で内容を確認します。

**Step 3: コマンド実行**
Run: `bun run build` (ビルドが通ることを確認)
Expected: `dist/` ディレクトリが生成される

**Step 4: コミット**
```bash
git add package.json
git commit -m "chore: パッケージ名を @yohi/justice に変更し公開設定を追加"
```

---

### Task 2: CI ワークフローの作成

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: CI ワークフローファイルの作成**
`ubuntu-slim` ランナーを使用し、Lint、Typecheck、Test、Build を実行する設定を記述します。

```yaml
name: CI

on:
  push:
    branches: [ master ]
  pull_request:
    branches: [ master ]

jobs:
  test:
    runs-on: ubuntu-slim
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build
```

**Step 2: ファイルの確認**
`cat .github/workflows/ci.yml` で内容を確認します。

**Step 3: コミット**
```bash
git add .github/workflows/ci.yml
git commit -m "ci: ubuntu-slim ランナーを使用した CI ワークフローを追加"
```

---

### Task 3: リリースワークフローの作成

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: リリースワークフローファイルの作成**
`release-please-action@v4` を使用し、リリース作成時に自動的に GitHub Packages へ公開する設定を記述します。

```yaml
name: release-please

on:
  push:
    branches:
      - master

permissions:
  contents: write
  pull-requests: write
  packages: write

jobs:
  release-please:
    runs-on: ubuntu-slim
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          release-type: node
          target-branch: master

      - uses: actions/checkout@v4
        if: ${{ steps.release.outputs.release_created }}
      - uses: oven-sh/setup-bun@v2
        if: ${{ steps.release.outputs.release_created }}
      - name: Install dependencies
        run: bun install --frozen-lockfile
        if: ${{ steps.release.outputs.release_created }}
      - name: Build
        run: bun run build
        if: ${{ steps.release.outputs.release_created }}
      - name: Publish to GitHub Packages
        run: |
          npm config set //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
          npm publish
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        if: ${{ steps.release.outputs.release_created }}
```

**Step 2: ファイルの確認**
`cat .github/workflows/release.yml` で内容を確認します。

**Step 3: コミット**
```bash
git add .github/workflows/release.yml
git commit -m "ci: release-please による自動リリースと公開のワークフローを追加"
```
