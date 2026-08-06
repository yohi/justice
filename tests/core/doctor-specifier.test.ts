// tests/core/doctor-specifier.test.ts
import { describe, expect, it } from "vitest";
import { createMockFileReader } from "../helpers/mock-file-system";
import { normalizeSpecifier, resolveSpecifier } from "../../src/core/doctor-specifier";

const CACHE = "/cache/opencode";
const PKG_270 = `${CACHE}/packages/@yohi/justice@2.7.0/node_modules/@yohi/justice`;
const PKG_300 = `${CACHE}/packages/@yohi/justice@3.0.0/node_modules/@yohi/justice`;

const cacheFixture: Record<string, string> = {
  [`${PKG_270}/package.json`]: JSON.stringify({
    name: "@yohi/justice",
    version: "2.7.0",
    exports: { ".": { import: "./dist/index.js" } },
  }),
  [`${PKG_270}/dist/index.js`]: "// barrel",
  [`${PKG_300}/package.json`]: JSON.stringify({
    name: "@yohi/justice",
    version: "3.0.0",
    exports: {
      ".": { import: "./dist/opencode-plugin.js" },
      "./opencode": { import: "./dist/opencode-plugin.js" },
      "./core": { import: "./dist/index.js" },
    },
  }),
  [`${PKG_300}/dist/opencode-plugin.js`]: "// plugin",
  [`${PKG_300}/dist/index.js`]: "// barrel",
};

describe("normalizeSpecifier()", () => {
  it.each([
    ["@yohi/justice", { kind: "package", name: "@yohi/justice" }],
    ["@yohi/justice@2.7.0", { kind: "package", name: "@yohi/justice", version: "2.7.0" }],
    ["@yohi/justice/opencode", { kind: "package", name: "@yohi/justice", subpath: "./opencode" }],
    [
      "@yohi/justice@3.0.0/opencode",
      { kind: "package", name: "@yohi/justice", version: "3.0.0", subpath: "./opencode" },
    ],
    [
      "/abs/justice/dist/opencode-plugin.js",
      { kind: "absolute-path", path: "/abs/justice/dist/opencode-plugin.js" },
    ],
  ])("parses %s", (input, expected) => {
    expect(normalizeSpecifier(input)).toEqual(expected);
  });

  it.each([
    ["justice", { kind: "package", name: "justice" }],
    ["justice@1.0.0", { kind: "package", name: "justice", version: "1.0.0" }],
    ["justice/core", { kind: "package", name: "justice", subpath: "./core" }],
    ["@", { kind: "package", name: "@" }],
  ])("parses plain and unparseable specifiers: %s", (input, expected) => {
    expect(normalizeSpecifier(input)).toEqual(expected);
  });
});

