# RG310 R11 — FEAS A/B investigation provenance (2026-10-15 JST)

**Status: TECHNICAL INPUT ONLY — NOT_ADOPTED / NOT_AUTHORIZED.** This folder is a follow-on evidence-index for the independent static feasibility investigations; it is not a Design/Plan amendment or implementation authorization.

## Related frozen source references

- R11 candidate archival PR: [#325](https://github.com/yohi/justice/pull/325) at original commit `74cac6f61946a30583e61e4004ae6f66a0abdd76`.
- Native evidence spike PR: [#295](https://github.com/yohi/justice/pull/295) at evidence HEAD `c428041dfb5779b6b6dc8db7bf14928225a00373`.
- Approved pre-revision R/D/P commit: `8a2e4f1536e9cad499ee7e9d996ff163df132fd4`.
- Fixed Senpi: `d56e6a260d9468418a39bc9120945cf98e06b840`; OmO: `091728d274f20d62504b0b5e1edbc3970671dd8b`.

## Submitted standalone source archives and independently checked identities

| Archive | SHA-256 | CRC | Internal SHA256SUMS | GitHub bytes status |
|---|---|---|---|---|
| `Justice_RG310_FEAS001_A_Independent_Result_20261014(1).zip` | `11496294bff7f558b1fe21810edd62f67a59107371a624335a8e136abdb5979f` | PASS | 31/31 MATCH | [ARCHIVED](archives/Justice_RG310_FEAS001_A_Independent_Result_20261014(1).zip) (blob `d4928023753b71354342ed50821846a425e0d109`) |
| `Justice_RG310_R11_Independent_Infra_Storage_Security_Investigation_B_20261014(1).zip` | `8906f74ad02add9625ef93b57494b0c83fa64f3e190fa80ff0aa86599bba65ec` | PASS | 12/12 MATCH | [ARCHIVED](archives/Justice_RG310_R11_Independent_Infra_Storage_Security_Investigation_B_20261014(1).zip) (blob `612362fed8aeb32fb4f5735773a653cbdb520358`) |

Both submitted original ZIP archives are now stored as Git blobs under `archives/`, with returned Git blob SHA-1 IDs matching independent Git blob SHA-1 values computed from the original local bytes. The original ZIPs' SHA-256 identities and their CRC/internal manifests are unchanged. These archives are technical evidence only and confer no approval or execution authorization.

## Committed evidence

- [INTEGRATED_A_B_COORDINATOR_ASSESSMENT.md](INTEGRATED_A_B_COORDINATOR_ASSESSMENT.md) — coordination analysis, not independent formal verification or human architecture decision.

## Findings and gating

- FEAS-001 H0 producer identity: `NOT_PROVEN`, exhaustive fixed-pin source graph still incomplete.
- FEAS-004 preappend/postappend synthetic-result identity: `OPEN`.
- FEAS-005 Case A five follow-ups: `BLOCKED`.
- FEAS-002 complete actor-external mediation: `NOT_VERIFIED`.
- FEAS-003 accepted-record + published-bytes one-transaction gateway: `NOT_VERIFIED`.
- FEAS-006 independent authority, signer, revocation, storage, clock: `NOT_VERIFIED`.

Keep PRs #295/#325 **OPEN and Draft**. R11 `UNAPPROVED`; R'/D'/P' `NOT_ADOPTED`; Task1 `BLOCKED` (31/32, Case A BLOCKED, Case B PROVEN). Formal independent Gate `NOT_ESTABLISHED`. `NO HOST RUN`; B0/B1/B2 and Tasks2–14 `NOT_AUTHORIZED`.

## Next independent work

1. **A1:** bounded remaining Senpi/OmO private/RPC/host-producer source closure and Option C minimal upstream API contract if fixed pin stays unproven.
2. **B1/B2:** versioned deployed-environment principal/effect/reader/writer/credential inventory and concrete gateway storage transaction/reader visibility design; report unknowns instead of inventing deployments.
3. Distinct independent technical review, then actual human Architecture Decision and Owner-led normative Requirements→Design→Plan process **before** any implementation/run.

The original result archives are committed as content-addressed Git blobs. The source SHA-256 hashes above identify the original exact bytes, and GitHub's returned blob IDs match independent locally calculated Git blob hashes. Keep all formal Gate, HSA, Design/Plan adoption, and execution STOP restrictions unchanged.
