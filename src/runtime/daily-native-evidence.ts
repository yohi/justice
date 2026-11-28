// Daily Assurance Native Evidence Bridge (design §4.2/§4.3, RG-002).
// Fixed loopback Native reads -> existing justice-s2b-source-v1 raw wrapper -> deterministic Correlation v1.
// Raw Native payloads stay in bounded private memory; reasons/diagnostics carry fixed codes only.
import {createHash} from 'node:crypto';
import {isSafeIdentifier} from '../core/s1a/contract.js';
import {hasExactKeys} from '../core/s1a/manifest.js';
import {parseStrictJson} from '../core/s1a/strict-json.js';
import {matchRuleInput,type AcquisitionRule,type CheckResult,type DailyBinding,type DailyOwnerConfig,type DailyReason,type Unavailable} from './daily-intent.js';
import {S2B_CORRELATION_SCHEMA_VERSION,S2B_LIMITS,S2B_SOURCE_SCHEMA_VERSION,type CorrelationBinding,type S2bDiagnostic,type ValidatedSource} from './s2b-contract.js';
import {validateS2bCorrelation,validateS2bSource} from './s2b-input.js';
import {projectS2bEvidence} from './s2b-projector.js';

export type CallIdentity = Readonly<{sessionId:string; messageId:string; callId:string}>;
export type NativeObservation = Readonly<CallIdentity & {
  tool: string; phase: "BEFORE" | "AFTER";
  status: "STARTED" | "COMPLETED" | "ERROR"; ruleId: string | null;
}>;
export type NativePageQuery = Readonly<{order:"asc";limit:100}>
  | Readonly<{cursor:string;limit:100}>;
export type NativeBytes = Readonly<{state:"OK";bytes:Uint8Array}> | Unavailable;
export interface NativeReadPort {
  getSession(sessionId:string, signal:AbortSignal):Promise<NativeBytes>;
  getMessages(sessionId:string, query:NativePageQuery, signal:AbortSignal):Promise<NativeBytes>;
  getRunningShells(worktreeRoot:string, signal:AbortSignal):Promise<NativeBytes>;
}
export type NativeSnapshot = Readonly<{
  rawWrapper:Uint8Array; validated:ValidatedSource;
  // digest of length-framed raw page response bytes, in validated page order
  pageDigest:string;
  sessionId:string; worktreeRoot:string;
}>;
export type NativeSnapshotResult = Readonly<{state:"READY";snapshot:NativeSnapshot}>
  | Readonly<{state:"REJECTED";reasons:readonly DailyReason[];diagnostics:readonly S2bDiagnostic[]}>
  | Unavailable;
export type NativeEpoch = Readonly<{
  begin:CallIdentity; finish:CallIdentity; prefixMessageIds:readonly string[];
  observations:readonly NativeObservation[];
}>;
export type BoundaryCheck = Readonly<{state:"BOUNDED"}> | Unavailable;
export type PrefixResult = Readonly<{state:"READY";prefixMessageIds:readonly string[]}> | Unavailable;
export type DailyEvidenceResult =
  | Readonly<{state:"VALID";bindingKey:string;rawWrapper:Uint8Array;correlationBytes:Uint8Array;
      sourceSha256:string;correlationSha256:string;limited:boolean;reasons:readonly DailyReason[]}>
  | Readonly<{state:"REJECTED";reasons:readonly DailyReason[];diagnostics:readonly S2bDiagnostic[]}>
  | Unavailable;

// ---------------------------------------------------------------------------
// Fixed constants
// ---------------------------------------------------------------------------

const NATIVE_HOST_VERSION = '2.3.2';
const PAGE_LIMIT = 100 as const;
const GET_TIMEOUT_MS = 5_000;
const COLLECTION_TIMEOUT_MS = 30_000;
const SESSION_CAP = S2B_LIMITS.sessionResponseBytes; // 1,048,576
const PAGE_CAP = S2B_LIMITS.messagePageResponseBytes; // 4,194,304
const SHELL_CAP = 1_048_576;
const CONTROL_BEGIN = 'justice_task_begin';
const CONTROL_FINISH = 'justice_task_finish';
/** Message types that never make the boundary uncertain on their own. */
const BOUNDED_MESSAGE_TYPES = new Set(['user', 'synthetic', 'system', 'skill', 'assistant', 'agent-switched', 'model-switched', 'idle']);
/** Tool names that indicate child delegation or an earlier/nested control boundary. */
const BOUNDARY_TOOL_NAMES = new Set(['task', 'subagent', CONTROL_BEGIN, CONTROL_FINISH]);

