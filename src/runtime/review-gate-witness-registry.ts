import { z } from "zod";
import {
  frontierSchema,
  scopeSchema,
  scopeAdmissionRequestSchema,
  scopeIdentitySchema as digest,
  scopeInstallationIdSchema as id,
} from "./review-gate-witness-verification.js";
import type {
  PreparedWitnessPublicationV1,
  AdmittedMembership,
  TrustedFirstEnrollmentV1,
  TrustedWitnessInstallationV1,
} from "./review-gate-witness-contracts.js";

export const installationSchema = z.strictObject({
  installationId: id,
  epoch: id,
  provisionerPublicKeyPem: z.string().max(2048),
  hostTrustRootPem: z.string().max(2048),
  authenticatedProvisionerDigest: digest,
  ownerUid: z.number().int().nonnegative(),
  authorizationSignature: z.string(),
  directoryIdentityDigest: digest,
}) satisfies z.ZodType<TrustedWitnessInstallationV1>;
export const firstEnrollmentSchema = z.strictObject({
  authority: scopeAdmissionRequestSchema.shape.proof.shape.authority,
  signature: z.string(),
  repositoryIdentity: digest,
  workflowNonce: id,
  installationFrontierHash: digest,
  hostSignature: z.string(),
}) satisfies z.ZodType<TrustedFirstEnrollmentV1>;
export const publicationSchema = z.strictObject({
  installationId: id,
  workspaceIdentity: digest,
  scopeId: id,
  gateId: id,
  writerId: id,
  operationId: id,
  publicationId: id,
  expectedInstallationFrontier: digest,
  expectedGlobalFrontier: digest,
  expectedWriterSequence: z.number().int().nonnegative(),
  expectedWriterHash: digest,
  newWriterSequence: z.number().int().positive(),
  newWriterHash: digest,
  canonicalShardPath: z.string().max(1024),
  newTailLength: z.number().int().positive().max(64 * 1024),
  newTailDigest: digest,
  newGlobalFrontier: digest,
  firstEnrollmentAuthorizationId: id.nullable(),
  payloadSchemaVersion: z.literal(1),
  nextFrontier: frontierSchema,
}) satisfies z.ZodType<PreparedWitnessPublicationV1>;
export const admittedMembershipSchema = z.strictObject({
  gateId: id,
  generationId: id,
  operationId: id,
  writerId: id,
  writerHead: z.strictObject({ sequence: z.number().int().positive(), hash: digest }),
  supersedesGateId: id.nullable(),
  authorization: z.strictObject({
    installationId: id,
    workspaceIdentity: digest,
    operationId: id,
    expectedWorkspaceFrontier: digest,
    scope: scopeSchema,
    signature: z.string(),
  }),
}) satisfies z.ZodType<AdmittedMembership>;
const committedPublicationSchema = z.strictObject({
  input: publicationSchema.omit({ nextFrontier: true }).extend({
    nextFrontier: frontierSchema.optional(),
  }),
  stagingDigest: digest,
  byteLength: z.number().int().positive(),
  preparedRevision: z.number().int().positive(),
});
const workspaceSchema = z.strictObject({
  repositoryIdentity: digest,
  frontier: frontierSchema,
  enrollmentState: z.enum(["pending", "consumed", "committed"]),
  authorization: firstEnrollmentSchema,
});
const pendingSchema = z.strictObject({
  input: publicationSchema,
  stagingDigest: digest,
  byteLength: z.number().int().positive(),
  preparedRevision: z.number().int().positive(),
});
export const scopeRegistrySchema = z.strictObject({
  installationId: id,
  workspaces: z.record(digest, workspaceSchema),
  nonces: z.record(id, z.enum(["pending", "consumed"])),
  pending: z.record(id, pendingSchema),
  committed: z.record(id, committedPublicationSchema),
  cancelled: z.record(id, pendingSchema),
  scopeAuthorizations: z.record(
    id,
    z.strictObject({
      installationId: id,
      workspaceIdentity: digest,
      operationId: id,
      expectedWorkspaceFrontier: digest,
      scope: scopeSchema,
      signature: z.string(),
      consumed: z.boolean(),
    }),
  ),
});
export type ScopeRegistry = z.infer<typeof scopeRegistrySchema>;
export type ScopeWorkspace = z.infer<typeof workspaceSchema>;
