import { describe, expect, it } from "vitest";
import { bindEvidence } from "../../src/core/s1b/binder.js";
import type { EvidenceRefV1 } from "../../src/core/s1b/contract.js";
import { evaluateS1c } from "../../src/core/s1c/evaluator.js";
import { loadS1aArtifacts } from "../../src/core/s1a/loader.js";
import type { S1aReadOnlySource } from "../../src/core/s1a/contract.js";
import type { S1dReportV1 } from "../../src/core/s1d/contract.js";
import { runS1dDiagnostic } from "../../src/runtime/s1d-diagnostic.js";
import { jsonBytes, s1aFixture, sha256 } from "../helpers/s1a-fixtures.js";
import type { DiagnosticRequest } from "../../src/runtime/s1d-diagnostic.js";

const planText = [
  "## Justice S1-c Task Scope Policies",
  "<!-- justice:s1c-task-scope:begin -->",
  JSON.stringify({ schemaVersion: "justice-s1c-task-scope-v1", planRef: { artifactId: "plan-1", revision: "R1" }, taskRef: { artifactId: "task-1", revision: "R1" }, scopeKey: "scope-1", allowedPaths: ["src/**"] }),
  "<!-- justice:s1c-task-scope:end -->",
].join("\n");
const planBytes = new TextEncoder().encode(planText);
const validEvidence: EvidenceRefV1 = {
  evidenceId: "ev-1", type: "test", taskRef: { artifactId: "task-1", revision: "R1" },
  scopeKey: "scope-1", issuerId: "issuer-1", originId: "origin-1",
  provenanceClass: "SELF_DECLARED", reportedExecutionState: "EXECUTED", reportedOutcome: "PASS",
};
const validChangeSet = { availability: "PRESENT", changes: [{ kind: "ADD", path: "src/a.ts" }] } as const;
type SetupContext = Readonly<{ request: DiagnosticRequest; source: S1aReadOnlySource; fixture: ReturnType<typeof s1aFixture>; selectedPlan: Uint8Array }>;

async function setup(evidence: unknown = [validEvidence], changeSet: unknown = validChangeSet, planMismatch = false): Promise<SetupContext> {
  const fixture = s1aFixture();
  const selectedPlan = planMismatch ? new TextEncoder().encode("tampered plan") : planBytes;
  const manifest = {
    ...fixture.manifest,
    artifacts: fixture.manifest.artifacts.map((ref) => ref.artifactId === "plan-1"
      ? { ...ref, digest: { algorithm: "sha256" as const, hex: sha256(planBytes) } }
      : ref),
  };
  const fixtureFiles = new Map(Object.entries(fixture.files));
  const source: S1aReadOnlySource = {
    async readInputFile(path) {
      if (path === "evidence") return jsonBytes(evidence);
      if (path === "changeset") return jsonBytes(changeSet);
      return jsonBytes(path === "manifest" ? manifest : fixture.intent);
    },
    async readArtifact(_root, path) {
      return path === "plan-1.md" ? selectedPlan : fixtureFiles.get(path) ?? new Uint8Array();
    },
  };
  const request: DiagnosticRequest = {
    loaderInput: { ...fixture.input, expectedManifestSha256: sha256(jsonBytes(manifest)) },
    evidencePath: "evidence", changesetPath: "changeset",
  };
  return { request, source, fixture, selectedPlan };
}

async function run(evidence?: unknown, changeSet?: unknown, planMismatch = false): Promise<SetupContext & Readonly<{ report: S1dReportV1 }>> {
  const context = await setup(evidence, changeSet, planMismatch);
  return { ...context, report: await runS1dDiagnostic(context.request, context.source) };
}

function unavailableEvidenceSource(source: S1aReadOnlySource): S1aReadOnlySource {
  return {
    ...source,
    async readInputFile(path: string, maxBytes: number): Promise<Uint8Array<ArrayBufferLike>> {
      if (path === "evidence") throw new Error("unavailable");
      return source.readInputFile(path, maxBytes);
    },
  };
}

function parsed(source: S1aReadOnlySource, path: string, value: unknown): S1aReadOnlySource {
  return {
    ...source,
    async readInputFile(inputPath: string, maxBytes: number): Promise<Uint8Array<ArrayBufferLike>> {
      if (inputPath === path) return jsonBytes(value);
      return source.readInputFile(inputPath, maxBytes);
    },
  };
}

