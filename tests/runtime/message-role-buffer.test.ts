// tests/runtime/message-role-buffer.test.ts
import { describe, expect, it } from "vitest";
import { MessageRoleBuffer } from "../../src/runtime/message-role-buffer";
import { extractFinalizedAssistantClaims } from "../../src/core/v2/declared-claim-extractor";
import type { ObservationMessagePayload } from "../../src/core/v2/message-payload";

function partUpdated(
  sessionId: string,
  messageID: string,
  partID: string,
  text: string,
): ObservationMessagePayload {
  return { kind: "message_part_updated", sessionId, messageID, partID, text };
}

function textComplete(
  sessionId: string,
  messageID: string,
  partID: string,
  text: string,
): ObservationMessagePayload {
  return { kind: "text_complete", sessionId, messageID, partID, text };
}

function messageUpdated(
  sessionId: string,
  messageID: string,
  finalized: boolean,
): ObservationMessagePayload {
  return { kind: "message_updated", sessionId, messageID, role: "assistant", finalized };
}

function makeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
  };
}

describe("MessageRoleBuffer", () => {
  describe("role gating in extractAssistantClaims", () => {
    it("returns [] when role is unset (no message_updated seen yet)", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "tests pass"));
      expect(buffer.extractAssistantClaims("s", "m")).toEqual([]);
    });

    it("returns claims once role is assistant (finalized not required for preview)", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "tests pass"));
      buffer.update("s", messageUpdated("s", "m", false));
      const claims = buffer.extractAssistantClaims("s", "m");
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ claimKind: "test", outcome: "pass" });
    });

    it("returns [] for an unknown message", () => {
      const buffer = new MessageRoleBuffer();
      expect(buffer.extractAssistantClaims("s", "missing")).toEqual([]);
    });
  });

  describe("D67 dedup: a re-updated partID replaces the prior claim", () => {
    it("pass -> fail flip on the same partID yields only the latest (fail) claim", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", messageUpdated("s", "m", false)); // role assistant
      buffer.update("s", partUpdated("s", "m", "p1", "tests pass"));
      buffer.update("s", partUpdated("s", "m", "p1", "tests fail")); // overwrite same part
      buffer.update("s", messageUpdated("s", "m", true)); // finalize signal

      const claims = buffer.extractAssistantClaims("s", "m");
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ claimKind: "test", outcome: "fail" });
      expect(claims.some((c) => c.outcome === "pass")).toBe(false);
    });

    it("fail -> pass flip on the same partID yields only the latest (pass) claim", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", messageUpdated("s", "m", false));
      buffer.update("s", partUpdated("s", "m", "p1", "tests fail"));
      buffer.update("s", partUpdated("s", "m", "p1", "tests pass"));
      const claims = buffer.extractAssistantClaims("s", "m");
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ claimKind: "test", outcome: "pass" });
    });
  });

  describe("finalized text retrieval", () => {
    it("getFinalizedAssistantText returns the body even when there are no declared claims", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", textComplete("s", "m", "p1", "Hello there, all good."));
      buffer.update("s", messageUpdated("s", "m", true)); // complete signal; part completed via text_complete
      expect(buffer.extractAssistantClaims("s", "m")).toEqual([]);
      expect(buffer.getFinalizedAssistantText("s", "m")).toBe("Hello there, all good.");
    });

    it("getFinalizedText returns undefined before the message is finalized", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "body"));
      expect(buffer.getFinalizedText("s", "m")).toBeUndefined();
    });

    it("text_complete finalizes a complete message", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", textComplete("s", "m", "p1", "chunk"));
      expect(buffer.getFinalizedText("s", "m", "p1")).toBe("chunk");
      expect(buffer.getFinalizedText("s", "m")).toBe("chunk");
    });

    it("getFinalizedAssistantText returns undefined when role is not assistant", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", textComplete("s", "m", "p1", "chunk")); // role stays unset
      expect(buffer.getFinalizedText("s", "m", "p1")).toBe("chunk"); // role-agnostic
      expect(buffer.getFinalizedAssistantText("s", "m", "p1")).toBeUndefined();
    });
  });

  describe("finalize()", () => {
    it("without partId marks the whole message finalized", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "body a"));
      buffer.update("s", messageUpdated("s", "m", false)); // assistant, not finalized
      expect(buffer.getFinalizedAssistantText("s", "m")).toBeUndefined();
      buffer.finalize("s", "m");
      expect(buffer.getFinalizedAssistantText("s", "m")).toBe("body a");
    });

    it("per-partId finalize does NOT finalize the message without a message_updated signal", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "a"));
      buffer.update("s", partUpdated("s", "m", "p2", "b"));
      buffer.finalize("s", "m", "p1");
      expect(buffer.getFinalizedText("s", "m")).toBeUndefined(); // p2 still pending
      buffer.finalize("s", "m", "p2");
      // all parts finalized, but no message_updated finalized signal -> message NOT finalized
      expect(buffer.getFinalizedText("s", "m")).toBeUndefined();
    });

    it("per-partId finalize completes the message once all parts finalized AND message_updated finalized arrived", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "a"));
      buffer.update("s", partUpdated("s", "m", "p2", "b"));
      buffer.update("s", messageUpdated("s", "m", true)); // message-level finalized signal
      buffer.finalize("s", "m", "p1");
      buffer.finalize("s", "m", "p2");
      // both signals present -> message finalized, combined body in partID order
      expect(buffer.getFinalizedText("s", "m")).toBe("a\nb");
    });
  });

  describe("two-signal readiness ordering (signal vs part completion)", () => {
    it("message_updated finalized=true does NOT finalize while a part is still unfinalized (signal-first)", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "partial body")); // p1 NOT finalized
      buffer.update("s", messageUpdated("s", "m", true)); // complete signal arrives first
      // signal alone must not expose a partial body
      expect(buffer.getFinalizedText("s", "m")).toBeUndefined();
      expect(buffer.getFinalizedAssistantText("s", "m")).toBeUndefined();
    });

    it("finalizes once the lagging part completes AFTER the message signal (signal-first, then text_complete)", () => {
      const buffer = new MessageRoleBuffer();
      buffer.update("s", partUpdated("s", "m", "p1", "draft")); // p1 NOT finalized
      buffer.update("s", messageUpdated("s", "m", true)); // complete signal first -> still not ready
      expect(buffer.getFinalizedText("s", "m")).toBeUndefined();
      buffer.update("s", textComplete("s", "m", "p1", "final body")); // lagging part completes -> ready
      expect(buffer.getFinalizedText("s", "m")).toBe("final body");
      expect(buffer.getFinalizedAssistantText("s", "m")).toBe("final body");
    });
  });

  describe("gc()", () => {
    it("evicts entries older than maxAgeMs", () => {
      const clock = makeClock(0);
      const buffer = new MessageRoleBuffer(clock.now);
      buffer.update("sa", partUpdated("sa", "ma", "p1", "a"));
      buffer.finalize("sa", "ma");
      clock.advance(100);
      buffer.update("sb", partUpdated("sb", "mb", "p1", "b"));
      buffer.finalize("sb", "mb");

      buffer.gc(50, 1000); // now=100: sa aged 100 (>50) evicted, sb aged 0 kept
      expect(buffer.getFinalizedText("sa", "ma")).toBeUndefined();
      expect(buffer.getFinalizedText("sb", "mb")).toBe("b");
    });

    it("evicts the oldest entries when over maxEntries", () => {
      const clock = makeClock(0);
      const buffer = new MessageRoleBuffer(clock.now);
      buffer.update("sa", partUpdated("sa", "ma", "p1", "a"));
      buffer.finalize("sa", "ma");
      clock.advance(1);
      buffer.update("sb", partUpdated("sb", "mb", "p1", "b"));
      buffer.finalize("sb", "mb");
      clock.advance(1);
      buffer.update("sc", partUpdated("sc", "mc", "p1", "c"));
      buffer.finalize("sc", "mc");

      buffer.gc(1_000_000, 2); // no age eviction; drop oldest (sa) to fit 2
      expect(buffer.getFinalizedText("sa", "ma")).toBeUndefined();
      expect(buffer.getFinalizedText("sb", "mb")).toBe("b");
      expect(buffer.getFinalizedText("sc", "mc")).toBe("c");
    });
  });
});

