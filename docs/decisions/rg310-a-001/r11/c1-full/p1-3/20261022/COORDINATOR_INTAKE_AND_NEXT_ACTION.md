# C1-FULL P1.3 — Independent semantic static investigation intake

**Evidence date:** 2026-10-22 JST  
**Classification:** INDEPENDENT_STATIC_EVIDENCE / NOT_AN_APPROVAL / NO_EXECUTION_GRANT  
**Overall:** TRACKED_TREE_VERIFIED / SEMANTIC_SOURCE_PARTIAL / EFFECT_CLOSURE_NOT_VERIFIED / U07_STRUCTURAL_CONFLICT / INTERFACE_FREEZE_STOP.

## Submitted original (independently measured in coordinator sandbox)

- Submitted file: `Justice_RG310_C1_FULL_P1_3_Independent_Semantic_Static_Result_20261022(1).zip`
- Measured outer ZIP SHA-256: `a17c108d917bbc7312e2abb0d09f83fa53e004927be6d07eecfc1af5cf71c1a0`.
- Size: **58,687 bytes**; expected Git blob SHA-1 if archived byte-for-byte: `0b07cc0b393e37d63193a088e564f11fa1b3640c`.
- Outer ZIP CRC PASS; SHA256SUMS 6/6 and MANIFEST 6/6 PASS, checked against exact original entry bytes.
- ZIP contains 6 original technical deliverables, SHA256SUMS, MANIFEST.
- **ORIGINAL ZIP IS NOT IN THIS GITHUB COMMIT.** This index cannot be used as evidence of GitHub byte preservation until the original binary ZIP blob is uploaded and independently fetched at the expected SHA. Do not mark GitHub original archive complete on the strength of this index.

## Intake summary (source-defined only)

1. Fixed Justice commit `c428041dfb5779b6b6dc8db7bf14928225a00373` root tree `2c1e8bd2f57cdc4eb47cf6a07b5934704c1b18f4`, tracked total 431 entries = 386 blobs + 45 trees. P1.3 independently reconfirmed full tracked tree enumeration.
2. Prior P1.2 path-only population **341**; P1.3 fixed-ref full-body SHA matched **134**; **207** still not fetched in P1.3. All fixed `src/` blobs reportedly read **113/113**, but this is still static source-symbol investigation, not a complete import/transitive dynamic dependency closure.
3. Existing 95 P1.2 consumer/effect rows preserved on their original columns; append-only `N-68` through `N-80` yields **108 total**. Source-defined effect graph **32** edges; not runtime observed.
4. `justice_status` is not strictly read-only if projection cache materialization writes via `StateProjectionCache.write`; doctor child spawn/import, filesystem writer and native-loader paths are also identified as positive *source paths*, not runtime attestations.
5. Materiality: `U-07 = STRUCTURAL_CONFLICT`. If strict C1-FULL claims universal **retroactive** producer-only enforcement on non-cooperating historical offline third-party copies, it is structurally unsatisfiable under the current trust assumptions. A publisher-owned private Gateway cannot reach independent historical binaries or arbitrary offline forked third-party hosts. This is distinct from prospective signed distribution to cooperative custodians.
6. **No silent C2 narrowing.** C1-FULL is only an Owner directional preference and DS-02 remains formally PENDING. The static investigator's options A/B/C/D are UNSIGNED alternatives, not an Owner decision.

## Workstream gate and required next decisions

- P2 Reference Monitor / actor isolation; P3 durable acceptance / commit-time / revocation / signature and recovery; P4 source-to-build-to-publish-to-actual-use bytes may each prepare **conditional hypothetical designs**, but all three are barred from FINAL INTERFACE FREEZE / implementation under current evidence.
- Do not turn U-07 into a request to inspect only the remaining 207 Git blobs: third-party retrospective universal enforcement cannot be proven by local source enumeration alone.
- Scope-specific independent technical adjudication is needed: define external platform/host trust roots and the admissible prospective/historical boundary; only a separate Owner normative decision can change strict U-07 semantics.
- Separately prioritize risk-relevant unread test/fixture/build config and transitive import/effect traces. Source enumeration alone cannot certify runtime complete mediation.
- A1 host-origin/H0/G1-G2 and unknown synthetic `messageId=null` remain unproven. Task1 canonical **31/32**, Case A BLOCKED, unknown-tool BLOCKED, Case B PROVEN.
- Historical parent original SHA `735d9f0ce2b97d2b1543fb6a7a5d9a839b2ada30cb5a41e732f1115725d30160` remains NOT_VERIFIED; no retrospective claim from nested summaries.
- Existing **22 Findings OPEN**, **37 counterexamples NOT_EXECUTED**; R11 UNAPPROVED, R'/D'/P' NOT_ADOPTED, DS-01..06 PENDING, no B0/B1/B2/HOST authorization; Tasks2-14 NOT_AUTHORIZED.

## Required archive follow-up

Archive the independently measured exact original ZIP to this PR, then re-fetch binary/base64 and verify SHA-256 `a17c108...`, Git blob SHA-1 `0b07cc0...`, CRC and entry SHA256SUMS. Preserve the submitted six reports unaltered in the ZIP and avoid editing the existing normative files.

**PR #295 and #325 must remain OPEN/Draft.** No code, CI, host, Design/Plan, secret, or signed approval mutation was authorized by the investigation.
