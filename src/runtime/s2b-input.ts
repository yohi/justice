// S2-b saved OpenCode v2.2.5 input validation (offline, READ_ONLY, no I/O).
//
// Parsing order (plan §「実装の内部読み取り契約」):
//   1. bounded read + strict UTF-8, lexical byte scan that locates raw Response spans [start,end)
//   2. strict parse of the wrapper with every Response span replaced by `null` (never the original text)
//   3. global metadata / identity / filter / limit checks across all pages before any prefix decision
//   4. independent parseStrictJson() per required Session GET response
//   5. independent parseStrictJson() per Message page response, in page order
//   6. independent parseStrictJson() for the optional Diff response (Diff-only UNAVAILABLE on failure)
import { isSafeIdentifier } from "../core/s1a/contract.js";
import { parseStrictJson } from "../core/s1a/strict-json.js";
import {
  S2B_CORRELATION_SCHEMA_VERSION,
  S2B_LIMITS,
  S2B_SOURCE_SCHEMA_VERSION,
  S2B_SUPPORTED_HOST_VERSION,
  type CorrelationBinding,
  type CorrelationResult,
  type DiagnosticCode,
  type S2bDiagnostic,
  type SourceResult,
} from "./s2b-contract.js";

type JsonRecord = Readonly<Record<string, unknown>>;
type Span = Readonly<{ start: number; end: number }>;

export const DIAGNOSTIC_ORDER: readonly DiagnosticCode[] = [
  "SOURCE_VERSION_UNSUPPORTED", "SOURCE_SCHEMA_INVALID", "SOURCE_IDENTITY_MISMATCH",
  "UNSUPPORTED_FILTERED_COLLECTION", "PAGINATION_INCOMPLETE", "CONFLICT",
  "FOREIGN_TASK_EXCLUDED", "UNMAPPED", "MISSING_MESSAGE", "MISSING_TOOL",
  "NOT_ASSISTANT_MESSAGE", "CORRELATION_MISMATCH", "DIFF_UNAVAILABLE",
  "EVIDENCE_LIMIT_EXCEEDED", "INPUT_LIMIT_EXCEEDED",
];

class Rejection extends Error {
  constructor(readonly code: DiagnosticCode) {
    super(code);
  }
}
const reject = (code: DiagnosticCode): never => {
  throw new Rejection(code);
};
const rejected = (code: DiagnosticCode): Readonly<{ state: "REJECTED"; diagnostics: readonly S2bDiagnostic[] }> =>
  Object.freeze({ state: "REJECTED" as const, diagnostics: Object.freeze([Object.freeze({ code, count: 1 })]) });

