---
slug: justice-workflow-activation
status: drafting
intent: clear
review_required: false
pending-action: user approval to write .omo/plans/justice-workflow-activation.md
approach: Add /justice-start as the explicit OpenCode workflow bootstrap, backed by command.execute.before, and retain an explicit natural-language marker as a cross-harness fallback. Connect its lifecycle to the existing v2 observation and advisory systems without adding a public tool.
---

# Draft: justice-workflow-activation

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
| bootstrap contract | A typed, pure parser recognizes /justice-start arguments and the fallback marker, then validates optional relative artifact paths. | active | src/core/trigger-detector.ts, src/core/types.ts |
| session bootstrap | The OpenCode adapter establishes the active plan from a user request before any assistant echo or task call is needed. | active | src/runtime/opencode-adapter.ts, src/hooks/plan-bridge.ts |
| activation guidance | The bootstrap injects a concise directive that makes the agent run brainstorming and writing-plans only when the corresponding artifacts are absent, then delegates the next plan task. | active | src/hooks/plan-bridge.ts |
| observable lifecycle | Bootstrap, plan-ready, and task-window transitions are recorded as new v2 observation records and remain advisory-only. | active | src/hooks/observation-handler.ts, src/core/v2/observation-model.ts |
| command distribution | The package documents an OpenCode command configuration template and does not mutate user configuration at runtime. | active | README.md, package distribution metadata |
| user documentation | README documents /justice-start, the fallback phrase, expected artifacts, the observable success signal, and justice_review usage. | active | README.md |

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
| No new public Justice tool | Use an OpenCode slash command, which is separate from the tool registry, and retain a natural-language fallback. | D50 limits public tools to justice_review; OpenCode command hooks provide a dedicated command boundary. |
| Bootstrap is opt-in | Primary trigger is `/justice-start`; fallback requires the exact marker `Justice: start workflow`. Both accept optional relative artifact paths. | Avoid accidental activation from ordinary plan discussion while supporting non-OpenCode harnesses. |
| Brainstorming is conditional | Require brainstorming only when no design artifact is referenced; require writing-plans only when the requested plan file is absent. | Avoid re-running planning on an existing approved plan; deterministic from supplied paths and file existence. |
| v2 remains non-authoritative for execution | v2 observes bootstrap and reports advisory results but does not decide which task to dispatch. | Preserves v2's additive shadow architecture and L0 contract. |

## Findings (cited - path:lines)
| Existing plugin registration is complete, but its only public custom tool is justice_review. | src/runtime/opencode-adapter.ts:122-126; SPEC.md:1331-1337 |
| Current PlanBridge activation needs an assistant message containing both a plan path and delegation intent; user messages only populate lastUserMessages. | src/hooks/plan-bridge.ts:137-157; src/core/trigger-detector.ts:79-98 |
| The actual prompt injection happens later, at task PreToolUse, and requires an active plan path. | src/hooks/plan-bridge.ts:239-252; src/runtime/opencode-adapter.ts:539-568 |
| v2 is an additive, L0 advisory observation layer; it must not become an execution orchestrator. | SPEC.md:1216-1219; SPEC.md:1351-1359 |
| Observation Log is canonical while state.json is rebuildable projection cache, and declared evidence cannot satisfy Gate PASS. | SPEC.md:1293-1309 |

## Decisions (with rationale)
| Add `WorkflowStartRequest` parsing to the core trigger layer. It accepts `/justice-start` arguments or the explicit fallback marker and safe relative artifact paths, reusing existing traversal checks. This turns implicit assistant-content matching into an explicit user command protocol without an extra tool. |
| Add `PlanBridge.handleWorkflowStart()` to validate the request, inspect supplied/existing design and plan artifacts through FileReader, set the session active plan if ready, and return an injected directive. It must never call task() itself. This preserves the existing OpenCode execution authority and the plugin's fail-open boundary. |
| Add `OpenCodeAdapter.onCommandExecuteBefore()` and register `command.execute.before` in `OpenCodePlugin`. For command `justice-start`, parse arguments, dispatch bootstrap state, and append the structured workflow directive to `output.parts`. Keep `#handleChatMessage()` only for the explicit natural-language fallback. |
| Represent lifecycle observations as additive v2 record kinds or a typed reflection extension: workflow_started, design_requested, plan_requested, plan_activated. They are audit-only and have provenance declared/observed as appropriate; no default gate may require them. |
| Keep the existing automatic trigger detector as backward compatibility for existing users, but make the explicit protocol the documented primary path. |

## Scope IN
| Explicit user-start protocol, session bootstrap, conditional planning guidance, v2 lifecycle audit records, unit/integration tests, and README use cases. |

## Scope OUT (Must NOT have)
| New public tools besides justice_review; automatic background task dispatch; changes to the v2 L0 enforcement level; changes to plan.md ownership; feature-level acceptance or final-verifier implementation; runtime mutation of user OpenCode configuration. |

## Open questions
| None. The explicit natural-language marker is a reversible default and avoids violating D50. |

## Approval gate
status: awaiting-approval
Proposed implementation: add a v1 workflow bootstrap initiated primarily by `/justice-start` via OpenCode `command.execute.before`, with `Justice: start workflow` retained as a cross-harness fallback. It deterministically establishes or guides creation of design and plan artifacts, then lets the existing PlanBridge and task PreToolUse injection execute the next task. v2 records the lifecycle but remains advisory-only. User selected this slash-command approach; create the decision-complete implementation plan and do not implement in this session.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