type Rec = Readonly<Record<string, unknown>>;
const isRecord = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const unavailable = (reason: DailyReason): Unavailable => Object.freeze({state: 'UNAVAILABLE' as const, reason});
const rejected = (reasons: readonly DailyReason[], diagnostics: readonly S2bDiagnostic[]) =>
  Object.freeze({state: 'REJECTED' as const, reasons: Object.freeze([...reasons]), diagnostics: Object.freeze(diagnostics.map(d => Object.freeze({code: d.code, count: d.count})))});
const SCHEMA_INVALID: readonly S2bDiagnostic[] = Object.freeze([Object.freeze({code: 'SOURCE_SCHEMA_INVALID' as const, count: 1})]);
const copy = (b: Uint8Array): Uint8Array => Uint8Array.from(b);
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const OK_CHECK: CheckResult = Object.freeze({state: 'OK' as const});
const BOUNDED: BoundaryCheck = Object.freeze({state: 'BOUNDED' as const});
const UNCERTAIN = unavailable('BOUNDARY_UNCERTAIN');

/** Parent signal + fixed deadline; uses setTimeout so the deadline is cancellable and testable. */
function deadline(parent: AbortSignal, ms: number): Readonly<{signal: AbortSignal; timedOut: () => boolean; dispose: () => void}> {
  const ctl = new AbortController();
  let expired = false;
  const onAbort = (): void => ctl.abort();
  if (parent.aborted) ctl.abort(); else parent.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => {expired = true; ctl.abort();}, ms);
  return {
    signal: ctl.signal,
    timedOut: () => expired && !parent.aborted,
    dispose: () => {clearTimeout(timer); parent.removeEventListener('abort', onAbort);},
  };
}

// ---------------------------------------------------------------------------
// Fixed Native HTTP read port
// ---------------------------------------------------------------------------

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  return (value.split(';')[0] ?? '').trim().toLowerCase() === 'application/json';
}

/** Stream the body with a hard cap; cancels the stream on oversize or abort. */
async function readCapped(response: Response, cap: number, signal: AbortSignal): Promise<Uint8Array | 'LIMIT'> {
  const body = response.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const onAbort = (): void => {reader.cancel().catch(() => undefined);};
  signal.addEventListener('abort', onAbort, {once: true});
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      const {done, value} = await reader.read();
      if (signal.aborted) throw new Error('aborted');
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => undefined);
        return 'LIMIT';
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {out.set(c, offset); offset += c.byteLength;}
    return out;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as const;
const NO_PROXY_ENV_KEYS = ['NO_PROXY', 'no_proxy'] as const;

/** The only NO_PROXY token that excludes the fixed Native origin (exact match; no wildcard, CIDR, suffix or hostname). */
const LOOPBACK_NO_PROXY_TOKEN = '127.0.0.1';

const noProxyExcludesLoopback = (value: string): boolean => value.split(',').some(token => token.trim() === LOOPBACK_NO_PROXY_TOKEN);

/**
 * Runtime fetch (e.g. Bun) may route loopback through an env proxy, which would forward raw Native payloads.
 * Read-only env inspection at call time (never mutated):
 * - any non-empty proxy variable (HTTP/HTTPS/ALL, either case) refuses; NO_PROXY never overrides it;
 * - NO_PROXY / no_proxy are evaluated independently: empty is accepted, a non-empty value must contain the exact
 *   token `127.0.0.1` (OpenCode 2.3.2 sets both to `<user>,127.0.0.1,localhost,::1`), otherwise refuse.
 */
function loopbackMayBeProxied(): boolean {
  const env = typeof process === 'undefined' ? {} : process.env;
  if (PROXY_ENV_KEYS.some(k => (env[k] ?? '').trim() !== '')) return true;
  return NO_PROXY_ENV_KEYS.some(k => {
    const value = (env[k] ?? '').trim();
    return value !== '' && !noProxyExcludesLoopback(value);
  });
}

const NATIVE_AUTH_USERNAME = 'opencode';

/**
 * OpenCode 2.3.2 `serve` requires HTTP Basic (user `opencode`) and adopts `OPENCODE_PASSWORD`, then the legacy
 * `OPENCODE_SERVER_PASSWORD`, when set; otherwise it generates an unreadable random password. Only the
 * explicitly configured dedicated-runtime value is used: read at call time, never stored, never searched for.
 * Returns null (fail closed, no unauthenticated fallback) when absent or empty.
 */
function nativeAuthorization(): string | null {
  const env = typeof process === 'undefined' ? {} : process.env;
  const password = env.OPENCODE_PASSWORD || env.OPENCODE_SERVER_PASSWORD;
  if (typeof password !== 'string' || password === '') return null;
  return `Basic ${Buffer.from(`${NATIVE_AUTH_USERNAME}:${password}`, 'utf8').toString('base64')}`;
}

