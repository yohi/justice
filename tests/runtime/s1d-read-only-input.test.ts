import { describe, expect, it, vi } from "vitest";
import { loadS1aArtifacts } from "../../src/core/s1a/loader.js";
import type { S1aReadOnlySource } from "../../src/core/s1a/contract.js";
import { createCapturedS1aSource, readS1dJsonInput } from "../../src/runtime/s1d-read-only-input.js";
import { jsonBytes, s1aFixture, sha256 } from "../helpers/s1a-fixtures.js";

const issueCode = async (
  source: S1aReadOnlySource,
  path: string,
  kind: "evidence" | "changeset",
): Promise<string | undefined> => {
  const result = await readS1dJsonInput(source, path, kind);
  return result.state === "LEVEL_A_ERROR" ? result.issue.code : undefined;
};

describe("S1-d read-only input", () => {
  it("classifiesReadOversizeUtf8AndJsonIndependently", async () => {
    const source: S1aReadOnlySource = {
      async readInputFile(path) {
        if (path === "read-failure") throw Error("secret path");
        if (path === "oversize") return new Uint8Array(1_048_577);
        if (path === "utf8") return new Uint8Array([0xc3, 0x28]);
        return new TextEncoder().encode('{"a":1,"a":2}');
      },
      async readArtifact() { throw Error("unused"); },
    };
    expect(await issueCode(source, "read-failure", "evidence")).toBe("INPUT_READ_FAILED");
    expect(await issueCode(source, "oversize", "evidence")).toBe("INPUT_TOO_LARGE");
    expect(await issueCode(source, "utf8", "evidence")).toBe("INPUT_UTF8_INVALID");
    expect(await issueCode(source, "duplicate", "evidence")).toBe("INPUT_JSON_INVALID");
  });

  it("keepsCoreInvalidJsonAsParsedUnknown", async () => {
    const source: S1aReadOnlySource = {
      async readInputFile(path) { return jsonBytes(path === "evidence" ? { invalid: true } : { availability: "PRESENT", changes: "invalid" }); },
      async readArtifact() { throw Error("unused"); },
    };
    expect(await readS1dJsonInput(source, "evidence", "evidence")).toEqual({ state: "PARSED", value: { invalid: true } });
    expect(await readS1dJsonInput(source, "changeset", "changeset")).toEqual({ state: "PARSED", value: { availability: "PRESENT", changes: "invalid" } });
  });

  it("capturesOnlySelectedPlanWithoutReread", async () => {
    const fixture = s1aFixture();
    const readInputFile = vi.fn(fixture.source.readInputFile);
    const readArtifact = vi.fn(fixture.source.readArtifact);
    const wrapped = createCapturedS1aSource({ ...fixture.source, readInputFile, readArtifact }, fixture.input);
    const result = await loadS1aArtifacts(fixture.input, wrapped.source);
    expect(readInputFile).toHaveBeenCalledTimes(2);
    expect(readArtifact).toHaveBeenCalledTimes(5);
    const snapshot = wrapped.getPlanSnapshot(result);
    expect(snapshot).toEqual(fixture.files["plan-1.md"]);
    expect(snapshot).not.toBe(fixture.files["plan-1.md"]);
  });

  it("retainsSafelyCapturedMismatchedPlan", async () => {
    const fixture = s1aFixture();
    const planBytes = new TextEncoder().encode("changed plan");
    const source: S1aReadOnlySource = {
      async readInputFile(path) { return path === fixture.input.manifestPath ? jsonBytes(fixture.manifest) : jsonBytes(fixture.intent); },
      async readArtifact(root, path, cap) { return path === "plan-1.md" ? planBytes : fixture.source.readArtifact(root, path, cap); },
    };
    const wrapped = createCapturedS1aSource(source, fixture.input);
    const result = await loadS1aArtifacts(fixture.input, wrapped.source);
    expect(result.checks.some((check) => check.reasonCode === "ARTIFACT_DIGEST_MISMATCH")).toBe(true);
    expect(wrapped.getPlanSnapshot(result)).toEqual(planBytes);
    expect(sha256(planBytes)).not.toBe(result.selectedRefs.find((ref) => ref.kind === "plan")?.expectedDigest);
  });

  it("rejectsMissingUnboundOrAmbiguousPlanSnapshot", async () => {
    const fixture = s1aFixture();
    const neverPlan: S1aReadOnlySource = {
      ...fixture.source,
      async readArtifact(root, path, cap) {
        if (path === "plan-1.md") throw Error("unreadable");
        return fixture.source.readArtifact(root, path, cap);
      },
    };
    const captured = createCapturedS1aSource(neverPlan, fixture.input);
    const result = await loadS1aArtifacts(fixture.input, captured.source);
    expect(captured.getPlanSnapshot(result)).toBeNull();
    expect(captured.getPlanSnapshot({ ...result, selectedRefs: [] })).toBeNull();
  });

  it("doesNotBypassReadOnlyFilesystemGuards", async () => {
    const fixture = s1aFixture();
    const guarded = vi.fn(async (_root: string, _path: string, _cap: number) => { throw Object.assign(Error("unsafe"), { kind: "unsafe_path" }); });
    const source: S1aReadOnlySource = {
      async readInputFile(path) { return jsonBytes(path === fixture.input.manifestPath ? fixture.manifest : fixture.intent); },
      async readArtifact(root, path, cap) { return guarded(root, path, cap); },
    };
    const wrapped = createCapturedS1aSource(source, fixture.input);
    const result = await loadS1aArtifacts(fixture.input, wrapped.source);
    expect(guarded).toHaveBeenCalled();
    expect(wrapped.getPlanSnapshot(result)).toBeNull();
  });
});
