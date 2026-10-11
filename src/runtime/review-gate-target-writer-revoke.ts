import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import type {
  VerifiedTargetWriterHandoffIntentV1,
  VerifiedTerminalWriterRevokeV1,
} from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { intentSchema, targetRegistrySchema } from "./review-gate-target-writer-schema.js";
import {
  withTargetLocks,
  verifyTarget,
  sameTargetValue,
} from "./review-gate-target-writer-state.js";
import {
  fenceTarget,
  verifyNativeFenceReceipt,
  type NativeRevocationAuthorizer,
} from "./review-gate-target-writer-handoff.js";
import { withWitnessTransaction, type WitnessContext } from "./review-gate-witness-context.js";
import { scopeInstallationIdSchema } from "./review-gate-witness-verification.js";

export function createTerminalTargetWriterRevoke(context: WitnessContext) {
  const api = {
    async prepareTerminalTargetWriterRevoke(
      input: Readonly<{
        intents: readonly VerifiedTargetWriterHandoffIntentV1[];
        terminalTransitionOperationId: string;
      }>,
    ): Promise<void> {
      const intents = input.intents.map((value) => intentSchema.parse(value));
      const first = intents[0];
      if (
        first === undefined ||
        !scopeInstallationIdSchema.safeParse(input.terminalTransitionOperationId).success ||
        intents.some(
          (intent) =>
            intent.purpose !== "TERMINAL_REVOKE_ONLY" ||
            intent.newOwner !== null ||
            intent.handoffOperationId !== first.handoffOperationId ||
            intent.gateId !== first.gateId ||
            intent.generationId !== first.generationId ||
            intent.phase !== first.phase ||
            intent.roundOrdinal !== first.roundOrdinal,
        ) ||
        new Set(intents.map((intent) => intent.target.targetIdentityDigest)).size !== intents.length
      )
        throw new WitnessBlocked("terminal_intent");
      return withWitnessTransaction(context, async (current) =>
        withTargetLocks(context, current, intents, async () => {
          const state = await context.store.read("target", targetRegistrySchema);
          const prior = state.data.terminals[first.handoffOperationId];
          if (prior !== undefined) {
            if (
              !sameTargetValue(prior.intents, intents) ||
              prior.terminalTransitionOperationId !== input.terminalTransitionOperationId
            )
              throw new WitnessBlocked("terminal_identity_conflict");
            return;
          }
          const targets = { ...state.data.targets };
          const selected = new Set(intents.map((intent) => intent.target.targetIdentityDigest));
          if (
            Object.entries(targets).some(
              ([key, entry]) =>
                entry.authority.activeOwner?.gateId === first.gateId && !selected.has(key),
            ) ||
            Object.values(state.data.terminals).some(
              (record) =>
                record.proof === null &&
                record.intents.some((intent) => selected.has(intent.target.targetIdentityDigest)),
            ) ||
            Object.values(state.data.handoffs).some(
              (record) =>
                record.status !== "CLAIMED" &&
                selected.has(record.intent.target.targetIdentityDigest),
            )
          )
            throw new WitnessBlocked("terminal_target_set_or_busy");
          for (const intent of intents) {
            const entry = await verifyTarget(context, current, intent.target, state.data);
            if (
              !sameTargetValue(entry.authority.activeOwner, intent.oldOwner) ||
              entry.authority.protectedTargetFrontier !== intent.expectedTargetWriterFrontier ||
              entry.authority.globalTargetWriterGeneration !==
                intent.expectedGlobalTargetWriterGeneration ||
              entry.authority.expectedImage.digest !== intent.expectedPreImageDigest ||
              entry.authority.expectedImage.gitMode !== intent.expectedGitMode
            )
              throw new WitnessBlocked("terminal_frontier");
            targets[intent.target.targetIdentityDigest] = entry;
          }
          await context.store.advance("target", state, {
            ...state.data,
            targets,
            terminals: {
              ...state.data.terminals,
              [first.handoffOperationId]: {
                intents,
                terminalTransitionOperationId: input.terminalTransitionOperationId,
                proof: null,
                nativeProofDigests: [],
              },
            },
          });
        }),
      );
    },
    async revokeTerminalTargetWriter(
      input: Readonly<{
        handoffOperationId: string;
        authorizeNativeRevocation: NativeRevocationAuthorizer;
      }>,
    ): Promise<VerifiedTerminalWriterRevokeV1> {
      return withWitnessTransaction(context, async (current) => {
        const state = await context.store.read("target", targetRegistrySchema);
        const prepared = state.data.terminals[input.handoffOperationId];
        if (prepared === undefined) throw new WitnessBlocked("terminal_unprepared");
        return withTargetLocks(context, current, prepared.intents, async () => {
          if (prepared.proof !== null) {
            for (const digest of prepared.nativeProofDigests)
              await verifyNativeFenceReceipt(context, current, digest);
            if (
              prepared.nativeProofDigests.length !== prepared.intents.length ||
              computeCanonicalJsonFingerprint(prepared.nativeProofDigests) !==
                prepared.proof.nativeNonWriteabilityProofDigest
            )
              throw new WitnessBlocked("native_receipt_lost");
            for (const intent of prepared.intents) {
              const entry = state.data.targets[intent.target.targetIdentityDigest];
              if (
                entry === undefined ||
                entry.authority.activeOwner !== null ||
                entry.authority.durableTombstoneProofDigest === null
              )
                throw new WitnessBlocked("terminal_registry_lost");
            }
            return prepared.proof;
          }
          const targets = { ...state.data.targets };
          const priorOwners = [];
          const nativeProofs: string[] = [];
          let high = 0;
          for (const intent of prepared.intents) {
            const entry = targets[intent.target.targetIdentityDigest];
            if (
              entry === undefined ||
              !sameTargetValue(entry.authority.activeOwner, intent.oldOwner) ||
              entry.authority.globalTargetWriterGeneration !==
                intent.expectedGlobalTargetWriterGeneration
            )
              throw new WitnessBlocked("terminal_frontier");
            if (entry.authority.activeOwner !== null) priorOwners.push(entry.authority.activeOwner);
            const fenced = await fenceTarget(
              context,
              current,
              entry,
              intent,
              input.authorizeNativeRevocation,
            );
            await verifyNativeFenceReceipt(context, current, fenced.proofDigest);
            targets[intent.target.targetIdentityDigest] = fenced.entry;
            nativeProofs.push(fenced.proofDigest);
            high = Math.max(high, fenced.entry.authority.globalTargetWriterGeneration);
          }
          const first = prepared.intents[0];
          if (first === undefined) throw new WitnessBlocked("terminal_intent");
          const frontier = computeCanonicalJsonFingerprint(targets);
          const body = {
            purpose: "TERMINAL_REVOKE_ONLY" as const,
            handoffOperationId: input.handoffOperationId,
            terminalTransitionOperationId: prepared.terminalTransitionOperationId,
            status:
              priorOwners.length === 0
                ? ("NEVER_CLAIMED_OR_ALREADY_REVOKED" as const)
                : ("REVOKED" as const),
            gateId: first.gateId,
            generationId: first.generationId,
            phase: first.phase,
            roundOrdinal: first.roundOrdinal,
            targets: prepared.intents.map((intent) => intent.target),
            priorOwners,
            globalTargetWriterHighWatermark: high,
            protectedTargetFrontier: frontier,
            nativeNonWriteabilityProofDigest: computeCanonicalJsonFingerprint(nativeProofs),
            nativeEffectDisposition: "NO_EFFECT",
          };
          const proof = {
            ...body,
            protectedRevokeCasProofDigest: computeCanonicalJsonFingerprint(body),
          };
          await context.store.advance("target", state, {
            ...state.data,
            targets,
            terminals: {
              ...state.data.terminals,
              [input.handoffOperationId]: { ...prepared, proof, nativeProofDigests: nativeProofs },
            },
          });
          return proof;
        });
      });
    },
    async recoverPreparedTerminalTargetWriterRevoke(
      input: Readonly<{
        handoffOperationId: string;
        authorizeNativeRevocation: NativeRevocationAuthorizer;
      }>,
    ): Promise<VerifiedTerminalWriterRevokeV1> {
      return api.revokeTerminalTargetWriter(input);
    },
  };
  return api;
}
