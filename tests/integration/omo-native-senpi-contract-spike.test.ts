import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const runnerPath = fileURLToPath(new URL("../fixtures/omo-native-senpi/run-spike.mjs", import.meta.url));
const SUMMARY_PREFIX = "JUSTICE_SPIKE_EVIDENCE_SUMMARY=";

type SpikeSummary = {
  readonly setupError?: string;
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
    // Keep the scrubbed summary visible in CI so the evidence report can bind to the actual run.
    console.log(`${SUMMARY_PREFIX}${JSON.stringify(summary)}`);
  }, 900_000);

  it("loads_omo_and_superpowers_pi_packages_together", () => {
    contract("loads_omo_and_superpowers_pi_packages_together");
  });

  it("superpowers_using_superpowers_bootstrap_is_present_in_native_context", () => {
    contract("superpowers_using_superpowers_bootstrap_is_present_in_native_context");
  });

  it("native_task_tool_call_exposes_mutable_input_session_and_tool_call_id", () => {
    contract("native_task_tool_call_exposes_mutable_input_session_and_tool_call_id");
  });

  it.todo("native_task_enforces_category_subagent_type_xor");

  it("native_background_task_returns_runtime_id_without_becoming_task_identity", () => {
    contract("native_background_task_returns_runtime_id_without_becoming_task_identity");
  });

  it.todo("native_task_send_continuation_remains_omo_owned");

  it("superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch", () => {
    contract("superpowers_subagent_intent_reaches_existing_omo_task_without_justice_dispatch");
  });

  it("native_superpowers_task_provenance_is_authoritatively_bound_without_prompt_inference", () => {
    contract("native_superpowers_task_provenance_is_authoritatively_bound_without_prompt_inference");
  });

  // The approved plan requires an immediate STOP when an architecture-critical Native contract
  // contradicts the Design. These contracts remain explicitly enumerated but are not executed after
  // the provenance gate above fails closed.
  it.todo("unrelated_model_issued_task_is_not_classified_as_superpowers");
  it.todo("review_like_prompt_without_provenance_remains_untrusted");
  it.todo("native_task_result_and_child_context_form_unique_parent_child_binding");
  it.todo("native_review_appendix_reaches_exact_bound_child_before_trusted_output");
  it.todo("unrelated_child_cannot_consume_pending_review_appendix");
  it.todo("native_method_skill_load_produces_current_session_activation_evidence");
  it.todo("compaction_activation_survival_is_observed_not_assumed");
});
