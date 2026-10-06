# Justice v5 Requirements

<!-- markdownlint-disable MD013 -->

**Date:** 2026-09-27
**Status:** Task 1 BLOCKED reconciliation — Fresh Superpowers Review Gate required
**Authorization:** NOT SELF-AUTHORIZING
**Target:** Justice v5.x
**Upstream baselines:** Oh My OpenAgent v5.1.17 (OmO Native), Senpi v2026.10.8, Superpowers v6.4.2

---

## 1. Purpose

### Evidence and authorization checkpoint

The approved Review Gate baseline is Justice `53d4abcc7b1a887f18860c0f3ba013aae0c2fbf3`. Task 1 evidence commit `e2a1662794927f3be11c3e58b688cbfb482bb3f0` reports **BLOCKED: 15 contracts, 9 PROVEN, 6 BLOCKED**. The pinned Superpowers source is `8ca22dba9a94f28898bbce59f2537ff4d87c747d`; OmO/Senpi pins remain those recorded in the Plan.

Preserved PROVEN host primitives: isolated pinned OmO/Senpi session starts/exits normally; model-issued task reaches the actual OmO tool; Senpi tool_call/tool_result and pre-execution input mutation are observable; type-only `ExtensionAPI` import from `@code-yeongyu/senpi` is valid; parent results expose runtime task IDs; those IDs uniquely bind child session storage in the tested host-session path; `read_tool_result` proves current-session method activation; no Justice production source was needed.

Native exact Superpowers task-call provenance and exact review appendix delivery remain BLOCKED. `host_expanded_skill_input`, compaction activation survival, and identical cross-mode physical child binding remain NOT_PROVEN. This reconciliation defines a Justice protocol; it does not upgrade those runtime results.

Tasks 2–14 remain NOT AUTHORIZED. A Fresh Superpowers Review Gate is required; READY authorizes only the revised Task 1 evidence spike. Even an all-PROVEN revised spike requires reconsideration of production authorization before Task 2.

Review Gate repair checkpoint: head `01d81970ac4558a65aefb6ef5cb2832b83a5a077` was BLOCKED by RG-005 (bearer token persistence contradiction) and RG-006 (Uint8Array encoding mismatch). RG-001..004 remain resolved. Revised Task 1 and Tasks 2–14 are currently NOT AUTHORIZED; only another Fresh Gate READY can authorize the revised spike. This repair selects request-local context delivery plus pre-persistence assistant sanitation and private outbound receipts; it adds no runtime PROVEN claim.

Current repair input is `c685bcfde9559a8e691f22596d9dfc8f00063786`: RG-005 is partially resolved, with request-local delivery/assistant sanitation accepted; its remaining non-task executable-copy and synthetic-result gap is closed by the Task 6 global secret guard/backstop below. RG-001..004 and RG-006 remain resolved. No revised Task 1 or production task is authorized by this document repair.

Justice v5 must realign Justice with current OmO and Superpowers while preserving Justice's core role as the **Semantic Control Plane** between them.

The system boundary is:

```text
User / authorized implementation intent
          ↓
Justice activation bridge
          ↓
Superpowers
  WHAT: methodology / execution-method selection / workflow progression
          ↓ semantic execution intent
Justice
  SEMANTIC HOW: execution classification / category translation
  correlation / evidence / gates / acceptance
          ↓ semantic category
OmO
  CONCRETE HOW: agent/runtime / model / provider / retry / fallback
```

Justice's responsibility is:

> Activate the supported Superpowers methodology selected by authoritative intent, translate Superpowers semantic execution intent into an OmO-facing semantic category, and prove that the resulting execution remains consistent with the approved artifact chain.

Justice must act as the **nervous system and quality gatekeeper** between Superpowers' “brain” and OmO's “limbs”. Superpowers does not need to know OmO categories, and OmO does not need to know Superpowers methodology semantics.

---

## 2. Primary completion requirement

Justice v5 must prevent completion while any substantive mismatch remains between:

- Requirements;
- Design / Spec;
- Implementation Plan;
- source implementation;
- tests / verification.

The target completion invariant is:

```text
unresolved semantic drift == 0
unauthorized semantic drift == 0
missing required evidence == 0
blocking quality findings == 0
```

“Zero drift” means zero unresolved, unexplained, or unauthorized difference that changes normative behavior or contract. It does not require textual identity between artifacts.

---

## 3. Compatibility scope

### JUS5-COMP-01

Primary audited integration:

- Justice v5;
- OmO Native v5.1.17;
- Senpi v2026.10.8 compatible extension/task contract;
- Superpowers v6.4.2 Pi package contract.

Compatible OmO/Senpi patch releases may be supported when the required capabilities below remain present; exact patch equality is evidence metadata, not the compatibility authority.

### JUS5-COMP-02

Justice must identify, where observable:

- Justice version;
- OmO Native version;
- Senpi engine/API version;
- Superpowers version/package contract;
- active harness and required capability status.

### JUS5-COMP-03

Native compatibility must be capability-first. At minimum Justice must verify the audited Senpi/OmO Native surfaces it relies on:

- the `task` tool exists and enforces `category XOR subagent_type`;
- `tool_call` exposes `toolCallId`, mutable `event.input`, and the current session through `ctx.sessionManager.getSessionId()`;
- `tool_result`, `before_agent_start`, `context`, `session_start`, `session_compact`, and `session_shutdown` observation needed by the selected adapter contract is available;
- Superpowers is loaded as a Pi package and its skill resources/bootstrap are observable;
- any child-session/reviewer binding surface required for trusted evidence is demonstrated by runtime evidence before implementation relies on it.

If the exact child-binding/reviewer-delivery surface cannot be proven, the affected evidence path is unsupported / `NOT_PROVEN`; Justice must not invent an OpenCode-style substitute.

### JUS5-COMP-04

OmO v4, the OmO OpenCode edition, and obsolete Superpowers behavioral compatibility are not mandatory for the primary v5 Native baseline. The existing OpenCode adapter may remain as a secondary compatibility surface, but it must not define Native semantics.

---

## 4. Harness scope

### JUS5-HARNESS-01

Justice v5 is **OmO Native / Senpi first**. Its primary runtime integration is a Senpi/Pi extension adapter that coexists with the OmO Senpi package and the Superpowers Pi package in the same Native session.

### JUS5-HARNESS-02

The OpenCode edition is a secondary compatibility adapter only. OpenCode-specific hooks, SDK response shapes, command rewriting, session lookup, and review-controller mechanics are not normative for the Native control-plane contract.

### JUS5-HARNESS-03

Native interop must be established by an evidence spike against the audited upstream versions before production adapter code is implemented. The spike must prove the exact event/correlation/injection seams used by Justice. Source inspection alone may establish API possibility, but runtime claims such as child-session binding, event ordering, and review-context delivery require executable evidence.

Task 1 proves host primitives for the Justice-defined capability protocol, not an upstream semantic-origin field. Fixtures/probes must prove A–K: pinned co-loading; exact method skill read; fixture directive delivered only in request-local context after that read; deterministic legal-field transport; exact outbound receipt/session/toolCall observation; assistant transcript sanitation before persistence and validation/stripping before execution; prompt augmentation reaching the exact child before trusted output; no-capability rejection; wrong-session rejection; accepted-compaction/restart invalidation; and normalized delivery/correlation for every supported mode. Any missing contract is BLOCKED and stops for artifact reconciliation.

RG-005 adds mandatory `task1_capability_never_enters_persisted_session_history` and `task1_capability_is_removed_before_assistant_tool_call_persistence`: inspect actual isolated Senpi session files/entries and host logs after read, request-local delivery, model task, message_end sanitation, exact tool_call validation, execution, and settlement. Checking only copied/exported evidence is insufficient. Test successful single/batch calls, malformed/duplicate markers, non-tool assistant echo, sanitation fallback, and stale transcript replay.

Also require `task1_non_task_tool_capability_echo_is_blocked_before_execution` and `task1_unknown_tool_capability_echo_is_sanitized_before_persistence`. A real deterministic model call through pinned Senpi must exercise the resolved fixture tool with an observable side-effect marker and the actual unknown/incomplete/immediate-error path respectively. Assert the exact terminating veto, no tool side effect/execution, invalidation where guarded, no receipt/provenance, and token-free actual storage/logs/evidence. Fake probe events cannot prove either contract.

### JUS5-HARNESS-04 — Hermetic evidence harness

