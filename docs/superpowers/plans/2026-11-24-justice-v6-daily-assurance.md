# Justice v6 — Daily Development Assurance Integration Implementation Plan R0.1.2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (recommended) or superpowers:subagent-driven-development after explicit execution approval. Steps use checkboxes. This is a document-only revision; do not execute these steps now.

**Parent:** #388; **Tracker:** [#401](https://github.com/yohi/justice/issues/401) (original R0.1, do not edit).  
**Status:** `BASIC_DESIGN_OWNER_ADOPTED / LIMITED_DOCUMENT_CORRECTION / PLAN_CANDIDATE / IMPLEMENTATION_NOT_AUTHORIZED / LIVE_NOT_AUTHORIZED`  
**Goal:** 承認済みSuperpowers Taskの実行証拠と実変更を既存Justiceへ接続し、日常開発におけるネガティブな乖離の検出・是正支援を実現する。  
**Architecture:** 明示的Task境界、Native Hookによる実行Identity観測、固定Native Sourceと独立Git ChangeSet、既存S1/S2診断およびS1-d Scope Fallbackを接続する。S3の限定保証を保全し、Advisoryのみ返す。  
**Tech Stack:** TypeScript / Bun / Vitest / @opencode/plugin 2.3.2 / Git、既存node:fs/crypto/child_processのみ。  
**Spec:** [Design R0.1.2](../specs/2026-11-24-justice-v6-daily-assurance-design.md)。Owner採択済みGoal / Advisory / Native Hook＋Superpowers基本方式を保全。R0.1.1のRG-001〜004訂正を保全し、RG-001のTERMINAL返却前のBinding再検証とProduction wiring表記のみ最終限定訂正。RG-002〜004を再openしない。Plan採択・実装開始・Liveは別判断。  
**Reviewed HEAD:** `ddcf80b0e22d9c45343772390a22c4a911a388df`; **Base:** `0195966130fb06b93c5ad79601d563307fd8df11`; implementation baseline `896acee25323c0e5b6dc97e0dd936efff1b9e434`.

## 採択済み基本設計・受入条件

- Intent Bridge: 承認済みManifest / TaskIntent / Scope Policy / AC、実行対象と基準点を実行前に固定。
- Evidence Bridge: Native Source / Tool Identityを事前規則で帰属、実Git ChangeSetを既存診断へ供給。
- Advisory Bridge: Superpowersの明示的Task境界から診断し、既存Review/完了判断へ還元。正式承認とは区別。

| ID | 受入条件 |
|---|---|
| AC-D01 | 承認済みDesign/Plan/Task/AC、実行対象・基準点を事前固定 |
| AC-D02 | Native Evidence取得・対象Task帰属 |
| AC-D03 | 実ChangeSetを既存S1-c/S1-dに接続 |
| AC-D04 | Evidence不足、Scope逸脱、不正帰属の診断 |
| AC-D05 | Task境界で自動診断・Advisory返却 |
| AC-D06 | Authority未証明・欠測を成功へ昇格しない |
| AC-D07 | 通常開発を不要に停止せずレビュー循環なし |
| AC-D08 | Opt-in / Stop / Rollback、既存環境・Credential保護 |

## Global Constraints

- Superpowers First / OpenCode V2 Native First。固定2.3.2、single Task/Session/Process、dedicated Git worktree、inline executing-plans。初回はdirect shellのAC帰属のみ。Code Modeの内側/外側executeをACへ自動帰属しない。子Session・複数Writer・並行Task・他Versionは非対象。
- Default OFF / Advisory Only。固定Owner packageと外部digestのみ。既存S1/S2/S3、V1/V2 justice_review、S2-b v1 report/REJECTED契約、resolve拒否を維持。Owner Authorityの証明・正式PASSを自動生成しない。
- 事前固定Intent/Scope Policy/AC/rules/Session/worktree/base。既存Planの構造化scope blockを使用。raw Native Sourceは専用非機密Sessionのbounded memoryのみ。生payloadのログ・永続化・転送なし。秘密/FS race freedom/Host強制/履歴完全性の保証を主張しない。
- 共有Config/State/Credentialを変更しない。新規依存・Lockfile・SDK変更禁止。S4、V1全面移植、強制Gate、新規Review/Workflow/Router/認証/署名基盤なし。無制限Polling・自動再実行・追加レビュー循環なし。
- **現在は文書訂正のみ。** Source変更、Build/Test、Live、Release、無承認Commit/Push/PR禁止。T1〜5の実装GOなし。T6は別Owner GO。E1/E2/E3 HOLD、RELEASE_APPROVED PENDING、S5 BOUNDED_COMPLETE APPROVED、#355/#356/#358 Closed、#357延期、#388 Openを維持。Issue #401本文を変更しない。
- 下記は実装承認後に初めて実行する手順。各TaskのGREENと限定commit境界は実行承認がある場合だけ有効。REDが別原因（環境/コンパイル/依存など）なら原因を区別し、テスト成功に読み替えない。実装中の新規Findingだけで追加Taskを始めない。

## File map

| Task | Create / modify | Test |
|---|---|---|
| T1 | `src/runtime/daily-intent.ts` | `tests/runtime/daily-intent.test.ts`, new `tests/helpers/daily-fixtures.ts` (test-only) |
| T2 | `src/runtime/daily-native-evidence.ts` | `tests/runtime/daily-native-evidence.test.ts` |
| T3 | `src/runtime/daily-changeset.ts` | `tests/runtime/daily-changeset.test.ts` |
| T4 | `src/runtime/daily-advisory.ts`; reuse existing S2-b validators/projector (legacy adapter source unchanged) | `tests/runtime/daily-advisory.test.ts`, `tests/s2b/adapter.test.ts` |
| T5 | `src/runtime/daily-superpowers.ts`, `src/opencode-v2-plugin.ts`; README only if actual usage needs documentation | `tests/integration/opencode-v2-daily-advisory.test.ts` |
| T6 | No default source change; separately authorized dedicated pilot/evidence | AC-D01〜08 acceptance observations |

Type declarations below are implementation contracts, not source code created by this document. All imports refer to the fixed baseline or the Task that introduces the type. Use `.js` import specifiers consistent with existing runtime modules. Never expose production private ports through public tool schema/package exports.

## Review Focus

- T1: missing external digest, self-asserted approval, read-only mount mismatch or changed bytes; no fallback approval source.
- T2: same name but different command/workdir/timeout/background, nested CallID, foreign Session, duplicate rule candidate; no false AC binding.
- T3: dirty base, unmerged/gitlink/skip-worktree/assume-unchanged, unsafe path, bounded non-stable snapshot; no false empty PRESENT.
- T4: native rejected with known independent Git outside-scope; preserve Scope Fallback and legacy REJECTED contract; invalid Intent disables both.
- T5: concurrent/late Tool, abort, duplicate finish and partial registration failure; no false DIAGNOSED, no re-run, reverse-order cleanup.

## Task 1 — Fixed Intent / explicit binding (AC-D01/D06; RG-001)

**Files:** create `src/runtime/daily-intent.ts`, `tests/runtime/daily-intent.test.ts`, `tests/helpers/daily-fixtures.ts`.  
**Consumes:** existing `TaskIntent`, `IntentRef`, `LoaderInput`, `S1aReadOnlySource`, `LoaderResult` from `core/s1a/contract.ts`; `TaskScopePolicy` from `core/s1c/contract.ts`; existing `createS1aReadOnlySource`, `createCapturedS1aSource`, `loadS1aArtifacts`, `parseStrictJson`, `parseTaskIntent`, `extractTaskScopePolicy`.  
**Produces:** types below, `loadDailyOwnerConfig`, `prepareDailyBinding`, `verifyDailyBinding`, `matchRuleInput`. No V2 setup changes until T5. T3 implements the actual clean-Git check consumed by the T1 port; T5 wires it into production.

### Contract

```typescript
export const DAILY_OWNER_ROOT = "/run/justice-daily/owner";
export const DAILY_APPROVAL_ENV = "JUSTICE_DAILY_APPROVAL_SHA256";
export const DAILY_HOST_SHA256 =
  "e6543f6e5c39c40971ba38afd1819ac852c29ac735b5a89065d3d148d47f27ad";

export type DailyReason =
  | "NOT_OPTED_IN" | "APPROVAL_INVALID" | "APPROVAL_DIGEST_MISMATCH"
  | "OWNER_BOUNDARY_UNVERIFIED" | "HOST_MISMATCH" | "SESSION_MISMATCH"
  | "WORKSPACE_MISMATCH" | "BASE_MISMATCH" | "DIRTY_BASE"
  | "BINDING_INVALID" | "INTENT_DIGEST_MISMATCH" | "ARTIFACT_MISMATCH"
  | "SCOPE_POLICY_INVALID" | "RULE_INVALID" | "SKILL_UNSUPPORTED"
  | "SOURCE_UNAVAILABLE" | "SOURCE_REJECTED" | "SOURCE_INCOMPLETE"
  | "SOURCE_UNSTABLE" | "RULE_UNMATCHED" | "RULE_AMBIGUOUS"
  | "IDENTITY_UNMATCHED" | "TOOL_NOT_COMPLETED" | "OBSERVATION_LIMIT"
  | "GIT_UNAVAILABLE" | "GIT_UNSTABLE" | "GIT_UNSUPPORTED" | "GIT_LIMIT"
  | "BOUNDARY_UNCERTAIN" | "TOOL_IN_FLIGHT" | "LATE_OBSERVATION"
  | "NOT_OBSERVED" | "BUSY" | "ALREADY_TERMINAL" | "BINDING_KEY_MISMATCH"
  | "ABORTED" | "TIMEOUT" | "DISPOSED" | "SETUP_FAILED" | "CLEANUP_FAILED"
  | "DIAGNOSTIC_UNAVAILABLE";
export type Unavailable = Readonly<{ state: "UNAVAILABLE"; reason: DailyReason }>;
export type CheckResult = Readonly<{state: "OK"}> | Unavailable;
export type ShellRuleInput = Readonly<{
  command: string; workdir: string; timeout: number; background: false;
}>;
export type AcquisitionRule = Readonly<{
  ruleId: string; acRef: IntentRef; purpose: "TEST_INVOCATION";
  tool: "shell"; input: ShellRuleInput;
}>;
export type DailyOwnerApproval = Readonly<{
  schemaVersion: "justice-daily-owner-approval-v1"; enabled: true;
  ownerDecisionRef: string; hostVersion: "2.3.2"; hostBinarySha256: string;
  manifestSha256: string; intentSha256: string; intent: TaskIntent;
  rules: readonly AcquisitionRule[]; sessionId: string; worktreeRoot: string;
  baseCommit: string; nativePort: number;
  skill: Readonly<{id: string; name: "executing-plans"; path: string; contentSha256: string}>;
}>;
export type DailyOwnerConfig = Readonly<{
  approval: DailyOwnerApproval; approvalSha256: string;
  loaderInput: LoaderInput & Readonly<{expectedManifestSha256: string}>;
}>;
export type DailyConfigResult = Readonly<{state: "READY"; config: DailyOwnerConfig}>
  | Readonly<{state: "OFF"; reason: DailyReason}>;
export interface OwnerConfigReadPort {
  verifyReadOnlyMount(signal: AbortSignal): Promise<CheckResult>;
  readApproval(maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
}
export interface DailyPreflightPorts {
  reloadOwnerConfig(signal: AbortSignal): Promise<DailyConfigResult>;
  readonly source: S1aReadOnlySource;
  verifyRuntime(config: DailyOwnerConfig, signal: AbortSignal): Promise<CheckResult>;
  checkCleanBase(config: DailyOwnerConfig, signal: AbortSignal): Promise<CheckResult>;
}
export type DailyBinding = Readonly<{
  key: string; config: DailyOwnerConfig; intent: TaskIntent;
  baseline: LoaderResult; scopePolicy: TaskScopePolicy;
  ownerAuthorityStatus: "NOT_PROVEN";
  // Closed-over copies; only the exact fixed input paths / selected artifact paths.
  source: S1aReadOnlySource;
}>;
export type DailyStartResult = Readonly<{state: "READY"; binding: DailyBinding}> | Unavailable;

export function loadDailyOwnerConfig(
  expectedSha256: string | undefined, port: OwnerConfigReadPort, signal: AbortSignal
): Promise<DailyConfigResult>;
export function prepareDailyBinding(
  config: DailyOwnerConfig, ports: DailyPreflightPorts, signal: AbortSignal
): Promise<DailyStartResult>;
export function verifyDailyBinding(
  binding: DailyBinding, ports: DailyPreflightPorts, signal: AbortSignal
): Promise<CheckResult>;
export function matchRuleInput(
  rules: readonly AcquisitionRule[], tool: string, input: unknown
): string | null;
```

