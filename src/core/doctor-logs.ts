// src/core/doctor-logs.ts
//
// justice doctor のログ走査（設計書 §9.1 検査 3）の純粋関数。
// OpenCode ログを走査し `failed to load plugin` / `Justice initialized` の有無・回数・
// 直近行を報告する。

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
    if (line.includes("failed to load plugin")) {
      const pathMatch = /path=([^\s]+)/.exec(line);
      const pathValue = pathMatch?.[1] ?? "";
      if (pathValue.toLowerCase().includes("justice")) {
        failedToLoadPluginCount++;
        lastFailedToLoadPlugin = line.trim();
      }
    }
    if (line.includes("Justice initialized")) {
      justiceInitializedCount++;
      lastJusticeInitialized = line.trim();
    }
  }
  return {
    failedToLoadPluginCount,
    ...(lastFailedToLoadPlugin === undefined ? {} : { lastFailedToLoadPlugin }),
    justiceInitializedCount,
    ...(lastJusticeInitialized === undefined ? {} : { lastJusticeInitialized }),
  };
}
