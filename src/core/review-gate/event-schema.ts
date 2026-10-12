import { z } from "zod";
import type { ArtifactDigest, EpochId, FindingId, GateId, LineageId, ReviewGateEvent, ReviewScopeId, WriterId } from "../review-gate-types.js";
import type {
  CrossGenerationReconciliationCompletedV2, ExternalOperationDispatchedV2,
  FindingValidationCompletedV2, LineageRegressedV2, VerifiedCanonicalMutationTargetV1,
  VerifiedSemanticContextTransitionInput, VerifiedTargetWriterHandoffContinuationV1,
  VerifiedTargetWriterHandoffIntentV1, VerifiedTerminalWriterRevokeV1,
} from "./types.js";

const textEncoder = new TextEncoder();
const text = z.string().min(1);
const id = text.refine((value) => textEncoder.encode(value).length <= 256);
const phase = z.enum(["design", "plan"]);
const gitMode = z.enum(["100644", "100755"]);
const ordinal = z.number().int().nonnegative();
const timestamp = z.iso.datetime();
const brandedId = <T extends string>(): z.ZodType<T> => z.custom<T>((value) => id.safeParse(value).success);
const artifact = z.strictObject({ canonicalPath: text, digest: brandedId<ArtifactDigest>(), gitMode });
const requirements = z.strictObject({
  source: z.enum(["explicit", "auto_design_reference"]), canonicalPath: text,
  digest: brandedId<ArtifactDigest>(),
  designReferenceEvidence: z.strictObject({ referenceKind: text, logicalLocation: text }).optional(),
});
const round = z.strictObject({ phase, ordinal });
const approval = z.strictObject({
  reviewScopeId: brandedId<ReviewScopeId>(), gateId: brandedId<GateId>(),
  designArtifact: artifact, planArtifact: artifact, requirementsResolution: requirements,
  reviewProtocolFingerprint: text, designProtocolFingerprint: text,
  planProtocolFingerprint: text, approvedAt: timestamp,
});
const legacyBase = {
  gateId: brandedId<GateId>(), writerId: brandedId<WriterId>(), epochId: brandedId<EpochId>(),
  emittedAt: timestamp,
};
function legacy<T extends string, P>(eventType: T, payload: z.ZodType<P>): z.ZodObject<typeof legacyBase & { eventType: z.ZodLiteral<T>; payload: z.ZodType<P> }> {
  return z.strictObject({ ...legacyBase, eventType: z.literal(eventType), payload });
}
const finding = { lineageId: brandedId<LineageId>(), findingId: brandedId<FindingId>() };
const lineageRefs = z.strictObject({ phase, lineageIds: z.array(brandedId<LineageId>()) });
const legacySchema: z.ZodType<ReviewGateEvent> = z.union([
  legacy("GATE_CREATED", z.strictObject({ reviewScopeId: brandedId<ReviewScopeId>(), designArtifact: artifact, planArtifact: artifact, requirementsResolution: requirements, reviewProtocolFingerprint: text })),
  legacy("ARTIFACT_BINDINGS_UPDATED", z.strictObject({ designArtifact: artifact, planArtifact: artifact })),
  legacy("ORCHESTRATION_RESUMED", z.strictObject({ resumedAt: timestamp })),
  legacy("DESIGN_CLEAR", z.strictObject({ designProtocolFingerprint: text })),
  legacy("PLAN_CLEAR", z.strictObject({ completedApprovalBinding: approval })),
  legacy("REOPEN_REQUIRED", lineageRefs),
  legacy("ROUND_LIMIT_EXHAUSTED", z.strictObject({ phase, roundLimit: ordinal })),
  legacy("REVIEW_NON_CONVERGENT", lineageRefs),
  legacy("EXECUTION_SUSPENDED", z.strictObject({ reason: text })),
  legacy("FINDING_DISCOVERED", z.strictObject({ ...finding, observedPhase: phase, ownerScope: z.enum(["requirements", "design", "plan"]), descriptionDigest: brandedId<ArtifactDigest>() })),
  legacy("FINDING_REMEDIATED", z.strictObject({ ...finding, remediationRound: round })),
  legacy("FINDING_SELF_REVIEWED", z.strictObject({ ...finding, remediationRound: round })),
  legacy("FINDING_REOPENED", z.strictObject({ ...finding, reopenedBy: brandedId<EpochId>() })),
  legacy("COMPLETED_APPROVAL_BINDING", z.strictObject({ approvalBinding: approval })),
]);

