import { createPublicKey } from "node:crypto";
import { computeCanonicalJsonFingerprint } from "../core/review-gate/identity.js";
import {
  validateReviewGateEventRecord,
  type VerifiedReviewGateEvent,
} from "../core/review-gate/event-schema.js";
import { projectReviewGateState, projectVerifiedGateTip } from "../core/review-gate/projection.js";
import type { ScopeEnrollmentV1, ReviewGateEvent } from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import {
  withWitnessTransaction,
  workspaceFrom,
  verifyWitnessJournals,
  type WitnessContext,
  type WitnessTransaction,
} from "./review-gate-witness-context.js";
import { hostProofValid } from "./review-gate-witness-installation.js";
import { scopeSchema, scopeInstallationIdSchema } from "./review-gate-witness-verification.js";
import { targetRegistrySchema } from "./review-gate-target-writer-schema.js";

export async function assertCompletedPredecessor(
  context: WitnessContext,
  current: WitnessTransaction,
  scopeId: string,
  gateId: string,
): Promise<void> {
  const workspace = workspaceFrom(current, context.options.workspaceIdentity);
  const scope = workspace.frontier.scopes.find((value) => value.scopeId === scopeId);
  if (!scope?.gateMembership.some((gate) => gate.gateId === gateId))
    throw new WitnessBlocked("scope_predecessor");
  const heads = workspace.frontier.writerHeads.filter((head) => head.gateId === gateId);
  const head = heads[0];
  if (heads.length !== 1 || head === undefined)
    throw new WitnessBlocked("scope_predecessor_order_unprovable");
  const bytes = await context.provider?.readWriterShard(scopeId, gateId, head.writerId);
  if (bytes === undefined || bytes === null) throw new WitnessBlocked("scope_predecessor");
  const records = bytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => validateReviewGateEventRecord(JSON.parse(line)));
  if (records.some((event) => "schemaVersion" in event)) {
    if (
      projectVerifiedGateTip({
        gateId,
        scopeId,
        events: records,
        frontier: workspace.frontier,
      }).status !== "completed"
    )
      throw new WitnessBlocked("scope_predecessor_unfinished");
  } else {
    const legacyRecords = records.filter(
      (event): event is Extract<VerifiedReviewGateEvent, ReviewGateEvent> =>
        !("schemaVersion" in event),
    );
    if (projectReviewGateState(legacyRecords).status !== "completed")
      throw new WitnessBlocked("scope_predecessor_unfinished");
  }
  const targets = await context.store.read("target", targetRegistrySchema);
  if (
    Object.values(targets.data.targets).some(
      (entry) => entry.authority.activeOwner?.gateId === gateId,
    )
  )
    throw new WitnessBlocked("scope_predecessor_writer_active");
}
export async function authorizeAdditionalScope(
  context: WitnessContext,
  input: Readonly<{
    scope: ScopeEnrollmentV1;
    operationId: string;
    authorize: (payload: unknown) => Promise<string>;
  }>,
): Promise<ScopeEnrollmentV1> {
  const proposed = scopeSchema.parse(input.scope);
  if (!scopeInstallationIdSchema.safeParse(input.operationId).success)
    throw new WitnessBlocked("scope_authorization");
  return withWitnessTransaction(context, async (current) => {
    const workspace = workspaceFrom(current, context.options.workspaceIdentity);
    await verifyWitnessJournals(context, workspace);
    if (Object.keys(current.data.pending).length !== 0)
      throw new WitnessBlocked("scope_publication_busy");
    const old = workspace.frontier.scopes.find((scope) => scope.scopeId === proposed.scopeId);
    let scope = proposed;
    if (old === undefined) {
      if (proposed.provenance.kind === "verified_genesis")
        throw new WitnessBlocked("scope_genesis_forbidden");
      if (proposed.provenance.kind === "verified_completed_successor") {
        if (
          proposed.provenance.priorScopeId === null ||
          proposed.provenance.priorGateId === null ||
          workspace.frontier.scopes.find(
            (prior) => prior.scopeId === proposed.provenance.priorScopeId,
          )?.workflowContinuityId !== proposed.workflowContinuityId
        )
          throw new WitnessBlocked("scope_continuity");
        await assertCompletedPredecessor(
          context,
          current,
          proposed.provenance.priorScopeId,
          proposed.provenance.priorGateId,
        );
      } else if (
        proposed.provenance.priorScopeId !== null ||
        proposed.provenance.priorGateId !== null ||
        workspace.frontier.scopes.some(
          (prior) => prior.workflowContinuityId === proposed.workflowContinuityId,
        )
      )
        throw new WitnessBlocked("scope_independence");
      const { evidenceDigest: _oldEvidence, ...provenance } = proposed.provenance;
      const evidenceDigest = computeCanonicalJsonFingerprint({
        installationId: current.installation.installationId,
        operationId: input.operationId,
        expectedWorkspaceFrontier: workspace.frontier.globalFrontierHash,
        scope: { ...proposed, provenance },
      });
      scope = { ...proposed, provenance: { ...provenance, evidenceDigest } };
      if (_oldEvidence.length !== 64) throw new WitnessBlocked("scope_evidence");
    } else {
      const { gateMembership: oldMembership, ...oldEnrollment } = old;
      const { gateMembership: proposedMembership, ...proposedEnrollment } = proposed;
      if (
        computeCanonicalJsonFingerprint(oldEnrollment) !==
          computeCanonicalJsonFingerprint(proposedEnrollment) ||
        oldMembership.some(
          (member) =>
            !proposedMembership.some(
              (candidate) =>
                computeCanonicalJsonFingerprint(candidate) ===
                computeCanonicalJsonFingerprint(member),
            ),
        )
      )
        throw new WitnessBlocked("scope_relabel");
      for (const gate of proposedMembership.filter(
        (member) => !oldMembership.some((prior) => prior.gateId === member.gateId),
      )) {
        if (gate.supersedesGateId === null) throw new WitnessBlocked("scope_predecessor");
        await assertCompletedPredecessor(context, current, old.scopeId, gate.supersedesGateId);
      }
    }
    const payload = {
      installationId: current.installation.installationId,
      workspaceIdentity: context.options.workspaceIdentity,
      operationId: input.operationId,
      expectedWorkspaceFrontier: workspace.frontier.globalFrontierHash,
      scope,
    };
    const prior = current.data.scopeAuthorizations[input.operationId];
    if (prior !== undefined) {
      const { signature: _signature, consumed: _consumed, ...priorPayload } = prior;
      if (
        computeCanonicalJsonFingerprint(priorPayload) !==
          computeCanonicalJsonFingerprint(payload) ||
        _consumed ||
        _signature.length === 0
      )
        throw new WitnessBlocked("scope_authorization_conflict");
      return prior.scope;
    }
    const signature = await input.authorize(payload);
    if (!hostProofValid(createPublicKey(current.installation.hostTrustRootPem), payload, signature))
      throw new WitnessBlocked("scope_authentication");
    await context.store.advance("scope", current, {
      ...current.data,
      scopeAuthorizations: {
        ...current.data.scopeAuthorizations,
        [input.operationId]: { ...payload, signature, consumed: false },
      },
    });
    return scope;
  });
}
export function verifyAdditionalScopeAuthorization(
  current: WitnessTransaction,
  scope: ScopeEnrollmentV1,
  expectedFrontier: string,
): void {
  const record = Object.values(current.data.scopeAuthorizations).find(
    (value) =>
      !value.consumed &&
      value.expectedWorkspaceFrontier === expectedFrontier &&
      computeCanonicalJsonFingerprint(value.scope) === computeCanonicalJsonFingerprint(scope),
  );
  if (record === undefined) throw new WitnessBlocked("scope_authority_required");
  const { signature, consumed: _consumed, ...payload } = record;
  if (
    _consumed ||
    !hostProofValid(createPublicKey(current.installation.hostTrustRootPem), payload, signature)
  )
    throw new WitnessBlocked("scope_authentication");
}
