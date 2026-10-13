import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
} from "../core/review-gate/identity.js";
import {
  encodeReviewGateEventRecord,
  validateReviewGateEventRecord,
} from "../core/review-gate/event-schema.js";
import type { PreparedWitnessPublicationV1 } from "./review-gate-witness-contracts.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import { verifyScopeFrontierMembership } from "./review-gate-witness-verification.js";
import {
  workspaceFrom,
  type WitnessContext,
  type WitnessTransaction,
} from "./review-gate-witness-context.js";
import { verifyAdditionalScopeAuthorization } from "./review-gate-witness-scope-enrollment.js";
import { verifyTerminalPublication } from "./review-gate-witness-terminal-publication.js";

export function samePublicationValue(left: unknown, right: unknown): boolean {
  return computeCanonicalJsonFingerprint(left) === computeCanonicalJsonFingerprint(right);
}
export async function validatePublication(
  context: WitnessContext,
  current: WitnessTransaction,
  input: PreparedWitnessPublicationV1,
  bytes: Uint8Array,
): Promise<void> {
  const workspace = workspaceFrom(current, input.workspaceIdentity);
  const previous = workspace.frontier;
  const priorHead = previous.writerHeads.find(
    (head) =>
      head.scopeId === input.scopeId &&
      head.gateId === input.gateId &&
      head.writerId === input.writerId,
  );
  const nextHead = input.nextFrontier.writerHeads.find(
    (head) =>
      head.scopeId === input.scopeId &&
      head.gateId === input.gateId &&
      head.writerId === input.writerId,
  );
  verifyScopeFrontierMembership(input.nextFrontier);
  if (
    input.installationId !== current.installation.installationId ||
    input.workspaceIdentity !== context.options.workspaceIdentity ||
    input.expectedInstallationFrontier !== current.hash ||
    input.expectedGlobalFrontier !== previous.globalFrontierHash ||
    input.expectedWriterHash !== (priorHead?.hash ?? "0".repeat(64)) ||
    input.expectedWriterSequence !== (priorHead?.sequence ?? 0) ||
    input.canonicalShardPath !== `${input.scopeId}/${input.gateId}/${input.writerId}.jsonl` ||
    bytes.byteLength > 8 * 1024 * 1024 ||
    input.newTailLength > 64 * 1024 ||
    input.newWriterHash !== computeArtifactDigest(bytes) ||
    input.newGlobalFrontier !== input.nextFrontier.globalFrontierHash ||
    input.nextFrontier.workspaceIdentity !== previous.workspaceIdentity ||
    input.nextFrontier.workspaceEnrollmentId !== previous.workspaceEnrollmentId ||
    nextHead?.hash !== input.newWriterHash ||
    nextHead.sequence !== input.newWriterSequence ||
    input.newWriterSequence <= input.expectedWriterSequence
  )
    throw new WitnessBlocked("publication_conflict");
  const oldHeads = previous.writerHeads.filter((head) => head !== priorHead);
  const newHeads = input.nextFrontier.writerHeads.filter((head) => head !== nextHead);
  if (!samePublicationValue(oldHeads, newHeads)) throw new WitnessBlocked("publication_membership");
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.endsWith("\n") || !Buffer.from(text).equals(Buffer.from(bytes)))
    throw new WitnessBlocked("publication_bytes");
  const records = text
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      const event = validateReviewGateEventRecord(JSON.parse(line));
      if (
        encodeReviewGateEventRecord(event) !== line ||
        event.gateId !== input.gateId ||
        event.writerId !== input.writerId
      )
        throw new WitnessBlocked("publication_bytes");
      return event;
    });
  if (records.length !== input.newWriterSequence) throw new WitnessBlocked("publication_sequence");
  await verifyTerminalPublication(context, current, records.slice(input.expectedWriterSequence));
  let priorBytes: Buffer | null = null;
  if (priorHead !== undefined) {
    const observedBytes = await context.provider?.readWriterShard(
      input.scopeId,
      input.gateId,
      input.writerId,
    );
    if (
      observedBytes === undefined ||
      observedBytes === null ||
      computeArtifactDigest(observedBytes) !== input.expectedWriterHash ||
      !Buffer.from(bytes).subarray(0, observedBytes.length).equals(observedBytes)
    )
      throw new WitnessBlocked("publication_preimage");
    priorBytes = observedBytes;
  }
  const tail = Buffer.from(bytes).subarray(priorBytes?.length ?? 0);
  if (
    tail.byteLength !== input.newTailLength ||
    computeArtifactDigest(tail) !== input.newTailDigest ||
    tail.byteLength > 64 * 1024
  )
    throw new WitnessBlocked("publication_bytes");
  for (const priorScope of previous.scopes) {
    const nextScope = input.nextFrontier.scopes.find(
      (scope) => scope.scopeId === priorScope.scopeId,
    );
    if (nextScope === undefined) throw new WitnessBlocked("publication_scope_relabel");
    if (!samePublicationValue(priorScope, nextScope))
      verifyAdditionalScopeAuthorization(current, nextScope, previous.globalFrontierHash);
  }
  if (previous.scopes.length === 0) {
    const scope = input.nextFrontier.scopes[0];
    const genesis = records[0];
    const auth = workspace.authorization.authority;
    if (
      workspace.enrollmentState !== "consumed" ||
      input.nextFrontier.scopes.length !== 1 ||
      scope === undefined ||
      scope.provenance.kind !== "verified_genesis" ||
      scope.provenance.evidenceDigest !== computeCanonicalJsonFingerprint(auth) ||
      scope.canonicalDesignPath !== auth.canonicalDesignPath ||
      scope.canonicalPlanPath !== auth.canonicalPlanPath ||
      input.firstEnrollmentAuthorizationId !== auth.authorizationEventId ||
      genesis?.eventType !== "GATE_CREATED" ||
      genesis.payload.reviewScopeId !== scope.scopeId ||
      genesis.payload.designArtifact.canonicalPath !== scope.canonicalDesignPath ||
      genesis.payload.planArtifact.canonicalPath !== scope.canonicalPlanPath
    )
      throw new WitnessBlocked("publication_genesis");
  } else {
    for (const scope of input.nextFrontier.scopes.filter(
      (value) => !previous.scopes.some((prior) => prior.scopeId === value.scopeId),
    ))
      verifyAdditionalScopeAuthorization(current, scope, previous.globalFrontierHash);
  }
}