function freezeDiagnostics(counts: ReadonlyMap<DiagnosticCode, number>): readonly S2bDiagnostic[] {
  return Object.freeze(
    DIAGNOSTIC_ORDER.filter((code) => (counts.get(code) ?? 0) > 0).map((code) => Object.freeze({ code, count: counts.get(code) ?? 0 })),
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Generic shape helpers
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is JsonRecord => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isMillis = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isOptional = (record: JsonRecord, key: string, check: (v: unknown) => boolean): boolean =>
  !Object.hasOwn(record, key) || check(record[key]);
const hasOnlyKeys = (record: JsonRecord, allowed: ReadonlySet<string>): boolean => Object.keys(record).every((k) => allowed.has(k));
const hasKeys = (record: JsonRecord, required: readonly string[]): boolean => required.every((k) => Object.hasOwn(record, k));
const isLiteral = (allowed: readonly string[]) => (v: unknown): boolean => typeof v === "string" && allowed.includes(v);
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const isRfc3339 = (v: unknown): v is string => typeof v === "string" && RFC3339.test(v) && !Number.isNaN(Date.parse(v));
export const isSessionId = (v: unknown): v is string => typeof v === "string" && /^ses[A-Za-z0-9_-]{1,252}$/.test(v);
export const isMessageId = (v: unknown): v is string => typeof v === "string" && /^msg_[\x21-\x7e]{1,252}$/.test(v);
const isOutcome = isLiteral(["succeeded", "failed", "interrupted"]);

// ---------------------------------------------------------------------------
// Stage 1: lexical byte scan of the wrapper (locates Response spans only)
// ---------------------------------------------------------------------------

type ResponseSpans = {
  session: Span[];
  sessionAfter: Span[];
  pages: Map<number, Span[]>;
  diff: Span[];
};

const QUOTE = 0x22, BACKSLASH = 0x5c, LBRACE = 0x7b, RBRACE = 0x7d, LBRACKET = 0x5b, RBRACKET = 0x5d, COLON = 0x3a, COMMA = 0x2c;
const isJsonWs = (c: number | undefined): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
// Characters that may appear in a bare JSON token (number/true/false/null).
const isBareTokenByte = (c: number | undefined): boolean =>
  c !== undefined && ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x2b || c === 0x2d || c === 0x2e);

class WrapperScanner {
  private i = 0;
  private readonly keyDecoder = new TextDecoder("utf-8", { fatal: true });
  readonly spans: ResponseSpans = { session: [], sessionAfter: [], pages: new Map(), diff: [] };

  constructor(private readonly b: Uint8Array) {}

  scan(): ResponseSpans {
    this.ws();
    this.object((key) => {
      if (key === "session" || key === "sessionAfter" || key === "diff") {
        const target = this.spans[key];
        if (this.peek() === LBRACE) this.object((inner) => (inner === "response" ? target.push(this.skip()) : this.skip()));
        else this.skip();
      } else if (key === "messagePages" && this.peek() === LBRACKET) {
        this.array((index) => {
          if (this.peek() !== LBRACE) {
            this.skip();
            return;
          }
          this.object((inner) => {
            if (inner !== "response") {
              this.skip();
              return;
            }
            const list = this.spans.pages.get(index) ?? [];
            list.push(this.skip());
            this.spans.pages.set(index, list);
          });
        });
      } else {
        this.skip();
      }
    });
    this.ws();
    if (this.i !== this.b.length) reject("SOURCE_SCHEMA_INVALID");
    return this.spans;
  }

  private peek(): number | undefined {
    return this.b[this.i];
  }

  private ws(): void {
    while (isJsonWs(this.b[this.i])) this.i++;
  }

  private expect(c: number): void {
    if (this.b[this.i] !== c) reject("SOURCE_SCHEMA_INVALID");
    this.i++;
  }

  private stringEnd(): void {
    this.expect(QUOTE);
    for (;;) {
      const c = this.b[this.i];
      if (c === undefined) reject("SOURCE_SCHEMA_INVALID");
      if (c === BACKSLASH) {
        this.i += 2;
        continue;
      }
      this.i++;
      if (c === QUOTE) return;
    }
  }

  private key(): string {
    const start = this.i;
    this.stringEnd();
    try {
      const decoded: unknown = JSON.parse(this.keyDecoder.decode(this.b.subarray(start, this.i)));
      return isString(decoded) ? decoded : reject("SOURCE_SCHEMA_INVALID");
    } catch (error) {
      if (error instanceof Rejection) throw error;
      return reject("SOURCE_SCHEMA_INVALID");
    }
  }

  private object(member: (key: string) => void): void {
    this.expect(LBRACE);
    this.ws();
    if (this.peek() === RBRACE) {
      this.i++;
      return;
    }
    for (;;) {
      this.ws();
      const key = this.key();
      this.ws();
      this.expect(COLON);
      this.ws();
      member(key);
      this.ws();
      const delimiter = this.b[this.i++];
      if (delimiter === RBRACE) return;
      if (delimiter !== COMMA) reject("SOURCE_SCHEMA_INVALID");
    }
  }

  private array(element: (index: number) => void): void {
    this.expect(LBRACKET);
    this.ws();
    if (this.peek() === RBRACKET) {
      this.i++;
      return;
    }
    for (let index = 0; ; index++) {
      this.ws();
      element(index);
      this.ws();
      const delimiter = this.b[this.i++];
      if (delimiter === RBRACKET) return;
      if (delimiter !== COMMA) reject("SOURCE_SCHEMA_INVALID");
    }
  }

  /**
   * Lexically skip one value and return its raw span. Only string/escape/bracket balance is checked here;
   * grammar inside the value is left to the owning parse unit. Unbalanced or unterminated values make the
   * boundary unidentifiable and reject the whole wrapper (no prefix recovery).
   */
  private skip(): Span {
    const start = this.i;
    const c = this.b[this.i];
    if (c === QUOTE) {
      this.stringEnd();
    } else if (c === LBRACE || c === LBRACKET) {
      const closers: number[] = [];
      for (;;) {
        const d = this.b[this.i];
        if (d === undefined) reject("SOURCE_SCHEMA_INVALID");
        if (d === QUOTE) {
          this.stringEnd();
          continue;
        }
        this.i++;
        if (d === LBRACE) closers.push(RBRACE);
        else if (d === LBRACKET) closers.push(RBRACKET);
        else if (d === RBRACE || d === RBRACKET) {
          if (closers.pop() !== d) reject("SOURCE_SCHEMA_INVALID");
          if (closers.length === 0) break;
        }
      }
    } else {
      while (isBareTokenByte(this.b[this.i])) this.i++;
      if (this.i === start) reject("SOURCE_SCHEMA_INVALID");
    }
    return Object.freeze({ start, end: this.i });
  }
}

// ---------------------------------------------------------------------------
// Stage 2: wrapper strict parse with Response spans replaced by `null`
// ---------------------------------------------------------------------------

const NULL_TOKEN = new TextEncoder().encode("null");

function replaceSpansWithNull(raw: Uint8Array, spans: readonly Span[]): Uint8Array {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: Uint8Array[] = [];
  let cursor = 0;
  let total = 0;
  for (const span of sorted) {
    const before = raw.subarray(cursor, span.start);
    parts.push(before, NULL_TOKEN);
    total += before.length + NULL_TOKEN.length;
    cursor = span.end;
  }
  const tail = raw.subarray(cursor);
  parts.push(tail);
  total += tail.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const WRAPPER_KEYS = new Set(["schemaVersion", "collectionId", "hostVersion", "sessionId", "session", "sessionAfter", "messagePages", "diff"]);
const WRAPPER_REQUIRED = ["schemaVersion", "collectionId", "hostVersion", "sessionId", "session", "messagePages"] as const;
const SESSION_MEMBER_KEYS = new Set(["collectedAt", "response"]);
const PAGE_KEYS = new Set(["pageIndex", "collectedAt", "request", "response"]);
const REQUEST_KEYS = new Set(["sessionId", "limit", "order", "cursor"]);

type PageMeta = Readonly<{ pageIndex: number; cursor: string | null; span: Span }>;
type WrapperMeta = Readonly<{
  collectionId: string;
  sessionId: string;
  limit: number;
  session: Span;
  sessionAfter: Span | null;
  pages: readonly PageMeta[];
  diff: Span | null;
}>;

function sessionMember(value: unknown, spans: readonly Span[]): Span {
  if (!isRecord(value) || !hasOnlyKeys(value, SESSION_MEMBER_KEYS) || !hasKeys(value, ["collectedAt", "response"])) {
    return reject("SOURCE_SCHEMA_INVALID");
  }
  if (!isRfc3339(value["collectedAt"]) || value["response"] !== null || spans.length !== 1) return reject("SOURCE_SCHEMA_INVALID");
  return spans[0]!;
}

function diffSpan(value: unknown, spans: readonly Span[]): Span | null {
  // Diff metadata problems never reject the collection; they only make the Diff unavailable.
  if (!isRecord(value) || spans.length !== 1 || value["response"] !== null) return null;
  return spans[0]!;
}

function validateWrapper(w: unknown, spans: ResponseSpans): WrapperMeta {
  if (!isRecord(w) || w["schemaVersion"] !== S2B_SOURCE_SCHEMA_VERSION) return reject("SOURCE_SCHEMA_INVALID");
  if (!hasOnlyKeys(w, WRAPPER_KEYS) || !hasKeys(w, WRAPPER_REQUIRED)) return reject("SOURCE_SCHEMA_INVALID");
  if (w["hostVersion"] !== S2B_SUPPORTED_HOST_VERSION) return reject("SOURCE_VERSION_UNSUPPORTED");

  const rawPages = w["messagePages"];
  if (!Array.isArray(rawPages)) return reject("SOURCE_SCHEMA_INVALID");
  // Filter check over every saved page before any other page-level decision (`type` key, even null).
  for (const page of rawPages) {
    if (isRecord(page) && isRecord(page["request"]) && Object.hasOwn(page["request"], "type")) {
      return reject("UNSUPPORTED_FILTERED_COLLECTION");
    }
  }
  if (rawPages.length === 0) return reject("SOURCE_SCHEMA_INVALID");
  if (rawPages.length > S2B_LIMITS.messagePages) return reject("INPUT_LIMIT_EXCEEDED");

  const collectionId = w["collectionId"];
  const sessionId = w["sessionId"];
  if (!isSafeIdentifier(collectionId) || !isSessionId(sessionId)) return reject("SOURCE_SCHEMA_INVALID");

  const session = sessionMember(w["session"], spans.session);
  const afterValue = w["sessionAfter"];
  const sessionAfter = afterValue === undefined || afterValue === null ? null : sessionMember(afterValue, spans.sessionAfter);

  let limit: number | null = null;
  let identityMismatch = false;
  const pages: PageMeta[] = rawPages.map((page: unknown, index): PageMeta => {
    if (!isRecord(page) || !hasOnlyKeys(page, PAGE_KEYS) || !hasKeys(page, [...PAGE_KEYS])) return reject("SOURCE_SCHEMA_INVALID");
    const pageIndex = page["pageIndex"];
    if (typeof pageIndex !== "number" || !Number.isSafeInteger(pageIndex) || pageIndex < 0) return reject("SOURCE_SCHEMA_INVALID");
    if (!isRfc3339(page["collectedAt"])) return reject("SOURCE_SCHEMA_INVALID");
    const pageSpans = spans.pages.get(index) ?? [];
    if (page["response"] !== null || pageSpans.length !== 1) return reject("SOURCE_SCHEMA_INVALID");
    const request = page["request"];
    if (!isRecord(request) || !hasOnlyKeys(request, REQUEST_KEYS) || !hasKeys(request, ["sessionId", "limit"])) {
      return reject("SOURCE_SCHEMA_INVALID");
    }
    const requestLimit = request["limit"];
    if (typeof requestLimit !== "number" || !Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > 200) {
      return reject("SOURCE_SCHEMA_INVALID");
    }
    if (limit === null) limit = requestLimit;
    else if (limit !== requestLimit) return reject("SOURCE_SCHEMA_INVALID");
    if (!isString(request["sessionId"])) return reject("SOURCE_SCHEMA_INVALID");
    if (request["sessionId"] !== sessionId) identityMismatch = true;
    let cursor: string | null = null;
    if (index === 0) {
      if (request["order"] !== "asc" || Object.hasOwn(request, "cursor")) return reject("SOURCE_SCHEMA_INVALID");
    } else {
      if (Object.hasOwn(request, "order") || !isNonEmptyString(request["cursor"])) return reject("SOURCE_SCHEMA_INVALID");
      cursor = request["cursor"];
    }
    return Object.freeze({ pageIndex, cursor, span: pageSpans[0]! });
  });
  if (identityMismatch) return reject("SOURCE_IDENTITY_MISMATCH");

  const diffValue = w["diff"];
  const diff = diffValue === undefined || diffValue === null ? null : diffSpan(diffValue, spans.diff);
  return Object.freeze({ collectionId, sessionId, limit: limit ?? 0, session, sessionAfter, pages: Object.freeze(pages), diff });
}

// ---------------------------------------------------------------------------
// Stage 4-6: fixed OpenCode v2.2.5 response shapes
// ---------------------------------------------------------------------------

const SESSION_INFO_KEYS = new Set([
  "id", "parentID", "fork", "projectID", "agent", "model", "cost", "tokens", "outcome", "time",
  "title", "location", "subpath", "metadata", "permissions", "revert",
]);
const SESSION_TIME_KEYS = new Set(["created", "updated", "busy", "idle", "viewed", "archived"]);

function isSessionInfo(v: unknown): v is JsonRecord {
  if (!isRecord(v) || !hasOnlyKeys(v, SESSION_INFO_KEYS)) return false;
  if (!hasKeys(v, ["id", "projectID", "cost", "tokens", "time", "location"])) return false;
  const time = v["time"];
  return (
    isSessionId(v["id"]) &&
    isNonEmptyString(v["projectID"]) &&
    typeof v["cost"] === "number" && Number.isFinite(v["cost"]) &&
    isRecord(v["tokens"]) &&
    isRecord(v["location"]) &&
    isRecord(time) && hasOnlyKeys(time, SESSION_TIME_KEYS) &&
    isMillis(time["created"]) && isMillis(time["updated"]) &&
    ["busy", "idle", "viewed", "archived"].every((k) => isOptional(time, k, isMillis)) &&
    isOptional(v, "parentID", isSessionId) &&
    isOptional(v, "fork", isRecord) &&
    isOptional(v, "agent", isString) &&
    isOptional(v, "model", isRecord) &&
    isOptional(v, "outcome", isOutcome) &&
    isOptional(v, "title", isString) &&
    isOptional(v, "subpath", isString) &&
    isOptional(v, "metadata", isRecord) &&
    isOptional(v, "permissions", (p) => Array.isArray(p) || isRecord(p)) &&
    isOptional(v, "revert", isRecord)
  );
}

function parseSessionResponse(raw: Uint8Array, span: Span, sessionId: string): void {
  let parsed: unknown;
  try {
    parsed = parseStrictJson(raw.subarray(span.start, span.end), S2B_LIMITS.sessionResponseBytes);
  } catch {
    return reject("SOURCE_SCHEMA_INVALID");
  }
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, new Set(["data"])) || !isSessionInfo(parsed["data"])) return reject("SOURCE_SCHEMA_INVALID");
  if (parsed["data"]["id"] !== sessionId) reject("SOURCE_IDENTITY_MISMATCH");
}

