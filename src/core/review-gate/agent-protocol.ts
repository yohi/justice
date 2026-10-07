/**
 * Review Gate canonical stage-agent protocol (convergence Task 10).
 *
 * Replaces the legacy retry-worker protocol with a typed staged topology: a
 * dumb exact packet-relay controller plus read-only reviewer/validator agents
 * and a capability-narrowed remediator. Every worker result binds the exact
 * `operationId` plus its attempt/round context; unknown fields, stale ids,
 * duplicate results, and malformed typed semantic bases fail closed, and raw
 * worker output is discarded after strict parsing.
 *
 * Handoff semantics follow the Review Gate Convergence design specification
 * (docs/superpowers/specs/2026-10-06-review-gate-convergence-design.md):
 * §16 LNR1, §17 AR1, §18 XG1/XGR1, §21 RV1, §22 RSL1/FR1, §23 AIM1, §24 SRF1,
 * §27.5 reentry guard, and §28 CAP1.
 *
 * Pure core: no I/O and no host imports beyond `node:crypto` and `zod`.
 */

import { createHash } from "node:crypto";
import * as z from "zod";
import type { RemediationRound, ReviewGatePhase } from "./types.js";

// ---------------------------------------------------------------------------
// Agent identity
// ---------------------------------------------------------------------------

export const REVIEW_GATE_AGENT_CONTROLLER = "justice-review-controller";
export const REVIEW_GATE_AGENT_REVIEWER = "justice-review-reviewer";
export const REVIEW_GATE_AGENT_FINDING_VALIDATOR = "justice-review-finding-validator";
export const REVIEW_GATE_AGENT_REMEDIATOR = "justice-review-remediator";
/**
 * Legacy single worker from the retry-worker protocol. Registered temporarily
 * beside the canonical agents during the Task 10 compatibility window; Task 12
 * removes its automatic registration and the legacy execution facade in one
 * atomic change. User-defined config entries with this name are never deleted.
 */
export const REVIEW_GATE_AGENT_LEGACY_WORKER = "justice-review-worker";

/** The three concrete worker roles that can receive an operation packet. */
export type ReviewGateWorkerAgentV1 =
  | typeof REVIEW_GATE_AGENT_REVIEWER
  | typeof REVIEW_GATE_AGENT_FINDING_VALIDATOR
  | typeof REVIEW_GATE_AGENT_REMEDIATOR;

// ---------------------------------------------------------------------------
// Operation vocabulary
// ---------------------------------------------------------------------------

/**
 * External operation the Review Gate orchestrator can dispatch as one physical
 * foreground child task. Judgment operations that the design requires to run
 * in a fresh context are listed in `FRESH_CONTEXT_OPERATION_KINDS`.
 */
export type ReviewGateOperationKind =
  | "review_candidates"
  | "finding_validation"
  | "self_review"
  | "lineage_revalidation"
  | "cross_generation_reconciliation"
  | "non_convergence_reentry"
  | "remediation";

export const REVIEW_GATE_OPERATION_KINDS: ReadonlyArray<ReviewGateOperationKind> = Object.freeze([
  "review_candidates",
  "finding_validation",
  "self_review",
  "lineage_revalidation",
  "cross_generation_reconciliation",
  "non_convergence_reentry",
  "remediation",
] as const satisfies readonly ReviewGateOperationKind[]);

/**
 * Operations dispatching a *new foreground task with no continuation/session
 * reuse* (Task 10 step 4). Fresh reviewer candidates are history-blind (§22.2).
 * A redispatch after a crash or malformed output keeps the same logical
 * `operationId` but still uses a fresh physical child task and increments
 * `dispatchSerial`; remediation keeps round-local role continuity and is
 * therefore not marked freshContext.
 */
export const FRESH_CONTEXT_OPERATION_KINDS: ReadonlySet<ReviewGateOperationKind> = new Set([
  "review_candidates",
  "finding_validation",
  "self_review",
  "lineage_revalidation",
  "cross_generation_reconciliation",
  "non_convergence_reentry",
] as const satisfies readonly ReviewGateOperationKind[]);

const WORKER_AGENT_BY_OPERATION: ReadonlyMap<ReviewGateOperationKind, ReviewGateWorkerAgentV1> =
  new Map([
    ["review_candidates", REVIEW_GATE_AGENT_REVIEWER],
    ["finding_validation", REVIEW_GATE_AGENT_FINDING_VALIDATOR],
    ["self_review", REVIEW_GATE_AGENT_FINDING_VALIDATOR],
    ["lineage_revalidation", REVIEW_GATE_AGENT_FINDING_VALIDATOR],
    ["cross_generation_reconciliation", REVIEW_GATE_AGENT_FINDING_VALIDATOR],
    ["non_convergence_reentry", REVIEW_GATE_AGENT_FINDING_VALIDATOR],
    ["remediation", REVIEW_GATE_AGENT_REMEDIATOR],
  ]);

// ---------------------------------------------------------------------------
// Static prompt contracts (digest inputs)
// ---------------------------------------------------------------------------

/** Exactly the five keys Task 12's production protocol factory consumes. */
export type ReviewGatePromptContractKey =
  | "designReviewer"
  | "planReviewer"
  | "findingValidator"
  | "remediator"
  | "selfReview";

export const REVIEW_GATE_PROMPT_CONTRACT_DIGEST_KEYS: ReadonlyArray<ReviewGatePromptContractKey> =
  Object.freeze([
    "designReviewer",
    "planReviewer",
    "findingValidator",
    "remediator",
    "selfReview",
  ] as const satisfies readonly ReviewGatePromptContractKey[]);

const REVIEWER_RESULT_CONTRACT =
  'Return exactly one strict JSON result object and nothing else (no prose, no markdown fences): {"schemaVersion":1,"operationId":"<operationId>","gateId":"<gateId>","phase":"<phase>","reviewAttemptId":"<reviewAttemptId>","remediationRound":null,"candidates":[{"candidateId":"<opaque local id>","severity":"critical|major|minor","summary":"<brief summary>","location":"<artifact-relative location>"}]}';

const QUERY_EVIDENCE_CLAUSE =
  "Treat any status/diff/log evidence in the payload as read-only evidence outsourced by the Justice query service; never attempt to reproduce or extend it.";

/**
 * Immutable static prompt text per contract key. Dynamic gate/attempt/round/
 * artifact values never appear here: they live only in the operation payload
 * appended by the packet builders, so each static digest stays stable for the
 * whole gate lifetime and across gates.
 */
export const REVIEW_GATE_STATIC_PROMPT_CONTRACTS: Readonly<
  Record<ReviewGatePromptContractKey, string>
