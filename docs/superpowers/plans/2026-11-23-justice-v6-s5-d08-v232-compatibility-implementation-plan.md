# Justice v6 S5 D-S5-08 — OpenCode V2.3.2 Bounded Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (native) or `superpowers:subagent-driven-development` to implement this plan **only after a separate, explicit Human Owner Source/Test/CI implementation GO**. The checkboxes below describe future work; their presence is not execution authorization. No automatic review dispatch, Host operation, next Task, Commit/Push or Release.

**Goal:** Make the existing S2-b READ_ONLY offline adapter accept precisely the approved OpenCode `2.2.5` and `2.3.2` saved Source wrappers without weakening existing validation, so that later separately authorized S5 AC-H01 real-Host acceptance can become runnable.

**Architecture:** Extend only the explicit version allowlist at the S2-b saved-input validation boundary, preserving the `justice-s2b-source-v1` and `justice-s2b-correlation-v1` formats, raw-byte limits, page-prefix behavior, Task/AC projection and S1-d interface. Verify the compatibility-relevant Session/Message/Tool/pagination shapes with focused offline fixtures and existing regression tests. Do not add a Host Collector, general version framework, network operation or Host enforcement.

**Tech Stack:** Justice TypeScript, Bun, Vitest; OpenCode official pinned tags `v2.2.5` and `v2.3.2`; existing S1/S2 interfaces.

**Spec:** `docs/superpowers/specs/2026-11-23-justice-v6-s5-d08-host-v232-design-addendum.md` (§3, §4; D-S5-08 Owner-adopted design policy).

**Existing operation plan:** `docs/superpowers/plans/2026-11-17-justice-v6-s5-operation-completion.md` (AC-H01/H02/H03 and three deliverables). This companion plan covers **only the missing S2-b source compatibility prerequisite**, not the broader S5 Host operation plan.

**Reference SHA:** `feature/justice-v6-s5-d08-host-v232-design-20261123@b8b237fec9cc3bb934b7261ea627fcdd9a2365b6` (read-only inspection). Reconfirm the source files and relevant tests against the selected implementation HEAD before executing; do not infer that the reference SHA is still the remote HEAD.

**Historical plan-creation authority (2026-11-23 JST):** `D-S5-08_DESIGN_ADOPTED / SOURCE_IMPLEMENTATION_NOT_AUTHORIZED / HOST_GO_HOLD / AC_H01_H03_NOT_RUN / BOUNDED_COMPLETE=PENDING / RELEASE_APPROVED=PENDING`. Human Owner **subsequently** authorized the bounded S2-b Source/Test implementation and GitHub Commit/Push; this remains a record of the earlier state.

## Implementation checkpoints (historical Source commit `204567a` and P-04 Test commit `fa90f9d`)

At reviewed Source HEAD `204567a696bc68ce9c906b3a74fec1f84c816496`, the Owner-approved bounded S2-b Source/Test change is **committed**, not verified: `S2B_SUPPORTED_HOST_VERSIONS=["2.2.5","2.3.2"]` is checked by exact literal membership in `validateWrapper()`; the legacy singular 2.2.5 export remains. Related tests are present, but **Vitest, typecheck, lint, and TDD RED→GREEN are NOT_RUN / unconfirmed**. This is not real-Host evidence, AC PASS, Owner Completion or Release authority. Further Source/Test/CI work and test execution require separate Owner approval; **Host GO HOLD, AC-H01/H02/H03 NOT_RUN**.

**Historical at `204567a`:** positive 2.3.2 multi-page Cursor test absent; existing `paginationRequiresOpaqueNextCursor` covered default 2.2.5 and `v232FilteredCollectionAndBrokenCursorStayFailClosed` covered 2.3.2 negative cursor. **Current at `fa90f9d`:** test `v232PositiveTwoPageCursorChainCompletes` **ADDED** with a valid two-page `cursor.next` chain and `PAGINATION_COMPLETE` expectations. **Vitest/typecheck/lint NOT_RUN; execution result NOT_VERIFIED.** Do not create another P-04 test or independent review Task.

The checkboxes below are the **historical execution plan**, not evidence that a particular step ran. Code and positive P-04 test were added, but `Task exit` remains unmet until test execution evidence exists. The missing-test addition instruction is fulfilled by `fa90f9d`. No extra review task or new implementation scope is approved.

## Global Constraints