Task 1 child processes construct an explicit environment allowlist and never spread the caller's complete `process.env`. They strip provider credentials and provider-selection variables, force the pinned deterministic mock provider, disable external fallback, and fail closed on non-mock provider selection. Raw evidence must never persist TOKEN / SECRET / PASSWORD / COOKIE / CREDENTIAL / API_KEY values or opaque capability values. Focused tests are `task1_fixture_does_not_inherit_external_provider_credentials` and `task1_fixture_fails_closed_on_non_mock_provider_selection`. This requirement belongs to the evidence harness, not production provider selection.

### Historical regression source policy — Justice v4.3.1

Justice `v4.3.1` is a historical regression corpus, **not** the Justice v5 implementation base. This subsection adds no independent normative requirement IDs; it records which existing `JUS5-*` contracts were earned from v4 production failures so later harness work does not accidentally reintroduce them.

| v4 evidence | Failure class learned from v4 | Canonical v5 requirement mapping | Portability decision |
| --- | --- | --- | --- |
| `de2ca2a0e2c23ed0a71808b7de246a292c0c00d8`, `54e240ffc5415443dfa5d3dc243945e16d9d2631`, `8c8f8fd400b06d9228ceb7e30ab9c94a2acfcc72` | approved task semantics, caller-owned routing, or OmO continuation identity can be lost by reconstruction/normalization | JUS5-PLAN-04/05, JUS5-CORR-05/06 | retain the semantic contracts; do not port the v4 normalization implementation |
| `821343eba1223371ae0a7a20e02e7370db900306`, `4759d777aab9c80b897c55392bcc0f5833d79d7b`, `1781c7efae22ac1304fa8dc0d1f621c888943a1e` | final/task/scoped review roles can be misclassified as implementation or lose their semantic route | JUS5-REV-02/06, JUS5-CAT-05/06 | retain as regression contracts |
| `aba390a983fd8eaea791785727aef39599b9d6aa`, `4688a96982355fff87e2d37e1a775b2456c6904f` | model inference can choose the wrong review executor/route, so a review-looking action is not by itself trusted review provenance | JUS5-REV-05/06 | require unambiguous observed provenance; the OpenCode controller wrapper is non-normative |
| `19ebb1c5ae9994e8b43a48b5b0ab0a43a6b006de`, `7ad4b6649a492049467d622dbc57d8b7dda94344` | unreadable, stale, scope-mismatched, or mutated review inputs/results must fail closed | JUS5-AUTH-02/04, JUS5-REV-09 | retain freshness/scope/fail-closed semantics |
| `96d088398680c6ec04f65f809384e8d6fe6d5c80`, `faae0834c0c3e7bc2adb90cbf7de9cac36506dca`, `bef5f3437d8f3827ea13cdab06267740360a0ca9` | a clean review result is not implementation authorization | JUS5-AUTH-01/02/06, JUS5-ACC-01 | retain the authorization separation; do not port the OpenCode-specific lock implementation verbatim |
| `05277cfdffb16ec135ea13ce1b4e978228e35a3a`, `7ad4b6649a492049467d622dbc57d8b7dda94344` | remediation requires fresh evidence, but owning the fix/re-review loop in Justice duplicates Superpowers methodology | JUS5-OWN-01, JUS5-REV-04/09/10, JUS5-ERR-01 | retain evidence freshness; Superpowers owns remediation/re-review progression and OmO owns runtime retry/fallback |
| `7f88e28c620ff74568691bedb88f93a1e723a1be`, `ac548a1a61eeb726f5bfe53c77ea6bab22a5300d` | an operational Justice bypass is useful for recovery/A-B diagnosis | none in this baseline | keep as an adapter-level capability candidate; it is not promoted here to a v5 acceptance requirement |
| `eea681d879ee848ba57ac51a69284392b9834544`, `368632bddda72f83fb36e58b50dd30df5fbe7e72` | OpenCode command visibility and prompt-template semantics can differ from model assumptions | harness-specific only | do not make OpenCode command mechanics a cross-harness Justice contract |

The temporary same-session bootstrap binding introduced by `efec7a3ec5e0ae38b1b3f09e44112526ea97ee77` was superseded on the v4 line by the later standalone Gate architecture; it is **not** retained as a v5 invariant.

---

## 5. Ownership invariants

### JUS5-OWN-01 — Superpowers

Superpowers is the Source of Truth for:

- brainstorming;
- specification workflow;
- writing plans;
- execution-method selection;
- SDD task progression;
- task-review progression;
- fix/re-review progression;
- final whole-branch review;
- completion methodology.

Justice must not reimplement these workflows.

### JUS5-OWN-02 — OmO

OmO is the Source of Truth for:

- agent runtime;
- task execution;
- category-to-runtime resolution;
- model selection;
- provider selection;
- retry/fallback;
- tool execution.

Justice must not directly choose model/provider/fallback behavior.

### JUS5-OWN-03 — Justice

Justice owns:

- the supported Superpowers methodology activation bridge;
- semantic execution classification;
- provenance-aware Superpowers intent → OmO category translation;
- plan-scoped authorization;
- semantic category correlation;
- execution observation;
- provenance;
- evidence;
- gate evaluation;
- drift detection;
- task acceptance;
- plan completion;
- workflow integrity diagnostics.

---

## 6. Fail-open / fail-closed boundary

### JUS5-GATE-01

Runtime execution may remain fail-open for optional Justice telemetry/enrichment failures where safe.

### JUS5-GATE-02

Acceptance must be fail-closed.

If required evidence cannot be proven, Justice must not project:

- Authorized;
- Accepted;
- Verified;
- Complete.

Unknown or missing proof is blocking.

---

## 7. Configuration

### JUS5-CONFIG-01

The authority for **configured state** is the OmO v5 **effective configuration resolution**, not any single `omo.jsonc` file.

### JUS5-CONFIG-02

Legacy `oh-my-opencode.jsonc` / `oh-my-openagent.jsonc` may be detected as migration inputs but must not be documented as current primary configuration.

### JUS5-CONFIG-03

When filesystem resolution is required, Justice must reproduce the OmO v5 layer order:

1. user layer: `~/.omo/omo.jsonc`, falling back to `~/.omo/omo.json`;
2. project layers: `.omo/omo.jsonc`, falling back to `.omo/omo.json`, from the farthest ancestor to the nearest project directory;
3. the nearest project layer has the highest file-layer precedence;
4. the home directory is not double-counted as a project layer.

### JUS5-CONFIG-04

After file-layer merge, Justice must account for the OmO v5.1.17 effective-view order for the **Native** harness:

```text
shared base
→ [native]
→ selected profile base
→ selected profile [native]
```

The legacy `[senpi]` spelling is migration/deprecation input and must not become Justice's canonical output. Profile selection follows the audited OmO config contract (`OMO_PROFILE` > `OCX_PROFILE` > supported profile-directory inference > none), and loader diagnostics are part of configured-state interpretation.

### JUS5-CONFIG-05

If OmO exposes a compatible effective-config API, Justice should use that as configured-state authority. If not, Justice may inspect files only by following the same precedence/resolution semantics and must report the source layers and diagnostics used.

---

## 8. Categories and routing

### JUS5-CAT-01

Justice must align its compatibility/diagnostic vocabulary with the current OmO Native built-in categories, including:

- visual-engineering;
- architect;
- ultrabrain;
- deep-low;
- deep-high;
- artistry;
- quick;
- unspecified-low;
- unspecified-high;
- writing.

Caller-owned custom categories remain an open namespace and are not limited to this list.

### JUS5-CAT-02

Justice must not emit legacy `deep` as a new canonical category. Legacy input may normalize to `deep-low`.

### JUS5-CAT-03

Justice custom categories remain supported:

- sp-mechanical;
- sp-implementation;
- sp-integration;
- sp-deep;
- sp-architecture;
- sp-review;
- sp-final-review.

### JUS5-CAT-04

Category-to-model/provider mapping remains OmO configuration responsibility.

Justice distinguishes two category namespaces:

- `SpCategory`: the closed Justice-generated semantic category union (`sp-*`);
- caller-owned OmO category names: an open non-empty string namespace that may include OmO built-ins or user-defined categories from effective `omo.jsonc`.

The static current built-in category list is compatibility/diagnostic vocabulary only. It is not the complete authority for caller-owned OmO category names.

### JUS5-CAT-05 — provenance-aware Superpowers routing translation

