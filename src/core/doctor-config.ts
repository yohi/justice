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

/** 文字列リテラル内を壊さないよう、文字列を認識してコメントと末尾カンマを除去する。 */
type JsoncState = {
  out: string;
  inString: boolean;
};

/** Append ch to out; if it is a backslash, also append the next character and skip it. */
function appendStringChar(state: JsoncState, content: string, i: number): number {
  const ch = content[i]!;
  state.out += ch;
  if (ch === "\\") {
    const next = content[i + 1];
    if (next !== undefined) {
      state.out += next;
      return i + 2;
    }
  }
  if (ch === '"') {
    state.inString = false;
  }
  return i + 1;
}

/** Skip to the end of a line comment and preserve a newline in the output. */
function skipLineComment(content: string, start: number): number {
  let i = start;
  while (i < content.length && content[i] !== "\n") i++;
  return i;
}

/** Skip to the end of a block comment, throwing if it is unterminated. */
function skipBlockComment(content: string, start: number): number {
  let i = start + 2;
  while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) i++;
  if (i >= content.length) {
    throw new Error(`Unterminated block comment starting at position ${start}`);
  }
  return i + 1;
}

/** Read whitespace and comments, returning the index of the first non-junk character. */
function skipJunk(content: string, start: number): number {
  let j = start;
  while (j < content.length) {
    const peek = content[j]!;
    const peekNext = content[j + 1];
    if (/\s/.test(peek)) {
      j++;
      continue;
    }
    if (peek === "/" && peekNext === "/") {
      while (j < content.length && content[j] !== "\n") j++;
      continue;
    }
    if (peek === "/" && peekNext === "*") {
      j += 2;
      while (j < content.length && !(content[j] === "*" && content[j + 1] === "/")) j++;
      if (j >= content.length) break;
      j += 2;
      continue;
    }
    break;
  }
  return j;
}

/** 文字列リテラル内を壊さないよう、文字列を認識してコメントと末尾カンマを除去する。 */
function stripJsoncComments(content: string): string {
  const state: JsoncState = { out: "", inString: false };
  let i = 0;
  while (i < content.length) {
    const ch = content[i]!;
    const next = content[i + 1];
    if (state.inString) {
      i = appendStringChar(state, content, i);
      continue;
    }
    if (ch === '"') {
      state.inString = true;
      state.out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      i = skipLineComment(content, i);
      state.out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i = skipBlockComment(content, i);
      continue;
    }
    // 文字列外の末尾カンマのみ除去する（空白・コメントを飛ばした直後が `}` または `]`）。
    if (ch === ",") {
      const j = skipJunk(content, i + 1);
      if (content[j] === "}" || content[j] === "]") {
        i = j;
        continue;
      }
    }
    state.out += ch;
    i++;
  }
  return state.out;
}

export function parseJsonc(
  content: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const stripped = stripJsoncComments(content);
    return { ok: true, value: JSON.parse(stripped) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isJusticeSpecifier(value: string): boolean {
  return (
    value === "@yohi/justice" ||
    value.startsWith("@yohi/justice@") ||
    value.startsWith("@yohi/justice/") ||
    (value.startsWith("/") && value.includes("justice"))
  );
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
  const plugin = parsed.value.plugin;
  if (!Array.isArray(plugin)) {
    return {
      source,
      readable: true,
      specifiers: [],
      diagnostics: [{ code: "plugin_not_array", source }],
    };
  }
  const specifiers: JusticePluginSpecifier[] = [];
  const diagnostics: ConfigDiagnostic[] = [];
  for (const entry of plugin as unknown[]) {
    if (typeof entry === "string") {
      if (isJusticeSpecifier(entry)) {
        specifiers.push({ specifier: entry, optionsPresent: false, optionKeys: [] });
      }
      continue;
    }
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      isRecord(entry[1])
    ) {
      if (isJusticeSpecifier(entry[0])) {
        specifiers.push({
          specifier: entry[0],
          optionsPresent: true,
          optionKeys: Object.keys(entry[1]).sort((a, b) => a.localeCompare(b)),
        });
      }
      continue;
    }
    diagnostics.push({ code: "invalid_plugin_entry", source, detail: JSON.stringify(entry) });
  }
  return { source, readable: true, specifiers, diagnostics };
}

/** remote / managed / OPENCODE_CONFIG_CONTENT 等、doctor が読み込めないソースの検出専用走査。 */
export function scanUnreadableSource(
  source: ConfigSourceId,
  rawContent?: string,
): SourceScanResult {
  const diagnostics: ConfigDiagnostic[] =
    rawContent?.includes("@yohi/justice")
      ? [{ code: "unsupported_config_source", source }]
      : [];
  return { source, readable: false, specifiers: [], diagnostics };
}

/** plugin エントリの重複除去キー。同一 npm パッケージ名または同一ローカルパスで潰す。 */
function dedupeKey(specifier: string): string {
  if (specifier.startsWith("/")) return specifier;
  // スコープ先頭の @ を除外したうえで、バージョン区切りの @ とサブパス区切りの / の早い方で切る
  const versionAt = specifier.indexOf("@", 1);
  const subpathSlash = specifier.indexOf(
    "/",
    specifier.startsWith("@") ? specifier.indexOf("/", 1) + 1 : 0,
  );
  const candidates = [versionAt, subpathSlash].filter((i) => i > 0);
  const cut = candidates.length === 0 ? undefined : Math.min(...candidates);
  return cut === undefined ? specifier : specifier.slice(0, cut);
}

export function mergeSourceScans(scans: readonly SourceScanResult[]): {
  readonly specifiers: readonly JusticePluginSpecifier[];
  readonly diagnostics: readonly ConfigDiagnostic[];
} {
  const sorted = [...scans].sort((a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]);
  const byKey = new Map<string, JusticePluginSpecifier>();
  const diagnostics: ConfigDiagnostic[] = [];
  for (const scan of sorted) {
    diagnostics.push(...scan.diagnostics);
    for (const specifier of scan.specifiers) {
      byKey.set(dedupeKey(specifier.specifier), specifier);
    }
  }
  const specifiers = [...byKey.values()];
  if (!specifiers.some((s) => isJusticeSpecifier(s.specifier))) {
    diagnostics.push({ code: "justice_not_found_in_config", source: "global" });
  }
  return { specifiers, diagnostics };
}
