import { createPublicKey, type KeyObject } from "node:crypto";
import { realpathSync } from "node:fs";
import { relative, isAbsolute, resolve, sep } from "node:path";
import { observeGitWorkspace } from "./review-gate-scope-admission.js";
import {
  createLinuxReviewGateProvider,
  type LinuxReviewGateProvider,
} from "./linux-review-gate-provider.js";
import { ProtectedWitnessStore, WitnessBlocked } from "./review-gate-protected-store.js";
import { readTrustedWitnessInstallation } from "./review-gate-witness-installation.js";
import {
  scopeRegistrySchema,
  type ScopeRegistry,
  type ScopeWorkspace,
} from "./review-gate-witness-registry.js";
import type { TrustedWitnessInstallationV1 } from "./review-gate-witness-contracts.js";
import { verifyScopeFrontierMembership } from "./review-gate-witness-verification.js";
import { hostProofValid } from "./review-gate-witness-installation.js";
import {
  assertWitnessAdmissionOrder,
  createReviewGateLockManager,
  withWitnessScopeGateLocks,
  type ReviewGateLockManager,
} from "./review-gate-lock-manager.js";
import { computeArtifactDigest, computeReviewScopeId } from "../core/review-gate/identity.js";
import { validateFirstEnrollmentUnderAdmission } from "./review-gate-witness-enrollment.js";
import {
  commitPublicationUnlocked,
  preparePublicationUnlocked,
  publishPreparedJournalUnlocked,
  readPreparedPublication,
} from "./review-gate-publication-record.js";
import { publicationSchema } from "./review-gate-witness-registry.js";
import type { VerifiedScopeFrontier } from "../core/review-gate/types.js";
import {
  type AdmissionOwnedWitness,
  markAdmissionOwnedWitnessLive,
} from "./review-gate-admission-context.js";

export type WitnessOptions = Readonly<{
  workspaceRoot: string;
  workspaceIdentity: string;
  witnessDirectory?: string;
  hostTrustRoot?: KeyObject;
  lockManager?: ReviewGateLockManager;
  /**
   * Task 4d — signer for admitted membership authorizations. The witness
   * verifies the signature with its trusted installation root before the
   * registry records the scope authorization.
   */
  authorizeAdmittedMembership?: (payload: unknown) => Promise<string>;
}>;
export type WitnessContext = Readonly<{
  options: WitnessOptions;
  store: ProtectedWitnessStore;
  provider: LinuxReviewGateProvider | undefined;
  lockManager: ReviewGateLockManager;
}>;
export type WitnessTransaction = Readonly<{
  data: ScopeRegistry;
  hash: string;
  revision: number;
  installation: TrustedWitnessInstallationV1;
  repositoryIdentity: string;
}>;
export function createWitnessContext(options: WitnessOptions): WitnessContext {
  const directory = options.witnessDirectory ?? process.env["JUSTICE_REVIEW_GATE_WITNESS_DIR"];
  if (directory === undefined || !isAbsolute(directory)) throw new WitnessBlocked("protection");
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(options.workspaceRoot);
  } catch {
    throw new WitnessBlocked("workspace_identity");
  }
  const canonicalDirectory = resolve(directory);
  const child = relative(workspaceRoot, canonicalDirectory);
  const parent = relative(canonicalDirectory, workspaceRoot);
  const isSameOrDescendant = (candidate: string): boolean =>
    candidate === "" ||
    (candidate !== ".." && !candidate.startsWith(`..${sep}`) && !isAbsolute(candidate));
  if (isSameOrDescendant(child) || isSameOrDescendant(parent))
    throw new WitnessBlocked("protection");
  const provider = createLinuxReviewGateProvider(workspaceRoot);
  if (provider === undefined) throw new WitnessBlocked("native_unavailable");
  return {
    options: Object.freeze({ ...options, workspaceRoot }),
    store: new ProtectedWitnessStore(directory),
    provider,
    lockManager: options.lockManager ?? createReviewGateLockManager(workspaceRoot, { provider }),
  };
}
export async function withWitnessTransaction<T>(
  context: WitnessContext,
  run: (current: WitnessTransaction) => Promise<T>,
  ids: Readonly<{ scopeIds: readonly string[]; gateIds: readonly string[] }> = {
    scopeIds: [],
    gateIds: [],
  },
): Promise<T> {
  assertWitnessAdmissionOrder(context.lockManager);
  try {
    return await context.store.withGuard("installation", async () => {
      const installation = await readTrustedWitnessInstallation(
        context.store,
        context.options.hostTrustRoot,
      );
      const observed = await observeGitWorkspace(context.options.workspaceRoot);
      if (observed.workspaceIdentity !== context.options.workspaceIdentity)
        throw new WitnessBlocked("workspace_identity");
      const current = await context.store.read("scope", scopeRegistrySchema);
      if (current.data.installationId !== installation.installationId)
        throw new WitnessBlocked("registry_invalid");
      return withWitnessScopeGateLocks(context.lockManager, ids, async () =>
        run({ ...current, installation, repositoryIdentity: observed.repositoryIdentity }),
      );
    });
  } catch (error: unknown) {
    if (error instanceof WitnessBlocked) throw error;
    if (error instanceof Error && error.message === "review_gate_witness_busy_retryable")
      throw new WitnessBlocked("busy_retryable");
    throw new WitnessBlocked("host_io");
  }
}

