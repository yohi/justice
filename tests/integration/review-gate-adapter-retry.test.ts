import { afterEach, expect, it, vi } from "vitest";
import * as z from "zod";
import { extractReviewGateWorkerPrompt } from "../../src/core/review-gate-execution";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem } from "../helpers/mock-file-system";

afterEach(() => vi.restoreAllMocks());

const nextTaskSchema = z.object({
  prompt: z.string(),
  category: z.string().optional(),
  subagent_type: z.string().optional(),
  description: z.string(),
  load_skills: z.array(z.string()),
  run_in_background: z.literal(false),
});

it.each([
  { clear: true, terminalPhase: "awaiting_implementation_authorization" },
  { clear: false, terminalPhase: "remediation" },
])(
  "continues two repairs through adapter output until $terminalPhase while implementation stays locked",
  async ({ clear, terminalPhase }) => {
    const designPath = "docs/specs/design.md";
    const planPath = "docs/plans/plan.md";
    const fs = createMockFileSystem({
      [designPath]: "# Design\nAcceptance boundary.\n",
      [planPath]: "## Task 1: Verification\n- [ ] Verify the boundary\n",
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
    const start = await justice.getPlanBridge().handleReviewGateStart("main", {
      source: "command",
      designPath,
      planPath,
      retryBudget: 2,
    });
    if (start.reviewerPrompt === undefined) throw new Error("Gate did not start");
    let args: Record<string, unknown> = { prompt: start.reviewerPrompt };
    const roles: string[] = [];

    for (let step = 0; step < 5; step++) {
      const worker = extractReviewGateWorkerPrompt(args.prompt);
      if (worker === undefined) throw new Error("Worker prompt missing");
      roles.push(`${worker.role}:${worker.round}`);
      const input = { tool: "task", sessionID: "controller", callID: `step-${step}` };
      const before = { args };
      const decision = await adapter.onToolExecuteBefore(input, before);
      expect(decision.action).not.toBe("skip");
      expect(before.args.prompt).toBe(args.prompt);
      if (worker.role === "remediation") {
        expect(before.args.category).toBe("writing");
        await fs.writeFile(planPath, `${await fs.readFile(planPath)}\nRepair ${worker.round}.\n`);
      } else {
        expect(before.args.subagent_type).toBe("justice-review-worker");
      }
      const output = {
        output: JSON.stringify(
          worker.role === "remediation"
            ? {
                schemaVersion: 1,
                gateId: worker.gateId,
                round: worker.round,
                complete: true,
                summary: "Repaired plan",
              }
            : {
                schemaVersion: 1,
                gateId: worker.gateId,
                complete: true,
                findings:
                  clear && worker.round === 3
                    ? []
                    : [
                        {
                          itemKey: `RG-${worker.round}`,
                          severity: "minor",
                          summary: "Clarify boundary",
                          location: planPath,
                        },
                      ],
              },
        ),
      };
      await adapter.onToolExecuteAfter({ ...input, args: before.args }, output);
      const nextPayload = output.output.match(
        /\[JUSTICE: REVIEW GATE NEXT TASK\]\n([^\n]+)$/u,
      )?.[1];
      if (step < 4) {
        expect(nextPayload).toBeDefined();
        if (nextPayload === undefined) throw new Error("Gate returned before terminal review");
        args = nextTaskSchema.parse(JSON.parse(nextPayload));
      } else {
        expect(nextPayload).toBeUndefined();
      }
    }

    expect(roles).toEqual(["review:1", "remediation:1", "review:2", "remediation:2", "review:3"]);
    expect(justice.getPlanBridge().hasPendingPlanReviewGate("main")).toBe(false);
    expect(justice.getPlanBridge().getReviewGateLock("main")?.phase).toBe(terminalPhase);
    expect(
      await adapter.onToolExecuteBefore(
        { tool: "task", sessionID: "controller", callID: "implementation" },
        { args: { prompt: "Implement the plan" } },
      ),
    ).toMatchObject({ action: "skip", reason: "implementation_not_authorized" });
  },
);
