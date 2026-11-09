import { describe, expect, it } from "vitest";
import { validateS2bCorrelation, validateS2bSource } from "../../src/runtime/s2b-input.js";
import type { DiagnosticCode, SourceResult } from "../../src/runtime/s2b-contract.js";
import {
  SESSION_ID, assistantMessage, buildSource, correlation, defaultBinding, defaultPages, diffMember, enc, firstRequest,
  idleMessage, laterRequest, linkedPages, pageResponse, sessionAfterMember, sessionResponse, toolPart, userMessage,
  validDiffResponse,
} from "./fixtures.js";

const source = (text: string): SourceResult => validateS2bSource(enc(text));
const codes = (r: { diagnostics: readonly { code: DiagnosticCode }[] }): DiagnosticCode[] => r.diagnostics.map((d) => d.code);

function expectRejected(r: SourceResult, code: DiagnosticCode): void {
  expect(r.state).toBe("REJECTED");
  expect(codes(r)).toContain(code);
}

function accepted(r: SourceResult): Extract<SourceResult, { state: "ACCEPTED" }>["value"] {
  if (r.state !== "ACCEPTED") throw new Error(`expected ACCEPTED, got ${JSON.stringify(r.diagnostics)}`);
  return r.value;
}

const twoPages = (): ReturnType<typeof defaultPages> => [
  { request: firstRequest(2), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002")], "cur-1") },
  { request: laterRequest("cur-1", 2), response: pageResponse([idleMessage("msg_003")]) },
];

describe("S2-b source validation", () => {
  it("acceptsMinimalCompleteCollection", () => {
    const v = accepted(source(buildSource()));
    expect(v.sessionId).toBe(SESSION_ID);
    expect(v.collectionId).toBe("collection-001");
    expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(v.lastValidatedPageIndex).toBe(0);
    expect(v.validatedPageCount).toBe(1);
    expect(v.messages.map((m) => m["id"])).toEqual(["msg_001", "msg_002", "msg_003"]);
    expect(Object.isFrozen(v.messages)).toBe(true);
    expect(Object.isFrozen(v.messages[1])).toBe(true);
  });

  it("sourceRejectsVersionFilterAndBadEnvelope", () => {
    // unknown / missing host version
    expectRejected(source(buildSource({ hostVersion: "2.2.6" })), "SOURCE_VERSION_UNSUPPORTED");
    expectRejected(source(buildSource({ hostVersion: null })), "SOURCE_VERSION_UNSUPPORTED");
    // any page request containing its own `type` key (including null) => filtered collection
    expectRejected(source(buildSource({ pages: [{ request: { ...firstRequest(), type: "assistant" }, response: pageResponse([]) }] })), "UNSUPPORTED_FILTERED_COLLECTION");
    expectRejected(source(buildSource({ pages: [{ request: { ...firstRequest(), type: null }, response: pageResponse([]) }] })), "UNSUPPORTED_FILTERED_COLLECTION");
    const filteredLater = twoPages();
    filteredLater[1] = { ...filteredLater[1]!, request: { ...laterRequest("cur-1", 2), type: null } };
    expectRejected(source(buildSource({ pages: filteredLater })), "UNSUPPORTED_FILTERED_COLLECTION");
    // initial cursor present (even null), subsequent order present
    expectRejected(source(buildSource({ pages: [{ request: { ...firstRequest(), cursor: "x" }, response: pageResponse([]) }] })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ pages: [{ request: { ...firstRequest(), cursor: null }, response: pageResponse([]) }] })), "SOURCE_SCHEMA_INVALID");
    const orderedLater = twoPages();
    orderedLater[1] = { ...orderedLater[1]!, request: { ...laterRequest("cur-1", 2), order: "asc" } };
    expectRejected(source(buildSource({ pages: orderedLater })), "SOURCE_SCHEMA_INVALID");
    // wrong Session ID: wrapper vs session.get, request
    expectRejected(source(buildSource({ sessionResponse: sessionResponse({ id: "ses_other" }) })), "SOURCE_IDENTITY_MISMATCH");
    expectRejected(source(buildSource({ pages: [{ request: { ...firstRequest(), sessionId: "ses_other" }, response: pageResponse([]) }] })), "SOURCE_IDENTITY_MISMATCH");
    const otherLater = twoPages();
    otherLater[1] = { ...otherLater[1]!, request: { ...laterRequest("cur-1", 2), sessionId: "ses_other" } };
    expectRejected(source(buildSource({ pages: otherLater })), "SOURCE_IDENTITY_MISMATCH");
    expectRejected(source(buildSource({ sessionAfter: `{"collectedAt":"2026-11-09T08:00:02Z","response":${sessionResponse({ id: "ses_other" })}}` })), "SOURCE_IDENTITY_MISMATCH");
    // exported format / foreign schema
    expectRejected(source(JSON.stringify({ info: { id: SESSION_ID }, messages: [] })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ schemaVersion: "opencode-export" })), "SOURCE_SCHEMA_INVALID");
    // bad envelopes
    expectRejected(source(buildSource({ sessionResponse: JSON.stringify(sessionInfoOnly()) })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(), response: JSON.stringify({ data: [], cursor: {}, extra: 1 }) }] })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(), response: JSON.stringify({ data: [{ id: "msg_1", type: "mystery", time: { created: 1 } }], cursor: {} }) }] })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ extra: `"unexpected":1` })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source("not json"), "SOURCE_SCHEMA_INVALID");
    // duplicate keys per parse unit: wrapper / session.response / first page response
    expectRejected(source(buildSource({ extra: `"collectionId":"collection-002"` })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ sessionResponse: sessionResponse().replace('"id":', `"id":"${SESSION_ID}","id":`) })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(), response: `{"data":[],"cursor":{},"cursor":{}}` }] })), "SOURCE_SCHEMA_INVALID");
  });
});

