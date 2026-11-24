# Justice v6 S5 — H3 Fixed-SDK Acquisition and Limited TDD Implementation Plan

**Version:** R0.1.2 — H3 package entry / reproducible SDK contract correction (2026-11-24); R0.1.0–R0.1.1 history retained in GitHub  
**Status:** `H3_TDD_ENTRY_REVISED_OWNER_CHECKPOINT / SDK_TYPE_RESOLUTION_NOT_RUN / SOURCE_TEST_HOLD`  
**Document date:** 2026-11-24 JST  
**Repository:** `yohi/justice`  
**Fixed source baseline:** `master@bf6bcda41820b1b7550f8215afc4ceec20859409`  
**Adopted controlling documents:** H1–H5 Design R0.1.2; S5 Operation / Completion Implementation Plan R0.1.1 (Owner adoption in conversation).  
**Scope:** Document correction only. The Owner-approved Design R0.1.2 and S5 operation Plan R0.1.1 remain controlling; this R0.1.2 H3 proposal needs Owner adoption before any new execution permissions. **No Source/Test/CI changes, SDK installation, OpenCode operation, E1/E2/E3, GitHub Commit/Push/PR are authorized by this draft.**

## 1. Objective and current outcome

The project goal remains S1/S2/S3 bounded real-Host acceptance and separate Human Owner decisions on bounded completion and Opt-in. This correction restores a bounded TDD entry: RED is not mechanically blocked by an E1 ROOT lookup or isolated SDK type resolution; typed GREEN still requires the exact SDK. Preparation and Source/Test execution retain separate Owner authority and stop after one bounded attempt, not repeated review/checkpoint loops.

- Known fixed-tag **source** mismatch: OpenCode v2.3.2 `packages/core/src/plugin/module.ts` expects `default` to match `{id:string,effect:function}` or `{id:string,setup:function}`; `yohi/justice/src/opencode-plugin.ts` exports a V1-style `OpenCodePlugin` function.
- This **does not** establish actual bundle load failure, Hook compatibility, or runtime behavior.
- Fixed-tag `packages/plugin/src/promise/plugin.ts` defines the V2 Promise `Plugin` with `id` and `setup`; `packages/plugin/src/README.md` describes `Plugin.define({id,setup})`.
- `@opencode/plugin@2.3.2` is publicly listed on npm, but its tarball and complete dependency tree have **not** been fetched in this task.
- Existing Host Filesystem tunnel returned `Tunnel-client has not been seen for 300 seconds`. Independent sandbox `npm view @opencode/plugin@2.3.2` returned `EAI_AGAIN` for `registry.npmjs.org`. Thus **Host SDK acquisition and type resolution remain NOT_RUN/BLOCKED**, not FAIL as an SDK package behavior.

## 2. Separate boundaries: H3 TDD preparation versus E1 real-Host acceptance

**H3_TDD_ROOT:** A new, Owner-approved, private, ephemeral work directory independent of E1. The approved runner must fix the location at execution, verify owner/`0700`, parent safety, non-symlink canonical path, noncollision, bounded writable allowlist, and repeatable evidence identity. No default invented `/home/.../justice-e1` path or assumed RUN_ID. Do not create a VM; use an existing runner only if its exact isolation and egress controls are acceptable. New files are confined to the owner-approved `<H3_TDD_ROOT>/{project,home,tmp,npm-cache,evidence}`. The workdir is **not** an E1 fixture.

**E1_ROOT:** The prior Owner-fixed E1 RUN_ID/ROOT remains private and unchanged, but its availability and H4/H5 conditions are **not prerequisites to standalone SDK type resolution or isolated TDD RED**. Its identity, state noninterference and Stop/Rollback contracts must be verified separately before **any** E1/plugin live load. Do not infer E1 GO from an H3 SDK result.

