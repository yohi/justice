# Justice v6 S5 Host Acceptance Record

This document is the evidence ledger for the Human Owner. It is not a runtime
approval object, a Gate state, or a product status field. It does not choose
the completion or release decisions on the Owner's behalf.

Current state (2026-11-24): **the Human Owner has formally adopted AC-H01,
AC-H02 and AC-H03 as `PASS`** (bounded), and the H3 limited real-Host runtime
check as `PASS`. `BOUNDED_COMPLETE` and `RELEASE_APPROVED` remain `PENDING`
(see the Owner Completion Decision). E1/E2/E3 remain `HOLD`.

Raw Session / Message / Tool content, secrets and private host paths are kept
in the private S5 evidence store only. This record cites opaque evidence IDs
(`T09`–`T16`, `H3RT`) and SHA-256 digests (shortened to 16 hex characters
where marked `…`).

## 1. Target identity

| Item | Value |
| --- | --- |
| Host | Existing Ubuntu `coreultra7-270k` (D-S5-08 existing Host, logical separation) |
| Version | OpenCode V2.3.2, real binary SHA-256 `e6543f6e5c39c40971ba38afd1819ac852c29ac735b5a89065d3d148d47f27ad` |
| Justice Commit | master `896acee25323c0e5b6dc97e0dd936efff1b9e434` |
| Justice V2 Artifact | `dist/opencode-v2-plugin.js` built from `896acee2` (isolated build, frozen lock `0cfb35a8…`), SHA-256 `b2130a6d27e04a460ef3c7340994b703121b5cd001a2cbb78ad0b9165da0b855` (byte-identical to the H3 TDD Task 5b build) |
| Scope | Adopted bounded S1, S2 and S3 ranges (D-S5-01); S3-b single process / single Writer |
| Operation | Operation Plan Tasks 3–5 (AC-H01..H03) and the H3 limited V2 plugin runtime check |
| Isolation | Dedicated state and workspace; user/net (and, for H3/T16, pid/ipc) namespaces; `HOME` hidden (tmpfs) where bwrap was used; loopback scripted/mock provider only; no credentials; no external network |
| Authority | Human Owner decisions in the S5 conversation of 2026-11-23/24. AC-H01 additionally rests on a pre-execution Owner approval bound to fixed digests (Approval Reference `OWNER-S5-H01-PREFIX-20261124`). |
| Cleanup | No destructive cleanup; dedicated config restored by digest; evidence retained |

Referenced decisions: D-S5-01 (S1, S2, S3 bounded completion target), D-S5-02
(minimal real-Host acceptance is required), D-S5-03 (explicit Owner opt-in),
D-S5-04 (fail-closed with limited blast radius), historical D-S5-05 (isolated
Host) superseded by **D-S5-08 existing Host/logical separation**, D-S5-06
(required PASS plus explicit known limitations), D-S5-07 (minimal
three-artifact approach). Source:
`docs/superpowers/specs/2026-11-17-justice-v6-s5-operation-completion-brainstorming-requirements.md`.

## 2. Result type

Each acceptance criterion carries the following fields.

| Field | Allowed values / meaning |
| --- | --- |
| Outcome | `PASS`, `FAIL`, `NOT_RUN`, `NOT_VERIFIED` |
| Observation | What was actually observed |
| Evidence ref | Opaque reference to stored private evidence |
| Digest | Content digest of the referenced evidence |
| Source confidence | Provenance of the evidence (`observed`, `derived`, `declared`); `declared` never supports PASS |
| Limitations | Known limits that bound what the outcome proves |
| Owner approval ref | Reference to the Owner's explicit decision |

Rules:

- `FAIL` and `NOT_VERIFIED` are never converted to `PASS` automatically.
- `NOT_RUN`, unproven, or failed-to-observe states are never read as `PASS`.
- Self-declared (`declared`) evidence never satisfies a PASS.
- A PASS proves only the bounded scope in its Limitations.
- **Diagnostic labels are not AC outcomes.** S1-a `ownerAuthorityStatus=NOT_PROVEN`,
  S1-c `formalVerdict=UNKNOWN`, `coverageCompleteness=NOT_ESTABLISHED`,
  `provenanceClass=UNVERIFIED_EXTERNAL` and `reportedOutcome=UNKNOWN` are retained
  exactly as the existing contracts produce them. They describe the diagnosed
  target, not the acceptance of AC-H01..H03, and are not promoted by this record.