describe("extractFinalizedAssistantClaims (pure)", () => {
  it("returns claims for a finalized assistant message", () => {
    const claims = extractFinalizedAssistantClaims("src1", {
      role: "assistant",
      finalized: true,
      text: "tests pass",
    });
    expect(claims).toEqual([{ evidenceId: "src1-test", claimKind: "test", outcome: "pass" }]);
  });

  it("returns [] when the message is not finalized", () => {
    expect(
      extractFinalizedAssistantClaims("src1", {
        role: "assistant",
        finalized: false,
        text: "tests pass",
      }),
    ).toEqual([]);
  });

  it("returns [] for a user-role message", () => {
    expect(
      extractFinalizedAssistantClaims("src1", {
        role: "user",
        finalized: true,
        text: "tests pass",
      }),
    ).toEqual([]);
  });

  it("returns [] when role is undefined", () => {
    expect(
      extractFinalizedAssistantClaims("src1", { finalized: true, text: "tests pass" }),
    ).toEqual([]);
  });

  it("returns [] for a finalized assistant message with no claim keywords", () => {
    expect(
      extractFinalizedAssistantClaims("src1", {
        role: "assistant",
        finalized: true,
        text: "all good here",
      }),
    ).toEqual([]);
  });

  describe("regression: finalized monotonic latch bug (D53 fix)", () => {
    it("text_complete(p1) finalizes -> new unfinalizedpart p2 arrives -> getFinalizedText returns undefined until p2 completes", () => {
      const buffer = new MessageRoleBuffer();
      // Step 1: p1 completes via text_complete -> message becomes finalized
      buffer.update("s", textComplete("s", "m", "p1", "part one"));
      expect(buffer.getFinalizedText("s", "m")).toBe("part one");
      expect(buffer.getFinalizedAssistantText("s", "m")).toBeUndefined(); // role not set yet
      
      // Step 2: new unfinalizedpart p2 arrives via message_part_updated
      buffer.update("s", messageUpdated("s", "m", false)); // set role to assistant
      buffer.update("s", partUpdated("s", "m", "p2", "part two (draft)"));
      // BUG: old code would still return "part one" because finalized was latched to true
      // FIXED: now returns undefined because isFinalized() re-evaluates and finds p2 unfinalized
      expect(buffer.getFinalizedText("s", "m")).toBeUndefined();
      expect(buffer.getFinalizedAssistantText("s", "m")).toBeUndefined();
      
      // Step 3: p2 completes via text_complete
      buffer.update("s", textComplete("s", "m", "p2", "part two (final)"));
      // Now both parts are finalized and message signal is set -> full text available
      expect(buffer.getFinalizedText("s", "m")).toBe("part one\npart two (final)");
      expect(buffer.getFinalizedAssistantText("s", "m")).toBe("part one\npart two (final)");
    });
  });
});
