# Justice RG-310-A-001 — B1/B2 Fresh Independent Review Intake & Remediation Track

**Intake date:** 2026-10-21 JST.  
**Technical review outcome:** `REVISION_REQUIRED`.  
**Review authority:** independent technical *opinion only*, not formal gate approval or human decision.  
**Status:** `R11 UNAPPROVED` / `R'/D'/P' NOT_ADOPTED` / `NO HOST RUN` / `Task1 BLOCKED` / `Tasks2–14 NOT_AUTHORIZED`.

This file is a **non-normative evidence intake and design-remediation tracker**. It does not amend existing Requirements, Design, Plan, R11 immutable proposal, Task 1 evaluator, implementation code, or phase authorization.

## Evidence identity and availability

- Independently checked uploaded review ZIP `Justice_RG310_B1B2_R11_Fresh_Independent_Review_20261021(1).zip`: SHA-256 `eb2957ef46bfea13122ea7a4422277c6d3b7efa1e4a5a48f9820cd929deeb964`; size 42,606 bytes; ZIP CRC PASS; 5/5 internal SHA256SUMS entries match, MANIFEST file metadata consistent.
- The review handoff outer ZIP expected SHA-256 **was stated in the earlier handoff message** as `4a2cd007b7de0dc9c26384a15f2c2148c45f092a4b9aae434cee03d90a08ab74`; the reviewer independently computed the same value but classified a *separate out-of-band comparison inside that review session* as `NOT_VERIFIED`. Preserve this limited provenance distinction rather than upgrading formal independence.
- Missing prior exact parent archive `Justice_RG310_R11_B1B2_Independent_Static_Result_20261015.zip`, expected SHA-256 `735d9f0ce2b97d2b1543fb6a7a5d9a839b2ada30cb5a41e732f1115725d30160`: `NOT_VERIFIED`. The 14 baseline findings are from the current supplied register; prior independent historical provenance remains unresolved.
- Review ZIP contents: `01_INDEPENDENT_TECHNICAL_REVIEW.md` SHA-256 `aa8c7701778e45231d79dd0b5ed89567ecc92e1eedd2798034ec22416a5d46e2`; `02_FINDING_ADJUDICATION.csv` `d14f4a30cbe6d6979176327e66b2ea6ec40afc6224fa0194fec4c44d5c382d7a`; `03_COUNTEREXAMPLE_REVIEW.csv` `bc9eb36c248c3daea6c903a23f1c08936fff83413cafcfa3b008955642b07b45`; `04_OWNER_DECISION_READINESS_UNSIGNED.md` `ed2c33e2bf4e992023f9d34d72682e47fe6b6733b239e28adecd17bb7b9a9981`; `05_PROVENANCE_AND_LIMITATIONS.md` `d758d6d43184dd4e96713e4309ffd1ca00e7320b1935614f090e4e4e0da3e7cd`.
- **Archive status in this commit:** metadata and remediation intake only. The review ZIP and its five original documents have **not yet been committed as file bytes here**; this file does not claim otherwise.

## Finding interpretation

The new 8 findings are `B1B2-NEW-015..022` (`OPEN_NEW`); original `B1B2-FI-001..014` are still `OPEN_NOT_CLOSED`; previous 28 and new 9 counterexamples are design-stage claims, not passing runtime tests.

| Finding | Theme | Minimum documentary remediation (not runtime evidence) |
|---|---|---|
| NEW-015 (CRITICAL) | Authoritative consumer compatibility | Exact census and classified trust relationship of git checkout, local worktree/JSONL, compiler, CI/build, release/npm publish, package and host consumers. Show a non-bypassable authenticated Gateway path and immutable digest-at-use or narrow the accepted namespace with explicit legitimate-user consequences. |
| NEW-016 (MAJOR) | Revocation source vs DB order | Distinguish independently issued revoke-effective time/ordering from its later DB application. Select explicit total-order/lease/fence semantics and fail closed during uncertain delivery. |
| NEW-017 (MAJOR) | Commit-time attestation | Define a demonstrable bound for commit linearization vs signed grant expiry; `now()`/`clock_timestamp()` or a pre-COMMIT check alone is insufficient. |
| NEW-018 (MAJOR) | Independent proof atomicity | Specify which durable acceptance proof is atomically co-committed with accepted exact bytes/head/seq, and the status of any separate signer ACK/seal. |
| NEW-019 (MAJOR) | Materialization TOCTOU | Attest immutable exact bytes/digest at compiler/host use; raw mutable copies cannot acquire accepted authority by an earlier read check. |
| NEW-020 (MAJOR) | ACK prefix and restore | Define independent acknowledged-prefix high-water, term witness, old-writer fencing and STOP on rollback or ambiguous primary. |
| NEW-021 (MAJOR) | PREPARED and event order | Specify attempt/reservation/abort terminal reconciliation; distinguish accepted sequence from attempt/terminal event sequence and prove no silent gaps. |
| NEW-022 (MAJOR) | TCB root and remote side effects | Enumerate actor descendants/FDs/mounts/native/exec/network/CI/package hooks/Git/DB superuser and all remote effects; specify which are physically denied, Broker-mediated, or explicitly trusted. |

## Sequenced next design actions

1. **Design author, document-only:** revise the *B1/B2 proposal*, not approved R/D/P, beginning with NEW-015 real legitimate consumer compatibility. Decide whether the chosen authoritative namespace can coexist with the actual Justice CI/build/release/host flow. Record concrete negative counterexamples and alternative architecture if not.
2. **Design author, document-only:** resolve NEW-016/017/018/021 as one transactional authorization, proof and event-order design. Separate external independent custodian/trust from the DB atomic commit, and identify the precise time/revocation semantics.
3. **Design author, document-only:** detail NEW-019/020/022 (immutable snapshot use, restore/leader fencing, OS/CI/remote effect boundary). Carry 14 inherited findings and 37 total counterexample records forward without fabricated closure.
4. **Independent architecture reviewer:** falsify the revised exact B1/B2 design and all eight new findings, check the 38×7 R11 state matrix and INV-A01..A14 unchanged, and preserve A1 H0/Task1 independent stops. Prior absent parent evidence stays `NOT_VERIFIED` unless exact source is supplied and checked.
5. **Human Owner:** after review, make a **provisional technical direction choice** as appropriate under DS-01..06; no automatic adoption or execution. Then draft proposed R' → D' → P' change set, run a separate fresh independent *normative* review, and require explicit Owner approval before B0/HSA or any execution.

## Permanent STOP boundaries

- Approved R/D/P `8a2e4f1536e9cad499ee7e9d996ff163df132fd4` remain unchanged until a separately authorized normative change.
- [PR #295](https://github.com/yohi/justice/pull/295): `c428041dfb5779b6b6dc8db7bf14928225a00373`, `OPEN/Draft` as previously verified; canonical `31/32`, Case A `BLOCKED`, Case B `PROVEN`, unknown-tool `BLOCKED`.
- [PR #325](https://github.com/yohi/justice/pull/325): archival, `OPEN/Draft`, no formal architecture adoption.
- A1 H0 true source-binding `NOT_PROVEN`. `TRUSTED_OP_BOUNDARY_PROVEN=NOT_VERIFIED`. `OP_PREPARE_ALLOWED=UNKNOWN/BLOCKED`; no B0/B1/B2/RA/ACTIVATE/HOST authorization. No runtime/cloud/DB/CI/secret work; no Tasks2–14.

**Do not misread a design revision, PostgreSQL feature, self-check, or unverified parent citation as a formal gate or permission.**