## 3. Evidence reuse and provenance

| Evidence | Executed at | Reuse basis for `896acee2` | Digest (`SHA256SUMS`) |
| --- | --- | --- | --- |
| T09 real 2.3.2 Source acquisition | `f1d953aa` | S1/S2-b path source-identical; imports only `node:crypto` | `f99dbf6580132449…` |
| T10 Source validation | `f1d953aa` | same | `751c495e08ee6f60…` |
| T11 Owner Authority gate (`CASE_B`) | `f1d953aa` | historical: established that post-execution mapping cannot support AC-H01 | `c892c1a3260119bb…` |
| T12 S2-b Adapter → S1-d (R1, post-execution mapping) | `f1d953aa` | historical baseline for T13/T16 controls; not the AC-H01 PASS basis | `867ffa9863ea8bf6…` |
| T13 negative controls n1/n2/n3 | `f1d953aa` | S1/S2-b path source-identical | `558a366bf4f35440…` |
| T14 H03-N/R/C and Optional H02 | `f1d953aa` (pre Writer fix) | H03-R reused. Its restart path writes as the current writer, no open pending existed before the restart, and `effect` is not on the path. H03-N/C were re-run in T16. | `99f49ebb2eb85352…` |
| T15 Writer identity fix, P/T restart | worktree byte-identical to master (`7f198637`) | core/runtime/hooks unchanged since `7f198637` | `727e700636f5f223…` |
| T16 H02-A/B/C, H03-N/C | master `896acee2` (git archive, lock-verified deps) | executed on master code | `30179ee954c3c35d…` |
| T16 H01 pre-fixed acquisition | master `896acee2` | executed on master code | `bf9fd0c66d4ef6f8…` |
| H3RT run-1..4 (H3 limited runtime) | master `896acee2` V2 Artifact | executed on master artifact | records `a3b93efd5624b5a3…`, `18b2ceb7fe42be08…` |

Dependency note: `effect` changed (`4.0.0-beta.101` → `4.1.0`) between
`f1d953aa` and master. Only `src/runtime/justice-tools.ts` imports `effect`
(reached via `opencode-adapter.ts`), so the S1/S2-b and S3-b harness paths
are unaffected. Source-blob identity is not claimed as full runtime-environment
identity.

## 4. Acceptance criteria

### AC-H01 S1/S2 normal integration — **PASS (Human Owner adopted 2026-11-24)**

| Requirement | Evidence | Observation |
| --- | --- | --- |
| Pre-execution Owner-fixed TaskIntent / Artifact identity | T16-H01 package: package digest `f0588d206b174eb9…`, OwnerManifest `533c346d6ec857fe…`, Approval Reference `OWNER-S5-H01-PREFIX-20261124`. TaskIntent: scope `s5-d08-ac-h01`, design R1, plan R0.1.1, task `s5-task-3-ac-h01` R2, ac `s5-ac-h01` R2 | The Human Owner explicitly approved the digest set. The approval record was written at 2026-11-24T09:08:55Z (record `e7eacc940451dfcd…`), before the acquisition started at 09:09:11Z. The acquisition script refuses to run without a matching record. |
| Real 2.3.2 Source from a dedicated Session | T16-H01 acquisition: new dedicated state, bwrap user/net/pid/ipc namespaces, loopback scripted provider, no credentials, no external network | Session created once. Native `session.get` + `session.messages` (3 pages, cursor chain). The Source wrapper (`7a70c9d5301fef84…`) is `ACCEPTED` and `PAGINATION_COMPLETE`. |
| Correlation by the pre-fixed rule only | Correlation rule `2dfac2fc410cb741…` | Exactly one match: an `assistant` message with exactly one completed `read` tool part. The Session ID is identical across the runner, the wrapper and the Correlation. No post-hoc adjustment. |
| Task / Revision / Scope / AC attribution | S2-b Adapter, S1-b | `selectedTaskRef = s5-task-3-ac-h01@R2`, scope `s5-d08-ac-h01`. S1-b binding `MATCH`. AC `s5-ac-h01@R2` coverage `MATCHED_REF_PRESENT`. S1-a artifact digests `MATCH`. |
| S2-b validation → Adapter → S1-d | T16-H01 structural validation, adapter result | Manifest and TaskIntent `ACCEPTED`, resolve `complete`, Correlation `ACCEPTED`. Adapter `PROJECTED` (1 Evidence, 0 rejected). S1-d reached. |
| Non-promotion of unproven items | same | `coverageCompleteness=NOT_ESTABLISHED`; provenance `UNVERIFIED_EXTERNAL`, verification `NOT_VERIFIED`; `reportedOutcome=UNKNOWN`; S1-c `formalVerdict=UNKNOWN`; S1-a `ownerAuthorityStatus=NOT_PROVEN` (by contract). |
| Safe stop / non-interference | T16-H01 post checks | No residual processes. Shared OpenCode processes and the shared Justice store are unchanged. Repository unchanged. |

