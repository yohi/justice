import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "bun:test";
import { findPackageProblems, REQUIRED_PACKAGE_FILES } from "../../scripts/verify-package-contents.mjs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const complete = [
  ...REQUIRED_PACKAGE_FILES,
  "dist/index.js",
  "dist/index.d.ts",
  "dist/opencode-plugin.d.ts",
  "dist/runtime/node-file-system.js",
  "dist/runtime/node-file-system.d.ts",
];

test("accepts a package that has native addon, V1 and V2 artifacts and all export targets", () => {
  assert.deepEqual(findPackageProblems(complete, packageJson), []);
});

test("rejects a package missing the native addon", () => {
  const problems = findPackageProblems(
    complete.filter((path) => path !== "dist/native/index.linux-x64-gnu.node"),
    packageJson,
  );
  assert.match(problems.join("\n"), /index\.linux-x64-gnu\.node/);
});

test("rejects a package missing V2 plugin or server types", () => {
  const problems = findPackageProblems(
    complete.filter((path) => !path.startsWith("dist/opencode-v2")),
    packageJson,
  );
  assert.match(problems.join("\n"), /opencode-v2-plugin\.js/);
  assert.match(problems.join("\n"), /opencode-v2-server\.d\.ts/);
});

test("rejects a package.json that drops a required export", () => {
  const rest = { ...packageJson.exports };
  delete rest["./server"];
  const problems = findPackageProblems(complete, { exports: rest });
  assert.match(problems.join("\n"), /Missing export: \.\/server/);
});

test("checks nested conditional export targets and array targets", () => {
  const nested = {
    exports: {
      ".": { import: { types: "./dist/missing-nested.d.ts", default: "./dist/opencode-plugin.js" } },
      "./opencode": [{ import: "./dist/missing-array.js" }],
      "./server": "./dist/opencode-v2-plugin.js",
      "./core": "./dist/index.js",
      "./runtime": "./dist/runtime/node-file-system.js",
    },
  };
  const problems = findPackageProblems(complete, nested).join("\n");
  assert.match(problems, /missing-nested\.d\.ts/);
  assert.match(problems, /missing-array\.js/);
  assert.doesNotMatch(problems, /opencode-plugin\.js/);
});
