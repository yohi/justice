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
