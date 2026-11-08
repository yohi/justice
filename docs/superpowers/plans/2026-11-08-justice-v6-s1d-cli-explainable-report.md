# Justice v6 S1-d Integrated CLI / Explainable Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` **only after separate Human Owner implementation authorization**. Steps use checkbox (`- [ ]`) syntax for tracking; **none of these steps has been executed**.
>
> **Planning status:** `PLAN_DRAFT / F-003_ALIGNED_CANDIDATE / DESIGN_OWNER_ADOPTION_PENDING / IMPLEMENTATION_NOT_AUTHORIZED`.
> **Reference identity:** `yohi/justice`, Issue #353; Design branch `feature/justice-v6-s1d-cli-explainable-report-design-20261108`, reviewed repository HEAD `573190cf19a6bff4971468f4d58da51ade90c84d`. This candidate Plan is aligned locally with the simultaneously corrected Design (§§5.1, 6, 6.1, 7, 10); neither local correction is a GitHub commit. If the branch advances, an implementer must reconcile the authorized versions before execution.

**Goal:** Integrate existing S1-a, S1-b and S1-c READ_ONLY diagnostics behind one local `justice-s1d diagnose` command, with deterministic, explainable Text/JSON output and no promotion of candidate findings to formal assurance approval.

**Architecture:** Use the existing S1-a read-only adapter and core functions, capture the original Plan bytes from the same S1-a read, dispatch independent diagnostic branches, and project the unchanged core outputs into an S1-d report. A pure formatter renders Text/JSON. A strictly conditional scope-only fallback uses *existing S1-c primitives* when Evidence cannot be parsed but ChangeSet can.

**Tech Stack:** TypeScript ES2022 (strict), Node runtime adapters, Bun, Vitest, Node crypto, existing S1-a strict JSON and file-source abstractions. No new runtime dependency, server, network service, or database.

**Spec:** `docs/superpowers/specs/2026-11-08-justice-v6-s1d-cli-explainable-report-design.md` (§1–§11), the **F-003-aligned local Design R0.1.1 candidate** provided alongside this Plan; the reviewed GitHub HEAD before local corrections is `573190cf19a6bff4971468f4d58da51ade90c84d`. Do not execute this candidate against the uncorrected GitHub Design; neither document has formal Owner adoption.

## Global Constraints

- Preserve `loadS1aArtifacts`, `bindEvidence`, `evaluateS1c` and all S1-a/b/c types, algorithms, diagnostic ordering and native limitations unmodified.
- CLI: `justice-s1d diagnose --manifest ... --manifest-sha256 <64 lowercase hex> --intent ... --artifacts-root ... --evidence ... --changeset ... [--format text|json]`. All input flags required; `--format` defaults to `text`; no result-import mode.
- Evidence input: raw JSON array, existing `EvidenceRefV1`, at most 128 entries; input file ≤ 1,048,576 bytes. ChangeSet input: existing `ChangeSet`, ≤ 262,144 bytes. S1-a and S1-c original per-file/Plan limits unchanged.
- Read-only: bounded local reads, in-process computation, one newline-terminated stdout record and process exit only. No Git/host probe/subprocess/network, file writes, Task/Review/Fix dispatch or Gate/HOLD mutation.
- Level A failures (`INPUT_READ_FAILED`, `INPUT_TOO_LARGE`, `INPUT_UTF8_INVALID`, `INPUT_JSON_INVALID`) are **not** Level B (`S1-b INPUT_REJECTED`, S1-c `CHANGESET_INVALID`). Never fabricate `[]`, `UNAVAILABLE`, `S1cResult`, or formal approval.
- Stage `EVALUATED` means a core returned a result; it does **not** imply PASS. Core `formalVerdict: UNKNOWN`, `ownerAuthorityStatus: NOT_PROVEN`, `eligibleBaseline: false` and evidence `NOT_VERIFIED` retain their meaning.
- `getPlanSnapshot(result: LoaderResult): Uint8Array | null` returns **safely captured and uniquely associated** same-run Plan bytes regardless of expected Digest match; it returns `null` only for missing/unreadable/unassociated/ambiguous Plan, never just for a Digest mismatch. With both JSON inputs parsed, a non-null snapshot is sufficient to call existing S1-c, including to preserve `S1A_BASELINE_NOT_READY` on a mismatched Plan. A stronger Digest match (plus baseline `READY`, ChangeSet `PRESENT`, Scope Policy `READY`) is required for evaluating `scopeFallback`.
- `scopeFallback` must be present **iff** Evidence has Level A failure **and** ChangeSet has a parsed JSON value; its state may be `NOT_EVALUATED`; no fallback when ChangeSet Level A fails. Fallback does **not** constitute S1-c Core evaluation.
- Provenance is the complete, structurally valid, ID-associated **declaration** from `inspectEvidenceRefs`, not an authenticity check. Never expose a partial provenance set from invalid Evidence.
- Valid invocation with all three Core results: exit `0`, including negative or unknown findings. Partial stage: exit `3`. CLI usage fatal: `64`. Internal fatal: `70`. Never infer approval from exit code.
- Keep local test fixtures stable and deterministic. Do not print absolute host paths, raw attacker-controlled error text, environment values, source bytes, or unsanitized control characters.
- Execute future development commands only after Owner approval, using repository-prescribed Bun/devcontainer workflow. Do not create automatic review/revision cycles; one bounded Owner checkpoint after implementing the approved scope.

