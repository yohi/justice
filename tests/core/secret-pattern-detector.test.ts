import { describe, it, expect } from "vitest";
import { SecretPatternDetector } from "../../src/core/secret-pattern-detector";

describe("SecretPatternDetector", () => {
  const detector = new SecretPatternDetector();

  it("should return empty array for benign content", () => {
    expect(detector.scan("this is a normal comment about implementation")).toEqual([]);
  });

  it("should detect api_key case-insensitively", () => {
    expect(detector.scan("ANTHROPIC_API_KEY=abc")).toContain("api_key");
    expect(detector.scan("set api-key properly")).toContain("api_key");
    expect(detector.scan("Api_Key missing")).toContain("api_key");
  });

  it("should detect password mentions", () => {
    expect(detector.scan("use password here")).toContain("password");
  });

  it("should detect standalone 'secret' and 'token' words", () => {
    expect(detector.scan("the secret is safe")).toContain("secret");
    expect(detector.scan("JWT token expired")).toContain("token");
  });

  it("should detect linux home paths", () => {
    expect(detector.scan("error at /home/yohi/.aws/credentials")).toContain("home_path_linux");
  });

  it("should detect macos home paths", () => {
    expect(detector.scan("error at /Users/alice/Library/")).toContain("home_path_macos");
  });

  it("should detect anthropic API key literal shape", () => {
    expect(detector.scan("sk-ant-abcdefghijklmnopqrstuvwx")).toContain("anthropic_key");
  });

  it("should detect openai API key literal shape", () => {
    expect(detector.scan("sk-abcdefghijklmnopqrstuv")).toContain("openai_key");
  });

  it("should return multiple patterns when several match", () => {
    const matches = detector.scan("API_KEY=sk-ant-abcdefghijklmnopqrstuvwx stored at /home/yohi/");
    expect(matches).toContain("api_key");
    expect(matches).toContain("anthropic_key");
    expect(matches).toContain("home_path_linux");
  });
});