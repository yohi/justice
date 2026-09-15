# Controller Routing Command Envelope Spike

## Authority and scope

- Baseline HEAD: `66605cf0cead51063fac479d6c370a5407107ce0`
- Branch: `feature/semantic-control-plane-plan`
- Baseline remote: `origin/feature/semantic-control-plane-plan` at the same HEAD
- Execution-agent model: `openai/gpt-5.6-terra`
- Execution-agent reasoning level: `high`
- Supported host: OpenCode `1.18.29`
- Pinned host source: `16747470f976aca3d362ad730bcd3fe82ecc2c9a`
- Repository plugin and SDK assumptions: `@opencode-ai/plugin` and `@opencode-ai/sdk` compatible with the repository declarations at `1.14.21`
- Required temporary runtime model: `JUSTICE_HOST_TEST_MODEL=opencode/mimo-v2.5-free`
- Scope: Option G matched terminal envelope plus sticky missing-terminal fallback only
- Evidence classes: exact-host runtime observations and deterministic state-machine replay controls

Task 4.0, `SESSION-SAFETY-1`, and `COMMAND-TERMINAL-1` remain immutable historical evidence. Issue #228 is a non-authoritative design tracker. This artifact is execution authority only for this spike and is not specification authority before a complete PASS and subsequent formalization.

The temporary probe, state-machine implementation, replay controls, trace, and validator live only in scratch space outside the repository. This artifact does not authorize production source, production tests, production configuration, CI, package or lockfile changes, native/Rust changes, or production implementation.

## Non-goals

- Do not reinterpret Task 4.0, `SESSION-SAFETY-1`, or `COMMAND-TERMINAL-1`.
- Do not revive Option D or Option F.
- Do not equate `command.executed` with successful execution.
- Do not equate failed execution with failed routing attribution.
- Do not define production `routingStatus` semantics from this capability spike alone.
- Do not use `session.idle` as release authority.
- Do not fabricate host runtime events for mismatch or missing-terminal evidence.
- Do not use another host version, source revision, runtime model, provider, alias, or fallback.
- Do not infer identity from content, arguments, timing, FIFO, queue position, or event arrival order.

## Fixed Option G hypothesis

On the exact supported host, a matched terminal envelope consisting of:

```text
command.execute.before
-> routing observations
-> finalized assistant message
-> matching command.executed
```

can safely close a clean single-command lifecycle for either execution success or execution failure. Execution outcome, routing attribution, and lifecycle terminal correlation remain separate dimensions.

Overlap, terminal mismatch, missing terminal followed by a next command, or any ambiguous correlation must not be guessed. Those conditions enter sticky fail-closed suppression, which only session removal may clear. This may preserve session-scoped O(1) state while excluding cross-invocation routing misattribution.

## Fixed state model

```text
idle
  |
  | command.execute.before
  v
active(candidate)
  |
  | finalized assistant observed
  v
active(finalized candidate)
  |
  | fully matching command.executed
  v
idle
```

Abnormal transitions are fixed as:

```text
active / finalized-active
  |
  | overlap
  | terminal mismatch
  | ambiguous correlation
  | missing terminal + next command
  v
suppressed(sticky)
  |
  | session removal only
  v
removed
```

Each session has at most one candidate slot and one state tag. There is no queue. A hook-local synchronous failure may roll back only its own provisional acquisition. Suppression established by another invocation is never rolled back by that failure. Removed state is not retained and late events do not recreate it.

`session.idle` and `session.status=idle` are observations only. They cannot release, clear, consume, finalize, overwrite, or unsuppress state.

### Terminal envelope predicates

A clean envelope may close and release only when all predicates hold:

```text
active candidate exists
AND same session
AND finalized assistant observation exists
AND finalized assistant has completed lifecycle
AND captured command name == command.executed.name
AND finalized assistant message ID == command.executed.messageID
AND not suppressed
AND not ambiguous
```