## File map and responsibilities

| File | Action | Responsibility |
| --- | --- | --- |
| `src/core/s1d/contract.ts` | Create | Stage/report/input issue/fallback/provenance/fatal types with exact literal unions |
| `src/core/s1d/report.ts` | Create | Pure, immutable report assembly, limitations union, all-or-nothing declared provenance |
| `src/core/s1d/formatter.ts` | Create | Deterministic Text/JSON and safe fatal rendering; no I/O |
| `src/core/s1d/scope-fallback.ts` | Create | Existing-S1-c-primitives-only scope evaluation for Evidence Level A |
| `src/runtime/s1d-read-only-input.ts` | Create | Independently bounded Level A JSON reads, S1-a Plan snapshot adapter |
| `src/runtime/s1d-diagnostic.ts` | Create | Single orchestration path; existing Core calls, Stage state and fallback presence |
| `src/runtime/s1d-cli.ts` | Create | CLI grammar, process-independent runner, exit codes, standalone Node entry |
| `package.json` | Modify | Add `justice-s1d` bin and `chmod` target only; keep existing CLI behavior |
| `tests/core/s1d/report.test.ts` | Create | Report/provenance and limits tests |
| `tests/core/s1d/formatter.test.ts` | Create | Text/JSON determinism, parity, safety tests |
| `tests/core/s1d/scope-fallback.test.ts` | Create | F-001-A READY/NOT_READY/Plan/Policy/ChangeSet matrix |
| `tests/runtime/s1d-read-only-input.test.ts` | Create | Level A read and Plan snapshot tests (injected source) |
| `tests/runtime/s1d-diagnostic.test.ts` | Create | Stage dispatch/Level B and independent branch tests |
| `tests/runtime/s1d-cli.test.ts` | Create | CLI grammar, stdout, exit codes, fatal envelope, READ_ONLY effects |
| `tests/runtime/s1d-cli-entry.test.ts` | Create | Built command entry smoke test, no network or writes |

No existing S1-a/b/c source or tests are modified by this plan. Source paths and signatures below are *future targets*, not existing APIs.

## Review Focus (coverage assigned below, not a new review task)

1. An Evidence source with malformed UTF-8 **and** a valid in-scope ChangeSet should produce one input issue, a conditional fallback and no S1-c formal result (Tasks 3–5).
2. A parsed Evidence object masquerading as an array must reach existing S1-b `INPUT_REJECTED`, while valid Scope remains visible in existing S1-c, not become a Level A parse failure (Tasks 3, 5).
3. S1-a baseline `NOT_READY` (including an expected Plan Digest mismatch) with safely captured/associated Plan and Evidence Level A must not run fallback path comparison; `scopeFallback` remains present with `PREREQUISITE_UNAVAILABLE` (Tasks 3–5). When both JSON inputs parse, the same mismatch must instead permit a full S1-c Core call (Task 5).
4. A single invalid `EvidenceRefV1` mixed with valid records must suppress **all** declared provenance, including otherwise plausible issuer IDs (Task 1).
5. Ambiguous `--format` and hostile control characters or host paths must not inject another stdout record, leak paths, or silently return success (Tasks 2 and 6).

