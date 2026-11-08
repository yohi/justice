import type { LoaderInput, S1aReadOnlySource } from "../core/s1a/contract.js";
import { loadS1aArtifacts } from "../core/s1a/loader.js";
import { bindEvidence } from "../core/s1b/binder.js";
import { evaluateS1c } from "../core/s1c/evaluator.js";
import type { S1dReportV1, Stage } from "../core/s1d/contract.js";
import { computeScopeFallback } from "../core/s1d/scope-fallback.js";
import { assembleReport, projectProvenance } from "../core/s1d/report.js";
import { createCapturedS1aSource, readS1dJsonInput } from "./s1d-read-only-input.js";

export type DiagnosticRequest = Readonly<{
  loaderInput: LoaderInput;
  evidencePath: string;
  changesetPath: string;
}>;

export async function runS1dDiagnostic(
  request: DiagnosticRequest,
  source: S1aReadOnlySource,
): Promise<S1dReportV1> {
  const [evidence, changeSet] = await Promise.all([
    readS1dJsonInput(source, request.evidencePath, "evidence"),
    readS1dJsonInput(source, request.changesetPath, "changeset"),
  ]);
  const inputIssues = [
    ...(evidence.state === "LEVEL_A_ERROR" ? [evidence.issue] : []),
    ...(changeSet.state === "LEVEL_A_ERROR" ? [changeSet.issue] : []),
  ];

  const captured = createCapturedS1aSource(source, request.loaderInput);
  const baseline = await loadS1aArtifacts(request.loaderInput, captured.source);
  const s1a: Stage<typeof baseline> = { state: "EVALUATED", result: baseline };

  let s1b: S1dReportV1["stages"]["s1b"];
  if (evidence.state === "PARSED") {
    // The Core boundary validates this untrusted parsed value and preserves its own rejection result.
    const result = bindEvidence({
      schemaVersion: "justice-s1b-input-v1",
      baseline,
      evidenceRefs: evidence.value,
    } as Parameters<typeof bindEvidence>[0]);
    s1b = { state: "EVALUATED", result };
  } else {
    s1b = { state: "NOT_EVALUATED", reason: "EVIDENCE_SOURCE_UNAVAILABLE" };
  }

  let s1c: S1dReportV1["stages"]["s1c"];
  let scopeFallback: S1dReportV1["scopeFallback"];
  const planSnapshot = captured.getPlanSnapshot(baseline);
  if (evidence.state === "PARSED" && changeSet.state === "PARSED" && planSnapshot !== null) {
    // The Core boundary independently validates both parsed values.
    const result = evaluateS1c({
      schemaVersion: "justice-s1c-input-v1",
      baseline,
      planBytes: planSnapshot,
      changeSet: changeSet.value,
      evidenceRefs: evidence.value,
    } as Parameters<typeof evaluateS1c>[0]);
    s1c = { state: "EVALUATED", result };
  } else if (evidence.state === "LEVEL_A_ERROR" && changeSet.state === "PARSED") {
    s1c = { state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" };
    scopeFallback = computeScopeFallback(baseline, planSnapshot, changeSet.value);
  } else if (changeSet.state === "LEVEL_A_ERROR") {
    s1c = { state: "NOT_EVALUATED", reason: "CHANGESET_SOURCE_UNAVAILABLE" };
  } else {
    s1c = { state: "NOT_EVALUATED", reason: "PLAN_SNAPSHOT_UNAVAILABLE" };
  }

  const provenance = projectProvenance(
    evidence.state === "PARSED" ? evidence : { state: "LEVEL_A_ERROR" },
    s1b,
  );
  return assembleReport({
    stages: { s1a, s1b, s1c },
    inputIssues,
    provenance,
    ...(scopeFallback !== undefined ? { scopeFallback } : {}),
  });
}
