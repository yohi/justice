/**
 * Review Gate projection-level vocabulary.
 *
 * The primitive state-machine types stay canonical in `../review-gate-types.ts`;
 * this module re-exports that public surface and adds the derived types used by
 * `./projection.ts` and `./resume-cursor.ts`.
 */
export * from "../review-gate-types.js";

import type {
  ArtifactDigest,
  EpochId,
  LineageId,
  RequirementsResolutionV2,
  ReviewApprovalBindingV1,
  ReviewArtifactBinding,
  ReviewGatePhase,
  ReviewGateState,
  ReviewScopeId,
} from "../review-gate-types.js";

/**
 * Immutable Requirements binding used by admission, projection and V2 lifecycle events.
 */
export type VerifiedRequirementsBinding = Readonly<{
  readonly source: "explicit" | "design_declared_reference";
  readonly workspaceIdentity: string;
  readonly canonicalPath: string;
  readonly digest: ArtifactDigest;
  readonly gitMode: "100644" | "100755";
  readonly gitBlobOid: string;
  readonly selectedByEventId: string;
}>;

/**
 * WSP1 workspace state of a Review Gate target artifact. Real worktree
 * inspection lands in a later task; the current projection derives every
 * target as `"clean_committed"` (stub, see `projectReviewGate`).
 */
export type ReviewTargetWorkspaceState =
  | "clean_committed"
  | "known_dirty"
  | "mutation_in_flight";

/** Exact Design clear milestone observed in the current gate history. */
export type DesignClearMilestone = Readonly<{
  readonly epochId: EpochId;
  readonly emittedAt: string;
  readonly designProtocolFingerprint: string;
}>;

/** Exact Plan clear milestone observed in the current gate history. */
export type PlanClearMilestone = Readonly<{
  readonly epochId: EpochId;
  readonly emittedAt: string;
  readonly completedApprovalBinding: ReviewApprovalBindingV1;
}>;

/** Payload carried by a non-convergent current-phase disposition. */
export type ReviewNonConvergentPayload = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly lineageIds: ReadonlyArray<LineageId>;
}>;

/**
 * Decision about the current review round supplied by the review coordinator.
 * Kept as an explicit seam: NC1 non-convergence, round-limit exhaustion, and
 * remediation continuation are decided upstream of `deriveResumeCursor`, while
 * OSC1 upstream precedence and pending revalidation are handled inside it.
 */
export type CurrentPhaseDisposition =
  | Readonly<{ readonly kind: "non_convergent"; readonly payload: ReviewNonConvergentPayload }>
  | Readonly<{ readonly kind: "round_limit" }>
  | Readonly<{ readonly kind: "remediate" }>;

/**
 * Resume cursor for a Review Gate. `resume_execution` carries the identity of
 * the epoch whose execution was suspended so a coordinator can verify the
 * epoch has not changed before resuming. `dispatch_recovery` carries a
 * verified recovery cursor for an external operation dispatch whose outcome
 * is still pending (Task 9 projection seam).
 */
export type ReviewGateResumeCursor =
  | Readonly<{ readonly kind: "completed" }>
  | Readonly<{
      readonly kind: "resume_execution";
      readonly cursor: Readonly<{ readonly epochId: EpochId; readonly startedAt: string }>;
    }>
  | Readonly<{ readonly kind: "await_external_change" }>
  | Readonly<{ readonly kind: "await_material_progress" }>
  | Readonly<{ readonly kind: "await_upstream_commit" }>
  | Readonly<{ readonly kind: "resolve_upstream"; readonly lineageIds: ReadonlyArray<LineageId> }>
  | Readonly<{ readonly kind: "revalidate"; readonly lineageIds: ReadonlyArray<LineageId> }>
  | Readonly<{ readonly kind: "non_convergent"; readonly payload: ReviewNonConvergentPayload }>
  | Readonly<{ readonly kind: "round_limit_exhausted" }>
  | Readonly<{ readonly kind: "remediate"; readonly lineageIds: ReadonlyArray<LineageId> }>
  | Readonly<{ readonly kind: "review" }>
  | Readonly<{
      readonly kind: "dispatch_recovery";
      readonly recovery: VerifiedDispatchRecoveryCursorV1;
    }>
  | Readonly<{
      readonly kind: "terminal_revoke_pending";
      readonly handoffOperationId: string;
      readonly terminalTransitionOperationId: string;
      readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
    }>
  | Readonly<{
      readonly kind: "revoked_awaiting_terminal_publication";
      readonly handoffOperationId: string;
      readonly terminalTransitionOperationId: string;
      readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
    }>
  | Readonly<{
      readonly kind: "terminal_finalized";
      readonly handoffOperationId: string;
      readonly terminalTransitionOperationId: string;
      readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
    }>;

