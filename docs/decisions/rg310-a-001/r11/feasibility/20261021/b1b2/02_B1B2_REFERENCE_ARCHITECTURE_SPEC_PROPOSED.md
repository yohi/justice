# B1/B2 Reference Architecture — Proposed, falsifiable contract

**Class:** DESIGN_PROPOSAL · no prototype built · no DB tested · no deployment verified.

## 1. Proposed authority edges
```text
[untrusted Senpi/OmO actor, shell/exec/native/child] --scope-limited request--> [independent Broker]
           | private stage only                                | validates signed grant, fresh revoke/time
           | OS denies direct protected FS/DB/Git/CI/network   v
           +------------------------------------------- [transactional PostgreSQL 18 authority]
                                                                | accepted+bytes+head+seq in ONE commit
[all R11 authoritative consumers]  <----- [Gateway] <-------------+
        (never authoritative raw Git/worktree/JSONL/CI artifact)

[independent human/key custodian] --> signed scope/grant verification by Broker
[independent revoke/time authority] --> ordered revoke events + bounded fresh-time proof
[OS root/DB superuser/CI repo admin] --> EXPLICIT trusted computing base; cannot be assumed adversarially contained
[upstream Senpi/OmO host A1 H0] --> EXTERNAL OPEN, NOT established by Broker
```

## 2. Technical separation checklist
- Actor and any descendant execute as a restricted principal, no reusable Broker issuer keys, DB creds, CI token, Git write creds, writable accepted-root mount, protected FD, raw network egress or host/container escape privileges. Disable direct effects via effective OS/container security, not merely Senpi's six-tool policy. Native, child, shell, exec, Git hooks, package lifecycle and OS root are explicitly reviewed.
- Broker runs under distinct OS/service identity with a narrow DB transaction role. Separate issuer/clock/revocation identities cannot be changed or impersonated by untrusted actor. Privileged administrator trust is explicit, not erased by documentation.
- The only semantic accepted publication/read authority is Gateway and single DB committed head. Staged/derived file copies are non-authoritative and consumers MUST fail closed if Gateway unavailable.
- B1 completeness is conditional until all source, consumer, CI, admin, network, backup, replica and recovery paths are inventoried. This document does not assert an exhaustive universe.

## 3. Candidate DB data model (illustrative logical entities; NOT executed SQL)
| Logical table | Critical fields / constraints |
|---|---|
| `Authority` | `scope_id` unique; `head_digest`; `head_seq` transactional bigint; `revoke_epoch`; `leader_term`; one lockable row per scope |
| `Content` | `digest` primary key; exact immutable bytes or transactional DB-owned chunks; full length and canonical digest; write once by controlled DB role |
| `Operation` | `(scope_id, op_id)` unique, original attempt identity from verified origin, signed grant digest, actor, phase, before/after root, accepted seq, exact immutable outcome, grant and epoch bindings |
| `Reservation` | unique per `op_id`, PREPARED with private stage handle, protected reservation event and attempt index; PENDING/IN_DOUBT cannot disappear |
| `Revocation` | issuer proof, independent source event ID unique, effective epoch and order, scoped principal/scope; ordered with `Authority` update |
| `Event` | transactional row-based event sequence and immutable ACCEPTED/ABORTED tombstones; no `nextval()` for gap-free accepted event history |

`PREPARED` event history and accepted commit history may have separate counters; the formal gap-free **phase-close** predicate must precisely specify how reservation ID and every terminal accepted/aborted record reconcile. Never silently drop abandoned reservations or conflate `accepted head_seq` with raw attempts.

## 4. Prospective `OP_PREPARE_ALLOWED` (never grants published write)
1. Verify externally signed immutable authorization baseline / HSA; bind actor, phase, opId, scope, exact preRoot, allowed method/path/command, negative effects, expiry and version. A1 H0 genuine origin must be established if required by phase; do NOT synthesize it from a returned result.
2. Get fresh independent issuer/revocation proof and bounded time attestation. If clock uncertainty could cross expiry by final COMMIT, deny or require a new short grant; PostgreSQL transaction-start `now()` is not an attested commit-time proof.
3. Authenticate current Gateway head and authorized writer term. Deny direct actor writes, mounts, FDs, network, Git/CI publication or admin rights.
4. Persist independent `OP_PREPARED` reservation **before any staging effects**. Only then open private stage with no authoritative or remote effects.
5. Missing guarantee -> `UNKNOWN/BLOCKED+STOP`; positive unauthorized effect -> `REVOKED+STOP` under the proposed R11 distinction.

