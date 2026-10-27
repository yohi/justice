import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../../src/core/review-gate/identity.js";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../../src/core/review-gate/event-schema.js";
import type { VerifiedTargetWriterHandoffIntentV1 } from "../../src/core/review-gate/types.js";
import {
  createReviewGateScopeWitness,
  provisionReviewGateWitnessInstallation,
  authorizeFirstWorkspaceEnrollment,
} from "../../src/runtime/review-gate-scope-witness.js";
import { observeGitWorkspace } from "../../src/runtime/review-gate-scope-admission.js";
import type { ReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager.js";

export async function createWitnessFixture(lockManager?: ReviewGateLockManager) {
  const sandbox = await mkdtemp(join(tmpdir(), "justice-witness-"));
  const root = join(sandbox, "workspace");
  const directory = join(sandbox, "witness");
  const admin = generateKeyPairSync("ed25519");
  const approve = async (payload: unknown): Promise<string> =>
    sign(null, Buffer.from(computeCanonicalJsonFingerprint(payload)), admin.privateKey).toString(
      "base64",
    );
  execFileSync("git", ["init", "-q", root]);
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs/design.md"), "# Design\n");
  await writeFile(join(root, "docs/plan.md"), "# Plan\n");
  await writeFile(join(root, "artifact.md"), "original");
  execFileSync("git", ["-C", root, "add", "artifact.md", "docs/design.md", "docs/plan.md"]);
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
  await provisionReviewGateWitnessInstallation({
    witnessDirectory: directory,
    hostTrustRoot: admin.publicKey,
    authorize: approve,
  });
  const witness = createReviewGateScopeWitness({
    workspaceRoot: root,
    ...(await observeGitWorkspace(root)),
    witnessDirectory: directory,
    hostTrustRoot: admin.publicKey,
    lockManager,
  });
  const enroll = () =>
    authorizeFirstWorkspaceEnrollment({
      witness,
      designPath: "docs/design.md",
      planPath: "docs/plan.md",
      workflowNonce: "nonce-1",
      operationId: "operation-1",
      authorize: approve,
    });
  return { sandbox, root, directory, admin, approve, witness, enroll };
}
export type WitnessFixture = Awaited<ReturnType<typeof createWitnessFixture>>;
const genesisPublicationEvent = () => ({
  eventType: "GATE_CREATED" as const,
  gateId: "gate-1",
  writerId: "writer-1",
  epochId: "epoch-1",
  emittedAt: "2026-10-11T00:00:00.000Z",
  payload: {
    reviewScopeId: "scope-1",
    designArtifact: {
      canonicalPath: "docs/design.md",
      digest: "a".repeat(64),
      gitMode: "100644",
    },
    planArtifact: { canonicalPath: "docs/plan.md", digest: "b".repeat(64), gitMode: "100644" },
    requirementsResolution: {
      source: "explicit",
      canonicalPath: "docs/requirements.md",
      digest: "c".repeat(64),
    },
    reviewProtocolFingerprint: "d".repeat(64),
  },
});
export async function preparePublicationFixture(f: WitnessFixture) {
  const auth = await f.enroll();
  await f.witness.verifyFirstWorkspaceEnrollment(auth);
  const prior = await f.witness.readWorkspaceScopeFrontier();
  const installation = await f.witness.readInstallation();
  const event = genesisPublicationEvent();
  const bytes = Buffer.from(
    encodeReviewGateEventRecord(validateReviewGateEventRecord(event)) + "\n",
  );
  const head = {
    scopeId: "scope-1",
    gateId: "gate-1",
    writerId: "writer-1",
    sequence: 1,
    hash: computeArtifactDigest(bytes),
  };
  const scopes = [
    {
      scopeId: "scope-1",
      workflowContinuityId: "operation-1",
      canonicalDesignPath: "docs/design.md",
      canonicalPlanPath: "docs/plan.md",
      pathPairDigest: computeCanonicalJsonFingerprint(["docs/design.md", "docs/plan.md"]),
      provenance: {
        kind: "verified_genesis" as const,
        evidenceDigest: computeCanonicalJsonFingerprint(auth.authority),
        priorScopeId: null,
        priorGateId: null,
      },
      gateMembership: [
        {
          gateId: "gate-1",
          generationId: "generation-1",
          supersedesGateId: null,
          admissionEventId: auth.authority.authorizationEventId,
          writerIds: ["writer-1"],
        },
      ],
    },
  ];
  const contents = {
    workspaceIdentity: prior.workspaceIdentity,
    workspaceEnrollmentId: prior.workspaceEnrollmentId,
    scopes,
    writerHeads: [head],
  };
  const nextFrontier = {
    ...contents,
    globalFrontierHash: computeCanonicalJsonFingerprint(contents),
  };
  const input = {
    installationId: installation.installationId,
    workspaceIdentity: prior.workspaceIdentity,
    scopeId: "scope-1",
    gateId: "gate-1",
    writerId: "writer-1",
    operationId: "publication-operation-1",
    publicationId: "publication-1",
    expectedInstallationFrontier: await f.witness.readInstallationFrontierHash(),
    expectedGlobalFrontier: prior.globalFrontierHash,
    expectedWriterSequence: 0,
    expectedWriterHash: "0".repeat(64),
    newWriterSequence: 1,
    newWriterHash: head.hash,
    canonicalShardPath: "scope-1/gate-1/writer-1.jsonl",
    newTailLength: bytes.length,
    newTailDigest: head.hash,
    newGlobalFrontier: nextFrontier.globalFrontierHash,
    firstEnrollmentAuthorizationId: auth.authority.authorizationEventId,
    payloadSchemaVersion: 1 as const,
    nextFrontier,
  };
  return { input, bytes };
}
export async function prepareHandoffFixture(
  f: WitnessFixture,
): Promise<VerifiedTargetWriterHandoffIntentV1> {
  const { input, bytes } = await preparePublicationFixture(f);
  await f.witness.preparePublication(input, bytes);
  await f.witness.publishPreparedJournal(input.publicationId);
  if ((await f.witness.recoverPreparedPublication(input.publicationId)) !== "advanced")
    throw new Error("fixture publication failed");
  const target = await f.witness.verifyCanonicalMutationTarget("artifact.md");
  const prior = await f.witness.readVerifiedTargetWriterAuthority(target);
  return {
    purpose: "HANDOFF",
    status: "REQUESTED",
    handoffOperationId: "handoff-1",
    originalOperationId: "mutation-1",
    scopeId: "scope-1",
    gateId: "gate-1",
    generationId: "generation-1",
    phase: "design",
    roundOrdinal: 1,
    protocolFingerprint: "d".repeat(64),
    target,
    targets: [],
    closingSealOperationId: null,
    oldOwner: prior.activeOwner,
    newOwner: {
      scopeId: "scope-1",
      gateId: "gate-1",
      generationId: "generation-1",
      operationId: "mutation-1",
      attemptId: "attempt-1",
    },
    expectedTargetWriterFrontier: prior.protectedTargetFrontier,
    expectedGlobalTargetWriterGeneration: prior.globalTargetWriterGeneration,
    expectedGateEventFrontier: computeCanonicalJsonFingerprint(input.nextFrontier.writerHeads),
    expectedPreImageDigest: prior.expectedImage.digest,
    expectedGitMode: "100644",
    pendingNativeEffectReference: null,
  };
}
export async function buildSubsequentPublicationFixture(
  f: WitnessFixture,
  options: Readonly<{
    publicationId: string;
    operationId: string;
    event: unknown;
  }>,
) {
  const prior = await f.witness.readWorkspaceScopeFrontier();
  const installation = await f.witness.readInstallation();
  const priorJournalBytes = Buffer.from(
    encodeReviewGateEventRecord(validateReviewGateEventRecord(genesisPublicationEvent())) + "\n",
  );
  const tailBytes = Buffer.from(
    encodeReviewGateEventRecord(validateReviewGateEventRecord(options.event)) + "\n",
  );
  const bytes = Buffer.concat([
    priorJournalBytes,
    tailBytes,
  ]);
  const priorHead = prior.writerHeads.find(
    (head) =>
      head.scopeId === "scope-1" && head.gateId === "gate-1" && head.writerId === "writer-1",
  );
  if (priorHead === undefined) throw new Error("fixture writer head missing");
  const head = {
    ...priorHead,
    sequence: priorHead.sequence + 1,
    hash: computeArtifactDigest(bytes),
  };
  const contents = {
    workspaceIdentity: prior.workspaceIdentity,
    workspaceEnrollmentId: prior.workspaceEnrollmentId,
    scopes: prior.scopes,
    writerHeads: [...prior.writerHeads.filter((entry) => entry !== priorHead), head],
  };
  const nextFrontier = {
    ...contents,
    globalFrontierHash: computeCanonicalJsonFingerprint(contents),
  };
  const input = {
    installationId: installation.installationId,
    workspaceIdentity: prior.workspaceIdentity,
    scopeId: "scope-1",
    gateId: "gate-1",
    writerId: "writer-1",
    operationId: options.operationId,
    publicationId: options.publicationId,
    expectedInstallationFrontier: await f.witness.readInstallationFrontierHash(),
    expectedGlobalFrontier: prior.globalFrontierHash,
    expectedWriterSequence: priorHead.sequence,
    expectedWriterHash: priorHead.hash,
    newWriterSequence: head.sequence,
    newWriterHash: head.hash,
    canonicalShardPath: "scope-1/gate-1/writer-1.jsonl",
    newTailLength: tailBytes.length,
    newTailDigest: computeArtifactDigest(tailBytes),
    newGlobalFrontier: nextFrontier.globalFrontierHash,
    firstEnrollmentAuthorizationId: null,
    payloadSchemaVersion: 1 as const,
    nextFrontier,
  };
  return { input, bytes };
}
