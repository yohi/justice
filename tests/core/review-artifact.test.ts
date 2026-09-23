import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  arrangeReviewArtifactCompletionFixture,
} from "../helpers/review-artifact-e2e-fixture";
import { parseReviewWorkerResult } from "../../src/core/review-artifact";

/**
 * Task 3.6 — review artifact I/O and completion-domain coverage. The fixture
 * constructs the real completion domain and the real Task 3.2 within-boundary
 * Gate evaluator; the only doubles are the injected filesystem capability,
 * durable append ports, advisory spy, and the deterministic PASS rule result.
 * A reserved artifact is never read through the ordinary `FileReader.readFile`.
 */
describe("review artifact completion (Task 3.6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a finding with any empty required text field", () => {
    const finding = { itemKey: "item-1", severity: "major", summary: "summary", location: "src/file.ts" };

    for (const field of ["itemKey", "summary", "location"] as const) {
      expect(
        parseReviewWorkerResult({
          schemaVersion: 1,
          complete: true,
          findings: [{ ...finding, [field]: "" }],
        }),
      ).toBeUndefined();
    }
  });

  it("keeps only the supported finding fields from worker output", () => {
    const result = parseReviewWorkerResult({
      schemaVersion: 1,
      complete: true,
      findings: [
        {
          itemKey: "item-1",
          severity: "major",
          summary: "summary",
          location: "src/file.ts",
          injected: "untrusted extra property",
        },
      ],
    });

    expect(result?.findings[0]).toEqual({
      itemKey: "item-1",
      severity: "major",
      summary: "summary",
      location: "src/file.ts",
    });
  });

  it("reads exactly once from matching artifact, lease, and durable identities", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "terminalized" });
    expect(fixture.readReservedArtifact).toHaveBeenCalledTimes(1);
    expect(fixture.genericArtifactRead).not.toHaveBeenCalled();
    expect(fixture.parseAndAssemble).toHaveBeenCalledTimes(1);
  });

  it("moves a clean live completion through exactly one Gate and Acceptance decision", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "terminalized" });
    await expect(fixture.durableGateDecisions()).resolves.toHaveLength(1);
    await expect(fixture.durableAcceptanceDecisions()).resolves.toHaveLength(1);
  });

  it("stages artifact_read_failed before parsing when the artifact is replaced", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.replaceArtifactWithDifferentInode("replacement artifact");

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "blocked" });
    await expect(fixture.durableFailureStaging()).resolves.toEqual(
      expect.objectContaining({ terminalReason: "artifact_read_failed" }),
    );
    expect(fixture.parseAndAssemble).not.toHaveBeenCalled();
    await expect(fixture.durableGateDecisions()).resolves.toEqual([]);
    await expect(fixture.durableAcceptanceDecisions()).resolves.toEqual([]);
  });

  it("retains a replacement path during terminal cleanup and records an advisory", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("terminalized");
    await fixture.replaceArtifactWithDifferentInode("replacement artifact");

    await fixture.ensureCleanup();

    await expect(fixture.readReplacementArtifact()).resolves.toBe("replacement artifact");
    expect(fixture.unlinkArtifactPath).not.toHaveBeenCalled();
    expect(fixture.recordAdvisory).toHaveBeenCalledWith("review_artifact_identity_mismatch");
  });

  it("propagates cleanup_incomplete without using mock unlink counts as native security evidence", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("terminalized");
    fixture.failNextLeaseDelete();

    await fixture.ensureCleanup();

    expect(fixture.recordAdvisory).toHaveBeenCalledWith("review_artifact_cleanup_incomplete");
    await expect(fixture.leaseExists()).resolves.toBe(true);
  });

  it("records a durable cleanup record with the exact provider status", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("terminalized");

    await fixture.ensureCleanup();

    const cleanups = await fixture.durableCleanupRecords();
    const finished = cleanups.filter((record) => record.phase === "finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ status: "cleaned", artifactId: fixture.reservation.artifactId });
  });

  it("appends a review_observed record carrying the review correlation (N3 dedup key)", async () => {
    const fixture = await arrangeReviewArtifactCompletionFixture("claimed");
    await fixture.writeReservedArtifact(fixture.reservation, fixture.validReviewWorkerJson);

    await expect(fixture.consume()).resolves.toMatchObject({ kind: "terminalized" });
    const observed = (await fixture.durableRecords()).find(
      (record) => record.recordType === "observation" && record.kind === "review_observed",
    );
    expect(observed).toBeDefined();
    expect(observed).toMatchObject({
      correlation: fixture.correlation,
      reviewScope: "task:task-1",
    });
  });
});
