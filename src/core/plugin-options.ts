// src/core/plugin-options.ts
//
// OpenCode PluginOptions（plugin 設定の tuple 第 2 要素）の検証純粋関数（設計書 §7.2）。
// - 既知キーのみを読む。未知キーは無視する（前方互換）。
// - 型不一致は既定値を採用し、警告を戻り値に積む。例外は投げない（fail-open）。
// - 警告の出力は runtime 境界（src/opencode-plugin.ts が init.client.app.log へ）の責務。
//   core から console.warn へ逃げてはならない（不変条件 1 の骨抜き防止）。
// 環境変数は追加しない。設定経路は OpenCode の PluginOptions 1 本に集約する。

export type ValidatedPluginOptions = {
  readonly enableAdvisoryOutputAppend?: boolean;
};

export type PluginOptionsValidation = {
  readonly options: ValidatedPluginOptions;
  readonly warnings: readonly string[];
};

export function validatePluginOptions(raw: unknown): PluginOptionsValidation {
  if (raw === undefined || raw === null) {
    return { options: {}, warnings: [] };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const kind = Array.isArray(raw) ? "array" : typeof raw;
    return {
      options: {},
      warnings: [
        `[Justice] plugin options must be an object; received ${kind}. Ignoring all options.`,
      ],
    };
  }
  const record = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const options: { enableAdvisoryOutputAppend?: boolean } = {};
  let value: unknown;
  try {
    value = record.enableAdvisoryOutputAppend;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(
      `[Justice] plugin option "enableAdvisoryOutputAppend" could not be read: ${message}. Falling back to the default (false).`,
    );
    return { options, warnings };
  }

  if (value !== undefined) {
    if (typeof value === "boolean") {
      options.enableAdvisoryOutputAppend = value;
    } else {
      warnings.push(
        `[Justice] plugin option "enableAdvisoryOutputAppend" must be a boolean; received ${typeof value}. Falling back to the default (false).`,
      );
    }
  }
  return { options, warnings };
}