function sessionInfoOnly(): Record<string, unknown> {
  return JSON.parse(sessionResponse()).data as Record<string, unknown>;
}

describe("S2-b correlation validation", () => {
  it("acceptsAndPreservesBindings", () => {
    const r = validateS2bCorrelation(enc(JSON.stringify(correlation())));
    if (r.state !== "ACCEPTED") throw new Error("expected ACCEPTED");
    expect(r.sessionId).toBe(SESSION_ID);
    expect(r.bindings).toEqual([{ messageId: "msg_002", taskRef: { artifactId: "task-1", revision: "R1" }, scopeKey: "scope-1", tools: [{ toolId: "tool_001", acRef: { artifactId: "ac-1", revision: "R1" } }] }]);
  });
});

// ---------------------------------------------------------------------------
// Step 4: limits and per-parse-unit failures
// ---------------------------------------------------------------------------

const MiB = 1_048_576;
/** Pad an ASCII JSON object text with insignificant whitespace to an exact raw byte length. */
const padTo = (json: string, bytes: number): string => {
  if (json.length > bytes) throw new Error("fixture larger than target");
  return `{${" ".repeat(bytes - json.length)}${json.slice(1)}`;
};
const userMessages = (n: number, prefix = "u"): Record<string, unknown>[] =>
  Array.from({ length: n }, (_, i) => userMessage(`msg_${prefix}${String(i).padStart(5, "0")}`));
type CorrResult = ReturnType<typeof validateS2bCorrelation>;
const corr = (value: unknown): CorrResult => validateS2bCorrelation(enc(JSON.stringify(value)));
const corrRejected = (r: CorrResult, code: DiagnosticCode): void => {
  expect(r.state).toBe("REJECTED");
  expect(codes(r)).toContain(code);
};
const tools = (n: number, prefix: string): { toolId: string; acRef: { artifactId: string; revision: string } }[] =>
  Array.from({ length: n }, (_, i) => ({ toolId: `${prefix}_${i}`, acRef: { artifactId: "ac-1", revision: "R1" } }));
