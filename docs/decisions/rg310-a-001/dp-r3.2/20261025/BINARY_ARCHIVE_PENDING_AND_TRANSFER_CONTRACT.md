# Justice RG-310-A-001 — DP-R3.2 original ZIP archival completion contract

**Status:** `BINARY_ORIGINALS_NOT_IN_GITHUB / DOCUMENT_ONLY / DRAFT_ONLY / NO_EXECUTION_GO`  
**Receipt date:** 2026-10-25 JST  
**Draft PR:** [#342](https://github.com/yohi/justice/pull/342)  
**Head:** `docs/rg310-dpr32-readiness-20261025`  
**Base:** `docs/rg310-dpr32-review-base-20261025` (**NOT** master).

## 1. Precise missing immutable originals

The independent-review and closure Markdown already preserved by this PR do **not** substitute for either original ZIP below.

| Original ZIP (byte-exact name) | Size | Expected SHA-256 |
|---|---:|---|
| `Justice_RG310_C1_FULL_DP_R3_2_Limited_Independent_Static_Review_Handoff_20261025.zip` | 1,310,442 bytes | `27169796ffbe0304853f9ba822ebdbd7959be68c37fb2033eff186a7d85a859a` |
| `Justice_RG310_DP_R3_2_Document_Readiness_Closure_Packet_20261025.zip` | 1,319,031 bytes | `d8927d47bfdeadcec09968b36b0066a8453af311ec8be107e638125c7e002b0d` |

**Proposed immutable repo destinations** (new files only):

- `docs/decisions/rg310-a-001/dp-r3.2/20261025/archives/Justice_RG310_C1_FULL_DP_R3_2_Limited_Independent_Static_Review_Handoff_20261025.zip`
- `docs/decisions/rg310-a-001/dp-r3.2/20261025/archives/Justice_RG310_DP_R3_2_Document_Readiness_Closure_Packet_20261025.zip`

Do not replace these ZIPs with a textual Base64 transport file and claim binary preservation. A text transport, if used, must be decoded, independently checked, and committed as the exact named binary.

## 2. Bounded result of the current attempt

- The original ZIPs were available in the operator's ephemeral file workspace, and their independent SHA-256s matched the values above.
- ZIP read/CRC checks passed for both input ZIPs (47/47 and 6/6 members). No traversal or absolute member path was observed.
- The connected GitHub interface supports creating Git blobs from supplied Base64, **but cannot directly read a local `/mnt/data` archive**. The working container lacks an authenticated git/gh network channel. The transport bridge was not completed in this attempt.
- **Neither ZIP is claimed committed to this PR.** Git object IDs, remote byte roundtrips and archive file listing have **NOT** been verified; the future custodian must perform them.
- No source, release, workflow, policy, Host, secrets, test, signature, interface freeze or formal Gate action is authorized by this document.

## 3. Future authorized, non-executing archive custody work

A custodian/agent with **both original ZIP bytes and separately approved GitHub write permissions** can finish this document-only archival task. Do not request/display any token in an AI transcript. Confirm repository visibility and suitability of archival contents before writing: this repository is public; archive ZIPs may expose more metadata than the text-only subset. Existing static filename/CRC checks are not an exhaustive secrets scan.

1. Verify original bytes **before** any upload (`sha256sum`) and check ZIP CRC and archive path safety without executing contained scripts or fixtures.
2. Read `PR #342` and assert it remains `Draft`, `OPEN`, head/base identical to those above. Verify the current exact HEAD before a write. Work only on its existing head branch; never push to `master`, retarget the PR, force-push, merge or create a release.
3. Copy each original ZIP to the corresponding `archives/` path. Commit **only those two new ZIP files** on the PR head, without changing the signed-off DP-R3.2 text, v5 R/D/P baseline, source, workflow or tests.
4. Read the committed blob bytes back from GitHub (git object or raw bytes), compute SHA-256 for **each**, and require exact size/digest match. For git fetch, verify `git show HEAD:<path> | sha256sum`; avoid relying only on committed filenames or SHA256SUMS inside an archive.
5. Independently confirm the PR still has `base=docs/rg310-dpr32-review-base-20261025`, `draft=true`, `merged=false` and the diff contains only the intended archival documents. Inspect any auto-triggered checks or external integration effects without executing new tests or changing provider permissions.
6. Record exact verified Git commit SHA, blob SHA-1, post-upload size/SHA-256 and retrieval observation timestamp in a follow-up static receipt. Keep original reviewer report byte-identical; no additional author/signature attribution.
7. If any prerequisite or byte comparison fails: **STOP / BINARY_ARCHIVE_NOT_VERIFIED**, do not claim document archival completeness.

This instruction is a storage/recordkeeping procedure, not product implementation or approval to run embedded tests.

## 4. Static command outline (future authorized operator only; NOT_EXECUTED)

From an **already authenticated, authorized local Git checkout** on the exact PR head, with the verified original ZIPs locally available:

```bash
set -euo pipefail
test "$(git branch --show-current)" = 'docs/rg310-dpr32-readiness-20261025'
test -z "$(git status --porcelain)"
src1='/path/to/Justice_RG310_C1_FULL_DP_R3_2_Limited_Independent_Static_Review_Handoff_20261025.zip'
src2='/path/to/Justice_RG310_DP_R3_2_Document_Readiness_Closure_Packet_20261025.zip'
printf '%s  %s\n' '27169796ffbe0304853f9ba822ebdbd7959be68c37fb2033eff186a7d85a859a' "$src1" \
  'd8927d47bfdeadcec09968b36b0066a8453af311ec8be107e638125c7e002b0d' "$src2" | sha256sum -c -
dir='docs/decisions/rg310-a-001/dp-r3.2/20261025/archives'
mkdir -p "$dir"
test ! -e "$dir/Justice_RG310_C1_FULL_DP_R3_2_Limited_Independent_Static_Review_Handoff_20261025.zip"
test ! -e "$dir/Justice_RG310_DP_R3_2_Document_Readiness_Closure_Packet_20261025.zip"
cp -- "$src1" "$dir/Justice_RG310_C1_FULL_DP_R3_2_Limited_Independent_Static_Review_Handoff_20261025.zip"
cp -- "$src2" "$dir/Justice_RG310_DP_R3_2_Document_Readiness_Closure_Packet_20261025.zip"
# Verify bytes at destinations, then stage ONLY those two paths.
(cd "$dir" && sha256sum *.zip)
git add -- "$dir/Justice_RG310_C1_FULL_DP_R3_2_Limited_Independent_Static_Review_Handoff_20261025.zip" "$dir/Justice_RG310_DP_R3_2_Document_Readiness_Closure_Packet_20261025.zip"
git diff --cached --name-only
# REQUIRE human/operator review of only these two paths before creating the commit.
# git commit -m "docs(rg310): preserve DP-R3.2 original handoff and closure ZIPs"
# git push origin docs/rg310-dpr32-readiness-20261025
# After pushing, separately retrieve exact remote bytes and independently SHA-256 verify.
```

The commit/push steps intentionally remain **commented** in the example. Upload and post-commit verification have not happened.

## 5. Authority and STOP preservation

`DOCUMENT_READINESS_PASS / LIMITED_STATIC_DOCUMENT_QUALITY_ONLY / NO_EXECUTION_GO` from the independent DP-R3.2 review remains the document-only status.

`R11 UNAPPROVED; R'/D'/P' NOT_ADOPTED; DS-01..06/O-01..07 PENDING; Task1 31/32 Case A BLOCKED; H0..H3 NOT_PROVEN; historical 22 Findings OPEN; NC37 NOT_EXECUTED; P2–P4 INTERFACE_FREEZE_STOP; Tasks2–14 NOT_AUTHORIZED; COMPLETE_MEDIATION_NOT_PROVEN`.

A document-only draft PR, an archival ZIP upload or a hash MATCH does **not** change any of these facts.

## 6. Follow-up static archival receipt — 2026-10-25

The pending state above describes the earlier transfer attempt. This receipt records the later byte-preserving archival on the same draft PR; it does not alter the authority or execution boundary.

- Repository: `yohi/justice`; PR: [#342](https://github.com/yohi/justice/pull/342).
- Archive commit: `ed41c4ca4e7cf58f0a15b608fdcacc45880a5e5e` on `docs/rg310-dpr32-readiness-20261025`; parent was the previously observed head `17c9e9d3073a75355a3d1e32f887a50b09860793`.
- Retrieved from GitHub branch `docs/rg310-dpr32-readiness-20261025` at `2026-10-25T13:28:59Z`; both retrieved byte streams were checked for size, SHA-256 and ZIP CRC.

| Archived path | Size | Git blob SHA-1 | Retrieved SHA-256 | ZIP CRC |
|---|---:|---|---|---|
| `docs/decisions/rg310-a-001/dp-r3.2/20261025/archives/DP_R3_2_Handoff.zip` | 1,310,442 bytes | `e90a88063f074c9d3bad210739e7fc7bb46fd8b0` | `27169796ffbe0304853f9ba822ebdbd7959be68c37fb2033eff186a7d85a859a` | PASS (47 members) |
| `docs/decisions/rg310-a-001/dp-r3.2/20261025/archives/DP_R3_2_Closure.zip` | 1,319,031 bytes | `8071798a0600239f2cb50ca2ff3a6b9f1d3a8cea` | `d8927d47bfdeadcec09968b36b0066a8453af311ec8be107e638125c7e002b0d` | PASS (6 members) |

- The archive commit changes only the two ZIP paths above. The PR remains `OPEN / DRAFT / UNMERGED` with the same non-master base `docs/rg310-dpr32-review-base-20261025`.
- Static path, duplicate-entry, CRC and common credential-pattern checks found no issues in the outer or nested ZIP members. These checks are bounded and are not an exhaustive secrets audit.
- The six repository GitHub Actions workflows were inspected: their configured push/PR base filters target `master`; no matching check runs were present after the push. External GitHub Apps, webhooks or integrations were not inspected and cannot be ruled out.
- No source, test, workflow, release, provider, Host, policy or Gate action was performed. No tests or embedded archive content were executed.