function isToolState(v: unknown): boolean {
  if (!isRecord(v)) return false;
  switch (v["status"]) {
    case "streaming":
      return isString(v["input"]);
    case "running":
      return isRecord(v["input"]) && isRecord(v["metadata"]);
    case "completed":
      return isRecord(v["input"]) && Array.isArray(v["content"]) && v["content"].length > 0 && isOptional(v, "metadata", isRecord);
    case "error":
      return (
        isRecord(v["input"]) && isRecord(v["error"]) &&
        isOptional(v, "content", (c) => Array.isArray(c) && c.length > 0) && isOptional(v, "metadata", isRecord)
      );
    default:
      return false;
  }
}

function isAssistantContent(v: unknown): boolean {
  if (!isRecord(v)) return false;
  switch (v["type"]) {
    case "text":
      return isString(v["text"]);
    case "reasoning":
      return isString(v["text"]) && isOptional(v, "time", (t) => isRecord(t) && isMillis(t["created"]));
    case "tool": {
      const time = v["time"];
      return (
        isNonEmptyString(v["id"]) && isString(v["name"]) &&
        isOptional(v, "executed", (e) => typeof e === "boolean") &&
        isOptional(v, "native", isRecord) &&
        isToolState(v["state"]) &&
        isRecord(time) && isMillis(time["created"]) &&
        isOptional(time, "ran", isMillis) && isOptional(time, "completed", isMillis)
      );
    }
    default:
      return false;
  }
}

