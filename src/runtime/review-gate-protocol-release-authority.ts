/**
 * Task 18 — read-only verified protocol release authority.
 *
 * `createVerifiedProtocolReleaseProvider` verifies an independently
 * provisioned trusted release anchor (Task 5) against the installed protocol
 * release registry. It is the only channel through which an NC1 protocol-kind
 * eligible change may claim a verified release transition: the provider
 * verifies the exact old release pinned by the NC1 stop plus its immutable
 * canonical descriptor bytes, the newly installed release bytes, the
 * publisher signature over the release envelope, the release ancestry chain,
 * and the monotonic protected registry head.
 *
 * The provider is strictly read-only: it publishes no events — durable
 * transition publication belongs to the admission orchestrator (coordinator
 * `publishSemanticContextTransition`). Any unresolvable or tampered material
 * yields the `BLOCK` outcome instead of a fabricated delta.
 */

import type {
  TrustedProtocolReleaseAnchorV1,
} from "../core/review-gate/types";
import { computeCanonicalJsonFingerprint, computeArtifactDigest } from "../core/review-gate/identity";
import type { VerifiedProtocolReleaseDeltaV1 } from "../core/review-gate/types";

export type { VerifiedProtocolReleaseDeltaV1 };

export const PROTOCOL_RELEASE_SIGNATURE_DOMAIN = "justice-protocol-release-v1";
export const PROTOCOL_RELEASE_SCHEMA_VERSION = "justice-protocol-release-v1";

export type VerifiedProtocolReleasePhase = "design" | "plan";

/**
 * One registered protocol release record. The immutable canonical descriptor
 * bytes are the release payload; `descriptorDigest` is their exact SHA-256
 * digest and `publisherSignature` authenticates the canonical envelope.
 */
export type ProtocolReleaseRecordV1 = Readonly<{
  readonly schemaVersion: typeof PROTOCOL_RELEASE_SCHEMA_VERSION;
  readonly releaseId: string;
  readonly phase: VerifiedProtocolReleasePhase;
  /** SHA-256 digest of `canonicalDescriptorBytes` (exact bytes identity). */
  readonly descriptorDigest: string;
  readonly phaseFingerprint: string;
  /** Immutable canonical descriptor bytes (UTF-8) of this release. */
  readonly canonicalDescriptorBytes: string;
  /** Digest of the publisher identity or verification key. */
  readonly publisherKeyDigest: string;
  /** ed25519 signature over the canonical release envelope. */
  readonly publisherSignature: string;
  /** Direct release-chain ancestry: the immediate predecessor release ids. */
  readonly ancestorReleaseIds: readonly string[];
  /** Protected registry head this release is anchored to. */
  readonly registryHead: string;
}>;

/** Read-only release registry seam. Trusted composition input. */
export interface VerifiedProtocolReleaseSource {
  readonly readRegistryHead: () => Promise<string | null>;
  readonly readRelease: (releaseId: string) => Promise<ProtocolReleaseRecordV1 | null>;
  readonly readReleaseByDescriptorDigest: (
    descriptorDigest: string,
  ) => Promise<ProtocolReleaseRecordV1 | null>;
}

/** Publisher signature verifier seam. Trusted composition input (pinned key). */
export type VerifiedProtocolReleaseSignatureVerifier = (input: Readonly<{
  readonly domain: string;
  readonly payload: unknown;
  readonly signature: string;
  readonly publisherKeyDigest: string;
}>) => Promise<boolean>;

export interface VerifiedProtocolReleaseProviderOptions {
  /** The Task 5 independently provisioned trusted release anchor. */
  readonly anchor: TrustedProtocolReleaseAnchorV1;
  /** The release registry source (protected OS provenance in production). */
  readonly source: VerifiedProtocolReleaseSource;
  /** Pinned ed25519 signature verifier over the release envelope. */
  readonly verifyPublisherSignature: VerifiedProtocolReleaseSignatureVerifier;
}

export type VerifiedPhaseProtocolDeltaInput = Readonly<{
  workspaceIdentity: string;
  phase: VerifiedProtocolReleasePhase;
  nc1StopEventId: string;
  beforeFingerprint: string;
  beforeReleaseId: string;
  historicalReleaseProofDigest: string;
  trustedPublisherPolicyVersion: string;
  currentDescriptorDigest: string;
  witnessFrontierHash: string;
}>;

