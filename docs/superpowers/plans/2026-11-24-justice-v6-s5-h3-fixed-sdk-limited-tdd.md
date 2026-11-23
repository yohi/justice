# Justice v6 S5 — H3 Fixed-SDK Acquisition and Limited TDD Implementation Plan

**Status:** `SDK_ACQUISITION_BLOCKED / TYPE_RESOLUTION_NOT_RUN / LIMITED_PLAN_PROPOSED / SOURCE_IMPLEMENTATION_HOLD`  
**Document date:** 2026-11-24 JST  
**Repository:** `yohi/justice`  
**Fixed source baseline:** `master@bf6bcda41820b1b7550f8215afc4ceec20859409`  
**Adopted controlling documents:** H1–H5 Design R0.1.2; S5 Operation / Completion Implementation Plan R0.1.1 (Owner adoption in conversation).  
**Scope of the previous preparation approval:** Obtain only the fixed v2.3.2 SDK in an isolated dedicated area, verify type resolution, and produce a bounded TDD plan. **Current separate Owner approval:** Commit/push **this Markdown plan only** to `docs/justice-v6-s5-tdd-plan-realignment-20261123`. **Do not implement or test Justice Source; do not operate OpenCode, register Plugin, execute E1/E2/E3, or commit/push Source/Test/CI changes.**

## 1. Objective and current outcome

The project goal remains S1/S2/S3 bounded real-Host acceptance and separate Human Owner decisions on bounded completion and Opt-in. This supporting task prepares only the H3 dependency/type prerequisite, then stops for Owner judgment.

- Known fixed-tag **source** mismatch: OpenCode v2.3.2 `packages/core/src/plugin/module.ts` expects `default` to match `{id:string,effect:function}` or `{id:string,setup:function}`; `yohi/justice/src/opencode-plugin.ts` exports a V1-style `OpenCodePlugin` function.
- This **does not** establish actual bundle load failure, Hook compatibility, or runtime behavior.
- Fixed-tag `packages/plugin/src/promise/plugin.ts` defines the V2 Promise `Plugin` with `id` and `setup`; `packages/plugin/src/README.md` describes `Plugin.define({id,setup})`.
- `@opencode/plugin@2.3.2` is publicly listed on npm, but its tarball and complete dependency tree have **not** been fetched in this task.
- Existing Host Filesystem tunnel returned `Tunnel-client has not been seen for 300 seconds`. Independent sandbox `npm view @opencode/plugin@2.3.2` returned `EAI_AGAIN` for `registry.npmjs.org`. Thus **Host SDK acquisition and type resolution remain NOT_RUN/BLOCKED**, not FAIL as an SDK package behavior.

## 2. Fixed target, isolation, prohibited effects

**Host:** `coreultra7-270k` (unchanged).  
**RUN_ID:** Fixed in Owner-held private E1 evidence; do not recreate or infer its value from this public plan.  
**ROOT:** `<E1_ROOT>` (Owner-fixed private Host location; resolve only against the existing E1 evidence, never from a guessed path)  
**Only proposed new Host write subtree:** `<E1_ROOT>/sdk-v232/` (hereafter `<ROOT>` means that exact privately fixed E1 root) (including its `project/`, `home/`, `tmp/`, `npm-cache/`, `evidence/`).

Do not change `<ROOT>/bin/`, `<ROOT>/xdg/`, `<ROOT>/artifacts/`, existing `<ROOT>/evidence/`, repository Source/Test/CI/config/lock, shared `dist/`, global npm/Bun caches, Host OpenCode configuration, credentials, existing Session/State, or existing evidence. Do not create a VM or unrelated task.

**Network boundary:** Registry host `registry.npmjs.org` over HTTPS only; no other egress without new Owner approval. Perform package metadata and install steps with credentials excluded (`env -i`, separate HOME), `--ignore-scripts`, `--no-audit`, `--no-fund`, dedicated npm cache, and explicit version `2.3.2`. Do not silently retry through a mirror, GitHub SSH, corporate proxy, or another package version.

**Preflight fail-closed:** Existing ROOT/ownership/0700 permissions/symlinks, current Host, fixed repository HEAD and shared-artifact identities must not contradict the approved baseline. If verification is not possible or the tunnel is unavailable, `HOST_CONNECTION_BLOCKED`. Do not assume a local assistant container is the user Host. Create no Host paths until preflight and Owner-authorized safe method are established.

## 3. Host SDK acquisition procedure — only after connection is restored

