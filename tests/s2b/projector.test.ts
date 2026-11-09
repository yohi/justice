import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isSafeIdentifier } from "../../src/core/s1a/contract.js";
import {
  checkEvidenceOutputLimits, partitionHashedIdentities, projectS2bEvidence, s2bEvidenceIdentityToken,
} from "../../src/runtime/s2b-projector.js";
import { validateS2bCorrelation, validateS2bSource } from "../../src/runtime/s2b-input.js";
import type {
  CorrelationResult, DiagnosticCode, Projection, TaskIntent, ValidatedSource,
} from "../../src/runtime/s2b-contract.js";
import {
  type BindingSpec, type PageSpec, COLLECTION_ID, SESSION_ID, assistantMessage, buildSource, correlation, enc, firstRequest,
  idleMessage, jsonBytes, laterRequest, pageResponse, s1aFixture, toolPart, userMessage,
} from "./fixtures.js";

type AcceptedCorrelation = Extract<CorrelationResult, { state: "ACCEPTED" }>;

const selectedIntent = (): TaskIntent => s1aFixture().intent; // task-1@R1, scope-1, ac-1@R1 + ac-2@R1

function sourceFromPages(pages: readonly PageSpec[]): ValidatedSource {
  const r = validateS2bSource(enc(buildSource({ pages })));
  if (r.state !== "ACCEPTED") throw new Error(`fixture source rejected: ${JSON.stringify(r.diagnostics)}`);
  return r.value;
}

const validatedSource = (messages: ReadonlyArray<unknown>): ValidatedSource =>
  sourceFromPages([{ request: firstRequest(), response: pageResponse(messages) }]);

function acceptedCorrelation(bindings: readonly BindingSpec[]): AcceptedCorrelation {
  const r = validateS2bCorrelation(jsonBytes(correlation(bindings)));
  if (r.state !== "ACCEPTED") throw new Error(`fixture correlation rejected: ${JSON.stringify(r.diagnostics)}`);
  return r;
}

const count = (p: Projection, code: DiagnosticCode): number => p.diagnostics.find((d) => d.code === code)?.count ?? 0;
const codes = (p: Projection): DiagnosticCode[] => p.diagnostics.map((d) => d.code);

