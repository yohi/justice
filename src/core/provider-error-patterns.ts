// Source: oh-my-openagent@3.17.4
//   src/hooks/runtime-fallback/constants.ts (RETRYABLE_ERROR_PATTERNS)
//   src/hooks/runtime-fallback/error-classifier.ts (classifyErrorType)

export const PROVIDER_TRANSIENT_PATTERNS: readonly RegExp[] = Object.freeze([
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota\s+will\s+reset\s+after/i,
  /quota.?exceeded/i,
  /exhausted\s+your\s+capacity/i,
  /all\s+credentials\s+for\s+model/i,
  /cool(?:ing)?\s+down/i,
  /service.?unavailable/i,
  /overloaded/i,
  /temporarily.?unavailable/i,
  /\b429\b/,
  /\b503\b/,
  /\b529\b/,
  /retrying\s+in/i,
  /payment.?required/i,
  /usage\s+limit/i,
  /out\s+of\s+credits?/i,
]);

export const PROVIDER_CONFIG_PATTERNS: readonly RegExp[] = Object.freeze([
  /api.?key.?is.?missing/i,
  /api.?key.*?must be a string/i,
  /model.{0,20}?not.{0,10}?supported/i,
  /model\s+not\s+found/i,
  /providerModelNotFoundError/i,
  /AI_LoadAPIKeyError/i,
  /missing.{0,10}?api.{0,10}?key/i,
]);