1. Read-only verify the fixed Host/ROOT, then reserve new `<ROOT>/sdk-v232/` with `0700`, `umask 077`, no symlinks. Refuse collisions and previously existing unowned paths. Keep all new writes under that subtree.
2. Pin the discovered on-Host absolute paths of Node/npm/TypeScript or Bun tools **before** execution; never infer that the host has the same tooling as an assistant container. Record each binary identity and version. No online `npx` or automatic executable bootstrap.
3. Use an environment-scrubbed subprocess (`env -i`) with `HOME=<ROOT>/sdk-v232/home`, `TMPDIR=<ROOT>/sdk-v232/tmp`, isolated cache, `npm_config_userconfig=/dev/null`, `npm_config_globalconfig=/dev/null`, and approved `PATH`. No inherited npm token, proxy, credential helper or provider keys.
4. Prepare a **new isolated-only** `project/package.json` (`private:true`, version-pinned dependency `"@opencode/plugin":"2.3.2"`, ESM). Execute npm's exact install into this standalone project with `--ignore-scripts --no-audit --no-fund` and `registry=https://registry.npmjs.org`; **no** `--legacy-peer-deps` or version substitution. Stop rather than auto-resolving peer conflicts by expanding scope.
5. Require the lockfile to resolve `node_modules/@opencode/plugin` at exactly `2.3.2`. Capture `npm ls --all` or a bounded equivalent, declared package metadata, lockfile integrity entries, tarball SHA-256 if available, complete transitive dependencies and scripts not executed. If entries are missing or unverifiable: `SDK_INTEGRITY_NOT_VERIFIED` and STOP.
6. Record package/lock/toolchain hashes and a sanitized dependency graph in `<ROOT>/sdk-v232/evidence/`; never copy private paths or credentials into repository docs.

**This is a controlled procedure, not a claim that npm or its transitive dependencies were successfully installed.** When required egress is unavailable, stop with `SDK_ACQUISITION_BLOCKED_NETWORK`. Do not install in Justice's existing `node_modules` or use cached 2.1.4/2.2.5.

## 4. Standalone SDK type resolution, not Justice implementation

With the exact SDK installed, create **only within `<ROOT>/sdk-v232/project/`** a temporary `type-probe.ts` equivalent to:

```ts
import type { Plugin } from "@opencode/plugin";

const candidate = {
  id: "justice-h3-v232-type-probe",
  setup: async (_context: Plugin.Context): Promise<void> => {},
} satisfies Plugin.Plugin;

void candidate;
```

Use a pinned, already available TypeScript compiler (no auto-download) with NodeNext resolution, `noEmit`, and `strict`. The actual command, `tsconfig.json`, SDK's compiled declarations, and their transitive dependency graph must be recorded **before** the run. Type-check only the standalone probe; **do not import or modify Justice Source**. A TypeScript compile PASS proves this one SDK type-resolution path, not loader runtime or Justice's feature compatibility.

Record `SDK_TYPE_RESOLUTION_PASS`, `SDK_TYPE_RESOLUTION_FAIL` (actual compiler failure and diagnostics), or `SDK_TYPE_RESOLUTION_NOT_RUN` (acquisition/preflight blocked). If native modules or install scripts would be required, stop and seek Owner decision rather than silently enabling them.

## 5. Conditional implementation plan (future; not yet authorized)

**Choice to put to the Human Owner:** Implement a **separate V2 Promise API entry** (`id`/`setup`) for fixed v2.3.2, preserving existing V1 entry as-is, or another explicitly justified minimal way to meet the v2.3.2 loader. This document **proposes** the separate entry for reduced V1 regression risk; it does not adopt that design on the Owner's behalf.