function expectWellFormedCounts(p: Projection): void {
  for (const d of p.diagnostics) {
    expect(Number.isSafeInteger(d.count)).toBe(true);
    expect(d.count).toBeGreaterThan(0);
  }
  for (const value of Object.values(p.counts)) {
    expect(Number.isSafeInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  expect(p.projectionScope.projectedEvidenceCount).toBe(p.evidenceRefs.length);
}

const FOREIGN_TASK = { artifactId: "task-9", revision: "R1" } as const;
const SELECTED_AC = { artifactId: "ac-1", revision: "R1" } as const;
const FOREIGN_AC = { artifactId: "ac-9", revision: "R1" } as const;

describe("S2-b projector: correlation and safe Task selection", () => {
  it("rejects an invalid selected intent before projecting evidence", () => {
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")])]);
    const invalidIntent = { ...selectedIntent(), scopeKey: "../unsafe" } as TaskIntent;
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), invalidIntent);

    expect(p.status).toBe("REJECTED");
    expect(count(p, "SOURCE_SCHEMA_INVALID")).toBe(1);
    expect(p.evidenceRefs).toEqual([]);
  });

  it("rejects a source with no validated pages", () => {
    const source: ValidatedSource = {
      ...validatedSource([]),
      validatedPageCount: 0,
      lastValidatedPageIndex: null,
    };
    const p = projectS2bEvidence(source, acceptedCorrelation([]), selectedIntent());

    expect(p.status).toBe("REJECTED");
    expect(count(p, "PAGINATION_INCOMPLETE")).toBe(1);
    expect(p.evidenceRefs).toEqual([]);
    expect(p.projectionScope.firstPageIndex).toBeNull();
  });

  it("foreignTaskAcIsExcludedWithoutMismatch", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001")]),
      assistantMessage("msg_004", [toolPart("tool_009")]),
      idleMessage("msg_005"),
    ]);
    const corr = acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      // Valid foreign binding whose AC is not in the selected Intent's ac[].
      { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_009", acRef: FOREIGN_AC }] },
    ]);
    const p = projectS2bEvidence(source, corr, selectedIntent());

    expect(p.evidenceRefs).toHaveLength(1);
    for (const ref of p.evidenceRefs) {
      expect(ref.taskRef).toEqual({ artifactId: "task-1", revision: "R1" });
      expect(ref.scopeKey).toBe("scope-1");
      expect(ref.acRef).toEqual(SELECTED_AC);
    }
    expect(count(p, "FOREIGN_TASK_EXCLUDED")).toBe(1);
    expect(codes(p)).not.toContain("CORRELATION_MISMATCH");
    expect(codes(p)).not.toContain("CONFLICT");
    // Foreign exclusion is done by the adapter itself: no foreign taskRef ever reaches S1-b (no TASK_NOT_SELECTED reliance).
    expect(p.evidenceRefs.some((ref) => ref.taskRef.artifactId === FOREIGN_TASK.artifactId)).toBe(false);
    expect(p.status).toBe("PROJECTED");
    expectWellFormedCounts(p);
  });

  it("duplicateMessageBindingsRejectedBeforeForeignFiltering", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001")]),
      assistantMessage("msg_004", [toolPart("tool_002")]),
      idleMessage("msg_005"),
    ]);
    // Ownership conflict: msg_002 claimed by the selected Task AND a foreign Task.
    const ownership = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_002", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_001", acRef: FOREIGN_AC }] },
      { messageId: "msg_004", tools: [{ toolId: "tool_002", acRef: { artifactId: "ac-2", revision: "R1" } }] },
    ]), selectedIntent());
    expect(count(ownership, "CONFLICT")).toBe(1);
    expect(codes(ownership)).not.toContain("FOREIGN_TASK_EXCLUDED");
    expect(codes(ownership)).not.toContain("CORRELATION_MISMATCH");
    expect(ownership.evidenceRefs.map((r) => r.acRef)).toEqual([{ artifactId: "ac-2", revision: "R1" }]);
    expect(ownership.counts["conflictedBindings"]).toBe(2);
    expect(ownership.counts["rejectedCandidates"]).toBe(1);
    expect(ownership.status).toBe("LIMITED");
    expectWellFormedCounts(ownership);

    // Identical duplicates are still duplicates (no "same value" acceptance).
    const identical = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(count(identical, "CONFLICT")).toBe(1);
    expect(identical.evidenceRefs).toEqual([]);
    expect(identical.status).toBe("REJECTED");
    expectWellFormedCounts(identical);

    // Foreign-only duplicate: diagnosed as CONFLICT (not FOREIGN_TASK_EXCLUDED), selected projection unaffected.
    const foreignDup = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_002", acRef: FOREIGN_AC }] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_002", acRef: FOREIGN_AC }] },
    ]), selectedIntent());
    expect(count(foreignDup, "CONFLICT")).toBe(1);
    expect(codes(foreignDup)).not.toContain("FOREIGN_TASK_EXCLUDED");
    expect(foreignDup.evidenceRefs).toHaveLength(1);
    expect(foreignDup.status).toBe("PROJECTED");
    expectWellFormedCounts(foreignDup);
  });

  it("toolIdCollisionRejectedWithoutPoisoningOtherTasks", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001"), toolPart("tool_002")]),
      assistantMessage("msg_004", [toolPart("tool_009")]),
      assistantMessage("msg_006", [toolPart("tool_dup"), toolPart("tool_dup")]),
      idleMessage("msg_007"),
    ]);
    // Foreign Binding with a colliding Tool ID: CONFLICT, selected Task projection untouched.
    const foreignCollision = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      {
        messageId: "msg_004", taskRef: FOREIGN_TASK,
        tools: [{ toolId: "tool_009", acRef: FOREIGN_AC }, { toolId: "tool_009", acRef: { artifactId: "ac-8", revision: "R1" } }],
      },
    ]), selectedIntent());
    expect(count(foreignCollision, "CONFLICT")).toBe(1);
    expect(codes(foreignCollision)).not.toContain("FOREIGN_TASK_EXCLUDED");
    expect(foreignCollision.evidenceRefs.map((r) => r.acRef)).toEqual([SELECTED_AC]);
    expect(foreignCollision.status).toBe("PROJECTED");
    expectWellFormedCounts(foreignCollision);

    // Selected Binding collision: every colliding entry is rejected, the sibling Tool survives.
    const selectedCollision = projectS2bEvidence(source, acceptedCorrelation([
      {
        messageId: "msg_002",
        tools: [
          { toolId: "tool_001", acRef: SELECTED_AC },
          { toolId: "tool_001", acRef: { artifactId: "ac-2", revision: "R1" } },
          { toolId: "tool_002", acRef: { artifactId: "ac-2", revision: "R1" } },
        ],
      },
    ]), selectedIntent());
    expect(count(selectedCollision, "CONFLICT")).toBe(1);
    expect(selectedCollision.evidenceRefs.map((r) => r.acRef)).toEqual([{ artifactId: "ac-2", revision: "R1" }]);
    // Candidates are unique (messageId, toolId) keys: the doubly-listed tool_001 is one rejected candidate.
    expect(selectedCollision.counts["rejectedCandidates"]).toBe(1);
    expect(selectedCollision.counts["explicitSelectedCandidates"]).toBe(2);
    expect(selectedCollision.status).toBe("LIMITED");
    expectWellFormedCounts(selectedCollision);

    // Source-side ambiguity: the Message carries two Tool parts with the bound ID → CONFLICT, no Evidence.
    const sourceAmbiguous = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_006", tools: [{ toolId: "tool_dup", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(count(sourceAmbiguous, "CONFLICT")).toBe(1);
    expect(sourceAmbiguous.evidenceRefs).toHaveLength(1);
    expect(sourceAmbiguous.status).toBe("LIMITED");
    expectWellFormedCounts(sourceAmbiguous);
  });

  it("invalidForeignBindingStillDiagnosed", () => {
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]), idleMessage("msg_003")]);
    const selectedBinding = {
      messageId: "msg_002", taskRef: { artifactId: "task-1", revision: "R1" }, scopeKey: "scope-1",
      tools: [{ toolId: "tool_001", acRef: SELECTED_AC }],
    };
    const malformedForeign: readonly unknown[] = [
      { messageId: "msg_004", taskRef: { artifactId: "../escape", revision: "R1" }, scopeKey: "scope-1", tools: [] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, scopeKey: "scope 9", tools: [] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, scopeKey: "scope-1", tools: [{ toolId: "", acRef: FOREIGN_AC }] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, scopeKey: "scope-1", tools: [{ toolId: "tool_009", acRef: { ...FOREIGN_AC, extra: 1 } }] },
      { messageId: "not-a-message-id", taskRef: FOREIGN_TASK, scopeKey: "scope-1", tools: [] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, scopeKey: "scope-1", tools: [], extra: true },
    ];
    for (const bad of malformedForeign) {
      // The Task 1 structural validator already refuses the same document...
      const raw = jsonBytes({ schemaVersion: "justice-s2b-correlation-v1", sessionId: SESSION_ID, messageBindings: [selectedBinding, bad] });
      expect(validateS2bCorrelation(raw).state).toBe("REJECTED");
      // ...and the projector re-validates every Binding before classification instead of "rescuing" it as foreign.
      const forged = { state: "ACCEPTED", sessionId: SESSION_ID, bindings: [selectedBinding, bad], diagnostics: [] } as unknown as AcceptedCorrelation;
      const p = projectS2bEvidence(source, forged, selectedIntent());
      expect(p.status).toBe("REJECTED");
      expect(count(p, "SOURCE_SCHEMA_INVALID")).toBe(1);
      expect(codes(p)).not.toContain("FOREIGN_TASK_EXCLUDED");
      expect(p.evidenceRefs).toEqual([]);
      expectWellFormedCounts(p);
    }
  });

  it("selectedAcRevisionMismatchOnlyForSelected", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001"), toolPart("tool_002")]),
      assistantMessage("msg_004", [toolPart("tool_009")]),
      assistantMessage("msg_006", [toolPart("tool_010")]),
      assistantMessage("msg_008", [toolPart("tool_011")]),
      idleMessage("msg_009"),
    ]);
    const acR2 = { artifactId: "ac-1", revision: "R2" } as const;
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: acR2 }, { toolId: "tool_002", acRef: { artifactId: "ac-2", revision: "R1" } }] },
      // Same stale AC revision on a foreign Task: not checked against the selected ac[].
      { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_009", acRef: acR2 }] },
      // Same Task ID with another Revision, and same Task with another Scope, are foreign by (ID, Revision, Scope).
      { messageId: "msg_006", taskRef: { artifactId: "task-1", revision: "R2" }, tools: [{ toolId: "tool_010", acRef: acR2 }] },
      { messageId: "msg_008", scopeKey: "scope-2", tools: [{ toolId: "tool_011", acRef: acR2 }] },
    ]), selectedIntent());
    expect(count(p, "CORRELATION_MISMATCH")).toBe(1);
    expect(count(p, "FOREIGN_TASK_EXCLUDED")).toBe(3);
    expect(p.evidenceRefs.map((r) => r.acRef)).toEqual([{ artifactId: "ac-2", revision: "R1" }]);
    expect(p.status).toBe("LIMITED");
    expectWellFormedCounts(p);
  });

  it("notAssistantAndMissingToolProduceNoEvidence", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001")]),
      assistantMessage("msg_004", [toolPart("tool_004")]),
      idleMessage("msg_005"),
    ]);
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_001", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] }, // user Message
      { messageId: "msg_002", tools: [{ toolId: "tool_404", acRef: SELECTED_AC }] }, // Tool absent
      { messageId: "msg_099", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] }, // complete Collection, Message absent
      { messageId: "msg_004", tools: [{ toolId: "tool_004", acRef: SELECTED_AC }] }, // valid
    ]), selectedIntent());
    expect(count(p, "NOT_ASSISTANT_MESSAGE")).toBe(1);
    expect(count(p, "MISSING_TOOL")).toBe(1);
    expect(count(p, "MISSING_MESSAGE")).toBe(1);
    expect(p.evidenceRefs).toHaveLength(1);
    expect(p.counts["rejectedCandidates"]).toBe(3);
    expect(p.status).toBe("LIMITED");
    expectWellFormedCounts(p);

    const none = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_001", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_002", tools: [{ toolId: "tool_404", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(none.evidenceRefs).toEqual([]);
    expect(none.status).toBe("REJECTED");
    expectWellFormedCounts(none);
  });

  it("unmappedToolNotEvidence", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001"), toolPart("tool_002")]),
      assistantMessage("msg_004", [toolPart("tool_003")]),
      idleMessage("msg_005"),
    ]);
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(count(p, "UNMAPPED")).toBe(2); // unlisted tool_002 + unbound Message's tool_003
    expect(p.evidenceRefs).toHaveLength(1);
    expect(p.evidenceRefs[0]?.acRef).toEqual(SELECTED_AC);
    expect(p.status).toBe("PROJECTED");
    expectWellFormedCounts(p);
  });

  it("correlationSessionMismatchRejectsWithoutChildMerge", () => {
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]), idleMessage("msg_003")]);
    const r = validateS2bCorrelation(
      jsonBytes(correlation([{ messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] }], "ses_child001")),
    );
    if (r.state !== "ACCEPTED") throw new Error("fixture correlation rejected");
    const p = projectS2bEvidence(source, r, selectedIntent());
    expect(p.status).toBe("REJECTED");
    expect(count(p, "SOURCE_IDENTITY_MISMATCH")).toBe(1);
    expect(p.evidenceRefs).toEqual([]);
    expectWellFormedCounts(p);
  });

  it("incompleteCollectionAbsentMessageIsUnconfirmedNotMissing", () => {
    const source = sourceFromPages([
      { request: firstRequest(2), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")])], "cur-1") },
    ]);
    expect(source.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_003", tools: [{ toolId: "tool_002", acRef: SELECTED_AC }] }, // beyond the validated prefix
    ]), selectedIntent());
    expect(codes(p)).not.toContain("MISSING_MESSAGE");
    expect(count(p, "PAGINATION_INCOMPLETE")).toBe(1);
    expect(p.counts["unconfirmedCandidates"]).toBe(1);
    expect(p.evidenceRefs).toHaveLength(1);
    expect(p.status).toBe("LIMITED");
    expectWellFormedCounts(p);
  });

  it("projectionIsDeterministicAndDoesNotRepeatSourceDiagnostics", () => {
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]), idleMessage("msg_003")]);
    const corr = acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_009", acRef: FOREIGN_AC }] },
    ]);
    const a = projectS2bEvidence(source, corr, selectedIntent());
    const b = projectS2bEvidence(source, corr, selectedIntent());
    expect(a).toEqual(b);
    expect(count(a, "DIFF_UNAVAILABLE")).toBe(1);
    expect(Object.keys(a.counts)).toEqual([...Object.keys(a.counts)].sort());
    expect(a.projectionScope.sessionId).not.toContain(SESSION_ID);
    expect(a.projectionScope.firstPageIndex).toBe(0);
    expect(a.projectionScope.selectedMessageCount).toBe(1);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.evidenceRefs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Task 4: safe Evidence projection and deterministic Adapter status
