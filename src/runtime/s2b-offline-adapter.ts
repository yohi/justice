// S2-b offline READ_ONLY adapter: frozen TaskIntent snapshot (P-001), in-memory S1-d bridge, safe wrapper output.
//
// Fixed order:
//   1. path namespace checks (virtual paths vs every real path; distinct input roles) — before any read
//   2. ONE bounded read of the TaskIntent, copied with Uint8Array.from, parsed with the existing parseTaskIntent()
//   3. bounded reads of the saved Source wrapper and the Correlation (copied, re-checked against their caps)
//   4. validateS2bSource → validateS2bCorrelation → projectS2bEvidence
//   5. REJECTED → no S1-d call and no `s1d` key; LIMITED/PROJECTED → encode Evidence / UNAVAILABLE ChangeSet,
//      re-verify the snapshot identity, then call runS1dDiagnostic exactly once through the virtual source
//
// The S1-d report is never rewritten. Everything S2-b adds to the output is a fixed code, a count, a safe S1
// identifier already validated by S1 parsers, or an anonymous hex token. Any unexpected exception maps to a
// fixed diagnostic with no exception text.
import { createHash } from "node:crypto";
import { S1A_LIMITS, isLowercaseSha256Hex, isSafeIdentifier, type LoaderInput, type S1aReadOnlySource, type TaskIntent } from "../core/s1a/contract.js";
import { parseTaskIntent } from "../core/s1a/resolver.js";
import { formatJson, formatText } from "../core/s1d/formatter.js";
import { runS1dDiagnostic } from "./s1d-diagnostic.js";
import {
  S2B_LIMITS,
  S2B_REPORT_SCHEMA_VERSION,
  type CollectionStatus,
  type DiagnosticCode,
  type EvidenceRefV1,
  type Projection,
  type S2bDiagnostic,
  type S2bReportV1,
  type S2bRequest,
  type S2bStatus,
  type S1dReportV1,
} from "./s2b-contract.js";
import { DIAGNOSTIC_ORDER, validateS2bCorrelation, validateS2bSource } from "./s2b-input.js";
import { projectS2bEvidence } from "./s2b-projector.js";

export const S2B_VIRTUAL_EVIDENCE_PATH = "s2b://evidence" as const;
export const S2B_VIRTUAL_CHANGESET_PATH = "s2b://changeset" as const;

/** Existing S1-d input caps (src/runtime/s1d-read-only-input.ts); never raised here. */
const S1D_EVIDENCE_BYTES = 1_048_576;
const S1D_CHANGESET_BYTES = 262_144;
/** The only ChangeSet the initial MVP ever emits (F-002). */
const UNAVAILABLE_CHANGESET_JSON = '{"availability":"UNAVAILABLE"}';

type RunS1d = typeof runS1dDiagnostic;
type Ref = Readonly<{ artifactId: string; revision: string }>;
type Scope = Projection["projectionScope"];

/** Fixed-code failure carried through the adapter; never holds caller or exception text. */
class AdapterRejection extends Error {
  constructor(readonly code: DiagnosticCode) {
    super(code);
  }
}
const rejectWith = (code: DiagnosticCode): never => {
  throw new AdapterRejection(code);
};

// Same key set as the projector's counts (sorted), all zero, for reports where no projection was evaluated.
const NEUTRAL_COUNT_KEYS = [
  "bindings", "conflictedBindings", "conflictedSelectedMessages", "explicitSelectedCandidates", "foreignBindings",
  "rejectedCandidates", "selectedBindings", "unconfirmedCandidates", "unmappedTools", "validCandidates",
] as const;

const encoder = new TextEncoder();
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((v, i) => v === b.at(i));
const refEquals = (a: Ref, b: Ref): boolean => a.artifactId === b.artifactId && a.revision === b.revision;
const overLimit = (): Error => Object.assign(new Error("over_limit"), { kind: "over_limit" });
const isOverLimit = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "kind" in error && (error as { kind: unknown }).kind === "over_limit";

function freezeDiagnostics(items: readonly S2bDiagnostic[]): readonly S2bDiagnostic[] {
  const counts = new Map<DiagnosticCode, number>();
  for (const d of items) if (d.count > 0) counts.set(d.code, (counts.get(d.code) ?? 0) + d.count);
  return Object.freeze(
    DIAGNOSTIC_ORDER.filter((code) => (counts.get(code) ?? 0) > 0).map((code) => Object.freeze({ code, count: counts.get(code) ?? 0 })),
  );
}

function neutralCounts(): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(NEUTRAL_COUNT_KEYS.map((k) => [k, 0])));
}

