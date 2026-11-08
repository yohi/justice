import { loadS1aArtifacts } from "../../src/core/s1a/loader.js";
import type { S1aReadOnlySource } from "../../src/core/s1a/contract.js";
import type { ChangeSet, S1cInput } from "../../src/core/s1c/contract.js";
import type { EvidenceRefV1 } from "../../src/core/s1b/contract.js";
import { jsonBytes, s1aFixture, sha256 } from "./s1a-fixtures.js";

const defaultChanges: ChangeSet = {
  availability: "PRESENT",
  changes: [{ kind: "MODIFY", path: "src/core/s1c/evaluator.ts" }],
};

export type S1cFixture = Readonly<{
  input: S1cInput;
  planBytes: Uint8Array;
}>;

export async function s1cFixture(
  options: Readonly<{
    planText?: string;
    changes?: ChangeSet;
    evidenceRefs?: readonly EvidenceRefV1[];
  }> = {},
): Promise<S1cFixture> {
  const sourceFixture = s1aFixture();
  const artifactFiles = new Map(Object.entries(sourceFixture.files));
  const planText = options.planText ?? [
    "## Justice S1-c Task Scope Policies",
    "<!-- justice:s1c-task-scope:begin -->",
    JSON.stringify({
      schemaVersion: "justice-s1c-task-scope-v1",
      planRef: { artifactId: "plan-1", revision: "R1" },
      taskRef: { artifactId: "task-1", revision: "R1" },
      scopeKey: "scope-1",
      allowedPaths: ["src/core/s1c/**", "tests/core/s1c/**"],
    }),
    "<!-- justice:s1c-task-scope:end -->",
  ].join("\n");
  const planBytes = new TextEncoder().encode(planText);
  const manifest = {
    ...sourceFixture.manifest,
    artifacts: sourceFixture.manifest.artifacts.map((artifact) =>
      artifact.artifactId === "plan-1"
        ? { ...artifact, digest: { algorithm: "sha256" as const, hex: sha256(planBytes) } }
        : artifact,
    ),
  };
  const manifestBytes = jsonBytes(manifest);
  const source: S1aReadOnlySource = {
    async readInputFile(path) {
      return path === "manifest" ? manifestBytes : jsonBytes(sourceFixture.intent);
    },
    async readArtifact(_root, relativePath, maxBytes) {
      const bytes = relativePath === "plan-1.md" ? planBytes : artifactFiles.get(relativePath);
      if (bytes === undefined) throw Error("S1C_FIXTURE_ARTIFACT_NOT_FOUND");
      if (bytes.byteLength > maxBytes) throw Object.assign(Error("over_limit"), { kind: "over_limit" });
      return bytes;
    },
  };
  const baseline = await loadS1aArtifacts(
    { ...sourceFixture.input, expectedManifestSha256: sha256(manifestBytes) },
    source,
  );
  const taskRef = baseline.selectedRefs.find((artifact) => artifact.kind === "task");
  if (taskRef === undefined) throw Error("S1C_FIXTURE_TASK_NOT_SELECTED");
  const evidenceRefs = options.evidenceRefs ?? baseline.selectedRefs
    .filter((artifact) => artifact.kind === "ac")
    .map((ac): EvidenceRefV1 => ({
      evidenceId: `evidence-${ac.artifactId}`,
      type: "test",
      taskRef: { artifactId: taskRef.artifactId, revision: taskRef.revision },
      scopeKey: taskRef.scopeKey,
      acRef: { artifactId: ac.artifactId, revision: ac.revision },
      issuerId: "fixture-issuer",
      originId: "fixture-origin",
      provenanceClass: "SELF_DECLARED",
      reportedExecutionState: "EXECUTED",
      reportedOutcome: "PASS",
    }));
  const input: S1cInput = Object.freeze({
    schemaVersion: "justice-s1c-input-v1",
    baseline,
    planBytes,
    changeSet: options.changes ?? defaultChanges,
    evidenceRefs,
  });
  return Object.freeze({ input, planBytes });
}
