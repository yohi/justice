import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../../src/core/review-gate/event-schema";
import type { ReviewGateEvent as ReviewGateEventV1 } from "../../src/core/review-gate-types";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  computeWorkspaceIdentity,
} from "../../src/core/review-gate/identity";
import {
  createLinuxReviewGateProvider,
  type LinuxReviewGateProvider,
  type ReviewGateLockHandle,
} from "../../src/runtime/linux-review-gate-provider";
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
  createLegacyReviewGateEventStore,
  createReviewGateEventStore,
  type ReviewGateDispatchRecordV1,
  type ReviewGateJournalEventInput,
} from "../../src/runtime/review-gate-event-store";
import {
  observeVerifiedAdmissionSnapshotOwned,
  type AdmissionOwnedWitness,
  markAdmissionOwnedWitnessLive,
} from "../../src/runtime/review-gate-admission-context";
import type { ReviewGateScopeAdmissionRequest } from "../../src/runtime/review-gate-scope-admission";
import { computeReviewScopeId } from "../../src/core/review-gate/identity";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import { planReviewGateAdmission } from "../../src/core/review-gate/admission";
import type { ScopeEnrollmentV1, VerifiedScopeFrontier } from "../../src/core/review-gate/types";

const TEST_WRITER_ID = "writer-1";
const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";

/** One per-witness host authority: the Ed25519 trust root signing every authorization. */
const witnessApprovers = new WeakMap<ReviewGateScopeWitness, (payload: unknown) => Promise<string>>();
const witnessEnrollments = new WeakMap<ReviewGateScopeWitness, TrustedFirstEnrollmentV1>();
const witnessContexts = new WeakMap<
  ReviewGateScopeWitness,
  { readonly root: string; readonly writerId: string; readonly serial: { value: number } }
>();

/**
 * Task 5 witness fixture for one test workspace: provisions the protected
 * installation, binds one lock manager, and returns the witness bound to an
 * absolute witness directory OUTSIDE the workspace root (the Task 5
 * protection contract rejects any witness directory inside the workspace).
 * The `writerId` is remembered as the witness's admission writer so seeded
 * Gate membership and store options stay consistent.
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
  witnessContexts.set(witness, { root, writerId, serial: { value: 0 } });
  return { witness, lockManager };
}

function closeWitnessFixture(fixtures: {
  readonly witness: ReviewGateScopeWitness;
  readonly lockManager: ReviewGateLockManager;
}): void {
  fixtures.witness.close();
  fixtures.lockManager.close();
}

let currentRoot = "";
const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.witness`, { recursive: true, force: true });
  }
});

/**
 * Fresh test workspace. The protected witness verifies a Git-discovered,
 * committed, clean workspace identity, so every root is initialized as a Git
 * repository with one empty commit.
 */
async function freshRoot(prefix: string): Promise<string> {
  currentRoot = `${tmpdir()}/justice-task12a-events-${prefix}-${Math.random().toString(36).slice(2)}`;
  await mkdir(currentRoot, { recursive: true });
  tempRoots.push(currentRoot);
  execFileSync("git", ["init", "-q", currentRoot]);
  await mkdir(path.join(currentRoot, "docs"), { recursive: true });
  await writeFile(path.join(currentRoot, "docs/design.md"), "# Design\n");
  await writeFile(path.join(currentRoot, "docs/plan.md"), "# Plan\n");
  execFileSync("git", ["-C", currentRoot, "add", "docs/design.md", "docs/plan.md"]);
  execFileSync("git", [
    "-C",
    currentRoot,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "genesis",
  ]);
  return currentRoot;
}
// ---------------------------------------------------------------------------
// Seed helpers — the authority store is witness-verified, so every seeded
// Gate goes through a real protected publication (Task 5 witness CAS).
// ---------------------------------------------------------------------------

type StoreContext = Readonly<{
  readonly root: string;
  readonly witness: ReviewGateScopeWitness;
  readonly lockManager: ReviewGateLockManager;
  readonly writerId: string;
}>;

async function freshContext(prefix: string, writerId = TEST_WRITER_ID): Promise<StoreContext> {
  const root = await freshRoot(prefix);
  const fixtures = await createWitnessForTest(root, writerId);
  return { root, ...fixtures, writerId };
}

function eventStoreOptions(root: string, writerId: string, witness: ReviewGateScopeWitness) {
  return {
    workspaceIdentity: computeWorkspaceIdentity(root),
    writerId,
    witness,
  } as const;
}

type SeedStore = ReturnType<typeof createReviewGateEventStore>;

let seedSerial = 0;
function nextSeedId(label: string): string {
  seedSerial += 1;
  return `${label}-${seedSerial}`;
}

/**
 * First workspace enrollment. Returns the trusted first-enrollment value to be
 * consumed by the genesis publication of the first seeded Gate.
 */
async function ensureEnrollment(
  witness: ReviewGateScopeWitness,
  designPath: string,
  planPath: string,
): Promise<TrustedFirstEnrollmentV1> {
  const cached = witnessEnrollments.get(witness);
  if (cached !== undefined) return cached;
  const approve = witnessApprovers.get(witness);
  if (approve === undefined) throw new Error("test_witness_missing_approver");
  const auth = await authorizeFirstWorkspaceEnrollment({
    witness,
    designPath,
    planPath,
    workflowNonce: nextSeedId("nonce"),
    operationId: nextSeedId("enroll"),
    authorize: approve,
  });
  await witness.verifyFirstWorkspaceEnrollment(auth);
  witnessEnrollments.set(witness, auth);
  return auth;
}

const EMPTY_SHARD_HASH = "0".repeat(64);

function writerHeadKey(head: Readonly<{ scopeId: string; gateId: string; writerId: string }>): string {
  return `${head.scopeId}\u0000${head.gateId}\u0000${head.writerId}`;
}

/**
 * Publish the first authoritative events of one not-yet-witnessed Gate by
 * preparing and committing the same publication directly through the witness.
 * `scope` is the value returned by `authorizeScopeEnrollment`.
 */
async function publishWitnessSeed(
  ctx: StoreContext,
  gateId: string,
  scopeId: string,
  events: readonly ReviewGateEventV1[],
  scope: Parameters<ReturnType<typeof authorizeScopeEnrollment>>[0]["scope"],
): Promise<void> {
  const witness = ctx.witness;
  const prior = await witness.readWorkspaceScopeFrontier();
  const priorHead =
    prior.writerHeads.find(
      (head) =>
        head.scopeId === scopeId && head.gateId === gateId && head.writerId === ctx.writerId,
    ) ?? null;
  if (priorHead !== null) throw new Error("test_seed_gate_already_witnessed");
  const eventLines = events.map((event) =>
    encodeReviewGateEventRecord(validateReviewGateEventRecord(event)),
  );
  const bytes = Buffer.from(`${eventLines.join("\n")}\n`);
  const head = {
    scopeId,
    gateId,
    writerId: ctx.writerId,
    sequence: events.length,
    hash: computeArtifactDigest(bytes),
  };
  const contents = {
    workspaceIdentity: prior.workspaceIdentity,
    workspaceEnrollmentId: prior.workspaceEnrollmentId,
    scopes: [
      ...prior.scopes.filter((entry) => entry.scopeId !== scope.scopeId),
      scope,
    ].sort((left, right) =>
      left.scopeId < right.scopeId ? -1 : left.scopeId > right.scopeId ? 1 : 0,
    ),
    writerHeads: [...prior.writerHeads, head].sort(
      (left, right) => writerHeadKey(left) < writerHeadKey(right) ? -1 : writerHeadKey(left) > writerHeadKey(right) ? 1 : 0,
    ),
  };
  const globalFrontierHash = computeCanonicalJsonFingerprint(contents);
  const operationId = nextSeedId("seed");
  const expectedWriterHash = priorHead?.hash ?? EMPTY_SHARD_HASH;
  const input = {
    installationId: (await witness.readInstallation()).installationId,
    workspaceIdentity: prior.workspaceIdentity,
    scopeId,
    gateId,
    writerId: ctx.writerId,
    operationId,
    publicationId: computeCanonicalJsonFingerprint({
      scopeId,
      gateId,
      writerId: ctx.writerId,
      operationId,
      newTailDigest: head.hash,
    }),
    expectedInstallationFrontier: await witness.readInstallationFrontierHash(),
    expectedGlobalFrontier: prior.globalFrontierHash,
    expectedWriterSequence: priorHead?.sequence ?? 0,
    expectedWriterHash,
    newWriterSequence: head.sequence,
    newWriterHash: head.hash,
    canonicalShardPath: `${scopeId}/${gateId}/${ctx.writerId}.jsonl`,
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
    expectedWriterHash,
  });
  if (cas !== "advanced") throw new Error(`test_seed_cas_failed:${cas}`);
}

