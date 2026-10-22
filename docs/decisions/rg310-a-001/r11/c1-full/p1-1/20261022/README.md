# Justice RG-310 C1-FULL — P1.1 intake and subsequent pinned-tree evidence

**Date:** 2026-10-22 JST. **Class:** archival coordinator assessment + source enumeration only. **Status:** P1.1 `NOT_EXHAUSTIVE / INTERFACE_FREEZE_STOP`; R11 `UNAPPROVED`, formal DS-02 `PENDING`, Task1 31/32 with Case A and unknown-tool BLOCKED; no B0/B1/B2/HOST authorization.

## Supplied independent P1.1 result

Original supplied ZIP: `Justice_RG310_C1_FULL_P1_1_Independent_Static_Result_20261022(1).zip`.
- Measured SHA-256: `6a1b5915a3d2e6e90f9287b9d8f116e04aa36d54adef365eed4816bbb3003613`.
- CRC: PASS; source files declared in inner MANIFEST and SHA256SUMS: **6/6 bytes and SHA-256 MATCH**.
- Findings: prior 22 OPEN; counterexamples NC-01..37 NOT_EXECUTED; U-01..U-12 remain unresolved per author's original submission.
- Census: 74 preserved + 8 appended N-47..54 = 82. Reconciliation includes the separate doctor CLI and source-defined-but-not-exported Justice tool definitions.
- Status remains a **bounded** source investigation and is NOT automatically promoted by our later retrieval.

**Original ZIP bytes:** the independent result remains available as the user-provided conversation attachment. **Not yet committed as a binary GitHub artifact.** Do not mistake this README or independent source evidence for the original ZIP bytes.

## NEW, subsequent coordinator read-only verification — NOT part of the independent P1.1 report

Unlike P1.1's original tool capabilities, the current GitHub connector's GET-only Git-data endpoint returned an exact recursive tree for fixed Justice Evidence commit `c428041dfb5779b6b6dc8db7bf14928225a00373`:
- Commit `c428041dfb5779b6b6dc8db7bf14928225a00373` root tree `2c1e8bd2f57cdc4eb47cf6a07b5934704c1b18f4`.
- GET `/git/trees/2c1e8bd2f57cdc4eb47cf6a07b5934704c1b18f4?recursive=1`: **truncated=false**, **431 objects: 386 blobs and 45 subtrees**.
- Complete tree entries: [PINNED_FIXED_TREE_431_ENTRIES.tsv](PINNED_FIXED_TREE_431_ENTRIES.tsv). No type=commit gitlinks and no symlink mode=120000, in this fixed tracked tree.
- `.github/workflows/`: exactly **six YAML files** at that pinned commit, not just `ci.yml` and `release.yml`:

  - [`.github/workflows/ci.yml`](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/.github/workflows/ci.yml) — blob `89570689e752937bd2e40f30a14c67e842181ef6`
  - [`.github/workflows/codecov.yml`](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/.github/workflows/codecov.yml) — blob `3767d2f3b187623ebedd0cf9f4b93f1fbba236f0`
  - [`.github/workflows/release-version-guard.yml`](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/.github/workflows/release-version-guard.yml) — blob `4fb66c1b49e022796cd51ff956b7793de8383cfc`
  - [`.github/workflows/release.yml`](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/.github/workflows/release.yml) — blob `4f984a012f3fa9421a32531a00394f4d654d5284`
  - [`.github/workflows/semgrep.yml`](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/.github/workflows/semgrep.yml) — blob `763eec4ff600d8083a97114c209344bc421422ba`
  - [`.github/workflows/snyk.yml`](https://github.com/yohi/justice/blob/c428041dfb5779b6b6dc8db7bf14928225a00373/.github/workflows/snyk.yml) — blob `58fae0a04274384530debc9ce0aed66116faa012`

- A pinned `scripts/release-version-guard.mjs` exists (blob `885f78af3193b6d2e7037908e327ed9aafc51441`), referenced by workflow `release-version-guard.yml`.
- New semantic leads in the four other workflows: `codecov.yml` builds native and JS, uploads coverage artifacts to GitHub/Codecov and runs SonarCloud with declared tokens; `release-version-guard.yml` reads version/tag and invokes the script; `semgrep.yml` uses declared security-events write and SARIF upload; `snyk.yml` receives a token and may upload SARIF. These are **source-declared paths**, not verified executions/permissions/effects.

### What this evidence resolves and does not

- U-01 (the **enumeration of paths of the pinned tracked Git tree**) now has a direct, complete REST tree response. The original P1.1's `NOT_VERIFIED` remains historically correct; this subsequent supplementary evidence can be used for **a new scoped U-01 static recheck**.
- Recursive traversal does **not** prove all source semantic effects, external GitHub App/admin writers, third-party package consumers, dynamic imports, downloaded dependencies, build materials, host-loaded bytes, runtime deny points, or outstanding U-02..U-12.
- Source structure must be rechecked for six workflows, scripts, dynamic consumer links and imported P1.1 census omissions. Do NOT label the source/effect graph `EXHAUSTIVE` without a separate consumer/producer closure review.
- The strict C1-FULL promise to non-cooperating third-party owners of previously distributed packages remains structurally incompatible with forced use of a private Gateway absent an independently enforceable execution boundary. That owner/normative scope issue cannot be settled by a complete Git tree.

## Next step

1. Treat independent P1.1 as NOT_EXHAUSTIVE/STOP, and this tree enumerator as an independently retrievable **coordinator static supplement only**, not a formal Gate or self-certified P1.1 amendment.
2. Commission limited new investigation/recheck: scan all 386 pinned blobs by semantic role, at minimum six workflows and their scripts/actions, source exports/CLI/native and consumer dependency closure. Reconcile CE/N IDs to the tree, U-01 through U-12 statuses and permissions; report any unmapped entries.
3. Independently adjudicate the public third-party scope decision (DS-02 pending), without silently shrinking C1-FULL to C2-LIMITED. P2–P4 conceptual alternatives may be drafted but interface freeze, Gate promotion and HOST execution stay STOP.
4. Preserve PR #295 and #325 OPEN/Draft and approved Requirements/Design/Plan untouched.
