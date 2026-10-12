import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ReviewGateEvent } from "../../src/core/review-gate-types";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../../src/core/review-gate/event-schema";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  computeReviewScopeId,
  computeWorkspaceIdentity,
} from "../../src/core/review-gate/identity";
import { createReviewGateEventStore, type ReviewGateEventStore } from "../../src/runtime/review-gate-event-store";
import { createReviewGateRecoveryStore } from "../../src/runtime/review-gate-recovery-store";
import { createReviewGateHistoryService } from "../../src/runtime/review-gate-history";
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
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const SCOPE_ID = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
const TEST_WRITER_ID = "writer-1";

/** One per-witness host authority: the Ed25519 trust root signing every authorization. */
const witnessApprovers = new WeakMap<ReviewGateScopeWitness, (payload: unknown) => Promise<string>>();
/** Pinned admin admin keypair per witness; re-exportable as the host trust root env PEM. */
const witnessAdmins = new WeakMap<ReviewGateScopeWitness, ReturnType<typeof generateKeyPairSync>>();
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
  witnessAdmins.set(witness, admin);
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
 * Fresh test workspace. The protected witness verifies a Git-discovered,
 * committed, clean workspace identity, so every root is initialized as a Git
 * repository with one empty commit before any seeds.
 */
async function freshRoot(): Promise<string> {
  const root = `${tmpdir()}/justice-task13-history-${Math.random().toString(36).slice(2)}`;
  await mkdir(root, { recursive: true });
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

type StoreContext = Readonly<{
  readonly root: string;
  readonly witness: ReviewGateScopeWitness;
  readonly lockManager: ReviewGateLockManager;
  readonly writerId: string;
}>;

let emitted = 0;
function nextAt(): string {
  emitted += 1;
  return new Date(Date.UTC(2026, 9, 8, 0, 0, emitted)).toISOString();
}

function gateCreatedEvent(
  gateId: string,
  scopeId: string,
  designPath = DESIGN_PATH,
  planPath = PLAN_PATH,
): ReviewGateEvent {
  return {
    eventType: "GATE_CREATED",
    gateId,
    writerId: TEST_WRITER_ID,
    epochId: "epoch-1",
    emittedAt: nextAt(),
    payload: {
      reviewScopeId: scopeId,
      designArtifact: { canonicalPath: designPath, digest: "d", gitMode: "100644" },
      planArtifact: { canonicalPath: planPath, digest: "p", gitMode: "100644" },
      requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest: "r" },
      reviewProtocolFingerprint: "f".repeat(64),
    },
  } as unknown as ReviewGateEvent;
}

function approvalBinding(planPath: string, digest: string): ReviewGateEvent {
  return {
    eventType: "COMPLETED_APPROVAL_BINDING",
    gateId: "filled-later",
    writerId: TEST_WRITER_ID,
    epochId: "epoch-c",
    emittedAt: nextAt(),
    payload: {
      approvalBinding: {
        reviewScopeId: SCOPE_ID,
        gateId: "filled-later",
        designArtifact: { canonicalPath: DESIGN_PATH, digest: "d", gitMode: "100644" },
        planArtifact: { canonicalPath: planPath, digest, gitMode: "100644" },
        requirementsResolution: { source: "explicit", canonicalPath: "requirements.md", digest: "r" },
        reviewProtocolFingerprint: "f".repeat(64),
        designProtocolFingerprint: "e".repeat(64),
        planProtocolFingerprint: "g".repeat(64),
        approvedAt: "2026-10-08T00:10:00.000Z",
      },
    },
  } as unknown as ReviewGateEvent;
}

function generatedEvents(
  gateId: string,
  scopeId: string,
  extra: readonly ReviewGateEvent[],
  designPath = DESIGN_PATH,
  planPath = PLAN_PATH,
): readonly ReviewGateEvent[] {
  const created = gateCreatedEvent(gateId, scopeId, designPath, planPath);
  const patched = extra.map((event) => ({ ...event, gateId }) as unknown as ReviewGateEvent);
  return [created, ...patched];
}


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
 * Authorize one scope admission for a seed: a brand-new scope when absent, or
 * the extension of the existing scope's membership with `gateId` (as a
 * successor of `supersedesGateId` for the assertCompletedPredecessor route).
 */
