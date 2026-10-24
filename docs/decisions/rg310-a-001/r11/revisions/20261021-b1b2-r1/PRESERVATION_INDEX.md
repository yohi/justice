# RG-310-A-001 — B1/B2 Remediation R1 archival index

**PROPOSAL ONLY — `ARCHITECTURAL_REDESIGN_REQUIRED`, C1 `NOT_ADOPTED`.** Archived 2026-10-21. This is evidence preservation, not the formal Requirements/Design/Plan adoption, owner signature, approval, gate closure, or HOST/CI/DB implementation permission.

## Exact source identity

- Submitted original Remediation R1 ZIP: **SHA-256 `2a42e39450eb76f15f6a4df84af4ff68b56c538987544265e8881a6d0302dec7`**.
- [Byte-identical original ZIP](archives/Justice_RG310_B1B2_Reference_Architecture_Remediation_R1_20261021.zip) — Git blob SHA-1 `d249da86d78c427f96255cfd2c0147893d35eafa`; original ZIP CRC PASS.
- Extracted **byte-identical originals** under `sources/` (seven numbered deliverables plus README, SHA256SUMS, MANIFEST.json). All eight payload hashes match both packaged SHA256SUMS and the internal MANIFEST.json (8/8). Git blob identities independently checked before committing.
- Earlier remediation handoff ZIP SHA-256 `16b1e4eb370aed9e282d2f9891c22cfd2d2ffae61a7dddc2c964d6a1454d8c81`; B1/B2 independent technical review ZIP SHA-256 `eb2957ef46bfea13122ea7a4422277c6d3b7efa1e4a5a48f9820cd929deeb964`; reviewed handoff ZIP SHA-256 `4a2cd007b7de0dc9c26384a15f2c2148c45f092a4b9aae434cee03d90a08ab74`. These hashes describe **prior source archives**, not this R1 output.
- **Historic parent independent-review ZIP** identified by SHA-256 `735d9f0ce2b97d2b1543fb6a7a5d9a839b2ada30cb5a41e732f1115725d30160` **NOT_VERIFIED / NOT ATTACHED**; current finding register is not treated as authenticated literal history of that missing source.
- Approved normative R/D/P pin `8a2e4f1536e9cad499ee7e9d996ff163df132fd4`; Task1 evidence pin `c428041dfb5779b6b6dc8db7bf14928225a00373`; R11 original matrix SHA-256 `10b24dd4175ee2d5aae7929f8057355ce27e4db129480830549d756802010923`.

## Contents and interpretation

- [01 — Revised reference architecture](sources/01_REVISED_B1B2_REFERENCE_ARCHITECTURE_R1.md): withdraws unqualified single-PostgreSQL-authority applicability to existing direct Git/CI/build/host consumers; defines conditional C1 full-Gateway consumer and immutable-snapshot cutover.
- [02 — Findings](sources/02_FINDING_DISPOSITION.csv): **22/22 OPEN**, including 14 predecessor and 8 new IDs. These are proposal dispositions, not independent closure.
- [03 — Consumer/effect census](sources/03_CONSUMER_EFFECT_TRUST_CENSUS.csv): **28 edges**, with explicitly uncensused pathways; not proof of full enumeration or enforcement.
- [04 — Negative traces](sources/04_COMMIT_REVOKE_TIME_AND_CRASH_TRACES.csv): **NC-01..37**, all **NOT_EXECUTED_DESIGN_ONLY**.
- [05 — R11 compatibility / RDP delta](sources/05_R11_38X7_COMPATIBILITY_AND_RDP_DELTA.md): maintains R11's original 38-state/seven-axis matrix as baseline; all proposed normative changes are unadopted.
- [06 — Unsigned owner choices](sources/06_OWNER_DECISION_OPTIONS_UNSIGNED.md): **DS-01..06 PENDING**; no owner signature inferred.
- [07 — Fresh review handoff](sources/07_FRESH_INDEPENDENT_REVIEW_HANDOFF.md): RV-01..12 independent falsification tasks and STOP boundaries.

### Unresolved design contradictions

1. All real Git checkout, CI, build, release, package and host consumers must either be *actually* fenced to accepted Gateway snapshots or acknowledged as outside the claimed accepted boundary; don't redefine product authority silently.
2. Trusted timestamp evidence is not proof of actual physical COMMIT time; revocation at the issuer and import into the DB are not automatically totally ordered.
3. An independently signed seal/ACK cannot be declared atomic with a separate DB COMMIT, and a published GitHub/package or host effect cannot be rolled back with the DB.
4. Actor isolation, signer/time/revoke/ledger independence, consumer use-time immutability, backup/restore trusted ACK prefix and failover fencing remain design proof obligations.

## Next action / STOP

**Assign R1 to a distinct independent technical architecture reviewer**, not the R1 author or a signer, to falsify C1 against existing source consumers and the R11 38×7 + INV-A01..14 invariants. Preserve separate Option C upstream API/A1 H0 gaps and the canonical Task1 31/32, Case A BLOCKED, unknown-tool BLOCKED. Keep [PR #295](https://github.com/yohi/justice/pull/295) and [PR #325](https://github.com/yohi/justice/pull/325) Draft/OPEN. No B0/B1/B2-DEP/B2-HOST/HOST or Tasks2–14 authorization from this archival artifact.