/**
 * Seed one Gate's events into an authority store on an enrolled witness.
 * The first seeded Gate becomes the workspace genesis; every later Gate gets
 * its own independently-authorize scope (kept on a distinct scope so no
 * completed-predecessor chain is required between them).
 */
async function seedGate(
  ctx: StoreContext,
  store: SeedStore,
  gateId: string,
  events: readonly ReviewGateEventV1[],
): Promise<void> {
  const approve = witnessApprovers.get(ctx.witness);
  if (approve === undefined) throw new Error("test_witness_missing_approver");
  const genesis = events[0];
  if (genesis?.eventType !== "GATE_CREATED") {
    throw new Error("test_seed_requires_gate_created");
  }
  const scopeId = genesis.payload.reviewScopeId;
  if (witnessEnrollments.get(ctx.witness) === undefined) {
    const trusted = await ensureEnrollment(
      ctx.witness,
      genesis.payload.designArtifact.canonicalPath,
      genesis.payload.planArtifact.canonicalPath,
    );
    const prepared = await store.prepareVerifiedEventPublication({
      scopeId,
      gateId,
      writerId: ctx.writerId,
      operationId: nextSeedId("seed"),
      canonicalEvents: events,
      firstEnrollment: {
        authorization: trusted,
        generationId: "generation-1",
        workflowContinuityId: nextSeedId("continuity"),
      },
    });
    const outcome = await store.publishPreparedEvent(prepared);
    if (outcome !== "committed") {
      throw new Error(`test_seed_publication_failed:${outcome}`);
    }
    return;
  }
  const serial = witnessContexts.get(ctx.witness)?.serial;
  if (serial === undefined) throw new Error("test_witness_missing_serial");
  const designPath = genesis.payload.designArtifact.canonicalPath;
  const planPath = genesis.payload.planArtifact.canonicalPath;
  const requested = {
    scopeId,
    workflowContinuityId: nextSeedId("continuity"),
    canonicalDesignPath: designPath,
    canonicalPlanPath: planPath,
    pathPairDigest: computeCanonicalJsonFingerprint([designPath, planPath]),
    provenance: {
      kind: "verified_independent_workflow" as const,
      evidenceDigest: "0".repeat(64),
      priorScopeId: null,
      priorGateId: null,
    },
    gateMembership: [
      {
        gateId,
        generationId: nextSeedId("generation"),
        supersedesGateId: null,
        admissionEventId: nextSeedId("admission"),
        writerIds: [ctx.writerId],
      },
    ],
  };
  const authorized = await authorizeScopeEnrollment({
    witness: ctx.witness,
    scope: requested,
    operationId: nextSeedId("scope"),
    authorize: approve,
  });
  await publishWitnessSeed(ctx, gateId, scopeId, events, authorized);
}

function gateCreatedEvent(gateId: string): ReviewGateEventV1 {
  return Object.freeze({
    eventType: "GATE_CREATED",
    gateId,
    writerId: TEST_WRITER_ID,
    epochId: "epoch-1",
    emittedAt: "2026-10-08T00:00:00.000Z",
    payload: Object.freeze({
      reviewScopeId: `scope-${gateId}`,
      designArtifact: Object.freeze({
        canonicalPath: DESIGN_PATH,
        digest: "d1",
        gitMode: "100644",
      }),
      planArtifact: Object.freeze({
        canonicalPath: PLAN_PATH,
        digest: "p1",
        gitMode: "100644",
      }),
      requirementsResolution: Object.freeze({
        source: "explicit",
        canonicalPath: "requirements.md",
        digest: "r1",
      }),
      reviewProtocolFingerprint: "f".repeat(64),
    }),
  });
}

function designClearEvent(gateId: string): ReviewGateEventV1 {
  return Object.freeze({
    eventType: "DESIGN_CLEAR",
    gateId,
    writerId: TEST_WRITER_ID,
    epochId: "epoch-1",
    emittedAt: "2026-10-08T00:00:01.000Z",
    payload: Object.freeze({ designProtocolFingerprint: "e".repeat(64) }),
  });
}

