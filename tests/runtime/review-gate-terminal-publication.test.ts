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
import {
  createWitnessFixture,
  prepareHandoffFixture,
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
it("does not publish terminal completion while a canonical target still has an active writer", async () => {
  const intent = await prepareHandoffFixture(f);
  await f.witness.prepareTargetWriterHandoff(intent);
  await f.witness.recoverPreparedTargetWriterHandoff({
    intent,
    epochId: "epoch-1",
    authorizeNativeRevocation: f.approve,
  });
  const prior = await f.witness.readPreparedPublication("publication-1");
  const genesis = validateReviewGateEventRecord(JSON.parse(prior.bytes.toString("utf8")));
  if (genesis.eventType !== "GATE_CREATED") throw new Error("fixture genesis absent");
  const binding = {
    reviewScopeId: genesis.payload.reviewScopeId,
    gateId: genesis.gateId,
    designArtifact: genesis.payload.designArtifact,
    planArtifact: genesis.payload.planArtifact,
    requirementsResolution: genesis.payload.requirementsResolution,
    reviewProtocolFingerprint: genesis.payload.reviewProtocolFingerprint,
    designProtocolFingerprint: "d".repeat(64),
    planProtocolFingerprint: "e".repeat(64),
    approvedAt: "2026-10-11T00:00:00.000Z",
  };
  const envelope = {
    gateId: genesis.gateId,
    writerId: genesis.writerId,
    epochId: genesis.epochId,
    emittedAt: genesis.emittedAt,
  };
  const records = [
    genesis,
    validateReviewGateEventRecord({
      ...envelope,
      eventType: "DESIGN_CLEAR",
      payload: { designProtocolFingerprint: binding.designProtocolFingerprint },
    }),
    validateReviewGateEventRecord({
      ...envelope,
      eventType: "PLAN_CLEAR",
      payload: { completedApprovalBinding: binding },
    }),
    validateReviewGateEventRecord({
      ...envelope,
      eventType: "COMPLETED_APPROVAL_BINDING",
      payload: { approvalBinding: binding },
    }),
  ];
  const bytes = Buffer.from(records.map(encodeReviewGateEventRecord).join("\n") + "\n");
  const { globalFrontierHash: oldHash, ...base } = prior.input.nextFrontier;
  const body = {
    ...base,
    writerHeads: [
      {
        scopeId: "scope-1",
        gateId: "gate-1",
        writerId: "writer-1",
        sequence: 4,
        hash: computeArtifactDigest(bytes),
      },
    ],
  };
  const next = { ...body, globalFrontierHash: computeCanonicalJsonFingerprint(body) };
  const input = {
    ...prior.input,
    publicationId: "close-publication",
    operationId: "close-publication-operation",
    expectedInstallationFrontier: await f.witness.readInstallationFrontierHash(),
    expectedGlobalFrontier: oldHash,
    expectedWriterSequence: 1,
    expectedWriterHash: prior.input.newWriterHash,
    newWriterSequence: 4,
    newWriterHash: computeArtifactDigest(bytes),
    newTailDigest: computeArtifactDigest(bytes),
    newTailLength: bytes.length,
    newGlobalFrontier: next.globalFrontierHash,
    nextFrontier: next,
  };
  await expect(f.witness.preparePublication(input, bytes)).rejects.toThrow("terminal");
});
