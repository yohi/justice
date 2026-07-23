// tests/core/v2/tool-output-classifier.test.ts
import { describe, expect, it } from "vitest";
import { classifyToolOutputClass } from "../../../src/core/v2/tool-output-classifier";

const GIT_COMMAND_CLASSIFICATION_CASES = [
  { command: "git diff", expected: "file_content" },
  { command: "git diff-files --name-only", expected: "file_content" },
  { command: "git diff-index --cached HEAD", expected: "file_content" },
  { command: "git diff-tree --no-commit-id -r HEAD", expected: "file_content" },
  { command: "git annotate src/index.ts", expected: "file_content" },
  { command: "git show HEAD", expected: "file_content" },
  { command: "git grep TODO", expected: "file_content" },
  { command: "git blame src/index.ts", expected: "file_content" },
  { command: "git cat-file -p HEAD:README.md", expected: "file_content" },
  { command: "git range-diff main...HEAD", expected: "file_content" },
  { command: "git log -p --oneline", expected: "file_content" },
  { command: "git log --patch-with-stat", expected: "file_content" },
  { command: "git format-patch --stdout HEAD~1", expected: "file_content" },
  {
    command: "git --no-pager -C worktree -c color.ui=false diff --cached",
    expected: "file_content",
  },
  {
    command: "git -Cworktree --git-dir=.git diff",
    expected: "file_content",
  },
  { command: "git --no-optional-locks diff", expected: "file_content" },
  { command: "git status --short", expected: "command_exec" },
  { command: "git commit -m message", expected: "command_exec" },
  { command: "git log --oneline", expected: "command_exec" },
  { command: "git rev-parse HEAD", expected: "command_exec" },
  { command: "git format-patch -1", expected: "command_exec" },
  { command: "git status && git diff --cached", expected: "file_content" },
] as const;

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
    expect(classifyToolOutputClass("bash", { command: "bun run lint && bun run test" })).toBe(
      "command_exec",
    );
    expect(classifyToolOutputClass("bash", { command: "bun run build; bun run typecheck" })).toBe(
      "command_exec",
    );
  });

  it("classifies file-content compound commands as file_content", () => {
    expect(classifyToolOutputClass("bash", { command: "cat file.txt | grep foo" })).toBe(
      "file_content",
    );
    expect(
      classifyToolOutputClass("bash", { command: "head -20 file.ts && tail -5 file.ts" }),
    ).toBe("file_content");
    expect(
      classifyToolOutputClass("bash", {
        command: "bun run test && cat docs/superpowers/plans/2026-06-26-justice-v2-foundation.md",
      }),
    ).toBe("file_content");
    expect(
      classifyToolOutputClass("bash", { command: "python -c \"print(open('file.txt').read())\"" }),
    ).toBe("file_content");
    expect(
      classifyToolOutputClass("bash", {
        command: "node -e \"console.log(require('fs').readFileSync('file.txt','utf8'))\"",
      }),
    ).toBe("file_content");
  });

  it("classifies stdin pipe filters like grep as command_exec", () => {
    expect(classifyToolOutputClass("bash", { command: "bun run test | grep failed" })).toBe(
      "command_exec",
    );
    expect(classifyToolOutputClass("bash", { command: "npm run lint | rg 'error'" })).toBe(
      "command_exec",
    );
  });

  it("classifies a file-reading command after a pipeline as file_content", () => {
    expect(classifyToolOutputClass("bash", { command: "bun run test | cat secret.txt" })).toBe(
      "file_content",
    );
  });

  it("classifies general command-exec tools (network/VCS/containers/interpreters) as command_exec (Issue 4)", () => {
    expect(classifyToolOutputClass("bash", { command: "curl https://example.com" })).toBe(
      "command_exec",
    );
    expect(classifyToolOutputClass("bash", { command: "git status" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "docker build -t app ." })).toBe(
      "command_exec",
    );
    expect(classifyToolOutputClass("bash", { command: "python script.py" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "go test ./..." })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "make test" })).toBe("command_exec");
  });

  it("classifies Git output by content-producing subcommand", () => {
    for (const { command, expected } of GIT_COMMAND_CLASSIFICATION_CASES) {
      expect(classifyToolOutputClass("bash", { command })).toBe(expected);
    }
  });

  it("unwraps runner prefixes (uv/poetry/npx/bunx) to classify wrapped tool as command_exec (Issue 3)", () => {
    expect(classifyToolOutputClass("bash", { command: "uv run pytest" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "uv run --frozen pytest -q" })).toBe(
      "command_exec",
    );
    expect(classifyToolOutputClass("bash", { command: "poetry run ruff check" })).toBe(
      "command_exec",
    );
    expect(classifyToolOutputClass("bash", { command: "npx vitest run" })).toBe("command_exec");
    expect(classifyToolOutputClass("bash", { command: "bunx tsc --noEmit" })).toBe("command_exec");
  });

  it("keeps a wrapped interpreter inline file read as file_content", () => {
    expect(
      classifyToolOutputClass("bash", {
        command: "uv run python -c \"print(open('f.txt').read())\"",
      }),
    ).toBe("file_content");
  });

  it("does not misclassify exec commands that mention open().read in arguments as file_content (Issue 5)", () => {
    expect(
      classifyToolOutputClass("bash", {
        command: 'git commit -m "refactor open(cfg).read() call"',
      }),
    ).toBe("command_exec");
  });

  it("classifies unknown shell commands conservatively as file_content (fallback)", () => {
    expect(classifyToolOutputClass("bash", { command: "unknowncmd --flag arg" })).toBe(
      "file_content",
    );
    expect(classifyToolOutputClass("bash", { command: "" })).toBe("file_content");
    // args undefined → args?.command ?? "" fallback → empty command → file_content
    expect(classifyToolOutputClass("bash", undefined)).toBe("file_content");
  });

  it("unwraps runner run sub-keyword and flags, and handles the shell tool", () => {
    expect(classifyToolOutputClass("bash", { command: "poetry run --no-root pytest" })).toBe(
      "command_exec",
    );
    expect(classifyToolOutputClass("shell", { command: "pipx run black ." })).toBe("command_exec");
  });
});
