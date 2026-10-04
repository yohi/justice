# OmO Native v5.1.17 / Senpi v2026.10.8 Contract Evidence

**Status:** PENDING RUNTIME EXECUTION  
**Task:** Justice v5 Implementation Plan — Task 1 Evidence Spike  
**Scope:** evidence/tests/fixtures only; no Justice production source

## Pinned runtime

- OmO Native: `omo-ai@5.1.17`
- OmO source baseline: `091728d274f20d62504b0b5e1edbc3970671dd8b`
- Senpi: `@code-yeongyu/senpi@2026.10.8`
- Senpi source baseline: `d56e6a260d9468418a39bc9120945cf98e06b840`
- Superpowers: `v6.4.2`
- Superpowers source baseline: `8ca22dba9a94f28898bbce59f2537ff4d87c747d`

The spike installs the exact OmO and Senpi package versions in an isolated temporary runtime. Superpowers is installed from the exact v6.4.2 source commit. The runner refuses version drift before any contract can be marked PROVEN.

## Runtime isolation

Each run creates an isolated:

- `HOME` / `USERPROFILE`
- Senpi / Pi / OmO agent directory
- XDG config/data/cache/state directories
- project directory
- session directory
- mock-provider script
- evidence JSONL

No real model/provider credential is required. A local deterministic Senpi provider extension supplies parent and child model turns. The OmO `task` category is routed to that local provider.

## Observation probe

The runtime-only probe records:

- `session_start`
- `before_agent_start`
- `context`
- `tool_call`
- `tool_result`
- `session_compact`
- successful Superpowers `SKILL.md` reads as `read_tool_result` activation evidence

For a fixture-only review-delivery scenario the probe mutates one already-issued native `task` input by appending `[[JUSTICE_SPIKE_REVIEW_APPENDIX]]`. This mutation exists only to prove the Senpi mutation/child-delivery seam; it is **not** itself treated as trusted Superpowers provenance.

## Critical fail-closed question

The approved Design requires Superpowers task provenance to be authoritative and explicitly states that current-session method activation alone is insufficient provenance.

The pinned Senpi `tool_call` API exposes:

```text
toolCallId
parentToolCallId?   # only when another tool issued the call
toolName
input
```

The runtime spike therefore checks whether a model-issued `task` call exposes any additional host-authenticated origin binding to Superpowers. The spike MUST report `NOT PROVEN` if the only positive relationship is "a Superpowers method was activated earlier in the same session".

## Required contracts

The executable test enumerates all 15 Task-1 contract names from the approved Implementation Plan.

Execution is deliberately fail-closed. The architecture-critical provenance contract is evaluated as soon as the minimal Native activation → task path is observed. If that contract is not PROVEN, the plan's STOP rule applies immediately and later contracts remain `TODO / NOT EXECUTED AFTER BLOCKER` rather than being guessed from source code.

Any false architecture-critical contract means:

```text
Task 1 = BLOCKED
Tasks 2–14 = NOT AUTHORIZED
STOP → artifact reconciliation → Fresh Superpowers Review Gate
```

## Runtime result

Pending GitHub Actions execution. Replace this section with the captured `JUSTICE_SPIKE_EVIDENCE_SUMMARY` and final `PROVEN` / `NOT PROVEN` decision after the pinned runtime has executed.