> = Object.freeze({
  designReviewer: Object.freeze(
    [
      "You are the Justice Review Gate fresh reviewer for the DESIGN phase.",
      "You run history-blind in a fresh context: you receive no finding lineage, no remediation history, and no reviewer hidden reasoning. Judge only from the pinned inputs in the operation payload.",
      "Scope: read only the pinned Requirements and Design artifacts listed in the payload, together with any Justice query-service evidence notes. Do not read README, AGENTS, SPEC, code, or any other file. Do not use shell, git, task, skill, memory, code search, or any other tool. You have no write authority.",
      "Report candidate defects as observations only. Validity, severity, owner scope, typed semantic basis, and semantic relation are reserved for the Justice finding validator; you never decide lineage, phase, remediation, or finding status.",
      QUERY_EVIDENCE_CLAUSE,
      REVIEWER_RESULT_CONTRACT,
      "\"candidates\" is your complete candidate list and may be empty. Unknown fields, duplicate candidate ids, stale ids, empty strings, and malformed values all fail the operation closed.",
    ].join("\n"),
  ),
  planReviewer: Object.freeze(
    [
      "You are the Justice Review Gate fresh reviewer for the PLAN phase.",
      "You run history-blind in a fresh context: you receive no finding lineage, no remediation history, and no reviewer hidden reasoning. Judge only from the pinned inputs in the operation payload.",
      "Scope: read only the pinned approved Design and Plan artifacts listed in the payload, together with any Justice query-service evidence notes. Do not read README, AGENTS, SPEC, code, or any other file. Do not use shell, git, task, skill, memory, code search, or any other tool. You have no write authority.",
      "Report candidate defects as observations only. Validity, severity, owner scope, typed semantic basis, and semantic relation are reserved for the Justice finding validator; you never decide lineage, phase, remediation, or finding status.",
      QUERY_EVIDENCE_CLAUSE,
      REVIEWER_RESULT_CONTRACT,
      "\"candidates\" is your complete candidate list and may be empty. Unknown fields, duplicate candidate ids, stale ids, empty strings, and malformed values all fail the operation closed.",
    ].join("\n"),
  ),
  findingValidator: Object.freeze(
    [
      "You are the Justice Review Gate finding validator running in a fresh context.",
      "You receive exactly one candidate finding, the pinned phase artifacts/baseline, necessary typed review history, and opaque existing-lineage candidates. You never receive reviewer hidden reasoning.",
      "Scope: read only the pinned artifacts and evidence notes listed in the payload. Do not read README, AGENTS, SPEC, code, or any other file. Do not use shell, git, task, skill, memory, code search, or any other tool. You have no write authority.",
      "Your decision set for a candidate is exactly: VALID, INVALID, DUPLICATE, ALREADY_RESOLVED, ADVISORY, DESIGN_REOPEN_REQUIRED, REQUIREMENTS_REOPEN_REQUIRED. For a valid observation you are the authority for validity, severity, owner scope, typed semantic basis, and the same-generation semantic relation (EXISTING referencing the opaque lineage ref you were offered, or NEW without one). A merely different architectural taste or reviewer preference is not a blocking finding.",
      "Semantic relation NONE is valid only for INVALID candidates: an INVALID observation is never remediated and creates no blocking lineage transition, while its occurrences remain auditable. DUPLICATE plus EXISTING identifies duplicate candidate observations in the same review snapshot. ALREADY_RESOLVED requires the EXISTING relation with an opaque lineage ref; NEW plus ALREADY_RESOLVED is impossible. Reopen decisions declare a semantic basis owned by the matching upstream scope (DESIGN_REOPEN_REQUIRED with ownerScope design; REQUIREMENTS_REOPEN_REQUIRED with ownerScope requirements).",
      "For requiredResultKind finding_validation, return candidateId, decision, observedPhase, and relation. VALID and ADVISORY require severity and semanticBasis; VALID severity is blocking or minor, while ADVISORY severity is minor only. INVALID requires relation NONE and omits severity; semanticBasis is optional unless a decision below requires it. DUPLICATE and ALREADY_RESOLVED require relation EXISTING; ALREADY_RESOLVED also requires existingLineageRef. DESIGN_REOPEN_REQUIRED requires semanticBasis.ownerScope design; REQUIREMENTS_REOPEN_REQUIRED requires semanticBasis.ownerScope requirements. Other decisions may omit semanticBasis. For every decision, relation EXISTING requires existingLineageRef and relation NEW forbids it; decisions permitting EXISTING or NEW are VALID, ADVISORY, and both reopen decisions.",
      "For requiredResultKind lineage_revalidation, return lineageId and result (STILL_PRESENT, RESOLVED, or INDETERMINATE); do not include severity, semanticBasis, or lineage refs. For cross_generation_reconciliation, return lineageId and verdict (RELATED_PRIOR_GENERATION or NO_PRIOR_MATCH); RELATED_PRIOR_GENERATION requires the offered predecessorLineageRef object, while NO_PRIOR_MATCH forbids that field. For non_convergence_reentry, return outcome (MATERIAL_PROGRESS, NO_MATERIAL_PROGRESS, REQUIREMENTS_REOPEN_REQUIRED, or DESIGN_REOPEN_REQUIRED); the two reopen outcomes require lineageId from the offered committed upstream lineage, and the other outcomes forbid lineageId. These three result kinds have no severity or semanticBasis fields.",
      'Return exactly one strict JSON result object and nothing else (no prose, no markdown fences). The result envelope is {"schemaVersion":1,"operationId":"<operationId>","gateId":"<gateId>","phase":"<phase>","reviewAttemptId":<reviewAttemptId or null>,"remediationRound":<remediationRound object or null>} plus only the fields specified for requiredResultKind. reviewAttemptId is required for finding_validation and cross_generation_reconciliation; remediationRound is forbidden for finding_validation.',
      "Unknown fields, duplicate entries, stale ids, empty strings, and malformed values all fail the operation closed.",
    ].join("\n"),
  ),
  remediator: Object.freeze(
    [
      "You are the Justice Review Gate remediator.",
      "You read the pinned upstream authority artifacts and the current phase target named in the payload, and you write only that single target artifact using edit/write/apply_patch. The Justice hook and CAP1 capability model narrow your actual write scope; stepping outside it fails the operation closed.",
      "Do not use shell, git, task, skill, memory, code search, or any other tool. You never commit, push, stage, or restore: Justice core owns every commit and restore action. You never touch anything outside the pinned target artifact, and Requirements content is never a mutation target.",
      QUERY_EVIDENCE_CLAUSE,
      "When the payload pins runtime-verified pre-image or post-image digests, the runtime computes and verifies them; never fabricate or adjust digests yourself.",
      'Return exactly one strict JSON result object and nothing else (no prose, no markdown fences): {"schemaVersion":1,"operationId":"<operationId>","gateId":"<gateId>","phase":"<phase>","reviewAttemptId":<reviewAttemptId or null>,"remediationRound":{"phase":"<phase>","ordinal":<ordinal>},"targetPath":"<target artifact path>","outcome":"COMPLETED|NO_CHANGE","summary":"<brief summary of the applied change>"}',
      "Unknown fields, stale ids, empty strings, and malformed values fail the operation closed.",
    ].join("\n"),
  ),
  selfReview: Object.freeze(
    [
      "You are the Justice Review Gate self-review validator running in a fresh context.",
      "You perform targeted resolution validation for the pinned remediation target lineages, and you are the validated discovery authority for regressions observed on the pinned post-remediation baseline. You never receive reviewer hidden reasoning.",
      "Scope: read only the pinned artifacts and evidence notes listed in the payload. Do not read README, AGENTS, SPEC, code, or any other file. Do not use shell, git, task, skill, memory, code search, or any other tool. You have no write authority.",
      "Target checks decide exactly RESOLVED, STILL_PRESENT, or INDETERMINATE for each pinned target lineage and create no occurrences. Discovered findings carry validity (VALID, ADVISORY, or INVALID) plus the same-generation semantic relation (EXISTING referencing the opaque lineage ref you were offered, or NEW) in the same result: they are never passed through a second ordinary validity call. Discovered findings may create occurrences and enter normal lineage reconciliation; Justice core remains the authoritative reconciliation and commit path.",
      'Return exactly one strict JSON result object and nothing else (no prose, no markdown fences): {"schemaVersion":1,"operationId":"<operationId>","gateId":"<gateId>","phase":"<phase>","reviewAttemptId":<reviewAttemptId or null>,"remediationRound":{"phase":"<phase>","ordinal":<ordinal>},"targetLineageChecks":[{"lineageId":"<opaque ref>","result":"RESOLVED|STILL_PRESENT|INDETERMINATE"}],"discoveredFindings":[{"candidateId":"<opaque local id>","validity":"VALID|ADVISORY|INVALID","severity":"blocking|minor only for VALID; minor only for ADVISORY; omit for INVALID","semanticRelation":"EXISTING|NEW","existingLineageRef":"required only for EXISTING","semanticBasis":{"violationType":"...","governingReference":"...","semanticLocation":"...","violatedContract":"...","ownerScope":"requirements|design|plan"}}]}. VALID requires blocking or minor severity; ADVISORY requires minor severity; INVALID must omit severity. Each discovered finding requires semanticBasis. EXISTING requires existingLineageRef; NEW forbids it.',
      "Unknown fields, duplicate lineage checks, duplicate discovered candidate ids, stale ids, empty strings, and malformed values fail the operation closed. Reporting one target lineage as STILL_PRESENT while also rediscovering that same lineage as an EXISTING discovered finding is a SELF_REVIEW_RESULT_CONFLICT and fails the operation closed.",
    ].join("\n"),
  ),
});

