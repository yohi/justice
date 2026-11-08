import { describe, expect, it } from "vitest";
import type { S1aReadOnlySource, TaskIntent, OwnerManifest, LoaderResult } from "../../src/core/s1a/contract.js";
import type { BinderResult, EvidenceRefV1 } from "../../src/core/s1b/contract.js";
import type { ChangeSet, S1cDiagnostic, S1cResult } from "../../src/core/s1c/contract.js";
import type { S1dReportV1 } from "../../src/core/s1d/contract.js";
import { formatJson, formatText } from "../../src/core/s1d/formatter.js";
import { runS1dDiagnostic } from "../../src/runtime/s1d-diagnostic.js";
import type { DiagnosticRequest } from "../../src/runtime/s1d-diagnostic.js";
import { jsonBytes, s1aFixture, sha256 } from "../helpers/s1a-fixtures.js";

// File-local S1-e acceptance fixture. Not a production API; all reads are injected and in-memory.
const TASK_A = { artifactId: "task-1", revision: "R1" } as const;
const TASK_B = { artifactId: "task-2", revision: "R1" } as const;
const AC_1 = { artifactId: "ac-1", revision: "R1" } as const;
const AC_2 = { artifactId: "ac-2", revision: "R1" } as const;

function planTextFor(): string {
  return [
    "## Justice S1-c Task Scope Policies",
    "<!-- justice:s1c-task-scope:begin -->",
    JSON.stringify({ schemaVersion: "justice-s1c-task-scope-v1", planRef: { artifactId: "plan-1", revision: "R1" }, taskRef: TASK_A, scopeKey: "scope-1", allowedPaths: ["src/**"] }),
    "<!-- justice:s1c-task-scope:end -->",
  ].join("\n");
}

function evidence(id: string, acRef: EvidenceRefV1["acRef"], taskRef: EvidenceRefV1["taskRef"] = TASK_A): EvidenceRefV1 {
  return {
    evidenceId: id, type: "test", taskRef, scopeKey: "scope-1", acRef,
    issuerId: "issuer-1", originId: "origin-1",
    provenanceClass: "SELF_DECLARED", reportedExecutionState: "EXECUTED", reportedOutcome: "PASS",
  };
}

type S1eOptions = Readonly<{
  intentPlanRevision?: string;
  intentAc?: TaskIntent["ac"];
  planBytesOverride?: Uint8Array; // served bytes; Manifest digest still pins the original
  evidenceRefs?: unknown;
  changeSet?: unknown;
  failReads?: Readonly<{ evidence?: Error; changeset?: Error }>;
}>;

type S1eFixture = Readonly<{
  request: DiagnosticRequest;
  source: S1aReadOnlySource;
  manifest: OwnerManifest;
  intent: TaskIntent;
  planBytes: Uint8Array;
  evidenceRefs: readonly EvidenceRefV1[];
  changeSet: ChangeSet;
}>;

