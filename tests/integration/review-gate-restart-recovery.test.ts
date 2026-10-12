import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createInMemoryReviewGateEventStore,
  createMapReviewWorkspaceReader,
} from "../helpers/review-gate-coordinator";
import {
  createReviewGateCoordinator,
  type ReviewGateMutationSubstrate,
} from "../../src/runtime/review-gate-coordinator";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  createLegacyReviewGateEventStore,
  createReviewGateEventStore,
  type ReviewGateEventStore,
  type ReviewGatePublicationResult,
} from "../../src/runtime/review-gate-event-store";
import { createLinuxReviewGateProvider } from "../../src/runtime/linux-review-gate-provider";
import {
  createReviewGateLockManager,
  type ReviewGateLockManager,
} from "../../src/runtime/review-gate-lock-manager";
import {
  authorizeFirstWorkspaceEnrollment,
  authorizeScopeEnrollment,
  createReviewGateScopeWitness,
  provisionReviewGateWitnessInstallation,
  type ReviewGateScopeWitness,
  type TrustedFirstEnrollmentV1,
} from "../../src/runtime/review-gate-scope-witness";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../../src/core/review-gate/event-schema";
import { computeCanonicalJsonFingerprint, computeWorkspaceIdentity } from "../../src/core/review-gate/identity";
import { createReviewGateGit, computeUnrelatedIndexFingerprint } from "../../src/runtime/review-gate-git";
import type { ReviewGateWorkspaceProvider } from "../../src/runtime/review-gate-git";
import { createReviewGateApprovalLookup } from "../../src/runtime/review-gate-approval";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import {
  gitModeFromOwnerExecBits,
  type ReviewRestoreDestinationBinding,
  type ReviewRestoreSourceBinding,
} from "../../src/core/review-gate/capabilities";
import { parseJusticeReviewGateCommandArguments } from "../../src/core/review-gate-command";
import { computeArtifactDigest, computeReviewScopeId } from "../../src/core/review-gate/identity";
import { evaluateNonConvergence } from "../../src/core/review-gate/convergence";
import {
  planReviewGateNextOperation,
  type ReviewGatePlanningArtifacts,
  type ReviewGatePlanningContext,
} from "../../src/core/review-gate/orchestrator";
import { projectReviewGate } from "../../src/core/review-gate/projection";
import type { ReviewGateEvent, ReviewGatePhase } from "../../src/core/review-gate-types";
import type { HookEvent, HookResponse } from "../../src/core/types";
import {
  publishVerifiedLegacyBridge,
  verifyLegacyContinuation,
  type LegacyGateSnapshot,
} from "../../src/runtime/review-gate-legacy-bridge";
import { encodeLegacyBridgeMarkerReason } from "../../src/core/review-gate/legacy-execution";


// ---------------------------------------------------------------------------
// Shared deterministic harness: in-memory durable store + fake agent runner
// ---------------------------------------------------------------------------

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const DESIGN_V1 = "# Design\nAcceptance boundary.\n";
const PLAN_V1 = "## Task 1: Verification\n- [ ] Verify the boundary\n";

type WorkspaceState = "clean_committed" | "known_dirty" | "mutation_in_flight";

function createTestLockManager() {
  const makeLock = () => ({ release: () => undefined, verifyCloexec: () => true });
  return {
    acquireScopeLock: async () => makeLock(),
    acquireGateLock: async () => makeLock(),
    close: () => undefined,
  };
}

type RecordingSubstrate = ReviewGateMutationSubstrate & {
  readonly commitCalls: () => number;
  readonly restoreCalls: () => number;
};

function createRecordingSubstrate(): RecordingSubstrate {
  let commits = 0;
  let restores = 0;
  return {
    commitArtifact: async (phase, artifactPath) => {
      commits += 1;
      return { commitSha: `sha-${commits}-${phase}-${artifactPath}` };
    },
    restoreArtifact: async () => {
      restores += 1;
    },
    commitCalls: () => commits,
    restoreCalls: () => restores,
  };
}

type RestartHarness = {
  readonly eventStore: ReturnType<typeof createInMemoryReviewGateEventStore>;
  readonly events: () => readonly ReviewGateEvent[];
  readonly files: Map<string, string>;
  readonly substrate: RecordingSubstrate;
  readonly protocol: ReturnType<typeof createReviewGateProtocolDescriptor>;
  readonly buildCoordinator: (
    prefix: string,
    overrides?: {
      readonly inspectTargets?: (paths: readonly string[]) => Promise<ReadonlyMap<string, WorkspaceState>>;
    },
  ) => ReturnType<typeof createReviewGateCoordinator>;
};

