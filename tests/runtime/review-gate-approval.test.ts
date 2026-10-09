import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type {
  GateCreatedV1,
  ReviewApprovalBindingV1,
  ReviewGateEvent,
} from "../../src/core/review-gate-types";
import { computeReviewScopeId } from "../../src/core/review-gate/identity";
import { createReviewGateEventStore } from "../../src/runtime/review-gate-event-store";
import { createReviewGateProtocolDescriptor } from "../../src/runtime/review-gate-protocol";
import { createReviewGateApprovalLookup } from "../../src/runtime/review-gate-approval";

const REQUIREMENTS_PATH = "requirements.md";
const DESIGN_PATH = "docs/design.md";
const PLAN_PATH = "docs/plan.md";
const SCOPE_ID = computeReviewScopeId(DESIGN_PATH, PLAN_PATH);
const PROTOCOL = createReviewGateProtocolDescriptor();

let currentRoot = "";
const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

function freshRoot(): string {
  currentRoot = `${tmpdir()}/justice-task14-approval-${Math.random().toString(36).slice(2)}`;
  tempRoots.push(currentRoot);
  mkdirSync(path.join(currentRoot, "docs"), { recursive: true });
  return currentRoot;
}

function writeWorkspaceFiles(root: string, files: ReadonlyMap<string, string>): void {
  for (const [relative, content] of files) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
}

function digestOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

let gateSerial = 0;

async function seedCompletedGate(
  store: Awaited<ReturnType<typeof createReviewGateEventStore>>,
  root: string,
  files: ReadonlyMap<string, string>,
  drifts: Readonly<{
    readonly planPath?: string;
    readonly planDigest?: string;
    readonly designDigest?: string;
    readonly requirementsDigest?: string;
    readonly protocolFingerprint?: string;
    readonly approvedAt?: string;
    readonly reviewScopeId?: string;
  }> = {},
): Promise<ReviewApprovalBindingV1> {
  gateSerial += 1;
  const gateId = `gate-approve-${gateSerial}`;

  const planPath = drifts.planPath ?? PLAN_PATH;
  const designDigest = drifts.designDigest ?? digestOf(files.get(DESIGN_PATH) ?? "");
  const planDigest = drifts.planDigest ?? digestOf(files.get(PLAN_PATH) ?? "");
  const requirementsDigest = drifts.requirementsDigest ?? digestOf(files.get(REQUIREMENTS_PATH) ?? "");

  const binding: ReviewApprovalBindingV1 = {
    reviewScopeId: drifts.reviewScopeId ?? SCOPE_ID,
    gateId,
    designArtifact: { canonicalPath: DESIGN_PATH, digest: designDigest, gitMode: "100644" },
    planArtifact: { canonicalPath: planPath, digest: planDigest, gitMode: "100644" },
    requirementsResolution: {
      source: "explicit",
      canonicalPath: REQUIREMENTS_PATH,
      digest: requirementsDigest,
    },
    reviewProtocolFingerprint: drifts.protocolFingerprint ?? PROTOCOL.reviewProtocolFingerprint,
    designProtocolFingerprint: PROTOCOL.designProtocolFingerprint,
    planProtocolFingerprint: PROTOCOL.planProtocolFingerprint,
    approvedAt: drifts.approvedAt ?? "2026-10-08T00:10:00.000Z",
  };

  const gateCreated: GateCreatedV1 = {
    eventType: "GATE_CREATED",
    gateId,
    writerId: "writer-1",
    epochId: "epoch-1",
    emittedAt: "2026-10-08T00:00:00.000Z",
    payload: {
      reviewScopeId: SCOPE_ID,
      designArtifact: binding.designArtifact,
      planArtifact: binding.planArtifact,
      requirementsResolution: binding.requirementsResolution,
      reviewProtocolFingerprint: binding.reviewProtocolFingerprint,
    },
  };
  const completion: ReviewGateEvent = {
    eventType: "COMPLETED_APPROVAL_BINDING",
    gateId,
    writerId: "writer-1",
    epochId: "epoch-2",
    emittedAt: "2026-10-08T00:10:01.000Z",
    payload: { approvalBinding: binding },
  };
  await store.appendEvents(gateId, [gateCreated, completion]);
  if (binding.reviewScopeId === SCOPE_ID) {
    await store.writeScopeIndex(binding.reviewScopeId, gateId);
  }
  void root;
  return binding;
}

function fsWorkspaceReader(root: string) {
  return {
    readWorkspaceFile: async (path_: string): Promise<Buffer | null> => {
      try {
        return await (await import("node:fs/promises")).readFile(path.join(root, path_));
      } catch {
        return null;
      }
    },
  };
}

async function createStandardWorkspace(): Promise<{
  readonly root: string;
  readonly files: Map<string, string>;
  readonly store: Awaited<ReturnType<typeof createReviewGateEventStore>>;
}> {
  const root = freshRoot();
  const files = new Map<string, string>([
    [REQUIREMENTS_PATH, "# Requirements\nScope of the change\n"],
    [DESIGN_PATH, "# Design\nReviewed behavior\n"],
    [PLAN_PATH, "## Task 1: Build\n- [ ] Build it\n"],
  ]);
  writeWorkspaceFiles(root, files);
  const store = createReviewGateEventStore(root);
  return { root, files, store };
}

