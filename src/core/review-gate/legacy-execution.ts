import type { ReviewArtifactFindingV1 } from "../types";
import { deriveResumeCursor } from "./resume-cursor.js";
import type {
  RequirementsResolutionV1,
  ReviewApprovalBindingV1,
} from "../review-gate-types.js";
import type { ReviewGateProjection, ReviewGateResumeCursor } from "./types.js";

export const REVIEW_GATE_EXECUTION_MARKER = "[JUSTICE: PLAN REVIEW GATE EXECUTION]";
export const REVIEW_GATE_REMEDIATION_MARKER = "[JUSTICE: PLAN REVIEW GATE REMEDIATION]";
export const REVIEW_GATE_WORKER_AGENT = "justice-review-worker";

export type ReviewGateWorkerPrompt =
  | {
      readonly role: "review";
      readonly gateId: string;
      readonly round: number;
      readonly retryBudget: number;
    }
  | {
      readonly role: "remediation";
      readonly gateId: string;
      readonly round: number;
      readonly retryBudget: number;
    };

export interface ReviewGateWorkerResult {
  readonly schemaVersion: 1;
  readonly gateId: string;
  readonly complete: boolean;
  readonly findings: readonly ReviewArtifactFindingV1[];
}

export interface ReviewGateRemediationResult {
  readonly schemaVersion: 1;
  readonly gateId: string;
  readonly round: number;
  readonly complete: true;
  readonly summary: string;
}

export type ReviewGateRemediationValidation =
  | { readonly kind: "malformed" }
  | {
      readonly kind: "stale_gate";
      readonly expectedGateId: string;
      readonly receivedGateId: string;
    }
  | {
      readonly kind: "stale_round";
      readonly expectedRound: number;
      readonly receivedRound: number;
    }
  | { readonly kind: "accepted"; readonly result: ReviewGateRemediationResult };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFinding(value: unknown): value is ReviewArtifactFindingV1 {
  if (!isRecord(value)) return false;
  return (
    typeof value.itemKey === "string" &&
    value.itemKey.length > 0 &&
    (value.severity === "critical" || value.severity === "major" || value.severity === "minor") &&
    typeof value.summary === "string" &&
    value.summary.length > 0 &&
    typeof value.location === "string" &&
    value.location.length > 0
  );
}

function extractKnownReviewPayload(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const separator = "\n---\n\n";
  const separatorIndex = trimmed.indexOf(separator);
  if (separatorIndex < 0) return undefined;

  const metadataStart = trimmed.lastIndexOf("\n\n<task_metadata>");
  if (metadataStart < 0 || metadataStart <= separatorIndex + separator.length) return undefined;

  const payload = trimmed.slice(separatorIndex + separator.length, metadataStart).trim();
  if (!payload.startsWith("{") || !payload.endsWith("}")) return undefined;
  return payload;
}

export function parseReviewGateWorkerResult(raw: string): ReviewGateWorkerResult | undefined {
  const parsed = parseKnownReviewRecord(raw);
  if (parsed === undefined) return undefined;
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.gateId !== "string" ||
    parsed.gateId.length === 0 ||
    typeof parsed.complete !== "boolean" ||
    !Array.isArray(parsed.findings) ||
    !parsed.findings.every(isFinding)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    gateId: parsed.gateId,
    complete: parsed.complete,
    findings: Object.freeze(parsed.findings.map((finding) => Object.freeze({ ...finding }))),
  };
}

export function parseReviewGateRemediationResult(
  raw: string,
): ReviewGateRemediationResult | undefined {
  const parsed = parseKnownReviewRecord(raw);
  if (
    parsed === undefined ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.gateId !== "string" ||
    parsed.gateId.length === 0 ||
    typeof parsed.round !== "number" ||
    !Number.isSafeInteger(parsed.round) ||
    parsed.round < 1 ||
    parsed.complete !== true ||
    typeof parsed.summary !== "string" ||
    parsed.summary.trim().length === 0
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: 1,
    gateId: parsed.gateId,
    round: parsed.round,
    complete: true,
    summary: parsed.summary,
  });
}

export function validateReviewGateRemediationResult(
  raw: string,
  expected: { readonly gateId: string; readonly round: number },
): ReviewGateRemediationValidation {
  const result = parseReviewGateRemediationResult(raw);
  if (result === undefined) return Object.freeze({ kind: "malformed" });
  if (result.gateId !== expected.gateId) {
    return Object.freeze({
      kind: "stale_gate",
      expectedGateId: expected.gateId,
      receivedGateId: result.gateId,
    });
  }
  if (result.round !== expected.round) {
    return Object.freeze({
      kind: "stale_round",
      expectedRound: expected.round,
      receivedRound: result.round,
    });
  }
  return Object.freeze({ kind: "accepted", result });
}

