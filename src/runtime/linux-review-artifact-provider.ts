import type { FileWriter, ReservedReviewArtifactIo } from "../core/types";
import {
  hasGlibcRuntime,
  loadJusticeLinuxNativeAddon,
  type NativeCapabilities,
  type NativeHandle,
  type NativeRoot,
  type ReservationDescriptor,
} from "./linux-native-addon";

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

  const nativeAddon = loadJusticeLinuxNativeAddon();
  if (nativeAddon === undefined) return undefined;
  const addon = nativeAddon.artifact;

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
