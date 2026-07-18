// src/core/v2/tool-output-classifier.ts
const COMMAND_EXEC_COMMANDS = new Set([
  "bun",
  "npm",
  "yarn",
  "pnpm",
  "node",
  "ts-node",
  "vitest",
  "jest",
  "mocha",
  "pytest",
  "tsc",
  "eslint",
  "prettier",
  "biome",
  "rome",
  "stylelint",
  "deno",
  // General command-exec tools: interpreters, VCS, containers, network clients, build systems.
  // Their output is process output (not file contents) and is diagnostically valuable, so it must
  // be captured as command_exec (Issue 4). Interpreters that can read a file inline (python/node)
  // are still routed to file_content via FILE_INLINE_READ_PATTERN below.
  "python",
  "python3",
  "git",
  "docker",
  "docker-compose",
  "podman",
  "kubectl",
  "curl",
  "wget",
  "go",
  "cargo",
  "rustc",
  "make",
  "gradle",
  "mvn",
  "dotnet",
  "java",
  "gcc",
  "clang",
]);

const FILE_CONTENT_COMMANDS = new Set([
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "nl",
  "tac",
  "sed",
  "awk",
  "grep",
  "rg",
  "ag",
  "xxd",
  "od",
  "hexdump",
  "strings",
]);

// Wrapper/runner prefixes: the tool actually executed is a later token (e.g. `uv run pytest`,
// `poetry run ruff`, `npx vitest`, `bunx tsc`). A command wrapped by these is process execution,
// so it is command_exec unless the wrapped tool is itself a file reader (resolved by the unwrap below).
const RUNNER_PREFIXES = new Set([
  "uv",
  "poetry",
  "pipx",
  "pdm",
  "hatch",
  "rye",
  "npx",
  "bunx",
  "nix",
]);

// Interpreters that may read a file inline via -e/-c one-liners. The inline-read scan runs ONLY when
// the (unwrapped) leading token is one of these, so an incidental `open(...).read` in another
// command's arguments (e.g. a git commit message) is not misclassified as file_content.
const INTERPRETERS = new Set(["python", "python3", "node", "ts-node", "deno", "bun"]);

const GIT_FILE_CONTENT_SUBCOMMAND_PATTERN =
  /^(?:diff|diff-files|diff-index|diff-tree|show|grep|blame|annotate|cat-file|range-diff)$/;
const GIT_GLOBAL_OPTION_PATTERN =
  /^(?:--no-pager|--paginate|-p|--no-replace-objects|--bare|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs)$/;
const GIT_GLOBAL_OPTION_WITH_VALUE_PATTERN =
  /^(?:-C|-c|--git-dir|--work-tree|--namespace|--super-prefix|--config-env)$/;
const GIT_PATCH_OUTPUT_OPTION_PATTERN = /^(?:-p|-u|--patch|--patch-with-stat)$/;

