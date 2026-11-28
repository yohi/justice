# Release Management Runbook (label-driven)

Release versions are selected by the Human Owner with labels on the release-please Release PR.
Nothing here has been executed against the real repository: no label, tag, release or package for v6 exists.

## Mechanism

- `release-please-action` v5 (pinned SHA) still creates Tags / GitHub Releases / CHANGELOG on master pushes
  (`skip-github-pull-request: true` in the `release-please` job).
- The `release-pr` job creates/updates the Release PR with the official CLI
  `release-please@17.6.0 release-pr --release-as <version>` (the action ignores `release-as` in manifest mode).
  It runs on master pushes and on `labeled` / `unlabeled` events of release PRs (`pull_request_target`,
  trusted master code only; the PR head is never checked out). It never creates tags, releases or packages.
- `.release-please-config.json` keeps `prerelease: true` and no `release-as`. Stable versions >= 1.0.0 are
  still normal releases; prerelease versions are GitHub Prereleases.
- `scripts/release-label-resolver.mjs` maps labels + existing tags to a version (SemVer, tag-derived RC numbers).
  Manifest / `package.json` / CHANGELOG are only ever written by release-please.
- `scripts/release-version-guard.mjs` and the `release-version-guard` workflow reject downgrades, duplicates,
  tag collisions, package/manifest mismatch, and a candidate that differs from the label selection.
- Publishing (`release.yml`): build, channel resolution (`next` for prereleases, `latest` for stable), one
  `npm pack`, content verification, `npm publish <tarball> --tag <dist-tag>`, same tarball as Release asset.

## Labels

Required Repository labels (create once; not created by this change):

| Label | Meaning |
|---|---|
| `release: major` / `release: minor` / `release: patch` | bump from the latest **stable** version |
| `release: version=X.Y.Z` | explicit stable core version (exclusive with major/minor/patch) |
| `release: alpha` / `release: beta` / `release: rc` | prerelease channel, number auto-assigned from tags |
| `release: stable` | stable release |

Rules:

- A channel label is always required, plus either one bump label, one `version=` label, or an active prerelease series.
- Channel only (no bump/version) continues or promotes the single active prerelease series
  (`6.0.0-rc.1` + `rc` = `6.0.0-rc.2`; `6.0.0-rc.2` + `stable` = `6.0.0`).
- Conflicts fail closed (the Release PR is left unchanged): several bump / channel / version labels,
  version + bump, malformed or unknown `release:` labels, channel-only without an active series,
  several active prerelease series (use `version=`), downgrade, existing tag.
- RC numbers come from published tags only, so label toggling, master pushes and workflow re-runs never
  advance an unpublished RC.
- Labels count only if the actor who applied them has write permission (checked at event time and again by the guard).

| Current | Labels | Result |
|---|---|---|
| 4.3.1 | `version=6.0.0` + `rc` | 6.0.0-rc.1 |
| 4.3.1 | `major` + `rc` | 5.0.0-rc.1 |
| 6.0.0-rc.1 | `rc` | 6.0.0-rc.2 |
| 6.0.0-rc.2 | `stable` | 6.0.0 |
| 6.0.0 | `patch` + `stable` / `minor` + `stable` | 6.0.1 / 6.1.0 |
| 6.0.0 | `minor` + `rc` / `major` + `rc` | 6.1.0-rc.1 / 7.0.0-rc.1 |

## Owner steps

1. Register the labels above (Owner approval; not done here). Merge the readiness PR (human only).
2. First v6 RC: on the Release PR apply `release: version=6.0.0` and `release: rc`. The `release-pr` job then updates the PR
   to `6.0.0-rc.1`.
3. Confirm the Guard for the **latest** PR head (see "Guard and PR head" below), review version, `CHANGELOG.md`,
   manifest = `package.json`, then merge the Release PR (human only).
