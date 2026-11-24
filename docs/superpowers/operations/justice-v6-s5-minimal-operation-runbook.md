# Justice v6 S5 Minimal Operation Runbook

This runbook defines the bounded operation of Justice v6 that has actually
been accepted and demonstrated in S5. It is guidance for the Human Owner, not
a runtime approval object, a Gate state, or a product status field.

Current state (2026-11-24): AC-H01, AC-H02 and AC-H03 are `PASS` (Human Owner
adopted). The H3 limited V2 plugin runtime check is `PASS`. **Opt-in has not
been approved** (`RELEASE_APPROVED=PENDING`), so nothing is enabled by this
runbook. Default is OFF.

Only operations that S5 evidence actually demonstrated are described as
available. Anything else is listed as unsupported or unverified. This runbook
does not establish any new execution method.

Related documents:

- Acceptance record: `docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md`
- Owner decision: `docs/superpowers/decisions/justice-v6-s5-owner-completion-decision.md`
- Requirements: `docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md`
  (D-S5-03 explicit Owner Opt-in, D-S5-04 fail-closed with limited blast radius, D-S5-08 existing Host)

## 1. Target of the bounded operation

| Item | Value |
| --- | --- |
| Host | Existing Ubuntu `coreultra7-270k` (D-S5-08 logical separation) |
| OpenCode | V2.3.2, real binary SHA-256 `e6543f6e5c39c40971ba38afd1819ac852c29ac735b5a89065d3d148d47f27ad` |
| Justice | master `896acee25323c0e5b6dc97e0dd936efff1b9e434` |
| V2 plugin Artifact | Package directory containing the `896acee2` `package.json` and the isolated build's `dist/`. `exports["./server"]` points to `dist/opencode-v2-plugin.js`, SHA-256 `b2130a6d27e04a460ef3c7340994b703121b5cd001a2cbb78ad0b9165da0b855`. |
| Scope | Adopted bounded S1, S2, S3 (D-S5-01) |
| Demonstrated functions | (a) `justice_review` through OpenCode V2 Native **Code Mode**: view the review summary; resolve is denied fail-closed. (b) Existing S2-b Offline READ_ONLY Adapter → S1-d diagnostic over a saved Source wrapper and explicit Correlation, run outside OpenCode. (c) S3-b single-writer Decision/Lifecycle consistency recovery of the Justice core (`JusticePlugin.initialize()`), demonstrated with the T14/T16 harness. |

Important scoping of (c): the V2 entry registers only `justice_review`. It
does not port the V1 hooks that produce task lifecycle and review events. In
an OpenCode V2 session, S3-b recovery is therefore a bounded guarantee of the
Justice core when it initializes over existing durable state. It is not an
active V2 workflow.

## 2. Prerequisites for Opt-in (all must hold; otherwise do not operate)

Absence of confirmation is never read as satisfaction.

| Item | Required condition | Status |
| --- | --- | --- |
| Acceptance | AC-H01..H03 `PASS` with `observed`/`derived` evidence | Met (Owner adopted 2026-11-24) |
| Owner Opt-in | Explicit Human Owner approval naming Host, Version, Scope and Operation (D-S5-03) | **Not given** (`RELEASE_APPROVED=PENDING`) |
| Host / Version | Host above. The OpenCode binary SHA-256 must match before every start. | Fixed |
| Artifact identity | `dist/opencode-v2-plugin.js` SHA-256 `b2130a6d…` verified before start; staged directory read-only during use | Fixed |
| Dedicated config/state | Dedicated `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` and `TMPDIR`; `JUSTICE_GLOBAL_WISDOM_PATH` inside the dedicated root; dedicated workspace for the local `.justice`; never the shared OpenCode config/state or `~/.justice` | Pattern demonstrated (H3RT) |
| Network / credentials | The demonstrated boundary has no external network, no credentials, and a loopback mock/scripted provider only. Any real LLM provider requires network egress and credentials, which S5 did not demonstrate. | Demonstrated only without network/credentials |
| Default | OFF; nothing is installed into the shared OpenCode setup | OFF |

## 3. Explanatory states

Operational explanation only; not a Justice runtime state or schema.

```text
PREPARED -> ACCEPTANCE_VERIFIED -> OPT_IN_APPROVED -> ENABLED -> STOPPED / ROLLED_BACK
```

| State | Current | Leaving it requires |
| --- | --- | --- |
| PREPARED | done | — |
| ACCEPTANCE_VERIFIED | **current** (AC-H01..H03 `PASS`) | Owner Opt-in decision |
| OPT_IN_APPROVED | not reached | Owner records Host / Version / Scope / Operation and the environment boundary |
| ENABLED | not reached | Start by the procedure in section 4 only |
| STOPPED / ROLLED_BACK | — | Owner decision to resume or re-Opt-in |

## 4. Enable procedure (demonstrated pattern; only after Owner Opt-in)

This is the pattern demonstrated in H3RT. Do not substitute other mechanisms
as if they were verified.

1. Verify the OpenCode binary SHA-256 and the V2 Artifact SHA-256.
2. Use a dedicated root that holds the config, data, state, cache, tmp,
   workspace and global-wisdom paths. Check that it is owner-only (`0700`), has
   no symlinks and does not overlap shared state.
3. Save the dedicated `opencode.json` byte-exact and record its SHA-256 as the
   rollback point.
4. Register the plugin with the **absolute path of the staged package
   directory**: `"plugins": ["<absolute staged dir>"]`. OpenCode v2.3.2 accepts
   only directories here; a file path is rejected. The loader resolves
   `@yohi/justice/server` first; a fallback to the V1 root entry is not
   acceptable.
