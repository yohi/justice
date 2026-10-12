import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type {
  GateCreatedV1,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
} from "../../src/core/review-gate-types";
import { encodeReviewGateEventRecord, validateReviewGateEventRecord } from "../../src/core/review-gate/event-schema";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  computeReviewScopeId,
  computeWorkspaceIdentity,
} from "../../src/core/review-gate/identity";
import { createReviewGateEventStore } from "../../src/runtime/review-gate-event-store";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import { createReviewGateApprovalLookup } from "../../src/runtime/review-gate-approval";
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

const REQUIREMENTS_PATH = "requirements.md";
const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const SCOPE_ID = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
const PROTOCOL = createReviewGateProtocolDescriptor();
const TEST_WRITER_ID = "writer-1";

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

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.witness`, { recursive: true, force: true });
  }
});

/**
 * Fresh approval workspace. The protected witness verifies a Git-discovered,
 * committed, CLEAN workspace identity, so the artifact files are committed
 * before the witness is created.
 */
function freshRoot(): string {
  const root = `${tmpdir()}/justice-task14-approval-${Math.random().toString(36).slice(2)}`;
  tempRoots.push(root);
  mkdirSync(path.join(root, "docs"), { recursive: true });
  execFileSync("git", ["init", "-q", root]);
  return root;
}

async function createFreshContext(): Promise<StoreContext> {
  const root = freshRoot();
  const fixtures = await createWitnessForTest(root, TEST_WRITER_ID);
  return { root, ...fixtures, writerId: TEST_WRITER_ID };
}

type StoreContext = Readonly<{
  readonly root: string;
  readonly witness: ReviewGateScopeWitness;
  readonly lockManager: ReviewGateLockManager;
  readonly writerId: string;
}>;

const EMPTY_SHARD_HASH = "0".repeat(64);

function writerHeadKey(
  head: Readonly<{ scopeId: string; gateId: string; writerId: string }>,
): string {
  return `${head.scopeId}\u0000${head.gateId}\u0000${head.writerId}`;
}

function nextSeedId(label: string): string {
  return `${label}-${Math.random().toString(36).slice(2)}`;
}

/** Publish one not-yet-witnessed Gate's events through the protected witness. */
async function publishWitnessSeed(
  ctx: StoreContext,
  gateId: string,
  scopeId: string,
  events: readonly ReviewGateEvent[],
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
      (left, right) =>
        writerHeadKey(left) < writerHeadKey(right) ? -1 : writerHeadKey(left) > writerHeadKey(right) ? 1 : 0,
    ),
  };
  const globalFrontierHash = computeCanonicalJsonFingerprint(contents);
  const operationId = nextSeedId("seed");
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
    expectedWriterHash: priorHead?.hash ?? EMPTY_SHARD_HASH,
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
    expectedWriterHash: priorHead?.hash ?? EMPTY_SHARD_HASH,
  });
  if (cas !== "advanced") throw new Error(`test_seed_cas_failed:${cas}`);
}

/**
 * Seed one Gate's events into an authority store on a real witness. The first
 * seeded Gate is the workspace's witnessed genesis; every later Gate gets its
 * own independently-authorized scope.
 */
async function seedGate(
  ctx: StoreContext,
  store: ReturnType<typeof createReviewGateEventStore>,
  gateId: string,
  events: readonly ReviewGateEvent[],
): Promise<void> {
  const approve = witnessApprovers.get(ctx.witness);
  if (approve === undefined) throw new Error("test_witness_missing_approver");
  const trusted = witnessEnrollments.get(ctx.witness);

  if (trusted === undefined) {
    const genesis = events[0] as GateCreatedV1 | undefined;
    if (genesis?.eventType !== "GATE_CREATED") {
      throw new Error("test_seed_requires_gate_created");
    }
    const auth = await authorizeFirstWorkspaceEnrollment({
      witness: ctx.witness,
      designPath: genesis.payload.designArtifact.canonicalPath,
      planPath: genesis.payload.planArtifact.canonicalPath,
      workflowNonce: nextSeedId("nonce"),
      operationId: nextSeedId("enroll"),
      authorize: approve,
    });
    await ctx.witness.verifyFirstWorkspaceEnrollment(auth);
    witnessEnrollments.set(ctx.witness, auth);
    const prepared = await store.prepareVerifiedEventPublication({
      scopeId: genesis.payload.reviewScopeId,
      gateId,
      writerId: ctx.writerId,
      operationId: nextSeedId("seed"),
      canonicalEvents: events,
      firstEnrollment: {
        authorization: auth,
        generationId: "generation-1",
        workflowContinuityId: nextSeedId("continuity"),
      },
    });
    const outcome = await store.publishPreparedEvent(prepared);
    if (outcome !== "committed") throw new Error(`test_seed_publication_failed:${outcome}`);
    return;
  }

  const genesis = events[0] as GateCreatedV1;
  if (genesis.eventType !== "GATE_CREATED") throw new Error("test_seed_requires_gate_created");
  const scopeId = genesis.payload.reviewScopeId;
  const designPath = genesis.payload.designArtifact.canonicalPath;
  const planPath = genesis.payload.planArtifact.canonicalPath;
  const prior = await ctx.witness.readWorkspaceScopeFrontier();
  const existing = prior.scopes.find((scope) => scope.scopeId === scopeId);
  if (existing === undefined) {
    const authorized = await authorizeScopeEnrollment({
      witness: ctx.witness,
      scope: {
        scopeId,
        workflowContinuityId: nextSeedId("continuity"),
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
            generationId: nextSeedId("generation"),
            supersedesGateId: null,
            admissionEventId: nextSeedId("admission"),
            writerIds: [ctx.writerId],
          },
        ],
      },
      operationId: nextSeedId("scope"),
      authorize: approve,
    });
    await publishWitnessSeed(ctx, gateId, scopeId, events, authorized);
    return;
  }
  await store.appendEvents(gateId, events);
}

function writeWorkspaceFiles(root: string, files: ReadonlyMap<string, string>): void {
  for (const [relative, content] of files) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

function digestOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

let gateSerial = 0;

async function seedCompletedGate(
  ctx: StoreContext,
  store: ReturnType<typeof createReviewGateEventStore>,
  files: ReadonlyMap<string, string>,
  drifts: Readonly<{
    readonly planPath?: string;
    readonly planDigest?: string;
    readonly designDigest?: string;
    readonly requirementsDigest?: string;
    readonly protocolFingerprint?: string;
    readonly approvedAt?: string;
    readonly reviewScopeId?: string;
  }> = {},
): Promise<ReviewApprovalBindingV1> {
  gateSerial += 1;
  const gateId = `gate-approve-${gateSerial}`;

  const planPath = drifts.planPath ?? PLAN_PATH;
  const designDigest = drifts.designDigest ?? digestOf(files.get(DESIGN_PATH) ?? "");
  const planDigest = drifts.planDigest ?? digestOf(files.get(PLAN_PATH) ?? "");
  const requirementsDigest = drifts.requirementsDigest ?? digestOf(files.get(REQUIREMENTS_PATH) ?? "");

  const binding: ReviewApprovalBindingV1 = {
    reviewScopeId: drifts.reviewScopeId ?? computeReviewScopeId(DESIGN_PATH, planPath),
    gateId,
    designArtifact: { canonicalPath: DESIGN_PATH, digest: designDigest, gitMode: "100644" },
    planArtifact: { canonicalPath: planPath, digest: planDigest, gitMode: "100644" },
    requirementsResolution: {
      source: "explicit",
      canonicalPath: REQUIREMENTS_PATH,
      digest: requirementsDigest,
    },
    reviewProtocolFingerprint: drifts.protocolFingerprint ?? PROTOCOL.reviewProtocolFingerprint,
    designProtocolFingerprint: PROTOCOL.designProtocolFingerprint,
    planProtocolFingerprint: PROTOCOL.planProtocolFingerprint,
    approvedAt: drifts.approvedAt ?? "2026-10-08T00:10:00.000Z",
  };

  const gateCreated: GateCreatedV1 = {
    eventType: "GATE_CREATED",
    gateId,
    writerId: ctx.writerId,
    epochId: "epoch-1",
    emittedAt: "2026-10-08T00:00:00.000Z",
    payload: {
      reviewScopeId: binding.reviewScopeId,
      designArtifact: binding.designArtifact,
      planArtifact: binding.planArtifact,
      requirementsResolution: binding.requirementsResolution,
      reviewProtocolFingerprint: binding.reviewProtocolFingerprint,
    },
  };
  const completion: ReviewGateEvent = {
    eventType: "COMPLETED_APPROVAL_BINDING",
    gateId,
    writerId: ctx.writerId,
    epochId: "epoch-2",
    emittedAt: "2026-10-08T00:10:01.000Z",
    payload: { approvalBinding: binding },
  };
  await seedGate(ctx, store, gateId, [gateCreated as unknown as ReviewGateEvent, completion]);
  return binding;
}

function fsWorkspaceReader(root: string) {
  return {
    readWorkspaceFile: async (path_: string): Promise<Buffer | null> => {
      try {
        return await (await import("node:fs/promises")).readFile(path.join(root, path_));
      } catch {
        return null;
      }
    },
  };
}

async function createStandardWorkspace(): Promise<{
  readonly root: string;
  readonly files: Map<string, string>;
  readonly store: ReturnType<typeof createReviewGateEventStore>;
  readonly ctx: StoreContext;
}> {
  const ctx = await createFreshContext();
  const files = new Map<string, string>([
    [REQUIREMENTS_PATH, "# Requirements\nScope of the change\n"],
    [DESIGN_PATH, "# Design\nReviewed behavior\n"],
    [PLAN_PATH, "## Task 1: Build\n- [ ] Build it\n"],
  ]);
  mkdirSync(path.join(ctx.root, "docs"), { recursive: true });
  writeWorkspaceFiles(ctx.root, files);
  execFileSync("git", ["-C", ctx.root, "add", "."]);
  execFileSync("git", [
    "-C",
    ctx.root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "workspace",
  ]);
  const store = createReviewGateEventStore(ctx.root, {
    workspaceIdentity: computeWorkspaceIdentity(ctx.root),
    writerId: ctx.writerId,
    witness: ctx.witness,
  });
  return { root: ctx.root, files, store, ctx };
}

function createLookup(
  root: string,
  store: ReturnType<typeof createReviewGateEventStore>,
) {
  return createReviewGateApprovalLookup({
    eventStore: store,
    workspaceReader: fsWorkspaceReader(root),
    protocol: PROTOCOL,
  });
}

/** Seed one ACTIVE (created, never completed) Gate in the canonical scope. */
async function seedActiveGate(
  ctx: StoreContext,
  store: ReturnType<typeof createReviewGateEventStore>,
): Promise<string> {
  gateSerial += 1;
  const gateId = `gate-active-${gateSerial}`;
  const gateCreated: GateCreatedV1 = {
    eventType: "GATE_CREATED",
    gateId,
    writerId: ctx.writerId,
    epochId: "epoch-1",
    emittedAt: "2026-10-08T00:00:00.000Z",
    payload: {
      reviewScopeId: SCOPE_ID,
      designArtifact: {
        canonicalPath: DESIGN_PATH,
        digest: "0000000000000000000000000000000000000000000000000000000000000000",
        gitMode: "100644",
      },
      planArtifact: {
        canonicalPath: PLAN_PATH,
        digest: "1111111111111111111111111111111111111111111111111111111111111111",
        gitMode: "100644",
      },
      requirementsResolution: {
        source: "explicit",
        canonicalPath: REQUIREMENTS_PATH,
        digest: "2222222222222222222222222222222222222222222222222222222222222222",
      },
      reviewProtocolFingerprint: PROTOCOL.reviewProtocolFingerprint,
    },
  };
  await seedGate(ctx, store, gateId, [gateCreated as unknown as ReviewGateEvent]);
  return gateId;
}

function authorityShardPath(root: string, scopeId: string, gateId: string, writerId: string): string {
  return path.join(root, ".justice", "review-gates", "events", scopeId, gateId, `${writerId}.jsonl`);
}

describe("ReviewGateApprovalLookup — exact structured binding", () => {
  it("approves a restarted process from durable history alone (no in-memory state)", async () => {
    const { root, files, store, ctx } = await createStandardWorkspace();
    const binding = await seedCompletedGate(ctx, store, files);
    store.close();

    // Fresh process: brand new store instance over the same durable root.
    const storeAfterRestart = createReviewGateEventStore(root, {
      workspaceIdentity: computeWorkspaceIdentity(root),
      writerId: ctx.writerId,
      witness: ctx.witness,
    });
    const lookup = createLookup(root, storeAfterRestart);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);

    expect(outcome).toEqual({
      kind: "approved",
      gateId: binding.gateId,
      binding,
    });
    storeAfterRestart.close();
    closeWitnessFixture(ctx);
  });

  it.each([
    ["requirements", "requirements"],
    ["design", "design"],
    ["plan", "plan"],
    ["protocol", "protocol"],
  ])("fails closed on %s-only drift", async (label, kind) => {
    const { root, files, store, ctx } = await createStandardWorkspace();
    const drifts: Parameters<typeof seedCompletedGate>[3] = {};
    if (kind === "requirements") {
      drifts.requirementsDigest = digestOf(`${files.get(REQUIREMENTS_PATH)}stale\n`);
    } else if (kind === "design") {
      drifts.designDigest = `${"d".repeat(63)}0`;
    } else if (kind === "plan") {
      drifts.planDigest = `${"p".repeat(63)}0`;
    } else {
      drifts.protocolFingerprint = `${"f".repeat(63)}0`;
    }
    await seedCompletedGate(ctx, store, files, drifts);

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);

    expect(outcome.kind).toBe("not_approved");
    expect(label).toBeTypeOf("string");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("returns not_approved when the plan never completed any Review Gate", async () => {
    const { root, store, ctx } = await createStandardWorkspace();
    await seedActiveGate(ctx, store);

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("not_approved");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("reports identity_conflict when two completed approvals exactly match now, across scope namespaces", async () => {
    const { root, files, store, ctx } = await createStandardWorkspace();
    await seedCompletedGate(ctx, store, files);
    // A second scope namespace (different Design path → different scope id)
    // whose completed binding is ALSO an exact current match.
    await seedCompletedGate(ctx, store, files, {
      approvedAt: "2026-10-08T00:11:00.000Z",
      reviewScopeId: computeReviewScopeId("docs/design-2.md", PLAN_PATH),
    });

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("identity_conflict");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("does not match candidates from other plan paths", async () => {
    const { root, files, store, ctx } = await createStandardWorkspace();
    await seedCompletedGate(ctx, store, files, { planPath: "docs/other-plan.md" });

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("not_approved");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("fails closed when an unrelated gate history is unreadable", async () => {
    const { root, files, store, ctx } = await createStandardWorkspace();
    await seedCompletedGate(ctx, store, files);
    // Seed an unrelated gate in its own scope namespace, then tamper its
    // authority shard so any workspace frontier verification fails closed.
    const unrelated = await seedCompletedGate(ctx, store, files, {
      planPath: "docs/unrelated-plan.md",
    });
    const unrelatedScopeId = unrelated.reviewScopeId;
    store.close();
    await appendFile(
      authorityShardPath(root, unrelatedScopeId, unrelated.gateId, ctx.writerId),
      '{"eventType": "GATE", "partial"',
    );

    const reopened = createReviewGateEventStore(root, {
      workspaceIdentity: computeWorkspaceIdentity(root),
      writerId: ctx.writerId,
      witness: ctx.witness,
    });
    const lookup = createLookup(root, reopened);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome).toEqual({ kind: "history_unavailable" });
    reopened.close();
    closeWitnessFixture(ctx);
  });

  it("never mutates the stale completed Gate on binding mismatch", async () => {
    const { root, files, store, ctx } = await createStandardWorkspace();
    const binding = await seedCompletedGate(ctx, store, files);
    const ledgerPath = authorityShardPath(root, binding.reviewScopeId, binding.gateId, ctx.writerId);
    const bytesBefore = readFileSync(ledgerPath, "utf8");

    writeWorkspaceFiles(root, new Map([[PLAN_PATH, "## Task 1: Build\n- [ ] changed\n"]]));
    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("not_approved");

    expect(readFileSync(ledgerPath, "utf8")).toBe(bytesBefore);
    store.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateApprovalLookup — candidate enumeration", () => {
  it("lists completed candidates for the requested plan only", async () => {
    const { root, files, store, ctx } = await createStandardWorkspace();
    const binding = await seedCompletedGate(ctx, store, files);
    await seedCompletedGate(ctx, store, files, { planPath: "docs/other-plan.md" });

    const lookup = createLookup(root, store);
    const candidates = await lookup.listCompletedApprovalCandidates(PLAN_PATH);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.gateId).toBe(binding.gateId);
    expect(candidates[0]?.binding.planArtifact.canonicalPath).toBe(PLAN_PATH);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("returns an empty list without any completed gate", async () => {
    const { root, store, ctx } = await createStandardWorkspace();
    await seedActiveGate(ctx, store);
    const lookup = createLookup(root, store);
    expect(await lookup.listCompletedApprovalCandidates(PLAN_PATH)).toEqual([]);
    store.close();
    closeWitnessFixture(ctx);
  });
});