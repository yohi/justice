// Daily Assurance partial Advisory (design §4.4, RG-004): reuse of the existing S2-b validators/projector and S1-d.
//
// Additive Daily-only route. `runS2bOfflineAdapter` and the S1/S2-b public schemas are untouched:
//   1. revalidate the T1 binding (invalid/aborted → fresh UNAVAILABLE, S1-d never called)
//   2. recheck Native Evidence (bindingKey, digests, caps) → validateS2bSource → validateS2bCorrelation → projectS2bEvidence
//   3. recheck the Git ChangeSet with the existing inspectChangeSet
//   4. neither usable → UNAVAILABLE without S1-d; otherwise ONE runS1dDiagnostic over a Daily-only virtual source
//   5. verify S1-a identity + revalidate binding/runtime + abort before publication; stale output is suppressed
// The report carries only fixed codes, counts, and safe task/AC refs. Result DIAGNOSED is never a formal PASS.
import {createHash} from 'node:crypto';
import {isSafeIdentifier,type IntentRef,type S1aReadOnlySource} from '../core/s1a/contract.js';
import type {BinderResult,CoverageStatus,EvidenceRefV1} from '../core/s1b/contract.js';
import type {S1cDiagnostic,S1cResult} from '../core/s1c/contract.js';
import {inspectChangeSet} from '../core/s1c/path-rules.js';
import type {S1dReportV1,ScopeFallback,Stage} from '../core/s1d/contract.js';
import type {DailyChangeSetResult} from './daily-changeset.js';
import {verifyDailyBinding,type DailyBinding,type DailyPreflightPorts,type DailyReason,type Unavailable} from './daily-intent.js';
import type {DailyEvidenceResult} from './daily-native-evidence.js';
import {runS1dDiagnostic} from './s1d-diagnostic.js';
import {S2B_LIMITS,type S2bDiagnostic} from './s2b-contract.js';
import {DIAGNOSTIC_ORDER,validateS2bCorrelation,validateS2bSource} from './s2b-input.js';
import {projectS2bEvidence} from './s2b-projector.js';

export type DailyBoundary = "BOUNDED" | "UNCERTAIN" | "NOT_EVALUATED";
export type DailyEvidenceView = Readonly<{
  state:"VALID"; projectionStatus:"PROJECTED"|"LIMITED"; ruleLimited:boolean;
  matchedLocalCompletedHookCount:number; reportedExecutionState:"UNKNOWN"; reportedOutcome:"UNKNOWN";
  coverage:readonly Readonly<{acRef:IntentRef;coverageStatus:CoverageStatus}>[];
  diagnostics:readonly S2bDiagnostic[]; reasons:readonly DailyReason[];
}> | Readonly<{
  state:"UNAVAILABLE"|"REJECTED"|"NOT_EVALUATED";
  diagnostics:readonly S2bDiagnostic[]; reasons:readonly DailyReason[];
}>;
export type DailyScopeView = Readonly<{
  state:"EVALUATED";
  origin:"S1C"|"S1D_SCOPE_FALLBACK";
  comparison:"WITHIN_CANDIDATE_SCOPE"|"OUTSIDE_CANDIDATE_SCOPE";
  outsidePathCount:number; formalVerdictAvailable:false;
}> | Readonly<{
  state:"NOT_EVALUATED"; comparison:"UNKNOWN";
  reason:DailyReason|Extract<ScopeFallback,{state:"NOT_EVALUATED"}>["reason"];
}>;
export type DailyReportFields = Readonly<{
  schemaVersion:"justice-daily-advisory-v1";
  taskRef:IntentRef|null; scopeKey:string|null; boundary:DailyBoundary;
  evidence:DailyEvidenceView; scope:DailyScopeView;
  changeSetOrigin:"GIT_READ_ONLY"|"UNAVAILABLE";
  nativeDiffProjection:"UNAVAILABLE";
  formalVerdict:"UNKNOWN"; ownerAuthorityStatus:"NOT_PROVEN";
  coverageCompleteness:"NOT_ESTABLISHED";
  reasons:readonly DailyReason[]; s1cCodes:readonly S1cDiagnostic["code"][];
  limitations:readonly string[];
}>;
export type DailyAdvisoryReport =
  (Readonly<{state:"DIAGNOSED"}> & DailyReportFields)
  | (Readonly<{state:"LIMITED"}> & DailyReportFields)
  | (Readonly<{state:"UNAVAILABLE"}> & DailyReportFields);
