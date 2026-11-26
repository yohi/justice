import {createHash} from 'node:crypto';
import {S1A_LIMITS,isLowercaseSha256Hex,isSafeIdentifier,type IntentRef,type LoaderInput,type LoaderResult,type S1aReadOnlySource,type SelectedArtifactRef,type TaskIntent} from '../core/s1a/contract.js';
import {loadS1aArtifacts} from '../core/s1a/loader.js';
import {hasExactKeys} from '../core/s1a/manifest.js';
import {parseTaskIntent} from '../core/s1a/resolver.js';
import {parseStrictJson} from '../core/s1a/strict-json.js';
import type {TaskScopePolicy} from '../core/s1c/contract.js';
import {extractTaskScopePolicy} from '../core/s1c/policy.js';
import {createCapturedS1aSource} from './s1d-read-only-input.js';
export const DAILY_OWNER_ROOT = "/run/justice-daily/owner";
export const DAILY_APPROVAL_ENV = "JUSTICE_DAILY_APPROVAL_SHA256";
export const DAILY_HOST_SHA256 =
  "e6543f6e5c39c40971ba38afd1819ac852c29ac735b5a89065d3d148d47f27ad";
export type DailyReason =
  | "NOT_OPTED_IN" | "APPROVAL_INVALID" | "APPROVAL_DIGEST_MISMATCH"
  | "OWNER_BOUNDARY_UNVERIFIED" | "HOST_MISMATCH" | "SESSION_MISMATCH"
  | "WORKSPACE_MISMATCH" | "BASE_MISMATCH" | "DIRTY_BASE"
  | "BINDING_INVALID" | "INTENT_DIGEST_MISMATCH" | "ARTIFACT_MISMATCH"
  | "SCOPE_POLICY_INVALID" | "RULE_INVALID" | "SKILL_UNSUPPORTED"
  | "SOURCE_UNAVAILABLE" | "SOURCE_REJECTED" | "SOURCE_INCOMPLETE"
  | "SOURCE_UNSTABLE" | "RULE_UNMATCHED" | "RULE_AMBIGUOUS"
  | "IDENTITY_UNMATCHED" | "TOOL_NOT_COMPLETED" | "OBSERVATION_LIMIT"
  | "GIT_UNAVAILABLE" | "GIT_UNSTABLE" | "GIT_UNSUPPORTED" | "GIT_LIMIT"
  | "BOUNDARY_UNCERTAIN" | "TOOL_IN_FLIGHT" | "LATE_OBSERVATION"
  | "NOT_OBSERVED" | "BUSY" | "ALREADY_TERMINAL" | "BINDING_KEY_MISMATCH"
  | "ABORTED" | "TIMEOUT" | "DISPOSED" | "SETUP_FAILED" | "CLEANUP_FAILED"
  | "DIAGNOSTIC_UNAVAILABLE";
export type Unavailable = Readonly<{ state: "UNAVAILABLE"; reason: DailyReason }>;
export type CheckResult = Readonly<{state: "OK"}> | Unavailable;
export type ShellRuleInput = Readonly<{
  command: string; workdir: string; timeout: number; background: false;
}>;
export type AcquisitionRule = Readonly<{
  ruleId: string; acRef: IntentRef; purpose: "TEST_INVOCATION";
  tool: "shell"; input: ShellRuleInput;
}>;
export type DailyOwnerApproval = Readonly<{
  schemaVersion: "justice-daily-owner-approval-v1"; enabled: true;
  ownerDecisionRef: string; hostVersion: "2.3.2"; hostBinarySha256: string;
  manifestSha256: string; intentSha256: string; intent: TaskIntent;
  rules: readonly AcquisitionRule[]; sessionId: string; worktreeRoot: string;
  baseCommit: string; nativePort: number;
  skill: Readonly<{id: string; name: "executing-plans"; path: string; contentSha256: string}>;
}>;
export type DailyOwnerConfig = Readonly<{
  approval: DailyOwnerApproval; approvalSha256: string;
  loaderInput: LoaderInput & Readonly<{expectedManifestSha256: string}>;
}>;
export type DailyConfigResult = Readonly<{state: "READY"; config: DailyOwnerConfig}>
  | Readonly<{state: "OFF"; reason: DailyReason}>;
