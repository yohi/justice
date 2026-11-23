# Justice v6 S5 — D-S5-08 / OpenCode 2.3.2 Bounded Design Addendum

**Repository:** yohi/justice  
**Issues:** [#358](https://github.com/yohi/justice/issues/358), [#388](https://github.com/yohi/justice/issues/388)  
**Reference baseline:** master@d644734090aa4ad8cadbefd2d78908067fe36931  
**Inputs:** S5 Brainstorming Requirements R0.1 (D-S5-01〜07), local Design R0.1 and Host Execution Manifest R0.1 provided by Human Owner, and D-S5-08 (Owner-selected host boundary)  
**Disposition:** `DESIGN_ADDENDUM_CANDIDATE / OWNER_ADOPTION_PENDING / HOST_GO_HOLD / AC_H01_H03_NOT_RUN / RELEASE_NOT_AUTHORIZED`  
**Authority:** D-S5-08 and approach A were selected during brainstorming. This document records the proposal; it does not authorize implementation, Host acceptance execution, configuration changes, GitHub Issue updates, or release.

## 1. Goal, scope, and non-goals

Use the existing Ubuntu host's existing OpenCode V2 to establish bounded real-Host evidence for the adopted S1/S2/S3 portions of Justice v6. Reuse the existing S1-d diagnostic, S2-b READ_ONLY offline adapter, and adopted single-process S3-b Decision/Lifecycle recovery. Completion is an explicit Human Owner decision; opt-in release is a distinct approval.

Do not create a VM, libvirt guest, Docker Sandbox, or other dedicated virtual environment. Do not implement S3-c Host Enforcement, S4 orchestration, a new collector/router/recovery engine, multi-process recovery, arbitrary Semantic Recovery, external tool side-effect replay, full-history authenticity/completeness guarantees, or Native-only superiority claims. Finding zero is not an acceptance condition.

This addendum does not silently adopt the earlier untracked local Design R0.1 or Host Execution Manifest R0.1, and does not alter the three documents merged in PR #394. Only their host/version assumptions require bounded reconciliation if this addendum is adopted.

## 2. D-S5-08 — existing-host boundary

| Property | Chosen boundary / observed status |
| --- | --- |
| Host | Existing Ubuntu host `coreultra7-270k`; physical identity beyond the supplied hostname not independently established |
| Launcher | `~/.local/bin/opencode2`; Bash syntax and launcher properties observed by Owner |
| OpenCode V2 | Executable printed `opencode v2.3.2`; target `~/.local/opt/opencode-v2-2.3.2/node_modules/.bin/opencode` |
| OpenCode binary SHA-256 | `NOT_MEASURED`; required before any Host GO |
| Launcher SHA-256 | `cb68ec584b3e5e81ca7c2c2ca6a612d56a44672154bf510bf7a1468adee450d1` (Owner-supplied observation) |
| Justice baseline | `d644734090aa4ad8cadbefd2d78908067fe36931` (Owner-supplied checkout HEAD, same as PR #394 merge) |
| Working tree | Two untracked S5 Markdown files reported; preserve without overwrite or cleanup |
| OpenCode configuration | Private V2 XDG paths; `--standalone`; project config disabled by default; 0 explicit `plugin`/`plugins` entries in inspected JSON |
| Isolation | Dedicated Justice v6 working directory, Session, Task/Plan, fixtures, private evidence; logical separation, **not** an independent security boundary |
| Credentials | Do not transfer, log, or edit existing credentials; the launcher does not scrub all inherited provider secrets |
| Existing assets | Existing OpenCode sessions, V1/V2 data, other repositories, historical Gate/HOLD and user workspace must not be altered |

D-S5-08 changes the proposed D-S5-05 implementation from a physically independent Host to logical work separation on the existing Host. This is an explicit reduction in isolation assurance, **not** a claim of VM-equivalent protection. Any scenario whose data, process, permissions, or side effects cannot be confined to approved dedicated artifacts stays HOLD. Host-side pre-execution denial is not established.

## 3. Design approaches

- **A — selected for design:** Keep real Host OpenCode 2.3.2. Compare its required Session/Message/Tool source semantics against the S2-b 2.2.5 contract; extend version support only where evidence establishes compatibility, retaining 2.2.5 behavior and fail-closed validation.
- **B — not selected:** Preserve the strict 2.2.5 adapter. Safe rejection of 2.3.2 remains possible, but AC-H01 cannot reach bounded PASS.
- **C — not selected:** Downgrade the existing OpenCode V2 to 2.2.5. This changes the user's existing working environment and conflicts with D-S5-08.

### Verified code-level compatibility blocker

At the reference baseline, `src/runtime/s2b-contract.ts` exports `S2B_SUPPORTED_HOST_VERSION = "2.2.5"`. `src/runtime/s2b-input.ts` rejects any wrapper whose `hostVersion` differs, with `SOURCE_VERSION_UNSUPPORTED`. A 2.3.2 wrapper is therefore rejected by existing S2-b regardless of whether its other fields are compatible. **Never mislabel 2.3.2 as 2.2.5.**

Before a separate Owner-authorized source change, identify precise API/JSON field and pagination differences, scope the accepted versions, preserve byte/count limits and identity/schema validation, and define positive/negative tests. If compatibility cannot be established, retain rejection and HOLD AC-H01; no automatic widening of supported versions.

## 4. Connection boundary and acceptance criteria

The observed Host V2 JSON contains no explicit Justice plugin registration. This does **not** prove Justice can never load via another configuration path. Check the actual load path and whether the AC needs plugin integration before authorizing any modification; do not edit the shared Host V2 config merely to make a test pass.

| AC | Bounded design and required evidence |
| --- | --- |
| AC-H01 — S1/S2 | Obtain bounded real 2.3.2 Session source by an approved, non-destructive mechanism; preserve raw response bytes and collection metadata privately; bind an independently checked explicit Correlation; validate stored wrapper, project through S2-b offline adapter, and reach S1-d diagnostics with exact Task/Revision/Scope/AC attribution. Report `coverageCompleteness=NOT_ESTABLISHED` and genuine gaps without success inflation |
| AC-H02 — Authority/Evidence | Evaluate mismatch, missing Evidence, and unproven/invalid Authority only against **copies** of dedicated inputs; require target-specific non-acceptance/hold without cross-task side effects. Justice-side rejection is **not** Host pre-execution enforcement |
| AC-H03 — single-process S3-b | With dedicated durable state and a single Writer, verify a legitimate staged Decision/Lifecycle outcome before/after restart, bounded partial-failure recovery and conflicting duplicate transition behavior using independent durable readback. No failure injection until a safe reversible method and exact restart/cleanup boundaries have separate approval |

For each AC distinguish `PASS`, `FAIL`, `NOT_RUN`, and `NOT_VERIFIED`; retain `REJECTED`/`LIMITED`/`PROJECTED` as S2-b status, not AC outcomes. Static fixtures, CI, mock-I/O, self-declared Owner authority, a declared wrapper hostVersion, or document consistency alone cannot demonstrate real-Host PASS.

## 5. Host-go manifest delta and stop conditions

Before a separate AC execution authorization, reconcile the Owner's existing untracked Host Execution Manifest R0.1 (which currently assumes an isolated 2.2.5 Host). Fix or explicitly mark unknown: Host identity, observed executable version **and binary hash**, Justice commit, exact paths/Session/Task/Plan/Attempt/Revision/Correlation, observation/source retrieval mechanism, permitted operations, network access and enforcement limits, inherited secrets, dedicated writable/readback directories, rollback/cleanup allowlist and actual stop triggers.

In particular, an application flag or XDG separation is not an OS-level denial of reads/writes/network. If preserving existing Host data or preventing unwanted tool side effects cannot be demonstrated, HOLD the affected AC. An unsafe H03 failure-injection method cannot be replaced by modifying production/personal durable data. Do not automatically delete evidence or perform irreversible cleanup.

Only public-safe summaries, opaque references and evidence digests may enter the repository; raw sessions, messages, tool responses, tokens, absolute private Host paths and other sensitive data stay out.

## 6. Completion, residual risk, and checkpoints

`BOUNDED_COMPLETE` requires all three ACs to PASS against a fixed Host/Version/Scope/Operation, verified attributable evidence, disclosed limits, an adequate stop/rollback process and explicit Human Owner adoption. `RELEASE_APPROVED` is a **separate** environment-specific opt-in permission. No auto-enable, merge, release, Host execution, Gate/HOLD change or new task follows from this design commit.

Residual limitations include logical-only isolation, possible inherited secrets, no Host pre-execution enforcement, S2-c `COMPARISON_NOT_ESTABLISHED`, S3-a M-2, unproven multi-process/Writer durability/legacy Recovery, and untested other OpenCode versions. A required AC that cannot be safely verified remains HOLD; other independent work need not be stopped.

**Current checkpoint:** Design addendum prepared; earlier Design and Manifest require limited reconciliation before adoption; `HOST_GO_HOLD`, AC-H01/02/03 `NOT_RUN`, `BOUNDED_COMPLETE=PENDING`, `RELEASE_APPROVED=PENDING`. End the documentation-only task here. Do not dispatch review/correction loops or begin subsequent tasks without a specific Owner decision.
