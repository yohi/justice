// src/core/v2/message-payload.ts
export type ObservationMessagePayload =
  | { readonly kind: "message_part_updated"; readonly sessionId: string; readonly messageID: string; readonly partID: string; readonly text: string }
  | { readonly kind: "message_updated"; readonly sessionId: string; readonly messageID: string; readonly role: "assistant"; readonly finalized: boolean }
  | { readonly kind: "text_complete"; readonly sessionId: string; readonly messageID: string; readonly partID: string; readonly text: string };