function isMessage(v: unknown): v is JsonRecord {
  if (!isRecord(v) || !isMessageId(v["id"])) return false;
  const time = v["time"];
  if (!isRecord(time) || !isMillis(time["created"]) || !isOptional(v, "metadata", isRecord)) return false;
  switch (v["type"]) {
    case "agent-switched":
      return isNonEmptyString(v["agent"]);
    case "model-switched":
      return isRecord(v["model"]);
    case "location-switched":
      return isRecord(v["location"]);
    case "user":
    case "synthetic":
    case "system":
      return isString(v["text"]);
    case "skill":
      return isString(v["skill"]) && isString(v["name"]) && isString(v["text"]);
    case "shell":
      return isString(v["shellID"]) && isString(v["command"]) && isString(v["status"]) && isOptional(time, "completed", isMillis);
    case "assistant":
      return (
        isNonEmptyString(v["agent"]) && isRecord(v["model"]) &&
        Array.isArray(v["content"]) && v["content"].every(isAssistantContent) &&
        isOptional(v, "snapshot", (s) => isRecord(s) && isOptional(s, "start", isString) && isOptional(s, "end", isString)) &&
        isOptional(time, "completed", isMillis)
      );
    case "compaction":
      switch (v["status"]) {
        case "running":
        case "completed":
          return isLiteral(["auto", "manual"])(v["reason"]) && isString(v["summary"]);
        case "failed":
          return isLiteral(["auto", "manual"])(v["reason"]) && isRecord(v["error"]);
        default:
          return false;
      }
    case "idle":
      return isOutcome(v["outcome"]);
    default:
      return false;
  }
}

