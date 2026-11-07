import {
  S1A_LIMITS,
  isLowercaseSha256Hex,
  isSafeIdentifier,
} from "../s1a/contract.js";
import type {
  ArtifactKind,
  IdentityStatus,
  LoaderCheck,
  LoaderResult,
  ReasonCategory,
  ReasonCode,
  S1aCheckKind,
  SelectedArtifactRef,
} from "../s1a/contract.js";

const S1B_MAX_S1A_CHECKS = 2_192;

type ReadySelection = Readonly<{
  task: SelectedArtifactRef;
  acs: readonly SelectedArtifactRef[];
}>;

export type BaselineInspection =
  | Readonly<{ state: "READY"; selection: ReadySelection }>
  | Readonly<{ state: "NOT_READY" }>
  | Readonly<{ state: "MALFORMED" }>;

const MALFORMED: BaselineInspection = Object.freeze({ state: "MALFORMED" });
const NOT_READY: BaselineInspection = Object.freeze({ state: "NOT_READY" });
const IDENTITIES: readonly IdentityStatus[] = ["MATCH", "MISMATCH", "UNKNOWN"];
const KINDS: readonly ArtifactKind[] = ["design", "plan", "task", "ac"];
const CHECKS = new Set([
  "schema", "cli_arguments", "manifest_digest", "reference", "revision", "scope",
  "kind", "parent", "mandatory_ac", "artifact_digest", "selected_artifact_limit",
  "total_artifact_bytes",
]);
const REASONS = new Set([
  "CHECK_MATCH", "IDENTITY_MATCH_WITH_AUTHORITY_LIMITATION", "CLI_ARGUMENT_INVALID",
  "MANIFEST_DIGEST_REQUIRED", "MANIFEST_DIGEST_FORMAT_INVALID", "MANIFEST_UNREADABLE",
  "MANIFEST_DIGEST_MISMATCH", "MANIFEST_INVALID", "TASK_INTENT_UNREADABLE",
  "TASK_INTENT_INVALID", "KIND_MISMATCH", "REVISION_MISMATCH", "SCOPE_MISMATCH",
  "PARENT_LINK_MISMATCH", "REQUIRED_AC_MISSING", "ARTIFACT_UNREADABLE",
  "ARTIFACT_DIGEST_MISMATCH", "SELECTED_ARTIFACT_LIMIT_EXCEEDED",
  "TOTAL_ARTIFACT_LIMIT_EXCEEDED", "ARTIFACT_SIZE_LIMIT_EXCEEDED",
]);
const CATEGORIES = new Set([
  "IDENTITY_MATCH", "INPUT_INVALID", "CHECK_INCOMPLETE", "OBSERVED_CONTRADICTION",
]);
const RESULT_KEYS = new Set([
  "schemaVersion", "manifestId", "manifestDigestMatch", "identityStatus",
  "ownerAuthorityStatus", "ownerTrustPrecondition", "identityCandidateReady",
  "eligibleBaseline", "selectedRefs", "checks", "limitations",
]);
const SELECTED_REF_KEYS = new Set([
  "artifactId", "kind", "revision", "scopeKey", "parentId", "expectedDigest",
  "observedDigest", "digestOutcome",
]);
const CHECK_KEYS = new Set([
  "targetId", "check", "outcome", "reasonCode", "category", "expected", "observed",
]);

/** Determines whether a value is a non-null, non-array record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks that a record contains no keys outside the supplied allowlist. */
function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

/** Narrows an unknown value to a supported identity status. */
function isIdentityStatus(value: unknown): value is IdentityStatus {
  return IDENTITIES.some((status) => status === value);
}

/** Narrows an unknown value to a supported artifact kind. */
function isArtifactKind(value: unknown): value is ArtifactKind {
  return KINDS.some((candidate) => candidate === value);
}

/** Narrows an unknown value to a supported S1-a check kind. */
function isCheckKind(value: unknown): value is S1aCheckKind {
  return typeof value === "string" && CHECKS.has(value);
}

/** Narrows an unknown value to a supported diagnostic reason code. */
function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && REASONS.has(value);
}

