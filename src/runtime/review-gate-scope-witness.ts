import type {
  VerifiedScopeFrontier,
  VerifiedTargetWriterHandoffIntentV1,
  ScopeEnrollmentV1,
} from "../core/review-gate/types.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import {
  createWitnessContext,
  verifyWitnessJournals,
  withAdmissionWitnessTransaction,
  withGateOwnedWitnessTransaction,
  withWitnessTransaction,
  workspaceFrom,
  type WitnessContext,
  type WitnessOptions,
  type WitnessTransaction,
} from "./review-gate-witness-context.js";
import {
  authorizeWorkspace,
  consumeFirstEnrollment,
  type FirstEnrollmentRequest,
} from "./review-gate-witness-enrollment.js";
import { createWitnessPublication } from "./review-gate-witness-publication.js";
import { readTrustedWitnessInstallation } from "./review-gate-witness-installation.js";
export { provisionReviewGateWitnessInstallation } from "./review-gate-witness-installation.js";
export type {
  AdmittedMembership,
  PreparedWitnessPublicationV1,
  TrustedFirstEnrollmentV1,
  TrustedWitnessInstallationV1,
} from "./review-gate-witness-contracts.js";
export type ReviewGateScopeWitnessOptions = WitnessOptions;
import {
  createTargetWriterHandoff,
  type NativeRevocationAuthorizer,
  } from "./review-gate-target-writer-handoff.js";
import { createTerminalTargetWriterRevoke } from "./review-gate-target-writer-revoke.js";
import { createTerminalIntentPublication } from "./review-gate-target-writer-closing-seal.js";
import { createTargetWriterEffect } from "./review-gate-target-writer-effect.js";
import { createCanonicalTargetEffectBroker } from "./review-gate-canonical-target-effect-broker.js";
import { targetRegistrySchema } from "./review-gate-target-writer-schema.js";
import type { AdmissionOwnedWitness } from "./review-gate-admission-context.js";
import { assertWitnessAdmissionOrder } from "./review-gate-lock-manager.js";
import { authorizeAdditionalScope } from "./review-gate-witness-scope-enrollment.js";

const contexts = new WeakMap<ReviewGateScopeWitness, WitnessContext>();
export type ReviewGateScopeWitness = ReturnType<typeof createReviewGateScopeWitness>;
export function createReviewGateScopeWitness(options: ReviewGateScopeWitnessOptions) {
  const context = createWitnessContext(options);
  const publication = createWitnessPublication(context);
  const handoff = createTargetWriterHandoff(context);
  const terminal = createTerminalTargetWriterRevoke(context);
  const closingSeal = createTerminalIntentPublication(context);
  async function recoverHandoff(
    input: Readonly<{
      intent: VerifiedTargetWriterHandoffIntentV1;
      epochId: string;
      authorizeNativeRevocation: NativeRevocationAuthorizer;
    }>,
  ) {
    await handoff.readPreparedTargetWriterHandoff(input.intent);
    await handoff.fencePreviousTargetWriter(input);
    return handoff.claimTargetWriterForGate(input);
  }
  const witness = Object.freeze({
    ...handoff,
    ...terminal,
    ...closingSeal,
    ...createTargetWriterEffect(context),
    ...createCanonicalTargetEffectBroker(context),
    recoverPreparedTargetWriterHandoff: recoverHandoff,
    fenceAndAdvanceReviewWriterLease: recoverHandoff,
    withGateOwnedWitnessTransaction: <T>(run: (current: WitnessTransaction) => Promise<T>) =>
      withGateOwnedWitnessTransaction(context, run),
    withAdmissionWitnessTransaction: <T>(
      request: Readonly<{
        readonly workspaceIdentity: string;
        readonly designPath: string;
        readonly planPath: string;
      }>,
      run: (owned: AdmissionOwnedWitness) => Promise<T>,
    ): Promise<T> => withAdmissionWitnessTransaction(context, request, run),
    async readVerifiedReviewWriterLease(scopeId: string, gateId: string, targetPath: string) {
      return withWitnessTransaction(context, async () => {
        const state = await context.store.read("target", targetRegistrySchema);
        const entry = Object.values(state.data.targets).find(
          (value) => value.authority.target.canonicalLogicalTargetPath === targetPath,
        );
        if (
          entry?.lease === null ||
          entry?.lease === undefined ||
          entry.authority.activeOwner?.scopeId !== scopeId ||
          entry.authority.activeOwner.gateId !== gateId
        )
          throw new WitnessBlocked("lease_missing");
        return entry.lease;
      });
    },
    ...publication,
    compareAndAdvance: publication.commitPreparedPublicationCAS,
    async readInstallation() {
      assertWitnessAdmissionOrder(context.lockManager);
      return context.store.withGuard("installation", async () =>
        readTrustedWitnessInstallation(context.store, options.hostTrustRoot),
      );
    },
    async readInstallationFrontierHash(): Promise<string> {
      return withWitnessTransaction(context, async (current) => current.hash);
    },
    async readWorkspaceScopeFrontier(
      workspaceIdentity = options.workspaceIdentity,
    ): Promise<VerifiedScopeFrontier> {
      if (workspaceIdentity !== options.workspaceIdentity)
        throw new WitnessBlocked("workspace_identity");
      return withWitnessTransaction(context, async (current) => {
        const workspace = workspaceFrom(current, workspaceIdentity);
        await verifyWitnessJournals(context, workspace);
        return workspace.frontier;
      });
    },
    verifyFirstWorkspaceEnrollment: (auth: Parameters<typeof consumeFirstEnrollment>[1]) =>
      consumeFirstEnrollment(context, auth),
    async acquireWorkspaceAdmissionGuard<T>(run: () => Promise<T>): Promise<T> {
      assertWitnessAdmissionOrder(context.lockManager);
      return context.store.withGuard("installation", run);
    },
    close(): void {
      if (options.lockManager === undefined) context.lockManager.close();
      context.provider?.close();
    },
  });
  contexts.set(witness, context);
  return witness;
}
export async function authorizeFirstWorkspaceEnrollment(
  input: FirstEnrollmentRequest & Readonly<{ witness: ReviewGateScopeWitness }>,
) {
  const context = contexts.get(input.witness);
  if (context === undefined) throw new WitnessBlocked("authentication");
  return authorizeWorkspace(context, input);
}
export async function authorizeScopeEnrollment(
  input: Readonly<{
    witness: ReviewGateScopeWitness;
    scope: ScopeEnrollmentV1;
    operationId: string;
    authorize: (payload: unknown) => Promise<string>;
  }>,
): Promise<ScopeEnrollmentV1> {
  const context = contexts.get(input.witness);
  if (context === undefined) throw new WitnessBlocked("authentication");
  return authorizeAdditionalScope(context, input);
}
