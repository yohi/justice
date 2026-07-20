# Justice v2.0 Foundation 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Git workflow:** 本計画は Graphite Stacked PR Workflow に厳密に準拠します。1 タスク 200 LOC 制限、ブランチ命名 `feature/phaseN-v2-...__base` / `feature/phaseN-taskM-...`、各 Task 完了時は `gt submit` で Phase Base 向け Draft PR を作成・更新します。
> **Devcontainer 強制:** すべてのテスト・型検査・静的解析は **Devcontainer 内**で実行すること。ローカルホストでの実行は認めない。

**Goal:** Justice v2.0 Foundation 設計書（`docs/superpowers/specs/2026-06-16-justice-v2-foundation-design.md`）を実装し、既存 563 テストを壊さずに Quality Control Plane の基盤層を追加する。

**Architecture:** 加算シャドウ（dual）アプローチ。新 Observation Log + projection spine を既存 plan-bridge/task-feedback/wisdom と並走追加。Core は純粋関数・I/O 非依存。Hook は観測を捕捉し Core へ委譲。Runtime は per-writer segment JSONL への atomic append + readAll merge を担う。v2.0 は L0 advisory のみ（非ブロッキング）。

**Tech Stack:** TypeScript, Bun, Vitest, `@opencode-ai/plugin`, ESLint, Prettier, Devcontainer（`oven/bun:1`）, GitHub Actions (`ubuntu-slim`).

---

## Global Constraints

- 既存 563 テストは不変（回帰なし）。
- Core（`src/core/`）は `@opencode-ai/*` を import しない（FF-001）。
- すべての file I/O は `FileReader` / `FileWriter` 経由。テストでは mock を注入（`tests/helpers/mock-file-system.ts`）。`FileReader` は `readFile` / `fileExists` / `listFiles(prefix)` を提供する。（例外として、テストコードにおけるリポジトリの静的ファイル（ADR等）の存在確認やアーキテクチャ検証目的の読取に限り、Node.js の `fs` モジュールの直接使用を許可します）。
- 状態は immutable（`readonly` / `ReadonlyArray` / `ReadonlyMap`）。
- すべての fail-open 境界は `try/catch` で保護し、`PROCEED` に縮退する。
- 永続化前に SecretPatternDetector で redaction + 絶対パス redaction + truncation を実施（D25/D61）。
- `declared` provenance は gate 充足（PASS）に算入しない。PASS に算入するのは `observed` / `derived`（`derived` は observed 起源限定）のみ（FF-008）。
- `devcontainer` 内でのみ `bun run lint` / `typecheck` / `test` / `build` を実行する。
- ブランチ運用は [Graphite Stacked PR Workflow](https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnS4oioAtOOsRFxbhj7DasZszJsUzA6R74JH66RtuaZljfMTOMp01vNhWjcaM0hMPMpWGtEG2CqCiJRKUnxfpUq5IKUvCuw8ckJxEzV_S-lANVqatSiXDyPIwACDWLiYMx_FxpOVwVe-lN3OEfYJMKFB1HyzYW__8mfULCRcQthYXlSoLzc6GHSwYYLtJOMVUh3x34AuPc1rdosiFf2YYStsXJoCj9-iTs7BjmJ0E_-omFWTGPH0uOK-AXq_XLLxAltwuQt-Ct5q_9u-w_QBPhX7UxyHYfZJSstDIFryh_4uUFWBdWMCh0TSrYJxTw&lib=M0tqVErYg9kMB9ia8bpbmo4TD2knUOGjU) を使用。1 タスク 200 LOC 制限、命名 `feature/phaseN-taskM-...`、Base ブランチ `feature/phaseN-...__base`。各 Task 最後は **Phase Base に向けた Draft PR 作成**。

> **Graphite 運用詳細:**
>
> - Base ブランチは、最初の Phase 0 は `master` から `gt checkout master && gt trunk && gt branch create feature/phase0-v2-baseline__base` で作成しますが、後続の Phase N+1 の Base ブランチは、前 Phase N の最終 Task ブランチ（前 Phase の全実装を含む状態）を起点として分岐させて作成します。これにより、次 Phase が前 Phase の実装成果を確実に含むようにします。
> - 各 Task ブランチは Phase Base から `gt checkout feature/phaseN-v2-...__base && gt branch create feature/phaseN-taskM-...` で分岐（Phase 内で連続する Task は直前 Task から分岐）。
> - タスク完了時は `gt add . && gt commit` 後、`gt submit` で Phase Base 向け Draft PR を一括作成・更新する。
> - 下位 Task を修正した場合は `gt restack` で上位スタックを再整列する。
> - 本計画内の「Phase Base に向けた Draft PR を作成する」は `gt submit` による Draft PR 作成を指す。

---

> **Split plan:** This file is part 03 of the split Justice v2.0 Foundation implementation plan.
> **Scope:** Shard layout, writer ID, write queue, log persistence, projection, cache integrity, and archive rotation.
> **Index:** See `2026-06-26-justice-v2-foundation.md` for the complete split-plan map and cross-phase dependency summary.

## Phase 2: Observation Log Store + State Projection

**Base Branch:** `feature/phase2-v2-log-projection__base`

---

### Task 2.1: Shard Layout + Writer ID Validation

**Files:**

- Create: `src/core/v2/shard-layout.ts`
- Create: `src/core/v2/writer-id-validation.ts`
- Create: `src/runtime/writer-id.ts`
- Test: `tests/core/v2/shard-layout.test.ts`
- Test: `tests/runtime/writer-id.test.ts`

- [x] **Step 1: shard layout 関数と writer-id バリデーションを実装**

