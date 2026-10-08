import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as z from "zod";
import {
  hasGlibcRuntime,
  loadJusticeLinuxNativeAddon,
  type JusticeLinuxNativeGateRoot,
} from "../../src/runtime/linux-native-addon";
import { createReviewGateEventStore } from "../../src/runtime/review-gate-event-store";
import { createReviewGateRecoveryStore } from "../../src/runtime/review-gate-recovery-store";

// Focused host proof for the Linux Review Gate substrate (convergence Task 1
// Step 5, host-verified from Task 15): lock exclusivity/CLOEXEC/release and
// descriptor-relative path policy come from the native gate root; the durable
// writer-shard ledger and the no-replace recovery CAS come from the shipped
// runtime stores that the Review Gate coordinator actually consumes; and the
// guarded workspace exact-replace semantics are proven against the real host
// filesystem (byte-exact current-digest guard + Git-mode preservation). Prints
// one JSON report; `status: "PASS"` on supported Linux x64/glibc with every
// case PASS, `BLOCKED` on an unsupported host.

const PASS_STATUS = "PASS" as const;
const BLOCKED_STATUS = "BLOCKED" as const;

const ProbeCaseSchema = z.object({
  status: z.enum([PASS_STATUS, "FAIL", BLOCKED_STATUS]),
  detail: z.string(),
  layer: z.string(),
});

const ProbeReportSchema = z.object({
  nativeApi: z.record(z.string(), z.boolean()),
  platform: z.object({
    os: z.string(),
    arch: z.string(),
    libc: z.string(),
  }),
  status: z.enum([PASS_STATUS, "FAIL", BLOCKED_STATUS]),
  cases: z.record(z.string(), ProbeCaseSchema),
});

export type GateProbeCase = {
  status: "PASS" | "FAIL" | "BLOCKED";
  detail: string;
  layer: string;
};

export type GateProbeReport = {
  nativeApi: Record<string, boolean>;
  platform: { os: string; arch: string; libc: string };
  status: "PASS" | "FAIL" | "BLOCKED";
  cases: Record<string, GateProbeCase>;
};

type CaseResult = Readonly<{ readonly pass: boolean; readonly detail: string }>;

const ok = (detail: string): CaseResult => ({ pass: true, detail });
const fail = (detail: string): CaseResult => ({ pass: false, detail });

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function libcKind(): string {
  if (process.platform !== "linux") return "unknown";
  const ldd = spawnSync("ldd", ["--version"], { encoding: "utf8" });
  const firstLine = ldd.stdout?.split("\n")[0] ?? "";
  return firstLine.includes("musl") ? "musl" : "glibc";
}

const digestOf = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

type SeedEvent = {
  readonly eventType: string;
  readonly gateId: string;
  readonly writerId: string;
  readonly epochId: string;
  readonly emittedAt: string;
  readonly payload: Record<string, unknown>;
};

/** The guarded exact-replace sequence shared by the two workspace cases. */
async function replaceWorkspaceFileExact(
  rootDir: string,
  relativePath: string,
  expectedDigest: string,
  expectedMode: "100644" | "100755",
  replacementBytes: Buffer,
  replacementMode: "100644" | "100755",
): Promise<void> {
  const absolute = join(rootDir, relativePath);
  const current = await readFile(absolute);
  if (digestOf(current) !== expectedDigest) {
    throw new Error("review_gate_current_digest_mismatch");
  }
  const currentStat = await stat(absolute);
  const ownerExec = (currentStat.mode & 0o100) !== 0 ? "100755" : "100644";
  if (ownerExec !== expectedMode) {
    throw new Error("review_gate_current_git_mode_mismatch");
  }
  const tmp = `${absolute}.justice-replace`;
  await writeFile(tmp, replacementBytes);
  await chmod(tmp, replacementMode === "100755" ? 0o755 : 0o644);
  await rm(absolute, { force: true });
  await (await import("node:fs/promises")).rename(tmp, absolute);
}

