import { describe, expect, it, vi } from "vitest";
import { FileGateLoader } from "../../src/runtime/gate-loader";
import { createMockFileReader } from "../helpers/mock-file-system";

function gateYaml(body: string): string {
  return `schemaVersion: 1\nauthority: human_approved\n${body}`;
}

describe("gate yaml validation", () => {
  it("rejects injected or invalid gate.yaml payloads and falls back to defaults", async () => {
    const reader = createMockFileReader({
      ".justice/gate.yaml": gateYaml(`
gates:
  - id: injected
    gateType: task
    trigger:
      on: task_complete
    check:
      type: invalid_check
      evidenceKind: test
      requireOutcome: pass
    onViolation: warn
    onMissingEvidence: warn
    enabled: true
`),
    });
    const logger = { warn: vi.fn() };
    const loader = new FileGateLoader(reader, ".justice/gate.yaml", logger);
    const gates = await loader.load();

    expect(logger.warn).toHaveBeenCalled();
    expect(gates.some((g) => g.id === "injected")).toBe(false);
    expect(gates.some((g) => g.id === "required-tests")).toBe(true);
  });

  it("uses defaults when gate.yaml is missing", async () => {
    const reader = createMockFileReader({});
    const logger = { warn: vi.fn() };
    const loader = new FileGateLoader(reader, ".justice/gate.yaml", logger);
    const gates = await loader.load();

    expect(gates.some((g) => g.id === "required-tests")).toBe(true);
    expect(gates.some((g) => g.id === "build-green")).toBe(true);
    expect(gates.some((g) => g.id === "review-clean")).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("overriding an existing default gate id can disable the security gate", async () => {
    const reader = createMockFileReader({
      ".justice/gate.yaml": gateYaml(`
gates:
  - id: required-tests
    gateType: task
    trigger:
      on: task_complete
    check:
      type: evidence_present
      evidenceKind: test
    onViolation: pass
    onMissingEvidence: pass
    enabled: true
`),
    });
    const logger = { warn: vi.fn() };
    const loader = new FileGateLoader(reader, ".justice/gate.yaml", logger);
    const gates = await loader.load();

    const requiredTests = gates.find((g) => g.id === "required-tests");
    expect(requiredTests).toBeDefined();
    expect(requiredTests?.check).toEqual({ type: "evidence_present", evidenceKind: "test" });
    expect(requiredTests?.onViolation).toBe("pass");
    expect(requiredTests?.onMissingEvidence).toBe("pass");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("loads valid gate.yaml that disables a default gate while retaining others", async () => {
    const reader = createMockFileReader({
      ".justice/gate.yaml": gateYaml(`
gates:
  - id: required-tests
    gateType: task
    trigger:
      on: task_complete
    check:
      type: evidence_present
      evidenceKind: test
    onViolation: pass
    onMissingEvidence: pass
    enabled: false
`),
    });
    const logger = { warn: vi.fn() };
    const loader = new FileGateLoader(reader, ".justice/gate.yaml", logger);
    const gates = await loader.load();

    expect(gates.some((g) => g.id === "required-tests")).toBe(false);
    expect(gates.some((g) => g.id === "build-green")).toBe(true);
    expect(gates.some((g) => g.id === "review-clean")).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