/** Maps an operation kind to the static contract key consumed per phase. */
export function staticPromptContractKeyForOperation(
  operation: ReviewGateOperationKind,
  phase: ReviewGatePhase,
): ReviewGatePromptContractKey {
  switch (operation) {
    case "review_candidates":
      return phase === "design" ? "designReviewer" : "planReviewer";
    case "finding_validation":
    case "lineage_revalidation":
    case "cross_generation_reconciliation":
    case "non_convergence_reentry":
      return "findingValidator";
    case "self_review":
      return "selfReview";
    case "remediation":
      return "remediator";
    default: {
      const exhaustive: never = operation;
      throw new Error(`review_gate_operation_unknown: ${String(exhaustive)}`);
    }
  }
}

/** Stable sha256 hex digests over the exact static contract texts (UTF-8). */
export function computeReviewGatePromptContractDigests(): Readonly<
  Record<ReviewGatePromptContractKey, string>
> {
  const digests = Object.fromEntries(
    REVIEW_GATE_PROMPT_CONTRACT_DIGEST_KEYS.map((key) => [
      key,
      createHash("sha256").update(REVIEW_GATE_STATIC_PROMPT_CONTRACTS[key], "utf8").digest("hex"),
    ]),
  ) as Record<ReviewGatePromptContractKey, string>;
  return Object.freeze(digests);
}

// ---------------------------------------------------------------------------
// Operation payload and packet types
// ---------------------------------------------------------------------------

/** Justice-pinned artifact identity injected into a worker payload. */
export type ReviewGatePacketArtifactRefV1 = Readonly<{
  role: "requirements" | "design" | "plan";
  canonicalPath: string;
  digest: string;
}>;

/** One fresh reviewer candidate observation (also the validator's input). */
export type ReviewCandidateObservationV1 = Readonly<{
  candidateId: string;
  severity: "critical" | "major" | "minor";
  summary: string;
  location: string;
}>;

/** Immutable canonical semantic basis for one defect identity (§16.2). */
export type ReviewSemanticBasisV1 = Readonly<{
  violationType: string;
  governingReference: string;
  semanticLocation: string;
  violatedContract: string;
  ownerScope: "requirements" | "design" | "plan";
}>;

/** Correlation setup for one logical external operation (§23 AIM1). */
export type ReviewGateOperationCorrelationSetupV1 = Readonly<{
  /** Stable identity of the logical operation; survives redispatch. */
  readonly operationId: string;
  readonly gateId: string;
  readonly phase: ReviewGatePhase;
  /** The review attempt this judgment belongs to, when any. */
  readonly reviewAttemptId: string | null;
  /** The remediation round this operation belongs to, when any. */
  readonly remediationRound: RemediationRound | null;
  /** Physical dispatch counter for this logical operation; starts at 1. */
  readonly dispatchSerial: number;
}>;

const PACKET_PAYLOAD_MARKER = "[JUSTICE: REVIEW GATE OPERATION PAYLOAD]";

export type ReviewGateOperationPacketV1 = Readonly<{
  readonly packetVersion: 1;
  readonly operation: ReviewGateOperationKind;
  /** The result schema the worker must return; identical to the operation kind. */
  readonly expectedResultKind: ReviewGateOperationKind;
  readonly operationId: string;
  readonly gateId: string;
  readonly phase: ReviewGatePhase;
  readonly reviewAttemptId: string | null;
  readonly remediationRound: RemediationRound | null;
  readonly workerAgent: ReviewGateWorkerAgentV1;
  /** True when the worker context must not continue or reuse a session. */
  readonly freshContext: boolean;
  readonly dispatchSerial: number;
  readonly staticPromptContractKey: ReviewGatePromptContractKey;
  /** Exact text the controller relays verbatim to one foreground task call. */
  readonly workerPrompt: string;
}>;

// ---------------------------------------------------------------------------
// Builder validation helpers (fail closed before any packet exists)
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

const PHASE_SCOPE_ROLES: ReadonlyMap<ReviewGatePhase, ReadonlySet<string>> = new Map([
  ["design", new Set(["requirements", "design"])],
  ["plan", new Set(["design", "plan"])],
]);

const PHASE_AUTHORITY_ROLES: ReadonlyMap<ReviewGatePhase, ReadonlySet<string>> = new Map([
  ["design", new Set(["requirements"])],
  ["plan", new Set(["design"])],
]);

function invalidArgument(message: string): Error {
  return new Error(`review_gate_operation_invalid: ${message}`);
}

function requireCorrelation(correlation: ReviewGateOperationCorrelationSetupV1): void {
  if (correlation.operationId.length === 0 || correlation.gateId.length === 0) {
    throw invalidArgument("correlation_required");
  }
  if (!ID_PATTERN.test(correlation.operationId) || !ID_PATTERN.test(correlation.gateId)) {
    throw invalidArgument("correlation_id_format");
  }
  if (
    correlation.reviewAttemptId !== null &&
    (correlation.reviewAttemptId.length === 0 || !ID_PATTERN.test(correlation.reviewAttemptId))
  ) {
    throw invalidArgument("correlation_id_format");
  }
  if (!Number.isSafeInteger(correlation.dispatchSerial) || correlation.dispatchSerial < 1) {
    throw invalidArgument("dispatch_serial_positive_integer");
  }
  if (correlation.remediationRound !== null) {
    requireRemediationRound(correlation.remediationRound);
  }
}

function requireRemediationRound(round: RemediationRound): void {
  if (
    (round.phase !== "design" && round.phase !== "plan") ||
    !Number.isSafeInteger(round.ordinal) ||
    round.ordinal < 1
  ) {
    throw invalidArgument("remediation_round_shape");
  }
}

function requireDistinctOpaqueRefs(refs: readonly string[], argName: string): void {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (ref.length === 0 || !ID_PATTERN.test(ref) || seen.has(ref)) {
      throw invalidArgument(`${argName}_invalid_or_duplicate`);
    }
    seen.add(ref);
  }
}

/**
 * Enforce the exact phase-scoped artifact pair: Design-phase operations pin
 * Requirements + Design; Plan-phase operations pin approved Design + Plan.
 */
function requirePhaseScopedArtifacts(
  phase: ReviewGatePhase,
  refs: readonly ReviewGatePacketArtifactRefV1[],
): void {
  const expectedRoles = PHASE_SCOPE_ROLES.get(phase);
  if (expectedRoles === undefined) {
    throw invalidArgument("artifact_phase_scope_violation");
  }
  const roles = refs.map((ref) => ref.role);
  if (roles.length !== expectedRoles.size) {
    throw invalidArgument("artifact_phase_scope_violation");
  }
  for (const role of roles) {
    if (!expectedRoles.has(role)) {
      throw invalidArgument("artifact_phase_scope_violation");
    }
  }
  if (new Set(roles).size !== roles.length) {
    throw invalidArgument("artifact_phase_scope_violation");
  }
  for (const ref of refs) {
    if (ref.canonicalPath.length === 0 || ref.digest.length === 0) {
      throw invalidArgument("artifact_phase_scope_violation");
    }
  }
}

