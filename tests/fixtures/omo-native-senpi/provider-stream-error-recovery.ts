import type {
  ProviderStreamErrorRecoveryInput,
  ProviderStreamErrorRecoveryObservations,
} from "./provider-stream-error-evidence-types";

export function evaluateProviderStreamErrorRecovery(
  input: ProviderStreamErrorRecoveryInput,
): Readonly<{
  readonly observations: ProviderStreamErrorRecoveryObservations;
  readonly postFailureToolCallIds: readonly string[];
  readonly postFailureToolResultCallIds: readonly string[];
}> {
  const { parentRows, failedToolCallId, failureSessionId, failureEpochAfter, invalidatedReadToolCallId } = input;
  const cachedActivationReissueRejected =
    invalidatedReadToolCallId !== null &&
    failureEpochAfter !== null &&
    parentRows.some(
      (row) =>
        row.event === "cached_activation_reissue_rejected" &&
        row.toolCallId === invalidatedReadToolCallId &&
        row.failureEpoch === failureEpochAfter &&
        row.invalidatedAuthorizationPresent === true,
    );
  const preFailureReadResultRejected =
    failureEpochAfter !== null &&
    parentRows.some(
      (row) =>
        row.event === "pre_failure_method_read_result_rejected" &&
        typeof row.readFailureEpoch === "number" &&
        row.readFailureEpoch < failureEpochAfter &&
        row.currentFailureEpoch === failureEpochAfter &&
        row.readStartedBeforeInvalidation === true &&
        row.activationRejected === true,
    );
  const freshReadToolCallId = "justice-spike-case-a-fresh-read";
  const freshReadStart = parentRows.find(
    (row) => row.event === "selected_method_read_started" && row.toolCallId === freshReadToolCallId,
  );
  const freshReadActivation = parentRows.find(
    (row) => row.event === "activation_evidence" && row.observedCallOrInputId === freshReadToolCallId,
  );
  const freshCapabilityIssuance = parentRows.find(
    (row) => row.event === "capability_issued_after_method_read" && row.toolCallId === freshReadToolCallId,
  );
  const freshContextDelivery = parentRows.find(
    (row) => row.event === "capability_context_delivered" && row.toolCallId === freshReadToolCallId,
  );
  const freshReadReauthorized =
    failureEpochAfter !== null &&
    freshReadStart?.failureEpoch === failureEpochAfter &&
    freshReadActivation?.failureEpochAtReadStart === failureEpochAfter &&
    freshReadActivation.failureEpochAtReadResult === failureEpochAfter &&
    freshCapabilityIssuance?.failureEpoch === failureEpochAfter &&
    freshContextDelivery?.readResultMessageFound === true;
  const lateToolCallId = "justice-spike-case-a-late-echo";
  const lateAssistantSanitation = parentRows.some(
    (row) =>
      row.event === "message_end_sanitized" &&
      row.toolCallId === lateToolCallId &&
      row.callbackObserved === true &&
      row.capabilityTokenPresentBeforeSanitization === true &&
      row.capabilityTokenAbsentAfterSanitization === true &&
      row.sanitizationChanged === true,
  );
  const lateAssistantAppend = input.assistantToolCallAppendObservations.some(
    (row) =>
      row.sessionId === failureSessionId &&
      row.toolCallId === lateToolCallId &&
      row.subscriptionEvent === "entry_appended" &&
      row.persistedEntryFullyMatchesEvent === true &&
      row.immediateJsonlReadBackMatched === true &&
      row.capabilityAbsentFromArguments === true,
  );
  const lateToolResultCallback = parentRows.some(
    (row) =>
      row.event === "synthetic_tool_result_message_end_observed" &&
      row.toolCallId === lateToolCallId &&
      row.sanitizerSource === "Senpi message_end callback" &&
      row.callbackObserved === true &&
      row.capabilityTokenAbsentAfterSanitization === true,
  );
  const lateToolResultReadback = input.syntheticToolResultObservations.some(
    (row) =>
      row.sessionId === failureSessionId &&
      row.toolCallId === lateToolCallId &&
      row.role === "toolResult" &&
      row.isError === true &&
      row.entryAppendedObserved === true &&
      row.immediateJsonlReadBackMatched === true &&
      row.capabilityAbsentFromResult === true,
  );
  const retiredSanitationCoverageThroughShutdown = parentRows.some(
    (row) =>
      row.event === "failure_retired_sanitation_coverage_at_shutdown" &&
      row.sessionId === failureSessionId &&
      row.afterSessionManagerReadback === true &&
      typeof row.retiredCapabilityCount === "number" &&
      row.retiredCapabilityCount > 0 &&
      row.retiredTokensStillSanitized === true,
  );
  const failedCallToolCalls = parentRows.filter(
    (row) => row.event === "tool_call" && String(row.toolCallId) === failedToolCallId,
  );
  const failedCallNotExecuted =
    failedCallToolCalls.length === 0 || failedCallToolCalls.every((row) => row.forcedFailureBlock === true);
  const noTrustedExecution =
    failedToolCallId !== null &&
    failedCallNotExecuted &&
    !parentRows.some((row) => row.event === "tool_result" && row.toolCallId === failedToolCallId) &&
    !parentRows.some(
      (row) => row.event === "runtime_task_identity_observed" && row.toolCallId === failedToolCallId,
    ) &&
    !parentRows.some(
      (row) => row.event === "authenticated_protocol_affiliation_observed" && row.toolCallId === failedToolCallId,
    );
  const freshReadIndex = freshReadStart === undefined ? -1 : parentRows.indexOf(freshReadStart);
  const unauthorizedPostFailureIssuance = parentRows.some(
    (row, index) =>
      row.event === "capability_issued_after_method_read" &&
      index > input.failureIndex &&
      (freshReadIndex < 0 || index < freshReadIndex) &&
      row.toolCallId !== invalidatedReadToolCallId,
  );
  const noNewAuthority =
    failedToolCallId !== null &&
    input.failureIndex >= 0 &&
    !parentRows.some(
      (row, index) =>
        index > input.failureIndex &&
        row.event === "authenticated_protocol_affiliation_observed" &&
        row.toolCallId === failedToolCallId,
    ) &&
    !parentRows.some(
      (row, index) =>
        index > input.failureIndex &&
        row.event === "capability_outbound_captured" &&
        row.toolCallId === failedToolCallId,
    ) &&
    !unauthorizedPostFailureIssuance;
  const postFailureToolCallIds = parentRows
    .filter(
      (row, index) =>
        index > input.messageEndIndex && row.event === "tool_call" && typeof row.toolCallId === "string",
    )
    .map((row) => String(row.toolCallId));
  const postFailureToolResultCallIds = parentRows
    .filter(
      (row, index) =>
        index > input.messageEndIndex && row.event === "tool_result" && typeof row.toolCallId === "string",
    )
    .map((row) => String(row.toolCallId));

  return {
    observations: {
      cachedActivationReissueRejected,
      preFailureReadResultRejected,
      freshReadReauthorized,
      lateAssistantSanitized: lateAssistantSanitation && lateAssistantAppend,
      lateToolResultSanitized: lateToolResultCallback && lateToolResultReadback,
      retiredSanitationCoverageThroughShutdown,
      noTrustedExecution,
      noNewAuthority,
    },
    postFailureToolCallIds,
    postFailureToolResultCallIds,
  };
}
