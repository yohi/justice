// src/core/doctor-config.ts
//
// justice doctor の設定探索・解析（設計書 §9.1.0）の純粋関数群。
// ファイル探索は src/runtime/doctor-cli.ts の責務であり、本モジュールは
// 「設定ファイルの内容（文字列）→ specifier 抽出・診断コード」を担う。

export type ConfigSourceId =
  | "remote"
  | "global"
  | "env_config"
  | "project"
  | "dot_opencode"
  | "env_config_dir"
  | "env_config_content"
  | "managed";

/** 設計書 §9.1.0 の優先順位表。昇順（低→高）にマージし、後から読まれた高優先度側が勝つ。 */
export const SOURCE_PRIORITY: Readonly<Record<ConfigSourceId, number>> = {
  remote: 1, // 未対応（読み込めない）
  global: 2,
  env_config: 3,
  project: 4,
  dot_opencode: 5,
  env_config_dir: 6,
  env_config_content: 7, // 検出のみ
  managed: 8, // 検出のみ
};

export type JusticePluginSpecifier = {
  readonly specifier: string;
  readonly optionsPresent: boolean;
  /** allowlisted なオプションキー名のみ。値はこの層から出さない（秘密情報対策）。 */
  readonly optionKeys: readonly string[];
};

export type ConfigDiagnostic = {
  readonly code:
    | "parse_error"
    | "plugin_missing"
    | "plugin_not_array"
    | "invalid_plugin_entry"
    | "justice_not_found_in_config"
    | "unsupported_config_source";
  readonly source: ConfigSourceId;
  readonly detail?: string;
};

export type SourceScanResult = {
  readonly source: ConfigSourceId;
  readonly readable: boolean;
  readonly specifiers: readonly JusticePluginSpecifier[];
  readonly diagnostics: readonly ConfigDiagnostic[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJusticeSpecifier(specifier: string): boolean {
  if (specifier.startsWith("/")) {
    const filename = specifier.split("/").pop() || "";
    return filename === "justice" || filename.startsWith("justice-") || filename.startsWith("opencode-plugin");
  }
  // Package specifier: extract base package name without version and subpath.
  const withoutVersion = specifier.replace(/@[^/]+$/, "");
  const parts = withoutVersion.split("/");
  const baseName =
    parts.length >= 2 && parts[0]!.startsWith("@") ? parts[1]! : parts[0]!;
  return baseName === "justice" || baseName.startsWith("justice-");
}

/** 文字列リテラル内を壊さないよう、文字列を認識してコメントと末尾カンマを除去する。 */
function cleanJsonc(content: string): { ok: true; content: string } | { ok: false; error: string } {
  let out = "";
  let inString = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    const next = content[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && next !== undefined) {
        out += next;
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      let closed = false;
      while (i < content.length) {
        if (content[i] === "*" && content[i + 1] === "/") {
          closed = true;
          i += 1;
          break;
        }
        i++;
      }
      if (!closed) {
        return { ok: false, error: "Unterminated block comment" };
      }
      continue;
    }
    out += ch;
  }

  let finalOut = "";
  inString = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i]!;
    const next = out[i + 1];
    if (inString) {
      finalOut += ch;
      if (ch === "\\" && next !== undefined) {
        finalOut += next;
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      finalOut += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j]!)) j++;
      if (out[j] === "}" || out[j] === "]") {
        continue;
      }
    }
    finalOut += ch;
  }

  return { ok: true, content: finalOut };
}

