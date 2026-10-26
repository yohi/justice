import { execFile } from "node:child_process";
import { createHash, type KeyObject } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";
import type { ReviewScopeId } from "../core/review-gate-types.js";
import {
  computeVerifiedContextDigest,
  planReviewGateAdmission,
  type AdmissionDecision,
  type AdmissionBlockReason,
  type VerifiedAdmissionSnapshot,
  type VerifiedGateTip,
  type VerifiedNC1EligibleChangeV1,
  type VerifiedNC1StopV1,
} from "../core/review-gate/admission.js";
import {
  computeArtifactDigest,
  computeCanonicalJsonFingerprint,
  computeRepositoryIdentity,
  computeReviewScopeId,
  computeWorkspaceIdentity,
} from "../core/review-gate/identity.js";
import type {
  VerifiedFirstEnrollmentAuthorityV1,
  VerifiedScopeFrontier,
} from "../core/review-gate/types.js";
import {
  ScopeAdmissionBlocked,
  protectedScopeSnapshotSchema,
  scopeAdmissionRequestSchema,
  scopeIdentitySchema,
  scopeInstallationIdSchema,
  verifyProvisionerSignature,
  verifyScopeFrontierMembership,
} from "./review-gate-witness-verification.js";
import {
  type ReviewGateAdmissionObservation,
  type AdmissionOwnedWitness,
  observeVerifiedAdmissionSnapshotOwned,
} from "./review-gate-admission-context.js";
import type { DurableReviewGateEventStore } from "./review-gate-event-store.js";
import { WitnessBlocked } from "./review-gate-protected-store.js";
import type { ReviewGateLockManager } from "./review-gate-lock-manager.js";
import type { ReviewGateProtocolDescriptor } from "./review-gate-protocol.js";
import type { VerifiedProtocolReleaseProvider as ProtocolReleaseProviderAuthority } from "./review-gate-protocol-release-authority.js";
import type { resolveRequirementsForAdmission } from "./review-gate-requirements.js";
import { runGitLiteral } from "./review-gate-query.js";
import type { ReviewGateScopeWitness } from "./review-gate-scope-witness.js";

/** Independently installed host capability, never exposed to workers.
 * The host must read live, rollback-protected installation-wide state under an
 * OS-enforced guard, including journal membership/alias checks. A signature alone
 * does not prove freshness or isolation. Missing/corrupt state must throw.
 */
export type ProtectedScopeAdmissionHost = Readonly<{
  withWorkspaceAdmissionGuard<T>(run: () => Promise<T>): Promise<T>;
  readCurrentProtectedFrontier(): Promise<unknown>;
}>;
export type ScopeAdmissionOptions = Readonly<{
  workspaceRoot: string;
  installationId: string;
  provisionerPublicKey: KeyObject;
  host: ProtectedScopeAdmissionHost;
}>;
export type ReviewGateScopeAdmissionVerifier = Readonly<{
  readWorkspaceScopeFrontier(): Promise<VerifiedScopeFrontier>;
  verifyFirstWorkspaceEnrollment(input: unknown): Promise<VerifiedFirstEnrollmentAuthorityV1>;
}>;
const gitExec = promisify(execFile);

async function git(root: string, args: readonly string[]): Promise<string> {
  try {
    // Ignore inherited Git redirection, alternate object databases and config.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );
    const result = await gitExec(
      "git",
      ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", root, ...args],
      {
        env,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      },
    );
    return result.stdout.trim();
  } catch (error: unknown) {
    if (error instanceof Error) throw new ScopeAdmissionBlocked("workspace_identity");
    throw error;
  }
}

/** Only Git-discovered canonical roots are hashed; no host path leaves this API.
 * HEAD is deliberately not identity: normal commits must not reset enrollment.
 */
export async function observeGitWorkspaceIdentity(workspaceRoot: string): Promise<string> {
  return (await observeGitWorkspace(workspaceRoot)).workspaceIdentity;
}

export async function observeGitWorkspace(
  workspaceRoot: string,
): Promise<Readonly<{ workspaceIdentity: string; repositoryIdentity: string }>> {
  try {
    const root = await realpath(await git(workspaceRoot, ["rev-parse", "--show-toplevel"]));
    if (root !== (await realpath(workspaceRoot)))
      throw new ScopeAdmissionBlocked("workspace_identity");
    const common = await realpath(
      await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    );
    return Object.freeze({
      workspaceIdentity: computeWorkspaceIdentity(root),
      repositoryIdentity: computeRepositoryIdentity(common),
    });
  } catch (error: unknown) {
    if (error instanceof Error) throw new ScopeAdmissionBlocked("workspace_identity");
    throw error;
  }
}

