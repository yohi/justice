import { WitnessBlocked } from "./review-gate-protected-store.js";
import {
  targetRegistrySchema,
  type TargetRegistry,
} from "./review-gate-target-writer-schema.js";
import { createTerminalIntentPublication } from "./review-gate-target-writer-closing-seal.js";
import type { PreparedTerminalIntentV1, VerifiedCompleteTargetClosingSealV1 } from "./review-gate-git.js";
import {
  withGateOwnedWitnessTransaction,
  type WitnessContext,
} from "./review-gate-witness-context.js";
import type { ReviewGateLockHandle } from "./linux-review-gate-provider.js";

function closingSealActiveForTarget(
  registry: TargetRegistry,
  targetIdentityDigest: string,
): boolean {
  return Object.values(registry.closingSeals).some((seal) =>
    seal.targets.some((target) => target.targetIdentityDigest === targetIdentityDigest),
  );
}

/**
 * Build the Task 10d canonical target effect broker backed by the Task 5
 * protected target-wide registry. The broker is intended to run under the
 * coordinator's already-owned workspace/scope/Gate admission locks: it only
 * acquires per-target effect guards and checks the protected registry for
 * closing seals, stale leases and alias equivalence.
 */
export function createCanonicalTargetEffectBroker(context: WitnessContext) {
  const terminal = createTerminalIntentPublication(context);

  return {
    async withCanonicalTargetEffectGuards<T>(
      identities: readonly string[],
      run: () => Promise<T>,
    ): Promise<T> {
      const held: ReviewGateLockHandle[] = [];
      const acquisitionFailure: { value?: Readonly<{ readonly cause: unknown }> } = {};
      try {
        try {
          await withGateOwnedWitnessTransaction(context, async () => {
            const state = await context.store.read("target", targetRegistrySchema);
            const sorted = [...identities].sort();
            for (const id of sorted) {
              if (state.data.targets[id] === undefined)
                throw new WitnessBlocked("target_unknown");
              if (closingSealActiveForTarget(state.data, id))
                throw new WitnessBlocked("closing_seal");
            }
            if (context.provider === undefined) throw new WitnessBlocked("native_unavailable");
            for (const id of sorted) {
              let lock: ReviewGateLockHandle | "occupied";
              try {
                lock = await context.provider.acquireGateLock(`target-${id}`);
              } catch (cause: unknown) {
                acquisitionFailure.value = { cause };
                throw new WitnessBlocked("native_unavailable");
              }
              if (lock === "occupied") throw new WitnessBlocked("busy_retryable");
              if (!lock.verifyCloexec()) {
                lock.release();
                throw new WitnessBlocked("native_unavailable");
              }
              held.push(lock);
            }
          });
        } catch (error: unknown) {
          if (acquisitionFailure.value !== undefined) throw acquisitionFailure.value.cause;
          throw error;
        }
        return await run();
      } finally {
        for (const lock of held.reverse()) lock.release();
      }
    },

    async sealCanonicalTargetsForTerminalIntent(
      input: PreparedTerminalIntentV1,
      authorizeSealedReceipt: (payload: unknown) => Promise<string>,
    ): Promise<VerifiedCompleteTargetClosingSealV1 | "BLOCK"> {
      const first = input.intents[0];
      if (first === undefined) return "BLOCK";
      const closingSealOperationId = first.closingSealOperationId;
      if (closingSealOperationId === null) return "BLOCK";
      try {
        await terminal.prepareTerminalIntentPublication(
          input,
          input.canonicalEventBytes,
        );
        return await terminal.publishSealedTerminalIntent({
          closingSealOperationId,
          authorizeSealedReceipt,
        });
      } catch (error: unknown) {
        if (error instanceof WitnessBlocked) return "BLOCK";
        throw error;
      }
    },
  };
}
