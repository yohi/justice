/* eslint-disable security/detect-non-literal-fs-filename -- recordPath is a hardcoded governance record path (SPEC.md) resolved relative to __dirname, not user input. */
import { readFileSync, existsSync } from "fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

test("preflight verification: ADR ratification check", () => {
  // The ADR body is transcribed into SPEC.md §15.12 ("CODEOWNERS 追認 ADR")
  // since docs/superpowers/ was removed.
  const recordPath = resolve(__dirname, "..", "SPEC.md");
  expect(existsSync(recordPath)).toBe(true);
  const content = readFileSync(recordPath, "utf-8");
  const sectionHeading = /^### 15\.12\b[^\n]*$/m.exec(content);
  expect(sectionHeading).not.toBeNull();
  if (sectionHeading === null || sectionHeading.index === undefined) return;
  const afterSectionHeading = content.slice(
    sectionHeading.index + sectionHeading[0].length,
  );
  const nextSectionOffset = afterSectionHeading.search(/^### (?!#)/m);
  const sectionEnd =
    nextSectionOffset === -1
      ? content.length
      : sectionHeading.index + sectionHeading[0].length + nextSectionOffset;
  const section = content.slice(sectionHeading.index, sectionEnd);
  // Status must be APPROVED after 2026-08-02 ratification
  expect(section).toMatch(/\*\s*\*\*Status:\*\*\s*APPROVED/);
  // Ratification section documents the structural constraint and re-definition of evidence
  expect(section).toContain("Ratification (2026-08-02)");
  expect(section).toContain("structurally unachievable");
  expect(section).toContain("Re-definition of ratification evidence");
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
    expect(section).not.toContain(handle);
  }
  expect(section).not.toMatch(placeholderPattern);
  // Verify essential ADR contents (Finding 3)
  expect(section).toMatch(/\bD44\b/);
  expect(section).toContain("§4.5");
  expect(section).toMatch(/\bD5\b/);
  expect(section).toMatch(/\bD54\b/);
  expect(section).toMatch(/\bD63\b/);
  expect(section).toMatch(/\bINV-004\b/);
  expect(section).toMatch(/\bM4\b/);
});