/** Read-only witness verifier. It cannot provision, enroll or reset history.
 * The pinned key/installation and host capability are trusted composition inputs,
 * not caller-supplied evidence. DEP-02 host deployment remains a prerequisite.
 */
export function createReviewGateScopeAdmissionVerifier(
  options: ScopeAdmissionOptions,
): ReviewGateScopeAdmissionVerifier {
  const { workspaceRoot, installationId, provisionerPublicKey, host } = options;
  if (
    provisionerPublicKey.type !== "public" ||
    provisionerPublicKey.asymmetricKeyType !== "ed25519" ||
    !scopeInstallationIdSchema.safeParse(installationId).success
  ) {
    throw new ScopeAdmissionBlocked("proof");
  }
  const provisionerDigest = createHash("sha256")
    .update(provisionerPublicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await host.withWorkspaceAdmissionGuard(run);
    } catch (error: unknown) {
      if (error instanceof ScopeAdmissionBlocked) throw error;
      if (error instanceof Error) throw new ScopeAdmissionBlocked("protected_frontier");
      throw error;
    }
  }
  async function readFrontier(workspaceIdentity: string): Promise<VerifiedScopeFrontier> {
    const parsed = protectedScopeSnapshotSchema.safeParse(
      await host.readCurrentProtectedFrontier(),
    );
    if (!parsed.success) throw new ScopeAdmissionBlocked("protected_frontier");
    const { signature, ...payload } = parsed.data;
    if (
      payload.installationId !== installationId ||
      payload.frontier.workspaceIdentity !== workspaceIdentity ||
      !verifyProvisionerSignature(provisionerPublicKey, {
        domain: "justice-scope-frontier-v1",
        payload,
        signature,
      })
    )
      throw new ScopeAdmissionBlocked("protected_frontier");
    verifyScopeFrontierMembership(payload.frontier);
    return payload.frontier;
  }
  return Object.freeze({
    async readWorkspaceScopeFrontier(): Promise<VerifiedScopeFrontier> {
      return guarded(async () => readFrontier(await observeGitWorkspaceIdentity(workspaceRoot)));
    },
    async verifyFirstWorkspaceEnrollment(
      input: unknown,
    ): Promise<VerifiedFirstEnrollmentAuthorityV1> {
      return guarded(async () => {
        const workspaceIdentity = await observeGitWorkspaceIdentity(workspaceRoot);
        const identityInput = z.object({ workspaceIdentity: scopeIdentitySchema }).safeParse(input);
        if (!identityInput.success || identityInput.data.workspaceIdentity !== workspaceIdentity)
          throw new ScopeAdmissionBlocked("workspace_identity");
        const parsed = scopeAdmissionRequestSchema.safeParse(input);
        if (!parsed.success) throw new ScopeAdmissionBlocked("proof");
        const request = parsed.data;
        const frontier = await readFrontier(workspaceIdentity);
        if (frontier.scopes.length !== 0 || frontier.writerHeads.length !== 0)
          throw new ScopeAdmissionBlocked("prior_enrollment");
        const { authority, signature } = request.proof;
        if (
          !verifyProvisionerSignature(provisionerPublicKey, {
            domain: "justice-first-enrollment-v1",
            payload: authority,
            signature,
          }) ||
          authority.installationId !== installationId ||
          authority.workspaceIdentity !== workspaceIdentity ||
          authority.authenticatedProvisionerDigest !== provisionerDigest ||
          authority.authorizationOperationId !== request.authorizationOperationId ||
          authority.canonicalDesignPath !== request.canonicalDesignPath ||
          authority.canonicalPlanPath !== request.canonicalPlanPath ||
          authority.verifiedAbsentPriorEnrollmentFrontierHash !== frontier.globalFrontierHash
        )
          throw new ScopeAdmissionBlocked("proof");
        const head = (
          await runGitLiteral(workspaceRoot, ["rev-parse", "--verify", "HEAD"])
        )
          .stdout.toString("utf8")
          .trim();
        if (!HEAD_OID_PATTERN.test(head))
          throw new ScopeAdmissionBlocked("workspace_identity");
        const diff = await runGitLiteral(workspaceRoot, [
          "diff",
          "--quiet",
          "HEAD",
          "--",
          request.canonicalDesignPath,
          request.canonicalPlanPath,
        ]);
        if (diff.code !== 0) throw new ScopeAdmissionBlocked("target_dirty");
        return authority;
      });
    },
  });
}


// ---------------------------------------------------------------------------
// Task 18 — Runtime-only Review Gate scope admission factory
// ---------------------------------------------------------------------------

