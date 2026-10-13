import type { KeyObject } from "node:crypto";
import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import { ProtectedWitnessStore, WitnessBlocked } from "./review-gate-protected-store.js";
import { hostProofValid } from "./review-gate-witness-installation.js";
import { releasePublicationSchema, type ReleaseRegistry } from "./review-gate-release-schema.js";
import {
  createReleaseVerification,
  sameReleaseValue,
  type ProtocolReleaseRegistryOptions,
} from "./review-gate-release-verification.js";
import { scopeInstallationIdSchema } from "./review-gate-witness-verification.js";
export { provisionProtocolReleaseRegistry } from "./review-gate-release-verification.js";
export type { AuthenticatedProtocolReleasePublicationInput } from "./review-gate-release-schema.js";
type Result = "committed" | "already_committed" | "blocked";

export function createTrustedProtocolReleaseRegistry(options: ProtocolReleaseRegistryOptions) {
  const store = new ProtectedWitnessStore(options.witnessDirectory);
  const { anchor, current, verifyEvidence } = createReleaseVerification(store, options);
  async function commit(operationId: string): Promise<Result> {
    return store.withGuard("protocol-release", async () => {
      const state = await current();
      if (state.data.receipts[operationId] !== undefined) return "already_committed";
      const proposed = state.data.pending[operationId];
      if (proposed === undefined) return "blocked";
      await verifyEvidence(
        state.data,
        {
          ...proposed,
          sourceBytes: Uint8Array.from(
            await store.readBytes(`release-bytes-${proposed.manifest.sourceDigest}.bin`),
          ),
        },
        state.root.installationId,
      );
      if (
        !sameReleaseValue(proposed.manifest.expectedProtectedReleaseHead, state.data.head) ||
        proposed.manifest.parentReleaseId !== state.data.head.releaseId
      )
        return "blocked";
      const nextHead = {
        releaseId: proposed.manifest.releaseId,
        sequence: state.data.head.sequence + 1,
        frontierHash: computeCanonicalJsonFingerprint({
          previous: state.data.head.frontierHash,
          manifest: proposed.manifest,
        }),
      };
      await store.advance("release", state, {
        ...state.data,
        head: nextHead,
        pending: Object.fromEntries(
          Object.entries(state.data.pending).filter(([id]) => id !== operationId),
        ),
        releases: { ...state.data.releases, [proposed.manifest.releaseId]: proposed },
        receipts: { ...state.data.receipts, [operationId]: proposed },
      });
      return "committed";
    });
  }
  const api = {
    async rotatePublisherTrustPolicy(
      input: Readonly<{
        trustPolicyVersion: string;
        publisherPublicKey: KeyObject;
        expectedProtectedReleaseHead: ReleaseRegistry["head"];
        authorize: (payload: unknown) => Promise<string>;
      }>,
    ): Promise<string> {
      return store.withGuard("protocol-release", async () => {
        const state = await current();
        if (
          !scopeInstallationIdSchema.safeParse(input.trustPolicyVersion).success ||
          state.data.policies[input.trustPolicyVersion] !== undefined ||
          input.publisherPublicKey.type !== "public" ||
          input.publisherPublicKey.asymmetricKeyType !== "ed25519" ||
          !sameReleaseValue(input.expectedProtectedReleaseHead, state.data.head) ||
          Object.keys(state.data.pending).length !== 0
        )
          throw new WitnessBlocked("release_policy_rotation");
        const payload = {
          domain: "protocol-publisher-rotation-v1",
          installationId: state.root.installationId,
          previousVersion: state.data.currentPolicy,
          trustPolicyVersion: input.trustPolicyVersion,
          publisherPublicKeyPem: input.publisherPublicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
          expectedProtectedReleaseHead: state.data.head,
        };
        const signature = await input.authorize(payload);
        if (!hostProofValid(options.hostTrustRoot, payload, signature))
          throw new WitnessBlocked("release_authentication");
        const rotationReference = computeCanonicalJsonFingerprint({ payload, signature });
        await store.writeJson(
          `policy-proof-${rotationReference}.json`,
          { payload, signature },
          true,
        );
        await store.advance("release", state, {
          ...state.data,
          currentPolicy: input.trustPolicyVersion,
          policies: {
            ...state.data.policies,
            [input.trustPolicyVersion]: {
              version: input.trustPolicyVersion,
              publisherPublicKeyPem: payload.publisherPublicKeyPem,
              rotationReference,
              authorizationSignature: signature,
            },
          },
        });
        return rotationReference;
      });
    },
    async readAnchor() {
      return store.withGuard("protocol-release", anchor);
    },
    async readHead() {
      return store.withGuard("protocol-release", async () => (await current()).data.head);
    },
    async readReleaseBytes(releaseId: string): Promise<Buffer> {
      return store.withGuard("protocol-release", async () => {
        const release = (await current()).data.releases[releaseId];
        if (release === undefined) throw new WitnessBlocked("release_missing");
        return store.readBytes(`release-bytes-${release.manifest.sourceDigest}.bin`);
      });
    },
    async prepareAuthenticatedProtocolRelease(
      untrusted: unknown,
    ): Promise<"prepared" | "already_prepared"> {
      const input = releasePublicationSchema.parse(untrusted);
      return store.withGuard("protocol-release", async () => {
        const state = await current();
        await verifyEvidence(state.data, input, state.root.installationId);
        const { sourceBytes, ...evidence } = input;
        const prior =
          state.data.pending[input.manifest.publicationOperationId] ??
          state.data.receipts[input.manifest.publicationOperationId];
        if (prior !== undefined) {
          if (!sameReleaseValue(prior, evidence))
            throw new WitnessBlocked("release_operation_conflict");
          return "already_prepared";
        }
        if (
          Object.keys(state.data.pending).length !== 0 ||
          state.data.releases[input.manifest.releaseId] !== undefined ||
          !sameReleaseValue(input.manifest.expectedProtectedReleaseHead, state.data.head) ||
          input.manifest.parentReleaseId !== state.data.head.releaseId
        )
          throw new WitnessBlocked("release_head_conflict");
        await store.writeBytes(
          `release-bytes-${input.manifest.sourceDigest}.bin`,
          sourceBytes,
          true,
        );
        await store.advance("release", state, {
          ...state.data,
          pending: { ...state.data.pending, [input.manifest.publicationOperationId]: evidence },
        });
        return "prepared";
      });
    },
    async commitPreparedProtocolReleaseCAS(operationId: string): Promise<Result> {
      try {
        return await commit(operationId);
      } catch (error: unknown) {
        if (error instanceof Error) return "blocked";
        throw error;
      }
    },
    async recoverPreparedProtocolRelease(operationId: string): Promise<Result> {
      return api.commitPreparedProtocolReleaseCAS(operationId);
    },
    async publishAuthenticatedProtocolRelease(untrusted: unknown): Promise<Result> {
      try {
        const input = releasePublicationSchema.parse(untrusted);
        await api.prepareAuthenticatedProtocolRelease(input);
        return await api.commitPreparedProtocolReleaseCAS(input.manifest.publicationOperationId);
      } catch (error: unknown) {
        if (error instanceof Error) return "blocked";
        throw error;
      }
    },
  };
  return Object.freeze(api);
}
export type TrustedProtocolReleaseRegistry = ReturnType<
  typeof createTrustedProtocolReleaseRegistry
>;
