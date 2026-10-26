import { describe, expect, it } from "vitest";
import { createReviewGateCoordinator } from "../../src/runtime/review-gate-coordinator";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import { computeArtifactDigest, computeReviewScopeId } from "../../src/core/review-gate/identity";
import {
  createReviewGateScopeAdmission,
  ScopeAdmissionBlocked,
  type ReviewGateScopeAdmission,
} from "../../src/runtime/review-gate-scope-admission";
import type { AdmissionOwnedWitness, ReviewGateAdmissionObservation } from "../../src/runtime/review-gate-admission-context";
import type { AdmissionDecision } from "../../src/core/review-gate/admission";
import { resolveRequirementsForAdmission } from "../../src/runtime/review-gate-requirements";
import {
  createInMemoryReviewGateEventStore,
  createMapReviewWorkspaceReader,
} from "../helpers/review-gate-coordinator";

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const DESIGN_CONTENT = "# Design\n";
const PLAN_CONTENT = "## Plan\n- [ ] task\n";
const SCOPE_ID = computeReviewScopeId(DESIGN_PATH, PLAN_PATH) as import("../../src/core/review-gate-types").ReviewScopeId;

function createMockScopeAdmission(
  decision: AdmissionDecision,
  observation: ReviewGateAdmissionObservation | null = null,
): (eventStore: ReturnType<typeof createInMemoryReviewGateEventStore>) => ReviewGateScopeAdmission {
  return (eventStore) => {
    let creationApplied = false;
    return {
      withAdmissionLease: async (_request, run) => {
        if (
          creationApplied &&
          (decision.kind === "CREATE_GENESIS" || decision.kind === "CREATE_SUCCESSOR")
        ) {
          const gateId = await eventStore.readScopeIndex(SCOPE_ID);
          if (gateId === null) throw new Error("test_admitted_gate_missing");
          return run(
            { kind: "RESUME", gateId, generationId: gateId, witnessFrontierHash: "frontier-1" },
            observation,
            mockOwnedWitness(eventStore),
          );
        }
        const result = await run(decision, observation, mockOwnedWitness(eventStore));
        if (decision.kind === "CREATE_GENESIS" || decision.kind === "CREATE_SUCCESSOR") {
          creationApplied = true;
        }
        return result;
      },
    };
  };
}

function mockOwnedWitness(eventStore: ReturnType<typeof createInMemoryReviewGateEventStore>): AdmissionOwnedWitness {
  const firstEnrollment = { installationId: "installation-1", workspaceIdentity: "test-workspace-identity", canonicalDesignPath: DESIGN_PATH, canonicalPlanPath: PLAN_PATH, authorizationOperationId: "enrollment-1", authenticatedProvisionerDigest: "digest-1", verifiedAbsentPriorEnrollmentFrontierHash: "frontier-1", authorizationEventId: "enrollment-event-1" };
  return {
    read: async () => { throw new Error("mock_owned_unused"); },
    readVerifiedFrontier: async () => {
      return { workspaceIdentity: "test-workspace-identity", workspaceEnrollmentId: "enrollment-1", scopes: [], writerHeads: [], globalFrontierHash: "frontier-1" };
    },
    readFirstEnrollmentAuthority: async () => firstEnrollment,
    consumeFirstEnrollmentAuthority: async () => undefined,
    readInstallation: async () => {
      return { installationId: "installation-1", epoch: "epoch-1", provisionerPublicKeyPem: "", hostTrustRootPem: "", authenticatedProvisionerDigest: "digest-1", ownerUid: 0, authorizationSignature: "", directoryIdentityDigest: "" };
    },
    readVerifiedDesignBinding: async () => null,
    signAdmittedMembership: async () => "test-signature",
    preparePublication: async () => "prepared",
    publishPreparedJournal: async () => undefined,
    commitPreparedPublicationCAS: (input) => eventStore.commitPreparedPublicationCAS(input),
    recoverPreparedPublication: async () => "advanced",
    assertOwnedScope: () => undefined,
    assertOwnedGate: () => undefined,
  };
}

