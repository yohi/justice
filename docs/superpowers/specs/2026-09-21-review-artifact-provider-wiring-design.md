# Review Artifact Provider Wiring Design

## Goal

Enable the supported Linux review-artifact capability in production while
keeping unsupported runtimes fail-open. A supported runtime must expose both
exclusive marker creation and reserved artifact I/O through the same native
provider. An unsupported runtime must expose neither capability and must leave
review artifact reservation unusable rather than falling back to pathname-only
filesystem operations.

## Architecture

- `native/review-artifact-linux` owns the Rust N-API implementation of the
  descriptor-relative Linux filesystem operations.
- `src/runtime/linux-review-artifact-provider.ts` loads the bundled addon,
  probes platform and syscall support, and adapts native operations to the
  existing `FileWriter.createExclusiveMarker` and `ReservedReviewArtifactIo`
  contracts.
- `OpenCodeAdapter.#runInit()` creates the provider once for the workspace
  root and injects it into `NodeFileSystem`.
- `NodeFileSystem` conditionally publishes both capability slots from the
  provider. It does not implement a generic or pathname-based fallback.
- `OpenCodeAdapter` keeps its existing optional capability probe and passes the
  resulting I/O contract to `JusticePlugin`.

## Fail-Open Rules

- Non-Linux, non-x86_64, non-glibc, missing addon, failed capability probe, or
  failed root initialization returns `undefined` from provider creation.
- Provider creation errors never escape adapter initialization.
- Native operation errors are translated to stable storage errors at the
  provider boundary; capability slots remain absent when initialization fails.
- Review reservation continues to return `artifact_storage_unavailable` when
  either capability is absent.

## Verification

- Unit tests cover supported-environment gating and provider creation failure.
- Runtime tests cover `NodeFileSystem` capability publication and the exact
  `OpenCodeAdapter` composition path.
- Native tests cover descriptor-relative operations, symlink rejection,
  identity checks, collision handling, and cleanup replacement behavior.
- Build configuration produces the Linux x86_64 glibc N-API addon without
  making it a requirement for unsupported host environments.
- The repository test, typecheck, lint, and build commands must pass before
  the implementation is committed and pushed.