const bindings = (n: number, toolsPer: number): { messageId: string; tools: ReturnType<typeof tools> }[] =>
  Array.from({ length: n }, (_, i) => ({ messageId: `msg_b${i}`, tools: tools(toolsPer, `t${i}`) }));

describe("S2-b fail-closed limits", () => {
  it("sourceLimitsAreFailClosed: session response 1MiB+1 (raw span, whitespace counted)", () => {
    expect(accepted(source(buildSource({ sessionResponse: padTo(sessionResponse(), MiB) }))).collectionStatus).toBe("PAGINATION_COMPLETE");
    expectRejected(source(buildSource({ sessionResponse: padTo(sessionResponse(), MiB + 1) })), "INPUT_LIMIT_EXCEEDED");
    expectRejected(source(buildSource({ sessionAfter: `{"collectedAt":"2026-11-09T08:00:02Z","response":${padTo(sessionResponse(), MiB + 1)}}` })), "INPUT_LIMIT_EXCEEDED");
  });

  it("sourceLimitsAreFailClosed: escaped UTF-8 raw span is measured, not JSON.stringify()", () => {
    const escaped = "\\u3042".repeat(Math.ceil(MiB / 6) + 10);
    const raw = sessionResponse({ title: "T" }).replace('"title":"T"', `"title":"${escaped}"`);
    expect(enc(raw).byteLength).toBeGreaterThan(MiB);
    // Re-serialization would under-count (6-byte escapes become 3-byte UTF-8) and wrongly pass.
    expect(enc(JSON.stringify(JSON.parse(raw))).byteLength).toBeLessThan(MiB);
    expectRejected(source(buildSource({ sessionResponse: raw })), "INPUT_LIMIT_EXCEEDED");
  });

  it("sourceLimitsAreFailClosed: page 4MiB+1, 65 pages, total >64MiB, wrapper >72MiB", () => {
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(), response: padTo(pageResponse([userMessage("msg_001")]), 4 * MiB + 1) }] })), "INPUT_LIMIT_EXCEEDED");
    // Oversize later page is still a global rejection even after an earlier local page defect.
    const hidden = twoPages();
    hidden[1] = { ...hidden[1]!, response: `{"data":[],"cursor":{},"cursor":{}}` };
    hidden.push({ request: laterRequest("cur-2", 2), response: padTo(pageResponse([]), 4 * MiB + 1) });
    expectRejected(source(buildSource({ pages: hidden })), "INPUT_LIMIT_EXCEEDED");
    expectRejected(source(buildSource({ pages: linkedPages(userMessages(65), 1) })), "INPUT_LIMIT_EXCEEDED");
    expect(accepted(source(buildSource({ pages: linkedPages(userMessages(64), 1) }))).validatedPageCount).toBe(64);
    const big = linkedPages(userMessages(17), 1).map((p) => ({ ...p, response: padTo(p.response, 4 * MiB - 1024) }));
    const bigText = buildSource({ pages: big });
    expect(bigText.length).toBeLessThan(72 * MiB);
    expectRejected(source(bigText), "INPUT_LIMIT_EXCEEDED");
    const oversizedWrapper = new Uint8Array(72 * MiB + 1).fill(0x20);
    expectRejected(validateS2bSource(oversizedWrapper), "INPUT_LIMIT_EXCEEDED");
  }, 60_000);

  it("sourceLimitsAreFailClosed: page 201 messages, collection 4097 messages", () => {
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(200), response: pageResponse(userMessages(201)) }] })), "INPUT_LIMIT_EXCEEDED");
    const later201 = [
      { request: firstRequest(200), response: pageResponse(userMessages(1, "a"), "cur-1") },
      { request: laterRequest("cur-1", 200), response: pageResponse(userMessages(201, "b")) },
    ];
    expectRejected(source(buildSource({ pages: later201 })), "INPUT_LIMIT_EXCEEDED");
    expectRejected(source(buildSource({ pages: linkedPages(userMessages(4097), 200) })), "INPUT_LIMIT_EXCEEDED");
    const ok = accepted(source(buildSource({ pages: linkedPages(userMessages(4096), 200) })));
    expect(ok.messages).toHaveLength(4096);
    expect(ok.collectionStatus).toBe("PAGINATION_COMPLETE");
  });

  it("sourceLimitsAreFailClosed: correlation 256KiB+1, binding 513, tools per message 65, tools total 2049", () => {
    const base = JSON.stringify(correlation());
    expect(validateS2bCorrelation(enc(padTo(base, 262_144))).state).toBe("ACCEPTED");
    corrRejected(validateS2bCorrelation(enc(padTo(base, 262_145))), "INPUT_LIMIT_EXCEEDED");
    expect(corr(correlation(bindings(512, 0))).state).toBe("ACCEPTED");
    corrRejected(corr(correlation(bindings(513, 0))), "INPUT_LIMIT_EXCEEDED");
    expect(corr(correlation(bindings(1, 64))).state).toBe("ACCEPTED");
    corrRejected(corr(correlation(bindings(1, 65))), "INPUT_LIMIT_EXCEEDED");
    const total2048 = bindings(32, 64);
    expect(corr(correlation(total2048)).state).toBe("ACCEPTED");
    corrRejected(corr(correlation([...total2048, { messageId: "msg_extra", tools: tools(1, "x") }])), "INPUT_LIMIT_EXCEEDED");
  });

  it("sourceLimitsAreFailClosed: Diff 2MiB+1 only makes the Diff unavailable", () => {
    const v = accepted(source(buildSource({ sessionAfter: sessionAfterMember(), diff: diffMember(padTo(validDiffResponse(), 2 * MiB + 1)) })));
    expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(v.messages).toHaveLength(3);
    expect(codes(v)).toEqual(["DIFF_UNAVAILABLE"]);
  });
});