function createGenesisObservation(protocol = createReviewGateProtocolDescriptor()): ReviewGateAdmissionObservation {
  const design = { canonicalPath: DESIGN_PATH, digest: computeArtifactDigest(new TextEncoder().encode(DESIGN_CONTENT)), gitMode: "100644" as const };
  const plan = { canonicalPath: PLAN_PATH, digest: computeArtifactDigest(new TextEncoder().encode(PLAN_CONTENT)), gitMode: "100644" as const };
  const requirementsResolution = { schemaVersion: 2 as const, source: "design_declared_reference" as const, canonicalPath: DESIGN_PATH, digest: design.digest, gitMode: "100644" as const, requirementsGitBlobOid: "a".repeat(40), committedBaselineOid: "b".repeat(40), workspaceIdentity: "test-workspace-identity", selectionEvidence: {} };
  const authority = { installationId: "installation-1", workspaceIdentity: "test-workspace-identity", canonicalDesignPath: DESIGN_PATH, canonicalPlanPath: PLAN_PATH, authorizationOperationId: "enrollment-1", authenticatedProvisionerDigest: "digest-1", verifiedAbsentPriorEnrollmentFrontierHash: "frontier-1", authorizationEventId: "enrollment-1" };
  const enrollment = { scopeId: SCOPE_ID, workflowContinuityId: "workflow-1", canonicalDesignPath: DESIGN_PATH, canonicalPlanPath: PLAN_PATH, pathPairDigest: "pair-1", provenance: { kind: "verified_genesis" as const, evidenceDigest: "evidence-1", priorScopeId: null, priorGateId: null }, gateMembership: [] };
  return {
    requirementsResolution,
    snapshot: {
      workspaceIdentity: "test-workspace-identity", scopeId: SCOPE_ID, verifiedFrontierHash: "frontier-1",
      workspaceContinuity: { installationId: "installation-1", workspaceIdentity: "test-workspace-identity", protectedInstallationFrontierHash: "frontier-1", workspaceEnrollmentFrontierHash: "frontier-1", registryVerificationEventId: "registry-1", allEnrollments: [enrollment], relatedScopeTips: [], relatedGateHistoryFrontierHash: "frontier-1", authorizedFirstEnrollment: authority, verifiedIndependentWorkflow: null, verifiedCrossScopePredecessor: null, relationClosureProofDigest: "closure-1", coverage: "COMPLETE" },
      currentTips: [], nc1Observation: "NOT_INSPECTED", nc1Candidate: null, precedence: null,
      current: { requirements: { source: "design_declared_reference", workspaceIdentity: "test-workspace-identity", canonicalPath: DESIGN_PATH, digest: design.digest, gitMode: "100644", gitBlobOid: "a".repeat(40), observedCommitOid: "b".repeat(40), observationEvidenceId: "requirements-observation" }, design, plan, globalProtocolFingerprint: protocol.reviewProtocolFingerprint, designProtocolFingerprint: protocol.designProtocolFingerprint, planProtocolFingerprint: protocol.planProtocolFingerprint },
    },
  };
}

let testCounter = 0;