| Required Plan field | Bounded proposed contract (confirm after real SDK type resolution and Owner design selection) |
| --- | --- |
| Allowed Source files | Candidate `src/opencode-v2-plugin.ts` **new**; existing `src/opencode-plugin.ts` READ_ONLY. `src/runtime/opencode-adapter.ts` must remain READ_ONLY unless a specific type/semantic mismatch and an additional limited Owner authorization are recorded |
| Allowed Test files | Candidate `tests/integration/opencode-v2-plugin-contract.test.ts` **new**; existing `tests/integration/opencode-plugin.test.ts` READ_ONLY regression reference. Filenames are proposals, not permission |
| Fixed SDK API | `@opencode/plugin@2.3.2`: `Plugin.Plugin`, `Plugin.Context`, `Plugin.define`, `{id,setup}` as documented in fixed tag; loader alternative `{id,effect}` remains a valid contract, not an implementation decision |
| Required V2 Domains | Map only S5-needed behavior from the existing `OpenCodeAdapter` to typed V2 `session`, `tool`, `event`, `command` domains as supported by the fixed SDK; do not presume 1:1 semantic equivalence. Document which of AC-H01 (saved-source/diagnostic), AC-H02 (negative controls), AC-H03 (single-writer recovery) genuinely requires live Plugin callbacks rather than already proved offline paths |
| Errors and Fail-Closed | Never turn unknown authority, missing Evidence, or Hook timing uncertainty into PASS. Preserve error/cleanup semantics. No Host-enforcement claim from local control tests |
| Negative cases | Unsupported/missing `id` or `setup`; wrong Domain callback types; unintended V1 mutations; lack of critical S5 hook mapping; no upgrade from NOT_VERIFIED to PASS without evidence |
| RED (future) | **Compatibility-positive assertion**: selected V2 entry exports a definition assignable to the fixed SDK's `Plugin.Plugin` and meets the exact loader's `id/setup` structure. The **current unmodified state must FAIL** the compatibility-positive test. A test that expects V1 incompatibility can PASS but is **not** TDD RED |
| GREEN (future) | Owner-approved minimum V2 entry satisfies the **same test that failed at RED**, with a recorded PASS. Then separate minimal RED/GREEN cycles for each approved S5-required V2 domain behavior. Type-only GREEN is not runtime-loaded proof |
| Isolation and commands | Owner must pin concrete existing toolchain, approved write mount and offline Build/Test execution. Candidate: `bun run vitest run tests/integration/opencode-v2-plugin-contract.test.ts`, `bun run typecheck`, `bun run lint`, `bun run test`, and the **approved isolated-output** Build. No command may write to shared `dist/`, `.git`, `node_modules`, caches or HOME before approved isolation is proved |
| V1 regression | Existing `tests/integration/opencode-plugin.test.ts` and relevant S1/S2/S3 tests must remain unaffected; compare existing public V1 export and Source signatures. No unnecessary Hook migration |
| Commit boundary | **This Markdown plan only is authorized for Commit/Push to the specified docs branch.** Source/Test/CI changes and implementation commits remain unauthorized; after a separate Owner approval, propose one bounded implementation commit consisting only of approved V2 Source/Test files, with RED/GREEN logs retained separately. No automatic PR, merge, review, release |
| Stop / Owner Checkpoint | Unknown fixed SDK types, incorrect event shape, missing fail-closed behavior, unexpected dependencies/writes, attempted Host plugin load, or scope expansion ⇒ stop and report. Do not automatically spawn another design/review Task |

**No test has been created or executed.** Any Source/Test path, package manifest change, version bump, or actual Build command requires a separate explicit Owner implementation scope. The installed SDK is for isolated type-probe use and is not a dependency modification of Justice.

## 6. Evidence matrix, gate, exit

| Gate | State now | Evidence |
| --- | --- | --- |
| V2.3.2 loader static contract | `OBSERVED_MISMATCH` against existing V1 default | Fixed tag `module.ts` L81–94, L168–186 and Justice fixed Source |
| Host E1 ROOT access | `BLOCKED` | Filesystem tunnel not connected |
| SDK package exists publicly | `VERIFIED_PUBLIC_METADATA` | npm listing for `@opencode/plugin@2.3.2` |
| SDK package acquired inside E1 ROOT | `NOT_RUN` | No Host access |
| npm SDK and full dependency integrity | `NOT_VERIFIED` | No npm tarball/lock readback |
| SDK type resolution on Host | `NOT_RUN` | SDK not acquired |
| Limited TDD implementation | `NOT_RUN / NOT_AUTHORIZED` | No Source/Test changes |
| Plugin configured/loaded | `NOT_ESTABLISHED / NOT_VERIFIED` | Config unchanged; no runtime |
| H4/H5 | `NOT_VERIFIED` | No runtime evidence |
| E1/E2/E3 | `HOLD` | Unchanged Owner authority |
| BOUNDED_COMPLETE / RELEASE_APPROVED | `PENDING / PENDING` | Unchanged |

**Exit for this session:** Produce this actionable, limited plan using existing fixed-tag evidence; record SDK/Host acquisition blockers accurately; stop at Human Owner Checkpoint. **Do not claim SDK acquisition or type resolution success, and do not automatically start Source TDD, Plugin Registration, Host execution, PR/Merge, new review or release.**

**Official fixed references:**
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/plugin/module.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/plugin.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/README.md
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/tool.ts
- https://github.com/yohi/justice/blob/bf6bcda41820b1b7550f8215afc4ceec20859409/src/opencode-plugin.ts