export function createNativeReadPort(config:DailyOwnerConfig):NativeReadPort {
  // Trusted fetch captured once at construction; requests only ever target the fixed loopback origin.
  const trustedFetch = globalThis.fetch;
  const {sessionId: fixedSession, worktreeRoot: fixedRoot, nativePort} = config.approval;
  const origin = `http://127.0.0.1:${nativePort}`;
  const sessionPath = `/api/session/${encodeURIComponent(fixedSession)}`;

  async function get(pathAndQuery: string, cap: number, signal: AbortSignal): Promise<NativeBytes> {
    if (signal.aborted) return unavailable('ABORTED');
    if (loopbackMayBeProxied()) return unavailable('SOURCE_UNAVAILABLE');
    const authorization = nativeAuthorization();
    if (authorization === null) return unavailable('SOURCE_UNAVAILABLE');
    const d = deadline(signal, GET_TIMEOUT_MS);
    const failure = (): Unavailable => unavailable(signal.aborted ? 'ABORTED' : d.timedOut() ? 'TIMEOUT' : 'SOURCE_UNAVAILABLE');
    try {
      const response = await trustedFetch(origin + pathAndQuery, {
        method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: {accept: 'application/json', authorization}, signal: d.signal,
      });
      if (d.signal.aborted) return failure();
      if (response.status !== 200 || response.redirected || !isJsonContentType(response.headers.get('content-type'))) {
        await response.body?.cancel().catch(() => undefined);
        return unavailable('SOURCE_UNAVAILABLE');
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > cap) {
        await response.body?.cancel().catch(() => undefined);
        return unavailable('OBSERVATION_LIMIT');
      }
      const bytes = await readCapped(response, cap, d.signal);
      if (d.signal.aborted) return failure();
      if (bytes === 'LIMIT') return unavailable('OBSERVATION_LIMIT');
      return Object.freeze({state: 'OK' as const, bytes});
    } catch {
      return failure();
    } finally {
      d.dispose();
    }
  }

  return Object.freeze({
    async getSession(sessionId: string, signal: AbortSignal): Promise<NativeBytes> {
      if (sessionId !== fixedSession) return unavailable('SESSION_MISMATCH');
      return get(sessionPath, SESSION_CAP, signal);
    },
    async getMessages(sessionId: string, query: NativePageQuery, signal: AbortSignal): Promise<NativeBytes> {
      if (sessionId !== fixedSession) return unavailable('SESSION_MISMATCH');
      let q: string;
      if ('order' in query) {
        if (query.order !== 'asc' || query.limit !== PAGE_LIMIT) return unavailable('SOURCE_UNAVAILABLE');
        q = `order=asc&limit=${PAGE_LIMIT}`;
      } else {
        if (typeof query.cursor !== 'string' || query.cursor.length === 0 || query.limit !== PAGE_LIMIT) return unavailable('SOURCE_UNAVAILABLE');
        try {q = `cursor=${encodeURIComponent(query.cursor)}&limit=${PAGE_LIMIT}`;}
        catch (error) {
          if (error instanceof URIError) return unavailable('SOURCE_UNAVAILABLE');
          throw error;
        }
      }
      return get(`${sessionPath}/message?${q}`, PAGE_CAP, signal);
    },
    async getRunningShells(worktreeRoot: string, signal: AbortSignal): Promise<NativeBytes> {
      if (worktreeRoot !== fixedRoot) return unavailable('WORKSPACE_MISMATCH');
      return get(`/api/shell?location%5Bdirectory%5D=${encodeURIComponent(fixedRoot)}`, SHELL_CAP, signal);
    },
  });
}

// ---------------------------------------------------------------------------
// Snapshot acquisition
// ---------------------------------------------------------------------------

type SessionCheck = Readonly<{ok: true}> | Readonly<{ok: false; result: NativeSnapshotResult}>;

/** Strict parse for identity only; the raw bytes are embedded unchanged. */
function checkSessionBytes(bytes: Uint8Array, sessionId: string, root: string): SessionCheck {
  if (bytes.byteLength > SESSION_CAP) return {ok: false, result: unavailable('OBSERVATION_LIMIT')};
  let v: unknown;
  try {v = parseStrictJson(bytes, SESSION_CAP);} catch {return {ok: false, result: rejected(['SOURCE_REJECTED'], SCHEMA_INVALID)};}
  if (!hasExactKeys(v, ['data']) || !isRecord(v.data)) return {ok: false, result: rejected(['SOURCE_REJECTED'], SCHEMA_INVALID)};
  const data = v.data;
  if (data.id !== sessionId || Object.hasOwn(data, 'parentID') || Object.hasOwn(data, 'fork')) return {ok: false, result: unavailable('SESSION_MISMATCH')};
  if (!isRecord(data.location) || data.location.directory !== root) return {ok: false, result: unavailable('WORKSPACE_MISMATCH')};
  return {ok: true};
}