The function declarations express signatures; implement their bodies in T1. `expectedSha256` comes only from captured Owner process environment in production, never from a tool request. `binding.key = config.approvalSha256`. `loaderInput` is fixed to `/run/justice-daily/owner/manifest.json`, `intent.json`, `artifacts/`; `expectedManifestSha256 = approval.manifestSha256`. `reloadOwnerConfig` reuses the original captured expected digest and rejects changes to that environment setting. `verifyRuntime` checks actual binary/mount/location against config; not a claim of cryptographic Owner identity. `checkCleanBase` is invoked only before begin, not after the Task has intentionally changed files. `verifyDailyBinding` repeats Owner package / captured external digest, Runtime identity, Manifest / Intent bytes and digests, selected Artifact bytes and digests, and Scope Policy checks with the same fixed inputs and current read-only supply (`ports.source`, not only `binding.source` private snapshots); it does not repeat the initial clean check, rejects changes and never creates a replacement binding. T5 uses this same function before returning a cached Advisory in TERMINAL; only OK permits a still-valid cached report. Any Binding mismatch or verification failure maps to `makeDailyUnavailable("BINDING_INVALID")` at that return boundary (existing cancellation/disposal rules remain). It does not collect Native Evidence or Git ChangeSet, invoke S1-d, rerun the Task or introduce a new verification mechanism. All I/O uses the same cancellation budget. Existing S1aReadOnlySource has no AbortSignal parameter: check signal before and after each bounded read; abort suppresses READY and any late result, not a claim of interrupting already issued OS I/O. Native/Git ports receive the signal.

Failure mapping: absent env→OFF/NOT_OPTED_IN; malformed expected digest/schema/unknown keys→OFF/APPROVAL_INVALID; package byte mismatch→OFF/APPROVAL_DIGEST_MISMATCH; mount/reader trust unavailable→OFF/OWNER_BOUNDARY_UNVERIFIED; invalid/duplicate rule→OFF/RULE_INVALID; host/location mismatch→HOST_MISMATCH/WORKSPACE_MISMATCH; intent digest mismatch→INTENT_DIGEST_MISMATCH; selected identity/digest mismatch→ARTIFACT_MISMATCH; scope block absent/invalid→SCOPE_POLICY_INVALID; clean/base errors propagate DIRTY_BASE/BASE_MISMATCH; abort→ABORTED. Begin/preflight failures are UNAVAILABLE, not OFF configuration discovery, and cannot select a new source.

Exact validation (Design §4.1–4.2): strict JSON max 65,536 bytes; exactly the listed fields; SHA-256 lowercase hex; approved host SHA constant; Session safe existing v2 `ses_` identifier; Owner receipt and rules safe IDs (`isSafeIdentifier`); base 40 lowercase hex (initial SHA-1 repo only); nativePort integer 1..65535; absolute normalized Linux root/path, no symlink or path traversal. Rule count 1..128, distinct ruleId and exact four-field input, selected AC ID+revision, `workdir===worktreeRoot`, timeout 1..60,000, command 1..4,096 UTF-8 bytes; no NUL/CR/LF in command; `background:false` explicit. Shell command content is Owner-reviewed non-secret, no arbitrary approval by model. This syntax check is not a security proof of shell semantics. `matchRuleInput` returns a ruleId only when tool=`shell`, plain object has exactly those four keys and all values match one rule; otherwise null. Never stringify or store arbitrary payload; inspect only known scalar fields. Duplicate rule inputs are rejected at config validation.

### RED tests

`tests/helpers/daily-fixtures.ts` exposes `makeDailyFixture(): Promise<DailyFixture>`; `DailyFixture` is `{ approval:DailyOwnerApproval; approvalBytes:Uint8Array; expectedSha256:string; configPort:OwnerConfigReadPort; config:DailyOwnerConfig; ports:DailyPreflightPorts; source:S1aReadOnlySource; setApprovalBytes(bytes:Uint8Array):void; setArtifactBytes(path:string, bytes:Uint8Array):void; setRuntimeCheck(result:CheckResult):void; setCleanCheck(result:CheckResult):void }`. Use existing `s1aFixture`, `sha256`, `jsonBytes` from `tests/helpers/s1a-fixtures.ts`. Clone its bytes and replace plan-1.md with `## Justice S1-c Task Scope Policies` followed by the existing exact begin/end HTML markers and one JSON policy (`justice-s1c-task-scope-v1`, `planRef=plan-1@R1`, `taskRef=task-1@R1`, `scopeKey=scope-1`, `allowedPaths=["src/a.ts","tests/**"]`); recompute that manifest artifact digest and then manifest/intent/approval digests. Fixture values: `sessionId="ses_fixture001"`, `worktreeRoot="/tmp/justice-daily-fixture"`, `baseCommit="a".repeat(40)`, `nativePort=49187`, `ownerDecisionRef="owner-fixture-only"`, skill `id="skill-fixture"`, `name="executing-plans"`, `path="/tmp/justice-daily-fixture-skill/SKILL.md"`, `contentSha256=sha256("fixture-skill")`; two rules `r1/ac-1@R1` command `bun run vitest run tests/a.test.ts`, `r2/ac-2@R1` command `bun run vitest run tests/b.test.ts`; exact workdir, timeout 5000, background false. Read port initially returns copies of fixture bytes and OK checks. Compute config directly from fixture contract, not via implementation under test. All test fixture approval is `TEST_ONLY`, never live authority.

- [ ] Write failing tests. Minimal test code (Vitest imports `it`, `expect`, `vi`; import T1 symbols and fixture helper from the paths above):

```typescript
it("does not accept a replaced approval or self-supplied digest", async () => {
  const f = await makeDailyFixture();
  const signal = new AbortController().signal;
  expect((await loadDailyOwnerConfig(undefined, f.configPort, signal)).state).toBe("OFF");
  expect((await loadDailyOwnerConfig(f.expectedSha256, f.configPort, signal)).state).toBe("READY");
  f.setApprovalBytes(jsonBytes({...f.approval, ownerDecisionRef: "agent-made"}));
  expect(await loadDailyOwnerConfig(f.expectedSha256, f.configPort, signal))
    .toEqual({state:"OFF", reason:"APPROVAL_DIGEST_MISMATCH"});
});
it("binds only the fixed package and invalidates later mutation", async () => {
  const f = await makeDailyFixture();
  const signal = new AbortController().signal;
  const start = await prepareDailyBinding(f.config, f.ports, signal);
  expect(start.state).toBe("READY");
  if (start.state !== "READY") throw Error("expected fixture binding");
  expect(start.binding.baseline.eligibleBaseline).toBe(false);
  expect(start.binding.ownerAuthorityStatus).toBe("NOT_PROVEN");
  f.setArtifactBytes("plan-1.md", new TextEncoder().encode("changed"));
  expect((await verifyDailyBinding(start.binding, f.ports, signal)).state).toBe("UNAVAILABLE");
});
it("requires an exact shell input, not just the tool name", async () => {
  const f = await makeDailyFixture(); const r = f.approval.rules[0]!;
  expect(matchRuleInput(f.approval.rules, "shell", r.input)).toBe("r1");
  expect(matchRuleInput(f.approval.rules, "shell", {...r.input,command:"pwd"})).toBeNull();
  expect(matchRuleInput(f.approval.rules, "execute", r.input)).toBeNull();
});
```

Also parameterize missing/invalid/duplicate keys, changed digest with same filename, read-only mount failure, host mismatch, dirty/base/workspace mismatch, selected task/revision/scope/AC mismatch, missing or invalid Scope Policy, duplicate ruleId/input, extra shell keys, changed cwd/timeout/background, cancellation, retained caller buffer mutation, immutable private copies. Assert no writes/approval elevation and no READY for those conditions.

- [ ] RED: `bun run vitest run tests/runtime/daily-intent.test.ts`. Expected initial fail: new contract entry missing or expected OFF/READY/invalidation assertion fails because behavior does not exist; after skeleton compile, retain failing behavioral assertion, not just broken fixture. No unrelated test/environment failure accepted as RED.
- [ ] Minimum GREEN: `loadDailyOwnerConfig` fixed mount/digest/strict parser/config validation. `prepareDailyBinding` reload/check runtime/clean base, bounded snapshot of manifest/intent and only selected artifacts via existing FS source + captured S1-a source, compare raw digests and exact parsed refs/Scope Policy; snapshot source returns fresh copies and rejects any other path. `verifyDailyBinding` compare same raw digests/selected refs/Owner package and runtime with a fresh bounded check; no post-start baseline rebind. `matchRuleInput` deterministic exact scalar comparison. No source mutation. Test port fakes only; production mounting implementation in T5.
- [ ] GREEN: same test command; all T1 tests PASS; `bun run typecheck` exit 0. Scoped commit after approval: `git add src/runtime/daily-intent.ts tests/runtime/daily-intent.test.ts tests/helpers/daily-fixtures.ts && git commit -m "feat: bind daily assurance task intent before execution"`.

