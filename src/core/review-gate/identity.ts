import { createHash } from "node:crypto";
import type { ArtifactDigest, ReviewScopeId } from "./types.js";

export function canonicalizeArtifactPath(rawPath: string): string | null {
  if (
    rawPath.length === 0 ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("./") ||
    rawPath.includes("..") ||
    rawPath.includes("\\") ||
    rawPath.includes("\0") ||
    rawPath.includes("/./")
  ) {
    return null;
  }

  const components = rawPath.split("/");
  if (components.at(-1) === "") return null;

  return components.filter((component) => component.length > 0).join("/");
}

export function isValidArtifactPath(path: string): boolean {
  return canonicalizeArtifactPath(path) !== null;
}

export function computeReviewScopeId(designPath: string, planPath: string): ReviewScopeId {
  const canonicalDesignPath = canonicalizeArtifactPath(designPath);
  const canonicalPlanPath = canonicalizeArtifactPath(planPath);
  if (canonicalDesignPath === null || canonicalPlanPath === null) {
    throw new Error("review_gate_invalid_artifact_path");
  }

  return createHash("sha256")
    .update(`justice-review-scope-v1\0${canonicalDesignPath}\0${canonicalPlanPath}`)
    .digest("hex") as ReviewScopeId;
}

export function computeArtifactDigest(bytes: Uint8Array): ArtifactDigest {
  return createHash("sha256").update(bytes).digest("hex") as ArtifactDigest;
}

const textEncoder = new TextEncoder();

/**
 * Canonical JSON text: object keys are sorted lexicographically, array order is
 * preserved, and values outside JSON (undefined, functions, symbols, bigints,
 * Date/Map/Set/RegExp, typed arrays, holes in arrays, non-finite numbers) are
 * rejected so equal data always encodes to equal text.
 */
function canonicalJsonText(value: unknown): string {
  if (value === undefined) throw new Error("review_gate_canonical_json_unsupported_value");
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("review_gate_canonical_json_non_finite_number");
      }
      return JSON.stringify(value);
    case "object":
      return canonicalJsonContents(value);
    default:
      throw new Error("review_gate_canonical_json_unsupported_value");
  }
}

function canonicalJsonContents(value: object): string {
  if (Array.isArray(value)) {
    const items = value as ReadonlyArray<unknown>;
    const entries: string[] = [];
    for (const item of items) {
      // Sparse-array holes surface here as undefined and are rejected.
      entries.push(canonicalJsonText(item));
    }
    return `[${entries.join(",")}]`;
  }
  if (
    value instanceof Date ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof RegExp ||
    ArrayBuffer.isView(value)
  ) {
    throw new Error("review_gate_canonical_json_unsupported_value");
  }
  const contents = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJsonText(member)}`);
  return `{${contents.join(",")}}`;
}

/**
 * SHA-256 fingerprint of a value's canonical JSON encoding. Key order never
 * affects the fingerprint, so it is stable across object-literal reordering.
 */
export function computeCanonicalJsonFingerprint(value: unknown): string {
  return computeArtifactDigest(textEncoder.encode(canonicalJsonText(value)));
}
