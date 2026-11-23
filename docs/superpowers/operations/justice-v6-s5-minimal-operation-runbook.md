# Justice v6 S5 Minimal Operation Runbook

This document defines the safety boundary for a future, Owner-approved Opt-in
of Justice v6. It is an operation runbook skeleton for the Human Owner. It is
not a runtime approval object, a Gate state, or a product status field.

Current state: **D-S5-08 Design Addendum adopted as policy; no Source implementation, Host GO or Release authorized.**
No real-Host acceptance has been run (see the sibling acceptance record). This
runbook therefore contains no enable command and no destructive Cleanup
command. Every Host or Version value that has not been fixed is recorded as
`未固定` (not fixed; to be fixed by S5 Design). Actual Opt-in start requires a
separate Owner approval.

Related documents:

- Acceptance record:
  `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`
- Requirements:
  `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md`
  (D-S5-03 explicit Owner Opt-in, D-S5-04 fail-closed with limited blast
  radius; historical D-S5-05 independent Host was superseded for this acceptance by D-S5-08)

## 1. Prerequisites (all must hold, otherwise do not operate)

If any item is not satisfied, or cannot be confirmed, the operation is
prohibited. Absence of confirmation is never read as satisfaction.

| Item | Required condition | Current value |
| --- | --- | --- |
| Host | D-S5-08 existing Ubuntu `coreultra7-270k`; dedicated Workdir/Session/Fixture/Private Evidence; logical-only, not OS isolation | Owner-observed candidate; exact identity and writable boundaries NOT_FIXED |
| Version | Real 2.3.2 executable SHA and truthful Source wrapper; current S2-b 2.2.5-only needs separate compatibility implementation/tests | 2.3.2 Owner-observed; binary hash NOT_MEASURED; Host GO HOLD |
| Scope | Accepted bounded range only (candidate: S1, S2, S3 per D-S5-01) | 未固定 |
| Default | OFF; nothing is installed or enabled automatically | OFF |
| Owner permission | Explicit Human Owner approval of the use scope (D-S5-03), recorded as a reference | None |
| Acceptance | AC-H01 to AC-H03 recorded as `PASS` with `observed` or `derived` evidence | All `NOT_RUN` |
| Secrets | No inherited/existing credentials read, transferred, exported or logged; **absence of inherited Host secrets is not proved** | NOT_VERIFIED |
| Network | Only Owner-fixed endpoints/direction/time and effective controls; XDG/`--standalone` does not enforce network deny | NOT_FIXED / HOLD |
| Side effects | Allowed side effects stated explicitly; Live Tool side effects are not replayed | 未固定 |
| Operation | The target Operation is named explicitly | 未固定 |
| Existing flow | The normal Superpowers / OpenCode V2 flow is not changed unnecessarily | Required |

## 2. Explanatory states

The sequence below is an **operational explanation only**. It is not a new
Justice Runtime state, not a persisted schema, and must not be implemented as
one. It helps the Owner tell Opt-in, Stop and Rollback apart.

```text
PREPARED -> ACCEPTANCE_VERIFIED -> OPT_IN_APPROVED -> ENABLED -> STOPPED / ROLLED_BACK
```

| Explanatory state | Meaning | Owner decision needed to leave it |
| --- | --- | --- |
| PREPARED | Section 1 prerequisites are being collected; nothing is enabled | Prerequisites complete |
| ACCEPTANCE_VERIFIED | AC-H01 to AC-H03 `PASS` is confirmed against the fixed Host, Version and Scope | Owner reviews evidence and known limitations |
| OPT_IN_APPROVED | The Owner explicitly approved use for the stated Host, Version, Scope and Operation. This is a separate decision from `BOUNDED_COMPLETE` | Start of use is a further explicit step |
| ENABLED | Use is active inside the approved boundary only | Stop or Rollback trigger |
| STOPPED | Use is paused; protection boundaries are kept; state is retained | Owner decision to resume or roll back |
| ROLLED_BACK | The approved boundary has been returned to the pre-Opt-in condition | Owner decision on any re-Opt-in |

Procedure per state (no concrete commands are given until S5 Design and Owner
approval are fixed):

1. PREPARED: fill the Target identity of the acceptance record. Leave any
   unmeasured value as `未固定`.
2. ACCEPTANCE_VERIFIED: confirm each required AC is `PASS`, that no `declared`
   evidence supports a PASS, and that the known limitations are disclosed. If
   any AC is `NOT_RUN`, `FAIL` or `NOT_VERIFIED`, do not proceed.
3. OPT_IN_APPROVED: the Owner records an approval reference naming Host,
   Version, Scope and Operation. Approval of one Host or Version does not
   extend to another.
4. ENABLED: the enable procedure is **not defined here**. It is to be fixed by
   S5 Design and a separate Owner approval. Until then, do not enable.
