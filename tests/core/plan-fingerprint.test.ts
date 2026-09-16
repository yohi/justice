import { describe, expect, it } from "vitest";
import {
  buildCanonicalSnapshot,
  computePlanFingerprint,
} from "../../src/core/plan-fingerprint";
import {
  createErrorAnnotationObservation,
  migrateJusticeGeneratedErrorAnnotations,
} from "../../src/core/error-annotation";
import type { ObservationRecord } from "../../src/core/v2/observation-model";
import { validateRecordSchema } from "../../src/runtime/validation";

const PLAN_PATH = "docs/plans/example.md";
const taskUnchecked = "## Task 1: approved\n- [ ] execute\n";
const taskChecked = "## Task 1: approved\n- [x] execute\n";
const globalUnchecked = "- [ ] release checklist\n\n## Task 1: approved\n- [ ] execute\n";
const globalChecked = "- [x] release checklist\n\n## Task 1: approved\n- [ ] execute\n";
const unscopedUnchecked = "Notes\n- [ ] verify manually\n\n## Task 1: approved\n- [ ] execute\n";
const unscopedChecked = "Notes\n- [x] verify manually\n\n## Task 1: approved\n- [ ] execute\n";
const fencedUnchecked = "## Task 1: approved\n```text\n- [ ] example\n```\n- [ ] execute\n";
const fencedChecked = "## Task 1: approved\n```text\n- [x] example\n```\n- [ ] execute\n";
const unapprovedTaskUnchecked =
  "## Task 1: approved\n- [ ] execute\n\n## Task 2: added\n- [ ] added step\n";
const unapprovedTaskChecked =
  "## Task 1: approved\n- [ ] execute\n\n## Task 2: added\n- [x] added step\n";
const taskBodyA = "## Task 1: approved\n- [ ] execute\n";
const taskBodyB = "## Task 1: renamed\n- [ ] execute\n";

function observedAnnotation(raw: string, lineNumber: number): ObservationRecord {
  return {
    schemaVersion: 1,
    sequence: 1,
    timestamp: "2026-09-05T00:00:00.000Z",
    agentId: "system",
    sessionId: "ses-1",
    writerId: "w-1",
    ...createErrorAnnotationObservation(PLAN_PATH, raw, lineNumber),
  };
}