function neutralScope(intent: TaskIntent | null): Scope {
  return Object.freeze({
    sessionId: "",
    collectionId: "",
    taskRef: Object.freeze(intent === null ? { artifactId: "", revision: "" } : { artifactId: intent.task.artifactId, revision: intent.task.revision }),
    scopeKey: intent === null ? "" : intent.scopeKey,
    firstPageIndex: null,
    lastValidatedPageIndex: null,
    validatedPageCount: 0,
    selectedMessageCount: 0,
    projectedEvidenceCount: 0,
  });
}

type AdapterPart = S2bReportV1["adapter"];

function makeReport(adapter: Readonly<{
  status: S2bStatus;
  collectionStatus: CollectionStatus | "NOT_EVALUATED";
  intent: TaskIntent | null;
  scope: Scope;
  counts: Readonly<Record<string, number>>;
  diagnostics: readonly S2bDiagnostic[];
}>, s1d?: S1dReportV1): S2bReportV1 {
  const part: AdapterPart = Object.freeze({
    status: adapter.status,
    collectionStatus: adapter.collectionStatus,
    ...(adapter.intent === null
      ? {}
      : { selectedTaskRef: Object.freeze({ artifactId: adapter.intent.task.artifactId, revision: adapter.intent.task.revision }) }),
    projectionScope: adapter.scope,
    coverageCompleteness: "NOT_ESTABLISHED" as const,
    counts: adapter.counts,
    diagnostics: freezeDiagnostics(adapter.diagnostics),
    diffProjection: "UNAVAILABLE" as const,
  });
  return Object.freeze({
    schemaVersion: S2B_REPORT_SCHEMA_VERSION,
    adapter: part,
    ...(s1d === undefined ? {} : { s1d }),
  });
}

const rejectedReport = (
  diagnostics: readonly S2bDiagnostic[],
  intent: TaskIntent | null,
  collectionStatus: CollectionStatus | "NOT_EVALUATED" = "NOT_EVALUATED",
): S2bReportV1 =>
  makeReport({ status: "REJECTED", collectionStatus, intent, scope: neutralScope(intent), counts: neutralCounts(), diagnostics });

// ---------------------------------------------------------------------------
// Path namespace (checked before any read)
// ---------------------------------------------------------------------------

function checkPathNamespace(request: S2bRequest): void {
  const loader: Partial<LoaderInput> = (request as { loaderInput?: Partial<LoaderInput> }).loaderInput ?? {};
  const files = [loader.manifestPath, loader.intentPath, request.sourcePath, request.correlationPath];
  const all = [...files, loader.artifactsRoot];
  if (!all.every((p): p is string => typeof p === "string" && p.length > 0)) rejectWith("SOURCE_SCHEMA_INVALID");
  // Virtual paths must never equal any real source/loader path.
  if (all.some((p) => p === S2B_VIRTUAL_EVIDENCE_PATH || p === S2B_VIRTUAL_CHANGESET_PATH)) rejectWith("CONFLICT");
  // Each real input file has exactly one role.
  if (new Set(files).size !== files.length) rejectWith("CONFLICT");
}

// ---------------------------------------------------------------------------
// Bounded reads
// ---------------------------------------------------------------------------

/** One bounded read, re-checked against the cap and copied so no caller buffer is ever shared. */
async function boundedCopy(source: S1aReadOnlySource, path: string, cap: number, unreadable: DiagnosticCode): Promise<Uint8Array> {
  let raw: Uint8Array;
  try {
    raw = await source.readInputFile(path, cap);
  } catch (error) {
    return rejectWith(isOverLimit(error) ? "INPUT_LIMIT_EXCEEDED" : unreadable);
  }
  if (!(raw instanceof Uint8Array)) return rejectWith(unreadable);
  if (raw.byteLength > cap) return rejectWith("INPUT_LIMIT_EXCEEDED");
  const copy = Uint8Array.from(raw);
  // Readback invariant: the private copy is byte-identical to what was read at this moment.
  if (!bytesEqual(copy, raw)) return rejectWith("SOURCE_IDENTITY_MISMATCH");
  return copy;
}

/** P-001 frozen snapshot of the selected TaskIntent: private bytes, their digest, and the Intent parsed from them. */
type IntentSnapshot = Readonly<{ bytes: Uint8Array; digest: string; intent: TaskIntent }>;

async function snapshotIntent(source: S1aReadOnlySource, intentPath: string): Promise<IntentSnapshot> {
  const bytes = await boundedCopy(source, intentPath, S1A_LIMITS.intentBytes, "SOURCE_SCHEMA_INVALID");
  let intent: TaskIntent;
  try {
    intent = parseTaskIntent(Uint8Array.from(bytes));
  } catch {
    return rejectWith("SOURCE_SCHEMA_INVALID");
  }
  return Object.freeze({ bytes, digest: sha256Hex(bytes), intent: deepFreezeIntent(intent) });
}

