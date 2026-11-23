# Justice v6 S5 Host Acceptance Record

This document is an evidence ledger skeleton for the Human Owner. It is not a
runtime approval object, a Gate state, or a product status field. It does not
choose an acceptance decision on the Owner's behalf.

Current state: **no real-Host acceptance has been run.** Real-Host work
(AC-H01 to AC-H03) is not authorized; the D-S5-08 Addendum is adopted as **design only**. Every
value that has not been measured is recorded as `未固定` (not fixed), and every
acceptance criterion is `NOT_RUN`. This record is a document-consistency
artifact, not real-Host acceptance evidence.

## 1. Target identity

| Item | Value |
| --- | --- |
| Host | Existing Ubuntu `coreultra7-270k` candidate (Owner-observed; AC identity NOT_VERIFIED) |
| Version | OpenCode V2.3.2 candidate (Owner-observed); binary digest NOT_MEASURED; S2-b exact 2.2.5/2.3.2 Source code COMMITTED at `204567a`, tests NOT_RUN |
| Justice Commit | Design baseline `d644734090aa4ad8cadbefd2d78908067fe36931`; AC execution commit not fixed |
| Scope | 未固定 (candidate scope: adopted bounded ranges of S1, S2 and S3 per D-S5-01) |
| Operation | 未固定 |
| Source provenance | 未固定 |
| Authority | 未固定 (no Owner approval reference is recorded) |
| Secrets & Network limits | 未固定 (no secret, token or absolute host path may be stored in this record) |
| Cleanup | 未固定 |

Referenced decisions: D-S5-01 (S1, S2, S3 bounded completion target), D-S5-02
(minimal real-Host acceptance is required), D-S5-03 (explicit Owner opt-in),
D-S5-04 (fail-closed with limited blast radius), historical D-S5-05 (isolated Host) superseded by **D-S5-08 existing Host/logical separation**,
D-S5-06 (required PASS plus explicit known limitations), D-S5-07 (minimal
three-artifact approach). Source:
`docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md`.

## 2. Result type

Each acceptance criterion carries the following fields.

| Field | Allowed values / meaning |
| --- | --- |
| Outcome | `PASS`, `FAIL`, `NOT_RUN`, `NOT_VERIFIED` |
| Observation | What was actually observed; empty while `NOT_RUN` |
| Evidence ref | Repo-relative or opaque reference to stored evidence; none while `NOT_RUN` |
| Digest | Content digest of the referenced evidence; none while `NOT_RUN` |
| Source confidence | Provenance of the evidence (`observed`, `derived`, `declared`); `declared` never supports PASS |
| Limitations | Known limits that bound what the outcome proves |
| Owner approval ref | Reference to the Owner's explicit approval; none while unapproved |

Rules:

- `FAIL` and `NOT_VERIFIED` are never converted to `PASS` automatically.
- `NOT_RUN`, unproven, or failed-to-observe states are never read as `PASS`.
- Self-declared (`declared`) evidence never satisfies a PASS.
- A PASS, when recorded, proves only the bounded scope in its Limitations.

## 3. Acceptance criteria

### AC-H01 S1/S2 normal integration

Requirement: a limited real Session Source, taken on a separately approved
existing Host's dedicated OpenCode V2.3.2 Session, is validated as a stored Source wrapper with explicit
Correlation, then converted by the existing S2-b Offline READ_ONLY Adapter into
the S1 contract and diagnosed. Acquisition, validation and conversion are kept
distinct.

| Field | Value |
| --- | --- |
| Outcome | `NOT_RUN` |
| Observation | None (not run) |
| Evidence ref | None |
| Digest | None |
| Source confidence | 未固定 |
| Limitations | A PASS would not prove full-history completeness or authenticity of the collected Source. See section 4. |
| Owner approval ref | None |
| Missing | Owner-approved existing Host dedicated Session, real binary SHA, 2.3.2 compatibility **test execution/verification** (Source code COMMITTED, not PASS), Source capture/wrapper, independently verified Correlation, Adapter and S1-d diagnosis |

### AC-H02 Authority / Evidence anomaly

Requirement: inconsistent, missing, or authority-mismatched input is not
wrongly accepted, and the guaranteed operations are restricted appropriately.