**Shared-state protection:** During SDK-only preparation and the initial structural RED, do not modify Justice `package.json` or `bun.lock`; never modify the existing/shared checkout, its `node_modules` or `dist/`, global npm/Bun caches, shared HOME, Host OpenCode settings, credentials, Session, E1 State or historical Evidence. Only after separate Owner approval of the §5 package/dependency contract, a private isolated implementation checkout under `<H3_TDD_ROOT>/project/` may change the explicitly allowlisted Source/Test, `package.json` and `bun.lock` and produce its own dependencies/build outputs. This exception never authorizes shared-state writes. No symlink escapes, shell activation, automatic `npx`, script hooks or provider traffic. No broad cleanup: remove only explicitly owned and approved scratch paths, and retain required evidence.

**Network policy:** When separately approved, exact `@opencode/plugin@2.3.2` acquisition is a bounded **one-time** operation. `--registry=https://registry.npmjs.org` selects a Registry but **does not enforce egress**; before any network operation verify that Registry and dependency download URLs remain within the Owner-approved network boundary, with external egress blocked by actual runner/network control. No fallback versions, mirrors, proxy credentials, unreviewed redirects, Install scripts or global cache writes. If that control cannot be established, record `SDK_ACQUISITION_BLOCKED` and stop, without blocking document-only tasks or a separately authorized SDK-independent RED test.

## 3. Minimal path to TDD, no additional review chain

| Phase | Action | Evidence / STOP condition |
| --- | --- | --- |
| A — Owner scope | Fix actual `<H3_TDD_ROOT>`, runner/toolchain and type of permitted writes; select *only* the H3 S5-required interface/Source/Test, entry resolution and dependency/commit contract in §5, and permission for isolated RED/GREEN. SDK acquisition or a successful build is not a prerequisite for this selection or initial structural RED. Reuse adopted documents and fixed v2.3.2 Source contract | Missing Owner authorization ⇒ do not execute. No independent review or new task by default |
| B — RED first | In the *separately authorized* isolated test workspace, write a positive compatibility test against the known **fixed loader** (`default.id` plus callable `default.setup` or `default.effect`); the existing V1/default or selected absent entry must FAIL. No SDK type import is required for the initial structural RED | Actual failing test/command/exit and assertion recorded. Missing entry alone isn't proof of functional incompatibility; test must assert the positive target contract. Static "V1 is incompatible" diagnostic PASS does not count |
| C — Fixed SDK (for typed GREEN) | Within `<H3_TDD_ROOT>`, preflight tool binary identity, scrub environment (`env -i`, private HOME/TMP/cache), acquire **exact** `@opencode/plugin@2.3.2` and necessary dependency graph only when approved; no lifecycle scripts, audit, auto-fetch or shared installation. Verify exact version, lock integrity, TypeScript resolution | Acquisition failure / wrong version / uncontrolled egress / unknown dependency ⇒ STOP typed GREEN only. Do not substitute 2.2.5 or hand-written types |
| D — GREEN | Only with **separate approved Source/Test scope**, implement minimum V2 entry satisfying the **same RED contract test** and fixed types; then add one behavior-first RED/GREEN per necessary S5 Domain Hook | Structural PASS, clean-checkout typed PASS, built-artifact/package-resolution PASS and runtime Plugin load are distinct. Unknown error semantics or missing hooks ⇒ STOP affected implementation |
| E — Regression / Checkpoint | Run only approved V1 and S1/S2/S3 related tests, clean-checkout frozen dependency/typecheck, Lint and isolated Build/package-resolution checks in §5. Report actual evidence/limits then STOP | No automatic E1/E2/E3, PR, Merge, extra review or release |

Do not use npm installation as a condition for **writing the first SDK-independent compatibility-positive RED**. It **is** required before claiming typed V2 GREEN. Never turn `SDK_TYPE_RESOLUTION_NOT_RUN` into `SDK_TYPE_RESOLUTION_FAIL` without an actual compiler run.

## 4. Standalone SDK type resolution, not Justice implementation

