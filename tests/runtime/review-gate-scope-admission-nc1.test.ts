import { describe, expect, it } from "vitest";
import { computeArtifactDigest } from "../../src/core/review-gate/identity.js";
import { isNc1ParentArtifactBindingValid } from "../../src/runtime/review-gate-scope-admission.js";

const parentBytes = Buffer.from("artifact before NC1\n");
const parentDigest = computeArtifactDigest(parentBytes);
const parentBlobOid = "a".repeat(40);

describe("NC1 parent artifact binding", () => {
  it("rejects Design and Plan parent blobs whose content digest differs from the stopped binding", () => {
    for (const artifactKind of ["design", "plan"] as const) {
      expect(
        isNc1ParentArtifactBindingValid({
          artifactKind,
          parentBlobBytes: parentBytes,
          parentBlobOid,
          beforeArtifactDigest: "b".repeat(64),
          beforeGitBlobOid: parentBlobOid,
        }),
      ).toBe(false);
    }
  });

  it("rejects a Requirements parent blob whose content digest differs from the stopped binding", () => {
    expect(
      isNc1ParentArtifactBindingValid({
        artifactKind: "requirements",
        parentBlobBytes: parentBytes,
        parentBlobOid,
        beforeArtifactDigest: "b".repeat(64),
        beforeGitBlobOid: parentBlobOid,
      }),
    ).toBe(false);
  });

  it("rejects a Requirements parent blob whose Git OID differs from the stopped binding", () => {
    expect(
      isNc1ParentArtifactBindingValid({
        artifactKind: "requirements",
        parentBlobBytes: parentBytes,
        parentBlobOid,
        beforeArtifactDigest: parentDigest,
        beforeGitBlobOid: "c".repeat(40),
      }),
    ).toBe(false);
  });

  it("accepts a parent blob matching both the before digest and Requirements OID", () => {
    expect(
      isNc1ParentArtifactBindingValid({
        artifactKind: "requirements",
        parentBlobBytes: parentBytes,
        parentBlobOid,
        beforeArtifactDigest: parentDigest,
        beforeGitBlobOid: parentBlobOid,
      }),
    ).toBe(true);
  });
});
