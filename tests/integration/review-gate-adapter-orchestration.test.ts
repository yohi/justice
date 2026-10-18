import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem } from "../helpers/mock-file-system";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.JUSTICE_REVIEW_GATE_ROOT;
  for (const root of workspaceRoots) rmSync(root, { recursive: true, force: true });
  workspaceRoots.clear();
});

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/plan.md";
const DESIGN_CONTENT = "# Design\nAcceptance boundary.\n";
const PLAN_CONTENT = "## Task 1: Verification\n- [ ] Verify the boundary\n";
const workspaceRoots = new Set<string>();

async function createAdapter(): Promise<{
  readonly adapter: OpenCodeAdapter;
  readonly fs: ReturnType<typeof createMockFileSystem>;
  readonly workspaceRoot: string;
}> {
  const graphRoot = mkdtempSync(join(tmpdir(), "justice-rg-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "justice-rg-workspace-"));
  workspaceRoots.add(graphRoot);
  workspaceRoots.add(workspaceRoot);
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
    fakeInit({
      project: { root: workspaceRoot },
      directory: workspaceRoot,
      worktree: workspaceRoot,
    }),
  );
  await adapter.ensureInitialized();
  await adapter.onEvent({
    event: {
      id: "controller-created",
      type: "session.created",
      properties: { info: { id: "controller", parentID: "main" } },
    },
  });
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("Justice was not initialized");
  return { adapter, fs, workspaceRoot };
}



it("blocks a zero-finding gate when the trusted witness is unavailable", async () => {
  const { adapter } = await createAdapter();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("missing justice");
  const planBridge = justice.getPlanBridge();

  const started = await planBridge.handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  expect(started.dispatched).toBe(false);
  expect(started.gateId).toBeUndefined();
  expect(started.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
  expect(planBridge.getReviewGateLock("main")).toBeUndefined();
});

it("blocks remediation routing when the trusted witness is unavailable", async () => {
  const { adapter } = await createAdapter();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("missing justice");
  const planBridge = justice.getPlanBridge();

  const started = await planBridge.handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  expect(started.dispatched).toBe(false);
  expect(started.gateId).toBeUndefined();
  expect(started.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
  expect(planBridge.getReviewGateLock("main")).toBeUndefined();
});

it("blocks history and approved-Design reads when the trusted witness is unavailable", async () => {
  const { adapter } = await createAdapter();
  const justice = adapter.getJustice();
  if (justice === null) throw new Error("missing justice");
  const planBridge = justice.getPlanBridge();

  const started = await planBridge.handleReviewGateStart("main", {
    source: "command",
    designPath: DESIGN_PATH,
    planPath: PLAN_PATH,
  });
  expect(started.dispatched).toBe(false);
  expect(started.gateId).toBeUndefined();
  expect(started.guidance).toContain("[JUSTICE: REVIEW GATE BLOCKED]");
  expect(planBridge.getReviewGateLock("main")).toBeUndefined();
  });
