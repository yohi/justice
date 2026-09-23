import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthorizationStore, createAuthorizationReviewBoundary } from "../../src/core/plan-authorization";
import { buildCanonicalSnapshot, computePlanFingerprint } from "../../src/core/plan-fingerprint";
import { PlanParser } from "../../src/core/plan-parser";
import type { ReservedReviewArtifactIo } from "../../src/core/types";
import type { PendingLogRecord, PersistedLogRecord } from "../../src/core/v2/observation-model";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

type ReviewCategory = "sp-review" | "sp-final-review";
type RuntimeJustice = {
  readonly options: { readonly reservedReviewArtifactIo?: ReservedReviewArtifactIo };
  readonly getObservationHandler: () => {
    readonly getLogStore: () => {
      readonly getWriterId: () => string;
      readonly append: (shard: unknown, record: PendingLogRecord) => Promise<number>;
      readonly readAll: () => Promise<readonly PersistedLogRecord[]>;
    };
  };
};

type AdapterReviewFixture = {
  readonly rootDir: string;
  readonly adapter: OpenCodeAdapter;
  readonly artifactIo: ReservedReviewArtifactIo;
  readonly category: ReviewCategory;
  readonly parentSessionId: string;
  readonly childSessionId: string;
  readonly callId: string;
  readonly claimArgs: Record<string, unknown>;
  readonly artifactPath: string;
  readonly gateObservedTerminal: ReturnType<typeof vi.fn>;
  readonly records: () => Promise<readonly PersistedLogRecord[]>;
};

const REVIEW_ARTIFACT_JSON = JSON.stringify({ schemaVersion: 1, complete: true, findings: [] });

function unsupportedSetup(message: string): Error {
  return new Error(`unsupported setup: ${message}`);
}

