import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NodeFileSystem } from "../../src/runtime/node-file-system";
import { OpenCodeAdapter } from "../../src/runtime/opencode-adapter";
import { computeWorkspaceIdentity } from "../../src/core/review-gate/identity";
import { createLinuxReviewGateProvider } from "../../src/runtime/linux-review-gate-provider";
import { createReviewGateEventStore } from "../../src/runtime/review-gate-event-store";
import { createReviewGateLockManager } from "../../src/runtime/review-gate-lock-manager";
import { resolveRequirementsForAdmission } from "../../src/runtime/review-gate-requirements";
import { createReviewGateScopeAdmission } from "../../src/runtime/review-gate-scope-admission";
import { authorizeFirstWorkspaceEnrollment, createReviewGateScopeWitness } from "../../src/runtime/review-gate-scope-witness";
import { createReviewGateCoordinator } from "../../src/runtime/review-gate-coordinator";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import { createWitnessFixture } from "../runtime/review-gate-witness-fixtures";
import { fakeInit } from "../helpers/fake-opencode-init";
import { createMockFileSystem } from "../helpers/mock-file-system";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/plan.md";
const REQUIREMENTS_PATH = "docs/requirements.md";
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
  it("creates a V2 genesis from CLI Requirements and first enrollment authority", async () => {
    const fixture = await createWitnessFixture();
    const { root, sandbox, directory, admin, approve } = fixture;
    const requirementsContent = "# Requirements\n\n- Preserve explicit CLI selection.\n";
    mkdirSync(join(root, "docs/specs"), { recursive: true });
    mkdirSync(join(root, "docs/plans"), { recursive: true });
    writeFileSync(join(root, DESIGN_PATH), "# Design\n\nImplementation: docs/requirements.md\n");
    writeFileSync(join(root, PLAN_PATH), PLAN_CONTENT);
    writeFileSync(join(root, REQUIREMENTS_PATH), requirementsContent);
    execFileSync("git", ["-C", root, "add", DESIGN_PATH, PLAN_PATH, REQUIREMENTS_PATH]);
    execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "commit review artifacts"]);

    const workspaceIdentity = computeWorkspaceIdentity(root);
    const lockManager = createReviewGateLockManager(root, {
      provider: createLinuxReviewGateProvider(root) ?? null,
    });
    const witness = createReviewGateScopeWitness({
      workspaceRoot: root,
      workspaceIdentity,
      witnessDirectory: directory,
      hostTrustRoot: admin.publicKey,
      lockManager,
      authorizeAdmittedMembership: approve,
    });
    await authorizeFirstWorkspaceEnrollment({
      witness,
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      workflowNonce: "cli-requirements-genesis",
      operationId: "cli-requirements-genesis-enrollment",
      authorize: approve,
    });
    const eventStore = createReviewGateEventStore(root, {
      workspaceIdentity,
      writerId: "cli-requirements-genesis-writer",
      witness,
    });
    const protocol = createReviewGateProtocolDescriptor();
    const workspaceReader = {
      readWorkspaceFile: async (filePath: string) => {
        const fullPath = filePath.startsWith("/") ? filePath : join(root, filePath);
        return existsSync(fullPath) ? readFileSync(fullPath) : null;
      },
    };
    const scopeAdmission = createReviewGateScopeAdmission({
      witness,
      eventStore,
      lockManager,
      workspaceReader,
      requirementsResolver: resolveRequirementsForAdmission,
      protocolRelease: {
        readVerifiedPhaseProtocolDelta: async () => "BLOCK",
      },
    });
    const coordinator = createReviewGateCoordinator({
      eventStore,
      lockManager,
      protocol,
      workspaceReader,
      workspaceRoot: root,
      workspaceIdentity,
      mutationSubstrate: null,
      scopeAdmission,
      inspectTargets: async (paths) => new Map(paths.map((filePath) => [filePath, "clean_committed" as const])),
    });
    try {
      const result = await coordinator.startOrResume("cli-requirements-session", {
        source: "command",
        designPath: DESIGN_PATH,
        planPath: PLAN_PATH,
        requirementsPath: REQUIREMENTS_PATH,
      });
      expect(result.dispatched).toBe(false);
      expect(result.gateId).toBeNull();
      expect(result.lockPhase).toBeNull();
      const gateIds = await eventStore.listGateIds();
      expect(gateIds).toHaveLength(1);
      const [gateId] = gateIds;
      if (gateId === undefined) throw new Error("V2 genesis gate missing");

      expect(await eventStore.listGateIds()).toContain(gateId);
      const journal = await eventStore.readV2Journal(gateId);
      const genesis = journal.events.find((event) => "schemaVersion" in event && event.schemaVersion === 2 && event.eventType === "GATE_CREATED");
      expect(genesis).toBeDefined();
      if (genesis === undefined || genesis.eventType !== "GATE_CREATED" || !("schemaVersion" in genesis)) {
        throw new Error("V2 genesis event missing");
      }
      expect(genesis.payload.requirementsResolution).toMatchObject({
        source: "explicit",
        canonicalPath: REQUIREMENTS_PATH,
      });
      expect(genesis.payload.requirementsResolution).toMatchObject({ schemaVersion: 2 });
      expect(await eventStore.readScopeIndex(genesis.payload.reviewScopeId)).toBe(gateId);
      const frontier = await witness.readWorkspaceScopeFrontier(workspaceIdentity);
      const membership = frontier.scopes.flatMap((scope) => scope.gateMembership).find((entry) => entry.gateId === gateId);
      expect(membership?.admissionEventId).toBe(genesis.eventId);
      expect(frontier.scopes).toHaveLength(1);
      expect(frontier.scopes[0]).toMatchObject({
        provenance: { kind: "verified_genesis" },
        gateMembership: [{ gateId }],
      });
      expect(frontier.scopes[0]?.provenance.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      eventStore.close();
      witness.close();
      lockManager.close();
      fixture.witness.close();
      await rmSync(sandbox, { recursive: true, force: true });
      await rmSync(root, { recursive: true, force: true });
      await rmSync(`${root}.witness`, { recursive: true, force: true });
    }
  });

  it("creates a V2 genesis with RR1 auto-resolved Requirements", async () => {
    const fixture = await createWitnessFixture();
    const { root, sandbox, directory, admin, approve } = fixture;
    mkdirSync(join(root, "docs/specs"), { recursive: true });
    mkdirSync(join(root, "docs/plans"), { recursive: true });
    writeFileSync(join(root, DESIGN_PATH), '# Design\n\n<!-- justice-review-gate:requirements="docs/requirements.md" -->\n');
    writeFileSync(join(root, PLAN_PATH), PLAN_CONTENT);
    writeFileSync(join(root, REQUIREMENTS_PATH), "# Requirements\n\n- Auto-resolved.\n");
    execFileSync("git", ["-C", root, "add", DESIGN_PATH, PLAN_PATH, REQUIREMENTS_PATH]);
    execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "commit review artifacts"]);

    const workspaceIdentity = computeWorkspaceIdentity(root);
    const lockManager = createReviewGateLockManager(root, {
      provider: createLinuxReviewGateProvider(root) ?? null,
    });
    const witness = createReviewGateScopeWitness({
      workspaceRoot: root,
      workspaceIdentity,
      witnessDirectory: directory,
      hostTrustRoot: admin.publicKey,
      lockManager,
      authorizeAdmittedMembership: approve,
    });
    await authorizeFirstWorkspaceEnrollment({
      witness,
      designPath: DESIGN_PATH,
      planPath: PLAN_PATH,
      workflowNonce: "rr1-auto-resolution",
      operationId: "rr1-auto-resolution-enrollment",
      authorize: approve,
    });
    const eventStore = createReviewGateEventStore(root, {
      workspaceIdentity,
      writerId: "rr1-auto-resolution-writer",
      witness,
    });
    const workspaceReader = {
      readWorkspaceFile: async (filePath: string) => {
        const fullPath = filePath.startsWith("/") ? filePath : join(root, filePath);
        return existsSync(fullPath) ? readFileSync(fullPath) : null;
      },
    };
    const scopeAdmission = createReviewGateScopeAdmission({
      witness,
      eventStore,
      lockManager,
      workspaceReader,
      requirementsResolver: resolveRequirementsForAdmission,
      protocolRelease: { readVerifiedPhaseProtocolDelta: async () => "BLOCK" },
    });
    const coordinator = createReviewGateCoordinator({
      eventStore,
      lockManager,
      protocol: createReviewGateProtocolDescriptor(),
      workspaceReader,
      workspaceRoot: root,
      workspaceIdentity,
      mutationSubstrate: null,
      scopeAdmission,
      inspectTargets: async (paths) => new Map(paths.map((filePath) => [filePath, "clean_committed" as const])),
    });
    try {
      const result = await coordinator.startOrResume("rr1-auto-resolution-session", {
        source: "command",
        designPath: DESIGN_PATH,
        planPath: PLAN_PATH,
      });
      expect(result.dispatched).toBe(false);
      expect(result.gateId).toBeNull();
      expect(result.lockPhase).toBeNull();
      const gateIds = await eventStore.listGateIds();
      expect(gateIds).toHaveLength(1);
      const [gateId] = gateIds;
      if (gateId === undefined) throw new Error("V2 genesis gate missing");
      const journal = await eventStore.readV2Journal(gateId);
      const genesis = journal.events.find((event) => "schemaVersion" in event && event.schemaVersion === 2 && event.eventType === "GATE_CREATED");
      expect(genesis).toBeDefined();
      if (genesis === undefined || genesis.eventType !== "GATE_CREATED" || !("schemaVersion" in genesis)) {
        throw new Error("V2 genesis event missing");
      }
      expect(genesis.payload.requirementsResolution).toMatchObject({
        source: "design_declared_reference",
        canonicalPath: REQUIREMENTS_PATH,
        schemaVersion: 2,
      });
      const frontier = await witness.readWorkspaceScopeFrontier(workspaceIdentity);
      expect(frontier.scopes).toHaveLength(1);
      expect(frontier.scopes[0]).toMatchObject({
        provenance: { kind: "verified_genesis" },
        gateMembership: [{ gateId, admissionEventId: genesis.eventId }],
      });
    } finally {
      eventStore.close();
      witness.close();
      lockManager.close();
      fixture.witness.close();
      await rmSync(sandbox, { recursive: true, force: true });
      await rmSync(root, { recursive: true, force: true });
      await rmSync(`${root}.witness`, { recursive: true, force: true });
    }
  });

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
