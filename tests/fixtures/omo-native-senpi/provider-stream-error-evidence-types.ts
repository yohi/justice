export type EvidenceRow = Readonly<Record<string, unknown>>;

export const PROVIDER_STREAM_ERROR_REQUIRED_OBSERVATIONS = [
  "providerStreamErrorObserved",
  "messageEndObserved",
  "normalSanitationApplied",
  "tokenFreeCanonicalPersistence",
  "candidateReceiptCaptured",
  "candidateReceiptsInvalidated",
  "liveCapabilityInvalidated",
  "activationInvalidated",
  "durableMethodSelectionPreserved",
  "oldReceiptReplayRejected",
  "cachedActivationReissueRejected",
  "preFailureReadResultRejected",
  "freshReadReauthorized",
  "lateAssistantSanitized",
  "lateToolResultSanitized",
  "retiredSanitationCoverageThroughShutdown",
  "noTrustedExecution",
  "noNewAuthority",
] as const;

export type ProviderStreamErrorObservationName = (typeof PROVIDER_STREAM_ERROR_REQUIRED_OBSERVATIONS)[number];
export type ProviderStreamErrorObservations = Readonly<Record<ProviderStreamErrorObservationName, boolean>>;

export type ProviderStreamErrorControl = Readonly<{
  readonly status: "PROVEN" | "BLOCKED";
  readonly streamErrorObserved: boolean;
  readonly failedToolCallId: string | null;
  readonly failureSessionId: string | null;
  readonly candidateReceiptCount: number;
  readonly failureEpochBefore: number | null;
  readonly failureEpochAfter: number | null;
  readonly postFailureToolCallIds: readonly string[];
  readonly postFailureToolResultCallIds: readonly string[];
  readonly requiredObservations: ProviderStreamErrorObservations;
  readonly missingEvidence: readonly ProviderStreamErrorObservationName[];
}>;

export type ProviderStreamErrorControlInput = Readonly<{
  readonly rows: readonly EvidenceRow[];
  readonly parentSessionId: string | undefined;
  readonly assistantToolCallAppendObservations: readonly EvidenceRow[];
  readonly syntheticToolResultObservations: readonly EvidenceRow[];
  readonly harnessFinalScanSafe: boolean;
}>;

export type ProviderStreamErrorInvalidationEvidence = Readonly<{
  readonly parentRows: readonly EvidenceRow[];
  readonly failedToolCallId: string | null;
  readonly failureSessionId: string | null;
  readonly candidateReceiptCount: number;
  readonly failureEpochBefore: number | null;
  readonly failureEpochAfter: number | null;
  readonly invalidatedReadToolCallId: string | null;
  readonly messageEndIndex: number;
  readonly failureIndex: number;
  readonly observations: Readonly<
    Pick<
      ProviderStreamErrorObservations,
      | "providerStreamErrorObserved"
      | "messageEndObserved"
      | "normalSanitationApplied"
      | "tokenFreeCanonicalPersistence"
      | "candidateReceiptCaptured"
      | "candidateReceiptsInvalidated"
      | "liveCapabilityInvalidated"
      | "activationInvalidated"
      | "durableMethodSelectionPreserved"
      | "oldReceiptReplayRejected"
    >
  >;
}>;

export type ProviderStreamErrorRecoveryObservations = Readonly<
  Pick<
    ProviderStreamErrorObservations,
    | "cachedActivationReissueRejected"
    | "preFailureReadResultRejected"
    | "freshReadReauthorized"
    | "lateAssistantSanitized"
    | "lateToolResultSanitized"
    | "retiredSanitationCoverageThroughShutdown"
    | "noTrustedExecution"
    | "noNewAuthority"
  >
>;

export type ProviderStreamErrorRecoveryInput = Readonly<{
  readonly rows: readonly EvidenceRow[];
  readonly parentRows: readonly EvidenceRow[];
  readonly failedToolCallId: string | null;
  readonly failureSessionId: string | null;
  readonly failureEpochAfter: number | null;
  readonly invalidatedReadToolCallId: string | null;
  readonly messageEndIndex: number;
  readonly failureIndex: number;
  readonly assistantToolCallAppendObservations: readonly EvidenceRow[];
  readonly syntheticToolResultObservations: readonly EvidenceRow[];
}>;
