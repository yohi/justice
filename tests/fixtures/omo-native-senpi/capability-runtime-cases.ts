import {
  decodeTaskCapabilityEnvelope,
  FixtureCapabilityRegistry,
  type NativeCapabilityValidationResult,
  type NativeSuperpowersActivationBinding,
  type NativeSuperpowersProvenanceInput,
  type NativeSuperpowersTaskCapability,
} from "./capability-probe";
import { REQUIRED_STORAGE_CLASSES } from "./capability-session-storage";
import type { MockStep } from "./task-e2e-mock-provider";

/**
 * Fixture-only capability runtime registry.
 * Retains exact Plan-required signatures; implements no production API.
 */
const capabilityRuntimeRegistry = new FixtureCapabilityRegistry();

export function issueFixtureCapability(read: {
  readonly sessionId: string;
  readonly toolCallId: string;
  readonly method: "subagent-driven-development" | "executing-plans";
  readonly authorizationId: string;
}): NativeSuperpowersTaskCapability {
  const binding: NativeSuperpowersActivationBinding = {
    schemaVersion: "justice-native-superpowers-activation-binding-v1",
    authorizationId: read.authorizationId,
    sessionId: read.sessionId,
    method: read.method,
    evidenceKind: "read_tool_result",
    issuedFromReadToolCallId: read.toolCallId,
    observedAt: new Date().toISOString(),
  };
  capabilityRuntimeRegistry.registerActivation(binding);
  const capability = capabilityRuntimeRegistry.issue(binding);
  if (!capability) {
    throw new Error("issueFixtureCapability: registry refused issuance");
  }
  return capability;
}

export function validateFixtureCapability(
  input: NativeSuperpowersProvenanceInput,
): NativeCapabilityValidationResult {
  return capabilityRuntimeRegistry.validate(input);
}

export type CapabilityRuntimeCaseName =
  | "task1_context_copy_delivers_fixture_capability_after_method_read"
  | "task1_model_transports_capability_in_description"
  | "task1_tool_call_binds_capability_session_and_call"
  | "task1_probe_strips_capability_before_omo_execution"
  | "task1_wrong_session_capability_is_rejected"
  | "task1_accepted_compaction_and_restart_invalidate_capability"
  | "task1_wrong_authorization_and_method_capabilities_are_rejected"
  | "task1_expired_malformed_and_duplicate_capabilities_are_rejected"
  | "task1_raw_evidence_redacts_credentials_and_capabilities"
  | "task1_batch_echo_and_stale_transcripts_cannot_restore_capability"
  | "task1_unverified_transcript_guard_profile_does_not_issue_capability"
  | "task1_non_task_tool_capability_echo_is_blocked_before_execution"
  | "task1_unknown_tool_capability_echo_is_sanitized_before_persistence"
  | "task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference"
  | "task1_capability_never_enters_persisted_session_history"
  | "task1_capability_is_removed_before_assistant_tool_call_persistence"
  | "task1_message_end_fallback_prevents_token_persistence_on_error"
  | "task1_unsupported_in_process_and_nested_calls_remain_untrusted";

type EvidenceRow = Readonly<Record<string, unknown>>;

type CapabilityRuntimeCaseResult = {
  readonly status: "PROVEN" | "BLOCKED";
  readonly evidenceRefs: readonly string[];
};

let cachedRows: readonly EvidenceRow[] | undefined;
let cachedParentSessionId: string | undefined;
let cachedChildSessionId: string | undefined;
let cachedFixtureEnvelope: string | undefined;
let cachedRawEvidenceText: string | undefined;
let cachedCapabilityEnvVarAbsent: boolean | undefined;

export function setCapabilityRuntimeEvidence(
  rows: readonly EvidenceRow[],
  parentSessionId: string | undefined,
  childSessionId: string | undefined,
  fixtureEnvelope: string,
  rawEvidenceText: string,
  capabilityEnvVarAbsent: boolean,
): void {
  cachedRows = rows;
  cachedParentSessionId = parentSessionId;
  cachedChildSessionId = childSessionId;
  cachedFixtureEnvelope = fixtureEnvelope;
  cachedRawEvidenceText = rawEvidenceText;
  cachedCapabilityEnvVarAbsent = capabilityEnvVarAbsent;
}

