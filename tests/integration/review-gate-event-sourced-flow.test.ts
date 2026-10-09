import { describe, expect, it } from "vitest";
import {
  createInMemoryReviewGateEventStore,
  createMapReviewWorkspaceReader,
} from "../helpers/review-gate-coordinator";
import { createReviewGateApprovalLookup } from "../../src/runtime/review-gate-approval";
import { createReviewGateHistoryService } from "../../src/runtime/review-gate-history";
import {
  createReviewGateCoordinator,
  type ReviewGateMutationSubstrate,
} from "../../src/runtime/review-gate-coordinator";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import { projectReviewGate } from "../../src/core/review-gate/projection";
import { computeArtifactDigest } from "../../src/core/review-gate/identity";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";
import type { HookEvent, HookResponse } from "../../src/core/types";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const DESIGN_V1 = "# Design\nAcceptance boundary.\n";
const PLAN_V1 = "## Task 1: Verification\n- [ ] Verify the boundary\n";

type RecordedCommit = Readonly<{ readonly phase: string; readonly artifactPath: string }>;

type FlowHarness = {
  readonly eventStore: ReturnType<typeof createInMemoryReviewGateEventStore>;
  readonly events: () => readonly ReviewGateEvent[];
  readonly files: Map<string, string>;
  readonly commits: RecordedCommit[];
  readonly coordinator: ReturnType<typeof createReviewGateCoordinator>;
  readonly protocol: ReturnType<typeof createReviewGateProtocolDescriptor>;
};

function createTestLockManager() {
  const makeLock = () => ({ release: () => undefined, verifyCloexec: () => true });
  return {
    acquireScopeLock: async () => makeLock(),
    acquireGateLock: async () => makeLock(),
    close: () => undefined,
  };
}

/**
 * One deterministic fake service graph: the coordinator, the history query,
 * and the durable approval lookup ride the ONE shared in-memory event store.
 * The fake agent runner is the test itself: every worker packet is answered by
 * scripted, strictly-typed JSON results — no external agent is ever spawned.
 */
function createFlowHarness(prefix: string): FlowHarness {
  const files = new Map<string, string>([
    [DESIGN_PATH, DESIGN_V1],
    [PLAN_PATH, PLAN_V1],
  ]);
  const eventStore = createInMemoryReviewGateEventStore();
  const protocol = createReviewGateProtocolDescriptor();
  const commits: RecordedCommit[] = [];
  const mutationSubstrate: ReviewGateMutationSubstrate = {
    commitArtifact: async (phase, artifactPath) => {
      commits.push({ phase, artifactPath });
      return { commitSha: `sha-${commits.length}` };
    },
    restoreArtifact: async () => {},
  };

  let serial = 0;
  let idCounter = 0;
  const coordinator = createReviewGateCoordinator({
    eventStore,
    lockManager: createTestLockManager(),
    protocol,
    workspaceReader: createMapReviewWorkspaceReader(files),
    mutationSubstrate,
    inspectTargets: async (paths) =>
      new Map(paths.map((path) => [path, "clean_committed" as const])),
    now: () => {
      serial += 1;
      return new Date(Date.UTC(2026, 9, 8, 0, 0, serial)).toISOString();
    },
    newId: () => {
      idCounter += 1;
      return `${prefix}-id-${idCounter}`;
    },
    newWriterId: () => `${prefix}-writer`,
  });

  return {
    eventStore,
    events: () => [...eventStore.gates().values()].flatMap((gate) => gate.events),
    files,
    commits,
    coordinator,
    protocol,
  };
}

function claimEvent(sessionId: string, callId: string, prompt: string): HookEvent {
  return {
    type: "PreToolUse",
    sessionId,
    callId,
    payload: { toolName: "task", callId, toolInput: { prompt } },
  } as HookEvent;
}

function resultEvent(sessionId: string, callId: string, toolResult: string): HookEvent {
  return {
    type: "PostToolUse",
    sessionId: `${callId}-worker`,
    callId,
    payload: { toolName: "task", callId, toolResult, error: false },
  } as HookEvent;
}

function parsePacketPayload(workerPrompt: string): Record<string, unknown> {
  const markerIndex = workerPrompt.indexOf("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
  if (markerIndex < 0) throw new Error("packet payload marker not found");
  const payloadStart = workerPrompt.indexOf("{", markerIndex);
  const payloadEnd = workerPrompt.indexOf("\n", payloadStart);
  const payloadText = (
    payloadEnd < 0 ? workerPrompt.slice(payloadStart) : workerPrompt.slice(payloadStart, payloadEnd)
  ).trim();
  const parsed: unknown = JSON.parse(payloadText);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("packet payload is not an object");
  }
  return parsed as Record<string, unknown>;
}