/**
 * Owned admission transaction (Task 3).
 *
 * Acquires the installation guard once, authenticates the installation/
 * repository/registry, discovers the related scope/Gate lock set from the
 * authenticated registry (plus the tentative requested scope), and runs the
 * callback with the non-serializable `AdmissionOwnedWitness` while every
 * guard is held: sorted scopes, then sorted Gates, release in reverse in
 * `finally`. The owned capability is unusable after the callback exit and
 * rejects scope/Gate ids outside the owned lock set.
 */
export async function withAdmissionWitnessTransaction<T>(
  context: WitnessContext,
  request: Readonly<{
    readonly workspaceIdentity: string;
    readonly designPath: string;
    readonly planPath: string;
    readonly authorizeAdmittedMembership?: (payload: unknown) => Promise<string>;
  }>,
  run: (owned: AdmissionOwnedWitness) => Promise<T>,
): Promise<T> {
  assertWitnessAdmissionOrder(context.lockManager);
  let runFailed = false;
  try {
    return await context.store.withGuard("installation", async () => {
      const installation = await readTrustedWitnessInstallation(
        context.store,
        context.options.hostTrustRoot,
      );
      const observed = await observeGitWorkspace(context.options.workspaceRoot);
      if (observed.workspaceIdentity !== context.options.workspaceIdentity)
        throw new WitnessBlocked("workspace_identity");
      const current = await context.store.read("scope", scopeRegistrySchema);
      if (current.data.installationId !== installation.installationId)
        throw new WitnessBlocked("registry_invalid");

      // Discover the owned lock set from the authenticated registry: the
      // requested scope (tentative under installation ownership before any
      // enrollment) plus every enrolled related scope and their Gates.
      const scopeIds = new Set<string>([
        computeReviewScopeId(request.designPath, request.planPath),
      ]);
      const gateIds = new Set<string>();
      const workspace = current.data.workspaces[request.workspaceIdentity];
      if (workspace !== undefined && workspace.repositoryIdentity === observed.repositoryIdentity) {
        for (const scope of workspace.frontier.scopes) {
          scopeIds.add(scope.scopeId);
          for (const gate of scope.gateMembership) gateIds.add(gate.gateId);
        }
      }

      let released = false;
      const assertLive = (): void => {
        if (released) throw new Error("review_gate_admission_owned_witness_released");
      };
      const readOwnedFrontier = async (): Promise<VerifiedScopeFrontier> => {
        assertLive();
        const owned = await context.store.read("scope", scopeRegistrySchema);
        if (owned.data.installationId !== installation.installationId)
          throw new WitnessBlocked("registry_invalid");
        const ownedWorkspace = workspaceFrom(
          { ...owned, installation, repositoryIdentity: observed.repositoryIdentity },
          request.workspaceIdentity,
        );
        await verifyWitnessJournals(context, ownedWorkspace);
        return ownedWorkspace.frontier;
      };
      const owned: AdmissionOwnedWitness = Object.freeze({
        read: async () => {
          assertLive();
          const snapshot = await context.store.read("scope", scopeRegistrySchema);
          if (snapshot.data.installationId !== installation.installationId)
            throw new WitnessBlocked("registry_invalid");
          return { ...snapshot, installation, repositoryIdentity: observed.repositoryIdentity };
        },
        readVerifiedFrontier: readOwnedFrontier,
        readFirstEnrollmentAuthority: async () => {
          assertLive();
          const snapshot = await context.store.read("scope", scopeRegistrySchema);
          if (snapshot.data.installationId !== installation.installationId)
            throw new WitnessBlocked("registry_invalid");
          const snapshotWorkspace = snapshot.data.workspaces[request.workspaceIdentity];
          if (snapshotWorkspace === undefined || snapshotWorkspace.enrollmentState !== "pending") {
            return null;
          }
          return snapshotWorkspace.authorization.authority;
        },
        consumeFirstEnrollmentAuthority: async (authorizationEventId) => {
          assertLive();
          const snapshot = await context.store.read("scope", scopeRegistrySchema);
          const workspace = snapshot.data.workspaces[request.workspaceIdentity];
          if (
            workspace === undefined ||
            workspace.enrollmentState !== "pending" ||
            workspace.authorization.authority.authorizationEventId !== authorizationEventId
          ) throw new WitnessBlocked("nonce_consumed");
          const transaction = {
            ...snapshot,
            installation,
            repositoryIdentity: observed.repositoryIdentity,
          };
          await validateFirstEnrollmentUnderAdmission(context, transaction, workspace.authorization);
          await context.store.advance("scope", transaction, {
            ...transaction.data,
            workspaces: {
              ...transaction.data.workspaces,
              [request.workspaceIdentity]: { ...workspace, enrollmentState: "consumed" },
            },
            nonces: {
              ...transaction.data.nonces,
              [workspace.authorization.workflowNonce]: "consumed",
            },
          });
        },
        readInstallation: async () => {
          assertLive();
          return installation;
        },
        assertOwnedScope: (scopeId: string) => {
          assertLive();
          if (!scopeIds.has(scopeId)) {
            throw new Error("review_gate_admission_owned_scope_foreign");
          }
        },
        assertOwnedGate: (gateId: string) => {
          assertLive();
          if (!gateIds.has(gateId)) {
            throw new Error("review_gate_admission_owned_gate_foreign");
          }
        },
        preparePublication: async (untrusted, bytes) => {
          assertLive();
          const input = publicationSchema.parse(untrusted);
          if (!scopeIds.has(input.scopeId) ||
            (!gateIds.has(input.gateId) && input.firstEnrollmentAuthorizationId === null))
            throw new Error("review_gate_admission_owned_publication_foreign");
          const current = await owned.read();
          return preparePublicationUnlocked(context, current, input, Buffer.from(bytes));
        },
        publishPreparedJournal: async (publicationId) => {
          assertLive();
          const prepared = await readPreparedPublication(context, await owned.read(), publicationId);
          if (
            !scopeIds.has(prepared.input.scopeId) ||
            (!gateIds.has(prepared.input.gateId) && prepared.input.firstEnrollmentAuthorizationId === null)
          )
            throw new Error("review_gate_admission_owned_publication_foreign");
          return publishPreparedJournalUnlocked(context, await owned.read(), publicationId);
        },
        commitPreparedPublicationCAS: async (input) => {
          assertLive();
          const current = await owned.read();
          const prepared = await readPreparedPublication(context, current, input.publicationId);
          if (
            !scopeIds.has(prepared.input.scopeId) ||
            (!gateIds.has(prepared.input.gateId) && prepared.input.firstEnrollmentAuthorizationId === null)
          )
            throw new Error("review_gate_admission_owned_publication_foreign");
          return commitPublicationUnlocked(context, current, input);
        },
        recoverPreparedPublication: async (publicationId) => {
          assertLive();
          let current = await owned.read();
          const prepared = await readPreparedPublication(context, current, publicationId);
          if (
            !scopeIds.has(prepared.input.scopeId) ||
            (!gateIds.has(prepared.input.gateId) && prepared.input.firstEnrollmentAuthorizationId === null)
          ) {
            throw new Error("review_gate_admission_owned_publication_foreign");
          }
          if (current.data.committed[publicationId] === undefined) {
            const prior = await context.provider?.readWriterShard(
              prepared.input.scopeId,
              prepared.input.gateId,
              prepared.input.writerId,
            );
            if (prior?.equals(prepared.bytes) !== true) {
              const priorHash = prior === null || prior === undefined
                ? "0".repeat(64)
                : computeArtifactDigest(prior);
              if (priorHash !== prepared.input.expectedWriterHash) return "blocked";
              await publishPreparedJournalUnlocked(context, current, publicationId);
              current = await owned.read();
            }
          }
          return commitPublicationUnlocked(context, current, {
            publicationId,
            expectedGlobalFrontier: prepared.input.expectedGlobalFrontier,
            expectedWriterHash: prepared.input.expectedWriterHash,
          });
        },
        signAdmittedMembership: async (payload) => {
          assertLive();
          owned.assertOwnedScope(payload.scope.scopeId);
          const signer = context.options.authorizeAdmittedMembership;
          if (signer === undefined) {
            throw new WitnessBlocked("membership_authority_unavailable");
          }
          const signature = await signer(payload);
          const hostKey = createPublicKey(installation.hostTrustRootPem);
          if (!hostProofValid(hostKey, payload, signature)) {
            throw new WitnessBlocked("membership_authentication");
          }
          return signature;
        },
      });
      markAdmissionOwnedWitnessLive(owned);

      try {
        return await withWitnessScopeGateLocks(
          context.lockManager,
          { scopeIds: [...scopeIds], gateIds: [...gateIds] },
          async () => {
            try {
              return await run(owned);
            } catch (error) {
              // The callback's own failure propagates as-is after every
              // guard releases; only the guard/registry phases map to
              // WitnessBlocked codes.
              runFailed = true;
              throw error;
            } finally {
              released = true;
            }
          },
        );
      } finally {
        released = true;
      }
    });
  } catch (error: unknown) {
    if (runFailed) throw error;
    if (error instanceof WitnessBlocked) throw error;
    if (error instanceof Error && error.message === "review_gate_witness_busy_retryable")
      throw new WitnessBlocked("busy_retryable");
    throw new WitnessBlocked("host_io");
  }
}
/**
 * Gate-owned protected witness transaction.
 *
 * Identical protected-store, installation, workspace-identity, and
 * registry-CAS discipline to `withWitnessTransaction`, but designed for the
 * coordinator that already holds the workspace/scope/Gate admission locks:
 * it never enforces the admission order and never re-acquires the scope or
 * Gate locks. The caller owns that higher-level admission authority; every
 * registry mutation still goes through the protected store's CAS `advance`.
 */