export interface VerifiedProtocolReleaseProvider {
  readVerifiedPhaseProtocolDelta(
    input: VerifiedPhaseProtocolDeltaInput,
  ): Promise<VerifiedProtocolReleaseDeltaV1 | "BLOCK">;
}

const isHexDigest64 = (value: string): boolean => /^[0-9a-f]{64}$/u.test(value);
const isRegistryHead = (value: string): boolean =>
  value.length > 0 && !value.includes("\u0000") && value.trim() === value;

/** Verify the structural shape of one release record before any trust step. */
function isWellFormedReleaseRecord(
  record: ProtocolReleaseRecordV1,
  phase: VerifiedProtocolReleasePhase,
): boolean {
  if (record === null || typeof record !== "object") return false;
  if (record.schemaVersion !== PROTOCOL_RELEASE_SCHEMA_VERSION) return false;
  if (typeof record.releaseId !== "string" || record.releaseId.length === 0) return false;
  if (record.phase !== phase) return false;
  if (!isHexDigest64(record.descriptorDigest)) return false;
  if (typeof record.phaseFingerprint !== "string" || record.phaseFingerprint.length === 0) {
    return false;
  }
  if (typeof record.canonicalDescriptorBytes !== "string") return false;
  if (typeof record.publisherKeyDigest !== "string" || record.publisherKeyDigest.length === 0) {
    return false;
  }
  if (typeof record.publisherSignature !== "string" || record.publisherSignature.length === 0) {
    return false;
  }
  if (!Array.isArray(record.ancestorReleaseIds)) return false;
  if (!isRegistryHead(record.registryHead)) return false;
  return true;
}

/** Canonical release envelope payload covered by the publisher signature. */
function releaseSignaturePayload(
  record: ProtocolReleaseRecordV1,
): Readonly<{
  readonly domain: string;
  readonly schemaVersion: typeof PROTOCOL_RELEASE_SCHEMA_VERSION;
  readonly releaseId: string;
  readonly phase: VerifiedProtocolReleasePhase;
  readonly descriptorDigest: string;
  readonly phaseFingerprint: string;
  readonly registryHead: string;
  readonly ancestorReleaseIds: readonly string[];
}> {
  return Object.freeze({
    domain: PROTOCOL_RELEASE_SIGNATURE_DOMAIN,
    schemaVersion: record.schemaVersion,
    releaseId: record.releaseId,
    phase: record.phase,
    descriptorDigest: record.descriptorDigest,
    phaseFingerprint: record.phaseFingerprint,
    registryHead: record.registryHead,
    ancestorReleaseIds: record.ancestorReleaseIds,
  });
}

/**
 * Create the read-only verified protocol release provider. Every unmet
 * expectation (missing registry, tampered bytes, broken ancestry, non-advancing
 * or rolled-back registry head, untrusted publisher) yields `"BLOCK"`.
 */
