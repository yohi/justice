import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../core/review-gate/identity.js";
import type { VerifiedReviewWriterLeaseV1 } from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { targetRegistrySchema } from "./review-gate-target-writer-schema.js";
import {
  withTargetLocks,
  sameTargetValue,
  reconcileTargetEffect,
  targetImage,
  advanceTargetAuthority,
} from "./review-gate-target-writer-state.js";
import { withWitnessTransaction, type WitnessContext } from "./review-gate-witness-context.js";
import { verifyNativeFenceReceipt } from "./review-gate-target-writer-handoff.js";

type Mutation = Readonly<{ bytes: Uint8Array; gitMode: "100644" | "100755" }>;
export function createTargetWriterEffect(context: WitnessContext) {
  return {
    async withCurrentReviewWriterLease<T>(
      lease: VerifiedReviewWriterLeaseV1,
      run: (mutate: (input: Mutation) => Promise<void>) => Promise<T>,
    ): Promise<T> {
      return withWitnessTransaction(context, async (current) => {
        const state = await context.store.read("target", targetRegistrySchema);
        if (
          Object.values(state.data.terminals).some((close) =>
            close.intents.some(
              (intent) =>
                intent.gateId === lease.gateId && intent.generationId === lease.generationId,
            ),
          )
        )
          throw new WitnessBlocked("lease_terminal_close");
        const prepared = Object.values(state.data.handoffs).find(
          (record) =>
            record.status === "CLAIMED" &&
            record.intent.newOwner?.attemptId === lease.attemptId &&
            record.intent.newOwner.operationId === lease.operationId,
        );
        if (prepared === undefined) throw new WitnessBlocked("lease_stale");
        if (prepared.nativeProofDigest === null) throw new WitnessBlocked("native_receipt_lost");
        await verifyNativeFenceReceipt(context, current, prepared.nativeProofDigest);
        return withTargetLocks(context, current, [prepared.intent], async () => {
          const key = prepared.intent.target.targetIdentityDigest;
          const entry = state.data.targets[key];
          if (
            entry === undefined ||
            !sameTargetValue(entry.lease, lease) ||
            entry.authority.activeOwner?.attemptId !== lease.attemptId ||
            entry.authority.globalTargetWriterGeneration !== lease.leaseGeneration ||
            entry.authority.expectedImage.digest !== lease.expectedPreImageDigest
          )
            throw new WitnessBlocked("lease_stale");
          if (entry.lease === null) throw new WitnessBlocked("lease_stale");
          if (
            Object.values(state.data.closingSeals).some((seal) =>
              seal.targets.some((target) => target.targetIdentityDigest === key),
            )
          )
            throw new WitnessBlocked("closing_seal");
          const bound = Object.freeze({ ...entry.lease });
          const recovered = await reconcileTargetEffect(context, entry);
          if (
            !sameTargetValue(recovered.authority.expectedImage, {
              digest: lease.expectedPreImageDigest,
              gitMode: lease.expectedGitMode,
            })
          )
            throw new WitnessBlocked("lease_preimage");
          let guardActive = true;
          let pending: Promise<void> | undefined;
          const perform = async (input: Mutation): Promise<void> => {
            if (
              context.provider === undefined ||
              input.bytes.byteLength > 65536 ||
              (input.gitMode !== "100644" && input.gitMode !== "100755")
            )
              throw new WitnessBlocked("lease_effect");
            const bytes = Buffer.from(input.bytes);
            const gitMode = input.gitMode;
            const next = { digest: computeArtifactDigest(bytes), gitMode };
            await context.store.writeBytes(`effect-${next.digest}.bin`, bytes, true);
            const pendingEntry = {
              ...recovered,
              pendingEffect: {
                operationId: bound.operationId,
                prior: recovered.authority.expectedImage,
                next,
              },
            };
            await context.store.advance("target", state, {
              ...state.data,
              targets: { ...state.data.targets, [key]: pendingEntry },
            });
            await context.provider.replaceWorkspaceFileExact(
              bound.targetCanonicalPath,
              recovered.authority.expectedImage,
              { bytes, gitMode },
            );
            const published = await targetImage(context, bound.targetCanonicalPath);
            if (!sameTargetValue(published.image, next))
              throw new WitnessBlocked("native_effect_unknown");
            const after = await context.store.read("target", targetRegistrySchema);
            const active = after.data.targets[key];
            if (
              active === undefined ||
              computeCanonicalJsonFingerprint(active.pendingEffect) !==
                computeCanonicalJsonFingerprint(pendingEntry.pendingEffect)
            )
              throw new WitnessBlocked("native_effect_unknown");
            await context.store.advance("target", after, {
              ...after.data,
              targets: {
                ...after.data.targets,
                [key]: {
                  ...active,
                  physicalIdentity: published.physicalIdentity,
                  pendingEffect: null,
                  authority: advanceTargetAuthority(active.authority, {
                    generation: bound.leaseGeneration,
                    owner: active.authority.activeOwner,
                    image: next,
                    tombstone: false,
                  }),
                },
              },
            });
          };
          const mutate = async (input: Mutation): Promise<void> => {
            if (!guardActive) throw new WitnessBlocked("lease_guard_closed");
            if (pending !== undefined) throw new WitnessBlocked("lease_effect");
            pending = perform(input);
            return pending;
          };
          try {
            const result = await run(mutate);
            if (pending !== undefined) await pending;
            return result;
          } finally {
            try {
              if (pending !== undefined) await pending;
            } finally {
              guardActive = false;
            }
          }
        });
      });
    },
  };
}
