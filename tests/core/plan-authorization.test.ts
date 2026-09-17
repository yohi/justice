import { describe, expect, it, vi } from "vitest";
import { PlanParser } from "../../src/core/plan-parser";
import type { AtomicPersistence } from "../../src/core/atomic-persistence";
import {
  buildCanonicalSnapshot,
  computePlanFingerprint,
} from "../../src/core/plan-fingerprint";
import {
  AuthorizationStore,
  createAuthorizationReviewBoundary,
  mergeAuthorizationBindings,
  type ApprovePlanInput,
  type ApprovedPlanBinding,
} from "../../src/core/plan-authorization";
import { createMockFileSystem, type MockFileSystem } from "../helpers/mock-file-system";

const plan = "## Task 1: Approved\n- [ ] implement\n";

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value?: T) => void } {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve: (value) => resolve?.(value as T) };
}

function inputFor(
  sessionId: string,
  planPath: string,
  approvedAt = "2026-09-05T00:00:00.000Z",
): ApprovePlanInput {
  const taskIds = new PlanParser().parse(plan).map((task) => task.id);
  return {
    sessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(plan, taskIds),
    planFingerprint: computePlanFingerprint(plan, taskIds),
    approvedAt,
  };
}

function storeFor(files: MockFileSystem): AuthorizationStore {
  return new AuthorizationStore(files, files, createAuthorizationReviewBoundary());
}

function persistenceFor(
  store: AuthorizationStore,
): AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>> {
  return (store as unknown as {
    readonly authorizationPersistence: AtomicPersistence<ReadonlyArray<ApprovedPlanBinding>>;
  }).authorizationPersistence;
}

function activeBinding(authorizationId: string, sessionId = "s1"): ApprovedPlanBinding {
  return {
    authorizationId,
    sessionId,
    planPath: `docs/${authorizationId}.md`,
    planFingerprint: { algorithm: "sha256", value: authorizationId },
    canonicalSnapshot: {
      schema: "justice-plan-v1",
      documentDigest: authorizationId,
      globalBodyDigest: authorizationId,
      tasks: [],
    },
    fingerprintSchema: "justice-plan-v1",
    approvedAt: "2026-09-05T00:00:00.000Z",
    status: "active",
  };
}

