/**
 * DEBUG=justice:* または DEBUG=justice:sub-task 等が設定されている場合に
 * デバッグログを有効化するためのユーティリティ。
 * 指摘に基づき、正規表現を拡張してハイフンや数字も許可するようにした。
 */
export function isDebugEnabled(): boolean {
  try {
    const debug = process.env.DEBUG ?? "";
    // \bjustice(?::\*|:[a-z0-9_-]+)?\b
    // - justice (単独)
    // - justice:* (ワイルドカード)
    // - justice:something-123 (ハイフンや数字を含むサブカテゴリ)
    // にマッチする。
    // eslint-disable-next-line security/detect-unsafe-regex
    return /\bjustice(?::\*|:[a-z0-9_-]+)?\b/.test(debug);
  } catch {
    return false;
  }
}

/**
 * 指定されたメッセージと引数をデバッグログとして出力する。
 * isDebugEnabled() が true の場合のみ console.warn で出力される。
 */
export function debugLog(message: string, ...args: unknown[]): void {
  if (isDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.warn(`[Justice:debug] ${message}`, ...args);
  }
}