- **Historical plan-writing rule:** the plan-writing task did not implement anything. Human Owner later expressly approved a bounded S2-b Source/Test commit at `204567a`. **Further** Source/Test/CI edits, tests or pushes require a new explicit Owner GO naming the bounded scope and target branch/HEAD. Separate Owner authority is required for actual Host operations, credentials, sessions, Source GET, runtime installation, failure injection and Release.
- D-S5-08 selects the **existing** Ubuntu Host/OpenCode V2.3.2 with **logical-only** work separation. Do not create a VM, Docker Sandbox or other new isolated Host, and do not change the shared OpenCode V2 configuration. No OS-enforced credential, network or filesystem isolation is proven.
- The **committed source code** has exact `"2.2.5"`/`"2.3.2"` membership; unknown versions remain **designed to fail closed**. Executed test evidence is still NOT_RUN. A real 2.3.2 Source must truthfully use `hostVersion="2.3.2"`; never relabel it as 2.2.5. A wrapper's declared version is **not** independent Host-version attestation.
- Preserve existing 2.2.5 behavior, `S2B_SOURCE_SCHEMA_VERSION="justice-s2b-source-v1"`, `S2B_CORRELATION_SCHEMA_VERSION="justice-s2b-correlation-v1"`, `S2bRequest={loaderInput,sourcePath,correlationPath}`, `S1aReadOnlySource`, `runS2bOfflineAdapter(...)`, S1-d integration, and status domains (`REJECTED|LIMITED|PROJECTED` vs AC `PASS|FAIL|NOT_RUN|NOT_VERIFIED`).
- Retain **all** existing `S2B_LIMITS`, strict UTF-8/duplicate-key/raw response byte-span checks, pagination/filter limits, Session and Correlation identity matching, collision rejection, deterministic Evidence IDs, `coverageCompleteness="NOT_ESTABLISHED"`, and the strict no-S1-d-on-`REJECTED` rule.
- The historical Evidence `originId` prefix `oc225-msg-` and `issuerId="opencode-v225-record"` are **opaque identity labels, not Version/authenticity attestations**. Preserve their output and documented meaning; do not version-renumber identities or change the hash domains in this task.
- Upstream v2.3.2 `time.firstToken` is **optional**. Justice `isMessage()` currently does **not** validate that field; do not claim it does, silently make it mandatory, or add value validation without separate source-scope approval. Use independently observed Host identity and Source provenance later for Host acceptance.
- A complete well-formed **foreign-only** Correlation may produce `FOREIGN_TASK_EXCLUDED`, `PROJECTED` and **zero selected EvidenceRefs**; this is not AC-H01 PASS. Invalid/missing/competing bindings must retain existing conditional `REJECTED/LIMITED` semantics and never introduce another Task's Evidence.
- Do not broaden S3-b recovery, add a Collector/Router, create new runtime schemas, touch external tools or credentials, rewrite Gate/HOLD, modify Owner decisions, or infer Host GO/Release from source-test success.

## File Map / Responsibilities

| File | Future authorized action | Contract |
| --- | --- | --- |
| `src/runtime/s2b-contract.ts` | **Modify** | Add an exact two-version supported tuple/helper without changing the public Source/Correlation/Report schemas, limits or 2.2.5 compatibility |
| `src/runtime/s2b-input.ts` | **Modify** | Replace the equality-only `hostVersion` admission check with exact membership; preserve all other wrapper, Message/Tool/Session/pagination and rejection behavior |
| `tests/s2b/input.test.ts` | **Modify** | Pin positive 2.2.5/2.3.2 Source admission and negative unknown/missing/non-string versions, pagination/filter cases |
| `tests/s2b/input-shapes.test.ts` | **Modify only if needed** | Pin existing Assistant Tool variants and optional `time.firstToken` semantics without claiming validation that does not exist |
| `tests/s2b/adapter.test.ts` | **Modify** | Demonstrate truthful 2.3.2 end-to-end offline adapter→S1-d behavior, unknown-Version rejection with no S1-d call, and `coverageCompleteness` staying `NOT_ESTABLISHED` |
| `tests/s2b/projector.test.ts` | **Prefer no change** | Existing `foreignOnlyDoesNotMakeLimited`, collision, Evidence/Origin identity and zero-selected-Evidence cases are already present; rerun, do not duplicate |
| `tests/s2b/fixtures.ts` | **Prefer no change** | Existing `buildSource({ hostVersion })`, `assistantMessage`, `toolPart`, `pageResponse`, `linkedPages` are reusable |
| Existing `docs/superpowers/acceptance/`, `operations/`, `decisions/`, `plans/` | **No edit in this implementation unit** | Host evidence/results and actual operation are later separate Owner checkpoints |

