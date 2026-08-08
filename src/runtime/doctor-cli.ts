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
import { dirname, join } from "node:path";
import {
  mergeSourceScans,
  scanConfigContent,
  scanUnreadableSource,
  isJusticeSpecifier,
  type ConfigSourceId,
  type SourceScanResult,
} from "../core/doctor-config";
import {
  formatConfigDiagnostics,
  formatLogScanLines,
  resolveAndCheckSpecifier,
} from "./doctor-cli-helpers";
import { SecretPatternDetector } from "../core/secret-pattern-detector";
import type { FileReader } from "../core/types";
import { loadGates } from "./gate-loader";
import type { GateLoaderLogger } from "./gate-loader";
import { NodeFileSystem } from "./node-file-system";
import { StatusCommand } from "../core/status-command";
import { TelemetryStore } from "../core/telemetry-store";

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

export async function runStatus(
  cwd: string,
  planPath: string,
  analytics: boolean,
  json: boolean,
): Promise<string> {
  const fileSystem = new NodeFileSystem(cwd);
  const telemetry = new TelemetryStore(fileSystem, fileSystem);
  await telemetry.load();
  const command = new StatusCommand(fileSystem, analytics ? telemetry : undefined);
  const status = analytics
    ? await command.getStatusWithAnalytics(planPath)
    : await command.getStatus(planPath);
  return json ? command.formatAsJson(status) : command.formatAsMarkdown(status);
}

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
  const candidates = configCandidates(deps);
  const scans = await Promise.all(
    candidates.map(async (candidate) => {
      if (!candidate.readable) {
        return scanUnreadableSource(candidate.source, candidate.rawContent);
      }
      if (candidate.path === undefined) {
        return { source: candidate.source, readable: true, specifiers: [], diagnostics: [] };
      }
      try {
        return scanConfigContent(candidate.source, await deps.fileReader.readFile(candidate.path));
      } catch {
        // 読めない設定ファイルは存在しないものとして扱う（例外で落とさない）。
        return { source: candidate.source, readable: true, specifiers: [], diagnostics: [] };
      }
    }),
  );
  return scans;
}

async function summarizeObservationData(deps: DoctorDeps): Promise<string> {
  const eventsRoot = `${deps.cwd}/.justice/events`;
  const shards = (await deps.fileReader.listFiles(eventsRoot)).filter((p) => p.endsWith(".jsonl"));
  if (shards.length === 0) return "  .justice/events: なし（未観測）";
  const results = await Promise.all(
    shards.map(async (shard) => {
      try {
        const content = await deps.fileReader.readFile(shard);
        const recordCount = content.split("\n").filter((l) => l.trim()).length;
        const stats = await deps.fileReader.readFileStats(shard);
        return { recordCount, mtimeMs: stats?.mtimeMs ?? 0 };
      } catch {
        // 読めない shard は件数・更新日時から除外（診断は best-effort）。
        return { recordCount: 0, mtimeMs: 0 };
      }
    }),
  );
  const recordCount = results.reduce((sum, r) => sum + r.recordCount, 0);
  const lastWriteMs = results.reduce((max, r) => Math.max(max, r.mtimeMs), 0);
  const lastWrite = lastWriteMs > 0 ? new Date(lastWriteMs).toISOString() : "不明";
  return `  .justice/events: shard ${shards.length} 件 / レコード ${recordCount} 件 / 最終書込 ${lastWrite}`;
}

/** `loadGates` からの warning を収集して `runDoctor` の出力に含め redaction の対象にする。 */
class CollectingGateLoaderLogger implements GateLoaderLogger {
  private readonly messages: string[] = [];

  warn(message: string, ...args: unknown[]): void {
    this.messages.push(`${message} ${args.map(String).join(" ")}`.trim());
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
  const warnings = logger.collect().map((message) => `  ! gate.yaml 読込警告: ${message}`);
  lines.push(...warnings);
  const gateIds = gates.map((g) => g.id);
  return `  .justice/gate.yaml: 有効（実効 gate: ${gateIds.join(", ")}）`;
}

export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const detector = new SecretPatternDetector();
  const lines: string[] = [];
  let failed = false;

