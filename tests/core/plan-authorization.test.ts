import { describe, expect, it, vi } from "vitest";
import { PlanParser } from "../../src/core/plan-parser";
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

function inputFor(sessionId: string, planPath: string, content = plan): ApprovePlanInput {
  const taskIds = new PlanParser().parse(content).map((task) => task.id);
  return {
    sessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(content, taskIds),
    planFingerprint: computePlanFingerprint(content, taskIds),
    approvedAt: "2026-09-05T00:00:00.000Z",
  };
}

function storeFor(files: MockFileSystem): AuthorizationStore {
  return new AuthorizationStore(files, files, createAuthorizationReviewBoundary());
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

  it("serializes same-session approvals through one boundary", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);

    const [first, second] = await Promise.all([
      store.approve(inputFor("same-session", "docs/first.md")),
      store.approve(inputFor("same-session", "docs/second.md")),
    ]);

    const active = (await store.hydrate()).filter(
      (binding) => binding.sessionId === "same-session" && binding.status === "active",
    );
    expect([first, second].filter((binding) => binding !== null)).toHaveLength(2);
    expect(active).toHaveLength(1);
  });

  it("merges approvals from independent boundaries into one active session binding", async () => {
    const files = createMockFileSystem();
    const storeA = new AuthorizationStore(files, files, createAuthorizationReviewBoundary());
    const storeB = new AuthorizationStore(files, files, createAuthorizationReviewBoundary());

    const [first, second] = await Promise.all([
      storeA.approve(inputFor("cross-process", "docs/first.md")),
      storeB.approve(inputFor("cross-process", "docs/second.md")),
    ]);

    const active = (await storeA.hydrate()).filter(
      (binding) => binding.sessionId === "cross-process" && binding.status === "active",
    );
    expect(active).toHaveLength(1);
    expect([first, second].filter((binding) => binding?.authorizationId === active[0]?.authorizationId)).toHaveLength(1);
  });

  it("does not invoke a reconciler when the authoritative save diverts", async () => {
    const files = createMockFileSystem();
    const store = storeFor(files);
    const reconciler = vi.fn();
    const persistence = (store as unknown as {
      readonly authorizationPersistence: { saveAtomicWithLock: typeof store.approve };
    }).authorizationPersistence;
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
});
