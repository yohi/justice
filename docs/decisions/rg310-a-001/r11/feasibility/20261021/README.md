# RG-310 R11 — A1 / B1-B2 follow-up proposal archive

**Archive recorded:** 2026-10-21 JST. **Source document dates:** 2026-10-15 JST.

**Status: EVIDENCE/PROPOSAL PRESERVATION ONLY — NOT_ADOPTED / NO HOST RUN / NO IMPLEMENTATION AUTHORIZATION.**

This folder archives seven user-supplied original text files, **byte-for-byte** (including the UTF-8 BOM/CRLF in the two CSVs). The SHA-256 identities listed below were computed on the supplied original bytes; each Git blob SHA-1 was independently matched before this archive commit.

## A1: upstream API clarification (unsent)

- [A1 Option C minimal upstream inquiry — DRAFT](a1/04_A1_Option_C_Minimal_Upstream_Inquiry_DRAFT.md) — SHA-256 `79fea27a43abacd8094e4cf4701e6c0868763b97e8bc3e95eb98b01b88542fec`; Git blob `990d1ad81135fa9976236fea777ff8b96160cce7`.

The current fixed-pin H0 producer-origin guarantee is NOT_PROVEN; total structural impossibility has not been demonstrated. This inquiry is a proposed API contract and **has NOT been sent** to the Senpi/OmO maintainers. Host-minted attempt/intent and complete pre-effect ingress remain design obligations.

## B1/B2: single transactional authority candidate (unsigned)

| Original artifact | SHA-256 |
|---|---|
| [01 — Architecture decision candidate (UNSIGNED)](b1b2/01_B1B2_ARCHITECTURE_DECISION_PROPOSAL_UNSIGNED.md) | `0be7bb313ddca8232574a243c6a2df9b7f2cad7e14ab03be4237ea52c9620547` |
| [02 — Reference architecture specification (PROPOSED)](b1b2/02_B1B2_REFERENCE_ARCHITECTURE_SPEC_PROPOSED.md) | `1b0cbd8c468195db80019cf516429a85756d51f089adab479743aeba6c305909` |
| [03 — Finding-to-design traceability](b1b2/03_FINDING_TO_DESIGN_TRACEABILITY.csv) | `dda48d48134794d2babf9c787f0bbae49c497da5d334da6f9872269ca95a820c` |
| [04 — Static falsification/future test plan](b1b2/04_STATIC_FALSIFICATION_AND_FUTURE_TEST_PLAN.csv) | `3fca940de673d28ba90c3d85c6d8522d468886d50b41501cff84755f412dd5eb` |
| [05 — Fresh independent architecture review handoff](b1b2/05_FRESH_INDEPENDENT_ARCHITECTURE_REVIEW_HANDOFF.md) | `369f3855f26a172bff55b931e437df88a156758ec8fd871cf4c335817d3fd098` |
| [06 — Solo-owner decision packet (UNSIGNED)](b1b2/06_SOLO_OWNER_DESIGN_DECISION_PACKET_UNSIGNED.md) | `dc5a24b066d25c7f46768defe4ab227a424beb74f3bea0f8106457e0fce6509b` |

**Status:** `RECOMMENDED_FOR_INDEPENDENT_REVIEW` / `NOT_ADOPTED`. The PostgreSQL 18 single-primary DB + independent Broker/Gateway proposal is **one storage/reference-monitor design candidate**, not adoption of R11 Option B's separate staged authorization governance.

**Core open design boundary:** PostgreSQL COMMIT cannot atomically publish a Git ref, ordinary filesystem tree, JSONL, CI artifacts or external package registry. The proposal redefines the *authoritative* namespace as one DB-committed head and mandates that every accepted reader use Gateway; **whether this agrees with Justice's actual legitimate build/host consumers remains unverified**. Find counterexamples rather than silently relabeling ordinary working files as non-authoritative.

**Technical debt, not closure:** finding-to-design register 14/14 `OPEN_NOT_CLOSED`, future counterexample tests 28/28 `SPEC_ONLY_NOT_EXECUTED`, no deployed Broker/Gateway, no PostgreSQL execution/config proof, no fresh independent B1/B2 review yet. Source A1 H0, PR #295 Task1 31/32 and Case A, formal independence, normative R'/D'/P' adoption remain blocked/unestablished.

## Next actions / authority boundaries

1. Assign B1/B2 design to a **new independent technical architecture reviewer**, using document 05. Check legitimate Git/worktree/CI/source consumers, atomic publication/time/sequence/revocation and R11 38-row consistency. No execution or writes.
2. Separately complete A1 fixed-pin source/ABI reachability; **human chooses whether to send** upstream inquiry. No maintainer contact is implied by archival.
3. Integrate independent findings; only then request a specific human DS-01–DS-06 architecture decision and the formal Requirements → Design → Plan review/approval chain.
4. Keep [PR #295](https://github.com/yohi/justice/pull/295) and [PR #325](https://github.com/yohi/justice/pull/325) Draft/OPEN. This archive grants no B0/B1/B2/HOST execution authority and changes no normative Design/Plan or production source.

Original text files were provided separately, not as an independently SHA-pinned result ZIP. Thus this index certifies **each of the seven supplied files**, not a non-existent original outer ZIP or an independent human signature.