Justice must distinguish caller/provenance before applying the OmO Native task XOR contract.

Current Native task facts:

```text
new child:
task(prompt, exactly one of category | subagent_type)

background child id:
st_...

continuation / steering:
task_send(to = <task id or name>)
```

Rules:

- a non-Superpowers caller's explicit `subagent_type` remains caller-owned and is preserved;
- an explicit caller `category` is a caller-owned non-empty OmO category name and is preserved unless the call is authoritatively recognized as a Superpowers semantic worker/reviewer call that Justice is responsible for translating;
- Superpowers v6.4.2's Pi bootstrap does not itself define OmO's `task` tool. Justice may contribute a **Native tool-mapping appendix** telling an active Superpowers workflow to express “dispatch a subagent/reviewer” by issuing the existing OmO Native `task` tool, but that appendix is guidance only: Justice does not invoke `task` on Superpowers' behalf;
- once a model-issued `task` call is authoritatively recognized as Superpowers work and semantic classification exists, Justice may mutate that existing `tool_call.event.input` in place to the single authoritative `sp-*` `category`; it must remove a conflicting generic routing field rather than emit both targets;
- an explicitly specialized direct `subagent_type` (for example `explore`, `librarian`, or another loaded named agent) remains caller-owned unless the supported compatibility profile explicitly defines it as a Justice-translatable Superpowers role;
- `task_send` continuation/steering and an existing `st_...` runtime task identity remain OmO-owned and must not receive a newly selected worker category;
- ambiguous/untrusted Superpowers provenance must not be translated as trusted semantic routing.

Final new-child payloads must satisfy `category XOR subagent_type`. Justice must never use a runtime task id as semantic TaskIdentity.

#### Native Superpowers provenance contract

`TaskRoutingProvenance.kind = "superpowers"` is a trusted **authenticated protocol-affiliation claim** for one exact model-issued task call. It MUST NOT be inferred from prompt wording, task-body similarity, review-looking text, active-method state alone, or mere presence of the Native mapping appendix. The parent model asserts affiliation by presenting a Justice-minted capability through the legal transport; Justice authenticates that assertion by validating current activation/authorization/session/method, the private outbound receipt, exact call identity/input digest, and token-free restoration. This claim is sufficient for Justice semantic routing/review under the supported trusted-model/provider profile, but it is deliberately **not** a host-independent proof of the model's hidden causal reasoning or of an upstream Superpowers dispatcher event.

The pinned runtime exposes no proven semantic-origin field binding Superpowers workflow intent to the exact task call. Justice instead owns `NativeSuperpowersTaskCapability` with schemaVersion `justice-native-superpowers-task-capability-v1`, opaque `capabilityId`, `authorizationId`, `sessionId`, `method`, and `issuedFromReadToolCallId`.

- Mint only after a successful PROVEN current-session read of the selected installed Superpowers method SKILL.md, bound to active authorization/session/method.
- Generate exactly 32 cryptographically random bytes; `encodeCapabilityId(bytes: Uint8Array): string` returns RFC 4648 URL-safe base64, no padding, exactly 43 ASCII characters matching `^[A-Za-z0-9_-]{43}$`; invalid byte length throws `TypeError("capability_byte_length")`. Issue with `encodeCapabilityId(randomBytes(32))`, never Uint8Array.toString or prompt-derived tokens. Known-vector/length/padding tests belong to Task 2.
- Keep capability and activation validity in process memory only. Shutdown, restart (including same session ID), accepted compaction, authorization invalidation/replacement, and method replacement invalidate them. `restartCompactionValidity` is fixed to `same_session_only`.
- Deliver the raw token only by modifying the deep-copied successful method read message in the next request-local `context`; never modify the persisted read ToolResultMessage, inject a durable custom message, or write an entry containing it. The parent model transports it only through optional task `description` under Design §7.5; unknown task properties remain forbidden.
- Before assistant persistence, Task 6 message_end captures exact model ToolCall ID/item/token digest in a process-private outbound receipt and removes/restores the description envelope in the same-role assistant message. At exact tool_call, validate this receipt plus matching stripped argument digest, current activation/authorization/session/method and live registry; sanitize any preprepared raw argument copy before execution. When all checks succeed and the restored input is token-free, Task 6 may produce `kind: "superpowers"` as the authenticated protocol-affiliation claim for that exact call. Sanitation alone is never validation, and prompt/template similarity cannot manufacture the claim.
- Trusted evidence binds protocolId, capabilityDigest (never the token), authorizationId, method, issuedFromReadToolCallId, parentSessionId, parentToolCallId, observedAt, optional batchItemIndex, and two Task-6-derived token-free typed bindings: `activationEvidence` and `callBindingEvidence`. `activationEvidence` is copied only from the current trusted `WorkflowActivationEvidence` after exact authorization/session/method/read-call matching. `callBindingEvidence` is derived only from the exact private outbound receipt plus the validated current tool_call/input digest. Neither binding is caller supplied; no arbitrary string reference list can satisfy provenance. Review kind is a separate Task 7 result, not proof of protocol affiliation.
- The supported semantic trust boundary assumes the parent model/provider does not deliberately attach a live capability to an unrelated call. Justice detects missing, stale, replayed, wrong-session/method/authorization, malformed, mismatched and leaked capabilities, but it cannot independently observe hidden model causality once the authorized model legitimately possesses the token. Deliberate semantic mislabeling by that token holder is outside this provenance claim, just as a malicious model provider is outside the capability-secret threat model.
- Reject no-marker unrelated/review-looking calls, wrong-session, expired, post-compaction, wrong-authorization, wrong-method, malformed, and duplicate markers; they cannot satisfy trusted provenance or acceptance.

Raw capabilityId MUST NOT occur in persisted read ToolResultMessage, assistant ToolCall arguments, session JSONL/history (including inactive branches), Justice durable state, review appendix, child prompt, logs, or raw evidence. Only capabilityDigest and the token-free typed provenance bindings defined above may persist in the explicitly defined provenance/diagnostic evidence fields. Live capability validity, context delivery state, and outbound receipts remain memory-only; restart/accepted compaction invalidates them, and loading sanitized/stale history never creates a receipt or capability. Task 6 owns inbound and outbound sanitation; Tasks 7/10 consume only authenticated `TaskRoutingProvenance`. The supported trusted extension/provider profile disables raw request/response/stream recording and requires the audited message_end guard ordering/fallback; unverified profile → no token issuance, NOT_PROVEN. This protects ordinary host persistence and accidental logging, not a malicious model provider or arbitrary installed extension with process-memory access. Runtime exceptions must use the token-free same-role fallback in Design §7.5 rather than rely on Senpi's fail-open handler exception policy.

Task 6 additionally owns `guardCapabilityToolCall(input: NativeCapabilityToolCallGuardInput): NativeCapabilityToolCallGuardResult` and invokes it for **every** Senpi tool_call before any Justice tool-specific logic, including non-task, custom and nested calls. For toolName !== task, recursively inspect executable event.input own keys and string values (including nested objects/arrays) for a literal case-sensitive occurrence of any full live or sanitation-retained retired token. A match, or an exact-call non-task leak veto captured during assistant sanitation, prevents execution, invalidates the current session capability/related outbound receipts while retaining tokens only for sanitation, and returns the sole host veto `{block:true,reason:"justice_capability_token_leak",terminate:true}`. Record the exact-call veto privately so a token-free canonical message/prepared copy cannot cause a deliberately leaking non-task call to execute after sanitation. Inspection/invalidation failure also uses this token-free fixed veto, never a raw exception. No receipt, semantic classification or Superpowers provenance is produced by this guard. It does not own task progression or retry; fresh method read is required before new capability issuance after a veto.

For task, the generic guard continues into the unchanged task-only receipt/activation/authorization/session/method/exact-call validation, legal description restoration/stripping, remaining-args scan and token-free read-back. Pipeline order is generic secret guard → task-only provenance resolver → Task 7 pre-spawn augmentation → Task 10 routing → OmO execution; non-task calls never enter that provenance pipeline.

The message_end persistence backstop covers **assistant and toolResult**. For toolResult, replace exact live/retired token occurrences with `[JUSTICE-CAPABILITY-REDACTED]`, preserving role, non-secret toolCallId/toolName and result semantics; secret-bearing portions of those identifiers are redacted rather than persisted. Never create receipts/provenance from results or log originals. This covers synthetic unknown/incomplete/validation errors that bypass normal beforeToolCall. Pre-sanitization provider stream events, tool_execution_start and other host-local ephemeral objects are trusted transient memory only: the audited profile forbids recording them, and Task 1 fails on any raw-event persistence. No provider wrapper, SessionManager monkeypatch, transcript rewrite or private host API is introduced.

