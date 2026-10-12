import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

export type IsolatedProcessOptions = Readonly<{
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly inheritOutput?: boolean;
}>;

export type IsolatedProcessResult = Readonly<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}>;

const activeProcessGroups = new Set<number>();
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const GROUP_TERMINATION_GRACE_MS = 1_000;

export async function runInIsolatedProcessGroup(
  command: string,
  args: readonly string[],
  options: IsolatedProcessOptions = {},
): Promise<IsolatedProcessResult> {
  if (process.platform !== "linux") {
    throw new Error("isolated_process_group_requires_linux");
  }

  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  let outputBytes = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let outputExceeded = false;
  let spawnError: Error | undefined;
  let processGroupId: number | undefined;

  const killGroup = (signal: NodeJS.Signals): void => {
    if (processGroupId === undefined) return;
    try {
      process.kill(-processGroupId, signal);
    } catch (cause) {
      if (isErrnoCode(cause, "ESRCH")) return;
      throw cause;
    }
  };

  const appendOutput = (chunk: Buffer, destination: "stdout" | "stderr"): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes > (options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)) {
      outputExceeded = true;
      killGroup("SIGTERM");
      escalation = setTimeout(() => killGroup("SIGKILL"), GROUP_TERMINATION_GRACE_MS);
      return;
    }
    const text = chunk.toString("utf8");
    if (destination === "stdout") stdout += text;
    else stderr += text;
    if (options.inheritOutput === true) {
      (destination === "stdout" ? process.stdout : process.stderr).write(text);
    }
  };

  child.stdout.on("data", (chunk: Buffer) => appendOutput(chunk, "stdout"));
  child.stderr.on("data", (chunk: Buffer) => appendOutput(chunk, "stderr"));
  child.once("spawn", () => {
    const pid = child.pid;
    if (pid === undefined) return;
    processGroupId = pid;
    activeProcessGroups.add(pid);
    timeout = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      escalation = setTimeout(() => killGroup("SIGKILL"), GROUP_TERMINATION_GRACE_MS);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
  child.once("exit", () => {
    killGroup("SIGTERM");
    escalation ??= setTimeout(() => killGroup("SIGKILL"), GROUP_TERMINATION_GRACE_MS);
  });
  child.once("error", (cause: Error) => {
    spawnError = cause;
    killGroup("SIGKILL");
  });

  return new Promise<IsolatedProcessResult>((resolve, reject) => {
    child.once("close", (code, _signal) => {
      void (async (): Promise<void> => {
        if (timeout !== undefined) clearTimeout(timeout);
        if (escalation !== undefined) clearTimeout(escalation);
        if (processGroupId !== undefined) {
          try {
            await terminateProcessGroup(processGroupId);
          } finally {
            activeProcessGroups.delete(processGroupId);
          }
        }
        if (spawnError !== undefined) {
          reject(spawnError);
          return;
        }
        if (timedOut) {
          reject(new Error(`isolated_process_timed_out_after_${String(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)}ms`));
          return;
        }
        if (outputExceeded) {
          reject(new Error(`isolated_process_output_exceeded_${String(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES)}_bytes`));
          return;
        }
        resolve({ exitCode: code ?? 1, stdout, stderr });
      })().catch(reject);
    });
  });
}

export function installProcessGroupSignalHandlers(): void {
  const exitOnSignal = (signal: NodeJS.Signals, exitCode: number): void => {
    for (const processGroupId of activeProcessGroups) {
      try {
        process.kill(-processGroupId, "SIGKILL");
      } catch (cause) {
        if (!isErrnoCode(cause, "ESRCH")) process.stderr.write(`process-group cleanup failed: ${String(cause)}\n`);
      }
    }
    process.exit(exitCode);
  };

  process.once("SIGINT", () => exitOnSignal("SIGINT", 130));
  process.once("SIGTERM", () => exitOnSignal("SIGTERM", 143));
}

async function terminateProcessGroup(processGroupId: number): Promise<void> {
  try {
    process.kill(-processGroupId, "SIGTERM");
  } catch (cause) {
    if (!isErrnoCode(cause, "ESRCH")) throw cause;
  }

  if (await waitForProcessGroupExit(processGroupId, GROUP_TERMINATION_GRACE_MS)) return;
  try {
    process.kill(-processGroupId, "SIGKILL");
  } catch (cause) {
    if (!isErrnoCode(cause, "ESRCH")) throw cause;
  }
  if (!(await waitForProcessGroupExit(processGroupId, GROUP_TERMINATION_GRACE_MS))) {
    throw new Error("isolated_process_group_cleanup_incomplete");
  }
}

async function waitForProcessGroupExit(processGroupId: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(processGroupId)) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  return !processGroupExists(processGroupId);
}

function processGroupExists(processGroupId: number): boolean {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "utf8");
    } catch (cause) {
      if (isErrnoCode(cause, "ENOENT") || isErrnoCode(cause, "ESRCH")) continue;
      throw cause;
    }
    const closeParen = stat.lastIndexOf(")");
    if (closeParen < 0) continue;
    const fields = stat.slice(closeParen + 2).split(" ");
    const state = fields[0];
    const processGroup = Number(fields[2]);
    if (processGroup === processGroupId && state !== "Z" && state !== "X") return true;
  }
  return false;
}

function isErrnoCode(cause: unknown, expected: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === expected;
}

export function readProcessState(processId: number): string | null {
  try {
    const stat = readFileSync(`/proc/${String(processId)}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    return closeParen < 0 ? null : stat.slice(closeParen + 2).split(" ")[0] ?? null;
  } catch (cause) {
    if (isErrnoCode(cause, "ENOENT")) return null;
    throw cause;
  }
}
