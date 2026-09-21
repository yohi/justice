import { describe, expect, it, vi } from "vitest";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem, type MockFileSystem } from "../helpers/mock-file-system";

let mockFs: MockFileSystem;

vi.mock("../../src/runtime/node-file-system", () => ({
  NodeFileSystem: function NodeFileSystemMock(): MockFileSystem {
    return mockFs;
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdir: vi.fn(async () => undefined) };
});

describe("OpenCodeAdapter reservation capability probe", () => {
  it("continues initialization when the optional capability probe throws", async () => {
    mockFs = createMockFileSystem();
    Object.defineProperty(mockFs, "createReservedReviewArtifactIo", {
      configurable: true,
      get(): never {
        throw new Error("reservation provider unavailable");
      },
    });
    const init = fakeInit();
    const log = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const adapter = new OpenCodeAdapter(init);

    await adapter.ensureInitialized();

    expect(adapter.getJustice()).not.toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        message: "[Justice] review artifact reservation capability probe failed; reservation disabled",
      }),
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", message: "[Justice] lazy init failed" }),
    );
  });
});
