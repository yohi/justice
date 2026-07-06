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
  const candidate = generateWriterId();
  const physicalPath = toPhysicalPath({ ...shardWithoutWriterId, writerId: candidate });
  if (await fileReader.fileExists(physicalPath)) {
    return await allocateWriterId(fileReader, shardWithoutWriterId);
  }
  return candidate;
}
