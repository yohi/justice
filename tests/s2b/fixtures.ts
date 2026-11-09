// Minimal fixed OpenCode v2.2.5 saved-response fixture builders for S2-b tests.
// Builders return raw JSON text so tests can inject byte-level defects (duplicate keys, padding, escapes).
import { s1aFixture, sha256, jsonBytes } from "../helpers/s1a-fixtures.js";

export { s1aFixture, sha256, jsonBytes };

export const SESSION_ID = "ses_fixture001";
export const COLLECTION_ID = "collection-001";

export const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

export function sessionInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SESSION_ID,
    projectID: "prj_fixture",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    outcome: "succeeded",
    time: { created: 1_000, updated: 5_000, busy: 1_000, idle: 5_000 },
    location: { type: "local" },
    ...overrides,
  };
}

export const sessionResponse = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ data: sessionInfo(overrides) });

export function userMessage(id: string, created = 1_000): Record<string, unknown> {
  return { id, type: "user", text: "do it", files: [], agents: [], skills: [], time: { created } };
}

export function toolPart(id: string, status: "completed" | "running" | "error" | "streaming" = "completed", executed?: boolean): Record<string, unknown> {
  const state =
    status === "completed" ? { status, input: {}, content: [{ type: "text", text: "ok" }] }
      : status === "running" ? { status, input: {}, metadata: {} }
        : status === "error" ? { status, input: {}, error: { type: "unknown", message: "x" } }
          : { status, input: "" };
  return { type: "tool", id, name: "bash", state, time: { created: 2_000 }, ...(executed === undefined ? {} : { executed }) };
}

export function assistantMessage(id: string, tools: ReadonlyArray<Record<string, unknown>> = [toolPart("tool_001")]): Record<string, unknown> {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "p", modelID: "m" },
    content: [{ type: "text", text: "working" }, ...tools],
    time: { created: 2_000, completed: 3_000 },
  };
}

export const idleMessage = (id: string): Record<string, unknown> => ({ id, type: "idle", outcome: "succeeded", time: { created: 4_000 } });

export const pageResponse = (data: ReadonlyArray<unknown>, next?: string): string =>
  JSON.stringify({ data, cursor: next === undefined ? {} : { next } });

export type PageSpec = Readonly<{
  pageIndex?: number;
  collectedAt?: string;
  request?: Record<string, unknown> | string; // object or raw JSON text
  response: string; // raw JSON text
}>;

export type SourceSpec = Readonly<{
  schemaVersion?: unknown;
  collectionId?: unknown;
  hostVersion?: unknown;
  sessionId?: unknown;
  session?: string; // raw `session` member object text
  sessionResponse?: string; // raw response text used when `session` is not overridden
  sessionAfter?: string; // raw member value text (default `null`)
  pages?: readonly PageSpec[];
  diff?: string; // raw member value text (default `null`)
  extra?: string; // raw extra members appended to the wrapper (e.g. duplicate keys)
}>;

export const firstRequest = (limit = 100): Record<string, unknown> => ({ sessionId: SESSION_ID, order: "asc", limit });
export const laterRequest = (cursor: string, limit = 100): Record<string, unknown> => ({ sessionId: SESSION_ID, cursor, limit });

export const defaultPages = (): PageSpec[] => [
  {
    request: firstRequest(),
    response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002"), idleMessage("msg_003")]),
  },
];

/** Build several linked pages from a flat Message list (opaque cursors `cur-<n>`). */
export function linkedPages(messages: ReadonlyArray<unknown>, perPage: number, limit = perPage): PageSpec[] {
  const pages: PageSpec[] = [];
  for (let i = 0; i * perPage < messages.length || (i === 0 && messages.length === 0); i++) {
    const chunk = messages.slice(i * perPage, (i + 1) * perPage);
    const hasNext = (i + 1) * perPage < messages.length;
    pages.push({
      request: i === 0 ? firstRequest(limit) : laterRequest(`cur-${i}`, limit),
      response: pageResponse(chunk, hasNext ? `cur-${i + 1}` : undefined),
    });
  }
  return pages;
}

const lit = (v: unknown): string => JSON.stringify(v);
const pick = (spec: SourceSpec, key: keyof SourceSpec, fallback: unknown): unknown => (Object.hasOwn(spec, key) ? spec[key] : fallback);

export function buildSource(spec: SourceSpec = {}): string {
  const pages = (spec.pages ?? defaultPages()).map((p, i) => {
    const req = typeof p.request === "string" ? p.request : lit(p.request ?? (i === 0 ? firstRequest() : laterRequest(`cur-${i}`)));
    return `{"pageIndex":${lit(p.pageIndex ?? i)},"collectedAt":${lit(p.collectedAt ?? "2026-11-09T08:00:00Z")},"request":${req},"response":${p.response}}`;
  });
  const session = spec.session ?? `{"collectedAt":"2026-11-09T07:59:59Z","response":${spec.sessionResponse ?? sessionResponse()}}`;
  const members = [
    `"schemaVersion":${lit(pick(spec, "schemaVersion", "justice-s2b-source-v1"))}`,
    `"collectionId":${lit(pick(spec, "collectionId", COLLECTION_ID))}`,
    `"hostVersion":${lit(pick(spec, "hostVersion", "2.2.5"))}`,
    `"sessionId":${lit(pick(spec, "sessionId", SESSION_ID))}`,
    `"session":${session}`,
    `"sessionAfter":${spec.sessionAfter ?? "null"}`,
    `"messagePages":[${pages.join(",")}]`,
    `"diff":${spec.diff ?? "null"}`,
  ];
  if (spec.extra) members.push(spec.extra);
  return `{${members.join(",")}}`;
}