describe("S2-b per-parse-unit failures", () => {
  it("wrapperDuplicateKeyRejected", () => {
    expectRejected(source(buildSource({ extra: `"hostVersion":"2.2.5"` })), "SOURCE_SCHEMA_INVALID");
    // duplicate key inside wrapper page metadata (not in a Response)
    expectRejected(source(buildSource({ pages: [{ request: `{"sessionId":"${SESSION_ID}","order":"asc","limit":100,"limit":100}`, response: pageResponse([]) }] })), "SOURCE_SCHEMA_INVALID");
    // duplicate `response` member of the session wrapper object
    expectRejected(source(buildSource({ session: `{"collectedAt":"2026-11-09T07:59:59Z","response":${sessionResponse()},"response":${sessionResponse()}}` })), "SOURCE_SCHEMA_INVALID");
  });

  it("sessionResponseDuplicateKeyRejected", () => {
    const info = JSON.stringify(sessionInfoOnly());
    expectRejected(source(buildSource({ sessionResponse: `{"data":${info},"data":${info}}` })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ sessionAfter: `{"collectedAt":"2026-11-09T08:00:02Z","response":${sessionResponse().replace('"cost":0', '"cost":0,"cost":0')}}` })), "SOURCE_SCHEMA_INVALID");
  });

  it("firstPageDuplicateKeyRejected", () => {
    const dup = pageResponse([userMessage("msg_001")]).replace('"type":"user"', '"type":"user","type":"user"');
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(), response: dup }] })), "SOURCE_SCHEMA_INVALID");
  });

  it("diffResponseDuplicateKeyOnlyUnavailable", () => {
    const dup = validDiffResponse().replace('"file":"a.txt"', '"file":"a.txt","file":"b.txt"');
    const v = accepted(source(buildSource({ sessionAfter: sessionAfterMember(), diff: diffMember(dup) })));
    expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(v.messages.map((m) => m["id"])).toEqual(["msg_001", "msg_002", "msg_003"]);
    expect(codes(v)).toEqual(["DIFF_UNAVAILABLE"]);
    // malformed Diff metadata is also Diff-only
    expect(source(buildSource({ diff: `{"request":7,"response":${validDiffResponse()}}` })).state).toBe("ACCEPTED");
  });

  it("laterPageDuplicateKeyIsLocalToThatPage", () => {
    const pages = twoPages();
    pages[1] = { ...pages[1]!, response: `{"data":[],"cursor":{},"cursor":{}}` };
    const v = accepted(source(buildSource({ pages })));
    expect(v.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(v.validatedPageCount).toBe(1);
    expect(v.lastValidatedPageIndex).toBe(0);
    expect(v.messages.map((m) => m["id"])).toEqual(["msg_001", "msg_002"]);
    expect(codes(v)).toEqual(expect.arrayContaining(["PAGINATION_INCOMPLETE", "SOURCE_SCHEMA_INVALID"]));
  });

  it("unidentifiableWrapperBoundaryRejected", () => {
    const later = (response: string): string => {
      const pages = twoPages();
      pages[1] = { ...pages[1]!, response };
      return buildSource({ pages });
    };
    expectRejected(source(later(`{"data":[}`)), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(later(`{"data":["unterminated]}`)), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ sessionAfter: sessionAfterMember(), diff: diffMember(`{"data":[}`) })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource().slice(0, -1)), "SOURCE_SCHEMA_INVALID");
    expectRejected(validateS2bSource(new Uint8Array([0x7b, 0xff, 0x7d])), "SOURCE_SCHEMA_INVALID");
    // balanced but grammatically broken later page: boundary is identifiable, so only that page is dropped
    expect(accepted(source(later(`{"data":[1 2],"cursor":{}}`))).collectionStatus).toBe("PAGINATION_INCOMPLETE");
  });
});

