import { describe, expect, it } from "vitest";
import {
  buildWorkerInputForPublication,
  decideProviderPublication,
  type ProbeReport,
} from "../../spikes/review-artifact-linux/verify";

const unsupportedProbe: ProbeReport = {
  provider: "LinuxOpenat2ReviewArtifactProvider",
  nativeApi: { openat2: false, renameat2: true },
  platform: { os: "linux", arch: "x86_64", libc: "glibc" },
  kernel: "5.6.0",
  status: "BLOCKED",
  cases: {},
};

const passingProbe: ProbeReport = {
  provider: "LinuxOpenat2ReviewArtifactProvider",
  nativeApi: {
    openat2: true,
    renameat2: true,
    descriptorRelative: true,
    identityBoundLease: true,
  },
  platform: { os: "linux", arch: "x86_64", libc: "glibc" },
  kernel: "5.6.0",
  status: "PASS",
  cases: {
    exclusive_reservation: { status: "PASS", detail: "" },
    reservation_collision: { status: "PASS", detail: "" },
    descriptor_relative_io: { status: "PASS", detail: "" },
    final_component_symlink: { status: "PASS", detail: "" },
    symlinked_ancestor: { status: "PASS", detail: "" },
    ancestor_replacement: { status: "PASS", detail: "" },
    artifact_replacement: { status: "PASS", detail: "" },
    lease_replacement: { status: "PASS", detail: "" },
    root_close_reopen: { status: "PASS", detail: "" },
    reservation_local_quarantine: { status: "PASS", detail: "" },
    post_verification_quarantine_race: { status: "PASS", detail: "" },
    artifact_name_replacement_after_fstat: { status: "PASS", detail: "" },
    lease_name_replacement_after_hard_link: { status: "PASS", detail: "" },
  },
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

  it("blocks publication when a required probe case is missing", () => {
    const partialProbe: ProbeReport = {
      ...passingProbe,
      cases: Object.fromEntries(
        Object.entries(passingProbe.cases).filter(
          ([name]) => name !== "lease_name_replacement_after_hard_link",
        ),
      ),
    };

    expect(decideProviderPublication(partialProbe)).toEqual({
      status: "BLOCKED",
      reason: "artifact_storage_unavailable",
    });
  });

  it("blocks publication when the probe exits non-zero despite PASS JSON", () => {
    expect(decideProviderPublication(passingProbe, 1)).toEqual({
      status: "BLOCKED",
      reason: "artifact_storage_unavailable",
    });
  });

  it("blocks publication for a non-Linux platform", () => {
    const wrongPlatformProbe: ProbeReport = {
      ...passingProbe,
      platform: { os: "darwin", arch: "x86_64", libc: "glibc" },
    };

    expect(decideProviderPublication(wrongPlatformProbe)).toEqual({
      status: "BLOCKED",
      reason: "artifact_storage_unavailable",
    });
  });
});
