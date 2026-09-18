import { describe, expect, it } from "vitest";
import {
  buildWorkerInputForPublication,
  decideProviderPublication,
  type ProbeReport,
} from "../../spikes/review-artifact-linux/verify";

const unsupportedProbe: ProbeReport = {
  provider: "LinuxOpenat2ReviewArtifactProvider",
  nativeApi: { openat2: false, renameat2: true },
  platform: { os: "linux", arch: "x64", libc: "glibc" },
  kernel: "5.6.0",
  status: "BLOCKED",
  cases: {},
};

describe("Linux review artifact probe publication gate", () => {
  it("blocks provider publication when the native probe fails", () => {
    const publication = decideProviderPublication(unsupportedProbe);

    expect(publication).toEqual({
      status: "BLOCKED",
      reason: "artifact_storage_unavailable",
    });
  });

  it("does not hand an artifact path to a worker after a blocked probe", () => {
    const publication = decideProviderPublication(unsupportedProbe);

    expect(
      buildWorkerInputForPublication(publication, ".justice/reviews/review.json"),
    ).toEqual({});
  });
});