/** Strict parse for pagination only: returns the opaque next cursor, null at the end, undefined if unusable. */
function pageNext(bytes: Uint8Array): string | null | undefined {
  let v: unknown;
  try {v = parseStrictJson(bytes, PAGE_CAP);} catch {return undefined;}
  if (!hasExactKeys(v, ['data', 'cursor']) || !Array.isArray(v.data) || !hasExactKeys(v.cursor, [], ['previous', 'next'])) return undefined;
  const next = v.cursor.next;
  if (next === undefined || next === null) return null;
  return typeof next === 'string' && next.length > 0 ? next : undefined;
}

type CollectedPage = Readonly<{request: Rec; collectedAt: string; bytes: Uint8Array}>;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {out.set(p, offset); offset += p.byteLength;}
  return out;
}

function assembleWrapper(collectionId: string, sessionId: string, start: CollectedPage, after: CollectedPage, pages: readonly CollectedPage[]): Uint8Array {
  const e = new TextEncoder();
  const j = (v: unknown): string => JSON.stringify(v);
  const parts: Uint8Array[] = [
    e.encode(`{"schemaVersion":${j(S2B_SOURCE_SCHEMA_VERSION)},"collectionId":${j(collectionId)},"hostVersion":${j(NATIVE_HOST_VERSION)},"sessionId":${j(sessionId)},`),
    e.encode(`"session":{"collectedAt":${j(start.collectedAt)},"response":`), start.bytes,
    e.encode(`},"sessionAfter":{"collectedAt":${j(after.collectedAt)},"response":`), after.bytes,
    e.encode('},"messagePages":['),
  ];
  pages.forEach((p, i) => {
    parts.push(e.encode(`${i === 0 ? '' : ','}{"pageIndex":${i},"collectedAt":${j(p.collectedAt)},"request":${j(p.request)},"response":`), p.bytes, e.encode('}'));
  });
  parts.push(e.encode('],"diff":null}'));
  return concat(parts);
}

function framedDigest(pages: readonly Uint8Array[]): string {
  const h = createHash('sha256');
  for (const p of pages) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, p.byteLength, false);
    h.update(len).update(p);
  }
  return h.digest('hex');
}

