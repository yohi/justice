import { describe, expect, it } from "vitest";
import type { LoaderResult } from "../../../src/core/s1a/contract.js";
import { loadS1aArtifacts } from "../../../src/core/s1a/loader.js";
import { s1aFixture } from "../../helpers/s1a-fixtures.js";
import { inspectBaseline } from "../../../src/core/s1b/baseline.js";

async function readyResult(): Promise<LoaderResult> {
  const fixture = s1aFixture();
  return loadS1aArtifacts(fixture.input, fixture.source);
}

describe("inspectBaseline", () => {
  it("readyLoaderFixtureIsCandidateNotAuthority", async () => {
    const baseline = await readyResult();
    const authority = baseline.ownerAuthorityStatus;
    const precondition = baseline.ownerTrustPrecondition;
    const limitations = baseline.limitations;

    const result = inspectBaseline(baseline);

    expect(result.state).toBe("READY");
    expect(baseline.eligibleBaseline).toBe(false);
    expect(baseline.ownerAuthorityStatus).toBe(authority);
    expect(baseline.ownerTrustPrecondition).toBe(precondition);
    expect(baseline.limitations).toBe(limitations);
    if (result.state === "READY") {
      expect(result.selection.task.artifactId).toBe("task-1");
      expect(result.selection.acs.map((ref) => ref.artifactId)).toEqual(["ac-1", "ac-2"]);
    }
  });

  it("mismatchedManifestOrDirtyArtifactCannotBecomeReady", async () => {
    const baseline = await readyResult();
    const dirty: LoaderResult = {
      ...baseline,
      identityStatus: "MISMATCH",
      identityCandidateReady: false,
      selectedRefs: baseline.selectedRefs.map((ref, index) => index === 0
        ? { ...ref, observedDigest: "0".repeat(64), digestOutcome: "MISMATCH" }
        : ref),
      checks: baseline.checks.map((check, index) => index === baseline.checks.findIndex((entry) => entry.check === "artifact_digest")
        ? { ...check, outcome: "MISMATCH", observed: "0".repeat(64) }
        : check),
    };

    expect(inspectBaseline({ ...baseline, manifestDigestMatch: false, identityCandidateReady: false, identityStatus: "MISMATCH", checks: baseline.checks.map((check, index) => index === 0 ? { ...check, outcome: "MISMATCH" } : check) }).state).toBe("NOT_READY");
    expect(inspectBaseline(dirty).state).toBe("NOT_READY");
  });

  it("forgedReadyWithWrongIdentityRejected", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, identityStatus: "UNKNOWN" }).state).toBe("MALFORMED");
    expect(inspectBaseline({ ...baseline, identityCandidateReady: false }).state).toBe("MALFORMED");
  });

  it("invalidParentOrDuplicateSelectedIdRejected", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, selectedRefs: baseline.selectedRefs.map((ref) => ref.artifactId === "plan-1" ? { ...ref, parentId: "wrong" } : ref) }).state).toBe("MALFORMED");
    expect(inspectBaseline({ ...baseline, selectedRefs: [...baseline.selectedRefs, baseline.selectedRefs[0]] }).state).toBe("MALFORMED");
  });

  it("normalUnknownAndPartialS1aIsNotReady", async () => {
    const fixture = s1aFixture();
    const baseline = await loadS1aArtifacts({ ...fixture.input, expectedManifestSha256: undefined }, fixture.source);
    expect(inspectBaseline(baseline).state).toBe("NOT_READY");
  });

  it("atMost128Selected", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, selectedRefs: Array.from({ length: 129 }, (_, index) => ({ ...baseline.selectedRefs[0], artifactId: `artifact-${index}` })) }).state).toBe("MALFORMED");
  });

  it("readyMatchWithMismatchCheckIsMalformed", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, checks: baseline.checks.map((check, index) => index === 0 ? { ...check, outcome: "MISMATCH" } : check) }).state).toBe("MALFORMED");
  });

  it("readyMatchWithUnknownCheckIsMalformed", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, checks: baseline.checks.map((check, index) => index === 0 ? { ...check, outcome: "UNKNOWN" } : check) }).state).toBe("MALFORMED");
  });

  it("readyArtifactDigestCheckMissingIsMalformed", async () => {
    const baseline = await readyResult();
    const index = baseline.checks.findIndex((check) => check.check === "artifact_digest");
    expect(inspectBaseline({ ...baseline, checks: baseline.checks.filter((_, i) => i !== index) }).state).toBe("MALFORMED");
  });

  it("readyArtifactDigestCheckMismatchIsMalformed", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, checks: baseline.checks.map((check) => check.check === "artifact_digest" ? { ...check, outcome: "MISMATCH" } : check) }).state).toBe("MALFORMED");
  });

  it("duplicateReadyArtifactDigestCheckIsMalformed", async () => {
    const baseline = await readyResult();
    const check = baseline.checks.find((entry) => entry.check === "artifact_digest");
    expect(inspectBaseline({ ...baseline, checks: check ? [...baseline.checks, check] : baseline.checks }).state).toBe("MALFORMED");
  });

  it("orphanReadyArtifactDigestCheckIsMalformed", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, selectedRefs: baseline.selectedRefs.slice(0, -1) }).state).toBe("MALFORMED");
  });

  it("checksOverBinderLimitIsMalformed", async () => {
    const baseline = await readyResult();
    expect(inspectBaseline({ ...baseline, checks: Array.from({ length: 129 }, (_, index) => ({ ...baseline.checks[0], targetId: `check-${index}` })) }).state).toBe("MALFORMED");
  });

  it("checksOverLimitUsesBaselinePrecedence", async () => {
    const baseline = await readyResult();
    const checks = Array.from({ length: 129 }, (_, index) => ({ ...baseline.checks[0], targetId: `check-${index}` }));
    expect(inspectBaseline({ ...baseline, identityCandidateReady: false, identityStatus: "MATCH", manifestDigestMatch: true, checks }).state).toBe("MALFORMED");
  });

  it("consistentNonreadyS1aIsNotReady", async () => {
    const fixture = s1aFixture();
    const baseline = await loadS1aArtifacts(fixture.input, { ...fixture.source, async readArtifact() { throw Error("unreadable"); } });
    expect(inspectBaseline(baseline).state).toBe("NOT_READY");
  });
});
