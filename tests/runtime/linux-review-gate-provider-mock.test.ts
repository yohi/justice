import { Buffer } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeAddon = vi.hoisted(() => ({ value: undefined as unknown }));

vi.mock("../../src/runtime/linux-native-addon", () => ({
  hasGlibcRuntime: () => true,
  loadJusticeLinuxNativeAddon: () => nativeAddon.value,
}));

const gateAddon = {
  acquireScopeLock: vi.fn(() => ({ release: vi.fn(), verifyCloexec: () => true })),
  acquireGateLock: vi.fn(() => ({ release: vi.fn(), verifyCloexec: () => true })),
  acquireRecoveryGcLock: vi.fn(() => ({ release: vi.fn(), verifyCloexec: () => true })),
  listScopeIds: vi.fn(() => ["scope-a"]),
  listGateIds: vi.fn(() => ["gate-a"]),
  listWriterIds: vi.fn(() => ["writer-a"]),
  readWriterShard: vi.fn(() => Buffer.from("shard")),
  durableReplaceWriterShard: vi.fn(),
  publishRecoveryObject: vi.fn(() => "created" as const),
  readRecoveryObject: vi.fn(() => Buffer.from("recovery")),
  listRecoveryObjects: vi.fn(() => ["a1b2"]),
  deleteRecoveryObject: vi.fn(),
  readWorkspaceFile: vi.fn(() => Buffer.from("workspace")),
  replaceWorkspaceFileExact: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  nativeAddon.value = { artifact: {}, gate: gateAddon };
});

describe("LinuxReviewGateProvider native adapter", () => {
  it("publishes the typed provider surface from the shared loader", async () => {
    const { createLinuxReviewGateProvider } =
      await import("../../src/runtime/linux-review-gate-provider");
    const provider = createLinuxReviewGateProvider("/workspace");

    expect(provider).toBeDefined();
    expect(Object.keys(provider ?? {}).sort()).toEqual(
      [
        "acquireGateLock",
        "acquireRecoveryGcLock",
        "acquireScopeLock",
        "close",
        "deleteRecoveryObject",
        "durableReplaceWriterShard",
        "listGateIds",
        "listRecoveryObjects",
        "listScopeIds",
        "listWriterIds",
        "publishRecoveryObject",
        "readRecoveryObject",
        "readWorkspaceFile",
        "readWriterShard",
        "replaceWorkspaceFileExact",
      ].sort(),
    );
  });

  it("passes shard read arguments to the native gate addon", async () => {
    const { createLinuxReviewGateProvider } =
      await import("../../src/runtime/linux-review-gate-provider");
    const provider = createLinuxReviewGateProvider("/workspace");
    expect(provider).toBeDefined();
    if (provider === undefined) return;

    await expect(provider.readWriterShard("scope-a", "gate-a", "writer-a")).resolves.toEqual(
      Buffer.from("shard"),
    );
    expect(gateAddon.readWriterShard).toHaveBeenCalledWith("scope-a", "gate-a", "writer-a");
  });
});
