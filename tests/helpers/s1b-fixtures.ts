import type { LoaderResult } from "../../src/core/s1a/contract.js";
import { loadS1aArtifacts } from "../../src/core/s1a/loader.js";
import type { BinderInput, EvidenceRefV1 } from "../../src/core/s1b/contract.js";
import { s1aFixture } from "./s1a-fixtures.js";

export type S1bFixture = Readonly<{
  baseline: LoaderResult;
  evidenceRefs: readonly EvidenceRefV1[];
  input: BinderInput;
}>;

export async function s1bFixture(): Promise<S1bFixture> {
  const sourceFixture = s1aFixture();
  const baseline = await loadS1aArtifacts(sourceFixture.input, sourceFixture.source);
  const selectedTask = baseline.selectedRefs.find((ref) => ref.kind === "task");
  if (!selectedTask) throw new Error("S1A_FIXTURE_TASK_NOT_SELECTED");

  const evidenceRefs = baseline.selectedRefs
    .filter((ref) => ref.kind === "ac")
    .map((ac): EvidenceRefV1 => ({
      evidenceId: `evidence-${ac.artifactId}`,
      type: "test",
      taskRef: { artifactId: selectedTask.artifactId, revision: selectedTask.revision },
      scopeKey: selectedTask.scopeKey,
      acRef: { artifactId: ac.artifactId, revision: ac.revision },
      issuerId: "fixture-issuer",
      originId: "fixture-origin",
      provenanceClass: "SELF_DECLARED",
      reportedExecutionState: "EXECUTED",
      reportedOutcome: "PASS",
    }));

  const refs = Object.freeze(evidenceRefs);
  return Object.freeze({
    baseline,
    evidenceRefs: refs,
    input: Object.freeze({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs: refs }),
  });
}

export function cloneS1bFixture(
  fixture: S1bFixture,
  changes: Readonly<{
    baseline?: LoaderResult;
    evidenceRefs?: readonly EvidenceRefV1[];
  }>,
): S1bFixture {
  const baseline = changes.baseline ?? fixture.baseline;
  const evidenceRefs = Object.freeze([...(changes.evidenceRefs ?? fixture.evidenceRefs)]);
  return Object.freeze({
    baseline,
    evidenceRefs,
    input: Object.freeze({ schemaVersion: "justice-s1b-input-v1", baseline, evidenceRefs }),
  });
}
