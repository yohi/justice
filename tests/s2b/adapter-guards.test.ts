import { describe, expect, it, vi } from "vitest";
import type { S1aReadOnlySource } from "../../src/core/s1a/contract.js";
import type { S2bReportV1 } from "../../src/runtime/s2b-contract.js";
import { runS1dDiagnostic } from "../../src/runtime/s1d-diagnostic.js";
import { formatS2bJson, formatS2bText, runS2bOfflineAdapter } from "../../src/runtime/s2b-offline-adapter.js";
import { type AdapterFixtureSpec, adapterFixture } from "./fixtures.js";

type S1dRequest = Parameters<typeof runS1dDiagnostic>[0];
type Call = Readonly<{ request: S1dRequest; source: S1aReadOnlySource }>;

function spyRunner() {
  const calls: Call[] = [];
  const runner = vi.fn(async (request: S1dRequest, source: S1aReadOnlySource) => {
    calls.push({ request, source });
    return runS1dDiagnostic(request, source);
  });
  return { runner, calls };
}

async function run(spec: AdapterFixtureSpec = {}) {
  const fx = adapterFixture(spec);
  const { runner, calls } = spyRunner();
  const report = await runS2bOfflineAdapter(fx.request, fx.source, runner);
  return { fx, runner, calls, report };
}

const codesOf = (report: S2bReportV1): string[] => report.adapter.diagnostics.map((d) => d.code);

function expectNeutralRejected(report: S2bReportV1): void {
  expect(report.adapter.status).toBe("REJECTED");
  expect(report.adapter.projectionScope.projectedEvidenceCount).toBe(0);
  expect(Object.hasOwn(report, "s1d")).toBe(false);
  expect(formatS2bText(report)).toContain("S1-d: NOT_INVOKED");
}

/** Wrap the fixture source so reads of one path are replaced by `replace`. */
const overriding = (fx: ReturnType<typeof adapterFixture>, path: string, replace: () => Promise<Uint8Array>): S1aReadOnlySource => ({
  readInputFile: (p, max) => (p === path ? replace() : fx.source.readInputFile(p, max)),
  readArtifact: (root, rel, max) => fx.source.readArtifact(root, rel, max),
});

describe("S2-b adapter: bounded read and path guards", () => {
  it("missingLoaderInputIsRejectedBeforeAnyRead", async () => {
    const fx = adapterFixture();
    const { runner } = spyRunner();
    const request = { sourcePath: "s", correlationPath: "c" } as unknown as Parameters<typeof runS2bOfflineAdapter>[0];
    const report = await runS2bOfflineAdapter(request, fx.source, runner);
    expectNeutralRejected(report);
    expect(codesOf(report)).toContain("SOURCE_SCHEMA_INVALID");
    expect(runner).toHaveBeenCalledTimes(0);
    expect(fx.source.inputReads).toHaveLength(0);
  });

  it("emptyPathIsRejectedAsSchemaInvalid", async () => {
    const { report, runner } = await run({ paths: { sourcePath: "" } });
    expectNeutralRejected(report);
    expect(codesOf(report)).toContain("SOURCE_SCHEMA_INVALID");
    expect(runner).toHaveBeenCalledTimes(0);
  });

  it.each([
    ["a non-limit read error", async (): Promise<Uint8Array> => { throw new Error("boom"); }, "SOURCE_SCHEMA_INVALID"],
    ["an over_limit read error", async (): Promise<Uint8Array> => { throw Object.assign(new Error("x"), { kind: "over_limit" }); }, "INPUT_LIMIT_EXCEEDED"],
    ["a non-Uint8Array result", async (): Promise<Uint8Array> => "text" as unknown as Uint8Array, "SOURCE_SCHEMA_INVALID"],
    ["a result larger than the cap", async (): Promise<Uint8Array> => new Uint8Array(70_000), "INPUT_LIMIT_EXCEEDED"],
    ["a thrown null", async (): Promise<Uint8Array> => { throw null; }, "SOURCE_SCHEMA_INVALID"],
  ])("intentReadFailureIsMappedToFixedCode: %s", async (_label, replace, code) => {
    const fx = adapterFixture();
    const { runner } = spyRunner();
    const report = await runS2bOfflineAdapter(fx.request, overriding(fx, fx.paths.intentPath, replace), runner);
    expectNeutralRejected(report);
    expect(codesOf(report)).toEqual([code]);
    expect(runner).toHaveBeenCalledTimes(0);
  });

  it("readbackMismatchIsRejectedAsIdentityMismatch", async () => {
    class Liar extends Uint8Array {
      override at(): number { return 255; }
    }
    const fx = adapterFixture();
    const liar = new Liar(await fx.source.readInputFile(fx.paths.intentPath, 65_536));
    const { runner } = spyRunner();
    const report = await runS2bOfflineAdapter(fx.request, overriding(fx, fx.paths.intentPath, async () => liar), runner);
    expectNeutralRejected(report);
    expect(codesOf(report)).toEqual(["SOURCE_IDENTITY_MISMATCH"]);
  });

  it("unparseableIntentIsRejectedAsSchemaInvalid", async () => {
    const { report } = await run({ intentBytes: [new TextEncoder().encode("{not json")] });
    expectNeutralRejected(report);
    expect(codesOf(report)).toEqual(["SOURCE_SCHEMA_INVALID"]);
  });
});

