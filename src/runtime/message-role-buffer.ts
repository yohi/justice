// src/runtime/message-role-buffer.ts
//
// RUNTIME layer: a mutable, in-memory accumulator for streaming assistant message
// parts. It lives OUT of src/core/** because it holds mutable state; the pure
// claim detection is delegated to src/core/v2 (FF-001 — core stays free of
// @opencode-ai and side effects). This class performs no I/O and never throws on
// missing keys, so callers can treat it as fail-open.
import type { ObservationMessagePayload } from "../core/v2/message-payload";
import { type DeclaredClaim, extractDeclaredClaims } from "../core/v2/declared-claim-extractor";

type BufferPart = {
  text: string;
  finalized: boolean;
};

type BufferEntry = {
  // "user" is currently unreachable via update(): ObservationMessagePayload's
  // message_updated variant only ever carries role: "assistant" (message-payload.ts);
  // user-role messages flow through a separate plan-bridge payload, not this buffer.
  // The union is kept broad to preserve the general role-correlation discard guard
  // (D53: role !== "assistant" => drop) in case a future payload variant widens role.
  role?: "assistant" | "user";
  readonly parts: Map<string, BufferPart>;
  lastUpdatedAt: number;
  messageSignaled: boolean; // raw: a message_updated(finalized=true) or text_complete has been observed
  forcedFinalized: boolean; // hard override flag: set only by finalize(sessionId, messageId) with no partId
};

export class MessageRoleBuffer {
  private readonly buffer = new Map<string, BufferEntry>();
  private readonly now: () => number;

  // The clock is injectable so gc() eviction is deterministically testable.
  constructor(now: () => number = (): number => Date.now()) {
    this.now = now;
  }

  update(sessionId: string, payload: ObservationMessagePayload): void {
    const entry = this.ensureEntry(this.keyOf(sessionId, payload.messageID));
    switch (payload.kind) {
      case "message_part_updated":
        // Re-updating an existing partID overwrites its text (D67): claims are
        // always re-derived from the latest state, never accumulated.
        entry.parts.set(payload.partID, { text: payload.text, finalized: false });
        break;
      case "text_complete":
        entry.parts.set(payload.partID, { text: payload.text, finalized: true });
        entry.messageSignaled = true;
        break;
      case "message_updated":
        entry.role = payload.role;
        if (payload.finalized) {
          // Soft fallback, not proof that every part's text is terminal:
          // `message.updated` and `experimental.text.complete` are dispatched
          // from unsynchronized SDK event sources (see opencode-adapter.ts), so
          // a currently-buffered part may still be mid-stream. A later
          // text_complete for the same partID can overwrite its text, causing
          // ObservationHandler to append a corrected audit revision under the
          // same (stable) evidenceId. Waiting for a real text_complete before
          // exposing text here would silently drop the message entirely when
          // text_complete never fires for some part (a documented Phase-0
          // uncertainty) -- and message-declared claims are non-authoritative
          // (audit visibility only, never gate evidence; see design spec §13/
          // INV-004), so this tradeoff is accepted rather than "fixed".
          for (const part of entry.parts.values()) part.finalized = true;
          entry.messageSignaled = true;
        }
        break;
    }
    entry.lastUpdatedAt = this.now();
  }

  finalize(sessionId: string, messageId: string, partId?: string): void {
    const entry = this.buffer.get(this.keyOf(sessionId, messageId));
    if (!entry) return;
    if (partId === undefined) {
      // Explicit whole-message finalize (hard override): complete every part and the
      // message directly, independent of prior signals.
      for (const part of entry.parts.values()) part.finalized = true;
      entry.messageSignaled = true;
      entry.forcedFinalized = true;
      entry.lastUpdatedAt = this.now();
      return;
    }
    const part = entry.parts.get(partId);
    if (part) part.finalized = true;
    entry.lastUpdatedAt = this.now();
  }

  extractAssistantClaims(sessionId: string, messageId: string, partId?: string): DeclaredClaim[] {
    const entry = this.buffer.get(this.keyOf(sessionId, messageId));
    if (entry?.role !== "assistant") return [];
    const text = this.collectText(entry, partId);
    if (text === undefined) return [];
    return extractDeclaredClaims(this.sourceIdOf(messageId, partId), text);
  }

