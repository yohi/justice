import { createPrivateKey, sign } from "node:crypto";
import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
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

/**
 * Authorize a sealed receipt using the witness installation's provisioner
 * private key. The signature is verified with `hostProofValid` against the
 * pinned host trust root, matching every other host-attested proof in the
 * witness directory.
 */
async function authorizeSealedReceipt(
  context: WitnessContext,
  payload: unknown,
): Promise<string> {
  const privateKeyPem = await context.store.readBytes("provisioner-key.pem");
  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(
    null,
    Buffer.from(computeCanonicalJsonFingerprint(payload)),
    privateKey,
  );
  return signature.toString("base64");
}

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
      return withGateOwnedWitnessTransaction(context, async () => {
        const state = await context.store.read("target", targetRegistrySchema);
        const sorted = [...identities].sort();
        for (const id of sorted) {
          if (state.data.targets[id] === undefined)
            throw new WitnessBlocked("target_unknown");
          if (closingSealActiveForTarget(state.data, id))
            throw new WitnessBlocked("closing_seal");
        }
        if (context.provider === undefined) throw new WitnessBlocked("native_unavailable");
        const held: ReviewGateLockHandle[] = [];
        try {
          for (const id of sorted) {
            const lock = await context.provider.acquireGateLock(`target-${id}`);
            if (lock === "occupied") throw new WitnessBlocked("busy_retryable");
            if (!lock.verifyCloexec()) {
              lock.release();
              throw new WitnessBlocked("native_unavailable");
            }
            held.push(lock);
          }
          return await run();
        } finally {
          for (const lock of held.reverse()) lock.release();
        }
      });
    },

    async sealCanonicalTargetsForTerminalIntent(
      input: PreparedTerminalIntentV1,
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
          authorizeSealedReceipt: (payload) => authorizeSealedReceipt(context, payload),
        });
      } catch (error: unknown) {
        if (error instanceof WitnessBlocked) return "BLOCK";
        throw error;
      }
    },
  };
}