export function parseJsonc(
  content: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const cleaned = cleanJsonc(content);
  if (!cleaned.ok) {
    return { ok: false, error: cleaned.error };
  }
  try {
    return { ok: true, value: JSON.parse(cleaned.content) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function scanConfigContent(source: ConfigSourceId, content: string): SourceScanResult {
  const parsed = parseJsonc(content);
  if (!parsed.ok) {
    return {
      source,
      readable: true,
      specifiers: [],
      diagnostics: [{ code: "parse_error", source, detail: parsed.error }],
    };
  }
  if (!isRecord(parsed.value) || !("plugin" in parsed.value)) {
    return {
      source,
      readable: true,
      specifiers: [],
      diagnostics: [{ code: "plugin_missing", source }],
    };
  }
  const pluginField = parsed.value.plugin;
  if (!Array.isArray(pluginField)) {
    return {
      source,
      readable: true,
      specifiers: [],
      diagnostics: [{ code: "plugin_not_array", source }],
    };
  }

  const specifiers: JusticePluginSpecifier[] = [];
  const diagnostics: ConfigDiagnostic[] = [];

  for (const entry of pluginField) {
    if (typeof entry === "string") {
      specifiers.push({ specifier: entry, optionsPresent: false, optionKeys: [] });
      continue;
    }
    if (Array.isArray(entry)) {
      if (entry.length === 2 && typeof entry[0] === "string" && isRecord(entry[1])) {
        specifiers.push({
          specifier: entry[0],
          optionsPresent: true,
          optionKeys: Object.keys(entry[1]).sort(),
        });
        continue;
      }
    }
    diagnostics.push({ code: "invalid_plugin_entry", source });
  }

  return { source, readable: true, specifiers, diagnostics };
}

export function scanUnreadableSource(
  source: ConfigSourceId,
  rawContent?: string,
): SourceScanResult {
  if (!rawContent) {
    return { source, readable: false, specifiers: [], diagnostics: [] };
  }
  const cleaned = cleanJsonc(rawContent);
  const targetText = cleaned.ok ? cleaned.content : rawContent;
  // Best-effort: parse JSON and check plugin entries for justice specifiers.
  let hasJusticeSpecifier = false;
  try {
    const parsed = JSON.parse(targetText) as { plugin?: unknown[] };
    if (Array.isArray(parsed.plugin)) {
      for (const entry of parsed.plugin) {
        const specifier =
          typeof entry === "string"
            ? entry
            : Array.isArray(entry) &&
                entry.length > 0 &&
                typeof entry[0] === "string"
              ? entry[0]
              : undefined;
        if (specifier !== undefined && isJusticeSpecifier(specifier)) {
          hasJusticeSpecifier = true;
          break;
        }
      }
    }
  } catch {
    // Fallback for broken/invalid JSON: extract quoted strings from the
    // plugin array using regex and test each one.
    const pluginMatch = /"plugin"\s*:\s*\[([^\]]*)\]/.exec(targetText);
    if (pluginMatch) {
      const strings = pluginMatch[1]!.match(/"([^"]+)"/g);
      if (strings !== null) {
        for (const s of strings) {
          const value = s.slice(1, -1);
          if (isJusticeSpecifier(value)) {
            hasJusticeSpecifier = true;
            break;
          }
        }
      }
    }
  }
  if (hasJusticeSpecifier) {
    return {
      source,
      readable: false,
      specifiers: [],
      diagnostics: [{ code: "unsupported_config_source", source }],
    };
  }
  return { source, readable: false, specifiers: [], diagnostics: [] };
}

function extractPackageName(specifier: string): string {
  if (specifier.startsWith("/")) return specifier;
  if (specifier.startsWith("@")) {
    const parts = specifier.slice(1).split("@");
    return "@" + parts[0]!;
  }
  return specifier.split("@")[0]!;
}

export function mergeSourceScans(scans: readonly SourceScanResult[]): {
  readonly specifiers: readonly JusticePluginSpecifier[];
  readonly diagnostics: readonly ConfigDiagnostic[];
} {
  const sortedScans = [...scans].sort(
    (a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source],
  );

  const specifierByPkg = new Map<string, JusticePluginSpecifier>();
  const diagnostics: ConfigDiagnostic[] = [];

  for (const s of sortedScans) {
    diagnostics.push(...s.diagnostics);
    for (const spec of s.specifiers) {
      const pkg = extractPackageName(spec.specifier);
      specifierByPkg.set(pkg, spec);
    }
  }

  const justiceSpecifiers = Array.from(specifierByPkg.values()).filter((s) =>
    isJusticeSpecifier(s.specifier),
  );

  const nonJusticeSpecifiers = Array.from(specifierByPkg.values()).filter(
    (s) => !isJusticeSpecifier(s.specifier),
  );

  const mergedSpecifiers = [...justiceSpecifiers, ...nonJusticeSpecifiers];

  if (justiceSpecifiers.length === 0) {
    diagnostics.push({ code: "justice_not_found_in_config", source: "global" });
  }

  return { specifiers: mergedSpecifiers, diagnostics };
}
