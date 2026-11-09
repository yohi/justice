// Branch coverage for the fixed v2.2.5 shape validation in s2b-input.ts:
// every accepted variant and every rejecting variant is asserted explicitly.
import { describe, expect, it } from "vitest";
import { validateS2bCorrelation, validateS2bSource } from "../../src/runtime/s2b-input.js";
import type { DiagnosticCode, SourceResult } from "../../src/runtime/s2b-contract.js";
import {
  assistantMessage, buildSource, correlation, defaultPages, diffMember, enc, firstRequest, idleMessage, laterRequest,
  pageResponse, sessionAfterMember, sessionInfo, sessionResponse, toolPart, userMessage, validDiffResponse,
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
const pageOf = (messages: ReadonlyArray<unknown>): string =>
  buildSource({ pages: [{ request: firstRequest(), response: pageResponse(messages) }] });

// Free-form JSON mutation helper: tests deliberately poke arbitrary paths of a parsed wrapper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const mutateWrapper = (mutate: (w: Json) => void, base: string = buildSource()): SourceResult => {
  const w = JSON.parse(base) as Json;
  mutate(w);
  return source(JSON.stringify(w));
};
const t = { created: 1 };

describe("S2-b fixed v2.2.5 shapes", () => {
  it("acceptsEveryMessageVariantAndToolState", () => {
    const messages = [
      { id: "msg_101", type: "agent-switched", agent: "build", time: t },
      { id: "msg_102", type: "model-switched", model: {}, time: t },
      { id: "msg_103", type: "location-switched", location: {}, time: t },
      { id: "msg_104", type: "user", text: "x", time: t },
      { id: "msg_105", type: "synthetic", text: "x", time: t },
      { id: "msg_106", type: "system", text: "x", time: t },
      { id: "msg_107", type: "skill", skill: "s", name: "n", text: "x", time: t },
      { id: "msg_108", type: "shell", shellID: "sh", command: "ls", status: "done", time: { created: 1, completed: 2 } },
      { id: "msg_109", type: "compaction", status: "running", reason: "auto", summary: "s", time: t },
      { id: "msg_110", type: "compaction", status: "completed", reason: "manual", summary: "s", time: t },
      { id: "msg_111", type: "compaction", status: "failed", reason: "auto", error: {}, time: t },
      idleMessage("msg_112"),
      {
        ...assistantMessage("msg_113"),
        content: [
          { type: "reasoning", text: "r", time: t },
          { type: "reasoning", text: "r" },
          { type: "text", text: "x" },
          toolPart("t1", "streaming"), toolPart("t2", "running"), toolPart("t3", "error"), toolPart("t4", "completed", true),
        ],
        snapshot: { start: "a", end: "b" },
        metadata: {},
      },
    ];
    const v = accepted(source(pageOf(messages)));
    expect(v.messages).toHaveLength(messages.length);
    expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
  });

  it("rejectsEachMalformedMessageVariant", () => {
    const bad = (message: unknown): void => expectRejected(source(pageOf([message])), "SOURCE_SCHEMA_INVALID");
    const tool = (over: Record<string, unknown>): Record<string, unknown> => ({ ...assistantMessage("msg_201"), content: [{ ...toolPart("t1"), ...over }] });
    bad({ id: "msg_201", type: "agent-switched", agent: "", time: t });
    bad({ id: "msg_201", type: "model-switched", model: "x", time: t });
    bad({ id: "msg_201", type: "location-switched", location: 1, time: t });
    bad({ id: "msg_201", type: "user", time: t });
    bad({ id: "msg_201", type: "skill", skill: "s", text: "x", time: t });
    bad({ id: "msg_201", type: "shell", shellID: "s", command: "c", time: t });
    bad({ id: "msg_201", type: "shell", shellID: "s", command: "c", status: "d", time: { created: 1, completed: "x" } });
    bad({ id: "msg_201", type: "compaction", status: "weird", time: t });
    bad({ id: "msg_201", type: "compaction", status: "running", reason: "bad", summary: "s", time: t });
    bad({ id: "msg_201", type: "compaction", status: "failed", reason: "auto", time: t });
    bad({ id: "msg_201", type: "idle", outcome: "nope", time: t });
    bad({ id: "msg_201", type: "zzz", time: t });
    bad({ id: "bad id", type: "idle", outcome: "succeeded", time: t });
    bad({ id: "msg_201", type: "idle", outcome: "succeeded" });
    bad({ id: "msg_201", type: "idle", outcome: "succeeded", time: t, metadata: 1 });
    bad("msg_201");
    bad({ ...assistantMessage("msg_201"), agent: "" });
    bad({ ...assistantMessage("msg_201"), snapshot: { start: 1 } });
    bad({ ...assistantMessage("msg_201"), time: { created: 1, completed: "x" } });
    bad({ ...assistantMessage("msg_201"), content: [{ type: "zzz" }] });
    bad({ ...assistantMessage("msg_201"), content: ["x"] });
    bad({ ...assistantMessage("msg_201"), content: [{ type: "text" }] });
    bad({ ...assistantMessage("msg_201"), content: [{ type: "reasoning" }] });
    bad({ ...assistantMessage("msg_201"), content: [{ type: "reasoning", text: "r", time: 1 }] });
    bad(tool({ id: "" }));
    bad(tool({ executed: "yes" }));
    bad(tool({ native: 1 }));
    bad(tool({ time: undefined }));
    bad(tool({ time: { created: 1, ran: "x" } }));
    bad(tool({ state: "x" }));
    bad(tool({ state: { status: "zzz" } }));
    bad(tool({ state: { status: "streaming", input: {} } }));
    bad(tool({ state: { status: "running", input: {} } }));
    bad(tool({ state: { status: "completed", input: {}, content: [] } }));
    bad(tool({ state: { status: "completed", input: {}, content: [{}], metadata: 1 } }));
    bad(tool({ state: { status: "error", input: {} } }));
    bad(tool({ state: { status: "error", input: {}, error: {}, content: [] } }));
  });

  it("rejectsEachMalformedSessionResponse", () => {
    const badSession = (overrides: Record<string, unknown>): void =>
      expectRejected(source(buildSource({ sessionResponse: sessionResponse(overrides) })), "SOURCE_SCHEMA_INVALID");
    badSession({ projectID: "" });
    badSession({ cost: "x" });
    badSession({ tokens: "x" });
    badSession({ location: "x" });
    badSession({ time: "x" });
    badSession({ time: { created: "x", updated: 1 } });
    badSession({ time: { created: 1, updated: 1, extra: 1 } });
    badSession({ time: { created: 1, updated: 1, busy: "x" } });
    badSession({ parentID: "bad id" });
    badSession({ fork: "x" });
    badSession({ agent: 1 });
    badSession({ model: 1 });
    badSession({ outcome: "bogus" });
    badSession({ title: 1 });
    badSession({ subpath: 1 });
    badSession({ metadata: 1 });
    badSession({ permissions: 1 });
    badSession({ revert: 1 });
    badSession({ unknownKey: 1 });
    const full = sessionResponse({ parentID: "ses_parent", fork: {}, agent: "a", model: {}, title: "t", subpath: "s", metadata: {}, permissions: [], revert: {} });
    expect(source(buildSource({ sessionResponse: full })).state).toBe("ACCEPTED");
    expect(source(buildSource({ sessionResponse: sessionResponse({ permissions: {} }) })).state).toBe("ACCEPTED");
    expectRejected(source(buildSource({ sessionResponse: '{"data":1,"data":2}' })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ sessionResponse: `{"data":${JSON.stringify(sessionInfo())},"x":1}` })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ sessionResponse: '{"data":1}' })), "SOURCE_SCHEMA_INVALID");
    const after = (response: string): string => `{"collectedAt":"2026-11-09T08:00:02Z","response":${response}}`;
    expectRejected(source(buildSource({ sessionAfter: after(sessionResponse({ cost: "x" })) })), "SOURCE_SCHEMA_INVALID");
    expectRejected(source(buildSource({ sessionAfter: after(sessionResponse({ id: "ses_other" })) })), "SOURCE_IDENTITY_MISMATCH");
    expect(source(buildSource({ sessionAfter: sessionAfterMember() })).state).toBe("ACCEPTED");
  });

  it("rejectsMalformedWrapperStructure", () => {
    const rejects = (r: SourceResult, code: DiagnosticCode = "SOURCE_SCHEMA_INVALID"): void => expectRejected(r, code);
    rejects(source(`${buildSource()} x`));
    rejects(source(buildSource().slice(0, -5)));
    rejects(source(buildSource().replace(',"collectionId"', ' "collectionId"')));
    rejects(source(buildSource({ extra: '"\\q":1' })));
    rejects(source(buildSource({ extra: "5:1" })));
    rejects(source(buildSource({ extra: '"x":' })));
    rejects(source(buildSource({ extra: '"x":}' })));
    rejects(source(buildSource({ extra: '"x":[1}' })));
    rejects(source(buildSource({ extra: '"x":"unterminated' })));
    rejects(source("[]"));
    rejects(source("null"));
    rejects(source(buildSource({ schemaVersion: "justice-s2b-source-v0" })));
    rejects(source(buildSource({ extra: '"unknownKey":1' })));
    rejects(mutateWrapper((w) => delete w["collectionId"]));
    rejects(mutateWrapper((w) => (w["messagePages"] = 5)));
    rejects(mutateWrapper((w) => (w["messagePages"] = [])));
    rejects(mutateWrapper((w) => (w["messagePages"] = Array.from({ length: 65 }, () => w["messagePages"][0]))), "INPUT_LIMIT_EXCEEDED");
    rejects(mutateWrapper((w) => (w["collectionId"] = "bad id!")));
    rejects(mutateWrapper((w) => (w["sessionId"] = "bad id!")));
    rejects(mutateWrapper((w) => (w["session"] = "x")));
    rejects(mutateWrapper((w) => (w["session"] = { collectedAt: "yesterday", response: w["session"].response })));
    rejects(mutateWrapper((w) => (w["session"] = { response: w["session"].response })));
    rejects(mutateWrapper((w) => (w["session"] = { ...w["session"], extra: 1 })));
    rejects(mutateWrapper((w) => (w["session"] = { collectedAt: "2026-11-09T07:59:59Z" })));
    rejects(mutateWrapper((w) => (w["sessionAfter"] = "x")));
    rejects(mutateWrapper((w) => (w["messagePages"][0] = "x")));
    rejects(mutateWrapper((w) => delete w["messagePages"][0].collectedAt));
    rejects(mutateWrapper((w) => (w["messagePages"][0].extra = 1)));
    rejects(mutateWrapper((w) => (w["messagePages"][0].pageIndex = -1)));
    rejects(mutateWrapper((w) => (w["messagePages"][0].pageIndex = "0")));
    rejects(mutateWrapper((w) => (w["messagePages"][0].collectedAt = "yesterday")));
    rejects(mutateWrapper((w) => delete w["messagePages"][0].response));
    rejects(mutateWrapper((w) => (w["messagePages"][0].request = "x")));
    rejects(mutateWrapper((w) => (w["messagePages"][0].request.extra = 1)));
    rejects(mutateWrapper((w) => delete w["messagePages"][0].request.limit));
    rejects(mutateWrapper((w) => (w["messagePages"][0].request.limit = 0)));
    rejects(mutateWrapper((w) => (w["messagePages"][0].request.limit = 201)));
    rejects(mutateWrapper((w) => (w["messagePages"][0].request.limit = 1.5)));
    rejects(mutateWrapper((w) => (w["messagePages"][0].request.sessionId = 1)));
    rejects(mutateWrapper((w) => (w["messagePages"][0].request.order = "desc")));
    const two = buildSource({ pages: twoPages() });
    rejects(mutateWrapper((w) => (w["messagePages"][1].request.limit = 3), two));
    rejects(mutateWrapper((w) => (w["messagePages"][1].request.cursor = ""), two));
    rejects(mutateWrapper((w) => delete w["messagePages"][1].request.cursor, two));
    expect(source(two).state).toBe("ACCEPTED");
  });

  it("neverEscalatesDiffProblemsIntoRejection", () => {
    const entry = '{"file":"a","patch":"p","additions":1,"deletions":0,"status":"added"}';
    const variants = [
      '"text"',
      "5",
      "{}",
      '{"request":{}}',
      `{"response":${validDiffResponse()},"extra":1}`,
      diffMember(validDiffResponse()),
      diffMember("{}"),
      diffMember("[]"),
      diffMember('{"data":1}'),
      diffMember('{"data":[],"x":1}'),
      diffMember('{"data":["x"]}'),
      diffMember('{"data":[{"file":"a","patch":"p","additions":1,"deletions":0,"status":"zzz"}]}'),
      diffMember('{"data":[{"file":"a","patch":"p","additions":-1,"deletions":0,"status":"added"}]}'),
      diffMember('{"data":[{"file":"a","patch":"p","additions":1,"deletions":0,"status":"added","more":false}]}'),
      diffMember('{"data":[{"file":"a","patch":"p","additions":1,"deletions":0,"status":"added","more":true}]}'),
      diffMember(`{"data":[${Array.from({ length: 129 }, () => entry).join(",")}]}`),
    ];
    for (const diff of variants) {
      const v = accepted(source(buildSource({ diff })));
      expect(codes(v)).toEqual(["DIFF_UNAVAILABLE"]);
      expect(v.collectionStatus).toBe("PAGINATION_COMPLETE");
    }
  });

  it("laterPageResponseDefectsCutPrefixButFirstPageRejects", () => {
    const defects = [
      '{"data":1,"cursor":{}}',
      '{"data":[],"cursor":{},"x":1}',
      '{"data":[]}',
      '{"data":[],"cursor":1}',
      '{"data":[],"cursor":{"x":1}}',
      '{"data":[],"cursor":{"previous":1}}',
      '{"data":[],"cursor":{"next":""}}',
      '{"data":["x"],"cursor":{}}',
      '"not a page"',
    ];
    for (const response of defects) {
      const later = buildSource({
        pages: [
          { request: firstRequest(2), response: pageResponse([userMessage("msg_001")], "cur-1") },
          { request: laterRequest("cur-1", 2), response },
        ],
      });
      const v = accepted(source(later));
      expect(v.collectionStatus).toBe("PAGINATION_INCOMPLETE");
      expect(v.validatedPageCount).toBe(1);
      expect(codes(v)).toContain("SOURCE_SCHEMA_INVALID");
      expectRejected(source(buildSource({ pages: [{ request: firstRequest(), response }] })), "SOURCE_SCHEMA_INVALID");
    }
    expectRejected(source(buildSource({ pages: [{ pageIndex: 1, request: firstRequest(), response: pageResponse([]) }] })), "SOURCE_SCHEMA_INVALID");
    expectRejected(validateS2bSource(new Uint8Array([0x7b, 0xff, 0x7d])), "SOURCE_SCHEMA_INVALID");
  });
});