export function createVerifiedProtocolReleaseProvider(
  options: VerifiedProtocolReleaseProviderOptions,
): VerifiedProtocolReleaseProvider {
  const { anchor, source, verifyPublisherSignature } = options;

  const verifyReleaseAuthentication = async (
    record: ProtocolReleaseRecordV1,
  ): Promise<boolean> => {
    if (record.publisherKeyDigest !== anchor.publisherIdentityOrKeyDigest) return false;
    return await verifyPublisherSignature({
      domain: PROTOCOL_RELEASE_SIGNATURE_DOMAIN,
      payload: releaseSignaturePayload(record),
      signature: record.publisherSignature,
      publisherKeyDigest: record.publisherKeyDigest,
    });
  };

  return Object.freeze({
    async readVerifiedPhaseProtocolDelta(input: VerifiedPhaseProtocolDeltaInput): Promise<VerifiedProtocolReleaseDeltaV1 | "BLOCK"> {
      try {
        if (
          input.workspaceIdentity.length === 0 ||
          input.nc1StopEventId.length === 0 ||
          input.beforeReleaseId.length === 0 ||
          !isHexDigest64(input.historicalReleaseProofDigest) ||
          !isHexDigest64(input.currentDescriptorDigest)
        ) {
          return "BLOCK";
        }

        const currentHead = await source.readRegistryHead();
        if (currentHead === null || !isRegistryHead(currentHead)) return "BLOCK";

        // Old release: exactly the release id the NC1 stop pinned, with its
        // immutable canonical descriptor bytes and phase fingerprint.
        const oldRelease = await source.readRelease(input.beforeReleaseId);
        if (
          oldRelease === null ||
          !isWellFormedReleaseRecord(oldRelease, input.phase)
        ) {
          return "BLOCK";
        }
        const oldBytesDigest = computeArtifactDigest(
          Buffer.from(oldRelease.canonicalDescriptorBytes, "utf8"),
        );
        if (oldBytesDigest !== oldRelease.descriptorDigest) return "BLOCK";
        if (oldRelease.phaseFingerprint !== input.beforeFingerprint) return "BLOCK";
        if (
          computeCanonicalJsonFingerprint({
            domain: PROTOCOL_RELEASE_SIGNATURE_DOMAIN,
            schemaVersion: oldRelease.schemaVersion,
            releaseId: oldRelease.releaseId,
            descriptorDigest: oldRelease.descriptorDigest,
            phaseFingerprint: oldRelease.phaseFingerprint,
            registryHead: oldRelease.registryHead,
          }) !== input.historicalReleaseProofDigest
        ) {
          return "BLOCK";
        }
        if (!(await verifyReleaseAuthentication(oldRelease))) return "BLOCK";

        // The trusting caller's publisher policy must match the anchor.
        if (input.trustedPublisherPolicyVersion !== anchor.trustPolicyVersion) return "BLOCK";

        // New release: identified by the exact currently installed descriptor
        // bytes digest; it must exist, verify and continue the old chain.
        const newRelease = await source.readReleaseByDescriptorDigest(
          input.currentDescriptorDigest,
        );
        if (newRelease === null || !isWellFormedReleaseRecord(newRelease, input.phase)) {
          return "BLOCK";
        }
        const newBytesDigest = computeArtifactDigest(
          Buffer.from(newRelease.canonicalDescriptorBytes, "utf8"),
        );
        if (
          newBytesDigest !== newRelease.descriptorDigest ||
          newRelease.descriptorDigest !== input.currentDescriptorDigest
        ) {
          return "BLOCK";
        }
        if (!(await verifyReleaseAuthentication(newRelease))) return "BLOCK";

        // Ancestry: the new release must continue the old chain and rotate
        // keys/heads forward; the anchor head must remain in the chain history.
        if (!newRelease.ancestorReleaseIds.includes(oldRelease.releaseId)) return "BLOCK";
        if (oldRelease.registryHead === newRelease.registryHead) {
          // Re-anchoring the same registry head is a rollback, not a release.
          return "BLOCK";
        }

        // Monotonic protected registry head: the installed release must be
        // anchored at the CURRENT head (a stale release head, or a head that
        // regressed below the anchor, is rolled back history).
        if (newRelease.registryHead !== currentHead) return "BLOCK";

        return Object.freeze<VerifiedProtocolReleaseDeltaV1>({
          oldReleaseId: oldRelease.releaseId,
          newReleaseId: newRelease.releaseId,
          oldDescriptorDigest: oldRelease.descriptorDigest,
          newDescriptorDigest: newRelease.descriptorDigest,
          oldPhaseFingerprint: oldRelease.phaseFingerprint,
          newPhaseFingerprint: newRelease.phaseFingerprint,
          chainProofDigest: computeCanonicalJsonFingerprint({
            domain: PROTOCOL_RELEASE_SIGNATURE_DOMAIN,
            oldReleaseId: oldRelease.releaseId,
            oldRegistryHead: oldRelease.registryHead,
            ancestorReleaseIds: newRelease.ancestorReleaseIds,
            newReleaseId: newRelease.releaseId,
            newRegistryHead: newRelease.registryHead,
          }),
          publisherProofDigest: computeCanonicalJsonFingerprint({
            domain: PROTOCOL_RELEASE_SIGNATURE_DOMAIN,
            anchorPublisherDigest: anchor.publisherIdentityOrKeyDigest,
            newPublisherKeyDigest: newRelease.publisherKeyDigest,
          }),
          verifiedProtectedHead: newRelease.registryHead,
          trustPolicyVersion: anchor.trustPolicyVersion,
        });
      } catch {
        // Verification internals never surface as a partial delta.
        return "BLOCK";
      }
    },
  });
}
