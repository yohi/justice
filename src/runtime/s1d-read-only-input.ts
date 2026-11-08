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
  let planBytes: Uint8Array | null = null;
  let planRoot: string | null = null;
  let planPath: string | null = null;

  const wrapped: S1aReadOnlySource = {
    async readInputFile(path, maxBytes) {
      const bytes = await source.readInputFile(path, maxBytes);
      if (path === input.manifestPath && maxBytes === S1A_LIMITS.manifestBytes) {
        manifestBytes = bytes.slice();
        try {
          const plans = parseOwnerManifest(manifestBytes).artifacts.filter((ref) => ref.kind === "plan");
          if (plans.length === 1) {
            planRoot = input.artifactsRoot;
            planPath = plans[0]?.relativePath ?? null;
          }
        } catch {
          planRoot = null;
          planPath = null;
        }
      }
      return bytes;
    },
    async readArtifact(root, relativePath, maxBytes) {
      const bytes = await source.readArtifact(root, relativePath, maxBytes);
      if (planRoot === root && planPath === relativePath) planBytes = bytes.slice();
      return bytes;
    },
  };

  return Object.freeze({
    source: wrapped,
    getPlanSnapshot(result: LoaderResult): Uint8Array | null {
      if (result.manifestDigestMatch !== true || manifestBytes === null || planBytes === null || planRoot !== input.artifactsRoot || planPath === null) return null;
      let manifest;
      try {
        manifest = parseOwnerManifest(manifestBytes);
      } catch {
        return null;
      }
      const planRefs = manifest.artifacts.filter((ref) => ref.kind === "plan");
      const selectedPlans = result.selectedRefs.filter((ref) => ref.kind === "plan");
      if (planRefs.length !== 1 || selectedPlans.length !== 1) return null;
      const manifestPlan = planRefs[0];
      const selectedPlan = selectedPlans[0];
      if (manifestPlan === undefined || selectedPlan === undefined || manifestPlan.artifactId !== selectedPlan.artifactId || manifestPlan.relativePath !== planPath) return null;
      return planBytes.slice();
    },
  });
}
