import { afterEach, describe, expect, it, vi } from "vitest";
import type { LoaderResult } from "../../../src/core/s1a/contract.js";
import { loadS1aArtifacts } from "../../../src/core/s1a/loader.js";
import * as pathRules from "../../../src/core/s1c/path-rules.js";
import { computeScopeFallback } from "../../../src/core/s1d/scope-fallback.js";
import { jsonBytes, s1aFixture, sha256 } from "../../helpers/s1a-fixtures.js";

const planText = [
  "## Justice S1-c Task Scope Policies",
  "<!-- justice:s1c-task-scope:begin -->",
  JSON.stringify({ schemaVersion: "justice-s1c-task-scope-v1", planRef: { artifactId: "plan-1", revision: "R1" }, taskRef: { artifactId: "task-1", revision: "R1" }, scopeKey: "scope-1", allowedPaths: ["src/**"] }),
  "<!-- justice:s1c-task-scope:end -->",
].join("\n");

async function fixture(
  plan = new TextEncoder().encode(planText),
  expectedPlan = plan,
): Promise<{
  readonly baseline: LoaderResult;
  readonly plan: Uint8Array;
  readonly changeSet: unknown;
}> {
  const base = s1aFixture();
  const manifest = {
    ...base.manifest,
    artifacts: base.manifest.artifacts.map((ref) => ref.artifactId === "plan-1"
      ? { ...ref, digest: { algorithm: "sha256" as const, hex: sha256(expectedPlan) } }
      : ref),
  };
  const source = {
    async readInputFile(path: string): Promise<Uint8Array> {
      return path === "manifest" ? jsonBytes(manifest) : jsonBytes(base.intent);
    },
    async readArtifact(_root: string, path: string): Promise<Uint8Array> {
      return path === "plan-1.md" ? plan : new Map(Object.entries(base.files)).get(path) ?? new Uint8Array();
    },
  };
  const baseline = await loadS1aArtifacts(
    { ...base.input, expectedManifestSha256: sha256(jsonBytes(manifest)) },
    source,
  );
  return { baseline, plan, changeSet: { availability: "PRESENT", changes: [
    { kind: "ADD", path: "src/a.ts" },
    { kind: "MODIFY", path: "docs/outside.md" },
  ] } };
}

describe("computeScopeFallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("readyCandidateReturnsScopeOnly", async () => {
    const { baseline, plan, changeSet } = await fixture();
    const result = computeScopeFallback(baseline, plan, changeSet);
    expect(result).toEqual({
      state: "EVALUATED",
      provenance: "S1C_EXISTING_SCOPE_PRIMITIVES",
      candidateScopeComparison: "OUTSIDE_CANDIDATE_SCOPE",
      outsidePaths: ["docs/outside.md"],
      formalVerdictAvailable: false,
      limitation: "NO_FORMAL_S1C_RESULT",
    });
  });

  it("nonreadyBaselineShortCircuitsBeforePathComparison", async () => {
    const { baseline } = await fixture();
    const compareSpy = vi.spyOn(pathRules, "compareCandidatePaths");
    const notReady = { ...baseline, identityStatus: "MISMATCH" as const, identityCandidateReady: false,
      checks: baseline.checks.map((check) => check.outcome === "MATCH"
        ? { ...check, outcome: "MISMATCH" as const, category: "OBSERVED_CONTRADICTION" as const }
        : check) };
    expect(computeScopeFallback(notReady, new TextEncoder().encode("safely captured"), {
      availability: "PRESENT", changes: [],
    })).toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
    const malformed: LoaderResult = { ...baseline, identityStatus: "MISMATCH" };
    expect(computeScopeFallback(malformed, null, { availability: "PRESENT", changes: [] }))
      .toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it("invalidAndUnavailableChangeSetDoNotCompare", async () => {
    const { baseline, plan } = await fixture();
    expect(computeScopeFallback(baseline, plan, { availability: "PRESENT", changes: [null] }))
      .toEqual({ state: "NOT_EVALUATED", reason: "CHANGESET_INVALID" });
    expect(computeScopeFallback(baseline, plan, { availability: "UNAVAILABLE" }))
      .toEqual({ state: "NOT_EVALUATED", reason: "CHANGESET_UNAVAILABLE" });
  });

  it("missingOrDigestMismatchedSnapshotIsNotEvaluated", async () => {
    const { baseline, plan, changeSet } = await fixture();
    expect(computeScopeFallback(baseline, null, changeSet))
      .toEqual({ state: "NOT_EVALUATED", reason: "PLAN_SNAPSHOT_UNAVAILABLE" });
    const changed = new TextEncoder().encode("different bytes");
    expect(sha256(changed)).not.toBe(sha256(plan));
    expect(computeScopeFallback(baseline, changed, changeSet))
      .toEqual({ state: "NOT_EVALUATED", reason: "PLAN_SNAPSHOT_UNAVAILABLE" });
    const capturedPlan = new TextEncoder().encode(planText);
    const expectedPlan = new TextEncoder().encode("different approved Plan bytes");
    const mismatched = await fixture(capturedPlan, expectedPlan);
    const compareSpy = vi.spyOn(pathRules, "compareCandidatePaths");
    expect(mismatched.baseline.selectedRefs.find((ref) => ref.kind === "plan")?.digestOutcome)
      .toBe("MISMATCH");
    expect(computeScopeFallback(mismatched.baseline, capturedPlan, mismatched.changeSet))
      .toEqual({ state: "NOT_EVALUATED", reason: "PREREQUISITE_UNAVAILABLE" });
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it("policyNotReadyMapsExistingReasons", async () => {
    const base = await fixture();
    const noPolicy = new TextEncoder().encode("ordinary plan");
    const undefinedBaseline = (await fixture(noPolicy)).baseline;
    expect(computeScopeFallback(undefinedBaseline, noPolicy, base.changeSet))
      .toEqual({ state: "NOT_EVALUATED", reason: "SCOPE_POLICY_UNDEFINED" });
    const invalidBytes = new TextEncoder().encode([
      "## Justice S1-c Task Scope Policies",
      "<!-- justice:s1c-task-scope:begin -->", "{}",
      "<!-- justice:s1c-task-scope:end -->",
    ].join("\n"));
    const invalidBaseline = (await fixture(invalidBytes)).baseline;
    expect(computeScopeFallback(invalidBaseline, invalidBytes, base.changeSet))
      .toEqual({ state: "NOT_EVALUATED", reason: "SCOPE_POLICY_INVALID" });
    const mismatchText = planText.replace('"scopeKey":"scope-1"', '"scopeKey":"other"');
    const mismatchBytes = new TextEncoder().encode(mismatchText);
    const mismatchBaseline = (await fixture(mismatchBytes)).baseline;
    expect(computeScopeFallback(mismatchBaseline, mismatchBytes, base.changeSet))
      .toEqual({ state: "NOT_EVALUATED", reason: "SCOPE_POLICY_REFERENCE_MISMATCH" });
  });
});
