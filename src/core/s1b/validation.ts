import { isLowercaseSha256Hex, isSafeIdentifier } from "../s1a/contract.js";
import { S1B_MAX_EVIDENCE_REFS, S1B_LIMITATIONS } from "./contract.js";
import type { EvidenceRefV1, IdentityRef, InputRejectionReason } from "./contract.js";

export { S1B_MAX_EVIDENCE_REFS, S1B_LIMITATIONS };

export type EvidenceInspection = Readonly<{
  issueCodes: readonly InputRejectionReason[];
  refs: readonly EvidenceRefV1[] | null;
}>;

const REJECTION_PRIORITY: readonly InputRejectionReason[] = [
  "INPUT_SCHEMA_INVALID",
  "BASELINE_SHAPE_INVALID",
  "EVIDENCE_LIMIT_EXCEEDED",
  "EVIDENCE_FIELD_INVALID",
  "UNSAFE_IDENTIFIER",
  "DUPLICATE_EVIDENCE_ID",
];
const REF_KEYS = new Set([
  "evidenceId", "type", "taskRef", "scopeKey", "acRef", "issuerId", "originId",
  "provenanceClass", "reportedExecutionState", "reportedOutcome", "contentDigest",
]);
const IDENTITY_KEYS = new Set(["artifactId", "revision"]);
const DIGEST_KEYS = new Set(["algorithm", "hex"]);
function isEvidenceType(value: unknown): value is EvidenceRefV1["type"] {
  return value === "test" || value === "build" || value === "lint" || value === "artifact" || value === "review" || value === "other";
}
function isProvenanceClass(value: unknown): value is EvidenceRefV1["provenanceClass"] {
  return value === "SELF_DECLARED" || value === "FIXTURE_OBSERVATION" || value === "UNVERIFIED_EXTERNAL";
}
function isExecutionState(value: unknown): value is EvidenceRefV1["reportedExecutionState"] {
  return value === "EXECUTED" || value === "NOT_EXECUTED" || value === "UNKNOWN";
}
function isReportedOutcome(value: unknown): value is NonNullable<EvidenceRefV1["reportedOutcome"]> {
  return value === "PASS" || value === "FAIL" || value === "UNKNOWN";
}
const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