export interface OwnerConfigReadPort {
  verifyReadOnlyMount(signal: AbortSignal): Promise<CheckResult>;
  readApproval(maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
}
export interface DailyPreflightPorts {
  reloadOwnerConfig(signal: AbortSignal): Promise<DailyConfigResult>;
  readonly source: S1aReadOnlySource;
  verifyRuntime(config: DailyOwnerConfig, signal: AbortSignal): Promise<CheckResult>;
  checkCleanBase(config: DailyOwnerConfig, signal: AbortSignal): Promise<CheckResult>;
}
export type DailyBinding = Readonly<{
  key: string; config: DailyOwnerConfig; intent: TaskIntent;
  baseline: LoaderResult; scopePolicy: TaskScopePolicy;
  ownerAuthorityStatus: "NOT_PROVEN";
  source: S1aReadOnlySource;
}>;
export type DailyStartResult = Readonly<{state: "READY"; binding: DailyBinding}> | Unavailable;

const APPROVAL_MAX_BYTES = 65_536;
const MANIFEST_PATH = `${DAILY_OWNER_ROOT}/manifest.json`;
const INTENT_PATH = `${DAILY_OWNER_ROOT}/intent.json`;
const ARTIFACTS_ROOT = `${DAILY_OWNER_ROOT}/artifacts`;
const MAX_COMMAND_BYTES = 4096;
const MAX_RULES = 128;
const MAX_TIMEOUT_MS = 60_000;

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const copy = (bytes: Uint8Array): Uint8Array => Uint8Array.from(bytes);
const unavailable = (reason: DailyReason): Unavailable => Object.freeze({state: 'UNAVAILABLE' as const, reason});
const off = (reason: DailyReason): DailyConfigResult => Object.freeze({state: 'OFF' as const, reason});
const ok: CheckResult = Object.freeze({state: 'OK' as const});
class Reject extends Error {constructor(readonly reason: DailyReason) {super(reason);}}
const reject = (reason: DailyReason): never => {throw new Reject(reason);};
const reasonOf = (e: unknown, fallback: DailyReason): DailyReason => e instanceof Reject ? e.reason : fallback;
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
};
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function isAbsoluteNormalizedPath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 2 || v.length > S1A_LIMITS.relativePathLength || v[0] !== '/') return false;
  if (v.includes('\0') || v.includes('\\')) return false;
  return v.slice(1).split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
}
const isSessionId = (v: unknown): v is string => isSafeIdentifier(v) && v.startsWith('ses_') && v.length > 4;
const isIntentRef = (v: unknown): v is IntentRef => hasExactKeys(v, ['artifactId', 'revision']) && isSafeIdentifier(v.artifactId) && isSafeIdentifier(v.revision);