export type ScopeAdmissionRequest = Readonly<{
  readonly workspaceRoot: string;
  readonly workspaceIdentity: string;
  readonly designPath: string;
  readonly planPath: string;
  readonly explicitRequirementsPath?: string;
  readonly protocol: ReviewGateProtocolDescriptor;
}>;

export interface ReviewGateScopeAdmission {
  withAdmissionLease<T>(
    request: ScopeAdmissionRequest,
    run: (
      decision: AdmissionDecision,
      observation: ReviewGateAdmissionObservation | null,
      owned: AdmissionOwnedWitness,
    ) => Promise<T>,
  ): Promise<T>;
}

/** Workspace byte seam for admission snapshot observation. */
export interface ReviewGateScopeWorkspaceReader {
  readonly readWorkspaceFile: (path: string) => Promise<Buffer | null>;
}

export interface ReviewGateScopeAdmissionOptions {
/**
* The one protected workspace scope witness of the shared runtime graph.
* A `null` witness means the trusted installation is unavailable; admission
* fail-closed with `ScopeAdmissionBlocked("witness_unavailable")`.
*/
readonly witness: ReviewGateScopeWitness | null;
readonly eventStore: DurableReviewGateEventStore;
readonly lockManager: ReviewGateLockManager;
readonly workspaceReader: ReviewGateScopeWorkspaceReader;
readonly requirementsResolver: typeof resolveRequirementsForAdmission;
/** Verified protocol release authority for NC1 protocol-kind candidates. */
  readonly protocolRelease?: ProtocolReleaseProviderAuthority | null;
  /**
   * Task 4d — signer for admitted membership authorizations. The witness
   * verifies the produced signature against the trusted installation root.
   */
  readonly authorizeAdmittedMembership?: (payload: unknown) => Promise<string>;
}


/** Deterministic legacy-surface generation identity for V1-only histories. */
const freezeDecision = (value: AdmissionDecision): AdmissionDecision =>
  Object.freeze(value) as AdmissionDecision;

const blockReason = (
  reason: AdmissionBlockReason,
  detail: string,
): AdmissionDecision => freezeDecision({ kind: "BLOCK", reason, detail });

type UnfinishedTip = Extract<VerifiedGateTip, { readonly status: "active" | "suspended" }>;

/** Minimal comparable verified-context shape for dimension detection. */
type ComparableContext = Readonly<{
  readonly requirements: Readonly<{ readonly digest: string }>;
  readonly design: Readonly<{ readonly digest: string }>;
  readonly plan: Readonly<{ readonly digest: string }>;
  readonly globalProtocolFingerprint: string;
  readonly designProtocolFingerprint: string;
  readonly planProtocolFingerprint: string;
}>;

/** First differing verified-context dimension, in Core planner order. */
function changedDimension(binding: ComparableContext, current: ComparableContext):
  | "requirements"
  | "design"
  | "plan"
  | "design_protocol"
  | "plan_protocol"
  | "global_protocol"
  | null {
  if (binding.requirements.digest !== current.requirements.digest) return "requirements";
  if (binding.design.digest !== current.design.digest) return "design";
  if (binding.plan.digest !== current.plan.digest) return "plan";
  if (binding.globalProtocolFingerprint !== current.globalProtocolFingerprint) return "global_protocol";
  if (binding.designProtocolFingerprint !== current.designProtocolFingerprint) return "design_protocol";
  if (binding.planProtocolFingerprint !== current.planProtocolFingerprint) return "plan_protocol";
  return null;
}

const HEAD_OID_PATTERN = /^[0-9a-f]{40,64}$/u;

const NC1_CHANGE_DOMAIN = "justice-review-gate-nc1-change-v1";

async function gitOutput(rootReal: string, args: readonly string[]): Promise<Buffer> {
  const result = await runGitLiteral(rootReal, args);
  if (result.code !== 0) throw new Error("review_gate_scope_admission_git_unavailable");
  return result.stdout;
}

interface GitTreeEntry {
  readonly gitMode: "100644" | "100755";
  readonly blobSha: string;
}

function parseBlobTreeEntry(stdout: Buffer, canonicalPath: string): GitTreeEntry | null {
  for (const record of stdout.toString("utf8").split("\0")) {
    if (record.length === 0) continue;
    const [meta = "", entryPath = ""] = record.split("\t", 2);
    if (entryPath !== canonicalPath) continue;
    const [gitMode = "", type = "", blobSha = ""] = meta.split(" ");
    if (type !== "blob") return null;
    if (gitMode !== "100644" && gitMode !== "100755") return null;
    return { gitMode, blobSha };
  }
  return null;
}

