# Justice v6 — S1-a Artifact Registry / Loader Design R0.1

**Date:** 2026-11-03 (JST)  
**Source:** [yohi/justice Issue #350](https://github.com/yohi/justice/issues/350)  
**Decision Hub:** [Issue #349, D-1–D-3 Owner approval](https://github.com/yohi/justice/issues/349#issuecomment-6600623047)  
**Scope:** S1-a only; interfaces to S1-b and S1-e  
**Status:** `DESIGN_CANDIDATE / OWNER_APPROVAL_PENDING / IMPLEMENTATION_NOT_AUTHORIZED`  
**Proposed repository location (not written):** `docs/superpowers/specs/2026-11-03-justice-v6-s1a-artifact-loader-design.md`

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

Separate two dimensions in every assessment:

- `identityStatus`: `MATCH` / `MISMATCH` / `UNKNOWN` — reproducible assertions about supplied bytes and references.
- `ownerAuthorityStatus`: `EXTERNALLY_ASSERTED_NOT_CRYPTOGRAPHICALLY_PROVEN` / `NOT_PROVEN` — an explicit qualification, **never** `OWNER_PROVEN` derived from CLI argument presence.

A `MATCH` is eligibility for further assessment **only within the externally trusted invocation boundary**. Without that established boundary, the resulting baseline remains `NOT_PROVEN` for approval purposes; S1-b/S1-c must not upgrade it automatically. These categories must not be collapsed into the word `APPROVED`.

For scope-level processing, `eligibleBaseline` is true only when all selected identities match and the caller records an externally established Owner-trust context. As S1-a itself cannot authenticate that context, its machine output should carry `ownerTrustPrecondition: "EXTERNAL_NOT_VERIFIED_BY_S1A"`; a consumer cannot infer the trust context from mere CLI flags. The CLI may show `IDENTITY_MATCH_WITH_AUTHORITY_LIMITATION`, not an authoritative approval decision.

## 4. Minimum input model (design contract, not implemented API)

Manifest is a strict UTF-8 JSON document with `schemaVersion = "justice-s1a-manifest-v1"`, a unique `manifestId`, and `artifacts[]`. Every record is a logical `ApprovedArtifactRef` with:

| Field | Type / interpretation |
|---|---|
| `artifactId` | Unique opaque non-empty identifier; no meaning inferred from its spelling |
| `kind` | Exactly one of `design`, `plan`, `task`, `ac` |
| `revision` | Non-empty **opaque** case-sensitive string, equality only; no semver/latest ordering |
| `digest` | `{ "algorithm": "sha256", "hex": "<64 lower-case hex>" }`, of **raw artifact file bytes** |
| `relativePath` | Safe relative path beneath caller-supplied artifact root; never an authority locator |
| `scopeKey` | Exact, non-empty case-sensitive scope identifier; equality, not wildcard membership |
| `approvalRef` | Owner-declared external decision reference; informational unless separately trusted |
| `parentId` | For plan→design, task→plan, ac→task; omitted for design |

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
- Set conservative byte/entry limits (explicit constants in the implementation plan) to bound memory/time on malformed or huge input; do not silently truncate.
- A duplicate or ambiguous identity is invalid even when some subset would have matched. No network or automatic search for replacement revisions.

## 5. Read-only processing pipeline

1. Receive caller-specified Manifest file, `--manifest-sha256`, `--intent`, and `--artifacts-root` (conceptual CLI interface). The caller is responsible for its trusted Owner-supplied expected value; S1-a cannot verify who supplied it.
2. Open and read Manifest bytes within limits, compute SHA-256, and compare to the expected digest **before** parsing. If mismatch: fail closed for **baseline eligibility**, return `MANIFEST_DIGEST_MISMATCH`, do not treat Manifest contents as approved.
3. Parse strict schema and validate uniqueness, graph relationships, path syntax and scope requirements. Fail with typed error if malformed.
4. Parse untrusted TaskIntent; resolve the exact Design→Plan→Task→AC chain with exact kinds/revisions/scopes and mandatory AC completeness. No discovery/fallback.
5. Safely read the selected local artifact bytes and calculate raw SHA-256; compare to pinned values. Missing file => `UNKNOWN`, observed different bytes => `MISMATCH` (`ARTIFACT_DIGEST_MISMATCH`, the S1-a definition of dirty). Unsupported/unreadable path => `UNKNOWN` with reason, never positive verification.
6. Return an immutable result with per-check expected/actual values, safe logical references, reason codes, `identityStatus`, and authority disclaimer. Do not write a report file in this component; emitting data to the caller/standard output is allowed. Never trigger Review/Fix/Task/Gate/API operations.

The implementation should use the existing TypeScript/Bun codebase boundaries: pure validation/transformation core separated from narrow, read-only filesystem/CLI adapters. Prior `src/core/loader-contract.ts` validates **OpenCode plugin module exports**, so it must not be repurposed or confused with this Artifact Loader. Existing `src/core/plan-fingerprint.ts` computes a canonicalized plan fingerprint, **not** the same property as raw-byte digest; do not substitute it. Existing `src/core/plan-authorization.ts` is mutable session authorization storage, not the S1-a Owner trust root.

## 6. Output contract

`LoaderResult` contains:

- `schemaVersion` (versioned); `manifestId` only when validated; input artifact identifiers/scope, with safe redaction;
- `manifestDigestMatch: true|false|"unknown"`, `identityStatus: MATCH|MISMATCH|UNKNOWN`, and `ownerAuthorityStatus: EXTERNALLY_ASSERTED_NOT_CRYPTOGRAPHICALLY_PROVEN|NOT_PROVEN`;
- `checks[]`: `{targetId, check, outcome: MATCH|MISMATCH|UNKNOWN, reasonCode, expected?, observed?}` (no secret/absolute paths);
- `selectedRefs[]` **only** for successfully resolved entries, each reflecting the expected Manifest identity plus observed digest/comparison status, clearly marked non-authoritative;
- `ownerTrustPrecondition: EXTERNAL_NOT_VERIFIED_BY_S1A`, limits/provenance annotations;
- deterministic ordering (Design, Plan, Task, AC sorted by `artifactId`), stable reason code strings, no timestamps unless injected for presentation outside the core.

**Scope-specific meaning:** `MATCH` = exact pinned bytes and metadata match; `MISMATCH` = a concrete contradiction observed; `UNKNOWN` = not readable, absent, not trusted, or otherwise unverifiable. `NOT_PROVEN` is not a synonym for an observed failure. A mismatch is sufficient to refuse **use of that baseline for downstream acceptance**, not to block filesystem actions or Superpowers workflow. Even a clean result is **not** proof that the task was executed or an AC was satisfied; those belong to S1-b/S1-c.

## 7. S1-a / S1-b / S1-e boundary

- **S1-a owns:** fixed baseline identity and selected artifact bytes/metadata checks; does not evaluate execution evidence or code correctness.
- **S1-b consumes:** immutable selected identities plus check outcomes to bind external `EvidenceRef` against Task/Revision/AC, separately evaluating origin/issuer/trust; may not turn a Manifest approval claim into Host-verified execution evidence.
- **S1-c consumes:** results and externally supplied evidence, decides deviation findings; S1-a does not decide a final Gate outcome.
- **S1-d consumes:** structured results to render understandable reports; formatting/export belongs there.
- **S1-e owns:** fixtures for positive and negative cases, followed later by native-only comparison; no big fixture harness needed now.

## 8. Minimal acceptance / negative fixture matrix

| Case | Setup | Required observation |
|---|---|---|
| P-01 | Manifest expected SHA verified; all four types and mandatory ACs present, matching | `identityStatus=MATCH`; authority limitation remains visible; no side effects |
| N-01 | Manifest bytes changed but expected SHA unchanged | `MANIFEST_DIGEST_MISMATCH`, no usable baseline |
| N-02 | TaskIntent requests old Plan revision | `REVISION_MISMATCH`; no older-revision fallback |
| N-03 | Artifact content changed without Manifest update | `ARTIFACT_DIGEST_MISMATCH` (dirty), not MATCH |
| N-04 | Intent and approved entry have different scope | `SCOPE_MISMATCH` |
| N-05 | Intent omits one mandatory AC or points to a different Task/Plan chain | `REQUIRED_AC_MISSING` or `PARENT_LINK_MISMATCH`; no partial approval |
| N-06 | Missing/unreadable artifact, or no independent expected Manifest SHA | `UNKNOWN/NOT_PROVEN`, not fabricated MISMATCH or PROVEN |
| N-07 | Artifact/Manifest claims `approved: true` but trusted Owner input is absent | Never treated as authoritative; schema claim either rejected or ignored as untrusted |
| N-08 | Duplicate artifact ID, invalid path, symlink, unknown schema, or malformed manifest | Typed invalid/unknown result; no access outside artifact root |
| N-09 | AI agent supplies altered Manifest and matching digest without Owner trust | Byte matching may occur; Owner authority remains `NOT_PROVEN`, never automatic authorization |

No real Build/Test/CI, system probe, file mutation, or GitHub write has been performed in this brainstorming task. These are future implementation-time acceptance conditions, not claims of results.

## 9. Residual risks / deferred choices

1. **Owner origin:** An arbitrary CLI value cannot authenticate Human Owner identity. S1-a documents but cannot establish a trusted delivery channel. A trusted wrapper/custody mechanism would require a distinct approved scope if demanded.
2. **Supersession:** S1-a cannot discover that Owner has revoked/superseded a pin out-of-band. Exact matching is relative to the supplied fixed Manifest, not a global “current approval” oracle.
3. **Hostile local filesystem:** Symlink/path validation reduces accidental and common traversal issues; hardlink abuse and concurrent modification can require more robust OS-specific defenses. S1-a must not claim tamper-proof enforcement; preserve UNKNOWN on ambiguous reads. This does not justify blocking independent read-only MVP design.
4. **Superpowers artifact extraction:** Real Task/AC may reside inside Plan Markdown. This first S1 fixture uses separate raw-byte files. A trusted deterministic extraction/derivation policy is explicitly deferred until needed; do not silently conflate plan canonical fingerprints with fixed raw digests.
5. **Resource limits:** Exact max files/bytes and native adapter details can be set in the implementation plan without changing the trust/semantic contract. This is an implementation choice, not a new Owner policy question.
6. **Manifest provisioning:** Creation and update of pinned Manifest and external SHA remain manual Owner actions for this MVP, not a new Justice approval workflow.

## 10. Owner decision checkpoint / authorized next step

**Request:** Adopt this S1-a design **only** as the input to a subsequent Superpowers `writing-plans` implementation-plan authoring task. The approval does not authorize source code modifications, Build/Test/CI, GitHub Commit/Push/PR, Host access, review auto-dispatch, Gate/HOLD changes or S2–S5.

**Stop condition:** Once the Human Owner accepts or requests a bounded change to this design, this brainstorming task is complete. Do not create further independent review/correction cycles or files by default. If adopted, invoke `superpowers:writing-plans` only under that explicit approval and produce a plan with bounded implementation Tasks and test cases; implementation itself still requires separate Owner authorization.

**State at drafting:** `S1A_DESIGN_CANDIDATE_READY_FOR_OWNER_DECISION / NO_RUNTIME_VERIFICATION / NO_IMPLEMENTATION_AUTHORIZATION / NO_GITHUB_WRITE`.
