import { randomUUID } from "node:crypto";
import type { GateId, LineageId } from "../review-gate-types.js";
import type { ReviewGatePhase } from "../review-gate-types.js";
import { canonicalizeArtifactPath } from "./identity.js";

/**
 * CAP1 — review-safe capability model, shared vocabulary, and the pure GIT1/WSP1
 * binding contracts consumed by the runtime query/git services. This module is
 * pure domain logic; all I/O lives in `src/runtime/review-gate-*.ts`.
 */

/** Phase alias used by the Review Gate query/capability contracts. */
export type ReviewPhase = ReviewGatePhase;

/** Only these regular-file Git modes are valid Review Gate target identities. */
export type ReviewGitRegularMode = "100644" | "100755";

/** Lowercase CAP1/domain denial codes (coordinator maps these to EVC1 values). */
export type ReviewDomainErrorCode =
  | "implementation_not_authorized"
  | "review_scope_violation"
  | "review_operation_not_permitted"
  | "review_restore_scope_violation"
  | "review_restore_failed"
  | "review_restore_recovery_conflict"
  | "review_commit_scope_violation"
  | "review_commit_failed"
  | "review_commit_recovery_conflict";

export function reviewDomainError(code: ReviewDomainErrorCode, cause?: unknown): Error {
  return new Error(code, cause === undefined ? undefined : { cause });
}

// ---------------------------------------------------------------------------
// WSP1 Git binding vocabulary (content + tree-entry mode identity)
// ---------------------------------------------------------------------------

export type GitTreeEntryBindingV1 = Readonly<{
  readonly canonicalPath: string;
  readonly blobSha: string;
  readonly gitMode: ReviewGitRegularMode;
}>;

export type GitIndexEntryBindingV1 = Readonly<{
  readonly canonicalPath: string;
  readonly blobSha: string;
  readonly gitMode: ReviewGitRegularMode;
  readonly stage: 0;
}>;

export type WorktreeArtifactBindingV1 = Readonly<{
  readonly canonicalPath: string;
  readonly digest: string;
  readonly gitMode: ReviewGitRegularMode;
}>;

/**
 * Complete Git identity state of one Review Gate target path. Entries carry
 * only validated regular-file modes; an unsupported mode makes the entry
 * absent so a clean classification fails closed.
 */
export type ReviewTargetGitBinding = Readonly<{
  readonly canonicalPath: string;
  readonly headSha: string | null;
  readonly headEntry: GitTreeEntryBindingV1 | null;
  readonly indexEntry: GitIndexEntryBindingV1 | null;
  readonly indexConflicted: boolean;
  readonly worktree: WorktreeArtifactBindingV1 | null;
  readonly headBlobDigest: string | null;
}>;

/**
 * Worktree Git mode derives from the owner execute bit only, independent of
 * `core.fileMode`. Group/other execute bits alone must not produce 100755.
 */
export function gitModeFromOwnerExecBits(posixMode: number): ReviewGitRegularMode {
  return (posixMode & 0o100) !== 0 ? "100755" : "100644";
}

/** GIT1 clean admission: exact HEAD/index/worktree content AND Git mode identity. */
export function classifyReviewTargetClean(binding: ReviewTargetGitBinding): "clean" | "not_clean" {
  if (binding.headSha === null || binding.headEntry === null) return "not_clean";
  if (binding.indexConflicted || binding.indexEntry === null) return "not_clean";
  if (binding.headEntry.blobSha !== binding.indexEntry.blobSha) return "not_clean";
  if (binding.headEntry.gitMode !== binding.indexEntry.gitMode) return "not_clean";
  if (binding.worktree === null || binding.headBlobDigest === null) return "not_clean";
  if (binding.worktree.gitMode !== binding.headEntry.gitMode) return "not_clean";
  if (binding.worktree.digest !== binding.headBlobDigest) return "not_clean";
  return "clean";
}

// ---------------------------------------------------------------------------
// CAP1 review_query scope
// ---------------------------------------------------------------------------