With the exact SDK installed in a separately authorized `<H3_TDD_ROOT>`, create **only within `<H3_TDD_ROOT>/project/`** a temporary `type-probe.ts` equivalent to:

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

## 5. Conditional TDD implementation contract (Source/Test authorization still separate)

**Choice to put to the Human Owner:** Implement a **separate V2 Promise API entry** (`id`/`setup`) for fixed v2.3.2, preserving existing V1 entry as-is, or another explicitly justified minimal way to meet the v2.3.2 loader. This document **proposes** the separate entry for reduced V1 regression risk; it does not adopt that design on the Owner's behalf.

**Entry and dependency decision (Owner, before authorized implementation; no live verification required for initial RED).** Fixed v2.3.2 [`Host.resolve`](https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/host.ts) selects `server: entry(["server", ""])` for a package. The fixed Justice `package.json` currently exports `.` and `./opencode` to `dist/opencode-plugin.js`, has no `./server`, and `build` uses `tsc` followed by a V1-only Bun bundle. `tsconfig.json` includes `src/**/*` and emits into `dist`; emission alone does not prove a resolvable distribution.

- **Recommended package route (proposed, not adopted):** add `exports["./server"]` mapping to the V2 JavaScript and declaration outputs (candidate `./dist/opencode-v2-plugin.js` and `./dist/opencode-v2-plugin.d.ts`), preserving `.` / `./opencode` and other existing public paths, `main`/`module`/`types`, and the V1 artifact. Select the minimal build change, if needed, that emits a loadable V2 artifact. Do not bundle a second host runtime `effect` or `@opencode/plugin` instance; respect fixed v2.3.2 runtime import/packaging rules. A different subpath is viable only if the exact fixed loader/config resolution path is demonstrated; a separately configured local artifact path may be selected for bounded acceptance only if supported by the fixed loader and explicitly scoped, not represented as package publication compatibility. Owner chooses route, required artifacts, build strategy, and scope by V1 compatibility, fixed-loader resolvability, reproducibility, and minimal changes. No registry publication or actual configuration change is in scope.
- **Recommended dependency route (proposed, not adopted):** add exact `"@opencode/plugin": "2.3.2"` as a development dependency with the corresponding `bun.lock` update in the same approved implementation commit. Preserve existing V1 SDK dependencies and verify the actual dependency graph, including existing `effect` override/peer requirements; do not assume compatibility. If the selected V2 artifact imports runtime SDK values or emits declarations that consumers need to resolve, explicitly select and verify the appropriate runtime/peer/declaration dependency contract rather than assuming a dev dependency alone suffices. A no-manifest-change alternative is acceptable only if a versioned, committed, Owner-approved bootstrap/resolution recipe and immutable dependency lock/integrity inputs reproduce the identical SDK graph from a clean checkout without hidden local state; a temporary sibling SDK install, `NODE_PATH`, an unrecorded symlink or hand-written types is not sufficient. No dependency choice is authorized merely by this document.

**Build / package verification (after RED and minimal implementation):** In the isolated implementation checkout, record the exact commit/candidate tree, approved pinned toolchain and dependency lock/integrity, then run a clean reproducible install (e.g. pinned `bun install --frozen-lockfile --ignore-scripts` with approved acquisition/egress or verified offline inputs), repository Typecheck and approved Build. Inspect the actual emitted V2 JS/declarations and packed/staged package file list and export targets; resolve the staged package from a clean consumer using the fixed v2.3.2 server-first/root-fallback contract and verify it selects the intended V2 artifact, not the V1 fallback. Verify the built artifact's compatible default export in an authorized isolated offline inspection/test without calling `setup`/`effect` or starting OpenCode; if import has unapproved side effects, stop that check. Verify existing `.` / `./opencode` still resolve to the V1 artifact and run the approved V1 regressions. For an Owner-selected local-artifact alternative, verify that exact artifact and local resolution contract instead, explicitly marking package-resolution evidence NOT_RUN. Record actual commands, exit codes, artifact identities and resolution results; do not publish, register or load a Plugin in the real Host. Missing/broken output or resolution blocks the corresponding distribution verdict and implementation completion for the selected route, not the initial SDK-independent RED.