export const sessionAfterMember = (): string => `{"collectedAt":"2026-11-09T08:00:02Z","response":${sessionResponse()}}`;

export const diffMember = (response: string): string =>
  `{"request":{"sessionId":${lit(SESSION_ID)},"from":"msg_001","to":"msg_001"},"collectedAt":"2026-11-09T08:00:01Z","response":${response}}`;

export const validDiffResponse = (): string =>
  JSON.stringify({ data: [{ file: "a.txt", patch: "@@", additions: 1, deletions: 0, status: "modified" }] });

export type BindingSpec = Readonly<{
  messageId: string;
  taskRef?: Readonly<{ artifactId: string; revision: string }>;
  scopeKey?: string;
  tools: ReadonlyArray<Readonly<{ toolId: string; acRef: Readonly<{ artifactId: string; revision: string }> }>>;
}>;

export function correlation(bindings: readonly BindingSpec[] = [defaultBinding()], sessionId: string = SESSION_ID): Record<string, unknown> {
  return {
    schemaVersion: "justice-s2b-correlation-v1",
    sessionId,
    messageBindings: bindings.map((b) => ({
      messageId: b.messageId,
      taskRef: b.taskRef ?? { artifactId: "task-1", revision: "R1" },
      scopeKey: b.scopeKey ?? "scope-1",
      tools: b.tools,
    })),
  };
}

export const defaultBinding = (): BindingSpec => ({
  messageId: "msg_002",
  tools: [{ toolId: "tool_001", acRef: { artifactId: "ac-1", revision: "R1" } }],
});

// ---------------------------------------------------------------------------
// Adapter fixtures (Task 5): one in-memory READ_ONLY spy source serving S1 Artifacts + saved S2-b inputs.
// ---------------------------------------------------------------------------

export const ADAPTER_PATHS = Object.freeze({
  manifestPath: "manifest",
  intentPath: "intent",
  artifactsRoot: "root",
  sourcePath: "s2b-source.json",
  correlationPath: "s2b-correlation.json",
});

export type InputRead = Readonly<{ path: string; maxBytes: number }>;
export type SpySource = Readonly<{
  readInputFile(path: string, maxBytes: number): Promise<Uint8Array>;
  readArtifact(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array>;
  inputReads: InputRead[];
}>;

export type AdapterFixtureSpec = Readonly<{
  sourceText?: string;
  correlationValue?: unknown;
  /** Successive TaskIntent payloads served on the 1st, 2nd, ... underlying intent read (the last one repeats). */
  intentBytes?: readonly Uint8Array[];
  /** `null` omits the caller-supplied Manifest digest; `undefined` uses the correct digest. */
  expectedManifestSha256?: string | null;
  paths?: Partial<{ -readonly [K in keyof typeof ADAPTER_PATHS]: string }>;
}>;

/** Adapter request + spy source over the shared S1-a fixture (task-1@R1, scope-1, ac-1 + ac-2). */
export function adapterFixture(spec: AdapterFixtureSpec = {}) {
  const s1 = s1aFixture();
  const paths = { ...ADAPTER_PATHS, ...spec.paths };
  const manifestBytes = jsonBytes(s1.manifest);
  const intents = spec.intentBytes ?? [jsonBytes(s1.intent)];
  const sourceBytes = enc(spec.sourceText ?? buildSource());
  const correlationBytes = jsonBytes(spec.correlationValue ?? correlation());
  let intentReads = 0;
  const inputReads: InputRead[] = [];
  const source: SpySource = {
    inputReads,
    async readInputFile(path, maxBytes) {
      inputReads.push({ path, maxBytes });
      let bytes: Uint8Array | undefined;
      if (path === paths.intentPath) {
        bytes = intents.at(Math.min(intentReads, intents.length - 1));
        intentReads++;
      } else if (path === paths.manifestPath) bytes = manifestBytes;
      else if (path === paths.sourcePath) bytes = sourceBytes;
      else if (path === paths.correlationPath) bytes = correlationBytes;
      if (bytes === undefined) throw new Error("unreadable");
      if (bytes.byteLength > maxBytes) throw Object.assign(new Error("over_limit"), { kind: "over_limit" });
      return bytes;
    },
    async readArtifact(root, relativePath, maxBytes) {
      return s1.source.readArtifact(root, relativePath, maxBytes);
    },
  };
  const expected = spec.expectedManifestSha256 === undefined ? sha256(manifestBytes) : spec.expectedManifestSha256;
  const request = Object.freeze({
    loaderInput: Object.freeze({
      manifestPath: paths.manifestPath,
      intentPath: paths.intentPath,
      artifactsRoot: paths.artifactsRoot,
      ...(expected === null ? {} : { expectedManifestSha256: expected }),
    }),
    sourcePath: paths.sourcePath,
    correlationPath: paths.correlationPath,
  });
  return { request, source, s1, paths, manifestBytes };
}
