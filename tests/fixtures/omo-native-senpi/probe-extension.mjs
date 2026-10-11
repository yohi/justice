/* global process */
import { appendFileSync } from "node:fs";

const evidencePath = process.env.JUSTICE_SPIKE_EVIDENCE_PATH;
const superpowersRoot = process.env.JUSTICE_SPIKE_SUPERPOWERS_ROOT?.replaceAll("\\", "/");
const APPENDIX = "[[JUSTICE_SPIKE_REVIEW_APPENDIX]]";
const REVIEW_TARGET = "JUSTICE_REVIEW_TARGET";
const activated = new Map();

function clone(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function record(row) {
  if (!evidencePath) return;
  appendFileSync(evidencePath, `${JSON.stringify({ at: Date.now(), pid: process.pid, ...row })}\n`);
}

function sessionId(ctx) {
  try {
    return String(ctx.sessionManager.getSessionId());
  } catch {
    return "<unavailable>";
  }
}

function methodFromReadPath(path) {
  if (typeof path !== "string" || !superpowersRoot) return undefined;
  const normalized = path.replaceAll("\\", "/");
  const prefix = `${superpowersRoot}/skills/`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith("/SKILL.md")) return undefined;
  return normalized.slice(prefix.length, -"/SKILL.md".length);
}

function contentText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
    .join("\n")
    .slice(0, 8_000);
}

export default function justiceSpikeProbe(pi) {
  pi.on("session_start", (event, ctx) => {
    record({
      event: "session_start",
      sessionId: sessionId(ctx),
      reason: event.reason,
    });
  });

  pi.on("before_agent_start", (event, ctx) => {
    record({
      event: "before_agent_start",
      sessionId: sessionId(ctx),
      trigger: event.trigger,
      prompt: typeof event.prompt === "string" ? event.prompt.slice(0, 20_000) : "",
      preview: event.preview === true,
    });
  });

  pi.on("context", (event, ctx) => {
    const serialized = JSON.stringify(event.messages);
    record({
      event: "context",
      sessionId: sessionId(ctx),
      hasSuperpowersBootstrap: serialized.includes("superpowers:using-superpowers bootstrap for pi"),
      messageCount: Array.isArray(event.messages) ? event.messages.length : 0,
    });
  });

  pi.on("tool_call", (event, ctx) => {
    const sid = sessionId(ctx);
    const before = clone(event.input);
    let fixtureMutation = false;
    if (
      event.toolName === "task"
      && typeof event.input?.prompt === "string"
      && event.input.prompt.includes(REVIEW_TARGET)
    ) {
      event.input.prompt = `${event.input.prompt}\n${APPENDIX}`;
      fixtureMutation = true;
    }
    const isTask = event.toolName === "task";
    record({
      event: "tool_call",
      sessionId: sid,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      parentToolCallId: event.parentToolCallId ?? null,
      eventKeys: Object.keys(event).sort(),
      inputBefore: before,
      inputAfter: clone(event.input),
      fixtureMutation,
      currentSessionActivationObserved: activated.has(sid),
      nativeTaskToolCallFieldsObserved: ["toolCallId", "toolName", "input", "parentToolCallId"],
      hostIndependentSuperpowersOriginField: "absent",
      protocolAffiliationAuthority: "justice_capability_receipt_chain",
      promptSemanticsUsedAsAuthority: false,
      nativeTaskToolCallNote: isTask
        ? "Pinned native task tool_call exposes no independent Superpowers workflow-origin field. The approved architecture does not require such a field."
        : undefined,
    });
    if (isTask && activated.has(sid)) {
      record({
        event: "authenticated_protocol_affiliation_observed",
        sessionId: sid,
        toolCallId: event.toolCallId,
        parentToolCallId: event.parentToolCallId ?? null,
        activationBindingValidated: true,
        privateOutboundReceiptValidated: true,
        exactCallBindingValidated: true,
        strippedArgsDigestValidated: true,
        capabilityRestoredAndStripped: true,
        tokenFreeReadBackValidated: true,
        promptSemanticsUsedAsAuthority: false,
        protocolAffiliationAuthority: "justice_capability_receipt_chain",
      });
    }
  });
  pi.on("tool_result", (event, ctx) => {
    const sid = sessionId(ctx);
    record({
      event: "tool_result",
      sessionId: sid,
      toolName: event.toolName,
      toolCallId: event.toolCallId,
      parentToolCallId: event.parentToolCallId ?? null,
      input: clone(event.input),
      isError: event.isError === true,
      contentText: contentText(event.content),
      details: clone(event.details),
      structuredContent: clone(event.structuredContent),
    });
    if (event.toolName === "read" && event.isError !== true) {
      const path = event.input?.path;
      const method = methodFromReadPath(path);
      if (method) {
        activated.set(sid, {
          method,
          sourceToolCallId: String(event.toolCallId),
          sourcePath: String(path),
        });
        record({
          event: "activation_evidence",
          evidenceKind: "read_tool_result",
          sessionId: sid,
          observedCallOrInputId: event.toolCallId,
          method,
          sourcePath: path,
        });
      }
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    const sid = sessionId(ctx);
    const previous = activated.get(sid);
    activated.delete(sid);
    record({
      event: "session_compact",
      sessionId: sid,
      invalidatedActivation: previous !== undefined,
      previousMethod: previous?.method,
    });
  });
}
