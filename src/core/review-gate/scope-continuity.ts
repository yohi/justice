/**
 * Task 16 — Scope continuity over completed Gates.
 *
 * A completed predecessor Gate can be succeeded by a new Gate; the successor's
 * V2 `GATE_CREATED` event nominates its predecessor through
 * `payload.supersedesGateId`. This module verifies, purely and fail-closed,
 * that the predecessor's durable completed approval binding really belongs to
 * that admitted predecessor reference, and produces the relationship proof
 * digest that downstream workspace-continuity projections can carry.
 */

import { lookupCompletedApproval, type VerifiedGateTip } from "./admission.js";
import type { VerifiedReviewGateEvent } from "./event-schema.js";
import { computeCanonicalJsonFingerprint } from "./identity.js";
import type { GateCreatedV2, VerifiedCompletedSuccessorV1 } from "./types.js";

function isV2GateCreatedEvent(
  event: VerifiedReviewGateEvent,
): event is VerifiedReviewGateEvent &
  Readonly<{
    readonly schemaVersion: 2;
    readonly eventType: "GATE_CREATED";
    readonly gateId: string;
    readonly generationId: string;
    readonly payload: GateCreatedV2;
  }> {
  return (
    "schemaVersion" in event &&
    event.schemaVersion === 2 &&
    event.eventType === "GATE_CREATED"
  );
}

/**
 * Verify a successor V2 `GATE_CREATED` event against a completed predecessor
 * tip. Returns `null` (fail closed) unless every identity link holds: the
 * predecessor tip is completed with a lookup-verifiable durable approval
 * binding, the successor names exactly that gate as its `supersedesGateId`,
 * and the successor is a distinct gate.
 */
export function verifyCompletedSuccessor(
  predecessorTip: VerifiedGateTip,
  successorGateCreatedEvent: VerifiedReviewGateEvent,
): VerifiedCompletedSuccessorV1 | null {
  if (predecessorTip.status !== "completed") {
    return null;
  }
  if (!isV2GateCreatedEvent(successorGateCreatedEvent)) {
    return null;
  }
  const completedApproval = lookupCompletedApproval(predecessorTip);
  if (completedApproval === null) {
    return null;
  }
  const supersedesGateId = successorGateCreatedEvent.payload.supersedesGateId;
  if (
    supersedesGateId === null ||
    supersedesGateId !== predecessorTip.gateId ||
    supersedesGateId !== completedApproval.gateId
  ) {
    return null;
  }
  if (successorGateCreatedEvent.gateId === predecessorTip.gateId) {
    return null;
  }

  const relationshipProofDigest = computeCanonicalJsonFingerprint(
    Object.freeze({
      proofKind: "VERIFIED_COMPLETED_SUCCESSOR_V1",
      predecessor: Object.freeze({
        gateId: predecessorTip.gateId,
        generationId: predecessorTip.generationId,
        completedApprovalEventId:
          predecessorTip.completedApproval.approvalEventId,
        approvalGateId: completedApproval.gateId,
      }),
      successor: Object.freeze({
        gateId: successorGateCreatedEvent.gateId,
        generationId: successorGateCreatedEvent.generationId,
        supersedesGateId,
      }),
    }),
  );

  return Object.freeze({
    predecessorGateId: predecessorTip.gateId,
    predecessorGenerationId: predecessorTip.generationId,
    successorGateId: successorGateCreatedEvent.gateId,
    successorGenerationId: successorGateCreatedEvent.generationId,
    completedApprovalEventId: predecessorTip.completedApproval.approvalEventId,
    completedApprovalBinding: completedApproval,
    relationshipProofDigest,
  });
}