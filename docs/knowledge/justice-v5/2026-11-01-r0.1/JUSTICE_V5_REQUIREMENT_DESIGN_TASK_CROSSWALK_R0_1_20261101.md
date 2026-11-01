# Justice v5 — Requirement / Design / Task / Scenario Crosswalk R0.1 (V5-02)

**Status:** `DOCUMENT_ONLY / ANALYST_STATIC_RECONCILIATION / REVIEW_NOT_RUN / NO_OWNER_V6_ADOPTION / NO_IMPLEMENTATION_AUTHORITY`  
**基準日:** 2026-11-01 JST  
**Repository:** [yohi/justice](https://github.com/yohi/justice)  
**Fixed reference master:** [`08e9dbe3bee87c1e7f16307f302760f1f7161b19`](https://github.com/yohi/justice/commit/08e9dbe3bee87c1e7f16307f302760f1f7161b19)  
**Knowledge Hub:** [Issue #348](https://github.com/yohi/justice/issues/348)  

> This archive is a historically scoped reference and an analyst assessment. It is neither normative v6 Requirements nor an authorization for implementation, host tests, gates, CI, PR or merges.

## 1. Source and traceability scope

Fixed v5 Plan [`e431460453577ae1c7fe6ee36ec5b76319f61582`](https://github.com/yohi/justice/blob/08e9dbe3bee87c1e7f16307f302760f1f7161b19/docs/superpowers/plans/2026-09-28-justice-v5-semantic-control-plane.md) contains **14 Task headings** and **56 numbered verification scenarios**. The following task/scenario rows were transcribed from the fixed Plan (not inferred from passing tests). The Requirements→Tasks and Design→Tasks tables are preserved as documented by the Plan, not independently proven to be exhaustive for every normative paragraph.

## 2. Implementation Plan Task inventory

| Task | Plan section / intended deliverable | Scenario primary ownership | Historical authorization/evidence |
|---:|---|---|---|
| 1 | Revised Fixture Evidence Spike for Justice Capability and Pre-Spawn Contract Protocol | 55 | HISTORICAL_SPIKE_BLOCKED |
| 2 | Establish Native Semantic Routing Types and Pure OmO Task Translation | 19, 20, 21, 27, 29, 44, 47 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 3 | Implement ApprovedArtifactChain Authorization and Non-Promoting v4 Authorization Migration | 1, 2, 3, 4, 13, 31, 38 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 4 | Build Deterministic Normative Clause Projection and Conformance Contracts | 33 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 5 | Add Durable Native ExecutionCorrelation and Task-Brief-Based Semantic Resolution | none as direct owner; check local tests | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 6 | Wire Senpi Events to Durable Execution Correlation and Produce Authenticated Native Superpowers Provenance | 28, 52 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 7 | Implement Trusted Review Recognition, Pre-Spawn Augmentation, Finding Transport, and Parsing | 6, 16, 34, 35, 48, 54 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 8 | Persist Review Evidence and Resolve Metadata for the Current Superpowers Open Set | 8, 9, 36 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 9 | Make Conformance, Quality, and Type-Safe Final Review Evidence First-Class Acceptance Gates | 10, 12, 15, 17, 30, 32, 49 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 10 | Consume Activation/Capability Provenance, Classify/Reroute Semantic Work, and Remove Scheduling Authority | 41, 42, 43, 45 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 11 | Implement OmO Native Effective Configuration and Capability-First Doctor | 22, 23, 37 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 12 | Synchronize Remaining OmO Native v5.1.17 Drift Without Taking Runtime Ownership | none as direct owner; check local tests | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 13 | Implement v5 Recovery Diagnostics and Turn justice_review into a Control-Plane View | 24, 25, 26, 39, 40 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |
| 14 | Close Native Cross-Component E2E Coverage and Synchronize User/Upstream Documentation | 5, 7, 11, 14, 18, 46, 50, 51, 53, 56 | NOT_AUTHORIZED_FOR_V5_IMPLEMENTATION |

## 3. Task primary Requirements / Design contract anchors

- **Task 1 — Revised Fixture Evidence Spike for Justice Capability and Pre-Spawn Contract Protocol:** JUS5-COMP-01..04, JUS5-HARNESS-01..04, JUS5-CAT-05, JUS5-ACT-03, JUS5-CORR-02..06, JUS5-REV-06..07, J5D-ACT-01, J5D-CAP-01, J5D-HARNESS-01, J5D-CORR-02, J5D-ROUTE-01, J5D-REVIEW-02.
- **Task 2 — Establish Native Semantic Routing Types and Pure OmO Task Translation:** JUS5-CAT-01..05, JUS5-CAT-09, JUS5-CORR-01, JUS5-CORR-05..06, JUS5-TASK-03..04, J5D-CORR-01, J5D-ROUTE-01, J5D-CAT-01..02.
- **Task 3 — Implement ApprovedArtifactChain Authorization and Non-Promoting v4 Authorization Migration:** JUS5-AUTH-01..09, JUS5-PERSIST-01..05, J5D-CHAIN-01..02, J5D-RULING-01, J5D-PERSIST-01.
- **Task 4 — Build Deterministic Normative Clause Projection and Conformance Contracts:** JUS5-PLAN-01..05, JUS5-CONFORM-01..09, JUS5-PROJ-01..03, J5D-TASK-01, J5D-PROJ-01..03.
- **Task 5 — Add Durable Native ExecutionCorrelation and Task-Brief-Based Semantic Resolution:** JUS5-CORR-02..05, JUS5-TASK-01..04, JUS5-REC-01..03, J5D-CORR-02, J5D-REC-01.
- **Task 6 — Wire Senpi Events to Durable Execution Correlation and Produce Authenticated Native Superpowers Provenance:** JUS5-HARNESS-01..03, JUS5-CAT-05, JUS5-CORR-02..06, JUS5-SDD-01..04, JUS5-INLINE-01..02, J5D-CORR-02, J5D-ROUTE-01, J5D-OWN-01.
- **Task 7 — Implement Trusted Review Recognition, Pre-Spawn Augmentation, Finding Transport, and Parsing:** JUS5-REV-01..09, JUS5-SDD-03, JUS5-CAT-05, JUS5-CAT-09, JUS5-CORR-06, J5D-REVIEW-01..04, J5D-ROUTE-01..02, J5D-CAT-02.
- **Task 8 — Persist Review Evidence and Resolve Metadata for the Current Superpowers Open Set:** JUS5-REV-08..11, JUS5-QUALITY-01..03, JUS5-ACC-03, J5D-QUALITY-01, J5D-STORAGE-01, J5D-REVIEW-03..04.
- **Task 9 — Make Conformance, Quality, and Type-Safe Final Review Evidence First-Class Acceptance Gates:** JUS5-GATE-01..02, JUS5-CONFORM-01..09, JUS5-ACC-01..04, JUS5-COMPLETE-01, JUS5-REV-08..09, J5D-GATE-01, J5D-COMPLETE-01, J5D-REVIEW-03..04.
- **Task 10 — Consume Activation/Capability Provenance, Classify/Reroute Semantic Work, and Remove Scheduling Authority:** JUS5-ACT-01..04, JUS5-SDD-01..04, JUS5-DEP-01..03, JUS5-TASK-01..04, JUS5-PLAN-01..05, JUS5-CAT-05..09, J5D-OWN-01, J5D-ACT-01, J5D-TASK-01, J5D-ROUTE-01..02, J5D-CAT-02, J5D-DEP-01.
- **Task 11 — Implement OmO Native Effective Configuration and Capability-First Doctor:** JUS5-COMP-01..04, JUS5-HARNESS-01..03, JUS5-CONFIG-01..05, JUS5-DOC-01..04, J5D-CONFIG-01, J5D-DOCTOR-01.
- **Task 12 — Synchronize Remaining OmO Native v5.1.17 Drift Without Taking Runtime Ownership:** JUS5-CAT-01..04, JUS5-CTRL-01..03, JUS5-ERR-01..03, J5D-CAT-01, J5D-RUNTIME-01.
- **Task 13 — Implement v5 Recovery Diagnostics and Turn justice_review into a Control-Plane View:** JUS5-STATE-01..04, JUS5-REC-01..03, JUS5-PERSIST-01..05, JUS5-REVIEW-01, J5D-PERSIST-01, J5D-REC-01.
- **Task 14 — Close Native Cross-Component E2E Coverage and Synchronize User/Upstream Documentation:** all JUS5/J5D contracts; Design §29.

## 4. Plan's full Requirements ↔ Task and Design Contract ↔ Task registry

### Requirements → Task mapping

| Requirement IDs | Owning task(s) |
| --- | --- |
| JUS5-COMP-01, JUS5-COMP-02, JUS5-COMP-03, JUS5-COMP-04 | Tasks 1, 11 |
| JUS5-HARNESS-01, JUS5-HARNESS-02, JUS5-HARNESS-03 | Tasks 1, 6, 11 |
| JUS5-HARNESS-04 | Task 1 |
| JUS5-OWN-01, JUS5-OWN-02, JUS5-OWN-03 | Tasks 2, 6, 7, 10, 12 |
| JUS5-GATE-01, JUS5-GATE-02 | Task 9 |
| JUS5-CONFIG-01, JUS5-CONFIG-02, JUS5-CONFIG-03, JUS5-CONFIG-04, JUS5-CONFIG-05 | Task 11 |
| JUS5-CAT-01, JUS5-CAT-02, JUS5-CAT-03, JUS5-CAT-04 | Tasks 2, 12 |
| JUS5-CAT-05 | Tasks 1, 2, 6, 7, 10, 14 |
| JUS5-CAT-06, JUS5-CAT-07, JUS5-CAT-08 | Task 10 |
| JUS5-CAT-09 | Tasks 2, 7, 10, 14 |
| JUS5-CTRL-01, JUS5-CTRL-02, JUS5-CTRL-03 | Tasks 10, 11, 12 |
| JUS5-ACT-01, JUS5-ACT-02, JUS5-ACT-03, JUS5-ACT-04 | Tasks 1, 2, 6, 10, 14 |
| JUS5-PLAN-01, JUS5-PLAN-02, JUS5-PLAN-03, JUS5-PLAN-04, JUS5-PLAN-05 | Tasks 4, 10 |
| JUS5-AUTH-01, JUS5-AUTH-02, JUS5-AUTH-03, JUS5-AUTH-04, JUS5-AUTH-05, JUS5-AUTH-06, JUS5-AUTH-07, JUS5-AUTH-08, JUS5-AUTH-09 | Tasks 3, 9 |
| JUS5-SDD-01, JUS5-SDD-02, JUS5-SDD-03, JUS5-SDD-04 | Tasks 6, 7, 10 |
| JUS5-INLINE-01, JUS5-INLINE-02 | Tasks 9, 10 |
| JUS5-TASK-01, JUS5-TASK-02, JUS5-TASK-03, JUS5-TASK-04 | Tasks 2, 5, 10 |
| JUS5-CORR-01, JUS5-CORR-02, JUS5-CORR-03, JUS5-CORR-04, JUS5-CORR-05 | Tasks 2, 5, 6 |
| JUS5-CORR-06 | Tasks 1, 2, 6, 7, 10 |
| JUS5-STATE-01, JUS5-STATE-02, JUS5-STATE-03, JUS5-STATE-04 | Tasks 3, 5, 8, 13 |
| JUS5-REV-01, JUS5-REV-02, JUS5-REV-03, JUS5-REV-04, JUS5-REV-05, JUS5-REV-06, JUS5-REV-07, JUS5-REV-08, JUS5-REV-09, JUS5-REV-10, JUS5-REV-11 | Tasks 1, 7, 8 |
| JUS5-CONFORM-01, JUS5-CONFORM-02, JUS5-CONFORM-03, JUS5-CONFORM-04, JUS5-CONFORM-05, JUS5-CONFORM-06, JUS5-CONFORM-07, JUS5-CONFORM-08, JUS5-CONFORM-09 | Tasks 4, 9 |
| JUS5-PROJ-01, JUS5-PROJ-02, JUS5-PROJ-03 | Task 4 |
| JUS5-QUALITY-01, JUS5-QUALITY-02, JUS5-QUALITY-03 | Tasks 8, 9 |
| JUS5-ACC-01, JUS5-ACC-02, JUS5-ACC-03, JUS5-ACC-04 | Tasks 8, 9 |
| JUS5-COMPLETE-01 | Tasks 9, 14 |
| JUS5-DEP-01, JUS5-DEP-02, JUS5-DEP-03 | Task 10 |
| JUS5-ERR-01, JUS5-ERR-02, JUS5-ERR-03 | Task 12 |
| JUS5-DOC-01, JUS5-DOC-02, JUS5-DOC-03, JUS5-DOC-04 | Tasks 11, 13 |
| JUS5-REC-01, JUS5-REC-02, JUS5-REC-03 | Tasks 5, 13 |
| JUS5-PERSIST-01, JUS5-PERSIST-02, JUS5-PERSIST-03, JUS5-PERSIST-04, JUS5-PERSIST-05 | Tasks 3, 13 |
| JUS5-REVIEW-01 | Task 13 |

### Design Contract → Task mapping

| Design contract | Owning task(s) |
| --- | --- |
| INV-01, J5D-OWN-01 | Task 10 |
| J5D-ACT-01, J5D-CAP-01 | Tasks 1, 2, 6, 10, 14 |
| J5D-HARNESS-01 | Task 1 |
| INV-02, J5D-OWN-02, J5D-RUNTIME-01 | Tasks 2, 7, 10, 12 |
| INV-03, J5D-GATE-01 | Task 9 |
| INV-04 | Tasks 5–9, 13 |
| INV-05, INV-06, J5D-COMPLETE-01 | Tasks 3, 4, 9, 14 |
| J5D-TASK-01 | Tasks 5, 10 |
| J5D-CHAIN-01, J5D-CHAIN-02, J5D-RULING-01 | Tasks 3, 9 |
| J5D-CORR-01, J5D-CORR-02 | Tasks 2, 5, 6 |
| J5D-ROUTE-01 | Tasks 1, 2, 6, 7, 10 |
| J5D-ROUTE-02 | Tasks 2, 7, 10 |
| J5D-PROJ-01, J5D-PROJ-02, J5D-PROJ-03 | Task 4 |
| J5D-REVIEW-01, J5D-REVIEW-02, J5D-REVIEW-03, J5D-REVIEW-04 | Tasks 1, 7 |
| J5D-QUALITY-01, J5D-STORAGE-01 | Task 8 |
| J5D-CONFIG-01, J5D-DOCTOR-01 | Task 11 |
| J5D-PERSIST-01, J5D-REC-01 | Task 13 |
| J5D-CAT-01 | Tasks 2, 12 |
| J5D-CAT-02 | Tasks 2, 10, 14 |
| J5D-DEP-01 | Task 10 |

## 5. Plan's 56 required verification scenarios (test specifications, not executed results)

| # | Required scenario | Owning Task | Proposed test file | Exact planned test name | Planned evidence level | R0.1 independent status |
|---:|---|---:|---|---|---|---|
| 1 | checkbox-only Plan updates preserve authorization | 3 | `tests/core/artifact-chain.test.ts` | `preserves_authorization_for_checkbox_only_plan_progress` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 2 | interface/signature/assertion/global-constraint changes invalidate authorization | 3 | `tests/core/artifact-chain.test.ts` | `invalidates_chain_when_plan_contract_changes` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 3 | substantive Design change invalidates downstream Plan authority | 3 | `tests/core/artifact-chain.test.ts` | `design_change_stales_bound_plan_authority` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 4 | new human approval establishes new authorization lineage | 3 | `tests/core/artifact-chain.test.ts` | `reapproval_creates_new_artifact_chain_id` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 5 | implementation → Superpowers task review → Justice evidence → acceptance | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `sdd_task_reaches_acceptance_through_existing_superpowers_review` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 6 | Justice does not duplicate-dispatch reviewer | 7 | `tests/runtime/senpi-adapter-review-interop.test.ts` | `does_not_dispatch_duplicate_reviewer_for_recognized_superpowers_review` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 7 | Needs fixes → fix → scoped re-review → ADDRESSED → acceptance | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `scoped_re_review_resolves_blocking_finding_and_allows_acceptance` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 8 | NOT ADDRESSED remains blocking | 8 | `tests/core/review-quality-v5.test.ts` | `not_addressed_finding_remains_blocking` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 9 | round-cap/deferred findings remain visible | 8 | `tests/core/review-quality-v5.test.ts` | `parked_important_finding_remains_visible_and_blocking` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 10 | executing-plans lacks per-task reviewer without failure | 9 | `tests/core/conformance-gate.test.ts` | `executing_plans_task_does_not_require_fresh_per_task_reviewer` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 11 | inline final review/conformance still enforced | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `executing_plans_requires_final_review_and_final_conformance` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 12 | Plan interface differs from code → task block | 9 | `tests/core/conformance-gate.test.ts` | `plan_code_interface_violation_blocks_task_acceptance` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 13 | Design invariant differs from Plan → downstream authorization block | 3 | `tests/core/artifact-chain.test.ts` | `design_plan_mismatch_stales_downstream_authority` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 14 | implementation-discovered Design change requires reconciliation before resume | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `implementation_discovered_design_change_requires_reconciliation_before_resume` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 15 | code works/tests pass but violates Plan → acceptance blocked | 9 | `tests/core/conformance-gate.test.ts` | `passing_tests_do_not_override_plan_contract_violation` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 16 | reviewer omits required normative clause → NOT_PROVEN | 7 | `tests/core/review-result.test.ts` | `missing_required_clause_result_becomes_not_proven` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 17 | old full final review alone is stale after a fix; trusted scoped final re-review delta extends coverage only when affected/unaffected clause scope is proven | 9 | `tests/core/plan-completion-v5.test.ts` | `final_review_evidence_closure_extends_to_fix_head_only_with_scoped_delta_coverage` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 18 | all clauses SATISFIED, no blocking quality → completion permitted | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `complete_evidence_allows_plan_complete` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 19 | Justice does not emit canonical `deep` | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `does_not_emit_legacy_deep` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 20 | custom `sp-*` coexist with OmO v5 routing | 2 | `tests/core/omo-category-mapper-v5.test.ts` | `custom_sp_categories_coexist_with_omo_v5_categories` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 21 | Justice does not directly select model/provider | 2 | `tests/core/v5-task-routing-contract.test.ts` | `justice_does_not_select_concrete_model_or_provider` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 22 | compatible OmO Native/Senpi patch not rejected solely by version | 11 | `tests/runtime/doctor-v5.test.ts` | `compatible_native_patch_with_required_capabilities_is_supported` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 23 | missing required Native capability reported accurately | 11 | `tests/runtime/doctor-v5.test.ts` | `missing_native_task_or_child_binding_capability_is_unsupported` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 24 | compaction/restart retains plan/task/review correlation | 13 | `tests/core/v5-recovery.test.ts` | `recovers_plan_task_review_correlation_after_restart` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 25 | completed work not re-correlated to another Plan after recovery | 13 | `tests/core/v5-recovery.test.ts` | `does_not_recorrelate_completed_work_to_different_plan_after_recovery` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 26 | Justice/Superpowers state conflict surfaced | 13 | `tests/core/v5-recovery.test.ts` | `surfaces_superpowers_justice_state_conflict` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 27 | OmO Native task id/name and task_send target remain runtime-owned | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_task_send_runtime_continuation_target` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 28 | Native task call recoverably correlated by durable parent-session/tool-call binding | 6 | `tests/runtime/senpi-adapter-execution-correlation.test.ts` | `recovers_native_task_call_from_durable_parent_session_tool_call_binding` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 29 | `category + subagent_type` not silently resolved by Justice | 2 | `tests/core/v5-task-routing-contract.test.ts` | `reports_category_subagent_type_as_invalid_both` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 30 | missing/ambiguous execution correlation leaves evidence NOT_PROVEN | 9 | `tests/core/conformance-gate.test.ts` | `ambiguous_execution_correlation_leaves_evidence_not_proven` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 31 | Requirements change stales Design + Plan chain | 3 | `tests/core/artifact-chain.test.ts` | `requirements_change_stales_design_and_plan_authority` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 32 | substantive Ruling can continue execution but cannot authorize acceptance | 9 | `tests/core/conformance-gate.test.ts` | `substantive_ruling_does_not_authorize_acceptance` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 33 | duplicate/missing/ambiguous projection becomes INCOMPLETE/INVALID | 4 | `tests/core/conformance-projector.test.ts` | `projection_failures_never_return_complete` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 34 | exact pre-spawn serialized contract reaches bound child before output | 7 | `tests/runtime/senpi-adapter-review-interop.test.ts` | `native_bound_child_receives_conformance_contract_before_trusted_output` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 35 | missing/malformed structured review result blocks | 7 | `tests/core/review-result.test.ts` | `missing_or_malformed_review_result_is_rejected` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 36 | parked Important/Critical blocks until trusted disposition/human quality adjudication | 8 | `tests/core/review-quality-v5.test.ts` | `parked_critical_or_important_blocks_until_trusted_disposition` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 37 | effective config honors user/project + harness/profile precedence | 11 | `tests/core/omo-effective-config.test.ts` | `resolves_user_project_harness_profile_precedence` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 38 | v4 plan-only authorization not auto-promoted | 3 | `tests/core/v5-persistence.test.ts` | `v4_plan_authorization_is_not_promoted_to_v5_authority` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 39 | v4 review-dispatch state cannot resume/satisfy v5 gate | 13 | `tests/core/v5-recovery.test.ts` | `v4_review_dispatch_state_does_not_resume_or_satisfy_v5_review_gate` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 40 | unknown/newer persistence preserved and acceptance fail-closed | 13 | `tests/core/v5-recovery.test.ts` | `unknown_newer_schema_is_preserved_and_acceptance_fails_closed` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 41 | authorized implementation intent gains runtime-observed Native activation evidence | 10 | `tests/core/workflow-activation-v5.test.ts` | `authorized_implementation_activates_selected_superpowers_execution_method` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 42 | Justice activation does not own Superpowers task/review progression | 10 | `tests/core/superpowers-ownership-v5.test.ts` | `justice_activation_does_not_own_superpowers_task_progression` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 43 | recognized Superpowers Native worker intent translates the existing OmO task to one Justice category | 10 | `tests/runtime/senpi-adapter-semantic-routing.test.ts` | `recognized_superpowers_native_task_translates_to_justice_category` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 44 | non-Superpowers explicit subagent_type remains caller-owned | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_non_superpowers_explicit_subagent_type_without_category_injection` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 45 | semantic classification uses task semantics/complexity without selecting concrete runtime | 10 | `tests/unit/core/execution-role-classifier.test.ts` | `classifier_uses_full_plan_semantics_without_selecting_concrete_runtime` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 46 | OmO remains concrete model/provider/runtime resolver for translated Superpowers work | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `translated_superpowers_work_leaves_concrete_runtime_resolution_to_omo` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 47 | caller-owned OmO custom category outside Justice built-in vocabulary is preserved | 2 | `tests/core/v5-task-routing-contract.test.ts` | `preserves_user_defined_omo_category_without_translation` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 48 | ambiguous/model-inferred review-like producer provenance remains untrusted | 7 | `tests/runtime/senpi-adapter-review-interop.test.ts` | `ambiguous_review_like_action_is_not_trusted_without_recognized_superpowers_provenance` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 49 | artifact/scope/revision mutation stales review evidence before acceptance | 9 | `tests/core/plan-completion-v5.test.ts` | `artifact_or_revision_mutation_stales_review_evidence_before_acceptance` | unit | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 50 | clean review evidence does not create human implementation authorization | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `clean_review_does_not_bypass_human_artifact_chain_authorization` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 51 | Justice does not schedule remediation/re-review or own runtime retry/fallback | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `superpowers_remediation_and_omo_retry_ownership_remain_separate` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 52 | context-only delivery + pre-persistence sanitation + exact-call receipt provenance | 6 | `tests/runtime/senpi-adapter-provenance.test.ts` | `valid_live_capability_produces_authenticated_superpowers_provenance_for_exact_bound_call` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 53 | invalid capability/non-task leak cannot execute/trust; synthetic backstop | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `native_capability_negative_controls_never_produce_acceptance`; `native_non_task_capability_veto_and_synthetic_result_backstop_are_closed` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 54 | pre-spawn appendix failure/batch isolation | 7 | `tests/runtime/senpi-adapter-review-interop.test.ts` | `batch_review_appendices_bind_exact_items_without_cross_consumption` | integration | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 55 | fixture isolation, actual non-task veto/immediate-error sanitation/storage proof | 1 | `tests/integration/omo-native-senpi-contract-spike.test.ts` | `task1_fixture_does_not_inherit_external_provider_credentials`; `task1_capability_never_enters_persisted_session_history`; `task1_capability_is_removed_before_assistant_tool_call_persistence`; `task1_non_task_tool_capability_echo_is_blocked_before_execution`; `task1_unknown_tool_capability_echo_is_sanitized_before_persistence` | runtime spike | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |
| 56 | unsupported modes do not borrow host-session proof | 14 | `tests/integration/justice-v5-semantic-control-plane.integration.test.ts` | `unsupported_native_modes_do_not_inherit_host_session_acceptance` | E2E | NOT_INDEPENDENTLY_VERIFIED_IN_R0.1 |

## 6. Dependency and proof boundaries

- Task 1 evidence/fixture only, no Justice production source. Task 2–14 implementation requires an independent future Owner/Gate decision; an all-PROVEN Task 1 alone would not automatically authorize them.
- Task 5 and Task 12 have Task-local interface/verification definitions but no row directly assigned to them as primary owner in the 56-row scenario table. Do not infer no testing obligations.
- Task 6 consumes Task 1/2/5 outputs; Task 7 needs trusted Task 6 provenance; Task 8/9 need trusted Review and Conformance evidence; Task 10 consumes authenticated activation and category semantics; Task 14 E2E depends on those results.
- The 56 tests listed above have **not** been independently run by this knowledge consolidation. Historic Task 1 tests are described in V5-03 and are not all-purpose Host certification.
- Unsupported modes, nested/codemode calls, independent semantic origin and new runtime variants cannot borrow supported host-session evidence.

**Outcome:** `TRACEABILITY_SOURCE_EXTRACTED / COMPLETENESS_REVIEW_PENDING / NO_TEST_EXECUTION`.
