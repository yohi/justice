import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { JusticePlugin } from "../../src/core/justice-plugin";
import type { FileReader } from "../../src/core/types";
import type { ReviewGateApprovedDesignAuthority } from "../../src/hooks/plan-bridge";
import type { VerifiedApprovedDesignReadBindingV1 } from "../../src/core/review-gate/capabilities";
import { createTestReviewGateCoordinator } from "../helpers/review-gate-coordinator";
import { createMockFileSystem } from "../helpers/mock-file-system";

const DESIGN_PATH = "docs/specs/design.md";
const PLAN_PATH = "docs/plans/implementation-plan.md";
const APPROVED_D0 = Buffer.from("approved D0 bytes\n");

describe("approved Design query facade integration", () => {
  it("serves immutable D0 while a staged/dirty D1 remains diagnostic only", async () => {
    const files = new Map([
      [DESIGN_PATH, "mutable D0 worktree content\n"],
      [PLAN_PATH, "dirty D1 plan content\n"],
    ]);
    const justice = new JusticePlugin({
      readFile: async (path: string) => files.get(path) ?? "",
      fileExists: async (path: string) => files.has(path),
      listFiles: async () => [...files.keys()],
      readFileStats: async () => null,
    } as unknown as FileReader, createMockFileSystem(Object.fromEntries(files)));
    await justice.initialize();
    const bridge = justice.getPlanBridge();
    bridge.setReviewGateCoordinator(createTestReviewGateCoordinator({ files }));
    const binding: VerifiedApprovedDesignReadBindingV1 = {
      schemaVersion: 1,
      canonicalPath: DESIGN_PATH,
      designClearEventId: "design-clear-current",
      currentAuthorityEventId: "design-clear-current",
      committedTreeOid: "a".repeat(64),
      blobOid: "b".repeat(64),
      gitMode: "100644",
      digest: "c".repeat(64),
      requirements: { canonicalPath: DESIGN_PATH, gitBlobOid: "d".repeat(64), digest: "e".repeat(64), gitMode: "100644" },
      phaseProtocolFingerprint: "protocol-current",
      witnessFrontierHash: "f".repeat(64),
    };
    let authoritySessionId: string | undefined;
    const authority: ReviewGateApprovedDesignAuthority = {
      getApprovedDesignBinding: async ({ sessionId }) => {
        authoritySessionId = sessionId;
        return binding;
      },
      readApprovedDesignArtifact: async () => APPROVED_D0,
      searchApprovedDesignArtifact: async ({ pattern }) =>
        APPROVED_D0.toString("utf8").includes(pattern) ? [{ line: 1, text: "approved D0 bytes" }] : [],
    };
    bridge.setReviewGateApprovedDesignAuthority(authority);
    const statusValue = { entries: [{ canonicalPath: PLAN_PATH, indexState: "M", workingTreeState: "M" }] };
    bridge.setReviewGateQueryService({
      getScopedStatus: async (_scope: import("../../src/core/review-gate/capabilities").ReviewQueryScope) => statusValue,
      getScopedDiff: async (_scope: import("../../src/core/review-gate/capabilities").ReviewQueryScope, request: { readonly staged: boolean }) => ({ staged: request.staged, patch: "D1 staged patch" }),
    } as unknown as import("../../src/runtime/review-gate-query").ReviewGateQueryService);
    await bridge.handleReviewGateStart("root", { source: "command", designPath: DESIGN_PATH, planPath: PLAN_PATH });

    const read = JSON.parse(await bridge.executeReviewerScopedQuery("root", { kind: "artifact_read", path: DESIGN_PATH })) as Record<string, unknown>;
    const status = JSON.parse(await bridge.executeReviewerScopedQuery("root", { kind: "status" })) as Record<string, unknown>;
    const diff = JSON.parse(await bridge.executeReviewerScopedQuery("root", { kind: "diff", staged: true })) as Record<string, unknown>;
    expect(read).toEqual({ status: "OK", authority: "approved_D0", content: "approved D0 bytes\n" });
    expect(authoritySessionId).toBe("root");
    expect(status).toMatchObject({ authority: "unapproved_D1_diagnostic", result: statusValue });
    expect(diff).toMatchObject({ authority: "unapproved_D1_diagnostic", result: { staged: true, patch: "D1 staged patch" } });
  });
});