| Field | Value |
| --- | --- |
| Outcome | `PASS` (bounded) |
| Source confidence | `observed` (Source, identifiers, rule-based attribution). The Owner authority is the pre-execution Human Owner approval bound to fixed digests, which is external to S1-a. |
| Owner approval ref | Pre-execution: `OWNER-S5-H01-PREFIX-20261124`. Formal adoption: Human Owner, 2026-11-24 (conversation). |
| Limitations | No full-history completeness. No cryptographic Owner authentication or comprehensive Host authenticity. The provider is scripted (not a real LLM). T09–T12 (R1, post-execution mapping) remain history and are not the PASS basis. **Runner stderr:** the reused T09 runner prints two shell errors after `sequence complete` (`Bad file descriptor` on the server stdout copy, `SRV_PID: unbound variable` in the exit trap). The identical two lines appeared in T09. They occur after all requests completed, and the acquired Source, wrapper and IDs are unaffected. Not reproduced or fixed in S5. |

### AC-H02 Authority / Evidence anomaly — **PASS (Human Owner adopted 2026-11-24)**

| Required case | Evidence | Observation |
| --- | --- | --- |
| Task mismatch | T13 n1 | `FOREIGN_TASK_EXCLUDED`, 0 Evidence attributed |
| Revision-only mismatch | T16 H02-B | `FOREIGN_TASK_EXCLUDED`, 0 selected, S1-d `MISSING_EVIDENCE`, `formalVerdict=UNKNOWN` |
| Scope-only mismatch | T16 H02-C | same as H02-B |
| Evidence missing | T13 n2 | `REJECTED`, `MISSING_TOOL`, S1-d not invoked |
| Authority unverified | T13 n3. Supplementary: H3RT C4, T14 Optional-H02 | `ownerAuthorityStatus=NOT_PROVEN`, `formalVerdict=UNKNOWN` (hold, not promotion). The V2 `justice_review` resolve is denied fail-closed because no approval channel exists (H3RT). An inactive Authorization blocks progress (T14). |
| Non-propagation to an unrelated Task | T16 H02-A | The normal Task's evidenceRefs, projectionScope and S1-d are byte-identical with and without a co-resident anomalous unrelated binding. Selecting the anomalous Task gives `REJECTED`. |

| Field | Value |
| --- | --- |
| Outcome | `PASS` (bounded) |
| Expected results | Pre-registered before execution (T16 H02 expected results `ab8b154f6df5800c…`) |
| Owner approval ref | Human Owner, 2026-11-24 (conversation) |
| Limitations | Justice-internal handling only; does not prove rejection before Host execution. n3 is non-promotion, not blocking. |

### AC-H03 S3-b Decision / Lifecycle Consistency Recovery — **PASS (Human Owner adopted 2026-11-24)**

| Requirement | Evidence | Observation |
| --- | --- | --- |
| Normal consistency across restart (post-fix) | T16 H03-N (master code) | Restart by a new writer: 0 new records. Decisions, lifecycle, plan digest and progress are unchanged. |
| Decision persisted, Lifecycle missing → recovery | T14 H03-R (reused) | After an injected lifecycle append failure, the restart wrote `gate_pending→accepted` as the restart writer. A second restart was idempotent. Plan progress did not advance prematurely after the fault. |
| Duplicate / stale completion → no progress (post-fix) | T16 H03-C (master code) | Initialize succeeded. The replayed completed-claim and stale-callId `PostToolUse` were handled. 0 new records; decisions, lifecycle, plan, staging and terminal unchanged. |
| Cross-writer recovery after the Writer fix | T15 P/T | Pending recovery and terminal cancellation were written by the current writer. Historical shards unchanged. |
| Independent durable readback | T15, T16 | Direct shard readback: all records attributed to the expected writers; no temporary leftovers |

