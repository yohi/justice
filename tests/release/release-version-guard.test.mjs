import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "bun:test";
import {
  assertNoTagCollision,
  assertPackageManifestMatch,
  compareVersions,
  isCandidateVersionAllowed,
  resolveReleaseChannel,
  selectLatestVersion,
} from "../../scripts/release-version-guard.mjs";

const matrix = [
  ["4.3.1", "4.1.0", false],
  ["4.3.1", "4.3.1", false],
  ["4.3.1", "4.3.2", true],
  ["4.3.1", "6.0.0-rc.1", true],
  ["6.0.0-rc.1", "6.0.0-rc.1", false],
  ["6.0.0-rc.1", "6.0.0-rc.2", true],
  ["6.0.0-rc.2", "6.0.0-rc.1", false],
  ["6.0.0-rc.2", "6.0.0-rc.10", true],
  ["6.0.0-rc.2", "6.0.0", true],
  ["6.0.0", "6.0.0-rc.3", false],
  ["6.0.0", "6.0.1", true],
];

for (const [latest, candidate, expected] of matrix) {
  test(`latest ${latest} / candidate ${candidate} => ${expected ? "ALLOW" : "REJECT"}`, () => {
    assert.equal(isCandidateVersionAllowed(candidate, latest), expected);
  });
}

test("rejects leading-zero numeric prerelease identifiers", () => {
  assert.throws(() => isCandidateVersionAllowed("6.0.0-rc.01", "4.3.1"), /Invalid/);
});

test("rejects invalid versions", () => {
  assert.throws(() => isCandidateVersionAllowed("invalid", "4.3.1"), /Invalid/);
  assert.throws(() => compareVersions("3.0", "3.0.0"), /Invalid/);
  assert.throws(() => compareVersions("1.0.0+build", "1.0.0"), /Invalid/);
});

test("numeric identifiers sort below alphanumeric ones and shorter sets sort first", () => {
  assert.equal(compareVersions("1.0.0-1", "1.0.0-alpha"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-alpha.1"), -1);
  assert.equal(compareVersions("1.0.0-alpha.beta", "1.0.0-beta"), -1);
});

test("selectLatestVersion uses SemVer precedence, not lexical tag order", () => {
  const tags = ["v4.3.1", "v6.0.0-rc.2", "v6.0.0-rc.10", "v4.10.0", "not-a-release", "v6.0.0-rc.01"];
  assert.equal(selectLatestVersion(tags), "6.0.0-rc.10");
});

test("selectLatestVersion ignores tags that parseSemVer rejects", () => {
  const tags = ["v4.3.1", "v99999999999999999999.0.0", "v1.0.0-1" + "9".repeat(20)];
  assert.equal(selectLatestVersion(tags), "4.3.1");
});

test("selectLatestVersion fails closed with no release tags", () => {
  assert.throws(() => selectLatestVersion(["foo"]), /No release tag/);
});

test("assertNoTagCollision rejects an already tagged candidate", () => {
  assert.throws(() => assertNoTagCollision("4.1.0", ["v4.1.0", "v4.3.1"]), /already exists/);
  assert.doesNotThrow(() => assertNoTagCollision("6.0.0-rc.1", ["v4.1.0", "v4.3.1"]));
});

test("assertPackageManifestMatch requires package.json and manifest to agree", () => {
  assert.doesNotThrow(() => assertPackageManifestMatch("6.0.0-rc.1", { ".": "6.0.0-rc.1" }));
  assert.throws(() => assertPackageManifestMatch("6.0.0-rc.1", { ".": "4.0.0" }), /mismatch/i);
  assert.throws(() => assertPackageManifestMatch("6.0.0-rc.1", {}), /mismatch/i);
});

test("resolveReleaseChannel maps stable to latest and prerelease to next", () => {
  assert.deepEqual(resolveReleaseChannel("6.0.0", "v6.0.0"), { distTag: "latest", prerelease: false });
  assert.deepEqual(resolveReleaseChannel("6.0.0-rc.1", "v6.0.0-rc.1"), { distTag: "next", prerelease: true });
});

test("resolveReleaseChannel rejects tag mismatch and invalid versions", () => {
  assert.throws(() => resolveReleaseChannel("6.0.0-rc.1", "v6.0.0-rc.2"), /Tag/);
  assert.throws(() => resolveReleaseChannel("6.0.0-rc.1", "6.0.0-rc.1"), /Tag/);
  assert.throws(() => resolveReleaseChannel("bogus", "vbogus"), /Invalid/);
});

function runGuard(args) {
  return spawnSync(process.execPath, ["scripts/release-version-guard.mjs", ...args], { encoding: "utf8" });
}

test("CLI exits nonzero and reports both versions for a downgrade", () => {
  const result = runGuard(["--candidate", "2.5.0", "--latest", "3.0.0"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /2\.5\.0/);
  assert.match(result.stderr, /3\.0\.0/);
});

test("CLI check mode validates tags, package.json and manifest", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  const tags = join(dir, "tags.txt");
  const pkg = join(dir, "package.json");
  const manifest = join(dir, "manifest.json");
  writeFileSync(tags, "v4.3.1\nv4.1.0\n");
  writeFileSync(pkg, JSON.stringify({ version: "6.0.0-rc.1" }));
  writeFileSync(manifest, JSON.stringify({ ".": "6.0.0-rc.1" }));
  const ok = runGuard(["check", "--package", pkg, "--manifest", manifest, "--tags-file", tags]);
  assert.equal(ok.status, 0, ok.stderr);

  writeFileSync(manifest, JSON.stringify({ ".": "4.0.0" }));
  const bad = runGuard(["check", "--package", pkg, "--manifest", manifest, "--tags-file", tags]);
  assert.equal(bad.status, 1);
});

test("CLI channel mode prints dist-tag and prerelease flag, rejects mismatches", () => {
  const ok = runGuard(["channel", "--version", "6.0.0-rc.1", "--tag", "v6.0.0-rc.1"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /dist_tag=next/);
  assert.match(ok.stdout, /prerelease=true/);
  const bad = runGuard(["channel", "--version", "6.0.0-rc.1", "--tag", "v6.0.0"]);
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
});