function deepFreezeIntent(intent: TaskIntent): TaskIntent {
  const ref = (r: Ref): Ref => Object.freeze({ artifactId: r.artifactId, revision: r.revision });
  return Object.freeze({
    schemaVersion: intent.schemaVersion,
    scopeKey: intent.scopeKey,
    design: ref(intent.design),
    plan: ref(intent.plan),
    task: ref(intent.task),
    ac: Object.freeze(intent.ac.map(ref)),
  });
}

const canonicalIntent = (intent: TaskIntent): string => JSON.stringify(deepFreezeIntent(intent));

/**
 * Explicit pre-call identity check: the frozen bytes are unchanged, re-parse to the same Intent that drove selection,
 * and the Projection / every Evidence ref belongs to that Intent. Conflict → fail closed (never a second real read).
 */
function verifySnapshotIdentity(snapshot: IntentSnapshot, projection: Projection): void {
  if (sha256Hex(snapshot.bytes) !== snapshot.digest) rejectWith("SOURCE_IDENTITY_MISMATCH");
  let reparsed: TaskIntent;
  try {
    reparsed = parseTaskIntent(Uint8Array.from(snapshot.bytes));
  } catch {
    return rejectWith("SOURCE_IDENTITY_MISMATCH");
  }
  if (canonicalIntent(reparsed) !== canonicalIntent(snapshot.intent)) rejectWith("SOURCE_IDENTITY_MISMATCH");
  const selected = snapshot.intent;
  const scope = projection.projectionScope;
  if (!refEquals(scope.taskRef, selected.task) || scope.scopeKey !== selected.scopeKey) rejectWith("SOURCE_IDENTITY_MISMATCH");
  for (const ref of projection.evidenceRefs) {
    const acRef = ref.acRef;
    if (!refEquals(ref.taskRef, selected.task) || ref.scopeKey !== selected.scopeKey || acRef === undefined || !selected.ac.some((ac) => refEquals(ac, acRef))) {
      rejectWith("SOURCE_IDENTITY_MISMATCH");
    }
  }
}

// ---------------------------------------------------------------------------
// Virtual S1-d source
// ---------------------------------------------------------------------------

function freshCopy(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength > maxBytes) throw overLimit();
  return Uint8Array.from(bytes);
}

