# Justice v6 S5 Owner Completion Decision

This document is a decision record for the Human Owner. It is not a runtime
approval object, a Gate state, or a product status field. The AI never fills
an approved value: both Decision fields in section 4 stay `PENDING` until the
Human Owner enters a decision.

Current state (2026-11-24): the required acceptance criteria AC-H01, AC-H02
and AC-H03 are **`PASS`, formally adopted by the Human Owner**, and the H3
limited V2 plugin runtime check is `PASS`. **`BOUNDED_COMPLETE` is not
adopted** (`PENDING`) and **`RELEASE_APPROVED` is not established**
(`PENDING`). Without `RELEASE_APPROVED`, nothing is introduced. E1/E2/E3
remain `HOLD`. No Source change was made for this record.

## 1. Acceptance summary

Source: `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`.

| Criterion | Outcome | Evidence ref | Owner approval ref |
| --- | --- | --- | --- |
| AC-H01 S1/S2 normal integration | `PASS` (bounded) | T16-H01 (pre-fixed package `f0588d206b174eb9…`, acquisition `bf9fd0c66d4ef6f8…`). History: T09–T12. | Pre-execution `OWNER-S5-H01-PREFIX-20261124`; formal adoption by the Human Owner, 2026-11-24 |
| AC-H02 Authority / Evidence anomaly | `PASS` (bounded) | T13 n1/n2/n3, T16 H02-A/B/C. Supplementary: H3RT C4, T14 Optional-H02. | Human Owner, 2026-11-24 |
| AC-H03 S3-b Decision / Lifecycle Consistency Recovery | `PASS` (bounded, single writer) | T14 H03-R (reused), T15 P/T, T16 H03-N/C | Human Owner, 2026-11-24 |
| H3 limited V2 plugin runtime | `PASS` | H3RT run-1..4 (records `a3b93efd5624b5a3…`, `18b2ceb7fe42be08…`) | Human Owner, 2026-11-24 |

`FAIL`, `NOT_RUN` and `NOT_VERIFIED` are never converted to `PASS`.
Diagnostic labels of the diagnosed target (`ownerAuthorityStatus=NOT_PROVEN`,
`formalVerdict=UNKNOWN`, `coverageCompleteness=NOT_ESTABLISHED`) are retained
by contract and are not AC outcomes.

### Bounded completion conditions (material for the Owner)

| Condition (Plan Task 6) | Status | Basis |
| --- | --- | --- |
| AC-H01, AC-H02 and AC-H03 each have a real-Host `PASS` | **Met** | Acceptance record section 4; Owner adoption 2026-11-24 |
| Target Host / Version / Scope / Operation fixed | **Met** | `coreultra7-270k`; OpenCode V2.3.2 (binary `e6543f6e…`); Justice `896acee2`, V2 Artifact `b2130a6d…`; Scope D-S5-01 bounded S1/S2/S3; Operation Plan Tasks 3–5 |
| Evidence and diagnostic results attributed to the target | **Met** | AC-H01 attribution via the pre-execution Owner-fixed TaskIntent (task/ac R2) and the pre-fixed Correlation rule. Evidence reuse and provenance in acceptance record section 3. |
| Known limitations and unverified items stated | **Met** | Section 2 below; acceptance record section 5; runbook section 8 |
| Opt-in, stop and rollback procedures exist without bypassing required protections | **Met for the demonstrated dedicated environment** | Runbook sections 4–7. The H3RT demonstration covered dedicated config registration, plugin load, process-identity stop by PID-namespace teardown, config rollback by digest, and non-interference. Real-provider, networked or credentialed environments were not demonstrated (residual risk; mainly relevant to the Opt-in decision). |
| Human Owner explicit decision on bounded completion | **Not entered** | Section 4 |

No technical condition is unmet. The remaining condition is the Human Owner's
explicit bounded-completion decision. Opt-in (`RELEASE_APPROVED`) is
independent of it.

## 2. Residual risks and known limitations

| Residual risk | Classification | Blast radius / handling |
| --- | --- | --- |
| S2-c comparison is `COMPARISON_NOT_ESTABLISHED`; incremental value over Native-only is unproven | Unproven; not a stop target | No detection-benefit claim |
| S3-a M-2 (Review Terminal metadata hardening) out of scope | Known limitation | Not covered by S5 |
| Legacy Staging recovery limited when Staging history is absent | Known limitation | Recovery limited for such data |
| External Writer / File durability and abnormal-termination durability unproven | Unproven | No durability guarantee claimed |
| S3-b guarantee is single process / single writer, demonstrated with the Justice core harness; it is not an active V2 workflow because V1 hooks are not ported | Bounded | No multi-writer use; no full Semantic Recovery or external side-effect rollback |
| Multi-process Recovery unproven; S3-c Host Enforcement not implemented; S4 not adopted | Out of scope | No multi-process use |
| Host pre-execution enforcement not proven; AC-H02 is Justice-internal handling | Inherent limit | Holds are non-acceptance/non-progression only |
| AC-H01 does not prove full-history completeness, Source authenticity, or cryptographic Owner authentication | Inherent limit | Evidence interpreted within these limits |
| V2 entry exposes only `justice_review` via Code Mode. Resolve is always denied (no approval channel). V1 commands, hooks and the implementation arm are not ported. The Code-Mode-disabled fallback is unverified. | Functional limit | Only the demonstrated paths are documented as usable |
| Global Wisdom runtime write path not exercised; host-provided `effect` version unverified | Unverified | No claim made |
| No acceptance run used a real LLM provider, credentials or external network | Unverified | Relevant to any Opt-in into such an environment |
| Versions other than OpenCode V2.3.2 at the recorded digest are unverified | Unverified | Use only the fixed Version |
| AC-H01 runner prints two benign post-sequence shell errors (same as T09) | Known tooling quirk | No effect on acquired data; not fixed in S5 |

Only operations that are safety-critical and cannot be limited are stop
targets, per the stop table in
`docs/superpowers/operations/justice-v6-s5-minimal-operation-runbook.md`.

Related tracking: Issues #355, #356, #358 and #388.

## 3. Target

| Item | Value |
| --- | --- |
| Host | Existing Ubuntu `coreultra7-270k` (D-S5-08) |
| Version | OpenCode V2.3.2, binary SHA-256 `e6543f6e5c39c40971ba38afd1819ac852c29ac735b5a89065d3d148d47f27ad` |
| Justice | `896acee25323c0e5b6dc97e0dd936efff1b9e434`; V2 Artifact SHA-256 `b2130a6d27e04a460ef3c7340994b703121b5cd001a2cbb78ad0b9165da0b855` |
| Scope | Adopted bounded S1, S2, S3 (D-S5-01); S3-b single process / single writer |
| Operation | Runbook sections 4–6 (demonstrated pattern); Opt-in not approved |

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
- No PR merge, deploy, review or next task is started automatically.
- `RELEASE_APPROVED` is never inferred or set automatically.
- Work may stop with both fields `PENDING`.