function requireAuthorityArtifacts(
  phase: ReviewGatePhase,
  authorityArtifacts: readonly ReviewGatePacketArtifactRefV1[],
  targetArtifact: ReviewGatePacketArtifactRefV1,
): void {
  const expectedRoles = PHASE_AUTHORITY_ROLES.get(phase);
  if (
    expectedRoles === undefined ||
    authorityArtifacts.length !== expectedRoles.size ||
    authorityArtifacts.some((ref) => !expectedRoles.has(ref.role))
  ) {
    throw invalidArgument("artifact_phase_scope_violation");
  }
  if (targetArtifact.role !== phase) {
    throw invalidArgument("target_phase_mismatch");
  }
  if (targetArtifact.canonicalPath.length === 0 || targetArtifact.digest.length === 0) {
    throw invalidArgument("artifact_phase_scope_violation");
  }
}

// ---------------------------------------------------------------------------
// Packet builders
// ---------------------------------------------------------------------------

function buildOperationPacket(
  operation: ReviewGateOperationKind,
  correlation: ReviewGateOperationCorrelationSetupV1,
  payload: Readonly<Record<string, unknown>>,
): ReviewGateOperationPacketV1 {
  requireCorrelation(correlation);
  const contractKey = staticPromptContractKeyForOperation(operation, correlation.phase);
  const workerAgent = WORKER_AGENT_BY_OPERATION.get(operation);
  if (workerAgent === undefined) {
    throw new Error(`review_gate_operation_unknown: ${operation}`);
  }
  const payloadJson = JSON.stringify({ ...payload, requiredResultKind: operation });
  const workerPrompt = [
    REVIEW_GATE_STATIC_PROMPT_CONTRACTS[contractKey],
    "",
    PACKET_PAYLOAD_MARKER,
    payloadJson,
    "",
    "Return the strict JSON result now, exactly per the static contract above.",
  ].join("\n");
  return Object.freeze({
    packetVersion: 1,
    operation,
    expectedResultKind: operation,
    operationId: correlation.operationId,
    gateId: correlation.gateId,
    phase: correlation.phase,
    reviewAttemptId: correlation.reviewAttemptId,
    remediationRound: correlation.remediationRound,
    workerAgent,
    freshContext: FRESH_CONTEXT_OPERATION_KINDS.has(operation),
    dispatchSerial: correlation.dispatchSerial,
    staticPromptContractKey: contractKey,
    workerPrompt,
  });
}

/** Fresh reviewer dispatch (§22.2): history-blind, never remediation-bound. */
export function buildReviewerOperationPacket(args: Readonly<{
  correlation: ReviewGateOperationCorrelationSetupV1;
  artifactRefs: readonly ReviewGatePacketArtifactRefV1[];
  evidenceNotes?: readonly string[];
}>): ReviewGateOperationPacketV1 {
  if (args.correlation.reviewAttemptId === null) {
    throw invalidArgument("review_attempt_required");
  }
  if (args.correlation.remediationRound !== null) {
    throw invalidArgument("remediation_round_forbidden");
  }
  requirePhaseScopedArtifacts(args.correlation.phase, args.artifactRefs);
  return buildOperationPacket("review_candidates", args.correlation, {
    artifacts: Object.freeze([...args.artifactRefs]),
    evidenceNotes: Object.freeze([...(args.evidenceNotes ?? [])]),
  });
}

/** Ordinary finding validation for one candidate (fresh validator context). */
export function buildFindingValidatorOperationPacket(args: Readonly<{
  correlation: ReviewGateOperationCorrelationSetupV1;
  candidate: ReviewCandidateObservationV1;
  artifactRefs: readonly ReviewGatePacketArtifactRefV1[];
  opaqueExistingLineageRefs: readonly string[];
  evidenceNotes?: readonly string[];
}>): ReviewGateOperationPacketV1 {
  if (args.correlation.reviewAttemptId === null) {
    throw invalidArgument("review_attempt_required");
  }
  if (args.correlation.remediationRound !== null) {
    throw invalidArgument("remediation_round_forbidden");
  }
  if (
    args.candidate.candidateId.length === 0 ||
    args.candidate.summary.length === 0 ||
    args.candidate.location.length === 0
  ) {
    throw invalidArgument("candidate_required");
  }
  requireDistinctOpaqueRefs([args.candidate.candidateId], "candidate_ref");
  requirePhaseScopedArtifacts(args.correlation.phase, args.artifactRefs);
  requireDistinctOpaqueRefs(args.opaqueExistingLineageRefs, "opaque_lineage_ref");
  return buildOperationPacket("finding_validation", args.correlation, {
    artifacts: Object.freeze([...args.artifactRefs]),
    candidate: Object.freeze({ ...args.candidate }),
    opaqueExistingLineageRefs: Object.freeze([...args.opaqueExistingLineageRefs]),
    evidenceNotes: Object.freeze([...(args.evidenceNotes ?? [])]),
  });
}

/** Self-review dispatch in a fresh validator context (§24 SRF1). */
export function buildSelfReviewOperationPacket(args: Readonly<{
  correlation: ReviewGateOperationCorrelationSetupV1;
  targetLineageRefs: readonly string[];
  existingLineageCandidateRefs: readonly string[];
  artifactRefs: readonly ReviewGatePacketArtifactRefV1[];
  evidenceNotes?: readonly string[];
}>): ReviewGateOperationPacketV1 {
  if (args.correlation.remediationRound === null) {
    throw invalidArgument("remediation_round_required");
  }
  requireRemediationRound(args.correlation.remediationRound);
  requirePhaseScopedArtifacts(args.correlation.phase, args.artifactRefs);
  requireDistinctOpaqueRefs(args.targetLineageRefs, "target_lineage_ref");
  requireDistinctOpaqueRefs(args.existingLineageCandidateRefs, "opaque_lineage_ref");
  return buildOperationPacket("self_review", args.correlation, {
    artifacts: Object.freeze([...args.artifactRefs]),
    targetLineageRefs: Object.freeze([...args.targetLineageRefs]),
    existingLineageCandidateRefs: Object.freeze([...args.existingLineageCandidateRefs]),
    evidenceNotes: Object.freeze([...(args.evidenceNotes ?? [])]),
  });
}

/** Stale-lineage revalidation for exactly one lineage (§21 RV1). */
export function buildLineageRevalidationOperationPacket(args: Readonly<{
  correlation: ReviewGateOperationCorrelationSetupV1;
  lineageId: string;
  artifactRefs: readonly ReviewGatePacketArtifactRefV1[];
  evidenceNotes?: readonly string[];
}>): ReviewGateOperationPacketV1 {
  requireDistinctOpaqueRefs([args.lineageId], "lineage_ref");
  requirePhaseScopedArtifacts(args.correlation.phase, args.artifactRefs);
  return buildOperationPacket("lineage_revalidation", args.correlation, {
    artifacts: Object.freeze([...args.artifactRefs]),
    lineageId: args.lineageId,
    evidenceNotes: Object.freeze([...(args.evidenceNotes ?? [])]),
  });
}

/** Cross-generation continuity reconciliation for a NEW lineage (§18 XGR1). */
export function buildCrossGenerationReconciliationOperationPacket(args: Readonly<{
  correlation: ReviewGateOperationCorrelationSetupV1;
  lineageId: string;
  predecessorGateId: string;
  eligiblePredecessorLineageRefs: readonly string[];
}>): ReviewGateOperationPacketV1 {
  if (args.correlation.reviewAttemptId === null) {
    throw invalidArgument("review_attempt_required");
  }
  requireDistinctOpaqueRefs([args.lineageId], "lineage_ref");
  if (args.predecessorGateId.length === 0 || !ID_PATTERN.test(args.predecessorGateId)) {
    throw invalidArgument("predecessor_gate_id");
  }
  requireDistinctOpaqueRefs(args.eligiblePredecessorLineageRefs, "opaque_lineage_ref");
  return buildOperationPacket("cross_generation_reconciliation", args.correlation, {
    lineageId: args.lineageId,
    predecessorGateId: args.predecessorGateId,
    eligiblePredecessorLineageRefs: Object.freeze([...args.eligiblePredecessorLineageRefs]),
  });
}

