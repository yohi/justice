// src/core/doctor-logs.ts
//
// justice doctor のログ走査（設計書 §9.1 検査 3）の純粋関数。
// OpenCode ログを走査し `failed to load plugin` / `Justice initialized` の有無・回数・
// 直近行を報告する。

import { isJusticeSpecifier } from "./doctor-config";

const FAILED_TO_LOAD_PLUGIN_MARKER = "failed to load plugin";
const JUSTICE_INITIALIZED_MARKER = "Justice initialized";
const PATH_REGEX = /path=([^\s]+)/;

export type OpenCodeLogScan = {
  readonly failedToLoadPluginCount: number;
  readonly lastFailedToLoadPlugin?: string;
  readonly justiceInitializedCount: number;
  readonly lastJusticeInitialized?: string;
};

export function scanOpenCodeLogText(text: string): OpenCodeLogScan {
  let failedToLoadPluginCount = 0;
  let justiceInitializedCount = 0;
  let lastFailedToLoadPlugin: string | undefined;
  let lastJusticeInitialized: string | undefined;
  for (const line of text.split("\n")) {
    if (line.includes(FAILED_TO_LOAD_PLUGIN_MARKER)) {
      const pathMatch = PATH_REGEX.exec(line);
      const pathValue = pathMatch?.[1] ?? "";
      if (isJusticeSpecifier(pathValue)) {
        failedToLoadPluginCount++;
        lastFailedToLoadPlugin = line.trim();
      }
    }
    if (line.includes(JUSTICE_INITIALIZED_MARKER)) {
      justiceInitializedCount++;
      lastJusticeInitialized = line.trim();
    }
  }
  return {
    failedToLoadPluginCount,
    lastFailedToLoadPlugin,
    justiceInitializedCount,
    lastJusticeInitialized,
  };
}