/** Narrows an unknown value to a supported diagnostic category. */
function isReasonCategory(value: unknown): value is ReasonCategory {
  return typeof value === "string" && CATEGORIES.has(value);
}

/** Parses and validates one selected artifact reference. */
function parseSelectedRef(value: unknown): SelectedArtifactRef | null {
  if (!isRecord(value) || !hasOnlyKeys(value, SELECTED_REF_KEYS)) return null;
  const { artifactId, kind, revision, scopeKey, parentId, expectedDigest, observedDigest, digestOutcome } = value;
  if (
    !isSafeIdentifier(artifactId) || !isArtifactKind(kind) ||
    !isSafeIdentifier(revision) || !isSafeIdentifier(scopeKey) ||
    (parentId !== undefined && !isSafeIdentifier(parentId)) ||
    !isLowercaseSha256Hex(expectedDigest) ||
    (observedDigest !== null && !isLowercaseSha256Hex(observedDigest)) ||
    !isIdentityStatus(digestOutcome)
  ) return null;
  if (
    (digestOutcome === "MATCH" && observedDigest !== expectedDigest) ||
    (digestOutcome === "MISMATCH" && (observedDigest === null || observedDigest === expectedDigest)) ||
    (digestOutcome === "UNKNOWN" && observedDigest !== null)
  ) return null;
  return {
    artifactId,
    kind,
    revision,
    scopeKey,
    ...(parentId !== undefined ? { parentId } : {}),
    expectedDigest,
    observedDigest,
    digestOutcome,
  };
}

/** Parses and validates one loader diagnostic check. */
function parseCheck(value: unknown): LoaderCheck | null {
  if (!isRecord(value) || !hasOnlyKeys(value, CHECK_KEYS) || typeof value.targetId !== "string" || value.targetId.length === 0) return null;
  const targetValid = value.targetId === "manifest" || value.targetId === "task-intent" ||
    (value.targetId.startsWith("artifact:") && isSafeIdentifier(value.targetId.slice("artifact:".length)));
  if (
    !targetValid || !isCheckKind(value.check) ||
    !isIdentityStatus(value.outcome) || !isReasonCode(value.reasonCode) ||
    !isReasonCategory(value.category) ||
    (value.expected !== undefined && !(isSafeIdentifier(value.expected) || isLowercaseSha256Hex(value.expected))) ||
    (value.observed !== undefined && !(isSafeIdentifier(value.observed) || isLowercaseSha256Hex(value.observed)))
  ) return null;
  return {
    targetId: value.targetId,
    check: value.check,
    outcome: value.outcome,
    reasonCode: value.reasonCode,
    category: value.category,
    ...(value.expected !== undefined ? { expected: value.expected } : {}),
    ...(value.observed !== undefined ? { observed: value.observed } : {}),
  };
}

/** Parses a baseline result while snapshotting each array-valued property once. */
function parseResult(value: unknown): LoaderResult | null {
  if (!isRecord(value) || !hasOnlyKeys(value, RESULT_KEYS) || value.schemaVersion !== "justice-s1a-result-v1") return null;
  const selectedRefsInput = value.selectedRefs;
  const checksInput = value.checks;
  const limitationsInput = value.limitations;
  if (
    (value.manifestId !== undefined && !isSafeIdentifier(value.manifestId)) ||
    (value.manifestDigestMatch !== true && value.manifestDigestMatch !== false && value.manifestDigestMatch !== "unknown") ||
    !isIdentityStatus(value.identityStatus) || value.ownerAuthorityStatus !== "NOT_PROVEN" ||
    value.ownerTrustPrecondition !== "EXTERNAL_NOT_VERIFIED_BY_S1A" ||
    typeof value.identityCandidateReady !== "boolean" || value.eligibleBaseline !== false ||
    !Array.isArray(selectedRefsInput) || selectedRefsInput.length > S1A_LIMITS.selectedArtifacts ||
    !Array.isArray(checksInput) || checksInput.length > S1B_MAX_S1A_CHECKS ||
    !Array.isArray(limitationsInput) || !limitationsInput.every((item) => typeof item === "string")
  ) return null;
  const selectedRefs = selectedRefsInput.map(parseSelectedRef);
  const checks = checksInput.map(parseCheck);
  if (selectedRefs.some((ref) => ref === null) || checks.some((check) => check === null)) return null;
  const identities = new Set<string>();
  for (const ref of selectedRefs) {
    if (ref === null || identities.has(ref.artifactId)) return null;
    identities.add(ref.artifactId);
  }
  return {
    schemaVersion: "justice-s1a-result-v1",
    ...(value.manifestId !== undefined ? { manifestId: value.manifestId } : {}),
    manifestDigestMatch: value.manifestDigestMatch,
    identityStatus: value.identityStatus,
    ownerAuthorityStatus: "NOT_PROVEN",
    ownerTrustPrecondition: "EXTERNAL_NOT_VERIFIED_BY_S1A",
    identityCandidateReady: value.identityCandidateReady,
    eligibleBaseline: false,
    selectedRefs: selectedRefs.filter((ref): ref is SelectedArtifactRef => ref !== null),
    checks: checks.filter((check): check is LoaderCheck => check !== null),
    limitations: limitationsInput.filter((item): item is string => typeof item === "string"),
  };
}

