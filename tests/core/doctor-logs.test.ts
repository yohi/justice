// tests/core/doctor-logs.test.ts
import { describe, expect, it } from "vitest";
import { scanOpenCodeLogText } from "../../src/core/doctor-logs";

describe("scanOpenCodeLogText()", () => {
  it("counts and captures load failures and initialization lines", () => {
    const text = [
      `level=INFO message="starting"`,
      `level=ERROR message="failed to load plugin" path=@yohi/justice@2.7.0 error="Plugin export is not a function"`,
      `level=ERROR message="failed to load plugin" path=@yohi/justice@2.7.0 error="Plugin export is not a function"`,
      `level=INFO service=justice message="Justice initialized via opencode-adapter"`,
    ].join("\n");
    const result = scanOpenCodeLogText(text);
    expect(result.failedToLoadPluginCount).toBe(2);
    expect(result.lastFailedToLoadPlugin).toContain("@yohi/justice@2.7.0");
    expect(result.justiceInitializedCount).toBe(1);
    expect(result.lastJusticeInitialized).toContain("Justice initialized via opencode-adapter");
  });

  it("returns zeros and undefined for a clean log", () => {
    const result = scanOpenCodeLogText(`level=INFO message="ok"`);
    expect(result.failedToLoadPluginCount).toBe(0);
    expect(result.justiceInitializedCount).toBe(0);
    expect(result.lastFailedToLoadPlugin).toBeUndefined();
    expect(result.lastJusticeInitialized).toBeUndefined();
  });

  it("ignores load failures of unrelated plugins", () => {
    const result = scanOpenCodeLogText(
      `level=ERROR message="failed to load plugin" path=other-plugin error="boom"`,
    );
    expect(result.failedToLoadPluginCount).toBe(0);
  });

  it("ignores load failures when the error text contains 'justice' but path is unrelated", () => {
    const result = scanOpenCodeLogText(
      `level=ERROR message="failed to load plugin" path=other-plugin error="justice is not defined"`,
    );
    expect(result.failedToLoadPluginCount).toBe(0);
  });
  it("ignores load failures when the path contains 'justice' as a substring but is not a justice specifier", () => {
    const result = scanOpenCodeLogText(
      `level=ERROR message="failed to load plugin" path=some-other-justice-tool@1.0 error="boom"`,
    );
    expect(result.failedToLoadPluginCount).toBe(0);
  });

  it("counts load failures for absolute paths whose basename is named 'justice' or 'justice-*'", () => {
    const result = scanOpenCodeLogText(
      `level=ERROR message="failed to load plugin" path=/srv/justice-monitor error="boom"`,
    );
    expect(result.failedToLoadPluginCount).toBe(1);
  });

  it("ignores load failures when path= is missing", () => {
    const result = scanOpenCodeLogText(
      `level=ERROR message="failed to load plugin" error="justice module failed"`,
    );
    expect(result.failedToLoadPluginCount).toBe(0);
  });
});