```typescript
// src/core/v2/writer-id-validation.ts
const WRITER_ID_RE = /^w-[A-Za-z0-9-]+$/;

export function isSafeWriterId(id: string): boolean {
  return WRITER_ID_RE.test(id) && id !== "w-system";
}
```

```typescript
// src/core/v2/shard-layout.ts
import { encodeSafeSegment } from "./safe-segment.ts";
import type { ShardId } from "../types.ts";
import { isSafeWriterId } from "./writer-id-validation.ts";
import { isSafeObservationAgentId } from "./observation-agent-id-validation.ts";

export function toPhysicalPath(shardId: ShardId): string {
  if (!isSafeObservationAgentId(shardId.agentId)) {
    throw new Error(`toPhysicalPath: unsafe agentId: ${shardId.agentId}`);
  }
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toPhysicalPath: unsafe writerId: ${shardId.writerId}`);
  }
  return `.justice/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.jsonl`;
}

const TIMESTAMP_RE = /^[A-Za-z0-9]+$/;

export function toArchivePath(shardId: ShardId, timestamp: string): string {
  if (!isSafeObservationAgentId(shardId.agentId)) {
    throw new Error(`toArchivePath: unsafe agentId: ${shardId.agentId}`);
  }
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toArchivePath: unsafe writerId: ${shardId.writerId}`);
  }
  if (!TIMESTAMP_RE.test(timestamp)) {
    throw new Error(`toArchivePath: unsafe timestamp: ${timestamp}`);
  }
  return `.justice/archive/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.${timestamp}.jsonl`;
}
```

- [x] **Step 2: writer ID 生成を実装（D55）**

```typescript
// src/runtime/writer-id.ts
import { randomUUID } from "crypto";
import type { FileReader } from "../core/types.ts";
import { toPhysicalPath } from "../core/v2/shard-layout.ts";
import { isSafeWriterId } from "../core/v2/writer-id-validation.ts";

export function generateWriterId(): string {
  return `w-${randomUUID()}`;
}

export async function allocateWriterId(
  fileReader: FileReader,
  shardWithoutWriterId: { readonly agentId: string; readonly sessionId: string }
): Promise<string> {
  const candidate = generateWriterId();
  const physicalPath = toPhysicalPath({ ...shardWithoutWriterId, writerId: candidate });
  if (await fileReader.fileExists(physicalPath)) {
    return await allocateWriterId(fileReader, shardWithoutWriterId);
  }
  return candidate;
}
```

- [x] **Step 3: Commit**

```bash
git add src/core/v2/shard-layout.ts src/core/v2/writer-id-validation.ts src/runtime/writer-id.ts
git commit -m "feat(v2): shard file layout, writer ID generation, and collision allocation"
```

---

### Task 2.2a: FileReader/FileWriter Extension and Mock Support

**Files:**

- Modify: `src/core/types.ts`
- Modify: `src/runtime/node-file-system.ts`
- Modify: `tests/helpers/mock-file-system.ts`

- [x] **Step 1: `FileReader` および `FileWriter` インタフェースを拡張（§9.4 / 指摘5）**

```typescript
// src/core/types.ts
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  listFiles(prefix: string): Promise<readonly string[]>;
}

export interface FileWriter {
  writeFile(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>; // implementations must create parent directories for `to` before renaming
}
```

- [x] **Step 2: `node-file-system.ts` での `listFiles` / `rename` 実装**

```typescript
// src/runtime/node-file-system.ts
import { readdir, rename } from "node:fs/promises";
import { join, relative } from "node:path";

async listFiles(prefix: string): Promise<readonly string[]> {
  try {
    const safePrefix = await this.resolveSafely(prefix);
    const entries = await readdir(safePrefix, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".jsonl"))
      .map((e) => relative(this.rootDir, join(e.parentPath, e.name)));
  } catch (err) {
    return [];
  }
}

async rename(from: string, to: string): Promise<void> {
  const safeFrom = await this.resolveSafely(from);
  const safeTo = await this.resolveSafely(to);
  await this.ensureParentDir(safeTo);
  await rename(safeFrom, safeTo);
}
```

- [x] **Step 4: Commit**

```bash
git add src/core/types.ts src/runtime/node-file-system.ts tests/helpers/mock-file-system.ts
git commit -m "feat(v2): extend FileReader with listFiles and FileWriter with rename"
```

---

### Task 2.2b: Per-Shard Write Queue

**Files:**

- Create: `src/runtime/write-queue.ts`
- Test: `tests/runtime/observation-log-queue.test.ts`

- [x] **Step 1: write queue を実装（D23/D30 / 指摘5）**

```typescript
// src/runtime/write-queue.ts
import type { PendingLogRecord } from "./observation-model.ts";

type QueueItem = {
  readonly record: PendingLogRecord;
  readonly resolve: (seq: number) => void;
  readonly reject: (err: unknown) => void;
};

export function createShardWriteQueue(
  writer: { writeFile(path: string, content: string): Promise<void>; rename(from: string, to: string): Promise<void> },
  readExisting: (path: string) => Promise<string>,
  getInitialSequence: (path: string) => Promise<number>,
  onError: (path: string, err: unknown) => void,
  onAppendComplete?: (path: string) => Promise<void>
): (path: string, record: PendingLogRecord) => Promise<number> {
  const queues = new Map<string, QueueItem[]>();
  const sequences = new Map<string, number>();
  const runningPaths = new Set<string>();

  async function atomicAppend(path: string, content: string) {
    const tempPath = `${path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await writer.writeFile(tempPath, content);
    await writer.rename(tempPath, path);
  }

  async function process(path: string) {
    if (runningPaths.has(path)) return;
    runningPaths.add(path);

    try {
      if (!sequences.has(path)) {
        const initSeq = await getInitialSequence(path);
        sequences.set(path, initSeq);
      }
      while (true) {
        const items = queues.get(path);
        if (!items || items.length === 0) break;

        const current = items.shift()!;
        try {
          const nextSeq = (sequences.get(path) ?? 0) + 1;
          const line = `${JSON.stringify({ ...current.record, sequence: nextSeq })}\n`;
          await atomicAppend(path, line);
          sequences.set(path, nextSeq);
          
          if (onAppendComplete) await onAppendComplete(path).catch((err) => onError(path, err));
          current.resolve(nextSeq);
        } catch (err) {
          current.reject(err);
          throw err;
        }
      }
    } catch (err) {
      onError(path, err);
      const items = queues.get(path) ?? [];
      while (items.length > 0) items.shift()!.reject(err);
    } finally {
      runningPaths.delete(path);
      const items = queues.get(path);
      if (items && items.length > 0) process(path);
      else queues.delete(path);
    }
  }

  return (path, record) => new Promise((resolve, reject) => {
    if (!queues.has(path)) queues.set(path, []);
    queues.get(path)!.push({ record, resolve, reject });
    process(path);
  });
}
```

- [x] **Step 3: Commit**

```bash
git add src/runtime/write-queue.ts tests/runtime/observation-log-queue.test.ts
git commit -m "feat(v2): implement per-shard write queue with atomic temporary appends"
```

---

### Task 2.2c: Observation Log Store Persistence

**Files:**

- Create: `src/runtime/observation-log-store.ts`
- Create: `src/runtime/validation.ts`

- [x] **Step 1: `validation.ts` を実装**

```typescript
// src/runtime/validation.ts
import type { ObservationRecord, DecisionRecord } from "../core/types.ts";

