import { beforeAll, describe, expect, it } from "vitest";
import { BUN_VERSION, OMO_COMMIT, SENPI_VERSION, SPIKE_ENABLED, SUPERPOWERS_COMMIT, runNativeUpstreamEvidenceSpike, type NativeUpstreamSpikeResult } from "./helpers/native-upstream-harness";

let result: NativeUpstreamSpikeResult;
function proven(name: string): void { const item = result.proofs[name]; expect(item, `missing proof ${name}`).toBeDefined(); expect(item?.status, item?.detail).toBe("proven"); }

describe.skipIf(!SPIKE_ENABLED)("Justice v5 pinned Native upstream contract evidence spike", () => {
  beforeAll(async () => { result = await runNativeUpstreamEvidenceSpike(); }, 1_200_000);
  it("pinned_upstream_shas_and_senpi_version_are_exact", () => { expect(result.evidence).toMatchObject({ superpowersCommit: SUPERPOWERS_COMMIT, omoCommit: OMO_COMMIT, senpiVersion: SENPI_VERSION, bunVersion: BUN_VERSION }); proven("pinned_upstream_shas_and_senpi_version_are_exact"); });
  it("native_contract_does_not_require_skill_tool", () => proven("native_contract_does_not_require_skill_tool"));
  it("selected_skill_read_success_is_observable_activation", () => { const read = result.proofs.selected_skill_read_success_is_observable_activation; const expanded = result.proofs.trusted_native_skill_expansion_is_observable_when_supported; expect(read?.status === "proven" || expanded?.status === "proven", `no trusted activation channel: read=${read?.detail}; expansion=${expanded?.detail}`).toBe(true); });
  it("trusted_native_skill_expansion_is_observable_when_supported", () => proven("trusted_native_skill_expansion_is_observable_when_supported"));
  it("extension_injected_skill_text_is_not_activation", () => proven("extension_injected_skill_text_is_not_activation"));
  it("captures_actual_superpowers_generic_worker_dispatch_shape", () => { expect(result.evidence.toolName).not.toBe(""); proven("captures_actual_superpowers_generic_worker_dispatch_shape"); });
  it("opencode_general_encoding_is_not_assumed_as_native_evidence", () => proven("opencode_general_encoding_is_not_assumed_as_native_evidence"));
  it("captures_actual_task_review_dispatch_shape", () => proven("captures_actual_task_review_dispatch_shape"));
  it("captures_actual_scoped_re_review_dispatch_shape", () => proven("captures_actual_scoped_re_review_dispatch_shape"));
  it("captures_actual_final_review_dispatch_shape", () => proven("captures_actual_final_review_dispatch_shape"));
  it("captures_superpowers_model_field_behavior", () => proven("captures_superpowers_model_field_behavior"));
  it("proposed_profile_translation_passes_omo_target_validation", () => { expect(result.evidence.translatedTargetValidation).toBe("accepted"); proven("proposed_profile_translation_passes_omo_target_validation"); });
  it("category_translation_never_retains_conflicting_model", () => proven("category_translation_never_retains_conflicting_model"));
  it("profile_proven_review_prompt_can_be_enriched_in_place", () => { expect(result.evidence.reviewPromptField).toBe("prompt"); proven("profile_proven_review_prompt_can_be_enriched_in_place"); });
  it("profile_proven_review_translation_preserves_category_subagent_xor", () => proven("profile_proven_review_translation_preserves_category_subagent_xor"));
  it("matching_tool_result_is_attributed_by_session_and_tool_call_id", () => proven("matching_tool_result_is_attributed_by_session_and_tool_call_id"));
  it("out_of_order_parallel_tool_results_do_not_cross_correlate_reviews", () => proven("out_of_order_parallel_tool_results_do_not_cross_correlate_reviews"));
  it("batch_input_index_matches_result_items_index", () => { expect(result.evidence.batchIndexStable).toBe(true); proven("batch_input_index_matches_result_items_index"); });
  it("batch_items_expose_independent_task_ids", () => proven("batch_items_expose_independent_task_ids"));
  it("mass_ulw_metadata_never_replaces_call_or_item_identity", () => proven("mass_ulw_metadata_never_replaces_call_or_item_identity"));
  it("review_interop_uses_exactly_one_existing_superpowers_dispatch", () => proven("review_interop_uses_exactly_one_existing_superpowers_dispatch"));
});
