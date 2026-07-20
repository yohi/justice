import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { describe, expect, it } from "vitest";

const OPENCODE_IMPORT_PATTERN =
  /(?:\bimport\b[\s\S]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\bexport\b[\s\S]*?\bfrom\s*)["']@opencode-ai\//;

/* eslint-disable security/detect-object-injection */
function stripComments(content: string): string {
  let result = "";
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") {
        i++;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < content.length - 1 && !(content[i] === "*" && content[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      result += ch;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === "\\" && i + 1 < content.length) {
          result += content[i];
          i++;
          result += content[i];
          i++;
        } else {
          result += content[i];
          i++;
        }
      }
      if (i < content.length) {
        result += content[i];
        i++;
      }
      continue;
    }

    result += ch;
    i++;
  }
  return result;
}
/* eslint-enable security/detect-object-injection */

describe("FF-001", () => {
  it("src/core does not import @opencode-ai/*", () => {
    const files = globSync("src/core/**/*.ts", {
      ignore: ["**/*.test.ts"],
    });

    expect(files.length).toBeGreaterThan(0);

    // Strip comments first so a doc comment mentioning "@opencode-ai/*" in prose
    // never trips a false positive, then match the whole (comment-stripped)
    // file content rather than per-line so a multi-line import body (e.g.
    // `import {\n  X,\n} from "@opencode-ai/plugin";`) is still detected.
    for (const file of files) {
      // The file list comes from the architecture test's source glob.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = readFileSync(file, "utf-8");
      const importsOpenCode = OPENCODE_IMPORT_PATTERN.test(stripComments(content));
      expect(importsOpenCode).toBe(false);
    }
  });

  it("detects opencode imports across boundary-case fixtures (regression)", () => {
    const positives = [
      // single-line static import
      'import { Foo } from "@opencode-ai/plugin";',
      // multi-line static import (the original false negative)
      'import {\n  Foo,\n  Bar,\n} from "@opencode-ai/plugin";',
      // side-effect import
      'import "@opencode-ai/plugin";',
      // single-line dynamic import
      'const x = await import("@opencode-ai/plugin");',
      // multi-line dynamic import
      'const x = await import(\n  "@opencode-ai/plugin"\n);',
      // re-export named members
      'export { Foo } from "@opencode-ai/plugin";',
      // re-export all
      'export * from "@opencode-ai/plugin";',
      // re-export type
      'export type { FooType } from "@opencode-ai/plugin";',
      // multi-line re-export
      'export {\n  Foo,\n  Bar,\n} from "@opencode-ai/plugin";',
      // double-quoted string containing // on the same line must not hide the import
      'import { Foo } from "@opencode-ai/plugin" + "http://ignored.com";',
      // single-quoted string containing //
      "import { Foo } from '@opencode-ai/plugin' + 'http://ignored.com';",
    ];
    for (const fixture of positives) {
      expect(OPENCODE_IMPORT_PATTERN.test(stripComments(fixture))).toBe(true);
    }

    const negatives = [
      // prose comment mentioning the package name must not trip the check
      '// See @opencode-ai/plugin docs for the Plugin type.\nexport const x = 1;',
      '/* uses @opencode-ai/plugin under the hood */\nexport const y = 2;',
      // unrelated import
      'import { Foo } from "./local-module";',
    ];
    for (const fixture of negatives) {
      expect(OPENCODE_IMPORT_PATTERN.test(stripComments(fixture))).toBe(false);
    }
  });
});