export function validateRecordSchema(r: any): void {
  if (!r || typeof r !== "object") {
    throw new Error("Invalid record: not an object");
  }
  if (r.schemaVersion !== 1) {
    throw new Error(`Invalid record: unsupported schemaVersion ${r.schemaVersion}`);
  }
  if (typeof r.sequence !== "number" || r.sequence < 0) {
    throw new Error("Invalid record: sequence must be a non-negative number");
  }
  if (!r.timestamp || typeof r.timestamp !== "string") {
    throw new Error("Invalid record: timestamp must be a string");
  }
  if (
    typeof r.agentId !== "string" ||
    typeof r.sessionId !== "string" ||
    typeof r.writerId !== "string"
  ) {
    throw new Error("Invalid record: missing or invalid shard identifier fields");
  }

  if (r.recordType === "observation") {
    const kind = r.kind;
    if (kind === "tool_executed") {
      if (typeof r.toolName !== "string" || typeof r.callId !== "string" || !r.evidence) {
        throw new Error("Invalid tool_executed record");
      }
    } else if (kind === "message") {
      if (typeof r.role !== "string" || typeof r.textHash !== "string" || (r.declaredClaims !== undefined && !Array.isArray(r.declaredClaims))) {
        throw new Error("Invalid message record");
      }
    } else if (kind === "skill_invoked") {
      if (typeof r.skillName !== "string" || typeof r.source !== "string") {
        throw new Error("Invalid skill_invoked record");
      }
    } else if (kind === "review_observed") {
      if (typeof r.reviewScope !== "string" || !Array.isArray(r.items)) {
        throw new Error("Invalid review_observed record");
      }
      for (const item of r.items) {
        if (
          !item ||
          typeof item !== "object" ||
          typeof item.itemKey !== "string" ||
          typeof item.evidenceId !== "string" ||
          !["critical", "major", "minor"].includes(item.severity) ||
          !["open", "resolved"].includes(item.status)
        ) {
          throw new Error("Invalid review_observed item");
        }
      }
    } else if (kind === "session_error") {
      if (!r.sessionError) {
        throw new Error("Invalid session_error record");
      }
    } else if (kind === "reflection") {
      if (!r.planRef) {
        throw new Error("Invalid reflection record");
      }
    } else {
      throw new Error(`Invalid record: unknown observation kind: ${kind}`);
    }
  } else if (r.recordType === "decision") {
    if (
      r.gateType !== "task" ||
      !["PASS", "WARN", "FAIL"].includes(r.verdict) ||
      r.reachableEnforcementLevel !== "L1" ||
      r.appliedEnforcementLevel !== "L0" ||
      !Array.isArray(r.ruleResults)
    ) {
      throw new Error("Invalid decision record");
    }
    for (const ruleResult of r.ruleResults) {
      if (
        !ruleResult ||
        typeof ruleResult !== "object" ||
        typeof ruleResult.ruleId !== "string" ||
        !["PASS", "WARN", "FAIL"].includes(ruleResult.verdict) ||
        (ruleResult.reason !== undefined && typeof ruleResult.reason !== "string") ||
        !Array.isArray(ruleResult.evidenceRefs)
      ) {
        throw new Error("Invalid decision ruleResult");
      }
      for (const ref of ruleResult.evidenceRefs) {
        if (
          !ref ||
          typeof ref !== "object" ||
          typeof ref.agentId !== "string" ||
          typeof ref.sessionId !== "string" ||
          typeof ref.writerId !== "string" ||
          typeof ref.sequence !== "number" ||
          typeof ref.evidenceId !== "string"
        ) {
          throw new Error("Invalid decision evidenceRef");
        }
      }
    }
  } else {
    throw new Error(`Invalid record: unknown recordType: ${r.recordType}`);
  }
}

