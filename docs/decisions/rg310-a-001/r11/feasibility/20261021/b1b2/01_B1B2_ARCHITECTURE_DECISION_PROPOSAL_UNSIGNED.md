# Architecture Decision Candidate: Single Transactional DB + Independent Gateway

**Decision status: RECOMMENDED_FOR_INDEPENDENT_REVIEW, NOT_ADOPTED.** Date: 2026-10-15 JST. Author role: design synthesizer, *not* independent acceptance reviewer or owner signer.

## 1. Context and decision axis
The owner has confirmed the proposed R11 Broker/Gateway is **not yet deployed**. Existing active DB/OS/credential evidence is therefore not a gate to making a conceptual architectural selection. A later deployment verification gate remains mandatory before claiming any runtime property.

R11's **Option B — Explicit Staged Authorization** is a separate unapproved revision of the Requirements/Design/Plan authorization flow; it is NOT the storage alternative named B in the earlier technical comparison. This document proposes a **B1/B2 storage/reference-monitor implementation pattern** as a possible dependency if R11 Option B is later adopted by the owner after normative review.

## 2. Proposed preference, not a project approval
**Prefer storage candidate A: one PostgreSQL 18 authority domain + actor-external Broker + Gateway.** Place the accepted operation, exact authoritative bytes, immutable byte digest, scope head/root, accepted sequence, idempotency outcome, revocation epoch and writer-fence term in a single DB atomic commit. All authoritative readers go through Gateway; read in a consistent current committed snapshot. A separately controlled signer and clock/revocation source furnish proofs to the Broker; a solo project owner may administer the system, but the untrusted actor cannot impersonate these authorities.

**Why:** one atomic durability domain and one authoritative reader path removes the independent S3-version-retention/GC and DB-CAS cross-resource proof obligations of storage candidate B. PostgreSQL Serializable and transactional row updates offer primitives for this *if and only if* implementation obeys the contract. PostgreSQL native sequences are not transactional; use a guarded row counter. See official PostgreSQL 18 links in `07_...`.

## 3. Choice boundary: source repository vs published authority (OPEN)
The accepted root must be explicitly identified. **A database transaction does not atomically mutate Git refs, a visible filesystem worktree, CI artifacts or package registries.** Those remain **untrusted staging/derived outputs** unless a separately specified and independently verified Gateway mediates each real authoritative reader/writer. If ordinary Justice processes and subsequent build/host operations directly consume Git/JSONL/worktree as the accepted source, **this candidate fails complete mediation until those consumers are redesigned or formally excluded from the claim**. No silent relabeling of Git as a mere cache is allowed.

Potential narrowed contract: the published R11 authoritative namespace is exclusively the Gateway-accepted content snapshot; private working tree and Git commits are candidate inputs only; authorized consumers materialize exact accepted digest/seq through the Gateway and are prohibited from treating raw worktree/CI output as accepted authority. This is a **proposed contract**, not shown by source or deployment evidence.

## 4. Alternatives and conditional rejection
| Storage alternative | Design-stage disposition | Reason / unproven issue |
|---|---|---|
| A PostgreSQL 18 DB + Gateway | **First preference for technical review** | Can couple bytes/accepted/head/seq in one COMMIT; still requires strong actor confinement, freshness, time, recovery, reader census |
| B S3 CAS + PostgreSQL manifest + Gateway | **Fallback** only if content sizes/throughput compel external CAS | Manifest transaction alone insufficient without immutable exact versionId retention and all readers following manifest; broader operational proof |
| C SQLite 3.x + Gateway | **Unselected exploration** for rigorously single-host, no automatic failover scope | One-node transactional option, but specific SQLite patch/VFS/fsync/process locking model and recoverability not pinned |
| D FS rename + independent ledger | **Reject as authoritative B2** | Two distinct writes expose accepted-only or bytes-only state across a crash |

This is a recommendation based on minimizing proof obligations, **not a claim that PostgreSQL is the only implementation**.

## 5. Scope and non-goals
- Non-goal: seamless change of live Git master, CI artifact or local JSONL atomically with a PostgreSQL COMMIT.
- Non-goal: proving fully malicious OS root/DB superuser controls via application RBAC; privileged administrators belong to explicit trusted computing base with governance/audit.
- Non-goal: claiming HA, replica read consistency or seamless regional failover for an initial single-primary prototype. On suspected divergence or leader ambiguity: STOP.
- Non-goal: treating A1 source H0/attempt-origin as solved by an authenticated DB writer. **A1 remains EXTERNAL_OPEN**.
- Non-goal: replacing Task1 runtime proofs, Case A, canonical32 or final product readiness.

## 6. Review before implementation
Independent architecture review MUST establish: (i) feasible authoritative namespace and complete reader/writer mediation, (ii) a sound transactional protocol and crash consistency, (iii) issuer, clock and revocation freshness model, (iv) explicit failover/backup and privileged admin trust limits, (v) compatibility with the exact R11 §04 38-case transition matrix and approved baseline, (vi) unchanged A1, Task1 and Gate status.

**Decision record:** `RECOMMENDED_FOR_INDEPENDENT_REVIEW` only. Human project owner has not specifically selected PostgreSQL via this conversation.
