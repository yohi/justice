import { describe, expect, it } from "vitest";
import type {
  ArtifactDigest,
  RequirementsAuthoritySnapshotV1,
  RequirementsResolutionV2,
} from "../../../src/core/review-gate-types.js";
import { planRequirementsAuthorityTransition } from "../../../src/core/review-gate/requirements-authority.js";

const digest = (value: string): ArtifactDigest => value.padEnd(64, "0") as ArtifactDigest;

const historical: RequirementsResolutionV2 = {
  schemaVersion: 2,
  source: "explicit",
  canonicalPath: "docs/requirements.md",
  digest: digest("requirements-d0"),
  gitMode: "100644",
  requirementsGitBlobOid: "requirements-blob-d0",
  committedBaselineOid: "commit-d0",
  workspaceIdentity: "workspace-1",
  selectionEvidence: { commandPath: "docs/requirements.md" },
};

const effective: RequirementsAuthoritySnapshotV1 = {
  schemaVersion: 1,
  historicalResolutionEventId: "gate-created-d0",
  currentAuthorityEventId: "gate-created-d0",
  producingOperationId: "admission-d0",
  workspaceIdentity: "workspace-1",
  repositoryIdentity: "repository-1",
  requirements: {
    source: "explicit",
    selectedCanonicalPath: "docs/requirements.md",
    canonicalPath: "docs/requirements.md",
    gitBlobOid: "requirements-blob-d0",
    digest: digest("requirements-d0"),
    gitMode: "100644",
  },
  design: {
    canonicalPath: "docs/design.md",
    digest: digest("design-d0"),
    gitMode: "100644",
    verifiedCommitOid: "commit-d0",
    verifiedTreeOid: "tree-d0",
    phaseProtocolFingerprint: "protocol-d0",
    marker: {
      presence: "present",
      validPreamblePosition: true,
      declaredCanonicalPath: "docs/requirements.md",
      declarationLine: 3,
      declarationDigest: digest("marker-d0"),
    },
  },
};

describe("planRequirementsAuthorityTransition", () => {
  it("rebases effective authority without rewriting immutable V2 provenance", () => {
    const decision = planRequirementsAuthorityTransition({
      historical,
      effective,
      proposed: {
        requirements: {
          source: "explicit",
          canonicalPath: "docs/requirements.md",
          digest: digest("requirements-d1"),
          gitMode: "100644",
          gitBlobOid: "requirements-blob-d1",
        },
        design: effective.design,
        authorityEventId: "requirements-change-d1",
        operationId: "revalidate-d1",
      },
      origin: "external_committed_change",
    });

    expect(decision).toMatchObject({
      kind: "REBASE",
      next: {
        historicalResolutionEventId: "gate-created-d0",
        currentAuthorityEventId: "requirements-change-d1",
        requirements: { digest: digest("requirements-d1") },
      },
    });
  });
});