`arguments` is never identity authority.

### Finalized assistant and outcome predicates

The pinned assistant schema permits `time.completed`, `error`, and `finish`. The processor cleanup sets `time.completed`; normal step completion sets `finish`; processor failure sets `error`, with `finish="error"` present only for some failure classes. The fixed predicates are therefore:

```text
assistantCompleted = assistant.time.completed is present and finite
assistantHasError = assistant.error is present
finishObserved = assistant.finish is a non-empty string
finishIsError = assistant.finish == "error"

completedLifecycle =
  assistant role
  AND assistantCompleted
  AND (assistantHasError OR finishObserved)

executionOutcome = success when
  completedLifecycle
  AND assistantHasError == false
  AND finishIsError == false

executionOutcome = failed when
  completedLifecycle
  AND (assistantHasError == true OR finishIsError == true)
```

The trace stores only these booleans and the fixed `success` or `failed` label. It does not store `finish`, raw error data, or message payloads. A finalized observation that does not satisfy `completedLifecycle` cannot close an envelope.

Routing observation matching is recorded separately from `executionOutcome`. Terminal envelope matching is separately derived from same-session, command-name equality, assistant-message-ID equality, finalized lifecycle, and non-suppressed/non-ambiguous state.

## Fixed runtime cases

### S: clean successful envelope

Run one successful command S:

```text
S command.execute.before
-> S chat.params
-> S finalized assistant(success)
-> S matching command.executed
-> terminal envelope closed
-> release
-> C command.execute.before
```

Verify command-name and assistant-message-ID equality, `assistantCompleted=true`, `assistantHasError=false`, successful execution outcome, and clean release. Then verify C acquires a fresh candidate.

### S: post-terminal safety

After S closes, start C. Observe all routing-mutating events through C completion. An S-origin routing-mutating event must not cross-apply to C. Event order alone is not identity authority. If an old event can arrive after terminal close and cannot be distinguished from C with stable host identity, classify the capability as BLOCKED.

### F: clean failed envelope

After F `command.execute.before`, inject a deterministic post-before failure in `chat.params` or an equivalent processor-owned post-before boundary:

```text
F command.execute.before
-> F routing observation
-> F finalized assistant(error)
-> F matching command.executed
-> terminal envelope closed
-> release
-> C2 command.execute.before
```

Verify `assistantCompleted=true` and failed execution outcome independently from command-name match, assistant-message-ID match, routing observation match, terminal envelope match, and release result. Failure outcome does not automatically mean routing success or production `routingStatus=applied`.

### F: next-command reuse and post-terminal safety

After F closes, C2 must acquire a fresh candidate and complete independently. F-origin late message, event, idle, or command-related observation must not clear, consume, finalize, overwrite, suppress, or receive attribution from C2 state.

### O: overlap before envelope close

```text
A command.execute.before
-> A active
-> B command.execute.before before A terminal close
-> suppressed(sticky)
```

Verify immediate suppression, no second owner, no queue, no event-order assignment, and no authoritative A/B attribution. A/B finalized events, matching `command.executed`, `session.idle`, and actual-controller equality must not release suppression or create authoritative routing attribution.

### R: hook-local synchronous failure

Inject deterministic synchronous failure after R provisional acquisition in `command.execute.before`. Verify `r_acquired -> r_rolled_back`, `owned=false`, and `suppressed=false`. In a separate state-machine control where suppression already exists from another invocation, R rollback must preserve that suppression.

### Removal

Create sticky suppression, execute exact-host session deletion, and verify `suppressed -> removed`. Later event delivery in the temporary state-machine observation path must not recreate removed state.

## Fixed negative replay controls

Replay controls consume a valid redacted host trace. They are state-machine fail-closed sanity controls, not evidence that the host generated the modified sequence.

### M: terminal mismatch

Replay a valid finalized trace with exactly one terminal equality predicate changed to false. Verify `active/finalized -> suppressed`, `terminalEnvelopeMatch=false`, and no release.