describe("AuthorizationStore", () => {
  it("persists and hydrates the canonical authorization record", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);

    const approved = await store.approve(inputFor("s1", "docs/plan.md"));

    expect(approved?.status).toBe("active");
    expect((await store.hydrate())[0]?.canonicalSnapshot).toEqual(approved?.canonicalSnapshot);
    expect(await store.findByAuthorizationId(approved?.authorizationId ?? "missing")).toEqual(
      approved,
    );
  });

  it("propagates malformed authoritative persistence", async () => {
    const files = createMockFileSystem({ ".justice/authorizations.json": "{" });
    const store = storeFor(files);

    await expect(store.hydrate()).rejects.toThrow();
    await expect(store.approve(inputFor("s1", "docs/plan.md"))).resolves.toBeNull();
  });

  it("supersedes only the active binding in the approving session", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const first = await store.approve(inputFor("s1", "docs/one.md"));
    const other = await store.approve(inputFor("s2", "docs/other.md"));
    const second = await store.approve(inputFor("s1", "docs/two.md"));
    const bindings = await store.hydrate();

    expect(bindings.find((binding) => binding.authorizationId === first?.authorizationId)).toMatchObject({
      status: "invalidated",
      invalidationReason: "plan_superseded",
    });
    expect(bindings.find((binding) => binding.authorizationId === second?.authorizationId)).toMatchObject({
      status: "active",
    });
    expect(bindings.find((binding) => binding.authorizationId === other?.authorizationId)).toMatchObject({
      status: "active",
    });
  });

  it("returns deterministic mutation outcomes and terminalizes active bindings", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const approved = await store.approve(inputFor("s1", "docs/plan.md"));
    const authorizationId = approved?.authorizationId ?? "missing";

    await expect(store.release("missing", "2026-09-05T00:00:00.000Z")).resolves.toEqual({
      kind: "not_found",
    });
    await expect(store.release(authorizationId, "2026-09-05T00:00:00.000Z")).resolves.toMatchObject({
      kind: "saved",
      binding: { status: "released" },
    });
    await expect(store.release(authorizationId, "2026-09-05T00:00:01.000Z")).resolves.toEqual({
      kind: "already_terminal",
    });
  });

  it("invalidates only when the fingerprint differs", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const approved = await store.approve(inputFor("s1", "docs/plan.md"));
    const changed = computePlanFingerprint("changed", []);
    const authorizationId = approved?.authorizationId ?? "missing";

    await expect(
      store.invalidateForFingerprint(authorizationId, approved?.planFingerprint ?? changed, "at"),
    ).resolves.toEqual({ kind: "fingerprint_current" });
    await expect(store.invalidateForFingerprint(authorizationId, changed, "at")).resolves.toMatchObject({
      kind: "saved",
      binding: { status: "invalidated" },
    });
  });

  it("makes terminal state dominate stale active state during merge", () => {
    const active: ApprovedPlanBinding = {
      authorizationId: "same",
      sessionId: "s1",
      planPath: "docs/plan.md",
      planFingerprint: { algorithm: "sha256", value: "a" },
      canonicalSnapshot: {
        schema: "justice-plan-v1",
        documentDigest: "a",
        globalBodyDigest: "b",
        tasks: [],
      },
      fingerprintSchema: "justice-plan-v1",
      approvedAt: "2026-09-05T00:00:00.000Z",
      status: "active",
    };
    const released: ApprovedPlanBinding = {
      ...active,
      status: "released",
      releasedAt: "2026-09-05T00:00:01.000Z",
    };

    expect(mergeAuthorizationBindings([active], [released])).toEqual([released]);
  });

  it("rejects invalid authorization schemas at the persistence boundary", async () => {
    const files = createMockFileSystem({
      ".justice/authorizations.json": JSON.stringify({ version: 1, data: [{}] }),
    });

    await expect(storeFor(files).hydrate()).rejects.toThrow("Invalid authorization binding array");
  });

  it("serializes same-process same-session approvals without a filesystem conflict", async () => {
    const boundary = createAuthorizationReviewBoundary();
    const files = createMockFileSystem();
    const store = new AuthorizationStore(files, files, boundary);
    const firstMutationEntered = deferred<void>();
    const releaseFirstMutation = deferred<void>();
    const originalWriteFile = files.writeFile.bind(files);
    let holdFirstAuthorizationWrite = false;
    let activeMutationBodies = 0;
    let maximumMutationBodies = 0;
    files.writeFile = async (path, content) => {
      if (holdFirstAuthorizationWrite && path.startsWith(".justice/authorizations.json.tmp.")) {
        activeMutationBodies += 1;
        maximumMutationBodies = Math.max(maximumMutationBodies, activeMutationBodies);
        firstMutationEntered.resolve();
        await releaseFirstMutation.promise;
        activeMutationBodies -= 1;
      }
      await originalWriteFile(path, content);
    };

    const old = await store.approve(inputFor("s1", "docs/old.md"));
    holdFirstAuthorizationWrite = true;
    const approvalA = store.approve(inputFor("s1", "docs/a.md"));
    await firstMutationEntered.promise;
    const approvalB = store.approve(inputFor("s1", "docs/b.md"));
    releaseFirstMutation.resolve();
    const [a, b] = await Promise.all([approvalA, approvalB]);
    const durable = await store.hydrate();
    const active = durable.filter(
      (binding) => binding.sessionId === "s1" && binding.status === "active",
    );

    expect(maximumMutationBodies).toBe(1);
    expect([a, b].filter((binding) => binding !== null)).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(durable.find((binding) => binding.authorizationId === old?.authorizationId)).toMatchObject({
      status: "invalidated",
      invalidationReason: "plan_superseded",
    });
    expect(
      durable.filter(
        (binding) =>
          (binding.authorizationId === a?.authorizationId || binding.authorizationId === b?.authorizationId) &&
          binding.status === "invalidated",
      ),
    ).toEqual([expect.objectContaining({ invalidationReason: "plan_superseded" })]);
    expect(
      [a, b].some(
        (binding) => binding?.authorizationId === active[0]?.authorizationId,
      ),
    ).toBe(true);
  });

  it("merges a cross-process version conflict through independent boundaries", async () => {
    const firstTwoLinkAttempts = deferred<void>();
    const firstClaimCompleted = deferred<void>();
    const files = createMockFileSystem();
    const boundaryA = createAuthorizationReviewBoundary();
    const boundaryB = createAuthorizationReviewBoundary();
    const storeA = new AuthorizationStore(files, files, boundaryA);
    const storeB = new AuthorizationStore(files, files, boundaryB);
    const link = files.link;
    if (link === undefined) throw new Error("authorization fixture requires link support");
    const originalLink = link.bind(files);
    let coordinateContenders = false;
    let linkAttempts = 0;
    files.link = async (target, claimPath) => {
      if (!coordinateContenders) return originalLink(target, claimPath);
      linkAttempts += 1;
      if (linkAttempts <= 2) {
        if (linkAttempts === 1) {
          firstTwoLinkAttempts.resolve();
          await firstTwoLinkAttempts.promise;
          await originalLink(target, claimPath);
          firstClaimCompleted.resolve();
          return;
        }
        await firstTwoLinkAttempts.promise;
        await firstClaimCompleted.promise;
      }
      await originalLink(target, claimPath);
    };

    const old = await storeA.approve(inputFor("s1", "docs/old.md"));
    const other = await storeA.approve(inputFor("s2", "docs/other.md"));
    coordinateContenders = true;
    const approvalA = storeA.approve(inputFor("s1", "docs/a.md", "2026-09-05T00:00:02.000Z"));
    const approvalB = storeB.approve(inputFor("s1", "docs/b.md", "2026-09-05T00:00:01.000Z"));
    await firstTwoLinkAttempts.promise;
    const [a, b] = await Promise.all([approvalA, approvalB]);
    const durable = await storeA.hydrate();
    const active = durable.filter(
      (binding) => binding.sessionId === "s1" && binding.status === "active",
    );
    const freshDurable = durable.filter(
      (binding) =>
        binding.sessionId === "s1" &&
        (binding.planPath === "docs/a.md" || binding.planPath === "docs/b.md"),
    );
    const freshWinner = freshDurable.find((binding) => binding.status === "active");
    const freshLoser = freshDurable.find(
      (binding) =>
        binding.status === "invalidated" && binding.invalidationReason === "plan_superseded",
    );

    expect(linkAttempts).toBeGreaterThanOrEqual(4);
    expect(active).toHaveLength(1);
    expect(freshDurable.filter((binding) => binding.status === "active")).toHaveLength(1);
    expect(freshLoser).toBeDefined();
    expect(freshLoser).toMatchObject({
      status: "invalidated",
      invalidationReason: "plan_superseded",
    });
    expect(freshWinner).toEqual(active[0]);
    const winnerResult = freshWinner?.planPath === "docs/a.md" ? a : b;
    const loserResult = freshLoser?.planPath === "docs/a.md" ? a : b;
    expect(winnerResult).toEqual(freshWinner);
    expect(loserResult).toBeNull();
    expect(durable.find((binding) => binding.authorizationId === old?.authorizationId)).toMatchObject({
      status: "invalidated",
      invalidationReason: "plan_superseded",
    });
    expect(durable.find((binding) => binding.authorizationId === other?.authorizationId)).toMatchObject({
      status: "active",
    });
  });

  it("does not invoke a reconciler when the authoritative save diverts", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const reconciler = vi.fn();
    const persistence = persistenceFor(store);
    vi.spyOn(persistence, "saveAtomicWithLock").mockResolvedValueOnce({
      status: "conflict_diverted",
      retries: 3,
      conflictPath: ".justice/authorizations.conflict.json",
    });

    await expect(
      store.approveWithinAuthorizationReviewBoundary(inputFor("s1", "docs/plan.md"), reconciler),
    ).resolves.toBeNull();
    expect(reconciler).not.toHaveBeenCalled();
  });

  it("returns null when the authorization save throws", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const persistence = persistenceFor(store);
    vi.spyOn(persistence, "saveAtomicWithLock").mockRejectedValueOnce(new Error("save failed"));

    await expect(
      store.approveWithinAuthorizationReviewBoundary(inputFor("s1", "docs/plan.md"), vi.fn()),
    ).resolves.toBeNull();
  });

  it("returns null when authoritative state contains multiple active bindings", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const persistence = persistenceFor(store);
    const current = activeBinding("existing", "other");
    const firstActive = activeBinding("first", "s1");
    const secondActive = activeBinding("second", "s1");
    vi.spyOn(persistence, "loadWithLock")
      .mockResolvedValueOnce({ data: [current], lockMeta: { version: 1 } })
      .mockResolvedValueOnce({
        data: [current, firstActive, secondActive],
        lockMeta: { version: 2 },
      });
    vi.spyOn(persistence, "saveAtomicWithLock").mockResolvedValueOnce({
      status: "saved",
      retries: 0,
    });
    const reconciler = vi.fn();

    await expect(
      store.approveWithinAuthorizationReviewBoundary(inputFor("s1", "docs/plan.md"), reconciler),
    ).resolves.toBeNull();
    expect(reconciler).toHaveBeenCalledWith("s1", null);
  });

  it("returns failed when mutation persistence lookups throw", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const persistence = persistenceFor(store);
    vi.spyOn(persistence, "loadWithLock").mockRejectedValue(new Error("load failed"));

    await expect(store.release("auth-1", "at")).resolves.toEqual({ kind: "failed" });
    await expect(
      store.releaseWithinAuthorizationReviewBoundary("s1", "auth-1", "at"),
    ).resolves.toEqual({ kind: "failed" });
    await expect(
      store.invalidateForFingerprint("auth-1", { algorithm: "sha256", value: "changed" }, "at"),
    ).resolves.toEqual({ kind: "failed" });
    await expect(
      store.invalidateForFingerprintWithinAuthorizationReviewBoundary(
        "s1",
        "auth-1",
        { algorithm: "sha256", value: "changed" },
        "at",
      ),
    ).resolves.toEqual({ kind: "failed" });
    await expect(
      store.invalidateMissingPlanWithinAuthorizationReviewBoundary("s1", "auth-1", "at"),
    ).resolves.toEqual({ kind: "failed" });
  });

  it("returns uncertain when releasing cannot save the terminal binding", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const approved = await store.approve(inputFor("s1", "docs/plan.md"));
    const persistence = persistenceFor(store);
    vi.spyOn(persistence, "saveAtomicWithLock").mockResolvedValueOnce({
      status: "conflict_diverted",
      retries: 3,
      conflictPath: ".justice/authorizations.conflict.json",
    });

    await expect(
      store.releaseWithinAuthorizationReviewBoundary(
        "s1",
        approved?.authorizationId ?? "missing",
        "2026-09-05T00:00:01.000Z",
      ),
    ).resolves.toEqual({ kind: "uncertain" });
  });

  it("rejects a binding with an unknown terminal status", async () => {
    const files = createMockFileSystem({
      ".justice/authorizations.json": JSON.stringify([
        {
          ...activeBinding("auth-1"),
          status: "unknown",
        },
      ]),
    });

    await expect(storeFor(files).hydrate()).rejects.toThrow("Invalid authorization binding array");
  });
});
