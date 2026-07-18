# PR #156 Review Feedback Fixes

## Scope

Address the two unresolved review findings from PR #156 without changing the
review-resolution contract or Git classification behavior.

## Design

- `normalizeIdentifiers` rejects empty input, identifiers longer than the
  existing per-identifier limit, invalid identifiers, duplicate normalized
  identifiers, and arrays containing more than 256 identifiers.
- `findGitSubcommandIndex` delegates detection of global options that consume a
  following value or embed that value in the same token to a small helper. The
  helper preserves the existing handling for `-C`, `-c`, and the supported long
  options.

## Tests

- Add boundary tests for 256 accepted item keys and 257 rejected item keys.
- Keep the existing duplicate-normalization test.
- Preserve the existing Git classification matrix, including
  `git --no-optional-locks diff`.

## Error Behavior

Invalid or oversized review-resolution input continues to return
`undefined` from normalization and is handled by the existing generic error
path. No new exception or fallback behavior is introduced.
