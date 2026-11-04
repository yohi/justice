# Justice S1-a canonical positive fixture

Expected Manifest SHA-256 (exact UTF-8 file bytes):

`4f86d903ad28e243c62957ab967bee66ba48182f985d7987bc746a73e9c877fe`

This is an example pinned digest for deterministic tests, **not** proof of Human Owner authentication. Invoke only in an authorized test environment:

```sh
justice-s1a check --manifest tests/fixtures/justice-s1a/manifest.json --manifest-sha256 4f86d903ad28e243c62957ab967bee66ba48182f985d7987bc746a73e9c877fe --intent tests/fixtures/justice-s1a/task-intent.json --artifacts-root tests/fixtures/justice-s1a
```

Expected identity `MATCH`, `ownerAuthorityStatus=NOT_PROVEN`, `eligibleBaseline=false`.
