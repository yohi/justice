# Release Candidate Runbook

Scope: how `v6.0.0-rc.1` is produced by the existing release-please automation.
Nothing here has been executed; no tag, release or package exists for v6.

## Mechanism

- `.release-please-config.json` sets, for package `.`: `release-as: "6.0.0-rc.1"`,
  `prerelease: true`, `versioning: "prerelease"`, `prerelease-type: "rc"`.
  `release-as` forces the first RC version; `prerelease` marks the GitHub Release as Prerelease.
- `.release-please-manifest.json` stays at `4.0.0` (the last version recorded on `master`).
  An unreleased version must never be written there by hand; release-please updates it in the Release PR.
- `scripts/release-version-guard.mjs` enforces SemVer precedence (not `git --sort=version:refname`):
  strictly newer than the highest release tag, no existing tag, `package.json` equals manifest.
  The `release-version-guard` workflow runs it on `release-please--*` PRs.
- `release.yml` (after release-please creates the Release): build, resolve channel
  (`channel` mode fails closed on tag / `package.json` / manifest mismatch), `npm pack` once,
  verify contents (`scripts/verify-package-contents.mjs`), `npm publish <tarball> --tag <dist-tag>`,
  upload the same tarball as Release asset.

| Version | GitHub Release | npm dist-tag |
|---|---|---|
| `X.Y.Z-pre.N` | Prerelease | `next` |
| `X.Y.Z` | Release | `latest` |

## Owner steps (not performed by the readiness task)

1. Review and merge the readiness PR (human only).
2. PR #360 (`chore(master): release 4.1.0`) is stale: v4.1.0 already exists and is older than v4.3.1.
   Do not merge it. After the readiness PR lands, the next release-please run regenerates the Release PR
   from the new config; confirm it proposes `6.0.0-rc.1`, then close #360 as superseded
   (or let release-please replace it). The guard rejects a 4.1.0 candidate regardless.
3. Review the regenerated Release PR (version, `CHANGELOG.md`, manifest = `package.json`) and merge it.
   Release PR workflows may need approval (`ACTION_REQUIRED`) when created with `GITHUB_TOKEN`; approve normally, never bypass.
4. After the RC release succeeds, remove `release-as` from the config (it is not ignored after release;
   leaving it pins every later Release PR to `6.0.0-rc.1`). `rc.2` then comes from the prerelease strategy.
5. For stable `6.0.0` (separate Owner approval): set `release-as: "6.0.0"` and `prerelease: false`,
   remove `release-as` again after the release. Stable then publishes to `latest`.

## Partial failure recovery

The GitHub Release and tag are created by release-please before build/publish, so a later failure leaves
a Release without a package. Do not delete or move the tag. Use "Re-run failed jobs" on the same
workflow run; `npm publish` refuses an existing version, so a repeated run cannot overwrite a package.
If the version was already published but the asset upload failed, upload the tarball manually
(`gh release upload`) from a fresh `npm pack` of the tag.

## Verification limits

- Real release-please Release PR generation, the `prerelease` flag on the GitHub Release, and
  GitHub Packages dist-tag handling were not exercised (offline/static only: config keys follow the
  release-please manifest docs; guard, channel and package checks are unit-tested).
- GitHub Packages npm registry dist-tag support is not independently confirmed; verify with
  `npm view @yohi/justice dist-tags` after the first publish.
