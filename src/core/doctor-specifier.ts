// src/core/doctor-specifier.ts
//
// justice doctor の specifier 解決規則（設計書 §9.1.1）。
// 素朴な import(specifier) はバージョン付き（"@yohi/justice@2.7.0"）を解決できないため、
// OpenCode の観測されたキャッシュレイアウト（<cacheRoot>/packages/<name>@<version>/node_modules/<name>/）
// を再現して実体を特定する。本モジュールの I/O は FileReader 抽象経由のみ（モック FS で単体テスト可能）。
import type { FileReader } from "./types";

export type NormalizedSpecifier =
  | { readonly kind: "absolute-path"; readonly path: string }
  | {
      readonly kind: "package";
      readonly name: string;
      readonly version?: string;
      readonly subpath?: string;
    };

/** スコープ付き名の先頭 @ とバージョン区切りの @ を区別して分解する。 */
export function normalizeSpecifier(specifier: string): NormalizedSpecifier {
  if (specifier.startsWith("/")) {
    return { kind: "absolute-path", path: specifier };
  }
  const scoped = /^(@[^/]+\/[^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(specifier);
  if (scoped !== null) {
    return {
      kind: "package",
      name: scoped[1]!,
      ...(scoped[2] === undefined ? {} : { version: scoped[2] }),
      ...(scoped[3] === undefined ? {} : { subpath: `.${scoped[3]}` }),
    };
  }
  const plain = /^([^/@]+)(?:@([^/]+))?(\/.*)?$/.exec(specifier);
  if (plain !== null) {
    return {
      kind: "package",
      name: plain[1]!,
      ...(plain[2] === undefined ? {} : { version: plain[2] }),
      ...(plain[3] === undefined ? {} : { subpath: `.${plain[3]}` }),
    };
  }
  // 解釈不能な指定はパッケージ名そのものとして扱い、解決側で cache_not_found に落とす。
  return { kind: "package", name: specifier };
}

export type ResolvedPackageEntry = {
  readonly packageDir: string;
  readonly version: string;
  readonly entryFile: string;
};

export type SpecifierResolution =
  | { readonly ok: true; readonly entry: ResolvedPackageEntry | { readonly entryFile: string } }
  | {
      readonly ok: false;
      readonly code:
        | "cache_not_found"
        | "version_not_found"
        | "ambiguous_versions"
        | "exports_not_resolvable"
        | "entry_file_missing";
      readonly detail: string;
      readonly candidates?: readonly string[];
    };

function packageDirOf(cacheRoot: string, name: string, version: string): string {
  return `${cacheRoot}/packages/${name}@${version}/node_modules/${name}`;
}

function resolveExportsTarget(
  exportsMap: unknown,
  subpath: string | undefined,
): string | undefined {
  if (typeof exportsMap !== "object" || exportsMap === null) return undefined;
  const target = (exportsMap as Record<string, unknown>)[subpath ?? "."];
  if (typeof target !== "object" || target === null) return undefined;
  const importField = (target as Record<string, unknown>).import;
  return typeof importField === "string" ? importField : undefined;
}

export async function resolveSpecifier(
  spec: NormalizedSpecifier,
  deps: { readonly fileReader: FileReader; readonly cacheRoot: string },
): Promise<SpecifierResolution> {
  // CONTRACT: This core function requires a non-sandboxing FileReader.
  // - listFiles(prefix) must accept absolute `prefix` paths and return ALL matching files
  //   (it must NOT filter by extension or reject absolute paths).
  // - fileExists(path) must accept absolute `path` values.
  // In unit tests this is satisfied by createMockFileReader; in the real runtime the CLI
  // integration uses createCliFileReader (Task 7), which is an unrooted reader that honors
  // this contract. NodeFileSystem is a sandboxed project-root reader and is NOT used here.
  if (spec.kind === "absolute-path") {
    return (await deps.fileReader.fileExists(spec.path))
      ? { ok: true, entry: { entryFile: spec.path } }
      : { ok: false, code: "entry_file_missing", detail: spec.path };
  }

  const prefix = `${deps.cacheRoot}/packages/${spec.name}@`;
  const candidates = (await deps.fileReader.listFiles(prefix))
    .map((path) => path.slice(prefix.length).split("/")[0]!)
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (candidates.length === 0) {
    return { ok: false, code: "cache_not_found", detail: `no cached versions of ${spec.name}` };
  }
  let version: string;
  if (spec.version !== undefined) {
    if (!candidates.includes(spec.version)) {
      return {
        ok: false,
        code: "version_not_found",
        detail: `${spec.name}@${spec.version}`,
        candidates,
      };
    }
    version = spec.version;
  } else if (candidates.length === 1) {
    version = candidates[0]!;
  } else {
    // 複数バージョン並存時は黙って 1 つを選ばず、候補一覧を利用者に提示する（設計書 §9.1.1）。
    return {
      ok: false,
      code: "ambiguous_versions",
      detail: `${spec.name} has ${candidates.length} cached versions`,
      candidates,
    };
  }

  const packageDir = packageDirOf(deps.cacheRoot, spec.name, version);
  let packageJson: { readonly exports?: unknown };
  try {
    packageJson = JSON.parse(await deps.fileReader.readFile(`${packageDir}/package.json`)) as {
      readonly exports?: unknown;
    };
  } catch {
    return { ok: false, code: "exports_not_resolvable", detail: `${packageDir}/package.json` };
  }
  const importPath = resolveExportsTarget(packageJson.exports, spec.subpath);
  if (importPath === undefined) {
    return {
      ok: false,
      code: "exports_not_resolvable",
      detail: `${spec.name}@${version} exports["${spec.subpath ?? "."}"]`,
    };
  }
  const entryFile = `${packageDir}/${importPath.replace(/^\.\//, "")}`;
  return (await deps.fileReader.fileExists(entryFile))
    ? { ok: true, entry: { packageDir, version, entryFile } }
    : { ok: false, code: "entry_file_missing", detail: entryFile };
}