export type ReviewQueryScope = Readonly<{
  readonly phase: ReviewPhase;
  readonly allowedArtifactPaths: ReadonlySet<string>;
  readonly allowedGitPaths: ReadonlySet<string>;
  readonly approvedDesignCanonicalPath: string | null;
  /**
   * FDR-014 proof-bound immutable content source for the approved upstream
   * Design (Plan phase only). Absent or `null` marks an unproved scope: the
   * approved path stays membership-only (diff/status diagnostics) and its
   * content reads remain denied at the query service boundary.
   */
  readonly approvedDesign?: VerifiedApprovedDesignReadBindingV1 | null;
}>;

export type ReviewScopeAuthority = Readonly<{
  readonly requirementsCanonicalPath: string;
  readonly approvedDesignCanonicalPath: string | null;
  readonly currentPhaseArtifactCanonicalPath: string;
  /**
   * FDR-014 trusted proof for the approved upstream Design. Only a verified
   * producer supplies it; this module can never derive it from a mutable
   * worktree path.
   */
  readonly approvedDesign?: VerifiedApprovedDesignReadBindingV1 | null;
}>;

/** Effective Requirements identity pinned inside the approved Design proof. */
export type ApprovedDesignRequirementsBindingV1 = Readonly<{
  readonly canonicalPath: string;
  readonly gitBlobOid: string;
  readonly digest: string;
  readonly gitMode: ReviewGitRegularMode;
}>;

/**
 * FDR-014 versioned proof of the approved upstream Design a Plan-phase
 * reviewer consumes: the same-generation `DESIGN_CLEAR` event id, the latest
 * current authority event id, the completed approved Git tree/blob OID with
 * exact mode and content digest, the effective Requirements/phase protocol
 * binding, and the witness frontier. The producer verifies real Git and
 * witness state before dispatching; scope builders only re-validate the
 * proof shape here.
 */
export type VerifiedApprovedDesignReadBindingV1 = Readonly<{
  readonly schemaVersion: 1;
  readonly canonicalPath: string;
  readonly designClearEventId: string;
  readonly currentAuthorityEventId: string;
  readonly committedTreeOid: string;
  readonly blobOid: string;
  readonly gitMode: ReviewGitRegularMode;
  readonly digest: string;
  readonly requirements: ApprovedDesignRequirementsBindingV1;
  readonly phaseProtocolFingerprint: string;
  readonly witnessFrontierHash: string;
}>;

export const APPROVED_DESIGN_READ_BINDING_SCHEMA_VERSION = 1 as const;

const GIT_OBJECT_OID_PATTERN = /^[0-9a-f]{40,64}$/u;

const SHA_256_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;

const invalidApprovedDesignBinding = (): Error =>
  new Error("review_gate_invalid_approved_design_binding");

const isRegularReviewGitMode = (mode: string): mode is ReviewGitRegularMode =>
  mode === "100644" || mode === "100755";

const assertPinnedRequirementsMember = (
  member: ApprovedDesignRequirementsBindingV1,
): void => {
  if (canonicalizeArtifactPath(member.canonicalPath) === null) {
    throw invalidApprovedDesignBinding();
  }
  if (!GIT_OBJECT_OID_PATTERN.test(member.gitBlobOid)) throw invalidApprovedDesignBinding();
  if (!SHA_256_DIGEST_PATTERN.test(member.digest)) throw invalidApprovedDesignBinding();
  if (!isRegularReviewGitMode(member.gitMode)) throw invalidApprovedDesignBinding();
};

/**
 * Validate a trusted approved-Design proof in isolation (no authority
 * comparison). Runtime readers pair this with their own pinned-argv checks;
 * scope builders use `assertValidApprovedDesignReadBinding` when the
 * authority's approved canonical path is known.
 */