/** Non-convergence reentry validation in a fresh context (§27.5 N1). */
export function buildNonConvergenceReentryOperationPacket(args: Readonly<{
  correlation: ReviewGateOperationCorrelationSetupV1;
  changedArtifacts: readonly ReviewGatePacketArtifactRefV1[];
  blockingLineageRefs: readonly string[];
  evidenceNotes?: readonly string[];
}>): ReviewGateOperationPacketV1 {
  requirePhaseScopedArtifacts(args.correlation.phase, args.changedArtifacts);
  requireDistinctOpaqueRefs(args.blockingLineageRefs, "blocking_lineage_ref");
  return buildOperationPacket("non_convergence_reentry", args.correlation, {
    changedArtifacts: Object.freeze([...args.changedArtifacts]),
    blockingLineageRefs: Object.freeze([...args.blockingLineageRefs]),
    evidenceNotes: Object.freeze([...(args.evidenceNotes ?? [])]),
  });
}

/** Remediation dispatch bound to one round and one target (§28.2). */
export function buildRemediationOperationPacket(args: Readonly<{
  correlation: ReviewGateOperationCorrelationSetupV1;
  authorityArtifacts: readonly ReviewGatePacketArtifactRefV1[];
  targetArtifact: ReviewGatePacketArtifactRefV1;
  evidenceNotes?: readonly string[];
}>): ReviewGateOperationPacketV1 {
  if (args.correlation.remediationRound === null) {
    throw invalidArgument("remediation_round_required");
  }
  requireRemediationRound(args.correlation.remediationRound);
  requireAuthorityArtifacts(args.correlation.phase, args.authorityArtifacts, args.targetArtifact);
  return buildOperationPacket("remediation", args.correlation, {
    authorityArtifacts: Object.freeze([...args.authorityArtifacts]),
    targetArtifact: Object.freeze({ ...args.targetArtifact }),
    evidenceNotes: Object.freeze([...(args.evidenceNotes ?? [])]),
  });
}

// ---------------------------------------------------------------------------
// Result schemas
// ---------------------------------------------------------------------------

export type ReviewGateResultExpectationV1 = Readonly<{
  readonly operationId: string;
  readonly gateId: string;
  readonly phase: ReviewGatePhase;
  /** Compared when provided; omitted means "not compared". */
  readonly reviewAttemptId?: string;
  /** Compared when provided; omitted means "not compared". */
  readonly remediationRound?: RemediationRound;
}>;

export type ReviewGateCorrelationField =
  | "operationId"
  | "gateId"
  | "phase"
  | "reviewAttemptId"
  | "remediationRound";

const nonEmptyTrimmedString = z
  .string()
  .refine((value) => value.length > 0 && value.trim().length > 0, { error: "empty_string" });

const phaseSchema = z.enum(["design", "plan"]);
const ownerScopeSchema = z.enum(["requirements", "design", "plan"]);
const validatorSeveritySchema = z.enum(["blocking", "minor"]);
const relationSchema = z.enum(["EXISTING", "NEW", "NONE"]);
const decisionSchema = z.enum([
  "VALID",
  "INVALID",
  "DUPLICATE",
  "ALREADY_RESOLVED",
  "ADVISORY",
  "DESIGN_REOPEN_REQUIRED",
  "REQUIREMENTS_REOPEN_REQUIRED",
]);
const reviewCandidateSeveritySchema = z.enum(["critical", "major", "minor"]);

const remediationRoundSchema = z.strictObject({
  phase: phaseSchema,
  ordinal: z.int().min(1),
});

const semanticBasisSchema = z.strictObject({
  violationType: nonEmptyTrimmedString,
  governingReference: nonEmptyTrimmedString,
  semanticLocation: nonEmptyTrimmedString,
  violatedContract: nonEmptyTrimmedString,
  ownerScope: ownerScopeSchema,
});

const candidateObservationSchema = z.strictObject({
  candidateId: nonEmptyTrimmedString,
  severity: reviewCandidateSeveritySchema,
  summary: nonEmptyTrimmedString,
  location: nonEmptyTrimmedString,
});

const envelopeFields = {
  schemaVersion: z.literal(1),
  operationId: nonEmptyTrimmedString,
  gateId: nonEmptyTrimmedString,
  phase: phaseSchema,
  reviewAttemptId: z.union([nonEmptyTrimmedString, z.literal(null)]),
  remediationRound: z.union([remediationRoundSchema, z.literal(null)]),
} as const;

type EnvelopeValue = Readonly<{
  schemaVersion: 1;
  operationId: string;
  gateId: string;
  phase: ReviewGatePhase;
  reviewAttemptId: string | null;
  remediationRound: RemediationRound | null;
}>;

const REVIEW_ATTEMPT_REQUIRED_KINDS: ReadonlySet<ReviewGateOperationKind> = new Set([
  "review_candidates",
  "finding_validation",
  "cross_generation_reconciliation",
] as const satisfies readonly ReviewGateOperationKind[]);

const REMEDIATION_ROUND_REQUIRED_KINDS: ReadonlySet<ReviewGateOperationKind> = new Set([
  "remediation",
  "self_review",
] as const satisfies readonly ReviewGateOperationKind[]);

const REMEDIATION_ROUND_FORBIDDEN_KINDS: ReadonlySet<ReviewGateOperationKind> = new Set([
  "review_candidates",
  "finding_validation",
] as const satisfies readonly ReviewGateOperationKind[]);

type IssueSink = { addIssue: (issue: { code: "custom"; message: string }) => void };

/**
 * Structural attempt/round matrix per result kind, enforced fail closed inside
 * the schema so every parser yields a deterministic envelope before the
 * correlation comparison:
 * - review_candidates / finding_validation / cross_generation_reconciliation:
 *   attempt required ("review_attempt_required"),
 * - remediation / self_review: round required ("remediation_round_required"),
 * - review_candidates / finding_validation: round forbidden
 *   ("remediation_round_forbidden").
 */
function checkEnvelopeByKind(
  kind: ReviewGateOperationKind,
  envelope: { reviewAttemptId: string | null; remediationRound: RemediationRound | null },
  sink: IssueSink,
): void {
  if (REVIEW_ATTEMPT_REQUIRED_KINDS.has(kind) && envelope.reviewAttemptId === null) {
    sink.addIssue({ code: "custom", message: "review_attempt_required" });
    return;
  }
  if (REMEDIATION_ROUND_REQUIRED_KINDS.has(kind) && envelope.remediationRound === null) {
    sink.addIssue({ code: "custom", message: "remediation_round_required" });
    return;
  }
  if (REMEDIATION_ROUND_FORBIDDEN_KINDS.has(kind) && envelope.remediationRound !== null) {
    sink.addIssue({ code: "custom", message: "remediation_round_forbidden" });
  }
}

function envelopeFrom(
  value: {
    schemaVersion: 1;
    operationId: string;
    gateId: string;
    phase: ReviewGatePhase;
    reviewAttemptId: string | null;
    remediationRound: RemediationRound | null;
  },
): EnvelopeValue {
  return Object.freeze({
    schemaVersion: 1,
    operationId: value.operationId,
    gateId: value.gateId,
    phase: value.phase,
    reviewAttemptId: value.reviewAttemptId,
    remediationRound:
      value.remediationRound === null ? null : Object.freeze({ ...value.remediationRound }),
  });
}

function freezeBasis(basis: z.infer<typeof semanticBasisSchema>): ReviewSemanticBasisV1 {
  return Object.freeze({ ...basis });
}

