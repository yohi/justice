# Release Versioning Recovery Design

**Status:** Accepted for implementation

**Target:** Justice `v4.0.0`

## Context

Justice releases are driven by `.github/workflows/release.yml`, which runs
`googleapis/release-please-action` on pushes to `master` with `release-type:
node`. The action updates `package.json` and `CHANGELOG.md` in a release PR;
after the release PR is merged and a GitHub release is created, the workflow
builds and publishes the package to GitHub Packages.

The latest published tag and package version are `v3.0.0` and `3.0.0`. PR #208
nevertheless proposes version `2.5.0` and inserts its release notes ahead of
the existing 3.0.0 section.

The release-please run for PR #208 considered 495 commits and proposed changing
the package from 3.0.0 to 2.5.0. The repository's tags use `vX.Y.Z`, but because
the Node package is named `@yohi/justice`, release-please derives a component
tag such as `justice-v3.0.0` unless `include-component-in-tag` is disabled. It
therefore failed to recognize `v3.0.0` as the latest release and scanned old
history, including PR #183's `Release-As: 2.5.0` footer. That mismatch is the
root cause of the downgrade and duplicated historical changelog content.

The repository already documents v4.0.0 as the target for accumulated breaking
changes and controller configuration assurance. The intended outcome is to
release those changes as `4.0.0`, then resume normal release calculation from
the correctly recognized latest tag.

## Design

1. Migrate to explicit release-please config and manifest mode. Set
   `include-component-in-tag: false` to match the existing `vX.Y.Z` tag scheme.
2. Bootstrap the manifest at `3.0.0`. With `include-component-in-tag: false`,
   release-please recognizes the existing `v3.0.0` tag as its release baseline
   and gathers only commits since that release.
3. Use `release-as: 4.0.0` for the immediate release only. Remove the override
   after v4.0.0 is released; retain manifest mode and the updated 4.0.0
   baseline.
4. Correct the release PR so `package.json` and the manifest are `4.0.0`, and
   the changelog adds one 4.0.0 section above the unchanged 3.0.0 history.
5. Add a pull-request check that rejects release candidates lower than the
   latest `v*` release tag. Preserve the current release-created-only build and
   publishing sequence. Do not merge or publish as part of this repair.

## Alternatives considered

- **Only edit `package.json` in PR #208:** rejected because it leaves the
  tag-format mismatch and will continue to scan old history.
- **Permanently pin `release-as: 4.0.0`:** rejected because later releases
  would no longer follow conventional-commit version calculation.
- **Keep the release-type workflow without a manifest:** rejected because it
  leaves the package's authoritative release baseline implicit.
- **Remove release-please and version manually:** rejected because the current
  workflow already automates changelog generation, tagging, publishing, and
  release asset upload.

## Verification

- Confirm release-please recognizes `v3.0.0` and proposes `4.0.0` using history
  after that tag only.
- Confirm the generated changelog preserves existing sections in order and
  adds a single 4.0.0 section.
- Exercise the version regression guard with a lower, equal, higher, and invalid
  candidate version.
- Run repository-mandated test, typecheck, lint, and build commands inside the
  devcontainer.
- Verify all package publishing steps remain gated on successful release
  creation and the PR version guard is read-only.

## Boundaries

This change does not merge PR #208, create a GitHub release or tag manually, or
publish to GitHub Packages. Those actions remain within the existing release
workflow and human merge decision.
