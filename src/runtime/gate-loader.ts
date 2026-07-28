import type { FileReader } from "../core/types";
import { DEFAULT_GATES } from "../core/v2/default-gates";
import { parseGateYaml } from "../core/v2/gate-yaml-parser";
import type { GateRule } from "../core/v2/gate-definition";

/**
 * `loadGates`/`FileGateLoader` 用のロガー抽象。未指定時は `console` にフォールバックする
 * （`state-projection-cache.ts` の `CacheLogger` の先例に倣う）。これにより、呼び出し側が
 * `JusticePluginOptions.logger` 等の集約ロガーを注入できるようになる。
 */
export interface GateLoaderLogger {
  warn(message: string, ...args: unknown[]): void;
}

/** Node の `ENOENT`（ファイル不存在）エラーかどうかを判定する。 */
function isEnoentError(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/** 有効（`enabled !== false`）な gate のみを残す。 */
function keepEnabled(gates: readonly GateRule[]): readonly GateRule[] {
  return gates.filter((gate) => gate.enabled !== false);
}

/**
 * カスタム gate を `DEFAULT_GATES` にマージする。
 *
 * - 同一 `id` のカスタム gate は既定 gate を上書き（属性の置き換え / 無効化）する。
 * - `DEFAULT_GATES` に存在しない `id` のカスタム gate は新規追加される。
 * - マージ後に `enabled: false` の gate は結果から除外される。
 *
 * 上書きは `{ ...existing, ...custom }` の浅いマージだが、`parseGateYaml`（Zod）が
 * 必須フィールドをすべて補完するため、実質的には gate オブジェクト単位での置換となる
 * （`description` のみ、カスタム側で省略された場合に既定値が残る）。
 */
export function mergeWithDefaults(customGates: readonly GateRule[]): readonly GateRule[] {
  const mergedMap = new Map<string, GateRule>();
  for (const gate of DEFAULT_GATES) {
    mergedMap.set(gate.id, gate);
  }
  for (const custom of customGates) {
    const existing = mergedMap.get(custom.id);
    if (existing) {
      // 既定 gate の属性上書き / 無効化（D6/D57）
      mergedMap.set(custom.id, { ...existing, ...custom });
    } else {
      // 新規カスタム gate の追加
      mergedMap.set(custom.id, custom);
    }
  }
  return keepEnabled(Array.from(mergedMap.values()));
}

/**
 * `.justice/gate.yaml`（正本）を読み込み、`DEFAULT_GATES` にマージした
 * 実効 gate 一覧を返す。
 *
 * フェイルオープン設計：
 * - ファイルが存在しない（`ENOENT`）場合は既定 gate を返す（警告なし）。
 * - 読み込みが `ENOENT` 以外で失敗した場合は警告のうえ既定 gate を返す。
 * - YAML の解析 / 検証に失敗した場合も警告のうえ既定 gate にフォールバックする。
 */
export async function loadGates(
  fileReader: FileReader,
  path = ".justice/gate.yaml",
  logger: GateLoaderLogger = console,
): Promise<readonly GateRule[]> {
  let content: string | null = null;
  try {
    content = await fileReader.readFile(path);
  } catch (err: unknown) {
    if (!isEnoentError(err)) {
      logger.warn("Failed to read gates configuration from %s:", path, err);
    }
  }
  if (content === null) {
    return keepEnabled(DEFAULT_GATES);
  }
  try {
    return mergeWithDefaults(parseGateYaml(content));
  } catch (err: unknown) {
    logger.warn(
      "Failed to parse gates configuration from %s, falling back to defaults:",
      path,
      err,
    );
    return keepEnabled(DEFAULT_GATES);
  }
}

/** 実効 gate 一覧を提供するローダーの抽象。 */
export interface GateLoader {
  load(): Promise<readonly GateRule[]>;
}

/**
 * `FileReader` を介して `.justice/gate.yaml` を読み込む {@link GateLoader} 実装。
 *
 * Task 5.4 のフックはこの `load()` を呼び出して実効 gate 一覧を取得する。
 */
export class FileGateLoader implements GateLoader {
  constructor(
    private readonly fileReader: FileReader,
    private readonly path = ".justice/gate.yaml",
    private readonly logger: GateLoaderLogger = console,
  ) {}

  async load(): Promise<readonly GateRule[]> {
    return loadGates(this.fileReader, this.path, this.logger);
  }
}