function requireDefined<T>(value: T | undefined | null, code: string): T {
  if (value === undefined || value === null) {
    throw new Error(code);
  }
  return value;
}

// -- review candidates ----------------------------------------------------------

const reviewCandidatesResultSchema = z
  .strictObject({
    ...envelopeFields,
    candidates: candidateObservationSchema.array(),
  })
  .superRefine((value, sink) => {
    checkEnvelopeByKind("review_candidates", value, sink);
    const seen = new Set<string>();
    for (const candidate of value.candidates) {
      if (seen.has(candidate.candidateId)) {
        sink.addIssue({ code: "custom", message: "duplicate_candidate" });
        return;
      }
      seen.add(candidate.candidateId);
    }
  })
  .transform((value) =>
    Object.freeze({
      ...envelopeFrom(value),
      candidates: Object.freeze(value.candidates.map((candidate) => Object.freeze(candidate))),
    }),
  );

// -- finding validation ------------------------------------------------------------

const findingValidationResultSchema = z
  .strictObject({
    ...envelopeFields,
    candidateId: nonEmptyTrimmedString,
    decision: decisionSchema,
    severity: validatorSeveritySchema.optional(),
    observedPhase: ownerScopeSchema,
    semanticBasis: semanticBasisSchema.optional(),
    relation: relationSchema,
    existingLineageRef: nonEmptyTrimmedString.optional(),
  })
  .superRefine((value, sink) => {
    checkEnvelopeByKind("finding_validation", value, sink);
    if (!decisionAllowsRelations(value.decision).includes(value.relation)) {
      sink.addIssue({ code: "custom", message: "decision_relation_conflict" });
      return;
    }
    if (value.relation === "EXISTING" && value.existingLineageRef === undefined) {
      sink.addIssue({ code: "custom", message: "existing_lineage_ref_required" });
      return;
    }
    if (value.relation === "NEW" && value.existingLineageRef !== undefined) {
      sink.addIssue({ code: "custom", message: "existing_lineage_ref_forbidden" });
      return;
    }
    const severityAllowed = decisionAllowsSeverity(value.decision);
    if (severityAllowed && value.severity === undefined) {
      sink.addIssue({ code: "custom", message: "decision_severity_required" });
      return;
    }
    if (!severityAllowed && value.severity !== undefined) {
      sink.addIssue({ code: "custom", message: "decision_severity_forbidden" });
      return;
    }
    if (value.decision === "ADVISORY" && value.severity === "blocking") {
      sink.addIssue({ code: "custom", message: "decision_severity_conflict" });
      return;
    }
    if (value.semanticBasis === undefined) {
      if (decisionRequiresBasis(value.decision)) {
        sink.addIssue({ code: "custom", message: "decision_basis_required" });
      }
      return;
    }
    if (value.decision === "DESIGN_REOPEN_REQUIRED" && value.semanticBasis.ownerScope !== "design") {
      sink.addIssue({ code: "custom", message: "decision_owner_scope_conflict" });
      return;
    }
    if (
      value.decision === "REQUIREMENTS_REOPEN_REQUIRED" &&
      value.semanticBasis.ownerScope !== "requirements"
    ) {
      sink.addIssue({ code: "custom", message: "decision_owner_scope_conflict" });
    }
  })
  .transform((value) =>
    Object.freeze({
      ...envelopeFrom(value),
      candidateId: value.candidateId,
      decision: value.decision,
      severity: value.severity,
      observedPhase: value.observedPhase,
      semanticBasis: value.semanticBasis === undefined ? undefined : freezeBasis(value.semanticBasis),
      relation: value.relation,
      existingLineageRef: value.existingLineageRef,
    }),
  );

type DecisionValue = z.infer<typeof decisionSchema>;

function decisionAllowsRelations(decision: DecisionValue): readonly string[] {
  switch (decision) {
    case "VALID":
    case "ADVISORY":
    case "DESIGN_REOPEN_REQUIRED":
    case "REQUIREMENTS_REOPEN_REQUIRED":
      return ["EXISTING", "NEW"];
    case "INVALID":
      return ["NONE"];
    case "DUPLICATE":
    case "ALREADY_RESOLVED":
      return ["EXISTING"];
  }
}

function decisionAllowsSeverity(decision: DecisionValue): boolean {
  return decision === "VALID" || decision === "ADVISORY";
}

function decisionRequiresBasis(decision: DecisionValue): boolean {
  return (
    decision === "VALID" ||
    decision === "ADVISORY" ||
    decision === "DESIGN_REOPEN_REQUIRED" ||
    decision === "REQUIREMENTS_REOPEN_REQUIRED"
  );
}

// -- self review -------------------------------------------------------------------

const selfReviewTargetCheckSchema = z.strictObject({
  lineageId: nonEmptyTrimmedString,
  result: z.enum(["RESOLVED", "STILL_PRESENT", "INDETERMINATE"]),
});

const selfReviewDiscoveredFindingSchema = z
  .strictObject({
    candidateId: nonEmptyTrimmedString,
    validity: z.enum(["VALID", "ADVISORY", "INVALID"]).optional(),
    severity: z.union([validatorSeveritySchema, z.literal(null)]).optional(),
    semanticRelation: z.enum(["EXISTING", "NEW"]).optional(),
    existingLineageRef: z.union([nonEmptyTrimmedString, z.literal(null)]).optional(),
    semanticBasis: semanticBasisSchema,
  })
  .superRefine((finding, sink) => {
    if (finding.validity === undefined) {
      sink.addIssue({ code: "custom", message: "discovered_validity_required" });
      return;
    }
    if (finding.semanticRelation === undefined) {
      sink.addIssue({ code: "custom", message: "discovered_relation_required" });
      return;
    }
    if (finding.semanticRelation === "EXISTING" && finding.existingLineageRef == null) {
      sink.addIssue({ code: "custom", message: "discovered_relation_ref_required" });
      return;
    }
    if (finding.semanticRelation === "NEW" && finding.existingLineageRef != null) {
      sink.addIssue({ code: "custom", message: "discovered_relation_ref_forbidden" });
      return;
    }
    if (finding.validity === "VALID" && finding.severity == null) {
      sink.addIssue({ code: "custom", message: "discovered_severity_required" });
      return;
    }
    if (finding.validity === "ADVISORY" && finding.severity !== "minor") {
      sink.addIssue({ code: "custom", message: "discovered_severity_conflict" });
      return;
    }
    if (finding.validity === "INVALID" && finding.severity != null) {
      sink.addIssue({ code: "custom", message: "discovered_severity_forbidden" });
    }
  });

/**
 * SELF_REVIEW_RESULT_CONFLICT: a target lineage reported STILL_PRESENT cannot
 * also surface as an EXISTING discovered finding for the same opaque lineage.
 */
function checkSelfReviewConflict(
  value: {
    targetLineageChecks: readonly { lineageId: string; result: "RESOLVED" | "STILL_PRESENT" | "INDETERMINATE" }[];
    discoveredFindings: readonly {
      semanticRelation?: "EXISTING" | "NEW";
      existingLineageRef?: string | null;
    }[];
  },
  sink: IssueSink,
): void {
  const stillPresent = new Set<string>();
  for (const check of value.targetLineageChecks) {
    if (check.result === "STILL_PRESENT") {
      stillPresent.add(check.lineageId);
    }
  }
  if (stillPresent.size === 0) return;
  for (const finding of value.discoveredFindings) {
    if (
      finding.semanticRelation === "EXISTING" &&
      finding.existingLineageRef != null &&
      stillPresent.has(finding.existingLineageRef)
    ) {
      sink.addIssue({ code: "custom", message: "self_review_result_conflict" });
      return;
    }
  }
}