| Required Plan field | Bounded proposed contract (Owner selects before authorized RED/implementation; actual fixed SDK and Build verification occur during execution) |
| --- | --- |
| Allowed Source / package files | Candidate `src/opencode-v2-plugin.ts` **new**; existing `src/opencode-plugin.ts` READ_ONLY. `src/runtime/opencode-adapter.ts` must remain READ_ONLY unless a specific type/semantic mismatch and an additional limited Owner authorization are recorded. Candidate `package.json` (selected V2 export/build/SDK dependency contract only) and `bun.lock` (corresponding dependency resolution only), or exact reproducibility recipe files if Owner selects the documented alternative; all require explicit scope approval |
| Allowed Test files | Candidate `tests/integration/opencode-v2-plugin-contract.test.ts` **new**; existing `tests/integration/opencode-plugin.test.ts` READ_ONLY regression reference. Filenames are proposals, not permission |
| Fixed SDK API | `@opencode/plugin@2.3.2`: `Plugin.Plugin`, `Plugin.Context`, `Plugin.define`, `{id,setup}` as documented in fixed tag; loader alternative `{id,effect}` remains a valid contract, not an implementation decision |
| Required V2 Domains | Map only S5-needed behavior from the existing `OpenCodeAdapter` to typed V2 `session`, `tool`, `event`, `command` domains as supported by the fixed SDK; do not presume 1:1 semantic equivalence. Document which of AC-H01 (saved-source/diagnostic), AC-H02 (negative controls), AC-H03 (single-writer recovery) genuinely requires live Plugin callbacks rather than already proved offline paths |
| Errors and Fail-Closed | Never turn unknown authority, missing Evidence, or Hook timing uncertainty into PASS. Preserve error/cleanup semantics. No Host-enforcement claim from local control tests |
| Negative cases | Unsupported/missing `id` or `setup`; wrong Domain callback types; unintended V1 mutations; lack of critical S5 hook mapping; no upgrade from NOT_VERIFIED to PASS without evidence |
| RED (future) | **Compatibility-positive assertion** is anchored to the *fixed Loader* shape (`default.id` + callable `default.setup` or `default.effect`) and designed to FAIL against the existing V1/absent selected V2 entry. The first RED can run **without SDK types**, once Test execution is separately authorized. Record its actual FAIL, exact assertion and unmodified test identity. A diagnostic assertion of incompatibility can PASS but **is not RED**. If a new entry is absent, strengthen coverage with behavioral/typed tests; missing module alone is not sufficient |
| GREEN (future) | Owner-approved minimum V2 entry satisfies the **same previously FAILing test, unchanged**, with recorded PASS; fixed `@opencode/plugin@2.3.2` typecheck and necessary Domain Hook RED/GREEN are separate gates. Typed GREEN requires the exact SDK graph and successful repository typecheck in a clean isolated checkout under the selected reproducible dependency contract; standalone probe PASS alone is insufficient. Build/package-resolution PASS is a separate required gate for the selected distribution route, including V1 public entry regression. None of these is runtime-loaded or AC PASS |
| Isolation and commands | `<H3_TDD_ROOT>` independent of E1, confirmed owner-only and non-symlink. Owner fixes executable binaries, mounts and permitted writes/egress. Candidates **not authorized yet**: isolated `bun run vitest run tests/integration/opencode-v2-plugin-contract.test.ts` for RED and GREEN; pinned TS compiler in standalone SDK probe; limited V1 regression/typecheck/lint and isolated output Build. Justice default scripts may write shared outputs; they must not run without a proven output isolation method |
| V1 regression | Existing `tests/integration/opencode-plugin.test.ts` and relevant S1/S2/S3 tests must remain unaffected; compare existing public V1 export and Source signatures. No unnecessary Hook migration |
| Commit boundary | This document correction grants no further GitHub writes. After separate Owner authorization, include only approved bounded V2 Source/Test changes **and** the selected package/build/dependency reproducibility files (`package.json` and `bun.lock` for the recommended route, or explicitly approved committed alternative recipe + immutable dependency inputs). SDK-only scratch installs, `node_modules`, caches, generated `dist` and private evidence are excluded from commits. Verify the candidate commit from a clean isolated checkout with the recorded pinned toolchain, frozen dependencies or equivalent immutable inputs, repository typecheck and selected distribution checks; record RED/GREEN and no Source drift. A scratch-only typed PASS cannot justify a non-reproducible implementation commit/completion. No automatic PR, merge, review, release |
| Stop / Owner Checkpoint | Unknown fixed SDK types, incorrect event shape, missing fail-closed behavior, unexpected dependencies/writes, attempted Host plugin load, or scope expansion ⇒ stop and report. Do not automatically spawn another design/review Task |

