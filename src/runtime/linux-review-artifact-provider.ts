import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { FileWriter, ReservedReviewArtifactIo } from "../core/types";

const NATIVE_ADDON_FILE = "index.linux-x64-gnu.node";

export type LinuxOpenat2RuntimeEnvironment = Readonly<{
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly glibc: boolean;
  readonly openat2: boolean;
  readonly renameat2: boolean;
}>;

export type LinuxOpenat2ReviewArtifactProvider = Readonly<{
  readonly createExclusiveMarker: NonNullable<FileWriter["createExclusiveMarker"]>;
  readonly reservedReviewArtifactIo: ReservedReviewArtifactIo;
  readonly close: () => void;
}>;

type NativeIdentity = Readonly<{ readonly device: string; readonly inode: string }>;
type NativeCapabilities = Readonly<{
  readonly linux: boolean;
  readonly x64: boolean;
  readonly glibc: boolean;
  readonly openat2: boolean;
  readonly renameat2: boolean;
}>;
type NativeHandle = Readonly<{
  readonly artifactIdentity: () => NativeIdentity;
  readonly leasePath: () => string;
  readonly close: () => void;
}>;
type ReservationDescriptor = Readonly<{
  readonly artifactPath: string;
  readonly leasePath: string;
  readonly artifactIdentity: NativeIdentity;
}>;
type NativeRoot = Readonly<{
  readonly createExclusiveMarker: (artifactPath: string) => NativeHandle;
  readonly openExistingReservation: (descriptor: ReservationDescriptor) => NativeHandle;
  readonly writeExisting: (handle: NativeHandle, bytes: Buffer) => void;
  readonly readOnce: (handle: NativeHandle) => Buffer;
  readonly cleanupExistingReservation: (
    descriptor: ReservationDescriptor,
  ) => Readonly<{
    readonly status: "cleaned" | "quarantine_retained" | "replacement_retained" | "cleanup_incomplete";
  }>;
  readonly close: () => void;
}>;
type NativeAddon = Readonly<{
  readonly openReviewArtifactRoot: (rootDir: string) => NativeRoot;
  readonly probeReviewArtifactCapabilities: () => NativeCapabilities;
}>;

export function isSupportedLinuxOpenat2Environment(
  environment: LinuxOpenat2RuntimeEnvironment,
): boolean {
  return (
    environment.platform === "linux" &&
    environment.arch === "x64" &&
    environment.glibc &&
    environment.openat2 &&
    environment.renameat2
  );
}

export function createLinuxOpenat2ReviewArtifactProvider(
  rootDir: string,
): LinuxOpenat2ReviewArtifactProvider | undefined {
  if (process.platform !== "linux" || process.arch !== "x64" || !hasGlibcRuntime()) {
    return undefined;
  }

  const addon = loadNativeAddon();
  if (addon === undefined) return undefined;

  let capabilities: NativeCapabilities;
  try {
    capabilities = addon.probeReviewArtifactCapabilities();
  } catch {
    return undefined;
  }

  const environment: LinuxOpenat2RuntimeEnvironment = {
    platform: process.platform,
    arch: process.arch,
    glibc: true,
    openat2: capabilities.openat2,
    renameat2: capabilities.renameat2,
  };
  if (
    !capabilities.linux ||
    !capabilities.x64 ||
    !capabilities.glibc ||
    !isSupportedLinuxOpenat2Environment(environment)
  ) {
    return undefined;
  }

  let root: NativeRoot;
  try {
    root = addon.openReviewArtifactRoot(rootDir);
  } catch {
    return undefined;
  }

  const createExclusiveMarker: NonNullable<FileWriter["createExclusiveMarker"]> = async (path) => {
    let handle: NativeHandle | undefined;
    try {
      handle = root.createExclusiveMarker(path);
      return {
        kind: "created",
        leasePath: handle.leasePath(),
        artifactIdentity: handle.artifactIdentity(),
      };
    } catch (cause: unknown) {
      if (nativeErrorCode(cause) === "artifact_occupied") return { kind: "occupied" };
      throw safeNativeError("artifact_storage_unavailable", cause);
    } finally {
      handle?.close();
    }
  };

  const descriptorFor = (
    reservation: Parameters<ReservedReviewArtifactIo["readOnce"]>[0],
  ): ReservationDescriptor => ({
    artifactPath: reservation.artifactPath,
    leasePath: reservation.leasePath,
    artifactIdentity: reservation.artifactIdentity,
  });

  const reservedReviewArtifactIo: ReservedReviewArtifactIo = {
    writeExisting: async (reservation, content) => {
      let handle: NativeHandle | undefined;
      try {
        handle = root.openExistingReservation(descriptorFor(reservation));
        root.writeExisting(handle, Buffer.from(content, "utf8"));
      } catch (cause: unknown) {
        throw safeNativeError("artifact_write_failed", cause);
      } finally {
        handle?.close();
      }
    },
    readOnce: async (reservation) => {
      let handle: NativeHandle | undefined;
      try {
        handle = root.openExistingReservation(descriptorFor(reservation));
        return root.readOnce(handle).toString("utf8");
      } catch (cause: unknown) {
        throw safeNativeError("artifact_read_failed", cause);
      } finally {
        handle?.close();
      }
    },
    cleanup: async (reservation) => {
      try {
        const result = root.cleanupExistingReservation(descriptorFor(reservation));
        switch (result.status) {
          case "cleaned":
            return "cleaned" as const;
          case "quarantine_retained":
            return "quarantine_retained" as const;
          case "replacement_retained":
            return "replacement_retained" as const;
          case "cleanup_incomplete":
            return "cleanup_incomplete" as const;
          default:
            throw safeNativeError("artifact_cleanup_failed", result.status);
        }
      } catch (cause: unknown) {
        throw safeNativeError("artifact_cleanup_failed", cause);
      }
    },
  };

  let closed = false;
  return {
    createExclusiveMarker,
    reservedReviewArtifactIo,
    close: () => {
      if (closed) return;
      closed = true;
      try {
        root.close();
      } catch {
        return;
      }
    },
  };
}

function loadNativeAddon(): NativeAddon | undefined {
  try {
    const require = createRequire(import.meta.url);
    const addonPath = fileURLToPath(new URL(`../../dist/native/${NATIVE_ADDON_FILE}`, import.meta.url));
    const loaded: unknown = require(addonPath);
    return isNativeAddon(loaded) ? loaded : undefined;
  } catch {
    return undefined;
  }
}

function isNativeAddon(value: unknown): value is NativeAddon {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.openReviewArtifactRoot === "function" &&
    typeof record.probeReviewArtifactCapabilities === "function"
  );
}

function hasGlibcRuntime(): boolean {
  try {
    const report = process.report?.getReport() as
      | { readonly header?: { readonly glibcVersionRuntime?: unknown } }
      | undefined;
    return typeof report?.header?.glibcVersionRuntime === "string";
  } catch {
    return false;
  }
}

function nativeErrorCode(cause: unknown): string | undefined {
  if (!(cause instanceof Error)) return undefined;
  const [code] = cause.message.split(":", 1);
  if (code === undefined) return undefined;
  return /^[a-z][a-z0-9_]*$/u.test(code) ? code : undefined;
}

function safeNativeError(fallbackCode: string, cause: unknown): Error {
  const code = nativeErrorCode(cause) ?? fallbackCode;
  return new Error(code);
}
