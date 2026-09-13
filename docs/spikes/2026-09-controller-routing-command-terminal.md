# Controller Routing Command-Terminal Spike

## Authority and scope

- Baseline HEAD: `dfd2f9f535824b854fac0f8dc8886a59603b03f3`
- Branch: `feature/semantic-control-plane-plan`
- Supported host: OpenCode `1.18.29`
- Pinned host source: `16747470f976aca3d362ad730bcd3fe82ecc2c9a`
- Scope: Option F successor capability only
- Required runtime model: `JUSTICE_HOST_TEST_MODEL=opencode/mimo-v2.5-free`
- Prior evidence: Task 4.0 and `SESSION-SAFETY-1` remain immutable historical evidence.
- Issue #228 is a non-authoritative design tracker. This artifact is the execution authority for this spike only.

This artifact does not authorize production source, production tests, production configuration, CI, release, package or lockfile changes, native/Rust changes, or changes to Task 4.0 / `SESSION-SAFETY-1` evidence. The temporary probe and validator live only in scratch space outside the repository.

## Non-goals

- Do not implement Option F in `src/**` or production tests.
- Do not reuse `session.idle` as ownership release or cleanup authority.
- Do not re-run, overwrite, or reinterpret Task 4.0 or `SESSION-SAFETY-1`.
- Do not use a fallback model, provider, alias, package, or host version.
- Do not infer invocation identity from content, arguments, timing, queue order, or event arrival order.

## Fixed capability hypothesis

On the exact supported host, a matching `command.executed` can be a terminal fence for a clean successful command. Every overlap, incomplete terminal chain, mismatch, or ambiguity instead enters sticky fail-closed suppression. This may preserve only session-scoped O(1) state and still prevent cross-invocation routing misattribution without treating `session.idle` as correctness authority.

## Fixed state model

```text
idle
  |
  | command.execute.before while idle
  v
active(clean candidate)
  |
  | fully matched successful command.executed
  v
idle

active
  |
  | overlap / correlation anomaly / incomplete terminal
  v
suppressed(sticky)
  |
  | session removal only
  v
removed
```

The candidate state per session is at most one slot. There is no queue. A hook-local synchronous failure may roll back only its own provisional acquisition. Suppression established by another invocation is never rolled back by that failure.

`chat.params` and finalized `message.updated` build observations only. They do not create durable `applied`. A clean active candidate may commit/release only when all terminal-chain predicates hold:

```text
active
AND captured command name == command.executed.name
AND finalized assistant observation exists
AND command.executed.messageID == finalized assistant message ID
AND not suppressed
AND not ambiguous
```

In suppressed state, `command.executed`, `session.idle`, message events, and other events are observation-only. They cannot clear, release, consume, finalize, or overwrite suppression. A missing terminal never releases active state by elapsed time, timer, TTL, or `session.idle`. A later command converts stale uncertainty to sticky suppression. Only session removal / `removeSession()` clears it. A removed session state must not be reused.

## Fixed runtime cases

### N: nominal success

```text
N command.execute.before
→ N chat.params
→ N finalized message.updated
→ N command.executed
→ C command.execute.before
```

Verify captured command name equals `command.executed.name`, finalized assistant message ID equals `command.executed.messageID`, and the matching terminal fence releases to `idle`. Verify that any post-terminal N routing-mutating event cannot be safely applied to C; if it cannot be distinguished from C without a stable identity, classify the capability as BLOCKED. Verify C acquires clean ownership after N release.

### O: overlap before terminal fence

```text
A command.execute.before
→ A active
→ B command.execute.before before A matching command.executed
→ suppressed
```

Verify immediate suppression, no second ownership, no queue, no FIFO reassignment, no guessed A/B attribution, no `applied` even when actual equals desired, and no suppression release from late A/B terminal events, `session.idle`, or other events.

### F: post-before nonterminal failure

After `command.execute.before` succeeds, inject a deterministic temporary probe failure in `chat.params` or an equivalent post-before hook. Verify no matching `command.executed` occurs. Active uncertainty must not be released by `session.idle`, TTL, timer, or elapsed time. The next command must transition the session to sticky suppression and must not receive stale capture or desired-controller attribution.

### R: hook-local synchronous rollback

Inject a deterministic synchronous failure after provisional acquisition inside `command.execute.before`. Verify `r_acquired → r_rolled_back`, `owned = false`, and `suppressed = false`. When suppression already exists from another invocation, verify this rollback does not clear it.

### Removal

