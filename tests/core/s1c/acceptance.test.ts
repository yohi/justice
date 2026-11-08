import { describe, expect, it } from "vitest";
import { loadS1aArtifacts } from "../../../src/core/s1a/loader.js";
import { evaluateS1c } from "../../../src/core/s1c/evaluator.js";
import { S1C_LIMITATIONS, type ChangeSet, type S1cInput } from "../../../src/core/s1c/contract.js";
import type { EvidenceRefV1 } from "../../../src/core/s1b/contract.js";
import { s1aFixture, sha256 } from "../../helpers/s1a-fixtures.js";
import { s1cFixture } from "../../helpers/s1c-fixtures.js";

const policy = (options: Readonly<{
  allowedPaths?: readonly string[];
  planId?: string;
  taskId?: string;
  taskRevision?: string;
  scopeKey?: string;
}> = {}): string => JSON.stringify({
  schemaVersion: "justice-s1c-task-scope-v1",
  planRef: { artifactId: options.planId ?? "plan-1", revision: "R1" },
  taskRef: { artifactId: options.taskId ?? "task-1", revision: options.taskRevision ?? "R1" },
  scopeKey: options.scopeKey ?? "scope-1",
  allowedPaths: options.allowedPaths ?? ["src/core/s1c/**", "tests/core/s1c/**"],
});

const section = (json: string): string => [
  "## Justice S1-c Task Scope Policies",
  "<!-- justice:s1c-task-scope:begin -->",
  json,
  "<!-- justice:s1c-task-scope:end -->",
].join("\n");

const oneChange = (path: string): ChangeSet => ({
  availability: "PRESENT",
  changes: [{ kind: "MODIFY", path }],
});

const evidenceWith = (
  refs: readonly EvidenceRefV1[],
  mutate: (ref: EvidenceRefV1) => EvidenceRefV1,
): readonly EvidenceRefV1[] => refs.map((ref, index) => index === 0 ? mutate(ref) : ref);

describe("S1-c acceptance fixtures", () => {
  it("builds a real ready S1-a candidate without promoting authority", async () => {
    const fixture = await s1cFixture();

    expect(fixture.input.baseline.identityCandidateReady).toBe(true);
    expect(fixture.input.baseline.eligibleBaseline).toBe(false);
    expect(fixture.input.baseline.ownerAuthorityStatus).toBe("NOT_PROVEN");
    expect(fixture.input.baseline.selectedRefs.find((ref) => ref.kind === "plan")?.observedDigest)
      .toBe(sha256(fixture.planBytes));
    expect(fixture.input.evidenceRefs.every((ref) =>
      ref.reportedExecutionState === "EXECUTED" && ref.provenanceClass === "SELF_DECLARED",
    )).toBe(true);
  });
});