// Inline file-read one-liners embedded in interpreter invocations (e.g. `node -e "...readFileSync..."`,
// `python -c "open('f').read()"`, `python -c "Path('f').read_text()"`). These read file content even
// though the leading token is a command-exec interpreter (D49/D52/D60). Requiring the full
// `open(...).read` / `.read_text(` / `readFile[Sync]` shape — and applying it only when the leading
// token is an interpreter (see classify below) — avoids matching incidental substrings in arguments.
const FILE_INLINE_READ_PATTERN =
  /\breadFileSync\b|\breadFile\b|\bopen\s*\([^)]*\)\s*\.\s*read|\.read_text\s*\(/;

export function classifyToolOutputClass(
  toolName: string,
  args: { readonly command?: string } | undefined,
): "command_exec" | "file_content" {
  if (toolName === "read" || toolName === "glob" || toolName === "grep") return "file_content";
  if (toolName === "bash" || toolName === "shell") {
    return classifyShellCommand(args?.command ?? "");
  }
  return "command_exec";
}

// Unwraps runner/wrapper prefixes (uv run / poetry run / npx / bunx / pipx run …) to reach the tool
// actually executed, skipping a run/dlx/exec sub-keyword and any flags after the runner. `sawRunner`
// records that a runner was present, so a runner-wrapped invocation is treated as process execution.
function unwrapRunnerPrefixes(tokens: readonly string[]): {
  readonly firstToken: string;
  readonly sawRunner: boolean;
  readonly unwrappedTokens: readonly string[];
} {
  let rest = tokens;
  let sawRunner = false;
  while (rest.length > 0 && RUNNER_PREFIXES.has(rest[0]!)) {
    sawRunner = true;
    rest = rest.slice(1);
    while (rest.length > 0) {
      const next = rest[0]!;
      if (next === "run" || next === "dlx" || next === "exec" || next.startsWith("-")) {
        rest = rest.slice(1);
      } else {
        break;
      }
    }
  }
  return { firstToken: rest[0] ?? "", sawRunner, unwrappedTokens: rest };
}

function findGitSubcommandIndex(tokens: readonly string[]): number | null {
  let index = 1;
  while (index < tokens.length) {
    const argument = tokens.at(index);
    if (argument === undefined) return null;
    if (GIT_GLOBAL_OPTION_PATTERN.test(argument)) {
      index++;
      continue;
    }
    if (GIT_GLOBAL_OPTION_WITH_VALUE_PATTERN.test(argument)) {
      index += 2;
      continue;
    }
    if (
      (argument.startsWith("-C") && argument.length > 2) ||
      (argument.startsWith("-c") && argument.length > 2) ||
      (argument.startsWith("--git-dir=") && argument.length > "--git-dir=".length) ||
      (argument.startsWith("--work-tree=") && argument.length > "--work-tree=".length) ||
      (argument.startsWith("--namespace=") && argument.length > "--namespace=".length) ||
      (argument.startsWith("--super-prefix=") && argument.length > "--super-prefix=".length) ||
      (argument.startsWith("--config-env=") && argument.length > "--config-env=".length)
    ) {
      index++;
      continue;
    }
    return index;
  }
  return null;
}

function hasGitPatchOutputOption(tokens: readonly string[]): boolean {
  return tokens.some(
    (argument) =>
      GIT_PATCH_OUTPUT_OPTION_PATTERN.test(argument) ||
      argument.startsWith("--patch=") ||
      argument.startsWith("-U") ||
      argument.startsWith("--unified="),
  );
}

function isGitFileContentCommand(tokens: readonly string[]): boolean {
  const subcommandIndex = findGitSubcommandIndex(tokens);
  if (subcommandIndex === null) return false;

  const subcommand = tokens.at(subcommandIndex);
  if (subcommand === undefined) return false;
  if (GIT_FILE_CONTENT_SUBCOMMAND_PATTERN.test(subcommand)) return true;

  const subcommandArguments = tokens.slice(subcommandIndex + 1);
  if (subcommand === "log") return hasGitPatchOutputOption(subcommandArguments);
  return subcommand === "format-patch" && subcommandArguments.includes("--stdout");
}

// Classifies a full shell command string. Splits by sequential delimiters (&&, ||, ;) — NOT by pipe
// (|), so stdin filter utilities (like '| grep') do not mask sequential execution — and inspects the
// leading token of each pipeline. file_content wins if any sub-command reads file content; otherwise
// command_exec if any is process execution; unknown commands fall back conservatively to file_content.
function classifyShellCommand(command: string): "command_exec" | "file_content" {
  const subCommands = command.split(/&&|\|\||;/);
  let hasFileContent = false;
  let hasCommandExec = false;

  for (const sub of subCommands) {
    // Analyze the leading command in the pipeline (before the first '|').
    const pipelineStart = sub.split("|")[0]!;
    const tokens = pipelineStart.trim().split(/\s+/).filter(Boolean);
    const { firstToken, sawRunner, unwrappedTokens } = unwrapRunnerPrefixes(tokens);

    if (FILE_CONTENT_COMMANDS.has(firstToken)) hasFileContent = true;
    if (firstToken === "git" && isGitFileContentCommand(unwrappedTokens)) hasFileContent = true;
    // A runner-wrapped invocation executes a process; treat as command_exec.
    if (sawRunner || COMMAND_EXEC_COMMANDS.has(firstToken)) hasCommandExec = true;
    // Interpreter one-liners that read a file (e.g. `node -e "...readFileSync..."`,
    // `python -c "open('f').read()"`) read file content even though the leading token is a
    // command-exec interpreter. Scoped to interpreters to avoid matching incidental substrings.
    if (INTERPRETERS.has(firstToken) && FILE_INLINE_READ_PATTERN.test(sub)) hasFileContent = true;
  }

  if (hasFileContent) return "file_content";
  if (hasCommandExec) return "command_exec";
  // Unknown shell commands are classified conservatively from the command text alone.
  return "file_content";
}
