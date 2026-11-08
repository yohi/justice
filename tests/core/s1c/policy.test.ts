import { describe, expect, test } from "vitest";
import { extractTaskScopePolicy } from "../../../src/core/s1c/policy.js";
import type { SelectedArtifactRef } from "../../../src/core/s1a/contract.js";

const selected = {
  plan: { artifactId: "plan-1", kind: "plan", revision: "R1", scopeKey: "scope-1", expectedDigest: "0".repeat(64), observedDigest: "0".repeat(64), digestOutcome: "MATCH" },
  task: { artifactId: "task-1", kind: "task", revision: "R1", scopeKey: "scope-1", expectedDigest: "1".repeat(64), observedDigest: "1".repeat(64), digestOutcome: "MATCH", parentId: "plan-1" },
} satisfies Readonly<{ plan: SelectedArtifactRef; task: SelectedArtifactRef }>;

const heading = "## Justice S1-c Task Scope Policies";
const begin = "<!-- justice:s1c-task-scope:begin -->";
const end = "<!-- justice:s1c-task-scope:end -->";
const policy = (taskId = "task-1", revision = "R1", planId = "plan-1", planRevision = "R1", scopeKey = "scope-1", paths: readonly string[] = ["src/core/s1c/**"]): string =>
  JSON.stringify({ schemaVersion: "justice-s1c-task-scope-v1", planRef: { artifactId: planId, revision: planRevision }, taskRef: { artifactId: taskId, revision }, scopeKey, allowedPaths: paths });
const block = (json = policy()): string => `${begin}\n${json}\n${end}`;
const planBytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const extract = (text: string): ReturnType<typeof extractTaskScopePolicy> => extractTaskScopePolicy(planBytes(text), selected);