## Task 2 — Native Evidence Bridge (AC-D02/D04/D06; RG-002)

**Files:** create `src/runtime/daily-native-evidence.ts`, `tests/runtime/daily-native-evidence.test.ts`.  
**Consumes:** T1 DailyBinding/AcquisitionRule/DailyReason/matchRuleInput; existing `S2B_LIMITS`, `ValidatedSource`, `CorrelationBinding`, `S2bDiagnostic` from `runtime/s2b-contract.ts`; `validateS2bSource` / `validateS2bCorrelation` from `runtime/s2b-input.ts`; existing `projectS2bEvidence` from `runtime/s2b-projector.ts`.  
**Produces:** hook observation conversion, Native snapshot acquisition + boundary checks, deterministic Correlation generation, all types below. Production HTTP port is wired in T5; T2 implements fixed URL construction + bounded read adapter used by T5.

### Contract

```typescript
export type CallIdentity = Readonly<{sessionId:string; messageId:string; callId:string}>;
export type NativeObservation = Readonly<CallIdentity & {
  tool: string; phase: "BEFORE" | "AFTER";
  status: "STARTED" | "COMPLETED" | "ERROR"; ruleId: string | null;
}>;
export type NativePageQuery = Readonly<{order:"asc";limit:100}>
  | Readonly<{cursor:string;limit:100}>;
export type NativeBytes = Readonly<{state:"OK";bytes:Uint8Array}> | Unavailable;
export interface NativeReadPort {
  getSession(sessionId:string, signal:AbortSignal):Promise<NativeBytes>;
  getMessages(sessionId:string, query:NativePageQuery, signal:AbortSignal):Promise<NativeBytes>;
  getRunningShells(worktreeRoot:string, signal:AbortSignal):Promise<NativeBytes>;
}
export type NativeSnapshot = Readonly<{
  rawWrapper:Uint8Array; validated:ValidatedSource;
  // digest of length-framed raw page response bytes, in validated page order
  pageDigest:string;
  sessionId:string; worktreeRoot:string;
}>;
export type NativeSnapshotResult = Readonly<{state:"READY";snapshot:NativeSnapshot}>
  | Readonly<{state:"REJECTED";reasons:readonly DailyReason[];diagnostics:readonly S2bDiagnostic[]}>
  | Unavailable;
export type NativeEpoch = Readonly<{
  begin:CallIdentity; finish:CallIdentity; prefixMessageIds:readonly string[];
  observations:readonly NativeObservation[];
}>;
export type BoundaryCheck = Readonly<{state:"BOUNDED"}> | Unavailable;
export type PrefixResult = Readonly<{state:"READY";prefixMessageIds:readonly string[]}> | Unavailable;
export type DailyEvidenceResult =
  | Readonly<{state:"VALID";bindingKey:string;rawWrapper:Uint8Array;correlationBytes:Uint8Array;
      sourceSha256:string;correlationSha256:string;limited:boolean;reasons:readonly DailyReason[]}>
  | Readonly<{state:"REJECTED";reasons:readonly DailyReason[];diagnostics:readonly S2bDiagnostic[]}>
  | Unavailable;

export function createNativeReadPort(config:DailyOwnerConfig):NativeReadPort;
export function readNativeSnapshot(
  binding:DailyBinding, port:NativeReadPort, collectionId:string, signal:AbortSignal
):Promise<NativeSnapshotResult>;
export function checkBeginPrefix(snapshot:NativeSnapshot, begin:CallIdentity):PrefixResult;
export function checkFinishBoundary(
  before:NativeSnapshot, after:NativeSnapshot, epoch:NativeEpoch
):BoundaryCheck;
export function checkNoRunningShells(
  binding:DailyBinding, port:NativeReadPort, signal:AbortSignal
):Promise<CheckResult>;
export function collectDailyNativeEvidence(
  binding:DailyBinding, snapshot:NativeSnapshot, epoch:NativeEpoch
):DailyEvidenceResult;
```

`NativeObservation` is the safe in-memory envelope. Build it in T5 from fixed SDK before/after properties; `id` maps to `callId` exactly. `ruleId` is derived only by `matchRuleInput` for the selected Session during ACTIVE, otherwise null; never raw input/output/error. Before status STARTED, after status COMPLETED or ERROR. This type cannot represent a provider payload. `NativeEpoch` is frozen from the coordinator at finish; only observations of the active epoch are passed. `collectionId` is `daily-<first 16 hex of binding.key>-begin`, `...-end-a`, `...-end-b` fixed by coordinator, not model input. Snapshot bytes are private copies, never returned through public tool results. `DailyEvidenceResult.VALID` means validated input pair, not approval, execution verification or final PASS. Bind both copied byte arrays to the same bindingKey and record their SHA-256 immediately; T4 verifies these fixed digests before using copies. This is an internal data-integrity check, not external authentication.

**Native protocol:** fixed origin `http://127.0.0.1:${approval.nativePort}`, no redirect/proxy/auth/credential forwarding, use trusted native fetch with only the fixed path/query. Port rejects sessionId/root not matching config. `getSession`: `/api/session/<encoded id>`; `getMessages`: `/api/session/<encoded id>/message` with first `order=asc&limit=100`, later `cursor=<encoded opaque>&limit=100`; `getRunningShells`: `/api/shell?location%5Bdirectory%5D=<encoded root>`. `Content-Type` must be JSON, status 200, raw body streamed with caps (session 1,048,576; page 4,194,304; shell list 1,048,576 bytes), each GET 5s and collection 30s, cancel/oversize/parse error → safe fixed reason, no retries. Collect max64 pages, aggregate raw page bytes <=67,108,864, wrapper <=75,497,472, existing per-message/total limits. Query cursor loops and unsupported filter never advanced. Wrap as existing `justice-s2b-source-v1`: `{schemaVersion,collectionId,hostVersion:"2.3.2",sessionId,session:{collectedAt,response},sessionAfter:{collectedAt,response},messagePages:[{pageIndex,collectedAt,request,response}],diff:null}`. pageIndex is zero-based, collectedAt actual UTC ISO-8601, request is `{sessionId,order:"asc",limit:100}` or `{sessionId,cursor,limit:100}`. The response values retain original validated raw JSON spans. Start/after session.get must match selected session, no parent/fork/other workspace and `location.directory` exact worktreeRoot. Response must pass existing Source validator; store raw response bytes embedded without parse/reserialize (strict parsing for pagination/identity only; length-frame pageDigest e.g. uint32 big-endian length + bytes per page). If raw wrapper cannot be accepted, REJECTED; partial contiguous pagination may be READY with `PAGINATION_INCOMPLETE` in validator result but cannot pass begin/finish boundary. Shell list requires `{location:{directory:root},data:[]}` and no active shell; other shape or nonempty data is UNAVAILABLE (`BOUNDARY_UNCERTAIN` or `TOOL_IN_FLIGHT`). No reading shell outputs.

**Boundary:** checkBeginPrefix requires unique Assistant begin message with exactly one Tool part name `justice_task_begin`, id matching begin.callId, and no other nonterminal part; full page sequence, previous Assistant Tool parts terminal, no unknown child/background/location-switch evidence; capture all pre-begin message IDs (including begin message) in order. Initial session must be dedicated to this task; prior completed setup-only messages excluded, no prior task. checkFinishBoundary requires both snapshots complete, same session/location, identical pageDigest, same message order, prefix IDs preserved in order, unique begin and finish IDs, finish message exactly one direct `justice_task_finish` Tool part with matching callId (its own running part allowed), begin completed, all other tool parts terminal, no foreign/child/background/location-switch/compaction ambiguity. New message after finish marker or unmatched/duplicate message identity → UNAVAILABLE `BOUNDARY_UNCERTAIN`. No new acquisition/retry on failure. Metadata-only observation cannot establish full Host process quiescence; design §4.3 external boundary remains required.

**Correlation:** for each fixed rule require one unique matching active pair BEFORE/AFTER completed, same tool and rule, then exact Assistant saved message + Tool id/name + state.input tuple + completed/executed=false. Message ID must be strictly after begin and before finish and not in prefixMessageIds. Only direct shell saved part with equal id can match. Same message multiple eligible parts grouped in one binding; one pair cannot satisfy two rules. 0 matches → RULE_UNMATCHED, multiple → RULE_AMBIGUOUS, unmatched hook vs part → IDENTITY_UNMATCHED, unfinished/error → TOOL_NOT_COMPLETED; nonmatching irrelevant Tool not attributed. Build Correlation v1 with fixed task/scope/ac refs, UTF-8 sort message/tool IDs, verify using existing validator. `limited=true` for any rule deficit/ambiguity or incomplete accepted source; never choose one by recency. Entire Source/Correlation reject yields REJECTED. Static evidence: core/session/runner/publish-llm-event.ts L497–596 persists `providerExecuted` as `executed`, and step.ts L143–148 skips local execution for providerExecuted calls. A matching local direct-shell hook therefore requires saved `executed===false`; true or absent is not accepted. Legacy S2-b deliberately returns `reportedExecutionState=UNKNOWN` for this local part, and `reportedOutcome=UNKNOWN`. Keep those labels; a separate matched-local-completed-hook count is observation only, not proof of test PASS.

### RED tests

Use existing `tests/s2b/fixtures.ts` `buildSource`, `assistantMessage`, `toolPart`, `linkedPages`, `sessionResponse`, `enc`, `correlation`; create `tests/runtime/daily-native-evidence.test.ts` local helper `nativeCase(f, variant)` that builds a real validated v2.3.2 raw wrapper (`hostVersion:"2.3.2"`, session `location:{directory:f.approval.worktreeRoot}`, no parent; same sessionAfter; raw page responses). Fixture active assistant `msg_002` contains direct `shell` part `tool_001` with `executed:false`, completed state input r1 exact, text content `"fixture"`; active pair matching IDs/r1; begin `msg_001/tool_begin`, finish `msg_003/tool_finish`, respective direct names, begin completed and finish running, prefix `["msg_001"]`. Validate fixture with existing parser; set second rule unmatched unless case adds r2. Helper returns `{binding,snapshot,epoch}` using T1 READY binding and the listed validated raw wrapper; variants alter exact fields only. To test same-message multiple parts use `tool_002` matching r2 with its own pair. Build `NativeReadPort` fakes returning fixture raw bytes by exact query and assert calls; no HTTP in tests. The expected Correlation JSON is based on existing public schema, not on the new implementation.