describe("plan fingerprint", () => {
  it("normalizes only checkbox state in parsed task sections", () => {
    expect(computePlanFingerprint(taskUnchecked, ["task-1"])).toEqual(
      computePlanFingerprint(taskChecked, ["task-1"]),
    );
  });

  it("derives parser-aligned task IDs for leading-zero task headings", () => {
    const leadingZeroUnchecked = "## Task 01: approved\n- [ ] execute\n";
    const leadingZeroChecked = "## Task 01: approved\n- [x] execute\n";

    expect(buildCanonicalSnapshot(leadingZeroUnchecked, ["task-1"]).tasks[0]?.taskId).toBe("task-1");
    expect(computePlanFingerprint(leadingZeroUnchecked, ["task-1"])).toEqual(
      computePlanFingerprint(leadingZeroChecked, ["task-1"]),
    );
  });

  it("treats global, unscoped, and fenced checkboxes as semantic", () => {
    expect(computePlanFingerprint(globalUnchecked, ["task-1"])).not.toEqual(
      computePlanFingerprint(globalChecked, ["task-1"]),
    );
    expect(computePlanFingerprint(unscopedUnchecked, ["task-1"])).not.toEqual(
      computePlanFingerprint(unscopedChecked, ["task-1"]),
    );
    expect(computePlanFingerprint(fencedUnchecked, ["task-1"])).not.toEqual(
      computePlanFingerprint(fencedChecked, ["task-1"]),
    );
  });

  it("keeps checkboxes semantic when a different fence marker appears inside a fence", () => {
    const backtickUnchecked = "## Task 1: approved\n```text\n~~~\n- [ ] example\n```\n";
    const backtickChecked = "## Task 1: approved\n```text\n~~~\n- [x] example\n```\n";
    const tildeUnchecked = "## Task 1: approved\n~~~text\n```\n- [ ] example\n~~~\n";
    const tildeChecked = "## Task 1: approved\n~~~text\n```\n- [x] example\n~~~\n";

    expect(computePlanFingerprint(backtickUnchecked, ["task-1"])).not.toEqual(
      computePlanFingerprint(backtickChecked, ["task-1"]),
    );
    expect(computePlanFingerprint(tildeUnchecked, ["task-1"])).not.toEqual(
      computePlanFingerprint(tildeChecked, ["task-1"]),
    );
  });

  it("changes for an unapproved task section, task body edits, and not for EOL-only edits", () => {
    expect(computePlanFingerprint(unapprovedTaskUnchecked, ["task-1"])).not.toEqual(
      computePlanFingerprint(unapprovedTaskChecked, ["task-1"]),
    );
    expect(computePlanFingerprint(taskBodyA, ["task-1"])).not.toEqual(
      computePlanFingerprint(taskBodyB, ["task-1"]),
    );
    expect(computePlanFingerprint(taskBodyA, ["task-1"])).toEqual(
      computePlanFingerprint(taskBodyA.replace(/\n/g, "\r\n"), ["task-1"]),
    );
  });

  it("treats duplicate approved task headings as semantic", () => {
    const original = "## Task 1: approved\n- [ ] execute\n";
    const duplicate = "## Task 1: approved\n- [ ] execute\n\n## Task 1: duplicate\n- [x] execute\n";

    expect(computePlanFingerprint(duplicate, ["task-1"])).not.toEqual(
      computePlanFingerprint(original, ["task-1"]),
    );
  });

  it("builds an immutable snapshot from the parser-aligned approved task", () => {
    const snapshot = buildCanonicalSnapshot(taskChecked, ["task-1"]);

    expect(snapshot).toMatchObject({
      schema: "justice-plan-v1",
      tasks: [
        {
          taskId: "task-1",
          title: "approved",
          canonicalBody: "## Task 1: approved\n- [ ] execute\n",
        },
      ],
    });
    expect(snapshot.documentDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(snapshot.globalBodyDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(snapshot.tasks[0]?.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});

describe("Justice-generated error annotation migration", () => {
  it("removes one exactly identified observed legacy annotation after schema validation", () => {
    const raw = "## Task 1: approved\n\n> ⚠️ **Error**: failed\n\n- [ ] execute\n";
    const observation = observedAnnotation(raw, 3);

    validateRecordSchema(observation);
    const result = migrateJusticeGeneratedErrorAnnotations(raw, PLAN_PATH, [observation]);

    expect(result.content).not.toContain("> ⚠️ **Error**: failed");
    expect(result.warnings).toEqual([]);
  });

  it("removes only the second matching annotation when its occurrence identifies it", () => {
    const raw =
      "## Task 1: approved\n\n> ⚠️ **Error**: failed\n> ⚠️ **Error**: failed\n\n- [ ] execute\n";
    const observation = observedAnnotation(raw, 4);

    const result = migrateJusticeGeneratedErrorAnnotations(raw, PLAN_PATH, [observation]);

    expect(result.content.match(/> ⚠️ \*\*Error\*\*: failed/gu)).toHaveLength(1);
    expect(result.warnings).toEqual([{ kind: "unmatched_error_annotation", lineNumber: 3 }]);
  });

  it.each([
    {
      name: "a different plan path",
      record: (raw: string) => ({ ...observedAnnotation(raw, 3), planPath: "docs/plans/other.md" }),
    },
    {
      name: "a stale snapshot digest",
      record: (raw: string) => ({
        ...observedAnnotation(raw, 3),
        planSnapshotDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      }),
    },
    {
      name: "unknown provenance",
      record: (raw: string) => ({ ...observedAnnotation(raw, 3), provenance: "unknown" }),
    },
  ])("preserves an annotation with $name", ({ record }) => {
    const raw = "## Task 1: approved\n\n> ⚠️ **Error**: failed\n\n- [ ] execute\n";
    const result = migrateJusticeGeneratedErrorAnnotations(raw, PLAN_PATH, [record(raw)]);

    expect(result.content).toContain("> ⚠️ **Error**: failed");
    expect(result.warnings).toHaveLength(1);
    expect(computePlanFingerprint(result.content, ["task-1"])).not.toEqual(
      computePlanFingerprint(result.content.replace("> ⚠️ **Error**: failed\n", ""), ["task-1"]),
    );
  });

  it("preserves a manual annotation without a trusted observation", () => {
    const raw = "## Task 1: approved\n\n> ⚠️ **Error**: manual\n\n- [ ] execute\n";
    const result = migrateJusticeGeneratedErrorAnnotations(raw, PLAN_PATH, []);

    expect(result.content).toBe(raw);
    expect(result.warnings).toHaveLength(1);
  });
});
