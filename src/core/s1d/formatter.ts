import type { S1dFatalErrorV1, S1dReportV1, Stage } from "./contract.js";
import type { LoaderResult } from "../s1a/contract.js";
import type { BinderResult } from "../s1b/contract.js";
import type { S1cResult } from "../s1c/contract.js";

function oneLine(value: string): string {
  const redactedPaths = value.replace(/(^|[\s"'=:([])\/[^\s)\]]*/g, "$1[absolute path redacted]");
  return [...redactedPaths].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");
}

function stageLine<T>(name: string, stage: Stage<T>): string {
  return stage.state === "EVALUATED"
    ? `${name}: EVALUATED`
    : `${name}: NOT_EVALUATED (${oneLine(stage.reason)})`;
}

function s1aLines(result: LoaderResult): readonly string[] {
  return [
    `  manifest digest: ${String(result.manifestDigestMatch)}`,
    `  identity: ${result.identityStatus}`,
    `  owner authority: ${result.ownerAuthorityStatus}`,
    `  owner trust precondition: ${result.ownerTrustPrecondition}`,
    `  identity candidate ready: ${String(result.identityCandidateReady)}`,
    `  eligible baseline: ${String(result.eligibleBaseline)}`,
    ...result.selectedRefs.map((ref) => `  selected ${oneLine(ref.artifactId)} (${ref.kind}): ${ref.digestOutcome}`),
    ...result.checks.map((check) => `  check ${oneLine(check.targetId)} ${check.check}: ${check.outcome} (${check.reasonCode})`),
    ...result.limitations.map((limitation) => `  limitation: ${oneLine(limitation)}`),
  ];
}

function s1bLines(result: BinderResult): readonly string[] {
  return [
    `  evaluation: ${result.evaluationStatus}`,
    ...(result.rejectionReasonCode === undefined ? [] : [`  rejection reason: ${result.rejectionReasonCode}`]),
    `  authenticity: ${result.authenticityStatus}`,
    `  execution verification: ${result.executionVerificationStatus}`,
    ...result.bindingResults.map((binding) => [
      `  evidence ${oneLine(binding.evidenceId)}: ${binding.bindingStatus}`,
      ...(binding.reasonCodes.length > 0 ? [`    binding reasons: ${binding.reasonCodes.join(", ")}`] : []),
      `    reported execution (unverified claim): ${binding.reportedExecutionState}`,
      ...(binding.reportedOutcome === undefined ? [] : [`    reported outcome (unverified claim): ${binding.reportedOutcome}`]),
      `    authenticity: ${binding.authenticityStatus}`,
      `    execution verification: ${binding.executionVerificationStatus}`,
    ].join("\n")),
    ...result.coverageResults.map((coverage) => `  AC ${oneLine(coverage.acRef.artifactId)} coverage: ${coverage.coverageStatus}`),
    ...result.limitations.map((limitation) => `  limitation: ${oneLine(limitation)}`),
  ];
}

function s1cLines(result: S1cResult): readonly string[] {
  return [
    `  candidate scope: ${result.candidateScopeComparison}`,
    `  owner authority verification: ${result.ownerAuthorityVerification}`,
    `Formal verdict: ${result.formalVerdict}`,
    ...result.reportedEvidenceClaims.map((claim) => `  reported evidence ${oneLine(claim.evidenceId)} (unverified claim): execution=${claim.reportedExecutionState}${claim.reportedOutcome === undefined ? "" : `; outcome=${claim.reportedOutcome}`}`),
    ...result.diagnostics.map((diagnostic) => diagnostic.code === "OUTSIDE_CANDIDATE_SCOPE"
      ? `Finding: ${diagnostic.code} ${oneLine(diagnostic.path)}`
      : diagnostic.code === "S1B_BINDING_MISMATCH"
        ? `Finding: ${diagnostic.code} ${oneLine(diagnostic.evidenceId)}${diagnostic.bindingReasonCodes.length === 0 ? "" : ` (${diagnostic.bindingReasonCodes.join(", ")})`}`
        : diagnostic.code === "AC_EVIDENCE_REF_MISSING"
          ? `Finding: ${diagnostic.code} ${oneLine(diagnostic.acId)}`
          : `Finding: ${diagnostic.code}`),
    ...result.limitations.map((limitation) => `  limitation: ${oneLine(limitation)}`),
  ];
}

function provenanceLines(report: S1dReportV1): readonly string[] {
  const provenance = report.provenance;
  if (provenance.state === "WITHHELD") {
    return [`Evidence source claims: WITHHELD (${provenance.reason})`];
  }
  return [
    `Evidence source claims: ${provenance.claims.length} structurally valid, ${provenance.verification}`,
    ...provenance.claims.map((claim) => `  evidence=${oneLine(claim.evidenceId)} reported issuer=${oneLine(claim.issuerId)} reported origin=${oneLine(claim.originId)} reported provenance class=${claim.provenanceClass}; authenticity not verified`),
  ];
}

export function formatJson(report: S1dReportV1): string {
  const ordered = {
    schemaVersion: report.schemaVersion,
    operation: report.operation,
    readOnly: report.readOnly,
    stages: report.stages,
    inputIssues: report.inputIssues,
    provenance: report.provenance,
    ...(report.scopeFallback === undefined ? {} : { scopeFallback: report.scopeFallback }),
    limitations: report.limitations,
  };
  return `${JSON.stringify(ordered)}\n`;
}

export function formatText(report: S1dReportV1): string {
  const lines = [
    "Justice S1-d — READ_ONLY diagnostic",
    stageLine("S1-a", report.stages.s1a),
    ...(report.stages.s1a.state === "EVALUATED" ? s1aLines(report.stages.s1a.result) : []),
    ...report.inputIssues.map((issue) => `Input issue: ${oneLine(issue.source)} ${oneLine(issue.code)}`),
    stageLine("S1-b", report.stages.s1b),
    ...(report.stages.s1b.state === "EVALUATED" ? s1bLines(report.stages.s1b.result) : []),
    stageLine("S1-c", report.stages.s1c),
    ...(report.stages.s1c.state === "EVALUATED" ? s1cLines(report.stages.s1c.result) : []),
    ...provenanceLines(report),
  ];
  if (report.scopeFallback !== undefined) {
    if (report.scopeFallback.state === "EVALUATED") {
      lines.push("candidate scope only (S1-c full evaluation NOT_EVALUATED)");
      lines.push(`candidate scope: ${report.scopeFallback.candidateScopeComparison}`);
      lines.push("Formal verdict: NOT_EVALUATED");
      lines.push(...report.scopeFallback.outsidePaths.map((path) => `outside path: ${oneLine(path)}`));
    } else {
      lines.push(`candidate scope only: NOT_EVALUATED (${oneLine(report.scopeFallback.reason)})`);
      lines.push("Formal verdict: NOT_EVALUATED");
    }
  }
  lines.push(`Limitations: ${report.limitations.map(oneLine).join(", ")}`);
  lines.push("This diagnostic is not an acceptance or a Gate decision.");
  return `${lines.join("\n")}\n`;
}

export function formatFatal(fatal: S1dFatalErrorV1, format: "json" | "text"): string {
  if (format === "json") {
    return `${JSON.stringify({
      schemaVersion: fatal.schemaVersion,
      operation: fatal.operation,
      status: fatal.status,
      error: { category: fatal.error.category, code: fatal.error.code },
    })}\n`;
  }
  return "Justice S1-d: fatal diagnostic error.\n";
}
