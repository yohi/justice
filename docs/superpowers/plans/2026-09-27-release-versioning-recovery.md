# Release Versioning Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the pending release to `4.0.0`, align release-please's tag lookup with the repository's `vX.Y.Z` tags, and prevent future version downgrades.

**Architecture:** Configure release-please manifest mode with the root package at 3.0.0, disable component prefixes in tags to match existing `vX.Y.Z` tags, and set an immediate 4.0.0 override. A read-only PR workflow checks candidate version monotonicity. After v4.0.0 is released, remove the one-time override while retaining the manifest and tag-format setting.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action@v5`, Node.js, Bun/Vitest, GitHub Releases.

## Global Constraints

- The current released version is `3.0.0` (`v3.0.0` tag).
- The immediate target release is `4.0.0`.
- Do not merge PR #208, create a release/tag manually, or publish the package during implementation.
- Publishing remains conditional on release-please successfully creating a release.
- Subsequent versions must use conventional-commit calculation with no permanent `release-as` override or bootstrap SHA.
- Run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` inside `.devcontainer/` before declaring implementation complete.

---

## File Map

- `.release-please-config.json`: root package config; tag naming and temporary 4.0.0 override.
- `.release-please-manifest.json`: package version baseline; begins at 3.0.0 and is updated by release-please.
- `.github/workflows/release.yml`: pass explicit config and manifest paths; preserve existing release lifecycle.
- `.github/workflows/release-version-guard.yml`: run a read-only downgrade check on release-please PRs.
- `scripts/release-version-guard.mjs`: strict stable-semver comparison and CLI.
- `tests/release/release-version-guard.test.mjs`: unit and CLI behavior tests using Bun's test runner.

## Task 1: Implement and test the version guard

**Files:**
- Create: `tests/release/release-version-guard.test.mjs`
- Create: `scripts/release-version-guard.mjs`

**Interfaces:**
- `compareVersions(left, right)` returns -1, 0, or 1 for stable `major.minor.patch` versions and rejects malformed values.
- `isCandidateVersionAllowed(candidate, latest)` returns true for equal or higher candidate versions.
- CLI accepts exactly `--candidate <version> --latest <version>`; invalid input or downgrade exits nonzero and prints both values.

- [ ] **Step 1: Add tests first**

  Use `bun:test` and `node:assert/strict`. Test higher (4.0.0 vs 3.0.0), equal (3.0.0 vs 3.0.0), downgrade (2.5.0 vs 3.0.0), malformed version, and CLI exit behavior. Keep one behavior per test.

- [ ] **Step 2: Verify RED**

  Run: `bun test tests/release/release-version-guard.test.mjs`
  Expected: test process fails because the imported script module does not yet exist.

- [ ] **Step 3: Implement the minimum script**

  Parse versions with `/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/`; compare numeric components in order. Guard CLI execution using `pathToFileURL(process.argv[1]).href === import.meta.url`, print actionable errors to stderr, and set `process.exitCode = 1` for invalid input or downgrade.

- [ ] **Step 4: Verify GREEN**

  Run: `bun test tests/release/release-version-guard.test.mjs`
  Expected: all unit and CLI cases pass.

## Task 2: Configure release-please manifest mode against existing tags

**Files:**
- Create: `.release-please-config.json`
- Create: `.release-please-manifest.json`
- Modify: `.github/workflows/release.yml:14-22`

**Interfaces:**
- Config contains `"include-component-in-tag": false` and `"release-as": "4.0.0"`; the root package entry declares `"release-type": "node"`.
- Config packages map contains root path `".": {}`.
- Manifest contains `".": "3.0.0"`.
- Action receives `config-file: .release-please-config.json` and `manifest-file: .release-please-manifest.json`.

- [ ] **Step 1: Create config and manifest with the values above**
- [ ] **Step 2: Add the two action inputs, retaining the existing pinned action SHA, target branch, and `release_created`-guarded publishing steps**
- [ ] **Step 3: Validate both JSON documents with Node's `JSON.parse`**
- [ ] **Step 4: Confirm `include-component-in-tag: false` matches existing tags with `git tag --list 'v*' --sort=-version:refname`**
- [ ] **Step 5: Review workflow diff and verify no package publishing step can run when `release_created` is false**

## Task 3: Add release PR downgrade protection

**Files:**
- Create: `.github/workflows/release-version-guard.yml`
- Consume: `scripts/release-version-guard.mjs`

**Interfaces:**
- Trigger on `pull_request` with head branch pattern `release-please--*`.
- Use read-only `contents: read` permission, full checkout history, and highest semantic `v*` tag.
- Read the PR candidate from `package.json` and call the CLI with candidate/latest values.
- Fail with a clear message if no matching version tag is available.

- [ ] **Step 1: Add workflow with branch filter, read-only permissions, and full-history checkout**
- [ ] **Step 2: Resolve the latest `v[0-9]*` tag using `git tag --list 'v[0-9]*' --sort=-version:refname | head -n 1`**
- [ ] **Step 3: Read candidate package version and invoke `node scripts/release-version-guard.mjs --candidate "$candidate" --latest "${latest#v}"`**
- [ ] **Step 4: Fail closed when the tag value is empty; validate workflow YAML using installed project tooling**
- [ ] **Step 5: Locally verify candidate `2.5.0` fails and `4.0.0` succeeds against `3.0.0`**

## Task 4: Verify release-please output and release lifecycle

**Files:**
- Generated by release-please: release PR branch `release-please--branches--master--components--justice`.
- Verify: `package.json`, `.release-please-manifest.json`, `CHANGELOG.md`.

- [ ] **Step 1: After config changes are on `master`, allow the regular release workflow to update its release PR; do not merge the PR**
- [ ] **Step 2: Confirm the release candidate is 4.0.0 in package and manifest files**
- [ ] **Step 3: Confirm changelog begins at v3.0.0 history and preserves all older sections in their existing order**
- [ ] **Step 4: Confirm the downgrade workflow passes for the 4.0.0 candidate and rejects a local 2.5.0 fixture**
- [ ] **Step 5: Run inside `.devcontainer/`: `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build`**
- [ ] **Step 6: After the v4.0.0 release PR is officially merged and released, remove `release-as`; retain manifest mode and `include-component-in-tag: false`**

## Self-review

- Tag lookup uses the repository's existing `vX.Y.Z` scheme, preventing release-please from scanning the full history and reapplying the stale override.
- The manifest baseline plus matching tag scheme lets release-please scope changelog generation to the existing v3.0.0 release.
- The one-time v4 override is explicitly removed after release; future semantic calculation is not pinned.
- A pull-request guard catches a future downgrade before merge.
- Build, publish, and release asset steps remain gated by `release_created`.
- The plan does not merge a PR or create a release/tag/package.