export type DailyProjection = Readonly<{
  state:"VALID"; refs:readonly EvidenceRefV1[];
  projectionStatus:"PROJECTED"|"LIMITED"; ruleLimited:boolean; diagnostics:readonly S2bDiagnostic[];
  reasons:readonly DailyReason[];
}> | Readonly<{state:"REJECTED";diagnostics:readonly S2bDiagnostic[];reasons:readonly DailyReason[]}>
  | Unavailable;
/** Test seam only; production always uses the imported runS1dDiagnostic. */
export type DailyDiagnosticPort = typeof runS1dDiagnostic;

// ---------------------------------------------------------------------------
// Fixed constants / helpers
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 'justice-daily-advisory-v1' as const;
const EVIDENCE_PATH = 'daily://evidence';
const CHANGESET_PATH = 'daily://changeset';
/** Existing S1-d input caps (src/runtime/s1d-read-only-input.ts); never raised here. */
const S1D_EVIDENCE_BYTES = 1_048_576;
const S1D_CHANGESET_BYTES = 262_144;
const UNAVAILABLE_CHANGESET_JSON = '{"availability":"UNAVAILABLE"}';
const LABEL = /^[A-Z][A-Z0-9_]{0,63}$/;

const encoder = new TextEncoder();
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
const copy = (b: Uint8Array): Uint8Array => Uint8Array.from(b);
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
};
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const refEquals = (a: IntentRef, b: IntentRef): boolean => a.artifactId === b.artifactId && a.revision === b.revision;
const safeDiagnostics = (items: readonly S2bDiagnostic[]): S2bDiagnostic[] =>
  items.filter(d => (DIAGNOSTIC_ORDER as readonly string[]).includes(d.code) && Number.isSafeInteger(d.count) && d.count > 0)
    .map(d => ({code: d.code, count: d.count}));
const rejected = (reason: DailyReason, diagnostics: readonly S2bDiagnostic[]): DailyProjection =>
  deepFreeze({state: 'REJECTED' as const, diagnostics: safeDiagnostics(diagnostics), reasons: [reason]});
const identityMismatch = (reason: DailyReason): DailyProjection =>
  rejected(reason, [{code: 'SOURCE_IDENTITY_MISMATCH', count: 1}]);

// ---------------------------------------------------------------------------
// Projection reuse
// ---------------------------------------------------------------------------

