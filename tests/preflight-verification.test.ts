import { readFileSync, existsSync } from "fs";
import { expect, test } from "vitest";

test("preflight verification: ADR ratification check", () => {
  const adrPath = "docs/superpowers/specs/ADR-2026-06-26-v2-charter-drift.md";
  expect(existsSync(adrPath)).toBe(true);
  const content = readFileSync(adrPath, "utf-8");
  expect(content).toMatch(/\*\s*\*\*Status:\*\*\s*APPROVED/);
  // Verify real approvers are documented instead of placeholder names (avoiding hardcoded names)
  expect(content).toMatch(/\*\s*\*\*Approvers:\*\*\s*`@[A-Za-z0-9_-]+`/);
  const blockedPlaceholders = ["@owner-alice", "@owner-bob", "@alice", "@bob", "@example", "@codeowner"];
  for (const handle of blockedPlaceholders) {
    expect(content).not.toContain(handle);
  }
  // Verify essential ADR contents (Finding 3)
  expect(content).toContain("D44");
  expect(content).toContain("§4.5");
  expect(content).toContain("D5");
  expect(content).toContain("D54");
  expect(content).toContain("D63");
  expect(content).toContain("INV-004");
  expect(content).toContain("M4");
});