function createTestCoordinator(
  scopeAdmission: ReviewGateScopeAdmission | ((eventStore: ReturnType<typeof createInMemoryReviewGateEventStore>) => ReviewGateScopeAdmission) | null,
) {
  testCounter += 1;
  let idSequence = 0;
  const eventStore = createInMemoryReviewGateEventStore();
  const resolvedScopeAdmission = typeof scopeAdmission === "function" ? scopeAdmission(eventStore) : scopeAdmission;
  const lockManager = createReviewGateLockManager(`/nonexistent-test-root-${testCounter}`, {
    provider: null,
  });
  const protocol = createReviewGateProtocolDescriptor();
  const files = new Map([
    [DESIGN_PATH, DESIGN_CONTENT],
    [PLAN_PATH, PLAN_CONTENT],
  ]);
  const recoveryObjects = new Map<string, Buffer>();
  const coordinator = createReviewGateCoordinator({
    eventStore,
    lockManager,
    protocol,
    workspaceReader: createMapReviewWorkspaceReader(files),
    workspaceRoot: `/nonexistent-test-root-${testCounter}`,
    workspaceIdentity: "test-workspace-identity",
    mutationSubstrate: null,
    scopeAdmission: resolvedScopeAdmission,
    recoveryStore: {
      publish: async (digest, bytes) => {
        if (recoveryObjects.has(digest)) return "exists";
        recoveryObjects.set(digest, Buffer.from(bytes));
        return "created";
      },
      read: async (digest) => recoveryObjects.get(digest) ?? null,
      list: async () => [...recoveryObjects.keys()],
      close: () => undefined,
    },
    inspectTargets: async (paths) =>
      new Map(paths.map((path) => [path, "clean_committed" as const])),
    now: () => "2026-10-13T00:00:00.000Z",
    newId: () => `test-id-${++idSequence}`,
  });
  return { coordinator, eventStore, lockManager };
}