/**
 * Immutable projection of a Review Gate event history: the base reducer state
 * plus derived workspace, milestone, blocker, and context-identity fields.
 */
export type ReviewGateProjection = Readonly<
  ReviewGateState & {
    readonly effectiveDesignClear: DesignClearMilestone | null;
    readonly planClearMilestone: PlanClearMilestone | null;
    readonly workspaceStates: ReadonlyMap<string, ReviewTargetWorkspaceState>;
    readonly currentRemediableBlockers: ReadonlyArray<LineageId>;
    readonly currentUpstreamBlockers: ReadonlyArray<LineageId>;
    readonly pendingRevalidationBlockers: ReadonlyArray<LineageId>;
    readonly phaseBaselineRevision: number;
    readonly phaseReviewContextIdentity: string;
    readonly dispatchRecoveryCursors?: ReadonlyArray<VerifiedDispatchRecoveryCursorV1>;
    readonly terminalState?: VerifiedTerminalStateV1 | null;
  }
>;

export type ScopeEnrollmentV1 = Readonly<{
  readonly scopeId: string;
  readonly workflowContinuityId: string;
  readonly canonicalDesignPath: string;
  readonly canonicalPlanPath: string;
  readonly pathPairDigest: string;
  readonly provenance: Readonly<{
    readonly kind:
      | "verified_genesis"
      | "verified_completed_successor"
      | "verified_independent_workflow";
    readonly evidenceDigest: string;
    readonly priorScopeId: string | null;
    readonly priorGateId: string | null;
  }>;
  readonly gateMembership: ReadonlyArray<
    Readonly<{
      readonly gateId: string;
      readonly generationId: string;
      readonly supersedesGateId: string | null;
      readonly admissionEventId: string;
      readonly writerIds: ReadonlyArray<string>;
    }>
  >;
}>;

export type VerifiedScopeFrontier = Readonly<{
  readonly workspaceIdentity: string;
  readonly workspaceEnrollmentId: string;
  readonly scopes: ReadonlyArray<ScopeEnrollmentV1>;
  readonly writerHeads: ReadonlyArray<
    Readonly<{
      readonly scopeId: string;
      readonly gateId: string;
      readonly writerId: string;
      readonly sequence: number;
      readonly hash: string;
    }>
  >;
  readonly globalFrontierHash: string;
}>;

export type VerifiedFirstEnrollmentAuthorityV1 = Readonly<{
  readonly installationId: string;
  readonly workspaceIdentity: string;
  readonly canonicalDesignPath: string;
  readonly canonicalPlanPath: string;
  readonly authorizationOperationId: string;
  readonly authenticatedProvisionerDigest: string;
  readonly verifiedAbsentPriorEnrollmentFrontierHash: string;
  readonly authorizationEventId: string;
}>;

export type SemanticContextInputsV1 = Readonly<{
  readonly workspaceIdentity: string;
  readonly gateId: string;
  readonly generationId: string;
  readonly phase: ReviewGatePhase;
  readonly phaseBaselineId: string;
  readonly comparisonSegmentId: string;
  readonly requirements: Readonly<{
    readonly source: string;
    readonly canonicalPath: string;
    readonly gitBlobOid: string;
    readonly gitMode: "100644" | "100755";
    readonly authorityEventId: string;
    readonly governingReferenceManifestDigest: string;
  }>;
  readonly upstreamApproved: Readonly<{
    readonly bindingDigest: string;
    readonly authorityEventId: string;
  }> | null;
  readonly policy: Readonly<{
    readonly contractId: string;
    readonly version: string;
    readonly semanticFingerprint: string;
    readonly lineageFingerprint: string;
    readonly nc1Fingerprint: string;
    readonly validatorRegistryDigest: string;
  }>;
}>;