| Field | Value |
| --- | --- |
| Outcome | `PASS` (bounded, single process / single writer) |
| Expected results | Pre-registered (T16 H03 expected results `67ac9fd30e30c812…`) |
| Owner approval ref | Human Owner, 2026-11-24 (conversation) |
| Limitations | H03-C rejection mechanism not separately proven (not required). The delegated-execution relation is supplied by the harness (no real OpenCode child session). No abnormal-termination durability, multi-writer, Plan Final Review recovery, or full Semantic Recovery. |

### H3 limited real-Host V2 plugin runtime — **PASS (Human Owner adopted 2026-11-24)**

| Check | Observation (H3RT run-1..4) |
| --- | --- |
| Configured / resolvable / loaded | Dedicated config `plugins: [<staged artifact dir>]`. Loader log shows the V2 entrypoint `dist/opencode-v2-plugin.js`, with no V1 fallback. `/api/plugin` reports `justice`, `source.type=local`, `status=active`. |
| Tool registration | `justice_review` is listed in the OpenCode **Code Mode** catalog as `tools.justice_review({ scope?, resolve? })`. It is not a direct tool, by v2.3.2 design for tools without `options.codemode=false`. |
| Tool functional | Via `execute`, the real plugin returned the review summary for a synthetic fixture (`metadata.toolCalls`: `justice_review` completed) |
| Resolve fail-closed | Code Mode resolve returned `Review resolution was not approved.`, reached only after the scope/item checks. The open item was unchanged; no Decision/Lifecycle/approval change. |
| Isolation / stop / rollback | bwrap user/net/pid/ipc namespaces with an isolation gate before start. Stop by PID-namespace teardown: 0 residual processes. Dedicated config restored and digest-verified. Shared OpenCode processes untouched. |

## 5. Known limitations

These bound what the PASS outcomes prove.

| Limitation | Source |
| --- | --- |
| S2-c comparison effectiveness is `COMPARISON_NOT_ESTABLISHED`; incremental value over Native-only is unproven | `docs/reports/2026-11-14-justice-v6-s2c-limited-comparison.md` |
| S3-a M-2 (Review Terminal metadata hardening) is out of scope | S3-b requirements; S5 requirements |
| Legacy Staging: recovery is limited when Staging history is absent | S5 requirements |
| External Writer / File durability and abnormal-termination durability are unproven | S5 requirements; T15 |
| Multi-writer / multi-process Recovery unproven; S3-c Host Enforcement not implemented; S4 not adopted | S5 requirements |
| Host pre-execution enforcement is not proven; AC-H02 is Justice-internal handling | S5 requirements |
| AC-H01 does not prove full-history completeness, Source authenticity, or cryptographic Owner authentication | S5 requirements; T16-H01 |
| The V2 entry exposes only `justice_review` (Code Mode). V2 resolve is denied because the V2 ToolContext has no approval channel. V1-equivalent commands, hooks and the implementation arm are not ported. | H3RT; `src/opencode-v2-plugin.ts` |
| The Code-Mode-disabled direct-exposure fallback of OpenCode v2.3.2 is unverified for Justice | H3RT |
| Global Wisdom write path not exercised at runtime (only local `.justice/state.json` was written) | H3RT addendum |
| Host-provided `effect` version for the V2 plugin is unverified (no runtime error observed) | H3RT |
| Only OpenCode V2.3.2 at the recorded binary digest is covered; other versions are unverified | S5 requirements |
| Real LLM providers and credentialed environments were not used in any acceptance run | T09, T16, H3RT |

Related tracking: Issues #355 (S2 parent), #356 (S3), #358 (S5), and #388
(Justice v6 overall).

## 6. Completion terms

`BOUNDED_COMPLETE` and `RELEASE_APPROVED` are **not established** by this
record. AC-H01..H03 are `PASS` and the limitations are disclosed; the
remaining conditions and the two independent Owner decisions are tracked in
`docs/superpowers/decisions/justice-v6-s5-owner-completion-decision.md`.

## 7. Historical state

Before T09 (2026-11-23) this record stated that no real-Host acceptance had
been run, that all criteria were `NOT_RUN` and that target values were
`未固定`. That state is superseded by the evidence above and is retained only
as history.

## 8. Document consistency check

```bash
rg -n 'AC-H0[123]|PASS|COMPARISON_NOT_ESTABLISHED|M-2|BOUNDED_COMPLETE|RELEASE_APPROVED' docs/superpowers/acceptance/justice-v6-s5-host-acceptance-record.md
```
