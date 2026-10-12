import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const runnerPath = fileURLToPath(new URL("../fixtures/omo-native-senpi/native-session-harness.ts", import.meta.url));
const SUMMARY_PREFIX = "JUSTICE_SPIKE_EVIDENCE_SUMMARY=";

type SpikeSummary = {
  readonly setupError?: string;
  readonly task1Result?: "PROVEN" | "BLOCKED";
  readonly blockedContracts?: readonly string[];
  readonly expected?: Readonly<Record<string, string>>;
  readonly versions?: Readonly<Record<string, string>>;
  readonly contracts: Readonly<Record<string, boolean>>;
  readonly blockedAt?: string | null;
  readonly observed?: Readonly<Record<string, unknown>>;
};

let summary: SpikeSummary = { contracts: {} };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function contract(name: string): void {
  expect(summary.setupError, "runtime setup must succeed before a Native contract can be PROVEN").toBeUndefined();
  expect(summary.contracts[name], `${name} must be PROVEN by captured runtime evidence`).toBe(true);
}

function runtimeContract(name: string): void {
  contract(name);
}

function evidenceAccountedContract(name: string): void {
  expect(summary.setupError, "runtime setup must succeed before evidence accounting").toBeUndefined();
  expect(summary.blockedContracts).toBeDefined();
  expect(summary.contracts[name] === true).toBe(!summary.blockedContracts?.includes(name));
}


