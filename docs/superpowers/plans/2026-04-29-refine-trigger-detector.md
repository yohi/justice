# Refine TriggerDetector Keywords and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine `TriggerDetector` to reduce false positives by narrowing English verb keywords and update JSDoc to accurately reflect the implementation.

**Architecture:** 
1. Update `DELEGATION_KEYWORDS` regex for `implement`, `build`, and `create` to require following task-related nouns.
2. Update `shouldTrigger` JSDoc to document both Primary and Fallback paths.
3. Update tests to align with narrowed keywords.

**Tech Stack:** TypeScript, Vitest

---

## Task 1: Refine English Delegation Keywords

**Files:**
- Modify: `src/core/trigger-detector.ts`

- [ ] **Step 1: Update `DELEGATION_KEYWORDS`**

Change the regex for `implement`, `build`, and `create` to require task-related nouns.

```typescript
const DELEGATION_KEYWORDS: RegExp[] = [
  // ... existing keywords ...
  /\b(?:implement|build|create)\s+(?:task|issue|ticket|story|feature|component|module|service|test|code|fix)\b/i,
];
```

- [ ] **Step 2: Update `shouldTrigger` JSDoc**

Update the JSDoc for `shouldTrigger` to mention Primary and Fallback paths.

```typescript
  /**
   * Combined check: should this message trigger plan-bridge?
   * 
   * Triggers in two cases:
   * 1. Primary path: A plan reference AND an explicit delegation intent keyword are found.
   * 2. Fallback path: A plan reference is found even without an explicit keyword (implicit intent), provided that the lastUserMessage also contains the plan reference.
   * 
   * @deprecated Use analyzeTrigger() instead to avoid duplicate calls.
   */
  shouldTrigger(message: string, context?: TriggerContext): boolean {
    return this.analyzeTrigger(message, context).shouldTrigger;
  }
```

- [ ] **Step 3: Verify with existing tests**

Run: `npx vitest tests/core/trigger-detector.test.ts`
Expected: Some tests might fail because they use `implement`, `build`, or `create` without a following noun.

---

## Task 2: Update Tests for Refined Keywords

**Files:**
- Modify: `tests/core/trigger-detector.test.ts`

- [ ] **Step 1: Identify and fix failing tests**

Update test cases that use the refined keywords without context.

```typescript
      it("should detect English keywords: implement", () => {
        expect(detector.detectDelegationIntent("Please implement the feature")).toBe(true);
      });

      it("should detect English keywords: build", () => {
        expect(detector.detectDelegationIntent("build the component")).toBe(true);
      });

      it("should detect English keywords: create", () => {
        expect(detector.detectDelegationIntent("create the service")).toBe(true);
      });
```

- [ ] **Step 2: Add negative tests for lone keywords**

Ensure lone verbs no longer trigger intent.

```typescript
      it("should not detect lone English verbs without context", () => {
        expect(detector.detectDelegationIntent("I will implement it")).toBe(false);
        expect(detector.detectDelegationIntent("Just build it")).toBe(false);
        expect(detector.detectDelegationIntent("Can you create it?")).toBe(false);
      });
```

- [ ] **Step 3: Run all tests to verify**

Run: `npx vitest tests/core/trigger-detector.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/trigger-detector.ts tests/core/trigger-detector.test.ts
git commit -m "refactor: refine TriggerDetector keywords and update documentation"
```
