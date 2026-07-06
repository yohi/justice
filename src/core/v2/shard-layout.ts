// src/core/v2/shard-layout.ts
import type { ShardId } from "../types";
import { encodeSafeSegment } from "./safe-segment";
import { isSafeWriterId } from "./writer-id-validation";
import { isSafeObservationAgentId } from "./observation-agent-id-validation";

export function toPhysicalPath(shardId: ShardId): string {
  if (!isSafeObservationAgentId(shardId.agentId)) {
    throw new Error(`toPhysicalPath: unsafe agentId: ${shardId.agentId}`);
  }
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toPhysicalPath: unsafe writerId: ${shardId.writerId}`);
  }
  return `.justice/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.jsonl`;
}

const TIMESTAMP_RE = /^[A-Za-z0-9]+$/;

export function toArchivePath(shardId: ShardId, timestamp: string): string {
  if (!isSafeObservationAgentId(shardId.agentId)) {
    throw new Error(`toArchivePath: unsafe agentId: ${shardId.agentId}`);
  }
  if (!isSafeWriterId(shardId.writerId)) {
    throw new Error(`toArchivePath: unsafe writerId: ${shardId.writerId}`);
  }
  if (!TIMESTAMP_RE.test(timestamp)) {
    throw new Error(`toArchivePath: unsafe timestamp: ${timestamp}`);
  }
  return `.justice/archive/events/${shardId.agentId}/${encodeSafeSegment(shardId.sessionId)}/${shardId.writerId}.${timestamp}.jsonl`;
}
