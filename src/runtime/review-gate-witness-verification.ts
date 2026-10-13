import { verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import {
  canonicalizeArtifactPath,
  computeCanonicalJsonFingerprint,
} from "../core/review-gate/identity.js";
import type {
  ScopeEnrollmentV1,
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedScopeFrontier,
} from "../core/review-gate/types.js";

type AdmissionBlockCode =
  | "workspace_identity"
  | "workspace_dirty"
  | "protected_frontier"
  | "prior_enrollment"
  | "proof";
export class ScopeAdmissionBlocked extends Error {
  constructor(readonly code: AdmissionBlockCode) {
    super(`review_gate_scope_admission_${code}`);
  }
}
export const scopeIdentitySchema = z.string().regex(/^[a-f0-9]{64}$/);
export const scopeInstallationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const digest = scopeIdentitySchema;
const id = scopeInstallationIdSchema;
const artifactPath = z
  .string()
  .max(1024)
  .refine((value) => canonicalizeArtifactPath(value) === value && !value.includes(":"));
const membership = z
  .strictObject({
    gateId: id,
    generationId: id,
    supersedesGateId: id.nullable(),
    admissionEventId: id,
    writerIds: z.array(id).readonly(),
  })
  .readonly();
export const scopeSchema = z
  .strictObject({
    scopeId: id,
    workflowContinuityId: id,
    canonicalDesignPath: artifactPath,
    canonicalPlanPath: artifactPath,
    pathPairDigest: digest,
    provenance: z
      .strictObject({
        kind: z.enum([
          "verified_genesis",
          "verified_completed_successor",
          "verified_independent_workflow",
        ]),
        evidenceDigest: digest,
        priorScopeId: id.nullable(),
        priorGateId: id.nullable(),
      })
      .readonly(),
    gateMembership: z.array(membership).readonly(),
  })
  .readonly() satisfies z.ZodType<ScopeEnrollmentV1>;
export const frontierSchema = z
  .strictObject({
    workspaceIdentity: digest,
    workspaceEnrollmentId: id,
    scopes: z.array(scopeSchema).readonly(),
    writerHeads: z
      .array(
        z
          .strictObject({
            scopeId: id,
            gateId: id,
            writerId: id,
            sequence: z.number().int().nonnegative(),
            hash: digest,
          })
          .readonly(),
      )
      .readonly(),
    globalFrontierHash: digest,
  })
  .readonly() satisfies z.ZodType<VerifiedScopeFrontier>;
const authoritySchema = z
  .strictObject({
    installationId: id,
    workspaceIdentity: digest,
    canonicalDesignPath: artifactPath,
    canonicalPlanPath: artifactPath,
    authorizationOperationId: id,
    authenticatedProvisionerDigest: digest,
    verifiedAbsentPriorEnrollmentFrontierHash: digest,
    authorizationEventId: id,
  })
  .readonly() satisfies z.ZodType<VerifiedFirstEnrollmentAuthorityV1>;
const signatureSchema = z.string().regex(/^[A-Za-z0-9+/]{86}==$/);
export const protectedScopeSnapshotSchema = z.strictObject({
  installationId: id,
  frontier: frontierSchema,
  signature: signatureSchema,
});
export const scopeAdmissionRequestSchema = z.strictObject({
  workspaceIdentity: digest,
  canonicalDesignPath: artifactPath,
  canonicalPlanPath: artifactPath,
  authorizationOperationId: id,
  proof: z.strictObject({ authority: authoritySchema, signature: signatureSchema }),
});

export function verifyProvisionerSignature(
  key: KeyObject,
  proof: Readonly<{ domain: string; payload: unknown; signature: string }>,
): boolean {
  return verify(
    null,
    Buffer.from(`${proof.domain}\0${computeCanonicalJsonFingerprint(proof.payload)}`),
    key,
    Buffer.from(proof.signature, "base64"),
  );
}
function isCanonicalSet(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || (values[index - 1] ?? "") < value);
}
export function verifyScopeFrontierMembership(frontier: VerifiedScopeFrontier): void {
  const { globalFrontierHash, ...contents } = frontier;
  const gates = new Set<string>();
  const writerKeys = new Set<string>();
  if (
    computeCanonicalJsonFingerprint(contents) !== globalFrontierHash ||
    !isCanonicalSet(frontier.scopes.map((scope) => scope.scopeId))
  ) {
    throw new ScopeAdmissionBlocked("protected_frontier");
  }
  for (const scope of frontier.scopes) {
    if (
      scope.pathPairDigest !==
        computeCanonicalJsonFingerprint([scope.canonicalDesignPath, scope.canonicalPlanPath]) ||
      !isCanonicalSet(scope.gateMembership.map((gate) => gate.gateId))
    )
      throw new ScopeAdmissionBlocked("protected_frontier");
    for (const gate of scope.gateMembership) {
      if (gates.has(gate.gateId) || !isCanonicalSet(gate.writerIds))
        throw new ScopeAdmissionBlocked("protected_frontier");
      gates.add(gate.gateId);
      for (const writer of gate.writerIds)
        writerKeys.add(`${scope.scopeId}\0${gate.gateId}\0${writer}`);
    }
  }
  const heads = frontier.writerHeads.map(
    (head) => `${head.scopeId}\0${head.gateId}\0${head.writerId}`,
  );
  if (
    !isCanonicalSet(heads) ||
    heads.length !== writerKeys.size ||
    heads.some((head) => !writerKeys.has(head))
  ) {
    throw new ScopeAdmissionBlocked("protected_frontier");
  }
}
