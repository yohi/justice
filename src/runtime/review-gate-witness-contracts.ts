import type { KeyObject } from "node:crypto";
import type {
  VerifiedFirstEnrollmentAuthorityV1,
  ScopeEnrollmentV1,
  VerifiedScopeFrontier,
} from "../core/review-gate/types.js";

export type TrustedWitnessInstallationV1 = Readonly<{
  installationId: string;
  epoch: string;
  provisionerPublicKeyPem: string;
  hostTrustRootPem: string;
  authenticatedProvisionerDigest: string;
  ownerUid: number;
  authorizationSignature: string;
  directoryIdentityDigest: string;
}>;
export type AuthenticatedHostProvisionRequest = Readonly<{
  witnessDirectory: string;
  hostTrustRoot: KeyObject;
  authorize: (installation: unknown) => Promise<string>;
}>;
export type TrustedFirstEnrollmentV1 = Readonly<{
  authority: VerifiedFirstEnrollmentAuthorityV1;
  signature: string;
  repositoryIdentity: string;
  workflowNonce: string;
  installationFrontierHash: string;
  hostSignature: string;
}>;
export type AdmittedMembership = Readonly<{
  readonly gateId: string;
  readonly generationId: string;
  readonly operationId: string;
  readonly writerId: string;
  readonly writerHead: Readonly<{ readonly sequence: number; readonly hash: string }>;
  readonly supersedesGateId: string | null;
  readonly authorization: Readonly<{
    readonly installationId: string;
    readonly workspaceIdentity: string;
    readonly operationId: string;
    readonly expectedWorkspaceFrontier: string;
    readonly scope: ScopeEnrollmentV1;
    readonly signature: string;
  }>;
}>;

export type PreparedWitnessPublicationV1 = Readonly<{
  installationId: string;
  workspaceIdentity: string;
  scopeId: string;
  gateId: string;
  writerId: string;
  operationId: string;
  publicationId: string;
  expectedInstallationFrontier: string;
  expectedGlobalFrontier: string;
  expectedWriterSequence: number;
  expectedWriterHash: string;
  newWriterSequence: number;
  newWriterHash: string;
  canonicalShardPath: string;
  newTailLength: number;
  newTailDigest: string;
  newGlobalFrontier: string;
  firstEnrollmentAuthorizationId: string | null;
  payloadSchemaVersion: 1;
  nextFrontier: VerifiedScopeFrontier;
}>;
export type PublicationCommitInput = Readonly<{
  publicationId: string;
  expectedGlobalFrontier: string;
  expectedWriterHash: string;
}>;
export type PublicationCommitResult = "advanced" | "already_committed" | "blocked";

/**
 * Task 18 — bounded input of one prepared V2 journal publication. Derived by
 * the coordinator from the durable V2 journal state around one append batch;
 * the seam turns it into a `PreparedWitnessPublicationV1` staged with the
 * Review Gate witness service.
 */
export type PreparedV2JournalPublicationInputV1 = Readonly<{
  readonly gateId: string;
  readonly writerId: string;
  /** Logical operation whose appended evidence is being published. */
  readonly operationId: string;
  /** Canonical newline-terminated encoded batch appended to the journal. */
  readonly canonicalEventBytes: Uint8Array;
  /** Frontier hash of the V2 journal before the append (CAS preimage). */
  readonly baseFrontierHash: string;
  /** Frontier hash of the V2 journal including the appended batch. */
  readonly newFrontierHash: string;
  readonly newTailLength: number;
  readonly newTailDigest: string;
  readonly appendedEventCount: number;
}>;

/**
 * Task 18 — witness publication seam for durable V2 journal appends. The
 * coordinator invokes `prepareAndPublish` after every V2 journal append; a
 * production binding produces the `PreparedWitnessPublicationV1` for the
 * exact appended bytes and submits it to the witness service. The `null`
 * coordinator option selects durable local custody without witness
 * registration.
 */
export type ReviewGateWitnessPublicationSeamV1 = Readonly<{
  readonly prepareAndPublish: (
    input: PreparedV2JournalPublicationInputV1,
  ) => Promise<PreparedWitnessPublicationV1>;
}>;
