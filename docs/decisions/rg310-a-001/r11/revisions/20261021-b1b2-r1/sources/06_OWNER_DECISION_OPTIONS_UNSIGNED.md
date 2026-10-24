# RG-310-A-001 R11 — DS-01..06 Owner Architecture Decision Options (UNSIGNED)

**NO DECISION OR SIGNATURE RECORDED.** Decision owner is a human; this artifact is proposal-side input. Draft source R11 and current approved R/D/P have not been changed. For every DS item: `OWNER_DECISION=PENDING`, `FORMAL_GATE=NOT_ESTABLISHED`, `HSA=NOT_ISSUED`, `IMPLEMENTATION=NOT_AUTHORIZED`.

## Decision overview

| ID | Pending question | Option A | Option B / exit | Risk that cannot be undone by DB rollback | Remaining unproved obligation | Proposed default for *design investigation only* |
|---|---|---|---|---|---|---|
| DS-01 | Storage / atomic acceptance domain | PostgreSQL 18 single physical primary, DB-owned bytes + head + receipt/seq | Independently verifiable single-domain transactional authority service; S3 CAS+DB only after retention/GC/version proof; SQLite single-host separately reviewed | Cross-domain accepted record false claim, resurrected history | Trusted time/receipt, exact DB rollback/ACK/fence, independent proof | CONDITIONAL_C1_ONLY; adopt neither |
| DS-02 | Meaning of authoritative accepted source | Fully redesign CI, builder, Git tag, npm publisher, package/host loader so R11 authority is Gateway-verified accepted source | Explicitly split ordinary product Git release from R11 non-public acceptance; no claim of R11 authority over existing release | Published package cannot be un-published transactionally; authentic consumer may run unaccepted JS | Complete legitimate consumer/effect graph, exact digest at use, migration compatibility | BLOCKED_FOR_ADOPTION / consumer cutover design required |
| DS-03 | Primary, backup, reads, failure | No auto-HA, no primary replica CURRENT reads, external monotonic ACK-prefix witness, physical term fence, quarantine restore | Choose another single custody domain with synchronous recovery proof; deny recovery or accept downtime | Acknowledged accepted prefix lost; split authority | Old-primary physical write impossibility; WAL replay/ACK high-water reconstructed | FIRST CUT FAIL-STOP ONLY |
| DS-04 | Trusted computing base and proof roots | Explicit trusted admin/OS/CI/Gateway/signers/revoke/time custodians; actor unprivileged OS egress and FD denied | Do not run untrusted actor if platform cannot enforce; move to independently isolated runner | Agent with inherited root/FD/token publishes irreversible change | Actual named principals and process tree, clock/revocation lease, external proof atomicity | SCOPE PRINCIPLE ONLY; BLOCKED operationally |
| DS-05 | A1 and independent Task1 blockers | Keep H0/G1/G2/unknown-tool and CaseA as hard external STOP; ask upstream independently if required | Revisit host integration in separate architecture Option C inquiry; remain NO HOST | Host side effect happened without authentic start and immutable origin | Genuine Senpi fixed ABI proof, Case A arrival and token sanitation; B-001/002 | RETAIN BLOCKED; no waiver |
| DS-06 | Normative and review progression | Commission further STATIC design investigation, independent technical re-review, then separate R'→D'→P' delta proposal | Reject C1 now; re-scope program before any adoption; alternatively stop project phase | Unauthorized HSA or phase changes start irreversible operations | Independent redline review, Owner choices, formal Gate and separate execution grants | STATIC_REDESIGN_THEN_FRESH_REVIEW |

## DS-01 — Storage and externally verifiable accepted proof

The *internal DB transaction* can make committed rows/content/root/receipt bytes indivisible. It cannot simultaneously commit an independent signer/receipt, physical Git ref, npm publish or external signed ACK. **Choose explicitly** (A) a single independently verifiable custody domain that intrinsically binds receipt+bytes, or (B) an R11 **normative change** to two-threshold `DB_COMMITTED_INTERNAL → EXTERNALLY_SEALED_VISIBLE` with no intermediate reader/ACK and certified orphan recovery. Under existing R11 wording, neither is automatically approved as equivalent. If the strict requirement remains and no single-domain system is feasible, reject DB-only candidate rather than waive it.

## DS-02 — Existing legitimate consumers are decisive

A direct `npm publish` from a release tag is a concrete structurally permitted bypass; package consumers are legitimate, and remote publication cannot be rolled back by the accepted DB COMMIT. Option A requires a release-policy cutover where registry publish tokens are not reachable from unaccepted jobs, an independent effect provider binds exact package bytes and accepted manifest/EAF and the published package identity is recorded as a **separate** terminal effect. Option B declares ordinary public package Git lifecycle formally **independent** of R11 B2 acceptance and prohibits reusing its success as R11 evidence. Without a scoped decision, acceptance authority remains ambiguous and STOP is mandatory.

## DS-03 — Acknowledge/restore nonrollback

Never equate `headSeq` in a restored DB with an independent ACK high-water. Owner can prefer intentional downtime over availability. Recovery must prove exact acknowledged prefix, physical old-primary fencing, new monotonic term and no stale reader before authorizing any new source operation. If witness missing, the data cannot be confidently reconstructed; a rollback of an acknowledged commit is not acceptable.

## DS-04 — Independent issuers and irreversible admin powers

Separation means a compromised/untrusted implementation actor cannot obtain or change authoritative signer keys, clock/revoke source, DB writer role, publication token, physical primary, running config, OS root, CI credential, native executable or independent witness. A solo Owner is not required to appoint another human, but multiple trusted software/process domains and auditable privileged principals remain necessary. If host root or CI publishing token is exposed to actor, the security proof fails. Some external SaaS provider controls remain part of the TCB, not denied by app policy.

## DS-05 — External A1 and Task1 are neither storage decisions nor waivable

Fixed Senpi H0 capability `NOT_PROVEN`; G1/G2 source issuance and actual delivered old success unknown; `messageId` negative controls and Case A unchanged. Task1 actual `31/32`, Case A BLOCKED, Case B PROVEN, unknown-tool BLOCKED; B-001 and B-002 remain separate. Any grant design cannot infer origin from a DB opId or from an OpenCode `callID` collision. NO HOST RUN.

## DS-06 — Decision order, not a project-approval memo

1. Preserve this R1 and immutable hashes; independent static review must try to falsify C1 and may require architectural exit.
2. If and only if a coherent candidate survives, a human Owner may decide precise DS choices; then prepare *candidate* R'/D'/P' redlines in Requirements→Design→Plan order and request fresh independent normative review.
3. Only after a distinct formal decision (none recorded here) and phase-specific human grant can future separately authorized work start; no implied B0/B1/DEP/PREP/HOST capability. Never mix R11 Option B authorization with storage candidate B.

### Unsigned decision ledger

| DS ID | selection | signer | signedAt | approval evidence | result |
|---|---|---|---|---|---|
| DS-01 | PENDING | NONE | NONE | NONE | NOT_ADOPTED |
| DS-02 | PENDING | NONE | NONE | NONE | NOT_ADOPTED |
| DS-03 | PENDING | NONE | NONE | NONE | NOT_ADOPTED |
| DS-04 | PENDING | NONE | NONE | NONE | NOT_ADOPTED |
| DS-05 | PENDING | NONE | NONE | NONE | NOT_ADOPTED |
| DS-06 | PENDING | NONE | NONE | NONE | NOT_ADOPTED |