**Existing precise interfaces at reference SHA**

```ts
// src/runtime/s2b-contract.ts
export const S2B_SUPPORTED_HOST_VERSION = "2.2.5" as const;
export type SourceResult =
  | Readonly<{ state: "REJECTED"; diagnostics: readonly S2bDiagnostic[] }>
  | Readonly<{ state: "ACCEPTED"; value: ValidatedSource }>;
export type S2bRequest = Readonly<{
  loaderInput: LoaderInput;
  sourcePath: string;
  correlationPath: string;
}>;
// src/runtime/s2b-input.ts
export function validateS2bSource(raw: Uint8Array): SourceResult;
export function validateS2bCorrelation(raw: Uint8Array): CorrelationResult;
// src/runtime/s2b-offline-adapter.ts
export async function runS2bOfflineAdapter(
  request: S2bRequest,
  source: S1aReadOnlySource,
  runS1d?: typeof runS1dDiagnostic,
): Promise<S2bReportV1>;
```

**Implementation decision (code committed, tests NOT_RUN):** The new membership authority `S2B_SUPPORTED_HOST_VERSIONS = ["2.2.5", "2.3.2"] as const` was added at `204567a`; the existing singular `S2B_SUPPORTED_HOST_VERSION = "2.2.5"` remains as legacy compatibility constant. In the validator, exact literal membership only (`includes` or equivalent, with no coercion). No semver ranges/prefixes.

## Review Focus — Five concrete failure modes to pin in this single task

1. Missing vs unknown `hostVersion`: absent wrapper key is rejected by required-key validation (`SOURCE_SCHEMA_INVALID`); present unsupported/null/non-string values reject as `SOURCE_VERSION_UNSUPPORTED`. No case is accepted or silently defaulted.
2. A truthful 2.3.2 Source with malformed/cyclic cursor chain or an explicit `type` request filter is not promoted to a complete, authoritative collection.
3. Optional `time.firstToken` is not assumed validated by current `isMessage()`; absent/present are accepted with otherwise valid fields, and a wrong-type value **alone** does not currently trigger rejection. Timestamp correctness remains unverified.
4. Foreign-only valid binding and missing/competing selected binding do not cross-pollinate Task Evidence; a `PROJECTED` adapter status with zero Evidence is never interpreted as an AC PASS.
5. A v2.3.2 Tool/Assistant shape not supported by the existing `isToolState()`/`isAssistantContent()` contract is rejected or limited according to the existing first/later-page rules, **not** silently accepted by weakening schema validation.

---

### Task 1: Bounded 2.3.2 Source admission with regression-proven offline behavior

**GO:** `SOURCE_IMPLEMENTATION_NOT_AUTHORIZED` at plan creation. **Execute this task only after separate Human Owner Source/Test GO.** This is one cohesive, testable implementation task; do not split test authoring, code edit and validation into automatic review-loop Tasks.

**Files**
- Modify: `src/runtime/s2b-contract.ts:8-12`
- Modify: `src/runtime/s2b-input.ts:12-22,307-312` (only the Version import/check and source-file comment as needed)
- Test: `tests/s2b/input.test.ts:28-78` and existing related shape/pagination suites
- Test: `tests/s2b/adapter.test.ts` using the existing `run` / `adapterFixture` patterns
- Test (only when assertions otherwise missing): `tests/s2b/input-shapes.test.ts`
- Read-only regression: `tests/s2b/projector.test.ts`, `tests/s2b/adapter-guards.test.ts`, `tests/s2b/fixtures.ts`

**Interfaces**
- Consumes: `buildSource({ hostVersion: string | null })`, `enc()`, `firstRequest()`, `laterRequest()`, `pageResponse()`, `assistantMessage()`, `toolPart()`, `adapterFixture()` and existing `runS2bOfflineAdapter` test stubs.
- Produces: exported immutable literal supported-version tuple `S2B_SUPPORTED_HOST_VERSIONS`; the **unchanged** `validateS2bSource(raw: Uint8Array): SourceResult` API now admits the two exact versions. No new wrapper field or API is introduced.