type PageParse =
  | Readonly<{ ok: true; messages: readonly JsonRecord[]; next: string | null }>
  | Readonly<{ ok: false; count: number | null }>;

const PAGE_RESPONSE_KEYS = new Set(["data", "cursor"]);
const CURSOR_KEYS = new Set(["previous", "next"]);

function parsePageResponse(raw: Uint8Array, span: Span): PageParse {
  let parsed: unknown;
  try {
    parsed = parseStrictJson(raw.subarray(span.start, span.end), S2B_LIMITS.messagePageResponseBytes);
  } catch {
    return { ok: false, count: null };
  }
  const data = isRecord(parsed) ? parsed["data"] : undefined;
  const count = Array.isArray(data) ? data.length : null;
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, PAGE_RESPONSE_KEYS) || !hasKeys(parsed, ["data", "cursor"]) || !Array.isArray(data)) {
    return { ok: false, count };
  }
  const cursor = parsed["cursor"];
  if (!isRecord(cursor) || !hasOnlyKeys(cursor, CURSOR_KEYS) || !isOptional(cursor, "previous", isString) || !isOptional(cursor, "next", isNonEmptyString)) {
    return { ok: false, count };
  }
  if (!data.every(isMessage)) return { ok: false, count };
  const next = cursor["next"];
  return { ok: true, messages: data as JsonRecord[], next: isString(next) ? next : null };
}