export function isNc1ParentArtifactBindingValid(input: Readonly<{
  artifactKind: "requirements" | "design" | "plan";
  parentBlobBytes: Uint8Array;
  parentBlobOid: string;
  beforeArtifactDigest: string;
  beforeGitBlobOid: string;
}>): boolean {
  return (
    computeArtifactDigest(input.parentBlobBytes) === input.beforeArtifactDigest &&
    (input.artifactKind !== "requirements" ||
      input.parentBlobOid === input.beforeGitBlobOid)
  );
}

/**
 * Create the Runtime-only Review Gate scope admission factory.
 *
 * The factory is the single admission orchestrator of the `/justice-review-gate`
 * runtime loop: every start/resume first takes the scope admission lease,
 * observes verified material, and lets Core `planReviewGateAdmission` decide —
 * twice, once with `NOT_INSPECTED` and once after NC1 inspection — before the
 * decision reaches the caller. Core owns the decision; the factory owns only
 * lease/inspection I/O; the caller owns I/O, mutation and dispatch.
 */
export function createReviewGateScopeAdmission(
  options: ReviewGateScopeAdmissionOptions,
): ReviewGateScopeAdmission {
  const {
    witness,
    eventStore,
    lockManager,
    workspaceReader,
    requirementsResolver,
    protocolRelease,
  } = options;
  void requirementsResolver; // pinned seam: admission snapshot observation resolves through §10.2.3


  type Nc1Inspection =
    | Readonly<{ readonly ok: true; readonly candidate: VerifiedNC1EligibleChangeV1 | null }>
    | Readonly<{ readonly ok: false; readonly error: string }>;

  const contextDigestOfCurrent = (snapshot: VerifiedAdmissionSnapshot): string =>
    computeVerifiedContextDigest({
      requirements: {
        ...snapshot.current.requirements,
        selectedByEventId: snapshot.current.requirements.observationEvidenceId,
      },
      design: snapshot.current.design,
      plan: snapshot.current.plan,
      globalProtocolFingerprint: snapshot.current.globalProtocolFingerprint,
      designProtocolFingerprint: snapshot.current.designProtocolFingerprint,
      planProtocolFingerprint: snapshot.current.planProtocolFingerprint,
    });

  const verifyNc1ArtifactChange = async (
    request: ScopeAdmissionRequest,
    snapshot: VerifiedAdmissionSnapshot,
    tip: UnfinishedTip,
    stop: VerifiedNC1StopV1,
    dimension: "requirements" | "design" | "plan",
  ): Promise<Nc1Inspection> => {
    const ctx = tip.lastVerifiedBinding.effective.context;
    const rootReal = await realpath(request.workspaceRoot);
    const changedPath =
      dimension === "requirements"
        ? snapshot.current.requirements.canonicalPath
        : dimension === "design"
          ? snapshot.current.design.canonicalPath
          : snapshot.current.plan.canonicalPath;
    const headOid = (await gitOutput(rootReal, ["rev-parse", "--verify", "HEAD"]))
      .toString("utf8")
      .trim();
    if (!HEAD_OID_PATTERN.test(headOid)) {
      return { ok: false, error: "The workspace HEAD could not be pinned for NC1 inspection." };
    }
    const headEntry = parseBlobTreeEntry(
      await gitOutput(rootReal, ["ls-tree", "-z", headOid, "--", changedPath]),
      changedPath,
    );
    if (headEntry === null) {
      return { ok: false, error: "The changed artifact is not committed at HEAD." };
    }
    const worktreeBlob = (await gitOutput(rootReal, ["hash-object", changedPath]))
      .toString("utf8")
      .trim();
    if (worktreeBlob !== headEntry.blobSha) {
      return { ok: false, error: "The changed artifact is not clean against its committed HEAD entry." };
    }
    let parentOid: string;
    try {
      parentOid = (await gitOutput(rootReal, ["rev-parse", "--verify", `${headOid}^`]))
        .toString("utf8")
        .trim();
    } catch {
      return { ok: false, error: "The committed artifact change has no parent to verify a before-state." };
    }
    if (!HEAD_OID_PATTERN.test(parentOid)) {
      return { ok: false, error: "The parent commit of the artifact change is not a valid Git object." };
    }
    const parentEntry = parseBlobTreeEntry(
      await gitOutput(rootReal, ["ls-tree", "-z", parentOid, "--", changedPath]),
      changedPath,
    );
    if (parentEntry === null) {
      return { ok: false, error: "The parent commit does not carry the changed artifact." };
    }

    const beforeArtifactDigest =
      dimension === "requirements"
        ? ctx.requirements.digest
        : dimension === "design"
          ? ctx.design.digest
          : ctx.plan.digest;
    const afterArtifactDigest =
      dimension === "requirements"
        ? snapshot.current.requirements.digest
        : dimension === "design"
          ? snapshot.current.design.digest
          : snapshot.current.plan.digest;
    const beforeGitBlobOid =
      dimension === "requirements"
        ? ctx.requirements.gitBlobOid
        : parentEntry.blobSha;
    const parentBlobBytes = await gitOutput(rootReal, [
      "cat-file",
      "blob",
      parentEntry.blobSha,
    ]);
    if (
      !isNc1ParentArtifactBindingValid({
        artifactKind: dimension,
        parentBlobBytes,
        parentBlobOid: parentEntry.blobSha,
        beforeArtifactDigest,
        beforeGitBlobOid,
      })
    ) {
      return { ok: false, error: "The parent artifact does not match the recorded NC1 before-state." };
    }
    const afterGitBlobOid =
      dimension === "requirements"
        ? snapshot.current.requirements.gitBlobOid
        : headEntry.blobSha;
    const afterGitMode =
      dimension === "requirements"
        ? snapshot.current.requirements.gitMode
        : dimension === "design"
          ? snapshot.current.design.gitMode
          : snapshot.current.plan.gitMode;
    if (headEntry.gitMode !== afterGitMode) {
      return { ok: false, error: "The committed artifact Git mode does not match the current binding." };
    }
    if (dimension === "requirements") {
      const committedOid = snapshot.current.requirements.observedCommitOid;
      if (committedOid !== headOid) {
        return { ok: false, error: "The observed requirements commit is not the current HEAD; the observation is stale." };
      }
    }

    const changeObservedEventId = computeCanonicalJsonFingerprint({
      domain: NC1_CHANGE_DOMAIN,
      kind: "artifact",
      artifactKind: dimension,
      changedPath,
      beforeArtifactDigest,
      afterArtifactDigest,
      committedGitOid: headOid,
    });
    const observationOperationId = computeCanonicalJsonFingerprint({
      domain: NC1_CHANGE_DOMAIN,
      observationOf: stop.stoppedContextDigest,
      stopEventId: stop.stopEventId,
      committedGitOid: headOid,
    });

    return {
      ok: true,
      candidate: Object.freeze<VerifiedNC1EligibleChangeV1>({
        gateId: tip.gateId,
        generationId: tip.generationId,
        phase: stop.phase,
        nc1StopEventId: stop.stopEventId,
        beforeContextDigest: stop.stoppedContextDigest,
        afterContextDigest: contextDigestOfCurrent(snapshot),
        changeObservedEventId,
        observationOperationId,
        witnessFrontierAtObservation: snapshot.verifiedFrontierHash,
        kind: "artifact",
        artifactKind: dimension,
        beforeArtifactDigest,
        afterArtifactDigest,
        committedGitOid: headOid,
        verifiedGitParentOid: parentOid,
        beforeGitBlobOid,
        afterGitBlobOid,
        verifiedTargetClean: true,
      }),
    };
  };

  const verifyNc1ProtocolChange = async (
    request: ScopeAdmissionRequest,
    snapshot: VerifiedAdmissionSnapshot,
    tip: UnfinishedTip,
    stop: VerifiedNC1StopV1,
    dimension: "design_protocol" | "plan_protocol" | "global_protocol",
    afterContextDigest: string,
  ): Promise<Nc1Inspection> => {
    const ctx = tip.lastVerifiedBinding.effective.context;
    if (dimension === "global_protocol") {
      return {
        ok: false,
        error: "The whole-descriptor protocol change requires a phase-scoped verified release transition.",
      };
    }
    const phase: "design" | "plan" = dimension === "design_protocol" ? "design" : "plan";
    if (protocolRelease === undefined || protocolRelease === null) {
      return { ok: false, error: "No verified protocol release authority is configured." };
    }
    const beforePhaseFingerprint =
      phase === "design" ? ctx.designProtocolFingerprint : ctx.planProtocolFingerprint;
    const afterPhaseFingerprint =
      phase === "design"
        ? snapshot.current.designProtocolFingerprint
        : snapshot.current.planProtocolFingerprint;
    if (beforePhaseFingerprint === afterPhaseFingerprint) {
      return { ok: true, candidate: null };
    }
    const beforeReleaseId = stop.protocolRelease.historicalReleaseId;
    if (beforeReleaseId === null) {
      return {
        ok: false,
        error: "The NC1 stop record carries no verified historical protocol release id.",
      };
    }
    const delta = await protocolRelease.readVerifiedPhaseProtocolDelta({
      workspaceIdentity: request.workspaceIdentity,
      phase,
      nc1StopEventId: stop.stopEventId,
      beforeFingerprint: beforePhaseFingerprint,
      beforeReleaseId,
      historicalReleaseProofDigest: stop.protocolRelease.historicalReleaseProofDigest ?? "",
      trustedPublisherPolicyVersion: request.protocol.releaseAuthority.trustedPublisherPolicyVersion,
      currentDescriptorDigest: request.protocol.releaseDescriptorDigest,
      witnessFrontierHash: snapshot.verifiedFrontierHash,
    });
    if (delta === "BLOCK") {
      return {
        ok: false,
        error: "The verified protocol release authority rejected the installed release transition.",
      };
    }
    if (delta.newPhaseFingerprint !== afterPhaseFingerprint) {
      return {
        ok: false,
        error: "The verified release target fingerprint does not match the observed protocol fingerprint.",
      };
    }

    const relevantStaticPromptAndPolicyDigest = computeCanonicalJsonFingerprint({
      domain: "justice-review-gate-nc1-protocol-relevant-v1",
      beforePhaseFingerprint,
      afterPhaseFingerprint,
      oldDescriptorDigest: delta.oldDescriptorDigest,
      newDescriptorDigest: delta.newDescriptorDigest,
      trustPolicyVersion: delta.trustPolicyVersion,
    });
    const changeObservedEventId = computeCanonicalJsonFingerprint({
      domain: NC1_CHANGE_DOMAIN,
      kind: "protocol",
      protocolPhase: phase,
      beforePhaseFingerprint,
      afterPhaseFingerprint,
      newReleaseId: delta.newReleaseId,
    });
    const observationOperationId = computeCanonicalJsonFingerprint({
      domain: NC1_CHANGE_DOMAIN,
      observationOf: stop.stoppedContextDigest,
      stopEventId: stop.stopEventId,
      newReleaseId: delta.newReleaseId,
    });
    const progressInvalidatedEventId = computeCanonicalJsonFingerprint({
      domain: "justice-review-gate-nc1-progress-v1",
      stopEventId: stop.stopEventId,
      oldReleaseId: delta.oldReleaseId,
      newReleaseId: delta.newReleaseId,
      verifiedProtectedHead: delta.verifiedProtectedHead,
    });

    return {
      ok: true,
      candidate: Object.freeze<VerifiedNC1EligibleChangeV1>({
        gateId: tip.gateId,
        generationId: tip.generationId,
        phase: stop.phase,
        nc1StopEventId: stop.stopEventId,
        beforeContextDigest: stop.stoppedContextDigest,
        afterContextDigest,
        changeObservedEventId,
        observationOperationId,
        witnessFrontierAtObservation: snapshot.verifiedFrontierHash,
        kind: "protocol",
        protocolPhase: phase,
        beforePhaseFingerprint,
        afterPhaseFingerprint,
        beforeDescriptorDigest: delta.oldDescriptorDigest,
        afterDescriptorDigest: delta.newDescriptorDigest,
        protocolSchemaVersion: request.protocol.releaseAuthority.schemaVersion,
        beforeReleaseId: delta.oldReleaseId,
        afterReleaseId: delta.newReleaseId,
        verifiedPublisherIdentityDigest: delta.publisherProofDigest,
        authenticatedImmutableReleaseProvenanceDigest: delta.chainProofDigest,
        protectedProtocolRegistryFrontierHash: delta.verifiedProtectedHead,
        relevantStaticPromptAndPolicyDigest,
        progressInvalidatedEventId,
      }),
    };
  };

  const inspectNc1 = async (
    request: ScopeAdmissionRequest,
    snapshot: VerifiedAdmissionSnapshot,
    decision: Extract<AdmissionDecision, { kind: "INSPECT_NC1_ELIGIBLE_CHANGE" }>,
    owned: AdmissionOwnedWitness,
  ): Promise<Nc1Inspection> => {
    try {
      const isNc1Tip = (candidate: VerifiedGateTip): candidate is UnfinishedTip =>
        candidate.status !== "completed";
      const tip = snapshot.currentTips.find((candidate) =>
        isNc1Tip(candidate) &&
        candidate.gateId === decision.gateId &&
        candidate.generationId === decision.generationId &&
        candidate.status === "suspended" &&
        candidate.suspensionReason === "review_non_convergent" &&
        candidate.nc1Stop !== null &&
        candidate.nc1Stop.stopEventId === decision.nc1StopEventId,
      );
      if (tip === undefined || tip.status !== "suspended" || tip.nc1Stop === null) {
        return {
          ok: false,
          error: "NC1 inspection could not locate the suspended non-convergence stop under the requested scope.",
        };
      }
      const stop: VerifiedNC1StopV1 = tip.nc1Stop;
      const ctx = tip.lastVerifiedBinding.effective.context;
      // Re-read the protected witness/frontier under the same lease via the
      // owned capability (no guard re-entry).
      const frontier = await owned.readVerifiedFrontier();
      if (frontier.globalFrontierHash !== snapshot.verifiedFrontierHash) {
        return { ok: false, error: "The protected witness frontier moved during NC1 inspection." };
      }
      const beforeDigest = computeVerifiedContextDigest(ctx);
      if (beforeDigest !== stop.stoppedContextDigest) {
        return {
          ok: false,
          error: "The NC1 stop context digest does not match the verified effective binding.",
        };
      }
      const afterContextDigest = contextDigestOfCurrent(snapshot);
      const dimension = changedDimension(
        {
          requirements: ctx.requirements,
          design: ctx.design,
          plan: ctx.plan,
          globalProtocolFingerprint: ctx.globalProtocolFingerprint,
          designProtocolFingerprint: ctx.designProtocolFingerprint,
          planProtocolFingerprint: ctx.planProtocolFingerprint,
        },
        snapshot.current,
      );
      if (dimension === null) return { ok: true, candidate: null };
      if (dimension === "requirements" || dimension === "design" || dimension === "plan") {
        return await verifyNc1ArtifactChange(request, snapshot, tip, stop, dimension);
      }
      return await verifyNc1ProtocolChange(
        request,
        snapshot,
        tip,
        stop,
        dimension,
        afterContextDigest,
      );
    } catch (error) {
      return {
        ok: false,
        error: `NC1 inspection failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };

  /**
   * Full owned observation of the requested scope under the held admission
   * lease. Returns the observation (snapshot + Requirements resolution) or
   * throws `ScopeAdmissionBlocked` when the material cannot be observed.
   */
  const observeOwned = async (
    request: ScopeAdmissionRequest,
    scopeId: ReviewScopeId,
    owned: AdmissionOwnedWitness,
  ): Promise<ReviewGateAdmissionObservation> => {
    const frontier = await owned.readVerifiedFrontier();
    const installation = await owned.readInstallation();
    const observation = await observeVerifiedAdmissionSnapshotOwned({
      workspaceRoot: request.workspaceRoot,
      scopeId,
      protocol: request.protocol,
      eventStore,
      workspaceReader,
      owned,
      authority: { installation, frontier, firstEnrollment: null },
      request: {
        designPath: request.designPath,
        planPath: request.planPath,
        explicitRequirementsPath: request.explicitRequirementsPath,
      },
    });
    if (observation === null) {
      throw new ScopeAdmissionBlocked("admission_snapshot_unavailable");
    }
    return observation;
  };

  const decide = async (
    request: ScopeAdmissionRequest,
    scopeId: ReviewScopeId,
    owned: AdmissionOwnedWitness,
  ): Promise<Readonly<{ decision: AdmissionDecision; observation: ReviewGateAdmissionObservation | null }>> => {
    if (request.workspaceRoot.length === 0 || request.workspaceIdentity.length === 0) {
      throw new ScopeAdmissionBlocked("workspace_identity");
    }

    const transaction = await owned.read();
    const workspace = transaction.data.workspaces[request.workspaceIdentity];
    const authorizationEventId = workspace?.authorization.authority.authorizationEventId;
    if (
      (workspace?.enrollmentState === "pending" ||
        workspace?.enrollmentState === "consumed") &&
      authorizationEventId !== undefined
    ) {
      const preparedGenesis = Object.values(transaction.data.pending).find((record) =>
        record.input.workspaceIdentity === request.workspaceIdentity &&
        record.input.firstEnrollmentAuthorizationId === authorizationEventId &&
        record.input.nextFrontier.scopes.some((scope) =>
          scope.scopeId === scopeId && scope.provenance.kind === "verified_genesis",
        ),
      );
      if (preparedGenesis !== undefined) {
        const recovered = await owned.recoverPreparedPublication(
          preparedGenesis.input.publicationId,
        );
        if (recovered === "blocked") {
          throw new ScopeAdmissionBlocked("protected_frontier");
        }
      }
    }

    // Only an enrolled workspace with no scopes can admit its first genesis.
    const frontier = await owned.readVerifiedFrontier();
    if (!frontier.scopes.some((scope) => scope.scopeId === scopeId) &&
      (frontier.workspaceEnrollmentId.length === 0 || frontier.scopes.length !== 0)) {
      return {
        decision: blockReason(
          "scope_not_enrolled",
          "The requested scope is not enrolled in the verified workspace ledger.",
        ),
        observation: null,
      };
    }
    const observation = await observeOwned(request, scopeId, owned);
    const snapshot = observation.snapshot;
    const firstDecision = planReviewGateAdmission(snapshot);
    if (firstDecision.kind !== "INSPECT_NC1_ELIGIBLE_CHANGE") {
      return { decision: firstDecision, observation };
    }

    const inspected = await inspectNc1(request, snapshot, firstDecision, owned);
    if (!inspected.ok) {
      return { decision: blockReason("nc1_candidate_invalid", inspected.error), observation };
    }

    // Second pass: re-observe the FULL current snapshot under the same lease.
    // The first-pass spread is never second-pass authority; a witnessed
    // change during inspection invalidates all earlier read material.
    const currentObservation = await observeOwned(request, scopeId, owned);
    if (currentObservation.snapshot.verifiedFrontierHash !== snapshot.verifiedFrontierHash) {
      return {
        decision: blockReason(
          "frontier_mismatch",
          "The verified frontier advanced during NC1 inspection; admission must retry against the new material.",
        ),
        observation: currentObservation,
      };
    }
    const secondSnapshot: VerifiedAdmissionSnapshot = Object.freeze({
      ...currentObservation.snapshot,
      nc1Observation: inspected.candidate === null ? ("VERIFIED_NONE" as const) : ("VERIFIED_CANDIDATE" as const),
      nc1Candidate: inspected.candidate,
    });
    const secondDecision = planReviewGateAdmission(secondSnapshot);
    if (secondDecision.kind === "INSPECT_NC1_ELIGIBLE_CHANGE") {
      return {
        decision: blockReason(
          "nc1_candidate_invalid",
          "The second admission pass requested a further NC1 inspection; reinspection is not permitted.",
        ),
        observation: currentObservation,
      };
    }
    const stop = currentObservation.nc1Evidence?.stop;
    const nc1Evidence = stop === undefined
      ? null
      : Object.freeze({
          stop,
          change: inspected.candidate,
          validationOutcome: currentObservation.nc1Evidence?.validationOutcome ?? null,
          frontierHash: currentObservation.snapshot.verifiedFrontierHash,
        });
    const secondObservation: ReviewGateAdmissionObservation = Object.freeze({
      ...currentObservation,
      snapshot: Object.freeze({ ...secondSnapshot, nc1Evidence }),
      nc1Evidence,
    });
    return { decision: secondDecision, observation: secondObservation };
  };

  const withAdmissionLease = async <T>(
    request: ScopeAdmissionRequest,
    run: (
      decision: AdmissionDecision,
      observation: ReviewGateAdmissionObservation | null,
      owned: AdmissionOwnedWitness,
    ) => Promise<T>,
  ): Promise<T> => {
    if (witness === null) {
      // A store without its protected witness never inherits authority:
      // graph-level fail closed, never a legacy unanchored fallback.
      throw new ScopeAdmissionBlocked("witness_unavailable");
    }
    const scopeId = computeReviewScopeId(request.designPath, request.planPath) as ReviewScopeId;

    // Fast lease probe: an occupied scope lock must surface as
    // scope_lease_occupied before the wider witness lock-order assertion,
    // so the coordinator can wait for the lease instead of bypassing
    // admission on contention.
    const probe = await lockManager.acquireScopeLock(scopeId);
    if (probe === "occupied") {
      throw new ScopeAdmissionBlocked("scope_lease_occupied");
    }
    probe.release();

    try {
      // Admission authority now spans the whole callback: the owned
      // transaction holds the installation guard plus the sorted scope/Gate
      // locks, and the decision is applied before any guard releases.
      return await witness.withAdmissionWitnessTransaction(
        {
          workspaceIdentity: request.workspaceIdentity,
          designPath: request.designPath,
          planPath: request.planPath,
          authorizeAdmittedMembership: options.authorizeAdmittedMembership,
        } as const,
        async (owned) => {
          const outcome = await decide(request, scopeId, owned);
          return run(outcome.decision, outcome.observation, owned);
        },
      );
    } catch (error: unknown) {
      if (error instanceof WitnessBlocked) {
        if (error.code === "busy_retryable") {
          throw new ScopeAdmissionBlocked("scope_lease_occupied");
        }
        if (error.code === "workspace_identity") {
          throw new ScopeAdmissionBlocked("workspace_identity");
        }
        // Protected-witness verification failures (registry, journals,
        // membership) fail the admission closed; the coordinator converts
        // the code to blocked guidance instead of a runtime crash.
        throw new ScopeAdmissionBlocked("protected_frontier");
      }
      throw error;
    }
  };

  return Object.freeze({ withAdmissionLease });
}

// Re-exported for the coordinator's fail-closed boundary handling.
export { ScopeAdmissionBlocked };