export function assertValidApprovedDesignReadBindingShape(
  binding: VerifiedApprovedDesignReadBindingV1,
): void {
  if (binding.schemaVersion !== APPROVED_DESIGN_READ_BINDING_SCHEMA_VERSION) {
    throw invalidApprovedDesignBinding();
  }
  if (canonicalizeArtifactPath(binding.canonicalPath) === null) {
    throw invalidApprovedDesignBinding();
  }
  if (typeof binding.designClearEventId !== "string" || binding.designClearEventId.length === 0) {
    throw invalidApprovedDesignBinding();
  }
  if (
    typeof binding.currentAuthorityEventId !== "string" ||
    binding.currentAuthorityEventId.length === 0
  ) {
    throw invalidApprovedDesignBinding();
  }
  if (!GIT_OBJECT_OID_PATTERN.test(binding.committedTreeOid)) throw invalidApprovedDesignBinding();
  if (!GIT_OBJECT_OID_PATTERN.test(binding.blobOid)) throw invalidApprovedDesignBinding();
  if (!isRegularReviewGitMode(binding.gitMode)) throw invalidApprovedDesignBinding();
  if (!SHA_256_DIGEST_PATTERN.test(binding.digest)) throw invalidApprovedDesignBinding();
  assertPinnedRequirementsMember(binding.requirements);
  if (
    typeof binding.phaseProtocolFingerprint !== "string" ||
    binding.phaseProtocolFingerprint.length === 0
  ) {
    throw invalidApprovedDesignBinding();
  }
  if (!SHA_256_DIGEST_PATTERN.test(binding.witnessFrontierHash)) {
    throw invalidApprovedDesignBinding();
  }
}

/**
 * Validate a trusted approved-Design proof against the scope authority's
 * approved canonical path: an approved Design proof always belongs to that
 * exact path.
 */
export function assertValidApprovedDesignReadBinding(
  binding: VerifiedApprovedDesignReadBindingV1,
  approvedDesignCanonicalPath: string | null,
): void {
  if (approvedDesignCanonicalPath === null) throw invalidApprovedDesignBinding();
  assertValidApprovedDesignReadBindingShape(binding);
  const canonical = canonicalizeArtifactPath(approvedDesignCanonicalPath);
  if (canonical === null || binding.canonicalPath !== canonical) {
    throw invalidApprovedDesignBinding();
  }
}

const scopeMembersForPhase = (
  phase: ReviewPhase,
  authority: ReviewScopeAuthority,
): readonly string[] => {
  // "review_gate_invalid_artifact_path" mirrors the identity-module error code;
  // it is intentionally outside the denial taxonomy because a failed scope
  // construction is a caller bug, not a review denial.
  const invalidArtifactPath = (): Error => new Error("review_gate_invalid_artifact_path");
  const approved = authority.approvedDesignCanonicalPath;
  if (phase === "plan" && approved === null) throw invalidArtifactPath();
  if (phase === "design" && approved !== null) throw invalidArtifactPath();
  const rawMembers =
    phase === "design"
      ? [authority.requirementsCanonicalPath, authority.currentPhaseArtifactCanonicalPath]
      : [approved, authority.currentPhaseArtifactCanonicalPath];
  const members: string[] = [];
  for (const path of rawMembers) {
    if (typeof path !== "string" || canonicalizeArtifactPath(path) === null) {
      throw invalidArtifactPath();
    }
    members.push(path);
  }
  return members;
};

/** Optional FDR-014 approved-Design proof accepted by `buildReviewQueryScope`. */
export type ReviewQueryScopeOptions = Readonly<{
  readonly approvedDesign: VerifiedApprovedDesignReadBindingV1 | null | undefined;
}>;

const resolveApprovedDesignProof = (
  phase: ReviewPhase,
  authority: ReviewScopeAuthority,
  options: ReviewQueryScopeOptions | undefined,
): VerifiedApprovedDesignReadBindingV1 | null => {
  const candidate =
    options?.approvedDesign !== undefined
      ? options.approvedDesign
      : (authority.approvedDesign ?? null);
  if (candidate === null) return null;
  if (phase !== "plan") throw invalidApprovedDesignBinding();
  assertValidApprovedDesignReadBinding(candidate, authority.approvedDesignCanonicalPath);
  return Object.freeze(candidate);
};