function parentRows(rows: readonly EvidenceRow[], parentSessionId: string | undefined): readonly EvidenceRow[] {
  return rows.filter((row) => row.sessionId === parentSessionId);
}

function requireEvidence(): {
  rows: readonly EvidenceRow[];
  parentSessionId: string;
  childSessionId: string | undefined;
  fixtureEnvelope: string;
  rawEvidenceText: string;
  capabilityEnvVarAbsent: boolean;
} {
  const capabilityEnvVarAbsent = cachedCapabilityEnvVarAbsent;
  if (
    cachedRows === undefined ||
    cachedParentSessionId === undefined ||
    cachedFixtureEnvelope === undefined ||
    cachedRawEvidenceText === undefined ||
    capabilityEnvVarAbsent === undefined
  ) {
    throw new Error("runCapabilityRuntimeCase: capability runtime evidence not set");
  }
  return {
    rows: cachedRows,
    parentSessionId: cachedParentSessionId,
    childSessionId: cachedChildSessionId,
    fixtureEnvelope: cachedFixtureEnvelope,
    rawEvidenceText: cachedRawEvidenceText,
    capabilityEnvVarAbsent,
  };
}

function bool(value: unknown): boolean {
  return value === true;
}


export async function runCapabilityRuntimeCase(
  name: CapabilityRuntimeCaseName,
): Promise<CapabilityRuntimeCaseResult> {
  const { rows, parentSessionId, childSessionId, fixtureEnvelope, rawEvidenceText, capabilityEnvVarAbsent } = requireEvidence();
  const contracts = evaluateCapabilityRuntimeContracts({
    rows,
    parentSessionId,
    childSessionId,
    fixtureEnvelope,
    rawEvidenceText,
    capabilityEnvVarAbsent,
  }).contracts;
  const proven = contracts[name] === true;
  return {
    status: proven ? "PROVEN" : "BLOCKED",
    evidenceRefs: proven ? [`contract:${name}`] : [`contract:${name}:missing`],
  };
}

export type CapabilityRuntimeContractsInput = {
  readonly rows: readonly EvidenceRow[];
  readonly parentSessionId: string | undefined;
  readonly childSessionId?: string | undefined;
  readonly fixtureEnvelope: string;
  readonly rawEvidenceText: string;
  readonly capabilityEnvVarAbsent: boolean;
};

export type CapabilityRuntimeContracts = {
  readonly contracts: Readonly<Record<CapabilityRuntimeCaseName, boolean>>;
};

