# Task 2: OpenCodePlugin の初期化順序の修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/opencode-plugin.ts` の `tool.execute.before` において、`adapter.getJustice()` 呼び出し（とデバッグログ出力）を `adapter.onToolExecuteBefore()` 呼び出しの後に移動し、初回呼び出し時に Justice が初期化された状態でログ判定が行われるようにする。

**Architecture:** `onToolExecuteBefore` 内部で `ensureInitialized` が呼ばれるため、これを先に実行することで `getJustice()` が正しいインスタンスを返すようになる。

**Tech Stack:** TypeScript, Vitest

---

### Task 1: OpenCodePlugin の修正

**Files:**
- Modify: `src/opencode-plugin.ts`

- [ ] **Step 1: 実行順序の変更**

```typescript
    "tool.execute.before": async (input, output): Promise<void> => {
      await adapter.onToolExecuteBefore(
        input as { tool: string; sessionID: string; callID: string },
        output as { args: Record<string, unknown> },
      );

      const justiceInstance = adapter.getJustice();
      if (!justiceInstance && !adapter.isNoOp()) {
        debugLog(
          "Justice: Prompt ignored by TriggerDetector (Justice not initialized or no delegation intent found).",
        );
      }
    },
```

- [ ] **Step 2: 既存テストの実行**

Run: `npm test tests/integration/opencode-plugin.test.ts`
Expected: PASS

### Task 2: 修正の検証（新規テストの追加）

**Files:**
- Modify: `tests/integration/opencode-plugin.test.ts`

- [ ] **Step 1: ログ出力順序を検証するテストの追加**

```typescript
  it("initializes Justice before checking instance in tool.execute.before", async () => {
    const init = fakeInit();
    const handlers = await OpenCodePlugin(init as never);
    
    // 初回の tool.execute.before 呼び出し
    await (handlers as Record<string, (i: unknown, o?: unknown) => Promise<void>>)["tool.execute.before"]?.(
      { tool: "task", sessionID: "s", callID: "c1" },
      { args: { prompt: "p" } },
    );

    const logFn = init.client.app.log as unknown as ReturnType<typeof vi.fn>;
    const logs = logFn.mock.calls.map((call) => (call[0] as { message: string }).message);
    
    // Justice initialized... ログが最初に出力され、
    // "Prompt ignored..." ログが出力されないことを確認する
    // (現在は TriggerDetector が動作しない設定なので、initialized ログのみが出るはず)
    expect(logs).toContain("Justice initialized via opencode-adapter");
    expect(logs.some(l => l.includes("Prompt ignored by TriggerDetector"))).toBe(false);
  });
```

- [ ] **Step 2: テストの実行**

Run: `npm test tests/integration/opencode-plugin.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/opencode-plugin.ts tests/integration/opencode-plugin.test.ts
git commit -m "fix: change initialization order in tool.execute.before"
```