- [ ] Write failing tests. Minimal code:

```typescript
it("does not attribute another command or a nested call to an AC", async () => {
  const f = await makeDailyFixture();
  const c = await nativeCase(f, "different-command");
  const result = collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
  expect(result.state).toBe("VALID");
  if (result.state !== "VALID") throw Error("expected limited projection input");
  expect(result.limited).toBe(true);
  expect(JSON.parse(new TextDecoder().decode(result.correlationBytes)).messageBindings).toEqual([]);
  const n = await nativeCase(f,"nested-id-not-saved");
  const other = collectDailyNativeEvidence(n.binding,n.snapshot,n.epoch);
  expect(other.state).toBe("VALID");
  if (other.state !== "VALID") throw Error("expected limited input");
  expect(JSON.parse(new TextDecoder().decode(other.correlationBytes)).messageBindings).toEqual([]);
});
it("groups distinct matched shell calls in one assistant message", async () => {
  const c = await nativeCase(await makeDailyFixture(),"two-matched-parts");
  const result = collectDailyNativeEvidence(c.binding,c.snapshot,c.epoch);
  expect(result.state).toBe("VALID");
  if (result.state !== "VALID") throw Error("expected valid");
  expect(JSON.parse(new TextDecoder().decode(result.correlationBytes)).messageBindings)
    .toEqual([{messageId:"msg_002",taskRef:{artifactId:"task-1",revision:"R1"},scopeKey:"scope-1",tools:[
      {toolId:"tool_001",acRef:{artifactId:"ac-1",revision:"R1"}},
      {toolId:"tool_002",acRef:{artifactId:"ac-2",revision:"R1"}}]}]);
});
```

Add parameterized tests: exact tuple happy path; same tool/different command/workdir/timeout/background/extra keys; wrong session/message/id; duplicate identical hook (coalesced at T5), distinct duplicate candidate (no binding for rule); mismatch between BEFORE/AFTER/Source; outer execute and controls excluded; `executed:true` (provider execution)/missing executed/running/error/pre-begin message ID not attributed; multiple pages and opaque cursor, missing/loop/oversize/unsupported version; source rejected versus incomplete; begin/finish missing, same-message extra tool, running other Tool, prefix drift and pageDigest mismatch. Fixed Native HTTP URL/query/timeout/cap/redirect/no auth tests using stub fetch, not actual network. Ensure no raw payload is output by any reason/observation projection.

- [ ] RED: `bun run vitest run tests/runtime/daily-native-evidence.test.ts` → missing new entry or wrong Correlation/Boundary assertions, then behavioral RED. Unrelated environment failure not accepted.
- [ ] Minimum GREEN: fixed Native read port + raw wrapper assembly using existing validator; `checkBeginPrefix`, `checkFinishBoundary`, `checkNoRunningShells` and exact deterministic selection described above. Preserve caps and safe reasons. No heuristic mapping. If SDK/source shape differs, reject; no alternative native schema or provider-specific inference. No raw logs or disk writes.
- [ ] GREEN: same command + `bun run vitest run tests/s2b` → all relevant tests PASS. Scoped commit: `git add src/runtime/daily-native-evidence.ts tests/runtime/daily-native-evidence.test.ts && git commit -m "feat: acquire bounded native task evidence"`.

## Task 3 — Read-only Git ChangeSet (AC-D03/D04)

**Files:** create `src/runtime/daily-changeset.ts`, `tests/runtime/daily-changeset.test.ts`.  
**Consumes:** T1 `DailyOwnerConfig`, `DailyBinding`, `CheckResult`, `Unavailable`, `DailyReason`; existing `ChangeSet`, `ChangedPath` from `core/s1c/contract.ts`, `inspectChangeSet` from `core/s1c/path-rules.ts`.  
**Produces:** fixed Git read port, start clean check, end bounded ChangeSet. T5 production preflight uses `checkCleanBase`; T4 consumes DailyChangeSetResult.

```typescript
export type GitReadResult = Readonly<{state:"OK";exitCode:number;stdout:Uint8Array}> | Unavailable;
export interface DailyGitReadPort {
  run(args:readonly string[], maxBytes:number, signal:AbortSignal):Promise<GitReadResult>;
}
export type DailyChangeSetResult = Readonly<{
  state:"VALID"; changeSet:Extract<ChangeSet,{availability:"PRESENT"}>;
  baseCommit:string; headCommit:string;
}> | Unavailable;
export function createDailyGitReadPort(config:DailyOwnerConfig):DailyGitReadPort;
export function checkCleanBase(config:DailyOwnerConfig, git:DailyGitReadPort, signal:AbortSignal):Promise<CheckResult>;
export function collectDailyChangeSet(binding:DailyBinding, git:DailyGitReadPort, signal:AbortSignal):Promise<DailyChangeSetResult>;
```

**Fixed production port:** no shell; `/usr/bin/git` with `-C <fixed worktreeRoot> -c core.fsmonitor=false -c core.hooksPath=/dev/null`, bounded argv allowlist of the commands below, no arbitrary ref/path/command from the model. Environment from dedicated Owner launch only, fixed `PATH=/usr/bin:/bin`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_OPTIONAL_LOCKS=0`, `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`; do not inherit GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE/GIT_CONFIG_COUNT, alternate object directory, credential, proxy, external diff or other uncontrolled Git env. Read-only commands only, no external diff/textconv, no Git writes. Fail on unapproved repository config that can invoke external helpers or alter comparison semantics; inspect `git config --local --no-includes --null --list` read-only, reject includes, filter commands, external diff, fsmonitor override, submodule helpers, sparse checkout and all non-allowlisted config keys. For the initial dedicated simple Git repository, allow only core.repositoryformatversion=0, core.bare=false, core.filemode and core.logallrefupdates (true/false), optional core.ignorecase=false and core.symlinks=true/false, user.name/email (nonempty), remote.origin.url/fetch and branch.<safe identifier>.remote/merge (inert strings; never log values). Reject all duplicate keys except distinct branch entries with distinct full keys, all includes, extension/worktree/sparse/filter/external-helper keys and unknown keys. A safe, nonsecret dedicated repository/config is an external Owner precondition, not a defense against all malicious local Git configuration. Cap stdout per command 1,048,576 bytes, stderr discarded (drained, bounded), each process 5 seconds, aggregate snapshot deadline 30 seconds. Timeout/abort/oversize terminates only the launched child by process handle, no process-name killing; no retries. Result only exitCode and stdout on normal termination; fixed reason otherwise.

**Command sequence** (`git` means fixed port prefix, not shell interpolation; `<base>` is Owner-fixed lowercase hex, `<head>` validated current HEAD):

| Operation | Exact argv following prefix |
|---|---|
| root / SHA format | `rev-parse --show-toplevel`; `rev-parse --show-object-format` |
| config check | `config --local --no-includes --null --list` |
| HEAD | `rev-parse --verify HEAD` |
| ancestry | `merge-base --is-ancestor <base> <head>` (exit 0 only) |
| status | `status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none` |
| index identity | `ls-files --stage -z` |
| index flags | `ls-files -v -z` |
| tree modes | `ls-tree -r -z <base>`; `ls-tree -r -z <head>` |
| committed diff | `diff --name-status -z --no-renames --no-ext-diff --no-textconv <base> <head> --` |
| staged diff | `diff --cached --name-status -z --no-renames --no-ext-diff --no-textconv <head> --` |
| unstaged diff | `diff --name-status -z --no-renames --no-ext-diff --no-textconv --` |
| untracked paths | `ls-files --others --exclude-standard -z` |

Start check: dedicated standalone repository/checkout, `.git` is a real directory inside worktreeRoot with no shared gitdir/alternates/symlink, root realpath equals Owner root, sha1 format, HEAD exactly base, config/index/tree supported, status empty including nonignored untracked, otherwise DIRTY_BASE/BASE_MISMATCH/GIT_UNSUPPORTED. Reject linked-worktree/shared metadata or alternates at this initial boundary; no configuration edits to repair it. End check: root/format/config, ancestry, HEAD/status/index/flags/tree mode before and after three diffs + untracked. Require byte-identical before/after root, HEAD, status, index, flags, config; compare tree mode snapshots (fixed immutable tree refs). Reject unmerged stage != 0, gitlink 160000, symlink 120000, unsupported mode/type change, skip-worktree flag S or lowercase assume-unchanged, sparse/index ambiguity; no reset/stash/add/clean. NUL decode strict UTF-8, `A/M/D` path pairs only, no rename fallback (no-renames gives old DELETE/new ADD). Untracked ADD; exact kind/path duplicates collapse, distinct kinds same path retained. Sort by path UTF-8 then kind. Existing inspectChangeSet path and 128-entry limits, JSON <=262,144 bytes. Any partial/unknown input → UNAVAILABLE/GIT_LIMIT/GIT_UNSUPPORTED/GIT_UNSTABLE, never fabricate empty PRESENT. The result is a candidate observed-path set, not proof of all changes; ignored paths, intermediate reverted changes, untracked external effects, same-path content race are limitations. During T5 active noncontrol/actual running shell or invalid fixed root prevents claiming a usable Git snapshot; Evidence rejection alone does not erase an independently obtained stable snapshot.

### RED tests

Use `mkdtemp` + Node child_process `execFileSync` in the test-only fixture to initialize a disposable Git repo with local user.name/email, create `src/a.ts`, `src/old.ts`, commit clean base, return `{root,base,config,binding,git,write(path,bytes),runFixtureGit(args),snapshotIdentity(),dispose()}`. `binding` is a T1 fixture re-prepared for this root/base, with actual test clean check. `git` production read port bound to fixture config (no external network). `snapshotIdentity` captures HEAD, index bytes, porcelain output and fixture file bytes independently. Use afterEach cleanup of only test-created temp directory. Spy port tests return exact bounded stdout fixtures for unsupported/unreadable cases.

- [ ] Write failing tests, including:

```typescript
it("keeps independent staged and untracked paths without changing the repo", async () => {
  const f = await makeGitFixture();
  try {
    f.write("src/a.ts", "changed");
    f.runFixtureGit(["add","src/a.ts"]);
    f.write("outside.txt", "new");
    const before = f.snapshotIdentity();
    const result = await collectDailyChangeSet(f.binding,f.git,new AbortController().signal);
    expect(result.state).toBe("VALID");
    if (result.state !== "VALID") throw Error("expected stable fixture");
    expect(result.changeSet.changes).toEqual([{kind:"ADD",path:"outside.txt"},{kind:"MODIFY",path:"src/a.ts"}]);
    expect(f.snapshotIdentity()).toEqual(before);
  } finally { f.dispose(); }
});
```

Add committed ADD/MODIFY/DELETE, rename `src/old.ts`→`outside.txt` (DELETE+ADD), staged+unstaged same path, initial dirty/untracked, unsupported type changes/symlink/gitlink, conflict, non-ancestor, `ls-files -v` flags, root/head/status/index drift, UTF-8/control/traversal invalid, 129 entries and oversize, timeout/cancel. Assert no false empty PRESENT and no mutation. Verify read port exact argv/env/no shell and rejects arbitrary args.

- [ ] RED: `bun run vitest run tests/runtime/daily-changeset.test.ts` → missing entry or wrong expected ChangeSet/UNAVAILABLE; behavioral RED after scaffolding. No environment failure as behavioral proof.
- [ ] Minimum GREEN: implement bounded read port, exact command set and snapshot checks above; use existing path validator. `checkCleanBase` for initial preflight; collect from fixed base only. Distinguish GIT_LIMIT, GIT_UNSTABLE, GIT_UNSUPPORTED, GIT_UNAVAILABLE, ABORTED/TIMEOUT.
- [ ] GREEN: same command → all PASS. Scoped commit: `git add src/runtime/daily-changeset.ts tests/runtime/daily-changeset.test.ts && git commit -m "feat: collect bounded read-only task changeset"`.

## Task 4 — S2-b/S1-d reuse / partial Advisory (AC-D03/D04/D06/D07; RG-004)

**Files:** create `src/runtime/daily-advisory.ts`, `tests/runtime/daily-advisory.test.ts`; add legacy regression in `tests/s2b/adapter.test.ts`. Existing `src/runtime/s2b-offline-adapter.ts` remains unchanged: use its existing validator/projector dependencies directly instead of refactoring a proven v1 orchestration contract. This is a narrowing of the originally proposed extraction, not a new diagnostic architecture.  
**Consumes:** T1 DailyBinding / DailyPreflightPorts / DailyReason / `verifyDailyBinding`; T2 DailyEvidenceResult; T3 DailyChangeSetResult; existing `EvidenceRefV1`, `CoverageStatus` from `core/s1b/contract.ts`, `S2bStatus`, `S2bDiagnostic` from `runtime/s2b-contract.ts`, `S1cDiagnostic` from `core/s1c/contract.ts`, `ScopeFallback`, `S1dReportV1`, `Stage` from `core/s1d/contract.ts`.  
**Produces:** additive Daily-only diagnostic route and safe report; no modification to S1 or S2-b public schema/semantics.

### Contract

```typescript
export type DailyBoundary = "BOUNDED" | "UNCERTAIN" | "NOT_EVALUATED";
export type DailyEvidenceView = Readonly<{
  state:"VALID"; projectionStatus:"PROJECTED"|"LIMITED"; ruleLimited:boolean;
  matchedLocalCompletedHookCount:number; reportedExecutionState:"UNKNOWN"; reportedOutcome:"UNKNOWN";
  coverage:readonly Readonly<{acRef:IntentRef;coverageStatus:CoverageStatus}>[];
  diagnostics:readonly S2bDiagnostic[]; reasons:readonly DailyReason[];
}> | Readonly<{
  state:"UNAVAILABLE"|"REJECTED"|"NOT_EVALUATED";
  diagnostics:readonly S2bDiagnostic[]; reasons:readonly DailyReason[];
}>;
export type DailyScopeView = Readonly<{
  state:"EVALUATED";
  origin:"S1C"|"S1D_SCOPE_FALLBACK";
  comparison:"WITHIN_CANDIDATE_SCOPE"|"OUTSIDE_CANDIDATE_SCOPE";
  outsidePathCount:number; formalVerdictAvailable:false;
}> | Readonly<{
  state:"NOT_EVALUATED"; comparison:"UNKNOWN";
  reason:DailyReason|Extract<ScopeFallback,{state:"NOT_EVALUATED"}>["reason"];
}>;
export type DailyReportFields = Readonly<{
  schemaVersion:"justice-daily-advisory-v1";
  taskRef:IntentRef|null; scopeKey:string|null; boundary:DailyBoundary;
  evidence:DailyEvidenceView; scope:DailyScopeView;
  changeSetOrigin:"GIT_READ_ONLY"|"UNAVAILABLE";
  nativeDiffProjection:"UNAVAILABLE";
  formalVerdict:"UNKNOWN"; ownerAuthorityStatus:"NOT_PROVEN";
  coverageCompleteness:"NOT_ESTABLISHED";
  reasons:readonly DailyReason[]; s1cCodes:readonly S1cDiagnostic["code"][];
  limitations:readonly string[];
}>;
export type DailyAdvisoryReport =
  (Readonly<{state:"DIAGNOSED"}> & DailyReportFields)
  | (Readonly<{state:"LIMITED"}> & DailyReportFields)
  | (Readonly<{state:"UNAVAILABLE"}> & DailyReportFields);