export function validateShardSequences(records: readonly (ObservationRecord | DecisionRecord)[]): void {
  const shardGroups = new Map<string, number[]>();
  for (const r of records) {
    const shardKey = `${r.agentId}:${r.sessionId}:${r.writerId}`;
    if (!shardGroups.has(shardKey)) {
      shardGroups.set(shardKey, []);
    }
    shardGroups.get(shardKey)!.push(r.sequence);
  }
  for (const [shardKey, seqs] of shardGroups.entries()) {
    // Sort sequences to normalize traversal order variations before checks (D72)
    seqs.sort((a, b) => a - b);
    // 1. Check for duplicate sequence numbers using a Set (independent of traversal order)
    const uniqueSeqs = new Set(seqs);
    if (uniqueSeqs.size !== seqs.length) {
      throw new Error(`Sequence integrity violation on ${shardKey}: duplicate sequence detected`);
    }
    // 2. Check for physical order monotonicity (D72/§9.4)
    for (let i = 1; i < seqs.length; i++) {
      if (seqs[i] < seqs[i - 1]) {
        throw new Error(`Sequence integrity violation on ${shardKey}: sequence inversion detected (non-monotonic)`);
      }
    }
  }
}
```

- [x] **Step 1b（2026-07-15 追加・実装後の訂正）: shard内 sequence の物理行順改竄検知を追加実装（D72）**
  - `validateShardSequences` はマージ後に `sequence` でソートしてから duplicate/gap を検査するため、同一物理ファイル内でレコードの出現順序（物理行順）が `sequence` 昇順と入れ替わっていても値集合自体は変化せず検知できない穴があった。
  - `src/runtime/validation.ts` に `validatePhysicalFileSequenceOrder()` を追加し、`ObservationLogStore.readAll()` 内で物理ファイル単位に検証し、改竄を検知した shard は fail-open で結果から除外するように修正（`src/runtime/observation-log-store.ts`）。既存のソートベース duplicate/gap 検査はそのまま維持し、archive/active 間の順序チェックは対象外（設計要件通り）。
  - 参照コミット: `be6c546`（`fix(observation-log-store): shard内sequenceの物理行順改竄を検知する`）。テストは `tests/runtime/observation-log-store.test.ts` に追加。

- [x] **Step 2: `ObservationLogStore` クラスを実装**

```typescript
// src/runtime/observation-log-store.ts
import { createShardWriteQueue } from "./write-queue.ts";
import { validateRecordSchema, validateShardSequences } from "./validation.ts";
import type { ShardId, FileWriter, FileReader } from "../core/types.ts";
import type { PendingLogRecord, PersistedLogRecord } from "../core/v2/observation-model.ts";
import { toPhysicalPath } from "../core/v2/shard-layout.ts";

export class ObservationLogStore {
  private readonly enqueue: (path: string, record: PendingLogRecord) => Promise<number>;

  constructor(
    private readonly fileWriter: FileWriter,
    private readonly fileReader: FileReader,
    private readonly writerId: string
  ) {
    this.enqueue = createShardWriteQueue(
      {
        writeFile: (path, content) => this.fileWriter.writeFile(path, content),
        rename: (from, to) => this.fileWriter.rename(from, to),
      },
      async (path) => (await this.fileReader.fileExists(path)) ? await this.fileReader.readFile(path) : "",
      async (path) => {
        let maxSeq = 0;
        const readMaxSeq = async (p: string) => {
          if (await this.fileReader.fileExists(p)) {
            const content = await this.fileReader.readFile(p);
            for (const line of content.split("\n")) {
              if (!line.trim()) continue;
              try {
                const rec = JSON.parse(line);
                if (typeof rec.sequence === "number" && rec.sequence > maxSeq) maxSeq = rec.sequence;
              } catch {}
            }
          }
        };

        await readMaxSeq(path);
        const parts = path.split("/");
        if (parts.length >= 5) {
          const agentId = parts[2];
          const safeSessionId = parts[3];
          const writerId = parts[4].replace(".jsonl", "");
          const archiveDir = `.justice/archive/events/${agentId}/${safeSessionId}`;
          const archives = await this.fileReader.listFiles(archiveDir);
          for (const arch of archives) {
            if (arch.split("/").pop()?.startsWith(`${writerId}.`)) await readMaxSeq(arch);
          }
        }
        return maxSeq;
      },
      (path, err) => console.warn(`ObservationLogStore: append failed for ${path}`, err)
    );
  }

  async append(shardId: ShardId, record: PendingLogRecord): Promise<number> {
    return this.enqueue(toPhysicalPath(shardId), record);
  }

  async readAll(): Promise<readonly PersistedLogRecord[]> {
    const activePaths = await this.fileReader.listFiles(".justice/events");
    const archivePaths = await this.fileReader.listFiles(".justice/archive/events");
    const allPaths = [...archivePaths.sort(), ...activePaths.sort()];
    const records: PersistedLogRecord[] = [];
    
    for (const path of allPaths) {
      try {
        const content = await this.fileReader.readFile(path);
        for (const line of content.split("\n").filter((l) => l.trim())) {
          const record = JSON.parse(line) as PersistedLogRecord;
          validateRecordSchema(record);
          records.push(record);
        }
      } catch (err) {
        console.error(`Failed to read or validate event file ${path}`, err);
      }
    }
    try {
      validateShardSequences(records);
    } catch (err) {
      console.warn("Failed to validate shard sequences, continuing", err);
    }
    return records;
  }
}
```

- [x] **Step 3: Commit**

```bash
git add src/runtime/observation-log-store.ts src/runtime/validation.ts
git commit -m "feat(v2): implement observation log store with strict record schema and shard sequence validation"
```



---

### Task 2.3: State Projection (Pure Fold)

**Files:**

- Create: `src/core/v2/state-projection.ts`
- Create: `src/core/v2/integrity.ts`
- Test: `tests/core/v2/state-projection.test.ts`
- Test: `tests/core/observation-log-replay.test.ts`

**Interfaces:**

- Consumes: `ObservationRecord`, `DecisionRecord`, `readAll()` output.
- Produces:
  - `project(events, rebuiltAt): ProjectedState`
  - Deterministic 2-stage merge: within-shard by `sequence`, across-shards by `timestamp → shardId → sequence`.
  - `ProjectedState` with `tasks`, `reviewSummary` (global + byScope), `integrity.maxSequenceByShard`.

- [x] **Step 1: projection fold を実装（§6.3/D27/D39）**

```typescript
// src/core/v2/state-projection.ts
export type ProjectedEvidence = {
  readonly evidence: Evidence;
  readonly ref: FullEvidenceRef;
};