export type SemanticContextCompatibilityProofV1 = Readonly<{
  readonly validationEventId: string;
  readonly triggeringAuthorityEventId: string;
  readonly validatorId: "SEMANTIC_CONTEXT_COMPATIBILITY_V1";
  readonly validatorVersion: string;
  readonly executableDigest: string;
  readonly registryDigest: string;
  readonly compatibilityTableDigest: string;
  readonly oldNormalizedInputsDigest: string;
  readonly newNormalizedInputsDigest: string;
  readonly result: "EQUIVALENT" | "INCOMPATIBLE" | "INDETERMINATE";
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly requirementsDelta: Readonly<{
    readonly nc1StopEventId: string;
    readonly oldAuthorityEventId: string;
    readonly newAuthorityEventId: string;
    readonly oldGitBlobOid: string;
    readonly newGitBlobOid: string;
    readonly verifiedExternalCommitOid: string;
    readonly oldManifestDigest: string;
    readonly newManifestDigest: string;
    readonly oldFullDocumentDigest: string;
    readonly newFullDocumentDigest: string;
    readonly oldSectionInventoryDigest: string;
    readonly newSectionInventoryDigest: string;
    readonly completeSectionDiffDigest: string;
    readonly sectionDiffCoverageDigest: string;
    readonly canonicalMappingDigest: string;
    readonly coveredLineageSetDigest: string;
    readonly affectedReferenceSetDigest: string;
    readonly observedChangeEventId: string;
  }> | null;
}>;

export type VerifiedSemanticContextTransitionInput = Readonly<{
  readonly oldInputs: SemanticContextInputsV1;
  readonly newInputs: SemanticContextInputsV1;
  readonly proof: SemanticContextCompatibilityProofV1;
  readonly triggeringAuthorityEventId: string;
  readonly verifiedHistoryFrontier: string;
  readonly roundCountersBefore: Readonly<{ readonly design: number; readonly plan: number }>;
  readonly roundCountersAfter: Readonly<{ readonly design: number; readonly plan: number }>;
  readonly operationId: string;
}>;

export type GateCreatedV2 = Readonly<{
  readonly reviewScopeId: ReviewScopeId;
  readonly supersedesGateId: string | null;
  readonly requirementsResolution: RequirementsResolutionV2;
  readonly designArtifact: ReviewArtifactBinding;
  readonly planArtifact: ReviewArtifactBinding;
  readonly reviewProtocolFingerprint: string;
  readonly designProtocolFingerprint: string;
  readonly planProtocolFingerprint: string;
}>;

export type DesignClearV2 = Readonly<{
  readonly designProtocolFingerprint: string;
  readonly approvedContextEventId: string;
}>;

export type PlanClearV2 = Readonly<{
  readonly completedApprovalBinding: ReviewApprovalBindingV1;
  readonly approvedContextEventId: string;
}>;

export type CompletedApprovalBindingV2 = Readonly<{
  readonly approvalBinding: ReviewApprovalBindingV1;
  readonly designClearEventId: string;
  readonly planClearEventId: string;
  readonly currentRequirementsAuthorityEventId: string;
  readonly currentRequirements: VerifiedRequirementsBinding;
}>;

export type ExternalOperationDispatchedV2 = Readonly<{
  readonly eventType: "EXTERNAL_OPERATION_DISPATCHED";
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly phase: ReviewGatePhase;
  readonly role: string;
  readonly candidateOrTargetSetDigest: string;
  readonly inputBindingDigest: string;
  readonly protocolFingerprint: string;
  readonly expectedWitnessFrontier: string;
  readonly protectedLeaseProofDigest: string | null;
}>;

export type PrivateResponseEvidenceV1 = Readonly<{
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly contentDigest: string;
  readonly byteLength: number;
  readonly privateStoreRecordId: string;
  readonly policyVersion: string;
}>;

export type ExternalOperationResponseStagedV2 = Readonly<{
  readonly eventType: "EXTERNAL_OPERATION_RESPONSE_STAGED";
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly responseEvidence: PrivateResponseEvidenceV1;
}>;

export type ExternalOperationResultCommittedV2 = Readonly<{
  readonly eventType: "EXTERNAL_OPERATION_RESULT_COMMITTED";
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly resultEventId: string;
  readonly redeliveryEvidenceDigest: string | null;
}>;