| Field | Value |
| --- | --- |
| Outcome | `NOT_RUN` |
| Observation | None (not run) |
| Evidence ref | None |
| Digest | None |
| Source confidence | 未固定 |
| Limitations | Justice-internal rejection does not prove rejection before Host execution. See section 4. |
| Owner approval ref | None |
| Missing | Owner GO for existing Host dedicated input copies, Authority/Evidence negative cases, observation points, expected results and non-interference proof |

### AC-H03 S3-b Decision / Lifecycle Consistency Recovery

Requirement: within the adopted single-process bounded scope, the consistency
of Decision and corresponding Lifecycle before and after restart is confirmed
on a real Host, and no inconsistent Task / Plan progression is allowed.

| Field | Value |
| --- | --- |
| Outcome | `NOT_RUN` |
| Observation | None (not run) |
| Evidence ref | None |
| Digest | None |
| Source confidence | 未固定 |
| Limitations | `RUNTIME_NOT_VERIFIED`. A PASS would not prove full Semantic Recovery, rollback of external tool side effects, or multi-process safety. See section 4. |
| Owner approval ref | None |
| Missing | Owner GO for dedicated Durable State and single Writer, reversible failure injection, bounded restart, independent Decision/Lifecycle readback |

**D-S5-08/Approach A gate:** Exact real-Host 2.3.2 Source remains required. S2-b now contains the exact 2.2.5/2.3.2 Allowlist and related test code at `204567a`, but Vitest/typecheck/lint are NOT_RUN, positive 2.3.2 multi-page test NOT_ADDED, and actual Host GO is separately unauthorized. Code presence is not a 2.3.2 runtime PASS. `isMessage()` does not validate optional `firstToken`. Complete foreign-only bindings can be `PROJECTED` / zero Evidence while **not** proving the selected AC. The `oc225-msg-` origin and `issuerId="opencode-v225-record"` are historical projection identifiers, not Host-version proofs. OS-level separation, network deny, credential noninheritance, dedicated durable Writer/restart injection and cleanup are NOT_VERIFIED; all AC remain `NOT_RUN`.

## 4. Known limitations (inherited)

These are recorded so that they are not lost. They do not by themselves block
a bounded completion, provided their blast radius is stated, but a required AC
that is not established still prevents any limited completion PASS.

| Limitation | Source |
| --- | --- |
| S2-c comparison effectiveness is `COMPARISON_NOT_ESTABLISHED` (the S2-c report states `NOT_ESTABLISHED`; no TP/FP/FN/TN were measured and incremental value over Native-only is unproven) | `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md`; `docs/reports/2026-11-14-justice-v6-s2c-limited-comparison.md` |
| S3-a M-2 (Review Terminal metadata hardening) is out of scope and remains a known limitation | `docs/superpowers/specs/2026-11-13-justice-v6-s3b-decision-lifecycle-consistency-requirements.md`; `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` |
| Legacy Staging: recovery is limited when Staging history is absent from existing Legacy data | `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` |
| External Writer / File durability is unproven | `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` |
| S3-b runtime safety on a real Host is unverified (`RUNTIME_NOT_VERIFIED`); full Semantic Recovery, arbitrary Task / Revision / Finding restoration, and external tool side-effect rollback are outside the adopted guarantee | `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` |
| Multi-process Recovery is unproven; S3-c Host Enforcement is not implemented; S4 is not adopted | `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` |
| Compatibility with Versions other than the fixed one is unverified | `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` |
| AC-H02 internal rejection does not prove pre-Host-execution rejection; AC-H01 PASS does not prove full-history completeness or authenticity of the Source | `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md` |

Related tracking: Issues #355 (S2 parent), #356 (S3), #358 (S5), and #388
(Justice v6 overall).

## 5. Completion terms (not established)

`BOUNDED_COMPLETE` and `RELEASE_APPROVED` are **not established** by this
record. This record contains no PASS outcome and no Owner approval, so neither
term can be asserted. Any future use requires fixed-Host PASS for AC-H01 to
AC-H03, explicit known-limitation disclosure, and the Human Owner's explicit
decision.

## 6. Document consistency check

The following command confirms that the required terms exist in this file. It
checks document consistency only and is not real-Host acceptance.

```bash
rg -n 'AC-H0[123]|NOT_RUN|COMPARISON_NOT_ESTABLISHED|M-2|BOUNDED_COMPLETE|RELEASE_APPROVED' docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md
```
