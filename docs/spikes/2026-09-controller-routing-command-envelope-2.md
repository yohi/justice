# Controller Routing Command Envelope 2 Spike

## Authority and scope

- Baseline HEAD: `80beb1c33cc0e6e3ad59a6ce5b3acc6157e7bc93`
- Branch: `feature/semantic-control-plane-plan`
- Baseline remote: `origin/feature/semantic-control-plane-plan` at the same HEAD
- Execution-agent model: `openai/gpt-5.6-terra`
- Execution-agent reasoning level: `high`
- Supported host: OpenCode `1.18.29`
- Pinned host source: `16747470f976aca3d362ad730bcd3fe82ecc2c9a`
- Repository plugin and SDK assumptions: `@opencode-ai/plugin` and `@opencode-ai/sdk` compatible with the repository declarations at `1.14.21`
- Required temporary runtime model: `JUSTICE_HOST_TEST_MODEL=opencode/mimo-v2.5-free`
- Scope: `COMMAND-ENVELOPE-2`, an independent same-session foreign-activity capability experiment for Option G

`COMMAND-ENVELOPE-1 = PASS` remains fixed within its original scope and is neither rerun nor reclassified. Task 4.0, `SESSION-SAFETY-1`, and `COMMAND-TERMINAL-1` remain immutable historical evidence. Option D and Option F remain not adopted. This artifact is execution authority only for this spike; it does not authorize production implementation.

The temporary host checkout, probe, barrier, trace, and validator live only outside this repository. This spike does not authorize changes to production source, production tests, production configuration, CI, package metadata, lockfiles, native code, or Issue #228.

## RG-010 statement

Option G currently treats a pinned command lifecycle as:

```text
command.execute.before
-> active candidate
-> finalized assistant
-> matching command.executed
-> release
```

The supported host routes both direct prompts and commands through the same session runner. Therefore a direct prompt or non-pinned command may overlap a pinned candidate, and a foreign/shared assistant may be observed before the pinned command's terminal event. The capability under test is whether this can be detected or fail-closed before a foreign controller is attributed to the pinned workflow.

## Non-goals

- Do not reinterpret, rescue, or invalidate `COMMAND-ENVELOPE-1`.
- Do not implement Option G or any alternative in production code.
- Do not treat routing-fidelity loss that disables the clean pinned positive path as PASS.
- Do not use content, command arguments, user-visible markers, FIFO, event order, timing, elapsed time, TTL, timer, retry, scheduling, session current/latest lookup, desired-controller reverse lookup, or a locally generated identity as correctness authority.
- Do not use undocumented object identity or `Symbol` side channels.
- Do not use `session.idle` or session status as invocation, release, suppression-clear, or cleanup correctness authority.
- Do not propose, adopt, or formalize a successor option in this spike.

## Fixed hypothesis

On exact OpenCode `1.18.29`, using only its public plugin/lifecycle surface, same-session foreign activity that can affect a pinned Option G envelope--a direct prompt or non-pinned command--can be safely detected or fail-closed before any routing-mutating or finalized observation is attributed to the pinned candidate.

The detection must use stable host-provided fields, must preserve a clean pinned command's normal Option G positive path, must not use a prohibited heuristic, and must retain O(1) session-scoped state. It must exclude wrong cross-invocation routing attribution even where the runner shares or returns a foreign assistant lineage.

## Host-observability assumptions fixed before runtime

The exact pinned source is the only source authority for the following surface matrix. `yes` means the source/type exposes the field; it does not claim that the field joins a command invocation to a prompt invocation.

| Surface | Stable session | Command | User message | Assistant message | Origin/invocation |
| --- | --- | --- | --- | --- | --- |
| `command.execute.before` | yes | yes | no | no | no |
| `chat.message` | yes | no | yes | no | no |
| `chat.params` | yes | no | yes | no | no |
| finalized `message.updated` | yes | no | no | yes | no |
| `command.executed` | yes | yes | no | yes | no |

Exact source support is limited to these fields:

