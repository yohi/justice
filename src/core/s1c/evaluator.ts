import { createHash } from "node:crypto";
import { inspectBaseline } from "../s1b/baseline.js";
import { bindEvidence } from "../s1b/binder.js";
import type { LoaderResult, SelectedArtifactRef } from "../s1a/contract.js";
import { MAX_PLAN_BYTES, S1C_LIMITATIONS, type S1cDiagnostic, type S1cInput, type S1cResult } from "./contract.js";
import { compareCandidatePaths, inspectChangeSet } from "./path-rules.js";
import { extractTaskScopePolicy } from "./policy.js";
import { compareUtf8, isPlainRecord } from "./shared-utils.js";
import type { BindingResult } from "../s1b/contract.js";

const PRIORITY = ["S1C_INPUT_INVALID", "S1A_BASELINE_INVALID", "S1A_BASELINE_NOT_READY", "PLAN_BYTES_INVALID", "PLAN_IDENTITY_MISMATCH", "SCOPE_POLICY_INVALID", "SCOPE_POLICY_REFERENCE_MISMATCH", "SCOPE_POLICY_UNDEFINED", "CHANGESET_INVALID", "CHANGESET_UNAVAILABLE", "OUTSIDE_CANDIDATE_SCOPE", "S1B_INPUT_REJECTED", "S1B_BASELINE_UNKNOWN", "S1B_BINDING_MISMATCH", "AC_EVIDENCE_REF_MISSING", "OWNER_AUTHORITY_NOT_VERIFIED"] as const;
const INPUT_KEYS = ["schemaVersion", "baseline", "planBytes", "changeSet", "evidenceRefs"] as const;

function readInput(value: unknown): Readonly<{ valid: boolean; baseline: unknown; planBytes: unknown; changeSet: unknown; evidenceRefs: unknown }> {
  try {
    if (!isPlainRecord(value)) return { valid: false, baseline: undefined, planBytes: undefined, changeSet: undefined, evidenceRefs: undefined };
    const keys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const valid = keys.length === INPUT_KEYS.length && keys.every((key) => typeof key === "string" && INPUT_KEYS.includes(key as typeof INPUT_KEYS[number])) && INPUT_KEYS.every((key) => Object.hasOwn(value, key) && descriptors[key] !== undefined && "value" in descriptors[key]!) && descriptors.schemaVersion?.value === "justice-s1c-input-v1";
    return { valid, baseline: descriptors.baseline?.value, planBytes: descriptors.planBytes?.value, changeSet: descriptors.changeSet?.value, evidenceRefs: descriptors.evidenceRefs?.value };
  } catch {
    return { valid: false, baseline: undefined, planBytes: undefined, changeSet: undefined, evidenceRefs: undefined };
  }
}

function selected(refs: readonly SelectedArtifactRef[]): Readonly<{ plan: SelectedArtifactRef; task: SelectedArtifactRef }> | null {
  const plans = refs.filter((ref) => ref.kind === "plan");
  const tasks = refs.filter((ref) => ref.kind === "task");
  const plan = plans[0];
  const task = tasks[0];
  return plans.length === 1 && tasks.length === 1 && plan !== undefined && task !== undefined ? { plan, task } : null;
}

function diagnosticKey(item: S1cDiagnostic): string {
  if (item.code === "OUTSIDE_CANDIDATE_SCOPE") return item.path;
  if (item.code === "S1B_BINDING_MISMATCH") return item.evidenceId;
  if (item.code === "AC_EVIDENCE_REF_MISSING") return item.acId;
  return "";
}

function toReportedClaim(binding: BindingResult): S1cResult["reportedEvidenceClaims"][number] {
  return {
    evidenceId: binding.evidenceId,
    ...(binding.reportedOutcome !== undefined ? { reportedOutcome: binding.reportedOutcome } : {}),
    reportedExecutionState: binding.reportedExecutionState,
  };
}

function freezeResult(comparison: S1cResult["candidateScopeComparison"], diagnostics: readonly S1cDiagnostic[], claims: S1cResult["reportedEvidenceClaims"] = []): S1cResult {
  const unique = new Map<string, S1cDiagnostic>();
  for (const item of diagnostics) {
    const identity = `${item.code}\0${diagnosticKey(item)}`;
    unique.set(identity, item.code === "S1B_BINDING_MISMATCH" ? Object.freeze({ ...item, bindingReasonCodes: Object.freeze([...item.bindingReasonCodes]) }) : Object.freeze({ ...item }));
  }
  unique.set("OWNER_AUTHORITY_NOT_VERIFIED\0", Object.freeze({ code: "OWNER_AUTHORITY_NOT_VERIFIED" }));
  const ordered = [...unique.values()].sort((left, right) => {
    const priority = PRIORITY.indexOf(left.code) - PRIORITY.indexOf(right.code);
    return priority || compareUtf8(diagnosticKey(left), diagnosticKey(right));
  });
  return Object.freeze({ schemaVersion: "justice-s1c-result-v1", formalVerdict: "UNKNOWN", candidateScopeComparison: comparison, ownerAuthorityVerification: "NOT_VERIFIED_BY_S1C", reportedEvidenceClaims: Object.freeze(claims.map((claim) => Object.freeze({ ...claim }))), diagnostics: Object.freeze(ordered), limitations: S1C_LIMITATIONS });
}