const dispatch: z.ZodType<ExternalOperationDispatchedV2> = z.strictObject({
  eventType: z.literal("EXTERNAL_OPERATION_DISPATCHED"), gateId: id, generationId: id,
  epochId: id, operationId: id, dispatchAttemptId: id, phase,
  role: z.enum(["reviewer", "finding_validator", "remediator", "self_review", "lineage_revalidation", "cross_generation_reconciliation", "non_convergence_reentry"]),
  candidateOrTargetSetDigest: text, inputBindingDigest: text, protocolFingerprint: text,
  expectedWitnessFrontier: text, protectedLeaseProofDigest: text.nullable(),
}).refine((value) => (value.role === "remediator") === (value.protectedLeaseProofDigest !== null));
const validationBase = {
  operationId: id, validationEventId: id, pinnedBaselineDigest: text,
  semanticContextFingerprint: text, witnessedFrontierHash: text,
};
const resolutionBase = { ...validationBase, lineageId: id, priorCommittedResolutionEventId: id };
const validation: z.ZodType<FindingValidationCompletedV2> = z.strictObject({
  ...resolutionBase, eventType: z.literal("FINDING_VALIDATION_COMPLETED"),
  disposition: z.literal("ALREADY_RESOLVED"), relation: z.literal("EXISTING"),
  validatedAbsenceProofDigest: text,
});
const regression: z.ZodType<LineageRegressedV2> = z.strictObject({
  ...resolutionBase, eventType: z.literal("LINEAGE_REGRESSED"), validatedPresenceProofDigest: text,
});
const reconciliation: z.ZodType<CrossGenerationReconciliationCompletedV2> = z.strictObject({
  ...validationBase, eventType: z.literal("CROSS_GENERATION_RECONCILIATION_COMPLETED"),
  currentLineageId: id, predecessorGateId: id.nullable(), predecessorLineageId: id.nullable(),
  result: z.enum(["RELATED_PRIOR_GENERATION", "NO_PRIOR_MATCH"]),
}).refine((value) => value.result === "NO_PRIOR_MATCH"
  ? value.predecessorGateId === null && value.predecessorLineageId === null
  : value.predecessorGateId !== null && value.predecessorLineageId !== null);
