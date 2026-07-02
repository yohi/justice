// src/core/v2/hash.ts
import { createHash } from "crypto";

/**
 * 与えられた文字列の SHA-256 ハッシュを計算し、プレフィックス "sha256:" を付与した文字列を返します。
 * 証拠保存時の決定論的なハッシュ生成に使用されます。
 */
export function hashString(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `sha256:${hash}`;
}