function dispatchRecord(
  operationId: string,
  overrides: Partial<ReviewGateDispatchRecordV1> = {},
): ReviewGateDispatchRecordV1 {
  return Object.freeze({
    dispatchId: `dispatch-${operationId}`,
    operationId,
    operation: "review_candidates",
    phase: "design",
    dispatchedAt: "2026-10-08T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  });
}


function authorityShardPath(root: string, scopeId: string, gateId: string): string {
  return path.join(
    root,
    ".justice",
    "review-gates",
    "events",
    scopeId,
    gateId,
    `${TEST_WRITER_ID}.jsonl`,
  );
}

/** Raw V2 typed event (Task 4c FINDING_VALIDATION_COMPLETED) before codec validation. */
function rawV2FindingValidationEvent(gateId: string, eventId = "v2-event-1"): unknown {
  return {
    schemaVersion: 2,
    eventId,
    parentEventId: "v2-parent-0",
    emittedAt: "2026-10-08T00:00:02.000Z",
    gateId,
    epochId: "epoch-1",
    generationId: "generation-1",
    writerId: TEST_WRITER_ID,
    eventType: "FINDING_VALIDATION_COMPLETED",
    payload: {
      eventType: "FINDING_VALIDATION_COMPLETED",
      operationId: "op-v2-1",
      validationEventId: "validation-1",
      disposition: "ALREADY_RESOLVED",
      relation: "EXISTING",
      lineageId: "lineage-1",
      priorCommittedResolutionEventId: "resolution-1",
      pinnedBaselineDigest: "a".repeat(64),
      semanticContextFingerprint: "a".repeat(64),
      validatedAbsenceProofDigest: "a".repeat(64),
      witnessedFrontierHash: "a".repeat(64),
    },
  };
}

function verifiedV2Event(gateId: string, eventId = "v2-event-1"): VerifiedReviewGateEvent {
  return validateReviewGateEventRecord(rawV2FindingValidationEvent(gateId, eventId));
}

/** Clone one verified event and inject an unknown top-level field. */
function withRogueField(event: VerifiedReviewGateEvent): VerifiedReviewGateEvent {
  const clone = structuredClone(event);
  (clone as { rogueField?: string }).rogueField = "rogue";
  return clone;
}

/** Codec-invalid V1 event: GATE_CREATED payload misses every required field. */
function brokenPayloadV1Event(gateId: string): ReviewGateEventV1 {
  return { ...gateCreatedEvent(gateId), payload: {} } as unknown as ReviewGateEventV1;
}

/** Codec-invalid V1 event: payload carries an unsafe absolute path string. */
function unsafePathV1Event(gateId: string): ReviewGateEventV1 {
  const base = gateCreatedEvent(gateId);
  return {
    ...base,
    payload: {
      ...base.payload,
      designArtifact: { canonicalPath: "/etc/passwd", digest: "d1", gitMode: "100644" },
    },
  } as unknown as ReviewGateEventV1;
}

describe("ReviewGateEventStore — durable events", () => {
  it("fails closed for a Gate outside the witnessed membership", async () => {
    const ctx = await freshContext("unseen");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    expect(store.writerId).toBe(ctx.writerId);
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);

    await expect(store.readEvents("gate-unseen")).rejects.toThrow(
      "review_gate_gate_membership_missing",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("round-trips appended events per gate and isolates gates", async () => {
    const ctx = await freshContext("roundtrip");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    await seedGate(ctx, store, "gate-b", [gateCreatedEvent("gate-b")]);

    await store.appendEvents("gate-a", [designClearEvent("gate-a")]);

    expect(await store.readEvents("gate-a")).toHaveLength(2);
    expect((await store.readEvents("gate-a"))[1]?.eventType).toBe("DESIGN_CLEAR");
    expect(await store.readEvents("gate-b")).toHaveLength(1);
    expect(await store.readEvents("gate-b")).not.toEqual(await store.readEvents("gate-a"));
    store.close();
    closeWitnessFixture(ctx);
  }, 60_000);

  it("keeps stored events independent and recursively frozen", async () => {
    const ctx = await freshContext("frozen");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const mutableEvent = {
      ...gateCreatedEvent("gate-a"),
      payload: {
        ...gateCreatedEvent("gate-a").payload,
        designArtifact: {
          canonicalPath: "docs/design.md",
          digest: "d1",
          gitMode: "100644" as const,
        },
      },
    } as ReviewGateEventV1;
    await store.appendEvents("gate-a", [mutableEvent]);
    mutableEvent.payload.designArtifact.canonicalPath = "changed.md";

    const firstRead = await store.readEvents("gate-a");
    const event = firstRead[1];
    expect(event?.payload.designArtifact.canonicalPath).toBe("docs/design.md");
    expect(Object.isFrozen(event?.payload.designArtifact)).toBe(true);
    expect(Object.isFrozen(event?.payload)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("persists events durably across store instances on the same root", async () => {
    const ctx = await freshContext("durable");
    const first = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, first, "gate-a", [gateCreatedEvent("gate-a")]);
    first.close();

    const second = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    expect(await second.readEvents("gate-a")).toEqual([gateCreatedEvent("gate-a")]);
    second.close();
    closeWitnessFixture(ctx);
  });

  it("writes the authority shard atomically at the events layout", async () => {
    const ctx = await freshContext("layout");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);

    const scopeId = `scope-gate-a`;
    const gateDir = path.join(ctx.root, ".justice", "review-gates", "events", scopeId, "gate-a");
    const files = await readdir(gateDir);
    expect(files).toContain(`${ctx.writerId}.jsonl`);
    expect(files.every((name) => !name.endsWith(".tmp"))).toBe(true);

    const bytes = await readFile(authorityShardPath(ctx.root, scopeId, "gate-a"), "utf8");
    expect(bytes.split("\n").filter((line) => line.length > 0)).toHaveLength(1);
    const record = JSON.parse(bytes.trim()) as ReviewGateEventV1;
    expect(record.eventType).toBe("GATE_CREATED");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects appending an event bound to a different gate", async () => {
    const ctx = await freshContext("gatemismatch");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );

    await expect(store.appendEvents("gate-a", [gateCreatedEvent("gate-b")])).rejects.toThrow(
      "review_gate_event_gate_mismatch",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects appending an empty batch without touching the workspace", async () => {
    const ctx = await freshContext("emptybatch");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );

    await expect(store.appendEvents("gate-a", [])).rejects.toThrow("review_gate_event_batch_empty");
    // The native provider base layout exists, but the Gate namespace directory
    // is never touched by a rejected batch.
    await expect(
      readdir(path.join(ctx.root, ".justice", "review-gates", "gate-a")),
    ).rejects.toThrow();
    store.close();
    closeWitnessFixture(ctx);
  });

  it.each(["", "a/b", "..", "/abs", "a\\b", "a\u0000b", "a..b"])(
    "rejects invalid gate id %j",
    async (gateId) => {
      const ctx = await freshContext("validid");
      const store = createReviewGateEventStore(
        ctx.root,
        eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
      );
      await expect(store.appendEvents(gateId, [gateCreatedEvent("gate-x")])).rejects.toThrow(
        "review_gate_invalid_id",
      );
      await expect(store.readEvents(gateId)).rejects.toThrow("review_gate_invalid_id");
      store.close();
      closeWitnessFixture(ctx);
    },
    15_000,
  );

  it("rejects malformed or non-object events", async () => {
    const ctx = await freshContext("badevent");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );

    await expect(
      store.appendEvents("gate-a", [null as unknown as ReviewGateEventV1]),
    ).rejects.toThrow("review_gate_event_schema_invalid");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects operations after close", async () => {
    const ctx = await freshContext("closed");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    store.close();
    store.close(); // idempotent

    await expect(store.readEvents("gate-a")).rejects.toThrow("review_gate_store_closed");
    await expect(store.appendEvents("gate-a", [gateCreatedEvent("gate-a")])).rejects.toThrow(
      "review_gate_store_closed",
    );
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateEventStore — dispatch records", () => {
  it("moves legacy dispatch journals outside the native witness namespace", async () => {
    const root = await freshRoot("dispatchmigration");
    const legacyDirectory = path.join(root, ".justice", "review-gates", "gate-old");
    const legacyFile = path.join(legacyDirectory, "dispatches.jsonl");
    const record = dispatchRecord("operation-old");
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(legacyFile, `${JSON.stringify(record)}\n`);
    const store = createLegacyReviewGateEventStore(root);

    await expect(readFile(legacyFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(
      path.join(root, ".justice", "review-gate-dispatches", "gate-old.jsonl"),
      "utf8",
    )).toBe(`${JSON.stringify(record)}\n`);
    expect(await store.listDispatches("gate-old")).toEqual([record]);
    expect(await readdir(path.join(root, ".justice", "review-gates"))).toEqual([]);
    store.close();
  });

  it("records, lists, and marks dispatches completed", async () => {
    const ctx = await freshContext("dispatch");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    await store.recordDispatch("gate-a", dispatchRecord("op-2"));

    expect(await store.listDispatches("gate-a")).toHaveLength(2);
    await store.markDispatchCompleted("gate-a", "op-1");

    const dispatches = await store.listDispatches("gate-a");
    const op1 = dispatches[0];
    const op2 = dispatches[1];
    expect(op1?.operationId).toBe("op-1");
    expect(op1?.completedAt).toBeTypeOf("string");
    expect(op2?.completedAt).toBeNull();
    store.close();
    closeWitnessFixture(ctx);
  });

  it("persists dispatch completion across store instances", async () => {
    const ctx = await freshContext("dispatchrestart");
    const first = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await first.recordDispatch("gate-a", dispatchRecord("op-1"));
    await first.markDispatchCompleted("gate-a", "op-1");
    first.close();

    const second = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    const dispatches = await second.listDispatches("gate-a");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]?.completedAt).toBeTypeOf("string");
    second.close();
    closeWitnessFixture(ctx);
  });

  it("keeps completion idempotent: re-marking a completed dispatch is a no-op", async () => {
    const ctx = await freshContext("dispatchnoop");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    await store.markDispatchCompleted("gate-a", "op-1");
    const after = await store.listDispatches("gate-a");
    await store.markDispatchCompleted("gate-a", "op-1");

    expect(await store.listDispatches("gate-a")).toEqual(after);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects completion of an unknown dispatch", async () => {
    const ctx = await freshContext("dispatchunknown");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));

    await expect(store.markDispatchCompleted("gate-a", "op-missing")).rejects.toThrow(
      "review_gate_dispatch_unknown",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects re-recording an existing operation id with different content", async () => {
    const ctx = await freshContext("dispatchconflict");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));

    await expect(
      store.recordDispatch("gate-a", dispatchRecord("op-1", { phase: "plan" })),
    ).rejects.toThrow("review_gate_dispatch_conflict");
    // identical re-record stays idempotent
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    expect(await store.listDispatches("gate-a")).toHaveLength(1);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("keeps dispatch records isolated per gate", async () => {
    const ctx = await freshContext("dispatchisolation");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await store.recordDispatch("gate-a", dispatchRecord("op-1"));
    await store.recordDispatch("gate-b", dispatchRecord("op-1", { phase: "plan" }));

    const gateA = await store.listDispatches("gate-a");
    const gateB = await store.listDispatches("gate-b");
    expect(gateA).toHaveLength(1);
    expect(gateA[0]?.phase).toBe("design");
    expect(gateB).toHaveLength(1);
    expect(gateB[0]?.phase).toBe("plan");
    store.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateEventStore — scope index", () => {
  it("round-trips the review scope to gate mapping", async () => {
    const ctx = await freshContext("scopeindex");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );

    expect(await store.readScopeIndex("scope-1")).toBeNull();
    await store.writeScopeIndex("scope-1", "gate-a");
    expect(await store.readScopeIndex("scope-1")).toBe("gate-a");
    store.close();

    // Durable across instances
    const second = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    expect(await second.readScopeIndex("scope-1")).toBe("gate-a");
    await second.writeScopeIndex("scope-1", "gate-b");
    expect(await second.readScopeIndex("scope-1")).toBe("gate-b");
    second.close();
    closeWitnessFixture(ctx);
  });

  it("returns null for inherited scope-index keys", async () => {
    const ctx = await freshContext("scopeindexkeys");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await store.writeScopeIndex("scope-1", "gate-a");
    expect(await store.readScopeIndex("toString")).toBeNull();
    store.close();
    closeWitnessFixture(ctx);
  });

  it("persists the scope index as JSON under .justice/review-gates/locks/", async () => {
    const ctx = await freshContext("scopeindexfile");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await store.writeScopeIndex("scope-1", "gate-a");

    const bytes = await readFile(
      path.join(ctx.root, ".justice", "review-gates", "locks", "scope-index.json"),
      "utf8",
    );
    expect(JSON.parse(bytes)).toEqual({ "scope-1": "gate-a" });
    store.close();
    closeWitnessFixture(ctx);
  });

  it.each(["", "a/b", "..", "/abs"])("rejects invalid scope id %j", async (reviewScopeId) => {
    const ctx = await freshContext("scopeindexinvalid");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await expect(store.readScopeIndex(reviewScopeId)).rejects.toThrow("review_gate_invalid_id");
    await expect(store.writeScopeIndex(reviewScopeId, "gate-a")).rejects.toThrow(
      "review_gate_invalid_id",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects writing a scope index entry with an invalid gate id", async () => {
    const ctx = await freshContext("scopeindexgate");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await expect(store.writeScopeIndex("scope-1", "a/b")).rejects.toThrow("review_gate_invalid_id");
    store.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateEventStore — gate namespace enumeration (Task 13/14)", () => {
  it("lists gate namespaces from the witnessed membership only", async () => {
    const ctx = await freshContext("enum");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );

    await seedGate(ctx, store, "gate-b", [gateCreatedEvent("gate-b")]);
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);

    expect(await store.listGateIds()).toEqual(["gate-a", "gate-b"]);

    // An orphan shard that no witnessed head describes fails the workspace
    // frontier verification closed.
    await mkdir(
      path.join(ctx.root, ".justice", "review-gates", "events", "orphan-scope", "orphan-gate"),
      { recursive: true },
    );
    await writeFile(
      path.join(
        ctx.root,
        ".justice",
        "review-gates",
        "events",
        "orphan-scope",
        "orphan-gate",
        "orphan-writer.jsonl",
      ),
      "orphan bytes",
      "utf8",
    );
    await expect(store.listGateIds()).rejects.toThrow(
      "review_gate_witness_journal_orphan_membership",
    );
    store.close();
    closeWitnessFixture(ctx);
  }, 60_000);

  it("keeps enumeration available after stores are reopened on the same root", async () => {
    const ctx = await freshContext("enumreopen");
    const first = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, first, "gate-a", [gateCreatedEvent("gate-a")]);
    first.close();

    const second = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    expect(await second.listGateIds()).toEqual(["gate-a"]);
    second.close();
    closeWitnessFixture(ctx);
  });

  it("rejects enumeration after close", async () => {
    const ctx = await freshContext("enumclosed");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    store.close();
    await expect(store.listGateIds()).rejects.toThrow("review_gate_store_closed");
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateEventStore — concurrent append interleaving", () => {
  it("serializes interleaved appends for one gate without losing events", async () => {
    const ctx = await freshContext("interleave");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);

    await Promise.all([
      store.appendEvents("gate-a", [designClearEvent("gate-a")]),
      store.appendEvents("gate-a", [
        { ...designClearEvent("gate-a"), epochId: "epoch-2" },
      ]),
    ]);

    expect(await store.readEvents("gate-a")).toHaveLength(3);
    store.close();
    closeWitnessFixture(ctx);
  }, 30_000);
});

describe("ReviewGateEventStore — durable canonical journal bytes (Task 6)", () => {
  it("writes newline-terminated canonical codec lines", async () => {
    const ctx = await freshContext("canonical");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);

    const sharded = authorityShardPath(ctx.root, "scope-gate-a", "gate-a");
    const bytes = await readFile(sharded, "utf8");
    expect(bytes.endsWith("\n")).toBe(true);
    const lines = bytes.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      encodeReviewGateEventRecord(validateReviewGateEventRecord(gateCreatedEvent("gate-a"))),
    );
    store.close();
    closeWitnessFixture(ctx);
  });

});

describe("ReviewGateEventStore — protected publication CAS (Task 6)", () => {
  it("reads the seeded frontier as the exact member writer head digest", async () => {
    const ctx = await freshContext("frontier");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const shardBytes = await readFile(authorityShardPath(ctx.root, "scope-gate-a", "gate-a"));

    expect(await store.readFrontierHash("gate-a")).toBe(computeArtifactDigest(shardBytes));
    store.close();
    closeWitnessFixture(ctx);
  });

  it("fails closed on the frontier of a Gate outside the witnessed membership", async () => {
    const ctx = await freshContext("frontiermissing");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-seeded", [gateCreatedEvent("gate-seeded")]);

    await expect(store.readFrontierHash("gate-a")).rejects.toThrow(
      "review_gate_gate_membership_missing",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("commits a publication when the expected frontier matches and advances it", async () => {
    const ctx = await freshContext("publish");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const expected = await store.readFrontierHash("gate-a");

    const result = await store.publishEvents("gate-a", [designClearEvent("gate-a")], expected);

    expect(result.eventCount).toBe(2);
    expect(result.frontierHash).not.toBe(expected);
    await expect(store.readFrontierHash("gate-a")).resolves.toBe(result.frontierHash);
    expect(await store.readEvents("gate-a")).toHaveLength(2);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("recovers once when the first prepared publication CAS reports blocked", async () => {
    const ctx = await freshContext("recovercas");
    const seedStore = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, seedStore, "gate-a", [gateCreatedEvent("gate-a")]);
    seedStore.close();
    let commitCalls = 0;
    let recoveryCalls = 0;
    const witness = {
      ...ctx.witness,
      commitPreparedPublicationCAS: async () => {
        commitCalls += 1;
        return "blocked" as const;
      },
      recoverPreparedPublication: async (publicationId: string) => {
        recoveryCalls += 1;
        return ctx.witness.recoverPreparedPublication(publicationId);
      },
    };
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, witness),
    );

    await expect(store.publishEvents(
      "gate-a",
      [designClearEvent("gate-a")],
      await store.readFrontierHash("gate-a"),
    )).resolves.toMatchObject({ eventCount: 2 });
    expect(commitCalls).toBe(1);
    expect(recoveryCalls).toBe(1);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("limits each publication tail to 64 KiB while allowing a shard to grow past 64 KiB", async () => {
    const ctx = await freshContext("longshard");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);

    for (let batch = 0; batch < 5; batch += 1) {
      const current = await store.readEvents("gate-a");
      const events = Array.from({ length: 5 }, (_, index): ReviewGateEventV1 => ({
        eventType: "EXECUTION_SUSPENDED",
        gateId: "gate-a" as ReviewGateEventV1["gateId"],
        writerId: ctx.writerId as ReviewGateEventV1["writerId"],
        epochId: `epoch-${batch}-${index}` as ReviewGateEventV1["epochId"],
        emittedAt: "2026-10-12T00:00:00.000Z",
        payload: { reason: "x".repeat(3000) },
      }));
      await store.publishEvents("gate-a", events, await store.readFrontierHash("gate-a"));
      expect(current.length).toBe(1 + batch * events.length);
    }

    const shard = await readFile(authorityShardPath(ctx.root, "scope-gate-a", "gate-a"));
    expect(shard.length).toBeGreaterThan(64 * 1024);
    expect(await store.readEvents("gate-a")).toHaveLength(26);
    store.close();
    closeWitnessFixture(ctx);
  }, 60_000);

  it("rejects an empty publication batch", async () => {
    const ctx = await freshContext("publisheempty");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    await expect(
      store.publishEvents("gate-a", [], await store.readFrontierHash("gate-a")),
    ).rejects.toThrow("review_gate_event_batch_empty");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects a stale frontier and leaves the journal byte-identical", async () => {
    const ctx = await freshContext("stale");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const genesisFrontier = await store.readFrontierHash("gate-a");
    const first = await store.publishEvents("gate-a", [designClearEvent("gate-a")], genesisFrontier);
    const sharded = authorityShardPath(ctx.root, "scope-gate-a", "gate-a");
    const bytesAfterFirst = await readFile(sharded, "utf8");

    await expect(
      store.publishEvents("gate-a", [
        { ...designClearEvent("gate-a"), epochId: "epoch-3" },
      ], genesisFrontier),
    ).rejects.toThrow("review_gate_publication_cas_conflict");

    expect(await readFile(sharded, "utf8")).toBe(bytesAfterFirst);
    expect(await store.readFrontierHash("gate-a")).toBe(first.frontierHash);
    expect(await store.readEvents("gate-a")).toHaveLength(2);
    const files = await readdir(path.dirname(sharded));
    expect(files.every((name) => !name.endsWith(".tmp"))).toBe(true);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects a foreign expected frontier without advancing the witnessed head", async () => {
    const ctx = await freshContext("foreign");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);

    await expect(
      store.publishEvents("gate-a", [designClearEvent("gate-a")], "0".repeat(64)),
    ).rejects.toThrow("review_gate_publication_cas_conflict");
    expect(await store.readEvents("gate-a")).toHaveLength(1);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("resolves two racing publications with the same expected frontier to exactly one commit", async () => {
    const ctx = await freshContext("racing");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const expected = await store.readFrontierHash("gate-a");

    const results = await Promise.allSettled([
      store.publishEvents("gate-a", [{ ...designClearEvent("gate-a"), epochId: "epoch-2" }], expected),
      store.publishEvents("gate-a", [{ ...designClearEvent("gate-a"), epochId: "epoch-3" }], expected),
    ]);

    expect(results[0]?.status).toBe("fulfilled");
    expect(results[1]?.status).toBe("rejected");
    if (results[1]?.status === "rejected") {
      expect(String(results[1].reason)).toContain("review_gate_publication_cas_conflict");
    }
    expect(await store.readEvents("gate-a")).toHaveLength(2);
    expect((await store.readEvents("gate-a"))[1]?.eventType).toBe("DESIGN_CLEAR");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("keeps the published frontier stable across store restarts", async () => {
    const ctx = await freshContext("restartfrontier");
    const first = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, first, "gate-a", [gateCreatedEvent("gate-a")]);
    const published = await first.publishEvents(
      "gate-a",
      [designClearEvent("gate-a")],
      await first.readFrontierHash("gate-a"),
    );
    first.close();

    const second = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    expect(await second.readFrontierHash("gate-a")).toBe(published.frontierHash);
    expect(await second.readEvents("gate-a")).toHaveLength(2);
    second.close();
    closeWitnessFixture(ctx);
  });

  it("treats a retried publication after a lost acknowledgement as a CAS conflict, not a duplicate", async () => {
    const ctx = await freshContext("lostack");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const expected = await store.readFrontierHash("gate-a");
    await store.publishEvents("gate-a", [designClearEvent("gate-a")], expected);
    store.close(); // simulated crash before the caller saw the acknowledgement

    const restarted = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await expect(
      restarted.publishEvents("gate-a", [designClearEvent("gate-a")], expected),
    ).rejects.toThrow("review_gate_publication_cas_conflict");
    expect(await restarted.readVerifiedEvents("gate-a")).toHaveLength(2);
    restarted.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateEventStore — V1/V2 codec journal (Task 6)", () => {
  it("round-trips a V2 typed event through the protected publication path", async () => {
    const ctx = await freshContext("v2");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const verified = verifiedV2Event("gate-a");

    const result = await store.publishEvents(
      "gate-a",
      [verified],
      await store.readFrontierHash("gate-a"),
    );

    expect(result.eventCount).toBe(2);
    const readBack = await store.readVerifiedEvents("gate-a");
    expect(readBack).toHaveLength(2);
    expect(readBack[1]).toEqual(verified);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("returns V1 and V2 events in commit order on a mixed journal", async () => {
    const ctx = await freshContext("mixed");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    await store.publishEvents(
      "gate-a",
      [verifiedV2Event("gate-a")],
      await store.readFrontierHash("gate-a"),
    );

    const events = await store.readVerifiedEvents("gate-a");
    expect(events.map((event) => ("schemaVersion" in event ? "v2" : "v1"))).toEqual(["v1", "v2"]);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("round-trips V1 legacy events through the verified read", async () => {
    const ctx = await freshContext("v1read");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    expect(await store.readVerifiedEvents("gate-a")).toEqual([gateCreatedEvent("gate-a")]);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("fails closed on the legacy read when the journal contains a V2 event", async () => {
    const ctx = await freshContext("v2legacy");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    await store.publishEvents(
      "gate-a",
      [verifiedV2Event("gate-a")],
      await store.readFrontierHash("gate-a"),
    );
    await expect(store.readEvents("gate-a")).rejects.toThrow("review_gate_event_unsupported_v2");
    await expect(
      store.appendEvents("gate-a", [designClearEvent("gate-a")]),
    ).rejects.toThrow("review_gate_event_unsupported_v2");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects codec-invalid V1 events on append", async () => {
    const ctx = await freshContext("badv1");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await expect(store.appendEvents("gate-a", [brokenPayloadV1Event("gate-a")])).rejects.toThrow(
      "review_gate_event_schema_invalid",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects events whose payload carries an unsafe absolute path", async () => {
    const ctx = await freshContext("unsafepath");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await expect(store.appendEvents("gate-a", [unsafePathV1Event("gate-a")])).rejects.toThrow(
      "review_gate_event_unsafe_string",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects codec-invalid V2 events on publication without mutating the shard", async () => {
    const ctx = await freshContext("badv2");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const sharded = authorityShardPath(ctx.root, "scope-gate-a", "gate-a");
    const bytesBefore = await readFile(sharded, "utf8");
    const broken: ReviewGateJournalEventInput = withRogueField(verifiedV2Event("gate-a"));
    await expect(
      store.publishEvents("gate-a", [broken], await store.readFrontierHash("gate-a")),
    ).rejects.toThrow("review_gate_event_schema_invalid");
    expect(await readFile(sharded, "utf8")).toBe(bytesBefore);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("rejects a publication bound to a different gate", async () => {
    const ctx = await freshContext("publishmismatch");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    await expect(
      store.publishEvents(
        "gate-a",
        [gateCreatedEvent("gate-b")],
        await store.readFrontierHash("gate-a"),
      ),
    ).rejects.toThrow("review_gate_event_gate_mismatch");
    store.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateEventStore — tamper and crash recovery (Task 6)", () => {
  describe("admitted V2 publication foundation (Task 4a)", () => {
    it("publishes one admitted operation and rejects its duplicate operation id", async () => {
      const ctx = await freshContext("admitted-operation-once");
      const store = createReviewGateEventStore(
        ctx.root,
        eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
      );
      await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
      const frontier = await ctx.witness.readWorkspaceScopeFrontier();
      const scopeId = "scope-gate-a";
      const operationId = "nc1-reentry-operation";
      const event = validateReviewGateEventRecord({
        schemaVersion: 2,
        eventId: "nc1-reentry-event",
        parentEventId: "gate-a",
        emittedAt: "2026-10-16T00:00:01.000Z",
        gateId: "gate-a",
        epochId: "epoch-a",
        generationId: "gate-a",
        writerId: ctx.writerId,
        eventType: "NC1_REENTRY_OUTCOME_APPLIED",
        payload: {
          operationId,
          validationEventId: "validation-a",
          nc1EvidenceEventId: "stop-a",
          changeObservedEventId: "change-a",
          remainingRounds: 0,
        },
      });

      const publication = await ctx.witness.withAdmissionWitnessTransaction(
        { workspaceIdentity: frontier.workspaceIdentity, designPath: DESIGN_PATH, planPath: PLAN_PATH },
        async (owned) => {
          const current = await owned.readVerifiedFrontier();
          const head = current.writerHeads.find((candidate) =>
            candidate.scopeId === scopeId && candidate.gateId === "gate-a" && candidate.writerId === ctx.writerId,
          );
          return store.prepareAdmittedOperationPublication({
            scopeId,
            gateId: "gate-a",
            writerId: ctx.writerId,
            operationId,
            canonicalEvents: [event],
            ...(head === undefined ? {} : { expectedWriterHead: head.hash }),
          }, owned);
        },
      );
      expect(await store.recoverPreparedPublication(publication.publicationId)).toBe("committed");
      expect(await store.recoverPreparedPublication(publication.publicationId)).toBe("already_committed");
      await expect(ctx.witness.withAdmissionWitnessTransaction(
        { workspaceIdentity: frontier.workspaceIdentity, designPath: DESIGN_PATH, planPath: PLAN_PATH },
        (owned) => store.prepareAdmittedOperationPublication({
          scopeId,
          gateId: "gate-a",
          writerId: ctx.writerId,
          operationId,
          canonicalEvents: [event],
        }, owned),
      )).rejects.toThrow("review_gate_operation_id_conflict");

      store.close();
      closeWitnessFixture(ctx);
    });

    it("recovers a prepared V2 genesis before consuming its authority", async () => {
      const ctx = await freshContext("admitted-genesis");
      const store = createReviewGateEventStore(
        ctx.root,
        eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
      );
      await mkdir(path.join(ctx.root, "docs"), { recursive: true });
      await writeFile(
        path.join(ctx.root, DESIGN_PATH),
        '# Design\n<!-- justice-review-gate:requirements="docs/requirements.md" -->\n',
      );
      await writeFile(path.join(ctx.root, PLAN_PATH), "# Plan\n");
      await writeFile(path.join(ctx.root, "docs/requirements.md"), "# Requirements\n");
      execFileSync("git", ["-C", ctx.root, "add", "--", "docs"]);
      execFileSync("git", [
        "-C", ctx.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
        "commit", "-qm", "admission artifacts",
      ]);
      const approve = witnessApprovers.get(ctx.witness);
      if (approve === undefined) throw new Error("test_witness_missing_approver");
      await authorizeFirstWorkspaceEnrollment({
        witness: ctx.witness,
        designPath: DESIGN_PATH,
        planPath: PLAN_PATH,
        workflowNonce: nextSeedId("admitted-nonce"),
        operationId: nextSeedId("admitted-enrollment"),
        authorize: approve,
      });
      const scopeId = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
      const preparedResult = await ctx.witness.withAdmissionWitnessTransaction(
        { workspaceIdentity: computeWorkspaceIdentity(ctx.root), designPath: DESIGN_PATH, planPath: PLAN_PATH },
        async (owned) => {
          const current = await owned.read();
          const frontier = await owned.readVerifiedFrontier();
          const firstEnrollment = current.data.workspaces[frontier.workspaceIdentity]?.authorization;
          if (firstEnrollment === undefined) throw new Error("test_first_enrollment_missing");
          const observation = await observeVerifiedAdmissionSnapshotOwned({
            workspaceRoot: ctx.root,
            scopeId,
            protocol: createReviewGateProtocolDescriptor(),
            eventStore: store,
            workspaceReader: { readWorkspaceFile: async (relativePath) => readFile(path.join(ctx.root, relativePath)) },
            owned,
            authority: {
              installation: current.installation,
              frontier,
              firstEnrollment: {
                authorization: firstEnrollment,
                generationId: "genesis-generation",
                workflowContinuityId: "genesis-continuity",
              },
            },
            request: { designPath: DESIGN_PATH, planPath: PLAN_PATH },
          });
          if (observation === null) throw new Error("test_admission_observation_missing");
          const decision = planReviewGateAdmission(observation.snapshot);
          if (decision.kind !== "CREATE_GENESIS") throw new Error("test_genesis_decision_missing");
          const scope: ScopeEnrollmentV1 = {
            scopeId,
            workflowContinuityId: "genesis-continuity",
            canonicalDesignPath: DESIGN_PATH,
            canonicalPlanPath: PLAN_PATH,
            pathPairDigest: computeCanonicalJsonFingerprint([DESIGN_PATH, PLAN_PATH]),
            provenance: {
              kind: "verified_genesis",
              evidenceDigest: computeCanonicalJsonFingerprint(firstEnrollment.authority),
              priorScopeId: null,
              priorGateId: null,
            },
            gateMembership: [{
              gateId: "genesis-gate",
              generationId: "genesis-generation",
              supersedesGateId: null,
              admissionEventId: firstEnrollment.authority.authorizationEventId,
              writerIds: [ctx.writerId],
            }],
          };
          const membershipPayload = {
            installationId: current.installation.installationId,
            workspaceIdentity: frontier.workspaceIdentity,
            operationId: "genesis-membership-op",
            expectedWorkspaceFrontier: frontier.globalFrontierHash,
            scope,
          };
          const membership = {
            gateId: "genesis-gate",
            generationId: "genesis-generation",
            operationId: "genesis-membership-op",
            writerId: ctx.writerId,
            writerHead: { sequence: 1, hash: "0".repeat(64) },
            supersedesGateId: null,
            authorization: { ...membershipPayload, signature: await approve(membershipPayload) },
          };
          const gateEvent = validateReviewGateEventRecord({
            schemaVersion: 2,
            eventId: "genesis-created-event",
            parentEventId: "genesis-parent-event",
            emittedAt: "2026-10-16T00:00:00.000Z",
            gateId: membership.gateId,
            epochId: current.installation.epoch,
            generationId: membership.generationId,
            writerId: ctx.writerId,
            eventType: "GATE_CREATED",
            payload: {
              reviewScopeId: scopeId,
              supersedesGateId: null,
              requirementsResolution: observation.requirementsResolution,
              designArtifact: observation.snapshot.current.design,
              planArtifact: observation.snapshot.current.plan,
              reviewProtocolFingerprint: observation.snapshot.current.globalProtocolFingerprint,
              designProtocolFingerprint: observation.snapshot.current.designProtocolFingerprint,
              planProtocolFingerprint: observation.snapshot.current.planProtocolFingerprint,
            },
          });
          membership.writerHead.hash = computeArtifactDigest(
            Buffer.from(`${encodeReviewGateEventRecord(gateEvent)}\n`),
          );
          const input = {
            scopeId,
            gateId: membership.gateId,
            writerId: ctx.writerId,
            operationId: membership.operationId,
            canonicalEvents: [gateEvent],
            decision,
            observation,
            membership,
          };
          const prepared = await store.prepareAdmittedGenerationPublication(input, owned);
          expect(prepared.gateId).toBe(membership.gateId);
          expect(prepared.operationId).toBe(membership.operationId);
          expect(prepared.newWriterSequence).toBe(1);
          expect(prepared.firstEnrollmentAuthorizationId).toBe(
            firstEnrollment.authority.authorizationEventId,
          );
          expect(await owned.readFirstEnrollmentAuthority()).toBeNull();
          const stagedRegistry = await owned.read();
          expect(
            stagedRegistry.data.workspaces[frontier.workspaceIdentity]?.enrollmentState,
          ).toBe("consumed");
          expect(stagedRegistry.data.pending[prepared.publicationId]?.input.gateId).toBe(
            membership.gateId,
          );
          expect(await owned.recoverPreparedPublication(prepared.publicationId)).toBe("advanced");
          return gateEvent;
        },
      );
      expect(preparedResult.eventType).toBe("GATE_CREATED");
      const committedFrontier = await ctx.witness.readWorkspaceScopeFrontier();
      expect(committedFrontier.scopes.some((scope) => scope.scopeId === scopeId)).toBe(true);
      store.close();
      closeWitnessFixture(ctx);
    });

  it.todo("publishes successor membership with exact predecessor");

  it.todo("recovers prepared genesis without a second budget");
  });

  it("fails closed when the authority shard is tampered outside the witness", async () => {
    const ctx = await freshContext("tamper");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    store.close();
    const sharded = authorityShardPath(ctx.root, "scope-gate-a", "gate-a");
    await appendFile(sharded, '{"eventType":"DESIGN_CL');

    const reopened = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await expect(reopened.readEvents("gate-a")).rejects.toThrow(
      "review_gate_witness_journal_missing_or_tampered",
    );
    await expect(
      reopened.appendEvents("gate-a", [designClearEvent("gate-a")]),
    ).rejects.toThrow("review_gate_witness_journal_missing_or_tampered");
    await expect(reopened.readFrontierHash("gate-a")).rejects.toThrow(
      "review_gate_witness_journal_missing_or_tampered",
    );
    // Fail-closed recovery leaves the tampered bytes untouched.
    const bytes = await readFile(sharded, "utf8");
    expect(bytes.endsWith('{"eventType":"DESIGN_CL')).toBe(true);
    reopened.close();
    closeWitnessFixture(ctx);
  });

  it("recovers a prepared-but-unacknowledged publication exactly once", async () => {
    const ctx = await freshContext("recoverprepared");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const expected = await store.readFrontierHash("gate-a");
    // Crash window: prepared and shard-synced but the witness CAS never ran.
    const prepared = await store.prepareVerifiedEventPublication({
      scopeId: "scope-gate-a",
      gateId: "gate-a",
      writerId: ctx.writerId,
      operationId: "recover-op-1",
      canonicalEvents: [designClearEvent("gate-a")],
      firstEnrollment: null,
    });
    // While the prepared tail is unanchored the whole workspace read blocks.
    await expect(store.readEvents("gate-a")).rejects.toThrow(
      "review_gate_witness_journal_missing_or_tampered",
    );

    expect(await store.recoverPreparedPublication(prepared.publicationId)).toBe("committed");
    expect(await store.readEvents("gate-a")).toHaveLength(2);
    expect((await store.readEvents("gate-a"))[1]?.eventType).toBe("DESIGN_CLEAR");
    expect(await store.readFrontierHash("gate-a")).not.toBe(expected);
    await store.publishEvents(
      "gate-a",
      [{ ...designClearEvent("gate-a"), epochId: "epoch-later" }],
      await store.readFrontierHash("gate-a"),
    );
    expect(await store.recoverPreparedPublication(prepared.publicationId)).toBe(
      "already_committed",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  it("classifies an unknown publication id as blocked", async () => {
    const ctx = await freshContext("unknownpub");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    expect(await store.recoverPreparedPublication("publication-unknown")).toBe("blocked");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("reports a healthy witnessed journal as clean without rewriting it", async () => {
    const ctx = await freshContext("cleanjournal");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-a", [gateCreatedEvent("gate-a")]);
    const sharded = authorityShardPath(ctx.root, "scope-gate-a", "gate-a");
    const bytesBefore = await readFile(sharded, "utf8");
    const frontier = await store.readFrontierHash("gate-a");

    const recovery = await store.recoverJournal("gate-a");

    expect(recovery).toEqual({ status: "clean", eventCount: 1, frontierHash: frontier });
    expect(await readFile(sharded, "utf8")).toBe(bytesBefore);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("fails closed on recovery for a Gate outside the witnessed membership", async () => {
    const ctx = await freshContext("recovernseen");
    const store = createReviewGateEventStore(
      ctx.root,
      eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
    );
    await seedGate(ctx, store, "gate-seeded", [gateCreatedEvent("gate-seeded")]);
    await expect(store.recoverJournal("gate-unseen")).rejects.toThrow(
      "review_gate_gate_membership_missing",
    );
    store.close();
    closeWitnessFixture(ctx);
  });

  describe("readVerifiedScopeOwned", () => {
    function ownedFrontier(
      workspaceIdentity: string,
      scopes: VerifiedScopeFrontier["scopes"],
    ): AdmissionOwnedWitness {
      const frontier: VerifiedScopeFrontier = Object.freeze({
        workspaceIdentity,
        workspaceEnrollmentId: "enroll-owned",
        scopes,
        writerHeads: Object.freeze([]),
        globalFrontierHash: "global-owned",
      });
      const owned: AdmissionOwnedWitness = {
        read: async () => {
          throw new Error("test_owned_read_unused");
        },
        readVerifiedFrontier: async () => frontier,
        readFirstEnrollmentAuthority: async () => null,
        readInstallation: async () => {
          throw new Error("test_owned_installation_unused");
        },
        assertOwnedScope: () => undefined,
        assertOwnedGate: () => undefined,
        preparePublication: async () => {
          throw new Error("test_owned_prepare_unused");
        },
        publishPreparedJournal: async () => {
          throw new Error("test_owned_publish_unused");
        },
        commitPreparedPublicationCAS: async () => {
          throw new Error("test_owned_commit_unused");
        },
        recoverPreparedPublication: async () => {
          throw new Error("test_owned_recover_unused");
        },
      };
      markAdmissionOwnedWitnessLive(owned);
      return owned;
    }

    it("assembles an owned scope read from the supplied frontier", async () => {
      const ctx = await freshContext("ownedreader");
      const store = createReviewGateEventStore(
        ctx.root,
        eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
      );
      const scopeId = "scope-owned";
      const scope = Object.freeze({
        scopeId,
        workflowContinuityId: "cont-owned",
        canonicalDesignPath: DESIGN_PATH,
        canonicalPlanPath: PLAN_PATH,
        pathPairDigest: "digest-owned",
        provenance: Object.freeze({
          kind: "verified_genesis" as const,
          evidenceDigest: "ev-owned",
          priorScopeId: null,
          priorGateId: null,
        }),
        gateMembership: Object.freeze([]),
      });
      const workspaceIdentity = computeWorkspaceIdentity(ctx.root);
      const owned = ownedFrontier(workspaceIdentity, Object.freeze([scope]));

      const read = await store.readVerifiedScopeOwned(owned, scopeId);

      expect(read.frontier.workspaceIdentity).toBe(workspaceIdentity);
      expect(read.gateIds).toEqual([]);
      expect(read.eventsByGate.size).toBe(0);
      store.close();
      closeWitnessFixture(ctx);
    });

    it("rejects an owned frontier for a different workspace", async () => {
      const ctx = await freshContext("ownedmismatch");
      const store = createReviewGateEventStore(
        ctx.root,
        eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
      );
      const owned = ownedFrontier("other-workspace", Object.freeze([]));

      await expect(store.readVerifiedScopeOwned(owned, "scope-x")).rejects.toThrow(
        "review_gate_workspace_identity_mismatch",
      );
      store.close();
      closeWitnessFixture(ctx);
    });

    it("rejects an owned read for a scope not in the frontier", async () => {
      const ctx = await freshContext("ownedmissing");
      const store = createReviewGateEventStore(
        ctx.root,
        eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
      );
      const workspaceIdentity = computeWorkspaceIdentity(ctx.root);
      const owned = ownedFrontier(workspaceIdentity, Object.freeze([]));

      await expect(store.readVerifiedScopeOwned(owned, "missing-scope")).rejects.toThrow(
        "review_gate_scope_membership_missing",
      );
      store.close();
      closeWitnessFixture(ctx);
    });

    it("rejects an owned witness that was never issued by the transaction entry", async () => {
      const ctx = await freshContext("ownedunissued");
      const store = createReviewGateEventStore(
        ctx.root,
        eventStoreOptions(ctx.root, ctx.writerId, ctx.witness),
      );
      const frontier: VerifiedScopeFrontier = Object.freeze({
        workspaceIdentity: computeWorkspaceIdentity(ctx.root),
        workspaceEnrollmentId: "enroll-unissued",
        scopes: Object.freeze([]),
        writerHeads: Object.freeze([]),
        globalFrontierHash: "global-unissued",
      });
      const forged = {
        readVerifiedFrontier: async () => frontier,
        readFirstEnrollmentAuthority: async () => null,
        readInstallation: async () => null,
        assertOwnedScope: () => undefined,
        assertOwnedGate: () => undefined,
      };

      await expect(store.readVerifiedScopeOwned(forged, "scope-x")).rejects.toThrow(
        "review_gate_admission_owned_witness_invalid",
      );
      store.close();
      closeWitnessFixture(ctx);
    });
  });

  describe("withAdmissionWitnessTransaction", () => {
    const REQUEST_PROTOCOL = createReviewGateProtocolDescriptor();

    function recordingProvider(
      real: LinuxReviewGateProvider,
      trace: string[],
    ): LinuxProvider {
      const wrapHandle = (
        kind: "scope" | "gate",
        id: string,
        handle: ReviewGateLockHandle,
      ): ReviewGateLockHandle =>
        Object.freeze({
          release: () => {
            trace.push(`release:${kind}:${id}`);
            handle.release();
          },
          verifyCloexec: () => handle.verifyCloexec(),
        });
      return {
        ...real,
        acquireScopeLock: async (reviewScopeId) => {
          trace.push(`acquire:scope:${reviewScopeId}`);
          const handle = await real.acquireScopeLock(reviewScopeId);
          return handle === "occupied" ? handle : wrapHandle("scope", reviewScopeId, handle);
        },
        acquireGateLock: async (gateId) => {
          trace.push(`acquire:gate:${gateId}`);
          const handle = await real.acquireGateLock(gateId);
          return handle === "occupied" ? handle : wrapHandle("gate", gateId, handle);
        },
      };
    }

    async function ownedFixture(prefix: string, trace: string[]): Promise<
      Readonly<{
        readonly root: string;
        readonly witness: ReviewGateScopeWitness;
        readonly store: SeedStore;
        readonly ctx: StoreContext;
      }>
    > {
      const root = await freshRoot(prefix);
      // Committed Design/Plan artifacts: the owned observer reads them via
      // the workspace reader and the enrollment requires clean committed targets.
      const docs = path.join(root, "docs");
      await mkdir(docs, { recursive: true });
      await writeFile(path.join(docs, "design.md"), "# Design");
      await writeFile(path.join(docs, "plan.md"), "# Plan");
      await writeFile(path.join(docs, "requirements.md"), "# Requirements");
      execFileSync("git", ["-C", root, "add", "docs/design.md", "docs/plan.md", "docs/requirements.md"]);
      execFileSync("git", [
        "-C", root,
        "-c", "user.name=Fixture",
        "-c", "user.email=fixture@example.invalid",
        "commit", "-qm", "artifacts",
      ]);
      const admin = generateKeyPairSync("ed25519");
      const approve = async (payload: unknown): Promise<string> =>
        sign(null, Buffer.from(computeCanonicalJsonFingerprint(payload)), admin.privateKey).toString(
          "base64",
        );
      const native = createLinuxReviewGateProvider(root);
      if (native === undefined) throw new Error("test_native_provider_missing");
      const lockManager = createReviewGateLockManager(root, {
        provider: recordingProvider(native, trace),
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
      witnessContexts.set(witness, { root, writerId: TEST_WRITER_ID, serial: { value: 0 } });
      const ctx: StoreContext = { root, witness, lockManager, writerId: TEST_WRITER_ID };
      const store = createReviewGateEventStore(
        root,
        eventStoreOptions(root, TEST_WRITER_ID, witness),
      );
      return { root, witness, store, ctx };
    }

    function admissionRequest(root: string): ReviewGateScopeAdmissionRequest {
      return {
        workspaceRoot: root,
        workspaceIdentity: computeWorkspaceIdentity(root),
        designPath: DESIGN_PATH,
        planPath: PLAN_PATH,
        protocol: REQUEST_PROTOCOL,
      };
    }

    /** V2 genesis event bound to the scope the admission lease computes. */
    function gateCreatedV2OwnedEvent(
      gateId: string,
      root: string,
      designPath = DESIGN_PATH,
      planPath = PLAN_PATH,
    ): ReviewGateEventV1 {
      return validateReviewGateEventRecord({
        schemaVersion: 2,
        eventId: `event-owned-${gateId}`,
        parentEventId: `parent-owned-${gateId}`,
        emittedAt: "2026-10-16T00:00:00.000Z",
        gateId,
        epochId: "epoch-1",
        generationId: `generation-owned-${gateId}`,
        writerId: TEST_WRITER_ID,
        eventType: "GATE_CREATED",
        payload: {
          reviewScopeId: computeReviewScopeId(designPath, planPath),
          supersedesGateId: null,
          requirementsResolution: {
            schemaVersion: 2,
            source: "explicit",
            canonicalPath: "docs/requirements.md",
            digest: "2".repeat(64),
            gitMode: "100644",
            requirementsGitBlobOid: "r".repeat(40),
            committedBaselineOid: "c".repeat(40),
            workspaceIdentity: computeWorkspaceIdentity(root),
            selectionEvidence: {},
          },
          designArtifact: { canonicalPath: designPath, digest: "0".repeat(64), gitMode: "100644" },
          planArtifact: { canonicalPath: planPath, digest: "1".repeat(64), gitMode: "100644" },
          reviewProtocolFingerprint: REQUEST_PROTOCOL.reviewProtocolFingerprint,
          designProtocolFingerprint: REQUEST_PROTOCOL.designProtocolFingerprint,
          planProtocolFingerprint: REQUEST_PROTOCOL.planProtocolFingerprint,
        },
      });
    }

    function seedOwnedGate(
      fixture: Readonly<{ root: string; ctx: StoreContext; store: SeedStore }>,
      gateId: string,
      designPath = DESIGN_PATH,
      planPath = PLAN_PATH,
    ): Promise<void> {
      return seedGate(fixture.ctx, fixture.store, gateId, [
        gateCreatedV2OwnedEvent(gateId, fixture.root, designPath, planPath),
      ]);
    }


    it("owned publication acquires each guard once and releases every guard in reverse", async () => {
      const trace: string[] = [];
      const fixture = await ownedFixture("ownedorder", trace);
      await seedOwnedGate(fixture, "gate-a");
      trace.length = 0;

      const requested = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
      const outcome = await fixture.witness.withAdmissionWitnessTransaction(
        admissionRequest(fixture.root),
        async (owned) => {
          const frontier = await owned.readVerifiedFrontier();
          expect(frontier.scopes.map((scope) => scope.scopeId)).toContain(requested);
          // The public witness re-entry is impossible while the owned
          // transaction holds the installation guard and the Gate locks:
          // the admission-order assertion rejects before any lock attempt.
          await expect(fixture.witness.readWorkspaceScopeFrontier()).rejects.toThrow(
            "review_gate_witness_lock_order",
          );
          // The public store read is also a guard-taking re-entry.
          await expect(fixture.store.readVerifiedScope(requested)).rejects.toThrow(
            "review_gate_witness_lock_order",
          );
          const read = await fixture.store.readVerifiedScopeOwned(owned, requested);
          expect(read.gateIds).toEqual(["gate-a"]);
          expect(read.eventsByGate.get("gate-a")?.[0]?.eventType).toBe("GATE_CREATED");
          return "ran" as const;
        },
      );
      expect(outcome).toBe("ran");

      // The enrolled scope IS the computed requested scope: one scope lock,
      // one gate lock, each acquired exactly once and released in reverse.
      expect(trace.filter((entry) => entry.startsWith("acquire:"))).toEqual([
        `acquire:scope:${requested}`,
        "acquire:gate:gate-a",
      ]);
      expect(trace.filter((entry) => entry.startsWith("release:"))).toEqual([
        "release:gate:gate-a",
        `release:scope:${requested}`,
      ]);

      fixture.store.close();
      closeWitnessFixture(fixture.ctx);
    });

    it("releases every guard when the callback throws", async () => {
      const trace: string[] = [];
      const fixture = await ownedFixture("ownedthrow", trace);
      await seedOwnedGate(fixture, "gate-a");
      trace.length = 0;

      await expect(
        fixture.witness.withAdmissionWitnessTransaction(admissionRequest(fixture.root), async () => {
          throw new Error("callback_failure");
        }),
      ).rejects.toThrow("callback_failure");

      const requested = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
      expect(trace.filter((entry) => entry.startsWith("release:"))).toEqual([
        "release:gate:gate-a",
        `release:scope:${requested}`,
      ]);

      // The lease is free again: a second transaction succeeds.
      await expect(
        fixture.witness.withAdmissionWitnessTransaction(
          admissionRequest(fixture.root),
          async () => "reran" as const,
        ),
      ).resolves.toBe("reran");

      fixture.store.close();
      closeWitnessFixture(fixture.ctx);
    });

    it("rejects capability use after release and foreign scope/gate ids", async () => {
      const trace: string[] = [];
      const fixture = await ownedFixture("ownedforeign", trace);
      await seedOwnedGate(fixture, "gate-a");

      let captured: AdmissionOwnedWitness | null = null;
      const requested = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
      await fixture.witness.withAdmissionWitnessTransaction(
        admissionRequest(fixture.root),
        async (owned) => {
          captured = owned;
          expect(() => owned.assertOwnedScope(requested)).not.toThrow();
          expect(() => owned.assertOwnedGate("gate-a")).not.toThrow();
          expect(() => owned.assertOwnedScope("scope-foreign")).toThrow(
            "review_gate_admission_owned_scope_foreign",
          );
          expect(() => owned.assertOwnedGate("gate-foreign")).toThrow(
            "review_gate_admission_owned_gate_foreign",
          );
        },
      );

      if (captured === null) throw new Error("test_owned_not_captured");
      await expect(captured.readVerifiedFrontier()).rejects.toThrow(
        "review_gate_admission_owned_witness_released",
      );
      await expect(captured.readFirstEnrollmentAuthority()).rejects.toThrow(
        "review_gate_admission_owned_witness_released",
      );

      fixture.store.close();
      closeWitnessFixture(fixture.ctx);
    });

    function testObserverOwnedWitness(frontier: VerifiedScopeFrontier): AdmissionOwnedWitness {
      const owned: AdmissionOwnedWitness = {
        readVerifiedFrontier: async () => frontier,
        readFirstEnrollmentAuthority: async () => null,
        readInstallation: async () => {
          throw new Error("test_owned_installation_unused");
        },
        assertOwnedScope: () => undefined,
        assertOwnedGate: () => undefined,
      };
      markAdmissionOwnedWitnessLive(owned);
      return owned;
    }

    it("owned verified history never reenters public reads", async () => {
      const trace: string[] = [];
      const fixture = await ownedFixture("ownedhistory", trace);
      await seedOwnedGate(fixture, "gate-a");
      await seedOwnedGate(fixture, "gate-b", "docs/design-b.md", "docs/plan-b.md");
      const frontier = await fixture.witness.readWorkspaceScopeFrontier();
      const installation = await fixture.witness.readInstallation();
      const publicReads: string[] = [];
      const guardedStore = {
        ...fixture.store,
        readVerifiedScope: (scopeId: string): Promise<never> => {
          publicReads.push(scopeId);
          return Promise.reject(new Error("public_read_forbidden_inside_lease"));
        },
      };
      const owned = testObserverOwnedWitness(frontier);

      const observation = await observeVerifiedAdmissionSnapshotOwned({
        workspaceRoot: fixture.root,
        scopeId: computeReviewScopeId(
          DESIGN_PATH,
          PLAN_PATH,
        ) as import("../../src/core/review-gate-types").ReviewScopeId,
        protocol: REQUEST_PROTOCOL,
        eventStore: guardedStore,
        workspaceReader: {
          readWorkspaceFile: async (filePath) => {
            try {
              const { readFile } = await import("node:fs/promises");
              return await readFile(path.join(fixture.root, filePath));
            } catch {
              return null;
            }
          },
        },
        owned,
        authority: { installation, frontier, firstEnrollment: null },
        request: { designPath: DESIGN_PATH, planPath: PLAN_PATH, explicitRequirementsPath: "docs/requirements.md" },
      });

      expect(publicReads).toEqual([]);
      expect(observation).not.toBeNull();
      const snapshot = observation === null ? null : observation.snapshot;
      if (snapshot === null) throw new Error("test_observation_missing");
      // The requested scope's tips plus every related scope's tips participate
      // in the relation closure, all read through the owned reader.
      expect(snapshot.currentTips.map((tip) => tip.gateId)).toEqual(["gate-a"]);
      const relatedGateIds = snapshot.workspaceContinuity.relatedScopeTips
        .map((tip) => tip.gateId)
        .sort();
      // relatedScopeTips carries the requested scope's tips plus every
      // related scope's tips: gate-b must participate in the closure.
      expect(relatedGateIds).toEqual(["gate-a", "gate-b"]);

      fixture.store.close();
      closeWitnessFixture(fixture.ctx);
    });
  });
});