async function authorizeAdditionalScopeForSeed(
  ctx: StoreContext,
  scopeId: string,
  designPath: string,
  planPath: string,
  gateId: string,
  supersedesGateId: string | null,
): Promise<Parameters<ReturnType<typeof authorizeScopeEnrollment>>[0]["scope"]> {
  const approve = witnessApprovers.get(ctx.witness);
  if (approve === undefined) throw new Error("test_witness_missing_approver");
  const prior = await ctx.witness.readWorkspaceScopeFrontier();
  const existing = prior.scopes.find((scope) => scope.scopeId === scopeId);
  const requested =
    existing !== undefined
      ? {
          ...existing,
          gateMembership: [
            ...existing.gateMembership,
            {
              gateId,
              generationId: nextSeedId("generation"),
              supersedesGateId,
              admissionEventId: nextSeedId("admission"),
              writerIds: [ctx.writerId],
            },
          ].slice().sort((left, right) =>
              left.gateId < right.gateId ? -1 : left.gateId > right.gateId ? 1 : 0,
            ),
        }
      : {
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
              supersedesGateId,
              admissionEventId: nextSeedId("admission"),
              writerIds: [ctx.writerId],
            },
          ],
        };
  return authorizeScopeEnrollment({
    witness: ctx.witness,
    scope: requested,
    operationId: nextSeedId("scope"),
    authorize: approve,
  });
}


/**
 * Seed one Gate's events into an authority store on a real witness. The first
 * seeded Gate is the workspace's witnessed genesis (its scope index is left to
 * the test); a later Gate is seeded onto its own independently-authorized
 * scope, or — with `supersedesGateId` — as a successor Gate within an existing
 * scope whose predecessor history projects completed.
 */
async function seedGate(
  ctx: StoreContext,
  store: ReviewGateEventStore,
  gateId: string,
  scopeId: string,
  extra: readonly ReviewGateEvent[] = [],
  options: Readonly<{
    readonly supersedesGateId?: string;
    readonly designPath?: string;
    readonly planPath?: string;
  }> = {},
): Promise<void> {
  const events = generatedEvents(gateId, scopeId, extra, options.designPath, options.planPath);
  await seedGateBytes(ctx, store, gateId, scopeId, events, options);
}