/**
 * Design scope = bound Requirements + current Design only.
 * Plan scope = effective approved Design + current Plan only.
 *
 * FDR-014: when an approvedDesign proof is supplied (explicit option or the
 * authority itself), it is validated and attached as the scope's only
 * accepted approved content source. The builder cannot convert a mutable
 * worktree path into authority: without proof, the approved Design path is
 * membership-only and its content reads stay denied at the query service.
 */
export function buildReviewQueryScope(
  phase: ReviewPhase,
  authority: ReviewScopeAuthority,
  options?: ReviewQueryScopeOptions,
): ReviewQueryScope {
  const approvedDesign = resolveApprovedDesignProof(phase, authority, options);
  const members = scopeMembersForPhase(phase, authority).map((path) => {
    const canonical = canonicalizeArtifactPath(path);
    if (canonical === null) throw new Error("review_gate_invalid_artifact_path");
    return canonical;
  });
  const approvedDesignCanonicalPath =
    phase === "plan" ? authority.approvedDesignCanonicalPath : null;
  return {
    phase,
    allowedArtifactPaths: new Set(members),
    allowedGitPaths: new Set(members),
    approvedDesignCanonicalPath,
    approvedDesign,
  };
}

export type ReviewScopePathKind = "artifact" | "git";

/** True when the exact canonical path is a member of the requested scope class. */
export function isReviewQueryPathAllowed(
  scope: ReviewQueryScope,
  kind: ReviewScopePathKind,
  rawPath: string,
): boolean {
  const canonical = canonicalizeArtifactPath(rawPath);
  if (canonical === null) return false;
  const allowed = kind === "artifact" ? scope.allowedArtifactPaths : scope.allowedGitPaths;
  return allowed.has(canonical);
}

/** Bounded in-process literal search results. */
export const MAX_REVIEW_QUERY_MATCHES = 200;

export const MAX_REVIEW_QUERY_LINE_CHARS = 1024;

export type ReviewQueryMatch = Readonly<{
  readonly line: number;
  readonly text: string;
}>;

/** Justice-defined revision identities only; never arbitrary shell refs. */
export type ReviewRevisionRef =
  | Readonly<{ readonly kind: "head"; readonly depth: number }>
  | Readonly<{ readonly kind: "object"; readonly objectId: string }>;

export const MAX_REVIEW_DIFF_BYTES = 16 * 1024 * 1024;
export const MAX_REVIEW_LOG_LIMIT = 50;

export type ReviewDiffRequest = Readonly<{
  /** null = compare HEAD against the requested side; else an exact diff base. */
  readonly base: ReviewRevisionRef | null;
  /** staged = index-vs-HEAD semantics; default false. */
  readonly staged: boolean;
}>;

export type ReviewGitStatusEntry = Readonly<{
  readonly canonicalPath: string;
  readonly indexState: string;
  readonly workingTreeState: string;
}>;

export type ReviewGitStatus = Readonly<{
  readonly entries: ReadonlyArray<ReviewGitStatusEntry>;
}>;

export type ReviewGitDiff = Readonly<{
  readonly text: string;
  readonly changedPaths: ReadonlyArray<string>;
}>;

export type ReviewLogRequest = Readonly<{
  readonly base: ReviewRevisionRef | null;
  readonly limit: number;
}>;

export type ReviewGitLogEntry = Readonly<{
  readonly commitId: string;
  readonly parentCommitIds: ReadonlyArray<string>;
  readonly summary: string;
}>;

// ---------------------------------------------------------------------------
// CAP1 review_mutation capability registry
// ---------------------------------------------------------------------------

export const REVIEW_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "edit",
  "write",
  "filesystem_edit_file",
  "filesystem_write_file",
  "apply_patch",
]);

export const REVIEW_IMPLEMENTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "task",
  "bash",
  "shell",
  "command",
  "terminal",
  "powershell",
  "cmd",
]);

export type ReviewModelToolClass =
  | "review_mutation"
  | "review_query"
  | "implementation"
  | "review_operation_not_permitted";

