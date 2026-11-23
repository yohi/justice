# Justice v6 S5 Owner Completion Decision

This document is a decision record for the Human Owner. It is not a runtime
approval object, a Gate state, or a product status field. The AI never fills
an approved value: both Decision fields in section 4 are `PENDING` until the
Human Owner enters a decision.

Current state: **`BOUNDED_COMPLETE` is not adopted.** AC-H01 to AC-H03 are all
`NOT_RUN`, no real-Host acceptance has been run, but the **D-S5-08 design Addendum is Owner-adopted as design policy only**; Source implementation and Host GO remain on HOLD. `RELEASE_APPROVED` is a separate opt-in permission and is not
established either. Even a future `BOUNDED_COMPLETE` would not introduce
anything: without `RELEASE_APPROVED`, nothing is introduced.

## 1. Acceptance summary

Source: `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`.

| Criterion | Outcome | Evidence ref | Owner approval ref |
| --- | --- | --- | --- |
| AC-H01 S1/S2 normal integration | `NOT_RUN` | None | None |
| AC-H02 Authority / Evidence anomaly | `NOT_RUN` | None | None |
| AC-H03 S3-b Decision / Lifecycle Consistency Recovery | `NOT_RUN` | None | None |

`FAIL`, `NOT_RUN` and `NOT_VERIFIED` are never converted to `PASS`.
`BOUNDED_COMPLETE` must not be recorded as adopted unless all of the following
hold.

| Condition | Status |
| --- | --- |
| AC-H01, AC-H02 and AC-H03 each have a real-Host `PASS` | Not met (all `NOT_RUN`) |
| Target Host / Version / Scope / Operation are independently fixed | Not met; observed Host/2.3.2 are candidates, binary digest/Scope/Operation/Host GO remain NOT_FIXED |
| Evidence and diagnostic results are attributed to the target | Not met (no evidence) |
| Known limitations and unverified items are stated | Stated in section 2 |
| Opt-in, stop and rollback procedures exist without bypassing required protections | Runbook documents safety boundaries; exact Host-specific operation/rollback are NOT_FIXED and NOT_RUN |
| Human Owner explicit decision on bounded completion | Not entered (section 4) |

Because several conditions are unmet, bounded completion is not adopted.

## 2. Residual risks and known limitations

These are disclosed so they are not lost. They bound what any future `PASS`
proves.

| Residual risk | Classification | Blast radius / handling |
| --- | --- | --- |
| S2-c comparison is `COMPARISON_NOT_ESTABLISHED`; incremental value over Native-only is unproven | Unproven; not a stop target | No claim of detection benefit is made |
| S3-a M-2 (Review Terminal metadata hardening) is out of scope | Known limitation; not a stop target | Not covered by S5 |
| Legacy Staging: recovery is limited when Staging history is absent from existing Legacy data | Known limitation | Recovery is limited for such data |
| External Writer / File durability is unproven | Unproven | No durability guarantee is claimed |
| S3-b runtime safety on a real Host is `RUNTIME_NOT_VERIFIED`; full Semantic Recovery and external tool side-effect rollback are outside the guarantee | Unverified | Bounded to the adopted single-process scope |
| Multi-process Recovery is unproven; S3-c Host Enforcement is not implemented; S4 is not adopted | Out of scope | No multi-process use |
| Source completeness and authenticity cannot be proven by AC-H01; AC-H02 internal rejection does not prove rejection before Host execution | Inherent limit | Evidence is interpreted within these limits |
| Compatibility with Versions other than the fixed one is unverified | Unverified | Use only the fixed Version |

Only operations that are safety-critical and cannot be limited are treated as
stop targets, following the stop table in
`docs/superpowers/operations/justice-v6-s5-minimal-operation-runbook.md`.
Other items are disclosed limitations, not blockers by themselves.

Related tracking: Issues #355, #356, #358 and #388.

**Separate design decision (2026-11-23):** Owner adopted D-S5-08/Approach A Addendum and authorized this one-time **document-only** alignment. This is **not** either Owner Completion/Release decision. All three ACs remain `NOT_RUN`. Current S2-b rejects truthful 2.3.2 Source pending separate implementation/test authorization; existing-host isolation is logical-only and inherited Credentials/Network effects remain unverified. `oc225-msg-` / `issuerId="opencode-v225-record"` do not attest Host Version.

## 3. Target

| Item | Value |
| --- | --- |
| Host | Candidate existing Ubuntu `coreultra7-270k` (Owner-observed; AC target NOT_FIXED) |
| Version | Candidate OpenCode V2.3.2 (Owner-observed); binary SHA NOT_MEASURED, compatibility NOT_VERIFIED |
| Scope | 未固定 |

These values must be fixed from real-Host evidence before any Owner entry.

## 4. Owner Decision (independent fields)

The two fields are independent. A value in one does not imply the other.
Allowed values: `APPROVED`, `NOT_APPROVED`, `PENDING`.

| Decision | Value |
| --- | --- |
| Bounded completion | `PENDING` |
| Opt-in release | `PENDING` |

### Owner entry area (Human Owner only)

The AI must not fill this area. Leave blank until the Human Owner decides.

| Field | Value |
| --- | --- |
| Owner name | |
| Decision date | |
| Bounded completion decision reference | |
| Opt-in release decision reference | |
| Notes | |

## 5. Completion rules

- Only the record matching the Human Owner's decision is updated afterwards.
- If bounded completion is complete but opt-in release is not approved,
  nothing is introduced.
- No PR, merge, deploy, review or next task is started automatically.
- `RELEASE_APPROVED` is never inferred or set automatically.
- Work may stop with both fields `PENDING`.