4. Labels belong to a single Release PR. They are **not** inherited by the next Release PR. On a master push with no
   open Release PR, the `release-pr` job creates a new Release PR without any labels (conventional-commit proposal,
   not publishable). For every new Release PR the Owner sets the labels again:

| Current release | Labels on the new Release PR | Expected version |
|---|---|---|
| 4.3.1 | `version=6.0.0` + `rc` | 6.0.0-rc.1 |
| 6.0.0-rc.1 | `rc` | 6.0.0-rc.2 |
| 6.0.0-rc.2 | `rc` | 6.0.0-rc.3 |
| 6.0.0-rc.3 | `stable` | 6.0.0 |
| 6.0.0 | `patch` + `stable` | 6.0.1 |
| 6.0.0 | `minor` + `rc` | 6.1.0-rc.1 |
| 6.0.0 | `major` + `rc` | 7.0.0-rc.1 |

   Expected versions follow the resolver rules and tests; they do not imply a successful publish.
   A Release PR without labels is not publishable.
5. PR #360 (`chore(master): release 4.1.0`) is stale and must not be merged. The `release-pr` job reuses the existing
   release-please PR/branch, so after the readiness PR lands it is updated in place to the labeled version; the guard
   rejects any candidate that is not newer than all tags. Close or keep #360 per Owner decision after checking the updated version.
6. Unlabeled Release PRs (initial conventional proposal) are not publishable: the guard fails until labels are applied.
   Keep the guard (and, if desired, the label check) as a required status check in repository settings; this change
   cannot enforce that and required-check settings were not verified.

## Guard and PR head

The guard checks out the PR head SHA of the event that started it. Re-running an existing run keeps that original
SHA, so it never validates a head produced later by the `release-pr` job. Therefore:

1. After the `release-pr` job updates the Release PR, look at the PR's **current** head SHA and find the
   `release-version-guard` run for that exact SHA (a run created by a PR event; label events can also start a run, but
   against the head at that moment).
2. If that run is waiting for approval (`ACTION_REQUIRED`), approve it through the normal GitHub procedure.
   Nothing here bypasses approval.
3. Do not treat a re-run of a run for the previous head as validation of the updated head.
4. If no Guard run exists for the latest head, or it failed, stop and do not merge.

Whether a branch update made with `GITHUB_TOKEN` starts a Guard run for the new head was not verified in the real
repository; GitHub documents that events caused by `GITHUB_TOKEN` generally do not start new workflow runs, so
expect to need a human-triggered run or Owner action. This is NOT_VERIFIED.

## Partial failure recovery

The tag and GitHub Release are created by release-please before build/publish. If a later step fails, do not delete or
move the tag. Inspect the real state first (tag, Release assets, `npm view @yohi/justice versions dist-tags`), then the Owner decides:
re-running failed jobs is possible but not guaranteed to be sufficient; `npm publish` refuses an existing version, so a
published version can never be overwritten. If only the Release asset upload failed, do not upload a freshly built tarball unchecked: a rebuilt tarball is not
guaranteed to be byte-identical to the published one, and the workflow's `${TARBALL}` is only available inside the
same run (it is not stored as an artifact). Upload is allowed only after the tarball's integrity matches the published
package: compare `npm view @yohi/justice@<version> dist.integrity` with the local tarball
(`openssl dgst -sha512 -binary <tarball> | base64`, prefixed `sha512-`). On mismatch, stop and the Owner decides.

## Verification limits (NOT_VERIFIED)

- No real label application, Release PR update by the new workflow, or Publish was performed.
- The official CLI dry-run confirmed `--release-as 6.0.0-rc.1` is applied (4.0.0 -> 6.0.0-rc.1) in manifest mode;
  the GitHub Release prerelease flag and GitHub Packages dist-tag behavior were not exercised.
- `collaborators/{user}/permission` access with `GITHUB_TOKEN`, and whether label events can update the PR when
  Actions approval or required checks apply, are unverified; the workflow fails closed.
- `npx release-please@17.6.0` is pinned by version only (no lockfile integrity).
