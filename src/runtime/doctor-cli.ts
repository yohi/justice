#!/usr/bin/env bun
// src/runtime/doctor-cli.ts
//
// justice doctor — OpenCode の外から実行する診断 CLI（設計書 §9.1 層1）。
// プラグインのロード自体が失敗する場合 Justice のコードは 1 行も実行されず
// Justice 自身からは警告を出せないため、これがロード失敗を検知できる唯一の経路である。
//
// 不変条件 2（fail-open）の唯一の例外: 検査失敗時に非ゼロ終了コードを返す。
// CLI はプラグイン本体ではなくセッションを落とさないため、この例外は安全である。
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import {
  mergeSourceScans,
  scanConfigContent,
  scanUnreadableSource,
  type ConfigSourceId,
  type SourceScanResult,
} from "../core/doctor-config";
import { scanOpenCodeLogText } from "../core/doctor-logs";
import { normalizeSpecifier, resolveSpecifier } from "../core/doctor-specifier";
import { checkLoaderContract } from "../core/loader-contract";
import { SecretPatternDetector } from "../core/secret-pattern-detector";
import type { FileReader } from "../core/types";
import { loadGates } from "./gate-loader";
import type { GateLoaderLogger } from "./gate-loader";

export type DoctorDeps = {
  readonly fileReader: FileReader;
  readonly env: { readonly [key: string]: string | undefined };
  readonly cwd: string;
  readonly homeDir?: string;
  readonly cacheRoot: string;
  readonly logPaths: readonly string[];
  readonly importer: (entryFile: string) => Promise<Readonly<Record<string, unknown>>>;
};

export type DoctorReport = {
  readonly exitCode: 0 | 1;
  readonly text: string;
};

type ConfigCandidate = {
  readonly source: ConfigSourceId;
  readonly path?: string; // env_config_content のようにパスを持たないソースがある
  readonly rawContent?: string;
  readonly readable: boolean;
};

/** 設計書 §9.1.0 の設定ソース表に従う候補列挙。最初に見つかった 1 ファイルだけで判定しない。 */
export function configCandidates(deps: DoctorDeps): readonly ConfigCandidate[] {
  const candidates: ConfigCandidate[] = [{ source: "remote", readable: false }];
  if (deps.homeDir !== undefined) {
    candidates.push(
      { source: "global", path: `${deps.homeDir}/.config/opencode/config.json`, readable: true },
      { source: "global", path: `${deps.homeDir}/.config/opencode/opencode.json`, readable: true },
      { source: "global", path: `${deps.homeDir}/.config/opencode/opencode.jsonc`, readable: true },
    );
  }
  const envConfig = deps.env.OPENCODE_CONFIG;
  if (envConfig !== undefined) {
    candidates.push({ source: "env_config", path: envConfig, readable: true });
  }
  candidates.push(
    { source: "project", path: `${deps.cwd}/opencode.json`, readable: true },
    { source: "project", path: `${deps.cwd}/opencode.jsonc`, readable: true },
    { source: "dot_opencode", path: `${deps.cwd}/.opencode/opencode.json`, readable: true },
    { source: "dot_opencode", path: `${deps.cwd}/.opencode/opencode.jsonc`, readable: true },
  );
  const envConfigDir = deps.env.OPENCODE_CONFIG_DIR;
  if (envConfigDir !== undefined) {
    candidates.push(
      { source: "env_config_dir", path: `${envConfigDir}/opencode.json`, readable: true },
      { source: "env_config_dir", path: `${envConfigDir}/opencode.jsonc`, readable: true },
    );
  }
  candidates.push({
    source: "env_config_content",
    readable: false,
    rawContent: deps.env.OPENCODE_CONFIG_CONTENT,
  });
  candidates.push({ source: "managed", readable: false });
  return candidates;
}

async function scanAllSources(deps: DoctorDeps): Promise<readonly SourceScanResult[]> {
  const scans: SourceScanResult[] = [];
  for (const candidate of configCandidates(deps)) {
    if (!candidate.readable) {
      scans.push(scanUnreadableSource(candidate.source, candidate.rawContent));
      continue;
    }
    if (candidate.path === undefined) continue;
    try {
      scans.push(
        scanConfigContent(candidate.source, await deps.fileReader.readFile(candidate.path)),
      );
    } catch {
      // 読めない設定ファイルは存在しないものとして扱う（例外で落とさない）。
    }
  }
  return scans;
}