export type ExternalOperationOutcomeAppliedV2 = Readonly<{
  readonly eventType: "EXTERNAL_OPERATION_OUTCOME_APPLIED";
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly outcomeAppliedEventId: string;
}>;

export type VerifiedDispatchRecoveryCursorV1 = Readonly<{
  readonly kind:
    | "INTENT_PRE_LAUNCH"
    | "IN_FLIGHT"
    | "RESPONSE_STAGED"
    | "RESULT_COMMITTED_OUTCOME_PENDING"
    | "APPLIED"
    | "EVIDENCE_UNAVAILABLE";
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly operationId: string;
  readonly dispatchAttemptId: string;
  readonly role: string;
  readonly candidateOrTargetSetDigest: string;
  readonly inputBindingDigest: string;
  readonly protocolFingerprint: string;
  readonly dispatchEventId: string;
  readonly dispatchFrontierHash: string;
  readonly responseEvidence: PrivateResponseEvidenceV1 | null;
  readonly resultEventId: string | null;
  readonly outcomeAppliedEventId: string | null;
  readonly redeliveryEvidenceDigest: string | null;
}>;

export type VerifiedTerminalStateV1 = Readonly<{
  readonly kind:
    | "TERMINAL_REVOKE_PENDING"
    | "REVOKED_AWAITING_TERMINAL_PUBLICATION"
    | "TERMINAL_FINALIZED";
  readonly handoffOperationId: string;
  readonly terminalTransitionOperationId: string;
  readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
}>;


export type TrustedProtocolReleaseAnchorV1 = Readonly<{
  readonly installationId: string;
  readonly trustPolicyVersion: string;
  readonly publisherIdentityOrKeyDigest: string;
  readonly protectedRegistryHead: string;
  readonly initialFrontierDigest: string;
}>;

export type VerifiedProtocolReleaseDeltaV1 = Readonly<{
  readonly oldReleaseId: string;
  readonly newReleaseId: string;
  readonly oldDescriptorDigest: string;
  readonly newDescriptorDigest: string;
  readonly oldPhaseFingerprint: string;
  readonly newPhaseFingerprint: string;
  readonly chainProofDigest: string;
  readonly publisherProofDigest: string;
  readonly verifiedProtectedHead: string;
  readonly trustPolicyVersion: string;
}>;

export type FindingValidationCompletedV2 = Readonly<{
  readonly eventType: "FINDING_VALIDATION_COMPLETED";
  readonly operationId: string;
  readonly validationEventId: string;
  readonly disposition: "ALREADY_RESOLVED";
  readonly relation: "EXISTING";
  readonly lineageId: string;
  readonly priorCommittedResolutionEventId: string;
  readonly pinnedBaselineDigest: string;
  readonly semanticContextFingerprint: string;
  readonly validatedAbsenceProofDigest: string;
  readonly witnessedFrontierHash: string;
}>;

export type LineageRegressedV2 = Readonly<{
  readonly eventType: "LINEAGE_REGRESSED";
  readonly operationId: string;
  readonly validationEventId: string;
  readonly lineageId: string;
  readonly priorCommittedResolutionEventId: string;
  readonly pinnedBaselineDigest: string;
  readonly semanticContextFingerprint: string;
  readonly validatedPresenceProofDigest: string;
  readonly witnessedFrontierHash: string;
}>;

export type CrossGenerationReconciliationCompletedV2 = Readonly<{
  readonly eventType: "CROSS_GENERATION_RECONCILIATION_COMPLETED";
  readonly operationId: string;
  readonly validationEventId: string;
  readonly currentLineageId: string;
  readonly predecessorGateId: string | null;
  readonly predecessorLineageId: string | null;
  readonly result: "RELATED_PRIOR_GENERATION" | "NO_PRIOR_MATCH";
  readonly pinnedBaselineDigest: string;
  readonly semanticContextFingerprint: string;
  readonly witnessedFrontierHash: string;
}>;