function createRestartHarness(): RestartHarness {
  const files = new Map<string, string>([
    [DESIGN_PATH, DESIGN_V1],
    [PLAN_PATH, PLAN_V1],
  ]);
  const eventStore = createInMemoryReviewGateEventStore();
  const protocol = createReviewGateProtocolDescriptor();
  const substrate = createRecordingSubstrate();
  const workspaceReader = createMapReviewWorkspaceReader(files);
  const defaultInspectTargets = async (paths: readonly string[]) => {
    const map = new Map<string, WorkspaceState>();
    for (const target of paths) {
      map.set(target, files.has(target) ? "clean_committed" : "known_dirty");
    }
    return map;
  };
  const buildCoordinator = (
    prefix: string,
    overrides?: {
      readonly inspectTargets?: (paths: readonly string[]) => Promise<ReadonlyMap<string, WorkspaceState>>;
    },
  ) => {
    let serial = 0;
    let idCounter = 0;
    return createReviewGateCoordinator({
      eventStore,
      lockManager: createTestLockManager(),
      protocol,
      workspaceReader,
      mutationSubstrate: substrate,
      inspectTargets: overrides?.inspectTargets ?? defaultInspectTargets,
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
  };
  return {
    eventStore,
    events: () => [...eventStore.gates().values()].flatMap((gate) => gate.events),
    files,
    substrate,
    protocol,
    buildCoordinator,
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

function findingValidationResult(
  payload: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): string {
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
    ...overrides,
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

/** Recurring findings: one fresh blocking candidate per design review. */
function createRecurringFindingScript(
  harness: RestartHarness,
  writeTarget: (round: number) => void = (round) => {
    harness.files.set(DESIGN_PATH, `${DESIGN_V1}<!-- remediation ${round} -->\n`);
  },
) {
  let reviewerDispatches = 0;
  return (payload: Record<string, unknown>): string => {
    switch (payload.requiredResultKind) {
      case "review_candidates": {
        reviewerDispatches += 1;
        const candidateId = `cand-${reviewerDispatches}`;
        return reviewerResult(payload, [
          {
            candidateId,
            severity: "major",
            summary: `defect ${candidateId}`,
            location: "Task 1",
          },
        ]);
      }
      case "finding_validation":
        return findingValidationResult(payload);
      case "remediation": {
        const round = (payload.remediationRound as { ordinal: number } | null)?.ordinal ?? 0;
        writeTarget(round);
        return remediationResult(payload, "COMPLETED");
      }
      case "self_review":
        return selfReviewResult(payload);
      default:
        throw new Error(`unexpected operation: ${String(payload.requiredResultKind)}`);
    }
  };
}

/**
 * The first worker packet of a start/resume: either the reviewer prompt, or
 * the injected worker prompt of a non-reviewer first dispatch (e.g. a
 * lineage revalidation) whose packet rides the guidance.
 */
function firstPromptOf(
  result: Readonly<{ readonly reviewerPrompt?: string; readonly guidance: string }>,
): string | undefined {
  if (result.reviewerPrompt !== undefined) return result.reviewerPrompt;
  return result.guidance.includes("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]")
    ? result.guidance
    : undefined;
}

async function driveFrom(
  coordinator: ReturnType<typeof createReviewGateCoordinator>,
  sessionId: string,
  initialPrompt: string | undefined,
  answer: (payload: Record<string, unknown>) => string | Promise<string>,
  shouldStop?: (payload: Record<string, unknown>) => boolean,
): Promise<HookResponse> {
  let prompt: string | undefined = initialPrompt;
  let response: HookResponse | null = null;
  let callSerial = 0;
  while (typeof prompt === "string") {
    const payload = parsePacketPayload(prompt);
    if (shouldStop?.(payload) === true) {
      return response as HookResponse;
    }
    callSerial += 1;
    const callId = `${sessionId}-call-${callSerial}`;
    await coordinator.preToolUse(claimEvent(sessionId, callId, prompt));
    response = (await coordinator.postToolUse(
      resultEvent(sessionId, callId, await answer(payload)),
    )) as HookResponse;
    prompt = nextPromptOf(response);
  }
  if (response === null) throw new Error("gate never dispatched a worker");
  return response;
}

// ---------------------------------------------------------------------------
// Durable-history seeding with the coordinator's own event vocabulary
// ---------------------------------------------------------------------------

function seedEvent(gateId: string, eventType: ReviewGateEvent["eventType"], payload: Record<string, unknown>): ReviewGateEvent {
  return Object.freeze({
    eventType,
    gateId,
    writerId: "seed-writer",
    epochId: `${gateId}-epoch`,
    emittedAt: "2026-10-07T00:00:00.000Z",
    payload: Object.freeze(payload),
  }) as ReviewGateEvent;
}

function genesisEvents(
  gateId: string,
  protocol: ReturnType<typeof createReviewGateProtocolDescriptor>,
  options: Readonly<{ readonly designClear?: boolean }> = {},
): readonly ReviewGateEvent[] {
  const designDigest = computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8"));
  const planDigest = computeArtifactDigest(Buffer.from(PLAN_V1, "utf8"));
  const events: ReviewGateEvent[] = [
    seedEvent(gateId, "GATE_CREATED", {
      reviewScopeId: computeReviewScopeId(DESIGN_PATH, PLAN_PATH),
      designArtifact: { canonicalPath: DESIGN_PATH, digest: designDigest, gitMode: "100644" },
      planArtifact: { canonicalPath: PLAN_PATH, digest: planDigest, gitMode: "100644" },
      requirementsResolution: {
        source: "auto_design_reference",
        canonicalPath: DESIGN_PATH,
        digest: designDigest,
      },
      reviewProtocolFingerprint: protocol.reviewProtocolFingerprint,
    }),
  ];
  if (options.designClear === true) {
    events.push(
      seedEvent(gateId, "DESIGN_CLEAR", {
        designProtocolFingerprint: protocol.designProtocolFingerprint,
      }),
    );
  }
  return events;
}

function discoverEvent(
  gateId: string,
  lineageSuffix: string,
  phase: ReviewGatePhase,
  ownerScope: "requirements" | "design" | "plan",
): ReviewGateEvent {
  return seedEvent(gateId, "FINDING_DISCOVERED", {
    lineageId: `${gateId}-lineage-${lineageSuffix}`,
    findingId: `seed-${lineageSuffix}`,
    observedPhase: phase,
    ownerScope,
    descriptionDigest: computeArtifactDigest(Buffer.from(`seed-${lineageSuffix}`, "utf8")),
  });
}

function remediatedEvent(
  gateId: string,
  lineageSuffix: string,
  round: { readonly phase: ReviewGatePhase; readonly ordinal: number },
): ReviewGateEvent {
  return seedEvent(gateId, "FINDING_REMEDIATED", {
    lineageId: `${gateId}-lineage-${lineageSuffix}`,
    findingId: `seed-${lineageSuffix}`,
    remediationRound: round,
  });
}

function reopenedEvent(gateId: string, lineageSuffix: string): ReviewGateEvent {
  return seedEvent(gateId, "FINDING_REOPENED", {
    lineageId: `${gateId}-lineage-${lineageSuffix}`,
    findingId: `seed-${lineageSuffix}`,
    reopenedBy: `${gateId}-epoch`,
  });
}

function suspensionEvent(
  gateId: string,
  eventType: "REVIEW_NON_CONVERGENT" | "ROUND_LIMIT_EXHAUSTED",
  payload: Record<string, unknown>,
): ReviewGateEvent {
  return seedEvent(gateId, eventType, payload);
}

// ---------------------------------------------------------------------------
// Suite A — Review Focus 1: corrupt current scope vs unrelated corrupt scope.
// The authority event store is witness-verified, so the file-backed exercises
// run against a real protected witness (Task 5) and its verified surface.
// ---------------------------------------------------------------------------

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.witness`, { recursive: true, force: true });
  }
});

async function createFileStoreRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "justice-rg-restart-"));
  tempRoots.push(root);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "genesis",
  ]);
  return root;
}

/**
 * Task 5 witness fixture for one test workspace: provisions the protected
 * installation, binds one lock manager, and returns the witness bound to an
 * absolute witness directory OUTSIDE the workspace root (the Task 5
 * protection contract rejects any witness directory inside the workspace).
 */
async function createWitnessForTest(
  root: string,
  writerId: string,
): Promise<
  Readonly<{ readonly witness: ReviewGateScopeWitness; readonly lockManager: ReviewGateLockManager }>
> {
  const admin = generateKeyPairSync("ed25519");
  const approve = async (payload: unknown): Promise<string> =>
    sign(null, Buffer.from(computeCanonicalJsonFingerprint(payload)), admin.privateKey).toString(
      "base64",
    );
  const lockManager = createReviewGateLockManager(root, {
    provider: createLinuxReviewGateProvider(root) ?? null,
  });
  const witnessDirectory = `${root}.witness`;
  await provisionReviewGateWitnessInstallation({
    witnessDirectory,
    hostTrustRoot: admin.publicKey,
    authorize: approve,
  });
  const witness = createReviewGateScopeWitness({
    workspaceRoot: root,
    workspaceIdentity: computeWorkspaceIdentity(root),
    witnessDirectory,
    hostTrustRoot: admin.publicKey,
    lockManager,
  });
  witnessApprovers.set(witness, approve);
  witnessSeedWriterIds.set(witness, writerId);
  return { witness, lockManager };
}

const witnessApprovers = new WeakMap<ReviewGateScopeWitness, (payload: unknown) => Promise<string>>();
const witnessSeedWriterIds = new WeakMap<ReviewGateScopeWitness, string>();
const witnessEnrollments = new WeakMap<ReviewGateScopeWitness, TrustedFirstEnrollmentV1>();

function closeWitnessFixture(fixtures: {
  readonly witness: ReviewGateScopeWitness;
  readonly lockManager: ReviewGateLockManager;
}): void {
  fixtures.witness.close();
  fixtures.lockManager.close();
}

function createDiskEventStore(
  root: string,
  writerId: string,
  witness: ReviewGateScopeWitness,
): ReturnType<typeof createReviewGateEventStore> {
  return createReviewGateEventStore(root, {
    workspaceIdentity: computeWorkspaceIdentity(root),
    writerId,
    witness,
  });
}

function authorityShardPath(root: string, scopeId: string, gateId: string, writerId: string): string {
  return path.join(root, ".justice", "review-gates", "events", scopeId, gateId, `${writerId}.jsonl`);
}

/**
 * Seed one Gate's events into the authority store on a real witness: the
 * first seeded Gate is the workspace's witnessed genesis, every later Gate
 * rides its own independently-authorized scope.
 */
async function seedWitnessGate(
  root: string,
  writerId: string,
  witness: ReviewGateScopeWitness,
  store: ReturnType<typeof createReviewGateEventStore>,
  gateId: string,
  scopeId: string,
  events: readonly ReviewGateEvent[],
): Promise<void> {
  const approve = witnessApprovers.get(witness);
  if (approve === undefined) throw new Error("test_witness_missing_approver");
  const trusted = witnessEnrollments.get(witness);
  if (trusted === undefined) {
    const genesis = events[0];
    if (genesis === undefined || genesis.eventType !== "GATE_CREATED") {
      throw new Error("test_seed_requires_gate_created");
    }
    const auth = await authorizeFirstWorkspaceEnrollment({
      witness,
      designPath: genesis.payload.designArtifact.canonicalPath,
      planPath: genesis.payload.planArtifact.canonicalPath,
      workflowNonce: `nonce-${gateId}`,
      operationId: `enroll-${gateId}`,
      authorize: approve,
    });
    await witness.verifyFirstWorkspaceEnrollment(auth);
    witnessEnrollments.set(witness, auth);
    const prepared = await store.prepareVerifiedEventPublication({
      scopeId,
      gateId,
      writerId,
      operationId: `seed-${gateId}`,
      canonicalEvents: events,
      firstEnrollment: {
        authorization: auth,
        generationId: "generation-1",
        workflowContinuityId: `continuity-${gateId}`,
      },
    });
    const outcome = await store.publishPreparedEvent(prepared);
    if (outcome !== "committed") throw new Error(`test_seed_publication_failed:${outcome}`);
    return;
  }

  const genesis = events[0];
  if (genesis === undefined || genesis.eventType !== "GATE_CREATED") {
    throw new Error("test_seed_requires_gate_created");
  }
  const prior = await witness.readWorkspaceScopeFrontier();
  const existing = prior.scopes.find((scope) => scope.scopeId === scopeId);
  if (existing !== undefined) {
    await store.appendEvents(gateId, events);
    return;
  }
  const designPath = genesis.payload.designArtifact.canonicalPath;
  const planPath = genesis.payload.planArtifact.canonicalPath;
  const authorized = await authorizeScopeEnrollment({
    witness,
    scope: {
      scopeId,
      workflowContinuityId: `continuity-${gateId}`,
      canonicalDesignPath: designPath,
      canonicalPlanPath: planPath,
      pathPairDigest: computeCanonicalJsonFingerprint([designPath, planPath]),
      provenance: {
        kind: "verified_independent_workflow",
        evidenceDigest: "0".repeat(64),
        priorScopeId: null,
        priorGateId: null,
      },
      gateMembership: [
        {
          gateId,
          generationId: `generation-${gateId}`,
          supersedesGateId: null,
          admissionEventId: `admission-${gateId}`,
          writerIds: [writerId],
        },
      ],
    },
    operationId: `scope-${gateId}`,
    authorize: approve,
  });
  const eventLines = events.map((event) =>
    encodeReviewGateEventRecord(validateReviewGateEventRecord(event)),
  );
  const bytes = Buffer.from(`${eventLines.join("\n")}\n`);
  const head = {
    scopeId,
    gateId,
    writerId,
    sequence: events.length,
    hash: computeArtifactDigest(bytes),
  };
  const contents = {
    workspaceIdentity: prior.workspaceIdentity,
    workspaceEnrollmentId: prior.workspaceEnrollmentId,
    scopes: [
      ...prior.scopes.filter((entry) => entry.scopeId !== scopeId),
      authorized,
    ].sort((left, right) =>
      left.scopeId < right.scopeId ? -1 : left.scopeId > right.scopeId ? 1 : 0,
    ),
    writerHeads: [...prior.writerHeads, head].sort((left, right) => {
      const key = (entry: { scopeId: string; gateId: string; writerId: string }) =>
        `${entry.scopeId}\u0000${entry.gateId}\u0000${entry.writerId}`;
      return key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0;
    }),
  };
  const globalFrontierHash = computeCanonicalJsonFingerprint(contents);
  const input = {
    installationId: (await witness.readInstallation()).installationId,
    workspaceIdentity: prior.workspaceIdentity,
    scopeId,
    gateId,
    writerId,
    operationId: `seed-${gateId}`,
    publicationId: computeCanonicalJsonFingerprint({
      scopeId,
      gateId,
      writerId,
      operationId: `seed-${gateId}`,
      newTailDigest: head.hash,
    }),
    expectedInstallationFrontier: await witness.readInstallationFrontierHash(),
    expectedGlobalFrontier: prior.globalFrontierHash,
    expectedWriterSequence: 0,
    expectedWriterHash: "0".repeat(64),
    newWriterSequence: head.sequence,
    newWriterHash: head.hash,
    canonicalShardPath: `${scopeId}/${gateId}/${writerId}.jsonl`,
    newTailLength: bytes.length,
    newTailDigest: head.hash,
    newGlobalFrontier: globalFrontierHash,
    firstEnrollmentAuthorizationId: null,
    payloadSchemaVersion: 1,
    nextFrontier: { ...contents, globalFrontierHash },
  };
  await witness.preparePublication(input, bytes);
  await witness.publishPreparedJournal(input.publicationId);
  const cas = await witness.commitPreparedPublicationCAS({
    publicationId: input.publicationId,
    expectedGlobalFrontier: prior.globalFrontierHash,
    expectedWriterHash: "0".repeat(64),
  });
  if (cas !== "advanced") throw new Error(`test_seed_cas_failed:${cas}`);
}

describe("restart recovery — corrupt scope discovery (Review Focus 1)", () => {
  it("fails closed on the corrupt current scope without creating a replacement generation", async () => {
    const root = await createFileStoreRoot();
    const fixtures = await createWitnessForTest(root, "cur-writer");
    const eventStore = createDiskEventStore(root, "cur-writer", fixtures.witness);
    const scopeId = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
    await seedWitnessGate(root, "cur-writer", fixtures.witness, eventStore, "cur-id-1", scopeId, [
      seedEvent("cur-id-1", "GATE_CREATED", {
        reviewScopeId: scopeId,
        designArtifact: {
          canonicalPath: DESIGN_PATH,
          digest: computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8")),
          gitMode: "100644",
        },
        planArtifact: {
          canonicalPath: PLAN_PATH,
          digest: computeArtifactDigest(Buffer.from(PLAN_V1, "utf8")),
          gitMode: "100644",
        },
        requirementsResolution: {
          source: "auto_design_reference",
          canonicalPath: DESIGN_PATH,
          digest: computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8")),
        },
        reviewProtocolFingerprint: createReviewGateProtocolDescriptor().reviewProtocolFingerprint,
      }),
    ].map((event) => ({ ...event, writerId: "cur-writer", gateId: "cur-id-1" }) as ReviewGateEvent));

    const gateIdsBefore = await eventStore.listGateIds();
    expect(gateIdsBefore).toEqual(["cur-id-1"]);

    // Corrupt the current scope's durable events on disk, then restart.
    eventStore.close();
    const sharded = authorityShardPath(root, scopeId, "cur-id-1", "cur-writer");
    await writeFile(sharded, "{corrupt bytes\n", "utf8");

    const restartedStore = createDiskEventStore(root, "cur-writer", fixtures.witness);
    // Fail closed: the corrupted current scope rejects reads and appends and
    // never silently mints a replacement generation or heals unknown bytes.
    await expect(restartedStore.readEvents("cur-id-1")).rejects.toThrow(
      "review_gate_witness_journal_missing_or_tampered",
    );
    await expect(
      restartedStore.appendEvents("cur-id-1", [
        {
          ...seedEvent("cur-id-1", "DESIGN_CLEAR", { designProtocolFingerprint: "restart" }),
          writerId: "cur-writer",
        } as ReviewGateEvent,
      ]),
    ).rejects.toThrow("review_gate_witness_journal_missing_or_tampered");
    expect(await restartedStore.readScopeIndex(scopeId)).toBeNull();
    // The tampered bytes are never truncated or repaired by recovery.
    const recovered = await restartedStore.recoverJournal("cur-id-1").catch(() => null);
    expect(recovered).toBeNull();
    expect(await readFile(sharded, "utf8")).toBe("{corrupt bytes\n");
    restartedStore.close();
    closeWitnessFixture(fixtures);
  });

  it("blocks the whole workspace read when any witnessed member shard is corrupt", async () => {
    const root = await createFileStoreRoot();
    const fixtures = await createWitnessForTest(root, "writer-1");
    const eventStore = createDiskEventStore(root, "writer-1", fixtures.witness);
    const protocol = createReviewGateProtocolDescriptor();
    const scopeId = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
    const corruptScopeId = computeReviewScopeId("other/docs/design.md", "other/docs/plan.md");
    await seedWitnessGate(root, "writer-1", fixtures.witness, eventStore, "gate-current", scopeId, [
      {
        eventType: "GATE_CREATED",
        gateId: "gate-current",
        writerId: "writer-1",
        epochId: "gate-current-epoch",
        emittedAt: "2026-10-08T00:00:00.000Z",
        payload: {
          reviewScopeId: scopeId,
          designArtifact: {
            canonicalPath: DESIGN_PATH,
            digest: computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8")),
            gitMode: "100644",
          },
          planArtifact: {
            canonicalPath: PLAN_PATH,
            digest: computeArtifactDigest(Buffer.from(PLAN_V1, "utf8")),
            gitMode: "100644",
          },
          requirementsResolution: {
            source: "auto_design_reference",
            canonicalPath: DESIGN_PATH,
            digest: computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8")),
          },
          reviewProtocolFingerprint: protocol.reviewProtocolFingerprint,
        },
      },
    ]);
    await seedWitnessGate(
      root,
      "writer-1",
      fixtures.witness,
      eventStore,
      "gate-unrelated",
      corruptScopeId,
      [
        {
          eventType: "GATE_CREATED",
          gateId: "gate-unrelated",
          writerId: "writer-1",
          epochId: "gate-unrelated-epoch",
          emittedAt: "2026-10-08T00:00:01.000Z",
          payload: {
            reviewScopeId: corruptScopeId,
            designArtifact: {
              canonicalPath: "other/docs/design.md",
              digest: computeArtifactDigest(Buffer.from("# Other design\n", "utf8")),
              gitMode: "100644",
            },
            planArtifact: {
              canonicalPath: "other/docs/plan.md",
              digest: computeArtifactDigest(Buffer.from("# Other plan\n", "utf8")),
              gitMode: "100644",
            },
            requirementsResolution: {
              source: "auto_design_reference",
              canonicalPath: "other/docs/design.md",
              digest: computeArtifactDigest(Buffer.from("# Other design\n", "utf8")),
            },
            reviewProtocolFingerprint: protocol.reviewProtocolFingerprint,
          },
        },
      ],
    );
    expect(await eventStore.readEvents("gate-current")).toHaveLength(1);
    expect(await eventStore.readEvents("gate-unrelated")).toHaveLength(1);
    eventStore.close();

    const corruptShard = authorityShardPath(root, corruptScopeId, "gate-unrelated", "writer-1");
    await writeFile(corruptShard, "{corrupt bytes\n", "utf8");

    const restartedStore = createDiskEventStore(root, "writer-1", fixtures.witness);
    // The witnessed frontier is workspace-wide: one tampered member shard
    // blocks every Gate read — the unrelated healthy scope is NOT exempt —
    // and the corrupt bytes are never truncated or repaired.
    await expect(restartedStore.readEvents("gate-current")).rejects.toThrow(
      "review_gate_witness_journal_missing_or_tampered",
    );
    await expect(restartedStore.readEvents("gate-unrelated")).rejects.toThrow(
      "review_gate_witness_journal_missing_or_tampered",
    );
    expect(await readFile(corruptShard, "utf8")).toBe("{corrupt bytes\n");
    restartedStore.close();
    closeWitnessFixture(fixtures);
  });
});

// ---------------------------------------------------------------------------
// Suite B — Review Focus 2: unknown partial bytes are never overwritten
// ---------------------------------------------------------------------------

describe("restart recovery — unknown partial remediation (Review Focus 2)", () => {
  it("suspends a crashed uncompleted remediation dispatch and never touches the worktree bytes", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("crash");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);

    // Reviewer → validator complete; the remediation worker is dispatched
    // (durable, uncompleted) and the process "crashes" before its result.
    let callSerial = 0;
    let prompt: string | undefined = started.reviewerPrompt;
    let crashed = false;
    while (typeof prompt === "string") {
      const payload = parsePacketPayload(prompt);
      if (payload.requiredResultKind === "remediation") {
        crashed = true;
        break;
      }
      callSerial += 1;
      const callId = `main-call-${callSerial}`;
      await coordinator.preToolUse(claimEvent("main", callId, prompt));
      const answer =
        payload.requiredResultKind === "review_candidates"
          ? reviewerResult(payload, [
              { candidateId: "cand-1", severity: "major", summary: "defect", location: "Task 1" },
            ])
          : findingValidationResult(payload);
      const response = (await coordinator.postToolUse(
        resultEvent("main", callId, answer),
      )) as HookResponse;
      prompt = nextPromptOf(response);
    }
    if (!crashed) throw new Error("the remediation dispatch was never reached");
    coordinator.releaseSession("main");

    const gateIds = await harness.eventStore.listGateIds();
    const gateId = gateIds[0];
    if (gateId === undefined) throw new Error("no gate");
    const dispatches = await harness.eventStore.listDispatches(gateId);
    expect(
      dispatches.filter((record) => record.completedAt === null).map((record) => record.operation),
    ).toContain("remediation");

    const bytesBefore = harness.files.get(DESIGN_PATH);
    const restartCoordinator = harness.buildCoordinator("restart");
    const resumed = await restartCoordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    // The uncompleted remediation dispatch is not reconstructable: the gate
    // suspends with a typed reason instead of re-driving the mutation.
    expect(resumed.dispatched).toBe(false);
    expect(resumed.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(JSON.stringify(harness.events())).toContain('"REDISPATCH_EVIDENCE_UNAVAILABLE"');
    // The worktree bytes are exactly what they were: Justice never overwrote,
    // restored, or chmod'ed the partially remediated target.
    expect(harness.files.get(DESIGN_PATH)).toBe(bytesBefore);
    expect(harness.substrate.restoreCalls()).toBe(0);
    expect(harness.substrate.commitCalls()).toBe(0);
  });

  it("blocks a restarted gate on an externally drifted target and leaves the unknown bytes intact", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("drift");
    await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    coordinator.releaseSession("main");

    // An external process replaces the Design with unknown partial bytes.
    const unknownBytes = "# Design\nunknown partial remediation bytes\n";
    harness.files.set(DESIGN_PATH, unknownBytes);
    const genesisDesignDigest = computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8"));

    const restartCoordinator = harness.buildCoordinator("restart", {
      // WSP1 probe: a target is only clean when its current digest still
      // equals the durable admission digest.
      inspectTargets: async (paths) => {
        const map = new Map<string, WorkspaceState>();
        for (const target of paths) {
          const bytes = harness.files.get(target);
          const digest =
            bytes === undefined ? null : computeArtifactDigest(Buffer.from(bytes, "utf8"));
          map.set(
            target,
            target === DESIGN_PATH && digest !== genesisDesignDigest ? "known_dirty" : "clean_committed",
          );
        }
        return map;
      },
    });
    const restarted = await restartCoordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    // Binding drift fail-closed: no gate is dispatched against unknown bytes,
    // and Justice never restores, overwrites, or chmod's the target.
    expect(restarted.dispatched).toBe(false);
    expect(restarted.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(harness.files.get(DESIGN_PATH)).toBe(unknownBytes);
    expect(harness.substrate.restoreCalls()).toBe(0);
    expect(harness.substrate.commitCalls()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite C — Review Focus 3: NC1 vs absolute rounds, N1 guard, absolute limits
// ---------------------------------------------------------------------------

describe("restart recovery — NC1 vs absolute rounds (Review Focus 3)", () => {
  it("appends REVIEW_NON_CONVERGENT through a coordinator restart when a trigger fires at zero design capacity", async () => {
    const harness = createRestartHarness();
    const gateId = "nc1-zero-gate";
    await harness.eventStore.appendEvents(gateId, [
      ...genesisEvents(gateId, harness.protocol),
      discoverEvent(gateId, "a", "design", "design"),
      ...[1, 2, 3, 4, 5].map((ordinal) => remediatedEvent(gateId, "a", { phase: "design", ordinal })),
      discoverEvent(gateId, "b", "design", "design"),
    ]);
    await harness.eventStore.writeScopeIndex(computeReviewScopeId(DESIGN_PATH, PLAN_PATH), gateId);

    const coordinator = harness.buildCoordinator("resume");
    const resumed = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    // Pending revalidation (RV1) is dispatched before the disposition seam;
    // its resolution closes the revalidated lineage's OWN round — never a
    // newly minted Design round 6 — and only then does NC1 suspend the gate.
    const blocked = await driveFrom(
      coordinator,
      "main",
      firstPromptOf(resumed),
      (payload) =>
        JSON.stringify({
          schemaVersion: 1,
          operationId: payload.operationId,
          gateId: payload.gateId,
          phase: payload.phase,
          reviewAttemptId: payload.reviewAttemptId,
          remediationRound: payload.remediationRound,
          lineageId: payload.lineageId,
          result: "RESOLVED",
        }),
    );
    expect(blocked.injectedContext).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(blocked.injectedContext).toContain("review_non_convergent");
    const suspension = harness
      .events()
      .find((event): event is Extract<ReviewGateEvent, { eventType: "REVIEW_NON_CONVERGENT" }> =>
        event.eventType === "REVIEW_NON_CONVERGENT",
      );
    expect(suspension?.payload.phase).toBe("design");
    const projected = projectReviewGate(await harness.eventStore.readEvents(gateId));
    expect(projected.designRemediationRounds.map((round) => round.ordinal)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(evaluateNonConvergence(projected)).toMatchObject({
      kind: "non_convergent",
      trigger: "blocker_landscape_repeated",
    });
    // A second restart re-opens the orchestration (ORCHESTRATION_RESUMED) but
    // appends no second suspension and no further rounds: the NC1 suspension
    // is durable and the gate stays blocked.
    const eventsBeforeSecondResume = harness
      .events()
      .map((event) => event.eventType);
    await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(harness.events().map((event) => event.eventType)).toEqual([
      ...eventsBeforeSecondResume,
      "ORCHESTRATION_RESUMED",
    ]);
  });

  it("completes a clean gate after all five design remediation rounds were used", async () => {
    const harness = createRestartHarness();
    const gateId = "limit-zero-gate";
    await harness.eventStore.appendEvents(gateId, [
      ...genesisEvents(gateId, harness.protocol),
      ...[1, 2, 3, 4, 5].flatMap((ordinal) => {
        const lineage = `round-${ordinal}`;
        return [
          discoverEvent(gateId, lineage, "design", "design"),
          remediatedEvent(gateId, lineage, { phase: "design", ordinal }),
          seedEvent(gateId, "FINDING_SELF_REVIEWED", {
            lineageId: `${gateId}-lineage-${lineage}`,
            findingId: `seed-${lineage}`,
            remediationRound: { phase: "design", ordinal },
          }),
        ];
      }),
    ]);
    await harness.eventStore.writeScopeIndex(computeReviewScopeId(DESIGN_PATH, PLAN_PATH), gateId);

    const coordinator = harness.buildCoordinator("resume");
    const resumed = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(resumed.dispatched).toBe(true);
    if (resumed.reviewerPrompt === undefined) throw new Error(resumed.guidance);
    const response = await driveFrom(
      coordinator,
      "main",
      resumed.reviewerPrompt,
      (payload) => reviewerResult(payload, []),
    );
    if (response.action !== "inject") throw new Error("expected round-limit guidance");
    expect(response.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");
    const projected = projectReviewGate(await harness.eventStore.readEvents(gateId));
    expect(projected.status).toBe("completed");
    expect(projected.suspensionReason).toBeNull();
    expect(projected.designRemediationRounds).toHaveLength(5);
    expect(evaluateNonConvergence(projected).kind).toBe("convergent");
    expect(harness.events().some((event) => event.eventType === "ROUND_LIMIT_EXHAUSTED")).toBe(false);
  });

  it("records REVIEW_NON_CONVERGENT end to end while design capacity is still positive", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("live");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);
    // Two full remediation rounds, then a fresh blocker: the blocker
    // landscape repeats the previous round's fingerprint → NC1 while three
    // design rounds are still nominally remaining. The recurring script
    // answers every review with one new candidate, so the drive ends when
    // the disposition suspends the gate (no next worker prompt).
    const response = await driveFrom(
      coordinator,
      "main",
      started.reviewerPrompt,
      createRecurringFindingScript(harness),
    );
    expect(response.injectedContext).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    const gateIds = await harness.eventStore.listGateIds();
    const gateId = gateIds[0];
    if (gateId === undefined) throw new Error("no gate");
    const projected = projectReviewGate(await harness.eventStore.readEvents(gateId));
    expect(projected.designRemediationRounds.map((round) => round.ordinal)).toEqual([1, 2]);
    expect(projected.suspensionReason).toBe("review_non_convergent");
    expect(evaluateNonConvergence(projected)).toMatchObject({
      kind: "non_convergent",
      trigger: "blocker_landscape_repeated",
    });
  });

  it("pins the event-reachable NC1 triggers, their priority order, and the N1 material-progress guard", async () => {
    const harness = createRestartHarness();

    // Trigger 2 (REMEDIATION_OSCILLATION): a blocker reopened from a round
    // that is not the latest (lineage-a's last remediation is round 1).
    const oscillation = projectReviewGate([
      ...genesisEvents("t-osc", harness.protocol),
      discoverEvent("t-osc", "a", "design", "design"),
      remediatedEvent("t-osc", "a", { phase: "design", ordinal: 1 }),
      discoverEvent("t-osc", "b", "design", "design"),
      remediatedEvent("t-osc", "b", { phase: "design", ordinal: 2 }),
      reopenedEvent("t-osc", "a"),
    ]);
    expect(evaluateNonConvergence(oscillation)).toMatchObject({
      kind: "non_convergent",
      trigger: "remediation_oscillation",
    });

    // Trigger 5 (BLOCKER_LANDSCAPE_REPEATED): a fresh open blocker while at
    // least two rounds exist.
    const landscape = projectReviewGate([
      ...genesisEvents("t-land", harness.protocol),
      discoverEvent("t-land", "a", "design", "design"),
      remediatedEvent("t-land", "a", { phase: "design", ordinal: 1 }),
      remediatedEvent("t-land", "a", { phase: "design", ordinal: 2 }),
      discoverEvent("t-land", "b", "design", "design"),
    ]);
    expect(evaluateNonConvergence(landscape)).toMatchObject({
      kind: "non_convergent",
      trigger: "blocker_landscape_repeated",
    });

    const count = projectReviewGate([
      ...genesisEvents("t-count", harness.protocol),
      discoverEvent("t-count", "a", "design", "design"),
      remediatedEvent("t-count", "a", { phase: "design", ordinal: 1 }),
      remediatedEvent("t-count", "a", { phase: "design", ordinal: 2 }),
      reopenedEvent("t-count", "a"),
      discoverEvent("t-count", "b", "design", "design"),
    ]);
    expect(evaluateNonConvergence(count)).toMatchObject({
      kind: "non_convergent",
      trigger: "same_lineage_stall",
    });

    // Priority: oscillation outranks the landscape/count triggers when the
    // conditions coexist.
    const combined = projectReviewGate([
      ...genesisEvents("t-prio", harness.protocol),
      discoverEvent("t-prio", "a", "design", "design"),
      remediatedEvent("t-prio", "a", { phase: "design", ordinal: 1 }),
      discoverEvent("t-prio", "b", "design", "design"),
      remediatedEvent("t-prio", "b", { phase: "design", ordinal: 2 }),
      reopenedEvent("t-prio", "a"),
      discoverEvent("t-prio", "c", "design", "design"),
    ]);
    expect(evaluateNonConvergence(combined)).toMatchObject({
      kind: "non_convergent",
      trigger: "remediation_oscillation",
    });

    const seamStubbed = projectReviewGate([
      ...genesisEvents("t-seam", harness.protocol),
      discoverEvent("t-seam", "a", "design", "design"),
      remediatedEvent("t-seam", "a", { phase: "design", ordinal: 1 }),
      remediatedEvent("t-seam", "a", { phase: "design", ordinal: 2 }),
      reopenedEvent("t-seam", "a"),
    ]);
    expect(evaluateNonConvergence(seamStubbed)).toMatchObject({
      kind: "non_convergent",
      trigger: "same_lineage_stall",
    });

    // N1 material-progress guard on a durably suspended NC1 projection: the
    // reentry validation is planned only when material progress was observed.
    const suspendedGateId = "t-n1";
    await harness.eventStore.appendEvents(suspendedGateId, [
      ...genesisEvents(suspendedGateId, harness.protocol),
      discoverEvent(suspendedGateId, "a", "design", "design"),
      remediatedEvent(suspendedGateId, "a", { phase: "design", ordinal: 1 }),
      remediatedEvent(suspendedGateId, "a", { phase: "design", ordinal: 2 }),
      discoverEvent(suspendedGateId, "b", "design", "design"),
      suspensionEvent(suspendedGateId, "REVIEW_NON_CONVERGENT", {
        phase: "design",
        lineageIds: [`${suspendedGateId}-lineage-b`],
      }),
    ]);
    const suspended = projectReviewGate(await harness.eventStore.readEvents(suspendedGateId));
    expect(suspended.status).toBe("suspended");
    expect(
      planReviewGateNextOperation(suspended, planningContextFor(harness, suspended)).kind,
    ).toBe("suspended");
    expect(
      planReviewGateNextOperation(
        suspended,
        planningContextFor(harness, suspended, { materialProgressObserved: true }),
      ).kind,
    ).toBe("validate_non_convergence_reentry");
  });

  it("never creates a Design round 6 or a Plan round 4 on any restart path", async () => {
    const harness = createRestartHarness();

    // Plan absolute limit: three recorded plan rounds + a fresh blocker.
    const planGateId = "plan-limit-gate";
    await harness.eventStore.appendEvents(planGateId, [
      ...genesisEvents(planGateId, harness.protocol, { designClear: true }),
      discoverEvent(planGateId, "a", "plan", "plan"),
      ...[1, 2, 3].map((ordinal) => remediatedEvent(planGateId, "a", { phase: "plan", ordinal })),
      discoverEvent(planGateId, "b", "plan", "plan"),
    ]);
    await harness.eventStore.writeScopeIndex(computeReviewScopeId(DESIGN_PATH, PLAN_PATH), planGateId);
    const coordinator = harness.buildCoordinator("plan-resume");
    const resumed = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    // Pending plan-phase revalidation is dispatched first (RV1 precedence);
    // its resolution records the revalidated round, never a new Plan round 4.
    const blocked = await driveFrom(
      coordinator,
      "main",
      firstPromptOf(resumed),
      (payload) =>
        JSON.stringify({
          schemaVersion: 1,
          operationId: payload.operationId,
          gateId: payload.gateId,
          phase: payload.phase,
          reviewAttemptId: payload.reviewAttemptId,
          remediationRound: payload.remediationRound,
          lineageId: payload.lineageId,
          result: "RESOLVED",
        }),
    );
    expect(blocked.injectedContext).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    const planProjection = projectReviewGate(await harness.eventStore.readEvents(planGateId));
    expect(planProjection.planRemediationRounds.map((round) => round.ordinal)).toEqual([1, 2, 3]);
    expect(planProjection.suspensionReason).toBe("review_non_convergent");
    // No Plan round 4 through the planner, with or without material progress.
    for (const materialProgress of [false, true]) {
      const operation = planReviewGateNextOperation(
        planProjection,
        planningContextFor(harness, planProjection, { materialProgressObserved: materialProgress }),
      );
      expect(operation.kind).not.toBe("start_remediation");
      expect(operation.kind).not.toBe("recover_remediation");
    }

    // The zero-capacity Design history never plans round 6 either.
    const designProjection = projectReviewGate([
      ...genesisEvents("design-limit-gate", harness.protocol),
      discoverEvent("design-limit-gate", "a", "design", "design"),
      ...[1, 2, 3, 4, 5].map((ordinal) =>
        remediatedEvent("design-limit-gate", "a", { phase: "design", ordinal }),
      ),
      discoverEvent("design-limit-gate", "b", "design", "design"),
    ]);
    for (const materialProgress of [false, true]) {
      const operation = planReviewGateNextOperation(
        designProjection,
        planningContextFor(harness, designProjection, { materialProgressObserved: materialProgress }),
      );
      expect(operation.kind).not.toBe("start_remediation");
      expect(operation.kind).not.toBe("recover_remediation");
    }
  });
});


function planningContextFor(
  harness: RestartHarness,
  projected: ReturnType<typeof projectReviewGate>,
  overrides?: { readonly materialProgressObserved?: boolean },
): ReviewGatePlanningContext {
  const artifacts: ReviewGatePlanningArtifacts = {
    design: {
      canonicalPath: DESIGN_PATH,
      digest: computeArtifactDigest(Buffer.from(DESIGN_V1, "utf8")),
      gitMode: "100644",
    },
    plan: {
      canonicalPath: PLAN_PATH,
      digest: computeArtifactDigest(Buffer.from(PLAN_V1, "utf8")),
      gitMode: "100644",
    },
  };
  return {
    artifacts,
    workspaceStates: projected.workspaceStates,
    ...(overrides?.materialProgressObserved === undefined
      ? {}
      : { materialProgressObserved: overrides.materialProgressObserved }),
    designClearFingerprint: harness.protocol.designProtocolFingerprint,
  };
}


// ---------------------------------------------------------------------------
// Suite D — reopen / invalidation / protocol-change semantics
// ---------------------------------------------------------------------------

describe("restart recovery — reopen, invalidation, and protocol change", () => {
  it("reopens the Design phase when a Plan finding is Design-owned and the Design target is dirty", async () => {
    const harness = createRestartHarness();
    let designDirty = false;
    const coordinator = harness.buildCoordinator("reopen", {
      inspectTargets: async (paths) => {
        const map = new Map<string, WorkspaceState>();
        for (const target of paths) {
          map.set(target, target === DESIGN_PATH && designDirty ? "known_dirty" : "clean_committed");
        }
        return map;
      },
    });
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);

    // The design phase clears with a zero-finding review; the drive stops at
    // the plan-phase reviewer packet so the finding is delivered with the
    // Design target already dirty.
    const designResult = await driveFrom(
      coordinator,
      "main",
      started.reviewerPrompt,
      (payload) => reviewerResult(payload, []),
      (payload) =>
        payload.requiredResultKind === "review_candidates" && payload.phase === "plan",
    );
    if (nextPromptOf(designResult) === undefined) {
      throw new Error("plan review was never dispatched");
    }
    coordinator.releaseSession("main");

    // The Design target turns dirty across the restart: the resumed session
    // re-probes the workspace, so the upstream reopen routes through the
    // exact restore before the reopen is appended.
    designDirty = true;
    const restartCoordinator = harness.buildCoordinator("reopen-restart", {
      inspectTargets: async (paths) => {
        const map = new Map<string, WorkspaceState>();
        for (const target of paths) {
          map.set(target, target === DESIGN_PATH && designDirty ? "known_dirty" : "clean_committed");
        }
        return map;
      },
    });
    const resumed = await restartCoordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const final = await driveFrom(restartCoordinator, "main", firstPromptOf(resumed), (payload) => {
      if (payload.requiredResultKind === "review_candidates") {
        return reviewerResult(payload, [
          {
            candidateId: "cand-design",
            severity: "major",
            summary: "design defect",
            location: "Design",
          },
        ]);
      }
      if (payload.requiredResultKind === "finding_validation") {
        return findingValidationResult(payload, {
          semanticBasis: {
            violationType: "DESIGN_CONTRACT",
            governingReference: "design.md#boundary",
            semanticLocation: "Design",
            violatedContract: "boundary",
            ownerScope: "design",
          },
        });
      }
      throw new Error(`unexpected operation: ${String(payload.requiredResultKind)}`);
    });
    expect(final.injectedContext).toContain("[JUSTICE: REVIEW GATE BLOCKED]");

    const reopen = harness
      .events()
      .find((event): event is Extract<ReviewGateEvent, { eventType: "REOPEN_REQUIRED" }> =>
        event.eventType === "REOPEN_REQUIRED",
      );
    expect(reopen).toBeDefined();
    expect(reopen?.payload.phase).toBe("design");
    expect(reopen?.payload.lineageIds.length).toBeGreaterThan(0);
    expect(harness.substrate.restoreCalls()).toBe(1);
    expect(harness.substrate.commitCalls()).toBe(0);
    const projected = projectReviewGate(
      await harness.eventStore.readEvents(await firstGateId(harness)),
    );
    expect(projected.suspensionReason).toBe("reopen_required");
  });

  it("reopens through OSC1 when a Design finding is Requirements-owned", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("req");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);

    let prompt: string | undefined = started.reviewerPrompt;
    let callSerial = 0;
    while (typeof prompt === "string") {
      const payload = parsePacketPayload(prompt);
      callSerial += 1;
      const callId = `main-call-${callSerial}`;
      await coordinator.preToolUse(claimEvent("main", callId, prompt));
      let answer: string;
      if (payload.requiredResultKind === "review_candidates") {
        answer = reviewerResult(payload, [
          { candidateId: "cand-req", severity: "major", summary: "requirements defect", location: "Requirements" },
        ]);
      } else if (payload.requiredResultKind === "finding_validation") {
        answer = findingValidationResult(payload, {
          semanticBasis: {
            violationType: "REQUIREMENTS_CONTRACT",
            governingReference: "requirements.md#goal",
            semanticLocation: "Goal",
            violatedContract: "goal",
            ownerScope: "requirements",
          },
        });
      } else if (payload.requiredResultKind === "remediation") {
        throw new Error("requirements-owned blockers must never reach design remediation");
      } else {
        throw new Error(`unexpected operation: ${String(payload.requiredResultKind)}`);
      }
      prompt = nextPromptOf(
        (await coordinator.postToolUse(resultEvent("main", callId, answer))) as HookResponse,
      );
    }

    const reopen = harness
      .events()
      .find((event): event is Extract<ReviewGateEvent, { eventType: "REOPEN_REQUIRED" }> =>
        event.eventType === "REOPEN_REQUIRED",
      );
    expect(reopen?.payload.phase).toBe("design");
    expect(harness.substrate.restoreCalls()).toBe(0);
    expect(harness.substrate.commitCalls()).toBe(0);
    const projected = projectReviewGate(await harness.eventStore.readEvents(await firstGateId(harness)));
    expect(projected.suspensionReason).toBe("reopen_required");
    const requirementsFinding = [...projected.findings.values()].find(
      (finding) => finding.ownerScope === "requirements",
    );
    expect(requirementsFinding).toBeDefined();
  });

  it("starts a fresh generation when Requirements/Design bytes change and never mutates the completed gate", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("gen");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const cleared = await driveFrom(
      coordinator,
      "main",
      started.reviewerPrompt,
      (payload) => reviewerResult(payload, []),
    );
    expect(cleared.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");
    const completedGateId = await firstGateId(harness);
    const eventsBefore = JSON.stringify(harness.events());

    // A Design change invalidates the completed progress: the durable
    // generation is never mutated, and the next start creates a fresh
    // generation pinned to the new digest.
    harness.files.set(DESIGN_PATH, "# Design\nrevised boundary.\n");
    const next = await coordinator.startOrResume("other", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(next.dispatched).toBe(true);
    expect(next.gateId).not.toBe(completedGateId);
    expect(next.designDigest).toBe(computeArtifactDigest(Buffer.from("# Design\nrevised boundary.\n", "utf8")));
    const genesisOfOldGate = harness
      .events()
      .filter((event) => event.gateId === completedGateId);
    expect(genesisOfOldGate.at(-1)?.eventType).toBe("COMPLETED_APPROVAL_BINDING");
    expect(JSON.stringify(harness.events().filter((event) => event.gateId === completedGateId))).toBe(
      JSON.stringify(
        (JSON.parse(eventsBefore) as ReviewGateEvent[]).filter(
          (event) => event.gateId === completedGateId,
        ),
      ),
    );
  });

  it("parses an explicit --requirements path but never re-runs RR1 auto-resolution", async () => {
    // Design §10.2.1: the parser accepts an optional explicit Requirements
    // selector; a persisted resolution stays immutable across a resume and is
    // never silently replaced (the coordinator below still pins the genesis
    // auto design reference in this task).
    expect(
      parseJusticeReviewGateCommandArguments(
        `--design ${DESIGN_PATH} --plan ${PLAN_PATH} --requirements other/requirements.md`,
      ),
    ).toEqual({
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      requirementsPath: "other/requirements.md",
    });

    // The Requirements identity is pinned once by the durable genesis and
    // stays the auto design reference across a resume.
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("rr1");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    await driveFrom(coordinator, "main", started.reviewerPrompt, (payload) =>
      reviewerResult(payload, []),
    );
    const genesis = harness
      .events()
      .find((event): event is Extract<ReviewGateEvent, { eventType: "GATE_CREATED" }> =>
        event.eventType === "GATE_CREATED",
      );
    expect(genesis?.payload.requirementsResolution.source).toBe("auto_design_reference");
    expect(genesis?.payload.requirementsResolution.canonicalPath).toBe(DESIGN_PATH);

    coordinator.releaseSession("main");
    const restarted = harness.buildCoordinator("rr1-restart");
    await restarted.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const genesisEvents = harness
      .events()
      .filter((event) => event.eventType === "GATE_CREATED");
    expect(genesisEvents).toHaveLength(1);
    expect(genesisEvents[0]?.payload.requirementsResolution.source).toBe("auto_design_reference");
  });

  it("keeps a plan-only change from silently reusing the completed generation", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("plan-drift");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    const cleared = await driveFrom(
      coordinator,
      "main",
      started.reviewerPrompt,
      (payload) => reviewerResult(payload, []),
    );
    expect(cleared.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");
    const completedGateId = await firstGateId(harness);
    const completedEvents = JSON.stringify(
      harness.events().filter((event) => event.gateId === completedGateId),
    );

    // Plan-only drift: the completed generation (including its Design clear
    // authority) stays intact in durable history, and no silent reuse or
    // re-approval happens — a fresh generation is created instead.
    harness.files.set(PLAN_PATH, "## Task 1: Verification\n- [ ] drifted work\n");
    const next = await coordinator.startOrResume("other", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    expect(next.dispatched).toBe(true);
    expect(next.gateId).not.toBe(completedGateId);
    expect(JSON.stringify(harness.events().filter((event) => event.gateId === completedGateId))).toBe(
      completedEvents,
    );
    const approval = createReviewGateApprovalLookup({
      eventStore: harness.eventStore,
      workspaceReader: createMapReviewWorkspaceReader(harness.files),
      protocol: harness.protocol,
    });
    expect(await approval.findCurrentCompletedApproval(PLAN_PATH)).toMatchObject({
      kind: "not_approved",
    });
  });

  it("prevents completed binding reuse when the review protocol fingerprint changes", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("proto");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    await driveFrom(coordinator, "main", started.reviewerPrompt, (payload) =>
      reviewerResult(payload, []),
    );
    const gateId = await firstGateId(harness);

    // A cross-phase protocol change keeps the durable lineage queryable but
    // the completed binding is no longer reusable for implementation.
    const changedProtocol = {
      ...harness.protocol,
      reviewProtocolFingerprint: "changed-cross-phase-fingerprint",
    };
    const approval = createReviewGateApprovalLookup({
      eventStore: harness.eventStore,
      workspaceReader: createMapReviewWorkspaceReader(harness.files),
      protocol: changedProtocol,
    });
    expect(await approval.findCurrentCompletedApproval(PLAN_PATH)).toMatchObject({
      kind: "not_approved",
    });
    const projected = projectReviewGate(await harness.eventStore.readEvents(gateId));
    expect(projected.status).toBe("completed");
    expect(projected.effectiveDesignClear).not.toBeNull();
    expect([...projected.findings.values()]).toHaveLength(0);
  });
});

async function firstGateId(harness: RestartHarness): Promise<string> {
  const gateIds = await harness.eventStore.listGateIds();
  const gateId = gateIds[0];
  if (gateId === undefined) throw new Error("no gate");
  return gateId;
}

// ---------------------------------------------------------------------------
// Suite E — Review Focus 4-7: real-Git lifecycle
// ---------------------------------------------------------------------------

function runGitCli(root: string, args: readonly string[], input?: string): string {
  const result = spawnSync("git", args, {
    cwd: root,
    shell: false,
    encoding: "buffer",
    input: input === undefined ? undefined : Buffer.from(input, "utf8"),
  });
  if (result.status !== 0 || result.error != null) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString("utf8");
}

type FsProvider = ReviewGateWorkspaceProvider & {
  readonly replaceCalls: () => number;
};

/**
 * Real-fs semantics for the Task 1 native replace seam: byte-exact
 * replacement that inherits the target's existing non-Git POSIX bits and
 * pins the owner execute bit to the replacement's Git mode.
 */
function createFsProvider(root: string): FsProvider {
  let counter = 0;
  let calls = 0;
  return {
    async readWorkspaceFile(relativePath: string): Promise<Buffer | null> {
      try {
        return await readFile(path.join(root, relativePath));
      } catch {
        return null;
      }
    },
    async replaceWorkspaceFileExact(
      relativePath: string,
      expectedCurrent: Readonly<{ readonly digest: string; readonly gitMode: "100644" | "100755" }>,
      replacement: Readonly<{ readonly bytes: Buffer; readonly gitMode: "100644" | "100755" }>,
    ): Promise<void> {
      calls += 1;
      const absolute = path.join(root, relativePath);
      const current = await readFile(absolute);
      if (computeArtifactDigest(current) !== expectedCurrent.digest) {
        throw new Error("provider_expectation_conflict");
      }
      const currentStat = await stat(absolute);
      const preserved = currentStat.mode & 0o7777;
      const execClass = replacement.gitMode === "100755" ? 0o100 : 0;
      const nextMode = (preserved & ~0o100) | execClass;
      counter += 1;
      const tmp = `${absolute}.justice-restore-${counter}`;
      await writeFile(tmp, replacement.bytes);
      await chmod(tmp, nextMode);
      await rm(tmp, { force: true });
      await writeFile(absolute, replacement.bytes);
      await chmod(absolute, nextMode);
    },
    replaceCalls: () => calls,
  };
}

type GitFixture = {
  readonly root: string;
  readonly target: string;
  readonly provider: FsProvider;
  readonly git: ReturnType<typeof createReviewGateGit>;
};

async function initGitFixture(
  target: string,
  targetBytes: string,
  options: Readonly<{ readonly targetMode?: number }> = {},
): Promise<GitFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "justice-rg-lifecycle-"));
  tempRoots.push(root);
  await runGitCli(root, ["init", "-q"]);
  await runGitCli(root, ["config", "user.name", "Justice Test"]);
  await runGitCli(root, ["config", "user.email", "justice@example.invalid"]);
  await runGitCli(root, ["config", "commit.gpgsign", "false"]);
  await mkdir(path.join(root, path.posix.dirname(target)), { recursive: true });
  await writeFile(path.join(root, target), targetBytes, { mode: options.targetMode ?? 0o644 });
  await writeFile(path.join(root, "requirements.md"), "requirements v1\n");
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs/a.md"), "a v1\n");
  await writeFile(path.join(root, "docs/b.md"), "b v1\n");
  // The Plan target is committed clean so gate admission sees HEAD+index+
  // worktree identity for both phase artifacts.
  await writeFile(path.join(root, "docs/plan.md"), "## Task 1\n- [ ] Verify\n");
  await runGitCli(root, ["add", "-A"]);
  await runGitCli(root, ["commit", "-q", "--no-gpg-sign", "-m", "init"]);
  const provider = createFsProvider(root);
  const git = createReviewGateGit({ rootDir: root, provider });
  return { root, target, provider, git };
}

function gitInspectTargets(
  fixture: GitFixture,
): (paths: readonly string[]) => Promise<ReadonlyMap<string, WorkspaceState>> {
  return async (paths) => {
    const map = new Map<string, WorkspaceState>();
    for (const target of paths) {
      const binding = await fixture.git.inspectTarget(target);
      map.set(target, fixture.git.classifyTargetClean(binding) === "clean" ? "clean_committed" : "known_dirty");
    }
    return map;
  };
}

function createGitSubstrate(
  fixture: GitFixture,
  session: string,
): ReviewGateMutationSubstrate & { readonly commitCalls: () => number; readonly restoreCalls: () => number } {
  let commits = 0;
  let restores = 0;
  return {
    async commitArtifact(phase: ReviewGatePhase, artifactPath: string) {
      commits += 1;
      const binding = await fixture.git.inspectTarget(artifactPath);
      if (
        binding.headSha === null ||
        binding.headEntry === null ||
        binding.indexEntry === null ||
        binding.worktree === null
      ) {
        throw new Error("commit target is not inspectable");
      }
      const prepared = await fixture.git.prepareCommit({
        gateId: session,
        operationId: `${session}-commit-${commits}`,
        phase,
        targetCanonicalPath: artifactPath,
        allowedCommitTargetPath: artifactPath,
        remediationRound: 0,
        lineageIds: [],
        expectedArtifactDigest: binding.worktree.digest,
        expectedGitMode: binding.headEntry.gitMode,
      });
      const verified = await fixture.git.executePreparedCommit(prepared);
      return { commitSha: verified.commitId };
    },
    async restoreArtifact(targetPath: string) {
      restores += 1;
      const binding = await fixture.git.inspectTarget(targetPath);
      if (
        binding.headSha === null ||
        binding.headEntry === null ||
        binding.indexEntry === null ||
        binding.headBlobDigest === null ||
        binding.worktree === null ||
        binding.indexConflicted
      ) {
        throw new Error("restore target is not inspectable");
      }
      const source: ReviewRestoreSourceBinding = {
        headSha: binding.headSha,
        headEntry: binding.headEntry,
        indexEntry: binding.indexEntry,
        worktree: binding.worktree,
        sourceEventId: `${session}-restore-${restores}`,
      };
      const destination: ReviewRestoreDestinationBinding = {
        headSha: binding.headSha,
        headEntry: binding.headEntry,
        indexEntry: binding.indexEntry,
        worktree: {
          canonicalPath: targetPath,
          digest: binding.headBlobDigest,
          gitMode: binding.headEntry.gitMode,
        },
      };
      const prepared = await fixture.git.prepareRestore({
        gateId: session,
        operationId: `${session}-restore-${restores}`,
        phase: "design",
        targetCanonicalPath: targetPath,
        allowedRestoreTargetPath: targetPath,
        sourceKnownDirtyBinding: source,
        targetCleanCommittedBinding: destination,
      });
      await fixture.git.executePreparedRestore(prepared);
    },
    commitCalls: () => commits,
    restoreCalls: () => restores,
  };
}

function buildGitCoordinator(fixture: GitFixture, prefix: string) {
  let serial = 0;
  let idCounter = 0;
  return createReviewGateCoordinator({
    eventStore: createInMemoryReviewGateEventStore(),
    lockManager: createTestLockManager(),
    protocol: createReviewGateProtocolDescriptor(),
    workspaceReader: {
      readWorkspaceFile: (relativePath) => fixture.provider.readWorkspaceFile(relativePath),
    },
    mutationSubstrate: createGitSubstrate(fixture, prefix),
    inspectTargets: gitInspectTargets(fixture),
    now: () => new Date(Date.UTC(2026, 9, 8, 0, 0, ++serial)).toISOString(),
    newId: () => `${prefix}-id-${++idCounter}`,
    newWriterId: () => `${prefix}-writer`,
  });
}

/**
 * One real-Git remediation script: the first design review reports one
 * blocking candidate, the fake remediator replaces the literal target bytes
 * on disk (keeping the file's POSIX mode), and every later review is clean.
 */
function createGitRemediationScript(
  fixture: GitFixture,
  remediatedBytes: string,
) {
  let reviewerDispatches = 0;
  return async (payload: Record<string, unknown>): Promise<string> => {
    switch (payload.requiredResultKind) {
      case "review_candidates": {
        reviewerDispatches += 1;
        return reviewerResult(
          payload,
          reviewerDispatches === 1
            ? [
                {
                  candidateId: "cand-1",
                  severity: "major",
                  summary: "defect",
                  location: "Task 1",
                },
              ]
            : [],
        );
      }
      case "finding_validation":
        return findingValidationResult(payload);
      case "remediation":
        await writeFile(path.join(fixture.root, fixture.target), remediatedBytes);
        return remediationResult(payload, "COMPLETED");
      case "self_review":
        return selfReviewResult(payload);
      default:
        throw new Error(`unexpected operation: ${String(payload.requiredResultKind)}`);
    }
  };
}

describe("restart recovery — real Git lifecycle (Review Focus 4-7)", () => {
  it("blocks PLAN_CLEAR when a reviewed artifact drifts during the Plan review", async () => {
    const harness = createRestartHarness();
    const coordinator = harness.buildCoordinator("plan-drift");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);

    const cleared = await driveFrom(coordinator, "main", started.reviewerPrompt, (payload) => {
      if (payload.requiredResultKind === "review_candidates" && payload.phase === "plan") {
        harness.files.set(DESIGN_PATH, `${DESIGN_V1}changed after review\n`);
      }
      switch (payload.requiredResultKind) {
        case "review_candidates":
          return reviewerResult(payload, []);
        case "finding_validation":
          return findingValidationResult(payload);
        default:
          throw new Error(`unexpected operation: ${String(payload.requiredResultKind)}`);
      }
    });

    expect(cleared.injectedContext).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(harness.events().some((event) => event.eventType === "PLAN_CLEAR")).toBe(false);
    expect(
      harness.events().some(
        (event) =>
          event.eventType === "EXECUTION_SUSPENDED" &&
          JSON.stringify(event.payload).includes("artifact_digest_mismatch"),
      ),
    ).toBe(true);
  });

  it("drives a zero-finding gate over a real Git workspace", async () => {
    const fixture = await initGitFixture(":(glob)*.md", "design target v1\nbe clean\n");
    const coordinator = buildGitCoordinator(fixture, "literal-clean");

    // Unrelated staged index entry + unrelated unstaged dirty bytes.
    await writeFile(path.join(fixture.root, "docs/a.md"), "a v2 staged\n");
    await runGitCli(fixture.root, ["add", "docs/a.md"]);
    await writeFile(path.join(fixture.root, "docs/b.md"), "b v2 dirty\n");
    const unrelatedBefore = await computeUnrelatedIndexFingerprint(fixture.root, fixture.target);
    const headBefore = runGitCli(fixture.root, ["rev-parse", "HEAD"]).trim();

    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: fixture.target,
      planPath: "docs/plan.md",
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);
    const cleared = await driveFrom(coordinator, "main", started.reviewerPrompt, (payload) =>
      reviewerResult(payload, []),
    );
    expect(cleared.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

    // No Review Gate commit ran; the unrelated staged entry survives
    // byte-for-byte and the unrelated dirty bytes remain unstaged.
    expect(runGitCli(fixture.root, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
    const unrelatedAfter = await computeUnrelatedIndexFingerprint(fixture.root, fixture.target);
    expect(unrelatedAfter).toBe(unrelatedBefore);
    const statusOutput = runGitCli(fixture.root, ["status", "--porcelain"]);
    expect(statusOutput).toContain("M  docs/a.md");
    expect(statusOutput).toContain(" M docs/b.md");
    await expect(readFile(path.join(fixture.root, "docs/b.md"), "utf8")).resolves.toBe(
      "b v2 dirty\n",
    );
  });

  it("commits exactly the literal `:(glob)*.md` target through remediation and leaves unrelated dirty paths untouched", async () => {
    const targetV1 = "design target v1\nbe clean\n";
    const targetV2 = "design target v2\nbe clean and exact\n";
    const fixture = await initGitFixture(":(glob)*.md", targetV1);
    const coordinator = buildGitCoordinator(fixture, "literal-rem");
    await writeFile(path.join(fixture.root, "docs/b.md"), "b v2 dirty\n");
    const unrelatedBefore = await computeUnrelatedIndexFingerprint(fixture.root, fixture.target);

    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: fixture.target,
      planPath: "docs/plan.md",
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);
    const cleared = await driveFrom(
      coordinator,
      "main",
      started.reviewerPrompt,
      createGitRemediationScript(fixture, targetV2),
    );
    expect(cleared.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

    // Exactly the literal target changed in the remediation commit and the
    // committed bytes are the remediated post-image.
    expect(changedPathsBetweenHeadAndParent(fixture.root)).toEqual([fixture.target]);
    const headBlob = runGitCli(fixture.root, [
      "--literal-pathspecs",
      "rev-parse",
      `HEAD:${fixture.target}`,
    ]).trim();
    const blob = spawnSync("git", ["--literal-pathspecs", "cat-file", "blob", headBlob], {
      cwd: fixture.root,
      shell: false,
      encoding: "buffer",
    });
    if (blob.status !== 0) throw new Error(blob.stderr.toString());
    expect(blob.stdout.toString("utf8")).toBe(targetV2);

    // The unrelated dirty path was never queried or committed through Git
    // pathspec expansion, and the staged plan file was not committed by the
    // Review Gate commit.
    expect(changedPathsBetweenHeadAndParent(fixture.root)).not.toContain("docs/b.md");
    expect(changedPathsBetweenHeadAndParent(fixture.root)).not.toContain("docs/plan.md");
    await expect(readFile(path.join(fixture.root, "docs/b.md"), "utf8")).resolves.toBe(
      "b v2 dirty\n",
    );
    const unrelatedAfter = await computeUnrelatedIndexFingerprint(fixture.root, fixture.target);
    expect(unrelatedAfter).toBe(unrelatedBefore);
  });

  it("rejects worktree-only mode drift at admission and normalizes POSIX 0655 to Git mode 100644", async () => {
    const fixture = await initGitFixture(":(glob)*.md", "exec target v1\n", { targetMode: 0o755 });
    // HEAD/index carry 100755; the worktree loses the owner execute bit.
    await chmod(path.join(fixture.root, fixture.target), 0o655);
    expect(gitModeFromOwnerExecBits(0o655)).toBe("100644");
    const binding = await fixture.git.inspectTarget(fixture.target);
    expect(binding.headEntry?.gitMode).toBe("100755");
    expect(binding.worktree?.gitMode).toBe("100644");
    expect(fixture.git.classifyTargetClean(binding)).toBe("not_clean");

    const coordinator = buildGitCoordinator(fixture, "mode-drift");
    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: fixture.target,
      planPath: "docs/plan.md",
    });
    expect(started.dispatched).toBe(false);
    expect(started.guidance).toContain("not clean/committed");
    expect(started.designPath).toBe(fixture.target);
  });

  it("preserves the pre-remediation target Git mode through remediation and commit", async () => {
    const targetV1 = "exec target v1\n";
    const targetV2 = "exec target v2 remediated\n";
    const fixture = await initGitFixture(":(glob)*.md", targetV1, { targetMode: 0o755 });
    const coordinator = buildGitCoordinator(fixture, "mode-keep");

    const started = await coordinator.startOrResume("main", {
      source: "command",
      designPath: fixture.target,
      planPath: "docs/plan.md",
    });
    if (started.reviewerPrompt === undefined) throw new Error(started.guidance);
    const cleared = await driveFrom(
      coordinator,
      "main",
      started.reviewerPrompt,
      createGitRemediationScript(fixture, targetV2),
    );
    expect(cleared.injectedContext).toContain("[JUSTICE: REVIEW GATE CLEAR]");

    // Pre-remediation Git mode (100755) equals the committed tree entry mode
    // and the final worktree mode.
    const headTree = runGitCli(fixture.root, [
      "--literal-pathspecs",
      "ls-tree",
      "HEAD",
      "--",
      fixture.target,
    ]).trim();
    expect(headTree.startsWith("100755 blob")).toBe(true);
    const worktreeMode = (await stat(path.join(fixture.root, fixture.target))).mode;
    expect(gitModeFromOwnerExecBits(worktreeMode)).toBe("100755");
  });

  it("recovers a prepared restore exactly once and conflicts on a third state", async () => {
    const targetV1 = "restore target v1\n";
    const dirtyV2 = "restore target v2 known dirty\n";
    const unknownV3 = "restore target v3 unknown partial bytes\n";
    const fixture = await initGitFixture(":(glob)*.md", targetV1);
    const target = fixture.target;
    await writeFile(path.join(fixture.root, target), dirtyV2);

    const binding = await fixture.git.inspectTarget(target);
    if (
      binding.headSha === null ||
      binding.headEntry === null ||
      binding.indexEntry === null ||
      binding.headBlobDigest === null ||
      binding.worktree === null
    ) {
      throw new Error("target is not inspectable");
    }
    const destination: ReviewRestoreDestinationBinding = {
      headSha: binding.headSha,
      headEntry: binding.headEntry,
      indexEntry: binding.indexEntry,
      worktree: {
        canonicalPath: target,
        digest: binding.headBlobDigest,
        gitMode: binding.headEntry.gitMode,
      },
    };
    const prepared = await fixture.git.prepareRestore({
      gateId: "restore-e2e-gate",
      operationId: "restore-e2e-op",
      phase: "design",
      targetCanonicalPath: target,
      allowedRestoreTargetPath: target,
      sourceKnownDirtyBinding: {
        headSha: binding.headSha,
        headEntry: binding.headEntry,
        indexEntry: binding.indexEntry,
        worktree: binding.worktree,
        sourceEventId: "restore-e2e",
      },
      targetCleanCommittedBinding: destination,
    });

    // Crash before execution: recovery classifies safe re-execution without
    // mutating anything.
    expect(await fixture.git.recoverPreparedRestore(prepared)).toEqual({
      status: "safe_to_reexecute",
    });
    expect(fixture.provider.replaceCalls()).toBe(0);

    // Execute once: the known-dirty bytes are replaced by the committed bytes
    // and the approved mode is preserved.
    const restored = await fixture.git.executePreparedRestore(prepared);
    expect(restored).toMatchObject({
      status: "restored",
      verified: { gitMode: "100644" },
    });
    await expect(readFile(path.join(fixture.root, target), "utf8")).resolves.toBe(targetV1);
    expect(fixture.provider.replaceCalls()).toBe(1);

    // A crash after execution recovers the exact side effect once — no
    // second replace is issued.
    expect(await fixture.git.recoverPreparedRestore(prepared)).toEqual({ status: "recovered" });
    expect(fixture.provider.replaceCalls()).toBe(1);

    // Third state: prepare against a freshly known-dirty state, then replace
    // the target with unknown bytes BEFORE recovery — the prepared intent is
    // provable against neither source nor destination, so recovery conflicts
    // instead of guessing.
    await writeFile(path.join(fixture.root, target), dirtyV2);
    const dirtyAgain = await fixture.git.inspectTarget(target);
    if (
      dirtyAgain.headSha === null ||
      dirtyAgain.headEntry === null ||
      dirtyAgain.indexEntry === null ||
      dirtyAgain.worktree === null
    ) {
      throw new Error("target is not inspectable");
    }
    const secondPrepare = await fixture.git.prepareRestore({
      gateId: "restore-e2e-gate",
      operationId: "restore-e2e-op-2",
      phase: "design",
      targetCanonicalPath: target,
      allowedRestoreTargetPath: target,
      sourceKnownDirtyBinding: {
        headSha: dirtyAgain.headSha,
        headEntry: dirtyAgain.headEntry,
        indexEntry: dirtyAgain.indexEntry,
        worktree: dirtyAgain.worktree,
        sourceEventId: "restore-e2e-2",
      },
      targetCleanCommittedBinding: destination,
    });
    await writeFile(path.join(fixture.root, target), unknownV3);
    await expect(fixture.git.recoverPreparedRestore(secondPrepare)).rejects.toThrow(
      /review_restore_recovery_conflict/,
    );
    // The unknown bytes were never overwritten.
    await expect(readFile(path.join(fixture.root, target), "utf8")).resolves.toBe(unknownV3);
  });

  it("recovers a prepared commit exactly once and conflicts on a third state", async () => {
    const targetV1 = "commit target v1\n";
    const targetV2 = "commit target v2 remediated\n";
    const fixture = await initGitFixture(":(glob)*.md", targetV1);
    const target = fixture.target;
    await writeFile(path.join(fixture.root, target), targetV2);
    const binding = await fixture.git.inspectTarget(target);
    if (
      binding.headSha === null ||
      binding.headEntry === null ||
      binding.worktree === null
    ) {
      throw new Error("target is not inspectable");
    }
    const prepared = await fixture.git.prepareCommit({
      gateId: "commit-e2e-gate",
      operationId: "commit-e2e-op",
      phase: "design",
      targetCanonicalPath: target,
      allowedCommitTargetPath: target,
      remediationRound: 1,
      lineageIds: ["lineage-a"],
      expectedArtifactDigest: binding.worktree.digest,
      expectedGitMode: binding.headEntry.gitMode,
    });

    // Crash before execution: recovery classifies safe re-execution.
    expect(await fixture.git.recoverPreparedCommit(prepared)).toEqual({
      status: "safe_to_reexecute",
    });
    const headBefore = runGitCli(fixture.root, ["rev-parse", "HEAD"]).trim();

    // Execute once.
    const verified = await fixture.git.executePreparedCommit(prepared);
    expect(verified.changedPaths).toEqual([target]);
    const headAfterCommit = runGitCli(fixture.root, ["rev-parse", "HEAD"]).trim();
    expect(headAfterCommit).not.toBe(headBefore);

    // A crash after execution recovers the exact commit once — no duplicate
    // commit is created.
    const recovered = await fixture.git.recoverPreparedCommit(prepared);
    if (recovered.status !== "recovered") throw new Error("expected recovered");
    expect(recovered.commit.commitId).toBe(verified.commitId);
    expect(runGitCli(fixture.root, ["rev-parse", "HEAD"]).trim()).toBe(headAfterCommit);

    // Third state: prepare a fresh intent, then let an external commit
    // advance HEAD BEFORE recovery — the prepared parent no longer matches,
    // so recovery conflicts instead of re-executing over foreign history.
    await writeFile(path.join(fixture.root, target), "second remediation\n");
    const nextBinding = await fixture.git.inspectTarget(target);
    if (
      nextBinding.headSha === null ||
      nextBinding.headEntry === null ||
      nextBinding.worktree === null
    ) {
      throw new Error("target is not inspectable");
    }
    const secondPrepare = await fixture.git.prepareCommit({
      gateId: "commit-e2e-gate",
      operationId: "commit-e2e-op-2",
      phase: "design",
      targetCanonicalPath: target,
      allowedCommitTargetPath: target,
      remediationRound: 2,
      lineageIds: ["lineage-b"],
      expectedArtifactDigest: nextBinding.worktree.digest,
      expectedGitMode: nextBinding.headEntry.gitMode,
    });
    await runGitCli(fixture.root, [
      "commit",
      "-q",
      "--no-gpg-sign",
      "--allow-empty",
      "-m",
      "foreign head advance",
    ]);
    await expect(fixture.git.recoverPreparedCommit(secondPrepare)).rejects.toThrow(
      /review_commit_recovery_conflict/,
    );
  });
});
// ---------------------------------------------------------------------------
// Legacy continuation bridge (Task 8) — a real legacy layout through the
// immutable snapshot verification and the idempotent authority-side bridge,
// including restart after a crash between PREPARED and COMMITTED.
// ---------------------------------------------------------------------------

describe("legacy continuation bridge (Task 8)", () => {
  type RawEvent = Record<string, unknown>;

  const LEGACY_GATE_ID = "legacy-restart-gate";
  const LEGACY_EPOCH = "epoch-legacy-restart-1";
  const LEGACY_WRITER = "justice-core";
  const LEGACY_T0 = "2026-09-02T00:00:00.000Z";
  const LEGACY_T1 = "2026-09-02T00:05:00.000Z";
  const LEGACY_T2 = "2026-09-02T00:10:00.000Z";

  const legacyEncoder = new TextEncoder();
  const legacyDigest = (index: number): string =>
    computeArtifactDigest(legacyEncoder.encode(`legacy-bridge-bytes-${index}`));

  const legacyRequirements = Object.freeze({
    source: "explicit",
    canonicalPath: "docs/requirements/restart.md",
    digest: legacyDigest(3),
  });
  const legacyDesignBinding = Object.freeze({
    canonicalPath: "docs/specs/restart-design.md",
    digest: legacyDigest(1),
    gitMode: "100644",
  });
  const legacyPlanBinding = Object.freeze({
    canonicalPath: "docs/plans/restart-plan.md",
    digest: legacyDigest(2),
    gitMode: "100644",
  });

  const legacyEvent = (eventType: string, payload: RawEvent, emittedAt: string): RawEvent => ({
    eventType,
    gateId: LEGACY_GATE_ID,
    writerId: LEGACY_WRITER,
    epochId: LEGACY_EPOCH,
    emittedAt,
    payload,
  });

  const legacyEvents: readonly RawEvent[] = [
    {
      eventType: "GATE_CREATED",
      gateId: LEGACY_GATE_ID,
      writerId: LEGACY_WRITER,
      epochId: LEGACY_EPOCH,
      emittedAt: LEGACY_T0,
      payload: {
        reviewScopeId: "scope-legacy-restart",
        designArtifact: legacyDesignBinding,
        planArtifact: legacyPlanBinding,
        requirementsResolution: legacyRequirements,
        reviewProtocolFingerprint: "rt-legacy-1",
      },
    },
    legacyEvent(
      "FINDING_DISCOVERED",
      {
        lineageId: "lineage-legacy-1",
        findingId: "finding-legacy-1",
        observedPhase: "design",
        ownerScope: "design",
        descriptionDigest: legacyDigest(4),
      },
      LEGACY_T1,
    ),
    legacyEvent(
      "EXECUTION_SUSPENDED",
      { reason: "review_dispatch_unavailable" },
      LEGACY_T2,
    ),
  ];

  const legacyDispatch: RawEvent = {
    dispatchId: "disp-legacy-1",
    operationId: "op-legacy-1",
    operation: "review_candidates",
    phase: "design",
    dispatchedAt: LEGACY_T1,
    completedAt: LEGACY_T1,
  };

  const legacyJsonl = (records: readonly RawEvent[]): string =>
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;

  function markerReasons(events: readonly ReviewGateEvent[]): readonly string[] {
    return events
      .filter(
        (entry): entry is Extract<ReviewGateEvent, { eventType: "EXECUTION_SUSPENDED" }> =>
          entry.eventType === "EXECUTION_SUSPENDED" && entry.payload.reason.startsWith("LEGACY_BRIDGE:"),
      )
      .map((entry) => entry.payload.reason);
  }

  interface LegacyBridgeFixture {
    readonly legacyEventsPath: string;
    readonly legacyDispatchesPath: string;
    readonly authorityRoot: string;
    readonly snapshot: LegacyGateSnapshot;
  }

  async function buildLegacyFixture(): Promise<LegacyBridgeFixture> {
    const root = await mkdtemp(path.join(tmpdir(), "justice-rg-legacy-bridge-"));
    tempRoots.push(root);
    const legacyRoot = path.join(root, "legacy");
    const authorityRoot = path.join(root, "authority");
    const gateDir = path.join(legacyRoot, ".justice", "review-gates", LEGACY_GATE_ID);
    await mkdir(gateDir, { recursive: true });
    const legacyEventsPath = path.join(gateDir, "events.jsonl");
    const legacyDispatchesPath = path.join(gateDir, "dispatches.jsonl");
    await writeFile(legacyEventsPath, legacyJsonl(legacyEvents));
    await writeFile(legacyDispatchesPath, legacyJsonl([legacyDispatch]));
    const eventsBytes = await readFile(legacyEventsPath);
    const dispatchesBytes = await readFile(legacyDispatchesPath);
    const snapshot: LegacyGateSnapshot = Object.freeze({
      gateId: LEGACY_GATE_ID,
      eventsBytes,
      dispatchesBytes,
      recoveryObjectRefs: [
        Object.freeze({
          refKind: "requirements_authority",
          refId: "recovery-legacy-req-1",
          storeDigest: legacyDigest(3),
          canonicalPath: legacyRequirements.canonicalPath,
          gitBlobOid: "a".repeat(40),
          commitOid: "b".repeat(40),
        }),
      ],
      trustedFrontier: Object.freeze({
        eventsDigest: computeArtifactDigest(eventsBytes),
        dispatchesDigest: computeArtifactDigest(dispatchesBytes),
        recoveryRefsDigest: computeCanonicalJsonFingerprint([{
          refKind: "requirements_authority", refId: "recovery-legacy-req-1", storeDigest: legacyDigest(3),
          canonicalPath: legacyRequirements.canonicalPath, gitBlobOid: "a".repeat(40), commitOid: "b".repeat(40),
        }]),
        scopeGitDigest: computeCanonicalJsonFingerprint([
          { reviewScopeId: "scope-legacy-restart", canonicalDesignPath: legacyDesignBinding.canonicalPath, canonicalPlanPath: legacyPlanBinding.canonicalPath },
          { workspaceIdentity: "workspace-legacy-restart", designGitMode: "100644", planGitMode: "100644" },
        ]),
        generationOrdinal: 1,
        observedAt: LEGACY_T2,
      }),
      scopeIdentity: Object.freeze({
        reviewScopeId: "scope-legacy-restart",
        canonicalDesignPath: legacyDesignBinding.canonicalPath,
        canonicalPlanPath: legacyPlanBinding.canonicalPath,
      }),
      gitIdentity: Object.freeze({
        workspaceIdentity: "workspace-legacy-restart",
        designGitMode: "100644",
        planGitMode: "100644",
      }),
    });
    return { legacyEventsPath, legacyDispatchesPath, authorityRoot, snapshot };
  }

  function crashAfterSecondBridgeWrite(base: ReviewGateEventStore): ReviewGateEventStore {
    let bridgeWrites = 0;
    return {
      ...base,
      publishEvents: async (gateId, batch, expectedFrontierHash): Promise<ReviewGatePublicationResult> => {
        bridgeWrites += 1;
        if (bridgeWrites >= 2) throw new Error("bridge_crash_test");
        return base.publishEvents(gateId, batch, expectedFrontierHash);
      },
    };
  }

  it("verifies the on-disk legacy gate, publishes the bridge once, and preserves the original JSONL", async () => {
    const fixture = await buildLegacyFixture();
    const verification = verifyLegacyContinuation(fixture.snapshot);
    if (verification.kind !== "VERIFIED") {
      throw new Error(`expected VERIFIED: ${verification.reason}`);
    }
    const preparedReason = encodeLegacyBridgeMarkerReason("prepared", verification.value.bridgeDigest);
    const committedReason = encodeLegacyBridgeMarkerReason("committed", verification.value.bridgeDigest);

    const authorityStore = createLegacyReviewGateEventStore(fixture.authorityRoot);
    expect(await publishVerifiedLegacyBridge(verification.value, authorityStore)).toBe("committed");

    // Restart: a fresh store instance observes the durable bridge markers.
    const restarted = createLegacyReviewGateEventStore(fixture.authorityRoot);
    expect(markerReasons(await restarted.readEvents(LEGACY_GATE_ID))).toEqual([
      preparedReason,
      committedReason,
    ]);
    expect(await publishVerifiedLegacyBridge(verification.value, restarted)).toBe("already_committed");
    expect(markerReasons(await restarted.readEvents(LEGACY_GATE_ID))).toEqual([
      preparedReason,
      committedReason,
    ]);

    // The stored bridge never invents lineage or round provenance.
    const authorityEvents = await restarted.readEvents(LEGACY_GATE_ID);
    expect(authorityEvents.some((entry) => entry.eventType.startsWith("FINDING_"))).toBe(false);

    // The original legacy JSONL bytes are immutable.
    expect((await readFile(fixture.legacyEventsPath)).toString()).toBe(legacyJsonl(legacyEvents));
    expect((await readFile(fixture.legacyDispatchesPath)).toString()).toBe(legacyJsonl([legacyDispatch]));
  });

  it("completes a crashed prepared-only bridge on restart without doubling markers", async () => {
    const fixture = await buildLegacyFixture();
    const verification = verifyLegacyContinuation(fixture.snapshot);
    if (verification.kind !== "VERIFIED") {
      throw new Error(`expected VERIFIED: ${verification.reason}`);
    }
    const preparedReason = encodeLegacyBridgeMarkerReason("prepared", verification.value.bridgeDigest);
    const committedReason = encodeLegacyBridgeMarkerReason("committed", verification.value.bridgeDigest);

    const crashStore = crashAfterSecondBridgeWrite(createLegacyReviewGateEventStore(fixture.authorityRoot));
    await expect(publishVerifiedLegacyBridge(verification.value, crashStore)).rejects.toThrow(
      /bridge_crash_test/,
    );

    const restarted = createLegacyReviewGateEventStore(fixture.authorityRoot);
    expect(markerReasons(await restarted.readEvents(LEGACY_GATE_ID))).toEqual([preparedReason]);
    expect(await publishVerifiedLegacyBridge(verification.value, restarted)).toBe("committed");
    expect(markerReasons(await restarted.readEvents(LEGACY_GATE_ID))).toEqual([
      preparedReason,
      committedReason,
    ]);
    expect(await publishVerifiedLegacyBridge(verification.value, restarted)).toBe("already_committed");
  });
});

function changedPathsBetweenHeadAndParent(root: string): readonly string[] {
  const output = runGitCli(root, [
    "diff-tree",
    "-r",
    "--name-only",
    "--no-renames",
    "--no-color",
    "HEAD^",
    "HEAD",
  ]);
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
