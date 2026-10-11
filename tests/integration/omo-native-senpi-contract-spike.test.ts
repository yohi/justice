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

function contract(name: string): void {
  expect(summary.setupError, "runtime setup must succeed before a Native contract can be PROVEN").toBeUndefined();
  expect(summary.contracts[name], `${name} must be PROVEN by captured runtime evidence`).toBe(true);
}

function runtimeContract(name: string): void {
  contract(name);
}

function blockedContract(name: string): void {
  expect(summary.setupError, "runtime setup must succeed before a Native contract can be classified").toBeUndefined();
  expect(summary.task1Result, "an unproven mandatory contract must block Task 1").toBe("BLOCKED");
  expect(summary.contracts[name], `${name} must remain BLOCKED until its exact runtime assertion is proven`).toBe(false);
  expect(summary.blockedContracts).toContain(name);
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
  it("native_background_task_returns_runtime_id_without_becoming_task_identity", () =>
    contract("native_background_task_returns_runtime_id_without_becoming_task_identity"));
  it("native_task_send_continuation_remains_omo_owned", () =>
    runtimeContract("native_task_send_continuation_remains_omo_owned"));
  it("superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch", () =>
    contract("superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch"));

  // Revised A–K capability / pre-spawn protocol contracts.
  it("task1_context_copy_delivers_fixture_capability_after_method_read", () =>
    blockedContract("task1_context_copy_delivers_fixture_capability_after_method_read"));
  it("task1_model_transports_capability_in_description", () => runtimeContract("task1_model_transports_capability_in_description"));
  it("task1_tool_call_binds_capability_session_and_call", () =>
    blockedContract("task1_tool_call_binds_capability_session_and_call"));
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
    blockedContract("task1_authenticated_protocol_affiliation_is_bound_without_prompt_inference"));

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
    blockedContract("task1_capability_never_enters_persisted_session_history"));
  it("task1_capability_is_removed_before_assistant_tool_call_persistence", () =>
    blockedContract("task1_capability_is_removed_before_assistant_tool_call_persistence"));
  it("task1_message_end_fallback_prevents_token_persistence_on_error", () =>
    blockedContract("task1_message_end_fallback_prevents_token_persistence_on_error"));
  it("task1_batch_echo_and_stale_transcripts_cannot_restore_capability", () =>
    runtimeContract("task1_batch_echo_and_stale_transcripts_cannot_restore_capability"));
  it("task1_unverified_transcript_guard_profile_does_not_issue_capability", () =>
    runtimeContract("task1_unverified_transcript_guard_profile_does_not_issue_capability"));
  it("task1_non_task_tool_capability_echo_is_blocked_before_execution", () =>
    runtimeContract("task1_non_task_tool_capability_echo_is_blocked_before_execution"));
  it("task1_unknown_tool_capability_echo_is_sanitized_before_persistence", () =>
    blockedContract("task1_unknown_tool_capability_echo_is_sanitized_before_persistence"));
  it("reports Task 1 BLOCKED while any required contract remains unproven", () => {
    expect(summary.task1Result).toBe("BLOCKED");
    expect(summary.blockedContracts).toContain("task1_message_end_fallback_prevents_token_persistence_on_error");
    expect(summary.blockedContracts).toContain("task1_capability_never_enters_persisted_session_history");
  });
  it("does not replay the final scripted processing-failure probe indefinitely", () => {
    expect(summary.observed?.fallbackInjectionCount).toBe(1);
  });
});