export function evaluateCapabilityRuntimeContracts(
  input: CapabilityRuntimeContractsInput,
): CapabilityRuntimeContracts {
  const { rows, parentSessionId, childSessionId, fixtureEnvelope, rawEvidenceText } = input;
  const prow = parentRows(rows, parentSessionId);

  // RG-001: the capability must be delivered via a deep-copied request-local context
  // message (not environment injection), with the persisted read ToolResult unchanged
  // and token-free under real session storage.
  const contextCopyDeliveries = prow.filter(
    (row) => row.event === "capability_context_delivered" && row.deliveryKind === "request_local_context_copy",
  );
  const contextCopyDelivered = contextCopyDeliveries.some(
    (row) =>
      row.readResultMessageFound === true &&
      row.contextMessagesDeepCopied === true &&
      row.directiveAttachedToCopy === true &&
      row.originalReadResultUnmodified === true,
  );
  const postDeliveryScanSafe = prow.some(
    (row) =>
      row.event === "storage_scan" &&
      row.label === "after_capability_context_delivery" &&
      row.tokenFound === false &&
      row.unsafeStorage === false,
  );
  const envFallbackAbsentForDelivery = input.capabilityEnvVarAbsent === true;
  const capabilityContextDelivered = contextCopyDelivered && postDeliveryScanSafe && envFallbackAbsentForDelivery;

  // RG-001: the model transport must source the envelope from context.messages only.
  const capabilityStrip = prow.find(
    (row) => row.event === "tool_call_capability_stripped" && row.hadCapability === true,
  );
  const capabilitySourcedFromContext = rows.some(
    (row) =>
      row.event === "mock_provider_context" &&
      row.isChild === false &&
      row.capabilityInContext === true &&
      row.capabilitySource === "context_messages" &&
      row.envCapabilityVarPresent === false,
  );
  const capabilityTransportedInDescription =
    prow.some((row) => row.event === "tool_call_capability_stripped" && bool(row.hadCapabilityMarker)) &&
    capabilitySourcedFromContext &&
    input.capabilityEnvVarAbsent === true;
  const capabilityBound = capabilityStrip !== undefined && capabilityContextDelivered;

  const rejections = rows.filter((row) => row.event === "capability_presentation_rejected");
  const wrongSessionRejected = rejections.some(
    (row) =>
      row.surface === "wrong_session_registry" &&
      row.reason === "wrong_session" &&
      typeof row.observedSessionId === "string" &&
      typeof row.expectedSessionId === "string" &&
      row.observedSessionId !== row.expectedSessionId,
  );
  const wrongAuthzRejected = rejections.some(
    (row) => row.surface === "wrong_authorization" && row.reason === "stale_transcript_replay",
  );
  const wrongMethodRejected = rejections.some(
    (row) => row.surface === "wrong_method" && row.reason === "method_mismatch",
  );
  const unverifiedProfileRejected = rejections.some(
    (row) => row.surface === "unverified_guard_profile" && row.reason === "unverified_guard_profile",
  );
  const acceptedPresentationRows = rows.filter((row) => row.event === "capability_presentation_accepted");
  const realCapabilityIssued = acceptedPresentationRows.length > 0 || contextCopyDelivered;
  const expiredMalfDup =
    rejections.some((row) => row.surface === "expired" && row.reason === "expired") &&
    rejections.some((row) => row.surface === "malformed" && row.reason === "malformed_capability") &&
    rejections.some((row) => row.surface === "duplicate" && row.reason === "duplicate_capability");

  const compactionRows = rows.filter((row) => row.event === "capability_invalidated_by_compaction");
  const acceptedCompaction = compactionRows.some((row) => bool(row.accepted));
  const restartRows = rows.filter((row) => row.event === "capability_invalidated_by_restart");
  const restartInvalidated = restartRows.length > 0;

  const untrustedRows = rows.filter((row) => row.event === "task_source_untrusted");
  const hasInProcessUntrusted = untrustedRows.some(
    (row) => row.classificationKind === "in_process" && row.reason === "untrusted_in_process",
  );
  const hasNestedUntrusted = untrustedRows.some(
    (row) => row.classificationKind === "nested" && row.reason === "untrusted_nested_call",
  );

  const replayRows = rows.filter((row) => row.event === "capability_presentation_rejected");
  const staleReplayRejected = replayRows.some(
    (row) =>
      (row.surface === "stale_transcript_replay" || row.surface === "post_compaction_tombstone") &&
      row.reason === "stale_transcript_replay",
  );
  const batchEchoSanitized = prow.some(
    (row) => row.event === "message_end_sanitized" && bool(row.hadCapability),
  );

  // RG-002.1: authoritative storage coverage. Every scan must be token-free and safe,
  // and the final authoritative scan must observe every required storage class.
  const storageScanRows = rows.filter((row) => row.event === "storage_scan");
  const anyStorageScanPerformed = storageScanRows.length > 0;
  const allStorageScansSafe =
    anyStorageScanPerformed &&
    storageScanRows.every((row) => bool(row.tokenFound) === false && bool(row.unsafeStorage) === false);
  const finalScanRows = storageScanRows.filter(
    (row) => row.label === "final_authoritative" && row.source === "harness_post_exit_scan",
  );
  const parentAndChildSessionStarted =
    typeof parentSessionId === "string" &&
    typeof childSessionId === "string" &&
    [parentSessionId, childSessionId].every((sessionId) =>
      rows.some((row) => row.event === "session_start" && row.sessionId === sessionId),
    );
  const finalScanClassesComplete = finalScanRows.some(
    (row) =>
      Array.isArray(row.classesObserved) &&
      REQUIRED_STORAGE_CLASSES.every((cls) => (row.classesObserved as readonly string[]).includes(cls)) &&
      typeof row.explicitSessionFilesRequired === "number" &&
      row.explicitSessionFilesObserved === row.explicitSessionFilesRequired &&
      typeof row.sessionIdsRequired === "number" &&
      row.sessionIdsRequired >= 2 &&
      row.sessionIdsObserved === row.sessionIdsRequired,
  );
  const tokenFreeReadBackValidated =
    allStorageScansSafe && parentAndChildSessionStarted && finalScanClassesComplete;

  // RG-002.2: real processing failure after capture/sanitation with the runtime's
  // same-role minimal error fallback persisted, token-free, without a raw exception
  // stack, without outbound receipt, and without executing the trusted task.
  const fallbackInjectionRows = prow.filter((row) => row.event === "message_end_forced_failure_injected");
  const fallbackArmedSanitized = prow.some(
    (row) => row.event === "message_end_sanitized" && row.forcedFailureArmed === true,
  );
  const fallbackObserved = prow.filter((row) => row.event === "message_end_error_fallback_observed");
  const fallbackSameRoleMinimal = fallbackObserved.some(
    (row) =>
      row.sameRoleFallback === true &&
      row.minimalContent === true &&
      row.errorMessagePresent === true &&
      row.rawExceptionStack === false &&
      row.hadCapabilityToken === false,
  );
  const fallbackToolCallId = fallbackInjectionRows
    .map((row) => String(row.toolCallId))
    .find((id) => id.length > 0);
  const noTaskExecutionForFailedCall =
    fallbackToolCallId !== undefined &&
    rows
      .filter((row) => row.event === "tool_call" && String(row.toolCallId) === fallbackToolCallId)
      .every((row) => row.forcedFailureBlock === true) &&
    rows.some(
      (row) =>
        row.event === "tool_call" &&
        String(row.toolCallId) === fallbackToolCallId &&
        row.forcedFailureBlock === true,
    ) &&
    !rows.some((row) => row.event === "tool_result" && String(row.toolCallId) === fallbackToolCallId) &&
    !rows.some((row) => row.event === "runtime_task_identity_observed" && String(row.toolCallId) === fallbackToolCallId) &&
    !rows.some((row) => row.event === "capability_outbound_captured" && String(row.toolCallId) === fallbackToolCallId);
  const postFallbackScanSafe = storageScanRows.some(
    (row) =>
      (row.label === "after_error_fallback" || row.label === "final_authoritative") &&
      row.tokenFound === false &&
      row.unsafeStorage === false,
  );
  const messageEndFallbackPreventsTokenPersistence =
    fallbackInjectionRows.length > 0 &&
    fallbackArmedSanitized &&
    fallbackSameRoleMinimal &&
    noTaskExecutionForFailedCall &&
    postFallbackScanSafe;

  // RG-002.3: the synthetic unknown-tool result path — real unknown-tool emission,
  // synthetic result sanitation before persistence, no outbound receipt, no provenance,
  // and a subsequent authoritative token-free storage scan.
  const unknownEmittedRows = prow.filter((row) => row.event === "unknown_tool_model_emitted");
  const unknownToolCallIds = new Set(unknownEmittedRows.map((row) => String(row.toolCallId)));
  const unknownToolSyntheticSanitized =
    unknownToolCallIds.size > 0 &&
    rows.some(
      (row) =>
      row.event === "tool_result_sanitized" &&
      typeof row.toolCallId === "string" &&
      unknownToolCallIds.has(row.toolCallId) &&
      row.unknownToolCall === true &&
      row.isError === true,
    );
  const noReceiptOrProvenanceForUnknownTool = Array.from(unknownToolCallIds).every(
    (id) =>
      !rows.some((row) => row.event === "capability_outbound_captured" && String(row.toolCallId) === id) &&
      !rows.some((row) => row.event === "task_provenance_validated" && String(row.toolCallId) === id),
  );
  const postUnknownToolScanSafe = storageScanRows.some(
    (row) =>
      (row.label === "after_unknown_tool_synthetic_result" ||
        row.label === "after_synthetic_result_sanitation" ||
        row.label === "final_authoritative") &&
      row.tokenFound === false &&
      row.unsafeStorage === false,
  );
  const unknownToolCapabilityEchoSanitized =
    unknownEmittedRows.length > 0 &&
    unknownToolSyntheticSanitized &&
    noReceiptOrProvenanceForUnknownTool &&
    postUnknownToolScanSafe;

  const nonTaskCapabilityEchoCallBlocked = rows.some(
    (row) =>
      row.event === "tool_call" &&
      row.toolName === "fixture_non_task_side_effect" &&
      row.hadCapability === true &&
      (row.guardResult as { readonly kind?: string } | undefined)?.kind === "block",
  );
  const nonTaskSafeControlExecuted = rows.some(
    (row) =>
      row.event === "fixture_non_task_tool_executed" &&
      row.payloadContainsCapability === false &&
      row.markerKind === "positive",
  );
  const nonTaskSideEffectScan = rows.find((row) => row.event === "fixture_side_effect_post_exit_scan");
  const nonTaskCapabilityEchoBlocked =
    nonTaskCapabilityEchoCallBlocked &&
    nonTaskSafeControlExecuted &&
    nonTaskSideEffectScan?.capabilityMarkerPresent === false &&
    nonTaskSideEffectScan.positiveControlMarkerPresent === true &&
    !rows.some(
      (row) => row.event === "fixture_non_task_tool_executed" && row.payloadContainsCapability === true,
    );

  const decodedEnvelope = decodeTaskCapabilityEnvelope(fixtureEnvelope);
  const sensitiveTokens: string[] = [];
  if (decodedEnvelope.kind === "decoded") sensitiveTokens.push(decodedEnvelope.capabilityId);
  sensitiveTokens.push(fixtureEnvelope);
  const rawEvidenceLeaks = sensitiveTokens.filter((token) => rawEvidenceText.includes(token));
  const rawEvidenceRedactsCredentialsAndCapabilities = rawEvidenceLeaks.length === 0;

  const protocolAffiliationRows = prow.filter(
    (row) => row.event === "authenticated_protocol_affiliation_observed",
  );
  const protocolAffiliationRow = protocolAffiliationRows[0];
  const authenticatedProtocolAffiliationObserved = protocolAffiliationRows.length > 0;
  const activationBindingValidated =
    authenticatedProtocolAffiliationObserved && bool(protocolAffiliationRow?.activationBindingValidated);
  const privateOutboundReceiptValidated =
    authenticatedProtocolAffiliationObserved && bool(protocolAffiliationRow?.privateOutboundReceiptValidated);
  const exactCallBindingValidated =
    authenticatedProtocolAffiliationObserved && bool(protocolAffiliationRow?.exactCallBindingValidated);
  const strippedArgsDigestValidated =
    authenticatedProtocolAffiliationObserved && bool(protocolAffiliationRow?.strippedArgsDigestValidated);
  const capabilityRestoredAndStripped = capabilityContextDelivered && capabilityStrip !== undefined;

  return {
    contracts: {
      task1_context_copy_delivers_fixture_capability_after_method_read: capabilityContextDelivered,
      task1_model_transports_capability_in_description: capabilityTransportedInDescription,
      task1_tool_call_binds_capability_session_and_call: capabilityBound,
      task1_probe_strips_capability_before_omo_execution: capabilityStrip !== undefined,
      task1_wrong_session_capability_is_rejected: wrongSessionRejected,
      task1_accepted_compaction_and_restart_invalidate_capability:
        acceptedCompaction && restartInvalidated,
      task1_wrong_authorization_and_method_capabilities_are_rejected:
        wrongAuthzRejected && wrongMethodRejected,
      task1_expired_malformed_and_duplicate_capabilities_are_rejected: expiredMalfDup,
      task1_raw_evidence_redacts_credentials_and_capabilities: rawEvidenceRedactsCredentialsAndCapabilities,
      task1_batch_echo_and_stale_transcripts_cannot_restore_capability:
        staleReplayRejected && batchEchoSanitized,
      task1_unverified_transcript_guard_profile_does_not_issue_capability:
        unverifiedProfileRejected && realCapabilityIssued,
      task1_non_task_tool_capability_echo_is_blocked_before_execution: nonTaskCapabilityEchoBlocked,
      task1_unknown_tool_capability_echo_is_sanitized_before_persistence:
        unknownToolCapabilityEchoSanitized,
      task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference:
        activationBindingValidated &&
        privateOutboundReceiptValidated &&
        exactCallBindingValidated &&
        strippedArgsDigestValidated &&
        capabilityRestoredAndStripped &&
        tokenFreeReadBackValidated,
      task1_capability_never_enters_persisted_session_history:
        allStorageScansSafe && finalScanClassesComplete,
      task1_capability_is_removed_before_assistant_tool_call_persistence:
        capabilityStrip !== undefined && allStorageScansSafe,
      task1_message_end_fallback_prevents_token_persistence_on_error:
        messageEndFallbackPreventsTokenPersistence,
      task1_unsupported_in_process_and_nested_calls_remain_untrusted:
        hasInProcessUntrusted && hasNestedUntrusted,
    },
  };
}

