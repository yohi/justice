import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("review artifact supported-host acceptance (Task 3.6)", () => {
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
          `pointing to outside-target.json, then attempt the real write tool with filePath ` +
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
