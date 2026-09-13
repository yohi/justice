# Controller Routing Session Safety Spike

## Authority and scope

- Baseline: `381a522`
- Prior negative evidence: `docs/spikes/2026-09-controller-routing-runtime-signals.md` at `58bd1c1570c298f9f9974b564d575777d0df38ec`
- Supported host: OpenCode `1.18.29`, pinned source `16747470f976aca3d362ad730bcd3fe82ecc2c9a`
- Scope: JUS-P0-01 successor capability only
- Non-goals: production source, production tests, production configuration, package/lockfile, CI, and the Task 4.0 report

Task 4.0 remains immutable negative evidence. This artifact is a separate, narrow experiment. It does not make Issue #228 authoritative.

## Pre-execution successor evaluation

| Option | Decision before execution | Reason |
| --- | --- | --- |
| A. Per-invocation plus FIFO/order/TTL | Rejected | The supported host provides no stable identity shared by `command.execute.before` and completion events. Heuristics are not routing authority. |
| B. Justice-side serialization | Rejected | It duplicates host runner serialization and has no host terminal authority for a failed `command.execute.before`. |
| C. Side-channel identity | Rejected | It depends on undocumented object transport and leaves the failure lifecycle unresolved. |
| D. Session-scoped single-flight plus fail-closed attribution | Candidate | It can avoid cross-invocation attribution without treating heuristics as identity, if release and late-event isolation are observed. |
| E. Suppress until session removal only | Fallback only | It is safer than guessing but does not establish a reusable normal-path successor contract. It is not adopted by this spike. |

Routing safety takes precedence over routing fidelity. No candidate may use content, arguments, FIFO, event arrival order alone, TTL, latest/current workflow, desired-controller reverse lookup, model output, assistant prose, or a Justice-local routing generation as invocation identity authority.

## Fixed capability hypothesis

`SESSION-SAFETY-1` tests whether the supported host permits this deliberately narrow Option D contract:

1. Justice holds at most one session-scoped routing ownership slot; it has no queue.
2. A second `command.execute.before` while ownership is active invalidates the capture and puts the session into suppressed attribution. It does not assign either command a workflow from event order.
3. A synchronous failure after a hook-local acquisition rolls back only that same provisional acquisition. It must not clear a suppression established by another overlapping hook.
4. `session.idle` may release session ownership only if the runtime observation proves that all routing-mutating events for the completed run precede it, and the only observed old-run post-idle event is ignored by the routing state machine.
5. `command.executed` is observation-only for this successor. It never clears, consumes, finalizes, overwrites, or attributes session routing state.
6. After release, a next command C may acquire the one slot. An old B `command.executed` delivered after C starts must leave C's ownership, capture, suppression, and audit state unchanged.
7. Suppressed or ambiguous A/B executions never produce `routingStatus = applied`, even if an observed actual agent equals a desired controller.

The hook-local rollback marker in item 3 is a private guard for the currently executing hook only. It is not persisted, transported to another event, or used as invocation identity.

## Fixed runtime procedure

The temporary harness lives only under `/tmp/justice-controller-routing-session-safety` inside the devcontainer. It provisions the exact `opencode-ai@1.18.29` CLI and re-fetches the pinned source. It starts one server and one session with pinned commands A, B, C, and R:

- R creates one provisional slot and throws synchronously in `command.execute.before`; the harness verifies deterministic rollback.
- A creates one slot and waits in `command.execute.before`.
- B starts in the same session, observes the active slot, transitions the session to suppressed attribution, and releases A.
- A throws from the awaited hook; B completes normally.
- On the first observed `session.idle` after B's finalized assistant event, the server-side temporary probe starts C in the same session.
- The trace records whether C's `command.execute.before` occurs after B idle and before B's old `command.executed`.
- The probe state machine ignores all `command.executed` events and records only sanitized transition effects.
- The instance is explicitly disposed and the probe's disposal sentinel flushes the detached event trace before validation.

The report contains only fixed command labels, event kinds, boolean predicates, bounded counts, and relative ordering. It contains no prompt/message content, arguments, raw event objects, model/provider identifiers, credentials, absolute paths, process identifiers, or session/message IDs.

## Fixed PASS criteria

The capability is `PASS` only if all conditions hold in one exact supported-host execution:

1. Exact CLI version, pinned source version, and required plugin/SDK declarations are verified.
2. R fails from the awaited `command.execute.before`, emits no `command.executed`, and leaves no owned or suppressed routing state.
3. A and B each reach `command.execute.before` in the same session; A fails after B is observed; B succeeds with one finalized assistant event and one `command.executed`.
4. The temporary state machine is suppressed before A's failure rollback runs, and that rollback does not clear suppression.
5. B's routing-mutating `chat.params` and finalized `message.updated` observations precede the B `session.idle` used for release.
6. C's `command.execute.before` occurs after that B idle and before B's old `command.executed`.
7. B's old post-idle `command.executed` has no routing-state effect while C owns the sole slot.
8. C completes with its own finalized routing observation; no A/B routing-mutating event arrives after C ownership starts.
9. A and B emit no `applied` audit result while suppressed, and the per-session state never exceeds one slot.
10. The trace is schema-valid and flushed before validation.