export function provenanceProbeStep(): MockStep {
  return {
    type: "tool_call",
    name: "task",
    id: "justice-spike-task-2",
    arguments: {
      category: "quick",
      prompt: "JUSTICE_REVIEW_TARGET\nReview the fixture and reply REVIEW_CHILD_DONE.",
      run_in_background: true,
      name: "provenance-probe",
      description: "original-task-description",
      max_depth: 1,
      maxDepth: 1,
    },
  };
}

export function unknownCapabilityEchoStep(fixtureEnvelope: string): MockStep {
  return {
    type: "tool_call",
    name: "justice_unknown_echo",
    id: "justice-spike-unknown-echo",
    arguments: {
      prompt: "JUSTICE_UNKNOWN_ECHO",
      payload: fixtureEnvelope,
      description: fixtureEnvelope,
    },
  };
}

export function nonTaskCapabilityEchoStep(): MockStep {
  return {
    type: "tool_call",
    name: "task",
    id: "justice-spike-nontask-capability-echo",
    arguments: {
      category: "quick",
      prompt: "JUSTICE_NON_TASK_CHILD\nRead the selected Superpowers method and run the capability side-effect probe.",
      run_in_background: false,
      name: "non-task-capability-probe",
      max_depth: 1,
    },
  };
}

export function nonTaskPositiveControlStep(): MockStep {
  return {
    type: "tool_call",
    name: "fixture_non_task_side_effect",
    id: "justice-spike-nontask-positive-control",
    arguments: { payload: "SAFE_POSITIVE_CONTROL" },
  };
}

