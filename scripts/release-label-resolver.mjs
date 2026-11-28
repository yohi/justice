import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  assertNoTagCollision,
  compareVersions,
  isCandidateVersionAllowed,
  parseSemVer,
  selectLatestVersion,
} from "./release-version-guard.mjs";

const LABEL_PREFIX = "release: ";
const BUMPS = ["major", "minor", "patch"];
const CHANNELS = ["alpha", "beta", "rc", "stable"];
const EXPLICIT = /^version=((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/;

/** Parses `release: ...` labels. Returns null when none are present; throws on any conflict. */
export function parseReleaseLabels(labels) {
  const release = labels.filter((name) => typeof name === "string" && name.startsWith("release:"));
  if (release.length === 0) return null;

  const bumps = [];
  const channels = [];
  const explicit = [];
  for (const name of release) {
    if (!name.startsWith(LABEL_PREFIX)) throw new RangeError(`Malformed release label: ${name}`);
    const value = name.slice(LABEL_PREFIX.length);
    if (BUMPS.includes(value)) bumps.push(value);
    else if (CHANNELS.includes(value)) channels.push(value);
    else if (EXPLICIT.test(value)) explicit.push(EXPLICIT.exec(value)[1]);
    else throw new RangeError(`Unknown release label: ${name}`);
  }
  if (bumps.length > 1) throw new RangeError("Conflicting release labels: more than one bump label");
  if (channels.length > 1) throw new RangeError("Conflicting release labels: more than one channel label");
  if (explicit.length > 1) throw new RangeError("Conflicting release labels: more than one version label");
  if (explicit.length === 1 && bumps.length === 1) {
    throw new RangeError("Conflicting release labels: explicit version excludes major/minor/patch");
  }
  if (channels.length === 0) throw new RangeError("A channel label (alpha/beta/rc/stable) is required");
  return { bump: bumps[0] ?? null, channel: channels[0], explicitVersion: explicit[0] ?? null };
}

function coreOf(version) {
  return parseSemVer(version).core;
}

function coreString(core) {
  return core.join(".");
}

function bumpCore(core, bump) {
  const [major, minor, patch] = core;
  if (bump === "major") return [major + 1, 0, 0];
  if (bump === "minor") return [major, minor + 1, 0];
  return [major, minor, patch + 1];
}

/** Next `<core>-<channel>.N` where N follows the highest published tag of that series. */
function nextPrerelease(core, channel, versions) {
  const prefix = `${coreString(core)}-${channel}.`;
  let highest = 0;
  for (const version of versions) {
    if (!version.startsWith(prefix)) continue;
    const rest = version.slice(prefix.length);
    if (/^(0|[1-9][0-9]*)$/.test(rest)) highest = Math.max(highest, Number(rest));
  }
  return `${prefix}${highest + 1}`;
}

function releaseVersions(tags) {
  return tags
    .filter((tag) => tag.startsWith("v"))
    .map((tag) => tag.slice(1))
    .filter((version) => {
      try {
        parseSemVer(version);
        return true;
      } catch {
        return false;
      }
    });
}

/**
 * Resolves the next release version from published tags and a label selection.
 * Pure and idempotent: unpublished candidates never influence the result.
 */
export function resolveTargetVersion(tags, selection) {
  const versions = releaseVersions(tags);
  const latest = selectLatestVersion(tags);
  const stables = versions.filter((version) => parseSemVer(version).pre.length === 0);
  const latestStable = stables.length === 0 ? null : stables.reduce((a, b) => (compareVersions(b, a) > 0 ? b : a));
  const { bump, channel, explicitVersion } = selection;

  let core;
  if (explicitVersion !== null) {
    core = coreOf(explicitVersion);
  } else if (bump !== null) {
    core = bumpCore(latestStable === null ? [0, 0, 0] : coreOf(latestStable), bump);
  } else {
    // Continue or promote an active prerelease series; never guess between series.
    const baseline = latestStable === null ? null : coreString(coreOf(latestStable));
    const activeCores = new Set();
    for (const version of versions) {
      const parsed = parseSemVer(version);
      if (parsed.pre.length === 0) continue;
      if (latestStable !== null && compareVersions(coreString(parsed.core), latestStable) <= 0) continue;
      activeCores.add(coreString(parsed.core));
    }
    if (activeCores.size === 0) {
      throw new RangeError(
        `No active prerelease series after ${baseline ?? "the first release"}: add a major/minor/patch or version=X.Y.Z label`,
      );
    }
    if (activeCores.size > 1) {
      throw new RangeError(
        `Ambiguous prerelease series (${[...activeCores].sort().join(", ")}): specify release: version=X.Y.Z`,
      );
    }
    core = coreOf(`${[...activeCores][0]}`);
  }

  const candidate = channel === "stable" ? coreString(core) : nextPrerelease(core, channel, versions);
  assertNoTagCollision(candidate, tags);
  if (!isCandidateVersionAllowed(candidate, latest)) {
    throw new RangeError(`Resolved version ${candidate} is not newer than latest released version ${latest}`);
  }
  return candidate;
}

/**
 * Every release label must have been applied by an actor with write access.
 * `events`: [{label, actor}] in chronological order; `permissions`: {login: permission}.
 */
export function assertLabelsAuthorized(labels, events, permissions) {
  for (const name of labels.filter((label) => label.startsWith("release:"))) {
    const applied = events.filter((event) => event.label === name);
    const last = applied[applied.length - 1];
    if (last === undefined || typeof last.actor !== "string") {
      throw new RangeError(`Release label has no attributable actor: ${name}`);
    }
    const permission = permissions[last.actor];
    if (permission !== "admin" && permission !== "write" && permission !== "maintain") {
      throw new RangeError(`Release label applied without write permission: ${name}`);
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseFlags(args, required, optional) {
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (![...required, ...optional].includes(name) || value === undefined || name in flags) {
      throw new TypeError(`Unexpected or incomplete argument: ${String(name)}`);
    }
    flags[name] = value;
  }
  for (const name of required) if (!(name in flags)) throw new TypeError(`Missing required argument: ${name}`);
  return flags;
}

/** Prints `release_as=<version>` or an empty value when no release label is selected. */
function run(args) {
  const [mode, ...rest] = args;
  if (mode !== "resolve") throw new TypeError("Usage: release-label-resolver.mjs resolve --tags-file F --labels-file F [--events-file F --permissions-file F]");
  const flags = parseFlags(rest, ["--tags-file", "--labels-file"], ["--events-file", "--permissions-file"]);
  const labels = readJson(flags["--labels-file"]);
  if (!Array.isArray(labels) || !labels.every((label) => typeof label === "string")) {
    throw new TypeError("labels file must be a JSON array of strings");
  }
  const selection = parseReleaseLabels(labels);
  if (selection === null) return "release_as=\n";
  if (!("--events-file" in flags) || !("--permissions-file" in flags)) {
    throw new TypeError("--events-file and --permissions-file are required when release labels are present");
  }
  assertLabelsAuthorized(labels, readJson(flags["--events-file"]), readJson(flags["--permissions-file"]));
  const tags = readFileSync(flags["--tags-file"], "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  return `release_as=${resolveTargetVersion(tags, selection)}\n`;
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
