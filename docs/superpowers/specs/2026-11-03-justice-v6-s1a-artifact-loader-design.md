# Justice v6 — S1-a Artifact Registry / Loader Design R0.1.2 (F001–F003 limited documentary candidate)

**Original R0.1.1 date:** 2026-11-03 (JST)  
**R0.1.2 correction-candidate date:** 2026-11-04 (JST)  
**Source:** [yohi/justice Issue #350](https://github.com/yohi/justice/issues/350)  
**Decision Hub:** [Issue #349, D-1–D-3 Owner approval](https://github.com/yohi/justice/issues/349#issuecomment-6600623047)  
**Scope:** S1-a only; interfaces to S1-b and S1-e  
**R0.1.1 historical status at authoring:** `TARGETED_DOCUMENTARY_REMEDIATION_CANDIDATE / OWNER_APPROVAL_PENDING / IMPLEMENTATION_NOT_AUTHORIZED`  
**Current status:** `R0.1.1_OWNER_ADOPTED / R0.1.2_DOCUMENTARY_CANDIDATE_NOT_ADOPTED / IMPLEMENTATION_NOT_AUTHORIZED / NO_GITHUB_WRITE`  
**Historical R0.1.1 delta:** Review Gate R1 `JV6-S1A-RG1-F001` (authority-status separation) and `JV6-S1A-RG1-F002` (missing/invalid Manifest digest).  
**Current delta (F001–F003, documentary only):** diagnostic-safe identifier admission/output (F001); selected-ref and total-byte limits (F002); implementation-plan GitHub state only (F003, addressed in companion Plan). All preceding Owner choices, identity equality, Owner authority, HOLD and READ_ONLY scope remain unchanged.  
**Repository provenance:** The **adopted R0.1.1 source** is present in the named feature branch at Git blob `9aefa8859e584c6e5c60b2b780687d2fe5d0d904` (reviewed baseline HEAD `5f53564e99ef92f54b90e63d69abd79bc4cc8fd4`). **This R0.1.2 documentary candidate is local only and not yet approved or committed**; intended future path is `docs/superpowers/specs/2026-11-03-justice-v6-s1a-artifact-loader-design.md`. The R0.1.1 status and historical sections below describe the earlier authoring stage, not current GitHub state.

## 1. Intent and completion boundary

The first Justice v6 MVP must identify **which Design, Implementation Plan, Task and Acceptance Criteria (AC)** are the exact Owner-fixed baseline before evaluating work against them. S1-a is an offline, READ_ONLY loader/checker, **not** a registry service, authorization system, review scheduler, or Host execution enforcer.

Completion for S1-a means a small deterministic loader and fixtures can: reproduce the expected Design/Plan/Task/AC identities; reject stale revision, changed bytes, scope mismatch and unapproved/dirty inputs as eligible baseline; express absent/untrusted approval provenance as `UNKNOWN/NOT_PROVEN`; and return useful evidence without causing side effects. This document is the design proposal—not proof of an implementation or permission to implement.

### Explicit goals

1. Load one Owner-fixed manifest with exact Identity and approval references for Design, Plan, Task and AC.
2. Verify its **raw-byte** SHA-256 against an independently supplied expected value **before** parsing or trusting any contained declaration.
3. Resolve one untrusted, reference-only `TaskIntent` into the fixed entries; compare artifact ID, kind, exact revision, scope and raw-file SHA-256.
4. Distinguish confirmed mismatches from missing/uncertain inputs and preserve the trust limitations of the Owner authority source.
5. Provide immutable, typeable results to S1-b/S1-c and diagnostic evidence to S1-d; work with S1-e fixtures.

### Non-goals / forbidden actions

No network request, GitHub lookup, signature system, approval API, persistent registry/DB, auto-fallback to old revisions, scanning for “latest”, repo-wide Git dirty check, Host probe, source/Gate/HOLD write, review/fix dispatch, execution block, model routing, or S2–S5 implementation. No adoption of the still-unadopted Requirements R0.2.4, no change to historical STOP/BLOCKED status.

## 2. Accepted Owner choices and considered approaches

| Decision | Chosen | Alternatives considered / tradeoff |
|---|---|---|
| Authority metadata source | **A: one Owner-fixed Manifest** | Fetching GitHub approvals would add network, author-identity and failure handling; supporting both doubles initial trust paths |
| Manifest integrity | **B: raw-byte SHA-256 pinned outside Manifest** | Blindly trusting a supplied manifest enables substitution; signatures are stronger against certain threats but need out-of-scope key infrastructure |
| Expected digest delivery | **A: explicit CLI input through a trusted Owner-controlled route** | A protected configuration store adds configuration authority/security concerns; dual mode introduces conflict resolution |
| Revision management | **A: exact pinned revision + digest; no fallback** | A multi-revision approved set requires validity and supersession policies; auto-latest silently crosses approval boundaries |
| Data organization | **A: single Manifest, reference-only TaskIntent** | Separate independently approved per-Task manifests produce a larger cross-file verification surface |
| Dirty definition | **A: artifact byte mismatch** | Git worktree dirty detection confuses unrelated edits and requires repository knowledge |

The chosen approach minimizes S1-a construction and testing while retaining a clear extension seam. The initial fixture uses separate local files for Design, Plan, Task and AC so each record has verifiable bytes. This is an S1-a fixture packaging decision, **not** a demand that upstream Superpowers always emit four separate file formats. Mapping sections of a real Plan to these identities requires a separate, explicit, reproducible adapter/derivation contract before claiming those sections independently verified.

## 3. Trust model and guarantees

**External trust precondition:** A Human Owner independently fixes the Manifest's expected SHA-256 and intentionally supplies that exact value through a trusted operation. The CLI does **not** authenticate a human. A model/agent able to supply both a substituted Manifest and its matching SHA-256 can trivially obtain a byte-match; it has **not** established Owner authorization. A GitHub Issue URL or `approved: true` embedded in a file is a reference/claim, never proof of Owner identity.

The loader guarantees, when input bytes can safely be read: `observed_manifest_sha256 == expected_manifest_sha256`; each selected artifact's raw bytes match a Manifest-pinned digest; reference revisions, kinds and scope match exactly. It does **not** guarantee that the expected digest was provided by an actual Owner, that the Manifest has never been superseded elsewhere, or that the runtime was free of a malicious concurrent file-system actor. The report must state those limits.

**Independent assessment axes (F001):**

1. **Identity axis**: `identityStatus: MATCH | MISMATCH | UNKNOWN` describes only what can be established about the supplied Manifest pin, references, required AC closure and artifact bytes. `MATCH` is a *byte/reference match against supplied expected values*, **not** an Owner approval. `MISMATCH` requires a concrete observed contradiction; `UNKNOWN` includes not-readable, not-supplied, structurally invalid, or otherwise unassessable evidence, but **does not mean “untrusted Owner authority.”** The Owner authority axis must not change this identity result.
2. **Owner authority axis**: `ownerAuthorityStatus: NOT_PROVEN` is the **only value S1-a v1 may emit**. The loader neither authenticates Owner identity nor verifies a trusted CLI invocation channel. It cannot emit `OWNER_PROVEN`, and it must not emit `EXTERNALLY_ASSERTED_NOT_CRYPTOGRAPHICALLY_PROVEN` from a CLI flag, expected digest, artifact claim, `approvalRef`, manifest field, local environment variable, or `TaskIntent`.

The label `EXTERNALLY_ASSERTED_NOT_CRYPTOGRAPHICALLY_PROVEN` is **reserved for a separate, explicitly authored Human Owner decision/attestation outside S1-a**. Only the Human Owner, through a separately controlled decision process, may attach such an external assertion to a precisely identified Manifest digest, scope and approved Artifact references. An AI agent, CLI caller or downstream automated component may not assert it on the Owner's behalf. This design does not implement or accept any new trust-context input, assertion parser, credential, signature, Host trust root or Approval API. Even that external label, if recorded elsewhere, is **not** cryptographic Owner authentication, Host proof or proof of Task/AC execution. The provenance and validity of any future external decision remain outside S1-a and require separate Owner authorization if operationalized.

**Fixed S1-a outputs and eligibility:**

- `ownerTrustPrecondition` always equals `EXTERNAL_NOT_VERIFIED_BY_S1A`. This is a **disclaimer indicating an unsatisfied/unverifiable precondition**, not a boolean indicating Owner trust was established.
- `identityCandidateReady` is true **if and only if** `identityStatus=MATCH` after full Manifest-digest verification, strict Manifest/TaskIntent validation, complete Design→Plan→Task→mandatory AC resolution and all selected raw-artifact byte checks. It authorizes **read-only analytical comparison only**.
- `eligibleBaseline` (for any approval, acceptance or authoritative Gate use) is **always false in S1-a v1**: S1-a cannot establish the Owner trust precondition. Identity match + `--manifest-sha256` + an `approvalRef` cannot change this value. A future Owner decision made and verified outside S1-a may decide whether to use the identified candidate as an accepted baseline, but **cannot be inferred by S1-a/S1-b/S1-c**.
- If an external Owner trust context does not exist, approval remains `NOT_PROVEN` **even when `identityStatus=MATCH`** (N-09); if it does exist, S1-a still reports `NOT_PROVEN` because it cannot verify that context. Do not replace the fixed output with an assertion about the caller.

**Downstream non-escalation invariant:** S1-b/S1-c must preserve the original `identityStatus`, `ownerAuthorityStatus`, `ownerTrustPrecondition`, `identityCandidateReady` and `eligibleBaseline` on S1-a's immutable result. They may attach their **own** separately sourced evidence and decision records, but may not reinterpret identity match as Owner approval, convert a self-claim into externally asserted approval, infer provenance from the digest parameter, treat `identityCandidateReady` as authoritative acceptance eligibility, or claim execution/AC satisfaction from a Manifest entry. An UNKNOWN/NOT_PROVEN authority cannot be promoted by identity success. These rules permit diagnostic work without introducing new Host enforcement or blocking unrelated Superpowers steps.

## 4. Minimum input model (design contract, not implemented API)

Manifest is a strict UTF-8 JSON document with `schemaVersion = "justice-s1a-manifest-v1"`, a unique `manifestId`, and `artifacts[]`. Every record is a logical `ApprovedArtifactRef` with:

| Field | Type / interpretation |
|---|---|
| `artifactId` | Unique opaque, **validated diagnostic-safe** identifier; exact case-sensitive equality with no normalization or inferred meaning |
| `kind` | Exactly one of `design`, `plan`, `task`, `ac` |
| `revision` | **Validated diagnostic-safe** opaque case-sensitive identifier, equality only; no semver/latest ordering |
| `digest` | `{ "algorithm": "sha256", "hex": "<64 lower-case hex>" }`, of **raw artifact file bytes** |
| `relativePath` | Safe relative path beneath caller-supplied artifact root; never an authority locator |
| `scopeKey` | **Validated diagnostic-safe**, exact case-sensitive identifier; equality, not wildcard membership |
| `approvalRef` | Owner-declared external decision reference; informational unless separately trusted |
| `parentId` | For plan→design, task→plan, ac→task; omitted for design |

**Diagnostic-safe identifier boundary (targeted F001; normative for both input documents):** `manifestId`, each Manifest `artifactId`, `revision`, `scopeKey`, `parentId` when present, and each TaskIntent `scopeKey`, reference `artifactId` and `revision` must be ASCII, 1–64 characters, match exactly `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, and remain byte-for-byte/case-sensitive strings once validated. A valid value such as `S1-a`, `R0.1.1` or `task-1` retains its full identity; do **not** case-fold, truncate, escape, slugify, hash-substitute or otherwise normalize a valid identity. Refuse empty, 65+ characters, Unicode, whitespace, control/ANSI escape sequences, `/`, `\`, `:`, `?`, `#`, `@`, quotes and path/URL syntax; these restrictions prevent arbitrary content in diagnostic fields, not an expansion of Owner authority. An invalid field from the **digest-verified Manifest** is `MANIFEST_INVALID`; an invalid field from TaskIntent (including a ref string) is `TASK_INTENT_INVALID`. The resulting `identityStatus=UNKNOWN`, `selectedRefs=[]`, `identityCandidateReady=false`, `eligibleBaseline=false`; `manifestDigestMatch=true` if Manifest digest was actually matched. Errors must not echo the offending value or any host path. No output may use a malformed/unsanitized `manifestId`, `targetId`, `revision` or `scopeKey` even in `checks`, `expected`, `observed`, logger messages or CLI JSON. In particular, `approvalRef`/input locator paths/relative artifact paths are **never** diagnostic output. The safe identifier predicate applies identically in schema validation and reference resolution; this is a lexical admission rule, not a change to exact Identity equality.

**Diagnostic output grammar:** `LoaderCheck.check` is a finite implementation-defined **fixed-name union** (e.g. `schema`, `manifest_digest`, `reference`, `revision`, `scope`, `kind`, `parent`, `mandatory_ac`, `artifact_digest`, `selected_artifact_limit`, `total_artifact_bytes`). `targetId` is either a fixed token (`manifest`, `task-intent`) or `artifact:` + a previously validated `artifactId`. `expected`/`observed` may contain **only** prevalidated safe identifiers, canonical 64-character lowercase SHA-256 strings, or fixed reason-safe tokens; never raw CLI arguments, JSON, file contents, `approvalRef`, exception messages, host paths, or URL strings. A malformed value produces a fixed `schema` check without `expected`/`observed`; the fixed `limitations` strings do not incorporate input. Validation failure cannot produce partial `selectedRefs`. This boundary applies to successes **and** error results, including any future S1-d presentation.

A second JSON input, `TaskIntent`, holds only `schemaVersion`, `scopeKey`, and **references** `design`, `plan`, `task`, and a nonempty list of AC IDs **with expected revisions**. It may not carry replacement digests, paths, approval claims, or write permissions. A reference to an ID not in the fixed Manifest is an error, never an invitation to discover or adopt another artifact. The source of `TaskIntent` is untrusted.

**Illustrative Fixture (digest values are placeholders, NOT executable trusted inputs):**

```json
{
  "schemaVersion": "justice-s1a-manifest-v1",
  "manifestId": "fixture-1",
  "artifacts": [
    {"artifactId":"design-1","kind":"design","revision":"R1","digest":{"algorithm":"sha256","hex":"<actual-64-hex>"},"relativePath":"design.md","scopeKey":"fixture-scope","approvalRef":"owner-record-1"},
    {"artifactId":"plan-1","kind":"plan","revision":"R1","digest":{"algorithm":"sha256","hex":"<actual-64-hex>"},"relativePath":"plan.md","scopeKey":"fixture-scope","approvalRef":"owner-record-1","parentId":"design-1"},
    {"artifactId":"task-1","kind":"task","revision":"R1","digest":{"algorithm":"sha256","hex":"<actual-64-hex>"},"relativePath":"task-1.json","scopeKey":"fixture-scope","approvalRef":"owner-record-1","parentId":"plan-1"},
    {"artifactId":"ac-1","kind":"ac","revision":"R1","digest":{"algorithm":"sha256","hex":"<actual-64-hex>"},"relativePath":"ac-1.json","scopeKey":"fixture-scope","approvalRef":"owner-record-1","parentId":"task-1"}
  ]
}
```

```json
{
  "schemaVersion": "justice-s1a-task-intent-v1",
  "scopeKey": "fixture-scope",
  "design": {"artifactId":"design-1","revision":"R1"},
  "plan": {"artifactId":"plan-1","revision":"R1"},
  "task": {"artifactId":"task-1","revision":"R1"},
  "ac": [{"artifactId":"ac-1","revision":"R1"}]
}
```

In the actual test fixture, replace placeholder strings with genuine digests and compute the Manifest expected SHA-256 over final JSON **bytes**. All bytes matter: whitespace, newlines and key order are not normalized. `TaskIntent` must be syntactically valid; validating its content is not authority adoption.

### Validation invariants

- Require exact schema version; reject malformed JSON, unknown required data, duplicate JSON keys, duplicate `artifactId`, duplicate or inconsistent references, cyclic/broken `parentId`, and conflicting paths. Unknown fields in normative objects are rejected to prevent false assumptions about their effect.
- For each selected reference: compare `artifactId`, `revision` and `kind`; require scope equality across intent, selected records and parent links; require the selected AC set to equal the Manifest-pinned AC set for that Task. To ensure completeness, the Manifest must express the full mandatory AC set through all `ac` entries whose `parentId` equals that Task; intent cannot silently omit one.
- The fixture root is supplied explicitly and treated as an untrusted filesystem boundary. Reject absolute paths, `..`, path traversal, symlinks for selected paths, and disallowed file types. Do not expose absolute host paths in diagnostic output.
- Digest means SHA-256 of **raw artifact bytes**, not Git blob IDs, normalized Markdown, a plan fingerprint, JSON canonicalization, or the digest of another referenced object.
- Keep the adopted implementation-plan limits unchanged: `MAX_SELECTED_ARTIFACTS=128` and `MAX_TOTAL_ARTIFACT_BYTES=33_554_432` for one invocation (other `S1A_LIMITS` unchanged). Count **unique selected Design + Plan + Task + all mandatory AC references** after complete graph resolution, before any artifact-byte read. Exactly 128 is allowed; 129 returns `SELECTED_ARTIFACT_LIMIT_EXCEEDED` / `INPUT_INVALID` / `UNKNOWN`, `selectedRefs=[]`, and performs **zero** artifact reads. Count overflow never truncates a selection.
- Enforce cumulative raw artifact **bytes actually read**, in deterministic Design→Plan→Task→AC-ID order. Exactly 33,554,432 bytes across all selected artifacts is allowed; any attempted next positive byte over budget returns `TOTAL_ARTIFACT_LIMIT_EXCEEDED` / `CHECK_INCOMPLETE` / `UNKNOWN`, stops any further artifact reads, retains only the fully validated selection marked unverified where necessary, and never returns an identity candidate/eligible baseline. For each read pass `min(MAX_ARTIFACT_BYTES, remainingTotalBytes)` to a bounded raw reader; a zero remaining budget must still permit an actual zero-byte artifact, rejecting a positive-byte artifact. Neither limit is a reason to claim an observed byte/Digest mismatch. A previously observed `MISMATCH` remains the aggregate `MISMATCH` under the established priority; an otherwise matching/incomplete limit-only case is `UNKNOWN`.
- A duplicate or ambiguous identity is invalid even when some subset would have matched. No network or automatic search for replacement revisions.
- When the **per-file** limit `MAX_ARTIFACT_BYTES=8_388_608` is exceeded before total budget is exhausted, emit `ARTIFACT_SIZE_LIMIT_EXCEEDED` / `CHECK_INCOMPLETE` / `UNKNOWN`, stop subsequent reads and do not hash truncated bytes. If the remaining **total** budget is stricter than the per-file limit, an overflow is classified as `TOTAL_ARTIFACT_LIMIT_EXCEEDED`. These are verification-incomplete, not measured digest contradictions; prior concrete `MISMATCH` still takes aggregate precedence.

## 5. Read-only processing pipeline

1. Receive caller-specified Manifest file, required `--manifest-sha256`, `--intent`, and `--artifacts-root` (conceptual CLI interface). The caller is responsible for its independently Owner-fixed expected value; S1-a cannot verify who supplied it. **Before opening or parsing the Manifest**, validate that the expected digest is present and exactly 64 lower-case hexadecimal characters (raw SHA-256, no prefix). If omitted, return `MANIFEST_DIGEST_REQUIRED`; if malformed, return `MANIFEST_DIGEST_FORMAT_INVALID`. Both are **input-invalid / verification-not-performed**, not observed mismatches: `manifestDigestMatch="unknown"`, `identityStatus=UNKNOWN`, `selectedRefs=[]`, `identityCandidateReady=false`, `eligibleBaseline=false`, `ownerAuthorityStatus=NOT_PROVEN`.
2. With a syntactically valid expected digest, open and read raw Manifest bytes within limits and compute SHA-256 **before JSON parsing**. If inaccessible/unreadable, return `MANIFEST_UNREADABLE` with `manifestDigestMatch="unknown"`, `identityStatus=UNKNOWN` and no selected references. If observed SHA-256 differs from the expected bytes, return **only then** `MANIFEST_DIGEST_MISMATCH`, with `manifestDigestMatch=false`, `identityStatus=MISMATCH`, and no selected references. Never parse or trust an unverified Manifest.
3. Only after a byte match (`manifestDigestMatch=true`), parse strict schema and validate uniqueness, graph relationships, path syntax and scope requirements. A malformed Manifest yields a typed `MANIFEST_INVALID`/specific structural reason, `identityStatus=UNKNOWN` unless a different concrete mismatch has been observed, and `selectedRefs=[]`.
4. Parse untrusted TaskIntent; validate diagnostic-safe tokens, then resolve the exact Design→Plan→Task→AC chain with exact kinds/revisions/scopes and mandatory AC completeness. If structurally unusable, return `UNKNOWN` and no selected references. **Before any selected artifact-byte read**, count all unique, completely resolved selected refs: 129+ produces `SELECTED_ARTIFACT_LIMIT_EXCEEDED`, `UNKNOWN`, `selectedRefs=[]`, no reads and no candidate/baseline eligibility; 128 succeeds at this preflight. For a concrete mismatch (revision, scope, parent or AC set), report `MISMATCH` with the applicable reason code; no discovery/fallback and no acceptance eligibility.
5. Safely read the selected local artifact bytes **sequentially in canonical order**, enforcing both per-file and cumulative bounded-read budgets; calculate raw SHA-256 and compare to pinned values only for complete reads. If cumulative budget would be exceeded, return `TOTAL_ARTIFACT_LIMIT_EXCEEDED` / `UNKNOWN` (unless a previously observed MISMATCH dominates), with `identityCandidateReady=false`, `eligibleBaseline=false`, and **stop all subsequent artifact reads**. Missing file => `UNKNOWN`, observed different complete bytes => `MISMATCH` (`ARTIFACT_DIGEST_MISMATCH`, the S1-a definition of dirty). Unsupported/unreadable path => `UNKNOWN` with reason, never positive verification. A concrete mismatch is never relabeled UNKNOWN simply because another check could not run.
6. Return an immutable result with per-check expected/actual values, safe logical references, stable reason codes, `identityStatus`, and the **fixed Owner authority disclaimer/non-eligibility**. Do not write a report file in this component; emitting data to the caller/standard output is allowed. Never trigger Review/Fix/Task/Gate/API operations.

The implementation should use the existing TypeScript/Bun codebase boundaries: pure validation/transformation core separated from narrow, read-only filesystem/CLI adapters. Prior `src/core/loader-contract.ts` validates **OpenCode plugin module exports**, so it must not be repurposed or confused with this Artifact Loader. Existing `src/core/plan-fingerprint.ts` computes a canonicalized plan fingerprint, **not** the same property as raw-byte digest; do not substitute it. Existing `src/core/plan-authorization.ts` is mutable session authorization storage, not the S1-a Owner trust root.

## 6. Output contract

`LoaderResult` contains:

- `schemaVersion` (versioned); `manifestId` **only after digest match and structural validation**; input artifact identifiers/scope, with safe redaction;
- `manifestDigestMatch: true | false | "unknown"`, `identityStatus: MATCH | MISMATCH | UNKNOWN`, and **`ownerAuthorityStatus: NOT_PROVEN` (constant in S1-a v1)**;
- `checks[]`: `{targetId, check, outcome: MATCH|MISMATCH|UNKNOWN, reasonCode, expected?, observed?}` with the **fixed-name/safe-token diagnostic grammar in §4**; no unvalidated identifier or secret/host path is emitted, including in failures;
- `selectedRefs[]` **only after verified Manifest bytes, valid schema and complete, unambiguous TaskIntent reference resolution**; each carries the expected Manifest identity plus observed digest/comparison status and is **not authoritative**. In preflight/input/Manifest failures, use `[]`, not partial or untrusted selections;
- `ownerTrustPrecondition: EXTERNAL_NOT_VERIFIED_BY_S1A` (constant), `identityCandidateReady: boolean` (identity-only), `eligibleBaseline: false` (constant for approval/acceptance in this S1-a version), plus limits/provenance annotations;
- deterministic ordering (Design, Plan, Task, AC sorted by `artifactId`), stable reason code strings, no timestamps unless injected for presentation outside the core.

**Exact result classification (F001/F002):**

| Condition | Reason code / category | `manifestDigestMatch` | `identityStatus` | `selectedRefs` | `identityCandidateReady` | `ownerAuthorityStatus` / `eligibleBaseline` |
|---|---|---|---|---|---|---|
| Missing required `--manifest-sha256` | `MANIFEST_DIGEST_REQUIRED` / `INPUT_INVALID` | `"unknown"` | `UNKNOWN` | `[]` | `false` | `NOT_PROVEN` / `false` |
| Invalid syntax (including non-lowercase hex, wrong length, prefix) | `MANIFEST_DIGEST_FORMAT_INVALID` / `INPUT_INVALID` | `"unknown"` | `UNKNOWN` | `[]` | `false` | `NOT_PROVEN` / `false` |
| Manifest not readable or byte limit prevents digest verification | `MANIFEST_UNREADABLE` / `CHECK_INCOMPLETE` | `"unknown"` | `UNKNOWN` | `[]` | `false` | `NOT_PROVEN` / `false` |
| Raw Manifest SHA-256 actually compared and **different** | `MANIFEST_DIGEST_MISMATCH` / observed contradiction | `false` | `MISMATCH` | `[]` | `false` | `NOT_PROVEN` / `false` |
| SHA matches, but Manifest/schema/graph invalid | `MANIFEST_INVALID` (or specific structural code) / `INPUT_INVALID` | `true` | `UNKNOWN` | `[]` | `false` | `NOT_PROVEN` / `false` |
| SHA matches, but TaskIntent invalid/unresolvable | `TASK_INTENT_INVALID` (or specific code) / `INPUT_INVALID` | `true` | `UNKNOWN` | `[]` | `false` | `NOT_PROVEN` / `false` |
| SHA matches, a selected revision/scope/parent/AC set concretely contradicts pin | E.g. `REVISION_MISMATCH`, `SCOPE_MISMATCH`, `PARENT_LINK_MISMATCH`, `REQUIRED_AC_MISSING` | `true` | `MISMATCH` | `[]` if full unambiguous resolution is impossible; otherwise resolved references, still non-authoritative | `false` | `NOT_PROVEN` / `false` |
| SHA matches, a selected artifact is unreadable/missing with no observed contradiction | `ARTIFACT_UNREADABLE` / `CHECK_INCOMPLETE` | `true` | `UNKNOWN` | Resolved references marked unverified | `false` | `NOT_PROVEN` / `false` |
| SHA matches, a selected artifact digest is observed different | `ARTIFACT_DIGEST_MISMATCH` / observed contradiction | `true` | `MISMATCH` | Resolved references marked mismatched | `false` | `NOT_PROVEN` / `false` |
| Digest-verified Manifest has invalid `manifestId`, `artifactId`, `revision`, `scopeKey` or `parentId` lexical value | `MANIFEST_INVALID` / `INPUT_INVALID` | `true` | `UNKNOWN` | `[]` | `false` | `NOT_PROVEN` / `false` |
| Manifest valid, but TaskIntent contains invalid `scopeKey` / reference ID or revision | `TASK_INTENT_INVALID` / `INPUT_INVALID` | `true` | `UNKNOWN` | `[]` | `false` | `NOT_PROVEN` / `false` |
| Fully resolved selection contains 129+ unique artifacts (128 permitted) | `SELECTED_ARTIFACT_LIMIT_EXCEEDED` / `INPUT_INVALID` | `true` | `UNKNOWN` | `[]`, no artifact reads | `false` | `NOT_PROVEN` / `false` |
| Next positive artifact byte would exceed 33,554,432B (exactly equal permitted), with no prior observed contradiction | `TOTAL_ARTIFACT_LIMIT_EXCEEDED` / `CHECK_INCOMPLETE` | `true` | `UNKNOWN` | Complete resolved set; unchecked entries unverified | `false` | `NOT_PROVEN` / `false` |
| All Manifest/reference/artifact identity checks match, with **or without** real external Owner context | `IDENTITY_MATCH_WITH_AUTHORITY_LIMITATION` | `true` | `MATCH` | Complete resolved set | `true` | `NOT_PROVEN` / `false` |

**Aggregation and error invariants:** `manifestDigestMatch=false` means **only a completed byte comparison with a different hash**; it must never represent a missing parameter, malformed digest, I/O failure or invalid schema. For selected checks, preserve every directly observed contradiction as `MISMATCH`; aggregate priority is observed `MISMATCH` over `UNKNOWN` over `MATCH`. A parse error, missing input or invalid provenance is not itself proof of byte mismatch. Absent/invalid expected digest is detected before opening the Manifest; no Manifest content or selected identity is trusted or exposed in that case. Every outcome in the table has `ownerTrustPrecondition=EXTERNAL_NOT_VERIFIED_BY_S1A`, no acceptance-eligible baseline and no side effects.

`MATCH` means exact pinned bytes/metadata match, not Owner authorization. `MISMATCH` means a concrete contradiction observed; `UNKNOWN` means information is insufficient to complete an identity determination—not “untrusted Owner authority.” `NOT_PROVEN` is the *separate* Owner-authority verdict, not a synonym for a check failure. Refusing baseline eligibility is not a filesystem action block, Review/Fix dispatch or Gate alteration. Even a clean result does not prove Task execution, AC satisfaction or correct evidence origin; those require separately sourced inputs handled by S1-b/S1-c.

## 7. S1-a / S1-b / S1-e boundary

- **S1-a owns:** fixed baseline identity and selected artifact bytes/metadata checks; does not evaluate execution evidence or code correctness.
- **S1-b consumes:** immutable selected identities plus check outcomes to bind external `EvidenceRef` against Task/Revision/AC, separately evaluating origin/issuer/trust; may not turn a Manifest approval claim into Host-verified execution evidence. **Must propagate S1-a's fixed `NOT_PROVEN` authority, `EXTERNAL_NOT_VERIFIED_BY_S1A` precondition and `eligibleBaseline=false` without mutation or automatic promotion, including when identity is `MATCH`.**
- **S1-c consumes:** identity/diagnostic results and separately sourced evidence, decides deviation findings; S1-a does not decide a final Gate outcome. **S1-c may analyze an `identityCandidateReady=true` candidate but cannot make it authoritative for acceptance without an explicit, independently validated Owner decision outside S1-a; it must not synthesize that decision from `TaskIntent`, Manifest declarations, CLI arguments or S1-b evidence.** Identity status, Owner authority and execution evidence are independent axes.
- **S1-d consumes:** structured results to render understandable reports; formatting/export belongs there.
- **S1-e owns:** fixtures for positive and negative cases, followed later by native-only comparison; no big fixture harness needed now.

## 8. Minimal acceptance / negative fixture matrix

| Case | Setup | Required observation |
|---|---|---|
| P-01 | Manifest expected SHA verified; all four types and mandatory ACs present, matching | `manifestDigestMatch=true`, `identityStatus=MATCH`, `identityCandidateReady=true`, `ownerAuthorityStatus=NOT_PROVEN`, `eligibleBaseline=false`; no side effects |
| N-01 | Manifest bytes changed but expected SHA unchanged | Observed `MANIFEST_DIGEST_MISMATCH`; `manifestDigestMatch=false`, `identityStatus=MISMATCH`, `selectedRefs=[]`, non-eligible |
| N-02 | TaskIntent requests old Plan revision | `REVISION_MISMATCH`; no older-revision fallback |
| N-03 | Artifact content changed without Manifest update | `ARTIFACT_DIGEST_MISMATCH` (dirty), not MATCH |
| N-04 | Intent and approved entry have different scope | `SCOPE_MISMATCH` |
| N-05 | Intent omits one mandatory AC or points to a different Task/Plan chain | `REQUIRED_AC_MISSING` or `PARENT_LINK_MISMATCH`; no partial approval |
| N-06a | Artifact missing/unreadable after valid Manifest pin | `manifestDigestMatch=true`, `identityStatus=UNKNOWN` without a concrete contradictory check; selected resolved references unverified; `NOT_PROVEN`, non-eligible |
| N-06b | Required `--manifest-sha256` omitted | `MANIFEST_DIGEST_REQUIRED` (`INPUT_INVALID`), `manifestDigestMatch="unknown"`, `identityStatus=UNKNOWN`, `selectedRefs=[]`, `identityCandidateReady=false`, `NOT_PROVEN`, non-eligible; Manifest not parsed |
| N-06c | Expected Manifest SHA malformed (wrong length, non-hex/uppercase, or prefixed) | `MANIFEST_DIGEST_FORMAT_INVALID` (`INPUT_INVALID`), same `"unknown"` / `UNKNOWN` / `[]` / `NOT_PROVEN` / non-eligible as N-06b; not `MANIFEST_DIGEST_MISMATCH` |
| N-07 | Artifact/Manifest claims `approved: true` but independent Owner trust is absent | An unknown `approved` field in the strict Manifest schema is rejected (`MANIFEST_INVALID`); an Artifact-internal claim is never accepted as Owner authority; always `NOT_PROVEN` |
| N-08a | Manifest digest verified, but duplicate ID, invalid path, unknown schema, or malformed Manifest | `manifestDigestMatch=true`, typed `MANIFEST_INVALID` (or specific structural reason), `identityStatus=UNKNOWN`, `selectedRefs=[]`, `NOT_PROVEN`, non-eligible; no access outside root |
| N-08b | Manifest digest verified, but a selected path is a symlink/unreadable at read time | Typed `ARTIFACT_UNREADABLE`/safe-path reason, `identityStatus=UNKNOWN` unless other check is concretely mismatched, resolved references unverified, non-eligible; no access outside root |
| N-DIAG-01 | Digest-pinned Manifest contains `artifactId: "../../private?token=secret"` or `manifestId` containing an ANSI escape, 65+ characters, newline or URL | `MANIFEST_INVALID`, `manifestDigestMatch=true`, `identityStatus=UNKNOWN`, `selectedRefs=[]`, fixed `targetId="manifest"`, `check="schema"`; no raw value/URL/path/secret in checks or JSON |
| N-DIAG-02 | Valid pinned Manifest but TaskIntent contains `scopeKey: "S1-a\nBearer-secret"`, unsafe `revision`, or a 65-character ref ID | `TASK_INTENT_INVALID`, `manifestDigestMatch=true`, `identityStatus=UNKNOWN`, `selectedRefs=[]`, fixed `targetId="task-intent"`, `check="schema"`; no untrusted bytes echoed |
| N-LIM-01 | 128 selected refs vs 129 refs, all valid and mandatory | 128 resolves and reads normally; 129 emits `SELECTED_ARTIFACT_LIMIT_EXCEEDED`, `UNKNOWN`, `[]`, zero artifact reads, non-eligible |
| N-LIM-02 | Total complete artifact bytes 33,554,432 vs 33,554,433 (all individually ≤ 8,388,608) | Equal limit permits digest checks; +1 emits `TOTAL_ARTIFACT_LIMIT_EXCEEDED`, `UNKNOWN` absent other mismatch, stops further reads, never a partial `MATCH`/eligible baseline |
| N-09 | AI agent supplies altered Manifest and matching digest without independent Owner trust | Byte checks may produce `manifestDigestMatch=true`, `identityStatus=MATCH`, `identityCandidateReady=true`, but `ownerAuthorityStatus=NOT_PROVEN`, `ownerTrustPrecondition=EXTERNAL_NOT_VERIFIED_BY_S1A`, `eligibleBaseline=false`; no promotion to external assertion or acceptance |

No Build/Test/CI, Host probe, repository source mutation, or GitHub write has been performed in this documentary remediation. Only the standalone corrected document candidate was created. These are future implementation-time acceptance conditions, not claims of results.

## 9. Residual risks / deferred choices

1. **Owner origin:** An arbitrary CLI value cannot authenticate Human Owner identity. S1-a documents but cannot establish a trusted delivery channel. Consequently S1-a v1 always yields `ownerAuthorityStatus=NOT_PROVEN` and `eligibleBaseline=false`, irrespective of identity matching. An external Human Owner decision, if one exists, is outside this tool and must not be fabricated by downstream automation. A trusted wrapper/custody mechanism would require a distinct approved scope if demanded.
2. **Supersession:** S1-a cannot discover that Owner has revoked/superseded a pin out-of-band. Exact matching is relative to the supplied fixed Manifest, not a global “current approval” oracle.
3. **Hostile local filesystem:** Symlink/path validation reduces accidental and common traversal issues; hardlink abuse and concurrent modification can require more robust OS-specific defenses. S1-a must not claim tamper-proof enforcement; preserve UNKNOWN on ambiguous reads. This does not justify blocking independent read-only MVP design.
4. **Superpowers artifact extraction:** Real Task/AC may reside inside Plan Markdown. This first S1 fixture uses separate raw-byte files. A trusted deterministic extraction/derivation policy is explicitly deferred until needed; do not silently conflate plan canonical fingerprints with fixed raw digests.
5. **Resource limits:** Exact max files/bytes and native adapter details can be set in the implementation plan without changing the trust/semantic contract. This is an implementation choice, not a new Owner policy question.
6. **Manifest provisioning:** Creation and update of pinned Manifest and external SHA remain manual Owner actions for this MVP, not a new Justice approval workflow.

## 10. Owner decision checkpoint / authorized next step

**Request:** Adopt this S1-a design **only** as the input to a subsequent Superpowers `writing-plans` implementation-plan authoring task. The approval does not authorize source code modifications, Build/Test/CI, GitHub Commit/Push/PR, Host access, review auto-dispatch, Gate/HOLD changes or S2–S5.

**Stop condition for this remediation:** Stop when the F001/F002 documentary correction candidate is complete and handed to the Human Owner; do not await adoption, auto-trigger another review/correction round, create extra deliverables, or start downstream tasks. If the Human Owner later adopts this design and explicitly authorizes the next step, invoke `superpowers:writing-plans` for a bounded Implementation Plan. Implementation itself still requires separate Owner authorization.

**State at targeted remediation:** `S1A_R011_F001_F002_DOCUMENTARY_CORRECTION_CANDIDATE / OWNER_ADOPTION_PENDING / IMPLEMENTATION_PLAN_NOT_CREATED / NO_RUNTIME_VERIFICATION / NO_IMPLEMENTATION_AUTHORIZATION / NO_GITHUB_WRITE`. Subsequent implementation-plan terminology, interfaces, error handling, test strategy and nonfunctional constraints must be aligned **when that plan is authored**; no plan exists to cross-check now.