export function fallbackProbeStep(): MockStep {
  return {
    type: "tool_call",
    name: "task",
    id: "justice-spike-task-fallback",
    arguments: {
      category: "quick",
      prompt: "JUSTICE_FALLBACK_PROBE\nCapability-bearing task whose processing fails after sanitation.",
      run_in_background: false,
      name: "fallback-probe",
      description: "fallback-probe-description",
      max_depth: 1,
      maxDepth: 1,
    },
  };
}

export function compactionTriggerStep(): MockStep {
  return {
    type: "tool_call",
    name: "justice_trigger_compaction",
    id: "justice-spike-compaction-trigger",
    arguments: { prompt: "JUSTICE_TRIGGER_COMPACTION" },
  };
}

export function staleReplayStep(): MockStep {
  return {
    type: "tool_call",
    name: "task",
    id: "justice-spike-stale-replay",
    arguments: {
      category: "quick",
      prompt: "JUSTICE_STALE_REPLAY\nAttempt capability restore from a stale transcript echo.",
      run_in_background: false,
      name: "stale-replay-probe",
      description: "stale-echo-label",
    },
  };
}

export function foreignCapabilityProbeStep(): MockStep {
  return {
    type: "tool_call",
    name: "task",
    id: "justice-spike-child-foreign-task",
    arguments: {
      category: "quick",
      prompt: "JUSTICE_FOREIGN_SESSION_TASK\nChild attempts to use a parent capability.",
      name: "foreign-capability-probe",
      description: "original-task-description",
    },
  };
}
