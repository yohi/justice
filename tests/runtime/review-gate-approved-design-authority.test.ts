import { describe, expect, it, vi } from "vitest";
import type { VerifiedApprovedDesignReadBindingV1 } from "../../src/core/review-gate/capabilities.js";
import type { AdmissionOwnedWitness } from "../../src/runtime/review-gate-admission-context.js";
import type { DurableReviewGateEventStore, VerifiedScopeRead } from "../../src/runtime/review-gate-event-store.js";
import type { ReviewGateGit } from "../../src/runtime/review-gate-git.js";
import type { ReviewGateQueryService } from "../../src/runtime/review-gate-query.js";
import type { ReviewGateScopeAdmission } from "../../src/runtime/review-gate-scope-admission.js";
import {
  buildApprovedDesignOperationReadBinding,
  createReviewGateApprovedDesignAuthority,
} from "../../src/runtime/review-gate-approved-design-authority.js";

const binding: VerifiedApprovedDesignReadBindingV1 = {
  schemaVersion: 1,
  canonicalPath: "docs/design.md",
  designClearEventId: "design-clear-event",
  currentAuthorityEventId: "design-clear-event",
  committedTreeOid: "a".repeat(40),
  blobOid: "b".repeat(40),
  gitMode: "100644",
  digest: "c".repeat(64),
  requirements: {
    canonicalPath: "docs/requirements.md",
    gitBlobOid: "d".repeat(40),
    digest: "e".repeat(64),
    gitMode: "100644",
  },
  phaseProtocolFingerprint: "design-protocol",
  witnessFrontierHash: "f".repeat(64),
};

