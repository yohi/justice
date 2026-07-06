// src/core/v2/writer-id-validation.ts
const WRITER_ID_RE = /^w-[A-Za-z0-9-]+$/;

export function isSafeWriterId(id: string): boolean {
  return WRITER_ID_RE.test(id) && id !== "w-system";
}
