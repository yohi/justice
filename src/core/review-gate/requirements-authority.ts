import type {
  ArtifactDigest,
  RequirementsAuthoritySnapshotV1,
  RequirementsResolutionV2,
} from "../review-gate-types.js";
import type { VerifiedReviewGateEvent } from "./event-schema.js";
import { computeCanonicalJsonFingerprint } from "./identity.js";
import {
  buildRequirementsSectionInventory,
  diffRequirementsSectionInventories,
  type RequirementsGoverningDeltaProofV1,
} from "./requirements-section-inventory.js";
import type { VerifiedRequirementsBinding } from "./types.js";

export type VerifiedRequirementsContext = Readonly<{
  readonly requirements: Readonly<{
    readonly source: "explicit" | "design_declared_reference";
    readonly canonicalPath: string;
    readonly digest: ArtifactDigest;
    readonly gitMode: "100644" | "100755";
    readonly gitBlobOid: string;
  }>;
  readonly design: RequirementsAuthoritySnapshotV1["design"];
  readonly authorityEventId: string;
  readonly operationId: string;
}>;

export type RequirementsAuthorityDecision =
  | Readonly<{ readonly kind: "REVALIDATE" | "REBASE"; readonly next: RequirementsAuthoritySnapshotV1 }>
  | Readonly<{ readonly kind: "BLOCK"; readonly reason: string }>;

export function planRequirementsAuthorityTransition(input: Readonly<{
  readonly historical: RequirementsResolutionV2;
  readonly effective: RequirementsAuthoritySnapshotV1;
  readonly proposed: VerifiedRequirementsContext;
  readonly origin: "justice_remediation_commit" | "external_committed_change";
}>): RequirementsAuthorityDecision {
  if (!hasConsistentHistoricalAuthority(input.historical, input.effective)) {
    return { kind: "BLOCK", reason: "requirements_authority_historical_provenance_mismatch" };
  }
  if (!hasValidProposedAuthority(input.proposed, input.effective)) {
    return { kind: "BLOCK", reason: "requirements_authority_proposed_context_invalid" };
  }

  const next = Object.freeze({
    ...input.effective,
    currentAuthorityEventId: input.proposed.authorityEventId,
    producingOperationId: input.proposed.operationId,
    requirements: Object.freeze({
      source: input.proposed.requirements.source,
      selectedCanonicalPath: input.proposed.requirements.canonicalPath,
      canonicalPath: input.proposed.requirements.canonicalPath,
      gitBlobOid: input.proposed.requirements.gitBlobOid,
      digest: input.proposed.requirements.digest,
      gitMode: input.proposed.requirements.gitMode,
    }),
    design: input.proposed.design,
  });
  const changed = !sameRequirements(input.effective.requirements, next.requirements) ||
    !sameDesign(input.effective.design, next.design);
  return Object.freeze({ kind: changed ? "REBASE" : "REVALIDATE", next });
}

export function projectPersistedRequirementsBinding(
  snapshot: RequirementsAuthoritySnapshotV1,
  verifiedEvents: readonly VerifiedReviewGateEvent[],
): VerifiedRequirementsBinding {
  const hasEvent = (targetEventId: string) =>
    verifiedEvents.some(
      (event) => "eventId" in event && typeof event.eventId === "string" && event.eventId === targetEventId,
    );
  if (!hasEvent(snapshot.historicalResolutionEventId) || !hasEvent(snapshot.currentAuthorityEventId)) {
    throw new RequirementsAuthorityError("requirements_authority_event_unverified");
  }
  return Object.freeze({
    source: snapshot.requirements.source,
    workspaceIdentity: snapshot.workspaceIdentity,
    canonicalPath: snapshot.requirements.canonicalPath,
    digest: snapshot.requirements.digest,
    gitMode: snapshot.requirements.gitMode,
    gitBlobOid: snapshot.requirements.gitBlobOid,
    selectedByEventId: snapshot.currentAuthorityEventId,
  });
}

export type VerifiedRequirementsGoverningDeltaInput = Readonly<{
  readonly old: Readonly<{ readonly bytes: Uint8Array; readonly gitBlobOid: string }>;
  readonly current: Readonly<{ readonly bytes: Uint8Array; readonly gitBlobOid: string }>;
  readonly parserVersion: string;
  readonly proof: RequirementsGoverningDeltaProofV1;
}>;

export function buildVerifiedRequirementsGoverningDelta(
  input: VerifiedRequirementsGoverningDeltaInput,
): RequirementsGoverningDeltaProofV1 {
  const oldInventory = buildRequirementsSectionInventory(
    input.old.bytes,
    input.old.gitBlobOid,
    input.parserVersion,
  );
  const currentInventory = buildRequirementsSectionInventory(
    input.current.bytes,
    input.current.gitBlobOid,
    input.parserVersion,
  );
  const diff = diffRequirementsSectionInventories(oldInventory, currentInventory);
  const proof = input.proof;
  if (
    proof.oldGitBlobOid !== input.old.gitBlobOid ||
    proof.newGitBlobOid !== input.current.gitBlobOid ||
    proof.oldFullDocumentDigest !== diff.oldFullDocumentDigest ||
    proof.newFullDocumentDigest !== diff.newFullDocumentDigest ||
    proof.oldSectionInventoryDigest !== diff.oldInventoryDigest ||
    proof.newSectionInventoryDigest !== diff.newInventoryDigest ||
    proof.completeSectionDiffDigest !== diff.fullDiffDigest ||
    proof.sectionDiffCoverageDigest !== diff.fullDiffCoverageDigest
  ) {
    throw new RequirementsAuthorityError("requirements_governing_delta_unverified");
  }
  return Object.freeze({ ...proof });
}

export class RequirementsAuthorityError extends Error {
  constructor(readonly code: "requirements_authority_event_unverified" | "requirements_governing_delta_unverified") {
    super(code);
    this.name = "RequirementsAuthorityError";
  }
}

function hasConsistentHistoricalAuthority(
  historical: RequirementsResolutionV2,
  effective: RequirementsAuthoritySnapshotV1,
): boolean {
  return historical.workspaceIdentity === effective.workspaceIdentity &&
    historical.source === effective.requirements.source &&
    historical.canonicalPath === effective.requirements.selectedCanonicalPath &&
    effective.requirements.canonicalPath === effective.requirements.selectedCanonicalPath;
}

function hasValidProposedAuthority(
  proposed: VerifiedRequirementsContext,
  effective: RequirementsAuthoritySnapshotV1,
): boolean {
  return proposed.authorityEventId.length > 0 && proposed.operationId.length > 0 &&
    proposed.requirements.canonicalPath.length > 0 && proposed.requirements.gitBlobOid.length > 0 &&
    proposed.requirements.canonicalPath === effective.requirements.selectedCanonicalPath &&
    proposed.requirements.source === effective.requirements.source &&
    proposed.design.marker.validPreamblePosition &&
    proposed.design.marker.declaredCanonicalPath === proposed.requirements.canonicalPath &&
    proposed.design.canonicalPath === effective.design.canonicalPath;
}

function sameRequirements(
  left: RequirementsAuthoritySnapshotV1["requirements"],
  right: RequirementsAuthoritySnapshotV1["requirements"],
): boolean {
  return computeCanonicalJsonFingerprint(left) === computeCanonicalJsonFingerprint(right);
}

function sameDesign(
  left: RequirementsAuthoritySnapshotV1["design"],
  right: RequirementsAuthoritySnapshotV1["design"],
): boolean {
  return computeCanonicalJsonFingerprint(left) === computeCanonicalJsonFingerprint(right);
}