**No test has been created or executed.** Any Source/Test path, package manifest/lockfile or alternative recipe change, version bump, or actual Build command requires a separate explicit Owner implementation scope. The standalone SDK probe does not modify Justice dependencies; later authorized isolated implementation may include the selected reproducible dependency contract described above. No SDK has been installed in this task.

## 6. Evidence matrix, gate, exit

| Gate | State now | Evidence |
| --- | --- | --- |
| V2.3.2 loader static contract | `OBSERVED_MISMATCH` against existing V1 default | Fixed tag `module.ts` L81–94, L168–186 and Justice fixed Source |
| E1 ROOT identity | `NOT_VERIFIED / E1_EXECUTION_HOLD` | Previous E1 identity was not confirmed by the latest runner; **not an H3 standalone TDD precondition** |
| H3 independent scratch root | `NOT_FIXED` | Owner execution scope must specify it; do not invent path |
| SDK package exists publicly | `VERIFIED_PUBLIC_METADATA` | npm listing for `@opencode/plugin@2.3.2` |
| SDK acquired in H3 scratch | `NOT_RUN` | Separate SDK-only preparation, not E1 installation |
| npm SDK and full dependency integrity | `NOT_VERIFIED` | No npm tarball/lock readback |
| SDK type resolution in H3 scratch | `NOT_RUN` | SDK not acquired; no actual compiler exit |
| Justice clean-checkout typed GREEN | `NOT_RUN` | No approved reproducible V2 dependency contract executed |
| V2 Build / selected distribution resolution | `NOT_RUN` | No V2 implementation artifact or package inspection; not runtime load |
| Compatibility-positive TDD RED / GREEN | `NOT_RUN / NOT_RUN` | No Test/Source execution; RED may precede SDK only after explicit authorization |
| Limited TDD implementation | `NOT_RUN / NOT_AUTHORIZED` | No Source/Test changes |
| Plugin configured/loaded | `NOT_ESTABLISHED / NOT_VERIFIED` | Config unchanged; no runtime |
| H4/H5 | `NOT_VERIFIED` | No runtime evidence |
| E1/E2/E3 | `HOLD` | Unchanged Owner authority |
| BOUNDED_COMPLETE / RELEASE_APPROVED | `PENDING / PENDING` | Unchanged |

**Exit for this document correction:** Fix H3 TDD entry and E1 isolation boundaries; no actual SDK, RED/GREEN or Source modification; stop at Human Owner Checkpoint. **Do not claim SDK acquisition or type resolution success, and do not automatically start Source TDD, Plugin Registration, Host execution, PR/Merge, new review or release.**

**Official fixed references:**
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/host.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/README.md
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/core/src/plugin/module.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/plugin.ts
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/README.md
- https://github.com/anomalyco/opencode/blob/v2.3.2/packages/plugin/src/promise/tool.ts
- https://github.com/yohi/justice/blob/bf6bcda41820b1b7550f8215afc4ceec20859409/src/opencode-plugin.ts