export type DailyProjection = Readonly<{
  state:"VALID"; refs:readonly EvidenceRefV1[];
  projectionStatus:"PROJECTED"|"LIMITED"; ruleLimited:boolean; diagnostics:readonly S2bDiagnostic[];
  reasons:readonly DailyReason[];
}> | Readonly<{state:"REJECTED";diagnostics:readonly S2bDiagnostic[];reasons:readonly DailyReason[]}>
  | Unavailable;
export type DailyDiagnosticPort = typeof runS1dDiagnostic;
export function projectDailyEvidence(binding:DailyBinding,evidence:DailyEvidenceResult):DailyProjection;
export function makeDailyUnavailable(reason:DailyReason):DailyAdvisoryReport;
export function markDailyBoundaryUncertain(
  report:DailyAdvisoryReport,reason:DailyReason,options?:Readonly<{afterReturn?:boolean}>
):DailyAdvisoryReport;
export function runDailyAdvisory(
  binding:DailyBinding, evidence:DailyEvidenceResult, changes:DailyChangeSetResult,
  boundary:DailyBoundary, preflight:DailyPreflightPorts, signal:AbortSignal,
  runS1d?:DailyDiagnosticPort
):Promise<DailyAdvisoryReport>;
```

`DailyDiagnosticPort` is a test seam only; production uses the imported `runS1dDiagnostic` from `runtime/s1d-diagnostic.ts`. It never accepts a model-provided function. `makeDailyUnavailable` uses null task/scope, NOT_EVALUATED evidence/scope, changeSetOrigin UNAVAILABLE, fixed labels, reason only. `markDailyBoundaryUncertain` never introduces new evidence; if already valid scope, keep it with `boundary=UNCERTAIN`; change DIAGNOSED→LIMITED, leave LIMITED/UNAVAILABLE unchanged, except (implementation ruling, design §4.4 binding) that before publication a LIMITED report with neither VALID evidence nor an EVALUATED scope left becomes UNAVAILABLE; after a report was already returned (TERMINAL taint, `{afterReturn:true}`) design §4.3 keeps LIMITED. Late observation makes evidence unavailable for completion claims (set evidence UNAVAILABLE with LATE_OBSERVATION while keeping bounded known scope); returned prior report cannot be retroactively withdrawn. If binding itself becomes invalid, return fresh BINDING_INVALID report, not cached previous results.

**Projection reuse:** recheck bindingKey, raw wrapper/correlation digests and caps and copy bytes, invoke existing validateS2bSource → validateS2bCorrelation → projectS2bEvidence once. Recheck projected scope task/revision/scope and every ref's selected AC against the T1 frozen intent; mismatch → REJECTED. Treat existing projector REJECTED as zero accepted refs and never use rejected refs. Keep exact S2-b projectionStatus, diagnostics counts and separate ruleLimited flag from T2. `MATCHED_REF_PRESENT` is ref presence only, not proof of execution or test success. Never convert TEST_INVOCATION into an AC pass. Expose only the count of accepted locally matched refs (matchedLocalCompletedHookCount), with the existing local reportedExecutionState/Outcome UNKNOWN; do not claim actual test success. If any projected ref has an unexpected execution/outcome or provenance label, reject the Daily projection rather than changing legacy semantics. Native source can be accepted with no matched refs; only that actual accepted empty projection may be encoded as `[]`. Do not modify `runS2bOfflineAdapter` or expose a new v1 diff field. `reportedOutcome` remains the existing UNKNOWN, not a test pass.

**Exact invocation path:** revalidate binding before any diagnosis. If invalid/aborted return unavailable, S1-d call count 0. Revalidate changes via existing `inspectChangeSet`; treat invalid as UNAVAILABLE. If no valid projection and no valid Git, return UNAVAILABLE, call count 0. Otherwise build Daily-only virtual source using `binding.source` for the three fixed loader inputs and selected artifacts; reserved paths `daily://evidence` and `daily://changeset` never alias the approved inputs. For valid projection serve JSON refs, cap 1,048,576 bytes; otherwise evidence read throws `Error("unreadable")`, not `[]`. For valid Git serve bounded ChangeSet JSON; otherwise serve `{"availability":"UNAVAILABLE"}`. Invoke existing `runS1dDiagnostic({loaderInput:binding.config.loaderInput,evidencePath:"daily://evidence",changesetPath:"daily://changeset"}, source)` exactly once. Source only returns fresh copies; no disk writes. Reuse S1-d's own captured Plan and `computeScopeFallback`; do not implement a second Scope algorithm. Verify returned S1-a identity still matches binding, revalidate package/runtime before publication, observe abort; mismatch → fresh BINDING_INVALID/ABORTED and suppress stale output. S1-d unexpected exception → UNAVAILABLE/DIAGNOSTIC_UNAVAILABLE; no retry. All reports preserve fixed labels, no raw report serialization to model (project only safe codes/counts and safe task/AC refs).

| Binding / evidence / Git | Overall | Evidence view | Scope view / S1-d calls |
|---|---|---|---|
| valid / VALID / VALID, both evaluated and bounded | DIAGNOSED if projection and rules not limited | VALID | S1C, candidate result / 1 |
| valid / VALID but projection or rule limited / VALID | LIMITED | VALID, actual projectionStatus + ruleLimited | S1C, candidate result / 1 |
| valid / UNAVAILABLE / VALID | LIMITED | UNAVAILABLE | S1D_SCOPE_FALLBACK if available / 1 |
| valid / REJECTED / VALID | LIMITED | REJECTED, reason retained | S1D_SCOPE_FALLBACK if available / 1 |
| valid / VALID / UNAVAILABLE | LIMITED | VALID | UNKNOWN / 1 |
| invalid / any / any | UNAVAILABLE | NOT_EVALUATED | UNKNOWN / 0 |
| valid / UNAVAILABLE or REJECTED / UNAVAILABLE | UNAVAILABLE | respective reason | UNKNOWN / 0 |

