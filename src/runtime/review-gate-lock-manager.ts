import { createLinuxReviewGateProvider } from "./linux-review-gate-provider.js";
import type {
  LinuxReviewGateProvider,
  ReviewGateLockHandle,
} from "./linux-review-gate-provider.js";

export type { ReviewGateLockHandle } from "./linux-review-gate-provider.js";

export interface ReviewGateLockManager {
  readonly acquireScopeLock: (reviewScopeId: string) => Promise<ReviewGateLockHandle | "occupied">;
  readonly acquireGateLock: (gateId: string) => Promise<ReviewGateLockHandle | "occupied">;
  readonly close: () => void;
}

export interface ReviewGateLockManagerOptions {
  readonly provider?: LinuxReviewGateProvider | null;
}

type InProcessLockState = {
  readonly scopeLocks: Map<string, ReviewGateLockHandle>;
  readonly gateLocks: Map<string, ReviewGateLockHandle>;
};

const inProcessLockStates = new Map<string, InProcessLockState>();

/**
 * Create a lock manager that uses the supplied Linux Review Gate provider if
 * available. The in-process Map-backed provider is available only when
 * explicitly selected with `provider: null` (tests).
 */
export function createReviewGateLockManager(
  workspaceRoot: string,
  options: ReviewGateLockManagerOptions = {},
): ReviewGateLockManager {
  const provider =
    options.provider === undefined
      ? createLinuxReviewGateProvider(workspaceRoot)
      : options.provider;
  if (provider) {
    const ownsProvider = options.provider === undefined;
    const heldHandles = new Set<ReviewGateLockHandle>();
    let closed = false;
    const acquire = async (
      operation: () => Promise<ReviewGateLockHandle | "occupied">,
    ): Promise<ReviewGateLockHandle | "occupied"> => {
      if (closed) throw new Error("review_gate_lock_manager_closed");
      const handle = await operation();
      if (handle === "occupied") return handle;
      let released = false;
      const tracked: ReviewGateLockHandle = Object.freeze({
        release: () => {
          if (released) return;
          released = true;
          heldHandles.delete(tracked);
          handle.release();
        },
        verifyCloexec: () => handle.verifyCloexec(),
      });
      if (closed) {
        tracked.release();
        throw new Error("review_gate_lock_manager_closed");
      }
      heldHandles.add(tracked);
      return tracked;
    };
    return {
      acquireScopeLock: (reviewScopeId) => acquire(() => provider.acquireScopeLock(reviewScopeId)),
      acquireGateLock: (gateId) => acquire(() => provider.acquireGateLock(gateId)),
      close: () => {
        if (closed) return;
        closed = true;
        for (const handle of heldHandles) handle.release();
        heldHandles.clear();
        if (ownsProvider) provider.close();
      },
    };
  }

  if (options.provider !== null) throw new Error("review_gate_lock_provider_unavailable");

  let closed = false;
  let state = inProcessLockStates.get(workspaceRoot);
  if (state === undefined) {
    state = { scopeLocks: new Map(), gateLocks: new Map() };
    inProcessLockStates.set(workspaceRoot, state);
  }
  const { scopeLocks, gateLocks } = state;
  const heldHandles = new Set<ReviewGateLockHandle>();

  const makeHandle = (map: Map<string, ReviewGateLockHandle>, id: string): ReviewGateLockHandle => {
    let released = false;
    const handle: ReviewGateLockHandle = Object.freeze({
      release: () => {
        if (!released) {
          released = true;
          heldHandles.delete(handle);
          map.delete(id);
        }
      },
      verifyCloexec: () => true,
    });
    return handle;
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
    heldHandles.add(handle);
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
      for (const handle of heldHandles) handle.release();
      heldHandles.clear();
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
  | {
      readonly kind: "acquired";
      readonly scopeLock: ReviewGateLockHandle;
      readonly gateLock: ReviewGateLockHandle;
    }
  | { readonly kind: "occupied"; readonly stage: "scope" | "gate" }
> {
  const scopeLock = await manager.acquireScopeLock(reviewScopeId);
  if (scopeLock === "occupied") return { kind: "occupied", stage: "scope" };

  let gateLock: ReviewGateLockHandle | "occupied";
  try {
    gateLock = await manager.acquireGateLock(gateId);
  } catch (error: unknown) {
    scopeLock.release();
    throw error;
  }
  if (gateLock === "occupied") {
    scopeLock.release();
    return { kind: "occupied", stage: "gate" };
  }

  return { kind: "acquired", scopeLock, gateLock };
}
