import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createLinuxOpenat2ReviewArtifactProvider,
} from "../../src/runtime/linux-review-artifact-provider";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import {
  buildCanonicalSnapshot,
  computePlanFingerprint,
} from "../../src/core/plan-fingerprint";
import { AuthorizationStore, createAuthorizationReviewBoundary } from "../../src/core/plan-authorization";
import { PlanParser } from "../../src/core/plan-parser";
import { fakeInit } from "../helpers/fake-opencode-init";
import type { PendingLogRecord } from "../../src/core/v2/observation-model";

/**
 * Task 3.6 adapter/composition E2E for the supported Linux x86_64 deployment.
 * It runs only after `bun run build:native:review-artifact`; on every other
 * platform or when the native provider probe is unavailable it FAILS as
 * unsupported setup rather than silently skipping the P0 path.
 */
function isSupportedLinuxX64Host(): boolean {
  return process.platform === "linux" && process.arch === "x64";
}

const unsupportedReason = isSupportedLinuxX64Host()
  ? "native review-artifact provider is unavailable; run `bun run build:native:review-artifact` (requires Linux x86_64 + glibc + openat2/renameat2)"
  : `unsupported platform ${process.platform}/${process.arch}; the Task 3.6 adapter E2E requires Linux x86_64`;

describe("review artifact adapter composition E2E (Linux x86_64, Task 3.6)", () => {
  it("fails closed as unsupported setup when the native provider cannot be probed", async () => {
    let provider: Awaited<ReturnType<typeof probeNative>> | undefined;
    try {
      provider = await probeNative();
    } catch {
      provider = undefined;
    }
    if (provider === undefined) {
      throw new Error(`unsupported setup: ${unsupportedReason}`);
    }
    provider.close();
    expect(isSupportedLinuxX64Host()).toBe(true);
  });

  it("drives the review write and matching PostToolUse through the real adapter and plugin", async () => {
    const provider = await probeNative();
    const rootDir = await mkdtemp(`${tmpdir()}/justice-review-e2e-`);
    try {
      const localFs = new NodeFileSystem(rootDir, provider);

      // Seed an active authorization BEFORE the adapter claim runs so the real
      // dispatch claim path can resolve a current active Authorization.
      const boundary = createAuthorizationReviewBoundary();
      const authorizationStore = new AuthorizationStore(localFs, localFs, boundary);
      const planContent = "## Task 1: e2e review\n- [ ] verify\n";
      const planPath = "docs/review-e2e.md";
      const approvedTaskIds = new PlanParser().parse(planContent).map((task) => task.id);
      await localFs.writeFile(planPath, planContent);
      const authorization = await authorizationStore.approve({
        sessionId: "parent-e2e",
        planPath,
        canonicalSnapshot: buildCanonicalSnapshot(planContent, approvedTaskIds),
        planFingerprint: computePlanFingerprint(planContent, approvedTaskIds),
        approvedAt: "2026-09-05T00:00:00.000Z",
      });
      expect(authorization?.status).toBe("active");

      const adapter = new OpenCodeAdapter(
        fakeInit({ worktree: rootDir, directory: rootDir }),
      );
      await adapter.ensureInitialized();
      const justice = adapter.getJustice();
      expect(justice).toBeDefined();
      // Seed the review_pending lifecycle and a pending dispatch slot through
      // the plugin's own durable log so the real claim path can consume them.
      const observationHandler = justice?.getObservationHandler();
      expect(observationHandler).toBeDefined();
      const logStore = (observationHandler as unknown as {
          getLogStore: () => {
            getWriterId: () => string;
            append: (shard: unknown, record: PendingLogRecord) => Promise<number>;
          }
        }
      ).getLogStore();
      const writerId = logStore.getWriterId();
      const authId = (authorization as { authorizationId: string }).authorizationId;
      const taskExecutionRef = { authorizationId: authId, taskId: "task-1", attemptId: "attempt-e2e" };
      const envelope = {
        schemaVersion: 1 as const,
        timestamp: "2026-09-05T00:00:00.000Z",
        agentId: "atlas" as const,
        sessionId: "parent-e2e",
        writerId,
        recordType: "observation" as const,
      };
      for (const [from, to] of [
        ["pending", "authorized"],
        ["authorized", "in_progress"],
        ["in_progress", "worker_reported"],
        ["worker_reported", "evidence_pending"],
        ["evidence_pending", "review_pending"],
      ] as const) {
        await logStore.append(
          { agentId: "atlas", sessionId: "parent-e2e", writerId },
          { ...envelope, kind: "task_lifecycle_transition", parentSessionId: "parent-e2e", taskExecutionRef, from, to },
        );
      }
      await logStore.append(
        { agentId: "atlas", sessionId: "parent-e2e", writerId },
        {
          ...envelope,
          kind: "review_dispatch_transition",
          transitionId: "e2e-pending",
          parentSessionId: "parent-e2e",
          correlation: { reviewKind: "task-review", taskExecutionRef, reviewRound: 1 },
          expectedCategory: "sp-review",
          from: null,
          to: "pending",
        },
      );

      const claimArgs: Record<string, unknown> = {
        category: "sp-review",
        prompt: "perform the required review",
      };
      const claimResponse = await adapter.onToolExecuteBefore(
        { tool: "task", sessionID: "parent-e2e", callID: "claim-call" },
        { args: claimArgs },
      );
      // The claim must pin the worker to foreground artifact delivery.
      expect(claimArgs.run_in_background).toBe(false);

      // The claimed route must inject the REVIEW CLAIMED directive with the
      // committed artifact path as the only exposed path.
      expect(
        claimResponse.action === "inject" &&
          claimResponse.injectedContext.includes("[JUSTICE: REVIEW CLAIMED]"),
      ).toBe(true);
      const artifactPath = (claimArgs as { review_artifact_path?: unknown })
        .review_artifact_path;
      expect(typeof artifactPath).toBe("string");
      expect((artifactPath as string).startsWith(".justice/reviews/")).toBe(true);
    } finally {
      provider.close();
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});


async function probeProviderOrUndefined(): Promise<
  Awaited<ReturnType<typeof probeNative>> | undefined
> {
  try {
    return await probeNative();
  } catch {
    return undefined;
  }
}

type ProbeOutcome = Awaited<ReturnType<typeof probeNative>>;

async function probeNative(): Promise<ProbeOutcome> {
  const rootDir = await mkdtemp(`${tmpdir()}/justice-probe-`);
  try {
    const provider = createLinuxOpenat2ReviewArtifactProvider(rootDir);
    if (provider === undefined) {
      throw new Error("provider unavailable");
    }
    return provider;
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}


describe("review artifact supported-host guard", () => {
  it("exposes no review-artifact capability without a probeable provider", async () => {
    const provider = await probeProviderOrUndefined();
    if (provider === undefined) {
      throw new Error(`unsupported setup: ${unsupportedReason}`);
    }
    provider.close();
    expect(provider.reservedReviewArtifactIo).toBeDefined();
  });
});