const DIFF_ENTRY_KEYS = new Set(["file", "patch", "additions", "deletions", "status", "more"]);
const isNonNegativeInt = (v: unknown): boolean => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * Independent Diff check. In the initial MVP the ChangeSet is always UNAVAILABLE regardless of this result
 * (design §8), so the outcome never affects Source acceptance; it only guarantees a malformed Diff cannot
 * escalate into a collection-wide rejection.
 */
function diffShapeValid(raw: Uint8Array, span: Span | null): boolean {
  if (span === null || span.end - span.start > S2B_LIMITS.diffResponseBytes) return false;
  let parsed: unknown;
  try {
    parsed = parseStrictJson(raw.subarray(span.start, span.end), S2B_LIMITS.diffResponseBytes);
  } catch {
    return false;
  }
  if (!isRecord(parsed) || !hasOnlyKeys(parsed, new Set(["data"])) || !Array.isArray(parsed["data"])) return false;
  const data: unknown[] = parsed["data"];
  return (
    data.length <= S2B_LIMITS.diffEntries &&
    data.every(
      (e) =>
        isRecord(e) && hasOnlyKeys(e, DIFF_ENTRY_KEYS) &&
        isString(e["file"]) && isString(e["patch"]) && isNonNegativeInt(e["additions"]) && isNonNegativeInt(e["deletions"]) &&
        isLiteral(["added", "deleted", "modified"])(e["status"]) && isOptional(e, "more", (m) => m === true),
    )
  );
}

// ---------------------------------------------------------------------------
// Public: Source
// ---------------------------------------------------------------------------

export function validateS2bSource(raw: Uint8Array): SourceResult {
  try {
    return validateSourceOrThrow(raw);
  } catch (error) {
    if (error instanceof Rejection) return rejected(error.code);
    return rejected("SOURCE_SCHEMA_INVALID");
  }
}