function parseRules(value: unknown, worktreeRoot: string, intent: TaskIntent): readonly AcquisitionRule[] {
  const invalid = (): never => reject('RULE_INVALID');
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RULES) invalid();
  const rules: AcquisitionRule[] = [];
  const ids = new Set<string>(), inputs = new Set<string>();
  for (const raw of value as unknown[]) {
    if (!hasExactKeys(raw, ['ruleId', 'acRef', 'purpose', 'tool', 'input'])) invalid();
    const r = raw as Record<string, unknown>;
    if (!isSafeIdentifier(r.ruleId) || r.purpose !== 'TEST_INVOCATION' || r.tool !== 'shell' || !isIntentRef(r.acRef)) invalid();
    const acRef = r.acRef as IntentRef;
    if (!intent.ac.some(a => a.artifactId === acRef.artifactId && a.revision === acRef.revision)) invalid();
    if (!hasExactKeys(r.input, ['command', 'workdir', 'timeout', 'background'])) invalid();
    const i = r.input as Record<string, unknown>;
    if (typeof i.command !== 'string' || i.command.length === 0 || Buffer.byteLength(i.command, 'utf8') > MAX_COMMAND_BYTES || /[\0\r\n]/.test(i.command)) invalid();
    if (i.workdir !== worktreeRoot) invalid();
    if (typeof i.timeout !== 'number' || !Number.isInteger(i.timeout) || i.timeout < 1 || i.timeout > MAX_TIMEOUT_MS) invalid();
    if (i.background !== false) invalid();
    const ruleId = r.ruleId as string;
    const inputKey = JSON.stringify([i.command, i.workdir, i.timeout]);
    if (ids.has(ruleId) || inputs.has(inputKey)) invalid();
    ids.add(ruleId); inputs.add(inputKey);
    rules.push({ruleId, acRef: {artifactId: acRef.artifactId, revision: acRef.revision}, purpose: 'TEST_INVOCATION', tool: 'shell',
      input: {command: i.command as string, workdir: i.workdir as string, timeout: i.timeout as number, background: false}});
  }
  return rules;
}

function parseApproval(bytes: Uint8Array): DailyOwnerApproval {
  let v: unknown;
  try {v = parseStrictJson(bytes, APPROVAL_MAX_BYTES);} catch {return reject('APPROVAL_INVALID');}
  const bad = (): never => reject('APPROVAL_INVALID');
  if (!hasExactKeys(v, ['schemaVersion', 'enabled', 'ownerDecisionRef', 'hostVersion', 'hostBinarySha256', 'manifestSha256', 'intentSha256', 'intent', 'rules', 'sessionId', 'worktreeRoot', 'baseCommit', 'nativePort', 'skill'])) bad();
  const a = v as Record<string, unknown>;
  if (a.schemaVersion !== 'justice-daily-owner-approval-v1' || a.enabled !== true || a.hostVersion !== '2.3.2') bad();
  if (!isSafeIdentifier(a.ownerDecisionRef) || !isLowercaseSha256Hex(a.hostBinarySha256) || !isLowercaseSha256Hex(a.manifestSha256) || !isLowercaseSha256Hex(a.intentSha256)) bad();
  if (!isSessionId(a.sessionId) || !isAbsoluteNormalizedPath(a.worktreeRoot)) bad();
  if (typeof a.baseCommit !== 'string' || !/^[0-9a-f]{40}$/.test(a.baseCommit)) bad();
  if (typeof a.nativePort !== 'number' || !Number.isInteger(a.nativePort) || a.nativePort < 1 || a.nativePort > 65_535) bad();
  if (!hasExactKeys(a.skill, ['id', 'name', 'path', 'contentSha256'])) bad();
  const s = a.skill as Record<string, unknown>;
  if (!isSafeIdentifier(s.id) || !isAbsoluteNormalizedPath(s.path) || !isLowercaseSha256Hex(s.contentSha256) || typeof s.name !== 'string') bad();
  let intent: TaskIntent;
  try {intent = parseTaskIntent(Buffer.from(JSON.stringify(a.intent)));} catch {return bad();}
  if (a.hostBinarySha256 !== DAILY_HOST_SHA256) reject('HOST_MISMATCH');
  if (s.name !== 'executing-plans') reject('SKILL_UNSUPPORTED');
  const rules = parseRules(a.rules, a.worktreeRoot as string, intent);
  return {
    schemaVersion: 'justice-daily-owner-approval-v1', enabled: true, ownerDecisionRef: a.ownerDecisionRef as string,
    hostVersion: '2.3.2', hostBinarySha256: a.hostBinarySha256 as string, manifestSha256: a.manifestSha256 as string,
    intentSha256: a.intentSha256 as string, intent, rules, sessionId: a.sessionId as string, worktreeRoot: a.worktreeRoot as string,
    baseCommit: a.baseCommit as string, nativePort: a.nativePort as number,
    skill: {id: s.id as string, name: 'executing-plans', path: s.path as string, contentSha256: s.contentSha256 as string},
  };
}

