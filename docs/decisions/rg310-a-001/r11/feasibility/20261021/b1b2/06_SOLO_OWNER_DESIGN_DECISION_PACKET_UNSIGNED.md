# Solo Owner — Architecture Decision Inputs (UNSIGNED)

**Existing decisions recognized:** prior B1/B2 static report accepted; read-only acquisition authorized; individual project development; on 2026-10-15 owner stated **R11 is design-stage**, so deployment-specific proof collection for the R11 Broker/Gateway stops.

**Decisions NOT yet made by user:** exact storage engine/version, whether PostgreSQL single DB is adopted, whether new authoritative namespace replaces Git/worktree, whether HA scope is required, whether R11 Option B R'/D'/P' is formally adopted, or any B0/host execution grant. No signature, identity assertion or automatic grant is generated.

## Proposed one-person decisions after technical review
| Decision ID | Proposed owner disposition (not yet selected) | Consequence / fallback |
|---|---|---|
| DS-01 | Prefer PostgreSQL 18 single DB + independent Gateway for B2 | If unsuitable, reopen SQLite or CAS with exact new proof obligations |
| DS-02 | Define **only Gateway DB snapshot** as R11 accepted publication; raw worktree/CI/Git are candidate or derived | If actual consumers cannot be moved to Gateway, STOP and redesign authoritative namespace |
| DS-03 | Start with one primary, no authoritative replicas/automatic HA | For HA, separate failover/ACK prefix and replica proof before activating |
| DS-04 | Solo owner controls governance, but untrusted actor cannot access Broker signer/revoke/time admin creds | If OS-root/CI/database trusted boundary unavailable, STOP or narrow the claimed security contract |
| DS-05 | Keep A1 H0 producer authenticity and final Task1 runtime evidence as non-waivable dependencies | If upstream host cannot produce source authenticity, escalate R11 Option C, not self-generate receipts |
| DS-06 | Require fresh independent architecture review before drafting normative amendments or B0 grant | If REVISION_REQUIRED, revise proposal without claiming Gate pass |

## Next operator: who does what
1. **Now:** architecture author (this session) packages this unsigned design and independent review handoff; no implementation.
2. **Next:** separate ChatGPT reviewer or independent AI agent does static falsification of B1/B2 design (not human formal authority).
3. **After review:** same solo human project owner may accept/select technical architecture and adopt *exact* Requirements/Design/Plan changes, while preserving explicit technical security constraints and phase boundaries.
4. **Only after normative adoption and separately scoped stage authorization:** implementation agent may take up a specifically approved B0 slice; host execution still separately forbidden until exact R11 gates.

**Current operational state**: R11 UNAPPROVED, Task1 BLOCKED, OP_PREPARE UNKNOWN/BLOCKED, B0/B1/B2/HOST NO HOST RUN, formal Gate NOT_ESTABLISHED.
