import { describe, it, expect } from "vitest";
import { SecretPatternDetector } from "../../src/core/secret-pattern-detector";

describe("SecretPatternDetector", () => {
  const detector = new SecretPatternDetector();

  it("should return empty array for benign content", () => {
    expect(detector.scan("this is a normal comment about implementation")).toEqual([]);
  });

  it("should detect api_key case-insensitively", () => {
    const results = detector.scan("ANTHROPIC_API_KEY=abc");
    expect(results).toContainEqual({ name: "api_key" });
    
    expect(detector.scan("set api-key properly")).toContainEqual({ name: "api_key" });
    expect(detector.scan("Api_Key missing")).toContainEqual({ name: "api_key" });
  });

  it("should detect password mentions with word boundaries", () => {
    expect(detector.scan("use password here")).toContainEqual({ name: "password" });
    expect(detector.scan("passwordless login")).not.toContainEqual({ name: "password" });
  });

  it("should detect standalone 'secret' and 'token' words", () => {
    expect(detector.scan("the secret is safe")).toContainEqual({ name: "secret" });
    expect(detector.scan("JWT token expired")).toContainEqual({ name: "token" });
  });

  it("should detect linux home paths (with or without trailing slash)", () => {
    expect(detector.scan("error at /home/yohi/.aws/credentials")).toContainEqual({ name: "home_path_linux" });
    expect(detector.scan("path is /home/alice")).toContainEqual({ name: "home_path_linux" });
  });

  it("should detect macos home paths (with or without trailing slash)", () => {
    expect(detector.scan("error at /Users/alice/Library/")).toContainEqual({ name: "home_path_macos" });
    expect(detector.scan("error at /Users/bob")).toContainEqual({ name: "home_path_macos" });
  });

  it("should detect anthropic API key literal shape", () => {
    expect(detector.scan("sk-ant-abcdefghijklmnopqrstuvwx")).toContainEqual({ name: "anthropic_key" });
  });

  it("should detect openai API key literal shape (including modern proj- and symbols)", () => {
    // Traditional key
    expect(detector.scan("sk-abcdefghijklmnopqrstuv")).toContainEqual({ name: "openai_key" });
    // Modern sk-proj- key
    expect(detector.scan("sk-proj-abcdefghijklmnopqrstuv")).toContainEqual({ name: "openai_key" });
    // Key with hyphens/underscores
    expect(detector.scan("sk-abcd-efgh_ijklmnopqrstuv")).toContainEqual({ name: "openai_key" });
  });

  it("should return multiple patterns when several match", () => {
    const matches = detector.scan("API_KEY=sk-ant-abcdefghijklmnopqrstuvwx stored at /home/yohi/");
    expect(matches).toContainEqual({ name: "api_key" });
    expect(matches).toContainEqual({ name: "anthropic_key" });
    expect(matches).toContainEqual({ name: "home_path_linux" });
  });
});