export async function loadDailyOwnerConfig(
  expectedSha256: string | undefined, port: OwnerConfigReadPort, signal: AbortSignal
): Promise<DailyConfigResult> {
  if (signal.aborted) return off('ABORTED');
  if (expectedSha256 === undefined) return off('NOT_OPTED_IN');
  if (!isLowercaseSha256Hex(expectedSha256)) return off('APPROVAL_INVALID');
  try {
    const mount = await port.verifyReadOnlyMount(signal);
    if (signal.aborted) return off('ABORTED');
    if (mount.state !== 'OK') return off('OWNER_BOUNDARY_UNVERIFIED');
  } catch {
    return signal.aborted ? off('ABORTED') : off('OWNER_BOUNDARY_UNVERIFIED');
  }
  let bytes: Uint8Array;
  try {
    bytes = copy(await port.readApproval(APPROVAL_MAX_BYTES, signal));
  } catch {
    return signal.aborted ? off('ABORTED') : off('OWNER_BOUNDARY_UNVERIFIED');
  }
  if (signal.aborted) return off('ABORTED');
  if (bytes.byteLength > APPROVAL_MAX_BYTES) return off('APPROVAL_INVALID');
  if (sha(bytes) !== expectedSha256) return off('APPROVAL_DIGEST_MISMATCH');
  try {
    const approval = parseApproval(bytes);
    const config: DailyOwnerConfig = {approval, approvalSha256: expectedSha256, loaderInput: {
      manifestPath: MANIFEST_PATH, intentPath: INTENT_PATH, artifactsRoot: ARTIFACTS_ROOT, expectedManifestSha256: approval.manifestSha256}};
    if (signal.aborted) return off('ABORTED');
    return deepFreeze({state: 'READY' as const, config});
  } catch (e) {
    return off(reasonOf(e, 'APPROVAL_INVALID'));
  }
}

type Snapshot = Readonly<{
  inputs: ReadonlyMap<string, Uint8Array>;
  artifacts: ReadonlyMap<string, Uint8Array>; // key: root + "\0" + relativePath
  baseline: LoaderResult; intent: TaskIntent; scopePolicy: TaskScopePolicy;
}>;

