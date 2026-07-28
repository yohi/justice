import type { ReviewResolutionArtifact } from "./types";

const MAX_REVIEW_RESOLUTION_IDENTIFIER_LENGTH = 256;
const MAX_REVIEW_RESOLUTION_ITEM_KEYS = 256;
const SAFE_REVIEW_RESOLUTION_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

type ReviewResolutionArtifactFields = Pick<
  ReviewResolutionArtifact,
  "reviewScope" | "itemKeys" | "artifactRef"
>;

export function parseReviewResolutionArtifact(
  value: unknown,
): ReviewResolutionArtifact | undefined {
  if (!isRecord(value)) return undefined;

  const reviewScope = readString(value, "reviewScope");
  const artifactRef = readString(value, "artifactRef");
  const itemKeys = readStringArray(value, "itemKeys");
  if (readString(value, "authority") !== "human_approved" || itemKeys === undefined) {
    return undefined;
  }

  return normalizeReviewResolutionArtifact({ reviewScope, itemKeys, artifactRef });
}

export function normalizeReviewResolutionArtifact(
  value: ReviewResolutionArtifactFields,
): ReviewResolutionArtifact | undefined {
  const reviewScope = normalizeIdentifier(value.reviewScope);
  const artifactRef = normalizeIdentifier(value.artifactRef);
  const itemKeys = normalizeIdentifiers(value.itemKeys);
  if (reviewScope === undefined || artifactRef === undefined || itemKeys === undefined) {
    return undefined;
  }

  return {
    authority: "human_approved",
    reviewScope,
    itemKeys,
    artifactRef,
  };
}

function normalizeIdentifier(value: string): string | undefined {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_REVIEW_RESOLUTION_IDENTIFIER_LENGTH ||
    !SAFE_REVIEW_RESOLUTION_IDENTIFIER_PATTERN.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeIdentifiers(values: readonly string[]): readonly string[] | undefined {
  if (values.length === 0 || values.length > MAX_REVIEW_RESOLUTION_ITEM_KEYS) return undefined;

  const normalized: string[] = [];
  const identifiers = new Set<string>();
  for (const value of values) {
    const identifier = normalizeIdentifier(value);
    if (identifier === undefined || identifiers.has(identifier)) return undefined;
    identifiers.add(identifier);
    normalized.push(identifier);
  }
  return Object.freeze(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string {
  // eslint-disable-next-line security/detect-object-injection
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  // eslint-disable-next-line security/detect-object-injection
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined;
  }
  return value;
}
