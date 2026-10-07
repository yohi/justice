import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { LinuxReviewGateProvider, ReviewGateLockHandle } from "../../src/runtime/linux-review-gate-provider";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

function freshRoot(): string {
  const root = `${tmpdir()}/justice-task12a-locks-${Math.random().toString(36).slice(2)}`;
  tempRoots.push(root);
  return root;
}

function makeProviderMock(calls: string[]): LinuxReviewGateProvider {
  const handleFor = (name: string): ReviewGateLockHandle =>
    Object.freeze({
      release: () => {
        calls.push(`release:${name}`);
      },
      verifyCloexec: () => true,
    });
  return {
    acquireScopeLock: vi.fn(async (reviewScopeId: string) => {
      calls.push(`acquireScopeLock:${reviewScopeId}`);
      return handleFor(`scope:${reviewScopeId}`);
    }),
    acquireGateLock: vi.fn(async (gateId: string) => {
      calls.push(`acquireGateLock:${gateId}`);
      return handleFor(`gate:${gateId}`);
    }),
    acquireRecoveryGcLock: vi.fn(async () => {
      calls.push("acquireRecoveryGcLock");
      return handleFor("gc");
    }),
    listScopeIds: vi.fn(async () => {
      calls.push("listScopeIds");
      return [];
    }),
    listGateIds: vi.fn(async () => {
      calls.push("listGateIds");
      return [];
    }),
    listWriterIds: vi.fn(async () => []),
    readWriterShard: vi.fn(async () => null),
    durableReplaceWriterShard: vi.fn(async () => undefined),
    publishRecoveryObject: vi.fn(async () => "created"),
    readRecoveryObject: vi.fn(async () => null),
    listRecoveryObjects: vi.fn(async () => []),
    deleteRecoveryObject: vi.fn(async () => undefined),
    readWorkspaceFile: vi.fn(async () => null),
    replaceWorkspaceFileExact: vi.fn(async () => undefined),
    close: vi.fn(() => {
      calls.push("provider.close");
    }),
  };
}

describe("ReviewGateLockManager — in-memory fallback (no in-memory contamination)", () => {
  it("reflects LinuxReviewGateProvider semantics: handle then occupied then release", async () => {
    const manager = createReviewGateLockManager(freshRoot(), { provider: null });

    const first = await manager.acquireScopeLock("scope-a");
    expect(first).not.toBe("occupied");
    const firstHandle = first === "occupied" ? undefined : first;
    expect(firstHandle?.verifyCloexec()).toBe(true);

    expect(await manager.acquireScopeLock("scope-a")).toBe("occupied");
    expect(await manager.acquireGateLock("scope-a")).not.toBe("occupied");
    // a gate id may collide with a scope id: separate lock namespaces
    expect(await manager.acquireGateLock("scope-a")).toBe("occupied");

    if (firstHandle) firstHandle.release();
    expect(await manager.acquireScopeLock("scope-a")).not.toBe("occupied");

    const scope = await manager.acquireScopeLock("scope-b");
    expect(scope).not.toBe("occupied");
    const gate = await manager.acquireGateLock("gate-b");
    expect(await manager.acquireScopeLock("scope-b")).toBe("occupied");
    expect(await manager.acquireGateLock("gate-b")).toBe("occupied");

    if (scope !== "occupied") scope.release();
    expect(await manager.acquireScopeLock("scope-b")).not.toBe("occupied");
    expect(await manager.acquireGateLock("gate-b")).toBe("occupied");

    if (gate !== "occupied") gate.release();
    expect(await manager.acquireGateLock("gate-b")).not.toBe("occupied");
    manager.close();
  });

  it("releases every held lock when the manager closes and refuses later acquires", async () => {
    const root = freshRoot();
    const manager = createReviewGateLockManager(root, { provider: null });
    await manager.acquireScopeLock("scope-c");
    await manager.acquireGateLock("gate-c");

    manager.close();
    manager.close(); // idempotent

    await expect(manager.acquireScopeLock("scope-c")).rejects.toThrow(
      "review_gate_lock_manager_closed",
    );
    await expect(manager.acquireGateLock("gate-c")).rejects.toThrow(
      "review_gate_lock_manager_closed",
    );
    // close() released every held lock: nothing in memory remains occupied
    const next = createReviewGateLockManager(root, { provider: null });
    expect(await next.acquireGateLock("gate-c")).not.toBe("occupied");
    next.close();
  });

  it("handles re-entrant scope/gate acquisition across ids concurrently", async () => {
    const manager = createReviewGateLockManager(freshRoot(), { provider: null });

    const results = await Promise.all([
      manager.acquireGateLock("gate-x"),
      manager.acquireGateLock("gate-x"),
      manager.acquireGateLock("gate-y"),
    ]);
    const taken = results.map((result) => result !== "occupied");
    expect(taken).toEqual([true, false, true]);
    for (const result of results) {
      if (result !== "occupied") result.release();
    }
    manager.close();
  });
});

describe("ReviewGateLockManager — native provider delegation", () => {
  it("delegates acquisitions to the supplied provider", async () => {
    const calls: string[] = [];
    const provider = makeProviderMock(calls);
    const manager = createReviewGateLockManager(freshRoot(), { provider });

    const handle = await manager.acquireScopeLock("scope-d");
    expect(calls).toContain("acquireScopeLock:scope-d");
    expect(await manager.acquireGateLock("gate-d")).not.toBe("occupied");
    expect(calls).toContain("acquireGateLock:gate-d");

    // a native "occupied" decision is passed through verbatim
    provider.acquireScopeLock = vi.fn(async () => "occupied");
    expect(await manager.acquireScopeLock("scope-d")).toBe("occupied");

    if (handle !== "occupied") handle.release();
    expect(calls).toContain("release:scope:scope-d");
    // a caller-owned provider is not closed by the manager
    expect(calls).not.toContain("provider.close");
    manager.close();
    expect(calls).not.toContain("provider.close");
  });
});

describe("ReviewGateLockManager — auto substrate probe", () => {
  it("serves acquisitions without an explicit provider choice", async () => {
    const manager = createReviewGateLockManager(freshRoot());
    const handle = await manager.acquireScopeLock("scope-e");
    expect(handle).not.toBe("occupied");
    if (handle !== "occupied") handle.release();
    manager.close();
  });
});