  getFinalizedText(sessionId: string, messageId: string, partId?: string): string | undefined {
    const entry = this.buffer.get(this.keyOf(sessionId, messageId));
    if (!entry) return undefined;
    if (partId !== undefined) {
      const part = entry.parts.get(partId);
      return part?.finalized ? part.text : undefined;
    }
    if (!this.isFinalized(entry)) return undefined;
    return this.collectText(entry, undefined);
  }

  getFinalizedAssistantText(
    sessionId: string,
    messageId: string,
    partId?: string,
  ): string | undefined {
    const entry = this.buffer.get(this.keyOf(sessionId, messageId));
    if (entry?.role !== "assistant") return undefined;
    return this.getFinalizedText(sessionId, messageId, partId);
  }

  gc(maxAgeMs: number, maxEntries: number): void {
    const now = this.now();
    for (const [key, entry] of this.buffer) {
      if (now - entry.lastUpdatedAt > maxAgeMs) this.buffer.delete(key);
    }
    const overflow = this.buffer.size - maxEntries;
    if (overflow > 0) {
      const byAgeAsc = [...this.buffer.entries()].sort(
        (a, b): number => a[1].lastUpdatedAt - b[1].lastUpdatedAt,
      );
      for (const [key] of byAgeAsc.slice(0, overflow)) {
        this.buffer.delete(key);
      }
    }
  }

  removeSession(sessionId: string): void {
    const sessionKeyPrefix = `[${JSON.stringify(sessionId)},`;
    for (const key of this.buffer.keys()) {
      if (key.startsWith(sessionKeyPrefix)) this.buffer.delete(key);
    }
  }

  // Read-time derivation of readiness: the message becomes "finalized" (safe to read as a
  // complete body) only when BOTH the message-complete signal has arrived AND every part
  // is finalized, OR when forcedFinalized is set (hard override). Evaluated at read-time,
  // not cached, so new parts arriving after a partial finalization are correctly detected.
  private isFinalized(entry: BufferEntry): boolean {
    return entry.forcedFinalized || (entry.messageSignaled && this.allPartsFinalized(entry));
  }

  private ensureEntry(key: string): BufferEntry {
    const existing = this.buffer.get(key);
    if (existing) return existing;
    const created: BufferEntry = {
      parts: new Map<string, BufferPart>(),
      lastUpdatedAt: this.now(),
      messageSignaled: false,
      forcedFinalized: false,
    };
    this.buffer.set(key, created);
    return created;
  }

  private allPartsFinalized(entry: BufferEntry): boolean {
    if (entry.parts.size === 0) return false;
    for (const part of entry.parts.values()) {
      if (!part.finalized) return false;
    }
    return true;
  }

  // Resolves the text to scan: a single part when partId is given, otherwise all
  // parts concatenated in partID order (newline-joined so word boundaries survive).
  private collectText(entry: BufferEntry, partId: string | undefined): string | undefined {
    if (partId !== undefined) {
      return entry.parts.get(partId)?.text;
    }
    // Plain lexicographic comparison is intentionally correct here: OpenCode generates
    // partIDs via Identifier.ascending("part", ...) as a fixed-width, monotonically
    // increasing string (prt_<hex timestamp+counter><base62 random>), so string order
    // equals arrival order by design. Do NOT switch to numeric-aware collation (e.g.
    // localeCompare with { numeric: true }) — it would reinterpret embedded hex/base62
    // digit runs as numbers and could misorder parts instead of fixing anything.
    const ordered = [...entry.parts.entries()].sort((a, b): number => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });
    return ordered.map(([, part]): string => part.text).join("\n");
  }

  private keyOf(sessionId: string, messageId: string): string {
    // JSON-encoded tuple avoids delimiter collisions (e.g. ":") between differing
    // (sessionId, messageId) pairs if either ID's format ever changes.
    return JSON.stringify([sessionId, messageId]);
  }

  // Stable per-(message, part) identity across revisions: a re-updated part
  // keeps the same evidenceId so the buffer's CURRENT view never accumulates
  // stale claims for that identity. This is append-only-log-agnostic: the
  // observation log itself may still contain multiple historical revisions
  // under this evidenceId (see the message_updated soft-finalize comment in
  // update()); a consumer that needs a single current-view claim must
  // collapse revisions latest-by-evidenceId itself.
  private sourceIdOf(messageId: string, partId: string | undefined): string {
    // JSON-encoded tuple avoids delimiter collisions (e.g. ":") between differing
    // (messageId, partId) pairs if either ID's format ever changes.
    return partId !== undefined ? JSON.stringify([messageId, partId]) : messageId;
  }
}