- `packages/plugin/src/index.ts`: `command.execute.before.input.command`, `.sessionID`, `.arguments`; `chat.message.input.sessionID`, optional `.messageID`, and `output.message`; `chat.params.input.sessionID`, `.agent`, and `.message`.
- `packages/schema/src/v1/session.ts`: `message.updated.properties.sessionID` and `.info`.
- `packages/schema/src/v1/legacy-event.ts`: `command.executed.name`, `.sessionID`, `.arguments`, and `.messageID`.
- `packages/opencode/src/session/prompt.ts`: command triggers `command.execute.before`, calls `prompt(...)`, then publishes `command.executed.messageID = result.info.id`; `prompt(...)` triggers `chat.message`.
- `packages/opencode/src/session/run-state.ts` and `packages/opencode/src/effect/runner.ts`: per-session `ensureRunning()` delegates a later request in `Running` state to the existing run's completion rather than supplying a per-request identity.

No listed public surface contains a stable shared command-to-prompt invocation ID or an origin kind. The runtime probe must validate that this absence cannot be safely compensated by another public field.

## Fixed runtime cases

### B0: Clean pinned control

```text
A command.execute.before
-> A own prompt lifecycle
-> A finalized assistant
-> A matching command.executed
-> clean envelope
-> release
```

Verify that A's own `chat.message`, `chat.params`, and finalized `message.updated` are not classified as foreign activity.

### P1: Pinned-before then direct prompt

```text
A command.execute.before
-> A provisional active
-> deterministic harness barrier
-> P direct prompt begins in the same session
-> P lifecycle begins
-> release A prompt path
```

Observe whether foreign activity is detected before attribution, whether A is suppressed, whether P's finalized assistant can be mistaken for A, whether A terminal equals P/shared assistant, and whether an authoritative A record is emitted. The barrier creates this interleaving only; it is not runtime correctness logic.

### P2: Direct prompt already running then pinned command

```text
P direct prompt begins
-> P same-session runner active
-> A pinned command.execute.before
-> A attempts Option G envelope
```

Observe safe foreign-run detection, candidate acquisition, runner sharing/awaiting, command-terminal relation to the foreign/shared assistant, fail-closed behavior, and authoritative-record emission.

### U1: Active pinned then non-pinned command

```text
A pinned begin
-> active(A)
-> U non-pinned command.execute.before in the same session
```

Observe U-before visibility, no second routing owner, immediate sticky suppression before unsafe attribution, and no later terminal clearing of suppression.

### U2: Non-pinned command active then pinned command

```text
U non-pinned command begins
-> same-session command lifecycle active
-> A pinned command.execute.before
```

Observe whether a bounded safe state can establish U activity and fail-close A. No unbounded command map, FIFO, TTL, or event-order matching is permitted.

### P3: Clean prompt before pinned command

Run and complete P before A begins. Determine whether any recovery follows a safe lifecycle authority rather than a guessed idle/quiescence boundary. If safe recovery cannot be defined, record the resulting routing-fidelity degradation without guessing a clear.

## Fixed PASS criteria

1. Exact OpenCode `1.18.29`, pinned source, plugin/SDK assumptions, and required runtime model are confirmed.
2. B0 clean pinned command forms a clean Option G envelope with the guard present.
3. P1 direct activity never cross-applies to A routing attribution.
4. P1 foreign/direct assistant never joins A terminal, or deterministic suppression happens before attribution.
5. P2 detects already-running direct-prompt ambiguity and fails closed deterministically.
6. P2 never emits a foreign/shared assistant as A's authoritative routing record.
7. U1 immediately fails closed for active pinned plus non-pinned-command overlap.
8. U2 safely fails closed for active non-pinned command plus pinned arrival with bounded state.
9. P3 handling is defined by safe lifecycle authority.
10. The direct-prompt detector does not classify B0's own lifecycle as foreign.
11. Foreign activity discrimination uses stable host-provided fields.
12. No prohibited heuristic or marker is correctness authority.
13. Session state is O(1) bounded.
14. `session.idle` is not invocation or release correctness authority.
15. Wrong cross-invocation routing attribution is excluded.
16. Runtime traces are complete, redacted, allowlisted, flushed, and schema-valid.
17. Decisive harness failure count is zero.

