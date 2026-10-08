import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { REVIEW_GATE_AGENT_REVIEWER } from "../../src/core/review-gate/agent-protocol";
import type { ReviewCandidatesResultV1 } from "../../src/core/review-gate/agent-protocol";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem } from "../helpers/mock-file-system";
import { parseNextTaskArgs, parsePacketPayload } from "../helpers/review-gate-coordinator";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.JUSTICE_REVIEW_GATE_ROOT;
});

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/plan.md";
const DESIGN_CONTENT = "# Design\nAcceptance boundary.\n";
const PLAN_CONTENT = "## Task 1: Verification\n- [ ] Verify the boundary\n";

async function createAdapter(): Promise<{
  readonly adapter: OpenCodeAdapter;
  readonly fs: ReturnType<typeof createMockFileSystem>;
}> {
  process.env.JUSTICE_REVIEW_GATE_ROOT = mkdtempSync(join(tmpdir(), "justice-rg-"));
  const fs = createMockFileSystem({
    [DESIGN_PATH]: DESIGN_CONTENT,
    [PLAN_PATH]: PLAN_CONTENT,
  });
  vi.spyOn(NodeFileSystem.prototype, "readFile").mockImplementation(fs.readFile);
  vi.spyOn(NodeFileSystem.prototype, "fileExists").mockImplementation(fs.fileExists);
  vi.spyOn(NodeFileSystem.prototype, "listFiles").mockImplementation(fs.listFiles);
  vi.spyOn(NodeFileSystem.prototype, "readFileStats").mockImplementation(fs.readFileStats);
  vi.spyOn(NodeFileSystem.prototype, "writeFile").mockImplementation(fs.writeFile);
  vi.spyOn(NodeFileSystem.prototype, "mkdir").mockImplementation(fs.mkdir);
  vi.spyOn(NodeFileSystem.prototype, "rename").mockImplementation(fs.rename);

  const adapter = new OpenCodeAdapter(fakeInit());
  await adapter.ensureInitialized();
  await adapter.onEvent({
    event: {
      id: "controller-created",
      type: "session.created",
      properties: { info: { id: "controller", parentID: "main" } },
    },
  });
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("Justice was not initialized");
  return { adapter, fs };
}

function reviewerResult(
  packetArgs: Record<string, unknown>,
  candidates: ReviewCandidatesResultV1["candidates"],
): string {
  const payload = parsePacketPayload(packetArgs.prompt as string);
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidates,
  });
}

function findingValidationResult(
  packetArgs: Record<string, unknown>,
  overrides: Record<string, unknown>,
): string {
  const payload = parsePacketPayload(packetArgs.prompt as string);
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: payload.reviewAttemptId,
    remediationRound: null,
    candidateId: (payload.candidate as Record<string, unknown>).candidateId,
    decision: "VALID",
    severity: "blocking",
    observedPhase: payload.phase,
    semanticBasis: {
      violationType: "UNVERIFIED_CLAIM",
      governingReference: "design.md#acceptance",
      semanticLocation: "Task 1",
      violatedContract: "verify",
      ownerScope: "plan",
    },
    relation: "NEW",
    ...overrides,
  });
}

function selfReviewResult(
  packetArgs: Record<string, unknown>,
  targets: readonly { lineageId: string; result: "RESOLVED" | "STILL_PRESENT" | "INDETERMINATE" }[],
): string {
  const payload = parsePacketPayload(packetArgs.prompt as string);
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: null,
    remediationRound: payload.remediationRound,
    targetLineageChecks: targets,
    discoveredFindings: [],
  });
}

function remediationResult(packetArgs: Record<string, unknown>, outcome: string): string {
  const payload = parsePacketPayload(packetArgs.prompt as string);
  return JSON.stringify({
    schemaVersion: 1,
    operationId: payload.operationId,
    gateId: payload.gateId,
    phase: payload.phase,
    reviewAttemptId: null,
    remediationRound: payload.remediationRound,
    targetPath: (payload.targetArtifact as Record<string, unknown>).canonicalPath,
    outcome,
    summary: "Repaired",
  });
}