/** Bounded recording of one pass over the fixed inputs; abort checked around each read. */
async function capture(config: DailyOwnerConfig, source: S1aReadOnlySource, signal: AbortSignal): Promise<Snapshot | Unavailable> {
  const li = config.loaderInput;
  const inputs = new Map<string, Uint8Array>();
  const artifacts = new Map<string, Uint8Array>();
  const recorder: S1aReadOnlySource = {
    async readInputFile(path, maxBytes) {
      if (signal.aborted) throw new Reject('ABORTED');
      if (path !== li.manifestPath && path !== li.intentPath) throw new Reject('SOURCE_REJECTED');
      const bytes = await source.readInputFile(path, maxBytes);
      if (signal.aborted) throw new Reject('ABORTED');
      inputs.set(path, copy(bytes));
      return copy(bytes);
    },
    async readArtifact(root, relativePath, maxBytes) {
      if (signal.aborted) throw new Reject('ABORTED');
      if (root !== li.artifactsRoot) throw new Reject('SOURCE_REJECTED');
      const bytes = await source.readArtifact(root, relativePath, maxBytes);
      if (signal.aborted) throw new Reject('ABORTED');
      artifacts.set(`${root}\0${relativePath}`, copy(bytes));
      return copy(bytes);
    },
  };
  const captured = createCapturedS1aSource(recorder, li as LoaderInput);
  let baseline: LoaderResult;
  try {
    baseline = await loadS1aArtifacts(li, captured.source);
  } catch (e) {
    return unavailable(reasonOf(e, 'SOURCE_UNAVAILABLE'));
  }
  if (signal.aborted) return unavailable('ABORTED');
  if (baseline.manifestDigestMatch !== true) return unavailable(baseline.manifestDigestMatch === false ? 'ARTIFACT_MISMATCH' : 'SOURCE_UNAVAILABLE');
  const intentBytes = inputs.get(li.intentPath);
  if (intentBytes === undefined) return unavailable('SOURCE_UNAVAILABLE');
  if (sha(intentBytes) !== config.approval.intentSha256) return unavailable('INTENT_DIGEST_MISMATCH');
  let intent: TaskIntent;
  try {intent = parseTaskIntent(intentBytes);} catch {return unavailable('INTENT_DIGEST_MISMATCH');}
  if (JSON.stringify(intent) !== JSON.stringify(config.approval.intent)) return unavailable('INTENT_DIGEST_MISMATCH');
  if (baseline.checks.some(c => c.outcome === 'MISMATCH')) return unavailable('ARTIFACT_MISMATCH');
  if (baseline.checks.some(c => c.category === 'CHECK_INCOMPLETE')) return unavailable('SOURCE_INCOMPLETE');
  if (!baseline.identityCandidateReady) return unavailable('ARTIFACT_MISMATCH');
  const plan = baseline.selectedRefs.find((r): r is SelectedArtifactRef => r.kind === 'plan' && r.artifactId === intent.plan.artifactId);
  const task = baseline.selectedRefs.find((r): r is SelectedArtifactRef => r.kind === 'task' && r.artifactId === intent.task.artifactId);
  if (plan === undefined || task === undefined || plan.revision !== intent.plan.revision || task.revision !== intent.task.revision) return unavailable('ARTIFACT_MISMATCH');
  const planBytes = captured.getPlanSnapshot(baseline);
  if (planBytes === null) return unavailable('SCOPE_POLICY_INVALID');
  const scope = extractTaskScopePolicy(planBytes, {plan, task});
  if (scope.state !== 'READY') return unavailable('SCOPE_POLICY_INVALID');
  if (scope.policy.taskRef.artifactId !== intent.task.artifactId || scope.policy.taskRef.revision !== intent.task.revision) return unavailable('SCOPE_POLICY_INVALID');
  return {inputs, artifacts, baseline, intent, scopePolicy: scope.policy};
}

function privateSource(snapshot: Snapshot): S1aReadOnlySource {
  const overLimit = (): never => {throw Object.assign(new Error('over_limit'), {kind: 'over_limit'});};
  return Object.freeze({
    async readInputFile(path: string, maxBytes: number) {
      const bytes = snapshot.inputs.get(path);
      if (bytes === undefined) throw new Error('unreadable');
      if (bytes.byteLength > maxBytes) overLimit();
      return copy(bytes);
    },
    async readArtifact(root: string, relativePath: string, maxBytes: number) {
      const bytes = snapshot.artifacts.get(`${root}\0${relativePath}`);
      if (bytes === undefined) throw new Error('unreadable');
      if (bytes.byteLength > maxBytes) overLimit();
      return copy(bytes);
    },
  });
}

