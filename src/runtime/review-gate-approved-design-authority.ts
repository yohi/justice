import type { VerifiedApprovedDesignReadBindingV1 } from "../core/review-gate/capabilities.js";
import type { AdmissionOwnedWitness } from "./review-gate-admission-context.js";
import type {
  DurableReviewGateEventStore,
  ReviewGateEventStore,
  VerifiedScopeRead,
} from "./review-gate-event-store.js";
import type { ReviewGateGit } from "./review-gate-git.js";
import type { ReviewGateQueryService } from "./review-gate-query.js";
import type { ReviewGateScopeAdmission } from "./review-gate-scope-admission.js";
import type { ScopeAdmissionRequest } from "./review-gate-scope-admission.js";
import type { ReviewGateApprovedDesignAuthority } from "../hooks/plan-bridge.js";
import { canonicalizeArtifactPath } from "../core/review-gate/identity.js";

export type ApprovedDesignOperationReadBinding = Readonly<{
  readonly gateId: string;
  readonly operationId: string;
  readonly canonicalPath: string;
  readonly treeSha: string;
  readonly blobSha: string;
  readonly gitMode: "100644" | "100755";
  readonly objectSize: number;
  readonly approvedDesign?: VerifiedApprovedDesignReadBindingV1;
}>;

type ApprovedDesignOperationReadDependencies = Readonly<{
  readonly eventStore: ReviewGateEventStore & Pick<DurableReviewGateEventStore, "readVerifiedScopeOwned">;
  readonly git: ReviewGateGit;
}>;

export async function buildApprovedDesignOperationReadBinding(
  owned: AdmissionOwnedWitness,
  input: Readonly<{ readonly gateId: string; readonly operationId: string; readonly designPath: string }>,
  dependencies?: ApprovedDesignOperationReadDependencies,
): Promise<ApprovedDesignOperationReadBinding | null> {
  const canonicalPath = canonicalizeArtifactPath(input.designPath);
  if (canonicalPath === null || input.operationId.length === 0) return null;
  owned.assertOwnedGate(input.gateId);
  const binding = await owned.readVerifiedDesignBinding({
    gateId: input.gateId,
    designPath: canonicalPath,
  });
  if (binding === null) return null;
  if (dependencies === undefined) {
    return Object.freeze({
      gateId: input.gateId,
      operationId: input.operationId,
      canonicalPath,
      ...binding,
    });
  }
  const frontier = await owned.readVerifiedFrontier();
  const scope = frontier.scopes.find((candidate) =>
    candidate.canonicalDesignPath === canonicalPath &&
    candidate.gateMembership.some((membership) => membership.gateId === input.gateId),
  );
  if (scope === undefined) return null;
  owned.assertOwnedScope(scope.scopeId);
  const verifiedScope = await dependencies.eventStore.readVerifiedScopeOwned(owned, scope.scopeId);
  const readBinding = await verifiedReadBinding({
    gateId: input.gateId,
    operationId: input.operationId,
    designPath: canonicalPath,
    scope: verifiedScope,
    git: dependencies.git,
  });
  if (
    readBinding === null ||
    readBinding.blobOid !== binding.blobSha ||
    readBinding.gitMode !== binding.gitMode
  ) return null;
  return Object.freeze({
    gateId: input.gateId,
    operationId: input.operationId,
    canonicalPath,
    ...binding,
    approvedDesign: readBinding,
  });
}

type ReadableEvent = Readonly<{
  readonly eventType: string;
  readonly eventId?: string;
  readonly gateId?: string;
  readonly operationId?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}>;

function findCurrentDesignAuthority(
  scope: VerifiedScopeRead,
  gateId: string,
  designPath: string,
  operationId: string,
): Readonly<{ readonly designClearEventId: string; readonly designProtocolFingerprint: string }> | null {
  const events = scope.eventsByGate.get(gateId) ?? [];
  const genesis = events[0] as ReadableEvent | undefined;
  if (genesis?.eventType !== "GATE_CREATED" || genesis.gateId !== gateId) return null;
  const genesisPayload = genesis.payload;
  const designArtifact = genesisPayload?.designArtifact;
  const requirements = genesisPayload?.requirementsResolution;
  const designPathInEvent =
    typeof designArtifact === "object" && designArtifact !== null && "canonicalPath" in designArtifact
      ? designArtifact.canonicalPath
      : null;
  if (designPathInEvent !== designPath) return null;

  const clear = events.find((event) => {
    const candidate = event as ReadableEvent;
    return candidate.eventType === "DESIGN_CLEAR" && candidate.gateId === gateId;
  }) as ReadableEvent | undefined;
  if (clear?.eventId === undefined) return null;
  const clearIndex = events.findIndex((event) => (event as ReadableEvent).eventId === clear.eventId);
  if (clearIndex < 0 || events.slice(clearIndex + 1).some((event) => {
    const candidate = event as ReadableEvent;
    return candidate.eventType === "ARTIFACT_BINDINGS_UPDATED" ||
      (candidate.eventType === "REOPEN_REQUIRED" && candidate.payload?.phase === "design");
  })) return null;
  const fingerprint = clear.payload?.designProtocolFingerprint;
  const approvedContextEventId = clear.payload?.approvedContextEventId;
  const reqPath =
    typeof requirements === "object" && requirements !== null && "canonicalPath" in requirements
      ? requirements.canonicalPath
      : null;
  if (
    typeof fingerprint !== "string" ||
    typeof reqPath !== "string" ||
    approvedContextEventId !== operationId
  ) return null;
  return { designClearEventId: clear.eventId, designProtocolFingerprint: fingerprint };
}