export function classifyReviewModelTool(toolName: string): ReviewModelToolClass {
  if (REVIEW_MUTATION_TOOL_NAMES.has(toolName)) return "review_mutation";
  if (toolName === "read") return "review_query";
  if (REVIEW_IMPLEMENTATION_TOOL_NAMES.has(toolName)) return "implementation";
  // unknown tools and core-only classes (review_restore/review_commit) are not
  // model capabilities
  return "review_operation_not_permitted";
}

export type ReviewMutationCapabilityInput = Readonly<{
  readonly gateId: GateId;
  readonly operationId: string;
  readonly phase: ReviewPhase;
  readonly remediationRound: number;
  readonly targetCanonicalPath: string;
  readonly expectedPreDigest: string;
  readonly expectedPreGitMode: ReviewGitRegularMode;
  readonly phaseBaselineRevision: number;
}>;

export type ReviewMutationCapability = Readonly<{
  readonly capabilityId: string;
  readonly issuedAt: string;
  readonly remainingUses: 1;
  readonly input: ReviewMutationCapabilityInput;
}>;

/** The tool-use context a coordinator presents when spending a capability. */
export type ScopedToolUse = Readonly<{
  readonly toolName: string;
  readonly targetCanonicalPath: string;
  readonly gateId: string | GateId;
  readonly operationId: string;
  readonly phase: ReviewPhase;
  readonly remediationRound: number;
}>;

export type ReviewCapabilityDecision = Readonly<{
  readonly outcome: "authorized" | "denied";
  readonly capabilityId: string;
  readonly denialReason: ReviewDomainErrorCode | null;
}>;

interface RegistryEntry {
  readonly input: ReviewMutationCapabilityInput;
  consumed: boolean;
}

/**
 * In-core registry of single-use review_mutation capabilities bound to
 * gate/operation/phase/round/path/pre-digest/pre-mode context. restore and
 * commit are never model capabilities and are not issuable here.
 */
export class ReviewGateCapabilityRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  issueMutation(input: ReviewMutationCapabilityInput): ReviewMutationCapability {
    const capabilityId = randomUUID();
    this.entries.set(capabilityId, { input, consumed: false });
    return { capabilityId, issuedAt: new Date().toISOString(), remainingUses: 1, input };
  }

  consumeMutation(capabilityId: string, use: ScopedToolUse): ReviewCapabilityDecision {
    const entry = this.entries.get(capabilityId);
    if (entry === undefined || entry.consumed) {
      return {
        outcome: "denied",
        capabilityId,
        denialReason: "review_operation_not_permitted",
      };
    }
    const denied: ReviewDomainErrorCode | null = (() => {
      if (classifyReviewModelTool(use.toolName) === "implementation") {
        return "implementation_not_authorized";
      }
      if (classifyReviewModelTool(use.toolName) !== "review_mutation") {
        return "review_operation_not_permitted";
      }
      if (use.targetCanonicalPath !== entry.input.targetCanonicalPath) {
        return "review_scope_violation";
      }
      if (String(use.gateId) !== String(entry.input.gateId)) {
        return "review_scope_violation";
      }
      if (use.operationId !== entry.input.operationId) return "review_scope_violation";
      if (use.phase !== entry.input.phase) return "review_scope_violation";
      if (use.remediationRound !== entry.input.remediationRound) {
        return "review_scope_violation";
      }
      return null;
    })();
    if (denied !== null) {
      return { outcome: "denied", capabilityId, denialReason: denied };
    }
    entry.consumed = true;
    return { outcome: "authorized", capabilityId, denialReason: null };
  }

  /** Read-only snapshot for coordinators/tests: which capability ids remain. */
  listUnconsumedCapabilityIds(): readonly string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => !entry.consumed)
      .map(([capabilityId]) => capabilityId);
  }
}

// ---------------------------------------------------------------------------
// WSP1 review_restore contracts
// ---------------------------------------------------------------------------

export type ReviewRestoreSourceBinding = Readonly<{
  readonly headSha: string;
  readonly headEntry: GitTreeEntryBindingV1;
  readonly indexEntry: GitIndexEntryBindingV1;
  readonly worktree: WorktreeArtifactBindingV1;
  readonly sourceEventId: string;
}>;

