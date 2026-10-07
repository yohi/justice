export type ReviewScopeId = string & { readonly __brand: "ReviewScopeId" };
export type GateId = string & { readonly __brand: "GateId" };
export type WriterId = string & { readonly __brand: "WriterId" };
export type EpochId = string & { readonly __brand: "EpochId" };
export type LineageId = string & { readonly __brand: "LineageId" };
export type FindingId = string & { readonly __brand: "FindingId" };
export type ArtifactDigest = string & { readonly __brand: "ArtifactDigest" };

export type ReviewGatePhase = "design" | "plan";
export type ReviewGateStatus = "active" | "suspended" | "completed";
export const MAX_DESIGN_REMEDIATION_ROUNDS = 5;
export const MAX_PLAN_REMEDIATION_ROUNDS = 3;
export type ReviewGateSuspensionReason =
  | "reopen_required"
  | "round_limit_exhausted"
  | "review_non_convergent"
  | "execution_suspended";

export type ReviewGateLockTarget =
  | Readonly<{ readonly kind: "scope"; readonly reviewScopeId: ReviewScopeId }>
  | Readonly<{ readonly kind: "gate"; readonly gateId: GateId }>
  | Readonly<{ readonly kind: "recovery-gc" }>;

export type RemediationRound = Readonly<{
  readonly phase: ReviewGatePhase;
  readonly ordinal: number;
}>;

export type ReviewGateEpoch = Readonly<{
  readonly epochId: EpochId;
  readonly startedAt: string;
  readonly reason:
    | "gate_created"
    | "orchestration_resumed"
    | "reopen_accepted"
    | "execution_resumed";
}>;

export type ReviewArtifactBinding = Readonly<{
  readonly canonicalPath: string;
  readonly digest: ArtifactDigest;
  readonly gitMode: "100644" | "100755";
}>;

export type RequirementsResolutionV1 = Readonly<{
  readonly source: "explicit" | "auto_design_reference";
  readonly canonicalPath: string;
  readonly digest: ArtifactDigest;
  readonly designReferenceEvidence?: Readonly<{
    readonly referenceKind: string;
    readonly logicalLocation: string;
  }> | undefined;
}>;

export type DesignProtocolDescriptorV1 = Readonly<{
  readonly designReviewContractVersion: string;
  readonly findingValidatorContractVersion: string;
  readonly remediationContractVersion: string;
  readonly selfReviewContractVersion: string;
  readonly requirementsResolutionPolicyVersion: string;
  readonly severityPolicyVersion: string;
  readonly designReopenPolicyVersion: string;
  readonly resolutionPolicyVersion: string;
  readonly lineagePolicyVersion: string;
  readonly convergencePolicyVersion: string;
  readonly designRoundLimit: number;
  readonly staticReviewerPromptDigest: ArtifactDigest;
  readonly staticValidatorPromptDigest: ArtifactDigest;
  readonly staticRemediatorPromptDigest: ArtifactDigest;
  readonly staticSelfReviewerPromptDigest: ArtifactDigest;
  readonly deterministicValidationSemanticContract: ArtifactDigest;
}>;

export type PlanProtocolDescriptorV1 = Readonly<{
  readonly planReviewContractVersion: string;
  readonly findingValidatorContractVersion: string;
  readonly remediationContractVersion: string;
  readonly selfReviewContractVersion: string;
  readonly severityPolicyVersion: string;
  readonly planReopenPolicyVersion: string;
  readonly resolutionPolicyVersion: string;
  readonly lineagePolicyVersion: string;
  readonly convergencePolicyVersion: string;
  readonly planRoundLimit: number;
  readonly staticReviewerPromptDigest: ArtifactDigest;
  readonly staticValidatorPromptDigest: ArtifactDigest;
  readonly staticRemediatorPromptDigest: ArtifactDigest;
  readonly staticSelfReviewerPromptDigest: ArtifactDigest;
  readonly deterministicValidationSemanticContract: ArtifactDigest;
}>;

export type CrossPhaseProtocolDescriptorV1 = Readonly<{
  readonly crossPhaseContractVersion: string;
  readonly convergencePolicyVersion: string;
  readonly lineagePolicyVersion: string;
  readonly bindingPolicyVersion: string;
  readonly deterministicValidationSemanticContract: ArtifactDigest;
}>;

export type ReviewProtocolDescriptorV1 = Readonly<{
  readonly design: DesignProtocolDescriptorV1;
  readonly plan: PlanProtocolDescriptorV1;
  readonly crossPhase: CrossPhaseProtocolDescriptorV1;
}>;

export type ReviewProtocolFingerprintV1 = Readonly<{
  readonly reviewProtocolFingerprint: string;
  readonly designProtocolFingerprint: string;
  readonly planProtocolFingerprint: string;
}>;

