import { describe, expect, it } from "vitest";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../../src/core/review-gate/event-schema.js";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../../src/core/review-gate/identity.js";
import { assertCompletedPredecessor } from "../../src/runtime/review-gate-witness-scope-enrollment.js";
import type { WitnessContext, WitnessTransaction } from "../../src/runtime/review-gate-witness-context.js";

describe("assertCompletedPredecessor", () => {
  it("accepts a completed V2 predecessor projected from its verified history", async () => {
    const digest = "a".repeat(64);
    const gateId = "gate-predecessor";
    const scopeId = "scope-predecessor";
    const workspaceIdentity = "workspace-identity";
    const gateCreated = validateReviewGateEventRecord({
      schemaVersion: 2,
      eventId: "event-created",
      parentEventId: "event-before-created",
      emittedAt: "2026-10-12T00:00:00.000Z",
      gateId,
      epochId: "epoch-1",
      generationId: "generation-1",
      writerId: "writer-1",
      eventType: "GATE_CREATED",
      payload: {
        reviewScopeId: scopeId,
        supersedesGateId: null,
        requirementsResolution: {
          schemaVersion: 2,
          source: "explicit",
          canonicalPath: "docs/requirements.md",
          digest,
          gitMode: "100644",
          requirementsGitBlobOid: "requirements-blob",
          committedBaselineOid: "baseline-commit",
          workspaceIdentity,
          selectionEvidence: {},
        },
        designArtifact: { canonicalPath: "docs/design.md", digest, gitMode: "100644" },
        planArtifact: { canonicalPath: "docs/plan.md", digest, gitMode: "100644" },
        reviewProtocolFingerprint: digest,
        designProtocolFingerprint: digest,
        planProtocolFingerprint: digest,
      },
    });
    const completed = validateReviewGateEventRecord({
      schemaVersion: 2,
      eventId: "event-completed",
      parentEventId: "event-created",
      emittedAt: "2026-10-12T00:00:01.000Z",
      gateId,
      epochId: "epoch-1",
      generationId: "generation-1",
      writerId: "writer-1",
      eventType: "COMPLETED_APPROVAL_BINDING",
      payload: {
        approvalBinding: {
          reviewScopeId: scopeId,
          gateId,
          designArtifact: { canonicalPath: "docs/design.md", digest, gitMode: "100644" },
          planArtifact: { canonicalPath: "docs/plan.md", digest, gitMode: "100644" },
          requirementsResolution: {
            source: "explicit",
            canonicalPath: "docs/requirements.md",
            digest,
          },
          reviewProtocolFingerprint: digest,
          designProtocolFingerprint: digest,
          planProtocolFingerprint: digest,
          approvedAt: "2026-10-12T00:00:01.000Z",
        },
        designClearEventId: "event-design-clear",
        planClearEventId: "event-plan-clear",
        currentRequirementsAuthorityEventId: "event-created",
        currentRequirements: {
          source: "explicit",
          workspaceIdentity,
          canonicalPath: "docs/requirements.md",
          digest,
          gitMode: "100644",
          gitBlobOid: "requirements-blob",
          selectedByEventId: "event-created",
        },
      },
    });
    const bytes = Buffer.from(
      `${[gateCreated, completed].map(encodeReviewGateEventRecord).join("\n")}\n`,
    );
    const scope = {
      scopeId,
      workflowContinuityId: "workflow-1",
      canonicalDesignPath: "docs/design.md",
      canonicalPlanPath: "docs/plan.md",
      pathPairDigest: computeCanonicalJsonFingerprint(["docs/design.md", "docs/plan.md"]),
      provenance: {
        kind: "verified_genesis",
        evidenceDigest: digest,
        priorScopeId: null,
        priorGateId: null,
      },
      gateMembership: [{
        gateId,
        generationId: "generation-1",
        supersedesGateId: null,
        admissionEventId: gateCreated.eventId,
        writerIds: ["writer-1"],
      }],
    } as const;
    const frontierContents = {
      workspaceIdentity,
      workspaceEnrollmentId: "enrollment-1",
      scopes: [scope],
      writerHeads: [{
        scopeId,
        gateId,
        writerId: "writer-1",
        sequence: 2,
        hash: computeArtifactDigest(bytes),
      }],
    };
    const frontier = {
      ...frontierContents,
      globalFrontierHash: computeCanonicalJsonFingerprint(frontierContents),
    };
    const context = {
      options: { workspaceRoot: "/workspace", workspaceIdentity },
      provider: { readWriterShard: async () => bytes },
      store: { read: async () => ({ data: { targets: {} } }) },
    } as unknown as WitnessContext;
    const current = {
      data: {
        installationId: "installation-1",
        workspaces: {
          [workspaceIdentity]: {
            repositoryIdentity: "repository-1",
            frontier,
            enrollmentState: "committed",
            authorization: {},
          },
        },
      },
      hash: digest,
      revision: 1,
      installation: { installationId: "installation-1" },
      repositoryIdentity: "repository-1",
    } as unknown as WitnessTransaction;

    await expect(assertCompletedPredecessor(context, current, scopeId, gateId))
      .resolves.toBeUndefined();
  });
});
