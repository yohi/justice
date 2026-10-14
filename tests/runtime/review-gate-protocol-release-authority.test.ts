import { describe, expect, it } from "vitest";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../../src/core/review-gate/identity.js";
import {
  createVerifiedProtocolReleaseProvider,
  PROTOCOL_RELEASE_SCHEMA_VERSION,
  PROTOCOL_RELEASE_SIGNATURE_DOMAIN,
  type ProtocolReleaseRecordV1,
} from "../../src/runtime/review-gate-protocol-release-authority.js";

const anchor = {
  installationId: "installation-1",
  trustPolicyVersion: "policy-1",
  publisherIdentityOrKeyDigest: "publisher-1",
  protectedRegistryHead: "registry-head-1",
  initialFrontierDigest: "frontier-1",
} as const;

const oldBytes = "old-descriptor";
const newBytes = "new-descriptor";
const oldRecord: ProtocolReleaseRecordV1 = {
  schemaVersion: PROTOCOL_RELEASE_SCHEMA_VERSION,
  releaseId: "release-1",
  phase: "design",
  descriptorDigest: computeArtifactDigest(Buffer.from(oldBytes)),
  phaseFingerprint: "before-fingerprint",
  canonicalDescriptorBytes: oldBytes,
  publisherKeyDigest: anchor.publisherIdentityOrKeyDigest,
  publisherSignature: "signed-old-release",
  ancestorReleaseIds: [],
  registryHead: "registry-head-1",
};
const newRecord: ProtocolReleaseRecordV1 = {
  schemaVersion: PROTOCOL_RELEASE_SCHEMA_VERSION,
  releaseId: "release-2",
  phase: "design",
  descriptorDigest: computeArtifactDigest(Buffer.from(newBytes)),
  phaseFingerprint: "after-fingerprint",
  canonicalDescriptorBytes: newBytes,
  publisherKeyDigest: anchor.publisherIdentityOrKeyDigest,
  publisherSignature: "signed-new-release",
  ancestorReleaseIds: [oldRecord.releaseId],
  registryHead: "registry-head-2",
};
const validHistoricalProofDigest = computeCanonicalJsonFingerprint({
  domain: PROTOCOL_RELEASE_SIGNATURE_DOMAIN,
  schemaVersion: oldRecord.schemaVersion,
  releaseId: oldRecord.releaseId,
  descriptorDigest: oldRecord.descriptorDigest,
  phaseFingerprint: oldRecord.phaseFingerprint,
  registryHead: oldRecord.registryHead,
});

function createProvider() {
  return createVerifiedProtocolReleaseProvider({
    anchor,
    source: {
      readRegistryHead: async () => "registry-head-2",
      readRelease: async (releaseId) => (releaseId === oldRecord.releaseId ? oldRecord : null),
      readReleaseByDescriptorDigest: async (digest) =>
        digest === newRecord.descriptorDigest ? newRecord : null,
    },
    verifyPublisherSignature: async () => true,
  });
}

function input(historicalReleaseProofDigest: string) {
  return {
    workspaceIdentity: "workspace-1",
    phase: "design" as const,
    nc1StopEventId: "stop-1",
    beforeFingerprint: oldRecord.phaseFingerprint,
    beforeReleaseId: oldRecord.releaseId,
    historicalReleaseProofDigest,
    trustedPublisherPolicyVersion: anchor.trustPolicyVersion,
    currentDescriptorDigest: newRecord.descriptorDigest,
    witnessFrontierHash: "frontier-2",
  };
}

describe("verified protocol release historical proof binding", () => {
  it("blocks when the historical release proof digest is missing", async () => {
    await expect(
      createProvider().readVerifiedPhaseProtocolDelta(input("")),
    ).resolves.toBe("BLOCK");
  });

  it("blocks when the historical release proof digest is malformed", async () => {
    await expect(
      createProvider().readVerifiedPhaseProtocolDelta(input("not-a-digest")),
    ).resolves.toBe("BLOCK");
  });

  it("blocks when the historical release proof digest does not match the pinned release", async () => {
    await expect(
      createProvider().readVerifiedPhaseProtocolDelta(input("0".repeat(64))),
    ).resolves.toBe("BLOCK");
  });

  it("accepts the canonical historical release proof digest", async () => {
    const result = await createProvider().readVerifiedPhaseProtocolDelta(
      input(validHistoricalProofDigest),
    );

    expect(result).not.toBe("BLOCK");
  });
});