async function summarizeObservationData(deps: DoctorDeps): Promise<string> {
  const eventsRoot = `${deps.cwd}/.justice/events`;
  const shards = (await deps.fileReader.listFiles(eventsRoot)).filter((p) => p.endsWith(".jsonl"));
  if (shards.length === 0) return "  .justice/events: なし（未観測）";
  let recordCount = 0;
  let lastWriteMs = 0;
  for (const shard of shards) {
    try {
      recordCount += (await deps.fileReader.readFile(shard))
        .split("\n")
        .filter((l) => l.trim()).length;
    } catch {
      // 読めない shard は件数から除外（診断は best-effort）。
    }
    const stats = await deps.fileReader.readFileStats(shard);
    if (stats !== null && stats.mtimeMs > lastWriteMs) lastWriteMs = stats.mtimeMs;
  }
  const lastWrite = lastWriteMs > 0 ? new Date(lastWriteMs).toISOString() : "不明";
  return `  .justice/events: shard ${shards.length} 件 / レコード ${recordCount} 件 / 最終書込 ${lastWrite}`;
}

/** `loadGates` からの warning を収集して `runDoctor` の出力に含め redaction の対象にする。 */
class CollectingGateLoaderLogger implements GateLoaderLogger {
  private readonly messages: string[] = [];

  warn(message: string, ...args: unknown[]): void {
    this.messages.push(`${message} ${args.map((a) => String(a)).join(" ")}`.trim());
  }

  collect(): readonly string[] {
    return this.messages;
  }
}

async function checkGateYaml(deps: DoctorDeps, lines: string[]): Promise<string> {
  if (!(await deps.fileReader.fileExists(`${deps.cwd}/.justice/gate.yaml`))) {
    return "  .justice/gate.yaml: なし（DEFAULT_GATES へ fail-open）";
  }
  const logger = new CollectingGateLoaderLogger();
  const gates = await loadGates(deps.fileReader, `${deps.cwd}/.justice/gate.yaml`, logger);
  for (const message of logger.collect()) {
    lines.push(`  ! gate.yaml 読込警告: ${message}`);
  }
  return `  .justice/gate.yaml: 有効（実効 gate: ${gates.map((g) => g.id).join(", ")}）`;
}