function validateSourceOrThrow(raw: Uint8Array): SourceResult {
  // Stage 1: bounded read, strict UTF-8, lexical span identification.
  if (raw.byteLength > S2B_LIMITS.sourceWrapperBytes) return rejected("INPUT_LIMIT_EXCEEDED");
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    return rejected("SOURCE_SCHEMA_INVALID");
  }
  const spans = new WrapperScanner(raw).scan();

  // Stage 2: wrapper strict parse on a copy whose Response spans are `null`.
  const allSpans = [...spans.session, ...spans.sessionAfter, ...[...spans.pages.values()].flat(), ...spans.diff];
  const copy = replaceSpansWithNull(raw, allSpans);
  let wrapper: unknown;
  try {
    wrapper = parseStrictJson(copy, Math.max(copy.byteLength, 1));
  } catch {
    return rejected("SOURCE_SCHEMA_INVALID");
  }
  const meta = validateWrapper(wrapper, spans);

  // Stage 3: raw span size limits for every required response before any parse / prefix decision.
  const spanBytes = (s: Span): number => s.end - s.start;
  if (spanBytes(meta.session) > S2B_LIMITS.sessionResponseBytes) return rejected("INPUT_LIMIT_EXCEEDED");
  if (meta.sessionAfter !== null && spanBytes(meta.sessionAfter) > S2B_LIMITS.sessionResponseBytes) return rejected("INPUT_LIMIT_EXCEEDED");
  let totalPageBytes = 0;
  for (const page of meta.pages) {
    if (spanBytes(page.span) > S2B_LIMITS.messagePageResponseBytes) return rejected("INPUT_LIMIT_EXCEEDED");
    totalPageBytes += spanBytes(page.span);
  }
  if (totalPageBytes > S2B_LIMITS.messageResponseTotalBytes) return rejected("INPUT_LIMIT_EXCEEDED");

  // Stage 4: required Session GET responses, each parsed independently.
  parseSessionResponse(raw, meta.session, meta.sessionId);
  if (meta.sessionAfter !== null) parseSessionResponse(raw, meta.sessionAfter, meta.sessionId);

  // Stage 5: Message page responses, each parsed independently in page order.
  const parsedPages = meta.pages.map((page) => parsePageResponse(raw, page.span));
  // Count limits are global: evaluated over every parseable page so a later defect cannot hide them.
  let totalMessages = 0;
  for (const page of parsedPages) {
    const count = page.ok ? page.messages.length : page.count;
    if (count === null) continue;
    if (count > S2B_LIMITS.messagesPerPage) return rejected("INPUT_LIMIT_EXCEEDED");
    totalMessages += count;
  }
  if (totalMessages > S2B_LIMITS.collectionMessages) return rejected("INPUT_LIMIT_EXCEEDED");

  const diagnostics = new Map<DiagnosticCode, number>();
  const bump = (code: DiagnosticCode, by = 1): void => {
    diagnostics.set(code, (diagnostics.get(code) ?? 0) + by);
  };

  const messages: JsonRecord[] = [];
  const seenMessageIds = new Set<string>();
  const seenCursors = new Set<string>();
  let previousNext: string | null = null;
  let acceptedPages = 0;
  for (let index = 0; index < meta.pages.length; index++) {
    const page = meta.pages[index]!;
    const parsed = parsedPages[index]!;
    if (!parsed.ok) {
      if (index === 0) return rejected("SOURCE_SCHEMA_INVALID");
      bump("SOURCE_SCHEMA_INVALID");
      break;
    }
    if (page.pageIndex !== index) {
      if (index === 0) return rejected("SOURCE_SCHEMA_INVALID");
      break;
    }
    // A page may never carry more Messages than the constant request limit (no over-full page is trusted).
    if (parsed.messages.length > meta.limit) {
      if (index === 0) return rejected("SOURCE_SCHEMA_INVALID");
      bump("SOURCE_SCHEMA_INVALID");
      break;
    }
    if (index > 0) {
      if (previousNext === null || page.cursor !== previousNext || page.cursor === null || seenCursors.has(page.cursor)) break;
      seenCursors.add(page.cursor);
    }
    const pageIds = parsed.messages.map((m) => m["id"] as string);
    if (new Set(pageIds).size !== pageIds.length || pageIds.some((id) => seenMessageIds.has(id))) {
      if (index === 0) return rejected("CONFLICT");
      bump("CONFLICT");
      break;
    }
    for (const id of pageIds) seenMessageIds.add(id);
    messages.push(...parsed.messages);
    previousNext = parsed.next;
    acceptedPages++;
  }
  const complete = acceptedPages === meta.pages.length && previousNext === null;
  if (!complete) bump("PAGINATION_INCOMPLETE");

  // Stage 6: optional Diff, parsed independently. Initial MVP: ChangeSet is always UNAVAILABLE.
  diffShapeValid(raw, meta.diff);
  bump("DIFF_UNAVAILABLE");

  return Object.freeze({
    state: "ACCEPTED" as const,
    value: Object.freeze({
      sessionId: meta.sessionId,
      collectionId: meta.collectionId,
      collectionStatus: complete ? ("PAGINATION_COMPLETE" as const) : ("PAGINATION_INCOMPLETE" as const),
      lastValidatedPageIndex: acceptedPages > 0 ? acceptedPages - 1 : null,
      validatedPageCount: acceptedPages,
      messages: deepFreeze(messages),
      diagnostics: freezeDiagnostics(diagnostics),
    }),
  });
}

// ---------------------------------------------------------------------------
// Public: Correlation
// ---------------------------------------------------------------------------