export async function readNativeSnapshot(
  binding:DailyBinding, port:NativeReadPort, collectionId:string, signal:AbortSignal
):Promise<NativeSnapshotResult> {
  if (signal.aborted) return unavailable('ABORTED');
  const prefix = `daily-${binding.key.slice(0, 16)}-`;
  if (!/^[0-9a-f]{64}$/.test(binding.key) || !isSafeIdentifier(collectionId)
    || !['begin', 'end-a', 'end-b'].some(s => collectionId === prefix + s)) return unavailable('BINDING_INVALID');
  const {sessionId, worktreeRoot} = binding.config.approval;
  const startedAt = performance.now();
  const d = deadline(signal, COLLECTION_TIMEOUT_MS);
  const timedOut = (): boolean => !signal.aborted
    && (d.timedOut() || performance.now() - startedAt >= COLLECTION_TIMEOUT_MS);
  const stopped = (): Unavailable => unavailable(signal.aborted ? 'ABORTED' : timedOut() ? 'TIMEOUT' : 'ABORTED');
  const now = (): string => new Date().toISOString();
  try {
    const readSession = async (): Promise<CollectedPage | NativeSnapshotResult> => {
      const r = await port.getSession(sessionId, d.signal);
      if (d.signal.aborted) return stopped();
      if (r.state !== 'OK') return unavailable(r.reason);
      const bytes = copy(r.bytes);
      const check = checkSessionBytes(bytes, sessionId, worktreeRoot);
      if (!check.ok) return check.result;
      return {request: {}, collectedAt: now(), bytes};
    };
    const start = await readSession();
    if ('state' in start) return start;

    const pages: CollectedPage[] = [];
    const requestedCursors = new Set<string>();
    let total = 0;
    let query: NativePageQuery = {order: 'asc', limit: PAGE_LIMIT};
    while (pages.length < S2B_LIMITS.messagePages) {
      const r = await port.getMessages(sessionId, query, d.signal);
      if (d.signal.aborted) return stopped();
      const first = pages.length === 0;
      if (r.state !== 'OK') {
        if (first) return unavailable(r.reason);
        break; // contiguous prefix only; never retried
      }
      const bytes = copy(r.bytes);
      if (bytes.byteLength > PAGE_CAP || total + bytes.byteLength > S2B_LIMITS.messageResponseTotalBytes) {
        if (first) return unavailable('OBSERVATION_LIMIT');
        break;
      }
      const next = pageNext(bytes);
      if (next === undefined) {
        if (first) return rejected(['SOURCE_REJECTED'], SCHEMA_INVALID);
        break;
      }
      const request = 'order' in query
        ? {sessionId, order: 'asc', limit: PAGE_LIMIT}
        : {sessionId, cursor: query.cursor, limit: PAGE_LIMIT};
      pages.push({request, collectedAt: now(), bytes});
      total += bytes.byteLength;
      if (next === null || requestedCursors.has(next)) break; // end, or a cursor loop that is never advanced
      requestedCursors.add(next);
      query = {cursor: next, limit: PAGE_LIMIT};
    }

    const after = await readSession();
    if ('state' in after) return after;

    const raw = assembleWrapper(collectionId, sessionId, start, after, pages);
    if (raw.byteLength > S2B_LIMITS.sourceWrapperBytes) return rejected(['SOURCE_REJECTED'], [{code: 'INPUT_LIMIT_EXCEEDED', count: 1}]);
    if (timedOut()) return unavailable('TIMEOUT');
    const source = validateS2bSource(raw);
    if (source.state !== 'ACCEPTED') return rejected(['SOURCE_REJECTED'], source.diagnostics);
    if (source.value.sessionId !== sessionId || source.value.collectionId !== collectionId) return unavailable('SESSION_MISMATCH');
    const validatedPages = pages.slice(0, source.value.validatedPageCount).map(p => p.bytes);
    const snapshot: NativeSnapshot = Object.freeze({
      rawWrapper: raw, validated: source.value, pageDigest: framedDigest(validatedPages), sessionId, worktreeRoot,
    });
    if (timedOut()) return unavailable('TIMEOUT');
    return Object.freeze({state: 'READY' as const, snapshot});
  } catch {
    return signal.aborted ? unavailable('ABORTED') : timedOut() ? unavailable('TIMEOUT') : unavailable('SOURCE_UNAVAILABLE');
  } finally {
    d.dispose();
  }
}

// ---------------------------------------------------------------------------
// Running shell quiescence
// ---------------------------------------------------------------------------

export async function checkNoRunningShells(
  binding:DailyBinding, port:NativeReadPort, signal:AbortSignal
):Promise<CheckResult> {
  if (signal.aborted) return unavailable('ABORTED');
  const root = binding.config.approval.worktreeRoot;
  try {
    const r = await port.getRunningShells(root, signal);
    if (signal.aborted) return unavailable('ABORTED');
    if (r.state !== 'OK' || r.bytes.byteLength > SHELL_CAP) return UNCERTAIN;
    let v: unknown;
    try {v = parseStrictJson(r.bytes, SHELL_CAP);} catch {return UNCERTAIN;}
    if (!hasExactKeys(v, ['location', 'data']) || !hasExactKeys(v.location, ['directory']) || v.location.directory !== root || !Array.isArray(v.data)) return UNCERTAIN;
    return v.data.length === 0 ? OK_CHECK : unavailable('TOOL_IN_FLIGHT');
  } catch {
    return signal.aborted ? unavailable('ABORTED') : UNCERTAIN;
  }
}

// ---------------------------------------------------------------------------
// Boundary checks (metadata only; never full Host quiescence, see design §4.3)
// ---------------------------------------------------------------------------

type Msgs = ValidatedSource['messages'];
const toolParts = (m: Rec): readonly Rec[] =>
  m.type === 'assistant' && Array.isArray(m.content) ? (m.content as unknown[]).filter((p): p is Rec => isRecord(p) && p.type === 'tool') : [];
const partStatus = (p: Rec): unknown => (isRecord(p.state) ? p.state.status : undefined);
const isTerminal = (p: Rec): boolean => partStatus(p) === 'completed' || partStatus(p) === 'error';
const isBackground = (p: Rec): boolean => isRecord(p.state)
  && ((isRecord(p.state.input) && p.state.input.background === true)
    || (isRecord(p.state.metadata) && p.state.metadata.status === 'running'));

/** Message types and Tool part identities are unambiguous across the whole snapshot. */
function structurallyBounded(messages: Msgs): boolean {
  const partIds = new Set<string>();
  for (const m of messages) {
    if (typeof m.type !== 'string' || !BOUNDED_MESSAGE_TYPES.has(m.type)) return false;
    for (const p of toolParts(m)) {
      if (typeof p.id !== 'string' || partIds.has(p.id)) return false;
      partIds.add(p.id);
    }
  }
  return true;
}