---

### Task 1: Pure S1-d contract, report assembly and declared provenance

**Files:** Create `src/core/s1d/contract.ts`, `src/core/s1d/report.ts`, `tests/core/s1d/report.test.ts`.

**Interfaces:**
- Consumes: `LoaderResult`, `BinderResult`, `S1cResult`, `ProvenanceClass` from existing contracts; `inspectEvidenceRefs(value: unknown)` from `src/core/s1b/validation.ts`.
- Produces: `Stage<T>`, `InputIssue`, `ScopeFallback`, `ProvenanceProjection`, `S1dReportV1`, `S1dFatalErrorV1`, `StageSkipReason` exactly as Design §7 and §8; `projectProvenance(evidence: {state:'PARSED';value:unknown}|{state:'LEVEL_A_ERROR'}, stage: Stage<BinderResult>): ProvenanceProjection`; `assembleReport(input: {stages:S1dReportV1['stages'];inputIssues:readonly InputIssue[];provenance:ProvenanceProjection;scopeFallback?:ScopeFallback}): S1dReportV1`.
- Use a discriminated union; `ScopeFallback` cannot carry comparison fields in `NOT_EVALUATED`. No new S1-a/b/c result fields.

- [ ] **Step 1: Write failing tests** in `report.test.ts` with explicit names/expectations:
  - `projectsOnlyCompletelyValidEvidenceClaims`: two valid refs with distinct `issuerId`/`originId`/`provenanceClass` produce `CLAIMS_AVAILABLE`, lexically ordered by `evidenceId`, `verification: 'NOT_VERIFIED'`, and identical ID set to S1-b binding results.
  - `withholdsAllClaimsForOneInvalidRef`: append one invalid ref; expected `state: 'WITHHELD'`, `reason: 'EVIDENCE_SET_INVALID'`, `claims: []`, no leaked issuer.
  - `withholdsMismatchedBindingIds`: structurally valid refs with missing or duplicate binder IDs -> `BINDING_INCONSISTENT`, zero claims.
  - `retainsEmptyValidSetAndNotReadyBaseline`: empty valid evidence plus empty binder bindings -> available `[]`; valid refs plus `BASELINE_UNKNOWN` can show *declared* sources, never execution verification.
  - `unionsLimitationsAndPreservesCore`: deduplicated lexical report limitations; core result values remain byte-equivalent; `scopeFallback` absent unless explicitly supplied; defensive immutability.
- [ ] **Step 2: Run the targeted test** (future authorized execution): `bun run vitest run tests/core/s1d/report.test.ts`. Expected initially **FAIL** for absent symbols.
- [ ] **Step 3: Implement** the exact contract unions from Design §§6–8 and the two pure functions above. Use `inspectEvidenceRefs` on the full `unknown` value, not a manually filtered list; require S1-b result status `EVALUATED` or `BASELINE_UNKNOWN` and exact one-to-one binding IDs. Preserve all Core results without reinterpretation. Sort limitation strings; freeze defensive projections.
- [ ] **Step 4: Re-run** `bun run vitest run tests/core/s1d/report.test.ts`. Expected **PASS**.
- [ ] **Step 5: Commit this independently testable unit**, only after implementation authorization: `git add src/core/s1d/contract.ts src/core/s1d/report.ts tests/core/s1d/report.test.ts && git commit -m "feat(justice): add S1-d report projection"`.

### Task 2: Pure deterministic Text/JSON and fatal formatter

**Files:** Create `src/core/s1d/formatter.ts`, `tests/core/s1d/formatter.test.ts`.

**Interfaces:**
- Consumes: `S1dReportV1`, `S1dFatalErrorV1` from Task 1.
- Produces: `formatJson(report: S1dReportV1): string`, `formatText(report: S1dReportV1): string`, `formatFatal(fatal: S1dFatalErrorV1, format: 'json'|'text'): string`; every return ends in exactly one `\n`.

