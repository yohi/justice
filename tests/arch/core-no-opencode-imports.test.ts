import { readFileSync } from "node:fs";
import { globSync } from "glob";
import { describe, expect, it } from "vitest";

const OPENCODE_MODULE_PREFIX = "@opencode-ai/";

/* eslint-disable security/detect-object-injection */

/**
 * Scans TypeScript source text and reports whether it contains any real import,
 * re-export, or dynamic import that targets an `@opencode-ai/*` module.
 *
 * The scanner skips comments, string literals, and template literals so that
 * prose or code inside strings (e.g. `const s = 'import { Foo } from "@opencode-ai/plugin"';`)
 * never triggers false positives. Only actual import/export/dynamic-import syntax
 * is inspected.
 */
function detectOpenCodeImports(content: string): boolean {
  const len = content.length;
  let i = 0;

  const isIdentifierStart = (c: string): boolean => /[a-zA-Z_$]/.test(c);
  const isIdentifierPart = (c: string): boolean => /[a-zA-Z0-9_$]/.test(c);

  const skipWhitespace = (): void => {
    while (i < len && /\s/.test(content[i])) {
      i++;
    }
  };

  const readStringLiteral = (quote: string): void => {
    i++; // skip opening quote
    while (i < len && content[i] !== quote) {
      if (content[i] === "\\" && i + 1 < len) {
        i += 2;
      } else {
        i++;
      }
    }
    if (i < len) {
      i++; // skip closing quote
    }
  };

  const readTemplateLiteral = (): void => {
    i++; // skip backtick
    while (i < len && content[i] !== "`") {
      if (content[i] === "\\" && i + 1 < len) {
        i += 2;
      } else if (content[i] === "$" && content[i + 1] === "{") {
        // Skip the embedded expression, including nested braces/strings/templates.
        let braceDepth = 1;
        i += 2;
        while (i < len && braceDepth > 0) {
          if (content[i] === "{") {
            braceDepth++;
          } else if (content[i] === "}") {
            braceDepth--;
          } else if (content[i] === '"' || content[i] === "'" || content[i] === "`") {
            if (content[i] === "`") {
              readTemplateLiteral();
            } else {
              readStringLiteral(content[i]);
            }
            continue;
          }
          i++;
        }
      } else {
        i++;
      }
    }
    if (i < len) {
      i++; // skip closing backtick
    }
  };

  const readLineComment = (): void => {
    while (i < len && content[i] !== "\n") {
      i++;
    }
  };

  const readBlockComment = (): void => {
    i += 2; // skip /*
    while (i < len - 1 && !(content[i] === "*" && content[i + 1] === "/")) {
      i++;
    }
    if (i < len) {
      i += 2; // skip */
    }
  };

  const readIdentifier = (): string => {
    let id = "";
    while (i < len && isIdentifierPart(content[i])) {
      id += content[i];
      i++;
    }
    return id;
  };

  const readUntilModuleSpecifier = (): string | undefined => {
    // Reads the body of an import/export declaration. We are called immediately
    // after the opening keyword and want to find the module specifier string that
    // follows the `from` keyword. Only string literals appearing after a top-level
    // `from` (braceDepth === 0 && parenDepth === 0) are valid module specifiers.
    let braceDepth = 0;
    let parenDepth = 0;
    let sawFrom = false;

    while (i < len) {
      const ch = content[i];

      if (ch === ";" && braceDepth === 0 && parenDepth === 0) {
        return undefined;
      }
      if (ch === "{" && (parenDepth === 0 || braceDepth > 0)) {
        braceDepth++;
        i++;
        continue;
      }
      if (ch === "}" && braceDepth > 0) {
        braceDepth--;
        i++;
        continue;
      }
      if (ch === "(" && braceDepth === 0) {
        parenDepth++;
        i++;
        continue;
      }
      if (ch === ")" && parenDepth > 0) {
        parenDepth--;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        // Module specifier must be a non-template string in valid import/export.
        if (ch === "`") {
          readTemplateLiteral();
          continue;
        }
        const start = i + 1;
        readStringLiteral(ch);
        if (sawFrom && braceDepth === 0 && parenDepth === 0) {
          const source = content.slice(start, i - 1);
          return source;
        }
        // Otherwise it is just a string literal in the declaration body;
        // keep scanning for the real module specifier after `from`.
        continue;
      }
      if (isIdentifierStart(ch)) {
        const id = readIdentifier();
        if (!sawFrom && id === "from" && braceDepth === 0 && parenDepth === 0) {
          sawFrom = true;
        }
        continue;
      }
      i++;
    }
    return undefined;
  };

  while (i < len) {
    skipWhitespace();
    if (i >= len) break;

    const ch = content[i];

    // Comments
    if (ch === "/" && content[i + 1] === "/") {
      readLineComment();
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      readBlockComment();
      continue;
    }

    // String / template literals
    if (ch === '"' || ch === "'") {
      readStringLiteral(ch);
      continue;
    }
    if (ch === "`") {
      readTemplateLiteral();
      continue;
    }

    // Detect actual import / export keywords
    if (isIdentifierStart(ch)) {
      const id = readIdentifier();

      if (id === "import") {
        skipWhitespace();
        if (i < len) {
          const next = content[i];
          if (next === "(") {
            // dynamic import: import("source")
            let parenDepth = 1;
            const start = i + 1;
            i++; // skip (
            while (i < len && parenDepth > 0) {
              const c = content[i];
              if (c === "(") {
                parenDepth++;
              } else if (c === ")") {
                parenDepth--;
              } else if (c === '"' || c === "'" || c === "`") {
                if (c === "`") {
                  readTemplateLiteral();
                } else {
                  readStringLiteral(c);
                }
                continue;
              }
              i++;
            }

            // Extract a plain string source from the interior of import(...).
            // We scan the region between the parentheses for the first string literal.
            const interior = content.slice(start, i - 1).trim();
            const stringMatch = /^\s*(["'])([^"']+)\1/.exec(interior);
            if (stringMatch && stringMatch[2].startsWith(OPENCODE_MODULE_PREFIX)) {
              return true;
            }
          } else if (next === '"' || next === "'") {
            // side-effect import: import "source";
            const start = i + 1;
            readStringLiteral(next);
            const source = content.slice(start, i - 1);
            if (source.startsWith(OPENCODE_MODULE_PREFIX)) {
              return true;
            }
          } else {
            // static import with optional `from` clause
            const source = readUntilModuleSpecifier();
            if (source?.startsWith(OPENCODE_MODULE_PREFIX)) {
              return true;
            }
          }
        }
        continue;
      }

      if (id === "export") {
        const source = readUntilModuleSpecifier();
        if (source?.startsWith(OPENCODE_MODULE_PREFIX)) {
          return true;
        }
        continue;
      }

      continue;
    }

    i++;
  }

  return false;
}
/* eslint-enable security/detect-object-injection */

describe("FF-001", () => {
  it("src/core does not import @opencode-ai/*", () => {
    const files = globSync("src/core/**/*.ts", {
      ignore: ["**/*.test.ts"],
    });

    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      // The file list comes from the architecture test's source glob.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = readFileSync(file, "utf-8");
      const importsOpenCode = detectOpenCodeImports(content);
      if (importsOpenCode) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
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
    ];
    for (const fixture of positives) {
      expect(detectOpenCodeImports(fixture)).toBe(true);
    }

    const negatives = [
      // prose comment mentioning the package name must not trip the check
      "// See @opencode-ai/plugin docs for the Plugin type.\nexport const x = 1;",
      "/* uses @opencode-ai/plugin under the hood */\nexport const y = 2;",
      // unrelated import
      'import { Foo } from "./local-module";',
      // real import followed by a string containing an unrelated pseudo import
      'import { Foo } from "./local";\nconst s = "import { Bar } from \'@opencode-ai/plugin\'";',
      // pseudo import inside a single-quoted string literal must be ignored
      "const example = 'import { Foo } from \"@opencode-ai/plugin\";';",
      // pseudo re-export inside a double-quoted string literal must be ignored
      "const example = \"export { Foo } from '@opencode-ai/plugin';\";",
      // pseudo dynamic import inside a template literal must be ignored
      'const example = `import("@opencode-ai/plugin")`;',
      // value export containing the prefix must not be treated as a module specifier
      'export const OPENCODE_PREFIX = "@opencode-ai/plugin";',
      // string inside a class body must not be treated as a re-export specifier
      'export default class Foo { static MODULE = "@opencode-ai/plugin"; }',
      // template literal with embedded expression containing pseudo import
      'const example = `${"import(\\"@opencode-ai/plugin\\")"}`;\nexport const y = 2;',
    ];
    for (const fixture of negatives) {
      expect(detectOpenCodeImports(fixture)).toBe(false);
    }
  });
});