function createLookup(
  root: string,
  store: Awaited<ReturnType<typeof createReviewGateEventStore>>,
) {
  return createReviewGateApprovalLookup({
    eventStore: store,
    workspaceReader: fsWorkspaceReader(root),
    protocol: PROTOCOL,
  });
}

describe("ReviewGateApprovalLookup — exact structured binding", () => {
  it("approves a restarted process from durable history alone (no in-memory state)", async () => {
    const { root, files, store } = await createStandardWorkspace();
    const binding = await seedCompletedGate(store, root, files);
    store.close();

    // Fresh process: brand new store instance over the same durable root.
    const storeAfterRestart = createReviewGateEventStore(root);
    const lookup = createLookup(root, storeAfterRestart);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);

    expect(outcome).toEqual({
      kind: "approved",
      gateId: binding.gateId,
      binding,
    });
    storeAfterRestart.close();
  });

  it.each([
    ["requirements", "requirements"],
    ["design", "design"],
    ["plan", "plan"],
    ["protocol", "protocol"],
  ])("fails closed on %s-only drift", async (label, kind) => {
    const { root, files, store } = await createStandardWorkspace();
    const drifts: Parameters<typeof seedCompletedGate>[4] = {};
    if (kind === "requirements") {
      drifts.requirementsDigest = digestOf(`${files.get(REQUIREMENTS_PATH)}stale\n`);
    } else if (kind === "design") {
      drifts.designDigest = `${"d".repeat(63)}0`;
    } else if (kind === "plan") {
      drifts.planDigest = `${"p".repeat(63)}0`;
    } else {
      drifts.protocolFingerprint = `${"f".repeat(63)}0`;
    }
    await seedCompletedGate(store, root, files, drifts);

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);

    expect(outcome.kind).toBe("not_approved");
    expect(label).toBeTypeOf("string");
    store.close();
  });

  it("returns not_approved when the plan never completed any Review Gate", async () => {
    const { root, store } = await createStandardWorkspace();

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("not_approved");
    store.close();
  });

  it("reports identity_conflict when two completed approvals exactly match now, across scope namespaces", async () => {
    const { root, files, store } = await createStandardWorkspace();
    await seedCompletedGate(store, root, files);
    // A second scope namespace (different Design path → different scope id)
    // whose completed binding is ALSO an exact current match.
    await seedCompletedGate(store, root, files, {
      approvedAt: "2026-10-08T00:11:00.000Z",
      reviewScopeId: computeReviewScopeId("docs/design-2.md", PLAN_PATH),
    });

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("identity_conflict");
    store.close();
  });

  it("does not match candidates from other plan paths", async () => {
    const { root, files, store } = await createStandardWorkspace();
    await seedCompletedGate(store, root, files, { planPath: "docs/other-plan.md" });

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("not_approved");
    store.close();
  });

  it("fails closed when an unrelated gate history is unreadable", async () => {
    const { root, files, store } = await createStandardWorkspace();
    await seedCompletedGate(store, root, files);
    // Corrupt an unrelated gate namespace.
    const brokenDir = path.join(root, ".justice", "review-gates", "gate-broken");
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(path.join(brokenDir, "events.jsonl"), '{"eventType": "GATE", "partial"');

    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome).toEqual({ kind: "history_unavailable" });
    store.close();
  });

  it("never mutates the stale completed Gate on binding mismatch", async () => {
    const { root, files, store } = await createStandardWorkspace();
    const binding = await seedCompletedGate(store, root, files);
    const ledgerPath = path.join(
      root,
      ".justice",
      "review-gates",
      binding.gateId,
      "events.jsonl",
    );
    const bytesBefore = readFileSync(ledgerPath, "utf8");

    writeWorkspaceFiles(root, new Map([[PLAN_PATH, "## Task 1: Build\n- [ ] changed\n"]]));
    const lookup = createLookup(root, store);
    const outcome = await lookup.findCurrentCompletedApproval(PLAN_PATH);
    expect(outcome.kind).toBe("not_approved");

    expect(readFileSync(ledgerPath, "utf8")).toBe(bytesBefore);
    store.close();
  });
});

describe("ReviewGateApprovalLookup — candidate enumeration", () => {
  it("lists completed candidates for the requested plan only", async () => {
    const { root, files, store } = await createStandardWorkspace();
    const binding = await seedCompletedGate(store, root, files);
    await seedCompletedGate(store, root, files, { planPath: "docs/other-plan.md" });

    const lookup = createLookup(root, store);
    const candidates = await lookup.listCompletedApprovalCandidates(PLAN_PATH);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.gateId).toBe(binding.gateId);
    expect(candidates[0]?.binding.planArtifact.canonicalPath).toBe(PLAN_PATH);
    store.close();
  });

  it("returns an empty list without any completed gate", async () => {
    const { root, store } = await createStandardWorkspace();
    const lookup = createLookup(root, store);
    expect(await lookup.listCompletedApprovalCandidates(PLAN_PATH)).toEqual([]);
    store.close();
  });
});
