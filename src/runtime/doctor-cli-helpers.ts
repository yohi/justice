// src/runtime/doctor-cli-helpers.ts
//
// justice doctor CLI の出力整形ヘルパー群。
// runDoctor から分離し、認知複雑度を抑える。

import type { ConfigDiagnostic, JusticePluginSpecifier } from "../core/doctor-config";
import type { LoaderContractResult } from "../core/loader-contract";
import type { DoctorDeps } from "./doctor-cli";
import { normalizeSpecifier, resolveSpecifier } from "../core/doctor-specifier";
import { checkLoaderContract } from "../core/loader-contract";
import { scanOpenCodeLogText } from "../core/doctor-logs";

type SpecifierSection = {
  readonly failed: boolean;
  readonly lines: readonly string[];
};

export async function resolveAndCheckSpecifier(
  entry: JusticePluginSpecifier,
  deps: DoctorDeps,
): Promise<SpecifierSection> {
  const lines: string[] = [`■ 検査 2: ${entry.specifier}`];
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
    return { failed: true, lines };
  }
  const entryFile = resolution.entry.entryFile;
  lines.push(`  解決先: ${entryFile}`);
  try {
    const moduleExports = await deps.importer(entryFile);
    const contract = checkLoaderContract(moduleExports);
    const contractLines = formatContractResult(contract);
    const failed = contractLines.some((l) => l.startsWith("  ✗"));
    lines.push(...contractLines);
    return { failed, lines };
  } catch (error) {
    lines.push(
      `  ✗ import 失敗: ${error instanceof Error ? error.message : String(error)}（契約判定とは別種の失敗）`,
    );
    return { failed: true, lines };
  }
}

export function formatConfigDiagnostics(diagnostics: readonly ConfigDiagnostic[]): readonly string[] {
  return diagnostics
    .map((diagnostic) => {
      if (diagnostic.code === "unsupported_config_source") {
        return `  ! ${diagnostic.code}: ${diagnostic.source} に justice 系 plugin がありますが、このソースは doctor から読み込めません。手動で確認してください。`;
      }
      if (diagnostic.code === "justice_not_found_in_config") {
        return `  ✗ ${diagnostic.code}: 設定に @yohi/justice が見つかりません`;
      }
      if (diagnostic.code === "plugin_missing") {
        return "";
      }
      return `  ! ${diagnostic.code}: ${diagnostic.source}${diagnostic.detail ? ` (${diagnostic.detail})` : ""}`;
    })
    .filter((line) => line !== "");
}

export function formatContractResult(contract: LoaderContractResult): readonly string[] {
  if (contract.ok) {
    return [`  ✓ ローダ契約 OK（plugin factory: ${contract.pluginFactories.length} 件）`];
  }
    const violationNames = contract.violations.map((v) => v.exportName).join(", ");
  return [
    "  ✗ plugin エントリが OpenCode のローダ契約を満たしていません",
    "",
    "    原因: OpenCode はモジュールの全 export が関数または { server: 関数 } であることを",
    `          要求しますが、以下 ${contract.violations.length} 件の export が非関数です:`,
    `            ${violationNames}`,
    "          このため Justice は一行も実行されていません（v1 / v2 とも未稼働）。",
    "",
    "    修正: @yohi/justice を 3.0.0 以上に更新してください。",
    "            opencode plugin @yohi/justice",
    "          更新できない場合は specifier を plugin 専用サブパスに変更してください:",
    '            "plugin": ["@yohi/justice/opencode"]',
  ];
}

export async function formatLogScanLines(deps: DoctorDeps): Promise<readonly string[]> {
  const lines: string[] = [];
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
  return lines;
}

export function isJusticeSpecifier(specifier: string): boolean {
  return (
    specifier === "@yohi/justice" ||
    specifier.startsWith("@yohi/justice@") ||
    specifier.startsWith("@yohi/justice/") ||
    (specifier.startsWith("/") && specifier.includes("justice"))
  );
}

