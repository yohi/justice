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
  expect(content).toMatch(/\*\s*\*\*Status:\*\*\s*PENDING HUMAN CODEOWNERS RATIFICATION/);
  // Prevent stale 'Status: APPROVED' in metadata while allowing valid 'APPROVED' in review history
  expect(content).not.toMatch(/\*\s*\*\*Status:\*\*\s*APPROVED/);
  // Verify real approvers are documented instead of placeholder names (avoiding hardcoded names)
  expect(content).toContain("Required action:");
  expect(content).toContain("human CODEOWNERS");
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