S1-d stage skipped/rejected/baseline unknown → LIMITED if any independent diagnostic remains, UNAVAILABLE if neither remains. When S1-b stage is EVALUATED with evaluationStatus EVALUATED, copy only safe AC refs and coverageStatus into evidence.coverage; when INPUT_REJECTED, expose evidence REJECTED with SOURCE_REJECTED and no coverage; when BASELINE_UNKNOWN or NOT_EVALUATED expose evidence UNAVAILABLE/DIAGNOSTIC_UNAVAILABLE with no coverage (if binding is invalid, return BINDING_INVALID and both NOT_EVALUATED instead). `s1cCodes` contains only actual S1-c codes; fallback uses its own scope origin and limitation, not fabricated S1-c codes. For fallback, preserve `formalVerdictAvailable:false`, add limitation `NO_FORMAL_S1C_RESULT`; if fallback itself is NOT_EVALUATED, retain reason/UNKNOWN. Always keep `OUTSIDE_CANDIDATE_SCOPE` + count even if Evidence missing, unless the binding itself is invalid. Boundary uncertainty never permits DIAGNOSED. T5 independently decides whether Native Evidence is usable; it can pass UNAVAILABLE while retaining independently stable Git. Git identity/quietness failure itself makes Git unavailable, not merely Source rejection. Result `DIAGNOSED` is never formal PASS.

### RED tests

Use T1 fixture READY binding. Create local `makeAdvisoryFixture()` returning `{binding, preflight, validEvidence, missingEvidence, rejectedEvidence, validGit, missingGit}`. Build validEvidence from T2 `buildSource` raw wrapper with fixture local shell r1 exact (`executed:false`), fixed bindingKey and SHA-256 for wrapper and Correlation for `task-1@R1 / scope-1 / ac-1@R1`; r2 intentionally missing gives accepted limited evidence. `missingEvidence={state:"UNAVAILABLE",reason:"SOURCE_UNAVAILABLE"}`; `rejectedEvidence={state:"REJECTED",reasons:["SOURCE_REJECTED"],diagnostics:[{code:"SOURCE_SCHEMA_INVALID",count:1}]}`; `validGit={state:"VALID",baseCommit:f.approval.baseCommit,headCommit:f.approval.baseCommit,changeSet:{availability:"PRESENT",changes:[{kind:"ADD",path:"outside.txt"}]}}`; `missingGit={state:"UNAVAILABLE",reason:"GIT_UNAVAILABLE"}`. Use existing real `runS1dDiagnostic` via `vi.fn(runS1dDiagnostic)` rather than a mock result for fallback test. Test legacy using existing `adapterFixture` with rejected native source and spy diagnostic; expect no `s1d` field.

- [ ] Write failing tests. Minimal code:

```typescript
it("keeps known scope deviation when native evidence is rejected",async()=>{
  const f=await makeAdvisoryFixture(); const run=vi.fn(runS1dDiagnostic);
  const report=await runDailyAdvisory(f.binding,f.rejectedEvidence,f.validGit,
    "BOUNDED",f.preflight,new AbortController().signal,run);
  expect(run).toHaveBeenCalledTimes(1);
  expect(report.state).toBe("LIMITED");
  expect(report.evidence.state).toBe("REJECTED");
  expect(report.scope).toEqual({state:"EVALUATED",origin:"S1D_SCOPE_FALLBACK",
    comparison:"OUTSIDE_CANDIDATE_SCOPE",outsidePathCount:1,formalVerdictAvailable:false});
  expect(report.formalVerdict).toBe("UNKNOWN");
  expect(report.ownerAuthorityStatus).toBe("NOT_PROVEN");
});
it("does not diagnose an invalid intent even with valid git",async()=>{
  const f=await makeAdvisoryFixture(); const run=vi.fn(runS1dDiagnostic);
  const ports={...f.preflight,reloadOwnerConfig:async()=>({state:"OFF" as const,reason:"APPROVAL_DIGEST_MISMATCH" as const})};
  const r=await runDailyAdvisory(f.binding,f.validEvidence,f.validGit,"BOUNDED",ports,new AbortController().signal,run);
  expect(run).not.toHaveBeenCalled(); expect(r.state).toBe("UNAVAILABLE");
  expect(r.scope.comparison).toBe("UNKNOWN"); expect(r.evidence.state).toBe("NOT_EVALUATED");
});
```

Add table tests for all seven rows, mutated wrapper/correlation digest or bindingKey rejects projection, within-scope `src/a.ts`, missing AC (`AC_EVIDENCE_REF_MISSING` when S1-c evaluated), foreign binding/malformed Source, accepted empty refs vs missing read, fallback unavailable, Git invalid, S1-d exception, canceled/changed binding before publication. Assert formal UNKNOWN/NOT_PROVEN/NOT_ESTABLISHED, nativeDiffProjection UNAVAILABLE always; no raw paths, raw IDs, secret fixture token, error text or arbitrary content. Test legacy rejected: `runS2bOfflineAdapter` returns adapter.status REJECTED, diagnostic spy count 0, no `s1d`, old JSON/text exactly unchanged; original full S2-b regression suite.

- [ ] RED: `bun run vitest run tests/runtime/daily-advisory.test.ts tests/s2b/adapter.test.ts` → missing new entry or wrong partial scope/result; legacy tests remain GREEN. Behavioral RED required before implementation.
- [ ] Minimum GREEN: additive route above using existing shared validators/projector and S1-d, no second evaluation or new Gate. Preserve known scope on Evidence missing/rejected; binding invalid stops both; use the existing missing-evidence read error path to activate Scope Fallback. No changes to v1 adapter source/report.
- [ ] GREEN: same command + `bun run vitest run tests/s2b tests/runtime/s1d-diagnostic.test.ts` → all relevant tests PASS. Scoped commit: `git add src/runtime/daily-advisory.ts tests/runtime/daily-advisory.test.ts tests/s2b/adapter.test.ts && git commit -m "feat: connect native evidence and git scope to daily advisory"`.

## Task 5 — Native × Superpowers explicit boundaries / production wiring (AC-D05/D07/D08; RG-001/RG-003)

**Files:** create `src/runtime/daily-superpowers.ts`, `tests/integration/opencode-v2-daily-advisory.test.ts`; modify `src/opencode-v2-plugin.ts`. README only if required for accurate new usage; no V1/exports/SDK/dependency change.  
**Consumes:** T1–4 exact exports; fixed `Plugin.Context`, Promise `ToolContext`, SDK `ToolInfo`, `SkillDomain.list`, `Registration`.  
**Produces:** actual opt-in supply wiring, single-task coordinator, explicit direct begin/finish tools, Native before/after registration, fixed Skill delivery hook (built-in `skill` Tool `execute.after`) and cleanup.

### Contract

```typescript
export type DailyLifecycle = "ARMED"|"STARTING"|"ACTIVE"|"FINISHING"|"TERMINAL"|"DISPOSED";
export type BoundaryCall = Readonly<CallIdentity & {agent:string;signal:AbortSignal}>;
export type DailyBeginResult = Readonly<{state:"READY";bindingKey:string}>
  | Unavailable;
export interface DailyCoordinatorPorts {
  readonly config:DailyOwnerConfig;
  readonly preflight:DailyPreflightPorts;
  readonly native:NativeReadPort;
  readonly git:DailyGitReadPort;
  isSkillReady():boolean;
  // Internal diagnostic seam only. Production binds the actual imported function.
  diagnose:typeof runDailyAdvisory;
}
export interface DailyCoordinator {
  getState():DailyLifecycle;
  isActive(sessionId:string):boolean;
  begin(call:BoundaryCall):Promise<DailyBeginResult>;
  observe(event:NativeObservation):void;
  finish(bindingKey:string,call:BoundaryCall):Promise<DailyAdvisoryReport>;
  dispose():void;
}
export type DailyRuntimeResult = Readonly<{
  state:"READY"; ports:DailyCoordinatorPorts;
  markSkillReady(ready:boolean):void;
}> | Readonly<{state:"OFF";reason:DailyReason}>;
export function createDailyCoordinator(ports:DailyCoordinatorPorts):DailyCoordinator;
export function createProductionDailyPorts(context:Plugin.Context):Promise<DailyRuntimeResult>;
export function registerDailyAssurance(
  context:Plugin.Context, runtime:Extract<DailyRuntimeResult,{state:"READY"}>
):Promise<Readonly<{state:"REGISTERED";dispose:()=>Promise<void>}>|Readonly<{state:"OFF";reason:DailyReason}>>;
```

`createProductionDailyPorts` is the only default production supply; it captures `process.env[DAILY_APPROVAL_ENV]` (no arbitrary root, port injection or tool arguments), uses fixed OwnerConfigReadPort built in this file: `/proc/self/mountinfo` verify exact mountpoint `DAILY_OWNER_ROOT`, ro mount flags, no nested mounts, fixed realpath/non-symlink mount directory, dedicated external Owner boundary. `readApproval` calls existing `createS1aReadOnlySource().readInputFile(DAILY_OWNER_ROOT+"/approval.json",65536)`; before/after mount check and signal. Use the same existing reader constrained to fixed manifest/intent/artifact root, no arbitrary absolute input paths. `verifyRuntime` rechecks mount, `context.location.directory` realpath, process executable SHA-256 from `/proc/self/exe` (bounded streaming read, 512MiB/10s max), fixed hash/host, dedicated launch prerequisites. `reloadOwnerConfig` uses captured expected digest, requires current environment still equals it. `checkCleanBase` calls T3 actual function. Native/Git ports constructed from config via T2/T3 constructors. `diagnose=runDailyAdvisory`, `isSkillReady` private initially false. Before returning READY, call verifyRuntime with the same config under a 30s setup deadline; failure is OFF with the corresponding reason. Any failed supply returns OFF, never instantiate daily coordinator with a test port in default production. Trust of the launcher/read-only package remains externally established, not cryptographic authentication. No reading shared config or Credential. Setup and runtime callbacks do not load a model provider or execute the approved command themselves.

Existing `createJusticeV2Plugin` keeps existing `createAdapter` seam. Add an internal optional `createDailyRuntime?: (context:Plugin.Context)=>Promise<DailyRuntimeResult>` to its factory dependencies only for tests; default production path binds `createProductionDailyPorts`. Do not add it to the public default export interface or tools. Existing `justice_review` registration/resolve behavior unchanged. If daily config OFF, keep that registration only. If daily registration fails, dispose only its handles; keep legacy V2 tool and fail-open Host behavior. On full plugin cleanup, dispose daily first then existing review handle. No `context.credential`, no shell action to stop Host, no auto Task.