Ownership is acyclic: Task 1 proves the host primitives for authenticated capability presentation/exact-call binding → Task 2 owns capability/provenance/activation domain interfaces → Task 6 observes activation, issues/validates/invalidates capabilities and produces authenticated protocol provenance → Task 7 consumes it for pre-spawn review augmentation and Task 10 consumes it for semantic routing → Task 14. Task 6 never consumes Task 10 output.

Unrelated or review-looking model-issued `task` calls **without a valid authenticated capability/receipt/exact-call chain**, and calls whose activation/authorization/session/method/receipt/call/input observations are missing or conflicting, are `external` or `ambiguous`; they MUST NOT be upgraded to trusted Superpowers provenance. Once that full authenticated chain succeeds, task prose or hidden-causality guesses MUST NOT downgrade the call. The pinned runtime exposes no independent semantic-origin field, and Justice does not invent one: `kind: "superpowers"` means an authenticated affiliation assertion under this protocol, not proof of an upstream dispatcher event.

### JUS5-CAT-06 — semantic execution classes

Justice classifies recognized Superpowers work into exactly one semantic execution class when sufficient authoritative task/review semantics exist:

- `mechanical`: bounded, repetitive or deterministic work with a small change surface, no architecture judgment, and no cross-component state coordination;
- `implementation`: ordinary feature implementation with bounded component responsibility and normal coding judgment;
- `integration`: multi-component/module/interface coordination, migration, or state/concurrency/async/data-flow interaction across boundaries;
- `deep`: substantial investigation, root-cause research, unknown behavior, or high reasoning ambiguity that is not itself an architecture decision;
- `architecture`: component/public-interface boundary, persistent-state ownership, protocol responsibility, security boundary, or another major architectural decision;
- `review`: Superpowers task review or scoped re-review;
- `final-review`: Superpowers whole-branch/final review.

The semantic class maps deterministically to the matching Justice `sp-*` category.

### JUS5-CAT-07 — semantic precedence and inputs

When more than one semantic signal applies, precedence is:

```text
final-review
> review
> architecture
> deep
> integration
> mechanical
> implementation
```

Classification must consume structured Plan/review semantics where available, including:

- task heading and full task body;
- Files;
- Interfaces / Consumes / Produces;
- signatures / exact values;
- test and verification surface;
- cross-task dependencies;
- explicit review kind;
- architecture/security/persistent-state obligations.

Keywords may be supporting signals but must never be the sole authority for a higher semantic class.

### JUS5-CAT-08 — ambiguous semantic classification

If a recognized Superpowers new-worker dispatch cannot be classified authoritatively because required semantic context is missing, conflicting, or ambiguous, Justice must not fabricate an `sp-*` category.

The runtime call may remain on its original generic path only under the existing fail-open execution policy, but the routing result is untrusted and cannot satisfy required acceptance evidence.

Justice must not choose a concrete model/provider as an ambiguity fallback.

### JUS5-CAT-09 — review and runtime mapping

For the supported Superpowers v6.4.2 / OmO Native v5.1.17 profile:

```text
Superpowers implementation subagent intent
  → model-issued OmO task(...)
  → Justice semantic classification
  → sp-mechanical | sp-implementation | sp-integration | sp-deep | sp-architecture

Superpowers task/scoped reviewer intent
  → model-issued OmO task(...)
  → review
  → sp-review

Superpowers whole-branch final reviewer intent
  → model-issued OmO task(...)
  → final-review
  → sp-final-review
```

Justice's category is a semantic routing input only. OmO Native effective configuration remains the sole authority that resolves it to the concrete agent/model/provider/reasoning/execution mode/retry/fallback behavior.

Superpowers guidance about worker difficulty/model suitability is semantic capability intent, not Justice authority to select a concrete model. A future Superpowers/Native contract that exposes a concrete runtime selector as wire authority requires an explicit compatibility-profile revision rather than silent precedence invention.

### JUS5-CTRL-01

Justice must recognize at least:

- brainstorming;
- writing-plans;
- subagent-driven-development;
- executing-plans.

### JUS5-CTRL-02

Legacy Sisyphus/Atlas/OpenCode controller mappings are compatibility history only and must not define the OmO Native controller/runtime model. Native task/category/tool capabilities are the primary authority.

### JUS5-CTRL-03

Desired, configured, applied, and observed controller state must remain distinct. If actual application cannot be authoritatively observed, Justice must report Unverified.

### JUS5-ACT-01 — Superpowers methodology activation bridge

Justice must bridge an authoritative implementation-method selection into activation of exactly one supported Superpowers execution method:

- `subagent-driven-development`;
- `executing-plans`.

Justice owns the activation/evidence bridge, not methodology selection or internal workflow progression. Superpowers is a Pi package whose bootstrap is injected through its own `context` handler; Justice must coexist with that bootstrap and must not replace it.

### JUS5-ACT-02 — method selection is distinct from activation

Justice must represent:

```text
MethodSelection
= which supported Superpowers methodology is selected

ActivationEvidence
= proof that the selected methodology content was loaded/invoked
  for the current controller session
```

Selection source order remains:

1. explicit user/command selection for the current implementation start;
2. trusted recovered method selection from the same active authorization;
3. otherwise `method_selection_required`.

Justice must not infer SDD vs inline execution from task complexity.

### JUS5-ACT-03 — Native current-session activation evidence and recovery

For the OmO Native / Senpi harness, the required activation channel is `read_tool_result`: a successful `read` tool_result whose canonical path resolves to the exact installed Superpowers `skills/<method>/SKILL.md`, matching the observed read call and current controller session. Task 1 established this channel as PROVEN. `host_expanded_skill_input` remains NOT_PROVEN and is not an implementation prerequisite or accepted activation kind.

A plain model assertion such as “I am using subagent-driven-development”, an OmO `load_skills` child option, a child task id, or extension-injected text is not controller activation evidence.

Trusted activation evidence binds at least:

```text
authorizationId
sessionId
method
evidenceKind
observedCallOrInputId
observedAt
```

For this baseline, `evidenceKind` is a bounded union:

```text
read_tool_result
```

A new evidence channel requires artifact reconciliation. Activation is live-session-only and never restored from persistence. Cross-session and same-session restart recover method selection only. Accepted session compaction invalidates ActivationEvidence and every NativeSuperpowersTaskCapability; fresh method activation is required unconditionally. A compaction request without an accepted event is not evidence that compaction occurred.

### JUS5-ACT-04 — activation decisions, conflicts, and failure

After method selection:

- matching valid current-session ActivationEvidence → `already_active`;
- no matching evidence + proven Native activation capability → `needs_activation`;
- required activation/evidence capability unavailable → `unavailable`;
- no selection → `method_selection_required`.

Justice may request/instruct loading the selected Superpowers skill through the supported Native skill mechanism, but it must not implement Superpowers workflow progression itself.

If activation is unavailable, conflicting, invalidated by accepted compaction/restart, or otherwise not proven:

- Justice must not silently bypass Superpowers by treating direct OmO implementation as authorized methodology execution;
- runtime may remain fail-open only where the runtime policy permits;
- affected methodology evidence remains `NOT_PROVEN`;
- TaskAccepted / PlanComplete remain blocked until valid activation evidence exists.

---

## 9. Plan and task semantics

### JUS5-PLAN-01

Current Superpowers plan default path is `docs/superpowers/plans/YYYY-MM-DD-<name>.md`.

### JUS5-PLAN-02

A Design/Spec artifact under `docs/superpowers/specs/` is not by itself proof that `writing-plans` completed.

### JUS5-PLAN-03

Legacy completion heuristics based on headings such as `Architecture` + `Implementation` must not be authoritative.

### JUS5-PLAN-04

Justice must preserve normative task semantics beyond checkbox text, including where present:

- Files;
- Interfaces;
- Consumes / Produces;
- signatures;
- exact values;
- tests/assertions;
- verification;
- Global Constraints.

### JUS5-PLAN-05

Justice must not replace a Superpowers full task brief with a lossy title + checkbox reconstruction.

---

## 10. Authorization and artifact lineage

### JUS5-AUTH-01

Authorization remains plan-scoped and human-controlled.