/** Seed raw events (the history may deliberately lack a genesis event). */
async function seedGateBytes(
  ctx: StoreContext,
  store: ReviewGateEventStore,
  gateId: string,
  scopeId: string,
  events: readonly ReviewGateEvent[],
  options: Readonly<{
    readonly supersedesGateId?: string;
    readonly designPath?: string;
    readonly planPath?: string;
  }> = {},
): Promise<void> {
  const approve = witnessApprovers.get(ctx.witness);
  if (approve === undefined) throw new Error("test_witness_missing_approver");
  const designPath = options.designPath ?? DESIGN_PATH;
  const planPath = options.planPath ?? PLAN_PATH;
  const trusted = witnessEnrollments.get(ctx.witness);

  if (trusted === undefined) {
    const auth = await authorizeFirstWorkspaceEnrollment({
      witness: ctx.witness,
      designPath,
      planPath,
      workflowNonce: nextSeedId("nonce"),
      operationId: nextSeedId("enroll"),
      authorize: approve,
    });
    await ctx.witness.verifyFirstWorkspaceEnrollment(auth);
    witnessEnrollments.set(ctx.witness, auth);
    const prepared = await store.prepareVerifiedEventPublication({
      scopeId,
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

  const authorized = await authorizeAdditionalScopeForSeed(
    ctx,
    scopeId,
    designPath,
    planPath,
    gateId,
    options.supersedesGateId ?? null,
  );
  await publishWitnessSeed(ctx, gateId, scopeId, events, authorized);
}

function countingProxy(store: ReviewGateEventStore): {
  readonly store: ReviewGateEventStore;
  readonly readCalls: Map<string, number>;
} {
  const readCalls = new Map<string, number>();
  const proxy: ReviewGateEventStore = {
    ...store,
    readEvents: async (gateId) => {
      readCalls.set(gateId, (readCalls.get(gateId) ?? 0) + 1);
      return store.readEvents(gateId);
    },
  };
  return { store: proxy, readCalls };
}

function listWorkspaceFiles(rootDir: string): {
  readonly paths: ReadonlyMap<string, string>;
} {
  const paths = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (full.endsWith("/.git") || full.endsWith(".witness")) continue;
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else paths.set(full, readFileSync(full, "utf8"));
    }
  };
  walk(rootDir);
  return { paths };
}

const failureOf = (result: { kind: string }) => result;

async function freshStoreContext(): Promise<StoreContext> {
  const root = await freshRoot();
  const fixtures = await createWitnessForTest(root, TEST_WRITER_ID);
  return { root, ...fixtures, writerId: TEST_WRITER_ID };
}

function createStore(ctx: StoreContext): ReviewGateEventStore {
  return createReviewGateEventStore(ctx.root, {
    workspaceIdentity: computeWorkspaceIdentity(ctx.root),
    writerId: ctx.writerId,
    witness: ctx.witness,
  });
}


describe("OpenCodeAdapter — /justice-review-history wiring", () => {
  it("replaces host parts with the durable history display", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-adapter", SCOPE_ID);

    // The adapter builds its own runtime graph; its witness wiring only
    // succeeds when the protected witness directory and the pinned host trust
    // root arrive through the deployment environment. The display then reads
    // the same witnessed membership this context seeded.
    const previousWitnessDir = process.env["JUSTICE_REVIEW_GATE_WITNESS_DIR"];
    const previousTrustRoot = process.env["JUSTICE_REVIEW_GATE_HOST_TRUST_ROOT"];
    const admin = witnessAdmins.get(ctx.witness);
    if (admin === undefined) throw new Error("test_witness_missing_admin");
    process.env["JUSTICE_REVIEW_GATE_WITNESS_DIR"] = `${ctx.root}.witness`;
    process.env["JUSTICE_REVIEW_GATE_HOST_TRUST_ROOT"] = admin.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    try {
      const adapter = new OpenCodeAdapter(fakeInit({ directory: ctx.root, worktree: ctx.root }));
      const output = { parts: [{ type: "text", text: "$ARGUMENTS expanded" } as never] };
      await adapter.onCommandExecuteBefore(
        {
          command: "/justice-review-history",
          sessionID: "session-adapter",
          arguments: "--design docs/design.md --plan docs/plan.md",
        },
        output as never,
      );

      expect(output.parts).toHaveLength(1);
      const text = (output.parts[0] as unknown as { text: string }).text;
      expect(text).toContain("[JUSTICE: REVIEW HISTORY]");
      expect(text).toContain("gateId: gate-adapter");
    } finally {
      if (previousWitnessDir === undefined) delete process.env["JUSTICE_REVIEW_GATE_WITNESS_DIR"];
      else process.env["JUSTICE_REVIEW_GATE_WITNESS_DIR"] = previousWitnessDir;
      if (previousTrustRoot === undefined) delete process.env["JUSTICE_REVIEW_GATE_HOST_TRUST_ROOT"];
      else process.env["JUSTICE_REVIEW_GATE_HOST_TRUST_ROOT"] = previousTrustRoot;
    }
    store.close();
    closeWitnessFixture(ctx);
  });

  it("replaces rejected arguments with the canonical rejected directive", async () => {
    const ctx = await freshStoreContext();
    const adapter = new OpenCodeAdapter(fakeInit({ directory: ctx.root, worktree: ctx.root }));
    const output = { parts: [{ type: "text", text: "$ARGUMENTS expanded" } as never] };

    await adapter.onCommandExecuteBefore(
      {
        command: "justice-review-history",
        sessionID: "session-adapter",
        arguments: "--gate ../escape",
      },
      output as never,
    );

    const text = (output.parts[0] as unknown as { text: string }).text;
    expect(text).toContain("[JUSTICE: COMMAND REJECTED]");
    expect(text).toContain("/justice-review-history");
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateHistoryService — scope tip selection", () => {
  it("conflicts across scopes when a non-empty history has no genesis event", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    // The workspace genesis lives on a throwaway scope; the broken Gate below
    // rides its own scope and its history deliberately lacks GATE_CREATED.
    await seedGate(ctx, store, "gate-throwaway", "scope-throwaway", [], {
      designPath: "docs/throwaway-design.md",
      planPath: "docs/throwaway-plan.md",
    });
    await seedGate(ctx, store, "gate-broken", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")]);
    const brokenStore: ReviewGateEventStore = {
      ...store,
      readEvents: async (gateId) => {
        const events = await store.readEvents(gateId);
        return gateId === "gate-broken" ? events.slice(1) : events;
      },
    };

    const service = createReviewGateHistoryService({ eventStore: brokenStore, rootDir: ctx.root });
    const result = await service.queryScope("docs/unrelated-design.md", "docs/unrelated-plan.md", {
      view: "summary",
      allGenerations: false,
    });

    expect(result.kind === "failure" ? result.failure : "").toBe("conflict");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("selects a unique ACTIVE tip by default", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-gen1", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")]);
    // gate-gen2 is the next generation of the completed gate-gen1.
    await seedGate(ctx, store, "gate-gen2", SCOPE_ID, [], {
      supersedesGateId: "gate-gen1",
    });

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind).toBe("display");
    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error("unexpected");
    expect(result.payload.dto.gateId).toBe("gate-gen2");
    expect(result.payload.dto.status).toBe("active");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("selects the unique completed chain tip when no active/suspended tip exists", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-old", SCOPE_ID, [approvalBinding(PLAN_PATH, "older")]);
    await seedGate(ctx, store, "gate-new", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")], {
      supersedesGateId: "gate-old",
    });

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error(failureOf(result));
    expect(result.payload.dto.gateId).toBe("gate-new");
    expect(result.payload.dto.status).toBe("completed");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("reports a conflict when a scope's gate history is broken", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-a", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")]);
    // A second generation whose history carries a duplicate genesis projects
    // broken, which keeps the scope query fail-closed.
    const duplicated = [
      ...generatedEvents("gate-b", SCOPE_ID, []),
      { ...gateCreatedEvent("gate-b", SCOPE_ID) },
    ];
    await seedGateBytes(ctx, store, "gate-b", SCOPE_ID, duplicated, {
      supersedesGateId: "gate-a",
    });

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind).toBe("failure");
    expect(result.kind === "failure" ? result.failure : "").toBe("conflict");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("returns not_found when no gate namespace exists for the scope", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-throwaway", "scope-throwaway", [], {
      designPath: "docs/throwaway-design.md",
      planPath: "docs/throwaway-plan.md",
    });

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind === "failure" ? result.failure : "").toBe("not_found");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("fails closed with unavailable when the witnessed journals fail verification", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-a", SCOPE_ID);
    // Tamper the authority shard outside the witness.
    const sharded = path.join(
      ctx.root,
      ".justice",
      "review-gates",
      "events",
      SCOPE_ID,
      "gate-a",
      `${ctx.writerId}.jsonl`,
    );
    await appendFile(sharded, '{"eventType": "GATE", "partial"');

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: false });

    expect(result.kind === "failure" ? result.failure : "").toBe("unavailable");
    store.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateHistoryService — gate query", () => {
  it("--gate locates the gate namespace without decoding genesis for membership", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-iso", SCOPE_ID);

    const spy = countingProxy(store);
    const service = createReviewGateHistoryService({ eventStore: spy.store, rootDir: ctx.root });
    const result = await service.queryGate("gate-iso", { view: "summary" });

    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error(failureOf(result));
    expect(result.payload.dto.gateId).toBe("gate-iso");
    // The query captured the gate shard bytes once and projected one coherent prefix.
    expect(spy.readCalls.get("gate-iso")).toBe(1);
    store.close();
    closeWitnessFixture(ctx);
  });

  it("returns not_found for an unknown gate id", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-iso", SCOPE_ID);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryGate("gate-missing", { view: "summary" });
    expect(result.kind === "failure" ? result.failure : "").toBe("not_found");
    store.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateHistoryService — views and generations", () => {
  it("renders the requested views without changings shape", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-a", SCOPE_ID);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const rounds = await service.queryGate("gate-a", { view: "rounds" });
    const findings = await service.queryGate("gate-a", { view: "findings" });

    expect(rounds.kind === "display" ? rounds.payload.view : "").toBe("rounds");
    expect(findings.kind === "display" ? findings.payload.view : "").toBe("findings");
    store.close();
    closeWitnessFixture(ctx);
  });

  it("lists every generation of the scope oldest → newest with --all-generations", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-gen1", SCOPE_ID, [approvalBinding(PLAN_PATH, "older")]);
    await seedGate(ctx, store, "gate-gen2", SCOPE_ID, [], { supersedesGateId: "gate-gen1" });

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: true });

    expect(result.kind === "display" ? result.payload.view : "").toBe("generations");
    if (result.kind === "display" && result.payload.view === "generations") {
      expect(
        result.payload.dto.generations.map(
          (generation) => (generation as { dto: { gateId: string } }).dto.gateId,
        ),
      ).toEqual(["gate-gen1", "gate-gen2"]);
    }
    store.close();
    closeWitnessFixture(ctx);
  });

  it("never mutates durable history across a query", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-a", SCOPE_ID);
    const before = listWorkspaceFiles(ctx.root);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    await service.queryScope(DESIGN_PATH, PLAN_PATH, { view: "summary", allGenerations: true });
    await service.queryGate("gate-a", { view: "findings" });

    const after = listWorkspaceFiles(ctx.root);
    expect([...after.paths.keys()].sort()).toEqual([...before.paths.keys()].sort());
    for (const [file, bytes] of before.paths) {
      expect(after.paths.get(file)).toBe(bytes);
    }
    store.close();
    closeWitnessFixture(ctx);
  });
});