describe("S2-b correlation shapes", () => {
  const run = (value: unknown): ReturnType<typeof validateS2bCorrelation> => validateS2bCorrelation(enc(JSON.stringify(value)));
  const reject = (value: unknown, code: DiagnosticCode = "SOURCE_SCHEMA_INVALID"): void => {
    const r = run(value);
    expect(r.state).toBe("REJECTED");
    expect(codes(r)).toEqual([code]);
  };

  it("rejectsEachMalformedCorrelation", () => {
    const base = (): Json => correlation() as Json;
    const binding = (): Json => base()["messageBindings"][0];
    const tools = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ toolId: `t${i}`, acRef: { artifactId: "ac-1", revision: "R1" } }));
    expect(validateS2bCorrelation(enc("not json")).state).toBe("REJECTED");
    reject([]);
    reject({ ...base(), schemaVersion: "justice-s2b-correlation-v0" });
    reject({ ...base(), extra: 1 });
    const missing = base();
    delete missing["messageBindings"];
    reject(missing);
    reject({ ...base(), sessionId: "bad id!" });
    reject({ ...base(), messageBindings: "x" });
    reject({ ...base(), messageBindings: ["x"] });
    reject({ ...base(), messageBindings: [{ messageId: "msg_002" }] });
    reject({ ...base(), messageBindings: [{ ...binding(), extra: 1 }] });
    reject({ ...base(), messageBindings: [{ ...binding(), messageId: "bad id" }] });
    reject({ ...base(), messageBindings: [{ ...binding(), scopeKey: "bad id!" }] });
    reject({ ...base(), messageBindings: [{ ...binding(), tools: "x" }] });
    reject({ ...base(), messageBindings: [{ ...binding(), taskRef: "x" }] });
    reject({ ...base(), messageBindings: [{ ...binding(), taskRef: { artifactId: "task-1" } }] });
    reject({ ...base(), messageBindings: [{ ...binding(), taskRef: { artifactId: "task-1", revision: "R1", x: 1 } }] });
    reject({ ...base(), messageBindings: [{ ...binding(), tools: ["x"] }] });
    reject({ ...base(), messageBindings: [{ ...binding(), tools: [{ toolId: "t" }] }] });
    reject({ ...base(), messageBindings: [{ ...binding(), tools: [{ toolId: "", acRef: { artifactId: "ac-1", revision: "R1" } }] }] });
    reject({ ...base(), messageBindings: [{ ...binding(), tools: [{ toolId: "t", acRef: { artifactId: "bad id!", revision: "R1" } }] }] });
    reject({ ...base(), messageBindings: Array.from({ length: 513 }, () => binding()) }, "INPUT_LIMIT_EXCEEDED");
    reject({ ...base(), messageBindings: [{ ...binding(), tools: tools(65) }] }, "INPUT_LIMIT_EXCEEDED");
    reject({ ...base(), messageBindings: Array.from({ length: 33 }, () => ({ ...binding(), tools: tools(64) })) }, "INPUT_LIMIT_EXCEEDED");
    expect(run({ ...base(), messageBindings: [] }).state).toBe("ACCEPTED");
  });
});
