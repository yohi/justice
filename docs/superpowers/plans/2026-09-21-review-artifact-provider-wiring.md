# Review Artifact Provider Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the supported Linux `openat2`/`renameat2` review-artifact provider and wire both optional review-artifact capabilities through the production `OpenCodeAdapter` composition root without weakening fail-open behavior.

**Architecture:** A Rust N-API addon owns descriptor-relative filesystem operations and inode-bound reservation handles. A focused TypeScript adapter loads and probes only the bundled Linux x86_64 glibc addon, then maps it to the existing `FileWriter.createExclusiveMarker` and `ReservedReviewArtifactIo` contracts. `OpenCodeAdapter` creates the provider once and injects it into `NodeFileSystem`; unsupported or failed initialization leaves both capability slots absent.

**Tech Stack:** Bun, TypeScript 6, Vitest, Rust 1.88.0, `napi` 3.12.2, `napi-derive` 3.6.8, `libc` 0.2.177, `@napi-rs/cli` 3.2.0, Linux `openat2(2)`, `renameat2(2)`, `openat(2)`, `linkat(2)`, `fstat(2)`, `pread(2)`, `pwrite(2)`, and `unlinkat(2)` only where it is not used for verified quarantine deletion.

## Global Constraints

- Supported deployment is Linux x86_64 with glibc and working `openat2(2)` and `renameat2(2)`.
- The native crate package name is `justice_review_artifact_linux`; with `@napi-rs/cli --no-js --platform`, the emitted addon path is `dist/native/index.linux-x64-gnu.node`.
- `openReviewArtifactRoot(rootDir)` is the only native operation accepting a host path; every later operation is descriptor-relative and beneath `.justice/reviews`.
- Exclusive creation uses `O_CREAT | O_EXCL | O_NOFOLLOW`; lease creation is identity-bound with `linkat` from the opened artifact descriptor.
- Read and write reopen both artifact and lease and verify `st_dev`/`st_ino` against the durable reservation identity.
- Cleanup never performs name-only unlink of a verified quarantine leaf; normal matching cleanup retains quarantine leaves and returns `quarantine_retained`/the existing `replacement_retained` contract mapping.
- Provider creation returns `undefined` for unsupported platforms, missing addon, failed probing, or failed root initialization.
- No pathname-only fallback, `bun:ffi`, generic filesystem backend, or `instanceof FileWriter` capability discovery is allowed.
- Existing optional probing in `OpenCodeAdapter` remains fail-open and unchanged in behavior.
- Ordinary tests use injected mocks; native integration tests are explicit real-filesystem exceptions.
- No absolute host paths, credentials, or native error contents may be logged or persisted.

---

### Task 1: Add Native Provider ABI and Safe Filesystem Core

**Files:**
- Create: `rust-toolchain.toml`
- Create: `native/review-artifact-linux/Cargo.toml`
- Create: `native/review-artifact-linux/build.rs`
- Create: `native/review-artifact-linux/src/lib.rs`
- Test: `native/review-artifact-linux/src/lib.rs` (`#[cfg(test)]`)

**Interfaces:**
- Produces synchronous N-API exports `openReviewArtifactRoot(rootDir)` and `probeReviewArtifactCapabilities()`.
- Produces root methods `createExclusiveMarker`, `openExistingReservation`, `writeExisting`, `readOnce`, `cleanupExistingReservation`, and `close`.
- Produces reservation methods `artifactIdentity`, `leasePath`, and `close`.
- Uses camelCase object fields `{ artifactPath, leasePath, artifactIdentity }` at the JavaScript boundary.

- [ ] **Step 1: Define the pinned Rust manifest and N-API build hook**

Use Rust 1.88.0 with minimal profile and `x86_64-unknown-linux-gnu`. Use the exact crate dependencies `libc = "=0.2.177"`, `napi = { version = "=3.12.2", default-features = false, features = ["napi8"] }`, `napi-derive = "=3.6.8"`, and build dependency `napi-build = "=2.4.1"`. Set `crate-type = ["cdylib"]` and call `napi_build::setup()` from `build.rs`.

- [ ] **Step 2: Write failing native unit tests for path validation and capability probing**

Cover these exact cases before implementation: non-Linux/non-x86_64 reports unsupported, `openat2` or `renameat2` returning `ENOSYS` reports unsupported, absolute paths and `..` components are rejected, and `openReviewArtifactRoot` creates only `.justice/reviews`, `.leases`, and `.quarantine` beneath the supplied root.

- [ ] **Step 3: Implement descriptor-relative root initialization**

Open the supplied workspace root once as a directory descriptor, verify it is a directory, create the review directories with mode `0700`, and retain descriptors for the review, lease, and quarantine directories. Resolve all later paths with `openat2` using `RESOLVE_BENEATH | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_SYMLINKS`. Reject empty, absolute, backslash-containing, traversal, and malformed artifact/lease leaves.

- [ ] **Step 4: Implement exclusive reservation and inode-bound lease creation**

