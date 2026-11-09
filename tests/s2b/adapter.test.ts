import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { S1aReadOnlySource } from "../../src/core/s1a/contract.js";
import type { S1dReportV1 as CoreS1dReportV1 } from "../../src/core/s1d/contract.js";
import { runS1dDiagnostic } from "../../src/runtime/s1d-diagnostic.js";
import { formatJson, formatText } from "../../src/core/s1d/formatter.js";
import type { Projection, S1dReportV1, S2bReportV1 } from "../../src/runtime/s2b-contract.js";

// Pass-through projector mock: real implementation unless a test installs a one-shot override
// (used only to forge a foreign Evidence ref and exercise the adapter's own ownership guard).
const projectorHook = vi.hoisted(() => ({ override: null as null | ((real: Projection) => Projection) }));
vi.mock("../../src/runtime/s2b-projector.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/runtime/s2b-projector.js")>();
  return {
    ...actual,
    projectS2bEvidence: (...args: Parameters<typeof actual.projectS2bEvidence>): Projection => {
      const real = actual.projectS2bEvidence(...args);
      return projectorHook.override === null ? real : projectorHook.override(real);
    },
  };
});
afterEach(() => {
  projectorHook.override = null;
});
import {
  S2B_VIRTUAL_CHANGESET_PATH, S2B_VIRTUAL_EVIDENCE_PATH, formatS2bJson, formatS2bText, runS2bOfflineAdapter,
} from "../../src/runtime/s2b-offline-adapter.js";
import {
  type AdapterFixtureSpec, adapterFixture, assistantMessage, buildSource, correlation, diffMember, firstRequest,
  idleMessage, jsonBytes, laterRequest, pageResponse, s1aFixture, sessionAfterMember, sessionResponse as sessionResponseText,
  toolPart, userMessage, validDiffResponse,
} from "./fixtures.js";

type S1dRequest = Parameters<typeof runS1dDiagnostic>[0];
type Call = Readonly<{ request: S1dRequest; source: S1aReadOnlySource }>;

/** Spy runner that delegates to the real S1-d diagnostic and records each invocation. */
function spyRunner() {
  const calls: Call[] = [];
  const runner = vi.fn(async (request: S1dRequest, source: S1aReadOnlySource) => {
    calls.push({ request, source });
    return runS1dDiagnostic(request, source);
  });
  return { runner, calls };
}

const intentReadsOf = (reads: ReadonlyArray<{ path: string }>, intentPath: string): number =>
  reads.filter((r) => r.path === intentPath).length;

describe("S2-b adapter: P-001 frozen TaskIntent snapshot", () => {
  it("selectedIntentAndS1dUseExactlyTheSameBytes", async () => {
    const first = s1aFixture().intent; // ac-1 + ac-2
    const second = { ...first, ac: [{ artifactId: "ac-1", revision: "R1" }] }; // different valid Intent
    const firstBytes = jsonBytes(first);
    const fx = adapterFixture({ intentBytes: [firstBytes, jsonBytes(second)] });
    const { runner, calls } = spyRunner();

    const report = await runS2bOfflineAdapter(fx.request, fx.source, runner);

    // Exactly one underlying read of the TaskIntent, at the S1-a bound.
    expect(intentReadsOf(fx.source.inputReads, fx.paths.intentPath)).toBe(1);
    expect(fx.source.inputReads.find((r) => r.path === fx.paths.intentPath)?.maxBytes).toBe(65_536);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(report.adapter.status).toBe("PROJECTED");
    expect(report.adapter.selectedTaskRef).toEqual({ artifactId: "task-1", revision: "R1" });

    // The bridge returns fresh copies of the frozen original bytes every time S1-d asks.
    const bridge = calls[0]!.source;
    const a = await bridge.readInputFile(fx.paths.intentPath, 65_536);
    const b = await bridge.readInputFile(fx.paths.intentPath, 65_536);
    expect([...a]).toEqual([...firstBytes]);
    expect([...b]).toEqual([...firstBytes]);
    expect(a).not.toBe(b);
    a.fill(0); // mutating a returned copy never affects the snapshot
    expect([...(await bridge.readInputFile(fx.paths.intentPath, 65_536))]).toEqual([...firstBytes]);
    expect(intentReadsOf(fx.source.inputReads, fx.paths.intentPath)).toBe(1); // still no silent second read

    // S1-d used the first Intent (ac-2 selected) — not the second payload.
    const s1a = report.s1d?.stages.s1a;
    expect(s1a?.state).toBe("EVALUATED");
    const selectedIds = s1a?.state === "EVALUATED" ? s1a.result.selectedRefs.map((r) => r.artifactId) : [];
    expect(selectedIds).toContain("ac-2");
  });

  it("sourceBufferMutationAfterReadDoesNotChangeTheSnapshot", async () => {
    const first = s1aFixture().intent;
    const shared = jsonBytes(first);
    const original = Uint8Array.from(shared);
    const fx = adapterFixture({ intentBytes: [shared] });
    const mutating: S1aReadOnlySource = {
      async readInputFile(path, maxBytes) {
        const bytes = await fx.source.readInputFile(path, maxBytes);
        if (path === fx.paths.sourcePath) shared.fill(0x20); // the host buffer changes after selection
        return bytes;
      },
      readArtifact: (root, rel, max) => fx.source.readArtifact(root, rel, max),
    };
    const { runner, calls } = spyRunner();
    const report = await runS2bOfflineAdapter(fx.request, mutating, runner);
    expect(report.adapter.status).toBe("PROJECTED");
    expect(runner).toHaveBeenCalledTimes(1);
    expect([...(await calls[0]!.source.readInputFile(fx.paths.intentPath, 65_536))]).toEqual([...original]);
  });

  it.each([
    ["intentPath equals the virtual Evidence path", { intentPath: "s2b://evidence" }],
    ["manifestPath equals the virtual ChangeSet path", { manifestPath: "s2b://changeset" }],
    ["sourcePath equals the virtual Evidence path", { sourcePath: "s2b://evidence" }],
    ["correlationPath equals the virtual ChangeSet path", { correlationPath: "s2b://changeset" }],
    ["artifactsRoot equals a virtual path", { artifactsRoot: "s2b://evidence" }],
    ["sourcePath equals intentPath", { sourcePath: "intent" }],
    ["correlationPath equals manifestPath", { correlationPath: "manifest" }],
    ["sourcePath equals correlationPath", { correlationPath: "s2b-source.json" }],
  ])("virtualOrRolePathCollisionIsRejectedWithoutS1d: %s", async (_label, paths) => {
    const fx = adapterFixture({ paths });
    const { runner } = spyRunner();
    const report = await runS2bOfflineAdapter(fx.request, fx.source, runner);
    expect(report.adapter.status).toBe("REJECTED");
    expect(runner).toHaveBeenCalledTimes(0);
    expect(Object.hasOwn(report, "s1d")).toBe(false);
    expect(fx.source.inputReads).toHaveLength(0); // rejected before any read
  });
});

