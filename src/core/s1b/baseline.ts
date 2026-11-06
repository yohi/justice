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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentityStatus(value: unknown): value is IdentityStatus {
  return IDENTITIES.some((status) => status === value);
}

function isArtifactKind(value: unknown): value is ArtifactKind {
  return KINDS.some((candidate) => candidate === value);
}

function isCheckKind(value: unknown): value is S1aCheckKind {
  return typeof value === "string" && CHECKS.has(value);
}

function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === "string" && REASONS.has(value);
}

function isReasonCategory(value: unknown): value is ReasonCategory {
  return typeof value === "string" && CATEGORIES.has(value);
}

function parseSelectedRef(value: unknown): SelectedArtifactRef | null {
  if (!isRecord(value)) return null;
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

function parseCheck(value: unknown): LoaderCheck | null {
  if (!isRecord(value) || typeof value.targetId !== "string" || value.targetId.length === 0) return null;
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

function parseResult(value: unknown): LoaderResult | null {
  if (!isRecord(value) || value.schemaVersion !== "justice-s1a-result-v1") return null;
  if (
    (value.manifestId !== undefined && !isSafeIdentifier(value.manifestId)) ||
    (value.manifestDigestMatch !== true && value.manifestDigestMatch !== false && value.manifestDigestMatch !== "unknown") ||
    !isIdentityStatus(value.identityStatus) || value.ownerAuthorityStatus !== "NOT_PROVEN" ||
    value.ownerTrustPrecondition !== "EXTERNAL_NOT_VERIFIED_BY_S1A" ||
    typeof value.identityCandidateReady !== "boolean" || value.eligibleBaseline !== false ||
    !Array.isArray(value.selectedRefs) || value.selectedRefs.length > S1A_LIMITS.selectedArtifacts ||
    !Array.isArray(value.checks) || value.checks.length > S1A_LIMITS.selectedArtifacts ||
    !Array.isArray(value.limitations) || !value.limitations.every((item) => typeof item === "string")
  ) return null;
  const selectedRefs = value.selectedRefs.map(parseSelectedRef);
  const checks = value.checks.map(parseCheck);
  if (selectedRefs.some((ref) => ref === null) || checks.some((check) => check === null)) return null;
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
    limitations: value.limitations.filter((item): item is string => typeof item === "string"),
  };
}

function validReadySelection(refs: readonly SelectedArtifactRef[]): ReadySelection | null {
  if (refs.length < 4 || refs.length > S1A_LIMITS.selectedArtifacts) return null;
  const kinds = new Map<ArtifactKind, SelectedArtifactRef[]>();
  const ids = new Set<string>();
  for (const ref of refs) {
    if (ids.has(ref.artifactId)) return null;
    ids.add(ref.artifactId);
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