describe("S2-b adapter: virtual source bridge guards", () => {
  it("bridgeRejectsOverCapAndUnknownPathsAndPassesManifestAndArtifactsThrough", async () => {
    const { fx, calls } = await run();
    const bridge = calls[0]!.source;
    const evidencePath = calls[0]!.request.evidencePath;

    await expect(bridge.readInputFile(fx.paths.intentPath, 1)).rejects.toMatchObject({ kind: "over_limit" });
    await expect(bridge.readInputFile(evidencePath, 1)).rejects.toMatchObject({ kind: "over_limit" });
    await expect(bridge.readInputFile(fx.paths.sourcePath, 65_536)).rejects.toThrow("unreadable");
    const manifest = await bridge.readInputFile(fx.paths.manifestPath, 65_536);
    expect([...manifest]).toEqual([...fx.manifestBytes]);
    const viaBridge = await bridge.readArtifact(fx.paths.artifactsRoot, "does-not-exist", 1_024).then(() => "ok", () => "err");
    const direct = await fx.source.readArtifact(fx.paths.artifactsRoot, "does-not-exist", 1_024).then(() => "ok", () => "err");
    expect(viaBridge).toBe(direct);
  });
});

describe("S2-b adapter: output hardening for forged reports", () => {
  const forge = (report: S2bReportV1, patch: Record<string, unknown>): S2bReportV1 =>
    ({ ...report, adapter: { ...report.adapter, ...patch } }) as unknown as S2bReportV1;

  it("unknownStatusCollectionStatusAndUnsafeCountsAreNormalized", async () => {
    const { report } = await run();
    const forged = forge(report, {
      status: "BOGUS",
      collectionStatus: "BOGUS",
      counts: { "ok-key": 3, "bad key with spaces!": 9, neg: -1, frac: 1.5 },
      diagnostics: [{ code: "NOT_A_CODE", count: 1 }, { code: "CONFLICT", count: -5 }, { code: "CONFLICT", count: 2 }],
    });
    const parsed = JSON.parse(formatS2bJson(forged)) as { adapter: Record<string, unknown> };
    expect(parsed.adapter.status).toBe("REJECTED");
    expect(parsed.adapter.collectionStatus).toBe("NOT_EVALUATED");
    expect(parsed.adapter.counts).toEqual({ "ok-key": 3, frac: 0, neg: 0 });
    expect(parsed.adapter.diagnostics).toEqual([{ code: "CONFLICT", count: 2 }]);
  });

  it("unsafeScopeValuesAreRedactedAndBadIndexesNormalized", async () => {
    const { report } = await run();
    const forged = forge(report, {
      selectedTaskRef: { artifactId: "/abs/path/secret", revision: 42 },
      projectionScope: {
        ...report.adapter.projectionScope,
        sessionId: "token=sk-abc",
        collectionId: "",
        scopeKey: 7,
        firstPageIndex: 3,
        lastValidatedPageIndex: "x",
        validatedPageCount: Number.NaN,
      },
    });
    const json = formatS2bJson(forged);
    const parsed = JSON.parse(json) as { adapter: { selectedTaskRef: Record<string, string>; projectionScope: Record<string, unknown> } };
    expect(parsed.adapter.selectedTaskRef).toEqual({ artifactId: "[redacted]", revision: "[redacted]" });
    expect(parsed.adapter.projectionScope).toMatchObject({
      sessionId: "[redacted]", collectionId: "", scopeKey: "[redacted]", firstPageIndex: null, lastValidatedPageIndex: 0, validatedPageCount: 0,
    });
    expect(json).not.toContain("/abs/path");
    expect(json).not.toContain("sk-abc");
  });

  it("textShowsOpenRangeAndNotEstablishedFields", async () => {
    const { report } = await run();
    const text = formatS2bText(forge(report, {
      projectionScope: { ...report.adapter.projectionScope, firstPageIndex: 0, lastValidatedPageIndex: null },
    }));
    expect(text).toContain("validated pages: 0..none");
    const rejected = formatS2bText((await run({ paths: { sourcePath: "" } })).report);
    expect(rejected).toContain("Selected task: not established");
    expect(rejected).toContain("validated pages: none");
  });
});
