import { describe, expect, it } from "vitest";
import type { LoaderResult } from "../../../src/core/s1a/contract.js";
import { loadS1aArtifacts } from "../../../src/core/s1a/loader.js";
import type { BinderInput, EvidenceRefV1 } from "../../../src/core/s1b/contract.js";
import { bindEvidence } from "../../../src/core/s1b/binder.js";
import { s1aFixture } from "../../helpers/s1a-fixtures.js";

async function readyBaseline(): Promise<LoaderResult> {
  const fixture = s1aFixture();
  return loadS1aArtifacts(fixture.input, fixture.source);
}

async function nonreadyBaseline(): Promise<LoaderResult> {
  const fixture = s1aFixture();
  return loadS1aArtifacts(fixture.input, {
    ...fixture.source,
    async readArtifact() { throw Error("unreadable"); },
  });
}

function evidence(overrides: Partial<EvidenceRefV1> = {}): EvidenceRefV1 {
  return {
    evidenceId: "evidence-1",
    type: "test",
    taskRef: { artifactId: "task-1", revision: "R1" },
    scopeKey: "scope-1",
    issuerId: "issuer-1",
    originId: "origin-1",
    provenanceClass: "FIXTURE_OBSERVATION",
    reportedExecutionState: "EXECUTED",
    ...overrides,
  };
}

function input(baseline: LoaderResult, evidenceRefs: readonly EvidenceRefV1[]): BinderInput {
  return { schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs };
}

describe("bindEvidence", () => {
  it("matchAndTaskLevelEvidence", async () => {
    const result = bindEvidence(input(await readyBaseline(), [
      evidence({ evidenceId: "task-level" }),
      evidence({ evidenceId: "ac-bound", acRef: { artifactId: "ac-1", revision: "R1" } }),
    ]));
    expect(result.evaluationStatus).toBe("EVALUATED");
    expect(result.bindingResults.map((item) => item.evidenceId)).toEqual(["ac-bound", "task-level"]);
    expect(result.bindingResults[0]?.bindingStatus).toBe("MATCH");
    expect(result.coverageResults.map((item) => item.coverageStatus)).toEqual([
      "MATCHED_REF_PRESENT", "MISSING_EVIDENCE",
    ]);
    expect(result.authenticityStatus).toBe("NOT_VERIFIED");
  });

  it("wrongTaskAndRevisionAndScopeReasons", async () => {
    const result = bindEvidence(input(await readyBaseline(), [evidence({
      taskRef: { artifactId: "task-other", revision: "R2" }, scopeKey: "scope-other",
    })]));
    expect(result.bindingResults[0]?.reasonCodes).toEqual([
      "TASK_NOT_SELECTED", "TASK_REVISION_MISMATCH", "SCOPE_MISMATCH",
    ]);
  });

  it("unknownAcNeverInventsParent", async () => {
    const result = bindEvidence(input(await readyBaseline(), [evidence({
      acRef: { artifactId: "ac-other", revision: "R1" },
    })]));
    expect(result.bindingResults[0]?.reasonCodes).toEqual(["AC_NOT_SELECTED"]);
  });

  it("selectedAcWithWrongDeclaredTaskReportsParent", async () => {
    const result = bindEvidence(input(await readyBaseline(), [evidence({
      taskRef: { artifactId: "task-other", revision: "R1" },
      acRef: { artifactId: "ac-1", revision: "R1" },
    })]));
    expect(result.bindingResults[0]?.reasonCodes).toEqual([
      "TASK_NOT_SELECTED", "AC_TASK_MISMATCH",
    ]);
  });

  it("reasonArrayOrderStableUnderInputPermutation", async () => {
    const baseline = await readyBaseline();
    const refs = [
      evidence({ evidenceId: "first", taskRef: { artifactId: "task-other", revision: "R2" }, scopeKey: "scope-other", acRef: { artifactId: "ac-1", revision: "R2" } }),
      evidence({ evidenceId: "second", taskRef: { artifactId: "task-other", revision: "R2" }, scopeKey: "scope-other", acRef: { artifactId: "ac-1", revision: "R2" } }),
    ];
    const forward = bindEvidence(input(baseline, refs)).bindingResults.map((binding) => binding.reasonCodes);
    const reversed = bindEvidence(input(baseline, [...refs].reverse())).bindingResults.map((binding) => binding.reasonCodes);
    expect(reversed).toEqual(forward);
    expect(forward[0]).toEqual([
      "TASK_NOT_SELECTED", "TASK_REVISION_MISMATCH", "SCOPE_MISMATCH",
      "AC_REVISION_MISMATCH", "AC_TASK_MISMATCH",
    ]);
  });

  it("invalidCollectionHasZeroPartialBindings", async () => {
    const baseline = await readyBaseline();
    const result = bindEvidence({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs: [evidence(), { ...evidence(), evidenceId: "bad id" }] });
    expect(result.evaluationStatus).toBe("INPUT_REJECTED");
    expect(result.bindingResults).toEqual([]);
    const malformedInput = input(baseline, []);
    Object.defineProperty(malformedInput, "schemaVersion", { value: "wrong-version" });
    const malformedEnvelope = bindEvidence(malformedInput);
    expect(malformedEnvelope.evaluationStatus).toBe("INPUT_REJECTED");
    expect(malformedEnvelope.rejectionReasonCode).toBe("INPUT_SCHEMA_INVALID");
  });

  it("unreadyBaselineHasNoMissingCoverage", async () => {
    const result = bindEvidence(input(await nonreadyBaseline(), [evidence()]));
    expect(result.evaluationStatus).toBe("BASELINE_UNKNOWN");
    expect(result.bindingResults[0]?.bindingStatus).toBe("UNKNOWN");
    expect(result.bindingResults[0]?.reasonCodes).toEqual(["BASELINE_NOT_READY"]);
    expect(result.coverageResults).toEqual([]);
    expect(result.coverageAssessmentStatus).toBe("UNKNOWN");
  });

  it("emptyReadyCollectionHasAllMissing", async () => {
    const result = bindEvidence(input(await readyBaseline(), []));
    expect(result.coverageResults.map((item) => item.coverageStatus)).toEqual([
      "MISSING_EVIDENCE", "MISSING_EVIDENCE",
    ]);
  });

  it("outputFrozenAndInputsUntouched", async () => {
    const baseline = await readyBaseline();
    const ref = evidence();
    const originalBaseline = JSON.stringify(baseline);
    const result = bindEvidence(input(baseline, [ref]));
    expect(JSON.stringify(baseline)).toBe(originalBaseline);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.bindingResults)).toBe(true);
    expect(Object.isFrozen(result.bindingResults[0])).toBe(true);
    expect(Object.isFrozen(result.bindingResults[0]?.reasonCodes)).toBe(true);
    expect(Object.isFrozen(result.coverageResults[0])).toBe(true);
    expect(Object.isFrozen(result.coverageResults[0]?.acRef)).toBe(true);
    expect(ref.evidenceId).toBe("evidence-1");
  });

  it("contradictoryS1aAggregateRejectsAsBaselineShapeInvalid", async () => {
    const baseline = await readyBaseline();
    const result = bindEvidence(input({ ...baseline, identityStatus: "UNKNOWN" }, [evidence({ evidenceId: "bad id" })]));
    expect(result.evaluationStatus).toBe("INPUT_REJECTED");
    expect(result.rejectionReasonCode).toBe("BASELINE_SHAPE_INVALID");
    expect(result.bindingResults).toEqual([]);
    expect(result.coverageAssessmentStatus).toBe("UNKNOWN");
  });
});
