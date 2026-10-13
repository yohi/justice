import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { REVIEW_GATE_AGENT_REVIEWER } from "../../src/core/review-gate/agent-protocol";
import type { ReviewCandidatesResultV1 } from "../../src/core/review-gate/agent-protocol";
import { computeArtifactDigest } from "../../src/core/review-gate/identity";
import { createReviewGateQueryService } from "../../src/runtime/review-gate-query";
import type { VerifiedApprovedDesignReadBindingV1 } from "../../src/core/review-gate/capabilities";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem } from "../helpers/mock-file-system";
import { parseNextTaskArgs, parsePacketPayload } from "../helpers/review-gate-coordinator";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.JUSTICE_REVIEW_GATE_ROOT;
  for (const root of workspaceRoots) rmSync(root, { recursive: true, force: true });
  workspaceRoots.clear();
});

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/plan.md";
const DESIGN_CONTENT = "# Design\nAcceptance boundary.\n";
const PLAN_CONTENT = "## Task 1: Verification\n- [ ] Verify the boundary\n";
const workspaceRoots = new Set<string>();

async function createAdapter(): Promise<{
  readonly adapter: OpenCodeAdapter;
  readonly fs: ReturnType<typeof createMockFileSystem>;
  readonly workspaceRoot: string;
}> {
  const graphRoot = mkdtempSync(join(tmpdir(), "justice-rg-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "justice-rg-workspace-"));
  workspaceRoots.add(graphRoot);
  workspaceRoots.add(workspaceRoot);
  process.env.JUSTICE_REVIEW_GATE_ROOT = graphRoot;
  mkdirSync(join(workspaceRoot, "docs/specs"), { recursive: true });
  mkdirSync(join(workspaceRoot, "docs/plans"), { recursive: true });
  writeFileSync(join(workspaceRoot, DESIGN_PATH), DESIGN_CONTENT);
  writeFileSync(join(workspaceRoot, PLAN_PATH), PLAN_CONTENT);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.name", "Justice Test"], { cwd: workspaceRoot });
  execFileSync("git", ["add", DESIGN_PATH, PLAN_PATH], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "test baseline"], {
    cwd: workspaceRoot,
  });
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

  const adapter = new OpenCodeAdapter(
    fakeInit({
      project: { root: workspaceRoot },
      directory: workspaceRoot,
      worktree: workspaceRoot,
    }),
  );
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
  return { adapter, fs, workspaceRoot };
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
  const remediatedDesign = `${DESIGN_CONTENT}\n- [x] Verify the lifecycle\n`;
  await fs.writeFile(DESIGN_PATH, remediatedDesign);
  worker = parseNextTaskArgs(
    await deliver("rem1", remediationArgs, remediationResult(remediationArgs, "COMPLETED")),
  );
  // Self review follows the durable FINDING_REMEDIATED append.
  expect(worker.subagent_type).toBe("justice-review-finding-validator");
  const selfReviewArgs = { prompt: worker.prompt as string };
  const selfReviewArtifacts = parsePacketPayload(selfReviewArgs.prompt).artifacts as readonly {
    readonly role: string;
    readonly canonicalPath: string;
    readonly digest: string;
  }[];
  expect(selfReviewArtifacts.find((artifact) => artifact.role === "design")?.digest).toBe(
    computeArtifactDigest(new TextEncoder().encode(remediatedDesign)),
  );
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

it("permits /justice-review-history and the bounded approved Design read under an active gate lock", async () => {
  const { adapter, workspaceRoot } = await createAdapter();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("missing justice");
  const planBridge = justice.getPlanBridge();

  const started = await planBridge.handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  expect(started.dispatched).toBe(true);
  if (started.reviewerPrompt === undefined) throw new Error("gate did not dispatch");
  expect(planBridge.getReviewGateLock("main")?.phase).toBe("reviewing");

  // Mocked approved-Design authority source for this sub-task: the proof pins
  // the real committed baseline tree/blob of the workspace repository, while
  // Task 18 will inject the real witness-verified producer.
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim();
  const committedTreeOid = execFileSync("git", ["rev-parse", `${commitSha}^{tree}`], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim();
  const designBlobOid = execFileSync("git", ["rev-parse", `${commitSha}:${DESIGN_PATH}`], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim();
  const designDigest = computeArtifactDigest(new TextEncoder().encode(DESIGN_CONTENT));
  const approvedDesign: VerifiedApprovedDesignReadBindingV1 = {
    schemaVersion: 1,
    canonicalPath: DESIGN_PATH,
    designClearEventId: "evt-design-clear-orchestration",
    currentAuthorityEventId: "evt-authority-orchestration",
    committedTreeOid,
    blobOid: designBlobOid,
    gitMode: "100644",
    digest: designDigest,
    requirements: {
      canonicalPath: DESIGN_PATH,
      gitBlobOid: designBlobOid,
      digest: designDigest,
      gitMode: "100644",
    },
    phaseProtocolFingerprint: "plan-protocol-orchestration",
    witnessFrontierHash: computeArtifactDigest(
      new TextEncoder().encode("orchestration-witness-frontier"),
    ),
  };
  const queryService = createReviewGateQueryService({
    rootDir: workspaceRoot,
    workspaceReader: {
      readWorkspaceFile: async (relativePath: string) => {
        try {
          return await readFile(join(workspaceRoot, relativePath));
        } catch {
          return null;
        }
      },
    },
  });
  planBridge.setReviewGateApprovedDesignAuthority({
    getApprovedDesignBinding: async () => approvedDesign,
    readApprovedDesignArtifact: (input) => queryService.readApprovedDesignArtifact(input),
    searchApprovedDesignArtifact: (input) => queryService.searchApprovedDesignArtifact(input),
  });

  type HistoryCommandOutput = Parameters<OpenCodeAdapter["onCommandExecuteBefore"]>[1];
  const runHistorySummary = async (): Promise<string> => {
    const output: HistoryCommandOutput = { parts: [] };
    await adapter.onCommandExecuteBefore(
      {
        command: "justice-review-history",
        sessionID: "main",
        arguments: `--design ${DESIGN_PATH} --plan ${PLAN_PATH}`,
      },
      output,
    );
    const part = output.parts[0];
    if (part === undefined) throw new Error("history query produced no part");
    if (!("text" in part) || typeof part.text !== "string") {
      throw new Error("history query did not render text");
    }
    return part.text;
  };
  const eventsLineOf = (display: string): string => {
    const line = display.split("\n").find((entry) => entry.startsWith("events: "));
    if (line === undefined) throw new Error("history summary carries no events line");
    return line;
  };

  const before = await runHistorySummary();
  expect(before).toContain("[JUSTICE: REVIEW HISTORY]");
  expect(before).toContain("status: active");
  expect(before).not.toMatch(/REVIEW HISTORY (?:NOT FOUND|CONFLICT|VERSION NOT SUPPORTED|UNAVAILABLE)/u);

  // The bounded approved Design read goes through the real verified Git blob
  // reader while the implementation lock is active.
  expect(
    await planBridge.mediateReviewerArtifactRead("main", { toolName: "read", path: DESIGN_PATH }),
  ).toEqual({ kind: "approved_read", bytes: Buffer.from(DESIGN_CONTENT) });
  expect(
    await planBridge.mediateReviewerArtifactRead("main", {
      toolName: "grep",
      path: DESIGN_PATH,
      pattern: "Acceptance",
    }),
  ).toEqual({
    kind: "approved_search",
    matches: [{ line: 2, text: "Acceptance boundary." }],
  });

  // Implementation tools stay rejected with the exact error code through the
  // last-mile adapter.
  expect(
    await adapter.onToolExecuteBefore(
      { tool: "bash", sessionID: "main", callID: "impl-bash" },
      { args: { command: "echo hi" } },
    ),
  ).toMatchObject({ action: "skip", reason: "implementation_not_authorized" });
  expect(
    await planBridge.mediateReviewerArtifactRead("main", { toolName: "edit", path: DESIGN_PATH }),
  ).toEqual({ kind: "denied", reason: "review_operation_not_permitted" });

  // Pure queries must not mutate the Gate: same history, same event count,
  // same lock phase.
  expect(planBridge.getReviewGateLock("main")?.phase).toBe("reviewing");
  const after = await runHistorySummary();
  expect(eventsLineOf(after)).toBe(eventsLineOf(before));
  expect(after).toContain("status: active");
});