async function arrangeClaimedReview(category: ReviewCategory): Promise<AdapterReviewFixture> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw unsupportedSetup(`the adapter E2E requires Linux x86_64, found ${process.platform}/${process.arch}`);
  }

  const rootDir = await mkdtemp(`${tmpdir()}/justice-review-e2e-`);
  const localFs = new NodeFileSystem(rootDir);
  const parentSessionId = `parent-${category}`;
  const childSessionId = `child-${category}`;
  const callId = `claim-${category}`;
  const planPath = "docs/review-e2e.md";
  const planContent = "## Task 1: e2e review\n- [ ] verify\n";
  const approvedTaskIds = new PlanParser().parse(planContent).map((task) => task.id);
  await localFs.writeFile(planPath, planContent);
  const authorization = await new AuthorizationStore(
    localFs,
    localFs,
    createAuthorizationReviewBoundary(),
  ).approve({
    sessionId: parentSessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, approvedTaskIds),
    planFingerprint: computePlanFingerprint(planContent, approvedTaskIds),
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (authorization === null || authorization.status !== "active") {
    throw new Error("adapter E2E fixture could not seed an active Authorization");
  }

  const adapter = new OpenCodeAdapter(fakeInit({ worktree: rootDir, directory: rootDir }));
  await adapter.ensureInitialized();
  const justice = adapter.getJustice();
  const artifactIo = (justice as unknown as RuntimeJustice | null)?.options.reservedReviewArtifactIo;
  if (justice === null || artifactIo === undefined) {
    await rm(rootDir, { recursive: true, force: true });
    throw unsupportedSetup(
      "native review-artifact provider is unavailable; run `bun run build:native:review-artifact` on Linux x86_64 with glibc, openat2, and renameat2",
    );
  }

  const logStore = (justice as unknown as RuntimeJustice).getObservationHandler().getLogStore();
  const writerId = logStore.getWriterId();
  const envelope = {
    schemaVersion: 1 as const,
    timestamp: "2026-09-05T00:00:00.000Z",
    agentId: "atlas" as const,
    sessionId: parentSessionId,
    writerId,
    recordType: "observation" as const,
  };
  const taskExecutionRef = {
    authorizationId: authorization.authorizationId,
    taskId: "task-1",
    attemptId: "attempt-e2e",
  };
  const correlation =
    category === "sp-review"
      ? { reviewKind: "task-review" as const, taskExecutionRef, reviewRound: 1 }
      : {
          reviewKind: "final-review" as const,
          planPath,
          authorizationId: authorization.authorizationId,
          planFingerprint: authorization.planFingerprint,
          finalizationAttemptId: "finalization-e2e",
          finalReviewRound: 1,
        };
  const append = (record: PendingLogRecord): Promise<number> =>
    logStore.append({ agentId: record.agentId, sessionId: record.sessionId, writerId: record.writerId }, record);
  const gateObservedTerminal = vi.fn();
  vi.spyOn(justice.getObservationHandler(), "evaluateGatePendingAttemptWithinAuthorizationReviewBoundary")
    .mockImplementation(async (context) => {
      const beforeGate = await logStore.readAll();
      gateObservedTerminal(
        beforeGate.some(
          (record) => record.recordType === "observation" && record.kind === "review_dispatch_transition" && record.to === "terminal",
        ),
      );
      const identity = context.scope === "task"
        ? { gateType: "task" as const, taskId: context.taskExecutionRef.taskId, taskExecutionRef: context.taskExecutionRef }
        : {
            gateType: "plan" as const,
            authorizationId: context.authorizationId,
            planPath: context.planPath,
            finalizationAttemptId: context.finalizationAttemptId,
            finalReviewRound: context.finalReviewRound,
          };
      const decision = {
        ...envelope,
        timestamp: new Date().toISOString(),
        agentId: context.agentId,
        sessionId: context.sessionId,
        writerId: context.writerId,
        recordType: "decision" as const,
        ...identity,
        verdict: "PASS" as const,
        reachableEnforcementLevel: "L1" as const,
        appliedEnforcementLevel: "L0" as const,
        ruleResults: [],
      };
      await append(decision);
      const acceptance: PendingLogRecord = context.scope === "task"
        ? { ...envelope, timestamp: decision.timestamp, agentId: context.agentId, sessionId: context.sessionId, writerId: context.writerId, recordType: "decision", kind: "task-acceptance", taskId: context.taskExecutionRef.taskId, taskExecutionRef: context.taskExecutionRef, verdict: "accepted" }
        : { ...envelope, timestamp: decision.timestamp, agentId: context.agentId, sessionId: context.sessionId, writerId: context.writerId, recordType: "decision", kind: "plan-acceptance", authorizationId: context.authorizationId, planPath: context.planPath, finalizationAttemptId: context.finalizationAttemptId, finalReviewRound: context.finalReviewRound, verdict: "complete" };
      await append(acceptance);
      return { kind: "decided", decision };
    });

  if (category === "sp-review") {
    for (const [from, to] of [
      ["pending", "authorized"],
      ["authorized", "in_progress"],
      ["in_progress", "worker_reported"],
      ["worker_reported", "evidence_pending"],
      ["evidence_pending", "review_pending"],
    ] as const) {
      await append({ ...envelope, kind: "task_lifecycle_transition", parentSessionId, taskExecutionRef, from, to });
    }
  } else {
    await append({
      ...envelope,
      kind: "plan_finalization_transition",
      parentSessionId,
      authorizationId: authorization.authorizationId,
      planPath,
      finalizationAttemptId: "finalization-e2e",
      finalReviewRound: 1,
      from: "tasks_pending",
      to: "all_tasks_accepted",
    });
    await append({
      ...envelope,
      kind: "plan_finalization_transition",
      parentSessionId,
      authorizationId: authorization.authorizationId,
      planPath,
      finalizationAttemptId: "finalization-e2e",
      finalReviewRound: 1,
      from: "all_tasks_accepted",
      to: "final_review_pending",
    });
  }
  await append({
    ...envelope,
    kind: "review_dispatch_transition",
    transitionId: `pending-${category}`,
    parentSessionId,
    correlation,
    expectedCategory: category,
    from: null,
    to: "pending",
  });

  const claimArgs: Record<string, unknown> = { category, prompt: "perform the required review" };
  const claim = await adapter.onToolExecuteBefore(
    { tool: "task", sessionID: parentSessionId, callID: callId },
    { args: claimArgs },
  );
  if (claim.action !== "inject" || !claim.injectedContext.includes("[JUSTICE: REVIEW CLAIMED]")) {
    throw new Error("adapter E2E fixture could not claim the mandatory review");
  }
  const artifactPath = claimArgs.review_artifact_path;
  if (typeof artifactPath !== "string") throw new Error("review claim omitted its artifact path");

  await append({
    ...envelope,
    kind: "delegated_execution_binding",
    relation: {
      kind: "delegated_execution_relation_observed",
      provenance: "observed",
      runtimeEventId: `execution-${category}`,
      parentSessionId,
      parentCallId: callId,
      childSessionId,
      category,
    },
    binding: {
      relationId: `execution-${category}`,
      parentSessionId,
      parentCallId: callId,
      childSessionId,
      scope:
        correlation.reviewKind === "task-review"
          ? { kind: "task", taskExecutionRef, reviewRound: correlation.reviewRound }
          : {
              kind: "finalization",
              authorizationId: authorization.authorizationId,
              planPath,
              planFingerprint: authorization.planFingerprint,
              finalizationAttemptId: correlation.finalizationAttemptId,
              finalReviewRound: correlation.finalReviewRound,
            },
      correlation,
    },
  });

  return {
    rootDir,
    adapter,
    artifactIo,
    category,
    parentSessionId,
    childSessionId,
    callId,
    claimArgs,
    artifactPath,
    gateObservedTerminal,
    records: () => logStore.readAll(),
  };
}

