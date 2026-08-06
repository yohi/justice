// spikes/observation-latency/measure.ts
//
// Phase 4: hook 経路 end-to-end レイテンシ計測（設計書 §8.2）。
// `ObservationHandler.handlePostToolUse()` を起点とし、`ObservationLogStore.append()`
// から state projection までの実際の処理遅延を実ファイルシステム上で測定する。
// 旧来の `ObservationLogStore.append()` 直接呼出計測は primitive 参考値として残す。
//
// Run: bun run spikes/observation-latency/measure.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { StateProjectionCache } from "../../src/runtime/state-projection-cache";
import { FileGateLoader } from "../../src/runtime/gate-loader";
import type { PostToolUseEvent } from "../../src/core/types";
import type { PendingObservationRecord } from "../../src/core/v2/observation-model";

const WARM_UP = 5;
const HOOK_ITERATIONS = 100;
const PRIMITIVE_ITERATIONS = 100;
// MAX_SHARD_SIZE_BYTES の rotation 閾値直前で打ち止め（64KB 手前）
const SHARD_SIZES = [0, 1024, 100 * 1024, 1024 * 1024, 5 * 1024 * 1024 - 64 * 1024] as const;

function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function buildRecord(i: number, writerId = "w-spike"): PendingObservationRecord {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    agentId: "hephaestus",
    sessionId: "spike-session",
    writerId,
    recordType: "observation",
    kind: "tool_executed",
    toolName: "bun-test",
    callId: `call-${i}`,
    evidence: {
      evidenceId: `ev-${i}`,
      kind: "test",
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: "bun run test",
      rawOutput: "1 passed",
    },
  };
}

function buildHookEvent(i: number): PostToolUseEvent {
  return {
    type: "PostToolUse",
    sessionId: "spike-session",
    callId: `call-${i}`,
    payload: {
      toolName: "bash",
      callId: `call-${i}`,
      toolInput: { command: "bun run test" },
      toolResult: "1 passed",
    },
  };
}

function createHookPath(fs: NodeFileSystem, writerId: string) {
  const logStore = new ObservationLogStore(fs, fs, writerId);
  return {
    logStore,
    handler: new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      projectionCache: {
        write: (state) => new StateProjectionCache(fs, fs, ".justice/state.json", console).write(state),
      },
      writerId,
      logger: console,
      gateLoader: new FileGateLoader(fs, ".justice/gate.yaml", console),
    }),
  };
}

async function shardBytes(fs: NodeFileSystem): Promise<number> {
  let total = 0;
  for (const path of await fs.listFiles(".justice/events")) {
    total += (await fs.readFileStats(path))?.size ?? 0;
  }
  return total;
}

async function prefillShard(fs: NodeFileSystem, writerId: string, targetBytes: number) {
  const { logStore } = createHookPath(fs, writerId);
  const shardId = { agentId: "hephaestus" as const, sessionId: "spike-session", writerId };
  let i = 0;
  while ((await shardBytes(fs)) < targetBytes) {
    await logStore.append(shardId, buildRecord(i++, writerId));
  }
}

async function measurePrimitive(root: string) {
  const fs = new NodeFileSystem(root);
  const store = new ObservationLogStore(fs, fs, "w-spike");
  const shardId = { agentId: "hephaestus" as const, sessionId: "spike-session", writerId: "w-spike" };

  const samples: number[] = [];
  for (let i = 0; i < PRIMITIVE_ITERATIONS; i++) {
    const record = buildRecord(i);
    const start = performance.now();
    await store.append(shardId, record);
    samples.push(performance.now() - start);
  }
  return { samples };
}

async function measureSameShard(root: string, prefill: number) {
  const fs = new NodeFileSystem(root);
  const writerId = "w-spike";
  await prefillShard(fs, writerId, prefill);
  const { handler } = createHookPath(fs, writerId);
  const recordSize = JSON.stringify(buildHookEvent(0)).length;

  for (let i = 0; i < WARM_UP; i++) await handler.handlePostToolUse(buildHookEvent(i));
  const samples: number[] = [];
  for (let i = 0; i < HOOK_ITERATIONS; i++) {
    const start = performance.now();
    // eslint-disable-next-line no-await-in-loop -- intentional: same-shard serialized measurement
    await handler.handlePostToolUse(buildHookEvent(WARM_UP + i));
    samples.push(performance.now() - start);
  }
  return { samples, recordSize };
}

