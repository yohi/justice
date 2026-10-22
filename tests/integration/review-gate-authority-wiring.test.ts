import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem } from "../helpers/mock-file-system";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/plan.md";
const DESIGN_CONTENT = "# Design\n";
const PLAN_CONTENT = "## Plan\n- [ ] Verify authority\n";
const temporaryRoots = new Set<string>();

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.JUSTICE_REVIEW_GATE_ROOT;
  delete process.env.JUSTICE_REVIEW_GATE_WITNESS_DIR;
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
  temporaryRoots.clear();
});

async function createAdapter(): Promise<{
  readonly adapter: OpenCodeAdapter;
  readonly graphRoot: string;
  readonly workspaceRoot: string;
}> {
  const graphRoot = mkdtempSync(join(tmpdir(), "justice-authority-graph-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "justice-authority-workspace-"));
  temporaryRoots.add(graphRoot);
  temporaryRoots.add(workspaceRoot);
  process.env.JUSTICE_REVIEW_GATE_ROOT = graphRoot;
  mkdirSync(join(workspaceRoot, "docs/specs"), { recursive: true });
  mkdirSync(join(workspaceRoot, "docs/plans"), { recursive: true });
  writeFileSync(join(workspaceRoot, DESIGN_PATH), DESIGN_CONTENT);
  writeFileSync(join(workspaceRoot, PLAN_PATH), PLAN_CONTENT);
  execFileSync("git", ["init", "-q"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.name", "Justice Test"], { cwd: workspaceRoot });
  execFileSync("git", ["add", DESIGN_PATH, PLAN_PATH], { cwd: workspaceRoot });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "test baseline"], {
    cwd: workspaceRoot,
  });

  const fs = createMockFileSystem({
    [DESIGN_PATH]: DESIGN_CONTENT,
    [PLAN_PATH]: PLAN_CONTENT,
  });
  vi.spyOn(NodeFileSystem.prototype, "readFile").mockImplementation(fs.readFile);
  vi.spyOn(NodeFileSystem.prototype, "fileExists").mockImplementation(fs.fileExists);
  vi.spyOn(NodeFileSystem.prototype, "listFiles").mockImplementation(fs.listFiles);
  vi.spyOn(NodeFileSystem.prototype, "readFileStats").mockImplementation(fs.readFileStats);
  vi.spyOn(NodeFileSystem.prototype, "writeFile").mockImplementation(fs.writeFile);
  vi.spyOn(NodeFileSystem.prototype, "mkdir").mockImplementation(fs.mkdir);
  vi.spyOn(NodeFileSystem.prototype, "rename").mockImplementation(fs.rename);

  const adapter = new OpenCodeAdapter(
    fakeInit({ project: { root: workspaceRoot }, directory: workspaceRoot, worktree: workspaceRoot }),
  );
  await adapter.ensureInitialized();
  return { adapter, graphRoot, workspaceRoot };
}

async function runReviewGateCommand(adapter: OpenCodeAdapter): Promise<string> {
  type CommandOutput = Parameters<OpenCodeAdapter["onCommandExecuteBefore"]>[1];
  const output: CommandOutput = {
    parts: [
      {
        type: "subtask",
        agent: "justice-review-controller",
        description: "Run the Justice Design / Implementation Plan review gate",
        model: { providerID: "test", modelID: "test" },
        prompt: `--design ${DESIGN_PATH} --plan ${PLAN_PATH}`,
      } as unknown as CommandOutput["parts"][number],
    ],
  };
  await adapter.onCommandExecuteBefore(
    {
      command: "justice-review-gate",
      sessionID: "authority-session",
      arguments: `--design ${DESIGN_PATH} --plan ${PLAN_PATH}`,
    },
    output,
  );
  const part = output.parts[0];
  if (part === undefined || !("text" in part) || typeof part.text !== "string") {
    throw new Error("Review Gate command did not return blocked guidance");
  }
  return part.text;
}

describe("production Review Gate authority wiring", () => {
  it("blocks command when native or trusted witness is unavailable", async () => {
    const { adapter, graphRoot, workspaceRoot } = await createAdapter();
    const unsafeWitnessDirectory = join(workspaceRoot, ".justice", "review-gates", "witness");
    const scenarios: readonly [string, string | undefined][] = [
      ["absent witness directory", join(graphRoot, "missing-witness")],
      ["absent installation", join(graphRoot, "empty-witness")],
      ["corrupt installation", join(graphRoot, "corrupt-witness")],
      ["unsafe workspace witness configuration", unsafeWitnessDirectory],
    ];
    mkdirSync(join(graphRoot, "empty-witness"), { recursive: true });
    mkdirSync(join(graphRoot, "corrupt-witness"), { recursive: true });
    writeFileSync(join(graphRoot, "corrupt-witness", "installation.json"), "not-json");

    for (const [scenario, witnessDirectory] of scenarios) {
      if (witnessDirectory === undefined) delete process.env.JUSTICE_REVIEW_GATE_WITNESS_DIR;
      else process.env.JUSTICE_REVIEW_GATE_WITNESS_DIR = witnessDirectory;

      const guidance = await runReviewGateCommand(adapter);

      expect(guidance, scenario).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
      expect(guidance, scenario).not.toContain("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
      expect(adapter.getJustice()?.getPlanBridge().getReviewGateLock("authority-session"), scenario).toBeUndefined();
      expect(existsSync(join(graphRoot, ".justice", "review-gates")), scenario).toBe(false);
    }
  });

  it("does not fall back when graph construction fails", async () => {
    const { adapter, graphRoot } = await createAdapter();

    const guidance = await runReviewGateCommand(adapter);

    expect(guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
    expect(guidance).not.toContain("[JUSTICE: REVIEW GATE OPERATION PAYLOAD]");
    expect(adapter.getJustice()?.getPlanBridge().getReviewGateLock("authority-session")).toBeUndefined();
    expect(existsSync(join(graphRoot, ".justice", "review-gates"))).toBe(false);
  });
});
