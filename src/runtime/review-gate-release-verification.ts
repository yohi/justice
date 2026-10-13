import { createPublicKey, type KeyObject } from "node:crypto";
import { z } from "zod";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../core/review-gate/identity.js";
import { computeReviewGateProtocolFingerprints } from "./review-gate-protocol.js";
import { ProtectedWitnessStore, WitnessBlocked } from "./review-gate-protected-store.js";
import {
  hostProofValid,
  readTrustedWitnessInstallation,
} from "./review-gate-witness-installation.js";
import {
  releaseAnchorSchema,
  releaseRegistrySchema,
  type ReleaseRegistry,
  type AuthenticatedProtocolReleasePublicationInput,
} from "./review-gate-release-schema.js";

export type ProtocolReleaseRegistryOptions = Readonly<{
  witnessDirectory: string;
  hostTrustRoot: KeyObject;
}>;
export function sameReleaseValue(left: unknown, right: unknown): boolean {
  return computeCanonicalJsonFingerprint(left) === computeCanonicalJsonFingerprint(right);
}
export async function provisionProtocolReleaseRegistry(
  input: ProtocolReleaseRegistryOptions &
    Readonly<{
      publisherPublicKey: KeyObject;
      trustPolicyVersion: string;
      authorize: (payload: unknown) => Promise<string>;
    }>,
): Promise<void> {
  const store = new ProtectedWitnessStore(input.witnessDirectory);
  await store.withGuard("protocol-release", async () => {
    const installation = await readTrustedWitnessInstallation(store, input.hostTrustRoot);
    const publisherPublicKeyPem = input.publisherPublicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    const initialFrontierDigest = computeCanonicalJsonFingerprint({
      installationId: installation.installationId,
      trustPolicyVersion: input.trustPolicyVersion,
      publisherPublicKeyPem,
      releaseIds: [],
    });
    const payload = {
      installationId: installation.installationId,
      trustPolicyVersion: input.trustPolicyVersion,
      publisherPublicKeyPem,
      initialFrontierDigest,
    };
    const authorizationSignature = await input.authorize(payload);
    if (
      !hostProofValid(input.hostTrustRoot, payload, authorizationSignature) ||
      input.publisherPublicKey.asymmetricKeyType !== "ed25519"
    )
      throw new WitnessBlocked("authentication");
    await store.writeJson("release-anchor.json", { ...payload, authorizationSignature }, true);
    await store.initialize("release", {
      head: { releaseId: null, sequence: 0, frontierHash: initialFrontierDigest },
      currentPolicy: input.trustPolicyVersion,
      policies: {
        [input.trustPolicyVersion]: {
          version: input.trustPolicyVersion,
          publisherPublicKeyPem,
          rotationReference: null,
          authorizationSignature,
        },
      },
      releases: {},
      pending: {},
      receipts: {},
    });
  });
}
export function createReleaseVerification(
  store: ProtectedWitnessStore,
  options: ProtocolReleaseRegistryOptions,
) {
  async function anchor() {
    const installation = await readTrustedWitnessInstallation(store, options.hostTrustRoot);
    const value = await store.readJson("release-anchor.json", releaseAnchorSchema);
    const { authorizationSignature, ...payload } = value;
    if (
      value.installationId !== installation.installationId ||
      !hostProofValid(options.hostTrustRoot, payload, authorizationSignature)
    )
      throw new WitnessBlocked("release_root");
    return value;
  }
  async function verifyEvidence(
    state: ReleaseRegistry,
    input: AuthenticatedProtocolReleasePublicationInput,
    installationId: string,
    requireCurrentPolicy = true,
  ): Promise<void> {
    const { manifest, sourceBytes, publisherSignature, installerSignature } = input;
    const policy = state.policies[manifest.trustPolicyVersion];
    if (policy !== undefined && policy.rotationReference !== null) {
      const proof = await store.readJson(
        `policy-proof-${policy.rotationReference}.json`,
        z.strictObject({
          payload: z.strictObject({
            domain: z.literal("protocol-publisher-rotation-v1"),
            installationId: z.string(),
            previousVersion: z.string(),
            trustPolicyVersion: z.string(),
            publisherPublicKeyPem: z.string(),
            expectedProtectedReleaseHead: z.unknown(),
          }),
          signature: z.string(),
        }),
      );
      if (
        computeCanonicalJsonFingerprint(proof) !== policy.rotationReference ||
        !hostProofValid(options.hostTrustRoot, proof.payload, proof.signature) ||
        proof.payload.installationId !== installationId ||
        proof.payload.trustPolicyVersion !== manifest.trustPolicyVersion ||
        proof.payload.publisherPublicKeyPem !== policy.publisherPublicKeyPem ||
        state.policies[proof.payload.previousVersion] === undefined
      )
        throw new WitnessBlocked("release_policy_rotation");
    } else if (policy !== undefined) {
      const root = await anchor();
      if (
        root.trustPolicyVersion !== manifest.trustPolicyVersion ||
        root.publisherPublicKeyPem !== policy.publisherPublicKeyPem
      )
        throw new WitnessBlocked("release_policy_rotation");
    }
    const fingerprints = computeReviewGateProtocolFingerprints(manifest.descriptor);
    if (
      policy === undefined ||
      (requireCurrentPolicy && state.currentPolicy !== manifest.trustPolicyVersion) ||
      manifest.installationId !== installationId ||
      policy.rotationReference !== manifest.keyRotationReference ||
      sourceBytes.length > 65536 ||
      computeArtifactDigest(sourceBytes) !== manifest.sourceDigest ||
      !sameReleaseValue(
        JSON.parse(Buffer.from(sourceBytes).toString("utf8")),
        manifest.descriptor,
      ) ||
      fingerprints.reviewProtocolFingerprint !== manifest.reviewProtocolFingerprint ||
      fingerprints.designProtocolFingerprint !== manifest.designProtocolFingerprint ||
      fingerprints.planProtocolFingerprint !== manifest.planProtocolFingerprint ||
      !hostProofValid(
        createPublicKey(policy.publisherPublicKeyPem),
        manifest,
        publisherSignature,
      ) ||
      !hostProofValid(options.hostTrustRoot, manifest, installerSignature)
    )
      throw new WitnessBlocked("release_authentication");
  }
  async function current() {
    const root = await anchor();
    const state = await store.read("release", releaseRegistrySchema);
    if (
      Object.keys(state.data.releases).length !== state.data.head.sequence ||
      (state.data.head.releaseId !== null &&
        state.data.releases[state.data.head.releaseId] === undefined)
    )
      throw new WitnessBlocked("release_history");
    let previous: string | null = state.data.head.releaseId;
    const visited = new Set<string>();
    while (previous !== null) {
      if (visited.has(previous)) throw new WitnessBlocked("release_history");
      visited.add(previous);
      const release = state.data.releases[previous];
      if (release === undefined) throw new WitnessBlocked("release_history");
      await verifyEvidence(
        state.data,
        {
          ...release,
          sourceBytes: Uint8Array.from(
            await store.readBytes(`release-bytes-${release.manifest.sourceDigest}.bin`),
          ),
        },
        root.installationId,
        false,
      );
      previous = release.manifest.parentReleaseId;
    }
    if (visited.size !== state.data.head.sequence) throw new WitnessBlocked("release_history");
    return { ...state, root };
  }
  return { anchor, current, verifyEvidence };
}
