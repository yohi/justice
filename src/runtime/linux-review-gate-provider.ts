import { hasGlibcRuntime, loadJusticeLinuxNativeAddon } from "./linux-native-addon";

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

const notImplemented = (): never => {
  throw new Error("not_implemented");
};

export function createLinuxReviewGateProvider(
  rootDir: string,
): LinuxReviewGateProvider | undefined {
  if (process.platform !== "linux" || process.arch !== "x64" || !hasGlibcRuntime()) {
    return undefined;
  }
  const addon = loadJusticeLinuxNativeAddon();
  if (addon?.gate === undefined) return undefined;

  void rootDir;
  return {
    acquireScopeLock: async () => notImplemented(),
    acquireGateLock: async () => notImplemented(),
    acquireRecoveryGcLock: async () => notImplemented(),
    listScopeIds: async () => notImplemented(),
    listGateIds: async () => notImplemented(),
    listWriterIds: async () => notImplemented(),
    readWriterShard: async () => notImplemented(),
    durableReplaceWriterShard: async () => notImplemented(),
    publishRecoveryObject: async () => notImplemented(),
    readRecoveryObject: async () => notImplemented(),
    listRecoveryObjects: async () => notImplemented(),
    deleteRecoveryObject: async () => notImplemented(),
    readWorkspaceFile: async () => notImplemented(),
    replaceWorkspaceFileExact: async () => notImplemented(),
    close: () => notImplemented(),
  };
}