describe("approved Design authority", () => {
  it("builds an operation binding only for a committed current Design clear", async () => {
    const owned = {
      assertOwnedGate: vi.fn(),
      readVerifiedFrontier: vi.fn(async () => ({
        workspaceIdentity: "workspace",
        workspaceEnrollmentId: "enrollment",
        scopes: [{
          scopeId: "scope-1",
          workflowContinuityId: "continuity",
          canonicalDesignPath: binding.canonicalPath,
          canonicalPlanPath: "docs/plan.md",
          pathPairDigest: "0".repeat(64),
          provenance: { kind: "verified_genesis" as const, evidenceDigest: "evidence", priorScopeId: null, priorGateId: null },
          gateMembership: [{ gateId: "gate-1", generationId: "generation-1", supersedesGateId: null, admissionEventId: "created", writerIds: ["writer"] }],
        }],
        writerHeads: [],
        globalFrontierHash: binding.witnessFrontierHash,
      })),
      assertOwnedScope: vi.fn(),
      readVerifiedDesignBinding: vi.fn(async () => ({
        treeSha: binding.committedTreeOid,
        blobSha: binding.blobOid,
        gitMode: binding.gitMode,
        objectSize: 128,
      })),
    } as unknown as AdmissionOwnedWitness;
    const scopeRead = {
      frontier: { globalFrontierHash: binding.witnessFrontierHash },
      gateIds: ["gate-1"],
      eventsByGate: new Map([
        ["gate-1", [
          {
            eventType: "GATE_CREATED",
            eventId: "gate-created-event",
            gateId: "gate-1",
            payload: {
              reviewScopeId: "scope-1",
              designArtifact: { canonicalPath: binding.canonicalPath, digest: binding.digest, gitMode: binding.gitMode },
              requirementsResolution: {
                canonicalPath: binding.requirements.canonicalPath,
                requirementsGitBlobOid: binding.requirements.gitBlobOid,
                digest: binding.requirements.digest,
                gitMode: binding.requirements.gitMode,
              },
              designProtocolFingerprint: binding.phaseProtocolFingerprint,
            },
          },
          {
            eventType: "DESIGN_CLEAR",
            eventId: binding.designClearEventId,
            gateId: "gate-1",
            payload: {
              designProtocolFingerprint: binding.phaseProtocolFingerprint,
              approvedContextEventId: "operation-1",
            },
          },
        ]],
      ]),
    } as unknown as VerifiedScopeRead;
    const eventStore = {
      readVerifiedScopeOwned: vi.fn(async () => scopeRead),
    } as unknown as DurableReviewGateEventStore;
    const git = {
      inspectTarget: vi.fn(async () => ({
        canonicalPath: binding.canonicalPath,
        headSha: binding.committedTreeOid,
        headEntry: { canonicalPath: binding.canonicalPath, blobSha: binding.blobOid, gitMode: binding.gitMode },
        indexEntry: { canonicalPath: binding.canonicalPath, blobSha: binding.blobOid, gitMode: binding.gitMode, stage: 0 as const },
        indexConflicted: false,
        worktree: { canonicalPath: binding.canonicalPath, digest: binding.digest, gitMode: binding.gitMode },
        headBlobDigest: binding.digest,
      })),
    } as unknown as ReviewGateGit;
    const result = await buildApprovedDesignOperationReadBinding(owned, {
      gateId: "gate-1",
      operationId: "operation-1",
      designPath: binding.canonicalPath,
    }, { eventStore, git });

    expect(result).toEqual({
      gateId: "gate-1",
      operationId: "operation-1",
      canonicalPath: binding.canonicalPath,
      treeSha: binding.committedTreeOid,
      blobSha: binding.blobOid,
      gitMode: binding.gitMode,
      objectSize: 128,
      approvedDesign: binding,
    });
    expect(owned.assertOwnedGate).toHaveBeenCalledWith("gate-1");
    expect(owned.assertOwnedScope).toHaveBeenCalledWith("scope-1");
    expect(eventStore.readVerifiedScopeOwned).toHaveBeenCalledWith(owned, "scope-1");
    expect(git.inspectTarget).toHaveBeenCalledWith(binding.canonicalPath);
    expect(owned.readVerifiedDesignBinding).toHaveBeenCalledWith({ gateId: "gate-1", designPath: binding.canonicalPath });
  });

  it("rejects an unsafe Design path before consulting the witness", async () => {
    const owned = {
      assertOwnedGate: vi.fn(),
      assertOwnedScope: vi.fn(),
      readVerifiedDesignBinding: vi.fn(async () => ({
        treeSha: binding.committedTreeOid,
        blobSha: binding.blobOid,
        gitMode: binding.gitMode,
        objectSize: 128,
      })),
    } as unknown as AdmissionOwnedWitness;
    const result = await buildApprovedDesignOperationReadBinding(owned, {
      gateId: "gate-1",
      operationId: "operation-1",
      designPath: "../design.md",
    });

    expect(result).toBeNull();
    expect(owned.readVerifiedDesignBinding).not.toHaveBeenCalled();
  });

  it("fails closed when the factory has no owned-admission request", async () => {
    const eventStore = { readVerifiedEvents: vi.fn() } as unknown as DurableReviewGateEventStore;
    const authority = createReviewGateApprovedDesignAuthority({
      admission: {} as ReviewGateScopeAdmission,
      eventStore,
      git: {} as ReviewGateGit,
      query: {} as ReviewGateQueryService,
    });

    await expect(authority.getApprovedDesignBinding({
      gateId: "gate-1",
      designPath: binding.canonicalPath,
    })).resolves.toBeNull();
    expect(eventStore.readVerifiedEvents).not.toHaveBeenCalled();
  });

  it("resolves the omitted Plan path from the single verified Gate history read", async () => {
    const events = [
      {
        eventType: "GATE_CREATED",
        gateId: "gate-1",
        payload: {
          reviewScopeId: "scope-1",
          designArtifact: { canonicalPath: binding.canonicalPath },
          planArtifact: { canonicalPath: "docs/plan.md" },
        },
      },
      {
        eventType: "DESIGN_CLEAR",
        eventId: binding.designClearEventId,
        gateId: "gate-1",
        payload: { approvedContextEventId: "operation-1" },
      },
    ];
    const eventStore = {
      readVerifiedEvents: vi.fn(async () => events),
    } as unknown as DurableReviewGateEventStore;
    let observedPlanPath: string | undefined;
    const admission = {
      withAdmissionLease: async (request: { readonly planPath: string }, run: (decision: never) => Promise<null>) => {
        observedPlanPath = request.planPath;
        return run({ kind: "BLOCK", reason: "scope_not_enrolled", detail: "blocked" } as never);
      },
    } as unknown as ReviewGateScopeAdmission;
    const authority = createReviewGateApprovedDesignAuthority({
      admission,
      eventStore,
      git: {} as ReviewGateGit,
      query: {} as ReviewGateQueryService,
      admissionRequest: {
        workspaceRoot: "/workspace",
        workspaceIdentity: "workspace-identity",
        designPath: binding.canonicalPath,
        protocol: {} as never,
      },
    });

    await expect(authority.getApprovedDesignBinding({
      gateId: "gate-1",
      designPath: binding.canonicalPath,
    })).resolves.toBeNull();

    expect(observedPlanPath).toBe("docs/plan.md");
    expect(eventStore.readVerifiedEvents).toHaveBeenCalledTimes(1);
  });

});