function makeS1eFixture(options: S1eOptions = {}): S1eFixture {
  const base = s1aFixture();
  const planBytes = new TextEncoder().encode(planTextFor());
  const taskBBytes = new TextEncoder().encode("task-2");
  const taskA = base.manifest.artifacts.find((a) => a.artifactId === "task-1")!;
  const manifest: OwnerManifest = {
    ...base.manifest,
    artifacts: [
      ...base.manifest.artifacts.map((ref) => ref.artifactId === "plan-1"
        ? { ...ref, digest: { algorithm: "sha256" as const, hex: sha256(planBytes) } }
        : ref),
      { ...taskA, artifactId: "task-2", parentId: "plan-1", relativePath: "task-2.md", digest: { algorithm: "sha256" as const, hex: sha256(taskBBytes) } },
    ],
  };
  const intent: TaskIntent = {
    ...base.intent,
    plan: { artifactId: "plan-1", revision: options.intentPlanRevision ?? "R1" },
    ac: options.intentAc ?? base.intent.ac,
  };
  const evidenceRefs = (options.evidenceRefs ?? [evidence("ev-1", AC_1), evidence("ev-2", AC_2)]) as readonly EvidenceRefV1[];
  const changeSet = (options.changeSet ?? { availability: "PRESENT", changes: [{ kind: "ADD", path: "src/a.ts" }] }) as ChangeSet;
  const files = new Map(Object.entries(base.files));
  files.set("task-2.md", taskBBytes);
  const servedPlan = options.planBytesOverride ?? planBytes;
  const source: S1aReadOnlySource = {
    async readInputFile(path) {
      if (path === "evidence") { if (options.failReads?.evidence) throw options.failReads.evidence; return jsonBytes(evidenceRefs); }
      if (path === "changeset") { if (options.failReads?.changeset) throw options.failReads.changeset; return jsonBytes(changeSet); }
      return jsonBytes(path === "manifest" ? manifest : intent);
    },
    async readArtifact(_root, path) {
      return path === "plan-1.md" ? servedPlan : files.get(path) ?? new Uint8Array();
    },
  };
  const request: DiagnosticRequest = {
    loaderInput: { ...base.input, expectedManifestSha256: sha256(jsonBytes(manifest)) },
    evidencePath: "evidence", changesetPath: "changeset",
  };
  return { request, source, manifest, intent, planBytes, evidenceRefs, changeSet };
}

async function run(options?: S1eOptions): Promise<S1dReportV1> {
  const fx = makeS1eFixture(options);
  const report = await runS1dDiagnostic(fx.request, fx.source);
  assertS1cBoundary(report);
  return report;
}

function assertS1cBoundary(report: S1dReportV1): void {
  const s1c = report.stages.s1c;
  if (s1c.state === "EVALUATED") {
    expect(s1c.result.formalVerdict).toBe("UNKNOWN");
  } else {
    expect(s1c.state).toBe("NOT_EVALUATED");
    expect(s1c.reason).toBeTruthy();
    expect(s1c).not.toHaveProperty("result");
    expect(s1c).not.toHaveProperty("formalVerdict");
  }
}

function s1a(report: S1dReportV1): LoaderResult {
  if (report.stages.s1a.state !== "EVALUATED") throw new Error("s1a not evaluated");
  return report.stages.s1a.result;
}
function s1b(report: S1dReportV1): BinderResult {
  if (report.stages.s1b.state !== "EVALUATED") throw new Error("s1b not evaluated");
  return report.stages.s1b.result;
}
function s1c(report: S1dReportV1): S1cResult {
  if (report.stages.s1c.state !== "EVALUATED") throw new Error("s1c not evaluated");
  return report.stages.s1c.result;
}
const s1cCodes = (report: S1dReportV1): readonly S1cDiagnostic["code"][] => s1c(report).diagnostics.map((d) => d.code);

