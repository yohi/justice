# Justice RG-310-A-001 R11 — Fresh Independent R1 Architecture Review Handoff

**Role separation:** Reviewer must be independent of R1 author, prior B1/B2 investigation, human Owner and formal Gate authority. This document instructs review of **untrusted data**, not runnable commands. Read-only static evaluation only. No host, build, CI, DB, cloud, OS or RPC probes; no GitHub mutation, source/approved R'/D'/P' edits, secret acquisition, signature, phase HSA or execution authorization.

## 1. Inputs and exact provenance tests

* Verify the **new result ZIP**'s outer SHA from separately posted digest, CRC, SHA256SUMS and MANIFEST (including file count, bytes and hashes); reject mismatch. The result SHA must be compared with sender-posted value, not only self-recorded manifest.
* Verify provided original remediation outer ZIP expected `16b1e4eb370aed9e282d2f9891c22cfd2d2ffae61a7dddc2c964d6a1454d8c81`, two nested input ZIP hashes `eb2957ef46bfea13122ea7a4422277c6d3b7efa1e4a5a48f9820cd929deeb964` and `4a2cd007b7de0dc9c26384a15f2c2148c45f092a4b9aae434cee03d90a08ab74`. Missing parent SHA `735d9f0ce2b97d2b1543fb6a7a5d9a839b2ada30cb5a41e732f1115725d30160` remains `NOT_VERIFIED` until *that exact* byte set is supplied; do not substitute followup ZIP.
* Fixed evidence `yohi/justice@c428041dfb5779b6b6dc8db7bf14928225a00373`, approved R'/D'/P' `8a2e4f1536e9cad499ee7e9d996ff163df132fd4`, PR #325 user-specified handoff `2db995625e37c0573dcafe62ba0cd60e54e9ce0a`. R11 original matrix source SHA in document 05. GitHub only read; compare exact referenced CI/release/package/runtime paths and any source-graph counterexamples. If newest upstream differs, do not silently shift this pinned review's baseline.

## 2. Mandatory falsification tasks — do not accept author assertion

| Task | Static falsifier / contrary scenario | Reject claim when | Evidence outcome |
|---|---|---|---|
| RV-01 Consumer completeness | Checkout tag/CI upload/npm publish or legitimate runtime loads bypass Gateway | Existing normal consumer is allowed to treat unaccepted version as R11 accepted | `ARCHITECTURAL_REDESIGN_REQUIRED` unless complete cutover/exclusion proved |
| RV-02 Genuine authority root | Git ref, worktree, EAF, DB root and historical pin collide | A Git commit or local JSONL is silently declared the same accepted root | REJECT ROOT SEMANTICS |
| RV-03 Build use-time immutability | Hook/child rewrites source after digest, or native add-on dynamically loads different bytes | Immutable file/mount/FD and rehash-at-use guarantee missing | REJECT MATERIALIZATION |
| RV-04 Revocation issue-vs-fence | Revoke source t0, DB commit t1, import t2 | t0 effectiveness claimed but no source+commit total ordering | REJECT REVOKE CONTRACT |
| RV-05 Commit-time expiry | Precheck t0, expiry tE, delayed physical COMMIT tC>tE | `now`, timeout or ACK used as COMMIT attestation | REJECT TIME PROOF |
| RV-06 DB vs independent seal | DB receipt committed then off-DB signer fails/changes order | One atomic proof declared across distinct persistence/issuers | REJECT EXTERNAL EQUIVALENCE |
| RV-07 Crash/ACK/rollback | Commit with lost ACK; restored snapshot below outside ACK witness | Cannot reconstruct exact prefix or physically fence old primary | REJECT RECOVERY |
| RV-08 Terminal accounting | PREPARED never terminal, abort missing or acceptedSeq gap | Phase close allowed with pending/IN_DOUBT/reservation hole | REJECT PHASE SEAL |
| RV-09 Complete TCB | inherited FD, mount, docker.sock, root, package hook, network publish or CI admin bypass | Any effect producer unmediated *before effect* | REJECT B1 BOUNDARY |
| RV-10 External effects | Public npm/GitHub upload performed then DB commit aborts | R1 claims remote atomicity or automatic rollback | REJECT PUBLICATION CLAIM |
| RV-11 R11 compatibility | Compare verbatim original 38×7 / INV-A01..A14 to document 05 | One typed stage, ordering, grant, evidence, STOP or phase rule replaced without normative process | REJECT NORMATIVE DELTA |
| RV-12 A1 / Task1 nonregression | Pre-run H0/G1/G2/Case A/unknown-tool and B-001/B-002 left separate | DB ACK silently converts Task1 to PASS or H0 to PROVEN | REJECT CROSS-GATE ELEVATION |