const CORRELATION_KEYS = new Set(["schemaVersion", "sessionId", "messageBindings"]);
const BINDING_KEYS = new Set(["messageId", "taskRef", "scopeKey", "tools"]);
const TOOL_BINDING_KEYS = new Set(["toolId", "acRef"]);
const REF_KEYS = new Set(["artifactId", "revision"]);

function normalizeRef(v: unknown): Readonly<{ artifactId: string; revision: string }> {
  if (!isRecord(v) || !hasOnlyKeys(v, REF_KEYS) || !isSafeIdentifier(v["artifactId"]) || !isSafeIdentifier(v["revision"])) {
    return reject("SOURCE_SCHEMA_INVALID");
  }
  return Object.freeze({ artifactId: v["artifactId"], revision: v["revision"] });
}

/**
 * Structural validation only. Duplicate Message/Tool bindings and Task conflicts are preserved verbatim
 * for the projector (Task 3), which classifies them before Task selection.
 */
export function validateS2bCorrelation(raw: Uint8Array): CorrelationResult {
  try {
    if (raw.byteLength > S2B_LIMITS.correlationBytes) return rejected("INPUT_LIMIT_EXCEEDED");
    let parsed: unknown;
    try {
      parsed = parseStrictJson(raw, S2B_LIMITS.correlationBytes);
    } catch {
      return rejected("SOURCE_SCHEMA_INVALID");
    }
    if (!isRecord(parsed) || parsed["schemaVersion"] !== S2B_CORRELATION_SCHEMA_VERSION) return rejected("SOURCE_SCHEMA_INVALID");
    if (!hasOnlyKeys(parsed, CORRELATION_KEYS) || !hasKeys(parsed, [...CORRELATION_KEYS])) return rejected("SOURCE_SCHEMA_INVALID");
    const sessionId = parsed["sessionId"];
    const rawBindings = parsed["messageBindings"];
    if (!isSessionId(sessionId) || !Array.isArray(rawBindings)) return rejected("SOURCE_SCHEMA_INVALID");

    // Count limits over the whole input first (no truncation).
    if (rawBindings.length > S2B_LIMITS.bindings) return rejected("INPUT_LIMIT_EXCEEDED");
    let totalTools = 0;
    for (const binding of rawBindings) {
      const tools = isRecord(binding) ? binding["tools"] : undefined;
      if (!Array.isArray(tools)) continue;
      if (tools.length > S2B_LIMITS.toolsPerMessage) return rejected("INPUT_LIMIT_EXCEEDED");
      totalTools += tools.length;
    }
    if (totalTools > S2B_LIMITS.toolsTotal) return rejected("INPUT_LIMIT_EXCEEDED");

    const bindings: CorrelationBinding[] = rawBindings.map((binding: unknown): CorrelationBinding => {
      if (!isRecord(binding) || !hasOnlyKeys(binding, BINDING_KEYS) || !hasKeys(binding, [...BINDING_KEYS])) return reject("SOURCE_SCHEMA_INVALID");
      const messageId = binding["messageId"];
      const scopeKey = binding["scopeKey"];
      const tools = binding["tools"];
      if (!isMessageId(messageId) || !isSafeIdentifier(scopeKey) || !Array.isArray(tools)) return reject("SOURCE_SCHEMA_INVALID");
      return Object.freeze({
        messageId,
        taskRef: normalizeRef(binding["taskRef"]),
        scopeKey,
        tools: Object.freeze(
          tools.map((tool: unknown) => {
            if (!isRecord(tool) || !hasOnlyKeys(tool, TOOL_BINDING_KEYS) || !hasKeys(tool, [...TOOL_BINDING_KEYS])) return reject("SOURCE_SCHEMA_INVALID");
            const toolId = tool["toolId"];
            if (!isNonEmptyString(toolId)) return reject("SOURCE_SCHEMA_INVALID");
            return Object.freeze({ toolId, acRef: normalizeRef(tool["acRef"]) });
          }),
        ),
      });
    });
    return Object.freeze({ state: "ACCEPTED" as const, sessionId, bindings: Object.freeze(bindings), diagnostics: Object.freeze([]) });
  } catch (error) {
    if (error instanceof Rejection) return rejected(error.code);
    return rejected("SOURCE_SCHEMA_INVALID");
  }
}