### X: missing terminal

Replay a valid finalized trace with only matching `command.executed` omitted, then replay the next `command.execute.before`. Verify the stale finalized candidate enters sticky suppression and does not release through idle, TTL, timer, elapsed time, or inference.

## Fixed PASS criteria

All criteria must hold in one complete exact-host execution plus the deterministic replay controls.

1. Exact OpenCode `1.18.29`, pinned source, SDK/plugin assumptions, and approved runtime model are confirmed.
2. S produces `command.execute.before -> finalized assistant(success) -> matching command.executed` as a complete envelope.
3. S command name and assistant message ID both match.
4. S terminal close safely releases state and the next command acquires cleanly.
5. An old S routing-mutating event cannot cross-apply after terminal close.
6. F finalized assistant carries an explicit failed outcome.
7. F command name and finalized assistant ID match `command.executed`.
8. F execution failure is separate from terminal correlation, and its clean envelope safely closes and releases.
9. After F release, the next command acquires cleanly and no F late event acts on its state.
10. O overlap enters sticky suppression before envelope close and creates no second owner, queue, or guessed attribution.
11. O suppression survives late finalized events, matching `command.executed`, `session.idle`, and other observations.
12. R synchronous before failure rolls back only its own provisional state.
13. Session removal is the only sticky-suppression fallback cleanup authority.
14. M mismatch replay always enters fail-closed suppression.
15. X missing-terminal replay enters sticky suppression when the next command arrives and never guesses release.
16. Session state is O(1).
17. FIFO, TTL, timer, elapsed time, content, arguments, latest/current lookup, desired-controller reverse lookup, local generation, and event-order heuristics are not identity authority.
18. Complete runtime and replay traces are allowlisted, redacted, schema-valid, and flushed.
19. Harness failure count is zero.

Only when every criterion passes is `COMMAND-ENVELOPE-1 = PASS`.

## Fixed BLOCKED criteria

With complete valid execution and replay controls, classify `COMMAND-ENVELOPE-1 = BLOCKED` if any of the following holds:

- Failed assistant outcome and matching `command.executed` cannot be safely joined as one terminal envelope.
- Finalized assistant ID plus command name cannot close a clean envelope.
- An old routing-mutating event can cross-apply after success or failure release.
- Reuse after a failed envelope is unsafe.
- Overlap cannot converge to sticky suppression.
- A late terminal event must release suppression.
- Mismatch or missing terminal cannot be handled fail-closed.
- Normal reuse needs `session.idle`, TTL, FIFO, timing, content, or another prohibited heuristic.
- A stable host invocation identity remains necessary.
- O(1) state cannot be preserved.
- Wrong cross-invocation routing attribution cannot be excluded.

## Harness-failure boundary

Probe syntax/runtime bugs, request-shape bugs, model/provider failures, server startup failures, incomplete required runtime cases, trace flush failures, validator failures, schema-invalid evidence, and replay-validator bugs are `execution/harness failure`, not capability BLOCKED. Partial runtime traces cannot produce a capability classification.

## Evidence hygiene

The artifact and temporary persisted evidence may contain only fixed case labels, event kinds, relative ordering, state transitions, boolean predicates, bounded counts, equality results, fixed version/source/model declarations, criterion results, validator status, and flush/disposal status.

The artifact and temporary persisted evidence must not contain raw session or message IDs, raw arguments, prompt/message text, model output, raw errors, credentials, tokens, provider secrets, PID, absolute scratch paths, or raw event payloads. Runtime observations and synthetic replay controls are stored and reported separately. The runtime model name is recorded only as the approved environment contract.

## Pre-execution status

