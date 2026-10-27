import { rm } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { validateReviewGateEventRecord } from "../../src/core/review-gate/event-schema.js";
import {
  buildSubsequentPublicationFixture,
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
  const { input, bytes } = await buildSubsequentPublicationFixture(f, {
    publicationId: "close-publication",
    operationId: "close-publication-operation",
    event: {
      gateId: genesis.gateId,
      writerId: genesis.writerId,
      epochId: genesis.epochId,
      emittedAt: genesis.emittedAt,
      eventType: "COMPLETED_APPROVAL_BINDING",
      payload: { approvalBinding: binding },
    },
  });
  await expect(f.witness.preparePublication(input, bytes)).rejects.toThrow("terminal");
});
