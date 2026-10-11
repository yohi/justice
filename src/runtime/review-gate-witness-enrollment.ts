import { createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  canonicalizeArtifactPath,
  computeCanonicalJsonFingerprint,
} from "../core/review-gate/identity.js";
import type { VerifiedFirstEnrollmentAuthorityV1 } from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import {
  withWitnessTransaction,
  workspaceFrom,
  type WitnessContext,
} from "./review-gate-witness-context.js";
import { firstEnrollmentSchema } from "./review-gate-witness-registry.js";
import { hostProofValid } from "./review-gate-witness-installation.js";
import {
  verifyProvisionerSignature,
  scopeInstallationIdSchema,
} from "./review-gate-witness-verification.js";
import type { TrustedFirstEnrollmentV1 } from "./review-gate-witness-contracts.js";

export type FirstEnrollmentRequest = Readonly<{
  designPath: string;
  planPath: string;
  workflowNonce: string;
  operationId: string;
  authorize: (payload: unknown) => Promise<string>;
}>;
function hostPayload(auth: TrustedFirstEnrollmentV1): unknown {
  return {
    authority: auth.authority,
    repositoryIdentity: auth.repositoryIdentity,
    workflowNonce: auth.workflowNonce,
    installationFrontierHash: auth.installationFrontierHash,
  };
}
export async function authorizeWorkspace(
  context: WitnessContext,
  input: FirstEnrollmentRequest,
): Promise<TrustedFirstEnrollmentV1> {
  return withWitnessTransaction(context, async (current) => {
    if (
      canonicalizeArtifactPath(input.designPath) !== input.designPath ||
      canonicalizeArtifactPath(input.planPath) !== input.planPath ||
      !scopeInstallationIdSchema.safeParse(input.workflowNonce).success ||
      !scopeInstallationIdSchema.safeParse(input.operationId).success
    )
      throw new WitnessBlocked("enrollment_invalid");
    const identity = context.options.workspaceIdentity;
    const prior = current.data.workspaces[identity];
    if (prior !== undefined) {
      if (
        prior.enrollmentState === "pending" &&
        prior.authorization.workflowNonce === input.workflowNonce &&
        prior.authorization.authority.authorizationOperationId === input.operationId &&
        prior.authorization.authority.canonicalDesignPath === input.designPath &&
        prior.authorization.authority.canonicalPlanPath === input.planPath
      )
        return prior.authorization;
      throw new WitnessBlocked("prior_enrollment");
    }
    if (
      Object.values(current.data.workspaces).some(
        (workspace) => workspace.repositoryIdentity === current.repositoryIdentity,
      ) ||
      current.data.nonces[input.workflowNonce] !== undefined
    )
      throw new WitnessBlocked("prior_enrollment_alias_or_nonce");
    try {
      if (context.provider === undefined || (await context.provider.listScopeIds()).length !== 0)
        throw new WitnessBlocked("prior_enrollment_unprovable");
    } catch (error: unknown) {
      if (error instanceof Error) throw new WitnessBlocked("prior_enrollment_unprovable");
      throw error;
    }
    const contents = {
      workspaceIdentity: identity,
      workspaceEnrollmentId: randomUUID(),
      scopes: [],
      writerHeads: [],
    };
    const frontier = { ...contents, globalFrontierHash: computeCanonicalJsonFingerprint(contents) };
    const authority: VerifiedFirstEnrollmentAuthorityV1 = {
      installationId: current.installation.installationId,
      workspaceIdentity: identity,
      canonicalDesignPath: input.designPath,
      canonicalPlanPath: input.planPath,
      authorizationOperationId: input.operationId,
      authenticatedProvisionerDigest: current.installation.authenticatedProvisionerDigest,
      verifiedAbsentPriorEnrollmentFrontierHash: frontier.globalFrontierHash,
      authorizationEventId: randomUUID(),
    };
    const payload = {
      authority,
      repositoryIdentity: current.repositoryIdentity,
      workflowNonce: input.workflowNonce,
      installationFrontierHash: current.hash,
    };
    const hostSignature = await input.authorize(payload);
    if (
      !hostProofValid(
        createPublicKey(current.installation.hostTrustRootPem),
        payload,
        hostSignature,
      )
    )
      throw new WitnessBlocked("authentication");
    const key = createPrivateKey(await context.store.readBytes("provisioner-key.pem"));
    const signature = sign(
      null,
      Buffer.from(`justice-first-enrollment-v1\0${computeCanonicalJsonFingerprint(authority)}`),
      key,
    ).toString("base64");
    const authorization = firstEnrollmentSchema.parse({ ...payload, signature, hostSignature });
    await context.store.advance("scope", current, {
      ...current.data,
      workspaces: {
        ...current.data.workspaces,
        [identity]: {
          repositoryIdentity: current.repositoryIdentity,
          frontier,
          enrollmentState: "pending",
          authorization,
        },
      },
      nonces: { ...current.data.nonces, [input.workflowNonce]: "pending" },
    });
    return authorization;
  });
}
export async function consumeFirstEnrollment(
  context: WitnessContext,
  untrusted: TrustedFirstEnrollmentV1,
): Promise<VerifiedFirstEnrollmentAuthorityV1> {
  return withWitnessTransaction(context, async (current) => {
    const parsed = firstEnrollmentSchema.safeParse(untrusted);
    if (!parsed.success) throw new WitnessBlocked("authentication");
    const auth = parsed.data;
    const workspace = workspaceFrom(current, context.options.workspaceIdentity);
    if (
      current.data.nonces[auth.workflowNonce] !== "pending" ||
      workspace.enrollmentState !== "pending"
    )
      throw new WitnessBlocked("nonce_consumed");
    if (
      computeCanonicalJsonFingerprint(auth) !==
        computeCanonicalJsonFingerprint(workspace.authorization) ||
      !hostProofValid(
        createPublicKey(current.installation.hostTrustRootPem),
        hostPayload(auth),
        auth.hostSignature,
      ) ||
      !verifyProvisionerSignature(createPublicKey(current.installation.provisionerPublicKeyPem), {
        domain: "justice-first-enrollment-v1",
        payload: auth.authority,
        signature: auth.signature,
      }) ||
      auth.repositoryIdentity !== current.repositoryIdentity ||
      auth.authority.workspaceIdentity !== context.options.workspaceIdentity ||
      workspace.frontier.scopes.length !== 0 ||
      workspace.frontier.globalFrontierHash !==
        auth.authority.verifiedAbsentPriorEnrollmentFrontierHash
    )
      throw new WitnessBlocked("authentication");
    const git = promisify(execFile);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const prefix = [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "-C",
      context.options.workspaceRoot,
    ];
    await git("git", [...prefix, "rev-parse", "--verify", "HEAD"], { env, timeout: 10_000 });
    const status = await git(
      "git",
      [...prefix, "status", "--porcelain=v1", "--untracked-files=all"],
      { env, timeout: 10_000 },
    );
    if (status.stdout.trim() !== "") throw new WitnessBlocked("workspace_dirty");
    await context.store.advance("scope", current, {
      ...current.data,
      workspaces: {
        ...current.data.workspaces,
        [context.options.workspaceIdentity]: { ...workspace, enrollmentState: "consumed" },
      },
      nonces: { ...current.data.nonces, [auth.workflowNonce]: "consumed" },
    });
    return auth.authority;
  });
}
