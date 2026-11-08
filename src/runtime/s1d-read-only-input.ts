import { S1A_LIMITS, type LoaderInput, type LoaderResult, type S1aReadOnlySource } from "../core/s1a/contract.js";
import { parseOwnerManifest } from "../core/s1a/manifest.js";
import { parseStrictJson } from "../core/s1a/strict-json.js";
import type { InputIssue } from "../core/s1d/contract.js";

type JsonRead =
  | Readonly<{ state: "PARSED"; value: unknown }>
  | Readonly<{ state: "LEVEL_A_ERROR"; issue: InputIssue }>;

const inputLimit = (kind: "evidence" | "changeset"): number => {
  switch (kind) {
    case "evidence": return 1_048_576;
    case "changeset": return 262_144;
    default: return assertNever(kind);
  }
};

function assertNever(value: never): never {
  throw new Error(`Unexpected input kind: ${String(value)}`);
}

export async function readS1dJsonInput(
  source: S1aReadOnlySource,
  path: string,
  kind: "evidence" | "changeset",
): Promise<JsonRead> {
  const limit = inputLimit(kind);
  let bytes: Uint8Array;
  try {
    bytes = await source.readInputFile(path, limit);
  } catch (error) {
    if (typeof error === "object" && error !== null && "kind" in error && error.kind === "over_limit") {
      return { state: "LEVEL_A_ERROR", issue: { source: kind, code: "INPUT_TOO_LARGE" } };
    }
    return { state: "LEVEL_A_ERROR", issue: { source: kind, code: "INPUT_READ_FAILED" } };
  }
  if (bytes.byteLength > limit) return { state: "LEVEL_A_ERROR", issue: { source: kind, code: "INPUT_TOO_LARGE" } };
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return { state: "LEVEL_A_ERROR", issue: { source: kind, code: "INPUT_UTF8_INVALID" } };
  }
  try {
    return { state: "PARSED", value: parseStrictJson(bytes, limit) };
  } catch {
    return { state: "LEVEL_A_ERROR", issue: { source: kind, code: "INPUT_JSON_INVALID" } };
  }
}

export function createCapturedS1aSource(
  source: S1aReadOnlySource,
  input: LoaderInput,
): Readonly<{ source: S1aReadOnlySource; getPlanSnapshot(result: LoaderResult): Uint8Array | null }> {
  let manifestBytes: Uint8Array | null = null;
  let planPaths = new Map<string, string>();
  const capturedPlans = new Map<string, Uint8Array>();
  let capturedRoot: string | null = null;

  const wrapped: S1aReadOnlySource = {
    async readInputFile(path, maxBytes) {
      const bytes = await source.readInputFile(path, maxBytes);
      if (path === input.manifestPath && maxBytes === S1A_LIMITS.manifestBytes) {
        manifestBytes = Uint8Array.from(bytes);
        try {
          const plans = parseOwnerManifest(manifestBytes).artifacts.filter((ref) => ref.kind === "plan");
          planPaths = new Map(plans.map((ref) => [ref.relativePath, ref.artifactId]));
          capturedRoot = input.artifactsRoot;
        } catch {
          planPaths = new Map();
          capturedRoot = null;
        }
      }
      return bytes;
    },
    async readArtifact(root, relativePath, maxBytes) {
      const bytes = await source.readArtifact(root, relativePath, maxBytes);
      const artifactId = planPaths.get(relativePath);
      if (capturedRoot === root && artifactId !== undefined) {
        if (bytes.byteLength > Math.min(maxBytes, S1A_LIMITS.artifactBytes)) {
          throw Object.assign(new Error("over_limit"), { kind: "over_limit" });
        }
        capturedPlans.set(artifactId, Uint8Array.from(bytes));
      }
      return bytes;
    },
  };

  return Object.freeze({
    source: wrapped,
    getPlanSnapshot(result: LoaderResult): Uint8Array | null {
      if (result.manifestDigestMatch !== true || manifestBytes === null || capturedRoot !== input.artifactsRoot) return null;
      let manifest;
      try {
        manifest = parseOwnerManifest(manifestBytes);
      } catch {
        return null;
      }
      const selectedPlans = result.selectedRefs.filter((ref) => ref.kind === "plan");
      if (selectedPlans.length !== 1) return null;
      const selectedPlan = selectedPlans[0];
      if (selectedPlan === undefined) return null;
      const manifestPlans = manifest.artifacts.filter((ref) => ref.kind === "plan" && ref.artifactId === selectedPlan.artifactId);
      if (manifestPlans.length !== 1) return null;
      const captured = capturedPlans.get(selectedPlan.artifactId);
      return captured === undefined ? null : Uint8Array.from(captured);
    },
  });
}
