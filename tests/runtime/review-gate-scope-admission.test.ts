import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeCanonicalJsonFingerprint,
  computeReviewScopeId,
  computeWorkspaceIdentity,
} from "../../src/core/review-gate/identity.js";
import { validateReviewGateEventRecord } from "../../src/core/review-gate/event-schema.js";
import type {
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedScopeFrontier,
} from "../../src/core/review-gate/types.js";
import {
  createReviewGateScopeAdmission,
  createReviewGateScopeAdmissionVerifier,
  observeGitWorkspaceIdentity,
} from "../../src/runtime/review-gate-scope-admission.js";
import { createReviewGateEventStore } from "../../src/runtime/review-gate-event-store.js";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager.js";
import { createLinuxReviewGateProvider } from "../../src/runtime/linux-review-gate-provider.js";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol.js";
import { resolveRequirementsForAdmission } from "../../src/runtime/review-gate-requirements.js";
import {
  authorizeFirstWorkspaceEnrollment,
  createReviewGateScopeWitness,
  provisionReviewGateWitnessInstallation,
} from "../../src/runtime/review-gate-scope-witness.js";
import type { ReviewGateEvent as ReviewGateEventV1 } from "../../src/core/review-gate-types.js";

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
  it("rejects a dirty enrolled artifact", async () => {
    const designDir = join(root, "docs");
    await mkdir(designDir, { recursive: true });
    const designPath = join(designDir, "design.md");
    await writeFile(designPath, "# Design");
    execFileSync("git", ["-C", root, "add", "docs/design.md"]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-qm",
      "add design",
    ]);
    await writeFile(designPath, "# Dirty Design");
    await expect(admission().verifyFirstWorkspaceEnrollment(request())).rejects.toThrow(
      "target_dirty",
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

describe("createReviewGateScopeAdmission withAdmissionLease", () => {
  const DESIGN_PATH = "docs/design.md";
  const PLAN_PATH = "docs/plan.md";
  const protocol = createReviewGateProtocolDescriptor();
  const roots: string[] = [];
  let workspaceIdentitySeed = "";
  afterAll(async () => {
    for (const candidate of roots) {
      await rm(candidate, { recursive: true, force: true });
      await rm(`${candidate}.witness`, { recursive: true, force: true });
    }
  });

  function gateCreatedEvent(gateId: string): ReviewGateEventV1 {
    const scopeId = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
    return validateReviewGateEventRecord({
      schemaVersion: 2,
      eventId: `event-${gateId}`,
      parentEventId: `parent-${gateId}`,
      emittedAt: "2026-10-16T00:00:00.000Z",
      gateId,
      epochId: "epoch-1",
      generationId: "generation-1",
      writerId: "writer-1",
      eventType: "GATE_CREATED",
      payload: {
        reviewScopeId: scopeId,
        supersedesGateId: null,
        requirementsResolution: {
          schemaVersion: 2,
          source: "explicit",
          canonicalPath: "docs/requirements.md",
          digest: "2".repeat(64),
          gitMode: "100644",
          requirementsGitBlobOid: "r".repeat(40),
          committedBaselineOid: "c".repeat(40),
          workspaceIdentity: workspaceIdentitySeed,
          selectionEvidence: {},
        },
        designArtifact: { canonicalPath: DESIGN_PATH, digest: "0".repeat(64), gitMode: "100644" },
        planArtifact: { canonicalPath: PLAN_PATH, digest: "1".repeat(64), gitMode: "100644" },
        reviewProtocolFingerprint: protocol.reviewProtocolFingerprint,
        designProtocolFingerprint: protocol.designProtocolFingerprint,
        planProtocolFingerprint: protocol.planProtocolFingerprint,
      },
    });
  }

  /** Real protected witness, store and admission factory over one seeded scope. */
  async function leasedAdmission() {
    const workspace = await mkdtemp(join(tmpdir(), "justice-admission-lease-"));
    roots.push(workspace);
    workspaceIdentitySeed = computeWorkspaceIdentity(workspace);
    execFileSync("git", ["init", "-q", workspace]);
    const docs = join(workspace, "docs");
    await mkdir(docs, { recursive: true });
    await writeFile(join(docs, "design.md"), "# Design");
    await writeFile(join(docs, "plan.md"), "# Plan");
    await writeFile(join(docs, "requirements.md"), "# Requirements");
    execFileSync("git", ["-C", workspace, "add", "docs/design.md", "docs/plan.md", "docs/requirements.md"]);
    execFileSync("git", [
      "-C", workspace,
      "-c", "user.name=Fixture",
      "-c", "user.email=fixture@example.invalid",
      "commit", "-qm", "artifacts",
    ]);
    const admin = generateKeyPairSync("ed25519");
    const approve = async (payload: unknown): Promise<string> =>
      sign(null, Buffer.from(computeCanonicalJsonFingerprint(payload)), admin.privateKey).toString(
        "base64",
      );
    const witnessDirectory = `${workspace}.witness`;
    await provisionReviewGateWitnessInstallation({
      witnessDirectory,
      hostTrustRoot: admin.publicKey,
      authorize: approve,
    });
    const lockManager = createReviewGateLockManager(workspace, {
      provider: createLinuxReviewGateProvider(workspace) ?? null,
    });
    const witness = createReviewGateScopeWitness({
      workspaceRoot: workspace,
      workspaceIdentity: computeWorkspaceIdentity(workspace),
      witnessDirectory,
      hostTrustRoot: admin.publicKey,
      lockManager,
    });
    const trusted = await authorizeFirstWorkspaceEnrollment({
      witness,
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      workflowNonce: "lease-nonce",
      operationId: "lease-operation",
      authorize: approve,
    });
    await witness.verifyFirstWorkspaceEnrollment(trusted);
    const store = createReviewGateEventStore(workspace, {
      workspaceIdentity: computeWorkspaceIdentity(workspace),
      writerId: "writer-1",
      witness,
    });
    const prepared = await store.prepareVerifiedEventPublication({
      scopeId: computeReviewScopeId(DESIGN_PATH, PLAN_PATH),
      gateId: "gate-a",
      writerId: "writer-1",
      operationId: "lease-seed",
      canonicalEvents: [gateCreatedEvent("gate-a")],
      firstEnrollment: {
        authorization: trusted,
        generationId: "generation-1",
        workflowContinuityId: "continuity-1",
      },
    });
    const outcome = await store.publishPreparedEvent(prepared);
    if (outcome !== "committed") throw new Error(`test_seed_failed:${outcome}`);
    const admission = createReviewGateScopeAdmission({
      witness,
      eventStore: store,
      lockManager,
      workspaceReader: {
        readWorkspaceFile: async (filePath) => {
          try {
            const { readFile } = await import("node:fs/promises");
            return await readFile(join(workspace, filePath));
          } catch {
            return null;
          }
        },
      },
      requirementsResolver: resolveRequirementsForAdmission,
      protocol,
    });
    const request = {
      workspaceRoot: workspace,
      workspaceIdentity: computeWorkspaceIdentity(workspace),
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      explicitRequirementsPath: "docs/requirements.md",
      protocol,
    };
    return { admission, store, witness, request };
  }

  it("passes the decision observation and owned witness to the callback", async () => {
    const { admission, store, witness, request } = await leasedAdmission();

    const observed = await admission.withAdmissionLease(
      request,
      async (decision, observation, owned) => {
        expect(typeof decision.kind).toBe("string");
        expect(owned).not.toBeNull();
        const frontier = await owned.readVerifiedFrontier();
        expect(frontier.scopes.length).toBeGreaterThan(0);
        return { decision, observation };
      },
    );

    expect(typeof observed.decision.kind).toBe("string");
    // The seeded scope matches the computed scope id, so the full owned
    // observation succeeds instead of an early membership block.
    expect(observed.observation).not.toBeNull();
    store.close();
    witness.close();
  });

  it("releases every guard on callback failure", async () => {
    const { admission, store, witness, request } = await leasedAdmission();

    await expect(
      admission.withAdmissionLease(request, async () => {
        throw new Error("lease_callback_failure");
      }),
    ).rejects.toThrow("lease_callback_failure");

    // The lease is free again: the next admission completes end to end.
    await expect(
      admission.withAdmissionLease(request, async () => "retried" as const),
    ).resolves.toBe("retried");
    store.close();
    witness.close();
  });
});
