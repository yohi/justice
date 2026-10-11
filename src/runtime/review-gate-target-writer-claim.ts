import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import type {
  VerifiedReviewWriterLeaseV1,
  VerifiedTargetWriterHandoffIntentV1,
} from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { targetRegistrySchema } from "./review-gate-target-writer-schema.js";
import {
  withTargetLocks,
  sameTargetValue,
  reconcileTargetEffect,
  advanceTargetAuthority,
} from "./review-gate-target-writer-state.js";
import { verifyNativeFenceReceipt } from "./review-gate-target-writer-fence.js";
import { withWitnessTransaction, type WitnessContext } from "./review-gate-witness-context.js";
import { scopeInstallationIdSchema } from "./review-gate-witness-verification.js";

export type TargetWriterClaimInput = Readonly<{
  intent: VerifiedTargetWriterHandoffIntentV1;
  epochId: string;
}>;
export async function claimTargetWriterForGate(
  context: WitnessContext,
  input: TargetWriterClaimInput,
): Promise<VerifiedReviewWriterLeaseV1> {
  if (!scopeInstallationIdSchema.safeParse(input.epochId).success)
    throw new WitnessBlocked("lease_epoch");
  return withWitnessTransaction(context, async (current) =>
    withTargetLocks(context, current, [input.intent], async () => {
      const state = await context.store.read("target", targetRegistrySchema);
      const prepared = state.data.handoffs[input.intent.handoffOperationId];
      const entry = state.data.targets[input.intent.target.targetIdentityDigest];
      if (
        prepared === undefined ||
        entry === undefined ||
        !sameTargetValue(prepared.intent, input.intent)
      )
        throw new WitnessBlocked("handoff_unprepared");
      if (prepared.nativeProofDigest !== null)
        await verifyNativeFenceReceipt(context, current, prepared.nativeProofDigest);
      if (
        Object.values(state.data.terminals).some((close) =>
          close.intents.some(
            (intent) =>
              intent.gateId === input.intent.newOwner?.gateId &&
              intent.generationId === input.intent.newOwner.generationId,
          ),
        )
      )
        throw new WitnessBlocked("lease_terminal_close");
      if (prepared.status === "CLAIMED" && entry.lease !== null) {
        if (entry.lease.epochId !== input.epochId) throw new WitnessBlocked("lease_retry_conflict");
        return entry.lease;
      }
      const owner = input.intent.newOwner;
      if (
        prepared.status !== "FENCED" ||
        prepared.nativeProofDigest === null ||
        entry.authority.activeOwner !== null ||
        owner === null ||
        input.intent.purpose !== "HANDOFF"
      )
        throw new WitnessBlocked("fence_required");
      const recovered = await reconcileTargetEffect(context, entry);
      const authority = advanceTargetAuthority(recovered.authority, {
        generation: Math.max(
          recovered.authority.globalTargetWriterGeneration,
          input.intent.expectedGlobalTargetWriterGeneration + 1,
        ),
        owner,
        tombstone: false,
      });
      const body = {
        installationId: current.installation.installationId,
        ...owner,
        epochId: input.epochId,
        phase: input.intent.phase,
        roundOrdinal: input.intent.roundOrdinal,
        targetCanonicalPath: input.intent.target.canonicalLogicalTargetPath,
        leaseGeneration: authority.globalTargetWriterGeneration,
        expectedPreImageDigest: authority.expectedImage.digest,
        expectedGitMode: authority.expectedImage.gitMode,
        witnessFrontierHash: current.hash,
        revokesAttemptId: input.intent.oldOwner?.attemptId ?? null,
      };
      const lease = Object.freeze({
        ...body,
        protectedLeaseProofDigest: computeCanonicalJsonFingerprint(body),
      });
      await context.store.advance("target", state, {
        ...state.data,
        targets: {
          ...state.data.targets,
          [input.intent.target.targetIdentityDigest]: { ...recovered, authority, lease },
        },
        handoffs: {
          ...state.data.handoffs,
          [input.intent.handoffOperationId]: { ...prepared, status: "CLAIMED" },
        },
      });
      return lease;
    }),
  );
}
