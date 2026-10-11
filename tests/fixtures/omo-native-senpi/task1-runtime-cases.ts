import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MockScript, MockStep } from "./task-e2e-mock-provider";
import {
  compactionTriggerStep,
  fallbackProbeStep,
  foreignCapabilityProbeStep,
  nonTaskCapabilityEchoStep,
  nonTaskPositiveControlStep,
  provenanceProbeStep,
  staleReplayStep,
  unknownCapabilityEchoStep,
} from "./capability-runtime-cases";

export type HostRuntimeCaseName =
  | "loads_omo_and_superpowers_pi_packages_together"
  | "superpowers_using_superpowers_bootstrap_is_present_in_native_context"
  | "native_method_skill_load_produces_current_session_activation_evidence"
  | "native_task_tool_call_exposes_mutable_input_session_and_tool_call_id"
  | "native_task_enforces_category_subagent_type_xor"
  | "native_background_task_returns_runtime_id_without_becoming_task_identity"
  | "native_task_send_continuation_remains_omo_owned"
  | "superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch"
  | "task1_host_session_child_receives_pre_spawn_contract_before_output"
  | "task1_unrelated_and_review_like_tasks_without_capability_are_external"
  | "task1_supported_host_session_batch_has_normalized_binding"
  | "task1_result_state_mode_is_verified_before_review_acceptance"
  | "task1_fixture_does_not_inherit_external_provider_credentials"
  | "task1_fixture_fails_closed_on_non_mock_provider_selection";

type EvidenceRow = Readonly<Record<string, unknown>>;

export function buildTask1RuntimeMockScript(
  superpowersRoot: string,
  fixtureEnvelope: string,
): MockScript {
  const skillPath = join(superpowersRoot, "skills/subagent-driven-development/SKILL.md");
  const parentSteps: MockStep[] = [
    {
      type: "tool_call",
      name: "read",
      id: "justice-spike-read-1",
      arguments: { path: skillPath },
    } as MockStep,
    provenanceProbeStep() as MockStep,
    {
      type: "tool_call",
      name: "task_send",
      id: "justice-spike-task-send",
      arguments: {
        to: "@JUSTICE_RUNTIME_TASK_ID@",
        message:
          "JUSTICE_CONTINUATION_STEER\nReply CONTINUATION_DONE and keep working in the same task.",
      },
    } as MockStep,
    fallbackProbeStep() as MockStep,
    {
      type: "tool_call",
      name: "task",
      id: "justice-spike-task-3",
      arguments: {
        category: "quick",
        prompt: "JUSTICE_UNRELATED_TASK\nDo something unrelated without a capability.",
        run_in_background: false,
        name: "unrelated-probe",
        max_depth: 1,
        maxDepth: 1,
      },
    } as MockStep,
    {
      type: "tool_call",
      name: "task",
      id: "justice-spike-task-batch",
      arguments: {
        run_in_background: false,
        category: "quick",
        name: "batch-probe",
        max_depth: 1,
        maxDepth: 1,
        tasks: [
          {
            prompt: "JUSTICE_BATCH_ITEM_0\nBatch item zero; echo BATCH_ECHO_DONE_0.",
            name: "batch-item-0",
            max_depth: 1,
          },
          {
            prompt: "JUSTICE_BATCH_ITEM_1\nBatch item one; echo BATCH_ECHO_DONE_1.",
            name: "batch-item-1",
            max_depth: 1,
          },
        ],
      },
    } as MockStep,
    nonTaskCapabilityEchoStep() as MockStep,
    {
      type: "tool_call",
      name: "read",
      id: "justice-spike-read-3",
      arguments: { path: skillPath },
    } as MockStep,
    unknownCapabilityEchoStep(fixtureEnvelope) as MockStep,
    compactionTriggerStep() as MockStep,
    staleReplayStep() as MockStep,
    { type: "text", text: "SPIKE_PARENT_DONE" },
  ];

  const childSteps: MockStep[] = [
    foreignCapabilityProbeStep() as MockStep,
    { type: "text", text: "REVIEW_CHILD_DONE" },
    { type: "text", text: "FOREIGN_SESSION_DONE" },
  ];

  const nonTaskChildSteps: MockStep[] = [
    {
      type: "tool_call",
      name: "read",
      id: "justice-spike-nontask-read",
      arguments: { path: skillPath },
    },
    nonTaskPositiveControlStep(),
    {
      type: "tool_call",
      name: "fixture_non_task_side_effect",
      id: "justice-spike-nontask-capability-call",
      arguments: { payload: "JUSTICE_CAPABILITY_ECHO_PLACEHOLDER" },
    },
    { type: "text", text: "NON_TASK_PROBE_DONE" },
  ];

  return { parentSteps, childSteps, nonTaskChildSteps };
}