async function runCases(
  root: JusticeLinuxNativeGateRoot,
  rootDir: string,
): Promise<Record<string, GateProbeCase>> {
  const cases: Record<string, GateProbeCase> = {};
  const run = async (
    name: string,
    layer: string,
    body: () => Promise<CaseResult>,
  ): Promise<void> => {
    try {
      const result = await body();
      cases[name] = { status: result.pass ? PASS_STATUS : "FAIL", detail: result.detail, layer };
    } catch (err) {
      cases[name] = {
        status: "FAIL",
        detail: err instanceof Error ? err.message : String(err),
        layer,
      };
    }
  };

  await run("exclusive_scope_lock", "native gate root", async () => {
    const first = root.acquireScopeLock("scope-lock-case");
    assert(first !== "occupied", "first scope lock acquisition must succeed");
    const second = root.acquireScopeLock("scope-lock-case");
    if (second !== "occupied") {
      first?.release();
      return fail("second scope lock acquisition must be occupied");
    }
    first?.release();
    const third = root.acquireScopeLock("scope-lock-case");
    assert(third !== "occupied", "scope lock must be acquirable after release");
    third?.release();
    return ok("non-blocking flock exclusivity with release round-trip");
  });

  await run("exclusive_gate_lock", "native gate root", async () => {
    const first = root.acquireGateLock("gate-lock-case");
    assert(first !== "occupied", "first gate lock acquisition must succeed");
    const second = root.acquireGateLock("gate-lock-case");
    if (second !== "occupied") {
      first?.release();
      return fail("second gate lock acquisition must be occupied");
    }
    first?.release();
    const third = root.acquireGateLock("gate-lock-case");
    assert(third !== "occupied", "gate lock must be acquirable after release");
    third?.release();
    return ok("gate lock exclusivity with release round-trip");
  });

  await run("lock_release_on_close", "native gate root", async () => {
    const handle = root.acquireScopeLock("scope-close-case");
    assert(handle !== "occupied", "scope lock must be acquired before release");
    handle?.release();
    const reacquired = root.acquireScopeLock("scope-close-case");
    assert(reacquired !== "occupied", "released lock must be re-acquirable in-process");
    reacquired?.release();
    return ok("handle release frees the flock for re-acquisition");
  });

  await run("lock_cloexec", "native gate root", async () => {
    const handle = root.acquireScopeLock("scope-cloexec-case");
    assert(handle !== "occupied", "scope lock must be acquired");
    const cloexec = handle?.verifyCloexec() ?? false;
    handle?.release();
    if (!cloexec) return fail("lock FD must be opened with O_CLOEXEC");
    return ok("lock FD verified O_CLOEXEC");
  });

  await run("writer_shard_durable_publish", "runtime ReviewGateEventStore", async () => {
    const gateId = "spike-shard-gate";
    const writerId = "spike-writer";
    const genesis: SeedEvent = {
      eventType: "GATE_CREATED",
      gateId,
      writerId,
      epochId: `${gateId}-epoch`,
      emittedAt: "2026-10-08T00:00:00.000Z",
      payload: { reviewScopeId: "spike-scope" },
    };
    const store = createReviewGateEventStore(rootDir);
    await store.appendEvents(gateId, [genesis as never]);
    const first = await store.readEvents(gateId);
    if (first.length !== 1) return fail("durable shard must read back the published event");
    store.close();

    // Durability across a simulated process restart: a fresh store instance
    // reads the same bytes, and appends survive another close/reopen.
    const reopened = createReviewGateEventStore(rootDir);
    const resumed = await reopened.readEvents(gateId);
    if (resumed.length !== 1 || JSON.stringify(resumed) !== JSON.stringify(first)) {
      return fail("re-opened store must read the same durable bytes");
    }
    const followUp: SeedEvent = {
      eventType: "DESIGN_CLEAR",
      gateId,
      writerId,
      epochId: `${gateId}-epoch`,
      emittedAt: "2026-10-08T00:00:01.000Z",
      payload: { designProtocolFingerprint: "spike" },
    };
    await reopened.appendEvents(gateId, [followUp as never]);
    reopened.close();
    const final = createReviewGateEventStore(rootDir);
    const appended = await final.readEvents(gateId);
    final.close();
    if (appended.length !== 2 || appended[1]?.eventType !== "DESIGN_CLEAR") {
      return fail("durable shard replace must publish the appended bytes");
    }
    return ok("writer-shard ledger survives close/reopen with atomic publish");
  });

  await run("recovery_object_noreplace", "runtime ReviewGateRecoveryStore", async () => {
    const store = createReviewGateRecoveryStore(rootDir);
    const bytes = Buffer.from("recovery-object-bytes", "utf8");
    const digest = digestOf(bytes);
    let mismatchRejected = false;
    try {
      await store.publish(digest, Buffer.from("different", "utf8"));
    } catch {
      mismatchRejected = true;
    }
    if (!mismatchRejected) return fail("digest/bytes mismatch must be rejected");
    const first = await store.publish(digest, bytes);
    if (first !== "created") return fail(`first publish must be created, got ${first}`);
    const second = await store.publish(digest, bytes);
    if (second !== "exists") return fail(`second publish must be exists, got ${second}`);
    const readBack = await store.read(digest);
    if (readBack === null || !readBack.equals(bytes)) {
      return fail("recovery CAS object must retain the first published bytes");
    }
    store.close();
    return ok("recovery CAS publish is digest-keyed, create-if-absent, byte-exact");
  });

  await run("workspace_exact_replace_guard", "host fs guarded replace", async () => {
    const target = "docs/design.md";
    await mkdir(join(rootDir, "docs"), { recursive: true });
    const v1 = Buffer.from("design v1\n", "utf8");
    const v2 = Buffer.from("design v2\n", "utf8");
    await writeFile(join(rootDir, target), v1, { mode: 0o644 });

    let rejected = false;
    try {
      await replaceWorkspaceFileExact(
        rootDir,
        target,
        digestOf(Buffer.from("wrong", "utf8")),
        "100644",
        v2,
        "100644",
      );
    } catch (err) {
      rejected = err instanceof Error && err.message === "review_gate_current_digest_mismatch";
    }
    if (!rejected) return fail("current-digest mismatch must be rejected without mutation");
    if ((await readFile(join(rootDir, target))).equals(v1) !== true) {
      return fail("rejected replace must not mutate the target");
    }

    await replaceWorkspaceFileExact(rootDir, target, digestOf(v1), "100644", v2, "100644");
    const after = await readFile(join(rootDir, target));
    if (!after.equals(v2)) return fail("guarded replace must publish the replacement bytes");
    return ok("workspace exact replace enforces the current-digest guard before publish");
  });

  await run("workspace_exact_replace_mode_preserved", "host fs guarded replace", async () => {
    const target = "docs/executable.md";
    const v1 = Buffer.from("executable design v1\n", "utf8");
    const v2 = Buffer.from("executable design v2\n", "utf8");
    await writeFile(join(rootDir, target), v1, { mode: 0o755 });

    let rejected = false;
    try {
      await replaceWorkspaceFileExact(
        rootDir,
        target,
        digestOf(v1),
        "100644",
        v2,
        "100644",
      );
    } catch (err) {
      rejected = err instanceof Error && err.message === "review_gate_current_git_mode_mismatch";
    }
    if (!rejected) return fail("git-mode mismatch against a 100755 target must be rejected");

    await replaceWorkspaceFileExact(rootDir, target, digestOf(v1), "100755", v2, "100755");
    const stats = await stat(join(rootDir, target));
    if ((stats.mode & 0o100) === 0) {
      return fail("replacement must preserve the owner execute bit (100755)");
    }
    if (!(await readFile(join(rootDir, target))).equals(v2)) {
      return fail("mode-preserving replace must publish the replacement bytes");
    }
    return ok(
      "workspace exact replace preserves the target's Git mode authority (owner-exec bit only)",
    );
  });

  await run("symlinked_ancestor_rejected", "native gate root", async () => {
    const realDir = join(rootDir, "real-ancestor");
    const linkDir = join(rootDir, "linked-ancestor");
    await mkdir(realDir, { recursive: true });
    await writeFile(join(realDir, "secret.md"), "through symlink\n");
    if (!existsSync(linkDir)) {
      await symlink(realDir, linkDir, "dir");
    }
    let rejected = false;
    try {
      const leaked = root.readWorkspaceFile("linked-ancestor/secret.md");
      if (leaked === null) rejected = true;
    } catch {
      rejected = true;
    }
    if (!rejected) return fail("symlinked workspace ancestors must be rejected");
    return ok("descriptor-relative workspace reads reject symlinked ancestors");
  });

  return cases;
}