export type VerifiedReviewWriterLeaseV1 = Readonly<{
  readonly installationId: string;
  readonly scopeId: string;
  readonly gateId: string;
  readonly generationId: string;
  readonly epochId: string;
  readonly operationId: string;
  readonly phase: ReviewGatePhase;
  readonly roundOrdinal: number;
  readonly targetCanonicalPath: string;
  readonly attemptId: string;
  readonly leaseGeneration: number;
  readonly expectedPreImageDigest: string;
  readonly expectedGitMode: "100644" | "100755";
  readonly witnessFrontierHash: string;
  readonly protectedLeaseProofDigest: string;
  readonly revokesAttemptId: string | null;
}>;

export type VerifiedCanonicalMutationTargetV1 = Readonly<{
  readonly installationId: string;
  readonly workspaceIdentity: string;
  readonly canonicalWorkspaceRoot: string;
  readonly canonicalLogicalTargetPath: string;
  readonly targetIdentityDigest: string;
  readonly verifiedAliasSetDigest: string;
  readonly identityProofFrontier: string;
}>;

export type VerifiedTargetWriterAuthorityV1 = Readonly<{
  readonly target: VerifiedCanonicalMutationTargetV1;
  readonly globalTargetWriterGeneration: number;
  readonly activeOwner: Readonly<{
    readonly scopeId: string;
    readonly gateId: string;
    readonly generationId: string;
    readonly operationId: string;
    readonly attemptId: string;
  }> | null;
  readonly priorOwner: Readonly<{
    readonly scopeId: string;
    readonly gateId: string;
    readonly generationId: string;
    readonly operationId: string;
    readonly attemptId: string;
  }> | null;
  readonly expectedImage: Readonly<{
    readonly digest: string;
    readonly gitMode: "100644" | "100755";
  }>;
  readonly protectedTargetFrontier: string;
  readonly protectedTargetCasProofDigest: string;
  readonly durableTombstoneProofDigest: string | null;
}>;

export type VerifiedTargetWriterHandoffV1 = Readonly<{
  readonly status: "REVOKED_NO_ACTIVE_WRITER" | "CLAIMED_CURRENT_WRITER" | "BLOCKED";
  readonly handoffOperationId: string;
  readonly target: VerifiedCanonicalMutationTargetV1;
  readonly priorOwner: VerifiedTargetWriterAuthorityV1["priorOwner"];
  readonly currentOwner: VerifiedTargetWriterAuthorityV1["activeOwner"];
  readonly persistedHighWatermark: number;
  readonly protectedTargetFrontier: string;
  readonly protectedTargetCasProofDigest: string;
  readonly nativeNonWriteabilityProofDigest: string | null;
}>;

export type VerifiedTargetWriterHandoffIntentV1 = Readonly<{
  readonly purpose: "HANDOFF" | "TERMINAL_REVOKE_ONLY";
  readonly status: "REQUESTED" | "FENCED" | "CLAIMED" | "RESUMED" | "BLOCKED";
  readonly handoffOperationId: string;
  readonly originalOperationId: string;
  readonly scopeId: string;
  readonly gateId: string;
  readonly generationId: string;
  readonly phase: ReviewGatePhase;
  readonly roundOrdinal: number;
  readonly protocolFingerprint: string;
  readonly target: VerifiedCanonicalMutationTargetV1;
  readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
  readonly closingSealOperationId: string | null;
  readonly oldOwner: VerifiedTargetWriterAuthorityV1["activeOwner"];
  readonly newOwner: Readonly<{
    readonly scopeId: string;
    readonly gateId: string;
    readonly generationId: string;
    readonly operationId: string;
    readonly attemptId: string;
  }> | null;
  readonly expectedTargetWriterFrontier: string;
  readonly expectedGlobalTargetWriterGeneration: number;
  readonly expectedGateEventFrontier: string;
  readonly expectedPreImageDigest: string;
  readonly expectedGitMode: "100644" | "100755";
  readonly pendingNativeEffectReference: string | null;
}>;

export type VerifiedTargetWriterHandoffContinuationV1 = Readonly<{
  readonly status: "REQUESTED" | "FENCED" | "CLAIMED" | "RESUMED" | "BLOCKED";
  readonly handoffOperationId: string;
  readonly originalOperationId: string;
  readonly intent: VerifiedTargetWriterHandoffIntentV1;
  readonly protectedTargetFrontier: string;
  readonly gateEventFrontier: string;
  readonly globalTargetWriterGeneration: number;
  readonly pendingNativeEffectReference: string | null;
  readonly continuationProofDigest: string;
}>;

