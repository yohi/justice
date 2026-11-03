import { evaluateProviderStreamErrorInvalidation } from "./provider-stream-error-invalidation";
import { evaluateProviderStreamErrorRecovery } from "./provider-stream-error-recovery";
import {
  PROVIDER_STREAM_ERROR_REQUIRED_OBSERVATIONS,
  type ProviderStreamErrorControl,
  type ProviderStreamErrorControlInput,
  type ProviderStreamErrorObservationName,
} from "./provider-stream-error-evidence-types";

export function evaluateProviderStreamErrorControl(
  input: ProviderStreamErrorControlInput,
): ProviderStreamErrorControl {
  const invalidation = evaluateProviderStreamErrorInvalidation(input);
  const recovery = evaluateProviderStreamErrorRecovery({
    rows: input.rows,
    parentRows: invalidation.parentRows,
    failedToolCallId: invalidation.failedToolCallId,
    failureSessionId: invalidation.failureSessionId,
    failureEpochAfter: invalidation.failureEpochAfter,
    invalidatedReadToolCallId: invalidation.invalidatedReadToolCallId,
    messageEndIndex: invalidation.messageEndIndex,
    failureIndex: invalidation.failureIndex,
    assistantToolCallAppendObservations: input.assistantToolCallAppendObservations,
    syntheticToolResultObservations: input.syntheticToolResultObservations,
  });
  const requiredObservations: Readonly<Record<ProviderStreamErrorObservationName, boolean>> = {
    ...invalidation.observations,
    ...recovery.observations,
  };
  const missingEvidence = PROVIDER_STREAM_ERROR_REQUIRED_OBSERVATIONS.filter(
    (observation) => requiredObservations[observation] !== true,
  );
  return {
    status: missingEvidence.length === 0 ? "PROVEN" : "BLOCKED",
    streamErrorObserved: requiredObservations.providerStreamErrorObserved,
    failedToolCallId: invalidation.failedToolCallId,
    failureSessionId: invalidation.failureSessionId,
    candidateReceiptCount: invalidation.candidateReceiptCount,
    failureEpochBefore: invalidation.failureEpochBefore,
    failureEpochAfter: invalidation.failureEpochAfter,
    postFailureToolCallIds: recovery.postFailureToolCallIds,
    postFailureToolResultCallIds: recovery.postFailureToolResultCallIds,
    requiredObservations,
    missingEvidence,
  };
}
