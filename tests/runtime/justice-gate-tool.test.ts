import type { ToolContext, ToolDefinition, ToolResult } from "@opencode-ai/plugin";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { OpenCodePlugin } from "../../src/opencode-plugin";
import { SessionStateProvider } from "../../src/core/session-state-provider";
import type { GateRule } from "../../src/core/v2/gate-definition";
import type { ObservationRecord, ReviewItem } from "../../src/core/v2/observation-model";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";

const skipResultSchema = z.object({
  verdict: z.literal("SKIP"),
  reason: z.string(),
});

const decisionResultSchema = z.object({
  verdict: z.enum(["PASS", "WARN", "FAIL"]),
  gateType: z.literal("task"),
  reachableEnforcementLevel: z.literal("L1"),
  appliedEnforcementLevel: z.literal("L0"),
  ruleResults: z.array(
    z.object({
      ruleId: z.string(),
      verdict: z.enum(["PASS", "WARN", "FAIL"]),
      reason: z.string().optional(),
      evidenceRefs: z.array(z.unknown()),
    }),
  ),
});

const errorResultSchema = z.object({
  status: z.literal("ERROR"),
  reason: z.string(),
});

function createToolContext(agent = "sisyphus", sessionID = "session-1"): ToolContext {
  return {
    sessionID,
    messageID: "message-1",
    agent,
    directory: ".",
    worktree: ".",
    abort: new AbortController().signal,
    metadata: () => undefined,
    ask: (): never => {
      throw new Error("justice_gate must not request permission");
    },
  };
}

function requireGateTool(adapter: OpenCodeAdapter): ToolDefinition {
  const definition = adapter.getTools().justice_gate;
  if (definition === undefined) throw new Error("justice_gate definition is missing");
  return definition;
}

function requireStringResult(result: ToolResult): string {
  if (typeof result !== "string") {
    throw new Error("Expected justice_gate to return a string result");
  }
  return result;
}

function evidenceEvent(sequence: number, kind: "test" | "build"): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence,
    timestamp: `2026-07-16T00:00:0${sequence}Z`,
    agentId: "atlas",
    sessionId: "source-session",
    writerId: "writer-1",
    recordType: "observation",
    taskId: "task-7.2",
    kind: "tool_executed",
    toolName: "bash",
    callId: `call-${sequence}`,
    evidence: {
      evidenceId: `evidence-${kind}`,
      kind,
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: kind === "test" ? "bun run test" : "bun run build",
      rawOutput: "passed",
      interpretation: {
        outcome: "pass",
        provenance: "derived",
        basis: "parsed_output",
        derivedFrom: [],
      },
    },
  };
}

function reviewEvent(sequence: number): ObservationRecord {
  const item: ReviewItem = {
    itemKey: "review-major-1",
    evidenceId: "review-evidence-1",
    severity: "major",
    summary: "Blocking review item",
    location: "src/example.ts",
    status: "open",
  };
  return {
    schemaVersion: 1,
    sequence,
    timestamp: `2026-07-16T00:00:0${sequence}Z`,
    agentId: "atlas",
    sessionId: "source-session",
    writerId: "writer-1",
    recordType: "observation",
    taskId: "task-7.2",
    kind: "review_observed",
    reviewScope: "task-7.2",
    items: [item],
  };
}

const TEST_AND_REVIEW_GATES: readonly GateRule[] = [
  {
    id: "tests-pass",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
    onViolation: "fail",
    onMissingEvidence: "fail",
    enabled: true,
  },
  {
    id: "review-blocked",
    gateType: "task",
    trigger: { on: "task_complete" },
    check: { type: "review_open_items", minimumSeverity: "major" },
    onViolation: "fail",
    onMissingEvidence: "warn",
    enabled: true,
  },
];

