// src/core/v2/evidence-engine.ts
import { classifyToolOutputClass } from "./tool-output-classifier";
import { redactEvidenceCommand, redactForPersistence, sliceCodeUnitsSafe } from "./redaction";
import { hashString } from "./hash";
import type { Evidence, Interpretation } from "./observation-model";

type ToolOutputKind = "test" | "build" | "lint" | "command" | "generic";

type ToolOutput = {
  readonly output?: string;
  readonly metadata?: { readonly error?: boolean };
};

const TEST_PATTERN = /\b(vitest|jest|mocha|pytest|test)\b/;
const BUILD_PATTERN = /\b(tsc|typecheck|build|tsup|rollup|webpack|vite)\b/;
const LINT_PATTERN = /\b(eslint|prettier|biome|rome|stylelint|lint|format)\b/;

// "error(s)" is intentionally excluded from the FAIL vocabulary to avoid false positives on passing
// output like "0 errors" / "no errors" / "Found 0 errors." (mirrors declared-claim-extractor's PASS/
// FAIL vocab). Genuine tool failures are still caught by metadata.error, checked first in deriveOutcome.
const OUTPUT_FAIL_PATTERN = /\bfail(?:s|ed|ing|ure|ures)?\b|✗|❌/i;
const OUTPUT_PASS_PATTERN = /\b(?:pass(?:es|ed|ing)?|ok|success|succeeded)\b|✓|✅/i;

/**
 * Maps a tool invocation to its evidence kind. Inspects the tool name and (for shell tools) the
 * command text deterministically: test runners → "test", build/typecheck → "build",
 * linters/formatters → "lint", other shell commands → "command", everything else → "generic".
 */
function mapToolNameToKind(
  toolName: string,
  args: { readonly command?: string } | undefined,
): ToolOutputKind {
  const haystack = `${toolName} ${args?.command ?? ""}`.toLowerCase();
  if (TEST_PATTERN.test(haystack)) return "test";
  if (BUILD_PATTERN.test(haystack)) return "build";
  if (LINT_PATTERN.test(haystack)) return "lint";
  if (toolName === "bash" || toolName === "shell") return "command";
  return "generic";
}

/**
 * Derives a pass/fail/unknown outcome from a tool output's TEXT deterministically. metadata.error is
 * handled by the caller (deriveInterpretationFields) before this runs, so this inspects only the
 * textual output: fail signals first (fail dominates a mixed report), then pass; empty/ambiguous → "unknown".
 */
function deriveOutcome(output: ToolOutput): "pass" | "fail" | "unknown" {
  const text = output.output ?? "";
  if (text.length === 0) return "unknown";
  if (OUTPUT_FAIL_PATTERN.test(text)) return "fail";
  if (OUTPUT_PASS_PATTERN.test(text)) return "pass";
  return "unknown";
}

/**
 * Derives the interpretation outcome+basis pair from a tool invocation. metadata.error dominates
 * (fail / metadata_error); the `task` tool is never text-parsed (unknown / unparsed); everything
 * else is derived from the output text (parsed_output).
 */
function deriveInterpretationFields(
  toolName: string,
  output: ToolOutput,
): { readonly outcome: "pass" | "fail" | "unknown"; readonly basis: Interpretation["basis"] } {
  if (output.metadata?.error) return { outcome: "fail", basis: "metadata_error" };
  if (toolName === "task") return { outcome: "unknown", basis: "unparsed" };
  return { outcome: deriveOutcome(output), basis: "parsed_output" };
}

export function extractEvidenceFromTool(
  toolName: string,
  args: { readonly command?: string } | undefined,
  output: ToolOutput,
  callId: string, // determinism: use callId as evidenceId (FIND-003)
): Evidence {
  const rawOutput = output.output ?? "";
  const toolOutputClass = classifyToolOutputClass(toolName, args);
  const observedId = callId; // Deterministic evidenceId from tool callId (FF-002/FF-003)
  const kind = toolName === "task" ? "generic" : mapToolNameToKind(toolName, args);
  const command = args?.command ? redactEvidenceCommand(args.command) : undefined;
  const { outcome, basis } = deriveInterpretationFields(toolName, output);
  const interpretation: Interpretation = {
    outcome,
    basis,
    provenance: "derived",
    derivedFrom: [{ kind: "self", evidenceId: observedId }], // self-reference within the same record uses SelfEvidenceRef (kind: "self" + evidenceId)
  };

  if (toolOutputClass === "command_exec") {
    return {
      evidenceId: observedId,
      kind,
      sourceClass: "tool_output",
      provenance: "observed",
      toolOutputClass: "command_exec",
      command: command ?? "",
      rawOutput: redactForPersistence(rawOutput),
      interpretation,
    };
  }

  return {
    evidenceId: observedId,
    kind,
    sourceClass: "tool_output",
    provenance: "observed",
    toolOutputClass: "file_content",
    command, // rawOutput must not be stored in file_content
    rawOutputHash: hashString(rawOutput),
    rawOutputSnippet: rawOutput.length > 0 ? redactForPersistence(sliceCodeUnitsSafe(rawOutput, 100)) : undefined,
    interpretation,
  };
}
