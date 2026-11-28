import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "bun:test";
import {
  assertLabelsAuthorized,
  parseReleaseLabels,
  resolveTargetVersion,
} from "../../scripts/release-label-resolver.mjs";

const tagsFor = (...versions) => versions.map((version) => `v${version}`);
const resolveWith = (tags, labels) => resolveTargetVersion(tags, parseReleaseLabels(labels));

const transitions = [
  [["4.3.1"], ["release: major", "release: rc"], "5.0.0-rc.1"],
  [["4.3.1"], ["release: version=6.0.0", "release: rc"], "6.0.0-rc.1"],
  [["4.3.1", "6.0.0-rc.1"], ["release: rc"], "6.0.0-rc.2"],
  [["4.3.1", "6.0.0-rc.1", "6.0.0-rc.2"], ["release: stable"], "6.0.0"],
  [["6.0.0"], ["release: patch", "release: stable"], "6.0.1"],
  [["6.0.0"], ["release: minor", "release: stable"], "6.1.0"],
  [["6.0.0"], ["release: minor", "release: rc"], "6.1.0-rc.1"],
  [["6.0.0"], ["release: major", "release: rc"], "7.0.0-rc.1"],
  [["6.0.0", "7.0.0-rc.1"], ["release: stable"], "7.0.0"],
  [["4.3.1", "6.0.0-alpha.1"], ["release: beta"], "6.0.0-beta.1"],
  [["4.3.1", "6.0.0-beta.2"], ["release: rc"], "6.0.0-rc.1"],
];

for (const [versions, labels, expected] of transitions) {
  test(`${versions.join(",")} + ${labels.join(" + ")} => ${expected}`, () => {
    assert.equal(resolveWith(tagsFor(...versions), labels), expected);
  });
}

test("no release labels means no selection", () => {
  assert.equal(parseReleaseLabels(["bug", "autorelease: pending"]), null);
});

test("conflicting or malformed labels are rejected", () => {
  for (const labels of [
    ["release: major", "release: minor", "release: rc"],
    ["release: rc", "release: beta"],
    ["release: version=6.0.0", "release: major", "release: rc"],
    ["release: version=6.0.0", "release: version=7.0.0", "release: rc"],
    ["release: version=6.0", "release: rc"],
    ["release: version=6.0.0-rc.1", "release: rc"],
    ["release: version=06.0.0", "release: rc"],
    ["release: bogus", "release: rc"],
    ["release:rc"],
    ["release: major"],
    ["release: version=6.0.0"],
  ]) {
    assert.throws(() => parseReleaseLabels(labels), RangeError, labels.join(","));
  }
});

test("RC numbering is idempotent and ignores unpublished candidates", () => {
  const tags = tagsFor("4.3.1", "6.0.0-rc.1");
  const first = resolveWith(tags, ["release: rc"]);
  assert.equal(resolveWith(tags, ["release: rc"]), first);
  assert.equal(first, "6.0.0-rc.2");
});

test("rc numbers compare numerically (rc.9 -> rc.10)", () => {
  assert.equal(resolveWith(tagsFor("4.3.1", "6.0.0-rc.9"), ["release: rc"]), "6.0.0-rc.10");
});

test("channel-only on a stable baseline is ambiguous and rejected", () => {
  assert.throws(() => resolveWith(tagsFor("6.0.0"), ["release: rc"]), /No active prerelease series/);
  assert.throws(() => resolveWith(tagsFor("6.0.0"), ["release: stable"]), /No active prerelease series/);
});

test("multiple prerelease series require an explicit version", () => {
  const tags = tagsFor("4.3.1", "6.0.0-rc.1", "7.0.0-alpha.1");
  assert.throws(() => resolveWith(tags, ["release: rc"]), /Ambiguous/);
  assert.equal(resolveWith(tags, ["release: version=7.0.0", "release: rc"]), "7.0.0-rc.1");
});

test("downgrades and tag collisions are rejected", () => {
  assert.throws(() => resolveWith(tagsFor("4.3.1", "6.0.0-rc.1"), ["release: major", "release: rc"]), /not newer/);
  assert.throws(() => resolveWith(tagsFor("4.3.1"), ["release: version=4.3.1", "release: stable"]), /already exists/);
  assert.throws(() => resolveWith(tagsFor("6.0.0"), ["release: version=6.0.0", "release: rc"]), /not newer/);
});

test("labels must be attributable to an actor with write access", () => {
  const labels = ["release: major", "release: rc", "unrelated"];
  const events = [
    { label: "release: major", actor: "owner" },
    { label: "release: rc", actor: "owner" },
  ];
  assert.doesNotThrow(() => assertLabelsAuthorized(labels, events, { owner: "write" }));
  assert.throws(() => assertLabelsAuthorized(labels, events, { owner: "read" }), /without write/);
  assert.throws(() => assertLabelsAuthorized(labels, events, {}), /without write/);
  assert.throws(() => assertLabelsAuthorized(labels, [events[0]], { owner: "admin" }), /no attributable/);
  const reapplied = [...events, { label: "release: rc", actor: "stranger" }];
  assert.throws(() => assertLabelsAuthorized(labels, reapplied, { owner: "admin", stranger: "read" }), /without write/);
});

function runCli(files) {
  const dir = mkdtempSync(join(tmpdir(), "label-"));
  const write = (name, data) => {
    const path = join(dir, name);
    writeFileSync(path, typeof data === "string" ? data : JSON.stringify(data));
    return path;
  };
  const args = ["scripts/release-label-resolver.mjs", "resolve", "--tags-file", write("tags", files.tags), "--labels-file", write("labels", files.labels)];
  if (files.events) args.push("--events-file", write("events", files.events), "--permissions-file", write("perms", files.perms));
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("CLI prints release_as for an authorized selection and empty for none", () => {
  const ok = runCli({
    tags: "v4.3.1\n",
    labels: ["release: version=6.0.0", "release: rc"],
    events: [{ label: "release: version=6.0.0", actor: "o" }, { label: "release: rc", actor: "o" }],
    perms: { o: "admin" },
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "release_as=6.0.0-rc.1\n");
  assert.equal(runCli({ tags: "v4.3.1\n", labels: [] }).stdout, "release_as=\n");
});

test("CLI fails closed on unauthorized or conflicting labels", () => {
  const bad = runCli({ tags: "v4.3.1\n", labels: ["release: major", "release: rc"], events: [], perms: {} });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.equal(runCli({ tags: "v4.3.1\n", labels: ["release: major", "release: minor", "release: rc"] }).status, 1);
});
