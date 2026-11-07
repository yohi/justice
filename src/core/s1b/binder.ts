import type {
  BinderInput,
  BinderResult,
  BindingReasonCode,
  BindingResult,
  CoverageResult,
  EvidenceRefV1,
  InputRejectionReason,
} from "./contract.js";
import { inspectBaseline } from "./baseline.js";
import { inspectEvidenceRefs, primaryRejectionReason, S1B_LIMITATIONS } from "./validation.js";

const INPUT_KEYS = new Set(["schemaVersion", "baseline", "evidenceRefs"]);
const BINDING_REASON_ORDER: readonly BindingReasonCode[] = [
  "TASK_NOT_SELECTED",
  "TASK_REVISION_MISMATCH",
  "SCOPE_MISMATCH",
  "AC_NOT_SELECTED",
  "AC_REVISION_MISMATCH",
  "AC_TASK_MISMATCH",
];

function compareLexically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDataProperty(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function hasExactEnvelope(value: unknown): value is BinderInput {
  if (!isRecord(value) || !Object.keys(value).every((key) => INPUT_KEYS.has(key))) return false;
  return Object.keys(value).length === INPUT_KEYS.size &&
    readDataProperty(value, "schemaVersion") === "justice-s1b-input-v1" &&
    Object.hasOwn(value, "baseline") && Object.hasOwn(value, "evidenceRefs");
}

function snapshotEnvelope(value: unknown): Readonly<{
  valid: boolean;
  baseline: unknown;
  evidenceRefs: unknown;
}> {
  try {
    return {
      valid: hasExactEnvelope(value),
      baseline: isRecord(value) ? readDataProperty(value, "baseline") : undefined,
      evidenceRefs: isRecord(value) ? readDataProperty(value, "evidenceRefs") : undefined,
    };
  } catch {
    return { valid: false, baseline: undefined, evidenceRefs: undefined };
  }
}

function freezeBinding(result: BindingResult): BindingResult {
  return Object.freeze({ ...result, reasonCodes: Object.freeze([...result.reasonCodes]) });
}

function makeBinding(
  ref: EvidenceRefV1,
  status: BindingResult["bindingStatus"],
  reasons: readonly BindingReasonCode[],
): BindingResult {
  return freezeBinding({
    evidenceId: ref.evidenceId,
    bindingStatus: status,
    reasonCodes: reasons,
    reportedExecutionState: ref.reportedExecutionState,
    ...(ref.reportedOutcome !== undefined ? { reportedOutcome: ref.reportedOutcome } : {}),
    authenticityStatus: "NOT_VERIFIED",
    executionVerificationStatus: "NOT_VERIFIED",
  });
}

function unknownCoverage(acs: readonly { readonly artifactId: string; readonly revision: string }[]): readonly CoverageResult[] {
  return Object.freeze(acs
    .map((ac) => Object.freeze({
      acRef: Object.freeze({ artifactId: ac.artifactId, revision: ac.revision }),
      coverageStatus: "UNKNOWN" as const,
      matchingEvidenceIds: Object.freeze([] as string[]),
    }))
    .sort((left, right) => compareLexically(left.acRef.artifactId, right.acRef.artifactId)));
}

function knownReadyCoverage(inspection: ReturnType<typeof inspectBaseline>): readonly CoverageResult[] {
  return inspection.state === "READY" ? unknownCoverage(inspection.selection.acs) : [];
}

function result(
  evaluationStatus: BinderResult["evaluationStatus"],
  bindingResults: readonly BindingResult[],
  coverageResults: readonly CoverageResult[],
  coverageAssessmentStatus: BinderResult["coverageAssessmentStatus"],
  rejectionReasonCode?: InputRejectionReason,
): BinderResult {
  return Object.freeze({
    schemaVersion: "justice-s1b-result-v1",
    evaluationStatus,
    bindingResults: Object.freeze([...bindingResults]),
    coverageResults: Object.freeze([...coverageResults]),
    coverageAssessmentStatus,
    ...(rejectionReasonCode ? { rejectionReasonCode } : {}),
    authenticityStatus: "NOT_VERIFIED",
    executionVerificationStatus: "NOT_VERIFIED",
    limitations: S1B_LIMITATIONS,
  });
}

function bindReady(ref: EvidenceRefV1, task: { readonly artifactId: string; readonly revision: string; readonly scopeKey: string }, acs: readonly { readonly artifactId: string; readonly revision: string; readonly parentId?: string }[]): BindingResult {
  const reasons = new Set<BindingReasonCode>();
  if (ref.taskRef.artifactId !== task.artifactId) {
    reasons.add("TASK_NOT_SELECTED");
  } else if (ref.taskRef.revision !== task.revision) {
    reasons.add("TASK_REVISION_MISMATCH");
  }
  if (ref.scopeKey !== task.scopeKey) reasons.add("SCOPE_MISMATCH");
  if (ref.acRef) {
    const selectedAc = acs.find((ac) => ac.artifactId === ref.acRef?.artifactId);
    if (!selectedAc) {
      reasons.add("AC_NOT_SELECTED");
    } else {
      if (ref.acRef.revision !== selectedAc.revision) reasons.add("AC_REVISION_MISMATCH");
      if (selectedAc.parentId !== ref.taskRef.artifactId) reasons.add("AC_TASK_MISMATCH");
    }
  }
  const ordered = BINDING_REASON_ORDER.filter((reason) => reasons.has(reason));
  return makeBinding(ref, ordered.length === 0 ? "MATCH" : "MISMATCH", ordered);
}

export function bindEvidence(input: BinderInput): BinderResult {
  const envelope = snapshotEnvelope(input);
  const evidenceInspection = inspectEvidenceRefs(envelope.evidenceRefs);
  let baselineInspection: ReturnType<typeof inspectBaseline>;
  try {
    baselineInspection = inspectBaseline(envelope.baseline);
  } catch {
    baselineInspection = { state: "MALFORMED" };
  }

  const defects: InputRejectionReason[] = [...evidenceInspection.issueCodes];
  if (!envelope.valid) defects.push("INPUT_SCHEMA_INVALID");
  if (baselineInspection.state === "MALFORMED") defects.push("BASELINE_SHAPE_INVALID");
  if (defects.length > 0) {
    return result("INPUT_REJECTED", [], knownReadyCoverage(baselineInspection), "UNKNOWN", primaryRejectionReason(defects));
  }

  const refs = evidenceInspection.refs ?? [];
  if (baselineInspection.state === "NOT_READY") {
    const bindings = refs.map((ref) => makeBinding(ref, "UNKNOWN", ["BASELINE_NOT_READY"]))
      .sort((left, right) => compareLexically(left.evidenceId, right.evidenceId));
    return result("BASELINE_UNKNOWN", bindings, [], "UNKNOWN");
  }

  if (baselineInspection.state !== "READY") {
    return result("INPUT_REJECTED", [], [], "UNKNOWN", "BASELINE_SHAPE_INVALID");
  }

  const { task, acs } = baselineInspection.selection;
  const bindings = refs.map((ref) => bindReady(ref, task, acs))
    .sort((left, right) => compareLexically(left.evidenceId, right.evidenceId));
  const coverage = acs.map((ac) => {
    const matchingEvidenceIds = refs
      .filter((ref) => ref.acRef !== undefined && ref.acRef.artifactId === ac.artifactId && ref.acRef.revision === ac.revision)
      .filter((ref) => bindings.find((binding) => binding.evidenceId === ref.evidenceId)?.bindingStatus === "MATCH")
      .map((ref) => ref.evidenceId)
      .sort(compareLexically);
    return Object.freeze({
      acRef: Object.freeze({ artifactId: ac.artifactId, revision: ac.revision }),
      coverageStatus: matchingEvidenceIds.length > 0 ? "MATCHED_REF_PRESENT" as const : "MISSING_EVIDENCE" as const,
      matchingEvidenceIds: Object.freeze(matchingEvidenceIds),
    });
  }).sort((left, right) => compareLexically(left.acRef.artifactId, right.acRef.artifactId));
  return result("EVALUATED", bindings, coverage, "ASSESSABLE");
}
