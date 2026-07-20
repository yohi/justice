import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate } from "../../src/core/v2/rule-evaluation-engine";
import type { GateRule } from "../../src/core/v2/gate-definition";
import type { ProjectedEvidence } from "../../src/core/v2/state-projection";
import type { GateContext } from "../../src/core/v2/gate-context";

const {
  mockAppendFile,
  mockAppendFileSync,
  mockMkdir,
  mockMkdirSync,
  mockReadFile,
  mockReadFileSync,
  mockRename,
  mockRenameSync,
  mockRm,
  mockRmSync,
  mockUnlink,
  mockUnlinkSync,
  mockWriteFile,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockAppendFile: vi.fn(),
  mockAppendFileSync: vi.fn(),
  mockMkdir: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockReadFile: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockRename: vi.fn(),
  mockRenameSync: vi.fn(),
  mockRm: vi.fn(),
  mockRmSync: vi.fn(),
  mockUnlink: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockWriteFile: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    appendFile: mockAppendFile,
    mkdir: mockMkdir,
    readFile: mockReadFile,
    rename: mockRename,
    rm: mockRm,
    unlink: mockUnlink,
    writeFile: mockWriteFile,
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    appendFile: mockAppendFile,
    appendFileSync: mockAppendFileSync,
    mkdir: mockMkdir,
    mkdirSync: mockMkdirSync,
    readFile: mockReadFile,
    readFileSync: mockReadFileSync,
    rename: mockRename,
    renameSync: mockRenameSync,
    rm: mockRm,
    rmSync: mockRmSync,
    unlink: mockUnlink,
    unlinkSync: mockUnlinkSync,
    writeFile: mockWriteFile,
    writeFileSync: mockWriteFileSync,
  };
});

function createInputs(): {
  readonly gates: readonly GateRule[];
  readonly evidence: readonly ProjectedEvidence[];
  readonly ctx: GateContext;
} {
  return {
    gates: [
      {
        id: "required-tests",
        gateType: "task",
        trigger: { on: "task_complete" },
        check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
        onViolation: "warn",
        onMissingEvidence: "warn",
        enabled: true,
      },
    ],
    evidence: [
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
    ],
    ctx: {
      trigger: "task_complete",
      taskId: "task-1",
      agentId: "hephaestus",
      sessionId: "s-1",
      reviewScope: [],
    },
  };
}

describe("FF-002 / FF-003", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FF-002: evaluate is deterministic and does not mutate its inputs", () => {
    const { gates, evidence, ctx } = createInputs();
    const before = structuredClone({ gates, evidence, ctx });

    const first = evaluate(gates, evidence, ctx);
    const second = evaluate(gates, evidence, ctx);

    expect(first).toEqual(second);
    expect(structuredClone({ gates, evidence, ctx })).toEqual(before);
  });

  it("FF-003: evaluate does not perform filesystem side effects", () => {
    const { gates, evidence, ctx } = createInputs();

    evaluate(gates, evidence, ctx);

    expect(mockAppendFile).not.toHaveBeenCalled();
    expect(mockAppendFileSync).not.toHaveBeenCalled();
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockRename).not.toHaveBeenCalled();
    expect(mockRenameSync).not.toHaveBeenCalled();
    expect(mockRm).not.toHaveBeenCalled();
    expect(mockRmSync).not.toHaveBeenCalled();
    expect(mockUnlink).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