export type VerifiedTerminalWriterRevokeV1 = Readonly<{
  readonly purpose: "TERMINAL_REVOKE_ONLY";
  readonly handoffOperationId: string;
  readonly terminalTransitionOperationId: string;
  readonly status: "REVOKED" | "NEVER_CLAIMED_OR_ALREADY_REVOKED";
  readonly gateId: string;
  readonly generationId: string;
  readonly phase: ReviewGatePhase;
  readonly roundOrdinal: number;
  readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
  readonly priorOwners: ReadonlyArray<NonNullable<VerifiedTargetWriterAuthorityV1["priorOwner"]>>;
  readonly globalTargetWriterHighWatermark: number;
  readonly protectedTargetFrontier: string;
  readonly protectedRevokeCasProofDigest: string;
  readonly nativeNonWriteabilityProofDigest: string;
  readonly nativeEffectDisposition: string;
}>;
export type VerifiedTargetWriterClosingSealV1 = Readonly<{
  readonly marker: "TARGET_CLOSING_SEALED";
  readonly closingSealOperationId: string;
  readonly handoffOperationId: string;
  readonly terminalTransitionOperationId: string;
  readonly gateId: string;
  readonly generationId: string;
  readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
  readonly publicationId: string;
  readonly preparedEventDigest: string;
  readonly preSealWitnessFrontier: string;
  readonly preSealTargetFrontier: string;
  readonly targetLeaseHighWatermark: number;
  readonly sealedReceiptDigest: string | null;
}>;

export type VerifiedClosingSealReceiptPayloadV1 = Readonly<{
  readonly domain: "justice-target-closing-seal-receipt-v1";
  readonly installationId: string;
  readonly closingSealOperationId: string;
  readonly handoffOperationId: string;
  readonly terminalTransitionOperationId: string;
  readonly gateId: string;
  readonly generationId: string;
  readonly publicationId: string;
  readonly preparedEventDigest: string;
  readonly targets: ReadonlyArray<VerifiedCanonicalMutationTargetV1>;
  readonly preSealTargetHead: string;
  readonly postSealTargetHead: string;
  readonly nativeEffectDisposition: string;
}>;

export type VerifiedClosingSealReceiptV1 = Readonly<{
  readonly payload: VerifiedClosingSealReceiptPayloadV1;
  readonly signature: string;
}>;

// ---------------------------------------------------------------------------
// Task 9 evidence interfaces shared with Task 11/12
// ---------------------------------------------------------------------------

export type VerifiedSemanticContext = Readonly<{
  readonly gateId: string;
  readonly generationId: string;
  readonly phase: ReviewGatePhase;
  readonly phaseBaselineId: string;
  readonly semanticContractFingerprint: string;
  readonly protocolFingerprint: string;
  readonly contextDigest: string;
}>;

export type SemanticBlockerEvidence = Readonly<{
  readonly lineageId: LineageId;
  readonly basisDigest: string;
  readonly semanticLocation: string;
  readonly ownerScope: "requirements" | "design" | "plan";
  readonly violationType: string;
  readonly governingReference: string;
  readonly violatedContract: string;
  readonly observationEventId: string;
}>;

export type ValidatedTargetOutcome = Readonly<{
  readonly lineageId: LineageId;
  readonly roundOrdinal: number;
  readonly result: "STILL_PRESENT" | "RESOLVED" | "INDETERMINATE";
  readonly validationEventId: string;
  readonly targetEventId: string;
}>;

export type VerifiedCommittedResolution = Readonly<{
  readonly lineageId: LineageId;
  readonly resolutionEventId: string;
  readonly verifiedCommitOid: string;
  readonly contextDigest: string;
}>;

export type VerifiedRegression = Readonly<{
  readonly lineageId: LineageId;
  readonly priorResolutionEventId: string;
  readonly newObservationEventId: string;
  readonly contextDigest: string;
}>;

/**
 * One recorded semantic round as projected from verified history, before
 * Task 12's builder validates cross-cycle links and freezes the result.
 * Landscape fields bind each pre/post blocker landscape to its witness
 * event, blocking count and semantic fingerprint; revision/segment fields
 * must link adjacent rounds exactly when consumed by Task 12.
 */
