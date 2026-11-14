# RG-310-A-001 C1-FULL — P5 Independent Integration Intake / P6 Readiness

Date: 2026-10-22 JST
Status: **RESEARCH_INTAKE_ONLY / UNAPPROVED / NO_EXECUTION_GRANT**

## Source and integrity

P5 independent result ZIP (original attachment; **NOT embedded as a GitHub binary in this commit**): SHA-256 `18db3dbe6ff187539ce9941cafd03806f7dfaa4732d077d70c61d4de7b6eb738`. ZIP CRC passed; its seven output file hashes and sizes match `SHA256SUMS` and `MANIFEST.json` 7/7. The full P5 input handoff ZIP SHA-256 is `b7f7fd3b06164740d80c8dcf6b2731b8b2ab1b788c8b8a62e758f56f7c5c91df` (CRC pass; nine nested original ZIP SHA/CRC checked). Historical parent `735d9f0ce2b97d2b1543fb6a7a5d9a839b2ada30cb5a41e732f1115725d30160` is **NOT_VERIFIED**.

Static P5 technical verdict: `C1_FULL_CROSS_STREAM_DESIGN_REVISION_REQUIRED`. P2/P3/P4 `INTERFACE_FREEZE_STOP`.

## Ledger accounting; not a proof promotion

- P5 typed graph `174 = 108 P1.3 source/effect +20 P2 Actor/TCB-only +46 P4 build/publish/Host effect`; these are **heterogeneous typed records**, not 174 unique source consumers.
- P5 design trace `32` paper-only cases. Original R11 matrix `38×7` has a new overlay, no approved replacement.
- Finding+negative registry `251 = 22 inherited OPEN findings +37 inherited NOT_EXECUTED NC +160 P2/P3/P4 paper-only +32 P5 paper-only`; not 251 executed tests.
- P1.3 has 207 tracked bodies without semantic full-text verification at that step; external effective credential/Host/runtime origins remain unverified.

## P5-F01..F08 cross-stream blocking analysis

1. `P5-F01`: release-please tag/release authoring precedes later checkout/build/npm gate; any gate only just before npm publish is too late for first protected SCM effect.
2. `P5-F02`: coverage, SARIF, scan/PR and preview uploads must be explicitly classified; do not assume all are certified acceptance.
3. `P5-F03`: direct FS/FD/native/child/OS and direct external writer bypass means complete pre-effect mediation **NOT_ESTABLISHED**.
4. `P5-F04`: async issuer-effective revocation vs real durable COMMIT time is unresolved; preflight SQL time is not an independently authenticated COMMIT wall-clock witness.
5. `P5-F05`: DB COMMIT and detached signer/ACK, registry/GitHub effects do not form single atomic ACCEPT+PUBLISH.
6. `P5-F06`: externally retained high-water, restore replay prevention, old-primary physical fencing and terminal history unresolved.
7. `P5-F07`: source→native/JS→one frozen tarball→registry/release readback→actual Host loaded bytes **NOT_VERIFIED**.
8. `P5-F08`: U-07 universal retroactive offline-copy stopping was a later assumption, not an approved v5 obligation; U-07 remains a valid conditional falsifier without reducing C1-FULL to C2.

## A/B proposals — preserve distinction

A: literal strict issuer-effective revocation, exact durable COMMIT expiry and one atomic ACCEPT+PUBLISH is **not supported by current independently separated Git/registry/signer/Host domains**. This is a scoped incompatibility finding, not a theorem against all potential architectures.

B: `DB_COMMITTED_UNSEALED → EXTERNALLY_SEALED_VISIBLE → separately admitted external effect` is a **conditional design candidate** with changed temporal/visibility semantics and `IN_DOUBT/REMOTE_UNKNOWN` reconciliation; not adopted and not R11-equivalent. Any decision about Rv-S/Rv-F and staged visibility would require separately reviewed R' → D' → P', plus human approvals.

## Next review — P6

A new independent P6 reviewer (not P1..P5/U-07 author or coordinator) should falsify F01..F08, verify all ledger sets and R11 38×7 original cells, challenge the actual current Git/CI/writer/Host authorities and grant/time models, and issue scoped A/B technical verdicts. Distinguish P5-proposed DS-01/03/04/05/06 **agenda wording** from earlier actual Owner decisions; `DS-02` formal scope remains pending. No provider runtime tests requested at this design-only stage.

The coordinator-created P6 handoff ZIP (not tracked here) has SHA-256 `f4b9767f60af3e5a8d2c697fbc53eaa597e636dff9e868c03b24fb97f4b37dd4` and embeds original P5 result plus P5 nine-source handoff.

## Unchanged authority boundary

Approved R/D/P `8a2e4f1536e9cad499ee7e9d996ff163df132fd4` UNCHANGED. Task1 evidence HEAD `c428041dfb5779b6b6dc8db7bf14928225a00373`, 31/32 PROVEN, Case A BLOCKED, Case B PROVEN, unknown-tool BLOCKED. A1 H0-H3 NOT_PROVEN. R11 UNAPPROVED. Inherited 22 Findings OPEN, NC37 NOT_EXECUTED. DS-01..06 PENDING, DS-02 FORMAL_PENDING; P2/P3/P4 interface/schema FREEZE STOP; B0/B1/B2/HOST NOT_AUTHORIZED; Tasks2-14 NOT_AUTHORIZED. No Git/CI/DB/Host runtime test, signer, HSA, Owner decision, or phase execution is created by archival.

**Original P5 ZIP archive note:** This GitHub commit contains **only** this coordinator intake memo. The unmodified P5 original ZIP remains provided in the P6 handoff artifact; storing its binary in PR #325 is a separate archival action not completed by this commit.