function createVirtualSource(
  source: S1aReadOnlySource,
  loaderInput: LoaderInput,
  snapshot: IntentSnapshot,
  evidenceBytes: Uint8Array,
  changeSetBytes: Uint8Array,
): S1aReadOnlySource {
  return Object.freeze({
    async readInputFile(path: string, maxBytes: number): Promise<Uint8Array> {
      if (path === loaderInput.intentPath) return freshCopy(snapshot.bytes, maxBytes);
      if (path === S2B_VIRTUAL_EVIDENCE_PATH) return freshCopy(evidenceBytes, maxBytes);
      if (path === S2B_VIRTUAL_CHANGESET_PATH) return freshCopy(changeSetBytes, maxBytes);
      if (path === loaderInput.manifestPath) return source.readInputFile(path, maxBytes);
      throw new Error("unreadable");
    },
    readArtifact(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array> {
      return source.readArtifact(root, relativePath, maxBytes);
    },
  });
}

function encodeEvidence(refs: readonly EvidenceRefV1[]): Uint8Array {
  const bytes = encoder.encode(JSON.stringify(refs));
  if (bytes.byteLength > Math.min(S1D_EVIDENCE_BYTES, S2B_LIMITS.evidenceJsonBytes)) rejectWith("EVIDENCE_LIMIT_EXCEEDED");
  return bytes;
}

function encodeChangeSet(): Uint8Array {
  const bytes = encoder.encode(UNAVAILABLE_CHANGESET_JSON);
  if (bytes.byteLength > Math.min(S1D_CHANGESET_BYTES, S2B_LIMITS.changeSetJsonBytes)) rejectWith("INPUT_LIMIT_EXCEEDED");
  return bytes;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export async function runS2bOfflineAdapter(
  request: S2bRequest,
  source: S1aReadOnlySource,
  runS1d: RunS1d = runS1dDiagnostic,
): Promise<S2bReportV1> {
  let snapshot: IntentSnapshot | null = null;
  let collectionStatus: CollectionStatus | "NOT_EVALUATED" = "NOT_EVALUATED";
  let carried: readonly S2bDiagnostic[] = [];
  try {
    checkPathNamespace(request);
    const loaderInput: LoaderInput = Object.freeze({
      manifestPath: request.loaderInput.manifestPath,
      intentPath: request.loaderInput.intentPath,
      artifactsRoot: request.loaderInput.artifactsRoot,
      // Caller-supplied only; never derived from the Manifest.
      ...(request.loaderInput.expectedManifestSha256 === undefined ? {} : { expectedManifestSha256: request.loaderInput.expectedManifestSha256 }),
    });

    snapshot = await snapshotIntent(source, loaderInput.intentPath);
    const sourceBytes = await boundedCopy(source, request.sourcePath, S2B_LIMITS.sourceWrapperBytes, "SOURCE_SCHEMA_INVALID");
    const correlationBytes = await boundedCopy(source, request.correlationPath, S2B_LIMITS.correlationBytes, "SOURCE_SCHEMA_INVALID");

    const validated = validateS2bSource(sourceBytes);
    if (validated.state === "REJECTED") return rejectedReport(validated.diagnostics, snapshot.intent);
    collectionStatus = validated.value.collectionStatus;
    carried = validated.value.diagnostics;

    const correlation = validateS2bCorrelation(correlationBytes);
    if (correlation.state === "REJECTED") {
      return rejectedReport([...carried, ...correlation.diagnostics], snapshot.intent, collectionStatus);
    }

    const projection = projectS2bEvidence(validated.value, correlation, snapshot.intent);
    if (projection.status === "REJECTED") {
      // REJECTED: S1-d is never invoked and no `s1d` key exists.
      return makeReport({
        status: "REJECTED",
        collectionStatus,
        intent: snapshot.intent,
        scope: Object.freeze({ ...projection.projectionScope, projectedEvidenceCount: 0 }),
        counts: projection.counts,
        diagnostics: projection.diagnostics,
      });
    }

    const evidenceBytes = encodeEvidence(projection.evidenceRefs);
    const changeSetBytes = encodeChangeSet();
    verifySnapshotIdentity(snapshot, projection);

    const s1d = await runS1d(
      Object.freeze({ loaderInput, evidencePath: S2B_VIRTUAL_EVIDENCE_PATH, changesetPath: S2B_VIRTUAL_CHANGESET_PATH }),
      createVirtualSource(source, loaderInput, snapshot, evidenceBytes, changeSetBytes),
    );
    return makeReport(
      {
        status: projection.status,
        collectionStatus,
        intent: snapshot.intent,
        scope: projection.projectionScope,
        counts: projection.counts,
        diagnostics: projection.diagnostics,
      },
      s1d,
    );
  } catch (error) {
    // Fixed code only; no exception text, stack, or caller data reaches the report.
    const code: DiagnosticCode = error instanceof AdapterRejection ? error.code : "SOURCE_SCHEMA_INVALID";
    return rejectedReport([...carried, { code, count: 1 }], snapshot?.intent ?? null, collectionStatus);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const REDACTED = "[redacted]";
/** S2-b-added string values: safe S1 identifiers, anonymous hex tokens, or empty (neutral). Anything else is redacted. */
const safeValue = (v: unknown): string =>
  typeof v === "string" && (v === "" || isSafeIdentifier(v) || isLowercaseSha256Hex(v)) ? v : REDACTED;
const safeCount = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const safeIndex = (v: unknown): number | null => (v === null ? null : safeCount(v));
const isDiagnosticCode = (v: unknown): v is DiagnosticCode => typeof v === "string" && (DIAGNOSTIC_ORDER as readonly string[]).includes(v);
const STATUSES: readonly string[] = ["REJECTED", "LIMITED", "PROJECTED"];
const COLLECTION_STATUSES: readonly string[] = ["PAGINATION_COMPLETE", "PAGINATION_INCOMPLETE", "NOT_EVALUATED"];

function orderedAdapter(adapter: AdapterPart): Record<string, unknown> {
  const scope = adapter.projectionScope;
  const counts = Object.entries(adapter.counts)
    .filter(([k]) => isSafeIdentifier(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, safeCount(v)] as const);
  return {
    status: STATUSES.includes(adapter.status) ? adapter.status : "REJECTED",
    collectionStatus: COLLECTION_STATUSES.includes(adapter.collectionStatus) ? adapter.collectionStatus : "NOT_EVALUATED",
    ...(adapter.selectedTaskRef === undefined
      ? {}
      : { selectedTaskRef: { artifactId: safeValue(adapter.selectedTaskRef.artifactId), revision: safeValue(adapter.selectedTaskRef.revision) } }),
    projectionScope: {
      sessionId: safeValue(scope.sessionId),
      collectionId: safeValue(scope.collectionId),
      taskRef: { artifactId: safeValue(scope.taskRef.artifactId), revision: safeValue(scope.taskRef.revision) },
      scopeKey: safeValue(scope.scopeKey),
      firstPageIndex: scope.firstPageIndex === 0 ? 0 : null,
      lastValidatedPageIndex: safeIndex(scope.lastValidatedPageIndex),
      validatedPageCount: safeCount(scope.validatedPageCount),
      selectedMessageCount: safeCount(scope.selectedMessageCount),
      projectedEvidenceCount: safeCount(scope.projectedEvidenceCount),
    },
    coverageCompleteness: "NOT_ESTABLISHED",
    counts: Object.fromEntries(counts),
    diagnostics: freezeDiagnostics(adapter.diagnostics.filter((d) => isDiagnosticCode(d.code)).map((d) => ({ code: d.code, count: safeCount(d.count) })))
      .map((d) => ({ code: d.code, count: d.count })),
    diffProjection: "UNAVAILABLE",
  };
}

export function formatS2bJson(report: S2bReportV1): string {
  const head = JSON.stringify({ schemaVersion: S2B_REPORT_SCHEMA_VERSION, adapter: orderedAdapter(report.adapter) });
  if (report.s1d === undefined) return `${head}\n`;
  // The `s1d` member is the existing S1-d JSON serialization, byte-for-byte (formatJson ends with "\n").
  return `${head.slice(0, -1)},"s1d":${formatJson(report.s1d).trimEnd()}}\n`;
}

export function formatS2bText(report: S2bReportV1): string {
  const a = orderedAdapter(report.adapter) as {
    status: string; collectionStatus: string; selectedTaskRef?: Ref;
    projectionScope: {
      sessionId: string; collectionId: string; taskRef: Ref; scopeKey: string; firstPageIndex: number | null;
      lastValidatedPageIndex: number | null; validatedPageCount: number; selectedMessageCount: number; projectedEvidenceCount: number;
    };
    counts: Record<string, number>; diagnostics: S2bDiagnostic[];
  };
  const s = a.projectionScope;
  const token = (v: string): string => (v === "" ? "not evaluated" : v);
  const pages = s.firstPageIndex === null
    ? "none"
    : `${s.firstPageIndex}..${s.lastValidatedPageIndex === null ? "none" : String(s.lastValidatedPageIndex)}`;
  const invoked = report.s1d !== undefined;
  const lines = [
    "Justice S2-b — offline READ_ONLY adapter",
    `Adapter status: ${a.status}`,
    `Collection status: ${a.collectionStatus} (saved page sequence only; not Session-wide completeness)`,
    `Selected task: ${a.selectedTaskRef === undefined ? "not established" : `${a.selectedTaskRef.artifactId}@${a.selectedTaskRef.revision}`}`,
    `Projection scope: session=${token(s.sessionId)} collection=${token(s.collectionId)} task=${s.taskRef.artifactId === "" ? "not established" : `${s.taskRef.artifactId}@${s.taskRef.revision}`} scope=${s.scopeKey === "" ? "not established" : s.scopeKey}`,
    `  validated pages: ${pages} (count ${s.validatedPageCount}); selected messages: ${s.selectedMessageCount}; projected evidence: ${s.projectedEvidenceCount}`,
    "Coverage completeness: NOT_ESTABLISHED",
    "Diff projection: UNAVAILABLE (ChangeSet availability UNAVAILABLE)",
    "Authority: owner approval UNVERIFIED; host execution UNVERIFIED; evidence provenance UNVERIFIED_EXTERNAL",
    `Counts: ${Object.entries(a.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    ...a.diagnostics.map((d) => `Adapter diagnostic: ${d.code} x${d.count}`),
  ];
  if (!invoked) {
    lines.push("S1-d: NOT_INVOKED");
  } else if (a.status === "LIMITED") {
    lines.push(
      "Adapter scope: LIMITED — S1-d findings below (e.g. MISSING_EVIDENCE, AC_EVIDENCE_REF_MISSING) describe only the projected limited Evidence set within the validated page prefix; they are not evidence of absence in the Session history.",
    );
  } else {
    lines.push(
      "Adapter scope: PROJECTED — S1-d findings below describe only the projected Evidence set; this does not prove complete Host history or Owner approval.",
    );
  }
  lines.push("This adapter output is not an acceptance or a Gate decision.");
  const head = `${lines.join("\n")}\n`;
  // The existing S1-d Text follows unchanged.
  return invoked && report.s1d !== undefined ? `${head}${formatText(report.s1d)}` : head;
}