export async function prepareDailyBinding(
  config: DailyOwnerConfig, ports: DailyPreflightPorts, signal: AbortSignal
): Promise<DailyStartResult> {
  if (signal.aborted) return unavailable('ABORTED');
  try {
    const reloaded = await ports.reloadOwnerConfig(signal);
    if (signal.aborted) return unavailable('ABORTED');
    if (reloaded.state !== 'READY') return unavailable(reloaded.reason);
    if (reloaded.config.approvalSha256 !== config.approvalSha256) return unavailable('APPROVAL_DIGEST_MISMATCH');
    if (JSON.stringify(reloaded.config) !== JSON.stringify(config)) return unavailable('BINDING_INVALID');
    const runtime = await ports.verifyRuntime(config, signal);
    if (signal.aborted) return unavailable('ABORTED');
    if (runtime.state !== 'OK') return unavailable(runtime.reason);
    const clean = await ports.checkCleanBase(config, signal);
    if (signal.aborted) return unavailable('ABORTED');
    if (clean.state !== 'OK') return unavailable(clean.reason);
    const snapshot = await capture(config, ports.source, signal);
    if ('state' in snapshot) return snapshot;
    if (signal.aborted) return unavailable('ABORTED');
    const binding: DailyBinding = deepFreeze({
      key: config.approvalSha256, config, intent: snapshot.intent, baseline: snapshot.baseline,
      scopePolicy: snapshot.scopePolicy, ownerAuthorityStatus: 'NOT_PROVEN' as const, source: privateSource(snapshot),
    });
    return {state: 'READY', binding};
  } catch (e) {
    return unavailable(signal.aborted ? 'ABORTED' : reasonOf(e, 'SETUP_FAILED'));
  }
}

export async function verifyDailyBinding(
  binding: DailyBinding, ports: DailyPreflightPorts, signal: AbortSignal
): Promise<CheckResult> {
  const invalid = unavailable('BINDING_INVALID');
  if (signal.aborted) return unavailable('ABORTED');
  try {
    if (binding.key !== binding.config.approvalSha256) return invalid;
    const reloaded = await ports.reloadOwnerConfig(signal);
    if (signal.aborted) return unavailable('ABORTED');
    if (reloaded.state !== 'READY' || reloaded.config.approvalSha256 !== binding.key
      || JSON.stringify(reloaded.config) !== JSON.stringify(binding.config)) return invalid;
    const runtime = await ports.verifyRuntime(binding.config, signal);
    if (signal.aborted) return unavailable('ABORTED');
    if (runtime.state !== 'OK') return invalid;
    const current = await capture(binding.config, ports.source, signal);
    if (signal.aborted) return unavailable('ABORTED');
    if ('state' in current) return invalid;
    const held = await capture(binding.config, binding.source, signal);
    if (signal.aborted) return unavailable('ABORTED');
    if ('state' in held) return invalid;
    const same = (a: Snapshot, b: Snapshot): boolean =>
      JSON.stringify(a.baseline) === JSON.stringify(b.baseline) && JSON.stringify(a.scopePolicy) === JSON.stringify(b.scopePolicy)
      && JSON.stringify(a.intent) === JSON.stringify(b.intent);
    if (!same(current, held) || JSON.stringify(current.baseline) !== JSON.stringify(binding.baseline)
      || JSON.stringify(current.scopePolicy) !== JSON.stringify(binding.scopePolicy)) return invalid;
    return ok;
  } catch {
    return signal.aborted ? unavailable('ABORTED') : invalid;
  }
}

export function matchRuleInput(
  rules: readonly AcquisitionRule[], tool: string, input: unknown
): string | null {
  if (tool !== 'shell' || !isRecord(input)) return null;
  const proto = Object.getPrototypeOf(input) as unknown;
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Reflect.ownKeys(input);
  const expected = ['command', 'workdir', 'timeout', 'background'];
  if (keys.length !== expected.length || !expected.every(k => keys.includes(k))) return null;
  const scalar = (k: string): unknown => {
    const d = Object.getOwnPropertyDescriptor(input, k);
    return d !== undefined && 'value' in d ? d.value : undefined;
  };
  const command = scalar('command'), workdir = scalar('workdir'), timeout = scalar('timeout'), background = scalar('background');
  if (typeof command !== 'string' || typeof workdir !== 'string' || typeof timeout !== 'number' || background !== false) return null;
  const matches = rules.filter(r => r.tool === 'shell' && r.input.command === command && r.input.workdir === workdir
    && r.input.timeout === timeout && r.input.background === false);
  return matches.length === 1 ? matches[0]!.ruleId : null;
}