```text
Task 4.0 = COMPLETED / BLOCKED
SESSION-SAFETY-1 = BLOCKED
Option D = NOT ADOPTED
COMMAND-TERMINAL-1 = BLOCKED
Option F = NOT ADOPTED
Option G = PROVISIONAL SUCCESSOR CANDIDATE
           = NOT SPECIFICATION AUTHORITY
Requirements = unchanged / authoritative
Task 4.1 = SUSPENDED / NOT EXECUTABLE
Task 4.2 = SUSPENDED / NOT EXECUTABLE
production implementation = BLOCKED
```

The sections above are fixed before runtime execution and must not be changed after observations are collected. After execution, additions are limited to `Execution result`, `Runtime observations`, `Validator result`, `Criterion-by-criterion result`, and `Final classification`.

## Execution result

The complete decisive execution used OpenCode `1.18.29`, pinned source
`16747470f976aca3d362ad730bcd3fe82ecc2c9a`, the repository-resolved
`@opencode-ai/plugin` / `@opencode-ai/sdk` assumptions at `1.14.21`, and
`JUSTICE_HOST_TEST_MODEL=opencode/mimo-v2.5-free`. No model, provider, host version, or
source fallback was used.

The decisive execution produced 35 allowlisted runtime records and three separately labelled
deterministic replay-control records. The runtime trace, replay trace, source check, and validator
report were flushed in temporary scratch space before classification.

Two preparatory harness-development attempts stopped before a capability run began: one at a
reused pinned-source checkout ownership guard and one at an unbounded startup health request.
Neither attempt produced a complete runtime trace or a capability classification. The temporary
harness was corrected without changing the fixed hypothesis or criteria. The subsequent complete
decisive run had `harnessFailureCount=0`.

## Runtime observations

### S: successful terminal envelope

The successful command produced this redacted sequence:

```text
s_before
-> s_routing
-> s_finalized(executionOutcome=success)
-> s_idle_observed(releaseAuthority=false)
-> s_terminal(commandNameMatch=true, messageIdMatch=true,
              terminalEnvelopeMatch=true, releaseResult=released)
-> c_before(acquired=true)
-> c_routing
-> c_finalized(executionOutcome=success)
-> c_terminal(terminalEnvelopeMatch=true, releaseResult=released)
```

The finalized S assistant had `assistantCompleted=true`, `assistantHasError=false`,
`finishIsError=false`, and `completedLifecycle=true`. S released only at its matching terminal
envelope, and C acquired one fresh candidate with no queue. The pinned-source check confirmed that
the routing observation is in the awaited prompt hook path and that command completion follows the
awaited prompt path. The runtime trace contained no `routing_without_candidate` or
`terminal_anomaly_suppressed` record, so an S routing-mutating observation did not cross-apply to C.

### F: failed terminal envelope

The deterministic post-before failure produced this redacted sequence:

```text
f_before
-> f_routing
-> f_idle_observed(releaseAuthority=false)
-> f_finalized(executionOutcome=failed)
-> f_idle_observed(releaseAuthority=false)
-> f_terminal(commandNameMatch=true, messageIdMatch=true,
              terminalEnvelopeMatch=true, releaseResult=released)
-> c2_before(acquired=true)
-> c2_routing
-> c2_finalized(executionOutcome=success)
-> c2_terminal(terminalEnvelopeMatch=true, releaseResult=released)
```

The finalized F assistant had `assistantCompleted=true`, `assistantHasError=true`,
`finishIsError=false`, and `completedLifecycle=true`. The terminal record independently retained
`executionOutcome=failed`, `routingObservationMatch=true`, and `terminalEnvelopeMatch=true`.
Execution failure therefore neither prevented safe lifecycle closure nor became routing success by
itself. C2 acquired a fresh candidate after F release. The source-ordering check and absence of
runtime routing/terminal anomalies showed that no F routing-mutating observation acted on C2.

### O, R, and Removal

O acquired A, then the overlapping B transition immediately produced
`suppressed=true`, `secondOwnerCreated=false`, `candidateSlots=0`, `queueSize=0`, and
`guessedAttribution=false`. Subsequent routing, finalized-assistant, terminal, and idle observations
did not release suppression or create authoritative attribution, including when the actual controller
matched the desired controller.