### JUS5-AUTH-02

Authorization must durably bind the exact approved Requirements → Design → Plan chain, not only the Plan.

The semantic binding must include at least:

- authorization identity;
- artifact-chain identity;
- Requirements identity/path, revision, and fingerprint;
- Design identity/path, revision, and fingerprint;
- Plan identity/path, fingerprint, and canonical snapshot;
- fingerprint/projection schema versions;
- approval time;
- status.

### JUS5-AUTH-03

Checkbox progress-only changes must not invalidate authorization.

### JUS5-AUTH-04

Substantive changes must invalidate authorization, including changes to:

- task scope/title;
- Files;
- Interfaces;
- signatures;
- exact requirements;
- assertions/tests;
- verification;
- Global Constraints;
- normative task body.

### JUS5-AUTH-05

A substantive Design change invalidates downstream Plan authority until the Plan is reconciled and human-approved again.

### JUS5-AUTH-06

AI review, PR creation, or PR merge must not silently substitute for explicit human plan authorization.

### JUS5-AUTH-07

A substantive Requirements change invalidates the bound Design and all downstream Plan authority until:

```text
Requirements reconciliation
→ Design reconciliation
→ Plan reconciliation
→ explicit human approval
→ new artifact-chain authorization
```

### JUS5-AUTH-08

A substantive Design change invalidates the bound Plan and requires Plan reconciliation, explicit human approval, and a new artifact-chain authorization before affected acceptance may resume.

### JUS5-AUTH-09

A Superpowers `Ruling:` may guide workflow execution but does not rewrite Justice authority.

- a non-substantive Ruling may be recorded as execution context without invalidating the chain;
- a Ruling that changes a normative Requirements/Design/Plan obligation may allow Superpowers execution to continue, but Justice acceptance remains blocked;
- substantive Rulings require artifact reconciliation and the human re-approval required by JUS5-AUTH-07/JUS5-AUTH-08;
- a Ruling alone must never convert a `VIOLATED` or `NOT_PROVEN` clause into `SATISFIED`.

---

## 11. Superpowers execution ownership

### JUS5-SDD-01

For SDD, Superpowers owns:

- task selection;
- fresh implementer lifecycle;
- task reviewer dispatch;
- fix round;
- scoped re-review;
- review round policy;
- next-task progression;
- final whole-branch review.

### JUS5-SDD-02

Justice may activate the selected supported Superpowers execution method, then must observe, classify, translate, correlate, verify, and gate its actions rather than duplicate Superpowers progression.

### JUS5-SDD-03

Justice must not duplicate-dispatch task/final reviewers because an implementation completes.

### JUS5-SDD-04

Justice must not add independent parallel task scheduling that overrides Superpowers.

### JUS5-INLINE-01

`executing-plans` must be treated according to its own current contract.

### JUS5-INLINE-02

Justice must not require a per-task fresh reviewer when Superpowers does not require one.

---

## 12. Delegation boundary and execution correlation

### JUS5-TASK-01

The original Superpowers task/reviewer brief remains normative. Justice must not reconstruct or summarize away its semantic content.

### JUS5-TASK-02

Justice may enrich the Native session with tool-mapping, correlation, and conformance metadata, but the actual worker/reviewer dispatch remains a model-issued OmO Native `task` call owned by the active Superpowers workflow.

### JUS5-TASK-03

Justice must not force worker payload fields that seize OmO routing authority, including:

- concrete `model`;
- provider;
- reasoning;
- execution mode;
- retry/fallback chain.

For category-routed Native tasks, the OmO task contract itself rejects explicit `model`; Justice must preserve that ownership boundary.

### JUS5-TASK-04

Justice may translate the routing fields of an **already-issued** recognized Superpowers `task` call when authoritative semantic classification exists. It must never synthesize the worker/reviewer call merely to satisfy its own progression state.

### JUS5-CORR-01 — OmO Native runtime task identity ownership

Justice semantic `TaskIdentity` MUST NOT be encoded into OmO Native's runtime task id.

The Native `task` tool returns runtime task identities such as `st_...` for background children. Those ids and session-local task names are OmO-owned execution identities; Justice may record them only as observed runtime correlation evidence.

### JUS5-CORR-02 — Canonical execution-call key

Justice's primary Native dispatch key is:

```text
parentSessionId + parentToolCallId
```

where `parentSessionId = ctx.sessionManager.getSessionId()` and `parentToolCallId = tool_call.toolCallId` from the Senpi pre-execution `tool_call` event.

For a supported batch, add exact zero-based batchItemIndex to this key and each per-item provenance/correlation record; single-task keys omit it. A pair alone never aliases two fanout items to one child.

Nested tool calls expose `parentToolCallId`; the evidence spike must determine whether Justice supports nested/codemode-issued `task` calls in the initial Native profile. Unsupported nesting remains explicit rather than silently collapsed.

### JUS5-CORR-03 — ExecutionCorrelation binding

The durable execution binding must semantically contain at least:

```text
ExecutionCorrelation
├─ authorizationId
├─ artifactChainId
├─ planIdentity
├─ taskIdentity
├─ executionMethod
├─ parentSessionId
├─ parentToolCallId
├─ omoTaskId?
├─ childSessionId?
├─ dispatchRevision
└─ status
```

The exact way `omoTaskId` and `childSessionId` become observable is a Native evidence-spike result, not an assumed OpenCode SDK contract.

### JUS5-CORR-04 — Correlation lifecycle

The required Native lifecycle is:

```text
Senpi tool_call(task)
  → bind authorized semantic task/review intent to
    (parentSessionId, parentToolCallId)
  → optionally translate routing by mutating the existing input

tool_result(task) and/or audited OmO task lifecycle surface
  → attach observed omoTaskId / childSessionId when proven

child/reviewer context + review result / verification
  → resolve the evidence subject through the durable binding

session_start / restart recovery
  → rebuild from durable Justice state + current OmO observations
```

The evidence spike must prove the exact child-binding surface before Task 6/7 implementation. A correlation failure may remain fail-open for runtime execution but leaves affected evidence `NOT_PROVEN`.

### JUS5-CORR-05 — Continuations

Native continuation/steering is OmO-owned:

```text
task_send(to = <st_... task id or stable task name>)
```

Justice must not rewrite `task_send`, revive children, select execution mode, or turn a runtime task id/name into semantic TaskIdentity. It may associate continuation observations with an existing trusted correlation only when the relation is already proven.

### JUS5-CORR-06 — category / subagent_type boundary

For a new Native child:

- exactly one of `category` or `subagent_type` is required;
- both → invalid;
- neither → invalid;
- `model` is valid only with `subagent_type`; Justice never uses it for category-routed work;
- caller-owned custom category names remain open;
- Justice-generated `sp-*` categories are only semantic routing inputs;
- `task_send` is not a new-child routing call and is outside this XOR translation.

---

## 13. State ownership

### JUS5-STATE-01

`.superpowers/sdd/<plan>/progress.md` is Superpowers-owned workflow state.

### JUS5-STATE-02

`.justice/` is Justice-owned semantic control/evidence state.

### JUS5-STATE-03

Justice must not replace the Superpowers ledger.

### JUS5-STATE-04

A Superpowers “complete” claim is not sufficient proof for Justice acceptance; evidence must still satisfy Justice gates.

---

## 14. Review and provenance

### JUS5-REV-01

Justice must not depend on obsolete reviewer personas such as legacy spec-reviewer/code-quality-reviewer contracts.

### JUS5-REV-02

Justice must distinguish at least:

- task review;
- scoped re-review;
- final review.

### JUS5-REV-03

Current task review semantics must preserve at least:

- Spec Compliance;
- Critical / Important / Minor findings;
- Approved / Needs fixes.

### JUS5-REV-04

Scoped re-review must preserve:

- ADDRESSED;
- NOT ADDRESSED;
- new breakage;
- out-of-scope observations.

### JUS5-REV-05

Review text alone is not authoritative. Trusted evidence requires task/revision/workflow provenance.

For the Native baseline, Task 1 proves the host primitives for the Justice-owned authenticated capability protocol. Task 6 may produce trusted `TaskRoutingProvenance.kind = "superpowers"` only after validating current activation/authorization/session/method, the Justice-minted capability, the private outbound receipt, exact call identity/input digest, and token-free restoration. This provenance is an authenticated protocol-affiliation assertion, not host-independent proof of hidden model causality; review consumers may not replace the protocol with prompt/template/model inference.