describe("ReviewGateHistoryService — storage diagnostics", () => {
  it("reports non-authoritative counts, bytes, and recovery objects", async () => {
    const ctx = await freshStoreContext();
    const store = createStore(ctx);
    await seedGate(ctx, store, "gate-a", SCOPE_ID, [approvalBinding(PLAN_PATH, "p")]);
    await seedGate(ctx, store, "gate-b", "scope-other-gate-b", [], {
      designPath: "docs/design.md",
      planPath: "docs/other.md",
    });
    const recovery = createReviewGateRecoveryStore(ctx.root);
    const bytesOne = Buffer.from("recovery-bytes-1");
    const bytesTwo = Buffer.from("recovery-bytes-22");
    const decodeHex = (bytes: Buffer): string =>
      createHash("sha256").update(bytes).digest("hex");
    await Promise.all([
      recovery.publish(decodeHex(bytesOne), bytesOne),
      recovery.publish(decodeHex(bytesTwo), bytesTwo),
    ]);

    const service = createReviewGateHistoryService({ eventStore: store, rootDir: ctx.root });
    const result = await service.queryGate("gate-a", { view: "summary" });

    if (result.kind !== "display" || result.payload.view !== "summary") throw new Error(failureOf(result));
    const storage = result.payload.dto.storage;
    expect(storage).toMatchObject({
      gateCount: 2,
      activeGates: 1,
      completedGates: 1,
      suspendedGates: 0,
      unreadableGates: 0,
      eventCount: 3,
      recoveryObjectCount: 2,
    });
    expect(storage?.eventBytes).toBeGreaterThan(0);
    expect(storage?.recoveryBytes).toBeGreaterThan(0);
    expect(storage?.oldestGate).toMatchObject({ gateId: "gate-a" });
    recovery.close();
    store.close();
    closeWitnessFixture(ctx);
  });
});