Create sticky suppression, remove the session, and verify `suppressed → removed`. Verify a later event or reused session identifier cannot reuse the removed state.

## Fixed PASS criteria

All criteria must hold in one complete exact-host execution.

1. Exact OpenCode version, pinned source, plugin/SDK assumptions, and required model are verified without fallback.
2. Nominal N has finalized routing observation before matching `command.executed`.
3. `command.executed.name` equals the captured command name.
4. `command.executed.messageID` equals the finalized assistant message ID.
5. Matching terminal fence commits/releases N to `idle`.
6. Any post-terminal N routing-mutating event is either safely distinguished from a new candidate or the capability is BLOCKED; event order alone is not used.
7. C acquires clean ownership after N terminal release.
8. O overlap immediately enters sticky `suppressed`, creates no second owner or queue, and never guesses A/B attribution.
9. Late terminal, idle, message, and event observations do not clear O suppression; ambiguous O produces no `applied`, including actual-equals-desired.
10. F has no matching `command.executed`; stale active state is not released by idle, TTL, timer, or elapsed time; next command enters suppression and receives no stale capture.
11. R rolls back only its hook-local provisional acquisition and does not clear another invocation's suppression.
12. Session removal is the only suppression cleanup authority and removed state is not reused.
13. State is O(1) per session; no FIFO, TTL, timer, content, arguments, latest/current workflow, desired-controller reverse lookup, local generation, or event-order heuristic is identity authority.
14. The complete trace is allowlisted, schema-valid, redacted, and flushed/disposed before validation.

Only when every criterion is satisfied is `COMMAND-TERMINAL-1 = PASS`.

## Fixed BLOCKED criteria

With complete and valid execution, classify `COMMAND-TERMINAL-1 = BLOCKED` if any of the following holds:

- A post-terminal routing-mutating event cannot be safely distinguished from a new clean candidate.
- Command name plus result message ID cannot close a clean terminal chain.
- Overlap cannot immediately converge to sticky suppression.
- Late terminal or idle events must clear suppression.
- Post-before failure cannot converge safely to suppression when the next command arrives.
- Normal reuse requires `session.idle`, TTL, FIFO, elapsed time, content, arguments, or another prohibited correctness heuristic.
- A stable invocation ID not supplied by the host remains necessary for audit correctness.
- O(1) per-session state cannot be maintained.
- Wrong cross-invocation attribution cannot be excluded.

## Harness-failure boundary

The following are `execution/harness failure`, not capability `BLOCKED`: temporary probe syntax/runtime failure, model/provider failure, server startup failure, request-shape failure, incomplete required case, trace flush/disposal failure, validator failure, malformed or missing evidence, or schema-invalid trace. Partial traces are not capability evidence and must not be promoted to PASS or BLOCKED.

## Evidence hygiene

The artifact may record fixed case labels, event kinds, boolean predicates, bounded counts, relative ordering, command-name equality, message-ID equality, state transitions, criterion results, version/source declarations, and validator/flush status.

It must not record prompt or message content, arguments, raw session/message IDs, raw event objects, credentials, tokens, provider secrets, PID, absolute local paths, or model responses. The required model name is recorded only as the fixed environment contract; secrets and raw host output are excluded.

## Pre-execution status

```text
Option F = PROVISIONAL SUCCESSOR CANDIDATE
          = NOT SPECIFICATION AUTHORITY
Requirements = unchanged / authoritative
Task 4.1 = SUSPENDED / NOT EXECUTABLE
Task 4.2 = SUSPENDED / NOT EXECUTABLE
production implementation = BLOCKED
```

The criteria above are fixed before runtime execution and must not be changed after observations are collected.

## Execution result

- Runtime execution completed for N, O, F, R, and Removal on the exact supported host.
- The redacted traces were allowlisted, schema-valid, flushed, and disposed before validation.
- `HARNESS_FAILURE_COUNT = 0`.
- `COMMAND-TERMINAL-1 = BLOCKED`.
- `OPTION_F = NOT ADOPTED`.
- Criteria 1-9 and 11-14 passed. Criterion 10 is blocked.
- In F, the post-before probe produced a finalized failed assistant observation, but the host still published one matching `command.executed`. The next command entered sticky suppression, but the required missing-terminal condition was not satisfied.
- This is a capability result, not a harness failure: the exact host's fail-open command path does not provide the required post-before terminal absence.
- Production implementation remains blocked. Requirements, Task 4.0, `SESSION-SAFETY-1`, Design, and Plan remain unchanged.