### JUS5-REV-06 — Native review detection

Justice must recognize an **existing model-issued OmO Native `task` call** as task-review / scoped-re-review / final-review only when Task 6 has produced the authenticated `TaskRoutingProvenance.kind = "superpowers"` claim for the exact parent session/tool call and the review intent is unambiguous. A method read, active-method state, prompt resemblance, or review-looking text without the valid capability/receipt/exact-call chain remains external or ambiguous and cannot satisfy trusted review or acceptance.

The Native pre-execution authority is Senpi's `tool_call` event:

- `event.toolName === "task"`;
- `event.toolCallId` identifies the parent call;
- `ctx.sessionManager.getSessionId()` identifies the parent session;
- `event.input` may be mutated in place for semantic routing translation;
- ambiguous/model-inferred review-looking execution without recognized Superpowers provenance remains untrusted.

Justice never creates a duplicate reviewer.

### JUS5-REV-07 — Native Conformance Contract delivery

The OpenCode `chat.message + client.session.get` path is not a Native contract.

For trusted review / scoped re-review / final review, Justice validates and strips the capability envelope, then appends the serialized Conformance Contract to that exact existing task prompt at tool_call, before OmO creates the child. Design §14.2 fixes the exact appendix envelope, 65,536-byte limit, strict JSON/digest validation, idempotence, duplicate rejection, mutation failure, and batch behavior. There is no post-spawn pending-appendix delivery queue and no Justice-owned review dispatch.

Task results/state correlate the already-augmented invocation using normalized `parentSessionId + parentToolCallId + omoTaskId → exactly one NativeReviewChildContext`; batch correlation additionally uses batchItemIndex. Physical storage/events may differ by mode. Initial trusted execution/review evidence support is top-level process execution with runner_kind `host-session`, subject to revised Task 1 proving appendix ordering. Capability validation/stripping and pre-spawn prompt augmentation are mode-neutral tool_call operations; observed result/state determines mode before any execution/review evidence is accepted. In-process, detached/PID process runners, and unknown modes may execute the already-mutated call but cannot satisfy trusted execution/review evidence. Nested/codemode calls are not augmented and remain untrusted. Mode uncertainty or unproven prompt mutation/correlation is NOT_PROVEN. Supporting another evidence mode requires artifact reconciliation and its own A–K proof; no pre-spawn runtime-mode API or physical parity is assumed.

### JUS5-REV-08 — Structured review result, current-dispatch finding continuity, and final evidence closure

Trusted semantic review evidence must carry a versioned result containing at least:

- review correlation identity;
- review kind;
- artifact-chain identity;
- task identity where applicable;
- reviewed revision/range;
- quality verdict/findings;
- clause results containing `clauseId`, `SATISFIED | VIOLATED | NOT_PROVEN`, supporting evidence/reference, and a deterministic evidence scope sufficient to decide carry-forward.

#### Finding identity transport

Justice must not infer the current scoped-review target set from all findings present in a preceding review and must not fuzzy-match findings across reviewer dispatches.

The exact human-readable transport marker is:

```text
[[justice-finding:<findingId>]]
```

A Justice v5 `findingId` used by this transport must match:

```text
^jf_[0-9a-f]{16}$
```

For every quality finding produced by a task review, final review, or scoped re-review new-breakage section:

- the human-readable finding line must contain exactly one marker;
- the marker ID must equal the machine-envelope `ReviewFindingV5.findingId`;
- finding IDs must be unique within that review result;
- marker/machine mismatch, missing marker for a machine quality finding, duplicate marker ID, or orphan marker makes the structured review evidence invalid.

This marker is deliberately embedded in the human-readable finding line because Superpowers v6.4.2 carries current open findings **verbatim** into fix dispatches and scoped re-review `Findings Under Verification`.

#### Current scoped-dispatch target authority

For a recognized scoped re-review, Justice extracts `requestedFindingIds` only from exact Justice markers present in that dispatch's `## The Findings Under Verification` section.

The section boundary is:

```text
start: exact heading "## The Findings Under Verification"
end:   next exact heading "## The Fix"
```

Justice must not scan unrelated prompt sections for finding markers.

The extracted list:

- preserves first-appearance order;
- may be empty;
- rejects duplicate IDs;
- rejects malformed Justice marker syntax;
- is the sole authority for which Justice quality findings the current scoped review is expected to verdict.

Consequences:

- deferred Minor findings not present in the current Superpowers open-findings list are not added to `requestedFindingIds`;
- an `ADDRESSED` finding that Superpowers removes from the next round is not reintroduced by Justice;
- a `NOT ADDRESSED` finding remains targetable because its verbatim line retains the same marker;
- new Critical/Important breakage can continue into the next round with the marker generated in the scoped reviewer output;
- a legitimate spec/clause-only scoped re-review may have `requestedFindingIds = []`.

An empty requested set is **not** a finding-context failure. Justice must still inject the structured Conformance Contract appendix so clause re-proof can occur.

#### Trusted metadata and lineage reservation lookup

Justice uses persisted trusted review evidence for two separate purposes:

1. resolve immutable metadata for the IDs selected by the **current Superpowers scoped dispatch**;
2. reserve every finding ID already used in the same trusted review lineage so a new breakage cannot reuse a historical identity.

These concepts are distinct:

```text
expectedFindings
= current scoped dispatch verdict targets only

reservedFindingIds
= all finding IDs already used by trusted evidence
  in the same review lineage
```

The current target set remains controlled only by `requestedFindingIds`; historical reservations must never cause a non-target finding to re-enter `expectedFindings`.

The context query remains:

```text
ReviewFindingContextQuery
├─ artifactChainId
├─ scope: "task" | "final"
├─ precedingReviewedHead
├─ taskIdentity (required when scope = "task")
└─ requestedFindingIds[]
```

For `scope = "task"`, `taskIdentity` is required. Together with
`artifactChainId` and `precedingReviewedHead`, it identifies the task lineage
being queried. For `scope = "final"`, `taskIdentity` is not required; the
final-review lifecycle is selected within the artifact chain.

Lineage boundaries are fixed.

Task scope:

```text
artifactChainId
+
exact TaskIdentity
```

The trusted task lineage is a **single contiguous review chain**, not an unordered set:

1. start from the unique trusted immediate preceding result whose `reviewedRange.head === precedingReviewedHead`;
2. if it is `task-review`, it is the lineage root;
3. if it is `scoped-re-review`, its `reviewedRange.base` must equal the `reviewedRange.head` of exactly one earlier trusted result with the same `artifactChainId + TaskIdentity`;
4. repeat until one trusted `task-review` root is reached;
5. missing predecessor, multiple predecessors, multiple roots, or a cycle makes lineage resolution untrusted/ambiguous.

Only findings on that contiguous chain are reserved.

Final scope:

```text
artifactChainId
+
current final-review lifecycle
```

For the supported Superpowers v6.4.2 one-fix-wave final path, the current scoped-final re-review's unique immediate preceding result must be a trusted `final-review` whose `reviewedRange.head === precedingReviewedHead`. That full final review is the final-lineage root and supplies the historical reserved IDs for the scoped-final parser. A predecessor that is already `scoped-re-review` would imply an unsupported second final re-review and is untrusted.

Finding IDs from unrelated tasks, another artifact chain, or another final-review lifecycle are not globally reserved.

For every trusted result in the selected lineage, Justice builds a historical finding-ID registry. Repeated occurrences of the same ID are valid only when the immutable identity fields are identical:

```text
findingId
severity
summary
location
```

Disposition and evidence references may change across rounds.

If one historical ID maps to conflicting immutable identity fields, context resolution is:

```text
untrusted("historical_finding_id_collision")
```

Justice must not normalize or guess which historical finding owns that ID.

The resolved context contains:

```text
ReviewFindingContextResult.resolved
├─ sourceReviewCorrelationId
├─ expectedFindings[]
└─ reservedFindingIds[]
```

`reservedFindingIds` contains each valid historical lineage ID exactly once.

Then current-target metadata resolution applies:

- `requestedFindingIds = []` → `resolved(expectedFindings = [], reservedFindingIds = <lineage IDs>)`;
- each requested ID must exist exactly once in the trusted immediate preceding review;
- the stored finding must still be compatible with being carried by the current Superpowers open list;
- unknown requested ID → `untrusted`;
- duplicate requested ID → `untrusted`;
- duplicate/ambiguous preceding-review candidate → `ambiguous`;
- missing/untrusted preceding evidence → `not_found` / `untrusted`;
- broken/ambiguous task-lineage predecessor chain or unsupported final-lineage shape → `untrusted` / `ambiguous`.

