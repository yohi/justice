import type { KeyObject } from "node:crypto";
import { realpathSync } from "node:fs";
import { relative, isAbsolute } from "node:path";
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
import { computeArtifactDigest } from "../core/review-gate/identity.js";
import { verifyScopeFrontierMembership } from "./review-gate-witness-verification.js";
import {
  assertWitnessAdmissionOrder,
  createReviewGateLockManager,
  withWitnessScopeGateLocks,
  type ReviewGateLockManager,
} from "./review-gate-lock-manager.js";

export type WitnessOptions = Readonly<{
  workspaceRoot: string;
  workspaceIdentity: string;
  witnessDirectory?: string;
  hostTrustRoot?: KeyObject;
  lockManager?: ReviewGateLockManager;
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
  const child = relative(workspaceRoot, directory);
  if (child === "" || (child !== ".." && !child.startsWith("../") && !isAbsolute(child)))
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