async function completeReview(fixture: AdapterReviewFixture): Promise<void> {
  const writeExisting = vi.spyOn(fixture.artifactIo, "writeExisting");
  const originalReadOnce = fixture.artifactIo.readOnce.bind(fixture.artifactIo);
  const readOnce = vi.spyOn(fixture.artifactIo, "readOnce");
  const genericWriter = vi.spyOn(NodeFileSystem.prototype, "writeFile");
  const writeResponse = await fixture.adapter.onToolExecuteBefore(
    { tool: "write", sessionID: fixture.childSessionId, callID: `write-${fixture.category}` },
    { args: { filePath: fixture.artifactPath, content: REVIEW_ARTIFACT_JSON } },
  );
  expect(writeResponse).toEqual({ action: "skip", reason: "review_artifact_write_committed" });
  expect(writeExisting).toHaveBeenCalledTimes(1);
  expect(genericWriter.mock.calls.some(([path]) => path === fixture.artifactPath)).toBe(false);

  readOnce.mockImplementation(async (reservation) => {
    const content = await originalReadOnce(reservation);
    const replacement = join(fixture.rootDir, "replacement-after-read.json");
    await writeFile(replacement, "replacement artifact", "utf8");
    await rename(replacement, join(fixture.rootDir, reservation.artifactPath));
    return content;
  });
  await fixture.adapter.onToolExecuteAfter(
    { tool: "task", sessionID: fixture.parentSessionId, callID: "stale-review-call", args: fixture.claimArgs },
    { output: "stale parent completion" },
  );
  expect(
    (await fixture.records()).some(
      (record) =>
        record.recordType === "observation" &&
        record.kind === "review_dispatch_transition" &&
        record.to === "terminal",
    ),
  ).toBe(false);

  await fixture.adapter.onToolExecuteAfter(
    { tool: "task", sessionID: fixture.parentSessionId, callID: fixture.callId, args: fixture.claimArgs },
    { output: "review complete" },
  );
  expect(readOnce).toHaveBeenCalledTimes(1);
  expect(fixture.gateObservedTerminal).toHaveBeenCalledWith(true);
  expect(genericWriter.mock.calls.some(([path]) => path === fixture.artifactPath)).toBe(false);
  const records = await fixture.records();
  const terminalIndex = records.findIndex(
    (record) =>
      record.recordType === "observation" &&
      record.kind === "review_dispatch_transition" &&
      record.to === "terminal",
  );
  expect(terminalIndex).toBeGreaterThanOrEqual(0);
  expect(records.slice(terminalIndex + 1).some((record) => record.recordType === "decision"),
    records.map((record) => record.recordType === "observation" ? record.kind === "review_dispatch_transition" && record.to === "terminal" ? `${record.kind}:${record.terminalReason}` : record.kind : "gateType" in record ? record.gateType : record.kind).join(","),
  ).toBe(true);
  expect(
    records.some(
      (record) =>
        record.recordType === "observation" &&
        record.kind === "review_artifact_cleanup" &&
        record.phase === "finished" &&
        record.status === "replacement_retained",
    ),
  ).toBe(true);
  expect(
    records.some(
      (record) =>
        record.recordType === "observation" &&
        record.kind === "session_error" &&
        record.message === "review_artifact_identity_mismatch",
    ),
  ).toBe(true);
  await fixture.adapter.onToolExecuteAfter(
    { tool: "task", sessionID: fixture.parentSessionId, callID: fixture.callId, args: fixture.claimArgs },
    { output: "duplicate completion" },
  );
  expect(readOnce).toHaveBeenCalledTimes(1);
  genericWriter.mockRestore();
}