Justice never uses summary/location/order/severity-only similarity as identity authority.

For task/first-final reviews, `expectedFindings` and `reservedFindingIds` are absent because they are not scoped re-reviews.

For scoped re-review, both are present. `expectedFindings` may be empty; `reservedFindingIds` may also be empty only when the trusted lineage has never produced a quality finding.

#### Scoped reviewer/result contract

The scoped-review appendix must require:

- every expected finding to be returned exactly once with the same `findingId`, severity, summary, and location;
- its human-readable finding verdict line to preserve the exact marker;
- Superpowers `ADDRESSED` semantics → `disposition: resolved`;
- Superpowers `NOT ADDRESSED` semantics → `disposition: open`;
- new breakage to use a fresh `jf_<16 lowercase hex>` ID and the matching marker in its human-readable line;
- new breakage must not reuse any current expected ID or any `reservedFindingIds` ID from the trusted review lineage;
- reviewer output must never create `human_adjudicated`.

When `expectedFindings = []`, no quality finding verdict is required, but the machine result must still contain the required clause results for Conformance Contract re-proof.

Validation remains fail-closed:

- missing expected finding → invalid;
- duplicate expected finding ID → invalid;
- mismatched severity/summary/location or marker for an expected ID → invalid;
- new breakage ID collision with the current expected set or lineage-reserved set → invalid;
- orphan/malformed marker → invalid.

#### Final evidence closure

For Superpowers final-review progression, Justice supports a compositional final evidence closure:

```text
full final-review result for Candidate A
+
zero or one Superpowers final fix-wave scoped re-review for A..B
+
trusted FinalFixDiffEvidence for exact A..B when a fix wave exists
=
trusted FinalReviewEvidenceClosure for candidate A or B
```

Justice must not request or dispatch a second full final review after the Superpowers final fix wave.

When a final fix wave exists, carry-forward authority comes from Justice-controlled deterministic diff evidence for the exact final fix range:

```text
FinalFixDiffEvidence
├─ base
├─ head
└─ changedPaths
```

Required provenance remains:

- `base === fullFinalReview.reviewedRange.head`;
- `head === scopedReReview.reviewedRange.head`;
- `head === candidateHead`;
- the range is a valid ancestor range;
- `changedPaths` is derived from exact `base..head` Git name-status evidence;
- rename/copy includes both old and new paths;
- malformed/unsupported status, unsafe path, Git failure, or non-ancestor range means diff evidence is unavailable.

A `RevisionDiffResult.failed` means:

```text
trusted FinalFixDiffEvidence does not exist
→ trusted FinalReviewEvidenceClosure is not constructed
→ BuildFinalReviewEvidenceClosureResult is BLOCKED
→ PlanComplete remains BLOCKED
```

The blocked build attempt retains exact failure provenance without fabricating trusted diff evidence.

A `SATISFIED` clause from Candidate A may carry forward only when trusted resolved diff evidence proves the exact fix range does not intersect its recorded evidence scope. Otherwise it must be explicitly re-proven or becomes `NOT_PROVEN`.

Final quality findings are merged only after the current scoped-dispatch target IDs have been validated against trusted preceding metadata:

- matching scoped `resolved` clears that original blocker;
- matching scoped `open` remains unresolved;
- an original finding not targeted by the current scoped dispatch is not silently reintroduced into that round;
- new scoped Critical/Important finding becomes an unresolved blocker and receives a stable marker/ID for a later task-fix round when Superpowers carries it forward;
- reviewer evidence cannot manufacture `human_adjudicated`.

### JUS5-REV-09 — Invalid review/final evidence

The following must not satisfy review/conformance gates:

- missing or malformed structured result;
- stale reviewed revision used without a valid final evidence closure;
- wrong artifact chain/task/plan;
- untrusted provenance;
- missing required clause result;
- malformed/duplicate current-dispatch Justice marker;
- human marker ↔ machine finding ID mismatch;
- missing/ambiguous/untrusted metadata lookup for non-empty `requestedFindingIds`;
- unknown requested finding ID;
- requested finding whose trusted stored disposition/severity is incompatible with current open-loop targeting;
- missing, duplicate, conflicting, or metadata-mismatched expected finding;
- new breakage reusing a current expected finding ID or any lineage-reserved historical finding ID;
- historical finding-ID collision within the trusted task/final lineage;
- final evidence whose candidate head, fix range, diff provenance, carried-clause scope, scoped-delta coverage, or finding-disposition merge cannot be proven.

A legitimate `requestedFindingIds = []` / `expectedFindings = []` scoped re-review is not invalid and must still receive the Conformance Contract.

Required missing/uncovered clause results become `NOT_PROVEN`.

A full final review of Candidate A alone can never complete later Candidate B.

A failed diff build does not produce a trusted `FinalReviewEvidenceClosure`; only the `complete` build-result branch may be passed as final completion evidence.

### JUS5-REV-10 — Quality severity and parked findings

Justice v5 canonical quality severity is:

```text
critical | important | minor
```

Legacy Justice `major` may be read only as historical/migration input and normalizes to `important`; it is not the v5 canonical vocabulary.

Gate semantics:

- open `critical` or `important` findings are blocking;
- `minor` findings do not block task progression but must remain visible and be included in final review;
- a Superpowers parked finding or `Ruling:` is not a resolution;
- a parked critical/important finding remains Justice-blocking until a later trusted review explicitly clears/resolves it or an explicit human review-resolution artifact adjudicates it;
- a human quality adjudication cannot satisfy a normative conformance clause that remains `VIOLATED` or `NOT_PROVEN`;
- the final review must explicitly disposition carried minor/parked findings; any finding still critical/important at final completion blocks `PlanComplete`.

### JUS5-REV-11 — Evidence storage capability

Directly observed structured reviewer output, correlated by the trusted execution binding, may be persisted as Justice evidence without requiring Linux-native review-artifact reservation.

When Justice imports or hands off file-based review artifacts, an untrusted/plain-file fallback must never be promoted to trusted evidence merely because secure reservation is unavailable.

Doctor must report the secure review-artifact capability. If a required evidence path depends on unavailable secure storage and no directly observed trusted result exists, acceptance is fail-closed.

---

## 15. Semantic conformance and drift

### JUS5-CONFORM-01

Final completion must have zero unresolved semantic drift between Requirements, Design, Plan, Code, and Tests.

### JUS5-CONFORM-02

Working code and passing tests do not authorize a Plan/Design mismatch.

### JUS5-CONFORM-03

A Plan that contradicts Design is blocking.

### JUS5-CONFORM-04

If implementation discovers that an approved artifact must change, acceptance stops and the authoritative artifact must be reconciled first.

### JUS5-CONFORM-05

Substantive reconciliation follows:

```text
drift detected
→ affected acceptance blocked
→ authoritative artifact updated
→ downstream artifacts reconciled
→ human re-approval where required
→ new fingerprint/authorization
→ resume
```

### JUS5-CONFORM-06

Justice must have task-level conformance gating where the execution method provides the necessary evidence, and a mandatory final cross-artifact conformance gate for every supported execution method.

### JUS5-CONFORM-07

Required normative clauses must end as:

- SATISFIED;
- VIOLATED;
- NOT_PROVEN.

`VIOLATED` and `NOT_PROVEN` both block acceptance for required clauses.

### JUS5-CONFORM-08

Final Conformance must cover at least:

- Requirements ↔ Design;
- Design ↔ Plan;
- Plan ↔ Code;
- Design ↔ Code;
- Plan ↔ Tests;
- Requirements ↔ Verification;
- reviewed revision ↔ completion candidate revision.

### JUS5-CONFORM-09

A final review of an older revision is not proof for a newer candidate tree.

### JUS5-PROJ-01 — Canonical normative sources

Normative Clause Projection must use deterministic source identities.

**Requirements:** every `JUS5-*` requirement block is canonical. A block's prose obligation is clause suffix `/0`; each ordered bullet/list item that states an independent obligation receives deterministic suffix `/1`, `/2`, ... within that source revision. Source revision/fingerprint is part of evidence identity, so a changed list invalidates prior clause evidence.

**Design:** the canonical design source is the explicit normative Design Contract Registry (`INV-*` plus `J5D-*` IDs). Free prose is explanatory unless incorporated by a registered contract.

