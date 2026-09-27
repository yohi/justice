import { describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { AuthorizationStore, createAuthorizationReviewBoundary } from "../../src/core/plan-authorization";
import { buildCanonicalSnapshot, computePlanFingerprint } from "../../src/core/plan-fingerprint";
import { PlanParser } from "../../src/core/plan-parser";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { ObservationLogStore } from "../../src/runtime/observation-log-store";

const SUPPORTED_OPENCODE_VERSION = /^1\.18\.\d+$/u;
const RUN_LIVE_HOST_E2E = process.env.JUSTICE_RUN_LIVE_HOST_E2E === "1";
const exec = promisify(execFile);
const pluginPath = fileURLToPath(new URL("../../dist/opencode-plugin.js", import.meta.url));

type HostTool = {
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly output: string;
  readonly status: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hostTools(stdout: string): readonly HostTool[] {
  return stdout.split("\n").flatMap((line) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return [];
    }
    if (!isRecord(parsed) || !isRecord(parsed.part)) return [];
    const part = parsed.part;
    if (part.type !== "tool" || typeof part.tool !== "string" || !isRecord(part.state)) return [];
    const state = part.state;
    return [{
      tool: part.tool,
      input: isRecord(state.input) ? state.input : {},
      output: typeof state.output === "string" ? state.output : "",
      status: typeof state.status === "string" ? state.status : "",
    }];
  });
}

function hostSessionId(stdout: string): string {
  for (const line of stdout.split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isRecord(parsed) && typeof parsed.sessionID === "string") return parsed.sessionID;
  }
  throw new Error("unsupported setup: pinned host did not expose a parent session ID");
}

async function supportedHostVersion(): Promise<void> {
  let version: string;
  try {
    version = (await exec("opencode", ["--version"], { timeout: 10_000 })).stdout.trim();
  } catch (cause: unknown) {
    throw new Error("unsupported setup: opencode CLI is not runnable", { cause });
  }
  if (!SUPPORTED_OPENCODE_VERSION.test(version)) {
    throw new Error(
      `unsupported setup: opencode ${version} is installed but the supported host range is 1.18.x`,
    );
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(`unsupported setup: host E2E requires Linux x86_64, found ${process.platform}/${process.arch}`);
  }
}

async function runHost(rootDir: string, prompt: string, sessionId?: string): Promise<string> {
  const config = JSON.stringify({ plugin: [pluginPath] });
  let stdout: string;
  try {
    ({ stdout } = await exec("opencode", ["run", "--format", "json", "--dir", rootDir,
      ...(sessionId === undefined ? [] : ["--session", sessionId]), prompt], {
      cwd: rootDir,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: config },
    }));
  } catch (cause: unknown) {
    throw new Error("unsupported setup: pinned host could not execute the review scenario", { cause });
  }
  return stdout;
}

async function startHostApi(rootDir: string): Promise<{ readonly baseUrl: string; readonly stop: () => Promise<void> }> {
  const socket = createServer();
  await new Promise<void>((resolveListen, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolveListen);
  });
  const address = socket.address();
  if (address === null || typeof address === "string") {
    throw new Error("unsupported setup: could not reserve a local OpenCode API port");
  }
  await new Promise<void>((resolveClose, reject) => {
    socket.close((error) => error === undefined ? resolveClose() : reject(error));
  });

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const serverProcess = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(address.port)], {
    cwd: rootDir,
    env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin: [pluginPath] }) },
    stdio: "ignore",
  });
  let exited = false;
  void once(serverProcess, "exit").then(() => { exited = true; });

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (exited) throw new Error("OpenCode server exited before becoming ready");
      try {
        const response = await fetch(`${baseUrl}/global/health`, { signal: AbortSignal.timeout(1_000) });
        if (response.ok) {
          return {
            baseUrl,
            stop: async (): Promise<void> => {
              if (exited) return;
              serverProcess.kill("SIGTERM");
              await Promise.race([once(serverProcess, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))]);
              if (!exited) {
                serverProcess.kill("SIGKILL");
                await once(serverProcess, "exit");
              }
            },
          };
        }
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    throw new Error("OpenCode server did not become ready within 15 seconds");
  } catch (cause: unknown) {
    serverProcess.kill("SIGTERM");
    throw new Error("unsupported setup: OpenCode API server could not start", { cause });
  }
}