/** Ordinary settled history: terminal tools, no child delegation, no background, no other control. */
function settledOrdinary(messages: Msgs): boolean {
  return messages.every(m => toolParts(m).every(p => isTerminal(p) && !isBackground(p) && !BOUNDARY_TOOL_NAMES.has(String(p.name))));
}

function isControlMessage(m: Rec | undefined, name: string, callId: string, statuses: readonly string[]): boolean {
  if (m === undefined || m.type !== 'assistant') return false;
  const tools = toolParts(m);
  return tools.length === 1 && tools[0]!.id === callId && tools[0]!.name === name && statuses.includes(String(partStatus(tools[0]!)));
}

const complete = (s: NativeSnapshot): boolean =>
  s.validated.collectionStatus === 'PAGINATION_COMPLETE' && s.validated.sessionId === s.sessionId;

export function checkBeginPrefix(snapshot:NativeSnapshot, begin:CallIdentity):PrefixResult {
  if (!complete(snapshot) || begin.sessionId !== snapshot.sessionId) return UNCERTAIN;
  const messages = snapshot.validated.messages;
  if (!structurallyBounded(messages)) return UNCERTAIN;
  const ids = messages.map(m => m.id as string);
  const index = ids.indexOf(begin.messageId);
  // The begin message is unique (validator) and must be the newest message at begin time.
  if (index < 0 || index !== ids.length - 1) return UNCERTAIN;
  if (!isControlMessage(messages[index], CONTROL_BEGIN, begin.callId, ['running', 'completed'])) return UNCERTAIN;
  if (!settledOrdinary(messages.slice(0, index))) return UNCERTAIN;
  return Object.freeze({state: 'READY' as const, prefixMessageIds: Object.freeze(ids.slice(0, index + 1))});
}

export function checkFinishBoundary(
  before:NativeSnapshot, after:NativeSnapshot, epoch:NativeEpoch
):BoundaryCheck {
  const sessionId = epoch.begin.sessionId;
  if (epoch.finish.sessionId !== sessionId) return UNCERTAIN;
  for (const s of [before, after]) {
    if (!complete(s) || s.sessionId !== sessionId || !structurallyBounded(s.validated.messages)) return UNCERTAIN;
  }
  if (before.worktreeRoot !== after.worktreeRoot || before.pageDigest !== after.pageDigest) return UNCERTAIN;
  const idsA = before.validated.messages.map(m => m.id as string);
  const messages = after.validated.messages;
  const ids = messages.map(m => m.id as string);
  if (idsA.length !== ids.length || idsA.some((id, i) => id !== ids[i])) return UNCERTAIN;
  const prefix = epoch.prefixMessageIds;
  if (prefix.length === 0 || prefix.length > ids.length || prefix.some((id, i) => id !== ids[i])) return UNCERTAIN;
  const beginIndex = prefix.length - 1;
  const finishIndex = ids.length - 1;
  if (ids[beginIndex] !== epoch.begin.messageId || ids[finishIndex] !== epoch.finish.messageId || finishIndex <= beginIndex) return UNCERTAIN;
  if (!isControlMessage(messages[beginIndex], CONTROL_BEGIN, epoch.begin.callId, ['completed'])) return UNCERTAIN;
  if (!isControlMessage(messages[finishIndex], CONTROL_FINISH, epoch.finish.callId, ['running', 'completed'])) return UNCERTAIN;
  if (!settledOrdinary(messages.slice(0, beginIndex)) || !settledOrdinary(messages.slice(beginIndex + 1, finishIndex))) return UNCERTAIN;
  if (epoch.observations.some(o => o.sessionId !== sessionId)) return UNCERTAIN;
  return BOUNDED;
}

// ---------------------------------------------------------------------------
// Deterministic Correlation
// ---------------------------------------------------------------------------

type Identity = {readonly key: string; readonly id: CallIdentity; before: NativeObservation[]; after: NativeObservation[]; readonly ruleIds: Set<string>};
type Outcome = Readonly<{ok: true; messageId: string; callId: string}> | Readonly<{ok: false; reason: DailyReason}>;
type Located = Readonly<{index: number; messageId: string; part: Rec}>;

const utf8Compare = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const identityKey = (i: CallIdentity): string => JSON.stringify([i.sessionId, i.messageId, i.callId]);