R produced `r_acquired -> r_rolled_back` with `owned=false`, `suppressed=false`, and no retained
candidate. The separate rollback control over an already suppressed session produced
`suppressionPreserved=true`.

Removal produced `removal_suppressed -> removal_completed` with `removed=true`, `owned=false`,
`suppressed=false`, `candidateSlots=0`, and `queueSize=0`. The separate removed-state replay showed
that late finalized, terminal, and idle observations remained observation-only and did not recreate
state.

### Negative replay controls

M changed only the finalized-assistant message identity in a valid redacted sequence. It produced
`messageIdMatch=false`, `terminalEnvelopeMatch=false`, `stateAfter=suppressed`, and
`releaseResult=suppressed`.

X omitted only the matching terminal input, then supplied the next command input. It produced
`nextCommandSuppressed=true`, `stateAfter=suppressed`, `releaseResult=not_released`, and
`releaseAuthority=false`.

M and X are deterministic temporary state-machine controls. They are not claims that the supported
host generated those modified sequences.

## Validator result

```text
classification = PASS
runtimeSchemaValid = true
runtimeComplete = true
replaySchemaValid = true
sourceOrderingConfirmed = true
runtimeRecordCount = 35
replayRecordCount = 3
failedCriteria = []
harnessFailureCount = 0
dispose_flushed = true
```

The source check additionally reported `commandOrdering=true`, `awaitedPluginHooks=true`,
`awaitedRoutingObservation=true`, `failedAssistantCanReturn=true`,
`completedLifecycleAvailable=true`, and `prohibitedHeuristicUsed=false`.

## Criterion-by-criterion result

1. **PASS**: exact host, pinned source, SDK/plugin assumptions, and approved runtime model matched.
2. **PASS**: S formed the complete before, successful-finalized, matching-terminal envelope.
3. **PASS**: S command name and assistant message identity both matched.
4. **PASS**: S released at terminal close, and C acquired and completed independently.
5. **PASS**: awaited source ordering and zero runtime routing/terminal anomalies excluded S cross-apply.
6. **PASS**: F finalized with an explicit failed outcome and completed lifecycle.
7. **PASS**: F command name and failed assistant message identity both matched its terminal event.
8. **PASS**: F failure, routing match, terminal correlation, and release were recorded independently.
9. **PASS**: C2 acquired and completed after F release with no F-origin routing anomaly.
10. **PASS**: O immediately became sticky suppression without a second owner, queue, or guess.
11. **PASS**: routing, finalized, terminal, and idle observations did not release O suppression.
12. **PASS**: R rolled back only its provisional acquisition and preserved pre-existing suppression.
13. **PASS**: session removal cleared sticky suppression; late replay observations did not recreate state.
14. **PASS**: M terminal mismatch entered suppression and did not release.
15. **PASS**: X missing-terminal replay suppressed on the next command and did not infer release.
16. **PASS**: every session had at most one candidate slot and the queue size was always zero.
17. **PASS**: no prohibited identity heuristic was used.
18. **PASS**: runtime and replay traces were separate, allowlisted, redacted, schema-valid, and flushed.
19. **PASS**: the complete decisive run reported zero harness failures.

## Final classification

```text
COMMAND-ENVELOPE-1 = PASS
Option G = ADOPTED FOR DOCUMENT FORMALIZATION
production implementation = NOT STARTED
maximum readiness = READY FOR INDEPENDENT DOCUMENT REVIEW
```

This PASS establishes the supported-host capability for the fixed Option G contract. It does not
reinterpret Task 4.0, `SESSION-SAFETY-1`, or `COMMAND-TERMINAL-1`, and it does not revive Option D
or Option F. Requirements, Design, and Plan remain separate specification authority. Following this
classification, they were synchronized in that order for independent document review; production
implementation was not started or authorized.
