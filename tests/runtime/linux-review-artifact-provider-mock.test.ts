import { describe, expect, it, vi } from "vitest";

const mockedNativeAddon = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("node:module", () => ({
  createRequire: (): (() => unknown) => (): unknown => {
    if (mockedNativeAddon.value instanceof Error) throw mockedNativeAddon.value;
    return mockedNativeAddon.value;
  },
}));

async function withMockedNativeAddon<T>(
  addon: unknown,
  callback: (providerModule: typeof import("../../src/runtime/linux-review-artifact-provider")) =>
    | T
    | Promise<T>,
): Promise<T> {
  mockedNativeAddon.value = addon;
  vi.resetModules();
  try {
    return await callback(await import("../../src/runtime/linux-review-artifact-provider"));
  } finally {
    mockedNativeAddon.value = undefined;
    vi.resetModules();
  }
}

describe("LinuxOpenat2ReviewArtifactProvider native boundaries", () => {
  it("fails open when the native addon cannot be loaded", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    await withMockedNativeAddon(new Error("addon unavailable"), ({
      createLinuxOpenat2ReviewArtifactProvider: createProvider,
    }) => {
      expect(createProvider("/tmp")).toBeUndefined();
    });
  });

  it("fails open when the native addon has an invalid API", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    await withMockedNativeAddon({}, ({
      createLinuxOpenat2ReviewArtifactProvider: createProvider,
    }) => {
      expect(createProvider("/tmp")).toBeUndefined();
    });
  });

  it("fails open when native capability probing throws or reports unsupported features", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    await withMockedNativeAddon(
      {
        openReviewArtifactRoot: () => {
          throw new Error("unused");
        },
        probeReviewArtifactCapabilities: () => {
          throw new Error("probe failed");
        },
      },
      ({ createLinuxOpenat2ReviewArtifactProvider: createProvider }) => {
        expect(createProvider("/tmp")).toBeUndefined();
      },
    );
    await withMockedNativeAddon(
      {
        openReviewArtifactRoot: () => {
          throw new Error("unused");
        },
        probeReviewArtifactCapabilities: () => ({
          linux: true,
          x64: true,
          glibc: true,
          openat2: false,
          renameat2: true,
        }),
      },
      ({ createLinuxOpenat2ReviewArtifactProvider: createProvider }) => {
        expect(createProvider("/tmp")).toBeUndefined();
      },
    );
  });

  it("swallows a native root close failure", async () => {
    if (process.platform !== "linux" || process.arch !== "x64") return;

    await withMockedNativeAddon(
      {
        openReviewArtifactRoot: () => ({
          createExclusiveMarker: (): never => {
            throw new Error("unused");
          },
          openExistingReservation: (): never => {
            throw new Error("unused");
          },
          writeExisting: (): never => {
            throw new Error("unused");
          },
          readOnce: (): never => {
            throw new Error("unused");
          },
          cleanupExistingReservation: (): never => {
            throw new Error("unused");
          },
          close: (): never => {
            throw new Error("close failed");
          },
        }),
        probeReviewArtifactCapabilities: () => ({
          linux: true,
          x64: true,
          glibc: true,
          openat2: true,
          renameat2: true,
        }),
      },
      ({ createLinuxOpenat2ReviewArtifactProvider: createProvider }) => {
        const provider = createProvider("/tmp");
        expect(provider).toBeDefined();
        if (provider === undefined) return;
        provider.close();
      },
    );
  });
});