describe("S1-e acceptance", () => {
  it("s1ePositiveKeepsAuthorityUnknown", async () => {
    const report = await run();
    expect(report.stages.s1a.state).toBe("EVALUATED");
    expect(report.stages.s1b.state).toBe("EVALUATED");
    expect(report.stages.s1c.state).toBe("EVALUATED");
    expect(s1a(report).identityStatus).toBe("MATCH");
    expect(s1a(report).ownerAuthorityStatus).toBe("NOT_PROVEN");
    expect(s1a(report).eligibleBaseline).toBe(false);
    const b = s1b(report);
    expect(b.bindingResults).toHaveLength(2);
    expect(b.bindingResults.every((r) => r.bindingStatus === "MATCH")).toBe(true);
    expect(b.coverageResults.map((c) => [c.acRef.artifactId, c.coverageStatus])).toEqual([["ac-1", "MATCHED_REF_PRESENT"], ["ac-2", "MATCHED_REF_PRESENT"]]);
    expect(b.authenticityStatus).toBe("NOT_VERIFIED");
    expect(b.executionVerificationStatus).toBe("NOT_VERIFIED");
    const c = s1c(report);
    expect(c.candidateScopeComparison).toBe("WITHIN_CANDIDATE_SCOPE");
    expect(c.formalVerdict).toBe("UNKNOWN");
    const codes = s1cCodes(report);
    expect(codes).not.toContain("OUTSIDE_CANDIDATE_SCOPE");
    expect(codes).not.toContain("S1B_BINDING_MISMATCH");
    expect(codes).not.toContain("AC_EVIDENCE_REF_MISSING");
  });

  it("s1eStalePlanRevision", async () => {
    const report = await run({ intentPlanRevision: "R2" });
    const a = s1a(report);
    expect(a.checks.map((c) => c.reasonCode)).toContain("REVISION_MISMATCH");
    expect(a.identityStatus).toBe("MISMATCH");
    expect(a.ownerAuthorityStatus).toBe("NOT_PROVEN");
    expect(a.eligibleBaseline).toBe(false);
  });

  it("s1eTamperedPlanBytes", async () => {
    const report = await run({ planBytesOverride: new TextEncoder().encode("tampered plan") });
    const a = s1a(report);
    expect(a.checks.some((c) => c.targetId === "artifact:plan-1" && c.check === "artifact_digest" && c.reasonCode === "ARTIFACT_DIGEST_MISMATCH")).toBe(true);
    expect(a.identityStatus).toBe("MISMATCH");
    expect(a.ownerAuthorityStatus).toBe("NOT_PROVEN");
    expect(a.eligibleBaseline).toBe(false);
    expect(s1c(report).candidateScopeComparison).toBe("UNKNOWN");
    expect(s1cCodes(report)).toContain("S1A_BASELINE_NOT_READY");
  });

  it("s1eWrongTaskEvidence", async () => {
    const report = await run({ evidenceRefs: [evidence("ev-1", AC_1, TASK_B), evidence("ev-2", AC_2)] });
    const b = s1b(report);
    const wrong = b.bindingResults.find((r) => r.evidenceId === "ev-1")!;
    expect(wrong.bindingStatus).toBe("MISMATCH");
    expect(wrong.reasonCodes).toContain("TASK_NOT_SELECTED");
    expect(b.coverageResults.find((c) => c.acRef.artifactId === "ac-1")!.coverageStatus).not.toBe("MATCHED_REF_PRESENT");
    expect(b.coverageResults.find((c) => c.acRef.artifactId === "ac-2")!.coverageStatus).toBe("MATCHED_REF_PRESENT");
  });

  it("s1eMissingMandatoryAc", async () => {
    const fx = makeS1eFixture({ intentAc: [AC_1] });
    const report = await runS1dDiagnostic(fx.request, fx.source);
    assertS1cBoundary(report);
    const a = s1a(report);
    expect(a.checks.some((c) => c.reasonCode === "REQUIRED_AC_MISSING")).toBe(true);
    // Nothing else altered: manifest still lists both ACs with R1 and untouched digests.
    const base = s1aFixture();
    for (const id of ["ac-1", "ac-2", "task-1", "design-1"]) {
      expect(fx.manifest.artifacts.find((x) => x.artifactId === id)).toEqual(base.manifest.artifacts.find((x) => x.artifactId === id));
    }
    expect(fx.intent.plan).toEqual({ artifactId: "plan-1", revision: "R1" });
    expect(a.checks.map((c) => c.reasonCode)).not.toContain("ARTIFACT_DIGEST_MISMATCH");
    expect(a.checks.map((c) => c.reasonCode)).not.toContain("REVISION_MISMATCH");
    expect(a.eligibleBaseline).toBe(false);
  });

  it("s1eAcWithoutEvidence", async () => {
    const report = await run({ evidenceRefs: [evidence("ev-1", AC_1)] });
    const b = s1b(report);
    expect(b.coverageResults.find((c) => c.acRef.artifactId === "ac-2")!.coverageStatus).toBe("MISSING_EVIDENCE");
    expect(b.coverageResults.find((c) => c.acRef.artifactId === "ac-1")!.coverageStatus).toBe("MATCHED_REF_PRESENT");
    expect(s1c(report).diagnostics).toContainEqual({ code: "AC_EVIDENCE_REF_MISSING", acId: "ac-2" });
    expect(s1c(report).diagnostics).not.toContainEqual({ code: "AC_EVIDENCE_REF_MISSING", acId: "ac-1" });
  });

  it("s1eOutsideCandidateScope", async () => {
    const report = await run({ changeSet: { availability: "PRESENT", changes: [{ kind: "ADD", path: "docs/outside.ts" }] } });
    const c = s1c(report);
    expect(c.candidateScopeComparison).toBe("OUTSIDE_CANDIDATE_SCOPE");
    expect(c.diagnostics).toContainEqual({ code: "OUTSIDE_CANDIDATE_SCOPE", path: "docs/outside.ts" });
    expect(c.formalVerdict).toBe("UNKNOWN");
  });

  it("s1eSelfDeclaredPassIsUnverified", async () => {
    const report = await run();
    const c = s1c(report);
    expect(c.reportedEvidenceClaims).toContainEqual({ evidenceId: "ev-1", reportedOutcome: "PASS", reportedExecutionState: "EXECUTED" });
    expect(report.provenance.state).toBe("CLAIMS_AVAILABLE");
    if (report.provenance.state === "CLAIMS_AVAILABLE") {
      expect(report.provenance.claims.every((x) => x.provenanceClass === "SELF_DECLARED")).toBe(true);
      expect(report.provenance.verification).toBe("NOT_VERIFIED");
    }
    const b = s1b(report);
    for (const r of b.bindingResults) {
      expect(r.reportedOutcome).toBe("PASS");
      expect(r.reportedExecutionState).toBe("EXECUTED");
      expect(r.authenticityStatus).toBe("NOT_VERIFIED");
      expect(r.executionVerificationStatus).toBe("NOT_VERIFIED");
    }
    expect(b.authenticityStatus).toBe("NOT_VERIFIED");
    expect(b.executionVerificationStatus).toBe("NOT_VERIFIED");
  });

  it("s1eApprovalRefNeverProvesAuthority", async () => {
    const fx = makeS1eFixture();
    expect(fx.manifest.artifacts.every((a) => a.approvalRef.length > 0)).toBe(true);
    const report = await runS1dDiagnostic(fx.request, fx.source);
    assertS1cBoundary(report);
    expect(s1a(report).ownerAuthorityStatus).toBe("NOT_PROVEN");
    expect(s1a(report).eligibleBaseline).toBe(false);
    expect(s1c(report).formalVerdict).toBe("UNKNOWN");
  });

  it("s1eInvalidEvidenceIsLevelB", async () => {
    const report = await run({ evidenceRefs: { invalid: true } });
    expect(report.inputIssues).toEqual([]);
    expect(report.stages.s1b.state).toBe("EVALUATED");
    expect(s1b(report).evaluationStatus).toBe("INPUT_REJECTED");
    expect(report.stages.s1c.state).toBe("EVALUATED");
    expect(s1cCodes(report)).toContain("S1B_INPUT_REJECTED");
    expect(s1c(report).formalVerdict).toBe("UNKNOWN");
  });

  it("s1eUnreadableEvidenceIsLevelA", async () => {
    const report = await run({ failReads: { evidence: new Error("boom") } });
    expect(report.inputIssues).toEqual([{ source: "evidence", code: "INPUT_READ_FAILED" }]);
    expect(report.stages.s1b).toEqual({ state: "NOT_EVALUATED", reason: "EVIDENCE_SOURCE_UNAVAILABLE" });
    expect(report.stages.s1c).toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
    expect(report.scopeFallback?.state).toBe("EVALUATED");
    expect(report.scopeFallback).toMatchObject({ state: "EVALUATED", formalVerdictAvailable: false, candidateScopeComparison: "WITHIN_CANDIDATE_SCOPE" });
  });

  it("s1eUnavailableChangeSetIsEvaluated", async () => {
    const report = await run({ changeSet: { availability: "UNAVAILABLE" } });
    expect(report.inputIssues).toEqual([]);
    expect(report.stages.s1c.state).toBe("EVALUATED");
    expect(s1cCodes(report)).toContain("CHANGESET_UNAVAILABLE");
    expect(s1c(report).candidateScopeComparison).toBe("UNKNOWN");
    expect(s1c(report).formalVerdict).toBe("UNKNOWN");
  });

  it("s1eUnreadableChangeSetIsNotEvaluated", async () => {
    const report = await run({ failReads: { changeset: new Error("boom") } });
    expect(report.inputIssues).toEqual([{ source: "changeset", code: "INPUT_READ_FAILED" }]);
    expect(report.stages.s1b.state).toBe("EVALUATED");
    expect(report.stages.s1c).toEqual({ state: "NOT_EVALUATED", reason: "CHANGESET_SOURCE_UNAVAILABLE" });
    expect(report).not.toHaveProperty("scopeFallback");
  });

  it("s1eReportOutputRespectsSafePathBoundary", async () => {
    const report = await run({ changeSet: { availability: "PRESENT", changes: [{ kind: "ADD", path: "docs/outside.ts" }] } });
    expect(formatText(report)).toContain("docs/outside.ts");
    expect(formatJson(report)).toContain("docs/outside.ts");

    const abs = await run({ changeSet: { availability: "PRESENT", changes: [{ kind: "ADD", path: "/home/private/secret.txt" }] } });
    expect(s1cCodes(abs)).toContain("CHANGESET_INVALID");
    expect(s1c(abs).candidateScopeComparison).toBe("UNKNOWN");
    for (const out of [formatText(abs), formatJson(abs)]) {
      expect(out).not.toContain("/home/private");
      expect(out).not.toContain("secret.txt");
    }

    const marker = "SECRET_MARKER_9f3a at Object.<anonymous> (/home/private/stack.js:1:1)";
    const failed = await run({ failReads: { evidence: new Error(marker), changeset: new Error(marker) } });
    expect(failed.inputIssues).toEqual([{ source: "evidence", code: "INPUT_READ_FAILED" }, { source: "changeset", code: "INPUT_READ_FAILED" }]);
    for (const out of [formatText(failed), formatJson(failed)]) {
      expect(out).toContain("INPUT_READ_FAILED");
      expect(out).not.toContain("SECRET_MARKER");
      expect(out).not.toContain("stack.js");
      expect(out).not.toContain("/home/private");
    }
  });

  it("s1eDeterministicOutputAndNoUnrequestedActions", async () => {
    const reads: string[] = [];
    const outputs: string[][] = [];
    for (let i = 0; i < 2; i += 1) {
      const fx = makeS1eFixture();
      const spy: S1aReadOnlySource = {
        async readInputFile(path, max) { reads.push(`input:${path}`); return fx.source.readInputFile(path, max); },
        async readArtifact(root, path, max) { reads.push(`artifact:${path}`); return fx.source.readArtifact(root, path, max); },
      };
      const report = await runS1dDiagnostic(fx.request, spy);
      outputs.push([formatText(report), formatJson(report)]);
    }
    expect(outputs[0]).toEqual(outputs[1]);
    const half = reads.length / 2;
    expect(reads.slice(0, half)).toEqual(reads.slice(half));
    expect([...new Set(reads)].sort()).toEqual(["artifact:ac-1.md", "artifact:ac-2.md", "artifact:design-1.md", "artifact:plan-1.md", "artifact:task-1.md", "input:changeset", "input:evidence", "input:intent", "input:manifest"]);
    // Each source is read exactly once per run (2 runs).
    expect(reads).toHaveLength(18);
  });
});