function groupObservations(observations: readonly NativeObservation[], controlCalls: ReadonlySet<string>, sessionId: string): Identity[] {
  const seen = new Set<string>();
  const byKey = new Map<string, Identity>();
  for (const o of observations) {
    // Identical duplicates are coalesced; control calls of the selected Session are never candidates.
    const exact = JSON.stringify([o.sessionId, o.messageId, o.callId, o.tool, o.phase, o.status, o.ruleId]);
    if (seen.has(exact)) continue;
    seen.add(exact);
    if (o.sessionId === sessionId && controlCalls.has(o.callId)) continue;
    const key = identityKey(o);
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = {key, id: {sessionId: o.sessionId, messageId: o.messageId, callId: o.callId}, before: [], after: [], ruleIds: new Set()};
      byKey.set(key, entry);
    }
    (o.phase === 'BEFORE' ? entry.before : entry.after).push(o);
    if (o.ruleId !== null) entry.ruleIds.add(o.ruleId);
  }
  return [...byKey.values()];
}

function evaluate(e: Identity, ctx: Readonly<{
  sessionId: string; rules: readonly AcquisitionRule[]; partsById: ReadonlyMap<string, readonly Located[]>;
  beginIndex: number; endIndex: number; prefix: ReadonlySet<string>;
}>): Outcome {
  const fail = (reason: DailyReason): Outcome => ({ok: false, reason});
  if (e.before.length === 1 && e.after.length === 0) return fail('TOOL_NOT_COMPLETED');
  if (e.before.length !== 1 || e.after.length !== 1) return fail('IDENTITY_UNMATCHED');
  const b = e.before[0]!, a = e.after[0]!;
  if (b.status !== 'STARTED' || b.tool !== a.tool || b.ruleId !== a.ruleId || b.ruleId === null) return fail('IDENTITY_UNMATCHED');
  if (a.status === 'ERROR') return fail('TOOL_NOT_COMPLETED');
  if (a.status !== 'COMPLETED') return fail('IDENTITY_UNMATCHED');
  if (e.id.sessionId !== ctx.sessionId || a.tool !== 'shell') return fail('IDENTITY_UNMATCHED');
  const located = ctx.partsById.get(e.id.callId) ?? [];
  if (located.length !== 1) return fail('IDENTITY_UNMATCHED');
  const {index, messageId, part} = located[0]!;
  if (messageId !== e.id.messageId || index <= ctx.beginIndex || index >= ctx.endIndex || ctx.prefix.has(messageId)) return fail('IDENTITY_UNMATCHED');
  if (part.name !== 'shell') return fail('IDENTITY_UNMATCHED');
  const status = partStatus(part);
  if (status !== 'completed') return fail(status === 'running' || status === 'streaming' || status === 'error' ? 'TOOL_NOT_COMPLETED' : 'IDENTITY_UNMATCHED');
  if (isRecord(part.state) && isRecord(part.state.metadata) && part.state.metadata.status === 'running') return fail('TOOL_NOT_COMPLETED');
  // Provider-executed (true) or unknown (absent) parts are not local direct-shell executions.
  if (part.executed !== false) return fail('IDENTITY_UNMATCHED');
  const input = isRecord(part.state) ? part.state.input : undefined;
  if (matchRuleInput(ctx.rules, 'shell', input) !== b.ruleId) return fail('IDENTITY_UNMATCHED');
  return {ok: true, messageId, callId: e.id.callId};
}