describe("S2-b v2.2.5 shapes", () => {
  it("validatesAssistantToolAndStateShapes", () => {
    const withTool = (tool: Record<string, unknown>): SourceResult =>
      source(buildSource({ pages: [{ request: firstRequest(), response: pageResponse([assistantMessage("msg_002", [tool])]) }] }));
    for (const status of ["completed", "running", "error", "streaming"] as const) expect(withTool(toolPart("tool_1", status)).state).toBe("ACCEPTED");
    expect(withTool(toolPart("tool_1", "completed", true)).state).toBe("ACCEPTED");
    const noId = toolPart("tool_1");
    delete noId["id"];
    expectRejected(withTool(noId), "SOURCE_SCHEMA_INVALID");
    expectRejected(withTool({ ...toolPart("tool_1"), state: { status: "completed", input: {}, content: [] } }), "SOURCE_SCHEMA_INVALID");
    expectRejected(withTool({ ...toolPart("tool_1"), state: { status: "done", input: {} } }), "SOURCE_SCHEMA_INVALID");
    expectRejected(withTool({ ...toolPart("tool_1"), executed: "yes" }), "SOURCE_SCHEMA_INVALID");
    // missing required Session.Info field is not filled in
    const noProject = sessionInfoOnly();
    delete noProject["projectID"];
    expectRejected(source(buildSource({ sessionResponse: JSON.stringify({ data: noProject }) })), "SOURCE_SCHEMA_INVALID");
    // optional fields are not nullable
    expectRejected(source(buildSource({ sessionResponse: sessionResponse({ outcome: null }) })), "SOURCE_SCHEMA_INVALID");
  });
});

describe("S2-b correlation structure", () => {
  it("preservesDuplicatesForProjectorButRejectsStructuralDefects", () => {
    const dup = corr(correlation([defaultBinding(), defaultBinding()]));
    if (dup.state !== "ACCEPTED") throw new Error("expected ACCEPTED");
    expect(dup.bindings).toHaveLength(2);
    expect(Object.isFrozen(dup.bindings[0]!.tools)).toBe(true);
    corrRejected(validateS2bCorrelation(enc(`{"schemaVersion":"justice-s2b-correlation-v1","sessionId":"${SESSION_ID}","messageBindings":[],"messageBindings":[]}`)), "SOURCE_SCHEMA_INVALID");
    corrRejected(corr({ ...correlation(), schemaVersion: "x" }), "SOURCE_SCHEMA_INVALID");
    corrRejected(corr(correlation([{ ...defaultBinding(), scopeKey: "../bad" }])), "SOURCE_SCHEMA_INVALID");
    corrRejected(corr(correlation([{ ...defaultBinding(), taskRef: { artifactId: "task 1", revision: "R1" } }])), "SOURCE_SCHEMA_INVALID");
    corrRejected(corr(correlation([{ messageId: "msg_002", tools: [{ toolId: "", acRef: { artifactId: "ac-1", revision: "R1" } }] }])), "SOURCE_SCHEMA_INVALID");
  });
});

