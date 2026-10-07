import { describe, expect, it } from "vitest";
import {
  createLinuxOpenat2ReviewArtifactProvider,
  createLinuxReviewGateProvider,
  hasGlibcRuntime,
  isSupportedLinuxOpenat2Environment,
  loadJusticeLinuxNativeAddon,
  NATIVE_ADDON_FILE,
} from "../../src/runtime";

describe("runtime index exports", () => {
  it("exports the Linux provider factories and support check as functions", () => {
    expect(createLinuxOpenat2ReviewArtifactProvider).toBeTypeOf("function");
    expect(isSupportedLinuxOpenat2Environment).toBeTypeOf("function");
    expect(createLinuxReviewGateProvider).toBeTypeOf("function");
  });

  it("exports the native addon helpers and filename", () => {
    expect(loadJusticeLinuxNativeAddon).toBeTypeOf("function");
    expect(hasGlibcRuntime).toBeTypeOf("function");
    expect(NATIVE_ADDON_FILE).toBeTypeOf("string");
    expect(NATIVE_ADDON_FILE).toBe("index.linux-x64-gnu.node");
  });
});
