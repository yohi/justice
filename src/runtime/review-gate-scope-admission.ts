import { execFile } from "node:child_process";
import { createHash, type KeyObject } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import {
  computeRepositoryIdentity,
  computeWorkspaceIdentity,
} from "../core/review-gate/identity.js";
import type {
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedScopeFrontier,
} from "../core/review-gate/types.js";
import {
  ScopeAdmissionBlocked,
  protectedScopeSnapshotSchema,
  scopeAdmissionRequestSchema,
  scopeIdentitySchema,
  scopeInstallationIdSchema,
  verifyProvisionerSignature,
  verifyScopeFrontierMembership,
} from "./review-gate-witness-verification.js";

/** Independently installed host capability, never exposed to workers.
 * The host must read live, rollback-protected installation-wide state under an
 * OS-enforced guard, including journal membership/alias checks. A signature alone
 * does not prove freshness or isolation. Missing/corrupt state must throw.
 */
export type ProtectedScopeAdmissionHost = Readonly<{
  withWorkspaceAdmissionGuard<T>(run: () => Promise<T>): Promise<T>;
  readCurrentProtectedFrontier(): Promise<unknown>;
}>;
export type ScopeAdmissionOptions = Readonly<{
  workspaceRoot: string;
  installationId: string;
  provisionerPublicKey: KeyObject;
  host: ProtectedScopeAdmissionHost;
}>;
export type ReviewGateScopeAdmissionVerifier = Readonly<{
  readWorkspaceScopeFrontier(): Promise<VerifiedScopeFrontier>;
  verifyFirstWorkspaceEnrollment(input: unknown): Promise<VerifiedFirstEnrollmentAuthorityV1>;
}>;
const gitExec = promisify(execFile);

async function git(root: string, args: readonly string[]): Promise<string> {
  try {
    // Ignore inherited Git redirection, alternate object databases and config.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const result = await gitExec(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", root, ...args],
      {
        env,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    return result.stdout.trim();
  } catch (error: unknown) {
    if (error instanceof Error) throw new ScopeAdmissionBlocked("workspace_identity");
    throw error;
  }
}

/** Only Git-discovered canonical roots are hashed; no host path leaves this API.
 * HEAD is deliberately not identity: normal commits must not reset enrollment.
 */
export async function observeGitWorkspaceIdentity(workspaceRoot: string): Promise<string> {
  return (await observeGitWorkspace(workspaceRoot)).workspaceIdentity;
}

export async function observeGitWorkspace(
  workspaceRoot: string,
): Promise<Readonly<{ workspaceIdentity: string; repositoryIdentity: string }>> {
  try {
    const root = await realpath(await git(workspaceRoot, ["rev-parse", "--show-toplevel"]));
    if (root !== (await realpath(workspaceRoot)))
      throw new ScopeAdmissionBlocked("workspace_identity");
    const common = await realpath(
      await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    );
    return Object.freeze({
      workspaceIdentity: computeWorkspaceIdentity(root),
      repositoryIdentity: computeRepositoryIdentity(common),
    });
  } catch (error: unknown) {
    if (error instanceof Error) throw new ScopeAdmissionBlocked("workspace_identity");
    throw error;
  }
}

/** Read-only witness verifier. It cannot provision, enroll or reset history.
 * The pinned key/installation and host capability are trusted composition inputs,
 * not caller-supplied evidence. DEP-02 host deployment remains a prerequisite.
 */
export function createReviewGateScopeAdmissionVerifier(
  options: ScopeAdmissionOptions,
): ReviewGateScopeAdmissionVerifier {
  const { workspaceRoot, installationId, provisionerPublicKey, host } = options;
  if (
    provisionerPublicKey.type !== "public" ||
    provisionerPublicKey.asymmetricKeyType !== "ed25519" ||
    !scopeInstallationIdSchema.safeParse(installationId).success
  ) {
    throw new ScopeAdmissionBlocked("proof");
  }
  const provisionerDigest = createHash("sha256")
    .update(provisionerPublicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await host.withWorkspaceAdmissionGuard(run);
    } catch (error: unknown) {
      if (error instanceof ScopeAdmissionBlocked) throw error;
      if (error instanceof Error) throw new ScopeAdmissionBlocked("protected_frontier");
      throw error;
    }
  }
  async function readFrontier(workspaceIdentity: string): Promise<VerifiedScopeFrontier> {
    const parsed = protectedScopeSnapshotSchema.safeParse(
      await host.readCurrentProtectedFrontier(),
    );
    if (!parsed.success) throw new ScopeAdmissionBlocked("protected_frontier");
    const { signature, ...payload } = parsed.data;
    if (
      payload.installationId !== installationId ||
      payload.frontier.workspaceIdentity !== workspaceIdentity ||
      !verifyProvisionerSignature(provisionerPublicKey, {
        domain: "justice-scope-frontier-v1",
        payload,
        signature,
      })
    )
      throw new ScopeAdmissionBlocked("protected_frontier");
    verifyScopeFrontierMembership(payload.frontier);
    return payload.frontier;
  }
  return Object.freeze({
    async readWorkspaceScopeFrontier(): Promise<VerifiedScopeFrontier> {
      return guarded(async () => readFrontier(await observeGitWorkspaceIdentity(workspaceRoot)));
    },
    async verifyFirstWorkspaceEnrollment(
      input: unknown,
    ): Promise<VerifiedFirstEnrollmentAuthorityV1> {
      return guarded(async () => {
        const workspaceIdentity = await observeGitWorkspaceIdentity(workspaceRoot);
        const identityInput = z.object({ workspaceIdentity: scopeIdentitySchema }).safeParse(input);
        if (!identityInput.success || identityInput.data.workspaceIdentity !== workspaceIdentity)
          throw new ScopeAdmissionBlocked("workspace_identity");
        const parsed = scopeAdmissionRequestSchema.safeParse(input);
        if (!parsed.success) throw new ScopeAdmissionBlocked("proof");
        const request = parsed.data;
        const frontier = await readFrontier(workspaceIdentity);
        if (frontier.scopes.length !== 0 || frontier.writerHeads.length !== 0)
          throw new ScopeAdmissionBlocked("prior_enrollment");
        const { authority, signature } = request.proof;
        if (
          !verifyProvisionerSignature(provisionerPublicKey, {
            domain: "justice-first-enrollment-v1",
            payload: authority,
            signature,
          }) ||
          authority.installationId !== installationId ||
          authority.workspaceIdentity !== workspaceIdentity ||
          authority.authenticatedProvisionerDigest !== provisionerDigest ||
          authority.authorizationOperationId !== request.authorizationOperationId ||
          authority.canonicalDesignPath !== request.canonicalDesignPath ||
          authority.canonicalPlanPath !== request.canonicalPlanPath ||
          authority.verifiedAbsentPriorEnrollmentFrontierHash !== frontier.globalFrontierHash
        )
          throw new ScopeAdmissionBlocked("proof");
        await git(workspaceRoot, ["rev-parse", "--verify", "HEAD"]);
        if (await git(workspaceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]))
          throw new ScopeAdmissionBlocked("workspace_dirty");
        return authority;
      });
    },
  });
}
