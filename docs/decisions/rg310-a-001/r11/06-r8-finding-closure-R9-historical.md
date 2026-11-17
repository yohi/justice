# Justice v5 — RG-310-A-001 R8 Findings Closure / R8→R9 Diff Map

- Document ID: `RG310-R8-FI-CLOSURE-R9`, 2026-10-14 JST.
- **AUTHOR HYPOTHESIS ONLY / UNAPPROVED.** Not an R9 independent Gate, no Requirements/Design/Plan adoption, no implementation or runtime/host authority. R8 technical review verdict was `REVISION_REQUIRED`; formal independence/authority not established.
- Source R8 ZIP SHA-256 `d8b6c45c5dadb75b85df627831fdd07e68b23ae9ec1fe91a3041de96cccf9fd1`; origin R7/R6 hashes and fixed Git blobs unchanged; R5 complete original remains missing.

## 1. Independent R8 findings and limited author changes

| Finding | R8 original anchor | Observed defect (review input) | R9 revision anchors and type split | Closure hypothesis; residual |
|---|---|---|---|---|
| `R8-FI-004` Major | R8 `04` §3 `HOST_RUN_ALLOWED` L241–248 / §5 row34/35 L308–309 / §6 L343–356; R8 `01` E.9 L643–645 | Per-result *actual runtime* `HOST_ORIGIN_BOUND` was required before the same HOST_RUN that obtains that proof; hidden `HOST_RUN→origin proof→HOST_RUN` cycle. | R9 `04` §3/§3.1 new H0 start admission, H1 callback ingress, H2 actual `HOST_RESULT_ORIGIN_VERIFIED`, H3 `HOST_RUN_EVIDENCE_ACCEPTED`; rows34/35, §5.1, §6; main D.1/D.2/E.9/E.9.0.0/F.3.1/F.3.2/G.0.7/H/J. | **`AUTHOR_REVISED_NOT_CLOSED`**. H0 requires fixed public ingress capability+complete actor-external pre-effect monitor, human ACTIVATE, RA/freeze and no-effects isolation; cannot use future H2. H0 currently NOT_PROVEN→NO RUN/STOP. If no lawful independent route, human Option C. Actual R/I/Task1 unaffected. |
| `R8-FI-005` Minor | R8 `01` L493 chapter E heading says `Revision 7` though R8 is current | Editorial stale current normative version title | R9 `01` §E explicitly `Revision 9` complete unadopted candidate. Historical R7/R8 provenance preserved, only R9 `04` is operative candidate matrix. | **`AUTHOR_REVISED_NOT_CLOSED`** pending fresh reviewer independent examination. No direct runtime claim. |

## 2. Temporal preconditions / evidence output (must be independently falsified)

| Stage | First known | First permitted effect | Forbidden assumption |
|---|---|---|---|
| H0 prospective | exact HSA/RA/freeze, independent source/callback topology capability, pre-effect monitor, bounded isolation | one confined host-run START only if capability PROVEN | actual result H2 exists before execution |
| H1 ingress | actual callback arrives, independent trusted immutable source binding | only source-verified event processing | G2 current context identifies old G1 event by duplicate callId |
| H2 result | real result, order, generation, error/invalidation epoch, source trace | per-result `HOST_RESULT_ORIGIN_VERIFIED` | mock/absence/compiled P proves actual Task1 R |
| H3 evidence | independent sealed real H1/H2 trace and existing Task1 positive/negative controls | reviewable evidence *submission* only | automatic Task1 PASS/product I/receipt/authority |

Fixed API H0 capability and actual Senpi H1/H2 **remain NOT_PROVEN**. If pre-run complete binding/isolated effects cannot be guaranteed, no HOST_RUN START. Source-only or read-only audit may investigate; a live diagnostic needs separate human/independent grant and no-effect isolation before running. All unknown result origins reject before issuance, storage, receipt, external side effects or evidence adoption. Document-level temporal type repair is not an actual implementation proof.

## 3. Nonregression claims subject to R9 independent reviewer

- R7-FI-001/002/003: R8 technical review said `TEXTUALLY RESOLVED`; do not treat as operational evidence or formal Gate closure. R9 must preserve prospective OP_PREPARED vs retrospective atomic OP_COMMIT_ACCEPTED+ACCEPTED_DELTA; old matrix only historical; R5 review original unavailable.
- 38 stable state IDs `01..38` retained. R9 changes **only rows 34,35** to express H0→H1→H2→H3 and explicit NO RUN on unknown H0; remaining 36 literal rows are identical to R8, and seven evaluation columns remain present.
- 14 INV-A01..A14 complete rows are byte/text identical to R8; no weakening or extra Task1 conditions. Case A BLOCKED, Case B PROVEN, canonical 31/32, unknown-tool BLOCKED; existing evaluator unchanged.
- Task1 `R`, compiled `P`, production `I` separate; no reverse `fullTask6→Task1`, `Task1→RA`, `H2→H0`. B0/B1/DEP/HOST PREP/freeze/RA human ACTIVATE already distinct and require actor-external monitor proof.
- All phase grant/actual monitor/host operational proofs and organizational reviewer independence remain NOT_PROVEN. All operations NOT_AUTHORIZED.

## 4. R8→R9 file mapping

| R8 file | R9 file | Allowed differences |
|---|---|---|
| `01-architecture-decision-proposal-R8.md` | `01-architecture-decision-proposal-R9.md` | current version labels/§E heading, D/E/F/G/H/J FI-004 updates, new §I R9 full review request; preserve unrelated sections/invariants |
| `02-fresh-independent-architecture-review-request-R8.md` | `02-fresh-independent-architecture-review-request-R9.md` | new R9 adversarial contract with FI-004/005 and inherited regressions |
| `03-r7-finding-closure-and-diff-map.md` | `05-r7-finding-closure-R8-historical.md` | **byte-identical** historical provenance; not operative |
| n/a | `03-r8-finding-closure-and-diff-map-R9.md` | this new R8→R9 author trace |
| `04-authorization-fingerprint-transition-matrix-R8.md` | `04-authorization-fingerprint-transition-matrix-R9.md` | current version metadata, §§3/3.1/5 rows34,35/6/7 FI-004, unchanged §2 atomic transaction protocol |

**Do not promote author claim to closure**: R9 fresh independent reviewer must rederive the findings, verify full diff, re-attest hashes/CRC/manifest/Git pins, and report separate technical/formal identity decisions. Human R'/D'/P'/ADR/HSA decisions remain distinct and **not taken**.