describe("S1-c bounded end-to-end acceptance matrix", () => {
  const matrix: readonly Readonly<{
    name: string;
    planText?: string;
    changes?: ChangeSet;
    evidenceRefs?: readonly EvidenceRefV1[];
    expectedComparison: string;
    expectedDiagnostics: readonly string[];
  }>[] = [
    {
      name: "allows a change within the static candidate paths",
      changes: oneChange("src/core/s1c/evaluator.ts"),
      expectedComparison: "WITHIN_CANDIDATE_SCOPE",
      expectedDiagnostics: ["OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "reports the exact out-of-scope path",
      changes: oneChange("src/runtime/adapter.ts"),
      expectedComparison: "OUTSIDE_CANDIDATE_SCOPE",
      expectedDiagnostics: ["OUTSIDE_CANDIDATE_SCOPE", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "returns unknown when the active policy is absent",
      planText: "## Justice S1-c Task Scope Policies\nNo policy markers are active here.",
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["SCOPE_POLICY_UNDEFINED", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "rejects an explicit empty allowlist for a changed path",
      planText: section(policy({ allowedPaths: [] })),
      changes: oneChange("src/core/s1c/evaluator.ts"),
      expectedComparison: "OUTSIDE_CANDIDATE_SCOPE",
      expectedDiagnostics: ["OUTSIDE_CANDIDATE_SCOPE", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "returns unknown when change availability is unavailable",
      changes: { availability: "UNAVAILABLE" },
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["CHANGESET_UNAVAILABLE", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "accepts a present ChangeSet with zero changes",
      changes: { availability: "PRESENT", changes: [] },
      expectedComparison: "WITHIN_CANDIDATE_SCOPE",
      expectedDiagnostics: ["OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "rejects two selected Task Policy blocks",
      planText: `${section(policy())}\n${section(policy({ allowedPaths: ["docs/**"] }))}`,
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["SCOPE_POLICY_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "ignores example-only fenced and quoted markers",
      planText: [
        "## Justice S1-c Task Scope Policies",
        "> <!-- justice:s1c-task-scope:begin -->",
        "> {\"schemaVersion\":\"justice-s1c-task-scope-v1\"}",
        "> <!-- justice:s1c-task-scope:end -->",
        "```md",
        "<!-- justice:s1c-task-scope:begin -->",
        policy(),
        "<!-- justice:s1c-task-scope:end -->",
        "```",
      ].join("\n"),
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["SCOPE_POLICY_UNDEFINED", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "rejects a malformed active Policy marker block",
      planText: [
        "## Justice S1-c Task Scope Policies",
        "<!-- justice:s1c-task-scope:begin -->",
        "{malformed-json}",
        "<!-- justice:s1c-task-scope:end -->",
      ].join("\n"),
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["SCOPE_POLICY_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "invalidates the section when another Task block is malformed",
      planText: `${section(policy())}\n<!-- justice:s1c-task-scope:begin -->\n{}\n<!-- justice:s1c-task-scope:end -->`,
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["SCOPE_POLICY_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "treats a rename crossing the allowlist as outside",
      changes: { availability: "PRESENT", changes: [{ kind: "RENAME", oldPath: "src/core/s1c/a.ts", newPath: "src/runtime/a.ts" }] },
      expectedComparison: "OUTSIDE_CANDIDATE_SCOPE",
      expectedDiagnostics: ["OUTSIDE_CANDIDATE_SCOPE", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "rejects a mixed malformed ChangeSet",
      changes: { availability: "PRESENT", changes: [null] } as unknown as ChangeSet,
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["CHANGESET_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "reports invalid evidence without hiding a valid candidate Scope",
      changes: oneChange("tests/core/s1c/acceptance.test.ts"),
      evidenceRefs: [null] as unknown as readonly EvidenceRefV1[],
      expectedComparison: "WITHIN_CANDIDATE_SCOPE",
      expectedDiagnostics: ["S1B_INPUT_REJECTED", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "preserves real evidence mismatch and AC missing when ChangeSet is malformed",
      changes: { availability: "PRESENT", changes: [null] } as unknown as ChangeSet,
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["CHANGESET_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
    {
      name: "reports a Plan/Task policy reference mismatch",
      planText: section(policy({ taskRevision: "R2" })),
      expectedComparison: "UNKNOWN",
      expectedDiagnostics: ["SCOPE_POLICY_REFERENCE_MISMATCH", "OWNER_AUTHORITY_NOT_VERIFIED"],
    },
  ];

  it.each(matrix)("$name", async ({ planText, changes, evidenceRefs, expectedComparison, expectedDiagnostics }) => {
    const fixture = await s1cFixture({
      ...(planText !== undefined ? { planText } : {}),
      ...(changes !== undefined ? { changes } : {}),
      ...(evidenceRefs !== undefined ? { evidenceRefs } : {}),
    });
    const result = evaluateS1c(fixture.input);

    expect(result.candidateScopeComparison).toBe(expectedComparison);
    expect(result.diagnostics.map((item) => item.code)).toEqual(expectedDiagnostics);
    expect(result.formalVerdict).toBe("UNKNOWN");
    expect(result.ownerAuthorityVerification).toBe("NOT_VERIFIED_BY_S1C");
    expect(result.limitations).toEqual(S1C_LIMITATIONS);
  });

  it("returns the exact validated path for an out-of-scope change", async () => {
    const fixture = await s1cFixture({ changes: oneChange("src/runtime/adapter.ts") });
    const result = evaluateS1c(fixture.input);

    expect(result.diagnostics.find((item) => item.code === "OUTSIDE_CANDIDATE_SCOPE")).toEqual({
      code: "OUTSIDE_CANDIDATE_SCOPE",
      path: "src/runtime/adapter.ts",
    });
  });

  it.each([
    { name: "Task identity", mutate: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, taskRef: { artifactId: "task-other", revision: "R1" } }), reason: "TASK_NOT_SELECTED" },
    { name: "Task revision", mutate: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, taskRef: { ...ref.taskRef, revision: "R2" } }), reason: "TASK_REVISION_MISMATCH" },
    { name: "Scope", mutate: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, scopeKey: "scope-other" }), reason: "SCOPE_MISMATCH" },
    { name: "AC identity", mutate: (ref: EvidenceRefV1): EvidenceRefV1 => ({ ...ref, acRef: { artifactId: "ac-other", revision: "R1" } }), reason: "AC_NOT_SELECTED" },
    { name: "AC revision", mutate: (ref: EvidenceRefV1): EvidenceRefV1 => ref.acRef === undefined ? ref : ({ ...ref, acRef: { ...ref.acRef, revision: "R2" } }), reason: "AC_REVISION_MISMATCH" },
  ])("retains the S1-b typed $name mismatch reason", async ({ mutate, reason }) => {
    const fixture = await s1cFixture();
    const evidenceRefs = evidenceWith(fixture.input.evidenceRefs, mutate);
    const result = evaluateS1c({ ...fixture.input, evidenceRefs });
    const mismatch = result.diagnostics.find((item) => item.code === "S1B_BINDING_MISMATCH");

    expect(mismatch?.code === "S1B_BINDING_MISMATCH" ? mismatch.bindingReasonCodes : []).toContain(reason);
    expect(result.formalVerdict).toBe("UNKNOWN");
  });

  it.each([
    { name: "SELF_DECLARED PASS remains a report", state: "EXECUTED" as const, outcome: "PASS" as const },
    { name: "NOT_EXECUTED remains a report", state: "NOT_EXECUTED" as const, outcome: "FAIL" as const },
  ])("does not promote $name to verified acceptance", async ({ state, outcome }) => {
    const fixture = await s1cFixture();
    const evidenceRefs = evidenceWith(fixture.input.evidenceRefs, (ref) => ({
      ...ref,
      reportedExecutionState: state,
      reportedOutcome: outcome,
    }));
    const input = { ...fixture.input, evidenceRefs };
    const result = evaluateS1c(input);

    expect(result.reportedEvidenceClaims[0]).toMatchObject({ reportedExecutionState: state, reportedOutcome: outcome });
    expect(result.formalVerdict).toBe("UNKNOWN");
    expect(result.ownerAuthorityVerification).toBe("NOT_VERIFIED_BY_S1C");
  });

  it("rejects an authority promotion field on the outer envelope", async () => {
    const fixture = await s1cFixture();
    const result = evaluateS1c({ ...fixture.input, approved: true } as unknown as S1cInput);

    expect(result.diagnostics.map((item) => item.code)).toEqual(["S1C_INPUT_INVALID", "OWNER_AUTHORITY_NOT_VERIFIED"]);
    expect(result.formalVerdict).toBe("UNKNOWN");
    expect(result.formalVerdict).not.toBe("NO_DEVIATION_DETECTED");
    expect(result.formalVerdict).not.toBe("DEVIATION_DETECTED");
  });

  it("reports Plan byte identity mismatch after loading the baseline", async () => {
    const fixture = await s1cFixture();
    const result = evaluateS1c({ ...fixture.input, planBytes: new TextEncoder().encode("different Plan bytes") });

    expect(result.diagnostics.map((item) => item.code)).toContain("PLAN_IDENTITY_MISMATCH");
    expect(result.candidateScopeComparison).toBe("UNKNOWN");
    expect(result.formalVerdict).toBe("UNKNOWN");
  });

  it("retains a real S1-b mismatch and missing AC beside an invalid ChangeSet", async () => {
    const fixture = await s1cFixture({
      changes: { availability: "PRESENT", changes: [null] } as unknown as ChangeSet,
    });
    const evidenceRef = fixture.input.evidenceRefs[0];
    if (evidenceRef === undefined) throw Error("S1C_FIXTURE_EVIDENCE_NOT_SELECTED");
    const result = evaluateS1c({
      ...fixture.input,
      evidenceRefs: [{ ...evidenceRef, taskRef: { artifactId: "task-other", revision: "R1" } }],
    });

    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "CHANGESET_INVALID",
      "S1B_BINDING_MISMATCH",
      "AC_EVIDENCE_REF_MISSING",
      "AC_EVIDENCE_REF_MISSING",
      "OWNER_AUTHORITY_NOT_VERIFIED",
    ]);
    expect(result.formalVerdict).toBe("UNKNOWN");
  });

  it("retains the real S1-a mismatch when S1-b evidence is also malformed", async () => {
    const base = s1aFixture();
    const baseline = await loadS1aArtifacts(
      { ...base.input, expectedManifestSha256: "0".repeat(64) },
      base.source,
    );
    const fixture = await s1cFixture({ changes: { availability: "PRESENT", changes: [null] } as unknown as ChangeSet });
    const result = evaluateS1c({ ...fixture.input, baseline });

    expect(result.diagnostics.map((item) => item.code)).toContain("S1A_BASELINE_NOT_READY");
    expect(result.diagnostics.map((item) => item.code)).toContain("S1B_BASELINE_UNKNOWN");
    expect(result.formalVerdict).toBe("UNKNOWN");
  });
});
