// tests/core/v2/message-payload.test.ts
import { describe, expect, it } from "vitest";
import type { ObservationMessagePayload } from "../../../src/core/v2/message-payload";

describe("ObservationMessagePayload type", () => {
  it("message_part_updated variant is assignable and discriminates on kind", () => {
    const p: ObservationMessagePayload = {
      kind: "message_part_updated",
      sessionId: "ses_1",
      messageID: "msg-1",
      partID: "part-1",
      text: "hello",
    };
    expect(p.kind).toBe("message_part_updated");
  });

  it("message_updated variant is assignable and discriminates on kind", () => {
    const p: ObservationMessagePayload = {
      kind: "message_updated",
      sessionId: "ses_1",
      messageID: "msg-1",
      role: "assistant",
      finalized: true,
    };
    expect(p.kind).toBe("message_updated");
  });

  it("text_complete variant is assignable and discriminates on kind", () => {
    const p: ObservationMessagePayload = {
      kind: "text_complete",
      sessionId: "ses_1",
      messageID: "msg-1",
      partID: "part-1",
      text: "done",
    };
    expect(p.kind).toBe("text_complete");
  });
});