const target: z.ZodType<VerifiedCanonicalMutationTargetV1> = z.strictObject({
  installationId: id, workspaceIdentity: text, canonicalWorkspaceRoot: text,
  canonicalLogicalTargetPath: text, targetIdentityDigest: text, verifiedAliasSetDigest: text,
  identityProofFrontier: text,
});
const owner = z.strictObject({ scopeId: id, gateId: id, generationId: id, operationId: id, attemptId: id });
const handoffStatus = z.enum(["REQUESTED", "FENCED", "CLAIMED", "RESUMED", "BLOCKED"]);
const intent: z.ZodType<VerifiedTargetWriterHandoffIntentV1> = z.strictObject({
  purpose: z.enum(["HANDOFF", "TERMINAL_REVOKE_ONLY"]), status: handoffStatus,
  handoffOperationId: id, originalOperationId: id, scopeId: id, gateId: id, generationId: id,
  phase, roundOrdinal: ordinal, protocolFingerprint: text, target,
  targets: z.array(target), closingSealOperationId: id.nullable(),
  oldOwner: owner.nullable(), newOwner: owner.nullable(), expectedTargetWriterFrontier: text,
  expectedGlobalTargetWriterGeneration: ordinal, expectedGateEventFrontier: text,
  expectedPreImageDigest: text, expectedGitMode: gitMode, pendingNativeEffectReference: text.nullable(),
}).refine((value) => {
  if (value.purpose === "TERMINAL_REVOKE_ONLY") {
    return value.newOwner === null && value.targets.length > 0;
  }
  return value.newOwner !== null && value.targets.length === 0 && value.closingSealOperationId === null;
});
const continuation: z.ZodType<VerifiedTargetWriterHandoffContinuationV1> = z.strictObject({
  status: handoffStatus, handoffOperationId: id, originalOperationId: id, intent,
  protectedTargetFrontier: text, gateEventFrontier: text, globalTargetWriterGeneration: ordinal,
  pendingNativeEffectReference: text.nullable(), continuationProofDigest: text,
});
const revoke: z.ZodType<VerifiedTerminalWriterRevokeV1> = z.strictObject({
  purpose: z.literal("TERMINAL_REVOKE_ONLY"), handoffOperationId: id, terminalTransitionOperationId: id,
  status: z.enum(["REVOKED", "NEVER_CLAIMED_OR_ALREADY_REVOKED"]), gateId: id,
  generationId: id, phase, roundOrdinal: ordinal, targets: z.array(target).min(1),
  priorOwners: z.array(owner), globalTargetWriterHighWatermark: ordinal,
  protectedTargetFrontier: text, protectedRevokeCasProofDigest: text,
  nativeNonWriteabilityProofDigest: text, nativeEffectDisposition: z.enum(["APPLIED", "NO_EFFECT", "RESTORED", "COMMITTED"]),
});
const inputs = z.strictObject({
  workspaceIdentity: text, gateId: id, generationId: id, phase,
  phaseBaselineId: id, comparisonSegmentId: id,
  requirements: z.strictObject({ source: z.enum(["explicit", "design_declared_reference"]), canonicalPath: text,
    gitBlobOid: text, gitMode, authorityEventId: id, governingReferenceManifestDigest: text }),
  upstreamApproved: z.strictObject({ bindingDigest: text, authorityEventId: id }).nullable(),
  policy: z.strictObject({ contractId: id, version: text, semanticFingerprint: text,
    lineageFingerprint: text, nc1Fingerprint: text, validatorRegistryDigest: text }),
});
const requirementsDelta = z.strictObject({
  nc1StopEventId: id, oldAuthorityEventId: id, newAuthorityEventId: id,
  oldGitBlobOid: text, newGitBlobOid: text, verifiedExternalCommitOid: text,
  oldManifestDigest: text, newManifestDigest: text, oldFullDocumentDigest: text, newFullDocumentDigest: text,
  oldSectionInventoryDigest: text, newSectionInventoryDigest: text, completeSectionDiffDigest: text,
  sectionDiffCoverageDigest: text, canonicalMappingDigest: text, coveredLineageSetDigest: text,
  affectedReferenceSetDigest: text, observedChangeEventId: id,
});
const counters = z.strictObject({ design: ordinal, plan: ordinal });
const transition: z.ZodType<VerifiedSemanticContextTransitionInput> = z.strictObject({
  oldInputs: inputs, newInputs: inputs,
  proof: z.strictObject({ validationEventId: id, triggeringAuthorityEventId: id,
    validatorId: z.literal("SEMANTIC_CONTEXT_COMPATIBILITY_V1"), validatorVersion: text,
    executableDigest: text, registryDigest: text, compatibilityTableDigest: text,
    oldNormalizedInputsDigest: text, newNormalizedInputsDigest: text,
    result: z.enum(["EQUIVALENT", "INCOMPATIBLE", "INDETERMINATE"]), ruleId: id,
    ruleVersion: text, requirementsDelta: requirementsDelta.nullable() }),
  triggeringAuthorityEventId: id, verifiedHistoryFrontier: text,
  roundCountersBefore: counters, roundCountersAfter: counters, operationId: id,
}).refine((value) => value.oldInputs.generationId === value.newInputs.generationId
  && value.oldInputs.gateId === value.newInputs.gateId && value.oldInputs.phase === value.newInputs.phase
  && value.triggeringAuthorityEventId === value.proof.triggeringAuthorityEventId
  && value.roundCountersBefore.design === value.roundCountersAfter.design
  && value.roundCountersBefore.plan === value.roundCountersAfter.plan);
