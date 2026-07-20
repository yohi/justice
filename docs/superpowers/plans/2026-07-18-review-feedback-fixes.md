# PR #156 Review Feedback Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the two unresolved PR #156 findings while preserving existing review-resolution and Git classification behavior.

**Architecture:** Keep validation in `review-resolution-artifact.ts` and extract only the Git option-shape predicate from `findGitSubcommandIndex`. Add focused boundary and regression tests without changing public interfaces.

**Tech Stack:** TypeScript, Bun, Vitest, ESLint, TypeScript compiler.

## Global Constraints

- Preserve fail-open behavior and existing `undefined` normalization failure semantics.
- Preserve immutable return values and existing identifier validation rules.
- Do not add dependencies or change public types.
- Keep `src/hooks/` free of business logic.

---

### Task 1: Bound Review Resolution Item Keys

**Files:**
- Modify: `src/core/review-resolution-artifact.ts:3,54-67`
- Test: `tests/core/review-resolution-artifact.test.ts`

**Interfaces:**
- Consumes: `normalizeReviewResolutionArtifact(value: ReviewResolutionArtifactFields)`.
- Produces: The same return type and `undefined` rejection behavior, with a maximum of 256 normalized `itemKeys`.

- [ ] **Step 1: Write failing boundary tests**

Append tests that verify exactly 256 identifiers are accepted and 257 are rejected:

```ts
it("accepts the maximum number of item keys", () => {
  const result = normalizeReviewResolutionArtifact({
    reviewScope: "task-6.3",
    itemKeys: Array.from({ length: 256 }, (_, index) => `major:item-${index}`),
    artifactRef: "docs/reviews/task-6.3.md",
  });

  expect(result?.itemKeys).toHaveLength(256);
});

it("rejects more than the maximum number of item keys", () => {
  const result = normalizeReviewResolutionArtifact({
    reviewScope: "task-6.3",
    itemKeys: Array.from({ length: 257 }, (_, index) => `major:item-${index}`),
    artifactRef: "docs/reviews/task-6.3.md",
  });

  expect(result).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused test and verify the new test fails**

Run: `bun test tests/core/review-resolution-artifact.test.ts`

Expected: the existing duplicate test passes, the 256-item test passes, and the 257-item test fails because the current implementation accepts it.

- [ ] **Step 3: Add the count limit without changing existing validation**

Add the constant beside the existing identifier limit and update the first guard in `normalizeIdentifiers`:

```ts
const MAX_REVIEW_RESOLUTION_ITEM_KEYS = 256;

function normalizeIdentifiers(values: readonly string[]): readonly string[] | undefined {
  if (values.length === 0 || values.length > MAX_REVIEW_RESOLUTION_ITEM_KEYS) return undefined;
```

Keep the existing `Set` duplicate check and frozen return unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `bun test tests/core/review-resolution-artifact.test.ts`

Expected: all focused tests pass.

### Task 2: Reduce Git Subcommand Parser Complexity

**Files:**
- Modify: `src/core/v2/tool-output-classifier.ts:136-164`
- Test: `tests/core/v2/tool-output-classifier.test.ts`

**Interfaces:**
- Consumes: Git token arrays passed to `findGitSubcommandIndex`.
- Produces: Identical subcommand indexes and identical `classifyToolOutputClass` results.

- [ ] **Step 1: Add a regression assertion for inline value-bearing options**

Extend the existing Git classification case table with a command that exercises an inline `-C` value and a long `--git-dir=` value before `diff`:

```ts
{
  command: "git -Cworktree --git-dir=.git diff",
  expected: "file_content",
},
```

- [ ] **Step 2: Run the focused classifier test before refactoring**

Run: `bun test tests/core/v2/tool-output-classifier.test.ts`

Expected: the existing suite passes, establishing behavior before extraction.

- [ ] **Step 3: Extract the value-bearing option predicate**

Add a helper immediately before `findGitSubcommandIndex`:

```ts
function isInlineGitGlobalOption(argument: string): boolean {
  return (
    (argument.startsWith("-C") && argument.length > 2) ||
    (argument.startsWith("-c") && argument.length > 2) ||
    (argument.startsWith("--git-dir=") && argument.length > "--git-dir=".length) ||
    (argument.startsWith("--work-tree=") && argument.length > "--work-tree=".length) ||
    (argument.startsWith("--namespace=") && argument.length > "--namespace=".length) ||
    (argument.startsWith("--super-prefix=") && argument.length > "--super-prefix=".length) ||
    (argument.startsWith("--config-env=") && argument.length > "--config-env=".length)
  );
}
```

Replace the compound inline condition in `findGitSubcommandIndex` with:

```ts
if (isInlineGitGlobalOption(argument)) {
  index++;
  continue;
}
```

Do not alter the separate `GIT_GLOBAL_OPTION_WITH_VALUE_PATTERN` branch, since it consumes the following token and has different behavior.

- [ ] **Step 4: Run the focused classifier test and verify it passes**

Run: `bun test tests/core/v2/tool-output-classifier.test.ts`

Expected: all Git and shell classification tests pass, including `git --no-optional-locks diff`.

### Task 3: Run Project Verification

**Files:**
- No source changes.

- [ ] **Step 1: Run type checking**

Run: `bun run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run linting**

Run: `bun run lint`

Expected: exit code 0 with no ESLint errors or warnings introduced by these changes.

- [ ] **Step 3: Run the complete test suite**

Run: `bun run test`

Expected: all tests pass.

- [ ] **Step 4: Run the production build**

Run: `bun run build`

Expected: exit code 0 and TypeScript output generated successfully.