export function projectDailyEvidence(binding:DailyBinding, evidence:DailyEvidenceResult):DailyProjection {
  try {
    if (evidence.state === 'UNAVAILABLE') return deepFreeze({state: 'UNAVAILABLE' as const, reason: evidence.reason});
    if (evidence.state === 'REJECTED') {
      const reasons = unique(evidence.reasons);
      return deepFreeze({state: 'REJECTED' as const, diagnostics: safeDiagnostics(evidence.diagnostics),
        reasons: reasons.length === 0 ? ['SOURCE_REJECTED' as const] : reasons});
    }
    if (binding.key !== binding.config.approvalSha256 || evidence.bindingKey !== binding.key) return identityMismatch('BINDING_KEY_MISMATCH');
    if (!(evidence.rawWrapper instanceof Uint8Array) || !(evidence.correlationBytes instanceof Uint8Array)) return identityMismatch('SOURCE_REJECTED');
    if (evidence.rawWrapper.byteLength > S2B_LIMITS.sourceWrapperBytes || evidence.correlationBytes.byteLength > S2B_LIMITS.correlationBytes) {
      return rejected('SOURCE_REJECTED', [{code: 'INPUT_LIMIT_EXCEEDED', count: 1}]);
    }
    const rawWrapper = copy(evidence.rawWrapper);
    const correlationBytes = copy(evidence.correlationBytes);
    if (sha(rawWrapper) !== evidence.sourceSha256 || sha(correlationBytes) !== evidence.correlationSha256) return identityMismatch('SOURCE_REJECTED');

    const sessionId = binding.config.approval.sessionId;
    const source = validateS2bSource(rawWrapper);
    if (source.state !== 'ACCEPTED') return rejected('SOURCE_REJECTED', source.diagnostics);
    const correlation = validateS2bCorrelation(correlationBytes);
    if (correlation.state !== 'ACCEPTED') return rejected('SOURCE_REJECTED', [...source.value.diagnostics, ...correlation.diagnostics]);
    if (source.value.sessionId !== sessionId || correlation.sessionId !== sessionId) return identityMismatch('SOURCE_REJECTED');

    const intent = binding.intent;
    const projection = projectS2bEvidence(source.value, correlation, intent);
    // Existing projector REJECTED → zero accepted refs; rejected refs are never used.
    if (projection.status === 'REJECTED') return rejected('SOURCE_REJECTED', projection.diagnostics);
    const scope = projection.projectionScope;
    if (!refEquals(scope.taskRef, intent.task) || scope.scopeKey !== intent.scopeKey) return identityMismatch('SOURCE_REJECTED');
    for (const ref of projection.evidenceRefs) {
      const acRef = ref.acRef;
      if (!refEquals(ref.taskRef, intent.task) || ref.scopeKey !== intent.scopeKey || acRef === undefined
        || !intent.ac.some(a => refEquals(a, acRef))) return identityMismatch('SOURCE_REJECTED');
      // Legacy local labels only; anything else is rejected rather than reinterpreted.
      if (ref.type !== 'other' || ref.provenanceClass !== 'UNVERIFIED_EXTERNAL' || ref.reportedExecutionState !== 'UNKNOWN'
        || ref.reportedOutcome !== 'UNKNOWN' || ref.contentDigest !== undefined) return identityMismatch('SOURCE_REJECTED');
    }
    if (encoder.encode(JSON.stringify(projection.evidenceRefs)).byteLength > Math.min(S1D_EVIDENCE_BYTES, S2B_LIMITS.evidenceJsonBytes)) {
      return rejected('SOURCE_REJECTED', [{code: 'EVIDENCE_LIMIT_EXCEEDED', count: 1}]);
    }
    return deepFreeze({
      state: 'VALID' as const,
      refs: projection.evidenceRefs.map(r => ({...r, taskRef: {...r.taskRef}, ...(r.acRef === undefined ? {} : {acRef: {...r.acRef}})})),
      projectionStatus: projection.status,
      ruleLimited: evidence.limited === true,
      diagnostics: safeDiagnostics(projection.diagnostics),
      reasons: unique(evidence.reasons),
    });
  } catch {
    return deepFreeze({state: 'UNAVAILABLE' as const, reason: 'SOURCE_UNAVAILABLE' as const});
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

type Fields = Omit<DailyReportFields, 'schemaVersion' | 'nativeDiffProjection' | 'formalVerdict' | 'ownerAuthorityStatus' | 'coverageCompleteness'>;

function makeReport(state: DailyAdvisoryReport['state'], f: Fields): DailyAdvisoryReport {
  return deepFreeze({
    state, schemaVersion: SCHEMA_VERSION,
    taskRef: f.taskRef === null ? null : {artifactId: f.taskRef.artifactId, revision: f.taskRef.revision},
    scopeKey: f.scopeKey, boundary: f.boundary, evidence: {...f.evidence}, scope: {...f.scope},
    changeSetOrigin: f.changeSetOrigin, nativeDiffProjection: 'UNAVAILABLE' as const,
    formalVerdict: 'UNKNOWN' as const, ownerAuthorityStatus: 'NOT_PROVEN' as const, coverageCompleteness: 'NOT_ESTABLISHED' as const,
    reasons: unique(f.reasons), s1cCodes: unique(f.s1cCodes), limitations: unique(f.limitations),
  });
}

export function makeDailyUnavailable(reason:DailyReason):DailyAdvisoryReport {
  return makeReport('UNAVAILABLE', {
    taskRef: null, scopeKey: null, boundary: 'NOT_EVALUATED',
    evidence: {state: 'NOT_EVALUATED', diagnostics: [], reasons: [reason]},
    scope: {state: 'NOT_EVALUATED', comparison: 'UNKNOWN', reason},
    changeSetOrigin: 'UNAVAILABLE', reasons: [reason], s1cCodes: [], limitations: [],
  });
}

/**
 * Ruling (design is binding over plan wording): before publication, §4.4 applies — when neither VALID
 * evidence nor an EVALUATED scope remains the report is UNAVAILABLE. After a report was already returned
 * (`afterReturn`, TERMINAL taint), §4.3 applies — DIAGNOSED→LIMITED, existing LIMITED/UNAVAILABLE kept,
 * because returned information cannot be withdrawn.
 */
export function markDailyBoundaryUncertain(
  report:DailyAdvisoryReport, reason:DailyReason, options:Readonly<{afterReturn?: boolean}> = {},
):DailyAdvisoryReport {
  // Never introduces new evidence; the returned prior report itself is never mutated.
  const evidence: DailyEvidenceView = reason === 'LATE_OBSERVATION' && report.evidence.state === 'VALID'
    ? {state: 'UNAVAILABLE', diagnostics: [], reasons: ['LATE_OBSERVATION']}
    : report.evidence;
  const nothingRemains = evidence.state !== 'VALID' && report.scope.state !== 'EVALUATED';
  const state = report.state === 'DIAGNOSED' ? 'LIMITED'
    : report.state === 'LIMITED' && nothingRemains && options.afterReturn !== true ? 'UNAVAILABLE'
    : report.state;
  return makeReport(state, {...report, boundary: 'UNCERTAIN', evidence, reasons: [...report.reasons, reason]});
}

// ---------------------------------------------------------------------------
// Advisory route
// ---------------------------------------------------------------------------

type GitView = Readonly<{state: 'VALID'; bytes: Uint8Array}> | Readonly<{state: 'UNAVAILABLE'; reason: DailyReason}>;

function inspectGit(binding: DailyBinding, changes: DailyChangeSetResult): GitView {
  if (changes.state !== 'VALID') return {state: 'UNAVAILABLE', reason: changes.reason};
  const unavailable: GitView = {state: 'UNAVAILABLE', reason: 'GIT_UNAVAILABLE'};
  if (changes.baseCommit !== binding.config.approval.baseCommit || typeof changes.headCommit !== 'string' || !/^[0-9a-f]{40}$/.test(changes.headCommit)) return unavailable;
  if (inspectChangeSet(changes.changeSet).state !== 'PRESENT') return unavailable;
  const bytes = encoder.encode(JSON.stringify(changes.changeSet));
  // Re-parse of the exact bytes S1-d will see must still be a PRESENT ChangeSet.
  if (inspectChangeSet(JSON.parse(new TextDecoder().decode(bytes)) as unknown).state !== 'PRESENT') return unavailable;
  if (bytes.byteLength > Math.min(S1D_CHANGESET_BYTES, S2B_LIMITS.changeSetJsonBytes)) return {state: 'UNAVAILABLE', reason: 'GIT_LIMIT'};
  return {state: 'VALID', bytes};
}

function createDailySource(binding: DailyBinding, evidenceBytes: Uint8Array | null, changeSetBytes: Uint8Array): S1aReadOnlySource {
  const li = binding.config.loaderInput;
  const fresh = (bytes: Uint8Array, maxBytes: number): Uint8Array => {
    if (bytes.byteLength > maxBytes) throw Object.assign(new Error('over_limit'), {kind: 'over_limit'});
    return copy(bytes);
  };
  return Object.freeze({
    async readInputFile(path: string, maxBytes: number): Promise<Uint8Array> {
      if (path === EVIDENCE_PATH) {
        if (evidenceBytes === null) throw new Error('unreadable');
        return fresh(evidenceBytes, Math.min(maxBytes, S1D_EVIDENCE_BYTES));
      }
      if (path === CHANGESET_PATH) return fresh(changeSetBytes, Math.min(maxBytes, S1D_CHANGESET_BYTES));
      if (path === li.manifestPath || path === li.intentPath) return copy(await binding.source.readInputFile(path, maxBytes));
      throw new Error('unreadable');
    },
    async readArtifact(root: string, relativePath: string, maxBytes: number): Promise<Uint8Array> {
      if (root !== li.artifactsRoot) throw new Error('unreadable');
      return copy(await binding.source.readArtifact(root, relativePath, maxBytes));
    },
  });
}

function evidenceViewOf(projection: DailyProjection, s1b: Stage<BinderResult> | null): DailyEvidenceView {
  if (projection.state === 'UNAVAILABLE') return {state: 'UNAVAILABLE', diagnostics: [], reasons: [projection.reason]};
  if (projection.state === 'REJECTED') return {state: 'REJECTED', diagnostics: projection.diagnostics, reasons: projection.reasons};
  if (s1b === null) return {state: 'UNAVAILABLE', diagnostics: [], reasons: ['DIAGNOSTIC_UNAVAILABLE']};
  if (s1b.state === 'EVALUATED' && s1b.result.evaluationStatus === 'INPUT_REJECTED') {
    return {state: 'REJECTED', diagnostics: [], reasons: ['SOURCE_REJECTED']};
  }
  if (s1b.state !== 'EVALUATED' || s1b.result.evaluationStatus !== 'EVALUATED') {
    return {state: 'UNAVAILABLE', diagnostics: [], reasons: ['DIAGNOSTIC_UNAVAILABLE']};
  }
  const coverage = s1b.result.coverageResults
    .filter(c => isSafeIdentifier(c.acRef.artifactId) && isSafeIdentifier(c.acRef.revision))
    .map(c => ({acRef: {artifactId: c.acRef.artifactId, revision: c.acRef.revision}, coverageStatus: c.coverageStatus}));
  return {
    state: 'VALID', projectionStatus: projection.projectionStatus, ruleLimited: projection.ruleLimited,
    matchedLocalCompletedHookCount: projection.refs.length, reportedExecutionState: 'UNKNOWN', reportedOutcome: 'UNKNOWN',
    coverage, diagnostics: projection.diagnostics, reasons: projection.reasons,
  };
}

function scopeViewOf(git: GitView, report: S1dReportV1): DailyScopeView {
  if (git.state !== 'VALID') return {state: 'NOT_EVALUATED', comparison: 'UNKNOWN', reason: git.reason};
  const s1c: Stage<S1cResult> = report.stages.s1c;
  if (s1c.state === 'EVALUATED') {
    const comparison = s1c.result.candidateScopeComparison;
    if (comparison === 'UNKNOWN') return {state: 'NOT_EVALUATED', comparison: 'UNKNOWN', reason: 'DIAGNOSTIC_UNAVAILABLE'};
    const outsidePathCount = s1c.result.diagnostics.filter(d => d.code === 'OUTSIDE_CANDIDATE_SCOPE').length;
    return {state: 'EVALUATED', origin: 'S1C', comparison, outsidePathCount, formalVerdictAvailable: false};
  }
  const fallback = report.scopeFallback;
  if (fallback === undefined) return {state: 'NOT_EVALUATED', comparison: 'UNKNOWN', reason: 'DIAGNOSTIC_UNAVAILABLE'};
  if (fallback.state === 'NOT_EVALUATED') return {state: 'NOT_EVALUATED', comparison: 'UNKNOWN', reason: fallback.reason};
  return {state: 'EVALUATED', origin: 'S1D_SCOPE_FALLBACK', comparison: fallback.candidateScopeComparison,
    outsidePathCount: fallback.outsidePaths.length, formalVerdictAvailable: false};
}

const s1cCodesOf = (report: S1dReportV1): S1cDiagnostic['code'][] =>
  report.stages.s1c.state === 'EVALUATED' ? report.stages.s1c.result.diagnostics.map(d => d.code) : [];

export async function runDailyAdvisory(
  binding:DailyBinding, evidence:DailyEvidenceResult, changes:DailyChangeSetResult,
  boundary:DailyBoundary, preflight:DailyPreflightPorts, signal:AbortSignal,
  runS1d:DailyDiagnosticPort=runS1dDiagnostic
):Promise<DailyAdvisoryReport> {
  try {
    const before = await verifyDailyBinding(binding, preflight, signal);
    if (signal.aborted) return makeDailyUnavailable('ABORTED');
    if (before.state !== 'OK') return makeDailyUnavailable(before.reason);
    const li = binding.config.loaderInput;
    if ([li.manifestPath, li.intentPath, li.artifactsRoot].some(p => p === EVIDENCE_PATH || p === CHANGESET_PATH)) {
      return makeDailyUnavailable('BINDING_INVALID');
    }

    const projection = projectDailyEvidence(binding, evidence);
    const git = inspectGit(binding, changes);
    const task = binding.intent.task;
    const base = {taskRef: task, scopeKey: binding.intent.scopeKey, boundary,
      changeSetOrigin: git.state === 'VALID' ? 'GIT_READ_ONLY' as const : 'UNAVAILABLE' as const};
    const extraReasons: DailyReason[] = [
      ...(git.state === 'VALID' ? [] : [git.reason]),
      ...(boundary === 'BOUNDED' ? [] : ['BOUNDARY_UNCERTAIN' as const]),
    ];

    if (projection.state !== 'VALID' && git.state !== 'VALID') {
      const view = evidenceViewOf(projection, null);
      return makeReport('UNAVAILABLE', {...base, evidence: view,
        scope: {state: 'NOT_EVALUATED', comparison: 'UNKNOWN', reason: git.reason},
        reasons: [...view.reasons, ...extraReasons], s1cCodes: [], limitations: []});
    }

    const evidenceBytes = projection.state === 'VALID' ? encoder.encode(JSON.stringify(projection.refs)) : null;
    const changeSetBytes = git.state === 'VALID' ? git.bytes : encoder.encode(UNAVAILABLE_CHANGESET_JSON);
    if (signal.aborted) return makeDailyUnavailable('ABORTED');

    let report: S1dReportV1;
    try {
      report = await runS1d(
        Object.freeze({loaderInput: li, evidencePath: EVIDENCE_PATH, changesetPath: CHANGESET_PATH}),
        createDailySource(binding, evidenceBytes, changeSetBytes),
      );
    } catch {
      return signal.aborted ? makeDailyUnavailable('ABORTED') : makeDailyUnavailable('DIAGNOSTIC_UNAVAILABLE');
    }
    if (signal.aborted) return makeDailyUnavailable('ABORTED');
    // Returned S1-a identity must still be the bound baseline; then revalidate package/runtime before publication.
    if (report.stages.s1a.state !== 'EVALUATED' || JSON.stringify(report.stages.s1a.result) !== JSON.stringify(binding.baseline)) {
      return makeDailyUnavailable('BINDING_INVALID');
    }
    const after = await verifyDailyBinding(binding, preflight, signal);
    if (signal.aborted) return makeDailyUnavailable('ABORTED');
    if (after.state !== 'OK') return makeDailyUnavailable(after.reason);

    const evidenceView = evidenceViewOf(projection, report.stages.s1b);
    const scopeView = scopeViewOf(git, report);
    const limitations = report.limitations.filter(l => LABEL.test(l));
    const evidenceRemains = evidenceView.state === 'VALID';
    const scopeRemains = scopeView.state === 'EVALUATED';
    let state: DailyAdvisoryReport['state'];
    if (evidenceView.state === 'VALID' && scopeRemains && boundary === 'BOUNDED'
      && evidenceView.projectionStatus === 'PROJECTED' && !evidenceView.ruleLimited) state = 'DIAGNOSED';
    else if (evidenceRemains || scopeRemains) state = 'LIMITED';
    else state = 'UNAVAILABLE';
    return makeReport(state, {...base, evidence: evidenceView, scope: scopeView,
      reasons: [...evidenceView.reasons, ...extraReasons], s1cCodes: s1cCodesOf(report), limitations});
  } catch {
    return signal.aborted ? makeDailyUnavailable('ABORTED') : makeDailyUnavailable('DIAGNOSTIC_UNAVAILABLE');
  }
}