5. Start OpenCode with the dedicated environment only (`env -i` style
   allowlist). Do not attach to or reuse the shared OpenCode V2 service.
6. Confirm `GET /api/plugin` reports `id=justice`, `source.type=local`, the
   staged path, and `status=active`. `active` alone does not prove the tool was
   registered (setup is fail-open). Confirm `justice_review` appears in the
   Code Mode catalog.

The bwrap user/net/pid/ipc isolation used in H3RT is the **verification
isolation**. Running with network egress, credentials or a real provider is
an environment change that S5 has not demonstrated. It requires the Owner's
explicit Opt-in decision covering that boundary.

## 5. Usage (demonstrated paths only)

| Function | How | Notes |
| --- | --- | --- |
| Review summary | Inside OpenCode Code Mode `execute`: `return await tools.justice_review({})` (optionally `{ scope: "<scope>" }`) | Read-only view of the local Observation Log projection. On first use Justice initializes lazily and writes the dedicated workspace `.justice/state.json`. |
| Review resolve | `tools.justice_review({ scope, resolve: { itemKeys, artifactRef } })` | **Always denied** in V2 (`Review resolution was not approved.`), because the V2 ToolContext has no approval channel. Findings stay open. |
| S2-b / S1-d diagnostic | Existing `runS2bOfflineAdapter` over a saved `justice-s2b-source-v1` wrapper, an explicit `justice-s2b-correlation-v1` Correlation, and an Owner-fixed Manifest/TaskIntent (as in T12/T16) | Offline READ_ONLY. Fix the TaskIntent and Correlation rule **before** acquiring a Source; post-execution mapping does not establish attribution. |

Not available in V2 (do not describe as usable): `/justice-*` commands,
`justice_start` / implementation arm, V1 hooks (`event`, `chat.*`,
`tool.execute.before/after`, `command.execute.before`), Host pre-execution
enforcement, and resolve approval.

## 6. Stop and rollback (demonstrated in H3RT)

1. **Identify only the dedicated unit.** Record the supervisor/bwrap PID, its
   start time and executable, and the PID-namespace inode of the dedicated
   unit. Never select targets by process name, binary path or arguments
   alone. Shared OpenCode V2 processes use the same binary path.
2. **Stop.** Terminate the dedicated server and helpers inside the unit, then
   let the PID namespace tear down. Afterwards, verify that no process remains
   in the recorded namespace and that none has its cwd under the dedicated
   root. If the identity cannot be confirmed, send no signal and hold
   (fail-closed).
3. **Roll back the config.** Restore the saved `opencode.json` bytes
   atomically and verify the SHA-256 against the rollback point.
4. **Preserve state.** Keep the dedicated state and evidence. Delete nothing
   without a separate Owner decision.
5. **Non-interference.** Confirm that shared OpenCode processes (PID and start
   time) and `~/.justice/wisdom.json` are unchanged. Changes in shared OpenCode
   data directories may come from concurrently running shared instances. Do not
   attribute them to Justice without evidence.

## 7. Stop table (fail-closed with limited blast radius)

Host pre-execution enforcement is **not proven**. The holds below are
Justice-side non-acceptance and non-progression, not proof that Host execution
was prevented.

| Condition | Affected target | Operations stopped or held | Independent normal work may continue when |
| --- | --- | --- | --- |
| Binary or Artifact digest mismatch | The whole Justice operation | Do not start; if running, stop per section 6 | Work that does not use Justice |
| Plugin not `active` / tool not in the Code Mode catalog | Justice review | Treat Justice as inactive; do not claim review coverage | Normal OpenCode work |
| Source missing / Correlation not established | Task whose Evidence depends on it | No success assertion; Evidence stays `UNKNOWN` | Work not depending on that Source |
| Authority mismatch or unverified | The approval or state change | Rejected or held (resolve is always denied in V2) | Work needing no such approval |
| Lifecycle inconsistency | The affected Task / Plan | Progression held | Tasks not sharing the inconsistent records |
| Unexpected side effect or write outside the dedicated root | The Operation | Stop per section 6; inform the Owner; no Live Tool replay | Work isolated from the touched target |
| Stop identity not confirmable / rollback impossible | Everything affected | Hold; no further destructive action | Only targets proven unaffected |

## 8. Known limitations

- V2 resolve is denied (no approval channel). V1-equivalent commands, hooks
  and the implementation arm are not ported.
- `justice_review` is reachable via Code Mode. OpenCode's Code-Mode-disabled
  direct-exposure fallback is unverified for Justice.
- Host pre-execution enforcement is unproven.
- S2-c is `COMPARISON_NOT_ESTABLISHED`.
- Multi-writer / multi-process recovery is out of scope.
- S3-a M-2 and the Legacy Staging recovery limits apply.
- The Global Wisdom write path was not exercised at runtime. The host-provided
  `effect` version is unverified.
- Real LLM providers and credentialed / networked environments were not
  demonstrated.
- See section 5 of the acceptance record for the full list.

## 9. Historical material

The older local, untracked S5 Design R0.1 and Host Execution Manifest R0.1
assumed an isolated OpenCode 2.2.5 Host. They are **historical only** and are
not used for this fixed 2.3.2 bounded operation. Do not create tracked files at
their paths; they are left unmodified.

## 10. Completion terms

This runbook does not establish `BOUNDED_COMPLETE` or `RELEASE_APPROVED`.
`BOUNDED_COMPLETE` does not imply `RELEASE_APPROVED`, which is an independent
Owner Opt-in decision for a designated environment. Both are `PENDING`.