## 5. Retrospective `OP_COMMIT_ACCEPTED` linearization
Illustrative specification, *not runnable SQL or authorization*:
```text
validate private staged contents, changed path/hunk/mode/symlink, full afterRoot and absence of forbidden effects
BEGIN SERIALIZABLE (on the single primary, correctly durable)
  lock Authority(scope) and relevant operation/reservation/epoch fence
  if existing Operation(opId): compare original payload/grant/scope; return exact committed outcome OR reject conflict
  ensure correct beforeHead, leaderTerm, no competing writer, fresh issuer/revocation epoch and conservatively bounded grant validity
  ensure verification still binds to measured immutable staged bytes; fail closed if remeasurement race
  insert / validate digest-addressed complete authoritative bytes in this same transaction
  atomically insert immutable accepted record and head/seq (+1 using guarded row counter), update Authority root and operation outcome
  update any accepted proof and relevant ordered event references in same transaction
COMMIT
  on definite durable success, ACK immutable accepted outcome; all authoritative readers see current committed Gateway snapshot
  on timeout, network loss or ambiguous COMMIT, DO NOT reapply; query same opId from current fenced leader, else IN_DOUBT STOP
```
**Pre-COMMIT time check subtlety:** a check before a potentially prolonged commit cannot guarantee an expiry-valid real linearization instant without a well-defined time/lease model. Design must choose conservative deadline margin and a way to prevent COMMIT after the bound (e.g. fail-closed gate-controlled transaction deadline/serialization of lease validity) and submit proof; until then time acceptance remains OPEN.

Handle SQLSTATE `40001` by retrying the **entire transaction** after fresh signed scope, stage, epoch and head revalidation, never by replaying an old admission proof. A fixed unique `(scope_id,op_id)` prevents duplicate commit publication but not non-DB external effects; the latter are forbidden during stage/commit or require a separate protocol.

## 6. Authoritative `READ_CURRENT`
- Gateway starts a new authoritative DB read with a **fresh** head snapshot (not a long-lived transaction begun before an ACK), fetches the matching content and accepted operation proof from a consistent committed DB snapshot, recomputes digest, returns `(scope,head_seq,head_digest,bytes,accepted_proof,leader_term)` together.
- No app/runner/CI/publisher treats raw worktree, JSONL, DB replica, copied artifact, CDN, Git ref or unverified file materialization as equivalent authority. If a consumer needs a filesystem materialization, it must verify exact digest+seq against Gateway under a defined freshness contract before acting; a writable shared worktree is not a linearizable head.
- Cache/replay and replica reads after ACK must be shown not to regress head; for first cut, prohibit authoritative replicas/caches. Direct DB reads by actors and normal consumer credentials denied.

## 7. Crash, revocation, recovery and replication boundaries
- `PREPARED` + crash before staging: preserve and resolve by independent proof of no authoritative effects; on uncertainty `IN_DOUBT STOP`.
- Crash during staging: isolate orphan stage; no acceptance until independent remeasurement and new authorization; tombstone when proven no effects.
- Crash before COMMIT: DB rollback leaves old bytes/head/seq; evidence MAY remain PREPARED, never inferred accepted.
- Crash after committed COMMIT but before ACK: query durable idempotency result; never blindly retry side effects.
- Concurrent writers: one authority row fence, transaction serialization, full re-validation. Concurrent revocation: same DB ordering and externally authenticated revocation publication, deny if uncertainty.
- Backup restore / split primary / failover: cannot acknowledge or resume until the accepted prefix, term, and non-rollback invariants are proven. **Initial proposal is single-primary and no automated failover**; downtime is preferred over false authority. PostgreSQL WAL policy/config proof is future implementation evidence.
- Separate `.jsonl`, `rename`, Git HEAD or independent append-only ledger may be audit/derived views only; it is never itself authoritative accepted publication in this reference pattern.

## 8. Non-negotiable external blockers
1. A1 `RG310-FEAS-001` — exact immutable H0/attempt origin and G1/G2 negative cases remain `EXTERNAL_OPEN`.
2. R11 38-row §04 normative transition matrix / INV-A01..A14 compatibility must be independently reconciled; copying this design into R/D/P is not adoption.
3. Task1 actual runtime stale read/late sanitation, separate canonical32 and B-001/B-002 remain unchanged and blocked as previously reported.
4. Technical state is `CONCEPTUALLY_PLAUSIBLE ONLY`; no proof for configured actor isolation, terminal effects, patch version, issuer/clock, host integration or consumer census.
