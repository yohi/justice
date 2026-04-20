export interface SecretMatch {
  readonly name: string;
}

const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = Object.freeze([
  { name: "api_key", pattern: /(?:\b|_)api[-_]?key(?=\b|_|$)/i },
  { name: "password", pattern: /\b(?:db|db_|admin_|root_)?password\b/i },
  { name: "secret", pattern: /\b(?:client_secret|secret[_-]?key)\b/i },
  { name: "token", pattern: /\b(?:bearer_token|access_token|refresh_token|github_token)\b/i },
  { name: "home_path_linux", pattern: /\/home\/[^/\s]+\/?/ },
  { name: "home_path_macos", pattern: /\/Users\/[^/\s]+\/?/ },
  { name: "home_path_windows", pattern: /[a-zA-Z]:\\Users\\[^\\\s]+\\?/ },
  { name: "openai_key", pattern: /\bsk-(?!ant-)(?:proj-)?[a-zA-Z0-9_-]{20,}\b/ },
  { name: "anthropic_key", pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/ },
]);

export class SecretPatternDetector {
  scan(content: string): SecretMatch[] {
    return SECRET_PATTERNS
      .filter(({ pattern }) => pattern.test(content))
      .map(({ name }) => ({ name }));
  }
}
