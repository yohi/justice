import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import type {
  VerifiedCanonicalMutationTargetV1,
  VerifiedTargetWriterAuthorityV1,
  VerifiedTargetWriterHandoffIntentV1,
  VerifiedTargetWriterHandoffContinuationV1,
} from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { targetRegistrySchema, intentSchema } from "./review-gate-target-writer-schema.js";
import {
  targetImage,
  verifyTarget,
  withTargetLocks,
  sameTargetValue,
} from "./review-gate-target-writer-state.js";
import {
  fenceTarget,
  targetHandoffContinuation,
  type NativeRevocationAuthorizer,
} from "./review-gate-target-writer-fence.js";
import {
  claimTargetWriterForGate,
  type TargetWriterClaimInput,
} from "./review-gate-target-writer-claim.js";
import { withWitnessTransaction, type WitnessContext } from "./review-gate-witness-context.js";
export {
  fenceTarget,
  verifyNativeFenceReceipt,
  type NativeRevocationAuthorizer,
} from "./review-gate-target-writer-fence.js";

export function createTargetWriterHandoff(context: WitnessContext) {
  return {
    async readPreparedTargetWriterHandoff(
      intent: VerifiedTargetWriterHandoffIntentV1,
    ): Promise<VerifiedTargetWriterHandoffContinuationV1> {
      return withWitnessTransaction(context, async () => {
        const state = await context.store.read("target", targetRegistrySchema);
        const prepared = state.data.handoffs[intent.handoffOperationId];
        const entry = state.data.targets[intent.target.targetIdentityDigest];
        if (
          prepared === undefined ||
          entry === undefined ||
          !sameTargetValue(prepared.intent, intent)
        )
          throw new WitnessBlocked("handoff_unprepared");
        return targetHandoffContinuation(intent, entry.authority, prepared.status);
      });
    },
    async verifyCanonicalMutationTarget(path: string): Promise<VerifiedCanonicalMutationTargetV1> {
      return withWitnessTransaction(context, async (current) => {
        await targetImage(context, path);
        const target = {
          installationId: current.installation.installationId,
          workspaceIdentity: context.options.workspaceIdentity,
          canonicalWorkspaceRoot: context.options.workspaceIdentity,
          canonicalLogicalTargetPath: path,
          targetIdentityDigest: computeCanonicalJsonFingerprint({
            workspaceIdentity: context.options.workspaceIdentity,
            path,
          }),
          verifiedAliasSetDigest: computeCanonicalJsonFingerprint([path]),
          identityProofFrontier: current.hash,
        };
        const state = await context.store.read("target", targetRegistrySchema);
        const existing = state.data.targets[target.targetIdentityDigest];
        await verifyTarget(context, current, existing?.authority.target ?? target, state.data);
        return existing?.authority.target ?? target;
      });
    },
    async readVerifiedTargetWriterAuthority(
      target: VerifiedCanonicalMutationTargetV1,
    ): Promise<VerifiedTargetWriterAuthorityV1> {
      return withWitnessTransaction(context, async (current) => {
        const state = await context.store.read("target", targetRegistrySchema);
        return (await verifyTarget(context, current, target, state.data)).authority;
      });
    },
    async prepareTargetWriterHandoff(
      untrusted: VerifiedTargetWriterHandoffIntentV1,
    ): Promise<VerifiedTargetWriterHandoffContinuationV1> {
      const intent = intentSchema.parse(untrusted);
      if (intent.purpose !== "HANDOFF") throw new WitnessBlocked("terminal_transaction_required");
      return withWitnessTransaction(context, async (current) =>
        withTargetLocks(context, current, [intent], async () => {
          const state = await context.store.read("target", targetRegistrySchema);
          const existing = state.data.handoffs[intent.handoffOperationId];
          if (existing !== undefined) {
            if (!sameTargetValue(existing.intent, intent))
              throw new WitnessBlocked("handoff_identity_conflict");
            const entry = state.data.targets[intent.target.targetIdentityDigest];
            if (entry === undefined) throw new WitnessBlocked("target_registry_lost");
            return targetHandoffContinuation(intent, entry.authority, existing.status);
          }
          if (
            Object.values(state.data.handoffs).some(
              (record) =>
                record.intent.target.targetIdentityDigest === intent.target.targetIdentityDigest &&
                record.status !== "CLAIMED",
            ) ||
            Object.values(state.data.terminals).some(
              (record) =>
                record.proof === null &&
                record.intents.some(
                  (old) => old.target.targetIdentityDigest === intent.target.targetIdentityDigest,
                ),
            )
          )
            throw new WitnessBlocked("handoff_busy_retryable");
          const entry = await verifyTarget(context, current, intent.target, state.data);
          if (
            entry.authority.protectedTargetFrontier !== intent.expectedTargetWriterFrontier ||
            entry.authority.globalTargetWriterGeneration !==
              intent.expectedGlobalTargetWriterGeneration ||
            !sameTargetValue(entry.authority.activeOwner, intent.oldOwner) ||
            entry.authority.expectedImage.digest !== intent.expectedPreImageDigest ||
            entry.authority.expectedImage.gitMode !== intent.expectedGitMode
          )
            throw new WitnessBlocked("handoff_frontier");
          await context.store.advance("target", state, {
            ...state.data,
            targets: { ...state.data.targets, [intent.target.targetIdentityDigest]: entry },
            handoffs: {
              ...state.data.handoffs,
              [intent.handoffOperationId]: { intent, status: "REQUESTED", nativeProofDigest: null },
            },
          });
          return targetHandoffContinuation(intent, entry.authority, "REQUESTED");
        }),
      );
    },
    async fencePreviousTargetWriter(
      input: Readonly<{
        intent: VerifiedTargetWriterHandoffIntentV1;
        authorizeNativeRevocation: NativeRevocationAuthorizer;
      }>,
    ): Promise<VerifiedTargetWriterHandoffContinuationV1> {
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
          if (prepared.status !== "REQUESTED")
            return targetHandoffContinuation(input.intent, entry.authority, prepared.status);
          const fenced = await fenceTarget(
            context,
            current,
            entry,
            input.intent,
            input.authorizeNativeRevocation,
          );
          await context.store.advance("target", state, {
            ...state.data,
            targets: {
              ...state.data.targets,
              [input.intent.target.targetIdentityDigest]: fenced.entry,
            },
            handoffs: {
              ...state.data.handoffs,
              [input.intent.handoffOperationId]: {
                ...prepared,
                status: "FENCED",
                nativeProofDigest: fenced.proofDigest,
              },
            },
          });
          return targetHandoffContinuation(input.intent, fenced.entry.authority, "FENCED");
        }),
      );
    },
    claimTargetWriterForGate: (input: TargetWriterClaimInput) =>
      claimTargetWriterForGate(context, input),
  };
}