- [ ] **Step 1 — Inspect/freeze the bounded API subset.** Compare the pinned upstream `v2.2.5`/`v2.3.2` Message route and Session schema blob identities and the optional `time.firstToken` delta already recorded in the adopted Addendum. For the `session.get` and `session.messages` response envelopes and `isToolState`/`isAssistantContent` fields consumed by Justice, confirm the **specific** accepted 2.3.2 subset; note the upstream `packages/schema/src/tool.ts` blob differs. No Host API calls, credentials or network-sensitive executions. If a required 2.3.2 structure cannot be interpreted safely by existing S2-b checks, **stop this implementation task at the compatibility checkpoint**, record `NOT_VERIFIED`, and request a bounded Owner decision rather than expanding the parser or inventing a Collector.

- [ ] **Step 2 — Add the failing exact-Version tests.** In `tests/s2b/input.test.ts`, use existing `source`, `accepted`, `expectRejected` helpers:

```ts
it("acceptsPinnedHostVersionsOnly", () => {
  for (const hostVersion of ["2.2.5", "2.3.2"]) {
    const result = source(buildSource({ hostVersion }));
    expect(accepted(result).collectionStatus).toBe("PAGINATION_COMPLETE");
  }
});
it("rejectsOtherPresentHostVersionsWithoutFallback", () => {
  for (const hostVersion of ["2.2.6", "2.3.3", "2.x", "", null, 232]) {
    expectRejected(source(buildSource({ hostVersion })), "SOURCE_VERSION_UNSUPPORTED");
  }
});
```

  For a missing field, remove `hostVersion` from an otherwise valid wrapper and assert `SOURCE_SCHEMA_INVALID` (because `WRAPPER_REQUIRED` is checked before membership). Add the explicit 2.3.2 filtered-request and broken-paging assertions using existing `firstRequest`, `laterRequest`, `pageResponse` fixtures: filtered first page → `UNSUPPORTED_FILTERED_COLLECTION`; broken later-page cursor → accepted **validated prefix** with `PAGINATION_INCOMPLETE`, never synthetic completeness.

- [ ] **Step 3 — Verify RED against the pinned current behavior.** After Owner execution GO only, run:

```bash
bun run vitest run tests/s2b/input.test.ts
```

  Expected before code change: `acceptsPinnedHostVersionsOnly` **fails specifically for 2.3.2** with `SOURCE_VERSION_UNSUPPORTED`, while the 2.2.5 path and existing rejection tests remain valid. An unrelated failure is a stop-and-diagnose event, **not** proof of the expected RED.

- [ ] **Step 4 — Implement the smallest allowlist change.** Add `S2B_SUPPORTED_HOST_VERSIONS = ["2.2.5", "2.3.2"] as const` in `s2b-contract.ts`, retain the singular 2.2.5 legacy export, and change `validateWrapper()` in `s2b-input.ts` from equality with the legacy constant to exact tuple membership. Do **not** change `S2B_LIMITS`, wrapper shape, pagination algorithm, Session/Message/Tool validators, `firstToken`, Evidence identities, projected execution state, diagnostic ordering, or Correlation logic. Invalid versions still get `SOURCE_VERSION_UNSUPPORTED` when the field exists; missing key remains `SOURCE_SCHEMA_INVALID`.

- [ ] **Step 5 — Pin shape/identity regressions (historical plan; code added, execution NOT_RUN).** At `204567a`, Tool shape and optional `time.firstToken` tests were added; at `fa90f9d`, the missing positive multi-page 2.3.2 test `v232PositiveTwoPageCursorChainCompletes` was **ADDED** (first page `order=asc`, later opaque cursor; `PAGINATION_COMPLETE`, two validated pages and ordered Message IDs expected). **Do not add it again.** Retain existing foreign-only, collision and Evidence identity coverage; `oc225-msg-` / `opencode-v225-record` remain historical labels, not Host attestations. Actual Vitest/typecheck/lint results remain NOT_RUN / NOT_VERIFIED; further execution requires separate Owner approval.