export type ReviewRestoreDestinationBinding = Readonly<{
  readonly headSha: string;
  readonly headEntry: GitTreeEntryBindingV1;
  readonly indexEntry: GitIndexEntryBindingV1;
  readonly worktree: WorktreeArtifactBindingV1;
}>;

export type ReviewRestorePrepareInput = Readonly<{
  readonly gateId: string | GateId;
  readonly operationId: string;
  readonly phase: ReviewPhase;
  readonly targetCanonicalPath: string;
  /** The exact current-phase artifact; restore to anything else is a violation. */
  readonly allowedRestoreTargetPath: string;
  readonly sourceKnownDirtyBinding: ReviewRestoreSourceBinding;
  readonly targetCleanCommittedBinding: ReviewRestoreDestinationBinding;
}>;
export type ReviewTargetRestorePreparedPayload = Readonly<{
  readonly preparedId: string;
  readonly preparedAt: string;
  readonly gateId: string | GateId;
  readonly operationId: string;
  readonly phase: ReviewPhase;
  readonly targetCanonicalPath: string;
  readonly sourceKnownDirtyBinding: ReviewRestoreSourceBinding;
  readonly targetCleanCommittedBinding: ReviewRestoreDestinationBinding;
  readonly recoveryDigest: string;
}>;

export type ReviewRestoreResult =
  | Readonly<{
      readonly status: "restored";
      readonly verified: Readonly<{
        readonly digest: string;
        readonly gitMode: ReviewGitRegularMode;
      }>;
    }>
  | Readonly<{ readonly status: "recovered" }>;

export type ReviewRestoreRecoveryResult =
  | Readonly<{ readonly status: "safe_to_reexecute" }>
  | Readonly<{ readonly status: "recovered" }>;

// ---------------------------------------------------------------------------
// GIT1 review_commit contracts
// ---------------------------------------------------------------------------

export type ReviewCommitPrepareInput = Readonly<{
  readonly gateId: string | GateId;
  readonly operationId: string;
  readonly phase: ReviewPhase;
  readonly targetCanonicalPath: string;
  readonly allowedCommitTargetPath: string;
  readonly remediationRound: number;
  readonly lineageIds: ReadonlyArray<LineageId | string>;
  readonly expectedArtifactDigest: string;
  readonly expectedGitMode: ReviewGitRegularMode;
}>;
export type ReviewCommitPreparedPayload = Readonly<{
  readonly preparedId: string;
  readonly preparedAt: string;
  readonly gateId: string | GateId;
  readonly operationId: string;
  readonly phase: ReviewPhase;
  readonly targetCanonicalPath: string;
  readonly parentHeadSha: string;
  readonly parentTargetEntry: GitTreeEntryBindingV1;
  readonly preCommitIndexEntry: GitIndexEntryBindingV1;
  readonly expectedTargetEntry: GitTreeEntryBindingV1;
  readonly expectedArtifactDigest: string;
  readonly remediationRound: number;
  readonly lineageIds: ReadonlyArray<string>;
  readonly commitMessage: string;
  readonly messageDigest: string;
  readonly unrelatedIndexFingerprint: string;
  readonly recoveryDigest: string;
}>;

export type VerifiedReviewCommit = Readonly<{
  readonly commitId: string;
  readonly parentCommitId: string | null;
  readonly targetEntry: GitTreeEntryBindingV1;
  readonly changedPaths: ReadonlyArray<string>;
}>;

export type ReviewCommitRecoveryResult =
  | Readonly<{ readonly status: "safe_to_reexecute" }>
  | Readonly<{ readonly status: "recovered"; readonly commit: VerifiedReviewCommit }>;

export function buildReviewCommitMessage(
  phase: ReviewPhase,
  remediationRound: number,
  lineageIds: readonly string[],
): string {
  const sorted = [...lineageIds].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return [
    `[Justice] remediation round ${remediationRound}`,
    "",
    `Review-Gate: ${phase}`,
    `Review-Round: ${remediationRound}`,
    `Findings: ${sorted.join(", ")}`,
    "",
  ].join("\n");
}