export async function withGateOwnedWitnessTransaction<T>(
  context: WitnessContext,
  run: (current: WitnessTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await context.store.withGuard("installation", async () => {
      const installation = await readTrustedWitnessInstallation(
        context.store,
        context.options.hostTrustRoot,
      );
      const observed = await observeGitWorkspace(context.options.workspaceRoot);
      if (observed.workspaceIdentity !== context.options.workspaceIdentity)
        throw new WitnessBlocked("workspace_identity");
      const current = await context.store.read("scope", scopeRegistrySchema);
      if (current.data.installationId !== installation.installationId)
        throw new WitnessBlocked("registry_invalid");
      return run({ ...current, installation, repositoryIdentity: observed.repositoryIdentity });
    });
  } catch (error: unknown) {
    if (error instanceof WitnessBlocked) throw error;
    if (error instanceof Error && error.message === "review_gate_witness_busy_retryable")
      throw new WitnessBlocked("busy_retryable");
    throw new WitnessBlocked("host_io");
  }
}
export function workspaceFrom(current: WitnessTransaction, identity: string): ScopeWorkspace {
  const workspace = current.data.workspaces[identity];
  if (workspace === undefined || workspace.repositoryIdentity !== current.repositoryIdentity)
    throw new WitnessBlocked("enrollment_missing");
  verifyScopeFrontierMembership(workspace.frontier);
  return workspace;
}
export async function verifyWitnessJournals(
  context: WitnessContext,
  workspace: ScopeWorkspace,
): Promise<void> {
  const provider = context.provider;
  if (provider === undefined) throw new WitnessBlocked("journal_native_unavailable");
  const expected: string[] = [];
  for (const head of workspace.frontier.writerHeads) {
    const bytes = await provider.readWriterShard(head.scopeId, head.gateId, head.writerId);
    if (bytes === null || computeArtifactDigest(bytes) !== head.hash)
      throw new WitnessBlocked("journal_missing_or_tampered");
    try {
      if (!(await context.store.readBytes(`journal-${head.hash}.bin`)).equals(bytes))
        throw new WitnessBlocked("journal_missing_or_tampered");
    } catch (error: unknown) {
      if (error instanceof WitnessBlocked) throw new WitnessBlocked("journal_missing_or_tampered");
      throw error;
    }
    expected.push(`${head.scopeId}/${head.gateId}/${head.writerId}`);
  }
  const actual: string[] = [];
  for (const scope of await provider.listScopeIds())
    for (const gate of await provider.listGateIds(scope))
      for (const writer of await provider.listWriterIds(scope, gate))
        actual.push(`${scope}/${gate}/${writer}`);
  if (actual.sort().join("\0") !== expected.sort().join("\0"))
    throw new WitnessBlocked("journal_orphan_membership");
}
