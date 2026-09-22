export type CapturedReviewKind = "task-review" | "final-review";
export type CapturedRuntimeCategory = "sp-review" | "sp-final-review";

export type CapturedRuntimeEvent =
  | {
      readonly kind: "tool.execute.before";
      readonly input: {
        readonly tool: string;
        readonly sessionID: string;
        readonly callID: string;
      };
      readonly output: { readonly args: Record<string, unknown> };
    }
  | {
      readonly kind: "tool.execute.after";
      readonly input: {
        readonly tool: string;
        readonly sessionID: string;
        readonly callID: string;
        readonly args: Record<string, unknown>;
      };
      readonly output: {
        readonly output: string;
        readonly metadata: Record<string, unknown>;
      };
    }
  | {
      readonly kind: "event";
      readonly event: {
        readonly id: string;
        readonly type: string;
        readonly properties: Record<string, unknown>;
      };
    };

export function capturedRuntimeEvents(
  category: CapturedRuntimeCategory,
  parentCallId: string,
  childSessionId: string,
): readonly CapturedRuntimeEvent[] {
  if (parentCallId.trim().length === 0 || childSessionId.trim().length === 0) {
    throw new Error("captured runtime relation requires parent call and child session IDs");
  }

  const parentSessionId = "parent-session";
  const toolInput = { description: "review", subagent_type: category };
  const before = {
    kind: "tool.execute.before" as const,
    input: { tool: "task", sessionID: parentSessionId, callID: parentCallId },
    output: { args: toolInput },
  };
  const sessionCreated = {
    kind: "event" as const,
    event: {
      id: `runtime-event-${category}`,
      type: "session.created",
      properties: { info: { id: childSessionId, parentID: parentSessionId } },
    },
  };
  const after = {
    kind: "tool.execute.after" as const,
    input: {
      tool: "task",
      sessionID: parentSessionId,
      callID: parentCallId,
      args: toolInput,
    },
    output: {
      output: `<task id="${childSessionId}" state="completed">`,
      metadata: { sessionId: childSessionId, parentSessionId },
    },
  };

  return [before, sessionCreated, after];
}
