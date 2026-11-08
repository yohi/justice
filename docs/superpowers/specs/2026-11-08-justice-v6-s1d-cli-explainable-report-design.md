# Justice v6 — S1-d Integrated CLI / Explainable Report

> **Design:** R0.1 — documented candidate
> **Issue:** [#353](https://github.com/yohi/justice/issues/353)
> **Decision:** `S1D_INTEGRATED_DIAGNOSTIC_CLI_WITH_PURE_REPORT_FORMATTER`
> **Decision authority:** Human Owner approved the architecture direction in the brainstorming conversation on 2026-11-08 (JST). This document's details are proposals pending explicit Owner acceptance.
> **Scope:** DESIGN_ONLY / READ_ONLY CLI specification. No code implementation, test execution, CI, Host Probe, Gate/HOLD change, or downstream task is authorized by this document.
> **Dependency:** S1-a / S1-b / S1-c existing core contracts; final S1-e comparison remains separate.

## 1. Purpose, value, and stopping boundary

Provide one practical, local, READ_ONLY command that accepts the original Artifact / Evidence / ChangeSet inputs, invokes existing S1-a through S1-c diagnostic cores, and emits a deterministic, explainable Text or JSON report. The user must not execute three separate diagnostic tools and manually correlate their outputs.

The product is an **assurance diagnostic interface**, not an approval authority. The CLI's ability to finish execution, the presence of matched EvidenceRefs, candidate-scope comparison, and formal acceptance are separate facts.

Success is a bounded local invocation that explains what was checked, what was observed, what remains UNKNOWN or not evaluated, and why, without triggering any workflow.

**Explicit non-goals:** A result-import CLI mode; a dashboard, server, or sidecar; a durable result store; generating evidence; implicit Git diff collection; deriving an owner approval from an `approvalRef` string; signature validation; automatic Task/Review/Fix launch; changing Gates or HOLDs; changing Superpowers workflow; or S2–S5 integration.

**Anti-goal:** Never present a partial check, self-reported PASS, or a candidate-scope match as a formal assurance PASS.

## 2. Approaches considered and selected

| Approach | Benefit | Cost / limitation | Decision |
| --- | --- | --- | --- |
| **Integrated diagnostic CLI + pure formatter** | One invocation; consistent raw inputs and diagnostics; reusable formatter | Some additional local input orchestration | **Selected** |
| Result-import-only CLI + formatter | Smallest initial implementation | Requires external S1-a/b/c execution and result association | Not in MVP |
| New consolidated diagnostic engine | Arbitrary UX control | Duplicates core rules and causes semantic drift | Rejected |

This is the approved architecture direction, not authorization to implement.

## 3. Grounded existing contracts and trust invariants

The design is based on these existing repository paths and types:

- `src/core/s1a/loader.ts`: `loadS1aArtifacts(input, source)`; `LoaderResult`, including `identityStatus`, `identityCandidateReady`, `eligibleBaseline: false`, selected refs, checks, and limitations.
- `src/runtime/s1a-cli.ts` and `src/runtime/s1a-read-only-fs.ts`: current `justice-s1a check` command and bounded, read-only filesystem adapter.
- `src/core/s1b/binder.ts`: `bindEvidence({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs })`.
- `src/core/s1c/evaluator.ts`: `evaluateS1c({ schemaVersion: "justice-s1c-input-v1", baseline, planBytes, changeSet, evidenceRefs })`; `S1cResult` has `formalVerdict` and `candidateScopeComparison`.
- `src/core/s1b/baseline.ts`: `inspectBaseline` is the shared existing validator for a candidate baseline.

**Non-negotiable meaning:**

1. `S1-a identityStatus: MATCH` is only an identity comparison against caller-supplied, digest-pinned material. `ownerAuthorityStatus` is `NOT_PROVEN` and `eligibleBaseline` remains `false`.
2. S1-b `MATCH` and `MATCHED_REF_PRESENT` mean association/reference presence, not evidence authenticity, execution success, AC satisfaction, or approval. `reportedOutcome` and `reportedExecutionState` remain claims.
3. S1-c `candidateScopeComparison` can indicate `WITHIN_CANDIDATE_SCOPE` or `OUTSIDE_CANDIDATE_SCOPE`; neither may be promoted to a formal PASS/FAIL.
4. The existing S1-c implementation returns `formalVerdict: UNKNOWN` with `ownerAuthorityVerification: NOT_VERIFIED_BY_S1C`. S1-d must preserve those values; it must not calculate a new formal verdict.
5. `ChangeSet.availability: PRESENT` only describes caller-provided paths; S1-d cannot assert that the list is a complete Git diff.
6. Neither the manifest's approval reference nor claimed evidence provenance proves an independent owner trust boundary.

S1-d does not modify S1-a/b/c contracts or their policy, evaluation, and diagnostic ordering.

## 4. Runtime topology and responsibility separation

~~~text
Local CLI: justice-s1d diagnose
  --manifest / --manifest-sha256 / --intent / --artifacts-root
  --evidence / --changeset / --format
           |
           v
READ_ONLY runtime adapter (bounded reads, no external commands)
           |
           v
Integrated diagnostic orchestrator
    (1) S1-a loadS1aArtifacts()
    (2) S1-b bindEvidence()
    (3) S1-c evaluateS1c(), supplied the same S1-a Plan bytes
           |
           v
Immutable S1-d report projection
           |
           v
Pure formatter: formatText() or formatJson()
           |
           v
stdout + process exit status (no persistence)
~~~

Proposed future locations (not files created in this task):

- `src/runtime/s1d-cli.ts`: argument parsing, stdout/stderr, process exit-code boundary.
- `src/runtime/s1d-read-only-input.ts`: bounded file I/O, parsing, and captured S1-a read snapshots.
- `src/core/s1d/report.ts`: immutable report construction from existing core outputs, without re-evaluating diagnostics.
- `src/core/s1d/formatter.ts`: pure Text and canonical JSON rendering.
- `tests/s1d/`: core-report and CLI fixture tests.
- `package.json`: an eventual `justice-s1d` bin mapping and build inclusion, **only after separate implementation authorization**.

The core-report functions receive data and return data; they do not import OpenCode, use the filesystem, execute commands, or persist output. The runtime boundary alone owns local I/O.

## 5. CLI grammar and input specification

~~~bash
justice-s1d diagnose \
  --manifest ./owner-manifest.json \
  --manifest-sha256 <lowercase-64-hex> \
  --intent ./task-intent.json \
  --artifacts-root ./artifacts \
  --evidence ./evidence-refs.json \
  --changeset ./changeset.json \
  --format text
~~~

- Verb: exactly `diagnose`. There is no `report` or `from-results` mode.
- Required flags: `--manifest`, `--manifest-sha256`, `--intent`, `--artifacts-root`, `--evidence`, and `--changeset`.
- `--format` accepts exactly `text` or `json`, defaults to `text`; flags can appear in any order but cannot repeat. Unknown flags, missing values, extra positional arguments, and invalid digest syntax are usage errors.
- The manifest, intent, and Artifact directory use S1-a's existing `LoaderInput` and `OwnerManifest` / `TaskIntent` schemas. A missing or malformed expected digest must not be replaced by hashing the caller's current file as the expected value.
- The Evidence JSON file is a **raw JSON array** of existing `EvidenceRefV1` items (0–128). An empty array means *no supplied references*, not “execution was successful”. Reject non-array envelopes rather than interpreting them silently.
- The ChangeSet JSON file is an existing `ChangeSet` value. For unavailable change data, the caller must explicitly provide `{"availability":"UNAVAILABLE"}`. An empty `PRESENT` changes array is a positive caller claim of no changes and is not interchangeable with `UNAVAILABLE`.
- File content is read as bounded bytes then strict JSON where appropriate. Reuse `parseStrictJson` to reject duplicate keys and malformed JSON. Validate according to existing S1-a, S1-b, and S1-c contract rules instead of introducing permissive parallel validators.
- Proposed I/O caps for **S1-d-only new files**: Evidence JSON ≤ 1,048,576 bytes and ChangeSet JSON ≤ 262,144 bytes. The existing S1-a per-input/per-artifact caps, S1-b EvidenceRef count cap, S1-c 128-entry ChangeSet validation, and 8,388,608-byte Plan cap remain authoritative. Byte caps are proposals for S1-d, not retroactive changes to S1-a/b/c.

**Input failure distinction:** An unreadable or malformed Evidence file is **not** an empty Evidence array; an unreadable or malformed ChangeSet file is **not** `UNAVAILABLE`. These errors must be reported explicitly and must not be converted to plausible diagnostic data.

### 5.1 Plan bytes handoff without unbound second read

`LoaderResult.selectedRefs` identifies the selected Plan and its expected/observed digest but does **not** contain Plan bytes or `relativePath`. S1-c needs the original `planBytes`.

Design decision: inject a read-only `S1aReadOnlySource` wrapper that captures a bounded, copied snapshot of S1-a reads **within this invocation**. Use the same manifest snapshot parsed under S1-a's strict manifest contract to associate the selected Plan's `artifactId` with its relative path and captured bytes. Only pass the Plan bytes observed during the S1-a run to S1-c. No arbitrary CLI `--plan` override, independent unverified path, or silent second read is permitted.

- A selected Plan must be unique, present among the selected references, and traceable to the captured manifest and its read path.
- If S1-a could not read that Plan, cannot identify it unambiguously, or the captured bytes are unavailable, mark S1-c `NOT_EVALUATED` with an explicit reason. Do not synthesize Plan bytes.
- S1-c itself independently checks the Plan-byte SHA-256 against the S1-a selected expected and observed digest and requires the existing baseline readiness.
- Use defensive copies or immutable ownership of captured bytes so a formatter or caller cannot mutate them between stages.
- Snapshotting avoids an unnecessary re-read, but does not prove cross-path filesystem race freedom, owner origin, or atomicity of the entire directory tree. Preserve existing S1-a limitations and do not claim stronger host guarantees.

## 6. Evaluation and dependency behavior

1. Validate CLI syntax, read the new bounded JSON inputs, and verify their envelope syntax. No process spawning or implicit Git operations.
2. Run `loadS1aArtifacts()` on the given manifest, task intent, and Artifact root with the existing read-only source adapter and capture only bounded input bytes.
3. Run `bindEvidence()` with the exact S1-a `LoaderResult` and provided EvidenceRefs, even if S1-a returns a non-ready candidate; the S1-b core decides between `EVALUATED`, `BASELINE_UNKNOWN`, and `INPUT_REJECTED`.
4. If the captured Plan and necessary typed inputs exist, call `evaluateS1c()` with exactly the S1-a result, captured Plan bytes, explicit ChangeSet, and EvidenceRefs. S1-c performs its own S1-b binding internally; this is intentional reuse of the current contract, not new matching logic.
5. Project the three raw results into a report and format it without changing their substantive statuses.

The orchestration must **not** short-circuit a legitimate diagnostic merely because an earlier stage observed a mismatch; report all safe results that the current core can evaluate. Where inputs are absent, malformed, or unsafe to associate, the dependent stage is `NOT_EVALUATED` rather than false success or false failure.

Stage state is separate from core outcome:

- `EVALUATED`: the existing core function returned a result. Its result may still say `UNKNOWN`, `MISMATCH`, `INPUT_REJECTED`, or `BASELINE_UNKNOWN`.
- `NOT_EVALUATED`: the existing core was not invoked because a documented precondition was unavailable; include a stable reason (`INPUT_UNREADABLE`, `INPUT_INVALID`, `PLAN_SNAPSHOT_UNAVAILABLE`, or `PREREQUISITE_UNAVAILABLE`).

This separation avoids treating skipped work as observed failures.

## 7. Result model, semantic preservation, and formatting

The initial JSON representation is an S1-d **transport/report envelope** around the original core results, not a replacement for their schemas:

~~~typescript
type Stage<T> =
  | Readonly<{ state: "EVALUATED"; result: T }>
  | Readonly<{ state: "NOT_EVALUATED"; reason: string }>;

type S1dReportV1 = Readonly<{
  schemaVersion: "justice-s1d-report-v1";
  operation: "diagnose";
  readOnly: true;
  stages: Readonly<{
    s1a: Stage<LoaderResult>;
    s1b: Stage<BinderResult>;
    s1c: Stage<S1cResult>;
  }>;
  limitations: readonly string[];
}>;
~~~

Normative requirements:

- Preserve `LoaderResult`, `BinderResult`, and `S1cResult` as returned, including unknowns, reason codes, Evidence IDs, candidate-scope comparison, reported claims, and limitations. Do not invent a cross-stage formal PASS/FAIL.
- The report-level `limitations` is the deterministic, deduplicated, lexically ordered union of present stage limitations plus any S1-d-specific boundary limitation. It does not replace the per-stage arrays.
- JSON uses deterministic property ordering and stable, newline-terminated serialization. Do not include invocation time, random IDs, environment variables, process IDs, absolute host paths, or raw unvalidated input bytes. Do not echo arbitrary CLI arguments on error.
- Text is a projection of that same report envelope: stage run state, identity/binding/candidate-scope findings, diagnostics with bounded identifier/path references, reported-versus-verified distinction, and explicit limitations. Text and JSON may differ in presentation, **not facts**.
- Output escaping must prevent newline/control-character spoofing. Only normalized/validated relative paths, stable IDs, and reason codes may appear; never print raw untrusted JSON or unexpected exception messages.
- `formatText(report)` and `formatJson(report)` must be pure: same input, byte-identical output, no I/O, clock, global process state, or policy decisions.

Example **illustrative**, not executed or an assertion of approval:

~~~text
Justice S1-d — READ_ONLY diagnostic
S1-a: EVALUATED  identity=MATCH  owner_authority=NOT_PROVEN
S1-b: EVALUATED  evaluation=EVALUATED  authenticity=NOT_VERIFIED
S1-c: EVALUATED  candidate_scope=OUTSIDE_CANDIDATE_SCOPE
Formal verdict: UNKNOWN (Owner authority not verified)
Finding: OUTSIDE_CANDIDATE_SCOPE src/example.ts
Limits: evidence authenticity, host execution, ChangeSet completeness,
        Owner approval/supersession, filesystem race freedom not proven
This diagnostic is not an acceptance or a Gate decision.
~~~

The “Formal verdict” line is emitted only from an actual evaluated S1-c result. For a skipped stage, say “Formal verdict: NOT_EVALUATED” as a presentation label, **never** fabricate an `S1cResult.formalVerdict` field.

## 8. Process exit codes and CLI success

Process status describes **CLI execution only**; it is not an assurance or Gate verdict.

| Code | Meaning | Required behavior |
| --- | --- | --- |
| `0` | Invocation was valid and all three core stages returned results | Findings, `MISMATCH`, and formal `UNKNOWN` may still be present |
| `3` | Incomplete diagnostic due to unavailable/unsafe-to-associate prerequisite | Mark skipped stage(s), preserve available diagnostics |
| `64` | Invalid command line/flag syntax | Bounded, safe usage diagnostic; no implied core result |
| `65` | Malformed or over-limit new Evidence/ChangeSet JSON input | Explicit invalid-input diagnostic; do not fabricate `[]` or `UNAVAILABLE` |
| `70` | Unexpected internal failure | Safe generic error; no raw stack trace/host path |

S1-a's existing `justice-s1a check` exit-code behavior remains unchanged. In particular, `justice-s1d`'s `0` means that the diagnostic pipeline ran, **not** that Identity is matched or formal assurance passed. A machine consumer must inspect the JSON stage values and may not interpret exit code alone as Gate approval.

For malformed/usage/internal errors that prevent a report envelope from being constructed, emit a bounded machine-readable or text error record according to `--format` when valid; no synthetic stage success. Exactly one final output record on stdout, ending with a newline. No files are generated.

## 9. Threat model, read-only guarantees, and limits

- Local paths and JSON are untrusted. Reuse `createS1aReadOnlySource()`; reject unsafe/nonregular/symlink traversal according to existing adapter behavior, never relax it for S1-d.
- Maintain strict count, byte, and depth limits; do not perform unbounded file reads, uncontrolled recursion, or unrestricted report expansion. Zero/empty cases must retain their precise semantics.
- Report provenance precisely: agent-reported EXECUTED/PASS remains reported; owner authority, external evidence authenticity, actual host execution, ChangeSet completeness, supersession, and full filesystem race freedom remain unverified.
- Runtime operations are limited to bounded local reads, in-process calculation, stdout/error reporting, and process exit. No write to input files, cache, runtime settings, Git tree, issue, PR, or external service. No subprocess, network request, plugin action, task execution, review, fix, or Gate/HOLD mutation.
- A serious input safety violation prevents the affected read/diagnostic operation (fail closed for that action), but unrelated already-obtained safe diagnostic results can still be explained. Do not create a new workflow stop or approval gate.

## 10. Acceptance fixtures and test design (future implementation only)

| Case | Expected observable outcome |
| --- | --- |
| Same fixed Fixture run twice | Byte-identical Text/JSON per format; stable stage order and reason order |
| All S1-a identity checks match, valid Evidence, in-scope ChangeSet | All stages run; `formalVerdict` remains `UNKNOWN`, not PASS |
| S1-a manifest digest mismatch | Mismatch is preserved; dependent diagnostics are unknown/not evaluated as the existing cores require |
| Plan bytes missing, changed, or not traceable to manifest selection | No synthesized Plan; S1-c skipped or existing S1-c identity mismatch returned, with explicit reason |
| Evidence matches a Task and AC | Binding match/reference coverage only; no inferred execution success or AC satisfaction |
| Evidence misbound to another Task/Revision/Scope/AC | Existing S1-b reason codes and S1-c binding diagnostics visible |
| Evidence is empty | Missing coverage is distinguishable from successful execution |
| Invalid/duplicate/oversized Evidence JSON | Explicit invalid input; never silently substitute an empty list |
| `{"availability":"UNAVAILABLE"}` ChangeSet | Existing S1-c `CHANGESET_UNAVAILABLE` / unknown scope semantics |
| Outside-scope changed path or rename | Existing path diagnostics; formal verdict remains unknown |
| No S1-c scope policy | `SCOPE_POLICY_UNDEFINED` is visible, not a guessed allowlist |
| Invalid/over-limit ChangeSet | Explicit input error or existing invalid diagnostics; not treated as “no changes” |
| Unreadable file, symlink, traversal attempt | Safe bounded diagnostic; no unsafe dereference or host path leak |
| Unexpected formatter/adapter error | Safe error record; no source mutation |
| Normal / negative-diagnostic / incomplete runs | Exit code distinguishes execution completion from inability to execute, never functions as approval |
| Observable side effects | No writes, subprocess, network, Task/Review/Fix/Gate activity |

Minimum verification after **separate implementation authorization**: deterministic unit tests for report projection and formatter; mocked CLI and read-only source tests; integration tests using fixed S1-a/b/c fixtures; existing Bun test, typecheck, lint, and build commands. These are future acceptance criteria, **not tests executed while writing this design**.

## 11. Scope and owner checkpoint

**This documentation task is complete when** one Design R0.1 document is committed on the existing Issue #353 feature branch and read back from GitHub, with no other files modified. Unresolved observations do not expand the task automatically.

**Owner decisions already made:** integrated input-to-diagnostics CLI, existing-core reuse, pure formatter, Text/JSON, READ_ONLY, preservation of `formalVerdict: UNKNOWN` and other trust boundaries, no result-import mode in MVP.

**Design calls proposed here (not independently Owner approved):** specific CLI flag grammar, raw-array Evidence file format, mandatory explicit ChangeSet file, Plan-byte snapshot handoff, JSON v1 envelope, S1-d input byte caps, stage-state vocabulary, exit-code scheme, and suggested module layout.

**Remaining risk:** current S1-a filesystem race limitation and the absence of independent Owner authorization, evidence authenticity, host execution verification, and ChangeSet completeness evidence. S1-d must display, not conceal, these boundaries.

**Not authorized by this document:** source implementation, execution/CI/Host Probe, production use claim, Gate or HOLD release, formal Requirements adoption, external writes, automated reviews or fix loops, Implementation Plan initiation, or S2–S5 work.

After reading this Design R0.1, the Human Owner may adopt it or request **one bounded correction**. Do not generate an independent review chain merely because a new revision or Finding exists. Any subsequent plan or implementation activity requires a separately specified authorization.
