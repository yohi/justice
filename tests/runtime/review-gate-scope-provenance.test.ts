import { rm } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../../src/core/review-gate/identity.js";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../../src/core/review-gate/event-schema.js";
import { authorizeScopeEnrollment } from "../../src/runtime/review-gate-scope-witness.js";
import {
  createWitnessFixture,
  preparePublicationFixture,
  type WitnessFixture,
} from "./review-gate-witness-fixtures.js";
let f: WitnessFixture;
beforeEach(async () => {
  f = await createWitnessFixture();
});
afterEach(async () => {
  f.witness.close();
  await rm(f.sandbox, { recursive: true, force: true });
});
it("admits a distinct workflow only with independently authenticated scope provenance", async () => {
  const first = await preparePublicationFixture(f);
  await f.witness.preparePublication(first.input, first.bytes);
  await f.witness.publishPreparedJournal(first.input.publicationId);
  expect(await f.witness.recoverPreparedPublication(first.input.publicationId)).toBe("advanced");
  const old = first.input.nextFrontier.scopes[0];
  if (old === undefined) throw new Error("fixture scope absent");
  const proposal = {
    ...old,
    scopeId: "scope-2",
    workflowContinuityId: "workflow-2",
    canonicalDesignPath: "docs/other-design.md",
    canonicalPlanPath: "docs/other-plan.md",
    pathPairDigest: computeCanonicalJsonFingerprint(["docs/other-design.md", "docs/other-plan.md"]),
    provenance: { ...old.provenance, kind: "verified_independent_workflow" as const },
    gateMembership: [
      {
        gateId: "gate-2",
        generationId: "generation-2",
        supersedesGateId: null,
        admissionEventId: "admission-2",
        writerIds: ["writer-2"],
      },
    ],
  };
  await expect(
    authorizeScopeEnrollment({
      witness: f.witness,
      scope: proposal,
      operationId: "enroll-scope-2",
      authorize: async () => "invalid",
    }),
  ).rejects.toThrow("authentication");
  const scope = await authorizeScopeEnrollment({
    witness: f.witness,
    scope: proposal,
    operationId: "enroll-scope-2",
    authorize: f.approve,
  });
  const original = validateReviewGateEventRecord(JSON.parse(first.bytes.toString("utf8")));
  if (original.eventType !== "GATE_CREATED") throw new Error("fixture genesis absent");
  const event = {
    ...original,
    gateId: "gate-2",
    writerId: "writer-2",
    payload: {
      ...original.payload,
      reviewScopeId: "scope-2",
      designArtifact: {
        ...original.payload.designArtifact,
        canonicalPath: scope.canonicalDesignPath,
      },
      planArtifact: { ...original.payload.planArtifact, canonicalPath: scope.canonicalPlanPath },
    },
  };
  const bytes = Buffer.from(
    encodeReviewGateEventRecord(validateReviewGateEventRecord(event)) + "\n",
  );
  const { globalFrontierHash: oldHash, ...base } = first.input.nextFrontier;
  const body = {
    ...base,
    scopes: [...base.scopes, scope],
    writerHeads: [
      ...base.writerHeads,
      {
        scopeId: "scope-2",
        gateId: "gate-2",
        writerId: "writer-2",
        sequence: 1,
        hash: computeArtifactDigest(bytes),
      },
    ],
  };
  const next = { ...body, globalFrontierHash: computeCanonicalJsonFingerprint(body) };
  const input = {
    ...first.input,
    scopeId: "scope-2",
    gateId: "gate-2",
    writerId: "writer-2",
    operationId: "publish-operation-2",
    publicationId: "publication-2",
    expectedInstallationFrontier: await f.witness.readInstallationFrontierHash(),
    expectedGlobalFrontier: oldHash,
    canonicalShardPath: "scope-2/gate-2/writer-2.jsonl",
    newWriterHash: computeArtifactDigest(bytes),
    newTailDigest: computeArtifactDigest(bytes),
    newTailLength: bytes.length,
    newGlobalFrontier: next.globalFrontierHash,
    firstEnrollmentAuthorizationId: null,
    nextFrontier: next,
  };
  expect(await f.witness.preparePublication(input, bytes)).toBe("prepared");
  await f.witness.publishPreparedJournal(input.publicationId);
  expect(await f.witness.recoverPreparedPublication(input.publicationId)).toBe("advanced");
  expect((await f.witness.readWorkspaceScopeFrontier()).scopes).toHaveLength(2);
});
