import { z } from "zod";
import type { ReviewProtocolDescriptorV1 } from "./review-gate-protocol.js";
import {
  scopeIdentitySchema as digest,
  scopeInstallationIdSchema as id,
} from "./review-gate-witness-verification.js";
const phase = z.strictObject({
  phasePolicyVersion: z.literal(1),
  reviewerPromptContractDigest: digest,
  validatorPromptContractDigest: digest,
  remediatorPromptContractDigest: digest,
  selfReviewPromptContractDigest: digest,
});
const descriptor = z.strictObject({
  descriptorVersion: z.literal(1),
  requirementsResolutionPolicyVersion: z.number().int().positive(),
  authorityPolicy: z.strictObject({
    historical: z.number().int().positive(),
    current: z.number().int().positive(),
  }),
  crossPhase: z.strictObject({
    controllerRelayContractVersion: z.literal(1),
    maxDesignRemediationRounds: z.literal(5),
    maxPlanRemediationRounds: z.literal(3),
    sharedFindingValidatorContractVersion: z.literal(1),
    sharedSeverityPolicyVersion: z.literal(1),
    sharedResolutionPolicyVersion: z.literal(1),
    sharedLineagePolicyVersion: z.literal(1),
    sharedConvergencePolicyVersion: z.literal(1),
  }),
  designPhase: phase,
  planPhase: phase,
}) satisfies z.ZodType<ReviewProtocolDescriptorV1>;
export const releaseHeadSchema = z.strictObject({
  releaseId: id.nullable(),
  sequence: z.number().int().nonnegative(),
  frontierHash: digest,
});
export const releaseManifestSchema = z.strictObject({
  installationId: id,
  publicationOperationId: id,
  expectedProtectedReleaseHead: releaseHeadSchema,
  parentReleaseId: id.nullable(),
  releaseId: id,
  trustPolicyVersion: id,
  sourceDigest: digest,
  descriptor,
  reviewProtocolFingerprint: digest,
  designProtocolFingerprint: digest,
  planProtocolFingerprint: digest,
  promptRegistryDigest: digest,
  validatorRegistryDigest: digest,
  semanticPolicyRegistryDigest: digest,
  keyRotationReference: digest.nullable(),
});
export const releaseEvidenceSchema = z.strictObject({
  manifest: releaseManifestSchema,
  publisherSignature: z.string(),
  installerSignature: z.string(),
});
export const releasePublicationSchema = releaseEvidenceSchema.extend({
  sourceBytes: z.instanceof(Uint8Array),
});
export type AuthenticatedProtocolReleasePublicationInput = z.infer<typeof releasePublicationSchema>;
export const releaseAnchorSchema = z.strictObject({
  installationId: id,
  trustPolicyVersion: id,
  publisherPublicKeyPem: z.string(),
  initialFrontierDigest: digest,
  authorizationSignature: z.string(),
});
const policySchema = z.strictObject({
  version: id,
  publisherPublicKeyPem: z.string(),
  rotationReference: digest.nullable(),
  authorizationSignature: z.string(),
});
export const releaseRegistrySchema = z.strictObject({
  head: releaseHeadSchema,
  currentPolicy: id,
  policies: z.record(id, policySchema),
  releases: z.record(id, releaseEvidenceSchema),
  pending: z.record(id, releaseEvidenceSchema),
  receipts: z.record(id, releaseEvidenceSchema),
});
export type ReleaseRegistry = z.infer<typeof releaseRegistrySchema>;
