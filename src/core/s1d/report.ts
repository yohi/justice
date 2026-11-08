import type { BinderResult, EvidenceRefV1 } from "../s1b/contract.js";
import { inspectEvidenceRefs } from "../s1b/validation.js";
import type {
  InputIssue,
  ProvenanceProjection,
  S1dReportV1,
  ScopeFallback,
  Stage,
} from "./contract.js";

type ParsedEvidence = Readonly<{ state: "PARSED"; value: unknown }>;
type UnavailableEvidence = Readonly<{ state: "LEVEL_A_ERROR" }>;
type EvidenceSource = ParsedEvidence | UnavailableEvidence;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function withheld(reason: Extract<ProvenanceProjection, { state: "WITHHELD" }>['reason']): ProvenanceProjection {
  return Object.freeze({ state: "WITHHELD", reason, claims: Object.freeze([] as const) });
}

export function projectProvenance(evidence: EvidenceSource, stage: Stage<BinderResult>): ProvenanceProjection {
  if (evidence.state === "LEVEL_A_ERROR") return withheld("EVIDENCE_SOURCE_UNAVAILABLE");

  const inspection = inspectEvidenceRefs(evidence.value);
  if (inspection.issueCodes.length !== 0 || inspection.refs === null) return withheld("EVIDENCE_SET_INVALID");
  if (stage.state !== "EVALUATED" || (stage.result.evaluationStatus !== "EVALUATED" && stage.result.evaluationStatus !== "BASELINE_UNKNOWN")) {
    return withheld("BINDING_NOT_AVAILABLE");
  }

  const refs: readonly EvidenceRefV1[] = inspection.refs;
  const projectedIds = new Set(refs.map((ref) => ref.evidenceId));
  const bindingIds = stage.result.bindingResults.map((binding) => binding.evidenceId);
  if (
    projectedIds.size !== refs.length ||
    bindingIds.length !== projectedIds.size ||
    new Set(bindingIds).size !== bindingIds.length ||
    bindingIds.some((id) => !projectedIds.has(id))
  ) return withheld("BINDING_INCONSISTENT");

  const claims = refs
    .map((ref) => Object.freeze({
      evidenceId: ref.evidenceId,
      issuerId: ref.issuerId,
      originId: ref.originId,
      provenanceClass: ref.provenanceClass,
    }))
    .sort((left, right) => compareCodeUnits(left.evidenceId, right.evidenceId));
  return Object.freeze({
    state: "CLAIMS_AVAILABLE",
    validation: "ALL_EVIDENCE_REFS_STRUCTURALLY_VALID",
    verification: "NOT_VERIFIED",
    claims: Object.freeze(claims),
  });
}

type AssembleReportInput = Readonly<{
  stages: S1dReportV1["stages"];
  inputIssues: readonly InputIssue[];
  provenance: ProvenanceProjection;
  scopeFallback?: ScopeFallback;
}>;

export function assembleReport(input: AssembleReportInput): S1dReportV1 {
  const limitations = new Set<string>();
  for (const stage of Object.values(input.stages)) {
    if (stage.state === "EVALUATED") {
      for (const limitation of stage.result.limitations) limitations.add(limitation);
    }
  }
  limitations.add("OWNER_AUTHORITY_NOT_PROVEN");
  if (input.provenance.state === "CLAIMS_AVAILABLE") limitations.add("DECLARED_PROVENANCE_NOT_VERIFIED");
  if (input.scopeFallback !== undefined) limitations.add("NO_FORMAL_S1C_RESULT");

  const stages = Object.freeze({
    s1a: Object.freeze({ ...input.stages.s1a }),
    s1b: Object.freeze({ ...input.stages.s1b }),
    s1c: Object.freeze({ ...input.stages.s1c }),
  });
  const inputIssues = Object.freeze(input.inputIssues.map((issue) => Object.freeze({ ...issue })));
  let provenance: ProvenanceProjection;
  if (input.provenance.state === "CLAIMS_AVAILABLE") {
    provenance = Object.freeze({
      ...input.provenance,
      claims: Object.freeze(input.provenance.claims.map((claim) => Object.freeze({ ...claim }))),
    });
  } else {
    provenance = withheld(input.provenance.reason);
  }
  return Object.freeze({
    schemaVersion: "justice-s1d-report-v1",
    operation: "diagnose",
    readOnly: true,
    stages,
    inputIssues,
    provenance,
    ...(input.scopeFallback !== undefined ? { scopeFallback: Object.freeze(input.scopeFallback.state === "EVALUATED"
      ? { ...input.scopeFallback, outsidePaths: Object.freeze([...input.scopeFallback.outsidePaths]) }
      : { ...input.scopeFallback }) } : {}),
    limitations: Object.freeze([...limitations].sort(compareCodeUnits)),
  });
}
