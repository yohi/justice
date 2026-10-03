import type { ReviewArtifactFindingV1 } from "./types";

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
