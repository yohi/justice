/* eslint-disable security/detect-non-literal-fs-filename -- adrPath is a hardcoded ADR spec path resolved relative to __dirname, not user input. */
import { readFileSync, existsSync } from "fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("preflight verification: ADR ratification check", () => {
  const adrPath = resolve(
    __dirname,
    "..",
    "docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md",
  );
  expect(existsSync(adrPath)).toBe(true);
  const content = readFileSync(adrPath, "utf-8");
  // Status must be APPROVED after 2026-08-02 ratification
  expect(content).toMatch(/\*\s*\*\*Status:\*\*\s*APPROVED/);
  // Ratification section documents the structural constraint and re-definition of evidence
  expect(content).toContain("Ratification (2026-08-02)");
  expect(content).toContain("structurally unachievable");
  expect(content).toContain("Re-definition of ratification evidence");
  // Verify real approvers are documented instead of placeholder names
  const blockedPlaceholders = [
    "@owner-alice",
    "@owner-bob",
    "@alice",
    "@bob",
    "@example",
    "@codeowner",
  ];
  const placeholderPattern =
    /@(?:[A-Za-z0-9_-]*(?:codeowner|placeholder|example|owner|alice|bob)[A-Za-z0-9_-]*)/i;
  for (const handle of blockedPlaceholders) {
    expect(content).not.toContain(handle);
  }
  expect(content).not.toMatch(placeholderPattern);
  // Verify essential ADR contents (Finding 3)
  expect(content).toMatch(/\bD44\b/);
  expect(content).toContain("§4.5");
  expect(content).toMatch(/\bD5\b/);
  expect(content).toMatch(/\bD54\b/);
  expect(content).toMatch(/\bD63\b/);
  expect(content).toMatch(/\bINV-004\b/);
  expect(content).toMatch(/\bM4\b/);
});
