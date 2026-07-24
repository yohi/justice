// spikes/observation-latency/measure.ts
//
// Phase 0 / Task 0.2 Step 1 spike: "全ツール tool.execute.after 観測レイテンシ実測"
// (docs/superpowers/plans/2026-06-26-justice-v2-foundation-01-phase0-spikes.md)
//
// Scope note (honest limitation): Phase 4 (observation-handler) — the code that will actually
// call `ObservationLogStore.append()` from `tool.execute.after` for every observed tool — does
// not exist yet (see docs/superpowers/spikes/2026-06-26-v2-phase0-spikes.md for the full
// discussion). This script therefore measures the latency of the persistence primitive that
// Phase 4 will invoke on every tool call (`ObservationLogStore.append()`, backed by a real
// filesystem via `NodeFileSystem`, not a mock), which is the dominant cost in the eventual
// per-tool-call path (atomic temp-file-write + rename, per-shard serialized). It does NOT
// measure a live OpenCode `tool.execute.after` invocation end-to-end, since that hook does not
// yet call any v2 code (§3 in the spike results doc).
//
// Run: bun run spikes/observation-latency/measure.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import type { PendingObservationRecord } from "../../src/core/v2/observation-model";

const ITERATIONS = 100;

function percentile(sorted: readonly number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function buildRecord(i: number): PendingObservationRecord {
  return {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    agentId: "hephaestus",
    sessionId: "spike-session",
    writerId: "w-spike",
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

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "justice-latency-spike-"));
  try {
    const fs = new NodeFileSystem(root);
    const store = new ObservationLogStore(fs, fs, "w-spike");
    const shardId = { agentId: "hephaestus" as const, sessionId: "spike-session", writerId: "w-spike" };

    const samples: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const record = buildRecord(i);
      const start = performance.now();
      // eslint-disable-next-line no-await-in-loop -- intentional: same-shard appends must be
      // measured sequentially because createShardWriteQueue serializes them anyway (D23/D30).
      await store.append(shardId, record);
      samples.push(performance.now() - start);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = percentile(sorted, 50);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

    console.log(`ObservationLogStore.append() latency over ${ITERATIONS} sequential same-shard appends (real filesystem, temp dir):`);
    console.log(`  mean: ${mean.toFixed(3)}ms`);
    console.log(`  p50:  ${p50.toFixed(3)}ms`);
    console.log(`  p95:  ${p95.toFixed(3)}ms`);
    console.log(`  p99:  ${p99.toFixed(3)}ms`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

void main();