const selfReviewResultSchema = z
  .strictObject({
    ...envelopeFields,
    targetLineageChecks: selfReviewTargetCheckSchema.array(),
    discoveredFindings: selfReviewDiscoveredFindingSchema.array(),
  })
  .superRefine((value, sink) => {
    checkEnvelopeByKind("self_review", value, sink);
    const seenTargets = new Set<string>();
    for (const check of value.targetLineageChecks) {
      if (seenTargets.has(check.lineageId)) {
        sink.addIssue({ code: "custom", message: "duplicate_target_lineage" });
        return;
      }
      seenTargets.add(check.lineageId);
    }
    const seenDiscovered = new Set<string>();
    for (const finding of value.discoveredFindings) {
      if (seenDiscovered.has(finding.candidateId)) {
        sink.addIssue({ code: "custom", message: "duplicate_discovered_candidate" });
        return;
      }
      seenDiscovered.add(finding.candidateId);
    }
    checkSelfReviewConflict(value, sink);
  })
  .transform((value) =>
    Object.freeze({
      ...envelopeFrom(value),
      targetLineageChecks: Object.freeze(
        value.targetLineageChecks.map((check) => Object.freeze(check)),
      ),
      discoveredFindings: Object.freeze(
        value.discoveredFindings.map((finding) =>
          Object.freeze({
            candidateId: finding.candidateId,
            validity: requireDefined(finding.validity, "discovered_validity_required"),
            severity: finding.severity ?? undefined,
            semanticRelation: requireDefined(
              finding.semanticRelation,
              "discovered_relation_required",
            ),
            existingLineageRef: finding.existingLineageRef ?? undefined,
            semanticBasis: freezeBasis(finding.semanticBasis),
          }),
        ),
      ),
    }),
  );

// -- lineage revalidation ------------------------------------------------------------

const lineageRevalidationResultSchema = z
  .strictObject({
    ...envelopeFields,
    lineageId: nonEmptyTrimmedString,
    result: z.enum(["STILL_PRESENT", "RESOLVED", "INDETERMINATE"]),
  })
  .superRefine((value, sink) => {
    checkEnvelopeByKind("lineage_revalidation", value, sink);
  })
  .transform((value) =>
    Object.freeze({
      ...envelopeFrom(value),
      lineageId: value.lineageId,
      result: value.result,
    }),
  );

// -- cross-generation reconciliation ---------------------------------------------------

const predecessorRefSchema = z.strictObject({
  gateId: nonEmptyTrimmedString,
  lineageId: nonEmptyTrimmedString,
});

const crossGenerationReconciliationResultSchema = z
  .strictObject({
    ...envelopeFields,
    lineageId: nonEmptyTrimmedString,
    verdict: z.enum(["RELATED_PRIOR_GENERATION", "NO_PRIOR_MATCH"]),
    predecessorLineageRef: predecessorRefSchema.optional(),
  })
  .superRefine((value, sink) => {
    checkEnvelopeByKind("cross_generation_reconciliation", value, sink);
    if (
      value.verdict === "RELATED_PRIOR_GENERATION" &&
      value.predecessorLineageRef === undefined
    ) {
      sink.addIssue({ code: "custom", message: "predecessor_ref_required" });
      return;
    }
    if (value.verdict === "NO_PRIOR_MATCH" && value.predecessorLineageRef !== undefined) {
      sink.addIssue({ code: "custom", message: "predecessor_ref_forbidden" });
    }
  })
  .transform((value) =>
    Object.freeze({
      ...envelopeFrom(value),
      lineageId: value.lineageId,
      verdict: value.verdict,
      predecessorLineageRef:
        value.predecessorLineageRef === undefined
          ? undefined
          : Object.freeze({ ...value.predecessorLineageRef }),
    }),
  );

// -- non-convergence reentry -------------------------------------------------------------

const nonConvergenceReentryResultSchema = z
  .strictObject({
    ...envelopeFields,
    outcome: z.enum([
      "MATERIAL_PROGRESS",
      "NO_MATERIAL_PROGRESS",
      "REQUIREMENTS_REOPEN_REQUIRED",
      "DESIGN_REOPEN_REQUIRED",
    ]),
    lineageId: z.union([nonEmptyTrimmedString, z.literal(null)]).optional(),
  })
  .superRefine((value, sink) => {
    checkEnvelopeByKind("non_convergence_reentry", value, sink);
    const reopenOutcome =
      value.outcome === "REQUIREMENTS_REOPEN_REQUIRED" || value.outcome === "DESIGN_REOPEN_REQUIRED";
    if (reopenOutcome && value.lineageId == null) {
      sink.addIssue({ code: "custom", message: "reopen_lineage_ref_required" });
      return;
    }
    if (!reopenOutcome && value.lineageId != null) {
      sink.addIssue({ code: "custom", message: "reopen_lineage_ref_forbidden" });
    }
  })
  .transform((value) =>
    Object.freeze({
      ...envelopeFrom(value),
      outcome: value.outcome,
      lineageId: value.lineageId ?? undefined,
    }),
  );

// -- remediation -------------------------------------------------------------------------

const remediationResultSchema = z
  .strictObject({
    ...envelopeFields,
    targetPath: nonEmptyTrimmedString,
    outcome: z.enum(["COMPLETED", "NO_CHANGE"]),
    summary: nonEmptyTrimmedString,
  })
  .superRefine((value, sink) => {
    checkEnvelopeByKind("remediation", value, sink);
  })
  .transform((value) =>
    Object.freeze({
      ...envelopeFrom(value),
      targetPath: value.targetPath,
      outcome: value.outcome,
      summary: value.summary,
    }),
  );

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export type ReviewCandidatesResultV1 = Readonly<
  EnvelopeValue & {
    readonly candidates: ReadonlyArray<ReviewCandidateObservationV1>;
  }
>;

export type FindingValidationDecisionV1 =
  | "VALID"
  | "INVALID"
  | "DUPLICATE"
  | "ALREADY_RESOLVED"
  | "ADVISORY"
  | "DESIGN_REOPEN_REQUIRED"
  | "REQUIREMENTS_REOPEN_REQUIRED";

export type FindingSemanticRelationV1 = "EXISTING" | "NEW" | "NONE";

export type FindingValidationResultV1 = Readonly<
  EnvelopeValue & {
    readonly candidateId: string;
    readonly decision: FindingValidationDecisionV1;
    readonly severity: "blocking" | "minor" | undefined;
    readonly observedPhase: "requirements" | "design" | "plan";
    readonly semanticBasis: ReviewSemanticBasisV1 | undefined;
    readonly relation: FindingSemanticRelationV1;
    readonly existingLineageRef: string | undefined;
  }
>;

export type SelfReviewTargetCheckV1 = Readonly<{
  readonly lineageId: string;
  readonly result: "RESOLVED" | "STILL_PRESENT" | "INDETERMINATE";
}>;

export type SelfReviewDiscoveredFindingV1 = Readonly<{
  readonly candidateId: string;
  readonly validity: "VALID" | "ADVISORY" | "INVALID";
  readonly severity: "blocking" | "minor" | undefined;
  readonly semanticRelation: "EXISTING" | "NEW";
  readonly existingLineageRef: string | undefined;
  readonly semanticBasis: ReviewSemanticBasisV1;
}>;

export type SelfReviewResultV1 = Readonly<
  EnvelopeValue & {
    readonly targetLineageChecks: ReadonlyArray<SelfReviewTargetCheckV1>;
    readonly discoveredFindings: ReadonlyArray<SelfReviewDiscoveredFindingV1>;
  }
>;

export type LineageRevalidationResultV1 = Readonly<
  EnvelopeValue & {
    readonly lineageId: string;
    readonly result: "STILL_PRESENT" | "RESOLVED" | "INDETERMINATE";
  }
>;

export type CrossGenerationPredecessorRefV1 = Readonly<{
  readonly gateId: string;
  readonly lineageId: string;
}>;