function nextPromptOf(response: HookResponse): string | undefined {
  const args = (response as { modifiedPayload?: { args?: { prompt?: unknown } } })
    .modifiedPayload?.args;
  return typeof args?.prompt === "string" ? args.prompt : undefined;
}

function reviewerResult(
  payload: Record<string, unknown>,
  candidates: readonly Record<string, unknown>[],
): string {
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidates,
  });
}

function findingValidationResult(payload: Record<string, unknown>): string {
  const candidate = payload.candidate as Record<string, unknown>;
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidateId: candidate.candidateId,
    decision: "VALID",
    severity: "blocking",
    observedPhase: payload.phase,
    semanticBasis: {
      violationType: "UNVERIFIED_CLAIM",
      governingReference: "design.md#acceptance",
      semanticLocation: "Task 1",
      violatedContract: "verify",
      ownerScope: "plan",
    },
    relation: "NEW",
  });
}

function remediationResult(payload: Record<string, unknown>, outcome: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: null,
    remediationRound: payload.remediationRound,
    targetPath: (payload.targetArtifact as Record<string, unknown>).canonicalPath,
    outcome,
    summary: "Repaired",
  });
}

function selfReviewResult(payload: Record<string, unknown>): string {
  const targets = (payload.targetLineageRefs as readonly string[]) ?? [];
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: null,
    remediationRound: payload.remediationRound,
    targetLineageChecks: targets.map((lineageId) => ({ lineageId, result: "RESOLVED" })),
    discoveredFindings: [],
  });
}

/**
 * Scripted fake agent runner for one design remediation round followed by
 * clean reviews: the first design review reports one candidate, the
 * remediation worker replaces the Design bytes, and every later review
 * reports zero candidates until the gate completes.
 */
function createRemediateOnceScript(harness: FlowHarness, candidateId: string) {
  let reviewerDispatches = 0;
  return (payload: Record<string, unknown>): string => {
    switch (payload.requiredResultKind) {
      case "review_candidates": {
        reviewerDispatches += 1;
        return reviewerDispatches === 1
          ? reviewerResult(payload, [
              {
                candidateId,
                severity: "major",
                summary: `Missing lifecycle evidence (${candidateId})`,
                location: "Task 1",
              },
            ])
          : reviewerResult(payload, []);
      }
      case "finding_validation":
        return findingValidationResult(payload);
      case "remediation":
        harness.files.set(
          DESIGN_PATH,
          `${DESIGN_V1.replace("boundary.", "boundary with lifecycle coverage.")}\n<!-- ${candidateId} fixed -->\n`,
        );
        return remediationResult(payload, "COMPLETED");
      case "self_review":
        return selfReviewResult(payload);
      default:
        throw new Error(`unexpected operation: ${String(payload.requiredResultKind)}`);
    }
  };
}

type GateDriveResult = Readonly<{
  readonly lastResponse: HookResponse;
  readonly answeredPayloads: readonly Record<string, unknown>[];
}>;

/**
 * Drive one gate from `startOrResume` through claimed worker packets until no
 * next worker prompt is planned (or `shouldStop` matches a packet). Every
 * answered packet payload is recorded so tests can assert the dispatched
 * operation sequence.
 */
async function driveGate(
  harness: FlowHarness,
  sessionId: string,
  initialPrompt: string | undefined,
  answer: (payload: Record<string, unknown>) => string,
  shouldStop?: (payload: Record<string, unknown>) => boolean,
): Promise<GateDriveResult> {
  const answeredPayloads: Record<string, unknown>[] = [];
  let prompt: string | undefined = initialPrompt;
  let response: HookResponse | null = null;
  let callSerial = 0;
  while (typeof prompt === "string") {
    const payload = parsePacketPayload(prompt);
    if (shouldStop?.(payload) === true) {
      return { lastResponse: response as HookResponse, answeredPayloads };
    }
    callSerial += 1;
    const callId = `${sessionId}-call-${callSerial}`;
    await harness.coordinator.preToolUse(claimEvent(sessionId, callId, prompt));
    answeredPayloads.push(payload);
    response = (await harness.coordinator.postToolUse(
      resultEvent(sessionId, callId, answer(payload)),
    )) as HookResponse;
    prompt = nextPromptOf(response);
  }
  if (response === null) throw new Error("gate never dispatched a worker");
  return { lastResponse: response, answeredPayloads };
}