// ---------------------------------------------------------------------------
// Task 2: contiguous page collection / completeness
// ---------------------------------------------------------------------------

const ids = (v: { messages: readonly { [k: string]: unknown }[] }): unknown[] => v.messages.map((m) => m["id"]);
const threePages = (): ReturnType<typeof defaultPages> => [
  { request: firstRequest(1), response: pageResponse([userMessage("msg_001")], "cur-1") },
  { request: laterRequest("cur-1", 1), response: pageResponse([userMessage("msg_002")], "cur-2") },
  { request: laterRequest("cur-2", 1), response: pageResponse([userMessage("msg_003")]) },
];

describe("S2-b contiguous pagination", () => {
  it("paginationRequiresOpaqueNextCursor", () => {
    const v = accepted(source(buildSource({ pages: threePages() })));
    expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(v.validatedPageCount).toBe(3);
    expect(v.lastValidatedPageIndex).toBe(2);
    expect(ids(v)).toEqual(["msg_001", "msg_002", "msg_003"]);
    // limit bounds 1..200, constant across pages
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(0), response: pageResponse([]) }] })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(201), response: pageResponse([]) }] })), "SOURCE_SCHEMA_INVALID");
    const varying = threePages();
    varying[1] = { ...varying[1]!, request: laterRequest("cur-1", 2) };
    expectRejected(source(buildSource({ pages: varying })), "SOURCE_SCHEMA_INVALID");
    // later request must contain neither order nor type; cursor must be a non-empty string
    const withOrder = threePages();
    withOrder[1] = { ...withOrder[1]!, request: { ...laterRequest("cur-1", 1), order: "asc" } };
    expectRejected(source(buildSource({ pages: withOrder })), "SOURCE_SCHEMA_INVALID");
    const emptyCursor = threePages();
    emptyCursor[1] = { ...emptyCursor[1]!, request: laterRequest("", 1) };
    expectRejected(source(buildSource({ pages: emptyCursor })), "SOURCE_SCHEMA_INVALID");
    // opaque cursor.next must be a non-empty string; empty `next` is a malformed response
    const emptyNext = twoPages();
    emptyNext[0] = { ...emptyNext[0]!, response: pageResponse([userMessage("msg_001")], "") };
    expectRejected(source(buildSource({ pages: emptyNext })), "SOURCE_SCHEMA_INVALID");
    // a page holding more Messages than the constant request limit is not trusted
    const overfull = [{ request: firstRequest(1), response: pageResponse([userMessage("msg_001"), userMessage("msg_002")]) }];
    expectRejected(source(buildSource({ pages: overfull })), "SOURCE_SCHEMA_INVALID");
    const overfullLater = threePages();
    overfullLater[1] = { ...overfullLater[1]!, response: pageResponse([userMessage("msg_002"), userMessage("msg_0021")], "cur-2") };
    const cut = accepted(source(buildSource({ pages: overfullLater })));
    expect(cut.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(ids(cut)).toEqual(["msg_001"]);
    expect(codes(cut)).toEqual(expect.arrayContaining(["PAGINATION_INCOMPLETE", "SOURCE_SCHEMA_INVALID"]));
  });

  it("missingPageKeepsOnlyVerifiedPrefix", () => {
    // saved collection stops while the last page still advertises `next`
    const a = accepted(source(buildSource({ pages: threePages().slice(0, 2) })));
    expect(a.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(a.validatedPageCount).toBe(2);
    expect(a.lastValidatedPageIndex).toBe(1);
    expect(ids(a)).toEqual(["msg_001", "msg_002"]);
    expect(codes(a)).toContain("PAGINATION_INCOMPLETE");
    // pageIndex gap (page 2 missing, page 3 present): only the prefix survives
    const gap = threePages();
    gap[2] = { ...gap[2]!, pageIndex: 3 };
    const b = accepted(source(buildSource({ pages: gap })));
    expect(b.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(b.lastValidatedPageIndex).toBe(1);
    expect(ids(b)).toEqual(["msg_001", "msg_002"]);
    // first page index not 0 is not a prefix at all
    const shifted = threePages();
    shifted[0] = { ...shifted[0]!, pageIndex: 1 };
    expectRejected(source(buildSource({ pages: shifted })), "SOURCE_SCHEMA_INVALID");
  });

  it("cursorMismatchOrCycleNeverConjuresLaterMessage", () => {
    const mismatch = threePages();
    mismatch[1] = { ...mismatch[1]!, request: laterRequest("cur-other", 1) };
    const a = accepted(source(buildSource({ pages: mismatch })));
    expect(a.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(ids(a)).toEqual(["msg_001"]);
    // cycle: page 2 reuses the cursor already consumed by page 1
    const cycle = threePages();
    cycle[1] = { ...cycle[1]!, response: pageResponse([userMessage("msg_002")], "cur-1") };
    cycle[2] = { ...cycle[2]!, request: laterRequest("cur-1", 1) };
    const b = accepted(source(buildSource({ pages: cycle })));
    expect(b.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(ids(b)).toEqual(["msg_001", "msg_002"]);
    // a later page arriving after a final page (no `next`) cannot be chained
    const afterEnd = twoPages();
    afterEnd[0] = { ...afterEnd[0]!, response: pageResponse([userMessage("msg_001")]) };
    const c = accepted(source(buildSource({ pages: afterEnd })));
    expect(c.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(ids(c)).toEqual(["msg_001"]);
    // cursor.previous never completes anything: a request cursor equal to previous (not next) is a mismatch
    const prev = twoPages();
    prev[0] = { ...prev[0]!, response: JSON.stringify({ data: [userMessage("msg_001")], cursor: { previous: "cur-1", next: "cur-x" } }) };
    const d = accepted(source(buildSource({ pages: prev })));
    expect(d.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(ids(d)).toEqual(["msg_001"]);
    // `previous` alone does not make a page non-final: next absent => complete, previous is ignored
    const onlyPrev = [{ request: firstRequest(), response: JSON.stringify({ data: [userMessage("msg_001")], cursor: { previous: "cur-0" } }) }];
    expect(accepted(source(buildSource({ pages: onlyPrev }))).collectionStatus).toBe("PAGINATION_COMPLETE");
  });

  it("completeCollectionMissingIdIsDefinitiveOnlyForSavedCollection", () => {
    const v = accepted(source(buildSource({ pages: threePages() })));
    expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
    // a Message absent from the complete saved collection is simply not in Source.messages
    expect(ids(v)).not.toContain("msg_999");
    expect(Object.isFrozen(v.messages)).toBe(true);
    // PAGINATION_COMPLETE says nothing about Host history: no diagnostic claims otherwise
    expect(codes(v)).toEqual(["DIFF_UNAVAILABLE"]);
  });

  it("incompleteCollectionDoesNotClaimMissingMessage", () => {
    const v = accepted(source(buildSource({ pages: threePages().slice(0, 1) })));
    expect(v.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(ids(v)).toEqual(["msg_001"]);
    // the Source never asserts MISSING_MESSAGE; absence in an incomplete prefix is unknown, not missing
    expect(codes(v)).not.toContain("MISSING_MESSAGE");
  });

  it("childSessionCannotJoinParent", () => {
    const child = "ses_child001";
    // child wrapper cannot carry parent's Session GET or parent's page requests
    expectRejected(source(buildSource({ sessionId: child })), "SOURCE_IDENTITY_MISMATCH");
    expectRejected(source(buildSource({ sessionId: child, sessionResponse: sessionResponse({ id: child }) })), "SOURCE_IDENTITY_MISMATCH");
    const childPages = [{ request: { ...firstRequest(), sessionId: child }, response: pageResponse([userMessage("msg_c1")]) }];
    expectRejected(source(buildSource({ sessionId: child, pages: childPages })), "SOURCE_IDENTITY_MISMATCH");
    // a consistent child Source is its own Source: its sessionId differs and its Messages never appear in the parent's
    const ok = accepted(source(buildSource({ sessionId: child, sessionResponse: sessionResponse({ id: child }), pages: childPages })));
    const parent = accepted(source(buildSource()));
    expect(ok.sessionId).toBe(child);
    expect(parent.sessionId).toBe(SESSION_ID);
    expect(ids(parent)).not.toContain("msg_c1");
    // parentID on the child Session.Info does not turn it into the parent's Source
    expectRejected(source(buildSource({ sessionResponse: sessionResponse({ id: child, parentID: SESSION_ID }) })), "SOURCE_IDENTITY_MISMATCH");
    // a Correlation for another session id is a distinct, non-joinable document
    const corrChild = validateS2bCorrelation(enc(JSON.stringify(correlation([defaultBinding()], child))));
    if (corrChild.state !== "ACCEPTED") throw new Error("expected ACCEPTED");
    expect(corrChild.sessionId).not.toBe(parent.sessionId);
  });

  it("laterPageDuplicateKeyKeepsOnlyValidatedPrefix", () => {
    const pages = threePages();
    pages[1] = { ...pages[1]!, response: pageResponse([userMessage("msg_002")], "cur-2").replace('"type":"user"', '"type":"user","type":"user"') };
    const v = accepted(source(buildSource({ pages })));
    expect(v.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    expect(v.validatedPageCount).toBe(1);
    expect(v.lastValidatedPageIndex).toBe(0);
    expect(ids(v)).toEqual(["msg_001"]);
    expect(codes(v)).toEqual(expect.arrayContaining(["PAGINATION_INCOMPLETE", "SOURCE_SCHEMA_INVALID"]));
    // duplicate Message ID across pages: later page cut with CONFLICT; on page 0 => REJECTED
    const dupId = threePages();
    dupId[1] = { ...dupId[1]!, response: pageResponse([userMessage("msg_001")], "cur-2") };
    const d = accepted(source(buildSource({ pages: dupId })));
    expect(ids(d)).toEqual(["msg_001"]);
    expect(codes(d)).toEqual(expect.arrayContaining(["PAGINATION_INCOMPLETE", "CONFLICT"]));
    expectRejected(source(buildSource({ pages: [{ request: firstRequest(), response: pageResponse([userMessage("msg_001"), userMessage("msg_001")]) }] })), "CONFLICT");
  });
  it("shortFinalPageWithLimitGreaterThanOneIsComplete", () => {
    // limit 3: a full first page with `next`, then a short (1 < limit) final page without `next`.
    const pages = [
      { request: firstRequest(3), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002"), userMessage("msg_003")], "cur-1") },
      { request: laterRequest("cur-1", 3), response: pageResponse([idleMessage("msg_004")]) },
    ];
    const v = accepted(source(buildSource({ pages })));
    expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(v.validatedPageCount).toBe(2);
    expect(v.lastValidatedPageIndex).toBe(1);
    expect(ids(v)).toEqual(["msg_001", "msg_002", "msg_003", "msg_004"]);
    expect(codes(v)).toEqual(["DIFF_UNAVAILABLE"]);
    // A short final page whose request limit differs from the first page is not chained.
    const varying = [pages[0]!, { ...pages[1]!, request: laterRequest("cur-1", 2) }];
    expectRejected(source(buildSource({ pages: varying })), "SOURCE_SCHEMA_INVALID");
  });
});
