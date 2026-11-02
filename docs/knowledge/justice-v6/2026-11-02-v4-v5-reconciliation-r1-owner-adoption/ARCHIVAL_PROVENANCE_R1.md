# Justice v6 Knowledge Reconciliation R1 — Archival Provenance

## Record identity

- Repository: `yohi/justice`
- Task: `JUSTICE_V6_V4_V5_KNOWLEDGE_RECONCILIATION_R1_OWNER_ADOPTED_GITHUB_ARCHIVAL_R1` (recovered-input archival execution: R2; the prior R1 STOP remains historical)
- Human Owner Decision ID: `JV6-KR-R1-OWNER-LIMITED-DOCUMENTARY-ADOPTION-20261102`
- Decision: `OWNER_ADOPTED_AS_LIMITED_DOCUMENTARY_KNOWLEDGE`
- Destination branch: `docs/justice-v6-v4-v5-knowledge-r1-adopted-20261102`
- Fixed base commit: `abf95e45dc5b90728a29506234902ce585986f9a`

## Fixed adopted input identity

The adopted AFTER archive is preserved byte-for-byte at `FIXED_ARCHIVE/justice-v6-r2-findings-corrected.zip`: 48,711 bytes; SHA-256 `8c69dae5f8a0558d3e297f0d9831318b16dceb564a8cc9aecb7c6c6df892b96d`. It contains seven members, passes ZIP CRC and safe-path checks, and has no duplicate member names. The BEFORE comparison archive is not part of this archival payload; its identity, as stated by the Owner Decision Record, is `JUSTICE_V6_V4_V5_KNOWLEDGE_RECONCILIATION_R1_MANIFEST_CORRECTED.zip`, 47,950 bytes, SHA-256 `9410c040b55661466bfea008a67f20a80f410a70265619bf1648038eb6f10268`.

| Item | SHA-256 |
|---|---|
| D1 `JUSTICE_V6_V4_V5_KNOWLEDGE_RECONCILIATION_R1.md` | `87d951506a47d8ab9f21307d69790956741952e3571da8a7ef3850ad1852bf29` |
| D2 `JUSTICE_V6_V4_V5_KNOWLEDGE_CROSSWALK_R1.md` | `85e97bfdf36fb9decd89eca92bf8ab1e7ab1f9a5cc265783bca04e2fed10a763` |
| D3 `JUSTICE_V6_V4_V5_EVIDENCE_LEDGER_R1.md` | `c17f31e4c9bdeeff80bdcc5dd372f2dfc84b9a3b357e65f13bd17f5e0502ac0b` |
| D4 `JUSTICE_V6_OPEN_QUESTIONS_AND_PROOF_OBLIGATIONS_R1.md` | `f624bc14a621f23f08a9c1b3db983ec70ae4ec5803e464edf9dd2e05c038419d` |
| D5 `JUSTICE_V6_V4_V5_KNOWLEDGE_RECONCILIATION_R1_REVIEW_HANDOFF.md` | `c20219bc033c574b14593438d3879beb12e790d7772f23e0f9a841ff27d7fc64` |
| D6 `knowledge-reconciliation-index.json` | `d5d9e058fc0b897fb31bf3114c3f82511b6b9969fb738d6e48fe023a2aed695a` |
| Manifest `SHA256SUMS` (six entries; no self-reference) | `0f9a1ac2dedb231946c6735ebabb6da2ee87275587e9de53df4a90d863225d51` |
| Owner Decision Record `JUSTICE_V6_V4_V5_KNOWLEDGE_RECONCILIATION_R1_OWNER_LIMITED_ADOPTION_DECISION_20261102.md` (8,435 bytes) | `467623ee826f012debef9b27e80da2a7afe9c6e138a0d9ecc7d87519dcf60494` |

D1–D6 and the Manifest are stored as extracted original bytes. The Owner Decision Record is stored as its original bytes. Its contemporaneous `GITHUB_ARCHIVAL_PENDING` and `NO_GITHUB_WRITE` statements are intentionally unchanged; this archival fact is recorded here, not by editing that decision.

## Historical review provenance

- R1: `INPUT_BLOCKED / STOP` — historical verdict for the manifest self-reference inconsistency; preserved and not retroactively changed by this archival operation.
- R2: `CORRECTION_REQUIRED` — findings `JV6-STATIC-R2-F-001` and `JV6-STATIC-R2-F-002`. The R2 report original byte identity remains unverified.
- R3: `PASS_WITH_LIMITATIONS` — the independent report was supplied as chat text by the Human Owner; no original report file identity or SHA-256 is asserted. R3 supports D1/D2/D3/D5 byte invariance, the limited D4 CE-11 correction, the limited D6 source-ID correction, and Manifest consistency.
- F-001: `CORRECTION_VERIFIED`.
- F-002: `CORRECTION_VERIFIED_WITH_PROVENANCE_LIMITATIONS`.

Continuing limitations: R2 and R3 report original byte identities are unverified; D6 external JSON Schema conformity is `NOT_VALIDATED`; v4 Owner Decision candidate byte verification and minute-exact historic decision times are not established; no runtime, host, test, build, CI, or E2E execution is newly certified by these records. The prior archival attempt stopped before any write due to the missing fixed ZIP; that result remains a separate historical event.

## Scope and authority boundary

This archive preserves only the limited documentary knowledge adoption of D1–D6 and the verification Manifest. It does not individually adopt the 32 knowledge candidates as normative requirements, execute the 32 proof obligations, adopt v6 Requirements, select Runtime Option A/B/C, or establish new runtime/host/test/build/CI/E2E evidence.

The following states remain unchanged: v4 STOP `ACTIVE`; v4 unresolved findings continue; v5 Task 1 `BLOCKED`; v5 Tasks 2–14 `NOT_AUTHORIZED`; v5 E2E closure `56/56 NOT_ESTABLISHED`; v6 knowledge candidates (32) `NOT_OWNER_ADOPTED`; proof obligations (32) `NOT_EXECUTED`; v6 Requirements `NOT_ADOPTED`; Runtime Option A/B/C `UNSELECTED`; Gate/HOLD `UNCHANGED`; Implementation Authorization `NONE`.

GitHub archival is a documentary record only. It is not a formal Gate, does not release HOLD, does not alter the Owner adoption decision, and does not authorize implementation. No commit identity is embedded here because it was not knowable before the archival commit was created.
