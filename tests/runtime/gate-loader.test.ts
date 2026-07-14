import { afterEach, describe, expect, it, vi } from "vitest";
import { FileGateLoader, loadGates, mergeWithDefaults } from "../../src/runtime/gate-loader";
import { DEFAULT_GATES } from "../../src/core/v2/default-gates";
import type { GateRule } from "../../src/core/v2/gate-definition";
import type { FileReader } from "../../src/core/types";
import { createMockFileReader } from "../helpers/mock-file-system";

/** A complete custom gate that shares its id with the `required-tests` default. */
const OVERRIDE_YAML = `
schemaVersion: 1
authority: human_approved
gates:
  - id: required-tests
    description: "タスク完了前にテストが pass していること"
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: test, requireOutcome: pass }
    onViolation: fail
    onMissingEvidence: warn
    enabled: true
`;

/** A brand-new gate whose id is not present in DEFAULT_GATES. */
const NEW_GATE_YAML = `
schemaVersion: 1
authority: human_approved
gates:
  - id: lint-clean
    description: "タスク完了前に lint が pass していること"
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: lint, requireOutcome: pass }
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
`;

/** Disables the `required-tests` default via enabled: false. */
const DISABLE_YAML = `
schemaVersion: 1
authority: human_approved
gates:
  - id: required-tests
    gateType: task
    trigger: { on: task_complete }
    check: { type: evidence_outcome, evidenceKind: test, requireOutcome: pass }
    onViolation: warn
    onMissingEvidence: warn
    enabled: false
`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadGates", () => {
  it("returns DEFAULT_GATES when no gate.yaml is present (ENOENT)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = createMockFileReader({});

    const result = await loadGates(reader);

    expect(result).toEqual(DEFAULT_GATES);
    // A missing file is expected; it must not produce a warning.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("overrides a default gate when a custom gate supplies a full object with the same id", async () => {
    const reader = createMockFileReader({ ".justice/gate.yaml": OVERRIDE_YAML });

    const result = await loadGates(reader);

    // Same id => replace, not add: the gate count stays at 3.
    expect(result).toHaveLength(3);
    const requiredTests = result.find((gate) => gate.id === "required-tests");
    expect(requiredTests?.onViolation).toBe("fail"); // overridden from the default "warn"
    // Untouched defaults keep their original values.
    expect(result.find((gate) => gate.id === "build-green")?.onViolation).toBe("warn");
    expect(result.find((gate) => gate.id === "review-clean")?.onViolation).toBe("warn");
  });

  it("adds a new custom gate whose id is not among the defaults", async () => {
    const reader = createMockFileReader({ ".justice/gate.yaml": NEW_GATE_YAML });

    const result = await loadGates(reader);

    expect(result).toHaveLength(4); // 3 defaults + 1 new
    expect(result.map((gate) => gate.id)).toEqual(
      expect.arrayContaining(["required-tests", "build-green", "review-clean", "lint-clean"]),
    );
  });

  it("excludes a default gate disabled via enabled: false", async () => {
    const reader = createMockFileReader({ ".justice/gate.yaml": DISABLE_YAML });

    const result = await loadGates(reader);

    expect(result.map((gate) => gate.id)).not.toContain("required-tests");
    expect(result.map((gate) => gate.id)).toEqual(["build-green", "review-clean"]);
  });

  it("warns and falls back to defaults on a non-ENOENT read error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader: FileReader = {
      readFile: vi.fn(async () => {
        const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }),
      fileExists: vi.fn(async () => true),
      listFiles: vi.fn(async () => []),
      readFileStats: vi.fn(async () => null),
    };

    const result = await loadGates(reader);

    expect(result).toEqual(DEFAULT_GATES);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("warns and falls back to defaults when the YAML is invalid", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = createMockFileReader({
      ".justice/gate.yaml": "schemaVersion: 2\nauthority: generated\ngates: []\n",
    });

    const result = await loadGates(reader);

    expect(result).toEqual(DEFAULT_GATES);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("warns and falls back to defaults when gate.yaml exists but is empty", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reader = createMockFileReader({ ".justice/gate.yaml": "" });

    const result = await loadGates(reader);

    expect(result).toEqual(DEFAULT_GATES);
    // An empty (but present) file must not be treated as a missing file:
    // it should reach YAML/Zod validation and warn before falling back.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("mergeWithDefaults", () => {
  it("keeps all DEFAULT_GATES when no custom gates are provided", () => {
    expect(mergeWithDefaults([])).toEqual(DEFAULT_GATES);
  });

  it("overrides a default gate's attributes when ids match", () => {
    const override: GateRule = {
      id: "required-tests",
      description: "タスク完了前にテストが pass していること",
      gateType: "task",
      trigger: { on: "task_complete" },
      check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
      onViolation: "fail",
      onMissingEvidence: "warn",
      enabled: true,
    };

    const merged = mergeWithDefaults([override]);

    expect(merged).toHaveLength(3);
    expect(merged.find((gate) => gate.id === "required-tests")?.onViolation).toBe("fail");
  });

  it("adds a custom gate whose id is not among the defaults", () => {
    const custom: GateRule = {
      id: "lint-clean",
      gateType: "task",
      trigger: { on: "task_complete" },
      check: { type: "evidence_outcome", evidenceKind: "lint", requireOutcome: "pass" },
      onViolation: "warn",
      onMissingEvidence: "warn",
      enabled: true,
    };

    const merged = mergeWithDefaults([custom]);

    expect(merged).toHaveLength(4);
    expect(merged.map((gate) => gate.id)).toContain("lint-clean");
  });

  it("excludes a gate marked enabled: false", () => {
    const disabled: GateRule = {
      id: "required-tests",
      gateType: "task",
      trigger: { on: "task_complete" },
      check: { type: "evidence_outcome", evidenceKind: "test", requireOutcome: "pass" },
      onViolation: "warn",
      onMissingEvidence: "warn",
      enabled: false,
    };

    const merged = mergeWithDefaults([disabled]);

    expect(merged.map((gate) => gate.id)).not.toContain("required-tests");
    expect(merged).toHaveLength(2);
  });
});

describe("FileGateLoader", () => {
  it("delegates to loadGates with the default path", async () => {
    const reader = createMockFileReader({});
    const loader = new FileGateLoader(reader);

    expect(await loader.load()).toEqual(DEFAULT_GATES);
  });

  it("honours a custom configuration path", async () => {
    const reader = createMockFileReader({ "custom/gate.yaml": NEW_GATE_YAML });
    const loader = new FileGateLoader(reader, "custom/gate.yaml");

    const result = await loader.load();

    expect(result.map((gate) => gate.id)).toContain("lint-clean");
  });
});