Create `<artifactId>.json` with `O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC`, obtain `st_dev` and `st_ino` using `fstat`, and create the private lease through `linkat` from the opened artifact descriptor. Map an existing destination to the stable `artifact_occupied` error. Return an opaque reservation handle that owns the artifact descriptor until the adapter closes it.

- [ ] **Step 5: Implement strict reopen, read, and write operations**

Reopen both artifact and lease descriptor-relative with no-follow flags, compare both identities to the durable reservation identity, and reject mismatches or missing pairs. Use `pwrite`/`pread` against the verified descriptor, bounded to the existing review-artifact size contract. Never use a pathname-only read or write after validation.

- [ ] **Step 6: Implement cleanup state machine without unsafe quarantine deletion**

Validate the durable descriptor and derived artifact ID. Move matching artifact and lease leaves into reservation-local quarantine using `renameat2(..., RENAME_NOREPLACE)`, reopen and verify moved identities, and verify original slots are absent. Return `quarantine_retained` for the normal matching path, `replacement_retained` for target/quarantine replacement collisions, and `cleanup_incomplete` for partial or uncertain state. Do not call `unlinkat` on a verified quarantine leaf.

- [ ] **Step 7: Run native tests and inspect the exported ABI**

Run:

```bash
cargo fmt --manifest-path native/review-artifact-linux/Cargo.toml -- --check
cargo test --manifest-path native/review-artifact-linux/Cargo.toml --features test
cargo clippy --manifest-path native/review-artifact-linux/Cargo.toml --all-targets --features test -- -D warnings
```

Expected: all native tests pass, clippy has no errors, and no test uses an unverified pathname fallback.

### Task 2: Implement the TypeScript Provider Adapter

**Files:**
- Create: `src/runtime/linux-review-artifact-provider.ts`
- Test: `tests/runtime/linux-review-artifact-provider.test.ts`
- Test: `tests/runtime/linux-review-artifact-provider-security.test.ts`

**Interfaces:**
- `isSupportedLinuxOpenat2Environment(environment: LinuxOpenat2RuntimeEnvironment): boolean`
- `createLinuxOpenat2ReviewArtifactProvider(rootDir: string): LinuxOpenat2ReviewArtifactProvider | undefined`
- `LinuxOpenat2ReviewArtifactProvider` contains `createExclusiveMarker`, `reservedReviewArtifactIo`, and `close`.

- [ ] **Step 1: Write failing publication and fail-open tests**

Test all unsupported environment combinations: non-Linux, non-x86_64, non-glibc, missing `openat2`, and missing `renameat2`. Mock addon loading and root initialization failures and assert that provider creation returns `undefined` without throwing. Assert that a native operation error is normalized to a stable code without embedding paths or contents.

- [ ] **Step 2: Implement addon loading and capability gating**

Load only `../../dist/native/index.linux-x64-gnu.node` via `createRequire(import.meta.url)`. Check `process.platform`, `process.arch`, glibc availability from `process.report`, addon capability results, and root initialization in separate guarded blocks. Return `undefined` at every failed boundary.

- [ ] **Step 3: Adapt exclusive marker and reserved I/O**

Map native identity `{ device, inode }` to the existing `ReviewArtifactInodeIdentity`, map native `artifact_occupied` to `{ kind: "occupied" }`, and map all other operation failures to stable `Error` codes. `writeExisting` and `readOnce` must use the strict native reopen operation. `cleanup` must call `cleanupExistingReservation` directly and map native `cleaned` and `quarantine_retained` to the existing logical result `"removed"`, native `replacement_retained` to `"replacement_retained"`, and native `cleanup_incomplete` to a stable `artifact_cleanup_failed` error. This preserves the current core contract while retaining the native provider's physical quarantine semantics.

- [ ] **Step 4: Add close idempotency and security tests**

Assert `close()` is safe to call repeatedly, operations after close fail closed, symlinked final components and ancestors are rejected, replacement files are retained, restart from durable descriptor data works, and the adapter never invokes generic `node:fs` artifact I/O.

- [ ] **Step 5: Build the addon and run adapter tests**

Run:

```bash
bun run build:native:review-artifact
test -f dist/native/index.linux-x64-gnu.node
bun run test -- tests/runtime/linux-review-artifact-provider.test.ts tests/runtime/linux-review-artifact-provider-security.test.ts
```

Expected: the built addon exists on the supported Linux host; unsupported hosts report no provider rather than failing the test process.

### Task 3: Wire the Provider Through Production Composition

**Files:**
- Modify: `src/runtime/node-file-system.ts:20-44`
- Modify: `src/runtime/opencode-adapter.ts:171-231`
- Test: `tests/runtime/node-file-system.test.ts`
- Test: `tests/runtime/opencode-adapter-v2.test.ts` or a focused capability-composition test

**Interfaces:**
- Change `NodeFileSystem` construction to accept `provider?: LinuxOpenat2ReviewArtifactProvider`.
- Publish `provider.createExclusiveMarker` and a zero-argument `createReservedReviewArtifactIo` factory only when provider exists.
- Keep `OpenCodeAdapter`’s optional capability probe and warning behavior intact.

- [ ] **Step 1: Add failing composition tests**

