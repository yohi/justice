export interface SecretMatch {
  readonly name: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = Object.freeze([
  { name: "api_key", pattern: /api[-_]?key/i },
  { name: "password", pattern: /\bpassword\b/i },
  { name: "secret", pattern: /\bsecret\b/i },
  { name: "token", pattern: /\btoken\b/i },
  { name: "home_path_linux", pattern: /\/home\/[^/\s]+\/?/ },
  { name: "home_path_macos", pattern: /\/Users\/[^/\s]+\/?/ },
  { name: "openai_key", pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,}/ },
  { name: "anthropic_key", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/ },
]);

export class SecretPatternDetector {
  scan(content: string): SecretMatch[] {
    return SECRET_PATTERNS
      .filter(({ pattern }) => pattern.test(content))
      .map(({ name }) => ({ name }));
  }
}
