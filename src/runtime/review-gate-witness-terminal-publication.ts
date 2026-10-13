import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import type { VerifiedReviewGateEvent } from "../core/review-gate/event-schema.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { targetRegistrySchema } from "./review-gate-target-writer-schema.js";
import { verifyNativeFenceReceipt } from "./review-gate-target-writer-handoff.js";
import type { WitnessContext, WitnessTransaction } from "./review-gate-witness-context.js";

export async function verifyTerminalPublication(
  context: WitnessContext,
  current: WitnessTransaction,
  events: readonly VerifiedReviewGateEvent[],
): Promise<void> {
  for (const event of events) {
    if (
      event.eventType !== "COMPLETED_APPROVAL_BINDING" &&
      event.eventType !== "PLAN_CLEAR" &&
      event.eventType !== "TARGET_WRITER_TERMINAL_REVOKED"
    )
      continue;
    const state = await context.store.read("target", targetRegistrySchema);
    if (
      Object.values(state.data.targets).some(
        (entry) => entry.authority.activeOwner?.gateId === event.gateId,
      )
    )
      throw new WitnessBlocked("terminal_writer_active");
    for (const handoff of Object.values(state.data.handoffs)) {
      if (handoff.intent.newOwner?.gateId !== event.gateId) continue;
      const close = Object.values(state.data.terminals).find(
        (record) =>
          record.proof?.gateId === event.gateId &&
          record.intents.some(
            (intent) =>
              intent.target.targetIdentityDigest === handoff.intent.target.targetIdentityDigest,
          ),
      );
      if (
        close?.proof === null ||
        close?.proof === undefined ||
        close.nativeProofDigests.length !== close.intents.length
      )
        throw new WitnessBlocked("terminal_revoke_unproven");
      for (const digest of close.nativeProofDigests)
        await verifyNativeFenceReceipt(context, current, digest);
    }
    if (event.eventType === "TARGET_WRITER_TERMINAL_REVOKED") {
      const close = state.data.terminals[event.payload.handoffOperationId];
      if (
        close?.proof === null ||
        close?.proof === undefined ||
        computeCanonicalJsonFingerprint(close.proof) !==
          computeCanonicalJsonFingerprint(event.payload)
      )
        throw new WitnessBlocked("terminal_revoke_unproven");
      for (const digest of close.nativeProofDigests)
        await verifyNativeFenceReceipt(context, current, digest);
    }
  }
}