export function primaryRejectionReason(codes: readonly InputRejectionReason[]): InputRejectionReason {
  return REJECTION_PRIORITY.find((reason) => codes.includes(reason)) ?? "INPUT_SCHEMA_INVALID";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseIdentityRef(value: unknown, issues: Set<InputRejectionReason>): IdentityRef | null {
  if (!isRecord(value) || !hasOnlyKeys(value, IDENTITY_KEYS) || !hasOwn(value, "artifactId") || !hasOwn(value, "revision")) {
    issues.add("EVIDENCE_FIELD_INVALID");
    return null;
  }
  const artifactId = value.artifactId;
  const revision = value.revision;
  if (!isSafeIdentifier(artifactId) || !isSafeIdentifier(revision)) {
    issues.add("UNSAFE_IDENTIFIER");
    return null;
  }
  return { artifactId, revision };
}

function parseEvidenceRef(
  value: unknown,
  evidenceId: unknown,
  issues: Set<InputRejectionReason>,
): EvidenceRefV1 | null {
  if (!isRecord(value)) {
    issues.add("EVIDENCE_FIELD_INVALID");
    return null;
  }
  if (!hasOnlyKeys(value, REF_KEYS)) issues.add("EVIDENCE_FIELD_INVALID");

  const type = value.type;
  const taskRef = parseIdentityRef(value.taskRef, issues);
  const scopeKey = value.scopeKey;
  const acRef = hasOwn(value, "acRef") ? parseIdentityRef(value.acRef, issues) : undefined;
  const issuerId = value.issuerId;
  const originId = value.originId;
  const provenanceClass = value.provenanceClass;
  const reportedExecutionState = value.reportedExecutionState;
  const reportedOutcome = hasOwn(value, "reportedOutcome") ? value.reportedOutcome : undefined;
  const contentDigest = hasOwn(value, "contentDigest") ? value.contentDigest : undefined;

  if (typeof evidenceId !== "string" || !isSafeIdentifier(evidenceId)) issues.add("UNSAFE_IDENTIFIER");
  if (typeof scopeKey !== "string" || !isSafeIdentifier(scopeKey)) issues.add("UNSAFE_IDENTIFIER");
  if (typeof issuerId !== "string" || !isSafeIdentifier(issuerId)) issues.add("UNSAFE_IDENTIFIER");
  if (typeof originId !== "string" || !isSafeIdentifier(originId)) issues.add("UNSAFE_IDENTIFIER");
  if (!isEvidenceType(type)) issues.add("EVIDENCE_FIELD_INVALID");
  if (!isProvenanceClass(provenanceClass)) issues.add("EVIDENCE_FIELD_INVALID");
  if (!isExecutionState(reportedExecutionState)) issues.add("EVIDENCE_FIELD_INVALID");
  if (hasOwn(value, "reportedOutcome") && !isReportedOutcome(reportedOutcome)) issues.add("EVIDENCE_FIELD_INVALID");

  let parsedDigest: EvidenceRefV1["contentDigest"];
  if (hasOwn(value, "contentDigest")) {
    if (!isRecord(contentDigest) || !hasOnlyKeys(contentDigest, DIGEST_KEYS) || !hasOwn(contentDigest, "algorithm") || !hasOwn(contentDigest, "hex")) {
      issues.add("EVIDENCE_FIELD_INVALID");
    } else {
      const algorithm = contentDigest.algorithm;
      const hex = contentDigest.hex;
      if (algorithm !== "sha256" || !isLowercaseSha256Hex(hex)) {
        issues.add("EVIDENCE_FIELD_INVALID");
      } else {
        parsedDigest = { algorithm, hex };
      }
    }
  }

  if (
    typeof evidenceId !== "string" || !isSafeIdentifier(evidenceId) || taskRef === null ||
    typeof scopeKey !== "string" || !isSafeIdentifier(scopeKey) ||
    typeof issuerId !== "string" || !isSafeIdentifier(issuerId) ||
    typeof originId !== "string" || !isSafeIdentifier(originId) ||
    !isEvidenceType(type) ||
    !isProvenanceClass(provenanceClass) ||
    !isExecutionState(reportedExecutionState) ||
    (hasOwn(value, "acRef") && acRef === null) ||
    (hasOwn(value, "reportedOutcome") && !isReportedOutcome(reportedOutcome)) ||
    (hasOwn(value, "contentDigest") && parsedDigest === undefined) ||
    !hasOnlyKeys(value, REF_KEYS)
  ) return null;

  return {
    evidenceId,
    type,
    taskRef,
    scopeKey,
    ...(acRef ? { acRef } : {}),
    issuerId,
    originId,
    provenanceClass,
    reportedExecutionState,
    ...(reportedOutcome !== undefined && isReportedOutcome(reportedOutcome) ? { reportedOutcome } : {}),
    ...(parsedDigest ? { contentDigest: parsedDigest } : {}),
  };
}

export function inspectEvidenceRefs(value: unknown): EvidenceInspection {
  const issues = new Set<InputRejectionReason>();
  try {
    if (!Array.isArray(value)) return { issueCodes: ["INPUT_SCHEMA_INVALID"], refs: null };
    const length = value.length;
    if (length > S1B_MAX_EVIDENCE_REFS) return { issueCodes: ["EVIDENCE_LIMIT_EXCEEDED"], refs: null };

    const refs: EvidenceRefV1[] = [];
    const ids = new Set<string>();
    for (let index = 0; index < length; index += 1) {
      if (!hasOwn(value, String(index))) {
        issues.add("EVIDENCE_FIELD_INVALID");
        continue;
      }
      const candidate = Object.getOwnPropertyDescriptor(value, String(index))?.value;
      if (candidate === undefined) {
        issues.add("EVIDENCE_FIELD_INVALID");
        continue;
      }
      const evidenceId = isRecord(candidate) && hasOwn(candidate, "evidenceId")
        ? candidate.evidenceId
        : undefined;
      if (typeof evidenceId === "string" && isSafeIdentifier(evidenceId)) {
        if (ids.has(evidenceId)) issues.add("DUPLICATE_EVIDENCE_ID");
        ids.add(evidenceId);
      }
      const before = issues.size;
      const ref = parseEvidenceRef(candidate, evidenceId, issues);
      if (ref) refs.push(ref);
      else if (issues.size === before) {
        issues.add("EVIDENCE_FIELD_INVALID");
      }
    }
    const issueCodes = REJECTION_PRIORITY.filter((code) => issues.has(code));
    return { issueCodes, refs: issueCodes.length === 0 ? refs : null };
  } catch {
    return { issueCodes: ["INPUT_SCHEMA_INVALID"], refs: null };
  }
}
