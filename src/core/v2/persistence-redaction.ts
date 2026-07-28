import type {
  DeclaredClaimEvidence,
  Evidence,
  PendingLogRecord,
  ToolOutputEvidence,
  WorkflowBootstrapAudit,
} from "./observation-model";
import { redactForPersistence } from "./redaction";

function redactToolEvidence(evidence: ToolOutputEvidence): ToolOutputEvidence {
  if (evidence.toolOutputClass === "command_exec") {
    return {
      ...evidence,
      command: redactForPersistence(evidence.command),
      rawOutput: redactForPersistence(evidence.rawOutput),
    };
  }

  return {
    ...evidence,
    ...(evidence.command === undefined ? {} : { command: redactForPersistence(evidence.command) }),
    ...(evidence.rawOutputSnippet === undefined
      ? {}
      : { rawOutputSnippet: redactForPersistence(evidence.rawOutputSnippet) }),
  };
}

function redactDeclaredClaimEvidence(evidence: DeclaredClaimEvidence): DeclaredClaimEvidence {
  return {
    ...evidence,
    claim: {
      ...evidence.claim,
      claimKind: redactForPersistence(evidence.claim.claimKind),
    },
  };
}

function redactMessageClaimKind(claimKind: string): "test" | "build" | "lint" | "generic" {
  switch (redactForPersistence(claimKind)) {
    case "test":
      return "test";
    case "build":
      return "build";
    case "lint":
      return "lint";
    default:
      return "generic";
  }
}

function redactMessageDeclaredClaimEvidence(
  evidence: DeclaredClaimEvidence,
): DeclaredClaimEvidence {
  return {
    ...evidence,
    claim: {
      ...evidence.claim,
      claimKind: redactMessageClaimKind(evidence.claim.claimKind),
    },
  };
}

function redactEvidence(evidence: Evidence): Evidence {
  return evidence.sourceClass === "tool_output"
    ? redactToolEvidence(evidence)
    : redactDeclaredClaimEvidence(evidence);
}

function isEvidenceList(evidence: Evidence | readonly Evidence[]): evidence is readonly Evidence[] {
  return Array.isArray(evidence);
}

function redactEvidenceValue(
  evidence: Evidence | readonly Evidence[],
): Evidence | readonly Evidence[] {
  return isEvidenceList(evidence) ? evidence.map(redactEvidence) : redactEvidence(evidence);
}

/**
 * Idempotent redaction of the bootstrap audit payload. `goalHash` is already a
 * one-way hash and `phase`/`source` are frozen enums, so only the free-text
 * snippet and the two paths need a pass.
 */
function redactWorkflowBootstrapAudit(audit: WorkflowBootstrapAudit): WorkflowBootstrapAudit {
  return {
    ...audit,
    goalSnippet: redactForPersistence(audit.goalSnippet),
    ...(audit.designPath === undefined
      ? {}
      : { designPath: redactForPersistence(audit.designPath) }),
    ...(audit.planPath === undefined ? {} : { planPath: redactForPersistence(audit.planPath) }),
  };
}

/**
 * Canonical redaction boundary for every record entering the append-only log.
 * Builders redact eagerly for defense in depth; this idempotent final pass also
 * protects direct store callers without altering identity fields.
 */
export function redactPendingLogRecord(record: PendingLogRecord): PendingLogRecord {
  if (record.recordType === "decision") {
    return {
      ...record,
      ruleResults: record.ruleResults.map((result) => ({
        ...result,
        ...(result.reason === undefined ? {} : { reason: redactForPersistence(result.reason) }),
      })),
    };
  }

  switch (record.kind) {
    case "tool_executed": {
      const evidence = redactEvidenceValue(record.evidence);
      return { ...record, toolName: redactForPersistence(record.toolName), evidence };
    }
    case "message":
      return {
        ...record,
        declaredClaims: record.declaredClaims.map((claim) => ({
          ...claim,
          claimKind: redactMessageClaimKind(claim.claimKind),
        })),
        evidence: record.evidence.map(redactMessageDeclaredClaimEvidence),
        ...(record.textSnippet === undefined
          ? {}
          : { textSnippet: redactForPersistence(record.textSnippet) }),
      };
    case "skill_invoked":
      return { ...record, skillName: redactForPersistence(record.skillName) };
    case "session_error":
      return {
        ...record,
        errorKind: redactForPersistence(record.errorKind),
        message: redactForPersistence(record.message),
      };
    case "reflection":
      return {
        ...record,
        reflection: {
          ...record.reflection,
          planRef: {
            ...record.reflection.planRef,
            path: redactForPersistence(record.reflection.planRef.path),
          },
          ...(record.reflection.note === undefined
            ? {}
            : { note: redactForPersistence(record.reflection.note) }),
        },
      };
    case "review_observed":
      return {
        ...record,
        items: record.items.map((item) => ({
          ...item,
          summary: redactForPersistence(item.summary),
          location: redactForPersistence(item.location),
        })),
        ...(record.resolutionMarkers === undefined
          ? {}
          : {
              resolutionMarkers: record.resolutionMarkers.map((marker) => ({
                ...marker,
                ...(marker.artifactRef === undefined
                  ? {}
                  : { artifactRef: redactForPersistence(marker.artifactRef) }),
              })),
            }),
      };
    // Each bootstrap kind is spread under its own literal `kind` so the result
    // stays assignable to a single PendingObservationRecord member.
    case "workflow_started":
      return { ...record, workflow: redactWorkflowBootstrapAudit(record.workflow) };
    case "design_requested":
      return { ...record, workflow: redactWorkflowBootstrapAudit(record.workflow) };
    case "plan_requested":
      return { ...record, workflow: redactWorkflowBootstrapAudit(record.workflow) };
    case "plan_activated":
      return { ...record, workflow: redactWorkflowBootstrapAudit(record.workflow) };
  }
}
