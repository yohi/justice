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

/**
 * Inverse of {@link toPhysicalPath}: parses a physical shard path back into its
 * identity components. Returns `null` (never throws) when `path` does not match
 * the `.justice/events/<agentId>/<encodedSessionId>/<writerId>.jsonl` layout so
 * callers can fail-open. The returned `safeSessionId` is the ENCODED segment
 * (encoding is one-way), not the original sessionId.
 */
export function fromPhysicalPath(
  path: string,
): { readonly agentId: string; readonly safeSessionId: string; readonly writerId: string } | null {
  const parts = path.split("/");
  if (parts.length !== 5) return null;
  const [root, events, agentId, safeSessionId, fileName] = parts;
  if (root !== ".justice" || events !== "events") return null;
  if (!agentId || !safeSessionId || !fileName || !fileName.endsWith(".jsonl")) return null;
  const writerId = fileName.slice(0, -".jsonl".length);
  if (!writerId) return null;
  return { agentId, safeSessionId, writerId };
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