// ---------------------------------------------------------------------------
// Step 6: orchestration, wrapper and safety
// ---------------------------------------------------------------------------

const SELECTED_AC = { artifactId: "ac-1", revision: "R1" } as const;
const FOREIGN_TASK = { artifactId: "task-9", revision: "R1" } as const;
const FOREIGN_AC = { artifactId: "ac-9", revision: "R1" } as const;
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

async function run(spec: AdapterFixtureSpec = {}) {
  const fx = adapterFixture(spec);
  const { runner, calls } = spyRunner();
  const report = await runS2bOfflineAdapter(fx.request, fx.source, runner);
  return { fx, runner, calls, report };
}

/** Evidence / ChangeSet bytes exactly as S1-d received them through the virtual source. */
async function bridgedInputs(call: Call): Promise<Readonly<{ evidence: Uint8Array; changeSet: Uint8Array }>> {
  const evidence = await call.source.readInputFile(call.request.evidencePath, 1_048_576);
  const changeSet = await call.source.readInputFile(call.request.changesetPath, 262_144);
  return { evidence, changeSet };
}

/** Direct S1-d baseline over the same bytes served under ordinary paths (no adapter involved). */
async function directBaseline(fx: ReturnType<typeof adapterFixture>, call: Call): Promise<Awaited<ReturnType<typeof runS1dDiagnostic>>> {
  const { evidence, changeSet } = await bridgedInputs(call);
  const s1 = s1aFixture();
  const direct: S1aReadOnlySource = {
    async readInputFile(path) {
      if (path === "baseline-evidence.json") return evidence;
      if (path === "baseline-changeset.json") return changeSet;
      if (path === fx.paths.manifestPath) return fx.manifestBytes;
      if (path === fx.paths.intentPath) return jsonBytes(s1.intent);
      throw new Error("unreadable");
    },
    readArtifact: (root, rel, max) => s1.source.readArtifact(root, rel, max),
  };
  return runS1dDiagnostic(
    { loaderInput: fx.request.loaderInput, evidencePath: "baseline-evidence.json", changesetPath: "baseline-changeset.json" },
    direct,
  );
}

function expectNeutralRejected(report: S2bReportV1): void {
  expect(report.schemaVersion).toBe("justice-s2b-report-v1");
  expect(report.adapter.status).toBe("REJECTED");
  expect(report.adapter.coverageCompleteness).toBe("NOT_ESTABLISHED");
  expect(report.adapter.diffProjection).toBe("UNAVAILABLE");
  expect(report.adapter.projectionScope.projectedEvidenceCount).toBe(0);
  expect(Object.hasOwn(report, "s1d")).toBe(false);
  for (const d of report.adapter.diagnostics) expect(d.count).toBeGreaterThan(0);
  const json = formatS2bJson(report);
  expect(json).not.toContain('"s1d"');
  expect(formatS2bText(report)).toContain("S1-d: NOT_INVOKED");
}

