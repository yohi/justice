import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeCanonicalJsonFingerprint,
  computeWorkspaceIdentity,
} from "../../src/core/review-gate/identity.js";
import type {
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedScopeFrontier,
} from "../../src/core/review-gate/types.js";
import {
  createReviewGateScopeAdmissionVerifier,
  observeGitWorkspaceIdentity,
} from "../../src/runtime/review-gate-scope-admission.js";

const keys = generateKeyPairSync("ed25519");
const provisionerDigest = createHash("sha256")
  .update(keys.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const digest = "a".repeat(64);
function signature(domain: string, payload: unknown): string {
  return sign(
    null,
    Buffer.from(`${domain}\0${computeCanonicalJsonFingerprint(payload)}`),
    keys.privateKey,
  ).toString("base64");
}

describe("trusted workspace scope admission", () => {
  let root: string;
  let frontier: VerifiedScopeFrontier;
  let authority: VerifiedFirstEnrollmentAuthorityV1;
  let protectedStateAvailable: boolean;
  let guardHeld: boolean;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "justice-scope-admission-"));
    execFileSync("git", ["init", "-q", root]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "genesis",
    ]);
    const workspaceIdentity = await observeGitWorkspaceIdentity(root);
    const contents = {
      workspaceIdentity,
      workspaceEnrollmentId: "enrollment-1",
      scopes: [],
      writerHeads: [],
    };
    frontier = { ...contents, globalFrontierHash: computeCanonicalJsonFingerprint(contents) };
    authority = {
      installationId: "installation-1",
      workspaceIdentity,
      canonicalDesignPath: "docs/design.md",
      canonicalPlanPath: "docs/plan.md",
      authorizationOperationId: "operation-1",
      authenticatedProvisionerDigest: provisionerDigest,
      verifiedAbsentPriorEnrollmentFrontierHash: frontier.globalFrontierHash,
      authorizationEventId: "authorization-1",
    };
    protectedStateAvailable = true;
    guardHeld = false;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function admission() {
    return createReviewGateScopeAdmissionVerifier({
      workspaceRoot: root,
      installationId: "installation-1",
      provisionerPublicKey: keys.publicKey,
      host: {
        async withWorkspaceAdmissionGuard<T>(run: () => Promise<T>): Promise<T> {
          guardHeld = true;
          try {
            return await run();
          } finally {
            guardHeld = false;
          }
        },
        async readCurrentProtectedFrontier() {
          if (!guardHeld || !protectedStateAvailable)
            throw new Error("protected frontier unavailable");
          const payload = { installationId: "installation-1", frontier };
          return { ...payload, signature: signature("justice-scope-frontier-v1", payload) };
        },
      },
    });
  }
  function request(proofAuthority = authority) {
    return {
      workspaceIdentity: frontier.workspaceIdentity,
      canonicalDesignPath: "docs/design.md",
      canonicalPlanPath: "docs/plan.md",
      authorizationOperationId: "operation-1",
      proof: {
        authority: proofAuthority,
        signature: signature("justice-first-enrollment-v1", proofAuthority),
      },
    };
  }

  it("produces a verified frontier and bound first enrollment authority for a clean Git workspace", async () => {
    expect(await admission().readWorkspaceScopeFrontier()).toEqual(frontier);
    expect(await admission().verifyFirstWorkspaceEnrollment(request())).toEqual(authority);
    expect(JSON.stringify(authority)).not.toContain(root);
  });
  it("rejects prior scope enrollment even with a signed absence assertion", async () => {
    const scope = {
      scopeId: "scope-1",
      workflowContinuityId: "workflow-1",
      canonicalDesignPath: "docs/design.md",
      canonicalPlanPath: "docs/plan.md",
      pathPairDigest: computeCanonicalJsonFingerprint(["docs/design.md", "docs/plan.md"]),
      provenance: {
        kind: "verified_genesis" as const,
        evidenceDigest: digest,
        priorScopeId: null,
        priorGateId: null,
      },
      gateMembership: [],
    };
    const contents = {
      workspaceIdentity: frontier.workspaceIdentity,
      workspaceEnrollmentId: frontier.workspaceEnrollmentId,
      scopes: [scope],
      writerHeads: [],
    };
    frontier = { ...contents, globalFrontierHash: computeCanonicalJsonFingerprint(contents) };
    authority = {
      ...authority,
      verifiedAbsentPriorEnrollmentFrontierHash: frontier.globalFrontierHash,
    };
    await expect(admission().verifyFirstWorkspaceEnrollment(request())).rejects.toThrow(
      "prior_enrollment",
    );
  });
  it("rejects a raw absolute path presented as workspace identity", async () => {
    await expect(
      admission().verifyFirstWorkspaceEnrollment({ ...request(), workspaceIdentity: root }),
    ).rejects.toThrow("workspace_identity");
  });
  it("rejects the path-only identity hash rather than verified Git root/common identity", async () => {
    await expect(
      admission().verifyFirstWorkspaceEnrollment({
        ...request(),
        workspaceIdentity: createHash("sha256").update(root).digest("hex"),
      }),
    ).rejects.toThrow("workspace_identity");
  });
  it("rejects absence without an independently authenticated proof", async () => {
    const input = {
      workspaceIdentity: frontier.workspaceIdentity,
      canonicalDesignPath: "docs/design.md",
      canonicalPlanPath: "docs/plan.md",
      authorizationOperationId: "operation-1",
    };
    await expect(admission().verifyFirstWorkspaceEnrollment(input)).rejects.toThrow("proof");
  });
  it("rejects tampered absence frontier", async () => {
    const input = request();
    await expect(
      admission().verifyFirstWorkspaceEnrollment({
        ...input,
        proof: {
          ...input.proof,
          authority: { ...authority, verifiedAbsentPriorEnrollmentFrontierHash: digest },
        },
      }),
    ).rejects.toThrow("proof");
  });
  it("rejects a valid signature for a stale frontier", async () => {
    await expect(
      admission().verifyFirstWorkspaceEnrollment(
        request({ ...authority, verifiedAbsentPriorEnrollmentFrontierHash: digest }),
      ),
    ).rejects.toThrow("proof");
  });
  it.each([
    "authorizationOperationId",
    "authenticatedProvisionerDigest",
    "installationId",
    "canonicalDesignPath",
    "workspaceIdentity",
  ] as const)("rejects signed proof with mismatched %s", async (field) => {
    const changed = {
      ...authority,
      [field]: field.endsWith("Digest") || field === "workspaceIdentity" ? digest : "other-value",
    };
    await expect(admission().verifyFirstWorkspaceEnrollment(request(changed))).rejects.toThrow(
      "proof",
    );
  });
  it("rejects a forged signer", async () => {
    const forged = generateKeyPairSync("ed25519");
    const input = request();
    const forgedSignature = sign(
      null,
      Buffer.from(`justice-first-enrollment-v1\0${computeCanonicalJsonFingerprint(authority)}`),
      forged.privateKey,
    ).toString("base64");
    await expect(
      admission().verifyFirstWorkspaceEnrollment({
        ...input,
        proof: { authority, signature: forgedSignature },
      }),
    ).rejects.toThrow("proof");
  });
  it("does not recreate missing protected history", async () => {
    protectedStateAvailable = false;
    await expect(admission().verifyFirstWorkspaceEnrollment(request())).rejects.toThrow(
      "protected_frontier",
    );
  });
  it("rejects a dirty workspace", async () => {
    await writeFile(join(root, "untracked.txt"), "dirty");
    await expect(admission().verifyFirstWorkspaceEnrollment(request())).rejects.toThrow(
      "workspace_dirty",
    );
  });
  it("keeps identity stable after a commit", async () => {
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-qm",
      "next",
    ]);
    expect(await observeGitWorkspaceIdentity(root)).toBe(frontier.workspaceIdentity);
  });
  it("uses the existing workspace identity convention", async () => {
    expect(await observeGitWorkspaceIdentity(root)).toBe(computeWorkspaceIdentity(root));
  });
  it("rejects a corrupt authenticated frontier hash", async () => {
    frontier = { ...frontier, globalFrontierHash: digest };
    await expect(admission().readWorkspaceScopeFrontier()).rejects.toThrow("protected_frontier");
  });
});
