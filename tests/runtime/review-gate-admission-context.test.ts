import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MAX_DESIGN_REMEDIATION_ROUNDS,
  MAX_PLAN_REMEDIATION_ROUNDS,
} from "../../src/core/review-gate-types";
import type { ReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import {
  computeCanonicalJsonFingerprint,
  computeWorkspaceIdentity,
} from "../../src/core/review-gate/identity";
import { createLinuxReviewGateProvider } from "../../src/runtime/linux-review-gate-provider";
import { createReviewGateEventStore } from "../../src/runtime/review-gate-event-store";
import {
  createReviewGateLockManager,
  type ReviewGateLockManager,
} from "../../src/runtime/review-gate-lock-manager";
import {
  authorizeFirstWorkspaceEnrollment,
  createReviewGateScopeWitness,
  provisionReviewGateWitnessInstallation,
  type ReviewGateScopeWitness,
  type TrustedFirstEnrollmentV1,
} from "../../src/runtime/review-gate-scope-witness";
import {
  markAdmissionOwnedWitnessLive,
  observeVerifiedAdmissionSnapshotOwned,
  type AdmissionOwnedWitness,
  type VerifiedAdmissionSnapshotOwnedOptions,
} from "../../src/runtime/review-gate-admission-context";
import type { VerifiedFirstEnrollment } from "../../src/runtime/review-gate-event-store";

const TEST_WRITER_ID = "writer-1";
const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const REQUIREMENTS_PATH = "docs/requirements.md";

const protocol: ReviewGateProtocolDescriptor = Object.freeze({
  descriptor: Object.freeze({
    descriptorVersion: 1,
    requirementsResolutionPolicyVersion: 1,
    authorityPolicy: Object.freeze({ historical: 1, current: 1 }),
    crossPhase: Object.freeze({
      controllerRelayContractVersion: 1,
      maxDesignRemediationRounds: MAX_DESIGN_REMEDIATION_ROUNDS,
      maxPlanRemediationRounds: MAX_PLAN_REMEDIATION_ROUNDS,
      sharedFindingValidatorContractVersion: 1,
      sharedSeverityPolicyVersion: 1,
      sharedResolutionPolicyVersion: 1,
      sharedLineagePolicyVersion: 1,
      sharedConvergencePolicyVersion: 1,
    }),
    designPhase: Object.freeze({
      phasePolicyVersion: 1,
      reviewerPromptContractDigest: "reviewer-design",
      validatorPromptContractDigest: "validator-design",
      remediatorPromptContractDigest: "remediator-design",
      selfReviewPromptContractDigest: "selfreview-design",
    }),
    planPhase: Object.freeze({
      phasePolicyVersion: 1,
      reviewerPromptContractDigest: "reviewer-plan",
      validatorPromptContractDigest: "validator-plan",
      remediatorPromptContractDigest: "remediator-plan",
      selfReviewPromptContractDigest: "selfreview-plan",
    }),
  }),
  reviewProtocolFingerprint: "protocol-global",
  designProtocolFingerprint: "protocol-design",
  planProtocolFingerprint: "protocol-plan",
  releaseDescriptorDigest: "release-digest",
  releaseAuthority: Object.freeze({
    schemaVersion: "justice-protocol-release-v1",
    trustedPublisherPolicyVersion: "1",
  }),
});

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
    await rm(`${root}.witness`, { recursive: true, force: true });
  }
});

async function freshRoot(prefix: string): Promise<string> {
  const root = `${tmpdir()}/justice-admission-context-${prefix}-${Math.random().toString(36).slice(2)}`;
  await mkdir(root, { recursive: true });
  tempRoots.push(root);
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
  return root;
}

async function writeCommittedFile(root: string, filePath: string, content: string): Promise<void> {
  const fullPath = path.join(root, filePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
  execFileSync("git", ["-C", root, "add", filePath]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    `add ${filePath}`,
  ]);
}

