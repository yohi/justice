import { describe, expect, it, vi } from "vitest";
import { bindObservedChild } from "../../src/hooks/observation-handler";
import { ObservationHandler } from "../../src/hooks/observation-handler";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import { project } from "../../src/core/v2/state-projection";
import { createMemFs } from "../helpers/mock-file-system";
import type {
  DelegatedExecutionRelationObserved,
  ReviewTaskCallBinding,
} from "../../src/core/types";

const taskClaim: ReviewTaskCallBinding = {
  purpose: "task_review",
  parentSessionId: "parent-session",
  callId: "parent-call",
  expectedCategory: "sp-review",
  correlation: {
    reviewKind: "task-review",
    taskExecutionRef: {
      authorizationId: "auth-1",
      taskId: "task-1",
      attemptId: "attempt-1",
    },
    reviewRound: 1,
  },
  artifactReservation: { status: "unusable", reason: "artifact_storage_unavailable" },
};

const finalClaim: ReviewTaskCallBinding = {
  ...taskClaim,
  purpose: "final_review",
  expectedCategory: "sp-final-review",
  correlation: {
    reviewKind: "final-review",
    planPath: "plan.md",
    authorizationId: "auth-1",
    planFingerprint: { algorithm: "sha256", value: "fingerprint" },
    finalizationAttemptId: "final-1",
    finalReviewRound: 1,
  },
};

const childRelation: DelegatedExecutionRelationObserved = {
  kind: "delegated_execution_relation_observed",
  provenance: "observed",
  runtimeEventId: "runtime-event-1",
  parentSessionId: "parent-session",
  parentCallId: "parent-call",
  childSessionId: "child-session",
  category: "sp-review",
};