describe("Review Gate event-sourced flow (Task 15 E2E)", () => {
  it("completes the staged Design→Plan gate end to end and binds the durable approval", async () => {
    const harness = createFlowHarness("flow");
    const designDigestBeforeRemediation = computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8"));

    // 1. Gate start pins the durable genesis: RR1 auto Requirements resolution
    // resolves the Requirements artifact to the Design file itself.
    const started = await harness.coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(started.dispatched).toBe(true);
    const genesis = harness
      .events()
      .find((event): event is Extract<ReviewGateEvent, { eventType: "GATE_CREATED" }> =>
        event.eventType === "GATE_CREATED",
      );
    expect(genesis).toBeDefined();
    expect(genesis?.payload.requirementsResolution.source).toBe("auto_design_reference");
    expect(genesis?.payload.requirementsResolution.canonicalPath).toBe(DESIGN_PATH);
    expect(genesis?.payload.requirementsResolution.digest).toBe(designDigestBeforeRemediation);
    expect(genesis?.payload.reviewProtocolFingerprint).toBe(
      harness.protocol.reviewProtocolFingerprint,
    );
    expect(genesis?.payload.designArtifact.gitMode).toBe("100644");
    expect(genesis?.payload.planArtifact.gitMode).toBe("100644");

    // 2-6. Design review → reconciliation → remediation → self-review →
    // exact commit → fresh design review, then the plan review clears.
    const drive = await driveGate(
      harness,
      "main",
      started.reviewerPrompt,
      createRemediateOnceScript(harness, "cand-1"),
    );
    expect(drive.lastResponse.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

    expect(harness.commits).toEqual([{ phase: "design", artifactPath: DESIGN_PATH }]);
    const designDigestAfterRemediation = computeArtifactDigest(
      Buffer.from(harness.files.get(DESIGN_PATH) as string, "utf8"),
    );
    expect(designDigestAfterRemediation).not.toBe(designDigestBeforeRemediation);

    // The durable event sequence proves the staged Design→Plan order.
    expect(harness.events().map((event) => event.eventType)).toEqual([
      "GATE_CREATED",
      "FINDING_DISCOVERED",
      "FINDING_REMEDIATED",
      "FINDING_SELF_REVIEWED",
      "ARTIFACT_BINDINGS_UPDATED",
      "DESIGN_CLEAR",
      "PLAN_CLEAR",
      "COMPLETED_APPROVAL_BINDING",
    ]);

    // 7. History query reads the durable projection: staged clear authority,
    // zero blockers, and the absolute 5/3 remediation usage.
    const history = createReviewGateHistoryService({
      rootDir: "/nonexistent-justice-flow-root",
      eventStore: harness.eventStore,
    });
    const historyResult = await history.queryScope(DESIGN_PATH, PLAN_PATH, {
      view: "summary",
      allGenerations: false,
    });
    if (historyResult.kind !== "display" || historyResult.payload.view !== "summary") {
      throw new Error(
        `history query returned no summary display: ${JSON.stringify(historyResult)}`,
      );
    }
    const dto = historyResult.payload.dto;
    expect(dto.status).toBe("completed");
    expect(dto.phase).toBe("plan");
    expect(dto.designClear).not.toBeNull();
    expect(dto.blockers).toEqual({ remediable: 0, upstream: 0, pendingRevalidation: 0 });
    expect(dto.remediationUsage).toEqual({
      design: { used: 1, remaining: 4 },
      plan: { used: 0, remaining: 3 },
    });

    // 8. `/justice-implement --approved` binds to the durable completed
    // approval: exact Requirements/Design/Plan digests + protocol fingerprint.
    const approval = createReviewGateApprovalLookup({
      eventStore: harness.eventStore,
      workspaceReader: createMapReviewWorkspaceReader(harness.files),
      protocol: harness.protocol,
    });
    const approvalOutcome = await approval.findCurrentCompletedApproval(PLAN_PATH);
    if (approvalOutcome.kind !== "approved") {
      throw new Error(`expected approval, got ${approvalOutcome.kind}`);
    }
    expect(approvalOutcome.gateId).toBe(genesis?.gateId);
    expect(approvalOutcome.binding.designArtifact.digest).toBe(designDigestAfterRemediation);
    expect(approvalOutcome.binding.planArtifact.digest).toBe(
      computeArtifactDigest(Buffer.from(PLAN_V1, "utf8")),
    );
    expect(approvalOutcome.binding.requirementsResolution.digest).toBe(
      designDigestAfterRemediation,
    );
    expect(approvalOutcome.binding.reviewProtocolFingerprint).toBe(
      harness.protocol.reviewProtocolFingerprint,
    );

    // The durable approval alone does not arm implementation: the explicit
    // user command boundary stays closed for implementation-capable tools.
    const decision = harness.coordinator.classifyToolUse("main", {
      toolName: "task",
      isPendingReviewGateTask: false,
      queryOnly: false,
      changedPaths: null,
    });
    expect(decision).toEqual({ kind: "deny", reason: "implementation_not_authorized" });

    // 9. Durable history alone reconstructs the same final projection in a
    // fresh coordinator instance: read-only completed reuse, no new events.
    const eventsBeforeRestart = JSON.stringify(harness.events());
    const restartCoordinator = createReviewGateCoordinator({
      eventStore: harness.eventStore,
      lockManager: createTestLockManager(),
      protocol: createReviewGateProtocolDescriptor(),
      workspaceReader: createMapReviewWorkspaceReader(harness.files),
      inspectTargets: async (paths) =>
        new Map(paths.map((path) => [path, "clean_committed" as const])),
      mutationSubstrate: {
        commitArtifact: async () => ({ commitSha: "sha-restart" }),
        restoreArtifact: async () => {},
      },
      now: () => new Date(Date.UTC(2026, 9, 8, 12, 0, 0)).toISOString(),
      newId: () => "restart-id-1",
      newWriterId: () => "restart-writer",
    });
    const reuse = await restartCoordinator.startOrResume("other-session", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(reuse.dispatched).toBe(false);
    expect(reuse.completedReuse).toBe(true);
    expect(reuse.guidance).toContain("[JUSTICE: REVIEW GATE CLEAR]");
    expect(reuse.gateId).toBe(genesis?.gateId);
    expect(JSON.stringify(harness.events())).toBe(eventsBeforeRestart);

    const projected = projectReviewGate(await harness.eventStore.readEvents(genesis?.gateId ?? ""));
    expect(projected.status).toBe("completed");
    expect(projected.phase).toBe("plan");
    expect(projected.approvalBinding).not.toBeNull();
    expect(projected.effectiveDesignClear).not.toBeNull();
    expect(JSON.stringify(projected.approvalBinding)).toBe(JSON.stringify(approvalOutcome.binding));
  });

  it("resumes a mid-flight gate from durable history alone and never re-runs the cleared Design phase", async () => {
    const harness = createFlowHarness("crash");

    const started = await harness.coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });

    // Drive the design phase with a zero-finding review, then crash before
    // the plan-phase reviewer packet is ever claimed: the plan dispatch is
    // the stop point and stays durably uncompleted.
    const drive = await driveGate(
      harness,
      "main",
      started.reviewerPrompt,
      (payload) => reviewerResult(payload, []),
      (payload) => payload.phase === "plan",
    );
    expect(drive.answeredPayloads.every((payload) => payload.phase === "design")).toBe(true);
    expect(JSON.stringify(harness.events())).toContain('"DESIGN_CLEAR"');

    harness.coordinator.releaseSession("main");

    // Simulated restart: a fresh coordinator over the SAME durable store
    // resumes in the plan phase — the cleared Design phase is never re-run.
    const restartCoordinator = createReviewGateCoordinator({
      eventStore: harness.eventStore,
      lockManager: createTestLockManager(),
      protocol: createReviewGateProtocolDescriptor(),
      workspaceReader: createMapReviewWorkspaceReader(harness.files),
      inspectTargets: async (paths) =>
        new Map(paths.map((path) => [path, "clean_committed" as const])),
      mutationSubstrate: {
        commitArtifact: async () => ({ commitSha: "sha-restart" }),
        restoreArtifact: async () => {},
      },
      now: () => new Date(Date.UTC(2026, 9, 8, 12, 0, 0)).toISOString(),
      newId: () => "restart-id-1",
      newWriterId: () => "restart-writer",
    });
    const resumed = await restartCoordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(resumed.dispatched).toBe(true);
    if (resumed.reviewerPrompt === undefined) throw new Error(resumed.guidance);
    const resumedPayload = parsePacketPayload(resumed.reviewerPrompt);
    expect(resumedPayload.phase).toBe("plan");

    // Answer the plan review: the gate completes without any new design-phase
    // finding or a second design remediation round.
    let callSerial = 0;
    let prompt: string | undefined = resumed.reviewerPrompt;
    let response: HookResponse | null = null;
    while (typeof prompt === "string") {
      callSerial += 1;
      const callId = `main-resume-call-${callSerial}`;
      await restartCoordinator.preToolUse(claimEvent("main", callId, prompt));
      const payload = parsePacketPayload(prompt);
      response = (await restartCoordinator.postToolUse(
        resultEvent("main", callId, reviewerResult(payload, [])),
      )) as HookResponse;
      prompt = nextPromptOf(response);
    }
    expect(response?.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

    const eventTypes = harness.events().map((event) => event.eventType);
    expect(eventTypes).toContain("ORCHESTRATION_RESUMED");
    // No design-phase finding was ever recorded, and the resume added none:
    // the cleared Design phase is never re-run after the restart.
    expect(
      harness.events().filter((event) => event.eventType === "FINDING_DISCOVERED"),
    ).toHaveLength(0);
    expect(eventTypes).toEqual([
      "GATE_CREATED",
      "DESIGN_CLEAR",
      "ORCHESTRATION_RESUMED",
      "PLAN_CLEAR",
      "COMPLETED_APPROVAL_BINDING",
    ]);
  });
});