export function collectDailyNativeEvidence(
  binding:DailyBinding, snapshot:NativeSnapshot, epoch:NativeEpoch
):DailyEvidenceResult {
  try {
    const approval = binding.config.approval;
    if (binding.key !== binding.config.approvalSha256) return unavailable('BINDING_INVALID');
    const sessionId = approval.sessionId;
    if (snapshot.sessionId !== sessionId || snapshot.worktreeRoot !== approval.worktreeRoot
      || epoch.begin.sessionId !== sessionId || epoch.finish.sessionId !== sessionId) return unavailable('SESSION_MISMATCH');

    const rawWrapper = copy(snapshot.rawWrapper);
    const source = validateS2bSource(rawWrapper);
    if (source.state !== 'ACCEPTED') return rejected(['SOURCE_REJECTED'], source.diagnostics);
    const validated = source.value;
    if (validated.sessionId !== sessionId) return unavailable('SESSION_MISMATCH');
    const messages = validated.messages;
    const ids = messages.map(m => m.id as string);
    const isComplete = validated.collectionStatus === 'PAGINATION_COMPLETE';

    const prefix = epoch.prefixMessageIds;
    if (prefix.length === 0 || prefix.length > ids.length || prefix.some((id, i) => id !== ids[i])) return UNCERTAIN;
    const beginIndex = prefix.length - 1;
    if (ids[beginIndex] !== epoch.begin.messageId) return UNCERTAIN;
    const finishIndex = ids.indexOf(epoch.finish.messageId);
    if (finishIndex < 0 ? isComplete : finishIndex <= beginIndex) return UNCERTAIN;
    const endIndex = finishIndex < 0 ? ids.length : finishIndex;

    const partsById = new Map<string, Located[]>();
    messages.forEach((m, index) => {
      for (const part of toolParts(m)) {
        if (typeof part.id !== 'string') continue;
        const list = partsById.get(part.id) ?? [];
        list.push({index, messageId: ids[index]!, part});
        partsById.set(part.id, list);
      }
    });
    const prefixSet = new Set(prefix);
    const rules = approval.rules;
    const ctx = {sessionId, rules, partsById, beginIndex, endIndex, prefix: prefixSet};
    const identities = groupObservations(epoch.observations, new Set([epoch.begin.callId, epoch.finish.callId]), sessionId);
    const hookedCalls = new Set(identities.map(e => e.id.callId));

    const reasons = new Set<DailyReason>();
    if (!isComplete) reasons.add('SOURCE_INCOMPLETE');
    const known = new Set(rules.map(r => r.ruleId));
    if (identities.some(e => [...e.ruleIds].some(r => !known.has(r)))) reasons.add('IDENTITY_UNMATCHED');

    const selected: {messageId: string; toolId: string; acRef: AcquisitionRule['acRef']}[] = [];
    const usedParts = new Set<string>();
    for (const rule of rules) {
      const involved = identities.filter(e => e.ruleIds.has(rule.ruleId));
      if (involved.length === 0) {
        // A saved part that matches the rule without a hook pair is an identity gap, never implicit evidence.
        const unhooked = messages.slice(beginIndex + 1, endIndex).some(m => toolParts(m).some(p =>
          p.name === 'shell' && !hookedCalls.has(String(p.id)) && matchRuleInput(rules, 'shell', isRecord(p.state) ? p.state.input : undefined) === rule.ruleId));
        reasons.add(unhooked ? 'IDENTITY_UNMATCHED' : 'RULE_UNMATCHED');
        continue;
      }
      if (involved.length > 1) {reasons.add('RULE_AMBIGUOUS'); continue;}
      const outcome = evaluate(involved[0]!, ctx);
      if (!outcome.ok) {reasons.add(outcome.reason); continue;}
      if (usedParts.has(outcome.callId)) {reasons.add('RULE_AMBIGUOUS'); continue;}
      usedParts.add(outcome.callId);
      selected.push({messageId: outcome.messageId, toolId: outcome.callId, acRef: rule.acRef});
    }

    const grouped = new Map<string, {toolId: string; acRef: AcquisitionRule['acRef']}[]>();
    for (const s of selected) {
      const list = grouped.get(s.messageId) ?? [];
      list.push({toolId: s.toolId, acRef: s.acRef});
      grouped.set(s.messageId, list);
    }
    const task = binding.intent.task;
    const messageBindings: CorrelationBinding[] = [...grouped.keys()].sort(utf8Compare).map(messageId => ({
      messageId,
      taskRef: {artifactId: task.artifactId, revision: task.revision},
      scopeKey: binding.intent.scopeKey,
      tools: grouped.get(messageId)!.sort((x, y) => utf8Compare(x.toolId, y.toolId))
        .map(t => ({toolId: t.toolId, acRef: {artifactId: t.acRef.artifactId, revision: t.acRef.revision}})),
    }));
    const correlationBytes = new TextEncoder().encode(JSON.stringify({schemaVersion: S2B_CORRELATION_SCHEMA_VERSION, sessionId, messageBindings}));
    const correlation = validateS2bCorrelation(correlationBytes);
    if (correlation.state !== 'ACCEPTED') return rejected(['SOURCE_REJECTED'], correlation.diagnostics);
    let projectedLimited = false;
    if (messageBindings.length > 0) {
      const projection = projectS2bEvidence(validated, correlation, binding.intent);
      if (projection.status === 'REJECTED') return rejected(['SOURCE_REJECTED'], projection.diagnostics);
      projectedLimited = projection.status !== 'PROJECTED';
    }
    const limited = reasons.size > 0 || !isComplete || projectedLimited;
    return Object.freeze({
      state: 'VALID' as const, bindingKey: binding.key, rawWrapper, correlationBytes,
      sourceSha256: sha(rawWrapper), correlationSha256: sha(correlationBytes), limited, reasons: Object.freeze([...reasons]),
    });
  } catch {
    return unavailable('SOURCE_UNAVAILABLE');
  }
}