// ---------------------------------------------------------------------------

const AC2 = { artifactId: "ac-2", revision: "R1" } as const;
const HEX64 = /^[0-9a-f]{64}$/;

/** Independent re-statement of the Evidence ID contract: SHA-256 over length-delimited UTF-8 fields. */
function expectedEvidenceId(collectionId: string, sessionId: string, messageId: string, toolId: string): string {
  const hash = createHash("sha256").update("justice-s2b-evidence-id-v1\u0000");
  for (const field of [collectionId, sessionId, messageId, toolId]) {
    const bytes = new TextEncoder().encode(field);
    hash.update(`${bytes.byteLength}:`).update(bytes);
  }
  return hash.digest("hex");
}

describe("S2-b projector: Evidence projection and status (Task 4)", () => {
  it("twoToolsYieldTwoIndependentACRefs", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001"), toolPart("tool_002")]),
      idleMessage("msg_003"),
    ]);
    const corr = acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }, { toolId: "tool_002", acRef: AC2 }] },
    ]);
    const p = projectS2bEvidence(source, corr, selectedIntent());
    expect(p.status).toBe("PROJECTED");
    expect(p.evidenceRefs).toHaveLength(2);
    const ids = p.evidenceRefs.map((r) => r.evidenceId);
    for (const id of ids) expect(id).toMatch(HEX64);
    expect(new Set(ids).size).toBe(2);
    const t01 = expectedEvidenceId(COLLECTION_ID, SESSION_ID, "msg_002", "tool_001");
    const t02 = expectedEvidenceId(COLLECTION_ID, SESSION_ID, "msg_002", "tool_002");
    expect([...ids].sort()).toEqual([t01, t02].sort());
    // Canonical order: by Evidence ID token.
    expect(ids).toEqual([...ids].sort());
    const byId = new Map(p.evidenceRefs.map((r) => [r.evidenceId, r]));
    expect(byId.get(t01)?.acRef).toEqual(SELECTED_AC);
    expect(byId.get(t02)?.acRef).toEqual(AC2);
    for (const ref of p.evidenceRefs) {
      expect(Object.keys(ref).sort()).toEqual([
        "acRef", "evidenceId", "issuerId", "originId", "provenanceClass", "reportedExecutionState", "reportedOutcome", "scopeKey", "taskRef", "type",
      ]);
      expect(ref.type).toBe("other");
      expect(ref.provenanceClass).toBe("UNVERIFIED_EXTERNAL");
      expect(ref.reportedOutcome).toBe("UNKNOWN");
      expect(ref.issuerId).toBe("opencode-v225-record");
      expect(ref.taskRef).toEqual({ artifactId: "task-1", revision: "R1" });
      expect(ref.scopeKey).toBe("scope-1");
      expect(isSafeIdentifier(ref.originId)).toBe(true);
      expect(ref.originId).not.toContain("msg_");
      expect(ref.originId).not.toContain(SESSION_ID);
      expect(ref).not.toHaveProperty("contentDigest");
    }
    // Deterministic across runs.
    expect(projectS2bEvidence(source, corr, selectedIntent())).toEqual(p);
    expectWellFormedCounts(p);
  });

  it("evidenceIdentityIsLengthDelimited", () => {
    const a = s2bEvidenceIdentityToken("c", SESSION_ID, "msg_ab", "c");
    const b = s2bEvidenceIdentityToken("c", SESSION_ID, "msg_a", "bc");
    expect(a).toMatch(HEX64);
    expect(a).not.toBe(b);
    expect(a).toBe(expectedEvidenceId("c", SESSION_ID, "msg_ab", "c"));
  });

  it("evidenceIdGoldenDigestForFixedTuple", () => {
    // Hard-coded golden value, computed outside the test/implementation with coreutils:
    //   printf 'justice-s2b-evidence-id-v1\0%s' '14:collection-00114:ses_fixture0017:msg_0028:tool_001' | sha256sum
    const GOLDEN = "01d1f835a3402c9d7e2642fe14b777deb66de3a97b38f94544ae3d062298a8d4";
    expect(s2bEvidenceIdentityToken(COLLECTION_ID, SESSION_ID, "msg_002", "tool_001")).toBe(GOLDEN);
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]), idleMessage("msg_003")]);
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(p.evidenceRefs.map((r) => r.evidenceId)).toEqual([GOLDEN]);
  });

  it("completedIsNotPass", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [
        toolPart("tool_c_exec", "completed", true),
        toolPart("tool_c_noexec", "completed", false),
        toolPart("tool_c_unset", "completed"),
        toolPart("tool_err_exec", "error", true),
        toolPart("tool_run_exec", "running", true),
      ]),
      idleMessage("msg_003"),
    ]);
    const toolIds = ["tool_c_exec", "tool_c_noexec", "tool_c_unset", "tool_err_exec", "tool_run_exec"];
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: toolIds.map((toolId) => ({ toolId, acRef: SELECTED_AC })) },
    ]), selectedIntent());
    expect(p.status).toBe("PROJECTED");
    expect(p.evidenceRefs).toHaveLength(5);
    const state = new Map(p.evidenceRefs.map((r) => [r.evidenceId, r.reportedExecutionState]));
    const id = (t: string): string => expectedEvidenceId(COLLECTION_ID, SESSION_ID, "msg_002", t);
    expect(state.get(id("tool_c_exec"))).toBe("EXECUTED");
    for (const t of toolIds.slice(1)) expect(state.get(id(t))).toBe("UNKNOWN");
    // Completed + executed is only a *reported* execution: never PASS, never verified provenance.
    for (const ref of p.evidenceRefs) {
      expect(ref.reportedOutcome).toBe("UNKNOWN");
      expect(ref.provenanceClass).toBe("UNVERIFIED_EXTERNAL");
    }
  });

  it("evidenceOrderIsIndependentOfBindingOrder", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001"), toolPart("tool_002")]),
      assistantMessage("msg_004", [toolPart("tool_003")]),
      idleMessage("msg_005"),
    ]);
    const b1: BindingSpec = { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }, { toolId: "tool_002", acRef: AC2 }] };
    const b1r: BindingSpec = { messageId: "msg_002", tools: [{ toolId: "tool_002", acRef: AC2 }, { toolId: "tool_001", acRef: SELECTED_AC }] };
    const b2: BindingSpec = { messageId: "msg_004", tools: [{ toolId: "tool_003", acRef: SELECTED_AC }] };
    const f: BindingSpec = { messageId: "msg_006", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_009", acRef: FOREIGN_AC }] };
    const a = projectS2bEvidence(source, acceptedCorrelation([b1, b2, f]), selectedIntent());
    const b = projectS2bEvidence(source, acceptedCorrelation([f, b2, b1r]), selectedIntent());
    expect(a.evidenceRefs).toHaveLength(3);
    expect(b).toEqual(a);
  });

  it("candidateCountsAreUniquePerMessageTool", () => {
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]), idleMessage("msg_003")]);
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(p.counts["explicitSelectedCandidates"]).toBe(1);
    expect(p.counts["rejectedCandidates"]).toBe(1);
    expect(p.status).toBe("REJECTED");
  });

  it("conflictedSelectedMessageWithZeroToolsIsNotProjected", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001")]),
      assistantMessage("msg_004", [toolPart("tool_004")]),
      idleMessage("msg_005"),
    ]);
    const conflictZeroTools: BindingSpec[] = [
      { messageId: "msg_002", tools: [] },
      { messageId: "msg_002", taskRef: FOREIGN_TASK, tools: [] },
    ];
    const withEvidence = projectS2bEvidence(source, acceptedCorrelation([
      ...conflictZeroTools,
      { messageId: "msg_004", tools: [{ toolId: "tool_004", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(withEvidence.status).toBe("LIMITED");
    expect(withEvidence.evidenceRefs).toHaveLength(1);
    expect(withEvidence.counts["conflictedSelectedMessages"]).toBe(1);
    const without = projectS2bEvidence(source, acceptedCorrelation(conflictZeroTools), selectedIntent());
    expect(without.status).toBe("REJECTED");
    expect(without.evidenceRefs).toEqual([]);
  });

  it("incompletePagesWithOneEvidenceLimited", () => {
    const source = sourceFromPages([
      { request: firstRequest(2), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")])], "cur-1") },
    ]);
    expect(source.collectionStatus).toBe("PAGINATION_INCOMPLETE");
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(p.status).toBe("LIMITED");
    expect(p.evidenceRefs).toHaveLength(1);
    expect(p.projectionScope.firstPageIndex).toBe(0);
    expect(p.projectionScope.lastValidatedPageIndex).toBe(0);
    expect(p.projectionScope.validatedPageCount).toBe(1);
    expect(p.counts["rejectedCandidates"]).toBe(0);
    expect(p.counts["unconfirmedCandidates"]).toBe(0);
    // LIMITED makes no Session-wide claim: S1-b MISSING_EVIDENCE must not be read as "the Session lacks Evidence".
    const text = JSON.stringify(p);
    expect(text).not.toContain("MISSING_EVIDENCE");
    expect(text).not.toContain("coverageCompleteness");
    expect(text).not.toContain("PAGINATION_COMPLETE");
    expectWellFormedCounts(p);
  });

  it("laterPageSchemaInvalidIsPrefixCutNotReject", () => {
    const pages: PageSpec[] = [
      { request: firstRequest(2), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")])], "cur-1") },
      { request: laterRequest("cur-1", 2), response: pageResponse([userMessage("msg_004")]).replace('"type":"user"', '"type":"user","type":"user"') },
    ];
    const source = sourceFromPages(pages);
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(count(p, "SOURCE_SCHEMA_INVALID")).toBe(1);
    expect(count(p, "PAGINATION_INCOMPLETE")).toBe(1);
    expect(p.status).toBe("LIMITED");
    expect(p.evidenceRefs).toHaveLength(1);
  });

  it("completePagesPartialSelectedConflictLimited", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001")]),
      assistantMessage("msg_004", [toolPart("tool_004")]),
      idleMessage("msg_005"),
    ]);
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_002", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_001", acRef: FOREIGN_AC }] },
      { messageId: "msg_004", tools: [{ toolId: "tool_004", acRef: AC2 }] },
    ]), selectedIntent());
    expect(source.collectionStatus).toBe("PAGINATION_COMPLETE");
    expect(p.status).toBe("LIMITED");
    expect(p.evidenceRefs.map((r) => r.acRef)).toEqual([AC2]);
    expect(count(p, "CONFLICT")).toBe(1);
    expect(JSON.stringify(p)).not.toContain("MISSING_EVIDENCE");
    expectWellFormedCounts(p);
  });

  it("partialWithNoValidEvidenceRejected", () => {
    const incomplete = sourceFromPages([
      { request: firstRequest(2), response: pageResponse([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")])], "cur-1") },
    ]);
    const unconfirmedOnly = projectS2bEvidence(incomplete, acceptedCorrelation([
      { messageId: "msg_003", tools: [{ toolId: "tool_003", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    expect(unconfirmedOnly.status).toBe("REJECTED");
    expect(unconfirmedOnly.evidenceRefs).toEqual([]);
    expect(unconfirmedOnly.counts["unconfirmedCandidates"]).toBe(1);
    const noBindingsIncomplete = projectS2bEvidence(incomplete, acceptedCorrelation([]), selectedIntent());
    expect(noBindingsIncomplete.status).toBe("REJECTED");
    expectWellFormedCounts(unconfirmedOnly);
  });

  it("completeWithoutSelectedBindingProjectedButNotHostComplete", () => {
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]), idleMessage("msg_003")]);
    const p = projectS2bEvidence(source, acceptedCorrelation([]), selectedIntent());
    expect(p.status).toBe("PROJECTED");
    expect(p.evidenceRefs).toEqual([]);
    expect(p.counts["explicitSelectedCandidates"]).toBe(0);
    expect(count(p, "UNMAPPED")).toBe(1);
    // PROJECTED means "the saved pages are contiguous and every explicit candidate resolved", not Host completeness.
    expect(JSON.stringify(p)).not.toContain("coverageCompleteness");
    expectWellFormedCounts(p);
  });

  it("foreignOnlyDoesNotMakeLimited", () => {
    const source = validatedSource([
      userMessage("msg_001"),
      assistantMessage("msg_002", [toolPart("tool_001")]),
      assistantMessage("msg_004", [toolPart("tool_009")]),
      idleMessage("msg_005"),
    ]);
    const onlyForeign = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_009", acRef: FOREIGN_AC }] },
    ]), selectedIntent());
    expect(onlyForeign.status).toBe("PROJECTED");
    expect(onlyForeign.evidenceRefs).toEqual([]);
    expect(count(onlyForeign, "FOREIGN_TASK_EXCLUDED")).toBe(1);
    const mixed = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
      { messageId: "msg_004", taskRef: FOREIGN_TASK, tools: [{ toolId: "tool_009", acRef: FOREIGN_AC }] },
    ]), selectedIntent());
    expect(mixed.status).toBe("PROJECTED");
    expect(mixed.evidenceRefs).toHaveLength(1);
  });

  it("evidence129IsRejectedNotTruncated", () => {
    const toolIds = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}_${String(i).padStart(3, "0")}`);
    const groups = [
      { messageId: "msg_002", tools: toolIds("tool_a", 64) },
      { messageId: "msg_004", tools: toolIds("tool_b", 64) },
      { messageId: "msg_006", tools: toolIds("tool_c", 1) },
    ];
    const build = (gs: typeof groups): Projection => {
      const source = validatedSource([
        userMessage("msg_001"),
        ...gs.map((g) => assistantMessage(g.messageId, g.tools.map((t) => toolPart(t)))),
      ]);
      const corr = acceptedCorrelation(gs.map((g) => ({ messageId: g.messageId, tools: g.tools.map((toolId) => ({ toolId, acRef: SELECTED_AC })) })));
      return projectS2bEvidence(source, corr, selectedIntent());
    };
    const at128 = build(groups.slice(0, 2));
    expect(at128.status).toBe("PROJECTED");
    expect(at128.evidenceRefs).toHaveLength(128);
    const over = build(groups);
    expect(over.status).toBe("REJECTED");
    expect(over.evidenceRefs).toEqual([]);
    expect(over.projectionScope.projectedEvidenceCount).toBe(0);
    expect(count(over, "EVIDENCE_LIMIT_EXCEEDED")).toBe(1);
    expectWellFormedCounts(over);
  });

  it("evidenceJsonOver1048576Rejected", () => {
    const source = validatedSource([userMessage("msg_001"), assistantMessage("msg_002", [toolPart("tool_001")]), idleMessage("msg_003")]);
    const p = projectS2bEvidence(source, acceptedCorrelation([
      { messageId: "msg_002", tools: [{ toolId: "tool_001", acRef: SELECTED_AC }] },
    ]), selectedIntent());
    const bytes = new TextEncoder().encode(JSON.stringify(p.evidenceRefs)).byteLength;
    expect(checkEvidenceOutputLimits(p.evidenceRefs)).toBeNull();
    expect(checkEvidenceOutputLimits(p.evidenceRefs, { evidenceRefs: 128, evidenceJsonBytes: bytes })).toBeNull();
    expect(checkEvidenceOutputLimits(p.evidenceRefs, { evidenceRefs: 128, evidenceJsonBytes: bytes - 1 })).toBe("EVIDENCE_LIMIT_EXCEEDED");
    expect(checkEvidenceOutputLimits(p.evidenceRefs, { evidenceRefs: 0, evidenceJsonBytes: 1_048_576 })).toBe("EVIDENCE_LIMIT_EXCEEDED");
    // The default byte limit is exactly 1,048,576 UTF-8 bytes of serialized Evidence JSON.
    const base = p.evidenceRefs[0]!;
    const sizeWith = (pad: string): number => new TextEncoder().encode(JSON.stringify([{ ...base, scopeKey: pad }])).byteLength;
    const fill = 1_048_576 - sizeWith("");
    expect(checkEvidenceOutputLimits([{ ...base, scopeKey: "x".repeat(fill) }])).toBeNull();
    expect(checkEvidenceOutputLimits([{ ...base, scopeKey: "x".repeat(fill + 1) }])).toBe("EVIDENCE_LIMIT_EXCEEDED");
  });

  it("hashedIdentityCollisionsRejectCollidedCandidates", () => {
    const items = ["k1", "k2", "k3", "k4"];
    const constantForK1K2 = (k: string): string => (k === "k1" || k === "k2" ? "same" : `h-${k}`);
    const r = partitionHashedIdentities(items, constantForK1K2);
    expect(r.collided).toEqual(["k1", "k2"]);
    expect(r.collisionGroups).toBe(1);
    expect(r.unique.map((u) => u.item)).toEqual(["k3", "k4"]);
    expect(r.unique.map((u) => u.token)).toEqual(["h-k3", "h-k4"]);
  });
});