- [ ] **Step 1: Write failing tests**:
  - `textAndJsonRepeatByteIdentically`: same fixed report -> identical strings on successive invocations; JSON parses to the exact report envelope (without undefined optional keys).
  - `rendersUnknownWithoutPromotingToPass`: real S1-c `formalVerdict: 'UNKNOWN'` prints UNKNOWN; `scopeFallback` with S1-c `NOT_EVALUATED` prints `Formal verdict: NOT_EVALUATED` as a label, not as a synthetic Core field.
  - `rendersProvenanceAsUnverifiedDeclaration`: both formats expose same `evidenceId`, issuer, origin and class, and `NOT_VERIFIED`; `WITHHELD` reveals no partial IDs.
  - `escapesControlCharactersAndDoesNotLeakHostPath`: newline/control characters in crafted diagnostics cannot create a second line impersonating a status; no absolute-path or stack leak.
  - `fatalJsonExactEnvelope`: a `CLI_USAGE/CLI_ARGUMENT_INVALID` error produces the exact `justice-s1d-error-v1` object; internal fatal uses `INTERNAL_FAILURE/UNEXPECTED_INTERNAL_ERROR`, with no stage fields.
- [ ] **Step 2: Run** `bun run vitest run tests/core/s1d/formatter.test.ts`. Expected initially **FAIL**.
- [ ] **Step 3: Implement** pure renderers only; no I/O, clock, random IDs or derived policy. JSON property order is the `S1dReportV1` canonical field order from Design §7; normalize newline termination. Text uses escaped verified IDs/relative paths and explicit S1-a/S1-b/S1-c Stage status plus limitations; no unbounded dump of raw source.
- [ ] **Step 4: Run** `bun run vitest run tests/core/s1d/formatter.test.ts`. Expected **PASS**.
- [ ] **Step 5: Commit** `git add src/core/s1d/formatter.ts tests/core/s1d/formatter.test.ts && git commit -m "feat(justice): format S1-d Text and JSON diagnostics"` (future authorized execution only).

### Task 3: READ_ONLY Level A file reader and same-run Plan snapshot

**Files:** Create `src/runtime/s1d-read-only-input.ts`, `tests/runtime/s1d-read-only-input.test.ts`.

**Interfaces:**
- Consumes: `S1aReadOnlySource`, `LoaderInput`, `LoaderResult`; `createS1aReadOnlySource`, `parseStrictJson` and `parseOwnerManifest` existing implementations; Task 1 `InputIssue`.
- Produces:
  ```ts
  type JsonRead =
    | Readonly<{state:'PARSED'; value:unknown}>
    | Readonly<{state:'LEVEL_A_ERROR'; issue:InputIssue}>;
  function readS1dJsonInput(source: S1aReadOnlySource, path: string,
    kind: 'evidence'|'changeset'): Promise<JsonRead>;
  function createCapturedS1aSource(source: S1aReadOnlySource,
    input: LoaderInput): Readonly<{
      source: S1aReadOnlySource;
      getPlanSnapshot(result: LoaderResult): Uint8Array|null; // associated read-only bytes, NOT digest-verified
    }>;
  ```

- [ ] **Step 1: Write failing tests**:
  - `classifiesReadOversizeUtf8AndJsonIndependently`: injected `readInputFile` rejects/overflows, returns malformed UTF-8 or duplicate JSON keys; the exact issue code is `INPUT_READ_FAILED`, `INPUT_TOO_LARGE`, `INPUT_UTF8_INVALID`, `INPUT_JSON_INVALID` respectively; no fake parsed `[]`/`UNAVAILABLE`.
  - `keepsCoreInvalidJsonAsParsedUnknown`: a syntactically valid object for Evidence or invalid `PRESENT` shape for ChangeSet returns `PARSED`, not Level A failure.
  - `capturesOnlySelectedPlanWithoutReread`: use `s1aFixture()` and a digest-pinned Plan; S1-a makes each expected read once, snapshot equals original Plan bytes and is defensively copied.
  - `retainsSafelyCapturedMismatchedPlan`: S1-a observes a Plan `ARTIFACT_DIGEST_MISMATCH` and reports baseline `NOT_READY`, but the Plan bytes were read once, safely associated to the unique selected Plan; `getPlanSnapshot(result)` returns a copy **not null**, even though SHA-256 differs from `expectedDigest`. Do not label it verified or read it a second time.
  - `rejectsMissingUnboundOrAmbiguousPlanSnapshot`: absent/unreadable capture, no uniquely selected Plan or an association inconsistency yields `null`; a changed/unsafe capture must not be substituted with bytes from a second path. **Expected Digest mismatch alone is not among these null conditions.**
  - `doesNotBypassReadOnlyFilesystemGuards`: injected unsafe path, symlink rejection or `changed_during_read` is an input failure, never followed by writable or subprocess fallback.