describe.skipIf(!RUN_LIVE_HOST_E2E)("Markdown slash-command precedence (supported-host acceptance)", () => {
  it("preserves a user-defined justice-start Markdown command over auto-registration", async () => {
    await supportedHostVersion();
    const rootDir = await mkdtemp(`${tmpdir()}/justice-command-e2e-`);
    try {
      const commandDir = resolve(rootDir, ".opencode/commands");
      await mkdir(commandDir, { recursive: true });
      await writeFile(resolve(commandDir, "justice-start.md"), [
        "---",
        "description: User-defined start command precedence fixture",
        "---",
        "Reply with exactly MARKDOWN_COMMAND_PRECEDENCE_CONFIRMED and do not call tools.",
      ].join("\n"), "utf8");

      const output = await runHost(rootDir, "/justice-start ignore the supplied arguments");

      expect(output).toContain("MARKDOWN_COMMAND_PRECEDENCE_CONFIRMED");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 130_000);
});

async function hostApiPost(baseUrl: string, path: string, body: unknown): Promise<{ readonly response: Response; readonly value: unknown }> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (cause: unknown) {
    throw new Error("unsupported setup: OpenCode API request could not complete", { cause });
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = text;
  }
  return { response, value };
}

function unsupportedForAuthentication(response: Response, value: unknown): void {
  const detail = typeof value === "string" ? value : JSON.stringify(value);
  if (response.status === 401 || response.status === 403 || /unauthorized|authentication|api key|provider.{0,20}not configured/iu.test(detail)) {
    throw new Error("unsupported setup: OpenCode host authentication or provider is unavailable");
  }
}

function nestedHostTools(value: unknown): readonly HostTool[] {
  if (Array.isArray(value)) return value.flatMap(nestedHostTools);
  if (!isRecord(value)) return [];
  const own = value.type === "tool" && typeof value.tool === "string" && isRecord(value.state)
    ? [{
        tool: value.tool,
        input: isRecord(value.state.input) ? value.state.input : {},
        output: typeof value.state.output === "string" ? value.state.output : "",
        status: typeof value.state.status === "string" ? value.state.status : "",
      }]
    : [];
  return [...own, ...Object.values(value).flatMap(nestedHostTools)];
}

async function seedMandatoryReview(rootDir: string, parentSessionId: string, category: "sp-review" | "sp-final-review"): Promise<void> {
  const fs = new NodeFileSystem(rootDir);
  const planPath = "docs/host-review.md";
  const planContent = "## Task 1: host review\n- [ ] verify\n";
  const taskIds = new PlanParser().parse(planContent).map((task) => task.id);
  await fs.writeFile(planPath, planContent);
  const authorization = await new AuthorizationStore(fs, fs, createAuthorizationReviewBoundary()).approve({
    sessionId: parentSessionId,
    planPath,
    canonicalSnapshot: buildCanonicalSnapshot(planContent, taskIds),
    planFingerprint: computePlanFingerprint(planContent, taskIds),
    approvedAt: "2026-09-05T00:00:00.000Z",
  });
  if (authorization === null || authorization.status !== "active") {
    throw new Error("unsupported setup: failed to seed active host Authorization");
  }
  const writerId = "w-host-review";
  const store = new ObservationLogStore(fs, fs, writerId);
  const envelope = {
    schemaVersion: 1 as const,
    timestamp: "2026-09-05T00:00:00.000Z",
    recordType: "observation" as const,
    agentId: "atlas" as const,
    sessionId: parentSessionId,
    writerId,
  };
  const shard = { agentId: envelope.agentId, sessionId: parentSessionId, writerId };
  const taskExecutionRef = { authorizationId: authorization.authorizationId, taskId: "task-1", attemptId: "attempt-host" };
  if (category === "sp-review") {
    for (const [from, to] of [
      ["pending", "authorized"],
      ["authorized", "in_progress"],
      ["in_progress", "worker_reported"],
      ["worker_reported", "evidence_pending"],
      ["evidence_pending", "review_pending"],
    ] as const) {
      await store.append(shard, { ...envelope, kind: "task_lifecycle_transition", parentSessionId, taskExecutionRef, from, to });
    }
  } else {
    await store.append(shard, { ...envelope, kind: "plan_finalization_transition", parentSessionId,
      authorizationId: authorization.authorizationId, planPath, finalizationAttemptId: "finalization-host",
      finalReviewRound: 1, from: "tasks_pending", to: "all_tasks_accepted" });
    await store.append(shard, { ...envelope, kind: "plan_finalization_transition", parentSessionId,
      authorizationId: authorization.authorizationId, planPath, finalizationAttemptId: "finalization-host",
      finalReviewRound: 1, from: "all_tasks_accepted", to: "final_review_pending" });
  }
  const correlation = category === "sp-review"
    ? { reviewKind: "task-review" as const, taskExecutionRef, reviewRound: 1 }
    : { reviewKind: "final-review" as const, authorizationId: authorization.authorizationId,
        planPath, planFingerprint: authorization.planFingerprint, finalizationAttemptId: "finalization-host", finalReviewRound: 1 };
  await store.append(shard, { ...envelope, kind: "review_dispatch_transition", transitionId: "pending-host-review",
    parentSessionId, correlation, expectedCategory: category, from: null, to: "pending" });
}

describe.skipIf(!RUN_LIVE_HOST_E2E)("review artifact supported-host acceptance (Task 3.6)", () => {
  it.each(["sp-review", "sp-final-review"] as const)(
    "dispatches real %s task and rejects a child write through the built plugin",
    async (category) => {
      await supportedHostVersion();
      const rootDir = await mkdtemp(`${tmpdir()}/justice-host-e2e-`);
      const outsidePath = resolve(rootDir, "outside-target.json");
      try {
        await writeFile(outsidePath, "outside unchanged", "utf8");
        const parentSessionId = hostSessionId(await runHost(rootDir, "Reply READY without calling any tools."));
        await seedMandatoryReview(rootDir, parentSessionId, category);
        const tools = hostTools(await runHost(rootDir,
          `Use the real task tool with category ${category} and run_in_background=false. ` +
          `The child must use its committed review_artifact_path: create a symlink at that path ` +
          `pointing to ${outsidePath}, then attempt the real write tool with filePath ` +
          `equal to review_artifact_path and JSON content {"schemaVersion":1,"complete":true,"findings":[]}. ` +
          `Report the write tool error. Do not replace this with a simulated call.`, parentSessionId,
        ));
        const task = tools.find((tool) => tool.tool === "task" && tool.input.category === category);
        if (task === undefined) {
          throw new Error(`unsupported setup: pinned host did not dispatch the ${category} task tool`);
        }
        expect(task.input.run_in_background).toBe(false);
        const artifactPath = task.input.review_artifact_path;
        if (typeof artifactPath !== "string" || !artifactPath.startsWith(".justice/reviews/")) {
          throw new Error("unsupported setup: child did not receive the committed review_artifact_path");
        }
        const artifactAbsolutePath = resolve(rootDir, artifactPath);
        expect((await lstat(artifactAbsolutePath)).isSymbolicLink()).toBe(true);
        expect(await realpath(artifactAbsolutePath)).toBe(await realpath(outsidePath));
        const write = tools.find((tool) => tool.tool === "write" && tool.input.filePath === artifactPath);
        if (write === undefined) throw new Error("unsupported setup: pinned host did not dispatch the child write tool");
        expect(write.status).toBe("error");
        expect(write.output).toContain("ReviewArtifactWriteCancelled");
        expect(write.output).toContain("review_artifact_write_rejected");
        expect(await readFile(outsidePath, "utf8")).toBe("outside unchanged");
      } finally {
        await rm(rootDir, { recursive: true, force: true });
      }
    },
    150_000,
  );
});

describe.skipIf(!RUN_LIVE_HOST_E2E)("Justice slash command registration on supported host", () => {
  it("executes justice-start through the host Command service", async () => {
    await supportedHostVersion();
    const rootDir = await mkdtemp(`${tmpdir()}/justice-command-host-e2e-`);
    let host: Awaited<ReturnType<typeof startHostApi>> | undefined;
    try {
      host = await startHostApi(rootDir);
      const directory = encodeURIComponent(rootDir);
      const session = await hostApiPost(host.baseUrl, `/session?directory=${directory}`, {});
      unsupportedForAuthentication(session.response, session.value);
      expect(session.response.ok).toBe(true);
      if (!isRecord(session.value) || typeof session.value.id !== "string") {
        throw new Error("unsupported setup: OpenCode did not return a session ID");
      }

      const invoked = await hostApiPost(
        host.baseUrl,
        `/session/${encodeURIComponent(session.value.id)}/command?directory=${directory}`,
        { command: "justice-start", arguments: "host command service integration check" },
      );
      unsupportedForAuthentication(invoked.response, invoked.value);
      expect(invoked.response.ok).toBe(true);

      const records = await new ObservationLogStore(
        new NodeFileSystem(rootDir),
        new NodeFileSystem(rootDir),
        "w-command-e2e",
      ).readAll();
      expect(records.some((record) => record.recordType === "observation" && record.kind === "workflow_started")).toBe(true);
    } finally {
      await host?.stop();
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 150_000);

  it("reflects justice-implement arming in the next real task tool call", async () => {
    await supportedHostVersion();
    const rootDir = await mkdtemp(`${tmpdir()}/justice-command-host-e2e-`);
    let host: Awaited<ReturnType<typeof startHostApi>> | undefined;
    try {
      const planPath = "docs/host-plan.md";
      await mkdir(resolve(rootDir, "docs"), { recursive: true });
      const planContent = "## Task 1: host task\n- [ ] verify host task command\n";
      await writeFile(resolve(rootDir, planPath), planContent, "utf8");
      host = await startHostApi(rootDir);
      const directory = encodeURIComponent(rootDir);
      const session = await hostApiPost(host.baseUrl, `/session?directory=${directory}`, {});
      unsupportedForAuthentication(session.response, session.value);
      expect(session.response.ok).toBe(true);
      if (!isRecord(session.value) || typeof session.value.id !== "string") {
        throw new Error("unsupported setup: OpenCode did not return a session ID");
      }
      const sessionId = session.value.id;

      const taskIds = new PlanParser().parse(planContent).map((task) => task.id);
      const fs = new NodeFileSystem(rootDir);
      const approved = await new AuthorizationStore(fs, fs, createAuthorizationReviewBoundary()).approve({
        sessionId,
        planPath,
        canonicalSnapshot: buildCanonicalSnapshot(planContent, taskIds),
        planFingerprint: computePlanFingerprint(planContent, taskIds),
        approvedAt: "2026-09-27T00:00:00.000Z",
      });
      expect(approved?.status).toBe("active");

      const arm = await hostApiPost(
        host.baseUrl,
        `/session/${encodeURIComponent(sessionId)}/command?directory=${directory}`,
        { command: "justice-implement", arguments: `--plan ${planPath} --approved` },
      );
      unsupportedForAuthentication(arm.response, arm.value);
      expect(arm.response.ok).toBe(true);

      const taskRequest = await hostApiPost(
        host.baseUrl,
        `/session/${encodeURIComponent(sessionId)}/message?directory=${directory}`,
        {
          parts: [{
            type: "text",
            text: "Call the task tool exactly once with the approved plan task. Use a short prompt and do not claim completion.",
          }],
        },
      );
      unsupportedForAuthentication(taskRequest.response, taskRequest.value);
      expect(taskRequest.response.ok).toBe(true);
      const task = nestedHostTools(taskRequest.value).find((tool) => tool.tool === "task");
      expect(task).toBeDefined();
      expect(task?.input.prompt).toEqual(expect.stringContaining("[JUSTICE: IMPLEMENTATION]"));
    } finally {
      await host?.stop();
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 150_000);
});