describe("Justice v5 OmO Native / Senpi / Superpowers evidence spike", () => {
  beforeAll(async () => {
    const { stdout, stderr } = await exec("bun", [runnerPath], {
      timeout: 900_000,
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    });
    const line = stdout.split("\n").find((entry) => entry.startsWith(SUMMARY_PREFIX));
    if (line === undefined) {
      throw new Error(`Native evidence runner produced no summary.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
    }
    summary = JSON.parse(line.slice(SUMMARY_PREFIX.length)) as SpikeSummary;
    console.log(`${SUMMARY_PREFIX}${JSON.stringify(summary)}`);
  }, 900_000);

  // Historical 9 PROVEN host contracts — re-run on revised harness, never retroactive.
  it("loads_omo_and_superpowers_pi_packages_together", () => contract("loads_omo_and_superpowers_pi_packages_together"));
  it("superpowers_using_superpowers_bootstrap_is_present_in_native_context", () =>
    contract("superpowers_using_superpowers_bootstrap_is_present_in_native_context"));
  it("native_method_skill_load_produces_current_session_activation_evidence", () =>
    runtimeContract("native_method_skill_load_produces_current_session_activation_evidence"));
  it("native_task_tool_call_exposes_mutable_input_session_and_tool_call_id", () =>
    contract("native_task_tool_call_exposes_mutable_input_session_and_tool_call_id"));
  it("native_task_enforces_category_subagent_type_xor", () =>
    runtimeContract("native_task_enforces_category_subagent_type_xor"));
  it("records the execution mode selected for the pinned runtime task call", () => {
    expect(summary.observed?.taskExecutionModes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "justice-spike-task-2",
          executionMode: expect.stringMatching(/^(in-process|process)$/u),
        }),
      ]),
    );
  });
  it("records the observed execution mode for every spawned batch task item", () => {
    const observations = summary.observed?.taskExecutionModes;
    expect(Array.isArray(observations)).toBe(true);
    if (!Array.isArray(observations)) throw new Error("Task execution-mode observations are unavailable");
    const batchModes = observations.filter(isRecord).filter(
      (row) => row.toolCallId === "justice-spike-task-batch",
    );
    expect(batchModes).toHaveLength(2);
    expect(batchModes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "justice-spike-task-batch",
          batchItemIndex: 0,
          runtimeTaskId: expect.stringMatching(/^st_/u),
          executionMode: "process",
          modeSource: "task_state.execution_mode",
        }),
        expect.objectContaining({
          toolCallId: "justice-spike-task-batch",
          batchItemIndex: 1,
          runtimeTaskId: expect.stringMatching(/^st_/u),
          executionMode: "process",
          modeSource: "task_state.execution_mode",
        }),
      ]),
    );
  });
  it("native_background_task_returns_runtime_id_without_becoming_task_identity", () =>
    contract("native_background_task_returns_runtime_id_without_becoming_task_identity"));
  it("native_task_send_continuation_remains_omo_owned", () =>
    runtimeContract("native_task_send_continuation_remains_omo_owned"));
  it("superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch", () =>
    contract("superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch"));

  // Revised A–K capability / pre-spawn protocol contracts.
  it("task1_context_copy_delivers_fixture_capability_after_method_read", () =>
    runtimeContract("task1_context_copy_delivers_fixture_capability_after_method_read"));
  it("task1_model_transports_capability_in_description", () => runtimeContract("task1_model_transports_capability_in_description"));
  it("task1_tool_call_binds_capability_session_and_call", () =>
    runtimeContract("task1_tool_call_binds_capability_session_and_call"));
  it("task1_probe_strips_capability_before_omo_execution", () => runtimeContract("task1_probe_strips_capability_before_omo_execution"));
  it("task1_host_session_child_receives_pre_spawn_contract_before_output", () =>
    runtimeContract("task1_host_session_child_receives_pre_spawn_contract_before_output"));
  it("task1_unrelated_and_review_like_tasks_without_capability_are_external", () =>
    runtimeContract("task1_unrelated_and_review_like_tasks_without_capability_are_external"));
  it("task1_wrong_session_capability_is_rejected", () => runtimeContract("task1_wrong_session_capability_is_rejected"));
  it("task1_accepted_compaction_and_restart_invalidate_capability", () =>
    runtimeContract("task1_accepted_compaction_and_restart_invalidate_capability"));
  it("task1_supported_host_session_batch_has_normalized_binding", () =>
    runtimeContract("task1_supported_host_session_batch_has_normalized_binding"));
  it("task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference", () =>
    runtimeContract("task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference"));

  // Additional RED control contracts.
  it("task1_wrong_authorization_and_method_capabilities_are_rejected", () =>
    runtimeContract("task1_wrong_authorization_and_method_capabilities_are_rejected"));
  it("task1_expired_malformed_and_duplicate_capabilities_are_rejected", () =>
    runtimeContract("task1_expired_malformed_and_duplicate_capabilities_are_rejected"));
  it("task1_result_state_mode_is_verified_before_review_acceptance", () =>
    runtimeContract("task1_result_state_mode_is_verified_before_review_acceptance"));
  it("task1_unsupported_in_process_and_nested_calls_remain_untrusted", () =>
    runtimeContract("task1_unsupported_in_process_and_nested_calls_remain_untrusted"));
  it("task1_fixture_does_not_inherit_external_provider_credentials", () =>
    runtimeContract("task1_fixture_does_not_inherit_external_provider_credentials"));
  it("task1_fixture_fails_closed_on_non_mock_provider_selection", () =>
    runtimeContract("task1_fixture_fails_closed_on_non_mock_provider_selection"));
  it("task1_raw_evidence_redacts_credentials_and_capabilities", () =>
    runtimeContract("task1_raw_evidence_redacts_credentials_and_capabilities"));

  // RG-005 mandatory runtime tests.
  it("task1_capability_never_enters_persisted_session_history", () =>
    runtimeContract("task1_capability_never_enters_persisted_session_history"));
  it("task1_capability_is_removed_before_assistant_tool_call_persistence", () =>
    runtimeContract("task1_capability_is_removed_before_assistant_tool_call_persistence"));
  it("task1_message_end_fallback_prevents_token_persistence_on_error", () =>
    runtimeContract("task1_message_end_fallback_prevents_token_persistence_on_error"));
  it("task1_batch_echo_and_stale_transcripts_cannot_restore_capability", () =>
    runtimeContract("task1_batch_echo_and_stale_transcripts_cannot_restore_capability"));
  it("task1_unverified_transcript_guard_profile_does_not_issue_capability", () =>
    runtimeContract("task1_unverified_transcript_guard_profile_does_not_issue_capability"));
  it("task1_non_task_tool_capability_echo_is_blocked_before_execution", () =>
    runtimeContract("task1_non_task_tool_capability_echo_is_blocked_before_execution"));
  it("task1_unknown_tool_capability_echo_is_sanitized_before_persistence", () =>
    evidenceAccountedContract("task1_unknown_tool_capability_echo_is_sanitized_before_persistence"));
  it("preserves 32-contract accounting and retains only incomplete runtime evidence as BLOCKED", () => {
    expect(Object.keys(summary.contracts)).toHaveLength(32);
    const acceptance = summary.observed?.task1Acceptance;
    expect(isRecord(acceptance)).toBe(true);
    if (!isRecord(acceptance)) throw new Error("Task 1 overall acceptance evidence is unavailable");
    expect(acceptance.canonicalContractCount).toBe(32);
    expect(acceptance.canonicalContractsProven).toBe(
      Object.values(summary.contracts).filter((proven) => proven === true).length,
    );
    expect(acceptance.status).toBe(summary.task1Result);
    const caseA = summary.observed?.providerStreamErrorControl;
    if (isRecord(caseA) && caseA.status === "BLOCKED") {
      expect(summary.task1Result).toBe("BLOCKED");
    }
    const contractsRequiringCompleteRuntimeEvidence = [
      "task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference",
      "task1_capability_never_enters_persisted_session_history",
      "task1_message_end_fallback_prevents_token_persistence_on_error",
      "task1_unknown_tool_capability_echo_is_sanitized_before_persistence",
    ];
    expect(summary.blockedContracts).toEqual(
      contractsRequiringCompleteRuntimeEvidence.filter((name) => summary.contracts[name] !== true).sort(),
    );
    expect(summary.contracts.task1_message_end_fallback_prevents_token_persistence_on_error).toBe(true);
  });
  it("proves token-free storage coverage from the complete isolated runtime tree and observed session IDs", () => {
    const finalScan = summary.observed?.harnessFinalScan as
      | {
          readonly tokenFound?: unknown;
          readonly unsafeStorage?: unknown;
          readonly classesObserved?: unknown;
          readonly sessionIdsRequired?: unknown;
          readonly sessionIdsObserved?: unknown;
        }
      | undefined;

    expect(finalScan).toMatchObject({
      tokenFound: false,
      unsafeStorage: false,
      sessionIdsRequired: expect.any(Number),
      sessionIdsObserved: finalScan?.sessionIdsRequired,
    });
    expect(finalScan?.sessionIdsRequired).toBeGreaterThanOrEqual(2);
    expect(finalScan?.classesObserved).toEqual(expect.arrayContaining(["sessions", "task_state", "logs", "evidence"]));
  });
  it("observes the actual runtime's same-role error fallback after the injected stream failure", () => {
    expect(summary.observed?.fallbackInjectionCount).toBe(1);
    expect(summary.observed?.fallbackObservedCount).toBe(1);
  });
  it("reads full parent SessionManager history and reconciles its branches with the actual JSONL", () => {
    expect(summary.observed?.sessionManagerHistoryReadback).toMatchObject({
      source: "ReadonlySessionManager.getEntries",
      headerValid: true,
      headerCount: 1,
      sessionEntriesObserved: expect.any(Number),
      diskEntriesObserved: expect.any(Number),
      entryIdsAndBranchesMatch: true,
      tokenFoundInMemoryEntries: false,
      tokenFoundInDiskEntries: false,
      unsafeStorage: false,
    });
  });
  it("requires parent and child session history read-backs for complete branch reconciliation", () => {
    const coverage = summary.observed?.sessionManagerHistoryCoverage;
    expect(isRecord(coverage)).toBe(true);
    if (
      !isRecord(coverage) ||
      typeof coverage.expectedSessions !== "number" ||
      !Array.isArray(coverage.expectedSessionIds) ||
      !Array.isArray(coverage.startedSessionIds) ||
      !Array.isArray(coverage.childSessionIds) ||
      !Array.isArray(coverage.shutdownSessionIds) ||
      !Array.isArray(coverage.snapshots)
    ) {
      throw new Error("parent-child session history coverage is unavailable");
    }
    expect(coverage.expectedSessionIds).toEqual(expect.arrayContaining(coverage.startedSessionIds));
    expect(coverage.expectedSessionIds).toEqual(expect.arrayContaining(coverage.childSessionIds));
    expect(coverage.childSessionIds.length).toBeGreaterThan(0);
    expect(coverage.complete).toBe(true);
    expect(coverage.readbacks).toBe(coverage.expectedSessions);
    expect(coverage.expectedSessions).toBeGreaterThanOrEqual(2);
    expect(coverage.shutdownSessionIds).toEqual(expect.arrayContaining(coverage.expectedSessionIds));
    const shutdownSnapshots = coverage.snapshots.filter(
      (snapshot): snapshot is Record<string, unknown> => isRecord(snapshot) && snapshot.phase === "session_shutdown",
    );
    expect(shutdownSnapshots).toHaveLength(coverage.expectedSessions);
    expect(
      shutdownSnapshots.every(
        (snapshot) =>
          snapshot.headerValid === true &&
          snapshot.headerCount === 1 &&
          typeof snapshot.sessionEntriesObserved === "number" &&
          snapshot.diskEntriesObserved === snapshot.sessionEntriesObserved &&
          snapshot.entryIdsAndBranchesMatch === true &&
          snapshot.tokenFoundInMemoryEntries === false &&
          snapshot.tokenFoundInDiskEntries === false &&
          snapshot.unsafeStorage === false,
      ),
    ).toBe(true);
  });
  it("observes the capability-bearing assistant append and immediate JSONL read-back through public RPC events", () => {
    expect(summary.observed?.appendObservationSource).toBe("AgentSession.subscribe via Senpi RPC");
    expect(summary.observed?.entryAppendedSubscriptionAvailable).toBe(true);
    expect(summary.observed?.assistantToolCallAppendObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: summary.observed?.rpcSessionId,
          toolCallId: "justice-spike-task-2",
          subscriptionEvent: "entry_appended",
          persistedEntryReadBack: true,
          toolExecutionStartedAfterAppend: true,
          capabilityAbsentFromArguments: true,
          descriptionRestored: "original-task-description",
        }),
      ]),
    );
  });
  it("records the token-free unknown-tool append/result and its linked sanitizer evidence", () => {
    expect(summary.observed?.assistantToolCallAppendObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "justice-spike-unknown-echo",
          subscriptionEvent: "entry_appended",
          persistedEntryFullyMatchesEvent: true,
          persistedCapabilityEnvelopeMarkerAbsent: true,
          persistedKnownCapabilityTokenAbsent: true,
          capabilityAbsentFromArguments: true,
        }),
      ]),
    );
    expect(summary.observed?.rpcSyntheticToolResultObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "justice-spike-unknown-echo",
          entryAppendedObserved: true,
          isError: true,
          immediateJsonlReadBackMatched: true,
          capabilityAbsentFromResult: true,
        }),
      ]),
    );
    const control = summary.observed?.syntheticUnknownToolResult;
    if (!isRecord(control) || !Array.isArray(control.messageEndSanitizerObservations)) {
      throw new Error("unknown-tool evidence evaluation is unavailable");
    }
    const callback = control.messageEndSanitizerObservations.find(
      (row): row is Record<string, unknown> => isRecord(row) && row.toolCallId === "justice-spike-unknown-echo",
    );
    expect(isRecord(callback)).toBe(true);
    if (!isRecord(callback)) throw new Error("unknown-tool callback observation is unavailable");
    if (typeof callback.messageId !== "string") {
      expect(control.sanitationBoundaryProven).toBe(false);
      expect(summary.contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence).toBe(false);
    }
  });
  it("observes provider stream failure and invalidation while retaining the complete fallback contract gate", () => {
    const control = summary.observed?.providerStreamErrorControl;
    expect(isRecord(control)).toBe(true);
    if (!isRecord(control)) throw new Error("Case A control evidence is unavailable");
    expect(control.requiredObservations).toMatchObject({
      providerStreamErrorObserved: true,
      messageEndObserved: true,
      normalSanitationApplied: true,
    });
    const required = control.requiredObservations;
    expect(isRecord(required)).toBe(true);
    if (!isRecord(required)) throw new Error("Case A required observations are unavailable");
    const requiredKeys = [
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
    const allRequired = requiredKeys.every((key) => required[key] === true);
    expect(control.missingEvidence).toEqual(requiredKeys.filter((key) => required[key] !== true));
    expect(control.status).toBe(allRequired ? "PROVEN" : "BLOCKED");
    if (required.candidateReceiptCaptured === true) {
      expect(typeof control.candidateReceiptCount).toBe("number");
      expect(control.candidateReceiptCount).toBeGreaterThan(0);
    } else {
      expect(control.candidateReceiptCount).toBe(0);
    }
  });
  it("observes the Case B sanitizer fault independently from the Case A provider error", () => {
    const caseA = summary.observed?.providerStreamErrorControl;
    expect(isRecord(caseA)).toBe(true);
    if (!isRecord(caseA)) throw new Error("Case A provider stream control is unavailable");
    expect(caseA.streamErrorObserved).toBe(true);
    expect(Array.isArray(caseA.missingEvidence)).toBe(true);
    if (!Array.isArray(caseA.missingEvidence)) throw new Error("Case A evidence gaps are unavailable");
    expect(caseA.status).toBe(caseA.missingEvidence.length === 0 ? "PROVEN" : "BLOCKED");
    const caseB = summary.observed?.justiceSanitizerFailureControl;
    expect(isRecord(caseB)).toBe(true);
    if (!isRecord(caseB)) throw new Error("Case B runtime control evidence is unavailable");
    expect(caseB.failureSurface).toBe("message_end_guard");
    expect(caseB.messageEndHookObserved).toBe(true);
    expect(caseB.status).toBe("PROVEN");
    expect(caseB.freshReadReauthorized).toBe(true);
    expect(caseB.lateResponseSanitized).toBe(true);
    expect(summary.observed?.sessionManagerHistoryReadback).toMatchObject({
      sanitizerFailureFallbackMemoryEntries: 1,
      sanitizerFailureFallbackDiskEntries: 1,
    });
    if (caseB.status === "PROVEN") {
      expect(caseB.failureInjectedAfterCaptureAndSanitation).toBe(true);
      expect(caseB.exactMinimalFallbackObserved).toBe(true);
      expect(caseB.persistedFallbackReadBackMatched).toBe(true);
      expect(caseB.candidateReceiptsInvalidated).toBe(true);
      expect(caseB.liveCapabilityInvalidated).toBe(true);
      expect(caseB.activationInvalidated).toBe(true);
      expect(caseB.noTrustedExecution).toBe(true);
      expect(caseB.oldReceiptReplayRejected).toBe(true);
      expect(caseB.freshReadReauthorized).toBe(true);
      expect(caseB.lateResponseSanitized).toBe(true);
    } else {
      expect(summary.contracts.task1_message_end_fallback_prevents_token_persistence_on_error).toBe(false);
    }
  });
  it("proves Case B only from its same-session fallback and invalidation evidence", () => {
    const providerControl = summary.observed?.providerStreamErrorControl;
    expect(summary.observed?.failureInvalidationControls).toMatchObject({
      provider_stream_error: {
        status: isRecord(providerControl) ? providerControl.status : "BLOCKED",
      },
      justice_sanitizer_failure: {
        status: "PROVEN",
      },
    });
  });
  it("records persisted RPC synthetic results with the actual extension callback observed", () => {
    const control = summary.observed?.syntheticUnknownToolResult;
    expect(control).toMatchObject({
      actualUnknownToolModelCallObserved: true,
      actualSyntheticToolResultMessageEndObserved: true,
      resultCount: 0,
      rpcPersistedSyntheticResultObserved: true,
      rpcPersistedResultsReadBackSafely: true,
    });
    if (!isRecord(control)) throw new Error("unknown-tool synthetic result evidence is unavailable");
    const persistedResultCount = control.rpcPersistedSyntheticResultCount;
    if (typeof persistedResultCount !== "number") throw new Error("RPC synthetic result count is unavailable");
    expect(persistedResultCount).toBeGreaterThanOrEqual(1);
    expect(control.status).toBe(
      summary.contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence ? "PROVEN" : "BLOCKED",
    );
    expect(control.sanitationBoundaryProven).toBe(
      summary.contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence,
    );
  });
  it("links the persisted unknown-tool result to its actual message_end sanitizer callback", () => {
    const control = summary.observed?.syntheticUnknownToolResult;
    expect(control).toMatchObject({
      actualUnknownToolModelCallObserved: true,
      rpcPersistedSyntheticResultObserved: true,
      rpcPersistedResultsReadBackSafely: true,
    });
    if (!isRecord(control)) throw new Error("unknown-tool synthetic result evidence is unavailable");
    expect(control.messageEndSanitizerObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: expect.any(String),
          toolCallId: "justice-spike-unknown-echo",
          sanitizerSource: "Senpi message_end callback",
          callbackObserved: true,
          capabilityTokenPresentBeforeSanitization: expect.any(Boolean),
          capabilityTokenAbsentAfterSanitization: true,
          sanitizationChanged: expect.any(Boolean),
        }),
      ]),
    );
    expect(control).toMatchObject({
      sanitationBoundaryProven: expect.any(Boolean),
      tokenRemovalProven: expect.any(Boolean),
    });
    const callbacks = control.messageEndSanitizerObservations;
    if (!Array.isArray(callbacks)) throw new Error("unknown-tool callback observations are unavailable");
    const callback = callbacks.find(
      (row): row is Record<string, unknown> => isRecord(row) && row.toolCallId === "justice-spike-unknown-echo",
    );
    if (!isRecord(callback)) throw new Error("unknown-tool callback identity is unavailable");
    if (typeof callback.messageId !== "string") {
      expect(control.sanitationBoundaryProven).toBe(false);
      expect(summary.contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence).toBe(false);
    }
  });
  it("does not claim token removal when the actual synthetic result entered token-free", () => {
    const control = summary.observed?.syntheticUnknownToolResult;
    if (!isRecord(control) || !Array.isArray(control.messageEndSanitizerObservations)) {
      throw new Error("unknown-tool sanitizer observations are unavailable");
    }
    const callback = control.messageEndSanitizerObservations.find(
      (row): row is Record<string, unknown> => isRecord(row) && row.toolCallId === "justice-spike-unknown-echo",
    );
    expect(isRecord(callback)).toBe(true);
    if (!isRecord(callback)) throw new Error("unknown-tool message_end observation is unavailable");
    if (callback.capabilityTokenPresentBeforeSanitization === false) {
      expect(callback.capabilityTokenAbsentAfterSanitization).toBe(true);
      expect(control.tokenRemovalProven).toBe(false);
    }
  });
  it("does not infer sanitizer execution from a token-free synthetic result alone", () => {
    const control = summary.observed?.syntheticUnknownToolResult;
    expect(control).toMatchObject({
      rpcPersistedSyntheticResultObserved: true,
      rpcPersistedResultsReadBackSafely: true,
    });
    if (!isRecord(control)) throw new Error("unknown-tool evidence evaluation is unavailable");
    const callbacks = control.messageEndSanitizerObservations;
    if (!Array.isArray(callbacks)) throw new Error("unknown-tool callback observations are unavailable");
    const callback = callbacks.find(
      (row): row is Record<string, unknown> => isRecord(row) && row.toolCallId === "justice-spike-unknown-echo",
    );
    if (!isRecord(callback)) throw new Error("unknown-tool callback identity is unavailable");
    if (typeof callback.messageId !== "string") {
      expect(control.sanitationBoundaryProven).toBe(false);
      expect(summary.contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence).toBe(false);
    }
  });
  it("records the registered invalid-schema control without promoting unpersisted results", () => {
    const control = summary.observed?.registeredSchemaValidation;
    expect(isRecord(control)).toBe(true);
    if (!isRecord(control)) throw new Error("registered invalid-schema control evidence is unavailable");
    expect(control.attempted).toBe(true);
    expect(control.toolCallId).toBe("justice-spike-invalid-schema");
    expect(control.sanitationBoundaryProven).toBe(
      summary.observed?.capabilityContractDiagnostics !== undefined &&
      isRecord(summary.observed.capabilityContractDiagnostics) &&
      summary.observed.capabilityContractDiagnostics.registeredSchemaSanitationBoundaryProven === true,
    );
    if (control.persistedSyntheticResultObserved === true) {
      expect(control.validationFailureObserved).toBe(true);
      expect(control.toolExecutionStarted).toBe(false);
      expect(control.immediateJsonlReadBackMatched).toBe(true);
      expect(control.capabilityAbsentFromArguments).toBe(true);
      expect(control.capabilityAbsentFromResult).toBe(true);
      expect(control.noOutboundReceiptOrProvenance).toBe(true);
      expect(control.status).toBe(control.sanitationBoundaryProven === true ? "PROVEN" : "BLOCKED");
      expect(control.task1ContractStatus).toBe(summary.contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence ? "PROVEN" : "BLOCKED");
    } else {
      expect(control.status).toBe("BLOCKED");
      expect(summary.contracts.task1_unknown_tool_capability_echo_is_sanitized_before_persistence).toBe(false);
    }
  });
  it("does not replay the final scripted processing-failure probe indefinitely", () => {
    expect(summary.observed?.fallbackInjectionCount).toBe(1);
  });
});
