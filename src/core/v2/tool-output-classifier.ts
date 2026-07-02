// src/core/v2/tool-output-classifier.ts
const COMMAND_EXEC_COMMANDS = new Set([
  "bun", "npm", "yarn", "pnpm", "node", "ts-node",
  "vitest", "jest", "mocha", "pytest",
  "tsc", "eslint", "prettier", "biome", "rome", "stylelint", "deno",
  // General command-exec tools: interpreters, VCS, containers, network clients, build systems.
  // Their output is process output (not file contents) and is diagnostically valuable, so it must
  // be captured as command_exec (Issue 4). Interpreters that can read a file inline (python/node)
  // are still routed to file_content via FILE_INLINE_READ_PATTERN below.
  "python", "python3",
  "git", "docker", "docker-compose", "podman", "kubectl",
  "curl", "wget",
  "go", "cargo", "rustc", "make", "gradle", "mvn", "dotnet", "java", "gcc", "clang",
]);

const FILE_CONTENT_COMMANDS = new Set([
  "cat", "head", "tail", "less", "more", "nl", "tac", "sed", "awk", "grep", "rg", "ag", "xxd", "od", "hexdump", "strings",
]);

// Inline file-read patterns embedded in interpreter one-liners (node -e ...readFileSync...,
// or python -c open('f').read()). These read file content even though the leading token is a
// command-exec interpreter, so they must be classified as file_content (D49/D52/D60). The full
// open(...) then .read chain is required to avoid over-matching bare open( / .read( (e.g.
// xdg-open(), stream.read()).
const FILE_INLINE_READ_PATTERN = /\breadFileSync\b|\breadFile\b|\bopen\s*\([^)]*\)\s*\.\s*read/;

export function classifyToolOutputClass(
  toolName: string,
  args: { readonly command?: string } | undefined,
): "command_exec" | "file_content" {
  if (toolName === "read" || toolName === "glob" || toolName === "grep") return "file_content";
  if (toolName === "bash" || toolName === "shell") {
    const command = args?.command ?? "";
    // Split by shell delimiters that execute sequential commands (&&, ||, ;)
    // Do NOT split by pipe (|) here to prevent stdin filter utilities (like '| grep')
    // from misclassifying sequential execution as file content.
    const subCommands = command.split(/&&|\|\||;/);
    let hasFileContent = false;
    let hasCommandExec = false;

    for (const sub of subCommands) {
      // Analyze the leading command in the pipeline (before the first '|')
      const pipelineStart = sub.split("|")[0] ?? "";
      const subTokens = pipelineStart.trim().split(/\s+/).filter(Boolean);
      const firstToken = subTokens[0] ?? "";
      if (FILE_CONTENT_COMMANDS.has(firstToken)) {
        hasFileContent = true;
      }
      if (COMMAND_EXEC_COMMANDS.has(firstToken)) {
        hasCommandExec = true;
      }
    }

    // Interpreter one-liners that read a file (e.g. `node -e "...readFileSync..."`) read file
    // content even though their leading token is a command-exec interpreter. file_content wins.
    if (FILE_INLINE_READ_PATTERN.test(command)) {
      hasFileContent = true;
    }

    if (hasFileContent) {
      return "file_content";
    }
    if (hasCommandExec) {
      return "command_exec";
    }
    // Unknown shell commands are classified conservatively from the command text alone.
    return "file_content";
  }
  return "command_exec";
}
