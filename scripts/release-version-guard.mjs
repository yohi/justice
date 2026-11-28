import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// SemVer 2.0.0 without build metadata (release-please never emits it).
const NUMERIC = "0|[1-9][0-9]*";
const PRERELEASE_ID = `(?:${NUMERIC}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const VERSION_PATTERN = new RegExp(
  `^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?$`,
);
const NUMERIC_ID = /^(0|[1-9][0-9]*)$/;

function parseVersion(version) {
  const match = typeof version === "string" ? VERSION_PATTERN.exec(version) : null;
  if (match === null) {
    throw new RangeError(`Invalid semantic version: ${version}`);
  }

  const core = match.slice(1, 4).map(Number);
  if (!core.every(Number.isSafeInteger)) {
    throw new RangeError(`Version component exceeds the safe integer range: ${version}`);
  }
  const pre = match[4] === undefined ? [] : match[4].split(".");
  if (pre.some((id) => NUMERIC_ID.test(id) && !Number.isSafeInteger(Number(id)))) {
    throw new RangeError(`Prerelease identifier exceeds the safe integer range: ${version}`);
  }
  return { core, pre };
}

function comparePrerelease(left, right) {
  // A version without prerelease identifiers has higher precedence.
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    const aNumeric = NUMERIC_ID.test(a);
    const bNumeric = NUMERIC_ID.test(b);
    if (aNumeric && bNumeric) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  if (left.length === right.length) return 0;
  return left.length < right.length ? -1 : 1;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] < b.core[index]) return -1;
    if (a.core[index] > b.core[index]) return 1;
  }
  return comparePrerelease(a.pre, b.pre);
}

/** A release candidate must be strictly newer than the latest release. */
export function isCandidateVersionAllowed(candidate, latest) {
  return compareVersions(candidate, latest) > 0;
}

function versionsFromTags(tags) {
  const versions = [];
  for (const tag of tags) {
    if (!tag.startsWith("v")) continue;
    const version = tag.slice(1);
    if (VERSION_PATTERN.test(version)) versions.push(version);
  }
  return versions;
}

/** Highest SemVer version among release tags (independent of git ref sort order). */
export function selectLatestVersion(tags) {
  const versions = versionsFromTags(tags);
  if (versions.length === 0) {
    throw new RangeError("No release tag (vX.Y.Z[-prerelease]) is available for comparison.");
  }
  return versions.reduce((best, version) => (compareVersions(version, best) > 0 ? version : best));
}

export function assertNoTagCollision(candidate, tags) {
  parseVersion(candidate);
  if (tags.includes(`v${candidate}`)) {
    throw new RangeError(`Release tag v${candidate} already exists`);
  }
}

export function assertPackageManifestMatch(packageVersion, manifest) {
  const manifestVersion = manifest?.["."];
  if (manifestVersion !== packageVersion) {
    throw new RangeError(
      `Version mismatch: package.json=${packageVersion} manifest=${String(manifestVersion)}`,
    );
  }
}

/** Maps a version to its npm dist-tag / GitHub prerelease flag; fails closed on tag mismatch. */
export function resolveReleaseChannel(version, tag) {
  const { pre } = parseVersion(version);
  if (tag !== `v${version}`) {
    throw new RangeError(`Tag ${String(tag)} does not match package version v${version}`);
  }
  const prerelease = pre.length > 0;
  return { distTag: prerelease ? "next" : "latest", prerelease };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readTags(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseFlags(args, allowed) {
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.includes(name) || value === undefined || value.length === 0 || name in flags) {
      throw new TypeError(`Unexpected or incomplete argument: ${String(name)}`);
    }
    flags[name] = value;
  }
  for (const name of allowed) {
    if (!(name in flags)) throw new TypeError(`Missing required argument: ${name}`);
  }
  return flags;
}

function run(args) {
  const [mode, ...rest] = args;
  if (mode === "check") {
    const flags = parseFlags(rest, ["--package", "--manifest", "--tags-file"]);
    const candidate = readJson(flags["--package"]).version;
    parseVersion(candidate);
    assertPackageManifestMatch(candidate, readJson(flags["--manifest"]));
    const tags = readTags(flags["--tags-file"]);
    assertNoTagCollision(candidate, tags);
    const latest = selectLatestVersion(tags);
    if (!isCandidateVersionAllowed(candidate, latest)) {
      throw new RangeError(
        `Release candidate ${candidate} is not newer than latest released version ${latest}`,
      );
    }
    return "";
  }
  if (mode === "channel") {
    const flags = parseFlags(rest, ["--version", "--tag"]);
    const { distTag, prerelease } = resolveReleaseChannel(flags["--version"], flags["--tag"]);
    return `dist_tag=${distTag}\nprerelease=${String(prerelease)}\n`;
  }

  const flags = parseFlags(args, ["--candidate", "--latest"]);
  if (!isCandidateVersionAllowed(flags["--candidate"], flags["--latest"])) {
    throw new RangeError(
      `Release candidate ${flags["--candidate"]} is not newer than latest released version ${flags["--latest"]}`,
    );
  }
  return "";
}

function main() {
  try {
    process.stdout.write(run(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