describe("extractTaskScopePolicy", () => {
  test("singleExactActiveSectionAndBlock", () => {
    expect(extract(`${heading}\n${block()}`)).toEqual({
      state: "READY",
      policy: {
        schemaVersion: "justice-s1c-task-scope-v1",
        planRef: { artifactId: "plan-1", revision: "R1" },
        taskRef: { artifactId: "task-1", revision: "R1" },
        scopeKey: "scope-1",
        allowedPaths: ["src/core/s1c/**"],
      },
    });
  });

  test("policyExamplesAreNotActive", () => {
    const fake = `${heading}\n${block()}`;
    for (const sample of [
      `\`\`\`text\n${fake}\n\`\`\``, `\`\`\`json\n${fake}\n\`\`\``, `~~~\n${fake}\n~~~`,
      `> ${heading}\n> ${begin}\n> ${policy()}\n> ${end}`,
      `    ${heading}\n    ${begin}\n    ${policy()}\n    ${end}`,
      `<!-- ordinary comment\n${fake}\n-->`,
    ]) expect(extract(sample)).toEqual({ state: "UNDEFINED" });
  });

  test("mixedMarkdownOnlyActiveSectionCounts", () => {
    expect(extract(`\`\`\`text\n${heading}\n${block()}\n\`\`\`\n${heading}\n> ${begin}\n    ${end}\n${block()}`)).toMatchObject({ state: "READY" });
  });

  test("unpairedNestedAlteredOrDuplicateMarkers", () => {
    for (const content of [
      begin, `${end}\n${begin}\n${policy()}\n${end}`, `${begin}\n${begin}\n${policy()}\n${end}`,
      `${begin} \n${policy()}\n${end}`, `${begin}\n${policy()}\n# Next\n${end}`,
      `${block()}\n${heading}\n${block()}`, `${block()}\n${block()}`,
    ]) expect(extract(`${heading}\n${content}`)).toEqual({ state: "INVALID" });
  });

  test("regionEndingHeadingWinsOverInlineHtmlComment", () => {
    for (const headingLine of ["# End <!-- x -->", "# End <!-- x"]) {
      expect(extract(`${heading}\n${headingLine}\n${block()}`)).toEqual({ state: "UNDEFINED" });
    }
  });

  test("indentedLevelOneOrTwoHeadingEndsActiveRegion", () => {
    for (const headingLine of [" # Other Section", "  ## Appendix", "   # End", "   ## End"]) {
      expect(extract(`${heading}\n${headingLine}\n${block()}`)).toEqual({ state: "UNDEFINED" });
    }
  });

  test("closedThenUnclosedInlineCommentsRemainOpen", () => {
    expect(extract(`${heading}\n<!-- x --> <!-- y\n${block()}\n-->`)).toEqual({ state: "UNDEFINED" });
  });

  test("atomicPolicyInvalidityAcrossTasks", () => {
    expect(extract(`${heading}\n${block()}\n${block("{")}`)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\n${block()}\n${block(policy("task-2", "R1", "plan-1", "R1", "scope-1", ["../bad"]))}`)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\n${block(policy("task-2"))}\n${block(policy("task-2"))}`)).toEqual({ state: "INVALID" });
  });

  test("rejectsMarkerPrefixEmbeddedInsidePolicyBlock", () => {
    expect(extract(`${heading}\n${begin}\n${policy()}\n<!-- justice:s1c-task-scope:unexpected -->\n${end}`))
      .toEqual({ state: "INVALID" });
  });

  test("unknownSelectedTaskIsUndefined", () => {
    expect(extract(`${heading}\n${block(policy("task-2"))}`)).toEqual({ state: "UNDEFINED" });
  });

  test("selectedRevisionOrPlanMismatchIsReferenceMismatch", () => {
    for (const json of [policy("task-1", "R2"), policy("task-1", "R1", "plan-2"), policy("task-1", "R1", "plan-1", "R2"), policy("task-1", "R1", "plan-1", "R1", "scope-2")]) {
      expect(extract(`${heading}\n${block(json)}`)).toEqual({ state: "REFERENCE_MISMATCH" });
    }
  });

  test("validExplicitEmptyAllowlistReady", () => {
    expect(extract(`${heading}\n${block(policy("task-1", "R1", "plan-1", "R1", "scope-1", []))}`)).toMatchObject({ state: "READY", policy: { allowedPaths: [] } });
  });

  test("utf8AndBounds", () => {
    expect(extractTaskScopePolicy(new Uint8Array([0xff]), selected)).toEqual({ state: "INVALID" });
    expect(extractTaskScopePolicy(new Uint8Array([0xef, 0xbb, 0xbf, ...planBytes(`${heading}\n${block()}`)]), selected)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\r${block()}`)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\n${block('{"schemaVersion":"justice-s1c-task-scope-v1","schemaVersion":"justice-s1c-task-scope-v1"}')}`)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\n${Array.from({ length: 129 }, () => block()).join("\n")}`)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\n${block(`${" ".repeat(65_537)}`)}`)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\n${block(policy("task-1", "R1", "plan-1", "R1", "scope-1", Array.from({ length: 129 }, (_, i) => `src/${i}`)))}`)).toEqual({ state: "INVALID" });
    expect(extract(`${heading}\n\`\`\`\n${begin}\n${end}\n\`\`\``)).toEqual({ state: "UNDEFINED" });
    expect(extractTaskScopePolicy(new Uint8Array(8_388_609), selected)).toEqual({ state: "INVALID" });
  });

  test("measuresPolicyPayloadBytesWithoutDroppingCrLf", () => {
    const base = policy();
    const split = base.indexOf('"allowedPaths"');
    const multiline = `${base.slice(0, split)}\n${base.slice(split)}`;
    const atLimitLf = `${multiline}${" ".repeat(65_536 - Buffer.byteLength(multiline, "utf8"))}`;
    expect(extract(`${heading}\n${begin}\n${atLimitLf}\n${end}`)).toMatchObject({ state: "READY" });

    const atLimitCrLf = `${multiline}${" ".repeat(65_536 - Buffer.byteLength(multiline, "utf8") - 1)}`;
    expect(extract(`${heading}\r\n${begin}\r\n${atLimitCrLf}\r\n${end}`)).toMatchObject({ state: "READY" });

    const overLimitCrLf = `${multiline}${" ".repeat(65_538 - Buffer.byteLength(multiline, "utf8") - 1)}`;
    expect(extract(`${heading}\r\n${begin}\r\n${overLimitCrLf}\r\n${end}`)).toEqual({ state: "INVALID" });
  });
});
