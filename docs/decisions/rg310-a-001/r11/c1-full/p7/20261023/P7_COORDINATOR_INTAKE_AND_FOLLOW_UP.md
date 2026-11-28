# RG-310-A-001 — P7 independent limited read-only evidence intake

Date: 2026-10-23 (JST)
State: STATIC_EVIDENCE_ONLY / NOT_A_DESIGN_ADOPTION / NOT_AN_EXECUTION_GRANT

## Original evidence and independent checks

- Original submitted P7 result ZIP: `archives/Justice_RG310_C1_FULL_P7_Independent_Limited_Read_Only_Evidence_Result_20261023.zip`.
- Exact byte size: 30,071. SHA-256: `15159e65bb32c68cfbd5dd051e37630a817613315fcee93f97631839b0edc056`.
- Git blob SHA-1: `8ed0b25d278f1f66e9642674e7ef2d69bf0b8843` (original binary, not re-packed).
- Outer ZIP CRC PASS; result SHA256SUMS 8/8 PASS; result MANIFEST 8/8 PASS; 28 falsifier rows and 19 fail-closed states.
- Original P7 intake handoff: SHA-256 `45bd2a4faef714eb097d8681b5763812edf54e879ade9343a0f8fa70fd1b86f3` byte verified. The independent P7 reviewer reported this as PENDING_EXPECTED_HASH because the review session lacked a separately provided expected hash; the earlier coordinator had separately recorded this exact expected value. Do not rewrite the P7 reviewer's historic status.
- Independently recursed the P7 handoff: 14/14 ZIP CRC PASS, declared nested SHA256SUMS 111/111 PASS, declared MANIFEST SHA entries 103/103 PASS. Historical parent SHA `735d9f0ce2b97d2b1543fb6a7a5d9a839b2ada30cb5a41e732f1115725d30160` original not supplied and NOT_VERIFIED.
- Input SHA/CRC validates bytes only; independent source identity, Owner authorization, runtime state and proof remain separate.

## Technical adjudication — no authority promotions

Overall: `LIMITED_COMPARATIVE_EVIDENCE_SUPPORTED / POSITIVE_ADOPTION_NOT_READY`.
- Architecture A (literal strict R11 single ACCEPT+PUBLISH and issuer-effective revoke): NO_GO for observed split issuer/DB/signer/SCM/remote/Host architecture. Not a claim of universal impossibility in all theoretical implementations.
- Architecture B (committed-unsealed, independently sealed, separate authorized external effects): conditional research-only candidate. A staged design would make MATERIAL R' normative changes, not merely pass existing R11 `OP_COMMIT_ACCEPTED`.
- Revocation issue-to-fence blackout, independently bounded durable COMMIT time, all-channel first-writer mediation, signer refusal, missing ACK / independent high-water rollback, old-primary physical fencing, remote outcome unknown, and actual loaded JS/native bytes require new static contracts and future separately authorized runtime proof.
- U-07 universal retroactive coercion of noncooperating offline copies is an ADDITIONAL ASSUMPTION, not the approved v5 fail-closed acceptance obligation; do not quietly change C1-FULL to C2.
- 22 original Findings OPEN; 37 NC NOT_EXECUTED; P5-F01..F08 not formally closed; P6-N01..N06 observational (not signed findings); H0–H3 NOT_PROVEN.
- Task1 31/32; Case A and unknown-tool BLOCKED, Case B PROVEN; R11 UNAPPROVED; R'/D'/P' NOT_ADOPTED; Tasks 2–14 NOT_AUTHORIZED.
- P2/P3/P4 interface/schema freeze STOP; B0/B1/B2/HOST no new authority; no GitHub runtime, CI, cloud, OS, DB, Host tests or secrets were acquired by P7.

## Owner decision provenance and next actions

The previous P5 DS-01/03/04/05/06 prompts are NEW proposed agendas, not independently recovered historic signed decisions; they remain `HISTORICAL_OWNER_ORIGINAL_NOT_VERIFIED`. DS-02 C1-FULL choice is a *research preference*, not a formal signature or A/B adoption. All DS-01..06 FORMAL_PENDING.

Most useful bounded READ-ONLY follow-up: (1) authenticated old human Owner records if present; (2) GitHub first protected writer/bypass actor/ruleset/credential *metadata*, excluding actual tokens/secrets; (3) issuer/DB/signer/COMMIT-time API contracts and bounded clock witness; (4) provider readback/immutability and Host loader custody classes. Separate known impossible cross-domain atomicity assumptions from missing account configuration and provider capabilities. Return UNKNOWN when evidence is inaccessible.

Do not start implementation, authorize host or approve R'/D'/P' from this record. Before a positive Owner A/B decision, require a separate authenticated decision plus independent R'→D'→P' and future permitted proofs.
