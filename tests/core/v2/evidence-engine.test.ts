// tests/core/v2/evidence-engine.test.ts
import { describe, expect, it } from "vitest";
import { extractEvidenceFromTool } from "../../../src/core/v2/evidence-engine";

describe("extractEvidenceFromTool", () => {
  it("classifies a bash `bun run test` call as observed command_exec tool_output", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "bun run test" },
      { output: "PASS" },
      "call_abc",
    );
    expect(ev.sourceClass).toBe("tool_output");
    expect(ev.evidenceId).toBe("call_abc");
    if (ev.sourceClass !== "tool_output") throw new Error("expected tool_output evidence");
    expect(ev.toolOutputClass).toBe("command_exec");
    expect(ev.provenance).toBe("observed");
    if (ev.toolOutputClass !== "command_exec") throw new Error("expected command_exec evidence");
    // command is redacted (no secrets/paths here → unchanged)
    expect(ev.command).toBe("bun run test");
    expect(ev.rawOutput).toBe("PASS");
    // interpretation is derived and self-references the observed evidence via SelfEvidenceRef
    expect(ev.interpretation?.provenance).toBe("derived");
    expect(ev.interpretation?.derivedFrom).toEqual([{ evidenceId: "call_abc" }]);
  });

  it("redacts absolute paths in the captured command", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "node /tmp/app/run.js" },
      { output: "" },
      "call_node",
    );
    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "command_exec") {
      throw new Error("expected command_exec tool_output evidence");
    }
    expect(ev.command).toBe("node [REDACTED_PATH]");
    expect(ev.command).not.toContain("/tmp/app");
  });

  it("hashes file_content output without storing rawOutput (read tool)", () => {
    const ev = extractEvidenceFromTool(
      "read",
      undefined,
      { output: "line1\nline2\nline3" },
      "call_read",
    );
    expect(ev.sourceClass).toBe("tool_output");
    if (ev.sourceClass !== "tool_output") throw new Error("expected tool_output evidence");
    expect(ev.toolOutputClass).toBe("file_content");
    if (ev.toolOutputClass !== "file_content") throw new Error("expected file_content evidence");
    expect(ev.rawOutputHash.startsWith("sha256:")).toBe(true);
    // file_content must NOT carry rawOutput
    expect("rawOutput" in ev).toBe(false);
  });

  it("marks task tool output as generic with unknown outcome", () => {
    const ev = extractEvidenceFromTool(
      "task",
      undefined,
      { output: "delegated subtask summary" },
      "call_task",
    );
    expect(ev.kind).toBe("generic");
    expect(ev.sourceClass).toBe("tool_output");
    if (ev.sourceClass !== "tool_output") throw new Error("expected tool_output evidence");
    expect(ev.interpretation?.outcome).toBe("unknown");
  });
});
