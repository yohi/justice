# Atomic Claim Ownership and Archive Concurrency Implementation Plan

> **For agentic workers:** Execute this plan inline in the current session. Do not dispatch subagents or create a commit.

**Goal:** Prevent a writer that lost a shared persistence claim from mutating another writer's claim, and add regression coverage and documentation that accurately describe the guarantee.

**Architecture:** Add a per-attempt claim identity to the internal versioned envelope. After the main-file version recheck, `AtomicPersistence` verifies that the shared claim still carries its own identity; a lost claim becomes a retryable conflict and never triggers cleanup or publication of the shared claim. Exercise the production archive factory through two independent `JusticePlugin` instances sharing an injected filesystem, while keeping all tests mock-based.

**Tech Stack:** TypeScript, Bun, Vitest, injected `FileReader`/`FileWriter` mocks, Markdown documentation.

## Global Constraints

- Preserve pure-core boundaries: `src/core/**` must not import `@opencode-ai/*`.
- Preserve fail-open behavior at persistence and notifier boundaries.
- Keep public state immutable and use `unknown` casts for private-field test inspection.
- Keep unit tests off real disk except the documented `tests/preflight-verification.test.ts` document preflight and existing designated real-fs integration tests.
- Run `bun run test`, `bun run typecheck`, `bun run lint`, and `bun run build` inside the devcontainer before reporting completion.
- Do not commit, push, or use subagents.

---

### Task 1: Protect the shared claim during stale-claim races

**Files:**
- Modify: `src/core/atomic-persistence.ts:29-54,147-185,262-269`
- Test: `tests/core/atomic-persistence.test.ts`

**Interfaces:**
- `VersionedEnvelope<T>` gains an internal `claimId: string` field. `loadWithLock()` continues returning only `data` and `lockMeta`.
- `AttemptResult<T>` gains a retryable `claim_lost` variant without exposing the claim identity in `SaveResult`.
- Add a private ownership predicate that reads and parses `claimPath` and returns true only when its envelope has the current attempt's `claimId`.

- [x] **Step 1: Write the failing stale-claim ownership test**

Add a test to `tests/core/atomic-persistence.test.ts` that uses a shared mock filesystem and two `AtomicPersistence` instances. Initialize `state.json` at version 1, start writer A with lock version 0, pause A after it has claimed the slot, let writer B reclaim the stale slot and claim it, then allow A to perform its version recheck while B still owns the slot. Before releasing B, assert that A has not called `deleteFile` or `rename` for `state.json.commit-pending`. Release B and assert that both writers eventually complete without a claim being deleted by the loser.

The test must distinguish the calls by the shared claim path and use separate reader wrappers so the two persistence instances model separate processes. The first implementation should fail because the current A path unconditionally calls `cleanup(claimPath)` after the version mismatch.

- [x] **Step 2: Run the focused test and verify the failure**

Run:

```bash
devcontainer exec --workspace-folder . bun run vitest run tests/core/atomic-persistence.test.ts
```

Expected: the new stale-claim ownership test fails because the original writer deletes the replacement claim.

- [x] **Step 3: Add claim identity and guard shared-claim operations**

Generate `claimId` inside each `runAttempt()` and serialize it alongside `version` and `data`. After `loadWithLock()` returns, verify ownership before either the version-mismatch cleanup or the publish rename. Return `claim_lost` when the shared claim is absent or has another `claimId`. In the exception path, call `cleanup(claimPath)` only after the same ownership check succeeds. Always retain `finally` cleanup for the attempt's unique `tmpPath`.

Handle `claim_lost` in `saveAtomicWithLock()` as a retryable rename conflict without invoking stale-claim reclamation for the other writer's claim.

- [x] **Step 4: Run the focused persistence tests**

Run:

```bash
devcontainer exec --workspace-folder . bun run vitest run tests/core/atomic-persistence.test.ts
```

Expected: all existing persistence tests and the new ownership test pass.

### Task 2: Verify the production archive merge under independent writers

**Files:**
- Modify: `tests/core/wisdom-archive.test.ts`

**Interfaces:**
- Use `JusticePlugin` construction to obtain the production-created local `WisdomArchive` through `getTieredWisdomStore()`. Inspect the private `localArchive` field only through an `unknown` cast, as required by `AGENTS.md`.
- Use two independent `JusticePlugin` instances backed by the same `createMockFileSystem()` so each archive has its own `appendQueue` but both use `createArchive()` and its `(id, archivedAt)` merge callback.

- [x] **Step 1: Write the failing production-merge concurrency test**

Add a test that starts two `append()` calls concurrently for entries with the same id and different content. Spy on `Date.prototype.toISOString` to provide two distinct deterministic `archivedAt` values. Assert that the final production archive contains both records and that both `(id, archivedAt)` keys are present.

Use two archive instances, not two calls on one archive, because `WisdomArchive.append()` intentionally serializes calls within one instance. The test should fail or be unable to prove the requested behavior if the production merge callback is replaced by the existing test-only trivial merge.

- [x] **Step 2: Run the focused archive tests**

Run:

```bash
devcontainer exec --workspace-folder . bun run vitest run tests/core/wisdom-archive.test.ts
```

Expected: the existing archive tests and the new production merge test pass.

### Task 3: Scope the governance preflight to §15.12

**Files:**
- Modify: `tests/preflight-verification.test.ts:6-41`

**Interfaces:**
- Keep the direct `existsSync` and `readFileSync` document preflight behavior.
- Introduce a section string beginning at `### 15.12` and ending at the next same-level `###` heading, or at EOF when no such heading exists.

- [x] **Step 1: Restrict all ADR assertions to the extracted section**

Find the §15.12 heading with a multiline heading expression, locate the next `^### (?!#)` heading after it, and slice `content` to that boundary. Assert that the heading exists, then replace every existing assertion target, including placeholder-negative assertions, with the extracted section string.

- [x] **Step 2: Run the focused preflight test**

Run:

```bash
devcontainer exec --workspace-folder . bun run vitest run tests/preflight-verification.test.ts
```

Expected: the document preflight passes while no assertion can be satisfied by text outside §15.12.

### Task 4: Align project guidance with the implemented behavior

**Files:**
- Modify: `AGENTS.md:27,45`
- Modify: `SPEC.md:1023-1027`
- Modify: `README.md:482`

**Interfaces:**
- Documentation must describe claim ownership verification and retry behavior without promising that every stale-claim race produces `ENOENT`.
- Keep the mock-based policy for ordinary tests and explicitly identify the document preflight exception.

- [x] **Step 1: Update the testing policy wording**

Document `tests/preflight-verification.test.ts` as an intentional real-disk exception because it verifies the committed `SPEC.md` document. Preserve injected mocks as the policy for ordinary unit tests and identify the existing real-fs integration suite separately so the blanket `tests/` wording is not misleading.

- [x] **Step 2: Update the stale-claim specification and README guarantee**

Replace the §5.23 stale-claim explanation with the implemented rule: stale reclaim may replace a claim, the original writer verifies its claim identity after the version recheck, and a writer that no longer owns the slot neither renames nor cleans the shared claim and instead retries. Update the README component description to mention version optimistic locking plus owner-verified atomic claims.

- [x] **Step 3: Run the complete verification suite**

Run all four project commands inside the devcontainer:

```bash
devcontainer exec --workspace-folder . bun run test
devcontainer exec --workspace-folder . bun run typecheck
devcontainer exec --workspace-folder . bun run lint
devcontainer exec --workspace-folder . bun run build
```

Expected: tests, typecheck, lint, and build exit successfully; lint may report existing warnings but must report zero errors.