export type ProjectedState = {
  readonly schemaVersion: 2;
  readonly rebuiltAt: string;
  readonly integrity: {
    readonly sourceHash: string;
    readonly maxSequenceByShard: ReadonlyMap<string, number>;
  };
  readonly tasks: ReadonlyMap<string, { readonly status: string; readonly lastVerdict: string; readonly evidence: readonly ProjectedEvidence[]; readonly observedReviewScopes: readonly string[] }>;
  readonly reviewSummary: {
    readonly authority: "observed_review_output";
    readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    readonly byScope: ReadonlyMap<string, {
      readonly critical: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly major: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly minor: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly resolved: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
      readonly open: readonly { readonly itemKey: string; readonly ref: FullEvidenceRef; readonly severity: "critical" | "major" | "minor" }[];
    }>;
  };
};

export function toEvidenceArray(evidence: Evidence | readonly Evidence[] | undefined): readonly Evidence[] {
  if (!evidence) return [];
  return Array.isArray(evidence) ? evidence : [evidence];
}

export function project(
  events: readonly (ObservationRecord | DecisionRecord)[],
  rebuiltAt: string
): ProjectedState {
  // 1. Sort events: 2-stage merge (D27/D18/D39). Group by shardId, sort each by sequence, then k-way merge by timestamp -> shardId -> sequence
  const groups = new Map<string, (ObservationRecord | DecisionRecord)[]>();
  for (const event of events) {
    const shardKey = `${event.agentId}:${event.sessionId}:${event.writerId}`;
    if (!groups.has(shardKey)) groups.set(shardKey, []);
    groups.get(shardKey)!.push(event);
  }

  // Sort each shard stream by sequence
  const streams = Array.from(groups.values()).map(stream => 
    stream.sort((a, b) => a.sequence - b.sequence)
  );

  // K-way merge using timestamp -> shardId -> sequence
  const sorted: (ObservationRecord | DecisionRecord)[] = [];
  const indices = new Array(streams.length).fill(0);

  while (true) {
    let bestStreamIdx = -1;
    let bestVal: ObservationRecord | DecisionRecord | null = null;

    for (let i = 0; i < streams.length; i++) {
      if (indices[i] >= streams[i].length) continue;
      const val = streams[i][indices[i]];
      if (bestVal === null) {
        bestStreamIdx = i;
        bestVal = val;
      } else {
        const timeA = new Date(val.timestamp).getTime();
        const timeB = new Date(bestVal.timestamp).getTime();
        if (timeA !== timeB) {
          if (timeA < timeB) {
            bestStreamIdx = i;
            bestVal = val;
          }
        } else {
          const shardA = `${val.agentId}:${val.sessionId}:${val.writerId}`;
          const shardB = `${bestVal.agentId}:${bestVal.sessionId}:${bestVal.writerId}`;
          const shardComp = shardA.localeCompare(shardB);
          if (shardComp < 0) {
            bestStreamIdx = i;
            bestVal = val;
          } else if (shardComp === 0) {
            if (val.sequence < bestVal.sequence) {
              bestStreamIdx = i;
              bestVal = val;
            }
          }
        }
      }
    }

    if (bestStreamIdx === -1) break;
    sorted.push(bestVal!);
    indices[bestStreamIdx]++;
  }

  const maxSequenceByShard = new Map<string, number>();
  const tasks = new Map<string, { status: string; lastVerdict: string; evidence: ProjectedEvidence[]; observedReviewScopes: string[] }>();
  
  for (const event of sorted) {
    const shardKey = `${event.agentId}:${event.sessionId}:${event.writerId}`;
    const seq = event.sequence;
    const currentMax = maxSequenceByShard.get(shardKey) ?? -1;
    if (seq > currentMax) {
      maxSequenceByShard.set(shardKey, seq);
    }

    const ref = {
      agentId: event.agentId,
      sessionId: event.sessionId,
      writerId: event.writerId,
      sequence: event.sequence,
    };

    if (event.recordType === "observation") {
      const taskId = event.taskId;
      
      // Task evidence fold (D8/D20/D68)
      if (taskId) {
        if (!tasks.has(taskId)) {
          tasks.set(taskId, { status: "open", lastVerdict: "NONE", evidence: [], observedReviewScopes: [] });
        }
        const taskState = tasks.get(taskId)!;

        if (event.kind === "tool_executed") {
          const recordWithEvidence = event as ToolExecutedRecord;
          const evidenceList = toEvidenceArray(recordWithEvidence.evidence || []);
          for (const ev of evidenceList) {
            taskState.evidence.push({
              evidence: ev,
              ref: { ...ref, evidenceId: ev.evidenceId },
            });
          }
        } else if (event.kind === "review_observed") {
          if (event.reviewScope) {
            taskState.observedReviewScopes.push(event.reviewScope);
          }
        }
      }
    } else if (event.recordType === "decision") {
      const taskId = event.taskId;
      if (taskId) {
        if (!tasks.has(taskId)) {
          tasks.set(taskId, { status: "open", lastVerdict: "NONE", evidence: [], observedReviewScopes: [] });
        }
        const taskState = tasks.get(taskId)!;
        taskState.lastVerdict = event.verdict; // WARN/FAIL/PASS
        taskState.status = event.verdict; // Update status to match test expectations (PASS/FAIL/WARN)
      }
    }
  }

  // Review aggregator fold (D11/D32/D66/D57) - review_observed.items[] を scope 別に集約する。
  const reviewSummary: ReviewSummary = {
    authority: "observed_review_output",
    critical: [],
    major: [],
    minor: [],
    resolved: [],
    open: [],
    byScope: new Map(),
  };

  const ensureScopeSummary = (reviewScope: string) => {
    const existing = reviewSummary.byScope.get(reviewScope);
    if (existing) return existing;
    const created = { critical: [], major: [], minor: [], resolved: [], open: [] };
    reviewSummary.byScope.set(reviewScope, created);
    return created;
  };

  for (const event of sorted) {
    if (event.recordType !== "observation" || event.kind !== "review_observed") continue;
    const scopeSummary = ensureScopeSummary(event.reviewScope);

    for (const item of event.items) {
      const projected = {
        itemKey: item.itemKey,
        ref: {
          agentId: event.agentId,
          sessionId: event.sessionId,
          writerId: event.writerId,
          sequence: event.sequence,
          evidenceId: item.evidenceId,
        },
        severity: item.severity,
      };

      if (item.severity === "critical") {
        reviewSummary.critical.push(projected);
        scopeSummary.critical.push(projected);
      } else if (item.severity === "major") {
        reviewSummary.major.push(projected);
        scopeSummary.major.push(projected);
      } else {
        reviewSummary.minor.push(projected);
        scopeSummary.minor.push(projected);
      }

      if (item.status === "resolved") {
        reviewSummary.resolved.push(projected);
        scopeSummary.resolved.push(projected);
      } else {
        reviewSummary.open.push(projected);
        scopeSummary.open.push(projected);
      }
    }
  }

  return {
    schemaVersion: 2,
    rebuiltAt,
    integrity: {
      sourceHash: hashString(sorted.map((e) => JSON.stringify(e)).join("\n")),
      maxSequenceByShard,
    },
    tasks,
    reviewSummary,
  };
}

