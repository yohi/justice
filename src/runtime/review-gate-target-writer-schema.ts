import { z } from "zod";
import { canonicalizeArtifactPath } from "../core/review-gate/identity.js";
import {
  scopeIdentitySchema as digest,
  scopeInstallationIdSchema as id,
} from "./review-gate-witness-verification.js";
import type {
  VerifiedCanonicalMutationTargetV1,
  VerifiedTargetWriterAuthorityV1,
  VerifiedTargetWriterHandoffIntentV1,
  VerifiedReviewWriterLeaseV1,
  VerifiedTerminalWriterRevokeV1,
  VerifiedTargetWriterClosingSealV1,
  VerifiedClosingSealReceiptPayloadV1,
} from "../core/review-gate/types.js";
const path = z
  .string()
  .max(1024)
  .refine((value) => canonicalizeArtifactPath(value) === value && !value.includes(":"));
const phase = z.enum(["design", "plan"]);
const mode = z.enum(["100644", "100755"]);
const ordinal = z.number().int().nonnegative();
export const targetSchema = z.strictObject({
  installationId: id,
  workspaceIdentity: digest,
  canonicalWorkspaceRoot: digest,
  canonicalLogicalTargetPath: path,
  targetIdentityDigest: digest,
  verifiedAliasSetDigest: digest,
  identityProofFrontier: digest,
}) satisfies z.ZodType<VerifiedCanonicalMutationTargetV1>;
const owner = z.strictObject({
  scopeId: id,
  gateId: id,
  generationId: id,
  operationId: id,
  attemptId: id,
});
const image = z.strictObject({ digest, gitMode: mode });
const authority = z.strictObject({
  target: targetSchema,
  globalTargetWriterGeneration: ordinal,
  activeOwner: owner.nullable(),
  priorOwner: owner.nullable(),
  expectedImage: image,
  protectedTargetFrontier: digest,
  protectedTargetCasProofDigest: digest,
  durableTombstoneProofDigest: digest.nullable(),
}) satisfies z.ZodType<VerifiedTargetWriterAuthorityV1>;
export const intentSchema = z
  .strictObject({
    purpose: z.enum(["HANDOFF", "TERMINAL_REVOKE_ONLY"]),
    status: z.literal("REQUESTED"),
    handoffOperationId: id,
    originalOperationId: id,
    scopeId: id,
    gateId: id,
    generationId: id,
    phase,
    roundOrdinal: ordinal,
    protocolFingerprint: digest,
    target: targetSchema,
    targets: z.array(targetSchema),
    closingSealOperationId: id.nullable(),
    oldOwner: owner.nullable(),
    newOwner: owner.nullable(),
    expectedTargetWriterFrontier: digest,
    expectedGlobalTargetWriterGeneration: ordinal,
    expectedGateEventFrontier: digest,
    expectedPreImageDigest: digest,
    expectedGitMode: mode,
    pendingNativeEffectReference: id.nullable(),
  })
  .refine((value) => {
    const roundOk = value.roundOrdinal <= (value.phase === "design" ? 5 : 3);
    if (value.purpose === "TERMINAL_REVOKE_ONLY") {
      return value.newOwner === null && value.targets.length > 0 && roundOk;
    }
    return value.newOwner !== null && value.targets.length === 0 && value.closingSealOperationId === null && roundOk;
  }) satisfies z.ZodType<VerifiedTargetWriterHandoffIntentV1>;
const lease = z.strictObject({
  installationId: id,
  scopeId: id,
  gateId: id,
  generationId: id,
  epochId: id,
  operationId: id,
  phase,
  roundOrdinal: ordinal,
  targetCanonicalPath: path,
  attemptId: id,
  leaseGeneration: ordinal,
  expectedPreImageDigest: digest,
  expectedGitMode: mode,
  witnessFrontierHash: digest,
  protectedLeaseProofDigest: digest,
  revokesAttemptId: id.nullable(),
}) satisfies z.ZodType<VerifiedReviewWriterLeaseV1>;
const revoke = z.strictObject({
  purpose: z.literal("TERMINAL_REVOKE_ONLY"),
  handoffOperationId: id,
  terminalTransitionOperationId: id,
  status: z.enum(["REVOKED", "NEVER_CLAIMED_OR_ALREADY_REVOKED"]),
  gateId: id,
  generationId: id,
  phase,
  roundOrdinal: ordinal,
  targets: z.array(targetSchema),
  priorOwners: z.array(owner),
  globalTargetWriterHighWatermark: ordinal,
  protectedTargetFrontier: digest,
  protectedRevokeCasProofDigest: digest,
  nativeNonWriteabilityProofDigest: digest,
  nativeEffectDisposition: z.string(),
}) satisfies z.ZodType<VerifiedTerminalWriterRevokeV1>;
const closingSealSchema = z
  .strictObject({
    marker: z.literal("TARGET_CLOSING_SEALED"),
    closingSealOperationId: id,
    handoffOperationId: id,
    terminalTransitionOperationId: id,
    gateId: id,
    generationId: id,
    targets: z.array(targetSchema).min(1),
    publicationId: id,
    preparedEventDigest: digest,
    preSealWitnessFrontier: digest,
    preSealTargetFrontier: digest,
    targetLeaseHighWatermark: ordinal,
    sealedReceiptDigest: digest.nullable(),
  })
  .refine((value) => new Set(value.targets.map((target) => target.targetIdentityDigest)).size === value.targets.length) satisfies z.ZodType<VerifiedTargetWriterClosingSealV1>;
export const closingSealReceiptPayloadSchema = z
  .strictObject({
    domain: z.literal("justice-target-closing-seal-receipt-v1"),
    installationId: id,
    closingSealOperationId: id,
    handoffOperationId: id,
    terminalTransitionOperationId: id,
    gateId: id,
    generationId: id,
    publicationId: id,
    preparedEventDigest: digest,
    targets: z.array(targetSchema).min(1),
    preSealTargetHead: digest,
    postSealTargetHead: digest,
    nativeEffectDisposition: z.string(),
  }) satisfies z.ZodType<VerifiedClosingSealReceiptPayloadV1>;
const entry = z.strictObject({
  authority,
  physicalIdentity: z.string().regex(/^[0-9]+:[0-9]+$/),
  lease: lease.nullable(),
  pendingEffect: z.strictObject({ operationId: id, prior: image, next: image }).nullable(),
});
const handoff = z.strictObject({
  intent: intentSchema,
  status: z.enum(["REQUESTED", "FENCED", "CLAIMED"]),
  nativeProofDigest: digest.nullable(),
});
export const targetRegistrySchema = z.strictObject({
  targets: z.record(digest, entry),
  handoffs: z.record(id, handoff),
  terminals: z.record(
    id,
    z.strictObject({
      intents: z.array(intentSchema).min(1),
      terminalTransitionOperationId: id,
      proof: revoke.nullable(),
      nativeProofDigests: z.array(digest),
    }),
  ),
  closingSeals: z.record(id, closingSealSchema),
});
export type TargetRegistry = z.infer<typeof targetRegistrySchema>;
export type TargetEntry = z.infer<typeof entry>;