export type ReviewApprovalBindingV1 = Readonly<{
  readonly reviewScopeId: ReviewScopeId;
  readonly gateId: GateId;
  readonly designArtifact: ReviewArtifactBinding;
  readonly planArtifact: ReviewArtifactBinding;
  readonly requirementsResolution: RequirementsResolutionV1;
  readonly reviewProtocolFingerprint: string;
  readonly designProtocolFingerprint: string;
  readonly planProtocolFingerprint: string;
  readonly approvedAt: string;
}>;

type EventBase<Type extends string, Payload> = Readonly<{
  readonly eventType: Type;
  readonly gateId: GateId;
  readonly writerId: WriterId;
  readonly epochId: EpochId;
  readonly emittedAt: string;
  readonly payload: Readonly<Payload>;
}>;

export type GateCreatedV1 = EventBase<"GATE_CREATED", Readonly<{
  readonly reviewScopeId: ReviewScopeId;
  readonly designArtifact: ReviewArtifactBinding;
  readonly planArtifact: ReviewArtifactBinding;
  readonly requirementsResolution: RequirementsResolutionV1;
  readonly reviewProtocolFingerprint: string;
}>>;
export type OrchestrationResumedV1 = EventBase<"ORCHESTRATION_RESUMED", Readonly<{ readonly resumedAt: string }>>;
export type DesignClearV1 = EventBase<"DESIGN_CLEAR", Readonly<{ readonly designProtocolFingerprint: string }>>;
export type PlanClearV1 = EventBase<"PLAN_CLEAR", Readonly<{ readonly completedApprovalBinding: ReviewApprovalBindingV1 }>>;
export type ReopenRequiredV1 = EventBase<"REOPEN_REQUIRED", Readonly<{ readonly phase: ReviewGatePhase; readonly lineageIds: ReadonlyArray<LineageId> }>>;
export type RoundLimitExhaustedV1 = EventBase<"ROUND_LIMIT_EXHAUSTED", Readonly<{ readonly phase: ReviewGatePhase; readonly roundLimit: number }>>;
export type ReviewNonConvergentV1 = EventBase<"REVIEW_NON_CONVERGENT", Readonly<{ readonly phase: ReviewGatePhase; readonly lineageIds: ReadonlyArray<LineageId> }>>;
export type ExecutionSuspendedV1 = EventBase<"EXECUTION_SUSPENDED", Readonly<{ readonly reason: string }>>;
export type FindingDiscoveredV1 = EventBase<"FINDING_DISCOVERED", Readonly<{ readonly lineageId: LineageId; readonly findingId: FindingId; readonly observedPhase: ReviewGatePhase; readonly ownerScope: "requirements" | "design" | "plan"; readonly descriptionDigest: ArtifactDigest }>>;
export type FindingRemediatedV1 = EventBase<"FINDING_REMEDIATED", Readonly<{ readonly lineageId: LineageId; readonly findingId: FindingId; readonly remediationRound: RemediationRound }>>;
export type FindingSelfReviewedV1 = EventBase<"FINDING_SELF_REVIEWED", Readonly<{ readonly lineageId: LineageId; readonly findingId: FindingId; readonly remediationRound: RemediationRound }>>;
export type FindingReopenedV1 = EventBase<"FINDING_REOPENED", Readonly<{ readonly lineageId: LineageId; readonly findingId: FindingId; readonly reopenedBy: EpochId }>>;
export type CompletedApprovalBindingV1 = EventBase<"COMPLETED_APPROVAL_BINDING", Readonly<{ readonly approvalBinding: ReviewApprovalBindingV1 }>>;

export type ReviewGateEvent =
  | GateCreatedV1
  | OrchestrationResumedV1
  | DesignClearV1
  | PlanClearV1
  | ReopenRequiredV1
  | RoundLimitExhaustedV1
  | ReviewNonConvergentV1
  | ExecutionSuspendedV1
  | FindingDiscoveredV1
  | FindingRemediatedV1
  | FindingSelfReviewedV1
  | FindingReopenedV1
  | CompletedApprovalBindingV1;

export type FindingState = Readonly<{
  readonly lineageId: LineageId;
  readonly findingId: FindingId;
  readonly observedPhase: ReviewGatePhase;
  readonly ownerScope: "requirements" | "design" | "plan";
  readonly descriptionDigest: ArtifactDigest;
  readonly status: "open" | "remediated" | "self_reviewed" | "reopened";
  readonly remediationRound: RemediationRound | null;
  readonly reopenedBy: EpochId | null;
}>;

export type ReviewGateState = Readonly<{
  readonly reviewScopeId: ReviewScopeId;
  readonly gateId: GateId;
  readonly status: ReviewGateStatus;
  readonly phase: ReviewGatePhase;
  readonly epoch: ReviewGateEpoch;
  readonly designRemediationRounds: ReadonlyArray<RemediationRound>;
  readonly planRemediationRounds: ReadonlyArray<RemediationRound>;
  readonly findings: ReadonlyMap<LineageId, FindingState>;
  readonly suspensionReason: ReviewGateSuspensionReason | null;
  readonly approvalBinding: ReviewApprovalBindingV1 | null;
  readonly supersedesGateId: GateId | null;
}>;
