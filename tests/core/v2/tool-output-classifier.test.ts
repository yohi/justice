// tests/core/v2/tool-output-classifier.test.ts
import { describe, expect, it } from "vitest";
import { classifyToolOutputClass } from "../../../src/core/v2/tool-output-classifier";

describe("classifyToolOutputClass", () => {
  it("classifies file-reading tools as file_content", () => {
    expect(classifyToolOutputClass("read", undefined)).toBe("file_content");
    expect(classifyToolOutputClass("glob", undefined)).toBe("file_content");
    expect(classifyToolOutputClass("grep", undefined)).toBe("file_content");
  });

  it("classifies non-shell tools as command_exec", () => {
    expect(classifyToolOutputClass("task", undefined)).toBe("command_exec");
  });

  it("classifies quality-verification compound commands as command_exec", () => {
    expect(classifyToolOutputClass("bash", { command: "bun run lint && bun run test" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "bun run build; bun run typecheck" })).toBe("command_exec");
  });

  it("classifies file-content compound commands as file_content", () => {
    expect(classifyToolOutputClass("bash", { command: "cat file.txt | grep foo" })).toBe("file_content");
    expect(classifyToolOutputClass("bash", { command: "head -20 file.ts && tail -5 file.ts" })).toBe("file_content");
    expect(classifyToolOutputClass("bash", { command: "bun run test && cat docs/superpowers/plans/2026-06-26-justice-v2-foundation.md" })).toBe("file_content");
    expect(classifyToolOutputClass("bash", { command: "python -c \"print(open('file.txt').read())\"" })).toBe("file_content");
    expect(classifyToolOutputClass("bash", { command: "node -e \"console.log(require('fs').readFileSync('file.txt','utf8'))\"" })).toBe("file_content");
  });

  it("classifies stdin pipe filters like grep as command_exec", () => {
    expect(classifyToolOutputClass("bash", { command: "bun run test | grep failed" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "npm run lint | rg 'error'" })).toBe("command_exec");
  });

  it("classifies general command-exec tools (network/VCS/containers/interpreters) as command_exec (Issue 4)", () => {
    expect(classifyToolOutputClass("bash", { command: "curl https://example.com" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "git status" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "docker build -t app ." })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "python script.py" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "go test ./..." })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "make test" })).toBe("command_exec");
  });
});