Only all seventeen criteria permit `COMMAND-ENVELOPE-2 = PASS` and `RG-010 = RESOLVED`.

## Fixed BLOCKED criteria

With a complete valid execution, classify `COMMAND-ENVELOPE-2 = BLOCKED` and `RG-010 = CONFIRMED` if public host fields cannot distinguish a direct prompt from the pinned command's own prompt lifecycle, if an A terminal can match a foreign/shared finalized assistant without a safe discriminator, if safety permanently suppresses the clean B0 path, or if satisfying the hypothesis needs a prohibited heuristic, a marker, an undocumented side channel, upstream change, route interception, serialization, or stable invocation identity.

## Harness-failure boundary

Probe syntax/runtime defects, barrier defects, server startup failure, request-shape failure, model/provider failure, incomplete required case, trace flush failure, validator defect, or schema-invalid evidence are `execution/harness failure`, not capability BLOCKED. Partial traces cannot be promoted to a capability classification; the result in that case is `COMMAND-ENVELOPE-2 = execution/harness failure` and `RG-010 = UNRESOLVED`.

## Evidence hygiene

Persist only fixed case labels, event kinds, relative ordering, boolean relations, bounded counts, state transitions, and allowlisted declarations. In particular, traces may use `assistantBelongsToForeignRun`, `terminalMatchesForeignAssistant`, `foreignActivityDetected`, `suppressedBeforeAttribution`, and `authoritativeRecordEmitted` booleans.

Do not persist raw session IDs, message IDs, arguments, prompt text, message text, model output, raw errors, credentials, tokens, process IDs, absolute scratch paths, or raw event payloads. Raw values may exist only in temporary process memory for equality checks.

## Pre-execution status

```text
Task 4.0 = COMPLETED / BLOCKED
SESSION-SAFETY-1 = BLOCKED
COMMAND-TERMINAL-1 = BLOCKED
Option D = NOT ADOPTED
Option F = NOT ADOPTED
COMMAND-ENVELOPE-1 = PASS within original fixed scope
Option G = FORMALIZED FOR DOCUMENT REVIEW ONLY
Independent review = CHANGES REQUIRED
RG-010 = BLOCKER
RG-011 = provenance correction permitted only
Task 4.1G = NOT EXECUTABLE
Task 4.2G = NOT EXECUTABLE
production = BLOCKED
```

The preceding sections are frozen before runtime execution. Post-execution additions are limited to execution result, redacted observations, validator result, criterion results, final classification, and the required authority synchronization.

## Runtime execution and redacted results

The scratch host checkout reported OpenCode `1.18.29` at pinned source `16747470f976aca3d362ad730bcd3fe82ecc2c9a`. Each case used a fresh server and session, the required runtime model `opencode/mimo-v2.5-free`, a file-loaded public plugin, and the documented HTTP session routes. The plugin's deterministic Promise barriers only established P1/P2/U1/U2 interleavings; no barrier result was used as routing correctness authority.

The probe persisted only the allowlisted booleans and bounded event ordering listed above. A separate validator accepted all six traces as complete, schema-valid, allowlisted, and flushed. The initial validator omitted the already-allowlisted `belongsToForeign` boolean, was corrected, and then validated the unchanged trace. This was a validator implementation defect, not a capability result. Decisive harness failure count is zero.

