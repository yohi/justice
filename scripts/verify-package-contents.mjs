import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const REQUIRED_PACKAGE_FILES = Object.freeze([
  "dist/native/index.linux-x64-gnu.node",
  "dist/opencode-plugin.js",
  "dist/opencode-v2-plugin.js",
  "dist/opencode-v2-server.d.ts",
]);

export const REQUIRED_EXPORTS = Object.freeze([".", "./opencode", "./server", "./core", "./runtime"]);

function exportTargets(entry) {
  if (typeof entry === "string") return [entry];
  if (entry === null || typeof entry !== "object") return [];
  return Object.values(entry).flatMap(exportTargets);
}

/** Returns a list of problems; empty when the packed file list satisfies the release contract. */
export function findPackageProblems(packedPaths, packageJson) {
  const present = new Set(packedPaths);
  const problems = [];
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!present.has(required)) problems.push(`Missing from package: ${required}`);
  }
  const exportsMap = packageJson.exports ?? {};
  for (const key of REQUIRED_EXPORTS) {
    const entry = exportsMap[key];
    if (entry === undefined) {
      problems.push(`Missing export: ${key}`);
      continue;
    }
    for (const target of exportTargets(entry)) {
      if (!present.has(target.replace(/^\.\//, ""))) {
        problems.push(`Export ${key} target missing from package: ${target}`);
      }
    }
  }
  return problems;
}

function main() {
  // usage: verify-package-contents.mjs <npm-pack-json-file> [package.json]
  try {
    const [packFile, packagePath = "package.json"] = process.argv.slice(2);
    if (packFile === undefined) throw new TypeError("Usage: verify-package-contents.mjs <npm-pack-json> [package.json]");
    const packed = JSON.parse(readFileSync(packFile, "utf8"));
    const files = packed?.[0]?.files;
    if (!Array.isArray(files)) throw new TypeError("npm pack JSON has no files list");
    const problems = findPackageProblems(
      files.map((file) => file.path),
      JSON.parse(readFileSync(packagePath, "utf8")),
    );
    if (problems.length > 0) throw new Error(problems.join("\n"));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