export type CrossGenerationReconciliationResultV1 = Readonly<
  EnvelopeValue & {
    readonly lineageId: string;
    readonly verdict: "RELATED_PRIOR_GENERATION" | "NO_PRIOR_MATCH";
    readonly predecessorLineageRef: CrossGenerationPredecessorRefV1 | undefined;
  }
>;

export type NonConvergenceReentryOutcomeV1 =
  | "MATERIAL_PROGRESS"
  | "NO_MATERIAL_PROGRESS"
  | "REQUIREMENTS_REOPEN_REQUIRED"
  | "DESIGN_REOPEN_REQUIRED";

export type NonConvergenceReentryResultV1 = Readonly<
  EnvelopeValue & {
    readonly outcome: NonConvergenceReentryOutcomeV1;
    /** Set only for reopen outcomes; an opaque already-committed lineage ref. */
    readonly lineageId: string | undefined;
  }
>;

export type RemediationResultV1 = Readonly<
  EnvelopeValue & {
    readonly targetPath: string;
    readonly outcome: "COMPLETED" | "NO_CHANGE";
    readonly summary: string;
  }
>;

export interface ReviewGateOperationResultMap {
  readonly review_candidates: ReviewCandidatesResultV1;
  readonly finding_validation: FindingValidationResultV1;
  readonly self_review: SelfReviewResultV1;
  readonly lineage_revalidation: LineageRevalidationResultV1;
  readonly cross_generation_reconciliation: CrossGenerationReconciliationResultV1;
  readonly non_convergence_reentry: NonConvergenceReentryResultV1;
  readonly remediation: RemediationResultV1;
}

const RESULT_SCHEMAS: {
  [K in keyof ReviewGateOperationResultMap]: z.ZodType<ReviewGateOperationResultMap[K]>;
} = {
  review_candidates: reviewCandidatesResultSchema,
  finding_validation: findingValidationResultSchema,
  self_review: selfReviewResultSchema,
  lineage_revalidation: lineageRevalidationResultSchema,
  cross_generation_reconciliation: crossGenerationReconciliationResultSchema,
  non_convergence_reentry: nonConvergenceReentryResultSchema,
  remediation: remediationResultSchema,
};

// ---------------------------------------------------------------------------
// Parse outcomes
// ---------------------------------------------------------------------------

export type ReviewGateResultParseOutcome<T> =
  | Readonly<{ readonly kind: "accepted"; readonly result: T }>
  | Readonly<{ readonly kind: "malformed"; readonly reason: string }>
  | Readonly<{
      readonly kind: "conflict";
      readonly code: "SELF_REVIEW_RESULT_CONFLICT";
    }>
  | Readonly<{
      readonly kind: "stale";
      readonly field: ReviewGateCorrelationField;
      readonly expected: string;
      readonly received: string | null;
    }>;

/**
 * Strict parse of one worker's raw output for the requested operation kind.
 * Raw output is discarded after strict parsing: the accepted outcome carries
 * only the typed, frozen result. Unknown fields, duplicates, malformed typed
 * semantic bases, and non-JSON wrappers fail closed as `malformed`; known
 * conflict payloads surface as `conflict`; id/phase/attempt/round mismatches
 * against the expectation fail closed as `stale` naming the offending field.
 */
export function parseReviewGateOperationResult<K extends keyof ReviewGateOperationResultMap>(
  kind: K,
  raw: string,
  expected: ReviewGateResultExpectationV1,
): ReviewGateResultParseOutcome<ReviewGateOperationResultMap[K]> {
  const payload = extractOperationResultPayload(raw);
  if (payload === undefined) {
    return Object.freeze({ kind: "malformed", reason: "payload_extraction_failed" });
  }
  const parsed = RESULT_SCHEMAS[kind].safeParse(payload);
  if (!parsed.success) {
    const reason = firstIssueMessage(parsed.error);
    if (kind === "self_review" && reason === "self_review_result_conflict") {
      return Object.freeze({ kind: "conflict", code: "SELF_REVIEW_RESULT_CONFLICT" });
    }
    return Object.freeze({ kind: "malformed", reason });
  }
  const result = parsed.data;
  const stale = correlateEnvelope(
    {
      operationId: result.operationId,
      gateId: result.gateId,
      phase: result.phase,
      reviewAttemptId: result.reviewAttemptId,
      remediationRound: result.remediationRound,
    },
    expected,
  );
  if (stale !== null) {
    return Object.freeze(stale);
  }
  return Object.freeze({ kind: "accepted", result });
}

// ---------------------------------------------------------------------------
// Raw-output extraction and correlation helpers
// ---------------------------------------------------------------------------

/**
 * Raw output contract: a bare JSON object, or the known OmO synchronous task
 * completion wrapper (`…\n---\n\n<json>\n\n<task_metadata>…`), matching the
 * legacy extraction for consistency. Anything else fails closed.
 */
function extractOperationResultPayload(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return parseJsonObject(trimmed);
  }
  const separator = "\n---\n\n";
  const separatorIndex = trimmed.indexOf(separator);
  if (separatorIndex < 0) return undefined;
  const metadataStart = trimmed.lastIndexOf("\n\n<task_metadata>");
  if (metadataStart < 0 || metadataStart <= separatorIndex + separator.length) return undefined;
  const payload = trimmed.slice(separatorIndex + separator.length, metadataStart).trim();
  if (!payload.startsWith("{") || !payload.endsWith("}")) return undefined;
  return parseJsonObject(payload);
}

function parseJsonObject(payload: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compares the parsed result envelope against the expectation. Every provided
 * expectation field must match exactly; any mismatch yields a `stale` outcome
 * naming the offending correlation field.
 */
function correlateEnvelope(
  received: {
    readonly operationId: string;
    readonly gateId: string;
    readonly phase: ReviewGatePhase;
    readonly reviewAttemptId: string | null;
    readonly remediationRound: RemediationRound | null;
  },
  expected: ReviewGateResultExpectationV1,
): Readonly<{
  kind: "stale";
  field: ReviewGateCorrelationField;
  expected: string;
  received: string | null;
}> | null {
    if (received.operationId !== expected.operationId) {
      return {
        kind: "stale",
        field: "operationId",
        expected: expected.operationId,
        received: received.operationId,
      };
    }
    if (received.gateId !== expected.gateId) {
      return {
        kind: "stale",
        field: "gateId",
        expected: expected.gateId,
        received: received.gateId,
      };
    }
    if (received.phase !== expected.phase) {
      return {
        kind: "stale",
        field: "phase",
        expected: expected.phase,
        received: received.phase,
      };
    }
    if (
      expected.reviewAttemptId !== undefined &&
      received.reviewAttemptId !== expected.reviewAttemptId
    ) {
      return {
        kind: "stale",
        field: "reviewAttemptId",
        expected: expected.reviewAttemptId,
        received: received.reviewAttemptId,
      };
    }
    if (
      expected.remediationRound !== undefined &&
      !matchesRound(received.remediationRound, expected.remediationRound)
    ) {
      return {
        kind: "stale",
        field: "remediationRound",
        expected: formatRound(expected.remediationRound),
        received:
          received.remediationRound === null ? null : formatRound(received.remediationRound),
      };
    }
    return null;
}

function matchesRound(
  received: RemediationRound | null,
  expected: RemediationRound,
): boolean {
  return (
    received !== null &&
    received.phase === expected.phase &&
    received.ordinal === expected.ordinal
  );
}

function formatRound(round: RemediationRound): string {
  return `${round.phase}:${String(round.ordinal)}`;
}

function firstIssueMessage(error: unknown): string {
  const issues = (error as { issues?: ReadonlyArray<{ message?: string }> } | undefined)?.issues;
  const message = issues?.[0]?.message;
  return typeof message === "string" ? message : "schema_violation";
}
