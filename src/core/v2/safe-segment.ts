// src/core/v2/safe-segment.ts
import { createHash } from "node:crypto";

export function encodeSafeSegment(segment: string): string {
  const hash = createHash("sha256").update(segment).digest("hex").slice(0, 8);
  if (segment === ".") return `_dot___${hash}`;
  if (segment === "..") return `_dotdot___${hash}`;
  if (segment === "") return `_empty___${hash}`;
  const safe = segment
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 64);
  return `${safe}__${hash}`;
}