**Plan:** projection must deterministically enumerate the current Superpowers v6 plan's normative structural units, including at least:

- Goal;
- Architecture;
- Tech Stack constraints;
- Global Constraints;
- each Task's Files;
- Interfaces / Consumes / Produces;
- exact signatures;
- exact values;
- test assertions;
- expected verification results.

The Plan's `Spec` reference identifies the bound Design artifact rather than creating a duplicate normative clause.

### JUS5-PROJ-02 — Projection completeness state

Every Conformance Contract has:

```text
projectionStatus =
  COMPLETE
  | INCOMPLETE
  | INVALID
```

Only `COMPLETE` contracts may contribute to acceptance.

At minimum, the following are fail-closed:

- duplicate clause IDs;
- missing required source artifact;
- ambiguous source anchor;
- unsupported or structurally ambiguous Plan format;
- parser/projection failure;
- source fingerprint/revision mismatch;
- a normative structural unit that cannot be mapped to exactly one canonical clause identity.

### JUS5-PROJ-03 — Projection schema version

The projection schema/version must be durable and included in the approved artifact chain, Conformance Contract, and resulting clause evidence. Evidence produced under an incompatible projection schema must not satisfy current acceptance.

---

## 16. Quality

### JUS5-QUALITY-01

Quality and conformance are separate gate dimensions.

### JUS5-QUALITY-02

High-quality code that violates approved artifacts must be blocked.

### JUS5-QUALITY-03

Conformant code with unresolved blocking quality findings must also be blocked.

---

## 17. Acceptance

### JUS5-ACC-01

Worker success alone must not create TaskAccepted.

### JUS5-ACC-02

SDD TaskAccepted requires:

- valid authorization;
- matching task execution;
- required verification;
- required review lifecycle;
- no unresolved blocking findings;
- all required conformance clauses SATISFIED.

### JUS5-ACC-03

Round-cap/deferred findings must not be disguised as clean review.

### JUS5-ACC-04

Inline execution must use execution-method-specific gates rather than an SDD-only reviewer requirement.

### JUS5-COMPLETE-01

PlanComplete requires:

- all required task acceptance conditions;
- required final review;
- final conformance;
- final quality gates;
- zero unresolved/unauthorized semantic drift;
- zero missing required evidence.

---

## 18. Dependency ownership

### JUS5-DEP-01

Justice-specific `(depends: task-N)` syntax is not a current Superpowers scheduling authority.

### JUS5-DEP-02

Superpowers owns execution order.

### JUS5-DEP-03

If DependencyAnalyzer remains, it is advisory/diagnostic/correlation-only.

---

## 19. Runtime failures

### JUS5-ERR-01

Justice must not compete with OmO retry/fallback orchestration.

### JUS5-ERR-02

Justice classifies terminal runtime failure for evidence/diagnostic impact.

### JUS5-ERR-03

Any retained provider-error patterns must be resynchronized to the current OmO v5 model-core baseline.

---

## 20. Doctor

### JUS5-DOC-01

`justice doctor` must diagnose at least:

- OmO Native version and Senpi engine/API version where observable;
- Native extension registration and active session identity;
- `task` / `task_send` capability and task XOR contract compatibility;
- `tool_call` mutable-input + `toolCallId` observation capability;
- exact capability validation/stripping, pre-spawn prompt augmentation, and normalized supported-mode child/reviewer binding established by revised Task 1;
- Superpowers Pi package/bootstrap/skill availability where observable;
- Native methodology-activation evidence capability;
- configured `sp-*` custom categories and current built-in category vocabulary;
- effective `omo.json[c]` source layers and `[native]` resolution;
- secure review-evidence/storage capability;
- secondary OpenCode adapter status separately, if installed.

### JUS5-DOC-02

Configured, applied, observed, and inferred state must not be conflated.

### JUS5-DOC-03

Exact OmO/Senpi patch mismatch alone must not define unsupported status. Missing required capabilities or an unproven Native evidence contract does.

### JUS5-DOC-04

Unknown authority must be reported as unknown/unverified rather than guessed. In particular, Justice must never infer child/reviewer binding, Superpowers activation, or runtime retry/fallback state from names alone.

---

## 21. Recovery

### JUS5-REC-01

After compaction/restart/continuation Justice must recover:

- active authorization;
- artifact lineage;
- plan/task identity;
- review correlation;
- acceptance state.

### JUS5-REC-02

Justice must not cause already completed Superpowers tasks to be re-dispatched.

### JUS5-REC-03

Justice/Superpowers state conflict must be surfaced, not silently overwritten.

### JUS5-PERSIST-01 — v5 state schema

Every v5 authoritative persistent record must carry or be governed by an explicit v5-compatible schema version. The exact file split is an implementation detail.

The migration reader explicitly recognizes the current v4 families as **prior** contracts, including:

- plan authorization with `fingerprintSchema: justice-plan-v1`;
- persisted Observation/Decision envelopes with `schemaVersion: 1`, including v4 review-dispatch/task-lifecycle/finalization records;
- `ReviewSnapshotArtifact` with `schemaVersion: 1`;
- legacy `human_approved` review-resolution artifacts, which lack v5 artifact-chain/clause identity.

Recognition means “safe to classify/migrate or retain historically”, not “authorized for v5 acceptance”.

### JUS5-PERSIST-02 — v4 authorization

A v4 plan-only authorization must not be automatically promoted to a v5 Requirements→Design→Plan artifact-chain authorization. Human reconciliation/re-approval is required before it can authorize v5 acceptance.

### JUS5-PERSIST-03 — v4 review state

v4 Justice-owned review-dispatch/scheduling records are historical only. They must not schedule v5 reviews and must not satisfy v5 review or conformance gates.

### JUS5-PERSIST-04 — v4 observations/evidence

v4 raw observations may be retained/imported as historical or untrusted input, but evidence lacking v5 artifact-chain, correlation, projection-schema, and clause identities must not satisfy v5 acceptance.

### JUS5-PERSIST-05 — migration failure / unknown schema

Unknown, newer, malformed, or unsuccessfully migrated authoritative state must:

- remain preserved rather than silently overwritten or downgraded;
- produce an explicit diagnostic;
- leave affected v5 acceptance fail-closed;
- never fabricate missing Requirements/Design lineage.

Runtime execution may remain fail-open when safe.

---

## 22. justice_review

### JUS5-REVIEW-01

`justice_review` is a control-plane inspection interface.

It must explain:

- current authorization state;
- task acceptance state;
- missing evidence;
- unresolved drift;
- blocking findings;
- authoritative artifact/revision;
- whether human re-approval is required.

It must not act as a hidden duplicate review scheduler.

---

## 23. Required acceptance scenarios

Justice v5 is acceptable only if E2E evidence proves at least:

1. checkbox-only Plan updates preserve authorization.
2. substantive Plan contract changes invalidate authorization.
3. substantive Design changes invalidate downstream Plan authority.
4. SDD review is observed without duplicate Justice reviewer dispatch.
5. Needs fixes → fix → scoped re-review can reach acceptance.
6. NOT ADDRESSED remains blocking.
7. executing-plans is not rejected solely for lacking per-task fresh reviewer.
8. Plan/Code interface mismatch blocks task acceptance.
9. Design/Plan mismatch blocks downstream authorization.
10. implementation-discovered design change requires artifact reconciliation before resume.
11. passing tests cannot override approved-contract drift.
12. omitted required conformance proof becomes NOT_PROVEN and blocks.
13. review of stale revision cannot authorize current completion candidate.
14. custom sp-* categories coexist with OmO v5.
15. canonical `deep` is not emitted.
16. Justice does not directly choose model/provider.
17. capability-compatible OmO Native/Senpi patch is not rejected solely for version mismatch.
18. compaction/restart preserves durable historical correlation but always invalidates live activation/capability and requires a fresh current-session method read.
19. final completion has zero unresolved/unauthorized semantic drift.
20. final completion has zero missing required evidence and zero blocking quality findings.
21. ambiguous or model-inferred review executor provenance cannot satisfy trusted review evidence.
22. review evidence bound to an older or mutated artifact/revision cannot authorize the current candidate.
23. clean review evidence cannot create implementation authorization without the required explicit human approval for the exact artifact chain.
24. remediation/re-review may produce fresh evidence, but Justice must not become the owner of Superpowers fix/re-review progression or OmO runtime retry/fallback.