## Fixed BLOCKED criteria

The capability is `BLOCKED`, rather than inferred, if a complete and valid execution cannot demonstrate every PASS criterion. This includes an early/ambiguous idle, a routing-mutating old event after C owns the slot, C not occurring between idle and the old B completion event, a non-isolated rollback, or any need for a prohibited heuristic.

## Harness-failure boundary

Failure to provision the exact CLI/source, start the isolated server, run the required commands, parse the temporary probe, flush the trace, or validate its schema is an `execution/harness failure`. It is not a capability result and must not be recorded as `PASS` or `BLOCKED`.

## Execution result

### Preflight

- The temporary probe and validator passed non-executing Bun syntax checks.
- The scratch CLI was provisioned as exact `opencode-ai@1.18.29` and its binary reported `1.18.29`.
- The pinned source package reported `1.18.29`; the checked source retained the expected command-before, runner-idle, session-run-state, and plugin-dispatch semantics.

### Execution/harness failure

The required runtime sequence did not complete, so this artifact has no capability `PASS` or `BLOCKED` result.

- The repository devcontainer could not be used because its Docker daemon was unavailable.
- The isolated host fallback did not have `JUSTICE_HOST_TEST_MODEL` set. It therefore could not run R/A/B/C without substituting a model/provider or using the host's global OpenCode `1.18.30`; both substitutions are outside this fixed procedure.
- The host fallback stopped before a complete A/B/C trace and before validator output. No partial trace is runtime evidence.

`SESSION-SAFETY-1` is unproven. Option D is **NOT ADOPTED**. This execution/harness failure does not alter the Task 4.0 `BLOCKED` result, does not create a new cleanup/release authority, and does not authorize production source or test implementation.

### Continuation attempt: 2026-09-13

This is a separate execution attempt. It preserves the fixed hypothesis, procedure, PASS criteria, BLOCKED criteria, and harness-failure boundary above.

#### Execution environment