### State and boundary algorithm

All state transitions, in-flight map updates, taint flag, epoch counter, promise reservation and terminal cache assignment are synchronous before first await. Key maps use tuple serialization of `(sessionId,messageId,callId)` (no delimiter collision). Capacity 4,096 observations including control/pre/post; reject further storage, mark `OBSERVATION_LIMIT`. Only exact fixed Session is tracked; foreign controls return SESSION_MISMATCH without state mutation. Reject invalid raw ToolContext identity, absent/mismatched key, unavailable Skill and invalid tool schema with fixed reason, never expose exception text. `isActive` true only for ACTIVE and exact config.sessionId.

- **ARMED:** before/after hooks track active calls from setup (not AC candidates), distinguish control names from actual matching context identities. Begin requires empty input object, approved actual Session, unique begin call, no other active tool/control; reserve STARTING immediately. Verify fixed approval/binding, initial clean base, no running shells, read Native begin snapshot exactly once; require checkBeginPrefix. Any pending/late noncontrol while STARTING, abort, cap, mismatch → TERMINAL with UNAVAILABLE. On success cache binding/private prefix/begin ID and ACTIVE; begin `after` must match its own tracked control and complete before finish. No second Task per process. A duplicate begin (same or different call) cannot create a second binding; return BUSY while STARTING/ACTIVE, ALREADY_TERMINAL after terminal. Setup readiness failure is NOT_OBSERVED/SKILL_UNSUPPORTED, not a successful empty binding.
- **ACTIVE observe:** pair BEFORE then AFTER by full tuple; exact duplicate same phase/data is ignored, conflicting same phase, unknown after, changed tool/rule, nonterminal missing after at finish or pre/post identity reused taints relevant boundary. `ruleId` only derived while ACTIVE, using `matchRuleInput` on known scalar fields. All other tools (including execute and nested tools) tracked for quietness, not mapped to an AC unless direct shell exact stored part. Control names `justice_task_begin`, `justice_task_finish`, `justice_review` excluded from AC candidates; `justice_review` still counted for in-flight quietness like non-boundary work. If tool identity aliases differ, never silently remap. No observer returns an approval or throws to cancel Host execution.
- **Finish:** exact key and context, ACTIVE only, synchronous transition FINISHING and reserve shared Promise before any read. If begin not settled, other active work/unknown pending/tainted boundary, do not wait/retry; report UNCERTAIN. When noncontrol work is actually in flight, or shell list indicates running/unverified quietness, Git is UNAVAILABLE rather than claiming a stable end state. Otherwise independently collect stable Git even if Native Source is rejected/unavailable, subject to fixed root/epoch/quiet checks. Bounded finish sequence: verify binding/skill, shell list check, Native snapshot A, Git snapshot, Native snapshot B, shell list check; validate marker and epoch, invoke T4 once, check no new observations since seal and revalidate binding before publishing. Source failures do not automatically invalidate Git; Source mismatch invalidating the fixed binding itself invalidates both. If A or B rejected preserve safe REJECTED diagnostics, if unavailable mark UNAVAILABLE; accepted but unstable/incomplete marker/epoch → Evidence UNAVAILABLE/BOUNDARY_UNCERTAIN. `checkFinishBoundary` and source pair comparison only count a bounded observation point, not future actions/OS processes. If a late/new noncontrol hook occurs before result publication, invalidate Native evidence; if it overlaps the Git collection/quiet proof, Git too. Do not invoke diagnosis a second time: retain a previously valid independent scope only when the Git snapshot's own validity was established, downgrade/report missing evidence, else return unavailable. If late hook after diagnosis and before publish cannot preserve known validity, fail closed.
- **Duplicate finish:** same tuple while FINISHING returns existing Promise; a different matching Session/key CallID before first settles marks `BOUNDARY_UNCERTAIN` and also shares Promise (no second collection). Foreign/key mismatch returns unavailable without modifying active result. In TERMINAL, reject foreign session/key as above. Before returning a cached Advisory for a matching session/key, call existing T1 `verifyDailyBinding(binding, ports.preflight, signal)` with the original binding and the matching call/lifetime signal under the existing finish deadline; recheck Owner package / captured external digest, Runtime identity, Manifest / Intent bytes and digests, selected Artifact bytes and digests, and Scope Policy against the current fixed read-only supply. No check limited to approval/runtime or private snapshots alone is sufficient. Only OK permits returning a valid cached report. A mismatch or verification failure returns fresh `makeDailyUnavailable("BINDING_INVALID")` (state UNAVAILABLE, reason BINDING_INVALID, both evidence/scope NOT_EVALUATED), invalidating the cached result so it cannot later be promoted again. With no established binding, return only the existing safe unavailable result, never a valid cache. Preserve existing abort/dispose behavior, check lifetime/state and latest taint after the await before publishing, and do not republish an invalidated cached result. If any relevant late hook after publication, mark cached result boundary UNCERTAIN via T4 helper, evidence unavailable; valid historical scope remains only with verified binding and its original bounded snapshot. Returned prior report cannot be revoked. No new Native Evidence/Git ChangeSet acquisition, S1-d diagnosis, Task execution, initial clean check or new verification mechanism occurs on the TERMINAL path. A TERMINAL result is never persisted as Task success or restarted automatically.
- **Abort and dispose:** first matching control signal + lifetime signal + fixed deadlines (begin 45s; finish 90s total; nested limits T2/T3). An aborted matching duplicate waiter also aborts the shared operation; unrelated callers cannot cancel. Abort immediately marks operation ABORTED, no new I/O; await in-flight settlement bounded, suppress late result. `dispose` synchronously DISPOSED, abort lifetime, clear private data, refuse all calls; no new Task, no state replay. `finish` before begin returns NOT_OBSERVED. If hook/cleanup exception occurs, report fixed code only, preserve Host flow and do not manufacture success.

### SDK registration and Skill contract

Register in exact order: `context.tool.hook("execute.before", ...)`, `context.tool.hook("execute.after", ...)`, daily `context.tool.transform(...)`, then the Skill delivery hook `context.tool.hook("execute.after", ...)` (second registration). Store each `Registration` only on success. Before callback copies SDK `sessionID`, `messageID`, `id`, `tool` to envelope; after copies same + `status`. No mutation of SDK payload; use `matchRuleInput` only if coordinator.isActive and exact shell name; discard raw payload immediately. Errors caught inside callbacks, taint fixed boundary, no throw-to-cancel. Observer must be active before begin; setup failure/cleanup stops only additions. Registration state REGISTERED does not establish Skill readiness or a bound Task; coordinator state remains ARMED until begin succeeds. Tool registration is two direct `ToolInfo` (`options:{codemode:false}`, JSON Schema object, additionalProperties false): begin has no properties; finish has required `bindingKey` 64 lowercase hex. Validate unknown input again in execute, reject extra props. `ToolContext` actual sessionID/messageID/id/agent/signal used to create `BoundaryCall`. Return `{content: JSON.stringify(safeResult)}`; no raw payload, no arbitrary path/port/authority input. Direct Tool availability static SDK supports; actual catalog/dispatch verified T6. If direct tools not exposed, stop affected path; don't nest them inside execute.

