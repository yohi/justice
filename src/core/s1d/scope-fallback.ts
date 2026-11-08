import { createHash } from "node:crypto";
import type { LoaderResult, SelectedArtifactRef } from "../s1a/contract.js";
import { inspectBaseline } from "../s1b/baseline.js";
import type { ScopeFallback } from "./contract.js";
import { inspectChangeSet, compareCandidatePaths } from "../s1c/path-rules.js";
import { extractTaskScopePolicy } from "../s1c/policy.js";

function selectedPlanAndTask(refs: readonly SelectedArtifactRef[]): Readonly<{
  plan: SelectedArtifactRef;
  task: SelectedArtifactRef;
}> | null {
  const plans = refs.filter((ref) => ref.kind === "plan");
  const tasks = refs.filter((ref) => ref.kind === "task");
  const plan = plans[0];
  const task = tasks[0];
  return plans.length === 1 && tasks.length === 1 && plan !== undefined && task !== undefined
    ? { plan, task }
    : null;
}

/** Computes candidate scope only when existing S1-a/S1-c prerequisites permit it. */
export function computeScopeFallback(
  baseline: LoaderResult,
  planBytes: Uint8Array | null,
  parsedChangeSet: unknown,
): ScopeFallback {
  const baselineInspection = inspectBaseline(baseline);
  if (baselineInspection.state !== "READY") {
    return { state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" };
  }

  const changes = inspectChangeSet(parsedChangeSet);
  if (changes.state === "INVALID") return { state: "NOT_EVALUATED", reason: "CHANGESET_INVALID" };
  if (changes.state === "UNAVAILABLE") return { state: "NOT_EVALUATED", reason: "CHANGESET_UNAVAILABLE" };

  const selected = selectedPlanAndTask(baseline.selectedRefs);
  if (planBytes === null || selected === null) {
    return { state: "NOT_EVALUATED", reason: "PLAN_SNAPSHOT_UNAVAILABLE" };
  }
  const digest = createHash("sha256").update(planBytes).digest("hex");
  if (
    digest !== selected.plan.expectedDigest ||
    digest !== selected.plan.observedDigest ||
    selected.plan.digestOutcome !== "MATCH"
  ) return { state: "NOT_EVALUATED", reason: "PLAN_SNAPSHOT_UNAVAILABLE" };

  const policy = extractTaskScopePolicy(planBytes, selected);
  switch (policy.state) {
    case "UNDEFINED": return { state: "NOT_EVALUATED", reason: "SCOPE_POLICY_UNDEFINED" };
    case "INVALID": return { state: "NOT_EVALUATED", reason: "SCOPE_POLICY_INVALID" };
    case "REFERENCE_MISMATCH": return { state: "NOT_EVALUATED", reason: "SCOPE_POLICY_REFERENCE_MISMATCH" };
    case "READY": break;
  }

  const comparison = compareCandidatePaths(policy.policy.allowedPaths, changes.touchedPaths);
  return {
    state: "EVALUATED",
    provenance: "S1C_EXISTING_SCOPE_PRIMITIVES",
    candidateScopeComparison: comparison.comparison,
    outsidePaths: comparison.outsidePaths,
    formalVerdictAvailable: false,
    limitation: "NO_FORMAL_S1C_RESULT",
  };
}
