import { describe, expect, it } from "vitest";
import { createReviewGateCoordinator } from "../../src/runtime/review-gate-coordinator";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import {
  createReviewGateScopeAdmission,
  ScopeAdmissionBlocked,
  type ReviewGateScopeAdmission,
} from "../../src/runtime/review-gate-scope-admission";
import type { AdmissionOwnedWitness } from "../../src/runtime/review-gate-admission-context";
import { resolveRequirementsForAdmission } from "../../src/runtime/review-gate-requirements";
import {
  createInMemoryReviewGateEventStore,
  createMapReviewWorkspaceReader,
} from "../helpers/review-gate-coordinator";

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const DESIGN_CONTENT = "# Design\n";
const PLAN_CONTENT = "## Plan\n- [ ] task\n";

function createMockScopeAdmission(
  decision: AdmissionDecision,
): ReviewGateScopeAdmission {
  return {
    withAdmissionLease: async (_request, run) => run(decision, null, mockOwnedWitness()),
  };
}

function mockOwnedWitness(): AdmissionOwnedWitness {
  return {
    readVerifiedFrontier: async () => {
      throw new Error("mock_owned_unused");
    },
    readFirstEnrollmentAuthority: async () => null,
    readInstallation: async () => {
      throw new Error("mock_owned_unused");
    },
    assertOwnedScope: () => undefined,
    assertOwnedGate: () => undefined,
  };
}

let testCounter = 0;

function createTestCoordinator(
  scopeAdmission: ReviewGateScopeAdmission | null,
) {
  testCounter += 1;
  const eventStore = createInMemoryReviewGateEventStore();
  const protocol = createReviewGateProtocolDescriptor();
  const files = new Map([
    [DESIGN_PATH, DESIGN_CONTENT],
    [PLAN_PATH, PLAN_CONTENT],
  ]);
  const coordinator = createReviewGateCoordinator({
    eventStore,
    lockManager: createReviewGateLockManager(`/nonexistent-test-root-${testCounter}`, {
      provider: null,
    }),
    protocol,
    workspaceReader: createMapReviewWorkspaceReader(files),
    workspaceRoot: `/nonexistent-test-root-${testCounter}`,
    workspaceIdentity: "test-workspace-identity",
    mutationSubstrate: null,
    scopeAdmission,
    inspectTargets: async (paths) =>
      new Map(paths.map((path) => [path, "clean_committed" as const])),
    now: () => "2026-10-13T00:00:00.000Z",
    newId: () => "test-id",
    newWriterId: () => "test-writer",
  });
  return { coordinator, eventStore };
}

describe("coordinator startOrResume routes through scope admission", () => {
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

  it("waits for the lease and applies the decision when the lease frees", async () => {
    let attempts = 0;
    const scopeAdmission: ReviewGateScopeAdmission = {
      withAdmissionLease: async (_request, run) => {
        attempts += 1;
        if (attempts < 3) throw new ScopeAdmissionBlocked("scope_lease_occupied");
        return run(
          {
            kind: "CREATE_GENESIS",
            workspaceIdentity: "test-workspace-identity",
            scopeId: "scope-1" as import("../../src/core/review-gate-types").ReviewScopeId,
            installationId: "installation-1",
            enrollmentAuthorizationEventId: "enrollment-1",
            verifiedWorkspaceFrontierHash: "frontier-1",
            completeRelationClosureDigest: "closure-1",
          },
          null,
          mockOwnedWitness(),
        );
      },
    };
    const { coordinator, eventStore } = createTestCoordinator(scopeAdmission);

    const result = await coordinator.startOrResume("session-1", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(attempts).toBe(3);
    // The decision is applied through the callback, not skipped.
    expect(result.dispatched).toBe(true);
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

  it("creates a new gate via legacy path when scope admission returns CREATE_GENESIS", async () => {
    const { coordinator } = createTestCoordinator(
      createMockScopeAdmission({
        kind: "CREATE_GENESIS",
        workspaceIdentity: "test-workspace-identity",
        scopeId: "scope-1" as import("../../src/core/review-gate-types").ReviewScopeId,
        installationId: "installation-1",
        enrollmentAuthorizationEventId: "enrollment-1",
        verifiedWorkspaceFrontierHash: "frontier-1",
        completeRelationClosureDigest: "closure-1",
      }),
    );

    const result = await coordinator.startOrResume("session-2", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    expect(result.dispatched).toBe(true);
    expect(result.gateId).not.toBeNull();
    expect(result.guidance).toContain("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
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