async function main(): Promise<void> {
  const platform = { os: process.platform, arch: process.arch, libc: libcKind() };
  const addon = loadJusticeLinuxNativeAddon();
  const nativeApi: Record<string, boolean> = {
    platform_linux: process.platform === "linux",
    arch_x64: process.arch === "x64",
    glibc: hasGlibcRuntime(),
    gate_addon: addon?.gate !== undefined,
  };
  const supported =
    nativeApi.platform_linux === true &&
    nativeApi.arch_x64 === true &&
    nativeApi.glibc === true &&
    nativeApi.gate_addon === true;

  if (!supported) {
    const report: GateProbeReport = {
      nativeApi,
      platform,
      status: BLOCKED_STATUS,
      cases: {},
    };
    console.log(JSON.stringify(ProbeReportSchema.parse(report), null, 2));
    return;
  }

  const gate = addon?.gate;
  if (gate === undefined) {
    throw new Error("review gate native addon unavailable on a supported platform");
  }
  const rootDir = await mkdtemp(join(tmpdir(), "justice-review-gate-spike-"));
  let root: JusticeLinuxNativeGateRoot | null = null;
  try {
    root = gate.openReviewGateRoot(rootDir);
    const cases = await runCases(root, rootDir);
    const allPass = Object.values(cases).every((probeCase) => probeCase.status === PASS_STATUS);
    const report: GateProbeReport = {
      nativeApi,
      platform,
      status: allPass ? PASS_STATUS : "FAIL",
      cases,
    };
    console.log(JSON.stringify(ProbeReportSchema.parse(report), null, 2));
  } finally {
    root?.close();
    await rm(rootDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
