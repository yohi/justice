import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import type {
  VerifiedTargetWriterAuthorityV1,
  VerifiedTargetWriterHandoffIntentV1,
  VerifiedTargetWriterHandoffContinuationV1,
} from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { hostProofValid } from "./review-gate-witness-installation.js";
import type { TargetEntry } from "./review-gate-target-writer-schema.js";
import {
  reconcileTargetEffect,
  advanceTargetAuthority,
} from "./review-gate-target-writer-state.js";
import type { WitnessContext, WitnessTransaction } from "./review-gate-witness-context.js";

export type NativeRevocationAuthorizer = (payload: unknown) => Promise<string>;
export async function fenceTarget(
  context: WitnessContext,
  current: WitnessTransaction,
  entry: TargetEntry,
  intent: VerifiedTargetWriterHandoffIntentV1,
  authorize: NativeRevocationAuthorizer,
): Promise<Readonly<{ entry: TargetEntry; proofDigest: string }>> {
  const recovered = await reconcileTargetEffect(context, entry);
  const payload = {
    domain: "justice-native-target-revoke-v1",
    installationId: current.installation.installationId,
    handoffOperationId: intent.handoffOperationId,
    target: intent.target,
    priorOwner: recovered.authority.activeOwner,
    generation: recovered.authority.globalTargetWriterGeneration,
    image: recovered.authority.expectedImage,
    pendingNativeEffectReference: intent.pendingNativeEffectReference,
    allOldAttemptsAndUnmediatedWritePathsDisabled: true,
  };
  const signature = await authorize(payload);
  if (!hostProofValid(createPublicKey(current.installation.hostTrustRootPem), payload, signature))
    throw new WitnessBlocked("native_revocation_unproven");
  const proofDigest = computeCanonicalJsonFingerprint({ payload, signature });
  await context.store.writeJson(`native-proof-${proofDigest}.json`, { payload, signature }, true);
  const generation =
    recovered.authority.globalTargetWriterGeneration +
    (recovered.authority.activeOwner === null ? 0 : 1);
  return {
    entry: {
      ...recovered,
      lease: null,
      authority: advanceTargetAuthority(recovered.authority, {
        generation,
        owner: null,
        tombstone: true,
      }),
    },
    proofDigest,
  };
}
export async function verifyNativeFenceReceipt(
  context: WitnessContext,
  current: WitnessTransaction,
  digest: string,
): Promise<void> {
  let proof;
  try {
    proof = await context.store.readJson(
      `native-proof-${digest}.json`,
      z.strictObject({ payload: z.unknown(), signature: z.string() }),
    );
  } catch (error: unknown) {
    if (error instanceof WitnessBlocked) throw new WitnessBlocked("native_receipt_lost");
    throw error;
  }
  if (
    computeCanonicalJsonFingerprint(proof) !== digest ||
    !hostProofValid(
      createPublicKey(current.installation.hostTrustRootPem),
      proof.payload,
      proof.signature,
    )
  )
    throw new WitnessBlocked("native_revocation_unproven");
}
export function targetHandoffContinuation(
  intent: VerifiedTargetWriterHandoffIntentV1,
  authority: VerifiedTargetWriterAuthorityV1,
  status: VerifiedTargetWriterHandoffContinuationV1["status"],
): VerifiedTargetWriterHandoffContinuationV1 {
  const body = {
    status,
    handoffOperationId: intent.handoffOperationId,
    originalOperationId: intent.originalOperationId,
    intent,
    protectedTargetFrontier: authority.protectedTargetFrontier,
    gateEventFrontier: intent.expectedGateEventFrontier,
    globalTargetWriterGeneration: authority.globalTargetWriterGeneration,
    pendingNativeEffectReference: intent.pendingNativeEffectReference,
  };
  return { ...body, continuationProofDigest: computeCanonicalJsonFingerprint(body) };
}