const limitedSourceText = (): string =>
  buildSource({
    pages: [{ request: firstRequest(2), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")])], "cur-1") }],
  });

describe("S2-b adapter: orchestration and S1-d call contract", () => {
  it("rejectedDoesNotInvokeS1dOrExposeS1d", async () => {
    // Source rejected (unsupported host version): source not evaluated.
    const a = await run({ sourceText: buildSource({ hostVersion: "2.3.0" }) });
    expect(a.runner).toHaveBeenCalledTimes(0);
    expectNeutralRejected(a.report);
    expect(a.report.adapter.collectionStatus).toBe("NOT_EVALUATED");
    expect(a.report.adapter.diagnostics).toEqual([{ code: "SOURCE_VERSION_UNSUPPORTED", count: 1 }]);
    expect(a.report.adapter.selectedTaskRef).toEqual({ artifactId: "task-1", revision: "R1" });

    // Correlation rejected (malformed JSON): source evaluated, its diagnostics carried once.
    const b = await run({ correlationValue: { schemaVersion: "nope" } });
    expect(b.runner).toHaveBeenCalledTimes(0);
    expectNeutralRejected(b.report);
    expect(b.report.adapter.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(b.report.adapter.diagnostics.map((d) => d.code)).toEqual(["SOURCE_SCHEMA_INVALID", "DIFF_UNAVAILABLE"]);

    // Projection rejected (partial with zero valid Evidence: incomplete pages + missing selected Tool).
    const c = await run({
      sourceText: limitedSourceText(),
      correlationValue: correlation([{ messageId: "msg_002", tools: [{ toolId: "tool_404", acRef: SELECTED_AC }] }]),
    });
    expect(c.runner).toHaveBeenCalledTimes(0);
    expectNeutralRejected(c.report);
    expect(c.report.adapter.collectionStatus).toBe("PAGINATION_INCOMPLETE");

    // TaskIntent unreadable/invalid: no selected task, nothing evaluated.
    const d = await run({ intentBytes: [new TextEncoder().encode("{not json")] });
    expect(d.runner).toHaveBeenCalledTimes(0);
    expectNeutralRejected(d.report);
    expect(Object.hasOwn(d.report.adapter, "selectedTaskRef")).toBe(false);
    expect(d.report.adapter.projectionScope.taskRef).toEqual({ artifactId: "", revision: "" });

    // Required input over its cap → INPUT_LIMIT_EXCEEDED, not truncated.
    const e = await run({ correlationValue: { pad: "x".repeat(262_144) } });
    expect(e.runner).toHaveBeenCalledTimes(0);
    expectNeutralRejected(e.report);
    expect(e.report.adapter.diagnostics.map((x) => x.code)).toContain("INPUT_LIMIT_EXCEEDED");

    // Neutral counts carry the same key set as a projected report.
    const projected = await run();
    expect(Object.keys(a.report.adapter.counts)).toEqual(Object.keys(projected.report.adapter.counts));
  });

  it("limitedInvokesOnceAndShowsProjectionScope", async () => {
    const { fx, runner, calls, report } = await run({ sourceText: limitedSourceText() });
    expect(report.adapter.status).toBe("LIMITED");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(report.adapter.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(report.adapter.coverageCompleteness).toBe("NOT_ESTABLISHED");
    expect(report.adapter.projectionScope).toMatchObject({
      firstPageIndex: 0, lastValidatedPageIndex: 0, validatedPageCount: 1, selectedMessageCount: 1, projectedEvidenceCount: 1,
    });
    expect(report.adapter.diagnostics.map((d) => d.code)).toContain("PAGINATION_INCOMPLETE");
    expect(report.s1d).toBeDefined();

    const text = formatS2bText(report);
    const qualifier = text.indexOf("Adapter scope: LIMITED");
    expect(qualifier).toBeGreaterThan(-1);
    // ac-2 has no Evidence in the projected set → S1-b MISSING_EVIDENCE, visibly qualified by the Adapter scope first.
    expect(text.indexOf("MISSING_EVIDENCE")).toBeGreaterThan(qualifier);
    expect(text.indexOf("Justice S1-d — READ_ONLY diagnostic")).toBeGreaterThan(qualifier);

    // S1-d object/Text are exactly a direct baseline invocation over the same bytes.
    const baseline = await directBaseline(fx, calls[0]!);
    expect(report.s1d).toEqual(baseline);
    expect(text.endsWith(formatText(baseline))).toBe(true);
  });

  it("projectedInvokesOnceWithEmptyEvidenceWhenNoBindings", async () => {
    const { fx, runner, calls, report } = await run({ correlationValue: correlation([]) });
    expect(report.adapter.status).toBe("PROJECTED");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(calls[0]!.request.evidencePath).toBe(S2B_VIRTUAL_EVIDENCE_PATH);
    expect(calls[0]!.request.changesetPath).toBe(S2B_VIRTUAL_CHANGESET_PATH);
    const { evidence } = await bridgedInputs(calls[0]!);
    expect(dec(evidence)).toBe("[]");
    expect(report.adapter.projectionScope.projectedEvidenceCount).toBe(0);
    const baseline = await directBaseline(fx, calls[0]!);
    expect(report.s1d).toEqual(baseline);
    const text = formatS2bText(report);
    expect(text).toContain("Adapter scope: PROJECTED");
    expect(text.endsWith(formatText(baseline))).toBe(true);
    // JSON `s1d` is the original object and the existing S1-d serialization, byte-for-byte.
    const json = formatS2bJson(report);
    expect(json.endsWith("\n")).toBe(true);
    expect(JSON.parse(json).s1d).toEqual(JSON.parse(JSON.stringify(baseline)));
    expect(json).toContain(`"s1d":${formatJson(baseline).trimEnd()}}`);
  });

  it("diffAlwaysUnavailableEvenWhenExternallyCompleteLooking", async () => {
    // T11/T12/T21/T22: no Diff, empty Diff, a fully consistent-looking Diff, with/without sessionAfter.
    const variants = [
      buildSource(),
      buildSource({ sessionAfter: sessionAfterMember() }),
      buildSource({ sessionAfter: sessionAfterMember(), diff: diffMember(JSON.stringify({ data: [] })) }),
      buildSource({ sessionAfter: sessionAfterMember(), diff: diffMember(validDiffResponse()) }),
    ];
    for (const sourceText of variants) {
      const { runner, calls, report } = await run({ sourceText });
      expect(report.adapter.status).toBe("PROJECTED");
      expect(runner).toHaveBeenCalledTimes(1);
      expect(report.adapter.diffProjection).toBe("UNAVAILABLE");
      const { changeSet } = await bridgedInputs(calls[0]!);
      expect(dec(changeSet)).toBe('{"availability":"UNAVAILABLE"}');
      const s1c = report.s1d?.stages.s1c;
      expect(s1c?.state).toBe("EVALUATED");
      if (s1c?.state === "EVALUATED") expect(s1c.result.formalVerdict).toBe("UNKNOWN");
      const out = formatS2bJson(report) + formatS2bText(report);
      expect(out).not.toContain('"PRESENT"'); // S1-b's MATCHED_REF_PRESENT is a coverage status, not a ChangeSet
      expect(out).not.toContain('"availability":"PRESENT"');
      expect(report.adapter.diagnostics.filter((d) => d.code === "DIFF_UNAVAILABLE")).toEqual([{ code: "DIFF_UNAVAILABLE", count: 1 }]);
    }
  });

  it("ownerAndHostAuthorityAlwaysUnverified", async () => {
    const executed = buildSource({
      pages: [{ request: firstRequest(), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001", "completed", true)]), idleMessage("msg_003")]) }],
    });
    const { calls, report } = await run({ sourceText: executed });
    expect(report.adapter.status).toBe("PROJECTED");
    const refs = JSON.parse(dec((await bridgedInputs(calls[0]!)).evidence)) as Array<Record<string, unknown>>;
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ provenanceClass: "UNVERIFIED_EXTERNAL", reportedExecutionState: "EXECUTED", reportedOutcome: "UNKNOWN" });
    const s1d = report.s1d!;
    if (s1d.stages.s1a.state !== "EVALUATED" || s1d.stages.s1b.state !== "EVALUATED" || s1d.stages.s1c.state !== "EVALUATED") {
      throw new Error("expected evaluated stages");
    }
    expect(s1d.stages.s1a.result.ownerAuthorityStatus).toBe("NOT_PROVEN");
    expect(s1d.stages.s1a.result.eligibleBaseline).toBe(false);
    expect(s1d.stages.s1b.result.authenticityStatus).not.toBe("VERIFIED");
    expect(s1d.stages.s1b.result.executionVerificationStatus).not.toBe("VERIFIED");
    expect(s1d.stages.s1c.result.formalVerdict).toBe("UNKNOWN");
    const text = formatS2bText(report);
    expect(text).toContain("Authority: owner approval UNVERIFIED; host execution UNVERIFIED");
    expect(text).toContain("not an acceptance or a Gate decision");
    expect(formatS2bJson(report)).not.toMatch(/"(?:approved|ownerApproved|hostVerified|PASS)"/);
  });

  it("foreignOnlySelectedEvidence", async () => {
    const sourceText = buildSource({
      pages: [{
        request: firstRequest(),
        response: pageResponse([
          userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]),
          assistantMessage("msg_004", [toolPart("tool_009")]), idleMessage("msg_005"),
        ]),
      }],
    });
    const { fx, calls, report } = await run({
      sourceText,
      correlationValue: correlation([
        { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
        { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_009", acRef: FOREIGN_AC }] },
      ]),
    });
    expect(report.adapter.status).toBe("PROJECTED");
    expect(report.adapter.diagnostics.find((d) => d.code === "FOREIGN_TASK_EXCLUDED")?.count).toBe(1);
    const refs = JSON.parse(dec((await bridgedInputs(calls[0]!)).evidence)) as Array<{ taskRef: unknown; acRef: unknown }>;
    expect(refs).toHaveLength(1);
    expect(refs.every((r) => JSON.stringify(r.taskRef) === JSON.stringify({ artifactId: "task-1", revision: "R1" }))).toBe(true);
    const s1b = report.s1d?.stages.s1b;
    if (s1b?.state !== "EVALUATED") throw new Error("expected S1-b evaluated");
    expect(s1b.result.bindingResults.flatMap((b) => b.reasonCodes)).not.toContain("TASK_NOT_SELECTED");
    expect(report.s1d).toEqual(await directBaseline(fx, calls[0]!));
  });

  it("manifestMismatchRemainsS1Finding", async () => {
    // T16: wrong caller-supplied digest is passed through; S1-a diagnoses it, the adapter does not retag it.
    const wrong = "0".repeat(64);
    const { fx, runner, calls, report } = await run({ expectedManifestSha256: wrong });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(calls[0]!.request.loaderInput.expectedManifestSha256).toBe(wrong);
    expect(report.adapter.status).toBe("PROJECTED"); // adapter scope only; not approval
    const s1a = report.s1d?.stages.s1a;
    if (s1a?.state !== "EVALUATED") throw new Error("expected S1-a evaluated");
    expect(s1a.result.manifestDigestMatch).toBe(false);
    expect(s1a.result.identityCandidateReady).toBe(false);
    expect(s1a.result.checks.map((c) => c.reasonCode)).toContain("MANIFEST_DIGEST_MISMATCH");
    expect(report.s1d).toEqual(await directBaseline(fx, calls[0]!));
    expect(report.adapter.diagnostics.map((d) => d.code)).not.toContain("SOURCE_IDENTITY_MISMATCH");

    // Missing digest is never derived from the Manifest.
    const missing = await run({ expectedManifestSha256: null });
    expect(Object.hasOwn(missing.calls[0]!.request.loaderInput, "expectedManifestSha256")).toBe(false);
    const s1aMissing = missing.report.s1d?.stages.s1a;
    if (s1aMissing?.state !== "EVALUATED") throw new Error("expected S1-a evaluated");
    expect(s1aMissing.result.checks.map((c) => c.reasonCode)).toContain("MANIFEST_DIGEST_REQUIRED");
  });

  it("redactsSecretAndAbsolutePath", async () => {
    // T14: secrets in raw Message/Tool/Diff, absolute host paths in request paths and Tool IDs.
    const SECRET = "sk-live-SECRET-0123456789";
    const HOST = "/home/alice/private";
    const secretTool = { ...toolPart(`tool_${HOST}/a`), state: { status: "completed", input: { cmd: `cat ${HOST}/.env` }, content: [{ type: "text", text: SECRET }] } };
    const sourceText = buildSource({
      pages: [{
        request: firstRequest(),
        response: pageResponse([
          { ...userMessage("msg_001"), text: `token ${SECRET} at ${HOST}` },
          { ...assistantMessage("msg_002", [secretTool]), content: [{ type: "text", text: SECRET }, secretTool] },
          idleMessage("msg_003"),
        ]),
      }],
      sessionAfter: sessionAfterMember(),
      diff: diffMember(JSON.stringify({ data: [{ file: `${HOST}/x`, patch: `+${SECRET}`, additions: 1, deletions: 0, status: "modified" }] })),
    });
    const paths = {
      manifestPath: `${HOST}/manifest.json`, intentPath: `${HOST}/intent.json`, artifactsRoot: `${HOST}/root`,
      sourcePath: `${HOST}/source.json`, correlationPath: `${HOST}/correlation.json`,
    };
    const { report } = await run({
      sourceText,
      paths,
      correlationValue: correlation([{ messageId: "msg_002", tools: [{ toolId: `tool_${HOST}/a`, acRef: SELECTED_AC }] }]),
    });
    expect(report.adapter.status).toBe("PROJECTED");
    expect(report.s1d).toBeDefined();
    for (const out of [formatS2bJson(report), formatS2bText(report)]) {
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("alice");
      expect(out).not.toContain("ses_fixture001");
      expect(out).not.toContain("collection-001");
      expect(out).not.toContain("msg_002");
    }

    // Fatal exceptions map to a fixed code with no exception text.
    const fx = adapterFixture({ paths });
    const thrower = vi.fn(async () => {
      throw new Error(`boom ${SECRET} ${HOST}`);
    });
    const fatal = await runS2bOfflineAdapter(fx.request, fx.source, thrower);
    expect(thrower).toHaveBeenCalledTimes(1);
    expectNeutralRejected(fatal);
    expect(fatal.adapter.diagnostics.map((d) => d.code)).toContain("SOURCE_SCHEMA_INVALID");
    const failingSource: S1aReadOnlySource = {
      async readInputFile() {
        throw new Error(`EACCES ${HOST}/intent.json ${SECRET}`);
      },
      async readArtifact() {
        throw new Error(SECRET);
      },
    };
    const unreadable = await runS2bOfflineAdapter(fx.request, failingSource, thrower);
    expectNeutralRejected(unreadable);
    for (const out of [formatS2bJson(fatal), formatS2bText(fatal), formatS2bJson(unreadable), formatS2bText(unreadable)]) {
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("alice");
      expect(out).not.toContain("boom");
      expect(out).not.toContain("EACCES");
    }
  });

  it("outputIsDeterministicWithStableKeyOrder", async () => {
    const one = await run({ sourceText: limitedSourceText() });
    const two = await run({ sourceText: limitedSourceText() });
    expect(formatS2bJson(one.report)).toBe(formatS2bJson(two.report));
    expect(formatS2bText(one.report)).toBe(formatS2bText(two.report));
    const parsed = JSON.parse(formatS2bJson(one.report)) as { adapter: Record<string, unknown> };
    expect(Object.keys(parsed)).toEqual(["schemaVersion", "adapter", "s1d"]);
    expect(Object.keys(parsed.adapter)).toEqual([
      "status", "collectionStatus", "selectedTaskRef", "projectionScope", "coverageCompleteness", "counts", "diagnostics", "diffProjection",
    ]);
    expect(formatS2bText(one.report).endsWith("\n")).toBe(true);
    // The adapter object returned equals the serialized one (no hidden extra fields).
    expect(parsed.adapter).toEqual(JSON.parse(JSON.stringify(one.report.adapter)));
  });
});

// ---------------------------------------------------------------------------
// Task 6: Fixed-Fixture MVP acceptance matrix (T01–T22) and S1 contract non-regression
// ---------------------------------------------------------------------------

const SELECTED_TASK = { artifactId: "task-1", revision: "R1" } as const;
const AC2 = { artifactId: "ac-2", revision: "R1" } as const;

type EvaluatedS1d = Readonly<{
  s1a: Extract<S1dReportV1["stages"]["s1a"], { state: "EVALUATED" }>["result"];
  s1c: Extract<S1dReportV1["stages"]["s1c"], { state: "EVALUATED" }>["result"];
}>;

/**
 * S1 contract non-regression for an invoked report: the `s1d` member is the unmodified S1-d report (equal to a direct
 * baseline over the same bytes), S1-a Owner authority stays NOT_PROVEN, S1-c formal verdict stays UNKNOWN, and every
 * projected Evidence ref belongs to the selected Task only with no inferred execution/AC truth.
 */
async function expectS1Untouched(fx: ReturnType<typeof adapterFixture>, call: Call, report: S2bReportV1): Promise<EvaluatedS1d> {
  expect(Object.hasOwn(report, "s1d")).toBe(true);
  const s1d = report.s1d!;
  expect(s1d.schemaVersion).toBe("justice-s1d-report-v1");
  expect(s1d.readOnly).toBe(true);
  const baseline = await directBaseline(fx, call);
  expect(s1d).toEqual(baseline);
  expect(formatS2bText(report).endsWith(formatText(baseline))).toBe(true);
  expect(formatS2bJson(report)).toContain(`"s1d":${formatJson(baseline).trimEnd()}}`);
  // Every call is for the selected Task only: same loader input, frozen intent path, virtual Evidence/ChangeSet paths.
  expect(call.request.loaderInput).toEqual(fx.request.loaderInput);
  expect(call.request.evidencePath).toBe(S2B_VIRTUAL_EVIDENCE_PATH);
  expect(call.request.changesetPath).toBe(S2B_VIRTUAL_CHANGESET_PATH);
  const refs = JSON.parse(dec((await bridgedInputs(call)).evidence)) as Array<Record<string, unknown>>;
  for (const ref of refs) {
    expect(ref["taskRef"]).toEqual(SELECTED_TASK);
    expect(ref["scopeKey"]).toBe("scope-1");
    expect(ref["provenanceClass"]).toBe("UNVERIFIED_EXTERNAL");
    expect(ref["reportedOutcome"]).toBe("UNKNOWN");
  }
  const { s1a, s1c } = s1d.stages;
  if (s1a.state !== "EVALUATED" || s1c.state !== "EVALUATED") throw new Error("expected S1-a and S1-c evaluated");
  expect(s1a.result.ownerAuthorityStatus).toBe("NOT_PROVEN");
  expect(s1c.result.formalVerdict).toBe("UNKNOWN");
  return { s1a: s1a.result, s1c: s1c.result };
}

const fourMessageSource = (): string =>
  buildSource({
    pages: [{
      request: firstRequest(),
      response: pageResponse([
        userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]),
        assistantMessage("msg_004", [toolPart("tool_004")]), idleMessage("msg_005"),
      ]),
    }],
  });

describe("S2-b adapter: Fixed-Fixture MVP acceptance (Task 6)", () => {
  it("s1dReportTypeIsTheUnchangedS1dContract", () => {
    // S2-b re-exports the S1-d report type; it never redefines or widens it.
    expectTypeOf<S1dReportV1>().toEqualTypeOf<CoreS1dReportV1>();
    expectTypeOf<NonNullable<S2bReportV1["s1d"]>>().toEqualTypeOf<CoreS1dReportV1>();
  });

  it("t01NormalSessionProjectedSelectedEvidenceOnly", async () => {
    const { fx, runner, calls, report } = await run();
    expect(report.adapter.status).toBe("PROJECTED");
    expect(report.adapter.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(report.adapter.coverageCompleteness).toBe("NOT_ESTABLISHED");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(report.adapter.projectionScope.projectedEvidenceCount).toBe(1);
    const refs = JSON.parse(dec((await bridgedInputs(calls[0]!)).evidence)) as Array<Record<string, unknown>>;
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ type: "other", acRef: SELECTED_AC, reportedExecutionState: "UNKNOWN" });
    const { s1a } = await expectS1Untouched(fx, calls[0]!, report);
    expect(s1a.selectedRefs.map((r) => r.artifactId)).toEqual(expect.arrayContaining(["task-1", "ac-1", "ac-2"]));
  });

  it("t02TwoToolsTwoEvidenceIdsThroughAdapter", async () => {
    const sourceText = buildSource({
      pages: [{ request: firstRequest(), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001"), toolPart("tool_002")]), idleMessage("msg_003")]) }],
    });
    const { fx, calls, report } = await run({
      sourceText,
      correlationValue: correlation([{ messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }, { toolId: "tool_002", acRef: AC2 }] }]),
    });
    expect(report.adapter.status).toBe("PROJECTED");
    const refs = JSON.parse(dec((await bridgedInputs(calls[0]!)).evidence)) as Array<{ evidenceId: string; acRef: unknown }>;
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((r) => r.evidenceId)).size).toBe(2);
    expect(refs.map((r) => r.acRef)).toEqual(expect.arrayContaining([SELECTED_AC, AC2]));
    await expectS1Untouched(fx, calls[0]!, report);
  });

  it("t09FilteredUnknownVersionOrExportSourceRejectedWithoutS1d", async () => {
    const variants: Array<[string, string]> = [
      [buildSource({ pages: [{ request: { ...firstRequest(), type: "assistant" }, response: pageResponse([]) }] }), "UNSUPPORTED_FILTERED_COLLECTION"],
      [buildSource({ hostVersion: "2.2.6" }), "SOURCE_VERSION_UNSUPPORTED"],
      [JSON.stringify({ info: { id: "ses_fixture001" }, messages: [] }), "SOURCE_SCHEMA_INVALID"],
    ];
    for (const [sourceText, code] of variants) {
      const { runner, report } = await run({ sourceText });
      expect(runner).toHaveBeenCalledTimes(0);
      expectNeutralRejected(report);
      expect(report.adapter.diagnostics).toEqual([{ code, count: 1 }]);
    }
  });

  it("t11t12DiffNeverPresentAcrossUnavailabilityCauses", async () => {
    const userDiff = (response: string): string => diffMember(response);
    const nonUserDiff = (response: string): string =>
      `{"request":{"sessionId":"ses_fixture001","from":"msg_002","to":"msg_002"},"collectedAt":"2026-11-09T08:00:01Z","response":${response}}`;
    const busyAfterIdle = `{"collectedAt":"2026-11-09T08:00:02Z","response":${sessionResponseText({ time: { created: 1_000, updated: 6_000, busy: 6_000, idle: 5_000 } })}}`;
    const variants: Array<[string, string]> = [
      ["T11 diff absent", buildSource()],
      ["T11 more:true", buildSource({ sessionAfter: sessionAfterMember(), diff: userDiff(JSON.stringify({ ...(JSON.parse(validDiffResponse()) as object), more: true })) })],
      ["T11 from/to not User", buildSource({ sessionAfter: sessionAfterMember(), diff: nonUserDiff(validDiffResponse()) })],
      ["T11 Session busy>idle", buildSource({ sessionAfter: busyAfterIdle, diff: userDiff(validDiffResponse()) })],
      ["T11 sessionAfter missing", buildSource({ diff: userDiff(validDiffResponse()) })],
      ["T11 empty data", buildSource({ sessionAfter: sessionAfterMember(), diff: userDiff(JSON.stringify({ data: [] })) })],
      ["T12 consistent-looking Diff with data", buildSource({ sessionAfter: sessionAfterMember(), diff: userDiff(validDiffResponse()) })],
      ["T12 rename-looking Diff", buildSource({
        sessionAfter: sessionAfterMember(),
        diff: userDiff(JSON.stringify({ data: [{ file: "b.txt", patch: "@@", additions: 0, deletions: 0, status: "renamed" }] })),
      })],
    ];
    for (const [label, sourceText] of variants) {
      const { fx, calls, report } = await run({ sourceText });
      expect(report.adapter.status, label).toBe("PROJECTED");
      expect(report.adapter.diffProjection, label).toBe("UNAVAILABLE");
      expect(report.adapter.diagnostics.find((d) => d.code === "DIFF_UNAVAILABLE")?.count, label).toBe(1);
      const { changeSet } = await bridgedInputs(calls[0]!);
      expect(dec(changeSet), label).toBe('{"availability":"UNAVAILABLE"}');
      const out = formatS2bJson(report) + formatS2bText(report);
      expect(out, label).not.toContain('"availability":"PRESENT"');
      expect(out, label).not.toContain("RENAME");
      await expectS1Untouched(fx, calls[0]!, report);
    }
  });

  it("t17ForeignAcIsolatedAtAdapterLevel", async () => {
    // Valid foreign Task binding whose AC (ac-9) is NOT in the selected Intent's ac[].
    const { fx, runner, calls, report } = await run({
      sourceText: fourMessageSource(),
      correlationValue: correlation([
        { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
        { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_004", acRef: FOREIGN_AC }] },
      ]),
    });
    expect(report.adapter.status).toBe("PROJECTED"); // normal foreign exclusion alone never makes LIMITED
    expect(runner).toHaveBeenCalledTimes(1);
    const diagCodes = report.adapter.diagnostics.map((d) => d.code);
    expect(report.adapter.diagnostics.find((d) => d.code === "FOREIGN_TASK_EXCLUDED")?.count).toBe(1);
    expect(diagCodes).not.toContain("CORRELATION_MISMATCH");
    expect(diagCodes).not.toContain("CONFLICT");
    const refs = JSON.parse(dec((await bridgedInputs(calls[0]!)).evidence)) as Array<{ taskRef: unknown; acRef: unknown }>;
    expect(refs).toEqual([expect.objectContaining({ taskRef: SELECTED_TASK, acRef: SELECTED_AC })]);
    expect(JSON.stringify(refs)).not.toContain("ac-9");
    expect(JSON.stringify(refs)).not.toContain("task-9");
    const s1b = report.s1d?.stages.s1b;
    if (s1b?.state !== "EVALUATED") throw new Error("expected S1-b evaluated");
    expect(s1b.result.bindingResults.flatMap((b) => b.reasonCodes)).not.toContain("TASK_NOT_SELECTED");
    await expectS1Untouched(fx, calls[0]!, report);
  });

  it("t18CompletePagesPartialSelectedConflictLimitedAtAdapterLevel", async () => {
    // Complete pages; msg_002 is claimed by both the selected and a foreign Task (conflict), msg_004 is valid.
    const { fx, runner, calls, report } = await run({
      sourceText: fourMessageSource(),
      correlationValue: correlation([
        { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
        { messageId: "msg_002", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_001", acRef: FOREIGN_AC }] },
        { messageId: "msg_004", tools: [{ toolId: "tool_004", acRef: AC2 }] },
      ]),
    });
    expect(report.adapter.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(report.adapter.status).toBe("LIMITED");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(Object.hasOwn(report, "s1d")).toBe(true);
    // The whole validated page range and the exclusion counts are shown.
    expect(report.adapter.projectionScope).toMatchObject({ firstPageIndex: 0, lastValidatedPageIndex: 0, validatedPageCount: 1, projectedEvidenceCount: 1 });
    expect(report.adapter.diagnostics.find((d) => d.code === "CONFLICT")?.count).toBe(1);
    expect(report.adapter.counts["rejectedCandidates"]).toBe(1);
    expect(report.adapter.counts["conflictedBindings"]).toBe(2);
    const refs = JSON.parse(dec((await bridgedInputs(calls[0]!)).evidence)) as Array<{ acRef: unknown }>;
    expect(refs.map((r) => r.acRef)).toEqual([AC2]);
    expect(formatS2bText(report)).toContain("Adapter scope: LIMITED");
    await expectS1Untouched(fx, calls[0]!, report);
  });

  it("t19GlobalFailureOrZeroSafeEvidenceRejectedWithoutS1d", async () => {
    const dupFirstPage = buildSource({ pages: [{ request: firstRequest(), response: pageResponse([userMessage("msg_001"), userMessage("msg_001")]) }] });
    const badFirstPage = buildSource({
      pages: [{ request: firstRequest(), response: pageResponse([userMessage("msg_001")]).replace('"type":"user"', '"type":"user","type":"user"') }],
    });
    const tooManyPages = buildSource({
      pages: Array.from({ length: 65 }, (_, i) => ({
        request: i === 0 ? firstRequest(1) : laterRequest(`cur-${i}`, 1),
        response: pageResponse([userMessage(`msg_p${String(i).padStart(3, "0")}`)], i < 64 ? `cur-${i + 1}` : undefined),
      })),
    });
    const cases: Array<[string, AdapterFixtureSpec, string]> = [
      ["first page invalid", { sourceText: badFirstPage }, "SOURCE_SCHEMA_INVALID"],
      ["page count over limit", { sourceText: tooManyPages }, "INPUT_LIMIT_EXCEEDED"],
      ["global uniqueness impossible (duplicate Message ID on page 0)", { sourceText: dupFirstPage }, "CONFLICT"],
      ["incomplete pages, selected candidate beyond prefix only", {
        sourceText: limitedSourceText(),
        correlationValue: correlation([{ messageId: "msg_003", tools: [{ toolId: "tool_003", acRef: SELECTED_AC }] }]),
      }, "PAGINATION_INCOMPLETE"],
      ["incomplete pages, no selected binding", { sourceText: limitedSourceText(), correlationValue: correlation([]) }, "PAGINATION_INCOMPLETE"],
      ["complete pages, every selected candidate conflicted", {
        sourceText: fourMessageSource(),
        correlationValue: correlation([
          { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
          { messageId: "msg_002", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_001", acRef: FOREIGN_AC }] },
        ]),
      }, "CONFLICT"],
      ["complete pages, selected Tool missing", {
        sourceText: fourMessageSource(),
        correlationValue: correlation([{ messageId: "msg_002", tools: [{ toolId: "tool_404", acRef: SELECTED_AC }] }]),
      }, "MISSING_TOOL"],
    ];
    for (const [label, spec, code] of cases) {
      const { runner, report } = await run(spec);
      expect(runner, label).toHaveBeenCalledTimes(0);
      expect(report.adapter.status, label).toBe("REJECTED");
      expect(Object.hasOwn(report, "s1d"), label).toBe(false);
      expect(report.adapter.projectionScope.projectedEvidenceCount, label).toBe(0);
      expect(report.adapter.diagnostics.map((d) => d.code), label).toContain(code);
      expect(formatS2bJson(report), label).not.toContain('"s1d"');
      expect(formatS2bText(report), label).toContain("S1-d: NOT_INVOKED");
    }
  });

  it("t20CompleteWithoutSelectedBindingProjectedButNotSessionWideAbsence", async () => {
    const { fx, runner, calls, report } = await run({
      correlationValue: correlation([{ messageId: "msg_002", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_001", acRef: FOREIGN_AC }] }]),
    });
    expect(report.adapter.status).toBe("PROJECTED");
    expect(runner).toHaveBeenCalledTimes(1);
    expect(report.adapter.counts["explicitSelectedCandidates"]).toBe(0);
    expect(report.adapter.coverageCompleteness).toBe("NOT_ESTABLISHED");
    const text = formatS2bText(report);
    expect(text).toContain("this does not prove complete Host history");
    expect(text.indexOf("Adapter scope: PROJECTED")).toBeLessThan(text.indexOf("Justice S1-d — READ_ONLY diagnostic"));
    await expectS1Untouched(fx, calls[0]!, report);
  });

  it("t21CompleteEvidenceProjectionWithoutDiffKeepsDiffUnavailable", async () => {
    const { fx, calls, report } = await run({ sourceText: buildSource() });
    expect(report.adapter.status).toBe("PROJECTED");
    expect(report.adapter.diffProjection).toBe("UNAVAILABLE");
    expect(report.adapter.projectionScope.projectedEvidenceCount).toBe(1);
    await expectS1Untouched(fx, calls[0]!, report);
  });

  it("t22SessionAfterOrSnapshotCoincidenceNeverMakesDiffPresent", async () => {
    const laterAfter = `{"collectedAt":"2026-11-09T09:00:00Z","response":${sessionResponseText({ outcome: "failed" })}}`;
    for (const sessionAfter of [undefined, sessionAfterMember(), laterAfter]) {
      const sourceText = buildSource({ ...(sessionAfter === undefined ? {} : { sessionAfter }), diff: diffMember(validDiffResponse()) });
      const { calls, report } = await run({ sourceText });
      expect(report.adapter.status).toBe("PROJECTED");
      expect(report.adapter.diffProjection).toBe("UNAVAILABLE");
      expect(dec((await bridgedInputs(calls[0]!)).changeSet)).toBe('{"availability":"UNAVAILABLE"}');
    }
  });

  it("foreignEvidenceRefFromProjectorIsRejectedByOwnershipGuard", async () => {
    // Forge a Projection whose Evidence ref names a foreign Task / AC: the adapter's pre-call identity guard fails closed.
    const forgeries: Array<[string, (real: Projection) => Projection]> = [
      ["foreign taskRef", (real): Projection => ({ ...real, evidenceRefs: real.evidenceRefs.map((r) => ({ ...r, taskRef: FOREIGN_TASK })) })],
      ["AC outside the selected ac[]", (real): Projection => ({ ...real, evidenceRefs: real.evidenceRefs.map((r) => ({ ...r, acRef: FOREIGN_AC })) })],
      ["foreign scopeKey", (real): Projection => ({ ...real, evidenceRefs: real.evidenceRefs.map((r) => ({ ...r, scopeKey: "scope-9" })) })],
      ["scope taskRef drift", (real): Projection => ({ ...real, projectionScope: { ...real.projectionScope, taskRef: FOREIGN_TASK } })],
    ];
    for (const [label, forge] of forgeries) {
      projectorHook.override = forge;
      const { runner, report } = await run();
      projectorHook.override = null;
      expect(runner, label).toHaveBeenCalledTimes(0);
      expectNeutralRejected(report);
      expect(report.adapter.diagnostics.map((d) => d.code), label).toContain("SOURCE_IDENTITY_MISMATCH");
    }
    // Sanity: without the forgery the same fixture is PROJECTED.
    expect((await run()).report.adapter.status).toBe("PROJECTED");
  });
});