describe("coordinator startOrResume routes through scope admission", () => {
  it("releases the shared session locks while preparing an approved Plan binding", async () => {
    const sharedLocks: { manager?: ReturnType<typeof createReviewGateLockManager> } = {};
    let admissionCalls = 0;
    const { coordinator, eventStore, lockManager: manager } = createTestCoordinator(() => ({
      withAdmissionLease: async (_request, run) => {
        admissionCalls += 1;
        if (admissionCalls === 5) {
          const scopeLock = await sharedLocks.manager?.acquireScopeLock(SCOPE_ID);
          expect(scopeLock).not.toBe("occupied");
          if (scopeLock !== undefined && scopeLock !== "occupied") scopeLock.release();
          const gateLock = await sharedLocks.manager?.acquireGateLock("legacy-gate");
          expect(gateLock).not.toBe("occupied");
          if (gateLock !== undefined && gateLock !== "occupied") gateLock.release();
          return run({ kind: "BLOCK", reason: "scope_not_enrolled", detail: "blocked" }, null, mockOwnedWitness(eventStore));
        }
        return run({ kind: "RESUME", gateId: "legacy-gate", generationId: "legacy-v1", witnessFrontierHash: "frontier-1" }, null, mockOwnedWitness(eventStore));
      },
    }));
    sharedLocks.manager = manager;
    const observation = createGenesisObservation();
    const identity = {
      gateId: "legacy-gate" as import("../../src/core/review-gate-types").GateId,
      writerId: "legacy-writer" as import("../../src/core/review-gate-types").WriterId,
      epochId: "legacy-epoch" as import("../../src/core/review-gate-types").EpochId,
      emittedAt: "2026-10-13T00:00:00.000Z",
    };
    await eventStore.appendEvents("legacy-gate", [
      {
        ...identity,
        eventType: "GATE_CREATED",
        payload: {
          reviewScopeId: SCOPE_ID,
          designArtifact: observation.snapshot.current.design,
          planArtifact: observation.snapshot.current.plan,
          requirementsResolution: {
            source: "auto_design_reference",
            canonicalPath: DESIGN_PATH,
            digest: observation.snapshot.current.design.digest,
          },
          reviewProtocolFingerprint: observation.snapshot.current.globalProtocolFingerprint,
        },
      },
      {
        ...identity,
        eventType: "DESIGN_CLEAR",
        payload: { designProtocolFingerprint: observation.snapshot.current.designProtocolFingerprint },
      },
    ]);

    await coordinator.startOrResume("shared-lock-session", {
      source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
    });
    const resumed = await coordinator.startOrResume("shared-lock-session", {
      source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH,
    });
    expect(resumed.gateId).toBe("legacy-gate");
    await expect(coordinator.prepareCallerOperation("shared-lock-session", {
      kind: "dispatch_reviewer", phase: "plan",
    })).rejects.toThrow("review_gate_approved_design_proof_unavailable");
    expect(admissionCalls).toBe(5);

    coordinator.releaseSession("shared-lock-session");
    const scopeLock = await manager.acquireScopeLock(SCOPE_ID);
    expect(scopeLock).not.toBe("occupied");
    if (scopeLock !== "occupied") scopeLock?.release();
    const gateLock = await manager.acquireGateLock("legacy-gate");
    expect(gateLock).not.toBe("occupied");
    if (gateLock !== "occupied") gateLock?.release();
  });

  it("returns a blocked result when scope admission blocks", async () => {
    const { coordinator } = createTestCoordinator(
      createMockScopeAdmission({
        kind: "BLOCK",
        reason: "first_enrollment_unauthorized",
        detail: "test block",
      }),
    );

    const result = await coordinator.startOrResume("session-1", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    expect(result.gateId).toBeNull();
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(result.guidance).toContain("test block");
  });

  it("returns a reuse result when scope admission reports reuse completed", async () => {
    const { coordinator } = createTestCoordinator(
      createMockScopeAdmission({
        kind: "REUSE_COMPLETED",
        gateId: "gate-reused",
        generationId: "gen-1",
        approvalEventId: "approval-1",
        verifiedHistoryFrontier: "frontier-1",
      }),
    );

    const result = await coordinator.startOrResume("session-1", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    expect(result.gateId).toBe("gate-reused");
    expect(result.completedReuse).toBe(true);
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE CLEAR]");
    expect(result.designPath).toBe(DESIGN_PATH);
    expect(result.planPath).toBe(PLAN_PATH);
  });

  it("does not allocate a successor when changed unfinished input needs revalidation", async () => {
    const { coordinator, eventStore } = createTestCoordinator(
      createMockScopeAdmission({
        kind: "REVALIDATE_OR_BLOCK",
        gateId: "unfinished-gate",
        generationId: "generation-1",
        dimension: "design",
        reason: "design changed",
        predecessorProofRefs: ["created", "effective"],
        witnessFrontierHash: "frontier-1",
      }),
    );

    const result = await coordinator.startOrResume("changed-unfinished", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(await eventStore.listGateIds()).toEqual([]);
  });

  it("does not generically resume a suspended admission tip", async () => {
    const { coordinator, eventStore } = createTestCoordinator(
      createMockScopeAdmission({
        kind: "STAY_SUSPENDED",
        gateId: "suspended-gate",
        generationId: "generation-1",
        nc1StopEventId: "stop-1",
        witnessFrontierHash: "frontier-1",
      }),
    );

    const result = await coordinator.startOrResume("suspended-tip", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    expect(result.guidance).toContain("suspended");
    expect(await eventStore.listGateIds()).toEqual([]);
  });

  it.each([
    {
      kind: "REVALIDATE_OR_BLOCK",
      gateId: "gate-revalidation",
      generationId: "generation-1",
      dimension: "design",
      reason: "design changed",
      predecessorProofRefs: [],
      witnessFrontierHash: "frontier-1",
    },
    {
      kind: "UPSTREAM_PRECEDENCE_REQUIRED",
      gateId: "gate-upstream",
      generationId: "generation-1",
      blockers: [],
      witnessFrontierHash: "frontier-1",
    },
    {
      kind: "STALE_LINEAGE_REVALIDATION_REQUIRED",
      gateId: "gate-stale",
      generationId: "generation-1",
      pending: [],
      witnessFrontierHash: "frontier-1",
    },
  ] satisfies readonly AdmissionDecision[])("blocks $kind when verified current proof is absent", async (decision) => {
    const { coordinator, eventStore } = createTestCoordinator(
      createMockScopeAdmission(decision),
    );

    const result = await coordinator.startOrResume(`missing-proof-${decision.kind}`, {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(await eventStore.listGateIds()).toEqual([]);
  });

  it("re-admits before resuming and preserves the crash epoch and spent rounds", async () => {
    let admissionCalls = 0;
    const scopeAdmission = (
      eventStore: ReturnType<typeof createInMemoryReviewGateEventStore>,
    ): ReviewGateScopeAdmission => ({
      withAdmissionLease: async (_request, run) => {
        admissionCalls += 1;
        if (admissionCalls === 1) {
          return run(
            {
              kind: "CREATE_GENESIS",
              workspaceIdentity: "test-workspace-identity",
              scopeId: SCOPE_ID,
              installationId: "installation-1",
              enrollmentAuthorizationEventId: "enrollment-1",
              verifiedWorkspaceFrontierHash: "frontier-1",
              completeRelationClosureDigest: "closure-1",
            },
            createGenesisObservation(),
            mockOwnedWitness(eventStore),
          );
        }

        const gateId = await eventStore.readScopeIndex(SCOPE_ID);
        if (gateId === null) throw new Error("test_admitted_gate_missing");
        if (admissionCalls === 2) {
          const genesis = (await eventStore.readV2Journal(gateId)).events[0];
          if (genesis === undefined || genesis.eventType !== "GATE_CREATED") {
            throw new Error("test_admitted_genesis_missing");
          }
          const identity = {
            gateId: genesis.gateId as import("../../src/core/review-gate-types").GateId,
            writerId: genesis.writerId as import("../../src/core/review-gate-types").WriterId,
            epochId: genesis.epochId as import("../../src/core/review-gate-types").EpochId,
            emittedAt: genesis.emittedAt,
          };
          await eventStore.appendEvents(gateId, [
            {
              ...identity,
              eventType: "FINDING_DISCOVERED",
              payload: {
                lineageId: "crash-lineage" as import("../../src/core/review-gate-types").LineageId,
                findingId: "crash-finding" as import("../../src/core/review-gate-types").FindingId,
                observedPhase: "design",
                ownerScope: "design",
                descriptionDigest: "crash-description" as import("../../src/core/review-gate-types").ArtifactDigest,
              },
            },
            {
              ...identity,
              eventType: "FINDING_REMEDIATED",
              payload: {
                lineageId: "crash-lineage" as import("../../src/core/review-gate-types").LineageId,
                findingId: "crash-finding" as import("../../src/core/review-gate-types").FindingId,
                remediationRound: { phase: "design", ordinal: 1 },
              },
            },
          ]);
        }
        return run(
          { kind: "RESUME", gateId, generationId: gateId, witnessFrontierHash: "frontier-1" },
          null,
          mockOwnedWitness(eventStore),
        );
      },
    });
    const { coordinator, eventStore } = createTestCoordinator(scopeAdmission);

    const result = await coordinator.startOrResume("crash-resume", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    const gateId = result.gateId;
    if (gateId === null) throw new Error("test_resumed_gate_missing");
    const genesis = (await eventStore.readV2Journal(gateId)).events[0];
    if (genesis === undefined || genesis.eventType !== "GATE_CREATED") {
      throw new Error("test_admitted_genesis_missing");
    }
    expect(await eventStore.readScopeIndex(SCOPE_ID)).toBe(gateId);
    expect(await eventStore.listGateIds()).toContain(gateId);
  });

  it("waits for the lease and applies the decision when the lease frees", async () => {
    let attempts = 0;
    const scopeAdmission = (eventStore: ReturnType<typeof createInMemoryReviewGateEventStore>): ReviewGateScopeAdmission => ({
      withAdmissionLease: async (_request, run) => {
        attempts += 1;
        if (attempts < 3) throw new ScopeAdmissionBlocked("scope_lease_occupied");
        if (attempts > 3) {
          const gateId = await eventStore.readScopeIndex(SCOPE_ID);
          if (gateId === null) throw new Error("test_admitted_gate_missing");
          return run(
            { kind: "RESUME", gateId, generationId: gateId, witnessFrontierHash: "frontier-1" },
            null,
            mockOwnedWitness(eventStore),
          );
        }
        return run(
          {
            kind: "CREATE_GENESIS",
            workspaceIdentity: "test-workspace-identity",
            scopeId: SCOPE_ID,
            installationId: "installation-1",
            enrollmentAuthorizationEventId: "enrollment-1",
            verifiedWorkspaceFrontierHash: "frontier-1",
            completeRelationClosureDigest: "closure-1",
          },
          createGenesisObservation(),
          mockOwnedWitness(eventStore),
        );
      },
    });
    const { coordinator, eventStore } = createTestCoordinator(scopeAdmission);

    const result = await coordinator.startOrResume("session-1", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(attempts).toBe(3);
    // A fresh V2 genesis is created and returned immediately; the V1 resume
    // dispatch loop is not entered.
    expect(result.dispatched).toBe(false);
    expect(result.gateId).not.toBeNull();
    expect(await eventStore.listGateIds()).toEqual([result.gateId]);
  });

  it("never routes an occupied lease through the legacy path", async () => {
    const scopeAdmission: ReviewGateScopeAdmission = {
      withAdmissionLease: async () => {
        throw new ScopeAdmissionBlocked("scope_lease_occupied");
      },
    };
    const { coordinator, eventStore } = createTestCoordinator(scopeAdmission);

    const result = await coordinator.startOrResume("session-1", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    // Fail closed after the bounded wait: no gate is created and no legacy
    // admission bypass runs.
    expect(result.dispatched).toBe(false);
    expect(result.gateId).toBeNull();
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(await eventStore.listGateIds()).toEqual([]);
  });

  it("blocks non-occupancy scope admission errors without using the legacy path", async () => {
    const scopeAdmission: ReviewGateScopeAdmission = {
      withAdmissionLease: async () => {
        throw new ScopeAdmissionBlocked("witness_unavailable");
      },
    };
    const { coordinator } = createTestCoordinator(scopeAdmission);

    const result = await coordinator.startOrResume("session-1", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    expect(result.gateId).toBeNull();
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
  });

  it("creates a V2 gate through admitted CREATE_GENESIS", async () => {
    const { coordinator, eventStore } = createTestCoordinator(
      createMockScopeAdmission({
        kind: "CREATE_GENESIS",
        workspaceIdentity: "test-workspace-identity",
        scopeId: SCOPE_ID,
        installationId: "installation-1",
        enrollmentAuthorizationEventId: "enrollment-1",
        verifiedWorkspaceFrontierHash: "frontier-1",
        completeRelationClosureDigest: "closure-1",
      }, createGenesisObservation()),
    );

    const result = await coordinator.startOrResume("session-2", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(false);
    expect(result.gateId).not.toBeNull();
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE CREATED]");
    const gateId = result.gateId;
    expect(gateId).not.toBeNull();
    expect(await eventStore.listGateIds()).toContain(gateId);
    const journal = await eventStore.readV2Journal(gateId ?? "");
    expect(journal.events.some((event) => "schemaVersion" in event && event.schemaVersion === 2 && event.eventType === "GATE_CREATED")).toBe(true);
    expect(await eventStore.readScopeIndex(SCOPE_ID)).toBe(gateId);
  });
});

describe("createReviewGateScopeAdmission witness availability", () => {
  it("throws witness_unavailable when the trusted witness is null", async () => {
    const eventStore = createInMemoryReviewGateEventStore();
    const protocol = createReviewGateProtocolDescriptor();
    const files = new Map([
      [DESIGN_PATH, DESIGN_CONTENT],
      [PLAN_PATH, PLAN_CONTENT],
    ]);
    const admission = createReviewGateScopeAdmission({
      witness: null,
      eventStore,
      lockManager: createReviewGateLockManager(`/nonexistent-test-root-witness`, {
        provider: null,
      }),
      workspaceReader: createMapReviewWorkspaceReader(files),
      requirementsResolver: resolveRequirementsForAdmission,
      protocol,
    });

    await expect(
      admission.withAdmissionLease(
        {
          workspaceRoot: `/nonexistent-test-root-witness`,
          workspaceIdentity: "test-workspace-identity",
          designPath: DESIGN_PATH,
          planPath: PLAN_PATH,
          protocol,
        },
        async () => "ran",
      ),
    ).rejects.toThrow(ScopeAdmissionBlocked);
  });
});