  // 検査 1: 設定探索と justice specifier 抽出
  const scans = await scanAllSources(deps);
  const merged = mergeSourceScans(scans);
  const diagnostics = formatConfigDiagnostics(merged.diagnostics);
  lines.push("■ 検査 1: OpenCode 設定の justice エントリ", ...diagnostics);
  failed ||= merged.diagnostics.some((d) => d.code === "justice_not_found_in_config");

  // 検査 2: specifier 解決とローダ契約判定
  const justiceSpecifiers = merged.specifiers.filter((s) => isJusticeSpecifier(s.specifier));
  for (const entry of justiceSpecifiers) {
    const section = await resolveAndCheckSpecifier("■ 検査 2", entry, deps);
    if (section.failed) failed = true;
    lines.push(...section.lines);
  }

  // 検査 3: OpenCode ログ走査
  const logLines = await formatLogScanLines(deps);
  lines.push("■ 検査 3: OpenCode ログ", ...logLines);

  // 検査 4: .justice/ サマリ
  lines.push("■ 検査 4: 観測データ", await summarizeObservationData(deps));

  // 検査 5: gate.yaml 妥当性
  lines.push("■ 検査 5: gate.yaml", await checkGateYaml(deps, lines));

  return { exitCode: failed ? 1 : 0, text: detector.redact(lines.join("\n")) };
}

/** CLI 専用の非閉域 FileReader（~/.config や ~/.cache を横断読取するため root 制限を持たない）。
 * 実ディスク I/O のみを行うため、単体テストではモック置換が難しく、実 FS 統合テストでカバーする。
 */
/* istanbul ignore next -- real-fs CLI adapter; covered by tests/real-fs/doctor-resolver.test.ts */
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
        const prefixIsDirectory = await stat(prefix)
          .then((entry) => entry.isDirectory())
          .catch(() => false);
        const entries = await readdir(prefixIsDirectory ? prefix : dirname(prefix), {
          recursive: true,
          withFileTypes: true,
        });
        return entries
          .filter((entry) => entry.isFile())
          .map((entry) => join(entry.parentPath, entry.name))
          .filter((path) => path.startsWith(prefix));
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

/* istanbul ignore next -- real-fs path discovery; covered by tests/real-fs/doctor-resolver.test.ts */
async function discoverLogPaths(env: NodeJS.ProcessEnv, home?: string): Promise<readonly string[]> {
  const dataHome = env.XDG_DATA_HOME ?? (home === undefined ? undefined : `${home}/.local/share`);
  if (dataHome === undefined) return [];
  const logDir = `${dataHome}/opencode/log`;
  try {
    return (await readdir(logDir))
      .filter((name) => name.endsWith(".log"))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => `${logDir}/${name}`);
  } catch {
    return [];
  }
}

/* istanbul ignore next -- CLI entry point; covered by integration tests invoking the binary */
export function resolveCacheRoot(
  env: { readonly [key: string]: string | undefined },
  home: string,
): string {
  const xdgCache = env.XDG_CACHE_HOME;
  const cacheBase = xdgCache === undefined || xdgCache === "" ? `${home}/.cache` : xdgCache;
  return `${cacheBase}/opencode`;
}

/* istanbul ignore next -- CLI entry point; covered by integration tests invoking the binary */
export async function main(argv: readonly string[]): Promise<number> {
  if (argv[0] === "status") {
    const planPath = argv[1] ?? "plan.md";
    const analytics = argv.includes("--analytics");
    const json = argv.includes("--json");
    try {
      process.stdout.write(`${await runStatus(process.cwd(), planPath, analytics, json)}\n`);
      return 0;
    } catch (error: unknown) {
      process.stderr.write(`justice status failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }

  if (argv[0] !== "doctor") {
    process.stderr.write("usage: justice doctor | justice status [plan.md] [--analytics] [--json]\n");
    return 2;
  }
  const env = process.env;
  const home = env.HOME ?? homedir();
  const cacheRoot = resolveCacheRoot(env, home);
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

/* istanbul ignore next -- CLI entry point */
if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