describe("ObservationHandler delegated child binding", () => {
  it("appends a binding only for the current claimed slot and ignores duplicates", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const sessionStateProvider = new SessionStateProvider();
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider,
      writerId: "w-1",
    });
    const envelope = {
      schemaVersion: 1 as const,
      timestamp: "2026-09-22T00:00:00.000Z",
      agentId: "atlas" as const,
      sessionId: "parent-session",
      writerId: "w-1",
      recordType: "observation" as const,
    };
    const pending = {
      ...envelope,
      kind: "review_dispatch_transition" as const,
      transitionId: "pending-1",
      parentSessionId: "parent-session",
      correlation: taskClaim.correlation,
      expectedCategory: "sp-review" as const,
      from: null,
      to: "pending" as const,
    };
    const claimed = {
      ...pending,
      transitionId: "claimed-1",
      from: "pending" as const,
      to: "claimed" as const,
      callId: "parent-call",
      artifactReservation: taskClaim.artifactReservation,
    };
    await logStore.append(
      { agentId: "atlas", sessionId: "parent-session", writerId: "w-1" },
      pending,
    );
    await logStore.append(
      { agentId: "atlas", sessionId: "parent-session", writerId: "w-1" },
      claimed,
    );
    expect(project(await logStore.readAll(), "2026-09-22T00:00:00.500Z").taskCallBindings).toHaveLength(1);

    const countBeforeBinding = (await logStore.readAll()).length;
    await handler.handleDelegatedExecutionRelation({
      ...childRelation,
      parentCallId: "unknown-call",
    });
    expect((await logStore.readAll()).length).toBe(countBeforeBinding);

    const originalAppend = logStore.append.bind(logStore);
    let releaseFirstAppend: () => void = () => undefined;
    const firstAppendReleased = new Promise<void>((resolve) => {
      releaseFirstAppend = resolve;
    });
    let bindingAppends = 0;
    const appendSpy = vi.spyOn(logStore, "append").mockImplementation(async (shardId, record) => {
      if (record.recordType === "observation" && record.kind === "delegated_execution_binding") {
        bindingAppends += 1;
        if (bindingAppends === 1) {
          setTimeout(releaseFirstAppend, 0);
          await firstAppendReleased;
        }
      }
      return originalAppend(shardId, record);
    });
    await Promise.all([
      handler.handleDelegatedExecutionRelation(childRelation),
      handler.handleDelegatedExecutionRelation(childRelation),
    ]);
    appendSpy.mockRestore();
    expect(bindingAppends).toBe(1);
    const countAfterFirstAppend = (await logStore.readAll()).length;
    expect(countAfterFirstAppend).toBe(countBeforeBinding + 1);
    const firstProjection = project(await logStore.readAll(), "2026-09-22T00:00:01.000Z");
    expect(firstProjection.delegatedExecutionBindings).toMatchObject([
      { parentCallId: "parent-call", childSessionId: "child-session", scope: { kind: "task" } },
    ]);
    await handler.handleDelegatedExecutionRelation(childRelation);
    expect((await logStore.readAll()).length).toBe(countAfterFirstAppend);
    await handler.handleDelegatedExecutionRelation({
      ...childRelation,
      runtimeEventId: "runtime-event-stale",
      childSessionId: "stale-child",
    });
    expect((await logStore.readAll()).length).toBe(countAfterFirstAppend);
  });

  it("derives task and finalization scopes from the trusted claimed correlation", () => {
    expect(bindObservedChild(taskClaim, childRelation)).toMatchObject({
      kind: "bound",
      binding: { scope: { kind: "task" } },
    });
    expect(bindObservedChild(finalClaim, { ...childRelation, category: "sp-final-review" })).toMatchObject({
      kind: "bound",
      binding: { scope: { kind: "finalization" } },
    });
  });

  it.each([
    { ...childRelation, parentCallId: "unknown-call" },
    { ...childRelation, parentSessionId: "stale-parent" },
  ])("rejects an untrusted child relation", (relation) => {
    expect(bindObservedChild(taskClaim, relation)).toEqual({ kind: "stale" });
  });

  it("omits taskId when it persists a finalization binding", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-1",
    });
    const envelope = {
      schemaVersion: 1 as const,
      timestamp: "2026-09-22T00:00:00.000Z",
      agentId: "atlas" as const,
      sessionId: "parent-session",
      writerId: "w-1",
      recordType: "observation" as const,
    };
    const pending = {
      ...envelope,
      kind: "review_dispatch_transition" as const,
      transitionId: "final-pending-1",
      parentSessionId: "parent-session",
      correlation: finalClaim.correlation,
      expectedCategory: "sp-final-review" as const,
      from: null,
      to: "pending" as const,
    };
    const claimed = {
      ...pending,
      transitionId: "final-claimed-1",
      from: "pending" as const,
      to: "claimed" as const,
      callId: "parent-call",
      artifactReservation: finalClaim.artifactReservation,
    };
    await logStore.append(
      { agentId: "atlas", sessionId: "parent-session", writerId: "w-1" },
      pending,
    );
    await logStore.append(
      { agentId: "atlas", sessionId: "parent-session", writerId: "w-1" },
      claimed,
    );

    const response = await handler.handleDelegatedExecutionRelation({
      ...childRelation,
      category: "sp-final-review",
      runtimeEventId: "runtime-final-review",
    });

    expect(response).toEqual({ action: "proceed" });
    const binding = (await logStore.readAll()).find(
      (record) => record.recordType === "observation" && record.kind === "delegated_execution_binding",
    );
    expect(binding).toBeDefined();
    expect(binding).not.toHaveProperty("taskId");
  });

  it("fails open when reading delegated relation records fails", async () => {
    const { reader, writer } = createMemFs();
    const logStore = new ObservationLogStore(writer, reader, "w-1");
    const logger = { warn: vi.fn() };
    vi.spyOn(logStore, "readAll").mockRejectedValue(new Error("read failed"));
    const handler = new ObservationHandler({
      logStore,
      sessionStateProvider: new SessionStateProvider(),
      writerId: "w-1",
      logger,
    });

    await expect(handler.handleDelegatedExecutionRelation(childRelation)).resolves.toEqual({
      action: "proceed",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "observation-handler: delegated execution binding failed, degrading to PROCEED",
      expect.any(Error),
    );
  });
});
