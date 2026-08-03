// src/core/loader-contract.ts
//
// OpenCode プラグインローダ契約（設計書 §2.2）の判定純粋関数。
// FF-009 回帰テスト（tests/dist/）と justice doctor（src/runtime/doctor-cli.ts）の
// 双方から共有し、実装の二重化を避ける（設計書 §9.1.1）。
//
// ローダ契約:
//   1. モジュールのすべての export が「関数」または「{ server: 関数 }」でなければ、
//      プラグイン全体のロードが TypeError で失敗する。
//   2. 適合した export はすべてプラグインファクトリとして呼び出される
//      （同一関数オブジェクトは Set で dedup される）。

export type LoaderContractViolation = {
  readonly exportName: string;
  readonly actualKind: string;
};

export type LoaderContractResult = {
  readonly ok: boolean;
  readonly violations: readonly LoaderContractViolation[];
  /** dedup 後のプラグインファクトリ候補（関数、または `{ server: fn }` の server）。 */
  readonly pluginFactories: readonly unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function checkLoaderContract(
  moduleExports: Readonly<Record<string, unknown>>,
): LoaderContractResult {
  const seen = new Set<unknown>();
  const violations: LoaderContractViolation[] = [];
  const pluginFactories: unknown[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (seen.has(value)) continue;
    seen.add(value);
    if (typeof value === "function") {
      pluginFactories.push(value);
      continue;
    }
    if (isRecord(value) && typeof value.server === "function") {
      pluginFactories.push(value.server);
      continue;
    }
    violations.push({ exportName, actualKind: describeKind(value) });
  }
  return { ok: violations.length === 0, violations, pluginFactories };
}