async function rejectChangedArtifactBeforeParsing(
  category: ReviewCategory,
  change: "symlink" | "replacement",
): Promise<void> {
  const fixture = await arrangeClaimedReview(category);
  try {
    const readOnce = vi.spyOn(fixture.artifactIo, "readOnce");
    const target = join(fixture.rootDir, "outside-target.json");
    await writeFile(target, "outside target", "utf8");
    const artifact = join(fixture.rootDir, fixture.artifactPath);
    if (change === "symlink") {
      await rm(artifact, { force: true });
      await symlink(target, artifact);
    } else {
      const replacement = join(fixture.rootDir, "replacement.json");
      await writeFile(replacement, "replacement", "utf8");
      await rename(replacement, artifact);
    }
    const response = await fixture.adapter.onToolExecuteBefore(
      { tool: "write", sessionID: fixture.childSessionId, callID: `${change}-${category}` },
      { args: { filePath: fixture.artifactPath, content: REVIEW_ARTIFACT_JSON } },
    );
    expect(response).toEqual({ action: "skip", reason: "review_artifact_write_rejected" });
    expect(readOnce).not.toHaveBeenCalled();
    expect(await readFile(target, "utf8")).toBe("outside target");
    expect(
      (await fixture.records()).some(
        (record) => record.recordType === "observation" && record.kind === "review_completion_staged",
      ),
    ).toBe(false);
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
}

describe("review artifact adapter composition E2E (Linux x86_64, Task 3.6)", () => {
  it.each(["sp-review", "sp-final-review"] as const)(
    "completes %s through claim, child write, parent PostToolUse, decisions, and replacement-retaining cleanup",
    async (category) => {
      const fixture = await arrangeClaimedReview(category);
      try {
        expect(fixture.claimArgs.run_in_background).toBe(false);
        expect(fixture.artifactPath.startsWith(".justice/reviews/")).toBe(true);
        await completeReview(fixture);
      } finally {
        await rm(fixture.rootDir, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["sp-review", "symlink"],
    ["sp-review", "replacement"],
    ["sp-final-review", "symlink"],
    ["sp-final-review", "replacement"],
  ] as const)("rejects %s %s artifacts before JSON parsing", rejectChangedArtifactBeforeParsing);

  it.each(["sp-review", "sp-final-review"] as const)(
    "does not promote %s worker JSON carrying a stale review round into durable identity",
    async (category) => {
      const fixture = await arrangeClaimedReview(category);
      try {
        const slot = (await fixture.records()).find(
          (record) =>
            record.recordType === "observation" &&
            record.kind === "review_dispatch_transition" &&
            record.to === "claimed",
        );
        if (slot?.recordType !== "observation" || slot.kind !== "review_dispatch_transition" || slot.to !== "claimed") {
          throw new Error("claimed review is missing from the durable log");
        }
        const stale = slot.correlation.reviewKind === "task-review"
          ? { ...slot.correlation, reviewRound: slot.correlation.reviewRound + 1 }
          : { ...slot.correlation, finalReviewRound: slot.correlation.finalReviewRound + 1 };
        const write = await fixture.adapter.onToolExecuteBefore(
          { tool: "write", sessionID: fixture.childSessionId, callID: "stale-round-write" },
          { args: { filePath: fixture.artifactPath, content: JSON.stringify({ schemaVersion: 1, reviewKind: stale.reviewKind, reviewSource: category, correlation: stale, complete: true, findings: [] }) } },
        );
        expect(write).toEqual({ action: "skip", reason: "review_artifact_write_committed" });
        await fixture.adapter.onToolExecuteAfter(
          { tool: "task", sessionID: fixture.parentSessionId, callID: fixture.callId, args: fixture.claimArgs },
          { output: "stale review round" },
        );
        const records = await fixture.records();
        expect(records.some((record) => record.recordType === "decision")).toBe(true);
        expect(records.some((record) =>
          record.recordType === "observation" &&
          record.kind === "review_completion_staged" &&
          JSON.stringify(record.staging.correlation) === JSON.stringify(slot.correlation) &&
          JSON.stringify(record.staging.reviewArtifact.correlation) !== JSON.stringify(stale),
        )).toBe(true);
      } finally {
        await rm(fixture.rootDir, { recursive: true, force: true });
      }
    },
  );
});
