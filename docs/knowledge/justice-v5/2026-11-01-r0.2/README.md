# Justice v5 Knowledge & Evidence Reconciliation — R0.2

**Status:** `DOCUMENT_ONLY / CORRECTION_CANDIDATE / INDEPENDENT_R2_NOT_RUN / NO_OWNER_V6_ADOPTION / NO_IMPLEMENTATION_AUTHORITY`  
**基準日:** 2026-11-01 JST  
**Repository:** [yohi/justice](https://github.com/yohi/justice)  
**Knowledge Hub:** [Issue #348](https://github.com/yohi/justice/issues/348)  
**Fixed R0.1 PRE:** [`08e9dbe3bee87c1e7f16307f302760f1f7161b19`](https://github.com/yohi/justice/commit/08e9dbe3bee87c1e7f16307f302760f1f7161b19)  
**Fixed R0.1 POST / R0.2 source:** [`adbb397a6c73da22fafb1a656f16832bf961168d`](https://github.com/yohi/justice/commit/adbb397a6c73da22fafb1a656f16832bf961168d)

R0.2 is a limited documentary correction candidate derived from the seven files at `docs/knowledge/justice-v5/2026-11-01-r0.1/`. The R0.1 directory is unchanged. Normative Requirements, Design and Plan remain pinned to the PRE Commit and their specified Git blob identities. R0.2 responds to the independent R1 findings without claiming an independent R2 review or Owner adoption.

## Contents

- `JUSTICE_V5_PURPOSE_AND_GOALS_R0_2_20261101.md` — preserved purpose/goals with status boundary.
- `JUSTICE_V5_REQUIREMENT_DESIGN_TASK_CROSSWALK_R0_2_20261101.md` — retained 118/38/14/56 crosswalk plus per-scenario type and E2E closure evidence.
- `JUSTICE_V5_RESEARCH_EVIDENCE_LEDGER_R0_2_20261101.md` — fixed historical evidence, Task 1 finality, PR #342 archive provenance, strength definitions.
- `JUSTICE_V5_ARCHITECTURE_AND_V6_MAPPING_R0_2_20261101.md` — v4 historical adoption, Review Gate / SDD separation, candidate classifications.
- `evidence-index.json` — R0.1-compatible structured index with additive `r0_2_addendum`.
- `SHA256SUMS` — six R0.2 file hashes; this manifest is excluded from itself.

## R1 Finding → R0.2 correction crosswalk

Finding IDs occur in two independent review contexts in the fixed materials. `R0.2 R1-F-*` below means findings from the independent review of the v5 R0.1 archive. `V4 R1-F-*` means the continuing v4 source-coverage/architecture findings recorded in the Issue #345 Owner decision. The identical numeric labels are not the same finding and are not merged.

| R1 Finding | Correction | R0.2 location | Remaining status |
|---|---|---|---|
| `R0.2 R1-F-01` | Clarify v5 Semantic Control Plane purpose and candidate boundary | Purpose §R0.2; Architecture §8.3–8.4 | Analyst candidates only; no v6 Requirement |
| `R0.2 R1-F-02` | Add per-scenario verification type, E2E closure reference/status, evidence strength and gaps; retain the original 56 scenario rows | Crosswalk §7 | All 56: `E2E_CLOSURE_NOT_ESTABLISHED`; Task 14 closure is planned, not run |
| `R0.2 R1-F-03` | Reconcile revisioned Task 1 result and superseded 32/32 snapshot | Evidence Ledger §7.1; evidence index `JV5-E-013` | Final corrected 31/32; Case A and overall Task 1 remain `BLOCKED` |
| `R0.2 R1-F-04` | Preserve exact message identity, post-error observation and positive sanitization gaps; separate observation from historical test report | Evidence Ledger §7.1; index `JV5-E-013` | `BLOCKED`/`NOT_VERIFIED`; no promotion |
| `R0.2 R1-F-05` | Separate earlier PR #342 pending transfer from later fixed-HEAD receipt; verify tree/blob/bytes/hash/CRC distinctly | Evidence Ledger §7.2; index `JV5-E-015` | Receipt and fetched Git blob verified; original pre-upload byte comparison not available |
| `R0.2 R1-F-06` | Distinguish Issues #297/#298/#310 Review Gate contracts, proposals, ratification and implementation gaps from Superpowers SDD scheduling | Evidence Ledger §7.3; Architecture §8.2; index `JV5-E-017` | No `DESIGN_CLEAR` / `PLAN_CLEAR`; no Gate or implementation authority |
| `R0.2 R1-F-07` | Record bounded v4 historical adoption and unresolved findings without inferring candidate links | Architecture §8.1, §8.3; index `JV5-E-016`, `JV5-E-018` | Historical knowledge only; v6 not adopted; source coverage bounded |
| `R0.2 R1-F-08` | Classify invariant, host-adaptive mechanism, proof obligation, and optional/value-unproven function | Architecture §8.3–8.4; index `JV5-E-018` | A/B/C remain `UNSELECTED`; no unmeasured Host PASS |
| Evidence normalization | Add provenance-specific strength vocabulary while preserving existing fields and claim IDs | Evidence Ledger §7.4; `evidence-index.json` `r0_2_addendum` | Additive fields; historical top-level statuses retained |

The separate continuing v4 findings remain: `V4-R1-F-04` Finding Field Propagation, `V4-R1-F-05` Loop/Pivot Ownership, `V4-R1-F-06` OpenCode V2 TaskFeedback Correlation, and `V4-R1-F-07` Source Coverage Limitation. Their prefix is contextual notation only; the Owner decision's source labels are preserved in Architecture §8.1.

## Change scope

Only seven new files are created in this R0.2 directory. They derive from R0.1; the four narrative files preserve their prior content and add bounded corrections, the structured index adds an optional namespaced object, and the checksum manifest is regenerated from the six other R0.2 files.

Unchanged: R0.1 files; product/source code; tests; configuration; dependencies; CI; Gate/HOLD; v4 development status; v6 Requirements/Design/Architecture adoption; runtime option selection. No product code, test, build, Host Runtime, CI dispatch, CodeRabbit, GitHub write, commit, push, PR, issue update or merge was performed.

## Evidence and authority boundaries

- Task 1 final corrected historical outcome: `31/32 PROVEN / Case A BLOCKED / Case B PROVEN / Overall BLOCKED`.
- Tasks 2–14 remain `NOT_AUTHORIZED`.
- 56 scenario rows remain plans, not executed evidence. All are `E2E_CLOSURE_NOT_ESTABLISHED` in this correction.
- PR #342's earlier “not transferred” state and later archival Receipt are sequential states. R0.2 verified the fixed Git blobs' bytes, SHA-256 and ZIP CRC; it did not inspect the original pre-upload operator files.
- The Issue #345 Owner decision adopts only bounded v4 historical knowledge. It is **not** v6 adoption: `NO_OWNER_ADOPTION` for v6 remains in force.
- Option A / B / C remain `UNSELECTED`; no host ability is marked PASS based on this documentary work.
- `INDEPENDENT_R2_NOT_RUN`; this author does not substitute for the independent reviewer.
- `NO_GATE_CHANGE`; no `DESIGN_CLEAR` or `PLAN_CLEAR` is issued.
- `NO_IMPLEMENTATION_AUTHORITY`.

## Static preflight and verification scope

R0.2 was prepared in the approved isolated clone at fixed POST `adbb397a6c73da22fafb1a656f16832bf961168d`. The fixed PRE, three normative source blobs, R0.1 seven-file inventory and 6/6 source hashes were rechecked. The PR #342 fixed HEAD tree entries and archive blobs were read independently; recorded blob size, SHA-256 and ZIP CRC are itemized in the Evidence Ledger and JSON.

Post-creation verification is limited to R0.1 immutability, exact R0.2 file scope, SHA-256, JSON syntax and static ID / traceability / status reconciliation. These checks are document integrity checks, not product tests, host proof, or a Gate. The independent reviewer must freshly recheck the fixed inputs and all corrections.

## Stop and next decision

Stop if any fixed Commit/blob/hash differs, any R0.1 file changes, any unapproved path changes, a historical result requires inference to upgrade, a PASS/PROVEN promotion requires missing evidence, or further test/runtime/GitHub/Gate/Owner action is needed. Do not repair such a condition by moving HEAD, rewriting history, or editing R0.1.

**Handoff:** Fresh independent R2 must verify the fixed inputs, all seven R0.2 files and hashes, the 56-row retention/closure table, Task 1 finality, PR #342 provenance evidence, v4 adoption scope, Review Gate boundary, ID continuity, and that no authority or Gate status changed. R2 has not run; no PASS is claimed.
