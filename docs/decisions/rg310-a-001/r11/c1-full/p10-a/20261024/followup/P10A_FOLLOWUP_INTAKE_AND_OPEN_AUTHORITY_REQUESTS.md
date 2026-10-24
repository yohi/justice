# RG-310-A-001 — P10-A follow-up bounded intake (UNSIGNED)

Review and archive date: 2026-10-24 JST. This file is a separate post-investigation **coordinator intake**; it does **not** revise or impersonate the independent investigation's original files.

## Byte provenance
Follow-up output ZIP SHA-256 `194d601b9565f11a55817aa9897912b81375aea01b061cb412001fbecb8b9b55`, size 31,479 bytes, 8 ZIP entries, CRC PASS; 6/6 SHA256SUMS + 6/6 MANIFEST MATCH. Its original output files were read as untrusted static data. Independently available input Handoff matched SHA-256 `bf9464a9e55d20ecc73b1f6eb5e35b11dea12a54e01bf9ac86b07de20b4e4881`, size 51,354 bytes; its two inner original ZIPs matched P10-A `41d83cf7b8223a47721191372922e76d50e6c374b3804713de26f3863e6870ee` and P9 `f0efb114aaf04a3ced9da45a6b40ca698b2fe6e275afbed61e46a198e02073b0`. The historic parent ZIP `735d9f0ce2b97d2b1543fb6a7a5d9a839b2ada30cb5a41e732f1115725d30160` remains NOT_VERIFIED.

## Evidence inventory and bounded findings
- `01_EVIDENCE_ACQUISITION_AND_API_SCOPE_LOG.csv`: **89 rows** = 24 pre-existing, prior-reported rows + **65** new GET-only attempts. Among new rows **41** GET_SUCCESS with connector-body SHA-256; **8** GET_SUCCESS_NOT_HASHED; **13** CONNECTOR_400; **1** PROVIDER_403; **2** PROVIDER_404. Connector body hashes are **not** wire payload signature nor provider effective permission proof.
- `02_EFFECTIVE_WRITER_RIGHTS_BY_PROVIDER.csv`: **32 retained writer/effect candidates**. None are positive complete-mediation proofs. Rows include provisional, nonwriter and historical classes, NOT a complete distinct real-principal census.
- `05_NEGATIVE_CASES_AND_AUTHORITATIVE_STOP_MATRIX.csv`: **54 rows** = 8 P10-A independent research findings, 16 unexecuted bounded negative oracles, 22 P9 documentary candidates, 7 Owner evidence requests (O-01..07), and **one** summary row referring to original 22 Gate findings. Do not equate 54 rows with original Justice Gate findings or verified dynamic tests.
- Fixed Task1 evidence source HEAD: `c428041dfb5779b6b6dc8db7bf14928225a00373`. `.github/workflows/release.yml` blob `4f984a012f3fa9421a32531a00394f4d654d5284` demonstrates `release-please-action` BEFORE the later build/pack/publish sequence. Only the claim that a later pack check can pre-deny *all prior* effects is DISPROVEN.
- P10-A and follow-up observed `master protected:false`, repo ruleset #14286365 `enforcement:disabled`; details via branch protection GET encountered provider 403, whereas other sensitive endpoint requests failed connector-side 400. These observations do not show all possible effective writers, alternate protections, app/PAT/package ACLs or provider veto mechanisms.
- Published historic Actions artifacts and historical v4 release assets are bounded provider metadata; do not infer v5 first-effect prior-veto or HOST attestation.
- Owner-signed protected scope O-01 NOT_VERIFIED, O-02 PARTIAL, O-03 NOT_VERIFIED, O-04 PARTIAL_SOURCE_ONLY, O-05 NOT_VERIFIED, O-06 PARTIAL_HISTORIC_ONLY, O-07 NOT_PROVEN. No Owner sign-off or specific protected effect denominator obtained.

## Normative / authorization STOP
C1-FULL remains research direction. A=NO_GO_FOR_OBSERVED_SPLIT_DOMAINS (not universal impossibility); B=NOT_SELECTED; `COMPLETE_MEDIATION_NOT_PROVEN`. R11 UNAPPROVED; R′/D′/P′ NOT_ADOPTED; DS-01..06 FORMAL_PENDING; Task1 BLOCKED (31/32, Case A and unknown-tool BLOCKED); H0..H3 NOT_PROVEN; original 22 Gate Findings OPEN, NC37 NOT_EXECUTED; P2/P3/P4 INTERFACE_FREEZE_STOP; Tasks2..14 NOT_AUTHORIZED.

Future non-secret read-only acquisition needs **Owner authoritative effect scope**, complete provider-effective GitHub/Packages/CI writer and bypass inventory, *causally prior* provider veto evidence, issuer/old-primary fencing, external ACK and actual HOST-loaded bytes. Privileged or sensitive evidence that cannot be read without elevated rights stays NOT_VERIFIED; it must not be inferred from endpoint denials.

This PR documentation/archive update is distinct from the read-only independent investigation and must not be construed as release/build/CI side-effect authorization.