describe("justice_gate tool", () => {
  it("registers justice_gate on the plugin tool hook", async () => {
    // Given
    const init = fakeInit();

    // When
    const hooks = await OpenCodePlugin(init as never);

    // Then
    expect(hooks.tool).toHaveProperty("justice_gate");
    expect(hooks.tool?.justice_gate?.description).toContain("task_complete");
  });

  it("resolves Justice and the invoking agent lazily for an unscoped dry-run", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    const definition = requireGateTool(adapter);
    const resolveAgentId = vi.spyOn(SessionStateProvider, "resolveAgentId");
    expect(adapter.getJustice()).toBeNull();

    // When
    const output = requireStringResult(
      await definition.execute({}, createToolContext("AtLaS", "dry-run-session")),
    );

    // Then
    expect(adapter.getJustice()).not.toBeNull();
    expect(resolveAgentId).toHaveBeenCalledWith("AtLaS");
    expect(skipResultSchema.parse(JSON.parse(output))).toEqual({
      verdict: "SKIP",
      reason: "no taskId provided",
    });
  });

  it("treats an empty taskId as an unscoped dry-run", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    const logRead = vi
      .spyOn(observationHandler.getLogStore(), "readAll")
      .mockRejectedValue(new Error("readAll must not be called"));
    const gateLoader = observationHandler.getGateLoader();
    if (gateLoader === undefined) throw new Error("Gate loader fixture is missing");
    const gateLoad = vi
      .spyOn(gateLoader, "load")
      .mockRejectedValue(new Error("load must not be called"));
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "" }, createToolContext()),
    );

    // Then
    expect(skipResultSchema.parse(JSON.parse(output))).toEqual({
      verdict: "SKIP",
      reason: "no taskId provided",
    });
    expect(logRead).not.toHaveBeenCalled();
    expect(gateLoad).not.toHaveBeenCalled();
  });

  it("fails open with JSON ERROR when the gate loader is not configured", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    vi.spyOn(justice.getObservationHandler(), "getGateLoader").mockReturnValue(undefined);
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "task-7.2" }, createToolContext()),
    );

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "Gate loader not configured",
    });
  });

  it("evaluates projected evidence and review summary without appending a decision", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    const logStore = observationHandler.getLogStore();
    const gateLoader = observationHandler.getGateLoader();
    if (gateLoader === undefined) throw new Error("Gate loader fixture is missing");
    vi.spyOn(logStore, "readAll").mockResolvedValue([
      evidenceEvent(1, "test"),
      evidenceEvent(2, "build"),
      reviewEvent(3),
    ]);
    vi.spyOn(gateLoader, "load").mockResolvedValue(TEST_AND_REVIEW_GATES);
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "task-7.2" }, createToolContext()),
    );

    // Then
    const result = decisionResultSchema.parse(JSON.parse(output));
    expect(result.verdict).toBe("FAIL");
    expect(result.ruleResults).toEqual([
      expect.objectContaining({ ruleId: "tests-pass", verdict: "PASS" }),
      expect.objectContaining({ ruleId: "review-blocked", verdict: "FAIL" }),
    ]);
    const reviewRule = result.ruleResults.find((rule) => rule.ruleId === "review-blocked");
    expect(reviewRule?.reason).toContain(
      "Found 1 open review items matching minimum severity 'major'.",
    );
    expect(reviewRule?.evidenceRefs).toEqual([
      expect.objectContaining({ evidenceId: "review-evidence-1", sequence: 3 }),
    ]);
  });

  it("fails open with JSON ERROR when the observation log cannot be read", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    vi.spyOn(justice.getObservationHandler().getLogStore(), "readAll").mockRejectedValue(
      new Error("corrupted observation log"),
    );
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "task-7.2" }, createToolContext()),
    );

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "corrupted observation log",
    });
  });

  it("fails open with JSON ERROR when gate loading fails", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    const gateLoader = observationHandler.getGateLoader();
    if (gateLoader === undefined) throw new Error("Gate loader fixture is missing");
    vi.spyOn(observationHandler.getLogStore(), "readAll").mockResolvedValue([]);
    vi.spyOn(gateLoader, "load").mockRejectedValue(new Error("gate configuration unavailable"));
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "task-7.2" }, createToolContext()),
    );

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "gate configuration unavailable",
    });
  });

  it("evaluates a task without evidence as an empty evidence set", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    const gateLoader = observationHandler.getGateLoader();
    if (gateLoader === undefined) throw new Error("Gate loader fixture is missing");
    vi.spyOn(observationHandler.getLogStore(), "readAll").mockResolvedValue([]);
    vi.spyOn(gateLoader, "load").mockResolvedValue(TEST_AND_REVIEW_GATES);
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "missing-task" }, createToolContext()),
    );

    // Then
    const result = decisionResultSchema.parse(JSON.parse(output));
    expect(result.verdict).toBe("FAIL");
    expect(result.ruleResults).toEqual([
      expect.objectContaining({ ruleId: "tests-pass", verdict: "FAIL" }),
      expect.objectContaining({ ruleId: "review-blocked", verdict: "WARN" }),
    ]);
  });

  it("serializes a non-Error gate loading failure", async () => {
    // Given
    const adapter = new OpenCodeAdapter(fakeInit());
    await adapter.ensureInitialized();
    const justice = adapter.getJustice();
    if (justice === null) throw new Error("Justice test fixture failed to initialize");
    const observationHandler = justice.getObservationHandler();
    const gateLoader = observationHandler.getGateLoader();
    if (gateLoader === undefined) throw new Error("Gate loader fixture is missing");
    vi.spyOn(observationHandler.getLogStore(), "readAll").mockResolvedValue([]);
    vi.spyOn(gateLoader, "load").mockRejectedValue("gate configuration unavailable");
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "task-7.2" }, createToolContext()),
    );

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "gate configuration unavailable",
    });
  });

  it("fails open with JSON ERROR when Justice cannot initialize", async () => {
    // Given
    const adapter = new OpenCodeAdapter(
      fakeInit({
        project: { root: undefined },
        directory: undefined,
        worktree: undefined,
      }),
    );
    const definition = requireGateTool(adapter);

    // When
    const output = requireStringResult(
      await definition.execute({ taskId: "task-7.2" }, createToolContext()),
    );

    // Then
    expect(errorResultSchema.parse(JSON.parse(output))).toEqual({
      status: "ERROR",
      reason: "Justice not initialized",
    });
  });
});
