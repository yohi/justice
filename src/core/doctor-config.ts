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
    return (
      filename === "justice" ||
      filename.startsWith("justice-") ||
      filename.startsWith("opencode-plugin")
    );
  }
  // Package specifier: extract base package name without version and subpath.
  const lastAt = specifier.lastIndexOf("@");
  const withoutVersion = lastAt > 0 ? specifier.slice(0, lastAt) : specifier;
  const parts = withoutVersion.split("/");
  const baseName = parts.length >= 2 && parts[0]!.startsWith("@") ? parts[1]! : parts[0]!;
  return baseName === "justice" || baseName.startsWith("justice-");
}

/** 文字列リテラル（エスケープを含む）を内容を壊さずに読み進める。 */
function readStringLiteral(
  content: string,
  startIndex: number,
): { output: string; endIndex: number } {
  let out = '"';
  let i = startIndex + 1;
  while (i < content.length) {
    const ch = content.charAt(i);
    if (ch === "\\" && i + 1 < content.length) {
      out += ch + content.charAt(i + 1);
      i += 2;
      continue;
    }
    out += ch;
    if (ch === '"') {
      return { output: out, endIndex: i };
    }
    i++;
  }
  return { output: out, endIndex: i };
}

/** 文字列リテラル内を壊さないよう、文字列を認識して各文字に対する処理を適用する。 */
function processWithStringEscapes(
  content: string,
  onChar: (
    ch: string,
    next: string | undefined,
    i: number,
  ) => { consumed: number; output: string } | undefined,
): string {
  let out = "";
  let i = 0;
  while (i < content.length) {
    const ch = content.charAt(i);
    if (ch === '"') {
      const literal = readStringLiteral(content, i);
      out += literal.output;
      i = literal.endIndex + 1;
      continue;
    }
    const next = i + 1 < content.length ? content.charAt(i + 1) : undefined;
    const result = onChar(ch, next, i);
    if (result) {
      out += result.output;
      i += result.consumed + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** 文字列リテラル内を壊さないよう、行コメントとブロックコメントを除去する。 */
function findLineCommentEnd(content: string, startIndex: number): { end: number; output: string } {
  let end = startIndex + 2;
  while (end < content.length && content.charAt(end) !== "\n") end++;
  return { end, output: content.charAt(end) === "\n" ? "\n" : "" };
}

function findBlockCommentEnd(content: string, startIndex: number): number | undefined {
  let end = startIndex + 2;
  while (end < content.length) {
    if (content.charAt(end) === "*" && content.charAt(end + 1) === "/") {
      return end;
    }
    end++;
  }
  return undefined;
}

function stripComments(
  content: string,
): { ok: true; content: string } | { ok: false; error: string } {
  let error: string | undefined;
  const result = processWithStringEscapes(content, (ch, next, i) => {
    if (error) return undefined;
    if (ch === "/" && next === "/") {
      const lineEnd = findLineCommentEnd(content, i);
      return { consumed: lineEnd.end - i - 1, output: lineEnd.output };
    }
    if (ch === "/" && next === "*") {
      const blockEnd = findBlockCommentEnd(content, i);
      if (blockEnd !== undefined) {
        return { consumed: blockEnd - i + 1, output: "" };
      }
      error = "Unterminated block comment";
      return undefined;
    }
    return undefined;
  });
  if (error) {
    return { ok: false, error };
  }
  return { ok: true, content: result };
}

/** 文字列リテラル内を壊さないよう、閉じ括弧・閉じ角括弧前の末尾カンマを除去する。 */
function stripTrailingCommas(content: string): string {
  return processWithStringEscapes(content, (ch, _next, i) => {
    if (ch !== ",") return undefined;
    let j = i + 1;
    while (j < content.length && /\s/.test(content.charAt(j))) j++;
    if (content.charAt(j) === "}" || content.charAt(j) === "]") {
      return { consumed: j - i - 1, output: "" };
    }
    return undefined;
  });
}

/** 文字列リテラル内を壊さないよう、文字列を認識してコメントと末尾カンマを除去する。 */
function cleanJsonc(content: string): { ok: true; content: string } | { ok: false; error: string } {
  const commentStripped = stripComments(content);
  if (!commentStripped.ok) {
    return commentStripped;
  }
  return { ok: true, content: stripTrailingCommas(commentStripped.content) };
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
          optionKeys: Object.keys(entry[1]).sort((a, b) => a.localeCompare(b)),
        });
        continue;
      }
    }
    diagnostics.push({ code: "invalid_plugin_entry", source });
  }

  return { source, readable: true, specifiers, diagnostics };
}

function extractPluginSpecifier(entry: unknown): string | undefined {
  if (typeof entry === "string") {
    return entry;
  }
  if (Array.isArray(entry) && entry.length > 0 && typeof entry[0] === "string") {
    return entry[0];
  }
  return undefined;
}

function hasJusticeSpecifierInPlugin(plugin: unknown[]): boolean {
  for (const entry of plugin) {
    const specifier = extractPluginSpecifier(entry);
    if (specifier !== undefined && isJusticeSpecifier(specifier)) {
      return true;
    }
  }
  return false;
}

function hasJusticeSpecifierInRawPluginArray(targetText: string): boolean {
  const pluginMatch = /"plugin"\s*:\s*\[([^\]]*)\]/.exec(targetText);
  if (!pluginMatch) return false;
  const strings = pluginMatch[1]!.match(/"([^"]+)"/g);
  if (!strings) return false;
  for (const s of strings) {
    const value = s.slice(1, -1);
    if (isJusticeSpecifier(value)) {
      return true;
    }
  }
  return false;
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
      hasJusticeSpecifier = hasJusticeSpecifierInPlugin(parsed.plugin);
    }
  } catch {
    // Fallback for broken/invalid JSON: extract quoted strings from the
    // plugin array using regex and test each one.
    hasJusticeSpecifier = hasJusticeSpecifierInRawPluginArray(targetText);
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
