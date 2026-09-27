import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { test } from "bun:test";
import { compareVersions, isCandidateVersionAllowed } from "../../scripts/release-version-guard.mjs";

test("accepts a candidate newer than the latest release", () => {
  assert.equal(isCandidateVersionAllowed("4.0.0", "3.0.0"), true);
});

test("accepts a candidate equal to the latest release", () => {
  assert.equal(isCandidateVersionAllowed("3.0.0", "3.0.0"), true);
});

test("rejects a candidate older than the latest release", () => {
  assert.equal(isCandidateVersionAllowed("2.5.0", "3.0.0"), false);
});

test("rejects malformed semantic versions", () => {
  assert.throws(() => compareVersions("3.0", "3.0.0"), /Invalid stable version/);
});

test("CLI exits nonzero and reports both versions for a downgrade", () => {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/release-version-guard.mjs",
      "--candidate",
      "2.5.0",
      "--latest",
      "3.0.0",
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /2\.5\.0/);
  assert.match(result.stderr, /3\.0\.0/);
});