async function measureMultiShard(root: string, prefill: number, writers: number) {
  const fs = new NodeFileSystem(root);
  const writerIds = Array.from({ length: writers }, (_, i) => `w-spike-${i}`);
  for (const writerId of writerIds) await prefillShard(fs, writerId, prefill);
  const handlers = writerIds.map((writerId) => createHookPath(fs, writerId).handler);
  const samples: number[] = [];
  for (let cycle = 0; cycle < HOOK_ITERATIONS; cycle++) {
    await Promise.all(
      handlers.map(async (handler, w) => {
        const start = performance.now();
        await handler.handlePostToolUse(buildHookEvent(cycle * writers + w));
        samples.push(performance.now() - start);
      }),
    );
  }
  return { samples };
}

function summarize(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const histogram: Record<string, number> = {};
  for (const s of sorted) {
    const bucket = `${Math.floor(s / 10) * 10}`;
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    samples: sorted,
    histogram,
  };
}

async function measureColdCache(root: string, prefill: number) {
  const fs = new NodeFileSystem(root);
  const writerId = "w-spike";
  await prefillShard(fs, writerId, prefill);
  // 新しい fs/store/handler インスタンスで contents キャッシュを冷やす
  const coldFs = new NodeFileSystem(root);
  const { handler } = createHookPath(coldFs, writerId);
  const start = performance.now();
  await handler.handlePostToolUse(buildHookEvent(0));
  return performance.now() - start;
}

async function main(): Promise<void> {
  const results: Record<string, unknown> = {
    measuredAt: new Date().toISOString(),
    environment: {
      os: process.platform,
      arch: process.arch,
      bunVersion: (Bun as { version?: string }).version ?? "unknown",
    },
    protocol: {
      toolName: "bash",
      toolInput: { command: "bun run test" },
      toolResult: "1 passed",
      warmUp: WARM_UP,
      hookIterations: HOOK_ITERATIONS,
      primitiveIterations: PRIMITIVE_ITERATIONS,
      percentileMethod: "nearest-rank",
    },
    conditions: [] as unknown[],
  };
  const conditions = results.conditions as unknown[];

  // primitive 参考値
  {
    const root = await mkdtemp(join(tmpdir(), "justice-latency-primitive-"));
    try {
      const { samples } = await measurePrimitive(root);
      conditions.push({
        name: "primitive append only",
        shardPreFillBytes: 0,
        writers: 1,
        ...summarize(samples),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  for (const size of SHARD_SIZES) {
    const root = await mkdtemp(join(tmpdir(), "justice-latency-hook-"));
    try {
      const { samples, recordSize } = await measureSameShard(root, size);
      conditions.push({
        name: "hook-path same-shard",
        shardPreFillBytes: size,
        writers: 1,
        recordSizeBytes: recordSize,
        ...summarize(samples),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  {
    const root = await mkdtemp(join(tmpdir(), "justice-latency-hook-multi-"));
    try {
      const { samples } = await measureMultiShard(root, 0, 4);
      conditions.push({
        name: "hook-path multi-shard",
        shardPreFillBytes: 0,
        writers: 4,
        ...summarize(samples),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  // 冷キャッシュ条件（5MB prefill + 新規インスタンス）
  {
    const root = await mkdtemp(join(tmpdir(), "justice-latency-cold-cache-"));
    try {
      const coldMs = await measureColdCache(root, 5 * 1024 * 1024 - 64 * 1024);
      conditions.push({
        name: "hook-path cold-cache first append",
        shardPreFillBytes: 5 * 1024 * 1024 - 64 * 1024,
        writers: 1,
        coldCacheFirstAppendMs: coldMs,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const reportPath = "docs/reports/2026-07-31-v2-latency-measurement.json";
  await writeFile(reportPath, JSON.stringify(results, null, 2));

  for (const c of conditions as { name: string; shardPreFillBytes?: number; p50?: number; p95?: number; p99?: number; coldCacheFirstAppendMs?: number }[]) {
    if (c.coldCacheFirstAppendMs !== undefined) {
      console.log(`${c.name} prefill=${c.shardPreFillBytes}: firstAppend=${c.coldCacheFirstAppendMs.toFixed(3)}ms`);
    } else {
      console.log(
        `${c.name} prefill=${c.shardPreFillBytes ?? 0}: n=${(c as { n: number }).n} p50=${c.p50?.toFixed(3) ?? "n/a"}ms p95=${c.p95?.toFixed(3) ?? "n/a"}ms p99=${c.p99?.toFixed(3) ?? "n/a"}ms`,
      );
    }
  }
  console.log(`Report written to ${reportPath}`);
}

void main();
