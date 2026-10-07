import {
  hasGlibcRuntime,
  loadJusticeLinuxNativeAddon,
  type JusticeLinuxNativeGateLockHandle,
  type JusticeLinuxNativeGateRoot,
} from "./linux-native-addon";

export type ReviewGateLockHandle = Readonly<{
  readonly release: () => void;
  readonly verifyCloexec: () => boolean;
}>;

export type LinuxReviewGateProvider = Readonly<{
  readonly acquireScopeLock: (reviewScopeId: string) => Promise<ReviewGateLockHandle | "occupied">;
  readonly acquireGateLock: (gateId: string) => Promise<ReviewGateLockHandle | "occupied">;
  readonly acquireRecoveryGcLock: () => Promise<ReviewGateLockHandle | "occupied">;
  readonly listScopeIds: () => Promise<readonly string[]>;
  readonly listGateIds: (reviewScopeId: string) => Promise<readonly string[]>;
  readonly listWriterIds: (reviewScopeId: string, gateId: string) => Promise<readonly string[]>;
  readonly readWriterShard: (
    reviewScopeId: string,
    gateId: string,
    writerId: string,
  ) => Promise<Buffer | null>;
  readonly durableReplaceWriterShard: (
    reviewScopeId: string,
    gateId: string,
    writerId: string,
    previousDigest: string | null,
    bytes: Buffer,
  ) => Promise<void>;
  readonly publishRecoveryObject: (digest: string, bytes: Buffer) => Promise<"created" | "exists">;
  readonly readRecoveryObject: (digest: string) => Promise<Buffer | null>;
  readonly listRecoveryObjects: () => Promise<readonly string[]>;
  readonly deleteRecoveryObject: (digest: string) => Promise<void>;
  readonly readWorkspaceFile: (path: string) => Promise<Buffer | null>;
  readonly replaceWorkspaceFileExact: (
    path: string,
    expectedCurrent: Readonly<{ readonly digest: string; readonly gitMode: "100644" | "100755" }>,
    replacement: Readonly<{ readonly bytes: Buffer; readonly gitMode: "100644" | "100755" }>,
  ) => Promise<void>;
  readonly close: () => void;
}>;

const PROVIDER_CLOSED = "provider_closed";
const REVIEW_GATE_INVALID_ID = "review_gate_invalid_id";
const REVIEW_GATE_INVALID_DIGEST = "review_gate_invalid_digest";
const REVIEW_GATE_INVALID_PATH = "review_gate_invalid_path";
const REVIEW_GATE_LOCK_UNAVAILABLE = "review_gate_lock_unavailable";
const REVIEW_GATE_UNAVAILABLE = "review_gate_unavailable";