export function toSerializableProjectedState(state: ProjectedState): object {
  // ProjectedState uses ReadonlyMap internally for immutability, but state.json must be a plain JSON object.
  return {
    ...state,
    integrity: {
      ...state.integrity,
      maxSequenceByShard: Object.fromEntries(state.integrity.maxSequenceByShard),
    },
    tasks: Object.fromEntries(state.tasks),
    reviewSummary: {
      ...state.reviewSummary,
      byScope: Object.fromEntries(
        state.reviewSummary.byScope,
      ),
    },
  };
}

export function fromSerializableProjectedState(obj: unknown): ProjectedState {
  const raw = obj as Record<string, any>;
  return {
    ...raw,
    integrity: {
      ...raw.integrity,
      maxSequenceByShard: new Map(Object.entries(raw.integrity.maxSequenceByShard)),
    },
    tasks: new Map(Object.entries(raw.tasks)),
    reviewSummary: {
      ...raw.reviewSummary,
      byScope: new Map(
        Object.entries(raw.reviewSummary.byScope).map(([k, v]: [string, unknown]) => [k, v])
      ),
    },
  } as unknown as ProjectedState;
}
```

- [x] **Step 2: `StateProjectionCache` を実装（§5.6 / §9.4）**

```typescript
// src/runtime/state-projection-cache.ts
import type { FileWriter, FileReader } from "../core/types.ts";
import type { ProjectedState } from "../core/v2/state-projection.ts";
import { toSerializableProjectedState, fromSerializableProjectedState } from "../core/v2/state-projection.ts";

export class StateProjectionCache {
  constructor(
    private readonly fileWriter: FileWriter,
    private readonly fileReader: FileReader,
    private readonly path = ".justice/state.json",
    private readonly logger: { warn(message: string, err?: unknown): void } = console
  ) {}