export type VerifiedCycleEvidence = Readonly<{
  readonly context: VerifiedSemanticContext;
  readonly roundOrdinal: number;
  readonly operationId: string;
  readonly roundStartedEventId: string;
  readonly preRevisionDigest: string;
  readonly postRevisionDigest: string;
  readonly revisionCommitEventId: string | null;
  readonly comparisonSegmentId: string;
  readonly preLandscapeEventId: string;
  readonly postLandscapeEventId: string;
  readonly preBlockers: readonly SemanticBlockerEvidence[];
  readonly postBlockers: readonly SemanticBlockerEvidence[];
  readonly preCount: number;
  readonly postCount: number;
  readonly preFingerprint: string;
  readonly postFingerprint: string;
  readonly targetOutcomes: readonly ValidatedTargetOutcome[];
  readonly committedResolutions: readonly VerifiedCommittedResolution[];
  readonly regressions: readonly VerifiedRegression[];
}>;


// ---------------------------------------------------------------------------
// Task 10 — exact-artifact Git commit and restore event payloads
// ---------------------------------------------------------------------------

export type ReviewCommitPreparedV2 = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly roundOrdinal: number;
  readonly targetCanonicalPath: string;
  readonly parentHeadSha: string;
  readonly expectedTargetEntry: Readonly<{
    readonly canonicalPath: string;
    readonly blobSha: string;
    readonly gitMode: "100644" | "100755";
  }>;
  readonly commitMessageDigest: string;
  readonly lineageIds: ReadonlyArray<LineageId>;
  readonly unrelatedIndexFingerprint: string;
  readonly preparedOperationId: string;
  readonly preparedRecoveryDigest: string;
}>;

export type RemediationCommitSucceededV2 = Readonly<{
  readonly preparedEventId: string;
  readonly commitId: string;
  readonly parentCommitId: string;
  readonly targetEntry: Readonly<{
    readonly canonicalPath: string;
    readonly blobSha: string;
    readonly gitMode: "100644" | "100755";
  }>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly verifiedMessageDigest: string;
}>;

export type ReviewCommitFailedV2 = Readonly<{
  readonly preparedEventId: string;
  readonly failureKind: "git_failure" | "scope_violation" | "verification_failure";
  readonly reasonDigest: string;
}>;

export type ReviewTargetRestorePreparedV2 = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly targetCanonicalPath: string;
  readonly sourceKnownDirtyBinding: Readonly<{
    readonly headSha: string;
    readonly headEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
    }>;
    readonly indexEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
      readonly stage: 0;
    }>;
    readonly worktree: Readonly<{
      readonly canonicalPath: string;
      readonly digest: string;
      readonly gitMode: "100644" | "100755";
    }>;
  }>;
  readonly targetCleanCommittedBinding: Readonly<{
    readonly headSha: string;
    readonly headEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
    }>;
    readonly indexEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
      readonly stage: 0;
    }>;
    readonly worktree: Readonly<{
      readonly canonicalPath: string;
      readonly digest: string;
      readonly gitMode: "100644" | "100755";
    }>;
  }>;
  readonly preparedOperationId: string;
  readonly preparedRecoveryDigest: string;
}>;

export type ReviewTargetRestoreSucceededV2 = Readonly<{
  readonly preparedEventId: string;
  readonly verifiedDestinationBinding: Readonly<{
    readonly headSha: string;
    readonly headEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
    }>;
    readonly indexEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
      readonly stage: 0;
    }>;
    readonly worktree: Readonly<{
      readonly canonicalPath: string;
      readonly digest: string;
      readonly gitMode: "100644" | "100755";
    }>;
  }>;
}>;

export type ReviewTargetRestoreRecoveredV2 = Readonly<{
  readonly preparedEventId: string;
  readonly verifiedDestinationBinding: Readonly<{
    readonly headSha: string;
    readonly headEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
    }>;
    readonly indexEntry: Readonly<{
      readonly canonicalPath: string;
      readonly blobSha: string;
      readonly gitMode: "100644" | "100755";
      readonly stage: 0;
    }>;
    readonly worktree: Readonly<{
      readonly canonicalPath: string;
      readonly digest: string;
      readonly gitMode: "100644" | "100755";
    }>;
  }>;
}>;