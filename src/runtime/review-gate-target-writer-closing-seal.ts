import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { computeArtifactDigest, computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../core/review-gate/event-schema.js";
import type {
  VerifiedClosingSealReceiptPayloadV1,
  VerifiedClosingSealReceiptV1,
  VerifiedTargetWriterClosingSealV1,
  VerifiedTargetWriterHandoffIntentV1,
} from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { hostProofValid } from "./review-gate-witness-installation.js";
import { publicationSchema } from "./review-gate-witness-registry.js";
import {
  closingSealReceiptPayloadSchema,
  intentSchema,
  targetRegistrySchema,
} from "./review-gate-target-writer-schema.js";
import { verifyTarget, sameTargetValue } from "./review-gate-target-writer-state.js";
import {
  withGateOwnedWitnessTransaction,
  type WitnessContext,
  type WitnessTransaction,
} from "./review-gate-witness-context.js";
import {
  commitPublicationUnlocked,
  preparePublicationUnlocked,
  readPreparedPublication,
} from "./review-gate-publication-record.js";
import { verifyTerminalPublication } from "./review-gate-witness-terminal-publication.js";
import { scopeInstallationIdSchema } from "./review-gate-witness-verification.js";
import type { PreparedWitnessPublicationV1 } from "./review-gate-witness-contracts.js";

const sealedReceiptFileSchema = z.strictObject({
  payload: z.unknown(),
  signature: z.string(),
});

export type TerminalIntentPublicationInput = Readonly<{
  readonly intents: readonly VerifiedTargetWriterHandoffIntentV1[];
  readonly terminalTransitionOperationId: string;
  readonly publication: PreparedWitnessPublicationV1;
}>;
export type SealedTerminalIntentInput = Readonly<{
  readonly closingSealOperationId: string;
  readonly authorizeSealedReceipt: (payload: unknown) => Promise<string>;
}>;

const sortedAuthorities = (
  authorities: readonly {
    readonly target: { readonly targetIdentityDigest: string };
  }[],
) =>
  [...authorities].sort((left, right) =>
    left.target.targetIdentityDigest.localeCompare(right.target.targetIdentityDigest),
  );

async function verifySealedReceipt(
  context: WitnessContext,
  current: WitnessTransaction,
  marker: VerifiedTargetWriterClosingSealV1,
  digest: string,
): Promise<VerifiedClosingSealReceiptV1> {
  let receipt: { payload: unknown; signature: string };
  try {
    receipt = await context.store.readJson(
      `sealed-receipt-${digest}.json`,
      sealedReceiptFileSchema,
    );
  } catch (error: unknown) {
    if (error instanceof WitnessBlocked) throw new WitnessBlocked("closing_seal_receipt_lost");
    throw error;
  }
  const payload = closingSealReceiptPayloadSchema.parse(receipt.payload);
  if (
    computeCanonicalJsonFingerprint({ payload, signature: receipt.signature }) !== digest ||
    payload.closingSealOperationId !== marker.closingSealOperationId ||
    payload.preparedEventDigest !== marker.preparedEventDigest ||
    !hostProofValid(
      createPublicKey(current.installation.hostTrustRootPem),
      payload,
      receipt.signature,
    )
  )
    throw new WitnessBlocked("closing_seal_receipt_unproven");
  return { payload, signature: receipt.signature };
}

/**
 * Gate-owned closing-seal publication for terminal intents.
 *
 * All entrypoints run on the Gate-owned protected witness transaction: the
 * coordinator already holds the workspace/scope/Gate admission locks, so
 * the admission-order guard and lock re-acquisition are intentionally absent.
 * Every mutation still goes through the protected store's CAS `advance`.
 */
export function createTerminalIntentPublication(context: WitnessContext) {
  const api = {
    /**
     * Prepare the terminal intent event publication and durably install the
     * protected `TARGET_CLOSING_SEALED` marker in the global target registry.
     * From this point on, worker effects on the sealed target set are denied
     * even if the terminal revoke proof has not completed yet.
     */
    async prepareTerminalIntentPublication(
      input: TerminalIntentPublicationInput,
      canonicalEventBytes: Uint8Array,
    ): Promise<"prepared" | "already_prepared"> {
      const intents = input.intents.map((value) => intentSchema.parse(value));
      const first = intents[0];
      if (first === undefined) throw new WitnessBlocked("terminal_intent");
      const closingSealOperationId = first.closingSealOperationId;
      if (
        !scopeInstallationIdSchema.safeParse(input.terminalTransitionOperationId).success ||
        closingSealOperationId === null ||
        intents.some(
          (intent) =>
            intent.purpose !== "TERMINAL_REVOKE_ONLY" ||
            intent.newOwner !== null ||
            intent.closingSealOperationId !== closingSealOperationId ||
            intent.handoffOperationId !== first.handoffOperationId ||
            intent.gateId !== first.gateId ||
            intent.generationId !== first.generationId ||
            intent.phase !== first.phase ||
            intent.roundOrdinal !== first.roundOrdinal,
        ) ||
        new Set(intents.map((intent) => intent.target.targetIdentityDigest)).size !== intents.length
      )
        throw new WitnessBlocked("terminal_intent");
      const publication = publicationSchema.parse(input.publication);
      if (publication.gateId !== first.gateId) throw new WitnessBlocked("terminal_intent");
      const bytes = Buffer.from(canonicalEventBytes);
      return withGateOwnedWitnessTransaction(context, async (current) => {
        const state = await context.store.read("target", targetRegistrySchema);
        const targets = { ...state.data.targets };
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
        const existing = state.data.closingSeals[closingSealOperationId];
        if (existing !== undefined) {
          if (
            !sameTargetValue(existing.targets, intents.map((intent) => intent.target)) ||
            existing.handoffOperationId !== first.handoffOperationId ||
            existing.terminalTransitionOperationId !== input.terminalTransitionOperationId ||
            existing.gateId !== first.gateId ||
            existing.generationId !== first.generationId ||
            existing.publicationId !== publication.publicationId ||
            existing.preparedEventDigest !== publication.newTailDigest
          )
            throw new WitnessBlocked("closing_seal_conflict");
          await preparePublicationUnlocked(context, current, publication, bytes);
          return "already_prepared";
        }
        if (
          Object.values(state.data.closingSeals).some(
            (seal) =>
              seal.closingSealOperationId !== closingSealOperationId &&
              seal.targets.some((target) =>
                intents.some(
                  (intent) => intent.target.targetIdentityDigest === target.targetIdentityDigest,
                ),
              ),
          )
        )
          throw new WitnessBlocked("closing_seal_busy");
        const sealedAuthorities = intents.map((intent) => {
          const entry = targets[intent.target.targetIdentityDigest];
          if (entry === undefined) throw new WitnessBlocked("target_registry_lost");
          return entry.authority;
        });
        const marker: VerifiedTargetWriterClosingSealV1 = {
          marker: "TARGET_CLOSING_SEALED",
          closingSealOperationId,
          handoffOperationId: first.handoffOperationId,
          terminalTransitionOperationId: input.terminalTransitionOperationId,
          gateId: first.gateId,
          generationId: first.generationId,
          targets: intents.map((intent) => intent.target),
          publicationId: publication.publicationId,
          preparedEventDigest: publication.newTailDigest,
          preSealWitnessFrontier: current.hash,
          preSealTargetFrontier: computeCanonicalJsonFingerprint(
            sortedAuthorities(sealedAuthorities),
          ),
          targetLeaseHighWatermark: Math.max(
            0,
            ...Object.values(targets).map((entry) => entry.authority.globalTargetWriterGeneration),
          ),
          sealedReceiptDigest: null,
        };
        await preparePublicationUnlocked(context, current, publication, bytes);
        await context.store.advance("target", state, {
          ...state.data,
          targets,
          closingSeals: {
            ...state.data.closingSeals,
            [closingSealOperationId]: marker,
          },
        });
        return "prepared";
      });
    },

    /**
     * Publish the sealed terminal intent: durably replace the writer shard
     * with the prepared canonical event bytes, commit the publication CAS,
     * then write the immutable authenticated per-operation sealed receipt
     * (protected pre/post target head and native effect disposition) and
     * bind its digest into the marker. Idempotent: re-publishing an already
     * sealed intent verifies and returns the existing receipt.
     */
    async publishSealedTerminalIntent(
      input: SealedTerminalIntentInput,
    ): Promise<VerifiedClosingSealReceiptV1> {
      return withGateOwnedWitnessTransaction(context, async (current) => {
        const state = await context.store.read("target", targetRegistrySchema);
        const marker = state.data.closingSeals[input.closingSealOperationId];
        if (marker === undefined) throw new WitnessBlocked("closing_seal_unprepared");
        if (marker.sealedReceiptDigest !== null)
          return verifySealedReceipt(context, current, marker, marker.sealedReceiptDigest);
        const record = await readPreparedPublication(context, current, marker.publicationId);
        if (record.input.gateId !== marker.gateId)
          throw new WitnessBlocked("closing_seal_conflict");
        if (context.provider === undefined) throw new WitnessBlocked("journal_native_unavailable");
        const events = record.bytes
          .toString("utf8")
          .trimEnd()
          .split("\n")
          .map((line) => validateReviewGateEventRecord(JSON.parse(line)));
        const preparedTail = Buffer.from(
          `${events.slice(record.input.expectedWriterSequence).map(encodeReviewGateEventRecord).join("\n")}\n`,
        );
        if (computeArtifactDigest(preparedTail) !== marker.preparedEventDigest)
          throw new WitnessBlocked("closing_seal_digest_mismatch");
        await verifyTerminalPublication(
          context,
          current,
          events.slice(record.input.expectedWriterSequence),
        );
        const previous = await context.provider.readWriterShard(
          record.input.scopeId,
          record.input.gateId,
          record.input.writerId,
        );
        if (previous === null || !previous.equals(record.bytes)) {
          if (current.data.committed[marker.publicationId] !== undefined)
            throw new WitnessBlocked("journal_history_lost");
          if (
            (previous === null ? "0".repeat(64) : computeArtifactDigest(previous)) !==
            record.input.expectedWriterHash
          )
            throw new WitnessBlocked("publication_preimage");
          await context.provider.durableReplaceWriterShard(
            record.input.scopeId,
            record.input.gateId,
            record.input.writerId,
            previous === null ? null : computeArtifactDigest(previous),
            record.bytes,
          );
        }
        const committed = await commitPublicationUnlocked(context, current, {
          publicationId: marker.publicationId,
          expectedGlobalFrontier: record.input.expectedGlobalFrontier,
          expectedWriterHash: record.input.expectedWriterHash,
        });
        if (committed === "blocked") throw new WitnessBlocked("publication_frontier");
        const after = await context.store.read("target", targetRegistrySchema);
        const postSealAuthorities = marker.targets.map((target) => {
          const entry = after.data.targets[target.targetIdentityDigest];
          if (entry === undefined) throw new WitnessBlocked("target_registry_lost");
          return entry.authority;
        });
        const payload: VerifiedClosingSealReceiptPayloadV1 = {
          domain: "justice-target-closing-seal-receipt-v1",
          installationId: current.installation.installationId,
          closingSealOperationId: marker.closingSealOperationId,
          handoffOperationId: marker.handoffOperationId,
          terminalTransitionOperationId: marker.terminalTransitionOperationId,
          gateId: marker.gateId,
          generationId: marker.generationId,
          publicationId: marker.publicationId,
          preparedEventDigest: marker.preparedEventDigest,
          targets: marker.targets,
          preSealTargetHead: marker.preSealTargetFrontier,
          postSealTargetHead: computeCanonicalJsonFingerprint(
            sortedAuthorities(postSealAuthorities),
          ),
          nativeEffectDisposition: "NO_EFFECT",
        };
        const signature = await input.authorizeSealedReceipt(payload);
        if (
          !hostProofValid(
            createPublicKey(current.installation.hostTrustRootPem),
            payload,
            signature,
          )
        )
          throw new WitnessBlocked("closing_seal_receipt_unproven");
        const receiptDigest = computeCanonicalJsonFingerprint({ payload, signature });
        await context.store.writeJson(
          `sealed-receipt-${receiptDigest}.json`,
          { payload, signature },
          true,
        );
        await context.store.advance("target", after, {
          ...after.data,
          closingSeals: {
            ...after.data.closingSeals,
            [input.closingSealOperationId]: { ...marker, sealedReceiptDigest: receiptDigest },
          },
        });
        return { payload, signature };
      });
    },

    /**
     * Complete a terminal intent publication that crashed after the seal was
     * installed but before the witness journal publication, commit, or
     * sealed receipt landed. Idempotent with `publishSealedTerminalIntent`.
     */
    async recoverPreparedTerminalIntentPublication(
      input: SealedTerminalIntentInput,
    ): Promise<VerifiedClosingSealReceiptV1> {
      return api.publishSealedTerminalIntent(input);
    },

    /**
     * Verify the installed closing seal by `closingSealOperationId` and the
     * prepared canonical event byte digest. When the sealed receipt has been
     * written, its immutable file is re-verified against the host trust root;
     * a lost or forged receipt fails closed.
     */
    async verifyClosingSeal(
      input: Readonly<{ closingSealOperationId: string; preparedEventDigest: string }>,
    ): Promise<VerifiedTargetWriterClosingSealV1> {
      return withGateOwnedWitnessTransaction(context, async (current) => {
        const state = await context.store.read("target", targetRegistrySchema);
        const marker = state.data.closingSeals[input.closingSealOperationId];
        if (marker === undefined) throw new WitnessBlocked("closing_seal_unprepared");
        if (marker.preparedEventDigest !== input.preparedEventDigest)
          throw new WitnessBlocked("closing_seal_digest_mismatch");
        if (marker.sealedReceiptDigest !== null)
          await verifySealedReceipt(context, current, marker, marker.sealedReceiptDigest);
        return marker;
      });
    },
  };
  return api;
}
