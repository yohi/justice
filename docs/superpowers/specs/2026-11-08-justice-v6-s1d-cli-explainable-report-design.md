# Justice v6 — S1-d Integrated CLI / Explainable Report

> **Design:** R0.1.1 — F-001 / F-002 with F-001-A bounded consistency correction candidate (details not Owner-adopted)
> **Source baseline:** `yohi/justice` Reviewed HEAD `dea31f40591161b8830aedadcd3c13d2dbdb19da`, branch `feature/justice-v6-s1d-cli-explainable-report-design-20261108`
> **Issue:** [#353](https://github.com/yohi/justice/issues/353)
> **Decision:** `S1D_INTEGRATED_DIAGNOSTIC_CLI_WITH_PURE_REPORT_FORMATTER`
> **Decision authority:** Human Owner approved the architecture direction in the brainstorming conversation on 2026-11-08 (JST). The detailed design, including this correction, is not Owner-adopted.
> **Scope:** DOCUMENT_ONLY / DESIGN_ONLY / READ_ONLY CLI specification. No source edits, implementation, tests, CI, Host Probe, Gate/HOLD change, or downstream task authorized.
> **Dependency:** Existing S1-a / S1-b / S1-c core contracts; final S1-e comparison remains separate. Implementation Plan is not yet created.
> **Correction limit:** F-001 and F-002 retained; F-001-A limited consistency correction in §6, §6.1, §7 and §10 (plus directly necessary metadata/checkpoint text). No new Architecture Decision, review or fix loop.

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
- `src/core/s1b/validation.ts`: `inspectEvidenceRefs(unknown)` checks the **whole** Evidence set; `refs` is `null` when any Evidence entry is rejected.
- `src/core/s1c/evaluator.ts`: `evaluateS1c({ schemaVersion: "justice-s1c-input-v1", baseline, planBytes, changeSet, evidenceRefs })`; `S1cResult` has `formalVerdict` and `candidateScopeComparison`.
- `src/core/s1c/policy.ts` and `src/core/s1c/path-rules.ts`: existing exported `extractTaskScopePolicy`, `inspectChangeSet`, and `compareCandidatePaths` scope primitives; `src/core/s1b/baseline.ts`: existing `inspectBaseline`.

**Non-negotiable meaning:**

1. `S1-a identityStatus: MATCH` is only an identity comparison against caller-supplied, digest-pinned material. `ownerAuthorityStatus` is `NOT_PROVEN` and `eligibleBaseline` remains `false`.
2. S1-b `MATCH` and `MATCHED_REF_PRESENT` mean association/reference presence, not evidence authenticity, execution success, AC satisfaction, or approval. `reportedOutcome` and `reportedExecutionState` remain claims.
3. S1-c `candidateScopeComparison` can indicate `WITHIN_CANDIDATE_SCOPE` or `OUTSIDE_CANDIDATE_SCOPE`; neither may be promoted to a formal PASS/FAIL.
4. The existing S1-c implementation returns `formalVerdict: UNKNOWN` with `ownerAuthorityVerification: NOT_VERIFIED_BY_S1C`. S1-d must preserve those values; it must not calculate a new formal verdict.
5. `ChangeSet.availability: PRESENT` only describes caller-provided paths; S1-d cannot assert that the list is a complete Git diff.
6. Neither the manifest's approval reference nor claimed evidence provenance proves an independent owner trust boundary.

S1-d does not modify S1-a/b/c contracts, policies, evaluation ordering, or diagnostic codes. S1-d input recovery and report projection **do not** become new assurance authorities.

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
    (4) scope-only fallback using existing S1-c primitives, only when
        S1-c cannot be invoked because Evidence source was not decoded
           |
           v
Immutable S1-d report projection (includes declared provenance)
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
- `src/core/s1d/report.ts`: immutable report construction from existing core outputs and all-or-nothing validated provenance; no core diagnostic reimplementation.
- `src/core/s1d/formatter.ts`: pure Text and canonical JSON rendering.
- `tests/s1d/`: core-report and CLI fixture tests.
- `package.json`: an eventual `justice-s1d` bin mapping and build inclusion, **only after separate implementation authorization**.

The core-report functions receive data and return data; they do not import OpenCode, use the filesystem, execute commands, or persist output. The runtime boundary alone owns local I/O.

## 5. CLI grammar and input specification — F-001

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
- The Evidence JSON file is a **raw JSON array** of existing `EvidenceRefV1` items (0–128). An empty array means *no supplied references*, not “execution was successful”. A parsed non-array is **Core input/schema-invalid**, not a JSON syntax error; never interpret it as `[]`.
- The ChangeSet JSON file is an existing `ChangeSet` value. For unavailable change data, the caller must explicitly provide `{"availability":"UNAVAILABLE"}`. An empty `PRESENT` changes array is a positive caller claim of no changes and is not interchangeable with `UNAVAILABLE`.
- Read bounded bytes and decode strict UTF-8 **before** strict JSON syntax parsing (including duplicate keys/depth constraints). Existing `parseStrictJson` behavior is reused for syntax. Parsed values remain **untrusted `unknown`** until the existing S1-b/S1-c runtime validators have assessed them.
- Proposed I/O caps for **S1-d-only new files**: Evidence JSON ≤ 1,048,576 bytes and ChangeSet JSON ≤ 262,144 bytes. Existing S1-a per-input/per-artifact limits, S1-b 128-EvidenceRef limit, S1-c 128-entry ChangeSet validation, and 8,388,608-byte Plan cap remain authoritative.

### 5.1 Plan bytes handoff without unbound second read

`LoaderResult.selectedRefs` identifies the selected Plan and its expected/observed digest but does **not** contain Plan bytes or `relativePath`. S1-c needs the original `planBytes`.

Design decision: inject a read-only `S1aReadOnlySource` wrapper that captures a bounded, copied snapshot of S1-a reads **within this invocation**. Use the same manifest snapshot parsed under S1-a's strict manifest contract to associate the selected Plan's `artifactId` with its relative path and captured bytes. Only pass the Plan bytes observed during the S1-a run to S1-c. No arbitrary CLI `--plan` override, independent unverified path, or silent second read is permitted.

- A selected Plan must be unique, present among the selected references, and traceable to the captured manifest and its read path.
- If S1-a could not read that Plan, cannot identify it unambiguously, or the captured bytes are unavailable, mark S1-c `NOT_EVALUATED` with an explicit reason. Do not synthesize Plan bytes.
- S1-c itself independently checks the Plan-byte SHA-256 against the S1-a selected expected and observed digest and requires the existing baseline readiness.
- Use defensive copies or immutable ownership of captured bytes so a formatter or caller cannot mutate them between stages.
- Snapshotting avoids an unnecessary re-read, but does not prove cross-path filesystem race freedom, owner origin, or atomicity of the entire directory tree. Preserve existing S1-a limitations.

### 5.2 Two distinct kinds of new-input failure

**Level A — transport/decoding failure (no parsed value exists):** for each of `--evidence` and `--changeset` independently, classify in fixed precedence: `INPUT_READ_FAILED` (including nonregular/unsafe path), `INPUT_TOO_LARGE`, `INPUT_UTF8_INVALID`, `INPUT_JSON_INVALID` (syntax, duplicate keys, depth). These are S1-d **input issues**, not S1-b `INPUT_REJECTED` or S1-c `CHANGESET_INVALID`. No source data may be fabricated to invoke a dependent core. Continue any *independent* valid diagnosis (§6). Do not elevate partial results.

**Level B — parsed JSON, but Core schema/type/semantic invalid:** strict JSON parsing succeeds and yields an `unknown` value. Existing Core validation decides the outcome, including an Evidence non-array, illegal field, unsafe ID, duplicate Evidence ID, >128 entries, or an invalid ChangeSet shape/entry. `inspectEvidenceRefs` and `bindEvidence` may return S1-b `INPUT_REJECTED` with `rejectionReasonCode`; `evaluateS1c` may return `S1B_INPUT_REJECTED` and/or `CHANGESET_INVALID`. **Do not treat such outcomes as a fatal JSON parse failure.** Continue the other valid diagnostic branch.

To allow existing guarded Core runtime validation to report a parsed but schema-invalid value, a single narrowly documented untrusted-input adapter may pass that `unknown` into the already-defensive `bindEvidence` / `evaluateS1c` call boundary (with an explicit TypeScript assertion if required). This is **not** a claim that the value satisfies `EvidenceRefV1[]` or `ChangeSet`; all trusted report projection still requires successful `inspectEvidenceRefs` / Core validation. Do not create separate permissive schemas or change existing TypeScript Core contracts.

The `inputIssues` in §7 describe only Level A failures. Each source produces at most one issue (first failure by the fixed precedence), and issues are emitted in source order `evidence`, then `changeset`. Level B details remain in the existing Core results, without duplicating their validation logic.

## 6. Evaluation order, independent continuation, and stage semantics — F-001

1. Parse CLI grammar. A grammar error is fatal (§8); no Core functions are called.
2. Independently perform bounded reads, strict UTF-8 decoding, and strict JSON syntax parsing for Evidence and ChangeSet. Record Level A issues for each source without cancelling the other source. Do **not** translate a failure into `[]`, `UNAVAILABLE`, a fabricated Core result, or a success status.
3. Execute S1-a `loadS1aArtifacts` using the existing read-only source, capturing bounded Plan bytes. Its own invalid/missing inputs are reported by the S1-a Core where possible.
4. If Evidence has a parsed JSON value (whether Core-valid or Core-invalid), call S1-b `bindEvidence` with the exact S1-a `LoaderResult`; it alone yields `EVALUATED`, `BASELINE_UNKNOWN`, or `INPUT_REJECTED`. If Evidence has Level A failure, S1-b stage is `NOT_EVALUATED`.
5. If Evidence and ChangeSet both have parsed JSON values and a uniquely associated captured Plan exists, invoke S1-c `evaluateS1c` with the exact S1-a baseline, Plan bytes, and both parsed values. Its built-in S1-b validation and ChangeSet inspector deliberately continue independently: an Evidence Core failure does **not** erase a valid candidate-scope comparison; a ChangeSet Core failure does **not** erase Evidence-related diagnostics. The Core may return `S1B_INPUT_REJECTED` / `CHANGESET_INVALID` alongside other diagnostics. Keep the returned `S1cResult` unmodified.
6. If Evidence has a **Level A** failure and ChangeSet has a parsed JSON value (including Core-invalid or explicit `UNAVAILABLE`), the full S1-c input is unavailable: set the S1-c stage to `NOT_EVALUATED` and **MUST include exactly one** separate `scopeFallback` (§7). This presence rule applies even when the S1-a baseline is not `READY`, the captured Plan is unavailable, or the ChangeSet fails Core validation: those cases yield `scopeFallback.state: NOT_EVALUATED`, not an omitted field. Evaluate candidate scope **only** when `inspectBaseline` is `READY`, `inspectChangeSet` is `PRESENT`, the Plan snapshot is uniquely associated and digest-matched, and `extractTaskScopePolicy` is `READY`; then use existing `compareCandidatePaths` and set `scopeFallback.state: EVALUATED`. Use **only** existing S1-c scope primitives plus the existing required Plan SHA-256/association checks. Never produce an `S1cResult`, formal verdict, or Evidence diagnostic from the fallback; the fallback's evaluated form must state `NO_FORMAL_S1C_RESULT`.
7. If ChangeSet has a **Level A** failure, Evidence may still yield a full S1-b Core result. S1-c is `NOT_EVALUATED`, and no ChangeSet comparison is claimed. `scopeFallback` **MUST be omitted** because no parsed ChangeSet exists, even when Evidence also has a Level A failure. Do not call S1-c with a made-up `UNAVAILABLE` ChangeSet. If both are Level A-invalid, retain S1-a and both input issues.
8. Project immutable results, validated reported provenance (§7), input issues, and any scope-only fallback; render exactly one Text or JSON record (§8).

**Stage state is separate from a Core result:**

- `EVALUATED` means the actual corresponding Core returned a result. That result may contain `MISMATCH`, `UNKNOWN`, `INPUT_REJECTED`, or `CHANGESET_INVALID`.
- `NOT_EVALUATED` means no corresponding Core result was computed. Stable `reason` is one of `EVIDENCE_SOURCE_UNAVAILABLE`, `CHANGESET_SOURCE_UNAVAILABLE`, `PLAN_SNAPSHOT_UNAVAILABLE`, `PREREQUISITE_UNAVAILABLE`, or `INPUT_SOURCE_UNAVAILABLE` (for S1-a failure outside its own recoverable result). No synthetic Core result is created.
- `scopeFallback` is **not S1-c stage evaluation**. In any constructible **partial report**, it is present **if and only if** Evidence has a Level A failure **and** ChangeSet has a parsed JSON value; S1-c is then `NOT_EVALUATED`. Fatal-error records (§8) never contain `scopeFallback`. For every other case (both parsed, or ChangeSet Level A failure), omit `scopeFallback` entirely, rather than emit `null` or an invented comparison. The fallback cannot change the S1-c stage state or existing S1-c diagnostic ordering.
- **Fixed fallback decision order:** (a) `inspectBaseline` must be `READY`; otherwise fallback is `NOT_EVALUATED/PREREQUISITE_UNAVAILABLE` even when Plan bytes were captured (S1-c itself does not compare Scope for a `NOT_READY` baseline). (b) Run `inspectChangeSet` on parsed input: `INVALID` => `NOT_EVALUATED/CHANGESET_INVALID`; `UNAVAILABLE` => `NOT_EVALUATED/CHANGESET_UNAVAILABLE`; only `PRESENT` continues. (c) Require a unique selected Plan snapshot bound to the manifest, with bytes matching both selected `expectedDigest` and `observedDigest` and digest outcome `MATCH`; otherwise `NOT_EVALUATED/PLAN_SNAPSHOT_UNAVAILABLE`. (d) Use `extractTaskScopePolicy`; `UNDEFINED`, `INVALID`, and `REFERENCE_MISMATCH` each yield the corresponding `NOT_EVALUATED` reason. (e) Only for all prerequisites satisfied, use `compareCandidatePaths` to emit `EVALUATED` with the existing candidate comparison and `outsidePaths`. No fallback path asserts verified ChangeSet completeness or Owner approval.
- If no valid selected Plan bytes exist, S1-c `NOT_EVALUATED` even if S1-b returned a useful result. If S1-a's baseline is `NOT_READY` but the Plan capture exists, S1-c may still be invoked so its existing `S1A_BASELINE_NOT_READY` diagnostic can be preserved. Do not create a new authorization check.

### 6.1 Required outcome matrix

Here `E` = `EVALUATED`, `NE` = `NOT_EVALUATED`; `R` = JSON `justice-s1d-report-v1` or its Text equivalent; all lines end in `\n`. All rows assume a valid CLI invocation except the two fatal rows. **Scope-comparison expectations** in the `E` fallback case require S1-a `inspectBaseline: READY`, a uniquely captured/digest-matched Plan, a parsed Core-valid `ChangeSet` with `availability: PRESENT`, and a `READY` scope policy. When baseline is `NOT_READY`/`MALFORMED`, existing S1-c does not compare Scope, and the fallback must also not compare it. The fallback **presence rule** (§6) depends only on Evidence Level A failure plus parsed ChangeSet; successful Scope comparison requires the stricter prerequisites. All Level A rows that produce `R` also carry the respective `inputIssues`; no `R` implies acceptance or a fabricated formal verdict.

| Inputs / situation | S1-a | S1-b | S1-c | Other result | Exit | stdout |
| --- | --- | --- | --- | --- | --- | --- |
| All decodable and Core-valid; Plan captured; baseline `READY` | E | E | E | `formalVerdict: UNKNOWN` preserved; actual scope per Core | `0` | `R` |
| Evidence parses but fails Core validation; baseline `READY`, valid `PRESENT` ChangeSet/policy/Plan | E | E (`INPUT_REJECTED`) | E (`S1B_INPUT_REJECTED`; valid scope retained) | `provenance` withheld; fallback **omitted** | `0` | `R` |
| ChangeSet parses but fails Core validation; valid Evidence | E | E | E (`CHANGESET_INVALID`; evidence retained) | No candidate scope claimed; fallback **omitted** | `0` | `R` |
| Evidence Level A failure; parsed `PRESENT` ChangeSet; baseline `READY`, Plan and policy `READY` | E | NE | NE | `inputIssues`; fallback **present/E**, candidate scope only, no formal verdict | `3` | `R` |
| Evidence Level A failure; parsed `PRESENT` ChangeSet; baseline `NOT_READY` | E | NE | NE | fallback **present/NE** (`PREREQUISITE_UNAVAILABLE`); no scope comparison even if Plan captured | `3` | `R` |
| Evidence Level A failure; parsed `PRESENT` ChangeSet; baseline `READY` but Plan snapshot missing/unbound | E | NE | NE | fallback **present/NE** (`PLAN_SNAPSHOT_UNAVAILABLE`); no scope comparison | `3` | `R` |
| Evidence Level A failure; parsed `PRESENT` ChangeSet; baseline/Plan `READY`, scope policy not `READY` | E | NE | NE | fallback **present/NE** (`SCOPE_POLICY_UNDEFINED` / `SCOPE_POLICY_INVALID` / `SCOPE_POLICY_REFERENCE_MISMATCH`) | `3` | `R` |
| Evidence Level A failure; parsed ChangeSet explicitly `UNAVAILABLE`; baseline `READY` | E | NE | NE | fallback **present/NE** (`CHANGESET_UNAVAILABLE`) | `3` | `R` |
| Evidence Level A failure; parsed Core-invalid ChangeSet; baseline `READY` | E | NE | NE | fallback **present/NE** (`CHANGESET_INVALID`) | `3` | `R` |
| ChangeSet Level A failure, valid Evidence | E | E | NE | `inputIssues`; fallback **omitted** | `3` | `R` |
| Both new sources Level A-invalid | E | NE | NE | Two input issues; fallback **omitted**, no invented input | `3` | `R` |
| Plan missing/unbound, both new inputs decodable | E | E | NE | `PLAN_SNAPSHOT_UNAVAILABLE`; fallback **omitted** | `3` | `R` |
| Valid CLI but S1-a candidate mismatch, Plan captured, both inputs parsed | E | E (possibly `BASELINE_UNKNOWN`) | E (possibly `S1A_BASELINE_NOT_READY`) | Actual S1-c Scope `UNKNOWN` when baseline `NOT_READY`; fallback **omitted** | `0` | `R` |
| Invalid CLI grammar | NE | NE | NE | Fatal error (§8), no report | `64` | `justice-s1d-error-v1` / Text fatal |
| Unexpected internal failure | No guaranteed results | No guaranteed results | No guaranteed results | Fatal error (§8), no invented results | `70` | `justice-s1d-error-v1` / Text fatal |

`0` is **pipeline execution completeness**, never a claim of diagnostic success, verified evidence, or acceptance. `3` indicates incomplete execution, not a formal assurance failure. Both Level A failures and Core-invalid Level B findings retain the independent diagnostics as shown.

## 7. Report model, declared Evidence provenance, and formatting — F-002

The initial JSON representation is an S1-d **report envelope** around the **unchanged** Core results, not a replacement for their schemas:

~~~typescript
type Stage<T> =
  | Readonly<{ state: "EVALUATED"; result: T }>
  | Readonly<{ state: "NOT_EVALUATED"; reason: StageSkipReason }>;

type InputIssue = Readonly<{
  source: "evidence" | "changeset";
  code: "INPUT_READ_FAILED" | "INPUT_TOO_LARGE" | "INPUT_UTF8_INVALID" | "INPUT_JSON_INVALID";
}>;

type EvidenceProvenanceClaim = Readonly<{
  evidenceId: string;
  issuerId: string;
  originId: string;
  provenanceClass: ProvenanceClass; // existing EvidenceRefV1 union
}>;

type ProvenanceProjection =
  | Readonly<{
      state: "CLAIMS_AVAILABLE";
      validation: "ALL_EVIDENCE_REFS_STRUCTURALLY_VALID";
      verification: "NOT_VERIFIED";
      claims: readonly EvidenceProvenanceClaim[];
    }>
  | Readonly<{
      state: "WITHHELD";
      reason: "EVIDENCE_SOURCE_UNAVAILABLE" | "EVIDENCE_SET_INVALID" |
        "BINDING_NOT_AVAILABLE" | "BINDING_INCONSISTENT";
      claims: readonly []; // never emit a valid-looking partial projection
    }>;

type ScopeFallback =
  | Readonly<{
      state: "EVALUATED";
      provenance: "S1C_EXISTING_SCOPE_PRIMITIVES";
      candidateScopeComparison: "WITHIN_CANDIDATE_SCOPE" | "OUTSIDE_CANDIDATE_SCOPE";
      outsidePaths: readonly string[];
      formalVerdictAvailable: false;
      limitation: "NO_FORMAL_S1C_RESULT";
    }>
  | Readonly<{
      state: "NOT_EVALUATED";
      reason: "PREREQUISITE_UNAVAILABLE" | "PLAN_SNAPSHOT_UNAVAILABLE" |
        "SCOPE_POLICY_UNDEFINED" | "SCOPE_POLICY_INVALID" |
        "SCOPE_POLICY_REFERENCE_MISMATCH" | "CHANGESET_INVALID" | "CHANGESET_UNAVAILABLE";
    }>;

type S1dReportV1 = Readonly<{
  schemaVersion: "justice-s1d-report-v1";
  operation: "diagnose";
  readOnly: true;
  stages: Readonly<{
    s1a: Stage<LoaderResult>;
    s1b: Stage<BinderResult>;
    s1c: Stage<S1cResult>;
  }>;
  inputIssues: readonly InputIssue[];
  provenance: ProvenanceProjection;
  scopeFallback?: ScopeFallback; // required iff Evidence Level A and ChangeSet parsed; omitted otherwise
  limitations: readonly string[];
}>;
~~~

`StageSkipReason` in this document denotes the fixed §6 list of skip reasons, not arbitrary error text. `scopeFallback?` represents **conditional field presence**, not optional execution under the trigger: with Evidence Level A failure and parsed ChangeSet, emit exactly one `ScopeFallback` whose state follows the fixed §6 decision order; otherwise omit the field entirely. `NOT_EVALUATED` requires a listed reason and must not carry `candidateScopeComparison`, `outsidePaths`, or `formalVerdictAvailable`. An `EVALUATED` fallback is allowed only after the existing primitives established an actual candidate-scope comparison; its `formalVerdictAvailable` stays `false`. These are report-only types; no Core type or evaluator order changes.

### 7.1 Provenance projection is all-or-nothing and declarative

`BinderResult` contains `evidenceId`, binding status, reported execution/outcome, and verification limitations, but **not** `issuerId`, `originId`, `provenanceClass`, or the complete original `EvidenceRefV1`. S1-d therefore adds a **report-only** view, never a field to `BinderResult`.

1. Run the existing `inspectEvidenceRefs(parsedEvidenceUnknown)` against the **entire** decoded Evidence JSON array. Require `issueCodes.length === 0` **and** `refs !== null`; ensure that the S1-b stage returned a result whose `evaluationStatus` is `EVALUATED` or `BASELINE_UNKNOWN` (not `INPUT_REJECTED`). These are the only conditions for `CLAIMS_AVAILABLE`.
2. Construct `EvidenceProvenanceClaim` solely from that validator's canonical `refs`, not by copying individual fields from unvalidated raw JSON or a partially accepted list. Copy the four exact fields `evidenceId`, `issuerId`, `originId`, and `provenanceClass` without adding claims about their accuracy. Sort lexically by `evidenceId` and make a defensive immutable snapshot.
3. Cross-check that each projected `evidenceId` is present **exactly once** in that run's S1-b `bindingResults`, and that the two sets are identical. If the binding result is unexpectedly inconsistent, mark the entire projection `WITHHELD` with reason `BINDING_INCONSISTENT` and preserve the unmodified Core result; do not fill missing IDs or issue partial projections. For `BASELINE_UNKNOWN`, the original binding results remain `UNKNOWN`; only the reported source IDs can be shown.
4. If the source has Level A failure, emit `WITHHELD/EVIDENCE_SOURCE_UNAVAILABLE`. If Evidence-set validation fails, emit `WITHHELD/EVIDENCE_SET_INVALID`. If S1-b is `NOT_EVALUATED` or returns `INPUT_REJECTED` for an unrelated baseline defect, emit `WITHHELD/BINDING_NOT_AVAILABLE`. In every withheld case use **empty** claims; distinguish malformed Evidence from a binding-stage limitation. Never publish fields from valid-looking entries inside an invalid batch.
5. A structurally valid **empty** Evidence array yields `CLAIMS_AVAILABLE` with `claims: []`. This says only “no declarations supplied”; it is not a successful test or AC satisfaction.

The words `issuerId`, `originId`, and `provenanceClass` refer to **reported source metadata**. `validation: ALL_EVIDENCE_REFS_STRUCTURALLY_VALID` validates only form, supported enum values, and IDs; `verification: NOT_VERIFIED` explicitly denies independent authenticity/provenance confirmation. These claims cannot establish Owner approval, host execution, or Evidence trust even when `provenanceClass` is `FIXTURE_OBSERVATION` or `UNVERIFIED_EXTERNAL`.

### 7.2 Text / JSON semantic parity

- Preserve `LoaderResult`, `BinderResult`, and `S1cResult` exactly as returned, including UNKNOWN, reason codes, Evidence IDs, diagnostics, candidate-scope comparison, reported claims, and limitations. No cross-stage formal PASS/FAIL.
- JSON uses deterministic property ordering, stable array ordering, and exactly one newline-terminated record. Provenance is separate from `stages.s1b.result`; report-only field names cannot masquerade as Core proof.
- Text renders the **same** reported provenance claims with labels `reported issuer`, `reported origin`, `reported provenance class`, and `authenticity not verified`; if withheld, show `Evidence source claims: WITHHELD (reason)` rather than any partial IDs.
- If fallback `EVALUATED`, Text visibly labels it `candidate scope only (S1-c full evaluation NOT_EVALUATED)` and renders the validated `outsidePaths`. If fallback `NOT_EVALUATED`, Text reports `candidate scope only: NOT_EVALUATED (reason)` with **no** path comparison, including on S1-a baseline `NOT_READY`. In both forms, the formatter prints `Formal verdict: NOT_EVALUATED` as a **presentation label only**, because no `S1cResult` exists; never print a synthetic `formalVerdict: UNKNOWN`. An `EVALUATED` fallback is not proof of ChangeSet completeness.
- The report-level `limitations` is the deterministic, deduplicated, lexically ordered union of evaluated stage limitations plus relevant S1-d boundaries including `OWNER_AUTHORITY_NOT_PROVEN`, `DECLARED_PROVENANCE_NOT_VERIFIED`, and, for fallback, `NO_FORMAL_S1C_RESULT`; it does not erase stage-native limitations.
- Do not include invocation time, random IDs, environment variables, process IDs, absolute host paths, or raw unvalidated input bytes. Escape every textual identifier/path to prevent control-character spoofing. No unbounded raw JSON dumps or arbitrary exception strings.
- `formatText(report)` and `formatJson(report)` are pure: the same immutable input yields byte-identical output without filesystem, clock, process state, network, or policy decisions.

Illustrative only (not executed):

~~~text
Justice S1-d — READ_ONLY diagnostic
S1-a: EVALUATED  identity=MATCH  owner_authority=NOT_PROVEN
S1-b: EVALUATED  evaluation=EVALUATED  authenticity=NOT_VERIFIED
S1-c: EVALUATED  candidate_scope=OUTSIDE_CANDIDATE_SCOPE
Formal verdict: UNKNOWN (Owner authority not verified)
Finding: OUTSIDE_CANDIDATE_SCOPE src/example.ts
Evidence source claims: 1 structurally valid, NOT VERIFIED
  evidence=evidence-001 reported issuer=issuer-001 reported origin=origin-001
  reported provenance class=SELF_DECLARED; authenticity not verified
This diagnostic is not an acceptance or a Gate decision.
~~~

## 8. Exit codes, stdout, and fatal machine-readable errors — F-001

Process exit status describes **CLI execution**, never assurance or Gate approval. The §6.1 matrix is normative.

| Code | Meaning | stdout |
| --- | --- | --- |
| `0` | Valid invocation; all three diagnostic Core stages returned a result, even if their outcomes contain `UNKNOWN`, `INPUT_REJECTED`, or `CHANGESET_INVALID` | One `S1dReportV1` (or Text equivalent) |
| `3` | At least one stage `NOT_EVALUATED` because the required input was not decodable, associated, or otherwise safely available | One **partial** `S1dReportV1` including input issues/skipped reasons and independent results |
| `64` | Fatal CLI grammar/flag error | One bounded `justice-s1d-error-v1` (or Text equivalent) |
| `70` | Fatal unexpected internal error; no reliable structured report can be produced | One bounded `justice-s1d-error-v1` (or Text equivalent) |

Previously proposed `65` for malformed or over-limit Evidence/ChangeSet JSON is **withdrawn**: per-input Level A failure now returns `3` while allowing independent diagnosis. The existing `justice-s1a check` exit codes are not changed.

Normative fatal JSON (not a report envelope, no fabricated stages):

~~~typescript
type S1dFatalErrorV1 = Readonly<{
  schemaVersion: "justice-s1d-error-v1";
  operation: "diagnose";
  status: "ERROR";
  error: Readonly<{
    category: "CLI_USAGE" | "INTERNAL_FAILURE";
    code: "CLI_ARGUMENT_INVALID" | "UNEXPECTED_INTERNAL_ERROR";
  }>;
}>;
~~~

~~~json
{"schemaVersion":"justice-s1d-error-v1","operation":"diagnose","status":"ERROR","error":{"category":"CLI_USAGE","code":"CLI_ARGUMENT_INVALID"}}
~~~

- For `--format json` parsed unambiguously, emit only this machine-readable object + `\n`. For `text` or an invalid/ambiguous `--format`, use a fixed, sanitized one-line Text fatal message + `\n`; do not guess format from untrusted content.
- `64`: `CLI_USAGE/CLI_ARGUMENT_INVALID`; `70`: `INTERNAL_FAILURE/UNEXPECTED_INTERNAL_ERROR`. No path, stack, user-supplied argument, environment string, arbitrary exception message, or raw Evidence content.
- Exactly **one** stdout final record per invocation (report or fatal), newline-terminated. Stderr is empty under the designed standard path; no intermediate result is emitted as a second record. Any unexpected formatter failure must use a fixed safe fatal fallback rather than leaking a partial report.
- A syntactically parsed but invalid Evidence/ChangeSet is a normal Core rejection, not a fatal exit; it can yield exit `0` when all three stages ran. Level A failure yields `3` with a normal partial report. Never translate these into an assurance PASS.

## 9. Trust, security, and read-only limits — F-002

- Local paths and JSON are untrusted. Reuse `createS1aReadOnlySource()`; reject unsafe/nonregular/symlink traversal according to existing adapter behavior, never relax it for S1-d. Preserve size/count/depth limits and bounded output.
- Evidence source metadata is **input-supplied declaration**, even when every field passed `inspectEvidenceRefs`. `issuerId`, `originId`, and `provenanceClass` do not imply identity proof, signer verification, source authenticity, or execution observation. The report's `NOT_VERIFIED` tag remains visible in both Text and JSON.
- A partly invalid Evidence batch yields **no provenance claims**; an unreadable/undecodable Evidence source yields **no claims** and never a synthetic empty array. No fallback may reconstruct issuer/origin from `BinderResult` because those fields do not exist there.
- The fallback scope projection can only use already validated and bound Plan bytes, the parsed and valid ChangeSet, and existing S1-c exported primitives. It is not a new formal evaluation or a way around `S1cResult.formalVerdict: UNKNOWN`.
- Report provenance precisely: agent-reported `EXECUTED`/`PASS` remains reported; Owner authority, external Evidence authenticity, actual host execution, ChangeSet completeness, supersession, and full filesystem race freedom remain unverified.
- Runtime operations are limited to bounded local reads, in-process calculation, stdout/error reporting, and process exit. No input modification, cache writes, Git operations, network, subprocess, runtime setting mutation, Task/Review/Fix, or Gate/HOLD change.
- A serious input safety violation prevents the affected read/diagnostic operation (fail closed for that action), but independent safely obtained results can still be explained. Do not create a new workflow stop or approval gate.

## 10. Minimum acceptance test design — F-001 and F-002 (future implementation only)

| Case | Expected observable outcome |
| --- | --- |
| Same fixed Fixture run twice | Byte-identical Text/JSON per format, stable status and provenance ordering |
| All inputs valid, S1-a ready, within/outside candidate scope | All stages `EVALUATED`, exit `0`, one report record; `formalVerdict` remains `UNKNOWN` |
| Evidence strict JSON parsed but violates Core schema (non-array, duplicate ID, bad provenanceClass, >128) | S1-b `INPUT_REJECTED`; S1-c `S1B_INPUT_REJECTED`; valid Scope remains available; exit `0`; provenance `WITHHELD` with no partial claims |
| ChangeSet strict JSON parsed but Core-invalid (bad shape or invalid entry) | S1-b retains valid Evidence binding/coverage; S1-c emits `CHANGESET_INVALID`; exit `0`, candidate Scope unknown, Evidence provenance retained only if fully valid |
| Evidence read error, oversize, invalid UTF-8, invalid JSON or duplicate JSON key (separate cases); baseline `READY` with captured Plan, `PRESENT` valid ChangeSet and `READY` policy | S1-b/S1-c `NOT_EVALUATED`; fallback **required/EVALUATED** with valid candidate-scope comparison, exit `3`, one partial report; no invented Evidence |
| ChangeSet read error, oversize, invalid UTF-8, invalid JSON or duplicate key (separate cases) | S1-b `EVALUATED` with genuine Evidence result; S1-c `NOT_EVALUATED`; fallback **omitted**; exit `3`; one partial report, no invented `UNAVAILABLE` |
| Evidence Level A, ChangeSet valid `PRESENT`, baseline `NOT_READY` despite a captured Plan | Fallback **present/NOT_EVALUATED** (`PREREQUISITE_UNAVAILABLE`), no `compareCandidatePaths` call, no `outsidePaths`; S1-c `NOT_EVALUATED`; exit `3`; one partial `R` |
| Evidence Level A, ChangeSet valid `PRESENT`, baseline `READY`, Plan bytes/association missing | Fallback **present/NOT_EVALUATED** (`PLAN_SNAPSHOT_UNAVAILABLE`), no scope comparison; exit `3`; one partial `R` |
| Evidence Level A, ChangeSet valid `PRESENT`, baseline and Plan `READY`, policy `UNDEFINED`/`INVALID`/`REFERENCE_MISMATCH` | Fallback **present/NOT_EVALUATED** with respective policy reason, no candidate scope or formal verdict; exit `3`; one partial `R` |
| Evidence Level A, ChangeSet parsed `UNAVAILABLE` or Core-invalid with baseline `READY` (separate cases) | Fallback **present/NOT_EVALUATED** with `CHANGESET_UNAVAILABLE` or `CHANGESET_INVALID` respectively; no synthetic `PRESENT`; exit `3`; one partial `R` |
| Evidence Level A and ChangeSet Level A simultaneously | Fallback **omitted**; S1-b/S1-c `NOT_EVALUATED`, both input issues retained, exit `3`; one partial `R` |
| Evidence Core-invalid (Level B), ChangeSet valid; baseline `NOT_READY` | S1-b returns `INPUT_REJECTED`; S1-c runs and preserves existing `S1A_BASELINE_NOT_READY` with candidate Scope `UNKNOWN`; fallback **omitted**, exit `0` |
| Both new files undecodable | S1-a report retained, two distinct input issues, S1-b/S1-c skipped, exit `3` |
| Missing/bad Plan snapshot or non-ready S1-a | Existing S1-a findings retained; when both inputs parse **and Plan bytes are captured**, S1-c runs with its unchanged precondition/order and returns `S1A_BASELINE_NOT_READY` with Scope `UNKNOWN` for non-ready S1-a; fallback is omitted. When Plan bytes are missing, S1-c is `NOT_EVALUATED`. When Evidence is Level A and ChangeSet parses, fallback is **present/NOT_EVALUATED** with `PREREQUISITE_UNAVAILABLE` for non-ready baseline, or `PLAN_SNAPSHOT_UNAVAILABLE` for missing/bad snapshot after a ready baseline. No fake formal result |
| Valid but empty Evidence array | `CLAIMS_AVAILABLE` with zero claims; no claimed execution success or AC satisfaction |
| Two valid EvidenceRefs with distinct declared issuer/origin/provenance | JSON claims and Text claim rows match by Evidence ID and values, sorted deterministically; both label declarations as `NOT_VERIFIED` |
| One malformed EvidenceRef among otherwise valid refs | `inspectEvidenceRefs` rejects entire batch; `provenance: WITHHELD` and `claims: []` for Text **and** JSON; no partial trusted metadata |
| S1-b returns `BASELINE_UNKNOWN` with structurally valid evidence | Provenance may display declarations keyed to each S1-b Evidence ID, but binding status remains `UNKNOWN` and authenticity is unverified |
| S1-b returns `INPUT_REJECTED` for any reason | No provenance from invalid or unassociated evidence; no inferred issuer/origin from BinderResult |
| Evidence Core-invalid + ChangeSet Core-invalid simultaneously | Both `S1B_INPUT_REJECTED` and `CHANGESET_INVALID` surfaced by existing S1-c; no overwrite/suppression; exit `0` if all three invoked |
| Out-of-scope rename / no S1-c scope policy | Existing path/policy semantics preserved; no invented formal PASS/FAIL |
| Invalid CLI flags with `--format json` | Exit `64`, exact schema `justice-s1d-error-v1`, one stdout JSON record, no stages; safe literal error codes |
| Unexpected internal error | Exit `70`, fixed safe JSON/Text fatal, no stack, path, or second output record |
| Result formatting parity under hostile encoded input | No newline/control injection; JSON and Text contain identical statuses, Evidence IDs, reported sources, and verification limitations |
| Read-only effects | No writes, subprocess, network, Task/Review/Fix/Gate activity |

Future implementation verification, **not executed here**: deterministic core-report and formatter tests; mocked CLI/read-only-source tests; integration fixtures using existing S1-a/b/c; Bun test, typecheck, lint, and build. The Implementation Plan has not been created, so cross-document implementation-plan consistency remains a **future prerequisite**, not an assertion of current PASS.

## 11. Scope, residual risks, and Human Owner checkpoint

**This limited documentation task stops when** F-001-A is reconciled in this one Design R0.1.1 candidate while preserving F-001 and F-002, and the result is handed to the Human Owner. The original R0.1 GitHub commit and its identity must not be silently changed. No independent review, follow-up correction loop, GitHub write, or next task is automatically authorized.

**Owner decisions already made:** Integrated input-to-diagnostics CLI, existing-core reuse, pure formatter, Text/JSON, READ_ONLY, preservation of `formalVerdict: UNKNOWN` and other trust boundaries, no result-import mode in MVP.

**Design calls proposed here (not independently Owner approved):** CLI flags, input byte caps, per-file Level A/Level B separation, the now-deterministic presence and evaluation rules for scope-only fallback using S1-c primitives, JSON envelope with `inputIssues`/`provenance`/`scopeFallback`, exit codes `0/3/64/70`, all-or-nothing provenance policy, and suggested module layout.

**Remaining risk:** The fallback and narrowly guarded untrusted parsed-input boundary need implementation-time verification against current Core invariants. S1-a filesystem race freedom, Owner authorization, Evidence authenticity, actual Host execution, ChangeSet completeness and supersession remain unproven. None are silently promoted to proof. Unknown/unevaluated cases are not observed failures.

**Not authorized:** Source implementation, execution/tests/CI/Host Probe, production use claim, Gate/HOLD release, Requirements adoption, external/GitHub writes, automatic reviews or fix loops, Implementation Plan initiation, or S2–S5 work.

**Implementation-entry prerequisites:** Owner adoption of this detailed Design; a separately authorized Implementation Plan with confirmed agreement on terminology, types/interfaces, error behavior, tests and non-functional requirements; separately granted code-implementation authority. The missing plan is **NOT YET VERIFIED**, not a design/plan inconsistency that has already been observed.

**Owner checkpoint:** Decide whether to adopt the F-001-A-limited Design R0.1.1 candidate, request a specifically bounded correction, or stop design work. New Findings or version changes do not automatically trigger re-review. After the requested document correction, **the task ends here**.