type Fixture = Readonly<{
  root: string;
  witness: ReviewGateScopeWitness;
  lockManager: ReviewGateLockManager;
  firstEnrollment: TrustedFirstEnrollmentV1;
}>;

async function createFixture(prefix: string): Promise<Fixture> {
  const root = await freshRoot(prefix);
  const admin = generateKeyPairSync("ed25519");
  const approve = async (payload: unknown): Promise<string> =>
    sign(null, Buffer.from(computeCanonicalJsonFingerprint(payload)), admin.privateKey).toString(
      "base64",
    );
  const lockManager = createReviewGateLockManager(root, {
    provider: createLinuxReviewGateProvider(root) ?? null,
  });
  const witnessDirectory = `${root}.witness`;
  await provisionReviewGateWitnessInstallation({
    witnessDirectory,
    hostTrustRoot: admin.publicKey,
    authorize: approve,
  });
  const witness = createReviewGateScopeWitness({
    workspaceRoot: root,
    workspaceIdentity: computeWorkspaceIdentity(root),
    witnessDirectory,
    hostTrustRoot: admin.publicKey,
    lockManager,
  });
  const firstEnrollment = await authorizeFirstWorkspaceEnrollment({
    witness,
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
    workflowNonce: `nonce-${prefix}`,
    operationId: `op-${prefix}`,
    authorize: approve,
  });
  await witness.verifyFirstWorkspaceEnrollment(firstEnrollment);
  return { root, witness, lockManager, firstEnrollment };
}

function createWorkspaceReader(root: string): NonNullable<VerifiedAdmissionSnapshotOwnedOptions["workspaceReader"]> {
  return {
    readWorkspaceFile: async (filePath: string): Promise<Buffer | null> => {
      try {
        return await readFile(path.join(root, filePath));
      } catch {
        return null;
      }
    },
  };
}

function verifiedFirstEnrollmentFromTrusted(
  trusted: TrustedFirstEnrollmentV1,
): VerifiedFirstEnrollment {
  return {
    authorization: trusted,
    generationId: "genesis-generation",
    workflowContinuityId: "genesis-continuity",
  };
}

function closeFixture(fixture: Fixture): void {
  fixture.witness.close();
  fixture.lockManager.close();
}

/**
 * Task 3 owned capability DTO for observer tests. The live registry mark
 * makes the store accept it; production witnesses come only from
 * `withAdmissionWitnessTransaction`.
 */
function testOwnedWitness(frontier: VerifiedScopeFrontier): AdmissionOwnedWitness {
  const owned: AdmissionOwnedWitness = {
    readVerifiedFrontier: async () => frontier,
    readFirstEnrollmentAuthority: async () => null,
    readInstallation: async () => {
      throw new Error("test_owned_installation_unused");
    },
    assertOwnedScope: () => undefined,
    assertOwnedGate: () => undefined,
  };
  markAdmissionOwnedWitnessLive(owned);
  return owned;
}

