import type { ReviewArtifactFindingV1 } from "./types";

export const REVIEW_GATE_EXECUTION_MARKER = "[JUSTICE: PLAN REVIEW GATE EXECUTION]";

export interface ReviewGateWorkerResult {
  readonly schemaVersion: 1;
  readonly gateId: string;
  readonly reviewScope: readonly [string, string];
  readonly complete: boolean;
  readonly findings: readonly ReviewArtifactFindingV1[];
}

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

export function parseReviewGateWorkerResult(raw: string): ReviewGateWorkerResult | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.gateId !== "string" ||
    parsed.gateId.length === 0 ||
    !Array.isArray(parsed.reviewScope) ||
    parsed.reviewScope.length !== 2 ||
    !parsed.reviewScope.every((entry) => typeof entry === "string" && entry.length > 0) ||
    typeof parsed.complete !== "boolean" ||
    !Array.isArray(parsed.findings) ||
    !parsed.findings.every(isFinding)
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    gateId: parsed.gateId,
    reviewScope: Object.freeze([...parsed.reviewScope]) as readonly [string, string],
    complete: parsed.complete,
    findings: Object.freeze(parsed.findings.map((finding) => Object.freeze({ ...finding }))),
  };
}

export function extractReviewGateIdFromTaskPrompt(prompt: unknown): string | undefined {
  if (typeof prompt !== "string") return undefined;
  if (!prompt.startsWith(REVIEW_GATE_EXECUTION_MARKER)) return undefined;
  const match = prompt.match(/^\[JUSTICE: PLAN REVIEW GATE EXECUTION\]\nGate-ID: ([A-Za-z0-9-]+)$/m);
  return match?.[1];
}
