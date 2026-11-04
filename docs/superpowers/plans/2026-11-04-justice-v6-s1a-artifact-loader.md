# Justice v6 S1-a Artifact Registry / Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` **only after a separate Human Owner implementation authorization**. Steps use checkbox (`- [ ]`) syntax for tracking. No automatic review dispatch or re-review loop is authorized.

**Goal:** Build a small offline, READ_ONLY S1-a checker that deterministically verifies an Owner-pinned Manifest and the exact Design → Plan → Task → mandatory AC identities without mistaking byte matches or caller claims for Human Owner approval.

**Architecture:** A pure TypeScript core validates strict JSON, resolves a reference-only TaskIntent, and returns immutable identity diagnostics; an injected Node/Bun raw-byte filesystem reader and a separate `justice-s1a` CLI supply only read-only I/O. Manifest raw bytes must match the externally supplied SHA-256 **before parsing**. Neither the loader nor downstream consumers may promote identity matches into approval or execution evidence.

**Tech Stack:** Existing TypeScript 6 / Bun / Node built-ins (`node:crypto`, `node:fs/promises`, `node:path`, `node:buffer`); existing Vitest 4; no new runtime dependencies, database, network calls, authentication or Host plugin coupling.

**Spec:** `docs/superpowers/specs/2026-11-03-justice-v6-s1a-artifact-loader-design.md`, **R0.1.1** at `yohi/justice` branch `feature/justice-v6-s1a-artifact-loader-design-20261103`, commit `395fa0ea7147adfe7cbad6e715b925c516cf46b9` (Git blob SHA `9aefa8859e584c6e5c60b2b780687d2fe5d0d904`); Issue [#350](https://github.com/yohi/justice/issues/350), parent decision [#349 D-1–D-3](https://github.com/yohi/justice/issues/349#issuecomment-6600623047).

**Proposed repository destination (NOT WRITTEN):** `docs/superpowers/plans/2026-11-04-justice-v6-s1a-artifact-loader.md`. The present deliverable is a local Markdown candidate only.

**Authority status (2026-11-04 JST):** Human Owner explicitly adopted R0.1.1 and authorized **this Implementation Plan's creation only**. The design document's earlier `OWNER_APPROVAL_PENDING` header is historical, not a reason to rewrite it without approval. This plan is `PLAN_CANDIDATE / OWNER_DECISION_PENDING`; **S1 code edits, Build/Test/CI, filesystem/Host probes, commits/push/PR, Gate/HOLD changes, and new reviews are NOT authorized by this plan**. The checked boxes below describe future authorized execution, not actions completed now.

## Global Constraints

- S1-a only. S1-b/S1-c integration is a **typed handoff**, not implementation of evidence assessment, deviation rules or an authoritative Gate.
- Preserve one Owner-fixed Manifest, CLI-supplied independently pinned SHA-256, exact revision, reference-only TaskIntent, artifact-byte dirty definition; never auto-select an older/newer revision.
- Only `sha256` over **raw Buffer bytes** is valid for Manifest/artifacts; never reuse `FileReader` (UTF-8 text), `plan-fingerprint.ts` (canonicalized content), `plan-authorization.ts` (mutable session state), or `loader-contract.ts` (OpenCode plugin export validation).
- Manifest schema: `justice-s1a-manifest-v1`; TaskIntent schema: `justice-s1a-task-intent-v1`; result schema: `justice-s1a-result-v1`. Kinds exactly `design | plan | task | ac`; revisions and scope keys are opaque, case-sensitive, exact equality.
- Owner authority output **always** `NOT_PROVEN`; `ownerTrustPrecondition` **always** `EXTERNAL_NOT_VERIFIED_BY_S1A`; `eligibleBaseline` **always** `false`. `identityCandidateReady` is `true` iff all identity checks match; its only permission is **read-only analysis**.
- A real Owner-controlled origin for the CLI SHA-256 is an **external, unverified prerequisite**. Never infer provenance from flags, matching digest, `approvalRef`, fields in input files, process environment or AI claims; no `EXTERNALLY_ASSERTED_NOT_CRYPTOGRAPHICALLY_PROVEN` status is emitted by S1-a.
- A missing/invalid expected Manifest SHA-256 is `UNKNOWN`/input-invalid; **only an actually completed differing hash comparison** produces `MANIFEST_DIGEST_MISMATCH` and `manifestDigestMatch=false`.
- Negative results must distinguish observed `MISMATCH` from `UNKNOWN`; aggregate priority: **any observed MISMATCH > any UNKNOWN > all MATCH**. No partial success can become eligible.
- No secrets/absolute host paths in returned diagnostics or CLI output; no timestamps or nondeterministic fields. Preserve stable Design, Plan, Task, AC-by-ID ordering.
- READ_ONLY includes no report-file write, hidden artifact generation, Git mutation, Review/Fix/Task launch, external service call, Host execution block, Gate/HOLD change or permission mutation. Tests may use disposable fixtures **only when separately authorized**.
- Resource policy for S1-a v1: `MAX_MANIFEST_BYTES=1_048_576`, `MAX_INTENT_BYTES=65_536`, `MAX_ARTIFACT_BYTES=8_388_608`, `MAX_TOTAL_ARTIFACT_BYTES=33_554_432` per invocation, `MAX_MANIFEST_ENTRIES=512`, `MAX_SELECTED_ARTIFACTS=128`, `MAX_JSON_DEPTH=32`, `MAX_RELATIVE_PATH_LENGTH=1024`. Fail as incomplete/invalid, never truncate.
- Runtime target is the repository's Linux/Bun `.devcontainer`; no claim of cross-platform hardened filesystem confinement or race freedom. Keep all existing `v4 STOP`, `v5 BLOCKED`, R0.2.4 `PROPOSED_NOT_ADOPTED`, S2–S5 holds unchanged.
- Repository conventions: `src/core/**` stays independent of `@opencode-ai/*`; tests use Vitest; production build compiles with existing `tsc`; never edit `src/core/plan-fingerprint.ts`, `src/core/plan-authorization.ts`, `src/core/loader-contract.ts` or existing plugin control flow for S1-a.

## Review Focus (mapped to owning test steps)

1. **Changed Manifest with valid-looking JSON:** byte mismatch must short-circuit parsing, including malicious `approved: true` (Task 4: `manifestMismatchStopsBeforeParse`).
2. **Escaped duplicate JSON property / invalid UTF-8:** strict parser rejects before trust, including `"\u0061rtifacts"` conflicting with `"artifacts"` (Task 1: `duplicateEscapedKeysAndInvalidUtf8`).
3. **Two mandatory ACs but intent references one:** must return `REQUIRED_AC_MISSING`, not a partial identity match (Task 2: `missingMandatoryAcNeverResolvesPartially`).
4. **Symlinked intermediate directory or nonregular file:** no unsafe read; result `ARTIFACT_UNREADABLE`/`UNKNOWN`, never an alleged race-proof security guarantee (Task 3: `rejectSymlinkAndSpecialFiles`).
5. **AI-supplied substituted Manifest and matching SHA-256:** identity may be `MATCH` but Owner authority stays `NOT_PROVEN` and `eligibleBaseline=false` (Task 4: `matchingForgedPairNeverPromotesAuthority`).

---

## Planned file map (implementation-time only)

| Future file | Single responsibility |
|---|---|
| `src/core/s1a/contract.ts` | Versioned types, limits, reason codes and frozen result constructors |
| `src/core/s1a/strict-json.ts` | Fatal UTF-8 decoding, JSON syntax/depth and duplicate-key detection |
| `src/core/s1a/manifest.ts` | Strict structural parsing and Manifest graph validation |
| `src/core/s1a/resolver.ts` | Untrusted TaskIntent validation and full four-kind identity resolution |
| `src/core/s1a/loader.ts` | Digest-first orchestration, raw SHA-256 comparisons and result aggregation |
| `src/runtime/s1a-read-only-fs.ts` | Narrow bounded raw-byte reader with symlink/traversal/nonregular safeguards |
| `src/runtime/s1a-cli.ts` | Standalone executable, JSON stdout, stable exit codes; no plugin bootstrap |
| `tests/core/s1a/*.test.ts` | Pure parser/graph/orchestration contract tests and mock I/O |
| `tests/real-fs/s1a-read-only-fs.test.ts` | Authorized-future disposable local fixture I/O tests |
| `tests/runtime/s1a-cli.test.ts` | CLI argv/stdout/exit integration tests with temp fixtures |
| `tests/helpers/s1a-fixtures.ts` | Reusable deterministic in-memory fixture builder; test-only |
| `tests/fixtures/justice-s1a/` | Small positive canonical files and manifest/intent for S1-a only |
| `package.json` | Add **separate** `justice-s1a` binary and executable bit in existing build script; retain existing `justice` bin and plugin behavior |

**No worktree, repo file or runtime file is created by authoring this plan.** During a separately authorized execution, initialize an isolated worktree, follow existing `.devcontainer` conventions, then implement Tasks 1–5 sequentially. Do not start S1-b, S1-c, independent reviewer jobs or unapproved GitHub writes as a side effect.

## Shared types and stable semantics (required across all tasks)

Define in `src/core/s1a/contract.ts` (exact exported identifiers, no duplicate definitions in later tasks):

```ts
export type ArtifactKind = "design" | "plan" | "task" | "ac";
export type IdentityStatus = "MATCH" | "MISMATCH" | "UNKNOWN";
export type ReasonCategory = "IDENTITY_MATCH" | "INPUT_INVALID" | "CHECK_INCOMPLETE" | "OBSERVED_CONTRADICTION";
export type ReasonCode =
  | "CHECK_MATCH" | "IDENTITY_MATCH_WITH_AUTHORITY_LIMITATION"
  | "CLI_ARGUMENT_INVALID" | "MANIFEST_DIGEST_REQUIRED" | "MANIFEST_DIGEST_FORMAT_INVALID"
  | "MANIFEST_UNREADABLE" | "MANIFEST_DIGEST_MISMATCH" | "MANIFEST_INVALID"
  | "TASK_INTENT_UNREADABLE" | "TASK_INTENT_INVALID"
  | "KIND_MISMATCH" | "REVISION_MISMATCH"
  | "SCOPE_MISMATCH" | "PARENT_LINK_MISMATCH" | "REQUIRED_AC_MISSING"
  | "ARTIFACT_UNREADABLE" | "ARTIFACT_DIGEST_MISMATCH";
export const S1A_LIMITS = Object.freeze({
  manifestBytes: 1_048_576, intentBytes: 65_536, artifactBytes: 8_388_608,
  totalArtifactBytes: 33_554_432, manifestEntries: 512,
  selectedArtifacts: 128, jsonDepth: 32, relativePathLength: 1024,
} as const);
export class S1aValidationError extends Error {
  constructor(readonly reasonCode: "MANIFEST_INVALID" | "TASK_INTENT_INVALID") {
    super(reasonCode);
    this.name = "S1aValidationError";
  }
}
export interface Sha256Digest { readonly algorithm: "sha256"; readonly hex: string; }
export interface ApprovedArtifactRef {
  readonly artifactId: string; readonly kind: ArtifactKind; readonly revision: string;
  readonly digest: Sha256Digest; readonly relativePath: string; readonly scopeKey: string;
  readonly approvalRef: string; readonly parentId?: string;
}
export interface OwnerManifest {
  readonly schemaVersion: "justice-s1a-manifest-v1";
  readonly manifestId: string;
  readonly artifacts: readonly ApprovedArtifactRef[];
}
export interface IntentRef { readonly artifactId: string; readonly revision: string; }
export interface TaskIntent {
  readonly schemaVersion: "justice-s1a-task-intent-v1"; readonly scopeKey: string;
  readonly design: IntentRef; readonly plan: IntentRef; readonly task: IntentRef;
  readonly ac: readonly IntentRef[];
}
export interface LoaderCheck {
  readonly targetId: string; readonly check: string; readonly outcome: IdentityStatus;
  readonly reasonCode: ReasonCode; readonly category: ReasonCategory;
  readonly expected?: string; readonly observed?: string;
}
export interface SelectedArtifactRef {
  readonly artifactId: string; readonly kind: ArtifactKind; readonly revision: string;
  readonly scopeKey: string; readonly parentId?: string;
  readonly expectedDigest: string; readonly observedDigest: string | null;
  readonly digestOutcome: IdentityStatus;
}
export interface LoaderResult {
  readonly schemaVersion: "justice-s1a-result-v1";
  readonly manifestId?: string; // only after digest+schema validation
  readonly manifestDigestMatch: boolean | "unknown";
  readonly identityStatus: IdentityStatus;
  readonly ownerAuthorityStatus: "NOT_PROVEN";
  readonly ownerTrustPrecondition: "EXTERNAL_NOT_VERIFIED_BY_S1A";
  readonly identityCandidateReady: boolean;
  readonly eligibleBaseline: false;
  readonly selectedRefs: readonly SelectedArtifactRef[];
  readonly checks: readonly LoaderCheck[];
  readonly limitations: readonly string[];
}
export interface S1aReadOnlySource {
  readInputFile(path: string, maxBytes: number): Promise<Uint8Array>;
  readArtifact(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array>;
}
export interface LoaderInput {
  readonly manifestPath: string; readonly expectedManifestSha256?: string;
  readonly intentPath: string; readonly artifactsRoot: string;
}
```

- Internal `ResolvedSelection` is `{ readonly refs: readonly ApprovedArtifactRef[]; readonly checks: readonly LoaderCheck[]; readonly complete: boolean }`. `resolveTaskIntent(manifest, intent)` returns this result; unusable structure uses an explicit typed `TASK_INTENT_INVALID` outcome rather than accepting a partial selection.
- Limitations include these exact stable values in this order for **every** result: `OWNER_ORIGIN_NOT_VERIFIED`, `SUPERSESSION_NOT_CHECKED`, `HOST_EXECUTION_NOT_PROVEN`, `FILESYSTEM_RACE_FREEDOM_NOT_PROVEN`. This is metadata, not a new attestation mechanism.
- A `LoaderResult` with valid Manifest but a missing/unreadable artifact may retain the **fully resolved** `selectedRefs` with `observedDigest=null`/`digestOutcome=UNKNOWN`. `selectedRefs=[]` on missing/invalid digest, Manifest-unreadable/mismatch/invalid, or invalid/unresolvable TaskIntent. A fully resolved yet contradictory revision/scope may retain selection **only if it remains complete and unambiguous**.
- `approvalRef` is stored as **untrusted informational Manifest data**, but is intentionally **not copied into `LoaderResult` or CLI output** (to avoid leaking arbitrary reference URLs or tokens); any later citation/report use requires its own safe/redacted policy. Do not infer approval from it.
- Arrays and returned objects are copied and recursively frozen (no shared mutable input references); `Object.freeze` is applied to `checks`, `selectedRefs`, each item and enclosing result. No private paths are included in checks. `identityStatus` equals the strongest recorded check outcome, except unmatched-but-structurally-invalid parsing is `UNKNOWN`.

## CLI contract (fix before any implementation)

```text
justice-s1a check --manifest <file> --manifest-sha256 <64 lowercase hex> --intent <file> --artifacts-root <dir>
```

- Publish this as a **new** `bin` key `justice-s1a` pointing to `./dist/runtime/s1a-cli.js`, leaving `justice` unchanged; standalone source invocation for implementation-time testing: `bun src/runtime/s1a-cli.ts check ...`.
- Exactly one JSON object (`LoaderResult`) plus final `\n` to stdout for each call, **including expected errors**; no timestamps/host paths/secrets or normal diagnostic chatter on stderr. Do not write any report file.
- For correct `check` subcommand: `exit 0` iff `identityStatus=MATCH`; `exit 2` iff `MISMATCH`; `exit 3` iff `UNKNOWN` (including missing/invalid digest). **Exit 0 means only identity match, never approval.**
- Unknown subcommand, missing/extra/duplicate/unknown flags: `exit 64`, return the fixed non-eligible `UNKNOWN` result with `CLI_ARGUMENT_INVALID` as its check; **exception:** missing `--manifest-sha256` alone with otherwise valid invocation is `MANIFEST_DIGEST_REQUIRED` / exit 3, not 64. Missing other required path flag is `CLI_ARGUMENT_INVALID` / exit 64. Expected digest supplied as empty string counts as missing; wrong-length, uppercase, prefixed or nonhex as format-invalid / exit 3.
- `--manifest`, `--intent` and `--artifacts-root` are input locators, not approval authority. Do not print their raw values; reject flag values beginning with `--` instead of consuming them as paths; reject positional extras. No environment-variable approval fallback, auto-discovery or network lookup.

## Task 1: Strict JSON, schema types and Manifest validation

**Files**
- Create: `src/core/s1a/contract.ts`, `src/core/s1a/strict-json.ts`, `src/core/s1a/manifest.ts`
- Test: `tests/core/s1a/contract.test.ts`, `tests/core/s1a/manifest.test.ts`
- Create test helper: `tests/helpers/s1a-fixtures.ts`

**Interfaces**
- Consumes: raw Manifest `Uint8Array` after caller-verified expected SHA; no filesystem reading or approval credentials.
- Produces: `parseStrictJson(bytes: Uint8Array, maxBytes: number): unknown` and `parseOwnerManifest(bytes: Uint8Array): OwnerManifest` (throw a typed `S1aValidationError` carrying `reasonCode="MANIFEST_INVALID"`). Export `isLowercaseSha256Hex(value: unknown): value is string`; `freezeLoaderResult(result: LoaderResult): LoaderResult`.

- [ ] **Step 1 (RED):** Add deterministic valid Manifest, invalid-schema, duplicate-ID, duplicate-key, unknown-field, nested escaped-duplicate-key, invalid UTF-8 and cyclic/broken-parent tests. Explicit assertions:
  ```ts
  expect(parseOwnerManifest(validBytes).schemaVersion).toBe("justice-s1a-manifest-v1");
  expect(() => parseOwnerManifest(duplicateIdBytes)).toThrowError(/MANIFEST_INVALID/);
  expect(() => parseOwnerManifest(utf8InvalidBytes)).toThrowError(/MANIFEST_INVALID/);
  expect(() => parseOwnerManifest(escapedDuplicateKeyBytes)).toThrowError(/MANIFEST_INVALID/);
  expect(isLowercaseSha256Hex("a".repeat(64))).toBe(true);
  expect(isLowercaseSha256Hex("A".repeat(64))).toBe(false);
  ```
  Named test: `duplicateEscapedKeysAndInvalidUtf8`. Test helper constructs real `sha256` fixture digests from literal artifact byte buffers; no placeholder digests used as valid inputs.
- [ ] **Step 2:** Run `bun run vitest run tests/core/s1a/contract.test.ts tests/core/s1a/manifest.test.ts` inside authorized `.devcontainer`; expect RED for missing implementations.
- [ ] **Step 3 (GREEN):** Implement exact strict UTF-8 decoding (`TextDecoder("utf-8", { fatal: true })`), syntax validation via `JSON.parse`, and a bounded recursive token scanner for **duplicate object keys** (decode string-key escapes with `JSON.parse(keyToken)` before Set comparison). Check JSON nesting depth; reject duplicate keys anywhere, including Unicode-escaped equivalents; let `parseStrictJson` throw a safe parsing error and have `parseOwnerManifest`/`parseTaskIntent` wrap it in their own `S1aValidationError` reason; do not rely on `JSON.parse` alone to detect duplicates. Validate exact allowed keys, typed fields, 64-lowercase-hex raw digests, all unique IDs and relative paths, parent kind/ID existence, no cycles or conflicting paths, max 512 entries, single Manifest root; refuse unknown `approved` fields. Treat invalid schema as UNKNOWN later, never an observed digest mismatch.
- [ ] **Step 4:** Re-run the same command; expect GREEN, with no production I/O. Ensure `strict-json.ts` bounds token count using byte cap/depth and does not convert hashes via Markdown normalization.
- [ ] **Step 5:** Record Task 1 result; commit only under a **later** Git-write authorization: `git add src/core/s1a/contract.ts src/core/s1a/strict-json.ts src/core/s1a/manifest.ts tests/core/s1a/contract.test.ts tests/core/s1a/manifest.test.ts tests/helpers/s1a-fixtures.ts && git commit -m "feat(justice-s1a): define strict fixed-artifact manifest contract"`.

## Task 2: Full reference/parent/mandatory-AC resolution

**Files**
- Create: `src/core/s1a/resolver.ts`
- Test: `tests/core/s1a/resolver.test.ts`

**Interfaces**
- Consumes: `OwnerManifest` from Task 1 plus parsed `TaskIntent`.
- Produces: `parseTaskIntent(bytes: Uint8Array): TaskIntent` and `resolveTaskIntent(manifest: OwnerManifest, intent: TaskIntent): ResolvedSelection` as defined above. The first throws typed `TASK_INTENT_INVALID` on malformed/unknown fields/duplicate JSON keys; reference resolution produces typed checks, does not mutate the Manifest.

- [ ] **Step 1 (RED):** Add named tests `resolvesOneDesignPlanTaskAndTwoAcs`, `missingMandatoryAcNeverResolvesPartially`, `stalePlanRevisionNoFallback`, `scopeAndParentConflict`, `wrongKindAndUnknownReference`. Include:
  ```ts
  expect(ok.refs.map(r => r.kind)).toEqual(["design", "plan", "task", "ac", "ac"]);
  expect(missingAc.checks.map(c => c.reasonCode)).toContain("REQUIRED_AC_MISSING");
  expect(missingAc.complete).toBe(false);
  expect(stalePlan.checks.map(c => c.reasonCode)).toContain("REVISION_MISMATCH");
  expect(stalePlan.complete).toBe(true); // full ID graph still unambiguous
  ```
- [ ] **Step 2:** Run `bun run vitest run tests/core/s1a/resolver.test.ts`; expect RED.
- [ ] **Step 3 (GREEN):** Parse only `schemaVersion`, `scopeKey`, `design`, `plan`, `task`, `ac`. Require nonempty AC array; exact `artifactId`/`revision` keys in refs and no duplicates. Resolve by ID with exact kinds, revisions and scope. Enforce the chain Design ← Plan ← Task ← all Manifest AC children of Task. Compare AC sets by ID **and revision**, reject omission/extra, and sort by Design/Plan/Task/AC ID. Unknown/nonexistent ID or malformed intent => `TASK_INTENT_INVALID` and no refs; exact observed contradiction (`REVISION_MISMATCH`, `SCOPE_MISMATCH`, `KIND_MISMATCH`, `PARENT_LINK_MISMATCH`, `REQUIRED_AC_MISSING`) => `MISMATCH`. Never search for latest or bind another Task's AC.
- [ ] **Step 4:** Run target tests again; expect GREEN. Confirm a complete graph with stale revision is still **not** a match, and an incomplete AC graph never returns selected refs for approval.
- [ ] **Step 5:** If separately permitted, commit Task 2 alone: `git add src/core/s1a/resolver.ts tests/core/s1a/resolver.test.ts && git commit -m "feat(justice-s1a): resolve pinned task and mandatory AC graph"`.

## Task 3: Bounded raw-byte READ_ONLY filesystem adapter

**Files**
- Create: `src/runtime/s1a-read-only-fs.ts`
- Test: `tests/real-fs/s1a-read-only-fs.test.ts`

**Interfaces**
- Consumes: `S1aReadOnlySource`, literal input paths/root/selected relative path and maxByte limit.
- Produces: `createS1aReadOnlySource(): S1aReadOnlySource`; on failure throws an exported `S1aReadError extends Error` constructed as `new S1aReadError(kind)` with `readonly kind: "unsafe_path" | "nonregular" | "unreadable" | "over_limit" | "changed_during_read"`; `message` must equal `kind` and **never include the absolute path**. Loader maps input-file failures to `MANIFEST_UNREADABLE`/`TASK_INTENT_UNREADABLE`, artifact failures to `ARTIFACT_UNREADABLE`.

- [ ] **Step 1 (RED):** Add disposable temporary-directory tests `readsExactRawBytes`, `rejectsDotDotAndAbsoluteArtifactPaths`, `rejectSymlinkAndSpecialFiles`, `rejectOverLimitBeforeUnboundedRead`, `changedFileReturnsUnknownNotMatch`. Include:
  ```ts
  expect(bytes).toEqual(new Uint8Array([0, 255, 10])); // raw, not UTF-8 text
  await expect(src.readArtifact(root, "../outside", 100)).rejects.toMatchObject({ kind: "unsafe_path" });
  await expect(src.readArtifact(root, "link/file", 100)).rejects.toMatchObject({ kind: "unsafe_path" });
  ```
  Also test symlink as the final file, named pipe/FIFO/nonregular when supported by environment, and parent path traversal; **no writes outside disposable test fixture directories**.
- [ ] **Step 2:** Run `bun run vitest run tests/real-fs/s1a-read-only-fs.test.ts` inside approved `.devcontainer`; expect RED.
- [ ] **Step 3 (GREEN):** Implement native Linux read-only bounded `Uint8Array`/Buffer reads using `node:fs/promises` `lstat`, `open` with `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` and `fstat` regular-file checks; enforce byte cap by bounded reads, not whole-file `readFile` followed by a length check; always close handles. Treat root, intermediate components and final components as unsafe if symlinked. Reject absolute, empty, `.`, `..`, backslash, NUL and noncanonical artifact relative paths; do not deliberately dereference outside the supplied root; acknowledge that path-component races are not eliminated. Compare `dev/ino/size/mtime/ctime` around read to return `changed_during_read` if observed. Do **not** claim race freedom: pre-open component checks and path opens are not descriptor-relative atomic confinement, and strong attacker/race/hardlink guarantees are explicitly absent.
- [ ] **Step 4:** Re-run target real-fs tests; expect GREEN (skip optional unsupported FIFO construction only with an explicit report; never convert a skip into proven success).
- [ ] **Step 5:** Commit Task 3 only after separate Git-write approval: `git add src/runtime/s1a-read-only-fs.ts tests/real-fs/s1a-read-only-fs.test.ts && git commit -m "feat(justice-s1a): read bounded artifact bytes without writes"`.

## Task 4: Digest-first Loader and immutable trust-separated result

**Files**
- Create: `src/core/s1a/loader.ts`
- Test: `tests/core/s1a/loader.test.ts`

**Interfaces**
- Consumes: `LoaderInput` and injectable `S1aReadOnlySource` from Tasks 1–3.
- Produces: `loadS1aArtifacts(input: LoaderInput, source: S1aReadOnlySource): Promise<LoaderResult>`. It may use `createHash("sha256").update(rawUint8Array).digest("hex")`, but never `hashString()` or canonical fingerprints.

- [ ] **Step 1 (RED):** Add `missingDigestPerformsZeroReads`, `malformedDigestPerformsZeroReads`, `manifestMismatchStopsBeforeParse`, `validDigestBadSchemaUnknown`, `missingArtifactUnknown`, `artifactByteMismatchObserved`, `mismatchOverridesOtherUnknown`, `matchingForgedPairNeverPromotesAuthority`, `readOnlyNoSideEffects`. For missing digest, assert **entire** critical contract:
  ```ts
  expect(result.manifestDigestMatch).toBe("unknown");
  expect(result.identityStatus).toBe("UNKNOWN");
  expect(result.selectedRefs).toEqual([]);
  expect(result.identityCandidateReady).toBe(false);
  expect(result.ownerAuthorityStatus).toBe("NOT_PROVEN");
  expect(result.ownerTrustPrecondition).toBe("EXTERNAL_NOT_VERIFIED_BY_S1A");
  expect(result.eligibleBaseline).toBe(false);
  expect(result.checks[0]?.reasonCode).toBe("MANIFEST_DIGEST_REQUIRED");
  expect(source.readInputFile).not.toHaveBeenCalled();
  ```
  Repeat for invalid digest with `MANIFEST_DIGEST_FORMAT_INVALID`; mismatch asserts `manifestDigestMatch=false`, `MANIFEST_DIGEST_MISMATCH`, `MISMATCH`, `selectedRefs=[]`, **intent reader never called**. Forged matching pair asserts identity `MATCH`, candidate `true` but authority `NOT_PROVEN` and `eligibleBaseline=false`.
- [ ] **Step 2:** Run `bun run vitest run tests/core/s1a/loader.test.ts`; expect RED.
- [ ] **Step 3 (GREEN):** Implement strict ordering: (a) presence/format of expected digest **without any read**; (b) bounded raw Manifest read + SHA comparison **before any JSON parse**; (c) Manifest parse; (d) bounded intent read/parse and graph resolution; (e) sequential bounded artifact reads and byte comparisons; (f) stable immutable `LoaderResult`. Use `MANIFEST_DIGEST_MISMATCH` only after observed comparison. Set `manifestId` only after validated Manifest schema; `selectedRefs` only after complete resolution, with null observed hashes for unreadable artifacts. Record every concrete contradiction; aggregate MISMATCH > UNKNOWN > MATCH. Never leak absolute input/relative paths, approvalRef, raw content, secrets or stack traces. Always enforce constant Owner disclaimer; `identityCandidateReady = (identityStatus === "MATCH")`, `eligibleBaseline=false`.
- [ ] **Step 4:** Re-run Task 4 tests; expect GREEN. Add a frozen-object mutation attempt and repeated-call byte-stability assertion; no calls to filesystem writes, Git, Host hooks, Review or Gate.
- [ ] **Step 5:** If separately authorized, commit Task 4 alone: `git add src/core/s1a/loader.ts tests/core/s1a/loader.test.ts && git commit -m "feat(justice-s1a): verify pinned bytes without authority escalation"`.

## Task 5: Standalone CLI, small canonical Fixture and execution contract

**Files**
- Create: `src/runtime/s1a-cli.ts`, `tests/runtime/s1a-cli.test.ts`
- Create: `tests/fixtures/justice-s1a/manifest.json`, `tests/fixtures/justice-s1a/task-intent.json`, `tests/fixtures/justice-s1a/design.md`, `plan.md`, `task-1.json`, `ac-1.json`, `ac-2.json`, `README.md` (all paths under that directory)
- Modify (implementation-time only): `package.json` (`bin.justice-s1a` and build chmod only)

**Interfaces**
- Consumes: `loadS1aArtifacts` and `createS1aReadOnlySource`.
- Produces: `runS1aCli(argv: readonly string[], source: S1aReadOnlySource): Promise<{ readonly stdout: string; readonly exitCode: 0 | 2 | 3 | 64 }>` for tests, plus executable `justice-s1a check`. `stdout` is exactly `JSON.stringify(result) + "\n"`; the entrypoint is gated by a standard main-module guard so importing it does not spawn/exit.

- [ ] **Step 1 (RED):** Create the small fixture with genuine SHA-256 digests. Generate final Manifest bytes **once**, record its exact SHA-256 in fixture `README.md` (expected digest is *documentation for test*, not proof of Owner identity). Add CLI tests for P-01 and all N-01 through N-09 variants, including N-06a/b/c and N-08a/b. Explicit assertions:
  ```ts
  expect(JSON.parse(stdout).identityStatus).toBe("MATCH"); // P-01
  expect(JSON.parse(stdout).eligibleBaseline).toBe(false);
  expect(exitCode).toBe(0); // identity-only; NOT approval
  expect(missingDigest.exitCode).toBe(3);
  expect(JSON.parse(missingDigest.stdout).checks[0].reasonCode).toBe("MANIFEST_DIGEST_REQUIRED");
  expect(mismatch.exitCode).toBe(2);
  expect(badArgs.exitCode).toBe(64);
  ```
  Assert unknown flags/duplicate flags yield JSON, no absolute paths or credentials appear, no filesystem changes from the CLI itself, and two invocations with identical inputs produce identical JSON bytes. For N-09, altered Manifest/digest can still match *identity* but never Owner approval.
- [ ] **Step 2:** Run `bun run vitest run tests/runtime/s1a-cli.test.ts`; expect RED.
- [ ] **Step 3 (GREEN):** Add a separate CLI with exact arguments and exit mapping above. Extend only the `bin` map and executable chmod in existing build script; do not route through `doctor-cli.ts`, `opencode-plugin.ts` or existing authorization lifecycle. Validate arguments before invoking the reader. Print only JSON plus newline, without report-file writing. Make source executable through the existing `tsc` output/build flow.
- [ ] **Step 4:** Re-run Task 5 tests; expect GREEN. Run scoped suite `bun run vitest run tests/core/s1a tests/real-fs/s1a-read-only-fs.test.ts tests/runtime/s1a-cli.test.ts`; then, **only within separately authorized implementation execution**, run full repository `bun run test`, `bun run typecheck`, `bun run lint`, `bun run build` from `.devcontainer`. Expect all exit 0; otherwise record actual failure without declaring pass or invoking an automatic review/fix cycle.
- [ ] **Step 5:** If separately authorized, commit Task 5: `git add src/runtime/s1a-cli.ts tests/runtime/s1a-cli.test.ts tests/fixtures/justice-s1a package.json && git commit -m "feat(justice-s1a): expose read-only identity CLI and fixtures"`.

## End-to-end contract and bounded acceptance

| Requirement / scenario | Owner task | Expected S1-a result |
|---|---|---|
| Raw Manifest byte pin checked before parsing | 1, 4 | N-01 `MANIFEST_DIGEST_MISMATCH`, `manifestDigestMatch=false`, `selectedRefs=[]` |
| Digest absent/invalid distinct from mismatch | 4, 5 | N-06b `MANIFEST_DIGEST_REQUIRED` and N-06c `MANIFEST_DIGEST_FORMAT_INVALID`; `"unknown"`, `UNKNOWN`, `[]` |
| Exact ID/Kind/Revision/Scope | 1, 2 | N-02/N-04 and wrong-kind negative cases are non-MATCH without fallback |
| Complete Design→Plan→Task→mandatory AC relation | 1, 2 | N-05 missing AC/parent contradiction does not resolve as full baseline |
| Raw bytes and dirty artifact | 3, 4 | N-03 `ARTIFACT_DIGEST_MISMATCH` only on observed bytes |
| Unreadable/symlink/unsafe path | 1, 3, 4 | N-06a/N-08b `UNKNOWN` unless another observed mismatch exists |
| Invalid Manifest schema, duplicates, unknown `approved` | 1, 4 | N-07/N-08a `MANIFEST_INVALID`, `manifestDigestMatch=true`, `selectedRefs=[]` |
| No Owner approval synthesized from successful identity | 1, 4, 5 | P-01/N-09 always `NOT_PROVEN`, `EXTERNAL_NOT_VERIFIED_BY_S1A`, `eligibleBaseline=false` |
| Typed downstream handoff only | 1, 2, 4 | Frozen `LoaderResult`; S1-b/S1-c cannot construe `identityCandidateReady` as acceptance |
| READ_ONLY, Host-independent behavior | 3, 4, 5 | No network/write/Review/Fix/Gate effect; no claimed race-proof enclosure |

**Ready-for-Owner-decision threshold (at implementation end, not today):** All applicable positive/negative fixture expectations observed; scoped and full project checks freshly run with evidence; any skipped/unsupported real-fs case explicitly marked unproven; any remaining limitations and exact code/commit identity stated. Do **not** require Finding count zero or a chain of independent reviews as a default exit criterion. A completed S1-a is a diagnostic identity tool, **not** Human Owner authorization or proof that Task/AC execution occurred.

**Implementation stop conditions:** Stop immediately on attempting new authority inputs, Host enforcement, unexpected writes, symlink boundary breach, credential exposure or Gate/HOLD changes; fail closed for that operation and report to Human Owner. For ordinary incomplete reads, return diagnostic `UNKNOWN` without halting unrelated work. If Task 1–5 results are adequate, stop S1-a; do not auto-start S1-b/c or S2–S5.

## Plan/document consistency and ownership checkpoint

- Terminology is kept identical to R0.1.1 for `MATCH`/`MISMATCH`/`UNKNOWN` (identity), `NOT_PROVEN` (Owner), `identityCandidateReady` (analysis), and `eligibleBaseline=false` (acceptance). No `OWNER_PROVEN` or external-assertion pathway exists in S1-a.
- Implementation-selected constants, CLI exit codes, `LoaderResult` TypeScript shapes, parser and filesystem mechanics are **implementation-detail decisions in this plan**, not new Owner claims of runtime safety. They are explicitly reviewable by the Human Owner at the plan checkpoint; if unacceptable, change the plan before executing.
- The design is **adopted in this conversation** by Human Owner; repo design R0.1.1 remains unchanged. The plan has **not** been committed and its final adoption/implementation authority is **pending**.
- **Achieved by this task:** actionable documentation of S1-a Tasks 1–5 and their expected tests. **Not achieved:** code implementation, tests, commits, Host validation, additional reviews, GitHub/Library writes, approval/acceptance authority.
- **Stop now:** Present this plan to Human Owner for adoption and explicit scope-specific implementation decision. Do not automatically invoke execution, another review, correction or document preservation task.
