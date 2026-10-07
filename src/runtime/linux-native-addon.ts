import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const NATIVE_ADDON_FILE = "index.linux-x64-gnu.node";

export type NativeIdentity = Readonly<{ readonly device: string; readonly inode: string }>;
export type NativeCapabilities = Readonly<{
  readonly linux: boolean;
  readonly x64: boolean;
  readonly glibc: boolean;
  readonly openat2: boolean;
  readonly renameat2: boolean;
}>;
export type NativeHandle = Readonly<{
  readonly artifactIdentity: () => NativeIdentity;
  readonly leasePath: () => string;
  readonly close: () => void;
}>;
export type ReservationDescriptor = Readonly<{
  readonly artifactPath: string;
  readonly leasePath: string;
  readonly artifactIdentity: NativeIdentity;
}>;
export type NativeRoot = Readonly<{
  readonly createExclusiveMarker: (artifactPath: string) => NativeHandle;
  readonly openExistingReservation: (descriptor: ReservationDescriptor) => NativeHandle;
  readonly writeExisting: (handle: NativeHandle, bytes: Buffer) => void;
  readonly readOnce: (handle: NativeHandle) => Buffer;
  readonly cleanupExistingReservation: (descriptor: ReservationDescriptor) => Readonly<{
    readonly status:
      | "cleaned"
      | "quarantine_retained"
      | "replacement_retained"
      | "cleanup_incomplete";
  }>;
  readonly close: () => void;
}>;

export type JusticeLinuxNativeArtifactAddon = Readonly<{
  readonly openReviewArtifactRoot: (rootDir: string) => NativeRoot;
  readonly probeReviewArtifactCapabilities: () => NativeCapabilities;
}>;

export type JusticeLinuxNativeGateLockHandle = Readonly<{
  readonly release: () => void;
  readonly verifyCloexec: () => boolean;
}>;

export type JusticeLinuxNativeGateRoot = Readonly<{
  readonly acquireScopeLock: (
    reviewScopeId: string,
  ) => JusticeLinuxNativeGateLockHandle | "occupied";
  readonly acquireGateLock: (gateId: string) => JusticeLinuxNativeGateLockHandle | "occupied";
  readonly acquireRecoveryGcLock: () => JusticeLinuxNativeGateLockHandle | "occupied";
  readonly listScopeIds: () => readonly string[];
  readonly listGateIds: (reviewScopeId: string) => readonly string[];
  readonly listWriterIds: (reviewScopeId: string, gateId: string) => readonly string[];
  readonly readWriterShard: (
    reviewScopeId: string,
    gateId: string,
    writerId: string,
  ) => Buffer | null;
  readonly durableReplaceWriterShard: (
    reviewScopeId: string,
    gateId: string,
    writerId: string,
    previousDigest: string | null,
    bytes: Buffer,
  ) => void;
  readonly publishRecoveryObject: (digest: string, bytes: Buffer) => "created" | "exists";
  readonly readRecoveryObject: (digest: string) => Buffer | null;
  readonly listRecoveryObjects: () => readonly string[];
  readonly deleteRecoveryObject: (digest: string) => void;
  readonly readWorkspaceFile: (path: string) => Buffer | null;
  readonly replaceWorkspaceFileExact: (
    path: string,
    expectedCurrentDigest: string,
    expectedGitMode: "100644" | "100755",
    replacementBytes: Buffer,
    replacementGitMode: "100644" | "100755",
  ) => void;
  readonly close: () => void;
}>;

export type JusticeLinuxNativeGateAddon = Readonly<{
  readonly openReviewGateRoot: (rootDir: string) => JusticeLinuxNativeGateRoot;
  readonly probeReviewGateCapabilities: () => NativeCapabilities;
}>;

export type JusticeLinuxNativeAddon = Readonly<{
  readonly artifact: JusticeLinuxNativeArtifactAddon;
  readonly gate?: JusticeLinuxNativeGateAddon;
}>;

export function loadJusticeLinuxNativeAddon(): JusticeLinuxNativeAddon | undefined {
  try {
    const require = createRequire(import.meta.url);
    const addonPath = fileURLToPath(
      new URL(`../../dist/native/${NATIVE_ADDON_FILE}`, import.meta.url),
    );
    const loaded: unknown = require(addonPath);
    if (typeof loaded !== "object" || loaded === null) return undefined;
    const record = loaded as Record<string, unknown>;
    if (!isArtifactAddon(record)) return undefined;
    const gate = isGateAddon(record) ? record : undefined;
    return { artifact: record, ...(gate === undefined ? {} : { gate }) };
  } catch {
    return undefined;
  }
}

export function hasGlibcRuntime(): boolean {
  try {
    const report = process.report?.getReport() as
      | { readonly header?: { readonly glibcVersionRuntime?: unknown } }
      | undefined;
    return typeof report?.header?.glibcVersionRuntime === "string";
  } catch {
    return false;
  }
}

function isArtifactAddon(
  value: Record<string, unknown>,
): value is Record<string, unknown> & JusticeLinuxNativeArtifactAddon {
  return (
    typeof value.openReviewArtifactRoot === "function" &&
    typeof value.probeReviewArtifactCapabilities === "function"
  );
}

function isGateAddon(
  value: Record<string, unknown>,
): value is Record<string, unknown> & JusticeLinuxNativeGateAddon {
  return (
    typeof value.openReviewGateRoot === "function" &&
    typeof value.probeReviewGateCapabilities === "function"
  );
}