describe("runS1dDiagnostic", () => {
  it("allCoreResultsPreserved", async () => {
    const context = await run();
    const baseline = await loadS1aArtifacts(context.request.loaderInput, context.source);
    const binder = bindEvidence({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs: [validEvidence] });
    const s1c = evaluateS1c({ schemaVersion: "justice-s1c-input-v1", baseline, planBytes, changeSet: validChangeSet, evidenceRefs: [validEvidence] });
    expect(context.report.stages).toEqual({ s1a: { state: "EVALUATED", result: baseline }, s1b: { state: "EVALUATED", result: binder }, s1c: { state: "EVALUATED", result: s1c } });
    expect(context.report.stages.s1c.state === "EVALUATED" && context.report.stages.s1c.result.formalVerdict).toBe("UNKNOWN");
    expect(context.report).not.toHaveProperty("scopeFallback");
  });

  it("levelBInvalidEvidenceRetainsScope", async () => {
    const { report } = await run({ invalid: true });
    expect(report.stages.s1b.state === "EVALUATED" && report.stages.s1b.result.evaluationStatus).toBe("INPUT_REJECTED");
    expect(report.stages.s1c.state === "EVALUATED" && report.stages.s1c.result.diagnostics.map((item) => item.code)).toContain("S1B_INPUT_REJECTED");
    expect(report.stages.s1c.state === "EVALUATED" && report.stages.s1c.result.candidateScopeComparison).toBe("WITHIN_CANDIDATE_SCOPE");
    expect(report.provenance).toMatchObject({ state: "WITHHELD", reason: "EVIDENCE_SET_INVALID" });
    expect(report.inputIssues).toEqual([]);
  });

  it("levelBInvalidChangeSetRetainsEvidence", async () => {
    const { report } = await run([validEvidence], { availability: "PRESENT", changes: "invalid" });
    expect(report.stages.s1b.state === "EVALUATED" && report.stages.s1b.result.bindingResults).toHaveLength(1);
    expect(report.stages.s1c.state === "EVALUATED" && report.stages.s1c.result.diagnostics.map((item) => item.code)).toContain("CHANGESET_INVALID");
    expect(report.provenance.state).toBe("CLAIMS_AVAILABLE");
    expect(report).not.toHaveProperty("scopeFallback");
  });

  it("evidenceLevelAScopeFallbackPresenceRule", async () => {
    const context = await setup();
    const source = unavailableEvidenceSource(context.source);
    const report = await runS1dDiagnostic(context.request, source);
    expect(report.stages.s1b).toEqual({ state: "NOT_EVALUATED", reason: "EVIDENCE_SOURCE_UNAVAILABLE" });
    expect(report.stages.s1c).toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
    expect(report.scopeFallback).toEqual({ state: "EVALUATED", provenance: "S1C_EXISTING_SCOPE_PRIMITIVES", candidateScopeComparison: "WITHIN_CANDIDATE_SCOPE", outsidePaths: [], formalVerdictAvailable: false, limitation: "NO_FORMAL_S1C_RESULT" });
  });

  it("changesetLevelAOmitsFallback", async () => {
    const context = await setup();
    const changeReadFailure = parsed(context.source, "changeset", undefined);
    const source: S1aReadOnlySource = {
      ...changeReadFailure,
      async readInputFile(path, maxBytes) {
        if (path === "changeset") throw new Error("unavailable");
        return changeReadFailure.readInputFile(path, maxBytes);
      },
    };
    const report = await runS1dDiagnostic(context.request, source);
    expect(report.stages.s1b.state).toBe("EVALUATED");
    expect(report.stages.s1c).toEqual({ state: "NOT_EVALUATED", reason: "CHANGESET_SOURCE_UNAVAILABLE" });
    expect(report).not.toHaveProperty("scopeFallback");
    const bothUnavailable = await runS1dDiagnostic(context.request, unavailableEvidenceSource(source));
    expect(bothUnavailable.inputIssues.map((issue) => issue.source)).toEqual(["evidence", "changeset"]);
    expect(bothUnavailable).not.toHaveProperty("scopeFallback");
  });

  it("notReadyBaselineWithCapturedPlanStillInvokesS1c", async () => {
    const { report } = await run([validEvidence], validChangeSet, true);
    expect(report.stages.s1a.state === "EVALUATED" && report.stages.s1a.result.identityStatus).toBe("MISMATCH");
    expect(report.stages.s1c.state).toBe("EVALUATED");
    expect(report.stages.s1c.state === "EVALUATED" && report.stages.s1c.result.diagnostics.map((item) => item.code)).toContain("S1A_BASELINE_NOT_READY");
    expect(report.stages.s1c.state === "EVALUATED" && report.stages.s1c.result.candidateScopeComparison).toBe("UNKNOWN");
  });

  it("planDigestMismatchPreservesCoreBaselineDiagnostic", async () => {
    const { report, selectedPlan } = await run([validEvidence], validChangeSet, true);
    expect(selectedPlan).toBeDefined();
    expect(report.stages.s1a.state === "EVALUATED" && report.stages.s1a.result.identityStatus).toBe("MISMATCH");
    expect(report.stages.s1b.state).toBe("EVALUATED");
    expect(report.stages.s1c.state).toBe("EVALUATED");
    expect(report.stages.s1c.state === "EVALUATED" && report.stages.s1c.result.diagnostics.map((item) => item.code)).toContain("S1A_BASELINE_NOT_READY");
    expect(report.stages.s1c.state === "EVALUATED" && report.stages.s1c.result.candidateScopeComparison).toBe("UNKNOWN");
    expect(report).not.toHaveProperty("scopeFallback");
  });

  it("planDigestMismatchWithEvidenceLevelAKeepsFallbackUnevaluated", async () => {
    const context = await setup(undefined, validChangeSet, true);
    const report = await runS1dDiagnostic(context.request, unavailableEvidenceSource(context.source));
    expect(report.stages.s1c).toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
    expect(report.scopeFallback).toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
  });

  it("missingPlanAllowsS1bOnly", async () => {
    const context = await setup();
    const source: S1aReadOnlySource = {
      ...context.source,
      async readArtifact(root, path, cap) {
        if (path === "plan-1.md") throw new Error("missing");
        return context.source.readArtifact(root, path, cap);
      },
    };
    const report = await runS1dDiagnostic(context.request, source);
    expect(report.stages.s1b.state).toBe("EVALUATED");
    expect(report.stages.s1c).toEqual({ state: "NOT_EVALUATED", reason: "PLAN_SNAPSHOT_UNAVAILABLE" });
  });

  it("evidenceProvenanceInvalidWithholdsAll", async () => {
    const invalidRef = { ...validEvidence, evidenceId: "bad id" };
    const { report } = await run([validEvidence, invalidRef]);
    expect(report.provenance).toEqual({ state: "WITHHELD", reason: "EVIDENCE_SET_INVALID", claims: [] });
  });
});
