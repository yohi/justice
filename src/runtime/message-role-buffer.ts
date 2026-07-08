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
  role?: "assistant" | "user";
  readonly parts: Map<string, BufferPart>;
  lastUpdatedAt: number;
  messageSignaled: boolean; // raw: a message_updated(finalized=true) has been observed
  finalized: boolean; // DERIVED readiness: messageSignaled && all parts finalized
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
        break;
      case "message_updated":
        entry.role = payload.role;
        // Raw completion signal only (monotonic). Readiness is DERIVED in tryFinalize so a
        // signal arriving before a lagging part never exposes a partial body.
        if (payload.finalized) entry.messageSignaled = true;
        break;
    }
    this.tryFinalize(entry);
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
      entry.finalized = true;
      return;
    }
    const part = entry.parts.get(partId);
    if (part) part.finalized = true;
    // Two-signal completion (brief Step 2): completing the last part AFTER the message
    // signal has arrived promotes readiness; parts finalizing alone never do.
    this.tryFinalize(entry);
  }

  extractAssistantClaims(sessionId: string, messageId: string, partId?: string): DeclaredClaim[] {
    const entry = this.buffer.get(this.keyOf(sessionId, messageId));
    if (!entry || entry.role !== "assistant") return [];
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
    if (!entry.finalized) return undefined;
    return this.collectText(entry, undefined);
  }

  getFinalizedAssistantText(
    sessionId: string,
    messageId: string,
    partId?: string,
  ): string | undefined {
    const entry = this.buffer.get(this.keyOf(sessionId, messageId));
    if (!entry || entry.role !== "assistant") return undefined;
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

  // Latching derivation of readiness: the message becomes "finalized" (safe to read as a
  // complete body) only when BOTH the message-complete signal has arrived AND every part
  // is finalized. Only ever sets true, preserving monotonicity.
  private tryFinalize(entry: BufferEntry): void {
    if (entry.messageSignaled && this.allPartsFinalized(entry)) entry.finalized = true;
  }

  private ensureEntry(key: string): BufferEntry {
    const existing = this.buffer.get(key);
    if (existing) return existing;
    const created: BufferEntry = {
      parts: new Map<string, BufferPart>(),
      lastUpdatedAt: this.now(),
      messageSignaled: false,
      finalized: false,
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
    const ordered = [...entry.parts.entries()].sort((a, b): number =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    );
    return ordered.map(([, part]): string => part.text).join("\n");
  }

  private keyOf(sessionId: string, messageId: string): string {
    return `${sessionId}:${messageId}`;
  }

  // Stable per-(message, part) evidence source so a re-updated part keeps the same
  // evidenceId, letting the latest claim replace (not duplicate) the prior one.
  private sourceIdOf(messageId: string, partId: string | undefined): string {
    return partId !== undefined ? `${messageId}:${partId}` : messageId;
  }
}
