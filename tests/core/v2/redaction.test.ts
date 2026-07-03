// tests/core/v2/redaction.test.ts
import { describe, expect, it } from "vitest";
import { SecretPatternDetector } from "../../../src/core/secret-pattern-detector";
import {
  redactAbsolutePaths,
  redactEnvironmentValues,
  redactForPersistence,
  redactMessageSnippet,
  redactRawOutput,
  redactTokenUrls,
} from "../../../src/core/v2/redaction";

describe("SecretPatternDetector.redact()", () => {
  it("replaces a fake OpenAI-shaped key with [REDACTED_SECRET]", () => {
    const detector = new SecretPatternDetector();
    // 21 alphanumeric chars after "sk-" — matches the openai_key pattern
    const input = "sk-abcdefghijklmnopqrstu";
    expect(detector.redact(input)).toBe("[REDACTED_SECRET]");
  });

  it("replaces a fake Anthropic-shaped key with [REDACTED_SECRET]", () => {
    const detector = new SecretPatternDetector();
    const input = "sk-ant-abcdefghijklmnopqrstu";
    expect(detector.redact(input)).toBe("[REDACTED_SECRET]");
  });

  it("does not mutate unrelated text", () => {
    const detector = new SecretPatternDetector();
    const input = "hello world";
    expect(detector.redact(input)).toBe("hello world");
  });

  it("redacts ALL occurrences of the same OpenAI-shaped key in one string", () => {
    const detector = new SecretPatternDetector();
    const input = "first sk-abcdefghijklmnopqrstu then sk-zyxwvutsrqponmlkjihg";
    expect(detector.redact(input)).toBe("first [REDACTED_SECRET] then [REDACTED_SECRET]");
  });

  it("redacts multiple linux home paths in one string", () => {
    const detector = new SecretPatternDetector();
    const input = "paths /home/alice and /home/bob here";
    expect(detector.redact(input)).toBe("paths [REDACTED_SECRET] and [REDACTED_SECRET] here");
  });
});

describe("redactAbsolutePaths()", () => {
  it("redacts a unix absolute path at the start of a string", () => {
    expect(redactAbsolutePaths("/home/user/project")).toBe("[REDACTED_PATH]");
  });

  it("redacts a unix absolute path preceded by whitespace", () => {
    expect(redactAbsolutePaths("error at /home/user/project line 1")).toBe(
      "error at [REDACTED_PATH] line 1",
    );
  });

  it("redacts a windows absolute path at the start of a string", () => {
    expect(redactAbsolutePaths("C:\\Users\\user\\project")).toBe("[REDACTED_PATH]");
  });

  it("redacts a quoted unix path", () => {
    expect(redactAbsolutePaths('"/home/user/file.txt"')).toBe('"[REDACTED_PATH]"');
  });

  it("redacts a home-directory (~/) path preceded by whitespace", () => {
    expect(redactAbsolutePaths("see ~/project/file.ts here")).toBe("see [REDACTED_PATH] here");
  });
});

describe("redactEnvironmentValues()", () => {
  it("redacts an environment variable assignment", () => {
    expect(redactEnvironmentValues("FOO_BAR=secret")).toBe("[REDACTED_ENV]");
  });

  it("redacts env var inline in text", () => {
    const result = redactEnvironmentValues("Running with API_KEY=abc123xyz now");
    expect(result).toBe("Running with [REDACTED_ENV] now");
  });

  it("does not redact lowercase names", () => {
    expect(redactEnvironmentValues("foo=bar")).toBe("foo=bar");
  });
});

describe("redactTokenUrls()", () => {
  it("redacts a token URL with userinfo credentials", () => {
    expect(redactTokenUrls("https://user:tok@host/x")).toBe("[REDACTED_TOKEN_URL]");
  });

  it("redacts http token URL in the middle of text", () => {
    const result = redactTokenUrls("clone http://token@github.com/repo.git done");
    expect(result).toBe("clone [REDACTED_TOKEN_URL] done");
  });

  it("does not touch URLs without userinfo", () => {
    expect(redactTokenUrls("https://example.com/path")).toBe("https://example.com/path");
  });
});

describe("redactForPersistence() truncation", () => {
  it("truncates output longer than 4096 chars and appends the truncation marker", () => {
    const longInput = "x".repeat(5000);
    const result = redactForPersistence(longInput);
    expect(result.endsWith("\n…[truncated]")).toBe(true);
    // slice(0,4096) of "xxxx…" is 4096 x's, then the marker
    expect(result.startsWith("x".repeat(4096))).toBe(true);
  });

  it("does not truncate output at or below 4096 chars", () => {
    const input = "y".repeat(4096);
    const result = redactForPersistence(input);
    expect(result).toBe(input);
    expect(result.includes("[truncated]")).toBe(false);
  });

  it("does not split a surrogate pair at the truncation boundary", () => {
    // Emoji "😀" (U+1F600) is a surrogate pair; place it so it straddles index 4096.
    const input = "a".repeat(4095) + "😀" + "b".repeat(10);
    const result = redactForPersistence(input);
    const marker = "\n…[truncated]";
    const body = result.slice(0, result.length - marker.length);
    const lastCode = body.charCodeAt(body.length - 1);
    // The retained text must not end with a lone high surrogate (ill-formed UTF-16).
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
    // Boundary correction drops the half-cut emoji, preserving the code-unit budget.
    expect(body).toBe("a".repeat(4095));
    expect(result.endsWith(marker)).toBe(true);
  });
});

describe("redactForPersistence() pipeline order", () => {
  it("redacts the value of a keyword-named env var (name matches a secret pattern)", () => {
    // GITHUB_TOKEN matches the `token` keyword pattern. redact() must NOT run first and
    // mask the name before redactEnvironmentValues can capture the NAME=value pair.
    const result = redactForPersistence("GITHUB_TOKEN=ghp_Abc123def456ghi789jkl012mno345");
    expect(result).toBe("[REDACTED_ENV]");
    expect(result).not.toContain("ghp_");
  });

  it("redacts the values of multiple keyword-named env vars on one line", () => {
    const result = redactForPersistence(
      "GITHUB_TOKEN=ghp_aaaaaaaaaaaa ACCESS_TOKEN=xoxb_bbbbbbbbbbbb",
    );
    expect(result).toBe("[REDACTED_ENV] [REDACTED_ENV]");
    expect(result).not.toContain("ghp_");
    expect(result).not.toContain("xoxb_");
  });

  it("still redacts a bare secret-shaped value with no NAME= structure", () => {
    const result = redactForPersistence("leaked key sk-abcdefghijklmnopqrstuvwx here");
    expect(result).toContain("[REDACTED_SECRET]");
    expect(result).not.toContain("sk-abcdefghijklmnopqrstuvwx");
  });
});

describe("redactRawOutput() / redactMessageSnippet()", () => {
  it("redactRawOutput redacts secrets and absolute paths in raw tool output", () => {
    const result = redactRawOutput("key sk-abcdefghijklmnopqrstuvwx at /home/u/f.ts");
    expect(result).toContain("[REDACTED_SECRET]");
    expect(result).toContain("[REDACTED_PATH]");
  });

  it("redactMessageSnippet redacts secret-shaped values in a snippet", () => {
    expect(redactMessageSnippet("leaked sk-abcdefghijklmnopqrstuvwx")).toContain("[REDACTED_SECRET]");
  });
});
