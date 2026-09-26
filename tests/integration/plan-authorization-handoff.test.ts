import { describe, expect, it, vi } from "vitest";
import { JusticePlugin } from "../../src/core/justice-plugin";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";
import type { HookResponse } from "../../src/core/types";
import type { PersistedLogRecord } from "../../src/core/v2/observation-model";
import { createMockFileSystem, type MockFileSystem } from "../helpers/mock-file-system";

const plan = "## Task 1: Implement\n- [ ] first\n\n## Task 2: Integrate\n- [ ] second\n";

function fixture(): { readonly files: MockFileSystem; readonly plugin: JusticePlugin } {
  const files = createMockFileSystem({ "plan.md": plan });
  const plugin = new JusticePlugin(files, files);
  return { files, plugin };
}

async function approve(plugin: JusticePlugin): Promise<void> {
  const result = await plugin.getPlanBridge().handleImplementationArm("s-1", {
    source: "command",
    planPath: "plan.md",
    approved: true,
  });
  expect(result.armed).toBe(true);
}

async function invoke(plugin: JusticePlugin, callId: string, taskId?: string): Promise<HookResponse> {
  return plugin.handleEvent({
    type: "PreToolUse",
    sessionId: "s-1",
    callId,
    payload: { toolName: "task", toolInput: { prompt: "implement", ...(taskId ? { task_id: taskId } : {}) } },
  });
}

async function transitions(plugin: JusticePlugin): Promise<readonly Extract<PersistedLogRecord, { kind: "task_lifecycle_transition" }>[]> {
  return (await plugin.getObservationHandler().getLogStore().readAll()).filter(
    (record): record is Extract<PersistedLogRecord, { kind: "task_lifecycle_transition" }> =>
      record.recordType === "observation" && record.kind === "task_lifecycle_transition",
  );
}

describe("plan-scoped implementation handoff", () => {
  it("records and reviews the selected task when task_id was omitted", async () => {
    const { plugin } = fixture();
    await approve(plugin);

    const pre = await invoke(plugin, "call-1");
    expect(pre).toMatchObject({ action: "inject", modifiedPayload: { args: { task_id: "task-1" } } });
    await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "s-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { task_id: "task-1" }, toolResult: "done", error: false },
    });

    await expect(transitions(plugin)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ from: "evidence_pending", to: "review_pending" })]),
    );
  });

  it("does not start an attempt for an unapproved task even when task_id is supplied", async () => {
    const { plugin } = fixture();
    await invoke(plugin, "call-1", "task-1");
    expect(await transitions(plugin)).toEqual([]);
  });

  it("does not start an attempt after the approved plan changes", async () => {
    const { files, plugin } = fixture();
    await approve(plugin);
    await files.writeFile("plan.md", plan.replace("first", "changed"));
    await invoke(plugin, "call-1", "task-1");
    expect(await transitions(plugin)).toEqual([]);
  });

  it("does not start an attempt when the caller supplies a different task ID", async () => {
    const { plugin } = fixture();
    await approve(plugin);
    await invoke(plugin, "call-1", "task-2");
    expect(await transitions(plugin)).toEqual([]);
  });

  it("permits the next task after progress advances under the same approved plan", async () => {
    const { files, plugin } = fixture();
    await approve(plugin);
    await invoke(plugin, "call-1", "task-1");
    await files.writeFile("plan.md", plan.replace("- [ ] first", "- [x] first"));
    await invoke(plugin, "call-2", "task-2");
    const records = await transitions(plugin);
    expect(records.filter((record) => record.from === "pending" && record.to === "authorized").map((record) => record.taskId)).toEqual(["task-1", "task-2"]);
  });

  it("does not bind or request review when the initial lifecycle append fails", async () => {
    const { plugin } = fixture();
    await approve(plugin);
    const internals = plugin as unknown as { readonly observationLogStore: ObservationLogStore };
    vi.spyOn(internals.observationLogStore, "append").mockRejectedValueOnce(new Error("disk unavailable"));

    await invoke(plugin, "call-1");
    expect(plugin.getSessionStateProvider().getTaskCallBinding("call-1")).toBeUndefined();
    await plugin.handleEvent({
      type: "PostToolUse",
      sessionId: "s-1",
      callId: "call-1",
      payload: { toolName: "task", toolInput: { task_id: "task-1" }, toolResult: "done", error: false },
    });
    expect(await transitions(plugin)).toEqual([]);
  });

  it("does not bind when only the first lifecycle transition commits", async () => {
    const { plugin } = fixture();
    await approve(plugin);
    const internals = plugin as unknown as { readonly observationLogStore: ObservationLogStore };
    const append = internals.observationLogStore.append.bind(internals.observationLogStore);
    vi.spyOn(internals.observationLogStore, "append")
      .mockImplementationOnce((shard, record) => append(shard, record))
      .mockRejectedValueOnce(new Error("disk unavailable"));

    await invoke(plugin, "call-1");
    expect(plugin.getSessionStateProvider().getTaskCallBinding("call-1")).toBeUndefined();
    expect((await transitions(plugin)).map((record) => record.to)).toEqual(["authorized"]);
  });

});