Construct `NodeFileSystem(root, sentinelProvider)` and assert both capability slots reference the sentinel provider. Construct it without a provider and assert both are `undefined`. Mock `createLinuxOpenat2ReviewArtifactProvider` in the adapter test, call `ensureInitialized()`, and assert the same sentinel I/O object reaches `JusticePluginOptions.reservedReviewArtifactIo`. Add a provider-factory-throws case that still initializes Justice and leaves reservation unusable.

- [ ] **Step 2: Implement the minimal NodeFileSystem injection**

Store only the optional provider-derived callbacks in readonly fields. Do not make `NodeFileSystem` load the addon or add a generic fallback. The global wisdom filesystem construction remains provider-free.

- [ ] **Step 3: Implement the adapter composition root**

In `OpenCodeAdapter.#runInit()`, create the provider exactly once from `root`, pass it to the local `NodeFileSystem`, retain the existing try/catch around `createReservedReviewArtifactIo?.()`, and pass the resulting optional I/O contract to `JusticePlugin` exactly as today. If provider creation throws, normalize it to no provider and continue initialization.

- [ ] **Step 4: Run focused composition tests**

Run:

```bash
bun run test -- tests/runtime/node-file-system.test.ts tests/runtime/opencode-adapter-v2.test.ts tests/runtime/opencode-adapter-capability.test.ts
```

Expected: supported sentinel composition passes, provider failure remains fail-open, and existing unsupported-runtime assertions remain valid.

### Task 4: Package, CI, and Release the Native Artifact

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.devcontainer/Dockerfile`
- Modify: `.devcontainer/devcontainer.json`
- Test: `tests/runtime/review-artifact-linux-probe.test.ts` and addon-dependent integration tests

**Interfaces:**
- Add `@napi-rs/cli` version `3.2.0` and script `build:native:review-artifact` using the pinned manifest, target, output directory, platform flag, release mode, and `--no-js`.
- CI and release must verify the exact `.node` path before addon-dependent tests or publishing.

- [ ] **Step 1: Add package and development-container prerequisites**

Update the lockfile through Bun, install Rust 1.88.0 and the GNU target in the devcontainer, and retain existing Bun/OpenCode setup. Do not make the native addon a runtime dependency for unsupported hosts.

- [ ] **Step 2: Add the native build gate to CI**

On the existing Linux job, run checkout, Bun setup, build prerequisites, pinned Rust setup, frozen install, native build, exact addon existence check, addon-dependent tests, then the existing lint/typecheck/test/build/dist/integration gates. Do not add a cross-platform matrix.

- [ ] **Step 3: Add release artifact verification**

Build the addon before packaging, assert the exact `.node` file is included in the published artifact, and fail release packaging if it is absent. Keep release behavior unchanged for unsupported runtime packages.

- [ ] **Step 4: Run package and integration checks**

Run the native build, addon tests, ordinary suite, and package build. Confirm `git diff --check` and inspect the package contents without printing secrets or absolute host paths.

### Task 5: Final Verification, Review, Commit, and Push

**Files:**
- Modify only the files listed in Tasks 1-4 plus the design and plan documents.

- [ ] **Step 1: Run all repository quality gates fresh**

Run inside the supported development environment:

```bash
bun run test
bun run typecheck
bun run lint
bun run build
```

Also run the native format, test, clippy, build, and addon-dependent test commands from Tasks 1-4. Lint warnings may remain only if they predate this work; new errors are blockers.

- [ ] **Step 2: Review the diff and status**

Run `git status --short`, `git diff --check`, `git diff --stat`, and `git diff`. Confirm no generated secrets, absolute paths, unrelated changes, or unsafe pathname fallback were added.

- [ ] **Step 3: Commit the design documents**

```bash
GIT_MASTER=1 git add docs/superpowers/specs/2026-09-21-review-artifact-provider-wiring-design.md docs/superpowers/plans/2026-09-21-review-artifact-provider-wiring.md
GIT_MASTER=1 git commit -m "docs: review artifact provider配線を設計"
```

- [ ] **Step 4: Commit the implementation**

```bash
GIT_MASTER=1 git add .github/workflows/ci.yml .github/workflows/release.yml bun.lock docs/superpowers/plans/2026-09-21-review-artifact-provider-wiring.md native/review-artifact-linux/Cargo.lock native/review-artifact-linux/Cargo.toml native/review-artifact-linux/build.rs native/review-artifact-linux/src/lib.rs package.json rust-toolchain.toml src/runtime/linux-review-artifact-provider.ts src/runtime/node-file-system.ts src/runtime/opencode-adapter.ts tests/runtime/linux-review-artifact-provider.test.ts tests/runtime/node-file-system.test.ts
GIT_MASTER=1 git commit -m "feat: Linux review artifact providerを追加"
```

- [ ] **Step 5: Push the current branch and report evidence**

Inspect the current branch and upstream with `git branch --show-current` and `git status --short`, then run `git push`. Report both commit IDs, push result, verification commands, and any environment-specific native test limitation. Do not run CodeRabbit CLI unless separately authorized.