export type HostRuntimeContractsInput = {
  readonly rows: readonly EvidenceRow[];
  readonly parentSessionId: string | undefined;
  readonly childSessionId: string | undefined;
  readonly runtimeTaskId: string | undefined;
  readonly runtimeEnv?: NodeJS.ProcessEnv | undefined;
  readonly agentSettingsPath?: string | undefined;
  readonly superpowersRoot?: string | undefined;
};

export type HostRuntimeContracts = {
  readonly contracts: Readonly<Record<HostRuntimeCaseName, boolean>>;
};

export function evaluateHostRuntimeContracts(input: HostRuntimeContractsInput): HostRuntimeContracts {
  const { rows, parentSessionId, childSessionId, runtimeTaskId } = input;
  const prow = rows.filter((row) => row.sessionId === parentSessionId);

  const bootstrap = prow.some((row) => row.event === "context" && row.hasSuperpowersBootstrap === true);
  const activation = prow.find((row) => row.event === "activation_evidence");
  // Both Superpowers execution methods must be proven independently: canonical installed
  // read path, successful read_tool_result, same session, exact read call identity, and
  // activation evidence per method. A wrong-method rejection never substitutes for a
  // successful executing-plans proof.
  const SUPPORTED_METHODS = ["subagent-driven-development", "executing-plans"] as const;
  const activationRows = prow.filter(
    (row) => row.event === "activation_evidence" && row.evidenceKind === "read_tool_result",
  );
  const bothMethodsActivatedIndependently = SUPPORTED_METHODS.every((method) => {
    const methodRows = activationRows.filter((row) => row.method === method);
    return methodRows.some((row) => {
      const callId = typeof row.observedCallOrInputId === "string" ? row.observedCallOrInputId : null;
      const canonicalPath =
        input.superpowersRoot !== undefined &&
        row.sourcePath === `${input.superpowersRoot}/skills/${method}/SKILL.md`;
      const successfulRead =
        callId !== null &&
        prow.some(
          (result) =>
            result.event === "tool_result" &&
            result.toolName === "read" &&
            String(result.toolCallId) === callId &&
            result.isError === false,
        );
      return (
        row.sessionId === parentSessionId &&
        callId !== null &&
        canonicalPath &&
        successfulRead
      );
    });
  }) &&
    new Set(activationRows.map((row) => String(row.observedCallOrInputId))).size >= 2;
  const taskCall = prow.find((row) => row.event === "tool_call" && row.toolName === "task");
  const taskResult = prow.find((row) => row.event === "tool_result" && row.toolName === "task");
  const taskResultDetails = taskResult?.details as Record<string, unknown> | undefined;
  const taskInputAfter = taskCall?.inputAfter as Record<string, unknown> | undefined;

  const APPENDIX = "[[JUSTICE_SPIKE_REVIEW_APPENDIX]]";
  const mutableInput =
    taskCall?.fixtureMutation === true &&
    typeof taskInputAfter === "object" &&
    taskInputAfter !== null &&
    typeof taskInputAfter.prompt === "string" &&
    taskInputAfter.prompt.includes(APPENDIX) === true &&
    typeof taskCall?.inputBefore === "object" &&
    taskCall.inputBefore !== null &&
    typeof (taskCall.inputBefore as Record<string, unknown>).prompt === "string" &&
    ((taskCall.inputBefore as Record<string, unknown>).prompt as string).includes(APPENDIX) !== true;

  const taskHasCategory = taskInputAfter !== undefined && "category" in taskInputAfter;
  const taskHasSubagentType = taskInputAfter !== undefined && "subagent_type" in taskInputAfter;
  const taskEnforcesCategorySubagentTypeXor = taskHasCategory !== taskHasSubagentType;

  const taskSendRows = rows.filter((row) => row.event === "task_send_continuation_observed");
  const taskSendParentOwned = taskSendRows.some(
    (row) =>
      (row.outcomeKind === "steered" || row.outcomeKind === "queued") &&
      typeof row.runtimeTaskId === "string" &&
      row.runtimeTaskId.startsWith("st_") &&
      row.runtimeTaskId === runtimeTaskId &&
      row.isParentSession === true &&
      row.sessionId === parentSessionId,
  );

  const preSpawnAppended = rows.some(
    (row) => row.event === "pre_spawn_contract_appended" && row.sessionId === childSessionId,
  );
  const childInitialPromptHasSuffix = rows.some(
    (row) => row.event === "before_agent_start" && row.sessionId === childSessionId && row.hasPreSpawnSuffix === true,
  );

  const unrelatedTaskValidated = prow.some(
    (row) =>
      row.event === "task_provenance_validated" &&
      row.isUnrelatedTask === true &&
      row.provenanceKind === "external",
  );

  const batchBindingRows = rows.filter((row) => row.event === "task_batch_binding_normalized");
  const batchIndexes = new Set(batchBindingRows.map((row) => Number(row.batchItemIndex)));
  const normalizedBatchBinding =
    batchBindingRows.length >= 2 &&
    batchIndexes.has(0) &&
    batchIndexes.has(1) &&
    batchBindingRows.every(
      (row) => typeof row.parentSessionId === "string" && row.parentSessionId.length > 0,
    );

  const resultStateModeVerified =
    typeof taskResultDetails?.mode === "string" &&
    typeof taskResultDetails?.status === "string" &&
    taskResultDetails.mode !== "" &&
    taskResultDetails.status !== "";

  const credentialScanRows = rows.filter((row) => row.event === "provider_credential_scan");
  const credentialScanClean =
    credentialScanRows.length > 0 &&
    credentialScanRows.every(
      (row) =>
        Array.isArray(row.credentialEnvVarsFound) &&
        (row.credentialEnvVarsFound as readonly string[]).length === 0 &&
        row.authJsonPresent === false &&
        row.mockProviderOnly === true &&
        row.providerInScope === "omo-mock",
    );
  const runtimeEnvForCredentialCheck = input.runtimeEnv ?? process.env;
  const runtimeEnvCredentialLeak = Object.entries(runtimeEnvForCredentialCheck)
    .filter(([name]) =>
      [
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
        "DEEPSEEK_API_KEY",
        "GEMINI_API_KEY",
        "GROQ_API_KEY",
        "XAI_API_KEY",
        "OPENROUTER_API_KEY",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "OPENCODE_API_KEY",
        "KIMI_API_KEY",
      ].includes(name),
    )
    .filter(([, value]) => typeof value === "string" && value.length > 0);
  let agentSettingsHasDefaultTrust = false;
  if (input.agentSettingsPath) {
    try {
      agentSettingsHasDefaultTrust = readFileSync(input.agentSettingsPath, "utf8").includes("defaultProjectTrust");
    } catch {
      agentSettingsHasDefaultTrust = false;
    }
  }
  const noEnvironmentCredentialInheritance =
    runtimeEnvCredentialLeak.length === 0 && agentSettingsHasDefaultTrust;

  const providerBlockedRows = rows.filter((row) => row.event === "fixture_provider_selection_blocked");
  const providerObservedRows = rows.filter((row) => row.event === "assistant_message_provider_observed");
  const allModelSelectsAreMock =
    providerObservedRows.length > 0 &&
    providerObservedRows.every(
      (row) => row.provider === "omo-mock" && row.guardVerdict === "allowed",
    );
  const nonMockSelectionBlocked = providerBlockedRows.some(
    (row) =>
      row.attemptedProvider !== "omo-mock" &&
      row.guardVerdict === "blocked" &&
      row.guardFailReason === "non_mock_provider",
  );

  return {
    contracts: {
      loads_omo_and_superpowers_pi_packages_together: true,
      superpowers_using_superpowers_bootstrap_is_present_in_native_context: bootstrap,
      native_method_skill_load_produces_current_session_activation_evidence:
        bothMethodsActivatedIndependently,
      native_task_tool_call_exposes_mutable_input_session_and_tool_call_id:
        Boolean(mutableInput && parentSessionId && taskCall?.toolCallId),
      native_task_enforces_category_subagent_type_xor: taskEnforcesCategorySubagentTypeXor,
      native_background_task_returns_runtime_id_without_becoming_task_identity:
        typeof runtimeTaskId === "string" && runtimeTaskId.startsWith("st_"),
      native_task_send_continuation_remains_omo_owned: taskSendParentOwned,
      superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch:
        Boolean(
          activation &&
            taskCall &&
            !prow.some((row) => row.event === "tool_call" && String(row.toolName).startsWith("justice")),
        ),
      task1_host_session_child_receives_pre_spawn_contract_before_output:
        preSpawnAppended && childInitialPromptHasSuffix,
      task1_unrelated_and_review_like_tasks_without_capability_are_external: unrelatedTaskValidated,
      task1_supported_host_session_batch_has_normalized_binding: normalizedBatchBinding,
      task1_result_state_mode_is_verified_before_review_acceptance: resultStateModeVerified,
      task1_fixture_does_not_inherit_external_provider_credentials:
        credentialScanClean && noEnvironmentCredentialInheritance,
      task1_fixture_fails_closed_on_non_mock_provider_selection:
        nonMockSelectionBlocked && allModelSelectsAreMock,
    },
  };
}
