import type {
  ProviderStreamErrorControlInput,
  ProviderStreamErrorInvalidationEvidence,
} from "./provider-stream-error-evidence-types";

export function evaluateProviderStreamErrorInvalidation(
  input: ProviderStreamErrorControlInput,
): ProviderStreamErrorInvalidationEvidence {
  const parentRows = input.rows.filter((row) => row.sessionId === input.parentSessionId);
  const messageEnd = parentRows.find(
    (row) => row.event === "message_end_forced_failure_injected" && row.failureSurface === "provider_stream_error",
  );
  const failedToolCallId = typeof messageEnd?.toolCallId === "string" ? messageEnd.toolCallId : null;
  const failureSessionId = typeof messageEnd?.sessionId === "string" ? messageEnd.sessionId : null;
  const authority = parentRows.find(
    (row) => row.event === "provider_stream_error_authority_invalidated" && row.toolCallId === failedToolCallId,
  );
  const failureState = parentRows.find(
    (row) => row.event === "failure_authority_invalidated" && row.failureSurface === "provider_stream_error",
  );
  const candidateReceiptCount = typeof authority?.candidateReceiptCount === "number" ? authority.candidateReceiptCount : 0;
  const failureEpochBefore = typeof authority?.failureEpochBefore === "number" ? authority.failureEpochBefore : null;
  const failureEpochAfter = typeof authority?.failureEpochAfter === "number" ? authority.failureEpochAfter : null;
  const receiptReplayRows = parentRows.filter(
    (row) =>
      row.event === "provider_stream_error_receipt_replay_rejected" &&
      row.toolCallId === failedToolCallId &&
      row.receiptCapturedBeforeFailure === true,
  );
  const invalidatedReadToolCallId =
    typeof failureState?.invalidatedActivationReadToolCallId === "string"
      ? failureState.invalidatedActivationReadToolCallId
      : null;
  const readback = parentRows.find(
    (row) => row.event === "session_manager_history_readback" && row.phase === "session_shutdown",
  );
  const callbackObserved = messageEnd?.callbackObserved === true && failedToolCallId !== null;
  const readbackMatchesFailure =
    readback !== undefined &&
    readback.sessionId === failureSessionId &&
    readback.headerValid === true &&
    readback.headerCount === 1 &&
    readback.entryIdsAndBranchesMatch === true &&
    readback.providerStreamErrorMemoryEntries === 1 &&
    readback.providerStreamErrorDiskEntries === 1 &&
    readback.providerStreamErrorTokenFreeInMemory === true &&
    readback.providerStreamErrorTokenFreeInDisk === true &&
    readback.tokenFoundInMemoryEntries === false &&
    readback.tokenFoundInDiskEntries === false &&
    readback.unsafeStorage === false &&
    input.harnessFinalScanSafe;
  const observations = {
    providerStreamErrorObserved:
      callbackObserved &&
      input.rows.some(
        (row) => row.event === "provider_stream_error_emitted" && row.toolCallId === failedToolCallId,
      ),
    messageEndObserved: callbackObserved,
    normalSanitationApplied: messageEnd?.normalMessageEndSanitationApplied === true,
    tokenFreeCanonicalPersistence: readbackMatchesFailure,
    candidateReceiptCaptured:
      candidateReceiptCount > 0 &&
      authority?.candidateReceiptCaptured === true &&
      parentRows.some(
        (row) =>
          row.event === "capability_outbound_captured" &&
          row.toolCallId === failedToolCallId &&
          row.captureSurface === "assistant_message_end_before_append",
      ),
    candidateReceiptsInvalidated:
      candidateReceiptCount > 0 &&
      authority?.candidateReceiptsInvalidated === true &&
      receiptReplayRows.length > 0 &&
      receiptReplayRows.every((row) => row.receiptReplayRejected === true),
    liveCapabilityInvalidated:
      failureState?.liveCapabilityWasValidBeforeFailure === true && authority?.liveCapabilityInvalidated === true,
    activationInvalidated:
      failureState?.activationWasActiveBeforeFailure === true && authority?.activationInvalidated === true,
    durableMethodSelectionPreserved:
      invalidatedReadToolCallId !== null &&
      readback?.selectedMethodReadPersistedInMemory === true &&
      readback.selectedMethodReadPersistedInDisk === true &&
      readback.entryIdsAndBranchesMatch === true &&
      readback.unsafeStorage === false &&
      parentRows.some(
        (row) =>
          row.event === "activation_evidence" &&
          row.observedCallOrInputId === invalidatedReadToolCallId &&
          row.sessionId === failureSessionId,
      ),
    oldReceiptReplayRejected:
      receiptReplayRows.length > 0 && receiptReplayRows.every((row) => row.receiptReplayRejected === true),
  } as const;

  return {
    parentRows,
    failedToolCallId,
    failureSessionId,
    candidateReceiptCount,
    failureEpochBefore,
    failureEpochAfter,
    invalidatedReadToolCallId,
    messageEndIndex: messageEnd === undefined ? -1 : parentRows.indexOf(messageEnd),
    failureIndex: authority === undefined ? -1 : parentRows.indexOf(authority),
    observations,
  };
}