Skill delivery (Issue #401: `skill.transform` is NOT used because upstream replays transforms in registration order and package plugins run before the internal `ConfigSkillPlugin`): in the Skill hook, ignore any call whose tool is not `skill`; require SDK `sessionID` to equal approval.sessionId (missing/invalid/other Session → return before `skill.list()`, any result mutation or readiness change); ignore other Skill IDs; for the approved ID with status `completed`, call official `context.skill.list()` and require exactly one matching `id/name/path` whose SHA-256 of UTF-8 `content` equals approval.skill.contentSha256, and a delivered `result.content` that is the `<skill_content name=...>` block embedding that content. Insert `fixedAppend` once before `</skill_content>` (also into `result.output.content` when identical); never edit the Skill list or SKILL.md. An already appended result is not duplicated. Any mismatch, missing Skill, `list()` failure or non-completed status of the approved Skill → markSkillReady(false), no begin; unrelated Skills and other Sessions are never modified. `markSkillReady(true)` only after the append was applied to the delivered result; readiness is re-evaluated at each later approved-Skill delivery and revoked at dispose (in-flight deliveries after dispose cannot restore it). Known limits: direct Skill attachment is unsupported (readiness stays false), no continuous Skill watching, a race window remains between `skill.list()` and delivery, pilot uses the fixed read-only Skill. If readiness later lost, finish must be unavailable/limited rather than claim success. `fixedAppend` is exactly the following instruction (newline delimiter before it; no arbitrary Owner or model interpolation):

```text
## Justice Daily Assurance (Owner opt-in; advisory only)
Before the approved inline Task's first implementation action, call the direct
justice_task_begin tool with {} in its own assistant tool-call message, not
inside execute and not in parallel. Keep the returned bindingKey only if READY.
Use only the pre-approved direct shell invocation for AC evidence; do not start
child sessions, detached/background jobs, or concurrent tasks. Follow the
existing executing-plans workflow unchanged. At the existing task-done candidate
boundary, after all task tools have settled, call the direct justice_task_finish
with that bindingKey in its own assistant tool-call message, not inside execute
or in parallel. Treat returned diagnostics as advisory, never as formal PASS.
If unavailable, preserve the limitation; follow existing safety/Owner boundaries.
Do not start an extra review, fix, retry, or approval cycle because of this tool.
```

The actual approved commands remain in Owner-approved Task/Plan inputs; the Skill hook does not insert secret command text. The model may omit/misuse the instructions; report NOT_OBSERVED, not assurance. If the registered SDK name/id/content contract cannot be met, do not invent another Skill integration. Cleanup reverse order: mark coordinator DISPOSED first, `skill hook.dispose`, `daily tool.dispose`, `after.dispose`, `before.dispose`. Partial setup rollback only acquired handles; each attempted exactly once, continue best effort if one cleanup fails, report fixed CLEANUP_FAILED; existing review handle unaffected until full plugin unload. If no existing visible diagnostic channel is available, cleanup failure is an internal fixed-code status and live cleanup remains unverified; do not claim a model-facing warning was delivered. No auto-reload or Host-level kill.

### RED tests

Use `makeDailyFixture` and fixed fake Native snapshots from T2, fake Git port from T3; integration test `makeCoordinatorFixture()` builds `{coordinator,call,beginCall,finishCall,observePair,diagnose,gate,nativeReads,gitReads,preflight}` with actual `createDailyCoordinator` and stub ports; `call(messageId,callId,sessionId=fixture session,signal=new AbortController().signal)` produces BoundaryCall, `beginCall=msg_001/tool_begin`, `finishCall=msg_003/tool_finish`; `gate` deferred Promise used by fake native GET to interleave async finish, no real timers/network. `observePair` emits exact before/after of fixture direct shell and control hooks. `diagnose=vi.fn(runDailyAdvisory)` using actual fixture virtual source; fake status and snapshots are explicit. For setup tests extend fake SDK pattern in existing `tests/integration/opencode-v2-plugin-hooks.test.ts`: track registrations and dispose order; fake skill editor initially one exact `id/name/path/content`, fake tool editor records add; never access real Credential. Test seam injects runtime only into factory, verify default no env → no Daily registration.

- [ ] Write failing tests, including:

```typescript
it("does not diagnose twice or promote a concurrent finish",async()=>{
  const f=await makeCoordinatorFixture();
  const start=await f.coordinator.begin(f.beginCall);
  expect(start.state).toBe("READY");
  if(start.state!=="READY") throw Error("fixture begin failed");
  f.observePair();
  const a=f.coordinator.finish(start.bindingKey,f.finishCall);
  const b=f.coordinator.finish(start.bindingKey,f.call("msg_004","tool_finish2"));
  f.gate.resolve(); const [ra,rb]=await Promise.all([a,b]);
  expect(f.diagnose.mock.calls.length).toBeLessThanOrEqual(1);
  expect(ra.state).not.toBe("DIAGNOSED"); expect(rb.state).not.toBe("DIAGNOSED");
});
it("does not accept an after-only or unfinished tool as evidence",async()=>{
  const f=await makeCoordinatorFixture();
  const start=await f.coordinator.begin(f.beginCall);
  if(start.state!=="READY") throw Error("fixture begin failed");
  f.coordinator.observe({sessionId:f.beginCall.sessionId,messageId:"msg_002",callId:"tool_late",
    tool:"shell",phase:"AFTER",status:"COMPLETED",ruleId:"r1"});
  const r=await f.coordinator.finish(start.bindingKey,f.finishCall);
  expect(r.state).not.toBe("DIAGNOSED"); expect(r.evidence.state).not.toBe("VALID");
  expect(r.formalVerdict).toBe("UNKNOWN");
});
```

Fixture harness emits the corresponding before/after for begin and finish control calls (begin after before finishing); the second test uses immediate fake reads (not deferred gate). Add concrete tests: OFF registers only existing tool; missing/mutated Owner mount/digest/host disables daily; self-supplied begin params or wrong key/session rejected; direct tool options false and actual context used; valid normal task yields once; beginning twice; pre-begin after and post-finish Tool excluded; duplicate identical hook idempotent, contradictory/foreign IDs, incomplete source, 4,097 observations, pending shell list, concurrent noncontrol during STARTING/FINISHING, direct finish same assistant other tool, late hook after terminal downgrades without second diagnosis; abort while waiting, dispose while collecting, no late publication; exact skill only, unsupported digest/name/path, Skill not yet delivered, repeated delivery no appended duplicates, other/missing/invalid sessionID never delivers, lists or changes readiness, dispose blocks in-flight delivery, upstream transform-order simulator (Justice registered before ConfigSkillPlugin); partial setup failure at each registration and inverse cleanup, cleanup failure fixed code, existing justice_review retained. Test Source rejected+valid independent Git fallback via real T4, not false global unavailable. Assert no shared filesystem writes, no credential/LLM/extra review/resolve/replay, all flags unchanged. Test actual Production default uses fixed root and env only via bounded FS/env stubs; passing a fake context with arbitrary options does not select approval provider. Also include the RG-001 TERMINAL regression in this existing RED test set: expose the underlying `makeDailyFixture().setArtifactBytes` on `makeCoordinatorFixture()` (reuse the same mutable fixture source behind `preflight.source`). Complete a valid normal fixture Task once (settled begin/shell/finish, release the fake gate), require DIAGNOSED and TERMINAL, record the existing Native/Git read and `diagnose` call counts. With the binding unchanged, a matching TERMINAL finish returns the cached valid report after the existing verification. Then replace selected `plan-1.md` bytes via `setArtifactBytes("plan-1.md", new TextEncoder().encode("changed"))` without changing the approval/digests, and call finish again with the same bindingKey/Session. Assert `state === "UNAVAILABLE"`, `reasons` includes `"BINDING_INVALID"`, both evidence and scope are NOT_EVALUATED, and `formalVerdict === "UNKNOWN"`. Assert no Native/Git read or `diagnose` count increases on either TERMINAL lookup, no Task re-execution and no stale valid result, including subsequent matching lookups after invalidation. Existing T1 verification reads the current selected Artifact bytes; do not mock a new verifier. Expected behavioral RED: approval/runtime-only recheck returns a stale DIAGNOSED result after Artifact mutation. GREEN requires existing T1 `verifyDailyBinding` to prevent that result. Fixture-level success is not real Host validation.

- [ ] RED: `bun run vitest run tests/integration/opencode-v2-daily-advisory.test.ts` → absent daily registration/coordinator or wrong state/cleanup/fallback; retain behavioral RED after compilation. Existing V2 tests not required to fail.
- [ ] Minimum GREEN: implement fixed production ports, synchronous coordinator state machine and direct boundary tools, SDK before/after and exact Skill delivery hook. Reuse T1 `verifyDailyBinding` for each TERMINAL cached Advisory return as specified above; fail closed with BINDING_INVALID on mismatch, without new Native/Git acquisition or diagnosis. No alternative workflow, no new review dispatcher; preserve existing V2 entry. Stop on SDK mismatch rather than invent new auth or Tool mapping.
- [ ] GREEN: same command + `bun run vitest run tests/integration/opencode-v2-plugin-contract.test.ts tests/integration/opencode-v2-plugin-hooks.test.ts tests/integration/opencode-v2-plugin-coverage.test.ts tests/s2b tests/runtime/daily-intent.test.ts tests/runtime/daily-native-evidence.test.ts tests/runtime/daily-changeset.test.ts tests/runtime/daily-advisory.test.ts` → all scoped tests PASS. `bun run typecheck`, `bun run lint`, `git diff --check` exit 0; full suite once if authorized and environment available, identify existing failures instead of repeated run. Scoped commit: `git add src/runtime/daily-superpowers.ts src/opencode-v2-plugin.ts tests/integration/opencode-v2-daily-advisory.test.ts` (plus `README.md` only if changed and within scope), `git commit -m "feat: integrate daily advisory with native superpowers task boundaries"`. Push/PR separately authorized.

## Task 6 — One bounded practical pilot (AC-D01–08; separate Host GO)

S5 Runbook再利用。開始前に固定binary/plugin/Skill digest、専用worktree/session/state/config、Owner read-only mount+外部approval digest、direct shell/control公開条件、Provider/Credential/egress境界、費用/時間上限、証拠保存先、停止/切戻しを明示。秘密をチャットに提示しない。条件不成立時はlive HOLD、offline成果まで報告。固定Source/API・actual Hook CallID↔保存part.id、exact shell inputとlocal executed=false flag、direct controls、Skill配信（Preflight: `/api/skill` で元Skillの固定Identity確認 → Prompt → 直接 `skill` Tool呼出し → モデルに渡る配信結果で固定指示文を確認 → `justice_task_begin` → Task実行 → `justice_task_finish`）、shell静止・境界を実Hostで確認する。local `executed:false` が得られない場合（true/欠測を含む）、推測で昇格せず該当ruleを未帰属にする。既存S2-bのlocal reportedExecutionState/Outcome UNKNOWNを維持する。固定SDKで経路が成立しなければOwnerへ報告して停止。別方式を自動採用しない。

- [ ] 別Owner GO後のみ、正常Taskと意図的な不足Evidence/Scope逸脱Taskを専用使い捨てrepoで各1回実行。それぞれ別の専用Session/Process・事前承認packageを固定し、同一processに複数Taskを詰め込まない。Ownerによる必要なSession事前作成は承認された境界内のみ、Task開始前に終了。既存Superpowers flowと実Native hook/catalog/ToolContext/Sourceを使用。事前に期待diagnosticsを固定し、再実行なし。通常の外部LLM Providerを利用する場合はその境界の明示承認が必要。
- [ ] 実測でTask begin/finish・Source帰属・ChangeSet・既存S1-d・Advisory・欠測非昇格・通常flow非干渉を確認。正常のcandidate withinと異常のoutside scope + missing/rejected evidenceを区別して観測、Tool completedを試験PASSとしない。漏れと実行失敗を区別、費用/時間/付加価値は観測として記録。Native-only統計的優位性は主張しない。raw Native payloadは永続化/転送せず、safe reason/count/digestと事前固定Identityのみ証拠にする。
- [ ] 専用runtimeのStop/Rollback、追加登録解除、共有State非干渉、証拠保全。AC-D01–08別のPASS/FAIL/NOT_VERIFIEDと限界を報告。Owner Checkpointへ戻る。S5 AC再実証/E1–E3/Release/追加Taskなし。

## Completion / Stop / Handoff

| Finding | Design | Plan | Acceptance coverage |
|---|---|---|---|
| RG-001 | §4.1, §5 | T1 + T5 production supply | AC-D01/D06/D08 |
| RG-002 | §4.2 | T2 exact direct-shell identity + T1 rule | AC-D02/D04/D06 |
| RG-003 | §4.3 | T5 state machine + T2 prefix/boundary | AC-D05/D07/D08 |
| RG-004 | §4.4 | T4 Daily-only fallback + T3 independent Git | AC-D03/D04/D06 |

T1–5 offline成果とT6 live実用確認を分ける。AC-D01–08に対応する実証が揃えばDaily Assuranceの限定利用判断が可能。Plugin loadやtest mockだけで日常運用PASSにしない。包括的意味乖離・完全な証拠網羅・強制予防は対象外。境界/承認不明、未対応契約、危険な副作用、完了時は停止し、Findingだけで範囲を拡張しない。S5限定完成、既存Closed Issue、S4延期、E1/E2/E3 HOLD、Release PENDINGを維持する。

**Current stop:** RG-001の最終限定文書訂正候補作成と対象箇所のReadback確認まで（RG-002〜004は再openしない）。Next: OWNER_DECISION。Human OwnerによるPlan採択・限定実装着手は未承認。Commit/Push/PRは今回の文書保存とは別の明示承認を要する。実装を承認された場合の推奨担当は現在のAI coding agent、`superpowers:executing-plans`。追加独立Review、Build/Test、Source変更、実Host確認、Release、後続Taskの自動開始なし。
