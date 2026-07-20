import { describe, expect, it, vi } from "vitest";
import { evaluate } from "../../src/core/v2/rule-evaluation-engine";
import type { GateRule } from "../../src/core/v2/gate-definition";
import type { ProjectedEvidence } from "../../src/core/v2/state-projection";
import type { GateContext } from "../../src/core/v2/gate-context";

const readFileMock = vi.fn();
const writeFileMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
}));

describe("FF-002 / FF-003", () => {
  it("evaluate is deterministic and pure", () => {
    const gates: readonly GateRule[] = [
      {
        id: "required-tests",
        gateType: "task",
        trigger: { on: "task_complete" },
        check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
        onViolation: "warn",
        onMissingEvidence: "warn",
        enabled: true,
      },
    ];

    const evidence: readonly ProjectedEvidence[] = [
      {
        evidence: {
          evidenceId: "ev-1",
          kind: "test",
          sourceClass: "tool_output",
          provenance: "observed",
          toolOutputClass: "command_exec",
          command: "bun test",
          rawOutput: "ok",
          interpretation: {
            outcome: "pass",
            basis: "parsed_output",
            provenance: "derived",
            derivedFrom: [{ kind: "self", evidenceId: "ev-1" }],
          },
        },
        ref: {
          agentId: "hephaestus",
          sessionId: "s-1",
          writerId: "w-1",
          kind: "full",
          sequence: 1,
          evidenceId: "ev-1",
        },
      },
    ];

    const ctx: GateContext = {
      trigger: "task_complete",
      taskId: "task-1",
      agentId: "hephaestus",
      sessionId: "s-1",
      reviewScope: [],
    };

    const before = structuredClone({ gates, evidence, ctx });

    const a = evaluate(gates, evidence, ctx);
    const b = evaluate(gates, evidence, ctx);
    expect(a).toEqual(b);

    expect(readFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(structuredClone({ gates, evidence, ctx })).toEqual(before);
  });
});