- [ ] **Step 2: Run** `bun run vitest run tests/runtime/s1d-read-only-input.test.ts`. Expected initially **FAIL**.
- [ ] **Step 3: Implement** `readS1dJsonInput` using `source.readInputFile` with Evidence cap 1,048,576 / ChangeSet cap 262,144, strict UTF-8 decoder **before** `parseStrictJson`; honor size checks even for mocked sources; classify only fixed Level A codes and sanitize exceptions. Implement the wrapper around the *same* S1-a source; retain the manifest's exact read snapshot, derive the unique Plan path via `parseOwnerManifest` after S1-a manifest digest verification, capture only that artifact's bytes, and require unique selected `artifactId`/manifest path **association**. Preserve copied bytes if the S1-a selected Plan has a mismatched *artifact* Digest: `getPlanSnapshot` checks association, **not** artifact Digest equality, and returns `null` only for missing/unreadable/ambiguous/unbound capture. Do not introduce an independent `--plan` read.
- [ ] **Step 4: Run** `bun run vitest run tests/runtime/s1d-read-only-input.test.ts`. Expected **PASS**.
- [ ] **Step 5: Commit** `git add src/runtime/s1d-read-only-input.ts tests/runtime/s1d-read-only-input.test.ts && git commit -m "feat(justice): add bounded S1-d inputs and Plan snapshot"` (future authorized execution only).

### Task 4: Conditional, scope-only fallback using existing S1-c primitives

**Files:** Create `src/core/s1d/scope-fallback.ts`, `tests/core/s1d/scope-fallback.test.ts`.

**Interfaces:**
- Consumes: Task 1 `ScopeFallback`; existing `inspectBaseline`, `inspectChangeSet`, `extractTaskScopePolicy`, `compareCandidatePaths`, `LoaderResult` and Plan SHA-256 metadata. Task 3 passes associated snapshot bytes, **not** a digest-verified Plan.
- Produces: `computeScopeFallback(baseline: LoaderResult, planBytes: Uint8Array|null, parsedChangeSet: unknown): ScopeFallback`. Caller is responsible for invoking it **iff** Evidence Level A and ChangeSet parsed; helper never invokes `evaluateS1c` or `bindEvidence`.

- [ ] **Step 1: Write failing tests**:
  - `readyCandidateReturnsScopeOnly`: READY baseline, digest-matched Plan, valid `PRESENT` ChangeSet and READY policy -> `EVALUATED`, `provenance: 'S1C_EXISTING_SCOPE_PRIMITIVES'`, correct comparison/outside paths, `formalVerdictAvailable:false`, `limitation:'NO_FORMAL_S1C_RESULT'`.
  - `nonreadyBaselineShortCircuitsBeforePathComparison`: NOT_READY (including a Plan Digest mismatch with safely captured bytes) or malformed baseline -> `NOT_EVALUATED/PREREQUISITE_UNAVAILABLE`, no `outsidePaths`; spy asserts `compareCandidatePaths` not invoked.
  - `invalidAndUnavailableChangeSetDoNotCompare`: parsed invalid -> `CHANGESET_INVALID`, explicit unavailable -> `CHANGESET_UNAVAILABLE`.
  - `missingOrDigestMismatchedSnapshotIsNotEvaluated`: with baseline `READY`, absent/unbound Plan or bytes that fail the fallback's SHA-256 equality check -> `NOT_EVALUATED/PLAN_SNAPSHOT_UNAVAILABLE`; with a genuine S1-a Plan mismatch and thus baseline `NOT_READY`, the *earlier* `PREREQUISITE_UNAVAILABLE` reason takes precedence. No caller discards the associated bytes merely for mismatch.
  - `policyNotReadyMapsExistingReasons`: `UNDEFINED`, `INVALID`, `REFERENCE_MISMATCH` -> exact `SCOPE_POLICY_*` `NOT_EVALUATED` reasons.
