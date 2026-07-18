// tests/core/v2/evidence-engine.test.ts
import { describe, expect, it } from "vitest";
import { extractEvidenceFromTool } from "../../../src/core/v2/evidence-engine";

/** True if the string contains a lone (unpaired) UTF-16 surrogate — i.e. ill-formed UTF-16. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

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
    expect(ev.interpretation?.derivedFrom).toEqual([{ kind: "self", evidenceId: "call_abc" }]);
    expect(ev.interpretation?.basis).toBe("parsed_output");
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

  it("hashes git diff output without storing rawOutput", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "git --no-pager -C worktree diff --cached" },
      { output: "diff --git a/file.ts b/file.ts\n+added content" },
      "call_git_diff",
    );
    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "file_content") {
      throw new Error("expected file_content tool_output evidence");
    }
    expect(ev.rawOutputHash.startsWith("sha256:")).toBe(true);
    expect("rawOutput" in ev).toBe(false);
  });

  it.each([
    "git diff-files --name-only",
    "git diff-index --cached HEAD",
    "git diff-tree --no-commit-id -r HEAD",
    "git annotate src/index.ts",
  ])("does not retain raw output from content-producing %s", (command) => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command },
      { output: "sensitive repository content" },
      `call_${command}`,
    );

    expect(ev.sourceClass).toBe("tool_output");
    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "file_content") {
      throw new Error("expected file_content tool_output evidence");
    }
    expect(ev.rawOutputHash.startsWith("sha256:")).toBe(true);
    expect("rawOutput" in ev).toBe(false);
  });

  it("marks file_content evidence as non-authoritative while retaining its audit hash", () => {
    const ev = extractEvidenceFromTool(
      "read",
      undefined,
      { output: "PASS" },
      "call_non_authoritative_read",
    );

    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "file_content") {
      throw new Error("expected file_content tool_output evidence");
    }
    expect(ev.provenance).toBe("unknown");
    expect(ev.rawOutputHash.startsWith("sha256:")).toBe(true);
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
    expect(ev.interpretation?.basis).toBe("unparsed");
  });

  it("uses metadata_error basis and fail outcome when metadata.error is set", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "bun run test" },
      { output: "boom", metadata: { error: true } },
      "call_err",
    );
    expect(ev.interpretation?.basis).toBe("metadata_error");
    expect(ev.interpretation?.outcome).toBe("fail");
  });

  it("prioritizes metadata.error over the task branch (fail / metadata_error) (Issue 2 review)", () => {
    const ev = extractEvidenceFromTool(
      "task",
      undefined,
      { output: "delegated subtask failed", metadata: { error: true } },
      "call_task_err",
    );
    expect(ev.interpretation?.outcome).toBe("fail");
    expect(ev.interpretation?.basis).toBe("metadata_error");
  });

  it("does not misclassify passing '0 errors' output as fail (Greptile review: error keyword excluded)", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "bun run lint" },
      { output: "✓ 0 errors, 0 warnings" },
      "call_lint_ok",
    );
    expect(ev.interpretation?.outcome).toBe("pass");
  });

  it("does not classify 'Found 0 errors.' as fail (error keyword excluded from fail vocabulary)", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "tsc --noEmit" },
      { output: "Found 0 errors." },
      "call_tsc_ok",
    );
    expect(ev.interpretation?.outcome).not.toBe("fail");
  });

  it("derives fail outcome from failing text output (deriveOutcome fail branch)", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "bun run build" },
      { output: "build failed: compilation aborted" },
      "call_build_fail",
    );
    expect(ev.interpretation?.outcome).toBe("fail");
    expect(ev.interpretation?.basis).toBe("parsed_output");
  });

  it("derives unknown outcome and stores empty rawOutput when output is absent", () => {
    const ev = extractEvidenceFromTool("bash", { command: "bun run test" }, {}, "call_empty");
    expect(ev.interpretation?.outcome).toBe("unknown");
    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "command_exec") {
      throw new Error("expected command_exec tool_output evidence");
    }
    expect(ev.rawOutput).toBe("");
  });

  it("derives unknown outcome from neutral (non-pass, non-fail) text", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "echo hi" },
      { output: "hello world" },
      "call_neutral",
    );
    expect(ev.interpretation?.outcome).toBe("unknown");
  });

  it("omits rawOutputSnippet for empty file_content output", () => {
    const ev = extractEvidenceFromTool("read", undefined, { output: "" }, "call_empty_read");
    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "file_content") {
      throw new Error("expected file_content tool_output evidence");
    }
    expect(ev.rawOutputSnippet).toBeUndefined();
    expect(ev.rawOutputHash.startsWith("sha256:")).toBe(true);
  });

  it("recognizes 'fails'/'failures' inflections (vocab sync with declared-claim-extractor, Finding #1)", () => {
    const evFails = extractEvidenceFromTool(
      "bash",
      { command: "bun run test" },
      { output: "the suite fails" },
      "call_fails",
    );
    expect(evFails.interpretation?.outcome).toBe("fail");
    const evFailures = extractEvidenceFromTool(
      "bash",
      { command: "bun run test" },
      { output: "Failures: 2" },
      "call_failures",
    );
    expect(evFailures.interpretation?.outcome).toBe("fail");
  });

  it("recognizes the 'passes' inflection in the pass vocabulary (Finding #1)", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "bun run test" },
      { output: "everything passes" },
      "call_passes",
    );
    expect(ev.interpretation?.outcome).toBe("pass");
  });

  it("redacts absolute paths in command_exec rawOutput via the single redactForPersistence entry point (Finding #5)", () => {
    const ev = extractEvidenceFromTool(
      "bash",
      { command: "git status" },
      { output: "reading /etc/secret/config.json now" },
      "call_raw_path",
    );
    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "command_exec") {
      throw new Error("expected command_exec tool_output evidence");
    }
    expect(ev.rawOutput).toContain("[REDACTED_PATH]");
    expect(ev.rawOutput).not.toContain("/etc/secret");
  });

  it("does not split a surrogate pair at the 100-code-unit snippet boundary (Finding #2)", () => {
    // 99 ASCII chars + a non-BMP char (U+1D54F = \uD835\uDD4F) straddling index 99/100.
    const nonBmp = String.fromCharCode(0xd835, 0xdd4f);
    const rawOutput = "a".repeat(99) + nonBmp + "trailing content";
    const ev = extractEvidenceFromTool("read", undefined, { output: rawOutput }, "call_surrogate");
    if (ev.sourceClass !== "tool_output" || ev.toolOutputClass !== "file_content") {
      throw new Error("expected file_content tool_output evidence");
    }
    const snippet = ev.rawOutputSnippet;
    expect(snippet).toBeDefined();
    expect(hasLoneSurrogate(snippet as string)).toBe(false);
  });
});