describe("observeVerifiedAdmissionSnapshotOwned", () => {
  it("builds a first-use snapshot without a Gate event", async () => {
    const fixture = await createFixture("firstuse");
    await writeCommittedFile(fixture.root, DESIGN_PATH, "# Design");
    await writeCommittedFile(fixture.root, PLAN_PATH, "# Plan");
    await writeCommittedFile(fixture.root, REQUIREMENTS_PATH, "# Requirements");

    const eventStore = createReviewGateEventStore(fixture.root, {
      workspaceIdentity: computeWorkspaceIdentity(fixture.root),
      writerId: TEST_WRITER_ID,
      witness: fixture.witness,
    });

    const frontier = await fixture.witness.readWorkspaceScopeFrontier();
    const options: VerifiedAdmissionSnapshotOwnedOptions = {
      workspaceRoot: fixture.root,
      scopeId: "scope-first-use" as ReviewScopeId,
      protocol,
      eventStore,
workspaceReader: createWorkspaceReader(fixture.root),
owned: testOwnedWitness(frontier),
      authority: {
        installation: await fixture.witness.readInstallation(),
        frontier,
        firstEnrollment: verifiedFirstEnrollmentFromTrusted(fixture.firstEnrollment),
      },
      request: {
        designPath: DESIGN_PATH,
        planPath: PLAN_PATH,
        explicitRequirementsPath: REQUIREMENTS_PATH,
      },
    };

    const observation = await observeVerifiedAdmissionSnapshotOwned(options);

    expect(observation).not.toBeNull();
    const snapshot = observation!.snapshot;
    expect(snapshot.currentTips).toEqual([]);
    expect(snapshot.workspaceContinuity.authorizedFirstEnrollment).not.toBeNull();
    expect(snapshot.workspaceContinuity.authorizedFirstEnrollment?.canonicalDesignPath).toBe(
      DESIGN_PATH,
    );
    expect(snapshot.current.design.canonicalPath).toBe(DESIGN_PATH);
    expect(snapshot.current.plan.canonicalPath).toBe(PLAN_PATH);
    expect(snapshot.nc1Evidence).toBeNull();
    expect(observation?.lastVerifiedBinding).toBeNull();
    expect(observation?.nc1Evidence).toBeNull();

    eventStore.close();
    closeFixture(fixture);
  });

  it("returns null when a requested artifact is missing", async () => {
    const fixture = await createFixture("missing");
    await writeCommittedFile(fixture.root, DESIGN_PATH, "# Design");

    const eventStore = createReviewGateEventStore(fixture.root, {
      workspaceIdentity: computeWorkspaceIdentity(fixture.root),
      writerId: TEST_WRITER_ID,
      witness: fixture.witness,
    });

    const frontier = await fixture.witness.readWorkspaceScopeFrontier();
    const options: VerifiedAdmissionSnapshotOwnedOptions = {
      workspaceRoot: fixture.root,
      scopeId: "scope-missing" as ReviewScopeId,
      protocol,
      eventStore,
      workspaceReader: createWorkspaceReader(fixture.root),
owned: testOwnedWitness(frontier),
      authority: {
        installation: await fixture.witness.readInstallation(),
        frontier,
        firstEnrollment: verifiedFirstEnrollmentFromTrusted(fixture.firstEnrollment),
      },
      request: { designPath: DESIGN_PATH, planPath: PLAN_PATH },
    };

    const observation = await observeVerifiedAdmissionSnapshotOwned(options);

    expect(observation).toBeNull();

    expect(observation).toBeNull();

    eventStore.close();
    closeFixture(fixture);
  });

  it("delegates to the public observer when no first enrollment is supplied", async () => {
    const fixture = await createFixture("delegate");
    await writeCommittedFile(fixture.root, DESIGN_PATH, "# Design");
    await writeCommittedFile(fixture.root, PLAN_PATH, "# Plan");

    const eventStore = createReviewGateEventStore(fixture.root, {
      workspaceIdentity: computeWorkspaceIdentity(fixture.root),
      writerId: TEST_WRITER_ID,
      witness: fixture.witness,
    });

    const frontier = await fixture.witness.readWorkspaceScopeFrontier();
    const options: VerifiedAdmissionSnapshotOwnedOptions = {
      workspaceRoot: fixture.root,
      scopeId: "scope-delegate" as ReviewScopeId,
      protocol,
      eventStore,
      workspaceReader: createWorkspaceReader(fixture.root),
owned: testOwnedWitness(frontier),
      authority: {
        installation: await fixture.witness.readInstallation(),
        frontier,
        firstEnrollment: null,
      },
      request: { designPath: DESIGN_PATH, planPath: PLAN_PATH },
    };

    const observation = await observeVerifiedAdmissionSnapshotOwned(options);

    // The scope is not enrolled and no Gate exists, so the public observer
    // correctly fails closed.
    expect(observation).toBeNull();

    // The scope is not enrolled and no Gate exists, so the public observer
    // correctly fails closed.
    expect(observation).toBeNull();

    eventStore.close();
    closeFixture(fixture);
  });
});