- [ ] **Step 2: Run** `bun run vitest run tests/core/s1d/scope-fallback.test.ts`. Expected initially **FAIL**.
- [ ] **Step 3: Implement** the exact §6 fixed order: `inspectBaseline === READY` → `inspectChangeSet === PRESENT` → selected Plan presence and both digest matches → `extractTaskScopePolicy === READY` → `compareCandidatePaths`. Return only `ScopeFallback`; no new evaluator, diagnostic reordering, formal verdict or authority inference.
- [ ] **Step 4: Run** `bun run vitest run tests/core/s1d/scope-fallback.test.ts`. Expected **PASS**.
- [ ] **Step 5: Commit** `git add src/core/s1d/scope-fallback.ts tests/core/s1d/scope-fallback.test.ts && git commit -m "feat(justice): add conditional S1-d scope fallback"` (future authorized execution only).

### Task 5: Integrated diagnostic orchestration and independent continuation

**Files:** Create `src/runtime/s1d-diagnostic.ts`, `tests/runtime/s1d-diagnostic.test.ts`.

**Interfaces:**
- Consumes: Tasks 1–4 helpers and types, existing `loadS1aArtifacts`, `bindEvidence`, `evaluateS1c`, `S1aReadOnlySource`, `LoaderInput`.
- Produces:
  ```ts
  type DiagnosticRequest = Readonly<{
    loaderInput: LoaderInput;
    evidencePath: string;
    changesetPath: string;
  }>;
  function runS1dDiagnostic(request: DiagnosticRequest,
    source: S1aReadOnlySource): Promise<S1dReportV1>;
  ```
  Return `S1dReportV1` only for constructible complete/partial reports; unexpected internal faults throw to the Task 6 safe-fatal boundary. Never downgrade a legitimate Core diagnostic to `NOT_EVALUATED` merely for an unfavorable result.

- [ ] **Step 1: Write failing tests**:
  - `allCoreResultsPreserved`: valid source/Plan/Evidence/ChangeSet -> all three stages `EVALUATED`, identical native Core result values, no `scopeFallback`, formal verdict `UNKNOWN`.
  - `levelBInvalidEvidenceRetainsScope`: parsed wrong-type Evidence -> S1-b `INPUT_REJECTED`, S1-c contains `S1B_INPUT_REJECTED` with valid candidate scope; provenance withheld; `inputIssues:[]`.
  - `levelBInvalidChangeSetRetainsEvidence`: parsed invalid ChangeSet -> S1-c `CHANGESET_INVALID`, S1-b genuine bindings and declared provenance retained, no fallback.
  - `evidenceLevelAScopeFallbackPresenceRule`: Evidence Level A and parsed ChangeSet -> S1-b/S1-c `NOT_EVALUATED`, exactly one fallback, correct `EVALUATED` or `NOT_EVALUATED` depending on Task 4 preconditions; never create an S1-c result.
  - `changesetLevelAOmitsFallback`: ChangeSet Level A, Evidence parsed -> S1-b genuine result, S1-c skipped, fallback property **absent**; both Level A -> two ordered issues and no fallback.
  - `notReadyBaselineWithCapturedPlanStillInvokesS1c`: both new sources parsed -> actual S1-c returns `S1A_BASELINE_NOT_READY`, no scope verdict, no fallback.
  - `planDigestMismatchPreservesCoreBaselineDiagnostic`: inject a same-run safely captured/associated Plan whose observed digest differs from its expected digest; assert `getPlanSnapshot` remains non-null, S1-a reports `MISMATCH`/baseline `NOT_READY`, S1-b returns its actual Core result, **S1-c stage is `EVALUATED`** with `S1A_BASELINE_NOT_READY`, candidate Scope `UNKNOWN`, `formalVerdict: UNKNOWN`, **no** `scopeFallback`, exit mapping `0` (Task 6). No `PLAN_SNAPSHOT_UNAVAILABLE` substitution.
  - `planDigestMismatchWithEvidenceLevelAKeepsFallbackUnevaluated`: same Plan mismatch, Evidence Level A and parsed ChangeSet -> S1-c `NOT_EVALUATED`, `scopeFallback` **present/NOT_EVALUATED** with `PREREQUISITE_UNAVAILABLE`, no path comparison; exit mapping `3` (Task 6).
  - `missingPlanAllowsS1bOnly`: Evidence parsed and no safely captured/associated Plan -> S1-b evaluated, S1-c skipped with `PLAN_SNAPSHOT_UNAVAILABLE`; no fake Plan bytes. This differs from a Plan Digest mismatch.
  - `evidenceProvenanceInvalidWithholdsAll`: valid-looking issuer among invalid refs never projects even one source claim.
