import type { KeyObject } from "node:crypto";
import type {
  VerifiedFirstEnrollmentAuthorityV1,
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
