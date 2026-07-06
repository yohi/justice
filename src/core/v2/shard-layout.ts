// src/core/v2/shard-layout.ts
import type { ShardId } from "../types";
import { encodeSafeSegment } from "./safe-segment";
import { isSafeWriterId } from "./writer-id-validation";

export function toPhysicalPath(shardId: ShardId): string {
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toPhysicalPath: unsafe writerId: ${shardId.writerId}`);
  }
  return `.justice/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.jsonl`;
}

export function toArchivePath(shardId: ShardId, timestamp: string): string {
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toArchivePath: unsafe writerId: ${shardId.writerId}`);
  }
  return `.justice/archive/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.${timestamp}.jsonl`;
}