- [ ] **Step 2: Run** `bun run vitest run tests/runtime/s1d-diagnostic.test.ts`. Expected initially **FAIL**.
- [ ] **Step 3: Implement** the §6 fixed dispatch order: read new sources independently, invoke S1-a with captured source, invoke S1-b whenever Evidence parsed, invoke S1-c whenever both parsed and a **safely captured/uniquely associated** Plan snapshot exists **without requiring a matching expected Digest** (including an S1-a Plan Digest mismatch, a non-ready S1-a or Core-invalid Level B values), otherwise assign fixed skip reasons. The existing evaluator, not S1-d, produces `S1A_BASELINE_NOT_READY`/Scope `UNKNOWN` before Plan-byte digest checking for a non-ready baseline. Only if Evidence Level A + ChangeSet parsed compute the Task 4 fallback; `scopeFallback` must otherwise be **omitted**. Preserve core result ordering and report-only provenance from Task 1. A narrow TypeScript assertion at existing defensive Core boundaries is allowed for parsed `unknown`, not a claim that input has been validated.
- [ ] **Step 4: Run** `bun run vitest run tests/runtime/s1d-diagnostic.test.ts`. Expected **PASS**.
- [ ] **Step 5: Commit** `git add src/runtime/s1d-diagnostic.ts tests/runtime/s1d-diagnostic.test.ts && git commit -m "feat(justice): orchestrate S1-a–c READ_ONLY diagnostics"` (future authorized execution only).

### Task 6: Standalone CLI, package integration and bounded acceptance

**Files:** Create `src/runtime/s1d-cli.ts`, `tests/runtime/s1d-cli.test.ts`, `tests/runtime/s1d-cli-entry.test.ts`; modify only the existing `package.json` `bin` and `build` script entries relevant to `justice-s1d`.

**Interfaces:**
- Consumes: Task 5 `runS1dDiagnostic`, Task 2 formatters and fatal error types, existing `createS1aReadOnlySource()`.
- Produces: `type S1dCliOutput = Readonly<{stdout:string; exitCode:0|3|64|70}>; function runS1dCli(argv:readonly string[], source:S1aReadOnlySource): Promise<S1dCliOutput>`; standalone Node CLI executable `dist/runtime/s1d-cli.js` after build.

- [ ] **Step 1: Write failing tests**:
  - `validDiagnoseTextAndJsonAreDeterministic`: same Fixture twice, one newline-terminated stdout record, byte-identical per format, no stderr, complete exit `0`, UNKNOWN remains UNKNOWN.
  - `parsedLevelBStillCompletes`: invalid Evidence or ChangeSet schema but all three Core functions invoked -> exit `0` with retained Core findings, not assurance success.
  - `levelAPartialUsesExit3`: Evidence read/UTF-8/JSON errors, missing Plan, ChangeSet Level A -> exit `3`, normal report envelope, no invented data.
  - `invalidArgumentsAreSafe`: unknown/repeated flags, missing positional value/digest, invalid or ambiguous `--format` -> exit `64`; if `--format json` is unambiguous, exact fatal `justice-s1d-error-v1` JSON; otherwise one safe Text fatal line.
  - `unexpectedInternalFaultUsesExit70`: mocked diagnostic/formatter throw -> bounded `UNEXPECTED_INTERNAL_ERROR`, no path, stack, raw input or second record.
  - `noRuntimeSideEffects`: spy/injected sources demonstrate no writes, network, shell, external service or Gate/Task/Review/Fix operations.
  - `binEntryMatchesPackage`: built binary runs as standalone command with existing S1-a fixture; existing `justice` and `justice-s1a` entries unchanged.