export function extractReviewGateWorkerPrompt(prompt: unknown): ReviewGateWorkerPrompt | undefined {
  if (typeof prompt !== "string") return undefined;
  const lines = prompt.split("\n");
  const marker = lines.at(0);
  let role: ReviewGateWorkerPrompt["role"];
  switch (marker) {
    case REVIEW_GATE_EXECUTION_MARKER:
      role = "review";
      break;
    case REVIEW_GATE_REMEDIATION_MARKER:
      role = "remediation";
      break;
    default:
      return undefined;
  }

  const gateIdLine = lines.at(1);
  const roundLine = lines.at(2);
  const retryBudgetLine = lines.at(3);
  if (gateIdLine === undefined || roundLine === undefined || retryBudgetLine === undefined) {
    return undefined;
  }
  const gateId = gateIdLine.startsWith("Gate-ID: ") ? gateIdLine.slice("Gate-ID: ".length) : "";
  const roundValue = roundLine.startsWith("Review-Round: ")
    ? Number(roundLine.slice("Review-Round: ".length))
    : Number.NaN;
  const retryBudgetValue = retryBudgetLine.startsWith("Retry-Budget: ")
    ? retryBudgetLine.slice("Retry-Budget: ".length)
    : "";
  const retryBudget = /^\d+$/u.test(retryBudgetValue) ? Number(retryBudgetValue) : Number.NaN;
  if (
    !/^[A-Za-z0-9-]+$/u.test(gateId) ||
    !Number.isSafeInteger(roundValue) ||
    roundValue < 1 ||
    !Number.isSafeInteger(retryBudget) ||
    retryBudget < 0
  ) {
    return undefined;
  }
  return Object.freeze({ role, gateId, round: roundValue, retryBudget });
}

function parseKnownReviewRecord(raw: string): Record<string, unknown> | undefined {
  const payload = extractKnownReviewPayload(raw);
  if (payload === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(payload);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function extractReviewGateIdFromTaskPrompt(prompt: unknown): string | undefined {
  if (typeof prompt !== "string") return undefined;
  if (!prompt.startsWith(REVIEW_GATE_EXECUTION_MARKER)) return undefined;
  const match = prompt.match(/^\[JUSTICE: PLAN REVIEW GATE EXECUTION\]\nGate-ID: ([A-Za-z0-9-]+)$/m);
  return match?.[1];
}

/** Evidence already authenticated independently, before legacy migration. */
export type LegacyRecoveryObjectRef = Readonly<{
  readonly refKind: "requirements_authority" | "prepared_commit" | "prepared_restore" | "inherited_clear";
  readonly refId: string;
  readonly storeDigest: string;
  readonly canonicalPath?: string;
  readonly gitBlobOid?: string;
  readonly commitOid?: string;
  readonly disposition?: "committed" | "rolled_back";
  readonly phase?: "design" | "plan";
  readonly roundOrdinal?: number;
  readonly lineageIds?: readonly string[];
  readonly predecessorGateId?: string;
}>;

export type LegacyGateSnapshot = Readonly<{
  readonly gateId: string;
  readonly eventsBytes: Uint8Array | readonly number[];
  readonly dispatchesBytes: Uint8Array | readonly number[] | null;
  readonly recoveryObjectRefs: readonly LegacyRecoveryObjectRef[];
  /** Supplied by an independent trusted reader; never constructed by this bridge. */
  readonly trustedFrontier: Readonly<{
    readonly eventsDigest: string;
    readonly dispatchesDigest: string;
    readonly recoveryRefsDigest: string;
    readonly scopeGitDigest: string;
    readonly generationOrdinal: number;
    readonly observedAt: string;
  }> | null;
  readonly scopeIdentity: Readonly<{
    readonly reviewScopeId: string;
    readonly canonicalDesignPath: string;
    readonly canonicalPlanPath: string;
  }>;
  readonly gitIdentity: Readonly<{
    readonly workspaceIdentity: string;
    readonly designGitMode: "100644" | "100755";
    readonly planGitMode: "100644" | "100755";
  }>;
}>;

export type VerifiedLegacyGate = Readonly<{
  readonly snapshot: LegacyGateSnapshot;
  readonly bridgeDigest: string;
  readonly verifiedEventsDigest: string;
  readonly finalEpochId: string;
  readonly writerId: string;
  readonly epochCounters: Readonly<{
    readonly generationOrdinal: number;
    readonly epochCount: number;
    readonly designRoundCount: number;
    readonly planRoundCount: number;
  }>;
  readonly requirementsResolution: RequirementsResolutionV1;
  readonly commitBinding: ReviewApprovalBindingV1 | null;
  readonly commitResolutionBindings: readonly LegacyRecoveryObjectRef[];
  readonly resumeCursor: ReviewGateResumeCursor;
  readonly historicalInheritedClears: readonly Readonly<{
    readonly eventType: "DESIGN_CLEAR_INHERITED";
    readonly epochId: string;
    readonly emittedAt: string;
  }>[];
}>;

export type LegacyVerificationResult =
  | Readonly<{ readonly kind: "VERIFIED"; readonly value: VerifiedLegacyGate }>
  | Readonly<{ readonly kind: "BLOCK"; readonly reason: string }>;

/** No historical inherited CLEAR is supplied to this projection. */
export function deriveLegacyResumeCursor(projection: ReviewGateProjection): ReviewGateResumeCursor {
  return deriveResumeCursor(projection);
}

export function encodeLegacyBridgeMarkerReason(
  kind: "prepared" | "committed",
  bridgeDigest: string,
): string {
  return `LEGACY_BRIDGE:${kind === "prepared" ? "PREPARED" : "COMMITTED"}:${bridgeDigest}`;
}

export function decodeLegacyBridgeMarkerReason(reason: string): Readonly<{
  readonly kind: "prepared" | "committed";
  readonly bridgeDigest: string;
}> | undefined {
  const match = /^LEGACY_BRIDGE:(PREPARED|COMMITTED):([a-f0-9]{64})$/u.exec(reason);
  if (match?.[2] === undefined) return undefined;
  return Object.freeze({
    kind: match[1] === "PREPARED" ? "prepared" : "committed",
    bridgeDigest: match[2],
  });
}