export function createLinuxReviewGateProvider(
  rootDir: string,
): LinuxReviewGateProvider | undefined {
  if (process.platform !== "linux" || process.arch !== "x64" || !hasGlibcRuntime()) {
    return undefined;
  }
  const addon = loadJusticeLinuxNativeAddon();
  if (addon?.gate === undefined) return undefined;
  const gate = addon.gate;

  let root: JusticeLinuxNativeGateRoot;
  try {
    root = gate.openReviewGateRoot(rootDir);
  } catch {
    // Fail-open: an unavailable native gate root yields no provider instead of
    // crashing the session.
    return undefined;
  }

  const heldLocks: Array<JusticeLinuxNativeGateLockHandle> = [];
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error(PROVIDER_CLOSED);
  };


  const syncFromRoot = <T,>(dispatch: () => T, fallbackCode: string): T => {
    try {
      return dispatch();
    } catch (cause: unknown) {
      throw new Error(nativeErrorCode(cause) ?? fallbackCode, { cause });
    }
  };

  const assertGateId = (value: string): void => {
    if (
      value === "" ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("..") ||
      value.includes("\u0000")
    ) {
      throw new Error(REVIEW_GATE_INVALID_ID);
    }
  };

  const assertDigest = (value: string): void => {
    if (value === "" || !/^[0-9a-f]+$/u.test(value)) {
      throw new Error(REVIEW_GATE_INVALID_DIGEST);
    }
  };

  const assertWorkspacePath = (value: string): void => {
    if (
      value === "" ||
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\u0000")
    ) {
      throw new Error(REVIEW_GATE_INVALID_PATH);
    }
    for (const component of value.split("/")) {
      if (component === "" || component === "." || component === "..") {
        throw new Error(REVIEW_GATE_INVALID_PATH);
      }
    }
  };

  const assertGateIds = (...values: readonly string[]): void => {
    for (const value of values) assertGateId(value);
  };

  const assertDigestArgument = (value: string | null): void => {
    if (value === null) return;
    assertDigest(value);
  };

  const trackLock = (native: JusticeLinuxNativeGateLockHandle): ReviewGateLockHandle => {
    heldLocks.push(native);
    return {
      release: () => {
        const index = heldLocks.indexOf(native);
        if (index >= 0) heldLocks.splice(index, 1);
        native.release();
      },
      verifyCloexec: () => native.verifyCloexec(),
    };
  };

  const acquireLock = async (
    dispatch: () => JusticeLinuxNativeGateLockHandle | "occupied",
  ): Promise<ReviewGateLockHandle | "occupied"> => {
    let outcome: JusticeLinuxNativeGateLockHandle | "occupied";
    try {
      outcome = dispatch();
    } catch (cause: unknown) {
      throw new Error(nativeErrorCode(cause) ?? REVIEW_GATE_LOCK_UNAVAILABLE, { cause });
    }
    if (outcome === "occupied") return "occupied";
    return trackLock(outcome);
  };

  return {
    acquireScopeLock: async (reviewScopeId) => {
      assertOpen();
      assertGateId(reviewScopeId);
      return acquireLock(() => root.acquireScopeLock(reviewScopeId));
    },
    acquireGateLock: async (gateId) => {
      assertOpen();
      assertGateId(gateId);
      return acquireLock(() => root.acquireGateLock(gateId));
    },
    acquireRecoveryGcLock: async () => {
      assertOpen();
      return acquireLock(() => root.acquireRecoveryGcLock());
    },
    listScopeIds: async () => {
      assertOpen();
      return syncFromRoot(() => root.listScopeIds(), REVIEW_GATE_UNAVAILABLE);
    },
    listGateIds: async (reviewScopeId) => {
      assertOpen();
      assertGateId(reviewScopeId);
      return syncFromRoot(() => root.listGateIds(reviewScopeId), REVIEW_GATE_UNAVAILABLE);
    },
    listWriterIds: async (reviewScopeId, gateId) => {
      assertOpen();
      assertGateIds(reviewScopeId, gateId);
      return syncFromRoot(
        () => root.listWriterIds(reviewScopeId, gateId),
        REVIEW_GATE_UNAVAILABLE,
      );
    },
    readWriterShard: async (reviewScopeId, gateId, writerId) => {
      assertOpen();
      assertGateIds(reviewScopeId, gateId, writerId);
      return syncFromRoot(
        () => root.readWriterShard(reviewScopeId, gateId, writerId),
        REVIEW_GATE_UNAVAILABLE,
      );
    },
    durableReplaceWriterShard: async (reviewScopeId, gateId, writerId, previousDigest, bytes) => {
      assertOpen();
      assertGateIds(reviewScopeId, gateId, writerId);
      assertDigestArgument(previousDigest);
      return syncFromRoot(
        () =>
          root.durableReplaceWriterShard(
            reviewScopeId,
            gateId,
            writerId,
            previousDigest,
            bytes,
          ),
        REVIEW_GATE_UNAVAILABLE,
      );
    },
    publishRecoveryObject: async (digest, bytes) => {
      assertOpen();
      assertDigest(digest);
      return syncFromRoot(() => root.publishRecoveryObject(digest, bytes), REVIEW_GATE_UNAVAILABLE);
    },
    readRecoveryObject: async (digest) => {
      assertOpen();
      assertDigest(digest);
      return syncFromRoot(() => root.readRecoveryObject(digest), REVIEW_GATE_UNAVAILABLE);
    },
    listRecoveryObjects: async () => {
      assertOpen();
      return syncFromRoot(() => root.listRecoveryObjects(), REVIEW_GATE_UNAVAILABLE);
    },
    deleteRecoveryObject: async (digest) => {
      assertOpen();
      assertDigest(digest);
      return syncFromRoot(() => root.deleteRecoveryObject(digest), REVIEW_GATE_UNAVAILABLE);
    },
    readWorkspaceFile: async (path) => {
      assertOpen();
      assertWorkspacePath(path);
      return syncFromRoot(() => root.readWorkspaceFile(path), REVIEW_GATE_UNAVAILABLE);
    },
    replaceWorkspaceFileExact: async (path, expectedCurrent, replacement) => {
      assertOpen();
      assertWorkspacePath(path);
      assertDigest(expectedCurrent.digest);
      return syncFromRoot(
        () =>
          root.replaceWorkspaceFileExact(
            path,
            expectedCurrent.digest,
            expectedCurrent.gitMode,
            replacement.bytes,
            replacement.gitMode,
          ),
        REVIEW_GATE_UNAVAILABLE,
      );
    },
    close: () => {
      if (closed) return;
      const lingering = heldLocks.splice(0, heldLocks.length);
      for (const lock of lingering) {
        try {
          lock.release();
        } catch {
          // Fail-open: lock release at close is best-effort.
        }
      }
      try {
        root.close();
      } catch {
        // Fail-open: the native root is already closing.
      }
      closed = true;
    },
  };
}

function nativeErrorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const [code] = cause.message.split(":", 1);
  if (code === undefined) return undefined;
  return /^[a-z][a-z0-9_]*$/u.test(code) ? code : undefined;
}