const v2Base = {
  schemaVersion: z.literal(2), eventId: id, parentEventId: id, emittedAt: timestamp,
  gateId: id, epochId: id, generationId: id, writerId: id,
};
function versioned<T extends string, P>(eventType: T, payload: z.ZodType<P>): z.ZodObject<typeof v2Base & { eventType: z.ZodLiteral<T>; payload: z.ZodType<P> }> {
  return z.strictObject({ ...v2Base, eventType: z.literal(eventType), payload });
}
const v2Schema = z.union([
  versioned("EXTERNAL_OPERATION_DISPATCHED", dispatch),
  versioned("FINDING_VALIDATION_COMPLETED", validation),
  versioned("LINEAGE_REGRESSED", regression),
  versioned("CROSS_GENERATION_RECONCILIATION_COMPLETED", reconciliation),
  versioned("TARGET_WRITER_HANDOFF_REQUESTED", intent),
  versioned("TARGET_WRITER_HANDOFF_RESUMED", continuation),
  versioned("TARGET_WRITER_TERMINAL_REVOKED", revoke),
  versioned("SEMANTIC_CONTEXT_TRANSITION", transition),
]).refine((value) => {
  if (value.eventId === value.parentEventId) return false;
  switch (value.eventType) {
    case "EXTERNAL_OPERATION_DISPATCHED":
      return value.payload.gateId === value.gateId && value.payload.generationId === value.generationId
        && value.payload.epochId === value.epochId;
    case "SEMANTIC_CONTEXT_TRANSITION":
      return value.payload.oldInputs.gateId === value.gateId
        && value.payload.oldInputs.generationId === value.generationId
        && value.payload.triggeringAuthorityEventId !== value.eventId
        && value.payload.proof.validationEventId !== value.eventId;
    case "TARGET_WRITER_HANDOFF_REQUESTED":
      return value.payload.status === "REQUESTED" && value.payload.gateId === value.gateId
        && value.payload.generationId === value.generationId;
    case "TARGET_WRITER_HANDOFF_RESUMED":
      return value.payload.status === "RESUMED" && value.payload.intent.purpose === "HANDOFF"
        && value.payload.intent.gateId === value.gateId && value.payload.intent.generationId === value.generationId
        && value.payload.handoffOperationId === value.payload.intent.handoffOperationId
        && value.payload.originalOperationId === value.payload.intent.originalOperationId;
    case "TARGET_WRITER_TERMINAL_REVOKED":
      return value.payload.gateId === value.gateId && value.payload.generationId === value.generationId;
    case "CROSS_GENERATION_RECONCILIATION_COMPLETED":
      return value.payload.predecessorGateId !== value.gateId
        && value.payload.predecessorLineageId !== value.payload.currentLineageId;
    case "FINDING_VALIDATION_COMPLETED":
    case "LINEAGE_REGRESSED": return true;
    default: return assertNever(value);
  }
});
const eventSchema = z.union([legacySchema, v2Schema]).brand<"VerifiedReviewGateEvent">();

/** Schema verification is not authentication of referenced evidence or causal history. */
export type VerifiedReviewGateEvent = Readonly<z.infer<typeof eventSchema>>;

export function validateReviewGateEventRecord(record: unknown): VerifiedReviewGateEvent {
  const encoded = canonicalText(record);
  if (textEncoder.encode(encoded).length > 64 * 1024) throw new Error("review_gate_event_size_limit");
  const result = eventSchema.safeParse(record);
  if (!result.success) throw new Error("review_gate_event_schema_invalid");
  return deepFreeze(result.data);
}

export function encodeReviewGateEventRecord(event: VerifiedReviewGateEvent): string {
  return canonicalText(event);
}

function canonicalText(value: unknown, field = "", ancestors: readonly object[] = []): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string": {
      const limit = /Ids?$/u.test(field) ? 256 : 4096;
      if (textEncoder.encode(value).length > limit || /sk-ant-|ghp_|github_pat_|sk-[a-zA-Z0-9]/u.test(value)
        || /(?:^|\s)(?:\/|[a-zA-Z]:[\\/]|\\\\|~\/)/u.test(value) || value.includes("\0")) {
        throw new Error("review_gate_event_unsafe_string");
      }
      return JSON.stringify(value);
    }
    case "number":
      if (!Number.isFinite(value)) throw new Error("review_gate_event_non_json");
      return JSON.stringify(value);
    case "boolean": return JSON.stringify(value);
    case "object": {
      if (ancestors.includes(value) || ancestors.length >= 32) throw new Error("review_gate_event_non_json");
      const next = [...ancestors, value];
      if (Array.isArray(value)) {
        if (value.length > 128) throw new Error("review_gate_event_reference_limit");
        if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0
          || Object.entries(Object.getOwnPropertyDescriptors(value)).some(([key, descriptor]) => key !== "length"
            && (!/^(0|[1-9][0-9]*)$/u.test(key) || !("value" in descriptor) || !descriptor.enumerable))) {
          throw new Error("review_gate_event_non_json");
        }
        return `[${Array.from(value, (member: unknown) => canonicalText(member, field, next)).join(",")}]`;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null
        || Object.getOwnPropertySymbols(value).length > 0) throw new Error("review_gate_event_non_json");
      const entries = Object.entries(Object.getOwnPropertyDescriptors(value)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      return `{${entries.map(([key, descriptor]) => {
        if (!descriptor.enumerable || !("value" in descriptor) || /raw|workerText|prompt|responseText|token|secret|password/iu.test(key)) {
          throw new Error("review_gate_event_unsafe_field");
        }
        return `${JSON.stringify(key)}:${canonicalText(descriptor.value, key, next)}`;
      }).join(",")}}`;
    }
    default: throw new Error("review_gate_event_non_json");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}

function assertNever(value: never): never {
  throw new Error(`review_gate_event_unknown_variant:${typeof value}`);
}