- The existing repository devcontainer was started through its configured Docker environment.
- The exact scratch CLI package and binary both reported OpenCode `1.18.29`.
- The source fetched at pinned commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a` reported OpenCode `1.18.29`.
- The repository `@opencode-ai/plugin` and `@opencode-ai/sdk` declarations were both `1.14.21`; the command-before contract test passed.
- `JUSTICE_HOST_TEST_MODEL` was not configured in either the devcontainer or the isolated host fallback. No model/provider was substituted.

#### Runtime sequence and sanitized observations

- R/A/B/C were not started because the required model prerequisite was absent.
- No runtime trace, disposal sentinel, or validator result was produced. No partial trace is capability evidence.

#### Criterion-by-criterion result

| Fixed PASS criterion | Result |
| --- | --- |
| 1. Supported-host version/source/declarations verified | Partial preflight only; exact CLI, pinned source, and declarations verified, but no runtime execution |
| 2. R rollback leaves no state | Not evaluated |
| 3. Same-session A/B lifecycle | Not evaluated |
| 4. A rollback preserves B suppression | Not evaluated |
| 5. B routing mutations precede release idle | Not evaluated |
| 6. C window between B idle and old completion | Not evaluated |
| 7. Old B completion has zero C-state effect | Not evaluated |
| 8. C completes independently | Not evaluated |
| 9. A/B suppression and one-slot bound | Not evaluated |
| 10. Schema-valid flushed trace | Not evaluated |

#### Final classification

`SESSION-SAFETY-1 = execution/harness failure`

`SESSION-SAFETY-1` remains **UNPROVEN**. Option D remains **NOT ADOPTED** and production implementation remains **BLOCKED**. The prerequisite for a future execution is an explicitly configured, already authorized `JUSTICE_HOST_TEST_MODEL` in `provider/model` form available to the selected isolated execution environment. Task 4.0 remains immutable `BLOCKED` evidence for the old per-invocation candidate.

### Continuation attempt: 2026-09-13 (authorized model)

This is a separate execution attempt. It preserves the fixed hypothesis, procedure, PASS criteria, BLOCKED criteria, and harness-failure boundary above.

#### Execution environment

- The existing repository devcontainer was started and used for the isolated temporary harness.
- The temporary CLI package and binary both reported OpenCode `1.18.29`.
- The separately fetched source was pinned at `16747470f976aca3d362ad730bcd3fe82ecc2c9a`.
- `JUSTICE_HOST_TEST_MODEL` was exported only in the temporary devcontainer execution environment as the explicitly authorized `openai/gpt-5.6-luna`; it was not written to repository configuration, `.env`, or production configuration.

#### Execution/harness failure

The exact host rejected the authorized model identifier during model resolution before it dispatched the R `command.execute.before` hook. The sanitized host classification was `ProviderModelNotFoundError`; the host suggested unqualified catalog names, but no alternative provider/model was selected or used.

- R did not reach hook-local acquisition or rollback.
- A, B, and C were not started.
- The disposal sentinel flushed the temporary trace, but it contained no routing runtime events and is not capability evidence.
- No complete R/A/B/C execution or schema-valid runtime validator result exists.

#### Criterion-by-criterion result

| Fixed PASS criterion | Result |
| --- | --- |
| 1. Supported-host version/source/declarations verified | Partial preflight only; exact CLI and pinned source verified, but the host could not resolve the required model |
| 2. R rollback leaves no state | Not evaluated |
| 3. Same-session A/B lifecycle | Not evaluated |
| 4. A rollback preserves B suppression | Not evaluated |
| 5. B routing mutations precede release idle | Not evaluated |
| 6. C window between B idle and old completion | Not evaluated |
| 7. Old B completion has zero C-state effect | Not evaluated |
| 8. C completes independently | Not evaluated |
| 9. A/B suppression and one-slot bound | Not evaluated |
| 10. Schema-valid flushed trace | Not evaluated; the flushed partial trace is not evidence |

#### Final classification

`SESSION-SAFETY-1 = execution/harness failure`

`SESSION-SAFETY-1` remains **UNPROVEN**. Option D remains **NOT ADOPTED** and production implementation remains **BLOCKED**. The next attempt requires the exact supported host to expose the explicitly authorized `openai/gpt-5.6-luna` identifier without selecting a substitute. Task 4.0 remains immutable `BLOCKED` evidence for the old per-invocation candidate.

### Continuation attempt: 2026-09-13 (authorized runtime model)

This is a separate execution attempt. It preserves the fixed hypothesis, procedure, PASS criteria, BLOCKED criteria, and harness-failure boundary above.

#### Execution environment

- The existing repository devcontainer was started and used for the isolated temporary harness.
- The temporary CLI package and binary both reported OpenCode `1.18.29`.
- The separately fetched source was pinned at `16747470f976aca3d362ad730bcd3fe82ecc2c9a` and reported OpenCode `1.18.29`.
- The explicitly authorized temporary model variable was exported only in the devcontainer server and command processes. It was not written to repository configuration, `.env`, or production configuration.
- No alternate model, provider, alias, package, lockfile, production source, or production test was used.

#### Runtime sequence and sanitized observations

- R resolved through the provider and reached `command.execute.before`; `r_acquired` was followed by `r_rolled_back` with `owned = false` and `suppressed = false`.
- A and B reached `command.execute.before` in the same session. B established suppression before A's injected failure; A recorded rollback preservation of suppression. B completed with finalized assistant observation and an old `command.executed` observation.
- B's routing-mutating order was `b_chat_params`, `b_chat_params`, `b_finalized`, `b_idle`, `b_old_command_executed`.
- The probe requested C after `b_idle`, but the old B completion event was observed before the C request could dispatch: `b_idle` -> `b_old_command_executed` -> `c_start_requested`.
- C did not reach `command.execute.before`. The temporary probe called the supported host's v1 plugin client with a flat v2-style request shape. The host therefore left the `{id}` path placeholder unresolved and rejected the request before C execution.
- No C ownership, capture, suppression, audit, finalized observation, or `command.executed` state was observed. This absence is harness failure, not evidence that the C isolation criterion passed or failed.
- The instance disposal endpoint returned successfully and the disposal sentinel appended `dispose_flushed` before validation. The trace contained only sanitized transition records.

#### Validator result

The temporary validator parsed the flushed JSONL trace and wrote a schema-readable result, but exited non-zero with the mechanical result `BLOCKED`. Criteria 1, 2, 3, 4, 5, 9, and 10 were mechanically satisfied. Criteria 6, 7, and 8 were mechanically unsatisfied because C never reached its hook; those results cannot be promoted to capability evidence under the fixed harness-failure boundary.

#### Criterion-by-criterion result

| Fixed PASS criterion | Result |
| --- | --- |
| 1. Supported-host version/source/declarations verified | PASS for the completed preflight |
| 2. R rollback leaves no state | PASS |
| 3. Same-session A/B lifecycle | PASS |
| 4. A rollback preserves B suppression | PASS |
| 5. B routing mutations precede release idle | PASS |
| 6. C window between B idle and old completion | Not evaluated; C dispatch failed in the harness |
| 7. Old B completion has zero C-state effect | Not evaluated; C never owned the slot |
| 8. C completes independently | Not evaluated |
| 9. A/B suppression and one-slot bound | PASS for the observed state machine |
| 10. Schema-valid flushed trace | PASS; disposal sentinel and validator completed |

#### Final classification

`SESSION-SAFETY-1 = execution/harness failure`

`SESSION-SAFETY-1` remains **UNPROVEN**. Option D remains **NOT ADOPTED** and production implementation remains **BLOCKED**. The mechanical validator's `BLOCKED` output is not a capability result because the required C command could not reach `command.execute.before`. Task 4.0 remains immutable `BLOCKED` evidence for the old per-invocation candidate.
