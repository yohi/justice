# Architecture Discrepancies Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix architectural discrepancies between design specs and implementation in Error Classifier and Tiered Wisdom Store, specifically moving quota patterns, removing wisdom store persistence locks, fixing secret detection logging, and correcting the relevant items merge order.

**Architecture:** 
1. `ErrorClassifier`: Move quota patterns to transient, update tests. Fix setting file name in message.
2. `WisdomPersistence`: Remove file locking mechanism from `saveAtomic` to align with the intentional lock-free design. Clean up associated tests.
3. `TieredWisdomStore`: Change hard-block to warning log on secret detection. Fix `getRelevant` array merge order to `[...local, ...global]`. Update tests.

**Tech Stack:** TypeScript, Vitest, Bun

---

## Task 1: Error Classifier Quota Patterns & Escalation Message

**Files:**
- Modify: `src/core/provider-error-patterns.ts`
- Modify: `tests/core/provider-error-patterns.test.ts`
- Modify: `tests/core/error-classifier.test.ts`
- Modify: `src/core/error-classifier.ts`

- [ ] **Step 1: Move Quota Patterns**
In `src/core/provider-error-patterns.ts`, move `/payment.?required/i`, `/usage\s+limit/i`, and `/out\s+of\s+credits?/i` from `PROVIDER_CONFIG_PATTERNS` to `PROVIDER_TRANSIENT_PATTERNS`.

- [ ] **Step 2: Update Pattern Tests**
In `tests/core/provider-error-patterns.test.ts`, move the test cases for "Out of credits" and "Payment Required" from `describe("PROVIDER_CONFIG_PATTERNS")` to `describe("PROVIDER_TRANSIENT_PATTERNS")`.

- [ ] **Step 3: Update Classifier Tests**
In `tests/core/error-classifier.test.ts`, move the quota-related tuples from `configSamples` to `transientSamples`.

- [ ] **Step 4: Fix Escalation Message Filename**
In `src/core/error-classifier.ts`, inside `getEscalationMessage`, change the config file name in the `provider_config` case from `oh-my-opencode.jsonc` to `oh-my-opencode.jsonc`.

- [ ] **Step 5: Run Tests**
Run: `bun run test tests/core/error-classifier.test.ts tests/core/provider-error-patterns.test.ts`
Expected: PASS

---

## Task 2: Wisdom Persistence Lock-Free Atomic Write

**Files:**
- Modify: `src/core/wisdom-persistence.ts`
- Modify: `tests/core/wisdom-persistence-atomic.test.ts`

- [ ] **Step 1: Remove Lock Mechanism from `saveAtomic`**
In `src/core/wisdom-persistence.ts`, completely remove the `.lock` directory logic, TTL checking, and retry mechanism from `saveAtomic`. Revert it to the simple, lock-free `load -> mergeById -> fromEntries -> serialize -> writeFile(tmp) -> rename(tmp, target)` sequence as originally designed.

- [ ] **Step 2: Update Atomic Persistence Tests**
In `tests/core/wisdom-persistence-atomic.test.ts`:
- Adjust the `deleteFile` and `writeFile` call counts assertions (they should be 1, since there is no longer a lock metadata file being created or deleted).
- Adjust the "concurrent calls" test if it relies on the lock perfectly preserving overlapping writes.

- [ ] **Step 3: Run Tests**
Run: `bun run test tests/core/wisdom-persistence-atomic.test.ts`
Expected: PASS

---

## Task 3: Tiered Wisdom Store Secret Detection & Merge Order

**Files:**
- Modify: `src/core/tiered-wisdom-store.ts`
- Modify: `tests/core/tiered-wisdom-store.test.ts`

- [ ] **Step 1: Fix Secret Detection Blocking**
In `src/core/tiered-wisdom-store.ts`, inside the `add` method, change the secret detection logic when `targetScope === "global"`. If secrets are detected, it should log a warning but DO NOT block the write to the global store. Change the return from `return this.localStore.add(entry)` to `return this.globalStore.add(entry)`.

- [ ] **Step 2: Fix `getRelevant` Merge Order**
In `src/core/tiered-wisdom-store.ts`, inside the `getRelevant` method, change the return statement to match the spec:
`return [...local, ...globalFiltered];` instead of `[...globalFiltered, ...local]`.

- [ ] **Step 3: Update Tiered Store Tests**
In `tests/core/tiered-wisdom-store.test.ts`, update the secret log test to expect `globalStore.add` to be called instead of `localStore.add` when a secret is detected. Also update any test checking the merged array order to reflect the `[...local, ...global]` change.

- [ ] **Step 4: Run Tests**
Run: `bun run test tests/core/tiered-wisdom-store.test.ts`
Expected: PASS

---

## Task 4: Final Verification and Commit

- [ ] **Step 1: Run All Checks**
Run: `bun run test && bun run typecheck && bun run lint`
Expected: PASS without any errors.

- [ ] **Step 2: Commit**
Commit all changes with the following message:
```bash
git add .
git commit -m "fix: resolve architecture and design discrepancies in wisdom store and error classifier"
```