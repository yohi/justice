import type { HookResponse, InjectResponse } from "./types";

export type HookResponseConflictLogger = (message: string) => void;

export function mergePreToolUseResponses(
  a: HookResponse,
  b: HookResponse,
  onConflict?: HookResponseConflictLogger,
): HookResponse {
  if (a.action === "skip" || b.action === "skip") {
    return { action: "skip" };
  }

  if (a.action === "inject" && b.action === "inject") {
    const contexts = [a.injectedContext, b.injectedContext].filter((ctx) => ctx !== "");
    const base: InjectResponse = {
      action: "inject",
      injectedContext: contexts.join("\n\n---\n\n"),
    };
    const result: InjectResponse =
      a.variant === "gate_advisory" || b.variant === "gate_advisory"
        ? { ...base, variant: "gate_advisory" }
        : base;
    if (a.modifiedPayload !== undefined && b.modifiedPayload !== undefined) {
      onConflict?.("Conflict detected in pre-tool-use modifiedPayload; using the first response");
    }
    if (a.modifiedPayload !== undefined) {
      return { ...result, modifiedPayload: a.modifiedPayload };
    }
    if (b.modifiedPayload !== undefined) {
      return { ...result, modifiedPayload: b.modifiedPayload };
    }
    return result;
  }

  if (a.action === "inject") {
    return { ...a };
  }

  if (b.action === "inject") {
    return { ...b };
  }

  return { action: "proceed" };
}

export function mergePostToolUseResponses(
  responses: readonly HookResponse[],
  onConflict?: HookResponseConflictLogger,
): HookResponse {
  if (responses.some((response) => response.action === "skip")) {
    return { action: "skip" };
  }

  const injects = responses.filter(
    (response): response is InjectResponse => response.action === "inject",
  );
  if (injects.length === 0) {
    return { action: "proceed" };
  }

  const contexts = injects
    .map((inject) => inject.injectedContext)
    .filter((context) => context !== "");
  const normalContexts = injects
    .map((inject) =>
      inject.normalInjectedContext ??
      (inject.variant === "gate_advisory" ? "" : inject.injectedContext),
    )
    .filter((context) => context !== "");
  const gateContexts = injects
    .map((inject) =>
      inject.gateAdvisoryContext ??
      (inject.variant === "gate_advisory" ? inject.injectedContext : ""),
    )
    .filter((context) => context !== "");
  const base: InjectResponse = {
    action: "inject",
    injectedContext: contexts.join("\n\n---\n\n"),
  };
  const normalInjectedContext = normalContexts.join("\n\n---\n\n");
  const gateAdvisoryContext = gateContexts.join("\n\n---\n\n");
  const result: InjectResponse = {
    ...base,
    ...(normalInjectedContext.length === 0 ? {} : { normalInjectedContext }),
    ...(gateAdvisoryContext.length === 0 ? {} : { gateAdvisoryContext }),
    ...(gateAdvisoryContext.length === 0 ? {} : { variant: "gate_advisory" }),
  };

  const modifieds = injects.filter((inject) => inject.modifiedPayload !== undefined);
  if (modifieds.length > 1) {
    onConflict?.("Conflict detected in post-tool-use modifiedPayload; using the first response");
  }
  const single = modifieds[0];
  if (single !== undefined) {
    return { ...result, modifiedPayload: single.modifiedPayload };
  }
  return result;
}