export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const detector = new SecretPatternDetector();
  const lines: string[] = [];
  let failed = false;

  // 検査 1: 設定探索と justice specifier 抽出
  const scans = await scanAllSources(deps);
  const merged = mergeSourceScans(scans);
  lines.push("■ 検査 1: OpenCode 設定の justice エントリ");
  for (const diagnostic of merged.diagnostics) {
    if (diagnostic.code === "unsupported_config_source") {
      lines.push(
        `  ! ${diagnostic.code}: ${diagnostic.source} に justice 系 plugin がありますが、このソースは doctor から読み込めません。手動で確認してください。`,
      );
    } else if (diagnostic.code === "justice_not_found_in_config") {
      lines.push(`  ✗ ${diagnostic.code}: 設定に @yohi/justice が見つかりません`);
      failed = true;
    } else if (diagnostic.code !== "plugin_missing") {
      lines.push(
        `  ! ${diagnostic.code}: ${diagnostic.source}${diagnostic.detail ? ` (${diagnostic.detail})` : ""}`,
      );
    }
  }

  // 検査 2: specifier 解決とローダ契約判定
  const justiceSpecifiers = merged.specifiers.filter(
    (s) =>
      s.specifier === "@yohi/justice" ||
      s.specifier.startsWith("@yohi/justice@") ||
      s.specifier.startsWith("@yohi/justice/") ||
      (s.specifier.startsWith("/") && s.specifier.includes("justice")),
  );
  for (const entry of justiceSpecifiers) {
    lines.push(`■ 検査 2: ${entry.specifier}`);
    const resolution = await resolveSpecifier(normalizeSpecifier(entry.specifier), {
      fileReader: deps.fileReader,
      cacheRoot: deps.cacheRoot,
    });
    if (!resolution.ok) {
      lines.push(
        `  ✗ ${resolution.code}: ${resolution.detail}` +
          (resolution.candidates ? `（候補: ${resolution.candidates.join(", ")}）` : ""),
      );
      lines.push(
        "  ※ パッケージ未インストール・キャッシュ不在はローダ契約違反とは別種の失敗です。",
      );
      failed = true;
      continue;
    }
    const entryFile = resolution.entry.entryFile;
    lines.push(`  解決先: ${entryFile}`);
    try {
      const moduleExports = await deps.importer(entryFile);
      const contract = checkLoaderContract(moduleExports);
      if (!contract.ok) {
        failed = true;
        lines.push("  ✗ plugin エントリが OpenCode のローダ契約を満たしていません");
        lines.push("");
        lines.push(
          "    原因: OpenCode はモジュールの全 export が関数または { server: 関数 } であることを",
        );
        lines.push(
          `          要求しますが、以下 ${contract.violations.length} 件の export が非関数です:`,
        );
        lines.push(`            ${contract.violations.map((v) => v.exportName).join(", ")}`);
        lines.push("          このため Justice は一行も実行されていません（v1 / v2 とも未稼働）。");
        lines.push("");
        lines.push("    修正: @yohi/justice を 3.0.0 以上に更新してください。");
        lines.push("            opencode plugin @yohi/justice");
        lines.push(
          "          更新できない場合は specifier を plugin 専用サブパスに変更してください:",
        );
        lines.push('            "plugin": ["@yohi/justice/opencode"]');
      } else {
        lines.push(`  ✓ ローダ契約 OK（plugin factory: ${contract.pluginFactories.length} 件）`);
      }
    } catch (error) {
      lines.push(
        `  ✗ import 失敗: ${error instanceof Error ? error.message : String(error)}（契約判定とは別種の失敗）`,
      );
      failed = true;
    }
  }

  // 検査 3: OpenCode ログ走査
  lines.push("■ 検査 3: OpenCode ログ");
  for (const logPath of deps.logPaths) {
    try {
      const scan = scanOpenCodeLogText(await deps.fileReader.readFile(logPath));
      lines.push(
        `  ${logPath}: failed_to_load=${scan.failedToLoadPluginCount} 件 / initialized=${scan.justiceInitializedCount} 件`,
      );
      if (scan.lastFailedToLoadPlugin !== undefined) {
        lines.push(`    直近の失敗: ${scan.lastFailedToLoadPlugin}`);
      }
      if (scan.lastJusticeInitialized !== undefined) {
        lines.push(`    直近の初期化: ${scan.lastJusticeInitialized}`);
      }
    } catch {
      lines.push(`  ${logPath}: 読み込めません`);
    }
  }

  // 検査 4: .justice/ サマリ
  lines.push("■ 検査 4: 観測データ");
  lines.push(await summarizeObservationData(deps));

  // 検査 5: gate.yaml 妥当性
  lines.push("■ 検査 5: gate.yaml");
  lines.push(await checkGateYaml(deps, lines));

  return { exitCode: failed ? 1 : 0, text: detector.redact(lines.join("\n")) };
}

/** CLI 専用の非閉域 FileReader（~/.config や ~/.cache を横断読取するため root 制限を持たない）。 */
export function createCliFileReader(): FileReader {
  return {
    readFile: (path) => readFile(path, "utf-8"),
    fileExists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    listFiles: async (prefix) => {
      try {
        const entries = await readdir(prefix, { recursive: true, withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => `${entry.parentPath}/${entry.name}`);
      } catch {
        return [];
      }
    },
    readFileStats: async (path) => {
      try {
        const s = await stat(path);
        return { size: s.size, mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    },
  };
}

async function discoverLogPaths(env: NodeJS.ProcessEnv, home?: string): Promise<readonly string[]> {
  const dataHome = env.XDG_DATA_HOME ?? (home === undefined ? undefined : `${home}/.local/share`);
  if (dataHome === undefined) return [];
  const logDir = `${dataHome}/opencode/log`;
  try {
    return (await readdir(logDir))
      .filter((name) => name.endsWith(".log"))
      .sort()
      .map((name) => `${logDir}/${name}`);
  } catch {
    return [];
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] !== "doctor") {
    process.stderr.write("usage: justice doctor\n");
    return 2;
  }
  const env = process.env;
  const home = env.HOME ?? homedir();
  const cacheRoot = `${env.XDG_CACHE_HOME ?? `${home}/.cache`}/opencode`;
  const report = await runDoctor({
    fileReader: createCliFileReader(),
    env,
    cwd: process.cwd(),
    homeDir: home,
    cacheRoot,
    logPaths: await discoverLogPaths(env, home),
    importer: (entryFile) => import(entryFile) as Promise<Record<string, unknown>>,
  });
  process.stdout.write(`${report.text}\n`);
  return report.exitCode;
}

/* istanbul ignore next -- CLI エントリポイント */
if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