/** Resolves the unique task and AC selection when references form a ready chain. */
function validReadySelection(refs: readonly SelectedArtifactRef[]): ReadySelection | null {
  if (refs.length < 4 || refs.length > S1A_LIMITS.selectedArtifacts) return null;
  const kinds = new Map<ArtifactKind, SelectedArtifactRef[]>();
  for (const ref of refs) {
    const group = kinds.get(ref.kind) ?? [];
    group.push(ref);
    kinds.set(ref.kind, group);
  }
  const one = (kind: ArtifactKind): SelectedArtifactRef | null => {
    const matches = kinds.get(kind) ?? [];
    return matches.length === 1 ? matches[0] ?? null : null;
  };
  const design = one("design");
  const plan = one("plan");
  const task = one("task");
  const acs = kinds.get("ac") ?? [];
  if (!design || !plan || !task || acs.length === 0) return null;
  if (
    plan.parentId !== design.artifactId || task.parentId !== plan.artifactId ||
    !refs.every((ref) => ref.scopeKey === task.scopeKey) ||
    !acs.every((ref) => ref.parentId === task.artifactId) ||
    !refs.every((ref) => ref.digestOutcome === "MATCH" && ref.observedDigest === ref.expectedDigest)
  ) return null;
  return { task, acs };
}

/** Verifies that every selected reference has exactly one matching digest check. */
function checksCorrespond(refs: readonly SelectedArtifactRef[], checks: readonly LoaderCheck[]): boolean {
  const digestChecks = checks.filter((check) => check.check === "artifact_digest");
  if (digestChecks.length !== refs.length) return false;
  return refs.every((ref) => {
    const matches = digestChecks.filter((check) => check.targetId === `artifact:${ref.artifactId}`);
    const check = matches[0];
    return matches.length === 1 && check !== undefined && check.outcome === "MATCH" &&
      check.outcome === ref.digestOutcome && check.expected === ref.expectedDigest &&
      check.observed === ref.observedDigest;
  });
}

/** Classifies an untrusted S1-a result as malformed, not ready, or ready for binding. */
export function inspectBaseline(value: unknown): BaselineInspection {
  const result = parseResult(value);
  if (!result) return MALFORMED;

  const selectedRefs = result.selectedRefs;
  const parsedChecks = result.checks;
  const status: IdentityStatus = parsedChecks.some((check) => check.outcome === "MISMATCH")
    ? "MISMATCH"
    : parsedChecks.some((check) => check.outcome === "UNKNOWN") ? "UNKNOWN" : "MATCH";
  if (result.identityStatus !== status) return MALFORMED;

  const ready = status === "MATCH" && result.manifestDigestMatch === true;
  if (result.identityCandidateReady !== ready) return MALFORMED;
  if (!ready) return NOT_READY;

  const selection = validReadySelection(selectedRefs);
  if (!selection || !checksCorrespond(selectedRefs, parsedChecks)) return MALFORMED;
  return { state: "READY", selection };
}