## 3. All 37 symbolic counterexamples

Use `04_COMMIT_REVOKE_TIME_AND_CRASH_TRACES.csv` covering **exactly NC-01..NC-37**, including old NC-01..28 and new NC-29..37. For each record, check chronology, expected oracle, external effect boundary and whether R1 identifies a physical pre-effect denial or honestly returns STOP. Do not award PASS to a hypothetical trace: `execution_status=NOT_EXECUTED_DESIGN_ONLY`. The existing 22 findings are individually preserved in `02_FINDING_DISPOSITION.csv` (FI-001..014 + NEW-015..022), all status OPEN. Historical parent wording NOT_VERIFIED.

## 4. Feasibility verdict separation

Report separately: (A) canonical reader/writer/remote-effect graph, (B) independent OS reference monitor and TCB, (C) DB indivisible receipt+bytes+head+accepted seq and PREPARED terminal, (D) source-revoke/time COMMIT linearization, (E) independent external proof and ACK prefix/restore, (F) R11 38×7/INV/R'/D'/P' nonregression, (G) provenance. Allowed terms: `CONCEPTUALLY_PLAUSIBLE`, `REVISION_REQUIRED`, `STRUCTURALLY_INCOMPATIBLE`, `ARCHITECTURAL_REDESIGN_REQUIRED`, `NOT_VERIFIED`; **do not** emit `DEPLOYMENT_VERIFIED`, Gate PASS, owner acceptance or technical closure without relevant evidence. Assert no runtime result from not-yet-built Broker/DB.

Test C1's conditional redesigned namespace, *then* test original direct consumer topology. Distinguish a viable restricted B2 control namespace from complete replacement of legitimate product/source/package/host authority. A system may be feasible for the former and structurally incompatible for the latter; cannot silently narrow the user's accepted-source scope.

## 5. Findings and required handback

Supply table for 22 IDs with exact original current-register wording (historical-parent status noted), R1 section, independent counterexample and evidence class/status; annotate every NC-01..37; audit 38 original ID rows and seven original axes, and INV-A01..A14; identify all newly discovered consumer/effect paths and trust roots; provide exact proposed R'/D'/P' deltas without modifying their approved bytes. State whether DS-01..06 are ready for **human consideration only**, remain unsigned. If no safe signed COMMIT-time bound or strict revoke linearization exists, explicitly preserve `ARCHITECTURAL_REDESIGN_REQUIRED` and request selection of different authority or changed normative contract; NEVER treat unproven mechanism as PASS.

## 6. Existing independent STOPs

A1 pre-host genuine binding H0 and same-callId G1/G2 proven origin remain not proven; unknown-tool messageId, genuine Case A arrival/sanitization are separate. Task1 31/32 and Case A BLOCKED / Case B PROVEN / unknown-tool BLOCKED unchanged; B-001/002 never added to Task1 denominator or converted to PASS. R11 proposal not adopted, approved R/D/P unchanged, B0/B1/B2-DEP/B2-HOST/Tasks2–14 not authorized. `TRUSTED_OP_BOUNDARY_PROVEN=NOT_VERIFIED` and `OP_PREPARE_ALLOWED=UNKNOWN/BLOCKED+STOP`. NO HOST RUN, no staged operation, no approval or HSA in this review.