- [ ] **Step 6 — Prove adapter behavior for the truthful 2.3.2 wrapper.** In `tests/s2b/adapter.test.ts`, reuse `adapterFixture({ sourceText: buildSource({ hostVersion: "2.3.2" }) })` and the existing `run()`/S1-d spy pattern. Assert a valid selected Message/Tool projects through S1-d **once**. Check `report.adapter.selectedTaskRef`, `report.adapter.projectionScope.scopeKey`, `report.adapter.coverageCompleteness === "NOT_ESTABLISHED"`, and inspect the virtual Evidence bytes with the **existing `spyRunner()` / `bridgedInputs(calls[0]!)` helper pattern** (as in `t01NormalSessionProjectedSelectedEvidenceOnly`) to assert exact `taskRef` and `acRef`, stable historical `issuerId`/`originId`, and no invented `PASS` or authenticity guarantee. Assert unsupported versions produce `adapter.status === "REJECTED"`, `SOURCE_VERSION_UNSUPPORTED` and **zero** S1-d invocations. Preserve existing `PROJECTED` / zero-selected Evidence behavior on foreign-only Correlation; do not promote it to AC-H01 PASS.

- [ ] **Step 7 — Run the bounded verification.** After separate GO only:

```bash
bun run vitest run tests/s2b/input.test.ts tests/s2b/input-shapes.test.ts tests/s2b/projector.test.ts tests/s2b/adapter.test.ts tests/s2b/adapter-guards.test.ts
bun run typecheck
bun run lint
```

  Expected: all these scoped suites/typecheck/lint **PASS**; failures are recorded accurately and block this Source-compatibility exit. If the Owner separately authorizes full regressions, optionally run `bun run test` rather than treating it as required Host evidence. Test output is **offline evidence only**: no actual OpenCode 2.3.2 Session was collected or run.

- [ ] **Step 8 — Check scope, commit and report (only with explicit GitHub write GO).** Confirm the diff is restricted to the two S2-b Source files and targeted tests; no `docs/superpowers/acceptance` real-Host PASS, Host config, Credentials or Owner Decision is touched. After the separately authorized GitHub Commit/Push scope is confirmed, commit only these paths once, push the exact authorized branch with non-force semantics, read back the changed file list and HEAD, and report counts, remaining limitations and the subsequent **Host GO HOLD**. Do not open a PR, merge or start an independent review automatically.

**Task exit (NOT YET MET at `204567a`):** A test-backed, bounded **offline** S2-b 2.3.2 Source acceptance path without regression to 2.2.5 or weaker validation can be declared only after actual tests pass. P-04 test code is ADDED, but execution is NOT_RUN / NOT_VERIFIED. If Stage 1 compatibility is unproven or Stage 7 fails, stop with the specific unmet condition; do not declare Source implementation accepted. **Even on success, AC-H01/H02/H03 remain `NOT_RUN` and Host GO remains `HOLD`.**

## Traceability / subsequent Owner checkpoints (not executable tasks in this plan)

| S5 target | After this plan, what is established? | Separate next authorization |
| --- | --- | --- |
| AC-H01 | Only offline adapter Version compatibility with precise regression evidence; no real-Host `PASS` | Reconcile or explicitly supersede existing untracked local Design/Host Manifest, fix binary SHA/source GET mechanism/Secrets/Network/Scope/Operation, and separately authorize safe Host Source acquisition/AC execution under existing S5 Plan Task 3 |
| AC-H02 | Existing Authority/Evidence rejection semantics and fixture isolation are preserved; not exercised on a real Host | Dedicated **copies** of approved Source, specific observer, and separate Owner GO under S5 Plan Task 4 |
| AC-H03 | No S3-b Source change; existing `JusticePlugin.initialize()` authoritative recovery scope remains | Dedicated durable state, single Writer, reversible failure/restart, independent readback and separate Owner GO under S5 Plan Task 5; HOLD if unsafe |
| Completion / Opt-in | Acceptance Record/Runbook/Owner Decision remain templates; no `PASS` or Owner decision is written | Human Owner decides `BOUNDED_COMPLETE` only after all fixed-host ACs PASS; `RELEASE_APPROVED` remains a **separate** explicit decision |

**Host safety nonfunctional gate:** Before any subsequent Host GO, demonstrate actual binary digest and Host identity; prove dedicated Session/Workdir/Task/Plan/Writer/readback/cleanup boundaries; characterize inherited credentials and effective network/side effects (no assumption of OS-deny); preserve existing OpenCode settings, user data and historical Gate/HOLD; keep raw Source private. If a required operation cannot be shown safe without unapproved shared-state changes, that AC stays HOLD. No new VM or Sandbox is presumed or authorized.

**Historical stop condition for the completed writing-plans task:** The plan was authored before implementation. The later Owner-approved Source/Test commit is `204567a`; tests remain NOT_RUN and no Host execution is authorized. Human Owner retains subsequent test, Host and Release decisions independently.