async function verifiedReadBinding(
  input: Readonly<{
    readonly gateId: string;
    readonly operationId: string;
    readonly designPath: string;
    readonly scope: VerifiedScopeRead;
    readonly git: ReviewGateGit;
  }>,
): Promise<VerifiedApprovedDesignReadBindingV1 | null> {
    const canonicalPath = canonicalizeArtifactPath(input.designPath);
    if (canonicalPath === null) return null;
    const authority = findCurrentDesignAuthority(
      input.scope,
      input.gateId,
      canonicalPath,
      input.operationId,
    );
    if (authority === null) return null;
    const gateCreated = input.scope.eventsByGate.get(input.gateId)?.[0] as ReadableEvent | undefined;
    const payload = gateCreated?.payload;
    const designArtifact = payload?.designArtifact;
    const requirementsResolution = payload?.requirementsResolution;
    if (
      typeof designArtifact !== "object" || designArtifact === null ||
      typeof requirementsResolution !== "object" || requirementsResolution === null
    ) return null;
    const designRecord = designArtifact as Readonly<Record<string, unknown>>;
    const requirements = requirementsResolution as Readonly<Record<string, unknown>>;
    const target = await input.git.inspectTarget(canonicalPath);
    if (
      target.headSha === null || target.headEntry === null || target.indexEntry === null ||
      target.worktree === null || target.indexConflicted || target.headBlobDigest === null ||
      target.headEntry.blobSha !== target.indexEntry.blobSha ||
      target.headEntry.gitMode !== target.indexEntry.gitMode ||
      designRecord.digest !== target.headBlobDigest ||
      designRecord.gitMode !== target.headEntry.gitMode ||
      target.worktree.digest !== designRecord.digest || target.worktree.gitMode !== designRecord.gitMode
    ) return null;

    const reqMode = requirements.gitMode;
    if (reqMode !== "100644" && reqMode !== "100755") return null;
    const verifiedReqMode: "100644" | "100755" = reqMode;
    const reqPath = requirements.canonicalPath;
    const reqBlob = requirements.requirementsGitBlobOid;
    const reqDigest = requirements.digest;
    if (typeof reqPath !== "string" || typeof reqBlob !== "string" || typeof reqDigest !== "string") return null;
    return Object.freeze({
      schemaVersion: 1,
      canonicalPath,
      designClearEventId: authority.designClearEventId,
      currentAuthorityEventId: authority.designClearEventId,
      committedTreeOid: target.headSha,
      blobOid: target.headEntry.blobSha,
      gitMode: target.headEntry.gitMode,
      digest: target.headBlobDigest,
      requirements: {
        canonicalPath: reqPath,
        gitBlobOid: reqBlob,
        digest: reqDigest,
        gitMode: verifiedReqMode,
      },
      phaseProtocolFingerprint: authority.designProtocolFingerprint,
      witnessFrontierHash: input.scope.frontier.globalFrontierHash,
    });
}

export function createReviewGateApprovedDesignAuthority(input: Readonly<{
  readonly admission: ReviewGateScopeAdmission;
  readonly eventStore: ReviewGateEventStore & Pick<DurableReviewGateEventStore, "readVerifiedScopeOwned">;
  readonly git: ReviewGateGit;
  readonly query: ReviewGateQueryService;
  readonly admissionRequest?: Omit<ScopeAdmissionRequest, "planPath"> & {
    readonly planPath?: string;
  };
}>): ReviewGateApprovedDesignAuthority {
  const readBinding = async (request: {
    readonly gateId: string;
    readonly designPath: string;
  }): Promise<VerifiedApprovedDesignReadBindingV1 | null> => {
    const admissionRequest = input.admissionRequest;
    if (admissionRequest === undefined) return null;
    const gateEvents = await input.eventStore.readVerifiedEvents(request.gateId);
    const genesis = gateEvents[0] as ReadableEvent | undefined;
    const payload = genesis?.payload;
    if (
      genesis?.eventType !== "GATE_CREATED" ||
      genesis.gateId !== request.gateId ||
      typeof payload !== "object" || payload === null || !("reviewScopeId" in payload)
    ) return null;
    const artifacts = payload.designArtifact;
    const planArtifact = payload.planArtifact;
    if (
      typeof artifacts !== "object" || artifacts === null || !("canonicalPath" in artifacts) ||
      typeof planArtifact !== "object" || planArtifact === null || !("canonicalPath" in planArtifact) ||
      typeof planArtifact.canonicalPath !== "string"
    ) return null;
    const planPath = admissionRequest.planPath ?? planArtifact.canonicalPath;
    const clear = gateEvents.find((event) => (event as ReadableEvent).eventType === "DESIGN_CLEAR") as ReadableEvent | undefined;
    const operationId = clear?.payload?.approvedContextEventId;
    if (clear?.eventId === undefined || typeof operationId !== "string") return null;
    return await input.admission.withAdmissionLease(
      { ...admissionRequest, designPath: request.designPath, planPath },
      async (decision, _observation, owned) => {
        if (decision.kind === "BLOCK") return null;
        const operationBinding = await buildApprovedDesignOperationReadBinding(
          owned,
          { gateId: request.gateId, operationId, designPath: request.designPath },
          { eventStore: input.eventStore, git: input.git },
        );
        return operationBinding?.approvedDesign ?? null;
      },
    );
  };

  return Object.freeze({
    getApprovedDesignBinding: (request: { readonly gateId: string; readonly designPath: string }) => readBinding(request),
    readApprovedDesignArtifact: (request: { readonly approvedDesign: VerifiedApprovedDesignReadBindingV1 }) =>
      input.query.readApprovedDesignArtifact(request),
    searchApprovedDesignArtifact: (request: { readonly approvedDesign: VerifiedApprovedDesignReadBindingV1; readonly pattern: string }) =>
      input.query.searchApprovedDesignArtifact(request),
  });
}
