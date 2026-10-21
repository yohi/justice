# A1 Option C — minimum upstream API and maintainer inquiry (DRAFT ONLY)

**Status:** `DESIGN_PROPOSAL / NOT_IMPLEMENTED / NOT_ADOPTED / NOT_SENT`  
**Date:** 2026-10-15 JST. Senpi `d56e6a260d9468418a39bc9120945cf98e06b840`, OmO `091728d274f20d62504b0b5e1edbc3970671dd8b`, Superpowers `8ca22dba9a94f28898bbce59f2537ff4d87c747d` fixed pins.

## 1. Why this remains only a conditional candidate

Current-pin supported total read origin is `H0=NOT_PROVEN`, but *universal structural impossibility is not established*. Before proposing a patch, upstream owners should first answer whether an existing supported immutable producer identity / preappend message intent exists in a compiled public artifact. If a verified supported route closes all graph leaves, Option C may be unnecessary. These interfaces are deliberately prospective TypeScript sketches, **not** code to add or a declaration that any package ships them.

## 2. Minimum host trust-owned source contract (proposal)

```ts
// PROPOSED ONLY — no symbols in current fixed-pin public ABI are asserted.
type HostReadAttemptId = string & { readonly __hostMinted: unique symbol };
type HostMessageIntentId = string & { readonly __hostMintedIntent: unique symbol };
type ProducerEvidence = Readonly<{
  version: 1;
  sessionId: string;                  // canonical durable session id
  sessionIncarnation: string;         // new for each resume/recreation
  processGeneration: string;          // host-specific non-reusable generation
  producerAttemptId: HostReadAttemptId;
  readStartSeq: bigint;               // host monotonic at trusted start
  toolCallId: string;                 // MAY collide across attempts
  method: 'read' | string;            // canonical tool/method
  producerType: 'model'|'provider'|'nested'|'synthetic'|'rpc'|'host';
  parentProducerAttemptId?: HostReadAttemptId;
  methodTargetDigest: string;         // canonical normalized operation parameters
}>; // Not accepted from an actor-supplied payload.

type HostReadStarted = Readonly<{
  type: 'read_started';
  evidence: ProducerEvidence;
  admissionDecision: 'admitted'|'denied';
}>;  // Emitted/authorized by host BEFORE I/O effect.

type HostReadTerminal = Readonly<{
  type: 'read_terminal';
  producerAttemptId: HostReadAttemptId;
  terminal: 'success'|'error'|'cancel'|'aborted'|'rejected'|'no_delivery';
  hostTerminalSeq: bigint;
  resultDigest?: string;
  messageIntentId: HostMessageIntentId;
}>; // All paths including provider/nested/synthetic.

type CanonicalAppendReceipt = Readonly<{
  producerAttemptId: HostReadAttemptId;
  messageIntentId: HostMessageIntentId;
  entryId: string;
  canonicalSessionId: string;
  canonicalJsonlRecordDigest: string;
  appendOrder: bigint;
  persisted: boolean;
}>; // Host binds intent BEFORE enqueue; append cannot overwrite it.

interface TrustedHostReadEvidencePort {
  // Available only to independent reference monitor or authenticated local IPC,
  // NOT a writable ExtensionAPI payload property.
  subscribeStrict(handler: (evt: HostReadStarted | HostReadTerminal) => Promise<void>): void;
  resolveAppendReceipt(intent: HostMessageIntentId): Promise<CanonicalAppendReceipt | 'refused'>;
  assertNoDelivery(attempt: HostReadAttemptId): Promise<
    { signedByHost: true; finalHostSequence: bigint; reason: 'cancel'|'abort'|'host_loss' }
  >;
}
```

This sketch is insufficient without concrete authenticated transport, session/run lifecycle, host-side monotonicity and crash semantics. `string & brand` is only a type annotation; the host must retain authority over generation, identity minting and attestation; actor extensions cannot create or edit these fields. An event replay MUST NOT substitute for host-authenticated no-delivery evidence. `processGeneration` and `sessionIncarnation` must never alias on restart/restore. A read result terminal can occur after cancellation; the monitor must discriminate `arrived_and_rejected` from `never_delivered`.

## 3. Minimal integration delta by boundary

