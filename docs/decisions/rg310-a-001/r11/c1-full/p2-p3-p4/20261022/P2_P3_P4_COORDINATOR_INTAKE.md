# Justice RG-310-A-001 — P2/P3/P4 Independent Conditional Design Result Intake

**Date:** 2026-10-22 JST. **Role:** Coordinator's unsigned technical evidence intake, **NOT** a fresh independent Gate review, human approval, normative R'/D'/P' adoption, or an execution grant.

## Received original result ZIPs

| Stream | Original source ZIP SHA-256 | Independent local integrity | Technical state |
|---|---|---|---|
| P2 Reference Monitor | `f64def3bf0118d04acde37ff6cc6b770f23939dda95fc63f438a8c955a9bc887` | CRC PASS; SHA256SUMS 6/6, MANIFEST 6/6 | `FULL_COMPLETE_MEDIATION=NOT_ESTABLISHED` |
| P3 COMMIT/Revocation/Signer/Recovery | `a1da8844767dfa75179f727b88fd28b5056f1ec4a187a1ce5039b3eecfafa089` | CRC PASS; SHA256SUMS 6/6, MANIFEST 6/6 | `REVISION_REQUIRED` |
| P4 Immutable Build/Publish/Host | `f603d448860f8233457fd0a164dd1b23c9a9d09af1bdd90cc97e3d0938e7d85d` | CRC PASS; SHA256SUMS 6/6, MANIFEST 6/6 | `REVISION_REQUIRED` |

**Archival limitation:** The original binary ZIP bytes are **not included in this GitHub intake commit**, and this record must not be represented as binary archive custody. All three source ZIPs were bundled byte-for-byte into a separately created P5 independent integration handoff, outer SHA-256 `b7f7fd3b06164740d80c8dcf6b2731b8b2ab1b788c8b8a62e758f56f7c5c91df`. Original author results are only accepted as conditional technical research; locally matching their original ZIP bytes does not establish runtime validity.

## Distinct source-reported data

- **P2:** 128 Actor/Effect graph rows, 56 unexecuted negative examples, 77 Finding/interface dependencies. Protected Git refs, CI, privileged actors, native/child/FD paths and actual Supported Host effects are not proven completely mediated. A tool described as read-only may write a projection cache.
- **P3:** 33 paper COMMIT/revocation adversarial cases, 31 crash/ACK/signer cases, 35 unresolved interface assumptions. A DB-local transaction cannot atomically order autonomous issuer cancellation, detached signer, GitHub publish, or physical host effects. Strict real COMMIT-time attestation is not established. Fenced-effective cancellation and two-stage visibility are **proposed material normative changes**, not unchanged R11 implementation.
- **P4:** 46 source-defined publisher/effect/credential rows, 40 unexecuted external-publication cases. `.github/workflows/release.yml` at `c428041d` has release-please tag/release effects before later build/package gates, and independent `npm pack --dry-run` / `npm publish` / `npm pack` + asset upload. Actual registry/release bytes and Host JS/native loaded bytes are NOT_VERIFIED.

## Cross-stream collisions and research next step

1. **P2↔P4:** Define mandatory pre-effect enforcement over all legitimate producer-controlled writers/consumers, including the earliest GitHub tag/release actions, while distinguishing external third-party physical execution and Justice acceptance.
2. **P3↔P2/P4:** Strict issuer-effective revocation and independently bounded durable COMMIT expiry cannot be silently replaced with fence-effective time. Separate DB-committed candidate, independent sealing, remote-visible effects and host actual-use evidence. Never claim one DB COMMIT atomically publishes all external effects.
3. **P4↔P3↔A1:** Frozen source/lock/toolchain/JS/native/package digest and remote readback must be tied to accepted state, actual supported-host loader and true Senpi/OmO source-origin receipts. DB or package attestation does not cure A1 H0–H3, Case A or unknown-tool.

**P5:** A fresh, separate independent integration reviewer should review all three streams jointly against P1/P1.3, U-07, original R11 38×7 and approved v5. Produce a candidate architecture comparison, adversarial joint trace set, preservation-overlay, and an unsigned Owner decision packet. **No interface/schema freeze or final C1-FULL architecture approval from these three reports.**

## Fail-closed authority ledger

- Approved v5 Requirements/Design/Plan HEAD `8a2e4f1536e9cad499ee7e9d996ff163df132fd4` **unchanged**.
- Task1 Evidence HEAD `c428041dfb5779b6b6dc8db7bf14928225a00373` **unchanged**; canonical **31/32 PROVEN**, Case A BLOCKED, Case B PROVEN, unknown-tool BLOCKED; A1 host H0–H3 NOT_PROVEN.
- Original R11 UNAPPROVED; R'/D'/P' NOT_ADOPTED; C1-FULL Owner preference is not formal DS-02 decision. DS-01..06 PENDING.
- Inherited 22 Findings OPEN; original NC-01..37 NOT_EXECUTED; all new P2/P3/P4 cases are paper scenarios. P1 source/effect closure incomplete.
- P2/P3/P4 `INTERFACE_AND_SCHEMA_FREEZE_STOP`; B0/B1/B2/HOST NO HOST RUN, Tasks 2–14 NOT_AUTHORIZED. No HSA, human signature, or phase/grant authorization.

Original files and source code are untrusted static review data; this GitHub commit preserves a coordinator record, not new normative truth.
