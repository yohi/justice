// src/runtime/writer-id.ts
import { randomUUID } from "node:crypto";
import type { FileReader, ShardId } from "../core/types";
import { toPhysicalPath } from "../core/v2/shard-layout";

export function generateWriterId(): string {
  return `w-${randomUUID()}`;
}

export async function allocateWriterId(
  fileReader: FileReader,
  shardWithoutWriterId: Omit<ShardId, "writerId">,
): Promise<string> {
  const MAX_ATTEMPTS = 100;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateWriterId();
    const physicalPath = toPhysicalPath({ ...shardWithoutWriterId, writerId: candidate });
    if (!(await fileReader.fileExists(physicalPath))) {
      return candidate;
    }
  }
  throw new Error(
    `allocateWriterId: failed to allocate a unique writerId after ${MAX_ATTEMPTS} attempts`,
  );
}
