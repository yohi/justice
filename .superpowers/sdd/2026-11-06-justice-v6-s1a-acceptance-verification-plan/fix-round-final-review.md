# Final Whole-Branch Review Fix Report

## Changes made

- `tests/core/s1a/loader.test.ts`: extended both cumulative-byte-limit fixtures to six selected refs. Four 8 MiB buffers precede the limit-triggering artifact; the sixth ref has a matching zero-byte digest. Assertions prove five reads only and confirm both refs left unresolved by the stop have `UNKNOWN` outcomes and null observed digests.
- `tests/runtime/s1a-cli.test.ts`: added `ac-3` to the Manifest and intent in both byte-limit scenarios. The over-budget fifth item is `ac-2`; assertions verify the sixth selected ref remains `UNKNOWN` with a null observed digest and that `ac-3.md` is never read. The mismatch scenario additionally retains `design-1` as `MISMATCH` and records the three preceding 8 MiB refs as `MATCH`.
- `tests/node/s1a.test.mjs`: added `ac-3` to the fixture and intent, updated the normal selected-reference count, and asserted that both N-LIM-02 limit cases retain the sixth ref as unread (`UNKNOWN`, null observed digest). The over-limit cases assert five artifact reads and no read of `ac-3.md`.
- `s1a-acceptance-evidence.md`: split N-04 into scope/kind observed passes and uncollected parent-link coverage; reclassified N-07 because no test covers an `approved: true` Manifest claim; split N-08 by manifest identifier/schema safety versus selected-path read safety; strengthened N-09 citations; and documented the outstanding N-07/N-04c, race/FIFO, and environmental limitations.

## Verification

All commands ran in the requested worktree at the fixed HEAD `7bb647559142118b18823435d86b6563fe4e7396`.

| Command | Result |
|---|---|
| `GIT_MASTER=1 git diff --stat` | Exit 0; confirmed the evidence report and all three required test files were modified before this report was added. |
| `bun run vitest run tests/core/s1a tests/runtime/s1a-cli.test.ts` | Exit 0; 5 test files, 35 passed, 0 failed. |
| `bun run vitest run --config vitest.integration.config.ts tests/real-fs/s1a-read-only-fs.test.ts` | Exit 0; 1 test file, 2 passed, 0 failed. |
| `bun run build` | Exit 0; TypeScript build and bundle completed (`379 modules`). |
| `node --test tests/node/s1a.test.mjs` | Exit 0; 21 passed, 0 failed. |
| `bun run typecheck` | Exit 0; `tsc --noEmit` completed without diagnostics. |

No production source files were changed. The specified starting HEAD was kept fixed throughout editing and verification; the requested commit then advanced the branch tip to `c509f7909745e6c8c0392128c82da056275faf11`. Existing unrelated untracked worktree files were left untouched.