- [ ] **Step 2: Run** `bun run vitest run tests/runtime/s1d-cli.test.ts tests/runtime/s1d-cli-entry.test.ts`. Expected initially **FAIL**.
- [ ] **Step 3: Implement** `runS1dCli` grammar (required `diagnose` verb and flags; `--format` default `text`; duplicate/unknown flags rejected), use Task 5 and Task 2 exactly once per invocation, derive `0` iff three stages are `EVALUATED`, else `3`. Map usage/internal faults to `64`/`70`. Add process entry guard using existing `s1a-cli.ts` pattern and inject actual read-only source only there. Update `package.json` bin plus build executable permission target; do not modify S1-a source, legacy `justice` doctor, or other publishing settings.
- [ ] **Step 4: Run targeted tests** and then repository checks **once** in the authorized environment:
  ```bash
  bun run vitest run tests/core/s1d tests/runtime/s1d-read-only-input.test.ts tests/runtime/s1d-diagnostic.test.ts tests/runtime/s1d-cli.test.ts tests/runtime/s1d-cli-entry.test.ts
  bun run typecheck
  bun run lint
  bun run test
  bun run build
  ```
  Expected: all PASS, no new lint/type errors, built `dist/runtime/s1d-cli.js` executable. These commands are **future plan steps, not observed results**. If a command fails, record the observed failure and make only the necessary bounded correction to the owned task; do not initiate review loops.
- [ ] **Step 5: Commit** `git add src/runtime/s1d-cli.ts tests/runtime/s1d-cli.test.ts tests/runtime/s1d-cli-entry.test.ts package.json && git commit -m "feat(justice): expose standalone S1-d diagnostics CLI"` (future authorized execution only).

## Coverage crosswalk and stopping condition

| Design sections | Implementation tasks | Evidence at completion |
| --- | --- | --- |
| §1, §2, §3, §4: Integrated CLI, exact core and trust semantics | 1, 3, 5, 6 | Native results preserved; pure/runtime boundary tested |
| §5 and §5.1: CLI flags, bounded inputs, same-run Plan association versus Digest match | 3, 5, 6 | Parse/error, no-double-read, mismatch-retention tests |
| §5.2, §6: Level A/Level B and independent continuation | 3, 5 | Mixed failure matrix tests |
| §6.1: READY / NOT_READY, ordinary Core mismatch diagnostics and fallback presence | 3, 4, 5 | S1-c EVALUATED on captured mismatched Plan; stricter fallback NOT_EVALUATED tests |
| §7: Provenance, report contract, parity | 1, 2 | All-or-nothing claims and deterministic Text/JSON tests |
| §8: Exit codes and fatal envelope | 2, 6 | Exit 0/3/64/70 and safe JSON/Text fatal tests |
| §9: READ_ONLY and trust boundaries | 1–6 | No writes/host actions, original Core unchanged |
| §10: Minimum acceptance cases | 1–6 | Targeted regression + one full repository check |
| §11: Owner checkpoint | Outside implementation | Explicit human decision, not automated review or launch |

**Definition of done for the present F-003 document-only task:** This candidate Implementation Plan and the paired Design R0.1.1 have aligned Plan-snapshot association/Digest semantics and explicit tests in Tasks 3/5 without executing any planned step. No GitHub mutation occurs.

**Future implementation entry gate (NOT MET by this plan alone):** Human Owner explicitly adopts the detailed S1-d Design, approves this plan and authorizes the exact implementation scope. The prior Issue's `CODE_IMPLEMENTATION_NOT_AUTHORIZED` status remains binding until separately changed by Owner authority. Do not initiate a follow-on task merely because this plan exists.

**Future implementation stop condition:** Tasks 1–6 produce the authorized local CLI and targeted evidence; record residual limitations, no formal Gate assertion, no automatic secondary reviews or S2 work. If a safety-related blocker prevents a specific action, fail closed for that action, record it, and request an Owner decision rather than expanding the project. At completion choose accept/use, a bounded correction, or stop; never mechanically require Findings=0.
