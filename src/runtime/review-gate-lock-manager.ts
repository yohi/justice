import { createLinuxReviewGateProvider } from "./linux-review-gate-provider.js";
import type { LinuxReviewGateProvider, ReviewGateLockHandle } from "./linux-review-gate-provider.js";

export type { ReviewGateLockHandle } from "./linux-review-gate-provider.js";

export interface ReviewGateLockManager {
  readonly acquireScopeLock: (reviewScopeId: string) => Promise<ReviewGateLockHandle | "occupied">;
  readonly acquireGateLock: (gateId: string) => Promise<ReviewGateLockHandle | "occupied">;
  readonly close: () => void;
}

export interface ReviewGateLockManagerOptions {
  readonly provider?: LinuxReviewGateProvider | null;
}

/**
 * Create a lock manager that uses the supplied Linux Review Gate provider if
 * available, otherwise an in-process Map-backed fallback for tests.
 * If `provider` is omitted (not explicitly `null`), the Linux provider is
 * probed once; if it is not available, the in-process fallback is used.
 */
export function createReviewGateLockManager(
  workspaceRoot: string,
  options: ReviewGateLockManagerOptions = {},
): ReviewGateLockManager {
  const provider = options.provider === undefined ? createLinuxReviewGateProvider(workspaceRoot) : options.provider;
  if (provider) {
    return {
      acquireScopeLock: (reviewScopeId) => provider.acquireScopeLock(reviewScopeId),
      acquireGateLock: (gateId) => provider.acquireGateLock(gateId),
      close: () => undefined,
    };
  }

  let closed = false;
  const scopeLocks = new Map<string, ReviewGateLockHandle>();
  const gateLocks = new Map<string, ReviewGateLockHandle>();

  const makeHandle = (map: Map<string, ReviewGateLockHandle>, id: string): ReviewGateLockHandle => {
    let released = false;
    return Object.freeze({
      release: () => {
        if (!released) {
          released = true;
          map.delete(id);
        }
      },
      verifyCloexec: () => true,
    });
  };

  const acquire = (
    map: Map<string, ReviewGateLockHandle>,
    id: string,
  ): ReviewGateLockHandle | "occupied" => {
    if (closed) {
      throw new Error("review_gate_lock_manager_closed");
    }
    if (map.has(id)) return "occupied";
    const handle = makeHandle(map, id);
    map.set(id, handle);
    return handle;
  };

  const safeAcquire = async (
    map: Map<string, ReviewGateLockHandle>,
    id: string,
  ): Promise<ReviewGateLockHandle | "occupied"> => acquire(map, id);

  return {
    acquireScopeLock: (reviewScopeId) => safeAcquire(scopeLocks, reviewScopeId),
    acquireGateLock: (gateId) => safeAcquire(gateLocks, gateId),
    close: () => {
      if (closed) return;
      closed = true;
      for (const handle of scopeLocks.values()) handle.release();
      for (const handle of gateLocks.values()) handle.release();
      scopeLocks.clear();
      gateLocks.clear();
    },
  };
}

/**
 * Acquire the scope lock and then the Gate lock. On Gate-lock failure the
 * scope lock is released again so callers never hold a partial chain.
 */
export async function acquireGateLockChain(
  manager: ReviewGateLockManager,
  reviewScopeId: string,
  gateId: string,
): Promise<
  | { readonly kind: "acquired"; readonly scopeLock: ReviewGateLockHandle; readonly gateLock: ReviewGateLockHandle }
  | { readonly kind: "occupied"; readonly stage: "scope" | "gate" }
> {
  const scopeLock = await manager.acquireScopeLock(reviewScopeId);
  if (scopeLock === "occupied") return { kind: "occupied", stage: "scope" };

  const gateLock = await manager.acquireGateLock(gateId);
  if (gateLock === "occupied") {
    scopeLock.release();
    return { kind: "occupied", stage: "gate" };
  }

  return { kind: "acquired", scopeLock, gateLock };
}