| Boundary | Required smallest behavioral delta (proposal) | Required observation |
|---|---|---|
| before read effect | Host-origin `read_started` minted at trusted pre-effect ingress; monitor acknowledges allowed/denied | Zero I/O before authorization, including rejects |
| ordinary read | Terminal evidence for success, tool error, validation refusal, truncation and abort | Exact start-terminal attempt join |
| provider exec bridge | Capture provider handler identities *before* wire read/result; route all `onToolResult`/synthetic variants through monitor | No bypass from `providerToolResults` direct emissions |
| nested | Every nested `executeTool` has host-minted child attempt parent pointer | No ambiguity from `parent/n` ID |
| RPC/host/process | Host generation/incarnation pinned across child host sessions and raw frames | G1 cannot adopt G2 signal/identity |
| synthetic preappend | Allocate immutable host `messageIntentId` when result is formed, including unknown/invalid | Non-null ID at sanitizer, linked to entry_appended/JSONL |
| all user-visible output | Independent sanitizer handles assistant/toolResult/provider/synthetic/replayed content before visibility | Retired token never leaked or persisted |
| callback errors | Mandatory monitor fail-closed; hook exception cannot silently bypass | No effect/result published on monitor failure |
| evidence transport | Authenticated local protocol with replay and refusal semantics; no trust in actor payload | Attested host sequence / no delivery |
| public ABI | Versioned compiled package export plus exact source/lock/artifact digest | Independent consumer can import verified API |
| storage/authority B | Independent B1 monitor, B2 atomic accept+content+head+reader transaction | No side effect bypass; no torn accepted evidence |

**No implementation instructed.** Host events by themselves do not solve B1/B2. For truly irreversible effects, B must prohibit the effect at pre-effect boundary or scope it out of acceptable operation; an audit log after the side effect cannot retract it.

## 4. G1/G2 and synthetic acceptance rules (future only)

- G1 and G2 using same `toolCallId` MUST have unique host-origin `producerAttemptId`, distinct applicable generation/incarnation and monotonic readStartSeq. Reuse or client-crafted origin aborts admission.
- A G1 late **delivered** success after G2 start is refused with a recorded host-origin terminal and zero authority/receipt/effect. An un-delivered G1 promise or a lost link is a distinct `no_delivery` outcome and must not be labeled positive stale-result rejection.
- Both model-provider bridges and native/OmO nested results go through the same before-effect and before-publish monitor, with all failures, cancellations, and synthetic errors bound to an intent.
- Preappend `messageIntentId` non-null must match `entry_appended` persisted `entryId` and canonical JSONL digest exactly. A caller-supplied RPC `entry.id` does not satisfy producer ownership.
- After provider-stream failure, independently observe the original five Case A predicates: cached activation rejected, pre-failure read result rejected (actual arrival), fresh read reauthorized, late assistant sanitized, late toolResult sanitized. Keep canonical 32 and Case B unchanged.
- Negative tests (fake epoch/identity, duplicate callId, runtime restart, hook exception, nested redirection, two providers, unknown-tool null ID, late provider result) MUST fail closed. Positive tests require genuine host-produced events/receipts and atomic B reader proof. **These are future proof requirements, not tests performed here.**

## 5. Draft to upstream maintainers — UNSENT

> Subject: Technical inquiry (DRAFT) — immutable read attempt origin and preappend synthetic message identity at pinned Senpi 2026.10.8
>
> We are evaluating an independent, actor-external reference monitor for Justice RG-310-A-001, strictly against Senpi commit `d56e6a260d9468418a39bc9120945cf98e06b840` and OmO `091728d274f20d62504b0b5e1edbc3970671dd8b`. This is a *request for source/API clarification*, not an issue posted, approved feature, or implementation instruction.
>
> We found private original-run AbortSignal guards in `cursor-exec-bridge-session.ts` and `Agent.emitExternalEvent`, but the public extension event surface carries toolCallId without an authenticated generation/producer attempt. The provider `onToolResult` buffer bypasses normal `tool_result` hooks; nested tools have parent/n identities; host synthetic unknown/invalid results lack a confirmed non-null preappend intent link to canonical entry/JSONL.
>
> **Questions:** (1) Is there already a supported, compiled/exported, host-verifiable read start and terminal identity for every ordinary/provider/nested/host/RPC/synthetic path? Please identify fixed file/line, package export and integrity-pinned distribution artifact. (2) Does an immutable preappend host message intent exist for a synthetic result and correlate to `entry_appended` and canonical JSONL? (3) How can independent monitoring reject an *actually delivered* old success after abort/restart, not just observe its non-delivery? (4) How is mandatory pre-effect interception protected against extension hook exceptions and actor-owned/fabricated provenance? (5) If unsupported, could maintainers review the minimum proposed `HostReadStarted`, `HostReadTerminal`, `CanonicalAppendReceipt` source-and-ABI contract, including versioning and all ingress enumeration? (6) Can OmO owner identify every host/process/in-process forwarded read/result/retained replay edge and a trustworthy generation binding?
>
> A response referencing an existing supported implementation would be preferred to inventing new code. We will not run hosts, change packages, create issues or infer maintainer approval from this draft. Independent security/storage validation and authorized human decisions remain separately required.

## 6. Responsibility and decision boundaries

A1 investigator may perform further **read-only** source/ABI comparison. Senpi/OmO maintainers may answer the draft if an authorized human chooses to send it; no query has been sent. A technical verifier separate from the proposal author should check any new pin. B1/B2 owners must prove deployed isolation and atomic publication; an authorized Requirements Owner/Gate separately decides R11 and implementation phase. Any adoption or implementation remains `NOT_AUTHORIZED` until its legitimate process completes.