function collectEvidence(diagnostics: S1cDiagnostic[], claims: S1cResult["reportedEvidenceClaims"][number][], baseline: LoaderResult, refs: unknown): void {
  let result;
  try {
    result = bindEvidence({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs: refs } as Parameters<typeof bindEvidence>[0]);
  } catch {
    diagnostics.push({ code: "S1B_INPUT_REJECTED" });
    return;
  }
  switch (result.evaluationStatus) {
    case "INPUT_REJECTED": diagnostics.push({ code: "S1B_INPUT_REJECTED" }); return;
    case "BASELINE_UNKNOWN":
      diagnostics.push({ code: "S1B_BASELINE_UNKNOWN" });
      for (const binding of result.bindingResults) claims.push(toReportedClaim(binding));
      return;
    case "EVALUATED":
      for (const binding of result.bindingResults) {
        claims.push(toReportedClaim(binding));
        if (binding.bindingStatus !== "MISMATCH" || binding.reasonCodes.length === 0) continue;
        diagnostics.push({ code: "S1B_BINDING_MISMATCH", evidenceId: binding.evidenceId, bindingReasonCodes: binding.reasonCodes });
      }
      for (const coverage of result.coverageResults) {
        if (coverage.coverageStatus === "MISSING_EVIDENCE") diagnostics.push({ code: "AC_EVIDENCE_REF_MISSING", acId: coverage.acRef.artifactId });
      }
  }
}

function resolvePlanBytes(envelope: ReturnType<typeof readInput>, diagnostics: S1cDiagnostic[]): Uint8Array | null {
  try {
    if (envelope.planBytes instanceof Uint8Array && envelope.planBytes.byteLength <= MAX_PLAN_BYTES) {
      return envelope.planBytes;
    }
  } catch {
    diagnostics.push({ code: "PLAN_BYTES_INVALID" });
    return null;
  }
  diagnostics.push({ code: "PLAN_BYTES_INVALID" });
  return null;
}

function evaluatePlanIdentity(
  baseline: LoaderResult,
  planBytes: Uint8Array,
  diagnostics: S1cDiagnostic[],
): ReturnType<typeof extractTaskScopePolicy> | null {
  const refs = selected(baseline.selectedRefs);
  if (refs === null) {
    diagnostics.push({ code: "PLAN_IDENTITY_MISMATCH" });
    return null;
  }

  let digest: string;
  try {
    digest = createHash("sha256").update(planBytes).digest("hex");
  } catch {
    diagnostics.push({ code: "PLAN_BYTES_INVALID" });
    return null;
  }
  if (digest !== refs.plan.expectedDigest || digest !== refs.plan.observedDigest || refs.plan.digestOutcome !== "MATCH") {
    diagnostics.push({ code: "PLAN_IDENTITY_MISMATCH" });
    return null;
  }

  try {
    return extractTaskScopePolicy(planBytes, refs);
  } catch {
    diagnostics.push({ code: "SCOPE_POLICY_INVALID" });
    return null;
  }
}

function compareScope(
  policy: ReturnType<typeof extractTaskScopePolicy> | null,
  changes: ReturnType<typeof inspectChangeSet>,
  diagnostics: S1cDiagnostic[],
): S1cResult["candidateScopeComparison"] {
  if (policy?.state !== "READY" || changes.state !== "PRESENT") return "UNKNOWN";
  try {
    const result = compareCandidatePaths(policy.policy.allowedPaths, changes.touchedPaths);
    for (const path of result.outsidePaths) diagnostics.push({ code: "OUTSIDE_CANDIDATE_SCOPE", path });
    return result.comparison;
  } catch {
    diagnostics.push({ code: "CHANGESET_INVALID" });
    return "UNKNOWN";
  }
}

/** Evaluates candidate scope and evidence diagnostics without asserting Owner authority. */
export function evaluateS1c(input: S1cInput): S1cResult {
  const envelope = readInput(input);
  const diagnostics: S1cDiagnostic[] = [];
  const claims: S1cResult["reportedEvidenceClaims"][number][] = [];
  if (!envelope.valid) return freezeResult("UNKNOWN", [{ code: "S1C_INPUT_INVALID" }]);
  let inspected;
  try { inspected = inspectBaseline(envelope.baseline); } catch { inspected = { state: "MALFORMED" as const }; }
  if (inspected.state === "MALFORMED") return freezeResult("UNKNOWN", [{ code: "S1A_BASELINE_INVALID" }]);
  let changes: ReturnType<typeof inspectChangeSet>;
  try { changes = inspectChangeSet(envelope.changeSet); } catch { changes = { state: "INVALID" }; }
  if (changes.state === "INVALID") diagnostics.push({ code: "CHANGESET_INVALID" });
  else if (changes.state === "UNAVAILABLE") diagnostics.push({ code: "CHANGESET_UNAVAILABLE" });
  if (inspected.state === "NOT_READY") {
    diagnostics.push({ code: "S1A_BASELINE_NOT_READY" });
    collectEvidence(diagnostics, claims, envelope.baseline as unknown as LoaderResult, envelope.evidenceRefs);
    return freezeResult("UNKNOWN", diagnostics, claims);
  }

  const baseline = envelope.baseline as unknown as LoaderResult;
  collectEvidence(diagnostics, claims, baseline, envelope.evidenceRefs);
  const planBytes = resolvePlanBytes(envelope, diagnostics);
  const policy = planBytes === null ? null : evaluatePlanIdentity(baseline, planBytes, diagnostics);
  if (policy?.state === "UNDEFINED") diagnostics.push({ code: "SCOPE_POLICY_UNDEFINED" });
  else if (policy?.state === "INVALID") diagnostics.push({ code: "SCOPE_POLICY_INVALID" });
  else if (policy?.state === "REFERENCE_MISMATCH") diagnostics.push({ code: "SCOPE_POLICY_REFERENCE_MISMATCH" });
  const comparison = compareScope(policy, changes, diagnostics);
  return freezeResult(comparison, diagnostics, claims);
}