it("clears a zero-finding gate end to end through the adapter and reuses the completed binding read-only", async () => {
  const { adapter } = await createAdapter();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("missing justice");
  const planBridge = justice.getPlanBridge();

  const started = await planBridge.handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  expect(started.dispatched).toBe(true);
  expect(started.reviewerPrompt).toContain("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
  expect(planBridge.getReviewGateLock("main")?.phase).toBe("reviewing");

  // Reviewer dispatch with zero candidates plans straight through to the
  // Design clear → Plan review → Plan clear → completed chain.
  const firstArgs = { prompt: started.reviewerPrompt as string };
  const claim = await adapter.onToolExecuteBefore(
    { tool: "task", sessionID: "controller", callID: "review-1" },
    { args: { ...firstArgs } },
  );
  expect(claim.action).toBe("inject");
  expect((claim.modifiedPayload as { args: Record<string, unknown> }).args.subagent_type).toBe(
    REVIEW_GATE_AGENT_REVIEWER,
  );

  const after = { output: reviewerResult(firstArgs, []) };
  await adapter.onToolExecuteAfter(
    { tool: "task", sessionID: "controller", callID: "review-1", args: firstArgs },
    after,
  );
  // The second worker call (plan-phase reviewer) is delivered as the next task.
  const nextArgs = parseNextTaskArgs(after.output);
  expect(nextArgs.subagent_type).toBe(REVIEW_GATE_AGENT_REVIEWER);

  const secondArgs = { prompt: nextArgs.prompt as string };
  await adapter.onToolExecuteBefore(
    { tool: "task", sessionID: "controller", callID: "review-2" },
    { args: { ...secondArgs } },
  );
  const finalAfter = { output: reviewerResult(secondArgs, []) };
  await adapter.onToolExecuteAfter(
    { tool: "task", sessionID: "controller", callID: "review-2", args: secondArgs },
    finalAfter,
  );
  expect(finalAfter.output).toContain("[JUSTICE: REVIEW GATE CLEAR]");
  expect(planBridge.getReviewGateLock("main")?.phase).toBe(
    "awaiting_implementation_authorization",
  );

  // Implementation stays locked until the explicit user arm command.
  expect(
    await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "main", callID: "impl" },
      { args: { prompt: "Implement the plan" } },
    ),
  ).toMatchObject({ action: "skip", reason: "implementation_not_authorized" });

  // A second start request reuses the exactly matching completed binding
  // read-only: no new dispatch, no writer allocation.
  const reuse = await planBridge.handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  expect(reuse.dispatched).toBe(false);
  expect(reuse.guidance).toContain("[JUSTICE: REVIEW GATE CLEAR]");
  expect(planBridge.getReviewGateLock("main")?.phase).toBe(
    "awaiting_implementation_authorization",
  );
});

it("routes remediation and self-review, then blocks safely when the mutation substrate is unavailable", async () => {
  const { adapter, fs } = await createAdapter();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("missing justice");
  const planBridge = justice.getPlanBridge();

  const started = await planBridge.handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  if (started.reviewerPrompt === undefined) throw new Error("gate did not start");

  const deliver = async (
    callId: string,
    args: Record<string, unknown>,
    resultJson: string,
  ): Promise<string> => {
    const after = { output: resultJson };
    await adapter.onToolExecuteBefore(
      { tool: "task", sessionID: "controller", callID: callId },
      { args: { ...args } },
    );
    await adapter.onToolExecuteAfter(
      { tool: "task", sessionID: "controller", callID: callId, args },
      after,
    );
    return after.output;
  };

  // Round 1: reviewer finds one candidate.
  const reviewArgs = { prompt: started.reviewerPrompt };
  let worker = parseNextTaskArgs(
    await deliver("r1", reviewArgs, reviewerResult(reviewArgs, [
      { candidateId: "cand-1", severity: "major", summary: "Missing lifecycle test", location: "Task 1" },
    ])),
  );
  // The finding validator is dispatched in a fresh validator context.
  expect(worker.subagent_type).toBe("justice-review-finding-validator");

  const validateArgs = { prompt: worker.prompt as string };
  worker = parseNextTaskArgs(await deliver("v1", validateArgs, findingValidationResult(validateArgs, {})));
  // Reconciliation plans remediation next.
  expect(worker.subagent_type).toBe("justice-review-remediator");

  const remediationArgs = { prompt: worker.prompt as string };
  await fs.writeFile(PLAN_PATH, `${PLAN_CONTENT}\n- [x] Verify the lifecycle\n`);
  worker = parseNextTaskArgs(
    await deliver("rem1", remediationArgs, remediationResult(remediationArgs, "COMPLETED")),
  );
  // Self review follows the durable FINDING_REMEDIATED append.
  expect(worker.subagent_type).toBe("justice-review-finding-validator");
  const selfReviewArgs = { prompt: worker.prompt as string };
  const lineageId = ((parsePacketPayload(selfReviewArgs.prompt).targetLineageRefs as string[]) ?? [])[0] as string;

  const tail = await deliver("sr1", selfReviewArgs, selfReviewResult(selfReviewArgs, [
    { lineageId, result: "RESOLVED" },
  ]));

  // The commit side effect has no wired substrate: blocked guidance with no
  // unsafe mutation fallback.
  expect(tail).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
  expect(tail).toContain("mutation substrate is unavailable");
  expect(planBridge.getReviewGateLock("main")?.phase).toBe("remediation");

  // The failed side effect did not re-dispatch a worker: no next task payload.
  expect(tail.includes("[JUSTICE: REVIEW GATE NEXT TASK]")).toBe(false);
});