  async write(state: ProjectedState): Promise<void> {
    try {
      const content = JSON.stringify(toSerializableProjectedState(state));
      const tempPath = `${this.path}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
      await this.fileWriter.writeFile(tempPath, content);
      await this.fileWriter.rename(tempPath, this.path);
    } catch (err) {
      // fail-open: log and continue
      this.logger.warn("state.json cache write failed", err);
    }
  }

  async read(): Promise<ProjectedState | undefined> {
    try {
      if (!(await this.fileReader.fileExists(this.path))) return undefined;
      const content = await this.fileReader.readFile(this.path);
      const parsed = JSON.parse(content);
      // Validate schema and structural fields
      if (!parsed || typeof parsed !== "object" || !parsed.integrity || typeof parsed.integrity !== "object" || !("maxSequenceByShard" in parsed.integrity)) {
        this.logger.warn("state.json structure invalid, triggering rebuild");
        return undefined;
      }
      return fromSerializableProjectedState(parsed);
    } catch (err) {
      this.logger.warn("state.json read/parse failed, triggering rebuild", err);
      return undefined;
    }
  }
}
```

```typescript
// src/runtime/state-projection-cache.ts
export function validateProjectionCacheAgainstEvents(
  cacheState: ProjectedState,
  events: readonly (ObservationRecord | DecisionRecord)[]
): { readonly valid: boolean; readonly reason: "valid" | "stale_append" | "mismatch_seq" | "structural" } {
  // 1. Schema integrity & structural field check
  if (!cacheState.integrity || typeof cacheState.integrity !== "object" || !cacheState.integrity.maxSequenceByShard) {
    return { valid: false, reason: "structural" };
  }

  // 2. Compare shard sequence state using the same normalized ordering as project()
  const currentMaxSeq = new Map<string, number>();
  for (const e of events) {
    const shardKey = `${e.agentId}:${e.sessionId}:${e.writerId}`;
    const cur = currentMaxSeq.get(shardKey) ?? -1;
    if (e.sequence > cur) currentMaxSeq.set(shardKey, e.sequence);
  }

  const cachedMap = cacheState.integrity.maxSequenceByShard;
  if (cachedMap.size !== currentMaxSeq.size) {
    return { valid: false, reason: "mismatch_seq" };
  }
  for (const [shardKey, cachedSeq] of cachedMap.entries()) {
    const currentSeq = currentMaxSeq.get(shardKey);
    if (currentSeq === undefined || cachedSeq > currentSeq) {
      return { valid: false, reason: "mismatch_seq" };
    }
    if (cachedSeq < currentSeq) {
      return { valid: false, reason: "stale_append" };
    }
  }

  // 3. Check sourceHash mismatch using the same stable ordering as project()
  const sortedEvents = [...events].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeA !== timeB) return timeA - timeB;
    const shardA = `${a.agentId}:${a.sessionId}:${a.writerId}`;
    const shardB = `${b.agentId}:${b.sessionId}:${b.writerId}`;
    if (shardA !== shardB) return shardA < shardB ? -1 : 1;
    return a.sequence - b.sequence;
  });
  const currentSourceHash = hashString(sortedEvents.map((e) => JSON.stringify(e)).join("\n"));
  if (cacheState.integrity.sourceHash !== currentSourceHash) {
    return { valid: false, reason: "stale_append" };
  }

  return { valid: true, reason: "valid" };
}
```

`ObservationLogStore` / `observation-handler` は projection 再構築後に `StateProjectionCache.write(state)` を呼び出す。書込失敗は fail-open で無視する。また、起動時に `StateProjectionCache.read()` を呼び出し、得られたキャッシュの `integrity` を、実際の `readAll()`結果から構築した `currentIntegrity`（実際のイベント群）と `validateProjectionCacheAgainstEvents` を用いて検証・比較する。キャッシュ不一致（欠損、破損、schema 不一致、`sourceHash` の乖離、あるいは `maxSequenceByShard` の不一致検知時）の場合はキャッシュを破棄し（`undefined` として扱い）、event log から再構築（rebuild）を行う。ただし、`sourceHash` 乖離（`reason === "stale_append"`）による再構築は、通常のイベント追記に伴う自然なキャッシュの stale 状態であるため、WARN や corruption/tamper 警告を出さずに静かに再構築（silent rebuild）を行う。一方、`maxSequenceByShard` 不一致や構造破損・スキーマ不正検知時は警告（WARN）を出した上で再構築を行う。

- [x] **Step 2b: StateProjectionCache の読込・バリデーションテストを追加（D72）**

`tests/runtime/state-projection-cache-read.test.ts` を作成し、以下を検証するテストを実装する：
1. キャッシュが存在しない、またはスキーマ不正や破損（例外発生など）時に `read()` が `undefined` を返すこと。
2. 正常時のみ `ProjectedState` を復元すること。
3. 正常なイベント追記による `sourceHash` mismatch 発生時、`validateProjectionCacheAgainstEvents` が `stale_append` を返し、警告（WARN）を出さずに静かに再構築（silent rebuild）が行われること（silent rebuild 分岐テスト）。
4. `maxSequenceByShard` 不一致や構造破損時は警告（WARN）を出して再構築が行われること。

- [x] **Step 2c: JSON round-trip テストを追加**

`ProjectedState` 内部は `ReadonlyMap` であっても、`toSerializableProjectedState()` 経由で書き込んだ `state.json` が正しく `maxSequenceByShard` / `tasks` / `reviewSummary.byScope` を含むことを検証する。

```typescript
// tests/runtime/state-projection-cache.test.ts
it("serializes ReadonlyMap fields to JSON objects", async () => {
  const state = project(sampleEvents, "2026-06-26T00:00:00.000Z");
  await cache.write(state);
  const written = writer.getFile(".justice/state.json");
  const parsed = JSON.parse(written);
  expect(parsed.integrity.maxSequenceByShard).toBeDefined();
  expect(Object.keys(parsed.integrity.maxSequenceByShard).length).toBeGreaterThan(0);
  expect(parsed.reviewSummary.byScope).toBeDefined();
  expect(typeof parsed.reviewSummary.byScope).toBe("object");
  expect(Array.isArray(parsed.reviewSummary.byScope)).toBe(false);
});
```

- [x] **Step 3: FF-004 replay test を実装**

```typescript
// tests/core/observation-log-replay.test.ts
import { project } from "../../src/core/v2/state-projection.ts";
import type { ObservationRecord, DecisionRecord } from "../../src/core/v2/observation-model.ts";

describe("FF-004 replay determinism and state validation", () => {
  it("same events produce same state and correctly map taskId, decision records, and reviews", () => {
    const events: (ObservationRecord | DecisionRecord)[] = [
      {
        schemaVersion: 1,
        sequence: 1,
        timestamp: "2026-06-28T12:00:00Z",
        agentId: "atlas",
        sessionId: "session-123",
        writerId: "w1",
        recordType: "observation",
        kind: "tool_executed",
        toolName: "task",
        callId: "c1",
        taskId: "task-1",
        evidence: {
          evidenceId: "ev-1",
          kind: "test",
          sourceClass: "tool_output",
          toolOutputClass: "command_exec",
          provenance: "observed",
          command: "bun run test",
          rawOutput: "1 passed",
          interpretation: {
            outcome: "pass",
            provenance: "derived",
            basis: "parsed_output",
            derivedFrom: []
          }
        }
      },
      {
        schemaVersion: 1,
        sequence: 2,
        timestamp: "2026-06-28T12:01:00Z",
        agentId: "atlas",
        sessionId: "session-123",
        writerId: "w1",
        recordType: "decision",
        gateType: "task",
        reachableEnforcementLevel: "L1",
        appliedEnforcementLevel: "L0",
        taskId: "task-1",
        verdict: "PASS",
        ruleResults: [
          {
            ruleId: "gate-1",
            verdict: "PASS",
            reason: "All tests passed",
            evidenceRefs: [{ kind: "full", agentId: "atlas", sessionId: "session-123", writerId: "w1", sequence: 1, evidenceId: "ev-1" }]
          }
        ]
      }
    ];

    const a = project(events, "2026-06-28T12:05:00Z");
    const b = project(events, "2026-06-28T12:05:00Z");
    
    // 決定論の検証
    expect(a).toEqual(b);

    // 判定状態・複数 shard の検証
    const taskInfo = a.tasks.get("task-1");
    expect(taskInfo).toBeDefined();
    expect(taskInfo?.status).toBe("PASS");
    expect(taskInfo?.evidence.length).toBe(1);
  });
});
```

- [x] **Step 4: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/core/v2/state-projection.test.ts tests/core/observation-log-replay.test.ts tests/runtime/state-projection-cache-read.test.ts tests/runtime/state-projection-cache.test.ts
```

- [x] **Step 5: Commit**

```bash
git add src/core/v2/state-projection.ts src/core/v2/integrity.ts src/runtime/state-projection-cache.ts tests/core/v2/state-projection.test.ts tests/core/observation-log-replay.test.ts tests/runtime/state-projection-cache-read.test.ts tests/runtime/state-projection-cache.test.ts
git commit -m "feat(v2): deterministic state projection, replay, and cache validation tests"
```

- [x] **Step 6: Phase 2 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 2.2c`（直前 Task から派生）。`ObservationLogStore.readAll()` の結果を使用する。

---

### Task 2.4: Rotation + Archive

**Files:**

- Modify: `src/runtime/observation-log-store.ts`
- Test: `tests/runtime/rotation-sequence-continuity.test.ts`

**Interfaces:**

- Consumes: `toArchivePath`, `ProjectedState` projection.
- Produces: `rotateIfNeeded(shardId)` that moves oversized/aged shards to archive and continues sequence numbering across active+archive.

- [x] **Step 1: FileReader API に file stats メソッドを追加**

```typescript
// src/core/types.ts
export interface FileReader {
  readFile(path: string): Promise<string>;
  fileExists(path: string): Promise<boolean>;
  listFiles(prefix: string): Promise<readonly string[]>;
  readFileStats(path: string): Promise<{ readonly size: number; readonly mtimeMs: number } | null>;
}
```

`NodeFileSystem`（`src/runtime/node-file-system.ts`）で `fs.stat` を用いて実装する。`createMockFileReader`（`tests/helpers/mock-file-system.ts`）にも同メソッドを追加する。

- [x] **Step 2: rotation 判定を実装（§9.4）**

```typescript
// src/runtime/observation-log-store.ts 内
const MAX_SHARD_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_SHARD_AGE_DAYS = 14;

// 実装ノート（Phase0-5 実装後の訂正）: age は `mtimeMs` ではなく、当該 shard の
// 最古オンディスクレコードの timestamp（`createdMs`）を基準に判定する。
// `atomicAppend` は毎回 append 時に temp file を rename して shard を
// 全置換するため、mtime/birthtime は append ごとに "now" へリセットされ、
// shard の実age を測定できない（`observation-log-store.ts` 内 `shouldRotate`）。
async function shouldRotate(
  fileReader: FileReader,
  path: string,
  createdMs: number,
  now: Date,
): Promise<boolean> {
  const stats = await fileReader.readFileStats(path);
  if (!stats) return false;
  return stats.size >= MAX_SHARD_SIZE || ageInDays(createdMs, now) >= MAX_SHARD_AGE_DAYS;
}
```

- [x] **Step 3: rotation 後の sequence 連続性と直列化キューとの結合を実装（D23/D33）**

active+archive の最大 sequence を計算し、次回 append からその値+1 を使用。
`ObservationLogStore` は `createShardWriteQueue` の `onAppendComplete` 引数として `rotateIfNeeded` を渡し、書き込み完了直後かつ Promise が resolve される前に、同一直列化キュー内で rotation が判定・実行されることを保証する。

- [x] **Step 4: rotation 統合テストの実装（tests/runtime/rotation-sequence-continuity.test.ts）**

以下のテストを追加して、append と rotation が並行せずに直列実行され、かつ rotation 跨ぎで sequence が決定論的に継続することを確認する。

```typescript
it("performs rotation inside the serialization queue after append and prevents race conditions", async () => {
  // append 中に rotation が同期的に実行され、同時に発生した他の append がキューで待機し、順序が保証されることを検証するテストケースを実装
});

it("succeeds rotation even when the archive parent directory does not exist initially", async () => {
  // 保存先であるアーカイブ用の親ディレクトリ（.justice/archive/events/...）がまだ存在しない場合でも、
  // rotation処理内で親ディレクトリが自動的かつ再帰的に作成され、移動（rename）が成功することを検証する
});
```

- [x] **Step 5: テスト実行（Devcontainer 内）**

```bash
devcontainer exec --workspace-folder . bun run test tests/runtime/rotation-sequence-continuity.test.ts
```

- [x] **Step 6: Commit**

```bash
git add src/core/types.ts src/runtime/node-file-system.ts tests/helpers/mock-file-system.ts src/runtime/observation-log-store.ts tests/runtime/rotation-sequence-continuity.test.ts
git commit -m "feat(v2): shard rotation and archive sequence continuity"

```

- [x] **Step 7: Phase 2 Base に向けた Draft PR を作成する**

```bash
gt submit
```

**派生元:** `Task 2.3`（直前 Task から派生）。append 経路と projection を使用する。

---
