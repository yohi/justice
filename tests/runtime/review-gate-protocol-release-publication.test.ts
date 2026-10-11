import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../../src/core/review-gate/identity.js";
import {
  createReviewGateProtocolDescriptor,
  computeReviewGateProtocolFingerprints,
} from "../../src/runtime/review-gate-protocol.js";
import { provisionReviewGateWitnessInstallation } from "../../src/runtime/review-gate-scope-witness.js";
import {
  createTrustedProtocolReleaseRegistry,
  provisionProtocolReleaseRegistry,
} from "../../src/runtime/review-gate-protocol-release-publication.js";

describe("privileged protocol release publication", () => {
  let directory: string;
  let registry: ReturnType<typeof createTrustedProtocolReleaseRegistry>;
  const host = generateKeyPairSync("ed25519");
  const publisher = generateKeyPairSync("ed25519");
  const authorize = async (payload: unknown): Promise<string> =>
    sign(null, Buffer.from(computeCanonicalJsonFingerprint(payload)), host.privateKey).toString(
      "base64",
    );
  beforeEach(async () => {
    const parent = await mkdtemp(join(tmpdir(), "justice-release-"));
    directory = join(parent, "protected");
    await provisionReviewGateWitnessInstallation({
      witnessDirectory: directory,
      hostTrustRoot: host.publicKey,
      authorize,
    });
    await provisionProtocolReleaseRegistry({
      witnessDirectory: directory,
      hostTrustRoot: host.publicKey,
      publisherPublicKey: publisher.publicKey,
      trustPolicyVersion: "policy-1",
      authorize,
    });
    registry = createTrustedProtocolReleaseRegistry({
      witnessDirectory: directory,
      hostTrustRoot: host.publicKey,
    });
  });
  afterEach(async () => {
    await rm(join(directory, ".."), { recursive: true, force: true });
  });
  async function input() {
    const protocol = createReviewGateProtocolDescriptor();
    const sourceBytes = Buffer.from(JSON.stringify(protocol.descriptor));
    const manifest = {
      installationId: (await registry.readAnchor()).installationId,
      publicationOperationId: "publish-1",
      expectedProtectedReleaseHead: await registry.readHead(),
      parentReleaseId: null,
      releaseId: "release-1",
      trustPolicyVersion: "policy-1",
      sourceDigest: computeArtifactDigest(sourceBytes),
      ...protocol,
      promptRegistryDigest: "a".repeat(64),
      validatorRegistryDigest: "b".repeat(64),
      semanticPolicyRegistryDigest: "c".repeat(64),
      keyRotationReference: null,
    };
    return {
      manifest,
      sourceBytes,
      publisherSignature: sign(
        null,
        Buffer.from(computeCanonicalJsonFingerprint(manifest)),
        publisher.privateKey,
      ).toString("base64"),
      installerSignature: await authorize(manifest),
    };
  }
  it("stages signed descriptor bytes and advances only the release namespace", async () => {
    const before = await readFile(join(directory, "scope-head.json"));
    const proposed = await input();
    expect(await registry.prepareAuthenticatedProtocolRelease(proposed)).toBe("prepared");
    expect((await registry.readHead()).releaseId).toBeNull();
    expect(await registry.recoverPreparedProtocolRelease("publish-1")).toBe("committed");
    expect(await registry.publishAuthenticatedProtocolRelease(proposed)).toBe("already_committed");
    expect(await registry.readReleaseBytes("release-1")).toEqual(proposed.sourceBytes);
    expect(await readFile(join(directory, "scope-head.json"))).toEqual(before);
  });
  it("rejects publisher forgery", async () => {
    const proposed = await input();
    expect(
      await registry.publishAuthenticatedProtocolRelease({
        ...proposed,
        publisherSignature: "A".repeat(86) + "==",
      }),
    ).toBe("blocked");
  });
  it("rejects runtime/worker installer forgery", async () => {
    const proposed = await input();
    expect(
      await registry.publishAuthenticatedProtocolRelease({
        ...proposed,
        installerSignature: proposed.publisherSignature,
      }),
    ).toBe("blocked");
  });
  it("does not reconstruct a missing trust root", async () => {
    await rm(join(directory, "release-anchor.json"));
    expect(
      await registry.publishAuthenticatedProtocolRelease(
        await input().catch(() => ({
          manifest: {},
          sourceBytes: new Uint8Array(),
          publisherSignature: "invalid",
          installerSignature: "invalid",
        })),
      ),
    ).toBe("blocked");
  });
  it("blocks lost immutable staging history", async () => {
    const proposed = await input();
    await registry.prepareAuthenticatedProtocolRelease(proposed);
    await rm(join(directory, `release-bytes-${proposed.manifest.sourceDigest}.bin`));
    expect(await registry.recoverPreparedProtocolRelease("publish-1")).toBe("blocked");
  });
  it("blocks a protected head rollback", async () => {
    const old = await readFile(join(directory, "release-head.json"));
    const proposed = await input();
    expect(await registry.publishAuthenticatedProtocolRelease(proposed)).toBe("committed");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(directory, "release-head.json"), old, { mode: 0o600 });
    await expect(registry.readHead()).rejects.toThrow("rollback");
  });
  it("accepts independently authenticated publisher rotation and preserves old release bytes", async () => {
    const first = await input();
    expect(await registry.publishAuthenticatedProtocolRelease(first)).toBe("committed");
    const nextPublisher = generateKeyPairSync("ed25519");
    const rotation = await registry.rotatePublisherTrustPolicy({
      trustPolicyVersion: "policy-2",
      publisherPublicKey: nextPublisher.publicKey,
      expectedProtectedReleaseHead: await registry.readHead(),
      authorize,
    });
    const descriptor = { ...first.manifest.descriptor, requirementsResolutionPolicyVersion: 2 };
    const sourceBytes = Buffer.from(JSON.stringify(descriptor));
    const manifest = {
      ...first.manifest,
      descriptor,
      ...computeReviewGateProtocolFingerprints(descriptor),
      publicationOperationId: "publish-2",
      releaseId: "release-2",
      parentReleaseId: "release-1",
      expectedProtectedReleaseHead: await registry.readHead(),
      sourceDigest: computeArtifactDigest(sourceBytes),
      trustPolicyVersion: "policy-2",
      keyRotationReference: rotation,
    };
    const second = {
      manifest,
      sourceBytes,
      publisherSignature: sign(
        null,
        Buffer.from(computeCanonicalJsonFingerprint(manifest)),
        nextPublisher.privateKey,
      ).toString("base64"),
      installerSignature: await authorize(manifest),
    };
    expect(await registry.publishAuthenticatedProtocolRelease(second)).toBe("committed");
    expect(await registry.readReleaseBytes("release-1")).toEqual(first.sourceBytes);
    expect((await registry.readHead()).sequence).toBe(2);
  });
  it("rejects forged policy rotation without changing the release head", async () => {
    const before = await registry.readHead();
    await expect(
      registry.rotatePublisherTrustPolicy({
        trustPolicyVersion: "policy-2",
        publisherPublicKey: publisher.publicKey,
        expectedProtectedReleaseHead: before,
        authorize: async () => "invalid",
      }),
    ).rejects.toThrow("authentication");
    expect(await registry.readHead()).toEqual(before);
  });
});