5. STOPPED: stop use and hold the affected operations per section 3. Do not
   bypass protection boundaries to stop faster.
6. ROLLED_BACK: the rollback procedure is **not defined here**. It is to be
   fixed by S5 Design and a separate Owner approval. Until then, do not run any
   destructive Cleanup. If rollback is not possible, hold the affected targets
   and request an Owner decision (see section 3).

## 3. Stop table (fail-closed with limited blast radius)

Host pre-execution enforcement is **not proven**. Justice has not been shown to
be able to force-stop Host execution before it happens, so no safety guarantee
that depends on such enforcement is claimed. The holds below are Justice-side
non-acceptance and non-progression, not proof that Host execution was
prevented.

| Condition | Affected target | Operations stopped or held | Independent normal work may continue when |
| --- | --- | --- | --- |
| Source missing | The Task / Plan whose Evidence depends on that Source | Success認定 (success is not asserted); Evidence stays `UNKNOWN`; Gate PASS for that target is not issued | The work does not depend on the missing Source and its safety is independent |
| Authority mismatch | The approval or state change that lacked matching Authority | That approval or state change is rejected or held; no substitute self-declared approval is accepted | The work needs no approval or state change from the mismatched Authority |
| Lifecycle inconsistency (Decision vs Lifecycle, Recovery mismatch) | The affected Task / Plan | Progression of that Task / Plan is held | Other Tasks / Plans do not share the inconsistent Decision / Lifecycle |
| Diagnostic display failure | Diagnostic output only | Reliance on the failed diagnostic output; any conclusion that needs it | Work is safety-independent of the diagnostic output (display errors do not by themselves stop it) |
| Unexpected side effect | The Operation and any target it touched | The Operation is stopped; no Live Tool side-effect Replay is attempted; Owner is informed | The work is isolated from the touched target and the Owner confirms the boundary |
| Rollback impossible | Everything affected by the failed rollback | Affected targets are held; no further destructive action is taken | Only targets proven unaffected; the Owner decision is required for the rest |
| Justice stopped | Justice-provided quality review | Justice stops without bypassing protection boundaries | Work that never depended on Justice; no safety guarantee is claimed on its behalf |

"Independent normal work" means work whose safety does not depend on the
affected Source, Authority, Lifecycle or diagnostic. If independence cannot be
shown, treat the work as affected.

## 4. Rollback boundary check

This section confirms, as a document review, that the runbook does not require
any of the following. Each one is outside the approved boundary and must not be
done without a separate Owner approval and S5 Design:

- Rewriting Gate or HOLD outcomes without approval.
- Reinstalling/reconfiguring the existing Host or shared OpenCode V2 settings; existing launcher is only a selected target, not Host GO.
- Transferring Secrets to the Host.
- Replaying Live Tool side effects.
- Running destructive Cleanup, or any concrete enable command, before S5 Design
  and Owner approval are fixed.

## 5. Compatibility and known limitations

Target Host is Owner-observed OpenCode V2.3.2, not yet accepted. Current S2-b only supports 2.2.5, so 2.3.2 compatibility remains a separate Source authorization/verification gate. Unknown Versions fail closed. The inherited known limitations are listed in section
4 of the acceptance record and are not repeated as guarantees here, including
`COMPARISON_NOT_ESTABLISHED`, `RUNTIME_NOT_VERIFIED`, unproven multi-process
Recovery, and the absence of Host enforcement.

## 6. D-S5-08 Host Manifest and rollback HOLD

The older local untracked S5 Design R0.1 and Host Execution Manifest R0.1 remain **unmodified** and still assume an isolated 2.2.5 Host. Do not create tracked files at their paths and risk a checkout conflict. Before Host GO, Owner must reconcile or explicitly supersede these drafts and fix exact measured binary SHA, Justice commit, dedicated Session/Task/Scope/Correlation/Writer paths, native read method, inherited credentials/Network, non-interference, safe reversible restart/injection, independent readback, explicit stop/rollback and cleanup allowlist. A safety boundary that cannot be demonstrated leaves the affected operation HOLD. No enable, cleanup or rollback command is authorized.

Adapter statuses `REJECTED/LIMITED/PROJECTED` are not AC outcomes; a foreign-only `PROJECTED` with zero selected Evidence is not PASS. Optional `time.firstToken` is not validated by current `isMessage()`. `AC-H01/H02/H03=NOT_RUN`; `BOUNDED_COMPLETE=PENDING`, `RELEASE_APPROVED=PENDING`.

## 6. Completion terms (not established)

This runbook does not establish `BOUNDED_COMPLETE` or `RELEASE_APPROVED`.
`BOUNDED_COMPLETE` does not imply `RELEASE_APPROVED`; the latter is an
independent Owner Opt-in decision for a designated environment. Neither is
approved here.