describe("resolveSpecifier()", () => {
  it("resolves a versioned specifier to the exact cached version", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice@2.7.0"), {
      fileReader: createMockFileReader(cacheFixture),
      cacheRoot: CACHE,
    });
    expect(result).toEqual({
      ok: true,
      entry: { packageDir: PKG_270, version: "2.7.0", entryFile: `${PKG_270}/dist/index.js` },
    });
  });

  it("resolves a subpath export of the selected version", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice@3.0.0/opencode"), {
      fileReader: createMockFileReader(cacheFixture),
      cacheRoot: CACHE,
    });
    expect(result.ok && result.entry.entryFile).toBe(`${PKG_300}/dist/opencode-plugin.js`);
  });

  it("reports ambiguous_versions for a versionless specifier with multiple candidates", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice"), {
      fileReader: createMockFileReader(cacheFixture),
      cacheRoot: CACHE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("ambiguous_versions");
      expect(result.candidates).toEqual(["2.7.0", "3.0.0"]);
    }
  });

  it("reports version_not_found when the exact version is not cached", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice@9.9.9"), {
      fileReader: createMockFileReader(cacheFixture),
      cacheRoot: CACHE,
    });
    expect(!result.ok && result.code).toBe("version_not_found");
  });

  it("reports cache_not_found when no version is cached at all", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice"), {
      fileReader: createMockFileReader({}),
      cacheRoot: CACHE,
    });
    expect(!result.ok && result.code).toBe("cache_not_found");
  });

  it("resolves an absolute path without going through exports", async () => {
    const path = "/abs/justice/dist/opencode-plugin.js";
    const result = await resolveSpecifier(normalizeSpecifier(path), {
      fileReader: createMockFileReader({ [path]: "//" }),
      cacheRoot: CACHE,
    });
    expect(result).toEqual({ ok: true, entry: { entryFile: path } });
  });

  it("honors the FileReader contract: absolute prefix and no extension filter", async () => {
    // The core resolver relies on a non-sandboxing FileReader: absolute cacheRoot prefix,
    // and listFiles must return every matching file (not only .jsonl). NodeFileSystem is not
    // used here; the real CLI will provide createCliFileReader (Task 7).
    const fixture: Record<string, string> = {
      [`${CACHE}/packages/@yohi/justice@1.0.0/node_modules/@yohi/justice/package.json`]:
        JSON.stringify({
          name: "@yohi/justice",
          version: "1.0.0",
          exports: { ".": { import: "./dist/index.js" } },
        }),
      [`${CACHE}/packages/@yohi/justice@1.0.0/node_modules/@yohi/justice/dist/index.js`]: "//",
      // A non-.jsonl file under the prefix must still be returned by listFiles so the
      // candidate version extraction works. This guards against sandboxing readers that
      // filter by extension.
      [`${CACHE}/packages/@yohi/justice@1.0.0/node_modules/@yohi/justice/README.md`]: "# doc",
    };
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice@1.0.0"), {
      fileReader: createMockFileReader(fixture),
      cacheRoot: CACHE,
    });
    expect(result).toEqual({
      ok: true,
      entry: {
        packageDir: `${CACHE}/packages/@yohi/justice@1.0.0/node_modules/@yohi/justice`,
        version: "1.0.0",
        entryFile: `${CACHE}/packages/@yohi/justice@1.0.0/node_modules/@yohi/justice/dist/index.js`,
      },
    });
  });

  it("reports entry_file_missing for a missing absolute path", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("/abs/missing.js"), {
      fileReader: createMockFileReader({}),
      cacheRoot: CACHE,
    });
    expect(!result.ok && result.code).toBe("entry_file_missing");
  });

  it("reports entry_file_missing for a missing absolute path with empty mock", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("/abs/missing.js"), {
      fileReader: createMockFileReader({}),
      cacheRoot: CACHE,
    });
    expect(!result.ok && result.code).toBe("entry_file_missing");
  });

  it("resolves a versionless specifier when only one version is cached", async () => {
    const singleVersionFixture: Record<string, string> = {
      [`${PKG_300}/package.json`]: JSON.stringify({
        name: "@yohi/justice",
        version: "3.0.0",
        exports: { ".": { import: "./dist/opencode-plugin.js" } },
      }),
      [`${PKG_300}/dist/opencode-plugin.js`]: "// plugin",
    };
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice"), {
      fileReader: createMockFileReader(singleVersionFixture),
      cacheRoot: CACHE,
    });
    expect(result).toEqual({
      ok: true,
      entry: {
        packageDir: PKG_300,
        version: "3.0.0",
        entryFile: `${PKG_300}/dist/opencode-plugin.js`,
      },
    });
  });

  it("reports exports_not_resolvable when package.json is missing", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice@3.0.0"), {
      fileReader: createMockFileReader({ [`${PKG_300}/dist/opencode-plugin.js`]: "// plugin" }),
      cacheRoot: CACHE,
    });
    expect(!result.ok && result.code).toBe("exports_not_resolvable");
  });

  it("reports exports_not_resolvable when requested subpath is not exported", async () => {
    const result = await resolveSpecifier(normalizeSpecifier("@yohi/justice@3.0.0/missing"), {
      fileReader: createMockFileReader(cacheFixture),
      cacheRoot: CACHE,
    });
    expect(!result.ok && result.code).toBe("exports_not_resolvable");
  });
});
