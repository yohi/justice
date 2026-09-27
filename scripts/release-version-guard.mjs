import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) {
    throw new RangeError(`Invalid stable version: ${version}`);
  }

  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) {
    throw new RangeError(`Version component exceeds the safe integer range: ${version}`);
  }
  return parts;
}

export function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function isCandidateVersionAllowed(candidate, latest) {
  return compareVersions(candidate, latest) >= 0;
}

function parseArguments(args) {
  if (
    args.length !== 4 ||
    args[0] !== "--candidate" ||
    args[2] !== "--latest" ||
    args[1].length === 0 ||
    args[3].length === 0
  ) {
    throw new TypeError("Usage: release-version-guard.mjs --candidate <version> --latest <version>");
  }
  return { candidate: args[1], latest: args[3] };
}

function main() {
  try {
    const { candidate, latest } = parseArguments(process.argv.slice(2));
    if (!isCandidateVersionAllowed(candidate, latest)) {
      throw new RangeError(`Release candidate ${candidate} is lower than latest released version ${latest}`);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
