import type {
  DeclaredClaimEvidence,
  Evidence,
  PendingLogRecord,
  ToolOutputEvidence,
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

function redactEvidence(evidence: Evidence): Evidence {
  return evidence.sourceClass === "tool_output"
    ? redactToolEvidence(evidence)
    : redactDeclaredClaimEvidence(evidence);
}

function isEvidenceList(
  evidence: Evidence | readonly Evidence[],
): evidence is readonly Evidence[] {
  return Array.isArray(evidence);
}

function redactEvidenceValue(
  evidence: Evidence | readonly Evidence[],
): Evidence | readonly Evidence[] {
  return isEvidenceList(evidence) ? evidence.map(redactEvidence) : redactEvidence(evidence);
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
  }
}