| Case | Redacted observed ordering and result |
| --- | --- |
| B0 | pinned before acquired; own `chat.message` and `chat.params`; own assistant finalized; terminal matched own assistant; authoritative record would emit. The public fields could not distinguish that own lifecycle from a direct-prompt lifecycle. |
| P1 | pinned A before acquired; foreign direct P `chat.message`/`chat.params`; foreign P assistant finalized while A remained active; A own lifecycle then finalized; A terminal matched A assistant; authoritative A record would emit. `foreignActivityDetected=false`, `hasStableSharedInvocationId=false`, and `ownPinnedCouldBeDistinguished=false` at the only relevant public prompt surfaces. |
| P2 | direct P `chat.message`/`chat.params`; A pinned before acquired; P assistant finalized while A remained active; A own assistant then finalized; A terminal matched A assistant; authoritative A record would emit. Source proves the same-session runner's `ensureRunning()` awaits an existing run, but the public lifecycle callback supplies no origin/invocation discriminator for this collision. |
| U1 | pinned A before acquired; non-pinned U before observed; state became sticky suppressed before prompt attribution; neither terminal emitted an authoritative record. |
| U2 | non-pinned U before observed; subsequent pinned A before caused sticky suppression with no second owner; neither terminal emitted an authoritative record. |
| P3 | completed direct P lifecycle preceded A; A acquired and completed a clean terminal envelope. This is observationally safe only because P completed before A arrived; no safe public cleanup/recovery authority exists to distinguish an active direct P from B0's own prompt lifecycle. `session.idle` and status remained observation-only. |

The P1/P2 assistant-terminal relation in these runs was `terminalMatchesForeignAssistant=false` and `terminalMatchesPinnedAssistant=true`. That non-shared terminal outcome does not resolve RG-010: before finalization and terminal matching, the public surface exposed no stable field by which a production detector could distinguish foreign direct P from A's own required prompt lifecycle. Treating the first or next lifecycle event as A would use prohibited event-order inference. Suppressing every active `chat.message` would suppress B0 as well.

## Criterion result

| Criterion | Result | Evidence |
| --- | --- | --- |
| 1 | PASS | Exact source/version and required runtime model confirmed. |
| 2 | PASS | B0 acquired, finalized, terminal-matched, and released. |
| 3 | BLOCKED | P1 foreign direct activity was observable but had no stable public discriminator before attribution. |
| 4 | BLOCKED | P1's observed non-shared terminal cannot establish a general safe detector before attribution. |
| 5 | BLOCKED | P2 admitted A while P was already active because the host provided no foreign-run discriminator. |
| 6 | BLOCKED | P2's observed terminal was not foreign, but a detector cannot prove that before routing-mutating/finalized observation. |
| 7 | PASS | U1 entered sticky suppression before unsafe attribution. |
| 8 | PASS | U2 entered sticky suppression with one O(1) session guard. |
| 9 | BLOCKED | P3 demonstrates only completed history; no safe lifecycle authority exists for distinguishing an active direct run or safely clearing a direct-activity guard. |
| 10 | BLOCKED | B0 own `chat.message`/`chat.params` have the same public discriminator absence as P1/P2 direct activity. |
| 11 | BLOCKED | No stable host-provided direct-versus-pinned invocation/origin field exists. |
| 12 | PASS | The probe used no content/argument/FIFO/timing/TTL/current/latest/reverse-lookup/local-ID correctness authority. |
| 13 | PASS | Command-only guard is a single bounded session state; it cannot cure direct-prompt ambiguity. |
| 14 | PASS | `session.idle` and status were persisted only as `releaseAuthority=false` and `cleanupAuthority=false`. |
| 15 | BLOCKED | Wrong cross-invocation attribution cannot be excluded on the supported public surface. |
| 16 | PASS | Six complete redacted allowlisted schema-valid traces validated. |
| 17 | PASS | Decisive harness failure count is zero. |

## Classification

```text
COMMAND-ENVELOPE-1 = PASS within original fixed scope
COMMAND-ENVELOPE-2 = BLOCKED
RG-010 = CONFIRMED
Option G = NOT AUTHORIZED AS PRODUCTION SUCCESSOR
Task 4.1G = BLOCKED / NOT EXECUTABLE
Task 4.2G = BLOCKED / NOT EXECUTABLE
production = BLOCKED
```

The decisive failure is a capability failure, not a harness failure. Exact OpenCode `1.18.29` exposes `sessionID` plus message-specific IDs, but no stable shared command-to-prompt invocation ID or origin kind. A direct prompt and a clean pinned command both generate the same relevant public lifecycle shape. A safe direct-activity detector would therefore either require a prohibited heuristic/marker/side channel or suppress B0's required positive path. No successor mechanism is proposed or adopted here.
